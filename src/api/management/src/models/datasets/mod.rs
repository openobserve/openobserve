// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Dataset Item write surfaces for LLM Observability 2.5a.
//!
//! The HTTP layer exposes three endpoints so every caller can provide only the
//! provenance it legitimately owns:
//!
//! - `POST /{org_id}/datasets/{dataset_id}/items` for manual or direct trace/span entry.
//! - `POST /{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}/push_to_dataset` for
//!   explicit queue adjudication; the target Dataset and telemetry input are resolved server-side
//!   from the Queue Item.
//! - `POST /{org_id}/datasets/{dataset_id}/items/import` for multipart CSV import; malformed rows
//!   are skipped and summarized.
//!
//! Stored source, logical/physical IDs, MVCC versions, actors, timestamps, and
//! queue provenance are server-owned on every entry path.

use openobserve_core::llm_evaluations::datasets::{CreateDataset, Dataset, UpdateDataset};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateDatasetRequestBody {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateDatasetRequestBody {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatasetResponseBody {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub global_version: i64,
    pub created_by: String,
    pub created_at: i64,
    pub updated_by: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListDatasetsResponseBody {
    pub list: Vec<DatasetResponseBody>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryDatasetItemRefType {
    Trace,
    Span,
}

#[derive(Clone, Debug, Deserialize, PartialEq, ToSchema)]
#[serde(tag = "entryPoint", rename_all = "snake_case", deny_unknown_fields)]
pub enum PushDatasetItemRequestBody {
    /// Add a user-authored golden directly from the Dataset detail page.
    Manual {
        input: Value,
        #[serde(rename = "expectedOutput")]
        expected_output: Value,
        #[serde(default)]
        metadata: Option<Value>,
        #[serde(default)]
        tags: Vec<String>,
    },
    /// Add a trace/span golden from telemetry detail. The service retrieves and
    /// purifies the business input using this immutable reference.
    Telemetry {
        #[serde(rename = "refType")]
        ref_type: TelemetryDatasetItemRefType,
        #[serde(rename = "refId")]
        ref_id: String,
        #[serde(rename = "expectedOutput")]
        expected_output: Value,
        #[serde(default)]
        metadata: Option<Value>,
        #[serde(default)]
        tags: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushAnnotationQueueItemToDatasetRequestBody {
    /// Logical `_llm_scores` N/N submission selected as adjudication evidence.
    pub review_submission_id: String,
    /// Explicit human-finalized golden; never inferred from an ordinary score.
    pub expected_output: Value,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatasetItemSourceResponseBody {
    Trace,
    Annotation,
    Manual,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatasetItemResponseBody {
    pub row_id: String,
    pub logical_id: String,
    pub org_id: String,
    pub dataset_id: String,
    pub input: Value,
    pub expected_output: Value,
    pub global_version: i64,
    pub is_deleted: bool,
    pub source: DatasetItemSourceResponseBody,
    pub source_ref: Option<String>,
    pub source_span_id: Option<String>,
    pub metadata: Option<Value>,
    pub tags: Vec<String>,
    pub queue_id: Option<String>,
    pub review_submission_id: Option<String>,
    pub adjudicated_by: Option<String>,
    pub adjudicated_at: Option<i64>,
    pub import_filename: Option<String>,
    pub updated_by: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PushDatasetItemResponseBody {
    /// False when an idempotent trace/annotation push returns the existing item.
    pub created: bool,
    pub item: DatasetItemResponseBody,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportDatasetItemsResponseBody {
    pub filename: String,
    pub imported_count: u64,
    pub skipped_count: u64,
}

impl From<CreateDatasetRequestBody> for CreateDataset {
    fn from(value: CreateDatasetRequestBody) -> Self {
        Self {
            name: value.name,
            description: value.description,
        }
    }
}

impl From<UpdateDatasetRequestBody> for UpdateDataset {
    fn from(value: UpdateDatasetRequestBody) -> Self {
        Self {
            name: value.name,
            description: value.description,
        }
    }
}

impl From<Dataset> for DatasetResponseBody {
    fn from(value: Dataset) -> Self {
        Self {
            id: value.id,
            org_id: value.org_id,
            name: value.name,
            description: value.description,
            global_version: value.global_version,
            created_by: value.created_by,
            created_at: value.created_at,
            updated_by: value.updated_by,
            updated_at: value.updated_at,
        }
    }
}

impl From<Vec<Dataset>> for ListDatasetsResponseBody {
    fn from(value: Vec<Dataset>) -> Self {
        Self {
            list: value.into_iter().map(DatasetResponseBody::from).collect(),
        }
    }
}

#[cfg(test)]
mod dataset_item_contract_tests {
    use super::*;

    #[test]
    fn manual_entry_accepts_only_user_owned_golden_fields() {
        let body: PushDatasetItemRequestBody = serde_json::from_value(serde_json::json!({
            "entryPoint": "manual",
            "input": {"question": "What is the refund window?"},
            "expectedOutput": "Thirty days",
            "tags": ["refund"]
        }))
        .unwrap();
        assert!(matches!(
            body,
            PushDatasetItemRequestBody::Manual { tags, .. } if tags == ["refund"]
        ));

        let spoofed: Result<PushDatasetItemRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "entryPoint": "manual",
                "input": "question",
                "expectedOutput": "answer",
                "source": "annotation"
            }));
        assert!(spoofed.is_err());
    }

    #[test]
    fn telemetry_entry_supports_trace_and_span_but_not_session() {
        let trace: PushDatasetItemRequestBody = serde_json::from_value(serde_json::json!({
            "entryPoint": "telemetry",
            "refType": "trace",
            "refId": "trace-1",
            "expectedOutput": "corrected answer"
        }))
        .unwrap();
        assert!(matches!(
            trace,
            PushDatasetItemRequestBody::Telemetry {
                ref_type: TelemetryDatasetItemRefType::Trace,
                ..
            }
        ));

        let session: Result<PushDatasetItemRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "entryPoint": "telemetry",
                "refType": "session",
                "refId": "session-1",
                "expectedOutput": "not supported"
            }));
        assert!(session.is_err());

        let duplicated_trace_id: Result<PushDatasetItemRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "entryPoint": "telemetry",
                "refType": "trace",
                "refId": "trace-1",
                "refTraceId": "trace-1",
                "expectedOutput": "corrected answer"
            }));
        assert!(duplicated_trace_id.is_err());
    }

    #[test]
    fn queue_entry_exposes_adjudication_choice_but_not_provenance() {
        let body: PushAnnotationQueueItemToDatasetRequestBody =
            serde_json::from_value(serde_json::json!({
                "reviewSubmissionId": "submission-1",
                "expectedOutput": {"answer": "final"},
                "metadata": {"difficulty": "hard"}
            }))
            .unwrap();
        assert_eq!(body.review_submission_id, "submission-1");

        let spoofed: Result<PushAnnotationQueueItemToDatasetRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "reviewSubmissionId": "submission-1",
                "expectedOutput": "final",
                "queueId": "other-queue"
            }));
        assert!(spoofed.is_err());
    }
}
