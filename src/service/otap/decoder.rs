// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use std::{collections::HashMap, io::Cursor};

use arrow::{array::RecordBatch, error::ArrowError, ipc::reader::StreamReader};
use opentelemetry_proto::tonic::{
    collector::logs::v1::ExportLogsServiceRequest, common::v1::any_value,
};
use proto::otel_arrow::{ArrowPayload, ArrowPayloadType, BatchArrowRecords};
use snafu::{OptionExt, ResultExt, ensure};

use super::{
    error,
    logs::{RelatedData as LogsRelatedData, logs_from},
    store::ParentId,
};

/// Wrapper for [RecordBatch].
pub struct RecordMessage {
    #[allow(unused)]
    pub(crate) batch_id: i64,
    #[allow(unused)]
    pub(crate) schema_id: String,
    pub(crate) payload_type: ArrowPayloadType,
    pub(crate) record: RecordBatch,
}
pub struct StreamConsumer {
    payload_type: ArrowPayloadType,
    stream_reader: StreamReader<Cursor<Vec<u8>>>,
}

impl StreamConsumer {
    fn new(payload: ArrowPayloadType, initial_bytes: Vec<u8>) -> error::Result<Self> {
        let data = Cursor::new(initial_bytes);
        let stream_reader =
            StreamReader::try_new(data, None).context(error::BuildStreamReaderSnafu)?;
        Ok(Self {
            payload_type: payload,
            stream_reader,
        })
    }

    fn replace_bytes(&mut self, bytes: Vec<u8>) {
        *self.stream_reader.get_mut() = Cursor::new(bytes);
    }

    fn next(&mut self) -> Option<Result<RecordBatch, ArrowError>> {
        self.stream_reader.next()
    }
}

/// Consumer consumes OTAP `BatchArrowRecords` and converts them into OTLP messages.
#[derive(Default)]
pub struct Consumer {
    stream_consumers: HashMap<String, StreamConsumer>,
}

impl Consumer {
    fn consume_bar(&mut self, bar: &mut BatchArrowRecords) -> error::Result<Vec<RecordMessage>> {
        let mut records = Vec::with_capacity(bar.arrow_payloads.len());

        for payload in std::mem::take(&mut bar.arrow_payloads) {
            let ArrowPayload {
                schema_id,
                r#type,
                record,
            } = payload;
            let payload_type = ArrowPayloadType::try_from(r#type)
                .map_err(|_| error::UnsupportedPayloadTypeSnafu { actual: r#type }.build())?;

            let stream_consumer = match self.stream_consumers.get_mut(&schema_id) {
                None => {
                    // stream consumer does not exist, remove all stream consumer with
                    // the same payload_type since schema already changed for that payload.
                    let new_stream_consumer: HashMap<String, StreamConsumer> =
                        (std::mem::take(&mut self.stream_consumers))
                            .into_iter()
                            .filter(|(_, v)| v.payload_type != payload_type)
                            .collect::<HashMap<_, _>>();
                    self.stream_consumers = new_stream_consumer;
                    self.stream_consumers
                        .entry(schema_id.clone())
                        .or_insert(StreamConsumer::new(payload_type, record)?)
                }
                Some(s) => {
                    // stream consumer exists for given schema id, just reset the bytes.
                    s.replace_bytes(record);
                    s
                }
            };

            if let Some(rs) = stream_consumer.next() {
                // the encoder side ensures there should be only one record here.
                let record = rs.context(error::ReadRecordBatchSnafu)?;
                records.push(RecordMessage {
                    batch_id: bar.batch_id,
                    schema_id,
                    payload_type,
                    record,
                });
            } else {
                // TODO: handle stream reader finished
            }
        }
        Ok(records)
    }

    /// Consumes all the arrow payloads in the passed OTAP `BatchArrayRecords` and decodes them
    /// into OTLP messages, then constructs the `ExportLogsServiceRequest` containing the
    /// logs messages
    pub fn consume_logs_batches(
        &mut self,
        records: &mut BatchArrowRecords,
    ) -> error::Result<ExportLogsServiceRequest> {
        match get_main_payload_type(records)? {
            ArrowPayloadType::Logs => {
                let record_message = self.consume_bar(records)?;
                let (mut related_data, log_record) =
                    LogsRelatedData::from_record_messages(&record_message)?;
                let log_rec_idx = log_record.context(error::LogRecordNotFoundSnafu)?;
                logs_from(&record_message[log_rec_idx].record, &mut related_data)
            }
            main_record_type => error::UnsupportedPayloadTypeSnafu {
                actual: main_record_type,
            }
            .fail(),
        }
    }
}

/// Get the main logs, metrics, or traces from a received BatchArrowRecords message.
fn get_main_payload_type(records: &BatchArrowRecords) -> error::Result<ArrowPayloadType> {
    ensure!(!records.arrow_payloads.is_empty(), error::EmptyBatchSnafu);

    // Per the specification, the main record type is the first payload
    let main_record_type = records.arrow_payloads[0].r#type;
    ArrowPayloadType::try_from(main_record_type).map_err(|_| {
        error::UnsupportedPayloadTypeSnafu {
            actual: main_record_type,
        }
        .build()
    })
}

pub type Attrs16ParentIdDecoder = AttrsParentIdDecoder<u16>;
pub type Attrs32ParentIdDecoder = AttrsParentIdDecoder<u32>;

pub struct AttrsParentIdDecoder<T> {
    prev_parent_id: T,
    prev_key: Option<String>,
    prev_value: Option<any_value::Value>,
}

impl<T> Default for AttrsParentIdDecoder<T>
where
    T: ParentId,
{
    fn default() -> Self {
        Self {
            prev_parent_id: T::default(),
            prev_key: None,
            prev_value: None,
        }
    }
}

impl<T> AttrsParentIdDecoder<T>
where
    T: ParentId,
{
    pub fn decode(&mut self, delta_or_parent_id: T, key: &str, value: &any_value::Value) -> T {
        if self.prev_key.as_deref() == Some(key) && self.prev_value.as_ref() == Some(value) {
            let parent_id = self.prev_parent_id.add(delta_or_parent_id);
            self.prev_parent_id = parent_id;
            parent_id
        } else {
            self.prev_key = Some(key.to_string());
            self.prev_value = Some(value.clone());
            self.prev_parent_id = delta_or_parent_id;
            delta_or_parent_id
        }
    }
}
