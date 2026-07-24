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

#[cfg(feature = "enterprise")]
use std::hash::{Hash, Hasher};
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock as Lazy,
    time::{Duration, Instant},
};

use anyhow::{Result, anyhow};
use async_trait::async_trait;
use chrono::Utc;
#[cfg(feature = "enterprise")]
use config::meta::{destinations::Module, pipeline::components::WorkflowDestination};
use config::{
    meta::{
        function::{Transform, VRLResultResolver},
        pipeline::{Pipeline, PipelineKind, components::NodeData},
        self_reporting::error::{ErrorData, ErrorSource, NodeErrors, PipelineError},
        stream::{StreamParams, StreamType},
    },
    metrics,
    stats::MemorySize,
    utils::{
        flatten,
        json::{self, Value, get_string_value},
        schema::format_stream_name,
    },
};
use futures::future::try_join_all;
use infra::table::workflows::Workflow;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::pipeline::pipeline_wal_writer::get_pipeline_wal_writer;
use proto::cluster_rpc;
#[cfg(feature = "enterprise")]
use tokio::sync::Mutex;
use tokio::sync::mpsc::{Receiver, Sender, channel};
use transform::{
    QUERY_FUNCTIONS, apply_vrl_fn, compile_vrl_function,
    js::{JSRuntimeConfig, apply_js_fn, compile_js_function},
};
use usage_reporting::publish_error;

use crate::alerts::{ConditionExt, ConditionGroupExt};

// Global batch buffer for accumulating remote stream records
#[cfg(feature = "enterprise")]
#[derive(Debug)]
struct BatchBuffer {
    records: Vec<json::Value>,
    total_bytes: usize,
    last_write: Instant,
}

#[derive(Default)]
pub struct WorkflowResult {
    pub stream_details: HashMap<StreamParams, Vec<(usize, Value)>>,
    pub errors: HashMap<String, NodeErrors>,
}

#[cfg(feature = "enterprise")]
fn eval_sampling_key(record: &json::Value, idx: usize) -> String {
    record
        .get("span_id")
        .and_then(|v| v.as_str())
        .or_else(|| record.get("trace_id").and_then(|v| v.as_str()))
        .map(str::to_owned)
        .unwrap_or_else(|| idx.to_string())
}

#[cfg(feature = "enterprise")]
fn should_sample_eval_record(record: &json::Value, idx: usize, sampling_rate: f64) -> bool {
    if sampling_rate >= 1.0 {
        return true;
    }
    if sampling_rate <= 0.0 || sampling_rate.is_nan() {
        return false;
    }

    let sample_key = eval_sampling_key(record, idx);

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    sample_key.hash(&mut hasher);
    let bucket = hasher.finish() as f64 / u64::MAX as f64;
    bucket < sampling_rate
}

#[cfg(feature = "enterprise")]
impl BatchBuffer {
    fn new() -> Self {
        Self {
            records: Vec::new(),
            total_bytes: 0,
            last_write: Instant::now(),
        }
    }

    fn add_records(&mut self, new_records: Vec<json::Value>) {
        for record in new_records {
            self.total_bytes += record.to_string().len();
            self.records.push(record);
        }
    }

    fn should_flush(&self) -> bool {
        const MAX_BATCH_SIZE: usize = 50; // Flush after 50 records
        const MAX_BATCH_BYTES: usize = 32 * 1024; // Or 32KB
        const MAX_BATCH_TIME_MS: u64 = 5000; // Or 5 seconds

        self.records.len() >= MAX_BATCH_SIZE
            || self.total_bytes >= MAX_BATCH_BYTES
            || self.last_write.elapsed() >= Duration::from_millis(MAX_BATCH_TIME_MS)
    }

    fn take_records(&mut self) -> Vec<json::Value> {
        self.last_write = Instant::now();
        self.total_bytes = 0;
        std::mem::take(&mut self.records)
    }
}

#[cfg(feature = "enterprise")]
static BATCH_BUFFERS: Lazy<Mutex<HashMap<String, BatchBuffer>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static DYNAMIC_STREAM_NAME_PATTERN: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"\{([^}]+)\}").unwrap());

/// Enum to represent compiled function runtime (VRL or JS)
#[derive(Clone, Debug)]
pub enum CompiledFunctionRuntime {
    VRL(Box<VRLResultResolver>, bool), // (resolver, is_result_array)
    JS(JSRuntimeConfig, bool),         // (js_config, is_result_array)
}

impl MemorySize for CompiledFunctionRuntime {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<CompiledFunctionRuntime>()
            + match self {
                CompiledFunctionRuntime::VRL(vrl_result_resolver, _) => {
                    vrl_result_resolver.mem_size()
                }
                CompiledFunctionRuntime::JS(js_config, _) => js_config.mem_size(),
            }
    }
}

#[async_trait]
pub trait PipelineExt: Sync + Send + 'static {
    /// Registers the function of all the FunctionNode of this pipeline once for execution.
    /// Returns a map of node_id -> CompiledFunctionRuntime for quick lookup
    async fn register_functions(&self) -> Result<HashMap<String, CompiledFunctionRuntime>>;
}

#[async_trait]
impl PipelineExt for Pipeline {
    async fn register_functions(&self) -> Result<HashMap<String, CompiledFunctionRuntime>> {
        let mut function_map = HashMap::new();
        for node in &self.nodes {
            if let NodeData::Function(func_params) = &node.data {
                let transform = get_transforms(&self.org, &func_params.name).await?;

                // Check if function is JS or VRL
                let compiled_runtime = if transform.is_js() {
                    // Compile JS function
                    let js_config = compile_js_function(&transform.function, &self.org)?;
                    CompiledFunctionRuntime::JS(js_config, transform.is_result_array_js())
                } else {
                    // Compile VRL function (default)
                    let vrl_runtime_config = compile_vrl_function(&transform.function, &self.org)?;
                    let registry = vrl_runtime_config
                        .config
                        .get_custom::<vector_enrichment::TableRegistry>()
                        .unwrap();
                    registry.finish_load();
                    CompiledFunctionRuntime::VRL(
                        Box::new(VRLResultResolver {
                            program: vrl_runtime_config.program,
                            fields: vrl_runtime_config.fields,
                        }),
                        transform.is_result_array_vrl(),
                    )
                };

                function_map.insert(node.get_node_id(), compiled_runtime);
            }
        }
        Ok(function_map)
    }
}

// TODO YJDOc2: following is almost exact copy of above, and actually
// only needs nodes and org_id to create the ret. Refactor in a separate PR
// as a util fn instead of a trait
#[async_trait]
impl PipelineExt for Workflow {
    async fn register_functions(&self) -> Result<HashMap<String, CompiledFunctionRuntime>> {
        let mut function_map = HashMap::new();
        for node in &self.nodes {
            if let NodeData::Function(func_params) = &node.data {
                let transform = get_transforms(&self.org_id, &func_params.name).await?;

                // Check if function is JS or VRL
                let compiled_runtime = if transform.is_js() {
                    // Compile JS function
                    let js_config = compile_js_function(&transform.function, &self.org_id)?;
                    CompiledFunctionRuntime::JS(js_config, transform.is_result_array_js())
                } else {
                    // Compile VRL function (default)
                    let vrl_runtime_config =
                        compile_vrl_function(&transform.function, &self.org_id)?;
                    let registry = vrl_runtime_config
                        .config
                        .get_custom::<vector_enrichment::TableRegistry>()
                        .unwrap();
                    registry.finish_load();
                    CompiledFunctionRuntime::VRL(
                        Box::new(VRLResultResolver {
                            program: vrl_runtime_config.program,
                            fields: vrl_runtime_config.fields,
                        }),
                        transform.is_result_array_vrl(),
                    )
                };

                function_map.insert(node.get_node_id(), compiled_runtime);
            }
        }
        Ok(function_map)
    }
}

#[derive(Debug, Clone)]
pub struct ExecutablePipeline {
    pub id: String,
    name: String,
    is_realtime: bool,
    source_node_id: String,
    sorted_nodes: Vec<String>,
    function_map: HashMap<String, CompiledFunctionRuntime>,
    node_map: HashMap<String, ExecutableNode>,
    pub kind: PipelineKind,
}

impl MemorySize for ExecutablePipeline {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<ExecutablePipeline>()
            + self.id.mem_size()
            + self.name.mem_size()
            + self.is_realtime.mem_size()
            + self.source_node_id.mem_size()
            + self.sorted_nodes.mem_size()
            + self.function_map.mem_size()
            + self.node_map.mem_size()
    }
}

#[derive(Debug, Clone)]
pub struct ExecutableNode {
    id: String,
    node_data: NodeData,
    children: Vec<String>,
}

impl MemorySize for ExecutableNode {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<ExecutableNode>()
            + self.id.mem_size()
            + self.node_data.mem_size()
            + self.children.mem_size()
    }
}

#[derive(Debug)]
pub struct ExecutablePipelineBulkInputs {
    records: Vec<Value>,
    doc_ids: Vec<Option<String>>,
    originals: Vec<Option<String>>,
}

impl ExecutablePipeline {
    pub fn contains_llm_evaluation_node(&self) -> bool {
        self.node_map
            .values()
            .any(|node| matches!(node.node_data, NodeData::LlmEvaluation(_)))
    }

    pub async fn new(pipeline: &Pipeline) -> Result<Self> {
        let node_map = pipeline
            .nodes
            .iter()
            .map(|node| {
                (
                    node.get_node_id(),
                    ExecutableNode {
                        id: node.get_node_id(),
                        node_data: node.get_node_data(),
                        children: pipeline
                            .edges
                            .iter()
                            .filter(|edge| edge.source == node.id)
                            .map(|edge| edge.target.clone())
                            .collect(),
                    },
                )
            })
            .collect();

        let function_map = match pipeline.register_functions().await {
            Ok(function_map) => function_map,
            Err(e) => {
                let pipeline_error = PipelineError {
                    pipeline_id: pipeline.id.to_string(),
                    pipeline_name: pipeline.name.to_string(),
                    error: Some(format!("Init error: failed to compile function: {e}")),
                    node_errors: HashMap::new(),
                };
                publish_error(ErrorData {
                    _timestamp: Utc::now().timestamp_micros(),
                    stream_params: pipeline.get_source_stream_params(),
                    error_source: ErrorSource::Pipeline(pipeline_error),
                })
                .await;
                return Err(e);
            }
        };
        let sorted_nodes = match topological_sort(&node_map) {
            Ok(sorted) => sorted,
            Err(e) => {
                let pipeline_error = PipelineError {
                    pipeline_id: pipeline.id.to_string(),
                    pipeline_name: pipeline.name.to_string(),
                    error: Some(
                        "Init error: failed to sort pipeline nodes for execution".to_string(),
                    ),
                    node_errors: HashMap::new(),
                };
                publish_error(ErrorData {
                    _timestamp: Utc::now().timestamp_micros(),
                    stream_params: pipeline.get_source_stream_params(),
                    error_source: ErrorSource::Pipeline(pipeline_error),
                })
                .await;
                return Err(e);
            }
        };
        let source_node_id = sorted_nodes[0].to_owned();

        Ok(Self {
            id: pipeline.id.to_string(),
            name: pipeline.name.to_string(),
            is_realtime: pipeline.source.is_realtime(),
            source_node_id,
            node_map,
            sorted_nodes,
            function_map,
            kind: pipeline.kind.clone(),
        })
    }

    pub async fn new_from_workflow(workflow: &Workflow) -> Result<Self> {
        let node_map = workflow
            .nodes
            .iter()
            .map(|node| {
                (
                    node.get_node_id(),
                    ExecutableNode {
                        id: node.get_node_id(),
                        node_data: node.get_node_data(),
                        children: workflow
                            .edges
                            .iter()
                            .filter(|edge| edge.source == node.id)
                            .map(|edge| edge.target.clone())
                            .collect(),
                    },
                )
            })
            .collect();

        // TODO YJDoc2: check if we should make the error type as workflow error rather than reusing
        // the pipeline error
        let function_map = match workflow.register_functions().await {
            Ok(function_map) => function_map,
            Err(e) => {
                let pipeline_error = PipelineError {
                    pipeline_id: workflow.id.to_string(),
                    pipeline_name: workflow.name.to_string(),
                    error: Some(format!("Init error: failed to compile function: {e}")),
                    node_errors: HashMap::new(),
                };
                publish_error(ErrorData {
                    _timestamp: Utc::now().timestamp_micros(),
                    stream_params: Default::default(),
                    error_source: ErrorSource::Pipeline(pipeline_error),
                })
                .await;
                return Err(e);
            }
        };
        let sorted_nodes = match topological_sort(&node_map) {
            Ok(sorted) => sorted,
            Err(e) => {
                let pipeline_error = PipelineError {
                    pipeline_id: workflow.id.to_string(),
                    pipeline_name: workflow.name.to_string(),
                    error: Some(
                        "Init error: failed to sort pipeline nodes for execution".to_string(),
                    ),
                    node_errors: HashMap::new(),
                };
                publish_error(ErrorData {
                    _timestamp: Utc::now().timestamp_micros(),
                    stream_params: Default::default(),
                    error_source: ErrorSource::Pipeline(pipeline_error),
                })
                .await;
                return Err(e);
            }
        };
        let source_node_id = sorted_nodes[0].to_owned();

        Ok(Self {
            id: workflow.id.to_string(),
            name: workflow.name.to_string(),
            source_node_id,
            node_map,
            sorted_nodes,
            function_map,
            is_realtime: false,
            kind: PipelineKind::User,
        })
    }

