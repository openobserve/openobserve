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

//! `.bf` file writer.
//!
//! Build per-(file, field) blooms in memory then `serialize()` to bytes.
//! Single-shot — does not stream. Hour buckets are bounded enough in size
//! (≈100MB even for high-cardinality fields) that streaming would just add
//! complexity without saving meaningful memory.
//!
//! Each per-(file, field) bloom is a `parquet::bloom_filter::Sbbf`. We
//! call `Sbbf::write` to produce the on-disk bytes (thrift header +
//! bitset, exactly the Parquet column-bloom format) and store those
//! bytes verbatim in our `.bf` body. The reader reverses with
//! `Sbbf::from_bytes`.

use std::io::Write;

use parquet::bloom_filter::Sbbf;

use super::{ALGO_SBBF_XXHASH64, MAGIC, VERSION};

/// Default false-positive probability for new SBBFs.
const DEFAULT_FPP: f64 = 0.01;

/// Bounds-check errors caught when packing a `.bf` footer. Returned
/// instead of silently wrapping a `usize` cast — a corrupted footer
/// would parse incorrectly on read with no signal at write time.
#[derive(Debug, thiserror::Error)]
pub enum WriteError {
    #[error("field name '{name}' is too long: {len} bytes (max u16::MAX)")]
    FieldNameTooLong { name: String, len: usize },
    #[error("too many fields: {0} (max u32::MAX)")]
    TooManyFields(usize),
    #[error("too many files for field '{field}': {count} (max u32::MAX)")]
    TooManyFiles { field: String, count: usize },
    #[error("bloom body too large for file_id {file_id}: {len} bytes (max u32::MAX)")]
    BloomBodyTooLarge { file_id: u64, len: usize },
}

/// One bloom for a single (file, field) pair, fully built in memory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldBloom {
    pub field: String,
    pub file_id: u64,
    pub n_items: u32,
    /// Output of `Sbbf::write` — thrift `BloomFilterHeader` followed by
    /// the bitset. Round-trips through `Sbbf::from_bytes`.
    pub bytes: Vec<u8>,
}

/// Builder that accumulates `(field, file)` blooms before serialization.
pub struct BloomBuilder {
    /// False-positive probability target for newly-created SBBFs.
    /// 0.01 ≈ 10 bits/elem; 0.001 ≈ 14 bits/elem. Default 0.01.
    fpp: f64,
    /// Per (field, file_id) → in-progress filter + insert count.
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

    /// Override the target FPR. Cheap — only affects newly-created blooms.
    pub fn with_fpp(mut self, fpp: f64) -> Self {
        self.fpp = fpp;
        self
    }

    /// Begin a fresh bloom for this (file_id, field). Returns its index for
    /// subsequent `insert` calls. `expected_items` sizes the filter; passing
    /// the actual unique count is best, but a reasonable upper bound also
    /// works at the cost of slightly larger bytes.
    pub fn begin(&mut self, file_id: u64, field: &str, expected_items: usize) -> usize {
        let ndv = expected_items.max(1) as u64;
        let sbbf = Sbbf::new_with_ndv_fpp(ndv, self.fpp).expect("valid fpp");
        self.filters.push(PerFieldFile {
            field: field.to_string(),
            file_id,
            sbbf,
            n_items: 0,
        });
        self.filters.len() - 1
    }

    /// Insert raw bytes — `Sbbf::insert` applies XxHash64(seed=0) per
    /// the Parquet bloom filter spec, so callers don't pre-hash.
    pub fn insert(&mut self, idx: usize, value: &[u8]) {
        let entry = &mut self.filters[idx];
        entry.sbbf.insert(value);
        // `Sbbf::insert` is silent about duplicates, so we count every
        // call. Duplicates are rare in practice (callers feed unique
        // tantivy term-dict entries) and `n_items` is only used for
        // diagnostics, not capacity decisions.
        entry.n_items = entry.n_items.saturating_add(1);
    }

    /// Number of `(file, field)` blooms collected so far.
    pub fn len(&self) -> usize {
        self.filters.len()
    }

    pub fn is_empty(&self) -> bool {
        self.filters.is_empty()
    }

    /// Freeze into an immutable list of `FieldBloom`s, with each Sbbf
    /// already serialized via `Sbbf::write`. Consumes the builder.
    pub fn finish(self) -> Vec<FieldBloom> {
        self.filters
            .into_iter()
            .map(|p| {
                let mut buf = Vec::new();
                p.sbbf
                    .write(&mut buf)
                    .expect("write Sbbf to in-memory buffer");
                FieldBloom {
                    field: p.field,
                    file_id: p.file_id,
                    n_items: p.n_items,
                    bytes: buf,
                }
            })
            .collect()
    }
}

impl Default for BloomBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Layout-encoder. Takes already-built `FieldBloom`s and serializes the
/// full `.bf` body + footer + tail magic.
pub struct BloomWriter;

