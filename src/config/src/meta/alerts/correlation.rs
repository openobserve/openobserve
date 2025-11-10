// Copyright 2025 OpenObserve Inc.
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

//! Alert correlation configuration and related types
//!
//! This module defines the structure for configuring alert correlation behavior,
//! which groups related alerts into incidents based on semantic field matching
//! or temporal proximity.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Organization-level correlation configuration
///
/// # Naming Convention
///
/// This config uses `correlation_dimensions` (not `correlation_fields`) to distinguish
/// from `DeduplicationConfig::fingerprint_fields`:
/// - **correlation_dimensions**: Semantic group IDs used for *matching* alerts to incidents
/// - **fingerprint_fields**: Semantic group IDs used for *identifying* duplicate alert firings
///
/// While both reference semantic group IDs, they serve different purposes:
/// - Correlation: "Do these alerts belong to the same incident?"
/// - Deduplication: "Is this the same alert firing again?"
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CorrelationConfig {
    /// Whether correlation is enabled for this organization
    pub enabled: bool,

    /// Semantic group IDs to use for correlation matching
    ///
    /// These define which dimensions must match for alerts to be grouped into
    /// the same incident. References semantic group IDs from deduplication config.
    ///
    /// Example: `["service", "host", "k8s-cluster"]`
    ///
    /// Note: Called "dimensions" (not "fields") to emphasize the semantic grouping aspect.
    #[serde(default)]
    pub correlation_dimensions: Vec<String>,

    /// Whether all dimensions must match (true) or just any (false)
    ///
    /// - `true`: ALL correlation_dimensions must match (AND logic)
    /// - `false`: ANY correlation_dimension can match (OR logic)
    #[serde(default)]
    pub require_dimension_match: bool,

    /// Enable temporal correlation as a fallback when no semantic match found
    ///
    /// When enabled, alerts that arrive within the temporal window will be
    /// grouped even if dimensions don't match (lower confidence).
    #[serde(default)]
    pub temporal_fallback_enabled: bool,

    /// Time window in seconds for temporal correlation
    ///
    /// Alerts within this window may be grouped even without dimension match.
    /// Recommended: 300s (5 minutes) for related failures, 60s (1 minute) for cascading failures.
    #[serde(default = "default_temporal_window")]
    pub temporal_window_seconds: i64,

    /// Minimum number of alerts required to create an incident
    ///
    /// Alerts below this threshold are tracked but don't create incidents.
    /// Recommended: 2 (prevents single noisy alert from creating incident).
    ///
    /// **Note**: Current implementation drops alerts below threshold (see Issue #7).
    #[serde(default = "default_min_alerts")]
    pub min_alerts_for_incident: usize,
}

/// Default temporal correlation window: 5 minutes
fn default_temporal_window() -> i64 {
    300
}

/// Default minimum alerts for incident: 2
fn default_min_alerts() -> usize {
    2
}

impl Default for CorrelationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            correlation_dimensions: vec![],
            require_dimension_match: false,
            temporal_fallback_enabled: true,
            temporal_window_seconds: default_temporal_window(),
            min_alerts_for_incident: default_min_alerts(),
        }
    }
}

impl CorrelationConfig {
    /// Validate the correlation configuration
    pub fn validate(&self) -> Result<(), String> {
        if self.enabled {
            // If semantic correlation enabled, must have dimensions
            if !self.correlation_dimensions.is_empty() {
                // Validate dimension IDs (kebab-case)
                for dim in &self.correlation_dimensions {
                    if dim.is_empty() {
                        return Err("Correlation dimension ID cannot be empty".to_string());
                    }
                    if !dim
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                    {
                        return Err(format!(
                            "Invalid correlation dimension ID '{dim}': must be lowercase with dashes only"
                        ));
                    }
                }

                // Max 10 dimensions
                if self.correlation_dimensions.len() > 10 {
                    return Err("Maximum 10 correlation dimensions allowed".to_string());
                }
            }

            // Temporal window must be positive
            if self.temporal_window_seconds <= 0 {
                return Err("Temporal window must be positive".to_string());
            }

            // Min alerts must be at least 2
            if self.min_alerts_for_incident < 2 {
                return Err("Minimum alerts for incident must be at least 2".to_string());
            }

            // If no dimensions and temporal fallback disabled, correlation is meaningless
            if self.correlation_dimensions.is_empty() && !self.temporal_fallback_enabled {
                return Err(
                    "Must enable either semantic dimensions or temporal fallback".to_string(),
                );
            }
        }

        Ok(())
    }

