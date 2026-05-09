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

//! `.bf` file format and helpers.
//!
//! A `.bf` is a flat object-store blob containing many per-(file, field)
//! Split-Block Bloom Filters (SBBF — same byte layout as Parquet's per-column
//! bloom). One `.bf` covers a single hour bucket of a stream and is named
//! after the microsecond timestamp at which it was built; see
//! `bloom::path` for the naming scheme.
//!
//! Layout:
//!
//! ```text
//! 0     ────────────────────────────────────
//!       MAGIC      4B   "O2BF"
//!       VERSION    1B   0x01
//! ────────────────────────────────────────────
//!       BODY            (concat of bloom byte arrays)
//! ────────────────────────────────────────────
//!       FOOTER          (thrift-free, hand-rolled)
//!         field_count   u32 LE
//!         per field:
//!           name_len    u16 LE
//!           name        bytes
//!           algo        u8           (0x01 = SBBF/xxhash64)
//!           file_count  u32 LE
//!           per file:
//!             file_id     u64 LE
//!             body_offset u64 LE
//!             body_size   u32 LE
//!             n_items     u32 LE
//! ────────────────────────────────────────────
//!       FOOTER_LEN  4B  (LE)
//!       MAGIC       4B  "O2BF"
//! EOF   ────────────────────────────────────
//! ```
//!
//! Hash function: `XxHash64::oneshot(0, bytes)` to match the Parquet SBBF
//! spec — so existing bloom bytes (e.g. extracted from a Parquet column
//! chunk) could be embedded directly if needed.

pub mod path;
pub mod reader;
pub mod writer;

pub use reader::{BloomReader, ReadError};
pub use writer::{BloomBuilder, BloomWriter, FieldBloom};

/// Magic prefix and suffix for `.bf` files.
pub const MAGIC: &[u8; 4] = b"O2BF";

/// Current `.bf` format version.
pub const VERSION: u8 = 0x01;

/// Algorithm tag for SBBF + XxHash64 (matches Parquet spec).
pub const ALGO_SBBF_XXHASH64: u8 = 0x01;

/// Hash a value the same way Parquet's SBBF does (XxHash64, seed 0).
#[inline]
pub fn sbbf_hash(bytes: &[u8]) -> u64 {
    twox_hash::XxHash64::oneshot(0, bytes)
}

/// Stable per-file identifier used to key blooms inside a `.bf` footer.
///
/// We can't use the `file_list.id` (i64) here because compactor builds
/// the bloom *before* the file_list row is inserted. Hashing the
/// parquet object-store key gives us an identifier that is:
/// - known immediately on the write path,
/// - stable across processes / restarts (deterministic from path),
/// - cheap to compute on the search path (`FileKey::key` is what file_list returns to the querier
///   anyway).
///
/// Collision risk is ~1/2^64 — far below the bucket sizes we care about.
#[inline]
pub fn file_id_from_path(parquet_key: &str) -> u64 {
    twox_hash::XxHash64::oneshot(0xFE_15_F1_1E_FE_15_F1_1E, parquet_key.as_bytes())
}
