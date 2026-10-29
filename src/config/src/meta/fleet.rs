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

//! Fleet management API types — in `config` because the handlers and `o2_enterprise` both name
//! them.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

pub const FLEET_TOKEN_PREFIX: &str = "o2ft_";
pub const DEFAULT_HEARTBEAT_INTERVAL_SECS: u32 = 30;
pub const DEFAULT_OFFLINE_HEARTBEATS: u32 = 3;
pub const DEFAULT_RETENTION_DAYS: u32 = 30;
pub const DEFAULT_OFFLINE_RATIO_PERCENT: u32 = 20;
pub const DEFAULT_PHASE_TIMEOUT_SECS: u32 = 30 * 60;
pub const DEFAULT_GATE_OBSERVE_SECS: u32 = 10 * 60;
pub const DEFAULT_GATE_WINDOW_SECS: u32 = 5 * 60;
pub const DEFAULT_GATE_PASS_PERCENT: u32 = 95;
pub const DEFAULT_PAGE_LIMIT: usize = 100;
pub const MAX_PAGE_LIMIT: usize = 1000;
/// Bulk moves accept at most this many collectors (§4.4).
pub const MAX_MOVE_COLLECTORS: usize = 1000;

/// Issues keyed by pipeline id; the empty key holds document-level issues.
pub type Issues = BTreeMap<String, Vec<ConfigIssue>>;

/// Derived when read from `last_seen` and the reported health, never stored (§4.7).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum CollectorStatus {
    Unknown,
    Online,
    Degraded,
    Offline,
}

/// Derived when read from the assignment and the collector's reports (§8.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    Assigned,
    Sent,
    Accepted,
    Running,
    Rejected,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Collector {
    pub id: String,
    /// The nickname, or the host name when none was set.
    pub name: String,
    pub hostname: Option<String>,
    pub os: Option<String>,
    pub arch: Option<String>,
    pub distribution: Option<String>,
    pub version: Option<String>,
    pub outdated: bool,
    pub status: CollectorStatus,
    /// The connection's peer address, honouring `X-Forwarded-For`.
    pub last_connected_from: Option<String>,
    pub fleet: CollectorFleet,
    pub token_id: Option<String>,
    /// Epoch milliseconds.
    pub last_seen: i64,
    /// Epoch milliseconds.
    pub enrolled_at: i64,
    pub config: Option<String>,
    pub config_version: Option<i64>,
    pub delivery: Option<DeliveryState>,
    pub delivery_error: Option<String>,
}

/// A fleet named by its public id; `name` is null once the fleet was deleted.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CollectorFleet {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CollectorsQuery {
    /// Lists one fleet's collectors.
    #[serde(default, alias = "folder")]
    pub fleet: Option<String>,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Paging for every list; `limit` defaults to 100 and is capped at 1000.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema, IntoParams,
)]
#[into_params(parameter_in = Query)]
pub struct PageQuery {
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
}

impl PageQuery {
    pub fn offset(&self) -> usize {
        self.offset.unwrap_or(0)
    }

    pub fn limit(&self) -> usize {
        self.limit
            .unwrap_or(DEFAULT_PAGE_LIMIT)
            .clamp(1, MAX_PAGE_LIMIT)
    }

