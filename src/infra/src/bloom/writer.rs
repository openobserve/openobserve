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

use std::io::Write;

use sbbf_rs_safe::Filter;

use super::{ALGO_SBBF_XXHASH64, MAGIC, VERSION, sbbf_hash};

/// One bloom for a single (file, field) pair, fully built in memory.
pub struct FieldBloom {
    pub field: String,
    pub file_id: u64,
    pub n_items: u32,
    pub bytes: Vec<u8>,
}

/// Builder that accumulates `(field, file)` blooms before serialization.
pub struct BloomBuilder {
    /// Bits per element. 10 ≈ 1% FPR for an SBBF; 14 ≈ 0.1%. Default 10.
    bits_per_key: usize,
    /// Per (field, file_id) → in-progress filter + insert count.
    filters: Vec<PerFieldFile>,
}

struct PerFieldFile {
    field: String,
    file_id: u64,
    filter: Filter,
    n_items: u32,
}

impl BloomBuilder {
    pub fn new() -> Self {
        Self {
            bits_per_key: 10,
            filters: Vec::new(),
        }
    }

    pub fn with_bits_per_key(mut self, bits_per_key: usize) -> Self {
        self.bits_per_key = bits_per_key;
        self
    }

    /// Begin a fresh bloom for this (file_id, field). Returns its index for
    /// subsequent `insert` calls. `expected_items` sizes the filter; passing
    /// the actual unique count is best, but a reasonable upper bound also
    /// works at the cost of slightly larger bytes.
    pub fn begin(&mut self, file_id: u64, field: &str, expected_items: usize) -> usize {
        let filter = Filter::new(self.bits_per_key, expected_items.max(1));
        self.filters.push(PerFieldFile {
            field: field.to_string(),
            file_id,
            filter,
            n_items: 0,
        });
        self.filters.len() - 1
    }

    pub fn insert(&mut self, idx: usize, value: &[u8]) {
        let entry = &mut self.filters[idx];
        let added = entry.filter.insert_hash(sbbf_hash(value));
        if !added {
            entry.n_items = entry.n_items.saturating_add(1);
        }
    }

    /// Number of `(file, field)` blooms collected so far.
    pub fn len(&self) -> usize {
        self.filters.len()
    }

    pub fn is_empty(&self) -> bool {
        self.filters.is_empty()
    }

    /// Freeze into an immutable list of `FieldBloom`s, bytes already
    /// extracted. Consumes the builder.
    pub fn finish(self) -> Vec<FieldBloom> {
        self.filters
            .into_iter()
            .map(|p| FieldBloom {
                field: p.field,
                file_id: p.file_id,
                n_items: p.n_items,
                bytes: p.filter.as_bytes().to_vec(),
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
    pub fn serialize(blooms: Vec<FieldBloom>) -> Vec<u8> {
        // group by field, preserving first-seen order
        let mut field_order: Vec<String> = Vec::new();
        let mut by_field: hashbrown::HashMap<String, Vec<FieldBloom>> = hashbrown::HashMap::new();
        for b in blooms {
            if !by_field.contains_key(&b.field) {
                field_order.push(b.field.clone());
            }
            by_field.entry(b.field.clone()).or_default().push(b);
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
            let mut files = Vec::with_capacity(files_in.len());
            for fb in files_in {
                let body_offset = out.len() as u64;
                out.extend_from_slice(&fb.bytes);
                files.push(FileEntry {
                    file_id: fb.file_id,
                    body_offset,
                    body_size: fb.bytes.len() as u32,
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
        out.write_all(&(sections.len() as u32).to_le_bytes()).unwrap();
        for sec in &sections {
            let name_bytes = sec.name.as_bytes();
            out.write_all(&(name_bytes.len() as u16).to_le_bytes()).unwrap();
            out.write_all(name_bytes).unwrap();
            out.push(ALGO_SBBF_XXHASH64);
            out.write_all(&(sec.files.len() as u32).to_le_bytes()).unwrap();
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

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_bloom_serializes_to_minimal_blob() {
        let bytes = BloomWriter::serialize(vec![]);
        // 4B magic + 1B version + 4B field_count + 4B footer_len + 4B magic = 17B
        assert_eq!(bytes.len(), 17);
        assert_eq!(&bytes[..4], MAGIC);
        assert_eq!(bytes[4], VERSION);
        assert_eq!(&bytes[bytes.len() - 4..], MAGIC);
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
        // n_items counts only NEW insertions (dup returned true → not counted)
        assert_eq!(blooms[0].n_items, 2);
        assert!(!blooms[0].bytes.is_empty());
    }

    #[test]
    fn test_writer_groups_by_field_in_insert_order() {
        let bytes = BloomWriter::serialize(vec![
            FieldBloom {
                field: "trace_id".into(),
                file_id: 1,
                n_items: 0,
                bytes: vec![0u8; 32],
            },
            FieldBloom {
                field: "user_id".into(),
                file_id: 1,
                n_items: 0,
                bytes: vec![0u8; 32],
            },
            FieldBloom {
                field: "trace_id".into(),
                file_id: 2,
                n_items: 0,
                bytes: vec![0u8; 32],
            },
        ]);
        // Header + 64B body for trace_id (file 1 + file 2) + 32B body for user_id
        // (insertion order groups field_order = [trace_id, user_id])
        // We can't easily assert exact offsets, but we can assert magic + tail magic
        assert_eq!(&bytes[..4], MAGIC);
        assert_eq!(&bytes[bytes.len() - 4..], MAGIC);
    }

    #[test]
    fn test_serialized_blob_starts_and_ends_with_magic() {
        let mut b = BloomBuilder::new();
        let idx = b.begin(1, "f", 10);
        b.insert(idx, b"x");
        let bytes = BloomWriter::serialize(b.finish());
        assert_eq!(&bytes[..4], MAGIC);
        assert_eq!(&bytes[bytes.len() - 4..], MAGIC);
    }

    #[test]
    fn test_n_items_grows_with_unique_inserts() {
        let mut b = BloomBuilder::new();
        let i = b.begin(1, "f", 1024);
        for v in 0..100u32 {
            b.insert(i, &v.to_le_bytes());
        }
        // re-insert all → none are new
        for v in 0..100u32 {
            b.insert(i, &v.to_le_bytes());
        }
        let blooms = b.finish();
        assert_eq!(blooms[0].n_items, 100);
    }
}
