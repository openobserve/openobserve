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
    collections::VecDeque,
    fs::File,
    path::Path,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};

use arrow::{array::RecordBatch, datatypes::SchemaRef, ipc::reader::FileReader as ArrowFileReader};
use dashmap::DashMap;
use datafusion::{
    common::{Result, Statistics},
    error::DataFusionError,
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
use once_cell::sync::Lazy;

use crate::{
    common::meta::search::StreamingAggsCacheResult,
    service::search::cache::streaming_aggs::{
        RecordBatchCacheRequest, cache_record_batches_to_disk, get_streaming_aggs_records_from_disk,
    },
};

pub static GLOBAL_CACHE: Lazy<Arc<StreamingAggsCache>> =
    Lazy::new(|| Arc::new(StreamingAggsCache::default()));

pub static GLOBAL_ID_CACHE: Lazy<Arc<StreamingIdCache>> =
    Lazy::new(|| Arc::new(StreamingIdCache::default()));

// init streaming cache for the id
pub fn init_cache(
    id: &str,
    start_time: i64,
    end_time: i64,
    file_path: &str,
    is_complete_cache_hit: bool,
) {
    GLOBAL_ID_CACHE.insert(
        id.to_string(),
        start_time,
        end_time,
        file_path.to_string(),
        is_complete_cache_hit,
    );
    log::info!(
        "[StreamingAggs] init_cache: id={}, start_time={}, end_time={}, is_complete_cache_hit={}",
        id,
        start_time,
        end_time,
        is_complete_cache_hit,
    );
}

// remove streaming cache for the id
pub fn remove_cache(id: &str) {
    GLOBAL_CACHE.remove(id);
    GLOBAL_ID_CACHE.remove(id);
    log::info!("[StreamingAggs] remove_cache: id={}", id);
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
    is_complete_cache_hit: bool,
}

impl StreamingAggsExec {
    /// Create a new StreamingAggsExec
    pub fn new(
        id: String,
        start_time: i64,
        end_time: i64,
        cached_data: Vec<Arc<RecordBatch>>,
        input: Arc<dyn ExecutionPlan>,
    ) -> Self {
        Self::new_with_cache_strategy(id, start_time, end_time, cached_data, input, false)
    }

    /// Create a new StreamingAggsExec with explicit cache strategy
    pub fn new_with_cache_strategy(
        id: String,
        start_time: i64,
        end_time: i64,
        cached_data: Vec<Arc<RecordBatch>>,
        input: Arc<dyn ExecutionPlan>,
        is_complete_cache_hit: bool,
    ) -> Self {
        let cached_partition_num = if cached_data.is_empty() { 0 } else { 1 };

        let total_partitions = if is_complete_cache_hit {
            // Complete cache hit: only cached partitions, no input partitions
            cached_partition_num
        } else {
            // Partial or no cache: cached partitions + input partitions
            let input_partitions = input.output_partitioning().partition_count();
            cached_partition_num + input_partitions
        };

        let cache = Self::compute_properties(Arc::clone(&input.schema()), total_partitions);

        Self {
            id,
            start_time,
            end_time,
            input,
            cache,
            cached_data,
            cached_partition_num,
            is_complete_cache_hit,
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
                let strategy = if self.is_complete_cache_hit {
                    "complete_cache_hit"
                } else if !self.cached_data.is_empty() {
                    "partial_cache_hit"
                } else {
                    "cache_miss"
                };
                write!(
                    f,
                    "StreamingAggsExec: streaming_id={}, cache_strategy={}, cached_partitions={}, total_partitions={}",
                    self.id,
                    strategy,
                    self.cached_partition_num,
                    self.properties().output_partitioning().partition_count()
                )
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
        // Complete cache hit: only return cached data, never execute input
        if self.is_complete_cache_hit {
            if partition < self.cached_partition_num {
                return Ok(Box::pin(MemoryStream::try_new(
                    self.cached_data
                        .iter()
                        .map(|v| v.as_ref().clone())
                        .collect::<Vec<_>>(),
                    Arc::clone(&self.schema()),
                    None,
                )?));
            } else {
                // This should never happen with complete cache hit
                return Err(DataFusionError::Internal(format!(
                    "StreamingAggsExec: Invalid partition {} for complete cache hit with {} cached partitions",
                    partition, self.cached_partition_num
                )));
            }
        }

        // Partial or no cache: handle both cached and input partitions
        if partition < self.cached_partition_num {
            // Return cached data
            return Ok(Box::pin(MemoryStream::try_new(
                self.cached_data
                    .iter()
                    .map(|v| v.as_ref().clone())
                    .collect::<Vec<_>>(),
                Arc::clone(&self.schema()),
                None,
            )?));
        }

        // Execute input for missing data
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

    fn is_complete_partition_window(&self) -> bool {
        let window_micros = config::get_config()
            .common
            .streaming_aggs_partition_window_secs
            * 1_000_000;
        (self.end_time - self.start_time) == window_micros
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
                if self.is_complete_partition_window() {
                    // get all the record batches
                    let all_records = GLOBAL_CACHE.get(&self.id);
                    let file_path = get_file_path_from_streaming_id(&self.id);
                    let file_name = format!("{}_{}.arrow", self.start_time, self.end_time);
                    // write the record batches to the file
                    if let Some(records) = all_records {
                        let request = RecordBatchCacheRequest {
                            streaming_id: self.id.clone(),
                            file_path: file_path.clone(),
                            file_name: file_name.clone(),
                            records,
                        };
                        if let Err(e) = cache_record_batches_to_disk(request) {
                            log::error!(
                                "[streaming_id: {}] Error caching streaming aggs record batches to disk: {:?}",
                                self.id,
                                e
                            );
                        }
                    }
                }
                if streaming_done {
                    // remove the cache
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
    cacher: parking_lot::Mutex<VecDeque<String>>,
    max_entries: usize,
}

impl StreamingAggsCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            data: DashMap::new(),
            cacher: parking_lot::Mutex::new(VecDeque::new()),
            max_entries,
        }
    }

    pub fn get(&self, k: &str) -> Option<Vec<Arc<RecordBatch>>> {
        self.data.get(k).map(|v| v.value().clone())
    }

    pub fn insert(&self, k: String, v: RecordBatch) {
        let mut w = self.cacher.lock();
        if w.len() >= self.max_entries {
            log::info!(
                "[StreamingAggs] [streaming_id: {}] remove the oldest entry: max_entries={}, current_entries={}",
                k,
                self.max_entries,
                w.len()
            );
            if let Some(k_remove) = w.pop_front() {
                self.data.remove(&k_remove);
                GLOBAL_ID_CACHE.remove(&k_remove);
                log::info!(
                    "[StreamingAggs] [streaming_id: {}] old streaming_id removed: {}",
                    k,
                    k_remove
                );
            }
        }
        w.push_back(k.clone());
        drop(w);
        let mut entry = self.data.entry(k).or_default();
        entry.push(Arc::new(v));
    }

    pub fn insert_many(&self, k: String, v: Vec<RecordBatch>) {
        let mut w = self.cacher.lock();
        if w.len() >= self.max_entries {
            log::info!(
                "[StreamingAggs] remove the oldest entry: max_entries={}, current_entries={}",
                self.max_entries,
                w.len()
            );
            if let Some(k_remove) = w.pop_front() {
                self.data.remove(&k_remove);
                GLOBAL_ID_CACHE.remove(&k_remove);
                log::info!(
                    "[StreamingAggs] [streaming_id: {}] old streaming_id removed: {}",
                    k,
                    k_remove
                );
            }
        }
        w.push_back(k.clone());
        drop(w);
        let mut entry = self.data.entry(k).or_default();
        entry.extend(v.into_iter().map(|v| Arc::new(v)));
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
    data: DashMap<String, StreamingIdItem>,
}

impl StreamingIdCache {
    pub fn new() -> Self {
        Self {
            data: DashMap::new(),
        }
    }

    pub fn insert(
        &self,
        k: String,
        start_time: i64,
        end_time: i64,
        file_path: String,
        is_complete_cache_hit: bool,
    ) {
        self.data.insert(
            k,
            StreamingIdItem::new(start_time, end_time, file_path, is_complete_cache_hit),
        );
    }

    pub fn exists(&self, k: &str) -> bool {
        self.data.contains_key(k)
    }

    pub fn check_time(&self, k: &str, start_time: i64, end_time: i64) -> bool {
        match self.data.get_mut(k) {
            Some(mut v) => v.check_time(start_time, end_time),
            None => false,
        }
    }

    pub fn remove(&self, k: &str) {
        self.data.remove(k);
    }

    pub fn get(&self, k: &str) -> Option<StreamingIdItem> {
        self.data.get(k).map(|v| v.value().clone())
    }

    pub fn get_file_path(&self, k: &str) -> Option<String> {
        let entry = self.data.get(k);
        if let Some(v) = entry {
            let file_path = v.value().get_file_path();
            Some(file_path)
        } else {
            None
        }
    }
}

impl Default for StreamingIdCache {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone)]
pub struct StreamingIdItem {
    pub start_time: i64,
    pub end_time: i64,
    start_ok: bool,
    end_ok: bool,
    file_path: String,
    is_complete_cache_hit: bool,
}

impl StreamingIdItem {
    pub fn new(
        start_time: i64,
        end_time: i64,
        file_path: String,
        is_complete_cache_hit: bool,
    ) -> Self {
        Self {
            start_time,
            end_time,
            start_ok: false,
            end_ok: false,
            file_path,
            is_complete_cache_hit,
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

    pub fn get_file_path(&self) -> String {
        self.file_path.clone()
    }

    pub fn is_complete_cache_hit(&self) -> bool {
        self.is_complete_cache_hit
    }
}

fn get_file_path_from_streaming_id(streaming_id: &str) -> String {
    let file_path = GLOBAL_ID_CACHE.get_file_path(streaming_id);
    file_path.unwrap_or_default()
}

pub async fn check_record_batches_cache(
    query_start_time: i64,
    query_end_time: i64,
    file_path: &str,
) -> anyhow::Result<StreamingAggsCacheResult> {
    let cache_result =
        get_streaming_aggs_records_from_disk(file_path, query_start_time, query_end_time).await?;
    Ok(cache_result)
}

// prepare cache for the streaming_id
pub fn prepare_cache(
    streaming_id: &str,
    cache_result: StreamingAggsCacheResult,
) -> anyhow::Result<()> {
    log::info!(
        "[streaming_id {}] loaded {} cached record batches from disk",
        streaming_id,
        cache_result.cache_result.len()
    );

    if !cache_result.cache_result.is_empty() {
        let all_record_batches = cache_result.get_record_batches();
        GLOBAL_CACHE.insert_many(streaming_id.to_string(), all_record_batches);
    }

    Ok(())
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
        let cacher_len = cache.cacher.lock().len();
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
        let cacher_len = cache.cacher.lock().len();
        assert_eq!(cacher_len, 3);
    }
}
