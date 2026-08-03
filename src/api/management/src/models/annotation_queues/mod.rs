// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use infra::table::score_configs::ScoreConfigDataType;
use openobserve_core::llm_evaluations::annotation_queues::{
    AnnotationQueue, AnnotationQueueItem, AnnotationQueueItemSelection, CreateAnnotationQueue,
    EnqueueAnnotationQueueItem, PinnedScoreConfig, UpdateAnnotationQueue,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateAnnotationQueueRequestBody {
    pub name: String,
    pub description: Option<String>,
    pub target_dataset_id: Option<String>,
    pub score_config_row_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateAnnotationQueueRequestBody {
    pub name: String,
    pub description: Option<String>,
    pub target_dataset_id: Option<String>,
    /// Exact physical Score Config row-ID set rendered by the edit form.
    pub expected_score_config_row_ids: Vec<String>,
    /// Desired replacement physical Score Config row-ID set.
    pub score_config_row_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PinnedScoreConfigResponseBody {
    pub row_id: String,
    pub entity_id: String,
    pub name: String,
    pub version: i32,
    #[schema(value_type = String)]
    pub data_type: ScoreConfigDataType,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationQueueResponseBody {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub target_dataset_id: Option<String>,
    pub allowed_ref_types: Vec<String>,
    pub score_configs: Vec<PinnedScoreConfigResponseBody>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_by: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListAnnotationQueuesResponseBody {
    pub list: Vec<AnnotationQueueResponseBody>,
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct ListAnnotationQueueItemsQuery {
    /// Queue workflow status. Supported values are `pending` and `reviewed`.
    pub queue_status: Option<String>,
    /// Item scope. Supported values are `span`, `trace`, and `session`.
    pub scope: Option<String>,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnqueueAnnotationQueueItemRequestBody {
    /// Discovered object scope: `span`, `trace`, or `session`.
    pub ref_type: String,
    /// Span, trace, or session identifier, according to `refType`.
    pub ref_id: String,
    /// Owning trace ID. Required only when `refType` is `span`.
    pub ref_trace_id: Option<String>,
    /// Reference trace start time in microseconds. Required for every scope and
    /// used as the lower bound for Workbench score/annotation searches.
    pub ref_trace_start_time: i64,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationQueueItemSelectionRequestBody {
    /// Queue Item IDs selected for this bulk action.
    pub item_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveAnnotationQueueItemsResponseBody {
    pub archived_count: u64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClearAnnotationQueueItemsResponseBody {
    pub cleared_count: u64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationQueueItemResponseBody {
    pub id: String,
    pub org_id: String,
    pub queue_id: String,
    pub queue_name: Option<String>,
    pub ref_type: String,
    pub ref_id: String,
    pub ref_trace_id: Option<String>,
    pub ref_trace_start_time: i64,
    pub status: String,
    pub reviewed_at: Option<i64>,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListAnnotationQueueItemsResponseBody {
    pub list: Vec<AnnotationQueueItemResponseBody>,
}

impl From<CreateAnnotationQueueRequestBody> for CreateAnnotationQueue {
    fn from(value: CreateAnnotationQueueRequestBody) -> Self {
        Self {
            name: value.name,
            description: value.description,
            target_dataset_id: value.target_dataset_id,
            score_config_row_ids: value.score_config_row_ids,
        }
    }
}

impl From<UpdateAnnotationQueueRequestBody> for UpdateAnnotationQueue {
    fn from(value: UpdateAnnotationQueueRequestBody) -> Self {
        Self {
            name: value.name,
            description: value.description,
            target_dataset_id: value.target_dataset_id,
            expected_score_config_row_ids: value.expected_score_config_row_ids,
            score_config_row_ids: value.score_config_row_ids,
        }
    }
}

impl From<EnqueueAnnotationQueueItemRequestBody> for EnqueueAnnotationQueueItem {
    fn from(value: EnqueueAnnotationQueueItemRequestBody) -> Self {
        Self {
            ref_type: value.ref_type,
            ref_id: value.ref_id,
            ref_trace_id: value.ref_trace_id,
            ref_trace_start_time: value.ref_trace_start_time,
        }
    }
}

impl From<AnnotationQueueItemSelectionRequestBody> for AnnotationQueueItemSelection {
    fn from(value: AnnotationQueueItemSelectionRequestBody) -> Self {
        Self {
            item_ids: value.item_ids,
        }
    }
}

impl From<PinnedScoreConfig> for PinnedScoreConfigResponseBody {
    fn from(value: PinnedScoreConfig) -> Self {
        Self {
            row_id: value.row_id,
            entity_id: value.entity_id,
            name: value.name,
            version: value.version,
            data_type: value.data_type,
        }
    }
}

impl From<AnnotationQueue> for AnnotationQueueResponseBody {
    fn from(value: AnnotationQueue) -> Self {
        Self {
            id: value.id,
            org_id: value.org_id,
            name: value.name,
            description: value.description,
            target_dataset_id: value.target_dataset_id,
            allowed_ref_types: value.allowed_ref_types,
            score_configs: value
                .score_configs
                .into_iter()
                .map(PinnedScoreConfigResponseBody::from)
                .collect(),
            created_by: value.created_by,
            created_at: value.created_at,
            updated_by: value.updated_by,
            updated_at: value.updated_at,
        }
    }
}

impl From<Vec<AnnotationQueue>> for ListAnnotationQueuesResponseBody {
    fn from(value: Vec<AnnotationQueue>) -> Self {
        Self {
            list: value
                .into_iter()
                .map(AnnotationQueueResponseBody::from)
                .collect(),
        }
    }
}

impl From<AnnotationQueueItem> for AnnotationQueueItemResponseBody {
    fn from(value: AnnotationQueueItem) -> Self {
        Self {
            id: value.id,
            org_id: value.org_id,
            queue_id: value.queue_id,
            queue_name: value.queue_name,
            ref_type: value.ref_type,
            ref_id: value.ref_id,
            ref_trace_id: value.ref_trace_id,
            ref_trace_start_time: value.ref_trace_start_time,
            status: value.status,
            reviewed_at: value.reviewed_at,
            archived_at: value.archived_at,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl From<Vec<AnnotationQueueItem>> for ListAnnotationQueueItemsResponseBody {
    fn from(value: Vec<AnnotationQueueItem>) -> Self {
        Self {
            list: value
                .into_iter()
                .map(AnnotationQueueItemResponseBody::from)
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_requires_expected_physical_binding_set() {
        let body: UpdateAnnotationQueueRequestBody = serde_json::from_value(serde_json::json!({
            "name": "Safety review",
            "description": null,
            "targetDatasetId": null,
            "expectedScoreConfigRowIds": ["row-v1"],
            "scoreConfigRowIds": ["row-v2"]
        }))
        .unwrap();
        let command: UpdateAnnotationQueue = body.into();
        assert_eq!(command.expected_score_config_row_ids, ["row-v1"]);
        assert_eq!(command.score_config_row_ids, ["row-v2"]);
    }

    #[test]
    fn create_rejects_server_owned_fields() {
        let result: Result<CreateAnnotationQueueRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "name": "Safety review",
                "scoreConfigRowIds": ["row-v1"],
                "allowedRefTypes": ["trace"]
            }));
        assert!(result.is_err());
    }

    #[test]
    fn queue_item_memberships_remain_independent() {
        let item = |id: &str, queue_id: &str, status: &str| AnnotationQueueItem {
            id: id.to_string(),
            org_id: "org-1".to_string(),
            queue_id: queue_id.to_string(),
            queue_name: Some(queue_id.to_string()),
            ref_type: "trace".to_string(),
            ref_id: "trace-1".to_string(),
            ref_trace_id: None,
            ref_trace_start_time: 1,
            status: status.to_string(),
            reviewed_at: (status == "reviewed").then_some(42),
            archived_at: None,
            created_at: 1,
            updated_at: 2,
        };
        let response = ListAnnotationQueueItemsResponseBody::from(vec![
            item("item-1", "queue-1", "reviewed"),
            item("item-2", "queue-2", "pending"),
        ]);

        assert_eq!(response.list.len(), 2);
        assert_eq!(response.list[0].ref_id, response.list[1].ref_id);
        assert_ne!(response.list[0].queue_id, response.list[1].queue_id);
        assert_ne!(response.list[0].status, response.list[1].status);
    }

    #[test]
    fn enqueue_rejects_server_owned_workflow_fields() {
        let body: EnqueueAnnotationQueueItemRequestBody =
            serde_json::from_value(serde_json::json!({
                "refType": "trace",
                "refId": "trace-1",
                "refTraceStartTime": 1
            }))
            .unwrap();
        let command: EnqueueAnnotationQueueItem = body.into();
        assert_eq!(command.ref_type, "trace");
        assert_eq!(command.ref_id, "trace-1");
        assert_eq!(command.ref_trace_id, None);
        assert_eq!(command.ref_trace_start_time, 1);

        let missing_start_time: Result<EnqueueAnnotationQueueItemRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "refType": "trace",
                "refId": "trace-1"
            }));
        assert!(missing_start_time.is_err());

        let result: Result<EnqueueAnnotationQueueItemRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "refType": "trace",
                "refId": "trace-1",
                "refTraceStartTime": 1,
                "status": "reviewed"
            }));
        assert!(result.is_err());

        let span_context: EnqueueAnnotationQueueItemRequestBody =
            serde_json::from_value(serde_json::json!({
                "refType": "span",
                "refId": "span-1",
                "refTraceId": "trace-1",
                "refTraceStartTime": 1
            }))
            .unwrap();
        let command: EnqueueAnnotationQueueItem = span_context.into();
        assert_eq!(command.ref_trace_id.as_deref(), Some("trace-1"));
        assert_eq!(command.ref_trace_start_time, 1);
    }

    #[test]
    fn item_selection_uses_camel_case_ids_and_rejects_unknown_fields() {
        let body: AnnotationQueueItemSelectionRequestBody =
            serde_json::from_value(serde_json::json!({
                "itemIds": ["item-1", "item-2"]
            }))
            .unwrap();
        let selection: AnnotationQueueItemSelection = body.into();
        assert_eq!(selection.item_ids, ["item-1", "item-2"]);

        let invalid: Result<AnnotationQueueItemSelectionRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "itemIds": ["item-1"],
                "status": "reviewed"
            }));
        assert!(invalid.is_err());
    }
}
