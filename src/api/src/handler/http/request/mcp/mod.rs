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

use axum::{
    Json,
    body::{Body, Bytes},
    extract::Path,
    http::{HeaderMap, StatusCode, header},
    response::Response,
};
use futures_util::StreamExt;
use openobserve_mcp::{
    MCP_PROTOCOL_VERSION, MCPRequest, handle_mcp_request, handle_mcp_request_stream,
};
#[cfg(feature = "enterprise")]
use openobserve_mcp::{OAuthProtectedResourceMetadata, OAuthServerMetadata};

/// MCP protocol version header name (MCP 2025-11-25)
const MCP_PROTOCOL_VERSION_HEADER: &str = "MCP-Protocol-Version";

/// Handler for MCP POST requests (single request/response)
///
/// Per MCP 2025-11-25 (Streamable HTTP transport):
/// - Requests with `id` → 200 with JSON or SSE response
/// - Notifications (no `id`) → 202 Accepted, no body
/// - Validates `MCP-Protocol-Version` header on non-initialize requests
#[utoipa::path(
    post,
    path = "/{org_id}/mcp",
    context_path = "/api",
    tag = "MCP",
    operation_id = "MCPRequest",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(MCPRequest), description = "MCP request payload", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json"),
        (status = 202, description = "Accepted (notification, no response body)"),
        (status = 400, description = "Bad Request (unsupported protocol version)"),
        (status = 500, description = "Internal Server Error"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "mcp", "operation": "post"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn handle_mcp_post(
    Path(_org_id): Path<String>,
    headers: HeaderMap,
    Json(mcp_request): Json<MCPRequest>,
) -> Response {
    // Extract auth token from Authorization header
    let auth_token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Per MCP 2025-11-25: validate MCP-Protocol-Version header on all
    // requests after initialization (initialize itself won't have it yet).
    if mcp_request.method != "initialize"
        && let Some(client_version) = headers
            .get(MCP_PROTOCOL_VERSION_HEADER)
            .and_then(|v| v.to_str().ok())
        && client_version != MCP_PROTOCOL_VERSION
    {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(format!(
                "{{\"error\": \"Unsupported MCP protocol version '{}', expected '{}'\"}}",
                client_version, MCP_PROTOCOL_VERSION
            )))
            .unwrap();
    }

    // Per MCP 2025-11-25: JSON-RPC notifications (no `id`) require HTTP 202,
    // no response body. Process the notification but return 202.
    if mcp_request.id.is_none() && mcp_request.method != "initialize" {
        // Fire-and-forget: process notification asynchronously, don't wait
        let _ = handle_mcp_request(mcp_request, auth_token).await;
        return Response::builder()
            .status(StatusCode::ACCEPTED)
            .body(Body::empty())
            .unwrap();
    }

    // Check Accept header to determine response format
    let accept_header = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json");

    // Determine if client wants SSE streaming
    let wants_sse = accept_header.contains("text/event-stream");

    if wants_sse {
        // Return streaming SSE response (MCP Streamable HTTP spec)
        let stream = match handle_mcp_request_stream(mcp_request, auth_token).await {
            Ok(s) => s,
            Err(e) => {
                return Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!("{{\"error\": \"MCP error: {}\"}}", e)))
                    .unwrap();
            }
        };

        let body_stream =
            stream.map(|result| result.map_err(|e| std::io::Error::other(e.to_string())));

        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/event-stream")
            .header(header::CACHE_CONTROL, "no-cache")
            .header("X-Accel-Buffering", "no")
            .body(Body::from_stream(body_stream))
            .unwrap()
    } else {
        // Return single JSON response (fallback for simpler clients)
        let response = match handle_mcp_request(mcp_request, auth_token).await {
            Ok(r) => r,
            Err(e) => {
                log::error!("MCP handle_mcp_request error: {e}");
                return Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!("{{\"error\": \"MCP error: {}\"}}", e)))
                    .unwrap();
            }
        };

        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_string(&response).unwrap()))
            .unwrap()
    }
}

