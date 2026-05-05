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

//! Model parameters extraction

use std::collections::HashMap;

use config::utils::json;

use crate::service::traces::otel::{
    attributes::{
        FrameworkAttributes, GenAiAttributes, LangfuseAttributes, OpenInferenceAttributes,
        VercelAiSdkAttributes,
    },
    extractors::parse_json_value,
};

pub struct ParametersExtractor;

impl ParametersExtractor {
    /// Extract model parameters
    pub fn extract(
        &self,
        attributes: &HashMap<String, json::Value>,
        instrumentation_scope_name: &str,
    ) -> HashMap<String, String> {
        let mut params = HashMap::new();

        // Vercel AI SDK
        if instrumentation_scope_name == "ai" {
            if let Some(v) = attributes.get(VercelAiSdkAttributes::SETTINGS_MAX_STEPS) {
                params.insert("maxSteps".to_string(), self.sanitize_param_value(v));
            }
            if let Some(v) = attributes.get(VercelAiSdkAttributes::PROMPT_TOOL_CHOICE) {
                params.insert("toolChoice".to_string(), self.sanitize_param_value(v));
            }
            if let Some(v) = attributes.get(GenAiAttributes::REQUEST_MAX_TOKENS) {
                params.insert("maxTokens".to_string(), self.sanitize_param_value(v));
            }
            if let Some(v) = attributes.get(GenAiAttributes::RESPONSE_FINISH_REASONS) {
                params.insert("finishReason".to_string(), self.sanitize_param_value(v));
            }
            if let Some(v) = attributes.get(GenAiAttributes::SYSTEM) {
                params.insert("system".to_string(), self.sanitize_param_value(v));
            }
            if let Some(v) = attributes.get(VercelAiSdkAttributes::SETTINGS_MAX_RETRIES) {
                params.insert("maxRetries".to_string(), self.sanitize_param_value(v));
            }
            if let Some(v) = attributes.get(VercelAiSdkAttributes::SETTINGS_MODE) {
                params.insert("mode".to_string(), self.sanitize_param_value(v));
            }
            if let Some(v) = attributes.get(GenAiAttributes::REQUEST_TEMPERATURE) {
                params.insert("temperature".to_string(), self.sanitize_param_value(v));
            }
            return params;
        }

        // OpenInference
        if let Some(val) = attributes.get(OpenInferenceAttributes::LLM_INVOCATION_PARAMETERS)
            && let Some(parsed) = parse_json_value(val)
        {
            for (k, v) in parsed {
                params.insert(k, self.sanitize_param_value(&v));
            }
            return params;
        }

        // Langfuse model parameters (support both dot and underscore formats)
        if let Some(val) = attributes.get(LangfuseAttributes::MODEL_PARAMETERS)
            && let Some(parsed) = parse_json_value(val)
        {
            for (k, v) in parsed {
                params.insert(k, self.sanitize_param_value(&v));
            }
            return params;
        }

        // Pydantic-AI model_config
        if let Some(val) = attributes.get(FrameworkAttributes::MODEL_CONFIG)
            && let Some(parsed) = parse_json_value(val)
        {
            for (k, v) in parsed {
                params.insert(k, self.sanitize_param_value(&v));
            }
            return params;
        }

        // Extract all gen_ai.request.* parameters
        for (key, value) in attributes {
            if key.starts_with("gen_ai.request.")
                && key != GenAiAttributes::REQUEST_MODEL
                && let Some(param_key) = key.strip_prefix("gen_ai.request.")
            {
                params.insert(param_key.to_string(), self.sanitize_param_value(value));
            }
        }

        params
    }

    fn sanitize_param_value(&self, value: &json::Value) -> String {
        match value {
            json::Value::String(s) => s.clone(),
            json::Value::Number(n) => n.to_string(),
            json::Value::Bool(b) => b.to_string(),
            _ => value.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_extract_vercel_ai_temperature() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.request.temperature".to_string(),
            json::json!(0.7f64),
        );
        let params = ParametersExtractor.extract(&attrs, "ai");
        assert_eq!(params.get("temperature"), Some(&"0.7".to_string()));
    }

