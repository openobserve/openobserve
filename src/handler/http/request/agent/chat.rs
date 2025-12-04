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

use actix_web::{HttpResponse, Responder, post, web};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Request body for agent chat
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct AgentChatRequest {
    /// Type of agent to query (e.g., "sre", "sre-rca", "security")
    pub agent_type: String,
    /// User message/query
    pub message: String,
    /// Generic context (opaque JSON interpreted by agent)
    #[serde(default)]
    pub context: serde_json::Value,
    /// Conversation history
    #[serde(default)]
    pub history: Vec<ChatMessage>,
}

/// Chat message with role and content
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ChatMessage {
    /// Role: "user" or "assistant"
    pub role: String,
    /// Message content
    pub content: String,
}

/// Non-streaming agent chat endpoint
#[utoipa::path(
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
)]
#[post("/{org_id}/agent/chat")]
pub async fn agent_chat(
    path: web::Path<String>,
    #[allow(unused_variables)] web::Json(req): web::Json<AgentChatRequest>,
) -> Result<HttpResponse, actix_web::Error> {
    let _org_id = path.into_inner();

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
            return Ok(MetaHttpResponse::bad_request("Agent chat not enabled"));
        }

        // Create agent client
        let zo_config = get_config();
        let client = match RcaAgentClient::new(
            &o2_config.incidents.rca_agent_url,
            &zo_config.auth.root_user_email,
            &zo_config.auth.root_user_password,
        ) {
            Ok(c) => c,
            Err(e) => {
                return Ok(MetaHttpResponse::internal_error(format!(
                    "Failed to create agent client: {e}"
                )));
            }
        };

        // Build query request
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
        };

        // Query agent
        match client.query(&req.agent_type, query_req).await {
            Ok(response) => Ok(MetaHttpResponse::json(response)),
            Err(e) => Ok(MetaHttpResponse::internal_error(format!(
                "Agent query failed: {e}"
            ))),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        Ok(MetaHttpResponse::bad_request(
            "Agent chat is only available in enterprise version",
        ))
    }
}

/// Streaming agent chat endpoint (SSE)
#[utoipa::path(
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
)]
#[post("/{org_id}/agent/chat/stream")]
pub async fn agent_chat_stream(
    path: web::Path<String>,
    #[allow(unused_variables)] web::Json(req): web::Json<AgentChatRequest>,
) -> impl Responder {
    let _org_id = path.into_inner();

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

        // Build query request
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
        };

        // Query agent with streaming
        match client.query_stream(&req.agent_type, query_req).await {
            Ok(response) => {
                // Convert reqwest::Response to actix-web streaming response
                use futures::StreamExt;
                let stream = response
                    .bytes_stream()
                    .map(|result| result.map_err(std::io::Error::other));

                HttpResponse::Ok()
                    .content_type("text/event-stream")
                    .streaming(stream)
            }
            Err(e) => MetaHttpResponse::internal_error(format!("Agent query failed: {e}")),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Agent chat is only available in enterprise version"
        }))
    }
}
