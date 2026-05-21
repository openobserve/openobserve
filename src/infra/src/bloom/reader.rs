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

//! `.bf` file reader — footer only.
//!
//! The reader never holds the body of a `.bf` in memory. It parses the
//! footer (which is tiny: ~24 B per file × fields) and exposes two things:
//!
//! 1. [`BloomReader::block_range_for`] — given a `(field, file_id, value)` lookup, returns the
//!    absolute byte range of the single 32-byte SBBF block to fetch, plus the hash to feed into
//!    [`super::sbbf::check_block`]. Returns `None` when the file or field is absent (caller
//!    interprets that as "no info — keep the file").
//! 2. The 8-bit point check itself lives in [`super::sbbf::check_block`].
//!
//! This is the whole reason we keep the body out of memory: a point check
//! on a 2 MB SBBF only needs 32 bytes, and at search time we routinely
//! fan that out across hundreds of `.bf` buckets per query.

use std::ops::Range;

use hashbrown::HashMap;

use super::{
    ALGO_SBBF_XXHASH64, MAGIC, VERSION,
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
    #[error("invalid sbbf body size for field '{0}', file_id={1}: {2} bytes")]
    InvalidBloomSize(String, u64, u32),
}

#[derive(Debug, Clone, Copy)]
struct FileEntry {
    body_offset: u64,
    /// Always a non-zero multiple of `BLOCK_BYTES` — validated at parse time.
    body_size: u32,
}

#[derive(Debug)]
struct FieldSection {
    /// `file_id` → entry index inside `entries`.
    by_file: HashMap<u64, usize>,
    entries: Vec<FileEntry>,
}