/// Handler for MCP DELETE requests — session termination (MCP 2025-11-25)
///
/// Clients may DELETE the MCP endpoint to explicitly terminate a session.
/// Since O2 MCP is stateless, this always succeeds.
#[utoipa::path(
    delete,
    path = "/{org_id}/mcp",
    context_path = "/api",
    tag = "MCP",
    operation_id = "MCPSessionDelete",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 204, description = "Session terminated"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn handle_mcp_delete(Path(_org_id): Path<String>) -> Response {
    // O2 MCP is stateless — no session state to clean up.
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(Body::empty())
        .unwrap()
}

/// Handler for MCP GET requests (streaming)
#[utoipa::path(
    post,
    path = "/{org_id}/mcp",
    context_path = "/api",
    tag = "MCP",
    operation_id = "MCPRequestStream",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = inline(MCPRequest), description = "MCP request payload", content_type = "application/json"),
    responses(
        (status = 200, description = "Success (Streaming)", content_type = "application/json"),
        (status = 500, description = "Internal Server Error"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "mcp", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn handle_mcp_get(
    Path(_org_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // Extract auth token from Authorization header
    let auth_token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // MCP Streamable HTTP: a GET with empty body opens the server->client SSE
    // channel for server-initiated notifications. O2 never pushes
    // notifications, but per spec this channel MUST stay open — returning a
    // stream that ends immediately makes MCP clients (e.g. opencode) treat the
    // channel as dropped and reconnect in a tight ~1/sec loop. Hold the
    // connection open and emit a periodic keepalive comment until the client
    // disconnects (axum drops the stream on disconnect).
    if body.is_empty() {
        const MCP_SSE_KEEPALIVE_SECS: u64 = 30;
        // ": ...\n\n" is an SSE comment — ignored by clients, just keeps the
        // socket warm. An initial comment confirms the stream is live.
        let initial = futures_util::stream::once(async {
            Ok::<_, std::io::Error>(Bytes::from(": connected\n\n"))
        });
        let keepalive = futures_util::stream::unfold((), |_| async {
            tokio::time::sleep(std::time::Duration::from_secs(MCP_SSE_KEEPALIVE_SECS)).await;
            Some((Ok::<_, std::io::Error>(Bytes::from(": keepalive\n\n")), ()))
        });
        let body_stream = initial.chain(keepalive);
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/event-stream")
            .header(header::CACHE_CONTROL, "no-cache")
            .header("X-Accel-Buffering", "no")
            .body(Body::from_stream(body_stream))
            .unwrap();
    }

    // Parse JSON from body manually (GET with body is non-standard but MCP spec allows it)
    let mcp_request: MCPRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    "{{\"error\": \"Invalid JSON: {}\"}}",
                    e
                )))
                .unwrap();
        }
    };

    // Handle the request with streaming (returns SSE format)
    let stream = match handle_mcp_request_stream(mcp_request, auth_token).await {
        Ok(s) => s,
        Err(e) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!("{{\"error\": \"MCP error: {}\"}}", e)))
                .unwrap();
        }
    };

    let body_stream = stream.map(|result| result.map_err(|e| std::io::Error::other(e.to_string())));

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Accel-Buffering", "no")
        .body(Body::from_stream(body_stream))
        .unwrap()
}

/// Handler for OAuth 2.0 Authorization Server Metadata (Enterprise)
/// RFC 8414: https://datatracker.ietf.org/doc/html/rfc8414
/// This endpoint provides discovery information for OAuth clients
/// Must be publicly accessible (no auth) per OAuth spec
#[cfg(feature = "enterprise")]
#[utoipa::path(
    post,
    path = "/.well-known/oauth-authorization-server",
    context_path = "",
    tag = "MCP",
    operation_id = "OAuthServerMetadata",
    responses(
        (status = 200, description = "Success", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn oauth_authorization_server_metadata() -> Response {
    use std::sync::LazyLock as Lazy;

    static METADATA: Lazy<OAuthServerMetadata> = Lazy::new(|| {
        let dex_config = o2_dex::config::get_config();
        let base_url = dex_config.dex_url.as_str();
        OAuthServerMetadata::build(base_url)
    });
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_string(&*METADATA).unwrap()))
        .unwrap()
}

