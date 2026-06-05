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

use std::sync::LazyLock as Lazy;

use anyhow::Result;
use config::{
    meta::{
        self_reporting::evaluator::{self},
        stream::StreamType,
    },
    utils::schema::schema_eq,
};
use dashmap::DashSet;
use serde::{Deserialize, Serialize};

static INITIALIZED_ORGS: Lazy<DashSet<String>> = Lazy::new(DashSet::new);

pub async fn ensure_evaluator_stream_initialized(org_id: &str) -> Result<()> {
    if !INITIALIZED_ORGS.insert(org_id.to_string()) {
        return Ok(());
    }

    if let Err(e) = initialize_evaluator_stream_schema(org_id).await {
        log::warn!(
            "[EVALUATOR] Failed to initialize _evaluator stream schema for org {org_id}: {e}"
        );
    }

    Ok(())
}

/// Reflection struct representing the flattened fields of an evaluator trace span.
/// After the evaluator trace JSON is flattened by `flatten::flatten()`, the
/// `attributes` nested object becomes `attributes_<key>` prefixed fields.
/// This struct mirrors that flattened output so the schema can be initialized
/// before any data is ingested.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct EvaluatorSpanReflection {
    _timestamp: i64,
    operation_name: String,
    span_id: String,
    trace_id: String,
    parent_span_id: String,
    event: String,
    span_kind: String,
    span_status: String,
    service_name: String,
    start_time: u64,
    end_time: u64,
    duration: u64,
    flags: u8,
    events: String,
    links: String,
    attributes_target_span_id: String,
    attributes_target_trace_id: String,
    attributes_target_stream: String,
    attributes_scorer_id: String,
    attributes_scorer_version: String,
    attributes_scorer_type: String,
    attributes_job_id: String,
    attributes_score_config_id: String,
    attributes_score_config_version: String,
    attributes_eval_run_id: String,
    attributes_provider_id: String,
    attributes_provider_name: String,
    attributes_provider_type: String,
    attributes_model: String,
    attributes_latency_ms: i64,
    attributes_prompt_tokens: i64,
    attributes_completion_tokens: i64,
    attributes_total_tokens: i64,
    attributes_sampling_rate: f64,
    attributes_sampled: bool,
    attributes_status: String,
    attributes_error_kind: String,
    attributes_error_message: String,
    attributes_skip_reason: String,
    attributes_prompt: String,
    attributes_response: String,
}

impl EvaluatorSpanReflection {
    fn init_for_reflection() -> Self {
        Self {
            _timestamp: 0,
            operation_name: String::new(),
            span_id: String::new(),
            trace_id: String::new(),
            parent_span_id: String::new(),
            event: String::new(),
            span_kind: String::new(),
            span_status: String::new(),
            service_name: String::new(),
            start_time: 0,
            end_time: 0,
            duration: 0,
            flags: 0,
            events: String::new(),
            links: String::new(),
            attributes_target_span_id: String::new(),
            attributes_target_trace_id: String::new(),
            attributes_target_stream: String::new(),
            attributes_scorer_id: String::new(),
            attributes_scorer_version: String::new(),
            attributes_scorer_type: String::new(),
            attributes_job_id: String::new(),
            attributes_score_config_id: String::new(),
            attributes_score_config_version: String::new(),
            attributes_eval_run_id: String::new(),
            attributes_provider_id: String::new(),
            attributes_provider_name: String::new(),
            attributes_provider_type: String::new(),
            attributes_model: String::new(),
            attributes_latency_ms: 0,
            attributes_prompt_tokens: 0,
            attributes_completion_tokens: 0,
            attributes_total_tokens: 0,
            attributes_sampling_rate: 0.0,
            attributes_sampled: false,
            attributes_status: String::new(),
            attributes_error_kind: String::new(),
            attributes_error_message: String::new(),
            attributes_skip_reason: String::new(),
            attributes_prompt: String::new(),
            attributes_response: String::new(),
        }
    }
}

