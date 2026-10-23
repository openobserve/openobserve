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
use config::meta::public_dashboards::{PublicDashboardConfig, TakeOverRequest};
use infra::table::entity::public_dashboards::Model as PublicDashboard;
use openobserve_api_common::extractors::Headers;
use openobserve_core::public_dashboards::{
    Conflict, Forbidden, Invalid, LINK_NOT_FOUND, PublicLinkView, hide_unreadable_slugs,
};

use crate::service::auth::UserEmail;
#[cfg(feature = "enterprise")]
use crate::service::auth::check_permissions;

pub(super) fn map_err(ctx: &str, e: anyhow::Error) -> Response {
    if let Some(invalid) = e.downcast_ref::<Invalid>() {
        return MetaHttpResponse::bad_request(&invalid.0);
    }
    if let Some(forbidden) = e.downcast_ref::<Forbidden>() {
        return MetaHttpResponse::forbidden(&forbidden.0);
    }
    if let Some(conflict) = e.downcast_ref::<Conflict>() {
        return MetaHttpResponse::conflict(&conflict.0);
    }
    let msg = e.to_string();
    if msg == "dashboard not found" || msg == LINK_NOT_FOUND {
        return MetaHttpResponse::not_found(msg);
    }
    tracing::error!("[public_dashboards] {ctx}: {e}");
    // The raw error names tables and drivers; it stays in the log.
    MetaHttpResponse::error(
        StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
        "Something went wrong on the server. Please try again.",
    )
    .into_response()
}

/// 404 while the feature flag is off, so the admin routes leak no more than the public ones.
pub(super) fn feature_gate() -> Option<Response> {
    if config::get_config().public_dashboards.enabled {
        None
    } else {
        Some(MetaHttpResponse::not_found("not found"))
    }
}

/// A link also needs edit access to its dashboard; `allow_orphan` lets revoke clean up orphans.
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

/// Whether the caller can GET the dashboard, checked as `edit_access_gate` checks PUT.
#[cfg(feature = "enterprise")]
async fn can_read_dashboard(
    org_id: &str,
    user_id: &str,
    dashboard_id: String,
    folder_id: Option<String>,
) -> bool {
    // A deleted dashboard has no folder to check against, so its slug stays hidden.
    let Some(folder_id) = folder_id else {
        return false;
    };
    check_permissions(
        &dashboard_id,
        org_id,
        user_id,
        "dashboards",
        "GET",
        Some(&folder_id),
        false,
        true,
        false,
    )
    .await
}

#[cfg(not(feature = "enterprise"))]
async fn can_read_dashboard(
    _org_id: &str,
    _user_id: &str,
    _dashboard_id: String,
    _folder_id: Option<String>,
) -> bool {
    true
}

/// The link only when it belongs to this org and dashboard, else the response to return.
pub(super) async fn load_link(
    org_id: &str,
    dashboard_id: &str,
    link_id: &str,
) -> Result<PublicDashboard, Response> {
    match openobserve_core::public_dashboards::get_link(org_id, dashboard_id, link_id).await {
        Ok(Some(link)) => Ok(link),
        Ok(None) => Err(MetaHttpResponse::not_found(LINK_NOT_FOUND)),
        Err(e) => Err(map_err("load_link", e)),
    }
}

/// The views with each slug hidden unless `reader` may GET its dashboard; None skips the check.
async fn views_for(
    org_id: &str,
    reader: Option<&str>,
    links: Vec<PublicDashboard>,
) -> Result<Vec<PublicLinkView>, anyhow::Error> {
    let mut views = openobserve_core::public_dashboards::views(org_id, links).await?;
    hide_for_reader(&mut views, org_id, reader).await;
    Ok(views)
}

async fn hide_for_reader(views: &mut [PublicLinkView], org_id: &str, reader: Option<&str>) {
    if let Some(user_id) = reader {
        hide_unreadable_slugs(views, |dashboard_id, folder_id| {
            can_read_dashboard(org_id, user_id, dashboard_id, folder_id)
        })
        .await;
    }
}

