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

//! Process-wide cache used while loading PromQL series labels.

use std::sync::{Arc, LazyLock as Lazy};

use config::{
    meta::promql::value::Labels,
    utils::hash::{Sum64, gxhash},
};
use hashbrown::HashSet;
use hashlink::lru_cache::LruCache;
use parking_lot::Mutex;
use rayon::iter::{IntoParallelRefMutIterator, ParallelIterator};

use super::{PartitionedMetrics, load_labels::LoadedLabelsObserver, with_hash_label};

// Shards scale with the query thread count (~4x, rounded to a power of two)
// so lock contention stays low on large queriers; clamped to a sane range.
const MIN_SHARDS: usize = 32;
const MAX_SHARDS: usize = 256;
// Auto budget when ZO_METRICS_LABEL_CACHE_MAX_SIZE is 0: 5% of total memory,
// clamped to [100 MB, 1 GiB] (a typical series costs ~1KB per label set).
const AUTO_MEM_PERCENT: usize = 5;
const AUTO_MIN_BYTES: usize = 100 * 1024 * 1024;
const AUTO_MAX_BYTES: usize = 1024 * 1024 * 1024;
// Fixed per-entry overhead: key + LRU node bookkeeping + Arc header.
const ENTRY_OVERHEAD: usize = 96;
// Fixed per-label overhead: Arc counters + the two String headers + the
// Vec slot holding the Arc pointer.
const LABEL_OVERHEAD: usize = 72;
// Rough per-label size estimate for admission control, before the actual
// label values are known: overhead + ~24 bytes of name/value strings.
const EST_LABEL_BYTES: usize = LABEL_OVERHEAD + 24;
// A single query may claim at most this share of the budget: the cache is
// shared by concurrent queries, so one query must not evict everything.
const ADMIT_MAX_PERCENT: usize = 50;

/// Process-wide cache of series labels keyed by (context fingerprint, series
/// hash), bounded by memory size. Labels are immutable per series hash, so
/// entries never need invalidation, only LRU eviction.
struct LabelCache {
    shards: Vec<Mutex<Shard>>,
    shard_mask: u64,
    max_bytes: usize,
    shard_max_bytes: usize,
}

struct Shard {
    /// The accounted size is stored with the entry so eviction never has to
    /// walk the label set to re-derive it.
    lru: LruCache<(u64, u64), (Arc<Labels>, usize)>,
    bytes: usize,
}

static LABEL_CACHE: Lazy<LabelCache> = Lazy::new(|| {
    let cfg = config::get_config();
    let max_bytes = if cfg.limit.metrics_label_cache_max_size > 0 {
        cfg.limit.metrics_label_cache_max_size * 1024 * 1024
    } else {
        (cfg.limit.mem_total * AUTO_MEM_PERCENT / 100).clamp(AUTO_MIN_BYTES, AUTO_MAX_BYTES)
    };
    let shard_count = (cfg.limit.cpu_num * 4)
        .next_power_of_two()
        .clamp(MIN_SHARDS, MAX_SHARDS);
    LabelCache::new(max_bytes, shard_count)
});

/// The series a query still has to recover from a label scan after the cache
/// was consulted, and the cache decisions that follow from them.
pub(super) struct CacheMisses {
    ctx_fp: u64,
    series_count: usize,
    /// per-partition hashes that missed the cache
    per_partition: Vec<Vec<u64>>,
    count: usize,
}

impl CacheMisses {
    fn new(ctx_fp: u64, series_count: usize, per_partition: Vec<Vec<u64>>) -> Self {
        Self {
            ctx_fp,
            series_count,
            count: per_partition.iter().map(Vec::len).sum(),
            per_partition,
        }
    }

    pub(super) fn count(&self) -> usize {
        self.count
    }

    pub(super) fn hits(&self) -> usize {
        self.series_count - self.count
    }

    pub(super) fn is_empty(&self) -> bool {
        self.count == 0
    }

    fn all_missing(&self) -> bool {
        self.count == self.series_count
    }

    pub(super) fn hashes(&self) -> impl Iterator<Item = u64> + '_ {
        self.per_partition.iter().flatten().copied()
    }

    /// Returns an observer that writes extracted source labels to this cache,
    /// or `None` when this query's working set is too large to admit.
    pub(super) fn write_observer(
        &self,
        trace_id: &str,
        label_col_count: usize,
    ) -> Option<Arc<dyn LoadedLabelsObserver>> {
        // stored labels exclude the hash column
        let admitted = LABEL_CACHE.admit(label_col_count.saturating_sub(1), self.count);
        if !admitted {
            log::info!(
                "[trace_id: {trace_id}] label cache writes bypassed: {} misses x {label_col_count} label cols exceeds the cache budget",
                self.count,
            );
        }
        admitted.then(|| {
            Arc::new(CacheWriter {
                ctx_fp: self.ctx_fp,
            }) as Arc<dyn LoadedLabelsObserver>
        })
    }

    /// Per-partition membership sets for the scan, or `None` (attach every
    /// scanned series) when every series missed.
    pub(super) fn into_selected_hashes(self) -> Option<Vec<HashSet<u64>>> {
        (!self.all_missing()).then(|| {
            self.per_partition
                .into_iter()
                .map(|hashes| hashes.into_iter().collect())
                .collect()
        })
    }
}

