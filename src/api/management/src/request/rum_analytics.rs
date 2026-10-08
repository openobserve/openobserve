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

//! RUM Product Analytics named events and saved funnels, under `/api/{org}/rum/analytics`.

use axum::{
    Json,
    extract::{
        Path, Query,
        rejection::{JsonRejection, QueryRejection},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::UserEmail,
    rum_pa::{
        CreateFunnel, CreateNamedEvent, FunnelRefList, NamedEvent, NamedEventList,
        NamedEventRefList, RumPaError, RumPaErrorBody, SavedFunnel, SavedFunnelList, UpdateFunnel,
        UpdateNamedEvent,
        service::{self, Scope},
        validate_app, validate_id,
    },
};
use serde::Deserialize;

/// `app` is a query parameter because an app name may contain `/`.
#[derive(Debug, Default, Deserialize)]
pub struct AppQuery {
    #[serde(default)]
    pub app: Option<String>,
    /// `true` or `1`, in any case, deletes an event that saved funnels still use.
    #[serde(default, deserialize_with = "flag")]
    pub force: bool,
}

type Q = Result<Query<AppQuery>, QueryRejection>;

#[utoipa::path(
    get,
    path = "/{org_id}/rum/analytics/named_events",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "ListRumNamedEvents",
    summary = "List an app's named events",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("app" = String, Query, description = "RUM application name"),
    ),
    responses(
        (status = 200, description = "Success", body = NamedEventList),
        (status = 400, description = "Invalid app", body = RumPaErrorBody),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List RUM named events for an app", "category": "rum"}))
    )
)]
pub async fn list_named_events(Path(org_id): Path<String>, query: Q) -> Response {
    let app = match app_of(&query) {
        Ok(app) => app,
        Err(e) => return error_response(e),
    };
    let db = infra::db::get_orm_client_rw().await;
    match service::list_events(db, scope(&org_id, &app)).await {
        Ok(list) => Json(NamedEventList { list }).into_response(),
        Err(e) => error_response(e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/rum/analytics/named_events",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "CreateRumNamedEvent",
    summary = "Create a named event",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("app" = String, Query, description = "RUM application name"),
    ),
    request_body(content = CreateNamedEvent, content_type = "application/json"),
    responses(
        (status = 201, description = "Created", body = NamedEvent),
        (status = 400, description = "Invalid body, name, rules or app", body = RumPaErrorBody),
        (status = 409, description = "duplicate_name or limit_reached", body = RumPaErrorBody),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create a RUM named event", "category": "rum"}))
    )
)]
pub async fn create_named_event(
    Path(org_id): Path<String>,
    query: Q,
    Headers(user): Headers<UserEmail>,
    body: Result<Json<CreateNamedEvent>, JsonRejection>,
) -> Response {
    let (app, body) = match app_and_body(&query, body) {
        Ok(parts) => parts,
        Err(e) => return error_response(e),
    };
    let db = infra::db::get_orm_client_rw().await;
    match service::create_event(db, scope(&org_id, &app), &user.user_id, &body).await {
        Ok(event) => (StatusCode::CREATED, Json(event)).into_response(),
        Err(e) => error_response(e),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/rum/analytics/named_events/{id}",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "GetRumNamedEvent",
    summary = "Get a named event",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Named event id"),
        ("app" = String, Query, description = "RUM application name"),
    ),
    responses(
        (status = 200, description = "Success", body = NamedEvent),
        (status = 400, description = "Invalid id or app", body = RumPaErrorBody),
        (status = 404, description = "Not found", body = RumPaErrorBody),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get a RUM named event", "category": "rum"}))
    )
)]
pub async fn get_named_event(Path((org_id, id)): Path<(String, String)>, query: Q) -> Response {
    let app = match app_and_id(&query, &id) {
        Ok(app) => app,
        Err(e) => return error_response(e),
    };
    let db = infra::db::get_orm_client_rw().await;
    match service::get_event(db, scope(&org_id, &app), &id).await {
        Ok(event) => Json(event).into_response(),
        Err(e) => error_response(e),
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/rum/analytics/named_events/{id}",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "UpdateRumNamedEvent",
    summary = "Update a named event at the version the caller read",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Named event id"),
        ("app" = String, Query, description = "RUM application name"),
    ),
    request_body(content = UpdateNamedEvent, content_type = "application/json"),
    responses(
        (status = 200, description = "Updated", body = NamedEvent),
        (status = 400, description = "Invalid body, name, rules, id or app", body = RumPaErrorBody),
        (status = 404, description = "Not found", body = RumPaErrorBody),
        (status = 409, description = "duplicate_name, or version_conflict with the current row", body = RumPaErrorBody),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update a RUM named event", "category": "rum"}))
    )
)]
pub async fn update_named_event(
    Path((org_id, id)): Path<(String, String)>,
    query: Q,
    Headers(user): Headers<UserEmail>,
    body: Result<Json<UpdateNamedEvent>, JsonRejection>,
) -> Response {
    let (app, body) = match app_id_and_body(&query, &id, body) {
        Ok(parts) => parts,
        Err(e) => return error_response(e),
    };
    let db = infra::db::get_orm_client_rw().await;
    match service::update_event(db, scope(&org_id, &app), &id, &user.user_id, &body).await {
        Ok(event) => Json(event).into_response(),
        Err(e) => error_response(e),
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/rum/analytics/named_events/{id}",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "DeleteRumNamedEvent",
    summary = "Delete a named event",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Named event id"),
        ("app" = String, Query, description = "RUM application name"),
        ("force" = Option<bool>, Query, description = "Delete even while saved funnels use it; `true` or `1`"),
    ),
    responses(
        (status = 204, description = "Deleted"),
        (status = 400, description = "Invalid id or app", body = RumPaErrorBody),
        (status = 404, description = "Not found", body = RumPaErrorBody),
        (status = 409, description = "event_in_use, with the funnels", body = RumPaErrorBody),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a RUM named event", "category": "rum"}))
    )
)]
pub async fn delete_named_event(Path((org_id, id)): Path<(String, String)>, query: Q) -> Response {
    let app = match app_and_id(&query, &id) {
        Ok(app) => app,
        Err(e) => return error_response(e),
    };
    let force = query.as_ref().is_ok_and(|Query(q)| q.force);
    let db = infra::db::get_orm_client_rw().await;
    match service::delete_event(db, scope(&org_id, &app), &id, force).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error_response(e),
    }
}

