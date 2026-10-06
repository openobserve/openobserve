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

#[cfg(feature = "enterprise")]
use audit::report_http as report_to_audit;
use axum::{
    Json,
    body::Body,
    extract::{FromRequestParts, Path},
    http::StatusCode,
    response::{IntoResponse, Response},
};
#[cfg(feature = "enterprise")]
use config::meta::oncall::rca::RcaContext;
use openobserve_api_common::{X_O2_ASSISTANT_SESSION_ID, extractors::Headers};
use serde::Deserialize;
#[cfg(feature = "enterprise")]
use {
    futures::StreamExt,
    o2_enterprise::enterprise::{
        ai::{
            agent::meta::Role,
            chat::{PersistSettings, TurnIdentity, TurnSpec, spawn_turn},
            client::{
                DEFAULT_AGENT_TYPE, ImageAttachment, QueryRequest, RCA_AGENT_TYPE,
                SESSION_OWNER_UNAVAILABLE, get_agent_client, is_session_owner_unavailable,
            },
        },
        common::config::get_config as get_o2_config,
    },
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::ai::{PromptRequest, PromptResponse},
};

/// The RCA agent's context contract (`RcaContext`, `is_reanalysis`); o2-ai routes on key presence.
#[cfg(feature = "enterprise")]
const RCA_CONTEXT_KEYS: [&str; 10] = [
    "subject_type",
    "subject_id",
    "incident_id",
    "previous_analysis",
    "severity",
    "past_causes",
    "alert_name",
    "stream",
    "dimensions",
    "is_reanalysis",
];

/// Client context keys an RCA chat keeps: incident display fields and timezone, never RCA inputs.
#[cfg(feature = "enterprise")]
const RCA_CHAT_CLIENT_KEYS: [&str; 8] = [
    "incident_title",
    "incident_status",
    "incident_severity",
    "alert_count",
    "first_alert_at",
    "last_alert_at",
    "request_timestamp",
    "user_timezone",
];

/// Picks the agent and its context; RCA only when the caller clears the RCA endpoint's own bar.
#[cfg(feature = "enterprise")]
async fn chat_agent_and_context(
    org_id: &str,
    user_id: &str,
    context: serde_json::Value,
) -> (&'static str, serde_json::Value) {
    let incident_id = context
        .get("incident_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let rca = match incident_id {
        Some(id) if can_run_incident_rca(org_id, user_id, &id).await => Some(
            o2_enterprise::enterprise::alerts::rca_service::build_incident_context(
                org_id, &id, None,
            )
            .await,
        ),
        _ => None,
    };
    select_chat_agent(context, rca)
}

/// Matches the RCA endpoint: RCA enabled, incident in this org, and its `POST .../rca` permission.
#[cfg(feature = "enterprise")]
async fn can_run_incident_rca(org_id: &str, user_id: &str, incident_id: &str) -> bool {
    let incidents = &get_o2_config().incidents;
    if !incidents.enabled || !incidents.rca_enabled {
        return false;
    }
    match infra::table::alert_incidents::get(org_id, incident_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return false,
        Err(e) => {
            log::error!("[org_id:{org_id}] failed to load incident for AI chat: {e}");
            return false;
        }
    }
    let Some(route) = incident_rca_route(org_id, incident_id) else {
        return false;
    };
    let Some((object_type, object_id)) = route.o2_type.split_once(':') else {
        return false;
    };
    openobserve_core::auth::check_permissions(
        object_id,
        &route.org_id,
        user_id,
        object_type,
        &route.method,
        Some(&route.parent_id),
        route.use_all_org,
        route.use_self_context,
        route.use_self_parent,
    )
    .await
}

#[cfg(feature = "enterprise")]
fn incident_rca_route(
    org_id: &str,
    incident_id: &str,
) -> Option<o2_openfga::meta::route_permissions::ResolvedRoute> {
    let path = ["v2", org_id, "alerts", "incidents", incident_id, "rca"];
    o2_openfga::meta::route_permissions::resolve_permission(&path, "POST", org_id, "", None)
}

/// RCA gets the server-built incident context plus display fields; other agents get no RCA keys.
#[cfg(feature = "enterprise")]
fn select_chat_agent(
    mut context: serde_json::Value,
    rca: Option<RcaContext>,
) -> (&'static str, serde_json::Value) {
    let Some(rca) = rca else {
        if let Some(obj) = context.as_object_mut() {
            for key in RCA_CONTEXT_KEYS {
                obj.remove(key);
            }
        }
        return (DEFAULT_AGENT_TYPE, context);
    };
    let mut rca_context = serde_json::to_value(rca).expect("RcaContext is plain data");
    if let (Some(obj), Some(client)) = (rca_context.as_object_mut(), context.as_object()) {
        for key in RCA_CHAT_CLIENT_KEYS {
            if let Some(value) = client.get(key) {
                obj.insert(key.to_string(), value.clone());
            }
        }
    }
    (RCA_AGENT_TYPE, rca_context)
}

/// Whether `val` is a well-formed session id: the id is client-supplied and ends
/// up in outbound URLs and, under HA, as the routing key.
///
/// The length check pins it to the hyphenated form — `Uuid::try_parse` also
/// accepts the braced, URN and simple forms, and a URN carries `:` into the URL.
fn is_valid_session_id(val: &str) -> bool {
    val.len() == 36 && uuid::Uuid::try_parse(val).is_ok()
}

#[cfg(feature = "cloud")]
pub(crate) fn ai_authorization_error_response(
    error: openobserve_core::trial_quota::AiUsageAuthorizationError,
) -> Response {
    use openobserve_core::trial_quota::AiUsageAuthorizationError;

    match error {
        AiUsageAuthorizationError::PaidOverageConsentRequired(consent) => (
            StatusCode::PRECONDITION_FAILED,
            Json(serde_json::json!({
                "code": StatusCode::PRECONDITION_FAILED.as_u16(),
                "message": "Paid usage requires organization consent.",
                "error_type": "paid_overage_consent_required",
                "consent": consent,
            })),
        )
            .into_response(),
        AiUsageAuthorizationError::PaymentRequired(message) => {
            MetaHttpResponse::payment_required(message)
        }
        AiUsageAuthorizationError::Unavailable(message) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(MetaHttpResponse::error(
                StatusCode::SERVICE_UNAVAILABLE,
                message,
            )),
        )
            .into_response(),
    }
}

