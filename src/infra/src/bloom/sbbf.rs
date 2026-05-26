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

//! Split-Block Bloom Filter (SBBF) — minimal in-house implementation.
//!
//! The Parquet bloom-filter crate ships an `Sbbf` type whose only public
//! check path requires materializing the full bitset in memory. For a
//! single-point check that the spec only needs **32 bytes** for, that
//! pulls in megabytes of bitmap per query. We therefore re-implement the
//! spec — it's small and stable — so a point check runs over **just one
//! 32-byte block** ([`check_block`]) without ever loading the rest of the
//! bitmap. (In the transposed `.bf` layout the reader range-reads one row
//! of blocks per group and then runs this 32-byte check per file.)
//!
//! Self-consistent: writer and reader use the same `SALT` constants,
//! the same `gxhash64(seed=0)` from `config::utils::hash`, the same
//! fastmap block-index function. The on-disk body is just
//! `num_blocks × 32` raw little-endian bytes — no thrift header, no
//! framing.
//!
//! **Hash choice note**: we deviate from the Parquet spec on hash
//! function (Parquet specifies XxHash64). We don't interop with any
//! external SBBF reader — only our own writer/reader pair — so the only
//! requirement is that the same hash runs on both sides of the binary,
//! which `gxhash` satisfies. We reuse the codebase's existing
//! `config::utils::hash` rather than pulling in a separate xxhash crate.
//!
//! Reference: Apache Parquet bloom-filter spec (block layout only)
//! <https://github.com/apache/parquet-format/blob/master/BloomFilter.md>.

/// One SBBF block is 8 × u32 words = 32 bytes.
pub const BLOCK_BYTES: usize = 32;

/// Eight magic 32-bit primes from the Parquet bloom-filter spec. Each one
/// drives a separate "which bit within the block to set" calculation, so
/// every value sets 8 bits per block.
pub const SALT: [u32; 8] = [
    0x47b6137b, 0x44974d91, 0x8824ad5b, 0xa2b7289d, 0x705495c7, 0x2df1424b, 0x9efc4947, 0x5c6bfb31,
];

/// 64-bit hash used by both writer and reader. Reuses the project-wide
/// gxhash util — on platforms without the `gxhash` cargo feature (e.g.
/// Raspberry Pi without AES), this transparently degrades to
/// `DefaultHasher`. The writer and reader always run in the same
/// binary, so the two sides agree.
#[inline]
pub fn hash_value(value: &[u8]) -> u64 {
    config::utils::hash::sum64_bytes(value)
}

/// Map a hash to a block index using the "fastmap" trick from the spec:
/// `((hash >> 32) * num_blocks) >> 32`. Works for any `num_blocks`, not
/// just powers of two, and is far cheaper than a modulo.
#[inline]
pub fn block_index(hash: u64, num_blocks: u32) -> u32 {
    let high = hash >> 32;
    ((high * num_blocks as u64) >> 32) as u32
}

/// 8 single-bit masks computed from the lower 32 bits of `hash`. These are
/// the bits to set/check inside the chosen block — one per word.
///
/// The mask depends only on the hash, so in the transposed layout — where a
/// value maps to the same block index across every file in a group — it can
/// be computed **once per row** and reused for all files' blocks via
/// [`check_block_with_mask`], instead of recomputing it per file.
#[inline]
pub fn mask_from_hash(hash: u64) -> [u32; 8] {
    let key = hash as u32;
    let mut out = [0u32; 8];
    for i in 0..8 {
        let y = key.wrapping_mul(SALT[i]);
        out[i] = 1u32 << (y >> 27);
    }
    out
}

/// Decode a 32-byte SBBF block from raw little-endian bytes.
#[inline]
fn block_from_bytes(bytes: &[u8; BLOCK_BYTES]) -> [u32; 8] {
    let mut out = [0u32; 8];
    for (i, word) in out.iter_mut().enumerate() {
        let off = i * 4;
        *word = u32::from_le_bytes(bytes[off..off + 4].try_into().unwrap());
    }
    out
}

