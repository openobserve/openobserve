// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::collections::BTreeMap;

use openobserve_core::llm_evaluations::{
    datasets::{DatasetItemSource, DatasetSnapshotFilter},
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
    pub sample_slots: Vec<ExperimentSlotBody>,
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
}
