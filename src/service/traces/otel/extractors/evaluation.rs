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

//! Evaluation extraction from LLM evaluation span attributes.
//!
//! Extracts evaluation data emitted by frameworks like o2-sre-agent's
//! EvaluationRunner, which writes `llm.evaluation.*`, `llm.evaluator.*`,
//! and `evaluation_*` span attributes.
//!
//! Aligned with the Evaluation schema:
//!   Evaluation { trace_id, span_id, scores, commentary, evaluator, created_at }

use std::collections::HashMap;

use config::utils::json;

use super::utils::extract_f64;
use crate::service::traces::otel::attributes::O2Attributes;

/// Evaluator type classification
#[derive(Debug, Clone, PartialEq)]
pub enum EvaluatorType {
    Human,
    Model,
    Deterministic,
}

impl EvaluatorType {
    pub fn as_str(&self) -> &'static str {
        match self {
            EvaluatorType::Human => "human",
            EvaluatorType::Model => "model",
            EvaluatorType::Deterministic => "deterministic",
        }
    }

    fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "human" => EvaluatorType::Human,
            "model" | "llm" => EvaluatorType::Model,
            _ => EvaluatorType::Deterministic,
        }
    }
}

/// Information about the evaluator that produced the scores
#[derive(Debug, Clone)]
pub struct EvaluatorInfo {
    pub name: Option<String>,
    pub version: Option<String>,
    pub evaluator_type: EvaluatorType,
}

/// Evaluation scores extracted from span attributes
pub struct EvaluationScores {
    pub quality_score: Option<f64>,
    pub relevance: Option<f64>,
    pub completeness: Option<f64>,
    pub tool_effectiveness: Option<f64>,
    pub groundedness: Option<f64>,
    pub safety: Option<f64>,
    pub duration_ms: Option<f64>,
}

impl EvaluationScores {
    pub fn has_any(&self) -> bool {
        self.quality_score.is_some()
            || self.relevance.is_some()
            || self.completeness.is_some()
            || self.tool_effectiveness.is_some()
            || self.groundedness.is_some()
            || self.safety.is_some()
    }
}

/// Full evaluation data extracted from a span, aligned with the Evaluation schema.
/// trace_id and span_id come from the span context itself (not extracted here).
/// created_at comes from the span timestamp.
pub struct Evaluation {
    pub scores: EvaluationScores,
    pub commentary: Option<String>,
    pub evaluator: EvaluatorInfo,
}

impl Evaluation {
    pub fn has_any(&self) -> bool {
        self.scores.has_any()
    }
}

pub struct EvaluationExtractor;

impl EvaluationExtractor {
    /// Extract full evaluation data from span attributes.
    ///
    /// Supports two naming conventions for scores:
    /// 1. `llm.evaluation.*` (OTEL-style, emitted by o2-sre-agent)
    /// 2. `evaluation_*` (design-doc style, alternative names)
    ///
    /// Also extracts evaluator metadata and commentary.
    pub fn extract(&self, attributes: &HashMap<String, json::Value>) -> Evaluation {
        let scores = self.extract_scores(attributes);
        let commentary = self
            .extract_string(attributes, O2Attributes::EVALUATION_COMMENTARY)
            .or_else(|| self.extract_string(attributes, "llm_evaluation_commentary"));
        let evaluator = self.extract_evaluator_info(attributes);

        Evaluation {
            scores,
            commentary,
            evaluator,
        }
    }

