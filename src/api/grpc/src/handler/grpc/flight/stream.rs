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

use arrow::ipc::{CompressionType, writer::IpcWriteOptions};
use arrow_flight::{FlightData, error::FlightError};
use config::metrics;
use datafusion::execution::SendableRecordBatchStream;
use flight::{common::NodeMessages, encoder::FlightDataEncoder};
use futures::{Stream, StreamExt};
use search_service::work_group::DeferredLock;
use tokio::{sync::mpsc, task::JoinSet};
use tracing::info_span;
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::handler::grpc::flight::{SessionGuard, partition_encoder::PartitionEncoderStream};

/// Cap on one encoded FlightData message. Mirrors the `ZO_GRPC_MAX_MESSAGE_SIZE` default,
/// which is what the receiving channel accepts.
pub(super) const MAX_FLIGHT_DATA_SIZE: usize = 32 * 1024 * 1024;

pub struct FlightEncoderStreamBuilder {
    node_messages: NodeMessages,
    // query context
    trace_id: String,
    is_super: bool,
    defer_lock: Option<DeferredLock>,
    session_guard: Option<SessionGuard>,
    start: std::time::Instant,
}

impl FlightEncoderStreamBuilder {
    pub(crate) fn new(session_guard: SessionGuard, node_messages: NodeMessages) -> Self {
        Self {
            node_messages,
            trace_id: String::new(),
            is_super: false,
            defer_lock: None,
            session_guard: Some(session_guard),
            start: std::time::Instant::now(),
        }
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

    /// Build the encoder stream from the plan's output partitions.
    ///
    /// One partition is polled inline; multiple partitions each get a task encoding in parallel,
    /// merged over a shared channel (like `CoalescePartitionsExec`).
    pub fn build(
        self,
        partitions: Vec<SendableRecordBatchStream>,
        span: tracing::Span,
    ) -> FlightEncoderStream {
        let child_span = info_span!("grpc:search:flight:execute_physical_plan");
        let _ = child_span.set_parent(span.context());
        let options = write_options();

        let (source, tasks) = if partitions.len() == 1 {
            // one partition: no parallelism to gain, poll inline (no task, no channel)
            let inner = partitions.into_iter().next().unwrap();
            let stream = PartitionEncoderStream::new(inner, options.clone());
            (FlightSource::Inline(Box::new(stream)), JoinSet::new())
        } else {
            // one task per partition, merged over the channel
            let cap = (partitions.len() * 2).max(2);
            let mut tasks = JoinSet::new();
            let (tx, rx) = mpsc::channel::<Result<Vec<FlightData>, FlightError>>(cap);
            for inner in partitions {
                let tx = tx.clone();
                let mut stream = PartitionEncoderStream::new(inner, options.clone());
                tasks.spawn(async move {
                    while let Some(item) = stream.next().await {
                        let is_err = item.is_err();
                        if tx.send(item).await.is_err() {
                            break; // receiver gone (client disconnect / error)
                        }
                        if is_err {
                            break;
                        }
                    }
                });
            }
            (FlightSource::Channel(rx), tasks)
        };

        FlightEncoderStream {
            source,
            encoder: FlightDataEncoder::new(options, MAX_FLIGHT_DATA_SIZE),
            queue: VecDeque::new(),
            node_messages: self.node_messages,
            first_data: true,
            done: false,
            ctx: StreamContext {
                trace_id: self.trace_id,
                is_super: self.is_super,
                start: self.start,
                span,
                child_span,
                tasks,
                defer_lock: self.defer_lock,
                session_guard: self.session_guard,
            },
            log: EventLog::new(config::get_config().common.print_key_event),
        }
    }
}

/// Encoded FlightData groups: parallel partition tasks merged over a channel, or one partition
/// polled inline.
enum FlightSource {
    Channel(mpsc::Receiver<Result<Vec<FlightData>, FlightError>>),
    Inline(Box<PartitionEncoderStream>),
}

pub struct FlightEncoderStream {
    /// one coalesced chunk (dictionary + records) per item
    source: FlightSource,
    /// Only used to encode custom messages (scan stats, peak memory, ...).
    encoder: FlightDataEncoder,
    queue: VecDeque<FlightData>,
    node_messages: NodeMessages,
    first_data: bool,
    done: bool,
    /// query context + resources consumed by the stream's `Drop` teardown.
    ctx: StreamContext,
    /// per-message logging.
    log: EventLog,
}

struct StreamContext {
    trace_id: String,
    is_super: bool,
    start: std::time::Instant,
    span: tracing::Span,
    child_span: tracing::Span,
    /// per-partition encoder tasks; drained so panics fail the stream.
    tasks: JoinSet<()>,
    /// set only for super cluster follower leader.
    defer_lock: Option<DeferredLock>,
    /// releases the wal locks and the datafusion file list of this request.
    session_guard: Option<SessionGuard>,
}

struct EventLog {
    enabled: bool,
    /// messages yielded so far.
    req_id: u64,
    /// when the last message was yielded, for inter-message latency.
    req_last_time: std::time::Instant,
}

impl EventLog {
    fn new(enabled: bool) -> Self {
        Self {
            enabled,
            req_id: 0,
            req_last_time: std::time::Instant::now(),
        }
    }

