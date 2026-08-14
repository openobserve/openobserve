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
use dashmap::DashMap;
use datafusion::{common::Result, error::DataFusionError};
use hashlink::lru_cache::LruCache;

use crate::cache::streaming_agg::StreamingAggsPartitionStrategy;

mod cached_file_stream;
pub mod exec;
mod monitor_stream;

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

/// Collected statistics for files
/// Cache is invalided when file size or last modification has changed
pub struct StreamingAggsCache {
    data: DashMap<String, Vec<Arc<String>>>, // streaming_id -> files
    max_entries: usize,
    pub id_cache: StreamingIdCache,
}

impl StreamingAggsCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            data: DashMap::new(),
            max_entries,
            id_cache: StreamingIdCache::new(max_entries),
        }
    }

    pub fn get(&self, k: &str) -> Option<Vec<Arc<String>>> {
        self.data.get(k).map(|v| v.value().clone())
    }

    pub fn insert(&self, k: String, v: String) {
        let streaming_id = k.clone(); // Clone for logging before k is moved
        let item_len = self.data.len();
        if item_len >= self.max_entries {
            log::info!(
                "[StreamingAggs streaming_id: {streaming_id}] remove the oldest 1% entries: max_entries={}, current_entries={item_len}",
                self.max_entries,
            );
            let gc_keys = self.id_cache.gc(item_len / 100);
            for gc_key in gc_keys {
                self.remove(&gc_key);
                log::info!(
                    "[StreamingAggs streaming_id: {streaming_id}] old streaming_id removed: {gc_key}"
                );
            }
        }
        let mut entry = self.data.entry(k).or_default();

        // Deduplicate: only add if file path doesn't already exist
        let file_arc = Arc::new(v.clone());
        if !entry.iter().any(|existing| existing.as_ref() == v.as_str()) {
            entry.push(file_arc);
            log::debug!("[StreamingAggs streaming_id: {streaming_id}] Added cache file: {v}");
        } else {
            log::debug!(
                "[StreamingAggs streaming_id: {streaming_id}] Skipped duplicate cache file: {v}"
            );
        }
    }

    pub fn remove(&self, k: &str) {
        self.id_cache.remove(k);
        let Some((_, files)) = self.data.remove(k) else {
            return;
        };
        self.data.shrink_to_fit();
        for file in files {
            // remove the temporary file when the streaming is done
            if file.contains("_tmp") {
                let Some(file_path) = infra::cache::file_data::disk::get_file_path(&file) else {
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
                .datafusion_streaming_aggs_cache_max_entries,
        )
    }
}

pub struct StreamingIdCache {
    data: parking_lot::RwLock<LruCache<String, StreamingIdItem>>,
}

impl StreamingIdCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            data: parking_lot::RwLock::new(LruCache::new(max_entries)),
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
        if w.get(&k).is_some() {
            return; // trigger the key as last recently used
        }
        w.insert(
            k,
            StreamingIdItem::new(start_time, end_time, cache_file_path, cache_interval_mins),
        );
        QUERY_AGGREGATION_CACHE_ITEMS
            .with_label_values::<&str>(&[])
            .inc();
    }

    pub fn exists(&self, k: &str) -> bool {
        self.data.read().contains_key(k)
    }

    pub fn check_time(&self, k: &str, start_time: i64, end_time: i64) -> bool {
        match self.data.write().get_mut(k) {
            Some(v) => v.check_time(start_time, end_time),
            None => false,
        }
    }

    pub fn remove(&self, k: &str) {
        if self.data.write().remove(k).is_some() {
            QUERY_AGGREGATION_CACHE_ITEMS
                .with_label_values::<&str>(&[])
                .dec();
        }
    }

    pub fn gc(&self, len: usize) -> Vec<String> {
        let len = std::cmp::max(1, len);
        let mut w = self.data.write();
        let mut remove_keys = Vec::new();
        for _ in 0..len {
            let Some((k, _)) = w.remove_lru() else {
                break;
            };
            remove_keys.push(k);
            QUERY_AGGREGATION_CACHE_ITEMS
                .with_label_values::<&str>(&[])
                .dec();
        }
        remove_keys
    }

    pub fn get(&self, k: &str) -> Option<StreamingIdItem> {
        self.data.read().peek(k).cloned()
    }

    pub fn get_cache_file_path(&self, k: &str) -> Option<String> {
        self.data.read().peek(k).map(|v| v.get_cache_file_path())
    }

    pub fn set_partition_strategy(&self, k: &str, strategy: StreamingAggsPartitionStrategy) {
        if let Some(item) = self.data.write().get_mut(k) {
            item.set_partition_strategy(strategy);
        }
    }

    pub fn get_partition_strategy(&self, k: &str) -> Option<StreamingAggsPartitionStrategy> {
        self.data
            .read()
            .peek(k)
            .and_then(|v| v.get_partition_strategy())
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

#[cfg(test)]
mod tests {

    use datafusion::physical_plan::ExecutionPlan;

    use super::*;
    use crate::datafusion::distributed_plan::streaming_aggs_exec::exec::StreamingAggsExec;

    #[test]
    fn test_streaming_aggs_cache_insert_max_entries() {
        // Create a cache with max_entries = 2
        let cache = StreamingAggsCache::new(2);

        // Create test schema and record batches
        let file1 = "test_file1.arrow";
        let file2 = "test_file2.arrow";
        let file3 = "test_file3.arrow";

        // Insert first entry
        cache.insert("key1".to_string(), file1.to_string());
        cache
            .id_cache
            .insert("key1".to_string(), 1, 2, "path1".to_string(), 60);
        assert!(cache.get("key1").is_some());
        assert_eq!(cache.data.len(), 1);

        // Insert second entry
        cache.insert("key2".to_string(), file2.to_string());
        cache
            .id_cache
            .insert("key2".to_string(), 1, 2, "path2".to_string(), 60);
        assert!(cache.get("key1").is_some());
        assert!(cache.get("key2").is_some());
        assert_eq!(cache.data.len(), 2);

        // Insert third entry - should evict the first (oldest) entry
        cache.insert("key3".to_string(), file3.to_string());
        cache
            .id_cache
            .insert("key3".to_string(), 1, 2, "path3".to_string(), 60);
        assert!(cache.get("key1").is_none()); // Should be evicted
        assert!(cache.get("key2").is_some());
        assert!(cache.get("key3").is_some());
        assert_eq!(cache.data.len(), 2); // Should still be 2 (max_entries)

        // Verify that the cacher queue length matches max_entries
        let cacher_len = cache.data.len();
        assert_eq!(cacher_len, 2);
    }

    #[test]
    fn test_streaming_aggs_cache_deduplication() {
        let cache = StreamingAggsCache::new(10);

        // Insert same file path multiple times (simulating multiple partitions)
        cache.insert(
            "streaming_id_1".to_string(),
            "cache_file_1.arrow".to_string(),
        );
        cache.insert(
            "streaming_id_1".to_string(),
            "cache_file_2.arrow".to_string(),
        );
        cache.insert(
            "streaming_id_1".to_string(),
            "cache_file_1.arrow".to_string(),
        ); // Duplicate
        cache.insert(
            "streaming_id_1".to_string(),
            "cache_file_3.arrow".to_string(),
        );
        cache.insert(
            "streaming_id_1".to_string(),
            "cache_file_2.arrow".to_string(),
        ); // Duplicate

        let files = cache.get("streaming_id_1").unwrap();

        // Should only have 3 unique files, not 5
        assert_eq!(files.len(), 3, "Should deduplicate cache files");

        // Verify the files are the unique ones
        let file_paths: Vec<String> = files.iter().map(|f| f.as_ref().to_string()).collect();
        assert!(file_paths.contains(&"cache_file_1.arrow".to_string()));
        assert!(file_paths.contains(&"cache_file_2.arrow".to_string()));
        assert!(file_paths.contains(&"cache_file_3.arrow".to_string()));
    }

    #[test]
    fn test_streaming_aggs_cache_id_cache_gc() {
        let cache = StreamingIdCache::new(10);
        cache.insert("key1".to_string(), 1, 2, "path1".to_string(), 60);
        cache.insert("key2".to_string(), 1, 2, "path2".to_string(), 60);
        cache.insert("key3".to_string(), 1, 2, "path3".to_string(), 60);
        cache.insert("key4".to_string(), 1, 2, "path4".to_string(), 60);
        cache.insert("key5".to_string(), 1, 2, "path5".to_string(), 60);
        // trigger the key as last recently used
        cache.insert("key1".to_string(), 1, 2, "path1".to_string(), 60);
        assert_eq!(cache.data.read().len(), 5);
        let gc_keys = cache.gc(2);
        assert_eq!(gc_keys, vec!["key2", "key3"]);
        assert_eq!(cache.data.read().len(), 3);
        assert!(cache.exists("key4"));
        assert!(cache.exists("key5"));
        assert!(cache.exists("key1"));
    }

    // Note: StreamingAggsExec::new() tests are complex due to DataFusion dependencies
    // The constructor logic is indirectly tested through the integration tests
    // Testing getter methods only since they have simple behavior

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
    fn test_streaming_aggs_cache_get_exists_remove() {
        let cache = StreamingAggsCache::new(10);

        // Test non-existent key
        assert!(cache.get("nonexistent").is_none());
        assert!(!cache.id_cache.exists("nonexistent"));

        // Insert a key
        cache.insert("test_key".to_string(), "file1.arrow".to_string());
        cache.id_cache.insert(
            "test_key".to_string(),
            1000,
            2000,
            "test_path".to_string(),
            60,
        );

        // Test exists
        assert!(cache.id_cache.exists("test_key"));

        // Test get
        let files = cache.get("test_key");
        assert!(files.is_some());
        assert_eq!(files.unwrap().len(), 1);

        // Insert another file for the same key
        cache.insert("test_key".to_string(), "file2.arrow".to_string());
        let files = cache.get("test_key");
        assert!(files.is_some());
        assert_eq!(files.unwrap().len(), 2);

        // Test remove
        cache.remove("test_key");
        assert!(!cache.id_cache.exists("test_key"));
        assert!(cache.get("test_key").is_none());
    }

    #[test]
    fn test_streaming_id_cache_check_time() {
        let cache = StreamingIdCache::new(10);
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
        let cache = StreamingIdCache::new(10);
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

        use arrow::datatypes::{DataType, Field, Schema};
        use datafusion::physical_plan::{
            aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
            empty::EmptyExec,
        };

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                PhysicalGroupBy::new_single(vec![]),
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
        let _stats = exec.partition_statistics(Some(0)).unwrap();
        // Just verify statistics() method doesn't panic - we can't easily test Precision enum
        // values
    }

    #[test]
    fn test_streaming_aggs_exec_with_new_children() {
        use std::sync::Arc;

        use arrow::datatypes::{DataType, Field, Schema};
        use datafusion::physical_plan::{
            aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
            empty::EmptyExec,
        };

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                PhysicalGroupBy::new_single(vec![]),
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
        let new_exec = exec.with_new_children(vec![new_input]).unwrap();

        // Verify it's a StreamingAggsExec
        assert!(new_exec.downcast_ref::<StreamingAggsExec>().is_some());
        assert_eq!(new_exec.name(), "StreamingAggsExec");
    }

    #[test]
    fn test_display_as_trait() {
        use std::sync::Arc;

        use arrow::datatypes::{DataType, Field, Schema};
        use datafusion::physical_plan::{
            aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
            empty::EmptyExec,
        };

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                PhysicalGroupBy::new_single(vec![]),
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
        if let datafusion::physical_plan::Partitioning::UnknownPartitioning(count) = partitioning {
            assert_eq!(count, 5);
        } else {
            panic!("Expected UnknownPartitioning");
        }
    }

    #[test]
    fn test_compute_properties() {
        use std::sync::Arc;

        use arrow::datatypes::{DataType, Field, Schema};

        let schema = Arc::new(Schema::new(vec![Field::new(
            "test_col",
            DataType::Utf8,
            false,
        )]));

        let properties = StreamingAggsExec::compute_properties(schema.clone(), 3);

        // Verify the properties are set correctly - we can't access schema() directly but we can
        // verify partitioning Check partitioning
        if let datafusion::physical_plan::Partitioning::UnknownPartitioning(count) =
            properties.output_partitioning()
        {
            assert_eq!(*count, 3);
        } else {
            panic!("Expected UnknownPartitioning");
        }
    }

    #[test]
    fn test_streaming_aggs_cache_max_entries_behavior() {
        // Test the max_entries behavior more thoroughly
        let cache = StreamingAggsCache::new(3); // Small max for testing

        // Fill to capacity
        for i in 0..3 {
            let key = format!("key{i}");
            cache.insert(key.clone(), format!("file{i}.arrow"));
            cache
                .id_cache
                .insert(key, i as i64, (i + 1) as i64, format!("path{i}"), 60);
        }

        // Verify all are present
        assert!(cache.id_cache.exists("key0"));
        assert!(cache.id_cache.exists("key1"));
        assert!(cache.id_cache.exists("key2"));

        // Add one more - should trigger GC
        cache.insert("key3".to_string(), "file3.arrow".to_string());
        cache
            .id_cache
            .insert("key3".to_string(), 3, 4, "path3".to_string(), 60);

        // Some old entries should be gone after GC
        let remaining_count = ["key0", "key1", "key2", "key3"]
            .iter()
            .filter(|&k| cache.id_cache.exists(k))
            .count();

        // Should have at most max_entries (3) after GC
        assert!(remaining_count <= 3);
    }

    #[test]
    fn test_streaming_aggs_cache_get_cache_interval() {
        let cache = StreamingAggsCache::new(10);

        // Test with non-existent key
        let interval = cache.get_cache_interval("nonexistent");
        assert_eq!(interval, 0); // Default value

        // Test with existing key that has a valid cache file path
        cache.insert("test_interval".to_string(), "test_file.arrow".to_string());
        cache.id_cache.insert(
            "test_interval".to_string(),
            1000,
            2000,
            "org/stream/1h".to_string(),
            60,
        );

        let interval = cache.get_cache_interval("test_interval");
        assert_eq!(interval, 60);
    }

    #[test]
    fn test_streaming_id_cache_new_with_capacity() {
        let cache = StreamingIdCache::new(5);

        // Test that new cache is empty
        assert!(!cache.exists("any_key"));

        // Add entries up to capacity
        for i in 0..5 {
            let key = format!("key{i}");
            cache.insert(
                key.clone(),
                i as i64,
                (i + 1) as i64,
                format!("path{i}"),
                60,
            );
            assert!(cache.exists(&key));
        }

        // Add one more to test LRU eviction
        cache.insert("key5".to_string(), 5, 6, "path5".to_string(), 60);

        // Should still work (LRU will handle the overflow)
        assert!(cache.exists("key5"));
    }

    #[test]
    fn test_streaming_aggs_exec_constructor_variations() {
        use std::sync::Arc;

        use arrow::datatypes::{DataType, Field, Schema};
        use datafusion::physical_plan::{
            aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
            empty::EmptyExec,
        };

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                PhysicalGroupBy::new_single(vec![]),
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

        use arrow::datatypes::{DataType, Field, Schema};
        use datafusion::{
            execution::context::TaskContext,
            physical_plan::{
                aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
                empty::EmptyExec,
            },
        };

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                PhysicalGroupBy::new_single(vec![]),
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

        use arrow::datatypes::{DataType, Field, Schema};
        use datafusion::physical_plan::{
            aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
            empty::EmptyExec,
        };

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                PhysicalGroupBy::new_single(vec![]),
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
    fn test_streaming_aggs_cache_edge_cases() {
        let cache = StreamingAggsCache::new(0); // Zero capacity

        // Test with zero capacity
        cache.insert("key1".to_string(), "file1.arrow".to_string());
        // Should still work even with 0 capacity (implementation dependent)

        // Test remove on non-existent key
        cache.remove("nonexistent");
        // Should not panic

        // Test get_cache_interval with zero capacity cache
        // When capacity is 0, LRU cache cannot store any items (immediate eviction)
        cache
            .id_cache
            .insert("empty_path".to_string(), 1000, 2000, "".to_string(), 60);
        let interval = cache.get_cache_interval("empty_path");
        assert_eq!(interval, 0); // Returns default because item was immediately evicted from zero-capacity LRU
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

        // Should handle this without panicking
        assert!(cache.data.read().len() <= 1); // Should be at most capacity

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

        use arrow::datatypes::{DataType, Field, Schema};
        use datafusion::physical_plan::{
            aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
            empty::EmptyExec,
        };

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                PhysicalGroupBy::new_single(vec![]),
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

        use arrow::datatypes::{DataType, Field, Schema};
        use datafusion::physical_plan::{
            aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
            empty::EmptyExec,
        };

        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let input = Arc::new(EmptyExec::new(schema.clone()));
        let aggregate_plan = Arc::new(
            AggregateExec::try_new(
                AggregateMode::Partial,
                PhysicalGroupBy::new_single(vec![]),
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
        let result = exec.clone().with_new_children(vec![new_input]);
        assert!(result.is_ok()); // Should succeed with one child

        // Note: The original code doesn't actually validate the number of children in
        // with_new_children It just uses the first child. Testing exact error behavior
        // would require understanding the internal implementation details.
    }

    #[test]
    fn test_streaming_aggs_cache_concurrent_operations() {
        use std::{sync::Arc, thread};

        let cache = Arc::new(StreamingAggsCache::new(10));
        let mut handles = vec![];

        // Test concurrent insertions
        for i in 0..5 {
            let cache_clone = cache.clone();
            let handle = thread::spawn(move || {
                for j in 0..10 {
                    let key = format!("thread_{i}_key_{j}");
                    cache_clone.insert(key.clone(), format!("file_{j}.arrow"));
                    cache_clone.id_cache.insert(
                        key,
                        i as i64,
                        j as i64,
                        format!("path_{i}_{j}"),
                        60,
                    );
                }
            });
            handles.push(handle);
        }

        // Wait for all threads to complete
        for handle in handles {
            handle.join().unwrap();
        }

        // Verify cache still works after concurrent operations
        cache.insert("final_test".to_string(), "final.arrow".to_string());
        cache.id_cache.insert(
            "final_test".to_string(),
            999,
            1000,
            "final_path".to_string(),
            60,
        );
        assert!(cache.id_cache.exists("final_test"));
    }
}
