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
    http::{HeaderMap, StatusCode},
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

/// The OSS refusal of the licensed notice and domain writes, given before the body is read.
#[cfg(not(feature = "enterprise"))]
fn licensed_only(ctx: &str) -> Response {
    map_err(
        ctx,
        openobserve_core::status_pages::enterprise_required::<()>().unwrap_err(),
    )
}

#[utoipa::path(
    get,
    path = "/{org_id}/status_pages",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "ListStatusPages",
    summary = "List status pages",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::PageListResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_pages(Path(org_id): Path<String>, headers: HeaderMap) -> Response {
    let Some(user_id) = user_id_of(&headers) else {
        return MetaHttpResponse::bad_request("invalid user_id header");
    };
    let permitted = match openobserve_api_common::auth::validator::list_objects_for_user(
        &org_id,
        user_id,
        "GET",
        "status_page",
    )
    .await
    {
        Ok(list) => list,
        Err(e) => return MetaHttpResponse::forbidden(e.to_string()),
    };
    match openobserve_core::status_pages::list_pages_view(&org_id, permitted.as_deref()).await {
        Ok(resp) => MetaHttpResponse::json(resp),
        Err(e) => map_err("list_pages", e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/status_pages",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "CreateStatusPage",
    summary = "Create a status page",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = CreatePageRequest, description = "Request body", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::PageAdminView),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
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

#[utoipa::path(
    get,
    path = "/{org_id}/status_pages/{id}",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "GetStatusPage",
    summary = "Get a status page",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Resource id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::PageAdminView),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_page(Path((org_id, id)): Path<(String, String)>) -> Response {
    match openobserve_core::status_pages::get_page(&org_id, &id).await {
        Ok(Some(page)) => MetaHttpResponse::json(page),
        Ok(None) => MetaHttpResponse::not_found("not found"),
        Err(e) => map_err("get_page", e),
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/status_pages/{id}",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "UpdateStatusPage",
    summary = "Update a status page",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Resource id"),
    ),
    request_body(content = UpdatePageRequest, description = "Request body", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::PageAdminView),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
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

#[utoipa::path(
    delete,
    path = "/{org_id}/status_pages/{id}",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "DeleteStatusPage",
    summary = "Delete a status page",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Resource id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
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

#[utoipa::path(
    post,
    path = "/{org_id}/status_pages/{id}/rotate_slug",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "RotateStatusPageSlug",
    summary = "Rotate the public slug of a status page",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Resource id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
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
#[utoipa::path(
    put,
    path = "/{org_id}/status_pages/{id}/components",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "SetStatusPageComponents",
    summary = "Replace the components of a status page",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Resource id"),
    ),
    request_body(content = SetComponentsRequest, description = "Request body", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
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
#[utoipa::path(
    get,
    path = "/{org_id}/status_pages/{id}/preview",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "PreviewStatusPage",
    summary = "Preview a status page as published",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Resource id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::PreviewResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn preview(Path((org_id, id)): Path<(String, String)>) -> Response {
    match openobserve_core::status_pages::preview(&org_id, &id).await {
        Ok(Some(resp)) => MetaHttpResponse::json(resp),
        Ok(None) => MetaHttpResponse::not_found("not found"),
        Err(e) => map_err("preview", e),
    }
}

/// Notices touching the given page's components — a filtered view over the
/// org-scoped notice set (design: "a per-page convenience view").
#[utoipa::path(
    get,
    path = "/{org_id}/status_pages/{id}/notices",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "ListStatusPageNotices",
    summary = "List notices of a status page",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Resource id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<config::meta::status_pages::NoticeAdminView>),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_page_notices(Path((org_id, id)): Path<(String, String)>) -> Response {
    match openobserve_core::status_pages::list_notices_for_page(&org_id, &id).await {
        Ok(notices) => MetaHttpResponse::json(notices),
        Err(e) => map_err("list_page_notices", e),
    }
}

/// `component_ids` in the body may span any page the caller has permission
/// on; omitting it defaults to every component on the page in the path, the
/// common "post an update for this page" case.
#[utoipa::path(
    post,
    path = "/{org_id}/status_pages/{id}/notices",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "CreateStatusPageNotice",
    summary = "Create a notice on a status page",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Resource id"),
    ),
    request_body(content = CreateNoticeRequest, description = "Request body", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::NoticeAdminView),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn create_notice(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] Json(body): Json<CreateNoticeRequest>,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, user);
        licensed_only("create_notice")
    }
    #[cfg(feature = "enterprise")]
    {
        match openobserve_core::status_pages::create_notice(&org_id, &id, body, &user.user_id).await
        {
            Ok(notice) => {
                audit(&org_id, &user.user_id, "create_notice", Some(&notice.id)).await;
                MetaHttpResponse::json(notice)
            }
            Err(e) => map_err("create_notice", e),
        }
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/status_pages/notices/{nid}",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "UpdateStatusPageNotice",
    summary = "Update a status page notice",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("nid" = String, Path, description = "Notice id"),
    ),
    request_body(content = UpdateNoticeRequest, description = "Request body", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::NoticeAdminView),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn update_notice(
    Path((org_id, nid)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] Json(body): Json<UpdateNoticeRequest>,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, nid, user);
        licensed_only("update_notice")
    }
    #[cfg(feature = "enterprise")]
    {
        match openobserve_core::status_pages::update_notice(&org_id, &nid, body).await {
            Ok(notice) => {
                audit(&org_id, &user.user_id, "update_notice", Some(&nid)).await;
                MetaHttpResponse::json(notice)
            }
            Err(e) => map_err("update_notice", e),
        }
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/status_pages/notices/{nid}",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "DeleteStatusPageNotice",
    summary = "Delete a status page notice",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("nid" = String, Path, description = "Notice id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
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

#[utoipa::path(
    get,
    path = "/{org_id}/status_pages/notices/{nid}/updates",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "ListStatusPageNoticeUpdates",
    summary = "List the updates of a notice",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("nid" = String, Path, description = "Notice id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<config::meta::status_pages::NoticeUpdateView>),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_notice_updates(Path((org_id, nid)): Path<(String, String)>) -> Response {
    match openobserve_core::status_pages::list_notice_updates(&org_id, &nid).await {
        Ok(updates) => MetaHttpResponse::json(updates),
        Err(e) => map_err("list_notice_updates", e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/status_pages/notices/{nid}/updates",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "AddStatusPageNoticeUpdate",
    summary = "Post an update to a notice",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("nid" = String, Path, description = "Notice id"),
    ),
    request_body(content = NoticeUpdateRequest, description = "Request body", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn add_notice_update(
    Path((org_id, nid)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] Json(body): Json<NoticeUpdateRequest>,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, nid, user);
        licensed_only("add_notice_update")
    }
    #[cfg(feature = "enterprise")]
    {
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
}

/// The 3am escape hatch: resolves a false-positive auto-incident and snoozes
/// the underlying check so it does not immediately reopen.
#[utoipa::path(
    post,
    path = "/{org_id}/status_pages/notices/{nid}/mark_false_positive",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "MarkStatusPageNoticeFalsePositive",
    summary = "Resolve a notice as a false positive",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("nid" = String, Path, description = "Notice id"),
    ),
    request_body(content = MarkFalsePositiveRequest, description = "Request body", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn mark_false_positive(
    Path((org_id, nid)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] Json(body): Json<MarkFalsePositiveRequest>,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, nid, user);
        licensed_only("mark_false_positive")
    }
    #[cfg(feature = "enterprise")]
    {
        match openobserve_core::status_pages::mark_false_positive(
            &org_id,
            &nid,
            body.snooze_hours,
            &body.reason,
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
}

/// Undoes a false-alarm mark: the incident returns to the public history and its downtime counts
/// again.
#[utoipa::path(
    delete,
    path = "/{org_id}/status_pages/notices/{nid}/mark_false_positive",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "UndoStatusPageNoticeFalsePositive",
    summary = "Undo a false-alarm mark on a notice",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("nid" = String, Path, description = "Notice id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn undo_false_positive(
    Path((org_id, nid)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    match openobserve_core::status_pages::undo_false_positive(&org_id, &nid).await {
        Ok(()) => {
            audit(&org_id, &user.user_id, "undo_false_positive", Some(&nid)).await;
            MetaHttpResponse::ok("restored")
        }
        Err(e) => map_err("undo_false_positive", e),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/status_pages/{id}/domains",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "ListStatusPageDomains",
    summary = "List custom domains of a status page",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Resource id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<config::meta::status_pages::DomainAdminView>),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_domains(Path((org_id, id)): Path<(String, String)>) -> Response {
    match openobserve_core::status_pages::list_domains(&org_id, &id).await {
        Ok(domains) => MetaHttpResponse::json(domains),
        Err(e) => map_err("list_domains", e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/status_pages/{id}/domains",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "CreateStatusPageDomain",
    summary = "Add a custom domain to a status page",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Resource id"),
    ),
    request_body(content = CreateDomainRequest, description = "Request body", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::CreateDomainResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn create_domain(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] Json(body): Json<CreateDomainRequest>,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, user);
        licensed_only("create_domain")
    }
    #[cfg(feature = "enterprise")]
    {
        match openobserve_core::status_pages::create_domain(&org_id, &id, body).await {
            Ok(resp) => {
                audit(&org_id, &user.user_id, "create_domain", Some(&resp.id)).await;
                MetaHttpResponse::json(resp)
            }
            Err(e) => map_err("create_domain", e),
        }
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/status_pages/domains/{did}",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "DeleteStatusPageDomain",
    summary = "Remove a custom domain",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("did" = String, Path, description = "Custom domain id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
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

#[utoipa::path(
    post,
    path = "/{org_id}/status_pages/domains/{did}/verify",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "VerifyStatusPageDomain",
    summary = "Verify a custom domain",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("did" = String, Path, description = "Custom domain id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::DomainAdminView),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
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

#[utoipa::path(
    post,
    path = "/{org_id}/status_pages/domains/{did}/check",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "CheckStatusPageDomainAgain",
    summary = "Check a custom domain again",
    description = "Returns the computed state of the domain. With built-in TLS it also asks the domain manager to look at the domain again, while the hostname's validation attempts for the hour have room. In proxy mode and while custom domains are off it only reads.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("did" = String, Path, description = "Custom domain id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::DomainAdminView),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn check_domain(Path((org_id, did)): Path<(String, String)>) -> Response {
    match openobserve_core::status_pages::check_domain_again(&org_id, &did).await {
        Ok(domain) => MetaHttpResponse::json(domain),
        Err(e) => map_err("check_domain", e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/status_pages/domains/release_shadowed",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "ReleaseShadowedStatusPageDomains",
    summary = "Release every custom domain claim that is not the holder of its hostname",
    description = "Root only. Run before rolling back to a release that reads claims by hostname alone.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::ReleaseShadowedResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn release_shadowed(Path(org_id): Path<String>, headers: HeaderMap) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, headers);
        licensed_only("release_shadowed")
    }
    #[cfg(feature = "enterprise")]
    {
        let refusal = "only a root user may release shadowed claims";
        let user_id = match root_caller(&headers, refusal) {
            Ok(user_id) => user_id,
            Err(refused) => return refused,
        };
        match openobserve_core::status_pages::release_shadowed_domains().await {
            Ok(released) => {
                audit(&org_id, user_id, "release_shadowed", None).await;
                MetaHttpResponse::json(config::meta::status_pages::ReleaseShadowedResponse {
                    released,
                })
            }
            Err(e) => map_err("release_shadowed", e),
        }
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/status_pages/domains/installation",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "GetStatusPageDomainInstallation",
    summary = "Read the custom domain installation status",
    description = "Root only. Every key is always present: with built-in TLS the status is filled, in proxy mode only `enabled` and `tls` are, and while custom domains are off only `tls` says which mode is configured.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::DomainInstallationView),
        (status = 403, description = "Forbidden", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn installation_status(Path(org_id): Path<String>, headers: HeaderMap) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, headers);
        licensed_only("installation_status")
    }
    #[cfg(feature = "enterprise")]
    {
        let call = openobserve_core::status_pages::installation_status();
        root_installation(&org_id, &headers, ("installation_status", None), call).await
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/status_pages/domains/installation/check",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "CheckStatusPageDomainInstallation",
    summary = "Check the custom domain installation again",
    description = "Root only, with built-in TLS. Asks the domain manager for the installation check of the domain target now, while the target's validation attempts for the hour have room. In proxy mode and while custom domains are off it is refused.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::DomainInstallationView),
        (status = 403, description = "Forbidden", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn installation_check(Path(org_id): Path<String>, headers: HeaderMap) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, headers);
        licensed_only("installation_check")
    }
    #[cfg(feature = "enterprise")]
    {
        let call = openobserve_core::status_pages::installation_check();
        let ctx = ("installation_check", Some("installation_check"));
        root_installation(&org_id, &headers, ctx, call).await
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/status_pages/domains/installation/reset_key_check",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "ResetStatusPageDomainKeyCheck",
    summary = "Reset the custom domain key check value",
    description = "Root only, with built-in TLS. Run after the domain key was replaced: the next node with a key stores its own check value, and every certificate is then issued again. In proxy mode and while custom domains are off it is refused.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::DomainInstallationView),
        (status = 403, description = "Forbidden", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn installation_reset_key_check(
    Path(org_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, headers);
        licensed_only("installation_reset_key_check")
    }
    #[cfg(feature = "enterprise")]
    {
        let call = openobserve_core::status_pages::installation_reset_key_check();
        let ctx = ("installation_reset_key_check", Some("reset_key_check"));
        root_installation(&org_id, &headers, ctx, call).await
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/status_pages/domains/installation/recheck_epoch",
    context_path = "/api",
    tag = "Status Pages",
    operation_id = "RecheckStatusPageDomainEpoch",
    summary = "Re-check every custom domain after a restore",
    description = "Root only, with built-in TLS. When the stored epoch differs from the configured one, asks every holder for its proof, starts the 72 hours of those whose proof is gone and lapses none, then writes the configured epoch. With equal epochs it only returns the status. In proxy mode and while custom domains are off it is refused.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::status_pages::DomainInstallationView),
        (status = 403, description = "Forbidden", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Status Pages", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn installation_recheck_epoch(
    Path(org_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, headers);
        licensed_only("installation_recheck_epoch")
    }
    #[cfg(feature = "enterprise")]
    {
        let call = openobserve_core::status_pages::installation_recheck_epoch();
        let ctx = ("installation_recheck_epoch", Some("recheck_epoch"));
        root_installation(&org_id, &headers, ctx, call).await
    }
}

/// The root check is in the handler, as `release_shadowed` does it; a refused action is the
/// error every refused write uses. An action is audited once it answered.
#[cfg(feature = "enterprise")]
async fn root_installation(
    org_id: &str,
    headers: &HeaderMap,
    (ctx, audited): (&str, Option<&str>),
    call: impl Future<
        Output = Result<config::meta::status_pages::DomainInstallationView, anyhow::Error>,
    >,
) -> Response {
    let refusal = "only a root user may read or repair the installation";
    let user_id = match root_caller(headers, refusal) {
        Ok(user_id) => user_id,
        Err(refused) => return refused,
    };
    match call.await {
        Ok(view) => {
            if let Some(action) = audited {
                audit(org_id, user_id, action, None).await;
            }
            MetaHttpResponse::json(view)
        }
        Err(e) => map_err(ctx, e),
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

/// The middleware writes `user_id` as raw bytes, which `Headers<UserEmail>` drops when non-ASCII.
/// Read it exactly: the route check ran against that identity, so the list must too.
fn user_id_of(headers: &HeaderMap) -> Option<&str> {
    std::str::from_utf8(headers.get("user_id")?.as_bytes()).ok()
}

/// The caller's exact identity when it is a root user. A missing or invalid identity, and any
/// other user, is refused, so the check and the audit read the same one.
#[cfg(feature = "enterprise")]
fn root_caller<'a>(headers: &'a HeaderMap, refusal: &str) -> Result<&'a str, Response> {
    match user_id_of(headers) {
        Some(user_id) if db::user::is_root_user(user_id) => Ok(user_id),
        _ => Err(MetaHttpResponse::forbidden(refusal)),
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{HeaderValue, Method, Request},
        routing::{get, post},
    };
    use tower::ServiceExt;

    use super::*;

    fn parts_with_user_id(user_id: &str) -> axum::http::request::Parts {
        // The same write `auth_middleware` makes.
        let value = HeaderValue::from_str(user_id).unwrap();
        let request = Request::builder()
            .header("user_id", value)
            .body(())
            .unwrap();
        request.into_parts().0
    }

    #[test]
    fn the_listing_user_is_read_whatever_the_address_holds() {
        for user_id in [
            "root@example.com",
            "jos\u{e9}@example.com",
            "\u{5f20}\u{4f1f}@example.cn",
        ] {
            let parts = parts_with_user_id(user_id);
            assert_eq!(user_id_of(&parts.headers), Some(user_id));
        }
        assert_eq!(user_id_of(&HeaderMap::new()), None);
    }

    #[test]
    fn the_listing_user_is_refused_when_the_header_is_not_utf8() {
        let mut headers = HeaderMap::new();
        headers.insert("user_id", HeaderValue::from_bytes(b"root\xff").unwrap());
        assert_eq!(user_id_of(&headers), None);
    }

    #[test]
    fn the_listing_user_keeps_the_exact_identity_the_route_checked() {
        // A different account from `root@example.com`, whose id starts with U+00A0.
        for user_id in [
            "\u{a0}root@example.com",
            "root@example.com ",
            " root@example.com",
        ] {
            let parts = parts_with_user_id(user_id);
            assert_eq!(user_id_of(&parts.headers), Some(user_id));
        }
    }

    fn user(user_id: &str) -> Option<HeaderValue> {
        Some(HeaderValue::from_str(user_id).unwrap())
    }

    // The routes of this slice that check for root, as the production router mounts them.
    fn app() -> Router {
        let base = "/{org_id}/status_pages/domains";
        Router::new()
            .route(&format!("{base}/installation"), get(installation_status))
            .route(
                &format!("{base}/installation/check"),
                post(installation_check),
            )
            .route(
                &format!("{base}/installation/reset_key_check"),
                post(installation_reset_key_check),
            )
            .route(
                &format!("{base}/installation/recheck_epoch"),
                post(installation_recheck_epoch),
            )
            .route(&format!("{base}/release_shadowed"), post(release_shadowed))
    }

    async fn send(method: Method, tail: &str, who: Option<HeaderValue>) -> Response {
        let mut request = Request::builder()
            .method(method)
            .uri(format!("/default/status_pages/domains/{tail}"));
        if let Some(who) = who {
            request = request.header("user_id", who);
        }
        let request = request.body(Body::empty()).unwrap();
        app().oneshot(request).await.unwrap()
    }

    /// The four installation routes. `release_shadowed` is not among them: it mutates for root.
    async fn answers_for(who: Option<HeaderValue>) -> Vec<(&'static str, Response)> {
        let routes = [
            ("GET installation", Method::GET, "installation"),
            ("POST check", Method::POST, "installation/check"),
            (
                "POST reset_key_check",
                Method::POST,
                "installation/reset_key_check",
            ),
            (
                "POST recheck_epoch",
                Method::POST,
                "installation/recheck_epoch",
            ),
        ];
        let mut answers = Vec::new();
        for (route, method, tail) in routes {
            answers.push((route, send(method, tail, who.clone()).await));
        }
        answers
    }

    async fn answers(user_id: &str) -> Vec<(&'static str, Response)> {
        answers_for(user(user_id)).await
    }

    async fn json_of(response: Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn a_caller_that_is_not_root_gets_403_on_all_four_installation_routes() {
        for (route, response) in answers("member@example.com").await {
            assert_eq!(response.status(), StatusCode::FORBIDDEN, "{route}");
        }
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn the_oss_twin_answers_with_the_enterprise_required_error() {
        for (route, response) in answers("member@example.com").await {
            let body = json_of(response).await.to_string();
            assert!(body.contains("enterprise"), "{route}: {body}");
        }
    }

    /// The identities that look like the root user to a trimming or lossy reader, and are not.
    #[cfg(feature = "enterprise")]
    fn lookalikes() -> Vec<Option<HeaderValue>> {
        vec![
            user("root@example.com "),
            user(" root@example.com"),
            user("\u{a0}root@example.com"),
            user("root@example.com\u{a0}"),
            Some(HeaderValue::from_bytes(b"root@example.com\xff").unwrap()),
            None,
        ]
    }

    #[cfg(feature = "enterprise")]
    fn insert_root() {
        common::infra::config::ORG_USERS.insert(
            format!("{}/root@example.com", config::DEFAULT_ORG),
            infra::table::org_users::OrgUserRecord {
                email: "root@example.com".to_string(),
                org_id: config::DEFAULT_ORG.to_string(),
                role: config::meta::user::UserRole::Root,
                token: String::new(),
                rum_token: None,
                created_at: 0,
                allow_static_token: false,
            },
        );
    }

    // Through the router, so the identity is extracted as a request has it: a lookalike or no
    // identity is a 403 on every installation route, never a 400 and never root.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_identity_that_only_looks_like_root_is_refused_on_the_installation_routes() {
        insert_root();
        for who in lookalikes() {
            for (route, response) in answers_for(who.clone()).await {
                assert_eq!(response.status(), StatusCode::FORBIDDEN, "{route} {who:?}");
            }
        }
    }

    // Only rejected identities reach `release_shadowed` here: root's call would run the cleanup.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_identity_that_only_looks_like_root_is_refused_on_release_shadowed() {
        insert_root();
        for who in lookalikes() {
            let response = send(Method::POST, "release_shadowed", who.clone()).await;
            assert_eq!(response.status(), StatusCode::FORBIDDEN, "{who:?}");
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn the_exact_root_identity_passes_the_root_check_on_the_installation_status() {
        insert_root();
        let status = send(Method::GET, "installation", user("root@example.com")).await;
        assert_eq!(status.status(), StatusCode::OK);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_refused_action_has_the_status_and_error_shape_of_a_refused_create_domain() {
        insert_root();
        let refused = map_err(
            "create_domain",
            anyhow::anyhow!("validation: custom domains are not enabled on this installation"),
        );
        let reference = (refused.status(), json_of(refused).await);
        let mut got = answers("root@example.com").await;

        let status = got.remove(0).1;
        assert_eq!(status.status(), StatusCode::OK);
        let body = json_of(status).await;
        assert_eq!(
            (body["enabled"].clone(), body.as_object().unwrap().len()),
            (false.into(), 16)
        );
        for (route, response) in got {
            assert_eq!(response.status(), reference.0, "{route}");
            let body = json_of(response).await;
            let keys = |value: &serde_json::Value| -> Vec<String> {
                value.as_object().unwrap().keys().cloned().collect()
            };
            assert_eq!(keys(&body), keys(&reference.1), "{route}");
            let message = body["message"].as_str().unwrap();
            assert_eq!(
                message, "validation: this action needs built-in TLS",
                "{route}"
            );
        }
    }
}
