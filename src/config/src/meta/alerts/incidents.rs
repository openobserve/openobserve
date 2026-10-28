// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::rca_steering::SteerKind;

/// Incident status lifecycle: Open → Acknowledged → Resolved
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum IncidentStatus {
    #[default]
    Open,
    Acknowledged,
    Resolved,
}

impl std::fmt::Display for IncidentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Open => write!(f, "open"),
            Self::Acknowledged => write!(f, "acknowledged"),
            Self::Resolved => write!(f, "resolved"),
        }
    }
}

impl std::str::FromStr for IncidentStatus {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "open" => Ok(Self::Open),
            "acknowledged" => Ok(Self::Acknowledged),
            "resolved" => Ok(Self::Resolved),
            _ => Err("invalid incident status"),
        }
    }
}

/// Incident severity levels (P1 = highest priority)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
pub enum IncidentSeverity {
    P1,
    P2,
    #[default]
    P3,
    P4,
}

impl std::fmt::Display for IncidentSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::P1 => write!(f, "P1"),
            Self::P2 => write!(f, "P2"),
            Self::P3 => write!(f, "P3"),
            Self::P4 => write!(f, "P4"),
        }
    }
}

impl std::str::FromStr for IncidentSeverity {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_uppercase().as_str() {
            "P1" => Ok(Self::P1),
            "P2" => Ok(Self::P2),
            "P3" => Ok(Self::P3),
            "P4" => Ok(Self::P4),
            _ => Err("invalid incident severity"),
        }
    }
}

/// How an alert was correlated to an incident
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CorrelationReason {
    /// Correlation key from Service Discovery
    ServiceDiscovery,
    /// Correlated by matching primary dimensions (cluster, region, namespace)
    PrimaryMatch,
    /// Correlated by matching secondary dimensions (service, deployment)
    SecondaryMatch,
    /// Fallback: no dimensions found, isolated by alert ID
    AlertId,
}

impl std::fmt::Display for CorrelationReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ServiceDiscovery => write!(f, "service_discovery"),
            Self::PrimaryMatch => write!(f, "primary_match"),
            Self::SecondaryMatch => write!(f, "secondary_match"),
            Self::AlertId => write!(f, "alert_id"),
        }
    }
}

impl std::str::FromStr for CorrelationReason {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_lowercase().as_str() {
            "service_discovery" => Ok(Self::ServiceDiscovery),
            "primary_match" => Ok(Self::PrimaryMatch),
            "secondary_match" => Ok(Self::SecondaryMatch),
            "alert_id" => Ok(Self::AlertId),
            unmatched => Err(format!("'{unmatched}' is not a valid CorrelationReason")),
        }
    }
}

/// Classification of correlation key strength for hierarchical upgrade logic
///
/// Hierarchy: AlertId (weakest) → Secondary → Primary (strongest)
/// Upgrades only move UP the hierarchy, never down.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Serialize, Deserialize, ToSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum KeyType {
    /// Weakest: No stable dimensions found, isolated by alert ID
    #[default]
    AlertId,
    Secondary,
    Primary,
}

impl KeyType {
    pub fn from_stored(s: &str) -> Self {
        match s {
            "Primary" => Self::Primary,
            "Secondary" => Self::Secondary,
            _ => Self::AlertId,
        }
    }

    pub const fn can_upgrade_to(&self, target: Self) -> bool {
        matches!(
            (self, target),
            (Self::AlertId, Self::Secondary | Self::Primary)
                | (Self::Secondary, Self::Primary | Self::Secondary)
                | (Self::Primary, Self::Primary)
        )
    }
}

impl std::fmt::Display for KeyType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlertId => write!(f, "AlertId"),
            Self::Secondary => write!(f, "Secondary"),
            Self::Primary => write!(f, "Primary"),
        }
    }
}

/// Dimension relationship for Venn diagram subset/superset matching
///
/// Used to determine if an incoming alert's dimensions are compatible
/// with an existing incident's dimensions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DimensionRelationship {
    /// New alert has MORE specific dimensions (superset)
    /// Example: existing={ns:prod}, new={ns:prod, cluster:us-east}
    /// Action: UPGRADE incident dimensions
    NewIsSuperset,

    /// New alert has LESS specific dimensions (subset)
    /// Example: existing={ns:prod, cluster:us-east}, new={ns:prod}
    /// Action: ADD alert, keep existing dimensions
    NewIsSubset,

    /// Same dimensions (all keys and values match)
    /// Example: existing={ns:prod}, new={ns:prod}
    /// Action: ADD alert to incident
    Equal,

    /// Some dimensions match, some don't (ambiguous)
    /// Example: existing={ns:prod, db:postgres}, new={ns:prod, db:redis}
    /// Action: CREATE separate incident
    PartialOverlap,

    /// Same keys but DIFFERENT values (conflicting)
    /// Example: existing={region:us-east}, new={region:us-west}
    /// Action: CREATE separate incident (incompatible)
    Incompatible,
}

