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
/// Maps to OTEL semantic conventions where available, uses llm.* namespace for custom fields
pub struct O2Attributes;

impl O2Attributes {
    // ===== Standard OTEL Gen-AI Attributes =====

    /// Name of the LLM model used (OTEL: gen_ai.response.model)
    pub const MODEL_NAME: &'static str = "gen_ai.response.model";

    /// Name of the LLM provider (OTEL: gen_ai.system)
    pub const PROVIDER_NAME: &'static str = "gen_ai.system";

    /// Name of the prompt template used (OTEL: gen_ai.prompt.name)
    pub const PROMPT_NAME: &'static str = "gen_ai.prompt.name";

    /// Name of the tool being called (OTEL: gen_ai.tool.name)
    pub const TOOL_NAME: &'static str = "gen_ai.tool.name";

    /// Identifier for the tool call (OTEL: gen_ai.tool.call.id)
    pub const TOOL_CALL_ID: &'static str = "gen_ai.tool.call.id";

    /// Arguments passed to the tool call (OTEL: gen_ai.tool.call.arguments)
    pub const TOOL_CALL_ARGUMENTS: &'static str = "gen_ai.tool.call.arguments";

    /// Result returned from the tool call (OTEL: gen_ai.tool.call.result)
    pub const TOOL_CALL_RESULT: &'static str = "gen_ai.tool.call.result";

    /// User identifier (OTEL: user.id)
    pub const USER_ID: &'static str = "user.id";

    /// Session identifier (OTEL: session.id)
    pub const SESSION_ID: &'static str = "session.id";

    // ===== Custom LLM Namespace Attributes =====

    /// Type of LLM observation (Custom: llm.observation.type)
    /// Values: "generation", "chat", "embedding", "tool", "chain", "agent", etc.
    pub const OBSERVATION_TYPE: &'static str = "llm.observation.type";

    /// Simplified input text (Custom: llm.input)
    /// Condensed from gen_ai.input.messages for easier UI display
    pub const INPUT: &'static str = "llm.input";

    /// Simplified output text (Custom: llm.output)
    /// Condensed from gen_ai.output.messages for easier UI display
    pub const OUTPUT: &'static str = "llm.output";

    /// Model parameters as JSON (Custom: llm.request.parameters)
    /// Aggregates individual gen_ai.request.* parameters for convenience
    pub const MODEL_PARAMETERS: &'static str = "llm.request.parameters";

    /// Token usage as JSON (Custom: llm.usage.tokens)
    /// Contains: {input, output, total}
    pub const USAGE_DETAILS: &'static str = "llm.usage.tokens";

    /// Cost breakdown as JSON (Custom: llm.usage.cost)
    /// Contains: {input, output, total}
    pub const COST_DETAILS: &'static str = "llm.usage.cost";

    /// Completion start time in microseconds (Custom: llm.completion.start_time)
    /// Used to calculate TTFT (Time To First Token)
    pub const COMPLETION_START_TIME: &'static str = "llm.completion.start_time";

    // ===== Evaluation Attributes (Already OTEL-Compliant) =====

    /// Aggregate quality score from evaluation (OTEL: llm.evaluation.quality_score)
    pub const EVALUATION_QUALITY: &'static str = "llm.evaluation.quality_score";

    /// Relevance evaluation score (OTEL: llm.evaluation.relevance)
    pub const EVALUATION_RELEVANCE: &'static str = "llm.evaluation.relevance";

    /// Completeness evaluation score (OTEL: llm.evaluation.completeness)
    pub const EVALUATION_COMPLETENESS: &'static str = "llm.evaluation.completeness";

    /// Tool effectiveness evaluation score (OTEL: llm.evaluation.tool_effectiveness)
    pub const EVALUATION_TOOL_EFFECTIVENESS: &'static str = "llm.evaluation.tool_effectiveness";

    /// Groundedness/faithfulness evaluation score (OTEL: llm.evaluation.groundedness)
    pub const EVALUATION_GROUNDEDNESS: &'static str = "llm.evaluation.groundedness";

    /// Safety evaluation score (OTEL: llm.evaluation.safety)
    pub const EVALUATION_SAFETY: &'static str = "llm.evaluation.safety";

    /// Evaluation duration in milliseconds (OTEL: llm.evaluation.duration_ms)
    pub const EVALUATION_DURATION_MS: &'static str = "llm.evaluation.duration_ms";

    /// Per-evaluator reasoning/commentary (OTEL: llm.evaluation.commentary)
    pub const EVALUATION_COMMENTARY: &'static str = "llm.evaluation.commentary";