    fn extract_scores(&self, attributes: &HashMap<String, json::Value>) -> EvaluationScores {
        // Extract quality score (aggregate)
        let quality_score = self
            .extract_score(attributes, O2Attributes::EVALUATION_QUALITY)
            .or_else(|| self.extract_score(attributes, "llm_evaluation_quality_score"));

        // Extract per-evaluator scores (try both naming conventions)
        let relevance = self
            .extract_score(attributes, O2Attributes::EVALUATION_RELEVANCE)
            .or_else(|| self.extract_score(attributes, "evaluation_relevance"))
            .or_else(|| self.extract_score(attributes, "llm_evaluation_relevance"));

        let completeness = self
            .extract_score(attributes, O2Attributes::EVALUATION_COMPLETENESS)
            .or_else(|| self.extract_score(attributes, "evaluation_completeness"))
            .or_else(|| self.extract_score(attributes, "llm_evaluation_completeness"));

        let tool_effectiveness = self
            .extract_score(attributes, O2Attributes::EVALUATION_TOOL_EFFECTIVENESS)
            .or_else(|| self.extract_score(attributes, "evaluation_tool_effectiveness"))
            .or_else(|| self.extract_score(attributes, "llm_evaluation_tool_effectiveness"));

        let groundedness = self
            .extract_score(attributes, O2Attributes::EVALUATION_GROUNDEDNESS)
            .or_else(|| self.extract_score(attributes, "evaluation_groundedness"))
            .or_else(|| self.extract_score(attributes, "llm_evaluation_groundedness"));

        let safety = self
            .extract_score(attributes, O2Attributes::EVALUATION_SAFETY)
            .or_else(|| self.extract_score(attributes, "evaluation_safety"))
            .or_else(|| self.extract_score(attributes, "llm_evaluation_safety"));

        let duration_ms = self
            .extract_score(attributes, O2Attributes::EVALUATION_DURATION_MS)
            .or_else(|| self.extract_score(attributes, "llm_evaluation_duration_ms"));

        EvaluationScores {
            quality_score,
            relevance,
            completeness,
            tool_effectiveness,
            groundedness,
            safety,
            duration_ms,
        }
    }

    fn extract_evaluator_info(&self, attributes: &HashMap<String, json::Value>) -> EvaluatorInfo {
        let name = self
            .extract_string(attributes, O2Attributes::EVALUATOR_NAME)
            .or_else(|| self.extract_string(attributes, "llm_evaluator_name"));

        let version = self
            .extract_string(attributes, O2Attributes::EVALUATOR_VERSION)
            .or_else(|| self.extract_string(attributes, "llm_evaluator_version"));

        let evaluator_type = self
            .extract_string(attributes, O2Attributes::EVALUATOR_TYPE)
            .or_else(|| self.extract_string(attributes, "llm_evaluator_type"))
            .map(|s| EvaluatorType::from_str(&s))
            .unwrap_or(EvaluatorType::Deterministic);

        EvaluatorInfo {
            name,
            version,
            evaluator_type,
        }
    }

    fn extract_score(&self, attributes: &HashMap<String, json::Value>, key: &str) -> Option<f64> {
        attributes.get(key).and_then(extract_f64)
    }

    fn extract_string(
        &self,
        attributes: &HashMap<String, json::Value>,
        key: &str,
    ) -> Option<String> {
        attributes.get(key).and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| Some(v.to_string()))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_evaluation_scores_otel_format() {
        let extractor = EvaluationExtractor;
        let mut attrs = HashMap::new();
        attrs.insert(
            "llm.evaluation.quality_score".to_string(),
            json::json!(0.85),
        );
        attrs.insert("llm.evaluation.relevance".to_string(), json::json!(0.9));
        attrs.insert("llm.evaluation.completeness".to_string(), json::json!(0.8));
        attrs.insert(
            "llm.evaluation.tool_effectiveness".to_string(),
            json::json!(0.75),
        );
        attrs.insert("llm.evaluation.groundedness".to_string(), json::json!(0.88));
        attrs.insert("llm.evaluation.safety".to_string(), json::json!(0.95));
        attrs.insert("llm.evaluation.duration_ms".to_string(), json::json!(12.5));

        let eval = extractor.extract(&attrs);
        assert!(eval.has_any());
        assert_eq!(eval.scores.quality_score, Some(0.85));
        assert_eq!(eval.scores.relevance, Some(0.9));
        assert_eq!(eval.scores.completeness, Some(0.8));
        assert_eq!(eval.scores.tool_effectiveness, Some(0.75));
        assert_eq!(eval.scores.groundedness, Some(0.88));
        assert_eq!(eval.scores.safety, Some(0.95));
        assert_eq!(eval.scores.duration_ms, Some(12.5));
    }