    /// Cuts one page out of a full list, returning it with the list's total.
    pub fn page<T>(&self, items: Vec<T>) -> (usize, Vec<T>) {
        let total = items.len();
        let page = items
            .into_iter()
            .skip(self.offset())
            .take(self.limit())
            .collect();
        (total, page)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CollectorList {
    pub total: usize,
    pub items: Vec<Collector>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CollectorDetail {
    #[serde(flatten)]
    pub collector: Collector,
    pub capabilities: Vec<String>,
    pub health: Option<CollectorHealth>,
    /// Normalized and redacted.
    pub effective_config: Option<String>,
    /// Epoch milliseconds.
    pub effective_reported_at: Option<i64>,
    pub assignment: Option<CollectorAssignment>,
    pub evidence: DeliveryEvidence,
    /// Newest first.
    pub history: Vec<CollectorEvent>,
}

/// What the collector should run; `revision` increases on every rewrite, including redeliver.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CollectorAssignment {
    /// Fleet id the assignment was written for.
    pub fleet: String,
    pub config: String,
    pub version: i64,
    pub revision: i64,
}

/// The facts the delivery state is derived from (§9.7).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct DeliveryEvidence {
    /// The last `RemoteConfigStatus` status, e.g. `APPLIED` or `FAILED`.
    pub remote_status: Option<String>,
    /// Hex of the last `RemoteConfigStatus` hash.
    pub remote_hash: Option<String>,
    /// Epoch milliseconds.
    pub remote_at: Option<i64>,
    /// The version marker read from the effective configuration.
    pub marker: Option<FleetVersion>,
    /// Epoch milliseconds.
    pub last_heartbeat_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CollectorEvent {
    /// Epoch milliseconds.
    pub at: i64,
    pub event: String,
    pub detail: Option<String>,
}

/// The nickname; an empty name falls back to the host name.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RenameCollectorRequest {
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RestartQueued {
    /// False when the collector does not accept restart commands.
    pub queued: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Redelivered {
    pub revision: i64,
}

/// Stored as the `health` column and returned as is.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CollectorHealth {
    pub healthy: bool,
    pub status: String,
    pub last_error: String,
    pub components: Vec<ComponentHealth>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ComponentHealth {
    pub id: String,
    pub healthy: bool,
    pub status: String,
    pub last_error: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetSummary {
    pub collectors: StatusCounts,
    pub versions: Vec<VersionCount>,
    pub target_version: String,
    pub rollouts_active: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct StatusCounts {
    pub total: usize,
    pub unknown: usize,
    pub online: usize,
    pub degraded: usize,
    pub offline: usize,
    pub outdated: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct VersionCount {
    pub version: String,
    pub count: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct EnrollmentToken {
    pub id: String,
    pub name: String,
    /// The first 9 characters, shown while the value stays masked.
    pub prefix: String,
    /// Epoch milliseconds.
    pub created_at: i64,
    /// Epoch milliseconds; null never expires.
    pub expires_at: Option<i64>,
    pub uses: i64,
    pub max_uses: Option<i64>,
    pub fleet: CollectorFleet,
    pub revoked: bool,
    /// Readable by anyone who can see the fleet; `None` on tokens created before values were kept.
    pub token: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct TokenList {
    pub total: usize,
    pub items: Vec<EnrollmentToken>,
}

/// Unknown fields are refused, so a client never believes an option took effect.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateTokenRequest {
    pub name: String,
    #[serde(default)]
    pub expires_in_days: Option<u32>,
    #[serde(default)]
    pub max_uses: Option<i64>,
    /// The fleet a collector enrolling with this token joins.
    #[serde(default = "default_fleet")]
    pub fleet: String,
}

/// The created token, whose `token` field always carries the value.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CreatedToken {
    #[serde(flatten)]
    pub item: EnrollmentToken,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetConfig {
    pub id: String,
    pub description: String,
    pub latest_version: i64,
    pub live_version: Option<i64>,
    pub collectors: usize,
    /// The readable fleets whose desired or stable version is this configuration.
    pub fleets: Vec<CollectorFleet>,
    /// Fleets using this configuration that the caller cannot read.
    #[serde(default)]
    pub fleets_hidden: usize,
    pub updated_at: i64,
    pub updated_by: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetConfigList {
    pub total: usize,
    pub items: Vec<FleetConfig>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ConfigDraft {
    pub yaml: String,
    pub by: String,
    pub at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum VersionState {
    Published,
    RollingOut,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ConfigVersionSummary {
    pub version: i64,
    pub author: String,
    pub at: i64,
    pub message: String,
    pub live: bool,
    pub state: Option<VersionState>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetConfigDetail {
    #[serde(flatten)]
    pub config: FleetConfig,
    pub draft: Option<ConfigDraft>,
    pub versions: Vec<ConfigVersionSummary>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CreateConfigRequest {
    pub id: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub yaml: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SaveDraftRequest {
    pub yaml: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct DraftSaved {
    pub at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PublishRequest {
    pub yaml: String,
    #[serde(default)]
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Published {
    pub version: i64,
    pub warnings: Issues,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ConfigVersion {
    pub version: i64,
    pub yaml: String,
    pub hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ValidateRequest {
    pub yaml: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ValidationResult {
    pub issues: Issues,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum IssueSeverity {
    Error,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ConfigIssue {
    pub severity: IssueSeverity,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ValidationFailed {
    pub code: u16,
    pub message: String,
    pub issues: Issues,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct AuditEvent {
    pub id: String,
    pub at: i64,
    pub actor: String,
    pub action: String,
    pub target: String,
    pub outcome: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct AuditList {
    pub total: usize,
    pub items: Vec<AuditEvent>,
    /// The trail is the audit stream, so it is empty while `O2_AUDIT_ENABLED` is off.
    #[serde(default)]
    pub audit_disabled: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct AuditQuery {
    pub from: Option<i64>,
    pub to: Option<i64>,
}

/// Per-fleet overrides; `None` inherits the organization default (§4.8).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct FleetSettings {
    #[serde(default)]
    pub heartbeat_interval_secs: Option<u32>,
    /// A collector is offline after this many missed heartbeats.
    #[serde(default)]
    pub offline_heartbeats: Option<u32>,
    /// Offline collectors are removed after this many days; 0 keeps them forever.
    #[serde(default)]
    pub retention_days: Option<u32>,
    #[serde(default)]
    pub offline_ratio_percent: Option<u32>,
    #[serde(default)]
    pub phase_timeout_secs: Option<u32>,
    #[serde(default)]
    pub gate: Option<GateSettings>,
}

impl FleetSettings {
    /// The built-in defaults, every field set.
    pub fn builtin() -> Self {
        Self {
            heartbeat_interval_secs: Some(DEFAULT_HEARTBEAT_INTERVAL_SECS),
            offline_heartbeats: Some(DEFAULT_OFFLINE_HEARTBEATS),
            retention_days: Some(DEFAULT_RETENTION_DAYS),
            offline_ratio_percent: Some(DEFAULT_OFFLINE_RATIO_PERCENT),
            phase_timeout_secs: Some(DEFAULT_PHASE_TIMEOUT_SECS),
            gate: Some(GateSettings::default()),
        }
    }

    /// Fills every unset field from `defaults`.
    pub fn or(self, defaults: &FleetSettings) -> Self {
        Self {
            heartbeat_interval_secs: self
                .heartbeat_interval_secs
                .or(defaults.heartbeat_interval_secs),
            offline_heartbeats: self.offline_heartbeats.or(defaults.offline_heartbeats),
            retention_days: self.retention_days.or(defaults.retention_days),
            offline_ratio_percent: self
                .offline_ratio_percent
                .or(defaults.offline_ratio_percent),
            phase_timeout_secs: self.phase_timeout_secs.or(defaults.phase_timeout_secs),
            gate: self.gate.or(defaults.gate),
        }
    }

    /// These settings over `org_defaults` over the built-in defaults, every field set.
    pub fn resolve(self, org_defaults: &FleetSettings) -> Self {
        self.or(org_defaults).or(&Self::builtin())
    }

    pub fn validate(&self) -> Result<(), String> {
        let positive = [
            ("heartbeat_interval_secs", self.heartbeat_interval_secs),
            ("offline_heartbeats", self.offline_heartbeats),
            ("phase_timeout_secs", self.phase_timeout_secs),
        ];
        for (name, value) in positive {
            if value == Some(0) {
                return Err(format!("{name} must be greater than 0"));
            }
        }
        if self.offline_ratio_percent.is_some_and(|p| p > 100) {
            return Err("offline_ratio_percent must be between 0 and 100".to_string());
        }
        match self.gate {
            Some(gate) => gate.validate(),
            None => Ok(()),
        }
    }
}

/// The verification gate: wait `observe_secs`, then measure over `window_secs` (§9.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct GateSettings {
    pub observe_secs: u32,
    pub window_secs: u32,
    pub pass_percent: u32,
}

impl Default for GateSettings {
    fn default() -> Self {
        Self {
            observe_secs: DEFAULT_GATE_OBSERVE_SECS,
            window_secs: DEFAULT_GATE_WINDOW_SECS,
            pass_percent: DEFAULT_GATE_PASS_PERCENT,
        }
    }
}

impl GateSettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.window_secs == 0 {
            return Err("gate.window_secs must be greater than 0".to_string());
        }
        if self.pass_percent == 0 || self.pass_percent > 100 {
            return Err("gate.pass_percent must be between 1 and 100".to_string());
        }
        Ok(())
    }
}

/// Organization fleet settings; `PUT` replaces every field.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    /// A null target means the built-in default.
    #[serde(default)]
    pub target_collector_version: Option<String>,
    #[serde(default)]
    pub restricted_components: Vec<String>,
    /// Every field set on read; a field left null on write is the built-in default.
    #[serde(default = "FleetSettings::builtin")]
    pub fleet_defaults: FleetSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            target_collector_version: None,
            restricted_components: vec![],
            fleet_defaults: FleetSettings::builtin(),
        }
    }
}

/// A configuration version a fleet runs or should run.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetVersion {
    pub config: String,
    pub version: i64,
}

/// A fleet's latest rollout.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetRollout {
    pub id: String,
    pub status: RolloutStatus,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetState {
    pub desired: Option<FleetVersion>,
    pub stable: Option<FleetVersion>,
    pub rollout: Option<FleetRollout>,
    pub collectors: usize,
    pub online: usize,
    /// Collectors whose assignment is the desired version.
    pub at_desired: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Fleet {
    pub id: String,
    pub name: String,
    /// Null for a fleet the caller may list but not read.
    pub state: Option<FleetState>,
    /// The fleet's own overrides; unset fields inherit the organization defaults.
    pub settings: FleetSettings,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetList {
    pub total: usize,
    pub items: Vec<Fleet>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateFleetRequest {
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RenameFleetRequest {
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MoveCollectorsRequest {
    pub collector_ids: Vec<String>,
    /// Destination fleet id.
    pub to_fleet: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct MoveCollectorsResponse {
    pub moved: usize,
}

/// Why a reference-protected delete was refused (409).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct References {
    pub fleets: usize,
    pub collectors: usize,
    pub rollouts: usize,
    pub tokens: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RolloutStart {
    #[default]
    Now,
    /// Epoch milliseconds.
    At { at: i64 },
}

/// Phase sizes are counts of collectors, never percentages (§9.2).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Batching {
    #[default]
    One,
    Canary {
        first: usize,
    },
    Progressive {
        initial: usize,
        multiplier: usize,
        max: usize,
    },
}

/// A fleet's new desired version and how the rollout converges to it; unknown fields refused.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SetDesiredRequest {
    pub config: String,
    pub version: i64,
    #[serde(default)]
    pub start: RolloutStart,
    #[serde(default)]
    pub batching: Batching,
    /// Health gate after every phase, the last one included.
    #[serde(default)]
    pub verify: bool,
    /// Pre-authorizes Rollback for the `proven_bad` and `looks_worse` halts.
    #[serde(default)]
    pub auto_rollback: bool,
}

/// The expanded plan for the fleet's current size.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PlanPreview {
    pub phases: Vec<usize>,
    /// The first batch covers every eligible collector, so the plan is one batch.
    pub collapsed: bool,
    pub eligible: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RolloutStatus {
    Scheduled,
    InProgress,
    Halted,
    Completed,
    Superseded,
    RolledBack,
}

impl RolloutStatus {
    pub fn is_active(self) -> bool {
        matches!(self, Self::Scheduled | Self::InProgress | Self::Halted)
    }
}

/// The evidence class of a halt (§9.5); only the first two may roll back automatically.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HaltClass {
    ProvenBad,
    LooksWorse,
    CannotSee,
}

impl HaltClass {
    pub fn can_auto_rollback(self) -> bool {
        !matches!(self, Self::CannotSee)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HaltExit {
    Rollback,
    Resume,
    FixForward,
    Skip,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RolloutHalt {
    pub class: HaltClass,
    pub reason: String,
    /// Epoch milliseconds.
    pub at: i64,
    /// The exits this halt offers (§9.6).
    pub exits: Vec<HaltExit>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PhaseStatus {
    Pending,
    Deploying,
    Converging,
    Observing,
    Verifying,
    Done,
    Failed,
    Stopped,
    TimedOut,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct GateResult {
    pub passed: bool,
    pub observed: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RolloutPhase {
    pub index: usize,
    pub size: usize,
    pub status: PhaseStatus,
    pub targeted: usize,
    pub sent: usize,
    pub confirmed: usize,
    pub rejected: usize,
    pub gate: Option<GateResult>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MemberState {
    Pending,
    Assigned,
    Sent,
    Accepted,
    Running,
    Rejected,
    /// The collector was deleted mid-rollout and no longer blocks convergence.
    Removed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RolloutMember {
    pub collector_id: String,
    pub phase: usize,
    pub state: MemberState,
    /// Skipped after a halt; included again by default in the next rollout.
    pub excluded: bool,
    #[serde(default)]
    pub evidence: Option<DeliveryEvidence>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RolloutEvent {
    /// Epoch milliseconds.
    pub at: i64,
    pub key: String,
    #[serde(default)]
    pub phase: Option<usize>,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Rollout {
    pub id: String,
    pub fleet: CollectorFleet,
    pub config: String,
    pub from_version: Option<i64>,
    pub to_version: i64,
    pub start: RolloutStart,
    pub batching: Batching,
    pub verify: bool,
    pub auto_rollback: bool,
    pub status: RolloutStatus,
    pub halt: Option<RolloutHalt>,
    /// Members fixed at creation, so the denominator never changes.
    pub total: usize,
    /// Members running the new version.
    pub running: usize,
    pub phases: Vec<RolloutPhase>,
    pub members: Vec<RolloutMember>,
    pub events: Vec<RolloutEvent>,
    pub started_by: String,
    /// Epoch milliseconds.
    pub started_at: i64,
    /// Epoch milliseconds.
    pub ended_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RolloutList {
    pub total: usize,
    pub items: Vec<Rollout>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct RolloutsQuery {
    /// Lists one fleet's rollouts.
    #[serde(default)]
    pub fleet: Option<String>,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SkipRequest {
    pub collector_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum FlowWindow {
    #[serde(rename = "5m")]
    FiveMinutes,
    #[default]
    #[serde(rename = "1h")]
    OneHour,
    #[serde(rename = "24h")]
    OneDay,
}

impl FlowWindow {
    pub fn range(self) -> &'static str {
        match self {
            FlowWindow::FiveMinutes => "5m",
            FlowWindow::OneHour => "1h",
            FlowWindow::OneDay => "24h",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct FlowQuery {
    pub window: Option<FlowWindow>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum FlowSignal {
    Logs,
    Metrics,
    Traces,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FlowIssueKind {
    ExportErrors,
    Dropped,
    Backpressure,
    ReceiverRefused,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FlowIssue {
    pub kind: FlowIssueKind,
    pub signal: FlowSignal,
    pub value: f64,
}

/// `exporter` is set only on a config-scoped destination, so the UI can label it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FlowDestination {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub target: Option<String>,
    pub exporter: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PipelinesResponse {
    pub window: FlowWindow,
    /// Epoch milliseconds.
    pub generated_at: i64,
    pub fleets: Vec<PipelineFleet>,
    pub pipelines: Vec<Pipeline>,
    pub destinations: Vec<FlowDestination>,
    /// Some throughput queries were skipped because the caller may not read their metric streams.
    pub metrics_restricted: bool,
}

/// A readable fleet; without telemetry it lists its stable (else desired) version's pipelines.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PipelineFleet {
    pub id: String,
    pub name: String,
    pub config: Option<String>,
    pub version: Option<i64>,
    pub collectors: usize,
}

/// One `service.pipelines` entry of a fleet; collectors on older versions add to the same name.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Pipeline {
    /// `{fleet}/{name}`.
    pub id: String,
    pub fleet: String,
    pub name: String,
    pub signal: FlowSignal,
    pub receivers: Vec<PipelineReceiver>,
    pub exporters: Vec<PipelineExporter>,
    /// Items per second over the window; null means no telemetry, 0 a measured zero.
    pub in_rate: Option<f64>,
    pub out_rate: Option<f64>,
    /// `send_failed / (sent + send_failed)` over the last 5m.
    pub failed_ratio: Option<f64>,
    /// `enqueue_failed / (sent + enqueue_failed)` over the last 5m.
    pub dropped_ratio: Option<f64>,
    /// The fullest exporter queue over the last 45s.
    pub queue_ratio: Option<f64>,
    pub issues: Vec<FlowIssue>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PipelineReceiver {
    pub name: String,
    pub rate: Option<f64>,
    /// Refused items per second over the last 5m.
    pub refused: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PipelineExporter {
    pub name: String,
    /// An id in `destinations`.
    pub destination: String,
    pub rate: Option<f64>,
    /// Items per second that failed to send over the last 5m.
    pub failed: f64,
    /// Items per second that failed to enqueue over the last 5m.
    pub dropped: f64,
    pub queue: Option<f64>,
}

fn default_fleet() -> String {
    crate::meta::folder::DEFAULT_FOLDER.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collector() -> Collector {
        Collector {
            id: "c1".to_string(),
            name: "host-a".to_string(),
            hostname: Some("host-a".to_string()),
            os: None,
            arch: None,
            distribution: None,
            version: None,
            outdated: false,
            status: CollectorStatus::Unknown,
            last_connected_from: Some("10.0.0.1".to_string()),
            fleet: CollectorFleet {
                id: "default".to_string(),
                name: Some("default".to_string()),
            },
            token_id: None,
            last_seen: 1,
            enrolled_at: 1,
            config: None,
            config_version: None,
            delivery: Some(DeliveryState::Accepted),
            delivery_error: None,
        }
    }

    fn rollout() -> Rollout {
        Rollout {
            id: "r1".to_string(),
            fleet: CollectorFleet {
                id: "f1".to_string(),
                name: Some("Edge nodes".to_string()),
            },
            config: "edge".to_string(),
            from_version: None,
            to_version: 2,
            start: RolloutStart::At { at: 5 },
            batching: Batching::Canary { first: 2 },
            verify: true,
            auto_rollback: false,
            status: RolloutStatus::Halted,
            halt: Some(RolloutHalt {
                class: HaltClass::ProvenBad,
                reason: "rejected".to_string(),
                at: 1,
                exits: vec![HaltExit::Rollback, HaltExit::FixForward, HaltExit::Skip],
            }),
            total: 2,
            running: 0,
            phases: vec![RolloutPhase {
                index: 0,
                size: 2,
                status: PhaseStatus::TimedOut,
                targeted: 2,
                sent: 2,
                confirmed: 0,
                rejected: 1,
                gate: None,
            }],
            members: vec![RolloutMember {
                collector_id: "c1".to_string(),
                phase: 0,
                state: MemberState::Rejected,
                excluded: false,
                evidence: None,
            }],
            events: vec![RolloutEvent {
                at: 1,
                key: "halted".to_string(),
                phase: Some(0),
                detail: None,
            }],
            started_by: "u".to_string(),
            started_at: 1,
            ended_at: None,
        }
    }

    #[test]
    fn detail_flattens_the_list_item_without_drift_fields() {
        let detail = CollectorDetail {
            collector: collector(),
            capabilities: vec![],
            health: None,
            effective_config: None,
            effective_reported_at: None,
            assignment: Some(CollectorAssignment {
                fleet: "default".to_string(),
                config: "edge".to_string(),
                version: 3,
                revision: 7,
            }),
            evidence: DeliveryEvidence {
                marker: Some(FleetVersion {
                    config: "edge".to_string(),
                    version: 3,
                }),
                ..Default::default()
            },
            history: vec![CollectorEvent {
                at: 1,
                event: "moved_by_token".to_string(),
                detail: None,
            }],
        };
        let json = serde_json::to_value(&detail).unwrap();
        assert_eq!(json["id"], "c1");
        assert_eq!(json["status"], "unknown");
        assert_eq!(json["delivery"], "accepted");
        assert_eq!(json["last_connected_from"], "10.0.0.1");
        assert_eq!(json["assignment"]["revision"], 7);
        assert_eq!(json["evidence"]["marker"]["version"], 3);
        assert!(json["evidence"]["remote_hash"].is_null());
        assert_eq!(json["history"][0]["event"], "moved_by_token");
        for gone in [
            "collector",
            "ip",
            "drifted",
            "drift_since",
            "baseline_config",
        ] {
            assert!(json.get(gone).is_none(), "{gone}");
        }
    }

    #[test]
    fn created_token_flattens_the_token_and_adds_the_plaintext() {
        let created = CreatedToken {
            item: EnrollmentToken {
                id: "t1".to_string(),
                name: "k8s-helm".to_string(),
                prefix: "o2ft_Qm7x".to_string(),
                created_at: 1,
                expires_at: None,
                uses: 0,
                max_uses: None,
                fleet: CollectorFleet {
                    id: "f1".to_string(),
                    name: None,
                },
                revoked: false,
                token: Some("o2ft_secret".to_string()),
            },
        };
        let json = serde_json::to_value(&created).unwrap();
        assert_eq!(json["id"], "t1");
        assert_eq!(json["token"], "o2ft_secret");
        assert!(json["fleet"]["name"].is_null(), "a deleted fleet");
        assert!(json.get("item").is_none());
    }

    #[test]
    fn config_detail_flattens_and_requests_default_their_optional_fields() {
        let detail = FleetConfigDetail {
            config: FleetConfig {
                id: "edge".to_string(),
                description: String::new(),
                latest_version: 1,
                live_version: None,
                collectors: 0,
                fleets: vec![],
                fleets_hidden: 1,
                updated_at: 1,
                updated_by: "u".to_string(),
            },
            draft: None,
            versions: vec![],
        };
        let json = serde_json::to_value(&detail).unwrap();
        assert_eq!(json["id"], "edge");
        assert_eq!(json["fleets_hidden"], 1);
        assert!(json.get("config").is_none());
        let publish: PublishRequest = serde_json::from_str(r#"{"yaml":"a: 1"}"#).unwrap();
        assert_eq!(publish.message, "");
    }

    #[test]
    fn rollout_serializes_as_the_contract_documents() {
        let json = serde_json::to_value(rollout()).unwrap();
        assert_eq!(json["status"], "halted");
        assert_eq!(json["start"], serde_json::json!({"kind": "at", "at": 5}));
        assert_eq!(
            json["batching"],
            serde_json::json!({"kind": "canary", "first": 2})
        );
        assert_eq!(json["halt"]["class"], "proven_bad");
        assert_eq!(
            json["halt"]["exits"],
            serde_json::json!(["rollback", "fix_forward", "skip"])
        );
        assert_eq!(json["phases"][0]["status"], "timed_out");
        assert_eq!(json["members"][0]["state"], "rejected");
        assert!(json["ended_at"].is_null());
        let back: Rollout = serde_json::from_value(json).unwrap();
        assert_eq!(back, rollout());
        for (status, text) in [
            (RolloutStatus::Scheduled, "scheduled"),
            (RolloutStatus::InProgress, "in_progress"),
            (RolloutStatus::Superseded, "superseded"),
            (RolloutStatus::RolledBack, "rolled_back"),
        ] {
            assert_eq!(serde_json::to_value(status).unwrap(), text);
        }
        assert!(HaltClass::LooksWorse.can_auto_rollback());
        assert!(!HaltClass::CannotSee.can_auto_rollback());
    }

    #[test]
    fn set_desired_defaults_to_now_one_batch_and_refuses_unknown_fields() {
        let ok: SetDesiredRequest = serde_json::from_value(serde_json::json!({
            "config": "edge", "version": 2
        }))
        .unwrap();
        assert_eq!(
            (ok.start, ok.batching, ok.verify, ok.auto_rollback),
            (RolloutStart::Now, Batching::One, false, false)
        );
        let staged: SetDesiredRequest = serde_json::from_value(serde_json::json!({
            "config": "edge", "version": 2,
            "start": {"kind": "at", "at": 10},
            "batching": {"kind": "progressive", "initial": 3, "multiplier": 3, "max": 27},
            "verify": true, "auto_rollback": true
        }))
        .unwrap();
        assert_eq!(staged.start, RolloutStart::At { at: 10 });
        assert_eq!(
            staged.batching,
            Batching::Progressive {
                initial: 3,
                multiplier: 3,
                max: 27
            }
        );
        for bad in [
            serde_json::json!({"config": "edge", "version": 2, "strategy": "immediate"}),
            serde_json::json!({"config": "edge", "version": 2, "batching": {"kind": "canary"}}),
            serde_json::json!({"config": "edge", "version": 2, "batching": {"kind": "percent", "n": 5}}),
            serde_json::json!({"config": "edge", "version": 2,
                "batching": {"kind": "canary", "first": 1, "size": 2}}),
        ] {
            assert!(
                serde_json::from_value::<SetDesiredRequest>(bad.clone()).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn fleet_settings_inherit_org_then_builtin_defaults() {
        let fleet = FleetSettings {
            heartbeat_interval_secs: Some(10),
            ..Default::default()
        };
        let org = FleetSettings {
            retention_days: Some(0),
            ..Default::default()
        };
        let resolved = fleet.resolve(&org);
        assert_eq!(resolved.heartbeat_interval_secs, Some(10));
        assert_eq!(resolved.retention_days, Some(0));
        assert_eq!(
            resolved.offline_heartbeats,
            Some(DEFAULT_OFFLINE_HEARTBEATS)
        );
        assert_eq!(resolved.gate, Some(GateSettings::default()));
        let empty: FleetSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(empty, FleetSettings::default());
        assert!(serde_json::from_str::<FleetSettings>(r#"{"show_drift":true}"#).is_err());
        let zero = FleetSettings {
            heartbeat_interval_secs: Some(0),
            ..Default::default()
        };
        assert!(zero.validate().is_err());
        assert!(FleetSettings::builtin().validate().is_ok());
    }

    #[test]
    fn org_settings_fill_missing_fields_and_refuse_unknown_ones() {
        let decoded: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(decoded, Settings::default());
        assert_eq!(decoded.fleet_defaults, FleetSettings::builtin());
        let set: Settings = serde_json::from_str(
            r#"{"target_collector_version":"0.170.0","restricted_components":["debug"],
                "fleet_defaults":{"heartbeat_interval_secs":15}}"#,
        )
        .unwrap();
        assert_eq!(set.target_collector_version.as_deref(), Some("0.170.0"));
        assert_eq!(set.fleet_defaults.heartbeat_interval_secs, Some(15));
        assert!(serde_json::from_str::<Settings>(r#"{"target_version":null}"#).is_err());
    }

    #[test]
    fn page_query_cuts_a_page_and_keeps_the_total() {
        let page = PageQuery {
            offset: Some(2),
            limit: Some(2),
        };
        assert_eq!(page.page(vec![1, 2, 3, 4, 5]), (5, vec![3, 4]));
        let unbounded = PageQuery {
            offset: None,
            limit: Some(usize::MAX),
        };
        assert_eq!(unbounded.limit(), MAX_PAGE_LIMIT);
        let query: CollectorsQuery = serde_json::from_str(r#"{"folder":"f1"}"#).unwrap();
        assert_eq!(query.fleet.as_deref(), Some("f1"));
    }

    #[test]
    fn move_and_fleet_types_serialize_as_the_api_documents() {
        let req: MoveCollectorsRequest =
            serde_json::from_str(r#"{"collector_ids":["c1"],"to_fleet":"f2"}"#).unwrap();
        assert_eq!((req.collector_ids.len(), req.to_fleet.as_str()), (1, "f2"));
        let old = r#"{"collector_ids":[],"dst_folder_id":"f"}"#;
        assert!(serde_json::from_str::<MoveCollectorsRequest>(old).is_err());
        let list = FleetList {
            total: 1,
            items: vec![Fleet {
                id: "f1".to_string(),
                name: "Edge".to_string(),
                state: None,
                settings: FleetSettings::default(),
            }],
        };
        let json = serde_json::to_value(list).unwrap();
        assert_eq!(json["total"], 1);
        assert!(json["items"][0]["state"].is_null(), "listed, not readable");
        assert!(json["items"][0]["settings"]["heartbeat_interval_secs"].is_null());
    }

    #[test]
    fn flow_window_round_trips_and_defaults_to_one_hour() {
        for (window, text) in [
            (FlowWindow::FiveMinutes, "5m"),
            (FlowWindow::OneHour, "1h"),
            (FlowWindow::OneDay, "24h"),
        ] {
            assert_eq!(
                serde_json::from_str::<FlowWindow>(&format!("\"{text}\"")).unwrap(),
                window
            );
            assert_eq!(window.range(), text);
        }
        let query: FlowQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(query.window.unwrap_or_default(), FlowWindow::OneHour);
    }
}
