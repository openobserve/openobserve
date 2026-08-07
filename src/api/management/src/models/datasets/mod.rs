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
//! - `GET /{org_id}/datasets/{dataset_id}/items/{item_id}` for the complete immutable version
//!   history of one logical Dataset Item.
//! - `POST /{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}/push_to_dataset` for
//!   explicit queue adjudication; the caller selects the target Dataset while telemetry input is
//!   resolved server-side from the Queue Item.
//! - `POST /{org_id}/datasets/{dataset_id}/items/import` for multipart CSV import; malformed rows
//!   are skipped and summarized.
//!
//! Stored source, logical/physical IDs, MVCC versions, actors, timestamps, and
//! queue provenance are server-owned on every entry path.

use openobserve_core::llm_evaluations::datasets::{
    CreateDataset, CreateDatasetItem, Dataset, DatasetItem, DatasetItemPage, DatasetItemSource,
    ListDatasetItems, PushDatasetItemResult, PushQueueItemToDataset,
    TelemetryDatasetItemRefType as ServiceRefType, UpdateDataset, UpdateDatasetItem,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, ToSchema};

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateDatasetRequestBody {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateDatasetRequestBody {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatasetResponseBody {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
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

#[derive(Clone, Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct ListDatasetItemsQuery {
    /// Include the latest tombstone for deleted logical items. Defaults to false.
    #[serde(rename = "includeDeleted", alias = "include_deleted")]
    pub include_deleted: Option<bool>,
    /// Zero-based result offset. Defaults to 0.
    pub from: Option<usize>,
    /// Page size from 1 through 100. Defaults to 20.
    pub size: Option<usize>,
}

impl From<ListDatasetItemsQuery> for ListDatasetItems {
    fn from(value: ListDatasetItemsQuery) -> Self {
        let defaults = ListDatasetItems::default();
        Self {
            include_deleted: value.include_deleted.unwrap_or(defaults.include_deleted),
            from: value.from.unwrap_or(defaults.from),
            size: value.size.unwrap_or(defaults.size),
        }
    }
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
        /// Trace stream containing the immutable reference.
        #[serde(rename = "sourceStream")]
        source_stream: String,
        /// Positive microsecond lower bound used to retrieve the reference.
        #[serde(rename = "refTraceStartTime")]
        ref_trace_start_time: i64,
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
pub struct UpdateDatasetItemRequestBody {
    pub input: Value,
    pub expected_output: Value,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushAnnotationQueueItemToDatasetRequestBody {
    /// User-selected destination Dataset.
    pub dataset_id: String,
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
pub struct DatasetItemVersionsResponseBody {
    pub list: Vec<DatasetItemResponseBody>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListDatasetItemsResponseBody {
    pub list: Vec<DatasetItemResponseBody>,
    pub total: u64,
    pub from: usize,
    pub size: usize,
    pub has_more: bool,
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
            tags: value.tags,
        }
    }
}

impl From<UpdateDatasetRequestBody> for UpdateDataset {
    fn from(value: UpdateDatasetRequestBody) -> Self {
        Self {
            name: value.name,
            description: value.description,
            tags: value.tags,
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
            tags: value.tags,
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

impl From<TelemetryDatasetItemRefType> for ServiceRefType {
    fn from(value: TelemetryDatasetItemRefType) -> Self {
        match value {
            TelemetryDatasetItemRefType::Trace => Self::Trace,
            TelemetryDatasetItemRefType::Span => Self::Span,
        }
    }
}

impl From<PushDatasetItemRequestBody> for CreateDatasetItem {
    fn from(value: PushDatasetItemRequestBody) -> Self {
        match value {
            PushDatasetItemRequestBody::Manual {
                input,
                expected_output,
                metadata,
                tags,
            } => Self::Manual {
                input,
                expected_output,
                metadata,
                tags,
            },
            PushDatasetItemRequestBody::Telemetry {
                ref_type,
                ref_id,
                source_stream,
                ref_trace_start_time,
                expected_output,
                metadata,
                tags,
            } => Self::Telemetry {
                ref_type: ref_type.into(),
                ref_id,
                source_stream,
                ref_trace_start_time,
                expected_output,
                metadata,
                tags,
            },
        }
    }
}

impl From<UpdateDatasetItemRequestBody> for UpdateDatasetItem {
    fn from(value: UpdateDatasetItemRequestBody) -> Self {
        Self {
            input: value.input,
            expected_output: value.expected_output,
            metadata: value.metadata,
            tags: value.tags,
        }
    }
}

impl From<PushAnnotationQueueItemToDatasetRequestBody> for PushQueueItemToDataset {
    fn from(value: PushAnnotationQueueItemToDatasetRequestBody) -> Self {
        Self {
            dataset_id: value.dataset_id,
            review_submission_id: value.review_submission_id,
            expected_output: value.expected_output,
            metadata: value.metadata,
            tags: value.tags,
        }
    }
}

impl From<DatasetItemSource> for DatasetItemSourceResponseBody {
    fn from(value: DatasetItemSource) -> Self {
        match value {
            DatasetItemSource::Trace => Self::Trace,
            DatasetItemSource::Annotation => Self::Annotation,
            DatasetItemSource::Manual => Self::Manual,
        }
    }
}

impl From<DatasetItem> for DatasetItemResponseBody {
    fn from(value: DatasetItem) -> Self {
        Self {
            row_id: value.row_id,
            logical_id: value.logical_id,
            org_id: value.org_id,
            dataset_id: value.dataset_id,
            input: value.input,
            expected_output: value.expected_output,
            global_version: value.global_version,
            is_deleted: value.is_deleted,
            source: value.source.into(),
            source_ref: value.source_ref,
            source_span_id: value.source_span_id,
            metadata: value.metadata,
            tags: value.tags,
            queue_id: value.queue_id,
            review_submission_id: value.review_submission_id,
            adjudicated_by: value.adjudicated_by,
            adjudicated_at: value.adjudicated_at,
            import_filename: value.import_filename,
            updated_by: value.updated_by,
            updated_at: value.updated_at,
        }
    }
}

impl From<Vec<DatasetItem>> for DatasetItemVersionsResponseBody {
    fn from(value: Vec<DatasetItem>) -> Self {
        Self {
            list: value
                .into_iter()
                .map(DatasetItemResponseBody::from)
                .collect(),
        }
    }
}

impl From<DatasetItemPage> for ListDatasetItemsResponseBody {
    fn from(value: DatasetItemPage) -> Self {
        Self {
            list: value
                .items
                .into_iter()
                .map(DatasetItemResponseBody::from)
                .collect(),
            total: value.total,
            from: value.from,
            size: value.size,
            has_more: value.has_more,
        }
    }
}

impl From<PushDatasetItemResult> for PushDatasetItemResponseBody {
    fn from(value: PushDatasetItemResult) -> Self {
        Self {
            created: value.created,
            item: value.item.into(),
        }
    }
}

#[cfg(test)]
mod dataset_item_contract_tests {
    use super::*;

    #[test]
    fn dataset_metadata_accepts_tags_and_defaults_them_when_omitted() {
        let create: CreateDatasetRequestBody = serde_json::from_value(serde_json::json!({
            "name": "Golden set",
            "description": "Regression cases",
            "tags": ["production", "rag"]
        }))
        .unwrap();
        let command: CreateDataset = create.into();
        assert_eq!(command.tags, ["production", "rag"]);

        let update: UpdateDatasetRequestBody = serde_json::from_value(serde_json::json!({
            "name": "Golden set",
            "description": null
        }))
        .unwrap();
        let command: UpdateDataset = update.into();
        assert!(command.tags.is_empty());
    }

    #[test]
    fn list_query_defaults_to_live_current_items() {
        let request: ListDatasetItems = ListDatasetItemsQuery::default().into();
        assert!(!request.include_deleted);
        assert_eq!(request.from, 0);
        assert_eq!(request.size, 20);

        let request: ListDatasetItems = serde_json::from_value::<ListDatasetItemsQuery>(
            serde_json::json!({"includeDeleted": true, "from": 20, "size": 50}),
        )
        .unwrap()
        .into();
        assert!(request.include_deleted);
        assert_eq!(request.from, 20);
        assert_eq!(request.size, 50);
    }

    #[test]
    fn update_accepts_only_replaceable_item_fields() {
        let body: UpdateDatasetItemRequestBody = serde_json::from_value(serde_json::json!({
            "input": "question",
            "expectedOutput": "answer",
            "metadata": {"difficulty": "hard"},
            "tags": ["regression"]
        }))
        .unwrap();
        let command: UpdateDatasetItem = body.into();
        assert_eq!(command.expected_output, "answer");

        let spoofed: Result<UpdateDatasetItemRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "input": "question",
                "expectedOutput": "answer",
                "source": "manual"
            }));
        assert!(spoofed.is_err());
    }

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
            "sourceStream": "default",
            "refTraceStartTime": 1,
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
                "sourceStream": "default",
                "refTraceStartTime": 1,
                "expectedOutput": "not supported"
            }));
        assert!(session.is_err());

        let duplicated_trace_id: Result<PushDatasetItemRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "entryPoint": "telemetry",
                "refType": "trace",
                "refId": "trace-1",
                "sourceStream": "default",
                "refTraceStartTime": 1,
                "refTraceId": "trace-1",
                "expectedOutput": "corrected answer"
            }));
        assert!(duplicated_trace_id.is_err());
    }

    #[test]
    fn queue_entry_exposes_destination_and_adjudication_choice_but_not_provenance() {
        let body: PushAnnotationQueueItemToDatasetRequestBody =
            serde_json::from_value(serde_json::json!({
                "datasetId": "dataset-1",
                "reviewSubmissionId": "submission-1",
                "expectedOutput": {"answer": "final"},
                "metadata": {"difficulty": "hard"}
            }))
            .unwrap();
        assert_eq!(body.dataset_id, "dataset-1");
        assert_eq!(body.review_submission_id, "submission-1");

        let service_input: PushQueueItemToDataset = body.into();
        assert_eq!(service_input.dataset_id, "dataset-1");

        let spoofed: Result<PushAnnotationQueueItemToDatasetRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "datasetId": "dataset-1",
                "reviewSubmissionId": "submission-1",
                "expectedOutput": "final",
                "queueId": "other-queue"
            }));
        assert!(spoofed.is_err());

        let missing_dataset: Result<PushAnnotationQueueItemToDatasetRequestBody, _> =
            serde_json::from_value(serde_json::json!({
                "reviewSubmissionId": "submission-1",
                "expectedOutput": "final"
            }));
        assert!(missing_dataset.is_err());
    }
}
