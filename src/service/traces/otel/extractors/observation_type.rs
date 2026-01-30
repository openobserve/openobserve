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

//! Observation Type Mapper
//!
//! Maps OTEL spans to OpenObserve observation types based on attributes and context.

use std::collections::HashMap;

use config::utils::json;

use super::super::attributes::{GenAiAttributes, OpenInferenceAttributes, VercelAiSdkAttributes};
use crate::service::traces::otel::attributes::{
    FrameworkAttributes, LLMAttributes, LangfuseAttributes,
};

/// Observation types supported by OpenObserve
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ObservationType {
    Span,
    Event,
    Generation,
    Agent,
    Tool,
    Chain,
    Retriever,
    Task,
    Evaluator,
    Workflow,
    Embedding,
    Rerank,
    Guardrail,
}

impl ObservationType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ObservationType::Span => "SPAN",
            ObservationType::Event => "EVENT",
            ObservationType::Generation => "GENERATION",
            ObservationType::Agent => "AGENT",
            ObservationType::Tool => "TOOL",
            ObservationType::Chain => "CHAIN",
            ObservationType::Retriever => "RETRIEVER",
            ObservationType::Task => "TASK",
            ObservationType::Evaluator => "EVALUATOR",
            ObservationType::Workflow => "WORKFLOW",
            ObservationType::Embedding => "EMBEDDING",
            ObservationType::Rerank => "RERANK",
            ObservationType::Guardrail => "GUARDRAIL",
        }
    }
}

/// Scope information for mapping
pub struct ScopeInfo {
    pub name: Option<String>,
}