async fn view_response(
    ctx: &str,
    org_id: &str,
    reader: Option<&str>,
    link: PublicDashboard,
) -> Response {
    match views_for(org_id, reader, vec![link]).await {
        Ok(mut v) => match v.pop() {
            Some(view) => MetaHttpResponse::json(view),
            None => MetaHttpResponse::not_found(LINK_NOT_FOUND),
        },
        Err(e) => map_err(ctx, e),
    }
}

async fn list_response(
    ctx: &str,
    org_id: &str,
    user_id: &str,
    links: Vec<PublicDashboard>,
) -> Response {
    match views_for(org_id, Some(user_id), links).await {
        Ok(list) => list_body(list),
        Err(e) => map_err(ctx, e),
    }
}

fn list_body(list: Vec<PublicLinkView>) -> Response {
    MetaHttpResponse::json(serde_json::json!({ "list": list }))
}

/// GET /{org_id}/public_dashboards — every public link in the org; slugs only where readable.
pub async fn list_org(Path(org_id): Path<String>, Headers(user): Headers<UserEmail>) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    match openobserve_core::public_dashboards::list(&org_id).await {
        Ok(links) => list_response("list_org", &org_id, &user.user_id, links).await,
        Err(e) => map_err("list_org", e),
    }
}

/// GET /{org_id}/dashboards/{dashboard_id}/public_links — this dashboard's links, newest first.
pub async fn list(
    Path((org_id, dashboard_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    match openobserve_core::public_dashboards::list_for_dashboard(&org_id, &dashboard_id).await {
        Ok(links) => list_response("list", &org_id, &user.user_id, links).await,
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
        Ok(link) => view_response("create", &org_id, None, link).await,
        Err(r) => r,
    }
}

/// GET /{org_id}/dashboards/{dashboard_id}/public_links/{link_id}
pub async fn get(
    Path((org_id, dashboard_id, link_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    match load_link(&org_id, &dashboard_id, &link_id).await {
        Ok(link) => view_response("get", &org_id, Some(&user.user_id), link).await,
        Err(r) => r,
    }
}

/// PUT /{org_id}/dashboards/{dashboard_id}/public_links/{link_id} — the slug is kept.
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
        Ok(link) => view_response("update", &org_id, None, link).await,
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
        Ok(link) => view_response("pause", &org_id, None, link).await,
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
        Ok(link) => view_response("resume", &org_id, None, link).await,
        Err(e) => map_err("resume", e),
    }
}

/// POST .../public_links/{link_id}/take_over — the caller becomes the publisher; same slug.
pub async fn take_over(
    Path((org_id, dashboard_id, link_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<TakeOverRequest>,
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
    match openobserve_core::public_dashboards::take_over_link(
        link,
        &user.user_id,
        &body.expected_publisher,
    )
    .await
    {
        Ok(link) => view_response("take_over", &org_id, None, link).await,
        Err(e) => map_err("take_over", e),
    }
}

/// POST .../public_links/{link_id}/refresh — every range is due on its next view; no query runs.
pub async fn refresh(
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
    match openobserve_core::public_dashboards::refresh_now(link).await {
        Ok(link) => view_response("refresh", &org_id, None, link).await,
        Err(e) => map_err("refresh", e),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_link_errors_map_to_their_status() {
        let invalid = anyhow::Error::new(Invalid("This dashboard has 14 panels".into()));
        assert_eq!(map_err("create", invalid).status(), StatusCode::BAD_REQUEST);
        let missing = anyhow::anyhow!("dashboard not found");
        assert_eq!(map_err("create", missing).status(), StatusCode::NOT_FOUND);
        let gone = anyhow::anyhow!(LINK_NOT_FOUND);
        assert_eq!(map_err("pause", gone).status(), StatusCode::NOT_FOUND);
        let forbidden = anyhow::Error::new(Forbidden("no read permission on logs/s".into()));
        assert_eq!(map_err("update", forbidden).status(), StatusCode::FORBIDDEN);
        let taken = anyhow::Error::new(Conflict("this link was taken over by b; reload".into()));
        assert_eq!(map_err("take_over", taken).status(), StatusCode::CONFLICT);
        // A driver error that mentions permission is still a 500 with nothing of it shown.
        let driver = anyhow::anyhow!("permission denied for table public_dashboards");
        assert_eq!(
            map_err("update", driver).status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        let other = anyhow::anyhow!("connection refused");
        assert_eq!(
            map_err("create", other).status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    fn views(dashboards: &[(&str, Option<&str>)]) -> Vec<PublicLinkView> {
        dashboards
            .iter()
            .map(|(dash, folder)| {
                let link: PublicDashboard = serde_json::from_value(serde_json::json!({
                    "id": dash, "org_id": "o", "folder_id": "f", "dashboard_id": dash,
                    "slug": format!("slug-{dash}"), "name": "n", "visibility": 1,
                    "refresh_secs": 300, "dashboard_version": 8, "published_by": "p@x",
                    "enabled": true, "created_by": "p@x", "created_at": 1, "updated_at": 1,
                    "rev": 1, "access_count": 0
                }))
                .unwrap();
                let label = folder.map(|f| infra::table::dashboards::DashboardLabel {
                    title: "t".into(),
                    folder_id: f.into(),
                    folder_name: "f".into(),
                });
                openobserve_core::public_dashboards::view(link, label.as_ref(), false, 1)
            })
            .collect()
    }

    async fn list_json(list: Vec<PublicLinkView>) -> serde_json::Value {
        let body = axum::body::to_bytes(list_body(list).into_body(), 1 << 20)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    #[tokio::test]
    async fn the_list_shows_a_null_slug_where_the_caller_cannot_get_the_dashboard() {
        let mut list = views(&[("open", Some("f1")), ("secret", Some("f2"))]);
        hide_unreadable_slugs(&mut list, |dash, _| async move { dash == "open" }).await;
        let json = list_json(list).await;
        assert_eq!(json["list"][0]["slug"], "slug-open");
        let hidden = json["list"][1].as_object().unwrap();
        assert_eq!(hidden.get("slug"), Some(&serde_json::Value::Null));
        assert_eq!(hidden["dashboard_title"], "t");
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn without_enterprise_every_reader_keeps_every_slug() {
        let mut list = views(&[("a", Some("f1")), ("gone", None)]);
        hide_for_reader(&mut list, "o", Some("viewer@x")).await;
        let json = list_json(list).await;
        assert_eq!(json["list"][0]["slug"], "slug-a");
        assert_eq!(json["list"][1]["slug"], "slug-gone");
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_reader_never_sees_the_slug_of_a_deleted_dashboard_but_an_editor_does() {
        let mut list = views(&[("gone", None)]);
        hide_for_reader(&mut list, "o", None).await;
        assert_eq!(list[0].slug.as_deref(), Some("slug-gone"));
        hide_for_reader(&mut list, "o", Some("viewer@x")).await;
        assert_eq!(list[0].slug, None);
    }

    /// `edit_access_gate` answers 403 in Enterprise; take_over returns it untouched before any
    /// read.
    #[test]
    fn take_over_returns_the_edit_access_gate_refusal_before_loading_the_link() {
        let src = include_str!("admin.rs");
        let start = src.find("pub async fn take_over(").unwrap();
        let body = &src[start..start + src[start..].find("\n}\n").unwrap()];
        let gate = body
            .find(
                "if let Some(r) = edit_access_gate(&org_id, &dashboard_id, &user.user_id, false)\
                 .await {\n        return r;\n    }",
            )
            .expect("take_over must return the edit access refusal as is");
        let load = body.find("load_link(").unwrap();
        let core = body.find("take_over_link(").unwrap();
        assert!(body.find("feature_gate()").unwrap() < gate);
        assert!(gate < load && load < core, "{body}");
    }
}
