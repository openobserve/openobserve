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
use crate::common::utils::auth::UserEmail;
#[cfg(feature = "enterprise")]
use crate::handler::http::extractors::Headers;
#[cfg(test)]
use crate::service::llm_evaluations::eval_jobs::EvalJobError;
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::models::eval_jobs::{
        EvalJobRequestBody, EvalJobResponseBody, EvalJobStatusActionResponseBody,
        ListEvalJobsQuery, ListEvalJobsResponseBody, ManualEvalJobRequestBody,
        ManualEvalJobResponseBody,
    },
    service::llm_evaluations::eval_jobs,
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
        match crate::handler::http::auth::validator::list_objects_for_user(
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
    axum::Json(body): axum::Json<EvalJobRequestBody>,
) -> Response {
    let job = match infra::table::online_eval_jobs::OnlineEvalJob::try_from(body) {
        Ok(job) => job,
        Err(err) => return MetaHttpResponse::bad_request(err),
    };
    match eval_jobs::create_job(&org_id, job).await {
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
    axum::Json(body): axum::Json<EvalJobRequestBody>,
) -> Response {
    let job = match infra::table::online_eval_jobs::OnlineEvalJob::try_from(body) {
        Ok(job) => job,
        Err(err) => return MetaHttpResponse::bad_request(err),
    };
    match eval_jobs::update_job(&org_id, &job_id, job).await {
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
pub async fn activate_eval_job(Path((org_id, job_id)): Path<(String, String)>) -> Response {
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
pub async fn resume_eval_job(Path((org_id, job_id)): Path<(String, String)>) -> Response {
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
    description = "Creates durable evaluation tasks for an explicit target, bypassing automatic target sampling.",
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
    let author = Some(user_email.user_id);
    #[cfg(not(feature = "enterprise"))]
    let author = None;

    match eval_jobs::manual_evaluate(&org_id, &job_id, body, author).await {
        Ok(resp) => MetaHttpResponse::json(resp),
        Err(err) => err.into(),
    }
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
}
