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

use std::{
    collections::HashSet,
    sync::{
        Arc, LazyLock as Lazy,
        atomic::{AtomicUsize, Ordering},
    },
};

use arrow::buffer::BooleanBuffer;
use config::{
    memory::{MemoryConsumer, memory_budget},
    metrics,
};
use dashmap::{DashMap, mapref::entry::Entry};
use infra::cache::recency::{EvictedKeys, Recency, now_secs};

use super::TantivyResult;

pub static GLOBAL_CACHE: Lazy<Arc<TantivyResultCache>> =
    Lazy::new(|| Arc::new(TantivyResultCache::default()));

#[derive(Debug, Clone)]
pub enum CacheEntry {
    RowIds(Arc<BooleanBuffer>),              // matched row ids bitmap
    SelectCandidates(Arc<Vec<(i64, u32)>>),  // (_timestamp, doc_id) pairs
    Count(usize),                            // simple count optimization
    Histogram(Vec<u64>),                     // simple histogram optimization
    MultiHistogram(Vec<(i64, String, u64)>), // multi histogram optimization
    TopN(Vec<(Vec<String>, u64)>),           // group by top n optimization (1..=4 fields)
    Distinct(HashSet<String>),               // simple distinct optimization
}

impl From<CacheEntry> for TantivyResult {
    fn from(entry: CacheEntry) -> Self {
        match entry {
            CacheEntry::RowIds(row_ids) => TantivyResult::RowIdsSelection(row_ids),
            CacheEntry::SelectCandidates(candidates) => TantivyResult::SelectCandidates(candidates),
            CacheEntry::Count(count) => TantivyResult::Count(count),
            CacheEntry::Histogram(histogram) => TantivyResult::Histogram(histogram),
            CacheEntry::MultiHistogram(multi_histogram) => {
                TantivyResult::MultiHistogram(multi_histogram)
            }
            CacheEntry::TopN(top_n) => TantivyResult::TopN(top_n),
            CacheEntry::Distinct(distinct) => TantivyResult::Distinct(distinct),
        }
    }
}

impl CacheEntry {
    pub fn get_memory_size(&self) -> usize {
        match self {
            CacheEntry::RowIds(packed) => {
                packed.inner().len() + std::mem::size_of::<BooleanBuffer>()
            }
            CacheEntry::SelectCandidates(candidates) => {
                candidates.capacity() * std::mem::size_of::<(i64, u32)>()
                    + std::mem::size_of::<Vec<(i64, u32)>>()
            }
            CacheEntry::Count(_) => std::mem::size_of::<usize>(),
            CacheEntry::Histogram(histogram) => {
                histogram.capacity() * std::mem::size_of::<u64>() + std::mem::size_of::<Vec<u64>>()
            }
            CacheEntry::MultiHistogram(multi_histogram) => {
                multi_histogram.capacity() * std::mem::size_of::<(i64, String, u64)>()
                    + multi_histogram
                        .iter()
                        .map(|(_, s, _)| s.capacity())
                        .sum::<usize>()
                    + std::mem::size_of::<Vec<(i64, String, u64)>>()
            }
            CacheEntry::TopN(top_n) => {
                top_n.capacity() * std::mem::size_of::<(Vec<String>, u64)>()
                    + top_n
                        .iter()
                        .map(|(keys, _)| {
                            keys.capacity() * std::mem::size_of::<String>()
                                + keys.iter().map(|s| s.capacity()).sum::<usize>()
                        })
                        .sum::<usize>()
                    + std::mem::size_of::<Vec<(Vec<String>, u64)>>()
            }
            // A hash set slot holds the String plus one control byte.
            CacheEntry::Distinct(distinct) => {
                distinct.capacity() * (std::mem::size_of::<String>() + 1)
                    + distinct.iter().map(|s| s.capacity()).sum::<usize>()
                    + std::mem::size_of::<HashSet<String>>()
            }
        }
    }
}

/// Cache created for storing the tantivy result, bounded by bytes.
pub struct TantivyResultCache {
    readers: DashMap<String, ResultEntry>,
    evicting: parking_lot::Mutex<()>,
    evicted: EvictedKeys,
    mem_size: AtomicUsize,
    max_size: usize,
}

impl TantivyResultCache {
    pub fn new(max_size: usize) -> Self {
        Self {
            readers: DashMap::new(),
            evicting: parking_lot::Mutex::new(()),
            evicted: EvictedKeys::new(),
            mem_size: AtomicUsize::new(0),
            max_size,
        }
    }

