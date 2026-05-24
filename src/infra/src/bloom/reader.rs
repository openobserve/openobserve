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

//! `.bf` file reader — footer only, **transposed (block-major) body**.
//!
//! The reader never holds the body. It parses the footer and exposes:
//!
//! 1. [`BloomReader::row_range`] — for a `(field, value)` lookup, the byte range of the **whole
//!    block row** (`M × 32` bytes, all files' block for this value) plus the hash to feed
//!    [`super::sbbf::check_block`]. One range per (field, value), shared by every file in the
//!    group.
//! 2. [`BloomReader::column_index`] — a file_id's column within that row.
//!
//! This is what makes the prune cost O(groups), not O(files): a single
//! contiguous read per group answers membership for all its files.

use std::ops::Range;

use hashbrown::HashMap;

use super::{
    ALGO_SBBF_GXHASH, MAGIC, VERSION,
    sbbf::{BLOCK_BYTES, block_index, check_block, hash_value},
};

#[derive(Debug, Clone, thiserror::Error)]
pub enum ReadError {
    #[error("blob too short: {0} bytes")]
    TooShort(usize),
    #[error("magic mismatch")]
    BadMagic,
    #[error("unsupported version: {0}")]
    BadVersion(u8),
    #[error("unsupported algo: {0}")]
    BadAlgo(u8),
    #[error("footer length out of range: footer_len={0}, blob_len={1}")]
    BadFooter(u32, usize),
    #[error("truncated field section")]
    Truncated,
    #[error("invalid num_blocks for field '{0}': {1}")]
    InvalidNumBlocks(String, u32),
}

#[derive(Debug)]
struct FieldSection {
    /// uniform block count for every file in this field
    num_blocks: u32,
    /// number of files (columns) = row width / 32
    file_count: u32,
    /// absolute offset of this field's transposed matrix in the file
    body_offset: u64,
    /// file_id → column index
    by_file: HashMap<u64, usize>,
    /// column order (col i ↔ file_ids[i]); kept for inspect/debug
    file_ids: Vec<u64>,
}

/// Parsed `.bf` footer. Body stays in object store; callers fetch one
/// block-row per `(field, value)` via [`Self::row_range`].
pub struct BloomReader {
    by_field: HashMap<String, FieldSection>,
}

impl std::fmt::Debug for BloomReader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BloomReader")
            .field("field_count", &self.by_field.len())
            .finish()
    }
}

impl BloomReader {
    /// Parse the footer from a full `.bf` blob (tests / whole-file callers).
    pub fn parse(blob: &[u8]) -> Result<Self, ReadError> {
        Self::parse_suffix(blob, blob.len() as u64)
    }

    /// Parse from a trailing suffix of the file. `total_size` is the full
    /// `.bf` length; `suffix` is its last `suffix.len()` bytes (must cover
    /// the tail magic + footer_len + footer payload).
    pub fn parse_suffix(suffix: &[u8], total_size: u64) -> Result<Self, ReadError> {
        if suffix.len() < 4 + 1 + 4 + 4 + 4 {
            return Err(ReadError::TooShort(suffix.len()));
        }
        let total = total_size as usize;
        let suffix_covers_head = suffix.len() >= total;
        if suffix_covers_head {
            if &suffix[..4] != MAGIC {
                return Err(ReadError::BadMagic);
            }
            if suffix[4] != VERSION {
                return Err(ReadError::BadVersion(suffix[4]));
            }
        }
        let n = suffix.len();
        if &suffix[n - 4..] != MAGIC {
            return Err(ReadError::BadMagic);
        }

        let footer_len = u32::from_le_bytes(suffix[n - 8..n - 4].try_into().unwrap()) as usize;
        if footer_len + 8 > n {
            return Err(ReadError::BadFooter(footer_len as u32, n));
        }
        let footer_start = n - 8 - footer_len;

        let mut p = footer_start;
        let field_count = read_u32(suffix, &mut p)? as usize;

        let mut by_field: HashMap<String, FieldSection> = HashMap::with_capacity(field_count);
        for _ in 0..field_count {
            let name_len = read_u16(suffix, &mut p)? as usize;
            if p + name_len > n {
                return Err(ReadError::Truncated);
            }
            let name = std::str::from_utf8(&suffix[p..p + name_len])
                .map_err(|_| ReadError::Truncated)?
                .to_string();
            p += name_len;
            let algo = read_u8(suffix, &mut p)?;
            if algo != ALGO_SBBF_GXHASH {
                return Err(ReadError::BadAlgo(algo));
            }
            let num_blocks = read_u32(suffix, &mut p)?;
            if num_blocks == 0 {
                return Err(ReadError::InvalidNumBlocks(name.clone(), num_blocks));
            }
            let file_count = read_u32(suffix, &mut p)?;
            let body_offset = read_u64(suffix, &mut p)?;

            // Validate the matrix fits in the full file (before the footer).
            let matrix_bytes = (num_blocks as u64)
                .checked_mul(file_count as u64)
                .and_then(|v| v.checked_mul(BLOCK_BYTES as u64));
            match matrix_bytes {
                Some(mb)
                    if body_offset
                        .checked_add(mb)
                        .map(|end| end as usize <= total - footer_len - 8)
                        .unwrap_or(false) => {}
                _ => return Err(ReadError::Truncated),
            }

            let mut by_file: HashMap<u64, usize> = HashMap::with_capacity(file_count as usize);
            let mut file_ids: Vec<u64> = Vec::with_capacity(file_count as usize);
            for col in 0..file_count as usize {
                let file_id = read_u64(suffix, &mut p)?;
                let _n_items = read_u32(suffix, &mut p)?;
                by_file.insert(file_id, col);
                file_ids.push(file_id);
            }
            by_field.insert(
                name,
                FieldSection {
                    num_blocks,
                    file_count,
                    body_offset,
                    by_file,
                    file_ids,
                },
            );
        }
        if p != n - 8 {
            return Err(ReadError::Truncated);
        }

        Ok(Self { by_field })
    }

