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

use std::{collections::VecDeque, pin::Pin, task::Poll};

use arrow::ipc::writer::IpcWriteOptions;
use arrow_flight::{FlightData, error::FlightError};
use config::metrics;
use datafusion::execution::SendableRecordBatchStream;
use flight::{common::PreCustomMessage, encoder::FlightDataEncoder};
use futures::{Stream, StreamExt};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use tokio::{sync::mpsc, task::JoinHandle};
use tracing::info_span;
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{
    handler::grpc::flight::{clear_session_data, partition_encoder::PartitionEncoderStream},
    service::search::work_group::DeferredLock,
};

pub struct FlightEncoderStreamBuilder {
    options: IpcWriteOptions,
    max_flight_data_size: usize,
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
            options,
            max_flight_data_size,
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

    /// Build the encoder stream over the plan's output partitions. Each partition gets its
    /// own encoder and they are merged, so partitions encode in parallel.
    pub fn build(
        self,
        partitions: Vec<SendableRecordBatchStream>,
        span: tracing::Span,
    ) -> FlightEncoderStream {
        let child_span = info_span!("grpc:search:flight:execute_physical_plan");
        let _ = child_span.set_parent(span.context());
        // One task per partition (like CoalescePartitionsExec) so their execution and
        // encoding run in parallel; each forwards its FlightData into the shared channel.
        let cap = (partitions.len() * 2).max(2);
        let mut handles = Vec::with_capacity(partitions.len());
        let (tx, rx) = mpsc::channel(cap);
        for inner in partitions {
            let tx = tx.clone();
            let mut pstream =
                PartitionEncoderStream::new(inner, self.options.clone(), self.max_flight_data_size);
            handles.push(tokio::spawn(async move {
                while let Some(item) = pstream.next().await {
                    let is_err = item.is_err();
                    if tx.send(item).await.is_err() {
                        break; // receiver gone (client disconnect / error)
                    }
                    if is_err {
                        break;
                    }
                }
            }));
        }
        FlightEncoderStream {
            rx,
            handles,
            encoder: FlightDataEncoder::new(self.options, self.max_flight_data_size),
            queue: VecDeque::new(),
            custom_messages: self.custom_messages,
            first_data: true,
            customs_emitted: false,
            done: false,
            trace_id: self.trace_id,
            is_super: self.is_super,
            defer_lock: self.defer_lock,
            start: self.start,
            span,
            child_span,
            req_id: 0,
            req_last_time: std::time::Instant::now(),
            print_key_event: config::get_config().common.print_key_event,
        }
    }
}

pub struct FlightEncoderStream {
    /// Encoded FlightData merged from all per-partition encoder tasks.
    rx: mpsc::Receiver<Result<FlightData, FlightError>>,
    /// Per-partition encoder tasks; aborted on drop before session cleanup.
    handles: Vec<JoinHandle<()>>,
    /// Only used to encode custom messages (scan stats, peak memory, ...).
    encoder: FlightDataEncoder,
    queue: VecDeque<FlightData>,
    custom_messages: Vec<PreCustomMessage>,
    first_data: bool,
    customs_emitted: bool,
    done: bool,
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
    fn encode_custom_messages(&mut self) -> Result<(), FlightError> {
        let custom_messages = std::mem::take(&mut self.custom_messages);
        for message in custom_messages.into_iter() {
            if let Some(message) = message.get_custom_message() {
                let flight_data = self.encoder.encode_custom(&message)?;
                self.queue.push_back(flight_data);
            }
        }
        Ok(())
    }

