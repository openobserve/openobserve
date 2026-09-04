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
    collections::VecDeque,
    sync::atomic::{AtomicI64, Ordering},
    time::Instant,
};

use bytes::Bytes;
use config::{RwHashMap, metrics};

// NOTE: for this cache, if you insert a key that already exists,
// it will drop the second key and value
pub struct BytesCache {
    tag: String,
    readers: RwHashMap<String, Bytes>,
    cacher: parking_lot::Mutex<VecDeque<String>>,
    max_bytes: usize,
    current_memory: AtomicI64,
}

impl BytesCache {
    pub fn new(max_bytes: usize, tag: String) -> Self {
        Self {
            tag,
            readers: RwHashMap::default(),
            cacher: parking_lot::Mutex::new(VecDeque::new()),
            max_bytes,
            current_memory: AtomicI64::new(0),
        }
    }

    pub fn get(&self, key: &str) -> Option<Bytes> {
        match self.readers.get(key) {
            Some(r) => {
                metrics::BYTES_CACHE_HITS_TOTAL
                    .with_label_values(&[&self.tag])
                    .inc();
                Some(r.clone())
            }
            None => {
                metrics::BYTES_CACHE_MISS_TOTAL
                    .with_label_values(&[&self.tag])
                    .inc();
                None
            }
        }
    }

    pub fn put(&self, key: String, value: Bytes) {
        let value_len = (value.len() + key.len() * 2) as i64;

        {
            let mut w = self.cacher.lock();
            // NOTE: if key already exists, drop the second key and value
            if self.readers.contains_key(&key) {
                return;
            }
            w.push_back(key.clone());
            self.readers.insert(key, value);
        }

        self.current_memory.fetch_add(value_len, Ordering::Relaxed);
        metrics::BYTES_CACHE_ENTRY_COUNT
            .with_label_values(&[&self.tag])
            .inc();
        metrics::BYTES_CACHE_MEMORY_SIZE
            .with_label_values(&[&self.tag])
            .add(value_len);

        // GC: evict oldest entries if over memory limit
        if self.current_memory.load(Ordering::Relaxed) > self.max_bytes as i64 {
            self.evict();
        }
    }

    fn evict(&self) {
        let start = Instant::now();
        let mut w = self.cacher.lock();
        loop {
            if self.current_memory.load(Ordering::Relaxed) <= self.max_bytes as i64 || w.is_empty()
            {
                break;
            }
            let batch = (w.len() / 20).max(1);
            let mut removed_total = 0i64;
            let mut removed_count = 0i64;
            for k in w.drain(0..batch) {
                if let Some((_, removed)) = self.readers.remove(&k) {
                    removed_total += (removed.len() + k.len() * 2) as i64;
                    removed_count += 1;
                }
            }
            self.current_memory
                .fetch_sub(removed_total, Ordering::Relaxed);
            metrics::BYTES_CACHE_MEMORY_SIZE
                .with_label_values(&[&self.tag])
                .sub(removed_total);
            metrics::BYTES_CACHE_ENTRY_COUNT
                .with_label_values(&[&self.tag])
                .sub(removed_count);
        }
        metrics::BYTES_CACHE_GC_COUNT
            .with_label_values(&[&self.tag])
            .inc();
        let elapsed = start.elapsed().as_millis() as f64;
        metrics::BYTES_CACHE_GC_TIME
            .with_label_values(&[&self.tag])
            .observe(elapsed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_max_size_limit_evicts_oldest_entries() {
        let cache = BytesCache::new(100, "test".to_string());

        // Insert entries that exceed the max_bytes limit
        // Each key is 5 chars, value is 90 bytes -> memory = 90 + 5*2 = 100
        cache.put("key-1".to_string(), Bytes::from(vec![0u8; 90]));
        // Total: 100, right at the limit — no eviction
        assert!(cache.get("key-1").is_some());

        // This pushes memory over the limit -> should evict key-1
        cache.put("key-2".to_string(), Bytes::from(vec![1u8; 90]));
        // key-1 should be evicted (oldest), key-2 should remain
        assert!(
            cache.get("key-1").is_none(),
            "oldest entry should be evicted"
        );
        assert!(cache.get("key-2").is_some(), "newest entry should remain");
    }

    #[test]
    fn test_max_size_limit_memory_stays_below_limit() {
        let cache = BytesCache::new(200, "test".to_string());

        // Insert many small entries until memory exceeds the limit
        for i in 0..100 {
            cache.put(format!("key-{i}"), Bytes::from(vec![0u8; 50]));
        }

        // After eviction, current memory should be <= max_bytes
        let mem = cache.current_memory.load(Ordering::Relaxed);
        assert!(mem <= 200, "memory {mem} should not exceed max_bytes 200");
    }

    #[test]
    fn test_duplicate_key_does_not_increase_memory() {
        let cache = BytesCache::new(500, "test".to_string());

        cache.put("dup".to_string(), Bytes::from(vec![0u8; 100]));
        let mem_after_first = cache.current_memory.load(Ordering::Relaxed);

        // Inserting the same key again should be a no-op
        cache.put("dup".to_string(), Bytes::from(vec![0u8; 100]));
        let mem_after_second = cache.current_memory.load(Ordering::Relaxed);

        assert_eq!(
            mem_after_first, mem_after_second,
            "duplicate key should not increase memory"
        );
    }

    #[test]
    fn test_eviction_stops_when_below_limit() {
        let cache = BytesCache::new(300, "test".to_string());

        // Insert enough entries to trigger eviction
        for i in 0..10 {
            cache.put(format!("k{i}"), Bytes::from(vec![0u8; 100]));
        }

        let remaining = cache.current_memory.load(Ordering::Relaxed);
        assert!(
            remaining <= 300,
            "eviction should bring memory {remaining} within limit 300"
        );

        // The newest entries should still be present
        assert!(cache.get("k9").is_some(), "newest entry should survive");
    }

    #[test]
    fn test_zero_max_bytes_evicts_all() {
        let cache = BytesCache::new(0, "test".to_string());

        cache.put("key".to_string(), Bytes::from(vec![0u8; 10]));
        assert!(
            cache.get("key").is_none(),
            "entry should be evicted immediately"
        );
        assert_eq!(cache.current_memory.load(Ordering::Relaxed), 0);
    }
}