#[cfg(feature = "cloud")]
fn ai_post_upstream_authorization_error_response(
    error: openobserve_core::trial_quota::AiUsageAuthorizationError,
) -> Response {
    use openobserve_core::trial_quota::AiUsageAuthorizationError;

    match error {
        AiUsageAuthorizationError::PaidOverageConsentRequired(_) => {
            ai_authorization_error_response(AiUsageAuthorizationError::PaymentRequired(
                "AI credit limit was reached while the request was running.".to_string(),
            ))
        }
        error => ai_authorization_error_response(error),
    }
}

#[cfg(feature = "enterprise")]
fn ai_upstream_error_response(error: anyhow::Error) -> Response {
    let message = error.to_string();
    if is_session_owner_unavailable(&error) || message.contains(SESSION_OWNER_UNAVAILABLE) {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "code": SESSION_OWNER_UNAVAILABLE,
                "error": message,
            })),
        )
            .into_response();
    }
    let status = o2_enterprise::enterprise::ai::client::upstream_error_status(&error)
        .and_then(|status| StatusCode::from_u16(status).ok())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    (
        status,
        Json(serde_json::json!({ "code": status.as_u16(), "error": message })),
    )
        .into_response()
}

/// Extract headers from the request that match the configured passthrough patterns.
/// Supports exact matches and prefix wildcards (e.g., "x-forwarded-*").
fn extract_passthrough_headers(
    headers: &axum::http::HeaderMap,
    passthrough_config: &str,
) -> std::collections::HashMap<String, String> {
    let mut result = std::collections::HashMap::new();

    // Parse the passthrough config into patterns
    let patterns: Vec<&str> = passthrough_config
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    for (header_name, header_value) in headers.iter() {
        let header_name_lower = header_name.as_str().to_lowercase();

        for pattern in &patterns {
            let pattern_lower = pattern.to_lowercase();
            let matches = if pattern_lower.ends_with('*') {
                // Prefix match (e.g., "x-forwarded-*" matches "x-forwarded-for")
                let prefix = &pattern_lower[..pattern_lower.len() - 1];
                header_name_lower.starts_with(prefix)
            } else {
                // Exact match
                header_name_lower == pattern_lower
            };

            if matches {
                if let Ok(value) = header_value.to_str() {
                    result.insert(header_name_lower.clone(), value.to_string());
                }
                break;
            }
        }
    }

    result
}

/// CreateChat
#[utoipa::path(
    post,
    path = "/{org_id}/ai/chat",
    context_path = "/api",
    tag = "AI",
    operation_id = "Chat",
    summary = "Generate AI chat response",
    description = "Generates an AI-powered response to user queries and requests.",
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
        (status = StatusCode::PRECONDITION_FAILED, description = "Paid overage consent required", body = Object),
        (status = StatusCode::PAYMENT_REQUIRED, description = "Subscription or additional credits required", body = Object),
        (status = StatusCode::SERVICE_UNAVAILABLE, description = "Usage authorization unavailable", body = Object),
        (status = StatusCode::CONFLICT, description = "O2 AI session owner unavailable", body = Object),
        (status = StatusCode::TOO_MANY_REQUESTS, description = "Upstream AI rate limit exceeded", body = Object),
        (status = StatusCode::BAD_GATEWAY, description = "Upstream AI service unavailable", body = Object),
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
        let trace_id = auth_data.get_trace_id();
        let user_id = &auth_data.user_id;
        let org_id_str = org_id.as_str();
        let o2_cfg = get_o2_config();

        // Check if AI/agent is enabled
        if !o2_cfg.ai.enabled {
            return MetaHttpResponse::bad_request("AI is not enabled");
        }

        if !o2_cfg.ai.has_agent_target() {
            return MetaHttpResponse::bad_request("AI agent URL is not set");
        }

        // Check quota and billing without consuming a credit. Metering happens
        // only after the upstream request succeeds.
        #[cfg(feature = "cloud")]
        let usage_ctx = openobserve_core::trial_quota::AiUsageContext {
            user_email: user_id.to_string(),
            trace_id: Some(trace_id.clone()),
            session_id: None,
            incident_id: None,
        };
        #[cfg(feature = "cloud")]
        if let Err(error) = openobserve_core::trial_quota::precheck_ai_usage(
            org_id_str,
            openobserve_core::trial_quota::TrialQuotaFeature::AiChat,
            user_id,
        )
        .await
        {
            return ai_authorization_error_response(error);
        }

        // Extract user auth from headers to pass to the agent
        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
        // Auth header is passed directly to agent - no need to extract user_token

        // Get global agent client singleton
        let client = match get_agent_client() {
            Some(c) => c,
            None => {
                log::error!(
                    "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id_str}] \
                     Agent service not configured"
                );
                return MetaHttpResponse::bad_request("Agent service not configured");
            }
        };

        // Extract headers to pass through to the agent
        // Note: passthrough_headers config field needs to be added to o2_enterprise Ai config
        // For now, use empty string (no passthrough) until config is updated
        let passthrough_config = ""; // TODO: Replace with config.ai.passthrough_headers once field is added
        let passthrough_headers = extract_passthrough_headers(&parts.headers, passthrough_config);

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
        let (agent_type, context) = chat_agent_and_context(org_id_str, user_id, context).await;

        // Convert images to agent format
        let images = prompt_body.images.map(|imgs| {
            imgs.into_iter()
                .map(|img| ImageAttachment {
                    data: img.data,
                    mime_type: img.mime_type,
                    filename: img.filename,
                })
                .collect()
        });

        let (tool_mcps, tool_clis, tool_skills) =
            o2_enterprise::enterprise::ai::toolsets::push::load_agent_tools(org_id_str).await;
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
            images,
            mcps: if tool_mcps.is_empty() {
                None
            } else {
                Some(tool_mcps)
            },
            clis: if tool_clis.is_empty() {
                None
            } else {
                Some(tool_clis)
            },
            skills: if tool_skills.is_empty() {
                None
            } else {
                Some(tool_skills)
            },
            // Set by the persistence admission below when this turn is being
            // stored; absent otherwise, so o2-ai streams exactly as before.
            turn_id: None,
            known_seq: None,
            known_opencode_session_id: None,
        };

        // Forward the session id: without it every call load-balances to an
        // arbitrary replica, which finds no session and starts a new one.
        let mut forward_headers = std::collections::HashMap::new();
        if let Some(session_id) = parts.headers.get(X_O2_ASSISTANT_SESSION_ID.as_str())
            && let Ok(val) = session_id.to_str()
        {
            if is_valid_session_id(val) {
                forward_headers.insert(
                    X_O2_ASSISTANT_SESSION_ID.as_str().to_string(),
                    val.to_string(),
                );
            } else {
                return MetaHttpResponse::bad_request("Invalid session id");
            }
        }

        // No otel span is opened here, so pass the caller's traceparent through
        // unchanged and the agent's spans still join the request's trace.
        if let Some(traceparent) = &auth_data.traceparent
            && !traceparent.is_empty()
        {
            forward_headers.insert("traceparent".to_string(), traceparent.clone());
        }

        if let Some(user_agent) = parts.headers.get("user-agent")
            && let Ok(val) = user_agent.to_str()
        {
            forward_headers.insert("user-agent".to_string(), val.to_string());
        }

        // Merged last and never overriding, so a passthrough pattern matching
        // one of the above cannot displace it — as on the stream path.
        for (key, value) in passthrough_headers {
            forward_headers.entry(key).or_insert(value);
        }

        let headers_to_forward = if forward_headers.is_empty() {
            None
        } else {
            Some(&forward_headers)
        };

        return match client
            .query_with_headers(agent_type, query_req, &auth_str, headers_to_forward)
            .await
        {
            Ok(response) => {
                #[cfg(feature = "cloud")]
                if let Err(error) = openobserve_core::trial_quota::authorize_ai_usage(
                    org_id_str,
                    openobserve_core::trial_quota::TrialQuotaFeature::AiChat,
                    &usage_ctx,
                )
                .await
                {
                    return ai_post_upstream_authorization_error_response(error);
                }
                let prompt_response = PromptResponse {
                    role: Role::Assistant,
                    content: response.response,
                };
                (StatusCode::OK, Json(prompt_response)).into_response()
            }
            Err(error) => {
                log::error!(
                    "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id_str}] \
                     Agent query failed: {error}"
                );
                ai_upstream_error_response(error)
            }
        };
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
    pub traceparent: Option<String>,
    #[serde(default)]
    pub authorization: Option<String>,
}

