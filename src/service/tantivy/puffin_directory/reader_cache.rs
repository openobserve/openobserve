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

use std::{collections::VecDeque, sync::Arc};

use dashmap::DashMap;
use once_cell::sync::Lazy;

type IndexCache = (Arc<tantivy::Index>, Arc<tantivy::IndexReader>);

pub static GLOBAL_CACHE: Lazy<Arc<ReaderCache>> = Lazy::new(|| Arc::new(ReaderCache::default()));

/// Cache created for storing the inverted index readers
pub struct ReaderCache {
    readers: DashMap<String, IndexCache>,
    cacher: parking_lot::Mutex<VecDeque<String>>,
    max_entries: usize,
}

impl ReaderCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            readers: DashMap::new(),
            cacher: parking_lot::Mutex::new(VecDeque::new()),
            max_entries,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.readers.is_empty()
    }

    pub fn len(&self) -> usize {
        self.readers.len()
    }

    pub fn get(&self, key: &str) -> Option<IndexCache> {
        self.readers.get(key).map(|r| r.value().clone())
    }

    pub fn put(&self, key: String, value: IndexCache) -> Option<IndexCache> {
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
        self.readers.insert(key, value)
    }
}

impl Default for ReaderCache {
    fn default() -> Self {
        Self::new(config::get_config().limit.inverted_index_cache_max_entries)
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, thread, time::Duration};

    use tantivy::{
        Index, ReloadPolicy, doc,
        schema::{STORED, Schema, TEXT},
    };

    use super::*;

    fn create_test_index() -> (Arc<tantivy::Index>, Arc<tantivy::IndexReader>) {
        let mut schema_builder = Schema::builder();
        let text_field = schema_builder.add_text_field("text", TEXT | STORED);
        let schema = schema_builder.build();

        let index = Index::create_in_ram(schema);
        let mut index_writer = index.writer(50_000_000).unwrap();

        // Add some test documents
        index_writer
            .add_document(doc!(text_field => "hello world"))
            .unwrap();
        index_writer
            .add_document(doc!(text_field => "test document"))
            .unwrap();
        index_writer.commit().unwrap();

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()
            .unwrap();

        (Arc::new(index), Arc::new(reader))
    }

