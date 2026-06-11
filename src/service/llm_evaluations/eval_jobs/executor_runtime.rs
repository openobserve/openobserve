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

//! Executor Runtime — orchestrates span evaluation through configured scorers.
//!
//! Glue between the pipeline's LlmEvaluation node and the individual scorer
//! executors (llm_judge, remote). Called from `batch_execution.rs` when the
//! pipeline node is an evaluation pipeline (job_id is set).
//!
//! For each span record:
//! 1. Resolves scorer configs from the database
//! 2. Dispatches to llm_judge or remote scorer
//! 3. Produces score records (forwarded through pipeline to _llm_scores)
//! 4. Produces evaluator traces (internally exported as OTLP spans)

use std::collections::HashMap;

use anyhow::Result;
use config::meta::{pipeline::components::ScorerRef, self_reporting::evaluator};
use infra::table::{online_eval_jobs::JobInputMapping, scorers::ScorerType};
use serde_json::Value;

use crate::service::llm_evaluations::{
    evaluator_trace::{EvaluatorTrace, EvaluatorTraceInput, create_evaluator_trace},
    prepared_scorers::{PreparedScorer, ScorerExecutionError},
};

#[derive(Debug)]
pub struct SpanEvalContext {
    pub org_id: String,
    pub span_id: String,
    pub trace_id: String,
    pub target_agent_name: Option<String>,
    pub target_agent_id: Option<String>,
    pub evaluator_trace_id: String,
    pub session_id: Option<String>,
    pub source_stream: String,
    pub source_stream_type: String,
    pub job_id: Option<String>,
    pub eval_run_id: Option<String>,
    pub sampling_rate: Option<f64>,
    pub sampled: Option<bool>,
    pub attributes: HashMap<String, Value>,
}

#[derive(Debug)]
pub struct EvalError {
    pub scorer_id: String,
    pub scorer_type: Option<ScorerType>,
    pub error_kind: String,
    pub error_message: String,
    pub latency_ms: i64,
}

pub struct ExecutorOutput {
    pub scores: Vec<Value>,
    pub evaluator_traces: Vec<EvaluatorTrace>,
    pub errors: Vec<EvalError>,
}

impl ExecutorOutput {
    pub fn empty() -> Self {
        Self {
            scores: Vec::new(),
            evaluator_traces: Vec::new(),
            errors: Vec::new(),
        }
    }
}

