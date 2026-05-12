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

//! Gen AI Operation Mapper
//!
//! Maps OTEL spans to OTEL Gen-AI semantic convention `gen_ai.operation.name` values.
//! Well-known spec values are used where they apply; custom values are used for
//! operations that have no OTEL equivalent (chain, task, evaluator, rerank, guardrail,
//! span, event).

use std::collections::HashMap;

use config::utils::json;

use crate::service::traces::otel::attributes::{
    FrameworkAttributes, GenAiAttributes, LLMAttributes, LangfuseAttributes,
    OpenInferenceAttributes, VercelAiSdkAttributes,
};

/// Scope information for mapping
pub struct ScopeInfo {
    pub name: Option<String>,
}

const KNOWN_GEN_AI_OPERATION_NAME_VALUES: &[&str] = &[
    "chat",
    "text_completion",
    "generate_content",
    "embeddings",
    "invoke_agent",
    "create_agent",
    "execute_tool",
    "invoke_workflow",
    "retrieval",
];

/// Map span attributes to a `gen_ai.operation.name` value using a priority-based system.
///
/// Returns an OTEL Gen-AI semantic convention well-known value if one applies,
/// otherwise returns a custom lowercase value.
///
/// OTEL well-known values:
///   chat, text_completion, generate_content, embeddings,
///   invoke_agent, create_agent, execute_tool, invoke_workflow, retrieval
pub fn map_to_gen_ai_operation_name(
    attributes: &HashMap<String, json::Value>,
    _resource_attributes: &HashMap<String, json::Value>,
    scope: Option<&ScopeInfo>,
) -> &'static str {
    // Priority 1: gen_ai.operation.name — pass through spec values directly
    if let Some(operation) = attributes
        .get(GenAiAttributes::OPERATION_NAME)
        .and_then(|v| v.as_str())
    {
        let lowered = operation.to_lowercase();
        if let Some(wk) = KNOWN_GEN_AI_OPERATION_NAME_VALUES
            .iter()
            .find(|&&v| v == lowered)
        {
            return wk;
        }
    }

    // Priority 2: llm.request.type (OpenLLMetry)
    if let Some(request_type) = attributes
        .get(LLMAttributes::REQUEST_TYPE)
        .and_then(|v| v.as_str())
    {
        match request_type.to_lowercase().as_str() {
            "chat" => return "chat",
            "completion" => return "text_completion",
            "embedding" => return "embeddings",
            "rerank" => return "rerank",
            "unknown" => {} // Fall through
            _ => {}
        }
    }

    // Priority 3: traceloop.span.kind
    if let Some(span_kind) = attributes
        .get(FrameworkAttributes::TRACELOOP_SPAN_KIND)
        .and_then(|v| v.as_str())
    {
        match span_kind.to_lowercase().as_str() {
            "workflow" => return "invoke_workflow",
            "task" => return "task",
            "agent" => return "invoke_agent",
            "tool" => return "execute_tool",
            _ => {}
        }
    }

    // Priority 4: openinference.span.kind
    if let Some(span_kind) = attributes
        .get(OpenInferenceAttributes::SPAN_KIND)
        .and_then(|v| v.as_str())
    {
        match span_kind.to_uppercase().as_str() {
            "LLM" => return "chat",
            "CHAIN" => return "chain",
            "EMBEDDING" => return "embeddings",
            "AGENT" => return "invoke_agent",
            "TOOL" => return "execute_tool",
            "RETRIEVER" => return "retrieval",
            "EVALUATOR" => return "evaluator",
            "GUARDRAIL" => return "guardrail",
            _ => {}
        }
    }

    // Priority 5: langfuse.observation.type
    if let Some(span_kind) = attributes
        .get(LangfuseAttributes::TYPE)
        .and_then(|v| v.as_str())
    {
        match span_kind.to_uppercase().as_str() {
            "GENERATION" => return "chat",
            "CHAIN" => return "chain",
            "EMBEDDING" => return "embeddings",
            "AGENT" => return "invoke_agent",
            "TOOL" => return "execute_tool",
            "SPAN" => return "span",
            "RETRIEVER" => return "retrieval",
            _ => {}
        }
    }

    // Priority 6: Vercel AI SDK
    if let Some(scope_info) = scope
        && scope_info.name.as_deref() == Some("ai")
        && (attributes.contains_key(VercelAiSdkAttributes::MODEL_ID)
            || attributes.contains_key(GenAiAttributes::REQUEST_MODEL)
            || attributes.contains_key(GenAiAttributes::RESPONSE_MODEL))
    {
        return "chat";
    }

    // "ai" scope with no model → span
    if let Some(scope_info) = scope
        && scope_info.name.as_deref() == Some("ai")
    {
        return "span";
    }

    // Priority 7: gen_ai.tool.name or gen_ai.tool.call.id
    if attributes.contains_key(GenAiAttributes::TOOL_NAME)
        || attributes.contains_key(GenAiAttributes::TOOL_CALL_ID)
    {
        return "execute_tool";
    }

    // Priority 8: model key fallback
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
            return "chat";
        }
    }

    // Default
    "span"
}

