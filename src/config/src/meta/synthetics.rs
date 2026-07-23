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
pub enum SyntheticFrequencyType {
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
pub struct SyntheticFrequency {
    #[serde(rename = "type", default)]
    pub frequency_type: SyntheticFrequencyType,
    #[serde(default)]
    pub interval: i64,
    #[serde(default)]
    pub cron: String,
    /// IANA timezone name (e.g. "America/New_York"). Used for cron scheduling and display.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
}

impl Default for SyntheticFrequency {
    fn default() -> Self {
        Self {
            frequency_type: SyntheticFrequencyType::Minutes,
            interval: 5,
            cron: String::new(),
            timezone: None,
        }
    }
}

impl SyntheticFrequency {
    pub fn interval_secs(&self) -> i64 {
        match self.frequency_type {
            SyntheticFrequencyType::Seconds => self.interval.max(1),
            SyntheticFrequencyType::Minutes => self.interval.max(1) * 60,
            SyntheticFrequencyType::Hours => self.interval.max(1) * 3_600,
            SyntheticFrequencyType::Days => self.interval.max(1) * 86_400,
            SyntheticFrequencyType::Weeks => self.interval.max(1) * 604_800,
            SyntheticFrequencyType::Months => self.interval.max(1) * 2_592_000,
            SyntheticFrequencyType::Cron => 0,
        }
    }

