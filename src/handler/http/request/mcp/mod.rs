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
    body::{Body, Bytes},
    extract::Path,
    http::{StatusCode, header},
    response::Response,
};
#[cfg(feature = "enterprise")]
use {
    axum::{Json, http::HeaderMap},
    futures_util::StreamExt,
    o2_enterprise::enterprise::ai::mcp::{
        MCPRequest, OAuthServerMetadata, handle_mcp_request, handle_mcp_request_stream,
    },
};

#[cfg(not(feature = "enterprise"))]
/// Returns a 404 response for non-enterprise builds
fn mcp_only_in_enterprise() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!({
                "error": "MCP server is only available in enterprise edition"
            }))
            .unwrap(),
        ))
        .unwrap()
}

/// Handler for MCP POST requests (single request/response)
#[cfg(feature = "enterprise")]
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

/// Handler for MCP GET requests (streaming)
#[cfg(feature = "enterprise")]
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

    // MCP Streamable HTTP: GET with empty body is for server-initiated
    // notifications (SSE streaming). O2 doesn't push notifications, so
    // return an empty SSE stream that immediately ends gracefully.
    // This prevents 405 errors from breaking MCP clients.
    if body.is_empty() {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/event-stream")
            .header(header::CACHE_CONTROL, "no-cache")
            .header("X-Accel-Buffering", "no")
            .body(Body::from("event: close\ndata: {}\n\n"))
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

// Dummy handlers for non-enterprise builds
#[cfg(not(feature = "enterprise"))]
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
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = Object, description = "MCP request payload", content_type = "application/json"),
    responses(
        (status = 404, description = "Not Found - MCP server is only available in enterprise edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "mcp", "operation": "post"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn handle_mcp_post(Path(_org_id): Path<String>, _body: Bytes) -> Response {
    mcp_only_in_enterprise()
}

#[cfg(not(feature = "enterprise"))]
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
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = Object, description = "MCP request payload", content_type = "application/json"),
    responses(
        (status = 404, description = "Not Found - MCP server is only available in enterprise edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "mcp", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn handle_mcp_get(Path(_org_id): Path<String>, _body: Bytes) -> Response {
    mcp_only_in_enterprise()
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
    use once_cell::sync::Lazy;

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
        (status = 404, description = "Not Found - MCP server is only available in enterprise edition", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn oauth_authorization_server_metadata() -> Response {
    mcp_only_in_enterprise()
}
