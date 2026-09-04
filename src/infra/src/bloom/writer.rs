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

//! `.bf` file writer — **transposed (block-major) layout**.
//!
//! Every file in a (stream, hour, bloom_ver) group shares the same
//! `num_blocks = B` for a given field. Because `block_index =
//! fastmap(hash(value), B)` only depends on `B`, a single query value
//! maps to the **same block index `bi` across all files**. So if we lay
//! the bodies out block-major — all files' block 0, then all files'
//! block 1, … — the blocks a query needs (one per file) form a single
//! contiguous row at `bi`. The search side then reads **one contiguous
//! range of `M × 32` bytes per group** instead of one tiny range per
//! file.
//!
//! ```text
//! body for a field with M files, B blocks each:
//!   row 0 : [ f0.block0 ][ f1.block0 ] … [ f(M-1).block0 ]   (M × 32 B)
//!   row 1 : [ f0.block1 ][ f1.block1 ] … [ f(M-1).block1 ]
//!   …
//!   row B-1: …
//! ```

use std::io::Write;

use super::{
    ALGO_SBBF_GXHASH, MAGIC, VERSION,
    sbbf::{BLOCK_BYTES, Sbbf},
};

/// Default false-positive probability for new SBBFs.
const DEFAULT_FPP: f64 = 0.01;

/// Bounds-check errors caught when packing a `.bf` footer.
#[derive(Debug, thiserror::Error)]
pub enum WriteError {
    #[error("field name '{name}' is too long: {len} bytes (max u16::MAX)")]
    FieldNameTooLong { name: String, len: usize },
    #[error("too many fields: {0} (max u32::MAX)")]
    TooManyFields(usize),
    #[error("too many files for field '{field}': {count} (max u32::MAX)")]
    TooManyFiles { field: String, count: usize },
    #[error(
        "non-uniform num_blocks for field '{field}': file_id {file_id} has {got} blocks, expected {expected} (transposed layout requires uniform B per group)"
    )]
    NonUniformBlocks {
        field: String,
        file_id: u64,
        got: u32,
        expected: u32,
    },
    #[error("num_blocks for field '{0}' too large: {1} (max u32::MAX)")]
    TooManyBlocks(String, u64),
}

/// One bloom for a single (file, field) pair, fully built in memory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldBloom {
    pub field: String,
    pub file_id: u64,
    pub n_items: u32,
    /// Raw SBBF bitset: exactly `num_blocks × 32` bytes. No header. All
    /// blooms of the same field in a group must have identical length.
    pub bytes: Vec<u8>,
}

/// Builder that accumulates `(field, file)` blooms before serialization.
/// Every bloom is created with an explicit, group-uniform `num_blocks`.
pub struct BloomBuilder {
    fpp: f64,
    filters: Vec<PerFieldFile>,
}

struct PerFieldFile {
    field: String,
    file_id: u64,
    sbbf: Sbbf,
    n_items: u32,
}

impl BloomBuilder {
    pub fn new() -> Self {
        Self {
            fpp: DEFAULT_FPP,
            filters: Vec::new(),
        }
    }

    /// Override the target FPR (only affects `begin`'s ndv-based sizing).
    pub fn with_fpp(mut self, fpp: f64) -> Self {
        self.fpp = fpp;
        self
    }

    /// Begin a bloom sized from `expected_items` at the builder's fpp.
    /// Prefer [`Self::begin_with_blocks`] for the transposed layout where
    /// the caller has already computed a group-uniform block count.
    pub fn begin(&mut self, file_id: u64, field: &str, expected_items: usize) -> usize {
        let ndv = expected_items.max(1) as u64;
        let sbbf = Sbbf::new_with_ndv_fpp(ndv, self.fpp);
        self.push(field, file_id, sbbf)
    }

    /// Begin a bloom with an explicit, group-uniform block count.
    pub fn begin_with_blocks(&mut self, file_id: u64, field: &str, num_blocks: u32) -> usize {
        let sbbf = Sbbf::new_with_num_blocks(num_blocks);
        self.push(field, file_id, sbbf)
    }

