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

//! Slack provider: send notifications and list channels.
//!
//! Token acquisition is handled by the destination-proxy.
//! Scopes granted by proxy: chat:write, chat:write.public, channels:read, groups:read
//!
//! chat:write.public allows posting to any public channel without the bot being a member.
//! chat:write is still needed for DMs and private channels the bot has been invited to.
//! Private channels always require a manual /invite @<bot> — no scope can bypass this.

use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;
use axum::http::HeaderMap;
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::Deserialize;
use sha2::Sha256;

use super::{OAuthChannel, OAuthNotifyError, OAuthProviderHandler};

#[derive(Debug, Deserialize)]
struct SlackChannelsResponse {
    ok: bool,
    channels: Option<Vec<SlackChannel>>,
    response_metadata: Option<SlackResponseMeta>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SlackChannel {
    id: String,
    name: String,
    #[serde(default)]
    is_private: bool,
    #[serde(default)]
    is_member: bool,
}

#[derive(Debug, Deserialize)]
struct SlackResponseMeta {
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SlackPostMessageResponse {
    ok: bool,
    error: Option<String>,
}

pub struct SlackProvider;

const SLACK_CHANNELS_URL: &str = "https://slack.com/api/conversations.list";
const SLACK_POST_MESSAGE_URL: &str = "https://slack.com/api/chat.postMessage";

#[async_trait]
impl OAuthProviderHandler for SlackProvider {
    fn display_name(&self) -> &str {
        "Slack"
    }

    fn has_channel_picker(&self) -> bool {
        true
    }

    async fn send_notification(
        &self,
        token: &str,
        channel_id: Option<&str>,
        message: &str,
    ) -> std::result::Result<(), OAuthNotifyError> {
        let channel = channel_id.ok_or(OAuthNotifyError::Other(
            "channel_id required for Slack".to_string(),
        ))?;

        let client = Client::new();
        let body = serde_json::json!({
            "channel": channel,
            "text": message,
        });

        let resp = client
            .post(SLACK_POST_MESSAGE_URL)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| OAuthNotifyError::Other(e.to_string()))?;

        if resp.status().as_u16() == 429 {
            let retry_after = resp
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(60);
            return Err(OAuthNotifyError::RateLimited(retry_after));
        }

        let result: SlackPostMessageResponse = resp
            .json()
            .await
            .map_err(|e| OAuthNotifyError::Other(e.to_string()))?;

        if result.ok {
            return Ok(());
        }

        let err_code = result.error.unwrap_or_else(|| "unknown".to_string());
        Err(match err_code.as_str() {
            "token_revoked" | "account_inactive" | "invalid_auth" => OAuthNotifyError::TokenRevoked,
            "ratelimited" => OAuthNotifyError::RateLimited(60),
            "channel_not_found" | "channel_is_archived" | "is_archived" => {
                OAuthNotifyError::ChannelNotFound
            }
            other => OAuthNotifyError::Other(other.to_string()),
        })
    }

    async fn list_channels(&self, token: &str) -> Result<Vec<OAuthChannel>> {
        let client = Client::new();
        let mut channels = Vec::new();
        let mut cursor: Option<String> = None;
        let max_pages = 10usize;

        for _ in 0..max_pages {
            let mut params = vec![
                ("types", "public_channel,private_channel".to_string()),
                ("limit", "1000".to_string()),
                ("exclude_archived", "true".to_string()),
            ];
            if let Some(ref c) = cursor {
                params.push(("cursor", c.clone()));
            }

            let resp: SlackChannelsResponse = client
                .get(SLACK_CHANNELS_URL)
                .bearer_auth(token)
                .query(&params)
                .send()
                .await
                .context("Slack list channels HTTP error")?
                .json()
                .await
                .context("Slack list channels JSON parse error")?;

            if !resp.ok {
                return Err(anyhow!(
                    "Slack channels error: {}",
                    resp.error.unwrap_or_else(|| "unknown".to_string())
                ));
            }

            for ch in resp.channels.unwrap_or_default() {
                channels.push(OAuthChannel {
                    id: ch.id,
                    name: ch.name,
                    is_private: ch.is_private,
                    // Public channels are always postable; private ones need /invite
                    is_member: ch.is_member || !ch.is_private,
                });
            }

            cursor = resp
                .response_metadata
                .and_then(|m| m.next_cursor)
                .filter(|s| !s.is_empty());

            if cursor.is_none() {
                break;
            }
        }

        Ok(channels)
    }

    fn revocation_event_types(&self) -> &[&str] {
        &["app_uninstalled", "tokens_revoked"]
    }

    fn verify_event_signature(
        &self,
        raw_body: &[u8],
        headers: &HeaderMap,
        signing_secret: &str,
    ) -> bool {
        let timestamp_str = match headers
            .get("X-Slack-Request-Timestamp")
            .and_then(|v| v.to_str().ok())
        {
            Some(t) => t.to_string(),
            None => return false,
        };
        let sig_header = match headers
            .get("X-Slack-Signature")
            .and_then(|v| v.to_str().ok())
        {
            Some(s) => s.to_string(),
            None => return false,
        };

        let ts: i64 = match timestamp_str.parse() {
            Ok(t) => t,
            Err(_) => return false,
        };
        let now = chrono::Utc::now().timestamp();
        if (now - ts).abs() > 300 {
            log::warn!("Slack event rejected: timestamp too old or too new ({ts})");
            return false;
        }

        let sig_basestring = format!("v0:{}:{}", timestamp_str, String::from_utf8_lossy(raw_body));

        type HmacSha256 = Hmac<Sha256>;
        let mut mac: HmacSha256 = match HmacSha256::new_from_slice(signing_secret.as_bytes()) {
            Ok(m) => m,
            Err(_) => return false,
        };
        mac.update(sig_basestring.as_bytes());
        let expected = format!("v0={}", hex::encode(mac.finalize().into_bytes()));

        expected == sig_header
    }

    fn extract_team_id_from_event(&self, payload: &serde_json::Value) -> Option<String> {
        payload
            .get("team_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }
}
