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

//! Discord provider: send notifications and list channels.
//!
//! Token acquisition and refresh is handled by the destination-proxy.
//! Token type: Bearer, expires ~7 days; proxy handles refresh.

use anyhow::{Context, Result};
use async_trait::async_trait;
use axum::http::HeaderMap;
use reqwest::Client;
use serde::Deserialize;

use super::{OAuthChannel, OAuthNotifyError, OAuthProviderHandler};

#[derive(Debug, Deserialize)]
struct DiscordChannel {
    id: String,
    name: Option<String>,
    #[serde(rename = "type")]
    channel_type: u8,
}

#[derive(Debug, Deserialize)]
struct DiscordMessageResponse {
    message: Option<String>,
    code: Option<u64>,
}

pub struct DiscordProvider;

const DISCORD_API_BASE: &str = "https://discord.com/api/v10";

#[async_trait]
impl OAuthProviderHandler for DiscordProvider {
    fn display_name(&self) -> &str {
        "Discord"
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
            "channel_id required for Discord".to_string(),
        ))?;

        let client = Client::new();
        let body = serde_json::json!({ "content": message });
        let url = format!("{DISCORD_API_BASE}/channels/{channel}/messages");

        let resp = client
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| OAuthNotifyError::Other(e.to_string()))?;

        let status = resp.status();

        if status.as_u16() == 429 {
            let retry_after = resp
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(5);
            return Err(OAuthNotifyError::RateLimited(retry_after));
        }

        if status.is_success() {
            return Ok(());
        }

        let result: DiscordMessageResponse = resp
            .json()
            .await
            .map_err(|e| OAuthNotifyError::Other(e.to_string()))?;

        let code = result.code.unwrap_or(0);
        Err(match code {
            0 if status.as_u16() == 401 => OAuthNotifyError::TokenRevoked,
            10003 => OAuthNotifyError::ChannelNotFound,
            50001 => OAuthNotifyError::TokenRevoked,
            _ => OAuthNotifyError::Other(
                result
                    .message
                    .unwrap_or_else(|| format!("code={code}")),
            ),
        })
    }

    async fn list_channels(&self, token: &str) -> Result<Vec<OAuthChannel>> {
        let client = Client::new();

        let guilds: Vec<serde_json::Value> = client
            .get(format!("{DISCORD_API_BASE}/users/@me/guilds"))
            .bearer_auth(token)
            .send()
            .await
            .context("Discord list guilds HTTP error")?
            .json()
            .await
            .context("Discord list guilds JSON parse error")?;

        let mut channels = Vec::new();

        for guild in guilds.iter().take(5) {
            let guild_id = match guild.get("id").and_then(|v| v.as_str()) {
                Some(id) => id.to_string(),
                None => continue,
            };

            let guild_channels: Vec<DiscordChannel> = client
                .get(format!("{DISCORD_API_BASE}/guilds/{guild_id}/channels"))
                .bearer_auth(token)
                .send()
                .await
                .context("Discord list channels HTTP error")?
                .json()
                .await
                .context("Discord list channels JSON parse error")?;

            for ch in guild_channels {
                // Text (0) and announcement (5) channels only
                if ch.channel_type == 0 || ch.channel_type == 5 {
                    channels.push(OAuthChannel {
                        id: ch.id,
                        name: ch.name.unwrap_or_default(),
                        is_private: false,
                        is_member: true,
                    });
                }
            }
        }

        Ok(channels)
    }

    fn revocation_event_types(&self) -> &[&str] {
        &[] // Discord has no revocation webhook; expiry detected at send time
    }

    fn verify_event_signature(&self, _raw_body: &[u8], _headers: &HeaderMap, _secret: &str) -> bool {
        true // Not called — no revocation webhook
    }

    fn extract_team_id_from_event(&self, _payload: &serde_json::Value) -> Option<String> {
        None
    }
}
