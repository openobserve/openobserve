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

//! `.bf` file reader.
//!
//! Whole-blob reader: parses the footer, exposes `(file_id, field) ->
//! contains(value)` lookups. Built for the search hot path — once the
//! footer is parsed, every check is one xxhash + one cache-line load
//! through `parquet::bloom_filter::Sbbf::check`.
//!
//! Failure mode is "treat-as-missing": malformed bytes return
//! `Err(ReadError::*)`. Callers (the search prune layer) downgrade any
//! error to "no pruning" to keep query correctness.

use std::sync::OnceLock;

use hashbrown::HashMap;
use parquet::bloom_filter::Sbbf;

use super::{ALGO_SBBF_XXHASH64, MAGIC, VERSION};

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
    #[error("invalid sbbf bytes for field '{0}', file_id={1}: {2}")]
    InvalidBloom(String, u64, String),
}

/// One indexed bloom for a particular file_id, lazily materialized.
///
/// `bloom` is wrapped in `OnceLock` rather than `Option<Sbbf>` so that
/// `check` only needs `&self` (interior init) — this is the contract
/// that lets a single `Arc<BloomReader>` be shared across queries
/// without a `Mutex` on the hot path. The OnceLock stores
/// `Result<Sbbf, ReadError>` to memoize parse failures too.
#[derive(Debug)]
struct FileEntry {
    body_offset: u64,
    body_size: u32,
    bloom: OnceLock<Result<Sbbf, ReadError>>,
}

#[derive(Debug)]
struct FieldSection {
    /// `file_id` → entry index inside `entries`.
    by_file: HashMap<u64, usize>,
    entries: Vec<FileEntry>,
}

/// Parsed `.bf` blob ready for membership lookups. Lookups take `&self`
/// (no `&mut`) so the reader can be shared via `Arc` across queries.
pub struct BloomReader {
    blob: Vec<u8>,
    /// `field_name` → section
    by_field: HashMap<String, FieldSection>,
}

impl std::fmt::Debug for BloomReader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BloomReader")
            .field("blob_len", &self.blob.len())
            .field("field_count", &self.by_field.len())
            .finish()
    }
}

impl BloomReader {
    pub fn parse(blob: Vec<u8>) -> Result<Self, ReadError> {
        if blob.len() < 4 + 1 + 4 + 4 + 4 {
            return Err(ReadError::TooShort(blob.len()));
        }
        if &blob[..4] != MAGIC {
            return Err(ReadError::BadMagic);
        }
        if blob[4] != VERSION {
            return Err(ReadError::BadVersion(blob[4]));
        }
        let n = blob.len();
        if &blob[n - 4..] != MAGIC {
            return Err(ReadError::BadMagic);
        }

        let footer_len = u32::from_le_bytes(blob[n - 8..n - 4].try_into().unwrap()) as usize;
        if footer_len + 8 > n {
            return Err(ReadError::BadFooter(footer_len as u32, n));
        }
        let footer_start = n - 8 - footer_len;

        let mut p = footer_start;
        let field_count = read_u32(&blob, &mut p)? as usize;

        let mut by_field: HashMap<String, FieldSection> = HashMap::with_capacity(field_count);
        for _ in 0..field_count {
            let name_len = read_u16(&blob, &mut p)? as usize;
            if p + name_len > n {
                return Err(ReadError::Truncated);
            }
            let name = std::str::from_utf8(&blob[p..p + name_len])
                .map_err(|_| ReadError::Truncated)?
                .to_string();
            p += name_len;
            let algo = read_u8(&blob, &mut p)?;
            if algo != ALGO_SBBF_XXHASH64 {
                return Err(ReadError::BadAlgo(algo));
            }
            let file_count = read_u32(&blob, &mut p)? as usize;
            let mut by_file: HashMap<u64, usize> = HashMap::with_capacity(file_count);
            let mut entries: Vec<FileEntry> = Vec::with_capacity(file_count);
            for _ in 0..file_count {
                let file_id = read_u64(&blob, &mut p)?;
                let body_offset = read_u64(&blob, &mut p)?;
                let body_size = read_u32(&blob, &mut p)?;
                let _n_items = read_u32(&blob, &mut p)?;
                if (body_offset as usize)
                    .checked_add(body_size as usize)
                    .map(|end| end > footer_start)
                    .unwrap_or(true)
                {
                    return Err(ReadError::Truncated);
                }
                let idx = entries.len();
                entries.push(FileEntry {
                    body_offset,
                    body_size,
                    bloom: OnceLock::new(),
                });
                by_file.insert(file_id, idx);
            }
            by_field.insert(name, FieldSection { by_file, entries });
        }
        if p != n - 8 {
            return Err(ReadError::Truncated);
        }

        Ok(Self { blob, by_field })
    }

    /// Number of distinct indexed fields in this blob.
    pub fn field_count(&self) -> usize {
        self.by_field.len()
    }

    pub fn fields(&self) -> impl Iterator<Item = &str> {
        self.by_field.keys().map(String::as_str)
    }

