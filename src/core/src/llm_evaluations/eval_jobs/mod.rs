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

//! Online Eval Job service layer.
//!
//! Jobs are the user-facing scheduling primitive that ties a target stream to
//! a set of scorers. Span-scope jobs are reconciled to a hidden evaluation
//! pipeline ([`PipelineKind::Evaluation`]) for eligibility detection, while
//! trace/session jobs are detected by the Eval Scheduler.

use std::collections::BTreeMap;

use chrono::Utc;
use common::meta::authz::Authz;
use config::{ider, meta::stream::StreamType};
use db::authz::{remove_ownership, set_ownership};
use infra::table;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::auth::is_ofga_object_visible;

pub mod reconciler;
pub use o2_enterprise::enterprise::llm_evaluations::eval_jobs::executor_runtime;

/// Errors that can occur when interacting with online eval jobs.
#[derive(Debug, thiserror::Error)]
pub enum EvalJobError {
    #[error("InfraError# Internal error")]
    InfraError(#[from] infra::errors::Error),

    #[error("Job not found")]
    NotFound,

    #[error("Invalid status '{0}'. Must be one of: draft, active, paused, degraded, archived")]
    InvalidStatus(String),

    #[error("Invalid status transition from '{from}' to '{to}'")]
    InvalidStatusTransition { from: String, to: String },

    #[error("Invalid eval job: {0}")]
    InvalidJob(String),

    #[error("ReconcilerError# {0}")]
    ReconcilerError(String),
}

/// Request body for manually evaluating an explicit target with a job's scorers.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManualEvalJobRequestBody {
    pub target_id: String,
    /// Inclusive source telemetry window start, in microseconds.
    pub start_time: i64,
    /// Exclusive source telemetry window end, in microseconds.
    pub end_time: i64,
    #[serde(default)]
    pub span_id: Option<String>,
    #[serde(default)]
    pub trace_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub variables: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub reason: Option<String>,
}

/// Response body for manual evaluation task creation.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManualEvalJobResponseBody {
    pub job_id: String,
    #[schema(value_type = String)]
    pub target_scope: table::online_eval_jobs::TargetScope,
    pub target_id: String,
    pub tasks_created: usize,
}

fn merge_input_mapping(
    existing: Option<table::online_eval_jobs::JobInputMapping>,
    incoming: Option<table::online_eval_jobs::JobInputMapping>,
) -> Option<table::online_eval_jobs::JobInputMapping> {
    match (existing, incoming) {
        (Some(mut existing), Some(incoming)) => {
            existing.extend(incoming);
            Some(existing)
        }
        (_, incoming) => incoming,
    }
}

fn ensure_source_stream_exists(stream: &str, exists: bool) -> Result<(), EvalJobError> {
    if exists {
        Ok(())
    } else {
        Err(EvalJobError::InvalidJob(format!(
            "Trace stream '{stream}' not found"
        )))
    }
}

fn normalize_manual_target_id(target_id: &str) -> Result<String, EvalJobError> {
    let target_id = target_id.trim();
    if target_id.is_empty() {
        return Err(EvalJobError::InvalidJob(
            "targetId must not be empty".to_string(),
        ));
    }

    Ok(target_id.to_string())
}

fn validate_manual_query_window(start_time: i64, end_time: i64) -> Result<(), EvalJobError> {
    if start_time < 0 {
        return Err(EvalJobError::InvalidJob(
            "startTime must not be negative".to_string(),
        ));
    }
    if end_time <= start_time {
        return Err(EvalJobError::InvalidJob(
            "endTime must be greater than startTime".to_string(),
        ));
    }
    Ok(())
}

async fn validate_source_stream(
    org_id: &str,
    job: &table::online_eval_jobs::OnlineEvalJob,
) -> Result<(), EvalJobError> {
    let schema = infra::schema::get(org_id, &job.stream, StreamType::Traces).await?;
    ensure_source_stream_exists(&job.stream, !schema.fields().is_empty())
}

