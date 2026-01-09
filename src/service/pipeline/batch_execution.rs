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

use std::collections::{HashMap, HashSet};

use anyhow::{Result, anyhow};
use async_trait::async_trait;
use chrono::Utc;
use config::{
    meta::{
        function::{Transform, VRLResultResolver},
        pipeline::{Pipeline, components::NodeData},
        self_reporting::error::{ErrorData, ErrorSource, PipelineError},
        stream::{StreamParams, StreamType},
    },
    utils::{
        flatten,
        json::{self, Value, get_string_value},
        schema::format_stream_name,
    },
};
use futures::future::try_join_all;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::pipeline::pipeline_wal_writer::get_pipeline_wal_writer;
use once_cell::sync::Lazy;
use tokio::sync::mpsc::{Receiver, Sender, channel};
#[cfg(feature = "enterprise")]
use tokio::{
    sync::Mutex,
    time::{Duration, Instant},
};

use crate::{
    common::{infra::config::QUERY_FUNCTIONS, utils::js::JSRuntimeConfig},
    service::{
        alerts::{ConditionExt, ConditionGroupExt},
        ingestion::{apply_js_fn, apply_vrl_fn, compile_js_function, compile_vrl_function},
        self_reporting::publish_error,
    },
};

// Global batch buffer for accumulating remote stream records
#[cfg(feature = "enterprise")]
#[derive(Debug)]
struct BatchBuffer {
    records: Vec<json::Value>,
    total_bytes: usize,
    last_write: Instant,
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

#[derive(Debug, Clone)]
pub struct ExecutablePipeline {
    id: String,
    name: String,
    source_node_id: String,
    sorted_nodes: Vec<String>,
    function_map: HashMap<String, CompiledFunctionRuntime>,
    node_map: HashMap<String, ExecutableNode>,
}

#[derive(Debug, Clone)]
pub struct ExecutableNode {
    id: String,
    node_data: NodeData,
    children: Vec<String>,
}

#[derive(Debug)]
pub struct ExecutablePipelineBulkInputs {
    records: Vec<Value>,
    doc_ids: Vec<Option<String>>,
    originals: Vec<Option<String>>,
}

impl ExecutablePipeline {
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
            source_node_id,
            node_map,
            sorted_nodes,
            function_map,
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
        log::debug!("[Pipeline] {pipeline_name} : process batch of size {batch_size}");
        if batch_size == 0 {
            return Ok(HashMap::default());
        }

        // Report pipeline ingestion
        let source_stream_params = self.get_source_stream_params();
        let source_size: f64 = records
            .iter()
            .map(|record| record.to_string().len() as f64)
            .sum::<f64>()
            / config::SIZE_IN_MB;

        if source_size > 0.0 {
            let req_stats = config::meta::self_reporting::usage::RequestStats {
                size: source_size,
                records: batch_size as i64,
                response_time: 0.0,
                ..config::meta::self_reporting::usage::RequestStats::default()
            };

            crate::service::self_reporting::report_request_usage_stats(
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

        // result_channel
        let (result_sender, mut result_receiver) =
            channel::<(usize, StreamParams, Value)>(batch_size);

        // error_channel
        let (error_sender, mut error_receiver) =
            channel::<(String, String, String, Option<String>)>(batch_size);

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
            let stream_name = stream_name.clone();

            // WARN: Do not change. Processing node can only be done in a task, as the internals of
            // remote wal writer depends on the task id.
            let task = tokio::spawn(process_node(
                pl_id_cp,
                idx,
                org_id_cp,
                node,
                node_receiver,
                child_senders,
                function_runtime,
                result_sender_cp,
                error_sender_cp,
                pipeline_name,
                stream_name,
            ));
            node_tasks.push(task);
        }

        // task to collect results
        let result_task = tokio::spawn(async move {
            log::debug!("[Pipeline]: starts result collecting job");
            let mut count: usize = 0;
            let mut results = HashMap::new();
            while let Some((idx, stream_params, record)) = result_receiver.recv().await {
                results
                    .entry(stream_params)
                    .or_insert(Vec::new())
                    .push((idx, record));
                count += 1;
            }
            log::debug!("[Pipeline]: collected {count} records");
            results
        });

        // task to collect errors
        let mut pipeline_error = PipelineError::new(&self.id, &self.name);
        let error_task = tokio::spawn(async move {
            log::debug!("[Pipeline]: starts error collecting job");
            let mut count = 0;
            while let Some((node_id, node_type, error, fn_name)) = error_receiver.recv().await {
                pipeline_error.add_node_error(node_id, node_type, error, fn_name);
                count += 1;
            }
            log::debug!("[Pipeline]: collected {count} errors");
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
                    "[Pipeline]: Error sending original records into source Node for {send_err}"
                );
                break;
            }
        }
        drop(source_sender);
        drop(result_sender);
        drop(error_sender);
        drop(node_senders);
        log::debug!("[Pipeline]: All records send into pipeline for processing");