    #[test]
    fn test_extract_evaluation_scores_design_doc_format() {
        let extractor = EvaluationExtractor;
        let mut attrs = HashMap::new();
        attrs.insert("evaluation_relevance".to_string(), json::json!(0.7));
        attrs.insert("evaluation_completeness".to_string(), json::json!(0.6));
        attrs.insert(
            "evaluation_tool_effectiveness".to_string(),
            json::json!(0.8),
        );
        attrs.insert("evaluation_groundedness".to_string(), json::json!(0.75));
        attrs.insert("evaluation_safety".to_string(), json::json!(0.9));

        let eval = extractor.extract(&attrs);
        assert!(eval.has_any());
        assert_eq!(eval.scores.relevance, Some(0.7));
        assert_eq!(eval.scores.completeness, Some(0.6));
        assert_eq!(eval.scores.tool_effectiveness, Some(0.8));
        assert_eq!(eval.scores.groundedness, Some(0.75));
        assert_eq!(eval.scores.safety, Some(0.9));
    }

    #[test]
    fn test_extract_evaluation_scores_underscore_format() {
        let extractor = EvaluationExtractor;
        let mut attrs = HashMap::new();
        // Dots converted to underscores during ingestion
        attrs.insert(
            "llm_evaluation_quality_score".to_string(),
            json::json!(0.82),
        );
        attrs.insert("llm_evaluation_relevance".to_string(), json::json!(0.85));

        let eval = extractor.extract(&attrs);
        assert!(eval.has_any());
        assert_eq!(eval.scores.quality_score, Some(0.82));
        assert_eq!(eval.scores.relevance, Some(0.85));
    }

    #[test]
    fn test_no_evaluation_data() {
        let extractor = EvaluationExtractor;
        let attrs = HashMap::new();

        let eval = extractor.extract(&attrs);
        assert!(!eval.has_any());
        assert_eq!(eval.scores.quality_score, None);
    }

    #[test]
    fn test_string_scores_parsed() {
        let extractor = EvaluationExtractor;
        let mut attrs = HashMap::new();
        attrs.insert(
            "llm.evaluation.quality_score".to_string(),
            json::json!("0.75"),
        );

        let eval = extractor.extract(&attrs);
        assert_eq!(eval.scores.quality_score, Some(0.75));
    }

    #[test]
    fn test_extract_evaluator_info() {
        let extractor = EvaluationExtractor;
        let mut attrs = HashMap::new();
        attrs.insert(
            "llm.evaluation.quality_score".to_string(),
            json::json!(0.85),
        );
        attrs.insert(
            "llm.evaluator.name".to_string(),
            json::json!("o2-sre-agent-evaluator"),
        );
        attrs.insert("llm.evaluator.version".to_string(), json::json!("v1.0"));
        attrs.insert(
            "llm.evaluator.type".to_string(),
            json::json!("deterministic"),
        );
        attrs.insert(
            "llm.evaluation.commentary".to_string(),
            json::json!("relevance: Good | completeness: Adequate"),
        );

        let eval = extractor.extract(&attrs);
        assert!(eval.has_any());
        assert_eq!(
            eval.evaluator.name,
            Some("o2-sre-agent-evaluator".to_string())
        );
        assert_eq!(eval.evaluator.version, Some("v1.0".to_string()));
        assert_eq!(eval.evaluator.evaluator_type, EvaluatorType::Deterministic);
        assert_eq!(
            eval.commentary,
            Some("relevance: Good | completeness: Adequate".to_string())
        );
    }