#[tracing::instrument(skip(job))]
pub async fn create_job(
    org_id: &str,
    mut job: table::online_eval_jobs::OnlineEvalJob,
) -> Result<table::online_eval_jobs::OnlineEvalJob, EvalJobError> {
    job.id = ider::generate();
    job.org_id = org_id.to_string();
    job.version = 1;

    // New jobs always start in draft state.
    job.status = "draft".to_string();

    // New jobs get pipeline_ids assigned only
    // they are activated, and only for span-scope jobs.
    job.pipeline_id = None;
    job.apply_target_scope_defaults();
    job.normalize_sampling()
        .map_err(|e| EvalJobError::InvalidJob(e.to_string()))?;
    job.validate()
        .map_err(|e| EvalJobError::InvalidJob(e.to_string()))?;
    validate_source_stream(org_id, &job).await?;

    let now = Utc::now().timestamp_millis();
    job.created_at = now;
    job.updated_at = now;

    table::online_eval_jobs::add(&job).await?;
    set_ownership(org_id, "eval_jobs", Authz::new(&job.id)).await;
    publish_eval_job_put(&job).await;
    Ok(job)
}

#[tracing::instrument(skip(job))]
pub async fn update_job(
    org_id: &str,
    job_id: &str,
    mut job: table::online_eval_jobs::OnlineEvalJob,
) -> Result<table::online_eval_jobs::OnlineEvalJob, EvalJobError> {
    let existing = table::online_eval_jobs::get_by_org(job_id, org_id)
        .await?
        .ok_or(EvalJobError::NotFound)?;

    job.input_mapping = merge_input_mapping(existing.input_mapping.clone(), job.input_mapping);

    job.apply_target_scope_defaults();
    job.normalize_sampling()
        .map_err(|e| EvalJobError::InvalidJob(e.to_string()))?;
    job.validate()
        .map_err(|e| EvalJobError::InvalidJob(e.to_string()))?;
    validate_source_stream(org_id, &job).await?;
    if existing.status == "active" {
        job.validate_for_activation()
            .map_err(|e| EvalJobError::InvalidJob(e.to_string()))?;
    }

    // Preserve identity & lifecycle fields from the existing row.
    job.id = existing.id;
    job.org_id = existing.org_id;
    job.status = existing.status.clone();
    job.pipeline_id = existing.pipeline_id.clone();
    job.created_at = existing.created_at;
    job.version = existing.version + 1;
    job.updated_at = Utc::now().timestamp_millis();

    // If the job is currently bound to a pipeline (active/paused/degraded),
    // re-reconcile so span pipelines pick up changes, or are torn down when
    // switching to trace/session scope.
    if matches!(job.status.as_str(), "active" | "paused" | "degraded") {
        job.pipeline_id = reconciler::reconcile(&job)
            .await
            .map_err(|e| EvalJobError::ReconcilerError(e.to_string()))?;
    }

    table::online_eval_jobs::update(&job).await?;

    publish_eval_job_put(&job).await;
    Ok(job)
}

#[tracing::instrument()]
pub async fn list_jobs(
    org_id: &str,
    status: Option<&str>,
    permitted_objects: Option<Vec<String>>,
) -> Result<Vec<table::online_eval_jobs::OnlineEvalJob>, EvalJobError> {
    let jobs = match status {
        Some(s) => {
            if !table::online_eval_jobs::VALID_STATUSES.contains(&s) {
                return Err(EvalJobError::InvalidStatus(s.to_string()));
            }
            table::online_eval_jobs::get_by_status(org_id, s).await?
        }
        None => table::online_eval_jobs::get_all_by_org(org_id).await?,
    };
    Ok(jobs
        .into_iter()
        .filter(|job| {
            is_ofga_object_visible(org_id, "eval_job", &job.id, permitted_objects.as_deref())
        })
        .collect())
}

#[tracing::instrument()]
pub async fn get_job(
    org_id: &str,
    job_id: &str,
) -> Result<table::online_eval_jobs::OnlineEvalJob, EvalJobError> {
    let job = table::online_eval_jobs::get_by_org(job_id, org_id)
        .await?
        .ok_or(EvalJobError::NotFound)?;
    Ok(job)
}

