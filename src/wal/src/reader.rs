// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{
    collections::HashMap,
    fs::{File, Metadata},
    io::{self, BufReader, Read, Seek},
    path::PathBuf,
};

use byteorder::{BigEndian, ReadBytesExt};
use crc32fast::Hasher;
use snafu::{ResultExt, ensure};

use crate::{FileHeader, ReadFrom, errors::*};

pub struct Reader<R> {
    path: PathBuf,
    f: R,
    header: FileHeader,
}

impl Reader<BufReader<File>> {
    pub fn from_path(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        let f = File::open(&path).context(FileOpenSnafu { path: path.clone() })?;
        let mut f = BufReader::new(f);

        // check the file type identifier
        let mut buf = [0; super::FILE_TYPE_IDENTIFIER.len()];
        f.read_exact(&mut buf).context(UnableToReadArraySnafu {
            length: super::FILE_TYPE_IDENTIFIER.len(),
        })?;
        ensure!(
            &buf == super::FILE_TYPE_IDENTIFIER || &buf == super::FILE_TYPE_IDENTIFIER_WITH_HEADER,
            FileIdentifierMismatchSnafu,
        );

        if &buf == super::FILE_TYPE_IDENTIFIER_WITH_HEADER {
            // check the file header, and skip header.
            // if we need to get header, use Reader::header
            let mut buf = [0; super::WAL_FILE_HEADER_LEN];
            f.read_exact(&mut buf).context(UnableToReadArraySnafu {
                length: super::WAL_FILE_HEADER_LEN,
            })?;
            let mut buf = std::io::Cursor::new(buf);
            let header_len = buf
                .read_u32::<BigEndian>()
                .context(UnableToReadLengthSnafu)? as usize;
            let mut bytes = vec![0u8; header_len];
            f.read_exact(&mut bytes)
                .context(UnableToReadArraySnafu { length: header_len })?;
            let header = Self::deserialize_header(&bytes)?;

            Ok(Self::new(path, f, header))
        } else {
            Ok(Self::new(path, f, HashMap::new()))
        }
    }

    pub fn from_path_position(path: impl Into<PathBuf>, read_from: ReadFrom) -> Result<Self> {
        let mut reader = Self::from_path(path)?;

        match read_from {
            ReadFrom::Checkpoint(file_position) if file_position > 0 => {
                let _ = reader.f.seek(io::SeekFrom::Start(file_position)).unwrap();
            }
            ReadFrom::Checkpoint(_) => {
                // do nothing because file_position is start from 0, same as ReadFrom::Beginning
                // branch
            }
            ReadFrom::Beginning => {
                // do nothing because the file is already at the beginning
            }
            ReadFrom::End => {
                let _ = reader.f.seek(io::SeekFrom::End(0)).unwrap();
            }
        };

        Ok(reader)
    }

    pub fn metadata(&self) -> io::Result<Metadata> {
        self.f.get_ref().metadata()
    }

    pub fn current_position(&mut self) -> io::Result<u64> {
        let position = self.f.stream_position()?;
        Ok(position)
    }

    fn deserialize_header(bytes: &[u8]) -> Result<FileHeader> {
        let mut header = HashMap::new();
        let mut cursor = 0;

        while cursor < bytes.len() {
            // read key len
            let key_len = u32::from_be_bytes(bytes[cursor..cursor + 4].try_into().unwrap());
            cursor += 4;

            // read key value
            let key = String::from_utf8(bytes[cursor..cursor + key_len as usize].to_vec()).unwrap();
            cursor += key_len as usize;

            // read value len
            let value_len = u32::from_be_bytes(bytes[cursor..cursor + 4].try_into().unwrap());
            cursor += 4;

            // read value value
            let value =
                String::from_utf8(bytes[cursor..cursor + value_len as usize].to_vec()).unwrap();
            cursor += value_len as usize;

            header.insert(key, value);
        }

        Ok(header)
    }
}