/// Detect if a span is an LLM trace based on attributes and scope.
/// This function checks only a few key attributes FIRST to quickly identify LLM traces
/// and avoid unnecessary processing overhead for non-LLM traces.
pub fn is_llm_trace(attributes: &HashMap<String, json::Value>, scope_name: Option<&str>) -> bool {
    // Fast path: Check the most common LLM indicators first

    // 1. Gen-AI operation name
    if attributes.contains_key(GenAiAttributes::OPERATION_NAME)
        || attributes.contains_key(GenAiAttributes::REQUEST_MODEL)
        || attributes.contains_key(GenAiAttributes::INPUT_MESSAGES)
    {
        return true;
    }

    // 2. LLM request type
    if attributes.contains_key(LLMAttributes::REQUEST_TYPE) {
        return true;
    }

    // 3. Vercel AI SDK model id
    if attributes.contains_key(VercelAiSdkAttributes::MODEL_ID)
        || attributes.contains_key(VercelAiSdkAttributes::PROMPT)
        || attributes.contains_key(VercelAiSdkAttributes::PROMPT_MESSAGES)
    {
        return true;
    }

    // 4. OpenInference LLM model name
    if attributes.contains_key(OpenInferenceAttributes::LLM_MODEL_NAME) {
        return true;
    }

    // 5. Langfuse model name
    if attributes.contains_key(LangfuseAttributes::TYPE) {
        return true;
    }

    // 6. Most common model attributes (very common in LLM traces)
    if attributes.contains_key(FrameworkAttributes::GCP_VERTEX_AGENT_LLM_REQUEST)
        || attributes.contains_key(FrameworkAttributes::LOGFIRE_PROMPT)
        || attributes.contains_key(FrameworkAttributes::MLFLOW_SPAN_INPUTS)
        || attributes.contains_key(FrameworkAttributes::TRACELOOP_SPAN_KIND)
        || attributes.contains_key(FrameworkAttributes::INPUT)
        || attributes.contains_key(FrameworkAttributes::INPUT_VALUE)
    {
        return true;
    }

    // 7. Scope name check
    if scope_name == Some("ai") {
        return true;
    }

    false
}

