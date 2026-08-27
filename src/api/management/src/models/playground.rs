// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use openobserve_core::llm_evaluations::{
    playground::{
        ChangeKind, ColumnDiff, DiffHunk, DiffOp, FieldChange, ParamChange, Snapshot, SnapshotDiff,
        SnapshotPage, SnapshotSummary,
    },
    sync_scoring::{ScoreOutcome, ScoreResult, ScoreSubject, ScoreValue, SkipReason},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, ToSchema};

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

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundSnapshotSummaryBody {
    pub id: String,
    pub parent_snapshot_id: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub last_accessed_at: i64,
    pub column_count: usize,
    pub row_count: usize,
}

impl From<SnapshotSummary> for PlaygroundSnapshotSummaryBody {
    fn from(summary: SnapshotSummary) -> Self {
        Self {
            id: summary.id,
            parent_snapshot_id: summary.parent_snapshot_id,
            created_by: summary.created_by,
            created_at: summary.created_at,
            last_accessed_at: summary.last_accessed_at,
            column_count: summary.column_count,
            row_count: summary.row_count,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPlaygroundSnapshotsResponseBody {
    pub snapshots: Vec<PlaygroundSnapshotSummaryBody>,
    /// Snapshots the organization holds, which is what pagination advances
    /// through. Per-object visibility is applied to the page after it is read,
    /// so a restricted caller can see fewer rows than this counts.
    pub total: u64,
}

impl From<SnapshotPage> for ListPlaygroundSnapshotsResponseBody {
    fn from(page: SnapshotPage) -> Self {
        Self {
            snapshots: page.snapshots.into_iter().map(Into::into).collect(),
            total: page.total,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct ListPlaygroundSnapshotsQuery {
    #[serde(default)]
    pub from: Option<u64>,
    #[serde(default)]
    pub size: Option<u64>,
}

// ---------------------------------------------------------------------------
// Lineage diff
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiffOpBody {
    Equal,
    Added,
    Removed,
}

impl From<DiffOp> for DiffOpBody {
    fn from(op: DiffOp) -> Self {
        match op {
            DiffOp::Equal => Self::Equal,
            DiffOp::Added => Self::Added,
            DiffOp::Removed => Self::Removed,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKindBody {
    Added,
    Removed,
    Changed,
    Unchanged,
}

impl From<ChangeKind> for ChangeKindBody {
    fn from(kind: ChangeKind) -> Self {
        match kind {
            ChangeKind::Added => Self::Added,
            ChangeKind::Removed => Self::Removed,
            ChangeKind::Changed => Self::Changed,
            ChangeKind::Unchanged => Self::Unchanged,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct DiffHunkBody {
    pub op: DiffOpBody,
    pub text: String,
}

impl From<DiffHunk> for DiffHunkBody {
    fn from(hunk: DiffHunk) -> Self {
        Self {
            op: hunk.op.into(),
            text: hunk.text,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct FieldChangeBody {
    pub from: Option<String>,
    pub to: Option<String>,
}

impl From<FieldChange> for FieldChangeBody {
    fn from(change: FieldChange) -> Self {
        Self {
            from: change.from,
            to: change.to,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ParamChangeBody {
    pub key: String,
    pub from: Option<Value>,
    pub to: Option<Value>,
}

impl From<ParamChange> for ParamChangeBody {
    fn from(change: ParamChange) -> Self {
        Self {
            key: change.key,
            from: change.from,
            to: change.to,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDiffBody {
    pub index: usize,
    pub kind: ChangeKindBody,
    pub model: Option<FieldChangeBody>,
    pub provider_id: Option<FieldChangeBody>,
    pub params: Vec<ParamChangeBody>,
    pub messages: Vec<DiffHunkBody>,
    /// The prompt exceeded the line budget, so the messages are reported as
    /// wholly replaced rather than line by line.
    pub messages_truncated: bool,
}

impl From<ColumnDiff> for ColumnDiffBody {
    fn from(diff: ColumnDiff) -> Self {
        Self {
            index: diff.index,
            kind: diff.kind.into(),
            model: diff.model.map(Into::into),
            provider_id: diff.provider_id.map(Into::into),
            params: diff.params.into_iter().map(Into::into).collect(),
            messages: diff.messages.into_iter().map(Into::into).collect(),
            messages_truncated: diff.messages_truncated,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundSnapshotDiffResponseBody {
    pub snapshot_id: String,
    pub parent_snapshot_id: Option<String>,
    /// False when the parent has been purged. The diff is then empty and the
    /// caller should say so rather than treat it as "nothing changed".
    pub parent_available: bool,
    pub columns: Vec<ColumnDiffBody>,
}

impl From<SnapshotDiff> for PlaygroundSnapshotDiffResponseBody {
    fn from(diff: SnapshotDiff) -> Self {
        Self {
            snapshot_id: diff.snapshot_id,
            parent_snapshot_id: diff.parent_snapshot_id,
            parent_available: diff.parent_available,
            columns: diff.columns.into_iter().map(Into::into).collect(),
        }
    }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaygroundMessageBody {
    pub role: String,
    /// Structured content is accepted and passed through, so multimodal and
    /// tool-result messages survive.
    #[serde(default)]
    pub content: Option<Value>,
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

// ---------------------------------------------------------------------------
// Provider model catalogue
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelsResponseBody {
    /// Models the provider reports it can serve.
    pub models: Vec<String>,
    /// Models recorded on the provider itself. The two can differ, and the
    /// configured list is what calls are validated against.
    pub configured_models: Vec<String>,
}
