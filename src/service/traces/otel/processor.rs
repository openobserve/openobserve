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

//! OTEL Ingestion Processor
//!
//! Processes OpenTelemetry resource spans and enriches them with OpenObserve-specific
//! attributes following gen-ai semantic conventions.

use std::collections::HashMap;

use config::utils::json;
use serde_json::Map;

use super::{
    attributes::{
        FrameworkAttributes, GenAiAttributes, GenAiEventNames, LlmAttributes,
        OpenInferenceAttributes, OtelAttributes, VercelAiSdkAttributes,
    },
    observation_type_mapper::{ScopeInfo, map_to_observation_type},
    utils,
};
use crate::common::meta::traces::Event;

pub struct OtelIngestionProcessor {}

impl Default for OtelIngestionProcessor {
    fn default() -> Self {
        Self::new()
    }
}

impl OtelIngestionProcessor {
    pub fn new() -> Self {
        Self {}
    }

    /// Process span attributes and enrich them with OpenObserve-specific fields
    /// This modifies span_attributes in-place, removing processed attributes and adding enriched
    /// fields
    pub fn process_span(
        &self,
        span_attributes: &mut HashMap<String, json::Value>,
        resource_attributes: &HashMap<String, json::Value>,
        scope_name: Option<&str>,
        events: &[Event],
        start_time_iso: Option<&str>,
    ) {
        // 1. Extract and add observation type
        let scope_info = scope_name.map(|name| ScopeInfo {
            name: Some(name.to_string()),
        });
        let obs_type =
            map_to_observation_type(span_attributes, resource_attributes, scope_info.as_ref());

        // 2. Extract model name
        let model_name = self.extract_model_name(span_attributes);

        // 3. Extract input and output (this will identify which attributes to remove)
        let (input, output) =
            self.extract_input_and_output(events, span_attributes, scope_name.unwrap_or(""));

        // 4. Extract model parameters
        let model_params = self.extract_model_parameters(span_attributes, scope_name.unwrap_or(""));

        // 5. Extract usage details
        let usage = self.extract_usage_details(span_attributes, scope_name.unwrap_or(""));

        // 6. Extract cost details
        let cost = self.extract_cost_details(span_attributes);

        // 7. Extract user and session
        let user_id = self.extract_user_id(span_attributes);
        let session_id = self.extract_session_id(span_attributes);

        // 8. Extract environment
        let environment = self.extract_environment(span_attributes, resource_attributes);

        // 9. Extract tags
        let tags = self.extract_tags(span_attributes);

        // 10. Extract prompt information
        let prompt_name = self.extract_prompt_name(span_attributes);
        let prompt_version = self.extract_prompt_version(span_attributes);

        // 11. Extract completion start time (time to first token)
        let completion_start_time =
            self.extract_completion_start_time(span_attributes, start_time_iso);

        // Now remove all input/output related attributes
        span_attributes.retain(|key, _| !self.is_input_output_attribute(key));

        // Add enriched fields
        span_attributes.insert(
            LlmAttributes::OBSERVATION_TYPE.to_string(),
            json::json!(obs_type.as_str()),
        );

        if let Some(model) = model_name {
            span_attributes.insert(LlmAttributes::MODEL_NAME.to_string(), json::json!(model));
        }

        if let Some(input_val) = input {
            span_attributes.insert(LlmAttributes::INPUT.to_string(), input_val);
        }

        if let Some(output_val) = output {
            span_attributes.insert(LlmAttributes::OUTPUT.to_string(), output_val);
        }

        if !model_params.is_empty() {
            span_attributes.insert(
                LlmAttributes::MODEL_PARAMETERS.to_string(),
                json::json!(model_params),
            );
        }

        if !usage.is_empty() {
            span_attributes.insert(LlmAttributes::USAGE_DETAILS.to_string(), json::json!(usage));
        }

        if !cost.is_empty() {
            span_attributes.insert(LlmAttributes::COST_DETAILS.to_string(), json::json!(cost));
        }

        if let Some(uid) = user_id {
            span_attributes.insert(LlmAttributes::USER_ID.to_string(), json::json!(uid));
        }

        if let Some(sid) = session_id {
            span_attributes.insert(LlmAttributes::SESSION_ID.to_string(), json::json!(sid));
        }

        span_attributes.insert(
            LlmAttributes::ENVIRONMENT.to_string(),
            json::json!(environment),
        );

        if !tags.is_empty() {
            span_attributes.insert(LlmAttributes::TAGS.to_string(), json::json!(tags));
        }

        if let Some(pname) = prompt_name {
            span_attributes.insert(LlmAttributes::PROMPT_NAME.to_string(), json::json!(pname));
        }

        if let Some(pversion) = prompt_version {
            span_attributes.insert(
                LlmAttributes::PROMPT_VERSION.to_string(),
                json::json!(pversion),
            );
        }

        if let Some(completion_time) = completion_start_time {
            span_attributes.insert(
                LlmAttributes::COMPLETION_START_TIME.to_string(),
                json::json!(completion_time),
            );
        }
    }

