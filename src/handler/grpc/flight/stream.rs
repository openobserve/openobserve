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
use flight::{common::PreCustomMessage, encoder::FlightDataEncoder};
use futures::{Stream, StreamExt};
use futures_core::ready;
use tracing::info_span;
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{handler::grpc::flight::clear_session_data, service::search::work_group::DeferredLock};

pub struct FlightEncoderStreamBuilder {
    encoder: FlightDataEncoder,
    queue: VecDeque<FlightData>,
    custom_messages: Vec<PreCustomMessage>,
    // query context
    trace_id: String,
    is_super: bool,
    defer_lock: Option<DeferredLock>,
    start: std::time::Instant,
}

impl FlightEncoderStreamBuilder {
    pub fn new(options: IpcWriteOptions, max_flight_data_size: usize) -> Self {
        Self {
            encoder: FlightDataEncoder::new(options, max_flight_data_size),
            queue: VecDeque::new(),
            custom_messages: vec![],
            trace_id: String::new(),
            is_super: false,
            defer_lock: None,
            start: std::time::Instant::now(),
        }
    }

    pub fn with_custom_message(mut self, message: PreCustomMessage) -> Self {
        self.custom_messages.push(message);
        self
    }

    pub fn with_trace_id(mut self, trace_id: String) -> Self {
        self.trace_id = trace_id;
        self
    }

    pub fn with_is_super(mut self, is_super: bool) -> Self {
        self.is_super = is_super;
        self
    }

    pub fn with_defer_lock(mut self, lock: Option<DeferredLock>) -> Self {
        self.defer_lock = lock;
        self
    }

    pub fn with_start(mut self, start: std::time::Instant) -> Self {
        self.start = start;
        self
    }

    pub fn build(
        self,
        inner: SendableRecordBatchStream,
        span: tracing::Span,
    ) -> FlightEncoderStream {
        let child_span = info_span!("grpc:search:flight:execute_physical_plan");
        let _ = child_span.set_parent(span.context());
        FlightEncoderStream {
            inner,
            encoder: self.encoder,
            queue: self.queue,
            done: false,
            custom_messages: self.custom_messages,
            trace_id: self.trace_id,
            is_super: self.is_super,
            defer_lock: self.defer_lock,
            start: self.start,
            first_batch: true,
            span,
            child_span,
            req_id: 0,
            req_last_time: std::time::Instant::now(),
            print_key_event: config::get_config().common.print_key_event,
        }
    }
}

pub struct FlightEncoderStream {
    inner: SendableRecordBatchStream,
    encoder: FlightDataEncoder,
    queue: VecDeque<FlightData>,
    done: bool,
    first_batch: bool,
    custom_messages: Vec<PreCustomMessage>,
    // query context
    trace_id: String,
    is_super: bool,
    defer_lock: Option<DeferredLock>,
    start: std::time::Instant,
    span: tracing::Span,
    child_span: tracing::Span,
    req_id: u64,
    req_last_time: std::time::Instant,
    print_key_event: bool,
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
            let message = message.get_custom_message();
            if let Some(message) = message {
                let flight_data = self.encoder.encode_custom(&message)?;
                self.queue.push_back(flight_data);
            }
        }
        Ok(())
    }

    fn encode_custom_scan_stats(&mut self) -> Result<(), FlightError> {
        let custom_messages = std::mem::take(&mut self.custom_messages);
        let mut remainder_messages = Vec::new();
        for message in custom_messages.into_iter() {
            if message.is_scan_stats() {
                let message = message.get_custom_message();
                if let Some(message) = message {
                    let flight_data = self.encoder.encode_custom(&message)?;
                    self.queue.push_back(flight_data);
                }
            } else {
                remainder_messages.push(message);
            }
        }
        self.custom_messages = remainder_messages;
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
                if self.print_key_event {
                    log::info!(
                        "[trace_id {}] flight->search: stream Poll::Ready(None) is_super: {}, took: {} ms",
                        self.trace_id,
                        self.is_super,
                        self.req_last_time.elapsed().as_millis(),
                    );
                }
                return Poll::Ready(None);
            }

            if let Some(data) = self.queue.pop_front() {
                self.req_id += 1;
                let took = self.req_last_time.elapsed().as_millis();
                self.req_last_time = std::time::Instant::now();
                if self.print_key_event
                    && (took > 100 || config::utils::util::is_power_of_two(self.req_id))
                {
                    log::info!(
                        "[trace_id {}] flight->search: stream Poll::Ready(#{}) message, is_super: {}, took: {took} ms",
                        self.trace_id,
                        self.req_id,
                        self.is_super,
                    );
                }
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
                        "[trace_id {}] flight->search: stream error: {e:?}, is_super: {}, took: {} ms",
                        self.trace_id,
                        self.is_super,
                        self.start.elapsed().as_millis()
                    );
                    return Poll::Ready(Some(Err(tonic::Status::internal(e.to_string()))));
                }
                Some(Ok(batch)) => {
                    // before send the first batch, send the scan_stats first
                    if self.first_batch && !self.custom_messages.is_empty() {
                        if let Err(e) = self.encode_custom_scan_stats() {
                            self.done = true;
                            self.queue.clear();
                            return Poll::Ready(Some(Err(tonic::Status::internal(e.to_string()))));
                        }
                        self.first_batch = false;
                    }
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
        let is_super = self.is_super;
        let took = self.start.elapsed().as_millis();
        log::info!(
            "[trace_id {trace_id}] flight->search: stream end, is_super: {is_super}, took: {took} ms"
        );

        let _child_enter = self.child_span.enter();
        let _enter = self.span.enter();
        drop(_child_enter);
        drop(_enter);

        // metrics
        let time = self.start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/search/flight/do_get", "200", "", "", "", ""])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/search/flight/do_get", "200", "", "", "", ""])
            .inc();

        // defer is only set for super cluster follower leader
        if let Some(defer) = self.defer_lock.take() {
            drop(defer);
        } else {
            log::info!(
                "[trace_id {trace_id}] flight->search: drop FlightEncoderStream, is_super: {is_super}",
            );
            // clear session data
            clear_session_data(&self.trace_id);
        }
    }
}
