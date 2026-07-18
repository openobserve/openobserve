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

use crate::service::traces::otel::attributes::{
    FrameworkAttributes, GenAiAttributes, LangfuseAttributes, OpenInferenceAttributes,
};

/// Read a non-empty trimmed string attribute, else None.
fn str_attr(attributes: &HashMap<String, json::Value>, key: &str) -> Option<String> {
    let s = attributes.get(key)?.as_str()?.trim();
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

pub struct ToolExtractor;

impl ToolExtractor {
    /// Extract tool name.
    ///
    /// Reads across the tracing conventions OpenObserve documents so tool nodes
    /// render regardless of which framework produced the span:
    ///  - Gen-AI semconv:  `gen_ai.tool.name`
    ///  - OpenInference:   `tool.name`, `tool_call.function.name` (Arize/Phoenix, OpenAI Agents,
    ///    Google ADK)
    ///  - LangChain:       `langchain.tool.name`
    ///  - CrewAI:          `crewai.task.tools`
    ///  - Langfuse:        `langfuse.observation.metadata.tool.name`
    pub fn extract_tool_name(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        // Gen-AI semconv wins.
        if let Some(s) = str_attr(attributes, GenAiAttributes::TOOL_NAME) {
            return Some(s);
        }
        // Framework conventions, in the order they appear across the docs.
        for key in [
            OpenInferenceAttributes::TOOL_NAME,
            OpenInferenceAttributes::TOOL_CALL_FUNCTION_NAME,
            FrameworkAttributes::LANGCHAIN_TOOL_NAME,
            FrameworkAttributes::CREWAI_TASK_TOOLS,
            LangfuseAttributes::METADATA_TOOL_NAME,
        ] {
            if let Some(s) = str_attr(attributes, key) {
                return Some(s);
            }
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
        if let Some(value) = attributes.get(LangfuseAttributes::METADATA_TOOL_ID)
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
        attrs.insert("gen_ai.tool.name".to_string(), json::json!("get_weather"));

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
    fn test_extract_tool_name_openinference() {
        // Arize/Phoenix, OpenAI Agents, Google ADK: tool.name on a TOOL span.
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        attrs.insert("tool.name".to_string(), json::json!("file_search"));
        assert_eq!(
            extractor.extract_tool_name(&attrs),
            Some("file_search".to_string())
        );
    }

    #[test]
    fn test_extract_tool_name_openinference_function_call() {
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        attrs.insert(
            "tool_call.function.name".to_string(),
            json::json!("run_query"),
        );
        assert_eq!(
            extractor.extract_tool_name(&attrs),
            Some("run_query".to_string())
        );
    }

    #[test]
    fn test_extract_tool_name_langchain() {
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        attrs.insert("langchain.tool.name".to_string(), json::json!("calculator"));
        assert_eq!(
            extractor.extract_tool_name(&attrs),
            Some("calculator".to_string())
        );
    }

    #[test]
    fn test_extract_tool_name_crewai() {
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        attrs.insert("crewai.task.tools".to_string(), json::json!("web_scraper"));
        assert_eq!(
            extractor.extract_tool_name(&attrs),
            Some("web_scraper".to_string())
        );
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
            "langfuse.observation.metadata.tool.name".to_string(),
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
            "langfuse.observation.metadata.tool.id".to_string(),
            json::json!("toolu_01T1Mfo98ePBYgoRXG3yPkWt"),
        );

        let result = extractor.extract_tool_call_id(&attrs);
        assert_eq!(result, Some("toolu_01T1Mfo98ePBYgoRXG3yPkWt".to_string()));
    }

    #[test]
    fn test_extract_tool_name_prefers_gen_ai() {
        let extractor = ToolExtractor;
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.tool.name".to_string(), json::json!("get_weather"));
        attrs.insert(
            "langfuse.observation.metadata.tool.name".to_string(),
            json::json!("Read"),
        );

        let result = extractor.extract_tool_name(&attrs);
        // Should prefer Gen-AI attribute
        assert_eq!(result, Some("get_weather".to_string()));
    }
}
