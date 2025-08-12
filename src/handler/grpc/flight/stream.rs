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

use std::{collections::VecDeque, pin::Pin, task::Poll};

use arrow::{array::RecordBatch, ipc::writer::IpcWriteOptions};
use arrow_flight::{FlightData, error::FlightError};
use config::metrics;
use datafusion::execution::SendableRecordBatchStream;
use flight::{common::CustomMessage, encoder::FlightDataEncoder};
use futures::{Stream, StreamExt};
use futures_core::ready;

use crate::{handler::grpc::flight::clear_session_data, service::search::utils::AsyncDefer};

pub struct FlightEncoderStreamBuilder {
    encoder: FlightDataEncoder,
    queue: VecDeque<FlightData>,
    custom_messages: Vec<CustomMessage>,
    // query context
    trace_id: String,
    defer: Option<AsyncDefer>,
    start: std::time::Instant,
}

impl FlightEncoderStreamBuilder {
    pub fn new(options: IpcWriteOptions, max_flight_data_size: usize) -> Self {
        Self {
            encoder: FlightDataEncoder::new(options, max_flight_data_size),
            queue: VecDeque::new(),
            custom_messages: vec![],
            trace_id: String::new(),
            defer: None,
            start: std::time::Instant::now(),
        }
    }

    pub fn with_custom_message(mut self, message: CustomMessage) -> Self {
        self.custom_messages.push(message);
        self
    }

    pub fn with_trace_id(mut self, trace_id: String) -> Self {
        self.trace_id = trace_id;
        self
    }

    pub fn with_defer(mut self, defer: Option<AsyncDefer>) -> Self {
        self.defer = defer;
        self
    }

    pub fn with_start(mut self, start: std::time::Instant) -> Self {
        self.start = start;
        self
    }

    pub fn build(self, inner: SendableRecordBatchStream) -> FlightEncoderStream {
        FlightEncoderStream {
            inner,
            encoder: self.encoder,
            queue: self.queue,
            done: false,
            custom_messages: self.custom_messages,
            trace_id: self.trace_id,
            defer: self.defer,
            start: self.start,
        }
    }
}

pub struct FlightEncoderStream {
    inner: SendableRecordBatchStream,
    encoder: FlightDataEncoder,
    queue: VecDeque<FlightData>,
    done: bool,
    custom_messages: Vec<CustomMessage>,
    // query context
    trace_id: String,
    defer: Option<AsyncDefer>,
    start: std::time::Instant,
}

impl FlightEncoderStream {
    fn encode_batch(&mut self, batch: RecordBatch) -> Result<(), FlightError> {
        let flight_data = self.encoder.encode_batch(batch)?;
        self.queue.extend(flight_data);

        Ok(())
    }

    fn encode_custom_messages(&mut self) -> Result<(), FlightError> {
        let custom_messages = std::mem::take(&mut self.custom_messages);
        for message in custom_messages.into_iter() {
            let flight_data = self.encoder.encode_custom(&message)?;
            self.queue.push_back(flight_data);
        }
        Ok(())
    }
}

impl Stream for FlightEncoderStream {
    type Item = std::result::Result<FlightData, tonic::Status>;

    fn poll_next(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        loop {
            if self.done && self.queue.is_empty() {
                return Poll::Ready(None);
            }

            if let Some(data) = self.queue.pop_front() {
                return Poll::Ready(Some(Ok(data)));
            }

            let batch = ready!(self.inner.poll_next_unpin(cx));

            match batch {
                None if self.custom_messages.is_empty() => {
                    self.done = true;
                    assert!(self.queue.is_empty());
                    return Poll::Ready(None);
                }
                None => {
                    if let Err(e) = self.encode_custom_messages() {
                        self.done = true;
                        self.queue.clear();
                        return Poll::Ready(Some(Err(tonic::Status::internal(e.to_string()))));
                    }
                }
                Some(Err(e)) => {
                    self.done = true;
                    self.queue.clear();
                    log::error!(
                        "[trace_id {}] flight->search: stream error: {e:?}, took: {} ms",
                        self.trace_id,
                        self.start.elapsed().as_millis()
                    );
                    return Poll::Ready(Some(Err(tonic::Status::internal(e.to_string()))));
                }
                Some(Ok(batch)) => {
                    if let Err(e) = self.encode_batch(batch) {
                        self.done = true;
                        self.queue.clear();
                        return Poll::Ready(Some(Err(tonic::Status::internal(e.to_string()))));
                    }
                }
            }
        }
    }
}

impl Drop for FlightEncoderStream {
    fn drop(&mut self) {
        let trace_id = &self.trace_id;
        let took = self.start.elapsed().as_millis();
        log::info!("[trace_id {trace_id}] flight->search: stream end, took: {took} ms",);

        // metrics
        let time = self.start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/search/flight/do_get", "200", "", "", "", ""])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/search/flight/do_get", "200", "", "", "", ""])
            .inc();

        // defer is only set for super cluster follower leader
        if let Some(defer) = self.defer.take() {
            drop(defer);
        } else {
            log::info!("[trace_id {trace_id}] flight->search: drop FlightEncoderStream",);
            // clear session data
            clear_session_data(&self.trace_id);
        }
    }
}
