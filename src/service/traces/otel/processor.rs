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
        PromptExtractor, ScopeInfo, TimingExtractor, UsageExtractor, map_to_observation_type,
    },
};
use crate::common::meta::traces::Event;

pub struct OtelIngestionProcessor {
    model_extractor: ModelExtractor,
    input_output_extractor: InputOutputExtractor,
    parameters_extractor: ParametersExtractor,
    usage_extractor: UsageExtractor,
    metadata_extractor: MetadataExtractor,
    prompt_extractor: PromptExtractor,
    timing_extractor: TimingExtractor,
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
            input_output_extractor: InputOutputExtractor,
            parameters_extractor: ParametersExtractor,
            usage_extractor: UsageExtractor,
            metadata_extractor: MetadataExtractor,
            prompt_extractor: PromptExtractor,
            timing_extractor: TimingExtractor,
        }
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
        start_time_iso: Option<&str>,
    ) {
        // 1. Extract and add observation type
        let scope_info = scope_name.map(|name| ScopeInfo {
            name: Some(name.to_string()),
        });
        let obs_type =
            map_to_observation_type(span_attributes, resource_attributes, scope_info.as_ref());

        // 2. Extract model name
        let model_name = self.model_extractor.extract(span_attributes);

        // 3. Extract input and output (this will identify which attributes to remove)
        let (input, output) =
            self.input_output_extractor
                .extract(events, span_attributes, scope_name.unwrap_or(""));

        // 4. Extract model parameters
        let model_params = self
            .parameters_extractor
            .extract(span_attributes, scope_name.unwrap_or(""));

        // 5. Extract usage details
        let usage = self
            .usage_extractor
            .extract_usage(span_attributes, scope_name.unwrap_or(""));

        // 6. Extract cost details
        let cost = self.usage_extractor.extract_cost(span_attributes);

        // 7. Extract user and session
        let user_id = self.metadata_extractor.extract_user_id(span_attributes);
        let session_id = self.metadata_extractor.extract_session_id(span_attributes);

        // 8. Extract environment
        let environment = self
            .metadata_extractor
            .extract_environment(span_attributes, resource_attributes);

        // 9. Extract tags
        let tags = self.metadata_extractor.extract_tags(span_attributes);

        // 10. Extract prompt information
        let prompt_name = self.prompt_extractor.extract_name(span_attributes);
        let prompt_version = self.prompt_extractor.extract_version(span_attributes);

        // 11. Extract completion start time (time to first token)
        let completion_start_time = self
            .timing_extractor
            .extract_completion_start_time(span_attributes, start_time_iso);

        // Now remove all input/output related attributes
        span_attributes
            .retain(|key, _| !self.input_output_extractor.is_input_output_attribute(key));

        // Add enriched fields
        span_attributes.insert(
            O2Attributes::OBSERVATION_TYPE.to_string(),
            json::json!(obs_type.as_str()),
        );

        if let Some(model) = model_name {
            span_attributes.insert(O2Attributes::MODEL_NAME.to_string(), json::json!(model));
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

        span_attributes.insert(
            O2Attributes::ENVIRONMENT.to_string(),
            json::json!(environment),
        );

        if !tags.is_empty() {
            span_attributes.insert(O2Attributes::TAGS.to_string(), json::json!(tags));
        }

        if let Some(pname) = prompt_name {
            span_attributes.insert(O2Attributes::PROMPT_NAME.to_string(), json::json!(pname));
        }

        if let Some(pversion) = prompt_version {
            span_attributes.insert(
                O2Attributes::PROMPT_VERSION.to_string(),
                json::json!(pversion),
            );
        }

        if let Some(completion_time) = completion_start_time {
            span_attributes.insert(
                O2Attributes::COMPLETION_START_TIME.to_string(),
                json::json!(completion_time),
            );
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

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events, None);

        // Input/output attributes should be removed
        assert!(!span_attrs.contains_key("gen_ai.input.messages"));
        assert!(!span_attrs.contains_key("gen_ai.output.messages"));

        // Enriched fields should be added with llm_ prefix
        assert!(span_attrs.contains_key(O2Attributes::INPUT));
        assert!(span_attrs.contains_key(O2Attributes::OUTPUT));
        assert!(span_attrs.contains_key(O2Attributes::OBSERVATION_TYPE));
        assert!(span_attrs.contains_key(O2Attributes::MODEL_NAME));
        assert!(span_attrs.contains_key(O2Attributes::ENVIRONMENT));

        // Other attributes should remain
        assert!(span_attrs.contains_key("user.id"));
        assert!(span_attrs.contains_key("gen_ai.request.model"));
        assert!(span_attrs.contains_key("gen_ai.operation.name"));
    }
}
