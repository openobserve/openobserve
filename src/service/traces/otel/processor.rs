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

use super::{
    attributes::O2Attributes,
    extractors::{
        InputOutputExtractor, MetadataExtractor, ModelExtractor, ParametersExtractor,
        PromptExtractor, ProviderExtractor, ScopeInfo, ServiceNameExtractor, ToolExtractor,
        UsageExtractor, map_to_observation_type,
    },
    pricing,
};
use crate::common::meta::traces::Event;

pub struct OtelIngestionProcessor {
    model_extractor: ModelExtractor,
    provider_extractor: ProviderExtractor,
    input_output_extractor: InputOutputExtractor,
    parameters_extractor: ParametersExtractor,
    usage_extractor: UsageExtractor,
    metadata_extractor: MetadataExtractor,
    prompt_extractor: PromptExtractor,
    tool_extractor: ToolExtractor,
    service_name_extractor: ServiceNameExtractor,
}

impl Default for OtelIngestionProcessor {
    fn default() -> Self {
        Self::new()
    }
}

impl OtelIngestionProcessor {
    pub fn new() -> Self {
        Self {
            model_extractor: ModelExtractor,
            provider_extractor: ProviderExtractor,
            input_output_extractor: InputOutputExtractor,
            parameters_extractor: ParametersExtractor,
            usage_extractor: UsageExtractor,
            metadata_extractor: MetadataExtractor,
            prompt_extractor: PromptExtractor,
            tool_extractor: ToolExtractor,
            service_name_extractor: ServiceNameExtractor,
        }
    }

    /// Extract service name from span attributes as a fallback
    /// Returns the extracted service name or None if no valid source is found
    pub fn extract_service_name_from_span(
        &self,
        span_attributes: &HashMap<String, json::Value>,
    ) -> Option<String> {
        self.service_name_extractor
            .extract_from_span_attributes(span_attributes)
    }

