// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::collections::{BTreeMap, HashMap, HashSet};

use config::meta::self_reporting::{
    llm_experiments::{ExperimentExecutionRecord, ExperimentExecutionStatus, ExperimentSkipReason},
    llm_scores::{LlmScoreRecord, LlmScoreStatus},
};
use openobserve_core::llm_evaluations::{
    datasets::{DatasetItemSource, DatasetSnapshotFilter},
    experiment_evidence::{ExperimentApplicabilityPreview, ExperimentScorerApplicabilityPreview},
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
            ExperimentTaskBody::Sdk { config } => Self::Sdk { config },
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
            ExperimentTaskConfig::Sdk { config } => Self::Sdk { config },
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

fn score_scorer_version(score: &LlmScoreRecord) -> Option<i32> {
    score.scorer_version.as_deref()?.parse().ok()
}

pub fn experiment_result_slots(
    slots: Vec<ExperimentSlot>,
    executions: &[ExperimentExecutionRecord],
    scores: &[LlmScoreRecord],
    scorers: &[PinnedExperimentScorerBody],
) -> Vec<ExperimentResultSlotBody> {
    let executions = executions
        .iter()
        .map(|record| ((record.row_id.clone(), record.trial_index), record.clone()))
        .collect::<HashMap<_, _>>();
    let scores = scores
        .iter()
        .filter_map(|score| {
            let row_id = score.row_id.clone()?;
            let trial_index = score.trial_index?;
            let scorer_id = score.scorer_id.clone()?;
            let scorer_version = score.scorer_version.as_deref()?.parse::<i32>().ok()?;
            Some((
                (row_id, trial_index, scorer_id, scorer_version),
                score.clone(),
            ))
        })
        .collect::<HashMap<_, _>>();

    slots
        .into_iter()
        .map(|slot| {
            let coordinate = (slot.row_id.clone(), slot.trial_index);
            let execution = executions.get(&coordinate).cloned();
            let task_status = execution
                .as_ref()
                .map(|record| match record.status {
                    ExperimentExecutionStatus::Pending => {
                        ExperimentResultTaskStatusBody::InProgress
                    }
                    ExperimentExecutionStatus::Ok => ExperimentResultTaskStatusBody::Ok,
                    ExperimentExecutionStatus::Skipped => ExperimentResultTaskStatusBody::Skipped,
                    ExperimentExecutionStatus::Error => ExperimentResultTaskStatusBody::Error,
                })
                .unwrap_or(ExperimentResultTaskStatusBody::Pending);
            let score_bodies = scorers
                .iter()
                .map(|scorer| {
                    let score = scores
                        .get(&(
                            slot.row_id.clone(),
                            slot.trial_index,
                            scorer.id.clone(),
                            scorer.version,
                        ))
                        .cloned();
                    let status = score
                        .as_ref()
                        .map(|record| match record.status {
                            LlmScoreStatus::Success => ExperimentResultScoreStatusBody::Success,
                            LlmScoreStatus::Skipped => ExperimentResultScoreStatusBody::Skipped,
                            LlmScoreStatus::Error => ExperimentResultScoreStatusBody::Error,
                        })
                        .unwrap_or_else(|| {
                            if execution.is_none()
                                || task_status == ExperimentResultTaskStatusBody::Pending
                            {
                                ExperimentResultScoreStatusBody::Pending
                            } else {
                                ExperimentResultScoreStatusBody::InProgress
                            }
                        });
                    ExperimentResultScoreBody {
                        scorer_id: scorer.id.clone(),
                        scorer_version: scorer.version,
                        status,
                        score: score.and_then(|record| serde_json::to_value(record).ok()),
                    }
                })
                .collect();
            ExperimentResultSlotBody {
                row_id: slot.row_id,
                logical_id: slot.logical_id,
                trial_index: slot.trial_index,
                input: slot.input,
                expected_output: slot.expected_output,
                task_status,
                execution: execution.and_then(|record| serde_json::to_value(record).ok()),
                scores: score_bodies,
            }
        })
        .collect()
}

pub fn experiment_aggregate_summary(
    executions: &[ExperimentExecutionRecord],
    task_progress: &ExperimentProgressBody,
    scoring_progress: &ExperimentProgressBody,
) -> ExperimentAggregateSummaryBody {
    let mut latencies = executions
        .iter()
        .filter_map(|record| record.latency_ms)
        .collect::<Vec<_>>();
    latencies.sort_unstable();
    let p50_latency_ms = if latencies.is_empty() {
        None
    } else {
        Some(latencies[(latencies.len() - 1) / 2])
    };
    let total_cost = executions.iter().filter_map(|record| record.cost).sum();
    let incomplete_task_slots = task_progress.total.saturating_sub(task_progress.completed);
    let incomplete_score_dimensions = scoring_progress
        .total
        .saturating_sub(scoring_progress.completed);
    ExperimentAggregateSummaryBody {
        p50_latency_ms,
        total_cost,
        incomplete: incomplete_task_slots > 0 || incomplete_score_dimensions > 0,
        incomplete_task_slots,
        incomplete_score_dimensions,
    }
}

fn aggregate_score_values(scores: &[&LlmScoreRecord]) -> Option<Value> {
    let numeric = scores
        .iter()
        .filter_map(|score| score.value_numeric)
        .collect::<Vec<_>>();
    if !numeric.is_empty() {
        return Some(serde_json::json!({
            "kind": "numeric",
            "mean": numeric.iter().sum::<f64>() / numeric.len() as f64,
        }));
    }
    let booleans = scores
        .iter()
        .filter_map(|score| score.value_boolean)
        .collect::<Vec<_>>();
    if !booleans.is_empty() {
        return Some(serde_json::json!({
            "kind": "boolean",
            "trueCount": booleans.iter().filter(|value| **value).count(),
            "falseCount": booleans.iter().filter(|value| !**value).count(),
        }));
    }
    let mut counts = BTreeMap::<String, u64>::new();
    for category in scores
        .iter()
        .filter_map(|score| score.value_categorical.as_deref())
    {
        *counts.entry(category.to_string()).or_default() += 1;
    }
    (!counts.is_empty()).then(|| serde_json::json!({ "kind": "categorical", "counts": counts }))
}

/// Derive deterministic API progress from the latest durable execution and
/// score evidence. Intentionally skipped work is reported, but excluded from
/// task and scoring denominators.
pub fn experiment_result_summary(
    applicability: &ExperimentApplicabilityPreviewBody,
    scorers: &[PinnedExperimentScorerBody],
    executions: &[ExperimentExecutionRecord],
    scores: &[LlmScoreRecord],
) -> (
    ExperimentProgressBody,
    ExperimentProgressBody,
    ExperimentSkipSummaryBody,
    Vec<ExperimentScoreSummaryBody>,
) {
    let fully_skipped = executions
        .iter()
        .filter(|record| {
            record.status == ExperimentExecutionStatus::Skipped
                && record.skip_reason == Some(ExperimentSkipReason::NoReference)
        })
        .map(|record| (record.row_id.clone(), record.trial_index))
        .collect::<HashSet<_>>();
    let completed_tasks = executions
        .iter()
        .filter(|record| {
            matches!(
                record.status,
                ExperimentExecutionStatus::Ok | ExperimentExecutionStatus::Error
            )
        })
        .map(|record| (record.row_id.clone(), record.trial_index))
        .collect::<HashSet<_>>();

    let skipped_scores = scores
        .iter()
        .filter(|score| score.status == LlmScoreStatus::Skipped)
        .collect::<Vec<_>>();
    // Every persisted permanent skip, regardless of tier, contributes its slot
    // once. Reference skips are already a strict subset of this evidence set.
    let observed_permanent_skip_slots = skipped_scores
        .iter()
        .filter_map(|score| Some((score.row_id.clone()?, score.trial_index?)))
        .collect::<HashSet<_>>();
    let partially_skipped = observed_permanent_skip_slots
        .iter()
        .filter(|slot| !fully_skipped.contains(slot))
        .cloned()
        .collect::<HashSet<_>>();
    let no_reference_dimensions = applicability
        .scorer_applicability
        .iter()
        .map(|scorer| scorer.no_reference_slot_count)
        .fold(0_u64, u64::saturating_add);
    let no_trace_dimensions = u64::try_from(
        skipped_scores
            .iter()
            .filter(|score| score.skip_reason == Some(ExperimentSkipReason::NoTrace))
            .count(),
    )
    .unwrap_or(u64::MAX);
    let skipped_dimensions = no_reference_dimensions.saturating_add(no_trace_dimensions);
    let task_progress = ExperimentProgressBody {
        completed: u64::try_from(completed_tasks.len()).unwrap_or(u64::MAX),
        total: applicability.eligible_task_slot_count,
        skipped: applicability.fully_skipped_slot_count,
    };
    let scoring_progress = ExperimentProgressBody {
        completed: u64::try_from(
            scores
                .iter()
                .filter(|score| {
                    matches!(
                        score.status,
                        LlmScoreStatus::Success | LlmScoreStatus::Error
                    )
                })
                .count(),
        )
        .unwrap_or(u64::MAX),
        total: applicability
            .eligible_scoring_dimension_count
            .saturating_sub(no_trace_dimensions),
        skipped: skipped_dimensions,
    };
    let skip_summary = ExperimentSkipSummaryBody {
        fully_skipped_slots: applicability.fully_skipped_slot_count,
        partially_skipped_slots: u64::try_from(partially_skipped.len()).unwrap_or(u64::MAX),
        skipped_dimensions,
        no_reference_dimensions,
        no_trace_dimensions,
    };

    let mut successful_counts = HashMap::<(&str, i32), u64>::new();
    for score in scores {
        let Some(scorer_id) = score.scorer_id.as_deref() else {
            continue;
        };
        let Some(scorer_version) = score_scorer_version(score) else {
            continue;
        };
        if score.status == LlmScoreStatus::Success {
            let count = successful_counts
                .entry((scorer_id, scorer_version))
                .or_default();
            *count = count.saturating_add(1);
        }
    }
    let score_summaries = scorers
        .iter()
        .map(|scorer| {
            let sample_count = successful_counts
                .get(&(scorer.id.as_str(), scorer.version))
                .copied()
                .unwrap_or_default();
            let skip_count = |reason| {
                u64::try_from(
                    scores
                        .iter()
                        .filter(|score| {
                            score.scorer_id.as_deref() == Some(scorer.id.as_str())
                                && score_scorer_version(score) == Some(scorer.version)
                                && score.status == LlmScoreStatus::Skipped
                                && score.skip_reason == Some(reason)
                        })
                        .count(),
                )
                .unwrap_or(u64::MAX)
            };
            let no_reference_count = skip_count(ExperimentSkipReason::NoReference);
            let no_trace_count = skip_count(ExperimentSkipReason::NoTrace);
            let scorer_scores = scores
                .iter()
                .filter(|score| {
                    score.scorer_id.as_deref() == Some(scorer.id.as_str())
                        && score_scorer_version(score) == Some(scorer.version)
                })
                .collect::<Vec<_>>();
            let error_count = u64::try_from(
                scorer_scores
                    .iter()
                    .filter(|score| score.status == LlmScoreStatus::Error)
                    .count(),
            )
            .unwrap_or(u64::MAX);
            let expected = applicability
                .scorer_applicability
                .iter()
                .find(|item| item.scorer_id == scorer.id && item.scorer_version == scorer.version)
                .map(|item| item.eligible_slot_count)
                .unwrap_or_default();
            ExperimentScoreSummaryBody {
                scorer_id: scorer.id.clone(),
                scorer_version: scorer.version,
                sample_count,
                error_count,
                pending_count: expected.saturating_sub(
                    sample_count
                        .saturating_add(no_reference_count)
                        .saturating_add(no_trace_count)
                        .saturating_add(error_count),
                ),
                no_reference_count,
                no_trace_count,
                skipped_count: no_reference_count.saturating_add(no_trace_count),
                value: aggregate_score_values(&scorer_scores),
            }
        })
        .collect();

    (
        task_progress,
        scoring_progress,
        skip_summary,
        score_summaries,
    )
}

/// Builds row-local progress and aggregates from the same durable evidence as
/// the global summary. Expected scorer counts are bounded to this row's trial
/// slots, so the contract remains reusable by comparison views.
pub fn experiment_row_result_summary(
    slot_count: usize,
    scorers: &[PinnedExperimentScorerBody],
    executions: &[ExperimentExecutionRecord],
    scores: &[LlmScoreRecord],
) -> (
    ExperimentProgressBody,
    ExperimentProgressBody,
    ExperimentSkipSummaryBody,
    Vec<ExperimentScoreSummaryBody>,
) {
    let slot_count = u64::try_from(slot_count).unwrap_or(u64::MAX);
    let fully_skipped_slot_count = u64::try_from(
        executions
            .iter()
            .filter(|record| {
                record.status == ExperimentExecutionStatus::Skipped
                    && record.skip_reason == Some(ExperimentSkipReason::NoReference)
            })
            .count(),
    )
    .unwrap_or(u64::MAX);
    let scorer_applicability = scorers
        .iter()
        .map(|scorer| {
            let no_reference_slot_count = u64::try_from(
                scores
                    .iter()
                    .filter(|score| {
                        score.scorer_id.as_deref() == Some(scorer.id.as_str())
                            && score_scorer_version(score) == Some(scorer.version)
                            && score.status == LlmScoreStatus::Skipped
                            && score.skip_reason == Some(ExperimentSkipReason::NoReference)
                    })
                    .count(),
            )
            .unwrap_or(u64::MAX);
            ExperimentScorerApplicabilityBody {
                scorer_id: scorer.id.clone(),
                scorer_version: scorer.version,
                eligible_row_count: u64::from(no_reference_slot_count < slot_count),
                no_reference_row_count: u64::from(no_reference_slot_count == slot_count),
                eligible_slot_count: slot_count.saturating_sub(no_reference_slot_count),
                no_reference_slot_count,
            }
        })
        .collect::<Vec<_>>();
    let no_reference_dimensions = scorer_applicability
        .iter()
        .map(|scorer| scorer.no_reference_slot_count)
        .fold(0_u64, u64::saturating_add);
    let eligible_scoring_dimension_count = slot_count
        .saturating_mul(u64::try_from(scorers.len()).unwrap_or(u64::MAX))
        .saturating_sub(no_reference_dimensions);
    let applicability = ExperimentApplicabilityPreviewBody {
        fully_skipped_row_count: u64::from(fully_skipped_slot_count == slot_count),
        partially_skipped_row_count: 0,
        fully_skipped_slot_count,
        partially_skipped_slot_count: 0,
        eligible_task_slot_count: slot_count.saturating_sub(fully_skipped_slot_count),
        eligible_scoring_dimension_count,
        scorer_applicability,
    };
    experiment_result_summary(&applicability, scorers, executions, scores)
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
    fn result_summary_excludes_both_permanent_skip_tiers_from_denominators() {
        let scorers = vec![
            PinnedExperimentScorerBody {
                id: "reference".to_string(),
                version: 1,
            },
            PinnedExperimentScorerBody {
                id: "trace".to_string(),
                version: 2,
            },
        ];
        let executions = vec![
            serde_json::json!({
                "row_id": "row-1", "trial_index": 0,
                "status": "skipped", "skip_reason": "no_reference"
            }),
            serde_json::json!({
                "row_id": "row-2", "trial_index": 0, "status": "ok"
            }),
            serde_json::json!({
                "row_id": "row-3", "trial_index": 0, "status": "error"
            }),
        ];
        let scores = vec![
            serde_json::json!({
                "row_id": "row-1", "trial_index": 0, "scorer_id": "reference",
                "scorer_version": "1", "status": "skipped", "skip_reason": "no_reference"
            }),
            serde_json::json!({
                "row_id": "row-1", "trial_index": 0, "scorer_id": "trace",
                "scorer_version": "2", "status": "skipped", "skip_reason": "no_reference"
            }),
            serde_json::json!({
                "row_id": "row-2", "trial_index": 0, "scorer_id": "reference",
                "scorer_version": "1", "status": "success", "value_numeric": 0.8
            }),
            serde_json::json!({
                "row_id": "row-2", "trial_index": 0, "scorer_id": "trace",
                "scorer_version": "2", "status": "skipped", "skip_reason": "no_trace"
            }),
        ];
        let applicability = ExperimentApplicabilityPreviewBody {
            fully_skipped_row_count: 1,
            partially_skipped_row_count: 0,
            fully_skipped_slot_count: 1,
            partially_skipped_slot_count: 0,
            eligible_task_slot_count: 2,
            eligible_scoring_dimension_count: 4,
            scorer_applicability: vec![
                ExperimentScorerApplicabilityBody {
                    scorer_id: "reference".to_string(),
                    scorer_version: 1,
                    eligible_row_count: 2,
                    no_reference_row_count: 1,
                    eligible_slot_count: 2,
                    no_reference_slot_count: 1,
                },
                ExperimentScorerApplicabilityBody {
                    scorer_id: "trace".to_string(),
                    scorer_version: 2,
                    eligible_row_count: 2,
                    no_reference_row_count: 1,
                    eligible_slot_count: 2,
                    no_reference_slot_count: 1,
                },
            ],
        };

        let (task, scoring, skips, summaries) =
            experiment_result_summary(&applicability, &scorers, &executions, &scores);

        assert_eq!((task.completed, task.total, task.skipped), (2, 2, 1));
        assert_eq!(
            (scoring.completed, scoring.total, scoring.skipped),
            (1, 3, 3)
        );
        assert_eq!(skips.fully_skipped_slots, 1);
        assert_eq!(skips.partially_skipped_slots, 1);
        assert_eq!(skips.no_reference_dimensions, 2);
        assert_eq!(skips.no_trace_dimensions, 1);
        assert_eq!(summaries[0].sample_count, 1);
        assert_eq!(summaries[0].no_reference_count, 1);
        assert_eq!(summaries[0].no_trace_count, 0);
        assert_eq!(summaries[0].skipped_count, 1);
        assert_eq!(summaries[1].sample_count, 0);
        assert_eq!(summaries[1].no_reference_count, 1);
        assert_eq!(summaries[1].no_trace_count, 1);
        assert_eq!(summaries[1].skipped_count, 2);
    }

    #[test]
    fn row_result_summary_bounds_aggregates_to_the_selected_rows_trials() {
        let scorers = vec![PinnedExperimentScorerBody {
            id: "quality".to_string(),
            version: 3,
        }];
        let executions = vec![
            serde_json::json!({"row_id": "row-1", "trial_index": 0, "status": "ok"}),
            serde_json::json!({
                "row_id": "row-1", "trial_index": 1,
                "status": "skipped", "skip_reason": "no_reference"
            }),
        ];
        let scores = vec![
            serde_json::json!({
                "row_id": "row-1", "trial_index": 0, "scorer_id": "quality",
                "scorer_version": "3", "status": "success", "value_numeric": 0.75,
                "reasoning": "Matches the expected answer", "source_type": "llm_judge"
            }),
            serde_json::json!({
                "row_id": "row-1", "trial_index": 1, "scorer_id": "quality",
                "scorer_version": "3", "status": "skipped", "skip_reason": "no_reference"
            }),
        ];

        let (task, scoring, skips, summaries) =
            experiment_row_result_summary(2, &scorers, &executions, &scores);

        assert_eq!((task.completed, task.total, task.skipped), (1, 1, 1));
        assert_eq!(
            (scoring.completed, scoring.total, scoring.skipped),
            (1, 1, 1)
        );
        assert_eq!(skips.fully_skipped_slots, 1);
        assert_eq!(summaries[0].sample_count, 1);
        assert_eq!(summaries[0].pending_count, 0);
        assert_eq!(summaries[0].no_reference_count, 1);
        assert_eq!(
            summaries[0].value,
            Some(serde_json::json!({"kind": "numeric", "mean": 0.75}))
        );
    }

    #[test]
    fn partial_skip_slots_are_the_exact_union_of_permanent_dimension_evidence() {
        let applicability = ExperimentApplicabilityPreviewBody {
            partially_skipped_slot_count: 99,
            eligible_task_slot_count: 3,
            eligible_scoring_dimension_count: 3,
            scorer_applicability: vec![],
            ..Default::default()
        };
        let executions = vec![
            serde_json::json!({"row_id": "row-full", "trial_index": 0, "status": "skipped", "skip_reason": "no_reference"}),
            serde_json::json!({"row_id": "row-reference", "trial_index": 0, "status": "ok"}),
            serde_json::json!({"row_id": "row-trace", "trial_index": 0, "status": "ok"}),
        ];
        let scores = vec![
            serde_json::json!({"row_id": "row-full", "trial_index": 0, "status": "skipped", "skip_reason": "no_reference"}),
            serde_json::json!({"row_id": "row-reference", "trial_index": 0, "status": "skipped", "skip_reason": "no_reference"}),
            serde_json::json!({"row_id": "row-trace", "trial_index": 0, "status": "skipped", "skip_reason": "no_trace"}),
            serde_json::json!({"row_id": "row-trace", "trial_index": 0, "status": "skipped", "skip_reason": "no_reference"}),
        ];

        let (_, _, skips, _) = experiment_result_summary(&applicability, &[], &executions, &scores);

        assert_eq!(skips.partially_skipped_slots, 2);
    }

    #[test]
    fn result_slots_preserve_pinned_order_and_render_missing_evidence_as_placeholders() {
        let slots = vec![
            ExperimentSlot {
                row_id: "row-b".to_string(),
                logical_id: "case-1".to_string(),
                trial_index: 0,
                input: serde_json::json!({"question": "first"}),
                expected_output: None,
            },
            ExperimentSlot {
                row_id: "row-a".to_string(),
                logical_id: "case-2".to_string(),
                trial_index: 0,
                input: serde_json::json!({"question": "second"}),
                expected_output: None,
            },
        ];
        let executions = vec![serde_json::json!({
            "row_id": "row-a", "trial_index": 0, "status": "ok"
        })];
        let scorers = vec![PinnedExperimentScorerBody {
            id: "quality".to_string(),
            version: 2,
        }];

        let rows = experiment_result_slots(slots, &executions, &[], &scorers);

        assert_eq!(
            rows.iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["row-b", "row-a"]
        );
        assert_eq!(rows[0].task_status, ExperimentResultTaskStatusBody::Pending);
        assert_eq!(
            rows[0].scores[0].status,
            ExperimentResultScoreStatusBody::Pending
        );
        assert_eq!(rows[1].task_status, ExperimentResultTaskStatusBody::Ok);
        assert_eq!(
            rows[1].scores[0].status,
            ExperimentResultScoreStatusBody::InProgress
        );
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

    #[test]
    fn aggregate_summary_reports_lower_median_cost_and_incomplete_counts() {
        let executions = vec![
            serde_json::json!({"latency_ms": 30, "cost": 0.3}),
            serde_json::json!({"latency_ms": 10, "cost": 0.1}),
            serde_json::json!({"latency_ms": 20, "cost": 0.2}),
            serde_json::json!({"latency_ms": 40}),
        ];
        let task = ExperimentProgressBody {
            completed: 3,
            total: 5,
            skipped: 0,
        };
        let scoring = ExperimentProgressBody {
            completed: 7,
            total: 8,
            skipped: 1,
        };

        let summary = experiment_aggregate_summary(&executions, &task, &scoring);

        assert_eq!(summary.p50_latency_ms, Some(20));
        assert!((summary.total_cost - 0.6).abs() < f64::EPSILON);
        assert!(summary.incomplete);
        assert_eq!(summary.incomplete_task_slots, 2);
        assert_eq!(summary.incomplete_score_dimensions, 1);
    }
}
