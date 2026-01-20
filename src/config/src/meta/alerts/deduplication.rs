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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// SemanticFieldGroup has been moved to config::meta::correlation::SemanticFieldGroup
// Import it for use within this module only (for GlobalDeduplicationConfig)
use crate::meta::correlation::SemanticFieldGroup;

/// Organization-level deduplication configuration (Global settings)
///
/// This configuration is stored at the organization level and defines:
/// - Whether deduplication is enabled globally
/// - Semantic field groups that map field name variations to canonical dimensions
/// - Cross-alert deduplication based on shared semantic dimensions
/// - Default time window for deduplication
///
/// Per-alert fingerprint fields are stored in the Alert.deduplication field.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Default)]
#[serde(default)]
pub struct GlobalDeduplicationConfig {
    /// Enable/disable deduplication globally for this organization
    #[serde(default)]
    pub enabled: bool,

    /// Semantic field groups - defines field name equivalences
    ///
    /// Defines how field names from different data sources map to canonical dimensions.
    /// Example: `["host", "hostname", "server"]` all map to semantic group ID "host".
    ///
    /// These groups are used for:
    /// 1. Mapping per-alert fingerprint_fields to semantic dimensions
    /// 2. Cross-alert deduplication (if enabled)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub semantic_field_groups: Vec<SemanticFieldGroup>,

    /// Enable cross-alert deduplication based on shared semantic dimensions
    ///
    /// When true, alerts from DIFFERENT alert rules that share semantic dimensions
    /// will be deduplicated if one already fired recently.
    ///
    /// Example:
    /// - Alert A fires: {host: "srv01", service: "api"}
    /// - Alert B fires 30s later: {host: "srv01", region: "us-east"}
    /// - If cross_alert_dedup=true: Alert B suppressed (shares "host" dimension)
    /// - If cross_alert_dedup=false: Both sent (per-alert dedup only)
    #[serde(default)]
    pub alert_dedup_enabled: bool,

    /// Semantic group IDs to use for cross-alert fingerprinting
    ///
    /// When cross_alert_dedup is enabled, these semantic group IDs are used
    /// to generate fingerprints across all alerts (instead of per-alert fingerprint_fields).
    /// Must reference IDs from semantic_field_groups.
    ///
    /// Example: ["host", "service"] means fingerprint = hash(host_value + service_value)
    /// Required when cross_alert_dedup is true.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alert_fingerprint_groups: Vec<String>,

    /// Default time window in minutes for deduplication
    ///
    /// Alerts with the same fingerprint within this window are suppressed.
    /// If None, defaults to 2x the alert evaluation frequency.
    /// Can be overridden per-alert.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_window_minutes: Option<i64>,

    /// FQN (Fully Qualified Name) priority dimensions for service correlation
    ///
    /// Defines which semantic dimensions are used to derive the service-fqn,
    /// in priority order. The first dimension with a value wins.
    ///
    /// Default priority (if empty):
    /// 1. k8s-deployment, k8s-statefulset, k8s-daemonset, k8s-job (K8s workloads)
    /// 2. aws-ecs-task, faas-name, gcp-cloud-run, azure-cloud-role (Cloud workloads)
    /// 3. process-name (Bare metal)
    /// 4. service (Fallback)
    ///
    /// Example custom priority: ["k8s-deployment", "aws-ecs-task", "service"]
    /// This would skip statefulset/daemonset and use deployment directly.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fqn_priority_dimensions: Vec<String>,
}

/// Per-alert deduplication configuration (from main branch)
///
/// This is stored on each Alert and specifies which fields to use for fingerprinting.
/// This matches the structure from the main branch exactly.
/// Configuration for alert deduplication
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Default)]
#[serde(default)]
pub struct DeduplicationConfig {
    /// Enable/disable deduplication
    #[serde(default)]
    pub enabled: bool,

    /// Fields from query results to use for fingerprinting
    /// If empty, auto-detect based on query type:
    /// - Custom: Fields from query conditions
    /// - SQL: GROUP BY columns
    /// - PromQL: All label dimensions
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fingerprint_fields: Vec<String>,

    /// Time window in minutes for deduplication
    /// If None, defaults to 2x alert frequency
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_window_minutes: Option<i64>,

    /// Optional alert grouping configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grouping: Option<GroupingConfig>,
}

/// Configuration for alert grouping
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct GroupingConfig {
    /// Enable alert grouping
    #[serde(default)]
    pub enabled: bool,

    /// Maximum number of alerts in a single group
    #[serde(default = "default_max_group_size")]
    pub max_group_size: usize,

    /// How to send grouped notifications
    #[serde(default)]
    pub send_strategy: SendStrategy,

    /// Initial wait time before sending first notification (seconds)
    #[serde(default = "default_group_wait")]
    pub group_wait_seconds: i64,
}

