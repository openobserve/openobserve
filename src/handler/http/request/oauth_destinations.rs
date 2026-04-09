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

//! HTTP handlers for OAuth-based alert destinations.
//!
//! All OAuth flows are delegated to the destination-proxy service.
//! OpenObserve never holds provider client secrets.
//!
//! Route registration (in router/mod.rs):
//! ```
//! // Unauthenticated — proxy-initiated browser redirects / provider webhooks
//! /api/oauth/{provider}/proxy-callback    GET  — proxy redirects browser here after OAuth
//! /api/oauth/{provider}/events            POST — provider revocation webhooks (Slack etc.)
//!
//! // Authenticated — org-scoped
//! /api/{org_id}/oauth/{provider}/available  GET
//! /api/{org_id}/oauth/{provider}/start      GET
//! /api/{org_id}/oauth/{provider}/status     GET
//! /api/{org_id}/oauth/{provider}/channels   GET
//! /api/{org_id}/oauth/{provider}/test       POST
//! ```

use axum::{
    Json,
    extract::{Path, Query, Request},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::{get_config, meta::destinations::OAuthProvider};
use infra::table::{
    cipher::{self, EntryKind},
    sessions,
};
use serde::{Deserialize, Serialize};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    service::oauth_providers::{OAuthPendingSession, OAuthStatus, PROVIDER_REGISTRY},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn get_base_url() -> Option<String> {
    let base_url = &get_config().oauth_destinations.base_url;
    if base_url.is_empty() {
        return None;
    }
    Some(base_url.trim_end_matches('/').to_string())
}

// ---------------------------------------------------------------------------
// Response / request types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct AvailableResponse {
    pub enabled: bool,
    pub has_channel_picker: bool,
    pub display_name: String,
}

#[derive(Debug, Serialize)]
pub struct StartResponse {
    /// Authorization URL to open in the user's browser popup.
    pub oauth_url: String,
    /// Opaque state key used by /status polling (= proxy's session_id in proxy mode).
    pub state: String,
    pub connection_id: String,
}

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub status: String, // "pending" | "complete" | "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_reason: Option<String>,
    pub has_channel_picker: bool,
}

#[derive(Debug, Serialize)]
pub struct ChannelsResponse {
    pub channels: Vec<ChannelItem>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct ChannelItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_private: bool,
}

