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

//! SLO CRUD (`alerts_2.md` §6b).
//!
//! SLOs live in **alert folders** and are authorized as `alerts`, following
//! the `anomaly_detection` precedent. An SLO is alerting configuration and the
//! alerts built on it are ordinary alert rows (D28), so a separate permission
//! surface would mean granting two things to accomplish one.

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::meta::slo::{Slo, SloStatusView};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{auth::UserEmail, slo::service as slo_service};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ListQuery {
    /// Restrict to one folder. Absent lists every folder in the org.
    pub folder: Option<String>,
}

/// An SLO plus its current measurement, which is what a list view needs.
#[derive(Debug, Serialize, ToSchema)]
pub struct SloListItem {
    #[serde(flatten)]
    pub slo: Slo,
    /// `None` until the first pass has measured anything. Deliberately not
    /// zeroed: "not yet measured" and "measured as zero" are different, and a
    /// UI that conflates them shows a brand-new SLO as 0% available.
    pub status: Option<SloStatusView>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SloListResponse {
    pub list: Vec<SloListItem>,
}

fn disabled() -> Option<Response> {
    if config::get_config().slo.enabled {
        return None;
    }
    Some(
        MetaHttpResponse::error(
            StatusCode::NOT_IMPLEMENTED.as_u16(),
            "SLOs are disabled. Set ZO_SLO_ENABLED=true to enable them.".to_string(),
        )
        .into_response(),
    )
}

/// List SLOs in an organization.
#[utoipa::path(
    get,
    path = "/{org_id}/slos",
    context_path = "/api",
    tag = "SLOs",
    operation_id = "ListSlos",
    summary = "List SLOs",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("folder" = Option<String>, Query, description = "Filter by folder ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SloListResponse),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id))]
pub async fn list_slos(Path(org_id): Path<String>, Query(q): Query<ListQuery>) -> Response {
    if let Some(r) = disabled() {
        return r;
    }
    match openobserve_core::slo::service::list_with_status(&org_id, q.folder.as_deref()).await {
        Ok(list) => MetaHttpResponse::json(SloListResponse {
            list: list
                .into_iter()
                .map(|(slo, status)| SloListItem { slo, status })
                .collect(),
        }),
        Err(e) => internal(e),
    }
}

/// Get one SLO with its current measurement.
#[utoipa::path(
    get,
    path = "/{org_id}/slos/{slo_id}",
    context_path = "/api",
    tag = "SLOs",
    operation_id = "GetSlo",
    summary = "Get an SLO",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("slo_id" = String, Path, description = "SLO identifier"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SloListItem),
        (status = 404, description = "Not Found", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, slo_id = %slo_id))]
pub async fn get_slo(Path((org_id, slo_id)): Path<(String, String)>) -> Response {
    if let Some(r) = disabled() {
        return r;
    }
    match openobserve_core::slo::service::get_with_status(&org_id, &slo_id).await {
        Ok(Some((slo, status))) => MetaHttpResponse::json(SloListItem { slo, status }),
        Ok(None) => not_found(),
        Err(e) => internal(e),
    }
}

/// Create an SLO.
#[utoipa::path(
    post,
    path = "/{org_id}/slos",
    context_path = "/api",
    tag = "SLOs",
    operation_id = "CreateSlo",
    summary = "Create an SLO",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization identifier")),
    request_body(content = Slo, description = "SLO definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Created", content_type = "application/json", body = MetaHttpResponse),
        (status = 400, description = "Bad Request", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id))]
pub async fn create_slo(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(mut slo): Json<Slo>,
) -> Response {
    if let Some(r) = disabled() {
        return r;
    }
    // The path segment is authoritative: it is what the permission check ran
    // against, so a body claiming a different org must not be honoured.
    slo.org = org_id;
    if slo.id.is_empty() {
        slo.id = config::ider::generate();
    }
    if slo.folder_id.is_empty() {
        slo.folder_id = config::meta::folder::DEFAULT_FOLDER.to_string();
    }
    if slo.owner.is_none() {
        slo.owner = Some(user_email.user_id.clone());
    }

    match slo_service::create(&mut slo).await {
        Ok(()) => MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "SLO saved")
                .with_id(slo.id.clone())
                .with_name(slo.name.clone()),
        ),
        Err(e) => save_error(e),
    }
}

