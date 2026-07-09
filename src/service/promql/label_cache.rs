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

use std::sync::LazyLock as Lazy;

use config::{
    meta::promql::value::Labels,
    utils::hash::{Sum64, gxhash},
};
use hashlink::lru_cache::LruCache;
use parking_lot::Mutex;

const SHARD_COUNT: usize = 32;
// Max number of series label sets kept in memory. Roughly 0.5-2KB per entry
// depending on label sizes.
const MAX_ENTRIES: usize = 262144;

/// Process-wide cache of series labels keyed by (context fingerprint, series
/// hash).
///
/// A series' label set is immutable — the series hash stored with each sample
/// is derived from the labels at ingest time — so entries never need
/// invalidation, only LRU eviction. The context fingerprint covers org,
/// stream, and the projected label columns, because column pruning changes
/// which labels are loaded for the same series hash.
pub(crate) struct LabelCache {
    shards: Vec<Mutex<LruCache<(u64, u64), Labels>>>,
}

pub(crate) static LABEL_CACHE: Lazy<LabelCache> = Lazy::new(|| {
    let per_shard = MAX_ENTRIES.div_ceil(SHARD_COUNT);
    LabelCache {
        shards: (0..SHARD_COUNT)
            .map(|_| Mutex::new(LruCache::new(per_shard)))
            .collect(),
    }
});

/// Fingerprint of the query context a cached label set belongs to.
pub(crate) fn context_fingerprint(org_id: &str, stream_name: &str, label_cols: &[String]) -> u64 {
    let mut key = String::with_capacity(64);
    key.push_str(org_id);
    key.push('\u{0}');
    key.push_str(stream_name);
    for col in label_cols {
        key.push('\u{0}');
        key.push_str(col);
    }
    gxhash::new().sum64(&key)
}

impl LabelCache {
    fn shard(&self, series_hash: u64) -> &Mutex<LruCache<(u64, u64), Labels>> {
        &self.shards[(series_hash % SHARD_COUNT as u64) as usize]
    }

    pub fn get(&self, ctx_fp: u64, series_hash: u64) -> Option<Labels> {
        self.shard(series_hash)
            .lock()
            .get(&(ctx_fp, series_hash))
            .cloned()
    }

    pub fn put(&self, ctx_fp: u64, series_hash: u64, labels: Labels) {
        self.shard(series_hash)
            .lock()
            .insert((ctx_fp, series_hash), labels);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::Label;

    use super::*;

    #[test]
    fn test_label_cache_get_put() {
        let cache = LabelCache {
            shards: (0..SHARD_COUNT)
                .map(|_| Mutex::new(LruCache::new(4)))
                .collect(),
        };
        let labels = vec![Arc::new(Label {
            name: "namespace".to_string(),
            value: "abc".to_string(),
        })];
        assert!(cache.get(1, 42).is_none());
        cache.put(1, 42, labels.clone());
        let got = cache.get(1, 42).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "namespace");
        // different context fingerprint must miss
        assert!(cache.get(2, 42).is_none());
    }

    #[test]
    fn test_context_fingerprint_depends_on_projection() {
        let col_a = "a".to_string();
        let col_b = "b".to_string();
        let fp1 = context_fingerprint("org", "stream", std::slice::from_ref(&col_a));
        let fp2 = context_fingerprint("org", "stream", &[col_a.clone(), col_b]);
        let fp3 = context_fingerprint("org", "stream", &[col_a]);
        assert_ne!(fp1, fp2);
        assert_eq!(fp1, fp3);
    }
}
