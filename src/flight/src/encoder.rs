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

use arrow::{
    array::RecordBatch,
    compute::BatchCoalescer,
    datatypes::DataType,
    ipc::{
        MessageHeader,
        writer::{CompressionContext, DictionaryTracker, IpcDataGenerator, IpcWriteOptions},
    },
};
use arrow_flight::{FlightData, error::Result};
use bytes::Bytes;
use flatbuffers::FlatBufferBuilder;

use crate::common::CustomMessage;

/// Encodes CustomMessages and RecordBatch chunks into FlightData (coalescing is separate — see
/// [`ChunkCoalescer`]). Owns the zstd compressor, so it's not `Clone`: use one per thread.
pub struct FlightDataEncoder {
    options: IpcWriteOptions,
    /// Maximum bytes per FlightData message (0 = unlimited).
    max_flight_data_size: usize,
    /// Reused across chunks; lazily initialised, so a custom-message-only encoder never allocates
    /// it.
    compression_context: CompressionContext,
    /// Whether the chunk schema contains any Dictionary column
    schema_has_dict: Option<bool>,
}

impl FlightDataEncoder {
    pub fn new(options: IpcWriteOptions, max_flight_data_size: usize) -> Self {
        Self {
            options,
            max_flight_data_size,
            compression_context: CompressionContext::default(),
            schema_has_dict: None,
        }
    }

    /// Encode a CustomMessage to a FlightData
    pub fn encode_custom(&self, custom_message: &CustomMessage) -> Result<FlightData> {
        let metadata = serde_json::to_string(custom_message)
            .unwrap_or_default()
            .as_bytes()
            .to_vec();
        Ok(FlightData::new()
            .with_data_header(header_none())
            .with_app_metadata(metadata))
    }

    /// Encode one chunk into FlightData message(s): split by `max_flight_data_size`, then IPC +
    /// ZSTD.
    ///
    /// Uses a fresh [`DictionaryTracker`] so each chunk re-sends its dictionaries; chunks from
    /// different partitions can interleave while sharing the same dict ids.
    pub fn encode_chunk(&mut self, chunk: RecordBatch) -> Result<Vec<FlightData>> {
        let data_gen = IpcDataGenerator::default();
        let mut dictionary_tracker = DictionaryTracker::new(false);
        let schema = chunk.schema();
        let has_dict = *self.schema_has_dict.get_or_insert_with(|| {
            schema
                .fields()
                .iter()
                .any(|f| dtype_has_dictionary(f.data_type()))
        });
        if has_dict {
            // Seed dict ids for `encode()`; the schema bytes are unused.
            let _ = data_gen.schema_to_bytes_with_dictionary_tracker(
                &schema,
                &mut dictionary_tracker,
                &self.options,
            );
        }
        let mut flight_data = Vec::new();
        for batch in split_batch_for_grpc_response(chunk, self.max_flight_data_size) {
            let (encoded_dictionaries, encoded_batch) = data_gen.encode(
                &batch,
                &mut dictionary_tracker,
                &self.options,
                &mut self.compression_context,
            )?;
            flight_data.extend(encoded_dictionaries.into_iter().map(Into::into));
            flight_data.push(encoded_batch.into());
        }
        Ok(flight_data)
    }
}

/// True if the type contains a Dictionary, including nested fields.
fn dtype_has_dictionary(dt: &DataType) -> bool {
    match dt {
        DataType::Dictionary(..) => true,
        DataType::List(f)
        | DataType::LargeList(f)
        | DataType::ListView(f)
        | DataType::LargeListView(f)
        | DataType::FixedSizeList(f, _)
        | DataType::Map(f, _)
        | DataType::RunEndEncoded(_, f) => dtype_has_dictionary(f.data_type()),
        DataType::Struct(fields) => fields.iter().any(|f| dtype_has_dictionary(f.data_type())),
        DataType::Union(fields, _) => fields
            .iter()
            .any(|(_, f)| dtype_has_dictionary(f.data_type())),
        _ => false,
    }
}

/// Coalesces RecordBatches into 8192-row chunks (the expensive per-chunk IPC + ZSTD encoding is
/// [`FlightDataEncoder::encode_chunk`]).
#[derive(Default)]
pub struct ChunkCoalescer {
    /// Lazily initialised; reused to avoid re-allocating per-column builders every call.
    coalescer: Option<BatchCoalescer>,
}

