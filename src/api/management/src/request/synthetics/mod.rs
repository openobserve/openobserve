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

mod last_check;

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use openobserve_api_common::extractors::Headers;
use serde::Deserialize;

use crate::service::auth::UserEmail;
// OSS has an arm that always returns false, so every guard below is gated
// rather than relying on it — per-resource RBAC is enterprise, and an OSS build
// must not 403 its way through a feature it ships.
#[cfg(feature = "enterprise")]
use crate::service::auth::check_permissions;

// ── Local query / body types ──────────────────────────────────────────────────

#[derive(Debug, Default, Deserialize)]
pub struct ListSyntheticsQuery {
    pub folder: Option<String>,
    #[serde(rename = "type")]
    pub check_type: Option<config::meta::synthetics::SyntheticType>,
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
            check_type: q.check_type,
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
    summary = "List runs for a check",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Check ID"),
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
    let page = q.page.unwrap_or(0).max(0);
    let page_size = q.page_size.unwrap_or(20).clamp(1, 200);
    match openobserve_synthetics::service::list_runs(
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
        ("id" = String, Path, description = "Check ID"),
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
    match openobserve_synthetics::service::get_run_detail(&org_id, &id, &run_id).await {
        Ok(Some(run)) => MetaHttpResponse::json(run),
        Ok(None) => MetaHttpResponse::not_found("run not found"),
        Err(e) => {
            tracing::error!("[synthetics] get_run_detail: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
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
    match serde_json::from_value::<openobserve_synthetics::job_api::PresignArtifactsRequest>(body) {
        Ok(req) => {
            match openobserve_synthetics::job_api::presign_artifacts(&org_id, &id, req).await {
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

pub async fn job_artifact_urls(
    Path(org_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    if let Err(resp) = authorize_probe(&headers, &org_id).await {
        return resp;
    }
    match serde_json::from_value::<openobserve_synthetics::job_api::ArtifactUrlsRequest>(body) {
        Ok(req) => match openobserve_synthetics::job_api::artifact_urls(req, &org_id).await {
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
        },
        Err(e) => MetaHttpResponse::bad_request(e.to_string()),
    }
}

pub async fn job_upload(
    Path(org_id): Path<String>,
    headers: axum::http::HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
    body: axum::body::Bytes,
) -> Response {
    // Ungated. This is the tenant boundary for an artifact upload, and the
    // route is registered in every build now — an OSS build that skipped it
    // would accept writes into any org's artifact prefix from anyone who can
    // reach the endpoint.
    if let Err(resp) = authorize_probe(&headers, &org_id).await {
        return resp;
    }
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

// ── Checks ──────────────────────────────────────────────────────────────────

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
        ("type" = Option<String>, Query, description = "Filter by check type (http|browser|tcp|tls|ssh)"),
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
    match openobserve_synthetics::service::list_synthetics(&org_id, &params).await {
        Ok(mut resp) => {
            last_check::enrich(&org_id, &mut resp.checks).await;
            MetaHttpResponse::json(resp)
        }
        Err(e) => {
            tracing::error!("[synthetics] list_synthetics: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
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
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<config::meta::synthetics::Synthetic>,
) -> Response {
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
    match openobserve_synthetics::service::create_synthetic(&org_id, body, created_by).await {
        Ok(check) => MetaHttpResponse::json(check),
        Err(e) => {
            let msg = e.to_string();
            if msg.starts_with("validation: ") {
                return MetaHttpResponse::bad_request(msg);
            }
            tracing::error!("[synthetics] create_synthetic: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg).into_response()
        }
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
        ("id" = String, Path, description = "Check ID"),
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
    // get_by_id returns full decrypted credentials — requires write permission.
    #[cfg(feature = "enterprise")]
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
    match openobserve_synthetics::service::get_synthetic(&org_id, &id).await {
        Ok(Some(check)) => MetaHttpResponse::json(check),
        Ok(None) => MetaHttpResponse::not_found("check not found"),
        Err(e) => {
            tracing::error!("[synthetics] get_synthetic: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
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
        ("id" = String, Path, description = "Check ID"),
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
    match openobserve_synthetics::service::update_synthetic(&org_id, &id, body).await {
        Ok(check) => MetaHttpResponse::json(check),
        Err(e) => {
            let msg = e.to_string();
            if msg.starts_with("validation: ") {
                return MetaHttpResponse::bad_request(msg);
            }
            if msg.contains("not found") {
                return MetaHttpResponse::not_found(msg);
            }
            tracing::error!("[synthetics] update_synthetic: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg).into_response()
        }
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
        ("id" = String, Path, description = "Check ID"),
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
    match openobserve_synthetics::service::delete_synthetic(&org_id, &id).await {
        Ok(true) => MetaHttpResponse::ok("check deleted"),
        Ok(false) => MetaHttpResponse::not_found("check not found"),
        Err(e) => {
            tracing::error!("[synthetics] delete_synthetic: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
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
    match openobserve_synthetics::service::delete_synthetics_bulk(
        &org_id,
        &body.ids,
        _folder_query.folder.as_deref(),
    )
    .await
    {
        Ok(_) => MetaHttpResponse::ok("checks deleted"),
        Err(e) => {
            tracing::error!("[synthetics] delete_synthetics_bulk: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
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
    // RBAC: moving a check is a write — require PUT on each check being
    // moved (same shape get_synthetic/update use). Mirrors alerts'
    // move_to_folder check; without it a List+Delete-only role could move
    // checks between folders. The move route is bypass:true, so this
    // in-handler check is the only gate.
    #[cfg(feature = "enterprise")]
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
    match openobserve_synthetics::service::move_synthetics(
        &org_id,
        &body.synthetic_ids,
        &body.dst_folder_id,
    )
    .await
    {
        Ok(_) => MetaHttpResponse::ok("checks moved"),
        Err(e) => {
            tracing::error!("[synthetics] move_synthetics: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
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
        ("id" = String, Path, description = "Check ID"),
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
    match openobserve_synthetics::service::set_synthetic_enabled(&org_id, &id, enabled).await {
        Ok(true) => MetaHttpResponse::ok(if enabled {
            "check enabled"
        } else {
            "check paused"
        }),
        Ok(false) => MetaHttpResponse::not_found("check not found"),
        Err(e) => {
            tracing::error!("[synthetics] set_synthetic_enabled: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
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
        ("id" = String, Path, description = "Check ID"),
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
    match openobserve_synthetics::service::run_synthetic_now(&org_id, &id).await {
        Ok(()) => (StatusCode::ACCEPTED, "").into_response(),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("not found") {
                return MetaHttpResponse::not_found(msg);
            }
            tracing::error!("[synthetics] run_synthetic_now: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg).into_response()
        }
    }
}

// ── Job API (probe-facing, bypass RBAC, authenticated via o2syn_ token) ──────

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/jobs/resolve",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsJobResolve",
    summary = "Resolve a job — probe fetches check config (authenticated via o2syn_ token)",
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
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
    if let Err(resp) = authorize_probe(&headers, &org_id).await {
        return resp;
    }
    let req = match serde_json::from_value::<openobserve_synthetics::job_api::ResolveRequest>(body)
    {
        Ok(r) => r,
        Err(e) => {
            return MetaHttpResponse::bad_request(e.to_string());
        }
    };
    match openobserve_synthetics::job_api::resolve(req, &org_id).await {
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
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg).into_response()
        }
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/synthetics/jobs/lease",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsJobLease",
    summary = "Lease a batch of jobs for a probe pool (authenticated via o2syn_ token)",
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
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
    path = "/{org_id}/synthetics/jobs/ack",
    context_path = "/api",
    tag = "Synthetics",
    operation_id = "SyntheticsJobAck",
    summary = "Acknowledge a completed check — probe submits result (authenticated via o2syn_ token)",
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
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
    use openobserve_synthetics::job_api::{AckBatchRequest, AckRequest};

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
        // Collected across the WHOLE batch and reported once: `report_usage`
        // spawns a task per call, and a batch is one probe's lease cycle.
        let mut usage = Vec::new();
        for ack in req.acks {
            let job_id = ack.job_id.clone();
            match process_ack(ack, &org_id).await {
                Ok(mut resp) => {
                    take_usage(&mut resp, &mut usage);
                    results.push(serde_json::json!({
                        "job_id": job_id,
                        "ok": true,
                        "run_complete": resp.run_complete,
                    }));
                }
                Err(e) => {
                    // No response, so no events: an ack that failed did not
                    // complete a job, and `ack_complete` is what authorises a
                    // bill (spec §4.1 step 3c).
                    tracing::error!(job_id = %job_id, "[synthetics] job_ack: {e}");
                    results.push(serde_json::json!({
                        "job_id": job_id,
                        "ok": false,
                        "error": e.to_string(),
                    }));
                }
            }
        }
        report_step_usage(usage);
        return MetaHttpResponse::json(serde_json::json!({ "results": results }));
    }

    let req = match serde_json::from_value::<AckRequest>(body) {
        Ok(r) => r,
        Err(e) => {
            return MetaHttpResponse::bad_request(e.to_string());
        }
    };
    match process_ack(req, &org_id).await {
        Ok(mut resp) => {
            // Same two steps as the batch arm, so neither path can drift from
            // the other and the source guard below can count both.
            let mut usage = Vec::new();
            take_usage(&mut resp, &mut usage);
            report_step_usage(usage);
            MetaHttpResponse::json(resp)
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.starts_with("forbidden") {
                return MetaHttpResponse::forbidden(msg);
            }
            tracing::error!("[synthetics] job_ack: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg).into_response()
        }
    }
}

/// Moves the usage rows one ack produced into a batch accumulator.
///
/// Trivial on purpose, and a named function rather than an inline `append` so
/// that both arms of `job_ack` go through the same two steps and a source guard
/// can count them. Dropping this call is the failure mode that matters: the
/// send below still happens, with an empty vector, and the ack still returns
/// 200 — silent lost revenue with nothing to alert on.
fn take_usage(
    resp: &mut openobserve_synthetics::job_api::AckResponse,
    into: &mut Vec<config::meta::self_reporting::usage::UsageData>,
) {
    into.append(&mut resp.usage_events);
}

/// Emits the synthetics step-billing usage rows an ack produced — SPEC §4.1
/// step 3g, item 1.10.
///
/// `job_api::ack` computes these rows and returns them as data, and this is
/// where they are sent. The split exists because `openobserve-synthetics` does
/// not depend on `usage_reporting` while this crate depends on both, and
/// because the alternative — a `OnceCell` callback installed from
/// `openobserve_synthetics::init()` — is SPEC §11 **F6** in a new disguise:
/// `init()` runs only under `if LOCAL_NODE.is_scheduler()`
/// (`src/jobs/src/job/mod.rs:1000`), while this handler serves the ack on API
/// nodes, where the cell would be unset and the emit would silently do nothing.
///
/// Fire-and-forget by design: `report_usage` spawns and returns, and a probe
/// that did its work is owed its 200 whether or not the usage queue accepted
/// the row.
///
/// Deliberately branchless. An earlier version skipped the send for an empty
/// vector — which it is on every non-cloud build and on every ack the guards in
/// `job_api::billing` dropped — but that branch is unreachable from a unit test
/// (the send spawns onto the global usage queue), so a mutation that turned it
/// into "never send" survived, on the revenue path, silently. A no-op spawn per
/// ack is cheaper than an untestable branch there, and this handler already
/// makes one unconditional usage-queue call per ack for trigger telemetry.
fn report_step_usage(usage: Vec<config::meta::self_reporting::usage::UsageData>) {
    record_step_usage_metrics(&usage);
    usage_reporting::report_usage(usage);
}

/// SPEC §9B.1 rows 1-5 — the Prometheus half of the step-billing signals.
///
/// ## Why this exists when the usage stream already has the numbers
///
/// §9B.1 sources four of its ten signals from the stream: `SUM(size) WHERE
/// event = ...`, per org, per hour. That stays their source of truth — it is
/// retained, queryable after the fact, and it is what the invoice is built
/// from. These counters are a SECOND copy of the same four numbers, taken here,
/// on a different path.
///
/// Two copies is the point. `report_usage` above spawns a task and returns
/// `()`, so §9B.1 row 8's *"emit failures"* has nothing to observe at this call
/// site — there is no `Result` to inspect, and inventing one would produce an
/// alert that can never fire. What CAN be counted honestly is what was handed
/// over. Compare it against the stream and the difference is the fire-and-forget
/// path losing rows:
///
/// ```text
///   counter above stream  ⇒  rows were computed and never landed
///   counter equals stream ⇒  the emit is whole
///   counter at zero       ⇒  nothing reached this function at all
/// ```
///
/// The last line is the one no other test or log covers: `take_usage` dropping
/// its rows, or this call being removed, leaves the ack returning 200 with
/// nothing metered.
///
/// ## What it does NOT catch
///
/// It cannot see anything that happens after the hand-off *inside* one process
/// and be believed on its own: a queue that rejects every row still leaves this
/// counter advancing. That failure is counted where it is actually observable —
/// `usage_reporting::publish_usage`, which does get a `Result` back —
/// as `zo_usage_enqueue_failures_total`. Nor does it see rows the guards in
/// `job_api::billing` correctly dropped, because those never become rows.
fn record_step_usage_metrics(usage: &[config::meta::self_reporting::usage::UsageData]) {
    use config::meta::self_reporting::usage::UsageEvent;

    for row in usage {
        // `size` is the count itself (§4.2: it is the only field `ingest_usages`
        // sums), and it is an `f64` on the wire while a Prometheus counter takes
        // a `u64`. Negative is not representable by anything upstream — every
        // producer is a `u32`/`u64` widened — so the floor is a guard against a
        // future one, not a case that fires today.
        let size = if row.size > 0.0 { row.size as u64 } else { 0 };
        match row.event {
            // Steps, all three of them, under one counter so §4.3's
            // `executed / defined` ratio is one PromQL division.
            UsageEvent::SyntheticsSteps
            | UsageEvent::SyntheticsFreeSteps
            | UsageEvent::_SyntheticsStepsDefined => {
                config::metrics::SYNTHETICS_STEPS_TOTAL
                    .with_label_values(&[row.org_id.as_str(), row.event.to_string().as_str()])
                    .inc_by(size);
            }
            // Milliseconds, so its own counter — see the metric's own note.
            UsageEvent::_SyntheticsBrowserMs => {
                config::metrics::SYNTHETICS_BROWSER_MS_TOTAL
                    .with_label_values(&[row.org_id.as_str()])
                    .inc_by(size);
            }
            // Everything else is another dimension's row travelling through the
            // shared usage type. A catch-all is right here — this function owns
            // four events, not the twenty-odd in the enum — but it does mean a
            // FIFTH synthetics event would be silently uncounted until it is
            // added above.
            _ => {}
        }
    }
}

/// The org's one-time free step grant, as it stands right now — SPEC §6.1,
/// item 2.3. Handed to `job_api::ack`, which decides §4.2's free/billable split
/// with it and reconciles §6.3 against it.
///
/// # Why the billing read is behind the pool read, and not the other way round
///
/// `NotApplicable` has to cover **ExternalContract** orgs (§7.3: *"notify, never
/// block, never pool-gate"*; §7.4 needs their acks billable so the NoOp provider
/// advances a step-denominated true-up), and the only way to know an org is one
/// is a `customer_billings` read. That read is not free and this runs on every
/// ack, so it is issued ONLY while the org still has grant left — which is the
/// window in which the answer can change anything. Once the grant is spent, and
/// for every established paying org, this costs one in-memory counter read.
#[cfg(feature = "cloud")]
async fn resolve_step_pool(org_id: &str) -> openobserve_synthetics::job_api::StepPoolView {
    // The §9A / §9D master switch. Off — the default — means no pool is
    // consulted anywhere, which is the Phase 1 state, and no counter is read.
    let billing_enabled = o2_enterprise::enterprise::common::config::get_config()
        .cloud
        .synthetics_billing_enabled;
    let remaining = if billing_enabled {
        openobserve_core::trial_quota::synthetics_steps_remaining(org_id)
    } else {
        0
    };
    // The one DB read, issued only while it can still change the answer.
    let is_contract = needs_plan_read(billing_enabled, remaining)
        && o2_enterprise::enterprise::cloud::ai_credits::resolve_ai_credit_exhaustion_policy(
            org_id,
        )
        .await
        .requires_additional_credits();
    step_pool_view(billing_enabled, remaining, is_contract)
}

/// Whether the org's PLAN still has to be read to answer [`step_pool_view`].
///
/// False once the answer cannot change: nothing is metered on this node, or the
/// grant is already spent and the ack is billable either way. That is what keeps
/// [`resolve_step_pool`] to one in-memory counter read for every org past its
/// evaluation budget, which is every established paying org.
#[cfg(any(test, feature = "cloud"))]
fn needs_plan_read(billing_enabled: bool, remaining: u64) -> bool {
    billing_enabled && remaining > 0
}

/// SPEC §6.1 / §7.3 — the whole free/billable decision for one ack, as pure
/// arithmetic over the three facts that decide it.
#[cfg(any(test, feature = "cloud"))]
fn step_pool_view(
    billing_enabled: bool,
    remaining: u64,
    is_contract: bool,
) -> openobserve_synthetics::job_api::StepPoolView {
    use openobserve_synthetics::job_api::StepPoolView;

    if !billing_enabled {
        return StepPoolView::NotApplicable;
    }
    if remaining == 0 {
        // §7.3, E16/T31 — the grant is gone. A plan that can be charged runs as
        // metered overage; a Free org never got here, because its slot was
        // skipped at the enqueue.
        return StepPoolView::Spent;
    }
    if is_contract {
        // §7.3, E18/T36 — *"never pool-gate"*. §7.4 needs the ack billable so
        // the NoOp provider advances a step-denominated true-up.
        return StepPoolView::NotApplicable;
    }
    StepPoolView::Funded
}

/// §8.1: a build without `cloud` has no pool, so every ack is `NotApplicable`.
#[cfg(not(feature = "cloud"))]
async fn resolve_step_pool(_org_id: &str) -> openobserve_synthetics::job_api::StepPoolView {
    openobserve_synthetics::job_api::StepPoolView::NotApplicable
}

/// Applies the free-pool movement one ack owes — SPEC §6.3, item 2.3.
///
/// Idempotent on `(synthetics_id, location, scheduled_ts, job_id)`, which
/// `job_api` built into `idempotency_key`. A refund is saturating and a top-up
/// is NEVER refused (E14): *"if a top-up would exhaust the pool mid-run,
/// complete the run and record it"* — enforcement belongs at the next enqueue.
#[cfg(feature = "cloud")]
fn apply_pool_adjustment(resp: &openobserve_synthetics::job_api::AckResponse) {
    let Some(adjustment) = resp.pool_adjustment.as_ref() else {
        return;
    };
    openobserve_core::trial_quota::synthetics_steps_adjust(
        &adjustment.org_id,
        core_movement(adjustment.movement),
        &adjustment.idempotency_key,
    );
}

/// Translate `openobserve-synthetics`'s movement into the pool's own.
///
/// Two crates that never see each other's types describe the same two
/// directions, and the compiler cannot check that this maps them the right way
/// round. Inverting it turns every refund into a second charge — the org loses
/// twice what the run cost, silently, against a grant it can never get back.
#[cfg(feature = "cloud")]
fn core_movement(
    movement: openobserve_synthetics::job_api::PoolMovement,
) -> openobserve_core::trial_quota::PoolAdjustment {
    use openobserve_synthetics::job_api::StepPoolDirection;

    match movement.direction {
        StepPoolDirection::Refund => {
            openobserve_core::trial_quota::PoolAdjustment::Refund(movement.steps)
        }
        StepPoolDirection::TopUp => {
            openobserve_core::trial_quota::PoolAdjustment::TopUp(movement.steps)
        }
    }
}

/// §8.1: no pool on this build, so nothing to apply.
#[cfg(not(feature = "cloud"))]
fn apply_pool_adjustment(resp: &openobserve_synthetics::job_api::AckResponse) {
    let _ = resp;
}

/// Runs one job ack through the enterprise service plus the per-ack side
/// effects (telemetry, run-complete notification). Shared by the single and
/// batch forms of `job_ack`.
async fn process_ack(
    req: openobserve_synthetics::job_api::AckRequest,
    token_org: &str,
) -> anyhow::Result<openobserve_synthetics::job_api::AckResponse> {
    let status = req.status.clone();
    let response_time_ms = req.response_time_ms;
    let error = req.error.clone();
    let checked_at = config::utils::time::now_micros();

    let resp =
        openobserve_synthetics::job_api::ack(req, token_org, resolve_step_pool(token_org).await)
            .await?;

    // SPEC §4.1 step 3h / §6.3, item 2.3 — the free-pool reconcile.
    //
    // `ack` computes it and returns it as data for exactly the reason
    // `report_step_usage` explains for the usage rows: the pool is
    // `openobserve_core::trial_quota`, `openobserve-synthetics` has no edge to
    // it, and this crate depends on both.
    apply_pool_adjustment(&resp);

    // Emit trigger usage record for synthetics telemetry.
    usage_reporting::publish_triggers_usage(config::meta::self_reporting::usage::TriggerData {
        _timestamp: checked_at,
        org: resp.org_id.clone(),
        module: config::meta::self_reporting::usage::TriggerDataType::Synthetics,
        key: format!("{}/{}", resp.synthetics_name, resp.synthetics_id),
        start_time: checked_at,
        end_time: checked_at,
        status: config::meta::self_reporting::usage::RunOutcome::Succeeded,
        success_response: Some(status.clone()),
        error: error.clone(),
        evaluation_took_in_secs: Some(response_time_ms / 1000.0),
        ..Default::default()
    });

    // Notify once per run, not once per job ack — and only when the check's own
    // `alert_if_fails` / `cooldown_mins` settings say so. This used to fire on
    // every completed run that had a destination, which is why `alert_if_fails:
    // 3` alerted on the first failure and a 30-minute cooldown sent thirty
    // notifications.
    #[cfg(feature = "enterprise")]
    use openobserve_synthetics::job_api::AlertDecision;
    #[cfg(feature = "enterprise")]
    let recovery = matches!(resp.alert, AlertDecision::Recovered);
    #[cfg(feature = "enterprise")]
    let flaky = matches!(resp.alert, AlertDecision::Flaky);
    // A degrading target is `warning` on every run for as long as the condition
    // lasts, so this one is throttled by transition upstream, not by cooldown.
    #[cfg(feature = "enterprise")]
    let degraded = matches!(resp.alert, AlertDecision::Degraded);
    #[cfg(feature = "enterprise")]
    let should_notify = !matches!(resp.alert, AlertDecision::Silent);
    // Enterprise-gated because alert *destinations* are: the dispatch it ends in
    // (`alerts::alert::dispatch_notification`) is not built in OSS. An OSS build
    // runs the check, records the run and serves the result — it just has
    // nowhere to send a notification, exactly as it has for alerts.
    #[cfg(feature = "enterprise")]
    if should_notify && !resp.destinations.is_empty() {
        let notification = openobserve_core::synthetics::CheckNotification {
            org_id: resp.org_id.clone(),
            check_name: resp.synthetics_name.clone(),
            check_id: resp.synthetics_id.clone(),
            check_type: resp.synthetic_type.clone(),
            target: resp.target.clone(),
            destinations: resp.destinations.clone(),
            run_id: resp.run_id.clone(),
            status: resp.run_status.clone().unwrap_or_else(|| status.clone()),
            job_count: resp.job_count as i64,
            error: error.clone(),
            checked_at,
            recovery,
            consecutive_failures: resp.consecutive_failures,
            flaky,
            degraded,
            status_reason: resp.status_reason.clone(),
            failing_locations: resp.failing_locations.clone(),
            passing_locations: resp.passing_locations.clone(),
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
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    use openobserve_synthetics::service::{CreateLocationRequest, create_location};

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
    match openobserve_synthetics::service::list_agent_tokens(&org_id).await {
        Ok(tokens) => MetaHttpResponse::json(serde_json::json!({ "tokens": tokens })),
        Err(e) => {
            tracing::error!("[synthetics] list_agent_tokens: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
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
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<CreateAgentTokenRequest>,
) -> Response {
    match openobserve_synthetics::service::create_agent_token(
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
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg).into_response()
        }
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
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<RotateAgentTokenRequest>,
) -> Response {
    match openobserve_synthetics::service::rotate_agent_token(
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
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg).into_response()
        }
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
    match openobserve_synthetics::service::set_agent_token_enabled(&org_id, &name, body.enabled)
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
    match openobserve_synthetics::service::location_detail(&org_id, &id).await {
        Ok(detail) => MetaHttpResponse::json(detail),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("not found") {
                return MetaHttpResponse::not_found(msg);
            }
            tracing::error!("[synthetics] get_location: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg).into_response()
        }
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
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let is_root = db::user::is_root_user(&user_email.user_id);
    let req = match serde_json::from_value::<openobserve_synthetics::service::UpdateLocationRequest>(
        body,
    ) {
        Ok(r) => r,
        Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
    };
    match openobserve_synthetics::service::update_location(&org_id, is_root, &id, req).await {
        Ok(loc) => MetaHttpResponse::json(loc),
        Err(e) => location_error_response(e),
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
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let is_root = db::user::is_root_user(&user_email.user_id);
    match openobserve_synthetics::service::delete_location(&org_id, is_root, &id).await {
        Ok(()) => MetaHttpResponse::json(serde_json::json!({"deleted": true})),
        Err(e) => location_error_response(e),
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
    match openobserve_synthetics::service::list_locations_for_org(&_org_id).await {
        Ok(capabilities) => MetaHttpResponse::json(capabilities),
        Err(e) => {
            tracing::error!("[synthetics] list_locations: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::self_reporting::usage::{UsageData, UsageEvent};
    use openobserve_synthetics::job_api::{AckResponse, AlertDecision};

    use super::take_usage;

    fn ack_response(usage_events: Vec<UsageData>) -> AckResponse {
        AckResponse {
            run_complete: false,
            run_status: None,
            job_count: 1,
            org_id: "acme".to_string(),
            job_id: "job_1".to_string(),
            run_id: "run_1".to_string(),
            synthetics_id: "chk_1".to_string(),
            synthetics_name: "checkout".to_string(),
            synthetic_type: "browser".to_string(),
            target: "https://example.com".to_string(),
            destinations: Vec::new(),
            location: "us-east-1".to_string(),
            pool: "aws-browser".to_string(),
            trigger_type: "scheduled".to_string(),
            alert: AlertDecision::Silent,
            status_reason: None,
            consecutive_failures: 0,
            failing_locations: Vec::new(),
            passing_locations: Vec::new(),
            usage_events,
            pool_adjustment: None,
        }
    }

    fn steps(size: f64) -> UsageData {
        UsageData {
            event: UsageEvent::SyntheticsSteps,
            size,
            ..UsageData::init_for_reflection()
        }
    }

    /// SPEC §4.1 step 3g. A batch is one probe's lease cycle, and every ack in
    /// it that billed must be reported — in order, and in ONE send, because
    /// `report_usage` spawns a task per call.
    ///
    /// An ack that ERRORED contributes nothing: it produced no `AckResponse`,
    /// and `ack_complete` is what authorises a bill (§4.1 step 3c). This mirrors
    /// the accumulation in the batch arm of `job_ack`, which cannot be called
    /// here without an HTTP request and a database.
    #[test]
    fn a_batch_reports_the_usage_of_every_ack_in_it() {
        let batch: Vec<anyhow::Result<AckResponse>> = vec![
            Ok(ack_response(vec![steps(14.0), steps(14.0)])),
            Err(anyhow::anyhow!("job not found")),
            // A private-venue or duplicate ack: succeeded, billed nothing.
            Ok(ack_response(Vec::new())),
            Ok(ack_response(vec![steps(28.0)])),
        ];

        // Reached through a function pointer so this call does not count
        // towards the source guard below, which counts calls by name.
        let drain: fn(&mut AckResponse, &mut Vec<UsageData>) = take_usage;
        let mut usage = Vec::new();
        // `.flatten()` drops the errored ack, which is exactly the handler's
        // behaviour: an ack that errored produced no `AckResponse` and so has
        // no events to take.
        for mut resp in batch.into_iter().flatten() {
            drain(&mut resp, &mut usage);
        }

        assert_eq!(
            usage.iter().map(|u| u.size).collect::<Vec<_>>(),
            vec![14.0, 14.0, 28.0],
            "every billed ack in the batch, in order, and nothing from the errored one"
        );
    }

    /// Every path out of the ack handler must report the usage it produced.
    ///
    /// `report_usage` is fire-and-forget, so an unreported vector is silent lost
    /// revenue — §9B alert A4's "emit failures", except that a dropped vector
    /// never even reaches the counter. There are exactly two paths today, the
    /// single ack and the batch, and this pins that a third cannot be added
    /// without one.
    ///
    /// The needles are assembled rather than written out, so that this test's
    /// own source does not count towards the totals it asserts — the same
    /// device `openobserve-synthetics`'s `nothing_on_the_run_path_publishes`
    /// uses.
    #[test]
    fn every_ack_path_reports_the_usage_it_produced() {
        let source = include_str!("mod.rs");
        // One definition plus one call per path, for each of the three steps an
        // ack path must take: run the ack, take its usage rows, send them.
        for (needle, what) in [
            (["process", "_ack("].concat(), "runs an ack"),
            (
                ["take", "_usage("].concat(),
                "takes the usage rows it returned",
            ),
            (["report_step", "_usage("].concat(), "sends them"),
        ] {
            assert_eq!(
                source.matches(&needle).count(),
                3,
                "one definition and exactly two call sites are expected for the step that \
                 {what}; an ack path is missing it, or a third path was added"
            );
        }

        // And the send itself. `report_step_usage` is the one line in this file
        // that a unit test cannot reach — it hands off to the global usage
        // queue — so it is pinned here instead. Without this, emptying that
        // function's body is a silent "never meter anything".
        assert_eq!(
            source
                .matches(&["usage_reporting::report", "_usage("].concat())
                .count(),
            1,
            "the hand-off to the usage queue is gone; nothing is metered"
        );
    }

    // ── SPEC §9B.1 rows 1-5 — the emit-side counters ────────────────────────
    //
    // Deterministic without a mutex, unlike the two guard counters in
    // `openobserve-synthetics`: these are labelled per org, so each test reads
    // back only the label values it wrote and no other test can touch them.

    /// The four counts one ack can carry, read back from the labelled
    /// counters. `None` where the label value does not exist yet.
    fn recorded(org: &str) -> (u64, u64, u64, u64) {
        let steps = |event: &str| {
            config::metrics::SYNTHETICS_STEPS_TOTAL
                .with_label_values(&[org, event])
                .get()
        };
        (
            steps("SyntheticsSteps"),
            steps("SyntheticsFreeSteps"),
            steps("_SyntheticsStepsDefined"),
            config::metrics::SYNTHETICS_BROWSER_MS_TOTAL
                .with_label_values(&[org])
                .get(),
        )
    }

    /// Reached through a function pointer so these calls do not count towards
    /// `the_emit_hand_off_counts_what_it_sends`, which counts call sites by
    /// name — the same device `a_batch_reports_the_usage_of_every_ack_in_it`
    /// uses for `take_usage`.
    fn record(usage: &[UsageData]) {
        let record_metrics: fn(&[UsageData]) = super::record_step_usage_metrics;
        record_metrics(usage);
    }

    fn usage_row(org: &str, event: UsageEvent, size: f64) -> UsageData {
        UsageData {
            org_id: org.to_string(),
            event,
            size,
            ..UsageData::init_for_reflection()
        }
    }

    /// **§9B.1 rows 1, 2, 3 and 5.** Every count lands under its own label, and
    /// under the right one.
    ///
    /// The three sizes are deliberately all different. §4.3 calls `executed /
    /// defined` *"the single most useful number"*, and the way to get it wrong
    /// is to record the ratio upside down — which two equal numbers would hide
    /// completely. 4 billed against 14 defined is §9C's **T4**: a journey that
    /// failed at step 4 of 14. Inverted, that org reads as 3.5x retries firing
    /// instead of a check failing three quarters of the way through, and A1
    /// alerts on the drift in the wrong direction.
    #[test]
    fn the_emit_counters_record_each_count_under_its_own_label() {
        let org = "o9b1-billable";
        let before = recorded(org);

        record(&[
            usage_row(org, UsageEvent::SyntheticsSteps, 4.0),
            usage_row(org, UsageEvent::_SyntheticsStepsDefined, 14.0),
            usage_row(org, UsageEvent::_SyntheticsBrowserMs, 9_100.0),
        ]);

        let after = recorded(org);
        assert_eq!(after.0 - before.0, 4, "billed steps");
        assert_eq!(after.1 - before.1, 0, "nothing came out of the free pool");
        assert_eq!(after.2 - before.2, 14, "defined steps");
        assert_eq!(after.3 - before.3, 9_100, "browser milliseconds");
    }

    /// **§9B.1 row 4.** Free-pool consumption is its own label value, not a
    /// second name for the billable one.
    ///
    /// §4.2 emits exactly one of `SyntheticsSteps` / `SyntheticsFreeSteps` per
    /// ack, and they answer opposite questions: one is the invoice line, the
    /// other is §6.1's grant burning down. Folding them together would show a
    /// free org generating revenue.
    #[test]
    fn free_pool_consumption_is_counted_apart_from_billable_steps() {
        let org = "o9b1-free";
        let before = recorded(org);

        record(&[
            usage_row(org, UsageEvent::SyntheticsFreeSteps, 28.0),
            usage_row(org, UsageEvent::_SyntheticsStepsDefined, 28.0),
        ]);

        let after = recorded(org);
        assert_eq!(after.0 - before.0, 0, "a free ack is not billable steps");
        assert_eq!(after.1 - before.1, 28);
        assert_eq!(after.2 - before.2, 28);
    }

    /// Milliseconds and steps are different units, so `browser_ms` must never
    /// reach the step counter. Summing a counter across its label values is the
    /// first thing any dashboard does, and a family that mixes units produces a
    /// number that means nothing — and here it would mean "this org executed
    /// nine thousand steps".
    #[test]
    fn browser_milliseconds_never_reach_the_step_counter() {
        let org = "o9b1-units";
        let before = recorded(org);

        record(&[usage_row(org, UsageEvent::_SyntheticsBrowserMs, 9_100.0)]);

        let after = recorded(org);
        assert_eq!((after.0, after.1, after.2), (before.0, before.1, before.2));
        // …and not under a `_SyntheticsBrowserMs` label value of the step
        // counter either, which `recorded` does not read and a dashboard
        // summing the family would.
        assert_eq!(
            config::metrics::SYNTHETICS_STEPS_TOTAL
                .with_label_values(&[org, "_SyntheticsBrowserMs"])
                .get(),
            0,
        );
        assert_eq!(after.3 - before.3, 9_100);
    }

    /// An ack carries only synthetics rows today, but the same handler already
    /// makes an unconditional trigger-telemetry call, and `report_usage` is
    /// shared with every other billed dimension. A row that is not one of §4.2's
    /// four must contribute nothing rather than open a label value named after
    /// it.
    ///
    /// The foreign event's OWN label value is asserted, not just the four
    /// synthetics ones. Reading only the four is how this test first passed
    /// against a mutant that dropped the `match` entirely and counted every row
    /// under `event = "<whatever it was>"`: the bogus series existed, it was
    /// simply not one this test looked at. `zo_synthetics_steps_total` summed
    /// across its label values is what a dashboard shows, so a series nobody
    /// asserts on is still on the chart.
    #[test]
    fn a_non_synthetics_row_is_not_counted_as_steps() {
        let org = "o9b1-foreign";
        let before = recorded(org);
        let foreign = |event: UsageEvent| {
            config::metrics::SYNTHETICS_STEPS_TOTAL
                .with_label_values(&[org, event.to_string().as_str()])
                .get()
        };

        record(&[
            usage_row(org, UsageEvent::Ingestion, 1_000.0),
            usage_row(org, UsageEvent::AiCredits, 5.0),
        ]);

        assert_eq!(
            recorded(org),
            before,
            "none of the four synthetics counts moved"
        );
        for event in [UsageEvent::Ingestion, UsageEvent::AiCredits] {
            assert_eq!(
                foreign(event),
                0,
                "{event} opened a label value on the synthetics step counter",
            );
        }
    }

    /// Counting is per org — A1 asks *"has THIS org's ratio drifted from its own
    /// trailing baseline"*, which an aggregate cannot answer.
    #[test]
    fn each_org_is_counted_separately() {
        let (a, b) = ("o9b1-org-a", "o9b1-org-b");
        let (before_a, before_b) = (recorded(a), recorded(b));

        record(&[
            usage_row(a, UsageEvent::SyntheticsSteps, 3.0),
            usage_row(b, UsageEvent::SyntheticsSteps, 7.0),
        ]);

        assert_eq!(recorded(a).0 - before_a.0, 3);
        assert_eq!(recorded(b).0 - before_b.0, 7);
    }

    /// The emit hand-off must count what it sends — SPEC §9B.1 row 8, and the
    /// reason there are two copies of the same number at all.
    ///
    /// `report_step_usage` cannot be called from a unit test: it hands off to
    /// the global usage queue. So this pins, in source, that the counting call
    /// is still there and still unconditional. Deleting it does not fail
    /// anything else — the ack still returns 200, the rows are still sent, and
    /// the Prometheus side simply reads zero, which is indistinguishable from
    /// "this deployment bills nothing".
    ///
    /// It also pins that `report_step_usage` stays BRANCHLESS. An earlier
    /// version skipped the send for an empty vector; that branch was
    /// unreachable from a unit test, so a mutation turning it into "never send"
    /// survived on the revenue path. A `if usage.is_empty() { return; }` in
    /// front of the counter would reintroduce exactly that.
    #[test]
    fn the_emit_hand_off_counts_what_it_sends() {
        let source = include_str!("mod.rs");
        assert_eq!(
            source
                .matches(&["record_step_usage", "_metrics("].concat())
                .count(),
            2,
            "one definition and exactly one call site are expected for the §9B.1 emit counter",
        );

        let body = source
            .split_once(&["fn report_step", "_usage("].concat())
            .expect("the emit hand-off")
            .1;
        let end = body.find("\n}\n").expect("end of report_step_usage");
        let body = &body[..end];
        assert!(
            body.contains(&["record_step_usage", "_metrics(&usage)"].concat()),
            "the emit counter is no longer called from the hand-off",
        );
        for branch in ["if ", "return", "match "] {
            assert!(
                !body.contains(branch),
                "`report_step_usage` must stay branchless — a `{branch}` here is the \
                 unreachable-branch mutation that already survived once on this path",
            );
        }
    }

    /// SPEC §6.1 / §7.3 — every state of the org's grant maps to exactly one
    /// answer, and the wrong answer is invisible: `Funded` where the grant is
    /// gone is free service, `Spent`/`NotApplicable` where it is not is a grant
    /// that never burns down and an invoice for work §6.1 gave away.
    #[cfg(feature = "cloud")]
    #[test]
    fn the_step_pool_view_is_spec_6_1_and_7_3() {
        use openobserve_synthetics::job_api::StepPoolView;

        use super::step_pool_view;

        // §9A/§9D master switch off — the Phase 1 state. Nothing is consulted,
        // so nothing is free and nothing is reconciled.
        assert_eq!(
            step_pool_view(false, 10_000, false),
            StepPoolView::NotApplicable,
        );
        assert_eq!(step_pool_view(false, 0, true), StepPoolView::NotApplicable);

        // The grant still has room.
        assert_eq!(step_pool_view(true, 1, false), StepPoolView::Funded);
        assert_eq!(step_pool_view(true, 10_000, false), StepPoolView::Funded);

        // Spent ⇒ metered overage (E16/T31).
        assert_eq!(step_pool_view(true, 0, false), StepPoolView::Spent);

        // A contract org is never pool-gated (E18/T36), so it never reads as
        // funded even with a grant sitting there untouched.
        assert_eq!(
            step_pool_view(true, 10_000, true),
            StepPoolView::NotApplicable,
        );
    }

    /// The plan read is one `customer_billings` query and this runs on EVERY
    /// ack, so it is issued only while its answer can still change anything.
    #[cfg(feature = "cloud")]
    #[test]
    fn the_plan_is_read_only_while_the_grant_can_still_fund_an_ack() {
        use super::needs_plan_read;

        assert!(needs_plan_read(true, 1));
        assert!(
            !needs_plan_read(true, 0),
            "a spent grant is billable whatever the plan says",
        );
        assert!(
            !needs_plan_read(false, 10_000),
            "nothing is metered on this node",
        );
    }

    /// The two crates describe the same two directions and no compiler checks
    /// that this maps them the right way round. Inverted, every refund becomes a
    /// second charge against a grant the org can never get back.
    #[cfg(feature = "cloud")]
    #[test]
    fn a_refund_stays_a_refund_across_the_crate_boundary() {
        use openobserve_synthetics::job_api::{PoolMovement, StepPoolDirection};

        use super::core_movement;

        assert_eq!(
            core_movement(PoolMovement {
                direction: StepPoolDirection::Refund,
                steps: 10,
            }),
            openobserve_core::trial_quota::PoolAdjustment::Refund(10),
        );
        assert_eq!(
            core_movement(PoolMovement {
                direction: StepPoolDirection::TopUp,
                steps: 4,
            }),
            openobserve_core::trial_quota::PoolAdjustment::TopUp(4),
        );
    }

    /// The same guarantee for the OTHER half of an ack — SPEC §4.1 step 3h,
    /// §6.3, item 2.3.
    ///
    /// `job_api::ack` computes the free-pool movement and returns it; if this
    /// crate never applies it, every reconcile is silently dropped. Under a
    /// ONE-TIME grant (§6.1) a dropped refund is a step the org never gets back
    /// and a dropped top-up is a step it never pays for — and neither produces
    /// an error, a log or a failing test anywhere else, because the ack still
    /// returns 200 and the usage row is still written.
    ///
    /// Two of the three steps below are unreachable from a unit test (they read
    /// process-global config and the process-global pool), which is exactly why
    /// they are pinned here.
    #[test]
    fn every_ack_path_applies_the_pool_reconcile_it_computed() {
        let source = include_str!("mod.rs");
        // Two `cfg`-split definitions plus one call, for each half.
        for (needle, what) in [
            (
                ["resolve_step", "_pool("].concat(),
                "resolves the org's grant before the ack",
            ),
            (
                ["apply_pool", "_adjustment("].concat(),
                "applies the movement the ack returned",
            ),
        ] {
            assert_eq!(
                source.matches(&needle).count(),
                3,
                "one `cloud` definition, one non-`cloud` definition and exactly one call site                  are expected for the step that {what}"
            );
        }

        // The hand-off to the pool itself. Emptying this function's body is a
        // silent "never reconcile anything".
        assert_eq!(
            source
                .matches(&["trial_quota::synthetics_steps", "_adjust("].concat())
                .count(),
            1,
            "the hand-off to the free step pool is gone; no reconcile is ever applied"
        );
    }
}