    pub async fn process_batch(
        &self,
        org_id: &str,
        records: Vec<Value>,
        stream_name: Option<String>,
    ) -> Result<HashMap<StreamParams, Vec<(usize, Value)>>> {
        let batch_size = records.len();
        let pipeline_name = self.name.clone();
        // Unique invocation ID to correlate logs across concurrent pipeline runs
        let inv_id = &format!("{:08x}", rand::random::<u32>());
        // Gated detailed timing logs (ZO_PRINT_KEY_EVENT). Per-batch / per-node only,
        // never per-record, to stay safe under high ingestion rate.
        let print_event = config::get_config().common.print_key_event;
        let batch_start = Instant::now();
        log::debug!(
            "[Pipeline] {pipeline_name} [inv={inv_id}]: process batch of size {batch_size}"
        );
        if batch_size == 0 {
            return Ok(HashMap::default());
        }

        // Source size of the batch (MB). Computed before records are consumed by the
        // pipeline. Usage is reported at the end with the real pipeline response time.
        let source_stream_params = self.get_source_stream_params();
        let source_size: f64 = records
            .iter()
            .map(|record| record.to_string().len() as f64)
            .sum::<f64>()
            / config::SIZE_IN_MB;

        if print_event {
            log::info!(
                "[Pipeline:Timing] [inv={inv_id}] start id={} name={} org={org_id} stream={:?} batch_size={batch_size} source_size_mb={source_size:.4} num_nodes={} num_funcs={}",
                self.id,
                pipeline_name,
                stream_name,
                self.sorted_nodes.len(),
                self.num_of_func(),
            );
        }

        // result_channel
        let (result_sender, mut result_receiver) =
            channel::<(usize, StreamParams, Value)>(batch_size);

        // error_channel
        let (error_sender, mut error_receiver) =
            channel::<(String, String, String, Option<String>, Option<Value>)>(batch_size);

        let mut node_senders = HashMap::new();
        let mut node_receivers = HashMap::new();

        for node_id in &self.sorted_nodes {
            let (sender, receiver) = channel::<PipelineItem>(batch_size);
            node_senders.insert(node_id.to_string(), sender);
            node_receivers.insert(node_id.to_string(), receiver);
        }

        // Spawn tasks for each node
        let mut node_tasks = Vec::with_capacity(self.sorted_nodes.len());
        for (idx, node_id) in self.sorted_nodes.iter().enumerate() {
            let pl_id_cp = self.id.to_string();
            let org_id_cp = org_id.to_string();
            let node = self.node_map.get(node_id).unwrap().clone();
            let node_receiver = node_receivers.remove(node_id).unwrap();
            let child_senders: Vec<_> = node
                .children
                .iter()
                .map(|child| node_senders.get(child).unwrap().clone())
                .collect();
            let result_sender_cp = node.children.is_empty().then_some(result_sender.clone());
            let error_sender_cp = error_sender.clone();
            let function_runtime: Option<CompiledFunctionRuntime> =
                self.function_map.get(node_id).cloned();
            let pipeline_name = pipeline_name.clone();
            let pipeline_kind = self.kind.clone();
            let stream_name = stream_name.clone();
            let inv_id_cp = inv_id.to_string();

            // WARN: Do not change. Processing node can only be done in a task, as the internals of
            // remote wal writer depends on the task id.
            let source_stream_name = source_stream_params.stream_name.to_string();
            let source_stream_type = source_stream_params.stream_type;
            // For LLM eval nodes, resolve the destination stream params from child leaf node
            // TODO: check if this is actually used, or no longer needed
            let _leaf_dest_stream = if matches!(&node.node_data, NodeData::LlmEvaluation(_)) {
                node.children.iter().find_map(|child_id| {
                    self.node_map.get(child_id).and_then(|child_node| {
                        if let NodeData::Stream(sp) = &child_node.node_data {
                            Some(sp.clone())
                        } else {
                            None
                        }
                    })
                })
            } else {
                None
            };
            let metadata = ProcessMetadata {
                pipeline_id: pl_id_cp,
                node_idx: idx,
                org_id: org_id_cp,
                pipeline_name,
                pipeline_kind,
                stream_name,
                source_stream_name,
                source_stream_type,
                inv_id: inv_id_cp,
                print_event,
                leaf_dest_stream: _leaf_dest_stream,
                return_value_for_error: false, // pipelines do not support this
            };
            let channels = ProcessChannels {
                receiver: node_receiver,
                child_senders,
                result_sender: result_sender_cp,
                error_sender: error_sender_cp,
            };
            let task = tokio::spawn(process_node(metadata, node, function_runtime, channels));
            node_tasks.push(task);
        }
        // Measure node task duration from when they were spawned (they start running
        // immediately), not from when we await them below.
        let node_tasks_start = Instant::now();

        // task to collect results
        let pl_name_for_results = pipeline_name.clone();
        let inv_id_for_results = inv_id.clone();
        let result_task = tokio::spawn(async move {
            log::debug!(
                "[Pipeline] {pl_name_for_results} [inv={inv_id_for_results}]: starts result collecting job"
            );
            let mut results = HashMap::new();
            while let Some((idx, stream_params, record)) = result_receiver.recv().await {
                if stream_params.stream_type != StreamType::Traces {
                    log::debug!("record: {:?}", record);
                    log::debug!(
                        "[Pipeline] {pl_name_for_results} [inv={inv_id_for_results}]: result collector got record for {}:{}",
                        stream_params.stream_type,
                        stream_params.stream_name,
                    );
                }

                results
                    .entry(stream_params)
                    .or_insert(Vec::new())
                    .push((idx, record));
            }
            results
        });

        // task to collect errors
        let mut pipeline_error = PipelineError::new(&self.id, &self.name);
        let inv_id_for_errors = inv_id.clone();
        let error_task = tokio::spawn(async move {
            log::debug!("[Pipeline] [inv={inv_id_for_errors}]: starts error collecting job");
            let mut count = 0;
            while let Some((node_id, node_type, error, fn_name, _)) = error_receiver.recv().await {
                // for pipelines, we do not store the values
                pipeline_error.add_node_error(node_id, node_type, error, fn_name, None);
                count += 1;
            }
            log::debug!("[Pipeline] [inv={inv_id_for_errors}]: collected {count} errors");
            if count > 0 {
                Some(pipeline_error)
            } else {
                None
            }
        });

        // Send records to the source node to begin processing
        let flattened = {
            let source_node = self.node_map.get(&self.source_node_id).unwrap();
            matches!(&source_node.node_data, NodeData::Stream(stream_params) if stream_params.stream_type == StreamType::Metrics)
        };
        let source_sender = node_senders.remove(&self.source_node_id).unwrap();
        for (idx, record) in records.into_iter().enumerate() {
            let pipeline_item = PipelineItem {
                idx,
                record,
                flattened,
            };
            if let Err(send_err) = source_sender.send(pipeline_item).await {
                log::error!(
                    "[Pipeline] {pipeline_name} [inv={inv_id}]: Error sending original records into source Node for {send_err}"
                );
                break;
            }
        }
        drop(source_sender);
        drop(result_sender);
        drop(error_sender);
        drop(node_senders);
        log::debug!(
            "[Pipeline] {pipeline_name} [inv={inv_id}]: All records send into pipeline for processing"
        );

        // Wait for all node tasks to complete
        if let Err(e) = try_join_all(node_tasks).await {
            log::error!(
                "[Pipeline] {pipeline_name} [inv={inv_id}]: node processing jobs failed: {e}"
            );
        }
        let node_tasks_ms = node_tasks_start.elapsed().as_millis();

        // Publish errors if received any
        let error_task_start = Instant::now();
        if let Some(pipeline_errors) = error_task.await.map_err(|e| {
            log::error!(
                "[Pipeline] {pipeline_name} [inv={inv_id}]: error collecting job failed: {e}"
            );
            anyhow!("[Pipeline] error collecting job failed: {}", e)
        })? {
            let stream_params = self.get_source_stream_params();
            log::error!(
                "[Pipeline] [inv={inv_id}] id: {}, name: {}, node_errors: {:?}",
                pipeline_errors.pipeline_id,
                pipeline_errors.pipeline_name,
                pipeline_errors.node_errors
            );
            let error_data = ErrorData {
                _timestamp: Utc::now().timestamp_micros(),
                stream_params,
                error_source: ErrorSource::Pipeline(pipeline_errors),
            };
            log::debug!(
                "[Pipeline] {pipeline_name} [inv={inv_id}]: execution errors occurred and published"
            );
            publish_error(error_data).await;
        }
        let error_collect_ms = error_task_start.elapsed().as_millis();

        let result_task_start = Instant::now();
        let results = result_task.await.map_err(|e| {
            log::error!(
                "[Pipeline] {pipeline_name} [inv={inv_id}]: result collecting job failed: {e}"
            );
            anyhow!("[Pipeline] result collecting job failed: {}", e)
        })?;
        let result_collect_ms = result_task_start.elapsed().as_millis();

        // Histogram metrics (always on): realtime pipeline batch execution time (ms)
        // and batch size, labeled by pipeline so latency can be attributed per pipeline.
        let elapsed_secs = batch_start.elapsed().as_secs_f64();
        if self.is_realtime {
            metrics::PIPELINE_EXEC_TIME_MS
                .with_label_values(&[org_id, &self.id])
                .observe(elapsed_secs * 1000.0);
            metrics::PIPELINE_EXEC_BATCH_SIZE
                .with_label_values(&[org_id, &self.id])
                .observe(batch_size as f64);
        }

        if print_event {
            let total_ms = batch_start.elapsed().as_millis();
            let out_records: usize = results.values().map(|v| v.len()).sum();
            let secs = batch_start.elapsed().as_secs_f64();
            let (records_per_sec, mb_per_sec) = if secs > 0.0 {
                (batch_size as f64 / secs, source_size / secs)
            } else {
                (0.0, 0.0)
            };
            log::info!(
                "[Pipeline:Timing] [inv={inv_id}] done id={} name={} stream_groups={} batch_size={batch_size} source_size_mb={source_size:.4} out_records={out_records} total_ms={total_ms} node_tasks_ms={node_tasks_ms} result_collect_ms={result_collect_ms} error_collect_ms={error_collect_ms} records_per_sec={records_per_sec:.1} mb_per_sec={mb_per_sec:.4}",
                self.id,
                pipeline_name,
                results.len()
            );
        }

        // Report pipeline ingestion usage LAST, with response_time set to the time
        // spent by the pipeline processing this batch (seconds, f64).
        if source_size > 0.0 {
            let req_stats = config::meta::self_reporting::usage::RequestStats {
                size: source_size,
                records: batch_size as i64,
                response_time: elapsed_secs,
                ..config::meta::self_reporting::usage::RequestStats::default()
            };

            usage_reporting::report_request_usage_stats(
                req_stats,
                org_id,
                &self.id,
                source_stream_params.stream_type,
                config::meta::self_reporting::usage::UsageType::Pipeline,
                0, // No functions for source stream ingestion
                chrono::Utc::now().timestamp_micros(),
            )
            .await;
        }

        // Cross-type leaf nodes ingest directly via ingestion_service inside process_node,
        // so results here only contain same-type records for the caller to handle.
        Ok(results)
    }