async fn initialize_evaluator_stream_schema(org_id: &str) -> Result<()> {
    let stream_name = evaluator::EVALUATOR_STREAM;
    let stream_type = StreamType::Traces;

    log::info!("[EVALUATOR] Creating _evaluator stream schema for {org_id}/{stream_name}");

    let sample = EvaluatorSpanReflection::init_for_reflection();
    let json_value = config::utils::json::to_value(&sample)?;
    let json_map = json_value.as_object().ok_or_else(|| {
        anyhow::anyhow!("Failed to convert EvaluatorSpanReflection to JSON object")
    })?;

    let expected_schema = config::utils::schema::infer_json_schema_from_map(
        stream_name,
        stream_type,
        std::iter::once(json_map),
    )?;

    if infra::schema::get(org_id, stream_name, stream_type)
        .await
        .is_ok_and(|ref schema| schema_eq(schema, &expected_schema))
    {
        log::debug!(
            "[EVALUATOR] _evaluator stream {org_id}/{stream_name} already exists with expected schema"
        );
        return Ok(());
    }

    match crate::service::db::schema::merge(
        org_id,
        stream_name,
        stream_type,
        &expected_schema,
        Some(config::utils::time::now_micros()),
    )
    .await
    {
        Ok(_) => {
            log::info!(
                "[EVALUATOR] Successfully created _evaluator stream schema for {org_id}/{stream_name} with {} fields",
                expected_schema.fields().len()
            );
            Ok(())
        }
        Err(e) => {
            log::error!(
                "[EVALUATOR] Failed to create _evaluator stream schema for {org_id}/{stream_name}: {e}"
            );
            Err(anyhow::anyhow!("Schema creation failed: {}", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ensure_evaluator_stream_initialized_marks_org() {
        let test_org = "test_evaluator_org_1";
        let result = ensure_evaluator_stream_initialized(test_org).await;
        assert!(result.is_ok());
        assert!(INITIALIZED_ORGS.contains(test_org));
    }

    #[tokio::test]
    async fn test_ensure_evaluator_stream_initialized_idempotent() {
        let test_org = "test_evaluator_org_2";
        let r1 = ensure_evaluator_stream_initialized(test_org).await;
        let r2 = ensure_evaluator_stream_initialized(test_org).await;
        assert!(r1.is_ok());
        assert!(r2.is_ok());
    }

    #[test]
    fn test_evaluator_span_reflection_has_all_fields() {
        let sample = EvaluatorSpanReflection::init_for_reflection();
        let json_value = config::utils::json::to_value(&sample).unwrap();
        let obj = json_value.as_object().unwrap();
        assert!(obj.contains_key("_timestamp"));
        assert!(obj.contains_key("operation_name"));
        assert!(obj.contains_key("span_id"));
        assert!(obj.contains_key("trace_id"));
        assert!(obj.contains_key("parent_span_id"));
        assert!(obj.contains_key("span_kind"));
        assert!(obj.contains_key("span_status"));
        assert!(obj.contains_key("service_name"));
        assert!(obj.contains_key("start_time"));
        assert!(obj.contains_key("end_time"));
        assert!(obj.contains_key("duration"));
        assert!(obj.contains_key("flags"));
        assert!(obj.contains_key("events"));
        assert!(obj.contains_key("links"));
        assert!(obj.contains_key("attributes_target_span_id"));
        assert!(obj.contains_key("attributes_target_trace_id"));
        assert!(obj.contains_key("attributes_target_stream"));
        assert!(obj.contains_key("attributes_scorer_id"));
        assert!(obj.contains_key("attributes_scorer_version"));
        assert!(obj.contains_key("attributes_scorer_type"));
        assert!(obj.contains_key("attributes_job_id"));
        assert!(obj.contains_key("attributes_score_config_id"));
        assert!(obj.contains_key("attributes_score_config_version"));
        assert!(obj.contains_key("attributes_eval_run_id"));
        assert!(obj.contains_key("attributes_provider_id"));
        assert!(obj.contains_key("attributes_provider_name"));
        assert!(obj.contains_key("attributes_provider_type"));
        assert!(obj.contains_key("attributes_model"));
        assert!(obj.contains_key("attributes_latency_ms"));
        assert!(obj.contains_key("attributes_prompt_tokens"));
        assert!(obj.contains_key("attributes_completion_tokens"));
        assert!(obj.contains_key("attributes_total_tokens"));
        assert!(obj.contains_key("attributes_sampling_rate"));
        assert!(obj.contains_key("attributes_sampled"));
        assert!(obj.contains_key("attributes_status"));
        assert!(obj.contains_key("attributes_error_kind"));
        assert!(obj.contains_key("attributes_error_message"));
        assert!(obj.contains_key("attributes_skip_reason"));
        assert!(obj.contains_key("attributes_prompt"));
        assert!(obj.contains_key("attributes_response"));
    }
}
