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

    fn sort_and_truncate(&self, batch: RecordBatch) -> Result<RecordBatch> {
        sort_record_batch_by_column(
            batch,
            &self.sort_field,
            self.descending,
            Some((self.limit as usize * 4).max(1000)),
        )
    }

    fn topk_batch(&self, mut batches: Vec<RecordBatch>) -> Result<Option<RecordBatch>> {
        if batches.is_empty() {
            return Ok(None);
        }
        let mut topk_batch = batches.remove(0);
        let schema = topk_batch.schema();
        while !batches.is_empty() {
            let next_batch = batches.remove(0);
            if next_batch.num_rows() == 0 {
                continue;
            }
            let new_batch = concat_batches(&schema, vec![&topk_batch, &next_batch])?;
            topk_batch = self.sort_and_truncate(new_batch)?;
        }
        Ok(Some(topk_batch))
    }
}

impl Stream for TopKSortStream {
    type Item = Result<RecordBatch>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match self.stream.poll_next_unpin(cx) {
            Poll::Ready(Some(Ok(batch))) => {
                let schema = batch.schema();
                let empty_batch = RecordBatch::new_empty(schema);
                match self.sort_and_truncate(batch) {
                    Ok(batch) => {
                        self.cache_buf.push(batch);
                        Poll::Ready(Some(Ok(empty_batch)))
                    }
                    Err(e) => Poll::Ready(Some(Err(e))),
                }
            }
            Poll::Ready(None) => {
                if self.cache_buf.is_empty() {
                    return Poll::Ready(None);
                }

                // sort the cache_buf by the group_expr and return topK
                let batches = std::mem::take(&mut self.cache_buf);
                Poll::Ready(self.topk_batch(batches).transpose())
            }
            Poll::Pending => Poll::Pending,
            Poll::Ready(Some(Err(e))) => Poll::Ready(Some(Err(e))),
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

#[cfg(test)]
mod tests {
    use arrow::{
        array::{Int64Array, StringArray},
        datatypes::{DataType, Field, Schema},
    };
    use datafusion::{common::DataFusionError, physical_plan::stream::RecordBatchStreamAdapter};

    use super::*;

    fn test_batch(schema: SchemaRef) -> RecordBatch {
        RecordBatch::try_new(
            schema,
            vec![
                Arc::new(StringArray::from(vec!["a", "b", "c"])),
                Arc::new(Int64Array::from(vec![3, 1, 2])),
            ],
        )
        .unwrap()
    }

    fn topk_stream(
        schema: SchemaRef,
        input: Vec<Result<RecordBatch>>,
        sort_field: &str,
    ) -> TopKSortStream {
        let stream: SendableRecordBatchStream = Box::pin(RecordBatchStreamAdapter::new(
            schema.clone(),
            futures::stream::iter(input),
        ));
        TopKSortStream::new(schema, stream, sort_field.to_string(), true, 2)
    }

    async fn first_error(mut stream: TopKSortStream) -> Option<DataFusionError> {
        while let Some(result) = stream.next().await {
            if let Err(e) = result {
                return Some(e);
            }
        }
        None
    }

    fn test_schema() -> SchemaRef {
        Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("count", DataType::Int64, false),
        ]))
    }

    #[tokio::test]
    async fn test_topk_sort_returns_sorted_rows() {
        let schema = test_schema();
        let batches = vec![
            Ok(test_batch(schema.clone())),
            Ok(test_batch(schema.clone())),
        ];
        let mut stream = topk_stream(schema, batches, "count");

        let mut rows = Vec::new();
        while let Some(result) = stream.next().await {
            let batch = result.unwrap();
            let counts = batch
                .column(1)
                .as_any()
                .downcast_ref::<Int64Array>()
                .unwrap();
            rows.extend(counts.iter().flatten());
        }
        assert_eq!(rows, vec![3, 3, 2, 2, 1, 1]);
    }

    #[tokio::test]
    async fn test_input_error_is_propagated() {
        let schema = test_schema();
        let input = vec![
            Ok(test_batch(schema.clone())),
            Err(DataFusionError::Execution("cast failed".to_string())),
        ];
        let err = first_error(topk_stream(schema, input, "count")).await;
        assert!(err.unwrap().to_string().contains("cast failed"));
    }

    #[tokio::test]
    async fn test_sort_failure_is_propagated() {
        let schema = test_schema();
        let input = vec![Ok(test_batch(schema.clone()))];
        let err = first_error(topk_stream(schema, input, "missing")).await;
        assert!(err.is_some());
    }
}
