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

use serde::{Deserialize, Serialize, ser::SerializeStruct};

use crate::{meta::stream::StreamParams, utils::str::StringExt};

const PIPELINE_ERROR_MAX_SIZE: usize = 1024;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ErrorData {
    pub _timestamp: i64,
    #[serde(flatten)]
    pub stream_params: StreamParams,
    #[serde(flatten)]
    pub error_source: ErrorSource,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ErrorSource {
    Alert,
    Dashboard,
    Ingestion,
    Pipeline(PipelineError),
    Search,
    Other,
}

impl Serialize for ErrorSource {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("error_source", 4)?;
        match self {
            ErrorSource::Alert => state.serialize_field("error_source", &"alert")?,
            ErrorSource::Dashboard => state.serialize_field("error_source", &"dashboard")?,
            ErrorSource::Ingestion => state.serialize_field("error_source", &"ingestion")?,
            ErrorSource::Search => state.serialize_field("error_source", &"search")?,
            ErrorSource::Other => state.serialize_field("error_source", &"other")?,
            ErrorSource::Pipeline(pe) => {
                // limit the size of the pipeline error to 1k characters
                state.serialize_field("error_source", &"pipeline")?;
                state.serialize_field("pipeline_id", &pe.pipeline_id)?;
                state.serialize_field("pipeline_name", &pe.pipeline_name)?;
                if !pe.node_errors.is_empty() {
                    let node_errors = serde_json::to_string(&pe.node_errors).unwrap_or_default();
                    state.serialize_field(
                        "pipeline_node_errors",
                        &node_errors.truncate_utf8(PIPELINE_ERROR_MAX_SIZE),
                    )?;
                }
                if let Some(error) = &pe.error {
                    state
                        .serialize_field("error", &error.truncate_utf8(PIPELINE_ERROR_MAX_SIZE))?;
                }
            }
        }
        state.end()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PipelineError {
    pub pipeline_id: String,
    pub pipeline_name: String,
    pub error: Option<String>,
    pub node_errors: HashMap<String, NodeErrors>,
}

impl PipelineError {
    pub fn new(pipeline_id: &str, pipeline_name: &str) -> Self {
        Self {
            pipeline_id: pipeline_id.to_string(),
            pipeline_name: pipeline_name.to_string(),
            error: None,
            node_errors: HashMap::new(),
        }
    }

    pub fn add_node_error(&mut self, node_id: String, node_type: String, error: String) {
        self.node_errors
            .entry(node_id.clone())
            .or_insert_with(|| NodeErrors::new(node_id, node_type))
            .add_error(error);
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct NodeErrors {
    node_id: String,
    node_type: String,
    errors: HashSet<String>,
    error_count: i32,
}

impl NodeErrors {
    pub fn new(node_id: String, node_type: String) -> Self {
        Self {
            node_id,
            node_type,
            errors: HashSet::new(),
            error_count: 0,
        }
    }

    pub fn add_error(&mut self, error: String) {
        self.error_count += 1;
        self.errors.insert(error);
    }
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
            error_source: ErrorSource::Pipeline(PipelineError {
                pipeline_id: "pipeline_id".to_string(),
                pipeline_name: "pipeline_name".to_string(),
                error: Some("pipeline init error".to_string()),
                node_errors: HashMap::from([(
                    "node_1".to_string(),
                    NodeErrors {
                        node_id: "node_1".to_string(),
                        node_type: "function".to_string(),
                        errors: HashSet::from(["failed to compile".to_string()]),
                        error_count: 1,
                    },
                )]),
            }),
        };

        let val = json::to_value(error_data);
        assert!(val.is_ok());
        let val_str = json::to_string(&val.unwrap());
        assert!(val_str.is_ok());
        println!("val: {}", val_str.unwrap());
    }

    #[test]
    fn test_error_data_serialization() {
        let error_data = ErrorData {
            _timestamp: 10,
            stream_params: StreamParams::default(),
            error_source: ErrorSource::Pipeline(PipelineError::new("pipeline_id", "pipeline_name")),
        };
        let val = json::to_string(&error_data);
        assert!(val.is_ok());
    }
}
