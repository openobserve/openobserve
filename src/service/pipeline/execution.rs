// Copyright 2024 OpenObserve Inc.
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

use std::collections::HashMap;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use config::{
    get_config,
    meta::{
        function::{Transform, VRLResultResolver},
        pipeline::{self, components::NodeData, Pipeline, PipelineExecDFS},
        stream::StreamParams,
    },
    utils::{flatten, json::Value},
};
use vector_enrichment::TableRegistry;
use vrl::compiler::runtime::Runtime;

use super::batch_execution::PipelineExecBatch;
use crate::{
    common::infra::config::QUERY_FUNCTIONS,
    service::ingestion::{apply_vrl_fn, compile_vrl_function},
};

#[derive(Clone)]
pub enum PipelineExecutionPlan {
    DFS(PipelineExecDFS),
    Batch(PipelineExecBatch),
}

impl PipelineExecutionPlan {
    pub fn get_all_destination_streams(&self) -> Vec<StreamParams> {
        match self {
            PipelineExecutionPlan::DFS((pl, node_map, graph, _)) => {
                pl.get_all_destination_streams(node_map, graph)
            }
            PipelineExecutionPlan::Batch(pl_exec_batch) => {
                pl_exec_batch.get_all_destination_streams()
            }
        }
    }
}

#[async_trait]
pub trait PipelineExt: Sync + Send + 'static {
    /// Registers the function of all the FunctionNode of this pipeline once for execution.
    /// Returns a map of node_id -> VRLResultResolver for quick lookup
    async fn register_functions(&self) -> Result<HashMap<String, VRLResultResolver>>;

    /// Executes the given input [Value] through this pipeline, under the assumption the pipeline is
    /// valid.
    ///
    /// `node_map` and `graph` to be constructed prior to pipeline execution to avoid repeated work.
    /// Returned hashmap indicates pairs of `DestinationStream: output`
    fn execute(
        &self,
        input: Value,
        node_map: &HashMap<String, NodeData>,
        graph: &HashMap<String, Vec<String>>,
        vrl_map: &HashMap<String, VRLResultResolver>,
        runtime: &mut Runtime,
    ) -> Result<HashMap<StreamParams, Value>>;
}

#[async_trait]
impl PipelineExt for Pipeline {
    async fn register_functions(&self) -> Result<HashMap<String, VRLResultResolver>> {
        let mut vrl_map = HashMap::new();
        for node in &self.nodes {
            if let pipeline::components::NodeData::Function(func_params) = &node.data {
                let transform = get_transforms(&self.org, &func_params.name).await?;
                if let Ok(vrl_runtime_config) = compile_vrl_function(&transform.function, &self.org)
                {
                    let registry = vrl_runtime_config
                        .config
                        .get_custom::<TableRegistry>()
                        .unwrap();
                    registry.finish_load();
                    vrl_map.insert(
                        node.get_node_id(),
                        VRLResultResolver {
                            program: vrl_runtime_config.program,
                            fields: vrl_runtime_config.fields,
                        },
                    );
                }
            }
        }
        Ok(vrl_map)
    }

    fn execute(
        &self,
        input: Value,
        node_map: &HashMap<String, NodeData>,
        graph: &HashMap<String, Vec<String>>,
        vrl_map: &HashMap<String, VRLResultResolver>,
        runtime: &mut Runtime,
    ) -> Result<HashMap<StreamParams, Value>> {
        let mut results = HashMap::new();

        if let Err(e) = dfs(
            &self.org,
            input,
            false,
            &self.nodes[0].id,
            node_map,
            graph,
            vrl_map,
            runtime,
            &mut results,
        ) {
            return Err(anyhow::anyhow!(
                "[Pipeline]: {}/{}/{} execution error: {}. Skip",
                self.org,
                self.name,
                self.id,
                e
            ));
        }

        Ok(results)
    }
}