impl Default for GroupingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            max_group_size: default_max_group_size(),
            send_strategy: SendStrategy::default(),
            group_wait_seconds: default_group_wait(),
        }
    }
}

/// Strategy for sending grouped alert notifications
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SendStrategy {
    /// Send only the first alert with a count of others
    #[default]
    #[serde(rename = "first_with_count")]
    FirstWithCount,

    /// Send an aggregated summary of all alerts
    Summary,

    /// Send all alerts in one notification
    All,
}

impl std::str::FromStr for SendStrategy {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "first_with_count" => Ok(Self::FirstWithCount),
            "summary" => Ok(Self::Summary),
            "all" => Ok(Self::All),
            _ => Ok(Self::default()),
        }
    }
}

fn default_max_group_size() -> usize {
    100
}

fn default_group_wait() -> i64 {
    30
}

impl GlobalDeduplicationConfig {
    /// Validate the organization-level deduplication configuration
    pub fn validate(&self) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }

        // Validate cross-alert fingerprint groups reference existing semantic groups
        if self.alert_dedup_enabled && !self.alert_fingerprint_groups.is_empty() {
            let semantic_group_ids: std::collections::HashSet<_> =
                self.semantic_field_groups.iter().map(|g| &g.id).collect();

            for group_id in &self.alert_fingerprint_groups {
                if !semantic_group_ids.contains(group_id) {
                    return Err(format!(
                        "Cross-alert fingerprint group '{}' not found in semantic_field_groups",
                        group_id
                    ));
                }
            }
        }

        // Require at least one fingerprint group when cross-alert dedup is enabled
        if self.alert_dedup_enabled && self.alert_fingerprint_groups.is_empty() {
            return Err(
                "cross_alert_fingerprint_groups is required when cross_alert_dedup is enabled"
                    .to_string(),
            );
        }

        // Validate semantic groups
        if self.semantic_field_groups.len() > 50 {
            return Err("Maximum 50 semantic groups allowed per organization".to_string());
        }

        let mut seen_ids = std::collections::HashSet::new();
        let mut field_name_to_group: std::collections::HashMap<&String, &String> =
            std::collections::HashMap::new();

        for group in &self.semantic_field_groups {
            // Validate ID format
            if !SemanticFieldGroup::validate_id(&group.id) {
                return Err(format!(
                    "Invalid semantic group ID '{}': must be lowercase, alphanumeric, dash-separated",
                    group.id
                ));
            }

            // Validate ID uniqueness
            if !seen_ids.insert(&group.id) {
                return Err(format!("Duplicate semantic group ID: {}", group.id));
            }

            // Validate display name
            if group.display.is_empty() {
                return Err(format!(
                    "Display name required for semantic group '{}'",
                    group.id
                ));
            }

            // Validate field names
            if group.fields.is_empty() {
                return Err(format!(
                    "Semantic group '{}' must have at least one field name",
                    group.id
                ));
            }

            if group.fields.len() > 20 {
                return Err(format!(
                    "Semantic group '{}' has too many field names (max 20)",
                    group.id
                ));
            }

            // Track field name overlaps (warn but allow)
            // Precedence: first-defined group wins when extracting dimensions
            for field_name in &group.fields {
                if let Some(existing_group_id) = field_name_to_group.get(field_name) {
                    log::warn!(
                        "[deduplication] Field name '{field_name}' appears in multiple semantic groups: '{existing_group_id}' and '{}'. Using first occurrence (group '{existing_group_id}').",
                        group.id
                    );
                } else {
                    field_name_to_group.insert(field_name, &group.id);
                }
            }
        }

        Ok(())
    }

    /// Get default configuration with common semantic groups
    pub fn default_with_presets() -> Self {
        Self {
            enabled: false,
            semantic_field_groups: SemanticFieldGroup::load_defaults_from_file(),
            alert_dedup_enabled: false,
            alert_fingerprint_groups: vec![],
            time_window_minutes: None,
            fqn_priority_dimensions: Self::default_fqn_priority(),
        }
    }

    /// Get default FQN priority dimensions
    ///
    /// For OSS builds, returns empty (must be configured).
    /// For enterprise builds, ServiceStreamsConfig provides the full default list.
    ///
    /// Default priority order for deriving service-fqn (first match wins):
    /// 1. K8s workload: deployment, statefulset, daemonset, job
    /// 2. Cloud workload: ECS task family, Lambda function, Cloud Run service
    /// 3. Bare metal: process name
    /// 4. Fallback: service dimension
    pub fn default_fqn_priority() -> Vec<String> {
        // OSS builds return empty - enterprise provides defaults via ServiceStreamsConfig
        vec![]
    }

    /// Map a field name to its semantic group ID
    ///
    /// Returns the first matching semantic group ID, or None if no match.
    /// Used for reverse lookup: actual field name → semantic dimension.
    pub fn get_semantic_group_id(&self, field_name: &str) -> Option<&str> {
        for group in &self.semantic_field_groups {
            if group.fields.iter().any(|f| f == field_name) {
                return Some(&group.id);
            }
        }
        None
    }

    /// Extract semantic dimensions from a result row
    ///
    /// Maps actual field names to semantic group IDs and extracts their values.
    /// Returns a map of semantic_group_id → value.
    ///
    /// Example:
    /// - Input fields: ["hostname", "service_name"]
    /// - Input row: {"hostname": "srv01", "service_name": "api", "other": "data"}
    /// - Output: {"host": "srv01", "service": "api"}
    pub fn extract_semantic_dimensions(
        &self,
        field_names: &[String],
        result_row: &std::collections::HashMap<String, String>,
    ) -> std::collections::HashMap<String, String> {
        let mut dimensions = std::collections::HashMap::new();

        for field_name in field_names {
            if let Some(semantic_id) = self.get_semantic_group_id(field_name) {
                if let Some(value) = result_row.get(field_name) {
                    // Find the semantic group to check if normalization is needed
                    if let Some(group) = self
                        .semantic_field_groups
                        .iter()
                        .find(|g| g.id == semantic_id)
                    {
                        let normalized_value = if group.normalize {
                            value.to_lowercase().trim().to_string()
                        } else {
                            value.clone()
                        };
                        dimensions.insert(semantic_id.to_string(), normalized_value);
                    }
                }
            } else {
                // Field not in semantic groups - use as-is
                if let Some(value) = result_row.get(field_name) {
                    dimensions.insert(field_name.clone(), value.clone());
                }
            }
        }

        dimensions
    }
}