    /// Process span attributes and enrich them with OpenObserve-specific fields
    /// This modifies span_attributes in-place, removing processed attributes(only input/output
    /// related attributes) and adding enriched fields
    pub fn process_span(
        &self,
        span_attributes: &mut HashMap<String, json::Value>,
        resource_attributes: &HashMap<String, json::Value>,
        scope_name: Option<&str>,
        events: &[Event],
    ) {
        // Extract and add observation type
        let scope_info = scope_name.map(|name| ScopeInfo {
            name: Some(name.to_string()),
        });
        let obs_type =
            map_to_observation_type(span_attributes, resource_attributes, scope_info.as_ref());

        // Extract model name
        let model_name = self.model_extractor.extract(span_attributes);

        // Extract provider name
        let provider_name = self.provider_extractor.extract(span_attributes);

        // Extract input and output (this will identify which attributes to remove)
        let (input, output) =
            self.input_output_extractor
                .extract(events, span_attributes, scope_name.unwrap_or(""));

        // Extract model parameters
        let model_params = self
            .parameters_extractor
            .extract(span_attributes, scope_name.unwrap_or(""));

        // Extract usage details
        let mut usage = self
            .usage_extractor
            .extract_usage(span_attributes, scope_name.unwrap_or(""));

        // Extract cost details
        let mut cost = self.usage_extractor.extract_cost(span_attributes);

        // Extract user and session
        let user_id = self.metadata_extractor.extract_user_id(span_attributes);
        let session_id = self.metadata_extractor.extract_session_id(span_attributes);

        // Extract prompt information
        let prompt_name = self.prompt_extractor.extract_name(span_attributes);

        // Extract tool information
        let tool_name = self.tool_extractor.extract_tool_name(span_attributes);
        let tool_call_id = self.tool_extractor.extract_tool_call_id(span_attributes);
        let tool_call_arguments = self
            .tool_extractor
            .extract_tool_call_arguments(span_attributes);
        let tool_call_result = self
            .tool_extractor
            .extract_tool_call_result(span_attributes);

        // Now remove all input/output related attributes
        span_attributes
            .retain(|key, _| !self.input_output_extractor.is_input_output_attribute(key));

        // need to guarantee have the field USAGE_DETAILS and COST_DETAILS
        if input.is_some() || output.is_some() {
            if !usage.contains_key("total") {
                let input = usage.get("input").cloned().unwrap_or_default();
                let output = usage.get("output").cloned().unwrap_or_default();
                let total = input + output;
                usage.insert("total".to_string(), total);
            }

            // Calculate cost from tokens if cost is missing but we have model and usage
            if let Some(ref model_name) = model_name
                && cost.is_empty()
            {
                let input_tokens = usage.get("input").cloned().unwrap_or_default();
                let output_tokens = usage.get("output").cloned().unwrap_or_default();

                if (input_tokens > 0 || output_tokens > 0)
                    && let Some((input_cost, output_cost, total_cost)) =
                        pricing::calculate_cost(model_name, input_tokens, output_tokens)
                {
                    cost.insert("input".to_string(), input_cost);
                    cost.insert("output".to_string(), output_cost);
                    cost.insert("total".to_string(), total_cost);
                }
            } else if !cost.contains_key("total") {
                let input = cost.get("input").cloned().unwrap_or_default();
                let output = cost.get("output").cloned().unwrap_or_default();
                let total = input + output;
                cost.insert("total".to_string(), total);
            }
        }

        // Add enriched fields
        span_attributes.insert(
            O2Attributes::OBSERVATION_TYPE.to_string(),
            json::json!(obs_type.as_str()),
        );

        if let Some(model) = model_name {
            span_attributes.insert(O2Attributes::MODEL_NAME.to_string(), json::json!(model));
        }

        if let Some(provider) = provider_name {
            span_attributes.insert(
                O2Attributes::PROVIDER_NAME.to_string(),
                json::json!(provider),
            );
        }

        if let Some(input_val) = input {
            span_attributes.insert(O2Attributes::INPUT.to_string(), input_val);
        }

        if let Some(output_val) = output {
            span_attributes.insert(O2Attributes::OUTPUT.to_string(), output_val);
        }

        if !model_params.is_empty() {
            span_attributes.insert(
                O2Attributes::MODEL_PARAMETERS.to_string(),
                json::json!(model_params),
            );
        }

        if !usage.is_empty() {
            span_attributes.insert(O2Attributes::USAGE_DETAILS.to_string(), json::json!(usage));
        }

        if !cost.is_empty() {
            span_attributes.insert(O2Attributes::COST_DETAILS.to_string(), json::json!(cost));
        }

        if let Some(uid) = user_id {
            span_attributes.insert(O2Attributes::USER_ID.to_string(), json::json!(uid));
        }

        if let Some(sid) = session_id {
            span_attributes.insert(O2Attributes::SESSION_ID.to_string(), json::json!(sid));
        }

        if let Some(pname) = prompt_name {
            span_attributes.insert(O2Attributes::PROMPT_NAME.to_string(), json::json!(pname));
        }

        if let Some(tname) = tool_name {
            span_attributes.insert(O2Attributes::TOOL_NAME.to_string(), json::json!(tname));
        }

        if let Some(tcid) = tool_call_id {
            span_attributes.insert(O2Attributes::TOOL_CALL_ID.to_string(), json::json!(tcid));
        }

        if let Some(targs) = tool_call_arguments {
            span_attributes.insert(O2Attributes::TOOL_CALL_ARGUMENTS.to_string(), targs);
        }

        if let Some(tresult) = tool_call_result {
            span_attributes.insert(O2Attributes::TOOL_CALL_RESULT.to_string(), tresult);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Input/output attributes should be removed
        assert!(!span_attrs.contains_key("gen_ai.input.messages"));
        assert!(!span_attrs.contains_key("gen_ai.output.messages"));

        // Enriched fields should be added with llm_ prefix
        assert!(span_attrs.contains_key(O2Attributes::INPUT));
        assert!(span_attrs.contains_key(O2Attributes::OUTPUT));
        assert!(span_attrs.contains_key(O2Attributes::OBSERVATION_TYPE));
        assert!(span_attrs.contains_key(O2Attributes::MODEL_NAME));

        // Other attributes should remain
        assert!(span_attrs.contains_key("user.id"));
        assert!(span_attrs.contains_key("gen_ai.request.model"));
        assert!(span_attrs.contains_key("gen_ai.operation.name"));
    }

    #[test]
    fn test_process_span_extracts_provider_name() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert("gen_ai.request.model".to_string(), json::json!("gpt-4"));
        span_attrs.insert("gen_ai.provider.name".to_string(), json::json!("openai"));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Provider name should be extracted and added
        assert!(span_attrs.contains_key(O2Attributes::PROVIDER_NAME));
        assert_eq!(
            span_attrs.get(O2Attributes::PROVIDER_NAME).unwrap(),
            &json::json!("openai")
        );

        // Original provider attribute should remain
        assert!(span_attrs.contains_key("gen_ai.provider.name"));
    }