/// Handler for OAuth 2.0 Authorization Server Metadata (Non-Enterprise)
/// RFC 8414: https://datatracker.ietf.org/doc/html/rfc8414
/// This endpoint provides discovery information for OAuth clients
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    post,
    path = "/.well-known/oauth-authorization-server",
    context_path = "",
    tag = "MCP",
    operation_id = "OAuthServerMetadata",
    responses(
        (status = 404, description = "Not Found - OAuth discovery is only available in enterprise edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn oauth_authorization_server_metadata() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!({
                "error": "OAuth discovery is only available in enterprise edition"
            }))
            .unwrap(),
        ))
        .unwrap()
}

/// Extract the org id from an RFC 9728 resource path of the form
/// `api/{org_id}/mcp`, returning `None` for any other shape.
///
/// The org id must be an opaque alphanumeric token: the value is echoed back in
/// the metadata document (and, for the 401 challenge, into a quoted header
/// parameter), so anything else is rejected rather than escaped.
#[cfg(any(feature = "enterprise", test))]
fn parse_mcp_resource_org(resource_path: &str) -> Option<&str> {
    let mut segments = resource_path.trim_matches('/').split('/');
    if segments.next()? != "api" {
        return None;
    }
    let org_id = segments.next()?;
    if segments.next()? != "mcp" || segments.next().is_some() {
        return None;
    }
    let valid = !org_id.is_empty()
        && org_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'));
    valid.then_some(org_id)
}

/// Handler for OAuth 2.0 Protected Resource Metadata (Enterprise)
/// RFC 9728: https://datatracker.ietf.org/doc/html/rfc9728
/// Public (no auth) — points MCP clients at the Dex authorization server.
#[cfg(feature = "enterprise")]
#[utoipa::path(
    get,
    path = "/.well-known/oauth-protected-resource/{resource_path}",
    context_path = "",
    tag = "MCP",
    operation_id = "OAuthProtectedResourceMetadata",
    responses((status = 200, description = "Success", content_type = "application/json")),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn oauth_protected_resource_metadata(Path(resource_path): Path<String>) -> Response {
    let dex_config = o2_dex::config::get_config();
    // Without Dex there is no authorization server to point clients at, and
    // RFC 9728 requires `authorization_servers` to name at least one. Advertising
    // a disabled Dex would send clients into a flow that cannot complete, so
    // report that no OAuth-protected resource metadata exists — matching the
    // 401 challenge, which is likewise suppressed when Dex is off.
    if !dex_config.dex_enabled {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_string(&serde_json::json!({
                    "error": "OAuth discovery requires Dex to be enabled"
                }))
                .unwrap(),
            ))
            .unwrap();
    }

    let cfg = config::get_config();
    let o2_base = format!("{}{}", cfg.common.web_url, cfg.common.base_uri);
    let o2_base = o2_base.trim_end_matches('/');

    // `resource_path` is the RFC 9728 §3.1 suffix and is fully caller-controlled.
    // It is echoed into `resource`, which clients use as the RFC 8707 audience,
    // so reconstruct it from a recognised `api/{org}/mcp` shape instead of
    // reflecting arbitrary text. Anything else describes no resource we serve.
    let resource = match parse_mcp_resource_org(&resource_path) {
        Some(org) => format!("{o2_base}/api/{org}/mcp"),
        // Bare-root probe (empty suffix): advertise the deployment itself.
        None if resource_path.trim_matches('/').is_empty() => o2_base.to_string(),
        None => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_string(&serde_json::json!({
                        "error": "no protected resource metadata for that path"
                    }))
                    .unwrap(),
                ))
                .unwrap();
        }
    };

    let auth_server = dex_config.dex_url.clone();

    let metadata = OAuthProtectedResourceMetadata::build(&resource, &auth_server);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_string(&metadata).unwrap()))
        .unwrap()
}

