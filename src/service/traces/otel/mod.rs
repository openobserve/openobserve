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

//! OpenObserve OTEL Transformer Module
//!
//! This module provides comprehensive OpenTelemetry (OTEL) trace processing and enrichment
//! capabilities for OpenObserve, following gen-ai semantic conventions and supporting
//! multiple AI/ML frameworks.
//!
//! # Overview
//!
//! The OTEL transformer enriches OpenTelemetry spans with OpenObserve-specific attributes,
//! enabling better observability for AI/ML applications. It supports:
//!
//! - **Observation Type Detection**: Automatically classifies spans as Generation, Embedding,
//!   Agent, Tool, or generic Span based on attributes and context.
//! - **Input/Output Extraction**: Extracts LLM inputs and outputs from various formats (events,
//!   attributes, nested structures).
//! - **Model Information**: Extracts model names, parameters, and configuration.
//! - **Usage Tracking**: Parses token counts and usage metrics.
//! - **Cost Tracking**: Extracts cost information when available.
//!
//! # Architecture
//!
//! The module is organized into several components:
//!
//! - **attributes**: Defines constants for OpenObserve and standard OTEL attributes
//! - **extractors**: Implements extraction logic for various LLM trace data
//! - **processor**: Main ingestion processor that enriches span attributes
//!
//! # Usage
//!
//! ```rust,ignore
//! use crate::service::traces::otel::OtelIngestionProcessor;
//!
//! let processor = OtelIngestionProcessor::new();
//! let mut span_attributes = /* ... */;
//! let resource_attributes = /* ... */;
//! let events = /* ... */;
//!
//! processor.process_span_with_pricing(
//!     &mut span_attributes,
//!     &resource_attributes,
//!     Some("openai"),
//!     &events,
//!     &[], // pass org pricing entries here in production
//!     span_start_nanos, // span.start_time_unix_nano from OTLP payload
//! );
//! ```
//!
//! # Examples
//!
//! ## Enriching a Chat Completion Span
//!
//! ```rust,ignore
//! use std::collections::HashMap;
//! use config::utils::json;
//!
//! let processor = OtelIngestionProcessor::new();
//! let mut span_attrs = HashMap::new();
//! span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
//! span_attrs.insert("gen_ai.request.model".to_string(), json::json!("gpt-4"));
//! span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(150));
//! span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(75));
//!
//! let resource_attrs = HashMap::new();
//! let events = vec![];
//!
//! processor.process_span_with_pricing(&mut span_attrs, &resource_attrs, Some("openai"), &events, &[], 0);
//!
//! // Result: span_attrs now contains:
//! // - observation_type: "GENERATION"
//! // - model_name: "gpt-4"
//! // - usage_details: {"input": 150, "output": 75}
//! // - environment: "default"
//! ```
//!
//! # Supported Frameworks
//!
//! - **OpenTelemetry Gen-AI**: Standard gen-ai semantic conventions
//! - **TraceLoop**: TraceLoop SDK
//!
//! # References
//!
//! - OpenTelemetry Gen-AI Spec: <https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/>
//! - OpenTelemetry Registry: <https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/>

pub mod attributes;
pub mod extractors;
pub mod pricing;
pub mod processor;

