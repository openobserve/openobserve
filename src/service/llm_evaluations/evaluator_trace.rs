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

//! Evaluator Trace — builds internal OTLP spans for online evaluation activity.
//!
//! Evaluator spans are exported to the org's `_evaluator` traces stream through
//! normal OTLP ingestion so the LLM processor can classify LLM-Judge calls and
//! calculate token/cost fields. The evaluator trace ID remains separate from the
//! target application trace; target trace/span identity is stored as evaluator
//! metadata.

use chrono::Utc;
use config::{ider, meta::self_reporting::evaluator};
use infra::table::scorers::ScorerType;
use opentelemetry_proto::tonic::{
    collector::trace::v1::ExportTraceServiceRequest,
    common::v1::{AnyValue, InstrumentationScope, KeyValue, any_value},
    resource::v1::Resource,
    trace::v1::{ResourceSpans, ScopeSpans, Span, Status, span::SpanKind, status::StatusCode},
};
use serde::Serialize;

const SERVICE_NAME: &str = "online_eval";
const SCOPE_NAME: &str = "openobserve.online_eval";
const GEN_AI_CHAT_OPERATION: &str = "chat";

#[derive(Debug, Clone, Serialize)]
pub struct EvaluatorTraceInput {
    pub org_id: String,
    pub evaluator_trace_id: String,
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

#[derive(Debug, Clone)]
pub struct EvaluatorTrace {
    pub span: Span,
    pub is_error: bool,
}

pub fn create_evaluator_trace(input: EvaluatorTraceInput) -> EvaluatorTrace {
    let span_id = ider::generate_span_id();
    let trace_id = input.evaluator_trace_id.clone();
    let latency_ms = input.latency_ms.max(0) as u64;
    let latency_nanos = latency_ms.saturating_mul(1_000_000);
    let end_time = now_nanos();
    let start_time = end_time.saturating_sub(latency_nanos);

    let is_error =
        input.status == evaluator::status::ERROR || input.status == evaluator::status::TIMEOUT;
    let is_llm_judge = matches!(input.scorer_type.as_ref(), Some(ScorerType::LlmJudge));

    let span_name = if input.status == evaluator::status::SKIPPED {
        evaluator::SPAN_NAME_SPAN_SKIPPED
    } else {
        match input.scorer_type.as_ref() {
            Some(ScorerType::LlmJudge) => evaluator::SPAN_NAME_LLM_JUDGE,
            Some(ScorerType::Remote) => evaluator::SPAN_NAME_REMOTE_SCORER,
            None => evaluator::SPAN_NAME_UNKNOWN_SCORER,
        }
    };

    let mut attributes = Vec::new();

    push_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_TARGET_SPAN_ID),
        &input.target_span_id,
    );
    push_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_TARGET_TRACE_ID),
        &input.target_trace_id,
    );
    push_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_TARGET_STREAM),
        &input.target_stream,
    );

    if let Some(ref scorer_id) = input.scorer_id {
        push_string_attr(
            &mut attributes,
            evaluator_attr_key(evaluator::ATTR_SCORER_ID),
            scorer_id,
        );
    }
    if let Some(ref scorer_version) = input.scorer_version {
        push_string_attr(
            &mut attributes,
            evaluator_attr_key(evaluator::ATTR_SCORER_VERSION),
            scorer_version,
        );
    }
    if let Some(ref scorer_type) = input.scorer_type {
        push_string_attr(
            &mut attributes,
            evaluator_attr_key(evaluator::ATTR_SCORER_TYPE),
            &scorer_type.to_string(),
        );
    }

    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_JOB_ID),
        input.job_id.as_deref(),
    );
    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_SCORE_CONFIG_ID),
        input.score_config_id.as_deref(),
    );
    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_SCORE_CONFIG_VERSION),
        input.score_config_version.as_deref(),
    );
    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_EVAL_RUN_ID),
        input.eval_run_id.as_deref(),
    );

    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_PROVIDER_ID),
        input.provider_id.as_deref(),
    );
    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_PROVIDER_NAME),
        input.provider_name.as_deref(),
    );
    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_PROVIDER_TYPE),
        input.provider_type.as_deref(),
    );
    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_MODEL),
        input.model.as_deref(),
    );

    push_i64_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_LATENCY_MS),
        input.latency_ms,
    );
    push_optional_i64_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_PROMPT_TOKENS),
        input.prompt_tokens,
    );
    push_optional_i64_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_COMPLETION_TOKENS),
        input.completion_tokens,
    );
    push_optional_i64_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_TOTAL_TOKENS),
        input.total_tokens,
    );
    if let Some(sampling_rate) = input.sampling_rate {
        push_f64_attr(
            &mut attributes,
            evaluator_attr_key(evaluator::ATTR_SAMPLING_RATE),
            sampling_rate,
        );
    }
    if let Some(sampled) = input.sampled {
        push_bool_attr(
            &mut attributes,
            evaluator_attr_key(evaluator::ATTR_SAMPLED),
            sampled,
        );
    }

    push_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_STATUS),
        &input.status,
    );
    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_ERROR_KIND),
        input.error_kind.as_deref(),
    );
    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_ERROR_MESSAGE),
        input.error_message.as_deref(),
    );
    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_SKIP_REASON),
        input.skip_reason.as_deref(),
    );

    let prompt = input.prompt.as_ref().map(|p| truncate_str(p, 4096));
    let response = input.response.as_ref().map(|r| truncate_str(r, 4096));

    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_PROMPT),
        prompt.as_deref(),
    );
    push_optional_string_attr(
        &mut attributes,
        evaluator_attr_key(evaluator::ATTR_RESPONSE),
        response.as_deref(),
    );

    if is_llm_judge {
        push_string_attr(
            &mut attributes,
            evaluator::GEN_AI_OPERATION_NAME,
            GEN_AI_CHAT_OPERATION,
        );
        push_optional_string_attr(
            &mut attributes,
            evaluator::GEN_AI_REQUEST_MODEL,
            input.model.as_deref(),
        );
        push_optional_string_attr(
            &mut attributes,
            evaluator::GEN_AI_RESPONSE_MODEL,
            input.model.as_deref(),
        );

        let provider_for_gen_ai = input
            .provider_type
            .as_deref()
            .or(input.provider_name.as_deref());
        push_optional_string_attr(
            &mut attributes,
            evaluator::GEN_AI_PROVIDER_NAME,
            provider_for_gen_ai,
        );
        push_optional_string_attr(
            &mut attributes,
            evaluator::GEN_AI_SYSTEM,
            input.provider_type.as_deref(),
        );

        if let Some(ref prompt) = prompt {
            push_string_attr(
                &mut attributes,
                evaluator::GEN_AI_INPUT_MESSAGES,
                &messages_json(prompt, "user"),
            );
        }
        if let Some(ref response) = response {
            push_string_attr(
                &mut attributes,
                evaluator::GEN_AI_OUTPUT_MESSAGES,
                &messages_json(response, "assistant"),
            );
        }

        push_optional_i64_attr(
            &mut attributes,
            evaluator::GEN_AI_USAGE_INPUT_TOKENS,
            input.prompt_tokens,
        );
        push_optional_i64_attr(
            &mut attributes,
            evaluator::GEN_AI_USAGE_OUTPUT_TOKENS,
            input.completion_tokens,
        );
        push_optional_i64_attr(
            &mut attributes,
            evaluator::GEN_AI_USAGE_TOTAL_TOKENS,
            input.total_tokens,
        );
    }

    let span = Span {
        trace_id: decode_trace_id(&trace_id),
        span_id: decode_span_id(&span_id),
        trace_state: String::new(),
        parent_span_id: vec![],
        flags: 1,
        name: span_name.to_string(),
        kind: SpanKind::Internal as i32,
        start_time_unix_nano: start_time,
        end_time_unix_nano: end_time,
        attributes,
        dropped_attributes_count: 0,
        events: vec![],
        dropped_events_count: 0,
        links: vec![],
        dropped_links_count: 0,
        status: Some(Status {
            code: if is_error {
                StatusCode::Error as i32
            } else {
                StatusCode::Ok as i32
            },
            message: input.error_message.unwrap_or_default(),
        }),
    };

    EvaluatorTrace { span, is_error }
}