    /// Check if an attribute key is an input/output related attribute that should be removed
    fn is_input_output_attribute(&self, key: &str) -> bool {
        // List of all input/output attribute keys that should be filtered out
        let input_output_keys = [
            // Vercel AI SDK
            VercelAiSdkAttributes::PROMPT_MESSAGES,
            VercelAiSdkAttributes::PROMPT,
            VercelAiSdkAttributes::TOOL_CALL_ARGS,
            VercelAiSdkAttributes::RESPONSE_TEXT,
            VercelAiSdkAttributes::RESULT_TEXT,
            VercelAiSdkAttributes::TOOL_CALL_RESULT,
            VercelAiSdkAttributes::RESPONSE_OBJECT,
            VercelAiSdkAttributes::RESULT_OBJECT,
            VercelAiSdkAttributes::RESPONSE_TOOL_CALLS,
            VercelAiSdkAttributes::RESULT_TOOL_CALLS,
            // Google Vertex AI
            FrameworkAttributes::GCP_VERTEX_AGENT_LLM_REQUEST,
            FrameworkAttributes::GCP_VERTEX_AGENT_LLM_RESPONSE,
            FrameworkAttributes::GCP_VERTEX_AGENT_TOOL_CALL_ARGS,
            FrameworkAttributes::GCP_VERTEX_AGENT_TOOL_RESPONSE,
            // Logfire
            FrameworkAttributes::LOGFIRE_PROMPT,
            FrameworkAttributes::LOGFIRE_ALL_MESSAGES_EVENTS,
            FrameworkAttributes::LOGFIRE_EVENTS,
            // LiveKit
            FrameworkAttributes::LIVEKIT_INPUT_TEXT,
            FrameworkAttributes::LIVEKIT_FUNCTION_TOOL_OUTPUT,
            FrameworkAttributes::LIVEKIT_RESPONSE_TEXT,
            // MLFlow
            FrameworkAttributes::MLFLOW_SPAN_INPUTS,
            FrameworkAttributes::MLFLOW_SPAN_OUTPUTS,
            // TraceLoop
            FrameworkAttributes::TRACELOOP_ENTITY_INPUT,
            FrameworkAttributes::TRACELOOP_ENTITY_OUTPUT,
            // SmolAgents
            FrameworkAttributes::INPUT_VALUE,
            FrameworkAttributes::OUTPUT_VALUE,
            // Pydantic
            FrameworkAttributes::INPUT,
            FrameworkAttributes::OUTPUT,
            FrameworkAttributes::TOOL_ARGUMENTS,
            FrameworkAttributes::TOOL_RESPONSE,
            // Standard Gen-AI
            GenAiAttributes::INPUT_MESSAGES,
            GenAiAttributes::OUTPUT_MESSAGES,
            GenAiAttributes::TOOL_CALL_ARGUMENTS,
            GenAiAttributes::TOOL_CALL_RESULT,
        ];

        // Check exact matches
        if input_output_keys.contains(&key) {
            return true;
        }

        // Check prefixes for nested attributes
        key.starts_with("gen_ai.prompt")
            || key.starts_with("gen_ai.completion")
            || key.starts_with("llm.input_messages")
            || key.starts_with("llm.output_messages")
    }