impl ChunkCoalescer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Push a RecordBatch; returns completed 8192-row chunks. Call [`Self::finish`] at stream end.
    ///
    /// BatchCoalescer also GCs sparse Utf8View/BinaryView buffers — see
    /// <https://github.com/openobserve/openobserve/issues/8280> and
    /// <https://github.com/apache/datafusion/pull/11587>.
    pub fn push_batch(&mut self, batch: RecordBatch) -> Result<Vec<RecordBatch>> {
        if self.coalescer.is_none() {
            self.coalescer = Some(BatchCoalescer::new(batch.schema(), 8192));
        }

        let coalescer = self.coalescer.as_mut().unwrap();
        coalescer.push_batch(batch)?;

        self.drain_completed()
    }

    /// Flush any buffered rows as a final chunk, once all batches have been pushed.
    pub fn finish(&mut self) -> Result<Vec<RecordBatch>> {
        let Some(coalescer) = self.coalescer.as_mut() else {
            return Ok(vec![]);
        };
        coalescer.finish_buffered_batch()?;
        self.drain_completed()
    }

    fn drain_completed(&mut self) -> Result<Vec<RecordBatch>> {
        let Some(coalescer) = self.coalescer.as_mut() else {
            return Ok(vec![]);
        };
        let mut chunks = Vec::new();
        while let Some(batch) = coalescer.next_completed_batch() {
            chunks.push(batch);
        }
        Ok(chunks)
    }
}

