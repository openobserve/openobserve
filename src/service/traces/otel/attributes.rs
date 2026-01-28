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

/// OpenObserve LLM Attributes
pub struct O2Attributes;

impl O2Attributes {
    /// Type of LLM observation (e.g., "generation", "chat", "embedding")
    pub const OBSERVATION_TYPE: &'static str = "_o2_observation_type";

    /// Name of the LLM model used
    pub const MODEL_NAME: &'static str = "_o2_model_name";

    /// Input to the LLM (prompts, messages, tool arguments)
    pub const INPUT: &'static str = "_o2_input";

    /// Output from the LLM (responses, completions, tool results)
    pub const OUTPUT: &'static str = "_o2_output";

    /// Model parameters used (temperature, max_tokens, etc.)
    pub const MODEL_PARAMETERS: &'static str = "_o2_model_parameters";

    /// Token usage details (input, output, total counts)
    pub const USAGE_DETAILS: &'static str = "_o2_usage_details";

    /// Cost details for the LLM call
    pub const COST_DETAILS: &'static str = "_o2_cost_details";

    /// User identifier
    pub const USER_ID: &'static str = "_o2_user_id";

    /// Session identifier
    pub const SESSION_ID: &'static str = "_o2_session_id";

    /// Name of the prompt template used
    pub const PROMPT_NAME: &'static str = "_o2_prompt_name";

    /// Version of the prompt template
    pub const PROMPT_VERSION: &'static str = "_o2_prompt_version";
}

/// Standard OpenTelemetry Gen-AI Semantic Conventions
pub struct GenAiAttributes;

impl GenAiAttributes {
    // Gen-AI Operation
    pub const OPERATION_NAME: &'static str = "gen_ai.operation.name";

    // Gen-AI Request
    pub const REQUEST_MODEL: &'static str = "gen_ai.request.model";
    pub const REQUEST_MAX_TOKENS: &'static str = "gen_ai.request.max_tokens";
    pub const REQUEST_TEMPERATURE: &'static str = "gen_ai.request.temperature";
    pub const REQUEST_TOP_P: &'static str = "gen_ai.request.top_p";
    pub const REQUEST_FREQUENCY_PENALTY: &'static str = "gen_ai.request.frequency_penalty";
    pub const REQUEST_PRESENCE_PENALTY: &'static str = "gen_ai.request.presence_penalty";

    // Gen-AI Response
    pub const RESPONSE_MODEL: &'static str = "gen_ai.response.model";
    pub const RESPONSE_FINISH_REASONS: &'static str = "gen_ai.response.finish_reasons";

    // Gen-AI Input/Output
    pub const INPUT_MESSAGES: &'static str = "gen_ai.input.messages";
    pub const OUTPUT_MESSAGES: &'static str = "gen_ai.output.messages";

    // Gen-AI Tool
    pub const TOOL_NAME: &'static str = "gen_ai.tool.name";
    pub const TOOL_CALL_ID: &'static str = "gen_ai.tool.call.id";
    pub const TOOL_CALL_ARGUMENTS: &'static str = "gen_ai.tool.call.arguments";
    pub const TOOL_CALL_RESULT: &'static str = "gen_ai.tool.call.result";

    // Gen-AI Usage
    pub const USAGE_INPUT_TOKENS: &'static str = "gen_ai.usage.input_tokens";
    pub const USAGE_OUTPUT_TOKENS: &'static str = "gen_ai.usage.output_tokens";
    pub const USAGE_TOTAL_TOKENS: &'static str = "gen_ai.usage.total_tokens";
    pub const USAGE_PROMPT_TOKENS: &'static str = "gen_ai.usage.prompt_tokens";
    pub const USAGE_COMPLETION_TOKENS: &'static str = "gen_ai.usage.completion_tokens";
    pub const USAGE_CACHE_READ_TOKENS: &'static str = "gen_ai.usage.cache_read_tokens";
    pub const USAGE_CACHE_WRITE_TOKENS: &'static str = "gen_ai.usage.cache_write_tokens";
    pub const USAGE_COST: &'static str = "gen_ai.usage.cost";

    // Gen-AI Conversation
    pub const CONVERSATION_ID: &'static str = "gen_ai.conversation.id";

    // Gen-AI System
    pub const SYSTEM: &'static str = "gen_ai.system";
}

pub struct LLMAttributes;

impl LLMAttributes {
    pub const REQUEST_TYPE: &'static str = "llm.request.type";
    pub const USAGE_TOTAL_TOKENS: &'static str = "llm.usage.total_tokens";
    pub const USER: &'static str = "llm.user";
}