pub use extractors::{
    ScopeInfo, is_generation_or_embedding, is_llm_trace, map_to_gen_ai_operation_name,
};
pub use pricing::calculate_cost;
pub use processor::OtelIngestionProcessor;

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::utils::json;

    use super::*;
    use crate::{
        common::meta::traces::Event,
        service::traces::otel::attributes::{
            GenAiAttributes, GenAiExtensions, O2Attributes, OtelAttributes,
        },
    };

    /// Test that simulates the complete OpenObserve traces ingestion flow
    /// with OTEL processor integration
    #[test]
    fn test_integration_complete_flow() {
        let processor = OtelIngestionProcessor::new();

        // Simulate resource attributes (from OTLP ResourceSpans)
        let mut resource_attributes = HashMap::new();
        resource_attributes.insert("service.name".to_string(), json::json!("my-ai-chatbot"));
        resource_attributes.insert("service.version".to_string(), json::json!("1.2.0"));
        resource_attributes.insert(
            "deployment.environment.name".to_string(),
            json::json!("production"),
        );

        // Simulate span attributes (from OTLP Span)
        let mut span_attributes = HashMap::new();
        span_attributes.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attributes.insert("gen_ai.request.model".to_string(), json::json!("gpt-4"));
        span_attributes.insert(
            "gen_ai.response.model".to_string(),
            json::json!("gpt-4o-2024-08-06"),
        );
        span_attributes.insert("gen_ai.request.temperature".to_string(), json::json!(0.7));
        span_attributes.insert("gen_ai.request.max_tokens".to_string(), json::json!(1000));
        span_attributes.insert(
            "gen_ai.input.messages".to_string(),
            json::json!(r#"[{"role":"user","content":"Hello AI!"}]"#),
        );
        span_attributes.insert(
            "gen_ai.output.messages".to_string(),
            json::json!(r#"[{"role":"assistant","content":"Hello! How can I help?"}]"#),
        );
        span_attributes.insert("gen_ai.usage.input_tokens".to_string(), json::json!(12));
        span_attributes.insert("gen_ai.usage.output_tokens".to_string(), json::json!(8));
        span_attributes.insert("gen_ai.usage.cost".to_string(), json::json!(0.00042));
        span_attributes.insert("user.id".to_string(), json::json!("user-789"));
        span_attributes.insert(
            "gen_ai.conversation.id".to_string(),
            json::json!("conv-123"),
        );

        // Simulate events (from OTLP Span events)
        let events = vec![];

        // This is what happens in handle_otlp_request
        processor.process_span(
            &mut span_attributes,
            &resource_attributes,
            Some("openai"),
            &events,
        );

        // Verify enrichment
        // 1. Observation type should be GENERATION
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::OPERATION_NAME)
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );

        // 2. Model name should be extracted
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::RESPONSE_MODEL)
                .and_then(|v| v.as_str()),
            Some("gpt-4o-2024-08-06")
        );

        // 3. Usage tokens emitted as individual scalar attributes
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::USAGE_INPUT_TOKENS)
                .and_then(|v| v.as_i64()),
            Some(12)
        );
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::USAGE_OUTPUT_TOKENS)
                .and_then(|v| v.as_i64()),
            Some(8)
        );

        // 4. Cost total emitted as scalar at gen_ai.usage.cost
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::USAGE_COST)
                .and_then(|v| v.as_f64()),
            Some(0.00042)
        );

        // 5. User ID should be extracted
        assert_eq!(
            span_attributes
                .get(OtelAttributes::USER_ID)
                .and_then(|v| v.as_str()),
            Some("user-789")
        );

        // 6. Session ID should be extracted
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::CONVERSATION_ID)
                .and_then(|v| v.as_str()),
            Some("conv-123")
        );

        // 8. Model parameters should be extracted
        assert!(span_attributes.contains_key(O2Attributes::MODEL_PARAMETERS));
        let params = span_attributes.get(O2Attributes::MODEL_PARAMETERS).unwrap();
        assert!(params.is_object());
        assert!(params.get("temperature").is_some());
        assert!(params.get("max_tokens").is_some());

        // 9. LLM input/output should be present
        assert!(span_attributes.contains_key(GenAiAttributes::INPUT_MESSAGES));
        assert!(span_attributes.contains_key(GenAiAttributes::OUTPUT_MESSAGES));
    }

    #[test]
    fn test_integration_vercel_ai_sdk() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attributes = HashMap::new();
        span_attributes.insert("ai.model.id".to_string(), json::json!("gpt-4"));
        span_attributes.insert(
            "ai.prompt.messages".to_string(),
            json::json!(r#"[{"role":"user","content":"Test"}]"#),
        );
        span_attributes.insert("ai.response.text".to_string(), json::json!("Response"));
        span_attributes.insert("gen_ai.usage.input_tokens".to_string(), json::json!(5));
        span_attributes.insert("gen_ai.usage.output_tokens".to_string(), json::json!(3));
        span_attributes.insert(
            "ai.telemetry.metadata.userId".to_string(),
            json::json!("user-456"),
        );
        span_attributes.insert(
            "ai.telemetry.metadata.sessionId".to_string(),
            json::json!("session-789"),
        );

        let resource_attributes = HashMap::new();
        let events = vec![];

        processor.process_span(
            &mut span_attributes,
            &resource_attributes,
            Some("ai"),
            &events,
        );

        // Verify Vercel AI SDK specific enrichment
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::OPERATION_NAME)
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::RESPONSE_MODEL)
                .and_then(|v| v.as_str()),
            Some("gpt-4")
        );
        assert_eq!(
            span_attributes
                .get(OtelAttributes::USER_ID)
                .and_then(|v| v.as_str()),
            Some("user-456")
        );
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::CONVERSATION_ID)
                .and_then(|v| v.as_str()),
            Some("session-789")
        );
        assert!(span_attributes.contains_key(GenAiAttributes::INPUT_MESSAGES));
        assert!(span_attributes.contains_key(GenAiAttributes::OUTPUT_MESSAGES));
    }

    #[test]
    fn test_integration_tool_call() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attributes = HashMap::new();
        span_attributes.insert(
            "gen_ai.tool.name".to_string(),
            json::json!("search_database"),
        );
        span_attributes.insert(
            "gen_ai.tool.call.id".to_string(),
            json::json!("call_abc123"),
        );
        span_attributes.insert(
            "gen_ai.tool.call.arguments".to_string(),
            json::json!(r#"{"query":"find users"}"#),
        );
        span_attributes.insert(
            "gen_ai.tool.call.result".to_string(),
            json::json!(r#"{"count":42,"results":[...]}"#),
        );

        let resource_attributes = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attributes, &resource_attributes, None, &events);

        // Verify tool call enrichment
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::OPERATION_NAME)
                .and_then(|v| v.as_str()),
            Some("TOOL")
        );
        assert!(span_attributes.contains_key(GenAiAttributes::INPUT_MESSAGES));
        assert!(span_attributes.contains_key(GenAiAttributes::OUTPUT_MESSAGES));
    }

    #[test]
    fn test_integration_embedding() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attributes = HashMap::new();
        span_attributes.insert(
            "gen_ai.operation.name".to_string(),
            json::json!("embeddings"),
        );
        span_attributes.insert(
            "gen_ai.request.model".to_string(),
            json::json!("text-embedding-ada-002"),
        );
        span_attributes.insert("gen_ai.usage.input_tokens".to_string(), json::json!(50));

        let resource_attributes = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attributes, &resource_attributes, None, &events);

        // Verify embedding enrichment
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::OPERATION_NAME)
                .and_then(|v| v.as_str()),
            Some("EMBEDDING")
        );
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::RESPONSE_MODEL)
                .and_then(|v| v.as_str()),
            Some("text-embedding-ada-002")
        );
    }

    #[test]
    fn test_integration_with_gen_ai_events() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attributes = HashMap::new();
        span_attributes.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attributes.insert("gen_ai.request.model".to_string(), json::json!("claude-3"));

        // Simulate gen_ai events
        let events = vec![
            Event {
                name: "gen_ai.user.message".to_string(),
                _timestamp: 0,
                attributes: {
                    let mut attrs = HashMap::new();
                    attrs.insert("content".to_string(), json::json!("What is the weather?"));
                    attrs
                },
            },
            Event {
                name: "gen_ai.assistant.message".to_string(),
                _timestamp: 0,
                attributes: {
                    let mut attrs = HashMap::new();
                    attrs.insert(
                        "content".to_string(),
                        json::json!("Let me check that for you."),
                    );
                    attrs
                },
            },
            Event {
                name: "gen_ai.choice".to_string(),
                _timestamp: 0,
                attributes: {
                    let mut attrs = HashMap::new();
                    attrs.insert("finish_reason".to_string(), json::json!("stop"));
                    attrs.insert(
                        "message.content".to_string(),
                        json::json!("The weather is sunny."),
                    );
                    attrs
                },
            },
        ];

        let resource_attributes = HashMap::new();

        processor.process_span(&mut span_attributes, &resource_attributes, None, &events);

        // Verify event-based input/output extraction
        assert!(span_attributes.contains_key(GenAiAttributes::INPUT_MESSAGES));
        assert!(span_attributes.contains_key(GenAiAttributes::OUTPUT_MESSAGES));
    }

    #[test]
    fn test_integration_backward_compatibility() {
        let processor = OtelIngestionProcessor::new();

        // Test with legacy attribute names
        let mut span_attributes = HashMap::new();
        span_attributes.insert("gen_ai.usage.prompt_tokens".to_string(), json::json!(100));
        span_attributes.insert(
            "gen_ai.usage.completion_tokens".to_string(),
            json::json!(50),
        );

        let resource_attributes = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attributes, &resource_attributes, None, &events);

        // Verify backward-compat token names map to Gen-AI scalar attributes
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::USAGE_INPUT_TOKENS)
                .and_then(|v| v.as_i64()),
            Some(100)
        );
        assert_eq!(
            span_attributes
                .get(GenAiAttributes::USAGE_OUTPUT_TOKENS)
                .and_then(|v| v.as_i64()),
            Some(50)
        );
    }

    #[test]
    fn test_complete_processing_workflow() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert(
            "gen_ai.response.model".to_string(),
            json::json!("gpt-4o-2024-08-06"),
        );
        span_attrs.insert("gen_ai.request.temperature".to_string(), json::json!(0.7));
        span_attrs.insert("gen_ai.request.max_tokens".to_string(), json::json!(1000));
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(150));
        span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(75));
        span_attrs.insert("gen_ai.usage.cost".to_string(), json::json!(0.0025));
        span_attrs.insert("user.id".to_string(), json::json!("user-123"));
        span_attrs.insert(
            "gen_ai.conversation.id".to_string(),
            json::json!("conv-456"),
        );
        span_attrs.insert(
            "deployment.environment.name".to_string(),
            json::json!("production"),
        );

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, Some("openai"), &events);

        // Verify enriched attributes
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::OPERATION_NAME)
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::RESPONSE_MODEL)
                .and_then(|v| v.as_str()),
            Some("gpt-4o-2024-08-06")
        );
        assert!(span_attrs.contains_key(O2Attributes::MODEL_PARAMETERS));
        assert!(span_attrs.contains_key(GenAiAttributes::USAGE_INPUT_TOKENS));
        assert!(span_attrs.contains_key(GenAiAttributes::USAGE_OUTPUT_TOKENS));
        assert!(span_attrs.contains_key(GenAiAttributes::USAGE_COST));
        assert_eq!(
            span_attrs
                .get(OtelAttributes::USER_ID)
                .and_then(|v| v.as_str()),
            Some("user-123")
        );
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::CONVERSATION_ID)
                .and_then(|v| v.as_str()),
            Some("conv-456")
        );
    }

    #[test]
    fn test_tool_call_detection() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert(
            "gen_ai.tool.name".to_string(),
            json::json!("search_database"),
        );
        span_attrs.insert(
            "gen_ai.tool.call.arguments".to_string(),
            json::json!(r#"{"query": "find users"}"#),
        );
        span_attrs.insert(
            "gen_ai.tool.call.result".to_string(),
            json::json!(r#"{"count": 42}"#),
        );

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        assert_eq!(
            span_attrs
                .get(GenAiAttributes::OPERATION_NAME)
                .and_then(|v| v.as_str()),
            Some("TOOL")
        );
        assert!(span_attrs.contains_key(GenAiAttributes::INPUT_MESSAGES));
        assert!(span_attrs.contains_key(GenAiAttributes::OUTPUT_MESSAGES));
    }

    #[test]
    fn test_embedding_detection() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert(
            "gen_ai.operation.name".to_string(),
            json::json!("embeddings"),
        );
        span_attrs.insert(
            "gen_ai.request.model".to_string(),
            json::json!("text-embedding-ada-002"),
        );

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        assert_eq!(
            span_attrs
                .get(GenAiAttributes::OPERATION_NAME)
                .and_then(|v| v.as_str()),
            Some("EMBEDDING")
        );
    }

    #[test]
    fn test_vercel_ai_sdk_processing() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("ai.model.id".to_string(), json::json!("gpt-4"));
        span_attrs.insert(
            "ai.prompt.messages".to_string(),
            json::json!(r#"[{"role":"user","content":"Hello"}]"#),
        );
        span_attrs.insert(
            "ai.response.text".to_string(),
            json::json!("Hello! How can I help?"),
        );
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(10));
        span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(8));
        span_attrs.insert(
            "ai.telemetry.metadata.userId".to_string(),
            json::json!("user-789"),
        );

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, Some("ai"), &events);

        assert_eq!(
            span_attrs
                .get(GenAiAttributes::OPERATION_NAME)
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::RESPONSE_MODEL)
                .and_then(|v| v.as_str()),
            Some("gpt-4")
        );
        assert_eq!(
            span_attrs
                .get(OtelAttributes::USER_ID)
                .and_then(|v| v.as_str()),
            Some("user-789")
        );
        assert!(span_attrs.contains_key(GenAiAttributes::INPUT_MESSAGES));
        assert!(span_attrs.contains_key(GenAiAttributes::OUTPUT_MESSAGES));
    }

    #[test]
    fn test_multiple_framework_attributes() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        // OpenInference attribute
        span_attrs.insert("openinference.span.kind".to_string(), json::json!("LLM"));
        // Gen-AI attributes
        span_attrs.insert("gen_ai.response.model".to_string(), json::json!("claude-3"));
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(200));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // OpenInference has higher priority than model-based detection
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::OPERATION_NAME)
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert!(span_attrs.contains_key(GenAiAttributes::USAGE_INPUT_TOKENS));
    }

    /// Full E2E integration test simulating what the o2-sre-agent sends:
    /// A chat span with evaluation scores, usage, cost, metadata, and tool info.
    /// Verifies the complete enrichment pipeline from raw OTEL attributes to O2-prefixed fields.
    #[test]
    fn test_integration_e2e_sre_agent_with_evaluation() {
        let processor = OtelIngestionProcessor::new();

        // ── Resource attributes (from OTLP ResourceSpans) ──
        let mut resource_attrs = HashMap::new();
        resource_attrs.insert("service.name".to_string(), json::json!("o2-sre-agent"));
        resource_attrs.insert("service.version".to_string(), json::json!("0.1.0"));
        resource_attrs.insert(
            "deployment.environment.name".to_string(),
            json::json!("production"),
        );

        // ── Span attributes (from TracedLlm in o2-sre-agent) ──
        let mut span_attrs = HashMap::new();

        // Gen-AI semantic conventions
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert(
            "gen_ai.request.model".to_string(),
            json::json!("claude-3-5-sonnet"),
        );
        span_attrs.insert(
            "gen_ai.response.model".to_string(),
            json::json!("claude-3-5-sonnet"),
        );
        span_attrs.insert("gen_ai.system".to_string(), json::json!("anthropic"));
        span_attrs.insert("gen_ai.request.temperature".to_string(), json::json!(0.7));
        span_attrs.insert("gen_ai.request.max_tokens".to_string(), json::json!(4096));

        // Input/output messages
        span_attrs.insert(
            "gen_ai.input.messages".to_string(),
            json::json!(
                r#"[{"role":"user","content":"What are the top error logs in the last hour?"}]"#
            ),
        );
        span_attrs.insert(
            "gen_ai.output.messages".to_string(),
            json::json!(r#"[{"role":"assistant","content":"I found 3 critical errors in the nginx service..."}]"#),
        );

        // Usage tokens
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(1250));
        span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(340));

        // User and session
        span_attrs.insert("user.id".to_string(), json::json!("admin@example.com"));
        span_attrs.insert(
            "gen_ai.conversation.id".to_string(),
            json::json!("01936b7a-8c4f-7d00-a000-deadbeef1234"),
        );

        // Evaluation scores (from EvaluationRunner in o2-sre-agent)
        span_attrs.insert(
            "llm.evaluation.quality_score".to_string(),
            json::json!(0.82),
        );
        span_attrs.insert("llm.evaluation.relevance".to_string(), json::json!(0.9));
        span_attrs.insert("llm.evaluation.completeness".to_string(), json::json!(0.75));
        span_attrs.insert(
            "llm.evaluation.tool_effectiveness".to_string(),
            json::json!(0.85),
        );
        span_attrs.insert("llm.evaluation.groundedness".to_string(), json::json!(0.88));
        span_attrs.insert("llm.evaluation.safety".to_string(), json::json!(0.95));
        span_attrs.insert("llm.evaluation.duration_ms".to_string(), json::json!(15.3));

        let events = vec![];

        // ── Process the span (this is what happens in handle_otlp_request) ──
        processor.process_span(&mut span_attrs, &resource_attrs, Some("anthropic"), &events);

        // ═══ Verify complete enrichment pipeline ═══

        // 1. Observation type
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::OPERATION_NAME)
                .and_then(|v| v.as_str()),
            Some("GENERATION"),
            "Should detect GENERATION from gen_ai.operation.name=chat"
        );

        // 2. Model name (response model takes precedence)
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::RESPONSE_MODEL)
                .and_then(|v| v.as_str()),
            Some("claude-3-5-sonnet"),
            "Should extract model name from gen_ai.response.model"
        );

        // 3. Provider name (from gen_ai.system)
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::PROVIDER_NAME)
                .and_then(|v| v.as_str()),
            Some("anthropic"),
            "Should extract provider from gen_ai.system"
        );

        // 4. Usage tokens emitted as scalar attributes
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::USAGE_INPUT_TOKENS)
                .and_then(|v| v.as_i64()),
            Some(1250)
        );
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::USAGE_OUTPUT_TOKENS)
                .and_then(|v| v.as_i64()),
            Some(340)
        );
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::USAGE_TOTAL_TOKENS)
                .and_then(|v| v.as_i64()),
            Some(1590),
            "Total should be input + output"
        );

        // 5. Cost emitted as scalar attributes (calculated from model pricing)
        assert!(
            span_attrs
                .get(GenAiExtensions::USAGE_COST_INPUT)
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
                > 0.0,
            "Input cost should be > 0 for known model"
        );
        assert!(
            span_attrs
                .get(GenAiExtensions::USAGE_COST_OUTPUT)
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
                > 0.0,
            "Output cost should be > 0 for known model"
        );
        assert!(
            span_attrs
                .get(GenAiAttributes::USAGE_COST)
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
                > 0.0,
            "Total cost should be > 0"
        );

        // 6. Model parameters (stored as HashMap<String, String> → JSON object with string values)
        assert!(
            span_attrs.contains_key(O2Attributes::MODEL_PARAMETERS),
            "Should have model parameters"
        );
        let params = span_attrs.get(O2Attributes::MODEL_PARAMETERS).unwrap();
        assert!(
            params.is_object(),
            "Model parameters should be a JSON object"
        );
        assert_eq!(
            params.get("temperature").and_then(|v| v.as_str()),
            Some("0.7")
        );
        assert_eq!(
            params.get("max_tokens").and_then(|v| v.as_str()),
            Some("4096")
        );

        // 7. User/session metadata
        assert_eq!(
            span_attrs
                .get(OtelAttributes::USER_ID)
                .and_then(|v| v.as_str()),
            Some("admin@example.com")
        );
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::CONVERSATION_ID)
                .and_then(|v| v.as_str()),
            Some("01936b7a-8c4f-7d00-a000-deadbeef1234")
        );

        // 8. Input/output enriched at canonical Gen-AI keys.
        // Note: the processor now emits the OO-condensed string form back to the
        // same gen_ai.input.messages / gen_ai.output.messages keys (overwriting
        // the original structured value), so they remain present after enrichment.
        assert!(
            span_attrs.contains_key(GenAiAttributes::INPUT_MESSAGES),
            "Should have enriched input"
        );
        assert!(
            span_attrs.contains_key(GenAiAttributes::OUTPUT_MESSAGES),
            "Should have enriched output"
        );

        // 9. Evaluation scores (the new feature!)
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_QUALITY)
                .and_then(|v| v.as_f64()),
            Some(0.82),
            "Quality score should be enriched"
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_RELEVANCE)
                .and_then(|v| v.as_f64()),
            Some(0.9),
            "Relevance score should be enriched"
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_COMPLETENESS)
                .and_then(|v| v.as_f64()),
            Some(0.75),
            "Completeness score should be enriched"
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_TOOL_EFFECTIVENESS)
                .and_then(|v| v.as_f64()),
            Some(0.85),
            "Tool effectiveness score should be enriched"
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_GROUNDEDNESS)
                .and_then(|v| v.as_f64()),
            Some(0.88),
            "Groundedness score should be enriched"
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_SAFETY)
                .and_then(|v| v.as_f64()),
            Some(0.95),
            "Safety score should be enriched"
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::EVALUATION_DURATION_MS)
                .and_then(|v| v.as_f64()),
            Some(15.3),
            "Evaluation duration should be enriched"
        );

        // 10. Usage tokens scalar attributes are present for frontend consumption
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::USAGE_INPUT_TOKENS)
                .and_then(|v| v.as_i64()),
            Some(1250)
        );
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::USAGE_OUTPUT_TOKENS)
                .and_then(|v| v.as_i64()),
            Some(340)
        );
        assert_eq!(
            span_attrs
                .get(GenAiAttributes::USAGE_TOTAL_TOKENS)
                .and_then(|v| v.as_i64()),
            Some(1590)
        );
    }

    /// Integration test: span with NO evaluation data should NOT have evaluation fields
    #[test]
    fn test_integration_no_evaluation_when_absent() {
        let processor = OtelIngestionProcessor::new();

        let mut span_attrs = HashMap::new();
        span_attrs.insert("gen_ai.operation.name".to_string(), json::json!("chat"));
        span_attrs.insert("gen_ai.request.model".to_string(), json::json!("gpt-4"));
        span_attrs.insert("gen_ai.usage.input_tokens".to_string(), json::json!(100));
        span_attrs.insert("gen_ai.usage.output_tokens".to_string(), json::json!(50));

        let resource_attrs = HashMap::new();
        let events = vec![];

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events);

        // Should NOT have evaluation fields when no evaluation data was sent
        assert!(
            !span_attrs.contains_key(O2Attributes::EVALUATION_QUALITY),
            "Should NOT add evaluation fields when no evaluation data present"
        );
        assert!(!span_attrs.contains_key(O2Attributes::EVALUATION_RELEVANCE));
        assert!(!span_attrs.contains_key(O2Attributes::EVALUATION_COMPLETENESS));
        assert!(!span_attrs.contains_key(O2Attributes::EVALUATION_GROUNDEDNESS));
        assert!(!span_attrs.contains_key(O2Attributes::EVALUATION_SAFETY));

        // But should still have usage tokens
        assert!(span_attrs.contains_key(GenAiAttributes::USAGE_INPUT_TOKENS));
    }
}