/// Single-block point check against a **precomputed mask**.
///
/// Reads each 32-bit word straight out of the 32-byte block and tests it
/// against the corresponding mask word — no intermediate `[u32; 8]` array.
/// Use this when checking many files' blocks for the same value: compute the
/// mask once with [`mask_from_hash`] and pass it here per block.
#[inline]
pub fn check_block_with_mask(block_bytes: &[u8; BLOCK_BYTES], mask: &[u32; 8]) -> bool {
    for (i, m) in mask.iter().enumerate() {
        let off = i * 4;
        let word = u32::from_le_bytes(block_bytes[off..off + 4].try_into().unwrap());
        if word & m != *m {
            return false;
        }
    }
    true
}

/// Single-block point check used by the search side.
///
/// Given just the **32 bytes of the chosen block** plus the original hash,
/// returns true iff the block has every required bit set. The caller is
/// responsible for fetching the block (e.g. via a range read on the `.bf`
/// body) and supplying the same `hash` that was used to pick the block.
/// For checking many files against one value, prefer computing the mask once
/// via [`mask_from_hash`] + [`check_block_with_mask`].
#[inline]
pub fn check_block(block_bytes: &[u8; BLOCK_BYTES], hash: u64) -> bool {
    check_block_with_mask(block_bytes, &mask_from_hash(hash))
}

/// Sizing helper. Returns the number of 32-byte SBBF blocks required to
/// hold `ndv` distinct items at the requested false-positive probability.
///
/// We round up to the next power of two so block-index math has the same
/// distribution as Parquet's own sizing (and so the on-disk size is
/// predictable across builds).
pub fn num_blocks_for(ndv: u64, fpp: f64) -> u32 {
    // Bits-per-element from the standard Bloom-filter formula. SBBF is
    // ~1.4x worse than a plain Bloom at the same FPR, but we follow the
    // Parquet sizing convention here so the on-disk layout matches what
    // the previous parquet-based writer produced.
    let ndv = ndv.max(1) as f64;
    let fpp = fpp.clamp(1e-12, 0.5);
    let bits = (-ndv * fpp.ln() / (std::f64::consts::LN_2 * std::f64::consts::LN_2)).ceil();
    let blocks_f = (bits / 256.0).ceil().max(1.0);
    // Round up to the next power of two.
    let mut blocks = blocks_f as u64;
    blocks = blocks.next_power_of_two();
    blocks.min(u32::MAX as u64) as u32
}

/// Builder-side SBBF: owns the bitset, supports `insert` + full `check`.
/// The reader side never instantiates this — it goes through
/// [`check_block`] on a single fetched block instead.
#[derive(Debug, Clone)]
pub struct Sbbf {
    blocks: Vec<[u32; 8]>,
}

impl Sbbf {
    /// Allocate an empty SBBF sized for `ndv` items at `fpp`.
    pub fn new_with_ndv_fpp(ndv: u64, fpp: f64) -> Self {
        Self::new_with_num_blocks(num_blocks_for(ndv, fpp))
    }

    /// Allocate an empty SBBF with an explicit block count. Used by the
    /// transposed `.bf` layout where every file in a group must share the
    /// same `num_blocks` so a single value maps to the same block index
    /// across all files (enabling one contiguous read per group).
    pub fn new_with_num_blocks(num_blocks: u32) -> Self {
        Self {
            blocks: vec![[0u32; 8]; num_blocks.max(1) as usize],
        }
    }

    /// Number of 32-byte blocks held.
    pub fn num_blocks(&self) -> u32 {
        self.blocks.len() as u32
    }

    /// Set the 8 bits for `value` in the chosen block.
    pub fn insert(&mut self, value: &[u8]) {
        let h = hash_value(value);
        let idx = block_index(h, self.num_blocks()) as usize;
        let mask = mask_from_hash(h);
        let block = &mut self.blocks[idx];
        for i in 0..8 {
            block[i] |= mask[i];
        }
    }

    /// Membership test. False = definitely absent, true = maybe present.
    pub fn check(&self, value: &[u8]) -> bool {
        let h = hash_value(value);
        let idx = block_index(h, self.num_blocks()) as usize;
        let mask = mask_from_hash(h);
        let block = &self.blocks[idx];
        for i in 0..8 {
            if block[i] & mask[i] != mask[i] {
                return false;
            }
        }
        true
    }

