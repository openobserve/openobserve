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

use std::collections::{HashMap, HashSet};

use anyhow::{Result, anyhow};
use components::{DerivedStream, Edge, Node, NodeData, PipelineSource};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    meta::{
        function::VRLResultResolver,
        stream::{StreamParams, StreamType},
    },
    stats::MemorySize,
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

/// Distinguishes user-created pipelines from system-managed evaluation pipelines.
///
/// - `User` pipelines are visible in the Pipeline UI and subject to the "one realtime pipeline per
///   stream" constraint.
/// - `Evaluation` pipelines are hidden from the Pipeline UI, managed exclusively by the Online Eval
///   subsystem, and any number can coexist with a user pipeline on the same stream.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub enum PipelineKind {
    #[serde(rename = "user")]
    #[default]
    User,
    #[serde(rename = "evaluation")]
    Evaluation,
}

impl MemorySize for PipelineKind {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<PipelineKind>()
    }
}

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
    #[serde(default)]
    pub kind: PipelineKind,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

impl MemorySize for Pipeline {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<Pipeline>()
            + self.id.mem_size()
            + self.org.mem_size()
            + self.name.mem_size()
            + self.description.mem_size()
            + self.source.mem_size()
            + self.kind.mem_size()
            + self.nodes.mem_size()
            + self.edges.mem_size()
    }
}