impl TraceInfo {
    /// Extract trace_id from traceparent header if present, otherwise generate UUID v7
    fn get_trace_id(&self) -> String {
        if let Some(traceparent) = &self.traceparent
            && !traceparent.is_empty()
        {
            // Parse traceparent format: 00-{trace_id}-{span_id}-{flags}
            let parts: Vec<&str> = traceparent.split('-').collect();
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
    tag = "AI",
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
        (status = StatusCode::PRECONDITION_FAILED, description = "Paid overage consent required", body = Object),
        (status = StatusCode::PAYMENT_REQUIRED, description = "Subscription or additional credits required", body = Object),
        (status = StatusCode::SERVICE_UNAVAILABLE, description = "Usage authorization unavailable", body = Object),
        (status = StatusCode::CONFLICT, description = "O2 AI session owner unavailable", body = Object),
        (status = StatusCode::TOO_MANY_REQUESTS, description = "Upstream AI rate limit exceeded", body = Object),
        (status = StatusCode::BAD_GATEWAY, description = "Upstream AI service unavailable", body = Object),
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

    // Create OTel span for AI tracing using the OpenTelemetry API directly.
    // We avoid the tracing-opentelemetry bridge here because it has issues with
    // span lifecycle management in async generators (spans created via tracing::info_span!
    // don't get properly exported when held inside async_stream::stream!).
    #[cfg(feature = "enterprise")]
    let otel_chat_span = {
        if get_o2_config().ai.tracing_enabled {
            use opentelemetry::trace::{SpanKind, TraceContextExt, Tracer};

            // Extract parent context from incoming traceparent header
            let parent_cx = opentelemetry::global::get_text_map_propagator(|propagator| {
                propagator.extract(&common::utils::http::RequestHeaderExtractor::new(
                    &parts.headers,
                ))
            });

            // Create the span as a child of the incoming request
            let tracer = opentelemetry::global::tracer("openobserve");
            let span = tracer
                .span_builder("ai.chat_stream")
                .with_kind(SpanKind::Server)
                .with_attributes(vec![
                    opentelemetry::KeyValue::new("http.method", "POST"),
                    opentelemetry::KeyValue::new("http.route", "/api/{org_id}/ai/chat_stream"),
                    opentelemetry::KeyValue::new(
                        "http.target",
                        format!("/api/{}/ai/chat_stream", org_id),
                    ),
                    opentelemetry::KeyValue::new("trace_id", trace_id.clone()),
                    opentelemetry::KeyValue::new("user_id", user_id.clone()),
                    opentelemetry::KeyValue::new("org_id", org_id.clone()),
                ])
                .start_with_context(&tracer, &parent_cx);

            // Build the context with this span so we can inject a traceparent for downstream
            let span_cx = parent_cx.with_span(span);
            Some(span_cx)
        } else {
            None
        }
    };

    #[cfg(not(feature = "enterprise"))]
    let otel_chat_span: Option<opentelemetry::Context> = None;

    let mut forward_headers = std::collections::HashMap::new();

    // Server-side chat persistence: the browser's id for this turn, so a
    // retried request does not start a second model run (see `chats`).
    let persist_turn_id = parts
        .headers
        .get(super::chats::X_O2_ASSISTANT_TURN_ID)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    // Extract and validate session ID (UUID v7 format: 8-4-4-4-12 hex digits)
    if let Some(session_id) = parts.headers.get(X_O2_ASSISTANT_SESSION_ID.as_str())
        && let Ok(val) = session_id.to_str()
    {
        if is_valid_session_id(val) {
            forward_headers.insert(
                X_O2_ASSISTANT_SESSION_ID.as_str().to_string(),
                val.to_string(),
            );
        } else {
            // Rejected, not dropped: dropping it would land the turn on an
            // arbitrary replica, which reads as the assistant forgetting.
            log::warn!("[trace_id:{}] Invalid session ID format: {}", trace_id, val);
            return MetaHttpResponse::bad_request("Invalid session id");
        }
    }

    // Generate a new traceparent from the ai.chat_stream span's context.
    // This ensures the agent sees ai.chat_stream as its parent (not the frontend span).
    if let Some(ref span_cx) = otel_chat_span {
        let mut injected_headers = std::collections::HashMap::new();
        opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.inject_context(span_cx, &mut injected_headers);
        });
        if let Some(tp) = injected_headers.remove("traceparent") {
            log::info!(
                "[trace_id:{}] Forwarding traceparent from ai.chat_stream span: {}",
                trace_id,
                tp
            );
            forward_headers.insert("traceparent".to_string(), tp);
        }
    } else if let Some(traceparent) = &auth_data.traceparent
        && !traceparent.is_empty()
    {
        // Fallback: forward original traceparent when tracing is disabled
        forward_headers.insert("traceparent".to_string(), traceparent.clone());
    }

