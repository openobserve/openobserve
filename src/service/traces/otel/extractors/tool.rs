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

//! Tool extraction (tool name, tool ID)

use std::collections::HashMap;

use config::utils::json;

use crate::service::traces::otel::attributes::{GenAiAttributes, LangfuseAttributes};

pub struct ToolExtractor;

impl ToolExtractor {
    /// Extract tool name
    pub fn extract_tool_name(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        // Check Gen-AI attributes first
        if let Some(value) = attributes.get(GenAiAttributes::TOOL_NAME)
            && let Some(s) = value.as_str()
        {
            return Some(s.to_string());
        }

        // Check Langfuse attributes
        if let Some(value) = attributes.get(LangfuseAttributes::OBSERVATION_METADATA_TOOL_NAME)
            && let Some(s) = value.as_str()
        {
            return Some(s.to_string());
        }

        None
    }

    /// Extract tool call ID
    pub fn extract_tool_call_id(
        &self,
        attributes: &HashMap<String, json::Value>,
    ) -> Option<String> {
        // Check Gen-AI attributes first
        if let Some(value) = attributes.get(GenAiAttributes::TOOL_CALL_ID)
            && let Some(s) = value.as_str()
        {
            return Some(s.to_string());
        }

        // Check Langfuse attributes
        if let Some(value) = attributes.get(LangfuseAttributes::OBSERVATION_METADATA_TOOL_ID)
            && let Some(s) = value.as_str()
        {
            return Some(s.to_string());
        }

        None
    }

    /// Extract tool call arguments
    pub fn extract_tool_call_arguments(
        &self,
        attributes: &HashMap<String, json::Value>,
    ) -> Option<json::Value> {
        attributes
            .get(GenAiAttributes::TOOL_CALL_ARGUMENTS)
            .cloned()
    }

    /// Extract tool call result
    pub fn extract_tool_call_result(
        &self,
        attributes: &HashMap<String, json::Value>,
    ) -> Option<json::Value> {
        attributes.get(GenAiAttributes::TOOL_CALL_RESULT).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_tool_name() {
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.tool.name".to_string(),
            json::json!("get_weather"),
        );

        let result = extractor.extract_tool_name(&attrs);
        assert_eq!(result, Some("get_weather".to_string()));
    }

    #[test]
    fn test_extract_tool_name_missing() {
        let extractor = ToolExtractor;
        let attrs = HashMap::new();

        let result = extractor.extract_tool_name(&attrs);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_tool_call_id() {
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.tool.call.id".to_string(), json::json!("call_123"));

        let result = extractor.extract_tool_call_id(&attrs);
        assert_eq!(result, Some("call_123".to_string()));
    }

    #[test]
    fn test_extract_tool_call_id_missing() {
        let extractor = ToolExtractor;
        let attrs = HashMap::new();

        let result = extractor.extract_tool_call_id(&attrs);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_tool_call_arguments() {
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        let args = json::json!({"city": "San Francisco", "unit": "celsius"});
        attrs.insert("gen_ai.tool.call.arguments".to_string(), args.clone());

        let result = extractor.extract_tool_call_arguments(&attrs);
        assert_eq!(result, Some(args));
    }

    #[test]
    fn test_extract_tool_call_arguments_missing() {
        let extractor = ToolExtractor;
        let attrs = HashMap::new();

        let result = extractor.extract_tool_call_arguments(&attrs);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_tool_call_result() {
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        let result_val = json::json!({"temperature": 72, "condition": "sunny"});
        attrs.insert("gen_ai.tool.call.result".to_string(), result_val.clone());

        let result = extractor.extract_tool_call_result(&attrs);
        assert_eq!(result, Some(result_val));
    }

    #[test]
    fn test_extract_tool_call_result_missing() {
        let extractor = ToolExtractor;
        let attrs = HashMap::new();

        let result = extractor.extract_tool_call_result(&attrs);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_tool_name_from_langfuse() {
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        attrs.insert(
            "langfuse_observation_metadata_tool_name".to_string(),
            json::json!("Read"),
        );

        let result = extractor.extract_tool_name(&attrs);
        assert_eq!(result, Some("Read".to_string()));
    }

    #[test]
    fn test_extract_tool_call_id_from_langfuse() {
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        attrs.insert(
            "langfuse_observation_metadata_tool_id".to_string(),
            json::json!("toolu_01T1Mfo98ePBYgoRXG3yPkWt"),
        );

        let result = extractor.extract_tool_call_id(&attrs);
        assert_eq!(result, Some("toolu_01T1Mfo98ePBYgoRXG3yPkWt".to_string()));
    }

    #[test]
    fn test_extract_tool_name_prefers_gen_ai() {
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.tool.name".to_string(),
            json::json!("get_weather"),
        );
        attrs.insert(
            "langfuse_observation_metadata_tool_name".to_string(),
            json::json!("Read"),
        );

        let result = extractor.extract_tool_name(&attrs);
        // Should prefer Gen-AI attribute
        assert_eq!(result, Some("get_weather".to_string()));
    }
}
