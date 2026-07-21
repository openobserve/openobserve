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

use anyhow::Result;
use bytes::Bytes;
use futures_util::stream::{self, Stream};
use serde::Serialize;

use super::{
    protocol::route_request,
    types::{MCPRequest, MCPResponse},
};

/// OAuth 2.0 Authorization Server Metadata
/// Based on RFC 8414
#[derive(Debug, Serialize)]
pub struct OAuthServerMetadata {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub response_types_supported: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grant_types_supported: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scopes_supported: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_endpoint_auth_methods_supported: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jwks_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_authorization_endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_challenge_methods_supported: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registration_endpoint: Option<String>,
}

impl OAuthServerMetadata {
    /// Build OAuth 2.0 Authorization Server Metadata for enterprise edition
    /// RFC 8414: https://datatracker.ietf.org/doc/html/rfc8414
    pub fn build(base_url: &str) -> Self {
        Self {
            issuer: base_url.to_string(),
            authorization_endpoint: format!("{base_url}/auth"),
            token_endpoint: format!("{base_url}/token"),
            response_types_supported: vec!["code".to_string()],
            grant_types_supported: Some(vec![
                "authorization_code".to_string(),
                "refresh_token".to_string(),
                "urn:ietf:params:oauth:grant-type:device_code".to_string(),
            ]),
            scopes_supported: Some(vec![
                "openid".to_string(),
                "email".to_string(),
                "groups".to_string(),
                "profile".to_string(),
                "offline_access".to_string(),
            ]),
            token_endpoint_auth_methods_supported: Some(vec![
                "client_secret_basic".to_string(),
                "client_secret_post".to_string(),
            ]),
            jwks_uri: Some(format!("{base_url}/keys")),
            device_authorization_endpoint: Some(format!("{base_url}/device/code")),
            code_challenge_methods_supported: Some(vec!["S256".to_string(), "plain".to_string()]),
            registration_endpoint: Some(format!("{base_url}/register")),
        }
    }
}

/// OAuth 2.0 Protected Resource Metadata
/// RFC 9728: https://datatracker.ietf.org/doc/html/rfc9728
#[derive(Debug, Serialize)]
pub struct OAuthProtectedResourceMetadata {
    pub resource: String,
    pub authorization_servers: Vec<String>,
    pub scopes_supported: Vec<String>,
    pub bearer_methods_supported: Vec<String>,
}

impl OAuthProtectedResourceMetadata {
    /// Build RFC 9728 metadata: this MCP resource + the Dex auth server that guards it.
    pub fn build(resource: &str, authorization_server: &str) -> Self {
        Self {
            resource: resource.to_string(),
            authorization_servers: vec![authorization_server.to_string()],
            scopes_supported: vec![
                "openid".to_string(),
                "email".to_string(),
                "groups".to_string(),
                "profile".to_string(),
                "offline_access".to_string(),
            ],
            bearer_methods_supported: vec!["header".to_string()],
        }
    }
}

/// Handle a single MCP request (non-streaming)
pub async fn handle_mcp_request(
    request: MCPRequest,
    auth_token: Option<String>,
) -> Result<MCPResponse> {
    route_request(request, auth_token).await
}

/// Handle an MCP request with streaming response
/// This returns a stream of SSE-formatted JSON-RPC responses
pub async fn handle_mcp_request_stream(
    request: MCPRequest,
    auth_token: Option<String>,
) -> Result<impl Stream<Item = Result<Bytes>>> {
    // Process the request
    let response = route_request(request, auth_token).await?;

    // Serialize to JSON
    let json_str = serde_json::to_string(&response)?;

    // Format as SSE event: "data: {json}\n\n"
    // MCP Streamable HTTP expects SSE format for streamed responses
    let sse_data = format!("data: {json_str}\n\n");

    // Create a single-item stream with SSE-formatted data
    Ok(stream::once(async move { Ok(Bytes::from(sse_data)) }))
}

#[cfg(test)]
mod tests {
    use futures_util::{StreamExt, pin_mut};
    use serde_json::json;

    use super::*;
    use crate::tools;

    #[tokio::test]
    async fn test_handle_mcp_request_ping() {
        let request = MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            method: "ping".to_string(),
            params: json!(null),
        };

        let result = handle_mcp_request(request, None).await;
        assert!(result.is_ok());

