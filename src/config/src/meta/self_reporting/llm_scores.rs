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

use std::{
    collections::{BTreeMap, btree_map::Entry},
    fmt,
};

use serde::{Deserialize, Serialize};

use super::llm_experiments::ExperimentSkipReason;

pub const LLM_SCORES_STREAM: &str = "_llm_scores";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmScoreDataSourceType {
    LlmJudge,
    Code,
    Remote,
    Annotation,
    Feedback,
    Experiment,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmScoreDataLevel {
    Span,
    Trace,
    Session,
    Experiment,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmScoreDataType {
    Numeric,
    Categorical,
    Boolean,
}

/// Outcome of one scorer dimension for one target.
///
/// Older score records predate this field, so successful scoring remains the
/// deserialization default.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmScoreStatus {
    #[default]
    Success,
    Skipped,
    /// The scorer exhausted its bounded attempts without producing a value.
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmScoreTargetScope {
    Span,
    Trace,
    Session,
    Experiment,
}

impl fmt::Display for LlmScoreTargetScope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Span => "span",
            Self::Trace => "trace",
            Self::Session => "session",
            Self::Experiment => "experiment",
        })
    }
}

impl From<LlmScoreTargetScope> for LlmScoreDataLevel {
    fn from(value: LlmScoreTargetScope) -> Self {
        match value {
            LlmScoreTargetScope::Span => Self::Span,
            LlmScoreTargetScope::Trace => Self::Trace,
            LlmScoreTargetScope::Session => Self::Session,
            LlmScoreTargetScope::Experiment => Self::Experiment,
        }
    }
}

/// Producer identity used to build the read-side deduplication key.
#[derive(Clone, Copy, Debug)]
pub enum LlmScoreEvaluationSource<'a> {
    Automated {
        job_id: &'a str,
        scorer_id: &'a str,
    },
    Annotation {
        annotation_id: &'a str,
        score_config_id: &'a str,
    },
    Experiment {
        experiment_id: &'a str,
        scorer_id: &'a str,
        row_id: &'a str,
        trial_index: u32,
    },
    /// A Score the customer's own code produced and reported. It has no Scorer
    /// to identify it, so the client-supplied scorer key takes that place.
    ClientExperiment {
        experiment_id: &'a str,
        client_scorer_key: &'a str,
        /// Physical Score Config row. It pins the exact version, so a mid-run
        /// `ensure()` version bump stays a separate dimension instead of
        /// collapsing onto the earlier one.
        score_config_row_id: &'a str,
        row_id: &'a str,
        trial_index: u32,
    },
}