    pub async fn process_workflow(
        &self,
        org_id: &str,
        records: Vec<Value>,
        from_node: Option<String>,
    ) -> Result<WorkflowResult> {
        let batch_size = records.len();
        let pipeline_name = self.name.clone();
        // Unique invocation ID to correlate logs across concurrent pipeline runs
        let inv_id = &format!("{:08x}", rand::random::<u32>());
        let batch_start = Instant::now();
        if batch_size == 0 {
            return Ok(Default::default());
        }

        // Source size of the batch (MB). Computed before records are consumed by the
        // pipeline. Usage is reported at the end with the real pipeline response time.
        let source_size: f64 = records
            .iter()
            .map(|record| record.to_string().len() as f64)
            .sum::<f64>()
            / config::SIZE_IN_MB;

        // result_channel
        let (result_sender, mut result_receiver) =
            channel::<(usize, StreamParams, Value)>(batch_size);

        // error_channel
        let (error_sender, mut error_receiver) =
            channel::<(String, String, String, Option<String>, Option<Value>)>(batch_size);

        let mut node_senders = HashMap::new();
        let mut node_receivers = HashMap::new();

        for node_id in &self.sorted_nodes {
            let (sender, receiver) = channel::<PipelineItem>(batch_size);
            node_senders.insert(node_id.to_string(), sender);
            node_receivers.insert(node_id.to_string(), receiver);
        }

        // Spawn tasks for each node
        let mut node_tasks = Vec::with_capacity(self.sorted_nodes.len());
        for (idx, node_id) in self.sorted_nodes.iter().enumerate() {
            let pl_id_cp = self.id.to_string();
            let org_id_cp = org_id.to_string();
            let node = self.node_map.get(node_id).unwrap().clone();
            let node_receiver = node_receivers.remove(node_id).unwrap();
            let child_senders: Vec<_> = node
                .children
                .iter()
                .map(|child| node_senders.get(child).unwrap().clone())
                .collect();
            let result_sender_cp = node.children.is_empty().then_some(result_sender.clone());
            let error_sender_cp = error_sender.clone();
            let function_runtime: Option<CompiledFunctionRuntime> =
                self.function_map.get(node_id).cloned();
            let pipeline_name = pipeline_name.clone();
            let inv_id_cp = inv_id.to_string();

            // For LLM eval nodes, resolve the destination stream params from child leaf node
            // TODO: check if this is actually used, or no longer needed
            let _leaf_dest_stream = if matches!(&node.node_data, NodeData::LlmEvaluation(_)) {
                node.children.iter().find_map(|child_id| {
                    self.node_map.get(child_id).and_then(|child_node| {
                        if let NodeData::Stream(sp) = &child_node.node_data {
                            Some(sp.clone())
                        } else {
                            None
                        }
                    })
                })
            } else {
                None
            };
            let metadata = ProcessMetadata {
                pipeline_id: pl_id_cp,
                node_idx: idx,
                org_id: org_id_cp,
                pipeline_name,
                pipeline_kind: PipelineKind::User,
                stream_name: None,
                source_stream_type: StreamType::Logs,
                inv_id: inv_id_cp,
                print_event: false, // do not print events for workflows
                leaf_dest_stream: _leaf_dest_stream,
                return_value_for_error: true,
                source_stream_name: "system_workflow_trigger".to_string(),
            };
            let channels = ProcessChannels {
                receiver: node_receiver,
                child_senders,
                result_sender: result_sender_cp,
                error_sender: error_sender_cp,
            };
            let task = tokio::spawn(process_node(metadata, node, function_runtime, channels));
            node_tasks.push(task);
        }

        // task to collect results
        let pl_name_for_results = pipeline_name.clone();
        let inv_id_for_results = inv_id.clone();
        let result_task = tokio::spawn(async move {
            log::debug!(
                "[Workflow] {pl_name_for_results} [inv={inv_id_for_results}]: starts result collecting job"
            );
            let mut results = HashMap::new();
            while let Some((idx, stream_params, record)) = result_receiver.recv().await {
                log::debug!(
                    "[Workflow] {pl_name_for_results} [inv={inv_id_for_results}]: result collector got record for {}:{}",
                    stream_params.stream_type,
                    stream_params.stream_name,
                );

                results
                    .entry(stream_params)
                    .or_insert(Vec::new())
                    .push((idx, record));
            }
            results
        });

        // task to collect errors
        let mut pipeline_error = PipelineError::new(&self.id, &self.name);
        let inv_id_for_errors = inv_id.clone();
        let error_task = tokio::spawn(async move {
            log::debug!("[Workflow] [inv={inv_id_for_errors}]: starts error collecting job");
            let mut count = 0;
            while let Some((node_id, node_type, error, fn_name, val)) = error_receiver.recv().await
            {
                pipeline_error.add_node_error(node_id, node_type, error, fn_name, val);
                count += 1;
            }
            log::debug!("[Workflow] [inv={inv_id_for_errors}]: collected {count} errors");
            if count > 0 {
                Some(pipeline_error)
            } else {
                None
            }
        });

        // Send records to the source node to begin processing
        let flattened = {
            let source_node = self.node_map.get(&self.source_node_id).unwrap();
            matches!(&source_node.node_data, NodeData::Stream(stream_params) if stream_params.stream_type == StreamType::Metrics)
        };
        let source_sender = match from_node {
            Some(v) => {
                let Some(node) = node_senders.remove(&v) else {
                    return Err(anyhow::anyhow!("node with id {v} not fond in workflow"));
                };
                node
            }
            None => node_senders.remove(&self.source_node_id).unwrap(),
        };
        for (idx, record) in records.into_iter().enumerate() {
            let pipeline_item = PipelineItem {
                idx,
                record,
                flattened,
            };
            if let Err(send_err) = source_sender.send(pipeline_item).await {
                log::error!(
                    "[Workflow] {pipeline_name} [inv={inv_id}]: Error sending original records into source Node for {send_err}"
                );
                break;
            }
        }
        drop(source_sender);
        drop(result_sender);
        drop(error_sender);
        drop(node_senders);
        log::debug!(
            "[Workflow] {pipeline_name} [inv={inv_id}]: All records send into pipeline for processing"
        );

        // Wait for all node tasks to complete
        log::debug!(
            "[Workflow] {pipeline_name} [inv={inv_id}]: waiting for all node tasks to complete"
        );
        if let Err(e) = try_join_all(node_tasks).await {
            log::error!(
                "[Workflow] {pipeline_name} [inv={inv_id}]: node processing jobs failed: {e}"
            );
        }
        log::debug!("[Workflow] {pipeline_name} [inv={inv_id}]: all node tasks completed");

        // Publish errors if received any
        log::debug!("[Workflow] {pipeline_name} [inv={inv_id}]: awaiting error task");
        let errors = error_task.await.map_err(|e| {
            log::error!(
                "[Workflow] {pipeline_name} [inv={inv_id}]: error collecting job failed: {e}"
            );
            anyhow!("[Workflow] error collecting job failed: {}", e)
        })?;

        let node_errors = errors
            .as_ref()
            .map(|v| v.node_errors.clone())
            .unwrap_or_default();

        if let Some(pipeline_errors) = errors {
            // TODO YJDOc2: maybe change error type?
            log::error!(
                "[Workflow] [inv={inv_id}] id: {}, name: {}, {:?}, total {} nodes errored while executing",
                pipeline_errors.pipeline_id,
                pipeline_errors.pipeline_name,
                pipeline_errors.error,
                pipeline_errors.node_errors.len()
            );
            let error_data = ErrorData {
                _timestamp: Utc::now().timestamp_micros(),
                stream_params: Default::default(),
                error_source: ErrorSource::Pipeline(pipeline_errors),
            };
            log::debug!(
                "[Workflow] {pipeline_name} [inv={inv_id}]: execution errors occurred and published"
            );
            publish_error(error_data).await;
        }

        log::debug!("[Workflow] {pipeline_name} [inv={inv_id}]: awaiting result collector");
        let results = result_task.await.map_err(|e| {
            log::error!(
                "[Workflow] {pipeline_name} [inv={inv_id}]: result collecting job failed: {e}"
            );
            anyhow!("[Workflow] result collecting job failed: {}", e)
        })?;
        log::debug!(
            "[Workflow] {pipeline_name} [inv={inv_id}]: result collector returned {} stream groups",
            results.len()
        );

        // Report pipeline ingestion usage LAST, with response_time set to the time
        // spent by the pipeline processing this batch (seconds, f64).
        let elapsed_secs = batch_start.elapsed().as_secs_f64();
        if source_size > 0.0 {
            let req_stats = config::meta::self_reporting::usage::RequestStats {
                size: source_size,
                records: batch_size as i64,
                response_time: elapsed_secs,
                ..config::meta::self_reporting::usage::RequestStats::default()
            };

            // TODO YJDoc2: change usage type?
            usage_reporting::report_request_usage_stats(
                req_stats,
                org_id,
                &self.id,
                StreamType::Logs,
                config::meta::self_reporting::usage::UsageType::Pipeline,
                0, // No functions for source stream ingestion
                chrono::Utc::now().timestamp_micros(),
            )
            .await;
        }

        // Cross-type leaf nodes ingest directly via ingestion_service inside process_node,
        // so results here only contain same-type records for the caller to handle.
        Ok(WorkflowResult {
            stream_details: results,
            errors: node_errors,
        })
    }

