// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::collections::BTreeMap;

use openobserve_core::llm_evaluations::{
    datasets::{DatasetItemSource, DatasetSnapshotFilter},
    experiment_dispersion::{DimensionDispersion, RowDispersion},
    experiment_evidence::{ExperimentApplicabilityPreview, ExperimentScorerApplicabilityPreview},
    experiment_ingest::{
        ClientExecutionRecord, ClientExecutionStatus, ClientScore, PartError, PartResult,
        RecordBatch, RecordBatchResult,
    },
    experiment_results::{
        ExperimentAggregateSummary, ExperimentProgress, ExperimentResultScore,
        ExperimentResultScoreStatus, ExperimentResultSlot, ExperimentResultTaskStatus,
        ExperimentScoreSummary, ExperimentSkipSummary,
    },
    experiments::{
        CreateExperiment, CreateExperimentResult, Experiment, ExperimentPreview,
        ExperimentScorerRef, ExperimentSlot, ExperimentStatus, ExperimentTaskConfig,
        PinnedExperimentScorer, PromptMessage,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, ToSchema};

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatasetItemSourceBody {
    Trace,
    Annotation,
    Manual,
}

impl From<DatasetItemSourceBody> for DatasetItemSource {
    fn from(value: DatasetItemSourceBody) -> Self {
        match value {
            DatasetItemSourceBody::Trace => Self::Trace,
            DatasetItemSourceBody::Annotation => Self::Annotation,
            DatasetItemSourceBody::Manual => Self::Manual,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatasetSnapshotFilterBody {
    #[serde(default)]
    pub logical_ids: Vec<String>,
    #[serde(default)]
    pub sources: Vec<DatasetItemSourceBody>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
}

impl From<DatasetSnapshotFilterBody> for DatasetSnapshotFilter {
    fn from(value: DatasetSnapshotFilterBody) -> Self {
        Self {
            logical_ids: value.logical_ids,
            sources: value.sources.into_iter().map(Into::into).collect(),
            tags: value.tags,
            metadata: value.metadata,
        }
    }
}

impl From<DatasetSnapshotFilter> for DatasetSnapshotFilterBody {
    fn from(value: DatasetSnapshotFilter) -> Self {
        Self {
            logical_ids: value.logical_ids,
            sources: value
                .sources
                .into_iter()
                .map(|source| match source {
                    DatasetItemSource::Trace => DatasetItemSourceBody::Trace,
                    DatasetItemSource::Annotation => DatasetItemSourceBody::Annotation,
                    DatasetItemSource::Manual => DatasetItemSourceBody::Manual,
                })
                .collect(),
            tags: value.tags,
            metadata: value.metadata,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptMessageBody {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ExperimentTaskBody {
    InlinePrompt {
        messages: Vec<PromptMessageBody>,
        provider_id: String,
        #[serde(default)]
        model: Option<String>,
        #[serde(default)]
        params: Option<Value>,
    },
    Remote {
        #[serde(default)]
        config: Value,
    },
    Sdk {
        /// Immutable identity of the customer code under evaluation. Every
        /// execution record reported for this Experiment must repeat it.
        task_fingerprint: String,
        #[serde(default)]
        config: Value,
    },
}

impl From<ExperimentTaskBody> for ExperimentTaskConfig {
    fn from(value: ExperimentTaskBody) -> Self {
        match value {
            ExperimentTaskBody::InlinePrompt {
                messages,
                provider_id,
                model,
                params,
            } => Self::InlinePrompt {
                messages: messages
                    .into_iter()
                    .map(|message| PromptMessage {
                        role: message.role,
                        content: message.content,
                    })
                    .collect(),
                provider_id,
                model,
                params,
            },
            ExperimentTaskBody::Remote { config } => Self::Remote { config },
            ExperimentTaskBody::Sdk {
                task_fingerprint,
                config,
            } => Self::Sdk {
                task_fingerprint,
                config,
            },
        }
    }
}

impl From<ExperimentTaskConfig> for ExperimentTaskBody {
    fn from(value: ExperimentTaskConfig) -> Self {
        match value {
            ExperimentTaskConfig::InlinePrompt {
                messages,
                provider_id,
                model,
                params,
            } => Self::InlinePrompt {
                messages: messages
                    .into_iter()
                    .map(|message| PromptMessageBody {
                        role: message.role,
                        content: message.content,
                    })
                    .collect(),
                provider_id,
                model,
                params,
            },
            ExperimentTaskConfig::Remote { config } => Self::Remote { config },
            ExperimentTaskConfig::Sdk {
                task_fingerprint,
                config,
            } => Self::Sdk {
                task_fingerprint,
                config,
            },
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentScorerRefBody {
    pub id: String,
    #[serde(default)]
    pub version: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateExperimentRequestBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub dataset_id: String,
    pub dataset_version: i64,
    #[serde(default)]
    pub dataset_filter: Option<DatasetSnapshotFilterBody>,
    pub task: ExperimentTaskBody,
    pub scorers: Vec<ExperimentScorerRefBody>,
    pub trial_count: u32,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, ToSchema)]
pub struct CloneExperimentRequestBody {
    /// Optional name for the clone. Defaults to `<source name> (copy)`.
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RetryExperimentSlotRequestBody {
    /// Caller-generated key. Repeating the same request does not execute the slot again.
    pub idempotency_key: String,
}

impl From<CreateExperimentRequestBody> for CreateExperiment {
    fn from(value: CreateExperimentRequestBody) -> Self {
        Self {
            name: value.name,
            description: value.description,
            dataset_id: value.dataset_id,
            dataset_version: value.dataset_version,
            dataset_filter: value.dataset_filter.map(Into::into),
            task: value.task.into(),
            scorers: value
                .scorers
                .into_iter()
                .map(|scorer| ExperimentScorerRef {
                    id: scorer.id,
                    version: scorer.version,
                })
                .collect(),
            trial_count: value.trial_count,
            metadata: value.metadata,
            idempotency_key: value.idempotency_key,
        }
    }
}

/// One Slot result reported by the customer's own process.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientExecutionRecordBody {
    pub row_id: String,
    pub trial_index: u32,
    #[schema(value_type = String)]
    pub status: ClientExecutionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_attempt_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens_in: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens_out: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    /// Must repeat the Experiment's pinned `taskFingerprint`.
    pub task_fingerprint: String,
    /// Client-reported event time. Informational only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executed_at: Option<i64>,
}

/// One Score the customer's own code produced.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientScoreBody {
    pub row_id: String,
    pub trial_index: u32,
    /// Stable client-side identity for the local scorer that produced it.
    pub client_scorer_key: String,
    /// Score Config stable entity ID, or its name.
    pub score_config: String,
    pub value: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitExperimentRecordsRequestBody {
    #[serde(default)]
    pub records: Vec<ClientExecutionRecordBody>,
    #[serde(default)]
    pub scores: Vec<ClientScoreBody>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PartErrorBody {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PartResultBody {
    pub index: usize,
    pub row_id: String,
    pub trial_index: u32,
    pub accepted: bool,
    /// Accepted without writing: this part was already stored as submitted.
    pub duplicate: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<PartErrorBody>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubmitExperimentRecordsResponseBody {
    pub records: Vec<PartResultBody>,
    pub scores: Vec<PartResultBody>,
    pub accepted_records: usize,
    pub rejected_records: usize,
    pub accepted_scores: usize,
    pub rejected_scores: usize,
}

impl From<ClientExecutionRecordBody> for ClientExecutionRecord {
    fn from(value: ClientExecutionRecordBody) -> Self {
        Self {
            row_id: value.row_id,
            trial_index: value.trial_index,
            status: value.status,
            output: value.output,
            error_message: value.error_message,
            error_attempt_count: value.error_attempt_count,
            latency_ms: value.latency_ms,
            tokens_in: value.tokens_in,
            tokens_out: value.tokens_out,
            cost: value.cost,
            trace_id: value.trace_id,
            task_fingerprint: value.task_fingerprint,
            executed_at: value.executed_at,
        }
    }
}

impl From<ClientScoreBody> for ClientScore {
    fn from(value: ClientScoreBody) -> Self {
        Self {
            row_id: value.row_id,
            trial_index: value.trial_index,
            client_scorer_key: value.client_scorer_key,
            score_config: value.score_config,
            value: value.value,
            reasoning: value.reasoning,
            metadata: value.metadata,
        }
    }
}

impl From<SubmitExperimentRecordsRequestBody> for RecordBatch {
    fn from(value: SubmitExperimentRecordsRequestBody) -> Self {
        Self {
            records: value.records.into_iter().map(Into::into).collect(),
            scores: value.scores.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<PartError> for PartErrorBody {
    fn from(value: PartError) -> Self {
        Self {
            code: value.code.to_string(),
            message: value.message,
        }
    }
}

impl From<PartResult> for PartResultBody {
    fn from(value: PartResult) -> Self {
        Self {
            index: value.index,
            row_id: value.row_id,
            trial_index: value.trial_index,
            accepted: value.accepted,
            duplicate: value.duplicate,
            error: value.error.map(Into::into),
        }
    }
}

impl From<RecordBatchResult> for SubmitExperimentRecordsResponseBody {
    fn from(value: RecordBatchResult) -> Self {
        Self {
            records: value.records.into_iter().map(Into::into).collect(),
            scores: value.scores.into_iter().map(Into::into).collect(),
            accepted_records: value.accepted_records,
            rejected_records: value.rejected_records,
            accepted_scores: value.accepted_scores,
            rejected_scores: value.rejected_scores,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentPreviewQuery {
    pub sample_size: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentDetailQuery {
    pub sample_size: Option<usize>,
    pub result_page: Option<usize>,
    pub result_page_size: Option<usize>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PinnedExperimentScorerBody {
    pub id: String,
    pub version: i32,
}

impl From<PinnedExperimentScorer> for PinnedExperimentScorerBody {
    fn from(value: PinnedExperimentScorer) -> Self {
        Self {
            id: value.id,
            version: value.version,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentSlotBody {
    pub row_id: String,
    pub logical_id: String,
    pub trial_index: u32,
    pub input: Value,
    pub expected_output: Option<Value>,
}

impl From<ExperimentSlot> for ExperimentSlotBody {
    fn from(value: ExperimentSlot) -> Self {
        Self {
            row_id: value.row_id,
            logical_id: value.logical_id,
            trial_index: value.trial_index,
            input: value.input,
            expected_output: value.expected_output,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentPreviewResponseBody {
    pub dataset_id: String,
    pub dataset_version: i64,
    pub row_count: u64,
    pub trial_count: u32,
    pub slot_count: u64,
    pub pinned_scorers: Vec<PinnedExperimentScorerBody>,
    pub applicability: ExperimentApplicabilityPreviewBody,
    pub sample_slots: Vec<ExperimentSlotBody>,
}

#[derive(Clone, Debug, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentScorerApplicabilityBody {
    pub scorer_id: String,
    pub scorer_version: i32,
    pub eligible_row_count: u64,
    pub no_reference_row_count: u64,
    pub eligible_slot_count: u64,
    pub no_reference_slot_count: u64,
}

impl From<ExperimentScorerApplicabilityPreview> for ExperimentScorerApplicabilityBody {
    fn from(value: ExperimentScorerApplicabilityPreview) -> Self {
        Self {
            scorer_id: value.scorer_id,
            scorer_version: value.scorer_version,
            eligible_row_count: value.eligible_row_count,
            no_reference_row_count: value.no_reference_row_count,
            eligible_slot_count: value.eligible_slot_count,
            no_reference_slot_count: value.no_reference_slot_count,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentApplicabilityPreviewBody {
    pub fully_skipped_row_count: u64,
    pub partially_skipped_row_count: u64,
    pub fully_skipped_slot_count: u64,
    pub partially_skipped_slot_count: u64,
    pub eligible_task_slot_count: u64,
    pub eligible_scoring_dimension_count: u64,
    pub scorer_applicability: Vec<ExperimentScorerApplicabilityBody>,
}

impl From<ExperimentApplicabilityPreview> for ExperimentApplicabilityPreviewBody {
    fn from(value: ExperimentApplicabilityPreview) -> Self {
        Self {
            fully_skipped_row_count: value.fully_skipped_row_count,
            partially_skipped_row_count: value.partially_skipped_row_count,
            fully_skipped_slot_count: value.fully_skipped_slot_count,
            partially_skipped_slot_count: value.partially_skipped_slot_count,
            eligible_task_slot_count: value.eligible_task_slot_count,
            eligible_scoring_dimension_count: value.eligible_scoring_dimension_count,
            scorer_applicability: value
                .scorer_applicability
                .into_iter()
                .map(Into::into)
                .collect(),
        }
    }
}

impl From<ExperimentPreview> for ExperimentPreviewResponseBody {
    fn from(value: ExperimentPreview) -> Self {
        Self {
            dataset_id: value.dataset_id,
            dataset_version: value.dataset_version,
            row_count: value.row_count,
            trial_count: value.trial_count,
            slot_count: value.slot_count,
            pinned_scorers: value.pinned_scorers.into_iter().map(Into::into).collect(),
            applicability: value.applicability.into(),
            sample_slots: value.sample_slots.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentStatusBody {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl From<ExperimentStatus> for ExperimentStatusBody {
    fn from(value: ExperimentStatus) -> Self {
        match value {
            ExperimentStatus::Pending => Self::Pending,
            ExperimentStatus::Running => Self::Running,
            ExperimentStatus::Completed => Self::Completed,
            ExperimentStatus::Failed => Self::Failed,
            ExperimentStatus::Cancelled => Self::Cancelled,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentResponseBody {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub dataset_id: String,
    pub dataset_version: i64,
    pub dataset_filter: Option<DatasetSnapshotFilterBody>,
    pub task: ExperimentTaskBody,
    pub scorers: Vec<PinnedExperimentScorerBody>,
    pub trial_count: u32,
    pub metadata: Option<Value>,
    pub status: ExperimentStatusBody,
    pub status_reason: Option<String>,
    pub deadline_at: i64,
    pub completed_at: Option<i64>,
    pub lifecycle_version: i64,
    pub retry_count: u32,
    pub idempotency_key: Option<String>,
    pub created_by: String,
    pub created_at: i64,
}

impl From<Experiment> for ExperimentResponseBody {
    fn from(value: Experiment) -> Self {
        Self {
            id: value.id,
            org_id: value.org_id,
            name: value.name,
            description: value.description,
            dataset_id: value.dataset_id,
            dataset_version: value.dataset_version,
            dataset_filter: value.dataset_filter.map(Into::into),
            task: value.task.into(),
            scorers: value.scorers.into_iter().map(Into::into).collect(),
            trial_count: value.trial_count,
            metadata: value.metadata,
            status: value.status.into(),
            status_reason: value.status_reason,
            deadline_at: value.deadline_at,
            completed_at: value.completed_at,
            lifecycle_version: value.lifecycle_version,
            retry_count: value.retry_count,
            idempotency_key: value.idempotency_key,
            created_by: value.created_by,
            created_at: value.created_at,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentDetailResponseBody {
    pub experiment: ExperimentResponseBody,
    pub preview: ExperimentPreviewResponseBody,
    pub results: ExperimentResultsResponseBody,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRowDetailResponseBody {
    pub experiment_id: String,
    pub snapshot: ExperimentRowSnapshotBody,
    pub navigation: ExperimentRowNavigationBody,
    pub row_id: String,
    pub logical_id: String,
    pub input: Value,
    pub expected_output: Option<Value>,
    pub trials: Vec<ExperimentResultSlotBody>,
    pub score_summaries: Vec<ExperimentScoreSummaryBody>,
    /// Per-dimension trial dispersion for this case. Empty for a single-trial
    /// Experiment, which has no disagreement to report.
    pub dispersion: Vec<ExperimentDimensionDispersionBody>,
    /// Trial the drawer opens on: the one farthest from the mean or majority in
    /// this case's most dispersed dimension.
    pub outlier_trial_index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRowSnapshotBody {
    pub dataset_id: String,
    pub dataset_version: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRowNavigationBody {
    /// Zero-based position in deterministic pinned-snapshot row order.
    pub row_index: usize,
    pub total_rows: usize,
    pub previous_row_id: Option<String>,
    pub next_row_id: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, ToSchema)]
pub struct ExperimentResultsResponseBody {
    pub executions: Vec<Value>,
    pub scores: Vec<Value>,
    pub slots: Vec<ExperimentResultSlotBody>,
    pub pagination: ExperimentResultPaginationBody,
    pub task_progress: ExperimentProgressBody,
    pub scoring_progress: ExperimentProgressBody,
    pub skip_summary: ExperimentSkipSummaryBody,
    pub score_summaries: Vec<ExperimentScoreSummaryBody>,
    pub aggregate_summary: ExperimentAggregateSummaryBody,
    /// Trial dispersion for the cases on this page, always measured over the
    /// Experiment's full evidence so paging never splits a case's trials.
    pub row_dispersions: Vec<ExperimentRowDispersionBody>,
    pub dispersion_summary: ExperimentDispersionSummaryBody,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentDispersionSummaryBody {
    /// The "N cases unstable" card, counted over every pinned case.
    pub high_dispersion_row_count: u64,
    /// Normalized dispersion a case must exceed to be flagged.
    pub threshold: f64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentDimensionDispersionBody {
    pub scorer_id: String,
    pub scorer_version: i32,
    pub trial_count: u64,
    /// Type-aware consensus over the trials: a numeric mean, a majority
    /// boolean or category, or `mixed` when the largest shares tie.
    pub consensus: Value,
    /// Raw standard deviation in the dimension's own units, numeric only.
    pub raw_std: Option<f64>,
    /// Internal cross-dimension key in `[0, 1]`. Absent when the dimension
    /// declares no valid range, which also keeps it out of row flagging.
    pub normalized: Option<f64>,
    pub outlier_trial_index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRowDispersionBody {
    pub row_id: String,
    pub logical_id: String,
    pub dimensions: Vec<ExperimentDimensionDispersionBody>,
    /// Largest normalized dispersion across this case's dimensions. This is the
    /// key the result table flags and sorts by.
    pub max_normalized: Option<f64>,
    pub high: bool,
    pub outlier_trial_index: Option<u32>,
}

impl From<DimensionDispersion> for ExperimentDimensionDispersionBody {
    fn from(value: DimensionDispersion) -> Self {
        Self {
            scorer_id: value.scorer_id,
            scorer_version: value.scorer_version,
            trial_count: value.trial_count,
            consensus: serde_json::to_value(&value.dispersion.consensus)
                .unwrap_or(serde_json::Value::Null),
            raw_std: value.dispersion.raw_std,
            normalized: value.dispersion.normalized,
            outlier_trial_index: value.outlier_trial_index,
        }
    }
}

impl From<RowDispersion> for ExperimentRowDispersionBody {
    fn from(value: RowDispersion) -> Self {
        Self {
            row_id: value.row_id,
            logical_id: value.logical_id,
            dimensions: value.dimensions.into_iter().map(Into::into).collect(),
            max_normalized: value.max_normalized,
            high: value.high,
            outlier_trial_index: value.outlier_trial_index,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentResultPaginationBody {
    pub page: usize,
    pub page_size: usize,
    pub total_slots: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentResultSlotBody {
    pub row_id: String,
    pub logical_id: String,
    pub trial_index: u32,
    pub input: Value,
    pub expected_output: Option<Value>,
    pub task_status: ExperimentResultTaskStatusBody,
    pub execution: Option<Value>,
    pub scores: Vec<ExperimentResultScoreBody>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentResultScoreBody {
    pub scorer_id: String,
    pub scorer_version: i32,
    pub status: ExperimentResultScoreStatusBody,
    pub score: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentResultTaskStatusBody {
    Pending,
    InProgress,
    Ok,
    Skipped,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentResultScoreStatusBody {
    Pending,
    InProgress,
    Success,
    Skipped,
    Error,
}

#[derive(Clone, Debug, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentProgressBody {
    pub completed: u64,
    pub total: u64,
    pub skipped: u64,
}

#[derive(Clone, Debug, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentSkipSummaryBody {
    pub fully_skipped_slots: u64,
    pub partially_skipped_slots: u64,
    pub skipped_dimensions: u64,
    pub no_reference_dimensions: u64,
    pub no_trace_dimensions: u64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentScoreSummaryBody {
    pub scorer_id: String,
    pub scorer_version: i32,
    pub sample_count: u64,
    pub error_count: u64,
    pub pending_count: u64,
    pub no_reference_count: u64,
    pub no_trace_count: u64,
    pub skipped_count: u64,
    /// Type-aware aggregate: numeric mean, boolean counts, or categorical counts.
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentAggregateSummaryBody {
    pub p50_latency_ms: Option<u64>,
    pub total_cost: f64,
    pub incomplete: bool,
    pub incomplete_task_slots: u64,
    pub incomplete_score_dimensions: u64,
}

impl From<ExperimentResultTaskStatus> for ExperimentResultTaskStatusBody {
    fn from(value: ExperimentResultTaskStatus) -> Self {
        match value {
            ExperimentResultTaskStatus::Pending => Self::Pending,
            ExperimentResultTaskStatus::InProgress => Self::InProgress,
            ExperimentResultTaskStatus::Ok => Self::Ok,
            ExperimentResultTaskStatus::Skipped => Self::Skipped,
            ExperimentResultTaskStatus::Error => Self::Error,
        }
    }
}

impl From<ExperimentResultScoreStatus> for ExperimentResultScoreStatusBody {
    fn from(value: ExperimentResultScoreStatus) -> Self {
        match value {
            ExperimentResultScoreStatus::Pending => Self::Pending,
            ExperimentResultScoreStatus::InProgress => Self::InProgress,
            ExperimentResultScoreStatus::Success => Self::Success,
            ExperimentResultScoreStatus::Skipped => Self::Skipped,
            ExperimentResultScoreStatus::Error => Self::Error,
        }
    }
}

impl From<ExperimentResultScore> for ExperimentResultScoreBody {
    fn from(value: ExperimentResultScore) -> Self {
        Self {
            scorer_id: value.scorer_id,
            scorer_version: value.scorer_version,
            status: value.status.into(),
            score: value
                .score
                .and_then(|record| serde_json::to_value(record).ok()),
        }
    }
}

impl From<ExperimentResultSlot> for ExperimentResultSlotBody {
    fn from(value: ExperimentResultSlot) -> Self {
        Self {
            row_id: value.row_id,
            logical_id: value.logical_id,
            trial_index: value.trial_index,
            input: value.input,
            expected_output: value.expected_output,
            task_status: value.task_status.into(),
            execution: value
                .execution
                .and_then(|record| serde_json::to_value(record).ok()),
            scores: value.scores.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<ExperimentProgress> for ExperimentProgressBody {
    fn from(value: ExperimentProgress) -> Self {
        Self {
            completed: value.completed,
            total: value.total,
            skipped: value.skipped,
        }
    }
}

impl From<ExperimentSkipSummary> for ExperimentSkipSummaryBody {
    fn from(value: ExperimentSkipSummary) -> Self {
        Self {
            fully_skipped_slots: value.fully_skipped_slots,
            partially_skipped_slots: value.partially_skipped_slots,
            skipped_dimensions: value.skipped_dimensions,
            no_reference_dimensions: value.no_reference_dimensions,
            no_trace_dimensions: value.no_trace_dimensions,
        }
    }
}

impl From<ExperimentScoreSummary> for ExperimentScoreSummaryBody {
    fn from(value: ExperimentScoreSummary) -> Self {
        Self {
            scorer_id: value.scorer_id,
            scorer_version: value.scorer_version,
            sample_count: value.sample_count,
            error_count: value.error_count,
            pending_count: value.pending_count,
            no_reference_count: value.no_reference_count,
            no_trace_count: value.no_trace_count,
            skipped_count: value.skipped_count,
            value: value.value,
        }
    }
}

impl From<ExperimentAggregateSummary> for ExperimentAggregateSummaryBody {
    fn from(value: ExperimentAggregateSummary) -> Self {
        Self {
            p50_latency_ms: value.p50_latency_ms,
            total_cost: value.total_cost,
            incomplete: value.incomplete,
            incomplete_task_slots: value.incomplete_task_slots,
            incomplete_score_dimensions: value.incomplete_score_dimensions,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateExperimentResponseBody {
    pub experiment: ExperimentResponseBody,
    pub preview: ExperimentPreviewResponseBody,
    pub created: bool,
}

impl From<CreateExperimentResult> for CreateExperimentResponseBody {
    fn from(value: CreateExperimentResult) -> Self {
        Self {
            experiment: value.experiment.into(),
            preview: value.preview.into(),
            created: value.created,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListExperimentsResponseBody {
    pub list: Vec<ExperimentResponseBody>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_contract_reserves_discriminated_task_variants() {
        for kind in ["inline_prompt", "remote", "sdk"] {
            let task = match kind {
                "inline_prompt" => serde_json::json!({
                    "type": kind,
                    "messages": [{"role": "user", "content": "{{ input }}"}],
                    "providerId": "provider-1"
                }),
                _ => serde_json::json!({"type": kind, "config": {}}),
            };
            let body: CreateExperimentRequestBody = serde_json::from_value(serde_json::json!({
                "name": "Experiment",
                "datasetId": "dataset-1",
                "datasetVersion": 3,
                "task": task,
                "scorers": [{"id": "scorer-1", "version": 2}],
                "trialCount": 2
            }))
            .unwrap();
            assert_eq!(body.dataset_version, 3);
        }
    }

    #[test]
    fn result_status_enums_serialize_only_the_public_lifecycle_vocabulary() {
        assert_eq!(
            serde_json::to_value(ExperimentResultTaskStatusBody::InProgress).unwrap(),
            serde_json::json!("in_progress")
        );
        assert_eq!(
            serde_json::to_value(ExperimentResultScoreStatusBody::Success).unwrap(),
            serde_json::json!("success")
        );
        assert!(
            serde_json::from_value::<ExperimentResultTaskStatusBody>(serde_json::json!("other"))
                .is_err()
        );
    }
}
