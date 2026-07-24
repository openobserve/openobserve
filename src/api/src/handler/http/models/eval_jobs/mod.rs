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

use config::meta::pipeline::components::ScorerRef;
use infra::table::online_eval_jobs::{
    JobInputMapping, SamplingMode, SessionEvalConfig, SpanSelector, SpanSelectorBindings,
    TargetScope, TraceEvalConfig,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// HTTP request body for creating or updating an Online Eval Job.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvalJobRequestBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub stream: String,
    pub stream_type: String,
    #[serde(default)]
    #[schema(value_type = String)]
    pub target_scope: TargetScope,
    pub filter_condition: serde_json::Value,
    pub scorers: Vec<ScorerRef>,
    #[serde(default)]
    pub input_mapping: Option<JobInputMapping>,
    #[serde(default)]
    #[schema(value_type = Vec<Object>)]
    pub span_selectors: Vec<SpanSelector>,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub span_selector_bindings: SpanSelectorBindings,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub trace_config: Option<TraceEvalConfig>,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub session_config: Option<SessionEvalConfig>,
    #[schema(value_type = String)]
    pub sampling_mode: SamplingMode,
    pub sampling_value: serde_json::Value,
}

/// HTTP response body for a single Online Eval Job.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvalJobResponseBody {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub stream: String,
    pub stream_type: String,
    #[schema(value_type = String)]
    pub target_scope: TargetScope,
    pub filter_condition: serde_json::Value,
    pub scorers: Vec<ScorerRef>,
    pub input_mapping: Option<JobInputMapping>,
    #[schema(value_type = Vec<Object>)]
    pub span_selectors: Vec<SpanSelector>,
    #[schema(value_type = Object)]
    pub span_selector_bindings: SpanSelectorBindings,
    #[schema(value_type = Object)]
    pub trace_config: Option<TraceEvalConfig>,
    #[schema(value_type = Object)]
    pub session_config: Option<SessionEvalConfig>,
    #[schema(value_type = String)]
    pub sampling_mode: SamplingMode,
    pub sampling_value: serde_json::Value,
    pub status: String,
    pub version: i32,
    pub pipeline_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// HTTP response body for listing Online Eval Jobs.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListEvalJobsResponseBody {
    pub list: Vec<EvalJobResponseBody>,
}

/// Query string params for listing eval jobs.
#[derive(Clone, Debug, Deserialize, Default, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListEvalJobsQuery {
    #[serde(default)]
    pub status: Option<String>,
}

/// HTTP response body for status-transition endpoints (activate/pause/resume/archive).
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvalJobStatusActionResponseBody {
    pub id: String,
    pub status: String,
    pub pipeline_id: Option<String>,
    pub updated_at: i64,
}

impl TryFrom<EvalJobRequestBody> for infra::table::online_eval_jobs::OnlineEvalJob {
    type Error = &'static str;

    fn try_from(value: EvalJobRequestBody) -> Result<Self, Self::Error> {
        let name = value.name.trim().to_string();
        if name.is_empty() {
            return Err("Job name cannot be empty");
        }

        let stream = value.stream.trim().to_string();
        if stream.is_empty() {
            return Err("Stream name cannot be empty");
        }

        if value.scorers.is_empty() {
            return Err("At least one scorer is required");
        }

        let mut job = Self {
            id: String::new(),
            org_id: String::new(),
            name,
            description: value.description,
            stream,
            stream_type: value.stream_type,
            target_scope: value.target_scope,
            filter_condition: value.filter_condition,
            scorers: value.scorers,
            input_mapping: value.input_mapping,
            span_selectors: value.span_selectors,
            span_selector_bindings: value.span_selector_bindings,
            trace_config: value.trace_config,
            session_config: value.session_config,
            sampling_mode: value.sampling_mode,
            sampling_value: value.sampling_value,
            status: "draft".to_string(),
            version: 0,
            pipeline_id: None,
            created_at: 0,
            updated_at: 0,
        };
        job.apply_target_scope_defaults();
        job.normalize_sampling()?;
        job.validate()?;
        Ok(job)
    }
}

