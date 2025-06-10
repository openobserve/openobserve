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
    any::Any,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};

use arrow::{array::RecordBatch, datatypes::SchemaRef};
use dashmap::DashMap;
use datafusion::{
    common::{Result, Statistics},
    execution::{RecordBatchStream, SendableRecordBatchStream, TaskContext},
    physical_expr::EquivalenceProperties,
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, ExecutionPlanProperties, Partitioning,
        PlanProperties,
        execution_plan::{Boundedness, EmissionType},
        memory::MemoryStream,
    },
};
use futures::{Stream, StreamExt};
use hashlink::lru_cache::LruCache;
use once_cell::sync::Lazy;

pub static GLOBAL_CACHE: Lazy<Arc<StreamingAggsCache>> =
    Lazy::new(|| Arc::new(StreamingAggsCache::default()));

pub static GLOBAL_ID_CACHE: Lazy<Arc<StreamingIdCache>> =
    Lazy::new(|| Arc::new(StreamingIdCache::default()));

// init streaming cache for the id
pub fn init_cache(id: &str, start_time: i64, end_time: i64) {
    GLOBAL_ID_CACHE.insert(id.to_string(), start_time, end_time);
    log::debug!(
        "[StreamingAggs] init_cache: id={}, start_time={}, end_time={}",
        id,
        start_time,
        end_time
    );
}

// remove streaming cache for the id
pub fn remove_cache(id: &str) {
    GLOBAL_CACHE.remove(id);
    GLOBAL_ID_CACHE.remove(id);
    log::debug!("[StreamingAggs] remove_cache: id={}", id);
}

#[derive(Debug)]
pub struct StreamingAggsExec {
    id: String,
    start_time: i64,
    end_time: i64,
    input: Arc<dyn ExecutionPlan>,
    /// Cache holding plan properties like equivalences, output partitioning etc.
    cache: PlanProperties,
    cached_data: Vec<Arc<RecordBatch>>,
    cached_partition_num: usize,
}

impl StreamingAggsExec {
    /// Create a new UnionExec
    pub fn new(
        id: String,
        start_time: i64,
        end_time: i64,
        cached_data: Vec<Arc<RecordBatch>>,
        input: Arc<dyn ExecutionPlan>,
    ) -> Self {
        let partitions_num = input.output_partitioning().partition_count();
        let cached_partition_num = 1; // the first partition is used to store the cache
        let cache = Self::compute_properties(
            Arc::clone(&input.schema()),
            partitions_num + cached_partition_num,
        );
        Self {
            id,
            start_time,
            end_time,
            input,
            cache,
            cached_data,
            cached_partition_num,
        }
    }

    fn output_partitioning_helper(n_partitions: usize) -> Partitioning {
        Partitioning::UnknownPartitioning(n_partitions)
    }

    /// This function creates the cache object that stores the plan properties such as schema,
    /// equivalence properties, ordering, partitioning, etc.
    fn compute_properties(schema: SchemaRef, n_partitions: usize) -> PlanProperties {
        let eq_properties = EquivalenceProperties::new(schema);
        let output_partitioning = Self::output_partitioning_helper(n_partitions);
        PlanProperties::new(
            eq_properties,
            // Output Partitioning
            output_partitioning,
            // Execution Mode
            EmissionType::Incremental,
            Boundedness::Bounded,
        )
    }
}

impl DisplayAs for StreamingAggsExec {
    fn fmt_as(&self, t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match t {
            DisplayFormatType::Default | DisplayFormatType::Verbose => {
                write!(f, "StreamingAggsExec: streaming_id={}", self.id)
            }
        }
    }
}

