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

use super::BlockMeta;

#[derive(Debug)]
pub struct BlockDirectory {
    entries: Box<[PackedBlock]>,
    strict: Box<[u8]>,
    rows: u64,
    blocks_end: u64,
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
            .map_or(self.blocks_end, |next| next.block_offset);
        BlockMeta {
            hash: entry.hash,
            row_start: entry.row_start,
            row_count: u32::try_from(next_row - entry.row_start).expect("validated block row span"),
            min_timestamp: entry.min_timestamp,
            max_timestamp: entry.max_timestamp,
            block_offset: entry.block_offset,
            block_length: u32::try_from(next_offset - entry.block_offset)
                .expect("validated block byte span"),
            strictly_increasing: self.strict[index / 8] & (1 << (index % 8)) != 0,
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
    block_offset: u64,
}

pub(crate) struct DirectoryBuilder {
    entries: Vec<PackedBlock>,
    strict: Vec<u8>,
    rows: u64,
    blocks_end: u64,
}

impl DirectoryBuilder {
    pub(crate) fn new(count: usize, rows: u64, blocks_end: u64) -> Self {
        Self {
            entries: Vec::with_capacity(count),
            strict: vec![0; count.div_ceil(8)],
            rows,
            blocks_end,
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
            block_offset: block.block_offset,
        });
    }

    pub(crate) fn finish(self) -> BlockDirectory {
        BlockDirectory {
            entries: self.entries.into_boxed_slice(),
            strict: self.strict.into_boxed_slice(),
            rows: self.rows,
            blocks_end: self.blocks_end,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packed_directory_preserves_full_width_fields_and_derived_spans() {
        assert_eq!(std::mem::size_of::<PackedBlock>(), 40);
        let input = [
            BlockMeta {
                hash: u64::MAX - 1,
                row_start: 0,
                row_count: 3,
                min_timestamp: i64::MIN,
                max_timestamp: i64::MAX,
                block_offset: 0,
                block_length: u32::MAX,
                strictly_increasing: false,
            },
            BlockMeta {
                hash: u64::MAX,
                row_start: 3,
                row_count: u32::MAX,
                min_timestamp: i64::MAX,
                max_timestamp: i64::MAX,
                block_offset: u64::from(u32::MAX),
                block_length: u32::MAX,
                strictly_increasing: true,
            },
        ];
        let mut builder =
            DirectoryBuilder::new(2, 3 + u64::from(u32::MAX), 2 * u64::from(u32::MAX));
        for block in input.clone() {
            builder.push(block);
        }
        let directory = builder.finish();
        assert_eq!(directory.iter().collect::<Vec<_>>(), input);
        let row_shift = u64::MAX - (3 + u64::from(u32::MAX));
        let offset_shift = u64::MAX - 2 * u64::from(u32::MAX);
        let shifted = input.map(|mut block| {
            block.row_start += row_shift;
            block.block_offset += offset_shift;
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
    }
}