    #[test]
    fn test_reader_cache_new() {
        let cache = ReaderCache::new(10);
        assert!(cache.is_empty());
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_reader_cache_put_and_get() {
        let cache = ReaderCache::new(10);
        let (index, reader) = create_test_index();
        let key = "test_key".to_string();

        // Initially empty
        assert!(cache.get(&key).is_none());

        // Put and get
        cache.put(key.clone(), (index.clone(), reader.clone()));
        assert_eq!(cache.len(), 1);
        assert!(!cache.is_empty());

        let result = cache.get(&key);
        assert!(result.is_some());

        let (retrieved_index, retrieved_reader) = result.unwrap();
        assert!(Arc::ptr_eq(&index, &retrieved_index));
        assert!(Arc::ptr_eq(&reader, &retrieved_reader));
    }

    #[test]
    fn test_reader_cache_get_nonexistent() {
        let cache = ReaderCache::new(10);
        let result = cache.get("nonexistent_key");
        assert!(result.is_none());
    }

    #[test]
    fn test_reader_cache_multiple_entries() {
        let cache = ReaderCache::new(10);

        for i in 0..5 {
            let (index, reader) = create_test_index();
            let key = format!("key_{i}");
            cache.put(key.clone(), (index, reader));
        }

        assert_eq!(cache.len(), 5);

        // Verify all entries can be retrieved
        for i in 0..5 {
            let key = format!("key_{i}");
            assert!(cache.get(&key).is_some());
        }
    }

    #[test]
    fn test_reader_cache_eviction() {
        let cache = ReaderCache::new(10);

        // Fill cache beyond capacity
        for i in 0..15 {
            let (index, reader) = create_test_index();
            let key = format!("key_{i}");
            cache.put(key, (index, reader));
        }

        // Cache should have evicted some entries
        assert!(cache.len() < 15);
        // Should still be within reasonable bounds
        assert!(cache.len() >= 8); // At least 80% should remain after 5% eviction
    }

    #[test]
    fn test_reader_cache_eviction_policy() {
        let cache = ReaderCache::new(20);

        // Fill cache to capacity
        for i in 0..20 {
            let (index, reader) = create_test_index();
            let key = format!("key_{i}");
            cache.put(key, (index, reader));
        }

        assert_eq!(cache.len(), 20);

        // Add one more entry to trigger eviction
        let (index, reader) = create_test_index();
        cache.put("overflow_key".to_string(), (index, reader));

        // Should have evicted approximately 5% (1 entry for this small cache)
        assert_eq!(cache.len(), 20);

        // The new entry should be present
        assert!(cache.get("overflow_key").is_some());
    }

    #[test]
    fn test_reader_cache_overwrite_existing() {
        let cache = ReaderCache::new(10);
        let (index1, reader1) = create_test_index();
        let (index2, reader2) = create_test_index();
        let key = "test_key".to_string();

        // Put first entry
        cache.put(key.clone(), (index1.clone(), reader1.clone()));
        assert_eq!(cache.len(), 1);

        // Overwrite with second entry
        let old_entry = cache.put(key.clone(), (index2.clone(), reader2.clone()));
        assert_eq!(cache.len(), 1); // Still only one entry

        // Should return the old entry
        assert!(old_entry.is_some());
        let (old_index, old_reader) = old_entry.unwrap();
        assert!(Arc::ptr_eq(&index1, &old_index));
        assert!(Arc::ptr_eq(&reader1, &old_reader));

        // Retrieved entry should be the new one
        let result = cache.get(&key).unwrap();
        let (retrieved_index, retrieved_reader) = result;
        assert!(Arc::ptr_eq(&index2, &retrieved_index));
        assert!(Arc::ptr_eq(&reader2, &retrieved_reader));
    }

    #[test]
    fn test_reader_cache_concurrent_access() {
        let cache = Arc::new(ReaderCache::new(50));
        let mut handles = vec![];

        // Spawn multiple threads to test concurrent access
        for i in 0..10 {
            let cache_clone = cache.clone();
            let handle = thread::spawn(move || {
                let (index, reader) = create_test_index();
                let key = format!("concurrent_key_{i}");

                // Put entry
                cache_clone.put(key.clone(), (index.clone(), reader.clone()));

                // Immediately try to get it
                let result = cache_clone.get(&key);
                assert!(result.is_some());

                let (retrieved_index, retrieved_reader) = result.unwrap();
                assert!(Arc::ptr_eq(&index, &retrieved_index));
                assert!(Arc::ptr_eq(&reader, &retrieved_reader));
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(cache.len(), 10);
    }

    #[test]
    fn test_reader_cache_concurrent_eviction() {
        let cache = Arc::new(ReaderCache::new(20));
        let mut handles = vec![];

        // Spawn multiple threads that exceed cache capacity
        for i in 0..30 {
            let cache_clone = cache.clone();
            let handle = thread::spawn(move || {
                let (index, reader) = create_test_index();
                let key = format!("eviction_key_{i}");
                cache_clone.put(key, (index, reader));

                // Small delay to increase chance of concurrent operations
                thread::sleep(Duration::from_millis(1));
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        // Should have triggered eviction
        assert!(cache.len() <= 20);
        assert!(cache.len() > 10); // But should still have reasonable number of entries
    }

    #[test]
    fn test_reader_cache_default() {
        let cache = ReaderCache::default();

        // Should be created with config-based max entries
        // We can't test the exact value since it depends on config,
        // but we can test basic functionality
        assert!(cache.is_empty());
        assert_eq!(cache.len(), 0);

        let (index, reader) = create_test_index();
        cache.put("test_key".to_string(), (index, reader));
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn test_reader_cache_stress_test() {
        let cache = ReaderCache::new(100);

        // Add many entries
        for i in 0..200 {
            let (index, reader) = create_test_index();
            let key = format!("stress_key_{i}");
            cache.put(key, (index, reader));
        }

        // Should have triggered multiple evictions
        assert!(cache.len() <= 100);
        assert!(cache.len() > 50); // Should still have a good portion
    }

    #[test]
    fn test_reader_cache_key_reuse() {
        let cache = ReaderCache::new(10);
        let (index1, reader1) = create_test_index();
        let key = "reuse_key".to_string();

        // Put and remove by overwriting
        cache.put(key.clone(), (index1, reader1));
        assert_eq!(cache.len(), 1);

        let (index2, reader2) = create_test_index();
        cache.put(key.clone(), (index2.clone(), reader2.clone()));
        assert_eq!(cache.len(), 1); // Still only one entry

        // Verify it's the new entry
        let result = cache.get(&key).unwrap();
        let (retrieved_index, retrieved_reader) = result;
        assert!(Arc::ptr_eq(&index2, &retrieved_index));
        assert!(Arc::ptr_eq(&reader2, &retrieved_reader));
    }

    #[test]
    fn test_reader_cache_empty_checks() {
        let cache = ReaderCache::new(5);

        assert!(cache.is_empty());
        assert_eq!(cache.len(), 0);

        let (index, reader) = create_test_index();
        cache.put("key1".to_string(), (index, reader));

        assert!(!cache.is_empty());
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn test_global_cache_accessibility() {
        // Test that the global cache is accessible and functional
        let global_cache = &*GLOBAL_CACHE;

        assert!(global_cache.is_empty());

        let (index, reader) = create_test_index();
        global_cache.put(
            "global_test_key".to_string(),
            (index.clone(), reader.clone()),
        );

        let result = global_cache.get("global_test_key");
        assert!(result.is_some());

        let (retrieved_index, retrieved_reader) = result.unwrap();
        assert!(Arc::ptr_eq(&index, &retrieved_index));
        assert!(Arc::ptr_eq(&reader, &retrieved_reader));

        // Clean up for other tests
        global_cache.put("cleanup".to_string(), create_test_index());
    }

    #[test]
    fn test_reader_cache_large_capacity() {
        let cache = ReaderCache::new(1000);

        // Add many entries without triggering eviction
        for i in 0..500 {
            let (index, reader) = create_test_index();
            let key = format!("large_key_{i}");
            cache.put(key, (index, reader));
        }

        assert_eq!(cache.len(), 500);

        // Verify some random entries
        assert!(cache.get("large_key_100").is_some());
        assert!(cache.get("large_key_250").is_some());
        assert!(cache.get("large_key_499").is_some());
    }

    #[test]
    fn test_reader_cache_edge_cases() {
        // Test with capacity of 1
        let cache = ReaderCache::new(1);
        let (index1, reader1) = create_test_index();
        let (index2, reader2) = create_test_index();

        cache.put("key1".to_string(), (index1, reader1));
        assert_eq!(cache.len(), 1);

        cache.put("key2".to_string(), (index2, reader2));
        // Should evict key1 since capacity is 1 and 5% eviction would be 0, so evict 1
        assert_eq!(cache.len(), 1);
        assert!(cache.get("key2").is_some());
    }
}
