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

use std::collections::BTreeMap;

use openobserve_core::llm_evaluations::{
    datasets::{DatasetItemSource, DatasetSnapshotFilter},
    experiment_cost::ExperimentCostEstimate,
    experiment_dispersion::{DimensionDispersion, RowDispersion},
    experiment_evidence::{ExperimentApplicabilityPreview, ExperimentScorerApplicabilityPreview},
    experiment_ingest::{
        ClientExecutionRecord, ClientExecutionStatus, ClientScore, PartError, PartResult,
        RecordBatch, RecordBatchResult,
    },
    experiment_results::{
        ExperimentAggregateSummary, ExperimentClientScoreSummary, ExperimentProgress,
        ExperimentResultScore, ExperimentResultScoreStatus, ExperimentResultSlot,
        ExperimentResultTaskStatus, ExperimentScoreSummary, ExperimentSkipSummary,
        ExperimentSlotStatus, ScoringStatus,
    },
    experiments::{
        CloneExperimentOverrides, CreateExperiment, CreateExperimentResult, Experiment,
        ExperimentPreview, ExperimentScorerRef, ExperimentSlot, ExperimentSlotPage,
        ExperimentStatus, ExperimentTaskConfig, PinnedExperimentScorer, PromptMessage,
        RemoteTaskOverrides,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentResultRowSortBody {
    #[default]
    Dataset,
    DispersionDesc,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentResultRowPageQuery {
    pub page: Option<usize>,
    pub page_size: Option<usize>,
    pub sort: Option<ExperimentResultRowSortBody>,
    pub high_dispersion_only: Option<bool>,
}

/// One pinned Dataset case with every trial reduced to list-surface aggregates.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentResultRowBody {
    /// Zero-based position in deterministic pinned-snapshot row order.
    pub row_index: usize,
    pub row_id: String,
    pub logical_id: String,
    pub input: Value,
    pub expected_output: Option<Value>,
    pub trial_count: usize,
    pub status: ExperimentSlotStatusBody,
    /// Present only for a single-trial row; multi-trial outputs belong in drill-down.
    pub output: Option<Value>,
    pub score_summaries: Vec<ExperimentScoreSummaryBody>,
    pub p50_latency_ms: Option<u64>,
    pub dispersion: Option<ExperimentRowDispersionBody>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentResultRowPaginationBody {
    pub page: usize,
    pub page_size: usize,
    pub total_rows: usize,
    pub has_more: bool,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentResultRowPageResponseBody {
    pub rows: Vec<ExperimentResultRowBody>,
    pub pagination: ExperimentResultRowPaginationBody,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatasetItemSourceBody {
    Trace,
    Annotation,
    Manual,
    Playground,
}

impl From<DatasetItemSourceBody> for DatasetItemSource {
    fn from(value: DatasetItemSourceBody) -> Self {
        match value {
            DatasetItemSourceBody::Trace => Self::Trace,
            DatasetItemSourceBody::Annotation => Self::Annotation,
            DatasetItemSourceBody::Manual => Self::Manual,
            DatasetItemSourceBody::Playground => Self::Playground,
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
                    DatasetItemSource::Playground => DatasetItemSourceBody::Playground,
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
        /// Pinned `name@version` of a published Remote Task. Never latest.
        task_ref: String,
        #[serde(default)]
        overrides: Option<RemoteTaskOverridesBody>,
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
            ExperimentTaskBody::Remote {
                task_ref,
                overrides,
            } => Self::Remote {
                task_ref,
                overrides: overrides.map(Into::into),
            },
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
            ExperimentTaskConfig::Remote {
                task_ref,
                overrides,
            } => Self::Remote {
                task_ref,
                overrides: overrides.map(Into::into),
            },
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

/// The two runtime overrides an Experiment may set on a registered Remote Task.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteTaskOverridesBody {
    #[serde(default)]
    pub max_concurrency: Option<u32>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

impl From<RemoteTaskOverridesBody> for RemoteTaskOverrides {
    fn from(value: RemoteTaskOverridesBody) -> Self {
        Self {
            max_concurrency: value.max_concurrency,
            timeout_ms: value.timeout_ms,
        }
    }
}

impl From<RemoteTaskOverrides> for RemoteTaskOverridesBody {
    fn from(value: RemoteTaskOverrides) -> Self {
        Self {
            max_concurrency: value.max_concurrency,
            timeout_ms: value.timeout_ms,
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
    /// Trials per Dataset Case. Omitted means one, which is the contract's
    /// default and the only value a caller who has not thought about
    /// dispersion should get.
    #[serde(default = "default_trial_count")]
    pub trial_count: u32,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
    /// Acknowledges a cost estimate above the organization's warning
    /// threshold. Without it, such a request is refused with `412`.
    #[serde(default)]
    pub confirm_cost_estimate: bool,
}

const fn default_trial_count() -> u32 {
    1
}

/// Deserializer that keeps "absent" and "explicit null" apart for an
/// `Option<Option<T>>` field.
///
/// Serde collapses both to `None` otherwise, which on a clone would make
/// "inherit the source's value" and "clear it" the same request.
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

/// Every pin a clone may change, in the same shape the create body uses.
///
/// A clone inherits its source's definition, so every field is optional: an
/// absent one keeps what the source pinned, and an empty body is still a
/// verbatim copy. `description`, `datasetFilter` and `metadata` are nullable on
/// an Experiment, so an explicit `null` clears them rather than meaning
/// "absent".
#[derive(Debug, Clone, Default, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloneExperimentRequestBody {
    /// Defaults to `<source name> (copy)`.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[schema(value_type = Option<String>)]
    pub description: Option<Option<String>>,
    #[serde(default)]
    pub dataset_id: Option<String>,
    #[serde(default)]
    pub dataset_version: Option<i64>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[schema(value_type = Option<DatasetSnapshotFilterBody>)]
    pub dataset_filter: Option<Option<DatasetSnapshotFilterBody>>,
    #[serde(default)]
    pub task: Option<ExperimentTaskBody>,
    #[serde(default)]
    pub scorers: Option<Vec<ExperimentScorerRefBody>>,
    /// Trials per Dataset Case, between 1 and the configured maximum.
    #[serde(default)]
    pub trial_count: Option<u32>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[schema(value_type = Option<Value>)]
    pub metadata: Option<Option<Value>>,
    /// Makes a retried clone replay its first result instead of running the
    /// Experiment a second time.
    #[serde(default)]
    pub idempotency_key: Option<String>,
    /// Acknowledges a cost estimate above the organization's warning
    /// threshold. Without it, such a request is refused with `412`.
    #[serde(default)]
    pub confirm_cost_estimate: bool,
}

impl From<CloneExperimentRequestBody> for CloneExperimentOverrides {
    fn from(value: CloneExperimentRequestBody) -> Self {
        Self {
            name: value.name,
            description: value.description,
            dataset_id: value.dataset_id,
            dataset_version: value.dataset_version,
            dataset_filter: value.dataset_filter.map(|filter| filter.map(Into::into)),
            task: value.task.map(Into::into),
            scorers: value.scorers.map(|scorers| {
                scorers
                    .into_iter()
                    .map(|scorer| ExperimentScorerRef {
                        id: scorer.id,
                        version: scorer.version,
                    })
                    .collect()
            }),
            trial_count: value.trial_count,
            metadata: value.metadata,
            idempotency_key: value.idempotency_key,
            confirm_cost_estimate: value.confirm_cost_estimate,
        }
    }
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
            confirm_cost_estimate: value.confirm_cost_estimate,
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
    /// Free-text reason a Task gave for declining the Slot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_message: Option<String>,
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
            skip_message: value.skip_message,
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
    /// Dataset Case metadata, so a client-side Task can branch on it without a
    /// second read of the Dataset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentSlotPageQuery {
    pub from: Option<usize>,
    pub size: Option<usize>,
}

/// One page of the immutable Slot set, in pinned cohort order.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentSlotPageResponseBody {
    pub slots: Vec<ExperimentSlotBody>,
    pub total: u64,
    pub from: usize,
    pub size: usize,
    pub has_more: bool,
}

impl From<ExperimentSlotPage> for ExperimentSlotPageResponseBody {
    fn from(value: ExperimentSlotPage) -> Self {
        Self {
            slots: value
                .slots
                .into_iter()
                .map(ExperimentSlotBody::from)
                .collect(),
            total: value.total,
            from: value.from,
            size: value.size,
            has_more: value.has_more,
        }
    }
}

impl From<ExperimentSlot> for ExperimentSlotBody {
    fn from(value: ExperimentSlot) -> Self {
        Self {
            row_id: value.row_id,
            logical_id: value.logical_id,
            trial_index: value.trial_index,
            input: value.input,
            expected_output: value.expected_output,
            metadata: value.metadata,
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
    /// Order-of-magnitude cost of running this plan, and whether creating it
    /// requires `confirmCostEstimate`.
    pub cost_estimate: Option<ExperimentCostEstimateBody>,
}

/// One priced call shape in the estimate: a pinned Scorer, or the Task itself
/// when the platform is the one calling a model.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentCostDimensionBody {
    pub scorer_id: Option<String>,
    pub scorer_version: Option<i32>,
    pub model: Option<String>,
    pub call_count: u64,
    pub input_tokens_per_call: i64,
    pub output_tokens_per_call: i64,
    /// Absent when no price is known for this model.
    pub estimated_cost: Option<f64>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentCostEstimateBody {
    pub slot_count: u64,
    pub currency: String,
    pub dimensions: Vec<ExperimentCostDimensionBody>,
    /// Sum of the dimensions that could be priced. Absent when none could.
    pub estimated_cost: Option<f64>,
    /// Whether the Task side is included. `false` for Remote and SDK Tasks,
    /// which run in the customer's own environment.
    pub task_cost_estimated: bool,
    /// At least one dimension had no known price, so the total is a floor.
    pub incomplete: bool,
    pub warning_threshold: f64,
    /// Creation of this plan requires `confirmCostEstimate: true`.
    pub confirmation_required: bool,
}

impl From<ExperimentCostEstimate> for ExperimentCostEstimateBody {
    fn from(value: ExperimentCostEstimate) -> Self {
        Self {
            slot_count: value.slot_count,
            currency: value.currency.to_string(),
            dimensions: value
                .dimensions
                .into_iter()
                .map(|dimension| ExperimentCostDimensionBody {
                    scorer_id: dimension.scorer_id,
                    scorer_version: dimension.scorer_version,
                    model: dimension.model,
                    call_count: dimension.call_count,
                    input_tokens_per_call: dimension.input_tokens_per_call,
                    output_tokens_per_call: dimension.output_tokens_per_call,
                    estimated_cost: dimension.estimated_cost,
                })
                .collect(),
            estimated_cost: value.estimated_cost,
            task_cost_estimated: value.task_cost_estimated,
            incomplete: value.incomplete,
            warning_threshold: value.warning_threshold,
            confirmation_required: value.confirmation_required,
        }
    }
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
    /// Every pinned Slot, which is what Task progress counts against: a Slot
    /// runs whether or not a Scorer can judge it.
    pub total_slot_count: u64,
    /// Slots with at least one applicable Score Dimension — a scoring-side
    /// figure for the applicability preview, not a Task denominator.
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
            total_slot_count: value.total_slot_count,
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
            cost_estimate: value.cost_estimate.map(Into::into),
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
    /// Resolved from the Dataset the experiment pinned, so callers do not have
    /// to fetch the Dataset list just to label a run. None when it was deleted.
    pub dataset_name: Option<String>,
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
    /// The organization's Baseline for this Dataset. At most one Experiment per
    /// organization and Dataset carries it.
    pub is_baseline: bool,
    pub created_by: String,
    pub created_at: i64,
}

impl ExperimentResponseBody {
    /// The conversion is sync, so the Dataset name is filled in by the handler
    /// that has already loaded it.
    pub fn with_dataset_name(mut self, dataset_name: Option<String>) -> Self {
        self.dataset_name = dataset_name;
        self
    }
}

impl From<Experiment> for ExperimentResponseBody {
    fn from(value: Experiment) -> Self {
        Self {
            id: value.id,
            org_id: value.org_id,
            name: value.name,
            description: value.description,
            dataset_id: value.dataset_id,
            dataset_name: None,
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
            is_baseline: value.is_baseline,
            created_by: value.created_by,
            created_at: value.created_at,
        }
    }
}

/// The result of a Baseline change, naming both ends of the move.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentBaselineResponseBody {
    pub experiment: ExperimentResponseBody,
    /// The Experiment that held the Baseline before this call, if any. `None`
    /// means the Dataset had no Baseline; the service never selects a
    /// replacement on its own.
    pub previous_baseline_id: Option<String>,
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
    /// Per-case aggregate of the dimensions the customer's own code reported,
    /// kept separate from Scorer summaries because the two are not comparable.
    pub client_score_summaries: Vec<ExperimentClientScoreSummaryBody>,
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
#[serde(rename_all = "camelCase")]
pub struct ExperimentResultsResponseBody {
    pub executions: Vec<Value>,
    pub scores: Vec<Value>,
    pub slots: Vec<ExperimentResultSlotBody>,
    pub pagination: ExperimentResultPaginationBody,
    pub task_progress: ExperimentProgressBody,
    pub scoring_progress: ExperimentProgressBody,
    /// Derived state of every applicable Score. A final comparison and every CI
    /// assertion require this to be terminal.
    #[schema(value_type = String)]
    pub scoring_status: ScoringStatus,
    pub skip_summary: ExperimentSkipSummaryBody,
    pub score_summaries: Vec<ExperimentScoreSummaryBody>,
    /// Dimensions the customer's own code reported. Empty for a run whose
    /// Scores all came from platform Scorers.
    pub client_score_summaries: Vec<ExperimentClientScoreSummaryBody>,
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
    /// The one field a list surface needs; task and score statuses remain for drill-down.
    pub status: ExperimentSlotStatusBody,
    pub task_status: ExperimentResultTaskStatusBody,
    pub execution: Option<Value>,
    pub scores: Vec<ExperimentResultScoreBody>,
    /// Scores the customer's own code reported for this Slot. `scores` above is
    /// one entry per pinned Scorer, which a client Score is not.
    pub client_scores: Vec<Value>,
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
pub enum ExperimentSlotStatusBody {
    Pending,
    Running,
    Scoring,
    Completed,
    Skipped,
    TaskFailed,
    ScoreFailed,
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
    /// User-facing dimension label. This is the Score Config name when the
    /// Scorer declares one, otherwise the Scorer name.
    pub name: String,
    pub score_config_id: Option<String>,
    pub score_config_name: Option<String>,
    pub score_config_version: Option<i32>,
    pub sample_count: u64,
    pub error_count: u64,
    pub pending_count: u64,
    pub no_reference_count: u64,
    pub no_trace_count: u64,
    pub skipped_count: u64,
    /// Type-aware aggregate: numeric mean, boolean counts, or categorical counts.
    pub value: Option<Value>,
}

/// One dimension the customer's own code reported.
///
/// Separate from [`ExperimentScoreSummaryBody`] because a client Score has no
/// Scorer. The Score Config is what the two share, so a reader can compare them
/// without the platform claiming it produced either.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentClientScoreSummaryBody {
    pub score_config_id: String,
    pub score_config_name: String,
    pub client_scorer_key: String,
    pub sample_count: u64,
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentAggregateSummaryBody {
    pub p50_latency_ms: Option<u64>,
    pub total_cost: f64,
    pub task_cost: f64,
    pub scoring_cost: Option<f64>,
    pub cost_incomplete: bool,
    pub incomplete: bool,
    pub incomplete_task_slots: u64,
    pub incomplete_score_dimensions: u64,
    pub error_task_slots: u64,
}

impl From<ExperimentSlotStatus> for ExperimentSlotStatusBody {
    fn from(value: ExperimentSlotStatus) -> Self {
        match value {
            ExperimentSlotStatus::Pending => Self::Pending,
            ExperimentSlotStatus::Running => Self::Running,
            ExperimentSlotStatus::Scoring => Self::Scoring,
            ExperimentSlotStatus::Completed => Self::Completed,
            ExperimentSlotStatus::Skipped => Self::Skipped,
            ExperimentSlotStatus::TaskFailed => Self::TaskFailed,
            ExperimentSlotStatus::ScoreFailed => Self::ScoreFailed,
        }
    }
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
            status: value.status.into(),
            task_status: value.task_status.into(),
            execution: value
                .execution
                .and_then(|record| serde_json::to_value(record).ok()),
            scores: value.scores.into_iter().map(Into::into).collect(),
            client_scores: value
                .client_scores
                .into_iter()
                .filter_map(|score| serde_json::to_value(score).ok())
                .collect(),
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
            name: value.scorer_id.clone(),
            scorer_id: value.scorer_id,
            scorer_version: value.scorer_version,
            score_config_id: None,
            score_config_name: None,
            score_config_version: None,
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

impl From<ExperimentClientScoreSummary> for ExperimentClientScoreSummaryBody {
    fn from(value: ExperimentClientScoreSummary) -> Self {
        Self {
            score_config_id: value.score_config_id,
            score_config_name: value.score_config_name,
            client_scorer_key: value.client_scorer_key,
            sample_count: value.sample_count,
            value: value.value,
        }
    }
}

impl From<ExperimentAggregateSummary> for ExperimentAggregateSummaryBody {
    fn from(value: ExperimentAggregateSummary) -> Self {
        Self {
            p50_latency_ms: value.p50_latency_ms,
            total_cost: value.total_cost,
            task_cost: value.task_cost,
            scoring_cost: value.scoring_cost,
            cost_incomplete: value.cost_incomplete,
            incomplete: value.incomplete,
            incomplete_task_slots: value.incomplete_task_slots,
            incomplete_score_dimensions: value.incomplete_score_dimensions,
            error_task_slots: value.error_task_slots,
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
                // An SDK Task is identified by the customer code behind it, so
                // its fingerprint is part of the definition rather than an
                // optional extra.
                "sdk" => serde_json::json!({
                    "type": kind,
                    "taskFingerprint": "sha256:customer-code-v3",
                    "config": {}
                }),
                // A Remote Task is pinned to one published version, so the
                // reference is the definition.
                _ => serde_json::json!({"type": kind, "taskRef": "mock-task@1"}),
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
    fn an_sdk_task_without_a_fingerprint_is_refused_at_the_edge() {
        let body: Result<ExperimentTaskBody, _> =
            serde_json::from_value(serde_json::json!({"type": "sdk", "config": {}}));
        assert!(body.is_err());

        let accepted: ExperimentTaskBody = serde_json::from_value(
            serde_json::json!({"type": "sdk", "taskFingerprint": "sha256:abc"}),
        )
        .unwrap();
        let ExperimentTaskBody::Sdk {
            task_fingerprint, ..
        } = accepted
        else {
            panic!("expected an SDK task");
        };
        assert_eq!(task_fingerprint, "sha256:abc");
    }

    #[test]
    fn an_empty_clone_body_overrides_nothing() {
        let body: CloneExperimentRequestBody =
            serde_json::from_value(serde_json::json!({})).unwrap();
        let overrides = CloneExperimentOverrides::from(body);

        // The UI's Clone button sends `{}`, and that has to stay a verbatim
        // copy of the source rather than a definition with every pin blanked.
        assert_eq!(overrides, CloneExperimentOverrides::default());
    }

    #[test]
    fn a_clone_body_accepts_every_pin_the_create_body_does() {
        let body: CloneExperimentRequestBody = serde_json::from_value(serde_json::json!({
            "name": "tuned",
            "description": "second pass",
            "datasetId": "dataset-2",
            "datasetVersion": 9,
            "datasetFilter": {"tags": ["regression"]},
            "task": {"type": "sdk", "taskFingerprint": "sha256:customer-code-v4"},
            "scorers": [{"id": "scorer-1", "version": 2}],
            "trialCount": 5,
            "metadata": {"suite": "nightly"},
            "idempotencyKey": "clone-1",
            "confirmCostEstimate": true
        }))
        .unwrap();
        let overrides = CloneExperimentOverrides::from(body);

        assert_eq!(overrides.name.as_deref(), Some("tuned"));
        assert_eq!(overrides.description, Some(Some("second pass".to_string())));
        assert_eq!(overrides.dataset_id.as_deref(), Some("dataset-2"));
        assert_eq!(overrides.dataset_version, Some(9));
        assert_eq!(
            overrides
                .dataset_filter
                .as_ref()
                .and_then(Option::as_ref)
                .map(|filter| filter.tags.as_slice()),
            Some(["regression".to_string()].as_slice())
        );
        assert!(matches!(
            overrides.task,
            Some(ExperimentTaskConfig::Sdk { .. })
        ));
        assert_eq!(
            overrides.scorers,
            Some(vec![ExperimentScorerRef {
                id: "scorer-1".to_string(),
                version: Some(2),
            }])
        );
        assert_eq!(overrides.trial_count, Some(5));
        assert_eq!(
            overrides.metadata,
            Some(Some(serde_json::json!({"suite": "nightly"})))
        );
        assert_eq!(overrides.idempotency_key.as_deref(), Some("clone-1"));
        assert!(overrides.confirm_cost_estimate);
    }

    #[test]
    fn a_null_clone_override_clears_while_an_absent_one_inherits() {
        let cleared: CloneExperimentRequestBody = serde_json::from_value(serde_json::json!({
            "description": null,
            "datasetFilter": null,
            "metadata": null
        }))
        .unwrap();
        let cleared = CloneExperimentOverrides::from(cleared);

        // Serde collapses both to `None` without the double-option
        // deserializer, which would make "run the clone over the whole Dataset"
        // inexpressible once the source pinned a filter.
        assert_eq!(cleared.description, Some(None));
        assert_eq!(cleared.dataset_filter, Some(None));
        assert_eq!(cleared.metadata, Some(None));

        let absent: CloneExperimentRequestBody =
            serde_json::from_value(serde_json::json!({"name": "copy"})).unwrap();
        let absent = CloneExperimentOverrides::from(absent);
        assert_eq!(absent.description, None);
        assert_eq!(absent.dataset_filter, None);
        assert_eq!(absent.metadata, None);
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
