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

use std::collections::{BTreeMap, btree_map::Entry};

use serde::{Deserialize, Serialize};

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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmScoreTargetScope {
    Span,
    Trace,
    Session,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment_id: Option<String>,
    pub level: LlmScoreDataLevel,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_numeric: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_categorical: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_boolean: Option<bool>,
    pub data_type: LlmScoreDataType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scorer_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scorer_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_config_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_config_version: Option<String>,
    pub source_type: LlmScoreDataSourceType,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub _timestamp: i64,
}

impl LlmScoreRecord {
    pub fn init_for_reflection() -> Self {
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
            span_id: Some(String::new()),
            trace_id: Some(String::new()),
            session_id: Some(String::new()),
            experiment_id: Some(String::new()),
            level: LlmScoreDataLevel::Span,
            name: String::new(),
            value_numeric: Some(0.0),
            value_categorical: Some(String::new()),
            value_boolean: Some(false),
            data_type: LlmScoreDataType::Numeric,
            scorer_id: Some(String::new()),
            scorer_version: Some(String::new()),
            score_config_id: Some(String::new()),
            score_config_version: Some(String::new()),
            source_type: LlmScoreDataSourceType::LlmJudge,
            source_stream: Some(String::new()),
            source_stream_type: Some(String::new()),
            agent_name: None,
            agent_id: None,
            agent_env: Some(String::new()),
            agent_version: Some(String::new()),
            job_id: Some(String::new()),
            job_version: Some(0),
            reasoning: Some(String::new()),
            metadata: Some(serde_json::json!({})),
            author: Some(String::new()),
            _timestamp: 0,
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
            span_id: Some("span-1".to_string()),
            trace_id: Some("trace-1".to_string()),
            session_id: None,
            experiment_id: None,
            level: LlmScoreDataLevel::Span,
            name: "faithfulness".to_string(),
            value_numeric: Some(value_numeric),
            value_categorical: None,
            value_boolean: None,
            data_type: LlmScoreDataType::Numeric,
            scorer_id: Some("scorer-1".to_string()),
            scorer_version: Some("1".to_string()),
            score_config_id: Some("cfg-1".to_string()),
            score_config_version: Some("1".to_string()),
            source_type,
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
            id: "s-1".to_string(),
            task_id: "task-1".to_string(),
            eval_run_id: "run-1".to_string(),
            evaluator_trace_id: "11111111111111111111111111111111".to_string(),
            org_id: "org-1".to_string(),
            target_scope: LlmScoreTargetScope::Span,
            target_id: "span-1".to_string(),
            evaluation_key: "org=org-1;job=job-1;scorer=sc-1;scope=span;target=span-1".to_string(),
            score_version: 1700000000000,
            span_id: Some("span-1".to_string()),
            trace_id: Some("trace-1".to_string()),
            session_id: None,
            experiment_id: None,
            level: LlmScoreDataLevel::Span,
            name: "faithfulness".to_string(),
            value_numeric: Some(0.95),
            value_categorical: None,
            value_boolean: None,
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
            reasoning: None,
            metadata: None,
            author: None,
            _timestamp: 1700000000000,
        };
        let json = serde_json::to_string(&record).unwrap();
        let back: LlmScoreRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "s-1");
        assert_eq!(back.org_id, "org-1");
        assert_eq!(back.target_scope, LlmScoreTargetScope::Span);
        assert_eq!(back.target_id, "span-1");
        assert_eq!(back.score_version, 1700000000000);
        assert_eq!(back.span_id, Some("span-1".to_string()));
        assert_eq!(back.value_numeric, Some(0.95));
        assert_eq!(back.level, LlmScoreDataLevel::Span);
        assert_eq!(back.score_config_id, Some("cfg-entity-1".to_string()));
        assert_eq!(back.source_stream_type, Some("traces".to_string()));
        assert_eq!(back.agent_name, Some("agent-a".to_string()));
        assert_eq!(back.agent_id, Some("agent-1".to_string()));
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
        assert!(obj.contains_key("span_id"));
        assert!(obj.contains_key("trace_id"));
        assert!(obj.contains_key("session_id"));
        assert!(obj.contains_key("experiment_id"));
        assert!(obj.contains_key("level"));
        assert!(obj.contains_key("name"));
        assert!(obj.contains_key("value_numeric"));
        assert!(obj.contains_key("value_categorical"));
        assert!(obj.contains_key("value_boolean"));
        assert!(obj.contains_key("data_type"));
        assert!(obj.contains_key("scorer_id"));
        assert!(obj.contains_key("scorer_version"));
        assert!(obj.contains_key("score_config_id"));
        assert!(!obj.contains_key("score_config_entity_id"));
        assert!(obj.contains_key("score_config_version"));
        assert!(obj.contains_key("source_type"));
        assert!(obj.contains_key("source_stream"));
        assert!(obj.contains_key("source_stream_type"));
        assert!(!obj.contains_key("agent_name"));
        assert!(!obj.contains_key("agent_id"));
        assert!(!obj.contains_key("target_agent_name"));
        assert!(!obj.contains_key("target_agent_id"));
        assert!(obj.contains_key("job_id"));
        assert!(obj.contains_key("reasoning"));
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
            evaluation_key: "org=org-1;job=;scorer=;scope=trace;target=trace-1".to_string(),
            score_version: 0,
            span_id: None,
            trace_id: None,
            session_id: None,
            experiment_id: None,
            level: LlmScoreDataLevel::Trace,
            name: "test".to_string(),
            value_numeric: None,
            value_categorical: None,
            value_boolean: None,
            data_type: LlmScoreDataType::Numeric,
            scorer_id: None,
            scorer_version: None,
            score_config_id: None,
            score_config_version: None,
            source_type: LlmScoreDataSourceType::LlmJudge,
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
        };
        let json = serde_json::to_value(&record).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("span_id"));
        assert!(!obj.contains_key("trace_id"));
        assert!(!obj.contains_key("session_id"));
        assert!(!obj.contains_key("experiment_id"));
        assert!(!obj.contains_key("value_numeric"));
        assert!(!obj.contains_key("value_categorical"));
        assert!(!obj.contains_key("value_boolean"));
        assert!(!obj.contains_key("scorer_id"));
        assert!(!obj.contains_key("score_config_id"));
        assert!(!obj.contains_key("agent_name"));
        assert!(!obj.contains_key("agent_id"));
        assert!(!obj.contains_key("reasoning"));
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
}
