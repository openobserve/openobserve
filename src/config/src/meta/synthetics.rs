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

use serde::{Deserialize, Serialize};

// ── Core monitor (stored in Postgres) ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Monitor {
    pub id: String,
    pub org_id: String,
    pub folder_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub monitor_type: MonitorType,
    pub target: String,
    /// Type-specific config, stored as JSONB. Shape depends on monitor_type.
    pub config: serde_json::Value,
    pub interval_secs: i32,
    pub locations: Vec<String>,
    pub enabled: bool,
    pub next_run_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MonitorType {
    #[default]
    Http,
    Api,
    Tcp,
    Tls,
    Ssh,
    Browser,
}

// ── List response (monitor + computed fields from synthetics_results stream) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorListItem {
    pub id: String,
    pub org_id: String,
    pub folder_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub monitor_type: MonitorType,
    pub target: String,
    pub interval_secs: i32,
    pub locations: Vec<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,

    // computed from synthetics_results stream via batch_monitor_summary
    pub status: MonitorStatus,
    pub last_check_at: Option<i64>,
    pub last_response_ms: Option<f64>,
    pub uptime_7d_pct: Option<f64>,
    pub status_24h: Vec<StatusBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MonitorStatus {
    Up,
    Degraded,
    Down,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusBucket {
    pub ts: i64,
    pub status: BucketStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BucketStatus {
    Up,
    Degraded,
    Down,
    NoData,
}

// ── Query params / responses ──────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ListMonitorsParams {
    pub folder_id: Option<String>,
    pub monitor_type: Option<MonitorType>,
    pub enabled: Option<bool>,
    pub location: Option<String>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct MonitorListResponse {
    pub monitors: Vec<MonitorListItem>,
    pub total: i64,
}

// ── Type-specific config structs ──────────────────────────────────────────────
// These are used to validate/parse config at request time.
// The Monitor.config field stores them as raw serde_json::Value in the DB.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpConfig {
    #[serde(default = "default_http_method")]
    pub method: String,
    #[serde(default)]
    pub headers: Vec<HttpHeader>,
    pub body: Option<String>,
    #[serde(default = "bool_true")]
    pub follow_redirects: bool,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
    #[serde(default)]
    pub assertions: Vec<Assertion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Assertion {
    pub field: String,
    pub operator: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpConfig {
    pub port: u16,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
    pub response_contains: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    #[serde(default = "default_tls_port")]
    pub port: u16,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
    #[serde(default = "default_min_days")]
    pub min_days_until_expiry: u32,
    #[serde(default = "bool_true")]
    pub verify_chain: bool,
    #[serde(default = "bool_true")]
    pub verify_hostname: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
    pub command: Option<String>,
    pub expected_exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshAuth {
    #[serde(rename = "type")]
    pub auth_type: String,
    pub secret: String,
}

/// A (browser, device) pair for browser monitor fan-out.
/// Each selected combination runs as a separate pending_check per interval.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BrowserDevice {
    /// "chromium" | "firefox" | "edge"
    pub browser: String,
    /// "laptop_large" | "tablet" | "mobile_small"
    pub device: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BrowserConfig {
    /// Matrix of (browser × device) combinations to run.
    /// Each entry = one pending_check row per interval per location.
    #[serde(default = "default_browser_devices")]
    pub browser_devices: Vec<BrowserDevice>,
    pub runtime: Option<String>,
    #[serde(default)]
    pub steps: Vec<BrowserStep>,
    #[serde(default)]
    pub env: Vec<String>,
    #[serde(default)]
    pub secrets: Vec<String>,
    #[serde(default = "default_browser_timeout_ms")]
    pub timeout_ms: u32,
    pub capture: Option<BrowserCapture>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserStep {
    pub name: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserViewport {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserCapture {
    #[serde(default = "capture_on_fail")]
    pub screenshot: String,
    #[serde(default = "capture_on_fail")]
    pub trace: String,
    #[serde(default = "capture_off")]
    pub video: String,
}

fn default_http_method() -> String {
    "GET".to_string()
}

fn default_timeout_ms() -> u32 {
    10_000
}

fn default_browser_timeout_ms() -> u32 {
    30_000
}

fn default_tls_port() -> u16 {
    443
}

fn default_ssh_port() -> u16 {
    22
}

fn default_min_days() -> u32 {
    30
}

fn default_browser_devices() -> Vec<BrowserDevice> {
    vec![BrowserDevice {
        browser: "chromium".to_string(),
        device: "laptop_large".to_string(),
    }]
}

fn bool_true() -> bool {
    true
}

fn capture_on_fail() -> String {
    "on-fail".to_string()
}

fn capture_off() -> String {
    "off".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_monitor_type_default() {
        assert_eq!(MonitorType::default(), MonitorType::Http);
    }

    #[test]
    fn test_monitor_type_serde() {
        let json = serde_json::json!("browser");
        let mt: MonitorType = serde_json::from_value(json).unwrap();
        assert_eq!(mt, MonitorType::Browser);

        let json = serde_json::json!("api");
        let mt: MonitorType = serde_json::from_value(json).unwrap();
        assert_eq!(mt, MonitorType::Api);
    }

    #[test]
    fn test_monitor_status_default() {
        assert_eq!(MonitorStatus::default(), MonitorStatus::Unknown);
    }

    #[test]
    fn test_http_config_defaults() {
        let cfg: HttpConfig = serde_json::from_str(r#"{"assertions":[]}"#).unwrap();
        assert_eq!(cfg.method, "GET");
        assert_eq!(cfg.timeout_ms, 10_000);
        assert!(cfg.follow_redirects);
        assert!(cfg.headers.is_empty());
    }

    #[test]
    fn test_browser_config_defaults() {
        let cfg: BrowserConfig = serde_json::from_str(r#"{"steps":[]}"#).unwrap();
        assert_eq!(cfg.browser_devices.len(), 1);
        assert_eq!(cfg.browser_devices[0].browser, "chromium");
        assert_eq!(cfg.browser_devices[0].device, "laptop_large");
        assert_eq!(cfg.timeout_ms, 30_000);
    }

    #[test]
    fn test_tls_config_defaults() {
        let cfg: TlsConfig = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(cfg.port, 443);
        assert_eq!(cfg.min_days_until_expiry, 30);
        assert!(cfg.verify_chain);
        assert!(cfg.verify_hostname);
    }

    #[test]
    fn test_monitor_list_item_serializes_status() {
        let item = MonitorListItem {
            id: "id1".to_string(),
            org_id: "org1".to_string(),
            folder_id: "default".to_string(),
            name: "test".to_string(),
            monitor_type: MonitorType::Http,
            target: "https://example.com".to_string(),
            interval_secs: 60,
            locations: vec!["aws-us-east-1".to_string()],
            enabled: true,
            created_at: 0,
            updated_at: 0,
            status: MonitorStatus::Up,
            last_check_at: None,
            last_response_ms: Some(142.0),
            uptime_7d_pct: Some(99.9),
            status_24h: vec![],
        };
        let json = serde_json::to_value(&item).unwrap();
        assert_eq!(json["status"], "up");
        assert_eq!(json["type"], "http");
    }
}
