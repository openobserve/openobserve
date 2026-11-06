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
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};

use arrow::{array::RecordBatch, compute::concat_batches, datatypes::SchemaRef};
use config::utils::record_batch_ext::sort_record_batch_by_column;
use datafusion::{
    common::Result,
    execution::{RecordBatchStream, SendableRecordBatchStream},
};
use futures::{Stream, StreamExt};

pub struct TopKSortStream {
    schema: SchemaRef,
    stream: SendableRecordBatchStream,
    sort_field: String,
    descending: bool,
    limit: u64,
    cache_buf: Vec<RecordBatch>,
}

impl TopKSortStream {
    pub fn new(
        schema: SchemaRef,
        stream: SendableRecordBatchStream,
        sort_field: String,
        descending: bool,
        limit: u64,
    ) -> Self {
        Self {
            schema,
            stream,
            sort_field,
            descending,
            limit,
            cache_buf: Vec::new(),
        }
    }

    fn topk_batch(&self, mut batches: Vec<RecordBatch>) -> Option<RecordBatch> {
        if batches.is_empty() {
            return None;
        }
        let mut topk_batch = batches.remove(0);
        let schema = topk_batch.schema();
        while !batches.is_empty() {
            let next_batch = batches.remove(0);
            if next_batch.num_rows() == 0 {
                continue;
            }
            let new_batch = match concat_batches(&schema, vec![&topk_batch, &next_batch]) {
                Ok(batch) => batch,
                Err(e) => {
                    log::error!("CacheTopkStream: concat_batches failed: {e}");
                    continue;
                }
            };
            match sort_record_batch_by_column(
                new_batch,
                &self.sort_field,
                self.descending,
                Some((self.limit as usize * 4).max(1000)),
            ) {
                Ok(batch) => {
                    topk_batch = batch;
                }
                Err(e) => {
                    log::error!("CacheTopkStream: sort_record_batch_by_column failed: {e}");
                    continue;
                }
            };
        }
        Some(topk_batch)
    }
}

impl Stream for TopKSortStream {
    type Item = Result<RecordBatch>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match self.stream.poll_next_unpin(cx) {
            Poll::Ready(Some(Ok(batch))) => {
                let schema = batch.schema();
                let empty_batch = RecordBatch::new_empty(schema);
                match sort_record_batch_by_column(
                    batch,
                    &self.sort_field,
                    self.descending,
                    Some((self.limit as usize * 4).max(1000)),
                ) {
                    Ok(batch) => {
                        self.cache_buf.push(batch);
                    }
                    Err(e) => {
                        log::error!("CacheTopkStream: sort_record_batch_by_column failed: {e}");
                    }
                };
                Poll::Ready(Some(Ok(empty_batch)))
            }
            Poll::Ready(None) => {
                if self.cache_buf.is_empty() {
                    return Poll::Ready(None);
                }

                // sort the cache_buf by the group_expr and return topK
                let batches = std::mem::take(&mut self.cache_buf);
                let topk_batch = self.topk_batch(batches);
                // if let Some(batch) = topk_batch.as_ref() {
                //     _ = arrow::util::pretty::print_batches(&[batch.clone()]);
                // }
                Poll::Ready(topk_batch.map(Ok))
            }
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(e))) => {
                log::error!("Error in CacheTopkStream: {e}");
                Poll::Ready(None)
            }
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.stream.size_hint()
    }
}

impl RecordBatchStream for TopKSortStream {
    /// Get the schema
    fn schema(&self) -> SchemaRef {
        Arc::clone(&self.schema)
    }
}
