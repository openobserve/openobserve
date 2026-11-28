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
    sync::{LazyLock, Once},
    time::{Duration, Instant},
};

use config::RwHashMap;

/// Entries read as missing past the TTL; a read, an insert or the optional background sweep drops
/// expired ones, so a cached key value does not outlive its TTL in memory.
pub(crate) struct TtlCache<V> {
    ttl: Duration,
    entries: LazyLock<RwHashMap<String, (V, Instant)>>,
    sweeper: Once,
}

impl<V: Clone> TtlCache<V> {
    pub(crate) const fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            entries: LazyLock::new(RwHashMap::default),
            sweeper: Once::new(),
        }
    }

    pub(crate) fn get(&self, key: &str) -> Option<V> {
        if let Some(entry) = self.entries.get(key)
            && entry.1.elapsed() < self.ttl
        {
            return Some(entry.0.clone());
        }
        self.entries
            .remove_if(key, |_, entry| entry.1.elapsed() >= self.ttl);
        None
    }

    pub(crate) fn insert(&self, key: String, value: V) {
        self.sweep();
        self.entries.insert(key, (value, Instant::now()));
    }

    pub(crate) fn remove(&self, key: &str) {
        self.entries.remove(key);
    }

    pub(crate) fn retain(&self, mut keep: impl FnMut(&str) -> bool) {
        self.entries.retain(|key, _| keep(key));
    }

    pub(crate) fn clear(&self) {
        self.entries.clear();
    }

    pub(crate) fn sweep(&self) {
        self.entries.retain(|_, entry| entry.1.elapsed() < self.ttl);
    }

    /// Starts one thread that sweeps every `period`, so a node that stops reading and inserting
    /// still drops expired values; later calls do nothing.
    pub(crate) fn sweep_in_background(&'static self, period: Duration)
    where
        V: Send + Sync + 'static,
    {
        self.sweeper.call_once(|| {
            let spawned = std::thread::Builder::new()
                .name("ttl-cache-sweep".to_string())
                .spawn(move || {
                    loop {
                        std::thread::sleep(period);
                        self.sweep();
                    }
                });
            if let Err(e) = spawned {
                log::error!("[TTL_CACHE] could not start the expiry sweep: {e}");
            }
        });
    }

    #[cfg(test)]
    pub(crate) fn is_sweeping(&self) -> bool {
        self.sweeper.is_completed()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_entry_is_returned() {
        let cache = TtlCache::new(Duration::from_secs(60));
        cache.insert("k".to_string(), 7);
        assert_eq!(cache.get("k"), Some(7));
    }

    #[test]
    fn an_entry_past_the_ttl_reads_as_missing() {
        let cache = TtlCache::new(Duration::ZERO);
        cache.insert("k".to_string(), 7);
        assert_eq!(cache.get("k"), None);
    }

    #[test]
    fn expired_entries_leave_memory_on_read_and_on_insert() {
        let cache = TtlCache::new(Duration::ZERO);
        cache.insert("read".to_string(), 7);
        assert_eq!(cache.get("read"), None);
        assert!(cache.entries.is_empty());
        cache.insert("old".to_string(), 7);
        cache.insert("new".to_string(), 8);
        assert!(!cache.entries.contains_key("old"));
    }

    #[test]
    fn the_background_sweep_drops_expired_entries_without_reads_or_inserts() {
        static CACHE: TtlCache<u8> = TtlCache::new(Duration::from_millis(20));
        CACHE.insert("idle".to_string(), 7);
        CACHE.sweep_in_background(Duration::from_millis(10));
        CACHE.sweep_in_background(Duration::from_millis(10));
        let deadline = Instant::now() + Duration::from_secs(5);
        while CACHE.entries.contains_key("idle") && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!CACHE.entries.contains_key("idle"));
        assert!(CACHE.is_sweeping());
    }

    #[test]
    fn sweep_keeps_fresh_entries() {
        let cache = TtlCache::new(Duration::from_secs(60));
        cache.insert("fresh".to_string(), 1);
        cache.sweep();
        assert_eq!(cache.get("fresh"), Some(1));
    }

    #[test]
    fn remove_retain_and_clear_drop_entries() {
        let cache = TtlCache::new(Duration::from_secs(60));
        for key in ["org/a", "org/b", "other/c", "x"] {
            cache.insert(key.to_string(), 1);
        }
        cache.remove("x");
        assert_eq!(cache.get("x"), None);
        cache.retain(|key| !key.starts_with("org/"));
        assert_eq!(cache.get("org/a"), None);
        assert_eq!(cache.get("other/c"), Some(1));
        cache.clear();
        assert_eq!(cache.get("other/c"), None);
    }
}