    /// Record a yielded message, logging it when enabled and due (slow gap or power-of-two count).
    fn on_message(&mut self, trace_id: &str, is_super: bool) {
        self.req_id += 1;
        let took = self.req_last_time.elapsed().as_millis();
        self.req_last_time = std::time::Instant::now();
        if self.enabled && (took > 100 || config::utils::util::is_power_of_two(self.req_id)) {
            log::info!(
                "[trace_id {trace_id}] flight->search: stream Poll::Ready(#{}) message, is_super: {is_super}, took: {took} ms",
                self.req_id,
            );
        }
    }

    /// Log stream completion (time since the last message).
    fn on_end(&self, trace_id: &str, is_super: bool) {
        if self.enabled {
            log::info!(
                "[trace_id {trace_id}] flight->search: stream Poll::Ready(None) is_super: {is_super}, took: {} ms",
                self.req_last_time.elapsed().as_millis(),
            );
        }
    }
}

impl FlightEncoderStream {
    /// Queues the node's messages due now; a stream with no batch sends its first ones at the end.
    fn encode_node_messages(&mut self, at_end: bool) -> Result<(), FlightError> {
        let mut messages = Vec::new();
        if self.first_data {
            messages.extend(self.node_messages.first());
        }
        if at_end {
            messages.extend(self.node_messages.last());
        }
        self.first_data = false;
        for message in messages {
            let flight_data = self.encoder.encode_custom(&message)?;
            self.queue.push_back(flight_data);
        }
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

    /// Poll the next encoded group from the channel or the inline encoder.
    fn poll_source(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Result<Vec<FlightData>, FlightError>>> {
        match &mut self.source {
            FlightSource::Channel(rx) => rx.poll_recv(cx),
            FlightSource::Inline(stream) => stream.poll_next_unpin(cx),
        }
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
            // 1. reap completed encoder tasks and surface panics promptly.
            while let Poll::Ready(Some(result)) = this.ctx.tasks.poll_join_next(cx) {
                if let Err(e) = result {
                    log::error!(
                        "[trace_id {}] flight->search: partition encoder task failed: {e:?}, is_super: {}, took: {} ms",
                        this.ctx.trace_id,
                        this.ctx.is_super,
                        this.ctx.start.elapsed().as_millis()
                    );
                    return this.fail(format!("partition encoder task failed: {e}"));
                }
            }

            // 2. yield any already-encoded output
            if let Some(data) = this.queue.pop_front() {
                this.log.on_message(&this.ctx.trace_id, this.ctx.is_super);
                return Poll::Ready(Some(Ok(data)));
            }

            // 3. fully finished
            if this.done {
                this.log.on_end(&this.ctx.trace_id, this.ctx.is_super);
                return Poll::Ready(None);
            }

            // 4. pull the next encoded FlightData from the partition encoder(s)
            match this.poll_source(cx) {
                Poll::Ready(Some(Ok(group))) => {
                    if this.first_data
                        && let Err(e) = this.encode_node_messages(false)
                    {
                        return this.fail(e);
                    }
                    // enqueue the whole group so the chunk's dictionary and records stay contiguous
                    this.queue.extend(group);
                    continue;
                }
                Poll::Ready(Some(Err(e))) => {
                    log::error!(
                        "[trace_id {}] flight->search: stream error: {e:?}, is_super: {}, took: {} ms",
                        this.ctx.trace_id,
                        this.ctx.is_super,
                        this.ctx.start.elapsed().as_millis()
                    );
                    return this.fail(e);
                }
                Poll::Ready(None) => {
                    // All senders are gone; finish only after every task is reaped.
                    if !this.ctx.tasks.is_empty() {
                        return Poll::Pending;
                    }
                    if let Err(e) = this.encode_node_messages(true) {
                        return this.fail(e);
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
        let ctx = &mut self.ctx;
        // Stop partition tasks before clearing session data they may still read.
        ctx.tasks.abort_all();

        let trace_id = &ctx.trace_id;
        let is_super = ctx.is_super;
        let took = ctx.start.elapsed().as_millis();
        log::info!(
            "[trace_id {trace_id}] flight->search: stream end, is_super: {is_super}, took: {took} ms"
        );

        let _child_enter = ctx.child_span.enter();
        let _enter = ctx.span.enter();
        drop(_child_enter);
        drop(_enter);

        // metrics
        let time = ctx.start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/search/flight/do_get", "200", "", "", "", ""])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/search/flight/do_get", "200", "", "", "", ""])
            .inc();

        // the defer only covers the work group slot, so it never gates the session release
        drop(ctx.defer_lock.take());
        drop(ctx.session_guard.take());
        log::info!(
            "[trace_id {trace_id}] flight->search: drop FlightEncoderStream, is_super: {is_super}",
        );
    }
}

fn write_options() -> IpcWriteOptions {
    IpcWriteOptions::default()
        .try_with_compression(Some(CompressionType::ZSTD))
        // Cannot fail: compression only needs IPC metadata V5, which is the default.
        .expect("default IPC options accept compression")
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int32Array, RecordBatch};
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::search::ScanStats;
    use datafusion::physical_plan::stream::RecordBatchStreamAdapter;
    use flight::common::{CustomMessage, NodeRole};
    use futures::TryStreamExt;

    use super::*;

    fn make_builder() -> FlightEncoderStreamBuilder {
        FlightEncoderStreamBuilder::new(
            SessionGuard::new("test-trace".to_string()),
            follower_messages(),
        )
    }

    #[test]
    fn test_builder_new_defaults() {
        let b = make_builder();
        assert_eq!(b.trace_id, "");
        assert!(!b.is_super);
        assert!(b.defer_lock.is_none());
        assert!(b.session_guard.is_some());
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

    fn follower_messages() -> NodeMessages {
        NodeMessages {
            scan_stats: ScanStats::new(),
            peak_memory: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            profile: None,
            role: NodeRole::Follower,
        }
    }

    async fn message_kinds(partition: SendableRecordBatchStream) -> Vec<&'static str> {
        let fds: Vec<FlightData> = make_builder()
            .build(vec![partition], tracing::Span::none())
            .try_collect()
            .await
            .unwrap();
        fds.iter()
            .map(
                |fd| match config::utils::json::from_slice(&fd.app_metadata) {
                    Ok(CustomMessage::ScanStats(_)) => "ScanStats",
                    Ok(CustomMessage::PeakMemory(_)) => "PeakMemory",
                    Ok(_) => "other",
                    Err(_) => "data",
                },
            )
            .collect()
    }

    #[tokio::test]
    async fn test_node_messages_surround_the_batches() {
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::Int32, false)]));
        let batch =
            RecordBatch::try_new(schema.clone(), vec![Arc::new(Int32Array::from(vec![1, 2]))])
                .unwrap();
        let with_rows: SendableRecordBatchStream = Box::pin(RecordBatchStreamAdapter::new(
            schema.clone(),
            futures::stream::iter(vec![Ok(batch)]),
        ));
        let kinds = message_kinds(with_rows).await;
        assert_eq!(kinds.first(), Some(&"ScanStats"));
        assert_eq!(kinds.last(), Some(&"PeakMemory"));
        assert!(kinds[1..kinds.len() - 1].iter().all(|kind| *kind == "data"));

