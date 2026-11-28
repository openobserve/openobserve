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

use std::sync::{Arc, LazyLock};

use config::metrics::QUERY_AGGREGATION_CACHE_ITEMS;
use datafusion::{common::Result, error::DataFusionError};
use hashlink::lru_cache::LruCache;

use super::partition::partition_optimizer::StreamingAggsPartitionStrategy;

pub static GLOBAL_CACHE: LazyLock<Arc<StreamingAggsCache>> =
    LazyLock::new(|| Arc::new(StreamingAggsCache::default()));

// init streaming cache for the id
pub fn init_cache(
    id: &str,
    start_time: i64,
    end_time: i64,
    cache_file_path: &str,
    cache_interval_mins: i64,
) {
    if GLOBAL_CACHE.id_cache.exists(id) {
        log::warn!(
            "[StreamingAggs streaming_id: {id}] init_cache: streaming_id already exists, remove the old cache"
        );
        GLOBAL_CACHE.remove(id);
    }
    GLOBAL_CACHE.id_cache.insert(
        id.to_string(),
        start_time,
        end_time,
        cache_file_path.to_string(),
        cache_interval_mins,
    );
    log::debug!(
        "[StreamingAggs streaming_id: {id}] init_cache: start_time={start_time}, end_time={end_time}, cache_file_path={cache_file_path}, cache_interval_mins={cache_interval_mins}",
    );
}

// remove streaming cache for the id
pub fn remove_cache(id: &str) {
    GLOBAL_CACHE.remove(id);
    log::debug!("[StreamingAggs streaming_id: {id}] remove_cache");
}

// set partition strategy for the id
pub fn set_partition_strategy(id: &str, strategy: StreamingAggsPartitionStrategy) {
    GLOBAL_CACHE.id_cache.set_partition_strategy(id, strategy);
    log::debug!("[StreamingAggs streaming_id: {id}] set_partition_strategy");
}

// get partition strategy for the id
pub fn get_partition_strategy(id: &str) -> Option<StreamingAggsPartitionStrategy> {
    GLOBAL_CACHE.id_cache.get_partition_strategy(id)
}

/// The redaction digest the id's cache key was built with; its searches must match it.
pub fn set_redaction_digest(id: &str, digest: Option<String>) {
    GLOBAL_CACHE.id_cache.set_redaction_digest(id, digest);
}

/// `None` when the id is unknown; `Some(None)` when its cache key holds no protected stream.
pub fn get_redaction_digest(id: &str) -> Option<Option<String>> {
    GLOBAL_CACHE
        .id_cache
        .get(id)
        .map(|item| item.redaction_digest)
}

/// The user whose partition request registered the id; only that user may search with it.
pub fn set_owner(id: &str, owner: Option<String>) {
    GLOBAL_CACHE.id_cache.set_owner(id, owner);
}

/// `None` when the id is unknown; `Some(None)` when it was registered without a user.
pub fn get_owner(id: &str) -> Option<Option<String>> {
    GLOBAL_CACHE.id_cache.get(id).map(|item| item.owner)
}

/// Streaming aggs cache state keyed by streaming id, bounded by bytes in LRU order.
pub struct StreamingAggsCache {
    pub id_cache: StreamingIdCache,
}

impl StreamingAggsCache {
    pub fn new(max_size: usize) -> Self {
        Self {
            id_cache: StreamingIdCache::new(max_size),
        }
    }

    pub fn get(&self, k: &str) -> Option<Vec<Arc<String>>> {
        self.id_cache.files(k)
    }

    pub fn insert(&self, k: String, v: String) {
        if !self.id_cache.add_file(&k, &v) {
            log::warn!(
                "[StreamingAggs streaming_id: {k}] streaming_id is not cached, skip cache file: {v}"
            );
            remove_tmp_files(std::iter::once(v.as_str()));
        }
    }

    pub fn remove(&self, k: &str) {
        if let Some(item) = self.id_cache.remove(k) {
            remove_tmp_files(item.files.iter().map(|f| f.as_str()));
        }
    }

    pub fn get_cache_interval(&self, k: &str) -> i64 {
        self.id_cache
            .get(k)
            .map(|v| v.get_cache_interval())
            .unwrap_or_default()
    }
}

impl Default for StreamingAggsCache {
    fn default() -> Self {
        Self::new(
            config::get_config()
                .limit
                .datafusion_streaming_aggs_cache_max_size,
        )
    }
}

pub struct StreamingIdCache {
    data: parking_lot::RwLock<IdLru>,
    max_size: usize,
}

impl StreamingIdCache {
    pub fn new(max_size: usize) -> Self {
        Self {
            data: parking_lot::RwLock::new(IdLru {
                items: LruCache::new_unbounded(),
                size: 0,
            }),
            max_size,
        }
    }