#[derive(Debug, Deserialize)]
pub struct TestRequest {
    pub channel_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TestResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct StartQuery {
    pub existing_connection_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StatusQuery {
    pub state: String,
}

#[derive(Debug, Deserialize)]
pub struct ChannelsQuery {
    pub state: Option<String>,
    pub connection_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TestQuery {
    pub state: Option<String>,
    pub connection_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ProxyCallbackQuery {
    /// Set on success: the session_id the proxy appended after the OAuth callback.
    pub session_id: Option<String>,
    /// Set on user-cancelled or provider error: the error code from the provider.
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// GET /api/{org_id}/oauth/{provider}/available
// ---------------------------------------------------------------------------

pub async fn available(Path((org_id, provider)): Path<(String, OAuthProvider)>) -> Response {
    let _ = org_id;
    let handler = match PROVIDER_REGISTRY.get(&provider) {
        Some(h) => h,
        None => {
            return MetaHttpResponse::json(AvailableResponse {
                enabled: false,
                has_channel_picker: false,
                display_name: format!("{provider}"),
            });
        }
    };

    let cfg = get_config();
    let o = &cfg.oauth_destinations;
    let enabled = !o.oauth_proxy_url.is_empty()
        && !o.oauth_proxy_api_key.is_empty()
        && get_base_url().is_some();

    MetaHttpResponse::json(AvailableResponse {
        enabled,
        has_channel_picker: handler.has_channel_picker(),
        display_name: handler.display_name().to_string(),
    })
}

// ---------------------------------------------------------------------------
// GET /api/{org_id}/oauth/{provider}/start
// ---------------------------------------------------------------------------

pub async fn start(
    Path((org_id, provider)): Path<(String, OAuthProvider)>,
    Query(q): Query<StartQuery>,
) -> Response {
    use crate::service::oauth_providers::proxy_client::{ProxyClient, StartRequest};

    if PROVIDER_REGISTRY.get(&provider).is_none() {
        return MetaHttpResponse::not_found(format!("Unknown provider: {provider}"));
    }

    let client = match ProxyClient::from_config() {
        Some(c) => c,
        None => {
            return MetaHttpResponse::bad_request(
                "OAuth proxy not configured (O2_OAUTH_PROXY_URL / O2_OAUTH_PROXY_API_KEY)",
            );
        }
    };

    // Per design: return_url is the OO base URL only.
    // The proxy appends /api/oauth/{provider}/proxy-callback?session_id=... itself.
    let return_url = match get_base_url() {
        Some(u) => u,
        None => return MetaHttpResponse::bad_request("O2_BASE_URL is not configured"),
    };

    // connection_id: reuse existing (reconnect) or generate new KSUID
    let connection_id = q
        .existing_connection_id
        .unwrap_or_else(|| config::ider::generate());

    let provider_str = provider.to_string();
    let req = StartRequest {
        provider: &provider_str,
        return_url: &return_url,
        org_id: &org_id,
        connection_id: &connection_id,
        instance_url: None, // ServiceNow instance_url: future extension
    };

    let proxy_resp = match client.start(&req).await {
        Ok(r) => r,
        Err(e) => {
            log::error!("OAuth proxy start failed for {provider}: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    // Store a pending session keyed by proxy's session_id.
    // The /status endpoint polls this key; proxy_callback updates it to Complete.
    let session = OAuthPendingSession {
        provider: provider.clone(),
        org_id: org_id.clone(),
        connection_id: connection_id.clone(),
        status: OAuthStatus::Pending,
        team_id: None,
        team_name: None,
        error_reason: None,
        access_token: None,
        refresh_token: None,
        expires_at_token: None,
    };

    let session_json = match serde_json::to_string(&session) {
        Ok(j) => j,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    let expires_at = chrono::Utc::now().timestamp() + 900; // 15 min TTL
    if let Err(e) =
        sessions::set_with_expiry(&proxy_resp.session_id, &session_json, expires_at).await
    {
        return MetaHttpResponse::internal_error(e);
    }

    MetaHttpResponse::json(StartResponse {
        oauth_url: proxy_resp.oauth_url,
        state: proxy_resp.session_id, // frontend polls /status with this
        connection_id,
    })
}

// ---------------------------------------------------------------------------
// GET /api/oauth/{provider}/proxy-callback  (unauthenticated — proxy-initiated)
//
// After the user approves in the provider UI, the destination-proxy:
//   1. Exchanges the code for tokens (using its own client secret)
//   2. Stores tokens as a handoff_nonce in its DashMap
//   3. Redirects the browser here with ?session_id=<id>
//
// This handler:
//   1. Calls proxy GET /api/proxy/session/{session_id} → handoff_nonce
//   2. Calls proxy POST /api/proxy/exchange → actual tokens
//   3. Updates the pending session in our sessions table to Complete
//   4. Returns a self-closing HTML page
// ---------------------------------------------------------------------------

pub async fn proxy_callback(
    Path(provider): Path<OAuthProvider>,
    Query(q): Query<ProxyCallbackQuery>,
) -> Response {
    use crate::service::oauth_providers::proxy_client::ProxyClient;

    fn error_html(reason: &str) -> axum::response::Response {
        let msg = match reason {
            "session_not_found" => {
                "Authorization session not found or expired. Please try again.".to_string()
            }
            "exchange_failed" => {
                "Failed to retrieve authorization token. Please try again.".to_string()
            }
            "proxy_not_configured" => {
                "Proxy is not configured. Contact your administrator.".to_string()
            }
            r => format!("Authorization failed: {r}. Please close this window and try again."),
        };
        axum::response::Html(format!(
            r#"<!doctype html>
<html><head><meta charset="utf-8"><title>Authorization Failed</title>
<style>body{{display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;background:#fef2f2;margin:0}}
.card{{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:360px;width:100%}}
.icon{{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#ef4444;color:#fff;font-size:1.75rem;font-weight:bold;margin-bottom:1rem}}
h2{{margin:0 0 .5rem;font-size:1.25rem;color:#111827}}p{{margin:0 0 .5rem;color:#6b7280;font-size:.9rem}}.hint{{color:#9ca3af;font-size:.8rem}}</style>
</head><body><div class="card"><div class="icon">✕</div>
<h2>Authorization Failed</h2><p>{msg}</p>
<p class="hint">This window will close automatically.</p>
</div><script>setTimeout(()=>window.close(),6000)</script>
</body></html>"#
        ))
        .into_response()
    }

    // Handle user-cancelled / provider error (proxy sends ?error=access_denied etc.)
    if let Some(ref err) = q.error {
        return error_html(err);
    }

    let session_id = match q.session_id {
        Some(ref s) => s.clone(),
        None => return error_html("missing_session_id"),
    };

    let client = match ProxyClient::from_config() {
        Some(c) => c,
        None => return error_html("proxy_not_configured"),
    };

    // Step 1: retrieve the one-time handoff_nonce from the proxy
    let handoff_nonce = match client.session(&session_id).await {
        Ok(Some(n)) => n,
        Ok(None) => {
            log::warn!("proxy_callback: session still pending for session_id={session_id}");
            return error_html("session_pending");
        }
        Err(e) => {
            log::error!("proxy_callback: session lookup failed: {e}");
            return error_html("session_not_found");
        }
    };

    // Step 2: exchange nonce for tokens (one-time use — proxy deletes it after)
    let token_resp = match client.exchange(&handoff_nonce).await {
        Ok(r) => r,
        Err(e) => {
            log::error!("proxy_callback: token exchange failed: {e}");
            return error_html("exchange_failed");
        }
    };

    // Step 3: update the pending session we created at /start
    let session_model = match sessions::get(&session_id).await {
        Ok(Some(m)) => m,
        Ok(None) => {
            log::error!("proxy_callback: local session missing for session_id={session_id}");
            return error_html("session_not_found");
        }
        Err(e) => {
            log::error!("proxy_callback: session DB error: {e}");
            return error_html("session_error");
        }
    };

    let mut session: OAuthPendingSession = match serde_json::from_str(&session_model.access_token) {
        Ok(s) => s,
        Err(_) => return error_html("session_corrupt"),
    };

    if session.provider != provider {
        return error_html("provider_mismatch");
    }

    session.status = OAuthStatus::Complete;
    session.team_id = token_resp.team_id;
    session.team_name = token_resp.team_name;
    session.access_token = Some(token_resp.access_token);
    session.refresh_token = token_resp.refresh_token;
    session.expires_at_token = token_resp.expires_at;

    let session_json = serde_json::to_string(&session).unwrap_or_default();
    // Extend TTL to 1 hour so user has time to complete the destination form
    let expires_at = chrono::Utc::now().timestamp() + 3600;
    if let Err(e) = sessions::set_with_expiry(&session_id, &session_json, expires_at).await {
        log::error!("proxy_callback: failed to update session: {e}");
        return error_html("session_update_failed");
    }

    axum::response::Html(
        r#"<!doctype html>
<html><head><meta charset="utf-8"><title>Connected!</title>
<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;background:#f9fafb;margin:0}
.card{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:360px;width:100%}
.icon{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#22c55e;color:#fff;font-size:1.75rem;font-weight:bold;margin-bottom:1rem}
h2{margin:0 0 .5rem;font-size:1.25rem;color:#111827}p{margin:0 0 .5rem;color:#6b7280;font-size:.9rem}.hint{color:#9ca3af;font-size:.8rem}</style>
</head><body><div class="card"><div class="icon">✓</div>
<h2>Connected!</h2>
<p>Authorization successful. You can close this window and return to OpenObserve.</p>
<p class="hint">This window will close automatically.</p>
</div><script>setTimeout(()=>window.close(),1500)</script>
</body></html>"#,
    )
    .into_response()
}

// ---------------------------------------------------------------------------
// GET /api/{org_id}/oauth/{provider}/status?state=...
// ---------------------------------------------------------------------------

pub async fn status(
    Path((org_id, provider)): Path<(String, OAuthProvider)>,
    Query(q): Query<StatusQuery>,
) -> Response {
    let handler = match PROVIDER_REGISTRY.get(&provider) {
        Some(h) => h,
        None => return MetaHttpResponse::not_found(format!("Unknown provider: {provider}")),
    };

    let session_model = match sessions::get(&q.state).await {
        Ok(Some(m)) => m,
        Ok(None) => return MetaHttpResponse::not_found("OAuth session not found or expired"),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    let session: OAuthPendingSession = match serde_json::from_str(&session_model.access_token) {
        Ok(s) => s,
        Err(_) => return MetaHttpResponse::internal_error("session corrupt"),
    };

    // Org isolation
    if session.org_id != org_id {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }

    let status_str = match session.status {
        OAuthStatus::Pending => "pending",
        OAuthStatus::Complete => "complete",
        OAuthStatus::Error => "error",
    };

    MetaHttpResponse::json(StatusResponse {
        status: status_str.to_string(),
        team_name: session.team_name,
        team_id: session.team_id,
        error_reason: session.error_reason,
        has_channel_picker: handler.has_channel_picker(),
    })
}

// ---------------------------------------------------------------------------
// GET /api/{org_id}/oauth/{provider}/channels
// ---------------------------------------------------------------------------

pub async fn channels(
    Path((org_id, provider)): Path<(String, OAuthProvider)>,
    Query(q): Query<ChannelsQuery>,
) -> Response {
    let handler = match PROVIDER_REGISTRY.get(&provider) {
        Some(h) => h,
        None => return MetaHttpResponse::not_found(format!("Unknown provider: {provider}")),
    };

    if !handler.has_channel_picker() {
        return MetaHttpResponse::bad_request(format!(
            "Provider {provider} does not support channel picker"
        ));
    }

    let token = if let Some(state) = q.state {
        // Create flow: get token from session
        let model = match sessions::get(&state).await {
            Ok(Some(m)) => m,
            Ok(None) => {
                return MetaHttpResponse::json(serde_json::json!({
                    "error": "token_revoked",
                    "channel_name": null
                }));
            }
            Err(e) => return MetaHttpResponse::internal_error(e),
        };
        let session: OAuthPendingSession = match serde_json::from_str(&model.access_token) {
            Ok(s) => s,
            Err(_) => return MetaHttpResponse::internal_error("session corrupt"),
        };
        if session.org_id != org_id {
            return (StatusCode::FORBIDDEN, "Forbidden").into_response();
        }
        match session.access_token {
            Some(t) => t,
            None => {
                return MetaHttpResponse::json(serde_json::json!({
                    "error": "token_revoked",
                    "channel_name": null
                }));
            }
        }
    } else if let Some(connection_id) = q.connection_id {
        // Edit flow: get token from cipher table
        let cipher_name = format!("{provider}/{connection_id}");
        match cipher::get_data(&org_id, EntryKind::OAuthToken, &cipher_name).await {
            Ok(Some(t)) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                    if let Some(at) = v.get("access_token").and_then(|x| x.as_str()) {
                        at.to_string()
                    } else {
                        t
                    }
                } else {
                    t
                }
            }
            Ok(None) => {
                return MetaHttpResponse::json(serde_json::json!({
                    "error": "token_revoked",
                    "channel_name": null
                }));
            }
            Err(e) => return MetaHttpResponse::internal_error(e),
        }
    } else {
        return MetaHttpResponse::bad_request("Either state or connection_id is required");
    };

    match handler.list_channels(&token).await {
        Ok(list) => {
            let truncated = list.len() >= 10_000;
            let channels: Vec<ChannelItem> = list
                .into_iter()
                .take(10_000)
                .map(|c| ChannelItem {
                    id: c.id,
                    name: c.name,
                    is_private: c.is_private,
                })
                .collect();
            MetaHttpResponse::json(ChannelsResponse {
                channels,
                truncated,
            })
        }
        Err(e) => {
            let msg = e.to_string().to_lowercase();
            if msg.contains("token_revoked") || msg.contains("invalid_auth") {
                return (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(serde_json::json!({
                        "error": "token_revoked",
                        "channel_name": null
                    })),
                )
                    .into_response();
            }
            MetaHttpResponse::internal_error(e)
        }
    }
}

// ---------------------------------------------------------------------------
// POST /api/{org_id}/oauth/{provider}/test
// ---------------------------------------------------------------------------

pub async fn test(
    Path((org_id, provider)): Path<(String, OAuthProvider)>,
    Query(q): Query<TestQuery>,
    Json(body): Json<TestRequest>,
) -> Response {
    let handler = match PROVIDER_REGISTRY.get(&provider) {
        Some(h) => h,
        None => return MetaHttpResponse::not_found(format!("Unknown provider: {provider}")),
    };

    let token = if let Some(state) = q.state {
        let model = match sessions::get(&state).await {
            Ok(Some(m)) => m,
            Ok(None) => return MetaHttpResponse::bad_request("OAuth session not found"),
            Err(e) => return MetaHttpResponse::internal_error(e),
        };
        let session: OAuthPendingSession = match serde_json::from_str(&model.access_token) {
            Ok(s) => s,
            Err(_) => return MetaHttpResponse::internal_error("session corrupt"),
        };
        if session.org_id != org_id {
            return (StatusCode::FORBIDDEN, "Forbidden").into_response();
        }
        match session.access_token {
            Some(t) => t,
            None => return MetaHttpResponse::bad_request("OAuth token not yet available"),
        }
    } else if let Some(connection_id) = q.connection_id {
        let cipher_name = format!("{provider}/{connection_id}");
        match cipher::get_data(&org_id, EntryKind::OAuthToken, &cipher_name).await {
            Ok(Some(t)) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                    if let Some(at) = v.get("access_token").and_then(|x| x.as_str()) {
                        at.to_string()
                    } else {
                        t
                    }
                } else {
                    t
                }
            }
            Ok(None) => return MetaHttpResponse::bad_request("Token not found"),
            Err(e) => return MetaHttpResponse::internal_error(e),
        }
    } else {
        return MetaHttpResponse::bad_request("Either state or connection_id is required");
    };

    let test_msg = "This is a test message from OpenObserve.";
    match handler
        .send_notification(&token, body.channel_id.as_deref(), test_msg)
        .await
    {
        Ok(()) => MetaHttpResponse::json(TestResponse {
            ok: true,
            error: None,
        }),
        Err(e) => MetaHttpResponse::json(TestResponse {
            ok: false,
            error: Some(e.to_string()),
        }),
    }
}

// ---------------------------------------------------------------------------
// POST /api/oauth/{provider}/events  (unauthenticated — provider webhook)
//
// Providers (e.g. Slack) send revocation/uninstall webhooks here.
// Signature is verified synchronously; revocation fan-out is async.
// ---------------------------------------------------------------------------

pub async fn events(Path(provider): Path<OAuthProvider>, request: Request) -> Response {
    let handler = match PROVIDER_REGISTRY.get(&provider) {
        Some(h) => h,
        None => return (StatusCode::NOT_FOUND, "Unknown provider").into_response(),
    };

    let signing_secret = match &provider {
        OAuthProvider::Slack => get_config().oauth_destinations.slack_signing_secret.clone(),
        // Other providers either have no revocation webhook or verify via proxy.
        // Return 404 so the provider knows this endpoint isn't active.
        _ => return (StatusCode::NOT_FOUND, "No webhook configured for provider").into_response(),
    };

    if signing_secret.is_empty() {
        return (
            StatusCode::NOT_FOUND,
            "Webhook signing secret not configured",
        )
            .into_response();
    }

    let headers = request.headers().clone();
    let body_bytes = match axum::body::to_bytes(request.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "Failed to read body").into_response(),
    };

    if !handler.verify_event_signature(&body_bytes, &headers, &signing_secret) {
        return (StatusCode::UNAUTHORIZED, "Invalid signature").into_response();
    }

    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid JSON").into_response(),
    };

    // Handle Slack url_verification challenge
    if let Some(challenge) = payload.get("challenge").and_then(|v| v.as_str()) {
        return (
            StatusCode::OK,
            Json(serde_json::json!({ "challenge": challenge })),
        )
            .into_response();
    }

    let event_type = payload
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let revocation_types: Vec<String> = handler
        .revocation_event_types()
        .iter()
        .map(|s| s.to_string())
        .collect();

    if revocation_types.contains(&event_type) {
        let provider_clone = provider.clone();
        let handler_ref = PROVIDER_REGISTRY.get(&provider_clone);
        if let Some(h) = handler_ref {
            let team_id = h.extract_team_id_from_event(&payload);
            if let Some(team_id) = team_id {
                let provider_str = provider.to_string();
                tokio::spawn(async move {
                    revoke_team_connections(&provider_str, &team_id).await;
                });
            }
        }
    }

    (StatusCode::OK, "").into_response()
}

// ---------------------------------------------------------------------------
// Revocation fan-out helper
// ---------------------------------------------------------------------------

async fn revoke_team_connections(provider: &str, team_id: &str) {
    let index_key = format!("team_index/{provider}/{team_id}");
    let data = match cipher::get_data(
        "_alert_dest_oauth_team_index",
        EntryKind::OAuthToken,
        &index_key,
    )
    .await
    {
        Ok(Some(d)) => d,
        Ok(None) => return,
        Err(e) => {
            log::error!("revoke_team_connections: failed to read team index: {e}");
            return;
        }
    };

    let entries: Vec<serde_json::Value> = match serde_json::from_str(&data) {
        Ok(v) => v,
        Err(e) => {
            log::error!("revoke_team_connections: failed to parse team index: {e}");
            return;
        }
    };

    for entry in entries {
        let org_id = entry
            .get("org_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let connection_id = entry
            .get("connection_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if org_id.is_empty() || connection_id.is_empty() {
            continue;
        }

        match crate::service::alerts::destinations::set_oauth_status_revoked_by_connection(
            &org_id,
            &connection_id,
        )
        .await
        {
            Ok(_) => {
                log::warn!(
                    "OAuth token revoked for org={org_id} connection={connection_id} provider={provider}"
                );
            }
            Err(e) => {
                log::error!(
                    "Failed to set revoked status for org={org_id} connection={connection_id}: {e}"
                );
            }
        }
    }
}
