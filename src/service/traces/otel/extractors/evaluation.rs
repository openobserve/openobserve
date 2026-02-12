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

//! Evaluation score extraction from LLM evaluation span attributes.
//!
//! Extracts evaluation scores emitted by frameworks like o2-sre-agent's
//! EvaluationRunner, which writes `llm.evaluation.*` and `evaluation_*`
//! span attributes.

use std::collections::HashMap;

use config::utils::json;

use super::utils::extract_f64;
use crate::service::traces::otel::attributes::EvaluationAttributes;

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

pub struct EvaluationExtractor;

impl EvaluationExtractor {
    /// Extract evaluation scores from span attributes.
    ///
    /// Supports two naming conventions:
    /// 1. `llm.evaluation.*` (OTEL-style, emitted by o2-sre-agent)
    /// 2. `evaluation_*` (design-doc style, alternative names)
    pub fn extract(&self, attributes: &HashMap<String, json::Value>) -> EvaluationScores {
        // Extract quality score (aggregate)
        let quality_score = self
            .extract_score(attributes, EvaluationAttributes::QUALITY_SCORE)
            .or_else(|| {
                // Fallback: check for underscore format (dots converted to underscores)
                self.extract_score(attributes, "llm_evaluation_quality_score")
            });

        // Extract per-evaluator scores (try both naming conventions)
        let relevance = self
            .extract_score(attributes, EvaluationAttributes::RELEVANCE)
            .or_else(|| self.extract_score(attributes, EvaluationAttributes::EVAL_RELEVANCE))
            .or_else(|| self.extract_score(attributes, "llm_evaluation_relevance"));

        let completeness = self
            .extract_score(attributes, EvaluationAttributes::COMPLETENESS)
            .or_else(|| self.extract_score(attributes, EvaluationAttributes::EVAL_COMPLETENESS))
            .or_else(|| self.extract_score(attributes, "llm_evaluation_completeness"));

        let tool_effectiveness = self
            .extract_score(attributes, EvaluationAttributes::TOOL_EFFECTIVENESS)
            .or_else(|| {
                self.extract_score(attributes, EvaluationAttributes::EVAL_TOOL_EFFECTIVENESS)
            })
            .or_else(|| self.extract_score(attributes, "llm_evaluation_tool_effectiveness"));

        let groundedness = self
            .extract_score(attributes, EvaluationAttributes::GROUNDEDNESS)
            .or_else(|| self.extract_score(attributes, EvaluationAttributes::EVAL_GROUNDEDNESS))
            .or_else(|| self.extract_score(attributes, "llm_evaluation_groundedness"));

        let safety = self
            .extract_score(attributes, EvaluationAttributes::SAFETY)
            .or_else(|| self.extract_score(attributes, EvaluationAttributes::EVAL_SAFETY))
            .or_else(|| self.extract_score(attributes, "llm_evaluation_safety"));

        let duration_ms = self
            .extract_score(attributes, EvaluationAttributes::DURATION_MS)
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

    fn extract_score(&self, attributes: &HashMap<String, json::Value>, key: &str) -> Option<f64> {
        attributes.get(key).and_then(|v| extract_f64(v))
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
        attrs.insert(
            "llm.evaluation.groundedness".to_string(),
            json::json!(0.88),
        );
        attrs.insert("llm.evaluation.safety".to_string(), json::json!(0.95));
        attrs.insert("llm.evaluation.duration_ms".to_string(), json::json!(12.5));

        let scores = extractor.extract(&attrs);
        assert!(scores.has_any());
        assert_eq!(scores.quality_score, Some(0.85));
        assert_eq!(scores.relevance, Some(0.9));
        assert_eq!(scores.completeness, Some(0.8));
        assert_eq!(scores.tool_effectiveness, Some(0.75));
        assert_eq!(scores.groundedness, Some(0.88));
        assert_eq!(scores.safety, Some(0.95));
        assert_eq!(scores.duration_ms, Some(12.5));
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

        let scores = extractor.extract(&attrs);
        assert!(scores.has_any());
        assert_eq!(scores.relevance, Some(0.7));
        assert_eq!(scores.completeness, Some(0.6));
        assert_eq!(scores.tool_effectiveness, Some(0.8));
        assert_eq!(scores.groundedness, Some(0.75));
        assert_eq!(scores.safety, Some(0.9));
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

        let scores = extractor.extract(&attrs);
        assert!(scores.has_any());
        assert_eq!(scores.quality_score, Some(0.82));
        assert_eq!(scores.relevance, Some(0.85));
    }

    #[test]
    fn test_no_evaluation_data() {
        let extractor = EvaluationExtractor;
        let attrs = HashMap::new();

        let scores = extractor.extract(&attrs);
        assert!(!scores.has_any());
        assert_eq!(scores.quality_score, None);
    }

    #[test]
    fn test_string_scores_parsed() {
        let extractor = EvaluationExtractor;
        let mut attrs = HashMap::new();
        attrs.insert(
            "llm.evaluation.quality_score".to_string(),
            json::json!("0.75"),
        );

        let scores = extractor.extract(&attrs);
        assert_eq!(scores.quality_score, Some(0.75));
    }
}
