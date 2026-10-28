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

use serde::{Deserialize, Serialize, de::Error as _};
use serde_json::Value;

pub const LLM_EXPERIMENT_STREAM: &str = "_llm_experiment";

/// Column for a non-string `output` as JSON text; ingestion flattening would otherwise lose it.
pub const STRUCTURED_OUTPUT_COLUMN: &str = "structured_output";

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
    /// Work accepted for a manual Slot retry that the Provider has not seen.
    Queued,
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
    /// Failure class from the shared evaluation taxonomy (`provider_auth`,
    /// `timeout`, `execution_error`, …). Absent on records written before it
    /// existed, which group by message alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
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
        !matches!(
            self.status,
            ExperimentExecutionStatus::Queued | ExperimentExecutionStatus::Pending
        )
    }

    pub fn init_for_reflection() -> Self {
        Self {
            output: Some(serde_json::Value::String(String::new())),
            error_message: Some(String::new()),
            error_kind: Some(String::new()),
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

    /// Encodes this record as one `_llm_experiment` row; not in `Serialize`, which is the API
    /// shape.
    pub fn to_stream_value(&self) -> serde_json::Result<Value> {
        let mut value = serde_json::to_value(self)?;
        if let Some(object) = value.as_object_mut()
            && let Some(output) = object.remove("output")
        {
            if output.is_string() {
                object.insert("output".to_string(), output);
            } else {
                object.insert(
                    STRUCTURED_OUTPUT_COLUMN.to_string(),
                    Value::String(output.to_string()),
                );
            }
        }
        Ok(value)
    }

    /// Decodes a row from [`Self::to_stream_value`]; a non-JSON `structured_output` fails to load.
    pub fn from_stream_value(mut value: Value) -> serde_json::Result<Self> {
        if let Some(object) = value.as_object_mut()
            && let Some(encoded) = object.remove(STRUCTURED_OUTPUT_COLUMN)
            && !encoded.is_null()
        {
            let encoded = encoded.as_str().ok_or_else(|| {
                serde_json::Error::custom(format!(
                    "{STRUCTURED_OUTPUT_COLUMN} must hold JSON text, found {encoded}"
                ))
            })?;
            object.insert("output".to_string(), serde_json::from_str(encoded)?);
        }
        serde_json::from_value(value)
    }

    /// One stream row with every column populated, for schema inference.
    pub fn stream_reflection_value() -> serde_json::Result<Value> {
        let mut value = Self::init_for_reflection().to_stream_value()?;
        if let Some(object) = value.as_object_mut() {
            object.insert(
                STRUCTURED_OUTPUT_COLUMN.to_string(),
                Value::String(String::new()),
            );
        }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        ExperimentExecutionRecord, ExperimentExecutionStatus, ExperimentSkipReason,
        LLM_EXPERIMENT_STREAM, STRUCTURED_OUTPUT_COLUMN,
    };

    fn ok_record(output: serde_json::Value) -> ExperimentExecutionRecord {
        ExperimentExecutionRecord {
            experiment_id: "experiment-1".to_string(),
            item_logical_id: "case-1".to_string(),
            row_id: "row-1".to_string(),
            trial_index: 0,
            status: ExperimentExecutionStatus::Ok,
            output: Some(output),
            _timestamp: 13,
            ..Default::default()
        }
    }

    /// What ingestion stores for one record: the stream encoding, flattened.
    fn ingested(record: &ExperimentExecutionRecord) -> serde_json::Value {
        crate::utils::flatten::flatten(record.to_stream_value().unwrap()).unwrap()
    }

    #[test]
    fn structured_output_survives_ingestion_flattening_as_one_column() {
        let output = json!({
            "report": "# Incident Analysis Report",
            "run_id": "run-1",
            "grade": {"band": "medium", "reasons": ["a", "b"]},
            "hypotheses": [{"id": "h1", "evidence": [{"id": "e1"}]}],
        });
        let stored = ingested(&ok_record(output.clone()));
        let object = stored.as_object().unwrap();

        assert!(
            object.keys().all(|key| !key.starts_with("output")),
            "a nested output key widened the stream schema: {:?}",
            object.keys().collect::<Vec<_>>()
        );
        assert!(object[STRUCTURED_OUTPUT_COLUMN].is_string());

        let loaded = ExperimentExecutionRecord::from_stream_value(stored).unwrap();
        assert_eq!(loaded.output, Some(output));
    }

    #[test]
    fn stream_encoding_round_trips_every_output_shape() {
        for output in [
            json!({"a": 1}),
            json!([1, 2, 3]),
            json!(7),
            json!(true),
            json!("a bare string"),
            json!("{\"looks\": \"like json\"}"),
        ] {
            let record = ok_record(output);
            let loaded = ExperimentExecutionRecord::from_stream_value(ingested(&record)).unwrap();
            assert_eq!(loaded, record);
        }
    }

    /// String outputs keep the legacy `output` column so pre-existing rows still load.
    #[test]
    fn string_output_keeps_the_output_column() {
        let stored = ingested(&ok_record(json!("It ships tomorrow")));

        assert_eq!(stored["output"], json!("It ships tomorrow"));
        assert!(stored.get(STRUCTURED_OUTPUT_COLUMN).is_none());

        let legacy = json!({
            "experiment_id": "experiment-1",
            "item_logical_id": "case-1",
            "row_id": "row-1",
            "trial_index": 0,
            "status": "ok",
            "output": "It ships tomorrow",
            "structured_output": null,
            "_timestamp": 13
        });
        let loaded = ExperimentExecutionRecord::from_stream_value(legacy).unwrap();
        assert_eq!(loaded.output, Some(json!("It ships tomorrow")));
    }

    /// The typed record is also the API shape: it keeps `output` as JSON.
    #[test]
    fn typed_serialization_keeps_structured_output_as_json() {
        let value = serde_json::to_value(ok_record(json!({"report": "r"}))).unwrap();

        assert_eq!(value["output"], json!({"report": "r"}));
        assert!(value.get(STRUCTURED_OUTPUT_COLUMN).is_none());
    }

    #[test]
    fn a_structured_output_column_that_is_not_json_text_fails_to_load() {
        let mut stored = ingested(&ok_record(json!({"a": 1})));
        stored[STRUCTURED_OUTPUT_COLUMN] = json!({"a": 1});
        assert!(ExperimentExecutionRecord::from_stream_value(stored).is_err());

        let mut stored = ingested(&ok_record(json!({"a": 1})));
        stored[STRUCTURED_OUTPUT_COLUMN] = json!("not json");
        assert!(ExperimentExecutionRecord::from_stream_value(stored).is_err());
    }

    #[test]
    fn stream_reflection_populates_both_output_columns() {
        let value = ExperimentExecutionRecord::stream_reflection_value().unwrap();

        assert!(value["output"].is_string());
        assert!(value[STRUCTURED_OUTPUT_COLUMN].is_string());
    }

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
            error_kind: None,
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
            "error_kind",
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
    fn queued_and_pending_attempts_are_non_terminal_and_backward_compatible() {
        for status in ["queued", "pending"] {
            let attempt: ExperimentExecutionRecord = serde_json::from_value(json!({
                "experiment_id": "experiment-1",
                "item_logical_id": "case-1",
                "row_id": "row-1",
                "trial_index": 0,
                "status": status,
                "task_fingerprint": "experiment-provider:experiment-1:row-1:0",
                "_timestamp": 10
            }))
            .unwrap();
            assert!(!attempt.is_terminal());
        }

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