impl From<infra::table::online_eval_jobs::OnlineEvalJob> for EvalJobResponseBody {
    fn from(value: infra::table::online_eval_jobs::OnlineEvalJob) -> Self {
        let sampling_value = match value.sampling_rate() {
            Ok(rate) if value.sampling_mode == SamplingMode::Rate => serde_json::json!(rate),
            Ok(_) if value.sampling_mode == SamplingMode::All => serde_json::Value::Null,
            _ => value.sampling_value.clone(),
        };
        Self {
            id: value.id,
            org_id: value.org_id,
            name: value.name,
            description: value.description,
            stream: value.stream,
            stream_type: value.stream_type,
            target_scope: value.target_scope,
            filter_condition: value.filter_condition,
            scorers: value.scorers,
            input_mapping: value.input_mapping,
            span_selectors: value.span_selectors,
            span_selector_bindings: value.span_selector_bindings,
            trace_config: value.trace_config,
            session_config: value.session_config,
            sampling_mode: value.sampling_mode,
            sampling_value,
            status: value.status,
            version: value.version,
            pipeline_id: value.pipeline_id,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl From<Vec<infra::table::online_eval_jobs::OnlineEvalJob>> for ListEvalJobsResponseBody {
    fn from(value: Vec<infra::table::online_eval_jobs::OnlineEvalJob>) -> Self {
        Self {
            list: value.into_iter().map(EvalJobResponseBody::from).collect(),
        }
    }
}

impl From<infra::table::online_eval_jobs::OnlineEvalJob> for EvalJobStatusActionResponseBody {
    fn from(value: infra::table::online_eval_jobs::OnlineEvalJob) -> Self {
        Self {
            id: value.id,
            status: value.status,
            pipeline_id: value.pipeline_id,
            updated_at: value.updated_at,
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "enterprise")]
    use openobserve_core::llm_evaluations::eval_jobs::ManualEvalJobRequestBody;

    use super::*;

    fn sample_job() -> infra::table::online_eval_jobs::OnlineEvalJob {
        infra::table::online_eval_jobs::OnlineEvalJob {
            id: "job-1".to_string(),
            org_id: "org1".to_string(),
            name: "nightly-eval".to_string(),
            description: Some("Nightly faithfulness eval".to_string()),
            stream: "default".to_string(),
            stream_type: "traces".to_string(),
            target_scope: TargetScope::Span,
            filter_condition: serde_json::json!({"op": "and", "conditions": []}),
            scorers: vec![
                ScorerRef {
                    id: "scorer-entity-1".to_string(),
                    version: None,
                },
                ScorerRef {
                    id: "scorer-entity-2".to_string(),
                    version: None,
                },
            ],
            input_mapping: None,
            span_selectors: Vec::new(),
            span_selector_bindings: Default::default(),
            trace_config: None,
            session_config: None,
            sampling_mode: SamplingMode::Rate,
            sampling_value: serde_json::json!(0.1),
            status: "active".to_string(),
            version: 3,
            pipeline_id: Some("pipe-9".to_string()),
            created_at: 1000,
            updated_at: 2000,
        }
    }

    #[test]
    fn test_eval_job_request_body_conversion_defaults() {
        let body = EvalJobRequestBody {
            name: "nightly".to_string(),
            description: None,
            stream: "default".to_string(),
            stream_type: "traces".to_string(),
            target_scope: TargetScope::Span,
            filter_condition: serde_json::json!({}),
            scorers: vec![ScorerRef {
                id: "s1".to_string(),
                version: None,
            }],
            input_mapping: None,
            span_selectors: Vec::new(),
            span_selector_bindings: Default::default(),
            trace_config: None,
            session_config: None,
            sampling_mode: SamplingMode::All,
            sampling_value: serde_json::json!(null),
        };
        let job = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap();
        assert!(job.id.is_empty());
        assert!(job.org_id.is_empty());
        assert_eq!(job.name, "nightly");
        assert_eq!(job.status, "draft");
        assert_eq!(job.version, 0);
        assert!(job.pipeline_id.is_none());
        assert_eq!(job.created_at, 0);
        assert_eq!(job.updated_at, 0);
        assert_eq!(job.scorers.len(), 1);
    }

    #[test]
    fn test_eval_job_request_body_rejects_internal_source_stream() {
        let body = EvalJobRequestBody {
            name: "recursive".to_string(),
            description: None,
            stream: "_evaluator".to_string(),
            stream_type: "traces".to_string(),
            target_scope: TargetScope::Span,
            filter_condition: serde_json::json!({}),
            scorers: vec![ScorerRef {
                id: "s1".to_string(),
                version: Some(1),
            }],
            input_mapping: None,
            span_selectors: Vec::new(),
            span_selector_bindings: Default::default(),
            trace_config: None,
            session_config: None,
            sampling_mode: SamplingMode::All,
            sampling_value: serde_json::Value::Null,
        };

        let error = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap_err();
        assert_eq!(
            error,
            "Internal streams cannot be used as online eval sources"
        );
    }

    #[test]
    fn test_eval_job_response_body_from_entity_preserves_all_fields() {
        let job = sample_job();
        let resp = EvalJobResponseBody::from(job);
        assert_eq!(resp.id, "job-1");
        assert_eq!(resp.org_id, "org1");
        assert_eq!(resp.name, "nightly-eval");
        assert_eq!(resp.stream, "default");
        assert_eq!(resp.stream_type, "traces");
        assert_eq!(resp.target_scope, TargetScope::Span);
        assert_eq!(resp.scorers.len(), 2);
        assert_eq!(resp.sampling_mode, SamplingMode::Rate);
        assert_eq!(resp.status, "active");
        assert_eq!(resp.version, 3);
        assert_eq!(resp.pipeline_id.as_deref(), Some("pipe-9"));
        assert_eq!(resp.created_at, 1000);
        assert_eq!(resp.updated_at, 2000);
    }

    #[test]
    fn test_eval_job_response_normalizes_legacy_sampling_value() {
        let mut job = sample_job();
        job.sampling_value = serde_json::json!({"rate": 0.2});

        let resp = EvalJobResponseBody::from(job);

        assert_eq!(resp.sampling_value, serde_json::json!(0.2));
    }

    #[test]
    fn test_list_eval_jobs_response_body_from_vec() {
        let jobs = vec![sample_job(), sample_job()];
        let list = ListEvalJobsResponseBody::from(jobs);
        assert_eq!(list.list.len(), 2);
        assert_eq!(list.list[0].name, "nightly-eval");
    }

    #[test]
    fn test_eval_job_status_action_response_body_from_entity() {
        let job = sample_job();
        let action = EvalJobStatusActionResponseBody::from(job);
        assert_eq!(action.id, "job-1");
        assert_eq!(action.status, "active");
        assert_eq!(action.pipeline_id.as_deref(), Some("pipe-9"));
        assert_eq!(action.updated_at, 2000);
    }

    #[test]
    fn test_manual_eval_job_request_camel_case_deserialization() {
        let json = r#"{
            "targetId": "trace-1",
            "startTime": 1000,
            "endTime": 2000,
            "traceId": "trace-1",
            "sessionId": "session-1",
            "variables": { "input": "hello" },
            "reason": "operator retry"
        }"#;

        let body: ManualEvalJobRequestBody = serde_json::from_str(json).unwrap();

        assert_eq!(body.target_id, "trace-1");
        assert_eq!(body.start_time, 1000);
        assert_eq!(body.end_time, 2000);
        assert_eq!(body.trace_id.as_deref(), Some("trace-1"));
        assert_eq!(body.session_id.as_deref(), Some("session-1"));
        assert_eq!(body.variables["input"], serde_json::json!("hello"));
        assert_eq!(body.reason.as_deref(), Some("operator retry"));
    }

    #[test]
    fn test_eval_job_request_body_camel_case_deserialization() {
        let json = r#"{
            "name": "j",
            "stream": "default",
            "streamType": "traces",
            "filterCondition": {},
            "scorers": ["a"],
            "samplingMode": "rate",
            "samplingValue": 0.05
        }"#;
        let body: EvalJobRequestBody = serde_json::from_str(json).unwrap();
        assert_eq!(body.stream_type, "traces");
        assert_eq!(body.sampling_mode, SamplingMode::Rate);
        assert!(body.input_mapping.is_none());
        assert!(body.description.is_none());
        assert_eq!(body.target_scope, TargetScope::Span);
    }

    #[test]
    fn test_eval_job_request_body_accepts_scalar_sampling_rate() {
        let json = r#"{
            "name": "j",
            "stream": "default",
            "streamType": "traces",
            "filterCondition": {},
            "scorers": ["a"],
            "samplingMode": "rate",
            "samplingValue": 0.05
        }"#;

        let body: EvalJobRequestBody = serde_json::from_str(json).unwrap();
        let job = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap();

        assert!((job.sampling_rate().unwrap() - 0.05).abs() < f64::EPSILON);
        assert_eq!(job.sampling_value, serde_json::json!(0.05));
    }

