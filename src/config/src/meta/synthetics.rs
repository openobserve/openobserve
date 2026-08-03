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

// ── Step record ───────────────────────────────────────────────────────────────
//
// The retired version-1 step was untyped JSON with a single `selector` and a
// recorder-stamped `timeout_ms`. This typed, server-validated structure replaced
// it, and is now the only shape a monitor can hold.
//
// The envelope is defined ONCE, complete, even though later phases populate
// parts of it: `settle.navigation` (Phase 3), `settle.responses` (Phase 4),
// `assertion` / `optional` / `always_run` (Phase 5). Versioning it per phase
// would break deployment skew — `deny_unknown_fields` means an additive field
// from a newer recorder would be refused by an older server. Every block except
// `locator` is optional, with a defined absent-behaviour, which is what lets the
// phases ship independently.

/// One part of a combined locator, and how it attaches to what precedes it.
///
/// Structured rather than a bare string because the relation CANNOT be
/// recomputed: whether two locators name the same element or one contains the
/// other depends on DOM structure the editor never sees. It is a decision a
/// human made, so it is stored. `value` stays authoritative for execution — the
/// probe, the player and results display all keep handing the candidate's own
/// `value` to `page.locator()`, so no consumer needs a builder.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CompositePart {
    pub value: String,
    /// Absent on the FIRST part, which is the base the others attach to.
    /// "and" | "has" | "has_not" | "descendant" on every later part.
    #[serde(default)]
    pub relation: Option<String>,
}

/// One way to find an element. The bundle's order is the resolution order.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LocatorCandidate {
    /// "test_attribute" | "role" | "text" | "css" | "xpath"
    pub kind: String,
    pub value: String,
    /// Where it came from: "recorded" (default) | "authored" | "composite".
    /// Healing may only touch a recorded entry — see the H1-H6 contract.
    #[serde(default)]
    pub origin: Option<String>,
    /// What a combined locator was built from, and how. Required when
    /// `origin == "composite"`, forbidden otherwise.
    #[serde(default)]
    pub from: Option<Vec<CompositePart>>,
}

