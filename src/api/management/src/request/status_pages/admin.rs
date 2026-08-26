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

//! Authenticated admin CRUD for status pages. Routes live in `service_routes()`
//! under `auth_middleware`, so per-route RBAC is enforced declaratively by the
//! OpenFGA route-permission middleware (mirrors synthetics). The one check that
//! CANNOT be declarative is the per-mapped-check folder-authz (R-1) — a status
//! page must never publish the status of a synthetics check the caller cannot
//! read — so `set_components` verifies each check in-handler before writing.

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::meta::status_pages::{
    CreateDomainRequest, CreateNoticeRequest, CreatePageRequest, MarkFalsePositiveRequest,
    NoticeUpdateRequest, SetComponentsRequest, UpdateNoticeRequest, UpdatePageRequest,
};
use openobserve_api_common::extractors::Headers;

use crate::service::auth::UserEmail;
#[cfg(feature = "enterprise")]
use crate::service::auth::check_permissions;

fn map_err(ctx: &str, e: anyhow::Error) -> Response {
    let msg = e.to_string();
    if msg.starts_with("validation: ") {
        return MetaHttpResponse::bad_request(msg);
    }
    if msg == "not found" {
        return MetaHttpResponse::not_found(msg);
    }
    if let Some(reason) = msg.strip_prefix("enterprise: ") {
        return MetaHttpResponse::forbidden(reason);
    }
    tracing::error!("[status_pages] {ctx}: {e}");
    MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), msg).into_response()
}

pub async fn list_pages(Path(org_id): Path<String>) -> Response {
    match openobserve_core::status_pages::list_pages_view(&org_id).await {
        Ok(resp) => MetaHttpResponse::json(resp),
        Err(e) => map_err("list_pages", e),
    }
}

pub async fn create_page(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<CreatePageRequest>,
) -> Response {
    match openobserve_core::status_pages::create_page(&org_id, body, &user.user_id).await {
        Ok(page) => {
            audit(&org_id, &user.user_id, "create_page", Some(&page.id)).await;
            MetaHttpResponse::json(page)
        }
        Err(e) => map_err("create_page", e),
    }
}

pub async fn get_page(Path((org_id, id)): Path<(String, String)>) -> Response {
    match openobserve_core::status_pages::get_page(&org_id, &id).await {
        Ok(Some(page)) => MetaHttpResponse::json(page),
        Ok(None) => MetaHttpResponse::not_found("not found"),
        Err(e) => map_err("get_page", e),
    }
}

pub async fn update_page(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<UpdatePageRequest>,
) -> Response {
    match openobserve_core::status_pages::update_page(&org_id, &id, body).await {
        Ok(page) => {
            audit(&org_id, &user.user_id, "update_page", Some(&id)).await;
            MetaHttpResponse::json(page)
        }
        Err(e) => map_err("update_page", e),
    }
}

pub async fn delete_page(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    match openobserve_core::status_pages::delete_page(&org_id, &id).await {
        Ok(true) => {
            audit(&org_id, &user.user_id, "delete_page", Some(&id)).await;
            MetaHttpResponse::ok("deleted")
        }
        Ok(false) => MetaHttpResponse::not_found("not found"),
        Err(e) => map_err("delete_page", e),
    }
}

pub async fn rotate_slug(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    match openobserve_core::status_pages::rotate_slug(&org_id, &id).await {
        Ok(slug) => {
            audit(&org_id, &user.user_id, "rotate_slug", Some(&id)).await;
            MetaHttpResponse::json(serde_json::json!({ "slug": slug }))
        }
        Err(e) => map_err("rotate_slug", e),
    }
}

/// PUT components — the R-1 gate. Every mapped check is verified for folder-level
/// synthetics READ by the caller BEFORE any write. Without this, a user maps
/// checks they cannot see onto a public page and exfiltrates their status.
pub async fn set_components(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<SetComponentsRequest>,
) -> Response {
    // R-1: clear every distinct mapped check for folder-level read first.
    #[cfg(feature = "enterprise")]
    {
        use std::collections::HashSet;
        let check_ids: HashSet<&str> = body
            .components
            .iter()
            .flat_map(|c| c.check_ids.iter().map(String::as_str))
            .collect();
        for check_id in check_ids {
            match caller_can_read_check(&org_id, &user.user_id, check_id).await {
                Ok(true) => {}
                Ok(false) => {
                    return MetaHttpResponse::forbidden(format!(
                        "you do not have read access to check {check_id}"
                    ));
                }
                Err(e) => return map_err("set_components:authz", e),
            }
        }
    }
    match openobserve_core::status_pages::set_components(&org_id, &id, body).await {
        Ok(()) => {
            audit(&org_id, &user.user_id, "set_components", Some(&id)).await;
            MetaHttpResponse::ok("updated")
        }
        Err(e) => map_err("set_components", e),
    }
}

/// Runs the exact serializer the public plane uses, so an admin previewing a
/// draft page sees precisely what publishing would produce.
pub async fn preview(Path((org_id, id)): Path<(String, String)>) -> Response {
    match openobserve_core::status_pages::preview(&org_id, &id).await {
        Ok(Some(resp)) => MetaHttpResponse::json(resp),
        Ok(None) => MetaHttpResponse::not_found("not found"),
        Err(e) => map_err("preview", e),
    }
}

/// Notices touching the given page's components — a filtered view over the
/// org-scoped notice set (design: "a per-page convenience view").
pub async fn list_page_notices(Path((org_id, id)): Path<(String, String)>) -> Response {
    match openobserve_core::status_pages::list_notices_for_page(&org_id, &id).await {
        Ok(notices) => MetaHttpResponse::json(notices),
        Err(e) => map_err("list_page_notices", e),
    }
}