    pub fn next_run_at(&self, from_us: i64, tz_offset_mins: i32) -> anyhow::Result<i64> {
        use std::str::FromStr;
        match self.frequency_type {
            SyntheticFrequencyType::Cron => {
                if self.cron.is_empty() {
                    return Err(anyhow::anyhow!("cron expression is empty"));
                }
                let schedule = cron::Schedule::from_str(&self.cron)
                    .map_err(|e| anyhow::anyhow!("invalid cron '{}': {e}", self.cron))?;
                let tz = FixedOffset::east_opt(tz_offset_mins * 60)
                    .unwrap_or_else(|| FixedOffset::east_opt(0).unwrap());
                let from = chrono::DateTime::from_timestamp_micros(from_us)
                    .ok_or_else(|| anyhow::anyhow!("invalid from timestamp {from_us}"))?
                    .with_timezone(&tz);
                schedule
                    .after(&from)
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

// ── Core synthetic (stored in Postgres) ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default, ToSchema)]
pub struct Synthetic {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub org_id: String,
    /// KSUID of the folder this synthetic belongs to (`folders.id`).
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
    pub monitor_type: SyntheticType,
    /// Target URL (HTTP/Browser) or host:port (TCP/TLS/SSH).
    pub target: String,
    /// Type-specific config, stored as JSONB. Shape depends on monitor_type.
    pub config: serde_json::Value,
    /// Schedule — same modular format as reports frequency.
    pub frequency: SyntheticFrequency,
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
    /// Silence period (minutes) between repeated alert notifications.
    #[serde(default, alias = "cooldown_secs")]
    pub cooldown_mins: i32,
    /// Collect RUM data for browser monitors (session replay / performance).
    #[serde(default)]
    pub collect_rum_data: bool,
    /// Enable session replay capture (browser monitors only).
    #[serde(default)]
    pub session_replay: bool,
    /// Optional authentication config (basic auth, bearer token, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<SyntheticAuth>,
    /// Cookies injected into the browser context before any steps run.
    /// Orthogonal to auth — can be combined with basic/bearer auth.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cookies: Vec<SyntheticCookie>,
    /// Key-value variables injected into the probe environment.
    #[serde(default)]
    pub variables: Vec<SyntheticVariable>,
    /// Unix epoch microseconds — when to first run the check ("schedule later").
    /// When set, the scheduler uses this as the initial next_run_at instead of firing immediately.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<i64>,
    /// Encrypted config-embedded secret values, keyed by concrete JSON pointer
    /// into `config` (e.g. "/headers/0/value", "/auth/secret"). Extracted at
    /// write time so the `config` column never stores secret material — even
    /// ciphertext lives only in the dedicated `secrets` column. Rehydrated
    /// into `config` on the edit read and at probe resolve. Never serialized
    /// to API clients.
    #[serde(skip)]
    pub config_secrets: std::collections::BTreeMap<String, String>,

    // ── Scheduler fields (managed by server, not sent by client on create) ──
    /// Pre-computed next fire time (microseconds). 0 = fire on first tick.
    #[serde(default)]
    pub next_run_at: i64,
    /// When the scheduler last fanned out this synthetic (microseconds). UI: "LAST CHECK".
    #[serde(default)]
    pub last_triggered_at: i64,
    /// Denormalised status from the most recent completed check. Updated by ack handler.
    #[serde(default)]
    pub last_check_status: SyntheticStatus,

    /// Email of the user who created this synthetic. Set on create, never updated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,

    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

// ── SyntheticType ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SyntheticType {
    #[default]
    Http,
    Api,
    Tcp,
    /// TLS/SSL certificate check — checks expiry, chain validity, hostname.
    Tls,
    Ssh,
    Browser,
    /// ICMP ping — checks host reachability and round-trip time.
    Ping,
    /// DNS record check — verifies record type/value from a nameserver.
    Dns,
}

impl SyntheticType {
    /// JSON paths inside this type's `config` blob whose string values are
    /// credentials and must be AES-encrypted at rest (and decrypted on read).
    ///
    /// `*` matches every element of an array. Paths that don't exist in a given
    /// config are skipped, so optional fields need no special casing.
    ///
    /// Any new type that embeds a secret in its config MUST declare it here —
    /// this list is the single source of truth for the encryption walk in
    /// `encrypt_synthetic_auth` / `decrypt_synthetic_secrets` (enterprise) and
    /// the probe resolve path.
    pub fn secret_config_paths(&self) -> &'static [&'static str] {
        match self {
            Self::Ssh => &["/auth/secret"],
            // Header values are encrypted too: not every header is a secret,
            // but until the probe applies top-level auth, Authorization /
            // API-key headers are the only way to call authed targets — and
            // storing those in plaintext is exactly the bug this mechanism
            // exists to prevent. Encrypting non-secret header values is
            // harmless (decrypted at edit-read and probe resolve).
            Self::Http | Self::Api => &["/headers/*/value"],
            Self::Browser => &["/secrets/*/value", "/headers/*/value"],
            _ => &[],
        }
    }
}

/// Walks `value` along `path` (`/`-separated, `*` = every array element) and
/// applies `f` to each string found at the end of the path. Missing segments
/// are skipped silently. Non-string leaves are ignored.
pub fn for_each_string_at_path<E>(
    value: &mut serde_json::Value,
    path: &str,
    f: &mut impl FnMut(&mut String) -> Result<(), E>,
) -> Result<(), E> {
    fn walk<E>(
        value: &mut serde_json::Value,
        segments: &[&str],
        f: &mut impl FnMut(&mut String) -> Result<(), E>,
    ) -> Result<(), E> {
        let Some((head, rest)) = segments.split_first() else {
            if let serde_json::Value::String(s) = value {
                f(s)?;
            }
            return Ok(());
        };
        if *head == "*" {
            if let serde_json::Value::Array(items) = value {
                for item in items {
                    walk(item, rest, f)?;
                }
            }
        } else if let Some(child) = value.get_mut(*head) {
            walk(child, rest, f)?;
        }
        Ok(())
    }
    let segments: Vec<&str> = path
        .trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    walk(value, &segments, f)
}

/// Removes every non-empty string at `path` (wildcards allowed) from `value`,
/// returning `(concrete_pointer, taken_value)` pairs — e.g. walking
/// `/headers/*/value` yields `("/headers/0/value", "Basic …")`. The slots are
/// left as empty strings so `config` keeps its shape but carries no secret
/// material. Rehydrate with `value.pointer_mut(ptr)`.
pub fn take_strings_at_path(value: &mut serde_json::Value, path: &str) -> Vec<(String, String)> {
    fn walk(
        value: &mut serde_json::Value,
        segments: &[&str],
        pointer: &mut String,
        out: &mut Vec<(String, String)>,
    ) {
        let Some((head, rest)) = segments.split_first() else {
            if let serde_json::Value::String(s) = value
                && !s.is_empty()
            {
                out.push((pointer.clone(), std::mem::take(s)));
            }
            return;
        };
        if *head == "*" {
            if let serde_json::Value::Array(items) = value {
                for (i, item) in items.iter_mut().enumerate() {
                    let len = pointer.len();
                    pointer.push('/');
                    pointer.push_str(&i.to_string());
                    walk(item, rest, pointer, out);
                    pointer.truncate(len);
                }
            }
        } else if let Some(child) = value.get_mut(*head) {
            let len = pointer.len();
            pointer.push('/');
            pointer.push_str(head);
            walk(child, rest, pointer, out);
            pointer.truncate(len);
        }
    }
    let segments: Vec<&str> = path
        .trim_start_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    let mut out = Vec::new();
    let mut pointer = String::new();
    walk(value, &segments, &mut pointer, &mut out);
    out
}

// ── SyntheticStatus ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SyntheticStatus {
    /// All steps passed on first attempt.
    Passed,
    /// Passed on retry — flaky.
    Warning,
    /// All attempts failed — target is down.
    Failed,
    #[default]
    Unknown,
    /// Probe infra failure — target health is unknown (Lambda missing, creds expired, etc.).
    /// Distinct from Failed: we could not check, not that the check failed.
    Error,
}

impl SyntheticStatus {
    /// Deserialize from `last_check_status` integer stored in DB.
    /// DB integers are unchanged — only the variant names changed.
    pub fn from_db(i: i32) -> Self {
        match i {
            1 => Self::Passed,
            2 => Self::Warning,
            3 => Self::Failed,
            4 => Self::Error,
            _ => Self::Unknown,
        }
    }

    /// Serialize to `last_check_status` integer for DB storage.
    pub fn to_db(&self) -> i32 {
        match self {
            Self::Passed => 1,
            Self::Warning => 2,
            Self::Failed => 3,
            Self::Error => 4,
            Self::Unknown => 0,
        }
    }

    /// Convert a raw probe status string to `SyntheticStatus`.
    /// Accepts both new strings ("passed"/"failed") and legacy ("up"/"down") for
    /// backward compatibility with older probes during rollout.
    pub fn from_probe_str(s: &str) -> Self {
        match s {
            "passed" | "up" => Self::Passed,
            "warning" => Self::Warning,
            "failed" | "down" => Self::Failed,
            "error" => Self::Error,
            _ => Self::Failed,
        }
    }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyntheticAuth {
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

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct SyntheticCookie {
    pub name: String,
    /// Cookie value — encrypted at rest with org DEK.
    pub value: String,
    pub domain: String,
    #[serde(default = "default_cookie_path")]
    pub path: String,
    #[serde(default)]
    pub http_only: bool,
    #[serde(default)]
    pub secure: bool,
}

fn default_cookie_path() -> String {
    "/".to_string()
}

// ── Variables ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct SyntheticVariable {
    pub name: String,
    pub value: String,
    /// UI display flag: true = mask value as ••••. No effect on storage — all values are
    /// AES-encrypted at rest unconditionally.
    #[serde(default)]
    pub secure: bool,
    /// Placeholder shown in the UI when secure=true and value is empty/redacted.
    #[serde(default)]
    pub example: String,
}

// ── Settings (packed into the `settings` JSON column) ────────────────────────

/// Non-type-specific monitor settings stored as a single `settings` JSON blob.
/// auth and variables are stored in their own dedicated encrypted TEXT columns, not here.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyntheticSettings {
    #[serde(default)]
    pub retries: i32,
    #[serde(default, alias = "cooldown_secs")]
    pub cooldown_mins: i32,
    #[serde(default = "default_wait_before_retry_secs_i32")]
    pub wait_before_retry_secs: i32,
    #[serde(default = "default_one_i32")]
    pub alert_if_fails: i32,
    #[serde(default)]
    pub collect_rum_data: bool,
    #[serde(default)]
    pub session_replay: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<i64>,
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

// ── List response (synthetic + computed fields) ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SyntheticListItem {
    pub id: String,
    pub org_id: String,
    pub folder_id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    #[serde(rename = "type")]
    pub monitor_type: SyntheticType,
    pub target: String,
    pub frequency: SyntheticFrequency,
    pub locations: Vec<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_triggered_at: i64,

    // runtime fields — current status only; uptime/history fetched separately via search
    pub status: SyntheticStatus,
    pub last_check_at: Option<i64>,
    pub last_response_ms: Option<f64>,
}

// ── Query params / responses ──────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ListSyntheticsParams {
    pub folder_id: Option<String>,
    pub monitor_type: Option<SyntheticType>,
    pub enabled: Option<bool>,
    pub location: Option<String>,
    pub tag: Option<String>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SyntheticListResponse {
    pub monitors: Vec<SyntheticListItem>,
    pub total: i64,
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
pub struct PingConfig {
    /// Number of ICMP packets to send per check.
    #[serde(default = "default_ping_count")]
    pub packet_count: u32,
    /// Packet size in bytes.
    #[serde(default = "default_ping_packet_size")]
    pub packet_size: u32,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsConfig {
    /// DNS record type to query: "A", "AAAA", "CNAME", "MX", "TXT", "NS".
    #[serde(default = "default_dns_record_type")]
    pub record_type: String,
    /// Optional expected value to assert against (e.g. expected IP or CNAME target).
    pub expected_value: Option<String>,
    /// Nameserver to query (e.g. "8.8.8.8"). Defaults to system resolver.
    pub nameserver: Option<String>,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
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
    /// "desktop" | "tablet" | "mobile"
    pub device: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BrowserConfig {
    #[serde(default = "default_browser_devices")]
    pub browser_devices: Vec<BrowserDevice>,
    pub runtime: Option<String>,
    #[serde(default)]
    pub steps: Vec<serde_json::Value>,
    #[serde(default)]
    pub env: Vec<String>,
    #[serde(default)]
    pub secrets: Vec<BrowserSecret>,
    #[serde(default = "default_browser_timeout_ms")]
    pub timeout_ms: u32,
    pub capture: Option<BrowserCapture>,
}

/// A recorder-captured secret form value (e.g. a password typed during a login
/// step). `value` is AES-encrypted at rest — declared in
/// `SyntheticType::secret_config_paths` as `/secrets/*/value`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BrowserSecret {
    pub name: String,
    pub value: String,
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

fn default_ping_count() -> u32 {
    4
}

fn default_ping_packet_size() -> u32 {
    56
}

fn default_dns_record_type() -> String {
    "A".to_string()
}

fn default_browser_devices() -> Vec<BrowserDevice> {
    vec![BrowserDevice {
        browser: "chromium".to_string(),
        device: "desktop".to_string(),
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

// ── Payload validation ────────────────────────────────────────────────────────

/// Step actions the browser probe knows how to execute — must stay in sync with
/// `buildStepCode` in browser-probe/src/runner.ts. The probe silently no-ops
/// unknown actions (they "pass" without doing anything), so rejecting them here
/// is the only guard. "scroll" is recorder-emitted but currently a probe no-op.
const KNOWN_STEP_ACTIONS: &[&str] = &[
    "navigate",
    "click",
    "fill",
    "type",
    "select",
    "check",
    "uncheck",
    "keydown",
    "press",
    "hover",
    "scroll",
    "wait",
    "waitFor",
    "assert",
    "screenshot",
    "upload",
    "setInputFiles",
];

/// Actions that require a non-empty `selector`.
const SELECTOR_ACTIONS: &[&str] = &[
    "click",
    "fill",
    "type",
    "select",
    "check",
    "uncheck",
    "hover",
    "upload",
    "setInputFiles",
];

const MAX_STEPS: usize = 50;
const MAX_STEPS_JSON_BYTES: usize = 100_000;
const MAX_TAGS: usize = 20;
const MAX_VARIABLES: usize = 50;
const MAX_BROWSER_DEVICE_COMBOS: usize = 12;
/// Minimum schedule interval (seconds) for protocol monitors (http/tcp/ping/…).
/// Ping-style checks legitimately run at 1s granularity.
/// NOTE: the scheduler ticks every 5s, so sub-5s intervals fire at tick
/// resolution — allowed here, but effective cadence is bounded by the tick.
const MIN_INTERVAL_SECS: i64 = 1;
/// Minimum schedule interval (seconds) for browser monitors — each fire costs
/// one Lambda invocation per location per browser×device combo.
const MIN_BROWSER_INTERVAL_SECS: i64 = 60;

fn validate_http_url(field: &str, value: &str) -> Result<(), String> {
    let parsed =
        url::Url::parse(value).map_err(|e| format!("{field}: invalid URL '{value}': {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!(
            "{field}: URL scheme must be http or https, got '{}'",
            parsed.scheme()
        ));
    }
    if parsed.host_str().is_none_or(str::is_empty) {
        return Err(format!("{field}: URL has no host"));
    }
    Ok(())
}

fn validate_host_target(target: &str) -> Result<(), String> {
    if target.trim().is_empty() {
        return Err("target: must not be empty".to_string());
    }
    if target.contains("://") {
        return Err(format!(
            "target: expected host or host:port, got a URL '{target}'"
        ));
    }
    if target.chars().any(char::is_whitespace) {
        return Err(format!("target: must not contain whitespace: '{target}'"));
    }
    Ok(())
}

/// Membership check with the same normalisation the create path applies to
/// locations (bare region → "aws-" prefix).
fn location_allowed(loc: &str, allowed: &[String]) -> bool {
    allowed.iter().any(|a| a == loc)
        || (!loc.contains('-')
            || !["aws-", "gcp-", "azure-"]
                .iter()
                .any(|p| loc.starts_with(p)))
            && allowed.iter().any(|a| a == &format!("aws-{loc}"))
}

impl Synthetic {
    /// Validates a create/update payload. `allowed_*` come from the deployment's
    /// synthetics capabilities. Empty `allowed_browsers`/`allowed_devices` skip
    /// the corresponding membership check; an empty `allowed_locations` REJECTS
    /// (a check accepted against an empty location registry could never run).
    ///
    /// Returns the first problem found as `Err(message)`; messages are safe to
    /// return verbatim in a 400 response.
    /// `is_create`: the `start` freshness check only applies on create — edits
    /// round-trip the monitor's original start date, which is legitimately in
    /// the past for any monitor older than the grace window.
    pub fn validate(
        &self,
        allowed_locations: &[String],
        allowed_browsers: &[String],
        allowed_devices: &[String],
        is_create: bool,
    ) -> Result<(), String> {
        // ── name / description / tags ──────────────────────────────────────
        if self.name.trim().is_empty() {
            return Err("name: must not be empty".to_string());
        }
        if self.name.len() > 256 {
            return Err(format!("name: too long ({} > 256 chars)", self.name.len()));
        }
        if self.description.len() > 4096 {
            return Err(format!(
                "description: too long ({} > 4096 chars)",
                self.description.len()
            ));
        }
        if self.tags.len() > MAX_TAGS {
            return Err(format!("tags: too many ({} > {MAX_TAGS})", self.tags.len()));
        }
        for tag in &self.tags {
            if tag.trim().is_empty() {
                return Err("tags: empty tag not allowed".to_string());
            }
            if tag.len() > 64 {
                return Err(format!("tags: tag too long ({} > 64 chars)", tag.len()));
            }
        }

        // ── target ─────────────────────────────────────────────────────────
        match self.monitor_type {
            SyntheticType::Http | SyntheticType::Api | SyntheticType::Browser => {
                validate_http_url("target", &self.target)?
            }
            _ => validate_host_target(&self.target)?,
        }

        // ── frequency ──────────────────────────────────────────────────────
        if self.tz_offset < -720 || self.tz_offset > 840 {
            return Err(format!(
                "tz_offset: out of range ({} not in -720..=840 minutes)",
                self.tz_offset
            ));
        }
        match self.frequency.frequency_type {
            SyntheticFrequencyType::Cron => {
                use std::str::FromStr;
                if self.frequency.cron.trim().is_empty() {
                    return Err("frequency.cron: must not be empty for cron type".to_string());
                }
                cron::Schedule::from_str(&self.frequency.cron).map_err(|e| {
                    format!(
                        "frequency.cron: invalid expression '{}': {e}",
                        self.frequency.cron
                    )
                })?;
            }
            _ => {
                if self.frequency.interval < 1 {
                    return Err(format!(
                        "frequency.interval: must be >= 1, got {}",
                        self.frequency.interval
                    ));
                }
                let min_secs = if self.monitor_type == SyntheticType::Browser {
                    MIN_BROWSER_INTERVAL_SECS
                } else {
                    MIN_INTERVAL_SECS
                };
                if self.frequency.interval_secs() < min_secs {
                    return Err(format!(
                        "frequency: interval too short ({}s < {min_secs}s minimum for {:?} monitors)",
                        self.frequency.interval_secs(),
                        self.monitor_type
                    ));
                }
            }
        }

        // ── locations ──────────────────────────────────────────────────────
        if self.locations.is_empty() {
            return Err("locations: at least one location is required".to_string());
        }
        // An empty registry must reject, not skip the membership check: a
        // synthetic accepted against no registered locations enqueues jobs
        // into the legacy "aws" fallback pool that nothing ever leases —
        // it can never run, and the user gets no error anywhere.
        if allowed_locations.is_empty() {
            return Err(
                "locations: no locations are registered on this deployment — register at least one location before creating synthetics".to_string(),
            );
        }
        let mut seen_locations = std::collections::HashSet::new();
        for loc in &self.locations {
            if !seen_locations.insert(loc.as_str()) {
                return Err(format!("locations: duplicate location '{loc}'"));
            }
            if !location_allowed(loc, allowed_locations) {
                return Err(format!(
                    "locations: unknown location '{loc}' (allowed: {})",
                    allowed_locations.join(", ")
                ));
            }
        }

        // ── retry / alert settings ─────────────────────────────────────────
        if !(0..=3).contains(&self.retries) {
            return Err(format!("retries: must be 0..=3, got {}", self.retries));
        }
        if !(0..=300).contains(&self.wait_before_retry_secs) {
            return Err(format!(
                "wait_before_retry_secs: must be 0..=300, got {}",
                self.wait_before_retry_secs
            ));
        }
        if !(1..=100).contains(&self.alert_if_fails) {
            return Err(format!(
                "alert_if_fails: must be 1..=100, got {}",
                self.alert_if_fails
            ));
        }
        if !(0..=1440).contains(&self.cooldown_mins) {
            return Err(format!(
                "cooldown_mins: must be 0..=1440, got {}",
                self.cooldown_mins
            ));
        }
        for dest in &self.destinations {
            if dest.trim().is_empty() {
                return Err("destinations: empty destination name not allowed".to_string());
            }
        }

        // ── variables ──────────────────────────────────────────────────────
        if self.variables.len() > MAX_VARIABLES {
            return Err(format!(
                "variables: too many ({} > {MAX_VARIABLES})",
                self.variables.len()
            ));
        }
        let mut seen_vars = std::collections::HashSet::new();
        for v in &self.variables {
            let valid_name = !v.name.is_empty()
                && v.name
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && v.name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_');
            if !valid_name {
                return Err(format!(
                    "variables: invalid name '{}' (must match [A-Za-z_][A-Za-z0-9_]*)",
                    v.name
                ));
            }
            if !seen_vars.insert(v.name.as_str()) {
                return Err(format!("variables: duplicate name '{}'", v.name));
            }
        }

        // ── auth / cookies ─────────────────────────────────────────────────
        match &self.auth {
            Some(SyntheticAuth::Basic { username, .. }) if username.trim().is_empty() => {
                return Err("auth.username: must not be empty for basic auth".to_string());
            }
            Some(SyntheticAuth::Bearer { token }) if token.trim().is_empty() => {
                return Err("auth.token: must not be empty for bearer auth".to_string());
            }
            Some(SyntheticAuth::Secret { secret_name }) if secret_name.trim().is_empty() => {
                return Err("auth.secret_name: must not be empty for secret auth".to_string());
            }
            _ => {}
        }
        for cookie in &self.cookies {
            if cookie.name.trim().is_empty() {
                return Err("cookies: cookie name must not be empty".to_string());
            }
            if cookie.domain.trim().is_empty() {
                return Err(format!(
                    "cookies: domain must not be empty (cookie '{}')",
                    cookie.name
                ));
            }
        }

        // ── start ("schedule later") — create only ─────────────────────────
        // The UI also sets start for "Schedule Now", truncated to the current
        // minute — allow a 15-minute grace window for that plus clock skew.
        // Skipped on update: edits round-trip the original (old) start date.
        if is_create
            && let Some(start) = self.start
            && start < crate::utils::time::now_micros() - 15 * 60 * 1_000_000
        {
            return Err("start: must not be in the past".to_string());
        }

        // ── type-specific config ───────────────────────────────────────────
        self.validate_config(allowed_browsers, allowed_devices)
    }

    /// Parses `config` into the struct matching `monitor_type` and validates it.
    fn validate_config(
        &self,
        allowed_browsers: &[String],
        allowed_devices: &[String],
    ) -> Result<(), String> {
        match self.monitor_type {
            SyntheticType::Browser => {
                let cfg: BrowserConfig = serde_json::from_value(self.config.clone())
                    .map_err(|e| format!("config: not a valid browser config: {e}"))?;
                validate_browser_config(&cfg, &self.frequency, allowed_browsers, allowed_devices)
            }
            SyntheticType::Http | SyntheticType::Api => {
                let cfg: HttpConfig = serde_json::from_value(self.config.clone())
                    .map_err(|e| format!("config: not a valid http config: {e}"))?;
                const METHODS: &[&str] =
                    &["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
                if !METHODS.contains(&cfg.method.to_uppercase().as_str()) {
                    return Err(format!(
                        "config.method: unknown HTTP method '{}'",
                        cfg.method
                    ));
                }
                // Reject unknown assertion fields/operators at create time —
                // the probe evaluates unknown assertions as failures, so a
                // typo would only surface as every run failing.
                const ASSERTION_FIELDS: &[&str] = &["status_code", "body", "response_time_ms"];
                const ASSERTION_OPERATORS: &[&str] =
                    &["eq", "ne", "lt", "gt", "contains", "not_contains"];
                for (i, a) in cfg.assertions.iter().enumerate() {
                    if !ASSERTION_FIELDS.contains(&a.field.as_str()) {
                        return Err(format!(
                            "config.assertions[{i}].field: unknown field '{}' (known: {})",
                            a.field,
                            ASSERTION_FIELDS.join(", ")
                        ));
                    }
                    if !ASSERTION_OPERATORS.contains(&a.operator.as_str()) {
                        return Err(format!(
                            "config.assertions[{i}].operator: unknown operator '{}' (known: {})",
                            a.operator,
                            ASSERTION_OPERATORS.join(", ")
                        ));
                    }
                }
                Ok(())
            }
            SyntheticType::Tcp => serde_json::from_value::<TcpConfig>(self.config.clone())
                .map(|_| ())
                .map_err(|e| format!("config: not a valid tcp config: {e}")),
            SyntheticType::Tls => serde_json::from_value::<TlsConfig>(self.config.clone())
                .map(|_| ())
                .map_err(|e| format!("config: not a valid tls config: {e}")),
            SyntheticType::Ping => serde_json::from_value::<PingConfig>(self.config.clone())
                .map(|_| ())
                .map_err(|e| format!("config: not a valid ping config: {e}")),
            SyntheticType::Dns => serde_json::from_value::<DnsConfig>(self.config.clone())
                .map(|_| ())
                .map_err(|e| format!("config: not a valid dns config: {e}")),
            SyntheticType::Ssh => {
                let cfg: SshConfig = serde_json::from_value(self.config.clone())
                    .map_err(|e| format!("config: not a valid ssh config: {e}"))?;
                if cfg.username.trim().is_empty() {
                    return Err("config.username: must not be empty".to_string());
                }
                if !["password", "private_key"].contains(&cfg.auth.auth_type.as_str()) {
                    return Err(format!(
                        "config.auth.type: unknown auth type '{}' (known: password, private_key)",
                        cfg.auth.auth_type
                    ));
                }
                // Empty secret is allowed: the probe runs a credential-less
                // banner check (a rejected auth still proves SSH is up).
                Ok(())
            }
        }
    }
}

fn validate_browser_config(
    cfg: &BrowserConfig,
    frequency: &SyntheticFrequency,
    allowed_browsers: &[String],
    allowed_devices: &[String],
) -> Result<(), String> {
    // ── steps ──────────────────────────────────────────────────────────────
    if cfg.steps.is_empty() {
        return Err("config.steps: at least one step is required".to_string());
    }
    if cfg.steps.len() > MAX_STEPS {
        return Err(format!(
            "config.steps: too many steps ({} > {MAX_STEPS})",
            cfg.steps.len()
        ));
    }
    let steps_bytes = serde_json::to_string(&cfg.steps)
        .map(|s| s.len())
        .unwrap_or(0);
    if steps_bytes > MAX_STEPS_JSON_BYTES {
        return Err(format!(
            "config.steps: serialized steps too large ({steps_bytes} > {MAX_STEPS_JSON_BYTES} bytes)"
        ));
    }

    let mut seen_ids = std::collections::HashSet::new();
    for (i, step) in cfg.steps.iter().enumerate() {
        let action = step
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("config.steps[{i}]: missing 'action'"))?;
        if !KNOWN_STEP_ACTIONS.contains(&action) {
            return Err(format!(
                "config.steps[{i}]: unknown action '{action}' (known: {})",
                KNOWN_STEP_ACTIONS.join(", ")
            ));
        }

        // The probe opens about:blank and never auto-navigates — a journey
        // whose first step isn't a navigate runs against a blank page.
        if i == 0 && action != "navigate" {
            return Err(format!(
                "config.steps[0]: first step must be 'navigate', got '{action}'"
            ));
        }

        if let Some(id) = step.get("id").and_then(|v| v.as_str()) {
            if id.is_empty() {
                return Err(format!("config.steps[{i}]: 'id' must not be empty"));
            }
            if !seen_ids.insert(id.to_string()) {
                return Err(format!("config.steps[{i}]: duplicate step id '{id}'"));
            }
        } else {
            return Err(format!("config.steps[{i}]: missing 'id'"));
        }

        if action == "navigate" {
            let step_url = step
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("config.steps[{i}]: navigate step missing 'url'"))?;
            validate_http_url(&format!("config.steps[{i}].url"), step_url)?;
        }
        if SELECTOR_ACTIONS.contains(&action) {
            let selector = step.get("selector").and_then(|v| v.as_str()).unwrap_or("");
            if selector.is_empty() {
                return Err(format!(
                    "config.steps[{i}]: '{action}' step requires a non-empty 'selector'"
                ));
            }
        }
        if (action == "type" || action == "fill")
            && step.get("value").and_then(|v| v.as_str()).is_none()
        {
            return Err(format!(
                "config.steps[{i}]: '{action}' step requires a 'value'"
            ));
        }
        if let Some(timeout) = step.get("timeout_ms").and_then(|v| v.as_u64())
            && !(100..=60_000).contains(&timeout)
        {
            return Err(format!(
                "config.steps[{i}].timeout_ms: must be 100..=60000, got {timeout}"
            ));
        }
    }

    // ── browser × device combos ────────────────────────────────────────────
    if cfg.browser_devices.is_empty() {
        return Err(
            "config.browser_devices: at least one browser+device combo is required".to_string(),
        );
    }
    if cfg.browser_devices.len() > MAX_BROWSER_DEVICE_COMBOS {
        return Err(format!(
            "config.browser_devices: too many combos ({} > {MAX_BROWSER_DEVICE_COMBOS})",
            cfg.browser_devices.len()
        ));
    }
    let mut seen_combos = std::collections::HashSet::new();
    for bd in &cfg.browser_devices {
        if !seen_combos.insert((bd.browser.as_str(), bd.device.as_str())) {
            return Err(format!(
                "config.browser_devices: duplicate combo '{}/{}'",
                bd.browser, bd.device
            ));
        }
        if !allowed_browsers.is_empty() && !allowed_browsers.contains(&bd.browser) {
            return Err(format!(
                "config.browser_devices: unknown browser '{}' (allowed: {})",
                bd.browser,
                allowed_browsers.join(", ")
            ));
        }
        if !allowed_devices.is_empty() && !allowed_devices.contains(&bd.device) {
            return Err(format!(
                "config.browser_devices: unknown device '{}' (allowed: {})",
                bd.device,
                allowed_devices.join(", ")
            ));
        }
    }

    // ── timeout vs schedule ────────────────────────────────────────────────
    if !(5_000..=300_000).contains(&cfg.timeout_ms) {
        return Err(format!(
            "config.timeout_ms: must be 5000..=300000, got {}",
            cfg.timeout_ms
        ));
    }
    let interval_secs = frequency.interval_secs();
    if interval_secs > 0 && i64::from(cfg.timeout_ms) >= interval_secs * 1000 {
        return Err(format!(
            "config.timeout_ms: run timeout ({}ms) must be shorter than the schedule interval ({}s)",
            cfg.timeout_ms, interval_secs
        ));
    }

    // ── capture modes ──────────────────────────────────────────────────────
    if let Some(capture) = &cfg.capture {
        const MODES: &[&str] = &["always", "on-fail", "on_fail", "off"];
        for (field, value) in [
            ("screenshot", &capture.screenshot),
            ("trace", &capture.trace),
            ("video", &capture.video),
        ] {
            if !MODES.contains(&value.as_str()) {
                return Err(format!(
                    "config.capture.{field}: must be one of always|on-fail|off, got '{value}'"
                ));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_monitor_type_default() {
        assert_eq!(SyntheticType::default(), SyntheticType::Http);
    }

    #[test]
    fn test_monitor_type_serde() {
        let json = serde_json::json!("browser");
        let mt: SyntheticType = serde_json::from_value(json).unwrap();
        assert_eq!(mt, SyntheticType::Browser);
    }

    #[test]
    fn test_secret_config_paths() {
        assert_eq!(SyntheticType::Ssh.secret_config_paths(), &["/auth/secret"]);
        assert_eq!(
            SyntheticType::Browser.secret_config_paths(),
            &["/secrets/*/value", "/headers/*/value"]
        );
        assert_eq!(
            SyntheticType::Http.secret_config_paths(),
            &["/headers/*/value"]
        );
        assert_eq!(
            SyntheticType::Api.secret_config_paths(),
            &["/headers/*/value"]
        );
        assert!(SyntheticType::Tcp.secret_config_paths().is_empty());
        assert!(SyntheticType::Tls.secret_config_paths().is_empty());
        assert!(SyntheticType::Ping.secret_config_paths().is_empty());
        assert!(SyntheticType::Dns.secret_config_paths().is_empty());
    }

    #[test]
    fn test_for_each_string_at_path_object() {
        let mut v = serde_json::json!({"auth": {"type": "password", "secret": "hunter2"}});
        for_each_string_at_path(&mut v, "/auth/secret", &mut |s| {
            *s = format!("enc({s})");
            Ok::<(), ()>(())
        })
        .unwrap();
        assert_eq!(v["auth"]["secret"], "enc(hunter2)");
        // sibling untouched
        assert_eq!(v["auth"]["type"], "password");
    }

    #[test]
    fn test_for_each_string_at_path_array_wildcard() {
        let mut v = serde_json::json!({"secrets": [
            {"name": "a", "value": "1"},
            {"name": "b", "value": "2"},
        ]});
        for_each_string_at_path(&mut v, "/secrets/*/value", &mut |s| {
            *s = format!("enc({s})");
            Ok::<(), ()>(())
        })
        .unwrap();
        assert_eq!(v["secrets"][0]["value"], "enc(1)");
        assert_eq!(v["secrets"][1]["value"], "enc(2)");
        assert_eq!(v["secrets"][0]["name"], "a");
    }

    #[test]
    fn test_for_each_string_at_path_missing_and_nonstring() {
        // Missing path — no-op, no error.
        let mut v = serde_json::json!({"port": 22});
        for_each_string_at_path(&mut v, "/auth/secret", &mut |_| {
            panic!("must not visit");
            #[allow(unreachable_code)]
            Ok::<(), ()>(())
        })
        .unwrap();
        // Non-string leaf — skipped.
        let mut v = serde_json::json!({"auth": {"secret": 42}});
        for_each_string_at_path(&mut v, "/auth/secret", &mut |_| {
            panic!("must not visit");
            #[allow(unreachable_code)]
            Ok::<(), ()>(())
        })
        .unwrap();
        assert_eq!(v["auth"]["secret"], 42);
    }

    #[test]
    fn test_take_strings_at_path() {
        let mut v = serde_json::json!({
            "headers": [
                {"name": "Authorization", "value": "Basic abc"},
                {"name": "X-Empty", "value": ""},
                {"name": "X-Api-Key", "value": "k123"},
            ],
            "auth": {"secret": "hunter2"}
        });
        let taken = take_strings_at_path(&mut v, "/headers/*/value");
        assert_eq!(
            taken,
            vec![
                ("/headers/0/value".to_string(), "Basic abc".to_string()),
                ("/headers/2/value".to_string(), "k123".to_string()),
            ]
        );
        // Slots blanked, shape intact, names untouched.
        assert_eq!(v["headers"][0]["value"], "");
        assert_eq!(v["headers"][2]["value"], "");
        assert_eq!(v["headers"][0]["name"], "Authorization");
        // Non-matching path untouched.
        assert_eq!(v["auth"]["secret"], "hunter2");
        let taken2 = take_strings_at_path(&mut v, "/auth/secret");
        assert_eq!(
            taken2,
            vec![("/auth/secret".to_string(), "hunter2".to_string())]
        );
        // Rehydrate via pointer round-trips.
        *v.pointer_mut("/headers/0/value").unwrap() = serde_json::json!("Basic abc");
        assert_eq!(v["headers"][0]["value"], "Basic abc");
    }

    #[test]
    fn test_for_each_string_at_path_error_propagates() {
        let mut v = serde_json::json!({"auth": {"secret": "x"}});
        let res = for_each_string_at_path(&mut v, "/auth/secret", &mut |_| Err("boom"));
        assert_eq!(res, Err("boom"));
    }

    #[test]
    fn test_monitor_status_default() {
        assert_eq!(SyntheticStatus::default(), SyntheticStatus::Unknown);
    }

    #[test]
    fn test_synthetic_status_db_roundtrip() {
        assert_eq!(SyntheticStatus::from_db(0), SyntheticStatus::Unknown);
        assert_eq!(SyntheticStatus::from_db(1), SyntheticStatus::Passed);
        assert_eq!(SyntheticStatus::from_db(2), SyntheticStatus::Warning);
        assert_eq!(SyntheticStatus::from_db(3), SyntheticStatus::Failed);
        assert_eq!(SyntheticStatus::from_db(4), SyntheticStatus::Error);
        assert_eq!(SyntheticStatus::from_db(99), SyntheticStatus::Unknown);

        assert_eq!(SyntheticStatus::Unknown.to_db(), 0);
        assert_eq!(SyntheticStatus::Passed.to_db(), 1);
        assert_eq!(SyntheticStatus::Warning.to_db(), 2);
        assert_eq!(SyntheticStatus::Failed.to_db(), 3);
        assert_eq!(SyntheticStatus::Error.to_db(), 4);
    }

    #[test]
    fn test_synthetic_status_from_probe_str() {
        // new strings
        assert_eq!(
            SyntheticStatus::from_probe_str("passed"),
            SyntheticStatus::Passed
        );
        assert_eq!(
            SyntheticStatus::from_probe_str("warning"),
            SyntheticStatus::Warning
        );
        assert_eq!(
            SyntheticStatus::from_probe_str("failed"),
            SyntheticStatus::Failed
        );
        assert_eq!(
            SyntheticStatus::from_probe_str("error"),
            SyntheticStatus::Error
        );
        // legacy strings — backward compat during rollout
        assert_eq!(
            SyntheticStatus::from_probe_str("up"),
            SyntheticStatus::Passed
        );
        assert_eq!(
            SyntheticStatus::from_probe_str("down"),
            SyntheticStatus::Failed
        );
        assert_eq!(
            SyntheticStatus::from_probe_str("unknown_garbage"),
            SyntheticStatus::Failed
        );
    }

    #[test]
    fn test_frequency_interval_secs() {
        let f = SyntheticFrequency {
            interval: 5,
            cron: String::new(),
            frequency_type: SyntheticFrequencyType::Minutes,
            ..Default::default()
        };
        assert_eq!(f.interval_secs(), 300);

        let f = SyntheticFrequency {
            interval: 30,
            cron: String::new(),
            frequency_type: SyntheticFrequencyType::Seconds,
            ..Default::default()
        };
        assert_eq!(f.interval_secs(), 30);

        let f = SyntheticFrequency {
            interval: 0,
            cron: "0 */5 * * * *".to_string(),
            frequency_type: SyntheticFrequencyType::Cron,
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
        let auth = SyntheticAuth::Basic {
            username: "user".to_string(),
            password: "pass".to_string(),
        };
        let json = serde_json::to_value(&auth).unwrap();
        assert_eq!(json["type"], "basic");
        assert_eq!(json["username"], "user");
    }

    // ── validate() ──────────────────────────────────────────────────────────

    fn valid_browser_synthetic() -> Synthetic {
        Synthetic {
            name: "login flow".to_string(),
            monitor_type: SyntheticType::Browser,
            target: "https://example.com".to_string(),
            frequency: SyntheticFrequency {
                frequency_type: SyntheticFrequencyType::Minutes,
                interval: 5,
                cron: String::new(),
                timezone: None,
            },
            locations: vec!["aws-us-east-1".to_string()],
            enabled: true,
            alert_if_fails: 1,
            wait_before_retry_secs: 5,
            config: serde_json::json!({
                "steps": [
                    { "id": "s1", "action": "navigate", "url": "https://example.com" },
                    { "id": "s2", "action": "click", "selector": "#login" }
                ],
                "browser_devices": [ { "browser": "chromium", "device": "desktop" } ],
                "timeout_ms": 30000
            }),
            ..Default::default()
        }
    }

    fn allowed() -> (Vec<String>, Vec<String>, Vec<String>) {
        (
            vec!["aws-us-east-1".to_string(), "aws-us-west-1".to_string()],
            vec!["chromium".to_string(), "firefox".to_string()],
            vec!["desktop".to_string(), "mobile".to_string()],
        )
    }

    #[test]
    fn test_validate_ok() {
        let (locs, brs, devs) = allowed();
        assert!(
            valid_browser_synthetic()
                .validate(&locs, &brs, &devs, true)
                .is_ok()
        );
    }

    #[test]
    fn test_validate_empty_location_registry_rejected() {
        // An empty registry must reject — jobs for such a check would land
        // in the legacy "aws" fallback pool that nothing leases.
        let (_, brs, devs) = allowed();
        let err = valid_browser_synthetic()
            .validate(&[], &brs, &devs, true)
            .unwrap_err();
        assert!(err.contains("no locations are registered"), "{err}");
    }

    #[test]
    fn test_validate_http_assertion_field_and_operator() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.monitor_type = SyntheticType::Http;
        s.target = "https://example.com/".to_string();
        s.config = serde_json::json!({
            "method": "GET",
            "assertions": [{"field": "status", "operator": "eq", "value": 200}]
        });
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("unknown field 'status'"), "{err}");

        s.config = serde_json::json!({
            "method": "GET",
            "assertions": [{"field": "status_code", "operator": "equals", "value": 200}]
        });
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("unknown operator 'equals'"), "{err}");

        s.config = serde_json::json!({
            "method": "GET",
            "assertions": [{"field": "status_code", "operator": "eq", "value": 200}]
        });
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    #[test]
    fn test_validate_ssh_config_fields() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.monitor_type = SyntheticType::Ssh;
        s.target = "test.rebex.net:22".to_string();

        s.config = serde_json::json!({
            "username": "", "auth": {"type": "password", "secret": "x"}
        });
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("config.username"), "{err}");

        s.config = serde_json::json!({
            "username": "demo", "auth": {"type": "kerberos", "secret": "x"}
        });
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("unknown auth type 'kerberos'"), "{err}");

        // Empty secret = credential-less banner check — allowed.
        s.config = serde_json::json!({
            "username": "demo", "auth": {"type": "password", "secret": ""}
        });
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());

        s.config = serde_json::json!({
            "username": "demo", "auth": {"type": "password", "secret": "password"}
        });
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    #[test]
    fn test_validate_empty_name() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.name = "  ".to_string();
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.starts_with("name:"), "{err}");
    }

    #[test]
    fn test_validate_bad_target_url() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.target = "not a url".to_string();
        assert!(
            s.validate(&locs, &brs, &devs, true)
                .unwrap_err()
                .starts_with("target:")
        );
    }

    #[test]
    fn test_validate_empty_steps() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.config = serde_json::json!({
            "steps": [],
            "browser_devices": [ { "browser": "chromium", "device": "desktop" } ]
        });
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("at least one step"), "{err}");
    }

