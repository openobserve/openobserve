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

//! HTTP client for the destination-proxy service.
//!
//! On-prem OpenObserve instances delegate all OAuth flows to the proxy:
//!
//! 1. `start()`   — POST /api/proxy/start   → returns { oauth_url, session_id }
//! 2. `session()` — GET  /api/proxy/session/{session_id} → returns { handoff_nonce } or pending
//! 3. `exchange()`— POST /api/proxy/exchange → returns { access_token, refresh_token, … }
//! 4. `refresh()` — POST /api/proxy/refresh  → returns { access_token, refresh_token, expires_at }
//!
//! All requests carry `Authorization: Bearer <api_key>`.

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct StartRequest<'a> {
    pub provider: &'a str,
    pub return_url: &'a str,
    pub org_id: &'a str,
    pub connection_id: &'a str,
    /// Required only for ServiceNow; None for all other providers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_url: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
pub struct StartResponse {
    /// Authorization URL to open in the user's browser popup.
    pub oauth_url: String,
    /// Opaque ID used by on-prem OO to poll /session for completion.
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SessionResponse {
    /// Present when the OAuth flow has completed.
    pub handoff_nonce: Option<String>,
    /// "pending" while the user hasn't approved yet.
    pub status: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExchangeRequest<'a> {
    pub handoff_nonce: &'a str,
}

#[derive(Debug, Deserialize)]
pub struct ExchangeResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix timestamp (seconds) when the access token expires; None = non-expiring.
    pub expires_at: Option<i64>,
    pub team_id: Option<String>,
    pub team_name: Option<String>,
    #[serde(default)]
    pub extra: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct RefreshRequest<'a> {
    pub provider: &'a str,
    pub refresh_token: &'a str,
}

#[derive(Debug, Deserialize)]
pub struct RefreshResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix timestamp (seconds) when the new token expires.
    pub expires_at: Option<i64>,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

pub struct ProxyClient {
    base_url: String,
    api_key: String,
    http: reqwest::Client,
}

impl ProxyClient {
    pub fn new(base_url: &str, api_key: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            http: reqwest::Client::new(),
        }
    }

    /// Build from the current global config. Returns None if proxy is not configured.
    pub fn from_config() -> Option<Self> {
        let cfg = config::get_config();
        let o = &cfg.oauth_destinations;
        if o.oauth_proxy_url.is_empty() || o.oauth_proxy_api_key.is_empty() {
            return None;
        }
        Some(Self::new(&o.oauth_proxy_url, &o.oauth_proxy_api_key))
    }

    // -----------------------------------------------------------------------
    // POST /api/proxy/start
    // -----------------------------------------------------------------------

    pub async fn start(&self, req: &StartRequest<'_>) -> Result<StartResponse> {
        let url = format!("{}/api/proxy/start", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(req)
            .send()
            .await
            .context("proxy start: HTTP send failed")?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("proxy start: HTTP {status}: {body}"));
        }

        resp.json::<StartResponse>()
            .await
            .context("proxy start: response parse failed")
    }

    // -----------------------------------------------------------------------
    // GET /api/proxy/session/{session_id}
    // -----------------------------------------------------------------------

    /// Returns `None` if the flow is still pending, `Some(nonce)` when complete.
    pub async fn session(&self, session_id: &str) -> Result<Option<String>> {
        let url = format!("{}/api/proxy/session/{session_id}", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .context("proxy session: HTTP send failed")?;

        let status = resp.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            // Nonce already consumed or session expired
            return Err(anyhow!("proxy session: not found or expired"));
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("proxy session: HTTP {status}: {body}"));
        }

        let body: SessionResponse = resp
            .json()
            .await
            .context("proxy session: response parse failed")?;

        Ok(body.handoff_nonce)
    }

    // -----------------------------------------------------------------------
    // POST /api/proxy/exchange
    // -----------------------------------------------------------------------

    pub async fn exchange(&self, handoff_nonce: &str) -> Result<ExchangeResponse> {
        let url = format!("{}/api/proxy/exchange", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&ExchangeRequest { handoff_nonce })
            .send()
            .await
            .context("proxy exchange: HTTP send failed")?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("proxy exchange: HTTP {status}: {body}"));
        }

        resp.json::<ExchangeResponse>()
            .await
            .context("proxy exchange: response parse failed")
    }

    // -----------------------------------------------------------------------
    // POST /api/proxy/refresh
    // -----------------------------------------------------------------------

    pub async fn refresh(
        &self,
        provider: &str,
        refresh_token: &str,
    ) -> Result<RefreshResponse> {
        let url = format!("{}/api/proxy/refresh", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&RefreshRequest { provider, refresh_token })
            .send()
            .await
            .context("proxy refresh: HTTP send failed")?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("proxy refresh: HTTP {status}: {body}"));
        }

        resp.json::<RefreshResponse>()
            .await
            .context("proxy refresh: response parse failed")
    }
}