    fn encode_early_emit_messages(&mut self) -> Result<(), FlightError> {
        let custom_messages = std::mem::take(&mut self.custom_messages);
        let mut remainder_messages = Vec::new();
        for message in custom_messages.into_iter() {
            if message.is_early_emit() {
                if let Some(message) = message.get_custom_message() {
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

    fn fail(
        &mut self,
        e: impl std::string::ToString,
    ) -> Poll<Option<Result<FlightData, tonic::Status>>> {
        self.done = true;
        self.queue.clear();
        Poll::Ready(Some(Err(tonic::Status::internal(e.to_string()))))
    }
}

impl Stream for FlightEncoderStream {
    type Item = std::result::Result<FlightData, tonic::Status>;

    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        loop {
            // 1) yield any already-encoded output
            if let Some(data) = this.queue.pop_front() {
                this.req_id += 1;
                let took = this.req_last_time.elapsed().as_millis();
                this.req_last_time = std::time::Instant::now();
                if this.print_key_event
                    && (took > 100 || config::utils::util::is_power_of_two(this.req_id))
                {
                    log::info!(
                        "[trace_id {}] flight->search: stream Poll::Ready(#{}) message, is_super: {}, took: {took} ms",
                        this.trace_id,
                        this.req_id,
                        this.is_super,
                    );
                }
                return Poll::Ready(Some(Ok(data)));
            }

            // 2) fully finished
            if this.done {
                if this.print_key_event {
                    log::info!(
                        "[trace_id {}] flight->search: stream Poll::Ready(None) is_super: {}, took: {} ms",
                        this.trace_id,
                        this.is_super,
                        this.req_last_time.elapsed().as_millis(),
                    );
                }
                return Poll::Ready(None);
            }

            // 3) pull the next encoded FlightData from the partition tasks
            match this.rx.poll_recv(cx) {
                Poll::Ready(Some(Ok(fd))) => {
                    // before the first data, emit early-emit custom messages
                    if this.first_data {
                        this.first_data = false;
                        if !this.custom_messages.is_empty()
                            && let Err(e) = this.encode_early_emit_messages()
                        {
                            return this.fail(e);
                        }
                    }
                    this.queue.push_back(fd);
                    continue;
                }
                Poll::Ready(Some(Err(e))) => {
                    log::error!(
                        "[trace_id {}] flight->search: stream error: {e:?}, is_super: {}, took: {} ms",
                        this.trace_id,
                        this.is_super,
                        this.start.elapsed().as_millis()
                    );
                    return this.fail(e);
                }
                Poll::Ready(None) => {
                    // all partitions done; append trailing custom messages (e.g. peak memory)
                    if !this.customs_emitted {
                        this.customs_emitted = true;
                        if let Err(e) = this.encode_custom_messages() {
                            return this.fail(e);
                        }
                        if !this.queue.is_empty() {
                            continue;
                        }
                    }
                    this.done = true;
                    continue;
                }
                Poll::Pending => return Poll::Pending,
            }
        }
    }
}

impl Drop for FlightEncoderStream {
    fn drop(&mut self) {
        // Stop the partition tasks before clearing the session data they may still read.
        for handle in &self.handles {
            handle.abort();
        }
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

        // Release the node-level slot reservation for this Follow node.
        #[cfg(feature = "enterprise")]
        if get_o2_config().work_group.max_nodes_per_query > 0 {
            o2_enterprise::enterprise::search::admission::ledger::release(trace_id);
            log::info!("[trace_id {trace_id}] flight->search: releasing slot");
        }

        // defer is only set for super cluster follower leader
        if let Some(defer) = self.defer_lock.take() {
            drop(defer);
        } else {
            // clear session data
            clear_session_data(&self.trace_id);
            log::info!(
                "[trace_id {trace_id}] flight->search: drop FlightEncoderStream, is_super: {is_super}",
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{Int32Array, RecordBatch},
        ipc::writer::IpcWriteOptions,
    };
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::search::ScanStats;
    use datafusion::physical_plan::stream::RecordBatchStreamAdapter;
    use flight::common::PreCustomMessage;
    use futures::TryStreamExt;

    use super::*;

    fn make_builder() -> FlightEncoderStreamBuilder {
        FlightEncoderStreamBuilder::new(IpcWriteOptions::default(), 4096)
    }

    #[test]
    fn test_builder_new_defaults() {
        let b = make_builder();
        assert_eq!(b.trace_id, "");
        assert!(!b.is_super);
        assert!(b.defer_lock.is_none());
        assert!(b.custom_messages.is_empty());
    }

    #[test]
    fn test_builder_with_trace_id() {
        let b = make_builder().with_trace_id("abc-123".to_string());
        assert_eq!(b.trace_id, "abc-123");
    }

    #[test]
    fn test_builder_with_is_super_true() {
        let b = make_builder().with_is_super(true);
        assert!(b.is_super);
    }

    #[test]
    fn test_builder_with_is_super_false() {
        let b = make_builder().with_is_super(false);
        assert!(!b.is_super);
    }

    #[test]
    fn test_builder_with_defer_lock_none() {
        let b = make_builder().with_defer_lock(None);
        assert!(b.defer_lock.is_none());
    }

    #[test]
    fn test_builder_with_start() {
        let t = std::time::Instant::now();
        let b = make_builder().with_start(t);
        let _ = b.start;
    }

    #[test]
    fn test_builder_with_custom_message() {
        let msg = PreCustomMessage::ScanStats(ScanStats::new());
        let b = make_builder().with_custom_message(msg);
        assert_eq!(b.custom_messages.len(), 1);
    }

    #[test]
    fn test_builder_chaining() {
        let b = make_builder()
            .with_trace_id("trace-xyz".to_string())
            .with_is_super(true);
        assert_eq!(b.trace_id, "trace-xyz");
        assert!(b.is_super);
    }

    // End-to-end: two partitions encode in parallel and merge onto one stream. Decode the
    // output and assert no rows are lost (cross-partition order is not preserved, so sort).
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_multi_partition_no_row_loss() {
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::Int32, false)]));
        let total = 6 * 8192i32;

        let make_partition = |range: std::ops::Range<i32>| -> SendableRecordBatchStream {
            let schema = schema.clone();
            let batches: Vec<RecordBatch> = range
                .clone()
                .step_by(8192)
                .map(|s| {
                    let end = (s + 8192).min(range.end);
                    let vals = Int32Array::from((s..end).collect::<Vec<i32>>());
                    RecordBatch::try_new(schema.clone(), vec![Arc::new(vals)]).unwrap()
                })
                .collect();
            Box::pin(RecordBatchStreamAdapter::new(
                schema.clone(),
                futures::stream::iter(batches.into_iter().map(Ok)),
            ))
        };

        let partitions = vec![
            make_partition(0..total / 2),
            make_partition(total / 2..total),
        ];

        let options = IpcWriteOptions::default()
            .try_with_compression(Some(arrow::ipc::CompressionType::ZSTD))
            .unwrap();
        let stream = FlightEncoderStreamBuilder::new(options, 33554432)
            .build(partitions, tracing::Span::none());

        let fds: Vec<FlightData> = stream.try_collect().await.unwrap();

        let dicts = std::collections::HashMap::new();
        let mut decoded: Vec<i32> = fds
            .iter()
            .flat_map(|fd| {
                let b = arrow_flight::utils::flight_data_to_arrow_batch(fd, schema.clone(), &dicts)
                    .unwrap();
                b.column(0)
                    .as_any()
                    .downcast_ref::<Int32Array>()
                    .unwrap()
                    .values()
                    .to_vec()
            })
            .collect();
        decoded.sort();

        assert_eq!(
            decoded,
            (0..total).collect::<Vec<_>>(),
            "no rows may be lost across partitions"
        );
    }
}