impl ExecutionPlan for StreamingAggsExec {
    fn name(&self) -> &'static str {
        "StreamingAggsExec"
    }

    /// Return a reference to Any that can be used for downcasting
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn properties(&self) -> &PlanProperties {
        &self.cache
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![&self.input]
    }

    fn with_new_children(
        self: Arc<Self>,
        _: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        Ok(self)
    }

    fn execute(
        &self,
        partition: usize,
        context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        // self data
        if partition < self.cached_partition_num {
            return Ok(Box::pin(MemoryStream::try_new(
                self.cached_data
                    .iter()
                    .map(|v| v.as_ref().clone())
                    .collect::<Vec<_>>(),
                Arc::clone(&self.schema()),
                None,
            )?));
        }
        // input data
        Ok(Box::pin(MonitorStream::new(
            self.id.clone(),
            self.start_time,
            self.end_time,
            self.input.schema(),
            self.input
                .execute(partition - self.cached_partition_num, context)?,
        )))
    }

    fn statistics(&self) -> Result<Statistics> {
        Ok(Statistics::new_unknown(&self.schema()))
    }

    fn benefits_from_input_partitioning(&self) -> Vec<bool> {
        vec![false; self.children().len()]
    }

    fn supports_limit_pushdown(&self) -> bool {
        true
    }
}

struct MonitorStream {
    id: String,
    start_time: i64,
    end_time: i64,
    schema: SchemaRef,
    stream: SendableRecordBatchStream,
}

impl MonitorStream {
    fn new(
        id: String,
        start_time: i64,
        end_time: i64,
        schema: SchemaRef,
        stream: SendableRecordBatchStream,
    ) -> Self {
        Self {
            id,
            start_time,
            end_time,
            schema,
            stream,
        }
    }
}

impl Stream for MonitorStream {
    type Item = Result<RecordBatch>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match self.stream.poll_next_unpin(cx) {
            Poll::Ready(Some(Ok(record_batch))) => {
                let streaming_done =
                    GLOBAL_ID_CACHE.check_time(&self.id, self.start_time, self.end_time);
                if !streaming_done {
                    GLOBAL_CACHE.insert(self.id.clone(), record_batch.clone());
                }
                Poll::Ready(Some(Ok(record_batch)))
            }
            Poll::Ready(None) => {
                let streaming_done =
                    GLOBAL_ID_CACHE.check_time(&self.id, self.start_time, self.end_time);
                if streaming_done {
                    remove_cache(&self.id);
                }
                Poll::Ready(None)
            }
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(e))) => {
                log::error!("Error in MonitorStream: {:?}", e);
                Poll::Ready(None)
            }
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.stream.size_hint()
    }
}

impl RecordBatchStream for MonitorStream {
    /// Get the schema
    fn schema(&self) -> SchemaRef {
        Arc::clone(&self.schema)
    }
}

/// Collected statistics for files
/// Cache is invalided when file size or last modification has changed
pub struct StreamingAggsCache {
    data: DashMap<String, Vec<Arc<RecordBatch>>>,
    max_entries: usize,
}

impl StreamingAggsCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            data: DashMap::new(),
            max_entries,
        }
    }

    pub fn get(&self, k: &str) -> Option<Vec<Arc<RecordBatch>>> {
        self.data.get(k).map(|v| v.value().clone())
    }

    pub fn insert(&self, k: String, v: RecordBatch) {
        let item_len = self.data.len();
        if item_len >= self.max_entries {
            log::info!(
                "[StreamingAggs] [streaming_id: {}] remove the oldest 1% entries: max_entries={}, current_entries={}",
                k,
                self.max_entries,
                item_len
            );
            let gc_keys = GLOBAL_ID_CACHE.gc(item_len / 100);
            for gc_key in gc_keys {
                self.data.remove(&gc_key);
                log::info!(
                    "[StreamingAggs] [streaming_id: {}] old streaming_id removed: {}",
                    k,
                    gc_key
                );
            }
        }
        let mut entry = self.data.entry(k).or_default();
        entry.push(Arc::new(v));
    }

    pub fn remove(&self, k: &str) {
        self.data.remove(k);
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

    pub fn insert(&self, k: String, start_time: i64, end_time: i64) {
        let mut w = self.data.write();
        if w.get(&k).is_some() {
            return; // trigger the key as last recently used
        }
        w.insert(k, StreamingIdItem::new(start_time, end_time));
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
        self.data.write().remove(k);
    }

    pub fn gc(&self, len: usize) -> Vec<String> {
        let mut w = self.data.write();
        let mut remove_keys = Vec::new();
        for _ in 0..len {
            let Some((k, _)) = w.remove_lru() else {
                break;
            };
            remove_keys.push(k);
        }
        remove_keys
    }
}

