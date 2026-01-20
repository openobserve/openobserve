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

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::meta::{
    alerts::{ConditionGroup, ConditionList, QueryCondition, TriggerCondition},
    stream::{RemoteStreamParams, StreamParams, StreamType},
};

/// Pipeline source type determines when the pipeline runs.
/// Use "realtime" for processing data as it arrives, "scheduled" for periodic batch processing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(tag = "source_type")]
#[serde(rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)]
pub enum PipelineSource {
    /// Real-time pipeline: processes data immediately as it's ingested.
    /// Example: { "source_type": "realtime" }
    Realtime(StreamParams),
    /// Scheduled pipeline: runs periodically based on trigger_condition.
    /// Example: { "source_type": "scheduled", "org_id": "default", "stream_type": "logs",
    /// "query_condition": {...}, "trigger_condition": {...} }
    Scheduled(DerivedStream),
}

impl Default for PipelineSource {
    fn default() -> Self {
        Self::Realtime(StreamParams::default())
    }
}

impl PipelineSource {
    pub fn is_scheduled(&self) -> bool {
        matches!(self, Self::Scheduled(_))
    }

    pub fn is_realtime(&self) -> bool {
        matches!(self, Self::Realtime(_))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
#[serde(default)]
pub struct DerivedStream {
    #[serde(default)]
    pub org_id: String,
    pub stream_type: StreamType,
    #[serde(default)]
    pub query_condition: QueryCondition,
    #[serde(default)]
    pub trigger_condition: TriggerCondition, // Frequency type only supports minutes
    /// Timezone offset in minutes.
    /// The negative secs means the Western Hemisphere
    #[serde(default)]
    pub tz_offset: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay: Option<i32>,
    /// The datetime from when the pipeline should check for ingested data
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_at: Option<i64>,
}

impl DerivedStream {
    pub fn get_scheduler_module_key(&self, pipeline_name: &str, pipeline_id: &str) -> String {
        format!(
            "{}/{}/{}/{}",
            self.stream_type, self.org_id, pipeline_name, pipeline_id
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct Node {
    /// Unique identifier for the node (use UUID format)
    pub id: String,
    /// Node configuration. Structure depends on node_type:
    /// - stream: { "node_type": "stream", "org_id": "org", "stream_name": "name", "stream_type":
    ///   "logs"|"metrics"|"traces" }
    /// - function: { "node_type": "function", "name": "func_name", "after_flatten": bool }
    /// - condition: { "node_type": "condition", "conditions": {...} }
    /// - query: { "node_type": "query", "org_id": "org", "stream_type": "logs", "query_condition":
    ///   {...}, "trigger_condition": {...} }
    /// - remote_stream: { "node_type": "remote_stream", "org_id": "org", "destination_name":
    ///   "dest" }
    #[schema(value_type = Object)]
    pub data: NodeData,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<HashMap<String, String>>,
    /// Visual position for UI rendering
    position: Position,
    /// Node role in the pipeline. MUST be one of:
    /// - "input": Source stream node (first node in pipeline)
    /// - "output": Destination stream node (last node in pipeline)
    /// - "default": Processing node (function, condition, etc.)
    #[schema(example = "input")]
    io_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    style: Option<NodeStyle>,
}

impl PartialEq for Node {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
            && self.data == other.data
            && self.position == other.position
            && self.meta == other.meta
            && self.io_type == other.io_type
    }
}

impl Node {
    pub fn new(id: String, data: NodeData, pos_x: f32, pos_y: f32, io_type: String) -> Self {
        Self {
            id,
            data,
            meta: None,
            position: Position { x: pos_x, y: pos_y },
            io_type,
            style: None,
        }
    }

    pub fn get_node_data(&self) -> NodeData {
        self.data.clone()
    }

    pub fn get_node_id(&self) -> String {
        self.id.clone()
    }

    pub fn is_function_node(&self) -> bool {
        matches!(&self.data, NodeData::Function(_))
    }
}

/// Connection between two nodes in the pipeline
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct Edge {
    /// Edge identifier, format: "e{source_id}-{target_id}"
    #[schema(example = "einput-1-func-1")]
    pub id: String,
    /// Source node id (data flows from this node)
    pub source: String,
    /// Target node id (data flows to this node)
    pub target: String,
}

impl Edge {
    pub fn new(source: String, target: String) -> Self {
        let id = format!("e{source}-{target}");
        Self { id, source, target }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "node_type")]
#[serde(rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)]
pub enum NodeData {
    RemoteStream(RemoteStreamParams),
    Stream(StreamParams),
    Query(DerivedStream),
    Function(FunctionParams),
    Condition(ConditionParams),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct FunctionParams {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub after_flatten: bool,
    #[serde(default)]
    pub num_args: u8,
}

#[derive(Debug, Clone, PartialEq, ToSchema)]
pub enum ConditionParams {
    /// v1 format: Tree-based ConditionList (default when no version field)
    V1 { conditions: ConditionList },
    /// v2 format: Linear ConditionGroup (version: 2)
    V2 { conditions: ConditionGroup },
}

// Custom deserializer to handle missing version field (defaults to V1 for backward compatibility)
impl<'de> Deserialize<'de> for ConditionParams {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::Error;
        use serde_json::Value;

        let value = Value::deserialize(deserializer)?;

        // If version field is missing, default to 1 for backward compatibility
        let version = value.get("version").and_then(|v| v.as_u64()).unwrap_or(1);

        let Some(conditions) = value.get("conditions") else {
            return Err(D::Error::missing_field("conditions"));
        };

        match version {
            1 => {
                let conditions: ConditionList = serde_json::from_value(conditions.clone())
                    .map_err(|e| {
                        D::Error::custom(format!("Failed to parse v1 conditions: {}", e))
                    })?;
                Ok(ConditionParams::V1 { conditions })
            }
            2 => {
                let conditions: ConditionGroup = serde_json::from_value(conditions.clone())
                    .map_err(|e| {
                        D::Error::custom(format!("Failed to parse v2 conditions: {}", e))
                    })?;
                Ok(ConditionParams::V2 { conditions })
            }
            _ => Err(D::Error::custom(format!(
                "Unsupported version: {}",
                version
            ))),
        }
    }
}

// Custom serializer to omit version field for V1 (backward compatibility)
impl Serialize for ConditionParams {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;

        match self {
            ConditionParams::V1 { conditions } => {
                // V1: Omit version field for backward compatibility
                let mut state = serializer.serialize_struct("ConditionParams", 1)?;
                state.serialize_field("conditions", conditions)?;
                state.end()
            }
            ConditionParams::V2 { conditions } => {
                // V2: Include version field
                let mut state = serializer.serialize_struct("ConditionParams", 2)?;
                state.serialize_field("version", &2)?;
                state.serialize_field("conditions", conditions)?;
                state.end()
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
struct Position {
    x: f32,
    y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct NodeStyle {
    background_color: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{meta::stream::StreamType, utils::json};

    #[test]
    fn test_pipeline_source_serialization() {
        let data = json::json!({
          "source_type": "realtime",
          "org_id": "default",
          "stream_name": "default",
          "stream_type": "logs"
        });
        let from_json: PipelineSource = json::from_value(data).unwrap();
        let stream_params = StreamParams {
            org_id: "default".into(),
            stream_name: "default".into(),
            stream_type: StreamType::Logs,
        };
        let source = PipelineSource::Realtime(stream_params);
        assert_eq!(from_json, source);
    }

    #[test]
    fn test_pipeline_empty_source_serialization() {
        let data = json::json!({
          "source_type": "scheduled",
        });
        let from_json: PipelineSource = json::from_value(data).unwrap();
        println!("result: {:?}", from_json);
        let stream_params = DerivedStream::default();
        let source = PipelineSource::Scheduled(stream_params);
        assert_eq!(from_json, source);
    }

    #[test]
    fn test_node_data_serialization() {
        let data = json::json!({
          "node_type": "stream",
          "org_id": "default",
          "stream_name": "default",
          "stream_type": "logs"
        });
        let node: NodeData = json::from_value(data).unwrap();
        let node_data = NodeData::Stream(StreamParams {
            org_id: "default".into(),
            stream_name: "default".into(),
            stream_type: StreamType::Logs,
        });
        assert_eq!(node_data, node);

        let data = json::json!({
          "node_type": "remote_stream",
          "org_id": "default",
          "stream_name": "default",
          "stream_type": "logs",
          "destination_name": "4423",
        });
        let node: NodeData = json::from_value(data).unwrap();
        let node_data = NodeData::RemoteStream(RemoteStreamParams {
            org_id: "default".into(),
            destination_name: "4423".into(),
        });
        assert_eq!(node_data, node);
    }

    #[test]
    fn test_function_node_serialization() {
        let func = FunctionParams {
            // vrl_script: "vrl_script".to_string(),
            name: "func".to_string(),
            after_flatten: false,
            // params: "row".to_string(),
            num_args: 0,
        };
        let func_node = NodeData::Function(func);
        let payload = json::json!({
            "node_type": "function",
            "name": "func",
            "after_flatten": false,
        });
        let node_data: NodeData = json::from_value(payload).unwrap();
        assert_eq!(func_node, node_data);
    }

    #[test]
    fn test_condition_node_serialization() {
        // Test new format with ConditionList
        let payload = json::json!({
            "node_type": "condition",
            "conditions": {
                "column": "body",
                "operator": ">=",
                "value": {
                    "key": "value"
                },
                "ignore_case": false
            }
        });

        let node_data = json::from_value::<NodeData>(payload);
        assert!(node_data.is_ok());

        // Test backward compatibility with legacy array format
        let legacy_payload = json::json!({
            "node_type": "condition",
            "conditions": [
              {
                "column": "body",
                "operator": ">=",
                "value": {
                    "key": "value"
                },
                "ignore_case": false
              }
            ]
        });

        let legacy_node_data = json::from_value::<NodeData>(legacy_payload);
        assert!(legacy_node_data.is_ok());

        // Test OR logic
        let or_payload = json::json!({
            "node_type": "condition",
            "conditions": {
                "or": [
                    {
                        "column": "level",
                        "operator": "=",
                        "value": "error"
                    },
                    {
                        "column": "level",
                        "operator": "=",
                        "value": "critical"
                    }
                ]
            }
        });

        let or_node_data = json::from_value::<NodeData>(or_payload);
        assert!(or_node_data.is_ok());
    }

    #[test]
    fn test_condition_node_v2_serialization() {
        // Test v2 condition format with version field
        let payload = json::json!({
            "node_type": "condition",
            "version": 2,
            "conditions": {
                "filterType": "group",
                "logicalOperator": "AND",
                "conditions": [
                    {
                        "filterType": "condition",
                        "column": "status",
                        "operator": "=",
                        "value": "error",
                        "logicalOperator": "AND"
                    },
                    {
                        "filterType": "condition",
                        "column": "level",
                        "operator": "=",
                        "value": "critical",
                        "logicalOperator": "OR"
                    }
                ]
            }
        });

        let node_data = json::from_value::<NodeData>(payload);
        assert!(node_data.is_ok());

        // Verify it's V2
        if let Ok(NodeData::Condition(params)) = node_data {
            assert!(matches!(params, ConditionParams::V2 { .. }));
        }
    }

    #[test]
    fn test_condition_node_v2_nested_groups() {
        // Test with nested groups
        let nested_payload = json::json!({
            "node_type": "condition",
            "version": 2,
            "conditions": {
                "filterType": "group",
                "logicalOperator": "AND",
                "conditions": [
                    {
                        "filterType": "condition",
                        "column": "status",
                        "operator": "=",
                        "value": "error",
                        "logicalOperator": "AND"
                    },
                    {
                        "filterType": "group",
                        "logicalOperator": "OR",
                        "conditions": [
                            {
                                "filterType": "condition",
                                "column": "service",
                                "operator": "=",
                                "value": "api",
                                "logicalOperator": "OR"
                            },
                            {
                                "filterType": "condition",
                                "column": "service",
                                "operator": "=",
                                "value": "web",
                                "logicalOperator": "AND"
                            }
                        ],
                        "logicalOperator": "AND"
                    }
                ]
            }
        });

        let nested_node_data = json::from_value::<NodeData>(nested_payload);
        assert!(nested_node_data.is_ok());
    }

    #[test]
    fn test_deserialize_v2_nested_condition_nodes() {
        let json_str = r#"[
  {
    "id": "7035edaa-e96c-4114-8b3c-6c77db44418d",
    "data": {
      "node_type": "condition",
      "version": 2,
      "conditions": {
        "filterType": "group",
        "logicalOperator": "AND",
        "conditions": [
          {
            "filterType": "condition",
            "column": "kubernetes_annotations_prometheus_io_path",
            "operator": "=",
            "value": "asdfa",
            "logicalOperator": "AND"
          },
          {
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [
              {
                "filterType": "condition",
                "column": "distinct_field_hc_0",
                "operator": "=",
                "value": "123",
                "logicalOperator": "OR"
              },
              {
                "filterType": "condition",
                "column": "kubernetes_annotations_prometheus_io_path",
                "operator": "=",
                "value": "123",
                "logicalOperator": "AND"
              }
            ]
          },
          {
            "filterType": "condition",
            "column": "kubernetes_container_hash",
            "operator": "=",
            "value": "dasfg",
            "logicalOperator": "AND"
          }
        ]
      }
    },
    "position": {
      "x": 271.25,
      "y": 335
    },
    "io_type": "default"
  }
]"#;
        let result: Result<Vec<Node>, _> = json::from_str(json_str);
        match &result {
            Ok(nodes) => println!("✓ Successfully deserialized {} nodes", nodes.len()),
            Err(e) => println!("✗ Deserialization error: {}", e),
        }
        assert!(result.is_ok(), "Failed to deserialize: {:?}", result.err());
    }
}
