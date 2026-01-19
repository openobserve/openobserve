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
    body::Body,
    extract::{FromRequestParts, Path},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use o2_enterprise::enterprise::{ai::agent, common::config::get_config as get_o2_config};
use serde::Deserialize;
use tracing::Span;

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
    description = "Generates an AI-powered response to user queries and requests",
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
pub async fn chat(
    Path(org_id): Path<String>,
    Headers(auth_data): Headers<TraceInfo>,
    Json(body): Json<PromptRequest>,
) -> Response {
    let trace_id = auth_data.get_trace_id();
    let user_id = &auth_data.user_id;
    let org_id_str = org_id.as_str();
    let config = get_o2_config();

    // Create root span for AI tracing if enabled (don't enter to avoid !Send)
    let span = if config.ai.tracing_enabled {
        tracing::info_span!(
            "http.request",
            http.method = "POST",
            http.route = "/api/{org_id}/ai/chat",
            http.target = format!("/api/{}/ai/chat", org_id_str),
            otel.kind = "server",
        )
    } else {
        Span::none()
    };

    let _guard = span.enter();

    if config.ai.enabled {
        let response = agent::service::chat(
            agent::meta::AiServerRequest::new(body.messages, body.model, body.context),
            trace_id.clone(),
        )
        .await;
        match response {
            Ok(response) => (StatusCode::OK, Json(PromptResponse::from(response))).into_response(),
            Err(e) => {
                let error_msg = e.to_string();
                log::error!(
                    "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id_str}] Error in AI chat: {error_msg}"
                );

                // Check if this is a rate limit error (429) - pass through to client
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

                // All other errors (4XX except 429, and 5XX) are internal server errors
                // as they indicate misconfiguration or provider issues
                MetaHttpResponse::internal_error(error_msg)
            }
        }
    } else {
        MetaHttpResponse::bad_request("AI is not enabled")
    }
}

#[derive(Debug, Deserialize)]
pub struct TraceInfo {
    pub user_id: String,
    #[serde(default)]
    pub traceparent: String,
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
    description = "Generates an AI response with real-time streaming for improved user experience",
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
    let user_id = auth_data.user_id;

    // Extract auth string from parts
    let auth_str = crate::common::utils::auth::extract_auth_str_from_parts(&parts).await;

    // Parse JSON body
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return MetaHttpResponse::bad_request(format!("Failed to read request body: {}", e));
        }
    };

    let body: PromptRequest = match serde_json::from_slice(&body_bytes) {
        Ok(b) => b,
        Err(e) => {
            return MetaHttpResponse::bad_request(format!("Invalid JSON body: {}", e));
        }
    };

    let config = get_o2_config();

    // Create root span for AI tracing if enabled (don't enter to avoid !Send)
    let span = if config.ai.tracing_enabled {
        tracing::info_span!(
            "http.request",
            http.method = "POST",
            http.route = "/api/{org_id}/ai/chat_stream",
            http.target = format!("/api/{}/ai/chat_stream", org_id),
            otel.kind = "server",
        )
    } else {
        Span::none()
    };

    let _guard = span.enter();

    let mut code = StatusCode::OK.as_u16();
    let body_bytes_str = serde_json::to_string(&body).unwrap();

    if !config.ai.enabled {
        let error_message = Some("AI is not enabled".to_string());
        code = StatusCode::BAD_REQUEST.as_u16();
        report_to_audit(
            user_id,
            org_id.clone(),
            trace_id.clone(),
            code,
            error_message,
            "POST".to_string(),
            format!("/api/{}/ai/chat_stream", org_id),
            String::new(),
            body_bytes_str,
        )
        .await;

        return MetaHttpResponse::bad_request("AI is not enabled");
    }

    let stream = match agent::service::chat_stream(
        agent::meta::AiServerRequest::new(body.messages, body.model, body.context),
        auth_str,
        trace_id.clone(),
    )
    .await
    {
        Ok(stream) => stream,
        Err(e) => {
            let error_msg = e.to_string();
            log::error!(
                "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id}] Error in AI chat_stream: {error_msg}"
            );

            // Check if this is a rate limit error (429) - pass through to client
            if error_msg.contains("status 429") || error_msg.contains("rate_limit_exceeded") {
                code = StatusCode::TOO_MANY_REQUESTS.as_u16();
                let error_message = Some(error_msg.clone());
                report_to_audit(
                    user_id.clone(),
                    org_id.clone(),
                    trace_id.clone(),
                    code,
                    error_message,
                    "POST".to_string(),
                    format!("/api/{}/ai/chat_stream", org_id),
                    String::new(),
                    body_bytes_str.clone(),
                )
                .await;

                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(serde_json::json!({
                        "error": error_msg,
                        "code": 429
                    })),
                )
                    .into_response();
            }

            // All other errors (4XX except 429, and 5XX) are internal server errors
            let error_message = Some(error_msg.clone());
            code = StatusCode::INTERNAL_SERVER_ERROR.as_u16();
            report_to_audit(
                user_id.clone(),
                org_id.clone(),
                trace_id.clone(),
                code,
                error_message,
                "POST".to_string(),
                format!("/api/{}/ai/chat_stream", org_id),
                String::new(),
                body_bytes_str.clone(),
            )
            .await;

            return MetaHttpResponse::internal_error(error_msg);
        }
    };

    report_to_audit(
        user_id,
        org_id.clone(),
        trace_id,
        code,
        None,
        "POST".to_string(),
        format!("/api/{}/ai/chat_stream", org_id),
        String::new(),
        body_bytes_str,
    )
    .await;

    axum::http::Response::builder()
        .status(StatusCode::OK)
        .header(
            axum::http::header::CONTENT_TYPE,
            mime::TEXT_EVENT_STREAM.as_ref(),
        )
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}
