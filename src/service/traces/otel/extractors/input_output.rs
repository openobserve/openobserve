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

//! Input and output extraction from various OTEL frameworks

use std::collections::HashMap;

use config::utils::json;
use serde_json::Map;

use crate::{
    common::meta::traces::Event,
    service::traces::otel::attributes::{
        FrameworkAttributes, GenAiAttributes, GenAiEventNames, VercelAiSdkAttributes,
    },
};

pub struct InputOutputExtractor;

impl InputOutputExtractor {
    /// Extract input and output from events and attributes
    pub fn extract(
        &self,
        events: &[Event],
        attributes: &HashMap<String, json::Value>,
        instrumentation_scope_name: &str,
    ) -> (Option<json::Value>, Option<json::Value>) {
        // Gen-AI events (from span.events)
        if let Some((input, output)) = self.extract_from_gen_ai_events(events) {
            return (input, output);
        }

        // TraceLoop (with direct attributes)
        if let Some(input) = attributes.get(FrameworkAttributes::TRACELOOP_ENTITY_INPUT) {
            let output = attributes.get(FrameworkAttributes::TRACELOOP_ENTITY_OUTPUT);
            return (Some(input.clone()), output.cloned());
        }

        // TraceLoop nested attributes (gen_ai.prompt.* and gen_ai.completion.*)
        let (input, output) = self.extract_traceloop_nested(attributes);
        if input.is_some() || output.is_some() {
            return (input, output);
        }

        // Standard Gen-AI attributes
        if let Some(input) = attributes.get(GenAiAttributes::INPUT_MESSAGES) {
            let output = attributes.get(GenAiAttributes::OUTPUT_MESSAGES);
            return (Some(input.clone()), output.cloned());
        }

        // Gen-AI tool attributes
        if let Some(input) = attributes.get(GenAiAttributes::TOOL_CALL_ARGUMENTS) {
            let output = attributes.get(GenAiAttributes::TOOL_CALL_RESULT);
            return (Some(input.clone()), output.cloned());
        }

        // Legacy Semantic Kernel events
        let (input, output) = self.extract_legacy_semantic_kernel_events(events);
        if input.is_some() || output.is_some() {
            return (input, output);
        }

        // Vercel AI SDK
        if instrumentation_scope_name == "ai" {
            let (input, output) = self.extract_vercel_ai_sdk(attributes);
            if input.is_some() || output.is_some() {
                return (input, output);
            }
        }

        // Google Vertex AI
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

        // Logfire
        if let Some(input) = attributes.get(FrameworkAttributes::LOGFIRE_PROMPT) {
            let output = attributes.get(FrameworkAttributes::LOGFIRE_ALL_MESSAGES_EVENTS);
            return (Some(input.clone()), output.cloned());
        }

        // LiveKit
        if let Some(input) = attributes.get(FrameworkAttributes::LIVEKIT_INPUT_TEXT) {
            let output = attributes
                .get(FrameworkAttributes::LIVEKIT_FUNCTION_TOOL_OUTPUT)
                .or_else(|| attributes.get(FrameworkAttributes::LIVEKIT_RESPONSE_TEXT));
            return (Some(input.clone()), output.cloned());
        }

        // Logfire events array
        if let Some(events_val) = attributes.get(FrameworkAttributes::LOGFIRE_EVENTS)
            && let Some((input, output)) = self.extract_logfire_events(events_val)
        {
            return (input, output);
        }

        // MLFlow
        if let Some(input) = attributes.get(FrameworkAttributes::MLFLOW_SPAN_INPUTS) {
            let output = attributes.get(FrameworkAttributes::MLFLOW_SPAN_OUTPUTS);
            return (Some(input.clone()), output.cloned());
        }

        // SmolAgents
        if let Some(input) = attributes.get(FrameworkAttributes::INPUT_VALUE) {
            let output = attributes.get(FrameworkAttributes::OUTPUT_VALUE);
            return (Some(input.clone()), output.cloned());
        }

        // Pydantic
        if let Some(input) = attributes.get(FrameworkAttributes::INPUT) {
            let output = attributes.get(FrameworkAttributes::OUTPUT);
            return (Some(input.clone()), output.cloned());
        }

        // Pydantic-AI tools
        if let Some(input) = attributes.get(FrameworkAttributes::TOOL_ARGUMENTS) {
            let output = attributes.get(FrameworkAttributes::TOOL_RESPONSE);
            return (Some(input.clone()), output.cloned());
        }

        // OpenInference nested attributes (llm.input_messages.* and llm.output_messages.*)
        let (input, output) = self.extract_openinference_nested(attributes);
        if input.is_some() || output.is_some() {
            return (input, output);
        }

        (None, None)
    }