    /// Serialize the bitset to little-endian bytes — no header, no
    /// framing. Length is exactly `num_blocks × 32`.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.blocks.len() * BLOCK_BYTES);
        for block in &self.blocks {
            for word in block {
                out.extend_from_slice(&word.to_le_bytes());
            }
        }
        out
    }

    /// Parse from bytes produced by `to_bytes`. Used by tests; production
    /// readers go through [`check_block`] without materializing this struct.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.is_empty() || !bytes.len().is_multiple_of(BLOCK_BYTES) {
            return Err("SBBF bytes must be a non-zero multiple of 32");
        }
        let n = bytes.len() / BLOCK_BYTES;
        let mut blocks = Vec::with_capacity(n);
        for i in 0..n {
            let start = i * BLOCK_BYTES;
            let chunk: &[u8; BLOCK_BYTES] = bytes[start..start + BLOCK_BYTES].try_into().unwrap();
            blocks.push(block_from_bytes(chunk));
        }
        Ok(Self { blocks })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn num_blocks_matches_parquet_sizing() {
        // 1.69M items at 0.01 FPR → 65536 blocks = 2 MB body (matches the
        // user's data-bloom fixture, which the parquet-based writer produced).
        assert_eq!(num_blocks_for(1_687_010, 0.01), 65536);
    }

    #[test]
    fn num_blocks_minimum_is_one() {
        assert_eq!(num_blocks_for(0, 0.01), 1);
        assert_eq!(num_blocks_for(1, 0.01), 1);
    }

    #[test]
    fn insert_then_check_round_trips() {
        let mut s = Sbbf::new_with_ndv_fpp(10_000, 0.01);
        for i in 0..1000u32 {
            s.insert(format!("trace-{i}").as_bytes());
        }
        for i in 0..1000u32 {
            assert!(
                s.check(format!("trace-{i}").as_bytes()),
                "inserted value missing: trace-{i}"
            );
        }
    }

    #[test]
    fn check_block_agrees_with_check() {
        let mut s = Sbbf::new_with_ndv_fpp(10_000, 0.01);
        let values: Vec<String> = (0..500).map(|i| format!("v-{i}")).collect();
        for v in &values {
            s.insert(v.as_bytes());
        }
        let bytes = s.to_bytes();
        let num_blocks = s.num_blocks();
        // Every inserted value must agree between full `check` and the
        // single-block path that the reader uses.
        for v in &values {
            let h = hash_value(v.as_bytes());
            let bi = block_index(h, num_blocks) as usize;
            let off = bi * BLOCK_BYTES;
            let block: &[u8; BLOCK_BYTES] = bytes[off..off + BLOCK_BYTES].try_into().unwrap();
            assert!(check_block(block, h), "single-block check missed {v}");
            assert!(s.check(v.as_bytes()));
        }
    }

    #[test]
    fn check_block_false_for_random_misses_at_fpr() {
        let mut s = Sbbf::new_with_ndv_fpp(10_000, 0.01);
        for i in 0..10_000u32 {
            s.insert(format!("in-{i}").as_bytes());
        }
        let bytes = s.to_bytes();
        let num_blocks = s.num_blocks();
        let total = 5000;
        let mut false_positives = 0;
        for i in 0..total {
            let v = format!("miss-{i}");
            let h = hash_value(v.as_bytes());
            let bi = block_index(h, num_blocks) as usize;
            let off = bi * BLOCK_BYTES;
            let block: &[u8; BLOCK_BYTES] = bytes[off..off + BLOCK_BYTES].try_into().unwrap();
            if check_block(block, h) {
                false_positives += 1;
            }
        }
        // SBBF FPR at the configured 0.01 is loose; allow 3× headroom on
        // the small sample.
        assert!(
            false_positives < total / 30,
            "too many false positives: {false_positives}/{total}"
        );
    }

    #[test]
    fn to_from_bytes_round_trips() {
        let mut s = Sbbf::new_with_ndv_fpp(1024, 0.01);
        s.insert(b"abc");
        s.insert(b"def");
        let bytes = s.to_bytes();
        let s2 = Sbbf::from_bytes(&bytes).unwrap();
        assert!(s2.check(b"abc"));
        assert!(s2.check(b"def"));
    }

    #[test]
    fn from_bytes_rejects_bad_length() {
        assert!(Sbbf::from_bytes(&[0u8; 31]).is_err());
        assert!(Sbbf::from_bytes(&[]).is_err());
    }
}