impl DimensionRelationship {
    pub fn check(
        existing_dims: &HashMap<String, String>,
        new_dims: &HashMap<String, String>,
    ) -> Self {
        if existing_dims.is_empty() && new_dims.is_empty() {
            return Self::Equal;
        }
        if new_dims.is_empty() {
            return Self::PartialOverlap;
        }
        if existing_dims.is_empty() {
            return Self::NewIsSuperset;
        }

        for (key, existing_value) in existing_dims {
            if let Some(new_value) = new_dims.get(key)
                && new_value != existing_value
            {
                return Self::Incompatible;
            }
        }

        let all_existing_in_new = existing_dims
            .iter()
            .all(|(k, v)| new_dims.get(k) == Some(v));
        if all_existing_in_new {
            return if new_dims.len() > existing_dims.len() {
                Self::NewIsSuperset
            } else {
                Self::Equal
            };
        }

        let all_new_in_existing = new_dims
            .iter()
            .all(|(k, v)| existing_dims.get(k) == Some(v));
        if all_new_in_existing {
            return Self::NewIsSubset;
        }

        Self::PartialOverlap
    }
}

/// Alert flow graph showing how alerts cascaded across services over time
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct IncidentTopology {
    /// Alert nodes - each unique (service, alert) pair
    pub nodes: Vec<AlertNode>,
    /// Edges showing temporal and service dependency relationships
    pub edges: Vec<AlertEdge>,
    /// Related incident IDs (for cross-incident correlation)
    pub related_incident_ids: Vec<String>,
}

/// Node in the alert flow graph
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AlertNode {
    /// Unique alert identifier (from alert definition)
    pub alert_id: String,
    /// Human-readable alert name for display
    pub alert_name: String,
    /// Service name (may be "unknown")
    pub service_name: String,
    /// Number of times this alert fired
    pub alert_count: u32,
    /// Timestamp of first occurrence (microseconds)
    pub first_fired_at: i64,
    /// Timestamp of last occurrence (microseconds)
    pub last_fired_at: i64,
}

/// Edge in the alert flow graph
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AlertEdge {
    /// Source node index
    pub from_node_index: usize,
    /// Target node index
    pub to_node_index: usize,
    /// Type of relationship
    pub edge_type: EdgeType,
}

/// Type of relationship between alert nodes
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    /// Same service, chronological progression
    Temporal,
    /// Different services, dependency from Service Graph
    ServiceDependency,
}

/// Main incident entity - a group of correlated alerts
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Incident {
    /// KSUID (27 chars)
    pub id: String,
    pub org_id: String,

    pub status: IncidentStatus,
    pub severity: IncidentSeverity,

    /// Timestamps in microseconds
    pub first_alert_at: i64,
    pub last_alert_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<i64>,

    pub alert_count: i32,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acknowledged_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acknowledged_at: Option<i64>,

    pub created_at: i64,
    pub updated_at: i64,

    #[serde(default)]
    pub group_values: serde_json::Value,
    #[serde(default)]
    pub key_type: KeyType,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub topology_context: Option<IncidentTopology>,

    /// Set while a downtime mutes this incident (D3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muted_by_downtime_id: Option<String>,

    /// Latest run summary, `null` when never analyzed; the detail response fills its detail
    /// fields.
    #[serde(default)]
    pub rca: Option<super::rca_runs::RcaSummary>,
    /// Why automatic analysis runs never start for this incident (`l0_off`).
    #[serde(default)]
    pub rca_off_reason: Option<String>,

    /// Every alert that fired into the incident and how often, most-fired first; list only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alert_groups: Option<Vec<IncidentAlertGroup>>,
}

/// One alert's firings within an incident, for the list row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct IncidentAlertGroup {
    pub alert_id: String,
    pub alert_name: String,
    /// Times this alert fired into the incident
    pub count: i32,
}

/// Alert info within an incident (junction table representation)
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct IncidentAlert {
    pub incident_id: String,
    pub alert_id: String,
    pub alert_name: String,
    #[serde(default)]
    pub alert_kind: AlertKind,
    pub alert_fired_at: i64,
    pub correlation_reason: CorrelationReason,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<std::collections::HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected_source: Option<String>,
}

/// A composite alert's light summary, for the incident's live-definition list.
/// Composites have no `alerts` row, so they cannot be a [`super::alert::Alert`];
/// this carries the fields the topology/detail surface needs.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CompositeAlertSummary {
    pub id: String,
    pub name: String,
    pub alert_type: String,
    pub enabled: bool,
    pub folder_id: String,
}