    /// Get a default configuration for common use cases
    pub fn default_service_host() -> Self {
        Self {
            enabled: true,
            correlation_dimensions: vec!["service".to_string(), "host".to_string()],
            require_dimension_match: true,
            temporal_fallback_enabled: true,
            temporal_window_seconds: 300,
            min_alerts_for_incident: 2,
        }
    }

    /// Get a default configuration for Kubernetes environments
    pub fn default_kubernetes() -> Self {
        Self {
            enabled: true,
            correlation_dimensions: vec![
                "k8s-cluster".to_string(),
                "k8s-namespace".to_string(),
                "service".to_string(),
            ],
            require_dimension_match: true,
            temporal_fallback_enabled: true,
            temporal_window_seconds: 300,
            min_alerts_for_incident: 2,
        }
    }
}

/// The status of an alert incident
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IncidentStatus {
    Open,
    Acknowledged,
    Resolved,
}

impl IncidentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Acknowledged => "acknowledged",
            Self::Resolved => "resolved",
        }
    }
}

impl std::fmt::Display for IncidentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for IncidentStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "open" => Ok(Self::Open),
            "acknowledged" => Ok(Self::Acknowledged),
            "resolved" => Ok(Self::Resolved),
            _ => Err(format!("Invalid incident status: {s}")),
        }
    }
}

/// The type of correlation match that grouped alerts together
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CorrelationType {
    /// All alerts matched via semantic fields
    SemanticFields,
    /// Mix of semantic and temporal matches
    Mixed,
    /// All alerts matched via temporal proximity only
    TemporalOnly,
}

impl CorrelationType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SemanticFields => "semantic_fields",
            Self::Mixed => "mixed",
            Self::TemporalOnly => "temporal_only",
        }
    }
}

impl std::fmt::Display for CorrelationType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Confidence level of the correlation
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum CorrelationConfidence {
    High,
    Medium,
    Low,
}

impl CorrelationConfidence {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
        }
    }
}

impl std::fmt::Display for CorrelationConfidence {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// The type of match for an individual alert in an incident
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MatchType {
    /// Matched via semantic field dimensions
    SemanticFields,
    /// Matched via temporal proximity only
    TemporalOnly,
}

impl MatchType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SemanticFields => "semantic_fields",
            Self::TemporalOnly => "temporal_only",
        }
    }
}

impl std::fmt::Display for MatchType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_correlation_config_validation() {
        let mut config = CorrelationConfig::default();

        // Default disabled config should be valid
        assert!(config.validate().is_ok());

        // Enabled with valid dimensions
        config.enabled = true;
        config.correlation_dimensions = vec!["service".to_string(), "host".to_string()];
        assert!(config.validate().is_ok());

        // Invalid dimension ID (uppercase)
        config.correlation_dimensions = vec!["Service".to_string()];
        assert!(config.validate().is_err());

        // Invalid dimension ID (underscore)
        config.correlation_dimensions = vec!["service_name".to_string()];
        assert!(config.validate().is_err());

        // Too many dimensions
        config.correlation_dimensions = vec!["a".to_string(); 11];
        assert!(config.validate().is_err());

        // Valid dimension IDs
        config.correlation_dimensions = vec!["service".to_string(), "k8s-cluster".to_string()];
        assert!(config.validate().is_ok());

        // Invalid: no dimensions and no temporal fallback
        config.correlation_dimensions = vec![];
        config.temporal_fallback_enabled = false;
        assert!(config.validate().is_err());

        // Valid: temporal fallback only
        config.temporal_fallback_enabled = true;
        assert!(config.validate().is_ok());

        // Invalid temporal window
        config.temporal_window_seconds = -1;
        assert!(config.validate().is_err());

        config.temporal_window_seconds = 0;
        assert!(config.validate().is_err());

        // Invalid min alerts
        config.temporal_window_seconds = 300;
        config.min_alerts_for_incident = 1;
        assert!(config.validate().is_err());

        config.min_alerts_for_incident = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_default_presets() {
        let service_host = CorrelationConfig::default_service_host();
        assert!(service_host.enabled);
        assert_eq!(service_host.correlation_dimensions.len(), 2);
        assert!(service_host.validate().is_ok());

        let k8s = CorrelationConfig::default_kubernetes();
        assert!(k8s.enabled);
        assert_eq!(k8s.correlation_dimensions.len(), 3);
        assert!(k8s.validate().is_ok());
    }

    #[test]
    fn test_incident_status_parsing() {
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
            IncidentStatus::from_str("Resolved").unwrap(),
            IncidentStatus::Resolved
        );
        assert!(IncidentStatus::from_str("invalid").is_err());
    }

    #[test]
    fn test_serialization() {
        let config = CorrelationConfig::default_service_host();
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: CorrelationConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, deserialized);
    }
}