        let empty: SendableRecordBatchStream = Box::pin(RecordBatchStreamAdapter::new(
            schema,
            futures::stream::empty(),
        ));
        assert_eq!(message_kinds(empty).await, ["ScanStats", "PeakMemory"]);
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

        let stream = FlightEncoderStreamBuilder::new(
            SessionGuard::new("test-trace".to_string()),
            follower_messages(),
        )
        .build(partitions, tracing::Span::none());

        let fds: Vec<FlightData> = stream.try_collect().await.unwrap();

        let dicts = std::collections::HashMap::new();
        let mut decoded: Vec<i32> = fds
            .iter()
            .filter(|fd| fd.app_metadata.is_empty())
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

    // A panicked partition task must fail the stream, not return a truncated OK.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_multi_partition_task_panic_fails_stream() {
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::Int32, false)]));

        let ok_batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from((0..100).collect::<Vec<i32>>()))],
        )
        .unwrap();
        let ok_partition: SendableRecordBatchStream = Box::pin(RecordBatchStreamAdapter::new(
            schema.clone(),
            futures::stream::iter(vec![Ok(ok_batch)]),
        ));
        let panic_partition: SendableRecordBatchStream = Box::pin(RecordBatchStreamAdapter::new(
            schema.clone(),
            futures::stream::poll_fn(
                |_cx| -> Poll<Option<datafusion::error::Result<RecordBatch>>> {
                    panic!("boom in partition")
                },
            ),
        ));

        let stream = FlightEncoderStreamBuilder::new(
            SessionGuard::new("test-trace".to_string()),
            follower_messages(),
        )
        .build(vec![ok_partition, panic_partition], tracing::Span::none());

        let result: Result<Vec<FlightData>, tonic::Status> = stream.try_collect().await;
        let err = result.expect_err("panicked partition task must fail the stream");
        assert!(
            err.message().contains("panic"),
            "error should mention the panic: {err}"
        );
    }

    /// Decode in stream order like the leader's `FlightDataDecoder`: one shared dict-id -> values
    /// map, updated by each DictionaryBatch and read by each RecordBatch.
    fn decode_in_order(fds: &[FlightData], schema: Arc<Schema>) -> Vec<RecordBatch> {
        use std::collections::HashMap;

        use arrow::{
            array::ArrayRef,
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
                            data,
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

    // Two partitions with DISTINCT dictionaries under the shared dict-id 0. Group-atomic merge
    // keeps each chunk's dictionary next to its records, so the leader's shared-map decoder
    // never binds a record to another partition's dictionary. Decode like the leader and check
    // every label.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_multi_partition_dictionary_no_mixup() {
        use arrow::array::{ArrayRef, DictionaryArray, StringArray, types::Int32Type};

        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int32, false),
            Field::new(
                "label",
                DataType::Dictionary(Box::new(DataType::Int32), Box::new(DataType::Utf8)),
                false,
            ),
        ]));

        let chunk = 8192i32;
        let chunks_per_partition = 3i32;
        let n_per_partition = chunk * chunks_per_partition;
        // Distinct dictionaries (different values AND lengths) so a mixup would corrupt the label.
        let labels: [Vec<&str>; 2] = [
            vec!["p0v0", "p0v1", "p0v2"],
            vec!["p1v0", "p1v1", "p1v2", "p1v3"],
        ];

        let make_partition = |p: usize, id_base: i32| -> SendableRecordBatchStream {
            let schema = schema.clone();
            let values: ArrayRef = Arc::new(StringArray::from(labels[p].clone()));
            let dict_len = labels[p].len() as i32;
            let batches: Vec<RecordBatch> = (0..chunks_per_partition)
                .map(|c| {
                    let start = c * chunk;
                    let ids = Int32Array::from(
                        (0..chunk).map(|i| id_base + start + i).collect::<Vec<_>>(),
                    );
                    let keys = Int32Array::from(
                        (0..chunk)
                            .map(|i| (start + i) % dict_len)
                            .collect::<Vec<_>>(),
                    );
                    let label =
                        DictionaryArray::<Int32Type>::try_new(keys, values.clone()).unwrap();
                    RecordBatch::try_new(schema.clone(), vec![Arc::new(ids), Arc::new(label)])
                        .unwrap()
                })
                .collect();
            Box::pin(RecordBatchStreamAdapter::new(
                schema.clone(),
                futures::stream::iter(batches.into_iter().map(Ok)),
            ))
        };

        let id_base_1 = n_per_partition;
        let partitions = vec![make_partition(0, 0), make_partition(1, id_base_1)];

        let stream = FlightEncoderStreamBuilder::new(
            SessionGuard::new("test-trace".to_string()),
            follower_messages(),
        )
        .build(partitions, tracing::Span::none());
        let fds: Vec<FlightData> = stream.try_collect().await.unwrap();

        let decoded = decode_in_order(&fds, schema.clone());

        let expected_label = |id: i32| -> &'static str {
            let (set, base) = if id < id_base_1 {
                (0usize, 0)
            } else {
                (1usize, id_base_1)
            };
            let k = ((id - base) % labels[set].len() as i32) as usize;
            labels[set][k]
        };

        let mut seen = 0usize;
        for batch in &decoded {
            let ids = batch
                .column(0)
                .as_any()
                .downcast_ref::<Int32Array>()
                .unwrap();
            let label_col = batch
                .column(1)
                .as_any()
                .downcast_ref::<DictionaryArray<Int32Type>>()
                .unwrap();
            let dict_vals = label_col
                .values()
                .as_any()
                .downcast_ref::<StringArray>()
                .unwrap();
            for row in 0..batch.num_rows() {
                let id = ids.value(row);
                let got = dict_vals.value(label_col.keys().value(row) as usize);
                assert_eq!(got, expected_label(id), "label mixed up for id {id}");
                seen += 1;
            }
        }
        assert_eq!(
            seen,
            2 * n_per_partition as usize,
            "every row must survive with its own dictionary"
        );
    }

    // Single partition takes the inline fast path; verify it round-trips every row in order.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_single_partition_inline() {
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::Int32, false)]));
        let total = 3 * 8192i32;

        let batches: Vec<RecordBatch> = (0..total)
            .step_by(8192)
            .map(|s| {
                let end = (s + 8192).min(total);
                let vals = Int32Array::from((s..end).collect::<Vec<i32>>());
                RecordBatch::try_new(schema.clone(), vec![Arc::new(vals)]).unwrap()
            })
            .collect();
        let inner: SendableRecordBatchStream = Box::pin(RecordBatchStreamAdapter::new(
            schema.clone(),
            futures::stream::iter(batches.into_iter().map(Ok)),
        ));

        let stream = FlightEncoderStreamBuilder::new(
            SessionGuard::new("test-trace".to_string()),
            follower_messages(),
        )
        .build(vec![inner], tracing::Span::none());

        // one partition -> inline source, no tasks
        assert!(matches!(stream.source, FlightSource::Inline(_)));
        assert!(stream.ctx.tasks.is_empty());

        let fds: Vec<FlightData> = stream.try_collect().await.unwrap();
        let dicts = std::collections::HashMap::new();
        let decoded: Vec<i32> = fds
            .iter()
            .filter(|fd| fd.app_metadata.is_empty())
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

        assert_eq!(
            decoded,
            (0..total).collect::<Vec<_>>(),
            "single partition must preserve order and lose no rows"
        );
    }
}
