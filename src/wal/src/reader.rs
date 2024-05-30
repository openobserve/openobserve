// Copyright 2024 Zinc Labs Inc.
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
    fs::File,
    io::{self, BufReader, Read},
    path::PathBuf,
};

use byteorder::{BigEndian, ReadBytesExt};
use crc32fast::Hasher;
use snafu::{ensure, ResultExt};

use crate::errors::*;

pub struct Reader<R> {
    path: PathBuf,
    f: R,
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
            &buf == super::FILE_TYPE_IDENTIFIER,
            FileIdentifierMismatchSnafu,
        );

        Ok(Self::new(path, f))
    }
}

impl<R> Reader<R>
where
    R: Read,
{
    pub fn new(path: PathBuf, f: R) -> Self {
        Self { path, f }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    // read entry from the wal file
    pub fn read_entry(&mut self) -> Result<Option<Vec<u8>>> {
        let expected_checksum = match self.f.read_u32::<BigEndian>() {
            Err(ref e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            other => other.context(UnableToReadChecksumSnafu)?,
        };
        if expected_checksum == 0 {
            return Ok(None);
        }

        let expected_len = self
            .f
            .read_u32::<BigEndian>()
            .context(UnableToReadLengthSnafu)?
            .into();
        if expected_len == 0 {
            return Ok(Some(vec![]));
        }

        let compressed_read = self.f.by_ref().take(expected_len);
        let hashing_read = CrcReader::new(compressed_read);
        let mut decompressing_read = snap::read::FrameDecoder::new(hashing_read);

        let mut data = Vec::with_capacity(1024);
        decompressing_read
            .read_to_end(&mut data)
            .context(UnableToReadDataSnafu)?;

        let (actual_compressed_len, actual_checksum) = decompressing_read.into_inner().checksum();

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

        Ok(Some(data))
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
