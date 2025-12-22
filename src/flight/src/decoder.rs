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

use std::{collections::HashMap, fmt::Debug, pin::Pin, sync::Arc, task::Poll};

use arrow::{array::ArrayRef, buffer::Buffer, ipc::MessageHeader};
use arrow_flight::{
    FlightData,
    error::{FlightError, Result},
    utils::flight_data_to_arrow_batch,
};
use arrow_schema::{Schema, SchemaRef};
use datafusion::parquet::data_type::AsBytes;
use futures::{Stream, StreamExt, ready};
use tonic::Streaming;

use crate::common::{CustomMessage, FlightMessage, RemoteScanMetrics};

pub struct FlightDataDecoder {
    response: Streaming<FlightData>,
    schema: Option<SchemaRef>,
    dictionaries_by_field: HashMap<i64, ArrayRef>,
    done: bool,
    metrics: RemoteScanMetrics,
}

impl Debug for FlightDataDecoder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FlightDataDecoder")
            .field("response", &"<stream>")
            .field("schema", &self.schema)
            .field("dictionaries_by_field", &self.dictionaries_by_field)
            .field("done", &self.done)
            .finish()
    }
}

impl FlightDataDecoder {
    /// Create a new wrapper around the stream of [`FlightData`]
    pub fn new(
        response: Streaming<FlightData>,
        schema: Option<SchemaRef>,
        metrics: RemoteScanMetrics,
    ) -> Self {
        Self {
            response,
            schema,
            dictionaries_by_field: HashMap::new(),
            done: false,
            metrics,
        }
    }

    /// Returns the current schema for this stream
    pub fn schema(&self) -> Option<&SchemaRef> {
        self.schema.as_ref()
    }

    /// Extracts flight data from the next message
    fn extract_message(&mut self, data: FlightData) -> Result<Option<FlightMessage>> {
        let timer = self.metrics.decode_time.timer();
        let message = arrow::ipc::root_as_message(&data.data_header[..])
            .map_err(|e| FlightError::DecodeError(format!("Error decoding header: {e}")))?;

        let result = match message.header_type() {
            MessageHeader::NONE => {
                let message = serde_json::from_slice::<CustomMessage>(data.app_metadata.as_bytes())
                    .map_err(|e| {
                        FlightError::DecodeError(format!("Error decode custom message: {e}"))
                    })?;

                Ok(Some(FlightMessage::CustomMessage(message)))
            }
            MessageHeader::Schema => {
                let schema = Schema::try_from(&data)
                    .map_err(|e| FlightError::DecodeError(format!("Error decoding schema: {e}")))?;

                let schema = Arc::new(schema);

                self.schema = Some(schema.clone());
                Ok(Some(FlightMessage::Schema(schema)))
            }
            MessageHeader::DictionaryBatch => {
                let schema = if let Some(schema) = self.schema.as_ref() {
                    schema
                } else {
                    return Err(FlightError::protocol(
                        "Received DictionaryBatch prior to Schema",
                    ));
                };

                let buffer = Buffer::from(data.data_body);
                let dictionary_batch = message.header_as_dictionary_batch().ok_or_else(|| {
                    FlightError::protocol(
                        "Could not get dictionary batch from DictionaryBatch message",
                    )
                })?;

                arrow::ipc::reader::read_dictionary(
                    &buffer,
                    dictionary_batch,
                    schema,
                    &mut self.dictionaries_by_field,
                    &message.version(),
                )
                .map_err(|e| {
                    FlightError::DecodeError(format!("Error decoding ipc dictionary: {e}"))
                })?;

                Ok(None)
            }
            MessageHeader::RecordBatch => {
                let schema = if let Some(schema) = self.schema.as_ref() {
                    schema
                } else {
                    return Err(FlightError::protocol(
                        "Received RecordBatch prior to Schema",
                    ));
                };

                let batch = flight_data_to_arrow_batch(
                    &data,
                    Arc::clone(schema),
                    &self.dictionaries_by_field,
                )
                .map_err(|e| {
                    FlightError::DecodeError(format!("Error decoding ipc RecordBatch: {e}"))
                })?;

                Ok(Some(FlightMessage::RecordBatch(batch)))
            }
            other => {
                let name = other.variant_name().unwrap_or("UNKNOWN");
                Err(FlightError::protocol(format!("Unexpected message: {name}")))
            }
        };
        timer.done();
        result
    }
}

