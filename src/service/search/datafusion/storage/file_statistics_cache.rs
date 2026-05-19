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
    collections::{HashMap, VecDeque},
    sync::{
        Arc, LazyLock as Lazy,
        atomic::{AtomicI64, Ordering},
    },
    time::Instant,
};

use config::metrics;
use dashmap::DashMap;
use datafusion::{
    common::Statistics,
    execution::cache::{
        CacheAccessor,
        cache_manager::{CachedFileMetadata, FileStatisticsCacheEntry},
    },
};
use object_store::{ObjectMeta, path::Path};

use super::TRACE_ID_SEPARATOR;

pub static GLOBAL_CACHE: Lazy<Arc<FileStatisticsCache>> =
    Lazy::new(|| Arc::new(FileStatisticsCache::default()));

/// Collected statistics for files
/// Cache is invalided when file size or last modification has changed
pub struct FileStatisticsCache {
    statistics: DashMap<String, (ObjectMeta, Arc<Statistics>, usize)>,
    cacher: parking_lot::Mutex<VecDeque<String>>,
    current_memory: AtomicI64,
}

impl FileStatisticsCache {
    pub fn new() -> Self {
        Self {
            statistics: DashMap::new(),
            cacher: parking_lot::Mutex::new(VecDeque::new()),
            current_memory: AtomicI64::new(0),
        }
    }

    pub fn len(&self) -> usize {
        self.statistics.len()
    }

    pub fn memory_size(&self) -> usize {
        self.current_memory.load(Ordering::Relaxed).max(0) as usize
    }

    fn estimate_entry_size(key: &str, meta: &ObjectMeta, stats: &Statistics) -> usize {
        // Key is stored both in the DashMap and the eviction queue
        let mut size = (std::mem::size_of::<String>() + key.len()) * 2;

        size += std::mem::size_of::<ObjectMeta>();
        size += meta.location.as_ref().len();
        if let Some(ref etag) = meta.e_tag {
            size += std::mem::size_of::<String>() + etag.len();
        }
        if let Some(ref version) = meta.version {
            size += std::mem::size_of::<String>() + version.len();
        }

        size += std::mem::size_of::<Statistics>();
        size += std::mem::size_of::<usize>(); // tracked entry size field

        for col in &stats.column_statistics {
            size += std::mem::size_of::<datafusion::common::ColumnStatistics>();
            size += col.min_value.get_value().map(|v| v.size()).unwrap_or(0);
            size += col.max_value.get_value().map(|v| v.size()).unwrap_or(0);
            size += col.sum_value.get_value().map(|v| v.size()).unwrap_or(0);
        }

        size
    }

