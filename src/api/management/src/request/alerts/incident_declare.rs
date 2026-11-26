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

#[cfg(feature = "enterprise")]
use axum::{
    Json,
    extract::{FromRequest, Request},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use axum::{extract::Path, response::Response};
#[cfg(feature = "enterprise")]
use config::meta::alerts::incidents::{
    AddContextRequest, ContextKind, ContextOrigin, ContextTarget, DeclareRequest, ResultSummary,
};
#[cfg(feature = "enterprise")]
use openobserve_api_common::auth::delegation::DelegatedCaller;
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::ValidatedJson;
#[cfg(feature = "enterprise")]
use openobserve_core::alerts::incidents::declare::{
    self as service, DeclareError, DeclarePreview, DeclareResponse,
};
use openobserve_core::auth::UserEmail;
#[cfg(feature = "enterprise")]
use serde::{Serialize, de::DeserializeOwned};
#[cfg(feature = "enterprise")]
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(feature = "enterprise")]
use crate::request::{
    alerts::ack,
    security::{self, rca_scope},
};

#[cfg(feature = "enterprise")]
#[derive(Serialize, ToSchema)]
struct AddedContext {
    context_id: String,
}

#[cfg(feature = "enterprise")]
#[derive(Serialize, ToSchema)]
struct IncidentContextMetadata {
    kind: ContextKind,
    created_by: String,
    start_at: i64,
    end_at: i64,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
}

