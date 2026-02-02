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

use std::sync::Arc;

use arrow::{
    array::{Array, ArrayRef, AsArray, RecordBatch, RecordBatchOptions, StringViewBuilder},
    ipc::{
        MessageHeader,
        writer::{CompressionContext, DictionaryTracker, IpcDataGenerator, IpcWriteOptions},
    },
};
use arrow_flight::{FlightData, SchemaAsIpc, error::Result};
use arrow_schema::Schema;
use bytes::Bytes;
use flatbuffers::FlatBufferBuilder;

use crate::common::CustomMessage;

/// Encoder for RecordBatch, Schema, CustomMessage to FlightData
pub struct FlightDataEncoder {
    options: IpcWriteOptions,
    data_gen: IpcDataGenerator,
    dictionary_tracker: DictionaryTracker,
    max_flight_data_size: usize,
    compression_context: CompressionContext,
}

impl FlightDataEncoder {
    pub fn new(options: IpcWriteOptions, max_flight_data_size: usize) -> Self {
        Self {
            options,
            data_gen: IpcDataGenerator::default(),
            dictionary_tracker: DictionaryTracker::new(false),
            max_flight_data_size,
            compression_context: CompressionContext::default(),
        }
    }

    /// Encode a schema as a FlightData
    pub fn encode_schema(&self, schema: &Schema) -> FlightData {
        SchemaAsIpc::new(schema, &self.options).into()
    }

    /// Encode a RecordBatch to a Vec of FlightData
    pub fn encode_batch(&mut self, batch: RecordBatch) -> Result<Vec<FlightData>> {
        // refer to:
        // https://github.com/openobserve/openobserve/issues/8280
        // https://github.com/apache/datafusion/pull/11587
        let batch = gc_string_view_batch(&batch);

        let mut flight_data = Vec::new();
        for batch in split_batch_for_grpc_response(batch, self.max_flight_data_size) {
            let (encoded_dictionaries, encoded_batch) = self.data_gen.encode(
                &batch,
                &mut self.dictionary_tracker,
                &self.options,
                &mut self.compression_context,
            )?;

            flight_data.extend(encoded_dictionaries.into_iter().map(Into::into));
            flight_data.push(encoded_batch.into());
        }

        Ok(flight_data)
    }

    /// Encode a CustomMessage to a FlightData
    pub fn encode_custom(&mut self, custom_message: &CustomMessage) -> Result<FlightData> {
        let metadata = serde_json::to_string(custom_message)
            .unwrap_or_default()
            .as_bytes()
            .to_vec();
        Ok(FlightData::new()
            .with_data_header(header_none())
            .with_app_metadata(metadata))
    }
}

pub fn header_none() -> Bytes {
    let mut builder: FlatBufferBuilder<'_> = FlatBufferBuilder::new();

    let mut message = arrow::ipc::MessageBuilder::new(&mut builder);
    message.add_version(arrow::ipc::MetadataVersion::V5);
    message.add_header_type(MessageHeader::NONE);
    message.add_bodyLength(0);

    let data = message.finish();
    builder.finish(data, None);

    builder.finished_data().to_vec().into()
}

fn split_batch_for_grpc_response(
    batch: RecordBatch,
    max_flight_data_size: usize,
) -> Vec<RecordBatch> {
    let size = batch
        .columns()
        .iter()
        .map(|col| col.get_buffer_memory_size())
        .sum::<usize>();

    let n_batches = (size / max_flight_data_size
        + usize::from(!size.is_multiple_of(max_flight_data_size)))
    .max(1);
    let rows_per_batch = (batch.num_rows() / n_batches).max(1);
    let mut out = Vec::with_capacity(n_batches + 1);

    let mut offset = 0;
    while offset < batch.num_rows() {
        let length = (rows_per_batch).min(batch.num_rows() - offset);
        out.push(batch.slice(offset, length));

        offset += length;
    }

    out
}