pub fn create_evaluator_trace_request(traces: Vec<EvaluatorTrace>) -> ExportTraceServiceRequest {
    let spans: Vec<Span> = traces.into_iter().map(|trace| trace.span).collect();
    if spans.is_empty() {
        return ExportTraceServiceRequest {
            resource_spans: vec![],
        };
    }

    ExportTraceServiceRequest {
        resource_spans: vec![ResourceSpans {
            resource: Some(Resource {
                attributes: vec![string_key_value("service.name", SERVICE_NAME)],
                ..Default::default()
            }),
            scope_spans: vec![ScopeSpans {
                scope: Some(InstrumentationScope {
                    name: SCOPE_NAME.to_string(),
                    version: config::VERSION.to_string(),
                    attributes: vec![],
                    dropped_attributes_count: 0,
                }),
                spans,
                ..Default::default()
            }],
            ..Default::default()
        }],
    }
}

fn now_nanos() -> u64 {
    Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_else(|| Utc::now().timestamp_micros().saturating_mul(1000))
        .max(0) as u64
}

fn evaluator_attr_key(key: &str) -> String {
    format!("attributes.{key}")
}

fn string_key_value(key: impl Into<String>, value: impl Into<String>) -> KeyValue {
    KeyValue {
        key: key.into(),
        value: Some(AnyValue {
            value: Some(any_value::Value::StringValue(value.into())),
        }),
    }
}

