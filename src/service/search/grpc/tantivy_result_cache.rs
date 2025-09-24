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
    collections::{HashSet, VecDeque},
    sync::Arc,
};

use config::{meta::bitvec::BitVec, metrics};
use dashmap::DashMap;
use once_cell::sync::Lazy;
use roaring::RoaringBitmap;

use crate::service::search::grpc::tantivy_result::TantivyResult;

pub static GLOBAL_CACHE: Lazy<Arc<TantivyResultCache>> =
    Lazy::new(|| Arc::new(TantivyResultCache::default()));

#[derive(Debug, Clone)]
pub enum CacheEntry {
    RowIdsBitVec(usize, BitVec),
    // true number in bitmap, bitmap, parquet row numbers
    RowIdsRoaring(usize, RoaringBitmap, usize),
    Count(usize),              // simple count optimization
    Histogram(Vec<u64>),       // simple histogram optimization
    TopN(Vec<(String, u64)>),  // simple top n optimization
    Distinct(HashSet<String>), // simple distinct optimization
}

impl From<CacheEntry> for TantivyResult {
    fn from(entry: CacheEntry) -> Self {
        match entry {
            CacheEntry::RowIdsBitVec(num_rows, bitvec) => {
                TantivyResult::RowIdsBitVec(num_rows, bitvec)
            }
            CacheEntry::RowIdsRoaring(num_rows, roaring, parquet_rows) => {
                let mut bitvec = BitVec::repeat(false, parquet_rows);
                for i in roaring.into_iter() {
                    bitvec.set(i as usize, true);
                }
                TantivyResult::RowIdsBitVec(num_rows, bitvec)
            }
            CacheEntry::Count(count) => TantivyResult::Count(count),
            CacheEntry::Histogram(histogram) => TantivyResult::Histogram(histogram),
            CacheEntry::TopN(top_n) => TantivyResult::TopN(top_n),
            CacheEntry::Distinct(distinct) => TantivyResult::Distinct(distinct),
        }
    }
}

impl CacheEntry {
    pub fn get_memory_size(&self) -> usize {
        match self {
            CacheEntry::RowIdsBitVec(_, bitvec) => {
                bitvec.capacity().div_ceil(8) + std::mem::size_of::<BitVec>()
            }
            CacheEntry::RowIdsRoaring(_, roaring, _) => {
                roaring.serialized_size()
                    + std::mem::size_of::<RoaringBitmap>()
                    + std::mem::size_of::<usize>() * 2
            }
            CacheEntry::Count(_) => std::mem::size_of::<usize>(),
            CacheEntry::Histogram(histogram) => {
                histogram.capacity() * std::mem::size_of::<u64>() + std::mem::size_of::<Vec<u64>>()
            }
            CacheEntry::TopN(top_n) => {
                top_n
                    .iter()
                    .map(|(s, _)| s.capacity() + std::mem::size_of::<u64>())
                    .sum::<usize>()
                    + std::mem::size_of::<Vec<(String, u64)>>()
            }
            CacheEntry::Distinct(distinct) => {
                distinct.iter().map(|s| s.capacity()).sum::<usize>()
                    + std::mem::size_of::<HashSet<String>>()
            }
        }
    }
}

/// Cache created for storing the tantivy result
pub struct TantivyResultCache {
    readers: DashMap<String, CacheEntry>,
    cacher: parking_lot::Mutex<VecDeque<String>>,
    max_entries: usize,
}

impl TantivyResultCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            readers: DashMap::new(),
            cacher: parking_lot::Mutex::new(VecDeque::new()),
            max_entries,
        }
    }

    pub fn get(&self, key: &str) -> Option<TantivyResult> {
        let entry = { self.readers.get(key).map(|r| r.value().clone()) };

        entry.map(TantivyResult::from)
    }

    pub fn put(&self, key: String, value: CacheEntry) -> Option<CacheEntry> {
        let mut w = self.cacher.lock();
        if w.len() >= self.max_entries {
            metrics::TANTIVY_RESULT_CACHE_GC_TOTAL
                .with_label_values::<&str>(&[])
                .inc();
            let mut memory_usage = 0;
            // release 10% of the cache
            for _ in 0..(std::cmp::max(1, self.max_entries / 10)) {
                if let Some(k) = w.pop_front() {
                    if let Some((key, entry)) = self.readers.remove(&k) {
                        memory_usage += entry.get_memory_size() + 2 * key.capacity();
                    }
                } else {
                    break;
                }
            }
            metrics::TANTIVY_RESULT_CACHE_MEMORY_USAGE
                .with_label_values::<&str>(&[])
                .sub(memory_usage as i64);
        }
        w.push_back(key.clone());
        drop(w);
        // update metrics
        let memory_usage = value.get_memory_size() + 2 * key.capacity();
        metrics::TANTIVY_RESULT_CACHE_MEMORY_USAGE
            .with_label_values::<&str>(&[])
            .add(memory_usage as i64);
        self.readers.insert(key, value)
    }

    pub fn len(&self) -> usize {
        self.readers.len()
    }

    pub fn memory_size(&self) -> usize {
        self.readers
            .iter()
            .map(|r| r.value().get_memory_size() + 2 * r.key().capacity())
            .sum()
    }
}

impl Default for TantivyResultCache {
    fn default() -> Self {
        Self::new(
            config::get_config()
                .limit
                .inverted_index_result_cache_max_entries,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, sync::Arc, time::Duration};

    use config::meta::bitvec::BitVec;

    use super::*;

    fn create_test_tantivy_result() -> CacheEntry {
        let mut bitvec = BitVec::repeat(false, 100);
        bitvec.set(10, true);
        bitvec.set(20, true);
        bitvec.set(30, true);
        CacheEntry::RowIdsBitVec(3, bitvec)
    }

    fn create_test_count_result() -> CacheEntry {
        CacheEntry::Count(42)
    }

    fn create_test_histogram_result() -> CacheEntry {
        CacheEntry::Histogram(vec![10, 20, 30, 40])
    }

    fn create_test_top_n_result() -> CacheEntry {
        CacheEntry::TopN(vec![
            ("key1".to_string(), 100),
            ("key2".to_string(), 200),
            ("key3".to_string(), 300),
        ])
    }

    fn create_test_distinct_result() -> CacheEntry {
        let mut distinct = HashSet::new();
        distinct.insert("value1".to_string());
        distinct.insert("value2".to_string());
        distinct.insert("value3".to_string());
        CacheEntry::Distinct(distinct)
    }

    fn create_test_bitvec_result() -> CacheEntry {
        let mut bitvec = BitVec::repeat(false, 100);
        bitvec.set(10, true);
        bitvec.set(20, true);
        bitvec.set(30, true);
        CacheEntry::RowIdsBitVec(3, bitvec)
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
        assert!(matches!(
            retrieved.unwrap(),
            TantivyResult::RowIdsBitVec(_, _)
        ));
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
        let global_cache = &*GLOBAL_CACHE;

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
        let bitvec_result = CacheEntry::RowIdsBitVec(25, bitvec);

        cache.put("percent_key".to_string(), bitvec_result);

        if let Some(TantivyResult::RowIdsBitVec(percent, _)) = cache.get("percent_key") {
            assert_eq!(percent, 25);
        } else {
            panic!("Expected RowIdsBitVec result");
        }
    }
}