    /// Check if an attribute key is an input/output related attribute that should be removed
    pub fn is_input_output_attribute(&self, key: &str) -> bool {
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

    fn extract_vercel_ai_sdk(
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
    fn extract_traceloop_nested(
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
            Some(convert_key_path_to_nested_object(
                &input_attrs,
                "gen_ai.prompt",
            ))
        } else {
            None
        };

        let output = if !output_attrs.is_empty() {
            Some(convert_key_path_to_nested_object(
                &output_attrs,
                "gen_ai.completion",
            ))
        } else {
            None
        };

        (input, output)
    }

    /// Extract OpenInference nested attributes (llm.input_messages.* -> llm.output_messages.*)
    fn extract_openinference_nested(
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
            Some(convert_key_path_to_nested_object(
                &input_attrs,
                "llm.input_messages",
            ))
        } else {
            None
        };

        let output = if !output_attrs.is_empty() {
            Some(convert_key_path_to_nested_object(
                &output_attrs,
                "llm.output_messages",
            ))
        } else {
            None
        };

        (input, output)
    }
}

/// Converts nested key paths (e.g., "gen_ai.prompt.0.role") to nested objects/arrays
/// This is critical for handling TraceLoop and OpenInference attributes
fn convert_key_path_to_nested_object(
    input: &HashMap<String, json::Value>,
    prefix: &str,
) -> json::Value {
    // Check if the prefix key exists directly
    if let Some(value) = input.get(prefix) {
        return value.clone();
    }

    // Collect all keys with this prefix
    let prefix_dot = format!("{}.", prefix);
    let keys: Vec<String> = input
        .keys()
        .filter(|k| k.starts_with(&prefix_dot))
        .map(|k| k.strip_prefix(&prefix_dot).unwrap().to_string())
        .collect();

    if keys.is_empty() {
        return json::Value::Null;
    }

    // Check if we should use an array (keys start with digits like "0.role", "1.content")
    let use_array = keys.iter().any(|k| {
        k.split('.')
            .next()
            .and_then(|part| part.parse::<usize>().ok())
            .is_some()
    });

    if use_array {
        build_array_from_keys(&keys, input, prefix)
    } else {
        build_object_from_keys(&keys, input, prefix)
    }
}

fn build_array_from_keys(
    keys: &[String],
    input: &HashMap<String, json::Value>,
    prefix: &str,
) -> json::Value {
    let mut max_index = 0;

    // Find max index
    for key in keys {
        if let Some(first_part) = key.split('.').next()
            && let Ok(index) = first_part.parse::<usize>()
        {
            max_index = max_index.max(index);
        }
    }

    // Initialize array with empty objects
    let mut array: Vec<json::Value> = Vec::new();
    for _ in 0..=max_index {
        array.push(json::json!({}));
    }

    // Populate array
    for key in keys {
        let parts: Vec<&str> = key.split('.').collect();
        if let Ok(index) = parts[0].parse::<usize>() {
            if index >= array.len() {
                continue;
            }

            let full_key = format!("{}.{}", prefix, key);
            if let Some(value) = input.get(&full_key) {
                if parts.len() == 2 {
                    // Simple case: 0.field -> array[0].field
                    if let json::Value::Object(ref mut obj) = array[index] {
                        obj.insert(parts[1].to_string(), value.clone());
                    }
                } else {
                    // Nested case: 0.message.content -> array[0].message.content
                    set_nested_value(&mut array[index], &parts[1..], value.clone());
                }
            }
        }
    }

    json::Value::Array(array)
}

fn build_object_from_keys(
    keys: &[String],
    input: &HashMap<String, json::Value>,
    prefix: &str,
) -> json::Value {
    let mut result = json::json!({});

    for key in keys {
        let full_key = format!("{}.{}", prefix, key);
        if let Some(value) = input.get(&full_key) {
            let parts: Vec<&str> = key.split('.').collect();
            if parts.len() == 1 {
                if let json::Value::Object(ref mut obj) = result {
                    obj.insert(key.clone(), value.clone());
                }
            } else {
                set_nested_value(&mut result, &parts, value.clone());
            }
        }
    }

    result
}