    /// Extract model name from attributes
    fn extract_model_name(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        let model_name_keys = [
            GenAiAttributes::RESPONSE_MODEL,
            VercelAiSdkAttributes::MODEL_ID,
            GenAiAttributes::REQUEST_MODEL,
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

    /// Extract input and output from events and attributes
    fn extract_input_and_output(
        &self,
        events: &[Event],
        attributes: &HashMap<String, json::Value>,
        instrumentation_scope_name: &str,
    ) -> (Option<json::Value>, Option<json::Value>) {
        // 1. Vercel AI SDK
        if instrumentation_scope_name == "ai" {
            let (input, output) = self.extract_vercel_ai_sdk_input_output(attributes);
            if input.is_some() || output.is_some() {
                return (input, output);
            }
        }

        // 2. Gen-AI events (from span.events)
        if let Some((input, output)) = self.extract_from_gen_ai_events(events) {
            return (input, output);
        }

        // 3. Legacy Semantic Kernel events
        let (input, output) = self.extract_legacy_semantic_kernel_events(events);
        if input.is_some() || output.is_some() {
            return (input, output);
        }

        // 4. Google Vertex AI
        if let Some(input) = attributes.get(FrameworkAttributes::GCP_VERTEX_AGENT_LLM_REQUEST) {
            let mut output_val = attributes.get(FrameworkAttributes::GCP_VERTEX_AGENT_LLM_RESPONSE);
            let mut input_val = Some(input.clone());

            // Handle tool call - GCP sets llm_request/llm_response to {} when using tool_call_args
            if input.as_str() == Some("{}") {
                input_val = attributes
                    .get(FrameworkAttributes::GCP_VERTEX_AGENT_TOOL_CALL_ARGS)
                    .cloned();
            }
            if output_val.and_then(|v| v.as_str()) == Some("{}") || output_val.is_none() {
                output_val = attributes.get(FrameworkAttributes::GCP_VERTEX_AGENT_TOOL_RESPONSE);
            }

            return (input_val, output_val.cloned());
        }

        // 5. Logfire
        if let Some(input) = attributes.get(FrameworkAttributes::LOGFIRE_PROMPT) {
            let output = attributes.get(FrameworkAttributes::LOGFIRE_ALL_MESSAGES_EVENTS);
            return (Some(input.clone()), output.cloned());
        }

        // 6. LiveKit
        if let Some(input) = attributes.get(FrameworkAttributes::LIVEKIT_INPUT_TEXT) {
            let output = attributes
                .get(FrameworkAttributes::LIVEKIT_FUNCTION_TOOL_OUTPUT)
                .or_else(|| attributes.get(FrameworkAttributes::LIVEKIT_RESPONSE_TEXT));
            return (Some(input.clone()), output.cloned());
        }

        // 7. Logfire events array
        if let Some(events_val) = attributes.get(FrameworkAttributes::LOGFIRE_EVENTS)
            && let Some((input, output)) = self.extract_logfire_events(events_val)
        {
            return (input, output);
        }

        // 8. MLFlow
        if let Some(input) = attributes.get(FrameworkAttributes::MLFLOW_SPAN_INPUTS) {
            let output = attributes.get(FrameworkAttributes::MLFLOW_SPAN_OUTPUTS);
            return (Some(input.clone()), output.cloned());
        }

        // 9. TraceLoop (with direct attributes)
        if let Some(input) = attributes.get(FrameworkAttributes::TRACELOOP_ENTITY_INPUT) {
            let output = attributes.get(FrameworkAttributes::TRACELOOP_ENTITY_OUTPUT);
            return (Some(input.clone()), output.cloned());
        }

        // 10. SmolAgents
        if let Some(input) = attributes.get(FrameworkAttributes::INPUT_VALUE) {
            let output = attributes.get(FrameworkAttributes::OUTPUT_VALUE);
            return (Some(input.clone()), output.cloned());
        }

        // 11. Pydantic
        if let Some(input) = attributes.get(FrameworkAttributes::INPUT) {
            let output = attributes.get(FrameworkAttributes::OUTPUT);
            return (Some(input.clone()), output.cloned());
        }

        // 12. Pydantic-AI tools
        if let Some(input) = attributes.get(FrameworkAttributes::TOOL_ARGUMENTS) {
            let output = attributes.get(FrameworkAttributes::TOOL_RESPONSE);
            return (Some(input.clone()), output.cloned());
        }

        // 13. TraceLoop nested attributes (gen_ai.prompt.* and gen_ai.completion.*)
        let (input, output) = self.extract_traceloop_nested_attributes(attributes);
        if input.is_some() || output.is_some() {
            return (input, output);
        }

        // 14. OpenInference nested attributes (llm.input_messages.* and llm.output_messages.*)
        let (input, output) = self.extract_openinference_nested_attributes(attributes);
        if input.is_some() || output.is_some() {
            return (input, output);
        }

        // 15. Standard Gen-AI attributes
        if let Some(input) = attributes.get(GenAiAttributes::INPUT_MESSAGES) {
            let output = attributes.get(GenAiAttributes::OUTPUT_MESSAGES);
            return (Some(input.clone()), output.cloned());
        }

        // 16. Gen-AI tool attributes
        if let Some(input) = attributes.get(GenAiAttributes::TOOL_CALL_ARGUMENTS) {
            let output = attributes.get(GenAiAttributes::TOOL_CALL_RESULT);
            return (Some(input.clone()), output.cloned());
        }

        (None, None)
    }

    fn extract_vercel_ai_sdk_input_output(
        &self,
        attributes: &HashMap<String, json::Value>,
    ) -> (Option<json::Value>, Option<json::Value>) {
        let input = if let Some(val) = attributes.get(VercelAiSdkAttributes::PROMPT_MESSAGES) {
            Some(val.clone())
        } else if let Some(val) = attributes.get(VercelAiSdkAttributes::PROMPT) {
            Some(val.clone())
        } else {
            attributes
                .get(VercelAiSdkAttributes::TOOL_CALL_ARGS)
                .cloned()
        };

        let output = if let Some(text) = attributes.get(VercelAiSdkAttributes::RESPONSE_TEXT) {
            if let Some(tool_calls) = attributes.get(VercelAiSdkAttributes::RESPONSE_TOOL_CALLS) {
                Some(json::json!({
                    "role": "assistant",
                    "content": text,
                    "tool_calls": tool_calls
                }))
            } else {
                Some(text.clone())
            }
        } else if let Some(val) = attributes.get(VercelAiSdkAttributes::RESULT_TEXT) {
            Some(val.clone())
        } else if let Some(val) = attributes.get(VercelAiSdkAttributes::TOOL_CALL_RESULT) {
            Some(val.clone())
        } else if let Some(val) = attributes.get(VercelAiSdkAttributes::RESPONSE_OBJECT) {
            Some(val.clone())
        } else if let Some(val) = attributes.get(VercelAiSdkAttributes::RESULT_OBJECT) {
            Some(val.clone())
        } else if let Some(val) = attributes.get(VercelAiSdkAttributes::RESPONSE_TOOL_CALLS) {
            Some(val.clone())
        } else {
            attributes
                .get(VercelAiSdkAttributes::RESULT_TOOL_CALLS)
                .cloned()
        };

        (input, output)
    }

    fn extract_from_gen_ai_events(
        &self,
        events: &[Event],
    ) -> Option<(Option<json::Value>, Option<json::Value>)> {
        let mut input_events: Vec<json::Value> = Vec::new();
        let mut output_events: Vec<json::Value> = Vec::new();

        for event in events {
            match event.name.as_str() {
                GenAiEventNames::SYSTEM_MESSAGE
                | GenAiEventNames::USER_MESSAGE
                | GenAiEventNames::ASSISTANT_MESSAGE
                | GenAiEventNames::TOOL_MESSAGE => {
                    let mut result = Map::new();
                    let role = event
                        .name
                        .strip_prefix("gen_ai.")
                        .and_then(|s| s.strip_suffix(".message"))
                        .unwrap_or("unknown");
                    result.insert("role".to_string(), json::json!(role));
                    for (k, v) in &event.attributes {
                        result.insert(k.clone(), v.clone());
                    }
                    input_events.push(json::Value::Object(result));
                }
                GenAiEventNames::CHOICE => {
                    output_events.push(json::Value::Object(Self::clone_event_attributes(
                        &event.attributes,
                    )));
                }
                _ => {}
            }
        }

        if input_events.is_empty() && output_events.is_empty() {
            return None;
        }

        let input = if !input_events.is_empty() {
            Some(json::Value::Array(input_events))
        } else {
            None
        };

        let output = if output_events.is_empty() {
            None
        } else if output_events.len() == 1 {
            Some(output_events.into_iter().next().unwrap())
        } else {
            Some(json::Value::Array(output_events))
        };

        Some((input, output))
    }

    fn extract_legacy_semantic_kernel_events(
        &self,
        events: &[Event],
    ) -> (Option<json::Value>, Option<json::Value>) {
        let input_event = events
            .iter()
            .find(|e| e.name == GenAiEventNames::CONTENT_PROMPT);

        let output_event = events
            .iter()
            .find(|e| e.name == GenAiEventNames::CONTENT_COMPLETION);

        let input =
            input_event.map(|e| json::Value::Object(Self::clone_event_attributes(&e.attributes)));
        let output =
            output_event.map(|e| json::Value::Object(Self::clone_event_attributes(&e.attributes)));

        (input, output)
    }

    fn clone_event_attributes(
        attributes: &HashMap<String, json::Value>,
    ) -> Map<String, json::Value> {
        attributes
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    fn extract_logfire_events(
        &self,
        events_val: &json::Value,
    ) -> Option<(Option<json::Value>, Option<json::Value>)> {
        let events: Vec<json::Value> = if let Some(s) = events_val.as_str() {
            serde_json::from_str(s).ok()?
        } else if let Some(arr) = events_val.as_array() {
            arr.clone()
        } else {
            return None;
        };

        let choice_event = events
            .iter()
            .find(|e| {
                e.get("event.name")
                    .and_then(|n| n.as_str())
                    .map(|name| name == GenAiEventNames::CHOICE)
                    .unwrap_or(false)
            })
            .cloned();

        let input_events: Vec<json::Value> = events
            .iter()
            .filter(|e| {
                e.get("event.name")
                    .and_then(|n| n.as_str())
                    .map(|name| name != GenAiEventNames::CHOICE)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();

        if choice_event.is_none() && input_events.is_empty() {
            return None;
        }

        let input = if !input_events.is_empty() {
            Some(json::Value::Array(input_events))
        } else {
            None
        };

        Some((input, choice_event))
    }

    /// Extract TraceLoop nested attributes (gen_ai.prompt.* -> gen_ai.completion.*)
    fn extract_traceloop_nested_attributes(
        &self,
        attributes: &HashMap<String, json::Value>,
    ) -> (Option<json::Value>, Option<json::Value>) {
        let input_attrs: HashMap<String, json::Value> = attributes
            .iter()
            .filter(|(k, _)| k.starts_with("gen_ai.prompt"))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        let output_attrs: HashMap<String, json::Value> = attributes
            .iter()
            .filter(|(k, _)| k.starts_with("gen_ai.completion"))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        if input_attrs.is_empty() && output_attrs.is_empty() {
            return (None, None);
        }

        let input = if !input_attrs.is_empty() {
            Some(utils::convert_key_path_to_nested_object(
                &input_attrs,
                "gen_ai.prompt",
            ))
        } else {
            None
        };

        let output = if !output_attrs.is_empty() {
            Some(utils::convert_key_path_to_nested_object(
                &output_attrs,
                "gen_ai.completion",
            ))
        } else {
            None
        };

        (input, output)
    }

    /// Extract OpenInference nested attributes (llm.input_messages.* -> llm.output_messages.*)
    fn extract_openinference_nested_attributes(
        &self,
        attributes: &HashMap<String, json::Value>,
    ) -> (Option<json::Value>, Option<json::Value>) {
        let input_attrs: HashMap<String, json::Value> = attributes
            .iter()
            .filter(|(k, _)| k.starts_with("llm.input_messages"))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        let output_attrs: HashMap<String, json::Value> = attributes
            .iter()
            .filter(|(k, _)| k.starts_with("llm.output_messages"))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        if input_attrs.is_empty() && output_attrs.is_empty() {
            return (None, None);
        }

        let input = if !input_attrs.is_empty() {
            Some(utils::convert_key_path_to_nested_object(
                &input_attrs,
                "llm.input_messages",
            ))
        } else {
            None
        };

        let output = if !output_attrs.is_empty() {
            Some(utils::convert_key_path_to_nested_object(
                &output_attrs,
                "llm.output_messages",
            ))
        } else {
            None
        };

        (input, output)
    }

    /// Extract model parameters
    fn extract_model_parameters(
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
            && let Ok(parsed) = serde_json::from_value::<HashMap<String, json::Value>>(val.clone())
        {
            for (k, v) in parsed {
                params.insert(k, self.sanitize_param_value(&v));
            }
            return params;
        }

        // Pydantic-AI model_config
        if let Some(val) = attributes.get(FrameworkAttributes::MODEL_CONFIG)
            && let Ok(parsed) = serde_json::from_value::<HashMap<String, json::Value>>(val.clone())
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

    /// Extract usage details (token counts)
    fn extract_usage_details(
        &self,
        attributes: &HashMap<String, json::Value>,
        instrumentation_scope_name: &str,
    ) -> HashMap<String, i64> {
        let mut usage = HashMap::new();

        // Vercel AI SDK
        if instrumentation_scope_name == "ai" {
            if let Some(v) = attributes
                .get(GenAiAttributes::USAGE_INPUT_TOKENS)
                .or_else(|| attributes.get(GenAiAttributes::USAGE_PROMPT_TOKENS))
                && let Some(num) = v.as_i64()
            {
                usage.insert("input".to_string(), num);
            }
            if let Some(v) = attributes
                .get(GenAiAttributes::USAGE_OUTPUT_TOKENS)
                .or_else(|| attributes.get(GenAiAttributes::USAGE_COMPLETION_TOKENS))
                && let Some(num) = v.as_i64()
            {
                usage.insert("output".to_string(), num);
            }
            if let Some(v) = attributes.get(VercelAiSdkAttributes::USAGE_TOKENS)
                && let Some(num) = v.as_i64()
            {
                usage.insert("total".to_string(), num);
            }
        }

        // Standard Gen-AI attributes
        let token_keys = [
            (GenAiAttributes::USAGE_INPUT_TOKENS, "input"),
            (GenAiAttributes::USAGE_OUTPUT_TOKENS, "output"),
            (GenAiAttributes::USAGE_TOTAL_TOKENS, "total"),
            (GenAiAttributes::USAGE_PROMPT_TOKENS, "input"),
            (GenAiAttributes::USAGE_COMPLETION_TOKENS, "output"),
            (
                GenAiAttributes::USAGE_CACHE_READ_TOKENS,
                "input_cached_tokens",
            ),
            (
                GenAiAttributes::USAGE_CACHE_WRITE_TOKENS,
                "input_cache_creation",
            ),
        ];

        for (key, usage_key) in &token_keys {
            if let Some(value) = attributes.get(*key)
                && let Some(num) = value.as_i64()
            {
                usage.insert(usage_key.to_string(), num);
            }
        }

        // OpenInference
        if let Some(v) = attributes.get(OpenInferenceAttributes::LLM_TOKEN_COUNT_PROMPT)
            && let Some(num) = v.as_i64()
        {
            usage.insert("input".to_string(), num);
        }
        if let Some(v) = attributes.get(OpenInferenceAttributes::LLM_TOKEN_COUNT_COMPLETION)
            && let Some(num) = v.as_i64()
        {
            usage.insert("output".to_string(), num);
        }

        usage
    }

    /// Extract cost details
    fn extract_cost_details(
        &self,
        attributes: &HashMap<String, json::Value>,
    ) -> HashMap<String, f64> {
        let mut cost = HashMap::new();

        if let Some(v) = attributes.get(GenAiAttributes::USAGE_COST)
            && let Some(num) = v.as_f64()
        {
            cost.insert("total".to_string(), num);
        }

        cost
    }

    /// Extract user ID
    fn extract_user_id(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        let user_id_keys = [
            OtelAttributes::USER_ID,
            VercelAiSdkAttributes::TELEMETRY_METADATA_USER_ID,
        ];

        for key in &user_id_keys {
            if let Some(value) = attributes.get(*key)
                && let Some(s) = value.as_str()
            {
                return Some(s.to_string());
            }
        }
        None
    }

    /// Extract session ID
    fn extract_session_id(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        let session_id_keys = [
            OtelAttributes::SESSION_ID,
            GenAiAttributes::CONVERSATION_ID,
            VercelAiSdkAttributes::TELEMETRY_METADATA_SESSION_ID,
        ];

        for key in &session_id_keys {
            if let Some(value) = attributes.get(*key)
                && let Some(s) = value.as_str()
            {
                return Some(s.to_string());
            }
        }
        None
    }

    /// Extract environment
    fn extract_environment(
        &self,
        attributes: &HashMap<String, json::Value>,
        resource_attributes: &HashMap<String, json::Value>,
    ) -> String {
        let environment_keys = [
            OtelAttributes::DEPLOYMENT_ENVIRONMENT_NAME,
            OtelAttributes::DEPLOYMENT_ENVIRONMENT,
        ];

        for key in &environment_keys {
            if let Some(value) = attributes.get(*key)
                && let Some(s) = value.as_str()
            {
                return s.to_string();
            }
            if let Some(value) = resource_attributes.get(*key)
                && let Some(s) = value.as_str()
            {
                return s.to_string();
            }
        }

        "default".to_string()
    }

    /// Extract tags
    fn extract_tags(&self, attributes: &HashMap<String, json::Value>) -> Vec<String> {
        let tags_keys = [
            VercelAiSdkAttributes::TELEMETRY_METADATA_TAGS,
            FrameworkAttributes::TAG_TAGS,
        ];

        for key in &tags_keys {
            if let Some(value) = attributes.get(*key) {
                if let Some(arr) = value.as_array() {
                    return arr
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect();
                } else if let Some(s) = value.as_str() {
                    if s.starts_with('[') {
                        if let Ok(arr) = serde_json::from_str::<Vec<String>>(s) {
                            return arr;
                        }
                    } else if s.contains(',') {
                        return s.split(',').map(|t| t.trim().to_string()).collect();
                    } else {
                        return vec![s.to_string()];
                    }
                }
            }
        }

        Vec::new()
    }

    /// Extract prompt name from AI SDK metadata
    fn extract_prompt_name(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        if let Some((name, _)) = utils::parse_ai_sdk_prompt_metadata(attributes) {
            return Some(name);
        }
        None
    }

    /// Extract prompt version from AI SDK metadata
    fn extract_prompt_version(&self, attributes: &HashMap<String, json::Value>) -> Option<i32> {
        if let Some((_, version)) = utils::parse_ai_sdk_prompt_metadata(attributes) {
            return Some(version);
        }
        None
    }

    /// Extract completion start time (time to first token)
    /// Calculates the timestamp of when the first token was generated
    fn extract_completion_start_time(
        &self,
        attributes: &HashMap<String, json::Value>,
        start_time_iso: Option<&str>,
    ) -> Option<String> {
        // Try to get ms to first chunk from Vercel AI SDK
        let ms_to_first_chunk = attributes
            .get(VercelAiSdkAttributes::RESPONSE_MS_TO_FIRST_CHUNK)
            .or_else(|| attributes.get(VercelAiSdkAttributes::STREAM_MS_TO_FIRST_CHUNK));

        if let Some(ms_value) = ms_to_first_chunk
            && let Some(start_time) = start_time_iso
        {
            // Parse the start time as ISO timestamp
            if let Ok(start_datetime) = chrono::DateTime::parse_from_rfc3339(start_time) {
                // Get milliseconds value
                let ms = if let Some(num) = ms_value.as_f64() {
                    num.ceil() as i64
                } else if let Some(num) = ms_value.as_i64() {
                    num
                } else if let Some(s) = ms_value.as_str() {
                    s.parse::<f64>().ok().map(|n| n.ceil() as i64)?
                } else {
                    return None;
                };

                // Add milliseconds to start time
                let completion_start = start_datetime + chrono::Duration::milliseconds(ms);

                return Some(completion_start.to_rfc3339());
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
        let processor = OtelIngestionProcessor::new();
        let attrs = make_attributes(vec![("gen_ai.response.model", json::json!("gpt-4"))]);

        let result = processor.extract_model_name(&attrs);
        assert_eq!(result, Some("gpt-4".to_string()));
    }

    #[test]
    fn test_extract_traceloop_nested_attributes() {
        let processor = OtelIngestionProcessor::new();
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.prompt.0.role".to_string(), json::json!("user"));
        attrs.insert("gen_ai.prompt.0.content".to_string(), json::json!("Hello"));
        attrs.insert(
            "gen_ai.completion.0.role".to_string(),
            json::json!("assistant"),
        );
        attrs.insert("gen_ai.completion.0.content".to_string(), json::json!("Hi"));

        let (input, output) = processor.extract_traceloop_nested_attributes(&attrs);
        assert!(input.is_some());
        assert!(output.is_some());

        let input_arr = input.unwrap();
        assert!(input_arr.is_array());
        assert_eq!(input_arr[0]["role"], "user");
        assert_eq!(input_arr[0]["content"], "Hello");
    }

    #[test]
    fn test_is_input_output_attribute() {
        let processor = OtelIngestionProcessor::new();

        assert!(processor.is_input_output_attribute("gen_ai.input.messages"));
        assert!(processor.is_input_output_attribute("gen_ai.prompt.0.role"));
        assert!(processor.is_input_output_attribute("llm.input_messages.0.content"));
        assert!(processor.is_input_output_attribute("ai.prompt.messages"));
        assert!(!processor.is_input_output_attribute("user.id"));
        assert!(!processor.is_input_output_attribute("gen_ai.request.model"));
    }

    #[test]
    fn test_process_span_removes_input_output_attrs() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert(
            "gen_ai.input.messages".to_string(),
            json::json!("[{\"role\":\"user\"}]"),
        );
        span_attrs.insert(
            "gen_ai.output.messages".to_string(),
            json::json!("[{\"role\":\"assistant\"}]"),
        );
        span_attrs.insert("user.id".to_string(), json::json!("user-123"));
        span_attrs.insert("gen_ai.request.model".to_string(), json::json!("gpt-4"));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events, None);

        // Input/output attributes should be removed
        assert!(!span_attrs.contains_key("gen_ai.input.messages"));
        assert!(!span_attrs.contains_key("gen_ai.output.messages"));

        // Enriched fields should be added with llm_ prefix
        assert!(span_attrs.contains_key(LlmAttributes::INPUT));
        assert!(span_attrs.contains_key(LlmAttributes::OUTPUT));
        assert!(span_attrs.contains_key(LlmAttributes::OBSERVATION_TYPE));
        assert!(span_attrs.contains_key(LlmAttributes::MODEL_NAME));
        assert!(span_attrs.contains_key(LlmAttributes::ENVIRONMENT));

        // Other attributes should remain
        assert!(span_attrs.contains_key("user.id"));
        assert!(span_attrs.contains_key("gen_ai.request.model"));
        assert!(span_attrs.contains_key("gen_ai.operation.name"));
    }

    #[test]
    fn test_extract_openinference_nested() {
        let processor = OtelIngestionProcessor::new();
        let mut attrs = HashMap::new();
        attrs.insert("llm.input_messages.0.role".to_string(), json::json!("user"));
        attrs.insert(
            "llm.input_messages.0.content".to_string(),
            json::json!("Test"),
        );

        let (input, _) = processor.extract_openinference_nested_attributes(&attrs);
        assert!(input.is_some());
        let input_arr = input.unwrap();
        assert!(input_arr.is_array());
        assert_eq!(input_arr[0]["role"], "user");
        assert_eq!(input_arr[0]["content"], "Test");
    }
}