    pub fn field_count(&self) -> usize {
        self.by_field.len()
    }

    pub fn fields(&self) -> impl Iterator<Item = &str> {
        self.by_field.keys().map(String::as_str)
    }

    /// True iff this footer carries `(field, file_id)`.
    pub fn has_entry(&self, field: &str, file_id: u64) -> bool {
        self.by_field
            .get(field)
            .is_some_and(|s| s.by_file.contains_key(&file_id))
    }

    /// Byte range of the block row that answers `value` for **every file**
    /// in this field, plus the hash for [`check_block_with_hash`].
    ///
    /// The returned range is exactly `file_count × 32` bytes. Use
    /// [`Self::column_index`] to locate a specific file's 32-byte block
    /// inside the fetched row. Returns `None` if the field is absent.
    pub fn row_range(&self, field: &str, value: &[u8]) -> Option<(Range<u64>, u64)> {
        let section = self.by_field.get(field)?;
        let h = hash_value(value);
        let bi = block_index(h, section.num_blocks) as u64;
        let row_bytes = section.file_count as u64 * BLOCK_BYTES as u64;
        let start = section.body_offset + bi * row_bytes;
        Some((start..start + row_bytes, h))
    }

    /// Column index of `file_id` within `field`'s rows (None if absent).
    pub fn column_index(&self, field: &str, file_id: u64) -> Option<usize> {
        self.by_field.get(field)?.by_file.get(&file_id).copied()
    }

    /// Run the 8-bit SBBF check on a single 32-byte block.
    #[inline]
    pub fn check_block_with_hash(block: &[u8; BLOCK_BYTES], hash: u64) -> bool {
        check_block(block, hash)
    }

    /// Per-field inspection snapshot (CLI / debug logs).
    pub fn inspect(&self) -> Vec<FieldInspect> {
        let mut out: Vec<FieldInspect> = self
            .by_field
            .iter()
            .map(|(name, s)| FieldInspect {
                field: name.clone(),
                file_count: s.file_count as usize,
                num_blocks: s.num_blocks,
                row_bytes: s.file_count as u64 * BLOCK_BYTES as u64,
                total_body_bytes: s.num_blocks as u64 * s.file_count as u64 * BLOCK_BYTES as u64,
                file_ids: {
                    let mut v = s.file_ids.clone();
                    v.sort_unstable();
                    v
                },
            })
            .collect();
        out.sort_by(|a, b| a.field.cmp(&b.field));
        out
    }
}

/// Per-field summary returned by [`BloomReader::inspect`].
#[derive(Debug, Clone)]
pub struct FieldInspect {
    pub field: String,
    pub file_count: usize,
    pub num_blocks: u32,
    /// bytes read per query for this field (= `file_count × 32`)
    pub row_bytes: u64,
    pub total_body_bytes: u64,
    pub file_ids: Vec<u64>,
}

#[inline]
fn read_u8(buf: &[u8], p: &mut usize) -> Result<u8, ReadError> {
    if *p + 1 > buf.len() {
        return Err(ReadError::Truncated);
    }
    let v = buf[*p];
    *p += 1;
    Ok(v)
}

#[inline]
fn read_u16(buf: &[u8], p: &mut usize) -> Result<u16, ReadError> {
    if *p + 2 > buf.len() {
        return Err(ReadError::Truncated);
    }
    let v = u16::from_le_bytes(buf[*p..*p + 2].try_into().unwrap());
    *p += 2;
    Ok(v)
}

#[inline]
fn read_u32(buf: &[u8], p: &mut usize) -> Result<u32, ReadError> {
    if *p + 4 > buf.len() {
        return Err(ReadError::Truncated);
    }
    let v = u32::from_le_bytes(buf[*p..*p + 4].try_into().unwrap());
    *p += 4;
    Ok(v)
}

