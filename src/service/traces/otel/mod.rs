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
//! processor.process_span(
//!     &mut span_attributes,
//!     &resource_attributes,
//!     Some("openai"),
//!     &events,
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
//! processor.process_span(&mut span_attrs, &resource_attrs, Some("openai"), &events, None);
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

pub use extractors::{ObservationType, ScopeInfo, map_to_observation_type};
pub use pricing::calculate_cost;
pub use processor::OtelIngestionProcessor;

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::utils::json;

    use super::*;
    use crate::{common::meta::traces::Event, service::traces::otel::attributes::O2Attributes};

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
                .get(O2Attributes::OBSERVATION_TYPE)
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );

        // 2. Model name should be extracted
        assert_eq!(
            span_attributes
                .get(O2Attributes::MODEL_NAME)
                .and_then(|v| v.as_str()),
            Some("gpt-4o-2024-08-06")
        );

        // 3. Usage details should be present
        assert!(span_attributes.contains_key(O2Attributes::USAGE_DETAILS));
        let usage = span_attributes.get(O2Attributes::USAGE_DETAILS).unwrap();
        assert!(usage.is_object());
        assert_eq!(usage.get("input").and_then(|v| v.as_i64()), Some(12));
        assert_eq!(usage.get("output").and_then(|v| v.as_i64()), Some(8));

        // 4. Cost details should be present
        assert!(span_attributes.contains_key(O2Attributes::COST_DETAILS));
        let cost = span_attributes.get(O2Attributes::COST_DETAILS).unwrap();
        assert_eq!(cost.get("total").and_then(|v| v.as_f64()), Some(0.00042));

        // 5. User ID should be extracted
        assert_eq!(
            span_attributes
                .get(O2Attributes::USER_ID)
                .and_then(|v| v.as_str()),
            Some("user-789")
        );

        // 6. Session ID should be extracted
        assert_eq!(
            span_attributes
                .get(O2Attributes::SESSION_ID)
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
        assert!(span_attributes.contains_key(O2Attributes::INPUT));
        assert!(span_attributes.contains_key(O2Attributes::OUTPUT));
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
                .get(O2Attributes::OBSERVATION_TYPE)
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert_eq!(
            span_attributes
                .get(O2Attributes::MODEL_NAME)
                .and_then(|v| v.as_str()),
            Some("gpt-4")
        );
        assert_eq!(
            span_attributes
                .get(O2Attributes::USER_ID)
                .and_then(|v| v.as_str()),
            Some("user-456")
        );
        assert_eq!(
            span_attributes
                .get(O2Attributes::SESSION_ID)
                .and_then(|v| v.as_str()),
            Some("session-789")
        );
        assert!(span_attributes.contains_key(O2Attributes::INPUT));
        assert!(span_attributes.contains_key(O2Attributes::OUTPUT));
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
                .get(O2Attributes::OBSERVATION_TYPE)
                .and_then(|v| v.as_str()),
            Some("TOOL")
        );
        assert!(span_attributes.contains_key(O2Attributes::INPUT));
        assert!(span_attributes.contains_key(O2Attributes::OUTPUT));
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
                .get(O2Attributes::OBSERVATION_TYPE)
                .and_then(|v| v.as_str()),
            Some("EMBEDDING")
        );
        assert_eq!(
            span_attributes
                .get(O2Attributes::MODEL_NAME)
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
        assert!(span_attributes.contains_key(O2Attributes::INPUT));
        assert!(span_attributes.contains_key(O2Attributes::OUTPUT));
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

        // Verify backward compatibility with legacy names
        assert!(span_attributes.contains_key(O2Attributes::USAGE_DETAILS));
        let usage = span_attributes.get(O2Attributes::USAGE_DETAILS).unwrap();
        assert_eq!(usage.get("input").and_then(|v| v.as_i64()), Some(100));
        assert_eq!(usage.get("output").and_then(|v| v.as_i64()), Some(50));
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
                .get(O2Attributes::OBSERVATION_TYPE)
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::MODEL_NAME)
                .and_then(|v| v.as_str()),
            Some("gpt-4o-2024-08-06")
        );
        assert!(span_attrs.contains_key(O2Attributes::MODEL_PARAMETERS));
        assert!(span_attrs.contains_key(O2Attributes::USAGE_DETAILS));
        assert!(span_attrs.contains_key(O2Attributes::COST_DETAILS));
        assert_eq!(
            span_attrs
                .get(O2Attributes::USER_ID)
                .and_then(|v| v.as_str()),
            Some("user-123")
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::SESSION_ID)
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
                .get(O2Attributes::OBSERVATION_TYPE)
                .and_then(|v| v.as_str()),
            Some("TOOL")
        );
        assert!(span_attrs.contains_key(O2Attributes::INPUT));
        assert!(span_attrs.contains_key(O2Attributes::OUTPUT));
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
                .get(O2Attributes::OBSERVATION_TYPE)
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
                .get(O2Attributes::OBSERVATION_TYPE)
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::MODEL_NAME)
                .and_then(|v| v.as_str()),
            Some("gpt-4")
        );
        assert_eq!(
            span_attrs
                .get(O2Attributes::USER_ID)
                .and_then(|v| v.as_str()),
            Some("user-789")
        );
        assert!(span_attrs.contains_key(O2Attributes::INPUT));
        assert!(span_attrs.contains_key(O2Attributes::OUTPUT));
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
                .get(O2Attributes::OBSERVATION_TYPE)
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert!(span_attrs.contains_key(O2Attributes::USAGE_DETAILS));
    }
}