fn set_nested_value(target: &mut json::Value, path: &[&str], value: json::Value) {
    if path.is_empty() {
        return;
    }

    if path.len() == 1 {
        if let json::Value::Object(obj) = target {
            obj.insert(path[0].to_string(), value);
        }
        return;
    }

    if let json::Value::Object(obj) = target {
        let key = path[0];
        let next_key = path.get(1).unwrap_or(&"");

        // Check if next level should be array or object
        let next_is_array = next_key.parse::<usize>().is_ok();

        let nested = obj.entry(key.to_string()).or_insert_with(|| {
            if next_is_array {
                json::json!([])
            } else {
                json::json!({})
            }
        });

        set_nested_value(nested, &path[1..], value);
    } else if let json::Value::Array(arr) = target
        && let Ok(index) = path[0].parse::<usize>()
    {
        while arr.len() <= index {
            arr.push(json::json!({}));
        }
        if index < arr.len() {
            set_nested_value(&mut arr[index], &path[1..], value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_input_output_attribute() {
        let extractor = InputOutputExtractor;

        assert!(extractor.is_input_output_attribute("gen_ai.input.messages"));
        assert!(extractor.is_input_output_attribute("gen_ai.prompt.0.role"));
        assert!(extractor.is_input_output_attribute("llm.input_messages.0.content"));
        assert!(extractor.is_input_output_attribute("ai.prompt.messages"));
        assert!(!extractor.is_input_output_attribute("user.id"));
        assert!(!extractor.is_input_output_attribute("gen_ai.request.model"));
    }

    #[test]
    fn test_extract_traceloop_nested() {
        let extractor = InputOutputExtractor;
        let mut attrs = HashMap::new();
        attrs.insert("gen_ai.prompt.0.role".to_string(), json::json!("user"));
        attrs.insert("gen_ai.prompt.0.content".to_string(), json::json!("Hello"));
        attrs.insert(
            "gen_ai.completion.0.role".to_string(),
            json::json!("assistant"),
        );
        attrs.insert("gen_ai.completion.0.content".to_string(), json::json!("Hi"));

        let (input, output) = extractor.extract_traceloop_nested(&attrs);
        assert!(input.is_some());
        assert!(output.is_some());

        let input_arr = input.unwrap();
        assert!(input_arr.is_array());
        assert_eq!(input_arr[0]["role"], "user");
        assert_eq!(input_arr[0]["content"], "Hello");
    }

    #[test]
    fn test_extract_openinference_nested() {
        let extractor = InputOutputExtractor;
        let mut attrs = HashMap::new();
        attrs.insert("llm.input_messages.0.role".to_string(), json::json!("user"));
        attrs.insert(
            "llm.input_messages.0.content".to_string(),
            json::json!("Test"),
        );

        let (input, _) = extractor.extract_openinference_nested(&attrs);
        assert!(input.is_some());
        let input_arr = input.unwrap();
        assert!(input_arr.is_array());
        assert_eq!(input_arr[0]["role"], "user");
        assert_eq!(input_arr[0]["content"], "Test");
    }

    #[test]
    fn test_convert_key_path_simple_object() {
        let mut input = HashMap::new();
        input.insert("test.name".to_string(), json::json!("Alice"));
        input.insert("test.age".to_string(), json::json!(30));

        let result = convert_key_path_to_nested_object(&input, "test");
        assert_eq!(result["name"], "Alice");
        assert_eq!(result["age"], 30);
    }

    #[test]
    fn test_convert_key_path_array() {
        let mut input = HashMap::new();
        input.insert("messages.0.role".to_string(), json::json!("user"));
        input.insert("messages.0.content".to_string(), json::json!("Hello"));
        input.insert("messages.1.role".to_string(), json::json!("assistant"));
        input.insert("messages.1.content".to_string(), json::json!("Hi"));

        let result = convert_key_path_to_nested_object(&input, "messages");
        assert!(result.is_array());
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["role"], "user");
        assert_eq!(arr[0]["content"], "Hello");
        assert_eq!(arr[1]["role"], "assistant");
        assert_eq!(arr[1]["content"], "Hi");
    }

    #[test]
    fn test_convert_key_path_nested() {
        let mut input = HashMap::new();
        input.insert("obj.user.name".to_string(), json::json!("Bob"));
        input.insert("obj.user.age".to_string(), json::json!(25));

        let result = convert_key_path_to_nested_object(&input, "obj");
        assert_eq!(result["user"]["name"], "Bob");
        assert_eq!(result["user"]["age"], 25);
    }
}