    pub fn get_all_destination_streams(&self) -> Vec<StreamParams> {
        self.node_map
            .values()
            .filter_map(|exec_node| {
                if exec_node.children.is_empty() {
                    if let NodeData::Stream(stream_params) = &exec_node.node_data {
                        (!stream_params.stream_name.contains("{")).then_some(stream_params.clone())
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn num_of_func(&self) -> usize {
        self.node_map
            .values()
            .filter(|exec_node| matches!(exec_node.node_data, NodeData::Function(_)))
            .count()
    }

    pub fn get_pipeline_id(&self) -> &str {
        &self.id
    }

    pub fn get_pipeline_name(&self) -> &str {
        &self.name
    }

    fn get_source_stream_params(&self) -> StreamParams {
        // source_node_id must exist in node_map
        match &self.node_map.get(&self.source_node_id).unwrap().node_data {
            NodeData::Stream(stream_params) => stream_params.clone(),
            NodeData::Query(derived_stream) => StreamParams::new(
                &derived_stream.org_id,
                "DerivedStream",
                derived_stream.stream_type,
            ),
            _ => unreachable!(), // SourceNode can only be of type Stream of Query
        }
    }
}

impl ExecutableNode {
    pub fn node_type(&self) -> String {
        self.to_string()
    }

    /// Human-readable label for timing logs, e.g. "function:my_vrl_fn" or
    /// "stream:logs:default", so node latencies can be told apart in pipelines
    /// with many nodes.
    fn timing_label(&self) -> String {
        match &self.node_data {
            NodeData::Function(p) => format!("function:{}", p.name),
            NodeData::Stream(p) => format!("stream:{}:{}", p.stream_type, p.stream_name),
            NodeData::RemoteStream(p) => format!("remote_stream:{}", p.destination_name),
            NodeData::Condition(_) => "condition".to_string(),
            NodeData::Query(_) => "query".to_string(),
            NodeData::LlmEvaluation(p) => format!("llm_evaluation:{}", p.name),
            NodeData::WorkflowTrigger => "workflow_trigger".to_string(),
            NodeData::Destination(d) => format!("destination:{}", d.destination_id),
        }
    }
}

impl std::fmt::Display for ExecutableNode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.node_data {
            NodeData::Stream(_) => write!(f, "stream"),
            NodeData::Query(_) => write!(f, "query"),
            NodeData::Function(_) => write!(f, "function"),
            NodeData::Condition(_) => write!(f, "condition"),
            NodeData::RemoteStream(_) => write!(f, "remote_stream"),
            NodeData::LlmEvaluation(_) => write!(f, "llm_evaluation"),
            NodeData::WorkflowTrigger => write!(f, "workflow_trigger"),
            NodeData::Destination(_) => write!(f, "destination"),
        }
    }
}

impl ExecutablePipelineBulkInputs {
    pub fn new() -> Self {
        Self {
            records: Vec::new(),
            doc_ids: Vec::new(),
            originals: Vec::new(),
        }
    }

    pub fn add_input(
        &mut self,
        record: Value,
        doc_id: Option<String>,
        original_data: Option<String>,
    ) {
        self.records.push(record);
        self.doc_ids.push(doc_id);
        self.originals.push(original_data);
    }

    pub fn into_parts(self) -> (Vec<Value>, Vec<Option<String>>, Vec<Option<String>>) {
        (self.records, self.doc_ids, self.originals)
    }
}

impl Default for ExecutablePipelineBulkInputs {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
struct PipelineItem {
    idx: usize,
    record: Value,
    flattened: bool,
}

#[derive(Clone)]
#[allow(unused)]
struct ProcessMetadata {
    pipeline_id: String,
    node_idx: usize,
    org_id: String,
    pipeline_name: String,
    pipeline_kind: PipelineKind,
    stream_name: Option<String>,
    source_stream_name: String,
    source_stream_type: StreamType,
    inv_id: String,
    print_event: bool,
    leaf_dest_stream: Option<StreamParams>,
    return_value_for_error: bool,
}

#[allow(clippy::type_complexity)]
struct ProcessChannels {
    receiver: Receiver<PipelineItem>,
    child_senders: Vec<Sender<PipelineItem>>,
    result_sender: Option<Sender<(usize, StreamParams, Value)>>,
    error_sender: Sender<(String, String, String, Option<String>, Option<Value>)>,
}

async fn process_node(
    metadata: ProcessMetadata,
    node: ExecutableNode,
    function_runtime: Option<CompiledFunctionRuntime>,
    mut channels: ProcessChannels,
) -> Result<()> {
    let pl_name = metadata.pipeline_name.clone();
    let node_idx = metadata.node_idx;
    let inv_id = metadata.inv_id.clone();
    let print_event = metadata.print_event;

    // Per-node timing (gated by ZO_PRINT_KEY_EVENT). Aggregated per batch, never
    // per-record. `node_label` distinguishes nodes (e.g. the VRL fn name) so node
    // latencies can be told apart in pipelines with many nodes.
    let node_label = node.timing_label();
    let node_type = node.node_type();
    let node_start = Instant::now();
    // wall time spent doing CPU work inside this node's loop (flatten + fn/eval),
    // excluding time blocked on `recv().await` from upstream.
    let mut busy = Duration::ZERO;

    let count = match &node.node_data {
        NodeData::WorkflowTrigger => {
            let mut count: usize = 0;
            while let Some(item) = channels.receiver.recv().await {
                send_to_children(&mut channels.child_senders, item, "WorkflowTrigger").await;
                count += 1;
            }
            count
        }
        NodeData::Stream(stream_params) => {
            process_stream_node(stream_params, metadata, &node, channels, &mut busy).await
        }
        NodeData::Condition(condition_params) => {
            process_condition_node(condition_params, metadata, &node, channels, &mut busy).await
        }
        NodeData::Function(func_params) => {
            process_function_node(
                func_params,
                metadata,
                &node,
                function_runtime,
                channels,
                &mut busy,
            )
            .await
        }
        NodeData::Query(_) => {
            // source node for Scheduled pipeline. Directly send to children nodes
            log::debug!(
                "[Pipeline] {} [inv={inv_id}]: query node {} starts processing",
                metadata.pipeline_name,
                metadata.node_idx
            );
            let mut count: usize = 0;
            while let Some(item) = channels.receiver.recv().await {
                send_to_children(&mut channels.child_senders, item, "QueryNode").await;
                count += 1;
            }
            log::debug!(
                "[Pipeline] {} [inv={inv_id}]: query node {} done processing {count} records",
                metadata.pipeline_name,
                metadata.node_idx
            );
            count
        }
        #[cfg(feature = "enterprise")]
        NodeData::RemoteStream(remote_stream) => {
            process_remote_stream_node(remote_stream, metadata, &node, channels).await?
        }
        #[cfg(not(feature = "enterprise"))]
        NodeData::RemoteStream(_) => {
            let err_msg = "[Pipeline]: remote destination is not supported in open source version. Records dropped".to_string();
            log::error!(
                "[Pipeline] {} [inv={inv_id}]: {err_msg}",
                metadata.pipeline_name
            );
            if let Err(send_err) = channels
                .error_sender
                .send((node.id.to_string(), node.node_type(), err_msg, None, None))
                .await
            {
                log::error!(
                    "[Pipeline({})] {} [inv={inv_id}]: DestinationNode failed sending errors for collection caused by: {send_err}",
                    metadata.pipeline_id,
                    metadata.pipeline_name,
                );
            }
            0
        }
        #[cfg(feature = "enterprise")]
        NodeData::LlmEvaluation(params) => {
            process_llm_evaluation_node(params, metadata, channels).await
        }
        #[cfg(not(feature = "enterprise"))]
        NodeData::LlmEvaluation(_) => {
            log::warn!(
                "[Pipeline] {} [inv={inv_id}]: LLM evaluation node {node_idx} skipped because online evals are enterprise-only",
                metadata.pipeline_name
            );
            let mut skipped_count = 0usize;
            while channels.receiver.recv().await.is_some() {
                skipped_count += 1;
            }
            log::info!(
                "[Pipeline] {} [inv={inv_id}]: LLM evaluation node {node_idx} skipped {skipped_count} records",
                metadata.pipeline_name
            );
            0
        }

        #[cfg(feature = "enterprise")]
        NodeData::Destination(dest) => {
            process_destination_node(metadata, channels, &node, dest).await?
        }
        #[cfg(not(feature = "enterprise"))]
        NodeData::Destination(_) => {
            log::warn!(
                "[Workflow] {} [inv={inv_id}]: Destination node {node_idx} skipped because workflows are enterprise-only",
                metadata.pipeline_name
            );
            let mut skipped_count = 0usize;
            while channels.receiver.recv().await.is_some() {
                skipped_count += 1;
            }
            log::info!(
                "[Pipeline] {} [inv={inv_id}]: destination {node_idx} skipped {skipped_count} records",
                metadata.pipeline_name
            );
            0
        }
    };

    // all cloned senders dropped when function goes out of scope -> close the channel
    log::info!(
        "[Pipeline] {pl_name} [inv={inv_id}]: node {node_idx} ({:?}) task returning",
        node.node_data
    );

    if print_event {
        let node_ms = node_start.elapsed().as_millis();
        let busy_ms = busy.as_millis();
        // wait_ms ~= time blocked on upstream (channel recv). High wait_ms with low
        // busy_ms under low CPU points at upstream/downstream stalls, not this node.
        let wait_ms = node_ms.saturating_sub(busy_ms);
        log::info!(
            "[Pipeline:Timing] [inv={inv_id}] name={pl_name} node idx={node_idx} type={node_type} label={node_label} records={count} node_ms={node_ms} busy_ms={busy_ms} wait_ms={wait_ms}"
        );
    }

    Ok(())
}

#[cfg(feature = "enterprise")]
fn is_allowed_eval_source(
    pipeline_kind: &PipelineKind,
    stream_name: &str,
    stream_type: StreamType,
) -> bool {
    matches!(pipeline_kind, PipelineKind::Evaluation)
        && stream_type == StreamType::Traces
        && !infra::table::online_eval_jobs::is_reserved_eval_source_stream(stream_name)
}

#[cfg(feature = "enterprise")]
async fn process_llm_evaluation_node(
    params: &config::meta::pipeline::components::LlmEvaluationParams,
    metadata: ProcessMetadata,
    mut channels: ProcessChannels,
) -> usize {
    let mut count: usize = 0;
    let inv_id = metadata.inv_id;
    if !is_allowed_eval_source(
        &metadata.pipeline_kind,
        &metadata.source_stream_name,
        metadata.source_stream_type,
    ) {
        log::error!(
            "[Pipeline] {} [inv={inv_id}]: LLM evaluation node {} blocked source {}:{}",
            metadata.pipeline_name,
            metadata.node_idx,
            metadata.source_stream_type,
            metadata.source_stream_name
        );
        while channels.receiver.recv().await.is_some() {
            count += 1;
        }
        return count;
    }
    if !o2_enterprise::enterprise::common::config::get_config()
        .common
        .online_evals_enabled
    {
        log::warn!(
            "[Pipeline] {} [inv={inv_id}]: LLM evaluation node {} skipped because online evals are disabled",
            metadata.pipeline_name,
            metadata.node_idx
        );
        while channels.receiver.recv().await.is_some() {
            count += 1;
        }
        log::info!(
            "[Pipeline] {} [inv={inv_id}]: LLM evaluation node {} skipped {count} records",
            metadata.pipeline_name,
            metadata.node_idx
        );
        return count;
    }

    log::info!(
        "[Pipeline] {} [inv={inv_id}]: LLM evaluation node {} starts processing",
        metadata.pipeline_name,
        metadata.node_idx
    );

    let scorer_refs = params.scorers.clone();

    let job_id = params.job_id.as_deref();
    while let Some(item) = channels.receiver.recv().await {
        if let Some(mut ctx) =
            crate::llm_evaluations::eval_jobs::executor_runtime::extract_context_from_span(
                &metadata.org_id,
                job_id,
                &item.record,
                &metadata.source_stream_name,
                &metadata.source_stream_type.to_string(),
            )
        {
            let eval_run_id = config::ider::generate();
            ctx.eval_run_id = Some(eval_run_id.clone());
            ctx.job_version = params.job_version;
            ctx.sampling_rate = Some(params.sampling_rate);
            let sampled = should_sample_eval_record(&item.record, item.idx, params.sampling_rate);
            ctx.sampled = Some(sampled);

            if !sampled {
                let skipped_trace = crate::llm_evaluations::evaluator_trace::create_evaluator_trace(
                    crate::llm_evaluations::evaluator_trace::EvaluatorTraceInput {
                        org_id: ctx.org_id.clone(),
                        evaluator_trace_id: ctx.evaluator_trace_id.clone(),
                        evaluator_span_id: None,
                        parent_span_id: None,
                        is_root: false,
                        target_scope: ctx.target_scope.clone(),
                        target_id: ctx.target_id.clone(),
                        target_span_id: ctx.span_id.clone(),
                        target_trace_id: ctx.trace_id.clone(),
                        target_session_id: ctx.session_id.clone(),
                        target_stream: ctx.source_stream.clone(),
                        target_stream_type: ctx.source_stream_type.clone(),
                        target_agent_name: ctx.agent_name.clone(),
                        target_agent_id: ctx.agent_id.clone(),
                        scorer_id: None,
                        scorer_version: None,
                        scorer_type: None,
                        job_id: ctx.job_id.clone(),
                        job_version: ctx.job_version.map(|version| version.to_string()),
                        score_config_id: None,
                        score_config_version: None,
                        eval_run_id: Some(eval_run_id),
                        task_id: None,
                        score_id: None,
                        evaluation_key: None,
                        provider_id: None,
                        provider_name: None,
                        provider_type: None,
                        model: None,
                        latency_ms: 0,
                        prompt_tokens: None,
                        completion_tokens: None,
                        total_tokens: None,
                        sampling_rate: Some(params.sampling_rate),
                        sampled: Some(false),
                        status: config::meta::self_reporting::evaluator::status::SKIPPED
                            .to_string(),
                        error_kind: None,
                        error_message: None,
                        skip_reason: Some("sampling".to_string()),
                        prompt: None,
                        response: None,
                    },
                );
                let observation = o2_enterprise::enterprise::llm_evaluations::eval_jobs::async_executor::UnsampledObservation {
                    org_id: metadata.org_id.clone(),
                    evaluator_traces: vec![skipped_trace],
                    node_idx: metadata.node_idx,
                };
                if let Err(e) = o2_enterprise::enterprise::llm_evaluations::eval_jobs::async_executor::enqueue_unsampled_observation(observation) {
                    o2_enterprise::enterprise::llm_evaluations::eval_jobs::async_executor::log_enqueue_error(
                        &metadata.pipeline_name,
                        metadata.node_idx,
                        e,
                    );
                }
                count += 1;
                continue;
            }

            let observation = o2_enterprise::enterprise::llm_evaluations::eval_jobs::async_executor::SpanObservation {
                pipeline_name: metadata.pipeline_name.clone(),
                node_idx: metadata.node_idx,
                ctx,
                job_version: params.job_version,
                input_mapping: params.input_mapping.clone(),
                scorer_refs: scorer_refs.clone(),
            };
            if let Err(e) = o2_enterprise::enterprise::llm_evaluations::eval_jobs::async_executor::enqueue_span_observation(observation).await {
                o2_enterprise::enterprise::llm_evaluations::eval_jobs::async_executor::log_enqueue_error(
                    &metadata.pipeline_name,
                    metadata.node_idx,
                    e,
                );
            }
        }
        count += 1;
    }

    log::info!(
        "[Pipeline] {} [inv={inv_id}]: LLM evaluation node {} done processing {count} records",
        metadata.pipeline_name,
        metadata.node_idx
    );
    count
}

#[cfg(feature = "enterprise")]
async fn process_remote_stream_node(
    remote_stream: &config::meta::stream::RemoteStreamParams,
    metadata: ProcessMetadata,
    node: &ExecutableNode,
    mut channels: ProcessChannels,
) -> Result<usize, anyhow::Error> {
    let mut count: usize = 0;
    let cfg = config::get_config();
    let mut records = vec![];
    let inv_id = metadata.inv_id;
    log::debug!(
        "[Pipeline] {} [inv={inv_id}]: Destination node {} starts processing, remote_stream : {remote_stream:?}",
        metadata.pipeline_name,
        metadata.node_idx
    );
    let now = config::utils::time::now_micros();
    let min_ts = now - cfg.limit.ingest_allowed_upto_micro;
    let max_ts = now + cfg.limit.ingest_allowed_in_future_micro;
    while let Some(pipeline_item) = channels.receiver.recv().await {
        let PipelineItem {
            mut record,
            flattened,
            ..
        } = pipeline_item;

        let value_copy = if metadata.return_value_for_error {
            Some(record.clone())
        } else {
            None
        };

        // handle timestamp before sending to remote_write service
        if !flattened && !record.is_null() && record.is_object() {
            record = match flatten::flatten_with_level(record, cfg.limit.ingest_flatten_level) {
                Ok(flattened) => flattened,
                Err(e) => {
                    let err_msg = format!("DestinationNode error with flattening: {e}");
                    if let Err(send_err) = channels
                        .error_sender
                        .send((
                            node.id.to_string(),
                            node.node_type(),
                            err_msg,
                            None,
                            value_copy,
                        ))
                        .await
                    {
                        log::error!(
                            "[Pipeline] {} [inv={inv_id}]: DestinationNode failed sending errors for collection caused by: {send_err}",
                            metadata.pipeline_name
                        );
                        break;
                    }
                    continue;
                }
            };
        }
        if !record.is_null() && record.is_object() {
            if let Err(e) = crate::logs::ingest::handle_timestamp(&mut record, min_ts, max_ts) {
                let err_msg = format!("DestinationNode error handling timestamp: {e}");
                if let Err(send_err) = channels
                    .error_sender
                    .send((
                        node.id.to_string(),
                        node.node_type(),
                        err_msg,
                        None,
                        value_copy,
                    ))
                    .await
                {
                    log::error!(
                        "[Pipeline] {} [inv={inv_id}]: DestinationNode failed sending errors for collection caused by: {send_err}",
                        metadata.pipeline_name
                    );
                    break;
                }
                continue;
            }

            records.push(record);
            count += 1;
        }
    }
    log::debug!(
        "[Pipeline] {} [inv={inv_id}]: RemoteStream node processed {} records",
        metadata.pipeline_name,
        records.len()
    );
    if !records.is_empty() {
        // Group records by batch_key for routing to different remote streams
        let mut records_by_batch_key: HashMap<String, Vec<json::Value>> = HashMap::new();

        for record in records {
            // Extract batch_key from record, fallback to "default" if not present
            let batch_key = record
                .get("batch_key")
                .and_then(|v| v.as_str())
                .unwrap_or("default")
                .to_string();

            records_by_batch_key
                .entry(batch_key)
                .or_default()
                .push(record);
        }

        log::debug!(
            "[Pipeline] {} [inv={inv_id}]: Grouped records into {} batch keys",
            metadata.pipeline_name,
            records_by_batch_key.len()
        );

        // Process each batch_key group separately
        for (batch_key, batch_records) in records_by_batch_key {
            // Create buffer key that includes batch_key for routing
            let buffer_key = format!(
                "{}:{}:{}:{}:{}",
                metadata.pipeline_id,
                remote_stream.org_id,
                remote_stream.destination_name,
                batch_key,
                "remote"
            );

            // Add records to the accumulating buffer and check if we should flush
            let mut buffers = BATCH_BUFFERS.lock().await;
            let buffer = buffers
                .entry(buffer_key.clone())
                .or_insert_with(BatchBuffer::new);

            let initial_record_count = buffer.records.len();
            buffer.add_records(batch_records);

            log::debug!(
                "[Pipeline] {} [inv={inv_id}]: Added {} records to buffer for batch_key '{batch_key}', total: {} records, {} bytes",
                metadata.pipeline_name,
                buffer.records.len() - initial_record_count,
                buffer.records.len(),
                buffer.total_bytes
            );

            // Check if buffer should be flushed to WAL
            if buffer.should_flush() {
                let records_to_write = buffer.take_records();
                drop(buffers); // Release the lock before async operations

                log::debug!(
                    "[Pipeline] {} [inv={inv_id}]: Flushing buffer for batch_key '{}' - writing {} records to WAL",
                    metadata.pipeline_name,
                    batch_key,
                    records_to_write.len()
                );

                // Create remote stream configuration with batch_key routing
                let mut remote_stream_for_batch = remote_stream.clone();
                remote_stream_for_batch.org_id = metadata.org_id.clone().into();

                let records_len = records_to_write.len() as i64;

                let writer =
                    get_pipeline_wal_writer(&metadata.pipeline_id, remote_stream_for_batch).await?;
                match writer.write_wal(records_to_write).await {
                    Err(e) => {
                        let err_msg = format!(
                            "DestinationNode error persisting data for batch_key '{batch_key}' to be ingested externally: {e}"
                        );
                        if let Err(send_err) = channels
                            .error_sender
                            .send((node.id.to_string(), node.node_type(), err_msg, None, None))
                            .await
                        {
                            log::error!(
                                "[Pipeline] {} [inv={inv_id}]: DestinationNode failed sending errors for collection caused by: {send_err}",
                                metadata.pipeline_name,
                            );
                        }
                    }
                    Ok(data_size) => {
                        let data_size_mb = data_size as f64 / config::SIZE_IN_MB;
                        // Report remote destination usage after successful WAL write
                        if data_size_mb > 0.0 {
                            let req_stats = config::meta::self_reporting::usage::RequestStats {
                                size: data_size_mb,
                                records: records_len,
                                response_time: 0.0,
                                ..config::meta::self_reporting::usage::RequestStats::default()
                            };

                            usage_reporting::report_request_usage_stats(
                                req_stats,
                                &metadata.org_id,
                                &remote_stream.destination_name,
                                config::meta::stream::StreamType::Logs, // Default to Logs for remote destinations
                                config::meta::self_reporting::usage::UsageType::RemotePipeline,
                                0, // No additional functions for remote destination
                                chrono::Utc::now().timestamp_micros(),
                            )
                            .await;
                        }
                    }
                }
            } else {
                log::debug!(
                    "[Pipeline] {} [inv={inv_id}]: Buffer for batch_key '{batch_key}' not ready for flush, continuing to accumulate",
                    metadata.pipeline_name,
                );
            }
        }
    }
    log::debug!(
        "[Pipeline] {} [inv={inv_id}]: DestinationNode {} done processing {count} records",
        metadata.pipeline_name,
        metadata.node_idx
    );
    Ok(count)
}

async fn process_function_node(
    func_params: &config::meta::pipeline::components::FunctionParams,
    metadata: ProcessMetadata,
    node: &ExecutableNode,
    function_runtime: Option<CompiledFunctionRuntime>,
    mut channels: ProcessChannels,
    busy: &mut Duration,
) -> usize {
    let mut count: usize = 0;
    let cfg = config::get_config();
    let inv_id = metadata.inv_id;
    log::debug!(
        "[Pipeline] {} [inv={inv_id}]: func node {} starts processing",
        metadata.pipeline_name,
        metadata.node_idx
    );
    let mut vrl_runtime_state = crate::ingestion::init_functions_runtime();
    let stream_name = metadata.stream_name.unwrap_or("pipeline".to_string());
    let mut result_array_records = Vec::new();
    while let Some(pipeline_item) = channels.receiver.recv().await {
        let PipelineItem {
            idx,
            mut record,
            mut flattened,
        } = pipeline_item;

        let value_copy = if metadata.return_value_for_error {
            Some(record.clone())
        } else {
            None
        };

        if let Some(runtime) = &function_runtime {
            // Handle flattening if required
            if func_params.after_flatten && !flattened && !record.is_null() && record.is_object() {
                let flatten_timer = Instant::now();
                let flatten_res =
                    flatten::flatten_with_level(record, cfg.limit.ingest_flatten_level);
                *busy += flatten_timer.elapsed();
                record = match flatten_res {
                    Ok(flattened) => flattened,
                    Err(e) => {
                        let err_msg = format!("FunctionNode error with flattening: {e}");
                        let err_msg = err_msg.get(0..500).unwrap_or(&err_msg);
                        if let Err(send_err) = channels
                            .error_sender
                            .send((
                                node.id.to_string(),
                                node.node_type(),
                                err_msg.to_owned(),
                                Some(func_params.name.to_owned()),
                                value_copy,
                            ))
                            .await
                        {
                            log::error!(
                                "[Pipeline] {} [inv={inv_id}]: FunctionNode failed sending errors for collection caused by: {send_err}",
                                metadata.pipeline_name
                            );
                            break;
                        }
                        continue;
                    }
                };
            }

            // Match on function runtime type (VRL or JS)
            match runtime {
                CompiledFunctionRuntime::VRL(vrl_resolver, is_result_array) => {
                    if !is_result_array {
                        // Single record processing with VRL

                        let vrl_timer = Instant::now();
                        let vrl_res = apply_vrl_fn(
                            &mut vrl_runtime_state,
                            vrl_resolver,
                            record,
                            &metadata.org_id,
                            std::slice::from_ref(&stream_name),
                        );
                        *busy += vrl_timer.elapsed();
                        record = match vrl_res {
                            (res, None) => res,
                            (res, Some(error)) => {
                                let err_msg = format!(
                                    "FunctionNode VRL error: {}",
                                    error.get(0..500).unwrap_or(&error)
                                );
                                if let Err(send_err) = channels
                                    .error_sender
                                    .send((
                                        node.id.to_string(),
                                        node.node_type(),
                                        err_msg.to_owned(),
                                        Some(func_params.name.to_owned()),
                                        value_copy,
                                    ))
                                    .await
                                {
                                    log::error!(
                                        "[Pipeline] {} [inv={inv_id}]: FunctionNode failed sending errors for collection caused by: {send_err}",
                                        metadata.pipeline_name
                                    );
                                    break;
                                }
                                res
                            }
                        };
                        flattened = false; // since apply_vrl_fn can produce unflattened data
                        send_to_children(
                            &mut channels.child_senders,
                            PipelineItem {
                                idx,
                                record,
                                flattened,
                            },
                            "FunctionNode",
                        )
                        .await;
                    } else {
                        // Result array mode - collect records
                        result_array_records.push(record);
                    }
                }
                CompiledFunctionRuntime::JS(js_config, is_result_array) => {
                    if !is_result_array {
                        // Single record processing with JS
                        let js_timer = Instant::now();
                        let js_res = apply_js_fn(
                            js_config,
                            record,
                            &metadata.org_id,
                            std::slice::from_ref(&stream_name),
                        );
                        *busy += js_timer.elapsed();
                        record = match js_res {
                            (res, None) => res,
                            (res, Some(error)) => {
                                let err_msg = format!(
                                    "FunctionNode JS error: {}",
                                    error.get(0..500).unwrap_or(&error)
                                );
                                if let Err(send_err) = channels
                                    .error_sender
                                    .send((
                                        node.id.to_string(),
                                        node.node_type(),
                                        err_msg.to_owned(),
                                        Some(func_params.name.to_owned()),
                                        value_copy,
                                    ))
                                    .await
                                {
                                    log::error!(
                                        "[Pipeline] {} [inv={inv_id}]: FunctionNode failed sending errors for collection caused by: {send_err}",
                                        metadata.pipeline_name
                                    );
                                    break;
                                }
                                res
                            }
                        };
                        flattened = false; // since JS functions can produce unflattened data
                        send_to_children(
                            &mut channels.child_senders,
                            PipelineItem {
                                idx,
                                record,
                                flattened,
                            },
                            "FunctionNode",
                        )
                        .await;
                    } else {
                        // Result array mode - collect records
                        result_array_records.push(record);
                    }
                }
            }
        }
        count += 1;
    }
    if !result_array_records.is_empty()
        && let Some(runtime) = &function_runtime
    {
        let value_copy = if metadata.return_value_for_error {
            Some(Value::Array(result_array_records.clone()))
        } else {
            None
        };
        match runtime {
            CompiledFunctionRuntime::VRL(vrl_resolver, true) => {
                // VRL result array processing
                let vrl_arr_timer = Instant::now();
                let vrl_arr_res = apply_vrl_fn(
                    &mut vrl_runtime_state,
                    vrl_resolver,
                    json::Value::Array(result_array_records),
                    &metadata.org_id,
                    std::slice::from_ref(&stream_name),
                );
                *busy += vrl_arr_timer.elapsed();
                let result = match vrl_arr_res {
                    (res, None) => res,
                    (res, Some(error)) => {
                        let err_msg = format!(
                            "FunctionNode VRL result array error: {}",
                            error.get(0..500).unwrap_or(&error)
                        );
                        if let Err(send_err) = channels
                            .error_sender
                            .send((
                                node.id.to_string(),
                                node.node_type(),
                                err_msg.to_owned(),
                                Some(func_params.name.to_owned()),
                                value_copy,
                            ))
                            .await
                        {
                            log::error!(
                                "[Pipeline] {} [inv={inv_id}]: FunctionNode failed sending errors for collection caused by: {send_err}",
                                metadata.pipeline_name
                            );
                            return count;
                        }
                        res
                    }
                };
                // since apply_vrl_fn can produce unflattened data
                for record in result.as_array().unwrap().iter() {
                    // use usize::MAX as a flag to disregard original_value
                    send_to_children(
                        &mut channels.child_senders,
                        PipelineItem {
                            idx: usize::MAX,
                            record: record.clone(),
                            flattened: false,
                        },
                        "FunctionNode",
                    )
                    .await;
                }
            }
            CompiledFunctionRuntime::JS(js_config, true) => {
                // JS result array processing
                let js_arr_timer = Instant::now();
                let js_arr_res = apply_js_fn(
                    js_config,
                    json::Value::Array(result_array_records),
                    &metadata.org_id,
                    std::slice::from_ref(&stream_name),
                );
                *busy += js_arr_timer.elapsed();
                let result = match js_arr_res {
                    (res, None) => res,
                    (res, Some(error)) => {
                        let err_msg = format!(
                            "FunctionNode JS result array error: {}",
                            error.get(0..500).unwrap_or(&error)
                        );
                        if let Err(send_err) = channels
                            .error_sender
                            .send((
                                node.id.to_string(),
                                node.node_type(),
                                err_msg.to_owned(),
                                Some(func_params.name.to_owned()),
                                value_copy,
                            ))
                            .await
                        {
                            log::error!(
                                "[Pipeline] {} [inv={inv_id}]: FunctionNode failed sending errors for collection caused by: {send_err}",
                                metadata.pipeline_name
                            );
                            return count;
                        }
                        res
                    }
                };
                // Process result array
                if let Some(result_arr) = result.as_array() {
                    for record in result_arr.iter() {
                        // use usize::MAX as a flag to disregard original_value
                        send_to_children(
                            &mut channels.child_senders,
                            PipelineItem {
                                idx: usize::MAX,
                                record: record.clone(),
                                flattened: false,
                            },
                            "FunctionNode",
                        )
                        .await;
                    }
                }
            }
            _ => {
                // Shouldn't happen (is_result_array is false)
                log::error!(
                    "[Pipeline] {} [inv={inv_id}]: Function node has result_array_records but runtime is not in result array mode",
                    metadata.pipeline_name,
                );
            }
        }
    }
    log::debug!(
        "[Pipeline] {} [inv={inv_id}]: func node {} done processing {count} records",
        metadata.pipeline_name,
        metadata.node_idx
    );

    count
}

async fn process_condition_node(
    condition_params: &config::meta::pipeline::components::ConditionParams,
    metadata: ProcessMetadata,
    node: &ExecutableNode,
    mut channels: ProcessChannels,
    busy: &mut Duration,
) -> usize {
    let mut count: usize = 0;
    let cfg = config::get_config();
    let inv_id = metadata.inv_id;
    log::debug!(
        "[Pipeline] {} [inv={inv_id}]: cond node {} starts processing",
        metadata.pipeline_name,
        metadata.node_idx
    );
    let mut total_received: usize = 0;
    while let Some(pipeline_item) = channels.receiver.recv().await {
        total_received += 1;
        let PipelineItem {
            idx,
            mut record,
            mut flattened,
        } = pipeline_item;

        let value_copy = if metadata.return_value_for_error {
            Some(record.clone())
        } else {
            None
        };
        // value must be flattened before condition params can take effect
        if !flattened && !record.is_null() && record.is_object() {
            let flatten_timer = Instant::now();
            let flatten_res = flatten::flatten_with_level(record, cfg.limit.ingest_flatten_level);
            *busy += flatten_timer.elapsed();
            record = match flatten_res {
                Ok(flattened) => flattened,
                Err(e) => {
                    let err_msg = format!("ConditionNode error with flattening: {e}");
                    if let Err(send_err) = channels
                        .error_sender
                        .send((
                            node.id.to_string(),
                            node.node_type(),
                            err_msg,
                            None,
                            value_copy,
                        ))
                        .await
                    {
                        log::error!(
                            "[Pipeline] {} [inv={inv_id}]: ConditionNode failed sending errors for collection caused by: {send_err}",
                            metadata.pipeline_name
                        );
                        break;
                    }
                    continue;
                }
            };
            flattened = true;
        }

        // A null / non-object record means an upstream function filtered it out
        // (e.g. VRL `. = null`). Skip it: it can't satisfy any condition and
        // `as_object().unwrap()` below would panic on a null.
        if !record.is_object() {
            continue;
        }

        // Evaluate based on condition version
        let eval_timer = Instant::now();
        let passes = match condition_params {
            config::meta::pipeline::components::ConditionParams::V1 { conditions } => {
                // v1: Use tree-based ConditionList evaluation
                conditions.evaluate(record.as_object().unwrap()).await
            }
            config::meta::pipeline::components::ConditionParams::V2 { conditions } => {
                // v2: Use linear ConditionGroup evaluation
                conditions.evaluate(record.as_object().unwrap()).await
            }
        };
        *busy += eval_timer.elapsed();

        // only send to children when passing all condition evaluations
        if passes {
            send_to_children(
                &mut channels.child_senders,
                PipelineItem {
                    idx,
                    record,
                    flattened,
                },
                "ConditionNode",
            )
            .await;
            count += 1;
        }
    }
    log::info!(
        "[Pipeline] {} [inv={inv_id}]: cond node {} done: received={total_received}, passed={count} records",
        metadata.pipeline_name,
        metadata.node_idx,
    );
    count
}

async fn process_stream_node(
    stream_params: &StreamParams,
    metadata: ProcessMetadata,
    node: &ExecutableNode,
    mut channels: ProcessChannels,
    busy: &mut Duration,
) -> usize {
    let cfg = config::get_config();
    let mut count: usize = 0;
    let inv_id = metadata.inv_id;
    if node.children.is_empty() {
        log::debug!(
            "[Pipeline] {} [inv={inv_id}]: Leaf node {} starts processing (stream={}:{})",
            metadata.pipeline_name,
            metadata.node_idx,
            stream_params.stream_type,
            stream_params.stream_name,
        );
        // leaf node: `result_sender` guaranteed to be Some()
        let result_sender = channels.result_sender.unwrap();
        let is_cross_type = stream_params.stream_type != metadata.source_stream_type;
        // For cross-type destinations, collect records to ingest directly
        let mut cross_type_records: Vec<Value> = Vec::new();

        while let Some(pipeline_item) = channels.receiver.recv().await {
            let PipelineItem {
                idx,
                mut record,
                flattened,
            } = pipeline_item;

            let value_copy = if metadata.return_value_for_error {
                Some(record.clone())
            } else {
                None
            };

            if !flattened && !record.is_null() && record.is_object() {
                let flatten_timer = Instant::now();
                let flatten_res =
                    flatten::flatten_with_level(record, cfg.limit.ingest_flatten_level);
                *busy += flatten_timer.elapsed();
                record = match flatten_res {
                    Ok(flattened) => flattened,
                    Err(e) => {
                        let err_msg = format!("LeafNode error with flattening: {e}");
                        if let Err(send_err) = channels
                            .error_sender
                            .send((
                                node.id.to_string(),
                                node.node_type(),
                                err_msg,
                                None,
                                value_copy,
                            ))
                            .await
                        {
                            log::error!(
                                "[Pipeline] {} [inv={inv_id}]: LeafNode failed sending errors for collection caused by: {send_err}",
                                metadata.pipeline_name,
                            );
                            break;
                        }
                        continue;
                    }
                };
            }

            // A null / non-object record means an upstream function filtered it
            // out (e.g. VRL `. = null`). Drop it instead of forwarding to the
            // destination, where it would fail at handle_timestamp with
            // "Value is not an object" and inflate the failed count.
            if !record.is_object() {
                continue;
            }

            let mut destination_stream = stream_params.clone();
            if destination_stream.stream_name.contains("{") {
                match resolve_stream_name(&destination_stream.stream_name, &record) {
                    Ok(stream_name) if !stream_name.is_empty() => {
                        destination_stream.stream_name = if cfg.common.skip_formatting_stream_name {
                            stream_name.into()
                        } else {
                            format_stream_name(stream_name).into()
                        }
                    }
                    resolve_res => {
                        let err_msg = if let Err(e) = resolve_res {
                            format!(
                                "Dynamic stream name detected in destination, but failed to resolve due to {e}. Record dropped"
                            )
                        } else {
                            "Dynamic Stream Name resolved to empty. Record dropped".to_string()
                        };
                        log::warn!(
                            "[Pipeline] {} [inv={inv_id}]: {err_msg}",
                            metadata.pipeline_name
                        );
                        if let Err(send_err) = channels
                            .error_sender
                            .send((
                                node.id.to_string(),
                                node.node_type(),
                                err_msg,
                                None,
                                value_copy,
                            ))
                            .await
                        {
                            log::error!(
                                "[Pipeline] {} [inv={inv_id}]: LeafNode failed sending errors for collection caused by: {send_err}",
                                metadata.pipeline_name
                            );
                            break;
                        }
                        continue;
                    }
                }
            }

            if is_cross_type {
                // Cross-type: collect for direct ingestion
                cross_type_records.push(record);
            } else {
                // Same-type: send via result_sender for caller to handle
                if let Err(send_err) = result_sender.send((idx, destination_stream, record)).await {
                    log::error!(
                        "[Pipeline] {} [inv={inv_id}]: LeafNode errors sending result for collection caused by: {send_err}",
                        metadata.pipeline_name
                    );
                    break;
                }
            }
            count += 1;
        }

        // For cross-type destinations, spawn ingestion as background task
        // so it doesn't block the primary pipeline path
        if is_cross_type && !cross_type_records.is_empty() {
            let record_count = cross_type_records.len();
            let dest_stream_type = stream_params.stream_type.to_string();
            let dest_stream_name = stream_params.stream_name.to_string();
            let org = metadata.org_id.to_string();
            let pl_name = metadata.pipeline_name.clone();
            let node_idx = metadata.node_idx;
            let inv = inv_id.clone();
            log::debug!(
                "[Pipeline] {pl_name} [inv={inv_id}]: LeafNode {node_idx} spawning background ingestion for {record_count} cross-type records to {dest_stream_type}:{dest_stream_name}",
            );
            tokio::spawn(async move {
                let req = cluster_rpc::IngestionRequest {
                    org_id: org,
                    stream_name: dest_stream_name.clone(),
                    stream_type: dest_stream_type.clone(),
                    data: Some(cluster_rpc::IngestionData::from(cross_type_records)),
                    ingestion_type: Some(cluster_rpc::IngestionType::Json.into()),
                    metadata: None,
                };
                match crate::ingestion::ingestion_service::ingest(req).await {
                    Ok(resp) if resp.status_code == 200 => {
                        log::debug!(
                            "[Pipeline] {pl_name} [inv={inv}]: cross-type ingestion successful to {dest_stream_type}:{dest_stream_name}, records: {record_count}",
                        );
                    }
                    Ok(resp) => {
                        log::error!(
                            "[Pipeline] {pl_name} [inv={inv}]: cross-type ingestion failed (status={}): {}",
                            resp.status_code,
                            resp.message,
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "[Pipeline] {pl_name} [inv={inv}]: cross-type ingestion error: {e}"
                        );
                    }
                }
            });
        }

        log::info!(
            "[Pipeline] {} [inv={inv_id}] : LeafNode {} done processing {count} records (stream={}:{})",
            metadata.pipeline_name,
            metadata.node_idx,
            stream_params.stream_type,
            stream_params.stream_name
        );
    } else {
        log::debug!(
            "[Pipeline] {} [inv={inv_id}]: source node {} starts processing",
            metadata.pipeline_name,
            metadata.node_idx
        );
        // source stream node: send received record to all its children
        while let Some(item) = channels.receiver.recv().await {
            send_to_children(&mut channels.child_senders, item, "StreamNode").await;
            count += 1;
        }
        log::debug!(
            "[Pipeline] {} [inv={inv_id}] : source node {} done processing {count} records",
            metadata.pipeline_name,
            metadata.node_idx
        );
    }
    count
}

#[cfg(feature = "enterprise")]
async fn process_destination_node(
    metadata: ProcessMetadata,
    mut channels: ProcessChannels,
    node: &ExecutableNode,
    destination: &WorkflowDestination,
) -> Result<usize, anyhow::Error> {
    let (dest, _) = crate::alerts::destinations::get_with_template(
        &metadata.org_id,
        &destination.destination_id,
    )
    .await?;

    let cfg = config::get_config();

    let mut data = Vec::new();
    while let Some(pipeline_item) = channels.receiver.recv().await {
        data.push(std::sync::Arc::new(pipeline_item.record));
    }

    let data_count = data.len();

    match dest.module {
        Module::Alert { .. } => {
            if let Err(send_err) = channels
                .error_sender
                .send((
                    node.id.to_string(),
                    node.node_type(),
                    format!(
                        "destination {} is an alert destination and not not supported in workflows",
                        destination.destination_id
                    ),
                    None,
                    None,
                ))
                .await
            {
                log::error!(
                    "[Pipeline] {} [inv={}]: LeafNode failed sending errors for collection caused by: {send_err}",
                    metadata.pipeline_name,
                    metadata.inv_id,
                );
            }
            return Ok(0);
        }
        Module::Pipeline { endpoint } => {
            let op_fmt = endpoint.output_format.unwrap_or_default();
            let send_data = op_fmt.get_body_from_data(&data, &endpoint.metadata);
            let content_type = op_fmt.get_content_type();
            let headers = endpoint.headers.unwrap_or_default();
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(
                    cfg.pipeline.remote_request_timeout,
                ))
                .danger_accept_invalid_certs(endpoint.skip_tls_verify)
                .build()
                .unwrap();

            let mut client = client
                .post(endpoint.url)
                .header("Content-type", content_type);
            for (name, val) in headers {
                client = client.header(name, val);
            }
            if let Err(e) = client.body(send_data).send().await {
                let data_copy: Vec<_> = data.into_iter().map(|v| v.as_ref().clone()).collect();
                let data = Value::Array(data_copy);
                if let Err(send_err) = channels
                    .error_sender
                    .send((
                        node.id.to_string(),
                        node.node_type(),
                        e.to_string(),
                        None,
                        Some(data),
                    ))
                    .await
                {
                    log::error!(
                        "[Pipeline] {} [inv={}]: LeafNode failed sending errors for collection caused by: {send_err}",
                        metadata.inv_id,
                        metadata.pipeline_name
                    );
                }
                return Ok(0);
            }
        }
    }
    Ok(data_count)
}

#[cfg(feature = "enterprise")]
pub async fn flush_all_buffers() -> Result<(), anyhow::Error> {
    let mut buffers = BATCH_BUFFERS.lock().await;

    for (batch_key, buffer) in buffers.iter_mut() {
        // let buffer_key = format!("{}:{}:{}:{}:{}", pipeline_id, remote_stream.org_id,
        // remote_stream.destination_name, batch_key, "remote");
        let key = batch_key.clone();
        let key_parts = key.split(":").collect::<Vec<&str>>();
        let pipeline_id = key_parts[0].to_string();
        let org_id = key_parts[1].to_string();
        let destination_name = key_parts[2].to_string();
        let batch_key = key_parts[3].to_string();
        // let stream_type = key_parts[4].to_string();

        let remote_stream = config::meta::stream::RemoteStreamParams {
            org_id: org_id.clone().into(),
            destination_name: destination_name.clone().into(),
        };

        let mut remote_stream_for_batch = remote_stream.clone();
        remote_stream_for_batch.org_id = org_id.clone().into();

        if buffer.should_flush() {
            let records_to_write = buffer.take_records();

            log::debug!(
                "[Pipeline]: Flushing buffer for batch_key '{}' - writing {} records to WAL",
                batch_key,
                records_to_write.len()
            );

            // Create remote stream configuration with batch_key routing
            let mut remote_stream_for_batch = remote_stream.clone();
            remote_stream_for_batch.org_id = org_id.clone().into();

            let records_len = records_to_write.len();

            let writer = get_pipeline_wal_writer(&pipeline_id, remote_stream_for_batch).await?;
            match writer.write_wal(records_to_write).await {
                Err(e) => {
                    let err_msg = format!(
                        "DestinationNode error persisting data for batch_key '{batch_key}' to be ingested externally: {e}"
                    );
                    log::error!("{err_msg}");
                }
                Ok(data_size) => {
                    let data_size_mb = data_size as f64 / config::SIZE_IN_MB;

                    // Report remote destination usage after successful WAL write
                    if data_size_mb > 0.0 {
                        let req_stats = config::meta::self_reporting::usage::RequestStats {
                            size: data_size_mb,
                            records: records_len as i64,
                            response_time: 0.0,
                            ..config::meta::self_reporting::usage::RequestStats::default()
                        };

                        usage_reporting::report_request_usage_stats(
                            req_stats,
                            &org_id,
                            &destination_name,
                            config::meta::stream::StreamType::Logs, /* Default to Logs for
                                                                     * remote destination */
                            config::meta::self_reporting::usage::UsageType::RemotePipeline,
                            0, // No additional functions for remote destination
                            chrono::Utc::now().timestamp_micros(),
                        )
                        .await;
                    }
                }
            }
        }
    }
    drop(buffers); // Release the lock before async operations

    Ok(())
}

async fn send_to_children(
    child_senders: &mut [Sender<PipelineItem>],
    item: PipelineItem,
    node_type: &str,
) {
    if child_senders.len() == 1 {
        // HACK to avoid cloning
        if let Err(send_err) = child_senders[0].send(item).await {
            log::error!(
                "[Pipeline]: {node_type} errors sending record to its children caused by: {send_err}"
            );
        }
    } else {
        for child_sender in child_senders.iter_mut() {
            if let Err(send_err) = child_sender.send(item.clone()).await {
                log::error!(
                    "[Pipeline]: {node_type} errors sending record to its children caused by: {send_err}"
                );
                break;
            }
        }
    }
}

fn topological_sort(node_map: &HashMap<String, ExecutableNode>) -> Result<Vec<String>> {
    let mut result = Vec::new();
    let mut visited = HashSet::new();
    let mut temp = HashSet::new();

    let graph: HashMap<String, Vec<String>> = node_map
        .iter()
        .map(|(k, v)| (k.clone(), v.children.clone()))
        .collect();

    for node in node_map.keys() {
        if let Err(e) = dfs(node, &graph, &mut visited, &mut temp, &mut result) {
            return Err(anyhow!(
                "[Pipeline] Error to topological sort the nodes in preparing execution: {}",
                e
            ));
        }
    }

    result.reverse();
    Ok(result)
}

fn dfs(
    current_node_id: &str,
    graph: &HashMap<String, Vec<String>>,
    visited: &mut HashSet<String>,
    temp: &mut HashSet<String>,
    result: &mut Vec<String>,
) -> Result<()> {
    if temp.contains(current_node_id) {
        return Err(anyhow!("Cyclical pipeline detected."));
    }
    if visited.contains(current_node_id) {
        return Ok(());
    }
    temp.insert(current_node_id.to_string());
    if let Some(neighbors) = graph.get(current_node_id) {
        for neighbor in neighbors {
            dfs(neighbor, graph, visited, temp, result)?;
        }
    }
    temp.remove(current_node_id);
    visited.insert(current_node_id.to_string());
    result.push(current_node_id.to_string());
    Ok(())
}

async fn get_transforms(org_id: &str, fn_name: &str) -> Result<Transform> {
    let func_key = format!("{org_id}/{fn_name}");
    if let Some(trans) = QUERY_FUNCTIONS.get(&func_key) {
        return Ok(trans.value().clone());
    }
    // get from database
    crate::db::functions::get(org_id, fn_name).await
}

fn resolve_stream_name(haystack: &str, record: &Value) -> Result<String> {
    // Fast path: if it's a complete pattern like "{field}", avoid regex
    // Check for no inner braces to avoid matching composite patterns like "{level}_{job}"
    if haystack.starts_with("{")
        && haystack.ends_with("}")
        && !haystack[1..haystack.len() - 1].contains('{')
        && !haystack[1..haystack.len() - 1].contains('}')
    {
        let field_name = &haystack[1..haystack.len() - 1];
        return match record.get(field_name) {
            Some(stream_name) => Ok(get_string_value(stream_name)),
            None => Err(anyhow!("Field name {field_name} not found in record")),
        };
    }

    // Slow path: handle partial matches using regex
    let mut result = String::with_capacity(haystack.len());
    let mut last_match = 0;
    for cap in DYNAMIC_STREAM_NAME_PATTERN.captures_iter(haystack) {
        let field_name = cap.get(1).unwrap().as_str();
        let full_match = cap.get(0).unwrap();

        // Add the text between the last match and this one
        result.push_str(&haystack[last_match..full_match.start()]);

        // Get and validate the field value
        match record.get(field_name) {
            Some(value) => result.push_str(&get_string_value(value)),
            None => return Err(anyhow!("Field name {field_name} not found in record")),
        }

        last_match = full_match.end();
    }
    result.push_str(&haystack[last_match..]);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::utils::json;

    use super::*;

    #[test]
    fn test_my_regex() {
        let record = json::json!({
            "app_name": "o2",
            "container_name": "compactor",
            "value": 123
        });
        let ok_cases = vec![
            ("container_name", "container_name"),
            ("{container_name}", "compactor"),
            ("abc-{container_name}", "abc-compactor"),
            ("abc-{container_name}-xyz", "abc-compactor-xyz"),
            ("abc-{value}-xyz", "abc-123-xyz"),
            ("{value}", "123"),
            // Test composite patterns with multiple field references
            ("{app_name}_{container_name}", "o2_compactor"),
            ("{app_name}-{value}-{container_name}", "o2-123-compactor"),
        ];
        for (test, expected) in ok_cases {
            let result = resolve_stream_name(test, &record);
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), expected);
        }
        let err1 = resolve_stream_name("{{value}}", &record);
        assert!(err1.is_err());
        let err1 = resolve_stream_name("{{eulav}}", &record);
        assert!(err1.is_err());
    }

    // Test ExecutablePipelineBulkInputs
    #[test]
    fn test_executable_pipeline_bulk_inputs_new() {
        let inputs = ExecutablePipelineBulkInputs::new();
        assert!(inputs.records.is_empty());
        assert!(inputs.doc_ids.is_empty());
        assert!(inputs.originals.is_empty());
    }

    #[test]
    fn test_contains_llm_evaluation_node_detects_misclassified_eval_pipeline() {
        let mut node_map = HashMap::new();
        node_map.insert(
            "eval".to_string(),
            ExecutableNode {
                id: "eval".to_string(),
                node_data: NodeData::LlmEvaluation(
                    config::meta::pipeline::components::LlmEvaluationParams {
                        name: "eval-job".to_string(),
                        sampling_rate: 1.0,
                        scorers: Vec::new(),
                        job_id: Some("job-1".to_string()),
                        job_version: Some(1),
                        input_mapping: None,
                    },
                ),
                children: Vec::new(),
            },
        );
        let pipeline = ExecutablePipeline {
            id: "pipe-1".to_string(),
            name: "__eval__job".to_string(),
            is_realtime: false,
            source_node_id: "input".to_string(),
            sorted_nodes: vec!["eval".to_string()],
            function_map: HashMap::new(),
            node_map,
            kind: PipelineKind::User,
        };

        assert!(pipeline.contains_llm_evaluation_node());
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_llm_evaluation_node_does_not_forward_downstream() {
        let params = config::meta::pipeline::components::LlmEvaluationParams {
            name: "eval-job".to_string(),
            sampling_rate: 1.0,
            scorers: Vec::new(),
            job_id: Some("job-1".to_string()),
            job_version: Some(1),
            input_mapping: None,
        };
        let metadata = ProcessMetadata {
            pipeline_id: "pipeline-1".to_string(),
            node_idx: 1,
            org_id: "org-1".to_string(),
            pipeline_name: "eval-pipeline".to_string(),
            pipeline_kind: PipelineKind::Evaluation,
            stream_name: Some("traces".to_string()),
            source_stream_name: "traces".to_string(),
            source_stream_type: StreamType::Traces,
            inv_id: "test".to_string(),
            print_event: false,
            leaf_dest_stream: None,
            return_value_for_error: false,
        };
        let (input_tx, input_rx) = tokio::sync::mpsc::channel(1);
        let (child_tx, mut child_rx) = tokio::sync::mpsc::channel(1);
        let (error_tx, _error_rx) = tokio::sync::mpsc::channel(1);

        input_tx
            .send(PipelineItem {
                idx: 0,
                record: json::json!({
                    "span_id": "span-1",
                    "trace_id": "trace-1",
                }),
                flattened: true,
            })
            .await
            .unwrap();
        drop(input_tx);

        let count = process_llm_evaluation_node(
            &params,
            metadata,
            ProcessChannels {
                receiver: input_rx,
                child_senders: vec![child_tx],
                result_sender: None,
                error_sender: error_tx,
            },
        )
        .await;

        assert_eq!(count, 1);
        assert!(child_rx.try_recv().is_err());
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_llm_evaluation_node_rejects_reserved_source_streams() {
        assert!(!is_allowed_eval_source(
            &PipelineKind::Evaluation,
            "_evaluator",
            StreamType::Traces
        ));
        assert!(!is_allowed_eval_source(
            &PipelineKind::Evaluation,
            "_llm_scores",
            StreamType::Traces
        ));
        assert!(!is_allowed_eval_source(
            &PipelineKind::Evaluation,
            "customer-logs",
            StreamType::Logs
        ));
        assert!(!is_allowed_eval_source(
            &PipelineKind::User,
            "customer-traces",
            StreamType::Traces
        ));
        assert!(is_allowed_eval_source(
            &PipelineKind::Evaluation,
            "customer-traces",
            StreamType::Traces
        ));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_llm_eval_sampling_prefers_span_identity() {
        let first_span = json::json!({
            "span_id": "span-a",
            "trace_id": "same-trace",
        });
        let second_span = json::json!({
            "span_id": "span-b",
            "trace_id": "same-trace",
        });
        let trace_only = json::json!({
            "trace_id": "same-trace",
        });

        assert_eq!(eval_sampling_key(&first_span, 0), "span-a");
        assert_eq!(eval_sampling_key(&second_span, 0), "span-b");
        assert_eq!(eval_sampling_key(&trace_only, 99), "same-trace");
    }

    #[test]
    fn test_executable_pipeline_bulk_inputs_default() {
        let inputs = ExecutablePipelineBulkInputs::default();
        assert!(inputs.records.is_empty());
        assert!(inputs.doc_ids.is_empty());
        assert!(inputs.originals.is_empty());
    }

    #[test]
    fn test_executable_pipeline_bulk_inputs_add_input() {
        let mut inputs = ExecutablePipelineBulkInputs::new();
        let record = json::json!({"key": "value"});
        let doc_id = Some("doc123".to_string());
        let original = Some("original_data".to_string());

        inputs.add_input(record.clone(), doc_id.clone(), original.clone());

        assert_eq!(inputs.records.len(), 1);
        assert_eq!(inputs.doc_ids.len(), 1);
        assert_eq!(inputs.originals.len(), 1);
        assert_eq!(inputs.records[0], record);
        assert_eq!(inputs.doc_ids[0], doc_id);
        assert_eq!(inputs.originals[0], original);
    }

    #[test]
    fn test_executable_pipeline_bulk_inputs_add_multiple() {
        let mut inputs = ExecutablePipelineBulkInputs::new();

        // Add first input
        let record1 = json::json!({"key1": "value1"});
        inputs.add_input(record1.clone(), Some("doc1".to_string()), None);

        // Add second input
        let record2 = json::json!({"key2": "value2"});
        inputs.add_input(record2.clone(), None, Some("original2".to_string()));

        assert_eq!(inputs.records.len(), 2);
        assert_eq!(inputs.doc_ids.len(), 2);
        assert_eq!(inputs.originals.len(), 2);

        assert_eq!(inputs.records[0], record1);
        assert_eq!(inputs.records[1], record2);
        assert_eq!(inputs.doc_ids[0], Some("doc1".to_string()));
        assert_eq!(inputs.doc_ids[1], None);
        assert_eq!(inputs.originals[0], None);
        assert_eq!(inputs.originals[1], Some("original2".to_string()));
    }

    #[test]
    fn test_executable_pipeline_bulk_inputs_into_parts() {
        let mut inputs = ExecutablePipelineBulkInputs::new();
        let record = json::json!({"test": "data"});
        let doc_id = Some("test_doc".to_string());
        let original = Some("test_original".to_string());

        inputs.add_input(record.clone(), doc_id.clone(), original.clone());

        let (records, doc_ids, originals) = inputs.into_parts();

        assert_eq!(records.len(), 1);
        assert_eq!(doc_ids.len(), 1);
        assert_eq!(originals.len(), 1);
        assert_eq!(records[0], record);
        assert_eq!(doc_ids[0], doc_id);
        assert_eq!(originals[0], original);
    }

    // Test ExecutableNode
    #[test]
    fn test_executable_node_display_stream() {
        let node = ExecutableNode {
            id: "test_id".to_string(),
            node_data: NodeData::Stream(StreamParams::new("org1", "stream1", StreamType::Logs)),
            children: vec![],
        };
        assert_eq!(node.to_string(), "stream");
        assert_eq!(node.node_type(), "stream");
    }

    #[test]
    fn test_executable_node_display_function() {
        let node = ExecutableNode {
            id: "test_id".to_string(),
            node_data: NodeData::Function(config::meta::pipeline::components::FunctionParams {
                name: "test_function".to_string(),
                after_flatten: true,
                num_args: 1,
            }),
            children: vec![],
        };
        assert_eq!(node.to_string(), "function");
        assert_eq!(node.node_type(), "function");
    }

    // Test topological_sort function
    #[test]
    fn test_topological_sort_simple_chain() {
        let mut node_map = HashMap::new();

        // Create a simple chain: A -> B -> C
        node_map.insert(
            "A".to_string(),
            ExecutableNode {
                id: "A".to_string(),
                node_data: NodeData::Stream(StreamParams::new("org1", "stream1", StreamType::Logs)),
                children: vec!["B".to_string()],
            },
        );

        node_map.insert(
            "B".to_string(),
            ExecutableNode {
                id: "B".to_string(),
                node_data: NodeData::Function(config::meta::pipeline::components::FunctionParams {
                    name: "func1".to_string(),
                    after_flatten: false,
                    num_args: 0,
                }),
                children: vec!["C".to_string()],
            },
        );

        node_map.insert(
            "C".to_string(),
            ExecutableNode {
                id: "C".to_string(),
                node_data: NodeData::Stream(StreamParams::new("org1", "stream2", StreamType::Logs)),
                children: vec![],
            },
        );

        let result = topological_sort(&node_map);
        assert!(result.is_ok());
        let sorted = result.unwrap();
        assert_eq!(sorted.len(), 3);

        // A should come before B, B should come before C
        let a_pos = sorted.iter().position(|x| x == "A").unwrap();
        let b_pos = sorted.iter().position(|x| x == "B").unwrap();
        let c_pos = sorted.iter().position(|x| x == "C").unwrap();

        assert!(a_pos < b_pos);
        assert!(b_pos < c_pos);
    }

    #[test]
    fn test_topological_sort_single_node() {
        let mut node_map = HashMap::new();

        node_map.insert(
            "A".to_string(),
            ExecutableNode {
                id: "A".to_string(),
                node_data: NodeData::Stream(StreamParams::new("org1", "stream1", StreamType::Logs)),
                children: vec![],
            },
        );

        let result = topological_sort(&node_map);
        assert!(result.is_ok());
        let sorted = result.unwrap();
        assert_eq!(sorted.len(), 1);
        assert_eq!(sorted[0], "A");
    }

    #[test]
    fn test_topological_sort_empty() {
        let node_map = HashMap::new();
        let result = topological_sort(&node_map);
        assert!(result.is_ok());
        let sorted = result.unwrap();
        assert!(sorted.is_empty());
    }

    // Test resolve_stream_name function
    #[test]
    fn test_resolve_stream_name_simple_field() {
        let record = json::json!({
            "stream": "test_stream",
            "value": 42
        });

        let result = resolve_stream_name("{stream}", &record);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "test_stream");
    }

    #[test]
    fn test_resolve_stream_name_complex_pattern() {
        let record = json::json!({
            "app": "myapp",
            "env": "prod",
            "version": "1.0"
        });

        let result = resolve_stream_name("logs-{app}-{env}-{version}", &record);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "logs-myapp-prod-1.0");
    }

    #[test]
    fn test_resolve_stream_name_missing_field() {
        let record = json::json!({
            "existing": "value"
        });

        let result = resolve_stream_name("{missing_field}", &record);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Field name missing_field not found")
        );
    }

    #[test]
    fn test_resolve_stream_name_no_pattern() {
        let record = json::json!({
            "field": "value"
        });

        let result = resolve_stream_name("static_stream_name", &record);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "static_stream_name");
    }

