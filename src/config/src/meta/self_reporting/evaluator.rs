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

//! Online evaluator trace attribute contract.
//!
//! Each evaluator invocation or evaluation activity event is recorded as one
//! internal OTLP span and exported to the org's `_evaluator` traces stream.
//! This lets the normal OTLP LLM processor classify LLM-Judge spans and derive
//! Gen-AI usage/cost fields.
//!
//! **Routing**: evaluator trace IDs are intentionally separate from the target
//! trace IDs. Target trace/span identity is emitted as evaluator metadata.
//!
//! This module is intentionally minimal — it only fixes the stream name and the
//! standard attribute keys so callers, query tooling, and the Quality page agree
//! on the contract.
//!
//! See `LLM_Observability_Phase2_Online_Eval_v1.3_EN.md` §6.2 for the field
//! semantics.

/// System stream name for evaluator traces.
pub const EVALUATOR_STREAM: &str = "_evaluator";

/// Standard span name for an LLM-Judge evaluation.
pub const SPAN_NAME_LLM_JUDGE: &str = "llm_judge.evaluate";

/// Standard span name for a Remote-Scorer evaluation.
pub const SPAN_NAME_REMOTE_SCORER: &str = "remote_scorer.evaluate";

/// Standard span name when scorer type cannot be resolved.
pub const SPAN_NAME_UNKNOWN_SCORER: &str = "unknown_scorer.evaluate";

/// Standard span name when an evaluation candidate is skipped before scorer execution.
pub const SPAN_NAME_SPAN_SKIPPED: &str = "online_eval.span_skipped";

// ---------------------------------------------------------------------------
// Standard attribute keys
//
// Keep these in sync with v1.3 §6.2. New attributes are additive — never rename
// or repurpose existing keys.
// ---------------------------------------------------------------------------

// Identity of the evaluated object
pub const ATTR_TARGET_SPAN_ID: &str = "target_span_id";
pub const ATTR_TARGET_TRACE_ID: &str = "target_trace_id";
pub const ATTR_TARGET_STREAM: &str = "target_stream";

// Identity of the evaluator
pub const ATTR_SCORER_ID: &str = "scorer_id";
pub const ATTR_SCORER_VERSION: &str = "scorer_version";
pub const ATTR_SCORER_TYPE: &str = "scorer_type";
pub const ATTR_JOB_ID: &str = "job_id";
pub const ATTR_SCORE_CONFIG_ID: &str = "score_config_id";
pub const ATTR_SCORE_CONFIG_VERSION: &str = "score_config_version";
pub const ATTR_EVAL_RUN_ID: &str = "eval_run_id";

// Provider context (LLM Judge only)
pub const ATTR_PROVIDER_ID: &str = "provider_id";
pub const ATTR_PROVIDER_NAME: &str = "provider_name";
pub const ATTR_PROVIDER_TYPE: &str = "provider_type";
pub const ATTR_MODEL: &str = "model";

// Telemetry
pub const ATTR_LATENCY_MS: &str = "latency_ms";
pub const ATTR_PROMPT_TOKENS: &str = "prompt_tokens";
pub const ATTR_COMPLETION_TOKENS: &str = "completion_tokens";
pub const ATTR_TOTAL_TOKENS: &str = "total_tokens";
pub const ATTR_SAMPLING_RATE: &str = "sampling_rate";
pub const ATTR_SAMPLED: &str = "sampled";

// Outcome
pub const ATTR_STATUS: &str = "status"; // "success" | "error" | "timeout"
pub const ATTR_ERROR_KIND: &str = "error.kind";
pub const ATTR_ERROR_MESSAGE: &str = "error.message";
pub const ATTR_SKIP_REASON: &str = "skip_reason";

// Optional payload (subject to truncation; off by default for size reasons)
pub const ATTR_PROMPT: &str = "prompt";
pub const ATTR_RESPONSE: &str = "response";

