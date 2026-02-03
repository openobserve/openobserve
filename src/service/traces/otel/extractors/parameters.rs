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