fn split_batch_for_grpc_response(
    batch: RecordBatch,
    max_flight_data_size: usize,
) -> Vec<RecordBatch> {
    if max_flight_data_size == 0 {
        return vec![batch];
    }

    let size = batch
        .columns()
        .iter()
        .map(|col| {
            col.to_data()
                .get_slice_memory_size()
                .unwrap_or_else(|_| col.get_buffer_memory_size())
        })
        .sum::<usize>();

    let n_batches = (size / max_flight_data_size
        + usize::from(!size.is_multiple_of(max_flight_data_size)))
    .max(1);
    let rows_per_batch = (batch.num_rows() / n_batches).max(1);
    let mut out = Vec::with_capacity(n_batches + 1);

    let mut offset = 0;
    while offset < batch.num_rows() {
        let length = rows_per_batch.min(batch.num_rows() - offset);
        out.push(batch.slice(offset, length));
        offset += length;
    }

    out
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{
            ArrayRef, BinaryArray, Int32Array, ListArray, StringArray, StringViewArray, StructArray,
        },
        buffer::OffsetBuffer,
        ipc::writer::IpcWriteOptions,
    };
    use arrow_schema::{DataType, Field, Fields, Schema};
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
            wait_in_queue: 0,
        };
        CustomMessage::ScanStats(scan_stats)
    }

    /// Encode coalesced chunks; dictionary handling matches the production path.
    fn encode_all(
        options: &IpcWriteOptions,
        max_flight_data_size: usize,
        chunks: Vec<RecordBatch>,
    ) -> Vec<arrow_flight::FlightData> {
        chunks
            .into_iter()
            .flat_map(|c| {
                FlightDataEncoder::new(options.clone(), max_flight_data_size)
                    .encode_chunk(c)
                    .unwrap()
            })
            .collect()
    }

    /// Decode FlightData messages back to RecordBatches, mirroring FlightDataDecoder's
    /// per-message dictionary handling (read each dictionary batch into a shared map).
    fn decode_all(
        fds: Vec<arrow_flight::FlightData>,
        schema: arrow_schema::SchemaRef,
    ) -> Vec<RecordBatch> {
        use std::collections::HashMap;

        use arrow::{
            buffer::Buffer,
            ipc::{MessageHeader, reader::read_dictionary, root_as_message},
        };

        let mut dictionaries: HashMap<i64, ArrayRef> = HashMap::new();
        let mut out = Vec::new();
        for data in fds {
            let message = root_as_message(&data.data_header[..]).unwrap();
            match message.header_type() {
                MessageHeader::DictionaryBatch => {
                    let buffer = Buffer::from(data.data_body.as_ref());
                    let dict_batch = message.header_as_dictionary_batch().unwrap();
                    read_dictionary(
                        &buffer,
                        dict_batch,
                        &schema,
                        &mut dictionaries,
                        &message.version(),
                    )
                    .unwrap();
                }
                MessageHeader::RecordBatch => {
                    out.push(
                        arrow_flight::utils::flight_data_to_arrow_batch(
                            &data,
                            schema.clone(),
                            &dictionaries,
                        )
                        .unwrap(),
                    );
                }
                _ => {}
            }
        }
        out
    }

    // The crux of the parallel-encode design: each chunk is encoded independently with
    // its OWN dictionary tracker, so a dictionary column emits a full dictionary per
    // chunk. Verify the sequential decoder still reconstructs every row correctly.
    #[test]
    fn test_parallel_chunks_roundtrip_with_dictionary() {
        use arrow::array::{DictionaryArray, Int32Array, types::Int32Type};

        let n = 20_000i32;
        let values: ArrayRef = Arc::new(StringArray::from(vec!["red", "green", "blue"]));
        let keys = Int32Array::from((0..n).map(|i| i % 3).collect::<Vec<_>>());
        let color = DictionaryArray::<Int32Type>::try_new(keys, values).unwrap();
        let id = Int32Array::from((0..n).collect::<Vec<_>>());

        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int32, false),
            Field::new(
                "color",
                DataType::Dictionary(Box::new(DataType::Int32), Box::new(DataType::Utf8)),
                false,
            ),
        ]));
        let batch =
            RecordBatch::try_new(schema.clone(), vec![Arc::new(id), Arc::new(color)]).unwrap();

        let options = IpcWriteOptions::default()
            .try_with_compression(Some(arrow::ipc::CompressionType::ZSTD))
            .unwrap();
        let mut coalescer = ChunkCoalescer::new();
        // coalescer emits 8192-row chunks -> multiple chunks for 20000 rows
        let mut chunks = coalescer.push_batch(batch).unwrap();
        chunks.extend(coalescer.finish().unwrap());
        assert!(
            chunks.len() >= 2,
            "expected multiple chunks, got {}",
            chunks.len()
        );

        // encode each chunk INDEPENDENTLY, exactly as the parallel pipeline does
        let fds = encode_all(&options, 0, chunks);
        let decoded = decode_all(fds, schema);

        let total_rows: usize = decoded.iter().map(|b| b.num_rows()).sum();
        assert_eq!(
            total_rows, n as usize,
            "all rows must survive per-chunk dictionaries"
        );

        // row 0: id 0, color key 0 -> "red"
        let first = &decoded[0];
        let color0 = first
            .column(1)
            .as_any()
            .downcast_ref::<DictionaryArray<Int32Type>>()
            .unwrap();
        let dict_values = color0
            .values()
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(dict_values.value(color0.keys().value(0) as usize), "red");
    }

    #[test]
    fn test_flight_data_encoder_new() {
        let options = IpcWriteOptions::default();
        let encoder = FlightDataEncoder::new(options, 8192);
        assert_eq!(encoder.max_flight_data_size, 8192);
    }

    #[test]
    fn test_chunk_coalescer_new() {
        let coalescer = ChunkCoalescer::new();
        assert!(coalescer.coalescer.is_none());
    }

    #[test]
    fn test_dtype_has_dictionary_nested() {
        let dict = DataType::Dictionary(Box::new(DataType::Int32), Box::new(DataType::Utf8));
        assert!(dtype_has_dictionary(&dict));

        // dictionary nested inside struct > list must be found
        let nested = DataType::Struct(Fields::from(vec![Field::new(
            "inner",
            DataType::List(Arc::new(Field::new("item", dict, true))),
            true,
        )]));
        assert!(dtype_has_dictionary(&nested));

        assert!(!dtype_has_dictionary(&DataType::Utf8));
        assert!(!dtype_has_dictionary(&DataType::Struct(Fields::from(
            vec![Field::new("s", DataType::Utf8, true),]
        ))));
    }

    #[test]
    fn test_encode_batch() {
        let options = IpcWriteOptions::default();
        let mut coalescer = ChunkCoalescer::new();
        let batch = create_test_record_batch();

        // push_batch accumulates; a chunk is only emitted once a full 8192 rows are
        // ready or finish() is called at stream end.
        let mut chunks = coalescer.push_batch(batch).unwrap();
        chunks.extend(coalescer.finish().unwrap());
        let flight_data_vec = encode_all(&options, 8192, chunks);

        assert!(!flight_data_vec.is_empty());
        for flight_data in flight_data_vec {
            assert!(!flight_data.data_header.is_empty());
        }
    }

    #[test]
    fn test_encode_custom() {
        let options = IpcWriteOptions::default();
        let encoder = FlightDataEncoder::new(options, 8192);
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
    fn test_encode_batch_coalesces() {
        let options = IpcWriteOptions::default();
        let mut coalescer = ChunkCoalescer::new();
        let schema = Arc::new(Schema::new(vec![Field::new("id", DataType::Int32, false)]));
        // 10000 rows: BatchCoalescer emits one 8192-row chunk during push_batch,
        // then finish() flushes the remaining 1808 rows → total 2 messages
        let ids: Vec<i32> = (0..10000).collect();
        let batch =
            arrow::array::RecordBatch::try_new(schema, vec![Arc::new(Int32Array::from(ids))])
                .unwrap();

        let mut chunks = coalescer.push_batch(batch).unwrap();
        chunks.extend(coalescer.finish().unwrap());
        let flight_data_vec = encode_all(&options, 0, chunks);
        assert!(
            flight_data_vec.len() > 1,
            "10000-row batch should be split into multiple FlightData messages"
        );
    }

    #[test]
    fn test_encode_batch_splits_large_batch() {
        let schema = Arc::new(create_test_schema());
        // 100 rows of string data; measure real size and set limit to half of it
        let ids: Vec<i32> = (0..100).collect();
        let names: Vec<Option<&str>> = (0..100)
            .map(|i| if i % 10 == 0 { None } else { Some("hello") })
            .collect();
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(Int32Array::from(ids)),
                Arc::new(StringArray::from(names)),
            ],
        )
        .unwrap();

        let batch_size: usize = batch
            .columns()
            .iter()
            .map(|col| {
                col.to_data()
                    .get_slice_memory_size()
                    .unwrap_or_else(|_| col.get_buffer_memory_size())
            })
            .sum();
        let max_flight_data_size = batch_size / 2;

        let options = IpcWriteOptions::default();
        let mut coalescer = ChunkCoalescer::new();

        let mut chunks = coalescer.push_batch(batch).unwrap();
        chunks.extend(coalescer.finish().unwrap());
        let flight_data_vec = encode_all(&options, max_flight_data_size, chunks);
        assert!(
            flight_data_vec.len() > 1,
            "batch exceeding max_flight_data_size ({max_flight_data_size} bytes) should split"
        );
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
            .map(|col| {
                col.to_data()
                    .get_slice_memory_size()
                    .unwrap_or_else(|_| col.get_buffer_memory_size())
            })
            .sum::<usize>();

        let max_size = size / 2; // Should create 2 batches
        let batches = split_batch_for_grpc_response(batch, max_size);

        // Should create at least 2 batches due to splitting
        assert!(batches.len() >= 2);
    }

    #[test]
    fn test_split_batch_sliced_array_no_overestimate() {
        // Simulate what aggregateExec does: create a large batch then slice a small
        // portion of it. get_buffer_memory_size() on the slice returns the full
        // backing-buffer size, which caused over-splitting. The fix uses
        // get_slice_memory_size() to measure only the used portion.
        let schema = Arc::new(create_test_schema());
        let large_id = Arc::new(Int32Array::from((0..1000_i32).collect::<Vec<_>>()));
        let large_name = Arc::new(StringArray::from(
            (0..1000).map(|i| format!("name_{i}")).collect::<Vec<_>>(),
        ));
        let large_batch = RecordBatch::try_new(schema, vec![large_id, large_name]).unwrap();

        // Slice to 5 rows — backing buffer still holds 1000 rows
        let small_batch = large_batch.slice(0, 5);

        // max_size large enough that 5 rows should never need splitting
        let slice_size: usize = small_batch
            .columns()
            .iter()
            .map(|col| {
                col.to_data()
                    .get_slice_memory_size()
                    .unwrap_or_else(|_| col.get_buffer_memory_size())
            })
            .sum();
        let max_size = slice_size + 1;

        let batches = split_batch_for_grpc_response(small_batch, max_size);
        assert_eq!(
            batches.len(),
            1,
            "sliced batch should not be over-split due to backing-buffer overestimation"
        );
    }

    fn assert_large_splits_slice_does_not(batch: RecordBatch, n_slice: usize) {
        let measure = |b: &RecordBatch| -> usize {
            b.columns()
                .iter()
                .map(|col| {
                    col.to_data()
                        .get_slice_memory_size()
                        .unwrap_or_else(|_| col.get_buffer_memory_size())
                })
                .sum()
        };

        let small = batch.slice(0, n_slice);
        let full_size = measure(&batch);
        let slice_size = measure(&small);
        assert!(
            full_size > slice_size,
            "pre-condition: full batch must be larger than slice"
        );
        let max_size = (slice_size + full_size) / 2;

        let large_out = split_batch_for_grpc_response(batch.clone(), max_size);
        assert!(large_out.len() > 1);
        assert_eq!(
            large_out.iter().map(|b| b.num_rows()).sum::<usize>(),
            batch.num_rows()
        );

        let small_out = split_batch_for_grpc_response(small, max_size);
        assert_eq!(small_out.len(), 1);
    }

    #[test]
    fn test_split_batch_utf8() {
        let schema = Arc::new(Schema::new(vec![Field::new("text", DataType::Utf8, true)]));
        let strings: Vec<Option<String>> = (0..100).map(|i| Some(format!("word_{i:04}"))).collect();
        let arr: ArrayRef = Arc::new(StringArray::from(
            strings.iter().map(|s| s.as_deref()).collect::<Vec<_>>(),
        ));
        let batch = RecordBatch::try_new(schema, vec![arr]).unwrap();
        assert_large_splits_slice_does_not(batch, 5);
    }

    #[test]
    fn test_split_batch_utf8view() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "text",
            DataType::Utf8View,
            true,
        )]));
        let strings: Vec<Option<String>> = (0..100)
            .map(|i| Some(format!("longer_string_{i:04}")))
            .collect();
        let arr: ArrayRef = Arc::new(StringViewArray::from(
            strings.iter().map(|s| s.as_deref()).collect::<Vec<_>>(),
        ));
        let batch = RecordBatch::try_new(schema, vec![arr]).unwrap();
        assert_large_splits_slice_does_not(batch, 5);
    }

    #[test]
    fn test_split_batch_struct_with_binary() {
        let bin_field = Field::new("payload", DataType::Binary, true);
        let child_fields = Fields::from(vec![bin_field]);
        let struct_field = Field::new("row", DataType::Struct(child_fields.clone()), true);
        let schema = Arc::new(Schema::new(vec![struct_field]));

        let bin_data: Vec<Option<&[u8]>> =
            (0..100).map(|_| Some(b"binary_payload".as_ref())).collect();
        let bin_col: ArrayRef = Arc::new(BinaryArray::from(bin_data));
        let struct_col: ArrayRef = Arc::new(StructArray::new(child_fields, vec![bin_col], None));
        let batch = RecordBatch::try_new(schema, vec![struct_col]).unwrap();
        assert_large_splits_slice_does_not(batch, 5);
    }

    #[test]
    fn test_split_batch_list_with_utf8view() {
        let item_field = Arc::new(Field::new("item", DataType::Utf8View, true));
        let list_field = Field::new("texts", DataType::List(Arc::clone(&item_field)), false);
        let schema = Arc::new(Schema::new(vec![list_field]));

        // 100 rows, 2 items each → 200 values
        let values: ArrayRef = Arc::new(StringViewArray::from(
            (0..200_usize).map(|i| format!("v{i}")).collect::<Vec<_>>(),
        ));
        let offsets = OffsetBuffer::from_lengths(std::iter::repeat(2).take(100));
        let list_col: ArrayRef = Arc::new(ListArray::new(item_field, offsets, values, None));
        let batch = RecordBatch::try_new(schema, vec![list_col]).unwrap();
        assert_large_splits_slice_does_not(batch, 5);
    }

    #[test]
    fn test_split_batch_list_with_utf8() {
        let item_field = Arc::new(Field::new("item", DataType::Utf8, true));
        let list_field = Field::new("words", DataType::List(Arc::clone(&item_field)), false);
        let schema = Arc::new(Schema::new(vec![list_field]));

        // 100 rows, 2 words each → 200 values
        let values: ArrayRef = Arc::new(StringArray::from(
            (0..200_usize).map(|i| format!("w{i}")).collect::<Vec<_>>(),
        ));
        let offsets = OffsetBuffer::from_lengths(std::iter::repeat(2).take(100));
        let list_col: ArrayRef = Arc::new(ListArray::new(item_field, offsets, values, None));
        let batch = RecordBatch::try_new(schema, vec![list_col]).unwrap();
        assert_large_splits_slice_does_not(batch, 5);
    }

    #[test]
    fn test_encode_custom_peak_memory() {
        let options = IpcWriteOptions::default();
        let encoder = FlightDataEncoder::new(options, 8192);
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