    #[test]
    fn test_evaluator_type_parsing() {
        assert_eq!(EvaluatorType::from_str("human"), EvaluatorType::Human);
        assert_eq!(EvaluatorType::from_str("Human"), EvaluatorType::Human);
        assert_eq!(EvaluatorType::from_str("model"), EvaluatorType::Model);
        assert_eq!(EvaluatorType::from_str("llm"), EvaluatorType::Model);
        assert_eq!(
            EvaluatorType::from_str("deterministic"),
            EvaluatorType::Deterministic
        );
        assert_eq!(
            EvaluatorType::from_str("unknown"),
            EvaluatorType::Deterministic
        );
    }

    #[test]
    fn test_evaluator_type_as_str() {
        assert_eq!(EvaluatorType::Human.as_str(), "human");
        assert_eq!(EvaluatorType::Model.as_str(), "model");
        assert_eq!(EvaluatorType::Deterministic.as_str(), "deterministic");
    }

    #[test]
    fn test_has_any_false_when_only_duration_ms_set() {
        // duration_ms is not included in has_any()
        let extractor = EvaluationExtractor;
        let mut attrs = HashMap::new();
        attrs.insert("llm.evaluation.duration_ms".to_string(), json::json!(42.0));
        let eval = extractor.extract(&attrs);
        assert!(!eval.has_any());
        assert_eq!(eval.scores.duration_ms, Some(42.0));
    }

    #[test]
    fn test_extract_string_non_string_returns_json_string() {
        // extract_string falls back to v.to_string() for non-string values
        let extractor = EvaluationExtractor;
        let mut attrs = HashMap::new();
        attrs.insert(
            "llm.evaluation.commentary".to_string(),
            json::json!({"detail": "ok"}),
        );
        let eval = extractor.extract(&attrs);
        let commentary = eval.commentary.unwrap();
        assert!(commentary.contains("detail"));
    }

    #[test]
    fn test_extract_commentary_from_underscore_format() {
        let extractor = EvaluationExtractor;
        let mut attrs = HashMap::new();
        attrs.insert(
            "llm_evaluation_commentary".to_string(),
            json::json!("Looks good"),
        );
        let eval = extractor.extract(&attrs);
        assert_eq!(eval.commentary, Some("Looks good".to_string()));
    }

    #[test]
    fn test_extract_evaluator_from_underscore_format() {
        let extractor = EvaluationExtractor;
        let mut attrs = HashMap::new();
        attrs.insert("llm.evaluation.quality_score".to_string(), json::json!(0.9));
        attrs.insert("llm_evaluator_name".to_string(), json::json!("my-eval"));
        attrs.insert("llm_evaluator_version".to_string(), json::json!("2.0"));
        attrs.insert("llm_evaluator_type".to_string(), json::json!("llm"));
        let eval = extractor.extract(&attrs);
        assert_eq!(eval.evaluator.name, Some("my-eval".to_string()));
        assert_eq!(eval.evaluator.version, Some("2.0".to_string()));
        assert_eq!(eval.evaluator.evaluator_type, EvaluatorType::Model);
    }

    #[test]
    fn test_has_any_true_when_quality_score_set() {
        let scores = EvaluationScores {
            quality_score: Some(0.9),
            relevance: None,
            completeness: None,
            tool_effectiveness: None,
            groundedness: None,
            safety: None,
            duration_ms: None,
        };
        assert!(scores.has_any());
    }

    #[test]
    fn test_evaluation_has_any_delegates_to_scores() {
        let eval = Evaluation {
            scores: EvaluationScores {
                quality_score: Some(0.8),
                relevance: None,
                completeness: None,
                tool_effectiveness: None,
                groundedness: None,
                safety: None,
                duration_ms: None,
            },
            commentary: None,
            evaluator: EvaluatorInfo {
                name: None,
                version: None,
                evaluator_type: EvaluatorType::Deterministic,
            },
        };
        assert!(eval.has_any());
    }
}