        let response = result.unwrap();
        assert_eq!(response.jsonrpc, "2.0");
        assert!(response.error.is_none());
    }

    #[tokio::test]
    async fn test_handle_mcp_request_initialize() {
        let request = MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(2)),
            method: "initialize".to_string(),
            params: json!(null),
        };

        let result = handle_mcp_request(request, None).await;
        assert!(result.is_ok());

        let response = result.unwrap();
        assert_eq!(response.jsonrpc, "2.0");
        assert!(response.result.is_some());
    }

    #[tokio::test]
    async fn test_handle_mcp_request_with_auth() {
        let request = MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(3)),
            method: "ping".to_string(),
            params: json!(null),
        };

        let result = handle_mcp_request(request, Some("test_token".to_string())).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_mcp_request_invalid_method() {
        let request = MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(4)),
            method: "invalid_method".to_string(),
            params: json!(null),
        };

        let result = handle_mcp_request(request, None).await;
        assert!(result.is_ok());

        let response = result.unwrap();
        assert!(response.error.is_some());
    }

    #[tokio::test]
    async fn test_handle_mcp_request_stream_basic() {
        let request = MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            method: "ping".to_string(),
            params: json!(null),
        };

        let result = handle_mcp_request_stream(request, None).await;
        assert!(result.is_ok());

        let stream = result.unwrap();
        pin_mut!(stream);
        let item = stream.next().await;
        assert!(item.is_some());

        let bytes = item.unwrap();
        assert!(bytes.is_ok());

        let data = bytes.unwrap();
        let data_str = String::from_utf8(data.to_vec()).unwrap();
        assert!(data_str.starts_with("data: "));
        assert!(data_str.ends_with("\n\n"));
    }

    #[tokio::test]
    async fn test_handle_mcp_request_stream_sse_format() {
        let request = MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(2)),
            method: "initialize".to_string(),
            params: json!(null),
        };

        let result = handle_mcp_request_stream(request, None).await;
        assert!(result.is_ok());

        let stream = result.unwrap();
        pin_mut!(stream);
        let item = stream.next().await;
        assert!(item.is_some());

        let bytes = item.unwrap().unwrap();
        let data_str = String::from_utf8(bytes.to_vec()).unwrap();

        // Verify SSE format
        assert!(data_str.starts_with("data: "));
        assert!(data_str.contains("\"jsonrpc\":\"2.0\""));
        assert!(data_str.ends_with("\n\n"));
    }

    #[tokio::test]
    async fn test_handle_mcp_request_stream_with_auth() {
        let request = MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(3)),
            method: "ping".to_string(),
            params: json!(null),
        };

        let result = handle_mcp_request_stream(request, Some("auth_token".to_string())).await;
        assert!(result.is_ok());

        let stream = result.unwrap();
        pin_mut!(stream);
        let item = stream.next().await;
        assert!(item.is_some());
    }

    #[tokio::test]
    async fn test_handle_mcp_request_stream_single_item() {
        let request = MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(4)),
            method: "ping".to_string(),
            params: json!(null),
        };

        let result = handle_mcp_request_stream(request, None).await;
        assert!(result.is_ok());

        let stream = result.unwrap();
        pin_mut!(stream);

        // Should have exactly one item
        let first = stream.next().await;
        assert!(first.is_some());

        // Should not have a second item
        let second = stream.next().await;
        assert!(second.is_none());
    }

    #[tokio::test]
    async fn test_handle_mcp_request_stream_contains_response_id() {
        let request = MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(42)),
            method: "ping".to_string(),
            params: json!(null),
        };

        let result = handle_mcp_request_stream(request, None).await;
        assert!(result.is_ok());

        let stream = result.unwrap();
        pin_mut!(stream);
        let item = stream.next().await.unwrap().unwrap();
        let data_str = String::from_utf8(item.to_vec()).unwrap();

        // Response should contain the same ID
        assert!(data_str.contains("\"id\":42"));
    }

    #[tokio::test]
    async fn test_handle_mcp_request_tools_list() {
        // Initialize MCP tools before testing
        tools::init_test_tools().await;

        let request = MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(5)),
            method: "tools/list".to_string(),
            params: json!(null),
        };

        let result = handle_mcp_request(request, None).await;
        assert!(result.is_ok());

        let response = result.unwrap();
        assert!(response.result.is_some());
    }

    #[tokio::test]
    async fn test_handle_mcp_request_stream_invalid_method() {
        let request = MCPRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(6)),
            method: "nonexistent_method".to_string(),
            params: json!(null),
        };

        let result = handle_mcp_request_stream(request, None).await;
        assert!(result.is_ok());

        let stream = result.unwrap();
        pin_mut!(stream);
        let item = stream.next().await.unwrap().unwrap();
        let data_str = String::from_utf8(item.to_vec()).unwrap();

        // Should contain error in response
        assert!(data_str.contains("error"));
    }

    #[test]
    fn protected_resource_metadata_build_shape() {
        let m = OAuthProtectedResourceMetadata::build(
            "http://localhost:5080/api/default/mcp",
            "http://localhost:5556/dex",
        );
        let v = serde_json::to_value(&m).unwrap();
        assert_eq!(v["resource"], "http://localhost:5080/api/default/mcp");
        assert_eq!(v["authorization_servers"][0], "http://localhost:5556/dex");
        assert_eq!(v["bearer_methods_supported"][0], "header");
        assert!(v["scopes_supported"].as_array().unwrap().contains(&serde_json::json!("openid")));
    }
}
