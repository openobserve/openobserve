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

//! Generic OAuth provider abstraction for alert destinations.
//!
//! All OAuth token acquisition and refresh is handled by the destination-proxy.
//! This module only contains what OpenObserve itself does with tokens after it
//! receives them:
//!   - Send alert notifications to the provider
//!   - List available channels for the channel picker
//!   - Verify revocation webhook signatures (e.g. Slack app_uninstalled)
//!
//! Adding a new provider only requires implementing `OAuthProviderHandler` and
//! registering it in `PROVIDER_REGISTRY`. No new endpoints or schema changes needed.

pub mod discord;
pub mod msteams;
pub mod pagerduty;
pub mod proxy_client;
pub mod servicenow;
pub mod slack;

use std::{collections::HashMap, sync::LazyLock};

use anyhow::Result;
use async_trait::async_trait;
use axum::http::HeaderMap;
use config::meta::destinations::OAuthProvider;
use serde::{Deserialize, Serialize};

use crate::service::oauth_providers::{
    discord::DiscordProvider, msteams::MsTeamsProvider, pagerduty::PagerDutyProvider,
    servicenow::ServiceNowProvider, slack::SlackProvider,
};

// ---------------------------------------------------------------------------
// Shared data types
// ---------------------------------------------------------------------------

/// A channel / room returned by `OAuthProviderHandler::list_channels()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthChannel {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_private: bool,
    /// Whether the bot is already a member of this channel.
    /// Always `true` for public channels (bot can post via chat:write.public).
    /// For private channels the bot must be invited first.
    #[serde(default)]
    pub is_member: bool,
}

/// Structured error returned from `OAuthProviderHandler::send_notification()`.
#[derive(Debug, Clone)]
pub enum OAuthNotifyError {
    /// Token has been revoked / account inactive.
    TokenRevoked,
    /// Token has expired and could not be refreshed.
    TokenExpired,
    /// Provider returned rate-limit; includes the `Retry-After` value (seconds).
    RateLimited(u64),
    /// Channel / routing target not found or archived.
    ChannelNotFound,
    /// Any other provider error. The string is the provider error code.
    Other(String),
}

impl std::fmt::Display for OAuthNotifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TokenRevoked => write!(f, "token_revoked"),
            Self::TokenExpired => write!(f, "token_expired"),
            Self::RateLimited(secs) => write!(f, "rate_limited(retry_after={secs}s)"),
            Self::ChannelNotFound => write!(f, "channel_not_found"),
            Self::Other(code) => write!(f, "{code}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Provider trait
// ---------------------------------------------------------------------------

/// Implemented once per OAuth provider.
///
/// OAuth token acquisition (authorize_url, exchange_code, refresh_token) is
/// handled entirely by the destination-proxy — not here. This trait only covers
/// what OpenObserve does with an already-obtained token.
#[async_trait]
pub trait OAuthProviderHandler: Send + Sync {
    /// Send an alert notification.
    ///
    /// `channel_id` is `None` for providers that don't have a channel concept
    /// (e.g. PagerDuty — routing key is embedded in the stored token JSON).
    async fn send_notification(
        &self,
        token: &str,
        channel_id: Option<&str>,
        message: &str,
    ) -> std::result::Result<(), OAuthNotifyError>;

    /// List available channels / rooms. Returns empty vec for providers that
    /// don't have a channel concept (e.g. PagerDuty, MS Teams, ServiceNow).
    async fn list_channels(&self, _token: &str) -> Result<Vec<OAuthChannel>> {
        Ok(vec![])
    }

    /// Event types that this provider sends for token revocation webhooks.
    fn revocation_event_types(&self) -> &[&str] {
        &[]
    }

    /// Validate the incoming event webhook signature (provider-specific HMAC).
    /// Return `true` to accept, `false` to reject.
    fn verify_event_signature(
        &self,
        raw_body: &[u8],
        headers: &HeaderMap,
        secret: &str,
    ) -> bool;

    /// Extract the team/workspace ID from a revocation event payload.
    fn extract_team_id_from_event(&self, payload: &serde_json::Value) -> Option<String>;

    /// Human-readable name shown in the UI.
    fn display_name(&self) -> &str;

    /// Whether this provider shows a channel picker in the destination form.
    fn has_channel_picker(&self) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

/// Global provider registry, keyed by `OAuthProvider` enum variant.
/// Initialized once at startup.
pub static PROVIDER_REGISTRY: LazyLock<HashMap<OAuthProvider, Box<dyn OAuthProviderHandler>>> =
    LazyLock::new(|| {
        let mut m: HashMap<OAuthProvider, Box<dyn OAuthProviderHandler>> = HashMap::new();
        m.insert(OAuthProvider::Slack, Box::new(SlackProvider));
        m.insert(OAuthProvider::Discord, Box::new(DiscordProvider));
        m.insert(OAuthProvider::PagerDuty, Box::new(PagerDutyProvider));
        m.insert(OAuthProvider::MsTeams, Box::new(MsTeamsProvider));
        m.insert(OAuthProvider::ServiceNow, Box::new(ServiceNowProvider));
        m
    });

// ---------------------------------------------------------------------------
// Pending-session state (stored in the sessions table)
// ---------------------------------------------------------------------------

/// Status of an OAuth handshake session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OAuthStatus {
    Pending,
    Complete,
    Error,
}

/// Stored in the sessions table under `access_token` column (as JSON).
///
/// `session_id` = the proxy's session_id (used as CSRF-equivalent key).
/// `access_token` in the sessions row = JSON-serialized `OAuthPendingSession`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthPendingSession {
    pub provider: OAuthProvider,
    pub org_id: String,
    /// KSUID — generated at `/start` or passed via `?existing_connection_id`
    pub connection_id: String,
    pub status: OAuthStatus,
    pub team_id: Option<String>,
    pub team_name: Option<String>,
    pub error_reason: Option<String>,
    /// Access token held here only during handshake; moved to cipher on save.
    pub access_token: Option<String>,
    /// Refresh token (if provided by the provider).
    pub refresh_token: Option<String>,
    /// Token expiry as Unix timestamp (seconds), if applicable.
    pub expires_at_token: Option<i64>,
}