/// Incident with its alerts (for detail view)
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct IncidentWithAlerts {
    #[serde(flatten)]
    pub incident: Incident,
    /// Alert triggers (each alert firing is a separate trigger)
    pub triggers: Vec<IncidentAlert>,
    /// Unique alerts with full details
    pub alerts: Vec<super::alert::Alert>,
    /// Live composite definitions for incident members (`alert_type="composite"`).
    #[serde(default)]
    pub composite_alerts: Vec<CompositeAlertSummary>,
}

/// Outcome of correlating an alert to an incident.
///
/// Used by the scheduler to decide whether and how to send a notification
/// when an alert with `creates_incident=true` fires.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IncidentCorrelationOutcome {
    /// A brand new incident was created for this alert firing.
    /// Notification should be sent.
    NewIncidentCreated {
        incident_id: String,
        service_name: String,
    },
    /// This alert type appeared in an existing incident for the first time.
    /// Notification should be sent.
    NewAlertTypeJoined {
        incident_id: String,
        service_name: String,
    },
    /// This alert type already existed in the incident — repeated firing.
    /// Notification should be suppressed.
    ExistingAlertRepeated {
        incident_id: String,
        service_name: String,
    },
    /// The alert re-fired at a HIGHER severity than the incident currently
    /// carries (Warning→Critical, T-8). The incident's severity was upgraded
    /// and a notification must be sent — an escalation is never a repeat.
    SeverityEscalated {
        incident_id: String,
        service_name: String,
    },
}

impl IncidentCorrelationOutcome {
    pub fn incident_id(&self) -> &str {
        match self {
            Self::NewIncidentCreated { incident_id, .. }
            | Self::NewAlertTypeJoined { incident_id, .. }
            | Self::ExistingAlertRepeated { incident_id, .. }
            | Self::SeverityEscalated { incident_id, .. } => incident_id,
        }
    }

    pub fn service_name(&self) -> &str {
        match self {
            Self::NewIncidentCreated { service_name, .. }
            | Self::NewAlertTypeJoined { service_name, .. }
            | Self::ExistingAlertRepeated { service_name, .. }
            | Self::SeverityEscalated { service_name, .. } => service_name,
        }
    }
}

/// Whether an incident's member alert is an OpenObserve alert or an
/// externally-ingested one (External Alert Sources feature).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AlertKind {
    #[default]
    Internal,
    External,
}

impl AlertKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AlertKind::Internal => "internal",
            AlertKind::External => "external",
        }
    }

    pub fn from_stored(s: &str) -> Self {
        match s {
            "external" => AlertKind::External,
            _ => AlertKind::Internal,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExternalAlertStatus {
    #[default]
    Firing,
    Resolved,
}

/// One normalized alert event from an external source (Grafana, Alertmanager,
/// generic JSON). Produced by the normalizers, consumed by persistence +
/// correlation. Self-contained: `raw` keeps the per-alert slice of the
/// original payload.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ExternalAlertEvent {
    pub status: ExternalAlertStatus,
    pub dedup_key: String,
    pub title: String,
    pub severity: IncidentSeverity,
    pub labels: HashMap<String, String>,
    /// Source event time (startsAt/endsAt) in epoch micros — NOT receipt time.
    pub event_ts: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default)]
    pub raw: serde_json::Value,
}

/// Built-in default severity mapping (spec §4.9: "no JSON for humans").
/// critical→P1, error/major→P2, warning/minor→P3, info→P4, P1..P4 passthrough,
/// anything else → P3.
pub fn map_external_severity(s: &str) -> IncidentSeverity {
    match s.to_ascii_lowercase().as_str() {
        "critical" | "crit" | "fatal" | "p1" => IncidentSeverity::P1,
        "error" | "major" | "high" | "p2" => IncidentSeverity::P2,
        "warning" | "warn" | "minor" | "p3" => IncidentSeverity::P3,
        "info" | "low" | "ok" | "p4" => IncidentSeverity::P4,
        _ => IncidentSeverity::P3,
    }
}

/// Statistics for incidents dashboard
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct IncidentStats {
    pub total_incidents: i64,
    pub open_incidents: i64,
    pub acknowledged_incidents: i64,
    pub resolved_incidents: i64,
    pub by_severity: HashMap<String, i64>,
    pub by_service: HashMap<String, i64>,
    /// Mean time to resolve in minutes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mttr_minutes: Option<f64>,
    /// Average alerts per incident
    pub alerts_per_incident_avg: f64,
}

// ==================== INCIDENT EVENTS ====================