    pub fn get(&self, key: &str) -> Option<TantivyResult> {
        self.lookup(key, now_secs()).map(TantivyResult::from)
    }

    pub fn put(&self, key: String, value: CacheEntry) -> Option<CacheEntry> {
        self.insert(key, value, now_secs())
    }

    pub fn len(&self) -> usize {
        self.readers.len()
    }

    pub fn is_empty(&self) -> bool {
        self.readers.is_empty()
    }

    pub fn memory_size(&self) -> usize {
        self.mem_size.load(Ordering::Relaxed)
    }

    fn lookup(&self, key: &str, now: u32) -> Option<CacheEntry> {
        if let Some(entry) = self.readers.get(key) {
            entry.recency.touch(now);
            return Some(entry.value.clone());
        }
        if self.evicted.take(key) {
            metrics::TANTIVY_RESULT_CACHE_REREAD_MISS_TOTAL
                .with_label_values::<&str>(&[])
                .inc();
        }
        None
    }

    /// An entry larger than the whole cache is not stored.
    fn insert(&self, key: String, value: CacheEntry, now: u32) -> Option<CacheEntry> {
        let size = entry_size(&key, &value);
        if size > self.max_size {
            return None;
        }
        if self.memory_size() + size > self.max_size {
            self.evict(size);
        }
        let entry = ResultEntry {
            value,
            recency: Recency::new(now),
        };
        self.track_add(size);
        match self.readers.entry(key) {
            Entry::Occupied(mut occupied) => {
                let old = occupied.insert(entry);
                self.track_sub(entry_size(occupied.key(), &old.value));
                Some(old.value)
            }
            Entry::Vacant(vacant) => {
                vacant.insert(entry);
                None
            }
        }
    }

    /// Drops the least recently read entries until 10% of `max_size` and `incoming` fit.
    fn evict(&self, incoming: usize) {
        // Another thread is evicting; the next insert still over the limit evicts again.
        let Some(_evicting) = self.evicting.try_lock() else {
            return;
        };
        if self.memory_size() + incoming <= self.max_size {
            return;
        }
        metrics::TANTIVY_RESULT_CACHE_GC_TOTAL
            .with_label_values::<&str>(&[])
            .inc();
        let target = (self.max_size - self.max_size / 10).min(self.max_size - incoming);
        let mut coldest = self
            .readers
            .iter()
            .map(|entry| (entry.recency.rank(), entry.key().clone()))
            .collect::<Vec<_>>();
        coldest.sort_unstable();
        for (rank, key) in coldest {
            if self.memory_size() <= target {
                break;
            }
            // An entry read or replaced after the snapshot has a new rank and stays.
            if let Some((key, entry)) = self
                .readers
                .remove_if(&key, |_, entry| entry.recency.rank() == rank)
            {
                self.track_sub(entry_size(&key, &entry.value));
                self.evicted.record(&key);
            }
        }
    }

    fn track_add(&self, size: usize) {
        self.mem_size.fetch_add(size, Ordering::Relaxed);
        metrics::TANTIVY_RESULT_CACHE_MEMORY_USAGE
            .with_label_values::<&str>(&[])
            .add(size as i64);
    }

    fn track_sub(&self, size: usize) {
        self.mem_size.fetch_sub(size, Ordering::Relaxed);
        metrics::TANTIVY_RESULT_CACHE_MEMORY_USAGE
            .with_label_values::<&str>(&[])
            .sub(size as i64);
    }
}

impl Default for TantivyResultCache {
    fn default() -> Self {
        Self::new(memory_budget().quota(MemoryConsumer::IndexResultCache))
    }
}

struct ResultEntry {
    value: CacheEntry,
    recency: Recency,
}

