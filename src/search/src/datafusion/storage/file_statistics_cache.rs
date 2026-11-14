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
        atomic::{AtomicI64, AtomicUsize, Ordering},
    },
    time::Instant,
};

use config::metrics;
use dashmap::DashMap;
use datafusion::{
    common::{
        HashMap, TableReference,
        heap_size::{DFHeapSize, DFHeapSizeCtx},
    },
    execution::cache::{
        Cache, CacheEntryInfo, CacheValue, TableScopedPath, cache_manager::CachedFileMetadata,
    },
    physical_expr::{LexOrdering, PhysicalExpr, PhysicalSortExpr, expressions::Column},
};
use object_store::path::Path;

use super::TRACE_ID_SEPARATOR;

// Unused hash table capacity and allocator rounding per entry.
const HASH_TABLE_SLACK: usize = 64;

pub static GLOBAL_CACHE: Lazy<Arc<FileStatisticsCache>> =
    Lazy::new(|| Arc::new(FileStatisticsCache::default()));

/// Collected statistics for files
/// Cache is invalided when file size or last modification has changed
pub struct FileStatisticsCache {
    // Keyed by file so a deleted file drops the entries of every table schema at once.
    statistics: DashMap<String, Vec<CacheSlot>>,
    cacher: parking_lot::Mutex<VecDeque<String>>,
    current_memory: AtomicI64,
    entries: AtomicUsize,
}

impl FileStatisticsCache {
    pub fn new() -> Self {
        Self {
            statistics: DashMap::new(),
            cacher: parking_lot::Mutex::new(VecDeque::new()),
            current_memory: AtomicI64::new(0),
            entries: AtomicUsize::new(0),
        }
    }

