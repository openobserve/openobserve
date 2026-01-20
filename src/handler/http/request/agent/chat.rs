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
use axum::body::Body;
#[cfg(feature = "enterprise")]
use axum::http::HeaderMap;
use axum::{Json, extract::Path, http::StatusCode, response::Response};
// Re-export enterprise types for OpenAPI and route handlers
#[cfg(feature = "enterprise")]
pub use o2_enterprise::enterprise::alerts::rca_agent::{
    AgentChatRequest, ChatMessage, get_agent_client, init_agent_client,
};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

// Stub types for non-enterprise builds (for compilation and OpenAPI generation)
#[cfg(not(feature = "enterprise"))]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct AgentChatRequest {
    pub agent_type: String,
    pub message: String,
    #[serde(default)]
    pub context: serde_json::Value,
    #[serde(default)]
    pub history: Vec<ChatMessage>,
}

#[cfg(not(feature = "enterprise"))]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[cfg(not(feature = "enterprise"))]
pub fn init_agent_client() -> Result<(), String> {
    Ok(())
}

/// Non-streaming agent chat endpoint
#[utoipa::path(
    post,
    path = "/{org_id}/agent/chat",
    context_path = "/api",
    tag = "Agents",
    operation_id = "AgentChat",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(
        content = AgentChatRequest,
        description = "Agent chat request with message, context, and history",
        example = json!({
            "agent_type": "sre",
            "message": "Why is CPU usage spiking?",
            "context": {
                "org_id": "default",
                "alert_id": "cpu_high",
                "incident_id": "2NxGKpQz8Hy4..."
            },
            "history": [
                {"role": "user", "content": "What's happening?"},
                {"role": "assistant", "content": "I see high CPU usage..."}
            ]
        })
    ),
    responses(
        (status = StatusCode::OK, description = "Agent response", body = serde_json::Value),
        (status = StatusCode::BAD_REQUEST, description = "Agent not enabled"),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Failed to query agent"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn agent_chat(
    Path(_org_id): Path<String>,
    #[cfg(feature = "enterprise")] headers: HeaderMap,
    #[allow(unused_variables)] Json(req): Json<AgentChatRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use config::get_config;
        use o2_enterprise::enterprise::{
            alerts::rca_agent::{QueryRequest, RcaAgentClient},
            common::config::get_config as get_o2_config,
        };

        // Get O2 config
        let o2_config = get_o2_config();

        // Check if agent is enabled
        if !o2_config.incidents.rca_enabled || o2_config.incidents.rca_agent_url.is_empty() {
            return MetaHttpResponse::bad_request("Agent chat not enabled");
        }

        // Extract user token from Authorization header for per-user MCP auth
        let user_token = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.strip_prefix("Basic "))
            .map(|s| s.to_string());

        // Create agent client
        let zo_config = get_config();
        let client = match RcaAgentClient::new(
            &o2_config.incidents.rca_agent_url,
            &zo_config.auth.root_user_email,
            &zo_config.auth.root_user_password,
        ) {
            Ok(c) => c,
            Err(e) => {
                return MetaHttpResponse::internal_error(format!(
                    "Failed to create agent client: {e}"
                ));
            }
        };

        // Build query request with user token for per-user MCP authentication
        let query_req = QueryRequest {
            query: req.message,
            context: req.context,
            model: None,
            history: if req.history.is_empty() {
                None
            } else {
                Some(
                    req.history
                        .iter()
                        .map(|msg| {
                            serde_json::json!({
                                "role": msg.role,
                                "content": msg.content
                            })
                        })
                        .collect(),
                )
            },
            user_token,
        };

        // Query agent
        match client.query(&req.agent_type, query_req).await {
            Ok(response) => MetaHttpResponse::json(response),
            Err(e) => MetaHttpResponse::internal_error(format!("Agent query failed: {e}")),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        MetaHttpResponse::bad_request("Agent chat is only available in enterprise version")
    }
}

