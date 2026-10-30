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

//! AI chat handlers: legacy `PromptRequest`s forwarded to the o2-ai agent service.

use axum::{
    Json,
    body::Body,
    extract::{FromRequestParts, Path},
    http::StatusCode,
    response::{IntoResponse, Response},
};
#[cfg(feature = "enterprise")]
use config::meta::oncall::rca::RcaContext;
use openobserve_api_common::{
    X_O2_ASSISTANT_SESSION_ID, X_O2_ASSISTANT_TURN_ID, extractors::Headers,
};
use serde::Deserialize;
#[cfg(feature = "enterprise")]
use {
    futures::StreamExt,
    o2_enterprise::enterprise::{
        ai::{
            agent::meta::Role,
            chat::{PersistSettings, TurnCaps, TurnEnd, TurnIdentity, TurnSpec, spawn_turn},
            client::{
                DEFAULT_AGENT_TYPE, ImageAttachment, QueryRequest, RCA_AGENT_TYPE,
                SESSION_OWNER_UNAVAILABLE, get_agent_client, is_session_owner_unavailable,
            },
        },
        common::{
            auditor::{AuditMessage, DelegatedAudit, Protocol, ResponseMeta},
            config::get_config as get_o2_config,
        },
    },
    openobserve_api_common::auth::delegation::DelegatedCaller,
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::ai::{PromptRequest, PromptResponse},
};

/// Context flag telling o2-ai that `history` is a forked share's transcript, not the caller's own.
#[cfg(feature = "enterprise")]
const FORK_SEED_CONTEXT_KEY: &str = "o2_fork_seed";

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

/// Set by the Slack bridge as `<team>:<channel>:<event_id>`; trusted only on a delegated call.
pub const SLACK_EVENT_HEADER: &str = "x-o2-slack-event";
const SLACK_REDACTED: &str = "[REDACTED: slack]";
/// o2-ai refuses `confirm_timeout_secs` outside 1..=600 with a 422.
#[cfg(feature = "enterprise")]
const MAX_CONFIRM_TIMEOUT_SECS: u32 = 600;

/// The audit identity shared by every record of one `chat_stream` call.
#[cfg(feature = "enterprise")]
struct ChatAudit {
    user_id: String,
    org_id: String,
    trace_id: String,
    protocol: Protocol,
    body: String,
    delegated: Option<DelegatedAudit>,
}

#[cfg(feature = "enterprise")]
impl ChatAudit {
    /// A Slack turn is audited without the question text, which stays in Slack.
    fn new(
        headers: &axum::http::HeaderMap,
        delegated: Option<&DelegatedCaller>,
        user_id: &str,
        org_id: &str,
        trace_id: &str,
        prompt: &PromptRequest,
    ) -> Self {
        let (protocol, body) = if delegated.is_some() {
            let event = headers
                .get(SLACK_EVENT_HEADER)
                .and_then(|v| v.to_str().ok());
            let body = serde_json::to_value(prompt).unwrap_or_default();
            (Protocol::Slack, slack_audit_body(body, event))
        } else {
            (
                Protocol::Http,
                serde_json::to_string(prompt).unwrap_or_default(),
            )
        };
        Self {
            user_id: user_id.to_string(),
            org_id: org_id.to_string(),
            trace_id: trace_id.to_string(),
            protocol,
            body,
            delegated: delegated.map(|caller| DelegatedAudit {
                link_id: caller.link_id.clone(),
                jti: caller.jti.clone(),
            }),
        }
    }

    /// Built here, not by `report_with_protocol`, which has no `delegated` parameter (request 20).
    fn message(&self, code: u16, error_message: Option<String>) -> AuditMessage {
        AuditMessage {
            user_email: self.user_id.clone(),
            org_id: self.org_id.clone(),
            _timestamp: config::utils::time::now_micros(),
            protocol: self.protocol.clone(),
            response_meta: ResponseMeta {
                http_method: "POST".to_string(),
                http_path: format!("/api/{}/ai/chat_stream", self.org_id),
                http_query_params: String::new(),
                http_body: self.body.clone(),
                http_response_code: code,
                error_msg: error_message,
                trace_id: Some(self.trace_id.clone()),
            },
            delegated: self.delegated.clone(),
        }
    }

    async fn report(&self, code: u16, error_message: Option<String>) {
        if get_o2_config().common.audit_enabled {
            audit::audit(self.message(code, error_message)).await;
        }
    }
}

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

/// An existing chat keeps its stored agent, so an Ask chat reopened over an incident never becomes
/// an RCA run.
#[cfg(feature = "enterprise")]
async fn session_agent_and_context(
    org_id: &str,
    user_id: &str,
    session_id: Option<&str>,
    context: serde_json::Value,
) -> (&'static str, serde_json::Value) {
    let stored = match session_id.and_then(openobserve_core::ai_chat::admission::normalize_uuid) {
        Some(id) => match infra::table::ai_chat_sessions::get(org_id, &id).await {
            Ok(row) => row.map(|row| row.agent_type),
            Err(e) => {
                log::warn!("[org_id:{org_id}] cannot read the agent of chat {id}: {e}");
                None
            }
        },
        None => None,
    };
    if keeps_default_agent(stored.as_deref()) {
        return select_chat_agent(context, None);
    }
    chat_agent_and_context(org_id, user_id, context).await
}