/// refer to: https://github.com/apache/datafusion/pull/11587
/// Heuristically compact `StringViewArray`s to reduce memory usage, if needed
///
/// Decides when to consolidate the StringView into a new buffer to reduce
/// memory usage and improve string locality for better performance.
///
/// This differs from `StringViewArray::gc` because:
/// 1. It may not compact the array depending on a heuristic.
/// 2. It uses a precise block size to reduce the number of buffers to track.
///
/// # Heuristic
///
/// If the average size of each view is larger than 32 bytes, we compact the array.
///
/// `StringViewArray` include pointers to buffer that hold the underlying data.
/// One of the great benefits of `StringViewArray` is that many operations
/// (e.g., `filter`) can be done without copying the underlying data.
///
/// However, after a while (e.g., after `FilterExec` or `HashJoinExec`) the
/// `StringViewArray` may only refer to a small portion of the buffer,
/// significantly increasing memory usage.
fn gc_string_view_batch(batch: &RecordBatch) -> RecordBatch {
    let new_columns: Vec<ArrayRef> = batch
        .columns()
        .iter()
        .map(|c| {
            // Try to re-create the `StringViewArray` to prevent holding the underlying buffer too
            // long.
            let Some(s) = c.as_string_view_opt() else {
                return Arc::clone(c);
            };

            // Fast path: if the data buffers are empty, we can return the original array
            if s.data_buffers().is_empty() {
                return Arc::clone(c);
            }

            let ideal_buffer_size: usize = s
                .views()
                .iter()
                .map(|v| {
                    let len = (*v as u32) as usize;
                    if len > 12 { len } else { 0 }
                })
                .sum();

            // We don't use get_buffer_memory_size here, because gc is for the contents of the
            // data buffers, not views and nulls.
            let actual_buffer_size = s.data_buffers().iter().map(|b| b.capacity()).sum::<usize>();

            // Re-creating the array copies data and can be time consuming.
            // We only do it if the array is sparse
            if actual_buffer_size > (ideal_buffer_size * 2) {
                // We set the block size to `ideal_buffer_size` so that the new StringViewArray only
                // has one buffer, which accelerate later concat_batches. See https://github.com/apache/arrow-rs/issues/6094 for more details.
                let mut builder = StringViewBuilder::with_capacity(s.len());
                if ideal_buffer_size > 0 {
                    builder = builder.with_fixed_block_size(ideal_buffer_size as u32);
                }

                for v in s.iter() {
                    builder.append_option(v);
                }

                let gc_string = builder.finish();

                debug_assert!(gc_string.data_buffers().len() <= 1); // buffer count can be 0 if the `ideal_buffer_size` is 0

                Arc::new(gc_string)
            } else {
                Arc::clone(c)
            }
        })
        .collect();
    let mut options = RecordBatchOptions::new();
    options = options.with_row_count(Some(batch.num_rows()));
    RecordBatch::try_new_with_options(batch.schema(), new_columns, &options)
        .expect("Failed to re-create the gc'ed record batch")
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{Int32Array, StringArray},
        ipc::writer::IpcWriteOptions,
    };
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::search::ScanStats;

    use super::*;
    use crate::common::CustomMessage;

    fn create_test_schema() -> Schema {
        Schema::new(vec![
            Field::new("id", DataType::Int32, false),
            Field::new("name", DataType::Utf8, true),
        ])
    }

    fn create_test_record_batch() -> RecordBatch {
        let schema = Arc::new(create_test_schema());
        let id_array = Arc::new(Int32Array::from(vec![1, 2, 3, 4, 5]));
        let name_array = Arc::new(StringArray::from(vec![
            Some("Alice"),
            Some("Bob"),
            None,
            Some("Charlie"),
            Some("Diana"),
        ]));

        RecordBatch::try_new(schema, vec![id_array, name_array]).unwrap()
    }

    fn create_test_custom_message() -> CustomMessage {
        let scan_stats = ScanStats {
            files: 10,
            records: 1000,
            original_size: 2048,
            compressed_size: 1024,
            querier_files: 5,
            querier_memory_cached_files: 2,
            querier_disk_cached_files: 3,
            idx_scan_size: 512,
            idx_took: 100,
            file_list_took: 50,
            aggs_cache_ratio: 80,
            peak_memory_usage: 1024000,
        };
        CustomMessage::ScanStats(scan_stats)
    }

    #[test]
    fn test_flight_data_encoder_new() {
        let options = IpcWriteOptions::default();
        let max_size = 8192;
        let encoder = FlightDataEncoder::new(options, max_size);
        assert_eq!(encoder.max_flight_data_size, max_size);
    }

    #[test]
    fn test_encode_schema() {
        let options = IpcWriteOptions::default();
        let encoder = FlightDataEncoder::new(options, 8192);
        let schema = create_test_schema();

        let flight_data = encoder.encode_schema(&schema);

        assert!(!flight_data.data_header.is_empty());
        // Schema flight data may not always have a data body, only header
        assert!(flight_data.app_metadata.is_empty());
    }

    #[test]
    fn test_encode_batch() {
        let options = IpcWriteOptions::default();
        let mut encoder = FlightDataEncoder::new(options, 8192);
        let batch = create_test_record_batch();

        let flight_data_vec = encoder.encode_batch(batch).unwrap();

        assert!(!flight_data_vec.is_empty());
        for flight_data in flight_data_vec {
            assert!(!flight_data.data_header.is_empty());
        }
    }

    #[test]
    fn test_encode_custom() {
        let options = IpcWriteOptions::default();
        let mut encoder = FlightDataEncoder::new(options, 8192);
        let custom_message = create_test_custom_message();

        let flight_data = encoder.encode_custom(&custom_message).unwrap();

        assert!(!flight_data.data_header.is_empty());
        assert!(!flight_data.app_metadata.is_empty());
        assert!(flight_data.data_body.is_empty());

        // Verify the custom message can be deserialized
        let deserialized: CustomMessage =
            serde_json::from_slice(&flight_data.app_metadata).unwrap();

        match deserialized {
            CustomMessage::ScanStats(stats) => {
                assert_eq!(stats.files, 10);
                assert_eq!(stats.records, 1000);
            }
            _ => panic!("Expected ScanStats variant"),
        }
    }

    #[test]
    fn test_header_none() {
        let header = header_none();

        assert!(!header.is_empty());
        // Verify it's a valid flatbuffer message
        let message = arrow::ipc::root_as_message(&header).unwrap();
        assert_eq!(message.header_type(), arrow::ipc::MessageHeader::NONE);
        assert_eq!(message.bodyLength(), 0);
    }

    #[test]
    fn test_split_batch_for_grpc_response_small_batch() {
        let batch = create_test_record_batch();
        let max_size = 1024 * 1024; // Large enough to not split

        let batches = split_batch_for_grpc_response(batch.clone(), max_size);

        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), batch.num_rows());
        assert_eq!(batches[0].num_columns(), batch.num_columns());
    }

    #[test]
    fn test_split_batch_for_grpc_response_large_batch() {
        let batch = create_test_record_batch();
        let max_size = 1; // Very small to force splitting

        let batches = split_batch_for_grpc_response(batch.clone(), max_size);

        assert!(batches.len() > 1);

        // Verify all rows are preserved
        let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();
        assert_eq!(total_rows, batch.num_rows());

        // Verify all batches have the same schema
        for split_batch in &batches {
            assert_eq!(split_batch.schema(), batch.schema());
        }
    }

    #[test]
    fn test_split_batch_for_grpc_response_empty_batch() {
        let schema = Arc::new(create_test_schema());
        let empty_id_array = Arc::new(Int32Array::from(Vec::<i32>::new()));
        let empty_name_array = Arc::new(StringArray::from(Vec::<Option<&str>>::new()));
        let empty_batch =
            RecordBatch::try_new(schema, vec![empty_id_array, empty_name_array]).unwrap();

        let batches = split_batch_for_grpc_response(empty_batch, 1024);

        // Empty batches return empty vector since the while loop condition (offset <
        // batch.num_rows()) is false when num_rows() is 0
        assert!(batches.is_empty());
    }

    #[test]
    fn test_split_batch_for_grpc_response_single_row() {
        let schema = Arc::new(create_test_schema());
        let id_array = Arc::new(Int32Array::from(vec![1]));
        let name_array = Arc::new(StringArray::from(vec![Some("Test")]));
        let single_row_batch = RecordBatch::try_new(schema, vec![id_array, name_array]).unwrap();

        let batches = split_batch_for_grpc_response(single_row_batch, 1);

        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].num_rows(), 1);
    }

    #[test]
    fn test_split_batch_calculates_correct_number_of_batches() {
        let batch = create_test_record_batch();
        let size = batch
            .columns()
            .iter()
            .map(|col| col.get_buffer_memory_size())
            .sum::<usize>();

        let max_size = size / 2; // Should create 2 batches
        let batches = split_batch_for_grpc_response(batch, max_size);

        // Should create at least 2 batches due to splitting
        assert!(batches.len() >= 2);
    }

    #[test]
    fn test_encode_custom_peak_memory() {
        let options = IpcWriteOptions::default();
        let mut encoder = FlightDataEncoder::new(options, 8192);
        let peak_memory = 1024 * 1024 * 100; // 100 MB
        let custom_message = CustomMessage::PeakMemory(peak_memory);

        let flight_data = encoder.encode_custom(&custom_message).unwrap();

        assert!(!flight_data.data_header.is_empty());
        assert!(!flight_data.app_metadata.is_empty());
        assert!(flight_data.data_body.is_empty());

        // Verify the custom message can be deserialized
        let deserialized: CustomMessage =
            serde_json::from_slice(&flight_data.app_metadata).unwrap();

        match deserialized {
            CustomMessage::PeakMemory(mem) => {
                assert_eq!(mem, peak_memory);
            }
            _ => panic!("Expected PeakMemory variant"),
        }
    }
}
