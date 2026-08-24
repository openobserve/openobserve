// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use config::meta::self_reporting::llm_scores::{
    LlmScoreDataSourceType, LlmScoreDataType, LlmScoreRecord,
};
use infra::table::score_configs::ScoreConfigDataType;
use openobserve_core::llm_evaluations::annotation_queues::{
    AnnotationQueue, AnnotationQueueItem, AnnotationQueueItemContent, AnnotationQueueItemDetail,
    AnnotationQueueItemSelection, CreateAnnotationQueue, CreateQueueReview,
    EnqueueAnnotationQueueItem, PinnedScoreConfig, QueueReviewSubmission, UpdateAnnotationQueue,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::annotations::{AnnotationScoreRequestBody, AnnotationTargetMetadataRequestBody};

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
    pub target_dataset_name: Option<String>,
    pub allowed_ref_types: Vec<String>,
    pub score_configs: Vec<PinnedScoreConfigResponseBody>,
    /// Number of non-archived Queue Items whose review is complete.
    pub reviewed_count: u64,
    /// Number of non-archived Queue Items participating in review progress.
    pub total_count: u64,
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
    /// Return memberships from one Annotation Queue only.
    pub queue_id: Option<String>,
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

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewAnnotationQueueItemRequestBody {
    /// Client-generated idempotency key shared by all N Score events. Reuse it
    /// only when retrying the identical logical submission.
    pub submission_id: String,
    pub source_stream: String,
    pub scores: Vec<AnnotationScoreRequestBody>,
    #[serde(default)]
    pub comments: Option<String>,
    #[serde(default)]
    pub target_metadata: Option<AnnotationTargetMetadataRequestBody>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQueueReviewsResponseBody {
    pub list: Vec<QueueReviewSubmission>,
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

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationQueueItemContentResponseBody {
    pub input: Option<serde_json::Value>,
    pub output: Option<serde_json::Value>,
    pub trace: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationQueueMachineScoreResponseBody {
    pub id: String,
    pub name: String,
    pub value_numeric: Option<f64>,
    pub value_categorical: Option<String>,
    pub value_boolean: Option<bool>,
    pub data_type: String,
    pub source_type: String,
    pub source_stream: Option<String>,
    pub scorer_id: Option<String>,
    pub scorer_version: Option<String>,
    pub score_config_id: Option<String>,
    pub score_config_version: Option<String>,
    pub reasoning: Option<String>,
    pub timestamp: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueueReviewSubmissionResponseBody {
    pub submission_id: String,
    pub reviewer: Option<String>,
    pub comments: Option<String>,
    pub submitted_at: i64,
    pub scores: Vec<AnnotationQueueMachineScoreResponseBody>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationQueueItemDetailResponseBody {
    pub item: AnnotationQueueItemResponseBody,
    pub source_stream: String,
    pub content: AnnotationQueueItemContentResponseBody,
    pub machine_scores: Vec<AnnotationQueueMachineScoreResponseBody>,
    pub reviews: Vec<QueueReviewSubmissionResponseBody>,
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

impl From<ReviewAnnotationQueueItemRequestBody> for CreateQueueReview {
    fn from(value: ReviewAnnotationQueueItemRequestBody) -> Self {
        Self {
            submission_id: value.submission_id,
            source_stream: value.source_stream,
            scores: value.scores.into_iter().map(Into::into).collect(),
            comments: value.comments,
            target_metadata: value.target_metadata.unwrap_or_default().into(),
            metadata: value.metadata,
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
            target_dataset_name: value.target_dataset_name,
            allowed_ref_types: value.allowed_ref_types,
            score_configs: value
                .score_configs
                .into_iter()
                .map(PinnedScoreConfigResponseBody::from)
                .collect(),
            reviewed_count: value.reviewed_count,
            total_count: value.total_count,
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

impl From<AnnotationQueueItemContent> for AnnotationQueueItemContentResponseBody {
    fn from(value: AnnotationQueueItemContent) -> Self {
        Self {
            input: value.input,
            output: value.output,
            trace: value.trace,
        }
    }
}

impl From<LlmScoreRecord> for AnnotationQueueMachineScoreResponseBody {
    fn from(value: LlmScoreRecord) -> Self {
        let data_type = match value.data_type {
            LlmScoreDataType::Numeric => "numeric",
            LlmScoreDataType::Categorical => "categorical",
            LlmScoreDataType::Boolean => "boolean",
        };
        let source_type = match value.source_type {
            LlmScoreDataSourceType::LlmJudge => "llm_judge",
            LlmScoreDataSourceType::Code => "code",
            LlmScoreDataSourceType::Remote => "remote",
            LlmScoreDataSourceType::Annotation => "annotation",
            LlmScoreDataSourceType::Feedback => "feedback",
            LlmScoreDataSourceType::Experiment => "experiment",
        };
        Self {
            id: value.id,
            name: value.name,
            value_numeric: value.value_numeric,
            value_categorical: value.value_categorical,
            value_boolean: value.value_boolean,
            data_type: data_type.to_string(),
            source_type: source_type.to_string(),
            source_stream: value.source_stream,
            scorer_id: value.scorer_id,
            scorer_version: value.scorer_version,
            score_config_id: value.score_config_id,
            score_config_version: value.score_config_version,
            reasoning: value.reasoning,
            timestamp: value._timestamp,
        }
    }
}

impl From<QueueReviewSubmission> for QueueReviewSubmissionResponseBody {
    fn from(value: QueueReviewSubmission) -> Self {
        Self {
            submission_id: value.submission_id,
            reviewer: value.reviewer,
            comments: value.comments,
            submitted_at: value.submitted_at,
            scores: value.scores.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<AnnotationQueueItemDetail> for AnnotationQueueItemDetailResponseBody {
    fn from(value: AnnotationQueueItemDetail) -> Self {
        Self {
            item: value.item.into(),
            source_stream: value.source_stream,
            content: value.content.into(),
            machine_scores: value.machine_scores.into_iter().map(Into::into).collect(),
            reviews: value.reviews.into_iter().map(Into::into).collect(),
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
    fn queue_response_includes_target_dataset_and_active_review_progress() {
        let response = AnnotationQueueResponseBody::from(AnnotationQueue {
            id: "queue-1".to_string(),
            org_id: "org-1".to_string(),
            name: "Safety review".to_string(),
            description: None,
            target_dataset_id: Some("dataset-1".to_string()),
            target_dataset_name: Some("Golden answers".to_string()),
            allowed_ref_types: vec!["trace".to_string()],
            score_configs: vec![],
            reviewed_count: 3,
            total_count: 8,
            created_by: "owner@example.com".to_string(),
            created_at: 1,
            updated_by: "owner@example.com".to_string(),
            updated_at: 2,
        });
        let value = serde_json::to_value(response).unwrap();

        assert_eq!(value["targetDatasetId"], "dataset-1");
        assert_eq!(value["targetDatasetName"], "Golden answers");
        assert_eq!(value["reviewedCount"], 3);
        assert_eq!(value["totalCount"], 8);
    }

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
    fn queue_item_detail_serializes_content_and_machine_scores() {
        let detail = AnnotationQueueItemDetail {
            item: AnnotationQueueItem {
                id: "item-1".to_string(),
                org_id: "org-1".to_string(),
                queue_id: "queue-1".to_string(),
                queue_name: Some("Review".to_string()),
                ref_type: "trace".to_string(),
                ref_id: "trace-1".to_string(),
                ref_trace_id: None,
                ref_trace_start_time: 100,
                status: "pending".to_string(),
                reviewed_at: None,
                archived_at: None,
                created_at: 1,
                updated_at: 2,
            },
            source_stream: "traces".to_string(),
            content: AnnotationQueueItemContent {
                input: Some(serde_json::json!({"question": "hello"})),
                output: Some(serde_json::json!({"answer": "hi"})),
                trace: vec![serde_json::json!({"trace_id": "trace-1"})],
            },
            machine_scores: vec![LlmScoreRecord {
                id: "score-1".to_string(),
                name: "faithfulness".to_string(),
                value_numeric: Some(0.9),
                data_type: LlmScoreDataType::Numeric,
                source_type: LlmScoreDataSourceType::LlmJudge,
                source_stream: Some("traces".to_string()),
                _timestamp: 200,
                ..LlmScoreRecord::default()
            }],
            reviews: vec![QueueReviewSubmission {
                submission_id: "submission-1".to_string(),
                reviewer: Some("reviewer@example.com".to_string()),
                comments: None,
                submitted_at: 300,
                scores: vec![LlmScoreRecord {
                    id: "score-2".to_string(),
                    name: "faithfulness".to_string(),
                    value_numeric: Some(1.0),
                    data_type: LlmScoreDataType::Numeric,
                    source_type: LlmScoreDataSourceType::Annotation,
                    source_stream: Some("traces".to_string()),
                    _timestamp: 300,
                    ..LlmScoreRecord::default()
                }],
            }],
        };
        let value =
            serde_json::to_value(AnnotationQueueItemDetailResponseBody::from(detail)).unwrap();
        assert_eq!(value["item"]["refTraceStartTime"], 100);
        assert_eq!(value["sourceStream"], "traces");
        assert_eq!(value["content"]["input"]["question"], "hello");
        assert_eq!(value["machineScores"][0]["sourceType"], "llm_judge");
        assert_eq!(value["machineScores"][0]["valueNumeric"], 0.9);
        assert_eq!(value["reviews"][0]["submissionId"], "submission-1");
        assert_eq!(value["reviews"][0]["scores"][0]["valueNumeric"], 1.0);
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
