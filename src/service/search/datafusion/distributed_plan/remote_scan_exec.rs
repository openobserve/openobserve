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

use std::{
    any::Any,
    sync::{Arc, atomic::AtomicUsize},
};

use arrow_schema::SchemaRef;
use config::{
    meta::{
        inverted_index::IndexOptimizeMode,
        search::{ScanStats, SearchEventType},
    },
    utils::rand::generate_random_string,
};
use datafusion::{
    common::{DataFusionError, Result, Statistics},
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, Partitioning},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, PlanProperties,
        execution_plan::{Boundedness, EmissionType},
        metrics::{ExecutionPlanMetricsSet, MetricsSet},
        stream::RecordBatchStreamAdapter,
    },
};
use datafusion_proto::bytes::physical_plan_to_bytes_with_extension_codec;
use flight::common::{Metrics, RemoteScanMetrics};
use futures::{StreamExt, TryStreamExt};
use futures_util::pin_mut;
use parking_lot::Mutex;
use rand::prelude::SliceRandom;

use super::node::RemoteScanNode;
use crate::service::search::datafusion::distributed_plan::{
    codec::get_physical_extension_codec,
    common::{EmptyStream, QueryContext, get_empty_stream, process_partial_err},
    decoder_stream::FlightDecoderStream,
    utils::make_flight_client,
};

/// Execution plan for empty relation with produce_one_row=false
#[derive(Debug, Clone)]
pub struct RemoteScanExec {
    input: Arc<dyn ExecutionPlan>,
    remote_scan_node: RemoteScanNode,
    partitions: usize,
    cache: PlanProperties,
    pub scan_stats: Arc<Mutex<ScanStats>>,
    pub peak_memory: Arc<AtomicUsize>,
    pub partial_err: Arc<Mutex<String>>,
    pub cluster_metrics: Arc<Mutex<Vec<Metrics>>>,
    pub enrich_mode_node_idx: usize,
    pub metrics: ExecutionPlanMetricsSet,
}

impl RemoteScanExec {
    /// Create a new RemoteScanExec
    pub fn new(
        input: Arc<dyn ExecutionPlan>,
        mut remote_scan_node: RemoteScanNode,
    ) -> Result<Self> {
        let output_partitions = remote_scan_node.nodes.len();
        let cache = Self::compute_properties(Arc::clone(&input.schema()), output_partitions);

        // serialize the input plan and set it as the plan for the remote scan node
        let proto = get_physical_extension_codec();
        let physical_plan_bytes =
            physical_plan_to_bytes_with_extension_codec(input.clone(), &proto)?;
        remote_scan_node.set_plan(physical_plan_bytes.to_vec());

        // get the node ids for enrich mode
        let mut node_ids = remote_scan_node
            .nodes
            .iter()
            .enumerate()
            .filter_map(|(idx, n)| if n.is_querier() { Some(idx) } else { None })
            .collect::<Vec<_>>();
        // random shuffle the node ids
        node_ids.shuffle(&mut rand::rng());
        let enrich_mode_node_idx = node_ids.pop().unwrap_or_default();

        Ok(RemoteScanExec {
            input,
            remote_scan_node,
            partitions: output_partitions,
            cache,
            scan_stats: Arc::new(Mutex::new(ScanStats::default())),
            partial_err: Arc::new(Mutex::new(String::new())),
            cluster_metrics: Arc::new(Mutex::new(Vec::new())),
            peak_memory: Arc::new(AtomicUsize::new(0)),
            enrich_mode_node_idx,
            metrics: ExecutionPlanMetricsSet::new(),
        })
    }

    pub fn scan_stats(&self) -> Arc<Mutex<ScanStats>> {
        self.scan_stats.clone()
    }

    pub fn partial_err(&self) -> Arc<Mutex<String>> {
        self.partial_err.clone()
    }

    pub fn cluster_metrics(&self) -> Arc<Mutex<Vec<Metrics>>> {
        self.cluster_metrics.clone()
    }

    pub fn peak_memory(&self) -> Arc<AtomicUsize> {
        self.peak_memory.clone()
    }

    pub fn with_scan_stats(mut self, scan_stats: Arc<Mutex<ScanStats>>) -> Self {
        self.scan_stats = scan_stats;
        self
    }

    pub fn with_partial_err(mut self, partial_err: Arc<Mutex<String>>) -> Self {
        self.partial_err = partial_err;
        self
    }

    pub fn with_cluster_metrics(mut self, cluster_metrics: Arc<Mutex<Vec<Metrics>>>) -> Self {
        self.cluster_metrics = cluster_metrics;
        self
    }

    pub fn with_peak_memory(mut self, peak_memory: Arc<AtomicUsize>) -> Self {
        self.peak_memory = peak_memory;
        self
    }

    pub fn with_metrics(mut self, metrics: ExecutionPlanMetricsSet) -> Self {
        self.metrics = metrics;
        self
    }

