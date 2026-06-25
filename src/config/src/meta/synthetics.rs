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

use chrono::FixedOffset;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ── Frequency ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MonitorFrequencyType {
    Seconds,
    #[default]
    Minutes,
    Hours,
    Days,
    Weeks,
    Months,
    Cron,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MonitorFrequency {
    #[serde(rename = "type", default)]
    pub frequency_type: MonitorFrequencyType,
    #[serde(default)]
    pub interval: i64,
    #[serde(default)]
    pub cron: String,
}

impl Default for MonitorFrequency {
    fn default() -> Self {
        Self {
            frequency_type: MonitorFrequencyType::Minutes,
            interval: 5,
            cron: String::new(),
        }
    }
}

impl MonitorFrequency {
    pub fn interval_secs(&self) -> i64 {
        match self.frequency_type {
            MonitorFrequencyType::Seconds => self.interval.max(1),
            MonitorFrequencyType::Minutes => self.interval.max(1) * 60,
            MonitorFrequencyType::Hours => self.interval.max(1) * 3_600,
            MonitorFrequencyType::Days => self.interval.max(1) * 86_400,
            MonitorFrequencyType::Weeks => self.interval.max(1) * 604_800,
            MonitorFrequencyType::Months => self.interval.max(1) * 2_592_000,
            MonitorFrequencyType::Cron => 0,
        }
    }

    pub fn next_run_at(&self, from_us: i64, tz_offset_mins: i32) -> anyhow::Result<i64> {
        use std::str::FromStr;
        match self.frequency_type {
            MonitorFrequencyType::Cron => {
                if self.cron.is_empty() {
                    return Err(anyhow::anyhow!("cron expression is empty"));
                }
                let schedule = cron::Schedule::from_str(&self.cron)
                    .map_err(|e| anyhow::anyhow!("invalid cron '{}': {e}", self.cron))?;
                let tz = FixedOffset::east_opt(tz_offset_mins * 60)
                    .unwrap_or_else(|| FixedOffset::east_opt(0).unwrap());
                schedule
                    .upcoming(tz)
                    .next()
                    .map(|t| t.timestamp_micros())
                    .ok_or_else(|| anyhow::anyhow!("cron '{}' has no future dates", self.cron))
            }
            _ => {
                let secs = self.interval_secs();
                if secs == 0 {
                    return Err(anyhow::anyhow!(
                        "frequency type {:?} yields zero interval",
                        self.frequency_type
                    ));
                }
                Ok(from_us + secs * 1_000_000)
            }
        }
    }
}

// ── Core monitor (stored in Postgres) ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default, ToSchema)]
pub struct Monitor {
    pub id: String,
    pub org_id: String,
    /// KSUID of the folder this monitor belongs to (`folders.id`).
    #[serde(default)]
    pub folder_id: String,
    /// Timezone offset in minutes from UTC (e.g. -300 = EST). Used for cron scheduling.
    #[serde(default)]
    pub tz_offset: i32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// User-defined tags for filtering/grouping (e.g. ["prod", "checkout"]).
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(rename = "type")]
    pub monitor_type: MonitorType,
    /// Target URL (HTTP/Browser) or host:port (TCP/TLS/SSH).
    pub target: String,
    /// Type-specific config, stored as JSONB. Shape depends on monitor_type.
    pub config: serde_json::Value,
    /// Schedule — same modular format as reports frequency.
    pub frequency: MonitorFrequency,
    pub locations: Vec<String>,
    pub enabled: bool,
    /// Alert destination names to notify on check failure.
    #[serde(default)]
    pub destinations: Vec<String>,
    /// Number of retries before marking a check failed (0 = no retry).
    #[serde(default)]
    pub retries: i32,
    /// Seconds to wait between retry attempts.
    #[serde(default = "default_wait_before_retry_secs")]
    pub wait_before_retry_secs: i32,
    /// Alert only after this many consecutive failures (like alerts trigger_tolerance).
    #[serde(default = "default_one")]
    pub alert_if_fails: i32,
    /// Silence period (seconds) between repeated alert notifications.
    #[serde(default)]
    pub cooldown_secs: i32,
    /// Collect RUM data for browser monitors (session replay / performance).
    #[serde(default)]
    pub collect_rum_data: bool,
    /// Enable session replay capture (browser monitors only).
    #[serde(default)]
    pub session_replay: bool,
    /// Optional authentication config (basic auth, bearer token, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<MonitorAuth>,
    /// Key-value variables injected into the probe environment.
    #[serde(default)]
    pub variables: Vec<MonitorVariable>,

    // ── Scheduler fields (managed by server, not sent by client on create) ──
    /// Pre-computed next fire time (microseconds). 0 = fire on first tick.
    #[serde(default)]
    pub next_run_at: i64,
    /// When the scheduler last fanned out this monitor (microseconds). UI: "LAST CHECK".
    #[serde(default)]
    pub last_triggered_at: i64,
    /// Denormalised status from the most recent completed check. Updated by ack handler.
    #[serde(default)]
    pub last_check_status: MonitorStatus,

    pub created_at: i64,
    pub updated_at: i64,
}

// ── MonitorType ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default, ToSchema)]
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

// ── MonitorStatus ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MonitorStatus {
    Up,
    Degraded,
    Down,
    /// Check dispatched but no result received yet.
    Pending,
    #[default]
    Unknown,
}

// ── Auth ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MonitorAuth {
    Basic {
        username: String,
        password: String,
    },
    Bearer {
        token: String,
    },
    /// Reference to a secret stored in OO secrets manager.
    Secret {
        secret_name: String,
    },
}

// ── Variables ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MonitorVariable {
    pub name: String,
    /// Inline value OR reference to a secret (prefixed "$secret:name").
    pub value: String,
}