    /// True iff the bloom for `(field, file_id)` *might* contain `value`.
    /// Returns `Ok(true)` when the file or field is unknown to this `.bf`
    /// — callers decide what to do with that (typically: keep the file
    /// because we lack info to rule it out).
    ///
    /// Takes `&self` (interior init via `OnceLock`) so the same
    /// `BloomReader` can be shared via `Arc` across queries without
    /// per-check locking.
    pub fn check(&self, field: &str, file_id: u64, value: &[u8]) -> Result<bool, ReadError> {
        let section = match self.by_field.get(field) {
            Some(s) => s,
            None => return Ok(true),
        };
        let idx = match section.by_file.get(&file_id) {
            Some(i) => *i,
            None => return Ok(true),
        };
        let entry = &section.entries[idx];
        let bloom_result = entry.bloom.get_or_init(|| {
            let start = entry.body_offset as usize;
            let end = start + entry.body_size as usize;
            Sbbf::from_bytes(&self.blob[start..end]).map_err(|e| {
                log::warn!(
                    "bloom: invalid Sbbf bytes for field '{field}', file_id={file_id}: {e}"
                );
                ReadError::InvalidBloom(field.to_string(), file_id, e.to_string())
            })
        });
        match bloom_result {
            Ok(bloom) => Ok(bloom.check(value)),
            Err(e) => Err(e.clone()),
        }
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

    #[test]
    fn test_round_trip_membership_yes_and_no() {
        let blob = build_two_field_blob();
        let r = BloomReader::parse(blob).unwrap();
        assert_eq!(r.field_count(), 2);

        // present items
        assert!(r.check("trace_id", 101, b"abc").unwrap());
        assert!(r.check("trace_id", 101, b"def").unwrap());
        assert!(r.check("trace_id", 102, b"ghi").unwrap());
        assert!(r.check("user_id", 101, b"u-1").unwrap());
        // absent items — overwhelmingly false (FPR ~1%)
        assert!(!r.check("trace_id", 101, b"NOT_PRESENT_xx").unwrap());
        assert!(!r.check("user_id", 101, b"NOT_PRESENT_xx").unwrap());
    }

    #[test]
    fn test_unknown_field_or_file_returns_true() {
        // "no information" is conservative — keep the file in the candidate set.
        let blob = build_two_field_blob();
        let r = BloomReader::parse(blob).unwrap();
        assert!(r.check("nonexistent_field", 101, b"x").unwrap());
        assert!(r.check("trace_id", 999_999, b"x").unwrap());
    }

    #[test]
    fn test_bad_magic_rejected() {
        let mut blob = build_two_field_blob();
        blob[0] = b'X';
        let err = BloomReader::parse(blob).unwrap_err();
        assert!(matches!(err, ReadError::BadMagic));
    }

    #[test]
    fn test_bad_tail_magic_rejected() {
        let mut blob = build_two_field_blob();
        let n = blob.len();
        blob[n - 1] = b'X';
        let err = BloomReader::parse(blob).unwrap_err();
        assert!(matches!(err, ReadError::BadMagic));
    }

    #[test]
    fn test_bad_version_rejected() {
        let mut blob = build_two_field_blob();
        blob[4] = 0xFF;
        let err = BloomReader::parse(blob).unwrap_err();
        assert!(matches!(err, ReadError::BadVersion(0xFF)));
    }

    #[test]
    fn test_truncated_blob_rejected() {
        let blob = build_two_field_blob();
        let truncated = blob[..blob.len() - 5].to_vec();
        let err = BloomReader::parse(truncated).unwrap_err();
        // Without the tail magic it'll trip BadMagic; without footer length it'll
        // trip BadFooter or Truncated. Any failure is acceptable.
        assert!(matches!(
            err,
            ReadError::BadMagic | ReadError::BadFooter(_, _) | ReadError::Truncated
        ));
    }

    #[test]
    fn test_too_short_blob_rejected() {
        let err = BloomReader::parse(vec![0u8; 5]).unwrap_err();
        assert!(matches!(err, ReadError::TooShort(_)));
    }

    #[test]
    fn test_empty_blob_writer_round_trips() {
        let blob = BloomWriter::serialize(vec![]).unwrap();
        let r = BloomReader::parse(blob).unwrap();
        assert_eq!(r.field_count(), 0);
    }

    #[test]
    fn test_observed_fpr_within_bounds() {
        // Sanity check: default fpp 0.01 should give FPR ≈ 1%. Build a bloom
        // with 1k unique strings, query 10k absent strings, expect << 5%
        // false positives.
        let mut b = BloomBuilder::new();
        let idx = b.begin(7, "trace_id", 1000);
        for i in 0..1000u32 {
            b.insert(idx, format!("present-{i}").as_bytes());
        }
        let blob = BloomWriter::serialize(b.finish()).unwrap();
        let r = BloomReader::parse(blob).unwrap();
        let mut fp = 0;
        for i in 0..10_000u32 {
            if r.check("trace_id", 7, format!("absent-{i}").as_bytes())
                .unwrap()
            {
                fp += 1;
            }
        }
        assert!(
            fp < 500,
            "false positive count {fp} > 500 for 10k absent queries (FPR > 5%)"
        );
    }

    /// The bytes inside a `.bf` body for one (file, field) entry must be a
    /// valid stand-alone Parquet column-chunk bloom filter (thrift header +
    /// bitset). Confirm by feeding the slice back through `Sbbf::from_bytes`
    /// and checking membership.
    #[test]
    fn test_per_entry_bytes_are_parquet_compatible() {
        let blob = build_two_field_blob();
        let r = BloomReader::parse(blob.clone()).unwrap();
        // Pull body slice for (trace_id, file 101) by re-walking the footer.
        // Simpler: use the parsed reader via a fresh check call.
        let section = r.by_field.get("trace_id").unwrap();
        let idx = *section.by_file.get(&101).unwrap();
        let entry = &section.entries[idx];
        let start = entry.body_offset as usize;
        let end = start + entry.body_size as usize;
        let standalone = parquet::bloom_filter::Sbbf::from_bytes(&blob[start..end])
            .expect("valid standalone Sbbf");
        // Sbbf::check wants `T: AsBytes`; that's impl'd for `[u8]` (not for
        // fixed-size array literals), so deref `b"..."` to a slice.
        assert!(standalone.check(&b"abc"[..]));
        assert!(standalone.check(&b"def"[..]));
        assert!(!standalone.check(&b"NOT_PRESENT_xx"[..]));
    }
}