    #[test]
    fn test_extract_vercel_ai_max_tokens() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.request.max_tokens".to_string(), json::json!(512i64));
        let params = ParametersExtractor.extract(&attrs, "ai");
        assert_eq!(params.get("maxTokens"), Some(&"512".to_string()));
    }

    #[test]
    fn test_extract_vercel_ai_returns_early_no_gen_ai_request_fallback() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.request.top_p".to_string(), json::json!(0.9f64));
        let params = ParametersExtractor.extract(&attrs, "ai");
        // Vercel path returns early without the gen_ai.request.* fallback
        assert!(params.get("top_p").is_none());
    }

    #[test]
    fn test_extract_gen_ai_request_fallback_includes_top_p() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.request.top_p".to_string(), json::json!(0.9f64));
        let params = ParametersExtractor.extract(&attrs, "");
        assert_eq!(params.get("top_p"), Some(&"0.9".to_string()));
    }

    #[test]
    fn test_extract_gen_ai_request_model_is_excluded() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.request.model".to_string(), json::json!("gpt-4"));
        let params = ParametersExtractor.extract(&attrs, "");
        assert!(params.get("model").is_none());
    }

    #[test]
    fn test_extract_langfuse_model_parameters_json_string() {
        let mut attrs = HashMap::new();
        let mp = json::json!({ "temperature": "0.5", "max_tokens": "100" });
        attrs.insert(
            "langfuse.observation.model.parameters".to_string(),
            json::Value::String(mp.to_string()),
        );
        let params = ParametersExtractor.extract(&attrs, "");
        assert_eq!(params.get("temperature"), Some(&"0.5".to_string()));
        assert_eq!(params.get("max_tokens"), Some(&"100".to_string()));
    }

    #[test]
    fn test_sanitize_bool_value() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.request.stream".to_string(), json::json!(true));
        let params = ParametersExtractor.extract(&attrs, "");
        assert_eq!(params.get("stream"), Some(&"true".to_string()));
    }

    #[test]
    fn test_extract_vercel_ai_tool_choice() {
        let mut attrs = HashMap::new();
        attrs.insert("ai.prompt.toolChoice".to_string(), json::json!("auto"));
        let params = ParametersExtractor.extract(&attrs, "ai");
        assert_eq!(params.get("toolChoice"), Some(&"auto".to_string()));
    }

    #[test]
    fn test_extract_empty_returns_empty_map() {
        let params = ParametersExtractor.extract(&HashMap::new(), "");
        assert!(params.is_empty());
    }

    #[test]
    fn test_sanitize_array_value_uses_json_fallback() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.request.stop_sequences".to_string(),
            json::json!(["stop", "end"]),
        );
        let params = ParametersExtractor.extract(&attrs, "");
        let val = params.get("stop_sequences").unwrap();
        assert!(val.contains("stop"));
        assert!(val.contains("end"));
    }

    #[test]
    fn test_extract_openinference_invocation_parameters() {
        let mut attrs = HashMap::new();
        let json_str = r#"{"temperature": 0.5, "max_tokens": 200}"#;
        attrs.insert(
            "llm.invocation_parameters".to_string(),
            json::Value::String(json_str.to_string()),
        );
        let params = ParametersExtractor.extract(&attrs, "");
        assert_eq!(params.get("temperature"), Some(&"0.5".to_string()));
        assert_eq!(params.get("max_tokens"), Some(&"200".to_string()));
    }

    #[test]
    fn test_extract_pydantic_model_config() {
        let mut attrs = HashMap::new();
        let json_str = r#"{"temperature": 0.3}"#;
        attrs.insert(
            "model_config".to_string(),
            json::Value::String(json_str.to_string()),
        );
        let params = ParametersExtractor.extract(&attrs, "");
        assert_eq!(params.get("temperature"), Some(&"0.3".to_string()));
    }

    #[test]
    fn test_vercel_max_steps() {
        let mut attrs = HashMap::new();
        attrs.insert("ai.settings.maxSteps".to_string(), json::json!(5i64));
        let params = ParametersExtractor.extract(&attrs, "ai");
        assert_eq!(params.get("maxSteps"), Some(&"5".to_string()));
    }

    #[test]
    fn test_vercel_max_retries() {
        let mut attrs = HashMap::new();
        attrs.insert("ai.settings.maxRetries".to_string(), json::json!(3i64));
        let params = ParametersExtractor.extract(&attrs, "ai");
        assert_eq!(params.get("maxRetries"), Some(&"3".to_string()));
    }

    #[test]
    fn test_vercel_mode() {
        let mut attrs = HashMap::new();
        attrs.insert("ai.settings.mode".to_string(), json::json!("json"));
        let params = ParametersExtractor.extract(&attrs, "ai");
        assert_eq!(params.get("mode"), Some(&"json".to_string()));
    }

    #[test]
    fn test_vercel_system_prompt() {
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.system".to_string(), json::json!("You are helpful"));
        let params = ParametersExtractor.extract(&attrs, "ai");
        assert_eq!(params.get("system"), Some(&"You are helpful".to_string()));
    }

    #[test]
    fn test_vercel_finish_reason() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "gen_ai.response.finish_reasons".to_string(),
            json::json!("stop"),
        );
        let params = ParametersExtractor.extract(&attrs, "ai");
        assert_eq!(params.get("finishReason"), Some(&"stop".to_string()));
    }
}
