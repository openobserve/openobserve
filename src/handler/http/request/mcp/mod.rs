// Copyright 2025 OpenObserve Inc.
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

use actix_web::{HttpResponse, get, post, web};
#[cfg(feature = "enterprise")]
use {
    actix_web::HttpRequest,
    futures_util::StreamExt,
    o2_enterprise::enterprise::mcp::{
        MCPRequest, OAuthServerMetadata, handle_mcp_request, handle_mcp_request_stream,
    },
};

#[cfg(not(feature = "enterprise"))]
/// Returns a 404 response for non-enterprise builds
fn mcp_only_in_enterprise() -> actix_web::Result<HttpResponse> {
    Ok(HttpResponse::NotFound().json(serde_json::json!({
        "error": "MCP server is only available in enterprise edition"
    })))
}

/// Handler for MCP POST requests (single request/response)
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "MCP",
    operation_id = "MCPRequest",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = MCPRequest, description = "MCP request payload", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json"),
        (status = 500, description = "Internal Server Error"),
    ),
)]
#[post("/{org_id}/mcp")]
pub async fn handle_mcp_post(
    _org_id: web::Path<String>,
    web::Json(mcp_request): web::Json<MCPRequest>,
    req: HttpRequest,
) -> actix_web::Result<HttpResponse> {
    // Extract auth token from Authorization header
    let auth_token = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Check Accept header to determine response format
    let accept_header = req
        .headers()
        .get("Accept")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json");

    // Determine if client wants SSE streaming
    let wants_sse = accept_header.contains("text/event-stream");

    if wants_sse {
        // Return streaming SSE response (MCP Streamable HTTP spec)
        let stream = handle_mcp_request_stream(mcp_request, auth_token)
            .await
            .map_err(|e| actix_web::error::ErrorInternalServerError(format!("MCP error: {e}")))?;

        let actix_stream = stream.map(|result| {
            result.map_err(|e| {
                actix_web::error::ErrorInternalServerError(format!("Stream error: {e}"))
            })
        });

        Ok(HttpResponse::Ok()
            .content_type("text/event-stream")
            .insert_header(("Cache-Control", "no-cache"))
            .insert_header(("X-Accel-Buffering", "no"))
            .streaming(actix_stream))
    } else {
        // Return single JSON response (fallback for simpler clients)
        let response = handle_mcp_request(mcp_request, auth_token)
            .await
            .map_err(|e| actix_web::error::ErrorInternalServerError(format!("MCP error: {e}")))?;

        Ok(HttpResponse::Ok()
            .content_type("application/json")
            .json(response))
    }
}

/// Handler for MCP GET requests (streaming)
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "MCP",
    operation_id = "MCPRequestStream",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(content = MCPRequest, description = "MCP request payload", content_type = "application/json"),
    responses(
        (status = 200, description = "Success (Streaming)", content_type = "application/json"),
        (status = 500, description = "Internal Server Error"),
    ),
)]
#[get("/{org_id}/mcp")]
pub async fn handle_mcp_get(
    _org_id: web::Path<String>,
    // This is `Bytes` because body in HTTP GET is not defined,
    // and actix-web tends to drop JSON body.
    // This is a workaround to prevent that.
    body: web::Bytes,
    req: HttpRequest,
) -> actix_web::Result<HttpResponse> {
    // Extract auth token from Authorization header
    let auth_token = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // MCP Streamable HTTP: GET with empty body is optional
    // for server-initiated notifications. This is deprecated
    // and therefore not supported by O2
    if body.is_empty() {
        return Ok(HttpResponse::MethodNotAllowed()
            .insert_header(("Allow", "POST"))
            .json(serde_json::json!({
                "error": "GET requests must include a JSON-RPC request body. Use POST for standard requests."
            })));
    }

    // Parse JSON from body manually (GET with body is non-standard but MCP spec allows it)
    let mcp_request: MCPRequest = serde_json::from_slice(&body)
        .map_err(|e| actix_web::error::ErrorBadRequest(format!("Invalid JSON: {e}")))?;

    // Handle the request with streaming (returns SSE format)
    let stream = handle_mcp_request_stream(mcp_request, auth_token)
        .await
        .map_err(|e| actix_web::error::ErrorInternalServerError(format!("MCP error: {e}")))?;

    // Convert the stream error type to actix_web::Error
    let actix_stream = stream.map(|result| {
        result.map_err(|e| actix_web::error::ErrorInternalServerError(format!("Stream error: {e}")))
    });

    Ok(HttpResponse::Ok()
        .content_type("text/event-stream")
        .insert_header(("Cache-Control", "no-cache"))
        .insert_header(("X-Accel-Buffering", "no"))
        .streaming(actix_stream))
}

// Dummy handlers for non-enterprise builds
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
)]
#[post("/{org_id}/mcp")]
pub async fn handle_mcp_post(
    _org_id: web::Path<String>,
    _body: web::Bytes,
) -> actix_web::Result<HttpResponse> {
    mcp_only_in_enterprise()
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
)]
#[get("/{org_id}/mcp")]
pub async fn handle_mcp_get(
    _org_id: web::Path<String>,
    _body: web::Bytes,
) -> actix_web::Result<HttpResponse> {
    mcp_only_in_enterprise()
}

/// Handler for OAuth 2.0 Authorization Server Metadata (Enterprise)
/// RFC 8414: https://datatracker.ietf.org/doc/html/rfc8414
/// This endpoint provides discovery information for OAuth clients
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "MCP",
    operation_id = "OAuthServerMetadata",
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json"),
    ),
)]
#[get("/{org_id}/.well-known/oauth-authorization-server")]
pub async fn oauth_authorization_server_metadata(
    _org_id: web::Path<String>,
) -> actix_web::Result<HttpResponse> {
    use once_cell::sync::Lazy;

    static METADATA: Lazy<OAuthServerMetadata> = Lazy::new(|| {
        let dex_config = o2_dex::config::get_config();
        let base_url = dex_config.dex_url.as_str();
        OAuthServerMetadata::build(base_url)
    });
    Ok(HttpResponse::Ok()
        .content_type("application/json")
        .json(&*METADATA))
}

/// Handler for OAuth 2.0 Authorization Server Metadata (Non-Enterprise)
/// RFC 8414: https://datatracker.ietf.org/doc/html/rfc8414
/// This endpoint provides discovery information for OAuth clients
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "MCP",
    operation_id = "OAuthServerMetadata",
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 404, description = "Not Found - MCP server is only available in enterprise edition", content_type = "application/json"),
    ),
)]
#[get("/{org_id}/.well-known/oauth-authorization-server")]
pub async fn oauth_authorization_server_metadata(
    _org_id: web::Path<String>,
) -> actix_web::Result<HttpResponse> {
    mcp_only_in_enterprise()
}