impl DeduplicationConfig {
    /// Validate the per-alert deduplication configuration
    pub fn validate(&self) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }

        // Fingerprint fields can be empty (will auto-detect)
        if self.fingerprint_fields.len() > 10 {
            return Err("Maximum 10 fingerprint fields allowed per alert".to_string());
        }

        // Time window must be positive if set
        if let Some(window) = self.time_window_minutes
            && window <= 0
        {
            return Err("Time window must be positive".to_string());
        }

        // Validate grouping config if present
        if let Some(grouping) = &self.grouping
            && grouping.enabled
        {
            if grouping.max_group_size == 0 {
                return Err("Max group size must be at least 1".to_string());
            }
            if grouping.group_wait_seconds < 0 {
                return Err("Group wait seconds must be non-negative".to_string());
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_semantic_field_group_id_validation() {
        assert!(SemanticFieldGroup::validate_id("host"));
        assert!(SemanticFieldGroup::validate_id("k8s-cluster"));
        assert!(SemanticFieldGroup::validate_id("service-123"));

        assert!(!SemanticFieldGroup::validate_id(""));
        assert!(!SemanticFieldGroup::validate_id("Host"));
        assert!(!SemanticFieldGroup::validate_id("k8s_cluster"));
        assert!(!SemanticFieldGroup::validate_id("-host"));
        assert!(!SemanticFieldGroup::validate_id("host-"));
        assert!(!SemanticFieldGroup::validate_id("host--name"));
    }

    #[test]
    fn test_per_alert_deduplication_config_default() {
        let config = DeduplicationConfig::default();
        assert!(!config.enabled);
        assert!(config.fingerprint_fields.is_empty());
        assert_eq!(config.time_window_minutes, None);
        assert_eq!(config.grouping, None);
    }

    #[test]
    fn test_organization_deduplication_config_default() {
        let config = GlobalDeduplicationConfig::default();
        assert!(!config.enabled);
        assert!(!config.alert_dedup_enabled);
        assert!(config.semantic_field_groups.is_empty());
        assert_eq!(config.time_window_minutes, None);
    }

    #[test]
    fn test_organization_deduplication_config_validation() {
        let mut config = GlobalDeduplicationConfig {
            enabled: true,
            alert_dedup_enabled: false,
            semantic_field_groups: vec![
                SemanticFieldGroup::new("service", "Service", &["service", "service_name"], true),
                SemanticFieldGroup::new("host", "Host", &["host", "hostname"], true),
            ],
            alert_fingerprint_groups: vec![],
            time_window_minutes: Some(10),
            fqn_priority_dimensions: vec![],
        };

        assert!(config.validate().is_ok());

        // Test invalid ID
        config.semantic_field_groups[0].id = "Invalid_ID".to_string();
        assert!(config.validate().is_err());
        config.semantic_field_groups[0].id = "service".to_string();

        // Test duplicate ID
        config.semantic_field_groups.push(SemanticFieldGroup::new(
            "service",
            "Service 2",
            &["svc"],
            true,
        ));
        assert!(config.validate().is_err());
        config.semantic_field_groups.pop();

        // Test overlapping field names - allowed with warning
        config.semantic_field_groups[1]
            .fields
            .push("service".to_string());
        assert!(config.validate().is_ok()); // Should succeed, just warns
        config.semantic_field_groups[1].fields.pop();
    }

    #[test]
    fn test_per_alert_deduplication_config_validation() {
        let mut config = DeduplicationConfig {
            enabled: true,
            fingerprint_fields: vec!["hostname".to_string(), "service".to_string()],
            time_window_minutes: Some(10),
            grouping: None,
        };

        assert!(config.validate().is_ok());

        // Test too many fingerprint fields
        config.fingerprint_fields = (0..15).map(|i| format!("field{}", i)).collect();
        assert!(config.validate().is_err());

        // Test negative time window
        config.fingerprint_fields = vec!["hostname".to_string()];
        config.time_window_minutes = Some(-1);
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_organization_config_overlapping_field_names() {
        // Test that overlapping field names are allowed (with warning)
        // Precedence: first-defined group wins
        let config = GlobalDeduplicationConfig {
            enabled: true,
            alert_dedup_enabled: false,
            semantic_field_groups: vec![
                SemanticFieldGroup::new(
                    "service-primary",
                    "Primary Service",
                    &["service", "primary_service"],
                    true,
                ),
                SemanticFieldGroup::new(
                    "service-backup",
                    "Backup Service",
                    &["service", "backup_service"],
                    true,
                ), // "service" overlaps
            ],
            alert_fingerprint_groups: vec![],
            time_window_minutes: Some(10),
            fqn_priority_dimensions: vec![],
        };

        // Should succeed - overlaps are allowed, just logged as warnings
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_organization_deduplication_config_serialization() {
        let config = GlobalDeduplicationConfig {
            enabled: true,
            alert_dedup_enabled: true,
            semantic_field_groups: vec![
                SemanticFieldGroup::new("service", "Service", &["service", "service_name"], true),
                SemanticFieldGroup::new("host", "Host", &["host", "hostname"], true),
            ],
            alert_fingerprint_groups: vec![],
            time_window_minutes: Some(10),
            fqn_priority_dimensions: vec![],
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        let deserialized: GlobalDeduplicationConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, deserialized);
    }

    #[test]
    fn test_per_alert_deduplication_config_serialization() {
        let config = DeduplicationConfig {
            enabled: true,
            fingerprint_fields: vec!["service".to_string(), "hostname".to_string()],
            time_window_minutes: Some(10),
            grouping: Some(GroupingConfig {
                enabled: true,
                max_group_size: 50,
                send_strategy: SendStrategy::Summary,
                group_wait_seconds: 60,
            }),
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        let deserialized: DeduplicationConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, deserialized);
    }

    #[test]
    fn test_per_alert_config_minimal_serialization() {
        let config = DeduplicationConfig {
            enabled: true,
            ..Default::default()
        };

        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["enabled"], true);
        // fingerprint_fields should be omitted when empty
        assert!(json.get("fingerprint_fields").is_none());
        // time_window_minutes should be omitted when None
        assert!(json.get("time_window_minutes").is_none());
        // grouping should be omitted when None
        assert!(json.get("grouping").is_none());
    }

    #[test]
    fn test_organization_config_minimal_serialization() {
        let config = GlobalDeduplicationConfig {
            enabled: true,
            ..Default::default()
        };

        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["enabled"], true);
        // semantic_field_groups should be omitted when empty
        assert!(json.get("semantic_field_groups").is_none());
        // time_window_minutes should be omitted when None
        assert!(json.get("time_window_minutes").is_none());
        // alert_dedup_enabled should be false by default
        assert_eq!(
            json.get("alert_dedup_enabled").and_then(|v| v.as_bool()),
            Some(false)
        );
    }

    #[test]
    fn test_default_presets() {
        // OSS builds return empty defaults - semantic groups are loaded from
        // enterprise JSON or configured via API
        let presets = SemanticFieldGroup::default_presets();
        assert!(presets.is_empty());
    }
}
