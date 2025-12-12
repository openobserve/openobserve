// Copyright 2025 OpenObserve Inc.
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

use actix_web::{HttpResponse, delete, get, post, put, web};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{common::meta::http::HttpResponse as MetaHttpResponse, service::alerts::backfill};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BackfillRequest {
    #[serde(with = "timestamp_format")]
    pub start_time: i64,
    #[serde(with = "timestamp_format")]
    pub end_time: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_period_minutes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_between_chunks_secs: Option<i64>,
    #[serde(default)]
    pub delete_before_backfill: bool,
}

mod timestamp_format {
    use chrono::DateTime;
    use serde::{self, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(timestamp: &i64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_i64(*timestamp)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<i64, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Timestamp {
            Integer(i64),
            String(String),
        }

        match Timestamp::deserialize(deserializer)? {
            Timestamp::Integer(i) => Ok(i),
            Timestamp::String(s) => {
                // Try parsing as RFC3339 first
                if let Ok(dt) = DateTime::parse_from_rfc3339(&s) {
                    return Ok(dt.timestamp_micros());
                }
                // Try parsing as integer string
                if let Ok(i) = s.parse::<i64>() {
                    return Ok(i);
                }
                Err(serde::de::Error::custom(
                    "Invalid timestamp format. Expected ISO 8601 string or integer (microseconds)",
                ))
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BackfillResponse {
    pub job_id: String,
    pub message: String,
}

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
            "start_time": "2024-01-01T00:00:00Z",
            "end_time": "2024-01-02T00:00:00Z",
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
        (status = 200, description = "List of backfill jobs", body = Vec<backfill::BackfillJobStatus>),
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
        ("job_id" = String, Path, description = "Backfill job ID"),
    ),
    responses(
        (status = 200, description = "Backfill job status", body = backfill::BackfillJobStatus),
        (status = 404, description = "Job not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[get("/{org_id}/pipelines/backfill/{job_id}")]
pub async fn get_backfill(
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, job_id) = path.into_inner();

    match backfill::get_backfill_job(&org_id, &job_id).await {
        Ok(job) => {
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

/// Pause a backfill job
///
/// Pauses a running backfill job.
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "PauseBackfillJob",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("job_id" = String, Path, description = "Backfill job ID"),
    ),
    responses(
        (status = 200, description = "Backfill job paused successfully"),
        (status = 404, description = "Job not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[post("/{org_id}/pipelines/backfill/{job_id}/pause")]
pub async fn pause_backfill(
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, job_id) = path.into_inner();

    log::info!(
        "[BACKFILL API] Pause backfill job {} for org {}",
        job_id,
        org_id
    );

    match backfill::cancel_backfill_job(&org_id, &job_id).await {
        Ok(_) => {
            log::info!(
                "[BACKFILL API] Paused backfill job {} for org {}",
                job_id,
                org_id
            );
            Ok(HttpResponse::Ok().json(serde_json::json!({
                "message": "Backfill job paused successfully"
            })))
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to pause backfill job {} for org {}: {}",
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

/// Resume a paused backfill job
///
/// Resumes a paused backfill job.
#[utoipa::path(
    context_path = "/api",
    tag = "Pipelines",
    operation_id = "ResumeBackfillJob",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ("job_id" = String, Path, description = "Backfill job ID"),
    ),
    responses(
        (status = 200, description = "Backfill job resumed successfully"),
        (status = 404, description = "Job not found"),
        (status = 400, description = "Job is not paused"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[post("/{org_id}/pipelines/backfill/{job_id}/resume")]
pub async fn resume_backfill(
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, job_id) = path.into_inner();

    log::info!(
        "[BACKFILL API] Resume backfill job {} for org {}",
        job_id,
        org_id
    );

    match backfill::resume_backfill_job(&org_id, &job_id).await {
        Ok(_) => {
            log::info!(
                "[BACKFILL API] Resumed backfill job {} for org {}",
                job_id,
                org_id
            );
            Ok(HttpResponse::Ok().json(serde_json::json!({
                "message": "Backfill job resumed successfully"
            })))
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to resume backfill job {} for org {}: {}",
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
        ("job_id" = String, Path, description = "Backfill job ID"),
    ),
    responses(
        (status = 200, description = "Backfill job deleted successfully"),
        (status = 404, description = "Job not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
#[delete("/{org_id}/pipelines/backfill/{job_id}")]
pub async fn delete_backfill(
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, job_id) = path.into_inner();

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
    )
)]
#[put("/{org_id}/pipelines/backfill/{job_id}")]
pub async fn update_backfill(
    path: web::Path<(String, String)>,
    body: web::Json<BackfillRequest>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, job_id) = path.into_inner();
    let req = body.into_inner();

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