/// Build the stable JSON identity used to select the latest Score from one
/// producer for one target. Automated producer IDs come from the evaluation
/// job; annotation and Score Config IDs are generated or resolved server-side.
/// The JSON is stored as a string because SQL and OpenTelemetry consume the key
/// as a scalar.
pub fn evaluation_key(
    org_id: &str,
    source: LlmScoreEvaluationSource<'_>,
    target_scope: LlmScoreTargetScope,
    target_id: &str,
) -> String {
    match source {
        LlmScoreEvaluationSource::Automated { job_id, scorer_id } => serde_json::json!({
            "orgId": org_id,
            "source": "automated",
            "jobId": job_id,
            "scorerId": scorer_id,
            "scope": target_scope,
            "targetId": target_id,
        }),
        LlmScoreEvaluationSource::Annotation {
            annotation_id,
            score_config_id,
        } => serde_json::json!({
            "orgId": org_id,
            "source": "annotation",
            "annotationId": annotation_id,
            "scoreConfigId": score_config_id,
            "scope": target_scope,
            "targetId": target_id,
        }),
        LlmScoreEvaluationSource::Experiment {
            experiment_id,
            scorer_id,
            row_id,
            trial_index,
        } => serde_json::json!({
            "orgId": org_id,
            "source": "experiment",
            "experimentId": experiment_id,
            "scorerId": scorer_id,
            "rowId": row_id,
            "trialIndex": trial_index,
        }),
        LlmScoreEvaluationSource::ClientExperiment {
            experiment_id,
            client_scorer_key,
            score_config_row_id,
            row_id,
            trial_index,
        } => serde_json::json!({
            "orgId": org_id,
            "source": "client_experiment",
            "experimentId": experiment_id,
            "clientScorerKey": client_scorer_key,
            "scoreConfigRowId": score_config_row_id,
            "rowId": row_id,
            "trialIndex": trial_index,
        }),
    }
    .to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LlmScoreRecord {
    pub id: String,
    pub task_id: String,
    pub eval_run_id: String,
    pub evaluator_trace_id: String,
    pub org_id: String,
    /// Canonical evaluated target identity for latest-score grouping.
    pub target_scope: LlmScoreTargetScope,
    pub target_id: String,
    pub evaluation_key: String,
    pub score_version: i64,
    /// Timestamp of the evaluated span, trace, or session. This stays distinct
    /// from `_timestamp`, which records when the Score itself was written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trial_index: Option<u32>,
    /// `_timestamp` of the Experiment execution record being scored. A score
    /// is fresh only while this still matches the latest execution record.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_ts: Option<i64>,
    pub level: LlmScoreDataLevel,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_numeric: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_categorical: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_boolean: Option<bool>,
    pub data_type: LlmScoreDataType,
    #[serde(default)]
    pub status: LlmScoreStatus,
    /// Permanent reason this dimension was intentionally not scored.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<ExperimentSkipReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scorer_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scorer_version: Option<String>,
    /// True when the customer's own code produced this Score and reported it
    /// through the SDK. A client Score never carries a Scorer reference, so
    /// this is what separates it from a platform Score in every query.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_reported: Option<bool>,
    /// Stable client-supplied identity for one local scorer. It separates
    /// multiple client dimensions that bind the same Score Config.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_scorer_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_config_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_config_version: Option<String>,
    /// Physical immutable Score Config row used for this Score. Queue reviews
    /// use it to prove exact N/N rubric coverage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_config_row_id: Option<String>,
    /// Logical N/N grouping key for authoritative annotation-source Scores.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_submission_id: Option<String>,
    /// Queue provenance for Workbench review Scores. Together with
    /// `review_submission_id`, these fields make `_llm_scores` independently
    /// queryable without a relational Review or Review Score table.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_item_id: Option<String>,
    /// Distinct physical Score Config rows required for this complete N/N
    /// review submission.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_submission_score_count: Option<i64>,
    /// Overall comment for the complete Review Submission. Annotation
    /// projection repeats this value on each Score in the submission.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_submission_comments: Option<String>,
    pub source_type: LlmScoreDataSourceType,
    /// Original scorer provenance before an Experiment wraps the score in its
    /// own queryable source type. Older records omit this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_source_type: Option<LlmScoreDataSourceType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_stream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_stream_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_env: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_version: Option<i32>,
    /// Justification for this individual Score dimension.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub _timestamp: i64,
}

impl Default for LlmScoreRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            task_id: String::new(),
            eval_run_id: String::new(),
            evaluator_trace_id: String::new(),
            org_id: String::new(),
            target_scope: LlmScoreTargetScope::Span,
            target_id: String::new(),
            evaluation_key: String::new(),
            score_version: 0,
            ref_timestamp: None,
            span_id: None,
            trace_id: None,
            session_id: None,
            experiment_id: None,
            row_id: None,
            trial_index: None,
            record_ts: None,
            level: LlmScoreDataLevel::Span,
            name: String::new(),
            value_numeric: None,
            value_categorical: None,
            value_boolean: None,
            data_type: LlmScoreDataType::Numeric,
            status: LlmScoreStatus::Success,
            skip_reason: None,
            scorer_id: None,
            scorer_version: None,
            client_reported: None,
            client_scorer_key: None,
            score_config_id: None,
            score_config_version: None,
            score_config_row_id: None,
            review_submission_id: None,
            queue_id: None,
            queue_item_id: None,
            review_submission_score_count: None,
            review_submission_comments: None,
            source_type: LlmScoreDataSourceType::LlmJudge,
            origin_source_type: None,
            source_stream: None,
            source_stream_type: None,
            agent_name: None,
            agent_id: None,
            agent_env: None,
            agent_version: None,
            job_id: None,
            job_version: None,
            reasoning: None,
            metadata: None,
            author: None,
            _timestamp: 0,
        }
    }
}