    #[test]
    fn test_validate_first_step_must_navigate() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.config = serde_json::json!({
            "steps": [ { "id": "s1", "action": "click", "selector": "#x" } ],
            "browser_devices": [ { "browser": "chromium", "device": "desktop" } ],
            "timeout_ms": 30000
        });
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("first step must be 'navigate'"), "{err}");
    }

    #[test]
    fn test_validate_unknown_browser() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.config = serde_json::json!({
            "steps": [ { "id": "s1", "action": "navigate", "url": "https://example.com" } ],
            "browser_devices": [ { "browser": "safari", "device": "desktop" } ],
            "timeout_ms": 30000
        });
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("unknown browser 'safari'"), "{err}");
    }

    #[test]
    fn test_validate_unknown_location() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.locations = vec!["mars-north-1".to_string()];
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("unknown location"), "{err}");
    }

    #[test]
    fn test_validate_bare_region_location_allowed() {
        // create path normalizes "us-east-1" → "aws-us-east-1"; membership
        // check must accept the bare form too.
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.locations = vec!["us-east-1".to_string()];
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    #[test]
    fn test_validate_empty_locations() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.locations = vec![];
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("at least one location"), "{err}");
    }

    #[test]
    fn test_validate_invalid_cron() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.frequency = SyntheticFrequency {
            frequency_type: SyntheticFrequencyType::Cron,
            interval: 0,
            cron: "not a cron".to_string(),
            timezone: None,
        };
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.starts_with("frequency.cron:"), "{err}");
    }

    #[test]
    fn test_validate_browser_interval_floor() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.frequency.frequency_type = SyntheticFrequencyType::Seconds;
        s.frequency.interval = 30; // < 60s browser floor
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("interval too short"), "{err}");
    }

    #[test]
    fn test_validate_timeout_exceeds_interval() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.frequency.frequency_type = SyntheticFrequencyType::Minutes;
        s.frequency.interval = 1; // 60s
        s.config["timeout_ms"] = serde_json::json!(120_000);
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("shorter than the schedule interval"), "{err}");
    }

    #[test]
    fn test_validate_bad_variable_name() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.variables = vec![SyntheticVariable {
            name: "1BAD".to_string(),
            value: "x".to_string(),
            secure: false,
            example: String::new(),
        }];
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("invalid name '1BAD'"), "{err}");
    }

    #[test]
    fn test_validate_retries_out_of_range() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.retries = 99;
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.starts_with("retries:"), "{err}");
    }

    #[test]
    fn test_validate_config_shape_mismatch() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.monitor_type = SyntheticType::Tcp;
        s.target = "example.com:443".to_string();
        // browser-shaped config on a tcp monitor → port missing → shape error
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("not a valid tcp config"), "{err}");
    }

    #[test]
    fn test_validate_stale_start_rejected_on_create_allowed_on_update() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.start = Some(crate::utils::time::now_micros() - 3600 * 1_000_000); // 1h ago
        // Create: rejected.
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.starts_with("start:"), "{err}");
        // Update: edits round-trip the original start — must pass.
        assert!(s.validate(&locs, &brs, &devs, false).is_ok());
    }

    #[test]
    fn test_validate_http_ok() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.monitor_type = SyntheticType::Http;
        s.config = serde_json::json!({ "method": "GET" });
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }
}