/// Streaming agent chat endpoint (SSE)
#[utoipa::path(
    post,
    path = "/{org_id}/agent/chat/stream",
    context_path = "/api",
    tag = "Agents",
    operation_id = "AgentChatStream",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization ID"),
    ),
    request_body(
        content = AgentChatRequest,
        description = "Agent chat request for streaming response",
    ),
    responses(
        (status = StatusCode::OK, description = "SSE stream of agent response", content_type = "text/event-stream"),
        (status = StatusCode::BAD_REQUEST, description = "Agent not enabled"),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Failed to query agent"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn agent_chat_stream(
    Path(_org_id): Path<String>,
    #[cfg(feature = "enterprise")] headers: HeaderMap,
    #[allow(unused_variables)] Json(req): Json<AgentChatRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use async_stream::stream;
        use futures::StreamExt;
        use o2_enterprise::enterprise::alerts::rca_agent::QueryRequest;

        // Get global agent client (connection pooling)
        let client = match get_agent_client() {
            Some(c) => c,
            None => {
                return MetaHttpResponse::bad_request("Agent chat not enabled");
            }
        };

        // Extract user token from Authorization header for per-user MCP auth
        let user_token = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.strip_prefix("Basic "))
            .map(|s| s.to_string());

        // Build query request with user token for per-user MCP authentication
        let query_req = QueryRequest {
            query: req.message,
            context: req.context,
            model: None,
            history: if req.history.is_empty() {
                None
            } else {
                Some(
                    req.history
                        .iter()
                        .map(|msg| {
                            serde_json::json!({
                                "role": msg.role,
                                "content": msg.content
                            })
                        })
                        .collect(),
                )
            },
            user_token,
        };

        // Create streaming response with immediate feedback
        let agent_type = req.agent_type.clone();
        let s = stream! {
            // Send immediate status event BEFORE calling agent service
            let status_event = serde_json::json!({
                "role": "assistant",
                "content": "",
                "status": "processing"
            });
            yield Ok::<bytes::Bytes, std::io::Error>(bytes::Bytes::from(format!("data: {}\n\n", status_event)));

            // Now call the external agent service
            let response = match client.query_stream(&agent_type, query_req).await {
                Ok(r) => r,
                Err(e) => {
                    let error_event = serde_json::json!({
                        "type": "error",
                        "error": format!("Agent query failed: {}", e)
                    });
                    yield Ok(bytes::Bytes::from(format!("data: {}\n\n", error_event)));
                    return;
                }
            };

            // Forward the streaming response from agent service
            let mut agent_stream = response.bytes_stream();

            while let Some(chunk_result) = agent_stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        yield Ok(bytes);
                    }
                    Err(e) => {
                        yield Err(std::io::Error::other(e));
                        break;
                    }
                }
            }
        };

        axum::http::Response::builder()
            .status(StatusCode::OK)
            .header(axum::http::header::CONTENT_TYPE, "text/event-stream")
            .header(axum::http::header::CACHE_CONTROL, "no-cache")
            .header("X-Accel-Buffering", "no")
            .body(Body::from_stream(s))
            .unwrap_or_else(|_| Response::new(Body::empty()))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        use axum::response::IntoResponse;
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Agent chat is only available in enterprise version"
            })),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_chat_request_creation() {
        let request = AgentChatRequest {
            agent_type: "sre".to_string(),
            message: "What's the issue?".to_string(),
            context: serde_json::json!({"incident_id": "123"}),
            history: vec![],
        };
        assert_eq!(request.agent_type, "sre");
        assert_eq!(request.message, "What's the issue?");
        assert!(request.history.is_empty());
    }

    #[test]
    fn test_agent_chat_request_with_history() {
        let request = AgentChatRequest {
            agent_type: "sre-rca".to_string(),
            message: "Explain more".to_string(),
            context: serde_json::json!({}),
            history: vec![
                ChatMessage {
                    role: "user".to_string(),
                    content: "What happened?".to_string(),
                },
                ChatMessage {
                    role: "assistant".to_string(),
                    content: "There was an error.".to_string(),
                },
            ],
        };
        assert_eq!(request.history.len(), 2);
        assert_eq!(request.history[0].role, "user");
        assert_eq!(request.history[1].role, "assistant");
    }

    #[test]
    fn test_chat_message_creation() {
        let message = ChatMessage {
            role: "user".to_string(),
            content: "Hello agent".to_string(),
        };
        assert_eq!(message.role, "user");
        assert_eq!(message.content, "Hello agent");
    }

    #[test]
    fn test_agent_chat_request_default_fields() {
        let json = serde_json::json!({
            "agent_type": "sre",
            "message": "Test"
        });
        let request: AgentChatRequest = serde_json::from_value(json).unwrap();
        assert_eq!(request.agent_type, "sre");
        assert_eq!(request.message, "Test");
        assert_eq!(request.context, serde_json::Value::Null);
        assert!(request.history.is_empty());
    }

    #[test]
    fn test_chat_message_serialization() {
        let message = ChatMessage {
            role: "assistant".to_string(),
            content: "Analysis complete".to_string(),
        };
        let json = serde_json::to_string(&message).unwrap();
        assert!(json.contains("assistant"));
        assert!(json.contains("Analysis complete"));
    }

    #[test]
    fn test_agent_chat_request_full_serialization() {
        let request = AgentChatRequest {
            agent_type: "sre".to_string(),
            message: "Check logs".to_string(),
            context: serde_json::json!({"alert_id": "test-123"}),
            history: vec![ChatMessage {
                role: "user".to_string(),
                content: "Previous question".to_string(),
            }],
        };

        let json = serde_json::to_string(&request).unwrap();
        let deserialized: AgentChatRequest = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.agent_type, "sre");
        assert_eq!(deserialized.message, "Check logs");
        assert_eq!(deserialized.history.len(), 1);
    }
}
