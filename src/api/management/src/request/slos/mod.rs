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
    if slo.name.is_empty() || slo.name.len() > 256 {
        return MetaHttpResponse::bad_request(
            "name must be non empty and less than 256 characters",
        );
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
    match slo_service::delete(&org_id, &slo_id).await {
        Ok(true) => {
            MetaHttpResponse::json(MetaHttpResponse::message(StatusCode::OK, "SLO deleted"))
        }
        Ok(false) => not_found(),
        Err(e) => save_error(e),
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
    match openobserve_core::slo::service::group_status(&org_id, &slo_id).await {
        Ok(groups) => MetaHttpResponse::json(serde_json::json!({ "list": groups })),
        Err(e) => internal(e),
    }
}

/// The alerts an `alert` SLI could point at, each ineligible one saying why.
///
/// Lives under `/alerts` rather than `/slos` because it answers a question
/// about alerts, and is authorized as one. Ineligible alerts are returned
/// rather than hidden: "your alert is not in the list" is not an explanation,
/// and every reason here has a remedy the user can apply before saving —
/// which is the whole point of the endpoint (S-16 §5.1, §5.4).
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/slo-eligible",
    context_path = "/api",
    tag = "SLOs",
    operation_id = "ListSloEligibleAlerts",
    summary = "List alerts usable as an SLI source",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization identifier")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id))]
pub async fn list_slo_eligible_alerts(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    let user_id: Option<&str> = None;
    #[cfg(feature = "enterprise")]
    let user_id = Some(user_email.user_id.as_str());

    match slo_service::list_slo_eligible_alerts(&org_id, user_id).await {
        Ok(list) => MetaHttpResponse::json(serde_json::json!({ "list": list })),
        Err(e) => internal(anyhow::anyhow!(e.to_string())),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AlertSliPreviewQuery {
    /// Rolling window, seconds — 7d, 30d or 90d, as an SLO's own window is.
    pub window_secs: i64,
    /// 60 or 300 (S-4).
    pub slice_interval_secs: i64,
}

/// What an alert SLI would have measured, before the SLO exists.
///
/// Returns the ledger intervals for the ribbon plus the achieved SLI and the
/// coverage behind it — the alert analogue of the time-slice preview. Computed
/// by the same fold the ingest pass runs, so the preview cannot disagree with
/// the SLO it is previewing.
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/{alert_id}/slo-preview",
    context_path = "/api",
    tag = "SLOs",
    operation_id = "PreviewAlertSli",
    summary = "Preview the uptime an alert would produce as an SLI source",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("alert_id" = String, Path, description = "Source alert identifier"),
        ("window_secs" = i64, Query, description = "Rolling window in seconds"),
        ("slice_interval_secs" = i64, Query, description = "Slice width in seconds"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Bad Request", content_type = "application/json", body = MetaHttpResponse),
        (status = 404, description = "Not Found", content_type = "application/json", body = MetaHttpResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(org_id = %org_id, alert_id = %alert_id))]
pub async fn preview_alert_sli(
    Path((org_id, alert_id)): Path<(String, String)>,
    Query(q): Query<AlertSliPreviewQuery>,
) -> Response {
    match slo_service::alert_sli_preview(&org_id, &alert_id, q.window_secs, q.slice_interval_secs)
        .await
    {
        Ok(preview) => MetaHttpResponse::json(preview),
        Err(openobserve_core::slo::service::SloError::NotFound) => MetaHttpResponse::error(
            StatusCode::NOT_FOUND.as_u16(),
            "alert not found".to_string(),
        )
        .into_response(),
        Err(e @ openobserve_core::slo::service::SloError::Validation(_)) => {
            MetaHttpResponse::error(StatusCode::BAD_REQUEST.as_u16(), e.to_string()).into_response()
        }
        Err(e) => internal(anyhow::anyhow!(e.to_string())),
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
        SloError::DuplicateName(_)
        | SloError::MoveNameConflict
        | SloError::AlertCascadeConflict(_) => StatusCode::CONFLICT,
        SloError::FolderNotFound(_) => StatusCode::NOT_FOUND,
        SloError::TemporarilyUnavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
        SloError::Db(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    if status == StatusCode::INTERNAL_SERVER_ERROR {
        tracing::error!("[slo] save failed: {e}");
    }
    MetaHttpResponse::error(status.as_u16(), e.to_string()).into_response()
}