impl LlmScoreRecord {
    pub fn init_for_reflection() -> Self {
        Self {
            ref_timestamp: Some(0),
            span_id: Some(String::new()),
            trace_id: Some(String::new()),
            session_id: Some(String::new()),
            experiment_id: Some(String::new()),
            row_id: Some(String::new()),
            trial_index: Some(0),
            record_ts: Some(0),
            value_numeric: Some(0.0),
            value_categorical: Some(String::new()),
            value_boolean: Some(false),
            scorer_id: Some(String::new()),
            scorer_version: Some(String::new()),
            client_reported: Some(false),
            client_scorer_key: Some(String::new()),
            score_config_id: Some(String::new()),
            score_config_version: Some(String::new()),
            score_config_row_id: Some(String::new()),
            review_submission_id: Some(String::new()),
            queue_id: Some(String::new()),
            queue_item_id: Some(String::new()),
            review_submission_score_count: Some(0),
            review_submission_comments: Some(String::new()),
            origin_source_type: Some(LlmScoreDataSourceType::Remote),
            source_stream: Some(String::new()),
            source_stream_type: Some(String::new()),
            agent_env: Some(String::new()),
            agent_version: Some(String::new()),
            job_id: Some(String::new()),
            job_version: Some(0),
            reasoning: Some(String::new()),
            skip_reason: Some(ExperimentSkipReason::NoReference),
            metadata: Some(serde_json::json!({})),
            author: Some(String::new()),
            ..Self::default()
        }
    }

    pub fn is_newer_than(&self, other: &Self) -> bool {
        (self.score_version, self._timestamp, self.id.as_str())
            > (other.score_version, other._timestamp, other.id.as_str())
    }
}

