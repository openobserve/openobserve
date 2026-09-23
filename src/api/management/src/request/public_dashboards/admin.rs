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

//! Authenticated admin surface for publishing a dashboard. Routes live in
//! `service_routes()` under `auth_middleware`, so per-route RBAC (the caller
//! must be able to manage the parent dashboard) is enforced declaratively. The
//! publisher's own stream read-permissions are re-checked inside the core
//! `create` (the publish-time authz gate), independent of the caller's rights.

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::meta::public_dashboards::PublicDashboardConfig;
use openobserve_api_common::extractors::Headers;

use crate::service::auth::UserEmail;

fn map_err(ctx: &str, e: anyhow::Error) -> Response {
    let msg = e.to_string();
    if msg == "dashboard not found" {
        return MetaHttpResponse::not_found(msg);
    }
    if msg.contains("permission") {
        return MetaHttpResponse::forbidden(msg);
    }
    tracing::error!("[public_dashboards] {ctx}: {e}");
    MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg).into_response()
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

/// GET /{org_id}/dashboards/{dashboard_id}/public — the current share, or 404.
pub async fn get(Path((org_id, dashboard_id)): Path<(String, String)>) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    match openobserve_core::public_dashboards::get(&org_id, &dashboard_id).await {
        Ok(Some(pd)) => MetaHttpResponse::json(serde_json::json!({
            "id": pd.id,
            "slug": pd.slug,
            "visibility": pd.visibility,
            "enabled": pd.enabled,
            "expires_at": pd.expires_at,
            "rebuild_secs": pd.rebuild_secs,
            "time_range_editable": pd.time_range_editable,
            "default_range_secs": pd.default_range_secs,
            "last_rebuilt_at": pd.last_rebuilt_at,
            "published_by": pd.published_by,
            "created_at": pd.created_at,
        })),
        Ok(None) => MetaHttpResponse::not_found("not found"),
        Err(e) => map_err("get", e),
    }
}

/// POST /{org_id}/dashboards/{dashboard_id}/public — publish (one per dashboard).
pub async fn create(
    Path((org_id, dashboard_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<PublicDashboardConfig>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    match openobserve_core::public_dashboards::get(&org_id, &dashboard_id).await {
        Ok(Some(_)) => {
            return MetaHttpResponse::bad_request(
                "this dashboard is already published; revoke it before re-publishing",
            );
        }
        Ok(None) => {}
        Err(e) => return map_err("create.precheck", e),
    }
    match openobserve_core::public_dashboards::create(&org_id, &dashboard_id, body, &user.user_id)
        .await
    {
        Ok(r) => MetaHttpResponse::json(serde_json::json!({ "id": r.id, "slug": r.slug })),
        Err(e) => map_err("create", e),
    }
}

/// DELETE /{org_id}/dashboards/{dashboard_id}/public — revoke the share.
pub async fn delete(Path((org_id, dashboard_id)): Path<(String, String)>) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    let share = match openobserve_core::public_dashboards::get(&org_id, &dashboard_id).await {
        Ok(Some(pd)) => pd,
        Ok(None) => return MetaHttpResponse::not_found("not found"),
        Err(e) => return map_err("delete.lookup", e),
    };
    match openobserve_core::public_dashboards::delete(&org_id, &share.id).await {
        Ok(_) => MetaHttpResponse::json(serde_json::json!({ "deleted": true })),
        Err(e) => map_err("delete", e),
    }
}