#[tracing::instrument(skip_all)]
#[allow(clippy::too_many_arguments)]
fn dfs(
    org_id: &str,
    mut current_value: Value,
    mut flattened: bool,
    current_node_id: &str,
    node_map: &HashMap<String, NodeData>,
    graph: &HashMap<String, Vec<String>>,
    vrl_map: &HashMap<String, VRLResultResolver>,
    runtime: &mut Runtime,
    results: &mut HashMap<StreamParams, Value>,
) -> Result<()> {
    if current_value.is_null() || !current_value.is_object() {
        return Ok(());
    }

    let current_node = node_map.get(current_node_id).unwrap();

    match &current_node {
        NodeData::Stream(stream_params) => {
            if !graph.contains_key(current_node_id) {
                // leaf node
                results.insert(stream_params.clone(), current_value);
            } else {
                let next_nodes = graph.get(current_node_id).unwrap();
                process_next_nodes(
                    org_id,
                    current_value,
                    flattened,
                    next_nodes,
                    node_map,
                    graph,
                    vrl_map,
                    runtime,
                    results,
                )?;
            }
        }
        NodeData::Condition(condition_params) => {
            // value must be flattened before condition params can take effect
            if !flattened {
                current_value = flatten::flatten_with_level(
                    current_value,
                    get_config().limit.ingest_flatten_level,
                )
                .map_err(|e| {
                    anyhow!(
                        "ConditionNode {current_node_id} error with flattening: {}",
                        e
                    )
                })?;
                flattened = true;
            }
            for condition in &condition_params.conditions {
                if !condition.evaluate(current_value.as_object().unwrap()) {
                    // Condition not met. Stop this branch
                    return Ok(());
                }
            }
            // current_node_id must be in graph because a ConditionNode can't be a leaf node
            let next_nodes = graph.get(current_node_id).unwrap();
            process_next_nodes(
                org_id,
                current_value,
                flattened,
                next_nodes,
                node_map,
                graph,
                vrl_map,
                runtime,
                results,
            )?;
        }
        NodeData::Function(func_params) => {
            if func_params.after_flatten && !flattened {
                current_value = flatten::flatten_with_level(
                    current_value,
                    get_config().limit.ingest_flatten_level,
                )
                .map_err(|e| {
                    anyhow!(
                        "FunctionNode {current_node_id} error with flattening: {}",
                        e
                    )
                })?;
                flattened = true;
            }
            let vrl_runtime = vrl_map.get(current_node_id).unwrap();
            current_value = apply_vrl_fn(
                runtime,
                vrl_runtime,
                &current_value,
                org_id,
                &["pipeline".to_string()],
            );
            // current_node_id must be in graph because a FunctionNode can't be a leaf node
            let next_nodes = graph.get(current_node_id).unwrap();
            process_next_nodes(
                org_id,
                current_value,
                flattened,
                next_nodes,
                node_map,
                graph,
                vrl_map,
                runtime,
                results,
            )?;
        }
        NodeData::Query(_) => {
            // source node for Scheduled pipeline. Must have next nodes
            let next_nodes = graph.get(current_node_id).unwrap();
            process_next_nodes(
                org_id,
                current_value,
                flattened,
                next_nodes,
                node_map,
                graph,
                vrl_map,
                runtime,
                results,
            )?;
        }
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn process_next_nodes(
    org_id: &str,
    current_value: Value,
    flattened: bool,
    next_nodes: &Vec<String>,
    node_map: &HashMap<String, NodeData>,
    graph: &HashMap<String, Vec<String>>,
    vrl_map: &HashMap<String, VRLResultResolver>,
    runtime: &mut Runtime,
    results: &mut HashMap<StreamParams, Value>,
) -> Result<()> {
    if next_nodes.len() == 1 {
        // HACK to avoid cloning the json record
        dfs(
            org_id,
            current_value,
            flattened,
            &next_nodes[0],
            node_map,
            graph,
            vrl_map,
            runtime,
            results,
        )
    } else {
        for next_node in next_nodes {
            dfs(
                org_id,
                current_value.clone(),
                flattened,
                next_node,
                node_map,
                graph,
                vrl_map,
                runtime,
                results,
            )?;
        }
        Ok(())
    }
}

async fn get_transforms(org_id: &str, fn_name: &str) -> Result<Transform> {
    let func_key = format!("{org_id}/{fn_name}");
    if let Some(trans) = QUERY_FUNCTIONS.get(&func_key) {
        return Ok(trans.value().clone());
    }
    // get from database
    crate::service::db::functions::get(org_id, fn_name).await
}
