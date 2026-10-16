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

//! Fleet Manager API types — in `config` because the handlers and `o2_enterprise` both name them.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

pub const FLEET_TOKEN_PREFIX: &str = "o2ft_";

/// Issues keyed by pipeline id; the empty key holds document-level issues.
pub type Issues = BTreeMap<String, Vec<ConfigIssue>>;

/// Derived when read from `last_seen` and the reported health, never stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum CollectorStatus {
    Online,
    Degraded,
    Offline,
}

/// Derived when read from the assignment and the collector's reports (§4.7).
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
    pub name: Option<String>,
    pub hostname: Option<String>,
    pub ip: Option<String>,
    pub status: CollectorStatus,
    pub os: Option<String>,
    pub arch: Option<String>,
    pub distribution: Option<String>,
    pub version: Option<String>,
    pub outdated: bool,
    pub config: Option<String>,
    pub config_version: Option<i64>,
    pub delivery: Option<DeliveryState>,
    /// Null when drift is unknown, which is never shown as in sync.
    pub drifted: Option<bool>,
    pub fleet: CollectorFleet,
    pub token_id: Option<String>,
    /// Epoch milliseconds.
    pub last_seen: i64,
    /// Epoch milliseconds.
    pub enrolled_at: i64,
}

/// A fleet named by its public id; `name` is null once the fleet was deleted.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CollectorFleet {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CollectorsQuery {
    /// Lists one fleet's collectors.
    pub folder: Option<String>,
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
    pub errors: Vec<String>,
    pub delivery_error: Option<String>,
    pub effective_config: Option<EffectiveConfig>,
    /// Epoch milliseconds.
    pub assigned_at: Option<i64>,
    /// Epoch milliseconds.
    pub applied_at: Option<i64>,
    /// Epoch milliseconds.
    pub drift_since: Option<i64>,
    /// The effective config when the assignment was confirmed, redacted.
    pub baseline_config: Option<String>,
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
pub struct EffectiveConfig {
    pub yaml: String,
    /// Epoch milliseconds.
    pub reported_at: i64,
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
    pub online: usize,
    pub degraded: usize,
    pub offline: usize,
    pub drifted: usize,
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
    /// The first 9 characters, the only part of the secret ever shown again.
    pub prefix: String,
    /// Epoch milliseconds.
    pub created_at: i64,
    /// Epoch milliseconds; null never expires.
    pub expires_at: Option<i64>,
    pub uses: i64,
    pub max_uses: Option<i64>,
    pub fleet: CollectorFleet,
    pub revoked: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct TokenList {
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

/// The only response that carries the plaintext token.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CreatedToken {
    #[serde(flatten)]
    pub item: EnrollmentToken,
    pub token: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetConfig {
    pub id: String,
    pub description: String,
    pub template: bool,
    pub latest_version: i64,
    pub live_version: Option<i64>,
    pub collectors: usize,
    /// The fleets whose desired version is this configuration.
    pub fleets: Vec<CollectorFleet>,
    pub updated_at: i64,
    pub updated_by: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetConfigList {
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

/// Org fleet settings; `PUT` replaces both fields, and a null target means the built-in default.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct FleetSettings {
    pub restricted_components: Vec<String>,
    // A required key that may be null: a client sending only the list must not reset the target.
    #[serde(deserialize_with = "Option::deserialize")]
    #[schema(required = true)]
    pub target_version: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RolloutStrategy {
    Immediate,
    Canary,
    Progressive,
    Scheduled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RolloutStatus {
    Scheduled,
    InProgress,
    Completed,
    Halted,
    Superseded,
}

/// Why a revision halted; only a rejection or a failed gate is reverted automatically.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HaltKind {
    Rejection,
    GateFailed,
    NoData,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RolloutBatch {
    pub initial: usize,
    #[serde(default)]
    pub multiplier: Option<usize>,
    #[serde(default)]
    pub max: Option<usize>,
}

/// A fleet's new desired version and how the revision converges to it; unknown fields refused.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SetDesiredRequest {
    pub config: String,
    pub version: i64,
    pub strategy: RolloutStrategy,
    #[serde(default)]
    pub batch: Option<RolloutBatch>,
    /// Epoch milliseconds; required with `scheduled`, refused otherwise.
    #[serde(default)]
    pub scheduled_for: Option<i64>,
    #[serde(default)]
    pub gates: bool,
    #[serde(default)]
    pub auto_rollback: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RolloutPhase {
    pub id: String,
    pub label: String,
    pub size: usize,
    pub assigned: usize,
    pub attempted: usize,
    pub accepted: usize,
    pub failed: usize,
    pub status: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RolloutGate {
    pub id: String,
    pub threshold: String,
    pub observed: String,
    pub status: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RolloutFailure {
    pub kind: HaltKind,
    pub gate: String,
    pub observed: String,
    pub threshold: String,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RolloutEvent {
    pub key: String,
    /// Epoch milliseconds.
    pub at: i64,
    #[serde(default)]
    pub phase: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Rollout {
    pub id: String,
    pub kind: String,
    pub config: String,
    pub from_version: Option<i64>,
    pub to_version: i64,
    pub fleet: CollectorFleet,
    pub strategy: RolloutStrategy,
    pub status: RolloutStatus,
    pub total: usize,
    pub assigned: usize,
    pub attempted: usize,
    pub accepted: usize,
    pub failed: usize,
    /// Epoch milliseconds.
    pub started_at: i64,
    pub scheduled_for: Option<i64>,
    pub started_by: String,
    pub auto_rollback: bool,
    pub phases: Vec<RolloutPhase>,
    pub gates: Vec<RolloutGate>,
    pub failure: Option<RolloutFailure>,
    pub events: Vec<RolloutEvent>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RolloutDetail {
    #[serde(flatten)]
    pub rollout: Rollout,
    pub members: Vec<String>,
    pub still_on_previous: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct RolloutList {
    pub items: Vec<Rollout>,
}

/// A configuration version a fleet runs or should run.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetVersion {
    pub config: String,
    pub version: i64,
}

/// A fleet's latest revision.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetRevision {
    pub id: String,
    pub status: RolloutStatus,
}

/// What a fleet runs; only shown to a user who may read the fleet.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetState {
    pub desired: Option<FleetVersion>,
    pub stable: Option<FleetVersion>,
    pub revision: Option<FleetRevision>,
    pub collectors: usize,
    pub online: usize,
    /// Collectors whose assignment is the desired version.
    pub at_desired: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Fleet {
    pub id: String,
    pub name: String,
    pub state: Option<FleetState>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FleetList {
    pub items: Vec<Fleet>,
}

/// The body `MoveAcrossFolders` sends; unknown fields are refused.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MoveCollectorsRequest {
    pub collector_ids: Vec<String>,
    pub dst_folder_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct MoveCollectorsResponse {
    pub moved: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct MoveQuery {
    /// When set, every collector must be in this fleet.
    pub folder: Option<String>,
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
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FlowIssue {
    pub kind: FlowIssueKind,
    pub signal: FlowSignal,
    pub value: f64,
}

/// Items per second; null means no telemetry for that signal on the link, 0 a measured zero.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SignalRates {
    pub logs: Option<f64>,
    pub metrics: Option<f64>,
    pub traces: Option<f64>,
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
pub struct FlowLink {
    pub config: String,
    pub destination: String,
    pub exporters: Vec<String>,
    pub rate: SignalRates,
    pub issues: Vec<FlowIssue>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FlowResponse {
    pub window: FlowWindow,
    /// Epoch milliseconds.
    pub generated_at: i64,
    pub destinations: Vec<FlowDestination>,
    pub links: Vec<FlowLink>,
    /// Some throughput queries were skipped because the caller may not read their metric streams.
    pub metrics_restricted: bool,
}

fn default_fleet() -> String {
    crate::meta::folder::DEFAULT_FOLDER.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detail_flattens_the_list_item() {
        let detail = CollectorDetail {
            collector: Collector {
                id: "c1".to_string(),
                name: None,
                hostname: None,
                ip: None,
                status: CollectorStatus::Degraded,
                os: None,
                arch: None,
                distribution: None,
                version: None,
                outdated: false,
                config: None,
                config_version: None,
                delivery: None,
                drifted: None,
                fleet: CollectorFleet {
                    id: "default".to_string(),
                    name: Some("default".to_string()),
                },
                token_id: None,
                last_seen: 1,
                enrolled_at: 1,
            },
            capabilities: vec![],
            health: None,
            errors: vec![],
            delivery_error: None,
            effective_config: None,
            assigned_at: None,
            applied_at: None,
            drift_since: None,
            baseline_config: None,
        };
        let json = serde_json::to_value(&detail).unwrap();
        assert_eq!(json["id"], "c1");
        assert_eq!(json["status"], "degraded");
        assert!(json["drifted"].is_null());
        assert!(json.get("collector").is_none());
        assert_eq!(json["fleet"]["id"], "default");
        assert!(json.get("labels").is_none() && json.get("groups").is_none());
        assert!(json.get("assigned_via").is_none());
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
            },
            token: "o2ft_secret".to_string(),
        };
        let json = serde_json::to_value(&created).unwrap();
        assert_eq!(json["id"], "t1");
        assert_eq!(json["prefix"], "o2ft_Qm7x");
        assert_eq!(json["token"], "o2ft_secret");
        assert_eq!(json["fleet"]["id"], "f1");
        assert!(
            json["fleet"]["name"].is_null(),
            "a deleted fleet has no name"
        );
        assert!(json.get("labels").is_none());
        assert!(json["expires_at"].is_null());
        assert!(json["max_uses"].is_null());
        assert!(json.get("item").is_none());
    }

    #[test]
    fn config_detail_flattens_and_requests_default_their_optional_fields() {
        let detail = FleetConfigDetail {
            config: FleetConfig {
                id: "edge".to_string(),
                description: String::new(),
                template: false,
                latest_version: 1,
                live_version: None,
                collectors: 0,
                fleets: vec![],
                updated_at: 1,
                updated_by: "u".to_string(),
            },
            draft: None,
            versions: vec![ConfigVersionSummary {
                version: 1,
                author: "u".to_string(),
                at: 1,
                message: String::new(),
                live: false,
                state: Some(VersionState::Published),
            }],
        };
        let json = serde_json::to_value(&detail).unwrap();
        assert_eq!(json["id"], "edge");
        assert!(json["live_version"].is_null());
        assert!(json.get("config").is_none());
        assert_eq!(json["versions"][0]["state"], "published");

        let issue = |severity, text: &str| ConfigIssue {
            severity,
            text: text.to_string(),
        };
        let issues = Issues::from([
            (String::new(), vec![issue(IssueSeverity::Error, "bad")]),
            (
                "logs".to_string(),
                vec![issue(IssueSeverity::Warning, "debug")],
            ),
        ]);
        assert_eq!(
            serde_json::to_value(&issues).unwrap(),
            serde_json::json!({
                "": [{"severity": "error", "text": "bad"}],
                "logs": [{"severity": "warning", "text": "debug"}],
            })
        );

        let publish: PublishRequest = serde_json::from_str(r#"{"yaml":"a: 1"}"#).unwrap();
        assert_eq!(publish.message, "");
        let create: CreateConfigRequest = serde_json::from_str(r#"{"id":"edge"}"#).unwrap();
        assert_eq!(
            (create.description.as_str(), create.yaml.as_str()),
            ("", "")
        );
    }

    fn rollout() -> Rollout {
        Rollout {
            id: "r1".to_string(),
            kind: "config".to_string(),
            config: "edge".to_string(),
            from_version: None,
            to_version: 2,
            fleet: CollectorFleet {
                id: "f1".to_string(),
                name: Some("Edge nodes".to_string()),
            },
            strategy: RolloutStrategy::Immediate,
            status: RolloutStatus::Halted,
            total: 2,
            assigned: 2,
            attempted: 1,
            accepted: 0,
            failed: 1,
            started_at: 1,
            scheduled_for: None,
            started_by: "u".to_string(),
            auto_rollback: false,
            phases: vec![],
            gates: vec![],
            failure: Some(RolloutFailure {
                kind: HaltKind::Rejection,
                gate: "rejected".to_string(),
                observed: "1".to_string(),
                threshold: "0".to_string(),
                message: Some("bad receiver".to_string()),
            }),
            events: vec![RolloutEvent {
                key: "deploying".to_string(),
                at: 1,
                phase: Some(0),
            }],
        }
    }

    #[test]
    fn rollout_types_serialize_as_the_api_documents() {
        assert_eq!(
            serde_json::to_value(DeliveryState::Rejected).unwrap(),
            "rejected"
        );
        assert_eq!(
            serde_json::to_value(VersionState::RollingOut).unwrap(),
            "rolling_out"
        );

        let json = serde_json::to_value(rollout()).unwrap();
        assert_eq!(json["auto_rollback"], false);
        assert_eq!(json["gates"], serde_json::json!([]));
        assert_eq!(json["status"], "halted");
        assert_eq!(json["strategy"], "immediate");
        assert_eq!(json["fleet"]["id"], "f1");
        assert_eq!(json["failure"]["kind"], "rejection");
        for gone in ["target", "target_kind", "reverted", "reverting"] {
            assert!(json.get(gone).is_none(), "{gone}");
        }

        let detail = serde_json::to_value(RolloutDetail {
            rollout: rollout(),
            members: vec!["c1".to_string()],
            still_on_previous: 3,
        })
        .unwrap();
        assert_eq!(detail["id"], "r1");
        assert_eq!(detail["still_on_previous"], 3);
        assert!(detail.get("rollout").is_none());
    }

    #[test]
    fn set_desired_takes_the_staged_fields_and_refuses_unknown_ones() {
        let ok: SetDesiredRequest = serde_json::from_value(serde_json::json!({
            "config": "edge", "version": 2, "strategy": "immediate"
        }))
        .unwrap();
        assert_eq!((ok.config.as_str(), ok.version), ("edge", 2));
        assert_eq!(
            (ok.batch, ok.scheduled_for, ok.gates, ok.auto_rollback),
            (None, None, false, false)
        );
        let staged: SetDesiredRequest = serde_json::from_value(serde_json::json!({
            "config": "edge", "version": 2, "strategy": "progressive",
            "batch": {"initial": 1, "multiplier": 2, "max": 4},
            "scheduled_for": null, "gates": true, "auto_rollback": true
        }))
        .unwrap();
        assert_eq!(
            staged.batch,
            Some(RolloutBatch {
                initial: 1,
                multiplier: Some(2),
                max: Some(4)
            })
        );
        assert!(staged.gates && staged.auto_rollback);
        let target = serde_json::json!({
            "config": "edge", "version": 2, "strategy": "immediate", "target": {"collectors": []}
        });
        let size = serde_json::json!({
            "config": "edge", "version": 2, "strategy": "canary",
            "batch": {"initial": 1, "size": 2}
        });
        for (unknown, field) in [(target, "target"), (size, "size")] {
            let err = serde_json::from_value::<SetDesiredRequest>(unknown).unwrap_err();
            assert!(err.to_string().contains(field), "{err}");
        }
    }

    #[test]
    fn revision_statuses_and_halt_kinds_serialize_and_a_3a_event_has_no_phase() {
        for (status, text) in [
            (RolloutStatus::Scheduled, "scheduled"),
            (RolloutStatus::InProgress, "in_progress"),
            (RolloutStatus::Completed, "completed"),
            (RolloutStatus::Halted, "halted"),
            (RolloutStatus::Superseded, "superseded"),
        ] {
            assert_eq!(serde_json::to_value(status).unwrap(), text);
        }
        for gone in ["paused", "stopped", "failed", "rolled_back"] {
            assert!(serde_json::from_value::<RolloutStatus>(serde_json::json!(gone)).is_err());
        }
        for (kind, text) in [
            (HaltKind::Rejection, "rejection"),
            (HaltKind::GateFailed, "gate_failed"),
            (HaltKind::NoData, "no_data"),
        ] {
            assert_eq!(serde_json::to_value(kind).unwrap(), text);
        }
        let old: RolloutEvent = serde_json::from_str(r#"{"key":"deploying","at":5}"#).unwrap();
        assert_eq!(old.phase, None);
    }

    #[test]
    fn create_token_defaults_the_fleet_and_refuses_labels_and_unknown_fields() {
        let req: CreateTokenRequest = serde_json::from_str(r#"{"name":"n"}"#).unwrap();
        assert_eq!(req.name, "n");
        assert_eq!(req.expires_in_days, None);
        assert_eq!(req.max_uses, None);
        assert_eq!(req.fleet, "default");
        let req: CreateTokenRequest = serde_json::from_str(
            r#"{"name":"n","expires_in_days":null,"max_uses":5,"fleet":"f1"}"#,
        )
        .unwrap();
        assert_eq!(
            (req.expires_in_days, req.max_uses, req.fleet.as_str()),
            (None, Some(5), "f1")
        );
        for body in [
            r#"{"name":"n","labels":{"env":"prod"}}"#,
            r#"{"name":"n","group":"g"}"#,
        ] {
            assert!(
                serde_json::from_str::<CreateTokenRequest>(body).is_err(),
                "{body}"
            );
        }
    }

    #[test]
    fn move_and_fleet_types_serialize_as_the_api_documents() {
        let req: MoveCollectorsRequest =
            serde_json::from_str(r#"{"collector_ids":["c1"],"dst_folder_id":"f2"}"#).unwrap();
        assert_eq!(
            (req.collector_ids.len(), req.dst_folder_id.as_str()),
            (1, "f2")
        );
        let extra = r#"{"collector_ids":[],"dst_folder_id":"f","alert_ids":[]}"#;
        assert!(serde_json::from_str::<MoveCollectorsRequest>(extra).is_err());
        let list = FleetList {
            items: vec![Fleet {
                id: "f1".to_string(),
                name: "Edge".to_string(),
                state: None,
            }],
        };
        let json = serde_json::to_value(list).unwrap();
        assert!(json["items"][0]["state"].is_null(), "listed without GET");
    }

    #[test]
    fn flow_window_round_trips_and_defaults_to_one_hour() {
        for (window, text) in [
            (FlowWindow::FiveMinutes, "5m"),
            (FlowWindow::OneHour, "1h"),
            (FlowWindow::OneDay, "24h"),
        ] {
            assert_eq!(
                serde_json::to_string(&window).unwrap(),
                format!("\"{text}\"")
            );
            assert_eq!(
                serde_json::from_str::<FlowWindow>(&format!("\"{text}\"")).unwrap(),
                window
            );
            assert_eq!(window.range(), text);
        }
        assert!(serde_json::from_str::<FlowWindow>("\"2h\"").is_err());
        let query: FlowQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(query.window, None);
        assert_eq!(query.window.unwrap_or_default(), FlowWindow::OneHour);
    }

    #[test]
    fn fleet_settings_need_both_keys_and_refuse_unknown_ones() {
        let empty = r#"{"restricted_components":[],"target_version":null}"#;
        let decoded: FleetSettings = serde_json::from_str(empty).unwrap();
        assert_eq!(decoded, FleetSettings::default());
        assert_eq!(serde_json::to_string(&decoded).unwrap(), empty);
        assert_eq!(
            serde_json::to_string(&FleetSettings::default()).unwrap(),
            empty
        );
        let set: FleetSettings = serde_json::from_str(
            r#"{"restricted_components":["debug"],"target_version":"0.170.0"}"#,
        )
        .unwrap();
        assert_eq!(set.target_version.as_deref(), Some("0.170.0"));

        let missing =
            serde_json::from_str::<FleetSettings>(r#"{"restricted_components":[]}"#).unwrap_err();
        assert!(missing.to_string().contains("target_version"), "{missing}");
        let unknown = serde_json::from_str::<FleetSettings>(
            r#"{"restricted_components":[],"target_version":null,"show_drift":true}"#,
        )
        .unwrap_err();
        assert!(unknown.to_string().contains("show_drift"), "{unknown}");
    }
}