    /// Evaluator name (OTEL: llm.evaluator.name)
    pub const EVALUATOR_NAME: &'static str = "llm.evaluator.name";

    /// Evaluator version (OTEL: llm.evaluator.version)
    pub const EVALUATOR_VERSION: &'static str = "llm.evaluator.version";

    /// Evaluator type: "human", "model", or "deterministic" (OTEL: llm.evaluator.type)
    pub const EVALUATOR_TYPE: &'static str = "llm.evaluator.type";
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

    // Gen-AI Response
    pub const RESPONSE_MODEL: &'static str = "gen_ai.response.model";
    pub const RESPONSE_FINISH_REASONS: &'static str = "gen_ai.response.finish_reasons";

    // Gen-AI Prompt
    pub const PROMPT_NAME: &'static str = "gen_ai.prompt.name";

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

    // Gen-AI Provider
    pub const PROVIDER_NAME: &'static str = "gen_ai.provider.name";
}

pub struct LLMAttributes;

impl LLMAttributes {
    pub const REQUEST_TYPE: &'static str = "llm.request.type";
    pub const USAGE_TOTAL_TOKENS: &'static str = "llm.usage.total_tokens";
}

/// Standard OpenTelemetry Attributes
pub struct OtelAttributes;

impl OtelAttributes {
    // User and Session
    pub const USER_ID: &'static str = "user.id";
    pub const SESSION_ID: &'static str = "session.id";
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
    pub const PROMPT_TOOL_CHOICE: &'static str = "ai.prompt.toolChoice";

    // AI Tool Call
    pub const TOOL_CALL_ARGS: &'static str = "ai.toolCall.args";
    pub const TOOL_CALL_RESULT: &'static str = "ai.toolCall.result";

    // AI Response
    pub const RESPONSE_TEXT: &'static str = "ai.response.text";
    pub const RESPONSE_OBJECT: &'static str = "ai.response.object";
    pub const RESPONSE_TOOL_CALLS: &'static str = "ai.response.toolCalls";

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

    // AI Telemetry Metadata
    pub const TELEMETRY_METADATA_USER_ID: &'static str = "ai.telemetry.metadata.userId";
    pub const TELEMETRY_METADATA_SESSION_ID: &'static str = "ai.telemetry.metadata.sessionId";
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

/// Langfuse Attributes
/// Note: LangFuse uses dots in attribute names (e.g., "langfuse.observation.input")
/// but OpenObserve may convert dots to underscores during ingestion.
/// We support both formats for compatibility.
pub struct LangfuseAttributes;

impl LangfuseAttributes {
    // Observation Type
    pub const TYPE: &'static str = "langfuse.observation.type";

    // Input/Output
    pub const INPUT: &'static str = "langfuse.observation.input";
    pub const OUTPUT: &'static str = "langfuse.observation.output";

    // Model
    pub const MODEL: &'static str = "langfuse.observation.model.name";

    // Model Parameters
    pub const MODEL_PARAMETERS: &'static str = "langfuse.observation.model.parameters";

    // Usage Details
    pub const USAGE_DETAILS: &'static str = "langfuse.observation.usage_details";

    // Cost Details
    pub const COST_DETAILS: &'static str = "langfuse.observation.cost_details";

    // Prompt Name
    pub const PROMPT_NAME: &'static str = "langfuse.observation.prompt.name";

    // Metadata (contains tool info and other metadata)
    pub const METADATA: &'static str = "langfuse.observation.metadata";

    // Custom tool metadata attributes (not in official spec but seen in user data)
    pub const METADATA_TOOL_NAME: &'static str = "langfuse.observation.metadata.tool.name";
    pub const METADATA_TOOL_ID: &'static str = "langfuse.observation.metadata.tool.id";

    // Session ID metadata attributes
    pub const METADATA_LANGFUSE_SESSION_ID: &'static str =
        "langfuse.observation.metadata.langfuse_session_id";
    pub const METADATA_SESSION_ID: &'static str = "langfuse.observation.metadata.session_id";

    // Source metadata attribute
    pub const METADATA_SOURCE: &'static str = "langfuse.observation.metadata.source";

    // Provider metadata attribute
    pub const METADATA_LS_PROVIDER: &'static str = "langfuse.observation.metadata.ls_provider";

    // Completion start time (ISO 8601 format)
    // Note: Uses underscore format since dots are converted to underscores during ingestion
    pub const COMPLETION_START_TIME: &'static str = "langfuse.observation.completion_start_time";
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
    pub const TRACELOOP_SPAN_KIND: &'static str = "traceloop.span.kind";

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
}

/// LLM Evaluation Attributes (emitted by evaluation frameworks)
pub struct EvaluationAttributes;

impl EvaluationAttributes {
    // Aggregate quality score
    pub const QUALITY_SCORE: &'static str = "llm.evaluation.quality_score";
    pub const DURATION_MS: &'static str = "llm.evaluation.duration_ms";