/// Update an SLO.
#[utoipa::path(
    put,
    path = "/{org_id}/slos/{slo_id}",
    context_path = "/api",
    tag = "SLOs",
    operation_id = "UpdateSlo",
    summary = "Update an SLO",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("slo_id" = String, Path, description = "SLO identifier"),
    ),
    request_body(content = Slo, description = "SLO definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Updated", content_type = "application/json", body = MetaHttpResponse),
        (status = 400, description = "Bad Request", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, slo_id = %slo_id))]
pub async fn update_slo(
    Path((org_id, slo_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(mut slo): Json<Slo>,
) -> Response {
    if let Some(r) = disabled() {
        return r;
    }
    // Both taken from the path, for the same reason as create: they are what
    // the permission check ran against.
    slo.org = org_id;
    slo.id = slo_id;
    if slo.owner.is_none() {
        slo.owner = Some(user_email.user_id.clone());
    }

    match slo_service::update(&mut slo).await {
        Ok(()) => MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "SLO updated")
                .with_id(slo.id.clone())
                .with_name(slo.name.clone()),
        ),
        Err(openobserve_core::slo::service::SloError::NotFound) => not_found(),
        Err(e) => save_error(e),
    }
}

/// Delete an SLO.
#[utoipa::path(
    delete,
    path = "/{org_id}/slos/{slo_id}",
    context_path = "/api",
    tag = "SLOs",
    operation_id = "DeleteSlo",
    summary = "Delete an SLO",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("slo_id" = String, Path, description = "SLO identifier"),
    ),
    responses(
        (status = 200, description = "Deleted", content_type = "application/json", body = MetaHttpResponse),
        (status = 404, description = "Not Found", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, slo_id = %slo_id))]
pub async fn delete_slo(Path((org_id, slo_id)): Path<(String, String)>) -> Response {
    if let Some(r) = disabled() {
        return r;
    }
    match slo_service::delete(&org_id, &slo_id).await {
        Ok(true) => {
            MetaHttpResponse::json(MetaHttpResponse::message(StatusCode::OK, "SLO deleted"))
        }
        Ok(false) => not_found(),
        Err(e) => internal(anyhow::anyhow!(e.to_string())),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MoveSlosRequestBody {
    /// The SLOs to relocate.
    pub slo_ids: Vec<String>,
    /// Destination folder. An **alert** folder — SLOs share the alert folder
    /// namespace rather than having a type of their own.
    pub dst_folder_id: String,
}

/// Move SLOs between folders.
#[utoipa::path(
    post,
    path = "/{org_id}/slos/move",
    context_path = "/api",
    tag = "SLOs",
    operation_id = "MoveSlos",
    summary = "Move SLOs between folders",
    description = "Relocates one or more SLOs into another folder. SLOs share the alert folder namespace, so the destination is an alert folder. A move never changes an SLO's definition and never restarts its measurement.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization identifier")),
    request_body(content = inline(MoveSlosRequestBody), description = "The SLOs and the destination folder", content_type = "application/json"),
    responses(
        (status = 200, description = "Moved", content_type = "application/json", body = MetaHttpResponse),
        (status = 404, description = "Not Found", content_type = "application/json", body = MetaHttpResponse),
        (status = 409, description = "Name already used in the destination", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "SLOs", "operation": "update"})),
    )
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id))]
pub async fn move_slos(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req_body): Json<MoveSlosRequestBody>,
) -> Response {
    if let Some(r) = disabled() {
        return r;
    }
    if req_body.slo_ids.is_empty() {
        return MetaHttpResponse::error(
            StatusCode::BAD_REQUEST.as_u16(),
            "no SLOs given to move".to_string(),
        )
        .into_response();
    }
    match slo_service::move_to_folder(
        &org_id,
        &req_body.slo_ids,
        &req_body.dst_folder_id,
        Some(&user_email.user_id),
    )
    .await
    {
        // Nothing matched: every id was unknown or belonged to another org.
        // Reported rather than passed off as success, which is what a bare
        // "moved" would do for a typo'd id.
        Ok(0) => not_found(),
        Ok(n) => MetaHttpResponse::json(MetaHttpResponse::message(
            StatusCode::OK,
            if n == 1 { "SLO moved" } else { "SLOs moved" },
        )),
        Err(e) => save_error(e),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EnableQuery {
    pub value: bool,
}

/// Enable or pause an SLO.
///
/// Separate from update because pausing must never be able to change the
/// definition — and therefore can never bump the generation or discard
/// measurement.
#[utoipa::path(
    put,
    path = "/{org_id}/slos/{slo_id}/enable",
    context_path = "/api",
    tag = "SLOs",
    operation_id = "EnableSlo",
    summary = "Enable or pause an SLO",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("slo_id" = String, Path, description = "SLO identifier"),
        ("value" = bool, Query, description = "true to enable, false to pause"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MetaHttpResponse),
        (status = 404, description = "Not Found", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, slo_id = %slo_id))]