impl BloomWriter {
    /// Serialize a complete `.bf` blob from the given blooms. Order in the
    /// footer follows insertion order (group by field first, then by file).
    ///
    /// Returns `WriteError` if any footer field would overflow its on-disk
    /// width (u16 for name length, u32 for counts and per-bloom byte size).
    /// Practical bounds are far above realistic inputs (16-bit field
    /// names, 4 GiB single-bloom size); this is a defensive check rather
    /// than an expected failure mode.
    pub fn serialize(blooms: Vec<FieldBloom>) -> Result<Vec<u8>, WriteError> {
        // group by field, preserving first-seen order
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

        let mut out = Vec::with_capacity(1024);

        // header
        out.extend_from_slice(MAGIC);
        out.push(VERSION);

        // body — write all bloom bytes back-to-back, remember offsets
        struct FileEntry {
            file_id: u64,
            body_offset: u64,
            body_size: u32,
            n_items: u32,
        }
        struct FieldSection {
            name: String,
            files: Vec<FileEntry>,
        }
        let mut sections: Vec<FieldSection> = Vec::with_capacity(field_order.len());
        for field in &field_order {
            let files_in = by_field.remove(field).unwrap();
            if files_in.len() > u32::MAX as usize {
                return Err(WriteError::TooManyFiles {
                    field: field.clone(),
                    count: files_in.len(),
                });
            }
            let mut files = Vec::with_capacity(files_in.len());
            for fb in files_in {
                let body_size =
                    u32::try_from(fb.bytes.len()).map_err(|_| WriteError::BloomBodyTooLarge {
                        file_id: fb.file_id,
                        len: fb.bytes.len(),
                    })?;
                let body_offset = out.len() as u64;
                out.extend_from_slice(&fb.bytes);
                files.push(FileEntry {
                    file_id: fb.file_id,
                    body_offset,
                    body_size,
                    n_items: fb.n_items,
                });
            }
            sections.push(FieldSection {
                name: field.clone(),
                files,
            });
        }

        // footer
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
            out.push(ALGO_SBBF_XXHASH64);
            // checked above when building `files`
            out.write_all(&(sec.files.len() as u32).to_le_bytes())
                .unwrap();
            for f in &sec.files {
                out.write_all(&f.file_id.to_le_bytes()).unwrap();
                out.write_all(&f.body_offset.to_le_bytes()).unwrap();
                out.write_all(&f.body_size.to_le_bytes()).unwrap();
                out.write_all(&f.n_items.to_le_bytes()).unwrap();
            }
        }
        let footer_len = (out.len() - footer_start) as u32;

        // tail
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
    fn test_field_name_too_long_rejected() {
        // Build a name that overflows u16 to confirm we surface the
        // overflow as an error instead of silently truncating.
        let huge_name = "x".repeat(u16::MAX as usize + 1);
        let blooms = vec![FieldBloom {
            field: huge_name.clone(),
            file_id: 1,
            n_items: 0,
            bytes: vec![0u8; 32],
        }];
        let err = BloomWriter::serialize(blooms).unwrap_err();
        match err {
            WriteError::FieldNameTooLong { name, len } => {
                assert_eq!(name, huge_name);
                assert!(len > u16::MAX as usize);
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn test_builder_round_trip_single_field_single_file() {
        let mut b = BloomBuilder::new();
        let idx = b.begin(42, "trace_id", 100);
        b.insert(idx, b"abc");
        b.insert(idx, b"def");
        b.insert(idx, b"abc"); // dup
        let blooms = b.finish();
        assert_eq!(blooms.len(), 1);
        assert_eq!(blooms[0].file_id, 42);
        assert_eq!(blooms[0].field, "trace_id");
        // n_items counts every insert call (parquet's Sbbf::insert is silent
        // about whether a value was already present).
        assert_eq!(blooms[0].n_items, 3);
        assert!(!blooms[0].bytes.is_empty());
    }

    #[test]
    fn test_writer_keeps_magic_at_both_ends() {
        let mut b = BloomBuilder::new();
        let idx = b.begin(1, "f", 10);
        b.insert(idx, b"x");
        let bytes = BloomWriter::serialize(b.finish()).unwrap();
        assert_eq!(&bytes[..4], MAGIC);
        assert_eq!(&bytes[bytes.len() - 4..], MAGIC);
    }

    #[test]
    fn test_multiple_blooms_serialize_independently() {
        let mut b = BloomBuilder::new();
        let i_a = b.begin(1, "trace_id", 64);
        let i_b = b.begin(1, "user_id", 64);
        let i_c = b.begin(2, "trace_id", 64);
        b.insert(i_a, b"a");
        b.insert(i_b, b"u");
        b.insert(i_c, b"c");
        let blooms = b.finish();
        assert_eq!(blooms.len(), 3);
        // Each bloom carries its own thrift header + bitset, so all three
        // should have non-trivial size.
        for fb in &blooms {
            assert!(fb.bytes.len() > 32);
        }
    }
}
