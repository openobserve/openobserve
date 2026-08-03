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
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};

use arrow::{array::RecordBatch, datatypes::SchemaRef};
use datafusion::{
    common::Result,
    execution::{RecordBatchStream, SendableRecordBatchStream},
};
use futures::{Stream, StreamExt};
use futures_util::ready;
use parking_lot::Mutex;

use crate::{
    cache::streaming_agg::{
        RecordBatchCacheRequest, cache_record_batches_to_disk,
        generate_aggregation_cache_file_name, get_cache_file_path,
    },
    datafusion::distributed_plan::{
        cache_buf::CacheBuf,
        streaming_aggs_exec::{GLOBAL_CACHE, get_cache_file_path_from_streaming_id},
    },
};

pub(crate) struct MonitorStream {
    id: String,
    start_time: i64,
    end_time: i64,
    schema: SchemaRef,
    stream: SendableRecordBatchStream,
    root_cache_buf: Arc<Mutex<CacheBuf>>,
    done: bool,
    overwrite_cache: bool,
}

impl MonitorStream {
    pub(crate) fn new(
        id: String,
        start_time: i64,
        end_time: i64,
        schema: SchemaRef,
        root_cache_buf: Arc<Mutex<CacheBuf>>,
        stream: SendableRecordBatchStream,
        overwrite_cache: bool,
    ) -> Self {
        Self {
            id,
            start_time,
            end_time,
            schema,
            stream,
            root_cache_buf,
            done: false,
            overwrite_cache,
        }
    }

    pub fn is_complete_partition_window(&self) -> bool {
        let interval = GLOBAL_CACHE.get_cache_interval(&self.id); // minutes
        let interval_micros = interval * 60 * 1_000_000; // microseconds
        (self.end_time - self.start_time) == interval_micros
    }

    pub fn append_to_cache_buf(&mut self, record_batch: Arc<RecordBatch>) {
        self.root_cache_buf.lock().append_data(record_batch);
    }

    pub fn check_and_add_partition(&mut self) -> bool {
        self.root_cache_buf.lock().check_and_add_partition()
    }
}

impl Stream for MonitorStream {
    type Item = Result<RecordBatch>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        if self.done {
            return Poll::Ready(None);
        }

        let res = ready!(self.stream.poll_next_unpin(cx));

        Poll::Ready(match res {
            Some(Ok(record_batch)) => {
                self.append_to_cache_buf(Arc::new(record_batch.clone()));
                Some(Ok(record_batch))
            }
            None => {
                self.done = true;

                let partition_done = self.check_and_add_partition();
                let streaming_done = partition_done
                    && GLOBAL_CACHE
                        .id_cache
                        .check_time(&self.id, self.start_time, self.end_time);

                let file_path = get_cache_file_path_from_streaming_id(&self.id)?;
                let file_name = generate_aggregation_cache_file_name(
                    &self.id,
                    self.start_time,
                    self.end_time,
                    self.is_complete_partition_window(),
                );

                // Start - Cache record batches to disk
                if partition_done && (!streaming_done || self.is_complete_partition_window()) {
                    let result_vec = self.root_cache_buf.lock().get_final_result(&self.id)?;

                    let file_path = get_cache_file_path(&file_path, &file_name);
                    let request = RecordBatchCacheRequest {
                        streaming_id: self.id.clone(),
                        file_path: file_path.clone(),
                        schema: self.schema.clone(),
                        records: result_vec.into_iter().map(Arc::new).collect(),
                        overwrite_cache: self.overwrite_cache,
                    };

                    let start = std::time::Instant::now();
                    match cache_record_batches_to_disk(request) {
                        Ok(()) => {
                            // add to cache list
                            GLOBAL_CACHE.insert(self.id.clone(), file_path);
                        }
                        Err(e) => {
                            log::error!(
                                "[streaming_id: {}] Error caching streaming aggs record batchesto disk file: {file_path}, error: {e:?}",
                                self.id,
                            );
                        }
                    }
                    log::info!(
                        "[streaming_id: {}] cache_record_batches_to_disk time: {} ms",
                        self.id,
                        start.elapsed().as_millis()
                    );
                }
                // End - Cache record batches to disk

                None
            }
            Some(Err(e)) => {
                log::error!("[streaming_id: {}] Error in MonitorStream: {e}", self.id);
                Some(Err(e))
            }
        })
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::datatypes::{DataType, Field, Schema};
    use datafusion::{
        execution::SendableRecordBatchStream,
        physical_plan::{aggregates::AggregateExec, memory::MemoryStream},
    };
    use tokio::sync::mpsc;

    use super::*;
    use crate::datafusion::distributed_plan::cache_buf::CacheStream;

    #[test]
    fn test_monitor_stream_new() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        // Create a dummy stream
        let batches = vec![];
        let memory_stream = MemoryStream::try_new(batches, schema.clone(), None).unwrap();
        let input_stream: SendableRecordBatchStream = Box::pin(memory_stream);

        let (_tx, _rx): (
            tokio::sync::mpsc::Sender<()>,
            tokio::sync::mpsc::Receiver<()>,
        ) = mpsc::channel(1);

        // Create a dummy cache buffer for MonitorStream
        let cache_buf = Arc::new(parking_lot::Mutex::new(CacheBuf {
            total_partition_num: 1,
            cached_partition_num: 0,
            cached_buf: CacheStream::new(
                false,
                1,
                Arc::new(
                    AggregateExec::try_new(
                        datafusion::physical_plan::aggregates::AggregateMode::Partial,
                        datafusion::physical_plan::aggregates::PhysicalGroupBy::new_single(vec![]),
                        vec![],
                        vec![],
                        Arc::new(datafusion::physical_plan::empty::EmptyExec::new(
                            schema.clone(),
                        )),
                        schema.clone(),
                    )
                    .unwrap(),
                ),
            ),
        }));

        // Test MonitorStream::new
        let monitor_stream = MonitorStream::new(
            "test_monitor".to_string(),
            1000,
            2000,
            schema.clone(),
            cache_buf,
            input_stream,
            false,
        );

        // Verify initial state
        assert_eq!(monitor_stream.id, "test_monitor");
        assert_eq!(monitor_stream.start_time, 1000);
        assert_eq!(monitor_stream.end_time, 2000);
    }
}
