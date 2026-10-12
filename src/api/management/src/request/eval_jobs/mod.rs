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

use axum::{
    extract::{Path, Query},
    response::Response,
};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::UserEmail;
#[cfg(test)]
use openobserve_core::llm_evaluations::eval_jobs::EvalJobError;
use openobserve_core::llm_evaluations::eval_jobs::{
    self, ManualEvalJobRequestBody, ManualEvalJobResponseBody,
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::eval_jobs::{
        EvalJobRequestBody, EvalJobResponseBody, EvalJobStatusActionResponseBody,
        ListEvalJobsQuery, ListEvalJobsResponseBody,
    },
};

/// ListEvalJobs
#[utoipa::path(
    get,
    path = "/{org_id}/eval_jobs",
    context_path = "/api",
    tag = "EvalJobs",
    operation_id = "ListEvalJobs",
    summary = "List online eval jobs",
    description = "Lists online eval jobs in the organization. Optionally filterable by status.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("status" = Option<String>, Query, description = "Filter by status (draft, active, paused, degraded, archived)"),
    ),
    responses(
        (status = 200, body = inline(ListEvalJobsResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "EvalJobs", "operation": "list"})),
    ),
)]
pub async fn list_eval_jobs(
    Path(org_id): Path<String>,
    Query(query): Query<ListEvalJobsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let permitted_objects = {
        match openobserve_api_common::auth::validator::list_objects_for_user(
            &org_id,
            &user_email.user_id,
            "GET",
            "eval_job",
        )
        .await
        {
            Ok(list) => list,
            Err(e) => return MetaHttpResponse::forbidden(e.to_string()),
        }
    };
    #[cfg(not(feature = "enterprise"))]
    let permitted_objects = None;

    match eval_jobs::list_jobs(&org_id, query.status.as_deref(), permitted_objects).await {
        Ok(list) => {
            let body: ListEvalJobsResponseBody = list.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => err.into(),
    }
}

/// CreateEvalJob
#[utoipa::path(
    post,
    path = "/{org_id}/eval_jobs",
    context_path = "/api",
    tag = "EvalJobs",
    operation_id = "CreateEvalJob",
    summary = "Create online eval job (draft)",
    description = "Creates a new online eval job in draft state. Activate it later via the activate endpoint to begin reconciliation.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(EvalJobRequestBody), description = "Eval job payload"),
    responses(
        (status = 200, body = inline(EvalJobResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "EvalJobs", "operation": "create"})),
    ),
)]
pub async fn create_eval_job(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    axum::Json(body): axum::Json<EvalJobRequestBody>,
) -> Response {
    let job = match infra::table::online_eval_jobs::OnlineEvalJob::try_from(body) {
        Ok(job) => job,
        Err(err) => return MetaHttpResponse::bad_request(err),
    };
    #[cfg(feature = "enterprise")]
    let job = match eval_jobs::prepare_new_job(&org_id, job).await {
        Ok(job) => job,
        Err(err) => return err.into(),
    };
    #[cfg(feature = "enterprise")]
    if let Err(resp) = guard_job(&org_id, &user_email.user_id, &job).await {
        return resp;
    }
    #[cfg(feature = "enterprise")]
    let created = eval_jobs::insert_job(&org_id, job).await;
    #[cfg(not(feature = "enterprise"))]
    let created = eval_jobs::create_job(&org_id, job).await;
    match created {
        Ok(j) => {
            let resp: EvalJobResponseBody = j.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => err.into(),
    }
}

/// GetEvalJob
#[utoipa::path(
    get,
    path = "/{org_id}/eval_jobs/{job_id}",
    context_path = "/api",
    tag = "EvalJobs",
    operation_id = "GetEvalJob",
    summary = "Get eval job by id",
    description = "Retrieves a single online eval job by id.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Eval job id"),
    ),
    responses(
        (status = 200, body = inline(EvalJobResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "EvalJobs", "operation": "get"})),
    ),
)]
pub async fn get_eval_job(Path((org_id, job_id)): Path<(String, String)>) -> Response {
    match eval_jobs::get_job(&org_id, &job_id).await {
        Ok(j) => {
            let resp: EvalJobResponseBody = j.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => err.into(),
    }
}

/// UpdateEvalJob
#[utoipa::path(
    put,
    path = "/{org_id}/eval_jobs/{job_id}",
    context_path = "/api",
    tag = "EvalJobs",
    operation_id = "UpdateEvalJob",
    summary = "Update eval job",
    description = "Updates the editable fields of an online eval job and bumps its version. The associated pipeline is re-reconciled if the job is active.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Eval job id"),
    ),
    request_body(content = inline(EvalJobRequestBody), description = "Eval job payload"),
    responses(
        (status = 200, body = inline(EvalJobResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "EvalJobs", "operation": "update"})),
    ),
)]
pub async fn update_eval_job(
    Path((org_id, job_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    axum::Json(body): axum::Json<EvalJobRequestBody>,
) -> Response {
    let job = match infra::table::online_eval_jobs::OnlineEvalJob::try_from(body) {
        Ok(job) => job,
        Err(err) => return MetaHttpResponse::bad_request(err),
    };
    #[cfg(feature = "enterprise")]
    let job = match eval_jobs::prepare_job_update(&org_id, &job_id, job).await {
        Ok(job) => job,
        Err(err) => return err.into(),
    };
    #[cfg(feature = "enterprise")]
    if let Err(resp) = guard_job(&org_id, &user_email.user_id, &job).await {
        return resp;
    }
    #[cfg(feature = "enterprise")]
    let updated = eval_jobs::store_job_update(job).await;
    #[cfg(not(feature = "enterprise"))]
    let updated = eval_jobs::update_job(&org_id, &job_id, job).await;
    match updated {
        Ok(j) => {
            let resp: EvalJobResponseBody = j.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => err.into(),
    }
}

/// DeleteEvalJob
#[utoipa::path(
    delete,
    path = "/{org_id}/eval_jobs/{job_id}",
    context_path = "/api",
    tag = "EvalJobs",
    operation_id = "DeleteEvalJob",
    summary = "Delete eval job",
    description = "Deletes the online eval job and its associated evaluation pipeline.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Eval job id"),
    ),
    responses(
        (status = 200, description = "Deleted", body = String),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "EvalJobs", "operation": "delete"})),
    ),
)]
pub async fn delete_eval_job(Path((org_id, job_id)): Path<(String, String)>) -> Response {
    match eval_jobs::delete_job(&org_id, &job_id).await {
        Ok(()) => MetaHttpResponse::ok("Eval job deleted"),
        Err(err) => err.into(),
    }
}

