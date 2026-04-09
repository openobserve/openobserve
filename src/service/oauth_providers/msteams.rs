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

//! MS Teams provider: send notifications via Microsoft Graph API.
//!
//! Token acquisition and refresh is handled by the destination-proxy.
//! Token type: Bearer (Azure AD), expires ~1 hour; proxy handles refresh.
//! channel_id = "{team_id}/{channel_id}" as returned by the channel picker.

use async_trait::async_trait;
use axum::http::HeaderMap;
use reqwest::Client;
use serde::Deserialize;

use super::{OAuthNotifyError, OAuthProviderHandler};

#[derive(Debug, Deserialize)]
struct GraphErrorResponse {
    error: Option<GraphError>,
}

#[derive(Debug, Deserialize)]
struct GraphError {
    code: Option<String>,
    message: Option<String>,
}

pub struct MsTeamsProvider;

const GRAPH_API_BASE: &str = "https://graph.microsoft.com/v1.0";

#[async_trait]
impl OAuthProviderHandler for MsTeamsProvider {
    fn display_name(&self) -> &str {
        "Microsoft Teams"
    }

    fn has_channel_picker(&self) -> bool {
        // Teams channels are selected via channel_id stored in the destination.
        // Future: add channel picker via Graph API teams/{team_id}/channels.
        false
    }

    async fn send_notification(
        &self,
        token: &str,
        channel_id: Option<&str>,
        message: &str,
    ) -> std::result::Result<(), OAuthNotifyError> {
        // channel_id format: "{team_id}/{channel_id}"
        let (team_id, ch_id) = match channel_id {
            Some(c) => {
                let parts: Vec<&str> = c.splitn(2, '/').collect();
                if parts.len() == 2 {
                    (parts[0], parts[1])
                } else {
                    return Err(OAuthNotifyError::Other(
                        "MS Teams channel_id must be 'team_id/channel_id'".to_string(),
                    ));
                }
            }
            None => {
                return Err(OAuthNotifyError::Other(
                    "channel_id required for MS Teams".to_string(),
                ));
            }
        };

        let client = Client::new();
        let url = format!(
            "{GRAPH_API_BASE}/teams/{team_id}/channels/{ch_id}/messages"
        );

        let body = serde_json::json!({
            "body": {
                "content": message,
                "contentType": "text"
            }
        });

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
                .unwrap_or(30);
            return Err(OAuthNotifyError::RateLimited(retry_after));
        }

        if status.is_success() {
            return Ok(());
        }

        if status.as_u16() == 401 {
            return Err(OAuthNotifyError::TokenRevoked);
        }

        let err_resp: GraphErrorResponse = resp
            .json()
            .await
            .unwrap_or(GraphErrorResponse { error: None });

        let code = err_resp
            .error
            .as_ref()
            .and_then(|e| e.code.as_deref())
            .unwrap_or("")
            .to_string();

        Err(match code.as_str() {
            "InvalidAuthenticationToken" | "AuthenticationError" => OAuthNotifyError::TokenRevoked,
            "itemNotFound" | "ChannelNotFound" => OAuthNotifyError::ChannelNotFound,
            _ => OAuthNotifyError::Other(
                err_resp
                    .error
                    .and_then(|e| e.message)
                    .unwrap_or_else(|| format!("HTTP {status}")),
            ),
        })
    }

    fn revocation_event_types(&self) -> &[&str] {
        &[] // MS Teams / Azure AD does not push revocation webhooks to OO
    }

    fn verify_event_signature(&self, _raw_body: &[u8], _headers: &HeaderMap, _secret: &str) -> bool {
        true // Not called — no revocation webhook
    }

    fn extract_team_id_from_event(&self, _payload: &serde_json::Value) -> Option<String> {
        None
    }
}
