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

//! Downtime handlers: enterprise-only (D1), 403 in the OSS build and while the flag is off.

use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
use config::meta::downtimes::{
    CreateDowntimeResponse, Downtime, DowntimeDetail, DowntimeRequest, ListDowntimesQuery,
    ListDowntimesResponse, MoveDowntimesRequest, PreviewRequest, PreviewResponse, ResourcesRequest,
    ResourcesResponse,
};
use openobserve_api_common::extractors::Headers;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::{common::meta::http::HttpResponse as MetaHttpResponse, service::auth::UserEmail};

/// The destination folder of a create, when given in the query as the route check reads it.
#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct FolderQuery {
    pub folder: Option<String>,
}

/// ListDowntimes
#[utoipa::path(
    get,
    path = "/v2/{org_id}/downtimes",
    context_path = "/api",
    tag = "Downtimes",
    operation_id = "ListDowntimes",
    summary = "List downtimes",
    description = "Lists the downtimes in the folders the user may list, with their status, windows and match counts.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), ListDowntimesQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ListDowntimesResponse),
        (status = 403, description = "Forbidden or not enabled", content_type = "application/json", body = ()),
    ),
)]
pub async fn list_downtimes(
    Path(org_id): Path<String>,
    Query(query): Query<ListDowntimesQuery>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(openobserve_core::downtimes::list(&org_id, &user_email.user_id, &query).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, query, user_email);
        not_supported()
    }
}

/// CreateDowntime
#[utoipa::path(
    post,
    path = "/v2/{org_id}/downtimes",
    context_path = "/api",
    tag = "Downtimes",
    operation_id = "CreateDowntime",
    summary = "Create a downtime",
    description = "Creates a downtime. Quick mute uses this route with one target and specific ids.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), FolderQuery),
    request_body(content = DowntimeRequest, description = "Downtime definition", content_type = "application/json"),
    responses(
        (status = 201, description = "Created", content_type = "application/json", body = CreateDowntimeResponse),
        (status = 400, description = "Invalid request", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden or not enabled", content_type = "application/json", body = ()),
    ),
)]
pub async fn create_downtime(
    Path(org_id): Path<String>,
    Query(folder): Query<FolderQuery>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<DowntimeRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let mut req = req;
        if let Some(folder) = folder.folder.filter(|f| !f.is_empty()) {
            req.folder_id = folder;
        }
        if !crate::service::auth::check_folder_write_permissions(
            &org_id,
            &user_email.user_id,
            "downtime_folders",
            &req.folder_id,
        )
        .await
        {
            return MetaHttpResponse::forbidden("You cannot create downtimes in this folder.");
        }
        match openobserve_core::downtimes::create(&org_id, &user_email.user_id, req).await {
            Ok(downtime) => created(downtime.id),
            Err(e) => error_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, folder, user_email, req);
        not_supported()
    }
}

/// PreviewDowntime
#[utoipa::path(
    post,
    path = "/v2/{org_id}/downtimes/preview",
    context_path = "/api",
    tag = "Downtimes",
    operation_id = "PreviewDowntime",
    summary = "Preview what a downtime covers",
    description = "Lists, per module, what the targets match today, the alerts decided at fire time, and the items a resource refinement cannot decide. Names are limited to what the user may list; totals count everything.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = PreviewRequest, description = "Condition and targets", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = PreviewResponse),
        (status = 403, description = "Forbidden or not enabled", content_type = "application/json", body = ()),
    ),
)]
pub async fn preview_downtime(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<PreviewRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(openobserve_core::downtimes::preview(&org_id, &user_email.user_id, &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email, req);
        not_supported()
    }
}

/// DowntimeResources
#[utoipa::path(
    post,
    path = "/v2/{org_id}/downtimes/resources",
    context_path = "/api",
    tag = "Downtimes",
    operation_id = "DowntimeResources",
    summary = "Resources behind a condition",
    description = "The values of a finer dimension, such as host, that co-occur with the condition, for refining a downtime to some resources.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = ResourcesRequest, description = "Condition and the dimension to refine by", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ResourcesResponse),
        (status = 400, description = "Invalid request", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden or not enabled", content_type = "application/json", body = ()),
    ),
)]
pub async fn downtime_resources(
    Path(org_id): Path<String>,
    Json(req): Json<ResourcesRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(openobserve_core::downtimes::resources(&org_id, &req).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, req);
        not_supported()
    }
}

/// GetDowntime
#[utoipa::path(
    get,
    path = "/v2/{org_id}/downtimes/{downtime_id}",
    context_path = "/api",
    tag = "Downtimes",
    operation_id = "GetDowntime",
    summary = "Get a downtime",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("downtime_id" = String, Path, description = "Downtime id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DowntimeDetail),
        (status = 403, description = "Forbidden or not enabled", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
    ),
)]
pub async fn get_downtime(
    Path((org_id, downtime_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(openobserve_core::downtimes::get(&org_id, &user_email.user_id, &downtime_id).await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, downtime_id, user_email);
        not_supported()
    }
}

/// UpdateDowntime
#[utoipa::path(
    put,
    path = "/v2/{org_id}/downtimes/{downtime_id}",
    context_path = "/api",
    tag = "Downtimes",
    operation_id = "UpdateDowntime",
    summary = "Update a downtime",
    description = "Edits the condition, targets, schedule, reason and banner. The folder changes only through move.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("downtime_id" = String, Path, description = "Downtime id"),
    ),
    request_body(content = DowntimeRequest, description = "Downtime definition", content_type = "application/json"),
    responses(
        (status = 200, description = "Updated", content_type = "application/json", body = Downtime),
        (status = 400, description = "Invalid request", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden or not enabled", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
    ),
)]
pub async fn update_downtime(
    Path((org_id, downtime_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<DowntimeRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(
            openobserve_core::downtimes::update(&org_id, &user_email.user_id, &downtime_id, req)
                .await,
        )
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, downtime_id, user_email, req);
        not_supported()
    }
}

