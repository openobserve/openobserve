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

use config::get_config;
use hashlink::LruCache;

pub(super) static METRICS_INDEX_SELECTION_CACHE: LazyLock<Mutex<MetricsIndexSelectionCache>> =
    LazyLock::new(|| Mutex::new(MetricsIndexSelectionCache::default()));

/// Selected physical row ranges of one sidecar plus the parquet row-group size they map onto.
pub(super) type CachedSelection = (Arc<Vec<Range<usize>>>, u32);

pub(super) struct MetricsIndexSelectionCache {
    entries: LruCache<String, CachedSelection>,
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

    pub(super) fn get(&mut self, key: &str) -> Option<CachedSelection> {
        self.entries.get(key).cloned()
    }

    pub(super) fn insert(&mut self, key: String, selection: CachedSelection) {
        let max_bytes = get_config().search.metrics_index_selection_cache_max_size * 1024 * 1024;
        let size = Self::entry_size(&key, &selection.0);
        if size > max_bytes {
            return;
        }
        if let Some(previous) = self.entries.insert(key.clone(), selection) {
            self.memory_size = self
                .memory_size
                .saturating_sub(Self::entry_size(&key, &previous.0));
        }
        self.memory_size += size;
        while self.memory_size > max_bytes {
            let Some((key, evicted)) = self.entries.remove_lru() else {
                break;
            };
            self.memory_size = self
                .memory_size
                .saturating_sub(Self::entry_size(&key, &evicted.0));
        }
    }
}