    // Test BatchBuffer (enterprise feature)
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_batch_buffer_new() {
        let buffer = BatchBuffer::new();
        assert!(buffer.records.is_empty());
        assert_eq!(buffer.total_bytes, 0);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_batch_buffer_add_records() {
        let mut buffer = BatchBuffer::new();
        let records = vec![
            json::json!({"key1": "value1"}),
            json::json!({"key2": "value2"}),
        ];

        buffer.add_records(records.clone());

        assert_eq!(buffer.records.len(), 2);
        assert!(buffer.total_bytes > 0);
        assert_eq!(buffer.records[0], records[0]);
        assert_eq!(buffer.records[1], records[1]);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_batch_buffer_should_flush_by_size() {
        let mut buffer = BatchBuffer::new();

        // Add records up to the limit
        for i in 0..50 {
            buffer.add_records(vec![json::json!({"id": i})]);
        }

        assert!(buffer.should_flush()); // Should flush due to record count
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_batch_buffer_take_records() {
        let mut buffer = BatchBuffer::new();
        let records = vec![
            json::json!({"key1": "value1"}),
            json::json!({"key2": "value2"}),
        ];

        buffer.add_records(records.clone());
        let taken = buffer.take_records();

        assert_eq!(taken.len(), 2);
        assert_eq!(taken[0], records[0]);
        assert_eq!(taken[1], records[1]);

        // Buffer should be empty after taking
        assert!(buffer.records.is_empty());
        assert_eq!(buffer.total_bytes, 0);
    }

    // Tests for CompiledFunctionRuntime enum
    #[test]
    fn test_compiled_function_runtime_enum_js_variant() {
        use transform::js::JSRuntimeConfig;

        let js_config = JSRuntimeConfig {
            function: "function(row) { return row; }".to_string(),
            params: vec!["row".to_string()],
        };

        let runtime = CompiledFunctionRuntime::JS(js_config.clone(), false);

        // Test pattern matching
        match runtime {
            CompiledFunctionRuntime::JS(config, is_result_array) => {
                assert_eq!(config.params.len(), 1);
                assert_eq!(config.params[0], "row");
                assert!(!is_result_array);
            }
            _ => panic!("Expected JS variant"),
        }
    }

    #[test]
    fn test_compiled_function_runtime_enum_vrl_variant() {
        use transform::compile_vrl_function;

        // Use actual VRL compilation to get a valid program
        let vrl_code = ". = {}";
        let result = compile_vrl_function(vrl_code, "test_org");
        assert!(result.is_ok());

        let vrl_config = result.unwrap();
        let fields = vec!["field1".to_string(), "field2".to_string()];
        let vrl_resolver = VRLResultResolver {
            program: vrl_config.program,
            fields: fields.clone(),
        };

        let runtime = CompiledFunctionRuntime::VRL(Box::new(vrl_resolver), false);

        // Test pattern matching
        match runtime {
            CompiledFunctionRuntime::VRL(resolver, is_result_array) => {
                assert_eq!(resolver.fields.len(), 2);
                assert_eq!(resolver.fields, fields);
                assert!(!is_result_array);
            }
            _ => panic!("Expected VRL variant"),
        }
    }

    #[test]
    fn test_compiled_function_runtime_result_array_flags() {
        use transform::{compile_vrl_function, js::JSRuntimeConfig};

        let js_config = JSRuntimeConfig {
            function: "function(rows) { return rows; }".to_string(),
            params: vec!["rows".to_string()],
        };

        // Test JS with result array flag
        let js_runtime = CompiledFunctionRuntime::JS(js_config, true);
        match js_runtime {
            CompiledFunctionRuntime::JS(_, is_result_array) => {
                assert!(is_result_array, "JS result array flag should be true");
            }
            _ => panic!("Expected JS variant"),
        }

        // Test VRL with result array flag
        let vrl_code = ". = {}";
        let vrl_config = compile_vrl_function(vrl_code, "test_org").unwrap();
        let fields = vec!["field1".to_string()];
        let vrl_resolver = VRLResultResolver {
            program: vrl_config.program,
            fields,
        };
        let vrl_runtime = CompiledFunctionRuntime::VRL(Box::new(vrl_resolver), true);
        match vrl_runtime {
            CompiledFunctionRuntime::VRL(_, is_result_array) => {
                assert!(is_result_array, "VRL result array flag should be true");
            }
            _ => panic!("Expected VRL variant"),
        }
    }

    #[test]
    fn test_compiled_function_runtime_clone() {
        use transform::js::JSRuntimeConfig;

        let js_config = JSRuntimeConfig {
            function: "function(row) { return row; }".to_string(),
            params: vec!["row".to_string()],
        };

        let runtime = CompiledFunctionRuntime::JS(js_config, false);
        let cloned = runtime.clone();

        // Verify clone works correctly
        match cloned {
            CompiledFunctionRuntime::JS(config, _) => {
                assert_eq!(config.params.len(), 1);
                assert!(config.function.contains("function"));
            }
            _ => panic!("Expected JS variant"),
        }
    }

    // Test for JS function compilation in register_functions context
    #[test]
    fn test_js_function_detection() {
        use config::meta::function::Transform;

        // Test JS function detection
        let js_transform = Transform {
            function: "function(row) { return row; }".to_string(),
            name: "test_js".to_string(),
            params: "row".to_string(),
            num_args: 1,
            trans_type: Some(1), // JS type
            streams: None,
        };
        assert!(js_transform.is_js());
        assert!(!js_transform.is_vrl());

        // Test VRL function detection
        let vrl_transform = Transform {
            function: ". = {}".to_string(),
            name: "test_vrl".to_string(),
            params: String::new(),
            num_args: 0,
            trans_type: Some(0), // VRL type
            streams: None,
        };
        assert!(vrl_transform.is_vrl());
        assert!(!vrl_transform.is_js());

        // Test default (should not be JS)
        let default_transform = Transform {
            function: ". = {}".to_string(),
            name: "test_default".to_string(),
            params: String::new(),
            num_args: 0,
            trans_type: None,
            streams: None,
        };
        assert!(!default_transform.is_js());
    }

    #[test]
    fn test_js_result_array_detection() {
        use config::meta::function::Transform;

        // Test JS function with result array marker
        let js_result_array_transform = Transform {
            function: "#ResultArray# function(rows) { return rows.map(r => r); }".to_string(),
            name: "test_result_array".to_string(),
            params: "rows".to_string(),
            num_args: 1,
            trans_type: Some(1), // JS type
            streams: None,
        };
        assert!(js_result_array_transform.is_js());
        assert!(js_result_array_transform.is_result_array_js());

        // Test JS function without result array marker
        let js_normal_transform = Transform {
            function: "function(row) { return row; }".to_string(),
            name: "test_normal".to_string(),
            params: "row".to_string(),
            num_args: 1,
            trans_type: Some(1), // JS type
            streams: None,
        };
        assert!(js_normal_transform.is_js());
        assert!(!js_normal_transform.is_result_array_js());
    }

    // Test error handling for JS functions
    #[test]
    fn test_js_compilation_error_handling() {
        use transform::js::compile_js_function;

        // Test invalid JS function
        let invalid_js = "this is not valid javascript {{{";
        let result = compile_js_function(invalid_js, "test_org");

        // Should return an error
        assert!(result.is_err());
    }

    #[test]
    fn test_js_execution_with_simple_record() {
        use transform::js::{apply_js_fn, compile_js_function};

        // Compile a simple JS function (operates directly on 'row' variable)
        let js_code = r#"
            row.processed = true;
            row.count = (row.count || 0) + 1;
        "#;

        let js_config = compile_js_function(js_code, "test_org");
        assert!(
            js_config.is_ok(),
            "JS compilation should succeed: {:?}",
            js_config.err()
        );

        let js_config = js_config.unwrap();

        // Test execution
        let input = json::json!({
            "name": "test",
            "count": 5
        });

        let (result, error) = apply_js_fn(
            &js_config,
            input.clone(),
            "test_org",
            &["test_stream".to_string()],
        );

        // Should succeed
        assert!(
            error.is_none(),
            "JS execution should not error: {:?}",
            error
        );
        assert_eq!(result["processed"], true);
        assert_eq!(result["count"], 6);
        assert_eq!(result["name"], "test");
    }
}