        // Wait for all node tasks to complete
        if let Err(e) = try_join_all(node_tasks).await {
            log::error!("[Pipeline] node processing jobs failed: {e}");
        }

        // Publish errors if received any
        if let Some(pipeline_errors) = error_task.await.map_err(|e| {
            log::error!("[Pipeline] error collecting job failed: {e}");
            anyhow!("[Pipeline] error collecting job failed: {}", e)
        })? {
            let stream_params = self.get_source_stream_params();
            let error_data = ErrorData {
                _timestamp: Utc::now().timestamp_micros(),
                stream_params,
                error_source: ErrorSource::Pipeline(pipeline_errors),
            };
            log::debug!("[Pipeline]: execution errors occurred and published");
            publish_error(error_data).await;
        }

        let results = result_task.await.map_err(|e| {
            log::error!("[Pipeline] result collecting job failed: {e}");
            anyhow!("[Pipeline] result collecting job failed: {}", e)
        })?;

        Ok(results)
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
}

impl std::fmt::Display for ExecutableNode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.node_data {
            NodeData::Stream(_) => write!(f, "stream"),
            NodeData::Query(_) => write!(f, "query"),
            NodeData::Function(_) => write!(f, "function"),
            NodeData::Condition(_) => write!(f, "condition"),
            NodeData::RemoteStream(_) => write!(f, "remote_stream"),
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

#[allow(clippy::too_many_arguments)]
async fn process_node(
    pipeline_id: String,
    node_idx: usize,
    org_id: String,
    node: ExecutableNode,
    mut receiver: Receiver<PipelineItem>,
    mut child_senders: Vec<Sender<PipelineItem>>,
    function_runtime: Option<CompiledFunctionRuntime>,
    result_sender: Option<Sender<(usize, StreamParams, Value)>>,
    error_sender: Sender<(String, String, String, Option<String>)>,
    pipeline_name: String,
    stream_name: Option<String>,
) -> Result<()> {
    let cfg = config::get_config();
    let mut count: usize = 0;
    match &node.node_data {
        NodeData::Stream(stream_params) => {
            if node.children.is_empty() {
                log::debug!("[Pipeline] {pipeline_name} : Leaf node {node_idx} starts processing");
                // leaf node: `result_sender` guaranteed to be Some()
                // send received results directly via `result_sender` for collection
                let result_sender = result_sender.unwrap();
                while let Some(pipeline_item) = receiver.recv().await {
                    let PipelineItem {
                        idx,
                        mut record,
                        flattened,
                    } = pipeline_item;
                    if !flattened && !record.is_null() && record.is_object() {
                        record = match flatten::flatten_with_level(
                            record,
                            cfg.limit.ingest_flatten_level,
                        ) {
                            Ok(flattened) => flattened,
                            Err(e) => {
                                let err_msg = format!("LeafNode error with flattening: {e}");
                                if let Err(send_err) = error_sender
                                    .send((node.id.to_string(), node.node_type(), err_msg, None))
                                    .await
                                {
                                    log::error!(
                                        "[Pipeline] {pipeline_name} : LeafNode failed sending errors for collection caused by: {send_err}"
                                    );
                                    break;
                                }
                                continue;
                            }
                        };
                    }

                    let mut destination_stream = stream_params.clone();
                    if destination_stream.stream_name.contains("{") {
                        match resolve_stream_name(&destination_stream.stream_name, &record) {
                            Ok(stream_name) if !stream_name.is_empty() => {
                                destination_stream.stream_name =
                                    if cfg.common.skip_formatting_stream_name {
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
                                    "Dynamic Stream Name resolved to empty. Record dropped"
                                        .to_string()
                                };
                                log::warn!("{err_msg}");
                                if let Err(send_err) = error_sender
                                    .send((node.id.to_string(), node.node_type(), err_msg, None))
                                    .await
                                {
                                    log::error!(
                                        "[Pipeline] {pipeline_name} : LeafNode failed sending errors for collection caused by: {send_err}"
                                    );
                                    break;
                                }
                                continue;
                            }
                        }
                    }

                    if let Err(send_err) =
                        result_sender.send((idx, destination_stream, record)).await
                    {
                        log::error!(
                            "[Pipeline] {pipeline_name} : LeafNode errors sending result for collection caused by: {send_err}"
                        );
                        break;
                    }
                    count += 1;
                }
                log::debug!("[Pipeline]: LeafNode {node_idx} done processing {count} records");
            } else {
                log::debug!("[Pipeline]: source node {node_idx} starts processing");
                // source stream node: send received record to all its children
                while let Some(item) = receiver.recv().await {
                    send_to_children(&mut child_senders, item, "StreamNode").await;
                    count += 1;
                }
                log::debug!(
                    "[Pipeline] {pipeline_name} : source node {node_idx} done processing {count} records"
                );
            }
        }
        NodeData::Condition(condition_params) => {
            log::debug!("[Pipeline]: cond node {node_idx} starts processing");
            while let Some(pipeline_item) = receiver.recv().await {
                let PipelineItem {
                    idx,
                    mut record,
                    mut flattened,
                } = pipeline_item;
                // value must be flattened before condition params can take effect
                if !flattened && !record.is_null() && record.is_object() {
                    record = match flatten::flatten_with_level(
                        record,
                        cfg.limit.ingest_flatten_level,
                    ) {
                        Ok(flattened) => flattened,
                        Err(e) => {
                            let err_msg = format!("ConditionNode error with flattening: {e}");
                            if let Err(send_err) = error_sender
                                .send((node.id.to_string(), node.node_type(), err_msg, None))
                                .await
                            {
                                log::error!(
                                    "[Pipeline] {pipeline_name} : ConditionNode failed sending errors for collection caused by: {send_err}"
                                );
                                break;
                            }
                            continue;
                        }
                    };
                    flattened = true;
                }

                // Evaluate based on condition version
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

                // only send to children when passing all condition evaluations
                if passes {
                    send_to_children(
                        &mut child_senders,
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
            log::debug!("[Pipeline]: cond node {node_idx} done processing {count} records");
        }
        NodeData::Function(func_params) => {
            log::debug!("[Pipeline]: func node {node_idx} starts processing");
            let mut vrl_runtime_state = crate::service::ingestion::init_functions_runtime();
            let stream_name = stream_name.unwrap_or("pipeline".to_string());
            let mut result_array_records = Vec::new();
            while let Some(pipeline_item) = receiver.recv().await {
                let PipelineItem {
                    idx,
                    mut record,
                    mut flattened,
                } = pipeline_item;
                if let Some(runtime) = &function_runtime {
                    // Handle flattening if required
                    if func_params.after_flatten
                        && !flattened
                        && !record.is_null()
                        && record.is_object()
                    {
                        record = match flatten::flatten_with_level(
                            record,
                            cfg.limit.ingest_flatten_level,
                        ) {
                            Ok(flattened) => flattened,
                            Err(e) => {
                                let err_msg = format!("FunctionNode error with flattening: {e}");
                                let err_msg = err_msg.get(0..500).unwrap_or(&err_msg);
                                if let Err(send_err) = error_sender
                                    .send((
                                        node.id.to_string(),
                                        node.node_type(),
                                        err_msg.to_owned(),
                                        Some(func_params.name.to_owned()),
                                    ))
                                    .await
                                {
                                    log::error!(
                                        "[Pipeline] {pipeline_name} : FunctionNode failed sending errors for collection caused by: {send_err}"
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
                                record = match apply_vrl_fn(
                                    &mut vrl_runtime_state,
                                    vrl_resolver,
                                    record,
                                    &org_id,
                                    std::slice::from_ref(&stream_name),
                                ) {
                                    (res, None) => res,
                                    (res, Some(error)) => {
                                        let err_msg = format!(
                                            "FunctionNode VRL error: {}",
                                            error.get(0..500).unwrap_or(&error)
                                        );
                                        if let Err(send_err) = error_sender
                                            .send((
                                                node.id.to_string(),
                                                node.node_type(),
                                                err_msg.to_owned(),
                                                Some(func_params.name.to_owned()),
                                            ))
                                            .await
                                        {
                                            log::error!(
                                                "[Pipeline] {pipeline_name} : FunctionNode failed sending errors for collection caused by: {send_err}"
                                            );
                                            break;
                                        }
                                        res
                                    }
                                };
                                flattened = false; // since apply_vrl_fn can produce unflattened data
                                send_to_children(
                                    &mut child_senders,
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
                                record = match apply_js_fn(
                                    js_config,
                                    record,
                                    &org_id,
                                    std::slice::from_ref(&stream_name),
                                ) {
                                    (res, None) => res,
                                    (res, Some(error)) => {
                                        let err_msg = format!(
                                            "FunctionNode JS error: {}",
                                            error.get(0..500).unwrap_or(&error)
                                        );
                                        if let Err(send_err) = error_sender
                                            .send((
                                                node.id.to_string(),
                                                node.node_type(),
                                                err_msg.to_owned(),
                                                Some(func_params.name.to_owned()),
                                            ))
                                            .await
                                        {
                                            log::error!(
                                                "[Pipeline] {pipeline_name} : FunctionNode failed sending errors for collection caused by: {send_err}"
                                            );
                                            break;
                                        }
                                        res
                                    }
                                };
                                flattened = false; // since JS functions can produce unflattened data
                                send_to_children(
                                    &mut child_senders,
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

            // Process result array records if any were collected
            if !result_array_records.is_empty()
                && let Some(runtime) = &function_runtime
            {
                match runtime {
                    CompiledFunctionRuntime::VRL(vrl_resolver, true) => {
                        // VRL result array processing
                        let result = match apply_vrl_fn(
                            &mut vrl_runtime_state,
                            vrl_resolver,
                            json::Value::Array(result_array_records),
                            &org_id,
                            std::slice::from_ref(&stream_name),
                        ) {
                            (res, None) => res,
                            (res, Some(error)) => {
                                let err_msg = format!(
                                    "FunctionNode VRL result array error: {}",
                                    error.get(0..500).unwrap_or(&error)
                                );
                                if let Err(send_err) = error_sender
                                    .send((
                                        node.id.to_string(),
                                        node.node_type(),
                                        err_msg.to_owned(),
                                        Some(func_params.name.to_owned()),
                                    ))
                                    .await
                                {
                                    log::error!(
                                        "[Pipeline] {pipeline_name} : FunctionNode failed sending errors for collection caused by: {send_err}"
                                    );
                                    return Ok(());
                                }
                                res
                            }
                        };
                        // since apply_vrl_fn can produce unflattened data
                        for record in result.as_array().unwrap().iter() {
                            // use usize::MAX as a flag to disregard original_value
                            send_to_children(
                                &mut child_senders,
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
                        let result = match apply_js_fn(
                            js_config,
                            json::Value::Array(result_array_records),
                            &org_id,
                            std::slice::from_ref(&stream_name),
                        ) {
                            (res, None) => res,
                            (res, Some(error)) => {
                                let err_msg = format!(
                                    "FunctionNode JS result array error: {}",
                                    error.get(0..500).unwrap_or(&error)
                                );
                                if let Err(send_err) = error_sender
                                    .send((
                                        node.id.to_string(),
                                        node.node_type(),
                                        err_msg.to_owned(),
                                        Some(func_params.name.to_owned()),
                                    ))
                                    .await
                                {
                                    log::error!(
                                        "[Pipeline] {pipeline_name} : FunctionNode failed sending errors for collection caused by: {send_err}"
                                    );
                                    return Ok(());
                                }
                                res
                            }
                        };
                        // Process result array
                        if let Some(result_arr) = result.as_array() {
                            for record in result_arr.iter() {
                                // use usize::MAX as a flag to disregard original_value
                                send_to_children(
                                    &mut child_senders,
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
                            "[Pipeline] {pipeline_name} : Function node has result_array_records but runtime is not in result array mode"
                        );
                    }
                }
            }
            log::debug!("[Pipeline]: func node {node_idx} done processing {count} records");
        }
        NodeData::Query(_) => {
            // source node for Scheduled pipeline. Directly send to children nodes
            log::debug!("[Pipeline]: query node {node_idx} starts processing");
            while let Some(item) = receiver.recv().await {
                send_to_children(&mut child_senders, item, "QueryNode").await;
                count += 1;
            }
            log::debug!("[Pipeline]: query node {node_idx} done processing {count} records");
        }
        #[cfg(feature = "enterprise")]
        NodeData::RemoteStream(remote_stream) => {
            let mut records = vec![];
            log::debug!(
                "[Pipeline]: Destination node {node_idx} starts processing, remote_stream : {remote_stream:?}"
            );
            let now = config::utils::time::now_micros();
            let min_ts = now - cfg.limit.ingest_allowed_upto_micro;
            let max_ts = now + cfg.limit.ingest_allowed_in_future_micro;
            while let Some(pipeline_item) = receiver.recv().await {
                let PipelineItem {
                    mut record,
                    flattened,
                    ..
                } = pipeline_item;
                // handle timestamp before sending to remote_write service
                if !flattened && !record.is_null() && record.is_object() {
                    record = match flatten::flatten_with_level(
                        record,
                        cfg.limit.ingest_flatten_level,
                    ) {
                        Ok(flattened) => flattened,
                        Err(e) => {
                            let err_msg = format!("DestinationNode error with flattening: {e}");
                            if let Err(send_err) = error_sender
                                .send((node.id.to_string(), node.node_type(), err_msg, None))
                                .await
                            {
                                log::error!(
                                    "[Pipeline] {pipeline_name} : DestinationNode failed sending errors for collection caused by: {send_err}"
                                );
                                break;
                            }
                            continue;
                        }
                    };
                }
                if !record.is_null() && record.is_object() {
                    if let Err(e) =
                        crate::service::logs::ingest::handle_timestamp(&mut record, min_ts, max_ts)
                    {
                        let err_msg = format!("DestinationNode error handling timestamp: {e}");
                        if let Err(send_err) = error_sender
                            .send((node.id.to_string(), node.node_type(), err_msg, None))
                            .await
                        {
                            log::error!(
                                "[Pipeline] {} : DestinationNode failed sending errors for collection caused by: {send_err}",
                                pipeline_name
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
                "[Pipeline]: RemoteStream node processed {} records",
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
                    "[Pipeline]: Grouped records into {} batch keys",
                    records_by_batch_key.len()
                );

                // Process each batch_key group separately
                for (batch_key, batch_records) in records_by_batch_key {
                    // Create buffer key that includes batch_key for routing
                    let buffer_key = format!(
                        "{}:{}:{}:{}:{}",
                        pipeline_id,
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
                        "[Pipeline]: Added {} records to buffer for batch_key '{batch_key}', total: {} records, {} bytes",
                        buffer.records.len() - initial_record_count,
                        buffer.records.len(),
                        buffer.total_bytes
                    );

                    // Check if buffer should be flushed to WAL
                    if buffer.should_flush() {
                        let records_to_write = buffer.take_records();
                        drop(buffers); // Release the lock before async operations

                        log::debug!(
                            "[Pipeline]: Flushing buffer for batch_key '{}' - writing {} records to WAL",
                            batch_key,
                            records_to_write.len()
                        );

                        // Create remote stream configuration with batch_key routing
                        let mut remote_stream_for_batch = remote_stream.clone();
                        remote_stream_for_batch.org_id = org_id.clone().into();

                        let records_len = records_to_write.len() as i64;

                        let writer =
                            get_pipeline_wal_writer(&pipeline_id, remote_stream_for_batch).await?;
                        match writer.write_wal(records_to_write).await {
                            Err(e) => {
                                let err_msg = format!(
                                    "DestinationNode error persisting data for batch_key '{batch_key}' to be ingested externally: {e}"
                                );
                                if let Err(send_err) = error_sender
                                    .send((node.id.to_string(), node.node_type(), err_msg, None))
                                    .await
                                {
                                    log::error!(
                                        "[Pipeline]: DestinationNode failed sending errors for collection caused by: {send_err}"
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

                                    crate::service::self_reporting::report_request_usage_stats(
                                        req_stats,
                                        &org_id,
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
                            "[Pipeline]: Buffer for batch_key '{batch_key}' not ready for flush, continuing to accumulate"
                        );
                    }
                }
            }

            log::debug!("[Pipeline]: DestinationNode {node_idx} done processing {count} records");
        }
        #[cfg(not(feature = "enterprise"))]
        NodeData::RemoteStream(_) => {
            let err_msg = "[Pipeline]: remote destination is not supported in open source version. Records dropped".to_string();
            log::error!("{err_msg}");
            if let Err(send_err) = error_sender
                .send((node.id.to_string(), node.node_type(), err_msg, None))
                .await
            {
                log::error!(
                    "[Pipeline({pipeline_id})]: DestinationNode failed sending errors for collection caused by: {send_err}"
                );
            }
        }
    }

    // all cloned senders dropped when function goes out of scope -> close the channel

    Ok(())
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

                        crate::service::self_reporting::report_request_usage_stats(
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
    crate::service::db::functions::get(org_id, fn_name).await
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
        use crate::common::utils::js::JSRuntimeConfig;

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
        use crate::service::ingestion::compile_vrl_function;

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
        use crate::{common::utils::js::JSRuntimeConfig, service::ingestion::compile_vrl_function};

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
        use crate::common::utils::js::JSRuntimeConfig;

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
        use crate::service::ingestion::compile_js_function;

        // Test invalid JS function
        let invalid_js = "this is not valid javascript {{{";
        let result = compile_js_function(invalid_js, "test_org");

        // Should return an error
        assert!(result.is_err());
    }

    #[test]
    fn test_js_execution_with_simple_record() {
        use crate::service::ingestion::{apply_js_fn, compile_js_function};

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
