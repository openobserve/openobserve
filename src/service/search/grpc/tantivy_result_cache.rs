// Copyright 2025 OpenObserve Inc.
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
    collections::VecDeque,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use dashmap::DashMap;
use once_cell::sync::Lazy;

use crate::service::search::grpc::utils::TantivyResult;

pub static TANTIVY_RESULT_CACHE: Lazy<Arc<TantivyResultCache>> =
    Lazy::new(|| Arc::new(TantivyResultCache::default()));

/// Cache created for storing the tantivy result
pub struct TantivyResultCache {
    readers: DashMap<String, TantivyResult>,
    cacher: parking_lot::Mutex<VecDeque<String>>,
    max_entries: usize,
    // TODO: convert this to a metrics
    total_memory_size: AtomicUsize,
}

impl TantivyResultCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            readers: DashMap::new(),
            cacher: parking_lot::Mutex::new(VecDeque::new()),
            max_entries,
            total_memory_size: AtomicUsize::new(0),
        }
    }

    pub fn get(&self, key: &str) -> Option<TantivyResult> {
        self.readers.get(key).map(|r| r.value().clone())
    }

    pub fn put(&self, key: String, value: TantivyResult) -> Option<TantivyResult> {
        let mut w = self.cacher.lock();
        if w.len() >= self.max_entries {
            // release 5% of the cache
            for _ in 0..(std::cmp::max(1, self.max_entries / 20)) {
                if let Some(k) = w.pop_front() {
                    self.readers.remove(&k);
                } else {
                    break;
                }
            }
        }
        w.push_back(key.clone());
        drop(w);
        self.total_memory_size
            .fetch_add(value.get_memory_size(), Ordering::Relaxed);
        self.readers.insert(key, value)
    }

    pub fn total_memory_size(&self) -> usize {
        self.total_memory_size.load(Ordering::Relaxed)
    }
}

impl Default for TantivyResultCache {
    fn default() -> Self {
        Self::new(config::get_config().limit.inverted_index_cache_max_entries)
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, sync::Arc, time::Duration};

    use config::meta::bitvec::BitVec;

    use super::*;

    fn create_test_tantivy_result() -> TantivyResult {
        let mut row_ids = HashSet::new();
        row_ids.insert(1);
        row_ids.insert(3);
        row_ids.insert(5);
        TantivyResult::RowIds(row_ids)
    }

    fn create_test_count_result() -> TantivyResult {
        TantivyResult::Count(42)
    }

    fn create_test_histogram_result() -> TantivyResult {
        TantivyResult::Histogram(vec![10, 20, 30, 40])
    }

    fn create_test_top_n_result() -> TantivyResult {
        TantivyResult::TopN(vec![
            ("key1".to_string(), 100),
            ("key2".to_string(), 200),
            ("key3".to_string(), 300),
        ])
    }

    fn create_test_distinct_result() -> TantivyResult {
        let mut distinct = HashSet::new();
        distinct.insert("value1".to_string());
        distinct.insert("value2".to_string());
        distinct.insert("value3".to_string());
        TantivyResult::Distinct(distinct)
    }

    fn create_test_bitvec_result() -> TantivyResult {
        let mut bitvec = BitVec::repeat(false, 100);
        bitvec.set(10, true);
        bitvec.set(20, true);
        bitvec.set(30, true);
        TantivyResult::RowIdsBitVec(3, bitvec)
    }

    #[test]
    fn test_tantivy_result_cache_new() {
        let cache = TantivyResultCache::new(10);
        assert_eq!(cache.max_entries, 10);
    }

    #[test]
    fn test_tantivy_result_cache_put_and_get() {
        let cache = TantivyResultCache::new(10);
        let key = "test_key".to_string();
        let result = create_test_tantivy_result();

        assert!(cache.get(&key).is_none());
        cache.put(key.clone(), result.clone());
        let retrieved = cache.get(&key);
        assert!(retrieved.is_some());
        assert!(matches!(retrieved.unwrap(), TantivyResult::RowIds(_)));
    }

    #[test]
    fn test_tantivy_result_cache_get_nonexistent() {
        let cache = TantivyResultCache::new(10);
        let result = cache.get("nonexistent_key");
        assert!(result.is_none());
    }

