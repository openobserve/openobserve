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
use datafusion::{common::Result, execution::RecordBatchStream};
use futures::Stream;

use crate::cache::streaming_agg::get_record_batches;

pub(crate) struct CachedFileStream {
    id: String,
    cached_files: Vec<Arc<String>>,
    schema: SchemaRef,
    current_file_index: usize,
    current_batches: Vec<RecordBatch>,
    current_batch_index: usize,
    is_exhausted: bool,
}

impl CachedFileStream {
    pub(crate) fn new(id: String, cached_files: Vec<Arc<String>>, schema: SchemaRef) -> Self {
        Self {
            id,
            cached_files,
            schema,
            current_file_index: 0,
            current_batches: Vec::new(),
            current_batch_index: 0,
            is_exhausted: false,
        }
    }

    pub(crate) fn load_next_file(&mut self) -> Result<()> {
        loop {
            if self.current_file_index >= self.cached_files.len() {
                self.is_exhausted = true;
                return Ok(());
            }

            let file_path = &self.cached_files[self.current_file_index];
            let batches = match get_record_batches(&self.id, file_path, self.schema.clone()) {
                Ok(batches) => batches,
                Err(e) => {
                    log::error!(
                        "[StreamingAggs streaming_id: {}] Error reading cached file: {file_path}, error: {e:?}",
                        self.id,
                    );
                    return Err(e.into());
                }
            };

            log::debug!(
                "[StreamingAggs streaming_id: {}] Successfully read {} batches from cached file: {file_path}",
                self.id,
                batches.len(),
            );

            self.current_batches = batches;
            self.current_batch_index = 0;
            self.current_file_index += 1;

            if self.current_batches.is_empty() {
                continue;
            }

            break;
        }
        Ok(())
    }
}

impl Stream for CachedFileStream {
    type Item = Result<RecordBatch>;

    fn poll_next(mut self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        if self.is_exhausted {
            return Poll::Ready(None);
        }

        // If we don't have current batches or we've exhausted them, load next file
        if self.current_batches.is_empty() || self.current_batch_index >= self.current_batches.len()
        {
            if let Err(e) = self.load_next_file() {
                return Poll::Ready(Some(Err(e)));
            }

            if self.is_exhausted {
                return Poll::Ready(None);
            }
        }

        // Return the next batch if available
        if self.current_batch_index < self.current_batches.len() {
            let batch = self.current_batches[self.current_batch_index].clone();
            self.current_batch_index += 1;
            Poll::Ready(Some(Ok(batch)))
        } else {
            Poll::Ready(None)
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (0, None)
    }
}

impl RecordBatchStream for CachedFileStream {
    fn schema(&self) -> SchemaRef {
        Arc::clone(&self.schema)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::datatypes::{DataType, Field, Schema};

    use super::*;

    #[test]
    fn test_cached_file_stream_new() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "col1",
            DataType::Int64,
            false,
        )]));

        let cached_files = vec![
            Arc::new("file1.arrow".to_string()),
            Arc::new("file2.arrow".to_string()),
        ];

        let stream = CachedFileStream::new(
            "test_cached_stream".to_string(),
            cached_files.clone(),
            schema.clone(),
        );

        assert_eq!(stream.id, "test_cached_stream");
        assert_eq!(stream.cached_files.len(), 2);
        assert_eq!(stream.current_file_index, 0);
    }
}
