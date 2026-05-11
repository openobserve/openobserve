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

//! Model name extraction

use std::collections::HashMap;

use config::utils::json;

use crate::service::traces::otel::attributes::{
    GenAiAttributes, LangfuseAttributes, OpenInferenceAttributes, VercelAiSdkAttributes,
};

pub struct ModelExtractor;

impl ModelExtractor {
    /// Extract model name from attributes
    pub fn extract(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        let model_name_keys = [
            GenAiAttributes::RESPONSE_MODEL,
            VercelAiSdkAttributes::MODEL_ID,
            GenAiAttributes::REQUEST_MODEL,
            LangfuseAttributes::MODEL,
            OpenInferenceAttributes::LLM_RESPONSE_MODEL,
            OpenInferenceAttributes::LLM_MODEL_NAME,
            "model",
        ];

        for key in &model_name_keys {
            if let Some(value) = attributes.get(*key) {
                return value.as_str().map(|s| s.to_string());
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_attributes(pairs: Vec<(&str, json::Value)>) -> HashMap<String, json::Value> {
        pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
    }

    #[test]
    fn test_extract_model_name() {
        let extractor = ModelExtractor;
        let attrs = make_attributes(vec![("gen_ai.response.model", json::json!("gpt-4"))]);
        let result = extractor.extract(&attrs);
        assert_eq!(result, Some("gpt-4".to_string()));
    }

    #[test]
    fn test_extract_returns_none_when_empty() {
        let extractor = ModelExtractor;
        let result = extractor.extract(&HashMap::new());
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_response_model_priority_over_request() {
        let extractor = ModelExtractor;
        let attrs = make_attributes(vec![
            ("gen_ai.request.model", json::json!("gpt-3.5")),
            ("gen_ai.response.model", json::json!("gpt-4")),
        ]);
        assert_eq!(extractor.extract(&attrs), Some("gpt-4".to_string()));
    }

    #[test]
    fn test_extract_falls_back_to_request_model() {
        let extractor = ModelExtractor;
        let attrs = make_attributes(vec![("gen_ai.request.model", json::json!("gpt-3.5"))]);
        assert_eq!(extractor.extract(&attrs), Some("gpt-3.5".to_string()));
    }

    #[test]
    fn test_extract_falls_back_to_generic_model_key() {
        let extractor = ModelExtractor;
        let attrs = make_attributes(vec![("model", json::json!("claude-3"))]);
        assert_eq!(extractor.extract(&attrs), Some("claude-3".to_string()));
    }

    #[test]
    fn test_extract_non_string_value_returns_none() {
        let extractor = ModelExtractor;
        let attrs = make_attributes(vec![("gen_ai.response.model", json::json!(42))]);
        assert!(extractor.extract(&attrs).is_none());
    }

    #[test]
    fn test_extract_ai_model_id_key() {
        let extractor = ModelExtractor;
        let attrs = make_attributes(vec![("ai.model.id", json::json!("my-model"))]);
        assert_eq!(extractor.extract(&attrs), Some("my-model".to_string()));
    }

    #[test]
    fn test_extract_llm_model_name_key() {
        let extractor = ModelExtractor;
        let attrs = make_attributes(vec![("llm.model_name", json::json!("llama3"))]);
        assert_eq!(extractor.extract(&attrs), Some("llama3".to_string()));
    }

    #[test]
    fn test_extract_langfuse_model_name_key() {
        let extractor = ModelExtractor;
        let attrs = make_attributes(vec![(
            "langfuse.observation.model.name",
            json::json!("claude-3-haiku"),
        )]);
        assert_eq!(
            extractor.extract(&attrs),
            Some("claude-3-haiku".to_string())
        );
    }

    #[test]
    fn test_extract_openinference_llm_response_model() {
        let extractor = ModelExtractor;
        let attrs = make_attributes(vec![("llm.response.model", json::json!("mistral-7b"))]);
        assert_eq!(extractor.extract(&attrs), Some("mistral-7b".to_string()));
    }

    #[test]
    fn test_extract_vercel_priority_over_request_model() {
        let extractor = ModelExtractor;
        let attrs = make_attributes(vec![
            ("gen_ai.request.model", json::json!("gpt-3.5")),
            ("ai.model.id", json::json!("gpt-4-turbo")),
        ]);
        assert_eq!(extractor.extract(&attrs), Some("gpt-4-turbo".to_string()));
    }

    #[test]
    fn test_extract_empty_string_returns_some_empty() {
        let extractor = ModelExtractor;
        let attrs = make_attributes(vec![("gen_ai.response.model", json::json!(""))]);
        assert_eq!(extractor.extract(&attrs), Some("".to_string()));
    }
}