/// At most this many ids are resolved per call, so a crafted query cannot force an unbounded scan.
const MAX_DELETED_NAMES_IDS: usize = 100;

#[derive(Debug, Default, Deserialize)]
pub struct IdsQuery {
    #[serde(default)]
    pub ids: Option<String>,
}

type IdsQ = Result<Query<IdsQuery>, QueryRejection>;

#[utoipa::path(
    get,
    path = "/{org_id}/rum/analytics/named_events/deleted_names",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "ListRumDeletedNamedEventNames",
    summary = "The last known names of deleted named events",
    description = "Resolves the names deleted named events had just before deletion, for ids among a comma-separated list; an id never deleted, or deleted before this capture existed, is simply absent from the result.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("ids" = String, Query, description = "Comma-separated named event ids"),
    ),
    responses(
        (status = 200, description = "Success", body = NamedEventRefList),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "Resolve the last known names of deleted RUM named events", "category": "rum"}))
    )
)]
pub async fn deleted_event_names(Path(org_id): Path<String>, query: IdsQ) -> Response {
    let ids = ids_of(&query);
    let db = infra::db::get_orm_client_rw().await;
    match service::deleted_event_names(db, &org_id, &ids).await {
        Ok(list) => Json(NamedEventRefList { list }).into_response(),
        Err(e) => error_response(e),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/rum/analytics/named_events/{id}/funnels",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "ListRumNamedEventFunnels",
    summary = "List the saved funnels that use a named event",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Named event id"),
        ("app" = String, Query, description = "RUM application name"),
    ),
    responses(
        (status = 200, description = "Success", body = FunnelRefList),
        (status = 400, description = "Invalid id or app", body = RumPaErrorBody),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List saved funnels using a RUM named event", "category": "rum"}))
    )
)]
pub async fn named_event_funnels(Path((org_id, id)): Path<(String, String)>, query: Q) -> Response {
    let app = match app_and_id(&query, &id) {
        Ok(app) => app,
        Err(e) => return error_response(e),
    };
    let db = infra::db::get_orm_client_rw().await;
    match service::event_usages(db, scope(&org_id, &app), &id).await {
        Ok(list) => Json(FunnelRefList { list }).into_response(),
        Err(e) => error_response(e),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/rum/analytics/funnels",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "ListRumSavedFunnels",
    summary = "List an app's saved funnels",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("app" = String, Query, description = "RUM application name"),
    ),
    responses(
        (status = 200, description = "Success", body = SavedFunnelList),
        (status = 400, description = "Invalid app", body = RumPaErrorBody),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List RUM saved funnels; each sql is a frozen snapshot from save time", "category": "rum"}))
    )
)]
pub async fn list_funnels(Path(org_id): Path<String>, query: Q) -> Response {
    let app = match app_of(&query) {
        Ok(app) => app,
        Err(e) => return error_response(e),
    };
    let db = infra::db::get_orm_client_rw().await;
    match service::list_funnels(db, scope(&org_id, &app)).await {
        Ok(list) => Json(SavedFunnelList { list }).into_response(),
        Err(e) => error_response(e),
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/rum/analytics/funnels",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "CreateRumSavedFunnel",
    summary = "Save a funnel",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("app" = String, Query, description = "RUM application name"),
    ),
    request_body(content = CreateFunnel, content_type = "application/json"),
    responses(
        (status = 201, description = "Created", body = SavedFunnel),
        (status = 400, description = "Invalid body, name, definition, sql or app", body = RumPaErrorBody),
        (status = 409, description = "duplicate_name, limit_reached or unknown_event", body = RumPaErrorBody),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Save a RUM funnel with its compiled SQL snapshot", "category": "rum"}))
    )
)]
pub async fn create_funnel(
    Path(org_id): Path<String>,
    query: Q,
    Headers(user): Headers<UserEmail>,
    body: Result<Json<CreateFunnel>, JsonRejection>,
) -> Response {
    let (app, body) = match app_and_body(&query, body) {
        Ok(parts) => parts,
        Err(e) => return error_response(e),
    };
    let db = infra::db::get_orm_client_rw().await;
    match service::create_funnel(db, scope(&org_id, &app), &user.user_id, &body).await {
        Ok(funnel) => (StatusCode::CREATED, Json(funnel)).into_response(),
        Err(e) => error_response(e),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/rum/analytics/funnels/{id}",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "GetRumSavedFunnel",
    summary = "Get a saved funnel",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Saved funnel id"),
        ("app" = String, Query, description = "RUM application name"),
    ),
    responses(
        (status = 200, description = "Success", body = SavedFunnel),
        (status = 400, description = "Invalid id or app", body = RumPaErrorBody),
        (status = 404, description = "Not found", body = RumPaErrorBody),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get a RUM saved funnel; its sql is a frozen snapshot of the definition at save time, which the server cannot recompile", "category": "rum"}))
    )
)]
pub async fn get_funnel(Path((org_id, id)): Path<(String, String)>, query: Q) -> Response {
    let app = match app_and_id(&query, &id) {
        Ok(app) => app,
        Err(e) => return error_response(e),
    };
    let db = infra::db::get_orm_client_rw().await;
    match service::get_funnel(db, scope(&org_id, &app), &id).await {
        Ok(funnel) => Json(funnel).into_response(),
        Err(e) => error_response(e),
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/rum/analytics/funnels/{id}",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "UpdateRumSavedFunnel",
    summary = "Update a saved funnel at the version the caller opened",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Saved funnel id"),
        ("app" = String, Query, description = "RUM application name"),
    ),
    request_body(content = UpdateFunnel, content_type = "application/json"),
    responses(
        (status = 200, description = "Updated", body = SavedFunnel),
        (status = 400, description = "Invalid body, name, definition, sql, id or app", body = RumPaErrorBody),
        (status = 404, description = "Not found", body = RumPaErrorBody),
        (status = 409, description = "duplicate_name, unknown_event, or version_conflict with the current row", body = RumPaErrorBody),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update a RUM saved funnel", "category": "rum"}))
    )
)]
pub async fn update_funnel(
    Path((org_id, id)): Path<(String, String)>,
    query: Q,
    Headers(user): Headers<UserEmail>,
    body: Result<Json<UpdateFunnel>, JsonRejection>,
) -> Response {
    let (app, body) = match app_id_and_body(&query, &id, body) {
        Ok(parts) => parts,
        Err(e) => return error_response(e),
    };
    let db = infra::db::get_orm_client_rw().await;
    match service::update_funnel(db, scope(&org_id, &app), &id, &user.user_id, &body).await {
        Ok(funnel) => Json(funnel).into_response(),
        Err(e) => error_response(e),
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/rum/analytics/funnels/{id}",
    context_path = "/api",
    tag = "Product Analytics",
    operation_id = "DeleteRumSavedFunnel",
    summary = "Delete a saved funnel",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Saved funnel id"),
        ("app" = String, Query, description = "RUM application name"),
    ),
    responses(
        (status = 204, description = "Deleted"),
        (status = 400, description = "Invalid id or app", body = RumPaErrorBody),
        (status = 404, description = "Not found", body = RumPaErrorBody),
        (status = 500, description = "Internal error", body = RumPaErrorBody),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RUM Product Analytics", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a RUM saved funnel", "category": "rum"}))
    )
)]
pub async fn delete_funnel(Path((org_id, id)): Path<(String, String)>, query: Q) -> Response {
    let app = match app_and_id(&query, &id) {
        Ok(app) => app,
        Err(e) => return error_response(e),
    };
    let db = infra::db::get_orm_client_rw().await;
    match service::delete_funnel(db, scope(&org_id, &app), &id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error_response(e),
    }
}