    fn output_partitioning_helper(n_partitions: usize) -> Partitioning {
        Partitioning::UnknownPartitioning(n_partitions)
    }

    /// This function creates the cache object that stores the plan properties such as schema,
    /// equivalence properties, ordering, partitioning, etc.
    fn compute_properties(schema: SchemaRef, n_partitions: usize) -> PlanProperties {
        let eq_properties = EquivalenceProperties::new(schema);
        let output_partitioning = Self::output_partitioning_helper(n_partitions);
        PlanProperties::new(
            eq_properties,
            // Output Partitioning
            output_partitioning,
            // Execution Mode
            EmissionType::Incremental,
            Boundedness::Bounded,
        )
    }

    pub fn set_analyze(mut self) -> Self {
        self.remote_scan_node.search_infos.is_analyze = true;
        self
    }

    pub fn set_index_optimize_mode(mut self, index_optimize_mode: IndexOptimizeMode) -> Self {
        self.remote_scan_node.index_info.index_optimize_mode = Some(index_optimize_mode.into());
        self
    }

    #[cfg(test)]
    pub fn analyze(&self) -> bool {
        self.remote_scan_node.search_infos.is_analyze
    }

    #[cfg(test)]
    pub fn index_optimize_mode(&self) -> Option<IndexOptimizeMode> {
        self.remote_scan_node
            .index_info
            .index_optimize_mode
            .clone()
            .map(|x| x.into())
    }
}

impl DisplayAs for RemoteScanExec {
    fn fmt_as(&self, _t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(
            f,
            "RemoteScanExec: input_partitions=output_partitions={}",
            self.partitions,
        )
    }
}

impl ExecutionPlan for RemoteScanExec {
    fn name(&self) -> &'static str {
        "RemoteScanExec"
    }

    /// Return a reference to Any that can be used for downcasting
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> SchemaRef {
        Arc::clone(&self.input.schema())
    }

    fn properties(&self) -> &PlanProperties {
        &self.cache
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![&self.input]
    }

    fn with_new_children(
        self: Arc<Self>,
        children: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        if children.is_empty() {
            return Ok(self);
        }
        let remote_scan = Self::new(children[0].clone(), self.remote_scan_node.clone())?
            .with_scan_stats(self.scan_stats.clone())
            .with_partial_err(self.partial_err.clone())
            .with_cluster_metrics(self.cluster_metrics.clone())
            .with_peak_memory(self.peak_memory.clone())
            .with_metrics(self.metrics.clone());
        Ok(Arc::new(remote_scan))
    }

    fn execute(
        &self,
        partition: usize,
        _context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        let baseline_metrics = RemoteScanMetrics::new(partition, &self.metrics);
        let fut = get_remote_batch(
            self.remote_scan_node.clone(),
            partition,
            partition == self.enrich_mode_node_idx,
            self.input.schema().clone(),
            self.scan_stats(),
            self.partial_err(),
            self.cluster_metrics(),
            self.peak_memory(),
            baseline_metrics,
        );
        let stream = futures::stream::once(fut).try_flatten();
        Ok(Box::pin(RecordBatchStreamAdapter::new(
            self.schema().clone(),
            stream,
        )))
    }

    fn statistics(&self) -> Result<Statistics> {
        Ok(Statistics::new_unknown(&self.schema()))
    }

    fn metrics(&self) -> Option<MetricsSet> {
        Some(self.metrics.clone_inner())
    }
}