pub fn latest_score_records<I>(records: I) -> Vec<LlmScoreRecord>
where
    I: IntoIterator<Item = LlmScoreRecord>,
{
    let mut latest_by_key = BTreeMap::<String, LlmScoreRecord>::new();
    for record in records {
        match latest_by_key.entry(record.evaluation_key.clone()) {
            Entry::Occupied(mut entry) => {
                if record.is_newer_than(entry.get()) {
                    entry.insert(record);
                }
            }
            Entry::Vacant(entry) => {
                entry.insert(record);
            }
        }
    }

    latest_by_key.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_score_records_default_to_success() {
        let value = serde_json::json!({
            "id": "score-1",
            "task_id": "task-1",
            "eval_run_id": "run-1",
            "evaluator_trace_id": "trace-1",
            "org_id": "org-1",
            "target_scope": "experiment",
            "target_id": "target-1",
            "evaluation_key": "key-1",
            "score_version": 1,
            "level": "experiment",
            "name": "quality",
            "data_type": "numeric",
            "source_type": "experiment",
            "_timestamp": 1
        });

        let record: LlmScoreRecord = serde_json::from_value(value).unwrap();

        assert_eq!(record.status, LlmScoreStatus::Success);
        assert!(record.skip_reason.is_none());
        assert!(record.origin_source_type.is_none());
    }

    fn test_score_record(
        id: &str,
        evaluation_key: &str,
        score_version: i64,
        timestamp: i64,
        source_type: LlmScoreDataSourceType,
        value_numeric: f64,
    ) -> LlmScoreRecord {
        LlmScoreRecord {
            id: id.to_string(),
            task_id: "task-1".to_string(),
            eval_run_id: "run-1".to_string(),
            evaluator_trace_id: "11111111111111111111111111111111".to_string(),
            org_id: "org-1".to_string(),
            target_scope: LlmScoreTargetScope::Span,
            target_id: "span-1".to_string(),
            evaluation_key: evaluation_key.to_string(),
            score_version,
            ref_timestamp: None,
            span_id: Some("span-1".to_string()),
            trace_id: Some("trace-1".to_string()),
            session_id: None,
            experiment_id: None,
            row_id: None,
            trial_index: None,
            record_ts: None,
            level: LlmScoreDataLevel::Span,
            name: "faithfulness".to_string(),
            value_numeric: Some(value_numeric),
            value_categorical: None,
            value_boolean: None,
            data_type: LlmScoreDataType::Numeric,
            status: LlmScoreStatus::Success,
            skip_reason: None,
            scorer_id: Some("scorer-1".to_string()),
            scorer_version: Some("1".to_string()),
            client_reported: None,
            client_scorer_key: None,
            score_config_id: Some("cfg-1".to_string()),
            score_config_version: Some("1".to_string()),
            score_config_row_id: None,
            review_submission_id: None,
            queue_id: None,
            queue_item_id: None,
            review_submission_score_count: None,
            review_submission_comments: None,
            source_type,
            origin_source_type: None,
            source_stream: Some("traces".to_string()),
            source_stream_type: Some("traces".to_string()),
            agent_name: None,
            agent_id: None,
            agent_env: None,
            agent_version: None,
            job_id: Some("job-1".to_string()),
            job_version: Some(1),
            reasoning: None,
            metadata: None,
            author: None,
            _timestamp: timestamp,
        }
    }

    #[test]
    fn test_llm_score_record_round_trip() {
        let record = LlmScoreRecord {
            ref_timestamp: Some(1699999999000),
            id: "s-1".to_string(),
            task_id: "task-1".to_string(),
            eval_run_id: "run-1".to_string(),
            evaluator_trace_id: "11111111111111111111111111111111".to_string(),
            org_id: "org-1".to_string(),
            target_scope: LlmScoreTargetScope::Span,
            target_id: "span-1".to_string(),
            evaluation_key: serde_json::json!({
                "orgId": "org-1",
                "source": "automated",
                "jobId": "job-1",
                "scorerId": "sc-1",
                "scope": "span",
                "targetId": "span-1",
            })
            .to_string(),
            score_version: 1700000000000,
            span_id: Some("span-1".to_string()),
            trace_id: Some("trace-1".to_string()),
            level: LlmScoreDataLevel::Span,
            name: "faithfulness".to_string(),
            value_numeric: Some(0.95),
            data_type: LlmScoreDataType::Numeric,
            scorer_id: Some("sc-1".to_string()),
            scorer_version: Some("1".to_string()),
            score_config_id: Some("cfg-entity-1".to_string()),
            score_config_version: Some("1".to_string()),
            source_type: LlmScoreDataSourceType::LlmJudge,
            source_stream: Some("traces".to_string()),
            source_stream_type: Some("traces".to_string()),
            agent_name: Some("agent-a".to_string()),
            agent_id: Some("agent-1".to_string()),
            agent_env: Some("prod".to_string()),
            agent_version: Some("1.2.0".to_string()),
            job_id: Some("job-1".to_string()),
            job_version: Some(1),
            _timestamp: 1700000000000,
            ..LlmScoreRecord::default()
        };
        let json = serde_json::to_string(&record).unwrap();
        let back: LlmScoreRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "s-1");
        assert_eq!(back.org_id, "org-1");
        assert_eq!(back.target_scope, LlmScoreTargetScope::Span);
        assert_eq!(back.target_id, "span-1");
        assert_eq!(back.score_version, 1700000000000);
        assert_eq!(back.ref_timestamp, Some(1699999999000));
        assert_eq!(back.span_id, Some("span-1".to_string()));
        assert_eq!(back.value_numeric, Some(0.95));
        assert_eq!(back.level, LlmScoreDataLevel::Span);
        assert_eq!(back.score_config_id, Some("cfg-entity-1".to_string()));
        assert_eq!(back.source_stream_type, Some("traces".to_string()));
        assert_eq!(back.agent_name, Some("agent-a".to_string()));
        assert_eq!(back.agent_id, Some("agent-1".to_string()));
    }

    #[test]
    fn annotation_score_keeps_dimension_reasoning_and_submission_comments_distinct() {
        let mut record = test_score_record(
            "annotation-score-1",
            "org=org-1;submission=submission-1;config=cfg-1;target=span-1",
            1,
            1,
            LlmScoreDataSourceType::Annotation,
            0.9,
        );
        record.review_submission_id = Some("submission-1".to_string());
        record.reasoning = Some("Reason for this dimension".to_string());
        record.review_submission_comments = Some("Overall reviewer comment".to_string());

        let json = serde_json::to_value(&record).unwrap();
        assert_eq!(json["review_submission_id"], "submission-1");
        assert_eq!(json["reasoning"], "Reason for this dimension");
        assert_eq!(
            json["review_submission_comments"],
            "Overall reviewer comment"
        );
    }

    #[test]
    fn test_llm_score_record_reflection_has_all_fields() {
        let record = LlmScoreRecord::init_for_reflection();
        let json = serde_json::to_value(&record).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("id"));
        assert!(obj.contains_key("org_id"));
        assert!(obj.contains_key("target_scope"));
        assert!(obj.contains_key("target_id"));
        assert!(obj.contains_key("evaluation_key"));
        assert!(obj.contains_key("score_version"));
        assert!(obj.contains_key("ref_timestamp"));
        assert!(obj.contains_key("span_id"));
        assert!(obj.contains_key("trace_id"));
        assert!(obj.contains_key("session_id"));
        assert!(obj.contains_key("experiment_id"));
        assert!(obj.contains_key("row_id"));
        assert!(obj.contains_key("trial_index"));
        assert!(obj.contains_key("record_ts"));
        assert!(obj.contains_key("level"));
        assert!(obj.contains_key("name"));
        assert!(obj.contains_key("value_numeric"));
        assert!(obj.contains_key("value_categorical"));
        assert!(obj.contains_key("value_boolean"));
        assert!(obj.contains_key("data_type"));
        assert!(obj.contains_key("status"));
        assert!(obj.contains_key("skip_reason"));
        assert!(obj.contains_key("scorer_id"));
        assert!(obj.contains_key("scorer_version"));
        assert!(obj.contains_key("score_config_id"));
        assert!(!obj.contains_key("score_config_entity_id"));
        assert!(obj.contains_key("score_config_version"));
        assert!(obj.contains_key("score_config_row_id"));
        assert!(obj.contains_key("review_submission_id"));
        assert!(obj.contains_key("queue_id"));
        assert!(obj.contains_key("queue_item_id"));
        assert!(obj.contains_key("review_submission_score_count"));
        assert!(obj.contains_key("source_type"));
        assert!(obj.contains_key("source_stream"));
        assert!(obj.contains_key("source_stream_type"));
        assert!(!obj.contains_key("agent_name"));
        assert!(!obj.contains_key("agent_id"));
        assert!(!obj.contains_key("target_agent_name"));
        assert!(!obj.contains_key("target_agent_id"));
        assert!(obj.contains_key("job_id"));
        assert!(obj.contains_key("reasoning"));
        assert!(obj.contains_key("review_submission_comments"));
        assert!(obj.contains_key("metadata"));
        assert!(obj.contains_key("author"));
        assert!(obj.contains_key("_timestamp"));
    }

    #[test]
    fn test_llm_score_record_skip_none() {
        let record = LlmScoreRecord {
            id: "s-1".to_string(),
            task_id: "task-1".to_string(),
            eval_run_id: "run-1".to_string(),
            evaluator_trace_id: "11111111111111111111111111111111".to_string(),
            org_id: "org-1".to_string(),
            target_scope: LlmScoreTargetScope::Trace,
            target_id: "trace-1".to_string(),
            evaluation_key: serde_json::json!({
                "orgId": "org-1",
                "source": "automated",
                "jobId": "",
                "scorerId": "",
                "scope": "trace",
                "targetId": "trace-1",
            })
            .to_string(),
            level: LlmScoreDataLevel::Trace,
            name: "test".to_string(),
            ..LlmScoreRecord::default()
        };
        let json = serde_json::to_value(&record).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("span_id"));
        assert!(!obj.contains_key("ref_timestamp"));
        assert!(!obj.contains_key("trace_id"));
        assert!(!obj.contains_key("session_id"));
        assert!(!obj.contains_key("experiment_id"));
        assert!(!obj.contains_key("row_id"));
        assert!(!obj.contains_key("trial_index"));
        assert!(!obj.contains_key("record_ts"));
        assert!(!obj.contains_key("value_numeric"));
        assert!(!obj.contains_key("value_categorical"));
        assert!(!obj.contains_key("value_boolean"));
        assert!(!obj.contains_key("scorer_id"));
        assert!(!obj.contains_key("score_config_id"));
        assert!(!obj.contains_key("review_submission_id"));
        assert!(!obj.contains_key("agent_name"));
        assert!(!obj.contains_key("agent_id"));
        assert!(!obj.contains_key("reasoning"));
        assert!(!obj.contains_key("review_submission_comments"));
        assert!(!obj.contains_key("author"));
    }

    #[test]
    fn test_latest_score_records_selects_newest_version_per_evaluation_key() {
        let key_a = "org=org-1;job=job-1;scorer=scorer-1;scope=span;target=span-1";
        let key_b = "org=org-1;job=job-1;scorer=scorer-1;scope=span;target=span-2";
        let older_a = test_score_record(
            "a-old",
            key_a,
            10,
            10,
            LlmScoreDataSourceType::LlmJudge,
            0.1,
        );
        let newer_a = test_score_record(
            "a-new",
            key_a,
            20,
            20,
            LlmScoreDataSourceType::LlmJudge,
            0.9,
        );
        let only_b = test_score_record(
            "b-only",
            key_b,
            15,
            15,
            LlmScoreDataSourceType::LlmJudge,
            0.5,
        );

        let latest = latest_score_records(vec![older_a, only_b, newer_a]);

        assert_eq!(latest.len(), 2);
        assert_eq!(latest[0].evaluation_key, key_a);
        assert_eq!(latest[0].id, "a-new");
        assert_eq!(latest[0].value_numeric, Some(0.9));
        assert_eq!(latest[1].evaluation_key, key_b);
        assert_eq!(latest[1].id, "b-only");
    }

    #[test]
    fn test_latest_score_records_uses_deterministic_tiebreaker() {
        let key = "org=org-1;job=job-1;scorer=scorer-1;scope=span;target=span-1";
        let lower_id = test_score_record(
            "version-a",
            key,
            20,
            20,
            LlmScoreDataSourceType::LlmJudge,
            0.1,
        );
        let higher_id = test_score_record(
            "version-b",
            key,
            20,
            20,
            LlmScoreDataSourceType::LlmJudge,
            0.9,
        );

        let latest = latest_score_records(vec![higher_id, lower_id]);

        assert_eq!(latest.len(), 1);
        assert_eq!(latest[0].id, "version-b");
    }

    #[test]
    fn test_latest_score_records_manual_re_evaluation_wins_by_version() {
        let key = "org=org-1;job=job-1;scorer=scorer-1;scope=span;target=span-1";
        let automatic =
            test_score_record("auto", key, 10, 10, LlmScoreDataSourceType::LlmJudge, 0.4);
        let mut manual = test_score_record(
            "manual",
            key,
            30,
            30,
            LlmScoreDataSourceType::Annotation,
            0.8,
        );
        manual.metadata = Some(serde_json::json!({"reason": "operator requested re-evaluation"}));
        manual.author = Some("operator@example.com".to_string());

        let latest = latest_score_records(vec![automatic, manual]);

        assert_eq!(latest.len(), 1);
        assert_eq!(latest[0].id, "manual");
        assert_eq!(latest[0].source_type, LlmScoreDataSourceType::Annotation);
        assert_eq!(latest[0].value_numeric, Some(0.8));
        assert_eq!(
            latest[0].metadata,
            Some(serde_json::json!({"reason": "operator requested re-evaluation"}))
        );
    }

    #[test]
    fn test_source_type_serialization() {
        assert_eq!(
            serde_json::to_string(&LlmScoreDataSourceType::LlmJudge).unwrap(),
            "\"llm_judge\""
        );
        assert_eq!(
            serde_json::to_string(&LlmScoreDataSourceType::Annotation).unwrap(),
            "\"annotation\""
        );
        assert_eq!(
            serde_json::to_string(&LlmScoreDataSourceType::Experiment).unwrap(),
            "\"experiment\""
        );
    }

    #[test]
    fn experiment_score_identity_and_freshness_round_trip() {
        let record = LlmScoreRecord {
            experiment_id: Some("experiment-1".to_string()),
            row_id: Some("row-1".to_string()),
            trial_index: Some(2),
            record_ts: Some(1_700_000_000_000_000),
            target_scope: LlmScoreTargetScope::Experiment,
            target_id: "experiment-1:row-1:2".to_string(),
            level: LlmScoreDataLevel::Experiment,
            source_type: LlmScoreDataSourceType::Experiment,
            origin_source_type: Some(LlmScoreDataSourceType::Remote),
            ..LlmScoreRecord::default()
        };

        let json = serde_json::to_string(&record).unwrap();
        let back: LlmScoreRecord = serde_json::from_str(&json).unwrap();

        assert_eq!(back.experiment_id.as_deref(), Some("experiment-1"));
        assert_eq!(back.row_id.as_deref(), Some("row-1"));
        assert_eq!(back.trial_index, Some(2));
        assert_eq!(back.record_ts, Some(1_700_000_000_000_000));
        assert_eq!(back.target_scope, LlmScoreTargetScope::Experiment);
        assert_eq!(back.source_type, LlmScoreDataSourceType::Experiment);
        assert_eq!(
            back.origin_source_type,
            Some(LlmScoreDataSourceType::Remote)
        );
    }

    #[test]
    fn test_data_type_serialization() {
        assert_eq!(
            serde_json::to_string(&LlmScoreDataType::Numeric).unwrap(),
            "\"numeric\""
        );
        assert_eq!(
            serde_json::to_string(&LlmScoreDataType::Categorical).unwrap(),
            "\"categorical\""
        );
        assert_eq!(
            serde_json::to_string(&LlmScoreDataType::Boolean).unwrap(),
            "\"boolean\""
        );
    }

    #[test]
    fn target_scope_display_matches_stream_values() {
        assert_eq!(LlmScoreTargetScope::Span.to_string(), "span");
        assert_eq!(LlmScoreTargetScope::Trace.to_string(), "trace");
        assert_eq!(LlmScoreTargetScope::Session.to_string(), "session");
        assert_eq!(LlmScoreTargetScope::Experiment.to_string(), "experiment");
    }

    #[test]
    fn evaluation_keys_are_structured_json() {
        let automated = evaluation_key(
            "org=1",
            LlmScoreEvaluationSource::Automated {
                job_id: "job;1",
                scorer_id: "scorer%1",
            },
            LlmScoreTargetScope::Span,
            "span=1;2",
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&automated).unwrap(),
            serde_json::json!({
                "orgId": "org=1",
                "source": "automated",
                "jobId": "job;1",
                "scorerId": "scorer%1",
                "scope": "span",
                "targetId": "span=1;2",
            })
        );

        let annotation = evaluation_key(
            "org-1",
            LlmScoreEvaluationSource::Annotation {
                annotation_id: "annotation-1",
                score_config_id: "config-1",
            },
            LlmScoreTargetScope::Trace,
            "trace-1",
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&annotation).unwrap(),
            serde_json::json!({
                "orgId": "org-1",
                "source": "annotation",
                "annotationId": "annotation-1",
                "scoreConfigId": "config-1",
                "scope": "trace",
                "targetId": "trace-1",
            })
        );

        let experiment = evaluation_key(
            "org-1",
            LlmScoreEvaluationSource::Experiment {
                experiment_id: "experiment-1",
                scorer_id: "scorer-1",
                row_id: "row-1",
                trial_index: 2,
            },
            LlmScoreTargetScope::Experiment,
            "ignored-for-experiment-identity",
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&experiment).unwrap(),
            serde_json::json!({
                "orgId": "org-1",
                "source": "experiment",
                "experimentId": "experiment-1",
                "scorerId": "scorer-1",
                "rowId": "row-1",
                "trialIndex": 2,
            })
        );
    }

    #[test]
    fn score_record_default_is_safe_for_selective_construction() {
        let record = LlmScoreRecord::default();
        assert!(record.id.is_empty());
        assert_eq!(record.target_scope, LlmScoreTargetScope::Span);
        assert_eq!(record.level, LlmScoreDataLevel::Span);
        assert_eq!(record.data_type, LlmScoreDataType::Numeric);
        assert!(record.scorer_id.is_none());
        assert!(record.agent_id.is_none());
        assert!(record.ref_timestamp.is_none());
    }
}