/// Classification of how AI/RCA analysis was triggered
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisTriggerType {
    /// Triggered automatically when new incident is created
    AutomaticNewIncident,
    /// Triggered automatically when alert is added to existing incident
    AutomaticReanalysis,
    /// Triggered manually by user via API
    Manual,
    /// Triggered automatically when incident is reopened
    AutomaticReopened,
}

impl std::fmt::Display for AnalysisTriggerType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AutomaticNewIncident => write!(f, "automatic_new_incident"),
            Self::AutomaticReanalysis => write!(f, "automatic_reanalysis"),
            Self::Manual => write!(f, "manual"),
            Self::AutomaticReopened => write!(f, "automatic_reopened"),
        }
    }
}

/// A single event in an incident's lifecycle timeline
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct IncidentEvent {
    /// Microseconds since epoch
    pub timestamp: i64,
    /// What happened
    #[serde(flatten)]
    pub event_type: IncidentEventType,
}

/// Tagged enum of all possible incident event types
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", content = "data")]
pub enum IncidentEventType {
    /// Incident was created
    Created,

    /// Alert correlated to this incident.
    /// Compacted: same alert_id increments count instead of appending new event.
    Alert {
        alert_id: String,
        alert_name: String,
        count: u32,
        first_at: i64,
        last_at: i64,
    },

    /// Severity escalated automatically
    SeverityUpgrade {
        from: IncidentSeverity,
        to: IncidentSeverity,
        reason: String,
    },

    /// Severity changed manually by user (any direction)
    SeverityOverride {
        from: IncidentSeverity,
        to: IncidentSeverity,
        user_id: String,
    },

    /// Status changed to Acknowledged
    Acknowledged {
        user_id: String,
    },

    /// Status changed to Resolved
    Resolved {
        /// None = auto-resolved by background job
        user_id: Option<String>,
    },

    /// Resolved incident reopened
    Reopened {
        user_id: String,
        reason: String,
    },

    DimensionsUpgraded {
        from_key: String,
        to_key: String,
    },

    /// Incident title edited by user
    TitleChanged {
        from: String,
        to: String,
        user_id: String,
    },

    /// Incident assigned/unassigned
    /// TODO: service-layer emission is not yet implemented; wired up on the frontend.
    AssignmentChanged {
        from: Option<String>,
        to: Option<String>,
    },

    /// User comment
    Comment {
        user_id: String,
        comment: String,
    },

    /// AI/RCA analysis started
    #[serde(rename = "ai_analysis_begin")]
    AIAnalysisBegin,

    /// AI/RCA analysis completed
    #[serde(rename = "ai_analysis_complete")]
    AIAnalysisComplete,

    /// AI/RCA analysis failed
    #[serde(rename = "ai_analysis_failed")]
    AIAnalysisFailed {
        /// Reason for the failure
        reason: String,
        /// Context in which the analysis was triggered
        trigger_type: AnalysisTriggerType,
        /// Optional error details for debugging
        error_details: Option<String>,
    },

    /// AI/RCA analysis cancelled by a user.
    /// Terminal, like Complete/Failed: clears the in-flight guard immediately so a
    /// retry can start without waiting for the stale threshold.
    #[serde(rename = "ai_analysis_cancelled")]
    AIAnalysisCancelled {
        /// User who cancelled the run. `None` when cancelled by the system.
        user_id: Option<String>,
    },

    /// A responder's steering message reached the live run. Never starts a reanalysis.
    #[serde(rename = "ai_analysis_steered")]
    AiAnalysisSteered {
        run_id: String,
        /// `stg_` + KSUID.
        steer_id: String,
        /// The responder who sent the message.
        user_id: String,
        /// `message` | `answer` | `hypothesis_action` | `guidance`.
        kind: String,
    },

    /// The run asked the responders a question and paused. Never starts a reanalysis.
    #[serde(rename = "ai_analysis_needs_input")]
    AiAnalysisNeedsInput {
        run_id: String,
        /// `callID` of the `ask_responders` call.
        question_id: String,
        need: String,
        question: String,
        /// Answer deadline, µs.
        deadline_at: i64,
    },

    /// Forward-compatibility catch-all for event types this binary does not know.
    ///
    /// During a rolling deploy an old node reads rows written by a newer node. Without
    /// this variant a single unrecognized `type` tag fails the whole `Vec<IncidentEvent>`
    /// parse; combined with `unwrap_or_default()` on the read path that silently yields an
    /// empty timeline, which the next `append` then writes back — destroying every prior
    /// event. Capturing unknown events verbatim keeps them intact across the round-trip.
    ///
    /// CAUTION: this variant absorbs MORE than genuinely-unknown event types. Because
    /// serde falls back to it whenever the tagged variants fail, a *known* tag carrying a
    /// malformed payload (e.g. `{"type":"Comment","data":{"user_id":5}}` — `user_id` must
    /// be a string) also lands here rather than raising a decode error. Preserving the row
    /// is still the right trade, but it means an unknown-variant count is NOT a schema-drift
    /// alarm on its own. Use [`IncidentEventType::is_known_tag`] to tell the two apart.
    ///
    /// Must stay LAST: `#[serde(untagged)]` variants are only tried after all tagged ones.
    #[serde(untagged)]
    Unknown(serde_json::Value),
}

