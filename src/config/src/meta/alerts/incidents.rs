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
    /// Fallback: extracted stable dimensions from alert labels
    ManualExtraction,
    /// Temporal proximity (future use)
    Temporal,
}

impl std::fmt::Display for CorrelationReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ServiceDiscovery => write!(f, "service_discovery"),
            Self::ManualExtraction => write!(f, "manual_extraction"),
            Self::Temporal => write!(f, "temporal"),
        }
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

/// Alert flow graph visualization for an incident
///
/// Shows how alerts cascaded across services over time, with nodes representing
/// unique (service, alert) pairs and edges showing temporal and dependency relationships.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct IncidentServiceGraph {
    /// Alert nodes in the flow graph
    pub nodes: Vec<AlertNode>,
    /// Edges showing alert flow (temporal + service dependencies)
    pub edges: Vec<AlertEdge>,
    /// Summary statistics
    pub stats: IncidentGraphStats,
}

/// Summary statistics for the incident service graph
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct IncidentGraphStats {
    /// Total number of services in the graph
    pub total_services: usize,
    /// Total number of alerts across all services
    pub total_alerts: u32,
    /// Number of services that have at least one alert
    pub services_with_alerts: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(
            CorrelationReason::ManualExtraction.to_string(),
            "manual_extraction"
        );
        assert_eq!(CorrelationReason::Temporal.to_string(), "temporal");
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
            CorrelationReason::ManualExtraction
        );
        assert_ne!(
            CorrelationReason::ManualExtraction,
            CorrelationReason::Temporal
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
}
