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

use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};

use dashmap::DashMap;
use datafusion::{
    common::Statistics,
    execution::cache::{CacheAccessor, cache_manager::FileStatisticsCacheEntry},
};
use object_store::{ObjectMeta, path::Path};
use once_cell::sync::Lazy;

use super::TRACE_ID_SEPARATOR;

pub static GLOBAL_CACHE: Lazy<Arc<FileStatisticsCache>> =
    Lazy::new(|| Arc::new(FileStatisticsCache::default()));

/// Collected statistics for files
/// Cache is invalided when file size or last modification has changed
pub struct FileStatisticsCache {
    statistics: DashMap<String, (ObjectMeta, Arc<Statistics>)>,
    cacher: parking_lot::Mutex<VecDeque<String>>,
}

impl FileStatisticsCache {
    pub fn new() -> Self {
        Self {
            statistics: DashMap::new(),
            cacher: parking_lot::Mutex::new(VecDeque::new()),
        }
    }

    pub fn len(&self) -> usize {
        self.statistics.len()
    }

    pub fn memory_size(&self) -> usize {
        let mut total_size = 0;

        // Size of the struct itself
        total_size += std::mem::size_of::<Self>();

        // Size of DashMap entries
        for entry in self.statistics.iter() {
            let (key, (meta, stats)) = entry.pair();

            // Key string
            total_size += std::mem::size_of::<String>() + key.len();

            // ObjectMeta
            total_size += std::mem::size_of::<ObjectMeta>();
            // Path string in ObjectMeta
            total_size += meta.location.as_ref().len();
            // Optional e_tag
            if let Some(ref etag) = meta.e_tag {
                total_size += std::mem::size_of::<String>() + etag.len();
            }
            // Optional version
            if let Some(ref version) = meta.version {
                total_size += std::mem::size_of::<String>() + version.len();
            }

            // Arc<Statistics> - estimate size
            // Statistics contains num_rows, total_byte_size, and column_statistics
            total_size += std::mem::size_of::<Statistics>();

            // Column statistics size estimation
            for col in &stats.column_statistics {
                total_size += std::mem::size_of::<datafusion::common::ColumnStatistics>();
                // add min_value, max_value, sum_value
                total_size += col.min_value.get_value().map(|v| v.size()).unwrap_or(0);
                total_size += col.max_value.get_value().map(|v| v.size()).unwrap_or(0);
                total_size += col.sum_value.get_value().map(|v| v.size()).unwrap_or(0);
            }
        }

        // Size of VecDeque<String> in cacher
        let cacher_guard = self.cacher.lock();
        total_size += std::mem::size_of::<VecDeque<String>>();
        for key in cacher_guard.iter() {
            total_size += std::mem::size_of::<String>() + key.len();
        }
        drop(cacher_guard);

        // DashMap overhead (approximate)
        // DashMap uses sharding internally, estimate based on typical overhead
        // This is an approximation since we can't access internal shards
        let estimated_shards = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(8)
            .min(128); // DashMap typically uses CPU count for shards
        let dashmap_overhead = estimated_shards * std::mem::size_of::<parking_lot::RwLock<()>>();
        total_size += dashmap_overhead;

        total_size
    }

    fn format_key(&self, k: &Path) -> String {
        if let Some(mut p) = k.as_ref().find(TRACE_ID_SEPARATOR) {
            if let Some(pp) = k.as_ref()[..p].find("/schema=") {
                p = pp;
            }
            k.as_ref()[p..].to_string()
        } else {
            k.to_string()
        }
    }
}

impl Default for FileStatisticsCache {
    fn default() -> Self {
        Self::new()
    }
}

impl CacheAccessor<Path, Arc<Statistics>> for FileStatisticsCache {
    type Extra = ObjectMeta;

    /// Get `Statistics` for file location.
    fn get(&self, k: &Path) -> Option<Arc<Statistics>> {
        let k = self.format_key(k);
        self.statistics
            .get(&k)
            .map(|s| Some(s.value().1.clone()))
            .unwrap_or(None)
    }

    /// Get `Statistics` for file location. Returns None if file has changed or not found.
    fn get_with_extra(&self, k: &Path, e: &Self::Extra) -> Option<Arc<Statistics>> {
        let k = self.format_key(k);
        self.statistics
            .get(&k)
            .map(|s| {
                let (saved_meta, statistics) = s.value();
                if saved_meta.size != e.size || saved_meta.last_modified != e.last_modified {
                    // file has changed
                    None
                } else {
                    Some(statistics.clone())
                }
            })
            .unwrap_or(None)
    }

    /// Save collected file statistics
    fn put(&self, _key: &Path, _value: Arc<Statistics>) -> Option<Arc<Statistics>> {
        panic!("Put cache in FileStatisticsCache without Extra not supported.")
    }