impl IncidentEventType {
    /// Every `type` tag this binary can decode, in serialized form.
    ///
    /// Kept next to the enum so a new variant that omits its tag here is easy to spot in
    /// review; `test_known_tags_matches_variants` fails if the two drift apart.
    pub const KNOWN_TAGS: &'static [&'static str] = &[
        "Created",
        "Alert",
        "SeverityUpgrade",
        "SeverityOverride",
        "Acknowledged",
        "Resolved",
        "Reopened",
        "DimensionsUpgraded",
        "TitleChanged",
        "AssignmentChanged",
        "Comment",
        "ai_analysis_begin",
        "ai_analysis_complete",
        "ai_analysis_failed",
        "ai_analysis_cancelled",
        "ai_analysis_steered",
        "ai_analysis_needs_input",
    ];

    /// True when `raw` carries a `type` tag this binary recognizes.
    ///
    /// Distinguishes the two populations that both decode to [`Self::Unknown`]:
    /// a tag from a newer node (benign, expected during a rolling deploy) versus a known
    /// tag whose payload failed to parse (a real schema bug worth alerting on).
    pub fn is_known_tag(raw: &serde_json::Value) -> bool {
        raw.get("type")
            .and_then(|t| t.as_str())
            .is_some_and(|tag| Self::KNOWN_TAGS.contains(&tag))
    }
}

impl IncidentEvent {
    fn now(event_type: IncidentEventType) -> Self {
        Self {
            timestamp: chrono::Utc::now().timestamp_micros(),
            event_type,
        }
    }

    pub fn created() -> Self {
        Self::now(IncidentEventType::Created)
    }

    pub fn alert(
        alert_id: impl Into<String>,
        alert_name: impl Into<String>,
        triggered_at: i64,
    ) -> Self {
        Self::now(IncidentEventType::Alert {
            alert_id: alert_id.into(),
            alert_name: alert_name.into(),
            count: 1,
            first_at: triggered_at,
            last_at: triggered_at,
        })
    }

    pub fn severity_upgrade(
        from: IncidentSeverity,
        to: IncidentSeverity,
        reason: impl Into<String>,
    ) -> Self {
        Self::now(IncidentEventType::SeverityUpgrade {
            from,
            to,
            reason: reason.into(),
        })
    }

    pub fn severity_override(
        from: IncidentSeverity,
        to: IncidentSeverity,
        user_id: impl Into<String>,
    ) -> Self {
        Self::now(IncidentEventType::SeverityOverride {
            from,
            to,
            user_id: user_id.into(),
        })
    }

    pub fn acknowledged(user_id: impl Into<String>) -> Self {
        Self::now(IncidentEventType::Acknowledged {
            user_id: user_id.into(),
        })
    }

    pub fn resolved(user_id: Option<String>) -> Self {
        Self::now(IncidentEventType::Resolved { user_id })
    }

    pub fn reopened(user_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::now(IncidentEventType::Reopened {
            user_id: user_id.into(),
            reason: reason.into(),
        })
    }

    pub fn dimensions_upgraded(from_key: impl Into<String>, to_key: impl Into<String>) -> Self {
        Self::now(IncidentEventType::DimensionsUpgraded {
            from_key: from_key.into(),
            to_key: to_key.into(),
        })
    }

    pub fn title_changed(
        from: impl Into<String>,
        to: impl Into<String>,
        user_id: impl Into<String>,
    ) -> Self {
        Self::now(IncidentEventType::TitleChanged {
            from: from.into(),
            to: to.into(),
            user_id: user_id.into(),
        })
    }

    pub fn comment(user_id: impl Into<String>, comment: impl Into<String>) -> Self {
        Self::now(IncidentEventType::Comment {
            user_id: user_id.into(),
            comment: comment.into(),
        })
    }

    pub fn ai_analysis_begin() -> Self {
        Self::now(IncidentEventType::AIAnalysisBegin)
    }

    pub fn ai_analysis_complete() -> Self {
        Self::now(IncidentEventType::AIAnalysisComplete)
    }

    pub fn ai_analysis_failed(
        reason: impl Into<String>,
        trigger_type: AnalysisTriggerType,
        error_details: Option<String>,
    ) -> Self {
        Self::now(IncidentEventType::AIAnalysisFailed {
            reason: reason.into(),
            trigger_type,
            error_details,
        })
    }

