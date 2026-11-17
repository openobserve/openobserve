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

//! The org's paging opt-in (R5): whether a stopped stream opens an incident and pages on-call.

use axum::{
    Json,
    body::Bytes,
    extract::{Path, RawQuery},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use o2_enterprise::enterprise::autoobserve::{paging_settings, plugins::stream::StreamPager};
use serde::Deserialize;
use utoipa::ToSchema;

use super::{deployment_disabled, serve};
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// The web shows `message` beside the disabled toggle and keys on `error`.
pub const UNAVAILABLE_ERROR: &str = "paging_unavailable";
pub const UNAVAILABLE_MESSAGE: &str = "Paging is turned off for this deployment.";

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PagingBody {
    pub page_on_stop: bool,
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoobserve/settings/paging",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveGetPagingSettings",
    summary = "Read whether AutoObserve pages for this organization",
    description = "`page_on_stop` says whether a stream that stops sending data opens an incident and pages on-call through the organization's routing rules. It is off until someone turns it on. `available` says whether this deployment lets AutoObserve page at all (`O2_AUTOOBSERVE_PAGING_ENABLED`); while it is false nothing pages, whatever the organization chose.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_paging_settings(Path(org_id): Path<String>) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let deployment = StreamPager::shipped().is_some();
    serve(|deps| async move { Ok(paging_settings::get_paging(&deps, &org_id, deployment).await) })
        .await
}

#[utoipa::path(
    put,
    path = "/v2/{org_id}/autoobserve/settings/paging",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObservePutPagingSettings",
    summary = "Turn AutoObserve paging on or off for this organization",
    description = "With `page_on_stop` true, a stream that stops sending data opens an incident and pages on-call: an ownership rule on the stream's service picks the team, otherwise the organization's default team, otherwise it waits on the unrouted queue. Streams that stop together share one incident and one page. Needs the permission that changes on-call routing.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(PagingBody), content_type = "application/json"),
    responses(
        (status = 200, description = "The setting as stored", content_type = "application/json", body = Object),
        (status = 400, description = "A query string or an invalid body", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 409, description = "Paging is turned off for this deployment: `{error: \"paging_unavailable\", message}`", content_type = "application/json", body = Object),
        (status = 500, description = "The write failed", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn put_paging_settings(
    Path(org_id): Path<String>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    if query.as_deref().is_some_and(|q| !q.is_empty()) {
        return MetaHttpResponse::bad_request("a paging settings PUT takes no query string");
    }
    let body: PagingBody = match serde_json::from_slice(&body) {
        Ok(body) => body,
        Err(e) => return MetaHttpResponse::bad_request(format!("invalid paging body: {e}")),
    };
    if StreamPager::shipped().is_none() {
        return unavailable();
    }
    serve(|deps| async move {
        paging_settings::put_paging(&deps, &org_id, body.page_on_stop, true).await
    })
    .await
}

/// A save the deployment would ignore is refused, so the org never believes it pages.
fn unavailable() -> Response {
    let body = serde_json::json!({"error": UNAVAILABLE_ERROR, "message": UNAVAILABLE_MESSAGE});
    (StatusCode::CONFLICT, Json(body)).into_response()
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        routing,
    };
    use tower::ServiceExt;

    use super::*;

    async fn send(method: &str, uri: &str, body: &str) -> (StatusCode, String) {
        let app = Router::new().route(
            "/v2/{org_id}/autoobserve/settings/paging",
            routing::get(get_paging_settings).put(put_paging_settings),
        );
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn a_put_refuses_a_bad_body_or_a_query_before_the_engine_is_asked() {
        super::super::tests::ENGINE_ON.with(|on| on.set(Some(true)));
        let uri = "/v2/o/autoobserve/settings/paging";
        for body in [
            "",
            "{}",
            r#"{"page_on_stop":"yes"}"#,
            r#"{"page_on_stop":true,"x":1}"#,
        ] {
            let (status, text) = send("PUT", uri, body).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {text}");
            assert!(text.contains("invalid paging body"), "{body}: {text}");
        }
        let (status, _) = send("PUT", &format!("{uri}?x=1"), r#"{"page_on_stop":true}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let (status, text) = send("PUT", uri, r#"{"page_on_stop":true}"#).await;
        assert_eq!(
            status,
            StatusCode::CONFLICT,
            "paging is off by default: {text}"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&text).unwrap(),
            serde_json::json!({
                "error": "paging_unavailable",
                "message": "Paging is turned off for this deployment."
            })
        );
        super::super::tests::ENGINE_ON.with(|on| on.set(Some(false)));
        for method in ["GET", "PUT"] {
            let (status, _) = send(method, uri, r#"{"page_on_stop":true}"#).await;
            assert_eq!(
                status,
                StatusCode::NOT_FOUND,
                "{method} on a switched-off deployment"
            );
        }
    }
}
