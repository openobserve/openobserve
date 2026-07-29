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

impl TryFrom<&str> for CorrelationReason {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
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

/// A superseded RCA report, retained so users can read earlier analyses.
///
/// Archived by [`IncidentTopology::record_rca_result`] when a newer report replaces it.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ArchivedRcaReport {
    /// The full markdown report as it was generated
    pub content: String,
    /// Microseconds since epoch, stamped when the report was archived
    pub archived_at: i64,
}

/// Default number of superseded RCA reports to retain per incident.
/// Overridden by `O2_INCIDENTS_RCA_HISTORY_LIMIT`.
pub const DEFAULT_RCA_HISTORY_LIMIT: usize = 25;

/// Alert flow graph showing how alerts cascaded across services over time
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct IncidentTopology {
    /// Alert nodes - each unique (service, alert) pair
    pub nodes: Vec<AlertNode>,
    /// Edges showing temporal and service dependency relationships
    pub edges: Vec<AlertEdge>,
    /// Related incident IDs (for cross-incident correlation)
    pub related_incident_ids: Vec<String>,
    /// AI-generated root cause analysis (markdown) — the current report
    pub suggested_root_cause: Option<String>,
    /// Superseded reports, newest first. Bounded by the configured history limit so
    /// this JSON column cannot grow without limit across a long-lived incident.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub previous_analyses: Vec<ArchivedRcaReport>,
}

impl IncidentTopology {
    /// Install `content` as the current report, archiving whatever it replaces.
    ///
    /// The outgoing report is pushed to the front of `previous_analyses` (newest first)
    /// and the list is truncated to `history_limit`. A `history_limit` of 0 disables
    /// history entirely and clears any previously retained reports.
    pub fn record_rca_result(&mut self, content: impl Into<String>, history_limit: usize) {
        let content = content.into();

        if history_limit == 0 {
            self.previous_analyses.clear();
        } else if let Some(prev) = self.suggested_root_cause.take() {
            // Identical re-runs would otherwise fill the history with duplicates.
            if !prev.is_empty() && prev != content {
                self.previous_analyses.insert(
                    0,
                    ArchivedRcaReport {
                        content: prev,
                        archived_at: chrono::Utc::now().timestamp_micros(),
                    },
                );
                self.previous_analyses.truncate(history_limit);
            }
        }

        self.suggested_root_cause = Some(content);
    }
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

    pub created_at: i64,
    pub updated_at: i64,

    #[serde(default)]
    pub group_values: serde_json::Value,
    #[serde(default)]
    pub key_type: KeyType,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub topology_context: Option<IncidentTopology>,
}

/// Alert info within an incident (junction table representation)
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct IncidentAlert {
    pub incident_id: String,
    pub alert_id: String,
    pub alert_name: String,
    pub alert_fired_at: i64,
    pub correlation_reason: CorrelationReason,
    pub created_at: i64,
    /// Originating system for externally-ingested alerts; `None` for alerts
    /// evaluated by OpenObserve itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Deep link back into the originating system.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_url: Option<String>,
    /// Display-only annotations from the originating system.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotations: Option<HashMap<String, String>>,
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
}

/// Organization-level incident correlation configuration
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct IncidentCorrelationConfig {
    /// Enable incident correlation for this org
    #[serde(default)]
    pub enabled: bool,

    /// Time window for correlating alerts to same incident (minutes)
    #[serde(default = "default_time_window")]
    pub time_window_minutes: u64,

    /// Minimum alerts to create an incident
    #[serde(default = "default_min_alerts")]
    pub min_alerts_for_incident: u32,

    /// When to send notifications
    #[serde(default)]
    pub notification_strategy: NotificationStrategy,

    /// Enable Service Graph topology enrichment
    #[serde(default = "default_true")]
    pub use_service_graph: bool,

    /// Enable root cause inference
    #[serde(default = "default_true")]
    pub root_cause_detection: bool,

    /// Auto-resolve after N minutes of no new alerts (None = use global default, 0 = disabled)
    #[serde(default)]
    pub auto_resolve_after_minutes: Option<i64>,

    /// Time window for hierarchical incident upgrade (minutes)
    #[serde(default = "default_upgrade_window")]
    pub upgrade_window_minutes: u64,

    /// Default severity for new incidents
    #[serde(default)]
    pub default_severity: IncidentSeverity,
}

impl Default for IncidentCorrelationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            time_window_minutes: default_time_window(),
            min_alerts_for_incident: default_min_alerts(),
            notification_strategy: NotificationStrategy::default(),
            use_service_graph: true,
            root_cause_detection: true,
            auto_resolve_after_minutes: None,
            upgrade_window_minutes: default_upgrade_window(),
            default_severity: IncidentSeverity::default(),
        }
    }
}

/// Notification strategy for incidents
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotificationStrategy {
    /// Only notify when a new incident is created
    #[default]
    NewIncidentOnly,
    /// Notify on all updates (new alerts added, status changes)
    AllUpdates,
    /// No notifications
    None,
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
}

impl IncidentCorrelationOutcome {
    pub fn incident_id(&self) -> &str {
        match self {
            Self::NewIncidentCreated { incident_id, .. }
            | Self::NewAlertTypeJoined { incident_id, .. }
            | Self::ExistingAlertRepeated { incident_id, .. } => incident_id,
        }
    }

    pub fn service_name(&self) -> &str {
        match self {
            Self::NewIncidentCreated { service_name, .. }
            | Self::NewAlertTypeJoined { service_name, .. }
            | Self::ExistingAlertRepeated { service_name, .. } => service_name,
        }
    }
}

fn default_time_window() -> u64 {
    60
}

fn default_min_alerts() -> u32 {
    1
}

fn default_upgrade_window() -> u64 {
    30
}

fn default_true() -> bool {
    true
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

// ── External alert ingest ────────────────────────────────────────────────────
//
// Alerts pushed in by systems outside OpenObserve (Alertmanager, Datadog,
// Grafana, …). They never become rows in the `alerts` table; they are turned
// into a synthetic in-memory Alert and fed straight to the correlation engine,
// which groups on `labels` exactly as it does for native alerts.

/// Lifecycle state of an externally-ingested alert.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExternalAlertStatus {
    #[default]
    Firing,
    Resolved,
}

/// Maximum accepted label/annotation entries. Correlation only ever reads a
/// handful of identity dimensions, so a generous cap still leaves no way to
/// use the endpoint as unbounded storage.
pub const MAX_EXTERNAL_ALERT_LABELS: usize = 64;
/// Maximum accepted length of any single label key or value.
pub const MAX_EXTERNAL_ALERT_LABEL_LEN: usize = 1024;
/// Fixed KSUID timestamp prefix for synthetic external alert ids (2014-05-13).
/// External ids encode identity, not creation time — the prefix is constant so
/// the same rule always renders to the same id.
const EXTERNAL_ALERT_ID_EPOCH: i64 = 1_400_000_000;
/// 2000-01-01T00:00:00Z in microseconds. A `timestamp` below this is almost
/// certainly seconds or milliseconds sent by mistake.
const MIN_PLAUSIBLE_MICROS: i64 = 946_684_800_000_000;
/// 2100-01-01T00:00:00Z in microseconds. Above this, a bad value would pin
/// `last_alert_at` into the future and keep the incident from ever ageing out.
const MAX_PLAUSIBLE_MICROS: i64 = 4_102_444_800_000_000;