/// Parsed `.bf` footer. Body bytes stay on disk / in object store; the
/// reader exposes [`Self::block_range_for`] so the caller can fetch just
/// the 32 bytes a single point check needs.
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
    /// Parse the footer out of a full `.bf` blob. Used by tests and by any
    /// caller that already has the entire file in memory.
    pub fn parse(blob: &[u8]) -> Result<Self, ReadError> {
        Self::parse_suffix(blob, blob.len() as u64)
    }

    /// Parse from a trailing suffix of the file. `total_size` is the full
    /// `.bf` length on disk; `suffix` is the last `suffix.len()` bytes of
    /// it. The reader needs the tail magic + footer_len + footer payload —
    /// the suffix must therefore cover all of those (callers size it
    /// generously, e.g. 16 KB).
    ///
    /// `body_offset`s recorded in the footer are absolute against the
    /// full file, which is exactly what [`Self::block_range_for`] returns.
    pub fn parse_suffix(suffix: &[u8], total_size: u64) -> Result<Self, ReadError> {
        if suffix.len() < 4 + 1 + 4 + 4 + 4 {
            return Err(ReadError::TooShort(suffix.len()));
        }
        let total = total_size as usize;
        // We need to validate the *file* header (MAGIC + VERSION) too. If
        // the suffix covers the whole file, both fit. Otherwise we only
        // validate the tail and trust the upstream fetch.
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
            if algo != ALGO_SBBF_XXHASH64 {
                return Err(ReadError::BadAlgo(algo));
            }
            let file_count = read_u32(suffix, &mut p)? as usize;
            let mut by_file: HashMap<u64, usize> = HashMap::with_capacity(file_count);
            let mut entries: Vec<FileEntry> = Vec::with_capacity(file_count);
            for _ in 0..file_count {
                let file_id = read_u64(suffix, &mut p)?;
                let body_offset = read_u64(suffix, &mut p)?;
                let body_size = read_u32(suffix, &mut p)?;
                let _n_items = read_u32(suffix, &mut p)?;
                // Body must be a non-zero multiple of 32 (one SBBF block).
                if body_size == 0 || body_size as usize % BLOCK_BYTES != 0 {
                    return Err(ReadError::InvalidBloomSize(name.clone(), file_id, body_size));
                }
                // Body must fit before the footer (in the full file).
                if body_offset
                    .checked_add(body_size as u64)
                    .map(|end| end as usize > total - footer_len - 8)
                    .unwrap_or(true)
                {
                    return Err(ReadError::Truncated);
                }
                let idx = entries.len();
                entries.push(FileEntry {
                    body_offset,
                    body_size,
                });
                by_file.insert(file_id, idx);
            }
            by_field.insert(name, FieldSection { by_file, entries });
        }
        if p != n - 8 {
            return Err(ReadError::Truncated);
        }

        Ok(Self { by_field })
    }

    /// Number of distinct indexed fields in this blob.
    pub fn field_count(&self) -> usize {
        self.by_field.len()
    }

    pub fn fields(&self) -> impl Iterator<Item = &str> {
        self.by_field.keys().map(String::as_str)
    }

    /// Compute the single 32-byte block range to fetch for a point check.
    ///
    /// Returns `Some((range, hash))` where:
    /// - `range` is the absolute byte range inside the `.bf` to fetch (always exactly 32 bytes)
    /// - `hash` is the xxhash64 of the value; pass it to [`check_block_with_hash`] together with the
    ///   fetched bytes
    ///
    /// Returns `None` when this `.bf` has no info for `(field, file_id)` —
    /// the caller should interpret that as "no information available" and
    /// keep the file in the candidate set.
    pub fn block_range_for(
        &self,
        field: &str,
        file_id: u64,
        value: &[u8],
    ) -> Option<(Range<u64>, u64)> {
        let section = self.by_field.get(field)?;
        let idx = *section.by_file.get(&file_id)?;
        let entry = section.entries[idx];
        // body_size validated at parse to be a multiple of 32 and non-zero.
        let num_blocks = entry.body_size / BLOCK_BYTES as u32;
        let h = hash_value(value);
        let bi = block_index(h, num_blocks) as u64;
        let start = entry.body_offset + bi * BLOCK_BYTES as u64;
        Some((start..start + BLOCK_BYTES as u64, h))
    }

    /// Run the 8-bit SBBF check on a fetched 32-byte block. Convenience
    /// wrapper around [`super::sbbf::check_block`].
    #[inline]
    pub fn check_block_with_hash(block: &[u8; BLOCK_BYTES], hash: u64) -> bool {
        check_block(block, hash)
    }
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

    fn build_two_field_blob() -> Vec<u8> {
        let mut b = BloomBuilder::new();
        let i1 = b.begin(101, "trace_id", 100);
        b.insert(i1, b"abc");
        b.insert(i1, b"def");
        let i2 = b.begin(102, "trace_id", 100);
        b.insert(i2, b"ghi");
        let i3 = b.begin(101, "user_id", 100);
        b.insert(i3, b"u-1");
        BloomWriter::serialize(b.finish()).expect("write succeeds")
    }

    /// Fetch the 32-byte block that `block_range_for` points at, then
    /// run the same single-block check the pruner does. Returns `None`
    /// when the reader has no info for `(field, file_id)`.
    fn check_via_block(reader: &BloomReader, blob: &[u8], field: &str, file_id: u64, v: &[u8]) -> Option<bool> {
        let (range, h) = reader.block_range_for(field, file_id, v)?;
        let s = range.start as usize;
        let e = range.end as usize;
        let block: &[u8; BLOCK_BYTES] = blob[s..e].try_into().unwrap();
        Some(BloomReader::check_block_with_hash(block, h))
    }

    #[test]
    fn test_round_trip_membership_yes_and_no() {
        let blob = build_two_field_blob();
        let r = BloomReader::parse(&blob).unwrap();
        assert_eq!(r.field_count(), 2);

        // present items — single-block check must hit
        assert_eq!(check_via_block(&r, &blob, "trace_id", 101, b"abc"), Some(true));
        assert_eq!(check_via_block(&r, &blob, "trace_id", 101, b"def"), Some(true));
        assert_eq!(check_via_block(&r, &blob, "trace_id", 102, b"ghi"), Some(true));
        assert_eq!(check_via_block(&r, &blob, "user_id", 101, b"u-1"), Some(true));
        // absent items — overwhelmingly false
        assert_eq!(check_via_block(&r, &blob, "trace_id", 101, b"NOT_PRESENT_xx"), Some(false));
        assert_eq!(check_via_block(&r, &blob, "user_id", 101, b"NOT_PRESENT_xx"), Some(false));
    }

    #[test]
    fn test_unknown_field_or_file_returns_none() {
        // "no information" — caller decides what to do (typically: keep the file).
        let blob = build_two_field_blob();
        let r = BloomReader::parse(&blob).unwrap();
        assert!(r.block_range_for("nonexistent_field", 101, b"x").is_none());
        assert!(r.block_range_for("trace_id", 999_999, b"x").is_none());
    }

    #[test]
    fn test_bad_magic_rejected() {
        let mut blob = build_two_field_blob();
        blob[0] = b'X';
        let err = BloomReader::parse(&blob).unwrap_err();
        assert!(matches!(err, ReadError::BadMagic));
    }

    #[test]
    fn test_bad_tail_magic_rejected() {
        let mut blob = build_two_field_blob();
        let n = blob.len();
        blob[n - 1] = b'X';
        let err = BloomReader::parse(&blob).unwrap_err();
        assert!(matches!(err, ReadError::BadMagic));
    }

    #[test]
    fn test_bad_version_rejected() {
        let mut blob = build_two_field_blob();
        blob[4] = 0xFF;
        let err = BloomReader::parse(&blob).unwrap_err();
        assert!(matches!(err, ReadError::BadVersion(0xFF)));
    }

    #[test]
    fn test_truncated_blob_rejected() {
        let blob = build_two_field_blob();
        let truncated = &blob[..blob.len() - 5];
        let err = BloomReader::parse(truncated).unwrap_err();
        assert!(matches!(
            err,
            ReadError::BadMagic | ReadError::BadFooter(_, _) | ReadError::Truncated
        ));
    }

    #[test]
    fn test_too_short_blob_rejected() {
        let err = BloomReader::parse(&[0u8; 5]).unwrap_err();
        assert!(matches!(err, ReadError::TooShort(_)));
    }

    #[test]
    fn test_empty_blob_writer_round_trips() {
        let blob = BloomWriter::serialize(vec![]).unwrap();
        let r = BloomReader::parse(&blob).unwrap();
        assert_eq!(r.field_count(), 0);
    }

    /// The pruner only ever has the trailing N bytes of the file plus
    /// `total_size`. Confirm `parse_suffix` recovers the same footer.
    #[test]
    fn test_parse_suffix_round_trip() {
        let blob = build_two_field_blob();
        let total = blob.len();
        let probe = 1024.min(total);
        let suffix = &blob[total - probe..];
        let r = BloomReader::parse_suffix(suffix, total as u64).unwrap();
        assert_eq!(r.field_count(), 2);

        // The reader gives us absolute offsets against the full file —
        // the pruner uses these as direct `get_range` arguments.
        let (range, h) = r.block_range_for("trace_id", 101, b"abc").unwrap();
        assert_eq!(range.end - range.start, BLOCK_BYTES as u64);
        let s = range.start as usize;
        let e = range.end as usize;
        let block: &[u8; BLOCK_BYTES] = blob[s..e].try_into().unwrap();
        assert!(BloomReader::check_block_with_hash(block, h));
    }

    #[test]
    fn test_observed_fpr_within_bounds() {
        // Sanity: 1k inserts at FPR 0.01 → < 5% false positives on 10k absent queries.
        let mut b = BloomBuilder::new();
        let idx = b.begin(7, "trace_id", 1000);
        for i in 0..1000u32 {
            b.insert(idx, format!("present-{i}").as_bytes());
        }
        let blob = BloomWriter::serialize(b.finish()).unwrap();
        let r = BloomReader::parse(&blob).unwrap();
        let mut fp = 0;
        for i in 0..10_000u32 {
            if check_via_block(&r, &blob, "trace_id", 7, format!("absent-{i}").as_bytes())
                .unwrap_or(true)
            {
                fp += 1;
            }
        }
        assert!(
            fp < 500,
            "false positive count {fp} > 500 for 10k absent queries (FPR > 5%)"
        );
    }
}
