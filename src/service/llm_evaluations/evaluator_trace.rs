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

//! Evaluator Trace — writes synthetic spans to the `_evaluator` trace stream.
//!
//! Each evaluator invocation (llm_judge or remote_scorer) is recorded as a
//! synthetic OTLP-shaped span. The span is written as JSON and self-ingested
//! through the traces ingestion path.
//!
//! See `LLM_Observability_Phase2_Online_Eval_v1.3_EN.md` §6.2 for field semantics.

use chrono::Utc;
use config::{ider, meta::self_reporting::evaluator};
use infra::table::scorers::ScorerType;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
pub struct EvaluatorTraceInput {
    pub org_id: String,
    pub target_span_id: String,
    pub target_trace_id: String,
    pub target_stream: String,
    pub scorer_id: Option<String>,
    pub scorer_version: Option<String>,
    pub scorer_type: Option<ScorerType>,
    pub job_id: Option<String>,
    pub score_config_id: Option<String>,
    pub score_config_version: Option<String>,
    pub eval_run_id: Option<String>,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub provider_type: Option<String>,
    pub model: Option<String>,
    pub latency_ms: i64,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub sampling_rate: Option<f64>,
    pub sampled: Option<bool>,
    pub status: String,
    pub error_kind: Option<String>,
    pub error_message: Option<String>,
    pub skip_reason: Option<String>,
    pub prompt: Option<String>,
    pub response: Option<String>,
}

pub struct EvaluatorTrace {
    pub span_json: Value,
    pub is_error: bool,
}

