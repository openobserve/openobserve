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
    cmp::Ordering,
    collections::{BinaryHeap, HashMap},
    fmt::Debug,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};

use arrow::{
    array::{ArrayRef, RecordBatch},
    compute::{SortOptions, interleave_record_batch},
    datatypes::SchemaRef,
    row::{RowConverter, SortField},
};
use datafusion::{
    common::Result,
    execution::{RecordBatchStream, SendableRecordBatchStream},
};
use futures::{Stream, StreamExt};

pub struct TopKHeapStream {
    schema: SchemaRef,
    stream: SendableRecordBatchStream,
    limit: usize,
    topk_heap: BinaryHeap<HeapRow>,
    record_batch_registry: RecordBatchRegistry,
    sort_column_index: usize,
    row_converter: RowConverter,
}

struct RecordBatchRegistry {
    store: HashMap<u32, RecordBatchEntry>,
    next_id: u32,
}

impl RecordBatchRegistry {
    pub fn new() -> Self {
        Self {
            store: HashMap::new(),
            next_id: 0,
        }
    }

    pub fn register_entry(&mut self, rb: RecordBatch) -> RecordBatchEntry {
        let id = self.next_id;
        let record_batch_entry = RecordBatchEntry::new(id, rb);
        self.next_id += 1;
        record_batch_entry
    }

    pub fn submit_entry(&mut self, entry: RecordBatchEntry) {
        if entry.uses > 0 {
            self.store.insert(entry.id, entry);
        }
    }

    pub fn remove_use_from_entry(&mut self, id: u32) {
        if let Some(entry) = self.store.get_mut(&id) {
            let Some(uses) = entry.uses.checked_sub(1) else {
                panic!("underflow of uses for batch {id}");
            };

            if uses == 0 {
                // remove the record batch from the registry
                self.store.remove(&id).expect("cannot remove batch {id}");
            }
        } else {
            panic!("entry does not exists batch {id}");
        }
    }
}

struct RecordBatchEntry {
    id: u32,
    record_batch: RecordBatch,
    uses: usize,
}

impl RecordBatchEntry {
    pub fn new(id: u32, record_batch: RecordBatch) -> Self {
        Self {
            id,
            record_batch,
            uses: 0,
        }
    }
}

#[derive(Debug, Clone)]
struct HeapRow {
    sort_value: Vec<u8>,
    row_id: usize,
    batch_id: u32,
}

impl HeapRow {
    fn with_new_row(mut self, new_row_bytes: &[u8], row_id: usize, batch_id: u32) -> Self {
        self.sort_value.clear();
        self.sort_value.extend_from_slice(new_row_bytes);
        self.row_id = row_id;
        self.batch_id = batch_id;
        self
    }
}

impl PartialEq for HeapRow {
    fn eq(&self, other: &Self) -> bool {
        self.sort_value == other.sort_value
    }
}

impl Eq for HeapRow {}

impl PartialOrd for HeapRow {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for HeapRow {
    fn cmp(&self, other: &Self) -> Ordering {
        // For min-heap behavior to get top-K largest values
        // We want smallest values at the top of the heap so we can pop them
        // RowConverter produces lexicographically sortable byte arrays
        self.sort_value.cmp(&other.sort_value)
    }
}

impl TopKHeapStream {
    pub fn new(
        schema: SchemaRef,
        stream: SendableRecordBatchStream,
        sort_field: String,
        descending: bool,
        limit: usize,
    ) -> Self {
        // Find the index of the sort column
        // also handle cases where the sort fields are not alias and can be names as count(*)[count]
        let sort_column_index = schema
            .fields()
            .iter()
            .position(|f| {
                f.name() == &sort_field || f.name().split('[').next().unwrap_or("") == sort_field
            })
            .expect("Sort field not found in schema");

        // Create RowConverter for the sort column with proper sort options
        let sort_field_ref = &schema.fields()[sort_column_index];
        let sort_options = if descending {
            SortOptions::default().desc()
        } else {
            SortOptions::default().asc()
        };
        let sort_field =
            SortField::new_with_options(sort_field_ref.data_type().clone(), sort_options);
        let row_converter =
            RowConverter::new(vec![sort_field]).expect("Failed to create RowConverter");

        Self {
            schema,
            stream,
            limit,
            record_batch_registry: RecordBatchRegistry::new(),
            topk_heap: BinaryHeap::new(),
            sort_column_index,
            row_converter,
        }
    }

