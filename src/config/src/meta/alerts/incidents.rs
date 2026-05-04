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

/// Alert flow graph showing how alerts cascaded across services over time
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct IncidentTopology {
    /// Alert nodes - each unique (service, alert) pair
    pub nodes: Vec<AlertNode>,
    /// Edges showing temporal and service dependency relationships
    pub edges: Vec<AlertEdge>,
    /// Related incident IDs (for cross-incident correlation)
    pub related_incident_ids: Vec<String>,
    /// AI-generated root cause analysis (markdown)
    pub suggested_root_cause: Option<String>,
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
}
