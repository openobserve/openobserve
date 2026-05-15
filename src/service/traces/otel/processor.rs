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

use config::utils::{json, time::parse_timestamp_micro_from_value};

use super::{
    attributes::{
        GenAiAttributes, GenAiExtensions, LangfuseAttributes, O2Attributes, OtelAttributes,
    },
    extractors::{
        Evaluation, EvaluationExtractor, InputOutputExtractor, MetadataExtractor, ModelExtractor,
        ParametersExtractor, PromptExtractor, ProviderExtractor, ScopeInfo, ServiceNameExtractor,
        ToolExtractor, UsageExtractor, is_generation_or_embedding, map_to_gen_ai_operation_name,
    },
    pricing,
};
use crate::{common::meta::traces::Event, service::db::model_pricing::CachedModelPricing};

/// Results of extracting span enrichment data from raw attributes.
/// Captures all information needed before I/O attribute cleanup.
struct SpanExtractions {
    op_name: &'static str,
    model_name: Option<String>,
    provider_name: Option<String>,
    input: Option<json::Value>,
    output: Option<json::Value>,
    model_params: HashMap<String, String>,
    usage: HashMap<String, i64>,
    cost: HashMap<String, f64>,
    user_id: Option<String>,
    session_id: Option<String>,
    prompt_name: Option<String>,
    completion_start_time: Option<i64>,
    tool_name: Option<String>,
    tool_call_id: Option<String>,
    tool_call_arguments: Option<json::Value>,
    tool_call_result: Option<json::Value>,
    evaluation: Evaluation,
}

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
    evaluation_extractor: EvaluationExtractor,
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
            evaluation_extractor: EvaluationExtractor,
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

    /// Process span with optional user-defined model pricing entries.
    /// If matching pricing is found in `org_pricing_entries`, it takes priority over built-in
    /// pricing. `span_start_nanos` is the span's `start_time_unix_nano` from the OTLP payload;
    /// it is used to select the most-recently-applicable pricing definition via `valid_from`.
    /// In production always call `get_org_pricing_entries` to populate this slice.
    pub fn process_span_with_pricing(
        &self,
        span_attributes: &mut HashMap<String, json::Value>,
        resource_attributes: &HashMap<String, json::Value>,
        scope_name: Option<&str>,
        events: &[Event],
        org_pricing_entries: &[CachedModelPricing],
        span_start_nanos: u64,
    ) {
        // Phase 1: Extract all raw data from span attributes.
        let extracted = self.extract_all(span_attributes, resource_attributes, scope_name, events);

        // Remove input/output attributes now that extraction is complete.
        span_attributes
            .retain(|key, _| !self.input_output_extractor.is_input_output_attribute(key));

        // Phase 2: Compute derived values — token counts, cost estimates, defaults.
        let (usage, cost) =
            self.compute_usage_and_cost(&extracted, org_pricing_entries, span_start_nanos);

        // Phase 3: Write enriched attributes back to the span.
        self.emit_enriched_attributes(span_attributes, &extracted, &usage, &cost);
    }

    // ── Phase 1: Extract raw data ──────────────────────────────────────────

    fn extract_all(
        &self,
        span_attributes: &HashMap<String, json::Value>,
        resource_attributes: &HashMap<String, json::Value>,
        scope_name: Option<&str>,
        events: &[Event],
    ) -> SpanExtractions {
        let scope_info = scope_name.map(|name| ScopeInfo {
            name: Some(name.to_string()),
        });
        let scope_name_default = scope_name.unwrap_or("");

        let op_name =
            map_to_gen_ai_operation_name(span_attributes, resource_attributes, scope_info.as_ref());
        let model_name = self.model_extractor.extract(span_attributes);
        let provider_name = self.provider_extractor.extract(span_attributes);
        let (input, output) =
            self.input_output_extractor
                .extract(events, span_attributes, scope_name_default);
        let model_params = self
            .parameters_extractor
            .extract(span_attributes, scope_name_default);
        let usage = self
            .usage_extractor
            .extract_usage(span_attributes, scope_name_default);
        let cost = self.usage_extractor.extract_cost(span_attributes);
        let user_id = self
            .metadata_extractor
            .extract_user_id(span_attributes, resource_attributes);
        let session_id = self
            .metadata_extractor
            .extract_session_id(span_attributes, resource_attributes);
        let prompt_name = self.prompt_extractor.extract_name(span_attributes);
        let completion_start_time = span_attributes
            .get(LangfuseAttributes::COMPLETION_START_TIME)
            .and_then(|v| parse_timestamp_micro_from_value(v).ok().map(|(ts, _)| ts));
        let tool_name = self.tool_extractor.extract_tool_name(span_attributes);
        let tool_call_id = self.tool_extractor.extract_tool_call_id(span_attributes);
        let tool_call_arguments = self
            .tool_extractor
            .extract_tool_call_arguments(span_attributes);
        let tool_call_result = self
            .tool_extractor
            .extract_tool_call_result(span_attributes);
        let evaluation = self.evaluation_extractor.extract(span_attributes);

        SpanExtractions {
            op_name,
            model_name,
            provider_name,
            input,
            output,
            model_params,
            usage,
            cost,
            user_id,
            session_id,
            prompt_name,
            completion_start_time,
            tool_name,
            tool_call_id,
            tool_call_arguments,
            tool_call_result,
            evaluation,
        }
    }

    // ── Phase 2: Compute usage, cost, and defaults ─────────────────────────

    fn compute_usage_and_cost(
        &self,
        extracted: &SpanExtractions,
        org_pricing_entries: &[CachedModelPricing],
        span_start_nanos: u64,
    ) -> (HashMap<String, i64>, HashMap<String, f64>) {
        let mut usage = extracted.usage.clone();
        let mut cost = extracted.cost.clone();

        if extracted.input.is_some() || extracted.output.is_some() {
            let span_ts_micros = i64::try_from(span_start_nanos / 1_000).unwrap_or(i64::MAX);
            let matched_pricing = extracted.model_name.as_ref().and_then(|mn| {
                crate::service::db::model_pricing::find_pricing_sync_at(
                    org_pricing_entries,
                    mn,
                    Some(span_ts_micros),
                )
            });
            let tokenizer_key: &str = extracted.model_name.as_deref().unwrap_or("");

            if let Some(v) = &extracted.input
                && !usage.contains_key("input")
                && is_generation_or_embedding(extracted.op_name)
            {
                let prompt = v.to_string();
                let prompt_tokens = pricing::calculate_token_count(tokenizer_key, &prompt);
                usage.insert("input".to_string(), prompt_tokens);
            }
            if let Some(v) = &extracted.output
                && !usage.contains_key("output")
                && is_generation_or_embedding(extracted.op_name)
            {
                let output_text = v.to_string();
                let output_tokens = pricing::calculate_token_count(tokenizer_key, &output_text);
                usage.insert("output".to_string(), output_tokens);
            }

            if cost.is_empty() && is_generation_or_embedding(extracted.op_name) {
                if let Some(pricing_def) = matched_pricing {
                    let result = crate::service::db::model_pricing::calculate_cost_from_definition(
                        &pricing_def,
                        &usage,
                    );
                    if !result.cost.is_empty() {
                        log::debug!(
                            "[model_pricing] model='{}' pattern='{}' tier='{}' total_cost={:.8}",
                            extracted.model_name.as_deref().unwrap_or(""),
                            pricing_def.match_pattern,
                            result.tier_name,
                            result.cost.get("total").copied().unwrap_or(0.0),
                        );
                        cost = result.cost;
                    }
                } else if let Some(ref model_name) = extracted.model_name {
                    let input_tokens = usage.get("input").cloned().unwrap_or_default();
                    let output_tokens = usage.get("output").cloned().unwrap_or_default();
                    if let Some((input_cost, output_cost, total_cost)) =
                        pricing::calculate_cost(model_name, input_tokens, output_tokens)
                    {
                        cost.insert("input".to_string(), input_cost);
                        cost.insert("output".to_string(), output_cost);
                        cost.insert("total".to_string(), total_cost);
                    }
                }
            }
        }

        // Ensure usage defaults (input, output, total).
        if !usage.contains_key("input") {
            usage.insert("input".to_string(), 0);
        }
        if !usage.contains_key("output") {
            usage.insert("output".to_string(), 0);
        }
        if !usage.contains_key("total") {
            let input = usage.get("input").copied().unwrap_or(0);
            let output = usage.get("output").copied().unwrap_or(0);
            usage.insert("total".to_string(), input + output);
        }

        // Ensure cost total (sum all components, not just input+output).
        if !cost.contains_key("total") {
            let total: f64 = cost.values().sum();
            cost.insert("total".to_string(), total);
        }

        (usage, cost)
    }

    // ── Phase 3: Emit enriched attributes ──────────────────────────────────

    fn emit_enriched_attributes(
        &self,
        span_attributes: &mut HashMap<String, json::Value>,
        extracted: &SpanExtractions,
        usage: &HashMap<String, i64>,
        cost: &HashMap<String, f64>,
    ) {
        span_attributes.insert(
            GenAiAttributes::OPERATION_NAME.to_string(),
            json::json!(extracted.op_name),
        );

        if let Some(ref model) = extracted.model_name {
            span_attributes.insert(
                GenAiAttributes::RESPONSE_MODEL.to_string(),
                json::json!(model),
            );
        }

        if let Some(ref provider) = extracted.provider_name {
            span_attributes.insert(
                GenAiAttributes::PROVIDER_NAME.to_string(),
                json::json!(provider),
            );
        }

        if let Some(ref input_val) = extracted.input {
            span_attributes.insert(GenAiAttributes::INPUT_MESSAGES.to_string(), input_val.clone());
        }

        if let Some(ref output_val) = extracted.output {
            span_attributes.insert(GenAiAttributes::OUTPUT_MESSAGES.to_string(), output_val.clone());
        }

        // Model parameters as individual gen_ai.request.* scalars.
        for (key, value) in &extracted.model_params {
            if key == "model" {
                continue;
            }
            span_attributes.insert(format!("gen_ai.request.{key}"), json::json!(value));
        }

        // Token usage as individual scalar attributes.
        if let Some(&v) = usage.get("input") {
            span_attributes.insert(
                GenAiAttributes::USAGE_INPUT_TOKENS.to_string(),
                json::json!(v),
            );
        }
        if let Some(&v) = usage.get("output") {
            span_attributes.insert(
                GenAiAttributes::USAGE_OUTPUT_TOKENS.to_string(),
                json::json!(v),
            );
        }
        if let Some(&v) = usage.get("total") {
            span_attributes.insert(
                GenAiAttributes::USAGE_TOTAL_TOKENS.to_string(),
                json::json!(v),
            );
        }

        // Cost: per-direction breakdown + total.
        if let Some(&v) = cost.get("input") {
            span_attributes.insert(
                GenAiExtensions::USAGE_COST_INPUT.to_string(),
                json::json!(v),
            );
        }
        if let Some(&v) = cost.get("output") {
            span_attributes.insert(
                GenAiExtensions::USAGE_COST_OUTPUT.to_string(),
                json::json!(v),
            );
        }
        if let Some(&v) = cost.get("total") {
            span_attributes.insert(GenAiAttributes::USAGE_COST.to_string(), json::json!(v));
        }

        if let Some(ref uid) = extracted.user_id {
            span_attributes.insert(OtelAttributes::USER_ID.to_string(), json::json!(uid));
        }

        if let Some(ref sid) = extracted.session_id {
            span_attributes.insert(
                GenAiAttributes::CONVERSATION_ID.to_string(),
                json::json!(sid),
            );
        }

        if let Some(ref pname) = extracted.prompt_name {
            span_attributes.insert(GenAiAttributes::PROMPT_NAME.to_string(), json::json!(pname));
        }

        // TTFT: convert microseconds → Float64 seconds.
        if let Some(ct) = extracted.completion_start_time {
            let ttfc_seconds = ct as f64 / 1_000_000.0;
            span_attributes.insert(
                GenAiAttributes::RESPONSE_TIME_TO_FIRST_CHUNK.to_string(),
                json::json!(ttfc_seconds),
            );
        }

        if let Some(ref tname) = extracted.tool_name {
            span_attributes.insert(GenAiAttributes::TOOL_NAME.to_string(), json::json!(tname));
        }

        if let Some(ref tcid) = extracted.tool_call_id {
            span_attributes.insert(GenAiAttributes::TOOL_CALL_ID.to_string(), json::json!(tcid));
        }

        if let Some(ref targs) = extracted.tool_call_arguments {
            span_attributes.insert(GenAiAttributes::TOOL_CALL_ARGUMENTS.to_string(), targs.clone());
        }

        if let Some(ref tresult) = extracted.tool_call_result {
            span_attributes.insert(GenAiAttributes::TOOL_CALL_RESULT.to_string(), tresult.clone());
        }

        // Evaluation scores and metadata.
        let evaluation = &extracted.evaluation;
        if evaluation.has_any() {
            if let Some(q) = evaluation.scores.quality_score {
                span_attributes
                    .insert(O2Attributes::EVALUATION_QUALITY.to_string(), json::json!(q));
            }
            if let Some(r) = evaluation.scores.relevance {
                span_attributes.insert(
                    O2Attributes::EVALUATION_RELEVANCE.to_string(),
                    json::json!(r),
                );
            }
            if let Some(c) = evaluation.scores.completeness {
                span_attributes.insert(
                    O2Attributes::EVALUATION_COMPLETENESS.to_string(),
                    json::json!(c),
                );
            }
            if let Some(t) = evaluation.scores.tool_effectiveness {
                span_attributes.insert(
                    O2Attributes::EVALUATION_TOOL_EFFECTIVENESS.to_string(),
                    json::json!(t),
                );
            }
            if let Some(g) = evaluation.scores.groundedness {
                span_attributes.insert(
                    O2Attributes::EVALUATION_GROUNDEDNESS.to_string(),
                    json::json!(g),
                );
            }
            if let Some(s) = evaluation.scores.safety {
                span_attributes.insert(O2Attributes::EVALUATION_SAFETY.to_string(), json::json!(s));
            }
            if let Some(d) = evaluation.scores.duration_ms {
                span_attributes.insert(
                    O2Attributes::EVALUATION_DURATION_MS.to_string(),
                    json::json!(d),
                );
            }
            if let Some(ref commentary) = evaluation.commentary {
                span_attributes.insert(
                    O2Attributes::EVALUATION_COMMENTARY.to_string(),
                    json::json!(commentary),
                );
            }
            if let Some(ref name) = evaluation.evaluator.name {
                span_attributes.insert(O2Attributes::EVALUATOR_NAME.to_string(), json::json!(name));
            }
            if let Some(ref version) = evaluation.evaluator.version {
                span_attributes.insert(
                    O2Attributes::EVALUATOR_VERSION.to_string(),
                    json::json!(version),
                );
            }
            span_attributes.insert(
                O2Attributes::EVALUATOR_TYPE.to_string(),
                json::json!(evaluation.evaluator.evaluator_type.as_str()),
            );
        }
    }

    /// Test-only convenience wrapper: calls `process_span_with_pricing` with no user pricing.
    /// Never call this from production code — user-defined pricing will be silently skipped.
    #[cfg(test)]
    pub fn process_span(
        &self,
        span_attributes: &mut HashMap<String, json::Value>,
        resource_attributes: &HashMap<String, json::Value>,
        scope_name: Option<&str>,
        events: &[Event],
    ) {
        self.process_span_with_pricing(
            span_attributes,
            resource_attributes,
            scope_name,
            events,
            &[],
            0,
        );
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

        // Enriched fields are emitted under canonical Gen-AI keys. The processor
        // re-inserts gen_ai.input.messages / gen_ai.output.messages with the
        // OO-condensed string form (overwriting the original structured value).
        assert!(span_attrs.contains_key(GenAiAttributes::INPUT_MESSAGES));
        assert!(span_attrs.contains_key(GenAiAttributes::OUTPUT_MESSAGES));
        assert!(span_attrs.contains_key(GenAiAttributes::OPERATION_NAME));
        assert!(span_attrs.contains_key(GenAiAttributes::RESPONSE_MODEL));

        // Other attributes should remain
        assert!(span_attrs.contains_key("user.id"));
        assert!(span_attrs.contains_key("gen_ai.request.model"));
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
        assert!(span_attrs.contains_key(GenAiAttributes::PROVIDER_NAME));
        assert_eq!(
            span_attrs.get(GenAiAttributes::PROVIDER_NAME).unwrap(),
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
        assert!(span_attrs.contains_key(GenAiAttributes::SYSTEM));
        assert_eq!(
            span_attrs.get(GenAiAttributes::SYSTEM).unwrap(),
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
        assert!(span_attrs.contains_key(GenAiAttributes::PROVIDER_NAME));
        assert_eq!(
            span_attrs.get(GenAiAttributes::PROVIDER_NAME).unwrap(),
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
        assert!(span_attrs.contains_key(GenAiAttributes::TOOL_NAME));
        assert_eq!(
            span_attrs.get(GenAiAttributes::TOOL_NAME).unwrap(),
            &json::json!("get_weather")
        );

        // Tool call ID should be extracted and added
        assert!(span_attrs.contains_key(GenAiAttributes::TOOL_CALL_ID));
        assert_eq!(
            span_attrs.get(GenAiAttributes::TOOL_CALL_ID).unwrap(),
            &json::json!("call_12345")
        );

        // Tool call arguments should be extracted and added
        assert!(span_attrs.contains_key(GenAiAttributes::TOOL_CALL_ARGUMENTS));
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::TOOL_CALL_ARGUMENTS)
                .unwrap(),
            &json::json!({"city": "San Francisco"})
        );

        // Tool call result should be extracted and added
        assert!(span_attrs.contains_key(GenAiAttributes::TOOL_CALL_RESULT));
        assert_eq!(
            span_attrs.get(GenAiAttributes::TOOL_CALL_RESULT).unwrap(),
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
        span_attrs.insert("langfuse.observation.type".to_string(), json::json!("span"));
        span_attrs.insert(
            "langfuse.observation.input".to_string(),
            json::json!(r#"{"file_path": "/Users/test/file.md"}"#),
        );
        span_attrs.insert(
            "langfuse.observation.output".to_string(),
            json::json!("File content here..."),
        );
        span_attrs.insert(
            "langfuse.observation.metadata.tool.name".to_string(),
            json::json!("Read"),
        );
        span_attrs.insert(
            "langfuse.observation.metadata.tool.id".to_string(),
            json::json!("toolu_01T1Mfo98ePBYgoRXG3yPkWt"),
        );
        span_attrs.insert("operation_name".to_string(), json::json!("Tool: Read"));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Input/output should be extracted and added under Gen-AI keys
        assert!(span_attrs.contains_key(GenAiAttributes::INPUT_MESSAGES));
        assert_eq!(
            span_attrs.get(GenAiAttributes::INPUT_MESSAGES).unwrap(),
            &json::json!(r#"{"file_path": "/Users/test/file.md"}"#)
        );

        assert!(span_attrs.contains_key(GenAiAttributes::OUTPUT_MESSAGES));
        assert_eq!(
            span_attrs.get(GenAiAttributes::OUTPUT_MESSAGES).unwrap(),
            &json::json!("File content here...")
        );

        // Tool name and ID should be extracted
        assert!(span_attrs.contains_key(GenAiAttributes::TOOL_NAME));
        assert_eq!(
            span_attrs.get(GenAiAttributes::TOOL_NAME).unwrap(),
            &json::json!("Read")
        );

        assert!(span_attrs.contains_key(GenAiAttributes::TOOL_CALL_ID));
        assert_eq!(
            span_attrs.get(GenAiAttributes::TOOL_CALL_ID).unwrap(),
            &json::json!("toolu_01T1Mfo98ePBYgoRXG3yPkWt")
        );

        // Original input/output attributes should be removed
        assert!(!span_attrs.contains_key("langfuse.observation.input"));
        assert!(!span_attrs.contains_key("langfuse.observation.output"));

        // Tool metadata and other attributes should remain
        assert!(span_attrs.contains_key("langfuse.observation.metadata.tool.name"));
        assert!(span_attrs.contains_key("langfuse.observation.metadata.tool.id"));
        assert!(span_attrs.contains_key("langfuse.observation.type"));
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

        // Cost is emitted as individual scalar attributes per Gen-AI conventions.
        // gpt-4o: $2.50/1M input, $10.00/1M output
        // 1000 tokens input = 1000/1M * $2.50 = $0.0025
        // 500 tokens output = 500/1M * $10.00 = $0.005
        // Total = $0.0075
        assert_eq!(
            span_attrs
                .get(GenAiExtensions::USAGE_COST_INPUT)
                .and_then(|v| v.as_f64()),
            Some(0.0025)
        );
        assert_eq!(
            span_attrs
                .get(GenAiExtensions::USAGE_COST_OUTPUT)
                .and_then(|v| v.as_f64()),
            Some(0.005)
        );
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::USAGE_COST)
                .and_then(|v| v.as_f64()),
            Some(0.0075)
        );
    }

    #[test]
    fn test_process_span_calculates_cost_for_claude_sonnet() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert(
            "gen_ai.request.model".to_string(),
            json::json!("claude-sonnet-4-6"),
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
        // claude-sonnet-4-6 default tier: $3.00/1M input, $15.00/1M output
        // 50000 tokens input = 50000/1M * $3.00 = $0.15
        // 10000 tokens output = 10000/1M * $15.00 = $0.15
        // Total = $0.30
        let input_cost = span_attrs
            .get(GenAiExtensions::USAGE_COST_INPUT)
            .and_then(|v| v.as_f64())
            .unwrap();
        let output_cost = span_attrs
            .get(GenAiExtensions::USAGE_COST_OUTPUT)
            .and_then(|v| v.as_f64())
            .unwrap();
        let total_cost = span_attrs
            .get(GenAiAttributes::USAGE_COST)
            .and_then(|v| v.as_f64())
            .unwrap();
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
            json::json!("claude-sonnet-4-6"),
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
        // claude-sonnet-4-6 extended tier: $6.00/1M input, $22.50/1M output
        // 250000 tokens input = 250000/1M * $6.00 = $1.5
        // 10000 tokens output = 10000/1M * $22.50 = $0.225
        // Total = $1.725
        let input_cost = span_attrs
            .get(GenAiExtensions::USAGE_COST_INPUT)
            .and_then(|v| v.as_f64())
            .unwrap();
        let output_cost = span_attrs
            .get(GenAiExtensions::USAGE_COST_OUTPUT)
            .and_then(|v| v.as_f64())
            .unwrap();
        let total_cost = span_attrs
            .get(GenAiAttributes::USAGE_COST)
            .and_then(|v| v.as_f64())
            .unwrap();
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
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::USAGE_COST)
                .and_then(|v| v.as_f64()),
            Some(0.999)
        );
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

        // No pricing definition matched for unknown model — total cost should be zero.
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::USAGE_COST)
                .and_then(|v| v.as_f64()),
            Some(0.0)
        );
    }

    #[test]
    fn test_process_span_extracts_evaluation_scores() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert("gen_ai.request.model".to_string(), json::json!("gpt-4"));
        // Add evaluation attributes (OTEL format)
        span_attrs.insert(
            "llm.evaluation.quality_score".to_string(),
            json::json!(0.85),
        );
        span_attrs.insert("llm.evaluation.relevance".to_string(), json::json!(0.9));
        span_attrs.insert("llm.evaluation.completeness".to_string(), json::json!(0.8));
        span_attrs.insert(
            "llm.evaluation.tool_effectiveness".to_string(),
            json::json!(0.75),
        );
        span_attrs.insert("llm.evaluation.groundedness".to_string(), json::json!(0.88));
        span_attrs.insert("llm.evaluation.safety".to_string(), json::json!(0.95));
        span_attrs.insert("llm.evaluation.duration_ms".to_string(), json::json!(12.5));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Evaluation scores should be enriched with O2 prefix
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_QUALITY)
                .and_then(|v| v.as_f64()),
            Some(0.85)
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_RELEVANCE)
                .and_then(|v| v.as_f64()),
            Some(0.9)
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_COMPLETENESS)
                .and_then(|v| v.as_f64()),
            Some(0.8)
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_TOOL_EFFECTIVENESS)
                .and_then(|v| v.as_f64()),
            Some(0.75)
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_GROUNDEDNESS)
                .and_then(|v| v.as_f64()),
            Some(0.88)
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_SAFETY)
                .and_then(|v| v.as_f64()),
            Some(0.95)
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_DURATION_MS)
                .and_then(|v| v.as_f64()),
            Some(12.5)
        );
    }

    #[test]
    fn test_process_span_calculates_cost_with_zero_tokens() {
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
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(0));
        span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(0));

        let resource_attrs = HashMap::new();
        let events = vec![];

        // we will recalculate the tokens first if it is zero, so the cost shouldn't be zero after
        // processing
        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Cost should be calculated even with 0 tokens (tokens get re-estimated, result > 0)
        let input_cost = span_attrs
            .get(GenAiExtensions::USAGE_COST_INPUT)
            .and_then(|v| v.as_f64())
            .unwrap();
        let output_cost = span_attrs
            .get(GenAiExtensions::USAGE_COST_OUTPUT)
            .and_then(|v| v.as_f64())
            .unwrap();
        let total_cost = span_attrs
            .get(GenAiAttributes::USAGE_COST)
            .and_then(|v| v.as_f64())
            .unwrap();
        assert!(input_cost > 0.0);
        assert!(output_cost > 0.0);
        assert!(total_cost > 0.0);
    }

    #[test]
    fn test_process_span_with_user_defined_pricing() {
        use config::meta::model_pricing::{ModelPricingDefinition, PricingTierDefinition};

        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert(
            "gen_ai.request.model".to_string(),
            json::json!("my-custom-model-v1"),
        );
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(1000));
        span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(500));
        span_attrs.insert(
            "gen_ai.input.messages".to_string(),
            json::json!("[{\"role\":\"user\",\"content\":\"hello\"}]"),
        );
        span_attrs.insert(
            "gen_ai.output.messages".to_string(),
            json::json!("[{\"role\":\"assistant\",\"content\":\"hi\"}]"),
        );

        let resource_attrs = HashMap::new();
        let events = vec![];

        // Create user-defined pricing entries with per-token prices
        // $5/1M input = 0.000005 per token, $20/1M output = 0.00002 per token
        let pricing_entries = vec![CachedModelPricing {
            definition: ModelPricingDefinition {
                name: "My Custom Model".to_string(),
                match_pattern: "(?i)^my-custom-model".to_string(),
                enabled: true,
                tiers: vec![PricingTierDefinition {
                    name: "Default".to_string(),
                    condition: None,
                    prices: std::collections::HashMap::from([
                        ("input".to_string(), 0.000005),
                        ("output".to_string(), 0.00002),
                    ]),
                }],
                ..Default::default()
            },
            compiled_regex: regex::Regex::new("(?i)^my-custom-model").unwrap(),
        }];

        processor.process_span_with_pricing(
            &mut span_attrs,
            &resource_attrs,
            None,
            &events,
            &pricing_entries,
            0,
        );

        // Cost should be calculated using user-defined pricing
        let input_cost = span_attrs
            .get(GenAiExtensions::USAGE_COST_INPUT)
            .and_then(|v| v.as_f64())
            .unwrap();
        let output_cost = span_attrs
            .get(GenAiExtensions::USAGE_COST_OUTPUT)
            .and_then(|v| v.as_f64())
            .unwrap();
        let total_cost = span_attrs
            .get(GenAiAttributes::USAGE_COST)
            .and_then(|v| v.as_f64())
            .unwrap();

        // 1000 tokens * $0.000005 = $0.005
        assert!((input_cost - 0.005).abs() < 1e-10);
        // 500 tokens * $0.00002 = $0.01
        assert!((output_cost - 0.01).abs() < 1e-10);
        assert!((total_cost - 0.015).abs() < 1e-10);
    }

    #[test]
    fn test_process_span_user_pricing_takes_priority_over_builtin() {
        use config::meta::model_pricing::{ModelPricingDefinition, PricingTierDefinition};

        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        // gpt-4o has built-in pricing ($2.50/$10.00 per 1M)
        span_attrs.insert("gen_ai.request.model".to_string(), json::json!("gpt-4o"));
        span_attrs.insert(
            "gen_ai.usage.input_tokens".to_string(),
            json::json!(1_000_000),
        );
        span_attrs.insert(
            "gen_ai.usage.output_tokens".to_string(),
            json::json!(1_000_000),
        );
        span_attrs.insert(
            "gen_ai.input.messages".to_string(),
            json::json!("[{\"role\":\"user\",\"content\":\"hello\"}]"),
        );
        span_attrs.insert(
            "gen_ai.output.messages".to_string(),
            json::json!("[{\"role\":\"assistant\",\"content\":\"hi\"}]"),
        );

        let resource_attrs = HashMap::new();
        let events = vec![];

        // Override gpt-4o pricing with custom per-token prices: $1/1M input, $2/1M output
        let pricing_entries = vec![CachedModelPricing {
            definition: ModelPricingDefinition {
                name: "Custom GPT-4o".to_string(),
                match_pattern: "(?i)^gpt-4o".to_string(),
                enabled: true,
                tiers: vec![PricingTierDefinition {
                    name: "Default".to_string(),
                    condition: None,
                    prices: std::collections::HashMap::from([
                        ("input".to_string(), 0.000001),  // $1/1M
                        ("output".to_string(), 0.000002), // $2/1M
                    ]),
                }],
                ..Default::default()
            },
            compiled_regex: regex::Regex::new("(?i)^gpt-4o").unwrap(),
        }];

        processor.process_span_with_pricing(
            &mut span_attrs,
            &resource_attrs,
            None,
            &events,
            &pricing_entries,
            0,
        );

        let input_cost = span_attrs
            .get(GenAiExtensions::USAGE_COST_INPUT)
            .and_then(|v| v.as_f64())
            .unwrap();
        let output_cost = span_attrs
            .get(GenAiExtensions::USAGE_COST_OUTPUT)
            .and_then(|v| v.as_f64())
            .unwrap();

        // Should use custom pricing, not built-in
        // 1M * $0.000001 = $1.00 (not $2.50 from built-in)
        assert!((input_cost - 1.0).abs() < 1e-10);
        // 1M * $0.000002 = $2.00 (not $10.00 from built-in)
        assert!((output_cost - 2.0).abs() < 1e-10);
    }
}
