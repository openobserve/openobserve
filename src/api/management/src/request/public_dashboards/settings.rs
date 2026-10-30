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

//! The org's public dashboard switch and link limit; the role check holds without OpenFGA.

use axum::{Json, extract::Path, response::Response};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::meta::{public_dashboards::OrgPublicDashboardSettings, user::UserRole};
use openobserve_api_common::extractors::Headers;

use super::admin::{feature_gate, map_err};
use crate::service::auth::UserEmail;

/// GET /{org_id}/settings/public_dashboards
pub async fn get(Path(org_id): Path<String>, Headers(user): Headers<UserEmail>) -> Response {
    if let Some(r) = admin_gate(&org_id, &user.user_id).await {
        return r;
    }
    match openobserve_core::public_dashboards::org_settings(&org_id).await {
        Ok(settings) => MetaHttpResponse::json(settings),
        Err(e) => map_err("settings_get", e),
    }
}

/// PUT /{org_id}/settings/public_dashboards — a lower limit stops new links only.
pub async fn put(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<OrgPublicDashboardSettings>,
) -> Response {
    if let Some(r) = admin_gate(&org_id, &user.user_id).await {
        return r;
    }
    match openobserve_core::public_dashboards::set_org_settings(&org_id, body, &user.user_id).await
    {
        Ok(settings) => MetaHttpResponse::json(settings),
        Err(e) => map_err("settings_put", e),
    }
}

async fn admin_gate(org_id: &str, user_id: &str) -> Option<Response> {
    if let Some(r) = feature_gate() {
        return Some(r);
    }
    if db::user::is_root_user(user_id) {
        return None;
    }
    match openobserve_core::users::get_user(Some(org_id), user_id).await {
        Some(user) if matches!(user.role, UserRole::Root | UserRole::Admin) => None,
        _ => Some(MetaHttpResponse::forbidden(
            "Only an administrator of this organization can change its public link settings",
        )),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    #[tokio::test]
    async fn a_member_who_is_not_an_admin_is_refused() {
        let user = UserEmail {
            user_id: "not-an-admin@example.invalid".to_string(),
        };
        let resp = get(Path("o1".to_string()), Headers(user)).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }
}