#[tracing::instrument()]
pub async fn delete_job(org_id: &str, job_id: &str) -> Result<(), EvalJobError> {
    let job = get_job(org_id, job_id).await?;

    // Best-effort reconciler: tear down the hidden eval pipeline (if any).
    reconciler::tear_down(&job)
        .await
        .map_err(|e| EvalJobError::ReconcilerError(e.to_string()))?;

    table::online_eval_jobs::delete(job_id).await?;
    remove_ownership(org_id, "eval_jobs", Authz::new(job_id)).await;
    publish_eval_job_delete(org_id, job_id).await;
    Ok(())
}

/// Transition a job's state. The reconciler is invoked after a successful DB
/// update to bring the underlying pipeline in line with the new state.
#[tracing::instrument()]
pub async fn transition_status(
    org_id: &str,
    job_id: &str,
    new_status: &str,
) -> Result<table::online_eval_jobs::OnlineEvalJob, EvalJobError> {
    let job = get_job(org_id, job_id).await?;

    if !table::online_eval_jobs::is_valid_transition(&job.status, new_status) {
        return Err(EvalJobError::InvalidStatusTransition {
            from: job.status,
            to: new_status.to_string(),
        });
    }

    // Build the target job snapshot (status updated) and let the reconciler
    // produce/update/delete the eval pipeline before we persist the new
    // status. This way: if reconciliation fails, we don't end up with a job
    // claiming `active` while its pipeline isn't enabled.
    let mut target = job.clone();
    target.status = new_status.to_string();
    if new_status == "active" {
        target
            .validate_for_activation()
            .map_err(|e| EvalJobError::InvalidJob(e.to_string()))?;
        validate_source_stream(org_id, &target).await?;
    }
    let pipeline_id = reconciler::reconcile(&target)
        .await
        .map_err(|e| EvalJobError::ReconcilerError(e.to_string()))?;

    // Persist the new status (and any pipeline_id allocated by reconcile).
    let now = Utc::now().timestamp_millis();
    table::online_eval_jobs::update_status(job_id, new_status, pipeline_id.as_deref(), now).await?;

    let mut updated = job;
    updated.status = new_status.to_string();
    updated.updated_at = now;
    updated.pipeline_id = pipeline_id;
    publish_eval_job_put(&updated).await;
    Ok(updated)
}

#[cfg(feature = "enterprise")]
#[tracing::instrument(skip(body))]
pub async fn manual_evaluate(
    org_id: &str,
    job_id: &str,
    body: ManualEvalJobRequestBody,
    author: Option<String>,
) -> Result<ManualEvalJobResponseBody, EvalJobError> {
    let job = get_job(org_id, job_id).await?;
    if job.status == "archived" {
        return Err(EvalJobError::InvalidJob(
            "Archived eval jobs cannot be manually evaluated".to_string(),
        ));
    }
    job.validate()
        .map_err(|e| EvalJobError::InvalidJob(e.to_string()))?;
    validate_source_stream(org_id, &job).await?;

    let target_id = normalize_manual_target_id(&body.target_id)?;
    validate_manual_query_window(body.start_time, body.end_time)?;
    let target =
        o2_enterprise::enterprise::llm_evaluations::eval_jobs::manual::ManualEvaluationTarget {
            target_id: target_id.clone(),
            span_id: body
                .span_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            trace_id: body
                .trace_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            session_id: body
                .session_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            query_window:
                o2_enterprise::enterprise::llm_evaluations::eval_jobs::tasks::EvaluationQueryWindow {
                    start_us: body.start_time,
                    end_us: body.end_time,
                },
            reason: body
                .reason
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            author,
        };
    let tasks_created =
        o2_enterprise::enterprise::llm_evaluations::eval_jobs::manual::publish_manual_evaluation(
            &job, target,
        )
        .await
        .map_err(|e| EvalJobError::InvalidJob(e.to_string()))?;

    Ok(ManualEvalJobResponseBody {
        job_id: job.id,
        target_scope: job.target_scope,
        target_id,
        tasks_created,
    })
}

#[cfg(not(feature = "enterprise"))]
pub async fn manual_evaluate(
    _org_id: &str,
    _job_id: &str,
    _body: ManualEvalJobRequestBody,
    _author: Option<String>,
) -> Result<ManualEvalJobResponseBody, EvalJobError> {
    Err(EvalJobError::InvalidJob(
        "Manual evaluation requires enterprise features".to_string(),
    ))
}