pub async fn enable_slo(
    Path((org_id, slo_id)): Path<(String, String)>,
    Query(q): Query<EnableQuery>,
) -> Response {
    if let Some(r) = disabled() {
        return r;
    }
    match slo_service::set_enabled(&org_id, &slo_id, q.value).await {
        Ok(true) => MetaHttpResponse::json(MetaHttpResponse::message(
            StatusCode::OK,
            if q.value { "SLO enabled" } else { "SLO paused" },
        )),
        Ok(false) => not_found(),
        Err(e) => internal(anyhow::anyhow!(e.to_string())),
    }
}

/// The per-group breakdown for one SLO.
#[utoipa::path(
    get,
    path = "/{org_id}/slos/{slo_id}/groups",
    context_path = "/api",
    tag = "SLOs",
    operation_id = "GetSloGroups",
    summary = "Per-group SLO status",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("slo_id" = String, Path, description = "SLO identifier"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, slo_id = %slo_id))]
pub async fn get_slo_groups(Path((org_id, slo_id)): Path<(String, String)>) -> Response {
    if let Some(r) = disabled() {
        return r;
    }
    match openobserve_core::slo::service::group_status(&org_id, &slo_id).await {
        Ok(groups) => MetaHttpResponse::json(serde_json::json!({ "list": groups })),
        Err(e) => internal(e),
    }
}

fn not_found() -> Response {
    MetaHttpResponse::error(StatusCode::NOT_FOUND.as_u16(), "SLO not found".to_string())
        .into_response()
}

fn internal(e: anyhow::Error) -> Response {
    tracing::error!("[slo] request failed: {e}");
    MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
        .into_response()
}

/// Map a save failure to a status the caller can act on.
///
/// A budget rejection is a 4xx carrying the arithmetic, not a 500: the user
/// can fix it by deleting an SLO or narrowing this one, and §6b.4d requires
/// the rejection to show its working.
fn save_error(e: openobserve_core::slo::service::SloError) -> Response {
    use openobserve_core::slo::service::SloError;
    let status = match &e {
        SloError::Validation(_) => StatusCode::BAD_REQUEST,
        SloError::Budget(_) => StatusCode::PAYLOAD_TOO_LARGE,
        SloError::NotFound => StatusCode::NOT_FOUND,
        // A name clash is the user's to fix, not a server fault.
        SloError::DuplicateName(_) | SloError::MoveNameConflict => StatusCode::CONFLICT,
        SloError::FolderNotFound(_) => StatusCode::NOT_FOUND,
        SloError::Db(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    if status == StatusCode::INTERNAL_SERVER_ERROR {
        tracing::error!("[slo] save failed: {e}");
    }
    MetaHttpResponse::error(status.as_u16(), e.to_string()).into_response()
}