    pub fn len(&self) -> usize {
        self.entries.load(Ordering::Relaxed)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn memory_size(&self) -> usize {
        self.current_memory.load(Ordering::Relaxed).max(0) as usize
    }

    /// Drops the entries of a file that was deleted from disk, e.g. a WAL parquet file
    /// moved to object storage; `file_key` is the path relative to the storage root.
    pub fn remove_file(&self, file_key: &str) {
        let file = Path::from(format!("{TRACE_ID_SEPARATOR}/{file_key}"));
        if let Some((_, slots)) = self.statistics.remove(file.as_ref()) {
            for slot in &slots {
                self.release(slot.size);
            }
            self.compact_cacher();
        }
    }

    fn estimate_entry_size(key: &str, value: &CachedFileMetadata) -> usize {
        // The key is stored twice: split into map key and slot prefix, and whole in `cacher`.
        (std::mem::size_of::<String>() + key.len()) * 2
            + std::mem::size_of::<CacheSlot>()
            + std::mem::size_of::<(String, Vec<CacheSlot>)>()
            + value.size()
            // DataFusion skips it as shared per table, but WAL search builds a table per query.
            + value
                .schema_fingerprint
                .heap_size(&mut DFHeapSizeCtx::default())
            + Self::estimate_ordering_size(value.ordering.as_ref())
            + HASH_TABLE_SLACK
    }

    // CacheValue::size skips the ordering.
    fn estimate_ordering_size(ordering: Option<&LexOrdering>) -> usize {
        ordering.map_or(0, |ordering| {
            ordering
                .iter()
                .map(|sort_expr| {
                    let name_len = sort_expr
                        .expr
                        .downcast_ref::<Column>()
                        .map_or(0, |column| column.name().len());
                    std::mem::size_of::<PhysicalSortExpr>()
                        + std::mem::size_of::<Arc<dyn PhysicalExpr>>()
                        + std::mem::size_of::<Column>()
                        + name_len
                })
                .sum()
        })
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
            for k in w.drain(0..batch) {
                self.remove_slot(&k);
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

    fn remove_slot(&self, key: &str) -> Option<CacheSlot> {
        let (prefix, file) = split_entry_key(key);
        let mut removed = None;
        self.statistics.remove_if_mut(file, |_, slots| {
            if let Some(i) = slots.iter().position(|slot| slot.prefix == prefix) {
                removed = Some(slots.swap_remove(i));
            }
            slots.is_empty()
        });
        if let Some(slot) = &removed {
            self.release(slot.size);
        }
        removed
    }

    fn release(&self, size: usize) {
        self.current_memory
            .fetch_sub(size as i64, Ordering::Relaxed);
        self.entries.fetch_sub(1, Ordering::Relaxed);
    }

    // Removed keys stay in `cacher` until evicted; drop them once they outnumber live entries.
    fn compact_cacher(&self) {
        let mut keys = self.cacher.lock();
        if keys.len() > self.len() * 2 {
            keys.retain(|key| self.contains_entry(key));
        }
    }

    fn contains_entry(&self, key: &str) -> bool {
        let (prefix, file) = split_entry_key(key);
        self.statistics
            .get(file)
            .is_some_and(|slots| slots.iter().any(|slot| slot.prefix == prefix))
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
        let (prefix, file) = split_entry_key(entry_key(&k.path));
        let value = self.statistics.get(file).and_then(|slots| {
            slots
                .iter()
                .find(|slot| slot.prefix == prefix)
                .map(|slot| slot.value.clone())
        });
        let counter = if value.is_some() {
            &metrics::QUERY_PARQUET_METADATA_CACHE_HITS_TOTAL
        } else {
            &metrics::QUERY_PARQUET_METADATA_CACHE_MISS_TOTAL
        };
        counter.with_label_values::<&str>(&[]).inc();
        value
    }

    /// Save collected file statistics
    fn put(&self, k: &TableScopedPath, value: CachedFileMetadata) -> Option<CachedFileMetadata> {
        let key = entry_key(&k.path);
        let (prefix, file) = split_entry_key(key);
        let size = Self::estimate_entry_size(key, &value);

        let old = {
            let mut slots = self
                .statistics
                .entry(file.to_string())
                .or_insert_with(|| Vec::with_capacity(1));
            match slots.iter_mut().find(|slot| slot.prefix == prefix) {
                Some(slot) => Some((
                    std::mem::replace(&mut slot.value, value),
                    std::mem::replace(&mut slot.size, size),
                )),
                None => {
                    slots.push(CacheSlot {
                        prefix: prefix.to_string(),
                        value,
                        size,
                    });
                    None
                }
            }
        };
        let old_size = old.as_ref().map_or(0, |(_, s)| *s);
        self.current_memory
            .fetch_add(size as i64 - old_size as i64, Ordering::Relaxed);

        // An overwritten key is still queued in `cacher`; queueing it again would duplicate it.
        if old.is_none() {
            self.entries.fetch_add(1, Ordering::Relaxed);
            self.cacher.lock().push_back(key.to_string());
        }

        let max_bytes = config::get_config()
            .limit
            .datafusion_file_stat_cache_max_size;
        if self.current_memory.load(Ordering::Relaxed) > max_bytes as i64 {
            self.evict(max_bytes);
        }

        old.map(|(value, _)| value)
    }

    fn remove(&self, k: &TableScopedPath) -> Option<CachedFileMetadata> {
        let removed = self.remove_slot(entry_key(&k.path));
        if removed.is_some() {
            self.compact_cacher();
        }
        removed.map(|slot| slot.value)
    }

    fn contains_key(&self, k: &TableScopedPath) -> bool {
        self.contains_entry(entry_key(&k.path))
    }

    fn len(&self) -> usize {
        FileStatisticsCache::len(self)
    }

    fn clear(&self) {
        let mut keys = self.cacher.lock();
        self.statistics.clear();
        keys.clear();
        self.current_memory.store(0, Ordering::Relaxed);
        self.entries.store(0, Ordering::Relaxed);
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
        None
    }

    fn update_cache_ttl(&self, _ttl: Option<std::time::Duration>) {}

    fn list_entries(&self) -> HashMap<TableScopedPath, CacheEntryInfo<CachedFileMetadata>> {
        self.statistics
            .iter()
            .flat_map(|entry| {
                let file = entry.key();
                entry
                    .value()
                    .iter()
                    .map(|slot| {
                        let path = TableScopedPath {
                            table: None,
                            path: Path::from(format!("{}{file}", slot.prefix)),
                        };
                        let info = CacheEntryInfo {
                            value: slot.value.clone(),
                            size_bytes: slot.size,
                            hits: 0,
                            expires: None,
                        };
                        (path, info)
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    fn drop_table_entries(&self, _table_ref: &TableReference) -> datafusion::error::Result<()> {
        Ok(())
    }
}

/// Statistics of one file as cached for one table prefix (`/schema=../format=../`).
struct CacheSlot {
    prefix: String,
    value: CachedFileMetadata,
    size: usize,
}

/// Strips the per-query trace id, leaving `/schema=../format=../$$/<file>`.
fn entry_key(path: &Path) -> &str {
    let k = path.as_ref();
    match k.find(TRACE_ID_SEPARATOR) {
        Some(p) => &k[k[..p].find("/schema=").unwrap_or(p)..],
        None => k,
    }
}

/// Splits an entry key into its table prefix and the `$$/<file>` part.
fn split_entry_key(key: &str) -> (&str, &str) {
    key.find(TRACE_ID_SEPARATOR)
        .map_or(("", key), |p| key.split_at(p))
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, Utc};
    use datafusion::{
        arrow::datatypes::{DataType, Field, Schema, TimeUnit},
        common::Statistics,
    };
    use object_store::ObjectMeta;

    use super::*;

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
            CachedFileMetadata::new(
                meta,
                Arc::new(
                    datafusion::execution::cache::SchemaFingerprint::from_schema(&Schema::empty()),
                ),
                stats,
                None,
            ),
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
        assert!(cached.is_valid_for(&meta, &cached.schema_fingerprint));

        // same location but file size changed -> cached but stale
        let mut changed = meta.clone();
        changed.size = 2048;
        let cached = cache.get(&key(&changed.location)).expect("entry present");
        assert!(!cached.is_valid_for(&changed, &cached.schema_fingerprint));

        // same location but last_modified changed -> cached but stale
        let mut changed = meta.clone();
        changed.last_modified = ts("2024-01-15T01:00:00+00:00");
        let cached = cache.get(&key(&changed.location)).expect("entry present");
        assert!(!cached.is_valid_for(&changed, &cached.schema_fingerprint));

        // different location -> miss
        assert!(cache.get(&key(&Path::from("test2"))).is_none());
    }

    #[test]
    fn test_cache_preserves_schema_fingerprint_and_ordering() {
        use datafusion::{
            execution::cache::SchemaFingerprint,
            physical_expr::{LexOrdering, PhysicalSortExpr, expressions::Column},
        };

        let schema = Schema::new(vec![Field::new("value", DataType::Int64, false)]);
        let fingerprint = Arc::new(SchemaFingerprint::from_schema(&schema));
        let changed = Arc::new(SchemaFingerprint::from_schema(&Schema::new(vec![
            Field::new("value", DataType::Utf8, false),
        ])));
        let meta = object_meta("schema_evolution", 128);
        let key = key(&meta.location);
        let value = CachedFileMetadata::new(
            meta.clone(),
            fingerprint.clone(),
            Arc::new(Statistics::new_unknown(&schema)),
            LexOrdering::new(vec![PhysicalSortExpr::new_default(Arc::new(Column::new(
                "value", 0,
            )))]),
        );
        let cache = FileStatisticsCache::new();
        assert!(cache.put(&key, value.clone()).is_none());
        let cached = cache.get(&key).unwrap();
        assert_eq!(cached, value);
        assert!(cached.is_valid_for(&meta, &fingerprint));
        assert!(!cached.is_valid_for(&meta, &changed));
        assert_eq!(cache.list_entries()[&key].value, value);
        assert_eq!(cache.put(&key, value.clone()), Some(value.clone()));
        assert_eq!(cache.remove(&key), Some(value));
        assert_eq!(cache.memory_size(), 0);
    }

    #[test]
    fn test_ordering_is_charged_to_memory_size() {
        use datafusion::{
            execution::cache::SchemaFingerprint,
            physical_expr::{LexOrdering, PhysicalSortExpr, expressions::Column},
        };

        let schema = Schema::new(vec![Field::new("value", DataType::Int64, false)]);
        let meta = object_meta("ordered", 128);
        let entry = |ordering| {
            CachedFileMetadata::new(
                meta.clone(),
                Arc::new(SchemaFingerprint::from_schema(&schema)),
                Arc::new(Statistics::new_unknown(&schema)),
                ordering,
            )
        };
        let unordered = FileStatisticsCache::estimate_entry_size("k", &entry(None));
        let ordered = FileStatisticsCache::estimate_entry_size(
            "k",
            &entry(LexOrdering::new(vec![PhysicalSortExpr::new_default(
                Arc::new(Column::new("value", 0)),
            )])),
        );
        assert!(ordered > unordered);
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
        use datafusion::execution::cache::Cache as FscTrait;

        let cache = FileStatisticsCache::new();
        let meta = object_meta("list_test", 256);
        let k = key(&meta.location);

        assert!(FscTrait::list_entries(&cache).is_empty());

        put(
            &cache,
            meta,
            unknown_stats(vec![Field::new("col", DataType::Utf8, false)]),
        );
        let entries = FscTrait::list_entries(&cache);
        assert_eq!(entries.len(), 1);
        assert!(entries.contains_key(&k));
    }

    #[test]
    fn test_estimate_counts_unshared_schema_fingerprint() {
        use datafusion::execution::cache::SchemaFingerprint;

        let names = ["a", "bb", "ccc"];
        let schema = Schema::new(
            names
                .iter()
                .map(|name| Field::new(*name, DataType::Utf8, true))
                .collect::<Vec<_>>(),
        );
        let stats = Arc::new(Statistics::new_unknown(&schema));
        let entry = |fingerprint: SchemaFingerprint| {
            CachedFileMetadata::new(
                object_meta("f", 1),
                Arc::new(fingerprint),
                stats.clone(),
                None,
            )
        };
        let with_columns = FileStatisticsCache::estimate_entry_size(
            "k",
            &entry(SchemaFingerprint::from_schema(&schema)),
        );
        let without_columns = FileStatisticsCache::estimate_entry_size(
            "k",
            &entry(SchemaFingerprint::from_schema(&Schema::empty())),
        );
        let columns_heap = names.len() * std::mem::size_of::<(String, DataType, bool)>()
            + names.iter().map(|name| name.len()).sum::<usize>();
        assert_eq!(with_columns - without_columns, columns_heap);
    }

    #[test]
    fn test_estimate_counts_min_max_strings() {
        use datafusion::common::{ColumnStatistics, ScalarValue, stats::Precision};

        let schema = Schema::new(vec![
            Field::new("a", DataType::Utf8, true),
            Field::new("b", DataType::Utf8, true),
        ]);
        let strings = ["x".repeat(87), "y".repeat(87), "z".repeat(5), String::new()];
        let mut with_strings = Statistics::new_unknown(&schema);
        for (column, pair) in with_strings
            .column_statistics
            .iter_mut()
            .zip(strings.chunks(2))
        {
            *column = ColumnStatistics {
                min_value: Precision::Exact(ScalarValue::Utf8(Some(pair[0].clone()))),
                max_value: Precision::Exact(ScalarValue::Utf8(Some(pair[1].clone()))),
                ..ColumnStatistics::new_unknown()
            };
        }
        let entry = |stats: Statistics| {
            CachedFileMetadata::new(
                object_meta("f", 1),
                Arc::new(datafusion::execution::cache::SchemaFingerprint::from_schema(&schema)),
                Arc::new(stats),
                None,
            )
        };
        let counted = FileStatisticsCache::estimate_entry_size("k", &entry(with_strings))
            - FileStatisticsCache::estimate_entry_size(
                "k",
                &entry(Statistics::new_unknown(&schema)),
            );
        assert_eq!(counted, strings.iter().map(String::capacity).sum::<usize>());
    }

    #[test]
    fn test_remove_file_drops_entries_of_every_schema() {
        let wal_file = "files/default/logs/app/2026/11/14/01/7d3c0f1e.parquet";
        let other_file = "files/default/logs/app/2026/11/14/01/9a8b7c6d.parquet";
        let cache = FileStatisticsCache::new();
        let stats = unknown_stats(vec![Field::new("col", DataType::Utf8, false)]);
        for location in [
            format!("t1-wal-false/schema=a/format=parquet/$$/{wal_file}"),
            format!("t2-wal-true/schema=b/format=parquet/$$/{wal_file}"),
            format!("t3-wal-false/schema=a/format=parquet/$$/{other_file}"),
        ] {
            put(&cache, object_meta(&location, 64), stats.clone());
        }
        assert_eq!(cache.len(), 3);
        let other = key(&Path::from(format!(
            "t4-wal-false/schema=a/format=parquet/$$/{other_file}"
        )));
        let other_size = cache.list_entries()[&key(&Path::from(format!(
            "/schema=a/format=parquet/$$/{other_file}"
        )))]
            .size_bytes;

        cache.remove_file(wal_file);

        assert_eq!(cache.len(), 1);
        assert_eq!(cache.memory_size(), other_size);
        assert!(cache.get(&other).is_some());
        assert!(!cache.contains_key(&key(&Path::from(format!(
            "t5-wal-false/schema=b/format=parquet/$$/{wal_file}"
        )))));
    }

    #[test]
    fn test_removed_keys_are_compacted_from_eviction_queue() {
        let cache = FileStatisticsCache::new();
        let stats = unknown_stats(vec![Field::new("col", DataType::Int64, false)]);
        for i in 0..4 {
            let location = format!("t-wal-false/schema=a/format=parquet/$$/files/{i}.parquet");
            put(&cache, object_meta(&location, 64), stats.clone());
        }
        for i in 0..3 {
            cache.remove_file(&format!("files/{i}.parquet"));
        }
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.cacher.lock().len(), 1);
    }

    #[test]
    fn test_evict_releases_all_entries() {
        let cache = FileStatisticsCache::new();
        let stats = unknown_stats(vec![Field::new("col", DataType::Int64, false)]);
        for i in 0..3 {
            put(&cache, object_meta(&format!("file_{i}"), 64), stats.clone());
        }
        cache.evict(0);
        assert!(cache.is_empty());
        assert_eq!(cache.memory_size(), 0);
        assert!(cache.statistics.is_empty());
        assert!(cache.cacher.lock().is_empty());
    }

    #[test]
    fn test_cache_remove_nonexistent_returns_none() {
        let cache = FileStatisticsCache::new();
        assert!(cache.remove(&key(&Path::from("does_not_exist"))).is_none());
    }
}