    #[test]
    fn test_eval_job_request_body_rejects_invalid_sampling() {
        for (mode, value) in [("rate", "1.5"), ("rate", "null"), ("count", "100")] {
            let json = format!(
                r#"{{
                    "name": "j",
                    "stream": "default",
                    "streamType": "logs",
                    "filterCondition": {{}},
                    "scorers": ["a"],
                    "samplingMode": "{mode}",
                    "samplingValue": {value}
                }}"#
            );

            let body: EvalJobRequestBody = serde_json::from_str(&json).unwrap();
            assert!(infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).is_err());
        }
    }

    #[test]
    fn test_eval_job_request_body_preserves_multiple_input_mappings() {
        let json = r#"{
            "name": "j",
            "stream": "default",
            "streamType": "traces",
            "filterCondition": {},
            "scorers": ["scorer-1", "scorer-2"],
            "inputMapping": {
                "scorer-1": {
                    "input": "{{gen_ai_input_messages}}",
                    "output": "{{gen_ai_output_messages}}",
                    "context": "{{gen_ai_system_instructions}}"
                },
                "scorer-2": {
                    "input": "{{gen_ai_input_messages}}",
                    "output": "{{gen_ai_output_messages}}",
                    "expected": "{{gen_ai_system_instructions}}",
                    "trace_id": "{{trace_id}}"
                }
            },
            "samplingMode": "all",
            "samplingValue": null
        }"#;

        let body: EvalJobRequestBody = serde_json::from_str(json).unwrap();
        let job = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap();
        let mapping = job.input_mapping.unwrap();

        assert_eq!(mapping.len(), 2);
        assert_eq!(
            mapping["scorer-1"]["context"],
            "{{gen_ai_system_instructions}}"
        );
        assert_eq!(mapping["scorer-2"]["trace_id"], "{{trace_id}}");
    }

    #[test]
    fn test_eval_job_request_body_rejects_non_string_input_mapping_values() {
        let json = r#"{
            "name": "j",
            "stream": "default",
            "streamType": "logs",
            "filterCondition": {},
            "scorers": ["scorer-1"],
            "inputMapping": {
                "scorer-1": {
                    "input": 42
                }
            },
            "samplingMode": "all",
            "samplingValue": null
        }"#;

        assert!(serde_json::from_str::<EvalJobRequestBody>(json).is_err());
    }

    #[test]
    fn test_eval_job_request_body_trace_scope_defaults_config() {
        let json = r#"{
            "name": "j",
            "stream": "traces",
            "streamType": "traces",
            "targetScope": "trace",
            "filterCondition": {},
            "scorers": ["scorer-1"],
            "samplingMode": "all",
            "samplingValue": null
        }"#;

        let body: EvalJobRequestBody = serde_json::from_str(json).unwrap();
        let job = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap();

        assert_eq!(job.target_scope, TargetScope::Trace);
        assert_eq!(job.trace_config.unwrap().idle_window_secs, 120);
        assert!(job.session_config.is_none());
    }

    #[test]
    fn test_eval_job_request_body_session_scope_defaults_idle_window() {
        let json = r#"{
            "name": "j",
            "stream": "traces",
            "streamType": "traces",
            "targetScope": "session",
            "filterCondition": {},
            "scorers": ["scorer-1"],
            "samplingMode": "all",
            "samplingValue": null
        }"#;

        let body: EvalJobRequestBody = serde_json::from_str(json).unwrap();
        let job = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap();

        assert_eq!(job.target_scope, TargetScope::Session);
        assert_eq!(job.session_config.unwrap().idle_window_secs, 120);
        assert!(job.trace_config.is_none());
    }

    #[test]
    fn test_eval_job_request_body_accepts_named_span_selector_bindings() {
        let json = r#"{
            "name": "trace-selector",
            "stream": "traces",
            "streamType": "traces",
            "targetScope": "trace",
            "filterCondition": {"type": "all"},
            "scorers": ["scorer-1"],
            "spanSelectors": [{
                "id": "selector-1",
                "name": "tool-spans",
                "filterCondition": {"type": "all"},
                "fieldMode": "custom",
                "fields": ["span_id", "gen_ai_tool_name"],
                "maximumSpans": 4
            }],
            "spanSelectorBindings": {
                "scorer-1": "selector-1"
            },
            "samplingMode": "all",
            "samplingValue": null
        }"#;

        let body: EvalJobRequestBody = serde_json::from_str(json).unwrap();
        let job = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap();

        assert!(job.validate_for_activation().is_ok());
        assert_eq!(job.span_selectors.len(), 1);
        assert_eq!(job.span_selectors[0].name, "tool-spans");
        assert_eq!(job.span_selectors[0].maximum_spans, 4);
        assert_eq!(
            job.span_selector_bindings
                .get("scorer-1")
                .map(String::as_str),
            Some("selector-1")
        );
    }

    #[test]
    fn test_eval_job_request_body_trace_end_signal_round_trip() {
        let signal = serde_json::json!({
            "version": 2,
            "conditions": {
                "filterType": "group",
                "logicalOperator": "AND",
                "conditions": [{
                    "filterType": "condition",
                    "column": "status",
                    "operator": "=",
                    "value": "complete",
                    "values": [],
                    "logicalOperator": "AND"
                }]
            }
        });
        let json = serde_json::json!({
            "name": "trace-end-signal",
            "stream": "traces",
            "streamType": "traces",
            "targetScope": "trace",
            "traceConfig": {
                "idleWindowSecs": 120,
                "maxAgeSecs": 1800,
                "endSignal": signal
            },
            "filterCondition": {},
            "scorers": ["scorer-1"],
            "samplingMode": "all",
            "samplingValue": null
        });

        let body: EvalJobRequestBody = serde_json::from_value(json).unwrap();
        let job = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap();
        assert_eq!(
            job.trace_config.as_ref().unwrap().end_signal.as_ref(),
            Some(&signal)
        );
        assert!(job.session_config.is_none());

        let response = EvalJobResponseBody::from(job);
        let response_json = serde_json::to_value(response).unwrap();
        assert_eq!(response_json["traceConfig"]["endSignal"], signal);
        assert!(response_json["sessionConfig"].is_null());
    }

    #[test]
    fn test_eval_job_request_body_session_end_signal_uses_session_config_only() {
        let json = r#"{
            "name": "session-end-signal",
            "stream": "traces",
            "streamType": "traces",
            "targetScope": "session",
            "sessionConfig": {
                "idleWindowSecs": 60,
                "maxAgeSecs": 3600,
                "endSignal": {
                    "version": 2,
                    "conditions": {
                        "filterType": "group",
                        "logicalOperator": "AND",
                        "conditions": [{
                            "filterType": "condition",
                            "column": "session.status",
                            "operator": "=",
                            "value": "complete",
                            "logicalOperator": "AND"
                        }]
                    }
                }
            },
            "filterCondition": {},
            "scorers": ["scorer-1"],
            "samplingMode": "all",
            "samplingValue": null
        }"#;

        let body: EvalJobRequestBody = serde_json::from_str(json).unwrap();
        let job = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap();

        assert!(job.trace_config.is_none());
        assert!(job.session_config.as_ref().unwrap().end_signal.is_some());
    }

    #[test]
    fn test_eval_job_request_body_rejects_invalid_end_signal() {
        let json = r#"{
            "name": "invalid-end-signal",
            "stream": "traces",
            "streamType": "traces",
            "targetScope": "trace",
            "traceConfig": {
                "idleWindowSecs": 120,
                "maxAgeSecs": 1800,
                "endSignal": { "column": "status", "operator": "=" }
            },
            "filterCondition": {},
            "scorers": ["scorer-1"],
            "samplingMode": "all",
            "samplingValue": null
        }"#;

        let body: EvalJobRequestBody = serde_json::from_str(json).unwrap();
        let err = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap_err();

        assert_eq!(err, "End signal must be a valid condition");
    }

    #[test]
    fn test_eval_job_request_body_rejects_invalid_completion_window() {
        let json = r#"{
            "name": "j",
            "stream": "traces",
            "streamType": "traces",
            "targetScope": "session",
            "sessionConfig": { "idleWindowSecs": 60, "maxAgeSecs": 30 },
            "filterCondition": {},
            "scorers": ["scorer-1"],
            "samplingMode": "all",
            "samplingValue": null
        }"#;

        let body: EvalJobRequestBody = serde_json::from_str(json).unwrap();
        let err = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap_err();

        assert_eq!(err, "Completion idle window cannot exceed max age");
    }

    #[test]
    fn test_eval_job_request_body_rejects_idle_window_below_scheduler_poll_interval() {
        let json = r#"{
            "name": "j",
            "stream": "traces",
            "streamType": "traces",
            "targetScope": "trace",
            "traceConfig": { "idleWindowSecs": 44, "maxAgeSecs": 1800 },
            "filterCondition": {},
            "scorers": ["scorer-1"],
            "samplingMode": "all",
            "samplingValue": null
        }"#;

        let body: EvalJobRequestBody = serde_json::from_str(json).unwrap();
        let err = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap_err();

        assert_eq!(err, "Completion idle window must be at least 45 seconds");
    }

    #[test]
    fn test_eval_job_request_body_rejects_invalid_target_scope() {
        let json = r#"{
            "name": "j",
            "stream": "traces",
            "streamType": "traces",
            "targetScope": "bogus",
            "filterCondition": {},
            "scorers": ["scorer-1"],
            "samplingMode": "all",
            "samplingValue": null
        }"#;

        let body: EvalJobRequestBody = serde_json::from_str(json).unwrap();
        let err = infra::table::online_eval_jobs::OnlineEvalJob::try_from(body).unwrap_err();

        assert_eq!(err, "Invalid target scope");
    }
}