#[inline]
fn read_u64(buf: &[u8], p: &mut usize) -> Result<u64, ReadError> {
    if *p + 8 > buf.len() {
        return Err(ReadError::Truncated);
    }
    let v = u64::from_le_bytes(buf[*p..*p + 8].try_into().unwrap());
    *p += 8;
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::{
        super::writer::{BloomBuilder, BloomWriter},
        *,
    };

    /// Build a transposed blob: 2 files share field "trace_id" (B=8),
    /// 1 file has "user_id".
    fn build_blob() -> Vec<u8> {
        let mut b = BloomBuilder::new();
        let i1 = b.begin_with_blocks(101, "trace_id", 8);
        b.insert(i1, b"abc");
        b.insert(i1, b"def");
        let i2 = b.begin_with_blocks(102, "trace_id", 8);
        b.insert(i2, b"ghi");
        let i3 = b.begin_with_blocks(101, "user_id", 8);
        b.insert(i3, b"u-1");
        BloomWriter::serialize(b.finish()).expect("write succeeds")
    }

    /// Check membership the way the pruner does: row_range → slice the
    /// file's column → check_block.
    fn check(blob: &[u8], r: &BloomReader, field: &str, file_id: u64, v: &[u8]) -> Option<bool> {
        let (range, h) = r.row_range(field, v)?;
        let col = r.column_index(field, file_id)?;
        let row = &blob[range.start as usize..range.end as usize];
        let off = col * BLOCK_BYTES;
        let block: &[u8; BLOCK_BYTES] = row[off..off + BLOCK_BYTES].try_into().unwrap();
        Some(BloomReader::check_block_with_hash(block, h))
    }

    #[test]
    fn test_round_trip_membership() {
        let blob = build_blob();
        let r = BloomReader::parse(&blob).unwrap();
        assert_eq!(r.field_count(), 2);

        assert_eq!(check(&blob, &r, "trace_id", 101, b"abc"), Some(true));
        assert_eq!(check(&blob, &r, "trace_id", 101, b"def"), Some(true));
        assert_eq!(check(&blob, &r, "trace_id", 102, b"ghi"), Some(true));
        assert_eq!(check(&blob, &r, "user_id", 101, b"u-1"), Some(true));
        // file 102 does not contain abc/def
        assert_eq!(check(&blob, &r, "trace_id", 102, b"abc"), Some(false));
        assert_eq!(check(&blob, &r, "trace_id", 101, b"NOPE_xyz"), Some(false));
    }

    #[test]
    fn test_row_shared_across_files() {
        // The same value maps to the SAME row for every file in the field —
        // this is the property that lets the pruner read once per group.
        let blob = build_blob();
        let r = BloomReader::parse(&blob).unwrap();
        let (range_a, _) = r.row_range("trace_id", b"abc").unwrap();
        // file 101 and 102 share the row; only the column differs.
        assert!(r.column_index("trace_id", 101).is_some());
        assert!(r.column_index("trace_id", 102).is_some());
        assert_ne!(
            r.column_index("trace_id", 101),
            r.column_index("trace_id", 102)
        );
        // row width = file_count(2) × 32 = 64
        assert_eq!(range_a.end - range_a.start, 2 * BLOCK_BYTES as u64);
    }

    #[test]
    fn test_unknown_field_or_file_none() {
        let blob = build_blob();
        let r = BloomReader::parse(&blob).unwrap();
        assert!(r.row_range("nonexistent", b"x").is_none());
        assert!(r.column_index("trace_id", 999_999).is_none());
    }

    #[test]
    fn test_parse_suffix_round_trip() {
        let blob = build_blob();
        let total = blob.len();
        // suffix covering footer only (body is small here, but test the path)
        let probe = 512.min(total);
        let suffix = &blob[total - probe..];
        let r = BloomReader::parse_suffix(suffix, total as u64).unwrap();
        let (range, h) = r.row_range("trace_id", b"abc").unwrap();
        let col = r.column_index("trace_id", 101).unwrap();
        let row = &blob[range.start as usize..range.end as usize];
        let off = col * BLOCK_BYTES;
        let block: &[u8; BLOCK_BYTES] = row[off..off + BLOCK_BYTES].try_into().unwrap();
        assert!(BloomReader::check_block_with_hash(block, h));
    }

    #[test]
    fn test_bad_version_rejected() {
        let mut blob = build_blob();
        blob[4] = 0xFF;
        assert!(matches!(
            BloomReader::parse(&blob).unwrap_err(),
            ReadError::BadVersion(0xFF)
        ));
    }

    #[test]
    fn test_observed_fpr_within_bounds() {
        let mut b = BloomBuilder::new();
        let nb = super::super::sbbf::num_blocks_for(1000, 0.01);
        let idx = b.begin_with_blocks(7, "trace_id", nb);
        for i in 0..1000u32 {
            b.insert(idx, format!("present-{i}").as_bytes());
        }
        let blob = BloomWriter::serialize(b.finish()).unwrap();
        let r = BloomReader::parse(&blob).unwrap();
        let mut fp = 0;
        for i in 0..10_000u32 {
            if check(&blob, &r, "trace_id", 7, format!("absent-{i}").as_bytes()).unwrap_or(true) {
                fp += 1;
            }
        }
        assert!(fp < 500, "FPR > 5%: {fp}/10000");
    }
}