#[cfg(feature = "enterprise")]
fn keeps_default_agent(stored_agent_type: Option<&str>) -> bool {
    stored_agent_type.is_some_and(|agent| agent != RCA_AGENT_TYPE)
}

/// Matches the RCA endpoint: RCA enabled, incident in this org, and its `POST .../rca` permission.
#[cfg(feature = "enterprise")]
pub(crate) async fn can_run_incident_rca(org_id: &str, user_id: &str, incident_id: &str) -> bool {
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

/// The agent context: the path org, plus a fork seed only when the Slack bridge sent it.
#[cfg(feature = "enterprise")]
fn agent_context(
    context: &serde_json::Map<String, serde_json::Value>,
    org_id: &str,
    delegated: bool,
) -> serde_json::Value {
    let mut context = serde_json::Value::Object(context.clone());
    if let Some(obj) = context.as_object_mut() {
        obj.insert("org_id".to_string(), org_id.into());
        if !delegated {
            obj.remove(FORK_SEED_CONTEXT_KEY);
        }
    }
    context
}

#[cfg(feature = "enterprise")]
fn confirm_timeout(requested: Option<u32>) -> Option<u32> {
    requested
        .filter(|secs| *secs > 0)
        .map(|secs| secs.min(MAX_CONFIRM_TIMEOUT_SECS))
}

/// A hyphenated UUID only: the id lands in outbound URLs and routing keys (a URN would carry `:`).
fn is_valid_session_id(val: &str) -> bool {
    val.len() == 36 && uuid::Uuid::try_parse(val).is_ok()
}

/// The confirm body with `org_id` set to the path org, which the auth middleware
/// has checked the caller belongs to; `None` unless the body is a JSON object.
///
/// Any client-sent `org_id` is overwritten: o2-ai refuses a confirmation whose
/// recorded org differs, so it must only ever see the org the caller was
/// authorized for.
#[cfg(any(feature = "enterprise", test))]
fn bind_confirm_body_to_org(body: &[u8], org_id: &str) -> Option<Vec<u8>> {
    let mut value: serde_json::Value = serde_json::from_slice(body).ok()?;
    value
        .as_object_mut()?
        .insert("org_id".to_string(), serde_json::Value::from(org_id));
    serde_json::to_vec(&value).ok()
}

/// Cross-site forms cannot send JSON without a CORS preflight, so every state change requires it.
fn require_json(headers: &axum::http::HeaderMap) -> Result<(), Response> {
    let is_json = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"));
    if is_json {
        return Ok(());
    }
    Err((
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        Json(MetaHttpResponse::error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Content-Type must be application/json",
        )),
    )
        .into_response())
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
        AiUsageAuthorizationError::PaymentRequired {
            message,
            remedy,
            payer_org_id,
        } => (
            StatusCode::PAYMENT_REQUIRED,
            Json(serde_json::json!({
                "code": StatusCode::PAYMENT_REQUIRED.as_u16(),
                "message": message,
                "error_type": "ai_credits_exhausted",
                "remedy": remedy,
                "payer_org_id": payer_org_id,
            })),
        )
            .into_response(),
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
            ai_authorization_error_response(AiUsageAuthorizationError::PaymentRequired {
                message: "AI credit limit was reached while the request was running.".to_string(),
                remedy: openobserve_core::trial_quota::PaymentRemedy::Retry,
                payer_org_id: None,
            })
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
                "error_code": SESSION_OWNER_UNAVAILABLE,
            })),
        )
            .into_response();
    }
    let status = o2_enterprise::enterprise::ai::client::upstream_error_status(&error)
        .and_then(|status| StatusCode::from_u16(status).ok())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    let error_code = o2_enterprise::enterprise::ai::client::upstream_error_code(&error);
    (
        status,
        Json(serde_json::json!({
            "code": status.as_u16(),
            "error": message,
            "error_code": error_code,
        })),
    )
        .into_response()
}

/// Refuses a stop or confirmation on someone else's or an unknown persisted chat.
#[cfg(feature = "enterprise")]
async fn check_chat_owner(
    headers: &axum::http::HeaderMap,
    org_id: &str,
    session_id: &str,
) -> Result<(), Response> {
    // Without persistence there is no index row; the session id the caller must know scopes it.
    if !o2_enterprise::enterprise::ai::chat::is_enabled() {
        return Ok(());
    }
    let user_id = headers
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let owner = openobserve_core::ai_chat::admission::resolve_owner(user_id)
        .await
        .map_err(super::chats::admit_error_response)?;
    match infra::table::ai_chat_sessions::get(org_id, session_id).await {
        Ok(Some(row))
            if row.user_id == owner
                && row.status == infra::table::ai_chat_sessions::STATUS_ACTIVE =>
        {
            Ok(())
        }
        // Someone else's, deleted or unknown: indistinguishable to the caller.
        Ok(_) => Err(MetaHttpResponse::not_found("Unknown conversation")),
        Err(e) => {
            log::error!("[AI-CHAT] cannot read session {org_id}/{session_id}: {e}");
            Err(MetaHttpResponse::internal_error(
                "Could not read the conversation",
            ))
        }
    }
}