pub fn create_evaluator_trace(input: EvaluatorTraceInput) -> EvaluatorTrace {
    let span_id = ider::generate();
    let trace_id = ider::generate();
    let now = Utc::now().timestamp_micros();
    let latency_ms = input.latency_ms.max(0);
    let latency_micros = latency_ms.saturating_mul(1000);
    let latency_nanos = latency_ms.saturating_mul(1_000_000);
    let end_time = now.saturating_mul(1000);
    let start_time = end_time.saturating_sub(latency_nanos);

    let is_error =
        input.status == evaluator::status::ERROR || input.status == evaluator::status::TIMEOUT;

    let span_name = if input.status == evaluator::status::SKIPPED {
        evaluator::SPAN_NAME_SPAN_SKIPPED
    } else {
        match input.scorer_type.as_ref() {
            Some(ScorerType::LlmJudge) => evaluator::SPAN_NAME_LLM_JUDGE,
            Some(ScorerType::Remote) => evaluator::SPAN_NAME_REMOTE_SCORER,
            None => evaluator::SPAN_NAME_UNKNOWN_SCORER,
        }
    };

    let mut attributes: serde_json::Map<String, Value> = serde_json::Map::new();

    // Target identity
    attributes.insert(
        evaluator::ATTR_TARGET_SPAN_ID.to_string(),
        Value::String(input.target_span_id),
    );
    attributes.insert(
        evaluator::ATTR_TARGET_TRACE_ID.to_string(),
        Value::String(input.target_trace_id),
    );
    attributes.insert(
        evaluator::ATTR_TARGET_STREAM.to_string(),
        Value::String(input.target_stream),
    );

    // Evaluator identity
    if let Some(scorer_id) = input.scorer_id {
        attributes.insert(
            evaluator::ATTR_SCORER_ID.to_string(),
            Value::String(scorer_id),
        );
    }
    if let Some(scorer_version) = input.scorer_version {
        attributes.insert(
            evaluator::ATTR_SCORER_VERSION.to_string(),
            Value::String(scorer_version),
        );
    }
    if let Some(ref scorer_type) = input.scorer_type {
        attributes.insert(
            evaluator::ATTR_SCORER_TYPE.to_string(),
            Value::String(scorer_type.to_string()),
        );
    }

    if let Some(ref job_id) = input.job_id {
        attributes.insert(
            evaluator::ATTR_JOB_ID.to_string(),
            Value::String(job_id.clone()),
        );
    }
    if let Some(ref scid) = input.score_config_id {
        attributes.insert(
            evaluator::ATTR_SCORE_CONFIG_ID.to_string(),
            Value::String(scid.clone()),
        );
    }
    if let Some(ref scv) = input.score_config_version {
        attributes.insert(
            evaluator::ATTR_SCORE_CONFIG_VERSION.to_string(),
            Value::String(scv.clone()),
        );
    }
    if let Some(ref eval_run_id) = input.eval_run_id {
        attributes.insert(
            evaluator::ATTR_EVAL_RUN_ID.to_string(),
            Value::String(eval_run_id.clone()),
        );
    }

    // Provider context (LLM Judge only)
    if let Some(ref pid) = input.provider_id {
        attributes.insert(
            evaluator::ATTR_PROVIDER_ID.to_string(),
            Value::String(pid.clone()),
        );
    }
    if let Some(ref pn) = input.provider_name {
        attributes.insert(
            evaluator::ATTR_PROVIDER_NAME.to_string(),
            Value::String(pn.clone()),
        );
    }
    if let Some(ref pt) = input.provider_type {
        attributes.insert(
            evaluator::ATTR_PROVIDER_TYPE.to_string(),
            Value::String(pt.clone()),
        );
    }
    if let Some(ref m) = input.model {
        attributes.insert(evaluator::ATTR_MODEL.to_string(), Value::String(m.clone()));
    }

    // Telemetry
    attributes.insert(
        evaluator::ATTR_LATENCY_MS.to_string(),
        Value::Number(serde_json::Number::from(input.latency_ms)),
    );
    if let Some(pt) = input.prompt_tokens {
        attributes.insert(
            evaluator::ATTR_PROMPT_TOKENS.to_string(),
            Value::Number(serde_json::Number::from(pt)),
        );
    }
    if let Some(ct) = input.completion_tokens {
        attributes.insert(
            evaluator::ATTR_COMPLETION_TOKENS.to_string(),
            Value::Number(serde_json::Number::from(ct)),
        );
    }
    if let Some(tt) = input.total_tokens {
        attributes.insert(
            evaluator::ATTR_TOTAL_TOKENS.to_string(),
            Value::Number(serde_json::Number::from(tt)),
        );
    }
    if let Some(sampling_rate) = input.sampling_rate
        && let Some(rate) = serde_json::Number::from_f64(sampling_rate)
    {
        attributes.insert(
            evaluator::ATTR_SAMPLING_RATE.to_string(),
            Value::Number(rate),
        );
    }
    if let Some(sampled) = input.sampled {
        attributes.insert(evaluator::ATTR_SAMPLED.to_string(), Value::Bool(sampled));
    }

    // Outcome
    attributes.insert(
        evaluator::ATTR_STATUS.to_string(),
        Value::String(input.status.clone()),
    );
    if let Some(ref ek) = input.error_kind {
        attributes.insert(
            evaluator::ATTR_ERROR_KIND.to_string(),
            Value::String(ek.clone()),
        );
    }
    if let Some(ref em) = input.error_message {
        attributes.insert(
            evaluator::ATTR_ERROR_MESSAGE.to_string(),
            Value::String(em.clone()),
        );
    }
    if let Some(ref sr) = input.skip_reason {
        attributes.insert(
            evaluator::ATTR_SKIP_REASON.to_string(),
            Value::String(sr.clone()),
        );
    }

    // Optional payload (truncated for safety)
    if let Some(ref p) = input.prompt {
        let truncated = truncate_str(p, 4096);
        attributes.insert(evaluator::ATTR_PROMPT.to_string(), Value::String(truncated));
    }
    if let Some(ref r) = input.response {
        let truncated = truncate_str(r, 4096);
        attributes.insert(
            evaluator::ATTR_RESPONSE.to_string(),
            Value::String(truncated),
        );
    }

    let span_json = serde_json::json!({
        "_timestamp": now,
        "operation_name": span_name,
        "span_id": span_id,
        "trace_id": trace_id,
        "parent_span_id": "",
        "event": span_name,
        "attributes": attributes,
        "service_name": "online_eval",
        "span_kind": "INTERNAL",
        "start_time": start_time,
        "end_time": end_time,
        "duration": latency_micros,
        "span_status": if is_error { "STATUS_CODE_ERROR" } else { "STATUS_CODE_OK" },
        "flags": 1,
        "events": "[]",
        "links": "[]",
    });

    EvaluatorTrace {
        span_json,
        is_error,
    }
}

