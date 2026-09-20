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

use std::ops::Range;

use crate::BlockMeta;

#[derive(Debug)]
pub struct BlockDirectory {
    entries: Box<[PackedBlock]>,
    strict: Box<[u8]>,
    rows: u64,
    payload_end: u64,
}

impl BlockDirectory {
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[inline]
    pub fn block(&self, index: usize) -> BlockMeta {
        let entry = self.entries[index];
        let next_row = self
            .entries
            .get(index + 1)
            .map_or(self.rows, |next| next.row_start);
        let next_offset = self
            .entries
            .get(index + 1)
            .map_or(self.payload_end, |next| next.payload_offset);
        BlockMeta {
            hash: entry.hash,
            row_start: entry.row_start,
            row_count: u32::try_from(next_row - entry.row_start).expect("validated block row span"),
            min_timestamp: entry.min_timestamp,
            max_timestamp: entry.max_timestamp,
            payload_offset: entry.payload_offset,
            payload_len: u32::try_from(next_offset - entry.payload_offset)
                .expect("validated block payload span"),
            strictly_increasing: self.strict[index / 8] & (1 << (index % 8)) != 0,
            checksum: entry.checksum,
        }
    }

    #[inline]
    pub fn row_counts(&self) -> impl ExactSizeIterator<Item = u32> + '_ {
        self.entries.iter().enumerate().map(|(index, entry)| {
            let next = self
                .entries
                .get(index + 1)
                .map_or(self.rows, |next| next.row_start);
            u32::try_from(next - entry.row_start).expect("validated block row span")
        })
    }

    pub fn row_boundary(&self, row: u64) -> Result<usize, usize> {
        self.entries
            .binary_search_by_key(&row, |entry| entry.row_start)
    }

    pub fn hash_partition_point(&self, mut predicate: impl FnMut(u64) -> bool) -> usize {
        self.entries.partition_point(|entry| predicate(entry.hash))
    }

    pub fn iter(&self) -> BlockIter<'_> {
        self.range(0..self.len())
    }

    pub fn range(&self, range: Range<usize>) -> BlockIter<'_> {
        assert!(range.start <= range.end && range.end <= self.len());
        BlockIter {
            directory: self,
            range,
        }
    }

    pub fn allocated_bytes(&self) -> usize {
        std::mem::size_of_val(self.entries.as_ref()).saturating_add(self.strict.len())
    }

    #[inline]
    pub(crate) fn row_start(&self, index: usize) -> u64 {
        self.entries[index].row_start
    }

    #[inline]
    pub(crate) fn hash(&self, index: usize) -> u64 {
        self.entries[index].hash
    }

    #[inline]
    pub(crate) fn overlaps_time(&self, index: usize, lo: i64, hi: i64) -> bool {
        let entry = self.entries[index];
        lo <= hi && entry.min_timestamp <= hi && entry.max_timestamp >= lo
    }
}

impl<'a> IntoIterator for &'a BlockDirectory {
    type Item = BlockMeta;
    type IntoIter = BlockIter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

#[derive(Clone)]
pub struct BlockIter<'a> {
    directory: &'a BlockDirectory,
    range: Range<usize>,
}

impl Iterator for BlockIter<'_> {
    type Item = BlockMeta;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        self.range.next().map(|index| self.directory.block(index))
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.range.size_hint()
    }
}

impl ExactSizeIterator for BlockIter<'_> {}

#[repr(C, packed)]
#[derive(Clone, Copy, Debug)]
struct PackedBlock {
    hash: u64,
    row_start: u64,
    min_timestamp: i64,
    max_timestamp: i64,
    payload_offset: u64,
    checksum: [u8; 32],
}

pub(crate) struct DirectoryBuilder {
    entries: Vec<PackedBlock>,
    strict: Vec<u8>,
    rows: u64,
    payload_end: u64,
}

impl DirectoryBuilder {
    pub(crate) fn new(count: usize, rows: u64, payload_end: u64) -> Self {
        Self {
            entries: Vec::with_capacity(count),
            strict: vec![0; count.div_ceil(8)],
            rows,
            payload_end,
        }
    }

    pub(crate) fn push(&mut self, block: BlockMeta) {
        let index = self.entries.len();
        if block.strictly_increasing {
            self.strict[index / 8] |= 1 << (index % 8);
        }
        self.entries.push(PackedBlock {
            hash: block.hash,
            row_start: block.row_start,
            min_timestamp: block.min_timestamp,
            max_timestamp: block.max_timestamp,
            payload_offset: block.payload_offset,
            checksum: block.checksum,
        });
    }

    pub(crate) fn finish(self) -> BlockDirectory {
        BlockDirectory {
            entries: self.entries.into_boxed_slice(),
            strict: self.strict.into_boxed_slice(),
            rows: self.rows,
            payload_end: self.payload_end,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packed_directory_preserves_full_width_fields_and_derived_spans() {
        assert_eq!(std::mem::size_of::<PackedBlock>(), 72);
        let input = [
            BlockMeta {
                hash: u64::MAX - 1,
                row_start: 0,
                row_count: 3,
                min_timestamp: i64::MIN,
                max_timestamp: i64::MAX,
                payload_offset: 0,
                payload_len: u32::MAX,
                strictly_increasing: false,
                checksum: [0xa5; 32],
            },
            BlockMeta {
                hash: u64::MAX,
                row_start: 3,
                row_count: u32::MAX,
                min_timestamp: i64::MAX,
                max_timestamp: i64::MAX,
                payload_offset: u64::from(u32::MAX),
                payload_len: u32::MAX,
                strictly_increasing: true,
                checksum: [0x5a; 32],
            },
        ];
        let mut builder =
            DirectoryBuilder::new(2, 3 + u64::from(u32::MAX), 2 * u64::from(u32::MAX));
        for block in input.clone() {
            builder.push(block);
        }
        let directory = builder.finish();
        assert_eq!(directory.iter().collect::<Vec<_>>(), input);
        assert_eq!(directory.allocated_bytes(), 145);
        assert_eq!(directory.row_boundary(3), Ok(1));
        assert_eq!(directory.row_boundary(2), Err(1));
        assert_eq!(directory.hash_partition_point(|hash| hash < u64::MAX), 1);
        let row_shift = u64::MAX - (3 + u64::from(u32::MAX));
        let offset_shift = u64::MAX - 2 * u64::from(u32::MAX);
        let shifted = input.map(|mut block| {
            block.row_start += row_shift;
            block.payload_offset += offset_shift;
            block
        });
        let mut builder = DirectoryBuilder::new(2, u64::MAX, u64::MAX);
        for block in shifted.clone() {
            builder.push(block);
        }
        let directory = builder.finish();
        assert_eq!(directory.iter().collect::<Vec<_>>(), shifted);
        assert_eq!(
            directory.row_counts().collect::<Vec<_>>(),
            shifted
                .iter()
                .map(|block| block.row_count)
                .collect::<Vec<_>>()
        );
        assert_eq!(directory.row_start(1), shifted[1].row_start);
        assert_eq!(directory.hash(1), u64::MAX);
        assert!(directory.overlaps_time(0, i64::MIN, i64::MAX));
        assert!(!directory.overlaps_time(1, i64::MIN, i64::MAX - 1));
        assert!(!directory.overlaps_time(0, 1, 0));
        assert_eq!(
            directory.row_boundary(u64::MAX - u64::from(u32::MAX)),
            Ok(1)
        );
    }
}