    pub fn ai_analysis_cancelled(user_id: Option<String>) -> Self {
        Self::now(IncidentEventType::AIAnalysisCancelled { user_id })
    }

    pub fn ai_analysis_steered(
        run_id: impl Into<String>,
        steer_id: impl Into<String>,
        user_id: impl Into<String>,
        kind: SteerKind,
    ) -> Self {
        Self::now(IncidentEventType::AiAnalysisSteered {
            run_id: run_id.into(),
            steer_id: steer_id.into(),
            user_id: user_id.into(),
            kind: kind.as_str().to_string(),
        })
    }

    pub fn ai_analysis_needs_input(
        run_id: impl Into<String>,
        question_id: impl Into<String>,
        need: impl Into<String>,
        question: impl Into<String>,
        deadline_at: i64,
    ) -> Self {
        Self::now(IncidentEventType::AiAnalysisNeedsInput {
            run_id: run_id.into(),
            question_id: question_id.into(),
            need: need.into(),
            question: question.into(),
            deadline_at,
        })
    }

    /// Increment alert count if this is an Alert event for the given alert_id.
    /// No-op if not an Alert or different alert_id.
    pub fn increment_alert(&mut self, alert_id: &str, triggered_at: i64) -> bool {
        if let IncidentEventType::Alert {
            alert_id: id,
            count,
            last_at,
            ..
        } = &mut self.event_type
            && id == alert_id
        {
            *count += 1;
            *last_at = triggered_at;
            self.timestamp = chrono::Utc::now().timestamp_micros();
            return true;
        }

        false
    }

    /// Check if this event is any Alert event (regardless of alert_id)
    pub fn is_alert(&self) -> bool {
        matches!(&self.event_type, IncidentEventType::Alert { .. })
    }

