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
    ops::Range,
    sync::{Arc, LazyLock, Mutex},
};

use hashlink::LruCache;

/// Process-wide upper bound for cached physical row-range selections.
const METRICS_INDEX_SELECTION_CACHE_MAX_BYTES: usize = 256 * 1024 * 1024;

pub(super) static METRICS_INDEX_SELECTION_CACHE: LazyLock<Mutex<MetricsIndexSelectionCache>> =
    LazyLock::new(|| Mutex::new(MetricsIndexSelectionCache::default()));

pub(super) struct MetricsIndexSelectionCache {
    entries: LruCache<String, Arc<Vec<Range<usize>>>>,
    memory_size: usize,
}

impl Default for MetricsIndexSelectionCache {
    fn default() -> Self {
        Self {
            entries: LruCache::new_unbounded(),
            memory_size: 0,
        }
    }
}

impl MetricsIndexSelectionCache {
    fn entry_size(key: &str, ranges: &[Range<usize>]) -> usize {
        key.len() + std::mem::size_of::<Vec<Range<usize>>>() + std::mem::size_of_val(ranges)
    }

    pub(super) fn get(&mut self, key: &str) -> Option<Arc<Vec<Range<usize>>>> {
        self.entries.get(key).cloned()
    }

    pub(super) fn insert(&mut self, key: String, ranges: Arc<Vec<Range<usize>>>) {
        let size = Self::entry_size(&key, &ranges);
        if size > METRICS_INDEX_SELECTION_CACHE_MAX_BYTES {
            return;
        }
        if let Some(previous) = self.entries.insert(key.clone(), Arc::clone(&ranges)) {
            self.memory_size = self
                .memory_size
                .saturating_sub(Self::entry_size(&key, &previous));
        }
        self.memory_size += size;
        while self.memory_size > METRICS_INDEX_SELECTION_CACHE_MAX_BYTES {
            let Some((key, evicted)) = self.entries.remove_lru() else {
                break;
            };
            self.memory_size = self
                .memory_size
                .saturating_sub(Self::entry_size(&key, &evicted));
        }
    }
}