    pub fn insert(
        &self,
        k: String,
        start_time: i64,
        end_time: i64,
        cache_file_path: String,
        cache_interval_mins: i64,
    ) {
        let mut w = self.data.write();
        if w.items.get(&k).is_some() {
            return; // trigger the key as last recently used
        }
        let item = StreamingIdItem::new(start_time, end_time, cache_file_path, cache_interval_mins);
        let size = entry_size(&k, &item);
        if size > self.max_size {
            log::warn!(
                "[StreamingAggs streaming_id: {k}] entry of {size} bytes exceeds the cache max size {}, skip",
                self.max_size
            );
            return;
        }
        w.items.insert(k, item);
        w.size += size;
        QUERY_AGGREGATION_CACHE_ITEMS
            .with_label_values::<&str>(&[])
            .inc();
        let evicted = w.evict_to(self.max_size);
        drop(w);
        remove_evicted(evicted);
    }

    pub fn exists(&self, k: &str) -> bool {
        self.data.read().items.contains_key(k)
    }

    pub fn check_time(&self, k: &str, start_time: i64, end_time: i64) -> bool {
        match self.data.write().items.get_mut(k) {
            Some(v) => v.check_time(start_time, end_time),
            None => false,
        }
    }

    pub fn remove(&self, k: &str) -> Option<StreamingIdItem> {
        let mut w = self.data.write();
        let (key, item) = w.items.remove_entry(k)?;
        w.size -= entry_size(&key, &item);
        QUERY_AGGREGATION_CACHE_ITEMS
            .with_label_values::<&str>(&[])
            .dec();
        Some(item)
    }

    pub fn get(&self, k: &str) -> Option<StreamingIdItem> {
        self.data.read().items.peek(k).cloned()
    }

    pub fn get_cache_file_path(&self, k: &str) -> Option<String> {
        self.data
            .read()
            .items
            .peek(k)
            .map(|v| v.get_cache_file_path())
    }

    pub fn set_partition_strategy(&self, k: &str, strategy: StreamingAggsPartitionStrategy) {
        self.update(k, |item| item.set_partition_strategy(strategy));
    }

    pub fn get_partition_strategy(&self, k: &str) -> Option<StreamingAggsPartitionStrategy> {
        self.data
            .read()
            .items
            .peek(k)
            .and_then(|v| v.get_partition_strategy())
    }

    pub fn set_redaction_digest(&self, k: &str, digest: Option<String>) {
        self.update(k, |item| item.redaction_digest = digest);
    }

    pub fn set_owner(&self, k: &str, owner: Option<String>) {
        self.update(k, |item| item.owner = owner);
    }

    /// Total bytes held by the cached items.
    pub fn memory_size(&self) -> usize {
        self.data.read().size
    }

    fn files(&self, k: &str) -> Option<Vec<Arc<String>>> {
        self.data.read().items.peek(k).map(|v| v.files.clone())
    }

    /// Returns false when the id is not cached, so the caller owns the file.
    fn add_file(&self, k: &str, file: &str) -> bool {
        self.update(k, |item| {
            if item.files.iter().any(|existing| existing.as_str() == file) {
                log::debug!(
                    "[StreamingAggs streaming_id: {k}] Skipped duplicate cache file: {file}"
                );
            } else {
                item.files.push(Arc::new(file.to_string()));
                log::debug!("[StreamingAggs streaming_id: {k}] Added cache file: {file}");
            }
        })
    }

    /// Applies `f` to a cached item, then evicts until the cache fits again.
    fn update(&self, k: &str, f: impl FnOnce(&mut StreamingIdItem)) -> bool {
        let mut w = self.data.write();
        let Some(item) = w.items.get_mut(k) else {
            return false;
        };
        let before = entry_size(k, item);
        f(item);
        let after = entry_size(k, item);
        w.size = w.size - before + after;
        let evicted = w.evict_to(self.max_size);
        drop(w);
        remove_evicted(evicted);
        true
    }
}

struct IdLru {
    items: LruCache<String, StreamingIdItem>,
    size: usize,
}

impl IdLru {
    fn evict_to(&mut self, max_size: usize) -> Vec<(String, StreamingIdItem)> {
        let mut evicted = Vec::new();
        while self.size > max_size {
            let Some((key, item)) = self.items.remove_lru() else {
                break;
            };
            self.size -= entry_size(&key, &item);
            QUERY_AGGREGATION_CACHE_ITEMS
                .with_label_values::<&str>(&[])
                .dec();
            evicted.push((key, item));
        }
        evicted
    }
}

