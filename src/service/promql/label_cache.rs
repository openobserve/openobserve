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

use std::sync::{Arc, LazyLock as Lazy};

use config::{
    meta::promql::value::{Label, Labels},
    utils::hash::{Sum64, gxhash},
};
use hashlink::lru_cache::LruCache;
use parking_lot::Mutex;

const SHARD_COUNT: usize = 32;
// Auto budget when ZO_METRICS_LABEL_CACHE_MAX_SIZE is 0: 5% of total memory,
// clamped to [100 MB, 1 GiB] (a typical series costs ~1KB per label set).
const AUTO_MEM_PERCENT: usize = 5;
const AUTO_MIN_BYTES: usize = 100 * 1024 * 1024;
const AUTO_MAX_BYTES: usize = 1024 * 1024 * 1024;
// Fixed per-entry overhead: key + LRU node bookkeeping.
const ENTRY_OVERHEAD: usize = 80;
// Fixed per-label overhead: Arc counters + the two String headers + the
// Vec slot holding the Arc pointer.
const LABEL_OVERHEAD: usize = 72;

/// Process-wide cache of series labels keyed by (context fingerprint, series
/// hash), bounded by memory size rather than entry count — label sets vary
/// wildly in size, so an entry cap can blow memory long before it is reached.
///
/// A series' label set is immutable — the series hash stored with each sample
/// is derived from the labels at ingest time — so entries never need
/// invalidation, only LRU eviction. The context fingerprint covers org,
/// stream, and the projected label columns, because column pruning changes
/// which labels are loaded for the same series hash.
pub(crate) struct LabelCache {
    shards: Vec<Mutex<Shard>>,
    shard_max_bytes: usize,
}

struct Shard {
    lru: LruCache<(u64, u64), Labels>,
    bytes: usize,
}

pub(crate) static LABEL_CACHE: Lazy<LabelCache> = Lazy::new(|| {
    let cfg = config::get_config();
    let max_bytes = if cfg.limit.metrics_label_cache_max_size > 0 {
        cfg.limit.metrics_label_cache_max_size * 1024 * 1024
    } else {
        (cfg.limit.mem_total * AUTO_MEM_PERCENT / 100).clamp(AUTO_MIN_BYTES, AUTO_MAX_BYTES)
    };
    LabelCache::new(max_bytes)
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

fn entry_size(labels: &Labels) -> usize {
    ENTRY_OVERHEAD
        + std::mem::size_of::<Labels>()
        + labels
            .iter()
            .map(|label| LABEL_OVERHEAD + label.name.len() + label.value.len())
            .sum::<usize>()
}

impl LabelCache {
    fn new(max_bytes: usize) -> Self {
        Self {
            shards: (0..SHARD_COUNT)
                .map(|_| {
                    Mutex::new(Shard {
                        lru: LruCache::new_unbounded(),
                        bytes: 0,
                    })
                })
                .collect(),
            shard_max_bytes: max_bytes / SHARD_COUNT,
        }
    }

    fn shard(&self, series_hash: u64) -> &Mutex<Shard> {
        &self.shards[(series_hash % SHARD_COUNT as u64) as usize]
    }

    pub fn get(&self, ctx_fp: u64, series_hash: u64) -> Option<Labels> {
        self.shard(series_hash)
            .lock()
            .lru
            .get(&(ctx_fp, series_hash))
            .cloned()
    }

    pub fn put(&self, ctx_fp: u64, series_hash: u64, labels: Labels) {
        let size = entry_size(&labels);
        if size > self.shard_max_bytes {
            return;
        }
        let mut shard = self.shard(series_hash).lock();
        if let Some(old) = shard.lru.insert((ctx_fp, series_hash), labels) {
            shard.bytes -= entry_size(&old);
        }
        shard.bytes += size;
        while shard.bytes > self.shard_max_bytes {
            let Some((_, evicted)) = shard.lru.remove_lru() else {
                break;
            };
            shard.bytes -= entry_size(&evicted);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_labels(count: usize, value_len: usize) -> Labels {
        (0..count)
            .map(|i| {
                Arc::new(Label {
                    name: format!("label_{i}"),
                    value: "v".repeat(value_len),
                })
            })
            .collect()
    }

    #[test]
    fn test_label_cache_get_put() {
        let cache = LabelCache::new(1024 * 1024);
        let labels = make_labels(1, 8);
        assert!(cache.get(1, 42).is_none());
        cache.put(1, 42, labels.clone());
        let got = cache.get(1, 42).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "label_0");
        // different context fingerprint must miss
        assert!(cache.get(2, 42).is_none());
    }

    #[test]
    fn test_label_cache_evicts_by_memory() {
        // budget of ~4 entries per shard; inserting many keys that land in
        // the same shard must evict the oldest ones instead of growing
        let labels = make_labels(4, 32);
        let per_entry = entry_size(&labels);
        let cache = LabelCache::new(per_entry * 4 * SHARD_COUNT);
        // same shard: series hashes differ by SHARD_COUNT
        let hashes: Vec<u64> = (0..8).map(|i| 42 + i * SHARD_COUNT as u64).collect();
        for &h in &hashes {
            cache.put(1, h, labels.clone());
        }
        let cached = hashes
            .iter()
            .filter(|&&h| cache.get(1, h).is_some())
            .count();
        assert!(cached <= 4, "expected eviction, {cached} entries cached");
        // most recently inserted entry must survive
        assert!(cache.get(1, *hashes.last().unwrap()).is_some());
        // an entry larger than the whole shard budget is not cached
        let huge = make_labels(64, 64 * 1024);
        cache.put(1, 7, huge);
        assert!(cache.get(1, 7).is_none());
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