    if let Some(user_agent) = parts.headers.get("user-agent")
        && let Ok(val) = user_agent.to_str()
    {
        forward_headers.insert("user-agent".to_string(), val.to_string());
    }

    // Extract and merge passthrough headers from config
    #[cfg(feature = "enterprise")]
    {
        // Note: passthrough_headers config field needs to be added to o2_enterprise Ai config
        // For now, use empty string (no passthrough) until config is updated
        let passthrough_config = ""; // TODO: Replace with _config.ai.passthrough_headers once field is added
        let passthrough_headers = extract_passthrough_headers(&parts.headers, passthrough_config);
        // Merge passthrough headers, but don't override already-set headers (like session_id,
        // traceparent)
        for (key, value) in passthrough_headers {
            forward_headers.entry(key).or_insert(value);
        }
    }

    // Log correlation context for debugging
    log::info!(
        "[trace_id:{}] AI chat request: user_id={}, session_id={}",
        trace_id,
        user_id,
        forward_headers
            .get(X_O2_ASSISTANT_SESSION_ID.as_str())
            .map(String::as_str)
            .unwrap_or("none")
    );

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
        let org_id_str = org_id.clone();
        let mut code = StatusCode::OK.as_u16();
        let body_bytes_str = serde_json::to_string(&prompt_body).unwrap_or_default();