    // Per-evaluator scores
    pub const RELEVANCE: &'static str = "llm.evaluation.relevance";
    pub const COMPLETENESS: &'static str = "llm.evaluation.completeness";
    pub const TOOL_EFFECTIVENESS: &'static str = "llm.evaluation.tool_effectiveness";
    pub const GROUNDEDNESS: &'static str = "llm.evaluation.groundedness";
    pub const SAFETY: &'static str = "llm.evaluation.safety";

    // Commentary (aggregated reasoning from evaluators)
    pub const COMMENTARY: &'static str = "llm.evaluation.commentary";

    // Evaluator metadata
    pub const EVALUATOR_NAME: &'static str = "llm.evaluator.name";
    pub const EVALUATOR_VERSION: &'static str = "llm.evaluator.version";
    pub const EVALUATOR_TYPE: &'static str = "llm.evaluator.type";

    // Design-doc specified fields (alternative attribute names)
    pub const EVAL_RELEVANCE: &'static str = "evaluation_relevance";
    pub const EVAL_COMPLETENESS: &'static str = "evaluation_completeness";
    pub const EVAL_TOOL_EFFECTIVENESS: &'static str = "evaluation_tool_effectiveness";
    pub const EVAL_GROUNDEDNESS: &'static str = "evaluation_groundedness";
    pub const EVAL_SAFETY: &'static str = "evaluation_safety";
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
    fn test_llm_otel_compliant_attributes() {
        // Standard OTEL Gen-AI attributes
        assert_eq!(O2Attributes::MODEL_NAME, "gen_ai.response.model");
        assert_eq!(O2Attributes::PROVIDER_NAME, "gen_ai.system");
        assert_eq!(O2Attributes::PROMPT_NAME, "gen_ai.prompt.name");
        assert_eq!(O2Attributes::TOOL_NAME, "gen_ai.tool.name");
        assert_eq!(O2Attributes::TOOL_CALL_ID, "gen_ai.tool.call.id");
        assert_eq!(O2Attributes::TOOL_CALL_ARGUMENTS, "gen_ai.tool.call.arguments");
        assert_eq!(O2Attributes::TOOL_CALL_RESULT, "gen_ai.tool.call.result");
        assert_eq!(O2Attributes::USER_ID, "user.id");
        assert_eq!(O2Attributes::SESSION_ID, "session.id");

        // Custom llm.* namespace attributes
        assert_eq!(O2Attributes::OBSERVATION_TYPE, "llm.observation.type");
        assert_eq!(O2Attributes::INPUT, "llm.input");
        assert_eq!(O2Attributes::OUTPUT, "llm.output");
        assert_eq!(O2Attributes::MODEL_PARAMETERS, "llm.request.parameters");
        assert_eq!(O2Attributes::USAGE_DETAILS, "llm.usage.tokens");
        assert_eq!(O2Attributes::COST_DETAILS, "llm.usage.cost");
        assert_eq!(O2Attributes::COMPLETION_START_TIME, "llm.completion.start_time");

        // Evaluation attributes (OTEL-compliant llm.evaluation.* namespace)
        assert_eq!(O2Attributes::EVALUATION_QUALITY, "llm.evaluation.quality_score");
        assert_eq!(O2Attributes::EVALUATION_RELEVANCE, "llm.evaluation.relevance");
        assert_eq!(O2Attributes::EVALUATION_COMPLETENESS, "llm.evaluation.completeness");
        assert_eq!(O2Attributes::EVALUATION_TOOL_EFFECTIVENESS, "llm.evaluation.tool_effectiveness");
        assert_eq!(O2Attributes::EVALUATION_GROUNDEDNESS, "llm.evaluation.groundedness");
        assert_eq!(O2Attributes::EVALUATION_SAFETY, "llm.evaluation.safety");
        assert_eq!(O2Attributes::EVALUATION_DURATION_MS, "llm.evaluation.duration_ms");
        assert_eq!(O2Attributes::EVALUATION_COMMENTARY, "llm.evaluation.commentary");
        assert_eq!(O2Attributes::EVALUATOR_NAME, "llm.evaluator.name");
        assert_eq!(O2Attributes::EVALUATOR_VERSION, "llm.evaluator.version");
        assert_eq!(O2Attributes::EVALUATOR_TYPE, "llm.evaluator.type");
    }
}