fn entry_size(key: &str, value: &CacheEntry) -> usize {
    value.get_memory_size() + size_of::<String>() + key.len()
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, sync::Arc, time::Duration};

    use super::*;

    const TEST_MAX_SIZE: usize = 1024 * 1024;

    /// A cap that fits exactly `n` entries of `value` under keys as long as `key`.
    fn cap_for(n: usize, key: &str, value: &CacheEntry) -> usize {
        n * entry_size(key, value)
    }

    fn tracked_size(cache: &TantivyResultCache) -> usize {
        cache
            .readers
            .iter()
            .map(|r| entry_size(r.key(), &r.value().value))
            .sum()
    }

    fn create_test_tantivy_result() -> CacheEntry {
        CacheEntry::RowIds(Arc::new(BooleanBuffer::from_iter(
            (0..64u32).map(|i| [10u32, 20, 30].contains(&i)),
        )))
    }

    fn create_test_count_result() -> CacheEntry {
        CacheEntry::Count(42)
    }

    fn create_test_histogram_result() -> CacheEntry {
        CacheEntry::Histogram(vec![10, 20, 30, 40])
    }

    fn create_test_top_n_result() -> CacheEntry {
        CacheEntry::TopN(vec![
            (vec!["key1".to_string()], 100),
            (vec!["key2".to_string()], 200),
            (vec!["key3".to_string(), "sub1".to_string()], 300),
        ])
    }

    fn create_test_distinct_result() -> CacheEntry {
        let mut distinct = HashSet::new();
        distinct.insert("value1".to_string());
        distinct.insert("value2".to_string());
        distinct.insert("value3".to_string());
        CacheEntry::Distinct(distinct)
    }

    fn create_test_row_ids_result() -> CacheEntry {
        CacheEntry::RowIds(Arc::new(BooleanBuffer::from_iter(
            (0..64u32).map(|i| [10u32, 20, 30].contains(&i)),
        )))
    }

    #[test]
    fn test_tantivy_result_cache_new() {
        let cache = TantivyResultCache::new(10);
        assert_eq!(cache.max_size, 10);
        assert_eq!(cache.memory_size(), 0);
    }

    #[test]
    fn test_tantivy_result_cache_put_and_get() {
        let cache = TantivyResultCache::new(TEST_MAX_SIZE);
        let key = "test_key".to_string();
        let result = create_test_tantivy_result();

        assert!(cache.get(&key).is_none());
        cache.put(key.clone(), result.clone());
        let retrieved = cache.get(&key);
        assert!(retrieved.is_some());
        match retrieved.unwrap() {
            TantivyResult::RowIdsSelection(row_ids) => {
                assert_eq!(row_ids.set_indices().collect::<Vec<_>>(), vec![10, 20, 30]);
            }
            _ => panic!("Expected RowIdsSelection result"),
        }
    }

    #[test]
    fn test_tantivy_result_cache_get_nonexistent() {
        let cache = TantivyResultCache::new(TEST_MAX_SIZE);
        let result = cache.get("nonexistent_key");
        assert!(result.is_none());
    }

    #[test]
    fn test_tantivy_result_cache_multiple_entries() {
        let cache = TantivyResultCache::new(TEST_MAX_SIZE);

        cache.put("count_key".to_string(), create_test_count_result());
        cache.put("histogram_key".to_string(), create_test_histogram_result());
        cache.put("topn_key".to_string(), create_test_top_n_result());
        cache.put("distinct_key".to_string(), create_test_distinct_result());
        cache.put("row_ids_key".to_string(), create_test_row_ids_result());

        assert!(cache.get("count_key").is_some());
        assert!(cache.get("histogram_key").is_some());
        assert!(cache.get("topn_key").is_some());
        assert!(cache.get("distinct_key").is_some());
        assert!(cache.get("row_ids_key").is_some());

        if let Some(TantivyResult::Count(count)) = cache.get("count_key") {
            assert_eq!(count, 42);
        } else {
            panic!("Expected Count result");
        }

        if let Some(TantivyResult::Histogram(histogram)) = cache.get("histogram_key") {
            assert_eq!(histogram, vec![10, 20, 30, 40]);
        } else {
            panic!("Expected Histogram result");
        }
    }

    #[test]
    fn test_tantivy_result_cache_eviction() {
        let cache = TantivyResultCache::new(cap_for(5, "key_0", &create_test_count_result()));

        for i in 0..10 {
            let key = format!("key_{i}");
            let result = create_test_count_result();
            cache.put(key, result);
        }

        assert!(cache.get("key_0").is_none());
        assert!(cache.get("key_9").is_some());
    }

    #[test]
    fn test_eviction_keeps_recently_read_entry_over_newer_unread_ones() {
        let cache = TantivyResultCache::new(cap_for(10, "hot_00", &create_test_count_result()));
        cache.insert("hot_00".to_string(), create_test_count_result(), 1);
        for i in 0..9 {
            cache.insert(format!("cold_{i}"), create_test_count_result(), 2 * i + 2);
            assert!(cache.lookup("hot_00", 2 * i + 3).is_some());
        }
        cache.insert("new_00".to_string(), create_test_count_result(), 30);

        assert!(
            cache.lookup("hot_00", 31).is_some(),
            "hot entry was evicted"
        );
        assert!(cache.lookup("cold_0", 31).is_none());
        assert!(!cache.evicted.take("cold_0"), "re-read counted twice");
        assert!(cache.lookup("cold_1", 31).is_some());
        assert!(cache.lookup("new_00", 31).is_some());
        assert!(!cache.evicted.take("never_cached"));
    }

    #[test]
    fn test_put_does_not_wait_for_a_running_eviction() {
        let cache = Arc::new(TantivyResultCache::new(cap_for(
            1,
            "key1",
            &create_test_count_result(),
        )));
        cache.put("key1".to_string(), create_test_count_result());
        let held = cache.evicting.lock();
        let (done, finished) = std::sync::mpsc::channel();
        let writer = cache.clone();
        std::thread::spawn(move || {
            writer.put("key2".to_string(), create_test_count_result());
            done.send(()).unwrap();
        });
        assert!(
            finished.recv_timeout(Duration::from_secs(5)).is_ok(),
            "put waited for the running eviction"
        );
        assert_eq!(cache.len(), 2);
        drop(held);
        cache.put("key3".to_string(), create_test_count_result());
        assert!(cache.get("key1").is_none());
        assert!(cache.get("key3").is_some());
    }

    #[test]
    fn test_tantivy_result_cache_overwrite_existing() {
        let cache = TantivyResultCache::new(TEST_MAX_SIZE);
        let key = "test_key".to_string();
        let result1 = create_test_count_result();
        let result2 = create_test_histogram_result();

        cache.put(key.clone(), result1.clone());
        let old_entry = cache.put(key.clone(), result2.clone());

        assert!(old_entry.is_some());
        if let Some(CacheEntry::Count(count)) = old_entry {
            assert_eq!(count, 42);
        } else {
            panic!("Expected Count result");
        }

        let retrieved = cache.get(&key).unwrap();
        if let TantivyResult::Histogram(histogram) = retrieved {
            assert_eq!(histogram, vec![10, 20, 30, 40]);
        } else {
            panic!("Expected Histogram result");
        }
    }

    #[tokio::test]
    async fn test_tantivy_result_cache_concurrent_access() {
        let cache = Arc::new(TantivyResultCache::new(TEST_MAX_SIZE));
        let mut handles = vec![];

        for i in 0..10 {
            let cache_clone = cache.clone();
            let handle = tokio::spawn(async move {
                let key = format!("concurrent_key_{i}");
                let result = create_test_count_result();

                cache_clone.put(key.clone(), result.clone());
                let retrieved = cache_clone.get(&key);
                assert!(retrieved.is_some());

                if let Some(TantivyResult::Count(count)) = retrieved {
                    assert_eq!(count, 42);
                } else {
                    panic!("Expected Count result");
                }
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.await.unwrap();
        }
    }

    #[tokio::test]
    async fn test_tantivy_result_cache_concurrent_eviction() {
        let cache = Arc::new(TantivyResultCache::new(cap_for(
            20,
            "eviction_key_29",
            &create_test_count_result(),
        )));
        let mut handles = vec![];

        for i in 0..30 {
            let cache_clone = cache.clone();
            let handle = tokio::spawn(async move {
                let key = format!("eviction_key_{i}");
                let result = create_test_count_result();
                cache_clone.put(key, result);
                tokio::time::sleep(Duration::from_millis(1)).await;
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.await.unwrap();
        }

        assert!(cache.get("eviction_key_0").is_none());
        assert!(cache.get("eviction_key_29").is_some());
    }

    #[test]
    fn test_default_cache_without_a_quota_stores_nothing() {
        let cache = TantivyResultCache::default();
        cache.put("test_key".to_string(), create_test_count_result());
        assert!(cache.get("test_key").is_none());
        assert_eq!(cache.memory_size(), 0);
    }

    #[test]
    fn test_tantivy_result_cache_edge_cases() {
        let result1 = create_test_count_result();
        let result2 = create_test_histogram_result();
        let cache = TantivyResultCache::new(cap_for(1, "key2", &result2));

        cache.put("key1".to_string(), result1.clone());
        cache.put("key2".to_string(), result2.clone());

        assert!(cache.get("key1").is_none());
        assert!(cache.get("key2").is_some());
    }

    #[test]
    fn test_tantivy_result_cache_different_result_types() {
        let cache = TantivyResultCache::new(TEST_MAX_SIZE);

        let distinct_result = create_test_distinct_result();
        cache.put("distinct_key".to_string(), distinct_result.clone());

        if let Some(TantivyResult::Distinct(distinct)) = cache.get("distinct_key") {
            assert_eq!(distinct.len(), 3);
            assert!(distinct.contains("value1"));
            assert!(distinct.contains("value2"));
            assert!(distinct.contains("value3"));
        } else {
            panic!("Expected Distinct result");
        }

        let topn_result = create_test_top_n_result();
        cache.put("topn_key".to_string(), topn_result.clone());

        if let Some(TantivyResult::TopN(top_n)) = cache.get("topn_key") {
            assert_eq!(top_n.len(), 3);
            assert_eq!(top_n[0].0, vec!["key1".to_string()]);
            assert_eq!(top_n[0].1, 100);
        } else {
            panic!("Expected TopN result");
        }
    }

    #[test]
    fn test_tantivy_result_cache_select_candidates_roundtrip() {
        let cache = TantivyResultCache::new(TEST_MAX_SIZE);

        let candidates = Arc::new(vec![(100i64, 7u32), (99, 3)]);
        let entry = CacheEntry::SelectCandidates(candidates.clone());
        cache.put("select_candidates_key".to_string(), entry);

        if let Some(TantivyResult::SelectCandidates(cached)) = cache.get("select_candidates_key") {
            assert_eq!(*cached, *candidates);
        } else {
            panic!("Expected SelectCandidates result");
        }
    }

    #[test]
    fn test_tantivy_result_cache_row_ids_roundtrip() {
        let cache = TantivyResultCache::new(TEST_MAX_SIZE);

        let entry = CacheEntry::RowIds(Arc::new(BooleanBuffer::from_iter(
            (0..64u32).map(|i| [10u32, 20].contains(&i)),
        )));
        cache.put("row_ids_key".to_string(), entry);

        if let Some(TantivyResult::RowIdsSelection(row_ids)) = cache.get("row_ids_key") {
            assert_eq!(row_ids.set_indices().collect::<Vec<_>>(), vec![10, 20]);
        } else {
            panic!("Expected RowIdsSelection result");
        }
    }

    #[test]
    fn test_eviction_by_bytes_keeps_memory_under_max_size() {
        let max_size = cap_for(8, "key_00", &create_test_histogram_result());
        let cache = TantivyResultCache::new(max_size);
        for i in 0..40u32 {
            let value = match i % 3 {
                0 => create_test_count_result(),
                1 => create_test_histogram_result(),
                _ => create_test_distinct_result(),
            };
            cache.insert(format!("key_{i:02}"), value, i);
            assert!(cache.memory_size() <= max_size, "over max size after {i}");
            assert_eq!(cache.memory_size(), tracked_size(&cache));
        }
        assert!(cache.lookup("key_00", 40).is_none());
        assert!(cache.lookup("key_39", 40).is_some());
    }

    #[test]
    fn test_entry_larger_than_max_size_is_not_cached() {
        let small = create_test_count_result();
        let cache = TantivyResultCache::new(cap_for(2, "small", &small));
        cache.put("small".to_string(), small);
        let before = cache.memory_size();

        let big = CacheEntry::Histogram(vec![0; 1024]);
        assert!(cache.put("big".to_string(), big).is_none());
        assert!(cache.get("big").is_none());
        assert!(
            cache.get("small").is_some(),
            "oversized entry evicted others"
        );
        assert_eq!(cache.memory_size(), before);
    }

    #[test]
    fn test_replace_and_evict_then_insert_keep_byte_count() {
        let cache = TantivyResultCache::new(cap_for(3, "key_0", &create_test_histogram_result()));
        cache.insert("key_0".to_string(), create_test_count_result(), 1);
        cache.insert("key_0".to_string(), create_test_histogram_result(), 2);
        assert_eq!(cache.len(), 1);
        assert_eq!(
            cache.memory_size(),
            entry_size("key_0", &create_test_histogram_result())
        );
        for i in 1..6 {
            cache.insert(format!("key_{i}"), create_test_histogram_result(), 2 + i);
            assert_eq!(cache.memory_size(), tracked_size(&cache));
        }
        assert!(cache.lookup("key_0", 10).is_none());
        cache.insert("key_0".to_string(), create_test_count_result(), 11);
        assert_eq!(cache.memory_size(), tracked_size(&cache));
        assert!(cache.memory_size() <= cache.max_size);
    }
}
