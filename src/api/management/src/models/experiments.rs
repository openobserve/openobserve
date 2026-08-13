// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::collections::{BTreeMap, HashMap, HashSet};

use config::meta::self_reporting::llm_experiments::ExperimentSkipReason;
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

#[derive(Clone, Debug, Default, Serialize, ToSchema)]
pub struct ExperimentResultsResponseBody {
    pub executions: Vec<Value>,
    pub scores: Vec<Value>,
    pub task_progress: ExperimentProgressBody,
    pub scoring_progress: ExperimentProgressBody,
    pub skip_summary: ExperimentSkipSummaryBody,
    pub score_summaries: Vec<ExperimentScoreSummaryBody>,
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
    pub skipped_count: u64,
}

#[derive(Clone, Copy, Debug, Default)]
struct ScoreEvidenceCounts {
    successful: u64,
    skipped: u64,
}

/// Derive deterministic API progress from the latest durable execution and
/// score evidence. Intentionally skipped work is reported, but excluded from
/// task and scoring denominators.
pub fn experiment_result_summary(
    applicability: &ExperimentApplicabilityPreviewBody,
    scorers: &[PinnedExperimentScorerBody],
    executions: &[Value],
    scores: &[Value],
) -> (
    ExperimentProgressBody,
    ExperimentProgressBody,
    ExperimentSkipSummaryBody,
    Vec<ExperimentScoreSummaryBody>,
) {
    fn slot_key(value: &Value) -> Option<(String, u64)> {
        Some((
            value.get("row_id")?.as_str()?.to_string(),
            value.get("trial_index")?.as_u64()?,
        ))
    }

    fn skip_reason(value: &Value) -> Option<ExperimentSkipReason> {
        serde_json::from_value(value.get("skip_reason")?.clone()).ok()
    }

    let fully_skipped = executions
        .iter()
        .filter(|record| {
            record.get("status").and_then(Value::as_str) == Some("skipped")
                && skip_reason(record) == Some(ExperimentSkipReason::NoReference)
        })
        .filter_map(slot_key)
        .collect::<HashSet<_>>();
    let completed_tasks = executions
        .iter()
        .filter(|record| {
            matches!(
                record.get("status").and_then(Value::as_str),
                Some("ok" | "error")
            )
        })
        .filter_map(slot_key)
        .collect::<HashSet<_>>();

    let skipped_scores = scores
        .iter()
        .filter(|score| score.get("status").and_then(Value::as_str) == Some("skipped"))
        .collect::<Vec<_>>();
    let planned_reference_skip_slots = skipped_scores
        .iter()
        .filter(|score| skip_reason(score) == Some(ExperimentSkipReason::NoReference))
        .filter_map(|score| slot_key(score))
        .collect::<HashSet<_>>();
    let observed_permanent_skip_slots = skipped_scores
        .iter()
        .filter_map(|score| slot_key(score))
        .collect::<HashSet<_>>();
    let partially_skipped = planned_reference_skip_slots
        .union(&observed_permanent_skip_slots)
        .filter(|slot| !fully_skipped.contains(slot))
        .cloned()
        .collect::<HashSet<_>>();
    let successful_scores = scores
        .iter()
        .filter(|score| score.get("status").and_then(Value::as_str) != Some("skipped"))
        .collect::<Vec<_>>();

    let no_reference_dimensions = applicability
        .scorer_applicability
        .iter()
        .map(|scorer| scorer.no_reference_slot_count)
        .fold(0_u64, u64::saturating_add);
    let no_trace_dimensions = u64::try_from(
        skipped_scores
            .iter()
            .filter(|score| skip_reason(score) == Some(ExperimentSkipReason::NoTrace))
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
        completed: u64::try_from(successful_scores.len()).unwrap_or(u64::MAX),
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

    let mut counts = HashMap::<(&str, i32), ScoreEvidenceCounts>::new();
    for score in scores {
        let Some(scorer_id) = score.get("scorer_id").and_then(Value::as_str) else {
            continue;
        };
        let scorer_version = score
            .get("scorer_version")
            .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
            .and_then(|version| i32::try_from(version).ok());
        let Some(scorer_version) = scorer_version else {
            continue;
        };
        let entry = counts.entry((scorer_id, scorer_version)).or_default();
        if score.get("status").and_then(Value::as_str) == Some("skipped") {
            entry.skipped = entry.skipped.saturating_add(1);
        } else {
            entry.successful = entry.successful.saturating_add(1);
        }
    }
    let score_summaries = scorers
        .iter()
        .map(|scorer| {
            let evidence_counts = counts
                .get(&(scorer.id.as_str(), scorer.version))
                .copied()
                .unwrap_or_default();
            let predicted_no_reference = applicability
                .scorer_applicability
                .iter()
                .find(|candidate| {
                    candidate.scorer_id == scorer.id && candidate.scorer_version == scorer.version
                })
                .map(|candidate| candidate.no_reference_slot_count)
                .unwrap_or_default();
            let observed_no_trace = scores
                .iter()
                .filter(|score| {
                    score.get("scorer_id").and_then(Value::as_str) == Some(scorer.id.as_str())
                        && skip_reason(score) == Some(ExperimentSkipReason::NoTrace)
                })
                .count();
            ExperimentScoreSummaryBody {
                scorer_id: scorer.id.clone(),
                scorer_version: scorer.version,
                sample_count: evidence_counts.successful,
                skipped_count: predicted_no_reference
                    .saturating_add(u64::try_from(observed_no_trace).unwrap_or(u64::MAX)),
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
        assert_eq!(summaries[0].skipped_count, 1);
        assert_eq!(summaries[1].sample_count, 0);
        assert_eq!(summaries[1].skipped_count, 2);
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
}