// ── Settings (packed into the `settings` JSON column) ────────────────────────

/// Non-type-specific monitor settings stored as a single `settings` JSON blob.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MonitorSettings {
    #[serde(default)]
    pub retries: i32,
    #[serde(default)]
    pub cooldown_secs: i32,
    #[serde(default = "default_wait_before_retry_secs_i32")]
    pub wait_before_retry_secs: i32,
    #[serde(default = "default_one_i32")]
    pub alert_if_fails: i32,
    #[serde(default)]
    pub collect_rum_data: bool,
    #[serde(default)]
    pub session_replay: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<MonitorAuth>,
    #[serde(default)]
    pub variables: Vec<MonitorVariable>,
}

fn default_wait_before_retry_secs_i32() -> i32 {
    5
}
fn default_one_i32() -> i32 {
    1
}

// ── Trigger type for run-now / manual trigger ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TriggerType {
    #[default]
    Scheduled,
    /// Manually triggered via the "Run Test" button in the UI.
    Manual,
}

// ── List response (monitor + computed fields) ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MonitorListItem {
    pub id: String,
    pub org_id: String,
    pub folder_id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    #[serde(rename = "type")]
    pub monitor_type: MonitorType,
    pub target: String,
    pub frequency: MonitorFrequency,
    pub locations: Vec<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_triggered_at: i64,

    // runtime fields — from synthetics_jobs (pending) + synthetics_results (completed)
    pub status: MonitorStatus,
    pub last_check_at: Option<i64>,
    pub last_response_ms: Option<f64>,
    pub uptime_7d_pct: Option<f64>,
    pub status_24h: Vec<StatusBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StatusBucket {
    pub ts: i64,
    pub status: BucketStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
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
    pub org_id: String,
    pub folder_id: Option<String>,
    pub monitor_type: Option<MonitorType>,
    pub enabled: Option<bool>,
    pub location: Option<String>,
    pub tag: Option<String>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MonitorListResponse {
    pub monitors: Vec<MonitorListItem>,
    pub total: i64,
}

// ── Results API types (from synthetics_results stream) ────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckResult {
    pub job_id: i64,
    pub monitor_id: String,
    pub location: String,
    pub pool: String,
    pub status: CheckStatus,
    pub response_time_ms: f64,
    pub error: Option<String>,
    pub browser_engine: Option<String>,
    pub device: Option<String>,
    pub trigger_type: TriggerType,
    pub checked_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Up,
    Degraded,
    Down,
    Error,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ListResultsParams {
    pub location: Option<String>,
    pub status: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ListResultsResponse {
    pub results: Vec<CheckResult>,
    pub total: i64,
}

#[derive(Debug, Deserialize, Default)]
pub struct SummaryParams {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub location: Option<String>,
}

/// Runtime health summary computed from synthetics_results stream + synthetics_jobs.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MonitorSummary {
    pub status: MonitorStatus,
    pub last_check_at: Option<i64>,
    pub last_response_ms: Option<f64>,
    pub uptime_7d_pct: Option<f64>,
    pub status_24h: Vec<StatusBucket>,
    /// Per-location breakdown — enables "filter by location" in the UI.
    pub by_location: Vec<LocationSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocationSummary {
    pub location: String,
    pub status: MonitorStatus,
    pub last_check_at: Option<i64>,
    pub last_response_ms: Option<f64>,
    pub uptime_7d_pct: Option<f64>,
}

// ── Type-specific config structs ──────────────────────────────────────────────

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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BrowserDevice {
    /// "chromium" | "firefox" | "edge"
    pub browser: String,
    /// "laptop_large" | "tablet" | "mobile_small"
    pub device: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BrowserConfig {
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

// ── Defaults ──────────────────────────────────────────────────────────────────

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

fn default_wait_before_retry_secs() -> i32 {
    5
}

fn default_one() -> i32 {
    1
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
    }

    #[test]
    fn test_monitor_status_default() {
        assert_eq!(MonitorStatus::default(), MonitorStatus::Unknown);
    }

    #[test]
    fn test_frequency_interval_secs() {
        let f = MonitorFrequency {
            interval: 5,
            cron: String::new(),
            frequency_type: MonitorFrequencyType::Minutes,
            ..Default::default()
        };
        assert_eq!(f.interval_secs(), 300);

        let f = MonitorFrequency {
            interval: 30,
            cron: String::new(),
            frequency_type: MonitorFrequencyType::Seconds,
            ..Default::default()
        };
        assert_eq!(f.interval_secs(), 30);

        let f = MonitorFrequency {
            interval: 0,
            cron: "0 */5 * * * *".to_string(),
            frequency_type: MonitorFrequencyType::Cron,
            ..Default::default()
        };
        assert_eq!(f.interval_secs(), 0);
    }

    #[test]
    fn test_http_config_defaults() {
        let cfg: HttpConfig = serde_json::from_str(r#"{"assertions":[]}"#).unwrap();
        assert_eq!(cfg.method, "GET");
        assert_eq!(cfg.timeout_ms, 10_000);
        assert!(cfg.follow_redirects);
    }

    #[test]
    fn test_browser_config_defaults() {
        let cfg: BrowserConfig = serde_json::from_str(r#"{"steps":[]}"#).unwrap();
        assert_eq!(cfg.browser_devices.len(), 1);
        assert_eq!(cfg.browser_devices[0].browser, "chromium");
    }

    #[test]
    fn test_monitor_auth_serde() {
        let auth = MonitorAuth::Basic {
            username: "user".to_string(),
            password: "pass".to_string(),
        };
        let json = serde_json::to_value(&auth).unwrap();
        assert_eq!(json["type"], "basic");
        assert_eq!(json["username"], "user");
    }
}