    #[test]
    fn test_process_span_extracts_provider_from_system() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert("gen_ai.request.model".to_string(), json::json!("claude-3"));
        span_attrs.insert("gen_ai.system".to_string(), json::json!("anthropic"));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Provider name should be extracted from gen_ai.system
        assert!(span_attrs.contains_key(O2Attributes::PROVIDER_NAME));
        assert_eq!(
            span_attrs.get(O2Attributes::PROVIDER_NAME).unwrap(),
            &json::json!("anthropic")
        );
    }

    #[test]
    fn test_process_span_extracts_provider_from_vercel_ai() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert("ai.model.id".to_string(), json::json!("gemini-pro"));
        span_attrs.insert("ai.model.provider".to_string(), json::json!("google"));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Provider name should be extracted from Vercel AI SDK attribute
        assert!(span_attrs.contains_key(O2Attributes::PROVIDER_NAME));
        assert_eq!(
            span_attrs.get(O2Attributes::PROVIDER_NAME).unwrap(),
            &json::json!("google")
        );
    }

    #[test]
    fn test_process_span_extracts_tool_fields() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("tool"));
        span_attrs.insert("gen_ai.tool.name".to_string(), json::json!("get_weather"));
        span_attrs.insert("gen_ai.tool.call.id".to_string(), json::json!("call_12345"));
        span_attrs.insert(
            "gen_ai.tool.call.arguments".to_string(),
            json::json!({"city": "San Francisco"}),
        );
        span_attrs.insert(
            "gen_ai.tool.call.result".to_string(),
            json::json!({"temperature": 72}),
        );

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Tool name should be extracted and added
        assert!(span_attrs.contains_key(O2Attributes::TOOL_NAME));
        assert_eq!(
            span_attrs.get(O2Attributes::TOOL_NAME).unwrap(),
            &json::json!("get_weather")
        );

        // Tool call ID should be extracted and added
        assert!(span_attrs.contains_key(O2Attributes::TOOL_CALL_ID));
        assert_eq!(
            span_attrs.get(O2Attributes::TOOL_CALL_ID).unwrap(),
            &json::json!("call_12345")
        );

        // Tool call arguments should be extracted and added
        assert!(span_attrs.contains_key(O2Attributes::TOOL_CALL_ARGUMENTS));
        assert_eq!(
            span_attrs.get(O2Attributes::TOOL_CALL_ARGUMENTS).unwrap(),
            &json::json!({"city": "San Francisco"})
        );

        // Tool call result should be extracted and added
        assert!(span_attrs.contains_key(O2Attributes::TOOL_CALL_RESULT));
        assert_eq!(
            span_attrs.get(O2Attributes::TOOL_CALL_RESULT).unwrap(),
            &json::json!({"temperature": 72})
        );

        // Original tool attributes should remain (except arguments and result which are
        // input/output)
        assert!(span_attrs.contains_key("gen_ai.tool.name"));
        assert!(span_attrs.contains_key("gen_ai.tool.call.id"));
    }

    #[test]
    fn test_process_span_extracts_langfuse_attributes() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("langfuse_observation_type".to_string(), json::json!("span"));
        span_attrs.insert(
            "langfuse_observation_input".to_string(),
            json::json!(r#"{"file_path": "/Users/test/file.md"}"#),
        );
        span_attrs.insert(
            "langfuse_observation_output".to_string(),
            json::json!("File content here..."),
        );
        span_attrs.insert(
            "langfuse_observation_metadata_tool_name".to_string(),
            json::json!("Read"),
        );
        span_attrs.insert(
            "langfuse_observation_metadata_tool_id".to_string(),
            json::json!("toolu_01T1Mfo98ePBYgoRXG3yPkWt"),
        );
        span_attrs.insert("operation_name".to_string(), json::json!("Tool: Read"));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Input/output should be extracted and added
        assert!(span_attrs.contains_key(O2Attributes::INPUT));
        assert_eq!(
            span_attrs.get(O2Attributes::INPUT).unwrap(),
            &json::json!(r#"{"file_path": "/Users/test/file.md"}"#)
        );

        assert!(span_attrs.contains_key(O2Attributes::OUTPUT));
        assert_eq!(
            span_attrs.get(O2Attributes::OUTPUT).unwrap(),
            &json::json!("File content here...")
        );

        // Tool name and ID should be extracted
        assert!(span_attrs.contains_key(O2Attributes::TOOL_NAME));
        assert_eq!(
            span_attrs.get(O2Attributes::TOOL_NAME).unwrap(),
            &json::json!("Read")
        );

        assert!(span_attrs.contains_key(O2Attributes::TOOL_CALL_ID));
        assert_eq!(
            span_attrs.get(O2Attributes::TOOL_CALL_ID).unwrap(),
            &json::json!("toolu_01T1Mfo98ePBYgoRXG3yPkWt")
        );

        // Original input/output attributes should be removed
        assert!(!span_attrs.contains_key("langfuse_observation_input"));
        assert!(!span_attrs.contains_key("langfuse_observation_output"));

        // Tool metadata and other attributes should remain
        assert!(span_attrs.contains_key("langfuse_observation_metadata_tool_name"));
        assert!(span_attrs.contains_key("langfuse_observation_metadata_tool_id"));
        assert!(span_attrs.contains_key("langfuse_observation_type"));
        assert!(span_attrs.contains_key("operation_name"));
    }

    #[test]
    fn test_process_span_calculates_cost_from_tokens() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert("gen_ai.request.model".to_string(), json::json!("gpt-4o"));
        span_attrs.insert(
            "gen_ai.input.messages".to_string(),
            json::json!("[{\"role\":\"user\"}]"),
        );
        span_attrs.insert(
            "gen_ai.output.messages".to_string(),
            json::json!("[{\"role\":\"assistant\"}]"),
        );
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(1000));
        span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(500));
        // No cost attributes provided

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Cost should be automatically calculated
        assert!(span_attrs.contains_key(O2Attributes::COST_DETAILS));
        let cost = span_attrs.get(O2Attributes::COST_DETAILS).unwrap();

        // gpt-4o: $2.50/1M input, $10.00/1M output
        // 1000 tokens input = 1000/1M * $2.50 = $0.0025
        // 500 tokens output = 500/1M * $10.00 = $0.005
        // Total = $0.0075
        assert_eq!(cost.get("input").and_then(|v| v.as_f64()), Some(0.0025));
        assert_eq!(cost.get("output").and_then(|v| v.as_f64()), Some(0.005));
        assert_eq!(cost.get("total").and_then(|v| v.as_f64()), Some(0.0075));
    }

    #[test]
    fn test_process_span_calculates_cost_for_claude_sonnet() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert(
            "gen_ai.request.model".to_string(),
            json::json!("claude-sonnet-4-5"),
        );
        span_attrs.insert(
            "gen_ai.input.messages".to_string(),
            json::json!("[{\"role\":\"user\"}]"),
        );
        span_attrs.insert(
            "gen_ai.output.messages".to_string(),
            json::json!("[{\"role\":\"assistant\"}]"),
        );
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(50000));
        span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(10000));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Cost should be calculated with default tier (< 200k tokens)
        assert!(span_attrs.contains_key(O2Attributes::COST_DETAILS));
        let cost = span_attrs.get(O2Attributes::COST_DETAILS).unwrap();

        // claude-sonnet-4-5 default tier: $3.00/1M input, $15.00/1M output
        // 50000 tokens input = 50000/1M * $3.00 = $0.15
        // 10000 tokens output = 10000/1M * $15.00 = $0.15
        // Total = $0.30
        let input_cost = cost.get("input").and_then(|v| v.as_f64()).unwrap();
        let output_cost = cost.get("output").and_then(|v| v.as_f64()).unwrap();
        let total_cost = cost.get("total").and_then(|v| v.as_f64()).unwrap();
        assert!((input_cost - 0.15).abs() < 1e-10);
        assert!((output_cost - 0.15).abs() < 1e-10);
        assert!((total_cost - 0.30).abs() < 1e-10);
    }

    #[test]
    fn test_process_span_calculates_cost_for_claude_sonnet_extended_context() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert(
            "gen_ai.request.model".to_string(),
            json::json!("claude-sonnet-4-5"),
        );
        span_attrs.insert(
            "gen_ai.input.messages".to_string(),
            json::json!("[{\"role\":\"user\"}]"),
        );
        span_attrs.insert(
            "gen_ai.output.messages".to_string(),
            json::json!("[{\"role\":\"assistant\"}]"),
        );
        // Extended context: > 200k tokens
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(250000));
        span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(10000));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Cost should be calculated with extended context tier
        assert!(span_attrs.contains_key(O2Attributes::COST_DETAILS));
        let cost = span_attrs.get(O2Attributes::COST_DETAILS).unwrap();

        // claude-sonnet-4-5 extended tier: $6.00/1M input, $22.50/1M output
        // 250000 tokens input = 250000/1M * $6.00 = $1.5
        // 10000 tokens output = 10000/1M * $22.50 = $0.225
        // Total = $1.725
        let input_cost = cost.get("input").and_then(|v| v.as_f64()).unwrap();
        let output_cost = cost.get("output").and_then(|v| v.as_f64()).unwrap();
        let total_cost = cost.get("total").and_then(|v| v.as_f64()).unwrap();
        assert!((input_cost - 1.5).abs() < 1e-10);
        assert!((output_cost - 0.225).abs() < 1e-10);
        assert!((total_cost - 1.725).abs() < 1e-10);
    }

    #[test]
    fn test_process_span_preserves_existing_cost() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert("gen_ai.request.model".to_string(), json::json!("gpt-4o"));
        span_attrs.insert(
            "gen_ai.input.messages".to_string(),
            json::json!("[{\"role\":\"user\"}]"),
        );
        span_attrs.insert(
            "gen_ai.output.messages".to_string(),
            json::json!("[{\"role\":\"assistant\"}]"),
        );
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(1000));
        span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(500));
        // Cost already provided
        span_attrs.insert("gen_ai.usage.cost".to_string(), json::json!(0.999));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Existing cost should be preserved (not recalculated)
        assert!(span_attrs.contains_key(O2Attributes::COST_DETAILS));
        let cost = span_attrs.get(O2Attributes::COST_DETAILS).unwrap();
        assert_eq!(cost.get("total").and_then(|v| v.as_f64()), Some(0.999));
    }

    #[test]
    fn test_process_span_no_cost_calculation_for_unknown_model() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert(
            "gen_ai.request.model".to_string(),
            json::json!("unknown-model-xyz-2024"),
        );
        span_attrs.insert(
            "gen_ai.input.messages".to_string(),
            json::json!("[{\"role\":\"user\"}]"),
        );
        span_attrs.insert(
            "gen_ai.output.messages".to_string(),
            json::json!("[{\"role\":\"assistant\"}]"),
        );
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(1000));
        span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(500));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Cost should not be calculated for unknown model
        // Cost details should be empty
        if span_attrs.contains_key(O2Attributes::COST_DETAILS) {
            let cost = span_attrs.get(O2Attributes::COST_DETAILS).unwrap();
            // Should be an empty object
            assert!(cost.as_object().unwrap().is_empty());
        }
    }
}
