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
//! a set of scorers. Each Job is reconciled to a hidden evaluation pipeline
//! ([`PipelineKind::Evaluation`]) which carries the actual span-bounded eval
//! work — see [`reconciler`] for the sync logic.

use ::common::{
    meta::authz::Authz,
    utils::auth::{is_ofga_object_visible, remove_ownership, set_ownership},
};
use chrono::Utc;
use config::ider;
use infra::table;

pub mod reconciler;
#[cfg(feature = "enterprise")]
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

    #[error("ReconcilerError# {0}")]
    ReconcilerError(String),
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
    // they are activated
    job.pipeline_id = None;

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

    // Preserve identity & lifecycle fields from the existing row.
    job.id = existing.id;
    job.org_id = existing.org_id;
    job.status = existing.status.clone();
    job.pipeline_id = existing.pipeline_id.clone();
    job.created_at = existing.created_at;
    job.version = existing.version + 1;
    job.updated_at = Utc::now().timestamp_millis();

    table::online_eval_jobs::update(&job).await?;

    // If the job is currently bound to a pipeline (active/paused/degraded),
    // re-reconcile so the pipeline picks up the new filter/sampling/scorers.
    if job.pipeline_id.is_some() {
        reconciler::reconcile(&job)
            .await
            .map_err(|e| EvalJobError::ReconcilerError(e.to_string()))?;
    }

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
    let pipeline_id = reconciler::reconcile(&target)
        .await
        .map_err(|e| EvalJobError::ReconcilerError(e.to_string()))?;

    // Persist the new status (and any pipeline_id allocated by reconcile).
    let now = Utc::now().timestamp_millis();
    table::online_eval_jobs::update_status(job_id, new_status, pipeline_id.as_deref(), now).await?;

    let mut updated = job;
    updated.status = new_status.to_string();
    updated.updated_at = now;
    if pipeline_id.is_some() {
        updated.pipeline_id = pipeline_id;
    } else if new_status == "archived" {
        updated.pipeline_id = None;
    }
    publish_eval_job_put(&updated).await;
    Ok(updated)
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
}