#[derive(Clone)]
pub struct StreamingIdItem {
    pub start_time: i64,
    pub end_time: i64,
    start_ok: bool,
    end_ok: bool,
    cache_file_path: String,
    cache_interval: i64, // Cache interval in minutes
    partition_strategy: Option<StreamingAggsPartitionStrategy>,
    redaction_digest: Option<String>,
    owner: Option<String>,
    files: Vec<Arc<String>>,
}

impl StreamingIdItem {
    pub fn new(
        start_time: i64,
        end_time: i64,
        cache_file_path: String,
        cache_interval: i64,
    ) -> Self {
        Self {
            start_time,
            end_time,
            start_ok: false,
            end_ok: false,
            cache_file_path,
            cache_interval,
            partition_strategy: None,
            redaction_digest: None,
            owner: None,
            files: Vec::new(),
        }
    }

    pub fn set_partition_strategy(&mut self, strategy: StreamingAggsPartitionStrategy) {
        self.partition_strategy = Some(strategy);
    }

    pub fn get_partition_strategy(&self) -> Option<StreamingAggsPartitionStrategy> {
        self.partition_strategy.clone()
    }

    pub fn check_time(&mut self, start_time: i64, end_time: i64) -> bool {
        if self.start_ok && self.end_ok {
            return true;
        }
        if start_time == self.start_time {
            self.start_ok = true;
        }
        if end_time == self.end_time {
            self.end_ok = true;
        }
        self.start_ok && self.end_ok
    }

    pub fn get_cache_file_path(&self) -> String {
        self.cache_file_path.clone()
    }

    pub fn get_cache_interval(&self) -> i64 {
        self.cache_interval
    }

    /// Bytes held by the item, inline fields plus heap.
    pub fn memory_size(&self) -> usize {
        let file_size = size_of::<String>() + 2 * size_of::<usize>(); // Arc header + String
        size_of::<Self>()
            + self.cache_file_path.capacity()
            + self.redaction_digest.as_ref().map_or(0, String::capacity)
            + self.owner.as_ref().map_or(0, String::capacity)
            + self
                .partition_strategy
                .as_ref()
                .map_or(0, StreamingAggsPartitionStrategy::heap_size)
            + self.files.capacity() * size_of::<Arc<String>>()
            + self
                .files
                .iter()
                .map(|f| file_size + f.capacity())
                .sum::<usize>()
    }
}

pub(crate) fn get_cache_file_path_from_streaming_id(streaming_id: &str) -> Result<String> {
    let cache_file_path = GLOBAL_CACHE.id_cache.get_cache_file_path(streaming_id);
    if let Some(cache_file_path) = cache_file_path {
        Ok(cache_file_path)
    } else {
        log::error!(
            "[streaming_id {streaming_id}] get_cache_file_path_from_streaming_id: No cached file path found"
        );
        Err(DataFusionError::External(
            format!("[streaming_id {streaming_id}] get_cache_file_path_from_streaming_id: No cached file path found").into(),
        ))
    }
}

// Key bytes plus the LRU node's links and hash slot.
fn entry_size(key: &str, item: &StreamingIdItem) -> usize {
    size_of::<String>() + key.len() + 4 * size_of::<usize>() + item.memory_size()
}

fn remove_evicted(evicted: Vec<(String, StreamingIdItem)>) {
    for (key, item) in evicted {
        log::info!(
            "[StreamingAggs streaming_id: {key}] evicted to keep the cache under its max size"
        );
        remove_tmp_files(item.files.iter().map(|f| f.as_str()));
    }
}