/// `component_ids` in the body may span any page the caller has permission
/// on; omitting it defaults to every component on the page in the path, the
/// common "post an update for this page" case.
pub async fn create_notice(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<CreateNoticeRequest>,
) -> Response {
    match openobserve_core::status_pages::create_notice(&org_id, &id, body, &user.user_id).await {
        Ok(notice) => {
            audit(&org_id, &user.user_id, "create_notice", Some(&notice.id)).await;
            MetaHttpResponse::json(notice)
        }
        Err(e) => map_err("create_notice", e),
    }
}

pub async fn update_notice(
    Path((org_id, nid)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<UpdateNoticeRequest>,
) -> Response {
    match openobserve_core::status_pages::update_notice(&org_id, &nid, body).await {
        Ok(notice) => {
            audit(&org_id, &user.user_id, "update_notice", Some(&nid)).await;
            MetaHttpResponse::json(notice)
        }
        Err(e) => map_err("update_notice", e),
    }
}

pub async fn delete_notice(
    Path((org_id, nid)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    match openobserve_core::status_pages::delete_notice(&org_id, &nid).await {
        Ok(true) => {
            audit(&org_id, &user.user_id, "delete_notice", Some(&nid)).await;
            MetaHttpResponse::ok("deleted")
        }
        Ok(false) => MetaHttpResponse::not_found("not found"),
        Err(e) => map_err("delete_notice", e),
    }
}

pub async fn list_notice_updates(Path((org_id, nid)): Path<(String, String)>) -> Response {
    match openobserve_core::status_pages::list_notice_updates(&org_id, &nid).await {
        Ok(updates) => MetaHttpResponse::json(updates),
        Err(e) => map_err("list_notice_updates", e),
    }
}

pub async fn add_notice_update(
    Path((org_id, nid)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<NoticeUpdateRequest>,
) -> Response {
    match openobserve_core::status_pages::add_notice_update(&org_id, &nid, body, &user.user_id)
        .await
    {
        Ok(()) => {
            audit(&org_id, &user.user_id, "notice_update", Some(&nid)).await;
            MetaHttpResponse::ok("posted")
        }
        Err(e) => map_err("add_notice_update", e),
    }
}

/// The 3am escape hatch: resolves a false-positive auto-incident and snoozes
/// the underlying check so it does not immediately reopen.
pub async fn mark_false_positive(
    Path((org_id, nid)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<MarkFalsePositiveRequest>,
) -> Response {
    match openobserve_core::status_pages::mark_false_positive(
        &org_id,
        &nid,
        body.snooze_hours,
        &user.user_id,
    )
    .await
    {
        Ok(()) => {
            audit(&org_id, &user.user_id, "mark_false_positive", Some(&nid)).await;
            MetaHttpResponse::ok("marked")
        }
        Err(e) => map_err("mark_false_positive", e),
    }
}

pub async fn list_domains(Path((org_id, id)): Path<(String, String)>) -> Response {
    match openobserve_core::status_pages::list_domains(&org_id, &id).await {
        Ok(domains) => MetaHttpResponse::json(domains),
        Err(e) => map_err("list_domains", e),
    }
}

pub async fn create_domain(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<CreateDomainRequest>,
) -> Response {
    match openobserve_core::status_pages::create_domain(&org_id, &id, body).await {
        Ok(resp) => {
            audit(&org_id, &user.user_id, "create_domain", Some(&resp.id)).await;
            MetaHttpResponse::json(resp)
        }
        Err(e) => map_err("create_domain", e),
    }
}

pub async fn delete_domain(
    Path((org_id, did)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    match openobserve_core::status_pages::delete_domain(&org_id, &did).await {
        Ok(true) => {
            audit(&org_id, &user.user_id, "delete_domain", Some(&did)).await;
            MetaHttpResponse::ok("deleted")
        }
        Ok(false) => MetaHttpResponse::not_found("not found"),
        Err(e) => map_err("delete_domain", e),
    }
}

pub async fn verify_domain(
    Path((org_id, did)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    match openobserve_core::status_pages::verify_domain_now(&org_id, &did).await {
        Ok(domain) => {
            audit(&org_id, &user.user_id, "verify_domain", Some(&did)).await;
            MetaHttpResponse::json(domain)
        }
        Err(e) => map_err("verify_domain", e),
    }
}

/// R-1 composition: resolve the check's folder, then OpenFGA-check read on it.
/// Enterprise-only — the OSS build has no OpenFGA (and its stub returns false),
/// so the gate is compiled only where it can be enforced.
#[cfg(feature = "enterprise")]
async fn caller_can_read_check(
    org_id: &str,
    user_id: &str,
    check_id: &str,
) -> Result<bool, anyhow::Error> {
    let Some(check) = openobserve_synthetics::service::get_synthetic(org_id, check_id).await?
    else {
        return Ok(false); // unknown check → deny
    };
    Ok(check_permissions(
        check_id,
        org_id,
        user_id,
        "synthetics",
        "GET",
        Some(&check.folder_id),
        false,
        true,
        false,
    )
    .await)
}

/// R-4: append an uptime-affecting mutation to the immutable audit log. Best
/// effort — an audit-write failure must not fail the user's operation, but it
/// is logged loudly.
async fn audit(org_id: &str, actor: &str, action: &str, notice_id: Option<&str>) {
    if let Err(e) =
        openobserve_core::status_pages::write_audit(org_id, actor, action, notice_id).await
    {
        tracing::error!("[status_pages] audit write failed for {action}: {e}");
    }
}
