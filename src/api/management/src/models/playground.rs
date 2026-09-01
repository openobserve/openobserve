// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use openobserve_core::llm_evaluations::{
    playground::Snapshot,
    sync_scoring::{ScoreOutcome, ScoreResult, ScoreSubject, ScoreValue, SkipReason},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharePlaygroundSnapshotRequestBody {
    /// The whole workbench by value: columns, rows, results and scores. Stored
    /// verbatim, so anything the client sends survives a round trip.
    pub payload: Value,
    /// The snapshot this one was forked from, if any. A parent that has since
    /// been purged is accepted: lineage is a weak reference.
    #[serde(default)]
    pub parent_snapshot_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundSnapshotResponseBody {
    pub id: String,
    pub payload: Value,
    pub parent_snapshot_id: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub last_accessed_at: i64,
}

impl From<Snapshot> for PlaygroundSnapshotResponseBody {
    fn from(snapshot: Snapshot) -> Self {
        Self {
            id: snapshot.id,
            payload: snapshot.payload,
            parent_snapshot_id: snapshot.parent_snapshot_id,
            created_by: snapshot.created_by,
            created_at: snapshot.created_at,
            last_accessed_at: snapshot.last_accessed_at,
        }
    }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaygroundToolCallBody {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaygroundMessageBody {
    pub role: String,
    /// Structured content is accepted and passed through, so multimodal and
    /// tool-result messages survive.
    #[serde(default)]
    pub content: Option<Value>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub tool_calls: Vec<PlaygroundToolCallBody>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaygroundColumnBody {
    pub provider_id: String,
    #[serde(default)]
    pub model: Option<String>,
    pub messages: Vec<PlaygroundMessageBody>,
    /// Sampling parameters, passed to the provider verbatim. `temperature` and
    /// `max_tokens` are read out for the provider's own fields; the rest ride
    /// through untouched, which is how a caller reaches provider-specific
    /// options without a schema change here.
    #[serde(default)]
    pub params: serde_json::Map<String, Value>,
    /// Tool definitions, passed through. A tool call comes back as the cell's
    /// output; nothing is executed.
    #[serde(default)]
    pub tools: Option<Value>,
    #[serde(default)]
    pub response_format: Option<Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaygroundRowBody {
    /// A string binds `{{input}}`; an object binds each of its fields by name.
    #[serde(default)]
    pub input: Option<Value>,
    #[serde(default)]
    pub expected_output: Option<Value>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaygroundRunRequestBody {
    pub column: PlaygroundColumnBody,
    #[serde(default)]
    pub row: PlaygroundRowBody,
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaygroundScoreRequestBody {
    /// Scorers are resolved at their latest version. Pinning belongs to the
    /// moment a column is promoted to an Experiment, not to a draft.
    pub scorer_ids: Vec<String>,
    #[serde(default)]
    pub input: Option<Value>,
    pub output: String,
    #[serde(default)]
    pub expected_output: Option<Value>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

impl From<PlaygroundScoreRequestBody> for ScoreSubject {
    fn from(body: PlaygroundScoreRequestBody) -> Self {
        Self {
            input: body.input,
            output: body.output,
            expected_output: body.expected_output,
            metadata: body.metadata,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SkipReasonBody {
    NoReference,
    RequiresTrace,
}

impl From<SkipReason> for SkipReasonBody {
    fn from(reason: SkipReason) -> Self {
        match reason {
            SkipReason::NoReference => Self::NoReference,
            SkipReason::RequiresTrace => Self::RequiresTrace,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScoreValueBody {
    pub numeric: Option<f64>,
    pub categorical: Option<String>,
    pub boolean: Option<bool>,
    pub reasoning: Option<String>,
    pub metadata: Option<Value>,
    pub model_used: Option<String>,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub latency_ms: i64,
}

impl From<ScoreValue> for ScoreValueBody {
    fn from(value: ScoreValue) -> Self {
        Self {
            numeric: value.numeric,
            categorical: value.categorical,
            boolean: value.boolean,
            reasoning: value.reasoning,
            metadata: value.metadata,
            model_used: value.model_used,
            prompt_tokens: value.prompt_tokens,
            completion_tokens: value.completion_tokens,
            latency_ms: value.latency_ms,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ScoreOutcomeBody {
    Scored(ScoreValueBody),
    Skipped { reason: SkipReasonBody },
    Failed { error: String },
}

impl From<ScoreOutcome> for ScoreOutcomeBody {
    fn from(outcome: ScoreOutcome) -> Self {
        match outcome {
            ScoreOutcome::Scored(value) => Self::Scored(value.into()),
            ScoreOutcome::Skipped { reason } => Self::Skipped {
                reason: reason.into(),
            },
            ScoreOutcome::Failed { error } => Self::Failed { error },
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScoreResultBody {
    pub scorer_id: String,
    pub scorer_name: String,
    pub scorer_version: i32,
    #[serde(flatten)]
    pub outcome: ScoreOutcomeBody,
}

impl From<ScoreResult> for ScoreResultBody {
    fn from(result: ScoreResult) -> Self {
        Self {
            scorer_id: result.scorer_id,
            scorer_name: result.scorer_name,
            scorer_version: result.scorer_version,
            outcome: result.outcome.into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundScoreResponseBody {
    /// One entry per requested scorer, in the order they were asked for. A
    /// scorer that could not run reports why instead of vanishing.
    pub results: Vec<ScoreResultBody>,
}
