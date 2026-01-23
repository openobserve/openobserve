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

//! AI Chat handlers that redirect to o2-sre-agent.
//!
//! These endpoints accept the legacy PromptRequest format for backward compatibility
//! but internally forward all requests to the o2-sre-agent service, which handles
//! the actual AI processing with MCP tool integration.

use axum::{
    Json,
    body::Body,
    extract::{FromRequestParts, Path},
    http::StatusCode,
    response::{IntoResponse, Response},
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use serde::Deserialize;
use tracing::Span;

/// Agent type for general chat/copilot requests (SQL help, observability questions, etc.)
#[cfg(feature = "enterprise")]
const DEFAULT_AGENT_TYPE: &str = "o2-ai";

/// Agent type for incident-specific queries (triggered when incident_id is in context)
#[cfg(feature = "enterprise")]
const INCIDENT_AGENT_TYPE: &str = "sre";

/// Determine agent type based on context.
/// - If context contains incident_id, use SRE agent for incident investigation
/// - Otherwise use default copilot agent
#[cfg(feature = "enterprise")]
fn get_agent_type(context: &serde_json::Value) -> &'static str {
    if context
        .as_object()
        .is_some_and(|obj| obj.contains_key("incident_id"))
    {
        INCIDENT_AGENT_TYPE
    } else {
        DEFAULT_AGENT_TYPE
    }
}

#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::ai::agent::meta::Role;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::{
        extractors::Headers,
        models::ai::{PromptRequest, PromptResponse},
        request::search::search_stream::report_to_audit,
    },
};