/// CancelDowntime
#[utoipa::path(
    post,
    path = "/v2/{org_id}/downtimes/{downtime_id}/cancel",
    context_path = "/api",
    tag = "Downtimes",
    operation_id = "CancelDowntime",
    summary = "End or cancel a downtime",
    description = "Ends an active window now, or calls off a scheduled one. The row stays for history.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("downtime_id" = String, Path, description = "Downtime id"),
    ),
    responses(
        (status = 200, description = "Cancelled", content_type = "application/json", body = Downtime),
        (status = 403, description = "Forbidden or not enabled", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
    ),
)]
pub async fn cancel_downtime(
    Path((org_id, downtime_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        respond(
            openobserve_core::downtimes::cancel(&org_id, &user_email.user_id, &downtime_id).await,
        )
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, downtime_id, user_email);
        not_supported()
    }
}

/// MoveDowntimes
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/downtimes/move",
    context_path = "/api",
    tag = "Downtimes",
    operation_id = "MoveDowntimes",
    summary = "Move downtimes to another folder",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = MoveDowntimesRequest, description = "Ids and destination folder", content_type = "application/json"),
    responses(
        (status = 200, description = "Moved"),
        (status = 400, description = "Invalid request", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden or not enabled", content_type = "application/json", body = ()),
    ),
)]
pub async fn move_downtimes(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<MoveDowntimesRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !crate::service::auth::check_folder_write_permissions(
            &org_id,
            &user_email.user_id,
            "downtime_folders",
            &req.dst_folder_id,
        )
        .await
        {
            return MetaHttpResponse::forbidden("You cannot move downtimes into this folder.");
        }
        match openobserve_core::downtimes::move_to_folder(&org_id, &user_email.user_id, &req).await
        {
            Ok(()) => MetaHttpResponse::ok("downtimes moved"),
            Err(e) => error_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_email, req);
        not_supported()
    }
}

/// DeleteDowntime
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/downtimes/{downtime_id}",
    context_path = "/api",
    tag = "Downtimes",
    operation_id = "DeleteDowntime",
    summary = "Delete an ended or cancelled downtime",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("downtime_id" = String, Path, description = "Downtime id"),
    ),
    responses(
        (status = 200, description = "Deleted"),
        (status = 403, description = "Forbidden or not enabled", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
        (status = 409, description = "Active, scheduled, or it corrected SLO slices", content_type = "application/json", body = ()),
    ),
)]
pub async fn delete_downtime(
    Path((org_id, downtime_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match openobserve_core::downtimes::delete(&org_id, &user_email.user_id, &downtime_id).await
        {
            Ok(()) => MetaHttpResponse::ok("downtime deleted"),
            Err(e) => error_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, downtime_id, user_email);
        not_supported()
    }
}

#[cfg(not(feature = "enterprise"))]
fn not_supported() -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
fn respond<T: serde::Serialize>(
    result: Result<T, openobserve_core::downtimes::DowntimeError>,
) -> Response {
    match result {
        Ok(body) => MetaHttpResponse::json(body),
        Err(e) => error_response(e),
    }
}

#[cfg(feature = "enterprise")]
fn created(id: String) -> Response {
    use axum::response::IntoResponse;
    (
        axum::http::StatusCode::CREATED,
        Json(CreateDowntimeResponse { id }),
    )
        .into_response()
}

#[cfg(feature = "enterprise")]
fn error_response(e: openobserve_core::downtimes::DowntimeError) -> Response {
    use openobserve_core::downtimes::DowntimeError;
    match e {
        DowntimeError::Disabled => MetaHttpResponse::forbidden("Downtimes are not enabled"),
        DowntimeError::NotFound => MetaHttpResponse::not_found("Downtime not found"),
        DowntimeError::BadRequest(m) => MetaHttpResponse::bad_request(m),
        DowntimeError::Forbidden(m) => MetaHttpResponse::forbidden(m),
        DowntimeError::Conflict(m) => MetaHttpResponse::conflict(m),
        DowntimeError::Internal(m) => {
            log::error!("[DOWNTIMES] {m}");
            MetaHttpResponse::internal_error(m)
        }
    }
}

#[cfg(all(test, not(feature = "enterprise")))]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    fn user() -> Headers<UserEmail> {
        Headers(UserEmail {
            user_id: "root@example.com".to_string(),
        })
    }

    #[tokio::test]
    async fn every_route_is_forbidden_in_the_oss_build() {
        let org = || Path("default".to_string());
        let one = || Path(("default".to_string(), "d1".to_string()));
        let body: DowntimeRequest = serde_json::from_value(serde_json::json!({
            "targets": [{ "module": "alerts", "folders": { "kind": "all" } }],
            "schedule": { "repeat": "none", "starts_at": 1, "ends_at": 2, "timezone": "UTC", "duration_secs": 60 }
        }))
        .unwrap();
        let responses = vec![
            list_downtimes(org(), Query(ListDowntimesQuery::default()), user()).await,
            create_downtime(
                org(),
                Query(FolderQuery::default()),
                user(),
                Json(body.clone()),
            )
            .await,
            get_downtime(one(), user()).await,
            update_downtime(one(), user(), Json(body)).await,
            cancel_downtime(one(), user()).await,
            delete_downtime(one(), user()).await,
        ];
        for response in responses {
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
    }
}