impl Default for StreamingIdCache {
    fn default() -> Self {
        Self::new(
            config::get_config()
                .limit
                .datafusion_streaming_aggs_cache_max_entries,
        )
    }
}

struct StreamingIdItem {
    start_time: i64,
    end_time: i64,
    start_ok: bool,
    end_ok: bool,
}

impl StreamingIdItem {
    pub fn new(start_time: i64, end_time: i64) -> Self {
        Self {
            start_time,
            end_time,
            start_ok: false,
            end_ok: false,
        }
    }

    pub fn check_time(&mut self, start_time: i64, end_time: i64) -> bool {
        if start_time == self.start_time {
            self.start_ok = true;
        }
        if end_time == self.end_time {
            self.end_ok = true;
        }
        self.start_ok && self.end_ok
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{Int32Array, RecordBatch},
        datatypes::{DataType, Field, Schema},
    };

    use super::*;

    #[test]
    fn test_streaming_aggs_cache_insert_max_entries() {
        // Create a cache with max_entries = 2
        let cache = StreamingAggsCache::new(2);

        // Create test schema and record batches
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));

        let batch1 = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from(vec![1, 2, 3]))],
        )
        .unwrap();

        let batch2 = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from(vec![4, 5, 6]))],
        )
        .unwrap();

        let batch3 = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from(vec![7, 8, 9]))],
        )
        .unwrap();

        // Insert first entry
        cache.insert("key1".to_string(), batch1);
        assert!(cache.get("key1").is_some());
        assert_eq!(cache.data.len(), 1);

        // Insert second entry
        cache.insert("key2".to_string(), batch2);
        assert!(cache.get("key1").is_some());
        assert!(cache.get("key2").is_some());
        assert_eq!(cache.data.len(), 2);

        // Insert third entry - should evict the first (oldest) entry
        cache.insert("key3".to_string(), batch3);
        assert!(cache.get("key1").is_none()); // Should be evicted
        assert!(cache.get("key2").is_some());
        assert!(cache.get("key3").is_some());
        assert_eq!(cache.data.len(), 2); // Should still be 2 (max_entries)

        // Verify that the cacher queue length matches max_entries
        let cacher_len = cache.data.len();
        assert_eq!(cacher_len, 2);
    }

    #[test]
    fn test_streaming_aggs_cache_insert_within_limit() {
        // Create a cache with max_entries = 5
        let cache = StreamingAggsCache::new(5);

        // Create test schema and record batch
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from(vec![1, 2, 3]))],
        )
        .unwrap();

        // Insert 3 entries (within limit)
        cache.insert("key1".to_string(), batch.clone());
        cache.insert("key2".to_string(), batch.clone());
        cache.insert("key3".to_string(), batch.clone());

        // All entries should be present
        assert!(cache.get("key1").is_some());
        assert!(cache.get("key2").is_some());
        assert!(cache.get("key3").is_some());
        assert_eq!(cache.data.len(), 3);

        // Verify that the cacher queue length matches number of entries
        let cacher_len = cache.data.len();
        assert_eq!(cacher_len, 3);
    }

    #[test]
    fn test_streaming_id_cache_gc() {
        let cache = StreamingIdCache::new(10);
        cache.insert("key1".to_string(), 1, 2);
        cache.insert("key2".to_string(), 1, 2);
        cache.insert("key3".to_string(), 1, 2);
        cache.insert("key4".to_string(), 1, 2);
        cache.insert("key5".to_string(), 1, 2);
        assert_eq!(cache.data.read().len(), 5);
        let gc_keys = cache.gc(2);
        assert_eq!(gc_keys, vec!["key1", "key2"]);
        assert_eq!(cache.data.read().len(), 3);
        assert!(cache.exists("key3"));
        assert!(cache.exists("key4"));
        assert!(cache.exists("key5"));
    }
}
