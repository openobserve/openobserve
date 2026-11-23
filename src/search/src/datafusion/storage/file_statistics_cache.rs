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
    sync::{
        Arc, LazyLock as Lazy,
        atomic::{AtomicI64, Ordering},
    },
    time::Instant,
};

use config::metrics;
use dashmap::{DashMap, mapref::entry::Entry};
use datafusion::{
    common::{
        ColumnStatistics, HashMap, Statistics, TableReference,
        heap_size::{DFHeapSize, DFHeapSizeCtx},
    },
    execution::cache::{
        Cache, CacheEntryInfo, SchemaFingerprint, TableScopedPath,
        cache_manager::CachedFileMetadata,
    },
    physical_expr::{LexOrdering, PhysicalExpr, PhysicalSortExpr, expressions::Column},
};
use infra::cache::recency::{EvictedKeys, Recency, now_secs};
use object_store::path::Path;

use super::TRACE_ID_SEPARATOR;

pub static GLOBAL_CACHE: Lazy<Arc<FileStatisticsCache>> =
    Lazy::new(|| Arc::new(FileStatisticsCache::default()));

/// Collected statistics for files
/// Cache is invalided when file size or last modification has changed
pub struct FileStatisticsCache {
    statistics: DashMap<String, StatEntry>,
    evicting: parking_lot::Mutex<()>,
    evicted: EvictedKeys,
    // Equal fingerprints are shared across entries and charged once; the value counts users.
    fingerprints: DashMap<Arc<SchemaFingerprint>, usize>,
    current_memory: AtomicI64,
}

