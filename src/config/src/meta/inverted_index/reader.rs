// Copyright 2024 OpenObserve Inc.
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
/// Reader to parse decompressed raw bytes read from file system into memory for the search
/// interface
use std::{io::SeekFrom, sync::Arc};

use anyhow::{anyhow, Result};
use futures::{io::Cursor, AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt};

use super::{ColumnIndexMeta, INDEX_FILE_METAS_SIZE_SIZE};
use crate::{
    meta::{bitvec::BitVec, puffin::reader::PuffinBytesReader},
    utils::inverted_index::unpack_u32_pair,
};

/// Index reader helps read Index Blob which consists of multiple ColumnIndex.
pub struct IndexReader<R> {
    source: PuffinBytesReader<R>,
}

impl<R: AsyncRead + AsyncSeek + Unpin + Send> IndexReader<R> {
    pub fn new(source: R) -> Self {
        Self {
            source: PuffinBytesReader::new(source),
        }
    }

    pub async fn field(&mut self, field: &str) -> Result<Option<FieldReader>> {
        let Some(field_metdata) = self.source.get_field(field).await? else {
            return Ok(None);
        };
        let blob_bytes = self.source.read_blob_bytes(&field_metdata).await?;
        let data = Cursor::new(blob_bytes);
        Ok(Some(FieldReader::new(data)))
    }
}

pub struct FieldReader {
    source: Cursor<Vec<u8>>,
}

impl FieldReader {
    pub fn new(source: Cursor<Vec<u8>>) -> Self {
        Self { source }
    }

    /// Reads and parse the bytes read from source to construct [`IndexFileMetas`].
    /// IndexFileMetas is used to find and read ColumnIndex for a particular column.
    pub async fn metadata(&mut self) -> Result<Arc<ColumnIndexMeta>> {
        let end_offset = self.source.seek(SeekFrom::End(0)).await?;

        // read index_size
        let index_file_metas_size_offset = SeekFrom::Start(end_offset - INDEX_FILE_METAS_SIZE_SIZE);
        self.source.seek(index_file_metas_size_offset).await?;
        let index_file_metas_size_buf = &mut [0u8; INDEX_FILE_METAS_SIZE_SIZE as usize];
        self.source.read_exact(index_file_metas_size_buf).await?;
        let index_file_metas_size = u32::from_le_bytes(*index_file_metas_size_buf) as u64;

        // read column index meta
        let index_file_metas_offset =
            SeekFrom::Start(end_offset - INDEX_FILE_METAS_SIZE_SIZE - index_file_metas_size);
        self.source.seek(index_file_metas_offset).await?;
        let index_file_metas_buf = &mut vec![0u8; index_file_metas_size as usize];
        self.source.read_exact(index_file_metas_buf).await?;

        let column_meta: ColumnIndexMeta = serde_json::from_slice(index_file_metas_buf)?;

        Ok(Arc::new(column_meta))
    }

    pub async fn fst(&mut self, offset: u64, size: u32) -> Result<fst::Map<Vec<u8>>> {
        let fst_buf = self.seek_read(offset, size).await?;
        fst::Map::new(fst_buf).map_err(|e| {
            anyhow!(
                "Error constructing FST Map from read bytes {}",
                e.to_string()
            )
        })
    }

    pub async fn get_bitmap(&mut self, fst_val: u64) -> Result<BitVec> {
        let (relative_offset, size) = unpack_u32_pair(fst_val);
        self.bitmap(relative_offset as u64, size).await
    }

    async fn bitmap(&mut self, offset: u64, size: u32) -> Result<BitVec> {
        self.seek_read(offset, size).await.map(BitVec::from_vec)
    }

    async fn seek_read(&mut self, offset: u64, size: u32) -> Result<Vec<u8>> {
        self.source.seek(SeekFrom::Start(offset)).await?;
        let mut buf = vec![0u8; size as usize];
        self.source.read_exact(&mut buf).await?;
        Ok(buf)
    }
}

/// An automaton that matches if the input contains to a specific string.
///
/// ```rust
/// extern crate fst;
///
/// use fst::{automaton::Contains, Automaton, IntoStreamer, Set, Streamer};
///
/// # fn main() { example().unwrap(); }
/// fn example() -> Result<(), Box<dyn std::error::Error>> {
///     let paths = vec!["/home/projects/bar", "/home/projects/foo", "/tmp/foo"];
///     let set = Set::from_iter(paths)?;
///
///     // Build our contains query.
///     let keyword = Contains::new("/projects");
///
///     // Apply our query to the set we built.
///     let mut stream = set.search(keyword).into_stream();
///
///     let matches = stream.into_strs()?;
///     assert_eq!(matches, vec!["/home/projects/bar", "/home/projects/foo"]);
///     Ok(())
/// }
/// ```
#[derive(Clone, Debug)]
pub struct Contains<'a> {
    string: &'a [u8],
}

impl<'a> Contains<'a> {
    /// Constructs automaton that matches a part of string.
    #[inline]
    pub fn new(string: &'a str) -> Contains<'a> {
        Self {
            string: string.as_bytes(),
        }
    }
}

impl<'a> fst::automaton::Automaton for Contains<'a> {
    type State = Option<usize>;

    #[inline]
    fn start(&self) -> Option<usize> {
        Some(0)
    }

    #[inline]
    fn is_match(&self, pos: &Option<usize>) -> bool {
        pos.is_some() && pos.unwrap() >= self.string.len()
    }

    #[inline]
    fn can_match(&self, pos: &Option<usize>) -> bool {
        pos.is_some()
    }

    #[inline]
    fn accept(&self, pos: &Option<usize>, byte: u8) -> Option<usize> {
        // if we aren't already past the end...
        if let Some(pos) = *pos {
            // and there is still a matching byte at the current position...
            if self.string.get(pos).cloned() == Some(byte) {
                // then move forward
                return Some(pos + 1);
            } else if pos >= self.string.len() {
                // if we're past the end, then we're done
                return Some(i32::MAX as usize);
            } else {
                return Some(0);
            }
        }
        // otherwise we're either past the end or didn't match the byte
        None
    }
}
