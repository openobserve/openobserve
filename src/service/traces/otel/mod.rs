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
//! - **Multi-Framework Support**: Supports OpenTelemetry Gen-AI conventions, Vercel AI SDK,
//!   OpenInference, Logfire, LiveKit, MLFlow, TraceLoop, and more.
//!
//! # Architecture
//!
//! The module is organized into several components:
//!
//! - **attributes**: Defines constants for OpenObserve and standard OTEL attributes
//! - **observation_type_mapper**: Implements priority-based type detection
//! - **processor**: Main ingestion processor that enriches span attributes
//! - **utils**: Helper functions for JSON manipulation and parsing
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
//! - **Vercel AI SDK**: Full support for AI SDK attributes and events
//! - **OpenInference**: OpenInference semantic conventions
//! - **Logfire**: Pydantic AI integration
//! - **LiveKit**: LiveKit agents
//! - **MLFlow**: MLFlow tracking
//! - **TraceLoop**: TraceLoop SDK
//! - **SmolAgents**: SmolAgents framework
//! - **Google Vertex AI**: Vertex AI Agent Developer Kit
//! - **LlamaIndex**: LlamaIndex integration
//!
//! # References
//!
//! - OpenTelemetry Gen-AI Spec: <https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/>
//! - OpenTelemetry Registry: <https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/>

pub mod attributes;
pub mod observation_type_mapper;
pub mod processor;
pub mod utils;

#[cfg(test)]
mod integration_test;

pub use observation_type_mapper::{ObservationType, ScopeInfo, map_to_observation_type};
pub use processor::OtelIngestionProcessor;

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::utils::json;

    use super::*;

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

        processor.process_span(
            &mut span_attrs,
            &resource_attrs,
            Some("openai"),
            &events,
            None,
        );

        // Verify enriched attributes
        assert_eq!(
            span_attrs
                .get("llm_observation_type")
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert_eq!(
            span_attrs.get("llm_model_name").and_then(|v| v.as_str()),
            Some("gpt-4o-2024-08-06")
        );
        assert!(span_attrs.contains_key("llm_model_parameters"));
        assert!(span_attrs.contains_key("llm_usage_details"));
        assert!(span_attrs.contains_key("llm_cost_details"));
        assert_eq!(
            span_attrs.get("llm_user_id").and_then(|v| v.as_str()),
            Some("user-123")
        );
        assert_eq!(
            span_attrs.get("llm_session_id").and_then(|v| v.as_str()),
            Some("conv-456")
        );
        assert_eq!(
            span_attrs.get("llm_environment").and_then(|v| v.as_str()),
            Some("production")
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

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events, None);

        assert_eq!(
            span_attrs
                .get("llm_observation_type")
                .and_then(|v| v.as_str()),
            Some("TOOL")
        );
        assert!(span_attrs.contains_key("llm_input"));
        assert!(span_attrs.contains_key("llm_output"));
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

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events, None);

        assert_eq!(
            span_attrs
                .get("llm_observation_type")
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

        processor.process_span(&mut span_attrs, &resource_attrs, Some("ai"), &events, None);

        assert_eq!(
            span_attrs
                .get("llm_observation_type")
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert_eq!(
            span_attrs.get("llm_model_name").and_then(|v| v.as_str()),
            Some("gpt-4")
        );
        assert_eq!(
            span_attrs.get("llm_user_id").and_then(|v| v.as_str()),
            Some("user-789")
        );
        assert!(span_attrs.contains_key("llm_input"));
        assert!(span_attrs.contains_key("llm_output"));
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

        processor.process_span(&mut span_attrs, &resource_attrs, None, &events, None);

        // OpenInference has higher priority than model-based detection
        assert_eq!(
            span_attrs
                .get("llm_observation_type")
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert!(span_attrs.contains_key("llm_usage_details"));
    }
}
