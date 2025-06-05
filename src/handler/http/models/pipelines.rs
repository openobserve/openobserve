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

//! These models define the schemas of HTTP request and response JSON bodies in
//! pipelines API endpoints.

use std::collections::HashMap;

use config::meta::{
    pipeline::components::{
        ConditionParams, DerivedStream, Edge, NodeStyle, PipelineSource, Position,
    },
    stream::{RemoteStreamParams, StreamParams},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// HTTP response body for `ListPipeline` endpoint.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ListPipelinesResponseBody {
    pub list: Vec<Pipeline>,
}

/// Common Pipeline fields used in HTTP request and response bodies.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Pipeline {
    #[serde(rename = "pipeline_id")]
    pub id: String,
    pub version: i32,
    pub enabled: bool,
    pub org: String,
    pub name: String,
    pub description: String,
    pub source: PipelineSource,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub data: NodeData,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<HashMap<String, String>>,
    position: Position,
    io_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    style: Option<NodeStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "node_type")]
#[serde(rename_all = "snake_case")]
pub enum NodeData {
    RemoteStream(RemoteStreamParams),
    Stream(StreamParams),
    Query(DerivedStream),
    Function(FunctionParams),
    Condition(ConditionParams),
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FunctionParams {
    pub name: String,
    pub after_flatten: bool,
    pub num_args: u8,
    pub function: Function,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Function {
    pub function: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub params: String,
    #[serde(default)]
    pub num_args: u8,
}

impl From<config::meta::function::Transform> for Function {
    fn from(value: config::meta::function::Transform) -> Self {
        Self {
            function: value.function,
            name: value.name,
            params: value.params,
            num_args: value.num_args,
        }
    }
}

impl Pipeline {
    pub fn from_meta_pipeline_and_function(
        meta_pipeline: config::meta::pipeline::Pipeline,
        meta_functions: &HashMap<String, config::meta::function::Transform>,
    ) -> Self {
        let nodes = meta_pipeline
            .nodes
            .into_iter()
            .map(|meta_node| {
                let node_data = match meta_node.data {
                    config::meta::pipeline::components::NodeData::Condition(cond) => {
                        NodeData::Condition(cond)
                    }
                    config::meta::pipeline::components::NodeData::RemoteStream(remote) => {
                        NodeData::RemoteStream(remote)
                    }
                    config::meta::pipeline::components::NodeData::Stream(stream) => {
                        NodeData::Stream(stream)
                    }
                    config::meta::pipeline::components::NodeData::Query(query) => {
                        NodeData::Query(query)
                    }
                    config::meta::pipeline::components::NodeData::Function(func) => {
                        let function = meta_functions.get(&func.name).unwrap().clone().into();
                        let func_params = FunctionParams {
                            name: func.name,
                            after_flatten: func.after_flatten,
                            num_args: func.num_args,
                            function,
                        };
                        NodeData::Function(func_params)
                    }
                };
                Node {
                    id: meta_node.id,
                    data: node_data,
                    meta: meta_node.meta,
                    position: meta_node.position,
                    io_type: meta_node.io_type,
                    style: meta_node.style,
                }
            })
            .collect();
        Self {
            id: meta_pipeline.id,
            version: meta_pipeline.version,
            enabled: meta_pipeline.enabled,
            org: meta_pipeline.org,
            name: meta_pipeline.name,
            description: meta_pipeline.description,
            source: meta_pipeline.source,
            nodes,
            edges: meta_pipeline.edges,
        }
    }
}