/// Payload accepted by `POST /api/v2/{org_id}/alerts/incidents/ingest`.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct ExternalAlertPayload {
    /// Originating system, e.g. "alertmanager". Namespaces the synthetic
    /// alert id so two systems' identically-named alerts stay distinct.
    #[schema(min_length = 1, max_length = 128, example = "alertmanager")]
    pub source: String,

    /// Name of the alert rule in the originating system. Together with
    /// `source` this forms the alert's stable identity — repeated deliveries
    /// of the same rule suppress notification, a different rule joining the
    /// incident escalates it.
    #[schema(min_length = 1, max_length = 512, example = "HighErrorRate")]
    pub alert_name: String,

    /// Idempotency key. Two deliveries carrying the same `dedup_key` are the
    /// same firing, not two firings.
    #[serde(default)]
    #[schema(max_length = 512)]
    pub dedup_key: Option<String>,

    /// Severity in the originating system's vocabulary — "critical", "P1",
    /// "warning", "error", … Mapped onto `IncidentSeverity`; unrecognised
    /// values fall back to the configured default.
    #[serde(default)]
    pub severity: Option<String>,

    /// Whether the alert is currently firing or has resolved upstream.
    #[serde(default)]
    pub status: ExternalAlertStatus,

    /// Firing time in epoch microseconds. Defaults to receipt time.
    ///
    /// Bounds are declared so generated clients and fuzzers see the same
    /// constraint the handler enforces — a seconds- or millisecond-precision
    /// value is rejected rather than silently ageing the incident out.
    #[serde(default)]
    #[schema(
        minimum = 946_684_800_000_000i64,
        maximum = 4_102_444_800_000_000i64,
        example = 1_753_612_800_000_000i64
    )]
    pub timestamp: Option<i64>,

    /// Identity labels. This is the only part of the payload that drives
    /// correlation — an empty map means the alert cannot match anything and
    /// gets an incident to itself.
    #[serde(default)]
    pub labels: HashMap<String, String>,

    /// Display-only context (summary, runbook, description).
    #[serde(default)]
    pub annotations: HashMap<String, String>,

    /// Deep link back into the originating system. Must be `http` or `https` —
    /// the pattern is declared so the schema matches what `validate` enforces.
    #[serde(default)]
    #[schema(
        max_length = 2048,
        pattern = "^https?://",
        example = "https://alertmanager.example.com/#/alerts"
    )]
    pub external_url: Option<String>,
}

impl ExternalAlertPayload {
    /// Reject payloads that cannot correlate or that abuse the endpoint.
    ///
    /// Note that an empty `labels` map is explicitly *allowed* — such an alert
    /// is isolated into its own incident, which is the documented behaviour
    /// for an alert with no matching attributes.
    pub fn validate(&self) -> Result<(), String> {
        if self.source.trim().is_empty() {
            return Err("`source` must not be empty".to_string());
        }
        if self.source.len() > 128 {
            return Err("`source` must be 128 characters or fewer".to_string());
        }
        if self.alert_name.trim().is_empty() {
            return Err("`alert_name` must not be empty".to_string());
        }
        if self.alert_name.len() > 512 {
            return Err("`alert_name` must be 512 characters or fewer".to_string());
        }
        if self.labels.len() > MAX_EXTERNAL_ALERT_LABELS {
            return Err(format!(
                "`labels` must contain {MAX_EXTERNAL_ALERT_LABELS} entries or fewer"
            ));
        }
        if self.annotations.len() > MAX_EXTERNAL_ALERT_LABELS {
            return Err(format!(
                "`annotations` must contain {MAX_EXTERNAL_ALERT_LABELS} entries or fewer"
            ));
        }
        for (k, v) in self.labels.iter().chain(self.annotations.iter()) {
            if k.len() > MAX_EXTERNAL_ALERT_LABEL_LEN || v.len() > MAX_EXTERNAL_ALERT_LABEL_LEN {
                return Err(format!(
                    "label/annotation keys and values must be \
                     {MAX_EXTERNAL_ALERT_LABEL_LEN} characters or fewer (offending key: `{k}`)"
                ));
            }
        }
        if let Some(url) = &self.external_url {
            if url.len() > 2048 {
                return Err("`external_url` must be 2048 characters or fewer".to_string());
            }
            // Scheme allowlist, not a blocklist. This value is stored and handed
            // back to clients as a link to render, so a `javascript:` or `data:`
            // URL here is stored XSS waiting for whoever wires up the incident
            // detail view. Rejecting at the boundary keeps that trap unset.
            let lowered = url.trim().to_ascii_lowercase();
            if !(lowered.starts_with("http://") || lowered.starts_with("https://")) {
                return Err("`external_url` must be an http:// or https:// URL".to_string());
            }
        }
        if let Some(ts) = self.timestamp {
            // `timestamp` is microseconds. Senders routinely have seconds or
            // milliseconds to hand, and passing those silently is worse than
            // rejecting: a seconds value lands the incident in 1970, which the
            // auto-resolve sweep immediately treats as stale and closes, so the
            // alert vanishes rather than erroring. Bounds are constants rather
            // than clock-relative so validation stays pure and testable.
            if !(MIN_PLAUSIBLE_MICROS..=MAX_PLAUSIBLE_MICROS).contains(&ts) {
                return Err(format!(
                    "`timestamp` must be epoch microseconds between {MIN_PLAUSIBLE_MICROS} and \
                     {MAX_PLAUSIBLE_MICROS} (got {ts} — if this is seconds or milliseconds, \
                     multiply by 1_000_000 or 1_000)"
                ));
            }
        }
        Ok(())
    }

    /// Stable identity for this alert *rule* — not this firing.
    ///
    /// The correlation engine distinguishes "this alert type is already in the
    /// incident" (suppress) from "a new alert type joined" (notify) purely by
    /// alert id, so the id must be identical across every delivery of the same
    /// rule and different for every other rule. A hash of
    /// `org_id/source/alert_name` gives exactly that without a registry.
    ///
    /// The value is rendered as a KSUID so it is indistinguishable in shape
    /// from a native alert id: the 4-byte timestamp prefix is fixed (external
    /// ids carry no meaningful creation time) and the 16-byte payload is the
    /// hash.
    pub fn alert_id(&self, org_id: &str) -> String {
        external_alert_id(org_id, &self.source, &self.alert_name)
    }

    /// The idempotency key to deduplicate on, or `None` when the sender
    /// supplied none.
    ///
    /// A blank or whitespace-only key is treated as absent — it is a sender
    /// bug, and honouring it would collapse unrelated firings together.
    ///
    /// There is deliberately no fallback identity for keyless payloads.
    /// Without a key nothing distinguishes a retry from a genuine re-fire of
    /// the same rule, and silently swallowing the latter loses real signal.
    pub fn effective_dedup_key(&self) -> Option<&str> {
        self.dedup_key
            .as_deref()
            .map(str::trim)
            .filter(|k| !k.is_empty())
    }
}

/// What ingesting one external alert actually did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExternalIngestAction {
    /// No open incident matched, so a new one was opened. Notified.
    IncidentCreated,
    /// This alert type appeared in an existing incident for the first time —
    /// an escalation signal. Notified.
    AlertJoined,
    /// This alert type was already in the incident. Notification suppressed by
    /// design; `alert_count` still advanced.
    AlertRepeated,
    /// A delivery carrying an already-seen `dedup_key`. Nothing was written.
    DuplicateIgnored,
    /// The alert was marked resolved and the incident still has other alerts
    /// firing, so it stays open.
    AlertResolved,
    /// The alert was marked resolved and it was the last one firing, so the
    /// incident was resolved too.
    IncidentResolved,
    /// A resolve arrived for an alert with no open incident — the incident was
    /// already closed, or the alert was never ingested. Nothing was written.
    NothingToResolve,
}

/// Response body of the external alert ingest endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ExternalIngestResponse {
    /// What happened.
    pub action: ExternalIngestAction,
    /// The stable synthetic alert id this payload maps to. Deterministic from
    /// `(org, source, alert_name)`, so callers can correlate their own logs.
    pub alert_id: String,
    /// Incident this alert belongs to, when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incident_id: Option<String>,
    /// Why it correlated the way it did.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_reason: Option<CorrelationReason>,
}

/// Derive the stable synthetic alert id for an external alert rule.
///
/// Kept as a free function so the resolve path can rebuild the id from
/// `(source, alert_name)` without constructing a whole payload.
pub fn external_alert_id(org_id: &str, source: &str, alert_name: &str) -> String {
    use svix_ksuid::{Ksuid, KsuidLike};

    let digest = sha256::digest(format!("{org_id}\u{0}{source}\u{0}{alert_name}"));
    // `sha256::digest` returns lowercase hex; the first 32 chars are 16 bytes,
    // exactly the KSUID payload width.
    let mut payload = [0u8; 16];
    hex::decode_to_slice(&digest[..32], &mut payload)
        .expect("sha256 digest is valid hex of sufficient length");

    // Fixed epoch: an external id encodes identity, not creation time. Passing
    // `None` would stamp the current time and break stability outright.
    Ksuid::from_seconds(Some(EXTERNAL_ALERT_ID_EPOCH), Some(&payload)).to_string()
}