/// A chat cancel's response: the stop, o2-ai's own refusal relayed, or a retryable 500.
#[cfg(feature = "enterprise")]
fn cancel_response(
    outcome: Result<
        openobserve_core::ai_chat::cancel::ChatCancel,
        openobserve_core::ai_chat::cancel::ChatCancelError,
    >,
) -> Response {
    use openobserve_core::ai_chat::cancel::ChatCancelError;

    match outcome {
        Ok(stopped) => MetaHttpResponse::json(
            serde_json::json!({"cancelled": stopped.cancelled, "active": stopped.active}),
        ),
        Err(ChatCancelError::Upstream { status, body }) => {
            let status = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            let json = serde_json::from_str::<serde_json::Value>(&body)
                .unwrap_or_else(|_| serde_json::json!({"message": body}));
            (status, axum::Json(json)).into_response()
        }
        Err(ChatCancelError::Unanswered) => {
            MetaHttpResponse::internal_error("Failed to cancel the response; please retry")
        }
    }
}

/// Request headers matching the passthrough patterns (exact names or `prefix*`).
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

/// The audit body of a Slack turn: the question stays in Slack, `slack_event` names the message.
pub fn slack_audit_body(mut body: serde_json::Value, slack_event: Option<&str>) -> String {
    match body.as_object_mut() {
        Some(obj) => {
            obj.insert("messages".to_string(), SLACK_REDACTED.into());
            obj.insert("slack_event".to_string(), slack_event.into());
        }
        None => body = SLACK_REDACTED.into(),
    }
    body.to_string()
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
    let (mut parts, body) = in_req.into_parts();
    if let Err(resp) = require_json(&parts.headers) {
        return resp;
    }

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

        // Quota is checked here, but a credit is only consumed once the upstream succeeds.
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

        let passthrough_config = ""; // TODO: Replace with config.ai.passthrough_headers once field is added
        let passthrough_headers = extract_passthrough_headers(&parts.headers, passthrough_config);

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

        let delegated = parts.extensions.get::<DelegatedCaller>().is_some();
        let context = agent_context(&prompt_body.context, org_id_str, delegated);

        // An existing chat keeps its stored agent; resolve before context moves into QueryRequest.
        let session_header = parts
            .headers
            .get(X_O2_ASSISTANT_SESSION_ID.as_str())
            .and_then(|v| v.to_str().ok());
        let (agent_type, context) =
            session_agent_and_context(org_id_str, user_id, session_header, context).await;

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
            // Set by persistence admission below; absent, o2-ai streams as before.
            turn_id: None,
            known_seq: None,
            known_opencode_session_id: None,
            session_epoch: None,
            confirm_timeout_secs: confirm_timeout(prompt_body.confirm_timeout_secs),
            ..QueryRequest::new(last_user_message, context)
        };

        // Without it every call lands on an arbitrary replica, which starts a new session.
        let mut forward_headers = std::collections::HashMap::new();
        if let Some(session_id) = parts.headers.get(X_O2_ASSISTANT_SESSION_ID.as_str())
            && let Ok(val) = session_id.to_str()
        {
            // A persisted chat is only continued through admission (owner check, epoch fence).
            if o2_enterprise::enterprise::ai::chat::is_enabled() {
                return MetaHttpResponse::bad_request(
                    "Use /ai/chat_stream to continue a conversation while chat persistence is \
                     enabled",
                );
            }
            if is_valid_session_id(val) {
                forward_headers.insert(
                    X_O2_ASSISTANT_SESSION_ID.as_str().to_string(),
                    val.to_ascii_lowercase(),
                );
            } else {
                return MetaHttpResponse::bad_request("Invalid session id");
            }
        }

        // No span here, so the caller's traceparent joins the agent's spans to its trace.
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

        // Merged last and never overriding the headers set above.
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
    let (mut parts, body) = in_req.into_parts();
    if let Err(resp) = require_json(&parts.headers) {
        return resp;
    }

    // Extract TraceInfo from headers
    let auth_data = match Headers::<TraceInfo>::from_request_parts(&mut parts, &()).await {
        Ok(Headers(data)) => data,
        Err(e) => return e.into_response(),
    };

    let trace_id = auth_data.get_trace_id();
    let user_id = auth_data.user_id.clone();

    // OTel API directly: tracing-opentelemetry spans in async_stream! are not exported.
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

    // The browser's id for this turn, so a retried request does not run the model twice.
    let persist_turn_id = parts
        .headers
        .get(X_O2_ASSISTANT_TURN_ID.as_str())
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    // Extract and validate session ID (UUID v7 format: 8-4-4-4-12 hex digits)
    if let Some(session_id) = parts.headers.get(X_O2_ASSISTANT_SESSION_ID.as_str())
        && let Ok(val) = session_id.to_str()
    {
        if is_valid_session_id(val) {
            // One chat per UUID whatever its spelling: the id keys the index row and the routing.
            forward_headers.insert(
                X_O2_ASSISTANT_SESSION_ID.as_str().to_string(),
                val.to_ascii_lowercase(),
            );
        } else {
            // Rejected, not dropped: an arbitrary replica would read as the assistant forgetting.
            log::warn!("[trace_id:{}] Invalid session ID format: {}", trace_id, val);
            return MetaHttpResponse::bad_request("Invalid session id");
        }
    }

    // A traceparent from the ai.chat_stream span, so the agent's parent is this span.
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
        let passthrough_config = ""; // TODO: Replace with _config.ai.passthrough_headers once field is added
        let passthrough_headers = extract_passthrough_headers(&parts.headers, passthrough_config);
        // Never overrides a header already set (session id, traceparent).
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
        let caller = parts.extensions.get::<DelegatedCaller>();
        let delegated = caller.is_some();
        let audit = ChatAudit::new(
            &parts.headers,
            caller,
            &user_id,
            &org_id_str,
            &trace_id,
            &prompt_body,
        );

        // Check if AI/agent is enabled
        if !get_o2_config().ai.enabled {
            audit
                .report(
                    StatusCode::BAD_REQUEST.as_u16(),
                    Some("AI is not enabled".to_string()),
                )
                .await;
            return MetaHttpResponse::bad_request("AI is not enabled");
        }

        // Quota is checked here; the credit is deducted only after the upstream accepts the stream.
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
                audit
                    .report(
                        StatusCode::BAD_REQUEST.as_u16(),
                        Some("Agent service not configured".to_string()),
                    )
                    .await;
                return MetaHttpResponse::bad_request("Agent service not configured");
            }
        };

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

        let context = agent_context(&prompt_body.context, &org_id_str, delegated);

        // An existing chat keeps its stored agent; resolve before context moves into QueryRequest.
        let (agent_type, context) = session_agent_and_context(
            &org_id_str,
            &user_id,
            forward_headers
                .get(X_O2_ASSISTANT_SESSION_ID.as_str())
                .map(String::as_str),
            context,
        )
        .await;

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
            // Set by persistence admission below; absent, o2-ai streams as before.
            turn_id: None,
            known_seq: None,
            known_opencode_session_id: None,
            session_epoch: None,
            confirm_timeout_secs: confirm_timeout(prompt_body.confirm_timeout_secs),
            ..QueryRequest::new(last_user_message, context)
        };

        let headers_to_forward = if forward_headers.is_empty() {
            None
        } else {
            Some(forward_headers)
        };

        // With persistence on, a background task owns the turn; a closed tab drops only its feed.
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
            )
            .await
            {
                Ok(seed) => seed,
                Err(resp) => return resp,
            };
            let admitted = match openobserve_core::ai_chat::admission::admit_turn(
                &org_id_str,
                session_id.as_deref(),
                persist_turn_id.as_deref(),
                &user_id,
                agent_type,
                &query_req.query,
                &trace_id,
                TurnCaps::from_config(),
            )
            .await
            {
                Ok(admitted) => admitted,
                Err(e) => return super::chats::admit_error_response(e),
            };
            #[cfg(feature = "cloud")]
            if let Err(error) = openobserve_core::trial_quota::authorize_ai_usage(
                &org_id_str,
                openobserve_core::trial_quota::TrialQuotaFeature::AiChat,
                &usage_ctx,
            )
            .await
            {
                openobserve_core::ai_chat::admission::abandon_turn(admitted, "usage_denied").await;
                return ai_post_upstream_authorization_error_response(error);
            }
            let mut query_req = query_req;
            openobserve_core::ai_chat::admission::apply_admission(&mut query_req, &admitted);
            let openobserve_core::ai_chat::admission::AdmittedTurn {
                row,
                owner,
                turn_id,
                lease,
                registration,
            } = admitted;
            audit.report(StatusCode::OK.as_u16(), None).await;
            let session_id = row.session_id.clone();

            if row.last_committed_seq == infra::table::ai_chat_sessions::NO_SEQ
                && let Some(seed) = fork_seed
            {
                query_req.history = Some(seed);
                if let Some(context) = query_req.context.as_object_mut() {
                    context.insert(FORK_SEED_CONTEXT_KEY.to_string(), true.into());
                }
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
                    registration,
                    // The span outlives this response, so the task ends it.
                    on_end: Some(Box::new(move |_end: TurnEnd| {
                        if let Some(span_cx) = span_for_task {
                            use opentelemetry::trace::TraceContextExt;
                            span_cx.span().end();
                        }
                    })),
                    on_commit: None,
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

        // The upstream accepts before headers or usage go out, so startup errors keep statuses.
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
                audit
                    .report(
                        response.status().as_u16(),
                        Some("Upstream AI request failed".to_string()),
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
            audit
                .report(
                    response.status().as_u16(),
                    Some("AI credit authorization failed after upstream acceptance".to_string()),
                )
                .await;
            return response;
        }

        audit.report(StatusCode::OK.as_u16(), None).await;

        // Keep the OTel span alive for the full stream.
        let s = async_stream::stream! {
            let mut agent_stream = response.bytes_stream();

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
            // The BatchSpanProcessor exports a span only once it has ended.
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

/// Forwards feedback on an AI response to o2-ai, which records it.
pub async fn feedback(Path(org_id): Path<String>, in_req: axum::extract::Request) -> Response {
    let (parts, body) = in_req.into_parts();
    if let Err(resp) = require_json(&parts.headers) {
        return resp;
    }

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

    // Rejected rather than dropped: feedback is recorded on the owning replica.
    if let Some(session_id) = parts.headers.get(X_O2_ASSISTANT_SESSION_ID.as_str())
        && let Ok(val) = session_id.to_str()
    {
        if is_valid_session_id(val) {
            forward_headers.insert(
                X_O2_ASSISTANT_SESSION_ID.as_str().to_string(),
                val.to_ascii_lowercase(),
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
        if let Some(session_id) = forward_headers.get(X_O2_ASSISTANT_SESSION_ID.as_str())
            && let Err(resp) = check_chat_owner(&parts.headers, &org_id, session_id).await
        {
            return resp;
        }

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
    Path((org_id, session_id)): Path<(String, String)>,
    in_req: axum::extract::Request,
) -> Response {
    let (parts, body) = in_req.into_parts();
    if let Err(resp) = require_json(&parts.headers) {
        return resp;
    }

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

        // Validated before this caller-supplied segment is interpolated into an outbound URL.
        if !is_valid_session_id(&session_id) {
            return MetaHttpResponse::bad_request("Invalid session id");
        }
        let session_id = session_id.to_ascii_lowercase();
        if let Err(resp) = check_chat_owner(&parts.headers, &org_id, &session_id).await {
            return resp;
        }

        // Extract user auth from headers to pass to the agent
        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;

        // The session id alone names no org, so pass the authorized one along:
        // o2-ai refuses to answer a confirmation recorded for a different org.
        let Some(forward_bytes) = bind_confirm_body_to_org(&body_bytes, &org_id) else {
            return MetaHttpResponse::bad_request("Confirmation body must be a JSON object");
        };

        // The client routes the confirm to the replica holding the paused turn.
        match client
            .confirm_action(&session_id, forward_bytes, &auth_str)
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
        drop(org_id);
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
        (status = StatusCode::UNSUPPORTED_MEDIA_TYPE, description = "The body is not JSON (send {})", body = Object),
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
    if let Err(resp) = require_json(&parts.headers) {
        return resp;
    }

    #[cfg(feature = "enterprise")]
    {
        if !get_o2_config().ai.enabled {
            return MetaHttpResponse::bad_request("AI is not enabled");
        }
        // Validated before it reaches an outbound URL and a routing key.
        if !is_valid_session_id(&session_id) {
            return MetaHttpResponse::bad_request("Invalid session id");
        }
        let session_id = session_id.to_ascii_lowercase();
        if let Err(resp) = check_chat_owner(&parts.headers, &org_id, &session_id).await {
            return resp;
        }
        let auth_str = openobserve_core::auth::extract_auth_str_from_headers(&parts.headers).await;
        cancel_response(
            openobserve_core::ai_chat::cancel::cancel_chat_turn(&org_id, &session_id, &auth_str)
                .await,
        )
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

    #[cfg(feature = "cloud")]
    #[tokio::test]
    async fn payment_required_carries_its_remedy() {
        use openobserve_core::trial_quota::{AiUsageAuthorizationError, PaymentRemedy};

        for (remedy, expected) in [
            (PaymentRemedy::Subscribe, "subscribe"),
            (
                PaymentRemedy::ContactAccountManager,
                "contact_account_manager",
            ),
            (PaymentRemedy::Retry, "retry"),
        ] {
            let response =
                ai_authorization_error_response(AiUsageAuthorizationError::PaymentRequired {
                    message: "out".to_string(),
                    remedy,
                    payer_org_id: Some("payer".to_string()),
                });
            assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED);
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(body["error_type"], "ai_credits_exhausted");
            assert_eq!(body["remedy"], expected);
            assert_eq!(body["message"], "out");
            assert_eq!(body["payer_org_id"], "payer");
        }
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
        assert_eq!(body["error_code"], SESSION_OWNER_UNAVAILABLE);
    }

    /// A stand-in o2-ai answering every streamed turn with `status` and `body`, as FastAPI would.
    #[cfg(feature = "enterprise")]
    async fn o2ai_refusing(status: u16, body: &'static str) -> String {
        use axum::{Router, routing::post};

        let app = Router::new().route(
            "/o2_agent/{agent}/query/stream",
            post(move || async move {
                (
                    StatusCode::from_u16(status).unwrap(),
                    [("content-type", "application/json")],
                    body,
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    /// What `chat_stream` answers (persistence off) when the real client meets that o2-ai.
    #[cfg(feature = "enterprise")]
    async fn upstream_refusal(base: &str) -> (StatusCode, serde_json::Value) {
        let client =
            o2_enterprise::enterprise::ai::client::AiAgentClient::new(base, false).unwrap();
        let error = client
            .query_stream(
                DEFAULT_AGENT_TYPE,
                QueryRequest::new("q".to_string(), serde_json::json!({})),
                "Bearer o2dt.x.y",
            )
            .await
            .unwrap_err();
        let response = ai_upstream_error_response(error);
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn every_o2ai_refusal_code_reaches_the_body_as_error_code() {
        for (status, body, code) in [
            (
                404,
                r#"{"detail":{"code":"session_not_found","session_id":"s1","reason":"unknown"}}"#,
                "session_not_found",
            ),
            (
                409,
                r#"{"detail":{"code":"turn_in_progress","message":"another turn of this conversation is still running"}}"#,
                "turn_in_progress",
            ),
            (
                409,
                r#"{"detail":{"code":"session_owner_unavailable"}}"#,
                "session_owner_unavailable",
            ),
            (
                400,
                r#"{"detail":{"code":"epoch_out_of_range","message":"x","session_epoch":9,"current_epoch":2}}"#,
                "epoch_out_of_range",
            ),
            (
                503,
                r#"{"code":"internal_secret_required"}"#,
                "internal_secret_required",
            ),
        ] {
            let (got, json) = upstream_refusal(&o2ai_refusing(status, body).await).await;
            assert_eq!(json["error_code"], code, "{json}");
            let want = if code == "session_owner_unavailable" {
                StatusCode::CONFLICT
            } else {
                StatusCode::from_u16(status).unwrap()
            };
            assert_eq!(got, want, "{json}");
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_codeless_or_unreachable_upstream_still_carries_error_code() {
        let (status, json) =
            upstream_refusal(&o2ai_refusing(429, r#"{"detail":"slow"}"#).await).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert!(json["error_code"].is_null(), "{json}");
        assert!(json.as_object().unwrap().contains_key("error_code"));

        let (status, json) = upstream_refusal("http://127.0.0.1:9").await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(
            json.as_object().unwrap().contains_key("error_code"),
            "{json}"
        );
    }

    #[cfg(feature = "enterprise")]
    fn prompt(context: serde_json::Value) -> PromptRequest {
        serde_json::from_value(serde_json::json!({
            "messages": [{"role": "user", "content": "why are checkouts failing?"}],
            "context": context,
            "confirm_timeout_secs": 900,
        }))
        .unwrap()
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn fork_seed_kept_only_for_delegated() {
        let body = prompt(serde_json::json!({"o2_fork_seed": true, "currentPage": "slack"}));
        let browser = agent_context(&body.context, "prod", false);
        assert!(browser.get(FORK_SEED_CONTEXT_KEY).is_none(), "{browser}");
        assert_eq!(browser["org_id"], "prod");
        let slack = agent_context(&body.context, "prod", true);
        assert_eq!(slack[FORK_SEED_CONTEXT_KEY], true);
        assert_eq!(slack["org_id"], "prod");
        assert_eq!(slack["currentPage"], "slack");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn confirm_timeout_is_capped_at_600_and_zero_means_unset() {
        assert_eq!(
            prompt(serde_json::json!({})).confirm_timeout_secs,
            Some(900)
        );
        assert_eq!(confirm_timeout(Some(900)), Some(600));
        assert_eq!(confirm_timeout(Some(600)), Some(600));
        assert_eq!(confirm_timeout(Some(30)), Some(30));
        assert_eq!(confirm_timeout(Some(0)), None);
        assert_eq!(confirm_timeout(None), None);
    }

    #[cfg(feature = "enterprise")]
    fn slack_event_headers() -> axum::http::HeaderMap {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(SLACK_EVENT_HEADER, "T0TEAM:C0CHAN:Ev0001".parse().unwrap());
        headers
    }

    #[cfg(feature = "enterprise")]
    fn bridge_caller() -> DelegatedCaller {
        DelegatedCaller {
            link_id: "lnk_01".to_string(),
            installation_id: "inst_01".to_string(),
            org: "prod".to_string(),
            jti: "jti-0001".to_string(),
            scope: config::utils::delegation::SCOPE_ASSISTANT.to_string(),
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_slack_turn_is_audited_without_the_question_and_with_its_slack_event() {
        let body = prompt(serde_json::json!({"currentPage": "slack"}));
        let caller = bridge_caller();
        let audit = ChatAudit::new(
            &slack_event_headers(),
            Some(&caller),
            "ann@acme.io",
            "prod",
            "t1",
            &body,
        );
        assert_eq!(audit.protocol, Protocol::Slack);
        assert!(!audit.body.contains("checkouts"), "{}", audit.body);
        let json: serde_json::Value = serde_json::from_str(&audit.body).unwrap();
        assert_eq!(json["messages"], SLACK_REDACTED);
        assert_eq!(json["slack_event"], "T0TEAM:C0CHAN:Ev0001");
        assert_eq!(json["context"]["currentPage"], "slack");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_slack_turn_record_names_the_link_and_the_token() {
        let caller = bridge_caller();
        let audit = ChatAudit::new(
            &slack_event_headers(),
            Some(&caller),
            "ann@acme.io",
            "prod",
            "t1",
            &prompt(serde_json::json!({})),
        );
        let message = audit.message(200, None);
        assert_eq!(
            message.delegated,
            Some(DelegatedAudit {
                link_id: "lnk_01".to_string(),
                jti: "jti-0001".to_string(),
            })
        );
        assert_eq!(message.protocol, Protocol::Slack);
        assert_eq!(message.response_meta.http_path, "/api/prod/ai/chat_stream");
        assert_eq!(message.response_meta.trace_id.as_deref(), Some("t1"));
        let json = serde_json::to_value(&message).unwrap();
        assert_eq!(
            json["delegated"],
            serde_json::json!({"link_id": "lnk_01", "jti": "jti-0001"})
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_browser_request_with_a_forged_slack_event_is_audited_in_full_as_http() {
        let body = prompt(serde_json::json!({}));
        let audit = ChatAudit::new(
            &slack_event_headers(),
            None,
            "ann@acme.io",
            "prod",
            "t1",
            &body,
        );
        assert_eq!(audit.protocol, Protocol::Http);
        let json: serde_json::Value = serde_json::from_str(&audit.body).unwrap();
        assert_eq!(json["messages"][0]["content"], "why are checkouts failing?");
        assert!(json.get("slack_event").is_none(), "{json}");
        assert_eq!(audit.body, serde_json::to_string(&body).unwrap());
        assert_eq!(audit.message(200, None).delegated, None);
    }

    #[test]
    fn the_slack_audit_body_drops_the_question_and_keeps_the_rest() {
        let body = serde_json::json!({
            "messages": [{"role": "user", "content": "why are checkouts failing?"}],
            "context": {"currentPage": "slack"},
        });
        let json: serde_json::Value =
            serde_json::from_str(&slack_audit_body(body, Some("T0TEAM:C0CHAN:Ev0001"))).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "messages": SLACK_REDACTED,
                "context": {"currentPage": "slack"},
                "slack_event": "T0TEAM:C0CHAN:Ev0001",
            })
        );
        assert_eq!(
            slack_audit_body(serde_json::json!("why are checkouts failing?"), None),
            serde_json::json!(SLACK_REDACTED).to_string()
        );
    }

    #[test]
    fn only_json_bodies_change_state() {
        let headers = |ct: &str| {
            let mut h = axum::http::HeaderMap::new();
            h.insert(axum::http::header::CONTENT_TYPE, ct.parse().unwrap());
            h
        };
        assert!(require_json(&headers("application/json")).is_ok());
        assert!(require_json(&headers("Application/JSON; charset=utf-8")).is_ok());
        for ct in [
            "text/plain",
            "application/x-www-form-urlencoded",
            "multipart/form-data",
        ] {
            let resp = require_json(&headers(ct)).unwrap_err();
            assert_eq!(resp.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE, "{ct}");
        }
        assert!(require_json(&axum::http::HeaderMap::new()).is_err());
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
        // `Uuid::try_parse` accepts all of these; a URN would carry `:` into the confirm URL.
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
    fn test_confirm_body_carries_the_path_org() {
        let bound = bind_confirm_body_to_org(br#"{"approved":true}"#, "acme").unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bound).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"approved": true, "org_id": "acme"})
        );
    }

    #[test]
    fn test_confirm_body_org_cannot_be_chosen_by_the_client() {
        let bound =
            bind_confirm_body_to_org(br#"{"approved":true,"org_id":"victim"}"#, "acme").unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bound).unwrap();
        assert_eq!(value["org_id"], "acme");
    }

    #[test]
    fn test_confirm_body_must_be_a_json_object() {
        assert!(bind_confirm_body_to_org(b"", "acme").is_none());
        assert!(bind_confirm_body_to_org(b"not json", "acme").is_none());
        assert!(bind_confirm_body_to_org(b"[true]", "acme").is_none());
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

    #[cfg(feature = "enterprise")]
    const STICKY_ROOT: &str = "root@sticky.chat.test";

    /// The SQLite meta store with incident analysis on and [STICKY_ROOT] as root; refuses other
    /// stores.
    #[cfg(feature = "enterprise")]
    async fn sticky_tables() -> &'static sea_orm::DatabaseConnection {
        use infra::table::entity::{ai_chat_sessions, alert_incidents};
        use sea_orm::{ConnectionTrait, Schema};

        static TABLES: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        TABLES
            .get_or_init(|| async {
                // SAFETY: set once inside the `OnceCell` initializer, before the refresh reads
                // them.
                unsafe {
                    std::env::set_var("O2_INCIDENTS_ENABLED", "true");
                    std::env::set_var("O2_INCIDENTS_RCA_ENABLED", "true");
                    std::env::set_var("O2_AGENT_URL", "http://127.0.0.1:1");
                }
                o2_enterprise::enterprise::common::config::refresh_config().unwrap();
                let cfg = config::get_config();
                assert!(
                    cfg.common.meta_store.is_empty() || cfg.common.meta_store == "sqlite",
                    "the sticky agent tests need the default SQLite meta store, found {:?}",
                    cfg.common.meta_store
                );
                std::fs::create_dir_all(&cfg.common.data_db_dir).unwrap();
                let conn = infra::db::get_orm_client_rw().await;
                let backend = conn.get_database_backend();
                let schema = Schema::new(backend);
                for mut table in [
                    schema.create_table_from_entity(alert_incidents::Entity),
                    schema.create_table_from_entity(ai_chat_sessions::Entity),
                ] {
                    conn.execute(backend.build(table.if_not_exists()))
                        .await
                        .unwrap();
                }
                common::infra::config::ORG_USERS.insert(
                    format!("{}/{STICKY_ROOT}", config::DEFAULT_ORG),
                    infra::table::org_users::OrgUserRecord::new(
                        config::DEFAULT_ORG,
                        STICKY_ROOT,
                        config::meta::user::UserRole::Root,
                        "token",
                        None,
                    ),
                );
            })
            .await;
        infra::db::get_orm_client_rw().await
    }

    #[cfg(feature = "enterprise")]
    async fn sticky_incident(conn: &sea_orm::DatabaseConnection, org_id: &str, incident_id: &str) {
        use infra::table::entity::alert_incidents;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let now = config::utils::time::now_micros();
        let row = alert_incidents::Model {
            id: incident_id.to_string(),
            org_id: org_id.to_string(),
            status: "open".to_string(),
            severity: "P2".to_string(),
            group_values: serde_json::json!({}),
            key_type: "alert_id".to_string(),
            topology_context: None,
            first_alert_at: now,
            last_alert_at: now,
            resolved_at: None,
            alert_count: 1,
            title: Some("checkout errors".to_string()),
            assigned_to: None,
            acknowledged_by: None,
            acknowledged_at: None,
            created_at: now,
            updated_at: now,
            muted_by_downtime_id: None,
            rca_run_id: None,
            rca_state: None,
            rca_started_at: None,
            rca_updated_at: None,
            rca_outcome: None,
            rca_confidence: None,
            rca_summary: None,
            rca_off_reason: None,
        };
        alert_incidents::Entity::insert(alert_incidents::ActiveModel::from(row).reset_all())
            .exec(conn)
            .await
            .unwrap();
    }

    #[cfg(feature = "enterprise")]
    async fn sticky_session(
        conn: &sea_orm::DatabaseConnection,
        org_id: &str,
        session_id: &str,
        agent_type: &str,
    ) {
        use infra::table::entity::ai_chat_sessions;
        use sea_orm::{ActiveModelTrait, EntityTrait};

        let row = ai_chat_sessions::Model {
            org_id: org_id.to_string(),
            session_id: session_id.to_string(),
            user_id: STICKY_ROOT.to_string(),
            user_email: STICKY_ROOT.to_string(),
            opencode_session_id: None,
            agent_type: agent_type.to_string(),
            title: "Analysis · run 2".to_string(),
            title_source: "prompt".to_string(),
            status: "active".to_string(),
            created_at: 1_000,
            updated_at: 1_000,
            first_event_at: None,
            last_event_at: None,
            last_committed_seq: infra::table::ai_chat_sessions::NO_SEQ,
            session_epoch: 0,
            last_turn_id: None,
            forked_from_share: None,
            fork_seed_seq: None,
            replica_purged_at: None,
        };
        ai_chat_sessions::Entity::insert(ai_chat_sessions::ActiveModel::from(row).reset_all())
            .exec(conn)
            .await
            .unwrap();
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_only_a_non_rca_row_keeps_the_default_agent() {
        assert!(!keeps_default_agent(None));
        assert!(!keeps_default_agent(Some(RCA_AGENT_TYPE)));
        assert!(keeps_default_agent(Some(DEFAULT_AGENT_TYPE)));
        assert!(keeps_default_agent(Some("sre")));
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_an_existing_chat_keeps_its_agent_and_a_new_one_picks_from_its_context() {
        let conn = sticky_tables().await;
        let org = format!(
            "sticky_{}",
            infra::table::rca_runs::new_run_id().to_lowercase()
        );
        let other_org = format!("{org}_other");
        let incident = format!("inc.{org}");
        sticky_incident(conn, &org, &incident).await;
        let ask_chat = sea_orm::prelude::Uuid::new_v4().to_string();
        let rca_chat = sea_orm::prelude::Uuid::new_v4().to_string();
        let new_chat = sea_orm::prelude::Uuid::new_v4().to_string();
        let foreign_chat = sea_orm::prelude::Uuid::new_v4().to_string();
        sticky_session(conn, &org, &ask_chat, DEFAULT_AGENT_TYPE).await;
        sticky_session(conn, &org, &rca_chat, RCA_AGENT_TYPE).await;
        sticky_session(conn, &other_org, &foreign_chat, DEFAULT_AGENT_TYPE).await;

        let context = serde_json::json!({
            "org_id": org,
            "currentPage": "incidents",
            "incident_id": incident,
            "subject_type": "incident",
            "subject_id": incident,
            "previous_analysis": "forged",
            "past_causes": ["forged"],
            "is_reanalysis": true,
            "incident_title": "Checkout errors",
        });
        let pick = async |session: Option<&str>, context: serde_json::Value| {
            session_agent_and_context(&org, STICKY_ROOT, session, context).await
        };

        for session in [ask_chat.clone(), ask_chat.to_uppercase()] {
            let (agent, picked) = pick(Some(&session), context.clone()).await;
            assert_eq!(agent, DEFAULT_AGENT_TYPE, "{session}");
            let obj = picked.as_object().unwrap();
            for key in RCA_CONTEXT_KEYS {
                assert!(!obj.contains_key(key), "{session}: {key} kept: {picked}");
            }
            assert_eq!(picked["currentPage"], "incidents", "{session}");
            assert_eq!(picked["org_id"], org.as_str(), "{session}");
        }

        for session in [
            Some(rca_chat.as_str()),
            Some(new_chat.as_str()),
            Some(foreign_chat.as_str()),
            None,
        ] {
            let (agent, picked) = pick(session, context.clone()).await;
            assert_eq!(agent, RCA_AGENT_TYPE, "{session:?}: {picked}");
            assert_eq!(picked["incident_id"], incident.as_str(), "{session:?}");
            assert_eq!(picked["subject_type"], "incident", "{session:?}");
            assert_eq!(picked["subject_id"], incident.as_str(), "{session:?}");
            assert!(picked.get("previous_analysis").is_none(), "{session:?}");
            assert_eq!(picked["incident_title"], "Checkout errors", "{session:?}");
        }

        let plain = serde_json::json!({"org_id": org, "currentPage": "logs"});
        let (agent, picked) = pick(Some(&new_chat), plain.clone()).await;
        assert_eq!(agent, DEFAULT_AGENT_TYPE);
        assert_eq!(picked, plain);
    }
}