    /// Check if this event is an Alert for the given alert_id
    pub fn is_alert_for(&self, alert_id: &str) -> bool {
        matches!(
            &self.event_type,
            IncidentEventType::Alert { alert_id: id, .. } if id == alert_id
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Without the `Unknown` catch-all one unrecognized tag would wipe the whole timeline.
    #[test]
    fn test_unknown_event_type_preserves_timeline() {
        let stored = serde_json::json!([
            {"timestamp": 1, "type": "Created"},
            {"timestamp": 2, "type": "some_future_event", "data": {"foo": "bar"}},
            {"timestamp": 3, "type": "ai_analysis_complete"},
        ]);

        let events: Vec<IncidentEvent> = serde_json::from_value(stored.clone()).unwrap();
        assert_eq!(events.len(), 3, "unknown tag must not discard other events");
        assert!(matches!(
            events[1].event_type,
            IncidentEventType::Unknown(_)
        ));

        // An old node rewriting the row must not strip data a newer node depends on.
        let rewritten = serde_json::to_value(&events).unwrap();
        assert_eq!(rewritten, stored, "unknown events must round-trip verbatim");
    }

    /// `Unknown` also absorbs malformed known tags; `is_known_tag` tells drift from forward-compat.
    #[test]
    fn test_malformed_known_event_is_absorbed_but_detectable() {
        // `user_id` must be a string; a number makes the tagged variant fail to decode.
        let raw = serde_json::json!({
            "timestamp": 9,
            "type": "Comment",
            "data": {"user_id": 5, "comment": "hi"},
        });

        let event: IncidentEvent = serde_json::from_value(raw).unwrap();
        let IncidentEventType::Unknown(inner) = &event.event_type else {
            panic!("malformed known event should fall through to Unknown");
        };
        assert!(
            IncidentEventType::is_known_tag(inner),
            "known tag must be detectable inside Unknown"
        );

        let future = serde_json::json!({"timestamp": 1, "type": "some_future_event"});
        let future_event: IncidentEvent = serde_json::from_value(future).unwrap();
        let IncidentEventType::Unknown(future_inner) = &future_event.event_type else {
            panic!("unknown type should decode to Unknown");
        };
        assert!(!IncidentEventType::is_known_tag(future_inner));
    }

    /// Guards the hand-maintained `KNOWN_TAGS` list and that no known variant decodes as `Unknown`.
    #[test]
    fn test_known_tags_matches_variants() {
        let variants = vec![
            IncidentEventType::Created,
            IncidentEventType::Alert {
                alert_id: "a".into(),
                alert_name: "n".into(),
                count: 1,
                first_at: 1,
                last_at: 1,
            },
            IncidentEventType::SeverityUpgrade {
                from: IncidentSeverity::P3,
                to: IncidentSeverity::P1,
                reason: "r".into(),
            },
            IncidentEventType::SeverityOverride {
                from: IncidentSeverity::P3,
                to: IncidentSeverity::P1,
                user_id: "u".into(),
            },
            IncidentEventType::Acknowledged {
                user_id: "u".into(),
            },
            IncidentEventType::Resolved { user_id: None },
            IncidentEventType::Reopened {
                user_id: "u".into(),
                reason: "r".into(),
            },
            IncidentEventType::DimensionsUpgraded {
                from_key: "a".into(),
                to_key: "b".into(),
            },
            IncidentEventType::TitleChanged {
                from: "a".into(),
                to: "b".into(),
                user_id: "u".into(),
            },
            IncidentEventType::AssignmentChanged {
                from: None,
                to: None,
            },
            IncidentEventType::Comment {
                user_id: "u".into(),
                comment: "c".into(),
            },
            IncidentEventType::AIAnalysisBegin,
            IncidentEventType::AIAnalysisComplete,
            IncidentEventType::AIAnalysisFailed {
                reason: "r".into(),
                trigger_type: AnalysisTriggerType::Manual,
                error_details: None,
            },
            IncidentEventType::AIAnalysisCancelled {
                user_id: Some("bob".into()),
            },
            IncidentEventType::AiAnalysisSteered {
                run_id: "r".into(),
                steer_id: "s".into(),
                user_id: "u".into(),
                kind: "message".into(),
            },
            IncidentEventType::AiAnalysisNeedsInput {
                run_id: "r".into(),
                question_id: "q".into(),
                need: "n".into(),
                question: "?".into(),
                deadline_at: 1,
            },
        ];

        let mut actual: Vec<String> = Vec::new();
        for v in variants {
            let json = serde_json::to_value(IncidentEvent {
                timestamp: 1,
                event_type: v,
            })
            .unwrap();
            let back: IncidentEvent = serde_json::from_value(json.clone()).unwrap();
            assert!(
                !matches!(back.event_type, IncidentEventType::Unknown(_)),
                "{json} decoded as Unknown"
            );
            actual.push(json["type"].as_str().unwrap().to_string());
        }
        let mut expected: Vec<String> = IncidentEventType::KNOWN_TAGS
            .iter()
            .map(|s| s.to_string())
            .collect();
        actual.sort();
        expected.sort();
        assert_eq!(
            actual, expected,
            "KNOWN_TAGS is out of sync with the enum variants"
        );
    }

    #[test]
    fn test_display_from_str_round_trip_case_insensitive_and_rejects() {
        for s in [
            IncidentStatus::Open,
            IncidentStatus::Acknowledged,
            IncidentStatus::Resolved,
        ] {
            assert_eq!(s.to_string().parse::<IncidentStatus>(), Ok(s));
            assert_eq!(
                s.to_string().to_uppercase().parse::<IncidentStatus>(),
                Ok(s)
            );
        }
        for s in [
            IncidentSeverity::P1,
            IncidentSeverity::P2,
            IncidentSeverity::P3,
            IncidentSeverity::P4,
        ] {
            assert_eq!(s.to_string().parse::<IncidentSeverity>(), Ok(s));
            assert_eq!(
                s.to_string().to_lowercase().parse::<IncidentSeverity>(),
                Ok(s)
            );
        }
        for r in [
            CorrelationReason::ServiceDiscovery,
            CorrelationReason::PrimaryMatch,
            CorrelationReason::SecondaryMatch,
            CorrelationReason::AlertId,
        ] {
            assert_eq!(r.to_string().parse::<CorrelationReason>(), Ok(r));
            assert_eq!(
                r.to_string().to_uppercase().parse::<CorrelationReason>(),
                Ok(r)
            );
        }
        for bad in ["", "pending", "invalid"] {
            assert!(bad.parse::<IncidentStatus>().is_err(), "{bad}");
        }
        for bad in ["", "P0", "P5", "invalid"] {
            assert!(bad.parse::<IncidentSeverity>().is_err(), "{bad}");
        }
        assert!("bad_value".parse::<CorrelationReason>().is_err());
    }

    #[test]
    fn test_from_stored_round_trips_and_defaults_unknown() {
        for k in [KeyType::AlertId, KeyType::Secondary, KeyType::Primary] {
            assert_eq!(KeyType::from_stored(&k.to_string()), k);
        }
        assert_eq!(KeyType::from_stored("unknown"), KeyType::AlertId);
        for k in [AlertKind::Internal, AlertKind::External] {
            assert_eq!(AlertKind::from_stored(k.as_str()), k);
        }
        assert_eq!(AlertKind::from_stored("garbage"), AlertKind::Internal);
    }

    #[test]
    fn test_key_type_can_upgrade_to() {
        use KeyType::*;
        let cases = [
            (AlertId, AlertId, false),
            (AlertId, Secondary, true),
            (AlertId, Primary, true),
            (Secondary, AlertId, false),
            (Secondary, Secondary, true),
            (Secondary, Primary, true),
            (Primary, AlertId, false),
            (Primary, Secondary, false),
            (Primary, Primary, true),
        ];
        for (from, to, want) in cases {
            assert_eq!(from.can_upgrade_to(to), want, "{from} -> {to}");
        }
    }

    #[test]
    fn test_dimension_relationship_check() {
        use DimensionRelationship::*;
        let dims = |pairs: &[(&str, &str)]| -> HashMap<String, String> {
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect()
        };
        let ns = [("ns", "prod")];
        let ns_cluster = [("ns", "prod"), ("cluster", "us-east")];
        type Dims<'a> = &'a [(&'a str, &'a str)];
        let cases: [(Dims, Dims, DimensionRelationship); 9] = [
            (&ns, &ns_cluster, NewIsSuperset),
            (&ns_cluster, &ns, NewIsSubset),
            (&ns_cluster, &ns_cluster, Equal),
            (
                &[("region", "us-east")],
                &[("region", "us-west")],
                Incompatible,
            ),
            (
                &[("ns", "prod"), ("region", "us-east")],
                &[("ns", "prod"), ("region", "us-west")],
                Incompatible,
            ),
            (
                &[("ns", "prod"), ("db", "postgres")],
                &[("ns", "prod"), ("cache", "redis")],
                PartialOverlap,
            ),
            (&[], &ns, NewIsSuperset),
            // Dimensionless alerts must never join an incident that has dimensions.
            (&ns, &[], PartialOverlap),
            (&[], &[], Equal),
        ];
        for (existing, new, want) in cases {
            assert_eq!(
                DimensionRelationship::check(&dims(existing), &dims(new)),
                want,
                "{existing:?} vs {new:?}"
            );
        }
    }

    #[test]
    fn test_is_alert_and_is_alert_for() {
        let alert = IncidentEvent::alert("alert-abc", "High CPU", 1000);
        assert!(alert.is_alert());
        assert!(alert.is_alert_for("alert-abc"));
        assert!(!alert.is_alert_for("alert-xyz"));

        let created = IncidentEvent::created();
        assert!(!created.is_alert());
        assert!(!created.is_alert_for("alert-abc"));
    }

    #[test]
    fn test_increment_alert() {
        let mut event = IncidentEvent::alert("alert-1", "CPU spike", 1000);
        assert!(event.increment_alert("alert-1", 2000));
        assert!(event.increment_alert("alert-1", 3000));
        assert!(!event.increment_alert("alert-2", 4000));
        let IncidentEventType::Alert {
            count,
            first_at,
            last_at,
            ..
        } = event.event_type
        else {
            panic!("expected Alert variant");
        };
        assert_eq!((count, first_at, last_at), (3, 1000, 3000));

        assert!(!IncidentEvent::created().increment_alert("alert-1", 2000));
    }

    #[test]
    fn test_topology_with_pre_run_report_keys_decodes_without_owning_them() {
        // `update_topology` carries the pre-run report keys over; the struct never writes them.
        let json = r#"{"nodes":[],"edges":[],"related_incident_ids":[],
            "suggested_root_cause":"legacy report",
            "previous_analyses":[{"content":"older","archived_at":1}]}"#;
        let t: IncidentTopology = serde_json::from_str(json).unwrap();
        assert!(t.nodes.is_empty());
        let back = serde_json::to_value(&t).unwrap();
        assert!(back.get("suggested_root_cause").is_none());
        assert!(back.get("previous_analyses").is_none());
    }

    #[test]
    fn test_incident_alert_legacy_json_defaults_to_internal() {
        // Rows stored before external alert sources have no alert_kind or external fields.
        let legacy_json = serde_json::json!({
            "incident_id": "inc1",
            "alert_id": "alert1",
            "alert_name": "My Alert",
            "alert_fired_at": 1000,
            "correlation_reason": "alert_id",
            "created_at": 1000,
        });

        let alert: IncidentAlert = serde_json::from_value(legacy_json).unwrap();
        assert_eq!(alert.alert_kind, AlertKind::Internal);
        assert_eq!(alert.source_url, None);
        assert_eq!(alert.labels, None);
        assert_eq!(alert.detected_source, None);
    }

    #[test]
    fn test_map_external_severity() {
        let cases = [
            ("critical", IncidentSeverity::P1),
            ("CRITICAL", IncidentSeverity::P1),
            ("error", IncidentSeverity::P2),
            ("p2", IncidentSeverity::P2),
            ("warning", IncidentSeverity::P3),
            ("info", IncidentSeverity::P4),
            ("unknown-things", IncidentSeverity::P3),
        ];
        for (input, want) in cases {
            assert_eq!(map_external_severity(input), want, "{input}");
        }
    }
}
