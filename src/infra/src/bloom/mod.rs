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
//!       BODY            (concat of `parquet::bloom_filter::Sbbf::write`
//!                        outputs — each is a thrift-encoded
//!                        BloomFilterHeader followed by the bitset)
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
//! Each per-(file, field) bloom is a `parquet::bloom_filter::Sbbf` written
//! via `Sbbf::write` and read back via `Sbbf::from_bytes`. We rely on the
//! Parquet bloom filter spec for the on-disk format — no custom block
//! layout, no custom hash. `Sbbf::insert` / `check` apply XxHash64
//! internally per spec.

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

// `file_list.id` is the per-file key used inside the `.bf` footer. The
// compactor's post-merge bloom builder runs *after* the file_list INSERT,
// so the assigned id is always available; the search side reads the same
// id directly off the FileKey returned by file_list query. Cast i64→u64
// is safe — file_list ids are sequential u63s.
