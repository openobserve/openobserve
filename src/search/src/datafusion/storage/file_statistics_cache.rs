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
    sync::{
        Arc, LazyLock as Lazy,
        atomic::{AtomicI64, Ordering},
    },
    time::Instant,
};

use config::metrics;
use dashmap::DashMap;
use datafusion::{
    common::{HashMap, Statistics, TableReference},
    execution::cache::{Cache, CacheEntryInfo, TableScopedPath, cache_manager::CachedFileMetadata},
};
use object_store::{ObjectMeta, path::Path};

use super::TRACE_ID_SEPARATOR;

pub static GLOBAL_CACHE: Lazy<Arc<FileStatisticsCache>> =
    Lazy::new(|| Arc::new(FileStatisticsCache::default()));

/// Collected statistics for files
/// Cache is invalided when file size or last modification has changed
pub struct FileStatisticsCache {
    statistics: DashMap<String, (CachedFileMetadata, usize)>,
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

    pub fn is_empty(&self) -> bool {
        self.statistics.is_empty()
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
        // Arc<Statistics> header (strong + weak counter) and DashMap bucket
        // overhead (hash + slot metadata). Conservative fixed overhead per
        // entry so the memory budget is not systematically underestimated.
        size += 64;

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
                if let Some((_, (_, size))) = self.statistics.remove(&k) {
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

impl Cache<TableScopedPath, CachedFileMetadata> for FileStatisticsCache {
    /// Get cached metadata for file location.
    fn get(&self, k: &TableScopedPath) -> Option<CachedFileMetadata> {
        let k = self.format_key(&k.path);
        match self.statistics.get(&k) {
            Some(s) => {
                metrics::QUERY_PARQUET_METADATA_CACHE_HITS_TOTAL
                    .with_label_values::<&str>(&[])
                    .inc();
                let (cached, _) = s.value();
                Some(cached.clone())
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
    fn put(&self, k: &TableScopedPath, value: CachedFileMetadata) -> Option<CachedFileMetadata> {
        let k = self.format_key(&k.path);
        let entry_size = Self::estimate_entry_size(&k, &value.meta, &value.statistics);

        let old = self.statistics.insert(k.clone(), (value, entry_size));
        let old_size = old.as_ref().map(|(_, s)| *s).unwrap_or(0);
        let delta = entry_size as i64 - old_size as i64;
        self.current_memory.fetch_add(delta, Ordering::Relaxed);

        // Only queue the key for eviction when it's a fresh insertion.
        // When `old.is_some()` the key is already present in `cacher`
        // (it hasn't been drained yet, otherwise stats wouldn't hold it),
        // so pushing again would create a duplicate tombstone.
        if old.is_none() {
            self.cacher.lock().push_back(k);
        }

        let max_bytes = config::get_config()
            .limit
            .datafusion_file_stat_cache_max_size;
        if self.current_memory.load(Ordering::Relaxed) > max_bytes as i64 {
            self.evict(max_bytes);
        }

        old.map(|(cached, _)| cached)
    }

    fn remove(&self, k: &TableScopedPath) -> Option<CachedFileMetadata> {
        let k = self.format_key(&k.path);
        self.statistics.remove(&k).map(|(_, (cached, size))| {
            self.current_memory
                .fetch_sub(size as i64, Ordering::Relaxed);
            cached
        })
    }

    fn contains_key(&self, k: &TableScopedPath) -> bool {
        let k = self.format_key(&k.path);
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

    fn cache_limit(&self) -> usize {
        config::get_config()
            .limit
            .datafusion_file_stat_cache_max_size
    }

    fn update_cache_limit(&self, _limit: usize) {
        // No-op: this is a process-wide, long-lived global cache whose eviction
        // budget is owned solely by `put()` via `datafusion_file_stat_cache_max_size`.
        // DataFusion calls this once per `CacheManager::try_new` (i.e. per session /
        // per query) with its own per-session limit;
    }

    fn cache_ttl(&self) -> Option<std::time::Duration> {
        // Entries never expire on their own; eviction is size-driven in `put()`.
        None
    }

    fn update_cache_ttl(&self, _ttl: Option<std::time::Duration>) {
        // No-op: TTL is not supported by this cache (see `cache_ttl`).
    }

    fn drop_table_entries(&self, _table_ref: &TableReference) -> datafusion::error::Result<()> {
        Ok(())
    }

    fn list_entries(&self) -> HashMap<TableScopedPath, CacheEntryInfo<CachedFileMetadata>> {
        let mut entries = HashMap::<TableScopedPath, CacheEntryInfo<CachedFileMetadata>>::new();

        for entry in &self.statistics {
            let path = TableScopedPath {
                table: None,
                path: Path::from(entry.key().as_str()),
            };
            let (cached, size) = entry.value();
            entries.insert(
                path,
                CacheEntryInfo {
                    value: cached.clone(),
                    size_bytes: *size,
                    hits: 0,
                    expires: None,
                },
            );
        }

        entries
    }
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, Utc};
    use datafusion::{
        arrow::datatypes::{DataType, Field, Schema, TimeUnit},
        execution::cache::SchemaFingerprint,
    };

    use super::*;

    /// Fixed fingerprint shared by all test entries.
    fn fingerprint() -> Arc<SchemaFingerprint> {
        Arc::new(SchemaFingerprint::from_schema(&Schema::empty()))
    }

    /// Wrap a [`Path`] into the table-scoped key the cache API expects.
    fn key(location: &Path) -> TableScopedPath {
        TableScopedPath {
            table: None,
            path: location.clone(),
        }
    }

    /// Parse an RFC3339 timestamp, panicking on malformed input (test-only).
    fn ts(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().into()
    }

    /// Minimal [`ObjectMeta`] for a location, fixed `last_modified`, no etag/version.
    fn object_meta(location: &str, size: u64) -> ObjectMeta {
        ObjectMeta {
            location: Path::from(location),
            last_modified: ts("2024-01-15T00:00:00+00:00"),
            size,
            e_tag: None,
            version: None,
        }
    }

    /// Unknown statistics for the given fields, ready to cache.
    fn unknown_stats(fields: Vec<Field>) -> Arc<Statistics> {
        Statistics::new_unknown(&Schema::new(fields)).into()
    }

    /// Insert an entry into the cache under its own location.
    fn put(cache: &FileStatisticsCache, meta: ObjectMeta, stats: Arc<Statistics>) {
        cache.put(
            &key(&meta.location),
            CachedFileMetadata::new(meta, fingerprint(), stats, None),
        );
    }

    #[test]
    fn test_file_statistics_cache() {
        let meta = object_meta("test", 1024);
        let cache = FileStatisticsCache::default();
        assert!(cache.get(&key(&meta.location)).is_none());

        let stats = unknown_stats(vec![Field::new(
            "test_column",
            DataType::Timestamp(TimeUnit::Second, None),
            false,
        )]);
        put(&cache, meta.clone(), stats);

        // exact match is valid
        let cached = cache.get(&key(&meta.location)).expect("entry present");
        assert!(cached.is_valid_for(&meta, &fingerprint()));

        // same location but file size changed -> cached but stale
        let mut changed = meta.clone();
        changed.size = 2048;
        let cached = cache.get(&key(&changed.location)).expect("entry present");
        assert!(!cached.is_valid_for(&changed, &fingerprint()));

        // same location but last_modified changed -> cached but stale
        let mut changed = meta.clone();
        changed.last_modified = ts("2024-01-15T01:00:00+00:00");
        let cached = cache.get(&key(&changed.location)).expect("entry present");
        assert!(!cached.is_valid_for(&changed, &fingerprint()));

        // different location -> miss
        assert!(cache.get(&key(&Path::from("test2"))).is_none());
    }

    #[test]
    fn test_memory_size_calculation() {
        let cache = FileStatisticsCache::new();
        assert_eq!(cache.memory_size(), 0, "empty cache tracks zero memory");

        for i in 0..10u64 {
            let mut meta = object_meta(&format!("test_file_{i}"), 1024 * (i + 1));
            meta.e_tag = Some(format!("etag_{i}"));
            meta.version = Some(format!("v{i}"));
            let stats = unknown_stats(vec![
                Field::new("column1", DataType::Utf8, false),
                Field::new("column2", DataType::Int64, true),
                Field::new(
                    "column3",
                    DataType::Timestamp(TimeUnit::Microsecond, None),
                    false,
                ),
            ]);
            put(&cache, meta, stats);
        }

        assert!(
            cache.memory_size() > 0,
            "memory tracked after inserting entries"
        );
        assert_eq!(cache.len(), 10);

        cache.clear();
        assert_eq!(cache.memory_size(), 0, "cleared cache returns to zero");
    }

    #[test]
    fn test_cache_name() {
        assert_eq!(FileStatisticsCache::new().name(), "FileStatisticsCache");
    }

    #[test]
    fn test_cache_contains_key_and_remove() {
        let cache = FileStatisticsCache::new();
        let meta = object_meta("test_file", 512);
        let k = key(&meta.location);

        assert!(!cache.contains_key(&k));

        put(
            &cache,
            meta,
            unknown_stats(vec![Field::new("col", DataType::Utf8, false)]),
        );
        assert!(cache.contains_key(&k));
        assert_eq!(cache.len(), 1);

        assert!(cache.remove(&k).is_some());
        assert!(!cache.contains_key(&k));
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_cache_clear() {
        let cache = FileStatisticsCache::new();
        for i in 0..3u64 {
            let meta = object_meta(&format!("file_{i}"), 100 * (i + 1));
            put(
                &cache,
                meta,
                unknown_stats(vec![Field::new("col", DataType::Int64, false)]),
            );
        }

        assert_eq!(cache.len(), 3);
        cache.clear();
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_list_entries() {
        let cache = FileStatisticsCache::new();
        let meta = object_meta("list_test", 256);
        let k = key(&meta.location);

        assert!(cache.list_entries().is_empty());

        put(
            &cache,
            meta,
            unknown_stats(vec![Field::new("col", DataType::Utf8, false)]),
        );
        let entries = cache.list_entries();
        assert_eq!(entries.len(), 1);
        assert!(entries.contains_key(&k));
    }

    #[test]
    fn test_cache_remove_nonexistent_returns_none() {
        let cache = FileStatisticsCache::new();
        assert!(cache.remove(&key(&Path::from("does_not_exist"))).is_none());
    }
}