    fn convert_sort_column(&mut self, array: &ArrayRef) -> arrow::row::Rows {
        // Direct conversion - simpler and avoids persistent memory
        self.row_converter
            .convert_columns(std::slice::from_ref(array))
            .expect("Failed to convert column")
    }

    fn process_batch(&mut self, batch: RecordBatch) {
        if batch.num_rows() == 0 {
            return;
        }

        let sort_column = batch.column(self.sort_column_index);
        let mut entry = self.record_batch_registry.register_entry(batch.clone());

        // Convert all sort values at once - gets cleaned up automatically
        let converted_rows = self.convert_sort_column(sort_column);
        for row_index in 0..batch.num_rows() {
            // Get row from converted batch
            let row_ref = converted_rows.row(row_index);

            if self.topk_heap.len() < self.limit {
                // Heap not full - create new row
                let new_row = HeapRow {
                    sort_value: row_ref.as_ref().to_vec(),
                    row_id: row_index,
                    batch_id: entry.id,
                };
                entry.uses += 1;
                self.topk_heap.push(new_row);
            } else if let Some(heap_top) = self.topk_heap.peek() {
                let should_replace =
                    row_ref.as_ref().cmp(heap_top.sort_value.as_slice()) == Ordering::Less;
                if should_replace {
                    let popped_row = self.topk_heap.pop().unwrap();
                    // Update batch tracking
                    if popped_row.batch_id.ne(&entry.id) {
                        entry.uses += 1;
                        self.record_batch_registry
                            .remove_use_from_entry(popped_row.batch_id);
                    }
                    // Reuse the Vec<u8> memory - this is the key optimization
                    let reused_row = popped_row.with_new_row(row_ref.as_ref(), row_index, entry.id);
                    self.topk_heap.push(reused_row);
                }
            }
        }

        self.record_batch_registry.submit_entry(entry);
    }

