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

//! Admin API for public dashboard links; Enterprise also requires dashboard edit access.

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::meta::public_dashboards::PublicDashboardConfig;
use infra::table::entity::public_dashboards::Model as PublicDashboard;
use openobserve_api_common::extractors::Headers;

use crate::service::auth::UserEmail;
#[cfg(feature = "enterprise")]
use crate::service::auth::check_permissions;

fn map_err(ctx: &str, e: anyhow::Error) -> Response {
    let msg = e.to_string();
    if msg == "dashboard not found" {
        return MetaHttpResponse::not_found(msg);
    }
    if msg.contains("permission") {
        return MetaHttpResponse::forbidden(msg);
    }
    tracing::error!("[public_dashboards] {ctx}: {e}");
    // The raw error names tables and drivers; it stays in the log.
    MetaHttpResponse::error(
        StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
        "Something went wrong on the server. Please try again.",
    )
    .into_response()
}

/// 404 when the feature flag is off, so the admin surface mirrors the public
/// plane's gating instead of leaking route existence.
fn feature_gate() -> Option<Response> {
    if config::get_config().public_dashboards.enabled {
        None
    } else {
        Some(MetaHttpResponse::not_found("not found"))
    }
}

/// The route grant is org-wide, so managing a link also needs edit access to its dashboard;
/// `allow_orphan` lets revoke clean up links whose dashboard was deleted.
#[cfg(feature = "enterprise")]
async fn edit_access_gate(
    org_id: &str,
    dashboard_id: &str,
    user_id: &str,
    allow_orphan: bool,
) -> Option<Response> {
    let folder_id = match infra::table::dashboards::get_by_id(org_id, dashboard_id).await {
        Ok(Some((folder, _))) => folder.folder_id,
        Ok(None) if allow_orphan => return None,
        Ok(None) => return Some(MetaHttpResponse::not_found("dashboard not found")),
        Err(e) => return Some(map_err("edit_access_gate", e.into())),
    };
    let allowed = check_permissions(
        dashboard_id,
        org_id,
        user_id,
        "dashboards",
        "PUT",
        Some(&folder_id),
        false,
        true,
        false,
    )
    .await;
    (!allowed).then(|| {
        MetaHttpResponse::forbidden(
            "you need edit access to this dashboard to manage its public links",
        )
    })
}

#[cfg(not(feature = "enterprise"))]
async fn edit_access_gate(
    _org_id: &str,
    _dashboard_id: &str,
    _user_id: &str,
    _allow_orphan: bool,
) -> Option<Response> {
    None
}

/// The link only when it belongs to this org and dashboard, else the response to return.
async fn load_link(
    org_id: &str,
    dashboard_id: &str,
    link_id: &str,
) -> Result<PublicDashboard, Response> {
    match openobserve_core::public_dashboards::get_link(org_id, dashboard_id, link_id).await {
        Ok(Some(link)) => Ok(link),
        Ok(None) => Err(MetaHttpResponse::not_found("public link not found")),
        Err(e) => Err(map_err("load_link", e)),
    }
}

async fn view_response(ctx: &str, org_id: &str, link: PublicDashboard) -> Response {
    match openobserve_core::public_dashboards::views(org_id, vec![link]).await {
        Ok(mut v) => match v.pop() {
            Some(view) => MetaHttpResponse::json(view),
            None => MetaHttpResponse::not_found("public link not found"),
        },
        Err(e) => map_err(ctx, e),
    }
}

async fn list_response(ctx: &str, org_id: &str, links: Vec<PublicDashboard>) -> Response {
    match openobserve_core::public_dashboards::views(org_id, links).await {
        Ok(list) => MetaHttpResponse::json(serde_json::json!({ "list": list })),
        Err(e) => map_err(ctx, e),
    }
}

/// GET /{org_id}/public_dashboards — every public link in the org.
pub async fn list_org(Path(org_id): Path<String>) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    match openobserve_core::public_dashboards::list(&org_id).await {
        Ok(links) => list_response("list_org", &org_id, links).await,
        Err(e) => map_err("list_org", e),
    }
}

/// GET /{org_id}/dashboards/{dashboard_id}/public_links — this dashboard's links, newest first.
pub async fn list(Path((org_id, dashboard_id)): Path<(String, String)>) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    match openobserve_core::public_dashboards::list_for_dashboard(&org_id, &dashboard_id).await {
        Ok(links) => list_response("list", &org_id, links).await,
        Err(e) => map_err("list", e),
    }
}

