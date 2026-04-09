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

//! ServiceNow provider: create incidents via Table API.
//!
//! Token acquisition and refresh is handled by the destination-proxy.
//! Token type: Bearer (instance-specific), has refresh token.
//! The instance URL is stored in the token JSON extra field by the proxy.
//! channel_id is not used (no channel concept).

use async_trait::async_trait;
use axum::http::HeaderMap;
use reqwest::Client;
use serde::Deserialize;

use super::{OAuthNotifyError, OAuthProviderHandler};

#[derive(Debug, Deserialize)]
struct ServiceNowErrorResponse {
    error: Option<ServiceNowError>,
}

#[derive(Debug, Deserialize)]
struct ServiceNowError {
    message: Option<String>,
    detail: Option<String>,
}

pub struct ServiceNowProvider;

#[async_trait]
impl OAuthProviderHandler for ServiceNowProvider {
    fn display_name(&self) -> &str {
        "ServiceNow"
    }

    fn has_channel_picker(&self) -> bool {
        false
    }

    async fn send_notification(
        &self,
        token: &str,
        channel_id: Option<&str>,
        message: &str,
    ) -> std::result::Result<(), OAuthNotifyError> {
        // channel_id carries the ServiceNow instance URL (e.g. "https://dev12345.service-now.com")
        // This is set from the extra.instance_url field stored at connection save time.
        let instance_url = channel_id.ok_or_else(|| {
            OAuthNotifyError::Other(
                "ServiceNow instance_url required (set as channel_id)".to_string(),
            )
        })?;

        let url = format!("{}/api/now/table/incident", instance_url.trim_end_matches('/'));

        let client = Client::new();
        let body = serde_json::json!({
            "short_description": message,
            "description": message,
            "urgency": "2",
            "impact": "2",
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

        let err_resp: ServiceNowErrorResponse = resp
            .json()
            .await
            .unwrap_or(ServiceNowErrorResponse { error: None });

        Err(OAuthNotifyError::Other(
            err_resp
                .error
                .and_then(|e| e.message.or(e.detail))
                .unwrap_or_else(|| format!("HTTP {status}")),
        ))
    }

    fn revocation_event_types(&self) -> &[&str] {
        &[] // ServiceNow does not push revocation webhooks
    }

    fn verify_event_signature(&self, _raw_body: &[u8], _headers: &HeaderMap, _secret: &str) -> bool {
        true // Not called — no revocation webhook
    }

    fn extract_team_id_from_event(&self, _payload: &serde_json::Value) -> Option<String> {
        None
    }
}
