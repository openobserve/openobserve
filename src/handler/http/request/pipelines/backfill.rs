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
    Json,
    extract::{Path, Query},
    response::Response,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{common::meta::http::HttpResponse as MetaHttpResponse, service::alerts::backfill};

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

/// Create a backfill job
///
/// Creates a new backfill job to fill gaps in summary streams.
#[utoipa::path(
    post,
    path = "/{org_id}/pipelines/{pipeline_id}/backfill",
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
pub async fn create_backfill(
    Path((org_id, pipeline_id)): Path<(String, String)>,
    Json(req): Json<BackfillRequest>,
) -> Response {
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
            MetaHttpResponse::json(BackfillResponse {
                job_id: job_id.clone(),
                message: format!("Backfill job {} created successfully", job_id),
            })
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to create backfill job for pipeline {}: {}",
                pipeline_id,
                e
            );
            MetaHttpResponse::bad_request(e.to_string())
        }
    }
}

/// List all backfill jobs for an organization
///
/// Returns a list of all backfill jobs in the specified organization.
#[utoipa::path(
    get,
    path = "/{org_id}/pipelines/backfill",
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
pub async fn list_backfills(Path(org_id): Path<String>) -> Response {
    match backfill::list_backfill_jobs(&org_id).await {
        Ok(jobs) => {
            log::debug!(
                "[BACKFILL API] Listed {} backfill jobs for org {}",
                jobs.len(),
                org_id
            );
            MetaHttpResponse::json(jobs)
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to list backfill jobs for org {}: {}",
                org_id,
                e
            );
            MetaHttpResponse::internal_error(e.to_string())
        }
    }
}

/// Get backfill job status
///
/// Returns the status of a specific backfill job.
#[utoipa::path(
    get,
    path = "/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}",
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
        (status = 200, description = "Backfill job status", body = backfill::BackfillJobStatus),
        (status = 404, description = "Job not found"),
        (status = 500, description = "Internal server error"),
    ),
)]
pub async fn get_backfill(
    Path((org_id, pipeline_id, job_id)): Path<(String, String, String)>,
) -> Response {
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
                MetaHttpResponse::not_found(format!(
                    "Backfill job {} not found for pipeline {}",
                    job_id, pipeline_id
                ));
            }

            log::debug!(
                "[BACKFILL API] Retrieved backfill job {} for org {}",
                job_id,
                org_id
            );
            MetaHttpResponse::json(job)
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to get backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            MetaHttpResponse::not_found(e.to_string())
        }
    }
}

/// Enable or disable a backfill job
///
/// Enables (resumes) or disables (pauses) a backfill job.
#[utoipa::path(
    put,
    path = "/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}/enable",
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
pub async fn enable_backfill(
    Path((org_id, pipeline_id, job_id)): Path<(String, String, String)>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let enable = query
        .get("value")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or(false);

    // Verify the job belongs to the specified pipeline
    match backfill::get_backfill_job(&org_id, &job_id).await {
        Ok(job) => {
            if job.pipeline_id != pipeline_id {
                return MetaHttpResponse::not_found(format!(
                    "Backfill job {} not found for pipeline {}",
                    job_id, pipeline_id
                ));
            }
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to get backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            return MetaHttpResponse::not_found(e.to_string());
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
            MetaHttpResponse::json(serde_json::json!({
                "message": format!(
                    "Backfill job {} successfully",
                    if enable { "enabled" } else { "disabled" }
                )
            }))
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to {} backfill job {} for org {}: {}",
                if enable { "enable" } else { "disable" },
                job_id,
                org_id,
                e
            );
            MetaHttpResponse::bad_request(e.to_string())
        }
    }
}

/// Delete a backfill job
///
/// Deletes a backfill job permanently.
#[utoipa::path(
    delete,
    path = "/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}",
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
pub async fn delete_backfill(
    Path((org_id, pipeline_id, job_id)): Path<(String, String, String)>,
) -> Response {
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
                return MetaHttpResponse::not_found(format!(
                    "Backfill job {} not found for pipeline {}",
                    job_id, pipeline_id
                ));
            }
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to get backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            return MetaHttpResponse::not_found(e.to_string());
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
            MetaHttpResponse::json(serde_json::json!({
                "message": "Backfill job deleted successfully"
            }))
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to delete backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            MetaHttpResponse::not_found(e.to_string())
        }
    }
}

/// Update an existing backfill job
#[utoipa::path(
    put,
    path = "/{org_id}/pipelines/{pipeline_id}/backfill/{job_id}",
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
pub async fn update_backfill(
    Path((org_id, pipeline_id, job_id)): Path<(String, String, String)>,
    Json(req): Json<BackfillRequest>,
) -> Response {
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
                return MetaHttpResponse::not_found(format!(
                    "Backfill job {} not found for pipeline {}",
                    job_id, pipeline_id
                ));
            }
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to get backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            return MetaHttpResponse::not_found(e.to_string());
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
            MetaHttpResponse::json(serde_json::json!({
                "message": "Backfill job updated successfully"
            }))
        }
        Err(e) => {
            log::error!(
                "[BACKFILL API] Failed to update backfill job {} for org {}: {}",
                job_id,
                org_id,
                e
            );
            MetaHttpResponse::bad_request(e.to_string())
        }
    }
}