#[cfg(feature = "enterprise")]
async fn publish_eval_job_put(job: &table::online_eval_jobs::OnlineEvalJob) {
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        return;
    }

    let key = format!("/eval/jobs/{}/{}", job.org_id, job.id);
    let message =
        o2_enterprise::enterprise::super_cluster::queue::EvalJobMessage::Put { job: job.clone() };
    match config::utils::json::to_vec(&message) {
        Ok(value) => {
            if let Err(e) =
                o2_enterprise::enterprise::super_cluster::queue::eval_job_put(&key, value.into())
                    .await
            {
                log::error!("[EvalJob] error publishing super cluster eval job put: {e}");
            }
        }
        Err(e) => log::error!("[EvalJob] error serializing eval job super cluster message: {e}"),
    }
}

#[cfg(not(feature = "enterprise"))]
async fn publish_eval_job_put(_job: &table::online_eval_jobs::OnlineEvalJob) {}

#[cfg(feature = "enterprise")]
async fn publish_eval_job_delete(org_id: &str, job_id: &str) {
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        return;
    }

    let key = format!("/eval/jobs/{}/{}", org_id, job_id);
    if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::eval_job_delete(&key).await {
        log::error!("[EvalJob] error publishing super cluster eval job delete: {e}");
    }
}

#[cfg(not(feature = "enterprise"))]
async fn publish_eval_job_delete(_org_id: &str, _job_id: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_input_mapping_adds_new_scorer_mapping() {
        let existing = serde_json::from_value(serde_json::json!({
            "scorer-1": {
                "input": "{{gen_ai_input_messages}}",
                "output": "{{gen_ai_output_messages}}",
                "context": "{{gen_ai_system_instructions}}"
            }
        }))
        .unwrap();
        let incoming = serde_json::from_value(serde_json::json!({
            "scorer-2": {
                "input": "{{gen_ai_input_messages}}",
                "output": "{{gen_ai_output_messages}}",
                "expected": "{{gen_ai_system_instructions}}",
                "trace_id": "{{trace_id}}"
            }
        }))
        .unwrap();

        let merged = merge_input_mapping(Some(existing), Some(incoming)).unwrap();

        assert_eq!(merged.len(), 2);
        assert_eq!(
            merged["scorer-1"]["context"],
            "{{gen_ai_system_instructions}}"
        );
        assert_eq!(merged["scorer-2"]["trace_id"], "{{trace_id}}");
    }

    #[test]
    fn test_merge_input_mapping_incoming_overrides_existing_scorer_mapping() {
        let existing = serde_json::from_value(serde_json::json!({
            "scorer-1": { "input": "{{old_input}}" }
        }))
        .unwrap();
        let incoming = serde_json::from_value(serde_json::json!({
            "scorer-1": { "input": "{{new_input}}" }
        }))
        .unwrap();

        let merged = merge_input_mapping(Some(existing), Some(incoming)).unwrap();

        assert_eq!(merged["scorer-1"]["input"], "{{new_input}}");
    }

    #[test]
    fn missing_trace_stream_is_rejected() {
        let error = ensure_source_stream_exists("missing-traces", false).unwrap_err();

        assert_eq!(
            error.to_string(),
            "Invalid eval job: Trace stream 'missing-traces' not found"
        );
        assert!(ensure_source_stream_exists("traces", true).is_ok());
    }

    #[test]
    fn manual_target_id_is_trimmed_and_must_not_be_empty() {
        assert_eq!(
            normalize_manual_target_id("  trace-1  ").unwrap(),
            "trace-1"
        );

        let error = normalize_manual_target_id(" \n\t ").unwrap_err();
        assert_eq!(
            error.to_string(),
            "Invalid eval job: targetId must not be empty"
        );
    }

    #[test]
    fn manual_query_window_must_be_non_negative_and_ordered() {
        assert!(validate_manual_query_window(1_000, 2_000).is_ok());
        assert_eq!(
            validate_manual_query_window(-1, 2_000)
                .unwrap_err()
                .to_string(),
            "Invalid eval job: startTime must not be negative"
        );
        assert_eq!(
            validate_manual_query_window(2_000, 2_000)
                .unwrap_err()
                .to_string(),
            "Invalid eval job: endTime must be greater than startTime"
        );
    }
}