/// Handler for OAuth 2.0 Protected Resource Metadata (Non-Enterprise)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/.well-known/oauth-protected-resource/{resource_path}",
    context_path = "",
    tag = "MCP",
    operation_id = "OAuthProtectedResourceMetadata",
    responses((status = 404, description = "Not Found - enterprise only", content_type = "application/json")),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn oauth_protected_resource_metadata(Path(_resource_path): Path<String>) -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!({
                "error": "OAuth discovery is only available in enterprise edition"
            }))
            .unwrap(),
        ))
        .unwrap()
}

/// Bare-root probe: some clients GET `/.well-known/oauth-protected-resource` with no suffix.
/// Delegates with an empty resource path (resource then = the O2 base + "/").
#[cfg(feature = "enterprise")]
pub async fn oauth_protected_resource_metadata_root() -> Response {
    oauth_protected_resource_metadata(Path(String::new())).await
}

#[cfg(not(feature = "enterprise"))]
pub async fn oauth_protected_resource_metadata_root() -> Response {
    oauth_protected_resource_metadata(Path(String::new())).await
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use utoipa::OpenApi;

    use super::*;

    fn ping_request() -> MCPRequest {
        MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            method: "ping".to_string(),
            params: Value::Null,
        }
    }

    #[tokio::test]
    async fn post_ping_is_available() {
        let response = handle_mcp_post(
            Path("default".to_string()),
            HeaderMap::new(),
            Json(ping_request()),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn post_rejects_unsupported_protocol_version() {
        let mut headers = HeaderMap::new();
        headers.insert(MCP_PROTOCOL_VERSION_HEADER, "unsupported".parse().unwrap());

        let response =
            handle_mcp_post(Path("default".to_string()), headers, Json(ping_request())).await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn delete_session_is_available() {
        let response = handle_mcp_delete(Path("default".to_string())).await;

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[test]
    fn oss_openapi_initializes_mcp_tools() {
        let api = crate::handler::http::router::openapi::ApiDoc::openapi();

        openobserve_mcp::tools::init_mcp_tools(&api).unwrap();

        assert!(!openobserve_mcp::tools::get_mcp_tools().is_empty());
    }

    #[test]
    fn parse_mcp_resource_org_accepts_only_the_mcp_shape() {
        assert_eq!(parse_mcp_resource_org("api/default/mcp"), Some("default"));
        assert_eq!(parse_mcp_resource_org("/api/default/mcp/"), Some("default"));
        assert_eq!(
            parse_mcp_resource_org("api/3GjLqZseGw8M8qmh6zEx7dgGUTY/mcp"),
            Some("3GjLqZseGw8M8qmh6zEx7dgGUTY")
        );

        // Anything that is not exactly `api/{org}/mcp`, or whose org is not an
        // opaque token, describes no resource we serve.
        for bad in [
            "",
            "api/default",
            "api/default/mcp/extra",
            "other/default/mcp",
            "api//mcp",
            "https://evil.com/mcp",
            "api/https://evil.com/mcp",
            "api/../../evil/mcp",
            r#"api/x",Basic,realm="phish/mcp"#,
            "api/e vil/mcp",
        ] {
            assert_eq!(parse_mcp_resource_org(bad), None, "should reject {bad:?}");
        }
    }

    #[tokio::test]
    async fn protected_resource_metadata_responds() {
        let response = oauth_protected_resource_metadata(Path("api/default/mcp".to_string())).await;
        // Enterprise: 200; OSS build: 404. Either is a valid, non-panicking response.
        assert!(response.status() == StatusCode::OK || response.status() == StatusCode::NOT_FOUND);
    }
}