pub fn extract_context_from_span(
    org_id: &str,
    job_id: Option<&str>,
    record: &Value,
    default_source_stream: &str,
    default_source_stream_type: &str,
) -> Option<SpanEvalContext> {
    let span_id = record
        .get("span_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default();

    let trace_id = record
        .get("trace_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default();

    if span_id.is_empty() {
        log::warn!("[EXECUTOR-RUNTIME] Skipping evaluation span with missing span_id");
        return None;
    }

    if trace_id.is_empty() {
        log::warn!(
            "[EXECUTOR-RUNTIME] Skipping evaluation span '{}' with missing trace_id",
            span_id
        );
        return None;
    }

    let session_id = record
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let source_stream = record
        .get("pipeline_source_stream")
        .and_then(|v| v.as_str())
        .unwrap_or(default_source_stream)
        .to_string();
    let source_stream_type = record
        .get("pipeline_source_stream_type")
        .and_then(|v| v.as_str())
        .unwrap_or(default_source_stream_type)
        .to_string();

    let mut attributes: HashMap<String, Value> = HashMap::new();

    if let Some(attrs) = record.get("attributes").and_then(|v| v.as_object()) {
        for (k, v) in attrs {
            attributes.insert(k.clone(), v.clone());
        }
    }

    for (key, value) in record.as_object().into_iter().flat_map(|o| o.iter()) {
        if key == "span_id"
            || key == "trace_id"
            || key == "session_id"
            || key == "attributes"
            || key == "pipeline_source_stream"
            || key == "pipeline_source_stream_type"
        {
            continue;
        }
        attributes
            .entry(key.clone())
            .or_insert_with(|| value.clone());
    }

    let target_agent_name = non_empty_string(record, &["gen_ai.agent.name", "gen_ai_agent_name"])
        .or_else(|| {
            non_empty_string_from_map(
                &attributes,
                &[
                    "gen_ai.agent.name",
                    "gen_ai_agent_name",
                    "attributes_gen_ai_agent_name",
                ],
            )
        });
    let target_agent_id = non_empty_string(record, &["gen_ai.agent.id", "gen_ai_agent_id"])
        .or_else(|| {
            non_empty_string_from_map(
                &attributes,
                &[
                    "gen_ai.agent.id",
                    "gen_ai_agent_id",
                    "attributes_gen_ai_agent_id",
                ],
            )
        });

    Some(SpanEvalContext {
        org_id: org_id.to_string(),
        span_id,
        trace_id,
        target_agent_name,
        target_agent_id,
        evaluator_trace_id: config::ider::generate_trace_id(),
        session_id,
        source_stream,
        source_stream_type,
        job_id: job_id.map(|s| s.to_string()),
        eval_run_id: None,
        sampling_rate: None,
        sampled: None,
        attributes,
    })
}

fn non_empty_string(record: &Value, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| {
        let value = record.get(*field)?.as_str()?;
        if value.trim().is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

fn non_empty_string_from_map(
    attributes: &HashMap<String, Value>,
    fields: &[&str],
) -> Option<String> {
    fields.iter().find_map(|field| {
        let value = attributes.get(*field)?.as_str()?;
        if value.trim().is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

fn resolve_scorer_input_variables(
    job_input_mapping: &Option<JobInputMapping>,
    scorer_entity_id: &str,
    span_attributes: &HashMap<String, Value>,
) -> HashMap<String, Value> {
    let mut input_variables = HashMap::new();

    let Some(mapping) = job_input_mapping
        .as_ref()
        .and_then(|m| m.get(scorer_entity_id))
    else {
        return input_variables;
    };

    for (variable, pattern) in mapping {
        input_variables.insert(
            variable.clone(),
            Value::String(render_mapping_value(pattern, span_attributes)),
        );
    }

    input_variables
}

fn render_mapping_value(pattern: &str, attrs: &HashMap<String, Value>) -> String {
    if pattern.starts_with("{{") && pattern.ends_with("}}") && pattern.len() > 4 {
        let path = pattern[2..pattern.len() - 2].trim();
        return get_attr(attrs, path);
    }
    pattern.to_string()
}

fn get_attr(attrs: &HashMap<String, Value>, path: &str) -> String {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = attrs.get(parts[0]);
    for part in &parts[1..] {
        current = current.and_then(|v| v.get(part));
    }
    match current {
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
        None => attrs
            .get(path)
            .map(|v| match v {
                Value::String(s) => s.clone(),
                v => v.to_string(),
            })
            .unwrap_or_default(),
    }
}

fn input_mapping_attributes(ctx: &SpanEvalContext) -> HashMap<String, Value> {
    let mut attrs = ctx.attributes.clone();
    attrs.insert("span_id".to_string(), Value::String(ctx.span_id.clone()));
    attrs.insert("trace_id".to_string(), Value::String(ctx.trace_id.clone()));
    attrs.insert(
        "pipeline_source_stream".to_string(),
        Value::String(ctx.source_stream.clone()),
    );
    attrs.insert(
        "pipeline_source_stream_type".to_string(),
        Value::String(ctx.source_stream_type.clone()),
    );
    if let Some(session_id) = &ctx.session_id {
        attrs.insert("session_id".to_string(), Value::String(session_id.clone()));
    }
    attrs
}

pub(crate) fn input_variables_with_context_defaults(
    input_variables: &HashMap<String, Value>,
    ctx: &SpanEvalContext,
) -> HashMap<String, Value> {
    let mut variables = input_mapping_attributes(ctx);
    for (key, value) in input_variables {
        if !matches!(value, Value::String(s) if s.is_empty()) {
            variables.insert(key.clone(), value.clone());
        }
    }
    variables
}

/// Execute scorers on a batch of span records.
///
/// This is the main entry point called from the LlmEvaluation pipeline node handler.
pub async fn execute_scorers(
    ctx: &SpanEvalContext,
    scorer_refs: &[ScorerRef],
) -> Result<ExecutorOutput> {
    let mut output = ExecutorOutput::empty();
    let job_input_mapping = match ctx.job_id.as_deref() {
        Some(job_id) => infra::table::online_eval_jobs::get_by_org(job_id, &ctx.org_id)
            .await?
            .and_then(|job| job.input_mapping),
        None => None,
    };

    for scorer_ref in scorer_refs {
        let mut resolved_scorer_type = None;
        let scorer_lookup = match scorer_ref.version {
            Some(v) => {
                infra::table::scorers::get_by_entity_id_and_version(&ctx.org_id, &scorer_ref.id, v)
                    .await
            }
            None => infra::table::scorers::get_by_entity_id(&ctx.org_id, &scorer_ref.id).await,
        };

        let score_result = match scorer_lookup {
            Ok(Some(scorer)) => {
                resolved_scorer_type = Some(scorer.scorer_type);
                let attrs = input_mapping_attributes(ctx);
                let input_variables =
                    resolve_scorer_input_variables(&job_input_mapping, &scorer_ref.id, &attrs);
                PreparedScorer::from_scorer(&ctx.org_id, scorer)
                    .await?
                    .execute(ctx, &input_variables)
                    .await
            }
            Ok(None) => {
                log::warn!(
                    "[EXECUTOR-RUNTIME] Scorer entity '{}' not found in org '{}'",
                    scorer_ref.id,
                    ctx.org_id
                );
                Ok(None)
            }
            Err(e) => Err(anyhow::anyhow!(
                "Failed to look up scorer entity '{}': {e}",
                scorer_ref.id
            )),
        };

        match score_result {
            Ok(Some(score_result)) => {
                output.scores.push(score_result.score_json);
                output.evaluator_traces.push(score_result.evaluator_trace);
            }
            Ok(None) => {
                log::debug!(
                    "[EXECUTOR-RUNTIME] Scorer entity '{}' resolved but returned no result",
                    scorer_ref.id
                );
            }
            Err(e) => {
                log::error!(
                    "[EXECUTOR-RUNTIME] Error executing scorer entity '{}': {e}",
                    scorer_ref.id
                );
                let execution_error = e.downcast_ref::<ScorerExecutionError>();
                let err_trace = create_evaluator_trace(EvaluatorTraceInput {
                    org_id: ctx.org_id.clone(),
                    evaluator_trace_id: ctx.evaluator_trace_id.clone(),
                    target_span_id: ctx.span_id.clone(),
                    target_trace_id: ctx.trace_id.clone(),
                    target_stream: ctx.source_stream.clone(),
                    target_stream_type: ctx.source_stream_type.clone(),
                    target_agent_name: ctx.target_agent_name.clone(),
                    target_agent_id: ctx.target_agent_id.clone(),
                    scorer_id: Some(scorer_ref.id.clone()),
                    scorer_version: Some("?".to_string()),
                    scorer_type: resolved_scorer_type,
                    job_id: ctx.job_id.clone(),
                    score_config_id: None,
                    score_config_version: None,
                    eval_run_id: ctx.eval_run_id.clone(),
                    provider_id: execution_error.and_then(|e| e.provider_id.clone()),
                    provider_name: execution_error.and_then(|e| e.provider_name.clone()),
                    provider_type: execution_error.and_then(|e| e.provider_type.clone()),
                    model: execution_error.and_then(|e| e.model.clone()),
                    latency_ms: execution_error.map(|e| e.latency_ms).unwrap_or(0),
                    prompt_tokens: execution_error.and_then(|e| e.prompt_tokens),
                    completion_tokens: execution_error.and_then(|e| e.completion_tokens),
                    total_tokens: execution_error.and_then(|e| e.total_tokens),
                    sampling_rate: ctx.sampling_rate,
                    sampled: ctx.sampled,
                    status: evaluator::status::ERROR.to_string(),
                    error_kind: Some("execution_error".to_string()),
                    error_message: Some(format!("{e}")),
                    skip_reason: None,
                    prompt: execution_error.and_then(|e| e.scorer_input.clone()),
                    response: execution_error.and_then(|e| e.raw_response.clone()),
                });
                output.evaluator_traces.push(err_trace);
                output.errors.push(EvalError {
                    scorer_id: scorer_ref.id.clone(),
                    scorer_type: resolved_scorer_type,
                    error_kind: "execution_error".to_string(),
                    error_message: format!("{e}"),
                    latency_ms: execution_error.map(|e| e.latency_ms).unwrap_or(0),
                });
            }
        }
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_context_from_basic_span() {
        let record = serde_json::json!({
            "span_id": "span-1",
            "trace_id": "trace-1",
            "span_name": "chat completion",
            "attributes": {
                "gen_ai.system": "openai",
                "gen_ai.request.model": "gpt-4o"
            }
        });

        let ctx =
            extract_context_from_span("org1", Some("job-1"), &record, "traces", "traces").unwrap();
        assert_eq!(ctx.org_id, "org1");
        assert_eq!(ctx.span_id, "span-1");
        assert_eq!(ctx.trace_id, "trace-1");
        assert_eq!(ctx.source_stream, "traces");
        assert_eq!(ctx.source_stream_type, "traces");
        assert_eq!(ctx.evaluator_trace_id.len(), 32);
        assert_ne!(ctx.evaluator_trace_id, ctx.trace_id);
        assert_eq!(ctx.job_id, Some("job-1".to_string()));
        assert_eq!(ctx.attributes.get("span_name").unwrap(), "chat completion");
        assert_eq!(ctx.attributes.get("gen_ai.system").unwrap(), "openai");
    }

    #[test]
    fn test_extract_context_no_span_id() {
        let record = serde_json::json!({
            "trace_id": "trace-1",
            "some_field": "value"
        });
        assert!(extract_context_from_span("org1", None, &record, "traces", "traces").is_none());
    }

    #[test]
    fn test_extract_context_with_session() {
        let record = serde_json::json!({
            "span_id": "span-2",
            "trace_id": "trace-2",
            "session_id": "session-1",
            "attributes": {}
        });
        let ctx = extract_context_from_span("org2", None, &record, "traces", "traces").unwrap();
        assert_eq!(ctx.session_id, Some("session-1".to_string()));
        assert_eq!(ctx.attributes.is_empty(), true);
    }

    #[test]
    fn test_extract_context_uses_pipeline_source_stream_defaults() {
        let record = serde_json::json!({
            "span_id": "span-2",
            "trace_id": "trace-2",
            "attributes": {}
        });

        let ctx = extract_context_from_span("org2", None, &record, "app_traces", "traces").unwrap();

        assert_eq!(ctx.source_stream, "app_traces");
        assert_eq!(ctx.source_stream_type, "traces");
    }

    #[test]
    fn test_extract_context_with_target_agent_identity() {
        let record = serde_json::json!({
            "span_id": "span-2",
            "trace_id": "trace-2",
            "attributes": {
                "gen_ai.agent.name": "agent-a",
                "gen_ai.agent.id": "agent-1"
            }
        });

        let ctx = extract_context_from_span("org2", None, &record, "traces", "traces").unwrap();

        assert_eq!(ctx.target_agent_name, Some("agent-a".to_string()));
        assert_eq!(ctx.target_agent_id, Some("agent-1".to_string()));
    }

    #[test]
    fn test_extract_context_with_flattened_target_agent_identity() {
        let record = serde_json::json!({
            "span_id": "span-2",
            "trace_id": "trace-2",
            "attributes_gen_ai_agent_name": "agent-a",
            "attributes_gen_ai_agent_id": "agent-1",
            "attributes": {}
        });

        let ctx = extract_context_from_span("org2", None, &record, "traces", "traces").unwrap();

        assert_eq!(ctx.target_agent_name, Some("agent-a".to_string()));
        assert_eq!(ctx.target_agent_id, Some("agent-1".to_string()));
    }

    #[test]
    fn test_resolve_scorer_input_variables_from_job_mapping() {
        let mapping = Some(
            serde_json::from_value(serde_json::json!({
                "scorer-1": {
                    "input": "{{gen_ai.prompt}}",
                    "output": "{{gen_ai.completion}}"
                }
            }))
            .unwrap(),
        );
        let attrs = HashMap::from([
            ("gen_ai.prompt".to_string(), serde_json::json!("question")),
            ("gen_ai.completion".to_string(), serde_json::json!("answer")),
        ]);

        let variables = resolve_scorer_input_variables(&mapping, "scorer-1", &attrs);

        assert_eq!(variables.get("input"), Some(&serde_json::json!("question")));
        assert_eq!(variables.get("output"), Some(&serde_json::json!("answer")));
    }

    #[test]
    fn test_input_mapping_attributes_include_span_context_fields() {
        let ctx = SpanEvalContext {
            org_id: "org1".to_string(),
            span_id: "span-1".to_string(),
            trace_id: "trace-1".to_string(),
            target_agent_name: None,
            target_agent_id: None,
            evaluator_trace_id: "11111111111111111111111111111111".to_string(),
            session_id: Some("session-1".to_string()),
            source_stream: "traces".to_string(),
            source_stream_type: "traces".to_string(),
            job_id: Some("job-1".to_string()),
            eval_run_id: None,
            sampling_rate: None,
            sampled: None,
            attributes: HashMap::from([("input".to_string(), serde_json::json!("question"))]),
        };
        let mapping = Some(
            serde_json::from_value(serde_json::json!({
                "scorer-1": {
                    "trace_id": "{{trace_id}}",
                    "span_id": "{{span_id}}",
                    "session_id": "{{session_id}}",
                    "stream": "{{pipeline_source_stream}}",
                    "stream_type": "{{pipeline_source_stream_type}}",
                    "input": "{{input}}"
                }
            }))
            .unwrap(),
        );

        let attrs = input_mapping_attributes(&ctx);
        let variables = resolve_scorer_input_variables(&mapping, "scorer-1", &attrs);

        assert_eq!(
            variables.get("trace_id"),
            Some(&serde_json::json!("trace-1"))
        );
        assert_eq!(variables.get("span_id"), Some(&serde_json::json!("span-1")));
        assert_eq!(
            variables.get("session_id"),
            Some(&serde_json::json!("session-1"))
        );
        assert_eq!(variables.get("stream"), Some(&serde_json::json!("traces")));
        assert_eq!(
            variables.get("stream_type"),
            Some(&serde_json::json!("traces"))
        );
        assert_eq!(variables.get("input"), Some(&serde_json::json!("question")));
    }

    #[test]
    fn test_input_variables_with_context_defaults_override_empty_context_fields() {
        let ctx = SpanEvalContext {
            org_id: "org1".to_string(),
            span_id: "span-1".to_string(),
            trace_id: "trace-1".to_string(),
            target_agent_name: None,
            target_agent_id: None,
            evaluator_trace_id: "11111111111111111111111111111111".to_string(),
            session_id: Some("session-1".to_string()),
            source_stream: "traces".to_string(),
            source_stream_type: "traces".to_string(),
            job_id: Some("job-1".to_string()),
            eval_run_id: None,
            sampling_rate: None,
            sampled: None,
            attributes: HashMap::new(),
        };
        let input_variables = HashMap::from([
            ("trace_id".to_string(), serde_json::json!("")),
            ("input".to_string(), serde_json::json!("question")),
        ]);

        let variables = input_variables_with_context_defaults(&input_variables, &ctx);

        assert_eq!(
            variables.get("trace_id"),
            Some(&serde_json::json!("trace-1"))
        );
        assert_eq!(variables.get("span_id"), Some(&serde_json::json!("span-1")));
        assert_eq!(
            variables.get("session_id"),
            Some(&serde_json::json!("session-1"))
        );
        assert_eq!(variables.get("input"), Some(&serde_json::json!("question")));
    }
}