    fn put_with_extra(
        &self,
        k: &Path,
        value: Arc<Statistics>,
        e: &Self::Extra,
    ) -> Option<Arc<Statistics>> {
        let k = self.format_key(k);
        let mut w = self.cacher.lock();

        let max_entries = config::get_config()
            .limit
            .datafusion_file_stat_cache_max_entries;
        if w.len() >= max_entries {
            // release 10% of the cache
            log::warn!("FileStatisticsCache is full, releasing 10% of the cache");
            for _ in 0..(max_entries / 10) {
                if let Some(k) = w.pop_front() {
                    self.statistics.remove(&k);
                } else {
                    break;
                }
            }
        }
        w.push_back(k.clone());
        drop(w);
        self.statistics.insert(k, (e.clone(), value)).map(|x| x.1)
    }

    fn remove(&self, k: &Path) -> Option<Arc<Statistics>> {
        let k = self.format_key(k);
        self.statistics.remove(&k).map(|x| x.1.1)
    }

    fn contains_key(&self, k: &Path) -> bool {
        let k = self.format_key(k);
        self.statistics.contains_key(&k)
    }

    fn len(&self) -> usize {
        self.statistics.len()
    }

    fn clear(&self) {
        self.statistics.clear()
    }
    fn name(&self) -> String {
        "FileStatisticsCache".to_string()
    }
}

impl datafusion::execution::cache::cache_manager::FileStatisticsCache for FileStatisticsCache {
    fn list_entries(&self) -> HashMap<Path, FileStatisticsCacheEntry> {
        let mut entries = HashMap::<Path, FileStatisticsCacheEntry>::new();

        for entry in &self.statistics {
            let path = Path::from(entry.key().as_str());
            let (object_meta, stats) = entry.value();
            entries.insert(
                path,
                FileStatisticsCacheEntry {
                    object_meta: object_meta.clone(),
                    num_rows: stats.num_rows,
                    num_columns: stats.column_statistics.len(),
                    table_size_bytes: stats.total_byte_size,
                    statistics_size_bytes: 0,
                },
            );
        }

        entries
    }
}

#[cfg(test)]
mod tests {
    use chrono::DateTime;
    use datafusion::arrow::datatypes::{DataType, Field, Schema, TimeUnit};

    use super::*;

    #[test]
    fn test_file_statistics_cache() {
        let meta = ObjectMeta {
            location: Path::from("test"),
            last_modified: DateTime::parse_from_rfc3339("2022-09-27T22:36:00+02:00")
                .unwrap()
                .into(),
            size: 1024,
            e_tag: None,
            version: None,
        };
        let cache = FileStatisticsCache::default();
        assert!(cache.get_with_extra(&meta.location, &meta).is_none());

        cache.put_with_extra(
            &meta.location,
            Statistics::new_unknown(&Schema::new(vec![Field::new(
                "test_column",
                DataType::Timestamp(TimeUnit::Second, None),
                false,
            )]))
            .into(),
            &meta,
        );
        assert!(cache.get_with_extra(&meta.location, &meta).is_some());

        // file size changed
        let mut meta2 = meta.clone();
        meta2.size = 2048;
        assert!(cache.get_with_extra(&meta2.location, &meta2).is_none());

        // file last_modified changed
        let mut meta2 = meta.clone();
        meta2.last_modified = DateTime::parse_from_rfc3339("2022-09-27T22:40:00+02:00")
            .unwrap()
            .into();
        assert!(cache.get_with_extra(&meta2.location, &meta2).is_none());

        // different file
        let mut meta2 = meta;
        meta2.location = Path::from("test2");
        assert!(cache.get_with_extra(&meta2.location, &meta2).is_none());
    }

    #[test]
    fn test_memory_size_calculation() {
        let cache = FileStatisticsCache::new();

        // Empty cache should have some base size
        let empty_size = cache.memory_size();
        assert!(empty_size > 0);

        // Add some entries
        for i in 0..10 {
            let meta = ObjectMeta {
                location: Path::from(format!("test_file_{i}")),
                last_modified: DateTime::parse_from_rfc3339("2022-09-27T22:36:00+02:00")
                    .unwrap()
                    .into(),
                size: 1024 * (i + 1),
                e_tag: Some(format!("etag_{i}")),
                version: Some(format!("v{i}")),
            };

            let schema = Schema::new(vec![
                Field::new("column1", DataType::Utf8, false),
                Field::new("column2", DataType::Int64, true),
                Field::new(
                    "column3",
                    DataType::Timestamp(TimeUnit::Microsecond, None),
                    false,
                ),
            ]);

            cache.put_with_extra(
                &meta.location,
                Statistics::new_unknown(&schema).into(),
                &meta,
            );
        }

        // Size should increase after adding entries
        let filled_size = cache.memory_size();
        assert!(filled_size > empty_size);

        println!(
            "Cache with {} entries uses {} bytes",
            cache.len(),
            filled_size,
        );
    }
}