/// Check if a gen_ai.operation.name value represents a generation (chat/completion)
/// or embedding operation — used to decide whether to auto-count input/output tokens.
pub fn is_generation_or_embedding(op_name: &str) -> bool {
    matches!(
        op_name,
        "chat" | "text_completion" | "generate_content" | "embeddings"
    )
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

    // ---- gen_ai.operation.name pass-through ----

    #[test]
    fn test_gen_ai_operation_chat() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "chat")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "chat"
        );
    }

    #[test]
    fn test_gen_ai_operation_embeddings() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "embeddings")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "embeddings"
        );
    }

    #[test]
    fn test_gen_ai_operation_text_completion() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "text_completion")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "text_completion"
        );
    }

    #[test]
    fn test_gen_ai_operation_generate_content() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "generate_content")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "generate_content"
        );
    }

    #[test]
    fn test_gen_ai_operation_invoke_agent() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "invoke_agent")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "invoke_agent"
        );
    }

    #[test]
    fn test_gen_ai_operation_create_agent() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "create_agent")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "create_agent"
        );
    }

    #[test]
    fn test_gen_ai_operation_execute_tool() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "execute_tool")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "execute_tool"
        );
    }

    #[test]
    fn test_gen_ai_operation_invoke_workflow() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "invoke_workflow")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "invoke_workflow"
        );
    }

    #[test]
    fn test_gen_ai_operation_retrieval() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "retrieval")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "retrieval"
        );
    }

    // ---- llm.request.type ----

    #[test]
    fn test_llm_request_type_chat() {
        let attrs = make_attributes(vec![("llm.request.type", "chat")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "chat"
        );
    }

    #[test]
    fn test_llm_request_type_completion() {
        let attrs = make_attributes(vec![("llm.request.type", "completion")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "text_completion"
        );
    }

    #[test]
    fn test_llm_request_type_embedding() {
        let attrs = make_attributes(vec![("llm.request.type", "embedding")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "embeddings"
        );
    }

    #[test]
    fn test_llm_request_type_rerank() {
        let attrs = make_attributes(vec![("llm.request.type", "rerank")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "rerank"
        );
    }

    // ---- traceloop.span.kind ----

    #[test]
    fn test_traceloop_span_kind_workflow() {
        let attrs = make_attributes(vec![("traceloop.span.kind", "workflow")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "invoke_workflow");
    }

    #[test]
    fn test_traceloop_span_kind_task() {
        let attrs = make_attributes(vec![("traceloop.span.kind", "task")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "task");
    }

    #[test]
    fn test_traceloop_span_kind_agent() {
        let attrs = make_attributes(vec![("traceloop.span.kind", "agent")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "invoke_agent");
    }

    #[test]
    fn test_traceloop_span_kind_tool() {
        let attrs = make_attributes(vec![("traceloop.span.kind", "tool")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "execute_tool");
    }

    // ---- openinference.span.kind ----

    #[test]
    fn test_openinference_llm() {
        let attrs = make_attributes(vec![("openinference.span.kind", "LLM")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "chat"
        );
    }

    #[test]
    fn test_openinference_chain() {
        let attrs = make_attributes(vec![("openinference.span.kind", "CHAIN")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "chain"
        );
    }

    #[test]
    fn test_openinference_retriever() {
        let attrs = make_attributes(vec![("openinference.span.kind", "RETRIEVER")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "retrieval"
        );
    }

    #[test]
    fn test_openinference_evaluator() {
        let attrs = make_attributes(vec![("openinference.span.kind", "EVALUATOR")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "evaluator"
        );
    }

    #[test]
    fn test_openinference_guardrail() {
        let attrs = make_attributes(vec![("openinference.span.kind", "GUARDRAIL")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "guardrail"
        );
    }

    // ---- langfuse.observation.type ----

    #[test]
    fn test_langfuse_type_generation() {
        let attrs = make_attributes(vec![("langfuse.observation.type", "GENERATION")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "chat");
    }

    #[test]
    fn test_langfuse_type_span() {
        let attrs = make_attributes(vec![("langfuse.observation.type", "SPAN")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "span");
    }

    #[test]
    fn test_langfuse_type_chain() {
        let attrs = make_attributes(vec![("langfuse.observation.type", "CHAIN")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "chain");
    }

    #[test]
    fn test_langfuse_type_retriever() {
        let attrs = make_attributes(vec![("langfuse.observation.type", "RETRIEVER")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "retrieval");
    }

    #[test]
    fn test_langfuse_type_embedding() {
        let attrs = make_attributes(vec![("langfuse.observation.type", "EMBEDDING")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "embeddings");
    }

    #[test]
    fn test_langfuse_type_tool() {
        let attrs = make_attributes(vec![("langfuse.observation.type", "TOOL")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "execute_tool");
    }

    #[test]
    fn test_langfuse_type_agent() {
        let attrs = make_attributes(vec![("langfuse.observation.type", "AGENT")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "invoke_agent");
    }

    // ---- gen_ai.tool detection ----

    #[test]
    fn test_gen_ai_tool_detection() {
        let attrs = make_attributes(vec![("gen_ai.tool.name", "search_database")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "execute_tool"
        );
    }

    #[test]
    fn test_gen_ai_tool_call_id_detection() {
        let attrs = make_attributes(vec![("gen_ai.tool.call.id", "call_abc")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "execute_tool");
    }

    // ---- model-based fallback ----

    #[test]
    fn test_model_based_fallback() {
        let attrs = make_attributes(vec![("gen_ai.request.model", "gpt-4")]);
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "chat"
        );
    }

    #[test]
    fn test_model_key_fallback_response_model() {
        let attrs = make_attributes(vec![("gen_ai.response.model", "gpt-4")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "chat");
    }

    #[test]
    fn test_model_key_fallback_openinference_llm_model_name() {
        let attrs = make_attributes(vec![("llm.model_name", "llama3")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "chat");
    }

    #[test]
    fn test_model_key_fallback_openinference_llm_response_model() {
        let attrs = make_attributes(vec![("llm.response.model", "llama2")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "chat");
    }

    #[test]
    fn test_model_key_fallback_vercel_model_id_no_scope() {
        let attrs = make_attributes(vec![("ai.model.id", "claude-3")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "chat");
    }

    #[test]
    fn test_model_key_fallback_plain_model() {
        let attrs = make_attributes(vec![("model", "gpt-3.5")]);
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "chat");
    }

    // ---- Vercel AI SDK ----

    #[test]
    fn test_vercel_ai_sdk_with_model() {
        let attrs = make_attributes(vec![("ai.model.id", "gpt-4")]);
        let resource_attrs = HashMap::new();
        let scope = Some(ScopeInfo {
            name: Some("ai".to_string()),
        });
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, scope.as_ref()),
            "chat"
        );
    }

    #[test]
    fn test_vercel_scope_no_model_returns_span() {
        let attrs = HashMap::new();
        let scope = Some(ScopeInfo {
            name: Some("ai".to_string()),
        });
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), scope.as_ref());
        assert_eq!(result, "span");
    }

    // ---- default ----

    #[test]
    fn test_default_to_span() {
        let attrs = HashMap::new();
        let resource_attrs = HashMap::new();
        assert_eq!(
            map_to_gen_ai_operation_name(&attrs, &resource_attrs, None),
            "span"
        );
    }

    // ---- fallthrough ----

    #[test]
    fn test_gen_ai_operation_unknown_falls_through() {
        let mut attrs = make_attributes(vec![("gen_ai.operation.name", "unknown_op")]);
        attrs.insert("gen_ai.tool.name".to_string(), json::json!("my_tool"));
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "execute_tool");
    }

    #[test]
    fn test_llm_request_type_unknown_falls_through() {
        let mut attrs = make_attributes(vec![("llm.request.type", "unknown")]);
        attrs.insert("gen_ai.tool.name".to_string(), json::json!("my_tool"));
        let result = map_to_gen_ai_operation_name(&attrs, &HashMap::new(), None);
        assert_eq!(result, "execute_tool");
    }

    // ---- is_generation_or_embedding ----

    #[test]
    fn test_is_gen_embedding_chat() {
        assert!(is_generation_or_embedding("chat"));
    }

    #[test]
    fn test_is_gen_embedding_text_completion() {
        assert!(is_generation_or_embedding("text_completion"));
    }

    #[test]
    fn test_is_gen_embedding_generate_content() {
        assert!(is_generation_or_embedding("generate_content"));
    }

    #[test]
    fn test_is_gen_embedding_embeddings() {
        assert!(is_generation_or_embedding("embeddings"));
    }

    #[test]
    fn test_is_gen_embedding_not_tool() {
        assert!(!is_generation_or_embedding("execute_tool"));
    }

    #[test]
    fn test_is_gen_embedding_not_agent() {
        assert!(!is_generation_or_embedding("invoke_agent"));
    }

    // ---- is_llm_trace ----

    #[test]
    fn test_is_llm_trace_gen_ai_operation() {
        let attrs = make_attributes(vec![("gen_ai.operation.name", "chat")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_llm_request_type() {
        let attrs = make_attributes(vec![("llm.request.type", "completion")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_model_attribute() {
        let attrs = make_attributes(vec![("gen_ai.request.model", "gpt-4")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_vercel_ai_sdk() {
        let attrs = make_attributes(vec![("ai.model.id", "gpt-4")]);
        assert!(is_llm_trace(&attrs, Some("ai")));
    }

    #[test]
    fn test_is_llm_trace_gen_ai_events() {
        let attrs = HashMap::new();
        assert!(!is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_input_output_attributes() {
        let attrs = make_attributes(vec![("gen_ai.input.messages", r#"[{"role":"user"}]"#)]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_non_llm() {
        let attrs = make_attributes(vec![("http.method", "GET"), ("http.status_code", "200")]);
        assert!(!is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_scope_ai_no_attrs() {
        let attrs = HashMap::new();
        assert!(is_llm_trace(&attrs, Some("ai")));
    }

    #[test]
    fn test_is_llm_trace_langfuse_type() {
        let attrs = make_attributes(vec![("langfuse.observation.type", "GENERATION")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_traceloop_span_kind() {
        let attrs = make_attributes(vec![("traceloop.span.kind", "llm")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_vercel_ai_model_id_no_scope() {
        let attrs = make_attributes(vec![("ai.model.id", "gpt-4")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_vercel_prompt() {
        let attrs = make_attributes(vec![("ai.prompt", "hello world")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_vercel_prompt_messages() {
        let attrs = make_attributes(vec![("ai.prompt.messages", "[{\"role\":\"user\"}]")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_openinference_llm_model_name() {
        let attrs = make_attributes(vec![("llm.model_name", "llama3")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_gcp_vertex() {
        let attrs = make_attributes(vec![("gcp.vertex.agent.llm_request", "{}")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_logfire_prompt() {
        let attrs = make_attributes(vec![("prompt", "some prompt text")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_mlflow_span_inputs() {
        let attrs = make_attributes(vec![("mlflow.spanInputs", "{\"question\": \"test\"}")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_framework_input() {
        let attrs = make_attributes(vec![("input", "some text")]);
        assert!(is_llm_trace(&attrs, None));
    }

    #[test]
    fn test_is_llm_trace_framework_input_value() {
        let attrs = make_attributes(vec![("input.value", "some text")]);
        assert!(is_llm_trace(&attrs, None));
    }
}