/// ActivateEvalJob
#[utoipa::path(
    post,
    path = "/{org_id}/eval_jobs/{job_id}/activate",
    context_path = "/api",
    tag = "EvalJobs",
    operation_id = "ActivateEvalJob",
    summary = "Activate eval job",
    description = "Transitions an eval job to the active state. Allowed from draft, paused or degraded.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Eval job id"),
    ),
    responses(
        (status = 200, body = inline(EvalJobStatusActionResponseBody)),
        (status = 400, description = "Invalid state transition", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "EvalJobs", "operation": "activate"})),
    ),
)]
pub async fn activate_eval_job(
    Path((org_id, job_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if let Err(resp) = guard_activation(&org_id, &user_email.user_id, &job_id).await {
        return resp;
    }
    match eval_jobs::transition_status(&org_id, &job_id, "active").await {
        Ok(j) => {
            let resp: EvalJobStatusActionResponseBody = j.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => err.into(),
    }
}

/// PauseEvalJob
#[utoipa::path(
    post,
    path = "/{org_id}/eval_jobs/{job_id}/pause",
    context_path = "/api",
    tag = "EvalJobs",
    operation_id = "PauseEvalJob",
    summary = "Pause eval job",
    description = "Transitions an active or degraded eval job to the paused state.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Eval job id"),
    ),
    responses(
        (status = 200, body = inline(EvalJobStatusActionResponseBody)),
        (status = 400, description = "Invalid state transition", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "EvalJobs", "operation": "pause"})),
    ),
)]
pub async fn pause_eval_job(Path((org_id, job_id)): Path<(String, String)>) -> Response {
    match eval_jobs::transition_status(&org_id, &job_id, "paused").await {
        Ok(j) => {
            let resp: EvalJobStatusActionResponseBody = j.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => err.into(),
    }
}

/// ResumeEvalJob
#[utoipa::path(
    post,
    path = "/{org_id}/eval_jobs/{job_id}/resume",
    context_path = "/api",
    tag = "EvalJobs",
    operation_id = "ResumeEvalJob",
    summary = "Resume eval job",
    description = "Resumes a paused or degraded eval job by transitioning it back to active.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Eval job id"),
    ),
    responses(
        (status = 200, body = inline(EvalJobStatusActionResponseBody)),
        (status = 400, description = "Invalid state transition", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "EvalJobs", "operation": "resume"})),
    ),
)]
pub async fn resume_eval_job(
    Path((org_id, job_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if let Err(resp) = guard_activation(&org_id, &user_email.user_id, &job_id).await {
        return resp;
    }
    match eval_jobs::transition_status(&org_id, &job_id, "active").await {
        Ok(j) => {
            let resp: EvalJobStatusActionResponseBody = j.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => err.into(),
    }
}

/// ArchiveEvalJob
#[utoipa::path(
    post,
    path = "/{org_id}/eval_jobs/{job_id}/archive",
    context_path = "/api",
    tag = "EvalJobs",
    operation_id = "ArchiveEvalJob",
    summary = "Archive eval job",
    description = "Archives the eval job. Archived jobs are retained for audit but no longer evaluated.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Eval job id"),
    ),
    responses(
        (status = 200, body = inline(EvalJobStatusActionResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "EvalJobs", "operation": "archive"})),
    ),
)]
pub async fn archive_eval_job(Path((org_id, job_id)): Path<(String, String)>) -> Response {
    match eval_jobs::transition_status(&org_id, &job_id, "archived").await {
        Ok(j) => {
            let resp: EvalJobStatusActionResponseBody = j.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => err.into(),
    }
}

/// ManualEvalJob
#[utoipa::path(
    post,
    path = "/{org_id}/eval_jobs/{job_id}/manual_eval",
    context_path = "/api",
    tag = "EvalJobs",
    operation_id = "ManualEvalJob",
    summary = "Manually evaluate a target",
    description = "Creates durable evaluation tasks for an explicit target, bypassing automatic target sampling. The worker hydrates source telemetry using the request's authoritative microsecond time range.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("job_id" = String, Path, description = "Eval job id"),
    ),
    request_body(content = inline(ManualEvalJobRequestBody), description = "Manual evaluation target payload"),
    responses(
        (status = 200, body = inline(ManualEvalJobResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "EvalJobs", "operation": "manual_eval"})),
    ),
)]
pub async fn manual_eval_job(
    Path((org_id, job_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    axum::Json(body): axum::Json<ManualEvalJobRequestBody>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if let Err(resp) = guard_manual(&org_id, &user_email.user_id, &job_id, &body).await {
        return resp;
    }
    #[cfg(feature = "enterprise")]
    let author = Some(user_email.user_id);
    #[cfg(not(feature = "enterprise"))]
    let author = None;

    match eval_jobs::manual_evaluate(&org_id, &job_id, body, author).await {
        Ok(resp) => MetaHttpResponse::json(resp),
        Err(err) => err.into(),
    }
}

#[cfg(feature = "enterprise")]
async fn guard_job(
    org_id: &str,
    user_id: &str,
    job: &infra::table::online_eval_jobs::OnlineEvalJob,
) -> Result<(), Response> {
    let sources = openobserve_core::background_access::eval_job_sources(
        org_id,
        &job.stream_type,
        &job.stream,
    );
    openobserve_core::background_access::guard_write(org_id, user_id, &sources).await
}

/// The transition's own read and checks answer first, so a bad job is never reported as refused.
#[cfg(feature = "enterprise")]
async fn guard_activation(org_id: &str, user_id: &str, job_id: &str) -> Result<(), Response> {
    if !openobserve_core::background_access::rbac_enforced().await {
        return Ok(());
    }
    let job = eval_jobs::get_job(org_id, job_id)
        .await
        .map_err(Response::from)?;
    eval_jobs::check_transition(org_id, &job, "active")
        .await
        .map_err(Response::from)?;
    guard_job(org_id, user_id, &job).await
}

/// The evaluation's own read and checks answer first, so a bad request is never refused.
#[cfg(feature = "enterprise")]
async fn guard_manual(
    org_id: &str,
    user_id: &str,
    job_id: &str,
    body: &ManualEvalJobRequestBody,
) -> Result<(), Response> {
    if !openobserve_core::background_access::rbac_enforced().await {
        return Ok(());
    }
    let job = eval_jobs::get_job(org_id, job_id)
        .await
        .map_err(Response::from)?;
    eval_jobs::check_manual_evaluate(org_id, &job, body)
        .await
        .map_err(Response::from)?;
    guard_job(org_id, user_id, &job).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_eval_job_error_bad_request_variants_are_400() {
        let cases: Vec<EvalJobError> = vec![
            EvalJobError::InvalidStatus("bogus".to_string()),
            EvalJobError::InvalidStatusTransition {
                from: "archived".to_string(),
                to: "active".to_string(),
            },
            EvalJobError::InvalidJob("bad scope".to_string()),
        ];
        for err in cases {
            let resp: Response = err.into();
            assert_eq!(resp.status().as_u16(), 400);
        }
    }

    #[test]
    fn test_eval_job_error_not_found_is_404() {
        let resp: Response = EvalJobError::NotFound.into();
        assert_eq!(resp.status().as_u16(), 404);
    }

    #[test]
    fn test_eval_job_error_infra_is_500() {
        let err = EvalJobError::InfraError(infra::errors::Error::Message("db".to_string()));
        let resp: Response = err.into();
        assert_eq!(resp.status().as_u16(), 500);
    }

    #[test]
    fn test_eval_job_error_reconciler_is_500() {
        let err = EvalJobError::ReconcilerError("pipeline sync failed".to_string());
        let resp: Response = err.into();
        assert_eq!(resp.status().as_u16(), 500);
    }

    #[test]
    fn test_eval_job_error_task_publish_is_500() {
        let err = EvalJobError::TaskPublish("queue publish timed out".to_string());
        let resp: Response = err.into();
        assert_eq!(resp.status().as_u16(), 500);
    }

    #[cfg(feature = "enterprise")]
    async fn stored_archived_job(id: &str) -> infra::table::online_eval_jobs::OnlineEvalJob {
        use infra::table::online_eval_jobs::{self as jobs, OnlineEvalJob};

        jobs::create_table().await.unwrap();
        let job = OnlineEvalJob::from(infra::table::entity::online_eval_jobs::Model {
            id: id.to_string(),
            org_id: "activate_plain_org".to_string(),
            name: "plain".to_string(),
            description: None,
            stream: "plain_spans".to_string(),
            stream_type: "traces".to_string(),
            target_scope: "trace".to_string(),
            filter_condition: serde_json::json!({}),
            scorers: serde_json::json!([]),
            input_mapping: None,
            span_selectors: None,
            span_selector_bindings: None,
            trace_config: None,
            session_config: None,
            sampling_mode: "all".to_string(),
            sampling_value: serde_json::json!(1),
            status: "archived".to_string(),
            version: 1,
            pipeline_id: None,
            created_at: 1,
            updated_at: 1,
        });
        jobs::delete(&job.id).await.unwrap();
        jobs::add(&job).await.unwrap();
        job
    }

    #[cfg(feature = "enterprise")]
    fn denied_user() -> openobserve_api_common::extractors::Headers<UserEmail> {
        openobserve_api_common::extractors::Headers(UserEmail {
            user_id: format!("{}@example.com", config::ider::uuid()),
        })
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_invalid_activation_from_a_denied_user_gets_the_transition_400() {
        openobserve_core::authz::fake_checker();
        let job = stored_archived_job("activate-plain-job").await;
        let resp =
            activate_eval_job(Path((job.org_id.clone(), job.id.clone())), denied_user()).await;
        assert_eq!(resp.status().as_u16(), 400);

        let denied = guard_job(&job.org_id, "nobody@example.com", &job)
            .await
            .unwrap_err();
        assert_eq!(denied.status().as_u16(), 403);
        infra::table::online_eval_jobs::delete(&job.id)
            .await
            .unwrap();
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_invalid_resume_from_a_denied_user_gets_the_transition_400() {
        openobserve_core::authz::fake_checker();
        let job = stored_archived_job("resume-plain-job").await;
        let resp = resume_eval_job(Path((job.org_id.clone(), job.id.clone())), denied_user()).await;
        assert_eq!(resp.status().as_u16(), 400);
        infra::table::online_eval_jobs::delete(&job.id)
            .await
            .unwrap();
    }
}
