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
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    common::utils::auth::UserEmail,
    handler::http::extractors::Headers,
};

// ── Local query / body types ──────────────────────────────────────────────────

#[derive(Debug, Default, Deserialize)]
pub struct ListSyntheticsQuery {
    pub folder: Option<String>,
    #[serde(rename = "type")]
    pub monitor_type: Option<config::meta::synthetics::SyntheticType>,
    pub enabled: Option<bool>,
    pub location: Option<String>,
    pub tag: Option<String>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

impl From<ListSyntheticsQuery> for config::meta::synthetics::ListSyntheticsParams {
    fn from(q: ListSyntheticsQuery) -> Self {
        Self {
            folder_id: q.folder,
            monitor_type: q.monitor_type,
            enabled: q.enabled,
            location: q.location,
            tag: q.tag,
            page: q.page,
            page_size: q.page_size,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
pub struct FolderQuery {
    pub folder: Option<String>,
}

#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
pub struct BulkDeleteSyntheticsRequestBody {
    pub ids: Vec<String>,
}

#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
pub struct MoveSyntheticsRequestBody {
    pub synthetic_ids: Vec<String>,
    pub dst_folder_id: String,
}

// ── Results API ───────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/{id}/results",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ListSyntheticsResults",
    summary = "List check results for a monitor",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("location" = Option<String>, Query, description = "Filter by location"),
        ("page" = Option<u64>, Query, description = "Page number"),
        ("page_size" = Option<u64>, Query, description = "Page size"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn list_results(
    Path((org_id, id)): Path<(String, String)>,
    Query(params): Query<config::meta::synthetics::ListResultsParams>,
) -> Response {
    match crate::service::synthetics::list_results(&org_id, &id, &params).await {
        Ok(resp) => MetaHttpResponse::json(resp),
        Err(e) => {
            tracing::error!("[synthetics] list_results: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/{id}/results/{job_id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSyntheticsResult",
    summary = "Get a single check result",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("job_id" = i64, Path, description = "Job ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn get_result(Path((org_id, id, job_id)): Path<(String, String, String)>) -> Response {
    let job_id: i64 = match job_id.parse() {
        Ok(v) => v,
        Err(_) => return MetaHttpResponse::bad_request("invalid job_id"),
    };
    match crate::service::synthetics::get_result(&org_id, &id, job_id).await {
        Ok(Some(r)) => MetaHttpResponse::json(r),
        Ok(None) => MetaHttpResponse::not_found("result not found"),
        Err(e) => {
            tracing::error!("[synthetics] get_result: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/{id}/results/{job_id}/artifact",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSyntheticsArtifactUrl",
    summary = "Get presigned URL for check artifact (screenshot/trace)",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("job_id" = i64, Path, description = "Job ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 501, description = "Not implemented"),
    ),
)]
pub async fn get_artifact_url(
    Path((_org_id, _id, _job_id)): Path<(String, String, String)>,
) -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({"message": "artifact storage not yet implemented"})),
    )
        .into_response()
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/{id}/summary",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSyntheticsSummary",
    summary = "Get uptime summary and status history for a monitor",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn get_summary(
    Path((org_id, id)): Path<(String, String)>,
    Query(params): Query<config::meta::synthetics::SummaryParams>,
) -> Response {
    match crate::service::synthetics::get_summary(&org_id, &id, params.start_time, params.end_time)
        .await
    {
        Ok(summary) => MetaHttpResponse::json(summary),
        Err(e) => {
            tracing::error!("[synthetics] get_summary: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

// ── Monitors ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ListSynthetics",
    summary = "List synthetics",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "Filter by folder ID (KSUID)"),
        ("type" = Option<String>, Query, description = "Filter by monitor type (http|browser|tcp|tls|ssh)"),
        ("enabled" = Option<bool>, Query, description = "Filter by enabled status"),
        ("location" = Option<String>, Query, description = "Filter by location"),
        ("tag" = Option<String>, Query, description = "Filter by tag"),
        ("page" = Option<u64>, Query, description = "Page number (0-indexed)"),
        ("page_size" = Option<u64>, Query, description = "Results per page"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::synthetics::SyntheticListResponse),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn list_synthetics(
    Path(org_id): Path<String>,
    Query(query): Query<ListSyntheticsQuery>,
) -> Response {
    let params: config::meta::synthetics::ListSyntheticsParams = query.into();
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::list_synthetics(&org_id, &params)
            .await
        {
            Ok(mut resp) => {
                if !resp.monitors.is_empty() {
                    let ids: Vec<&str> = resp.monitors.iter().map(|m| m.id.as_str()).collect();
                    if let Ok(summaries) =
                        crate::service::synthetics::batch_synthetic_summary(&org_id, &ids).await
                    {
                        for item in &mut resp.monitors {
                            if let Some(s) = summaries.get(&item.id) {
                                item.status = s.status.clone();
                                item.last_check_at = s.last_check_at;
                                item.last_response_ms = s.last_response_ms;
                            }
                        }
                    }
                }
                MetaHttpResponse::json(resp)
            }
            Err(e) => {
                tracing::error!("[synthetics] list_synthetics: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, params);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "CreateSynthetic",
    summary = "Create a synthetic",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "Folder ID to create the synthetic in"),
    ),
    request_body(content = config::meta::synthetics::Synthetic, description = "Synthetic definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Created", content_type = "application/json", body = config::meta::synthetics::Synthetic),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn create_synthetic(
    Path(org_id): Path<String>,
    Query(_folder_query): Query<FolderQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<config::meta::synthetics::Synthetic>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let created_by = user_email.user_id.as_str();
        match o2_enterprise::enterprise::synthetics::service::create_synthetic(&org_id, body, created_by).await
        {
            Ok(monitor) => MetaHttpResponse::json(monitor),
            Err(e) => {
                tracing::error!("[synthetics] create_synthetic: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSynthetic",
    summary = "Get a synthetic by ID",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::synthetics::Synthetic),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn get_synthetic(Path((org_id, id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::get_synthetic(&org_id, &id).await {
            Ok(Some(monitor)) => MetaHttpResponse::json(monitor),
            Ok(None) => MetaHttpResponse::not_found("monitor not found"),
            Err(e) => {
                tracing::error!("[synthetics] get_synthetic: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/synthetics/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "UpdateSynthetic",
    summary = "Update a synthetic",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("folder" = Option<String>, Query, description = "Current folder ID of the synthetic (for RBAC)"),
    ),
    request_body(content = config::meta::synthetics::Synthetic, description = "Updated synthetic definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Updated",   content_type = "application/json", body = config::meta::synthetics::Synthetic),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error",     content_type = "application/json", body = Object),
    ),
)]
pub async fn update_synthetic(
    Path((org_id, id)): Path<(String, String)>,
    Query(_folder_query): Query<FolderQuery>,
    Json(body): Json<config::meta::synthetics::Synthetic>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::update_synthetic(&org_id, &id, body)
            .await
        {
            Ok(monitor) => MetaHttpResponse::json(monitor),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("not found") {
                    return MetaHttpResponse::not_found(msg);
                }
                tracing::error!("[synthetics] update_synthetic: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/synthetics/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "DeleteSynthetic",
    summary = "Delete a synthetic",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("folder" = Option<String>, Query, description = "Current folder ID of the synthetic (for RBAC)"),
    ),
    responses(
        (status = 200, description = "Deleted"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_synthetic(
    Path((org_id, id)): Path<(String, String)>,
    Query(_folder_query): Query<FolderQuery>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::delete_synthetic(&org_id, &id).await {
            Ok(true) => MetaHttpResponse::ok("monitor deleted"),
            Ok(false) => MetaHttpResponse::not_found("monitor not found"),
            Err(e) => {
                tracing::error!("[synthetics] delete_synthetic: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/synthetics",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "BulkDeleteSynthetics",
    summary = "Bulk delete synthetics",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "Folder ID of the synthetics (for RBAC)"),
    ),
    request_body(content = BulkDeleteSyntheticsRequestBody, description = "IDs to delete", content_type = "application/json"),
    responses(
        (status = 200, description = "Deleted"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_synthetics_bulk(
    Path(org_id): Path<String>,
    Query(_folder_query): Query<FolderQuery>,
    Json(body): Json<BulkDeleteSyntheticsRequestBody>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::delete_synthetics_bulk(
            &org_id,
            &body.ids,
            _folder_query.folder.as_deref(),
        )
        .await
        {
            Ok(_) => MetaHttpResponse::ok("monitors deleted"),
            Err(e) => {
                tracing::error!("[synthetics] delete_synthetics_bulk: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    patch,
    path = "/v2/{org_id}/synthetics/move",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "MoveSynthetics",
    summary = "Move synthetics to a different folder",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "Source folder ID (for RBAC)"),
    ),
    request_body(content = MoveSyntheticsRequestBody, description = "IDs and destination folder", content_type = "application/json"),
    responses(
        (status = 200, description = "Moved"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn move_synthetics(
    Path(org_id): Path<String>,
    Query(_folder_query): Query<FolderQuery>,
    Json(body): Json<MoveSyntheticsRequestBody>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::move_synthetics(
            &org_id,
            &body.synthetic_ids,
            &body.dst_folder_id,
        )
        .await
        {
            Ok(_) => MetaHttpResponse::ok("monitors moved"),
            Err(e) => {
                tracing::error!("[synthetics] move_synthetics: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/synthetics/{id}/enable",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SetSyntheticEnabled",
    summary = "Enable or pause a synthetic",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
    ),
    request_body(content = Object, description = r#"{"enabled": true}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success"),
        (status = 400, description = "Missing enabled field"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn set_synthetic_enabled(
    Path((org_id, id)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let enabled = match body.get("enabled").and_then(|v| v.as_bool()) {
            Some(v) => v,
            None => return MetaHttpResponse::bad_request("missing boolean field 'enabled'"),
        };
        match o2_enterprise::enterprise::synthetics::service::set_synthetic_enabled(
            &org_id, &id, enabled,
        )
        .await
        {
            Ok(true) => MetaHttpResponse::ok(if enabled {
                "monitor enabled"
            } else {
                "monitor paused"
            }),
            Ok(false) => MetaHttpResponse::not_found("monitor not found"),
            Err(e) => {
                tracing::error!("[synthetics] set_synthetic_enabled: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/{id}/run",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "RunSyntheticNow",
    summary = "Trigger an immediate run of a synthetic",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
    ),
    responses(
        (status = 202, description = "Accepted — scheduler will fire within 5 seconds"),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn run_synthetic_now(Path((org_id, id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::run_synthetic_now(&org_id, &id).await
        {
            Ok(()) => (StatusCode::ACCEPTED, "").into_response(),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("not found") {
                    return MetaHttpResponse::not_found(msg);
                }
                tracing::error!("[synthetics] run_synthetic_now: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── Job API (probe-facing, bypass RBAC, authenticated via o2syn_ token) ──────

#[utoipa::path(
    post,
    path = "/synthetics/jobs/resolve",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsJobResolve",
    summary = "Resolve a job — probe fetches monitor config (authenticated via o2syn_ token)",
    security(("Authorization" = [])),
    request_body(content = Object, description = r#"{"job_id": 42}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "Job not found"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn job_resolve(Json(body): Json<serde_json::Value>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::job_api::ResolveRequest,
        >(body)
        {
            Ok(r) => r,
            Err(e) => {
                return MetaHttpResponse::bad_request(e.to_string());
            }
        };
        match o2_enterprise::enterprise::synthetics::job_api::resolve(req).await {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("not found") {
                    return MetaHttpResponse::not_found(msg);
                }
                tracing::error!("[synthetics] job_resolve: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = body;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/synthetics/jobs/lease",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsJobLease",
    summary = "Lease a batch of jobs for a probe pool (authenticated via o2syn_ token)",
    security(("Authorization" = [])),
    request_body(content = Object, description = r#"{"pool": "aws-browser-chromium", "limit": 10}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn job_lease(Json(body): Json<serde_json::Value>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::job_api::LeaseRequest,
        >(body)
        {
            Ok(r) => r,
            Err(e) => {
                return MetaHttpResponse::bad_request(e.to_string());
            }
        };
        match o2_enterprise::enterprise::synthetics::job_api::lease(req).await {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => {
                tracing::error!("[synthetics] job_lease: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = body;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/synthetics/jobs/ack",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsJobAck",
    summary = "Acknowledge a completed check — probe submits result (authenticated via o2syn_ token)",
    security(("Authorization" = [])),
    request_body(content = Object, description = r#"{"job_id": 42, "status": "up", "response_time_ms": 1200, "error": null}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn job_ack(Json(body): Json<serde_json::Value>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let req = match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::job_api::AckRequest,
        >(body)
        {
            Ok(r) => r,
            Err(e) => {
                return MetaHttpResponse::bad_request(e.to_string());
            }
        };

        let status = req.status.clone();
        let response_time_ms = req.response_time_ms;
        let error = req.error.clone();
        let checked_at = config::utils::time::now_micros();

        match o2_enterprise::enterprise::synthetics::job_api::ack(req).await {
            Ok(resp) => {
                // Emit trigger usage record for synthetics telemetry.
                crate::service::self_reporting::publish_triggers_usage(
                    config::meta::self_reporting::usage::TriggerData {
                        _timestamp: checked_at,
                        org: resp.org_id.clone(),
                        module: config::meta::self_reporting::usage::TriggerDataType::Synthetics,
                        key: resp.monitor_id.clone(),
                        start_time: checked_at,
                        end_time: checked_at,
                        ..Default::default()
                    },
                );

                if !resp.destinations.is_empty() {
                    let org_id = resp.org_id.clone();
                    let monitor_name = resp.monitor_name.clone();
                    let monitor_id = resp.monitor_id.clone();
                    let monitor_type = resp.monitor_type.clone();
                    let target = resp.target.clone();
                    let destinations = resp.destinations.clone();
                    let location = resp.location.clone();
                    tokio::spawn(async move {
                        crate::service::synthetics::notify_check_result(
                            &org_id,
                            &monitor_name,
                            &monitor_id,
                            &monitor_type,
                            &target,
                            &destinations,
                            &location,
                            &status,
                            response_time_ms,
                            error.as_deref(),
                            checked_at,
                        )
                        .await;
                    });
                }
                MetaHttpResponse::json(resp)
            }
            Err(e) => {
                tracing::error!("[synthetics] job_ack: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = body;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── Locations ─────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/locations",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ListSyntheticsLocations",
    summary = "List available probe locations",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_locations(Path(_org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let locations = o2_enterprise::enterprise::synthetics::service::list_locations();
        MetaHttpResponse::json(locations)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = _org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}