impl Stream for FlightDataDecoder {
    type Item = Result<FlightMessage>;
    fn poll_next(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        if self.done {
            return Poll::Ready(None);
        }
        loop {
            let res = ready!(self.response.poll_next_unpin(cx));

            return Poll::Ready(match res {
                None => {
                    self.done = true;
                    None // inner is exhausted
                }
                Some(data) => Some(match data {
                    Err(e) => Err(e.into()),
                    Ok(data) => match self.extract_message(data) {
                        Ok(Some(extracted)) => Ok(extracted),
                        Ok(None) => continue, // Need next input message
                        Err(e) => Err(e),
                    },
                }),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{ArrayRef, Int32Array, RecordBatch, StringArray},
        ipc::{
            MessageHeader,
            writer::{CompressionContext, DictionaryTracker, IpcDataGenerator, IpcWriteOptions},
        },
    };
    use arrow_flight::{FlightData, SchemaAsIpc};
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::search::ScanStats;
    use flatbuffers::FlatBufferBuilder;

    use super::*;
    use crate::common::CustomMessage;

    fn create_test_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int32, false),
            Field::new("name", DataType::Utf8, true),
        ]))
    }

    fn create_test_record_batch() -> RecordBatch {
        let schema = create_test_schema();
        let id_array: ArrayRef = Arc::new(Int32Array::from(vec![1, 2, 3]));
        let name_array: ArrayRef =
            Arc::new(StringArray::from(vec![Some("Alice"), Some("Bob"), None]));

        RecordBatch::try_new(schema, vec![id_array, name_array]).unwrap()
    }

    fn create_custom_message_flight_data() -> FlightData {
        let scan_stats = ScanStats {
            files: 5,
            records: 500,
            original_size: 1024,
            compressed_size: 512,
            querier_files: 3,
            querier_memory_cached_files: 1,
            querier_disk_cached_files: 2,
            idx_scan_size: 256,
            idx_took: 50,
            file_list_took: 25,
            aggs_cache_ratio: 90,
            peak_memory_usage: 1024000,
        };
        let custom_message = CustomMessage::ScanStats(scan_stats);
        let metadata = serde_json::to_string(&custom_message).unwrap();

        // Create NONE header
        let mut builder = FlatBufferBuilder::new();
        let mut message = arrow::ipc::MessageBuilder::new(&mut builder);
        message.add_version(arrow::ipc::MetadataVersion::V5);
        message.add_header_type(MessageHeader::NONE);
        message.add_bodyLength(0);
        let data = message.finish();
        builder.finish(data, None);
        let header = builder.finished_data().to_vec();

        FlightData::new()
            .with_data_header(header)
            .with_app_metadata(metadata.as_bytes().to_vec())
    }

    #[test]
    fn test_custom_message_serialization_deserialization() {
        let scan_stats = ScanStats {
            files: 5,
            records: 500,
            original_size: 1024,
            compressed_size: 512,
            querier_files: 3,
            querier_memory_cached_files: 1,
            querier_disk_cached_files: 2,
            idx_scan_size: 256,
            idx_took: 50,
            file_list_took: 25,
            aggs_cache_ratio: 90,
            peak_memory_usage: 1024000,
        };
        let custom_message = CustomMessage::ScanStats(scan_stats);

        // Test serialization
        let serialized = serde_json::to_string(&custom_message).unwrap();

        // Test deserialization
        let deserialized: CustomMessage = serde_json::from_str(&serialized).unwrap();

        match deserialized {
            CustomMessage::ScanStats(stats) => {
                assert_eq!(stats.files, 5);
                assert_eq!(stats.records, 500);
                assert_eq!(stats.original_size, 1024);
                assert_eq!(stats.compressed_size, 512);
            }
            _ => panic!("Expected ScanStats variant"),
        }
    }

    #[test]
    fn test_flight_data_schema_encoding_decoding() {
        let schema = create_test_schema();
        let options = IpcWriteOptions::default();
        let flight_data: FlightData = SchemaAsIpc::new(&schema, &options).into();

        // Verify the flight data is properly formed
        assert!(!flight_data.data_header.is_empty());
        // Schema flight data may not always have a data body, only header

        // Test that we can decode it back to a schema
        let decoded_schema = Schema::try_from(&flight_data).unwrap();
        assert_eq!(decoded_schema.fields().len(), 2);
        assert_eq!(decoded_schema.field(0).name(), "id");
        assert_eq!(decoded_schema.field(1).name(), "name");
    }

    #[test]
    fn test_flight_data_record_batch_encoding_decoding() {
        let batch = create_test_record_batch();
        let options = IpcWriteOptions::default();
        let data_gen = IpcDataGenerator::default();
        let mut compress = CompressionContext::default();
        let mut dictionary_tracker = DictionaryTracker::new(false);

        let (_, encoded_batch) = data_gen
            .encode(&batch, &mut dictionary_tracker, &options, &mut compress)
            .unwrap();

        let flight_data: FlightData = encoded_batch.into();

        // Verify the flight data is properly formed
        assert!(!flight_data.data_header.is_empty());
        assert!(!flight_data.data_body.is_empty());

        // Verify we can decode with the proper schema and empty dictionaries
        let schema = batch.schema();
        let dictionaries = std::collections::HashMap::new();
        let decoded_batch =
            arrow_flight::utils::flight_data_to_arrow_batch(&flight_data, schema, &dictionaries)
                .unwrap();

        assert_eq!(decoded_batch.num_rows(), 3);
        assert_eq!(decoded_batch.num_columns(), 2);
    }

    #[test]
    fn test_custom_message_flight_data_creation() {
        let flight_data = create_custom_message_flight_data();

        // Verify structure
        assert!(!flight_data.data_header.is_empty());
        assert!(!flight_data.app_metadata.is_empty());
        assert!(flight_data.data_body.is_empty());

        // Verify we can deserialize the custom message
        let custom_message: CustomMessage =
            serde_json::from_slice(&flight_data.app_metadata).unwrap();
        match custom_message {
            CustomMessage::ScanStats(stats) => {
                assert_eq!(stats.files, 5);
                assert_eq!(stats.records, 500);
            }
            _ => panic!("Expected ScanStats variant"),
        }
    }

    #[test]
    fn test_invalid_json_in_app_metadata() {
        // Test that invalid JSON in app_metadata would cause an error during deserialization
        let invalid_json = b"invalid json";
        let result = serde_json::from_slice::<CustomMessage>(invalid_json);
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("expected"));
    }

    #[test]
    fn test_flight_message_variants() {
        // Test FlightMessage enum construction
        let schema = create_test_schema();
        let schema_message = FlightMessage::Schema(schema);

        match schema_message {
            FlightMessage::Schema(s) => {
                assert_eq!(s.fields().len(), 2);
            }
            _ => panic!("Expected Schema variant"),
        }

        let batch = create_test_record_batch();
        let batch_message = FlightMessage::RecordBatch(batch);

        match batch_message {
            FlightMessage::RecordBatch(b) => {
                assert_eq!(b.num_rows(), 3);
            }
            _ => panic!("Expected RecordBatch variant"),
        }
    }
}
