// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! HTTP handlers for backfill job management (Enterprise only)

use actix_web::{HttpResponse, delete, get, post, put, web};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(feature = "enterprise")]
use crate::service::alerts::backfill;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BackfillRequest {
    /// Start time in microseconds
    pub start_time: i64,
    /// End time in microseconds
    pub end_time: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_period_minutes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_between_chunks_secs: Option<i64>,
    #[serde(default)]
    pub delete_before_backfill: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BackfillResponse {
    pub job_id: String,
    pub message: String,
}

#[cfg(feature = "enterprise")]
/// Create a backfill job
///
/// Creates a new backfill job to fill gaps in summary streams.
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "CreateBackfillJob",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
    ),
    request_body(
        content = BackfillRequest,
        description = "Backfill parameters",
        example = json!({
            "start_time": 1704067200000000i64,
            "end_time": 1704153600000000i64,
            "chunk_period_minutes": 60,
            "delay_between_chunks_secs": 5,
            "delete_before_backfill": false
        })
    ),
    responses(
        (status = 200, description = "Backfill job created successfully", body = BackfillResponse),
        (status = 400, description = "Bad request"),
        (status = 404, description = "Pipeline not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[post("/{org_id}/pipelines/{pipeline_id}/backfill")]
pub async fn create_backfill(
    path: web::Path<(String, String)>,
    req: web::Json<BackfillRequest>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, pipeline_id) = path.into_inner();

    log::info!(
        "[BACKFILL API] Create backfill job request for pipeline {} in org {}, range: {}-{}, delete: {}",
        pipeline_id,
        org_id,
        req.start_time,
        req.end_time,
        req.delete_before_backfill
    );

    match backfill::create_backfill_job(
        &org_id,
        &pipeline_id,
        req.start_time,
        req.end_time,
        req.chunk_period_minutes,
        req.delay_between_chunks_secs,
        req.delete_before_backfill,
    )
    .await
    {
        Ok(job_id) => {
            log::info!(
                "[BACKFILL API] Created backfill job {} for pipeline {}",
                job_id,
                pipeline_id
            );
            Ok(HttpResponse::Ok().json(BackfillResponse {
                job_id: job_id.clone(),
                message: format!("Backfill job {} created successfully", job_id),
            }))
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to create backfill job for pipeline {}: {}",
                pipeline_id,
                e
            );
            Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                actix_web::http::StatusCode::BAD_REQUEST,
                e.to_string(),
            )))
        }
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "CreateBackfillJob",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
    ),
    request_body(
        content = BackfillRequest,
        description = "Backfill parameters"
    ),
    responses(
        (status = 403, description = "Enterprise feature", body = ()),
    ),
)]
#[post("/{org_id}/pipelines/{pipeline_id}/backfill")]
pub async fn create_backfill(
    _path: web::Path<(String, String)>,
    _req: web::Json<BackfillRequest>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// List all backfill jobs for an organization
///
/// Returns a list of all backfill jobs in the specified organization.
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "ListBackfillJobs",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 200, description = "List of backfill jobs"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[get("/{org_id}/pipelines/backfill")]
pub async fn list_backfills(path: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    let org_id = path.into_inner();

    match backfill::list_backfill_jobs(&org_id).await {
        Ok(jobs) => {
            log::debug!(
                "[BACKFILL API] Listed {} backfill jobs for org {}",
                jobs.len(),
                org_id
            );
            Ok(HttpResponse::Ok().json(jobs))
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to list backfill jobs for org {}: {}",
                org_id,
                e
            );
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                    e.to_string(),
                )),
            )
        }
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "ListBackfillJobs",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    responses(
        (status = 403, description = "Enterprise feature", body = ()),
    ),
)]
#[get("/{org_id}/pipelines/backfill")]
pub async fn list_backfills(_path: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// Get backfill job status
///
/// Returns the status of a specific backfill job.
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "GetBackfillJob",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
        ("job_id" = String, Path, description = "Backfill job ID"),
    ),
    responses(
        (status = 200, description = "Backfill job status"),
        (status = 404, description = "Job not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[get("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}")]
pub async fn get_backfill(
    path: web::Path<(String, String, String)>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, pipeline_id, job_id) = path.into_inner();

    match backfill::get_backfill_job(&org_id, &job_id).await {
        Ok(job) => {
            // Verify the job belongs to the specified pipeline
            if job.pipeline_id != pipeline_id {
                log::warn!(
                    "[BACKFILL API] Job {} belongs to pipeline {}, not {}",
                    job_id,
                    job.pipeline_id,
                    pipeline_id
                );
                return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                    actix_web::http::StatusCode::NOT_FOUND,
                    format!(
                        "Backfill job {} not found for pipeline {}",
                        job_id, pipeline_id
                    ),
                )));
            }

            log::debug!(
                "[BACKFILL API] Retrieved backfill job {} for org {}",
                job_id,
                org_id
            );
            Ok(HttpResponse::Ok().json(job))
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to get backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                actix_web::http::StatusCode::NOT_FOUND,
                e.to_string(),
            )))
        }
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "GetBackfillJob",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
        ("job_id" = String, Path, description = "Backfill job ID"),
    ),
    responses(
        (status = 403, description = "Enterprise feature", body = ()),
    ),
)]
#[get("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}")]
pub async fn get_backfill(
    _path: web::Path<(String, String, String)>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// Enable or disable a backfill job
///
/// Enables (resumes) or disables (pauses) a backfill job.
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "EnableBackfillJob",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
        ("job_id" = String, Path, description = "Backfill job ID"),
        ("value" = bool, Query, description = "Enable (true) or disable (false) the backfill job"),
    ),
    responses(
        (status = 200, description = "Backfill job status updated successfully"),
        (status = 400, description = "Bad request"),
        (status = 404, description = "Job not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[put("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}/enable")]
pub async fn enable_backfill(
    path: web::Path<(String, String, String)>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, pipeline_id, job_id) = path.into_inner();

    let enable = query
        .get("value")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or(false);

    // Verify the job belongs to the specified pipeline
    match backfill::get_backfill_job(&org_id, &job_id).await {
        Ok(job) => {
            if job.pipeline_id != pipeline_id {
                return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                    actix_web::http::StatusCode::NOT_FOUND,
                    format!(
                        "Backfill job {} not found for pipeline {}",
                        job_id, pipeline_id
                    ),
                )));
            }
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to get backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                actix_web::http::StatusCode::NOT_FOUND,
                e.to_string(),
            )));
        }
    }

    log::info!(
        "[BACKFILL API] {} backfill job {} for org {}",
        if enable { "Enabling" } else { "Disabling" },
        job_id,
        org_id
    );

    match backfill::enable_backfill_job(&org_id, &job_id, enable).await {
        Ok(_) => {
            log::info!(
                "[BACKFILL API] {} backfill job {} for org {}",
                if enable { "Enabled" } else { "Disabled" },
                job_id,
                org_id
            );
            Ok(HttpResponse::Ok().json(serde_json::json!({
                "message": format!(
                    "Backfill job {} successfully",
                    if enable { "enabled" } else { "disabled" }
                )
            })))
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to {} backfill job {} for org {}: {}",
                if enable { "enable" } else { "disable" },
                job_id,
                org_id,
                e
            );
            Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                actix_web::http::StatusCode::BAD_REQUEST,
                e.to_string(),
            )))
        }
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "EnableBackfillJob",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
        ("job_id" = String, Path, description = "Backfill job ID"),
        ("value" = bool, Query, description = "Enable (true) or disable (false) the backfill job"),
    ),
    responses(
        (status = 403, description = "Enterprise feature", body = ()),
    ),
)]
#[put("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}/enable")]
pub async fn enable_backfill(
    _path: web::Path<(String, String, String)>,
    _query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// Delete a backfill job
///
/// Deletes a backfill job permanently.
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "DeleteBackfillJob",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
        ("job_id" = String, Path, description = "Backfill job ID"),
    ),
    responses(
        (status = 200, description = "Backfill job deleted successfully"),
        (status = 404, description = "Job not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[delete("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}")]
pub async fn delete_backfill(
    path: web::Path<(String, String, String)>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, pipeline_id, job_id) = path.into_inner();

    // Verify the job belongs to the specified pipeline
    match backfill::get_backfill_job(&org_id, &job_id).await {
        Ok(job) => {
            if job.pipeline_id != pipeline_id {
                log::warn!(
                    "[BACKFILL API] Job {} belongs to pipeline {}, not {}",
                    job_id,
                    job.pipeline_id,
                    pipeline_id
                );
                return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                    actix_web::http::StatusCode::NOT_FOUND,
                    format!(
                        "Backfill job {} not found for pipeline {}",
                        job_id, pipeline_id
                    ),
                )));
            }
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to get backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                actix_web::http::StatusCode::NOT_FOUND,
                e.to_string(),
            )));
        }
    }

    log::info!(
        "[BACKFILL API] Delete backfill job {} for org {}",
        job_id,
        org_id
    );

    match backfill::delete_backfill_job(&org_id, &job_id).await {
        Ok(_) => {
            log::info!(
                "[BACKFILL API] Deleted backfill job {} for org {}",
                job_id,
                org_id
            );
            Ok(HttpResponse::Ok().json(serde_json::json!({
                "message": "Backfill job deleted successfully"
            })))
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to delete backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                actix_web::http::StatusCode::NOT_FOUND,
                e.to_string(),
            )))
        }
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "DeleteBackfillJob",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
        ("job_id" = String, Path, description = "Backfill job ID"),
    ),
    responses(
        (status = 403, description = "Enterprise feature", body = ()),
    ),
)]
#[delete("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}")]
pub async fn delete_backfill(
    _path: web::Path<(String, String, String)>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// Update an existing backfill job
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "UpdateBackfillJob",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
        ("job_id" = String, Path, description = "Backfill job ID"),
    ),
    request_body(
        content = BackfillRequest,
        description = "Backfill job parameters"
    ),
    responses(
        (status = 200, description = "Backfill job updated successfully"),
        (status = 400, description = "Bad request"),
        (status = 404, description = "Backfill job not found"),
        (status = 500, description = "Internal server error")
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
#[put("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}")]
pub async fn update_backfill(
    path: web::Path<(String, String, String)>,
    body: web::Json<BackfillRequest>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, pipeline_id, job_id) = path.into_inner();
    let req = body.into_inner();

    // Verify the job belongs to the specified pipeline
    match backfill::get_backfill_job(&org_id, &job_id).await {
        Ok(job) => {
            if job.pipeline_id != pipeline_id {
                log::warn!(
                    "[BACKFILL API] Job {} belongs to pipeline {}, not {}",
                    job_id,
                    job.pipeline_id,
                    pipeline_id
                );
                return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                    actix_web::http::StatusCode::NOT_FOUND,
                    format!(
                        "Backfill job {} not found for pipeline {}",
                        job_id, pipeline_id
                    ),
                )));
            }
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to get backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                actix_web::http::StatusCode::NOT_FOUND,
                e.to_string(),
            )));
        }
    }

    log::info!(
        "[BACKFILL API] Updating backfill job {} for org {}",
        job_id,
        org_id
    );

    match backfill::update_backfill_job(&org_id, &job_id, req).await {
        Ok(_) => {
            log::info!(
                "[BACKFILL API] Updated backfill job {} for org {}",
                job_id,
                org_id
            );
            Ok(HttpResponse::Ok().json(serde_json::json!({
                "message": "Backfill job updated successfully"
            })))
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to update backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                actix_web::http::StatusCode::BAD_REQUEST,
                e.to_string(),
            )))
        }
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "UpdateBackfillJob",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("pipeline_id" = String, Path, description = "Pipeline ID"),
        ("job_id" = String, Path, description = "Backfill job ID"),
    ),
    request_body(
        content = BackfillRequest,
        description = "Backfill job parameters"
    ),
    responses(
        (status = 403, description = "Enterprise feature", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
#[put("/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}")]
pub async fn update_backfill(
    _path: web::Path<(String, String, String)>,
    _body: web::Json<BackfillRequest>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}
