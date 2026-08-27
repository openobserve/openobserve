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
        // One send for the WHOLE batch: `report_usage` spawns a task per call.
        let mut usage = Vec::new();
        for ack in req.acks {
            let job_id = ack.job_id.clone();
            match process_ack(ack, &org_id).await {
                Ok(mut resp) => {
                    usage.append(&mut resp.usage_events);
                    results.push(serde_json::json!({
                        "job_id": job_id,
                        "ok": true,
                        "run_complete": resp.run_complete,
                    }));
                }
                Err(e) => {
                    // No response, so no events: `ack_complete` is what
                    // authorises a bill (spec §4.1 step 3c).
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
            report_step_usage(std::mem::take(&mut resp.usage_events));
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

/// Emits the synthetics step-billing usage rows an ack produced — SPEC §4.1
/// step 3g.
///
/// Deliberately NOT a `OnceCell` callback from `openobserve_synthetics::init()`:
/// `init()` runs only under `if LOCAL_NODE.is_scheduler()` while acks are served
/// on API nodes, so the cell would be unset and the emit silently do nothing (F6).
///
/// Fail-open: `report_usage` spawns and returns, and a probe that did its work
/// is owed its 200 whether or not the usage queue accepted the row.
///
/// Deliberately branchless — an empty-vector early return is unreachable from a
/// unit test, so a mutation turning it into "never send" survived once here.
fn report_step_usage(usage: Vec<config::meta::self_reporting::usage::UsageData>) {
    record_step_usage_metrics(&usage);
    usage_reporting::report_usage(usage);
}

/// SPEC §9B.1 rows 1-5 — the Prometheus half of the step-billing signals.
///
/// A deliberate SECOND copy of four numbers the usage stream already carries
/// (the stream stays the invoice's source of truth). `report_usage` returns
/// `()`, so comparing this counter against the stream is the only thing that
/// detects the fire-and-forget path losing rows; a counter at zero means nothing
/// reached this function at all.
///
/// It cannot see failures AFTER the hand-off — a queue rejecting every row still
/// advances it. Those are `zo_usage_enqueue_failures_total`, counted in
/// `usage_reporting::publish_usage`, which does get a `Result` back.
fn record_step_usage_metrics(usage: &[config::meta::self_reporting::usage::UsageData]) {
    use config::meta::self_reporting::usage::UsageEvent;

    for row in usage {
        // `size` is the count itself (§4.2), `f64` on the wire against a `u64`
        // counter. Every producer today is a widened `u32`/`u64`, so the floor
        // guards a future negative one, not a case that fires now.
        let size = if row.size > 0.0 { row.size as u64 } else { 0 };
        match row.event {
            // All three step events share a counter: §4.3's `executed / defined`
            // ratio is then one PromQL division.
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
            // Other dimensions' rows travel through the shared usage type. The
            // catch-all does mean a FIFTH synthetics event would be silently
            // uncounted until added above.
            _ => {}
        }
    }
}

/// The org's one-time free step grant as it stands right now — SPEC §6.1, item
/// 2.3. Handed to `job_api::ack`, which decides §4.2's free/billable split.
///
/// Ordering matters: the `customer_billings` read (the only way to spot an
/// ExternalContract org, which §7.3 says to never pool-gate) is issued ONLY while
/// the org still has grant left, so past that a request costs one counter read.
#[cfg(feature = "cloud")]
async fn resolve_step_pool(org_id: &str) -> openobserve_synthetics::job_api::StepPoolView {
    let remaining = openobserve_core::trial_quota::synthetics_steps_remaining(org_id);
    // `remaining > 0` first: a spent grant is billable whatever the plan says.
    let is_contract = remaining > 0
        && o2_enterprise::enterprise::cloud::ai_credits::resolve_ai_credit_exhaustion_policy(
            org_id,
        )
        .await
        .requires_additional_credits();
    step_pool_view(remaining, is_contract)
}

/// SPEC §6.1 / §7.3 — the free/billable decision for one ack, as arithmetic.
#[cfg(feature = "cloud")]
fn step_pool_view(
    remaining: u64,
    is_contract: bool,
) -> openobserve_synthetics::job_api::StepPoolView {
    use openobserve_synthetics::job_api::StepPoolView;

    if remaining == 0 {
        // §7.3, E16/T31 — grant gone, so metered overage. A Free org never got
        // here; its slot was skipped at the enqueue.
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
/// `job_api` built into `idempotency_key`. A refund saturates and a top-up is
/// NEVER refused (E14) — enforcement belongs at the next enqueue.
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

/// Translate `openobserve-synthetics`'s movement into the pool's own. No
/// compiler checks that this maps the two directions the right way round;
/// inverted, every refund becomes a second charge against a one-time grant the
/// org can never get back.
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

/// Runs one job ack through the enterprise service plus the per-ack side effects
/// (telemetry, run-complete notification). Shared by both forms of `job_ack`.
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

    // SPEC §4.1 step 3h / §6.3, item 2.3 — the free-pool reconcile. Returned as
    // data for the reason `report_step_usage` gives for the usage rows.
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

    /// SPEC §4.1 step 3g. A batch is one probe's lease cycle: every ack in it
    /// that billed must be reported, in order, in ONE send. An ack that ERRORED
    /// contributes nothing — it produced no `AckResponse`, and `ack_complete` is
    /// what authorises a bill (§4.1 step 3c).
    #[test]
    fn a_batch_reports_the_usage_of_every_ack_in_it() {
        let batch: Vec<anyhow::Result<AckResponse>> = vec![
            Ok(ack_response(vec![steps(14.0), steps(14.0)])),
            Err(anyhow::anyhow!("job not found")),
            // A private-venue or duplicate ack: succeeded, billed nothing.
            Ok(ack_response(Vec::new())),
            Ok(ack_response(vec![steps(28.0)])),
        ];

        let mut usage = Vec::new();
        for mut resp in batch.into_iter().flatten() {
            usage.append(&mut resp.usage_events);
        }

        assert_eq!(
            usage.iter().map(|u| u.size).collect::<Vec<_>>(),
            vec![14.0, 14.0, 28.0],
            "every billed ack in the batch, in order, and nothing from the errored one"
        );
    }

    /// Every path out of the ack handler must report the usage it produced;
    /// `report_usage` is fire-and-forget, so an unreported vector is silent lost
    /// revenue that never even reaches the counter. Two paths exist today; this
    /// pins that a third cannot be added without one. The needles are assembled
    /// so this test's own source does not count towards its totals.
    #[test]
    fn every_ack_path_reports_the_usage_it_produced() {
        let source = include_str!("mod.rs");
        // One definition plus one call per path: run the ack, send its usage rows.
        for (needle, what) in [
            (["process", "_ack("].concat(), "runs an ack"),
            (["report_step", "_usage("].concat(), "sends its usage rows"),
        ] {
            assert_eq!(
                source.matches(&needle).count(),
                3,
                "one definition and exactly two call sites are expected for the step that \
                 {what}; an ack path is missing it, or a third path was added"
            );
        }

        // And the send itself, the one line here a unit test cannot reach:
        // emptying that body is a silent "never meter anything".
        assert_eq!(
            source
                .matches(&["usage_reporting::report", "_usage("].concat())
                .count(),
            1,
            "the hand-off to the usage queue is gone; nothing is metered"
        );
    }

    // SPEC §9B.1 rows 1-5. Deterministic without a mutex: these counters are
    // labelled per org, so each test reads back only the label values it wrote.

    /// The four counts one ack can carry, read back from the labelled counters.
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
    /// `the_emit_hand_off_counts_what_it_sends`, which counts call sites by name.
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
    /// The three sizes differ deliberately: §4.3's `executed / defined` recorded
    /// upside down is what two equal numbers would hide.
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

    /// **§9B.1 row 4.** §4.2 emits exactly one of `SyntheticsSteps` /
    /// `SyntheticsFreeSteps` per ack and they answer opposite questions — the
    /// invoice line versus §6.1's grant burning down. Folded together, a free
    /// org would show as generating revenue.
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
    /// reach the step counter: dashboards sum a counter across its label values,
    /// and here that would read as "this org executed nine thousand steps".
    #[test]
    fn browser_milliseconds_never_reach_the_step_counter() {
        let org = "o9b1-units";
        let before = recorded(org);

        record(&[usage_row(org, UsageEvent::_SyntheticsBrowserMs, 9_100.0)]);

        let after = recorded(org);
        assert_eq!((after.0, after.1, after.2), (before.0, before.1, before.2));
        // …nor under a `_SyntheticsBrowserMs` label value of the step counter,
        // which `recorded` does not read but a dashboard summing the family does.
        assert_eq!(
            config::metrics::SYNTHETICS_STEPS_TOTAL
                .with_label_values(&[org, "_SyntheticsBrowserMs"])
                .get(),
            0,
        );
        assert_eq!(after.3 - before.3, 9_100);
    }

    /// `report_usage` is shared with every other billed dimension, so a row that
    /// is not one of §4.2's four must contribute nothing rather than open a label
    /// value named after it. The foreign event's OWN label value is asserted, not
    /// just the four: reading only the four let a mutant that dropped the `match`
    /// pass, counting every row under its own event name.
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

    /// Counting is per org — A1 asks about THIS org's drift from its own
    /// trailing baseline, which an aggregate cannot answer.
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

    /// SPEC §9B.1 row 8. The hand-off cannot be called from a unit test, so this
    /// pins in source that the counting call is still there and unconditional —
    /// deleting it fails nothing else, the Prometheus side just reads zero.
    ///
    /// It also pins that the hand-off stays BRANCHLESS: an empty-vector early
    /// return is unreachable from a test, and that mutation survived once.
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

    /// SPEC §6.1 / §7.3 — every grant state maps to exactly one answer, and the
    /// wrong answer is invisible: `Funded` with the grant gone is free service;
    /// `Spent`/`NotApplicable` with grant left invoices work §6.1 gave away.
    #[cfg(feature = "cloud")]
    #[test]
    fn the_step_pool_view_is_spec_6_1_and_7_3() {
        use openobserve_synthetics::job_api::StepPoolView;

        use super::step_pool_view;

        // The grant still has room.
        assert_eq!(step_pool_view(1, false), StepPoolView::Funded);
        assert_eq!(step_pool_view(10_000, false), StepPoolView::Funded);

        // Spent ⇒ metered overage (E16/T31).
        assert_eq!(step_pool_view(0, false), StepPoolView::Spent);

        // A contract org with grant left is never pool-gated (E18/T36). It cannot
        // be asked about a SPENT grant: `resolve_step_pool` short-circuits at
        // `remaining == 0`, so `is_contract` is never computed there.
        assert_eq!(step_pool_view(10_000, true), StepPoolView::NotApplicable);
    }

    /// No compiler checks that the two crates' directions map the right way
    /// round; inverted, every refund becomes a second charge.
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

    /// The same guarantee for the OTHER half of an ack — SPEC §4.1 step 3h, §6.3.
    ///
    /// Under a ONE-TIME grant (§6.1) a dropped refund is a step the org never gets
    /// back and a dropped top-up one it never pays for, silently: the ack still
    /// returns 200 and the usage row is still written.
    #[test]
    fn every_ack_path_applies_the_pool_reconcile_it_computed() {
        let source = include_str!("mod.rs");
        // Two `cfg`-split definitions plus one call, for each half.
        assert_eq!(
            source.matches(&["resolve_step", "_pool("].concat()).count(),
            3,
            "one `cloud` definition, one non-`cloud` definition and exactly one call site are \
             expected for the step that resolves the org's grant"
        );
        assert_eq!(
            source
                .matches(&["apply_pool", "_adjustment("].concat())
                .count(),
            3,
            "one `cloud` definition, one non-`cloud` definition and exactly one call site are \
             expected for the step that applies the movement the ack returned"
        );

        // The hand-off to the pool itself; emptying it never reconciles anything.
        assert_eq!(
            source
                .matches(&["trial_quota::synthetics_steps", "_adjust("].concat())
                .count(),
            1,
            "the hand-off to the free step pool is gone; no reconcile is ever applied"
        );
    }
}
