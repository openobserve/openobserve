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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::utils::json;

    use super::super::*;
    use crate::common::meta::traces::Event;

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
            None,
        );

        // Verify enrichment
        // 1. Observation type should be GENERATION
        assert_eq!(
            span_attributes
                .get("llm_observation_type")
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );

        // 2. Model name should be extracted
        assert_eq!(
            span_attributes
                .get("llm_model_name")
                .and_then(|v| v.as_str()),
            Some("gpt-4o-2024-08-06")
        );

        // 3. Usage details should be present
        assert!(span_attributes.contains_key("llm_usage_details"));
        let usage = span_attributes.get("llm_usage_details").unwrap();
        assert!(usage.is_object());
        assert_eq!(usage.get("input").and_then(|v| v.as_i64()), Some(12));
        assert_eq!(usage.get("output").and_then(|v| v.as_i64()), Some(8));

        // 4. Cost details should be present
        assert!(span_attributes.contains_key("llm_cost_details"));
        let cost = span_attributes.get("llm_cost_details").unwrap();
        assert_eq!(cost.get("total").and_then(|v| v.as_f64()), Some(0.00042));

        // 5. User ID should be extracted
        assert_eq!(
            span_attributes.get("llm_user_id").and_then(|v| v.as_str()),
            Some("user-789")
        );

        // 6. Session ID should be extracted
        assert_eq!(
            span_attributes
                .get("llm_session_id")
                .and_then(|v| v.as_str()),
            Some("conv-123")
        );

        // 7. Environment should be extracted
        assert_eq!(
            span_attributes
                .get("llm_environment")
                .and_then(|v| v.as_str()),
            Some("production")
        );

        // 8. Model parameters should be extracted
        assert!(span_attributes.contains_key("llm_model_parameters"));
        let params = span_attributes.get("llm_model_parameters").unwrap();
        assert!(params.is_object());
        assert!(params.get("temperature").is_some());
        assert!(params.get("max_tokens").is_some());

        // 9. LLM input/output should be present
        assert!(span_attributes.contains_key("llm_input"));
        assert!(span_attributes.contains_key("llm_output"));

        println!("✅ Integration test passed - all fields enriched correctly");
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
            Some("2024-01-01T00:00:00Z"),
        );

        // Verify Vercel AI SDK specific enrichment
        assert_eq!(
            span_attributes
                .get("llm_observation_type")
                .and_then(|v| v.as_str()),
            Some("GENERATION")
        );
        assert_eq!(
            span_attributes
                .get("llm_model_name")
                .and_then(|v| v.as_str()),
            Some("gpt-4")
        );
        assert_eq!(
            span_attributes.get("llm_user_id").and_then(|v| v.as_str()),
            Some("user-456")
        );
        assert_eq!(
            span_attributes
                .get("llm_session_id")
                .and_then(|v| v.as_str()),
            Some("session-789")
        );
        assert!(span_attributes.contains_key("llm_input"));
        assert!(span_attributes.contains_key("llm_output"));

        println!("✅ Vercel AI SDK integration test passed");
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

        processor.process_span(
            &mut span_attributes,
            &resource_attributes,
            None,
            &events,
            None,
        );

        // Verify tool call enrichment
        assert_eq!(
            span_attributes
                .get("llm_observation_type")
                .and_then(|v| v.as_str()),
            Some("TOOL")
        );
        assert!(span_attributes.contains_key("llm_input"));
        assert!(span_attributes.contains_key("llm_output"));

        println!("✅ Tool call integration test passed");
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

        processor.process_span(
            &mut span_attributes,
            &resource_attributes,
            None,
            &events,
            None,
        );

        // Verify embedding enrichment
        assert_eq!(
            span_attributes
                .get("llm_observation_type")
                .and_then(|v| v.as_str()),
            Some("EMBEDDING")
        );
        assert_eq!(
            span_attributes
                .get("llm_model_name")
                .and_then(|v| v.as_str()),
            Some("text-embedding-ada-002")
        );

        println!("✅ Embedding integration test passed");
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

        processor.process_span(
            &mut span_attributes,
            &resource_attributes,
            None,
            &events,
            None,
        );

        // Verify event-based input/output extraction
        assert!(span_attributes.contains_key("llm_input"));
        assert!(span_attributes.contains_key("llm_output"));

        println!("✅ Gen-AI events integration test passed");
    }

    #[test]
    fn test_completion_start_time_extraction() {
        let processor = OtelIngestionProcessor::new();
        let mut span_attributes = HashMap::new();

        // Simulate Vercel AI SDK span with msToFirstChunk
        span_attributes.insert(
            "ai.response.msToFirstChunk".to_string(),
            json::json!(250), // 250ms to first chunk
        );
        span_attributes.insert("ai.model.id".to_string(), json::json!("gpt-4"));
        span_attributes.insert("ai.response.text".to_string(), json::json!("Response text"));

        let resource_attributes = HashMap::new();
        let events = vec![];
        let start_time_iso = "2024-01-01T10:00:00.000Z"; // Start time

        processor.process_span(
            &mut span_attributes,
            &resource_attributes,
            Some("ai"),
            &events,
            Some(start_time_iso),
        );

        // Check completion_start_time was extracted
        assert!(span_attributes.contains_key("llm_completion_start_time"));
        let completion_time = span_attributes
            .get("llm_completion_start_time")
            .and_then(|v| v.as_str())
            .expect("completion_start_time should be a string");

        // Verify it's 250ms after start time
        assert!(completion_time.contains("2024-01-01T10:00:00.25"));
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

        processor.process_span(
            &mut span_attributes,
            &resource_attributes,
            None,
            &events,
            None,
        );

        // Verify backward compatibility with legacy names
        assert!(span_attributes.contains_key("llm_usage_details"));
        let usage = span_attributes.get("llm_usage_details").unwrap();
        assert_eq!(usage.get("input").and_then(|v| v.as_i64()), Some(100));
        assert_eq!(usage.get("output").and_then(|v| v.as_i64()), Some(50));

        println!("✅ Backward compatibility test passed");
    }
}
