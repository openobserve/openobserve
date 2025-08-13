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

use arrow::{array::ArrayRef, buffer::Buffer};
use arrow_flight::{
    FlightData,
    error::{FlightError, Result},
    utils::flight_data_to_arrow_batch,
};
use arrow_schema::{Schema, SchemaRef};
use datafusion::parquet::data_type::AsBytes;
use futures::{Stream, StreamExt, ready};
use tonic::Streaming;

use crate::common::{CustomMessage, FlightMessage};

pub struct FlightDataDecoder {
    response: Streaming<FlightData>,
    schema: Option<SchemaRef>,
    dictionaries_by_field: HashMap<i64, ArrayRef>,
    done: bool,
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
    pub fn new(response: Streaming<FlightData>, schema: Option<SchemaRef>) -> Self {
        Self {
            response,
            schema,
            dictionaries_by_field: HashMap::new(),
            done: false,
        }
    }

    /// Returns the current schema for this stream
    pub fn schema(&self) -> Option<&SchemaRef> {
        self.schema.as_ref()
    }

    /// Extracts flight data from the next message
    fn extract_message(&mut self, data: FlightData) -> Result<Option<FlightMessage>> {
        use arrow::ipc::MessageHeader;
        let message = arrow::ipc::root_as_message(&data.data_header[..])
            .map_err(|e| FlightError::DecodeError(format!("Error decoding header: {e}")))?;

        match message.header_type() {
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
        }
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