/// The body every failure returns; an internal error's detail goes to the log only.
pub fn error_response(e: RumPaError) -> Response {
    if let RumPaError::Internal { message, .. } = &e {
        log::error!("[rum_pa] internal error: {message}");
    }
    let status = StatusCode::from_u16(e.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (status, Json(e.body())).into_response()
}

fn scope<'a>(org: &'a str, app: &'a str) -> Scope<'a> {
    Scope { org, app }
}

fn app_of(query: &Q) -> Result<String, RumPaError> {
    validate_app(query.as_ref().ok().and_then(|Query(q)| q.app.as_deref()))
}

fn app_and_id(query: &Q, id: &str) -> Result<String, RumPaError> {
    let app = app_of(query)?;
    validate_id(id)?;
    Ok(app)
}

/// Never fails, so an unexpected `force` value reads as `false` instead of rejecting the query.
fn flag<'de, D: serde::Deserializer<'de>>(de: D) -> Result<bool, D::Error> {
    let raw = Option::<String>::deserialize(de)?;
    Ok(raw.is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true")))
}

/// Never fails: a missing, empty or malformed `ids` reads as none. Deduplicated and capped.
fn ids_of(query: &IdsQ) -> Vec<String> {
    let raw = query
        .as_ref()
        .ok()
        .and_then(|Query(q)| q.ids.clone())
        .unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty() && validate_id(s).is_ok())
        .filter(|s| seen.insert(*s))
        .take(MAX_DELETED_NAMES_IDS)
        .map(str::to_string)
        .collect()
}

/// A rejected body is a JSON `invalid_body`, never axum's plain-text 422.
fn body_of<T>(body: Result<Json<T>, JsonRejection>) -> Result<T, RumPaError> {
    body.map(|Json(body)| body)
        .map_err(|rejection| RumPaError::InvalidBody(rejection.body_text()))
}

fn app_and_body<T>(
    query: &Q,
    body: Result<Json<T>, JsonRejection>,
) -> Result<(String, T), RumPaError> {
    let body = body_of(body)?;
    Ok((app_of(query)?, body))
}

fn app_id_and_body<T>(
    query: &Q,
    id: &str,
    body: Result<Json<T>, JsonRejection>,
) -> Result<(String, T), RumPaError> {
    let body = body_of(body)?;
    Ok((app_and_id(query, id)?, body))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{Body, to_bytes},
        extract::FromRequest,
        http::Request,
    };
    use openobserve_core::rum_pa::{Current, FunnelRef};

    use super::*;

    const FIXTURE: &str =
        include_str!("../../../../../web/src/utils/rum/__fixtures__/rumPaApi.json");

    fn fixture() -> serde_json::Value {
        serde_json::from_str(FIXTURE).unwrap()
    }

    async fn json_of(response: Response) -> (u16, serde_json::Value) {
        let status = response.status().as_u16();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    async fn rejection<T: serde::de::DeserializeOwned>(
        content_type: &str,
        body: &str,
    ) -> Result<Json<T>, JsonRejection> {
        let request = Request::builder()
            .method("POST")
            .uri("/")
            .header("content-type", content_type)
            .body(Body::from(body.to_string()))
            .unwrap();
        Json::<T>::from_request(request, &()).await
    }

    fn every_error() -> Vec<RumPaError> {
        let fx = fixture();
        let current: NamedEvent =
            serde_json::from_value(fx["errors"][9]["body"]["current"].clone()).unwrap();
        vec![
            RumPaError::InvalidBody("x".into()),
            RumPaError::InvalidName("x".into()),
            RumPaError::InvalidRules("x".into()),
            RumPaError::InvalidDefinition("x".into()),
            RumPaError::InvalidSql("x".into()),
            RumPaError::InvalidApp("x".into()),
            RumPaError::InvalidId("x".into()),
            RumPaError::NotFound,
            RumPaError::DuplicateName,
            RumPaError::VersionConflict(Box::new(Current::Event(current))),
            RumPaError::LimitReached,
            RumPaError::EventInUse(vec![FunnelRef {
                id: "2A7YeEEBY3ABp3e2zS8iq9y7Ajz".into(),
                name: "Signup flow".into(),
            }]),
            RumPaError::UnknownEvent(vec!["2kY9pF34Qy6nB3Wwd25rq4f5zr3".into()]),
            RumPaError::Internal {
                message: "secret detail".into(),
                retry: false,
            },
        ]
    }

    #[tokio::test]
    async fn every_error_maps_to_the_contract_status_code_and_extras() {
        let fx = fixture();
        let contract = fx["errors"].as_array().unwrap();
        let errors = every_error();
        assert_eq!(errors.len(), contract.len());
        for (error, expected) in errors.into_iter().zip(contract) {
            let (status, body) = json_of(error_response(error)).await;
            assert_eq!(status, expected["status"], "{body}");
            assert_eq!(body["code"], expected["body"]["code"], "{body}");
            for extra in ["current", "funnels"] {
                assert_eq!(
                    body.get(extra),
                    expected["body"].get(extra),
                    "{extra} in {body}"
                );
            }
        }
    }

    #[tokio::test]
    async fn an_internal_error_hides_its_detail() {
        let (status, body) = json_of(error_response(RumPaError::Internal {
            message: "secret detail".into(),
            retry: true,
        }))
        .await;
        assert_eq!(status, 500);
        assert_eq!(
            body,
            serde_json::json!({"code": "internal_error", "message": "Internal server error"})
        );
    }

    #[tokio::test]
    async fn a_body_with_event_ids_or_not_json_is_invalid_body() {
        let mut body = fixture()["createFunnel"].clone();
        body["eventIds"] = serde_json::json!([]);
        let with_ids = rejection::<CreateFunnel>("application/json", &body.to_string()).await;
        let not_json = rejection::<CreateNamedEvent>("application/json", "{not json").await;
        let wrong_type = rejection::<CreateNamedEvent>("text/plain", "{}").await;
        for result in [
            body_of(with_ids).map(|_| ()),
            body_of(not_json).map(|_| ()),
            body_of(wrong_type).map(|_| ()),
        ] {
            let (status, json) = json_of(error_response(result.unwrap_err())).await;
            assert_eq!((status, json["code"].as_str()), (400, Some("invalid_body")));
        }
    }

    #[tokio::test]
    async fn the_contract_request_bodies_parse() {
        let fx = fixture();
        serde_json::from_value::<CreateNamedEvent>(fx["createEvent"].clone()).unwrap();
        serde_json::from_value::<UpdateNamedEvent>(fx["updateEvent"].clone()).unwrap();
        serde_json::from_value::<CreateFunnel>(fx["createFunnel"].clone()).unwrap();
        serde_json::from_value::<UpdateFunnel>(fx["updateFunnel"].clone()).unwrap();
        let event: NamedEvent = serde_json::from_value(fx["namedEvent"].clone()).unwrap();
        assert_eq!(serde_json::to_value(event).unwrap(), fx["namedEvent"]);
        let funnel: SavedFunnel = serde_json::from_value(fx["savedFunnel"].clone()).unwrap();
        assert_eq!(serde_json::to_value(funnel).unwrap(), fx["savedFunnel"]);
    }

    #[tokio::test]
    async fn a_bad_id_or_missing_app_is_refused_before_any_query() {
        let missing_app: Q = Ok(Query(AppQuery::default()));
        let (status, body) = json_of(
            get_funnel(
                Path(("acme".into(), "2A7YeEEBY3ABp3e2zS8iq9y7Ajz".into())),
                missing_app,
            )
            .await,
        )
        .await;
        assert_eq!((status, body["code"].as_str()), (400, Some("invalid_app")));
        let app: Q = Ok(Query(AppQuery {
            app: Some("web".into()),
            force: false,
        }));
        let (status, body) =
            json_of(get_funnel(Path(("acme".into(), "../etc".into())), app).await).await;
        assert_eq!((status, body["code"].as_str()), (400, Some("invalid_id")));
    }

    #[test]
    fn force_reads_as_a_boolean_and_never_rejects_the_query() {
        let force = |qs: &str| {
            let uri: axum::http::Uri = format!("/x?app=web{qs}").parse().unwrap();
            let Query(q) = Query::<AppQuery>::try_from_uri(&uri).unwrap();
            assert_eq!(q.app.as_deref(), Some("web"), "{qs}");
            q.force
        };
        for yes in ["&force=true", "&force=1", "&force=TRUE", "&force=True"] {
            assert!(force(yes), "{yes}");
        }
        for no in ["", "&force=false", "&force=0", "&force=", "&force=yes"] {
            assert!(!force(no), "{no}");
        }
    }

    #[test]
    fn ids_are_parsed_deduplicated_and_never_rejected() {
        const A: &str = "2A7YeEEBY3ABp3e2zS8iq9y7Ajz";
        const B: &str = "2kY9pF34Qy6nB3Wwd25rq4f5zr3";
        let parse = |qs: &str| {
            let uri: axum::http::Uri = format!("/x{qs}").parse().unwrap();
            let query: IdsQ = Ok(Query::<IdsQuery>::try_from_uri(&uri).unwrap());
            ids_of(&query)
        };
        assert_eq!(parse(&format!("?ids={A},{B},{A}")), [A, B]);
        assert_eq!(parse(&format!("?ids={A}, {B} ,short,")), [A, B]);
        assert!(parse("").is_empty());
        assert!(parse("?ids=").is_empty());
        let missing: IdsQ = Ok(Query(IdsQuery::default()));
        assert!(ids_of(&missing).is_empty());
        let many: Vec<String> = (0..150).map(|i| format!("{i:0>27}")).collect();
        assert_eq!(
            parse(&format!("?ids={}", many.join(","))).len(),
            MAX_DELETED_NAMES_IDS
        );
    }
}