fn push_string_attr(attrs: &mut Vec<KeyValue>, key: impl Into<String>, value: impl Into<String>) {
    attrs.push(string_key_value(key, value));
}

fn push_optional_string_attr(
    attrs: &mut Vec<KeyValue>,
    key: impl Into<String>,
    value: Option<&str>,
) {
    if let Some(value) = value {
        push_string_attr(attrs, key, value);
    }
}

fn push_i64_attr(attrs: &mut Vec<KeyValue>, key: impl Into<String>, value: i64) {
    attrs.push(KeyValue {
        key: key.into(),
        value: Some(AnyValue {
            value: Some(any_value::Value::IntValue(value)),
        }),
    });
}

fn push_optional_i64_attr(attrs: &mut Vec<KeyValue>, key: impl Into<String>, value: Option<i64>) {
    if let Some(value) = value {
        push_i64_attr(attrs, key, value);
    }
}

fn push_f64_attr(attrs: &mut Vec<KeyValue>, key: impl Into<String>, value: f64) {
    attrs.push(KeyValue {
        key: key.into(),
        value: Some(AnyValue {
            value: Some(any_value::Value::DoubleValue(value)),
        }),
    });
}

fn push_bool_attr(attrs: &mut Vec<KeyValue>, key: impl Into<String>, value: bool) {
    attrs.push(KeyValue {
        key: key.into(),
        value: Some(AnyValue {
            value: Some(any_value::Value::BoolValue(value)),
        }),
    });
}

fn decode_trace_id(trace_id: &str) -> Vec<u8> {
    decode_hex_id(trace_id, 16).unwrap_or_else(|| {
        decode_hex_id(&ider::generate_trace_id(), 16).unwrap_or_else(|| vec![1; 16])
    })
}

fn decode_span_id(span_id: &str) -> Vec<u8> {
    decode_hex_id(span_id, 8).unwrap_or_else(|| {
        decode_hex_id(&ider::generate_span_id(), 8).unwrap_or_else(|| vec![1; 8])
    })
}

fn decode_hex_id(id: &str, expected_len: usize) -> Option<Vec<u8>> {
    let bytes = hex::decode(id).ok()?;
    if bytes.len() == expected_len && bytes.iter().any(|byte| *byte != 0) {
        Some(bytes)
    } else {
        None
    }
}

