// Copyright 2025 OpenObserve Inc.
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
    /// Correlated by matching environment scope dimensions (cluster, region, namespace)
    ScopeMatch,
    /// Correlated by matching workload identity dimensions (service, deployment)
    WorkloadMatch,
    /// Fallback: no dimensions found, isolated by alert ID
    AlertId,
}

impl std::fmt::Display for CorrelationReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ServiceDiscovery => write!(f, "service_discovery"),
            Self::ScopeMatch => write!(f, "scope_match"),
            Self::WorkloadMatch => write!(f, "workload_match"),
            Self::AlertId => write!(f, "alert_id"),
        }
    }
}

impl TryFrom<&str> for CorrelationReason {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value.to_lowercase().as_str() {
            "service_discovery" => Ok(Self::ServiceDiscovery),
            "scope_match" => Ok(Self::ScopeMatch),
            "workload_match" => Ok(Self::WorkloadMatch),
            "alert_id" => Ok(Self::AlertId),
            unmatched => Err(format!("'{unmatched}' is not a valid CorrelationReason")),
        }
    }
}

/// Classification of correlation key strength for hierarchical upgrade logic
///
/// Hierarchy: AlertId (weakest) → Workload → Scope (strongest)
/// Upgrades only move UP the hierarchy, never down.
///
/// Key format: `[KIND]:[key]` where KIND is SCOPE, WORKLOAD, SD, or ALERT.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum KeyType {
    /// Weakest: No stable dimensions found, isolated by alert ID
    /// Format: ALERT:<alert_unique_key>
    AlertId,
    /// Medium: Correlation by workload dimensions (deployment, statefulset, service)
    /// Format: WORKLOAD:<hash>
    Workload,
    /// Strongest: Correlation by scope dimensions (cluster, namespace, region, environment)
    /// Format: SCOPE:<hash>
    Scope,
}

impl KeyType {
    pub fn classify(correlation_key: &str) -> Self {
        if correlation_key.starts_with("SCOPE:") || correlation_key.starts_with("SD:") {
            Self::Scope
        } else if correlation_key.starts_with("WORKLOAD:") {
            Self::Workload
        } else {
            // ALERT: prefix or unknown format — treat as weakest
            Self::AlertId
        }
    }

    pub const fn can_upgrade_to(&self, target: Self) -> bool {
        matches!(
            (self, target),
            (Self::AlertId, Self::Workload | Self::Scope)
                | (Self::Workload, Self::Scope | Self::Workload)
                | (Self::Scope, Self::Scope)
        )
    }
}

impl std::fmt::Display for KeyType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlertId => write!(f, "alert_id"),
            Self::Workload => write!(f, "workload"),
            Self::Scope => write!(f, "scope"),
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
    /// blake3 hash of stable dimensions (64 chars)
    pub correlation_key: String,

    pub status: IncidentStatus,
    pub severity: IncidentSeverity,

    /// Stable dimensions used for correlation (service, namespace, cluster, environment)
    pub stable_dimensions: HashMap<String, String>,
    /// Service Graph topology context (populated async)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topology_context: Option<IncidentTopology>,

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
    Acknowledged { user_id: String },

    /// Status changed to Resolved
    Resolved {
        /// None = auto-resolved by background job
        user_id: Option<String>,
    },

    /// Resolved incident reopened
    Reopened { user_id: String, reason: String },

    /// Correlation key strength upgraded (e.g. Workload -> Scope)
    DimensionsUpgraded { from_key: String, to_key: String },

    /// Incident assigned/unassigned
    AssignmentChanged {
        from: Option<String>,
        to: Option<String>,
    },

    /// User comment
    Comment { user_id: String, comment: String },

    /// AI/RCA analysis started
    #[serde(rename = "ai_analysis_begin")]
    AIAnalysisBegin,

    /// AI/RCA analysis completed
    #[serde(rename = "ai_analysis_complete")]
    AIAnalysisComplete,
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

    /// Increment alert count if this is an Alert event for the given alert_id.
    /// No-op if not an Alert or different alert_id.
    pub fn increment_alert(&mut self, alert_id: &str, triggered_at: i64) -> bool {
        if let IncidentEventType::Alert {
            alert_id: id,
            count,
            last_at,
            ..
        } = &mut self.event_type
        {
            if id == alert_id {
                *count += 1;
                *last_at = triggered_at;
                self.timestamp = chrono::Utc::now().timestamp_micros();
                return true;
            }
        }
        false
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
        assert_eq!(CorrelationReason::ScopeMatch.to_string(), "scope_match");
        assert_eq!(
            CorrelationReason::WorkloadMatch.to_string(),
            "workload_match"
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
            CorrelationReason::ScopeMatch
        );
        assert_ne!(
            CorrelationReason::ScopeMatch,
            CorrelationReason::WorkloadMatch
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
    fn test_key_type_classify_scope() {
        let key = "SCOPE:abc123def456";
        assert_eq!(KeyType::classify(key), KeyType::Scope);
    }

    #[test]
    fn test_key_type_classify_workload() {
        let key = "WORKLOAD:xyz789";
        assert_eq!(KeyType::classify(key), KeyType::Workload);
    }

    #[test]
    fn test_key_type_classify_alert_id() {
        let key = "ALERT:2QxZj9K0d6XYz8wN3sF5pL4mT7v";
        assert_eq!(KeyType::classify(key), KeyType::AlertId);
    }

    #[test]
    fn test_key_type_classify_sd() {
        let key = "SD:abc123def456789012345678901234567890123456789012345678901234";
        assert_eq!(KeyType::classify(key), KeyType::Scope);
    }

    #[test]
    fn test_key_type_classify_unknown() {
        // Unknown format — treat as weakest
        let key = "some_random_string";
        assert_eq!(KeyType::classify(key), KeyType::AlertId);
    }

    #[test]
    fn test_key_type_can_upgrade_alert_id_to_workload() {
        assert!(KeyType::AlertId.can_upgrade_to(KeyType::Workload));
    }

    #[test]
    fn test_key_type_can_upgrade_alert_id_to_scope() {
        assert!(KeyType::AlertId.can_upgrade_to(KeyType::Scope));
    }

    #[test]
    fn test_key_type_can_upgrade_workload_to_scope() {
        assert!(KeyType::Workload.can_upgrade_to(KeyType::Scope));
    }

    #[test]
    fn test_key_type_can_upgrade_same_level_workload() {
        // Same level upgrades allowed (dimension refinement)
        assert!(KeyType::Workload.can_upgrade_to(KeyType::Workload));
    }

    #[test]
    fn test_key_type_can_upgrade_same_level_scope() {
        // Same level upgrades allowed (dimension refinement)
        assert!(KeyType::Scope.can_upgrade_to(KeyType::Scope));
    }

    #[test]
    fn test_key_type_cannot_downgrade_scope_to_workload() {
        assert!(!KeyType::Scope.can_upgrade_to(KeyType::Workload));
    }

    #[test]
    fn test_key_type_cannot_downgrade_scope_to_alert_id() {
        assert!(!KeyType::Scope.can_upgrade_to(KeyType::AlertId));
    }

    #[test]
    fn test_key_type_cannot_downgrade_workload_to_alert_id() {
        assert!(!KeyType::Workload.can_upgrade_to(KeyType::AlertId));
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
}