    fn heap_to_record_batch(&mut self) -> Option<RecordBatch> {
        if self.topk_heap.is_empty() {
            return None;
        }

        // Convert heap to sorted vec
        // Since the heap is already having elements which are bit flipped in row converter
        // we do not need to resort the final results outside.
        let sorted_rows = std::mem::take(&mut self.topk_heap).into_sorted_vec();

        let mut record_batches = Vec::new();
        let mut batch_id_array_pos = HashMap::new();
        for (batch_pos, (batch_id, batch)) in self.record_batch_registry.store.iter().enumerate() {
            record_batches.push(&batch.record_batch);
            batch_id_array_pos.insert(*batch_id, batch_pos);
        }

        let indices: Vec<_> = sorted_rows
            .iter()
            .map(|row| (batch_id_array_pos[&row.batch_id], row.row_id))
            .collect();

        let final_batch = interleave_record_batch(&record_batches, &indices)
            .map_err(|_| log::error!("Failed to interleave_record_batch"))
            .ok()?;
        Some(final_batch)
    }
}

impl Stream for TopKHeapStream {
    type Item = Result<RecordBatch>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match self.stream.poll_next_unpin(cx) {
            Poll::Ready(Some(Ok(batch))) => {
                // Process the batch incrementally with heap
                self.process_batch(batch);

                // Return empty batch to indicate progress
                let schema = self.schema.clone();
                let empty_batch = RecordBatch::new_empty(schema);
                Poll::Ready(Some(Ok(empty_batch)))
            }
            Poll::Ready(None) => {
                // Stream is finished, return final top-K result
                let topk_batch = self.heap_to_record_batch();
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

impl RecordBatchStream for TopKHeapStream {
    /// Get the schema
    fn schema(&self) -> SchemaRef {
        Arc::clone(&self.schema)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{Array, Int64Array, StringArray},
        datatypes::{Field, Schema},
        util::pretty::pretty_format_batches,
    };

    use super::*;

    struct TestRecordBatchStream {
        schema: SchemaRef,
        batches: Vec<RecordBatch>,
        index: usize,
    }

    impl TestRecordBatchStream {
        fn new(schema: SchemaRef, batches: Vec<RecordBatch>) -> Self {
            Self {
                schema,
                batches,
                index: 0,
            }
        }
    }

    impl Stream for TestRecordBatchStream {
        type Item = Result<RecordBatch>;

        fn poll_next(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Option<Self::Item>> {
            if self.index < self.batches.len() {
                let batch = self.batches[self.index].clone();
                self.index += 1;
                Poll::Ready(Some(Ok(batch)))
            } else {
                Poll::Ready(None)
            }
        }
    }

    impl RecordBatchStream for TestRecordBatchStream {
        fn schema(&self) -> SchemaRef {
            self.schema.clone()
        }
    }

    #[tokio::test]
    async fn test_cache_topk_stream_descending() {
        // Create schema with name and count columns
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", arrow::datatypes::DataType::Utf8, false),
            Field::new("count", arrow::datatypes::DataType::Int64, false),
        ]));

        // Create test data with multiple batches
        let batch1 = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![
                    "item1", "item7", "item8", "item6", "item2", "item3",
                ])),
                Arc::new(Int64Array::from(vec![10, 12, 13, 24, 25, 15])),
            ],
        )
        .unwrap();

        let batch2 = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["item4", "item5"])),
                Arc::new(Int64Array::from(vec![5, 30])),
            ],
        )
        .unwrap();

        let test_stream = TestRecordBatchStream::new(schema.clone(), vec![batch1, batch2]);
        let stream: SendableRecordBatchStream = Box::pin(test_stream);

        // Create CacheTopkStream for top-3 descending by count
        let mut topk_stream = TopKHeapStream::new(
            schema.clone(),
            stream,
            "count".to_string(),
            true, // descending
            5,    // limit
        );

        let mut results = Vec::new();
        while let Some(result) = topk_stream.next().await {
            match result {
                Ok(batch) => {
                    if batch.num_rows() > 0 {
                        results.push(batch);
                    }
                }
                Err(e) => panic!("Stream error: {e}"),
            }
        }

        println!("{}", pretty_format_batches(&results).unwrap());

        // Should have one final result batch with top-3 items
        assert_eq!(results.len(), 1);
        let final_batch = &results[0];
        assert_eq!(final_batch.num_rows(), 5);
        // println!("{}", pretty_format_batches(&[final_batch.clone()]).unwrap());
        // Verify the results are in descending order: item5(30), item2(25), item3(15)
        let names = final_batch
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let counts = final_batch
            .column(1)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();

        assert_eq!(names.value(0), "item5");
        assert_eq!(counts.value(0), 30);
        assert_eq!(names.value(1), "item2");
        assert_eq!(counts.value(1), 25);
        assert_eq!(names.value(2), "item6");
        assert_eq!(counts.value(2), 24);
    }

    #[tokio::test]
    async fn test_cache_topk_stream_ascending() {
        // Create schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", arrow::datatypes::DataType::Utf8, false),
            Field::new("value", arrow::datatypes::DataType::Int64, false),
        ]));

        // Create test data
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["a", "b", "c", "d", "e"])),
                Arc::new(Int64Array::from(vec![50, 20, 80, 10, 30])),
            ],
        )
        .unwrap();

        let test_stream = TestRecordBatchStream::new(schema.clone(), vec![batch]);
        let stream: SendableRecordBatchStream = Box::pin(test_stream);

        // Create CacheTopkStream for top-3 ascending by value
        let mut topk_stream = TopKHeapStream::new(
            schema.clone(),
            stream,
            "value".to_string(),
            false, // ascending
            5,     // limit
        );

        let mut results = Vec::new();
        while let Some(result) = topk_stream.next().await {
            match result {
                Ok(batch) => {
                    if batch.num_rows() > 0 {
                        results.push(batch);
                    }
                }
                Err(e) => panic!("Stream error: {e}"),
            }
        }

        println!("{}", pretty_format_batches(&results).unwrap());
        // Should have one final result batch with top-3 smallest items
        assert_eq!(results.len(), 1);
        let final_batch = &results[0];
        assert_eq!(final_batch.num_rows(), 5);
        // println!("{}", pretty_format_batches(&[final_batch.clone()]).unwrap());

        // Verify the results are in ascending order: d(10), b(20), e(30)
        let names = final_batch
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let values = final_batch
            .column(1)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();

        assert_eq!(names.value(0), "d");
        assert_eq!(values.value(0), 10);
        assert_eq!(names.value(1), "b");
        assert_eq!(values.value(1), 20);
        assert_eq!(names.value(2), "e");
        assert_eq!(values.value(2), 30);
    }

    #[tokio::test]
    async fn test_cache_topk_stream_limit() {
        // Create schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", arrow::datatypes::DataType::Utf8, false),
            Field::new("score", arrow::datatypes::DataType::Int64, false),
        ]));

        // Create test data with more items than limit
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![
                    "id1", "id2", "id3", "id4", "id5", "id6",
                ])),
                Arc::new(Int64Array::from(vec![100, 200, 50, 300, 150, 75])),
            ],
        )
        .unwrap();

        let test_stream = TestRecordBatchStream::new(schema.clone(), vec![batch]);
        let stream: SendableRecordBatchStream = Box::pin(test_stream);

        // Create CacheTopkStream for top-2 descending by score
        let mut topk_stream = TopKHeapStream::new(
            schema.clone(),
            stream,
            "score".to_string(),
            true, // descending
            2,    // limit to 2
        );

        let mut results = Vec::new();
        while let Some(result) = topk_stream.next().await {
            match result {
                Ok(batch) => {
                    if batch.num_rows() > 0 {
                        results.push(batch);
                    }
                }
                Err(e) => panic!("Stream error: {e}"),
            }
        }

        println!("{}", pretty_format_batches(&results).unwrap());
        // println!("{}", pretty_format_batches(&results).unwrap());
        // Should have one final result batch with top-2 items only
        assert_eq!(results.len(), 1);
        let final_batch = &results[0];
        // the final batch rows can never be less than the limit when
        // enough data is present
        assert!(final_batch.num_rows() >= 2);

        // Verify the results are the top-2: id4(300), id2(200)
        let ids = final_batch
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let scores = final_batch
            .column(1)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();

        assert_eq!(ids.value(0), "id4");
        assert_eq!(scores.value(0), 300);
        assert_eq!(ids.value(1), "id2");
        assert_eq!(scores.value(1), 200);
    }

    #[tokio::test]
    async fn test_complex_schema_final_row_construction() {
        use arrow::array::{BooleanArray, Float32Array, Int32Array, TimestampMillisecondArray};

        // Test with a very complex schema including different data types
        let schema = Arc::new(Schema::new(vec![
            Field::new("user_name", arrow::datatypes::DataType::Utf8, false),
            Field::new("is_premium", arrow::datatypes::DataType::Boolean, false),
            Field::new("score", arrow::datatypes::DataType::Float32, false),
            Field::new("rank", arrow::datatypes::DataType::Int64, false),
            Field::new("session_id", arrow::datatypes::DataType::Int32, false),
            Field::new(
                "timestamp",
                arrow::datatypes::DataType::Timestamp(
                    arrow::datatypes::TimeUnit::Millisecond,
                    None,
                ),
                false,
            ),
            Field::new("region", arrow::datatypes::DataType::Utf8, true),
        ]));

        // Create batches with mixed data types
        let batch1 = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["alice", "bob", "carol"])),
                Arc::new(BooleanArray::from(vec![true, false, true])),
                Arc::new(Float32Array::from(vec![75.5, 67.2, 82.1])),
                Arc::new(Int64Array::from(vec![10, 20, 15])),
                Arc::new(Int32Array::from(vec![1001, 1002, 1003])),
                Arc::new(TimestampMillisecondArray::from(vec![
                    1000000, 2000000, 1500000,
                ])),
                Arc::new(StringArray::from(vec![Some("US"), Some("EU"), None])),
            ],
        )
        .unwrap();

        let batch2 = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["diana", "eve"])),
                Arc::new(BooleanArray::from(vec![true, false])),
                Arc::new(Float32Array::from(vec![95.7, 88.3])),
                Arc::new(Int64Array::from(vec![5, 8])),
                Arc::new(Int32Array::from(vec![1004, 1005])),
                Arc::new(TimestampMillisecondArray::from(vec![3000000, 2500000])),
                Arc::new(StringArray::from(vec![Some("APAC"), Some("US")])),
            ],
        )
        .unwrap();

        let test_stream = TestRecordBatchStream::new(schema.clone(), vec![batch1, batch2]);
        let stream: SendableRecordBatchStream = Box::pin(test_stream);

        let mut topk_stream = TopKHeapStream::new(
            schema.clone(),
            stream,
            "score".to_string(),
            true, // descending
            5,    // all 5 rows
        );

        let mut results = Vec::new();
        while let Some(result) = topk_stream.next().await {
            match result {
                Ok(batch) => {
                    if batch.num_rows() > 0 {
                        results.push(batch);
                    }
                }
                Err(e) => panic!("Stream error: {e}"),
            }
        }

        assert_eq!(results.len(), 1);
        let final_batch = &results[0];
        assert_eq!(final_batch.num_rows(), 5);
        assert_eq!(final_batch.num_columns(), 7);

        // Verify all data types are preserved correctly
        // Expected order: diana(95.7), eve(88.3), carol(82.1), alice(75.5), bob(67.2)
        let user_names = final_batch
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let is_premium = final_batch
            .column(1)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        let scores = final_batch
            .column(2)
            .as_any()
            .downcast_ref::<Float32Array>()
            .unwrap();
        let ranks = final_batch
            .column(3)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        let session_ids = final_batch
            .column(4)
            .as_any()
            .downcast_ref::<Int32Array>()
            .unwrap();
        let timestamps = final_batch
            .column(5)
            .as_any()
            .downcast_ref::<TimestampMillisecondArray>()
            .unwrap();
        let regions = final_batch
            .column(6)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();

        // First row: diana (highest score)
        assert_eq!(user_names.value(0), "diana");
        assert!(is_premium.value(0));
        assert!((scores.value(0) - 95.7).abs() < f32::EPSILON);
        assert_eq!(ranks.value(0), 5);
        assert_eq!(session_ids.value(0), 1004);
        assert_eq!(timestamps.value(0), 3000000);
        assert_eq!(regions.value(0), "APAC");

        // Second row: eve
        assert_eq!(user_names.value(1), "eve");
        assert!(!is_premium.value(1));
        assert!((scores.value(1) - 88.3).abs() < f32::EPSILON);
        assert_eq!(ranks.value(1), 8);
        assert_eq!(session_ids.value(1), 1005);
        assert_eq!(timestamps.value(1), 2500000);
        assert_eq!(regions.value(1), "US");

        // Third row: carol
        assert_eq!(user_names.value(2), "carol");
        assert!(is_premium.value(2));
        assert!((scores.value(2) - 82.1).abs() < f32::EPSILON);
        assert_eq!(ranks.value(2), 15);
        assert_eq!(session_ids.value(2), 1003);
        assert_eq!(timestamps.value(2), 1500000);
        assert!(regions.is_null(2));

        println!("{}", pretty_format_batches(&results).unwrap());
    }

    #[tokio::test]
    async fn test_many_batches_force_eviction() {
        // Test with many batches where we have more batches than the limit
        // This forces the registry to manage entries across different batches
        let schema = Arc::new(Schema::new(vec![
            Field::new("batch_name", arrow::datatypes::DataType::Utf8, false),
            Field::new("value", arrow::datatypes::DataType::Int64, false),
        ]));

        // Create 6 batches, each with 1 row, but limit to only 3 results
        let mut batches = Vec::new();
        let values = [10, 50, 20, 80, 30, 90]; // 90, 80, 50 should be top 3
        //
        for (i, &value) in values.iter().enumerate() {
            let batch = RecordBatch::try_new(
                schema.clone(),
                vec![
                    Arc::new(StringArray::from(vec![format!("batch_{}", i)])),
                    Arc::new(Int64Array::from(vec![value])),
                ],
            )
            .unwrap();
            batches.push(batch);
        }

        let test_stream = TestRecordBatchStream::new(schema.clone(), batches);
        let stream: SendableRecordBatchStream = Box::pin(test_stream);

        let mut topk_stream = TopKHeapStream::new(
            schema.clone(),
            stream,
            "value".to_string(),
            true, // descending
            3,    // limit to 3, but we have 6 batches
        );

        let mut results = Vec::new();
        while let Some(result) = topk_stream.next().await {
            match result {
                Ok(batch) => {
                    if batch.num_rows() > 0 {
                        results.push(batch);
                    }
                }
                Err(e) => panic!("Stream error: {e}"),
            }
        }

        assert_eq!(results.len(), 1);
        let final_batch = &results[0];
        assert_eq!(final_batch.num_rows(), 3);

        // Should be: batch_5(90), batch_3(80), batch_1(50)
        let names = final_batch
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let values = final_batch
            .column(1)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();

        assert_eq!(names.value(0), "batch_5");
        assert_eq!(values.value(0), 90);
        assert_eq!(names.value(1), "batch_3");
        assert_eq!(values.value(1), 80);
        assert_eq!(names.value(2), "batch_1");
        assert_eq!(values.value(2), 50);

        println!("{}", pretty_format_batches(&results).unwrap());
    }
}
