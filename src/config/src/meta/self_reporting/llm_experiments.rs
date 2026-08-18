// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use serde::{Deserialize, Serialize};

pub const LLM_EXPERIMENT_STREAM: &str = "_llm_experiment";

/// Permanent evidence reason shared by Experiment execution and score records.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentSkipReason {
    NoReference,
    NoTrace,
    /// The Task itself declined to produce an output for this Slot. Unlike the
    /// other two, this is never a scoring-applicability reason — only a Task
    /// can decide it, and only for an execution record.
    TaskSkip,
}

impl ExperimentSkipReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NoReference => "no_reference",
            Self::NoTrace => "no_trace",
            Self::TaskSkip => "task_skip",
        }
    }
}

impl std::fmt::Display for ExperimentSkipReason {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Stable logical identity for one immutable Experiment slot.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ExperimentSlotId {
    pub experiment_id: String,
    pub row_id: String,
    pub trial_index: u32,
}

impl ExperimentSlotId {
    pub fn new(experiment_id: &str, row_id: &str, trial_index: u32) -> Self {
        Self {
            experiment_id: experiment_id.to_string(),
            row_id: row_id.to_string(),
            trial_index,
        }
    }

    pub fn idempotency_key(&self) -> String {
        format!(
            "{}:{}:{}",
            self.experiment_id, self.row_id, self.trial_index
        )
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentExecutionStatus {
    #[default]
    /// A durable Provider attempt intent exists, but no terminal result does.
    Pending,
    Ok,
    Error,
    Skipped,
}

/// Latest-wins execution result for one immutable Experiment slot.
///
/// `experiment_id`, `row_id`, and `trial_index` are its stable idempotency
/// identity. Dataset input and expected output remain in the pinned snapshot
/// and are deliberately not copied into this stream.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct ExperimentExecutionRecord {
    pub experiment_id: String,
    pub item_logical_id: String,
    pub row_id: String,
    pub trial_index: u32,
    pub status: ExperimentExecutionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    /// Permanent reason an intentionally ineligible slot was not executed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<ExperimentSkipReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_attempt_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_in: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_out: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_fingerprint: Option<String>,
    /// Client-reported event time. Informational only: it never controls
    /// ordering, idempotency, or the scoring precheck — `_timestamp` does, and
    /// only the server sets that.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executed_at: Option<i64>,
    pub _timestamp: i64,
}

impl ExperimentExecutionRecord {
    pub fn slot_id(&self) -> ExperimentSlotId {
        ExperimentSlotId::new(&self.experiment_id, &self.row_id, self.trial_index)
    }

    pub fn idempotency_key(&self) -> String {
        self.slot_id().idempotency_key()
    }

    pub fn is_terminal(&self) -> bool {
        self.status != ExperimentExecutionStatus::Pending
    }

    pub fn init_for_reflection() -> Self {
        Self {
            output: Some(serde_json::Value::String(String::new())),
            error_message: Some(String::new()),
            skip_reason: Some(ExperimentSkipReason::NoReference),
            error_attempt_count: Some(0),
            latency_ms: Some(0),
            tokens_in: Some(0),
            tokens_out: Some(0),
            cost: Some(0.0),
            trace_id: Some(String::new()),
            task_fingerprint: Some(String::new()),
            executed_at: Some(0),
            ..Self::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        ExperimentExecutionRecord, ExperimentExecutionStatus, ExperimentSkipReason,
        LLM_EXPERIMENT_STREAM,
    };

    #[test]
    fn execution_record_round_trips_the_normalized_slot_contract() {
        let record = ExperimentExecutionRecord {
            experiment_id: "experiment-1".to_string(),
            item_logical_id: "case-1".to_string(),
            row_id: "row-1".to_string(),
            trial_index: 0,
            status: ExperimentExecutionStatus::Ok,
            output: Some(json!("It ships tomorrow")),
            error_message: None,
            skip_reason: None,
            error_attempt_count: None,
            latency_ms: Some(42),
            tokens_in: Some(8),
            tokens_out: Some(3),
            cost: Some(0.0004),
            trace_id: Some("trace-1".to_string()),
            task_fingerprint: None,
            executed_at: None,
            _timestamp: 1_700_000_000_000_000,
        };

        let value = serde_json::to_value(&record).unwrap();
        let round_trip: ExperimentExecutionRecord = serde_json::from_value(value).unwrap();

        assert_eq!(LLM_EXPERIMENT_STREAM, "_llm_experiment");
        assert_eq!(round_trip, record);
        assert_eq!(round_trip.idempotency_key(), "experiment-1:row-1:0");
    }

    #[test]
    fn reflection_record_populates_every_optional_schema_field() {
        let value = serde_json::to_value(ExperimentExecutionRecord::init_for_reflection()).unwrap();
        let object = value.as_object().unwrap();

        for field in [
            "experiment_id",
            "item_logical_id",
            "row_id",
            "trial_index",
            "status",
            "output",
            "error_message",
            "skip_reason",
            "error_attempt_count",
            "latency_ms",
            "tokens_in",
            "tokens_out",
            "cost",
            "trace_id",
            "task_fingerprint",
            "executed_at",
            "_timestamp",
        ] {
            assert!(
                object.contains_key(field),
                "missing reflection field {field}"
            );
        }
    }

    #[test]
    fn pending_attempt_is_non_terminal_and_backward_compatible() {
        let pending: ExperimentExecutionRecord = serde_json::from_value(json!({
            "experiment_id": "experiment-1",
            "item_logical_id": "case-1",
            "row_id": "row-1",
            "trial_index": 0,
            "status": "pending",
            "task_fingerprint": "experiment-provider:experiment-1:row-1:0",
            "_timestamp": 10
        }))
        .unwrap();
        assert!(!pending.is_terminal());

        let old_terminal: ExperimentExecutionRecord = serde_json::from_value(json!({
            "experiment_id": "experiment-1",
            "item_logical_id": "case-1",
            "row_id": "row-1",
            "trial_index": 0,
            "status": "ok",
            "_timestamp": 11
        }))
        .unwrap();
        assert!(old_terminal.is_terminal());
        assert!(old_terminal.task_fingerprint.is_none());
        assert!(old_terminal.skip_reason.is_none());
    }

    #[test]
    fn no_reference_skip_is_terminal_and_round_trips() {
        let record = ExperimentExecutionRecord {
            experiment_id: "experiment-1".to_string(),
            item_logical_id: "case-1".to_string(),
            row_id: "row-1".to_string(),
            trial_index: 0,
            status: ExperimentExecutionStatus::Skipped,
            skip_reason: Some(ExperimentSkipReason::NoReference),
            _timestamp: 12,
            ..Default::default()
        };

        let value = serde_json::to_value(&record).unwrap();
        assert_eq!(value["skip_reason"], "no_reference");
        let round_trip: ExperimentExecutionRecord = serde_json::from_value(value).unwrap();

        assert!(round_trip.is_terminal());
        assert_eq!(
            round_trip.skip_reason,
            Some(ExperimentSkipReason::NoReference)
        );
    }
}