/// Fingerprint of the query context a cached label set belongs to.
fn context_fingerprint(org_id: &str, stream_name: &str, label_cols: &[String]) -> u64 {
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

struct CacheWriter {
    ctx_fp: u64,
}

impl LoadedLabelsObserver for CacheWriter {
    fn observe(&self, hash: u64, labels: &Labels) {
        LABEL_CACHE.put(self.ctx_fp, hash, Arc::new(labels.clone()));
    }
}

/// Attach cached labels partition-parallel and describe the series that still
/// need to be loaded. Reads are never admission-gated because they cannot grow
/// the cache and remain useful even when this query is too large to write back.
pub(super) fn attach_cached_labels(
    org_id: &str,
    table_name: &str,
    label_col_names: &[String],
    include_hash_label: bool,
    metrics: &mut PartitionedMetrics,
) -> CacheMisses {
    let ctx_fp = context_fingerprint(org_id, table_name, label_col_names);
    let per_partition: Vec<Vec<u64>> = metrics
        .par_iter_mut()
        .map(|partition| {
            partition
                .iter_mut()
                .filter_map(|(hash, range_val)| match LABEL_CACHE.get(ctx_fp, *hash) {
                    Some(labels) => {
                        // Materialize outside the shard lock; this clones only
                        // the Arc pointers held by the cached label set.
                        range_val.labels =
                            with_hash_label(labels.to_vec(), *hash, include_hash_label);
                        None
                    }
                    None => Some(*hash),
                })
                .collect()
        })
        .collect();

    let misses = CacheMisses::new(
        ctx_fp,
        metrics.iter().map(|partition| partition.len()).sum(),
        per_partition,
    );
    config::metrics::QUERY_METRICS_LABEL_CACHE_HIT_COUNT
        .with_label_values(&[org_id])
        .inc_by(misses.hits() as u64);
    config::metrics::QUERY_METRICS_LABEL_CACHE_MISS_COUNT
        .with_label_values(&[org_id])
        .inc_by(misses.count() as u64);
    misses
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
    fn new(max_bytes: usize, shard_count: usize) -> Self {
        debug_assert!(shard_count.is_power_of_two());
        Self {
            shards: (0..shard_count)
                .map(|_| {
                    Mutex::new(Shard {
                        lru: LruCache::new_unbounded(),
                        bytes: 0,
                    })
                })
                .collect(),
            shard_mask: shard_count as u64 - 1,
            max_bytes,
            shard_max_bytes: max_bytes / shard_count,
        }
    }

    /// Returns false when the estimated working set exceeds a single query's
    /// share of the budget, so the caller should bypass cache writes instead
    /// of thrashing it. Reads are never gated: a lookup cannot grow the cache.
    fn admit(&self, label_count: usize, series_count: usize) -> bool {
        let est_entry =
            ENTRY_OVERHEAD + std::mem::size_of::<Labels>() + label_count * EST_LABEL_BYTES;
        series_count.saturating_mul(est_entry) <= self.max_bytes * ADMIT_MAX_PERCENT / 100
    }

    fn shard(&self, series_hash: u64) -> &Mutex<Shard> {
        &self.shards[(series_hash & self.shard_mask) as usize]
    }

    /// A hit clones only the `Arc`, keeping the critical section short.
    fn get(&self, ctx_fp: u64, series_hash: u64) -> Option<Arc<Labels>> {
        self.shard(series_hash)
            .lock()
            .lru
            .get(&(ctx_fp, series_hash))
            .map(|(labels, _)| Arc::clone(labels))
    }

    /// A shard at its budget evicts on every insert, so eviction reads the
    /// accounted size back from the entry instead of walking the label set to
    /// re-derive it.
    fn put(&self, ctx_fp: u64, series_hash: u64, labels: Arc<Labels>) {
        let size = entry_size(&labels);
        if size > self.shard_max_bytes {
            return;
        }
        let mut shard = self.shard(series_hash).lock();
        if let Some((_, old_size)) = shard.lru.insert((ctx_fp, series_hash), (labels, size)) {
            shard.bytes -= old_size;
        }
        shard.bytes += size;
        while shard.bytes > self.shard_max_bytes {
            let Some((_, (_, old_size))) = shard.lru.remove_lru() else {
                break;
            };
            shard.bytes -= old_size;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::{
        HASH_LABEL,
        value::{Label, RangeValue},
    };
    use hashbrown::HashMap;

    use super::*;

    const TEST_SHARDS: usize = 32;

    fn make_labels(count: usize, value_len: usize) -> Arc<Labels> {
        Arc::new(
            (0..count)
                .map(|i| {
                    Arc::new(Label {
                        name: format!("label_{i}"),
                        value: "v".repeat(value_len),
                    })
                })
                .collect(),
        )
    }

    #[test]
    fn test_label_cache_get_put() {
        let cache = LabelCache::new(1024 * 1024, TEST_SHARDS);
        let labels = make_labels(1, 8);
        assert!(cache.get(1, 42).is_none());
        cache.put(1, 42, Arc::clone(&labels));
        let got = cache.get(1, 42).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "label_0");
        // a hit shares the stored label set instead of copying it
        assert!(Arc::ptr_eq(&got, &labels));
        // different context fingerprint must miss
        assert!(cache.get(2, 42).is_none());
    }

    #[test]
    fn test_label_cache_evicts_by_memory() {
        // budget of ~4 entries per shard; inserting many keys that land in
        // the same shard must evict the oldest ones instead of growing
        let labels = make_labels(4, 32);
        let per_entry = entry_size(&labels);
        let cache = LabelCache::new(per_entry * 4 * TEST_SHARDS, TEST_SHARDS);
        // same shard: series hashes differ by TEST_SHARDS
        let hashes: Vec<u64> = (0..8).map(|i| 42 + i * TEST_SHARDS as u64).collect();
        for &h in &hashes {
            cache.put(1, h, Arc::clone(&labels));
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
    fn test_shard_routing_covers_every_shard() {
        let cache = LabelCache::new(1024 * 1024, TEST_SHARDS);
        let shards = (0..TEST_SHARDS as u64)
            .map(|hash| std::ptr::from_ref(cache.shard(hash)))
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(shards.len(), TEST_SHARDS);
        // masking keeps routing stable past the shard count
        assert!(std::ptr::eq(
            cache.shard(0),
            cache.shard(TEST_SHARDS as u64)
        ));
    }

    #[test]
    fn test_admit_bypasses_oversized_working_sets() {
        let cache = LabelCache::new(1024 * 1024, TEST_SHARDS); // 1MB budget
        // small working set: admitted
        assert!(cache.admit(10, 100));
        // ~10k series x ~1KB estimated entries >> 1MB: bypassed
        assert!(!cache.admit(10, 10_000));
        // huge series count must not overflow
        assert!(!cache.admit(20, usize::MAX / 2));
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

    #[test]
    fn test_attach_cached_labels_returns_partitioned_selection() {
        let table = "attach_cached_labels_returns_partitioned_selection";
        let ctx_fp = context_fingerprint("org", table, &[]);
        let cached = Arc::new(vec![Arc::new(Label {
            name: "instance".to_string(),
            value: "cached".to_string(),
        })]);
        LABEL_CACHE.put(ctx_fp, 11, Arc::clone(&cached));
        let mut metrics = vec![
            HashMap::from([(11, RangeValue::default())]),
            HashMap::from([(22, RangeValue::default())]),
        ];

        let misses = attach_cached_labels("org", table, &[], true, &mut metrics);

        assert_eq!(misses.hashes().collect::<Vec<_>>(), vec![22]);
        assert_eq!(misses.count(), 1);
        assert_eq!(misses.hits(), 1);
        assert!(!misses.is_empty());
        let labels = &metrics[0][&11].labels;
        assert_eq!(labels.len(), 2);
        assert_eq!(labels[0].name, HASH_LABEL);
        assert_eq!(labels[0].value, "11");
        assert!(Arc::ptr_eq(&labels[1], &cached[0]));
        assert!(metrics[1][&22].labels.is_empty());
        assert_eq!(
            misses.into_selected_hashes(),
            Some(vec![HashSet::new(), HashSet::from([22])])
        );
    }

    #[test]
    fn test_write_observer_caches_only_source_labels() {
        let ctx_fp = context_fingerprint("org", "write_observer_caches_source_labels", &[]);
        let misses = CacheMisses::new(ctx_fp, 1, vec![vec![11]]);
        let observer = misses.write_observer("test", 2).unwrap();
        let labels = vec![Arc::new(Label {
            name: "instance".to_string(),
            value: "api".to_string(),
        })];

        observer.observe(11, &labels);

        let cached = LABEL_CACHE.get(ctx_fp, 11).unwrap();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].name, "instance");
        assert_eq!(cached[0].value, "api");
    }
}
