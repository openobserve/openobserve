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
    Evaluator,
    Embedding,
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
            ObservationType::Evaluator => "EVALUATOR",
            ObservationType::Embedding => "EMBEDDING",
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
    if let Some(operation) = attributes
        .get(GenAiAttributes::OPERATION_NAME)
        .and_then(|v| v.as_str())
    {
        match operation.to_lowercase().as_str() {
            "chat" | "completion" | "text_completion" | "generate_content" | "generate" => {
                return ObservationType::Generation;
            }
            "embeddings" => return ObservationType::Embedding,
            "invoke_agent" | "create_agent" => return ObservationType::Agent,
            "execute_tool" => return ObservationType::Tool,
            "chain" => return ObservationType::Chain,
            "retriever" | "retrieve" => return ObservationType::Retriever,
            "evaluator" | "evaluate" => return ObservationType::Evaluator,
            "guardrail" => return ObservationType::Guardrail,
            _ => {}
        }
    }

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

    if let Some(scope_info) = scope
        && scope_info.name.as_deref() == Some("ai")
    {
        return ObservationType::Span;
    }

    if attributes.contains_key(GenAiAttributes::TOOL_NAME)
        || attributes.contains_key(GenAiAttributes::TOOL_CALL_ID)
    {
        return ObservationType::Tool;
    }

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
        assert_eq!(ObservationType::Guardrail.as_str(), "GUARDRAIL");
    }

    #[test]
    fn test_chain_detection() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "chain")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Chain);
    }

    #[test]
    fn test_retriever_detection() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "retriever")]);
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
        let attrs = make_attributes(vec![("gen_ai.operation.name", "guardrail")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Guardrail);
    }

    #[test]
    fn test_openinference_chain() {
        let attrs = make_attributes(vec![("openinference.span.kind", "CHAIN")]);
        let resource_attrs = HashMap::new();

        let result = map_to_observation_type(&attrs, &resource_attrs, None);
        assert_eq!(result, ObservationType::Chain);
    }
}