fn truncate_str(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    // Walk back to the nearest char boundary so we never slice mid-codepoint.
    let mut boundary = max_bytes;
    while boundary > 0 && !s.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{}...[truncated]", &s[..boundary])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_success_trace() {
        let input = EvaluatorTraceInput {
            org_id: "org1".to_string(),
            target_span_id: "span-1".to_string(),
            target_trace_id: "trace-1".to_string(),
            target_stream: "traces".to_string(),
            scorer_id: Some("sc-1".to_string()),
            scorer_version: Some("1".to_string()),
            scorer_type: Some(ScorerType::LlmJudge),
            job_id: Some("job-1".to_string()),
            score_config_id: Some("cfg-1".to_string()),
            score_config_version: Some("1".to_string()),
            eval_run_id: Some("run-1".to_string()),
            provider_id: Some("prov-1".to_string()),
            provider_name: Some("OpenAI".to_string()),
            provider_type: Some("openai".to_string()),
            model: Some("gpt-4o".to_string()),
            latency_ms: 500,
            prompt_tokens: Some(100),
            completion_tokens: Some(50),
            total_tokens: Some(150),
            sampling_rate: Some(0.25),
            sampled: Some(true),
            status: evaluator::status::SUCCESS.to_string(),
            error_kind: None,
            error_message: None,
            skip_reason: None,
            prompt: Some("Evaluate this text...".to_string()),
            response: Some("{\"score\":0.9}".to_string()),
        };

        let trace = create_evaluator_trace(input);
        assert!(!trace.is_error);

        let j = &trace.span_json;
        assert_eq!(j["operation_name"], evaluator::SPAN_NAME_LLM_JUDGE);
        assert!(j["span_id"].as_str().unwrap().len() > 0);
        assert!(j["trace_id"].as_str().unwrap().len() > 0);
        assert_eq!(j["span_status"], "STATUS_CODE_OK");
        assert_eq!(j["span_kind"], "INTERNAL");
        assert_eq!(j["flags"], 1);
        assert_eq!(j["events"], "[]");
        assert_eq!(j["links"], "[]");
        let timestamp = j["_timestamp"].as_i64().unwrap();
        let start_time = j["start_time"].as_i64().unwrap();
        let end_time = j["end_time"].as_i64().unwrap();
        assert_eq!(end_time, timestamp * 1000);
        assert_eq!(end_time - start_time, 500_000_000);
        assert_eq!(j["duration"], 500_000);

        let attrs = &j["attributes"];
        assert_eq!(attrs[evaluator::ATTR_TARGET_SPAN_ID], "span-1");
        assert_eq!(attrs[evaluator::ATTR_SCORER_ID], "sc-1");
        assert_eq!(attrs[evaluator::ATTR_LATENCY_MS], 500);
        assert_eq!(attrs[evaluator::ATTR_PROVIDER_NAME], "OpenAI");
        assert_eq!(attrs[evaluator::ATTR_MODEL], "gpt-4o");
        assert_eq!(attrs[evaluator::ATTR_STATUS], evaluator::status::SUCCESS);
        assert_eq!(attrs[evaluator::ATTR_JOB_ID], "job-1");
        assert_eq!(attrs[evaluator::ATTR_SCORE_CONFIG_ID], "cfg-1");
        assert_eq!(attrs[evaluator::ATTR_EVAL_RUN_ID], "run-1");
        assert_eq!(attrs[evaluator::ATTR_SAMPLING_RATE], 0.25);
        assert_eq!(attrs[evaluator::ATTR_SAMPLED], true);
    }

    #[test]
    fn test_create_error_trace() {
        let input = EvaluatorTraceInput {
            org_id: "org1".to_string(),
            target_span_id: "span-2".to_string(),
            target_trace_id: "trace-2".to_string(),
            target_stream: "traces".to_string(),
            scorer_id: Some("sc-2".to_string()),
            scorer_version: Some("2".to_string()),
            scorer_type: Some(ScorerType::LlmJudge),
            job_id: None,
            score_config_id: None,
            score_config_version: None,
            eval_run_id: None,
            provider_id: None,
            provider_name: None,
            provider_type: None,
            model: None,
            latency_ms: 1000,
            prompt_tokens: None,
            completion_tokens: None,
            total_tokens: None,
            sampling_rate: None,
            sampled: None,
            status: evaluator::status::ERROR.to_string(),
            error_kind: Some("timeout".to_string()),
            error_message: Some("Request timed out".to_string()),
            skip_reason: None,
            prompt: None,
            response: None,
        };

        let trace = create_evaluator_trace(input);
        assert!(trace.is_error);

        let attrs = &trace.span_json["attributes"];
        assert_eq!(attrs[evaluator::ATTR_STATUS], evaluator::status::ERROR);
        assert_eq!(attrs[evaluator::ATTR_ERROR_KIND], "timeout");
        assert_eq!(attrs[evaluator::ATTR_ERROR_MESSAGE], "Request timed out");
    }

    #[test]
    fn test_create_remote_scorer_trace() {
        let input = EvaluatorTraceInput {
            org_id: "org1".to_string(),
            target_span_id: "span-3".to_string(),
            target_trace_id: "trace-3".to_string(),
            target_stream: "traces".to_string(),
            scorer_id: Some("sc-3".to_string()),
            scorer_version: Some("3".to_string()),
            scorer_type: Some(ScorerType::Remote),
            job_id: None,
            score_config_id: None,
            score_config_version: None,
            eval_run_id: None,
            provider_id: None,
            provider_name: None,
            provider_type: None,
            model: None,
            latency_ms: 200,
            prompt_tokens: None,
            completion_tokens: None,
            total_tokens: None,
            sampling_rate: None,
            sampled: None,
            status: evaluator::status::SUCCESS.to_string(),
            error_kind: None,
            error_message: None,
            skip_reason: None,
            prompt: None,
            response: Some("{\"score\":0.9,\"reason\":\"good\"}".to_string()),
        };

        let trace = create_evaluator_trace(input);
        assert!(!trace.is_error);
        assert_eq!(
            trace.span_json["operation_name"],
            evaluator::SPAN_NAME_REMOTE_SCORER
        );
        assert_eq!(trace.span_json["span_status"], "STATUS_CODE_OK");
        assert_eq!(trace.span_json["span_kind"], "INTERNAL");
        assert_eq!(
            trace.span_json["attributes"][evaluator::ATTR_RESPONSE],
            "{\"score\":0.9,\"reason\":\"good\"}"
        );
    }

    #[test]
    fn test_create_unknown_scorer_trace() {
        let input = EvaluatorTraceInput {
            org_id: "org1".to_string(),
            target_span_id: "span-4".to_string(),
            target_trace_id: "trace-4".to_string(),
            target_stream: "traces".to_string(),
            scorer_id: Some("sc-4".to_string()),
            scorer_version: Some("?".to_string()),
            scorer_type: None,
            job_id: None,
            score_config_id: None,
            score_config_version: None,
            eval_run_id: None,
            provider_id: None,
            provider_name: None,
            provider_type: None,
            model: None,
            latency_ms: 0,
            prompt_tokens: None,
            completion_tokens: None,
            total_tokens: None,
            sampling_rate: None,
            sampled: None,
            status: evaluator::status::ERROR.to_string(),
            error_kind: Some("lookup_error".to_string()),
            error_message: Some("scorer missing".to_string()),
            skip_reason: None,
            prompt: None,
            response: None,
        };

        let trace = create_evaluator_trace(input);
        assert!(trace.is_error);
        assert_eq!(
            trace.span_json["operation_name"],
            evaluator::SPAN_NAME_UNKNOWN_SCORER
        );
        assert_eq!(trace.span_json["span_status"], "STATUS_CODE_ERROR");
    }

    #[test]
    fn test_create_skipped_trace() {
        let input = EvaluatorTraceInput {
            org_id: "org1".to_string(),
            target_span_id: "span-5".to_string(),
            target_trace_id: "trace-5".to_string(),
            target_stream: "traces".to_string(),
            scorer_id: None,
            scorer_version: None,
            scorer_type: None,
            job_id: Some("job-5".to_string()),
            score_config_id: None,
            score_config_version: None,
            eval_run_id: Some("run-5".to_string()),
            provider_id: None,
            provider_name: None,
            provider_type: None,
            model: None,
            latency_ms: 0,
            prompt_tokens: None,
            completion_tokens: None,
            total_tokens: None,
            sampling_rate: Some(0.1),
            sampled: Some(false),
            status: evaluator::status::SKIPPED.to_string(),
            error_kind: None,
            error_message: None,
            skip_reason: Some("sampling".to_string()),
            prompt: None,
            response: None,
        };

        let trace = create_evaluator_trace(input);
        assert!(!trace.is_error);
        assert_eq!(
            trace.span_json["operation_name"],
            evaluator::SPAN_NAME_SPAN_SKIPPED
        );
        assert_eq!(trace.span_json["span_status"], "STATUS_CODE_OK");

        let attrs = &trace.span_json["attributes"];
        assert_eq!(attrs[evaluator::ATTR_STATUS], evaluator::status::SKIPPED);
        assert_eq!(attrs[evaluator::ATTR_SKIP_REASON], "sampling");
        assert_eq!(attrs[evaluator::ATTR_JOB_ID], "job-5");
        assert_eq!(attrs[evaluator::ATTR_EVAL_RUN_ID], "run-5");
        assert_eq!(attrs[evaluator::ATTR_SAMPLING_RATE], 0.1);
        assert_eq!(attrs[evaluator::ATTR_SAMPLED], false);
        assert!(attrs.get(evaluator::ATTR_SCORER_ID).is_none());
    }

    #[test]
    fn test_truncate_str() {
        assert_eq!(truncate_str("hello", 10), "hello");
        assert_eq!(truncate_str("hello world", 5), "hello...[truncated]");
    }
}