impl FileStatisticsCache {
    pub fn new() -> Self {
        Self {
            statistics: DashMap::new(),
            evicting: parking_lot::Mutex::new(()),
            evicted: EvictedKeys::new(),
            fingerprints: DashMap::new(),
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

    fn estimate_entry_size(key: &str, value: &CachedFileMetadata) -> usize {
        // The key is charged twice because eviction clones every key into its sort buffer.
        (std::mem::size_of::<String>() + alloc_size(key.len())) * 2
            + std::mem::size_of::<StatEntry>()
            + value_heap_size(value)
            + Self::estimate_ordering_size(value.ordering.as_ref())
            + 64
    }

    // `value_heap_size` skips the ordering; the fingerprint is charged by `intern_fingerprint`.
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

    fn lookup(&self, key: &str, now: u32) -> Option<CachedFileMetadata> {
        if let Some(entry) = self.statistics.get(key) {
            entry.recency.touch(now);
            metrics::QUERY_PARQUET_METADATA_CACHE_HITS_TOTAL
                .with_label_values::<&str>(&[])
                .inc();
            return Some(entry.value.clone());
        }
        metrics::QUERY_PARQUET_METADATA_CACHE_MISS_TOTAL
            .with_label_values::<&str>(&[])
            .inc();
        if self.evicted.take(key) {
            metrics::QUERY_PARQUET_METADATA_CACHE_REREAD_MISS_TOTAL
                .with_label_values::<&str>(&[])
                .inc();
        }
        None
    }

    fn insert(
        &self,
        key: String,
        value: CachedFileMetadata,
        now: u32,
    ) -> Option<CachedFileMetadata> {
        let value = CachedFileMetadata {
            schema_fingerprint: self.intern_fingerprint(&value.schema_fingerprint),
            ..value
        };
        let size = Self::estimate_entry_size(&key, &value);
        let entry = StatEntry {
            value,
            size,
            recency: Recency::new(now),
        };
        let old = self.statistics.insert(key, entry);
        let old_size = old.as_ref().map_or(0, |old| old.size);
        self.current_memory
            .fetch_add(size as i64 - old_size as i64, Ordering::Relaxed);
        if let Some(old) = &old {
            self.release_fingerprint(&old.value.schema_fingerprint);
        }

        let max_bytes = config::get_config()
            .limit
            .datafusion_file_stat_cache_max_size;
        if self.current_memory.load(Ordering::Relaxed) > max_bytes as i64 {
            self.evict(max_bytes);
        }
        old.map(|old| old.value)
    }

    /// Drops the least recently read entries, 5% of them per round, until under `max_bytes`.
    fn evict(&self, max_bytes: usize) {
        let start = Instant::now();
        let _evicting = self.evicting.lock();
        if self.current_memory.load(Ordering::Relaxed) > max_bytes as i64 {
            log::warn!(
                "FileStatisticsCache is full ({} bytes > {} bytes), evicting least recently read entries",
                self.current_memory.load(Ordering::Relaxed),
                max_bytes,
            );
            let mut coldest = self
                .statistics
                .iter()
                .map(|entry| (entry.recency.rank(), entry.key().clone()))
                .collect::<Vec<_>>();
            coldest.sort_unstable();
            let batch = (coldest.len() / 20).max(1);
            for (i, (rank, key)) in coldest.into_iter().enumerate() {
                if i % batch == 0 && self.current_memory.load(Ordering::Relaxed) <= max_bytes as i64
                {
                    break;
                }
                self.remove_unless_read(&key, rank);
            }
        }
        metrics::QUERY_PARQUET_METADATA_CACHE_GC_COUNT
            .with_label_values::<&str>(&[])
            .inc();
        metrics::QUERY_PARQUET_METADATA_CACHE_GC_TIME
            .with_label_values::<&str>(&[])
            .observe(start.elapsed().as_millis() as f64);
    }

    // An entry read or replaced after the eviction snapshot has a new rank and stays.
    fn remove_unless_read(&self, key: &str, rank: (u32, u64)) {
        let Some((key, entry)) = self
            .statistics
            .remove_if(key, |_, entry| entry.recency.rank() == rank)
        else {
            return;
        };
        self.current_memory
            .fetch_sub(entry.size as i64, Ordering::Relaxed);
        self.release_fingerprint(&entry.value.schema_fingerprint);
        self.evicted.record(&key);
    }

    // DataFusion builds a fingerprint per table and O2 a table per query, so equal copies pile up.
    fn intern_fingerprint(&self, fingerprint: &Arc<SchemaFingerprint>) -> Arc<SchemaFingerprint> {
        match self.fingerprints.entry(fingerprint.clone()) {
            Entry::Occupied(mut shared) => {
                *shared.get_mut() += 1;
                shared.key().clone()
            }
            Entry::Vacant(new) => {
                self.current_memory
                    .fetch_add(fingerprint_size(fingerprint) as i64, Ordering::Relaxed);
                new.insert(1);
                fingerprint.clone()
            }
        }
    }

    fn release_fingerprint(&self, fingerprint: &Arc<SchemaFingerprint>) {
        if let Entry::Occupied(mut shared) = self.fingerprints.entry(fingerprint.clone()) {
            *shared.get_mut() -= 1;
            if *shared.get() == 0 {
                shared.remove();
                self.current_memory
                    .fetch_sub(fingerprint_size(fingerprint) as i64, Ordering::Relaxed);
            }
        }
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
        self.lookup(&self.format_key(&k.path), now_secs())
    }

    /// Save collected file statistics
    fn put(&self, k: &TableScopedPath, value: CachedFileMetadata) -> Option<CachedFileMetadata> {
        self.insert(self.format_key(&k.path), value, now_secs())
    }

    fn remove(&self, k: &TableScopedPath) -> Option<CachedFileMetadata> {
        let k = self.format_key(&k.path);
        self.statistics.remove(&k).map(|(_, entry)| {
            self.current_memory
                .fetch_sub(entry.size as i64, Ordering::Relaxed);
            self.release_fingerprint(&entry.value.schema_fingerprint);
            entry.value
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
        self.fingerprints.clear();
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
        None
    }

    fn update_cache_ttl(&self, _ttl: Option<std::time::Duration>) {}

    fn list_entries(&self) -> HashMap<TableScopedPath, CacheEntryInfo<CachedFileMetadata>> {
        self.statistics
            .iter()
            .map(|entry| {
                let path = TableScopedPath {
                    table: None,
                    path: Path::from(entry.key().as_str()),
                };
                (
                    path,
                    CacheEntryInfo {
                        value: entry.value.clone(),
                        size_bytes: entry.size,
                        hits: 0,
                        expires: None,
                    },
                )
            })
            .collect()
    }

    fn drop_table_entries(&self, _table_ref: &TableReference) -> datafusion::error::Result<()> {
        Ok(())
    }
}

struct StatEntry {
    value: CachedFileMetadata,
    size: usize,
    recency: Recency,
}

fn fingerprint_size(fingerprint: &Arc<SchemaFingerprint>) -> usize {
    std::mem::size_of::<(Arc<SchemaFingerprint>, usize)>()
        + fingerprint.heap_size(&mut DFHeapSizeCtx::default())
}

/// The heap that `CacheValue::size` counts, with every block rounded to its size class.
fn value_heap_size(value: &CachedFileMetadata) -> usize {
    let meta = &value.meta;
    let tags: usize = [meta.e_tag.as_ref(), meta.version.as_ref()]
        .into_iter()
        .flatten()
        .map(|tag| alloc_size(tag.capacity()))
        .sum();
    let columns = &value.statistics.column_statistics;
    alloc_size(meta.location.as_ref().len())
        + tags
        + alloc_size(2 * std::mem::size_of::<usize>() + std::mem::size_of::<Statistics>())
        + alloc_size(columns.capacity() * std::mem::size_of::<ColumnStatistics>())
        + columns.iter().map(column_heap_size).sum::<usize>()
}

fn column_heap_size(column: &ColumnStatistics) -> usize {
    let mut ctx = DFHeapSizeCtx::default();
    [&column.min_value, &column.max_value, &column.sum_value]
        .into_iter()
        .filter_map(|value| value.get_value())
        .map(|value| alloc_size(value.heap_size(&mut ctx)))
        .sum()
}

/// Block size mimalloc hands out for a `size`-byte request: 8-byte steps up to 64 bytes,
/// then 4 classes per power of two (jemalloc uses the same classes above 64 bytes).
fn alloc_size(size: usize) -> usize {
    let step = if size <= 64 {
        8
    } else {
        size.next_power_of_two() / 8
    };
    size.div_ceil(step) * step
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
    fn test_fingerprint_size_counts_columns() {
        use datafusion::execution::cache::SchemaFingerprint;

        let names = ["a", "bb", "ccc"];
        let schema = Schema::new(
            names
                .iter()
                .map(|name| Field::new(*name, DataType::Utf8, true))
                .collect::<Vec<_>>(),
        );
        let with_columns = fingerprint_size(&Arc::new(SchemaFingerprint::from_schema(&schema)));
        let without_columns =
            fingerprint_size(&Arc::new(SchemaFingerprint::from_schema(&Schema::empty())));
        let columns_heap = names.len() * std::mem::size_of::<(String, DataType, bool)>()
            + names.iter().map(|name| name.len()).sum::<usize>();
        assert_eq!(with_columns - without_columns, columns_heap);
    }

    #[test]
    fn test_equal_fingerprints_are_shared_and_charged_once() {
        use datafusion::execution::cache::SchemaFingerprint;

        let schema = Schema::new(vec![Field::new("value", DataType::Utf8, true)]);
        let stats = Arc::new(Statistics::new_unknown(&schema));
        let cache = FileStatisticsCache::new();
        let keys = [
            "q1/schema=a/$$/files/1.parquet",
            "q2/schema=a/$$/files/2.parquet",
        ]
        .map(|location| key(&Path::from(location)));
        for k in keys.iter().chain([&keys[0]]) {
            // A fresh fingerprint per put, as each WAL query builds its own table.
            let fingerprint = Arc::new(SchemaFingerprint::from_schema(&schema));
            let meta = object_meta(k.path.as_ref(), 64);
            cache.put(
                k,
                CachedFileMetadata::new(meta, fingerprint, stats.clone(), None),
            );
        }

        let first = cache.get(&keys[0]).unwrap().schema_fingerprint;
        let second = cache.get(&keys[1]).unwrap().schema_fingerprint;
        assert!(Arc::ptr_eq(&first, &second));
        let entries: usize = cache.list_entries().values().map(|e| e.size_bytes).sum();
        assert_eq!(cache.memory_size(), entries + fingerprint_size(&first));

        for k in &keys {
            cache.remove(k);
        }
        assert_eq!(cache.memory_size(), 0);
        assert!(cache.fingerprints.is_empty());
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
        // 87-byte strings take 96-byte blocks, the 5-byte one an 8-byte block, the empty one none.
        assert_eq!(counted, 96 + 96 + 8);
    }

    #[test]
    fn test_alloc_size_follows_mimalloc_size_classes() {
        let cases = [
            (0, 0),
            (1, 8),
            (8, 8),
            (9, 16),
            (64, 64),
            (65, 80),
            (87, 96),
            (128, 128),
            (129, 160),
            (1000, 1024),
            (1025, 1280),
        ];
        for (requested, allocated) in cases {
            assert_eq!(
                alloc_size(requested),
                allocated,
                "request of {requested} bytes"
            );
        }
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
        assert!(cache.fingerprints.is_empty());
    }

    #[test]
    fn test_evict_keeps_recently_read_entry_over_newer_unread_ones() {
        let cache = FileStatisticsCache::new();
        let stats = unknown_stats(vec![Field::new("col", DataType::Int64, false)]);
        let value = |name: &str| {
            CachedFileMetadata::new(
                object_meta(name, 64),
                Arc::new(
                    datafusion::execution::cache::SchemaFingerprint::from_schema(&Schema::empty()),
                ),
                stats.clone(),
                None,
            )
        };
        cache.insert("hot".to_string(), value("hot"), 1);
        for i in 0..10 {
            cache.insert(format!("cold_{i}"), value("cold"), 2 * i + 2);
            assert!(cache.lookup("hot", 2 * i + 3).is_some());
        }
        let one_entry = cache.memory_size() / cache.len();
        cache.evict(one_entry * 5);

        assert!(cache.lookup("hot", 30).is_some(), "hot entry was evicted");
        for i in 0..5 {
            assert!(cache.lookup(&format!("cold_{i}"), 30).is_none());
            assert!(
                !cache.evicted.take(&format!("cold_{i}")),
                "re-read counted twice"
            );
        }
        assert!(cache.lookup("cold_9", 30).is_some());
    }

    #[test]
    fn test_reread_miss_counts_only_evicted_keys() {
        let cache = FileStatisticsCache::new();
        put(&cache, object_meta("a", 64), unknown_stats(vec![]));
        cache.evict(0);
        assert!(cache.lookup("never_cached", 1).is_none());
        assert!(!cache.evicted.take("never_cached"));
        assert!(cache.evicted.take("a"));
    }

    #[test]
    fn test_cache_remove_nonexistent_returns_none() {
        let cache = FileStatisticsCache::new();
        assert!(cache.remove(&key(&Path::from("does_not_exist"))).is_none());
    }
}
