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

//! Approximate LRU for in-memory caches: a hit stamps a coarse clock into its entry
//! without a lock, and eviction sorts entries by that stamp.

use std::{
    collections::hash_map::RandomState,
    hash::{BuildHasher, Hash},
    sync::{
        LazyLock,
        atomic::{AtomicU32, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

/// 512 KiB per cache; enough to remember several eviction rounds of the largest cache.
const EVICTED_KEY_SLOTS: usize = 1 << 16;

// Reading `Instant` on every hit added a third to hit latency, so a thread ticks this instead.
static CLOCK: LazyLock<AtomicU32> = LazyLock::new(start_clock);
static NEXT_INSERT: AtomicU64 = AtomicU64::new(0);

/// Last access second plus insert order of one cache entry.
#[derive(Debug)]
pub struct Recency {
    last_access: AtomicU32,
    inserted: u64,
}

impl Recency {
    pub fn new(now: u32) -> Self {
        Self {
            last_access: AtomicU32::new(now),
            inserted: NEXT_INSERT.fetch_add(1, Ordering::Relaxed),
        }
    }

    /// Records a read at `now`. Skips the store within the same second so hot entries do
    /// not bounce their cache line between readers.
    pub fn touch(&self, now: u32) {
        if self.last_access.load(Ordering::Relaxed) != now {
            self.last_access.store(now, Ordering::Relaxed);
        }
    }

    /// Eviction order, smallest first: least recently read, then oldest insert.
    pub fn rank(&self) -> (u32, u64) {
        (self.last_access.load(Ordering::Relaxed), self.inserted)
    }
}

/// Lossy table of recently evicted keys; a collision overwrites, so re-reads are undercounted.
pub struct EvictedKeys {
    slots: Box<[AtomicU64]>,
    hasher: RandomState,
}

impl EvictedKeys {
    pub fn new() -> Self {
        Self {
            slots: (0..EVICTED_KEY_SLOTS).map(|_| AtomicU64::new(0)).collect(),
            hasher: RandomState::new(),
        }
    }

    pub fn record<K: Hash + ?Sized>(&self, key: &K) {
        let hash = self.hash(key);
        self.slot(hash).store(hash, Ordering::Relaxed);
    }

    /// True if `key` was evicted and not taken since, so each eviction counts one re-read.
    pub fn take<K: Hash + ?Sized>(&self, key: &K) -> bool {
        let hash = self.hash(key);
        self.slot(hash)
            .compare_exchange(hash, 0, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
    }

    // Zero marks an empty slot.
    fn hash<K: Hash + ?Sized>(&self, key: &K) -> u64 {
        self.hasher.hash_one(key).max(1)
    }

    fn slot(&self, hash: u64) -> &AtomicU64 {
        &self.slots[hash as usize % EVICTED_KEY_SLOTS]
    }
}

impl Default for EvictedKeys {
    fn default() -> Self {
        Self::new()
    }
}

/// Seconds since the first call in this process, at most one second stale.
pub fn now_secs() -> u32 {
    CLOCK.load(Ordering::Relaxed)
}

fn start_clock() -> AtomicU32 {
    let start = Instant::now();
    let ticker = std::thread::Builder::new()
        .name("cache-recency-clock".to_string())
        .spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(1));
                let secs = u32::try_from(start.elapsed().as_secs()).unwrap_or(u32::MAX);
                CLOCK.store(secs, Ordering::Relaxed);
            }
        });
    if let Err(e) = ticker {
        log::error!("cache recency clock did not start, caches fall back to insert order: {e}");
    }
    AtomicU32::new(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rank_orders_by_last_read_then_insert() {
        let older = Recency::new(5);
        let newer = Recency::new(5);
        assert!(older.rank() < newer.rank());
        older.touch(6);
        assert!(older.rank() > newer.rank());
    }

    #[test]
    fn test_clock_ticks() {
        let before = now_secs();
        std::thread::sleep(Duration::from_millis(2100));
        assert!(now_secs() > before);
    }

    #[test]
    fn test_evicted_key_is_taken_once() {
        let evicted = EvictedKeys::new();
        assert!(!evicted.take("a"));
        evicted.record("a");
        assert!(!evicted.take("b"));
        assert!(evicted.take("a"));
        assert!(!evicted.take("a"));
    }
}