/// Every way to identify one element, in the order they are tried.
///
/// The order is the author's, not the recorder's: they drag rows, add their own
/// locators and combine recorded ones. That replaced `user_override`, a single
/// exclusive pin whose only way to say "prefer this one" was to turn fallback
/// off entirely. An ordered list says the same thing by deleting the others,
/// and can also say "prefer mine, fall back to the recording", which a pin
/// could not.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct StepLocator {
    #[serde(default)]
    pub candidates: Vec<LocatorCandidate>,
    /// A human has reordered, added, deleted or combined. Healing must never
    /// reorder such a list.
    #[serde(default)]
    pub author_ordered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SettleNavigation {
    pub url_pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SettleResponse {
    pub url_pattern: String,
    #[serde(default)]
    pub method: Option<String>,
    /// Advisory by default: a signal that never fires annotates the step rather
    /// than failing it. Only an author may set this — the recorder always emits
    /// `false`.
    #[serde(default)]
    pub required: bool,
}

/// What the page demonstrably did after this step, observed during recording and
/// replayed as explicit wait conditions.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct StepSettle {
    #[serde(default)]
    pub navigation: Option<SettleNavigation>,
    #[serde(default)]
    pub responses: Vec<SettleResponse>,
    /// How long settling actually took while recording. Used for reporting
    /// ("normally ~2s, today 40s") — never as a timeout.
    #[serde(default)]
    pub observed_duration_ms: Option<u64>,
    /// How long this step may spend settling. `None` means the runner's default
    /// (30s).
    ///
    /// This is where a retired hard sleep goes when a journey is lifted
    /// (P3.4.3): `wait 30000` becomes a 30s settle budget on the step BEFORE it,
    /// so the author's intent — "this step needs longer than usual" — survives
    /// while the unconditional sleep does not.
    #[serde(default)]
    pub budget_ms: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StepAssertion {
    pub kind: String,
    #[serde(default)]
    pub expected: Option<String>,
    #[serde(default)]
    pub attribute: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserStepV2 {
    pub id: String,
    pub action: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub locator: Option<StepLocator>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub files: Option<Vec<String>>,
    #[serde(default)]
    pub settle: Option<StepSettle>,
    #[serde(default)]
    pub assertion: Option<StepAssertion>,
    /// Failure skips the step and the run continues (cookie banners, popups).
    #[serde(default)]
    pub optional: bool,
    /// Runs even after an earlier step failed (logout, cleanup).
    #[serde(default)]
    pub always_run: bool,
    /// `None` means "use the runner's per-category default". An explicit value
    /// is a deliberate author choice, validated into 100..=60000.
    #[serde(default)]
    pub timeout_ms: Option<u32>,
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
    /// Playwright's page default timeout — NOT a check timeout, despite the
    /// name. Every step passes an explicit timeout, so this does not cap the
    /// runner's per-category defaults.
    #[serde(default = "default_browser_timeout_ms")]
    pub timeout_ms: u32,
    /// Wall-clock ceiling for one attempt. Absent means
    /// [`DEFAULT_JOURNEY_BUDGET_MS`]. Validated against the job lease so a full
    /// retry sequence cannot outlive it — see `validate_browser_config`.
    pub journey_budget_ms: Option<u32>,
    pub capture: Option<BrowserCapture>,
    /// The DOM attribute the recorder selects on for this monitor.
    ///
    /// Absent means [`DEFAULT_TEST_ID_ATTR`]. It exists because the attribute is
    /// a property of the application under test, not of OpenObserve: Playwright
    /// defaults to `data-testid`, O2's own frontend uses `data-test`, and a
    /// customer may use `data-qa`, `data-cy` or `data-automation-id`.
    ///
    /// Getting it wrong is silent. Upstream's generator carries a hardcoded
    /// fallback list (`data-testid`, `data-test-id`, `data-test`), so an
    /// application outside that list produces NO `test_attribute` candidates at
    /// all and every step degrades to role/text/css without any error.
    ///
    /// Recorded per monitor rather than per org so a journey that was recorded
    /// against one application keeps working when another is added.
    pub test_id_attr: Option<String>,
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

/// Wall-clock ceiling for ONE browser attempt, in milliseconds.
///
/// The recorder used to stamp a 10s timeout into every step, so runs were short
/// and nobody needed a budget. With runner-owned defaults (60s navigation and
/// assertions, 30s interactions) and `retries` defaulting to 1, an 18-step
/// journey's worst case goes from ~180s to ~1085s — past the job lease, after
/// which the reaper requeues the job and it runs again.
const DEFAULT_JOURNEY_BUDGET_MS: u32 = 300_000;
const MIN_JOURNEY_BUDGET_MS: u32 = 5_000;
const MAX_JOURNEY_BUDGET_MS: u32 = 900_000;

/// Lease held on a job while it runs — must stay in sync with `LEASE_SECS` in
/// o2-enterprise `synthetics/dispatcher/mod.rs`, and is the floor the job API
/// applies to every agent lease (`synthetics_jobs::lease_batch`).
///
/// Applies to every check type, not just browser. Both agents ask for a 300s
/// lease, so any check whose retry sequence runs longer than that has its lease
/// expire while the probe is still working — the reaper then terminates the job
/// and completes the run as an error, and the probe's real result is rejected
/// when it finally acks. The validation below is what keeps every check's worst
/// case inside this number, which is in turn what lets the server lease for it
/// unconditionally.
///
/// NOTE: the AWS Lambda function timeout must be >= this value, or runs are
/// killed mid-journey. That setting lives outside this repository and cannot be
/// asserted here. 900s is also AWS's maximum, so raising `retries` or
/// `journey_budget_ms` further requires re-deriving all three together.
pub const JOB_LEASE_SECS: i64 = 900;

/// Ceiling for ONE attempt of a non-browser check, in milliseconds.
///
/// Net `timeout_ms` was previously unbounded: every protocol config defaults it
/// to 10s, but nothing rejected `timeout_ms: 3_600_000`, so the worst case of a
/// retry sequence had no upper limit and could not be checked against the lease.
const MAX_NET_TIMEOUT_MS: u32 = 300_000;
const MIN_NET_TIMEOUT_MS: u32 = 1_000;

/// Worst-case wall clock for one leased job, in milliseconds.
///
/// Retries happen INSIDE the leased job, so the lease has to cover the whole
/// sequence rather than one attempt: `attempts x per_attempt + gaps`. The
/// `multiplier` is for work the probe repeats sequentially within the same job —
/// browser device combos — which the lease also covers.
///
/// Shared by the browser and protocol paths so the two cannot drift; they differ
/// only in what one attempt costs and whether anything multiplies it.
fn worst_case_run_ms(
    per_attempt_ms: u32,
    multiplier: i64,
    retries: i32,
    wait_before_retry_secs: i32,
) -> i64 {
    let attempts = i64::from(retries) + 1;
    multiplier
        * (attempts * i64::from(per_attempt_ms)
            + i64::from(retries) * i64::from(wait_before_retry_secs) * 1_000)
}

/// Render a millisecond duration the way the person reading the error thinks
/// about it. `1210000` is arithmetic; `20m10s` is a schedule.
///
/// These strings go straight into a save-time validation message that the UI
/// shows verbatim, so the unit has to be legible without mental division.
fn human_ms(ms: i64) -> String {
    let total_secs = ms / 1_000;
    let mins = total_secs / 60;
    let secs = total_secs % 60;
    match (mins, secs) {
        (0, s) => format!("{s}s"),
        (m, 0) => format!("{m}m"),
        (m, s) => format!("{m}m{s}s"),
    }
}

/// Bounds a protocol check's `timeout_ms` and its full retry sequence.
///
/// The browser path has had this since `journey_budget_ms` was introduced; the
/// protocol path never did. Both agents ask for a 300s lease while
/// `timeout_ms` was unbounded and `retries` goes to 3, so a check needing more
/// than the lease was accepted, and then on every single run the reaper
/// terminated the job mid-flight and the probe's real result was thrown away as
/// a stale ack — a passing check reporting an error forever.
///
/// `timeout_ms` is read from the raw config rather than a typed struct because
/// every protocol config declares the same field with the same serde default, so
/// an absent field legitimately means the default.
fn validate_net_retry_budget(
    config: &serde_json::Value,
    retries: i32,
    wait_before_retry_secs: i32,
) -> Result<(), String> {
    let timeout_ms = config
        .get("timeout_ms")
        .and_then(|v| v.as_u64())
        .and_then(|v| u32::try_from(v).ok())
        .unwrap_or_else(default_timeout_ms);

    if !(MIN_NET_TIMEOUT_MS..=MAX_NET_TIMEOUT_MS).contains(&timeout_ms) {
        return Err(format!(
            "config.timeout_ms: must be {MIN_NET_TIMEOUT_MS}..={MAX_NET_TIMEOUT_MS}, got {timeout_ms}"
        ));
    }

    let worst_case_ms = worst_case_run_ms(timeout_ms, 1, retries, wait_before_retry_secs);
    if worst_case_ms > JOB_LEASE_SECS * 1_000 {
        // Same shape as the browser message above: remedy first, arithmetic
        // behind it, durations rather than raw milliseconds.
        let attempts = retries + 1;
        let retries_fix = if retries > 0 {
            format!("lower retries below {retries}, ")
        } else {
            String::new()
        };
        return Err(format!(
            "config: this check needs up to {} per run, which is over the {} job lease. To fix it, \
             {retries_fix}or lower config.timeout_ms (currently {}). Detail: {} attempt(s) x {} \
             each, plus {}s between retries. A check that outlives its lease has its job \
             terminated mid-run and its real result rejected as a stale ack.",
            human_ms(worst_case_ms),
            human_ms(JOB_LEASE_SECS * 1_000),
            human_ms(i64::from(timeout_ms)),
            attempts,
            human_ms(i64::from(timeout_ms)),
            wait_before_retry_secs,
        ));
    }
    Ok(())
}

/// The complete v2 action vocabulary — exactly Playwright's recorder action
/// model, minus what a monitor cannot use.
///
/// Deliberately excludes `hover`, `scroll`, `wait`/`waitFor` and `screenshot`:
/// upstream `ActionName` has no counterpart for any of them, so the recorder
/// never emitted one and the extension player could never replay one. They
/// entered journeys only through the manual step editor, and using one aborted
/// replay entirely. `type` and `keydown` are dropped as redundant aliases of
/// `fill` and `press`.
///
/// Because this set is drawn from Playwright's own model, every stored v2 step
/// is executable by both the probe and the extension player by construction.
const V2_STEP_ACTIONS: &[&str] = &[
    "navigate", "click", "fill", "press", "select", "check", "uncheck", "upload", "assert",
];

/// v2 actions that operate on an element and therefore need a locator.
const V2_ELEMENT_ACTIONS: &[&str] = &[
    "click", "fill", "press", "select", "check", "uncheck", "upload", "assert",
];

/// The closed set of assertion kinds (spec P5.1).
///
/// Closed on purpose: the probe fails an unknown kind rather than passing it, so
/// a typo caught here is an error at save time instead of every run failing —
/// the same reasoning as the HTTP assertion field/operator sets above.
const V2_ASSERTION_KINDS: &[&str] = &[
    "element_visible",
    "element_not_visible",
    "element_text",
    "url_matches",
    "page_title",
    "element_attribute",
];

/// Kinds that ask "is it there?" and so have nothing to compare against.
const V2_VISIBILITY_ASSERTION_KINDS: &[&str] = &["element_visible", "element_not_visible"];

/// Kinds that describe the page rather than an element, and so need no locator.
const V2_PAGE_LEVEL_ASSERTION_KINDS: &[&str] = &["url_matches", "page_title"];

const MAX_STEPS: usize = 50;
/// A step carries up to 5 locator candidates and 5 settle patterns. A maximal
/// 50-step journey lands near 60KB; the cap is set well clear of that. The
/// `config` column is already JSON (jsonb on PostgreSQL), and steps travel over
/// the HTTP resolve/ack bodies rather than the Lambda invoke payload, so neither
/// storage nor transport needs changing.
const MAX_STEPS_JSON_BYTES: usize = 262_144;
/// What a stored bundle may hold.
///
/// There are two caps, and only this one is the server's. The RECORDER stops at
/// five (`locatorBundle.ts`), which bounds probe cost per run without asking the
/// author — the fifth way to find an element adds almost nothing once the first
/// four have failed. The extra three here leave room for locators the author
/// wrote and combinations they built: past five they are choosing the probe cost
/// explicitly, and that difference is what justifies two numbers. Enforcing the
/// recorder's five here would refuse the author's own work.
const MAX_STORED_LOCATOR_CANDIDATES: usize = 8;

/// Where a candidate came from. Provenance, not stability — how long a locator
/// keeps working is derived from its `value`, never stored (P2.2.3).
const LOCATOR_ORIGINS: &[&str] = &["recorded", "authored", "composite"];

/// How one part of a combined locator attaches to the part before it.
///
/// Named after Playwright's own operations rather than CSS's, because the
/// stored value IS a Playwright selector string and anyone debugging a monitor
/// reads Playwright's documentation: `and` is `.and(b)`, `has` and `has_not`
/// are `.filter({ has })` / `.filter({ hasNot })`, `descendant` is `.locator(b)`.
///
/// All four validate; the editor offers two. That is the whole reason the
/// relation is stored — adding `has_not` or `descendant` later is a UI change,
/// not a schema migration. `.or()` is deliberately absent: it unions in DOM
/// order and so destroys the preference the ordered bundle exists to express.
const COMPOSITE_RELATIONS: &[&str] = &["and", "has", "has_not", "descendant"];

/// The recorder's test-id attribute when a monitor does not set one.
///
/// `data-test` rather than Playwright's `data-testid`: OpenObserve's own
/// frontend marks interactive elements with it, and self-monitoring is this
/// feature's acceptance test (X-1's o2.introspect monitors).
pub const DEFAULT_TEST_ID_ATTR: &str = "data-test";

/// Longest attribute name accepted. A DOM attribute name this long is not a
/// configuration, it is a paste accident.
const MAX_TEST_ID_ATTR_LEN: usize = 64;
const MAX_SETTLE_RESPONSES: usize = 5;
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

/// A save-time warning: the monitor is accepted, but something about it is worth
/// telling the author.
///
/// Separate from the `Err(String)` channel on purpose. A zero-assertion journey
/// is legitimate — a monitor that only navigates still proves the site answers —
/// so refusing it would be wrong; but it can also click its way through a broken
/// application and pass, which is worth saying out loud (P5.2.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyntheticWarningCode {
    NoAssertions,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyntheticWarning {
    pub code: SyntheticWarningCode,
    /// Machine-readable code plus prose, so a UI can key off one and show the
    /// other without re-deriving the wording.
    pub message: String,
}

impl Synthetic {
    /// Non-blocking problems worth surfacing when a monitor is saved.
    ///
    /// Deliberately not part of `validate`: everything here is accepted. A caller
    /// that ignores this returns exactly the behaviour it had before.
    pub fn warnings(&self) -> Vec<SyntheticWarning> {
        let mut warnings = Vec::new();

        if self.monitor_type == SyntheticType::Browser {
            let has_assertion = self
                .config
                .get("steps")
                .and_then(|s| s.as_array())
                .is_some_and(|steps| {
                    steps
                        .iter()
                        .any(|step| step.get("action").and_then(|a| a.as_str()) == Some("assert"))
                });
            if !has_assertion {
                warnings.push(SyntheticWarning {
                    code: SyntheticWarningCode::NoAssertions,
                    message: "This journey contains no assertions, so it verifies that the steps \
                              can be performed but not that the application is working. A journey \
                              with no assertion can click its way through a broken page and still \
                              pass. Add at least one assertion — for example that a \
                              post-login element is visible."
                        .to_string(),
                });
            }
        }

        warnings
    }

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
        let type_check = match self.monitor_type {
            SyntheticType::Browser => {
                let cfg: BrowserConfig = serde_json::from_value(self.config.clone())
                    .map_err(|e| format!("config: not a valid browser config: {e}"))?;
                validate_browser_config(
                    &cfg,
                    &self.frequency,
                    allowed_browsers,
                    allowed_devices,
                    self.retries,
                    self.wait_before_retry_secs,
                )
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
        };
        // Type errors first: "not a valid tcp config" is more fundamental than
        // anything derived from its fields, and a config that fails to parse has
        // no meaningful timeout to report on.
        type_check?;

        // Every protocol check gets the same retry-budget-vs-lease bound the
        // browser path applies inside `validate_browser_config`. Done here, once,
        // rather than in each arm: the arms are per-type and this rule is not, and
        // adding a check type should not be able to opt out of it silently.
        if self.monitor_type != SyntheticType::Browser {
            validate_net_retry_budget(&self.config, self.retries, self.wait_before_retry_secs)?;
        }
        Ok(())
    }
}

/// Validates version-2 steps: typed deserialization plus the structural rules
/// that deserialization cannot express.
///
/// Deserialization does most of the work. Every v2 struct is
/// `deny_unknown_fields`, so a step carrying `code` — or anything else the
/// schema does not know — is refused here. That is what closes the
/// arbitrary-JavaScript path at the schema level rather than relying on the
/// runner to ignore it.
/// Validate one typed assertion (spec P5.1.1–P5.1.3).
///
/// Follows the shape the HTTP assertions already use: a closed kind set, the
/// values each kind actually needs, and errors naming both the step index and
/// the known set — so a typo cannot silently pass forever.
fn validate_v2_assertion(i: usize, assertion: &StepAssertion) -> Result<(), String> {
    if !V2_ASSERTION_KINDS.contains(&assertion.kind.as_str()) {
        return Err(format!(
            "config.steps[{i}].assertion.kind: unknown kind '{}' (known: {})",
            assertion.kind,
            V2_ASSERTION_KINDS.join(", ")
        ));
    }

    // The visibility kinds ask "is it there?" — there is nothing to compare.
    if !V2_VISIBILITY_ASSERTION_KINDS.contains(&assertion.kind.as_str()) {
        let expected = assertion.expected.as_deref().unwrap_or("");
        if expected.is_empty() {
            return Err(format!(
                "config.steps[{i}].assertion: kind '{}' requires a non-empty 'expected'",
                assertion.kind
            ));
        }
    }

    if assertion.kind == "element_attribute"
        && assertion
            .attribute
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return Err(format!(
            "config.steps[{i}].assertion: kind 'element_attribute' requires an 'attribute' name"
        ));
    }

    Ok(())
}

/// Provenance and composition rules for one candidate in a bundle.
///
/// Structure only. Whether a combined locator actually matches anything cannot
/// be decided here — it depends on the page — and the editor has no live DOM
/// either, so it is unverified until it runs (R2b.c). What IS decidable is that
/// a composite says what it was built from, that a non-composite does not
/// claim to be one, and that the parts form a base plus a chain of joins.
fn validate_locator_candidate(
    i: usize,
    c: usize,
    candidate: &LocatorCandidate,
) -> Result<(), String> {
    let origin = candidate.origin.as_deref().unwrap_or("recorded");
    if !LOCATOR_ORIGINS.contains(&origin) {
        return Err(format!(
            "config.steps[{i}].locator.candidates[{c}].origin: unknown origin '{origin}' \
             (valid: {})",
            LOCATOR_ORIGINS.join(", ")
        ));
    }

    let Some(parts) = candidate.from.as_ref() else {
        if origin == "composite" {
            return Err(format!(
                "config.steps[{i}].locator.candidates[{c}]: origin 'composite' requires 'from'"
            ));
        }
        return Ok(());
    };

    // A `from` on anything else is a claim the value does not back up: nothing
    // built it, so nothing can rebuild or explain it.
    if origin != "composite" {
        return Err(format!(
            "config.steps[{i}].locator.candidates[{c}]: 'from' is only valid on a \
             'composite' candidate, not on '{origin}'"
        ));
    }
    // One part is not a combination, it is the part itself.
    if parts.len() < 2 {
        return Err(format!(
            "config.steps[{i}].locator.candidates[{c}].from: a composite needs at least 2 \
             parts, got {}",
            parts.len()
        ));
    }

    for (p, part) in parts.iter().enumerate() {
        if part.value.trim().is_empty() {
            return Err(format!(
                "config.steps[{i}].locator.candidates[{c}].from[{p}]: 'value' must not be empty"
            ));
        }
        match (p, part.relation.as_deref()) {
            // The base is what the later parts attach to. A relation on it would
            // have nothing to relate to.
            (0, Some(r)) => {
                return Err(format!(
                    "config.steps[{i}].locator.candidates[{c}].from[0]: the base part must \
                     carry no relation, got '{r}'"
                ));
            }
            (0, None) => {}
            (_, None) => {
                return Err(format!(
                    "config.steps[{i}].locator.candidates[{c}].from[{p}]: every part after the \
                     base must carry a relation (valid: {})",
                    COMPOSITE_RELATIONS.join(", ")
                ));
            }
            (_, Some(r)) if !COMPOSITE_RELATIONS.contains(&r) => {
                return Err(format!(
                    "config.steps[{i}].locator.candidates[{c}].from[{p}].relation: unknown \
                     relation '{r}' (valid: {})",
                    COMPOSITE_RELATIONS.join(", ")
                ));
            }
            (_, Some(_)) => {}
        }
    }

    Ok(())
}

/// Validate every step in a journey. There is one step format, so this is the
/// only step-validation path — the untyped version-1 branch beside it was
/// deleted with version 1 itself (Phase 2c).
fn validate_v2_steps(steps: &[serde_json::Value]) -> Result<(), String> {
    let mut seen_ids = std::collections::HashSet::new();

    for (i, raw) in steps.iter().enumerate() {
        let step: BrowserStepV2 =
            serde_json::from_value(raw.clone()).map_err(|e| format!("config.steps[{i}]: {e}"))?;

        if step.id.is_empty() {
            return Err(format!("config.steps[{i}]: 'id' must not be empty"));
        }
        if !seen_ids.insert(step.id.clone()) {
            return Err(format!(
                "config.steps[{i}]: duplicate step id '{}'",
                step.id
            ));
        }

        if !V2_STEP_ACTIONS.contains(&step.action.as_str()) {
            return Err(format!(
                "config.steps[{i}]: action '{}' is not valid (valid: {}). hover, scroll, wait \
                 and screenshot have no equivalent in the recorder's action model and cannot be \
                 replayed; type and keydown are aliases of fill and press.",
                step.action,
                V2_STEP_ACTIONS.join(", ")
            ));
        }

        // The probe opens about:blank and never auto-navigates.
        if i == 0 && step.action != "navigate" {
            return Err(format!(
                "config.steps[0]: first step must be 'navigate', got '{}'",
                step.action
            ));
        }

        if step.action == "navigate" {
            let url = step
                .url
                .as_deref()
                .ok_or_else(|| format!("config.steps[{i}]: navigate step missing 'url'"))?;
            validate_http_url(&format!("config.steps[{i}].url"), url)?;
        }

        // P5.1.4 — an assertion is what an `assert` step IS, and is meaningless
        // on any other action. Allowing it elsewhere would create a second,
        // invisible place for a journey to state an expectation.
        if step.action == "assert" {
            let assertion = step.assertion.as_ref().ok_or_else(|| {
                format!(
                    "config.steps[{i}]: 'assert' step requires an 'assertion' (kinds: {})",
                    V2_ASSERTION_KINDS.join(", ")
                )
            })?;
            validate_v2_assertion(i, assertion)?;
        } else if step.assertion.is_some() {
            return Err(format!(
                "config.steps[{i}]: 'assertion' is only valid on an 'assert' step, not on '{}'",
                step.action
            ));
        }

        // A page-level assertion is about the address bar or the document title,
        // so requiring an element would make it depend on something unrelated
        // still being on screen.
        let needs_locator = V2_ELEMENT_ACTIONS.contains(&step.action.as_str())
            && !step
                .assertion
                .as_ref()
                .is_some_and(|a| V2_PAGE_LEVEL_ASSERTION_KINDS.contains(&a.kind.as_str()));

        if needs_locator {
            let locator = step.locator.as_ref().ok_or_else(|| {
                format!(
                    "config.steps[{i}]: '{}' step requires a 'locator'",
                    step.action
                )
            })?;
            if locator.candidates.is_empty() {
                return Err(format!(
                    "config.steps[{i}].locator: needs at least one candidate"
                ));
            }
            if locator.candidates.len() > MAX_STORED_LOCATOR_CANDIDATES {
                return Err(format!(
                    "config.steps[{i}].locator.candidates: too many ({} > \
                     {MAX_STORED_LOCATOR_CANDIDATES})",
                    locator.candidates.len()
                ));
            }
            for (c, candidate) in locator.candidates.iter().enumerate() {
                validate_locator_candidate(i, c, candidate)?;
            }
        }

        if (step.action == "fill" || step.action == "select") && step.value.is_none() {
            return Err(format!(
                "config.steps[{i}]: '{}' step requires a 'value'",
                step.action
            ));
        }

        if let Some(settle) = &step.settle {
            if settle.responses.len() > MAX_SETTLE_RESPONSES {
                return Err(format!(
                    "config.steps[{i}].settle.responses: too many ({} > {MAX_SETTLE_RESPONSES})",
                    settle.responses.len()
                ));
            }
            if let Some(budget) = settle.budget_ms
                && !(100..=60_000).contains(&budget)
            {
                return Err(format!(
                    "config.steps[{i}].settle.budget_ms: must be 100..=60000, got {budget}"
                ));
            }
        }

        if let Some(timeout) = step.timeout_ms
            && !(100..=60_000).contains(&timeout)
        {
            return Err(format!(
                "config.steps[{i}].timeout_ms: must be 100..=60000, got {timeout}"
            ));
        }
    }

    Ok(())
}

fn validate_browser_config(
    cfg: &BrowserConfig,
    frequency: &SyntheticFrequency,
    allowed_browsers: &[String],
    allowed_devices: &[String],
    retries: i32,
    wait_before_retry_secs: i32,
) -> Result<(), String> {
    // ── journey budget vs. job lease ───────────────────────────────────────
    // A browser job holds a lease while it runs (o2-enterprise dispatcher,
    // LEASE_SECS). If a run outlives its lease the reaper requeues it and the
    // journey EXECUTES AGAIN — duplicate result records, multiplied browser
    // cost, and false alerts. Per-step timeouts alone cannot bound this, so the
    // whole retry sequence must be checked against the lease up front.
    let budget_ms = cfg.journey_budget_ms.unwrap_or(DEFAULT_JOURNEY_BUDGET_MS);
    if !(MIN_JOURNEY_BUDGET_MS..=MAX_JOURNEY_BUDGET_MS).contains(&budget_ms) {
        return Err(format!(
            "config.journey_budget_ms: must be {MIN_JOURNEY_BUDGET_MS}..={MAX_JOURNEY_BUDGET_MS}, got {budget_ms}"
        ));
    }
    // Multiplied by the device count, because the probe runs `browser_devices`
    // SEQUENTIALLY INSIDE the leased job (`browser-probe/src/index.ts:124`) — the
    // lease covers the whole job, not one device.
    //
    // Without this the check was per-device while the work was per-job, so a
    // perfectly ordinary "desktop + mobile" config computed 605ms of budget,
    // passed validation, and then blew its 900s lease on EVERY run: the reaper
    // requeued mid-journey, the journey executed again, and that produced
    // duplicate result records, doubled browser cost and alerts caused by the
    // duplicate. Which is verbatim what the LEASE_SECS comment in
    // `dispatcher/mod.rs` was written to prevent.
    let devices = i64::try_from(cfg.browser_devices.len().max(1)).unwrap_or(1);
    let worst_case_ms = worst_case_run_ms(budget_ms, devices, retries, wait_before_retry_secs);
    if worst_case_ms > JOB_LEASE_SECS * 1_000 {
        // Remedy FIRST, in terms the form actually offers. The previous wording
        // led with "Lower journey_budget_ms" — a field the UI neither renders
        // nor sends — so the one lever named first was the one the reader could
        // not reach, and the arithmetic came before the instruction. The numbers
        // are unchanged, just moved behind the fix and rendered as durations.
        let attempts = retries + 1;
        let combos_fix = if devices > 1 {
            format!("drop a combo from config.browser_devices (currently {devices}), ")
        } else {
            String::new()
        };
        let retries_fix = if retries > 0 {
            format!("lower retries below {retries}, ")
        } else {
            String::new()
        };
        return Err(format!(
            "config: this check needs up to {} per run, which is over the {} job lease. To fix it, \
             {combos_fix}{retries_fix}or shorten the run with config.journey_budget_ms (currently \
             {}). Detail: {devices} browser/device combo(s) x {attempts} attempt(s) x {} each, \
             plus {}s between retries. A run that outlives its lease is requeued and executed a \
             second time.",
            human_ms(worst_case_ms),
            human_ms(JOB_LEASE_SECS * 1_000),
            human_ms(i64::from(budget_ms)),
            human_ms(i64::from(budget_ms)),
            wait_before_retry_secs,
        ));
    }

    // ── recorder test-id attribute ─────────────────────────────────────────
    // Validated rather than trusted because it is interpolated into a selector
    // (`[<attr>="value"]`). A name with a quote or bracket in it would produce a
    // selector that silently matches nothing, which is the failure mode this
    // whole area exists to remove.
    if let Some(attr) = &cfg.test_id_attr {
        let trimmed = attr.trim();
        if trimmed.is_empty() {
            return Err(
                "config.test_id_attr: must not be blank — omit it to use the default".to_string(),
            );
        }
        if trimmed.len() > MAX_TEST_ID_ATTR_LEN {
            return Err(format!(
                "config.test_id_attr: too long ({} > {MAX_TEST_ID_ATTR_LEN})",
                trimmed.len()
            ));
        }
        if !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(format!(
                "config.test_id_attr: '{trimmed}' is not a valid attribute name \
                 (letters, digits, '-' and '_' only)"
            ));
        }
    }

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

    validate_v2_steps(&cfg.steps)?;
    validate_browser_devices_and_schedule(cfg, frequency, allowed_browsers, allowed_devices)
}

/// Everything about a browser config that is not the steps themselves.
fn validate_browser_devices_and_schedule(
    cfg: &BrowserConfig,
    frequency: &SyntheticFrequency,
    allowed_browsers: &[String],
    allowed_devices: &[String],
) -> Result<(), String> {
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
                    {
                        "id": "s2",
                        "action": "click",
                        "name": "Sign in",
                        "locator": {
                            "candidates": [
                                { "kind": "css", "value": "#login" }
                            ]
                        }
                    }
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

    fn valid_tcp_synthetic() -> Synthetic {
        Synthetic {
            name: "db port".to_string(),
            monitor_type: SyntheticType::Tcp,
            target: "db.example.com".to_string(),
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
            config: serde_json::json!({ "port": 5432, "timeout_ms": 10000 }),
            ..Default::default()
        }
    }

    #[test]
    fn net_retry_sequence_must_fit_the_job_lease() {
        let (locs, brs, devs) = allowed();
        // The lease covers the whole retry sequence because retries run inside
        // the leased job. 4 x 300s alone is 1200s, past the 900s lease.
        let mut s = valid_tcp_synthetic();
        s.config = serde_json::json!({ "port": 5432, "timeout_ms": 300_000 });
        s.retries = 3;
        s.wait_before_retry_secs = 0;
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("job lease"), "{err}");

        // The gaps count too: 3 x 250s = 750s of attempts is fine on its own,
        // but not with 300s of waiting between them.
        let mut s = valid_tcp_synthetic();
        s.config = serde_json::json!({ "port": 5432, "timeout_ms": 250_000 });
        s.retries = 2;
        s.wait_before_retry_secs = 300;
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("job lease"), "{err}");
    }

    #[test]
    fn net_timeout_is_bounded_at_all() {
        let (locs, brs, devs) = allowed();
        // Was previously unbounded: every protocol config defaults timeout_ms to
        // 10s, but nothing rejected an hour, so the worst case had no ceiling to
        // check the lease against.
        let mut s = valid_tcp_synthetic();
        s.config = serde_json::json!({ "port": 5432, "timeout_ms": 3_600_000 });
        s.retries = 0;
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.starts_with("config.timeout_ms:"), "{err}");
    }

    #[test]
    fn net_defaults_and_ordinary_configs_still_validate() {
        let (locs, brs, devs) = allowed();
        // A config with no timeout_ms at all must use the serde default rather
        // than 0, which would otherwise trip the new minimum.
        let mut s = valid_tcp_synthetic();
        s.config = serde_json::json!({ "port": 5432 });
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());

        // The worst realistic config: max retries and a 60s timeout is 240s of
        // attempts plus 90s of gaps — comfortably inside the lease. This must
        // keep passing, or the bound is too tight to be shipped.
        let mut s = valid_tcp_synthetic();
        s.config = serde_json::json!({ "port": 5432, "timeout_ms": 60_000 });
        s.retries = 3;
        s.wait_before_retry_secs = 30;
        assert!(
            s.validate(&locs, &brs, &devs, true).is_ok(),
            "{:?}",
            s.validate(&locs, &brs, &devs, true)
        );
    }

    #[test]
    fn worst_case_counts_attempts_gaps_and_the_multiplier() {
        // retries=0 is one attempt and no gaps.
        assert_eq!(worst_case_run_ms(10_000, 1, 0, 30), 10_000);
        // retries=2 is three attempts and two gaps.
        assert_eq!(worst_case_run_ms(10_000, 1, 2, 30), 30_000 + 60_000);
        // The multiplier applies to the whole sequence, not one attempt — the
        // probe repeats the entire retry sequence per device inside one lease.
        assert_eq!(worst_case_run_ms(10_000, 2, 2, 30), 2 * (30_000 + 60_000));
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

    // ── Version-2 steps (spec Phase 2, P2.1/P2.2) ────────────────────────────
    // The typed, server-validated step replaced an untyped blob. The envelope is
    // defined ONCE with its complete field set, and later phases populate blocks
    // that ship optional from day one (settle, assertion, optional/always_run).
    // Versioning it per phase would break deployment skew: the step rejects
    // unknown fields, so an additive field from a newer recorder would be
    // refused by an older server.

    fn v2_synthetic(steps: serde_json::Value) -> Synthetic {
        let mut s = valid_browser_synthetic();
        s.config["steps"] = steps;
        s
    }

    fn v2_click_step() -> serde_json::Value {
        serde_json::json!({
            "id": "s2",
            "action": "click",
            "name": "Sign In",
            "locator": {
                "candidates": [
                    { "kind": "test_attribute", "value": "[data-test=\"login-sign-in\"]" },
                    { "kind": "role", "value": "role=button[name=\"Sign In\"]" }
                ]
            }
        })
    }

    fn v2_nav_step() -> serde_json::Value {
        serde_json::json!({
            "id": "s1",
            "action": "navigate",
            "name": "Open",
            "url": "https://example.com"
        })
    }

    #[test]
    fn test_v2_minimal_journey_accepted() {
        let (locs, brs, devs) = allowed();
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), v2_click_step()]));
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    // ── Recorder test-id attribute ───────────────────────────────────────────
    // The attribute is a property of the application under test, not of O2, and
    // getting it wrong is SILENT: upstream's generator falls back to a hardcoded
    // list, so an app outside it produces no test_attribute candidates at all.

    #[test]
    fn test_test_id_attr_absent_is_valid() {
        let (locs, brs, devs) = allowed();
        let s = valid_browser_synthetic();
        assert!(s.config.get("test_id_attr").is_none());
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    #[test]
    fn test_test_id_attr_accepts_real_attribute_names() {
        let (locs, brs, devs) = allowed();
        for attr in [
            "data-test",
            "data-testid",
            "data-qa",
            "data-cy",
            "data_e2e",
            "id",
        ] {
            let mut s = valid_browser_synthetic();
            s.config["test_id_attr"] = serde_json::json!(attr);
            assert!(
                s.validate(&locs, &brs, &devs, true).is_ok(),
                "{attr} should be accepted: {:?}",
                s.validate(&locs, &brs, &devs, true)
            );
        }
    }

    #[test]
    fn test_test_id_attr_rejects_blank() {
        // Blank would silently mean "everything" once interpolated into
        // `[<attr>="value"]`. Omitting the field is how you ask for the default.
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.config["test_id_attr"] = serde_json::json!("   ");
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("test_id_attr"), "{err}");
    }

    #[test]
    fn test_test_id_attr_rejects_selector_injection() {
        // The value is interpolated into a selector, so a quote or bracket would
        // produce one that silently matches nothing.
        let (locs, brs, devs) = allowed();
        for bad in ["data-test=\"x\"", "data test", "data]test", "a*b"] {
            let mut s = valid_browser_synthetic();
            s.config["test_id_attr"] = serde_json::json!(bad);
            assert!(
                s.validate(&locs, &brs, &devs, true).is_err(),
                "{bad} should be rejected"
            );
        }
    }

    #[test]
    fn test_test_id_attr_rejects_absurd_length() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.config["test_id_attr"] = serde_json::json!("d".repeat(MAX_TEST_ID_ATTR_LEN + 1));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("too long"), "{err}");
    }

    #[test]
    fn test_a_stray_steps_version_is_ignored_not_honoured() {
        // Deployment skew, in the direction the rollout actually goes. `oo` Rust
        // ships before the web build that stops sending the key, so for one
        // release an older web app posts `steps_version: 2` at a server that has
        // never heard of it. BrowserConfig does not deny unknown fields, so the
        // key is dropped — and, crucially, it selects nothing: the same rules
        // apply either way.
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.config["steps_version"] = serde_json::json!(2);
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());

        let cfg: BrowserConfig = serde_json::from_value(s.config.clone()).unwrap();
        assert_eq!(cfg.steps.len(), 2);
    }

    #[test]
    fn test_step_rules_apply_with_no_version_marker_at_all() {
        // The rules used to be reached only when `steps_version >= 2`. Absent the
        // fork, a journey in the retired version-1 shape — a bare `selector` and
        // no locator bundle — has to be refused rather than routed elsewhere.
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.config["steps"] = serde_json::json!([
            { "id": "s1", "action": "navigate", "url": "https://example.com" },
            { "id": "s2", "action": "click", "name": "Sign in", "selector": "#login" }
        ]);
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("unknown field `selector`"), "{err}");
    }

    #[test]
    fn test_one_size_cap_applies_to_every_journey() {
        // There were two, forked on the version. The surviving one is the larger
        // of the pair, because a step carrying a locator bundle and a settle
        // block is 3-4x the size of the untyped step it replaced.
        assert_eq!(MAX_STEPS_JSON_BYTES, 262_144);
    }

    #[test]
    fn test_v2_rejects_unknown_fields() {
        // This is the mechanism that closes the arbitrary-code hole: anything
        // the schema does not know about is refused, so `code` cannot ride along
        // under a different name either.
        let (locs, brs, devs) = allowed();
        let mut step = v2_click_step();
        step["surprise"] = serde_json::json!("hello");
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("surprise"), "{err}");
    }

    #[test]
    fn test_v2_rejects_code_field() {
        let (locs, brs, devs) = allowed();
        let mut step = v2_click_step();
        step["code"] = serde_json::json!("await page.evaluate(() => fetch('http://evil'))");
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("code"), "{err}");
    }

    #[test]
    fn test_v2_accepts_exactly_the_nine_action_vocabulary() {
        let (locs, brs, devs) = allowed();
        for action in [
            "click", "fill", "press", "select", "check", "uncheck", "upload",
        ] {
            let mut step = v2_click_step();
            step["action"] = serde_json::json!(action);
            if action == "fill" || action == "select" {
                step["value"] = serde_json::json!("x");
            }
            let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
            assert!(
                s.validate(&locs, &brs, &devs, true).is_ok(),
                "{action} should be accepted: {:?}",
                s.validate(&locs, &brs, &devs, true)
            );
        }
    }

    #[test]
    fn test_v2_rejects_retired_actions() {
        // Upstream Playwright's recorder action model has no counterpart for any
        // of these, so the recorder never emitted one and the player could never
        // replay one. `type`/`keydown` are redundant aliases of fill/press.
        let (locs, brs, devs) = allowed();
        for action in [
            "hover",
            "scroll",
            "wait",
            "waitFor",
            "screenshot",
            "type",
            "keydown",
        ] {
            let mut step = v2_click_step();
            step["action"] = serde_json::json!(action);
            let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
            let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
            assert!(
                err.contains(action) || err.contains("action"),
                "{action} should be rejected in v2, got: {err}"
            );
        }
    }

    // ── The cross-repo contract (Phases 2b + 2c) ─────────────────────────
    //
    // Every other test in this module builds its own fixture, so all of them
    // could pass while the payload the WEB app actually sends is refused. These
    // are the bytes `buildCreateBrowserTestPayload` produces for a journey that
    // exercises the whole surface at once: a recorded bundle, a locator the
    // author wrote, a combined one with its parts, an author-owned order, a
    // settle block and a typed assertion.
    //
    // Its twin is `web/src/utils/synthetics/payloadContract.spec.ts`, which
    // asserts the web side emits exactly this. Neither repo can import from the
    // other, so two copies of the same bytes is the only mechanism there is —
    // if they drift, one of them fails.
    const WEB_PAYLOAD_STEPS: &str = r##"[
            {
                "id": "s1",
                "action": "navigate",
                "name": "Open app",
                "url": "https://app.test/login"
            },
            {
                "id": "s2",
                "action": "fill",
                "name": "Username",
                "value": "omkar",
                "locator": {
                    "candidates": [
                        {
                            "kind": "test_attribute",
                            "value": "[data-test=\"login-user-id-field\"]",
                            "origin": "recorded"
                        }
                    ]
                }
            },
            {
                "id": "s3",
                "action": "click",
                "name": "Switch org",
                "locator": {
                    "candidates": [
                        {
                            "kind": "test_attribute",
                            "value": "[data-test=\"org-row\"] >> internal:and=\"div >> internal:has-text=/^acme_prod$/\"",
                            "origin": "composite",
                            "from": [
                                {
                                    "value": "[data-test=\"org-row\"]"
                                },
                                {
                                    "value": "div >> internal:has-text=/^acme_prod$/",
                                    "relation": "and"
                                }
                            ]
                        },
                        {
                            "kind": "css",
                            "value": "#my-own",
                            "origin": "authored"
                        },
                        {
                            "kind": "test_attribute",
                            "value": "[data-test=\"org-row\"] >> nth=1",
                            "origin": "recorded"
                        }
                    ],
                    "author_ordered": true
                },
                "settle": {
                    "navigation": {
                        "url_pattern": "**/web/**"
                    },
                    "responses": [
                        {
                            "url_pattern": "**/auth/login",
                            "method": "POST",
                            "required": false
                        }
                    ]
                }
            },
            {
                "id": "s4",
                "action": "assert",
                "name": "Profile visible",
                "locator": {
                    "candidates": [
                        {
                            "kind": "test_attribute",
                            "value": "[data-test=\"header-my-account-profile-icon\"]"
                        }
                    ]
                },
                "assertion": {
                    "kind": "element_visible"
                }
            }
        ]"##;

    #[test]
    fn test_the_payload_the_web_app_sends_validates() {
        let (locs, brs, devs) = allowed();
        let steps: serde_json::Value =
            serde_json::from_str(WEB_PAYLOAD_STEPS).expect("the web payload must be valid JSON");
        let s = v2_synthetic(steps);

        let result = s.validate(&locs, &brs, &devs, true);
        assert!(result.is_ok(), "{}", result.unwrap_err());
    }

    #[test]
    fn test_every_field_the_web_sends_is_one_the_step_struct_knows() {
        // `validate` alone would pass on a payload whose `from` was silently
        // dropped. Deserializing is what proves deny_unknown_fields accepts the
        // shape AND that the fields survive — which is the whole point of
        // building the payload key by key rather than by spreading a model.
        let steps: Vec<serde_json::Value> = serde_json::from_str(WEB_PAYLOAD_STEPS).unwrap();
        let combined: BrowserStepV2 = serde_json::from_value(steps[2].clone())
            .expect("the org-switcher step must deserialize");
        let locator = combined.locator.expect("it carries a bundle");

        assert!(locator.author_ordered);
        assert_eq!(locator.candidates.len(), 3);

        let composite = &locator.candidates[0];
        assert_eq!(composite.origin.as_deref(), Some("composite"));
        let from = composite
            .from
            .as_ref()
            .expect("a composite says what built it");
        assert_eq!(from.len(), 2);
        assert!(
            from[0].relation.is_none(),
            "the base part carries no relation"
        );
        assert_eq!(from[1].relation.as_deref(), Some("and"));

        assert_eq!(locator.candidates[1].origin.as_deref(), Some("authored"));

        // The last step's bundle carries NO origin at all — the shape every
        // bundle recorded before Phase 2b has. It has to keep validating while
        // the deploy catches up, which is why `origin` is optional rather than
        // defaulted at the serde layer.
        let legacy: BrowserStepV2 = serde_json::from_value(steps[3].clone()).unwrap();
        assert!(legacy.locator.unwrap().candidates[0].origin.is_none());
    }

    fn v2_assert_step(assertion: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "id": "s3",
            "action": "assert",
            "name": "Profile visible",
            "locator": {
                "candidates": [
                    { "kind": "test_attribute", "value": "[data-test=\"header-my-account-profile-icon\"]" }
                ]
            },
            "assertion": assertion
        })
    }

    // ── Phase 5 — typed assertions (T5-1…T5-4) ──────────────────────────────

    #[test]
    fn test_v2_every_assertion_kind_is_accepted() {
        let (locs, brs, devs) = allowed();
        for kind in V2_ASSERTION_KINDS {
            let mut assertion = serde_json::json!({ "kind": kind });
            if !V2_VISIBILITY_ASSERTION_KINDS.contains(kind) {
                assertion["expected"] = serde_json::json!("something");
            }
            if *kind == "element_attribute" {
                assertion["attribute"] = serde_json::json!("href");
            }
            let s = v2_synthetic(serde_json::json!([
                v2_nav_step(),
                v2_click_step(),
                v2_assert_step(assertion)
            ]));
            assert!(
                s.validate(&locs, &brs, &devs, true).is_ok(),
                "kind '{kind}' must be accepted: {:?}",
                s.validate(&locs, &brs, &devs, true)
            );
        }
    }

    #[test]
    fn test_v2_unknown_assertion_kind_is_rejected_naming_the_known_set() {
        let (locs, brs, devs) = allowed();
        let s = v2_synthetic(serde_json::json!([
            v2_nav_step(),
            v2_assert_step(serde_json::json!({ "kind": "element_vissible" }))
        ]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("element_vissible"), "{err}");
        assert!(
            err.contains("element_visible"),
            "the known set must be listed: {err}"
        );
        assert!(err.contains("steps[1]"), "the index must be named: {err}");
    }

    #[test]
    fn test_v2_expected_is_required_except_for_the_visibility_kinds() {
        let (locs, brs, devs) = allowed();
        for kind in ["element_text", "url_matches", "page_title"] {
            let s = v2_synthetic(serde_json::json!([
                v2_nav_step(),
                v2_assert_step(serde_json::json!({ "kind": kind }))
            ]));
            let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
            assert!(err.contains("expected"), "kind '{kind}': {err}");
        }
        // …and an empty string is not a value.
        let s = v2_synthetic(serde_json::json!([
            v2_nav_step(),
            v2_assert_step(serde_json::json!({ "kind": "element_text", "expected": "" }))
        ]));
        assert!(s.validate(&locs, &brs, &devs, true).is_err());
    }

    #[test]
    fn test_v2_element_attribute_requires_an_attribute_name() {
        let (locs, brs, devs) = allowed();
        let s = v2_synthetic(serde_json::json!([
            v2_nav_step(),
            v2_assert_step(serde_json::json!({ "kind": "element_attribute", "expected": "/web/" }))
        ]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("attribute"), "{err}");
    }

    #[test]
    fn test_v2_assertion_is_required_on_assert_and_forbidden_elsewhere() {
        let (locs, brs, devs) = allowed();

        let mut bare = v2_assert_step(serde_json::json!({ "kind": "element_visible" }));
        bare.as_object_mut().unwrap().remove("assertion");
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), bare]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("requires an 'assertion'"), "{err}");

        let mut click = v2_click_step();
        click["assertion"] = serde_json::json!({ "kind": "element_visible" });
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), click]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("only valid on an 'assert' step"), "{err}");
    }

    #[test]
    fn test_v2_page_level_assertions_need_no_locator() {
        // A statement about the address bar must not depend on some unrelated
        // element still being on screen.
        let (locs, brs, devs) = allowed();
        let step = serde_json::json!({
            "id": "s3",
            "action": "assert",
            "assertion": { "kind": "url_matches", "expected": "**/web/**" }
        });
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), v2_click_step(), step]));
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    #[test]
    fn test_a_zero_assertion_journey_is_accepted_with_a_machine_readable_warning() {
        // P5.2.4 — accepted, not refused: a monitor that only navigates still
        // proves the site answers. The warning is what stops it being mistaken
        // for a monitor that checks something.
        let (locs, brs, devs) = allowed();
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), v2_click_step()]));
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
        let warnings = s.warnings();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, SyntheticWarningCode::NoAssertions);

        let with_assert = v2_synthetic(serde_json::json!([
            v2_nav_step(),
            v2_click_step(),
            v2_assert_step(serde_json::json!({ "kind": "element_visible" }))
        ]));
        assert!(with_assert.warnings().is_empty());
    }

    // ── Phase 3 — settle budget (T3-6's storage side) ───────────────────────

    #[test]
    fn test_v2_settle_budget_is_range_checked() {
        let (locs, brs, devs) = allowed();
        let mut step = v2_click_step();
        step["settle"] = serde_json::json!({ "budget_ms": 30000 });
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step.clone()]));
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());

        step["settle"] = serde_json::json!({ "budget_ms": 90000 });
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("settle.budget_ms"), "{err}");
    }

    #[test]
    fn test_v2_settle_navigation_and_responses_round_trip() {
        let (locs, brs, devs) = allowed();
        let mut step = v2_click_step();
        step["settle"] = serde_json::json!({
            "navigation": { "url_pattern": "**/web/**" },
            "responses": [
                { "url_pattern": "**/auth/login", "method": "POST", "required": false }
            ],
            "observed_duration_ms": 1800,
            "budget_ms": 30000
        });
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    #[test]
    fn test_v2_element_action_requires_a_locator() {
        let (locs, brs, devs) = allowed();
        let mut step = v2_click_step();
        step.as_object_mut().unwrap().remove("locator");
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("locator"), "{err}");
    }

    // ── Provenance and composition (Phase 2b) ────────────────────────────
    //
    // `user_override` is GONE. It was a single exclusive pin whose only way to
    // say "prefer this one" was to turn fallback off entirely; the ordered
    // bundle says the same thing by deleting the others, and can also say
    // "prefer mine, fall back to the recording". Deleting rather than
    // deprecating is safe only because the pin feature never deployed — a
    // stored one would now be an unknown field, and `fetch_due`'s
    // `unwrap_or_default()` would silently empty `browser_devices` on every
    // scheduling pass rather than erroring.

    fn locator_with(candidates: serde_json::Value) -> Synthetic {
        let mut step = v2_click_step();
        step["locator"] = serde_json::json!({ "candidates": candidates });
        v2_synthetic(serde_json::json!([v2_nav_step(), step]))
    }

    fn locator_error(candidates: serde_json::Value) -> String {
        let (locs, brs, devs) = allowed();
        locator_with(candidates)
            .validate(&locs, &brs, &devs, true)
            .unwrap_err()
    }

    fn locator_ok(candidates: serde_json::Value) {
        let (locs, brs, devs) = allowed();
        let r = locator_with(candidates).validate(&locs, &brs, &devs, true);
        assert!(r.is_ok(), "{}", r.unwrap_err());
    }

    #[test]
    fn test_a_stored_user_override_is_now_rejected() {
        let (locs, brs, devs) = allowed();
        let mut step = v2_click_step();
        step["locator"]["user_override"] = serde_json::json!({ "kind": "css", "value": "#pin" });
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        // Loud on purpose: it means stored data exists that we believed did not.
        assert!(err.contains("unknown field `user_override`"), "{err}");
    }

    #[test]
    fn test_an_empty_bundle_is_now_the_only_way_to_miss_a_target() {
        // The rule used to read "at least one candidate OR a user_override".
        let (locs, brs, devs) = allowed();
        let mut step = v2_click_step();
        step["locator"] = serde_json::json!({ "candidates": [] });
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("needs at least one candidate"), "{err}");
    }

    #[test]
    fn test_origin_defaults_to_recorded_and_an_unknown_one_is_rejected() {
        locator_ok(serde_json::json!([{ "kind": "css", "value": "#a" }]));
        locator_ok(serde_json::json!([{ "kind": "css", "value": "#a", "origin": "authored" }]));

        let err = locator_error(
            serde_json::json!([{ "kind": "css", "value": "#a", "origin": "invented" }]),
        );
        assert!(
            err.contains("steps[1].locator.candidates[0].origin"),
            "{err}"
        );
        assert!(err.contains("invented"), "{err}");
    }

    #[test]
    fn test_a_composite_must_say_what_it_was_built_from() {
        let err = locator_error(
            serde_json::json!([{ "kind": "css", "value": "#a", "origin": "composite" }]),
        );
        assert!(err.contains("requires 'from'"), "{err}");

        // One part is not a combination, it is the part itself.
        let err = locator_error(serde_json::json!([{
            "kind": "css", "value": "#a", "origin": "composite",
            "from": [{ "value": "#a" }]
        }]));
        assert!(err.contains("at least 2 parts"), "{err}");
    }

    #[test]
    fn test_from_is_rejected_on_a_candidate_nothing_built() {
        let err = locator_error(serde_json::json!([{
            "kind": "css", "value": "#a", "origin": "recorded",
            "from": [{ "value": "#a" }, { "relation": "and", "value": "#b" }]
        }]));
        assert!(
            err.contains("only valid on a 'composite' candidate"),
            "{err}"
        );
    }

    #[test]
    fn test_the_base_part_carries_no_relation_and_every_later_one_does() {
        let base_has_relation = locator_error(serde_json::json!([{
            "kind": "css", "value": "#a", "origin": "composite",
            "from": [{ "relation": "and", "value": "#a" }, { "relation": "and", "value": "#b" }]
        }]));
        assert!(base_has_relation.contains("from[0]"), "{base_has_relation}");
        assert!(
            base_has_relation.contains("must carry no relation"),
            "{base_has_relation}"
        );

        let join_has_none = locator_error(serde_json::json!([{
            "kind": "css", "value": "#a", "origin": "composite",
            "from": [{ "value": "#a" }, { "value": "#b" }]
        }]));
        assert!(join_has_none.contains("from[1]"), "{join_has_none}");
        assert!(
            join_has_none.contains("must carry a relation"),
            "{join_has_none}"
        );
    }

    #[test]
    fn test_all_four_relations_validate_even_the_two_the_editor_does_not_offer() {
        // E2b.12. This is the whole reason the relation is stored: adding
        // `has_not` or `descendant` to the dialog later is a UI change, not a
        // schema migration.
        for relation in ["and", "has", "has_not", "descendant"] {
            locator_ok(serde_json::json!([{
                "kind": "css", "value": "#a", "origin": "composite",
                "from": [{ "value": "#a" }, { "relation": relation, "value": "#b" }]
            }]));
        }

        let err = locator_error(serde_json::json!([{
            "kind": "css", "value": "#a", "origin": "composite",
            "from": [{ "value": "#a" }, { "relation": "or", "value": "#b" }]
        }]));
        // `.or()` unions in DOM order, destroying the preference the ordered
        // bundle exists to express. Rejected on merit, not deferred.
        assert!(err.contains("from[1].relation"), "{err}");
        assert!(err.contains("'or'"), "{err}");
    }

    #[test]
    fn test_a_three_way_composite_validates() {
        locator_ok(serde_json::json!([{
            "kind": "test_attribute", "value": "#a", "origin": "composite",
            "from": [
                { "value": "[data-test=\"row\"]" },
                { "relation": "and", "value": "[data-org=\"acme\"]" },
                { "relation": "has", "value": "internal:text=\"acme_prod\"" }
            ]
        }]));
    }

    #[test]
    fn test_author_ordered_defaults_false_and_round_trips() {
        let (locs, brs, devs) = allowed();
        let mut step = v2_click_step();
        step["locator"]["author_ordered"] = serde_json::json!(true);
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());

        let bare: StepLocator =
            serde_json::from_value(serde_json::json!({ "candidates": [] })).unwrap();
        assert!(!bare.author_ordered);
    }

    #[test]
    fn test_a_bundle_carrying_none_of_the_new_fields_still_validates() {
        // Deployment skew: `oo` Rust ships before the web and crx builds that
        // start sending provenance, so the old shape has to keep working.
        locator_ok(serde_json::json!([
            { "kind": "test_attribute", "value": "[data-test=\"login-sign-in\"]" },
            { "kind": "role", "value": "role=button[name=\"Sign In\"]" }
        ]));
    }

    #[test]
    fn test_the_stored_cap_leaves_room_for_the_author() {
        // The recorder still stops at 5, in crx. The extra three here are for
        // locators the author wrote and combinations they built — past that they
        // are choosing the probe cost explicitly, and enforcing the recorder's
        // cap on the server would refuse their own work.
        let candidates = |n: usize| -> serde_json::Value {
            (0..n)
                .map(|i| serde_json::json!({ "kind": "css", "value": format!("#c{i}") }))
                .collect::<Vec<_>>()
                .into()
        };
        locator_ok(candidates(MAX_STORED_LOCATOR_CANDIDATES));

        let err = locator_error(candidates(MAX_STORED_LOCATOR_CANDIDATES + 1));
        assert!(err.contains("too many (9 > 8)"), "{err}");
    }

    #[test]
    fn test_v2_caps_settle_response_patterns_at_five() {
        let (locs, brs, devs) = allowed();
        let responses: Vec<_> = (0..6)
            .map(|i| serde_json::json!({ "url_pattern": format!("**/api/{i}") }))
            .collect();
        let mut step = v2_click_step();
        step["settle"] = serde_json::json!({ "responses": responses });
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("responses"), "{err}");
    }

    #[test]
    fn test_v2_accepts_a_full_settle_block() {
        // Defined in Phase 2, populated by Phases 3 and 4. It must validate now
        // so a newer recorder is never refused by an older server (spec V-2).
        let (locs, brs, devs) = allowed();
        let mut step = v2_click_step();
        step["settle"] = serde_json::json!({
            "navigation": { "url_pattern": "**/web/**" },
            "responses": [ { "url_pattern": "**/auth/login", "method": "POST", "required": false } ],
            "observed_duration_ms": 2300
        });
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    #[test]
    fn test_v2_accepts_assertion_and_flow_control_blocks() {
        let (locs, brs, devs) = allowed();
        let step = serde_json::json!({
            "id": "s3",
            "action": "assert",
            "name": "Profile visible",
            "locator": { "candidates": [ { "kind": "test_attribute", "value": "[data-test=\"p\"]" } ] },
            "assertion": { "kind": "element_visible" },
            "optional": true,
            "always_run": false
        });
        let s = v2_synthetic(serde_json::json!([v2_nav_step(), step]));
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    #[test]
    fn test_v2_first_step_must_be_navigate() {
        let (locs, brs, devs) = allowed();
        let s = v2_synthetic(serde_json::json!([v2_click_step()]));
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("navigate"), "{err}");
    }

    #[test]
    fn test_the_steps_size_cap_accommodates_a_locator_bundle() {
        // A step carrying up to 5 candidates and 5 settle patterns is 3-4x the
        // untyped step it replaced, which is why the cap sits at 262_144 rather
        // than the 100_000 that bounded the retired shape.
        let (locs, brs, devs) = allowed();
        let step = |name: String| {
            serde_json::json!({
                "id": "s2",
                "action": "click",
                "name": name,
                "locator": { "candidates": [ { "kind": "css", "value": "#a" } ] }
            })
        };

        let ok = v2_synthetic(serde_json::json!([
            v2_nav_step(),
            step("x".repeat(150_000))
        ]));
        assert!(
            ok.validate(&locs, &brs, &devs, true).is_ok(),
            "~150KB is within the cap"
        );

        let too_big = v2_synthetic(serde_json::json!([
            v2_nav_step(),
            step("x".repeat(300_000))
        ]));
        let err = too_big.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("too large"), "{err}");
    }

    // ── Journey budget vs. job lease (spec P1.5.4 / T1-5) ────────────────────
    // Raising per-step timeouts and defaulting retries to 1 takes the worst-case
    // run to ~1085s against a 300s job lease. An overrunning job has its lease
    // expire, is requeued by the reaper, and RUNS AGAIN — duplicate results,
    // multiplied browser cost, and a new class of false alert caused by the fix.
    // The invariant that keeps a full retry sequence inside its lease:
    //   (retries + 1) * journey_budget_ms + retries * wait_before_retry_secs * 1000
    //     <= LEASE_SECS * 1000

    #[test]
    fn test_browser_journey_budget_within_lease_ok() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.retries = 1;
        s.wait_before_retry_secs = 5;
        s.config["journey_budget_ms"] = serde_json::json!(300_000);
        // 2 * 300s + 5s = 605s, inside the 900s lease.
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    #[test]
    fn test_browser_journey_budget_exceeding_lease_rejected() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.retries = 3;
        s.wait_before_retry_secs = 5;
        s.config["journey_budget_ms"] = serde_json::json!(300_000);
        // 4 * 300s + 15s = 1215s — well past the 900s lease.
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        // The error must name all three inputs, or an operator cannot tell which
        // one to change.
        assert!(err.contains("journey_budget_ms"), "{err}");
        assert!(err.contains("retries"), "{err}");
        assert!(err.contains("lease"), "{err}");
    }

    // The invariant above was per-DEVICE while the work is per-JOB: the probe runs
    // `browser_devices` sequentially inside the leased job, so the real worst case
    // is multiplied by the combo count. Missing that, a perfectly ordinary
    // desktop+mobile config passed validation and then blew its lease on EVERY
    // run — which is exactly the duplicate-execution failure the lease was raised
    // to 900s to prevent.
    #[test]
    fn test_browser_lease_budget_is_multiplied_by_device_count() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.retries = 1;
        s.wait_before_retry_secs = 5;
        s.config["journey_budget_ms"] = serde_json::json!(300_000);

        // One device: 1 * (2 * 300s + 5s) = 605s, inside the 900s lease.
        s.config["browser_devices"] =
            serde_json::json!([{"browser": "chromium", "device": "desktop"}]);
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());

        // Two devices: 2 * 605s = 1210s. Same per-device budget, twice the work.
        s.config["browser_devices"] = serde_json::json!([
            {"browser": "chromium", "device": "desktop"},
            {"browser": "chromium", "device": "mobile"},
        ]);
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        // Every lever the operator can pull must be named, device count included —
        // it is the one they are most likely to be able to give up.
        assert!(err.contains("browser_devices"), "{err}");
        assert!(err.contains("journey_budget_ms"), "{err}");
        assert!(err.contains("retries"), "{err}");
        assert!(err.contains("lease"), "{err}");
    }

    #[test]
    fn human_ms_renders_durations_not_milliseconds() {
        assert_eq!(human_ms(45_000), "45s");
        assert_eq!(human_ms(300_000), "5m");
        assert_eq!(human_ms(1_210_000), "20m10s");
        assert_eq!(human_ms(900_000), "15m");
    }

    /// The over-lease message is what a user sees INSTEAD of a saved check, so
    /// it has to lead with something they can act on.
    ///
    /// It used to open with "Lower journey_budget_ms" — a field the web UI
    /// neither renders nor sends — and put the arithmetic ahead of the
    /// instruction, in raw milliseconds.
    #[test]
    fn over_lease_message_leads_with_an_actionable_remedy() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.retries = 3;
        s.wait_before_retry_secs = 5;
        s.config["journey_budget_ms"] = serde_json::json!(300_000);
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();

        // 4 attempts x 300s + 3 gaps x 5s = 1215s.
        // Durations, not millisecond counts, for the two headline numbers.
        assert!(err.contains("20m15s"), "worst case as a duration: {err}");
        assert!(err.contains("15m job lease"), "limit as a duration: {err}");
        // The remedy precedes the arithmetic.
        let fix_at = err.find("To fix it").expect("names a fix");
        let detail_at = err.find("Detail:").expect("keeps the arithmetic");
        assert!(fix_at < detail_at, "remedy must come first: {err}");
        // `retries` is offered before the field the UI cannot reach.
        let retries_at = err.find("lower retries").expect("offers retries");
        let budget_at = err
            .find("journey_budget_ms")
            .expect("still names the budget");
        assert!(retries_at < budget_at, "reachable lever first: {err}");
    }

    /// Two browser/device combos with the web form's own default `retries: 1`
    /// and the server default budget land at 2 x (2 x 300s + 5s) = 1210s, past
    /// the 900s lease — so "Chromium desktop + Chromium mobile" cannot be saved
    /// without the author first discovering they must set retries to 0.
    ///
    /// Asserted here so that changing any of the three defaults has to confront
    /// which configurations are savable, rather than shifting it silently.
    #[test]
    fn two_combos_at_default_retries_exceed_the_lease() {
        let lease_ms = JOB_LEASE_SECS * 1_000;
        assert_eq!(
            worst_case_run_ms(DEFAULT_JOURNEY_BUDGET_MS, 2, 1, 5),
            1_210_000
        );
        assert!(worst_case_run_ms(DEFAULT_JOURNEY_BUDGET_MS, 2, 1, 5) > lease_ms);
        // Dropping retries to 0 is the lever the form actually offers, and it
        // brings the same two combos back inside the lease.
        assert!(worst_case_run_ms(DEFAULT_JOURNEY_BUDGET_MS, 2, 0, 5) <= lease_ms);
    }

    #[test]
    fn test_browser_two_devices_fit_with_a_smaller_budget() {
        // The rejection above must be escapable by lowering the budget, not only
        // by dropping a device.
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.retries = 1;
        s.wait_before_retry_secs = 5;
        // 2 devices * (2 * 200s + 5s) = 810s, inside 900s.
        s.config["journey_budget_ms"] = serde_json::json!(200_000);
        s.config["browser_devices"] = serde_json::json!([
            {"browser": "chromium", "device": "desktop"},
            {"browser": "chromium", "device": "mobile"},
        ]);
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    #[test]
    fn test_browser_journey_budget_boundary_is_inclusive() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.retries = 1;
        s.wait_before_retry_secs = 0;
        // Exactly 2 * 450s = 900s — equal to the lease, which is permitted.
        s.config["journey_budget_ms"] = serde_json::json!(450_000);
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());

        // One millisecond more per attempt tips it over.
        s.config["journey_budget_ms"] = serde_json::json!(450_001);
        assert!(s.validate(&locs, &brs, &devs, true).is_err());
    }

    #[test]
    fn test_browser_journey_budget_defaults_when_absent() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.retries = 1;
        s.wait_before_retry_secs = 5;
        // No journey_budget_ms in config — the 300s default applies and fits.
        assert!(s.config.get("journey_budget_ms").is_none());
        assert!(s.validate(&locs, &brs, &devs, true).is_ok());
    }

    #[test]
    fn test_browser_journey_budget_bounds() {
        let (locs, brs, devs) = allowed();
        let mut s = valid_browser_synthetic();
        s.retries = 0;
        s.config["journey_budget_ms"] = serde_json::json!(500);
        let err = s.validate(&locs, &brs, &devs, true).unwrap_err();
        assert!(err.contains("journey_budget_ms"), "{err}");
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
            "steps": [
                {
                    "id": "s1",
                    "action": "click",
                    "name": "Sign in",
                    "locator": { "candidates": [ { "kind": "css", "value": "#x" } ] }
                }
            ],
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
