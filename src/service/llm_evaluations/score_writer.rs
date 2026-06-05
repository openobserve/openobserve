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

//! Score Writer — writes evaluation results to the `_llm_scores` system stream.
//!
//! Produces `LlmScoreRecord` values from scorer execution outputs and
//! serializes them for ingestion through the pipeline's output node.

use chrono::Utc;
use config::{
    ider,
    meta::self_reporting::llm_scores::{
        LlmScoreDataLevel, LlmScoreDataSourceType, LlmScoreDataType, LlmScoreRecord,
    },
};

#[derive(Debug)]
pub struct ScoreWriterInput {
    pub span_id: String,
    pub trace_id: String,
    pub session_id: Option<String>,
    pub scorer_id: String,
    pub scorer_version: String,
    pub score_config_id: Option<String>,
    pub score_config_version: Option<String>,
    pub score_name: Option<String>,
    pub source_type: LlmScoreDataSourceType,
    pub source_stream: Option<String>,
    pub job_id: Option<String>,
    pub value_numeric: Option<f64>,
    pub value_categorical: Option<String>,
    pub value_boolean: Option<bool>,
    pub data_type: LlmScoreDataType,
    pub reasoning: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub author: Option<String>,
}

pub struct WrittenScore {
    pub record: LlmScoreRecord,
    pub json: serde_json::Value,
}

pub fn create_score(input: ScoreWriterInput) -> WrittenScore {
    let now = Utc::now().timestamp_micros();
    let id = ider::generate();

    let level = if input.span_id.is_empty() {
        LlmScoreDataLevel::Trace
    } else {
        LlmScoreDataLevel::Span
    };

    let record = LlmScoreRecord {
        id,
        span_id: if input.span_id.is_empty() {
            None
        } else {
            Some(input.span_id)
        },
        trace_id: if input.trace_id.is_empty() {
            None
        } else {
            Some(input.trace_id)
        },
        session_id: input.session_id,
        experiment_id: None,
        level,
        name: input.score_name.unwrap_or_else(|| "unknown".to_string()),
        value_numeric: input.value_numeric,
        value_categorical: input.value_categorical,
        value_boolean: input.value_boolean,
        data_type: input.data_type,
        scorer_id: Some(input.scorer_id),
        scorer_version: Some(input.scorer_version),
        score_config_id: input.score_config_id,
        score_config_version: input.score_config_version,
        source_type: input.source_type,
        source_stream: input.source_stream,
        job_id: input.job_id,
        reasoning: input.reasoning,
        metadata: input.metadata,
        author: input.author,
        _timestamp: now,
    };

    let json = serde_json::to_value(&record)
        .unwrap_or_else(|_| serde_json::json!({"error": "serialization_failed"}));

    WrittenScore { record, json }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_numeric_score() {
        let input = ScoreWriterInput {
            span_id: "span-1".to_string(),
            trace_id: "trace-1".to_string(),
            session_id: None,
            scorer_id: "scorer-entity-1".to_string(),
            scorer_version: "1".to_string(),
            score_config_id: Some("cfg-entity-1".to_string()),
            score_config_version: Some("1".to_string()),
            score_name: Some("faithfulness".to_string()),
            source_type: LlmScoreDataSourceType::LlmJudge,
            source_stream: Some("traces".to_string()),
            job_id: Some("job-1".to_string()),
            value_numeric: Some(0.95),
            value_categorical: None,
            value_boolean: None,
            data_type: LlmScoreDataType::Numeric,
            reasoning: None,
            metadata: None,
            author: None,
        };

        let result = create_score(input);
        assert_eq!(result.record.level, LlmScoreDataLevel::Span);
        assert_eq!(result.record.name, "faithfulness");
        assert_eq!(result.record.value_numeric, Some(0.95));
        assert_eq!(result.record.source_type, LlmScoreDataSourceType::LlmJudge);
        assert_eq!(result.record.scorer_id, Some("scorer-entity-1".to_string()));
        assert_eq!(result.record.job_id, Some("job-1".to_string()));
        assert_eq!(
            result.record.score_config_id,
            Some("cfg-entity-1".to_string())
        );

        let json = &result.json;
        assert_eq!(json["name"], "faithfulness");
        assert_eq!(json["level"], "span");
        assert_eq!(json["scorer_id"], "scorer-entity-1");
        assert_eq!(json["source_type"], "llm_judge");
        assert_eq!(json["score_config_id"], "cfg-entity-1");
        assert!(json.get("score_config_entity_id").is_none());
    }

    #[test]
    fn test_create_categorical_score() {
        let input = ScoreWriterInput {
            span_id: "span-2".to_string(),
            trace_id: "trace-2".to_string(),
            session_id: None,
            scorer_id: "sc-2".to_string(),
            scorer_version: "2".to_string(),
            score_config_id: None,
            score_config_version: None,
            score_name: Some("quality".to_string()),
            source_type: LlmScoreDataSourceType::Remote,
            source_stream: None,
            job_id: None,
            value_numeric: None,
            value_categorical: Some("excellent".to_string()),
            value_boolean: None,
            data_type: LlmScoreDataType::Categorical,
            reasoning: Some("good job".to_string()),
            metadata: None,
            author: None,
        };

        let result = create_score(input);
        assert_eq!(result.record.data_type, LlmScoreDataType::Categorical);
        assert_eq!(
            result.record.value_categorical,
            Some("excellent".to_string())
        );
        assert_eq!(result.record.source_type, LlmScoreDataSourceType::Remote);
        assert_eq!(result.record.reasoning, Some("good job".to_string()));
    }

    #[test]
    fn test_create_boolean_score() {
        let input = ScoreWriterInput {
            span_id: String::new(),
            trace_id: "trace-3".to_string(),
            session_id: None,
            scorer_id: "sc-3".to_string(),
            scorer_version: "3".to_string(),
            score_config_id: None,
            score_config_version: None,
            score_name: Some("pass_fail".to_string()),
            source_type: LlmScoreDataSourceType::LlmJudge,
            source_stream: None,
            job_id: None,
            value_numeric: None,
            value_categorical: None,
            value_boolean: Some(true),
            data_type: LlmScoreDataType::Boolean,
            reasoning: None,
            metadata: None,
            author: Some("admin".to_string()),
        };

        let result = create_score(input);
        assert_eq!(result.record.level, LlmScoreDataLevel::Trace);
        assert_eq!(result.record.value_boolean, Some(true));
        assert_eq!(result.record.author, Some("admin".to_string()));
    }

    #[test]
    fn test_create_score_with_metadata() {
        let input = ScoreWriterInput {
            span_id: "span-4".to_string(),
            trace_id: "trace-4".to_string(),
            session_id: Some("session-1".to_string()),
            scorer_id: "sc-4".to_string(),
            scorer_version: "4".to_string(),
            score_config_id: None,
            score_config_version: None,
            score_name: Some("custom".to_string()),
            source_type: LlmScoreDataSourceType::LlmJudge,
            source_stream: Some("traces".to_string()),
            job_id: None,
            value_numeric: Some(0.5),
            value_categorical: None,
            value_boolean: None,
            data_type: LlmScoreDataType::Numeric,
            reasoning: None,
            metadata: Some(serde_json::json!({"extra": "info"})),
            author: None,
        };

        let result = create_score(input);
        assert_eq!(result.record.session_id, Some("session-1".to_string()));
        assert!(result.record.metadata.is_some());
    }
}
