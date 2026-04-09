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

//! PagerDuty provider: send alert events via Events API v2.
//!
//! Token acquisition and refresh is handled by the destination-proxy.
//! No channel picker — routing key is stored in the token JSON extra field.
//! The `channel_id` param is overloaded to carry the routing key.

use async_trait::async_trait;
use axum::http::HeaderMap;
use reqwest::Client;
use serde::Deserialize;

use super::{OAuthNotifyError, OAuthProviderHandler};

#[derive(Debug, Deserialize)]
struct PagerDutyEventResponse {
    message: Option<String>,
}

pub struct PagerDutyProvider;

const PD_EVENTS_URL: &str = "https://events.pagerduty.com/v2/enqueue";

#[async_trait]
impl OAuthProviderHandler for PagerDutyProvider {
    fn display_name(&self) -> &str {
        "PagerDuty"
    }

    fn has_channel_picker(&self) -> bool {
        false // PagerDuty uses routing keys, not channels
    }

    async fn send_notification(
        &self,
        token: &str,
        channel_id: Option<&str>,
        message: &str,
    ) -> std::result::Result<(), OAuthNotifyError> {
        // channel_id carries the routing key for PagerDuty;
        // fall back to using the token directly if not set.
        let routing_key = channel_id.unwrap_or(token);

        let client = Client::new();
        let body = serde_json::json!({
            "routing_key": routing_key,
            "event_action": "trigger",
            "payload": {
                "summary": message,
                "source": "openobserve",
                "severity": "error",
            }
        });

        let resp = client
            .post(PD_EVENTS_URL)
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

        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(OAuthNotifyError::TokenRevoked);
        }

        let result: PagerDutyEventResponse = resp
            .json()
            .await
            .map_err(|e| OAuthNotifyError::Other(e.to_string()))?;

        Err(OAuthNotifyError::Other(
            result.message.unwrap_or_else(|| format!("HTTP {status}")),
        ))
    }

    fn revocation_event_types(&self) -> &[&str] {
        &[] // PagerDuty has no revocation webhook; detected at send time
    }

    fn verify_event_signature(&self, _raw_body: &[u8], _headers: &HeaderMap, _secret: &str) -> bool {
        true // Not called — no revocation webhook
    }

    fn extract_team_id_from_event(&self, _payload: &serde_json::Value) -> Option<String> {
        None
    }
}