// Query-local `_tmp` files are useless once their streaming id is gone.
fn remove_tmp_files<'a>(files: impl IntoIterator<Item = &'a str>) {
    for file in files {
        if !file.contains("_tmp") {
            continue;
        }
        let Some(file_path) = infra::cache::file_data::disk::get_file_path(file) else {
            continue;
        };
        let Ok(metadata) = std::fs::metadata(&file_path) else {
            continue;
        };
        if metadata.is_file()
            && let Err(e) = std::fs::remove_file(&file_path)
        {
            log::error!("Error removing temporary file: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use arrow::datatypes::{DataType, Field, Schema};
    use datafusion::{
        execution::context::TaskContext,
        physical_expr::expressions::col,
        physical_plan::{
            ChildrenPropertiesMode, ExecutionPlan, Partitioning, ReplaceChildrenOptions,
            StatisticsArgs, StatisticsContext,
            aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
            empty::EmptyExec,
        },
    };

    use super::*;
    use crate::datafusion::physical_plan::streaming_aggs_exec::{
        exec::StreamingAggsExec, partition::partition_optimizer::UncachedPartition,
    };

    const TEST_MAX_SIZE: usize = 1024 * 1024;

    fn new_item_size(key: &str) -> usize {
        entry_size(key, &StreamingIdItem::new(1, 2, "path".to_string(), 60))
    }

    fn init(cache: &StreamingAggsCache, key: &str) {
        cache
            .id_cache
            .insert(key.to_string(), 1, 2, "path".to_string(), 60);
    }

    fn tracked_size(cache: &StreamingIdCache) -> usize {
        let r = cache.data.read();
        r.items.iter().map(|(k, v)| entry_size(k, v)).sum()
    }

    // DataFusion rejects an AggregateExec with neither grouping nor aggregates.
    fn group_by_col1(schema: &Schema) -> PhysicalGroupBy {
        let col1 = col("col1", schema).unwrap();
        PhysicalGroupBy::new_single(vec![(col1, "col1".to_string())])
    }

    #[test]
    fn test_streaming_id_item_check_time() {
        let mut item = StreamingIdItem::new(1000, 2000, "test_path".to_string(), 60);

        // Initially both start_ok and end_ok are false
        // When start_time matches, start_ok becomes true, but end_time doesn't match
        assert!(!item.check_time(1000, 1500));

        // Now start_ok is true from previous call, but end_time still doesn't match
        assert!(!item.check_time(1500, 1900));

        // Now check with correct end_time - this should set end_ok to true
        // Since start_ok was already true from first call, this should return true
        assert!(item.check_time(1500, 2000)); // end matches, and start_ok already set

        // Now both start_ok and end_ok should be true from previous calls
        // So any subsequent call should return true
        assert!(item.check_time(999, 999));

        // Test fresh item with both matching times
        let mut item2 = StreamingIdItem::new(1000, 2000, "test_path".to_string(), 60);
        assert!(item2.check_time(1000, 2000)); // both match at once
    }

    #[test]
    fn test_streaming_id_item_get_cache_interval() {
        // Test with stored interval value
        let item = StreamingIdItem::new(1000, 2000, "test_path".to_string(), 60);
        let interval = item.get_cache_interval();
        assert_eq!(interval, 60); // Should return the stored interval

        // Test the get_cache_file_path method as well
        assert_eq!(item.get_cache_file_path(), "test_path");
    }

    #[test]
    fn test_streaming_id_cache_check_time() {
        let cache = StreamingIdCache::new(TEST_MAX_SIZE);
        cache.insert(
            "test_key".to_string(),
            1000,
            2000,
            "test_path".to_string(),
            60,
        );

        // Should return false initially for partial matches
        assert!(!cache.check_time("test_key", 1000, 1500)); // start matches, sets start_ok
        // After first call, start_ok is now true, but end doesn't match
        assert!(cache.check_time("test_key", 1500, 2000)); // end matches, both flags now true
        // After this call, both start_ok and end_ok should be true, so returns true

        // Should return true for subsequent calls since both flags are set
        assert!(cache.check_time("test_key", 999, 999));

        // Test fresh key with both matching at once
        cache.insert(
            "test_key2".to_string(),
            3000,
            4000,
            "test_path2".to_string(),
            60,
        );
        assert!(cache.check_time("test_key2", 3000, 4000));

        // Should return false for non-existent key
        assert!(!cache.check_time("nonexistent", 1000, 2000));
    }

    #[test]
    fn test_streaming_id_cache_get_and_get_cache_file_path() {
        let cache = StreamingIdCache::new(TEST_MAX_SIZE);
        cache.insert(
            "test_key".to_string(),
            1000,
            2000,
            "test_path".to_string(),
            60,
        );

        // Test get
        let item = cache.get("test_key");
        assert!(item.is_some());
        let item = item.unwrap();
        assert_eq!(item.start_time, 1000);
        assert_eq!(item.end_time, 2000);
        assert_eq!(item.get_cache_file_path(), "test_path");

        // Test get_cache_file_path directly
        let path = cache.get_cache_file_path("test_key");
        assert!(path.is_some());
        assert_eq!(path.unwrap(), "test_path");

        // Test non-existent key
        assert!(cache.get("nonexistent").is_none());
        assert!(cache.get_cache_file_path("nonexistent").is_none());
    }

    #[test]
    fn test_init_remove_cache() {
        let test_id = "test_streaming_id";
        let start_time = 1000i64;
        let end_time = 2000i64;
        let cache_file_path = "test_path";

        // Test init_cache
        init_cache(test_id, start_time, end_time, cache_file_path, 60);
        assert!(GLOBAL_CACHE.id_cache.exists(test_id));

        // Test remove_cache
        remove_cache(test_id);
        assert!(!GLOBAL_CACHE.id_cache.exists(test_id));
    }

    #[test]
    fn test_streaming_aggs_exec_execution_plan_trait_simple_methods() {
        use std::sync::Arc;

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                group_by_col1(&schema),
                vec![],
                vec![],
                input.clone(),
                schema.clone(),
            )
            .unwrap(),
        );

        let exec = StreamingAggsExec::new(
            "test_exec".to_string(),
            1000,
            2000,
            vec![],
            input.clone(),
            4,
            false,
            aggregate_plan.clone(),
            false,
        );

        // Test ExecutionPlan trait methods
        assert_eq!(exec.name(), "StreamingAggsExec");
        let exec_plan: &dyn ExecutionPlan = &exec;
        assert!(exec_plan.downcast_ref::<StreamingAggsExec>().is_some());
        assert_eq!(exec.children().len(), 1);
        assert_eq!(exec.benefits_from_input_partitioning(), vec![false]);
        // Test statistics method (returns Statistics with unknown values)
        let _stats = StatisticsContext::new()
            .compute(&exec, &StatisticsArgs::new().with_partition(Some(0)))
            .unwrap();
        // Just verify statistics() method doesn't panic - we can't easily test Precision enum
        // values
    }

    #[test]
    fn test_streaming_aggs_exec_with_new_children() {
        use std::sync::Arc;

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                group_by_col1(&schema),
                vec![],
                vec![],
                input.clone(),
                schema.clone(),
            )
            .unwrap(),
        );

        let exec = Arc::new(StreamingAggsExec::new(
            "test_exec".to_string(),
            1000,
            2000,
            vec![],
            input.clone(),
            4,
            false,
            aggregate_plan.clone(),
            false,
        ));

        // Test with_new_children
        let new_input = Arc::new(EmptyExec::new(schema.clone()));
        let new_exec = exec
            .replace_children(
                vec![new_input],
                ReplaceChildrenOptions::new(ChildrenPropertiesMode::Recompute),
            )
            .unwrap();

        // Verify it's a StreamingAggsExec
        assert!(new_exec.downcast_ref::<StreamingAggsExec>().is_some());
        assert_eq!(new_exec.name(), "StreamingAggsExec");
    }

    #[test]
    fn test_display_as_trait() {
        use std::sync::Arc;

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                group_by_col1(&schema),
                vec![],
                vec![],
                input.clone(),
                schema.clone(),
            )
            .unwrap(),
        );

        // Test complete cache hit
        let exec_cache_hit = StreamingAggsExec::new(
            "test_display".to_string(),
            1000,
            2000,
            vec![Arc::new("cached_file.arrow".to_string())],
            input.clone(),
            4,
            true, // complete cache hit
            aggregate_plan.clone(),
            false,
        );

        // Test DisplayAs::fmt_as with Debug format (since Display is not implemented)
        let debug_display = format!("{exec_cache_hit:?}");
        assert!(debug_display.contains("StreamingAggsExec"));
        assert!(debug_display.contains("test_display"));

        // Test cache miss case
        let exec_cache_miss = StreamingAggsExec::new(
            "test_display_miss".to_string(),
            1000,
            2000,
            vec![],
            input.clone(),
            4,
            false, // cache miss
            aggregate_plan.clone(),
            false,
        );

        let miss_debug = format!("{exec_cache_miss:?}");
        assert!(miss_debug.contains("test_display_miss"));
    }

    #[test]
    fn test_output_partitioning_helper() {
        // Test the static helper method
        let partitioning = StreamingAggsExec::output_partitioning_helper(5);

        // Should return UnknownPartitioning with correct count
        if let Partitioning::UnknownPartitioning(count) = partitioning {
            assert_eq!(count, 5);
        } else {
            panic!("Expected UnknownPartitioning");
        }
    }

    #[test]
    fn test_compute_properties() {
        use std::sync::Arc;

        let schema = Arc::new(Schema::new(vec![Field::new(
            "test_col",
            DataType::Utf8,
            false,
        )]));

        let input: Arc<dyn ExecutionPlan> = Arc::new(EmptyExec::new(schema));
        let properties = StreamingAggsExec::compute_properties(&input, 3);

        // Verify the properties are set correctly - we can't access schema() directly but we can
        // verify partitioning Check partitioning
        if let Partitioning::UnknownPartitioning(count) = properties.output_partitioning() {
            assert_eq!(*count, 3);
        } else {
            panic!("Expected UnknownPartitioning");
        }
    }

    #[test]
    fn test_streaming_aggs_exec_constructor_variations() {
        use std::sync::Arc;

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                group_by_col1(&schema),
                vec![],
                vec![],
                input.clone(),
                schema.clone(),
            )
            .unwrap(),
        );

        // Test different constructor variations

        // Complete cache hit with multiple files
        let cached_files = vec![
            Arc::new("file1.arrow".to_string()),
            Arc::new("file2.arrow".to_string()),
            Arc::new("file3.arrow".to_string()),
        ];
        let exec_multi_cache = StreamingAggsExec::new(
            "multi_cache".to_string(),
            1000,
            3000,
            cached_files.clone(),
            input.clone(),
            6,
            true, // complete cache hit
            aggregate_plan.clone(),
            false,
        );

        // Verify properties
        assert_eq!(exec_multi_cache.id(), "multi_cache");
        assert_eq!(exec_multi_cache.start_time(), 1000);
        assert_eq!(exec_multi_cache.end_time(), 3000);
        assert_eq!(exec_multi_cache.target_partitions(), 6);
        assert!(exec_multi_cache.is_complete_cache_hit());
        assert_eq!(exec_multi_cache.cached_files().len(), 3);

        // Partial cache with some cached files
        let exec_partial = StreamingAggsExec::new(
            "partial_cache".to_string(),
            2000,
            4000,
            vec![Arc::new("partial_file.arrow".to_string())],
            input.clone(),
            4,
            false, // partial cache
            aggregate_plan.clone(),
            false,
        );

        assert!(!exec_partial.is_complete_cache_hit());
        assert_eq!(exec_partial.cached_files().len(), 1);
    }

    #[tokio::test]
    async fn test_execute_method_error_cases() {
        use std::sync::Arc;

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                group_by_col1(&schema),
                vec![],
                vec![],
                input.clone(),
                schema.clone(),
            )
            .unwrap(),
        );

        let exec = StreamingAggsExec::new(
            "test_execute".to_string(),
            1000,
            2000,
            vec![],
            input.clone(),
            4,
            false,
            aggregate_plan.clone(),
            false,
        );

        // Test execute with invalid partition index
        let task_ctx = Arc::new(TaskContext::default());
        let result = exec.execute(999, task_ctx); // Invalid partition index
        assert!(result.is_err()); // Should error for invalid partition
    }

    #[test]
    fn test_display_as_fmt_as_method() {
        use std::sync::Arc;

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                group_by_col1(&schema),
                vec![],
                vec![],
                input.clone(),
                schema.clone(),
            )
            .unwrap(),
        );

        let exec = StreamingAggsExec::new(
            "test_fmt".to_string(),
            1000,
            2000,
            vec![Arc::new("cached.arrow".to_string())],
            input.clone(),
            4,
            true, // complete cache hit
            aggregate_plan.clone(),
            false,
        );

        // Test DisplayAs - just verify it implements the trait
        // We can't easily test fmt_as without proper formatter setup
        let debug_output = format!("{exec:?}");
        assert!(debug_output.contains("StreamingAggsExec"));
        assert!(debug_output.contains("test_fmt"));
    }

    #[test]
    fn test_get_cache_file_path_from_streaming_id() {
        let streaming_id = "test_get_cache_file_path_unique_id";

        // First, add the streaming_id to the global cache so the function can find it
        GLOBAL_CACHE.id_cache.insert(
            streaming_id.to_string(),
            1000,
            2000,
            "test_cache_path.arrow".to_string(),
            60,
        );

        let result = get_cache_file_path_from_streaming_id(streaming_id);

        // Now it should succeed
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(!path.is_empty());

        // Clean up
        GLOBAL_CACHE.remove(streaming_id);
    }

    #[test]
    fn test_streaming_id_cache_edge_cases() {
        let cache = StreamingIdCache::new(1); // Very small capacity

        // Test rapid insertions to trigger frequent GC
        for i in 0..10 {
            let key = format!("rapid_{i}");
            cache.insert(
                key.clone(),
                i as i64,
                (i + 1) as i64,
                format!("path_{i}"),
                60,
            );
        }

        // Every item is larger than the 1 byte cap, so none is stored.
        assert!(cache.data.read().items.is_empty());
        assert_eq!(cache.memory_size(), 0);

        // Test get_cache_file_path with non-existent key
        let result = cache.get_cache_file_path("nonexistent");
        assert!(result.is_none());

        // Test check_time with non-existent key
        let result = cache.check_time("nonexistent", 1000, 2000);
        assert!(!result);
    }

    #[test]
    fn test_streaming_id_item_edge_cases() {
        let item = StreamingIdItem::new(-1, -1, "negative_time".to_string(), 60);

        // Test with negative times
        assert_eq!(item.start_time, -1);
        assert_eq!(item.end_time, -1);

        // Test check_time with negative values
        let mut item = StreamingIdItem::new(-1, -1, "negative_time".to_string(), 60);
        assert!(!item.check_time(-1, 0)); // Should not match immediately

        // Test with very large timestamps
        let large_item = StreamingIdItem::new(i64::MAX, i64::MAX, "large_time".to_string(), 60);
        assert_eq!(large_item.start_time, i64::MAX);
        assert_eq!(large_item.end_time, i64::MAX);
    }

    #[test]
    fn test_init_remove_cache_edge_cases() {
        // Test init_cache with extreme values
        init_cache("extreme_test", i64::MIN, i64::MAX, "extreme_path", 60);
        assert!(GLOBAL_CACHE.id_cache.exists("extreme_test"));

        // Test remove_cache on same key
        remove_cache("extreme_test");
        assert!(!GLOBAL_CACHE.id_cache.exists("extreme_test"));

        // Test remove_cache on non-existent key (should not panic)
        remove_cache("never_existed");

        // Test init_cache with empty strings
        init_cache("", 0, 0, "", 60);
        assert!(GLOBAL_CACHE.id_cache.exists(""));
        remove_cache("");
        assert!(!GLOBAL_CACHE.id_cache.exists(""));
    }

    #[test]
    fn test_streaming_aggs_exec_aggregate_plan() {
        use std::sync::Arc;

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                group_by_col1(&schema),
                vec![],
                vec![],
                input.clone(),
                schema.clone(),
            )
            .unwrap(),
        );

        let exec = StreamingAggsExec::new(
            "test_agg_plan".to_string(),
            1000,
            2000,
            vec![],
            input.clone(),
            4,
            false,
            aggregate_plan.clone(),
            false,
        );

        // Test aggregate_plan getter
        let returned_plan = exec.aggregate_plan();
        // Verify it's the same plan (by comparing schema field count)
        assert_eq!(
            returned_plan.schema().fields().len(),
            aggregate_plan.schema().fields().len()
        );
    }

    #[test]
    fn test_streaming_aggs_exec_with_new_children_error_cases() {
        use std::sync::Arc;

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                group_by_col1(&schema),
                vec![],
                vec![],
                input.clone(),
                schema.clone(),
            )
            .unwrap(),
        );

        let exec = Arc::new(StreamingAggsExec::new(
            "test_error".to_string(),
            1000,
            2000,
            vec![],
            input.clone(),
            4,
            false,
            aggregate_plan.clone(),
            false,
        ));

        // Test with correct number of children (should succeed)
        let new_input = Arc::new(EmptyExec::new(schema.clone()));
        let result = exec.clone().replace_children(
            vec![new_input],
            ReplaceChildrenOptions::new(ChildrenPropertiesMode::Recompute),
        );
        assert!(result.is_ok()); // Should succeed with one child

        // Note: The original code doesn't actually validate the number of children in
        // with_new_children It just uses the first child. Testing exact error behavior
        // would require understanding the internal implementation details.
    }

    #[test]
    fn test_streaming_aggs_cache_evicts_lru_by_bytes() {
        let cache = StreamingAggsCache::new(3 * new_item_size("key0"));
        for i in 0..3 {
            init(&cache, &format!("key{i}"));
        }
        assert!(cache.id_cache.exists("key0"));
        // trigger key0 as last recently used
        init(&cache, "key0");
        init(&cache, "key3");

        assert!(!cache.id_cache.exists("key1"));
        assert!(cache.id_cache.exists("key0"));
        assert!(cache.id_cache.exists("key2"));
        assert!(cache.id_cache.exists("key3"));
        assert_eq!(cache.id_cache.memory_size(), 3 * new_item_size("key0"));
    }

    #[test]
    fn test_streaming_aggs_cache_growth_evicts_older_entries() {
        let cache = StreamingAggsCache::new(4 * new_item_size("key0"));
        for i in 0..4 {
            init(&cache, &format!("key{i}"));
        }
        let partitions = (0..8).map(|i| UncachedPartition::new(i, i + 1)).collect();
        cache.id_cache.set_partition_strategy(
            "key3",
            StreamingAggsPartitionStrategy::NoCacheAvailable { partitions },
        );

        assert!(!cache.id_cache.exists("key0"));
        assert!(cache.id_cache.exists("key3"));
        assert!(cache.id_cache.memory_size() <= cache.id_cache.max_size);
        assert_eq!(cache.id_cache.memory_size(), tracked_size(&cache.id_cache));
    }

    #[test]
    fn test_streaming_aggs_cache_oversized_entry_is_evicted_at_once() {
        let cache = StreamingAggsCache::new(2 * new_item_size("key0"));
        init(&cache, "key0");
        init(&cache, "key1");
        let partitions = (0..64).map(|i| UncachedPartition::new(i, i + 1)).collect();
        cache.id_cache.set_partition_strategy(
            "key1",
            StreamingAggsPartitionStrategy::NoCacheAvailable { partitions },
        );

        assert!(!cache.id_cache.exists("key1"), "oversized entry kept");
        assert!(!cache.id_cache.exists("key0"));
        assert_eq!(cache.id_cache.memory_size(), 0);

        let tiny = StreamingIdCache::new(new_item_size("key0") - 1);
        tiny.insert("key0".to_string(), 1, 2, "path".to_string(), 60);
        assert!(!tiny.exists("key0"));
        assert_eq!(tiny.memory_size(), 0);
    }

    #[test]
    fn test_streaming_aggs_cache_remove_then_insert_keeps_byte_count() {
        let cache = StreamingAggsCache::new(TEST_MAX_SIZE);
        init(&cache, "key0");
        init(&cache, "key1");
        cache.insert("key0".to_string(), "file0.arrow".to_string());
        cache
            .id_cache
            .set_owner("key0", Some("user@example.com".to_string()));
        assert_eq!(cache.id_cache.memory_size(), tracked_size(&cache.id_cache));

        cache.remove("key0");
        assert_eq!(cache.id_cache.memory_size(), new_item_size("key1"));
        init(&cache, "key0");
        assert_eq!(cache.id_cache.memory_size(), 2 * new_item_size("key0"));
        cache.remove("key0");
        cache.remove("key1");
        assert_eq!(cache.id_cache.memory_size(), 0);
    }

    #[test]
    fn test_streaming_aggs_cache_deduplication() {
        let cache = StreamingAggsCache::new(TEST_MAX_SIZE);
        init(&cache, "streaming_id_1");
        for file in ["f1.arrow", "f2.arrow", "f1.arrow", "f3.arrow", "f2.arrow"] {
            cache.insert("streaming_id_1".to_string(), file.to_string());
        }

        let files = cache.get("streaming_id_1").unwrap();
        let file_paths: Vec<&str> = files.iter().map(|f| f.as_str()).collect();
        assert_eq!(file_paths, vec!["f1.arrow", "f2.arrow", "f3.arrow"]);
        assert_eq!(cache.id_cache.memory_size(), tracked_size(&cache.id_cache));
    }

    #[test]
    fn test_streaming_aggs_cache_skips_file_for_unknown_id() {
        let cache = StreamingAggsCache::new(TEST_MAX_SIZE);
        cache.insert("unknown".to_string(), "file1.arrow".to_string());
        assert!(cache.get("unknown").is_none());
        assert_eq!(cache.id_cache.memory_size(), 0);
    }

    #[test]
    fn test_streaming_aggs_cache_get_exists_remove() {
        let cache = StreamingAggsCache::new(TEST_MAX_SIZE);
        assert!(cache.get("test_key").is_none());
        assert!(!cache.id_cache.exists("test_key"));

        init(&cache, "test_key");
        assert!(cache.id_cache.exists("test_key"));
        assert_eq!(cache.get("test_key").unwrap().len(), 0);
        cache.insert("test_key".to_string(), "file1.arrow".to_string());
        cache.insert("test_key".to_string(), "file2.arrow".to_string());
        assert_eq!(cache.get("test_key").unwrap().len(), 2);

        cache.remove("test_key");
        assert!(!cache.id_cache.exists("test_key"));
        assert!(cache.get("test_key").is_none());
    }

    #[test]
    fn test_streaming_aggs_cache_get_cache_interval() {
        let cache = StreamingAggsCache::new(TEST_MAX_SIZE);
        assert_eq!(cache.get_cache_interval("nonexistent"), 0);
        cache.id_cache.insert(
            "test_interval".to_string(),
            1000,
            2000,
            "org/stream/1h".to_string(),
            60,
        );
        assert_eq!(cache.get_cache_interval("test_interval"), 60);
    }

    #[test]
    fn test_streaming_aggs_cache_zero_max_size_stores_nothing() {
        let cache = StreamingAggsCache::new(0);
        init(&cache, "key1");
        cache.insert("key1".to_string(), "file1.arrow".to_string());
        cache.remove("nonexistent");
        assert!(!cache.id_cache.exists("key1"));
        assert_eq!(cache.get_cache_interval("key1"), 0);
    }

    #[test]
    fn test_streaming_aggs_cache_concurrent_operations() {
        use std::thread;

        let cache = Arc::new(StreamingAggsCache::new(
            20 * new_item_size("thread_0_key_0"),
        ));
        let handles = (0..5)
            .map(|i| {
                let cache = cache.clone();
                thread::spawn(move || {
                    for j in 0..10 {
                        let key = format!("thread_{i}_key_{j}");
                        init(&cache, &key);
                        cache.insert(key, format!("file_{j}.arrow"));
                    }
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().unwrap();
        }

        assert!(cache.id_cache.memory_size() <= cache.id_cache.max_size);
        assert_eq!(cache.id_cache.memory_size(), tracked_size(&cache.id_cache));
        init(&cache, "final_test");
        assert!(cache.id_cache.exists("final_test"));
    }
}
