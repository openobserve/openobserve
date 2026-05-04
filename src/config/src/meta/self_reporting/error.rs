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
    Function(FunctionError),
    Ingestion,
    Pipeline(PipelineError),
    SsoClaimParser(SsoClaimParserError),
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
            ErrorSource::Function(fe) => {
                state.serialize_field("error_source", &"function")?;
                state.serialize_field("function_name", &fe.function_name)?;
                state.serialize_field("error", &fe.error.truncate_utf8(PIPELINE_ERROR_MAX_SIZE))?;
            }
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
            ErrorSource::SsoClaimParser(ce) => {
                state.serialize_field("error_source", &ce.function_name)?;
                state.serialize_field("pipeline_name", &"sso_claim_parser")?;
                state.serialize_field("error_type", &ce.error_type)?;
                state.serialize_field("error", &ce.error.truncate_utf8(PIPELINE_ERROR_MAX_SIZE))?;
                if let Some(claims) = &ce.claims_json {
                    state.serialize_field(
                        "claims",
                        &claims.truncate_utf8(PIPELINE_ERROR_MAX_SIZE),
                    )?;
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

    pub fn add_node_error(
        &mut self,
        node_id: String,
        node_type: String,
        error: String,
        fn_name: Option<String>,
    ) {
        self.node_errors
            .entry(node_id.clone())
            .or_insert_with(|| NodeErrors::new(node_id, node_type, fn_name))
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_name: Option<String>,
}

impl NodeErrors {
    pub fn new(node_id: String, node_type: String, function_name: Option<String>) -> Self {
        Self {
            node_id,
            node_type,
            errors: HashSet::new(),
            error_count: 0,
            function_name,
        }
    }

    pub fn add_error(&mut self, error: String) {
        self.error_count += 1;
        self.errors.insert(error);
    }
}

/// Function Error
///
/// Captures errors from function deserialization or execution.
/// This error type is reported to _meta/errors stream for monitoring and debugging.
#[derive(Clone, Debug, PartialEq)]
pub struct FunctionError {
    /// Name of the function that failed
    pub function_name: String,
    /// Detailed error message
    pub error: String,
}

impl FunctionError {
    pub fn new(function_name: String, error: String) -> Self {
        Self {
            function_name,
            error,
        }
    }
}

/// SSO Claim Parser Error
///
/// Captures errors from VRL-based custom claim parsing for SSO authentication.
/// This error type is reported to _meta/errors stream for monitoring and debugging.
#[derive(Clone, Debug, PartialEq)]
pub struct SsoClaimParserError {
    /// Name of the VRL function that failed
    pub function_name: String,
    /// Error category: compile_error, exec_error, timeout, parse_error, validation_error
    pub error_type: String,
    /// Detailed error message from VRL execution
    pub error: String,
    /// JSON string of input claims for debugging (truncated to 1KB in serialization)
    pub claims_json: Option<String>,
}

impl SsoClaimParserError {
    pub fn new(function_name: String, error_type: String, error: String) -> Self {
        Self {
            function_name,
            error_type,
            error,
            claims_json: None,
        }
    }

    pub fn with_claims(mut self, claims_json: String) -> Self {
        self.claims_json = Some(claims_json);
        self
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
                        function_name: None,
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

    #[test]
    fn test_error_source_alert_serialization() {
        let error_data = ErrorData {
            _timestamp: 1,
            stream_params: StreamParams::default(),
            error_source: ErrorSource::Alert,
        };
        let val = json::to_string(&error_data).unwrap();
        assert!(val.contains("alert"));
    }

    #[test]
    fn test_error_source_dashboard_serialization() {
        let error_data = ErrorData {
            _timestamp: 1,
            stream_params: StreamParams::default(),
            error_source: ErrorSource::Dashboard,
        };
        let val = json::to_string(&error_data).unwrap();
        assert!(val.contains("dashboard"));
    }

    #[test]
    fn test_error_source_ingestion_serialization() {
        let error_data = ErrorData {
            _timestamp: 1,
            stream_params: StreamParams::default(),
            error_source: ErrorSource::Ingestion,
        };
        let val = json::to_string(&error_data).unwrap();
        assert!(val.contains("ingestion"));
    }

    #[test]
    fn test_error_source_search_serialization() {
        let error_data = ErrorData {
            _timestamp: 1,
            stream_params: StreamParams::default(),
            error_source: ErrorSource::Search,
        };
        let val = json::to_string(&error_data).unwrap();
        assert!(val.contains("search"));
    }

    #[test]
    fn test_error_source_other_serialization() {
        let error_data = ErrorData {
            _timestamp: 1,
            stream_params: StreamParams::default(),
            error_source: ErrorSource::Other,
        };
        let val = json::to_string(&error_data).unwrap();
        assert!(val.contains("other"));
    }

    #[test]
    fn test_error_source_function_serialization() {
        let fe = FunctionError::new("my_func".to_string(), "exec failed".to_string());
        let error_data = ErrorData {
            _timestamp: 1,
            stream_params: StreamParams::default(),
            error_source: ErrorSource::Function(fe),
        };
        let val = json::to_string(&error_data).unwrap();
        assert!(val.contains("function"));
        assert!(val.contains("my_func"));
    }

    #[test]
    fn test_pipeline_error_add_node_error() {
        let mut pe = PipelineError::new("pid", "pname");
        pe.add_node_error(
            "node1".to_string(),
            "function".to_string(),
            "exec error".to_string(),
            Some("fn1".to_string()),
        );
        pe.add_node_error(
            "node1".to_string(),
            "function".to_string(),
            "another error".to_string(),
            None,
        );
        assert_eq!(pe.node_errors.len(), 1);
        let node = &pe.node_errors["node1"];
        assert_eq!(node.error_count, 2);
        assert_eq!(node.errors.len(), 2);
    }

    #[test]
    fn test_sso_claim_parser_error_with_claims() {
        let ce = SsoClaimParserError::new(
            "fn".to_string(),
            "parse_error".to_string(),
            "bad input".to_string(),
        )
        .with_claims(r#"{"sub":"user1"}"#.to_string());
        assert!(ce.claims_json.is_some());
        assert!(ce.claims_json.unwrap().contains("user1"));
    }

    #[test]
    fn test_sso_claim_parser_error_serialization_with_claims() {
        let ce = SsoClaimParserError::new(
            "my_fn".to_string(),
            "exec_error".to_string(),
            "vrl failed".to_string(),
        )
        .with_claims(r#"{"key":"val"}"#.to_string());
        let error_data = ErrorData {
            _timestamp: 1,
            stream_params: StreamParams::default(),
            error_source: ErrorSource::SsoClaimParser(ce),
        };
        let val = json::to_string(&error_data).unwrap();
        assert!(val.contains("sso_claim_parser"));
        assert!(val.contains("claims"));
    }

    #[test]
    fn test_node_errors_new_and_add_error() {
        let mut node = NodeErrors::new(
            "n1".to_string(),
            "transform".to_string(),
            Some("fn_name".to_string()),
        );
        assert_eq!(node.error_count, 0);
        node.add_error("err1".to_string());
        node.add_error("err1".to_string()); // duplicate — deduped in HashSet
        node.add_error("err2".to_string());
        assert_eq!(node.error_count, 3);
        assert_eq!(node.errors.len(), 2); // "err1" deduplicated
    }

    #[test]
    fn test_pipeline_error_with_no_node_errors_serialization() {
        let pe = PipelineError::new("pid2", "pname2");
        let error_data = ErrorData {
            _timestamp: 1,
            stream_params: StreamParams::default(),
            error_source: ErrorSource::Pipeline(pe),
        };
        let val = json::to_string(&error_data).unwrap();
        assert!(val.contains("pipeline"));
        // node_errors empty → pipeline_node_errors NOT in output
        assert!(!val.contains("pipeline_node_errors"));
    }

    #[test]
    fn test_node_errors_function_name_none_absent_from_json() {
        let node = NodeErrors::new("n1".to_string(), "transform".to_string(), None);
        let json = serde_json::to_value(&node).unwrap();
        assert!(!json.as_object().unwrap().contains_key("function_name"));
    }

    #[test]
    fn test_node_errors_function_name_some_present_in_json() {
        let node = NodeErrors::new(
            "n2".to_string(),
            "function".to_string(),
            Some("my_fn".to_string()),
        );
        let json = serde_json::to_value(&node).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("function_name"));
        assert_eq!(obj["function_name"], serde_json::json!("my_fn"));
    }

    #[test]
    fn test_pipeline_error_new_empty() {
        let pe = PipelineError::new("p1", "Pipeline One");
        assert_eq!(pe.pipeline_id, "p1");
        assert_eq!(pe.pipeline_name, "Pipeline One");
        assert!(pe.error.is_none());
        assert!(pe.node_errors.is_empty());
    }

    #[test]
    fn test_function_error_new() {
        let fe = FunctionError::new("fn_name".to_string(), "some error".to_string());
        assert_eq!(fe.function_name, "fn_name");
        assert_eq!(fe.error, "some error");
    }

    #[test]
    fn test_error_source_sso_no_claims_absent_from_serialization() {
        let ce = SsoClaimParserError::new("fn".to_string(), "parse".to_string(), "bad".to_string());
        let error_data = ErrorData {
            _timestamp: 1,
            stream_params: StreamParams::default(),
            error_source: ErrorSource::SsoClaimParser(ce),
        };
        let val = json::to_string(&error_data).unwrap();
        assert!(!val.contains("claims"));
    }
}