/// Standard OpenTelemetry Attributes
pub struct OtelAttributes;

impl OtelAttributes {
    // User and Session
    pub const USER_ID: &'static str = "user.id";
    pub const SESSION_ID: &'static str = "session.id";

    // Service
    pub const SERVICE_NAME: &'static str = "service.name";
    pub const SERVICE_VERSION: &'static str = "service.version";

    // Telemetry SDK
    pub const TELEMETRY_SDK_LANGUAGE: &'static str = "telemetry.sdk.language";
    pub const TELEMETRY_SDK_NAME: &'static str = "telemetry.sdk.name";
    pub const TELEMETRY_SDK_VERSION: &'static str = "telemetry.sdk.version";
}

/// Vercel AI SDK Attributes
pub struct VercelAiSdkAttributes;

impl VercelAiSdkAttributes {
    // AI Model
    pub const MODEL_ID: &'static str = "ai.model.id";
    pub const MODEL_PROVIDER: &'static str = "ai.model.provider";

    // AI Prompt
    pub const PROMPT_MESSAGES: &'static str = "ai.prompt.messages";
    pub const PROMPT: &'static str = "ai.prompt";
    pub const PROMPT_TOOLS: &'static str = "ai.prompt.tools";
    pub const PROMPT_TOOL_CHOICE: &'static str = "ai.prompt.toolChoice";

    // AI Tool Call
    pub const TOOL_CALL_NAME: &'static str = "ai.toolCall.name";
    pub const TOOL_CALL_ARGS: &'static str = "ai.toolCall.args";
    pub const TOOL_CALL_RESULT: &'static str = "ai.toolCall.result";

    // AI Response
    pub const RESPONSE_TEXT: &'static str = "ai.response.text";
    pub const RESPONSE_OBJECT: &'static str = "ai.response.object";
    pub const RESPONSE_TOOL_CALLS: &'static str = "ai.response.toolCalls";
    pub const RESPONSE_PROVIDER_METADATA: &'static str = "ai.response.providerMetadata";
    pub const RESPONSE_MS_TO_FIRST_CHUNK: &'static str = "ai.response.msToFirstChunk";

    // AI Result (legacy)
    pub const RESULT_TEXT: &'static str = "ai.result.text";
    pub const RESULT_OBJECT: &'static str = "ai.result.object";
    pub const RESULT_TOOL_CALLS: &'static str = "ai.result.toolCalls";

    // AI Settings
    pub const SETTINGS_MAX_STEPS: &'static str = "ai.settings.maxSteps";
    pub const SETTINGS_MAX_RETRIES: &'static str = "ai.settings.maxRetries";
    pub const SETTINGS_MODE: &'static str = "ai.settings.mode";

    // AI Usage
    pub const USAGE_TOKENS: &'static str = "ai.usage.tokens";
    pub const USAGE_CACHED_INPUT_TOKENS: &'static str = "ai.usage.cachedInputTokens";
    pub const USAGE_REASONING_TOKENS: &'static str = "ai.usage.reasoningTokens";

    // AI Telemetry Metadata
    pub const TELEMETRY_METADATA_USER_ID: &'static str = "ai.telemetry.metadata.userId";
    pub const TELEMETRY_METADATA_SESSION_ID: &'static str = "ai.telemetry.metadata.sessionId";
    pub const TELEMETRY_METADATA_TAGS: &'static str = "ai.telemetry.metadata.tags";
    pub const TELEMETRY_FUNCTION_ID: &'static str = "ai.telemetry.functionId";
    pub const OPERATION_ID: &'static str = "ai.operationId";
}

/// OpenInference Attributes
pub struct OpenInferenceAttributes;

impl OpenInferenceAttributes {
    pub const SPAN_KIND: &'static str = "openinference.span.kind";
    pub const LLM_MODEL_NAME: &'static str = "llm.model_name";
    pub const LLM_RESPONSE_MODEL: &'static str = "llm.response.model";
    pub const LLM_TOKEN_COUNT_PROMPT: &'static str = "llm.token_count.prompt";
    pub const LLM_TOKEN_COUNT_COMPLETION: &'static str = "llm.token_count.completion";
    pub const LLM_INVOCATION_PARAMETERS: &'static str = "llm.invocation_parameters";
}

/// Other Framework Attributes
pub struct FrameworkAttributes;

