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
use config::metrics;
use dashmap::DashMap;

// TODO: the memory size should counter the key * 2
pub struct BytesCache {
    tag: String,
    readers: DashMap<String, Bytes>,
    cacher: parking_lot::Mutex<VecDeque<String>>,
    max_bytes: usize,
    current_memory: AtomicI64,
}

impl BytesCache {
    pub fn new(max_bytes: usize, tag: String) -> Self {
        Self {
            tag,
            readers: DashMap::new(),
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
        let value_len = value.len() as i64;
        let old_len = { self.readers.get(&key).map(|r| r.len() as i64) };

        // Push to FIFO queue
        {
            let mut w = self.cacher.lock();
            w.push_back(key.clone());
        }

        // Insert into cache
        self.readers.insert(key, value);

        // Update memory tracking and metrics
        match old_len {
            Some(len) => {
                let diff = value_len - len;
                if diff != 0 {
                    self.current_memory.fetch_add(diff, Ordering::Relaxed);
                    if diff > 0 {
                        metrics::BYTES_CACHE_MEMORY_SIZE
                            .with_label_values(&[&self.tag])
                            .add(diff);
                    } else {
                        metrics::BYTES_CACHE_MEMORY_SIZE
                            .with_label_values(&[&self.tag])
                            .sub(-diff);
                    }
                }
            }
            None => {
                self.current_memory.fetch_add(value_len, Ordering::Relaxed);
                metrics::BYTES_CACHE_ENTRY_COUNT
                    .with_label_values(&[&self.tag])
                    .inc();
                metrics::BYTES_CACHE_MEMORY_SIZE
                    .with_label_values(&[&self.tag])
                    .add(value_len);
            }
        }

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
                    removed_total += removed.len() as i64;
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
        metrics::BYTES_CACHE_GC_TOTAL
            .with_label_values(&[&self.tag])
            .inc();
        let elapsed = start.elapsed().as_millis() as f64;
        metrics::BYTES_CACHE_GC_TIME
            .with_label_values(&[&self.tag])
            .observe(elapsed);
    }
}
