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

use arrow::{
    array::RecordBatch,
    ipc::{
        MessageHeader,
        writer::{DictionaryTracker, IpcDataGenerator, IpcWriteOptions},
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
}

impl FlightDataEncoder {
    pub fn new(options: IpcWriteOptions, max_flight_data_size: usize) -> Self {
        Self {
            options,
            data_gen: IpcDataGenerator::default(),
            dictionary_tracker: DictionaryTracker::new(false),
            max_flight_data_size,
        }
    }

    /// Encode a schema as a FlightData
    pub fn encode_schema(&self, schema: &Schema) -> FlightData {
        SchemaAsIpc::new(schema, &self.options).into()
    }

    /// Encode a RecordBatch to a Vec of FlightData
    pub fn encode_batch(&mut self, batch: RecordBatch) -> Result<Vec<FlightData>> {
        let mut flight_data = Vec::new();

        for batch in split_batch_for_grpc_response(batch, self.max_flight_data_size) {
            let (encoded_dictionaries, encoded_batch) =
                self.data_gen
                    .encoded_batch(&batch, &mut self.dictionary_tracker, &self.options)?;

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

    let n_batches =
        (size / max_flight_data_size + usize::from(size % max_flight_data_size != 0)).max(1);
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
