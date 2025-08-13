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

use std::{fmt::Debug, ops::Sub, pin::Pin, task::Poll};

use arrow::array::RecordBatch;
use arrow_flight::{FlightData, error::Result};
use arrow_schema::SchemaRef;
use config::utils::size::bytes_to_human_readable;
use flight::{
    common::{CustomMessage, FlightMessage},
    decoder::FlightDataDecoder,
};
use futures::{Stream, StreamExt, ready};
use opentelemetry::trace::{Span, TraceId, Tracer};
use tonic::Streaming;

use crate::service::search::{
    datafusion::distributed_plan::common::{QueryContext, process_partial_err},
    inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
};

#[derive(Debug)]
pub struct FlightDecoderStream {
    inner: FlightDataDecoder,
    query_context: QueryContext,
}

impl FlightDecoderStream {
    /// Create a new [`FlightDecoderStream`] from a stream of [`FlightData`]
    pub fn new(
        inner: Streaming<FlightData>,
        schema: SchemaRef,
        query_context: QueryContext,
    ) -> Self {
        Self {
            inner: FlightDataDecoder::new(inner, Some(schema)),
            query_context,
        }
    }

    pub fn process_custom_message(&self, message: CustomMessage) {
        match message {
            CustomMessage::ScanStats(stats) => {
                self.query_context.scan_stats.lock().add(&stats);
            }
        }
    }
}

impl Stream for FlightDecoderStream {
    type Item = Result<RecordBatch>;

    /// Returns the next [`RecordBatch`] available in this stream, or `None` if
    /// there are no further results available.
    fn poll_next(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Result<RecordBatch>>> {
        loop {
            let res = ready!(self.inner.poll_next_unpin(cx));
            match res {
                // Inner exhausted
                None => {
                    return Poll::Ready(None);
                }
                Some(Err(e)) => {
                    log::error!(
                        "[trace_id {}] flight->search: response node: {}, is_super: {}, is_querier: {}, err: {e:?}, took: {} ms",
                        self.query_context.trace_id,
                        self.query_context.node.get_grpc_addr(),
                        self.query_context.is_super,
                        self.query_context.is_querier,
                        self.query_context.start.elapsed().as_millis(),
                    );
                    process_partial_err(self.query_context.partial_err.clone(), e.into());
                    return Poll::Ready(None);
                }
                // translate data
                Some(Ok(data)) => match data {
                    FlightMessage::RecordBatch(batch) => {
                        self.query_context.num_rows += batch.num_rows();
                        return Poll::Ready(Some(Ok(batch)));
                    }
                    FlightMessage::CustomMessage(message) => {
                        self.process_custom_message(message);
                    }
                    FlightMessage::Schema(_) => {
                        unreachable!("Current not send schema from follow node")
                    }
                },
            }
        }
    }
}

impl Drop for FlightDecoderStream {
    fn drop(&mut self) {
        let cfg = config::get_config();
        if (cfg.common.tracing_enabled || cfg.common.tracing_search_enabled)
            && let Err(e) = self.create_stream_end_span()
        {
            log::error!("error creating stream span: {e}");
        }
        let scan_stats = { *self.query_context.scan_stats.lock() };
        log::info!(
            "[trace_id {}] flight->search: response node: {}, is_super: {}, is_querier: {}, files: {}, scan_size: {} mb, num_rows: {}, took: {} ms",
            self.query_context.trace_id,
            self.query_context.node.get_grpc_addr(),
            self.query_context.is_super,
            self.query_context.is_querier,
            scan_stats.files,
            scan_stats.original_size / 1024 / 1024,
            self.query_context.num_rows,
            self.query_context.start.elapsed().as_millis()
        );
    }
}

/// Create a span for the stream end
impl FlightDecoderStream {
    fn create_stream_end_span(
        &self,
    ) -> std::result::Result<opentelemetry::trace::SpanContext, infra::errors::Error> {
        let tracer = opentelemetry::global::tracer("FlightDecoderStream");

        let QueryContext {
            trace_id,
            parent_cx,
            node,
            is_super,
            is_querier,
            scan_stats,
            start,
            num_rows,
            ..
        } = &self.query_context;

        let now = std::time::SystemTime::now();
        let duration = start.elapsed();
        let start_time = now.sub(duration);

        let trace_id = trace_id
            .split('-')
            .next()
            .and_then(|id| TraceId::from_hex(id).ok());
        match trace_id {
            Some(trace_id) => {
                let mut span = tracer
                    .span_builder("service:search:flight::do_get_stream")
                    .with_trace_id(trace_id)
                    .with_start_time(start_time)
                    .with_attributes(vec![opentelemetry::KeyValue::new(
                        "duration",
                        duration.as_nanos() as i64,
                    )])
                    .start_with_context(&tracer, parent_cx);

                let span_context = span.span_context().clone();
                let search_role = if *is_super {
                    "leader".to_string()
                } else {
                    "follower".to_string()
                };
                let scan_stats = { *scan_stats.lock() };
                let event = search_inspector_fields(
                    format!(
                        "[trace_id {}] flight->search: response node: {}, is_super: {}, is_querier: {}, files: {}, scan_size: {} mb, num_rows: {}, took: {} ms",
                        trace_id,
                        node.get_grpc_addr(),
                        is_super,
                        is_querier,
                        scan_stats.files,
                        scan_stats.original_size / 1024 / 1024,
                        num_rows,
                        start.elapsed().as_millis(),
                    ),
                    SearchInspectorFieldsBuilder::new()
                        .node_name(node.get_name())
                        .region(node.get_region())
                        .cluster(node.get_cluster())
                        .component("remote scan streaming".to_string())
                        .search_role(search_role)
                        .duration(start.elapsed().as_millis() as usize)
                        .desc(format!(
                            "remote scan search files: {}, scan_size: {}, num_rows: {}",
                            scan_stats.files,
                            bytes_to_human_readable(scan_stats.original_size as f64),
                            num_rows
                        ))
                        .build(),
                );

                span.add_event_with_timestamp(event, now, vec![]);
                span.end_with_timestamp(now);
                Ok(span_context)
            }
            None => Err(infra::errors::Error::Message(format!(
                "Invalid trace id: {}",
                self.query_context.trace_id
            ))),
        }
    }
}