/// Map span attributes to an observation type using a priority-based system
pub fn map_to_observation_type(
    attributes: &HashMap<String, json::Value>,
    _resource_attributes: &HashMap<String, json::Value>,
    scope: Option<&ScopeInfo>,
) -> ObservationType {
    // Gen-AI Operation Name - OpenTelemetry semantic conventions
    // https://opentelemetry.io/docs/specs/semconv/gen-ai/
    // Official values: "chat", "text_completion", "generate_content", "embeddings",
    //                  "invoke_agent", "create_agent", "execute_tool"
    if let Some(operation) = attributes
        .get(GenAiAttributes::OPERATION_NAME)
        .and_then(|v| v.as_str())
    {
        match operation.to_lowercase().as_str() {
            "chat" | "text_completion" | "generate_content" => {
                return ObservationType::Generation;
            }
            "embeddings" => return ObservationType::Embedding,
            "invoke_agent" | "create_agent" => return ObservationType::Agent,
            "execute_tool" => return ObservationType::Tool,
            _ => {}
        }
    }

    // LLM Request Type - OpenLLMetry semantic conventions
    // https://github.com/traceloop/openllmetry
    // Official values: "chat", "completion", "embedding", "rerank", "unknown"
    if let Some(request_type) = attributes
        .get(LLMAttributes::REQUEST_TYPE)
        .and_then(|v| v.as_str())
    {
        match request_type.to_lowercase().as_str() {
            "chat" | "completion" => return ObservationType::Generation,
            "embedding" => return ObservationType::Embedding,
            "rerank" => return ObservationType::Rerank,
            "unknown" => {} // Fall through to other detection methods
            _ => {}
        }
    }

    // TraceLoop Span Kind
    if let Some(span_kind) = attributes
        .get(FrameworkAttributes::TRACELOOP_SPAN_KIND)
        .and_then(|v| v.as_str())
    {
        match span_kind.to_lowercase().as_str() {
            "workflow" => return ObservationType::Workflow,
            "task" => return ObservationType::Task,
            "agent" => return ObservationType::Agent,
            "tool" => return ObservationType::Tool,
            _ => {}
        }
    }

    // OpenInference Span Kind
    if let Some(span_kind) = attributes
        .get(OpenInferenceAttributes::SPAN_KIND)
        .and_then(|v| v.as_str())
    {
        match span_kind.to_uppercase().as_str() {
            "LLM" => return ObservationType::Generation,
            "CHAIN" => return ObservationType::Chain,
            "EMBEDDING" => return ObservationType::Embedding,
            "AGENT" => return ObservationType::Agent,
            "TOOL" => return ObservationType::Tool,
            "RETRIEVER" => return ObservationType::Retriever,
            "EVALUATOR" => return ObservationType::Evaluator,
            "GUARDRAIL" => return ObservationType::Guardrail,
            _ => {}
        }
    }

    // Langfuse Span Kind
    if let Some(span_kind) = attributes
        .get(LangfuseAttributes::TYPE)
        .and_then(|v| v.as_str())
    {
        match span_kind.to_uppercase().as_str() {
            "GENERATION" => return ObservationType::Generation,
            "CHAIN" => return ObservationType::Chain,
            "EMBEDDING" => return ObservationType::Embedding,
            "AGENT" => return ObservationType::Agent,
            "TOOL" => return ObservationType::Tool,
            "SPAN" => return ObservationType::Span,
            "RETRIEVER" => return ObservationType::Retriever,
            _ => {}
        }
    }

    // Vercel AI SDK
    if let Some(scope_info) = scope
        && scope_info.name.as_deref() == Some("ai")
    {
        // Check if it has a model attribute
        if attributes.contains_key(VercelAiSdkAttributes::MODEL_ID)
            || attributes.contains_key(GenAiAttributes::REQUEST_MODEL)
            || attributes.contains_key(GenAiAttributes::RESPONSE_MODEL)
        {
            return ObservationType::Generation;
        }
    }

    // Gen-AI Tool Name or Tool Call ID
    if let Some(scope_info) = scope
        && scope_info.name.as_deref() == Some("ai")
    {
        return ObservationType::Span;
    }

    // Gen-AI Tool Name or Tool Call ID
    if attributes.contains_key(GenAiAttributes::TOOL_NAME)
        || attributes.contains_key(GenAiAttributes::TOOL_CALL_ID)
    {
        return ObservationType::Tool;
    }

    // Model Name
    let model_keys = [
        GenAiAttributes::REQUEST_MODEL,
        GenAiAttributes::RESPONSE_MODEL,
        VercelAiSdkAttributes::MODEL_ID,
        OpenInferenceAttributes::LLM_MODEL_NAME,
        OpenInferenceAttributes::LLM_RESPONSE_MODEL,
        "model",
    ];

    for key in &model_keys {
        if attributes.contains_key(*key) {
            return ObservationType::Generation;
        }
    }

    // Default: return Span
    ObservationType::Span
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_attributes(pairs: Vec<(&str, &str)>) -> HashMap<String, json::Value> {
        pairs
            .into_iter()
            .map(|(k, v)| (k.to_string(), json::json!(v)))
            .collect()
    }

    #[test]
    fn test_gen_ai_operation_chat() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "chat")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Generation);
    }

    #[test]
    fn test_gen_ai_operation_embeddings() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "embeddings")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Embedding);
    }

    #[test]
    fn test_gen_ai_tool_detection() {
        let attrs = make_attributes(vec![("gen_ai.tool.name", "search_database")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Tool);
    }

    #[test]
    fn test_model_based_fallback() {
        let attrs = make_attributes(vec![("gen_ai.request.model", "gpt-4")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Generation);
    }

    #[test]
    fn test_vercel_ai_sdk_with_model() {
        let attrs = make_attributes(vec![("ai.model.id", "gpt-4")]);
        let resource_attrs = HashMap::new();
        let scope = Some(ScopeInfo {
            name: Some("ai".to_string()),
        });

        let result = map_to_observation_type(&attrs, &resource_attrs, scope.as_ref());
        assert_eq!(result, ObservationType::Generation);
    }

    #[test]
    fn test_default_to_span() {
        let attrs = HashMap::new();
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Span);
    }

    #[test]
    fn test_openinference_llm() {
        let attrs = make_attributes(vec![("openinference.span.kind", "LLM")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Generation);
    }

    #[test]
    fn test_observation_type_as_str() {
        assert_eq!(ObservationType::Span.as_str(), "SPAN");
        assert_eq!(ObservationType::Event.as_str(), "EVENT");
        assert_eq!(ObservationType::Generation.as_str(), "GENERATION");
        assert_eq!(ObservationType::Agent.as_str(), "AGENT");
        assert_eq!(ObservationType::Tool.as_str(), "TOOL");
        assert_eq!(ObservationType::Chain.as_str(), "CHAIN");
        assert_eq!(ObservationType::Retriever.as_str(), "RETRIEVER");
        assert_eq!(ObservationType::Evaluator.as_str(), "EVALUATOR");
        assert_eq!(ObservationType::Embedding.as_str(), "EMBEDDING");
        assert_eq!(ObservationType::Rerank.as_str(), "RERANK");
        assert_eq!(ObservationType::Guardrail.as_str(), "GUARDRAIL");
    }

    #[test]
    fn test_chain_detection() {
        let attrs = make_attributes(vec![("openinference.span.kind", "CHAIN")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Chain);
    }

    #[test]
    fn test_retriever_detection() {
        let attrs = make_attributes(vec![("openinference.span.kind", "RETRIEVER")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Retriever);
    }

    #[test]
    fn test_evaluator_detection() {
        let attrs = make_attributes(vec![("openinference.span.kind", "EVALUATOR")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Evaluator);
    }

    #[test]
    fn test_guardrail_detection() {
        let attrs = make_attributes(vec![("openinference.span.kind", "GUARDRAIL")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Guardrail);
    }

    #[test]
    fn test_gen_ai_operation_text_completion() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "text_completion")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Generation);
    }

    #[test]
    fn test_gen_ai_operation_generate_content() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "generate_content")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Generation);
    }

    #[test]
    fn test_gen_ai_operation_invoke_agent() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "invoke_agent")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Agent);
    }

    #[test]
    fn test_gen_ai_operation_create_agent() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "create_agent")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Agent);
    }

    #[test]
    fn test_gen_ai_operation_execute_tool() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "execute_tool")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Tool);
    }

    #[test]
    fn test_openinference_chain() {
        let attrs = make_attributes(vec![("openinference.span.kind", "CHAIN")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Chain);
    }

    #[test]
    fn test_llm_request_type_rerank() {
        let attrs = make_attributes(vec![("llm.request.type", "rerank")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Rerank);
    }

    #[test]
    fn test_llm_request_type_chat() {
        let attrs = make_attributes(vec![("llm.request.type", "chat")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Generation);
    }

    #[test]
    fn test_llm_request_type_completion() {
        let attrs = make_attributes(vec![("llm.request.type", "completion")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Generation);
    }

    #[test]
    fn test_llm_request_type_embedding() {
        let attrs = make_attributes(vec![("llm.request.type", "embedding")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Embedding);
    }
}