#[cfg(feature = "enterprise")]
#[derive(Serialize, ToSchema)]
struct IncidentContextDetail {
    #[serde(flatten)]
    metadata: IncidentContextMetadata,
    note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<ContextTarget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    origin: Option<ContextOrigin>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result_summary: Option<ResultSummary>,
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/declare/preview",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "PreviewIncidentDeclare",
    summary = "Preview incident declaration",
    security(("Authorization" = [])),
    params(("org_id" = String, Path)),
    request_body = DeclareRequest,
    responses(
        (status = 200, description = "Candidate, routing, downtime and onset", body = DeclarePreview),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Insufficient permissions"),
        (status = 409, description = "Incidents v2 is off"),
        (status = 422, description = "Invalid JSON fields"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/declare/preview",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "PreviewIncidentDeclare",
    summary = "Preview incident declaration",
    security(("Authorization" = [])),
    params(("org_id" = String, Path)),
    responses((status = 403, description = "Incident declaration and contexts require the enterprise build", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn preview(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] request: Request,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if let Some(response) = refuse_write(&org, &user.user_id, &request) {
            return response;
        }
        let body = match json_body(request).await {
            Ok(body) => body,
            Err(response) => return response,
        };
        if let Err(response) = require_permission(&org, &user.user_id, "POST").await {
            return response;
        }
        match service::preview_declare(&org, &user.user_id, body).await {
            Ok(preview) => MetaHttpResponse::json(preview),
            Err(error) => error_response(error),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/declare",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "DeclareIncident",
    summary = "Declare an incident or attach to a matching incident",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path),
        ("Idempotency-Key" = String, Header, description = "Required request key, at most 64 characters"),
    ),
    request_body = DeclareRequest,
    responses(
        (status = 200, description = "Attached to an incident", body = DeclareResponse),
        (status = 201, description = "Declared an incident", body = DeclareResponse),
        (status = 400, description = "Invalid request or Idempotency-Key"),
        (status = 403, description = "Insufficient permissions"),
        (status = 409, description = "Incidents v2 is off or attachment limit reached"),
        (status = 422, description = "No team to page or invalid JSON fields"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/declare",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "DeclareIncident",
    summary = "Declare an incident or attach to a matching incident",
    security(("Authorization" = [])),
    params(("org_id" = String, Path)),
    responses((status = 403, description = "Incident declaration and contexts require the enterprise build", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn declare(
    Path(org): Path<String>,
    Headers(user): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] request: Request,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if let Some(response) = refuse_write(&org, &user.user_id, &request) {
            return response;
        }
        let key = match idempotency_key(request.headers()) {
            Ok(Some(key)) => key.to_owned(),
            Ok(None) => return MetaHttpResponse::bad_request("Idempotency-Key is required"),
            Err(response) => return response,
        };
        let body = match json_body(request).await {
            Ok(body) => body,
            Err(response) => return response,
        };
        if let Err(response) = require_permission(&org, &user.user_id, "POST").await {
            return response;
        }
        match service::declare_incident(&org, &user.user_id, &key, body).await {
            Ok(result) => {
                let status = if result.created {
                    StatusCode::CREATED
                } else {
                    StatusCode::OK
                };
                (status, Json(result)).into_response()
            }
            Err(error) => error_response(error),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, user);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/contexts",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "AttachIncidentContext",
    summary = "Capture and attach context to an incident",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path),
        ("incident_id" = String, Path),
        ("Idempotency-Key" = Option<String>, Header, description = "Request key, at most 64 characters"),
    ),
    request_body = AddContextRequest,
    responses(
        (status = 200, description = "Context attached", body = AddedContext),
        (status = 400, description = "Invalid request or Idempotency-Key"),
        (status = 403, description = "Insufficient permissions"),
        (status = 404, description = "Incident not found"),
        (status = 409, description = "Incidents v2 is off or attachment limit reached"),
        (status = 422, description = "Invalid JSON fields"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/contexts",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "AttachIncidentContext",
    summary = "Capture and attach context to an incident",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    responses((status = 403, description = "Incident declaration and contexts require the enterprise build", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn add_context(
    Path((org, incident)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] request: Request,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if let Some(response) = refuse_write(&org, &user.user_id, &request) {
            return response;
        }
        let key = match idempotency_key(request.headers()) {
            Ok(key) => key.map(str::to_owned),
            Err(response) => return response,
        };
        let body = match json_body(request).await {
            Ok(body) => body,
            Err(response) => return response,
        };
        if let Err(response) = require_permission(&org, &user.user_id, "POST").await {
            return response;
        }
        if let Err(response) = security::guard_case(&org, &user.user_id, "PUT", &incident).await {
            return response;
        }
        match service::add_context(&org, &incident, &user.user_id, key.as_deref(), body).await {
            Ok(context_id) => MetaHttpResponse::json(AddedContext { context_id }),
            Err(error) => error_response(error),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, incident, user);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/contexts",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ListIncidentContexts",
    summary = "List incident context metadata",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    responses(
        (status = 200, description = "Context metadata filtered by the caller's source access", body = [IncidentContextMetadata]),
        (status = 403, description = "Insufficient permissions"),
        (status = 404, description = "Incident not found"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/contexts",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "ListIncidentContexts",
    summary = "List incident context metadata",
    security(("Authorization" = [])),
    params(("org_id" = String, Path), ("incident_id" = String, Path)),
    responses((status = 403, description = "Incident declaration and contexts require the enterprise build", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn list_contexts(
    Path((org, incident)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] headers: HeaderMap,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if let Err(response) = authorize_read(&org, &incident, &user.user_id, &headers).await {
            return response;
        }
        match service::list_contexts(&org, &incident, &user.user_id).await {
            Ok(contexts) => MetaHttpResponse::json(contexts),
            Err(error) => error_response(error),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, incident, user);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[cfg_attr(feature = "enterprise", utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/contexts/{context_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentContext",
    summary = "Get captured incident context",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path),
        ("incident_id" = String, Path),
        ("context_id" = String, Path),
    ),
    responses(
        (status = 200, description = "Context filtered by the caller's source access", body = IncidentContextDetail),
        (status = 403, description = "Insufficient permissions"),
        (status = 404, description = "Context not found"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
#[cfg_attr(not(feature = "enterprise"), utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/contexts/{context_id}",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentContext",
    summary = "Get captured incident context",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path),
        ("incident_id" = String, Path),
        ("context_id" = String, Path),
    ),
    responses((status = 403, description = "Incident declaration and contexts require the enterprise build", body = MetaHttpResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
))]
pub async fn get_context(
    Path((org, incident, context)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] headers: HeaderMap,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if let Err(response) = authorize_read(&org, &incident, &user.user_id, &headers).await {
            return response;
        }
        match service::get_context(&org, &incident, &context, &user.user_id).await {
            Ok(context) => MetaHttpResponse::json(context),
            Err(error) => error_response(error),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org, incident, context, user);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[cfg(feature = "enterprise")]
fn refuse_write(org: &str, user: &str, request: &Request) -> Option<Response> {
    use common::meta::incidents_v2::{incidents_v2_enabled, incidents_v2_off_response};

    if !incidents_v2_enabled() {
        return Some(incidents_v2_off_response());
    }
    let delegated = request.extensions().get::<DelegatedCaller>();
    ack::is_ai_principal(org, user, delegated, request.headers()).then(|| {
        MetaHttpResponse::forbidden("Only a person can declare an incident or add a context")
    })
}

#[cfg(feature = "enterprise")]
fn idempotency_key(headers: &HeaderMap) -> Result<Option<&str>, Response> {
    let mut values = headers.get_all("Idempotency-Key").iter();
    let Some(value) = values.next() else {
        return Ok(None);
    };
    if values.next().is_some() {
        return Err(MetaHttpResponse::bad_request("Supply one Idempotency-Key"));
    }
    let key = std::str::from_utf8(value.as_bytes())
        .map_err(|_| MetaHttpResponse::bad_request("Invalid Idempotency-Key"))?;
    service::validate_key(key).map_err(error_response)?;
    Ok(Some(key))
}

#[cfg(feature = "enterprise")]
async fn json_body<T: DeserializeOwned>(request: Request) -> Result<T, Response> {
    ValidatedJson::<T>::from_request(request, &())
        .await
        .map(|ValidatedJson(body)| body)
        .map_err(IntoResponse::into_response)
}

#[cfg(feature = "enterprise")]
async fn require_permission(org: &str, user: &str, method: &str) -> Result<(), Response> {
    if openobserve_core::auth::check_permissions(
        org,
        org,
        user,
        "incidents",
        method,
        None,
        true,
        false,
        false,
    )
    .await
    {
        return Ok(());
    }
    Err(MetaHttpResponse::forbidden("Unauthorized Access"))
}

#[cfg(feature = "enterprise")]
async fn authorize_read(
    org: &str,
    incident: &str,
    user: &str,
    headers: &HeaderMap,
) -> Result<(), Response> {
    require_permission(org, user, "GET").await?;
    let caller = rca_scope::rca_caller(org, user, headers).await;
    if !rca_scope::may_read_incident(org, &caller, incident).await {
        return Err(MetaHttpResponse::forbidden(
            "This analysis cannot read that incident",
        ));
    }
    security::guard_case(org, user, "GET", incident).await
}

#[cfg(feature = "enterprise")]
fn error_response(error: DeclareError) -> Response {
    match error {
        DeclareError::BadRequest(message) => MetaHttpResponse::bad_request(message),
        DeclareError::Forbidden => MetaHttpResponse::forbidden("Unauthorized Access"),
        DeclareError::NotFound => MetaHttpResponse::not_found("Incident or context not found"),
        DeclareError::Conflict(message) => MetaHttpResponse::conflict(message),
        DeclareError::NoTeam => {
            MetaHttpResponse::error_with_header(StatusCode::UNPROCESSABLE_ENTITY, "No team to page")
        }
        DeclareError::Internal(error) => {
            log::error!("[incidents] declaration or context request failed: {error:#}");
            MetaHttpResponse::internal_error("Incident declaration or context request failed")
        }
    }
}

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Request, StatusCode, header, request::Builder},
        response::Response,
        routing::post,
    };
    use config::{
        meta::user::{SRE_AGENT_EMAIL_PREFIX, SRE_AGENT_EMAIL_SUFFIX},
        utils::delegation::SCOPE_ASSISTANT,
    };
    use o2_enterprise::enterprise::common::config::with_incidents_v2;
    use tower::ServiceExt;

    use super::*;

    const DECLARE: &str = "/acme/declare";
    const PREVIEW: &str = "/acme/declare/preview";
    const CONTEXTS: &str = "/acme/inc-1/contexts";
    const REQUEST: &str = r#"{"title":"Checkout errors","severity":"P3"}"#;

    fn app() -> Router {
        Router::new()
            .route("/{org_id}/declare", post(declare))
            .route("/{org_id}/declare/preview", post(preview))
            .route("/{org_id}/{incident_id}/contexts", post(add_context))
    }

    fn request(path: &str, user: &str, key: Option<&str>) -> Builder {
        let mut request = Request::post(path)
            .header("user_id", user)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(key) = key {
            request = request.header("Idempotency-Key", key);
        }
        request
    }

    async fn send(request: Builder, body: &str) -> Response {
        app()
            .oneshot(request.body(Body::from(body.to_owned())).unwrap())
            .await
            .unwrap()
    }

    async fn response_message(response: Response) -> String {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice::<MetaHttpResponse>(&bytes)
            .unwrap()
            .message
    }

    #[tokio::test]
    async fn declare_writes_return_409_with_v2_off() {
        for path in [DECLARE, PREVIEW, CONTEXTS] {
            let write = request(path, "alice@acme.example", None);
            let response = with_incidents_v2(false, send(write, "{invalid")).await;
            assert_eq!(response.status(), StatusCode::CONFLICT);
            assert_eq!(
                response_message(response).await,
                "Incidents v2 is off on this deployment"
            );
        }
    }

    #[tokio::test]
    async fn declare_writes_refuse_ai_principals() {
        let assistant = DelegatedCaller {
            link_id: "link".into(),
            installation_id: "install".into(),
            org: "acme".into(),
            jti: "token".into(),
            scope: SCOPE_ASSISTANT.into(),
        };
        let agent = format!("{SRE_AGENT_EMAIL_PREFIX}acme{SRE_AGENT_EMAIL_SUFFIX}");
        for path in [DECLARE, PREVIEW, CONTEXTS] {
            let person = || request(path, "alice@acme.example", Some("k"));
            for write in [
                person().extension(assistant.clone()),
                person().header("x-o2-mcp", "loopback"),
                request(path, &agent, Some("k")),
            ] {
                let response = with_incidents_v2(true, send(write, REQUEST)).await;
                assert_eq!(response.status(), StatusCode::FORBIDDEN);
                assert_eq!(
                    response_message(response).await,
                    "Only a person can declare an incident or add a context"
                );
            }
        }
    }

    #[tokio::test]
    async fn declare_rejects_extra_fields_and_requires_a_bounded_key() {
        let extra = r#"{"title":"Checkout errors","severity":"P3","extra":42}"#;
        for path in [DECLARE, PREVIEW] {
            let write = request(path, "alice@acme.example", Some("k"));
            let response = with_incidents_v2(true, send(write, extra)).await;
            assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
            assert!(
                response_message(response)
                    .await
                    .contains("unknown field `extra`")
            );
        }

        let long = "k".repeat(65);
        for key in [None, Some(""), Some(long.as_str())] {
            let write = request(DECLARE, "alice@acme.example", key);
            let response = with_incidents_v2(true, send(write, REQUEST)).await;
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert!(response_message(response).await.contains("Idempotency-Key"));
        }
    }

    #[tokio::test]
    async fn declare_without_a_team_returns_422() {
        let response = error_response(DeclareError::NoTeam);
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(response_message(response).await, "No team to page");
    }

    #[test]
    fn declare_source_denial_returns_403() {
        assert_eq!(
            error_response(DeclareError::Forbidden).status(),
            StatusCode::FORBIDDEN
        );
    }
}
