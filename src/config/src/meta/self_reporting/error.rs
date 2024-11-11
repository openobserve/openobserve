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

use serde::{Deserialize, Serialize};

use crate::meta::{pipeline, stream::StreamParams};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ErrorData {
    pub _timestamp: i64,
    #[serde(flatten)]
    pub stream_params: StreamParams,
    #[serde(flatten)]
    pub error_type: ErrorSource,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "error_source")]
#[serde(rename_all = "snake_case")]
pub enum ErrorSource {
    Alert,
    Dashboard,
    Ingestion,
    Pipeline(PipelineError),
    Search,
    Other,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineError {
    pub pipeline_id: String,
    pub pipeline_name: String,
    pub node_errors: Vec<NodeError>,
}

impl PipelineError {
    pub fn new(pipeline: &pipeline::Pipeline) -> Self {
        Self {
            pipeline_id: pipeline.id.to_string(),
            pipeline_name: pipeline.name.to_string(),
            node_errors: Vec::new(),
        }
    }

    pub fn add_node_error(&mut self, node: &pipeline::components::Node, error_detail: String) {
        let node_error = NodeError {
            node_id: node.id.to_string(),
            node_type: node.node_type(),
            error_detail,
        };
        self.node_errors.push(node_error);
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NodeError {
    pub node_id: String,
    pub node_type: String,
    pub error_detail: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::json;

    #[test]
    fn test_error_type() {
        let error_data = ErrorData {
            _timestamp: 10,
            stream_params: StreamParams::default(),
            error_type: ErrorSource::Pipeline(PipelineError {
                pipeline_id: "pipeline_id".to_string(),
                pipeline_name: "pipeline_name".to_string(),
                node_errors: vec![NodeError {
                    node_id: "node_id".to_string(),
                    node_type: "function".to_string(),
                    error_detail: "error".to_string(),
                }],
            }),
        };

        let val = json::to_value(error_data).unwrap();
        let val_str = json::to_string(&val).unwrap();
        println!("val: {}", val_str);
    }
}