impl FrameworkAttributes {
    // Google Vertex AI Agent
    pub const GCP_VERTEX_AGENT_LLM_REQUEST: &'static str = "gcp.vertex.agent.llm_request";
    pub const GCP_VERTEX_AGENT_LLM_RESPONSE: &'static str = "gcp.vertex.agent.llm_response";
    pub const GCP_VERTEX_AGENT_TOOL_CALL_ARGS: &'static str = "gcp.vertex.agent.tool_call_args";
    pub const GCP_VERTEX_AGENT_TOOL_RESPONSE: &'static str = "gcp.vertex.agent.tool_response";

    // Logfire
    pub const LOGFIRE_MSG: &'static str = "logfire.msg";
    pub const LOGFIRE_PROMPT: &'static str = "prompt";
    pub const LOGFIRE_ALL_MESSAGES_EVENTS: &'static str = "all_messages_events";
    pub const LOGFIRE_EVENTS: &'static str = "events";

    // LiveKit
    pub const LIVEKIT_INPUT_TEXT: &'static str = "lk.input_text";
    pub const LIVEKIT_FUNCTION_TOOL_OUTPUT: &'static str = "lk.function_tool.output";
    pub const LIVEKIT_RESPONSE_TEXT: &'static str = "lk.response.text";

    // MLFlow
    pub const MLFLOW_SPAN_INPUTS: &'static str = "mlflow.spanInputs";
    pub const MLFLOW_SPAN_OUTPUTS: &'static str = "mlflow.spanOutputs";

    // TraceLoop
    pub const TRACELOOP_ENTITY_INPUT: &'static str = "traceloop.entity.input";
    pub const TRACELOOP_ENTITY_OUTPUT: &'static str = "traceloop.entity.output";

    // SmolAgents
    pub const INPUT_VALUE: &'static str = "input.value";
    pub const OUTPUT_VALUE: &'static str = "output.value";

    // Pydantic and Pipecat
    pub const INPUT: &'static str = "input";
    pub const OUTPUT: &'static str = "output";

    // Pydantic-AI
    pub const TOOL_ARGUMENTS: &'static str = "tool_arguments";
    pub const TOOL_RESPONSE: &'static str = "tool_response";
    pub const MODEL_CONFIG: &'static str = "model_config";

    // LlamaIndex
    pub const TAG_TAGS: &'static str = "tag.tags";
}

/// Gen-AI Event Names
pub struct GenAiEventNames;

impl GenAiEventNames {
    pub const SYSTEM_MESSAGE: &'static str = "gen_ai.system.message";
    pub const USER_MESSAGE: &'static str = "gen_ai.user.message";
    pub const ASSISTANT_MESSAGE: &'static str = "gen_ai.assistant.message";
    pub const TOOL_MESSAGE: &'static str = "gen_ai.tool.message";
    pub const CHOICE: &'static str = "gen_ai.choice";
    pub const CONTENT_PROMPT: &'static str = "gen_ai.content.prompt";
    pub const CONTENT_COMPLETION: &'static str = "gen_ai.content.completion";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gen_ai_attributes() {
        assert_eq!(GenAiAttributes::OPERATION_NAME, "gen_ai.operation.name");
        assert_eq!(GenAiAttributes::INPUT_MESSAGES, "gen_ai.input.messages");
    }

    #[test]
    fn test_otel_attributes() {
        assert_eq!(OtelAttributes::USER_ID, "user.id");
        assert_eq!(OtelAttributes::SERVICE_NAME, "service.name");
    }

    #[test]
    fn test_llm_enriched_attributes() {
        assert_eq!(O2Attributes::OBSERVATION_TYPE, "_o2_observation_type");
        assert_eq!(O2Attributes::MODEL_NAME, "_o2_model_name");
        assert_eq!(O2Attributes::INPUT, "_o2_input");
        assert_eq!(O2Attributes::OUTPUT, "_o2_output");
        assert_eq!(O2Attributes::MODEL_PARAMETERS, "_o2_model_parameters");
        assert_eq!(O2Attributes::USAGE_DETAILS, "_o2_usage_details");
        assert_eq!(O2Attributes::COST_DETAILS, "_o2_cost_details");
        assert_eq!(O2Attributes::USER_ID, "_o2_user_id");
        assert_eq!(O2Attributes::SESSION_ID, "_o2_session_id");
        assert_eq!(O2Attributes::PROMPT_NAME, "_o2_prompt_name");
        assert_eq!(O2Attributes::PROMPT_VERSION, "_o2_prompt_version");
    }
}