/// CreateChat
#[utoipa::path(
    post,
    path = "/{org_id}/ai/chat",
    context_path = "/api",
    tag = "Ai",
    operation_id = "Chat",
    summary = "Generate AI chat response",
    description = "Generates an AI-powered response to user queries and requests. \
                   This endpoint redirects to the o2-sre-agent service for processing.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    request_body(
        content = inline(PromptRequest),
        description = "Prompt details",
        example = json!({
            "messages": [
                {
                    "role": "user",
                    "content": "Write a SQL query to get the top 10 users by response time in the default stream",
                }
            ]
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Chat response", body = inline(PromptResponse)),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = Object),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Chat", "operation": "create"}))
    )
)]
pub async fn chat(Path(org_id): Path<String>, in_req: axum::extract::Request) -> Response {
    // Extract headers manually to avoid conflict with body extraction
    let (mut parts, body) = in_req.into_parts();

    // Extract TraceInfo from headers
    let auth_data = match Headers::<TraceInfo>::from_request_parts(&mut parts, &()).await {
        Ok(Headers(data)) => data,
        Err(e) => return e.into_response(),
    };

    // Parse JSON body
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return MetaHttpResponse::bad_request(format!("Failed to read request body: {e}"));
        }
    };

    let prompt_body: PromptRequest = match serde_json::from_slice(&body_bytes) {
        Ok(b) => b,
        Err(e) => {
            return MetaHttpResponse::bad_request(format!("Invalid JSON body: {e}"));
        }
    };

    #[cfg(feature = "enterprise")]
    {
        use config::get_config;
        use o2_enterprise::enterprise::alerts::rca_agent::{QueryRequest, RcaAgentClient};

        let trace_id = auth_data.get_trace_id();
        let user_id = &auth_data.user_id;
        let org_id_str = org_id.as_str();
        let config = get_o2_config();

        // Create root span for AI tracing if enabled
        let span = if config.ai.tracing_enabled {
            tracing::info_span!(
                "http.request",
                http.method = "POST",
                http.route = "/api/{org_id}/ai/chat",
                http.target = format!("/api/{org_id_str}/ai/chat"),
                otel.kind = "server",
            )
        } else {
            Span::none()
        };
        let _guard = span.enter();

        // Check if AI/agent is enabled
        if !config.ai.enabled {
            return MetaHttpResponse::bad_request("AI is not enabled");
        }

        if !config.incidents.rca_enabled || config.incidents.rca_agent_url.is_empty() {
            return MetaHttpResponse::bad_request("Agent service not configured");
        }

        // Extract user token from cookie/header for per-user MCP auth
        // Unwrap Session:: wrapper if present, otherwise use token as-is
        let auth_str = crate::common::utils::auth::extract_auth_str_from_parts(&parts).await;
        let user_token = if auth_str.starts_with("Session::") {
            // Session format: "Session::{session_id}::{actual_token}"
            // Extract actual token (already has Bearer/Basic prefix)
            auth_str.splitn(3, "::").nth(2).map(|s| s.to_string())
        } else if !auth_str.is_empty() {
            Some(auth_str)
        } else {
            None
        };

        // Create agent client
        let zo_config = get_config();
        let client = match RcaAgentClient::new(
            &config.incidents.rca_agent_url,
            &zo_config.auth.root_user_email,
            &zo_config.auth.root_user_password,
        ) {
            Ok(c) => c,
            Err(e) => {
                log::error!(
                    "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id_str}] \
                     Failed to create agent client: {e}"
                );
                return MetaHttpResponse::internal_error(format!(
                    "Failed to create agent client: {e}"
                ));
            }
        };

        // Transform PromptRequest -> QueryRequest
        // Extract the last user message as the query
        let last_user_message = prompt_body
            .messages
            .iter()
            .rfind(|m| m.role == Role::User)
            .map(|m| m.content.clone())
            .unwrap_or_default();

        // Build history from all messages except the last user message
        let history: Vec<serde_json::Value> = prompt_body
            .messages
            .iter()
            .take(prompt_body.messages.len().saturating_sub(1))
            .map(|m| {
                serde_json::json!({
                    "role": format!("{:?}", m.role).to_lowercase(),
                    "content": m.content
                })
            })
            .collect();

        // Merge org_id into context
        let mut context = serde_json::to_value(&prompt_body.context).unwrap_or_default();
        if let Some(obj) = context.as_object_mut() {
            obj.insert(
                "org_id".to_string(),
                serde_json::Value::String(org_id.clone()),
            );
        }

        // Determine agent type based on context (incident_id -> sre, otherwise o2-ai)
        // Must be done before context is moved into QueryRequest
        let agent_type = get_agent_type(&context);

        let query_req = QueryRequest {
            query: last_user_message,
            context,
            model: if prompt_body.model.is_empty() {
                None
            } else {
                Some(prompt_body.model)
            },
            history: if history.is_empty() {
                None
            } else {
                Some(history)
            },
            user_token,
        };

        // Query agent
        match client.query(agent_type, query_req).await {
            Ok(response) => {
                // QueryResponse has a `response: String` field
                let prompt_response = PromptResponse {
                    role: Role::Assistant,
                    content: response.response,
                };
                (StatusCode::OK, Json(prompt_response)).into_response()
            }
            Err(e) => {
                let error_msg = e.to_string();
                log::error!(
                    "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id_str}] \
                     Agent query failed: {error_msg}"
                );

                // Check if this is a rate limit error (429)
                if error_msg.contains("status 429") || error_msg.contains("rate_limit_exceeded") {
                    return (
                        StatusCode::TOO_MANY_REQUESTS,
                        Json(serde_json::json!({
                            "error": error_msg,
                            "code": 429
                        })),
                    )
                        .into_response();
                }

                MetaHttpResponse::internal_error(error_msg)
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(parts);
        drop(auth_data);
        drop(prompt_body);
        MetaHttpResponse::bad_request("AI chat is only available in enterprise version")
    }
}

#[derive(Debug, Deserialize)]
pub struct TraceInfo {
    pub user_id: String,
    #[serde(default)]
    pub traceparent: String,
    #[serde(default)]
    pub authorization: Option<String>,
}

impl TraceInfo {
    /// Extract trace_id from traceparent header if present, otherwise generate UUID v7
    fn get_trace_id(&self) -> String {
        if !self.traceparent.is_empty() {
            // Parse traceparent format: 00-{trace_id}-{span_id}-{flags}
            let parts: Vec<&str> = self.traceparent.split('-').collect();
            if parts.len() >= 3 {
                let trace_id = parts[1].to_string();
                // Validate trace_id (32 hex chars, not all zeros)
                if trace_id.len() == 32
                    && trace_id.chars().all(|c| c.is_ascii_hexdigit())
                    && trace_id.chars().any(|c| c != '0')
                {
                    return trace_id;
                }
            }
        }
        // Generate new UUID v7 trace_id if traceparent is invalid or missing
        config::ider::generate_trace_id()
    }
}

/// CreateChatStream
#[utoipa::path(
    post,
    path = "/{org_id}/ai/chat_stream",
    context_path = "/api",
    tag = "Ai",
    operation_id = "ChatStream",
    summary = "Generate streaming AI chat response",
    description = "Generates an AI response with real-time streaming for improved user experience. \
                   This endpoint redirects to the o2-sre-agent service for processing.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    request_body(
        content = inline(PromptRequest),
        description = "Prompt details",
        example = json!({
            "messages": [
                {
                    "role": "user",
                    "content": "Write a SQL query to get the top 10 users by response time in the default stream",
                }
            ]
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Chat response", body = ()),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = Object),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Chat", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
#[axum::debug_handler]
pub async fn chat_stream(Path(org_id): Path<String>, in_req: axum::extract::Request) -> Response {
    // Extract headers manually to avoid conflict with body extraction
    let (mut parts, body) = in_req.into_parts();

    // Extract TraceInfo from headers
    let auth_data = match Headers::<TraceInfo>::from_request_parts(&mut parts, &()).await {
        Ok(Headers(data)) => data,
        Err(e) => return e.into_response(),
    };

    let trace_id = auth_data.get_trace_id();
    let user_id = auth_data.user_id.clone();

    // Parse JSON body
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return MetaHttpResponse::bad_request(format!("Failed to read request body: {}", e));
        }
    };

    let prompt_body: PromptRequest = match serde_json::from_slice(&body_bytes) {
        Ok(b) => b,
        Err(e) => {
            return MetaHttpResponse::bad_request(format!("Invalid JSON body: {}", e));
        }
    };

    #[cfg(feature = "enterprise")]
    {
        use async_stream::stream;
        use futures::StreamExt;
        use o2_enterprise::enterprise::alerts::rca_agent::{QueryRequest, get_agent_client};

        let config = get_o2_config();
        let org_id_str = org_id.clone();

        // Create root span for AI tracing if enabled
        let span = if config.ai.tracing_enabled {
            tracing::info_span!(
                "http.request",
                http.method = "POST",
                http.route = "/api/{org_id}/ai/chat_stream",
                http.target = format!("/api/{}/ai/chat_stream", org_id_str),
                otel.kind = "server",
            )
        } else {
            Span::none()
        };
        let _guard = span.enter();

        let mut code = StatusCode::OK.as_u16();
        let body_bytes_str = serde_json::to_string(&prompt_body).unwrap_or_default();

        // Check if AI/agent is enabled
        if !config.ai.enabled {
            let error_message = Some("AI is not enabled".to_string());
            code = StatusCode::BAD_REQUEST.as_u16();
            report_to_audit(
                user_id.clone(),
                org_id_str.clone(),
                trace_id.clone(),
                code,
                error_message,
                "POST".to_string(),
                format!("/api/{}/ai/chat_stream", org_id_str),
                String::new(),
                body_bytes_str,
            )
            .await;
            return MetaHttpResponse::bad_request("AI is not enabled");
        }

        // Get global agent client
        let client = match get_agent_client() {
            Some(c) => c,
            None => {
                let error_message = Some("Agent service not configured".to_string());
                code = StatusCode::BAD_REQUEST.as_u16();
                report_to_audit(
                    user_id.clone(),
                    org_id_str.clone(),
                    trace_id.clone(),
                    code,
                    error_message,
                    "POST".to_string(),
                    format!("/api/{}/ai/chat_stream", org_id_str),
                    String::new(),
                    body_bytes_str,
                )
                .await;
                return MetaHttpResponse::bad_request("Agent service not configured");
            }
        };

        // Extract user token from cookie/header for per-user MCP auth
        // Unwrap Session:: wrapper if present, otherwise use token as-is
        let auth_str = crate::common::utils::auth::extract_auth_str_from_parts(&parts).await;
        let user_token = if auth_str.starts_with("Session::") {
            // Session format: "Session::{session_id}::{actual_token}"
            // Extract actual token (already has Bearer/Basic prefix)
            auth_str.splitn(3, "::").nth(2).map(|s| s.to_string())
        } else if !auth_str.is_empty() {
            Some(auth_str)
        } else {
            None
        };

        // Transform PromptRequest -> QueryRequest
        let last_user_message = prompt_body
            .messages
            .iter()
            .rfind(|m| m.role == Role::User)
            .map(|m| m.content.clone())
            .unwrap_or_default();

        let history: Vec<serde_json::Value> = prompt_body
            .messages
            .iter()
            .take(prompt_body.messages.len().saturating_sub(1))
            .map(|m| {
                serde_json::json!({
                    "role": format!("{:?}", m.role).to_lowercase(),
                    "content": m.content
                })
            })
            .collect();

        let mut context = serde_json::to_value(&prompt_body.context).unwrap_or_default();
        if let Some(obj) = context.as_object_mut() {
            obj.insert(
                "org_id".to_string(),
                serde_json::Value::String(org_id_str.clone()),
            );
        }

        // Determine agent type based on context (incident_id -> sre, otherwise o2-ai)
        // Must be done before context is moved into QueryRequest
        let agent_type = get_agent_type(&context);

        let query_req = QueryRequest {
            query: last_user_message,
            context,
            model: if prompt_body.model.is_empty() {
                None
            } else {
                Some(prompt_body.model)
            },
            history: if history.is_empty() {
                None
            } else {
                Some(history)
            },
            user_token,
        };

        // Report successful start to audit
        report_to_audit(
            user_id.clone(),
            org_id_str.clone(),
            trace_id.clone(),
            code,
            None,
            "POST".to_string(),
            format!("/api/{}/ai/chat_stream", org_id_str),
            String::new(),
            body_bytes_str,
        )
        .await;

        // Create streaming response
        let s = stream! {
            // Call the agent service
            let response = match client.query_stream(agent_type, query_req).await {
                Ok(r) => r,
                Err(e) => {
                    log::error!(
                        "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id_str}] \
                         Agent query failed: {e}"
                    );
                    let error_event = serde_json::json!({
                        "type": "error",
                        "error": format!("Agent query failed: {}", e)
                    });
                    yield Ok(bytes::Bytes::from(format!("data: {}\n\n", error_event)));
                    return;
                }
            };

            // Forward the streaming response from agent
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
            .header(
                axum::http::header::CONTENT_TYPE,
                mime::TEXT_EVENT_STREAM.as_ref(),
            )
            .header(axum::http::header::CACHE_CONTROL, "no-cache")
            .header("X-Accel-Buffering", "no")
            .body(Body::from_stream(s))
            .unwrap_or_else(|_| Response::new(Body::empty()))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(auth_data);
        drop(trace_id);
        drop(user_id);
        drop(prompt_body);
        MetaHttpResponse::bad_request("AI chat is only available in enterprise version")
    }
}
