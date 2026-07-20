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

//! Prompt information extraction

use std::collections::HashMap;

use config::utils::json;

use crate::service::traces::otel::attributes::{GenAiAttributes, LangfuseAttributes};

pub struct PromptExtractor;

impl PromptExtractor {
    /// Extract prompt name from AI SDK metadata
    pub fn extract_name(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        // Check Gen-AI attributes first
        if let Some(value) = attributes.get(GenAiAttributes::PROMPT_NAME) {
            return value.as_str().map(|s| s.to_string());
        }

        // Check Langfuse attributes (support both dot and underscore formats)
        if let Some(value) = attributes.get(LangfuseAttributes::PROMPT_NAME) {
            return value.as_str().map(|s| s.to_string());
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_extract_prompt_name_from_gen_ai_attribute() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.prompt.name".to_string(),
            config::utils::json::json!("my_prompt"),
        );
        let result = PromptExtractor.extract_name(&attrs);
        assert_eq!(result, Some("my_prompt".to_string()));
    }

    #[test]
    fn test_extract_prompt_name_from_langfuse_attribute() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "langfuse.observation.prompt.name".to_string(),
            config::utils::json::json!("langfuse_prompt"),
        );
        let result = PromptExtractor.extract_name(&attrs);
        assert_eq!(result, Some("langfuse_prompt".to_string()));
    }

    #[test]
    fn test_extract_prompt_name_gen_ai_takes_priority_over_langfuse() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.prompt.name".to_string(),
            config::utils::json::json!("gen_ai_prompt"),
        );
        attrs.insert(
            "langfuse.observation.prompt.name".to_string(),
            config::utils::json::json!("langfuse_prompt"),
        );
        let result = PromptExtractor.extract_name(&attrs);
        assert_eq!(result, Some("gen_ai_prompt".to_string()));
    }

    #[test]
    fn test_extract_prompt_name_absent_returns_none() {
        let result = PromptExtractor.extract_name(&HashMap::new());
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_non_string_gen_ai_returns_none() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.prompt.name".to_string(),
            config::utils::json::json!(42),
        );
        let result = PromptExtractor.extract_name(&attrs);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_non_string_gen_ai_blocks_langfuse_fallback() {
        // When gen_ai key exists but is non-string, extract_name returns None
        // without falling through to the langfuse key.
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.prompt.name".to_string(),
            config::utils::json::json!(true),
        );
        attrs.insert(
            "langfuse.observation.prompt.name".to_string(),
            config::utils::json::json!("fallback_prompt"),
        );
        let result = PromptExtractor.extract_name(&attrs);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_non_string_langfuse_returns_none() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "langfuse.observation.prompt.name".to_string(),
            config::utils::json::json!(null),
        );
        let result = PromptExtractor.extract_name(&attrs);
        assert!(result.is_none());
    }
}