    fn evict(&self, max_bytes: usize) {
        let start = Instant::now();
        let mut warned = false;
        let mut w = self.cacher.lock();
        while self.current_memory.load(Ordering::Relaxed) > max_bytes as i64 && !w.is_empty() {
            if !warned {
                log::warn!(
                    "FileStatisticsCache is full ({} bytes > {} bytes), evicting oldest entries",
                    self.current_memory.load(Ordering::Relaxed),
                    max_bytes,
                );
                warned = true;
            }
            let batch = (w.len() / 20).max(1).min(w.len());
            let mut removed_total = 0i64;
            for k in w.drain(0..batch) {
                if let Some((_, (_, _, size))) = self.statistics.remove(&k) {
                    removed_total += size as i64;
                }
            }
            if removed_total > 0 {
                self.current_memory
                    .fetch_sub(removed_total, Ordering::Relaxed);
            }
        }
        drop(w);
        metrics::QUERY_PARQUET_METADATA_CACHE_GC_COUNT
            .with_label_values::<&str>(&[])
            .inc();
        metrics::QUERY_PARQUET_METADATA_CACHE_GC_TIME
            .with_label_values::<&str>(&[])
            .observe(start.elapsed().as_millis() as f64);
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

impl CacheAccessor<Path, CachedFileMetadata> for FileStatisticsCache {
    /// Get cached metadata for file location.
    fn get(&self, k: &Path) -> Option<CachedFileMetadata> {
        let k = self.format_key(k);
        match self.statistics.get(&k) {
            Some(s) => {
                metrics::QUERY_PARQUET_METADATA_CACHE_HITS_TOTAL
                    .with_label_values::<&str>(&[])
                    .inc();
                let (meta, statistics, _) = s.value();
                Some(CachedFileMetadata::new(
                    meta.clone(),
                    statistics.clone(),
                    None,
                ))
            }
            None => {
                metrics::QUERY_PARQUET_METADATA_CACHE_MISS_TOTAL
                    .with_label_values::<&str>(&[])
                    .inc();
                None
            }
        }
    }

    /// Save collected file statistics
    fn put(&self, k: &Path, value: CachedFileMetadata) -> Option<CachedFileMetadata> {
        let k = self.format_key(k);
        let entry_size = Self::estimate_entry_size(&k, &value.meta, &value.statistics);

        let old = self.statistics.insert(
            k.clone(),
            (value.meta.clone(), value.statistics.clone(), entry_size),
        );
        let old_size = old.as_ref().map(|(_, _, s)| *s).unwrap_or(0);
        let delta = entry_size as i64 - old_size as i64;
        self.current_memory.fetch_add(delta, Ordering::Relaxed);

        self.cacher.lock().push_back(k);

        let max_bytes = config::get_config().limit.datafusion_file_stat_cache_max_size;
        if self.current_memory.load(Ordering::Relaxed) > max_bytes as i64 {
            self.evict(max_bytes);
        }

        old.map(|(meta, stats, _)| CachedFileMetadata::new(meta, stats, None))
    }

    fn remove(&self, k: &Path) -> Option<CachedFileMetadata> {
        let k = self.format_key(k);
        self.statistics.remove(&k).map(|(_, (meta, stats, size))| {
            self.current_memory
                .fetch_sub(size as i64, Ordering::Relaxed);
            CachedFileMetadata::new(meta, stats, None)
        })
    }

    fn contains_key(&self, k: &Path) -> bool {
        let k = self.format_key(k);
        self.statistics.contains_key(&k)
    }

    fn len(&self) -> usize {
        self.statistics.len()
    }

    fn clear(&self) {
        self.statistics.clear();
        self.cacher.lock().clear();
        self.current_memory.store(0, Ordering::Relaxed);
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
            let (object_meta, stats, _) = entry.value();
            entries.insert(
                path,
                FileStatisticsCacheEntry {
                    object_meta: object_meta.clone(),
                    num_rows: stats.num_rows,
                    num_columns: stats.column_statistics.len(),
                    table_size_bytes: stats.total_byte_size,
                    statistics_size_bytes: 0,
                    has_ordering: false,
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
        assert!(cache.get(&meta.location).is_none());

        let stats: Arc<Statistics> = Statistics::new_unknown(&Schema::new(vec![Field::new(
            "test_column",
            DataType::Timestamp(TimeUnit::Second, None),
            false,
        )]))
        .into();
        cache.put(
            &meta.location,
            CachedFileMetadata::new(meta.clone(), stats, None),
        );
        let cached = cache.get(&meta.location);
        assert!(cached.is_some());
        assert!(cached.unwrap().is_valid_for(&meta));

        // file size changed
        let mut meta2 = meta.clone();
        meta2.size = 2048;
        let cached = cache.get(&meta2.location);
        assert!(cached.is_some());
        assert!(!cached.unwrap().is_valid_for(&meta2));

        // file last_modified changed
        let mut meta2 = meta.clone();
        meta2.last_modified = DateTime::parse_from_rfc3339("2022-09-27T22:40:00+02:00")
            .unwrap()
            .into();
        let cached = cache.get(&meta2.location);
        assert!(cached.is_some());
        assert!(!cached.unwrap().is_valid_for(&meta2));

        // different file
        let mut meta2 = meta;
        meta2.location = Path::from("test2");
        assert!(cache.get(&meta2.location).is_none());
    }

    #[test]
    fn test_memory_size_calculation() {
        let cache = FileStatisticsCache::new();

        // Empty cache tracks zero memory
        let empty_size = cache.memory_size();
        assert_eq!(empty_size, 0);

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

            cache.put(
                &meta.location,
                CachedFileMetadata::new(
                    meta.clone(),
                    Statistics::new_unknown(&schema).into(),
                    None,
                ),
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

        // After clearing, tracked memory must return to zero
        cache.clear();
        assert_eq!(cache.memory_size(), 0);
    }

    #[test]
    fn test_cache_name() {
        let cache = FileStatisticsCache::new();
        assert_eq!(cache.name(), "FileStatisticsCache");
    }

    #[test]
    fn test_cache_contains_key_and_remove() {
        let cache = FileStatisticsCache::new();
        let path = Path::from("test_file");
        let meta = ObjectMeta {
            location: path.clone(),
            last_modified: DateTime::parse_from_rfc3339("2024-01-15T00:00:00+00:00")
                .unwrap()
                .into(),
            size: 512,
            e_tag: None,
            version: None,
        };
        let schema = Schema::new(vec![Field::new("col", DataType::Utf8, false)]);
        let stats: Arc<Statistics> = Statistics::new_unknown(&schema).into();

        assert!(!cache.contains_key(&path));

        cache.put(&path, CachedFileMetadata::new(meta.clone(), stats, None));
        assert!(cache.contains_key(&path));
        assert_eq!(cache.len(), 1);

        let removed = cache.remove(&path);
        assert!(removed.is_some());
        assert!(!cache.contains_key(&path));
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_cache_clear() {
        let cache = FileStatisticsCache::new();
        let schema = Schema::new(vec![Field::new("col", DataType::Int64, false)]);

        for i in 0..3 {
            let path = Path::from(format!("file_{i}"));
            let meta = ObjectMeta {
                location: path.clone(),
                last_modified: DateTime::parse_from_rfc3339("2024-01-15T00:00:00+00:00")
                    .unwrap()
                    .into(),
                size: 100 * (i + 1),
                e_tag: None,
                version: None,
            };
            let stats: Arc<Statistics> = Statistics::new_unknown(&schema).into();
            cache.put(&path, CachedFileMetadata::new(meta, stats, None));
        }

        assert_eq!(cache.len(), 3);
        cache.clear();
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_list_entries() {
        use datafusion::execution::cache::cache_manager::FileStatisticsCache as FscTrait;

        let cache = super::FileStatisticsCache::new();
        let path = Path::from("list_test");
        let meta = ObjectMeta {
            location: path.clone(),
            last_modified: DateTime::parse_from_rfc3339("2024-01-15T00:00:00+00:00")
                .unwrap()
                .into(),
            size: 256,
            e_tag: None,
            version: None,
        };
        let schema = Schema::new(vec![Field::new("col", DataType::Utf8, false)]);
        let stats: Arc<Statistics> = Statistics::new_unknown(&schema).into();

        let entries_before = FscTrait::list_entries(&cache);
        assert!(entries_before.is_empty());

        cache.put(&path, CachedFileMetadata::new(meta, stats, None));
        let entries = FscTrait::list_entries(&cache);
        assert_eq!(entries.len(), 1);
        assert!(entries.contains_key(&path));
    }

    #[test]
    fn test_cache_remove_nonexistent_returns_none() {
        let cache = FileStatisticsCache::new();
        let path = Path::from("does_not_exist");
        let removed = cache.remove(&path);
        assert!(removed.is_none());
    }
}
