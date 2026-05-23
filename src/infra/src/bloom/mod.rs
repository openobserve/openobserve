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
//!       BODY            (concat of raw SBBF bitsets — each is exactly
//!                        `num_blocks × 32` little-endian bytes, no
//!                        header, no framing)
//! ────────────────────────────────────────────
//!       FOOTER          (thrift-free, hand-rolled)
//!         field_count   u32 LE
//!         per field:
//!           name_len    u16 LE
//!           name        bytes
//!           algo        u8           (0x01 = SBBF + gxhash64)
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
//! Each per-(file, field) bloom is our own [`sbbf::Sbbf`] (Parquet's SBBF
//! algorithm, our own bytes). The body is **just the raw bitset**: a
//! contiguous run of 32-byte blocks. Combined with the footer's
//! `body_offset` + `body_size`, this lets the search side fetch any
//! single 32-byte block by absolute offset and run
//! [`sbbf::check_block`] against it without ever loading the surrounding
//! bytes — which is the whole point of switching off
//! `parquet::bloom_filter::Sbbf`'s eagerly-decoded API.

pub mod footer_cache;
pub mod path;
pub mod reader;
pub mod sbbf;
pub mod writer;

pub use footer_cache::{BLOOM_FOOTER_CACHE, BloomFooterCache};
pub use reader::{BloomReader, FieldInspect, ReadError};
pub use sbbf::{BLOCK_BYTES, Sbbf, block_index, check_block, hash_value, num_blocks_for};
pub use writer::{BloomBuilder, BloomWriter, FieldBloom};

/// Magic prefix and suffix for `.bf` files.
pub const MAGIC: &[u8; 4] = b"O2BF";

/// Current `.bf` format version.
pub const VERSION: u8 = 0x01;

/// Algorithm tag for SBBF + gxhash64 (the project-wide default 64-bit
/// hash from `config::utils::hash`). Block layout follows the Parquet
/// SBBF spec; the hash function does not — we own both sides of the
/// `.bf` format so spec compatibility on the hash isn't required.
pub const ALGO_SBBF_GXHASH: u8 = 0x01;

// `file_list.id` is the per-file key used inside the `.bf` footer. The
// compactor's post-merge bloom builder runs *after* the file_list INSERT,
// so the assigned id is always available; the search side reads the same
// id directly off the FileKey returned by file_list query. Cast i64→u64
// is safe — file_list ids are sequential u63s.