/// Map an external severity string onto an incident severity.
///
/// Accepts the vocabularies actually seen in the wild — Prometheus/Grafana
/// (`critical`/`warning`/`info`), PagerDuty-style (`P1`..`P4`), Datadog
/// (`error`), and bare numerics. Returns `None` when nothing matches, leaving
/// the caller's default in place rather than guessing.
pub fn map_external_severity(raw: &str) -> Option<IncidentSeverity> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "p1" | "1" | "critical" | "crit" | "fatal" | "emergency" | "disaster" => {
            Some(IncidentSeverity::P1)
        }
        "p2" | "2" | "error" | "high" | "major" => Some(IncidentSeverity::P2),
        "p3" | "3" | "warning" | "warn" | "medium" | "average" => Some(IncidentSeverity::P3),
        "p4" | "4" | "info" | "information" | "informational" | "low" | "minor" | "debug" => {
            Some(IncidentSeverity::P4)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A node that predates an event type must still recover the whole timeline.
    ///
    /// Without the `Unknown` catch-all the array parse fails on the first unrecognized
    /// tag, and callers that decode-then-write persist the truncated result — silently
    /// destroying every prior event during a rolling deploy.
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

        // The unknown event must survive a read/write cycle byte-for-byte, otherwise an
        // old node rewriting the row would strip data a newer node depends on.
        let rewritten = serde_json::to_value(&events).unwrap();
        assert_eq!(rewritten, stored, "unknown events must round-trip verbatim");
    }

    /// A known tag with a malformed payload is absorbed by `Unknown` rather than erroring.
    ///
    /// This is the wide net documented on the variant: it preserves the row, but it means
    /// an `Unknown` count alone cannot be read as "events from a newer node". `is_known_tag`
    /// is what separates the two, and the read path logs them at different levels.
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

        // The distinguishing signal: the tag is one we own, so this is schema drift, not
        // a forward-compatible event from a newer binary.
        assert!(
            IncidentEventType::is_known_tag(inner),
            "known tag must be detectable inside Unknown"
        );

        // A genuinely unknown type must NOT be flagged as drift.
        let future = serde_json::json!({"timestamp": 1, "type": "some_future_event"});
        let future_event: IncidentEvent = serde_json::from_value(future).unwrap();
        let IncidentEventType::Unknown(future_inner) = &future_event.event_type else {
            panic!("unknown type should decode to Unknown");
        };
        assert!(!IncidentEventType::is_known_tag(future_inner));
    }

    /// `KNOWN_TAGS` must list exactly the tags the enum actually serializes.
    ///
    /// Guards the hand-maintained list: a new variant whose tag is not added here would
    /// make its malformed payloads look like benign forward-compat events.
    #[test]
    fn test_known_tags_matches_variants() {
        // One representative value per variant; the payloads are irrelevant, only the tag.
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
            IncidentEventType::AIAnalysisCancelled { user_id: None },
        ];

        let mut actual: Vec<String> = variants
            .iter()
            .map(|v| {
                serde_json::to_value(v).unwrap()["type"]
                    .as_str()
                    .expect("every known variant serializes a string tag")
                    .to_string()
            })
            .collect();
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

    /// Known variants must still win over the untagged catch-all.
    #[test]
    fn test_known_event_types_not_captured_as_unknown() {
        let event = IncidentEvent {
            timestamp: 5,
            event_type: IncidentEventType::AIAnalysisCancelled {
                user_id: Some("bob".into()),
            },
        };
        let json = serde_json::to_value(&event).unwrap();
        let roundtrip: IncidentEvent = serde_json::from_value(json).unwrap();
        assert!(matches!(
            roundtrip.event_type,
            IncidentEventType::AIAnalysisCancelled { .. }
        ));
    }

    #[test]
    fn test_incident_event_serde_created() {
        let event = IncidentEvent {
            timestamp: 1000000,
            event_type: IncidentEventType::Created,
        };
        let json = serde_json::to_string(&event).unwrap();
        println!("Created: {json}");
        let roundtrip: IncidentEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(roundtrip.timestamp, 1000000);
    }

    #[test]
    fn test_incident_event_serde_alert() {
        let event = IncidentEvent {
            timestamp: 2000000,
            event_type: IncidentEventType::Alert {
                alert_id: "abc".into(),
                alert_name: "CPU High".into(),
                count: 5,
                first_at: 1000000,
                last_at: 2000000,
            },
        };
        let json = serde_json::to_string(&event).unwrap();
        println!("Alert: {json}");
        let roundtrip: IncidentEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(roundtrip.timestamp, 2000000);
    }

    #[test]
    fn test_incident_event_serde_ai_analysis() {
        let event = IncidentEvent::now(IncidentEventType::AIAnalysisBegin);
        let json = serde_json::to_string(&event).unwrap();
        println!("AIAnalysisBegin: {json}");
        assert!(json.contains("\"type\":\"ai_analysis_begin\""));

        let event2 = IncidentEvent::now(IncidentEventType::AIAnalysisComplete);
        let json2 = serde_json::to_string(&event2).unwrap();
        println!("AIAnalysisComplete: {json2}");
        assert!(json2.contains("\"type\":\"ai_analysis_complete\""));
    }

    #[test]
    fn test_incident_event_serde_comment() {
        let event = IncidentEvent {
            timestamp: 3000000,
            event_type: IncidentEventType::Comment {
                user_id: "user@test.com".into(),
                comment: "investigating".into(),
            },
        };
        let json = serde_json::to_string(&event).unwrap();
        println!("Comment: {json}");
        let roundtrip: IncidentEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(roundtrip.timestamp, 3000000);
    }

    #[test]
    fn test_incident_event_serde_title_changed() {
        let event = IncidentEvent {
            timestamp: 4000000,
            event_type: IncidentEventType::TitleChanged {
                from: "Old Title".into(),
                to: "New Title".into(),
                user_id: "user@test.com".into(),
            },
        };
        let json = serde_json::to_string(&event).unwrap();
        println!("TitleChanged: {json}");
        assert!(json.contains("\"type\":\"TitleChanged\""));
        assert!(json.contains("\"from\":\"Old Title\""));
        assert!(json.contains("\"to\":\"New Title\""));
        let roundtrip: IncidentEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(roundtrip.timestamp, 4000000);
        assert!(matches!(
            roundtrip.event_type,
            IncidentEventType::TitleChanged { ref from, ref to, .. }
            if from == "Old Title" && to == "New Title"
        ));
    }

    #[test]
    fn test_incident_status_roundtrip() {
        for status in [
            IncidentStatus::Open,
            IncidentStatus::Acknowledged,
            IncidentStatus::Resolved,
        ] {
            let s = status.to_string();
            let parsed: IncidentStatus = s.parse().unwrap();
            assert_eq!(status, parsed);
        }
    }

    #[test]
    fn test_incident_severity_roundtrip() {
        for severity in [
            IncidentSeverity::P1,
            IncidentSeverity::P2,
            IncidentSeverity::P3,
            IncidentSeverity::P4,
        ] {
            let s = severity.to_string();
            let parsed: IncidentSeverity = s.parse().unwrap();
            assert_eq!(severity, parsed);
        }
    }

    #[test]
    fn test_default_config() {
        let config = IncidentCorrelationConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.time_window_minutes, 60);
        assert_eq!(config.min_alerts_for_incident, 1);
        assert!(config.use_service_graph);
        assert!(config.root_cause_detection);
    }

    #[test]
    fn test_incident_status_from_str_case_insensitive() {
        assert_eq!(
            "OPEN".parse::<IncidentStatus>().unwrap(),
            IncidentStatus::Open
        );
        assert_eq!(
            "Open".parse::<IncidentStatus>().unwrap(),
            IncidentStatus::Open
        );
        assert_eq!(
            "open".parse::<IncidentStatus>().unwrap(),
            IncidentStatus::Open
        );
        assert_eq!(
            "ACKNOWLEDGED".parse::<IncidentStatus>().unwrap(),
            IncidentStatus::Acknowledged
        );
        assert_eq!(
            "resolved".parse::<IncidentStatus>().unwrap(),
            IncidentStatus::Resolved
        );
    }

    #[test]
    fn test_incident_status_from_str_invalid() {
        assert!("invalid".parse::<IncidentStatus>().is_err());
        assert!("".parse::<IncidentStatus>().is_err());
        assert!("pending".parse::<IncidentStatus>().is_err());
    }

    #[test]
    fn test_incident_severity_from_str_case_insensitive() {
        assert_eq!(
            "p1".parse::<IncidentSeverity>().unwrap(),
            IncidentSeverity::P1
        );
        assert_eq!(
            "P1".parse::<IncidentSeverity>().unwrap(),
            IncidentSeverity::P1
        );
        assert_eq!(
            "p2".parse::<IncidentSeverity>().unwrap(),
            IncidentSeverity::P2
        );
        assert_eq!(
            "P3".parse::<IncidentSeverity>().unwrap(),
            IncidentSeverity::P3
        );
        assert_eq!(
            "p4".parse::<IncidentSeverity>().unwrap(),
            IncidentSeverity::P4
        );
    }

    #[test]
    fn test_incident_severity_from_str_invalid() {
        assert!("P0".parse::<IncidentSeverity>().is_err());
        assert!("P5".parse::<IncidentSeverity>().is_err());
        assert!("invalid".parse::<IncidentSeverity>().is_err());
        assert!("".parse::<IncidentSeverity>().is_err());
    }

    #[test]
    fn test_incident_status_default() {
        let status = IncidentStatus::default();
        assert_eq!(status, IncidentStatus::Open);
    }

    #[test]
    fn test_incident_severity_default() {
        let severity = IncidentSeverity::default();
        assert_eq!(severity, IncidentSeverity::P3);
    }

    #[test]
    fn test_correlation_reason_display() {
        assert_eq!(
            CorrelationReason::ServiceDiscovery.to_string(),
            "service_discovery"
        );
        assert_eq!(CorrelationReason::PrimaryMatch.to_string(), "primary_match");
        assert_eq!(
            CorrelationReason::SecondaryMatch.to_string(),
            "secondary_match"
        );
    }

    #[test]
    fn test_incident_topology_default() {
        let topology = IncidentTopology::default();
        assert!(topology.nodes.is_empty());
        assert!(topology.edges.is_empty());
        assert!(topology.related_incident_ids.is_empty());
        assert!(topology.suggested_root_cause.is_none());
    }

    #[test]
    fn test_incident_status_equality() {
        assert_eq!(IncidentStatus::Open, IncidentStatus::Open);
        assert_ne!(IncidentStatus::Open, IncidentStatus::Acknowledged);
        assert_ne!(IncidentStatus::Acknowledged, IncidentStatus::Resolved);
    }

    #[test]
    fn test_incident_severity_ordering() {
        // Test that different severities are not equal
        assert_ne!(IncidentSeverity::P1, IncidentSeverity::P2);
        assert_ne!(IncidentSeverity::P2, IncidentSeverity::P3);
        assert_ne!(IncidentSeverity::P3, IncidentSeverity::P4);
    }

    #[test]
    fn test_correlation_reason_equality() {
        assert_eq!(
            CorrelationReason::ServiceDiscovery,
            CorrelationReason::ServiceDiscovery
        );
        assert_ne!(
            CorrelationReason::ServiceDiscovery,
            CorrelationReason::PrimaryMatch
        );
        assert_ne!(
            CorrelationReason::PrimaryMatch,
            CorrelationReason::SecondaryMatch
        );
    }

    #[test]
    fn test_incident_topology_with_alert_nodes() {
        let node1 = AlertNode {
            alert_id: "alert_cpu_high".to_string(),
            alert_name: "High CPU Usage".to_string(),
            service_name: "api-gateway".to_string(),
            alert_count: 2,
            first_fired_at: 1000,
            last_fired_at: 2000,
        };

        let node2 = AlertNode {
            alert_id: "alert_db_pool".to_string(),
            alert_name: "Connection Pool Exhausted".to_string(),
            service_name: "database".to_string(),
            alert_count: 1,
            first_fired_at: 1500,
            last_fired_at: 1500,
        };

        let edge = AlertEdge {
            from_node_index: 0,
            to_node_index: 1,
            edge_type: EdgeType::ServiceDependency,
        };

        let topology = IncidentTopology {
            nodes: vec![node1, node2],
            edges: vec![edge],
            related_incident_ids: vec!["incident-1".to_string()],
            suggested_root_cause: Some("High memory usage".to_string()),
            previous_analyses: vec![],
        };

        assert_eq!(topology.nodes.len(), 2);
        assert_eq!(topology.edges.len(), 1);
        assert_eq!(topology.nodes[0].alert_id, "alert_cpu_high");
        assert_eq!(topology.nodes[1].service_name, "database");
        assert_eq!(topology.related_incident_ids.len(), 1);
        assert!(topology.suggested_root_cause.is_some());
    }

    #[test]
    fn test_serde_incident_status() {
        // Test serialization to lowercase
        let status = IncidentStatus::Acknowledged;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"acknowledged\"");

        // Test deserialization from lowercase
        let deserialized: IncidentStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, IncidentStatus::Acknowledged);
    }

    #[test]
    fn test_serde_incident_severity() {
        let severity = IncidentSeverity::P1;
        let json = serde_json::to_string(&severity).unwrap();
        assert_eq!(json, "\"P1\"");

        let deserialized: IncidentSeverity = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, IncidentSeverity::P1);
    }

    #[test]
    fn test_serde_correlation_reason() {
        let reason = CorrelationReason::ServiceDiscovery;
        let json = serde_json::to_string(&reason).unwrap();
        assert_eq!(json, "\"service_discovery\"");

        let deserialized: CorrelationReason = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, CorrelationReason::ServiceDiscovery);
    }

    // ========== KeyType Tests ==========

    #[test]
    fn test_key_type_from_stored() {
        assert_eq!(KeyType::from_stored("Primary"), KeyType::Primary);
        assert_eq!(KeyType::from_stored("Secondary"), KeyType::Secondary);
        assert_eq!(KeyType::from_stored("AlertId"), KeyType::AlertId);
        assert_eq!(KeyType::from_stored("unknown"), KeyType::AlertId);
    }

    #[test]
    fn test_key_type_can_upgrade_alert_id_to_secondary() {
        assert!(KeyType::AlertId.can_upgrade_to(KeyType::Secondary));
    }

    #[test]
    fn test_key_type_can_upgrade_alert_id_to_primary() {
        assert!(KeyType::AlertId.can_upgrade_to(KeyType::Primary));
    }

    #[test]
    fn test_key_type_can_upgrade_secondary_to_primary() {
        assert!(KeyType::Secondary.can_upgrade_to(KeyType::Primary));
    }

    #[test]
    fn test_key_type_can_upgrade_same_level_secondary() {
        // Same level upgrades allowed (dimension refinement)
        assert!(KeyType::Secondary.can_upgrade_to(KeyType::Secondary));
    }

    #[test]
    fn test_key_type_can_upgrade_same_level_primary() {
        // Same level upgrades allowed (dimension refinement)
        assert!(KeyType::Primary.can_upgrade_to(KeyType::Primary));
    }

    #[test]
    fn test_key_type_cannot_downgrade_primary_to_secondary() {
        assert!(!KeyType::Primary.can_upgrade_to(KeyType::Secondary));
    }

    #[test]
    fn test_key_type_cannot_downgrade_primary_to_alert_id() {
        assert!(!KeyType::Primary.can_upgrade_to(KeyType::AlertId));
    }

    #[test]
    fn test_key_type_cannot_downgrade_secondary_to_alert_id() {
        assert!(!KeyType::Secondary.can_upgrade_to(KeyType::AlertId));
    }

    // ========== DimensionRelationship Tests ==========

    #[test]
    fn test_dimension_relationship_superset() {
        let existing = HashMap::from([("namespace".to_string(), "prod".to_string())]);
        let new = HashMap::from([
            ("namespace".to_string(), "prod".to_string()),
            ("cluster".to_string(), "us-east".to_string()),
        ]);

        let rel = DimensionRelationship::check(&existing, &new);
        assert_eq!(rel, DimensionRelationship::NewIsSuperset);
    }

    #[test]
    fn test_dimension_relationship_subset() {
        let existing = HashMap::from([
            ("namespace".to_string(), "prod".to_string()),
            ("cluster".to_string(), "us-east".to_string()),
        ]);
        let new = HashMap::from([("namespace".to_string(), "prod".to_string())]);

        let rel = DimensionRelationship::check(&existing, &new);
        assert_eq!(rel, DimensionRelationship::NewIsSubset);
    }

    #[test]
    fn test_dimension_relationship_equal() {
        let existing = HashMap::from([
            ("namespace".to_string(), "prod".to_string()),
            ("cluster".to_string(), "us-east".to_string()),
        ]);
        let new = HashMap::from([
            ("namespace".to_string(), "prod".to_string()),
            ("cluster".to_string(), "us-east".to_string()),
        ]);

        let rel = DimensionRelationship::check(&existing, &new);
        assert_eq!(rel, DimensionRelationship::Equal);
    }

    #[test]
    fn test_dimension_relationship_incompatible() {
        let existing = HashMap::from([("region".to_string(), "us-east".to_string())]);
        let new = HashMap::from([("region".to_string(), "us-west".to_string())]);

        let rel = DimensionRelationship::check(&existing, &new);
        assert_eq!(rel, DimensionRelationship::Incompatible);
    }

    #[test]
    fn test_dimension_relationship_incompatible_multiple_keys() {
        let existing = HashMap::from([
            ("namespace".to_string(), "prod".to_string()),
            ("region".to_string(), "us-east".to_string()),
        ]);
        let new = HashMap::from([
            ("namespace".to_string(), "prod".to_string()),
            ("region".to_string(), "us-west".to_string()), // Conflict!
        ]);

        let rel = DimensionRelationship::check(&existing, &new);
        assert_eq!(rel, DimensionRelationship::Incompatible);
    }

    #[test]
    fn test_dimension_relationship_partial_overlap() {
        let existing = HashMap::from([
            ("namespace".to_string(), "prod".to_string()),
            ("database".to_string(), "postgres".to_string()),
        ]);
        let new = HashMap::from([
            ("namespace".to_string(), "prod".to_string()),
            ("cache".to_string(), "redis".to_string()), // Different key
        ]);

        let rel = DimensionRelationship::check(&existing, &new);
        assert_eq!(rel, DimensionRelationship::PartialOverlap);
    }

    #[test]
    fn test_dimension_relationship_empty_existing() {
        let existing = HashMap::new();
        let new = HashMap::from([("namespace".to_string(), "prod".to_string())]);

        let rel = DimensionRelationship::check(&existing, &new);
        // New has more keys, all existing keys (0) match -> Superset
        assert_eq!(rel, DimensionRelationship::NewIsSuperset);
    }

    #[test]
    fn test_dimension_relationship_empty_new() {
        let existing = HashMap::from([("namespace".to_string(), "prod".to_string())]);
        let new = HashMap::new();

        let rel = DimensionRelationship::check(&existing, &new);
        // Empty dimensions should not match any incident (create new incident with alert_id key)
        assert_eq!(rel, DimensionRelationship::PartialOverlap);
    }

    #[test]
    fn test_dimension_relationship_both_empty() {
        let existing = HashMap::new();
        let new = HashMap::new();

        let rel = DimensionRelationship::check(&existing, &new);
        assert_eq!(rel, DimensionRelationship::Equal);
    }

    #[test]
    fn test_incident_event_is_alert() {
        let alert_event = IncidentEvent::alert("alert-1", "High CPU", 1000);
        assert!(alert_event.is_alert());

        let created_event = IncidentEvent::created();
        assert!(!created_event.is_alert());

        let resolved_event = IncidentEvent::resolved(None);
        assert!(!resolved_event.is_alert());
    }

    #[test]
    fn test_incident_event_is_alert_for() {
        let event = IncidentEvent::alert("alert-abc", "High CPU", 1000);
        assert!(event.is_alert_for("alert-abc"));
        assert!(!event.is_alert_for("alert-xyz"));
        assert!(!event.is_alert_for(""));

        // Non-alert event is never alert_for any id
        let created = IncidentEvent::created();
        assert!(!created.is_alert_for("alert-abc"));
    }

    #[test]
    fn test_incident_event_increment_alert_matching() {
        let mut event = IncidentEvent::alert("alert-1", "CPU spike", 1000);

        // First increment: count goes 1→2, last_at updated
        let result = event.increment_alert("alert-1", 2000);
        assert!(result);

        if let IncidentEventType::Alert {
            count,
            last_at,
            first_at,
            ..
        } = &event.event_type
        {
            assert_eq!(*count, 2);
            assert_eq!(*last_at, 2000);
            assert_eq!(*first_at, 1000); // first_at unchanged
        } else {
            panic!("expected Alert variant");
        }

        // Second increment
        let result2 = event.increment_alert("alert-1", 3000);
        assert!(result2);
        if let IncidentEventType::Alert { count, last_at, .. } = &event.event_type {
            assert_eq!(*count, 3);
            assert_eq!(*last_at, 3000);
        }
    }

    #[test]
    fn test_incident_event_increment_alert_wrong_id() {
        let mut event = IncidentEvent::alert("alert-1", "CPU spike", 1000);
        let result = event.increment_alert("alert-2", 2000);
        assert!(!result);

        // count unchanged
        if let IncidentEventType::Alert { count, last_at, .. } = &event.event_type {
            assert_eq!(*count, 1);
            assert_eq!(*last_at, 1000);
        }
    }

    #[test]
    fn test_incident_event_increment_alert_non_alert_event() {
        let mut event = IncidentEvent::created();
        let result = event.increment_alert("alert-1", 2000);
        assert!(!result);
    }

    // ── IncidentStatus Display + FromStr ─────────────────────────────────────

    #[test]
    fn test_incident_status_display() {
        assert_eq!(IncidentStatus::Open.to_string(), "open");
        assert_eq!(IncidentStatus::Acknowledged.to_string(), "acknowledged");
        assert_eq!(IncidentStatus::Resolved.to_string(), "resolved");
    }

    #[test]
    fn test_incident_status_from_str() {
        use std::str::FromStr;
        assert_eq!(
            IncidentStatus::from_str("open").unwrap(),
            IncidentStatus::Open
        );
        assert_eq!(
            IncidentStatus::from_str("ACKNOWLEDGED").unwrap(),
            IncidentStatus::Acknowledged
        );
        assert_eq!(
            IncidentStatus::from_str("resolved").unwrap(),
            IncidentStatus::Resolved
        );
        assert!(IncidentStatus::from_str("unknown").is_err());
    }

    // ── IncidentSeverity Display + FromStr ────────────────────────────────────

    #[test]
    fn test_incident_severity_display() {
        assert_eq!(IncidentSeverity::P1.to_string(), "P1");
        assert_eq!(IncidentSeverity::P2.to_string(), "P2");
        assert_eq!(IncidentSeverity::P3.to_string(), "P3");
        assert_eq!(IncidentSeverity::P4.to_string(), "P4");
    }

    #[test]
    fn test_incident_severity_from_str() {
        use std::str::FromStr;
        assert_eq!(
            IncidentSeverity::from_str("p1").unwrap(),
            IncidentSeverity::P1
        );
        assert_eq!(
            IncidentSeverity::from_str("P2").unwrap(),
            IncidentSeverity::P2
        );
        assert_eq!(
            IncidentSeverity::from_str("P3").unwrap(),
            IncidentSeverity::P3
        );
        assert_eq!(
            IncidentSeverity::from_str("P4").unwrap(),
            IncidentSeverity::P4
        );
        assert!(IncidentSeverity::from_str("P5").is_err());
    }

    // ── CorrelationReason TryFrom ─────────────────────────────────────────────

    #[test]
    fn test_correlation_reason_try_from() {
        assert_eq!(
            CorrelationReason::try_from("service_discovery").unwrap(),
            CorrelationReason::ServiceDiscovery
        );
        assert_eq!(
            CorrelationReason::try_from("PRIMARY_MATCH").unwrap(),
            CorrelationReason::PrimaryMatch
        );
        assert!(CorrelationReason::try_from("bad_value").is_err());
    }

    // ── KeyType ───────────────────────────────────────────────────────────────

    #[test]
    fn test_key_type_display() {
        assert_eq!(KeyType::AlertId.to_string(), "AlertId");
        assert_eq!(KeyType::Secondary.to_string(), "Secondary");
        assert_eq!(KeyType::Primary.to_string(), "Primary");
    }

    #[test]
    fn test_key_type_can_upgrade_to() {
        // AlertId can upgrade to Secondary or Primary
        assert!(KeyType::AlertId.can_upgrade_to(KeyType::Secondary));
        assert!(KeyType::AlertId.can_upgrade_to(KeyType::Primary));
        // Secondary can upgrade to Primary or stay Secondary
        assert!(KeyType::Secondary.can_upgrade_to(KeyType::Primary));
        assert!(KeyType::Secondary.can_upgrade_to(KeyType::Secondary));
        // Secondary cannot downgrade to AlertId
        assert!(!KeyType::Secondary.can_upgrade_to(KeyType::AlertId));
        // Primary can only upgrade to itself
        assert!(KeyType::Primary.can_upgrade_to(KeyType::Primary));
        assert!(!KeyType::Primary.can_upgrade_to(KeyType::Secondary));
        assert!(!KeyType::Primary.can_upgrade_to(KeyType::AlertId));
    }

    // ── DimensionRelationship::check ──────────────────────────────────────────

    #[test]
    fn test_dimension_relationship_new_empty_existing_not() {
        let existing: HashMap<String, String> = [("ns".to_string(), "prod".to_string())].into();
        let result = DimensionRelationship::check(&existing, &HashMap::new());
        assert_eq!(result, DimensionRelationship::PartialOverlap);
    }

    #[test]
    fn test_dimension_relationship_new_is_superset() {
        let existing: HashMap<String, String> = [("ns".to_string(), "prod".to_string())].into();
        let new: HashMap<String, String> = [
            ("ns".to_string(), "prod".to_string()),
            ("cluster".to_string(), "us-east".to_string()),
        ]
        .into();
        let result = DimensionRelationship::check(&existing, &new);
        assert_eq!(result, DimensionRelationship::NewIsSuperset);
    }

    #[test]
    fn test_dimension_relationship_new_is_subset() {
        let existing: HashMap<String, String> = [
            ("ns".to_string(), "prod".to_string()),
            ("cluster".to_string(), "us-east".to_string()),
        ]
        .into();
        let new: HashMap<String, String> = [("ns".to_string(), "prod".to_string())].into();
        let result = DimensionRelationship::check(&existing, &new);
        assert_eq!(result, DimensionRelationship::NewIsSubset);
    }

    fn make_incident(
        resolved_at: Option<i64>,
        title: Option<String>,
        assigned_to: Option<String>,
        topology_context: Option<IncidentTopology>,
    ) -> Incident {
        Incident {
            id: "abc123".to_string(),
            org_id: "org1".to_string(),
            status: IncidentStatus::default(),
            severity: IncidentSeverity::default(),
            first_alert_at: 1000,
            last_alert_at: 2000,
            resolved_at,
            alert_count: 1,
            title,
            assigned_to,
            created_at: 1000,
            updated_at: 2000,
            group_values: serde_json::Value::Null,
            key_type: KeyType::default(),
            topology_context,
        }
    }

    #[test]
    fn test_incident_optional_fields_none_absent_from_json() {
        let incident = make_incident(None, None, None, None);
        let json = serde_json::to_value(&incident).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("resolved_at"));
        assert!(!obj.contains_key("title"));
        assert!(!obj.contains_key("assigned_to"));
        assert!(!obj.contains_key("topology_context"));
    }

    #[test]
    fn test_incident_optional_fields_some_present_in_json() {
        let incident = make_incident(
            Some(3000),
            Some("High CPU".to_string()),
            Some("oncall@example.com".to_string()),
            None,
        );
        let json = serde_json::to_value(&incident).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("resolved_at"));
        assert_eq!(obj["resolved_at"], serde_json::json!(3000_i64));
        assert!(obj.contains_key("title"));
        assert_eq!(obj["title"], serde_json::json!("High CPU"));
        assert!(obj.contains_key("assigned_to"));
    }

    #[test]
    fn test_incident_stats_mttr_none_absent_from_json() {
        let stats = IncidentStats {
            total_incidents: 10,
            open_incidents: 5,
            acknowledged_incidents: 2,
            resolved_incidents: 3,
            by_severity: Default::default(),
            by_service: Default::default(),
            mttr_minutes: None,
            alerts_per_incident_avg: 2.5,
        };
        let json = serde_json::to_value(&stats).unwrap();
        assert!(!json.as_object().unwrap().contains_key("mttr_minutes"));
    }

    #[test]
    fn test_incident_stats_mttr_some_present_in_json() {
        let stats = IncidentStats {
            total_incidents: 5,
            open_incidents: 1,
            acknowledged_incidents: 0,
            resolved_incidents: 4,
            by_severity: Default::default(),
            by_service: Default::default(),
            mttr_minutes: Some(15.5),
            alerts_per_incident_avg: 3.0,
        };
        let json = serde_json::to_value(&stats).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("mttr_minutes"));
        assert_eq!(obj["mttr_minutes"], serde_json::json!(15.5_f64));
    }

    #[test]
    fn test_incident_event_factory_severity_upgrade() {
        let event = IncidentEvent::severity_upgrade(
            IncidentSeverity::P3,
            IncidentSeverity::P1,
            "latency spike",
        );
        assert!(event.timestamp > 0);
        assert!(matches!(
            event.event_type,
            IncidentEventType::SeverityUpgrade {
                from: IncidentSeverity::P3,
                to: IncidentSeverity::P1,
                ..
            }
        ));
    }

    #[test]
    fn test_incident_event_factory_severity_override() {
        let event = IncidentEvent::severity_override(
            IncidentSeverity::P1,
            IncidentSeverity::P4,
            "user@example.com",
        );
        assert!(event.timestamp > 0);
        assert!(matches!(
            event.event_type,
            IncidentEventType::SeverityOverride {
                from: IncidentSeverity::P1,
                to: IncidentSeverity::P4,
                ..
            }
        ));
    }

    #[test]
    fn test_incident_event_factory_acknowledged() {
        let event = IncidentEvent::acknowledged("user@example.com");
        assert!(event.timestamp > 0);
        if let IncidentEventType::Acknowledged { user_id } = &event.event_type {
            assert_eq!(user_id, "user@example.com");
        } else {
            panic!("Expected Acknowledged event");
        }
    }

    #[test]
    fn test_incident_event_factory_reopened() {
        let event = IncidentEvent::reopened("user@example.com", "false positive");
        assert!(event.timestamp > 0);
        if let IncidentEventType::Reopened { user_id, reason } = &event.event_type {
            assert_eq!(user_id, "user@example.com");
            assert_eq!(reason, "false positive");
        } else {
            panic!("Expected Reopened event");
        }
    }

    #[test]
    fn test_incident_event_factory_dimensions_upgraded() {
        let event = IncidentEvent::dimensions_upgraded("alert-id-key", "secondary-key");
        assert!(event.timestamp > 0);
        if let IncidentEventType::DimensionsUpgraded { from_key, to_key } = &event.event_type {
            assert_eq!(from_key, "alert-id-key");
            assert_eq!(to_key, "secondary-key");
        } else {
            panic!("Expected DimensionsUpgraded event");
        }
    }

    #[test]
    fn test_incident_event_factory_title_changed() {
        let event = IncidentEvent::title_changed("Old Title", "New Title", "user@example.com");
        assert!(event.timestamp > 0);
        if let IncidentEventType::TitleChanged { from, to, user_id } = &event.event_type {
            assert_eq!(from, "Old Title");
            assert_eq!(to, "New Title");
            assert_eq!(user_id, "user@example.com");
        } else {
            panic!("Expected TitleChanged event");
        }
    }

    #[test]
    fn test_incident_event_factory_comment() {
        let event = IncidentEvent::comment("user@example.com", "investigating now");
        assert!(event.timestamp > 0);
        if let IncidentEventType::Comment { user_id, comment } = &event.event_type {
            assert_eq!(user_id, "user@example.com");
            assert_eq!(comment, "investigating now");
        } else {
            panic!("Expected Comment event");
        }
    }

    #[test]
    fn test_incident_event_factory_ai_analysis_failed() {
        let event = IncidentEvent::ai_analysis_failed(
            "timeout",
            AnalysisTriggerType::AutomaticNewIncident,
            Some("request timed out".to_string()),
        );
        assert!(event.timestamp > 0);
        assert!(matches!(
            event.event_type,
            IncidentEventType::AIAnalysisFailed { .. }
        ));
    }

    #[test]
    fn test_incident_correlation_outcome_incident_id_all_variants() {
        let created = IncidentCorrelationOutcome::NewIncidentCreated {
            incident_id: "inc-001".to_string(),
            service_name: "svc-a".to_string(),
        };
        assert_eq!(created.incident_id(), "inc-001");

        let joined = IncidentCorrelationOutcome::NewAlertTypeJoined {
            incident_id: "inc-002".to_string(),
            service_name: "svc-b".to_string(),
        };
        assert_eq!(joined.incident_id(), "inc-002");

        let repeated = IncidentCorrelationOutcome::ExistingAlertRepeated {
            incident_id: "inc-003".to_string(),
            service_name: "svc-c".to_string(),
        };
        assert_eq!(repeated.incident_id(), "inc-003");
    }

    #[test]
    fn test_incident_correlation_outcome_service_name_all_variants() {
        let created = IncidentCorrelationOutcome::NewIncidentCreated {
            incident_id: "inc-001".to_string(),
            service_name: "service-x".to_string(),
        };
        assert_eq!(created.service_name(), "service-x");

        let joined = IncidentCorrelationOutcome::NewAlertTypeJoined {
            incident_id: "inc-001".to_string(),
            service_name: "service-y".to_string(),
        };
        assert_eq!(joined.service_name(), "service-y");

        let repeated = IncidentCorrelationOutcome::ExistingAlertRepeated {
            incident_id: "inc-001".to_string(),
            service_name: "service-z".to_string(),
        };
        assert_eq!(repeated.service_name(), "service-z");
    }

    #[test]
    fn test_default_time_window() {
        assert_eq!(default_time_window(), 60);
    }

    #[test]
    fn test_default_min_alerts() {
        assert_eq!(default_min_alerts(), 1);
    }

    #[test]
    fn test_default_upgrade_window() {
        assert_eq!(default_upgrade_window(), 30);
    }

    #[test]
    fn test_default_true() {
        assert!(default_true());
    }

    #[test]
    fn test_incident_event_factory_resolved_with_user() {
        let event = IncidentEvent::resolved(Some("user@test.com".to_string()));
        assert!(event.timestamp > 0);
        assert!(matches!(
            event.event_type,
            IncidentEventType::Resolved { user_id: Some(ref u) } if u == "user@test.com"
        ));
    }

    #[test]
    fn test_incident_event_factory_resolved_without_user() {
        let event = IncidentEvent::resolved(None);
        assert!(matches!(
            event.event_type,
            IncidentEventType::Resolved { user_id: None }
        ));
    }

    #[test]
    fn test_record_rca_result_archives_previous() {
        let mut t = IncidentTopology::default();

        t.record_rca_result("first", 25);
        assert_eq!(t.suggested_root_cause.as_deref(), Some("first"));
        // Nothing was superseded on the very first run.
        assert!(t.previous_analyses.is_empty());

        t.record_rca_result("second", 25);
        assert_eq!(t.suggested_root_cause.as_deref(), Some("second"));
        assert_eq!(t.previous_analyses.len(), 1);
        assert_eq!(t.previous_analyses[0].content, "first");
        assert!(t.previous_analyses[0].archived_at > 0);
    }

    #[test]
    fn test_record_rca_result_orders_newest_first() {
        let mut t = IncidentTopology::default();
        for r in ["r1", "r2", "r3", "r4"] {
            t.record_rca_result(r, 25);
        }

        assert_eq!(t.suggested_root_cause.as_deref(), Some("r4"));
        let archived: Vec<_> = t
            .previous_analyses
            .iter()
            .map(|a| a.content.as_str())
            .collect();
        assert_eq!(archived, vec!["r3", "r2", "r1"]);
    }

    #[test]
    fn test_record_rca_result_respects_history_limit() {
        let mut t = IncidentTopology::default();
        for i in 0..10 {
            t.record_rca_result(format!("report-{i}"), 3);
        }

        assert_eq!(t.suggested_root_cause.as_deref(), Some("report-9"));
        // Only the three most recent superseded reports survive.
        assert_eq!(t.previous_analyses.len(), 3);
        assert_eq!(t.previous_analyses[0].content, "report-8");
        assert_eq!(t.previous_analyses[2].content, "report-6");
    }

    #[test]
    fn test_record_rca_result_zero_limit_disables_history() {
        let mut t = IncidentTopology::default();
        t.record_rca_result("first", 25);
        t.record_rca_result("second", 25);
        assert_eq!(t.previous_analyses.len(), 1);

        // Dropping the limit to 0 clears retained reports and stops archiving.
        t.record_rca_result("third", 0);
        assert_eq!(t.suggested_root_cause.as_deref(), Some("third"));
        assert!(t.previous_analyses.is_empty());
    }

    #[test]
    fn test_record_rca_result_skips_identical_report() {
        let mut t = IncidentTopology::default();
        t.record_rca_result("same", 25);
        t.record_rca_result("same", 25);

        // An unchanged re-run should not fill history with duplicates.
        assert_eq!(t.suggested_root_cause.as_deref(), Some("same"));
        assert!(t.previous_analyses.is_empty());
    }

    #[test]
    fn test_topology_previous_analyses_backward_compatible() {
        // Topology JSON written before history existed must still deserialize.
        let json = r#"{"nodes":[],"edges":[],"related_incident_ids":[],
            "suggested_root_cause":"legacy report"}"#;
        let t: IncidentTopology = serde_json::from_str(json).unwrap();
        assert_eq!(t.suggested_root_cause.as_deref(), Some("legacy report"));
        assert!(t.previous_analyses.is_empty());
    }

    #[test]
    fn test_incident_event_factory_ai_analysis_begin() {
        let event = IncidentEvent::ai_analysis_begin();
        assert!(event.timestamp > 0);
        assert!(matches!(
            event.event_type,
            IncidentEventType::AIAnalysisBegin
        ));
    }

    #[test]
    fn test_incident_event_factory_ai_analysis_complete() {
        let event = IncidentEvent::ai_analysis_complete();
        assert!(event.timestamp > 0);
        assert!(matches!(
            event.event_type,
            IncidentEventType::AIAnalysisComplete
        ));
    }

    // ── External alert ingest ────────────────────────────────────────────────

    fn ext_payload(source: &str, alert_name: &str) -> ExternalAlertPayload {
        ExternalAlertPayload {
            source: source.to_string(),
            alert_name: alert_name.to_string(),
            dedup_key: None,
            severity: None,
            status: ExternalAlertStatus::Firing,
            timestamp: None,
            labels: HashMap::new(),
            annotations: HashMap::new(),
            external_url: None,
        }
    }

    #[test]
    fn test_external_alert_id_is_stable_across_calls() {
        let a = ext_payload("alertmanager", "HighErrorRate");
        let b = ext_payload("alertmanager", "HighErrorRate");
        assert_eq!(a.alert_id("org1"), b.alert_id("org1"));
    }

    #[test]
    fn test_external_alert_id_is_never_empty() {
        // The regression this guards: a synthetic Alert with `id: None` makes
        // Alert::get_unique_key() return "", collapsing every external alert
        // onto one identity and wrongly suppressing notifications.
        let id = ext_payload("datadog", "CPUHigh").alert_id("org1");
        assert!(!id.is_empty());
        assert_eq!(id.len(), 27, "must be KSUID-shaped like a native alert id");
    }

    #[test]
    fn test_external_alert_id_parses_as_ksuid() {
        // get_incident_with_alerts parses alert_id as a Ksuid; a non-parsing id
        // would be silently skipped there.
        use std::str::FromStr;
        let id = ext_payload("grafana", "DiskFull").alert_id("org1");
        assert!(svix_ksuid::Ksuid::from_str(&id).is_ok());
    }

    #[test]
    fn test_external_alert_id_differs_by_source_name_and_org() {
        let base = ext_payload("alertmanager", "HighErrorRate").alert_id("org1");
        assert_ne!(
            base,
            ext_payload("datadog", "HighErrorRate").alert_id("org1")
        );
        assert_ne!(
            base,
            ext_payload("alertmanager", "LowDiskSpace").alert_id("org1")
        );
        assert_ne!(
            base,
            ext_payload("alertmanager", "HighErrorRate").alert_id("org2")
        );
    }

    #[test]
    fn test_empty_existing_dims_reports_superset() {
        // Documents the trap rather than the desired outcome: an empty
        // existing set reports NewIsSuperset, i.e. "compatible with anything".
        // find_or_create_incident must therefore skip dimensionless incidents
        // explicitly — otherwise the first alert that fails to correlate
        // becomes a magnet absorbing every unrelated alert after it.
        let existing = HashMap::new();
        let new = HashMap::from([("service".to_string(), "checkout".to_string())]);

        assert!(matches!(
            DimensionRelationship::check(&existing, &new),
            DimensionRelationship::NewIsSuperset
        ));
    }

    #[test]
    fn test_differing_values_on_a_shared_key_are_incompatible() {
        let existing = HashMap::from([("service".to_string(), "checkout".to_string())]);
        let new = HashMap::from([("service".to_string(), "payments".to_string())]);

        assert!(matches!(
            DimensionRelationship::check(&existing, &new),
            DimensionRelationship::Incompatible
        ));
    }

    #[test]
    fn test_effective_dedup_key_returns_the_supplied_key() {
        let mut p = ext_payload("alertmanager", "HighErrorRate");
        p.dedup_key = Some("abc123".to_string());
        assert_eq!(p.effective_dedup_key(), Some("abc123"));
    }

    #[test]
    fn test_effective_dedup_key_trims_surrounding_whitespace() {
        let mut p = ext_payload("alertmanager", "HighErrorRate");
        p.dedup_key = Some("  abc123  ".to_string());
        assert_eq!(p.effective_dedup_key(), Some("abc123"));
    }

    #[test]
    fn test_effective_dedup_key_treats_blank_as_absent() {
        // Honouring a blank key would make it match every other blank-keyed
        // payload and collapse unrelated firings into one.
        for blank in ["", "   ", "\t\n"] {
            let mut p = ext_payload("alertmanager", "HighErrorRate");
            p.dedup_key = Some(blank.to_string());
            assert_eq!(
                p.effective_dedup_key(),
                None,
                "{blank:?} must read as absent"
            );
        }
    }

    #[test]
    fn test_effective_dedup_key_absent_means_no_deduplication() {
        // Deliberate: with no key there is nothing to tell a retry from a
        // genuine re-fire, so the ingest path must not invent an identity.
        let p = ext_payload("alertmanager", "HighErrorRate");
        assert_eq!(p.effective_dedup_key(), None);
    }

    #[test]
    fn test_validate_accepts_minimal_payload() {
        assert!(
            ext_payload("alertmanager", "HighErrorRate")
                .validate()
                .is_ok()
        );
    }

    #[test]
    fn test_validate_allows_empty_labels() {
        // Documented behaviour: no labels → cannot correlate → own incident.
        let p = ext_payload("alertmanager", "HighErrorRate");
        assert!(p.labels.is_empty());
        assert!(p.validate().is_ok());
    }

    #[test]
    fn test_validate_rejects_blank_source_and_name() {
        assert!(ext_payload("   ", "HighErrorRate").validate().is_err());
        assert!(ext_payload("alertmanager", "").validate().is_err());
    }

    #[test]
    fn test_validate_rejects_oversized_label_maps() {
        let mut p = ext_payload("alertmanager", "HighErrorRate");
        for i in 0..(MAX_EXTERNAL_ALERT_LABELS + 1) {
            p.labels.insert(format!("k{i}"), "v".to_string());
        }
        assert!(p.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_oversized_label_value() {
        let mut p = ext_payload("alertmanager", "HighErrorRate");
        p.labels.insert(
            "service".to_string(),
            "x".repeat(MAX_EXTERNAL_ALERT_LABEL_LEN + 1),
        );
        assert!(p.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_non_http_external_url() {
        // Stored XSS guard: this value is handed back to clients as a link.
        for bad in [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "data:text/html;base64,PHNjcmlwdD4=",
            "file:///etc/passwd",
            "//evil.example.com",
        ] {
            let mut p = ext_payload("alertmanager", "HighErrorRate");
            p.external_url = Some(bad.to_string());
            assert!(p.validate().is_err(), "{bad} must be rejected");
        }
    }

    #[test]
    fn test_validate_accepts_http_and_https_external_url() {
        for good in [
            "https://alertmanager.example.com/#/alerts",
            "http://localhost:9093/#/alerts",
            "  https://example.com/x  ",
        ] {
            let mut p = ext_payload("alertmanager", "HighErrorRate");
            p.external_url = Some(good.to_string());
            assert!(p.validate().is_ok(), "{good} must be accepted");
        }
    }

    #[test]
    fn test_validate_rejects_seconds_and_millis_timestamps() {
        // The trap this closes: a seconds-precision timestamp lands the incident
        // in 1970, where the auto-resolve sweep immediately closes it — the
        // alert disappears instead of erroring.
        let seconds = 1_753_612_800_i64;
        let millis = seconds * 1_000;

        for bad in [0, 1, seconds, millis, -1] {
            let mut p = ext_payload("alertmanager", "HighErrorRate");
            p.timestamp = Some(bad);
            assert!(p.validate().is_err(), "{bad} must be rejected");
        }
    }

    #[test]
    fn test_validate_rejects_absurd_future_timestamp() {
        let mut p = ext_payload("alertmanager", "HighErrorRate");
        p.timestamp = Some(i64::MAX);
        assert!(p.validate().is_err());
    }

    #[test]
    fn test_validate_accepts_micros_timestamp() {
        let mut p = ext_payload("alertmanager", "HighErrorRate");
        p.timestamp = Some(1_753_612_800_000_000);
        assert!(p.validate().is_ok());
    }

    #[test]
    fn test_validate_allows_absent_timestamp() {
        let p = ext_payload("alertmanager", "HighErrorRate");
        assert!(p.timestamp.is_none());
        assert!(p.validate().is_ok());
    }

    #[test]
    fn test_status_defaults_to_firing_when_absent() {
        let p: ExternalAlertPayload =
            serde_json::from_str(r#"{"source":"alertmanager","alert_name":"X"}"#).unwrap();
        assert_eq!(p.status, ExternalAlertStatus::Firing);
        assert!(p.labels.is_empty());
    }

    #[test]
    fn test_status_deserializes_resolved() {
        let p: ExternalAlertPayload = serde_json::from_str(
            r#"{"source":"alertmanager","alert_name":"X","status":"resolved"}"#,
        )
        .unwrap();
        assert_eq!(p.status, ExternalAlertStatus::Resolved);
    }

    #[test]
    fn test_map_external_severity_known_vocabularies() {
        assert_eq!(
            map_external_severity("critical"),
            Some(IncidentSeverity::P1)
        );
        assert_eq!(map_external_severity("P1"), Some(IncidentSeverity::P1));
        assert_eq!(map_external_severity("error"), Some(IncidentSeverity::P2));
        assert_eq!(
            map_external_severity(" Warning "),
            Some(IncidentSeverity::P3)
        );
        assert_eq!(map_external_severity("info"), Some(IncidentSeverity::P4));
    }

    #[test]
    fn test_map_external_severity_unknown_returns_none() {
        // None means "keep the configured default" rather than guessing.
        assert_eq!(map_external_severity("spicy"), None);
        assert_eq!(map_external_severity(""), None);
    }
}