// OTEL Gen-AI source keys emitted on LLM-Judge evaluator spans.
pub const GEN_AI_OPERATION_NAME: &str = "gen_ai.operation.name";
pub const GEN_AI_REQUEST_MODEL: &str = "gen_ai.request.model";
pub const GEN_AI_RESPONSE_MODEL: &str = "gen_ai.response.model";
pub const GEN_AI_PROVIDER_NAME: &str = "gen_ai.provider.name";
pub const GEN_AI_SYSTEM: &str = "gen_ai.system";
pub const GEN_AI_INPUT_MESSAGES: &str = "gen_ai.input.messages";
pub const GEN_AI_OUTPUT_MESSAGES: &str = "gen_ai.output.messages";
pub const GEN_AI_USAGE_INPUT_TOKENS: &str = "gen_ai.usage.input_tokens";
pub const GEN_AI_USAGE_OUTPUT_TOKENS: &str = "gen_ai.usage.output_tokens";
pub const GEN_AI_USAGE_TOTAL_TOKENS: &str = "gen_ai.usage.total_tokens";

/// Status values written to [`ATTR_STATUS`].
pub mod status {
    pub const SUCCESS: &str = "success";
    pub const ERROR: &str = "error";
    pub const TIMEOUT: &str = "timeout";
    pub const SKIPPED: &str = "skipped";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_name_is_underscore_prefixed() {
        assert_eq!(EVALUATOR_STREAM, "_evaluator");
        assert!(EVALUATOR_STREAM.starts_with('_'));
    }

    #[test]
    fn test_span_names_are_unique() {
        assert_ne!(SPAN_NAME_LLM_JUDGE, SPAN_NAME_REMOTE_SCORER);
        assert_ne!(SPAN_NAME_LLM_JUDGE, SPAN_NAME_UNKNOWN_SCORER);
        assert_ne!(SPAN_NAME_REMOTE_SCORER, SPAN_NAME_UNKNOWN_SCORER);
        assert_ne!(SPAN_NAME_SPAN_SKIPPED, SPAN_NAME_LLM_JUDGE);
    }

    #[test]
    fn test_status_values_are_lowercase() {
        for s in [
            status::SUCCESS,
            status::ERROR,
            status::TIMEOUT,
            status::SKIPPED,
        ] {
            assert_eq!(s, s.to_lowercase());
        }
    }

    #[test]
    fn test_attribute_keys_are_snake_case_and_stable() {
        // Sanity check: no whitespace, no uppercase outside the conventional
        // "error.*" dotted keys, lowercase letters/underscores/dots only.
        let attrs = [
            ATTR_TARGET_SPAN_ID,
            ATTR_TARGET_TRACE_ID,
            ATTR_TARGET_STREAM,
            ATTR_SCORER_ID,
            ATTR_SCORER_VERSION,
            ATTR_SCORER_TYPE,
            ATTR_JOB_ID,
            ATTR_SCORE_CONFIG_ID,
            ATTR_SCORE_CONFIG_VERSION,
            ATTR_EVAL_RUN_ID,
            ATTR_PROVIDER_ID,
            ATTR_PROVIDER_NAME,
            ATTR_PROVIDER_TYPE,
            ATTR_MODEL,
            ATTR_LATENCY_MS,
            ATTR_PROMPT_TOKENS,
            ATTR_COMPLETION_TOKENS,
            ATTR_TOTAL_TOKENS,
            ATTR_SAMPLING_RATE,
            ATTR_SAMPLED,
            ATTR_STATUS,
            ATTR_ERROR_KIND,
            ATTR_ERROR_MESSAGE,
            ATTR_SKIP_REASON,
            ATTR_PROMPT,
            ATTR_RESPONSE,
        ];
        for a in attrs {
            assert!(!a.is_empty(), "attribute key cannot be empty");
            assert!(
                !a.contains(' '),
                "attribute key cannot contain whitespace: {a}"
            );
            assert!(
                a.chars()
                    .all(|c| c.is_ascii_lowercase() || c == '_' || c == '.' || c.is_ascii_digit()),
                "attribute key must be lowercase snake/dotted: {a}"
            );
        }
    }
}
