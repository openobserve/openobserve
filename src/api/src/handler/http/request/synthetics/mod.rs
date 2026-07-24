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
use common::meta::http::HttpResponse as MetaHttpResponse;
use serde::Deserialize;

// Used only inside #[cfg(feature = "enterprise")] handler bodies.
#[cfg(feature = "enterprise")]
use crate::{
    handler::http::extractors::Headers,
    service::auth::{UserEmail, check_permissions},
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

// ── Runs API ──────────────────────────────────────────────────────────────────

#[derive(Debug, Default, Deserialize)]
pub struct ListRunsQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/{id}/runs",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ListSyntheticsRuns",
    summary = "List runs for a monitor",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("start_time" = Option<i64>, Query, description = "Filter runs with scheduled_ts >= start_time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "Filter runs with scheduled_ts <= end_time (microseconds)"),
        ("page" = Option<i64>, Query, description = "Page number (0-indexed, default 0)"),
        ("page_size" = Option<i64>, Query, description = "Results per page (default 20)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn list_runs(
    Path((org_id, id)): Path<(String, String)>,
    Query(q): Query<ListRunsQuery>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let page = q.page.unwrap_or(0).max(0);
        let page_size = q.page_size.unwrap_or(20).clamp(1, 200);
        match o2_enterprise::enterprise::synthetics::service::list_runs(
            &org_id,
            &id,
            q.start_time,
            q.end_time,
            page,
            page_size,
        )
        .await
        {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => {
                tracing::error!("[synthetics] list_runs: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, q);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/{id}/runs/{run_id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSyntheticsRun",
    summary = "Get a single run by ID",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Monitor ID"),
        ("run_id" = String, Path, description = "Run ID (KSUID)"),
    ),
    responses(
        (status = 200, description = "Success",   content_type = "application/json", body = Object),
        (status = 404, description = "Not found"),
        (status = 500, description = "Error",     content_type = "application/json", body = Object),
    ),
)]
pub async fn get_run_detail(
    Path((org_id, id, run_id)): Path<(String, String, String)>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::get_run_detail(&org_id, &id, &run_id)
            .await
        {
            Ok(Some(run)) => MetaHttpResponse::json(run),
            Ok(None) => MetaHttpResponse::not_found("run not found"),
            Err(e) => {
                tracing::error!("[synthetics] get_run_detail: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, run_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── Artifact download ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ArtifactQuery {
    pub key: String,
}

/// Streams artifact bytes from the object store. Proxy target for local disk
/// mode where presigned URLs are impossible.
/// Keys are validated against the authed org + synthetic so a caller can only
/// read artifacts belonging to that synthetic.
async fn stream_artifact(org_id: &str, synthetics_id: &str, key: &str) -> Response {
    let prefix = format!("synthetics/{org_id}/{synthetics_id}/");
    if !key.starts_with(&prefix) || key.contains("..") {
        return MetaHttpResponse::bad_request("invalid artifact key").into_response();
    }
    let content_type = if key.ends_with(".png") {
        "image/png"
    } else {
        "application/zip"
    };
    match infra::storage::get_bytes("default", key).await {
        Ok(bytes) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, content_type)],
            bytes,
        )
            .into_response(),
        Err(e) => {
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

/// GET /{org_id}/synthetics/{id}/artifact?key= — proxy download (local disk mode).
pub async fn get_artifact(
    Path((org_id, id)): Path<(String, String)>,
    Query(query): Query<ArtifactQuery>,
) -> Response {
    stream_artifact(&org_id, &id, &query.key).await
}

/// POST /{org_id}/synthetics/{id}/artifacts/presign — batch-sign download URLs.
/// Body: { "keys": [...] } (keys come from stream records: screenshot_key, trace_key).
/// Returns { mode: "presigned" | "proxy", expires_in, urls: [{key, url}] }.
pub async fn presign_artifacts(
    Path((org_id, id)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::job_api::PresignArtifactsRequest,
        >(body)
        {
            Ok(req) => {
                match o2_enterprise::enterprise::synthetics::job_api::presign_artifacts(
                    &org_id, &id, req,
                )
                .await
                {
                    Ok(resp) => MetaHttpResponse::json(resp),
                    Err(e) => {
                        tracing::error!(
                            synthetics_id = %id,
                            "[synthetics] presign_artifacts: {e}"
                        );
                        MetaHttpResponse::bad_request(e.to_string())
                    }
                }
            }
            Err(e) => MetaHttpResponse::bad_request(e.to_string()),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

pub async fn job_artifact_urls(
    Path(org_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if let Err(resp) = authorize_probe(&headers, &org_id).await {
            return resp;
        }
        match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::job_api::ArtifactUrlsRequest,
        >(body)
        {
            Ok(req) => {
                match o2_enterprise::enterprise::synthetics::job_api::artifact_urls(req, &org_id)
                    .await
                {
                    Ok(resp) => MetaHttpResponse::json(resp),
                    Err(e) => {
                        let msg = e.to_string();
                        if msg.starts_with("forbidden") {
                            return MetaHttpResponse::forbidden(msg);
                        }
                        tracing::error!("[synthetics] artifact_urls: {e}");
                        MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                            .into_response()
                    }
                }
            }
            Err(e) => MetaHttpResponse::bad_request(e.to_string()),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, headers, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

pub async fn job_upload(
    Path(org_id): Path<String>,
    headers: axum::http::HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
    body: axum::body::Bytes,
) -> Response {
    #[cfg(feature = "enterprise")]
    if let Err(resp) = authorize_probe(&headers, &org_id).await {
        return resp;
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = &headers;
    let key = match params.get("key") {
        Some(k) => k.clone(),
        None => return MetaHttpResponse::bad_request("missing key param"),
    };
    // Keys are namespaced `synthetics/{org_id}/...` — reject a key that tries to
    // write outside the caller's org (defense in depth over the token check).
    if !key.starts_with(&format!("synthetics/{org_id}/")) {
        return MetaHttpResponse::forbidden("artifact key does not belong to this org");
    }
    match infra::storage::put(&org_id, &key, body).await {
        Ok(_) => MetaHttpResponse::ok("uploaded"),
        Err(e) => {
            tracing::error!("[synthetics] job_upload: {e}");
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
            Ok(resp) => MetaHttpResponse::json(resp),
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
    Query(folder_query): Query<FolderQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<config::meta::synthetics::Synthetic>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // The permission gate for POST /synthetics checks the `?folder=` query
        // param, so the destination folder MUST come from the same place —
        // otherwise a crafted body.folder_id could create a check in a folder
        // the user can't access (gate checks query, write used body). Make the
        // query authoritative and ignore any folder in the body, exactly like
        // regular alerts' create_alert (get_folder(query)). Default when absent.
        // (`mut` re-bind here, not in the signature, so the OSS build — where
        // this block is cfg'd out — doesn't warn about an unused `mut`.)
        let mut body = body;
        body.folder_id = folder_query
            .folder
            .filter(|f| !f.is_empty())
            .unwrap_or_else(|| config::meta::folder::DEFAULT_FOLDER.to_string());

        let created_by = user_email.user_id.as_str();
        match o2_enterprise::enterprise::synthetics::service::create_synthetic(
            &org_id, body, created_by,
        )
        .await
        {
            Ok(monitor) => MetaHttpResponse::json(monitor),
            Err(e) => {
                let msg = e.to_string();
                if msg.starts_with("validation: ") {
                    return MetaHttpResponse::bad_request(msg);
                }
                tracing::error!("[synthetics] create_synthetic: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body, folder_query);
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
pub async fn get_synthetic(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // get_by_id returns full decrypted credentials — requires write permission.
        if !check_permissions(
            &id,
            &org_id,
            &user_email.user_id,
            "synthetics",
            "PUT",
            None,
            false,
            true,
            false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<config::meta::synthetics::Synthetic>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !check_permissions(
            &id,
            &org_id,
            &user_email.user_id,
            "synthetics",
            "PUT",
            _folder_query.folder.as_deref(),
            false,
            true,
            false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::synthetics::service::update_synthetic(&org_id, &id, body)
            .await
        {
            Ok(monitor) => MetaHttpResponse::json(monitor),
            Err(e) => {
                let msg = e.to_string();
                if msg.starts_with("validation: ") {
                    return MetaHttpResponse::bad_request(msg);
                }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !check_permissions(
            &id,
            &org_id,
            &user_email.user_id,
            "synthetics",
            "DELETE",
            _folder_query.folder.as_deref(),
            false,
            true,
            false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<MoveSyntheticsRequestBody>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // RBAC: moving a check is a write — require PUT on each check being
        // moved (same shape get_synthetic/update use). Mirrors alerts'
        // move_to_folder check; without it a List+Delete-only role could move
        // checks between folders. The move route is bypass:true, so this
        // in-handler check is the only gate.
        for id in &body.synthetic_ids {
            if !check_permissions(
                id,
                &org_id,
                &user_email.user_id,
                "synthetics",
                "PUT",
                None,
                false,
                true,
                false,
            )
            .await
            {
                return MetaHttpResponse::forbidden("Forbidden");
            }
        }
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
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !check_permissions(
            &id,
            &org_id,
            &user_email.user_id,
            "synthetics",
            "PUT",
            None,
            false,
            true,
            false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
pub async fn run_synthetic_now(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !check_permissions(
            &id,
            &org_id,
            &user_email.user_id,
            "synthetics",
            "PUT",
            None,
            false,
            true,
            false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Forbidden");
        }
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
pub async fn job_resolve(
    Path(org_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if let Err(resp) = authorize_probe(&headers, &org_id).await {
            return resp;
        }
        let req = match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::job_api::ResolveRequest,
        >(body)
        {
            Ok(r) => r,
            Err(e) => {
                return MetaHttpResponse::bad_request(e.to_string());
            }
        };
        match o2_enterprise::enterprise::synthetics::job_api::resolve(req, &org_id).await {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => {
                let msg = e.to_string();
                if msg.starts_with("forbidden") {
                    return MetaHttpResponse::forbidden(msg);
                }
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
        let _ = (org_id, headers, body);
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
    request_body(content = Object, description = r#"{"pool": "aws-browser", "limit": 10}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error",   content_type = "application/json", body = Object),
    ),
)]
pub async fn job_lease(
    Path(org_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if let Err(resp) = authorize_probe(&headers, &org_id).await {
            return resp;
        }
        let req = match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::job_api::LeaseRequest,
        >(body)
        {
            Ok(r) => r,
            Err(e) => {
                return MetaHttpResponse::bad_request(e.to_string());
            }
        };
        match o2_enterprise::enterprise::synthetics::job_api::lease(req, &org_id).await {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => {
                let msg = e.to_string();
                if msg.starts_with("forbidden") {
                    return MetaHttpResponse::forbidden(msg);
                }
                tracing::error!("[synthetics] job_lease: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, headers, body);
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
pub async fn job_ack(
    Path(org_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::synthetics::job_api::{AckBatchRequest, AckRequest};

        if let Err(resp) = authorize_probe(&headers, &org_id).await {
            return resp;
        }

        // Batch of rich acks: {"acks": [{...}, ...]}. Cadence is the sender's
        // choice — browser probe acks per execution (array of one), protocol
        // agents accumulate per lease cycle. The bare single-job shape stays
        // accepted for compatibility.
        if body.get("acks").is_some() {
            let req = match serde_json::from_value::<AckBatchRequest>(body) {
                Ok(r) => r,
                Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
            };
            let mut results = Vec::with_capacity(req.acks.len());
            for ack in req.acks {
                let job_id = ack.job_id.clone();
                match process_ack(ack, &org_id).await {
                    Ok(resp) => results.push(serde_json::json!({
                        "job_id": job_id,
                        "ok": true,
                        "run_complete": resp.run_complete,
                    })),
                    Err(e) => {
                        tracing::error!(job_id = %job_id, "[synthetics] job_ack: {e}");
                        results.push(serde_json::json!({
                            "job_id": job_id,
                            "ok": false,
                            "error": e.to_string(),
                        }));
                    }
                }
            }
            return MetaHttpResponse::json(serde_json::json!({ "results": results }));
        }

        let req = match serde_json::from_value::<AckRequest>(body) {
            Ok(r) => r,
            Err(e) => {
                return MetaHttpResponse::bad_request(e.to_string());
            }
        };
        match process_ack(req, &org_id).await {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => {
                let msg = e.to_string();
                if msg.starts_with("forbidden") {
                    return MetaHttpResponse::forbidden(msg);
                }
                tracing::error!("[synthetics] job_ack: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, headers, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// Runs one job ack through the enterprise service plus the per-ack side
/// effects (telemetry, run-complete notification). Shared by the single and
/// batch forms of `job_ack`.
#[cfg(feature = "enterprise")]
async fn process_ack(
    req: o2_enterprise::enterprise::synthetics::job_api::AckRequest,
    token_org: &str,
) -> anyhow::Result<o2_enterprise::enterprise::synthetics::job_api::AckResponse> {
    let status = req.status.clone();
    let response_time_ms = req.response_time_ms;
    let error = req.error.clone();
    let checked_at = config::utils::time::now_micros();

    let resp = o2_enterprise::enterprise::synthetics::job_api::ack(req, token_org).await?;

    // Emit trigger usage record for synthetics telemetry.
    openobserve_core::self_reporting::publish_triggers_usage(
        config::meta::self_reporting::usage::TriggerData {
            _timestamp: checked_at,
            org: resp.org_id.clone(),
            module: config::meta::self_reporting::usage::TriggerDataType::Synthetics,
            key: format!("{}/{}", resp.synthetics_name, resp.synthetics_id),
            start_time: checked_at,
            end_time: checked_at,
            status: config::meta::self_reporting::usage::TriggerDataStatus::Completed,
            success_response: Some(status.clone()),
            error: error.clone(),
            evaluation_took_in_secs: Some(response_time_ms / 1000.0),
            ..Default::default()
        },
    );

    // Notify once per run, not once per job ack.
    if resp.run_complete && !resp.destinations.is_empty() {
        let notification = openobserve_core::synthetics::CheckNotification {
            org_id: resp.org_id.clone(),
            monitor_name: resp.synthetics_name.clone(),
            monitor_id: resp.synthetics_id.clone(),
            monitor_type: resp.synthetic_type.clone(),
            target: resp.target.clone(),
            destinations: resp.destinations.clone(),
            run_id: resp.run_id.clone(),
            status: resp.run_status.clone().unwrap_or_else(|| status.clone()),
            job_count: resp.job_count as i64,
            error: error.clone(),
            checked_at,
        };
        tokio::spawn(async move {
            openobserve_core::synthetics::notify_check_result(notification).await;
        });
    }
    Ok(resp)
}

// ── Agent liveness API (probe-facing, authenticated via o2syn_ token) ────────

/// Resolves the org owning the `o2syn_` token in a Basic Authorization header.
/// The auth middleware has already validated the token; this recovers the org
/// for scoping, which the middleware does not propagate on probe paths.
#[cfg(feature = "enterprise")]
async fn probe_token_org(headers: &axum::http::HeaderMap) -> Option<String> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    let decoded = config::utils::base64::decode(auth.strip_prefix("Basic ")?).ok()?;
    let token = decoded.split_once(':')?.1;
    infra::table::synthetics_probe_tokens::find_global(token)
        .await
        .ok()
        .flatten()
        .map(|t| t.org_id)
}

/// Resolves the id of the `o2syn_` token in a Basic Authorization header — used
/// at register to stamp `synthetics_agents.token_id` ("N agents on this token").
#[cfg(feature = "enterprise")]
async fn probe_token_id(headers: &axum::http::HeaderMap) -> Option<String> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    let decoded = config::utils::base64::decode(auth.strip_prefix("Basic ")?).ok()?;
    let token = decoded.split_once(':')?.1;
    infra::table::synthetics_probe_tokens::find_global(token)
        .await
        .ok()
        .flatten()
        .map(|t| t.id)
}

/// Authorizes a probe request against the `{org_id}` in the path: the Basic
/// `o2syn_` token must exist and belong to that org. Returns Ok(()) when the
/// token org matches, Err(response) otherwise — this is the tenant boundary for
/// every probe-facing route (the org in the URL, the token's org, and the
/// job's org must all agree; the service layer enforces the last leg).
#[cfg(feature = "enterprise")]
async fn authorize_probe(headers: &axum::http::HeaderMap, org_id: &str) -> Result<(), Response> {
    match probe_token_org(headers).await {
        Some(token_org) if token_org == org_id => Ok(()),
        Some(_) => Err(MetaHttpResponse::forbidden(
            "probe token does not belong to this org",
        )),
        None => Err(MetaHttpResponse::unauthorized("invalid probe token")),
    }
}

#[utoipa::path(
    post,
    path = "/synthetics/agent/register",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsAgentRegister",
    summary = "Register a probe agent for a location (authenticated via o2syn_ token)",
    security(("Authorization" = [])),
    request_body(content = Object, description = r#"{"name": "dc1-agent-01", "location_id": "...", "version": "1.2.0", "capabilities": {"types": ["http"], "icmp": false}}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "Location not found"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn agent_register(
    Path(org_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if let Err(resp) = authorize_probe(&headers, &org_id).await {
            return resp;
        }
        let req = match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::agent::RegisterRequest,
        >(body)
        {
            Ok(r) => r,
            Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
        };
        let token_id = probe_token_id(&headers).await;
        match o2_enterprise::enterprise::synthetics::agent::register(req, &org_id, token_id).await {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("not found") || msg.contains("disabled") {
                    return MetaHttpResponse::not_found(msg);
                }
                tracing::error!("[synthetics] agent_register: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, headers, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/synthetics/agent/heartbeat",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsAgentHeartbeat",
    summary = "Refresh an agent's liveness (authenticated via o2syn_ token)",
    security(("Authorization" = [])),
    request_body(content = Object, description = r#"{"agent_id": "..."}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "Agent not found"),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn agent_heartbeat(
    Path(org_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if let Err(resp) = authorize_probe(&headers, &org_id).await {
            return resp;
        }
        let req = match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::agent::HeartbeatRequest,
        >(body)
        {
            Ok(r) => r,
            Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
        };
        match o2_enterprise::enterprise::synthetics::agent::heartbeat(req, &org_id).await {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("not found") {
                    return MetaHttpResponse::not_found(msg);
                }
                tracing::error!("[synthetics] agent_heartbeat: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, headers, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── Locations CRUD ────────────────────────────────────────────────────────────

/// Maps a location service error onto the right HTTP status.
#[cfg(feature = "enterprise")]
fn location_error_response(e: anyhow::Error) -> Response {
    let msg = e.to_string();
    if msg.starts_with("validation:") {
        MetaHttpResponse::bad_request(msg)
    } else if msg.starts_with("forbidden:") {
        MetaHttpResponse::forbidden(msg)
    } else if msg.contains("not found") {
        MetaHttpResponse::not_found(msg)
    } else {
        tracing::error!("[synthetics] locations: {msg}");
        MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg).into_response()
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/locations",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "CreateSyntheticsLocation",
    summary = "Create a probe location (kind=public is root-only)",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = Object, description = r#"{"kind": "public", "id": "aws-us-east-1", "provider": "aws", "region": "us-east-1", "label": "AWS US East (N. Virginia)"}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Validation error"),
        (status = 403, description = "Public locations are root-only"),
    ),
)]
pub async fn create_location(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::synthetics::service::{
            CreateLocationRequest, create_location,
        };

        let is_root = db::user::is_root_user(&user_email.user_id);

        // Batch shape: {"locations": [{...}, ...]} → per-item results, same
        // pattern as batch acks. Single-object shape stays unchanged.
        if body.get("locations").is_some() {
            #[derive(serde::Deserialize)]
            struct Batch {
                locations: Vec<CreateLocationRequest>,
            }
            let batch = match serde_json::from_value::<Batch>(body) {
                Ok(b) => b,
                Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
            };
            let mut results = Vec::with_capacity(batch.locations.len());
            for req in batch.locations {
                let label = req.label.clone();
                match create_location(&org_id, is_root, req).await {
                    Ok(resp) => results.push(serde_json::json!({
                        "id": resp.location.id, "pool": resp.location.pool, "ok": true,
                    })),
                    Err(e) => results.push(serde_json::json!({
                        "label": label, "ok": false, "error": e.to_string(),
                    })),
                }
            }
            return MetaHttpResponse::json(serde_json::json!({ "results": results }));
        }

        let req = match serde_json::from_value::<CreateLocationRequest>(body) {
            Ok(r) => r,
            Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
        };
        match create_location(&org_id, is_root, req).await {
            Ok(loc) => MetaHttpResponse::json(loc),
            Err(e) => location_error_response(e),
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
    path = "/{org_id}/synthetics/agent-setup",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsAgentSetup",
    summary = "Org-level private-agent setup: o2syn_ token + docker install template",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Error", content_type = "application/json", body = Object),
    ),
)]
pub async fn agent_setup(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::agent_setup(&org_id).await {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => {
                tracing::error!("[synthetics] agent_setup: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

// ── Agent token management (list / rotate / revoke) ─────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateAgentTokenRequest {
    /// Operator-chosen name (e.g. per region/site). Required; must be unique in
    /// the org and not "default".
    pub name: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct RotateAgentTokenRequest {
    /// Optional operator-chosen name (e.g. per region/agent). Omitted → a
    /// timestamped name.
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetAgentTokenEnabledRequest {
    pub enabled: bool,
}

// RBAC for these routes is enforced by the OpenFGA route-permission middleware
// (`o2_openfga/.../route_permissions.rs`): all three gate on `synthetic_folder`
// WRITE (PUT), the same resource as `agent-setup`. No inline role check here —
// that keeps the whole synthetics management surface consistent (a view-only
// user is rejected before the handler runs).

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/agent-tokens",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "ListSyntheticsAgentTokens",
    summary = "List the org's private-agent (o2syn_) tokens (values masked)",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 403, description = "Admin or Root role required"),
    ),
)]
pub async fn list_agent_tokens(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::list_agent_tokens(&org_id).await {
            Ok(tokens) => MetaHttpResponse::json(serde_json::json!({ "tokens": tokens })),
            Err(e) => {
                tracing::error!("[synthetics] list_agent_tokens: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/agent-tokens",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "CreateSyntheticsAgentToken",
    summary = "Create a named, non-default agent token (shown once)",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = Object, description = r#"{"name": "us-east"}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "New token (shown once)", content_type = "application/json", body = Object),
        (status = 400, description = "Name missing/reserved/duplicate"),
        (status = 403, description = "Admin or Root role required"),
    ),
)]
pub async fn create_agent_token(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<CreateAgentTokenRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::create_agent_token(
            &org_id,
            &body.name,
            &user_email.user_id,
        )
        .await
        {
            Ok(secret) => MetaHttpResponse::json(secret),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("already exists")
                    || msg.contains("reserved")
                    || msg.contains("required")
                {
                    return MetaHttpResponse::bad_request(msg);
                }
                tracing::error!("[synthetics] create_agent_token: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
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
    post,
    path = "/{org_id}/synthetics/agent-tokens/rotate",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "RotateSyntheticsAgentToken",
    summary = "Mint a new default agent token; the old one stays valid until disabled",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = Object, description = r#"{"name": "dc-east"}  (name optional)"#, content_type = "application/json"),
    responses(
        (status = 200, description = "New token (shown once)", content_type = "application/json", body = Object),
        (status = 400, description = "Token name already exists"),
        (status = 403, description = "Admin or Root role required"),
    ),
)]
pub async fn rotate_agent_token(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<RotateAgentTokenRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::rotate_agent_token(
            &org_id,
            body.name,
            &user_email.user_id,
        )
        .await
        {
            Ok(secret) => MetaHttpResponse::json(secret),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("already exists") {
                    return MetaHttpResponse::bad_request(msg);
                }
                tracing::error!("[synthetics] rotate_agent_token: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg)
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
    path = "/{org_id}/synthetics/agent-tokens/{name}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SetSyntheticsAgentTokenEnabled",
    summary = "Enable or disable (revoke) a named agent token",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Token name"),
    ),
    request_body(content = Object, description = r#"{"enabled": false}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Cannot disable the default token — rotate first"),
        (status = 403, description = "Admin or Root role required"),
        (status = 404, description = "Token not found"),
    ),
)]
pub async fn set_agent_token_enabled(
    Path((org_id, name)): Path<(String, String)>,
    Json(body): Json<SetAgentTokenEnabledRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::set_agent_token_enabled(
            &org_id,
            &name,
            body.enabled,
        )
        .await
        {
            Ok(()) => {
                let state = if body.enabled { "enabled" } else { "disabled" };
                MetaHttpResponse::json(serde_json::json!({
                    "message": format!("Token {state} successfully")
                }))
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("not found") {
                    MetaHttpResponse::not_found(msg)
                } else {
                    MetaHttpResponse::bad_request(msg)
                }
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, name, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/synthetics/locations/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "GetSyntheticsLocation",
    summary = "Location detail: stats + registered agents + assigned checks",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Location id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "Not found"),
    ),
)]
pub async fn get_location(Path((org_id, id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::synthetics::service::location_detail(&org_id, &id).await {
            Ok(detail) => MetaHttpResponse::json(detail),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("not found") {
                    return MetaHttpResponse::not_found(msg);
                }
                tracing::error!("[synthetics] get_location: {e}");
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

#[utoipa::path(
    put,
    path = "/{org_id}/synthetics/locations/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "UpdateSyntheticsLocation",
    summary = "Update a probe location's label/enabled (public rows root-only)",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Location id"),
    ),
    request_body(content = Object, description = r#"{"label": "New label", "enabled": true}"#, content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 403, description = "Public locations are root-only"),
        (status = 404, description = "Not found"),
    ),
)]
pub async fn update_location(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let is_root = db::user::is_root_user(&user_email.user_id);
        let req = match serde_json::from_value::<
            o2_enterprise::enterprise::synthetics::service::UpdateLocationRequest,
        >(body)
        {
            Ok(r) => r,
            Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
        };
        match o2_enterprise::enterprise::synthetics::service::update_location(
            &org_id, is_root, &id, req,
        )
        .await
        {
            Ok(loc) => MetaHttpResponse::json(loc),
            Err(e) => location_error_response(e),
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
    path = "/{org_id}/synthetics/locations/{id}",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "DeleteSyntheticsLocation",
    summary = "Delete a probe location (rejected while synthetics reference it)",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Location id"),
    ),
    responses(
        (status = 200, description = "Deleted"),
        (status = 400, description = "Still referenced by synthetics"),
        (status = 403, description = "Public locations are root-only"),
        (status = 404, description = "Not found"),
    ),
)]
pub async fn delete_location(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let is_root = db::user::is_root_user(&user_email.user_id);
        match o2_enterprise::enterprise::synthetics::service::delete_location(&org_id, is_root, &id)
            .await
        {
            Ok(()) => MetaHttpResponse::json(serde_json::json!({"deleted": true})),
            Err(e) => location_error_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

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
        match o2_enterprise::enterprise::synthetics::service::list_locations_for_org(&_org_id).await
        {
            Ok(capabilities) => MetaHttpResponse::json(capabilities),
            Err(e) => {
                tracing::error!("[synthetics] list_locations: {e}");
                MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                    .into_response()
            }
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = _org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}
