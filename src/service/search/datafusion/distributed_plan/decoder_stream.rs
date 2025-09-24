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

use std::{fmt::Debug, pin::Pin, task::Poll};

use arrow::array::RecordBatch;
use arrow_flight::{FlightData, error::Result};
use arrow_schema::SchemaRef;
use config::{meta::search::ScanStats, utils::size::bytes_to_human_readable};
use datafusion::physical_plan::metrics::{BaselineMetrics, RecordOutput};
use flight::{
    common::{CustomMessage, FlightMessage},
    decoder::FlightDataDecoder,
};
use futures::{Stream, StreamExt, ready};
use tonic::Streaming;

use crate::service::search::{
    datafusion::distributed_plan::common::{QueryContext, process_partial_err},
    inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
};

#[derive(Debug)]
pub struct FlightDecoderStream {
    inner: FlightDataDecoder,
    metrics: BaselineMetrics,
    query_context: QueryContext,
    scan_stats: ScanStats,
}

impl FlightDecoderStream {
    /// Create a new [`FlightDecoderStream`] from a stream of [`FlightData`]
    pub fn new(
        inner: Streaming<FlightData>,
        schema: SchemaRef,
        metrics: BaselineMetrics,
        query_context: QueryContext,
    ) -> Self {
        Self {
            inner: FlightDataDecoder::new(inner, Some(schema), metrics.clone()),
            metrics,
            query_context,
            scan_stats: ScanStats::default(),
        }
    }

    pub fn process_custom_message(&mut self, message: CustomMessage) {
        match message {
            CustomMessage::ScanStats(stats) => {
                self.scan_stats.add(&stats);
                self.query_context.scan_stats.lock().add(&stats);
            }
            CustomMessage::Metrics(metrics) => {
                self.query_context.cluster_metrics.lock().extend(metrics);
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
        let poll;
        loop {
            let res = ready!(self.inner.poll_next_unpin(cx));
            match res {
                // Inner exhausted
                None => {
                    poll = Poll::Ready(None);
                    break;
                }
                Some(Err(e)) => {
                    log::error!(
                        "[trace_id {}] flight->search: response node: {}, name: {}, is_super: {}, is_querier: {}, err: {e:?}, took: {} ms",
                        self.query_context.trace_id,
                        self.query_context.node.get_grpc_addr(),
                        self.query_context.node.get_name(),
                        self.query_context.is_super,
                        self.query_context.is_querier,
                        self.query_context.start.elapsed().as_millis(),
                    );
                    process_partial_err(self.query_context.partial_err.clone(), e.into());
                    poll = Poll::Ready(None);
                    break;
                }
                // translate data
                Some(Ok(data)) => match data {
                    FlightMessage::RecordBatch(batch) => {
                        self.query_context.num_rows += batch.num_rows();
                        poll = Poll::Ready(Some(Ok(batch)));
                        break;
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
        record_poll(&self.metrics, poll)
    }
}

impl Drop for FlightDecoderStream {
    fn drop(&mut self) {
        let QueryContext {
            trace_id,
            node,
            is_super,
            is_querier,
            start,
            num_rows,
            ..
        } = &self.query_context;

        let search_role = if *is_super {
            "leader".to_string()
        } else {
            "follower".to_string()
        };
        let scan_stats = self.scan_stats;

        log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] flight->search: response node: {}, name: {}, is_super: {is_super}, is_querier: {is_querier}, files: {}, scan_size: {} mb, num_rows: {num_rows}, took: {} ms",
                    node.get_grpc_addr(),
                    node.get_name(),
                    scan_stats.files,
                    scan_stats.original_size / 1024 / 1024,
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
            )
        )
    }
}

fn record_poll(
    metrics: &BaselineMetrics,
    poll: Poll<Option<Result<RecordBatch>>>,
) -> Poll<Option<Result<RecordBatch>>> {
    if let Poll::Ready(maybe_batch) = &poll {
        match maybe_batch {
            Some(Ok(batch)) => {
                batch.record_output(metrics);
            }
            Some(Err(_)) => metrics.done(),
            None => metrics.done(),
        }
    }
    poll
}
