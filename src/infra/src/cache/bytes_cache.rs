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
    sync::atomic::{AtomicI64, Ordering},
    time::Instant,
};

use bytes::Bytes;
use config::{RwHashMap, metrics};
use dashmap::mapref::entry::Entry;

use super::recency::{EvictedKeys, Recency, now_secs};

// NOTE: for this cache, if you insert a key that already exists,
// it will drop the second key and value
pub struct BytesCache {
    tag: String,
    readers: RwHashMap<String, CachedBytes>,
    evicting: parking_lot::Mutex<()>,
    evicted: EvictedKeys,
    max_bytes: usize,
    current_memory: AtomicI64,
}

impl BytesCache {
    pub fn new(max_bytes: usize, tag: String) -> Self {
        Self {
            tag,
            readers: RwHashMap::default(),
            evicting: parking_lot::Mutex::new(()),
            evicted: EvictedKeys::new(),
            max_bytes,
            current_memory: AtomicI64::new(0),
        }
    }

    pub fn get(&self, key: &str) -> Option<Bytes> {
        self.lookup(key, now_secs())
    }

    pub fn put(&self, key: String, value: Bytes) {
        self.insert(key, value, now_secs());
    }

    fn lookup(&self, key: &str, now: u32) -> Option<Bytes> {
        if let Some(entry) = self.readers.get(key) {
            entry.recency.touch(now);
            metrics::BYTES_CACHE_HITS_TOTAL
                .with_label_values(&[&self.tag])
                .inc();
            return Some(entry.bytes.clone());
        }
        metrics::BYTES_CACHE_MISS_TOTAL
            .with_label_values(&[&self.tag])
            .inc();
        if self.evicted.take(key) {
            metrics::BYTES_CACHE_REREAD_MISS_TOTAL
                .with_label_values(&[&self.tag])
                .inc();
        }
        None
    }

    fn insert(&self, key: String, value: Bytes, now: u32) {
        let value_len = entry_size(&key, &value);
        match self.readers.entry(key) {
            // NOTE: if key already exists, drop the second key and value
            Entry::Occupied(_) => return,
            Entry::Vacant(slot) => {
                slot.insert(CachedBytes {
                    bytes: value,
                    recency: Recency::new(now),
                });
            }
        }

        self.current_memory.fetch_add(value_len, Ordering::Relaxed);
        metrics::BYTES_CACHE_ENTRY_COUNT
            .with_label_values(&[&self.tag])
            .inc();
        metrics::BYTES_CACHE_MEMORY_SIZE
            .with_label_values(&[&self.tag])
            .add(value_len);

        if self.current_memory.load(Ordering::Relaxed) > self.max_bytes as i64 {
            self.evict();
        }
    }

    fn evict(&self) {
        // Another thread is evicting; the next insert still over the limit evicts again.
        let Some(_evicting) = self.evicting.try_lock() else {
            return;
        };
        let start = Instant::now();
        if self.current_memory.load(Ordering::Relaxed) > self.max_bytes as i64 {
            let (removed_total, removed_count) = self.drop_coldest();
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

    /// Drops the least recently read entries, 5% of them per round, until under `max_bytes`.
    /// Returns the bytes and entries removed.
    fn drop_coldest(&self) -> (i64, i64) {
        let mut coldest = self
            .readers
            .iter()
            .map(|entry| (entry.recency.rank(), entry.key().clone()))
            .collect::<Vec<_>>();
        coldest.sort_unstable();
        let batch = (coldest.len() / 20).max(1);
        let (mut removed_total, mut removed_count) = (0, 0);
        for (i, (rank, key)) in coldest.into_iter().enumerate() {
            if i % batch == 0
                && self.current_memory.load(Ordering::Relaxed) <= self.max_bytes as i64
            {
                break;
            }
            // An entry read after the snapshot has a new rank and stays.
            let Some((key, entry)) = self
                .readers
                .remove_if(&key, |_, entry| entry.recency.rank() == rank)
            else {
                continue;
            };
            let size = entry_size(&key, &entry.bytes);
            self.current_memory.fetch_sub(size, Ordering::Relaxed);
            self.evicted.record(&key);
            removed_total += size;
            removed_count += 1;
        }
        (removed_total, removed_count)
    }
}

struct CachedBytes {
    bytes: Bytes,
    recency: Recency,
}

fn entry_size(key: &str, value: &Bytes) -> i64 {
    (value.len() + key.len() * 2) as i64
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

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
    fn test_evict_keeps_recently_read_entry_over_newer_unread_ones() {
        // Each entry takes 90 + 5 * 2 = 100 bytes.
        let cache = BytesCache::new(1000, "test".to_string());
        cache.insert("hot-0".to_string(), Bytes::from(vec![0u8; 90]), 1);
        for i in 0..9 {
            cache.insert(format!("old-{i}"), Bytes::from(vec![0u8; 90]), 2 * i + 2);
            assert!(cache.lookup("hot-0", 2 * i + 3).is_some());
        }
        cache.insert("new-0".to_string(), Bytes::from(vec![0u8; 90]), 30);

        assert!(cache.lookup("hot-0", 31).is_some(), "hot entry was evicted");
        assert!(cache.lookup("old-0", 31).is_none());
        assert!(!cache.evicted.take("old-0"), "re-read counted twice");
        assert!(cache.lookup("old-1", 31).is_some());
        assert!(cache.lookup("new-0", 31).is_some());
        assert!(!cache.evicted.take("never-cached"));
    }

    #[test]
    fn test_put_does_not_wait_for_a_running_eviction() {
        let cache = std::sync::Arc::new(BytesCache::new(0, "test".to_string()));
        let held = cache.evicting.lock();
        let (done, finished) = std::sync::mpsc::channel();
        let writer = cache.clone();
        std::thread::spawn(move || {
            writer.put("a".to_string(), Bytes::from_static(b"x"));
            done.send(()).unwrap();
        });
        assert!(
            finished.recv_timeout(Duration::from_secs(5)).is_ok(),
            "put waited for the running eviction"
        );
        assert!(cache.get("a").is_some());
        drop(held);
        cache.put("b".to_string(), Bytes::from_static(b"y"));
        assert!(cache.get("a").is_none());
        assert!(cache.get("b").is_none());
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