#[allow(clippy::too_many_arguments)]
async fn get_remote_batch(
    remote_scan_node: RemoteScanNode,
    partition: usize,
    enrich_mode: bool,
    schema: SchemaRef,
    scan_stats: Arc<Mutex<ScanStats>>,
    partial_err: Arc<Mutex<String>>,
    cluster_metrics: Arc<Mutex<Vec<Metrics>>>,
    peak_memory: Arc<AtomicUsize>,
    metrics: RemoteScanMetrics,
) -> Result<SendableRecordBatchStream> {
    let start = std::time::Instant::now();
    let cfg = config::get_config();
    let trace_id = remote_scan_node.query_identifier.trace_id.clone();
    let org_id = remote_scan_node.query_identifier.org_id.clone();
    let context = remote_scan_node.opentelemetry_context.clone();
    let node = remote_scan_node.nodes[partition].clone();
    let is_super = remote_scan_node.super_cluster_info.is_super_cluster;
    let is_querier = node.is_querier();
    let is_ingester = node.is_ingester();
    let grpc_addr = node.get_grpc_addr();
    let node_name = node.get_name();
    let search_type = remote_scan_node
        .super_cluster_info
        .search_event_type
        .as_ref()
        .and_then(|s| s.as_str().try_into().ok());

    // check timeout
    let mut timeout = remote_scan_node.search_infos.timeout;
    if timeout == 0 {
        timeout = cfg.limit.query_timeout;
    }
    // check grpc timeout
    let mut grpc_timeout = timeout;
    if matches!(search_type, Some(SearchEventType::UI)) {
        if is_querier {
            grpc_timeout = std::cmp::min(grpc_timeout, cfg.limit.query_querier_timeout);
        } else if is_ingester {
            grpc_timeout = std::cmp::min(grpc_timeout, cfg.limit.query_ingester_timeout);
        }
    }

    let empty_stream = EmptyStream::new(
        &trace_id,
        schema.clone(),
        &grpc_addr,
        is_querier,
        partial_err.clone(),
        start,
    );

    // fast return for empty file list querier node
    if !is_super
        && is_querier
        && !is_ingester
        && !enrich_mode
        && remote_scan_node.is_file_list_empty(partition)
    {
        return Ok(get_empty_stream(empty_stream));
    }

    let mut request = remote_scan_node.get_flight_search_request(partition);
    request.set_job_id(generate_random_string(7));
    request.set_partition(partition);
    request.search_info.timeout = timeout as i64;
    request.query_identifier.enrich_mode = enrich_mode;

    log::info!(
        "[trace_id {trace_id}] flight->search: request node: {grpc_addr}, name: {node_name}, query_type: {}, is_super: {is_super}, is_querier: {is_querier}, timeout: {timeout}, files: {}",
        search_type.unwrap_or(SearchEventType::UI),
        request.search_info.file_id_list.len(),
    );

    let (mut client, request) = match make_flight_client(
        trace_id.clone(),
        &org_id,
        node.clone(),
        request,
        &context,
        grpc_timeout,
    )
    .await
    {
        Ok((client, request)) => (client, request),
        Err(e) => {
            return Ok(get_empty_stream(empty_stream.with_error(e)));
        }
    };

    log::info!(
        "[trace_id {trace_id}] flight->search: prepare to request node: {grpc_addr}, name: {node_name}, is_super: {is_super}, is_querier: {is_querier}",
    );

    let stream = match client.do_get(request).await {
        Ok(stream) => stream,
        Err(e) => {
            if e.code() == tonic::Code::Cancelled || e.code() == tonic::Code::DeadlineExceeded || is_parquet_file_not_found(&e) {
                return Ok(get_empty_stream(empty_stream.with_error(e)));
            }
            log::error!(
                "[trace_id {trace_id}] flight->search: response node: {grpc_addr}, name: {node_name}, is_super: {is_super}, is_querier: {is_querier}, err: {e:?}, took: {} ms",
                start.elapsed().as_millis(),
            );
            return Err(DataFusionError::Execution(e.to_string()));
        }
    }
    .into_inner();

    log::info!(
        "[trace_id {trace_id}] flight->search: prepare to response node: {grpc_addr}, name: {node_name}, is_super: {is_super}, is_querier: {is_querier}",
    );

    let query_context = QueryContext::new(node)
        .with_trace_id(&trace_id)
        .with_is_super(is_super)
        .with_is_querier(is_querier)
        .with_scan_stats(scan_stats)
        .with_partial_err(partial_err.clone())
        .with_cluster_metrics(cluster_metrics)
        .with_peak_memory(peak_memory)
        .with_start_time(start);

    let mut stream = FlightDecoderStream::new(stream, schema.clone(), metrics, query_context);
    let stream = async_stream::stream! {
        let timeout = tokio::time::sleep(tokio::time::Duration::from_secs(timeout));
        pin_mut!(timeout);
        loop {
            tokio::select! {
                batch = stream.next() => {
                    if let Some(batch) = batch {
                        yield batch.map_err(|e| DataFusionError::Internal(format!("{e}")))
                    } else {
                        break;
                    }
                }
                _ = &mut timeout => {
                    let e = tonic::Status::new(tonic::Code::DeadlineExceeded, "timeout");
                    log::error!(
                        "[trace_id {trace_id}] flight->search: response node: {grpc_addr}, name: {node_name}, is_super: {is_super}, is_querier: {is_querier}, err: {e:?}, took: {} ms",
                        start.elapsed().as_millis(),
                    );
                    process_partial_err(partial_err, e);
                    break;
                }
            }
        }
    };

    Ok(Box::pin(RecordBatchStreamAdapter::new(schema, stream)))
}

pub fn is_parquet_file_not_found(e: &tonic::Status) -> bool {
    e.code() == tonic::Code::Internal && {
        let msg = e.message();
        msg.find('{')
            .and_then(|start| msg.rfind('}').map(|end| &msg[start..=end]))
            .and_then(|json_part| infra::errors::ErrorCodes::from_json(json_part).ok())
            .map(|err_code| {
                err_code.get_code()
                    == infra::errors::ErrorCodes::SearchParquetFileNotFound.get_code()
            })
            .unwrap_or(false)
    }
}