fn messages_json(content: &str, role: &str) -> String {
    let trimmed = content.trim();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed)
        && value.is_array()
    {
        return trimmed.to_string();
    }

    serde_json::json!([{ "role": role, "content": content }]).to_string()
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

    fn attr<'a>(span: &'a Span, key: &str) -> Option<&'a AnyValue> {
        span.attributes
            .iter()
            .find(|attr| attr.key == key)
            .and_then(|attr| attr.value.as_ref())
    }

    fn attr_str<'a>(span: &'a Span, key: &str) -> Option<&'a str> {
        match attr(span, key)?.value.as_ref()? {
            any_value::Value::StringValue(value) => Some(value.as_str()),
            _ => None,
        }
    }

    fn attr_i64(span: &Span, key: &str) -> Option<i64> {
        match attr(span, key)?.value.as_ref()? {
            any_value::Value::IntValue(value) => Some(*value),
            _ => None,
        }
    }

    fn attr_bool(span: &Span, key: &str) -> Option<bool> {
        match attr(span, key)?.value.as_ref()? {
            any_value::Value::BoolValue(value) => Some(*value),
            _ => None,
        }
    }

    fn attr_f64(span: &Span, key: &str) -> Option<f64> {
        match attr(span, key)?.value.as_ref()? {
            any_value::Value::DoubleValue(value) => Some(*value),
            _ => None,
        }
    }

    fn success_input() -> EvaluatorTraceInput {
        EvaluatorTraceInput {
            org_id: "org1".to_string(),
            evaluator_trace_id: "11111111111111111111111111111111".to_string(),
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
            provider_name: Some("OpenAI Prod".to_string()),
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
        }
    }

    #[test]
    fn test_create_success_trace_as_otlp_span() {
        let trace = create_evaluator_trace(success_input());
        assert!(!trace.is_error);

        let span = &trace.span;
        assert_eq!(span.name, evaluator::SPAN_NAME_LLM_JUDGE);
        assert_eq!(span.kind, SpanKind::Internal as i32);
        assert_eq!(span.status.as_ref().unwrap().code, StatusCode::Ok as i32);
        assert_eq!(
            hex::encode(&span.trace_id),
            "11111111111111111111111111111111"
        );
        assert_eq!(span.span_id.len(), 8);
        assert_eq!(span.parent_span_id.len(), 0);
        assert_eq!(
            span.end_time_unix_nano - span.start_time_unix_nano,
            500_000_000
        );

        assert_eq!(
            attr_str(span, &evaluator_attr_key(evaluator::ATTR_TARGET_SPAN_ID)),
            Some("span-1")
        );
        assert_eq!(
            attr_str(span, &evaluator_attr_key(evaluator::ATTR_SCORER_ID)),
            Some("sc-1")
        );
        assert_eq!(
            attr_i64(span, &evaluator_attr_key(evaluator::ATTR_LATENCY_MS)),
            Some(500)
        );
        assert_eq!(
            attr_str(span, &evaluator_attr_key(evaluator::ATTR_PROVIDER_NAME)),
            Some("OpenAI Prod")
        );
        assert_eq!(
            attr_str(span, &evaluator_attr_key(evaluator::ATTR_MODEL)),
            Some("gpt-4o")
        );
        assert_eq!(
            attr_str(span, &evaluator_attr_key(evaluator::ATTR_STATUS)),
            Some(evaluator::status::SUCCESS)
        );
        assert_eq!(
            attr_f64(span, &evaluator_attr_key(evaluator::ATTR_SAMPLING_RATE)),
            Some(0.25)
        );
        assert_eq!(
            attr_bool(span, &evaluator_attr_key(evaluator::ATTR_SAMPLED)),
            Some(true)
        );

        assert_eq!(
            attr_str(span, evaluator::GEN_AI_OPERATION_NAME),
            Some(GEN_AI_CHAT_OPERATION)
        );
        assert_eq!(
            attr_str(span, evaluator::GEN_AI_REQUEST_MODEL),
            Some("gpt-4o")
        );
        assert_eq!(
            attr_str(span, evaluator::GEN_AI_RESPONSE_MODEL),
            Some("gpt-4o")
        );
        assert_eq!(
            attr_str(span, evaluator::GEN_AI_PROVIDER_NAME),
            Some("openai")
        );
        assert_eq!(
            attr_i64(span, evaluator::GEN_AI_USAGE_INPUT_TOKENS),
            Some(100)
        );
        assert_eq!(
            attr_i64(span, evaluator::GEN_AI_USAGE_OUTPUT_TOKENS),
            Some(50)
        );
        assert_eq!(
            attr_i64(span, evaluator::GEN_AI_USAGE_TOTAL_TOKENS),
            Some(150)
        );
        assert!(
            attr_str(span, evaluator::GEN_AI_INPUT_MESSAGES)
                .unwrap()
                .contains("Evaluate this text")
        );
        assert!(
            attr_str(span, evaluator::GEN_AI_OUTPUT_MESSAGES)
                .unwrap()
                .contains("score")
        );
    }

    #[test]
    fn test_create_error_trace() {
        let input = EvaluatorTraceInput {
            org_id: "org1".to_string(),
            evaluator_trace_id: "22222222222222222222222222222222".to_string(),
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
        assert_eq!(
            trace.span.status.as_ref().unwrap().code,
            StatusCode::Error as i32
        );
        assert_eq!(
            attr_str(&trace.span, &evaluator_attr_key(evaluator::ATTR_STATUS)),
            Some(evaluator::status::ERROR)
        );
        assert_eq!(
            attr_str(&trace.span, &evaluator_attr_key(evaluator::ATTR_ERROR_KIND)),
            Some("timeout")
        );
        assert_eq!(
            attr_str(
                &trace.span,
                &evaluator_attr_key(evaluator::ATTR_ERROR_MESSAGE)
            ),
            Some("Request timed out")
        );
    }

    #[test]
    fn test_create_remote_scorer_trace_has_no_gen_ai_attrs() {
        let input = EvaluatorTraceInput {
            org_id: "org1".to_string(),
            evaluator_trace_id: "33333333333333333333333333333333".to_string(),
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
        assert_eq!(trace.span.name, evaluator::SPAN_NAME_REMOTE_SCORER);
        assert_eq!(
            trace.span.status.as_ref().unwrap().code,
            StatusCode::Ok as i32
        );
        assert_eq!(
            attr_str(&trace.span, evaluator::GEN_AI_OPERATION_NAME),
            None
        );
        assert_eq!(
            attr_str(&trace.span, &evaluator_attr_key(evaluator::ATTR_RESPONSE)),
            Some("{\"score\":0.9,\"reason\":\"good\"}")
        );
    }

    #[test]
    fn test_create_skipped_trace() {
        let input = EvaluatorTraceInput {
            org_id: "org1".to_string(),
            evaluator_trace_id: "55555555555555555555555555555555".to_string(),
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
        assert_eq!(trace.span.name, evaluator::SPAN_NAME_SPAN_SKIPPED);
        assert_eq!(
            trace.span.status.as_ref().unwrap().code,
            StatusCode::Ok as i32
        );
        assert_eq!(
            attr_str(&trace.span, &evaluator_attr_key(evaluator::ATTR_STATUS)),
            Some(evaluator::status::SKIPPED)
        );
        assert_eq!(
            attr_str(
                &trace.span,
                &evaluator_attr_key(evaluator::ATTR_SKIP_REASON)
            ),
            Some("sampling")
        );
        assert_eq!(
            attr_bool(&trace.span, &evaluator_attr_key(evaluator::ATTR_SAMPLED)),
            Some(false)
        );
        assert_eq!(
            attr_str(&trace.span, &evaluator_attr_key(evaluator::ATTR_SCORER_ID)),
            None
        );
    }

    #[test]
    fn test_multiple_scorer_spans_share_evaluator_trace_id() {
        let evaluator_trace_id = "11111111111111111111111111111111".to_string();

        let make_input = |scorer_id: &str| EvaluatorTraceInput {
            evaluator_trace_id: evaluator_trace_id.clone(),
            scorer_id: Some(scorer_id.to_string()),
            ..success_input()
        };

        let first = create_evaluator_trace(make_input("sc-1"));
        let second = create_evaluator_trace(make_input("sc-2"));

        assert_eq!(hex::encode(&first.span.trace_id), evaluator_trace_id);
        assert_eq!(first.span.trace_id, second.span.trace_id);
        assert_ne!(first.span.span_id, second.span.span_id);
    }

    #[test]
    fn test_create_evaluator_trace_request_groups_spans_under_resource() {
        let trace = create_evaluator_trace(success_input());
        let request = create_evaluator_trace_request(vec![trace]);

        assert_eq!(request.resource_spans.len(), 1);
        let resource_spans = &request.resource_spans[0];
        assert_eq!(
            resource_spans.resource.as_ref().unwrap().attributes[0].key,
            "service.name"
        );
        assert_eq!(resource_spans.scope_spans.len(), 1);
        assert_eq!(
            resource_spans.scope_spans[0].scope.as_ref().unwrap().name,
            SCOPE_NAME
        );
        assert_eq!(resource_spans.scope_spans[0].spans.len(), 1);
    }

    #[test]
    fn test_messages_json_wraps_plain_content_and_preserves_arrays() {
        assert_eq!(
            messages_json("hello", "user"),
            serde_json::json!([{ "role": "user", "content": "hello" }]).to_string()
        );

        let messages = r#"[{"role":"system","content":"rules"}]"#;
        assert_eq!(messages_json(messages, "user"), messages);
    }

    #[test]
    fn test_truncate_str() {
        assert_eq!(truncate_str("hello", 10), "hello");
        assert_eq!(truncate_str("hello world", 5), "hello...[truncated]");
    }
}