    #[test]
    fn test_tantivy_result_cache_multiple_entries() {
        let cache = TantivyResultCache::new(10);

        cache.put("count_key".to_string(), create_test_count_result());
        cache.put("histogram_key".to_string(), create_test_histogram_result());
        cache.put("topn_key".to_string(), create_test_top_n_result());
        cache.put("distinct_key".to_string(), create_test_distinct_result());
        cache.put("bitvec_key".to_string(), create_test_bitvec_result());

        assert!(cache.get("count_key").is_some());
        assert!(cache.get("histogram_key").is_some());
        assert!(cache.get("topn_key").is_some());
        assert!(cache.get("distinct_key").is_some());
        assert!(cache.get("bitvec_key").is_some());

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
        let cache = TantivyResultCache::new(5);

        for i in 0..10 {
            let key = format!("key_{i}");
            let result = create_test_count_result();
            cache.put(key, result);
        }

        assert!(cache.get("key_0").is_none());
        assert!(cache.get("key_9").is_some());
    }

    #[test]
    fn test_tantivy_result_cache_overwrite_existing() {
        let cache = TantivyResultCache::new(10);
        let key = "test_key".to_string();
        let result1 = create_test_count_result();
        let result2 = create_test_histogram_result();

        cache.put(key.clone(), result1.clone());
        let old_entry = cache.put(key.clone(), result2.clone());

        assert!(old_entry.is_some());
        if let Some(TantivyResult::Count(count)) = old_entry {
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
        let cache = Arc::new(TantivyResultCache::new(50));
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
        let cache = Arc::new(TantivyResultCache::new(20));
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
    fn test_tantivy_result_cache_default() {
        let cache = TantivyResultCache::default();
        let key = "test_key".to_string();
        let result = create_test_count_result();
        cache.put(key.clone(), result.clone());

        let retrieved = cache.get(&key);
        assert!(retrieved.is_some());
    }

    #[test]
    fn test_tantivy_result_cache_stress_test() {
        let cache = TantivyResultCache::new(100);

        for i in 0..200 {
            let key = format!("stress_key_{i}");
            let result = create_test_count_result();
            cache.put(key, result);
        }

        assert!(cache.get("stress_key_0").is_none());
        assert!(cache.get("stress_key_199").is_some());
    }

    #[test]
    fn test_tantivy_result_cache_edge_cases() {
        let cache = TantivyResultCache::new(1);
        let result1 = create_test_count_result();
        let result2 = create_test_histogram_result();

        cache.put("key1".to_string(), result1.clone());
        cache.put("key2".to_string(), result2.clone());

        assert!(cache.get("key1").is_none());
        assert!(cache.get("key2").is_some());
    }

    #[test]
    fn test_tantivy_result_cache_different_result_types() {
        let cache = TantivyResultCache::new(10);

        let mut row_ids = HashSet::new();
        row_ids.insert(1);
        row_ids.insert(2);
        let row_ids_result = TantivyResult::RowIds(row_ids.clone());
        cache.put("row_ids_key".to_string(), row_ids_result.clone());

        if let Some(TantivyResult::RowIds(retrieved_row_ids)) = cache.get("row_ids_key") {
            assert_eq!(retrieved_row_ids, row_ids);
        } else {
            panic!("Expected RowIds result");
        }

        let bitvec_result = create_test_bitvec_result();
        cache.put("bitvec_key".to_string(), bitvec_result.clone());

        if let Some(TantivyResult::RowIdsBitVec(percent, bitvec)) = cache.get("bitvec_key") {
            assert_eq!(percent, 3);
            assert_eq!(bitvec.len(), 100);
        } else {
            panic!("Expected RowIdsBitVec result");
        }

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
            assert_eq!(top_n[0].0, "key1");
            assert_eq!(top_n[0].1, 100);
        } else {
            panic!("Expected TopN result");
        }
    }

    #[test]
    fn test_global_cache_accessibility() {
        let global_cache = &*TANTIVY_RESULT_CACHE;

        let key = "global_test_key".to_string();
        let result = create_test_count_result();
        global_cache.put(key.clone(), result.clone());

        let retrieved = global_cache.get(&key);
        assert!(retrieved.is_some());

        if let Some(TantivyResult::Count(count)) = retrieved {
            assert_eq!(count, 42);
        } else {
            panic!("Expected Count result");
        }
    }

    #[test]
    fn test_tantivy_result_cache_percent_method() {
        let cache = TantivyResultCache::new(10);

        let mut bitvec = BitVec::repeat(false, 100);
        bitvec.set(10, true);
        bitvec.set(20, true);
        let bitvec_result = TantivyResult::RowIdsBitVec(25, bitvec);

        cache.put("percent_key".to_string(), bitvec_result);

        if let Some(TantivyResult::RowIdsBitVec(percent, _)) = cache.get("percent_key") {
            assert_eq!(percent, 25);
        } else {
            panic!("Expected RowIdsBitVec result");
        }
    }
}