        // Check if AI/agent is enabled
        if !get_o2_config().ai.enabled {
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

        // Check quota and billing without consuming a credit. The final
        // deduction occurs only after the upstream accepts the stream.
        #[cfg(feature = "cloud")]
        let usage_ctx = openobserve_core::trial_quota::AiUsageContext {
            user_email: user_id.clone(),
            trace_id: Some(trace_id.clone()),
            session_id: forward_headers
                .get(X_O2_ASSISTANT_SESSION_ID.as_str())
                .cloned(),
            incident_id: None,
        };
        #[cfg(feature = "cloud")]
        if let Err(error) = openobserve_core::trial_quota::precheck_ai_usage(
            &org_id_str,
            openobserve_core::trial_quota::TrialQuotaFeature::AiChat,
            &user_id,
        )
        .await
        {
            return ai_authorization_error_response(error);
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
        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
        // Auth header is passed directly to agent - no need to extract user_token

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
        let (agent_type, context) = chat_agent_and_context(&org_id_str, &user_id, context).await;

        // Convert images to agent format
        let images = prompt_body.images.map(|imgs| {
            imgs.into_iter()
                .map(|img| ImageAttachment {
                    data: img.data,
                    mime_type: img.mime_type,
                    filename: img.filename,
                })
                .collect()
        });

        let (tool_mcps, tool_clis, tool_skills) =
            o2_enterprise::enterprise::ai::toolsets::push::load_agent_tools(&org_id_str).await;
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
            images,
            mcps: if tool_mcps.is_empty() {
                None
            } else {
                Some(tool_mcps)
            },
            clis: if tool_clis.is_empty() {
                None
            } else {
                Some(tool_clis)
            },
            skills: if tool_skills.is_empty() {
                None
            } else {
                Some(tool_skills)
            },
            // Set by the persistence admission below when this turn is being
            // stored; absent otherwise, so o2-ai streams exactly as before.
            turn_id: None,
            known_seq: None,
            known_opencode_session_id: None,
        };

        let headers_to_forward = if forward_headers.is_empty() {
            None
        } else {
            Some(forward_headers)
        };

        // ---- Server-side chat persistence -------------------------------
        //
        // With persistence on, the turn is owned by a background task rather
        // than by this response: it holds the o2-ai connection, stores
        // opencode's durable events in the org's protected chat-events
        // stream, and feeds the browser through a bounded channel. Closing
        // the tab drops only that channel.
        if o2_enterprise::enterprise::ai::chat::is_enabled() {
            let session_id = headers_to_forward
                .as_ref()
                .and_then(|h| h.get(X_O2_ASSISTANT_SESSION_ID.as_str()))
                .cloned();
            if query_req.query.trim().is_empty()
                && query_req.images.as_ref().is_none_or(|i| i.is_empty())
            {
                return MetaHttpResponse::bad_request("The message is empty");
            }
            // Read before admission so a failed read leaves the turn retryable.
            let fork_seed = match super::shares::fork_seed(
                &org_id_str,
                session_id.as_deref(),
                &user_id,
                &auth_str,
            )
            .await
            {
                Ok(seed) => seed,
                Err(resp) => return resp,
            };
            let admitted = match super::chats::admit_turn(
                &org_id_str,
                session_id.as_deref(),
                persist_turn_id.as_deref(),
                &user_id,
                agent_type,
                &query_req.query,
                &trace_id,
            )
            .await
            {
                Ok(admitted) => admitted,
                Err(resp) => return resp,
            };
            let super::chats::AdmittedTurn {
                row,
                owner,
                turn_id,
                lease,
            } = admitted;
            #[cfg(feature = "cloud")]
            if let Err(error) = openobserve_core::trial_quota::authorize_ai_usage(
                &org_id_str,
                openobserve_core::trial_quota::TrialQuotaFeature::AiChat,
                &usage_ctx,
            )
            .await
            {
                lease.release().await;
                return ai_post_upstream_authorization_error_response(error);
            }
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
            let session_id = row.session_id.clone();

            // Tell o2-ai to forward opencode's durable events, and how far our
            // copy of them already reaches: it forwards only what is missing,
            // and refuses (restore_required) when it holds less than that.
            let mut query_req = query_req;
            query_req.turn_id = Some(turn_id.clone());
            query_req.known_seq = Some(row.last_committed_seq);
            query_req.known_opencode_session_id = row.opencode_session_id.clone();
            if row.last_committed_seq == infra::table::ai_chat_sessions::NO_SEQ
                && let Some(seed) = fork_seed
            {
                query_req.history = Some(seed);
            }

            let settings = PersistSettings::from_config();
            let store = std::sync::Arc::new(openobserve_core::ai_chat::StreamChatStore::new(
                settings.retention_days,
            ));
            let span_for_task = otel_chat_span;
            let mut rx = spawn_turn(
                TurnSpec {
                    identity: TurnIdentity {
                        org_id: org_id_str.clone(),
                        session_id,
                        user_id: owner,
                        agent_type,
                        turn_id,
                        trace_id: trace_id.clone(),
                        epoch: row.session_epoch,
                        last_committed_seq: row.last_committed_seq,
                        opencode_session_id: row.opencode_session_id,
                    },
                    request: query_req,
                    auth_header: auth_str,
                    forward_headers: headers_to_forward,
                    client,
                    store,
                    lease,
                    // The span outlives this response now, so it is ended by
                    // the task rather than at the end of the relay below.
                    on_end: Some(Box::new(move || {
                        if let Some(span_cx) = span_for_task {
                            use opentelemetry::trace::TraceContextExt;
                            span_cx.span().end();
                        }
                    })),
                },
                settings,
            );

            let body = async_stream::stream! {
                while let Some(chunk) = rx.recv().await {
                    yield Ok::<bytes::Bytes, std::io::Error>(chunk);
                }
            };
            return axum::http::Response::builder()
                .status(StatusCode::OK)
                .header(
                    axum::http::header::CONTENT_TYPE,
                    mime::TEXT_EVENT_STREAM.as_ref(),
                )
                .header(axum::http::header::CACHE_CONTROL, "no-cache")
                .header("X-Accel-Buffering", "no")
                .body(Body::from_stream(body))
                .unwrap_or_else(|_| Response::new(Body::empty()));
        }

        // Establish the upstream response before returning browser headers or
        // recording usage. Startup errors retain meaningful HTTP statuses.
        let response = match client
            .query_stream_with_headers(
                agent_type,
                query_req,
                &auth_str,
                headers_to_forward.as_ref(),
            )
            .await
        {
            Ok(response) => response,
            Err(error) => {
                log::error!(
                    "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id_str}] \
                     Agent query failed: {error}"
                );
                let response = ai_upstream_error_response(error);
                if let Some(span_cx) = otel_chat_span.as_ref() {
                    use opentelemetry::trace::TraceContextExt;
                    span_cx.span().end();
                }
                report_to_audit(
                    user_id.clone(),
                    org_id_str.clone(),
                    trace_id.clone(),
                    response.status().as_u16(),
                    Some("Upstream AI request failed".to_string()),
                    "POST".to_string(),
                    format!("/api/{}/ai/chat_stream", org_id_str),
                    String::new(),
                    body_bytes_str,
                )
                .await;
                return response;
            }
        };

        #[cfg(feature = "cloud")]
        if let Err(error) = openobserve_core::trial_quota::authorize_ai_usage(
            &org_id_str,
            openobserve_core::trial_quota::TrialQuotaFeature::AiChat,
            &usage_ctx,
        )
        .await
        {
            let response = ai_post_upstream_authorization_error_response(error);
            if let Some(span_cx) = otel_chat_span.as_ref() {
                use opentelemetry::trace::TraceContextExt;
                span_cx.span().end();
            }
            report_to_audit(
                user_id.clone(),
                org_id_str.clone(),
                trace_id.clone(),
                response.status().as_u16(),
                Some("AI credit authorization failed after upstream acceptance".to_string()),
                "POST".to_string(),
                format!("/api/{}/ai/chat_stream", org_id_str),
                String::new(),
                body_bytes_str,
            )
            .await;
            return response;
        }

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

        // Keep the OTel span alive for the full stream.
        let s = async_stream::stream! {
            let mut agent_stream = response.bytes_stream();

            // Poll the stream with proper instrumentation
            // Each chunk is traced within the context of ai.chat_stream
            while let Some(chunk_result) = agent_stream.next().await {
                match chunk_result {
                    Ok(bytes) => {
                        yield Ok::<bytes::Bytes, std::io::Error>(bytes);
                    }
                    Err(e) => {
                        log::error!(
                            "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id_str}] \
                             Agent stream chunk error: {e}"
                        );
                        let error_event = serde_json::json!({
                            "type": "error",
                            "error": format!("Stream interrupted: {}", e)
                        });
                        yield Ok::<bytes::Bytes, std::io::Error>(bytes::Bytes::from(format!("data: {}\n\n", error_event)));
                        break;
                    }
                }
            }
            log::info!(
                "[trace_id:{trace_id}] [user_id:{user_id}] [org_id:{org_id_str}] \
                 Agent stream ended"
            );
            // Explicitly end the OTel span when the stream completes.
            // This is critical: the span must be ended before it can be exported
            // by the BatchSpanProcessor.
            if let Some(span_cx) = otel_chat_span {
                use opentelemetry::trace::TraceContextExt;
                span_cx.span().end();
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

/// Submit user feedback for an AI response.
///
/// Proxies feedback (thumbs up/down, rating) to the o2-sre-agent's /feedback endpoint.
/// The agent stores this and emits it as OTEL spans for OpenObserve ingestion.
pub async fn feedback(Path(org_id): Path<String>, in_req: axum::extract::Request) -> Response {
    let (parts, body) = in_req.into_parts();

    // Extract trace info from headers (user_id may not be present for feedback)
    let traceparent = parts
        .headers
        .get("traceparent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let trace_id = traceparent
        .as_ref()
        .and_then(|tp| tp.split('-').nth(1).map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string());

    let mut forward_headers = std::collections::HashMap::new();

    // Rejected rather than dropped, as on the stream path: feedback is recorded
    // on the owning replica, so an unroutable id files it against the wrong chat.
    if let Some(session_id) = parts.headers.get(X_O2_ASSISTANT_SESSION_ID.as_str())
        && let Ok(val) = session_id.to_str()
    {
        if is_valid_session_id(val) {
            forward_headers.insert(
                X_O2_ASSISTANT_SESSION_ID.as_str().to_string(),
                val.to_string(),
            );
        } else {
            return MetaHttpResponse::bad_request("Invalid session id");
        }
    }

    // Parse JSON body
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return MetaHttpResponse::bad_request(format!("Failed to read request body: {}", e));
        }
    };

    let feedback_body: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(b) => b,
        Err(e) => {
            return MetaHttpResponse::bad_request(format!("Invalid JSON body: {}", e));
        }
    };

    #[cfg(feature = "enterprise")]
    {
        if !get_o2_config().ai.enabled {
            return MetaHttpResponse::bad_request("AI is not enabled");
        }

        let client = match get_agent_client() {
            Some(c) => c,
            None => {
                return MetaHttpResponse::bad_request("Agent service not configured");
            }
        };

        // Extract user auth from headers to pass to the agent
        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;

        let headers_to_forward = if forward_headers.is_empty() {
            None
        } else {
            Some(forward_headers)
        };

        match client
            .post_feedback(feedback_body, &auth_str, headers_to_forward.as_ref())
            .await
        {
            Ok(response) => {
                log::info!(
                    "[trace_id:{}] Feedback submitted for org={}",
                    trace_id,
                    org_id
                );
                Json(response).into_response()
            }
            Err(e) => {
                log::error!("[trace_id:{}] Feedback submission failed: {}", trace_id, e);
                MetaHttpResponse::internal_error(format!("Feedback submission failed: {}", e))
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(trace_id);
        drop(feedback_body);
        MetaHttpResponse::bad_request("AI feedback is only available in enterprise version")
    }
}

/// ConfirmAction - Proxy confirmation response to o2-sre-agent
#[utoipa::path(
    post,
    path = "/{org_id}/ai/confirm/{session_id}",
    context_path = "/api",
    tag = "AI",
    operation_id = "ConfirmAction",
    summary = "Confirm or reject a destructive AI tool action",
    description = "Forwards user confirmation or rejection to the o2-sre-agent service \
                   for a pending destructive tool call.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Chat session ID")
    ),
    request_body(
        content = serde_json::Value,
        description = "Confirmation payload",
        example = json!({"approved": true}),
    ),
    responses(
        (status = StatusCode::OK, description = "Confirmation forwarded", body = Object),
        (status = StatusCode::BAD_REQUEST, description = "Invalid session ID, malformed body, or AI agent not configured", body = Object),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = Object),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn confirm_action(
    Path((_org_id, session_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let (parts, body) = in_req.into_parts();

    // Parse JSON body
    let body_bytes = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(bytes) => bytes,
        Err(e) => {
            return MetaHttpResponse::bad_request(format!("Failed to read request body: {e}"));
        }
    };

    #[cfg(feature = "enterprise")]
    {
        let o2_cfg = get_o2_config();
        if !o2_cfg.ai.enabled {
            return MetaHttpResponse::bad_request("AI is not enabled");
        }

        let client = match get_agent_client() {
            Some(c) => c,
            None => {
                return MetaHttpResponse::bad_request("Agent service not configured");
            }
        };

        // Validate before the id reaches an outbound URL: this path interpolates
        // a caller-supplied path segment straight in.
        if !is_valid_session_id(&session_id) {
            return MetaHttpResponse::bad_request("Invalid session id");
        }

        // Extract user auth from headers to pass to the agent
        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;

        // Agent uses Authorization header directly - no need to inject user_token into body
        let forward_bytes = body_bytes;

        // The client builds and routes the confirm URL itself: it must reach the
        // replica holding the paused turn, not whichever one the LB picks.
        match client
            .confirm_action(&session_id, forward_bytes.to_vec(), &auth_str)
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                let response_body = resp.text().await.unwrap_or_else(|_| "{}".to_string());

                if status.is_success() {
                    (
                        StatusCode::OK,
                        axum::Json(
                            serde_json::from_str::<serde_json::Value>(&response_body)
                                .unwrap_or_else(|_| serde_json::json!({"ok": true})),
                        ),
                    )
                        .into_response()
                } else {
                    log::error!(
                        "Agent confirm endpoint returned {}: {}",
                        status,
                        response_body
                    );
                    MetaHttpResponse::internal_error(format!(
                        "Confirmation failed: {}",
                        response_body
                    ))
                }
            }
            Err(e) => {
                log::error!("Failed to forward confirmation to agent: {e}");
                MetaHttpResponse::internal_error(format!("Failed to forward confirmation: {e}"))
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(session_id);
        drop(parts);
        drop(body_bytes);
        MetaHttpResponse::bad_request("AI chat is only available in enterprise version")
    }
}

/// CancelChat - stop the turn running in a conversation
#[utoipa::path(
    post,
    path = "/{org_id}/ai/chats/{session_id}/cancel",
    context_path = "/api",
    tag = "AI",
    operation_id = "CancelChat",
    summary = "Stop the AI turn running in a conversation",
    description = "Stops generation for a chat session. With server-side chat persistence \
                   enabled the browser no longer holds the connection to the agent, so \
                   disconnecting does not stop the turn — this does, and what was generated \
                   up to that point stays saved.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("session_id" = String, Path, description = "Chat session ID")
    ),
    responses(
        (status = StatusCode::OK, description = "Cancellation forwarded", body = Object),
        (status = StatusCode::BAD_REQUEST, description = "Invalid session ID or AI agent not configured", body = Object),
        (status = StatusCode::FORBIDDEN, description = "The conversation belongs to another user", body = Object),
        (status = StatusCode::NOT_FOUND, description = "Unknown conversation", body = Object),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = Object),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn cancel(
    Path((org_id, session_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let (parts, _body) = in_req.into_parts();

    #[cfg(feature = "enterprise")]
    {
        if !get_o2_config().ai.enabled {
            return MetaHttpResponse::bad_request("AI is not enabled");
        }
        // Validated before it reaches an outbound URL and a routing key.
        if !is_valid_session_id(&session_id) {
            return MetaHttpResponse::bad_request("Invalid session id");
        }
        let client = match get_agent_client() {
            Some(c) => c,
            None => return MetaHttpResponse::bad_request("Agent service not configured"),
        };

        let user_id = parts
            .headers
            .get("user_id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();

        // Only the owner may stop a turn. Without persistence there is no
        // index row to check ownership against, and cancellation is already
        // scoped by the session id the caller must know.
        if o2_enterprise::enterprise::ai::chat::is_enabled() {
            let owner = match super::chats::resolve_owner(&user_id).await {
                Ok(owner) => owner,
                Err(resp) => return resp,
            };
            match infra::table::ai_chat_sessions::get(&org_id, &session_id).await {
                Ok(Some(row)) if row.user_id == owner => {}
                // Someone else's or unknown: indistinguishable to the caller.
                Ok(_) => return MetaHttpResponse::not_found("Unknown conversation"),
                Err(e) => {
                    log::error!("[AI-CHAT] cannot read session {org_id}/{session_id}: {e}");
                    return MetaHttpResponse::internal_error("Could not read the conversation");
                }
            }
        }

        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
        match client.cancel_session(&session_id, &org_id, &auth_str).await {
            Ok(resp) => {
                let status = StatusCode::from_u16(resp.status().as_u16())
                    .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
                let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
                let json = serde_json::from_str::<serde_json::Value>(&body)
                    .unwrap_or_else(|_| serde_json::json!({"message": body}));
                (status, axum::Json(json)).into_response()
            }
            Err(e) => {
                log::error!("[AI-CHAT] failed to forward cancel for {session_id}: {e}");
                MetaHttpResponse::internal_error(format!("Failed to cancel: {e}"))
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop((org_id, session_id, parts));
        MetaHttpResponse::bad_request("AI chat is only available in enterprise version")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "cloud")]
    #[tokio::test]
    async fn paid_overage_denial_is_a_structured_precondition_response() {
        use openobserve_core::trial_quota::{
            AiUsageAuthorizationError, PaidOverageBillingStatus, PaidOverageOrganizationStatus,
            PaidOverageStatus,
        };

        let response = ai_authorization_error_response(
            AiUsageAuthorizationError::PaidOverageConsentRequired(PaidOverageStatus {
                feature: "ai_credits".to_string(),
                organization: PaidOverageOrganizationStatus {
                    org_id: "member".to_string(),
                    enabled: false,
                    can_manage: true,
                },
                payer: Some(PaidOverageOrganizationStatus {
                    org_id: "payer".to_string(),
                    enabled: false,
                    can_manage: false,
                }),
                effective: false,
                billing_status: PaidOverageBillingStatus::Eligible,
            }),
        );

        assert_eq!(response.status(), StatusCode::PRECONDITION_FAILED);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["error_type"], "paid_overage_consent_required");
        assert_eq!(body["consent"]["feature"], "ai_credits");
        assert_eq!(body["consent"]["organization"]["org_id"], "member");
        assert_eq!(body["consent"]["payer"]["org_id"], "payer");
        let serialized = body.to_string();
        assert!(!serialized.contains("ai_chat"));
        assert!(!serialized.contains("new_incident"));
        assert!(!serialized.contains("incident_reanalysis"));
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn upstream_owner_unavailable_maps_to_recoverable_conflict() {
        let error = o2_enterprise::enterprise::ai::client::session_owner_unavailable(
            "01234567-89ab-cdef-0123-456789abcdef",
        );
        let response = ai_upstream_error_response(error);

        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], SESSION_OWNER_UNAVAILABLE);
    }

    #[test]
    fn test_valid_session_ids_are_accepted() {
        assert!(is_valid_session_id("01234567-89ab-cdef-0123-456789abcdef"));
        // UUID v7 as minted by the frontend, and case-insensitive hex.
        assert!(is_valid_session_id("0195A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B"));
    }

    #[test]
    fn test_shape_only_lookalikes_are_rejected() {
        // 36 chars with 4 hyphens — passed the old length+count check.
        assert!(!is_valid_session_id("----zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"));
        // Right characters, hyphens in the wrong places.
        assert!(!is_valid_session_id(
            "0123456-789ab-cdef-0123-456789abcdeff"
        ));
    }

    #[test]
    fn test_non_hyphenated_uuid_forms_are_rejected() {
        // `Uuid::try_parse` accepts all of these; the length check keeps them
        // out. The URN form would carry a `:` into the confirm URL.
        assert!(!is_valid_session_id(
            "urn:uuid:01234567-89ab-cdef-0123-456789abcdef"
        ));
        assert!(!is_valid_session_id(
            "{01234567-89ab-cdef-0123-456789abcdef}"
        ));
        assert!(!is_valid_session_id("0123456789abcdef0123456789abcdef"));
    }

    #[test]
    fn test_url_unsafe_session_ids_are_rejected() {
        // The confirm handler interpolates this into an outbound URL.
        assert!(!is_valid_session_id("../../etc/passwd"));
        assert!(!is_valid_session_id("01234567-89ab-cdef-0123-456789abcde/"));
    }

    #[test]
    fn test_wrong_length_session_ids_are_rejected() {
        assert!(!is_valid_session_id(""));
        assert!(!is_valid_session_id("01234567-89ab-cdef-0123-456789abcde"));
        assert!(!is_valid_session_id(
            "01234567-89ab-cdef-0123-456789abcdeff"
        ));
    }

    #[test]
    fn test_extract_passthrough_headers_exact_match() {
        // Create a test request with headers
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("user-agent", "Mozilla/5.0".parse().unwrap());
        headers.insert("x-custom-header", "custom-value".parse().unwrap());
        headers.insert("authorization", "Bearer secret".parse().unwrap());

        let config = "user-agent,x-custom-header";
        let result = extract_passthrough_headers(&headers, config);

        assert_eq!(result.len(), 2);
        assert_eq!(result.get("user-agent"), Some(&"Mozilla/5.0".to_string()));
        assert_eq!(
            result.get("x-custom-header"),
            Some(&"custom-value".to_string())
        );
        // Authorization should not be included
        assert!(!result.contains_key("authorization"));
    }

    #[test]
    fn test_extract_passthrough_headers_wildcard_match() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("x-forwarded-for", "192.168.1.1".parse().unwrap());
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        headers.insert("x-forwarded-host", "example.com".parse().unwrap());
        headers.insert("x-other-header", "other".parse().unwrap());

        let config = "x-forwarded-*";
        let result = extract_passthrough_headers(&headers, config);

        assert_eq!(result.len(), 3);
        assert_eq!(
            result.get("x-forwarded-for"),
            Some(&"192.168.1.1".to_string())
        );
        assert_eq!(result.get("x-forwarded-proto"), Some(&"https".to_string()));
        assert_eq!(
            result.get("x-forwarded-host"),
            Some(&"example.com".to_string())
        );
        // X-Other-Header should not match
        assert!(!result.contains_key("x-other-header"));
    }

    #[test]
    fn test_extract_passthrough_headers_mixed_patterns() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("user-agent", "curl/7.68.0".parse().unwrap());
        headers.insert("x-forwarded-for", "10.0.0.1".parse().unwrap());
        headers.insert("x-forwarded-proto", "http".parse().unwrap());
        headers.insert("x-request-id", "abc-123".parse().unwrap());

        let config = "x-forwarded-*,user-agent,x-request-id";
        let result = extract_passthrough_headers(&headers, config);

        assert_eq!(result.len(), 4);
        assert!(result.contains_key("user-agent"));
        assert!(result.contains_key("x-forwarded-for"));
        assert!(result.contains_key("x-forwarded-proto"));
        assert!(result.contains_key("x-request-id"));
    }

    #[test]
    fn test_extract_passthrough_headers_empty_config() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("user-agent", "test".parse().unwrap());

        let config = "";
        let result = extract_passthrough_headers(&headers, config);

        assert!(result.is_empty());
    }

    #[test]
    fn test_extract_passthrough_headers_case_insensitive() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("USER-AGENT", "test-agent".parse().unwrap());
        headers.insert("X-FORWARDED-FOR", "1.2.3.4".parse().unwrap());

        let config = "User-Agent,x-forwarded-for";
        let result = extract_passthrough_headers(&headers, config);

        assert_eq!(result.len(), 2);
        assert_eq!(result.get("user-agent"), Some(&"test-agent".to_string()));
        assert_eq!(result.get("x-forwarded-for"), Some(&"1.2.3.4".to_string()));
    }