/// POST /{org_id}/dashboards/{dashboard_id}/public_links — create another link.
pub async fn create(
    Path((org_id, dashboard_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<PublicDashboardConfig>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    if let Err(msg) = openobserve_core::public_dashboards::validate_config(&body) {
        return MetaHttpResponse::bad_request(msg);
    }
    if let Some(r) = edit_access_gate(&org_id, &dashboard_id, &user.user_id, false).await {
        return r;
    }
    let created = match openobserve_core::public_dashboards::create(
        &org_id,
        &dashboard_id,
        body,
        &user.user_id,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => return map_err("create", e),
    };
    match load_link(&org_id, &dashboard_id, &created.id).await {
        Ok(link) => view_response("create", &org_id, link).await,
        Err(r) => r,
    }
}

/// GET /{org_id}/dashboards/{dashboard_id}/public_links/{link_id}
pub async fn get(
    Path((org_id, dashboard_id, link_id)): Path<(String, String, String)>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    match load_link(&org_id, &dashboard_id, &link_id).await {
        Ok(link) => view_response("get", &org_id, link).await,
        Err(r) => r,
    }
}

/// PUT /{org_id}/dashboards/{dashboard_id}/public_links/{link_id} — edit settings; the slug is
/// kept.
pub async fn update(
    Path((org_id, dashboard_id, link_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<PublicDashboardConfig>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    if let Some(r) = edit_access_gate(&org_id, &dashboard_id, &user.user_id, false).await {
        return r;
    }
    let link = match load_link(&org_id, &dashboard_id, &link_id).await {
        Ok(link) => link,
        Err(r) => return r,
    };
    if let Err(msg) = openobserve_core::public_dashboards::validate_edit(&body, &link) {
        return MetaHttpResponse::bad_request(msg);
    }
    match openobserve_core::public_dashboards::update_link(link, body, &user.user_id).await {
        Ok(link) => view_response("update", &org_id, link).await,
        Err(e) => map_err("update", e),
    }
}

/// POST /{org_id}/dashboards/{dashboard_id}/public_links/{link_id}/pause
pub async fn pause(
    Path((org_id, dashboard_id, link_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    if let Some(r) = edit_access_gate(&org_id, &dashboard_id, &user.user_id, false).await {
        return r;
    }
    let link = match load_link(&org_id, &dashboard_id, &link_id).await {
        Ok(link) => link,
        Err(r) => return r,
    };
    match openobserve_core::public_dashboards::pause_link(link, &user.user_id).await {
        Ok(link) => view_response("pause", &org_id, link).await,
        Err(e) => map_err("pause", e),
    }
}

/// POST /{org_id}/dashboards/{dashboard_id}/public_links/{link_id}/resume
pub async fn resume(
    Path((org_id, dashboard_id, link_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    if let Some(r) = edit_access_gate(&org_id, &dashboard_id, &user.user_id, false).await {
        return r;
    }
    let link = match load_link(&org_id, &dashboard_id, &link_id).await {
        Ok(link) => link,
        Err(r) => return r,
    };
    match openobserve_core::public_dashboards::resume_link(link, &user.user_id).await {
        Ok(link) => view_response("resume", &org_id, link).await,
        Err(e) if e.to_string().contains("expired") => MetaHttpResponse::bad_request(e),
        Err(e) => map_err("resume", e),
    }
}

/// POST /{org_id}/dashboards/{dashboard_id}/public_links/{link_id}/rebuild — build the absolute
/// ranges again.
pub async fn rebuild(
    Path((org_id, dashboard_id, link_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    if let Some(r) = edit_access_gate(&org_id, &dashboard_id, &user.user_id, false).await {
        return r;
    }
    let link = match load_link(&org_id, &dashboard_id, &link_id).await {
        Ok(link) => link,
        Err(r) => return r,
    };
    match openobserve_core::public_dashboards::rebuild_now(link, &user.user_id).await {
        Ok(link) => view_response("rebuild", &org_id, link).await,
        Err(e) if e.to_string().contains("absolute") || e.to_string().contains("resume") => {
            MetaHttpResponse::bad_request(e)
        }
        Err(e) => map_err("rebuild", e),
    }
}

/// DELETE /{org_id}/dashboards/{dashboard_id}/public_links/{link_id} — revoke.
pub async fn delete(
    Path((org_id, dashboard_id, link_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    if let Some(r) = edit_access_gate(&org_id, &dashboard_id, &user.user_id, true).await {
        return r;
    }
    let link = match load_link(&org_id, &dashboard_id, &link_id).await {
        Ok(link) => link,
        Err(r) => return r,
    };
    match openobserve_core::public_dashboards::delete(&org_id, &link.id).await {
        Ok(_) => MetaHttpResponse::json(serde_json::json!({ "deleted": true })),
        Err(e) => map_err("delete", e),
    }
}