    fn push(&mut self, field: &str, file_id: u64, sbbf: Sbbf) -> usize {
        self.filters.push(PerFieldFile {
            field: field.to_string(),
            file_id,
            sbbf,
            n_items: 0,
        });
        self.filters.len() - 1
    }

    /// Insert raw bytes — gxhash64(seed=0) is applied inside `Sbbf::insert`.
    pub fn insert(&mut self, idx: usize, value: &[u8]) {
        let entry = &mut self.filters[idx];
        entry.sbbf.insert(value);
        entry.n_items = entry.n_items.saturating_add(1);
    }

    pub fn len(&self) -> usize {
        self.filters.len()
    }

    pub fn is_empty(&self) -> bool {
        self.filters.is_empty()
    }

    /// Freeze into an immutable list of `FieldBloom`s. Consumes the builder.
    pub fn finish(self) -> Vec<FieldBloom> {
        self.filters
            .into_iter()
            .map(|p| FieldBloom {
                field: p.field,
                file_id: p.file_id,
                n_items: p.n_items,
                bytes: p.sbbf.to_bytes(),
            })
            .collect()
    }
}

impl Default for BloomBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Layout-encoder for the transposed `.bf` body + footer + tail magic.
pub struct BloomWriter;

impl BloomWriter {
    /// Serialize a complete `.bf` blob. All blooms of the same field must
    /// share an identical `num_blocks` (= `bytes.len() / 32`); otherwise
    /// `WriteError::NonUniformBlocks` is returned.
    pub fn serialize(blooms: Vec<FieldBloom>) -> Result<Vec<u8>, WriteError> {
        // Group by field, preserving first-seen order.
        let mut field_order: Vec<String> = Vec::new();
        let mut by_field: hashbrown::HashMap<String, Vec<FieldBloom>> = hashbrown::HashMap::new();
        for b in blooms {
            if !by_field.contains_key(&b.field) {
                field_order.push(b.field.clone());
            }
            by_field.entry(b.field.clone()).or_default().push(b);
        }
        if field_order.len() > u32::MAX as usize {
            return Err(WriteError::TooManyFields(field_order.len()));
        }

        // Pre-size `out` to the exact final length. A chunk's body can be
        // hundreds of MB at high cardinality (M files × num_blocks × 32), and
        // letting `Vec` grow by doubling would transiently push the peak even
        // higher (up to ~2× the final body) and churn through reallocs.
        //
        //   head:   MAGIC(4) + VERSION(1)
        //   body:   Σ every bloom's bytes (each written exactly once)
        //   footer: field_count(4)
        //           + per field: name_len(2) + name + algo(1) + num_blocks(4)
        //                        + file_count(4) + body_offset(8) + 12×files
        //   tail:   footer_len(4) + MAGIC(4)
        let body_total: usize = by_field.values().flatten().map(|b| b.bytes.len()).sum();
        let footer_total: usize = 4 + field_order
            .iter()
            .map(|f| 2 + f.len() + 1 + 4 + 4 + 8 + by_field.get(f).map_or(0, Vec::len) * (8 + 4))
            .sum::<usize>();
        let total = 4 + 1 + body_total + footer_total + 4 + 4;

        let mut out = Vec::with_capacity(total);
        out.extend_from_slice(MAGIC);
        out.push(VERSION);

        struct FieldSection {
            name: String,
            num_blocks: u32,
            body_offset: u64,
            file_ids: Vec<u64>,
            n_items: Vec<u32>,
        }
        let mut sections: Vec<FieldSection> = Vec::with_capacity(field_order.len());

        for field in &field_order {
            let files = by_field.remove(field).unwrap();
            if files.len() > u32::MAX as usize {
                return Err(WriteError::TooManyFiles {
                    field: field.clone(),
                    count: files.len(),
                });
            }
            // Determine B from the first file; all others must match.
            let expected_len = files[0].bytes.len();
            let b_usize = expected_len / BLOCK_BYTES;
            if b_usize > u32::MAX as usize {
                return Err(WriteError::TooManyBlocks(field.clone(), b_usize as u64));
            }
            let num_blocks = b_usize as u32;
            for fb in &files {
                if fb.bytes.len() != expected_len {
                    return Err(WriteError::NonUniformBlocks {
                        field: field.clone(),
                        file_id: fb.file_id,
                        got: (fb.bytes.len() / BLOCK_BYTES) as u32,
                        expected: num_blocks,
                    });
                }
            }

            let body_offset = out.len() as u64;
            // Transpose: row j = concat of every file's block j.
            for j in 0..b_usize {
                let lo = j * BLOCK_BYTES;
                let hi = lo + BLOCK_BYTES;
                for fb in &files {
                    out.extend_from_slice(&fb.bytes[lo..hi]);
                }
            }

            sections.push(FieldSection {
                name: field.clone(),
                num_blocks,
                body_offset,
                file_ids: files.iter().map(|f| f.file_id).collect(),
                n_items: files.iter().map(|f| f.n_items).collect(),
            });
        }

        // Footer.
        let footer_start = out.len();
        out.write_all(&(sections.len() as u32).to_le_bytes())
            .unwrap();
        for sec in &sections {
            let name_bytes = sec.name.as_bytes();
            let name_len =
                u16::try_from(name_bytes.len()).map_err(|_| WriteError::FieldNameTooLong {
                    name: sec.name.clone(),
                    len: name_bytes.len(),
                })?;
            out.write_all(&name_len.to_le_bytes()).unwrap();
            out.write_all(name_bytes).unwrap();
            out.push(ALGO_SBBF_GXHASH);
            out.write_all(&sec.num_blocks.to_le_bytes()).unwrap();
            out.write_all(&(sec.file_ids.len() as u32).to_le_bytes())
                .unwrap();
            out.write_all(&sec.body_offset.to_le_bytes()).unwrap();
            for (fid, n) in sec.file_ids.iter().zip(sec.n_items.iter()) {
                out.write_all(&fid.to_le_bytes()).unwrap();
                out.write_all(&n.to_le_bytes()).unwrap();
            }
        }
        let footer_len = (out.len() - footer_start) as u32;
        out.write_all(&footer_len.to_le_bytes()).unwrap();
        out.extend_from_slice(MAGIC);

        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_bloom_serializes_to_minimal_blob() {
        let bytes = BloomWriter::serialize(vec![]).unwrap();
        // 4B magic + 1B version + 4B field_count + 4B footer_len + 4B magic = 17B
        assert_eq!(bytes.len(), 17);
        assert_eq!(&bytes[..4], MAGIC);
        assert_eq!(bytes[4], VERSION);
        assert_eq!(&bytes[bytes.len() - 4..], MAGIC);
    }

    #[test]
    fn test_non_uniform_blocks_rejected() {
        let blooms = vec![
            FieldBloom {
                field: "trace_id".into(),
                file_id: 1,
                n_items: 0,
                bytes: vec![0u8; 32],
            },
            FieldBloom {
                field: "trace_id".into(),
                file_id: 2,
                n_items: 0,
                bytes: vec![0u8; 64], // different B
            },
        ];
        let err = BloomWriter::serialize(blooms).unwrap_err();
        assert!(matches!(err, WriteError::NonUniformBlocks { .. }));
    }

    #[test]
    fn test_builder_uniform_blocks_round_trip() {
        let mut b = BloomBuilder::new();
        let i0 = b.begin_with_blocks(101, "trace_id", 4);
        b.insert(i0, b"abc");
        let i1 = b.begin_with_blocks(102, "trace_id", 4);
        b.insert(i1, b"def");
        let blooms = b.finish();
        assert_eq!(blooms.len(), 2);
        // Both files share B=4 → 128 bytes each.
        assert_eq!(blooms[0].bytes.len(), 4 * BLOCK_BYTES);
        assert_eq!(blooms[1].bytes.len(), 4 * BLOCK_BYTES);
        let blob = BloomWriter::serialize(blooms).unwrap();
        assert_eq!(&blob[..4], MAGIC);
        assert_eq!(&blob[blob.len() - 4..], MAGIC);
    }
}