    #[test]
    fn test_extract_passthrough_headers_whitespace_handling() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("user-agent", "test".parse().unwrap());
        headers.insert("x-custom", "value".parse().unwrap());

        let config = " user-agent , x-custom , ";
        let result = extract_passthrough_headers(&headers, config);

        assert_eq!(result.len(), 2);
        assert!(result.contains_key("user-agent"));
        assert!(result.contains_key("x-custom"));
    }

    #[cfg(feature = "enterprise")]
    fn incident_rca_context() -> RcaContext {
        RcaContext {
            subject_type: config::meta::oncall::subject::SubjectType::Incident,
            subject_id: "inc-1".to_string(),
            incident_id: Some("inc-1".to_string()),
            org_id: "org-a".to_string(),
            previous_analysis: None,
            severity: Some(config::meta::alerts::priority::AlertPriority::P2),
            past_causes: vec!["disk full".to_string()],
            alert_name: None,
            stream: None,
            dimensions: None,
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn rca_gate_is_the_rca_trigger_route_permission() {
        let route = incident_rca_route("org-a", "inc-1").unwrap();
        assert_eq!(route.method, "POST");
        assert_eq!(route.o2_type, "incidents:org-a");
        assert_eq!(route.org_id, "org-a");
        assert!(route.use_all_org);
        assert!(!route.bypass_check);
        assert_eq!(route.parent_id, "");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn rca_context_keys_cover_the_rca_contract() {
        let mut full = incident_rca_context();
        full.previous_analysis = Some("earlier".to_string());
        full.alert_name = Some("a".to_string());
        full.stream = Some("s".to_string());
        full.dimensions = Some(serde_json::json!({"k": "v"}));
        let json = serde_json::to_value(full).unwrap();
        for key in json.as_object().unwrap().keys() {
            assert!(
                key == "org_id" || RCA_CONTEXT_KEYS.contains(&key.as_str()),
                "{key} missing from RCA_CONTEXT_KEYS"
            );
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn failed_check_uses_default_agent_without_rca_keys() {
        let mut context = serde_json::json!({
            "org_id": "org-a",
            "stream_name": "default",
            "agent_type": "sre",
            "is_reanalysis": true,
        });
        for key in RCA_CHAT_CLIENT_KEYS {
            context[key] = serde_json::json!("display");
        }
        let forged = serde_json::to_value(incident_rca_context()).unwrap();
        for (key, value) in forged.as_object().unwrap() {
            if key != "org_id" {
                context[key] = value.clone();
            }
        }
        context["previous_analysis"] = serde_json::json!("forged");
        context["alert_name"] = serde_json::json!("forged");
        context["stream"] = serde_json::json!("forged");
        context["dimensions"] = serde_json::json!({"forged": true});

        let (agent, context) = select_chat_agent(context, None);
        assert_eq!(agent, DEFAULT_AGENT_TYPE);
        let obj = context.as_object().unwrap();
        for key in [
            "subject_type",
            "subject_id",
            "incident_id",
            "previous_analysis",
            "severity",
            "past_causes",
            "alert_name",
            "stream",
            "dimensions",
            "is_reanalysis",
        ] {
            assert!(!obj.contains_key(key), "{key} must be stripped: {context}");
        }
        assert_eq!(context["stream_name"], "default");
        assert_eq!(context["org_id"], "org-a");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn passed_check_replaces_client_rca_fields_with_server_values() {
        let client = serde_json::json!({
            "org_id": "org-a",
            "agent_type": "sre",
            "incident_id": "inc-1",
            "subject_type": "alert",
            "subject_id": "forged",
            "previous_analysis": "forged",
            "severity": "P1",
            "past_causes": ["forged"],
            "alert_name": "forged",
            "is_reanalysis": true,
            "stream_name": "default",
            "incident_title": "Checkout errors",
            "request_timestamp": 1_700_000_000_000_000_i64,
            "user_timezone": "Europe/Berlin",
        });

        let (agent, context) = select_chat_agent(client, Some(incident_rca_context()));
        assert_eq!(agent, RCA_AGENT_TYPE);
        assert_eq!(
            context,
            serde_json::json!({
                "subject_type": "incident",
                "subject_id": "inc-1",
                "incident_id": "inc-1",
                "org_id": "org-a",
                "severity": 2,
                "past_causes": ["disk full"],
                "incident_title": "Checkout errors",
                "request_timestamp": 1_700_000_000_000_000_i64,
                "user_timezone": "Europe/Berlin",
            })
        );
    }
}
