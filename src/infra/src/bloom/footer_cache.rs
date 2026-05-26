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

//! Cross-query cache for `.bf` suffix bytes.
//!
//! The pruner issues a `GetRange::Suffix(N)` to grab the footer (plus a
//! little trailing body) from object storage. The footer payload is small
//! (a few KB), and a `.bf` is **write-once**: its path embeds a microsecond
//! `bloom_ver` and is never overwritten (a rebuild produces a new path; an
//! orphaned `.bf` is deleted, not mutated). So a cached suffix stays valid
//! for the lifetime of the file.
//!
//! On a cache hit the prune step skips the suffix `GET` entirely and parses
//! the footer straight from the cached bytes.
//!
//! This cache only stores the **suffix probe** bytes. The body block-rows a
//! query needs are fetched on demand through the regular `file_data` cache
//! ladder (`memory → disk → remote`) via batched range reads — there is no
//! separate async whole-`.bf` backfill.

use std::sync::LazyLock;

use bytes::{Bytes, BytesMut};

use crate::cache::bytes_cache::BytesCache;

/// 8-byte little-endian prefix encoding the total `.bf` file size that
/// the suffix was sliced from. Lets a cache hit know `total_size`
/// without re-issuing a head request.
const SIZE_HEADER_LEN: usize = 8;

/// Global cache. Sized via [`config::Config::limit::bloom_footer_cache_max_size`]
/// (env: `ZO_BLOOM_FOOTER_CACHE_MAX_SIZE`).
pub static BLOOM_FOOTER_CACHE: LazyLock<BloomFooterCache> = LazyLock::new(|| {
    let max = config::get_config().limit.bloom_footer_cache_max_size;
    BloomFooterCache::new(max)
});

/// Path-keyed cache of `.bf` suffix bytes plus the total file size of
/// the underlying object. Backed by [`crate::cache::bytes_cache::BytesCache`]
/// — FIFO eviction by total bytes.
pub struct BloomFooterCache {
    inner: BytesCache,
}

impl BloomFooterCache {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            inner: BytesCache::new(max_bytes, "bloom_footer_cache".to_string()),
        }
    }

    /// Look up the suffix and the original `.bf` total size for `path`.
    /// Returns `None` on miss or on a corrupted entry (which can only
    /// happen if `put` was called with a future format we don't
    /// recognize — treated like a miss).
    pub fn get(&self, path: &str) -> Option<(u64, Bytes)> {
        let raw = self.inner.get(path)?;
        if raw.len() < SIZE_HEADER_LEN {
            return None;
        }
        let total = u64::from_le_bytes(raw[..SIZE_HEADER_LEN].try_into().ok()?);
        let suffix = raw.slice(SIZE_HEADER_LEN..);
        Some((total, suffix))
    }

    /// Insert. No-op if `path` is already present (BytesCache semantics).
    pub fn put(&self, path: String, total_size: u64, suffix: Bytes) {
        let mut buf = BytesMut::with_capacity(SIZE_HEADER_LEN + suffix.len());
        buf.extend_from_slice(&total_size.to_le_bytes());
        buf.extend_from_slice(&suffix);
        self.inner.put(path, buf.freeze());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_put_get_round_trip() {
        let c = BloomFooterCache::new(1024 * 1024);
        let path = "files/o/bloom/s_logs/2026/05/08/14/123456.bf".to_string();
        let body = Bytes::from_static(b"footer-bytes-here");
        c.put(path.clone(), 100_000, body.clone());

        let (total, suffix) = c.get(&path).expect("hit");
        assert_eq!(total, 100_000);
        assert_eq!(suffix, body);
    }

    #[test]
    fn test_missing_returns_none() {
        let c = BloomFooterCache::new(1024 * 1024);
        assert!(c.get("nope").is_none());
    }

    #[test]
    fn test_duplicate_put_is_noop() {
        let c = BloomFooterCache::new(1024 * 1024);
        c.put("k".to_string(), 10, Bytes::from_static(b"first"));
        // BytesCache::put silently ignores duplicates — the first value
        // should win.
        c.put("k".to_string(), 999, Bytes::from_static(b"second"));
        let (total, suffix) = c.get("k").unwrap();
        assert_eq!(total, 10);
        assert_eq!(suffix.as_ref(), b"first");
    }

    #[test]
    fn test_evicts_under_pressure() {
        // Cap small enough that the second entry forces the first out.
        let c = BloomFooterCache::new(128);
        let big = Bytes::from(vec![0u8; 100]);
        c.put("a".to_string(), 1, big.clone());
        c.put("b".to_string(), 2, big);
        // BytesCache uses FIFO eviction; "a" should be gone.
        assert!(c.get("a").is_none());
        assert!(c.get("b").is_some());
    }
}
