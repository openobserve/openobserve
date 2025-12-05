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
use components::{DerivedStream, Edge, Node, NodeData, PipelineSource};
use serde::{Deserialize, Serialize};
use sqlx::{Decode, Error, FromRow, Row, Type};
use utoipa::ToSchema;

use crate::{
    meta::{
        function::VRLResultResolver,
        stream::{StreamParams, StreamType},
    },
    utils::json,
};

pub mod components;

// (pipeline, node_map, graph, vrl_map)
pub type PipelineExecDFS = (
    Pipeline,
    HashMap<String, NodeData>,
    HashMap<String, Vec<String>>,
    HashMap<String, VRLResultResolver>,
);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct Pipeline {
    #[serde(rename = "pipeline_id", default)]
    pub id: String,
    #[serde(default)]
    pub version: i32,
    #[serde(default = "default_status")]
    pub enabled: bool,
    #[serde(default)]
    pub org: String, // org this pipeline belongs to. diff from source stream org_id
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub source: PipelineSource,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

impl Pipeline {
    pub fn get_cache_key(&self) -> String {
        match &self.source {
            PipelineSource::Realtime(stream_params) => {
                format!("{}/{}", self.org, stream_params)
            }
            PipelineSource::Scheduled(_) => {
                format!("{}/{}", self.org, self.id)
            }
        }
    }

    pub fn get_derived_stream(&self) -> Option<DerivedStream> {
        match &self.source {
            PipelineSource::Scheduled(derived_stream) => Some(derived_stream.to_owned()),
            _ => None,
        }
    }

    /// Verifies the pipeline is valid by:
    /// 0. non-empty name
    /// 1. non-empty nodes list
    /// 2. non-empty edges list
    /// 3. 1st node in nodes list is either StreamNode or QueryNode
    /// 4. non-empty `conditions` in all ConditionNode nodes in nodes list
    /// 5. every node is reachable
    /// 6. all leaf nodes are of type StreamNode
    /// 7. In the same branch, unchecked `after_flattened` FunctionNode can't follow checked
    ///    `after_flattened` checked FunctionNode
    /// 8. EnrichmentTables can only be used in Scheduled pipelines
    ///
    /// If all satisfies, populates the [Pipeline::source] with the first node in nodes list
    pub fn validate(&mut self) -> Result<()> {
        if self.name.is_empty() {
            return Err(anyhow!("Please provide non-empty name for the pipeline"));
        }

        // ck 1 & 2
        match (self.nodes.is_empty(), self.edges.is_empty()) {
            (true, true) | (true, false) => {
                return Err(anyhow!(
                    "Empty pipeline. Please add Source/Destination nodes, or any applicable Transform Nodes"
                ));
            }
            (false, true) => {
                return Err(anyhow!(
                    "Please connect all Nodes to complete pipeline creation"
                ));
            }
            _ => {}
        };

        // ck 3
        match self.nodes.first().unwrap().get_node_data() {
            NodeData::Stream(stream_params) => {
                self.source = PipelineSource::Realtime(stream_params);
            }
            NodeData::Query(derived_stream) => {
                if derived_stream.trigger_condition.period == 0 {
                    return Err(anyhow!(
                        "DerivedStream source's TriggerCondition period missing or is 0"
                    ));
                }
                self.source = PipelineSource::Scheduled(derived_stream);
            }
            _ => return Err(anyhow!("Source must be either a StreamNode or QueryNode")),
        };

        for node in self.nodes.iter_mut() {
            // ck 4
            if let NodeData::Condition(condition_params) = &node.data {
                let has_empty_conditions = match condition_params {
                    components::ConditionParams::V1 { conditions } => !conditions.has_conditions(),
                    components::ConditionParams::V2 { conditions } => {
                        conditions.conditions.is_empty()
                    }
                };
                if has_empty_conditions {
                    return Err(anyhow!("ConditionNode must have non-empty conditions"));
                }
            }

            if let NodeData::Stream(stream_params) = &mut node.data {
                // ck 8
                if stream_params.stream_type == StreamType::EnrichmentTables
                    && matches!(&self.source, PipelineSource::Realtime(_))
                {
                    return Err(anyhow!(
                        "EnrichmentTables can only be used in Scheduled pipelines"
                    ));
                }
            }
        }

        // ck 5
        if self.edges.len() < self.nodes.len() - 1 {
            return Err(anyhow!(
                "Insufficient number of edges to connect all nodes. Need at least {} for {} nodes, but got {}.",
                self.nodes.len() - 1,
                self.nodes.len(),
                self.edges.len()
            ));
        }

        // build adjacency list for ck 6 & 7
        let source_node_id = self.nodes[0].id.as_str();
        let node_map = self.get_node_map();
        let adjacency_list = self.build_adjacency_list(&node_map)?;
        let mut visited = HashSet::new();
        dfs_traversal_check(
            source_node_id,
            &adjacency_list,
            &node_map,
            false,
            &mut visited,
        )?;

        Ok(())
    }

    /// Converts pipeline's node list to a map for quick lookup
    pub fn get_node_map(&self) -> HashMap<String, NodeData> {
        self.nodes
            .iter()
            .map(|node| (node.get_node_id(), node.get_node_data()))
            .collect()
    }

    /// Builds the graph representation of this pipeline's nodes structure.
    ///
    /// Used for pipeline validation and execution.
    pub fn build_adjacency_list(
        &self,
        node_map: &HashMap<String, NodeData>,
    ) -> Result<HashMap<String, Vec<String>>> {
        let mut adjacency_list = HashMap::new();

        for (idx, edge) in self.edges.iter().enumerate() {
            if !node_map.contains_key(&edge.source) {
                return Err(anyhow!("Edge #{idx}'s source node not found in nodes list"));
            }
            if !node_map.contains_key(&edge.target) {
                return Err(anyhow!("Edge #{idx}'s target node not found in nodes list"));
            }
            adjacency_list
                .entry(edge.source.clone())
                .or_insert_with(Vec::new)
                .push(edge.target.clone());
        }

        Ok(adjacency_list)
    }

    /// Finds all the destination streams in the pipeline.
    pub fn get_all_destination_streams(
        &self,
        node_map: &HashMap<String, NodeData>,
        graph: &HashMap<String, Vec<String>>,
    ) -> Vec<StreamParams> {
        node_map
            .iter()
            .filter_map(|(id, node_data)| {
                if !graph.contains_key(id) {
                    if let NodeData::Stream(stream_params) = node_data {
                        Some(stream_params.clone())
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .collect()
    }

    /// Returns the number of functions nodes in this pipeline.
    ///
    /// Used for usage report.
    pub fn num_of_func(&self) -> usize {
        self.nodes
            .iter()
            .filter(|node| node.is_function_node())
            .count()
    }

    /// Checks if any of the FunctionNode uses the given function identified by name.
    ///
    /// Used for function deletion api
    pub fn contains_function(&self, func_name: &str) -> bool {
        self.nodes.iter().any(|node| {
            if let NodeData::Function(func) = &node.data {
                func.name == func_name
            } else {
                false
            }
        })
    }

    pub fn get_source_stream_params(&self) -> StreamParams {
        match &self.source {
            PipelineSource::Realtime(stream_params) => stream_params.clone(),
            PipelineSource::Scheduled(ds) => {
                let stream_name = match ds
                    .query_condition
                    .sql
                    .as_ref()
                    .map(|sql| super::sql::resolve_stream_names(sql))
                {
                    Some(Ok(stream_names)) if stream_names.len() == 1 => {
                        stream_names.into_iter().next().unwrap()
                    }
                    _ => "DerivedStream".to_string(),
                };
                StreamParams::new(&ds.org_id, stream_name.as_str(), ds.stream_type)
            }
        }
    }

    pub fn contains_remote_destination(&self, destination: &str) -> bool {
        self.nodes.iter().any(|node| {
            if let NodeData::RemoteStream(dest) = &node.data {
                dest.destination_name == destination
            } else {
                false
            }
        })
    }

    pub fn get_metadata_by_stream_params(
        &self,
        other_stream_params: &StreamParams,
    ) -> Option<HashMap<String, String>> {
        self.nodes.iter().find_map(|node| {
            if let NodeData::Stream(this_stream_params) = &node.data {
                if this_stream_params == other_stream_params {
                    node.meta.clone()
                } else {
                    None
                }
            } else {
                None
            }
        })
    }
}

impl<'r, R: Row> FromRow<'r, R> for Pipeline
where
    &'r ::std::primitive::str: ::sqlx::ColumnIndex<R>,
    String: Type<R::Database> + Decode<'r, R::Database>,
    i32: Type<R::Database> + Decode<'r, R::Database>,
    bool: Type<R::Database> + Decode<'r, R::Database>,
{
    fn from_row(row: &'r R) -> Result<Self, Error> {
        let id: String = row.try_get("id")?;
        let version: i32 = row.try_get("version")?;
        let enabled: bool = row.try_get("enabled")?;
        let org: String = row.try_get("org")?;
        let name: String = row.try_get("name")?;
        let description: String = row.try_get("description")?;
        let source_type: String = row.try_get("source_type")?;

        let source = match source_type.as_str() {
            "realtime" => {
                let stream_org: String = row.try_get("stream_org")?;
                let stream_name: String = row.try_get("stream_name")?;
                let stream_type: String = row.try_get("stream_type")?;
                let stream_params = StreamParams::new(
                    &stream_org,
                    &stream_name,
                    StreamType::from(stream_type.as_str()),
                );
                PipelineSource::Realtime(stream_params)
            }
            "scheduled" => {
                let derived_stream_raw: String = row.try_get("derived_stream")?;
                let derived_stream: DerivedStream = json::from_str(&derived_stream_raw)
                    .expect("Deserializing DerivedStream from ROW error");
                PipelineSource::Scheduled(derived_stream)
            }
            _ => return Err(sqlx::Error::ColumnNotFound("Invalid source type".into())),
        };

        let (nodes, edges) = {
            let nodes_raw: String = row.try_get("nodes")?;
            let edges_raw: String = row.try_get("edges")?;
            (
                json::from_str(&nodes_raw).expect("Deserializing Nodes from ROW error"),
                json::from_str(&edges_raw).expect("Deserializing Edges from ROW error"),
            )
        };

        Ok(Pipeline {
            id,
            version,
            enabled,
            org,
            name,
            description,
            source,
            nodes,
            edges,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct PipelineDependencyItem {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct PipelineDependencyResponse {
    pub list: Vec<PipelineDependencyItem>,
}

/// DFS traversal to check:
/// 1. all leaf nodes are of StreamNode
/// 2. No `After Flattened` unchecked FunctionNode follows `After Flatten` checked FunctionNode in
///    the same branch
///
/// `graph` and `node_map` already validated for unwrap
fn dfs_traversal_check(
    current_id: &str,
    graph: &HashMap<String, Vec<String>>,
    node_map: &HashMap<String, NodeData>,
    mut flattened: bool,
    visited: &mut HashSet<String>,
) -> Result<()> {
    if visited.contains(current_id) {
        return Err(anyhow!("Cyclical pipeline detected."));
    }
    visited.insert(current_id.to_string());
    // Check if the current node is a leaf node
    if !graph.contains_key(current_id) {
        // Ensure leaf nodes are Stream nodes
        if let Some(node_data) = node_map.get(current_id) {
            if !matches!(node_data, NodeData::Stream(_) | NodeData::RemoteStream(_)) {
                return Err(anyhow!("All leaf nodes must be StreamNode"));
            }
        } else {
            return Err(anyhow!("Node with id {} not found in node_map", current_id));
        }
        visited.remove(current_id);
        return Ok(());
    }

    for next_node_id in graph.get(current_id).unwrap() {
        if let NodeData::Function(func_params) = &node_map.get(next_node_id).unwrap() {
            if flattened && !func_params.after_flatten {
                return Err(anyhow!(
                    "After Flatten must be checked if a previous FunctionNode already checked it in the same branch."
                ));
            }
            flattened |= func_params.after_flatten;
        };
        dfs_traversal_check(next_node_id, graph, node_map, flattened, visited)?;
    }
    visited.remove(current_id);

    Ok(())
}

pub fn default_status() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::alerts::{QueryCondition, TriggerCondition};

    #[test]
    fn test_pipeline_get_cache_key() {
        let mut pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![],
            edges: vec![],
        };

        let cache_key = pipeline.get_cache_key();
        assert_eq!(cache_key, "test_org/test_org/test_stream/logs");

        // Test scheduled pipeline
        let derived_stream = DerivedStream {
            org_id: "test_org".to_string(),
            stream_type: StreamType::Logs,
            query_condition: QueryCondition::default(),
            trigger_condition: TriggerCondition::default(),
            tz_offset: 0,
            delay: None,
            start_at: None,
        };
        pipeline.source = PipelineSource::Scheduled(derived_stream);
        let cache_key = pipeline.get_cache_key();
        assert_eq!(cache_key, "test_org/test_pipeline");
    }

    #[test]
    fn test_pipeline_get_derived_stream() {
        let mut pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![],
            edges: vec![],
        };

        // Should return None for realtime pipeline
        assert!(pipeline.get_derived_stream().is_none());

        // Should return Some for scheduled pipeline
        let derived_stream = DerivedStream {
            org_id: "test_org".to_string(),
            stream_type: StreamType::Logs,
            query_condition: QueryCondition::default(),
            trigger_condition: TriggerCondition::default(),
            tz_offset: 0,
            delay: None,
            start_at: None,
        };
        pipeline.source = PipelineSource::Scheduled(derived_stream.clone());
        assert_eq!(pipeline.get_derived_stream(), Some(derived_stream));
    }

    #[test]
    fn test_pipeline_validation_empty_name() {
        let mut pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "".to_string(), // Empty name
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![],
            edges: vec![],
        };

        let result = pipeline.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Please provide non-empty name")
        );
    }

    #[test]
    fn test_pipeline_validation_empty_nodes() {
        let mut pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![], // Empty nodes
            edges: vec![],
        };

        let result = pipeline.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Empty pipeline"));
    }

    #[test]
    fn test_pipeline_validation_empty_edges() {
        let mut pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![
                Node::new(
                    "1".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "test_stream",
                        StreamType::Logs,
                    )),
                    100.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "2".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "output_stream",
                        StreamType::Logs,
                    )),
                    300.0,
                    100.0,
                    "output".to_string(),
                ),
            ],
            edges: vec![], // Empty edges
        };

        let result = pipeline.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Please connect all Nodes")
        );
    }

    #[test]
    fn test_pipeline_validation_insufficient_edges() {
        let mut pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![
                Node::new(
                    "1".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "test_stream",
                        StreamType::Logs,
                    )),
                    100.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "2".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "output_stream",
                        StreamType::Logs,
                    )),
                    300.0,
                    100.0,
                    "output".to_string(),
                ),
                Node::new(
                    "3".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "output_stream2",
                        StreamType::Logs,
                    )),
                    500.0,
                    100.0,
                    "output".to_string(),
                ),
            ],
            edges: vec![
                Edge {
                    id: "e1-2".to_string(),
                    source: "1".to_string(),
                    target: "2".to_string(),
                },
                // Missing edge to node 3
            ],
        };

        let result = pipeline.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Insufficient number of edges")
        );
    }

    #[test]
    fn test_pipeline_get_node_map() {
        let pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![
                Node::new(
                    "1".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "test_stream",
                        StreamType::Logs,
                    )),
                    100.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "2".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "output_stream",
                        StreamType::Logs,
                    )),
                    300.0,
                    100.0,
                    "output".to_string(),
                ),
            ],
            edges: vec![],
        };

        let node_map = pipeline.get_node_map();
        assert_eq!(node_map.len(), 2);
        assert!(node_map.contains_key("1"));
        assert!(node_map.contains_key("2"));
    }

    #[test]
    fn test_pipeline_build_adjacency_list() {
        let pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![
                Node::new(
                    "1".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "test_stream",
                        StreamType::Logs,
                    )),
                    100.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "2".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "output_stream",
                        StreamType::Logs,
                    )),
                    300.0,
                    100.0,
                    "output".to_string(),
                ),
            ],
            edges: vec![Edge {
                id: "e1-2".to_string(),
                source: "1".to_string(),
                target: "2".to_string(),
            }],
        };

        let node_map = pipeline.get_node_map();
        let adjacency_list = pipeline.build_adjacency_list(&node_map).unwrap();
        assert_eq!(adjacency_list.len(), 1);
        assert_eq!(adjacency_list.get("1").unwrap(), &vec!["2".to_string()]);
    }

    #[test]
    fn test_pipeline_build_adjacency_list_invalid_source() {
        let pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![Node::new(
                "1".to_string(),
                NodeData::Stream(StreamParams::new(
                    "test_org",
                    "test_stream",
                    StreamType::Logs,
                )),
                100.0,
                100.0,
                "input".to_string(),
            )],
            edges: vec![Edge {
                id: "e1-2".to_string(),
                source: "invalid_source".to_string(), // Invalid source
                target: "1".to_string(),
            }],
        };

        let node_map = pipeline.get_node_map();
        let result = pipeline.build_adjacency_list(&node_map);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("source node not found")
        );
    }

    #[test]
    fn test_pipeline_num_of_func() {
        let pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![
                Node::new(
                    "1".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "test_stream",
                        StreamType::Logs,
                    )),
                    100.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "2".to_string(),
                    NodeData::Function(components::FunctionParams {
                        name: "test_function".to_string(),
                        after_flatten: false,
                        num_args: 0,
                    }),
                    200.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "3".to_string(),
                    NodeData::Function(components::FunctionParams {
                        name: "test_function2".to_string(),
                        after_flatten: true,
                        num_args: 0,
                    }),
                    300.0,
                    100.0,
                    "input".to_string(),
                ),
            ],
            edges: vec![],
        };

        assert_eq!(pipeline.num_of_func(), 2);
    }

    #[test]
    fn test_pipeline_contains_function() {
        let pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![
                Node::new(
                    "1".to_string(),
                    NodeData::Function(components::FunctionParams {
                        name: "test_function".to_string(),
                        after_flatten: false,
                        num_args: 0,
                    }),
                    100.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "2".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "test_stream",
                        StreamType::Logs,
                    )),
                    200.0,
                    100.0,
                    "input".to_string(),
                ),
            ],
            edges: vec![],
        };

        assert!(pipeline.contains_function("test_function"));
        assert!(!pipeline.contains_function("nonexistent_function"));
    }

    #[test]
    fn test_pipeline_get_source_stream_params_realtime() {
        let pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![],
            edges: vec![],
        };

        let stream_params = pipeline.get_source_stream_params();
        assert_eq!(stream_params.org_id, "test_org");
        assert_eq!(stream_params.stream_name, "test_stream");
        assert_eq!(stream_params.stream_type, StreamType::Logs);
    }

    #[test]
    fn test_pipeline_get_source_stream_params_scheduled() {
        let derived_stream = DerivedStream {
            org_id: "test_org".to_string(),
            stream_type: StreamType::Logs,
            query_condition: QueryCondition {
                sql: Some("SELECT * FROM test_stream".to_string()),
                ..Default::default()
            },
            trigger_condition: TriggerCondition::default(),
            tz_offset: 0,
            delay: None,
            start_at: None,
        };

        let pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Scheduled(derived_stream),
            nodes: vec![],
            edges: vec![],
        };

        let stream_params = pipeline.get_source_stream_params();
        assert_eq!(stream_params.org_id, "test_org");
        assert_eq!(stream_params.stream_name, "test_stream");
        assert_eq!(stream_params.stream_type, StreamType::Logs);
    }

    #[test]
    fn test_pipeline_contains_remote_destination() {
        let pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![Node::new(
                "1".to_string(),
                NodeData::RemoteStream(crate::meta::stream::RemoteStreamParams {
                    org_id: "test_org".to_string().into(),
                    destination_name: "test_destination".to_string().into(),
                }),
                100.0,
                100.0,
                "input".to_string(),
            )],
            edges: vec![],
        };

        assert!(pipeline.contains_remote_destination("test_destination"));
        assert!(!pipeline.contains_remote_destination("nonexistent_destination"));
    }

    #[test]
    fn test_pipeline_get_metadata_by_stream_params() {
        let mut node = Node::new(
            "1".to_string(),
            NodeData::Stream(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            100.0,
            100.0,
            "input".to_string(),
        );
        node.meta = Some(HashMap::from([
            ("key1".to_string(), "value1".to_string()),
            ("key2".to_string(), "value2".to_string()),
        ]));

        let pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![node],
            edges: vec![],
        };

        let stream_params = StreamParams::new("test_org", "test_stream", StreamType::Logs);
        let metadata = pipeline.get_metadata_by_stream_params(&stream_params);
        assert!(metadata.is_some());
        let metadata = metadata.unwrap();
        assert_eq!(metadata.get("key1"), Some(&"value1".to_string()));
        assert_eq!(metadata.get("key2"), Some(&"value2".to_string()));

        // Test with non-matching stream params
        let non_matching_params =
            StreamParams::new("test_org", "different_stream", StreamType::Logs);
        let metadata = pipeline.get_metadata_by_stream_params(&non_matching_params);
        assert!(metadata.is_none());
    }

    #[test]
    fn test_pipeline_validation_cyclical_detection() {
        let mut pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![
                Node::new(
                    "1".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "test_stream",
                        StreamType::Logs,
                    )),
                    100.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "2".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "output_stream",
                        StreamType::Logs,
                    )),
                    300.0,
                    100.0,
                    "output".to_string(),
                ),
            ],
            edges: vec![
                Edge {
                    id: "e1-2".to_string(),
                    source: "1".to_string(),
                    target: "2".to_string(),
                },
                Edge {
                    id: "e2-1".to_string(),
                    source: "2".to_string(),
                    target: "1".to_string(), // Creates a cycle
                },
            ],
        };

        let result = pipeline.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Cyclical pipeline detected")
        );
    }

    #[test]
    fn test_pipeline_validation_leaf_nodes_must_be_stream() {
        let mut pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![
                Node::new(
                    "1".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "test_stream",
                        StreamType::Logs,
                    )),
                    100.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "2".to_string(),
                    NodeData::Function(components::FunctionParams {
                        name: "test_function".to_string(),
                        after_flatten: false,
                        num_args: 0,
                    }),
                    300.0,
                    100.0,
                    "input".to_string(),
                ),
            ],
            edges: vec![Edge {
                id: "e1-2".to_string(),
                source: "1".to_string(),
                target: "2".to_string(),
            }],
        };

        let result = pipeline.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("All leaf nodes must be StreamNode")
        );
    }

    #[test]
    fn test_pipeline_validation_after_flatten_rule() {
        let mut pipeline = Pipeline {
            id: "test_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![
                Node::new(
                    "1".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "test_stream",
                        StreamType::Logs,
                    )),
                    100.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "2".to_string(),
                    NodeData::Function(components::FunctionParams {
                        name: "test_function1".to_string(),
                        after_flatten: true, // Checked
                        num_args: 0,
                    }),
                    200.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "3".to_string(),
                    NodeData::Function(components::FunctionParams {
                        name: "test_function2".to_string(),
                        after_flatten: false, // Unchecked after checked
                        num_args: 0,
                    }),
                    300.0,
                    100.0,
                    "input".to_string(),
                ),
                Node::new(
                    "4".to_string(),
                    NodeData::Stream(StreamParams::new(
                        "test_org",
                        "output_stream",
                        StreamType::Logs,
                    )),
                    400.0,
                    100.0,
                    "output".to_string(),
                ),
            ],
            edges: vec![
                Edge {
                    id: "e1-2".to_string(),
                    source: "1".to_string(),
                    target: "2".to_string(),
                },
                Edge {
                    id: "e2-3".to_string(),
                    source: "2".to_string(),
                    target: "3".to_string(),
                },
                Edge {
                    id: "e3-4".to_string(),
                    source: "3".to_string(),
                    target: "4".to_string(),
                },
            ],
        };

        let result = pipeline.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("After Flatten must be checked")
        );
    }
}
