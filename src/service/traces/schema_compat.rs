// Copyright 2026 OpenObserve Inc.
//
// Shared LLM trace schema constants. They live in the service layer so query
// planning and HTTP presentation can depend on the same contract without a
// service-to-handler edge.

pub const GEN_AI_SENTINEL_COLUMN: &str = "gen_ai_usage_input_tokens";

pub const REQUIRED_GEN_AI_FIELDS: &[&str] = &[
    "gen_ai_usage_input_tokens",
    "gen_ai_usage_output_tokens",
    "gen_ai_usage_cost",
    "gen_ai_response_model",
];

pub const OPTIONAL_GEN_AI_FIELDS: &[&str] = &[
    "gen_ai_input_messages",
    "gen_ai_output_messages",
    "gen_ai_usage_total_tokens",
    "gen_ai_usage_cache_read_input_tokens",
    "gen_ai_usage_cache_creation_input_tokens",
    "gen_ai_usage_cost_cache_read_input",
    "gen_ai_usage_cost_cache_creation_input",
    "gen_ai_usage_cost_estimated_without_cache",
    "gen_ai_usage_cost_cache_read_savings",
    "gen_ai_usage_cost_net_cache_impact",
];

pub const REQUIRED_LLM_FIELDS: &[&str] = &[
    "llm_usage_tokens_input",
    "llm_usage_tokens_output",
    "llm_usage_cost_total",
    "llm_model_name",
];

pub const OPTIONAL_LLM_FIELDS: &[&str] = &["llm_input", "llm_output", "llm_usage_tokens_total"];
