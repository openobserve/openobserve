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

use bitpacking::{BitPacker, BitPacker4x};

const BLOCK_LEN: usize = BitPacker4x::BLOCK_LEN; // 128

/// A compact, immutable set of sorted row ids.
///
/// Ids are delta-encoded and bit-packed in blocks of 128 (the same scheme
/// tantivy uses for posting lists): each block stores a 1-byte bit width
/// followed by 128 deltas packed at that width. A trailing partial block is
/// stored as raw little-endian u32s. Dense selections cost ~1-2 bits per id,
/// sparse ones ~log2(gap) bits; the worst case equals a plain `Vec<u32>`.
///
/// The encoding is forward-iteration only, which is all the access-plan
/// builders need.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PackedRowIds {
    count: usize,
    last: u32,
    buf: Vec<u8>,
}

impl PackedRowIds {
    /// Pack a slice of strictly increasing row ids.
    pub fn from_sorted(ids: &[u32]) -> Self {
        debug_assert!(ids.windows(2).all(|w| w[0] < w[1]), "ids must be strictly increasing");
        if ids.is_empty() {
            return Self::default();
        }
        let bp = BitPacker4x::new();
        let mut buf = Vec::with_capacity(ids.len() / 2 + 16);
        let mut tmp = [0u8; 4 * BLOCK_LEN];
        let mut initial = 0u32;
        let mut chunks = ids.chunks_exact(BLOCK_LEN);
        for block in &mut chunks {
            let num_bits = bp.num_bits_sorted(initial, block);
            buf.push(num_bits);
            let written = bp.compress_sorted(initial, block, &mut tmp, num_bits);
            buf.extend_from_slice(&tmp[..written]);
            initial = block[BLOCK_LEN - 1];
        }
        for &id in chunks.remainder() {
            buf.extend_from_slice(&id.to_le_bytes());
        }
        buf.shrink_to_fit();
        Self {
            count: ids.len(),
            last: *ids.last().unwrap(),
            buf,
        }
    }

    pub fn len(&self) -> usize {
        self.count
    }

    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// The largest id in the set.
    pub fn last(&self) -> Option<u32> {
        (self.count > 0).then_some(self.last)
    }

    /// Iterate the ids in ascending order.
    pub fn iter(&self) -> PackedRowIdsIter<'_> {
        PackedRowIdsIter {
            bp: BitPacker4x::new(),
            buf: &self.buf,
            pos: 0,
            remaining: self.count,
            block: [0; BLOCK_LEN],
            block_len: 0,
            block_pos: 0,
            initial: 0,
        }
    }

    pub fn memory_size(&self) -> usize {
        self.buf.capacity() + std::mem::size_of::<Self>()
    }
}

pub struct PackedRowIdsIter<'a> {
    bp: BitPacker4x,
    buf: &'a [u8],
    pos: usize,
    remaining: usize,
    block: [u32; BLOCK_LEN],
    block_len: usize,
    block_pos: usize,
    initial: u32,
}

impl Iterator for PackedRowIdsIter<'_> {
    type Item = u32;

    #[inline]
    fn next(&mut self) -> Option<u32> {
        if self.block_pos >= self.block_len {
            if self.remaining == 0 {
                return None;
            }
            if self.remaining >= BLOCK_LEN {
                let num_bits = self.buf[self.pos];
                self.pos += 1;
                let nbytes = num_bits as usize * BLOCK_LEN / 8;
                self.bp.decompress_sorted(
                    self.initial,
                    &self.buf[self.pos..self.pos + nbytes],
                    &mut self.block,
                    num_bits,
                );
                self.pos += nbytes;
                self.initial = self.block[BLOCK_LEN - 1];
                self.block_len = BLOCK_LEN;
            } else {
                // trailing partial block, stored as raw u32s
                for slot in self.block.iter_mut().take(self.remaining) {
                    *slot = u32::from_le_bytes(
                        self.buf[self.pos..self.pos + 4].try_into().unwrap(),
                    );
                    self.pos += 4;
                }
                self.block_len = self.remaining;
            }
            self.block_pos = 0;
        }
        let v = self.block[self.block_pos];
        self.block_pos += 1;
        self.remaining -= 1;
        Some(v)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining, Some(self.remaining))
    }
}

impl ExactSizeIterator for PackedRowIdsIter<'_> {}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(ids: &[u32]) {
        let packed = PackedRowIds::from_sorted(ids);
        assert_eq!(packed.len(), ids.len());
        assert_eq!(packed.last(), ids.last().copied());
        assert_eq!(packed.iter().collect::<Vec<_>>(), ids);
    }

    #[test]
    fn test_empty() {
        roundtrip(&[]);
        assert!(PackedRowIds::from_sorted(&[]).is_empty());
    }

    #[test]
    fn test_partial_block_only() {
        roundtrip(&[0]);
        roundtrip(&[42]);
        roundtrip(&(0..127).collect::<Vec<_>>());
    }

    #[test]
    fn test_exact_blocks() {
        roundtrip(&(0..128).collect::<Vec<_>>());
        roundtrip(&(0..256).map(|i| i * 7).collect::<Vec<_>>());
    }

    #[test]
    fn test_blocks_with_remainder() {
        roundtrip(&(0..1000).map(|i| i * 3 + 1).collect::<Vec<_>>());
    }

    #[test]
    fn test_large_gaps() {
        roundtrip(&[0, 1, u32::MAX / 2, u32::MAX - 1]);
        let ids: Vec<u32> = (0..500).map(|i| i * 1_000_000).collect();
        roundtrip(&ids);
    }

    #[test]
    fn test_dense_is_compact() {
        // consecutive ids: deltas of 1 pack at 1 bit each
        let ids: Vec<u32> = (1_000_000..1_100_000).collect();
        let packed = PackedRowIds::from_sorted(&ids);
        assert_eq!(packed.iter().collect::<Vec<_>>(), ids);
        // 100k ids at ~1 bit/id ≈ 13KB; plain Vec<u32> is 400KB
        assert!(packed.memory_size() < 20 * 1024, "got {}", packed.memory_size());
    }
}
