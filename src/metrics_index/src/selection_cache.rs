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

use config::{get_config, meta::stream::FileKey, metrics};
use hashlink::LruCache;
use promql_parser::label::Matchers;

pub(super) static METRICS_INDEX_SELECTION_CACHE: LazyLock<Mutex<MetricsIndexSelectionCache>> =
    LazyLock::new(|| Mutex::new(MetricsIndexSelectionCache::default()));

/// Selected physical row ranges and the Parquet row-group size, absent for Vortex.
pub(super) type CachedSelection = (Arc<Vec<Range<usize>>>, Option<u32>);

#[derive(Clone)]
enum CacheValue {
    Rows(CachedSelection),
    Blocks(Arc<Vec<usize>>),
}

pub(super) struct MetricsIndexSelectionCache {
    entries: LruCache<String, CacheValue>,
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
    fn entry_size(key: &str, value: &CacheValue) -> usize {
        let content = match value {
            CacheValue::Rows((ranges, _)) => {
                std::mem::size_of::<Vec<Range<usize>>>() + std::mem::size_of_val(ranges.as_slice())
            }
            CacheValue::Blocks(ids) => {
                std::mem::size_of::<Vec<usize>>() + std::mem::size_of_val(ids.as_slice())
            }
        };
        key.len() + content
    }

    pub(super) fn get(&mut self, key: &str) -> Option<CachedSelection> {
        match self.entries.get(key)? {
            CacheValue::Rows(value) => Some(value.clone()),
            CacheValue::Blocks(_) => None,
        }
    }

    pub(super) fn insert(&mut self, key: String, selection: CachedSelection) {
        self.insert_value(key, CacheValue::Rows(selection));
    }

    fn get_blocks(&mut self, key: &str) -> Option<Arc<Vec<usize>>> {
        match self.entries.get(key)? {
            CacheValue::Blocks(ids) => Some(Arc::clone(ids)),
            CacheValue::Rows(_) => None,
        }
    }

    fn insert_blocks(&mut self, key: String, ids: Arc<Vec<usize>>) {
        self.insert_value(key, CacheValue::Blocks(ids));
    }

    fn insert_value(&mut self, key: String, value: CacheValue) {
        let max_bytes = get_config().search.metrics_index_selection_cache_max_size * 1024 * 1024;
        let size = Self::entry_size(&key, &value);
        if size > max_bytes {
            return;
        }
        if let Some(previous) = self.entries.insert(key.clone(), value) {
            self.release(Self::entry_size(&key, &previous));
        }
        self.memory_size += size;
        metrics::promql::INDEX_SELECTION_CACHE_MEMORY_USAGE
            .with_label_values::<&str>(&[])
            .add(size as i64);
        if self.memory_size > max_bytes {
            metrics::promql::INDEX_SELECTION_CACHE_GC_TOTAL
                .with_label_values::<&str>(&[])
                .inc();
        }
        while self.memory_size > max_bytes {
            let Some((key, evicted)) = self.entries.remove_lru() else {
                break;
            };
            self.release(Self::entry_size(&key, &evicted));
        }
    }

    fn release(&mut self, size: usize) {
        self.memory_size = self.memory_size.saturating_sub(size);
        metrics::promql::INDEX_SELECTION_CACHE_MEMORY_USAGE
            .with_label_values::<&str>(&[])
            .sub(size as i64);
    }
}

fn block_key(file: &FileKey, matchers: &Matchers) -> String {
    format!(
        "blocks\0{}\0{}\0{}\0{}\0{}\0{matchers:?}",
        file.account, file.key, file.meta.records, file.meta.compressed_size, file.meta.mindex_size,
    )
}

pub fn cached_blocks(file: &FileKey, matchers: &Matchers) -> Option<Arc<Vec<usize>>> {
    if !get_config().search.metrics_selection_cache_enabled {
        return None;
    }
    metrics::promql::INDEX_SELECTION_CACHE_REQUESTS_TOTAL
        .with_label_values::<&str>(&[])
        .inc();
    let value = METRICS_INDEX_SELECTION_CACHE
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get_blocks(&block_key(file, matchers));
    if value.is_some() {
        metrics::promql::INDEX_SELECTION_CACHE_HITS_TOTAL
            .with_label_values::<&str>(&[])
            .inc();
    }
    value
}

pub fn cache_blocks(file: &FileKey, matchers: &Matchers, ids: Arc<Vec<usize>>) {
    if get_config().search.metrics_selection_cache_enabled {
        METRICS_INDEX_SELECTION_CACHE
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert_blocks(block_key(file, matchers), ids);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_ids_and_source_ranges_remain_separate_cache_values() {
        let mut cache = MetricsIndexSelectionCache::default();
        cache.insert("rows".into(), (Arc::new(vec![0..3, 4..5]), Some(8)));
        cache.insert_blocks("blocks".into(), Arc::new(vec![0, 2]));
        assert_eq!(cache.get("rows").unwrap().0.as_ref(), &vec![0..3, 4..5]);
        assert_eq!(cache.get_blocks("blocks").unwrap().as_ref(), &vec![0, 2]);
        assert!(cache.get_blocks("rows").is_none());
        assert!(cache.get("blocks").is_none());
    }
}