/// The author's own label for a node, falling back to its id. Validation errors are
/// shown verbatim in a toast, and a raw uuid is unreadable and unmatchable against
/// the canvas; the backend has no i18n, so an unlabelled node keeps its id.
fn node_display_name<'a>(nodes: &'a [Node], node_id: &'a str) -> &'a str {
    nodes
        .iter()
        .find(|n| n.get_node_id() == node_id)
        .and_then(|n| n.meta.as_ref())
        .and_then(|m| m.get("label"))
        .map(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(node_id)
}

/// A typo'd handle is silently dropped at runtime (process_branch_node just counts it),
/// so an unroutable edge has to be rejected at save time instead.
fn validate_branch_handles(
    node_id: &str,
    branch_params: &components::BranchParams,
    edges: &[Edge],
    nodes: &[Node],
) -> Result<(), anyhow::Error> {
    let name = node_display_name(nodes, node_id);
    let mut declared: HashSet<&str> = HashSet::new();
    for case in &branch_params.cases {
        if !declared.insert(case.handle.as_str()) {
            return Err(anyhow!(
                "BranchNode {name} has duplicate case handle \"{}\"",
                case.handle
            ));
        }
    }
    if let Some(else_handle) = &branch_params.else_handle
        && !declared.insert(else_handle.as_str())
    {
        return Err(anyhow!(
            "BranchNode {name}'s else_handle \"{else_handle}\" collides with a case handle"
        ));
    }

    for edge in edges.iter().filter(|edge| edge.source == node_id) {
        let Some(handle) = &edge.source_handle else {
            return Err(anyhow!(
                "Edge from BranchNode {name} to {} must declare a source_handle",
                node_display_name(nodes, &edge.target)
            ));
        };
        if !declared.contains(handle.as_str()) {
            return Err(anyhow!(
                "Edge from BranchNode {name} to {} uses source_handle \"{handle}\", which the node does not declare",
                node_display_name(nodes, &edge.target)
            ));
        }
    }

    Ok(())
}

// TODO YJDoc2: in a separate PR, use this fn in the pipeline validation below, so we have
// same logic for pipelines and workflows as intended
pub fn validate_nodes_edges(
    nodes: &[Node],
    edges: &[Edge],
    is_draft: bool,
) -> Result<(), anyhow::Error> {
    if !is_draft && (nodes.len() < 2 || edges.is_empty()) {
        return Err(anyhow!(
            "there must be more than 1 node and at least 1 edge"
        ));
    }

    for node in nodes {
        // ck 4
        if let NodeData::Condition(condition_params) = &node.data {
            let has_empty_conditions = match condition_params {
                components::ConditionParams::V1 { conditions } => !conditions.has_conditions(),
                components::ConditionParams::V2 { conditions } => conditions.conditions.is_empty(),
            };
            if has_empty_conditions {
                return Err(anyhow!("ConditionNode must have non-empty conditions"));
            }
        }

        // a case-less Branch exposes no output handle, so it can never route: reject in draft too
        if let NodeData::Branch(branch_params) = &node.data {
            if branch_params.cases.is_empty() {
                return Err(anyhow!("BranchNode must have at least one case"));
            }
            validate_branch_handles(node.get_node_id().as_str(), branch_params, edges, nodes)?;
        }

        // process_destination_node never forwards to children, so anything wired after a
        // destination is accepted and then silently never runs. Reject it in draft too.
        if matches!(&node.data, NodeData::Destination(_)) {
            let id = node.get_node_id();
            if edges.iter().any(|e| e.source == id) {
                return Err(anyhow!(
                    "Step \"{}\" sends to a destination, which ends the path. Remove the connection leaving it.",
                    node_display_name(nodes, id.as_str())
                ));
            }
        }
    }

    if !is_draft && edges.len() < nodes.len().saturating_sub(1) {
        return Err(anyhow!(
            "Insufficient number of edges to connect all nodes. Need at least {} for {} nodes, but got {}.",
            nodes.len().saturating_sub(1),
            nodes.len(),
            edges.len()
        ));
    }

    // build adjacency list for ck 6 & 7
    let source_node_id = nodes[0].id.as_str();
    let node_map: HashMap<_, _> = nodes
        .iter()
        .map(|node| (node.get_node_id(), node.get_node_data()))
        .collect();

    let mut adjacency_list = HashMap::new();

    for (idx, edge) in edges.iter().enumerate() {
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

    let mut visited = HashSet::new();
    dfs_traversal_check(
        source_node_id,
        &adjacency_list,
        &node_map,
        false,
        false,
        &mut visited,
        is_draft,
    )?;

    Ok(())
}

impl Pipeline {
    /// Returns true if this is a user-created pipeline.
    pub fn is_user(&self) -> bool {
        self.kind == PipelineKind::User
    }

    /// Returns true if this is a system-managed evaluation pipeline.
    pub fn is_evaluation(&self) -> bool {
        self.kind == PipelineKind::Evaluation
    }

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
    /// 6. all leaf nodes are destination streams, except system evaluation pipelines may terminate
    ///    at an LLM evaluation task publisher
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

        for node in &self.nodes {
            if !node.data.is_pipeline_node() {
                return Err(anyhow!(
                    "Node {} is not a pipeline compatible node",
                    node.id
                ));
            }
        }

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
            self.is_evaluation(),
            &mut visited,
            false, // pipelines are never drafted
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

impl<'r, R: sqlx::Row> sqlx::FromRow<'r, R> for Pipeline
where
    &'r ::std::primitive::str: ::sqlx::ColumnIndex<R>,
    String: sqlx::Type<R::Database> + sqlx::Decode<'r, R::Database>,
    i32: sqlx::Type<R::Database> + sqlx::Decode<'r, R::Database>,
    bool: sqlx::Type<R::Database> + sqlx::Decode<'r, R::Database>,
{
    fn from_row(row: &'r R) -> Result<Self, sqlx::Error> {
        let id: String = row.try_get("id")?;
        let version: i32 = row.try_get("version")?;
        let enabled: bool = row.try_get("enabled")?;
        let org: String = row.try_get("org")?;
        let name: String = row.try_get("name")?;
        let description: String = row.try_get("description")?;
        let source_type: String = row.try_get("source_type")?;

        // Backward-compat: default to User for rows without a `kind` column
        let kind: PipelineKind = row
            .try_get::<String, _>("kind")
            .ok()
            .and_then(|s| serde_json::from_str(&format!("\"{}\"", s)).ok())
            .unwrap_or_default();

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
            kind,
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
/// 1. all leaf nodes are destination streams, except evaluation pipelines may terminate at an LLM
///    evaluation task publisher
/// 2. No `After Flattened` unchecked FunctionNode follows `After Flatten` checked FunctionNode in
///    the same branch
///
/// `graph` and `node_map` already validated for unwrap
fn dfs_traversal_check(
    current_id: &str,
    graph: &HashMap<String, Vec<String>>,
    node_map: &HashMap<String, NodeData>,
    mut flattened: bool,
    allow_evaluation_leaf: bool,
    visited: &mut HashSet<String>,
    is_draft: bool,
) -> Result<()> {
    if visited.contains(current_id) {
        return Err(anyhow!("Cyclical pipeline detected."));
    }
    visited.insert(current_id.to_string());
    let current_node = node_map
        .get(current_id)
        .ok_or_else(|| anyhow!("Node with id {} not found in node_map", current_id))?;
    if matches!(current_node, NodeData::LlmEvaluation(_)) {
        if !allow_evaluation_leaf {
            return Err(anyhow!(
                "LLM evaluation nodes are restricted to evaluation pipelines"
            ));
        }
        if graph.contains_key(current_id) {
            return Err(anyhow!(
                "LLM evaluation nodes must terminate evaluation pipelines"
            ));
        }
    }
    // Check if the current node is a leaf node
    if !graph.contains_key(current_id) {
        // Evaluation pipelines publish durable tasks instead of forwarding to a stream.
        let valid_leaf = current_node.is_a_leaf_node()
            || (allow_evaluation_leaf && matches!(current_node, NodeData::LlmEvaluation(_)));
        if !valid_leaf && !is_draft {
            return Err(anyhow!(
                "All terminal nodes must be stream nodes or destination nodes"
            ));
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
        dfs_traversal_check(
            next_node_id,
            graph,
            node_map,
            flattened,
            allow_evaluation_leaf,
            visited,
            is_draft,
        )?;
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
            kind: PipelineKind::User,
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
            kind: PipelineKind::User,
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
            kind: PipelineKind::User,
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
            kind: PipelineKind::User,
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
            kind: PipelineKind::User,
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
            kind: PipelineKind::User,
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
                    source_handle: None,
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
            kind: PipelineKind::User,
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
            kind: PipelineKind::User,
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
                source_handle: None,
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
            kind: PipelineKind::User,
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
                source_handle: None,
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
            kind: PipelineKind::User,
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
                        raw_fn: None,
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
                        raw_fn: None,
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
            kind: PipelineKind::User,
            nodes: vec![
                Node::new(
                    "1".to_string(),
                    NodeData::Function(components::FunctionParams {
                        name: "test_function".to_string(),
                        after_flatten: false,
                        num_args: 0,
                        raw_fn: None,
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
            kind: PipelineKind::User,
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
            kind: PipelineKind::User,
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
            kind: PipelineKind::User,
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
            kind: PipelineKind::User,
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
            kind: PipelineKind::User,
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
                    source_handle: None,
                },
                Edge {
                    id: "e2-1".to_string(),
                    source: "2".to_string(),
                    target: "1".to_string(), // Creates a cycle
                    source_handle: None,
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
            kind: PipelineKind::User,
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
                        raw_fn: None,
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
                source_handle: None,
            }],
        };

        let result = pipeline.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("All terminal nodes must be stream nodes or destination nodes")
        );
    }

    #[test]
    fn test_evaluation_pipeline_may_end_at_llm_evaluation_publisher() {
        let source = Node::new(
            "source".to_string(),
            NodeData::Stream(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Traces,
            )),
            100.0,
            100.0,
            "input".to_string(),
        );
        let evaluator = Node::new(
            "evaluator".to_string(),
            NodeData::LlmEvaluation(components::LlmEvaluationParams {
                name: "eval-job".to_string(),
                sampling_rate: 1.0,
                ..Default::default()
            }),
            200.0,
            100.0,
            "default".to_string(),
        );
        let edge = Edge::new(source.get_node_id(), evaluator.get_node_id());
        let mut pipeline = Pipeline {
            id: "evaluation-pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "evaluation-pipeline".to_string(),
            description: String::new(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Traces,
            )),
            kind: PipelineKind::Evaluation,
            nodes: vec![source, evaluator],
            edges: vec![edge],
        };

        assert!(pipeline.validate().is_ok());

        pipeline.kind = PipelineKind::User;
        assert!(
            pipeline
                .validate()
                .unwrap_err()
                .to_string()
                .contains("LLM evaluation nodes are restricted to evaluation pipelines")
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
            kind: PipelineKind::User,
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
                        raw_fn: None,
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
                        raw_fn: None,
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
                    source_handle: None,
                },
                Edge {
                    id: "e2-3".to_string(),
                    source: "2".to_string(),
                    target: "3".to_string(),
                    source_handle: None,
                },
                Edge {
                    id: "e3-4".to_string(),
                    source: "3".to_string(),
                    target: "4".to_string(),
                    source_handle: None,
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

    #[test]
    fn test_default_status_is_true() {
        assert!(default_status());
    }

    #[test]
    fn test_pipeline_get_all_destination_streams() {
        let pipeline = Pipeline {
            id: "p".to_string(),
            version: 1,
            enabled: true,
            org: "org".to_string(),
            name: "p".to_string(),
            description: String::new(),
            source: PipelineSource::Realtime(StreamParams::new("org", "src", StreamType::Logs)),
            kind: PipelineKind::User,
            nodes: vec![],
            edges: vec![],
        };

        let mut node_map = HashMap::new();
        node_map.insert(
            "1".to_string(),
            NodeData::Stream(StreamParams::new("org", "source_stream", StreamType::Logs)),
        );
        node_map.insert(
            "2".to_string(),
            NodeData::Function(components::FunctionParams {
                name: "fn1".to_string(),
                after_flatten: false,
                num_args: 0,
                raw_fn: None,
            }),
        );
        node_map.insert(
            "3".to_string(),
            NodeData::Stream(StreamParams::new("org", "dest_stream", StreamType::Logs)),
        );

        // Graph: 1→2→3; node "3" is leaf (not in graph as source) = destination
        let mut graph = HashMap::new();
        graph.insert("1".to_string(), vec!["2".to_string()]);
        graph.insert("2".to_string(), vec!["3".to_string()]);

        let destinations = pipeline.get_all_destination_streams(&node_map, &graph);
        assert_eq!(destinations.len(), 1);
        assert_eq!(destinations[0].stream_name, "dest_stream");
    }

    #[test]
    fn test_pipeline_get_all_destination_streams_empty_when_all_have_outgoing() {
        let pipeline = Pipeline {
            id: "p".to_string(),
            version: 1,
            enabled: true,
            org: "org".to_string(),
            name: "p".to_string(),
            description: String::new(),
            source: PipelineSource::Realtime(StreamParams::new("org", "src", StreamType::Logs)),
            kind: PipelineKind::User,
            nodes: vec![],
            edges: vec![],
        };

        let mut node_map = HashMap::new();
        node_map.insert(
            "1".to_string(),
            NodeData::Stream(StreamParams::new("org", "a", StreamType::Logs)),
        );
        // Both nodes have outgoing edges → no leaf streams
        let mut graph = HashMap::new();
        graph.insert("1".to_string(), vec!["other".to_string()]);

        let destinations = pipeline.get_all_destination_streams(&node_map, &graph);
        assert!(destinations.is_empty());
    }

    // --- validate_nodes_edges / is_draft behavior ---

    fn trigger_node(id: &str) -> Node {
        Node::new(
            id.to_string(),
            NodeData::WorkflowTrigger,
            0.0,
            0.0,
            "input".to_string(),
        )
    }

    fn function_node(id: &str) -> Node {
        Node::new(
            id.to_string(),
            NodeData::Function(components::FunctionParams {
                name: "fn1".to_string(),
                after_flatten: false,
                num_args: 0,
                raw_fn: None,
            }),
            0.0,
            0.0,
            "default".to_string(),
        )
    }

    fn destination_node(id: &str) -> Node {
        Node::new(
            id.to_string(),
            NodeData::Destination(components::WorkflowDestination {
                destination_id: "dest-1".to_string(),
                template_override: None,
            }),
            0.0,
            0.0,
            "output".to_string(),
        )
    }

    #[test]
    fn test_validate_nodes_edges_draft_allows_no_edges_strict_rejects() {
        let nodes = vec![trigger_node("t1"), destination_node("d1")];

        // strict: no edges at all between two nodes is rejected
        let err = validate_nodes_edges(&nodes, &[], false).unwrap_err();
        assert!(
            err.to_string()
                .contains("more than 1 node and at least 1 edge")
        );

        // draft: same graph, no edges, is tolerated
        assert!(validate_nodes_edges(&nodes, &[], true).is_ok());
    }

    // The executor never forwards past a destination, so a chained one is accepted,
    // published, and then silently never runs. Reject it instead of shipping a no-op.
    #[test]
    fn test_validate_nodes_edges_rejects_destination_with_outgoing_edge() {
        let nodes = vec![
            trigger_node("t1"),
            destination_node("d1"),
            destination_node("d2"),
        ];
        let edges = vec![
            Edge::new("t1".to_string(), "d1".to_string()),
            Edge::new("d1".to_string(), "d2".to_string()),
        ];

        let err = validate_nodes_edges(&nodes, &edges, false).unwrap_err();
        assert!(
            err.to_string().contains("d1"),
            "the error must name the offending step, got: {err}"
        );

        // Rejected in draft too: the canvas exposes no source handle on a destination,
        // so only an API/import caller can build this — never a mid-edit draft.
        assert!(validate_nodes_edges(&nodes, &edges, true).is_err());

        // A destination that actually terminates stays valid, draft or not.
        let ok_nodes = vec![trigger_node("t1"), destination_node("d1")];
        let ok_edges = vec![Edge::new("t1".to_string(), "d1".to_string())];
        assert!(validate_nodes_edges(&ok_nodes, &ok_edges, false).is_ok());
        assert!(validate_nodes_edges(&ok_nodes, &ok_edges, true).is_ok());
    }

    #[test]
    fn test_validate_nodes_edges_draft_allows_insufficient_edge_count() {
        // 3 nodes but only 1 edge (need 2 to connect all of them)
        let nodes = vec![
            trigger_node("t1"),
            function_node("f1"),
            destination_node("d1"),
        ];
        let edges = vec![Edge::new("t1".to_string(), "f1".to_string())];

        let err = validate_nodes_edges(&nodes, &edges, false).unwrap_err();
        assert!(err.to_string().contains("Insufficient number of edges"));

        assert!(validate_nodes_edges(&nodes, &edges, true).is_ok());
    }

    #[test]
    fn test_validate_nodes_edges_draft_allows_non_terminal_leaf() {
        // Trigger -> Function, where Function dead-ends (not Stream/Destination)
        let nodes = vec![trigger_node("t1"), function_node("f1")];
        let edges = vec![Edge::new("t1".to_string(), "f1".to_string())];

        let err = validate_nodes_edges(&nodes, &edges, false).unwrap_err();
        assert!(
            err.to_string()
                .contains("All terminal nodes must be stream nodes or destination nodes")
        );

        assert!(validate_nodes_edges(&nodes, &edges, true).is_ok());
    }

    #[test]
    fn test_validate_nodes_edges_draft_still_rejects_cycles() {
        // t1 -> f1 -> t1 : cyclical, must be rejected even in draft mode
        let nodes = vec![trigger_node("t1"), function_node("f1")];
        let edges = vec![
            Edge::new("t1".to_string(), "f1".to_string()),
            Edge::new("f1".to_string(), "t1".to_string()),
        ];

        for is_draft in [false, true] {
            let err = validate_nodes_edges(&nodes, &edges, is_draft).unwrap_err();
            assert!(
                err.to_string().contains("Cyclical pipeline detected"),
                "is_draft={is_draft}: expected cycle error, got {err}"
            );
        }
    }

    #[test]
    fn test_validate_nodes_edges_draft_still_rejects_single_node_graph() {
        // Documents current behavior: a lone Trigger node is rejected by the
        // `nodes.len() < 2` floor even with is_draft=true, since that check is not
        // gated on is_draft (only the edges-related checks below it are). This means
        // testing a graph that's just a freshly-dropped Trigger node - the first
        // partial-graph scenario - still fails validation today.
        let nodes = vec![trigger_node("t1")];

        let res = validate_nodes_edges(&nodes, &[], true);
        assert!(res.is_ok());

        let res = validate_nodes_edges(&nodes, &[], false);
        assert!(res.is_err_and(|v| {
            v.to_string()
                .contains("more than 1 node and at least 1 edge")
        }));
    }

    fn branch_node(id: &str, cases: Vec<components::BranchCase>) -> Node {
        Node::new(
            id.to_string(),
            NodeData::Branch(components::BranchParams {
                cases,
                else_handle: None,
            }),
            0.0,
            0.0,
            "default".to_string(),
        )
    }

    fn branch_case(handle: &str, column: &str) -> components::BranchCase {
        components::BranchCase {
            handle: handle.to_string(),
            label: None,
            conditions: components::ConditionParams::V1 {
                conditions: crate::meta::alerts::ConditionList::EndCondition(
                    crate::meta::alerts::Condition {
                        column: column.to_string(),
                        operator: crate::meta::alerts::Operator::EqualTo,
                        value: serde_json::json!("x"),
                        ignore_case: false,
                    },
                ),
            },
        }
    }

    #[test]
    fn test_validate_nodes_edges_rejects_branch_with_zero_cases() {
        let nodes = vec![
            trigger_node("t1"),
            branch_node("b1", vec![]),
            destination_node("d1"),
        ];
        let edges = vec![
            Edge::new("t1".to_string(), "b1".to_string()),
            Edge::new_with_handle("b1".to_string(), "d1".to_string(), "case_0".to_string()),
        ];

        // a case-less Branch has no output handle, so it can never route: reject in draft too
        for is_draft in [false, true] {
            let err = validate_nodes_edges(&nodes, &edges, is_draft).unwrap_err();
            assert!(
                err.to_string().contains("BranchNode must have"),
                "is_draft={is_draft}: expected zero-cases error, got {err}"
            );
        }
    }

    #[test]
    fn test_validate_nodes_edges_accepts_branch_with_cases() {
        let nodes = vec![
            trigger_node("t1"),
            branch_node("b1", vec![branch_case("case_0", "severity")]),
            destination_node("d1"),
        ];
        let edges = vec![
            Edge::new("t1".to_string(), "b1".to_string()),
            Edge::new_with_handle("b1".to_string(), "d1".to_string(), "case_0".to_string()),
        ];

        assert!(validate_nodes_edges(&nodes, &edges, false).is_ok());
    }

    fn branch_node_with_else(
        id: &str,
        cases: Vec<components::BranchCase>,
        else_handle: Option<&str>,
    ) -> Node {
        Node::new(
            id.to_string(),
            NodeData::Branch(components::BranchParams {
                cases,
                else_handle: else_handle.map(str::to_string),
            }),
            0.0,
            0.0,
            "default".to_string(),
        )
    }

    #[test]
    fn test_validate_nodes_edges_rejects_branch_edge_with_unknown_handle() {
        let nodes = vec![
            trigger_node("t1"),
            branch_node("b1", vec![branch_case("case_0", "severity")]),
            destination_node("d1"),
        ];
        let edges = vec![
            Edge::new("t1".to_string(), "b1".to_string()),
            Edge::new_with_handle("b1".to_string(), "d1".to_string(), "case_typo".to_string()),
        ];

        for is_draft in [false, true] {
            let err = validate_nodes_edges(&nodes, &edges, is_draft).unwrap_err();
            assert!(
                err.to_string().contains("case_typo"),
                "is_draft={is_draft}: expected unknown-handle error, got {err}"
            );
        }
    }

    #[test]
    fn test_validate_nodes_edges_rejects_branch_edge_without_source_handle() {
        let nodes = vec![
            trigger_node("t1"),
            branch_node("b1", vec![branch_case("case_0", "severity")]),
            destination_node("d1"),
        ];
        let edges = vec![
            Edge::new("t1".to_string(), "b1".to_string()),
            Edge::new("b1".to_string(), "d1".to_string()),
        ];

        for is_draft in [false, true] {
            let err = validate_nodes_edges(&nodes, &edges, is_draft).unwrap_err();
            assert!(
                err.to_string().contains("source_handle"),
                "is_draft={is_draft}: expected missing-handle error, got {err}"
            );
        }
    }

    // Validation errors surface verbatim in a toast, so a raw uuid ("Edge from
    // BranchNode 01ba56cc-aa28-…") is unreadable and unmatchable against the
    // canvas. The node's own label travels in `meta`, so the backend can name it.
    #[test]
    fn branch_errors_name_nodes_by_their_label_when_set() {
        let mut branch = branch_node("b1", vec![branch_case("case_0", "severity")]);
        branch.meta = Some(HashMap::from([(
            "label".to_string(),
            "Severity split".to_string(),
        )]));
        let mut dest = destination_node("d1");
        dest.meta = Some(HashMap::from([(
            "label".to_string(),
            "Page on-call".to_string(),
        )]));
        let nodes = vec![trigger_node("t1"), branch, dest];
        let edges = vec![
            Edge::new("t1".to_string(), "b1".to_string()),
            Edge::new("b1".to_string(), "d1".to_string()),
        ];

        let err = validate_nodes_edges(&nodes, &edges, false)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("Severity split"),
            "expected source label, got {err}"
        );
        assert!(
            err.contains("Page on-call"),
            "expected target label, got {err}"
        );
        assert!(!err.contains("b1"), "raw id leaked into {err}");
    }

    // Unlabelled is the common case (the author never renamed the node), and the
    // backend has no i18n — so it falls back to the id rather than inventing a name.
    #[test]
    fn branch_errors_fall_back_to_the_id_when_a_node_has_no_label() {
        let nodes = vec![
            trigger_node("t1"),
            branch_node("b1", vec![branch_case("case_0", "severity")]),
            destination_node("d1"),
        ];
        let edges = vec![
            Edge::new("t1".to_string(), "b1".to_string()),
            Edge::new("b1".to_string(), "d1".to_string()),
        ];

        let err = validate_nodes_edges(&nodes, &edges, false)
            .unwrap_err()
            .to_string();
        assert!(err.contains("b1"), "expected id fallback, got {err}");
    }

    #[test]
    fn test_validate_nodes_edges_rejects_branch_with_duplicate_case_handles() {
        let nodes = vec![
            trigger_node("t1"),
            branch_node(
                "b1",
                vec![
                    branch_case("case_0", "severity"),
                    branch_case("case_0", "level"),
                ],
            ),
            destination_node("d1"),
        ];
        let edges = vec![
            Edge::new("t1".to_string(), "b1".to_string()),
            Edge::new_with_handle("b1".to_string(), "d1".to_string(), "case_0".to_string()),
        ];

        for is_draft in [false, true] {
            let err = validate_nodes_edges(&nodes, &edges, is_draft).unwrap_err();
            assert!(
                err.to_string().contains("duplicate"),
                "is_draft={is_draft}: expected duplicate-handle error, got {err}"
            );
        }
    }

    #[test]
    fn test_validate_nodes_edges_rejects_else_handle_colliding_with_case_handle() {
        let nodes = vec![
            trigger_node("t1"),
            branch_node_with_else(
                "b1",
                vec![branch_case("case_0", "severity")],
                Some("case_0"),
            ),
            destination_node("d1"),
        ];
        let edges = vec![
            Edge::new("t1".to_string(), "b1".to_string()),
            Edge::new_with_handle("b1".to_string(), "d1".to_string(), "case_0".to_string()),
        ];

        for is_draft in [false, true] {
            let err = validate_nodes_edges(&nodes, &edges, is_draft).unwrap_err();
            assert!(
                err.to_string().contains("else_handle"),
                "is_draft={is_draft}: expected else-collision error, got {err}"
            );
        }
    }

    #[test]
    fn test_validate_nodes_edges_accepts_branch_edge_on_else_handle() {
        let nodes = vec![
            trigger_node("t1"),
            branch_node_with_else("b1", vec![branch_case("case_0", "severity")], Some("else")),
            destination_node("d1"),
        ];
        let edges = vec![
            Edge::new("t1".to_string(), "b1".to_string()),
            Edge::new_with_handle("b1".to_string(), "d1".to_string(), "else".to_string()),
        ];

        assert!(validate_nodes_edges(&nodes, &edges, false).is_ok());
    }
}
