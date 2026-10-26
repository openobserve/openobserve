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
    sync::LazyLock,
    time::{Duration, Instant},
};

use config::RwHashMap;

/// Entries read as missing past the TTL; stale ones are never swept, only overwritten.
pub(crate) struct TtlCache<V> {
    ttl: Duration,
    entries: LazyLock<RwHashMap<String, (V, Instant)>>,
}

impl<V: Clone> TtlCache<V> {
    pub(crate) const fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            entries: LazyLock::new(RwHashMap::default),
        }
    }

    pub(crate) fn get(&self, key: &str) -> Option<V> {
        self.entries
            .get(key)
            .filter(|entry| entry.1.elapsed() < self.ttl)
            .map(|entry| entry.0.clone())
    }

    pub(crate) fn insert(&self, key: String, value: V) {
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