impl<R> Reader<R>
where
    R: Read,
{
    pub fn new(path: PathBuf, f: R, header: FileHeader) -> Self {
        Self { path, f, header }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    // read entry from the wal file
    pub fn read_entry(&mut self) -> Result<Option<Vec<u8>>> {
        match self._read_entry() {
            Ok((data, _)) => Ok(data),
            Err(e) => Err(e),
        }
    }

    pub fn read_entry_with_length(&mut self) -> Result<(Option<Vec<u8>>, u64)> {
        self._read_entry()
    }

    pub fn _read_entry(&mut self) -> Result<(Option<Vec<u8>>, u64)> {
        let total_start = std::time::Instant::now();

        // Time checksum reading
        let checksum_start = std::time::Instant::now();
        let expected_checksum = match self.f.read_u32::<BigEndian>() {
            Err(ref e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok((None, 0)),
            other => other.context(UnableToReadChecksumSnafu)?,
        };
        let checksum_read_duration = checksum_start.elapsed();

        if expected_checksum == 0 {
            return Ok((None, 0));
        }

        // Time length reading
        let length_start = std::time::Instant::now();
        let expected_len = self
            .f
            .read_u32::<BigEndian>()
            .context(UnableToReadLengthSnafu)?
            .into();
        let length_read_duration = length_start.elapsed();

        if expected_len == 0 {
            return Ok((Some(vec![]), 0));
        }

        // Time compressed data reading with CRC
        let data_read_start = std::time::Instant::now();
        let compressed_read = self.f.by_ref().take(expected_len);
        let hashing_read = CrcReader::new(compressed_read);
        let data_read_setup_duration = data_read_start.elapsed();

        // Time decompression
        let decompress_start = std::time::Instant::now();
        let mut decompressing_read = snap::read::FrameDecoder::new(hashing_read);

        let mut data = Vec::with_capacity(1024);
        decompressing_read
            .read_to_end(&mut data)
            .context(UnableToReadDataSnafu)?;
        let decompress_duration = decompress_start.elapsed();

        // Time CRC extraction and verification
        let crc_verify_start = std::time::Instant::now();
        let (actual_compressed_len, actual_checksum) = decompressing_read.into_inner().checksum();
        let crc_verify_duration = crc_verify_start.elapsed();

        // Time validation checks
        let validation_start = std::time::Instant::now();
        if expected_len != actual_compressed_len {
            return Err(Error::LengthMismatch {
                expected: expected_len,
                actual: actual_compressed_len,
            });
        }

        if expected_checksum != actual_checksum {
            return Err(Error::ChecksumMismatch {
                expected: expected_checksum,
                actual: actual_checksum,
            });
        }
        let validation_duration = validation_start.elapsed();

        let total_duration = total_start.elapsed();

        // Log timing breakdown if slow
        if total_duration.as_millis() > 100 {
            log::warn!(
                "[WAL Reader] SLOW _read_entry: {}ms (checksum_read: {}μs, length_read: {}μs, data_setup: {}μs, decompress: {}ms, crc_verify: {}μs, validation: {}μs), data_len: {}, compressed_len: {}",
                total_duration.as_millis(),
                checksum_read_duration.as_micros(),
                length_read_duration.as_micros(),
                data_read_setup_duration.as_micros(),
                decompress_duration.as_millis(),
                crc_verify_duration.as_micros(),
                validation_duration.as_micros(),
                data.len(),
                expected_len
            );
        } else if total_duration.as_millis() > 10 {
            log::info!(
                "[WAL Reader] _read_entry: {}ms (decompress: {}ms, crc_verify: {}μs) - data_len: {}, compressed_len: {}",
                total_duration.as_millis(),
                decompress_duration.as_millis(),
                crc_verify_duration.as_micros(),
                data.len(),
                expected_len
            );
        }

        Ok((Some(data), actual_compressed_len))
    }

    pub fn header(&self) -> &FileHeader {
        &self.header
    }
}

struct CrcReader<R> {
    inner: R,
    hasher: Hasher,
    bytes_seen: u64,
}

impl<R> CrcReader<R> {
    fn new(inner: R) -> Self {
        let hasher = Hasher::default();
        Self {
            inner,
            hasher,
            bytes_seen: 0,
        }
    }

    fn checksum(self) -> (u64, u32) {
        (self.bytes_seen, self.hasher.finalize())
    }
}

impl<R> Read for CrcReader<R>
where
    R: Read,
{
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let len = self.inner.read(buf)?;
        let len_u64 = u64::try_from(len).expect("Only designed to run on 32-bit systems or higher");

        self.bytes_seen += len_u64;
        self.hasher.update(&buf[..len]);
        Ok(len)
    }
}

#[cfg(test)]
mod tests {
    use std::{io::Read, path::PathBuf};

    use super::*;

    #[test]
    fn test_reader_new_stores_path_and_header() {
        let path = PathBuf::from("/tmp/test.wal");
        let cursor = std::io::Cursor::new(vec![]);
        let mut header = HashMap::new();
        header.insert("key".to_string(), "val".to_string());
        let reader = Reader::new(path.clone(), cursor, header.clone());
        assert_eq!(reader.path(), &path);
        assert_eq!(reader.header(), &header);
    }

    #[test]
    fn test_crc_reader_empty_has_zero_bytes() {
        let cursor = std::io::Cursor::new(Vec::<u8>::new());
        let crc_reader = CrcReader::new(cursor);
        let (bytes, _checksum) = crc_reader.checksum();
        assert_eq!(bytes, 0);
    }

    #[test]
    fn test_crc_reader_counts_bytes_read() {
        let data = b"hello world";
        let cursor = std::io::Cursor::new(data.to_vec());
        let mut crc_reader = CrcReader::new(cursor);
        let mut buf = vec![0u8; data.len()];
        crc_reader.read_exact(&mut buf).unwrap();
        let (bytes, _checksum) = crc_reader.checksum();
        assert_eq!(bytes, data.len() as u64);
        assert_eq!(&buf, data);
    }

    #[test]
    fn test_crc_reader_same_data_same_checksum() {
        let make_checksum = |data: &[u8]| -> u32 {
            let cursor = std::io::Cursor::new(data.to_vec());
            let mut crc_reader = CrcReader::new(cursor);
            let mut buf = vec![0u8; data.len()];
            let _ = crc_reader.read_exact(&mut buf);
            crc_reader.checksum().1
        };
        assert_eq!(make_checksum(b"test"), make_checksum(b"test"));
        assert_ne!(make_checksum(b"test"), make_checksum(b"TEST"));
    }

    #[test]
    fn test_deserialize_header_empty() {
        let result = Reader::<std::io::BufReader<std::fs::File>>::deserialize_header(&[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_deserialize_header_single_entry() {
        // Manually encode {"k": "v"}:
        // key_len=1: [0,0,0,1], key="k": [107], val_len=1: [0,0,0,1], val="v": [118]
        let bytes: &[u8] = &[0, 0, 0, 1, b'k', 0, 0, 0, 1, b'v'];
        let result =
            Reader::<std::io::BufReader<std::fs::File>>::deserialize_header(bytes).unwrap();
        assert_eq!(result.get("k"), Some(&"v".to_string()));
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_from_path_roundtrip_no_header() {
        use std::path::PathBuf;

        use crate::writer::Writer;

        let dir = tempfile::tempdir().unwrap();
        let path: PathBuf = dir.path().join("roundtrip.wal");
        let p: &std::path::Path = path.as_path();
        let (mut writer, _) = Writer::new(p, 0, 4096, None).unwrap();
        writer.write(b"hello wal").unwrap();
        writer.sync().unwrap();
        drop(writer);

        let mut reader = Reader::from_path(path.clone()).unwrap();
        assert_eq!(reader.path(), &path);
        let entry = reader.read_entry().unwrap();
        assert_eq!(entry, Some(b"hello wal".to_vec()));
    }

    #[test]
    fn test_from_path_roundtrip_with_header() {
        use crate::writer::Writer;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("with_header.wal");
        let p: &std::path::Path = path.as_path();
        let mut header = HashMap::new();
        header.insert("stream".to_string(), "test".to_string());
        let (mut writer, _) = Writer::new(p, 0, 4096, Some(header)).unwrap();
        writer.write(b"data with header").unwrap();
        writer.sync().unwrap();
        drop(writer);

        let mut reader = Reader::from_path(path).unwrap();
        assert_eq!(reader.header().get("stream"), Some(&"test".to_string()));
        let entry = reader.read_entry().unwrap();
        assert_eq!(entry, Some(b"data with header".to_vec()));
    }

    #[test]
    fn test_from_path_read_entry_with_length() {
        use crate::writer::Writer;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("len_test.wal");
        let p: &std::path::Path = path.as_path();
        let (mut writer, _) = Writer::new(p, 0, 4096, None).unwrap();
        writer.write(b"len check").unwrap();
        writer.sync().unwrap();
        drop(writer);

        let mut reader = Reader::from_path(path).unwrap();
        let (data, compressed_len) = reader.read_entry_with_length().unwrap();
        assert_eq!(data, Some(b"len check".to_vec()));
        assert!(compressed_len > 0);
    }

    #[test]
    fn test_from_path_current_position_advances() {
        use crate::writer::Writer;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pos_test.wal");
        let p: &std::path::Path = path.as_path();
        let (mut writer, _) = Writer::new(p, 0, 4096, None).unwrap();
        writer.write(b"position test").unwrap();
        writer.sync().unwrap();
        drop(writer);

        let mut reader = Reader::from_path(path).unwrap();
        let pos_before = reader.current_position().unwrap();
        reader.read_entry().unwrap();
        let pos_after = reader.current_position().unwrap();
        assert!(pos_after > pos_before);
    }
}
