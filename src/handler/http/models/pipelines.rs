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
//! pipeline API endpoints.

use std::collections::HashMap;

use config::meta::{
    pipeline::{
        Pipeline as meta_pipeline,
        components::{Edge, Node, PipelineSource},
        default_status,
    },
    triggers::Trigger,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct Pipeline {
    #[serde(default)]
    #[serde(rename = "pipeline_id")]
    pub id: String,
    #[serde(default)]
    pub version: i32,
    #[serde(default = "default_status")]
    pub enabled: bool,
    #[serde(default)]
    pub org: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub source: PipelineSource,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub paused_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<PipelineErrorInfo>,
}

impl Pipeline {
    fn from(
        meta_pipeline: meta_pipeline,
        paused_at: Option<i64>,
        last_error: Option<PipelineErrorInfo>,
    ) -> Self {
        Self {
            id: meta_pipeline.id,
            version: meta_pipeline.version,
            enabled: meta_pipeline.enabled,
            org: meta_pipeline.org,
            name: meta_pipeline.name,
            description: meta_pipeline.description,
            source: meta_pipeline.source,
            nodes: meta_pipeline.nodes,
            edges: meta_pipeline.edges,
            paused_at,
            last_error,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct PipelineErrorInfo {
    pub last_error_timestamp: i64,
    pub error_summary: Option<String>,
    pub node_errors: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct PipelineList {
    pub list: Vec<Pipeline>,
}

impl PipelineList {
    pub fn from(
        pipelines: Vec<meta_pipeline>,
        triggers: Vec<Trigger>,
        errors: HashMap<String, PipelineErrorInfo>,
    ) -> Self {
        let triggers_map = triggers
            .into_iter()
            .map(|trigger| (trigger.module_key.to_string(), trigger))
            .collect::<HashMap<_, _>>();
        let mut list = vec![];
        for pipeline in pipelines {
            let paused_at = pipeline.get_derived_stream().and_then(|derived_stream| {
                triggers_map
                    .get(&derived_stream.get_scheduler_module_key(&pipeline.name, &pipeline.id))
                    .and_then(|trigger| trigger.end_time)
            });
            let last_error = errors.get(&pipeline.id).cloned();
            list.push(Pipeline::from(pipeline, paused_at, last_error));
        }

        PipelineList { list }
    }
}

#[derive(Deserialize, ToSchema)]
pub struct PipelineBulkEnableRequest {
    pub ids: Vec<String>,
}

#[derive(Default, Serialize, ToSchema)]
pub struct PipelineBulkEnableResponse {
    pub successful: Vec<String>,
    pub unsuccessful: Vec<String>,
    pub err: Option<String>,
}

#[cfg(test)]
mod tests {
    use config::meta::{pipeline::components::DerivedStream, stream::StreamParams};

    use super::*;

    #[test]
    fn test_pipeline_from_meta() {
        let meta_pipeline = meta_pipeline {
            id: "test-id".to_string(),
            version: 1,
            enabled: true,
            org: "test-org".to_string(),
            name: "test-pipeline".to_string(),
            description: "test description".to_string(),
            source: PipelineSource::Scheduled(DerivedStream::default()),
            nodes: vec![],
            edges: vec![],
        };

        let error_info = PipelineErrorInfo {
            last_error_timestamp: 12345678,
            error_summary: Some("test error".to_string()),
            node_errors: None,
        };

        let pipeline = Pipeline::from(meta_pipeline.clone(), Some(9999), Some(error_info.clone()));

        assert_eq!(pipeline.id, "test-id");
        assert_eq!(pipeline.version, 1);
        assert!(pipeline.enabled);
        assert_eq!(pipeline.org, "test-org");
        assert_eq!(pipeline.name, "test-pipeline");
        assert_eq!(pipeline.description, "test description");
        assert_eq!(pipeline.paused_at, Some(9999));
        assert_eq!(pipeline.last_error, Some(error_info));
    }

    #[test]
    fn test_pipeline_from_meta_without_optional_fields() {
        let meta_pipeline = meta_pipeline {
            id: "test-id".to_string(),
            version: 1,
            enabled: false,
            org: "test-org".to_string(),
            name: "test-pipeline".to_string(),
            description: "".to_string(),
            source: PipelineSource::Realtime(StreamParams::default()),
            nodes: vec![],
            edges: vec![],
        };

        let pipeline = Pipeline::from(meta_pipeline, None, None);

        assert_eq!(pipeline.id, "test-id");
        assert!(!pipeline.enabled);
        assert_eq!(pipeline.paused_at, None);
        assert_eq!(pipeline.last_error, None);
    }

    #[test]
    fn test_pipeline_error_info_serialization() {
        let error_info = PipelineErrorInfo {
            last_error_timestamp: 1234567890,
            error_summary: Some("Connection timeout".to_string()),
            node_errors: Some(serde_json::json!({"node1": "error1", "node2": "error2"})),
        };

        let json = serde_json::to_string(&error_info).unwrap();
        let deserialized: PipelineErrorInfo = serde_json::from_str(&json).unwrap();

        assert_eq!(error_info, deserialized);
    }

    #[test]
    fn test_pipeline_list_from_empty() {
        let pipelines = vec![];
        let triggers = vec![];
        let errors = HashMap::new();

        let pipeline_list = PipelineList::from(pipelines, triggers, errors);

        assert_eq!(pipeline_list.list.len(), 0);
    }

    #[test]
    fn test_pipeline_list_from_with_pipelines() {
        let pipeline1 = meta_pipeline {
            id: "id1".to_string(),
            version: 1,
            enabled: true,
            org: "org1".to_string(),
            name: "pipeline1".to_string(),
            description: "desc1".to_string(),
            source: PipelineSource::Scheduled(DerivedStream::default()),
            nodes: vec![],
            edges: vec![],
        };

        let pipeline2 = meta_pipeline {
            id: "id2".to_string(),
            version: 2,
            enabled: false,
            org: "org2".to_string(),
            name: "pipeline2".to_string(),
            description: "desc2".to_string(),
            source: PipelineSource::Realtime(StreamParams::default()),
            nodes: vec![],
            edges: vec![],
        };

        let pipelines = vec![pipeline1, pipeline2];
        let triggers = vec![];
        let mut errors = HashMap::new();
        errors.insert(
            "id1".to_string(),
            PipelineErrorInfo {
                last_error_timestamp: 999,
                error_summary: Some("error1".to_string()),
                node_errors: None,
            },
        );

        let pipeline_list = PipelineList::from(pipelines, triggers, errors);

        assert_eq!(pipeline_list.list.len(), 2);
        assert_eq!(pipeline_list.list[0].id, "id1");
        assert_eq!(pipeline_list.list[1].id, "id2");
        assert!(pipeline_list.list[0].last_error.is_some());
        assert!(pipeline_list.list[1].last_error.is_none());
    }

    #[test]
    fn test_pipeline_bulk_enable_request_deserialization() {
        let json = r#"{"ids": ["id1", "id2", "id3"]}"#;
        let request: PipelineBulkEnableRequest = serde_json::from_str(json).unwrap();

        assert_eq!(request.ids.len(), 3);
        assert_eq!(request.ids[0], "id1");
        assert_eq!(request.ids[1], "id2");
        assert_eq!(request.ids[2], "id3");
    }

    #[test]
    fn test_pipeline_bulk_enable_response_serialization() {
        let response = PipelineBulkEnableResponse {
            successful: vec!["id1".to_string(), "id2".to_string()],
            unsuccessful: vec!["id3".to_string()],
            err: Some("Some error occurred".to_string()),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("id1"));
        assert!(json.contains("id2"));
        assert!(json.contains("id3"));
        assert!(json.contains("Some error occurred"));
    }

    #[test]
    fn test_pipeline_bulk_enable_response_default() {
        let response = PipelineBulkEnableResponse::default();

        assert_eq!(response.successful.len(), 0);
        assert_eq!(response.unsuccessful.len(), 0);
        assert_eq!(response.err, None);
    }

    #[test]
    fn test_pipeline_list_default() {
        let pipeline_list = PipelineList::default();

        assert_eq!(pipeline_list.list.len(), 0);
    }

    #[test]
    fn test_pipeline_serialization() {
        let pipeline = Pipeline {
            id: "test-id".to_string(),
            version: 1,
            enabled: true,
            org: "org".to_string(),
            name: "name".to_string(),
            description: "desc".to_string(),
            source: PipelineSource::Realtime(StreamParams::default()),
            nodes: vec![],
            edges: vec![],
            paused_at: Some(12345),
            last_error: None,
        };

        let json = serde_json::to_string(&pipeline).unwrap();
        let deserialized: Pipeline = serde_json::from_str(&json).unwrap();

        assert_eq!(pipeline, deserialized);
    }
}
