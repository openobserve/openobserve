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

/// Semantic field group - defines field names that represent the same entity
///
/// # Field Name Overlaps
///
/// Field names can appear in multiple semantic groups. When extracting dimensions,
/// the **first-defined group** takes precedence. This allows flexible configurations
/// where a field like "service" can have different meanings in different contexts.
///
/// Example:
/// ```
/// // Group 1: service-primary (defined first)
/// //   field_names: ["service", "primary_service"]
/// //
/// // Group 2: service-backup (defined second)
/// //   field_names: ["service", "backup_service"]
/// //
/// // When extracting dimensions from {"service": "api"}:
/// // → Matches "service-primary" group (first occurrence wins)
/// ```
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct SemanticFieldGroup {
    /// Unique identifier (lowercase, dash-separated, e.g., "host", "k8s-cluster")
    pub id: String,

    /// Human-readable display name (e.g., "Host", "K8s Cluster")
    pub display_name: String,

    /// List of field names that are equivalent (e.g., ["host", "hostname", "node"])
    ///
    /// Note: Field names can overlap with other groups. First-defined group wins.
    pub field_names: Vec<String>,

    /// Whether to normalize values (lowercase + trim)
    #[serde(default)]
    pub normalize: bool,
}

impl SemanticFieldGroup {
    /// Get default semantic groups for common use cases
    pub fn default_presets() -> Vec<SemanticFieldGroup> {
        vec![
            // Common groups
            SemanticFieldGroup {
                id: "host".to_string(),
                display_name: "Host".to_string(),
                field_names: vec![
                    "host".to_string(),
                    "hostname".to_string(),
                    "node".to_string(),
                    "node_name".to_string(),
                    "server".to_string(),
                    "machine".to_string(),
                ],
                normalize: true,
            },
            SemanticFieldGroup {
                id: "ip-address".to_string(),
                display_name: "IP Address".to_string(),
                field_names: vec![
                    "ip".to_string(),
                    "ipaddr".to_string(),
                    "ip_address".to_string(),
                    "ip_addr".to_string(),
                    "client_ip".to_string(),
                    "source_ip".to_string(),
                    "host_ip".to_string(),
                ],
                normalize: true,
            },
            SemanticFieldGroup {
                id: "service".to_string(),
                display_name: "Service".to_string(),
                field_names: vec![
                    "service".to_string(),
                    "service_name".to_string(),
                    "svc".to_string(),
                    "app".to_string(),
                    "application".to_string(),
                    "app_name".to_string(),
                ],
                normalize: true,
            },
            // Kubernetes groups
            SemanticFieldGroup {
                id: "k8s-cluster".to_string(),
                display_name: "K8s Cluster".to_string(),
                field_names: vec![
                    "k8s_cluster".to_string(),
                    "cluster".to_string(),
                    "cluster_name".to_string(),
                    "cluster_id".to_string(),
                ],
                normalize: false,
            },
            SemanticFieldGroup {
                id: "k8s-namespace".to_string(),
                display_name: "K8s Namespace".to_string(),
                field_names: vec![
                    "k8s_namespace".to_string(),
                    "namespace".to_string(),
                    "k8s_ns".to_string(),
                    "ns".to_string(),
                ],
                normalize: false,
            },
            SemanticFieldGroup {
                id: "k8s-pod".to_string(),
                display_name: "K8s Pod".to_string(),
                field_names: vec![
                    "k8s_pod".to_string(),
                    "pod".to_string(),
                    "pod_name".to_string(),
                    "pod_id".to_string(),
                ],
                normalize: false,
            },
            SemanticFieldGroup {
                id: "k8s-node".to_string(),
                display_name: "K8s Node".to_string(),
                field_names: vec![
                    "k8s_node".to_string(),
                    "node".to_string(),
                    "node_name".to_string(),
                    "kubernetes_node".to_string(),
                ],
                normalize: false,
            },
            SemanticFieldGroup {
                id: "k8s-container".to_string(),
                display_name: "K8s Container".to_string(),
                field_names: vec![
                    "container".to_string(),
                    "container_name".to_string(),
                    "container_id".to_string(),
                    "k8s_container".to_string(),
                ],
                normalize: false,
            },
        ]
    }

    /// Validate semantic field group ID format
    pub fn validate_id(id: &str) -> bool {
        if id.is_empty() {
            return false;
        }
        // Lowercase, alphanumeric, dash-separated
        id.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            && !id.starts_with('-')
            && !id.ends_with('-')
            && !id.contains("--")
    }
}

/// Configuration for alert deduplication
///
/// # Naming Convention
///
/// This config uses `fingerprint_fields` (not `deduplication_dimensions`) to distinguish
/// from `CorrelationConfig::correlation_dimensions`:
/// - **fingerprint_fields**: Semantic group IDs used for *identifying* duplicate alert firings
/// - **correlation_dimensions**: Semantic group IDs used for *matching* alerts to incidents
///
/// The term "fields" emphasizes we're building a unique fingerprint, while "dimensions"
/// in correlation emphasizes the multi-dimensional matching space.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Default)]
#[serde(default)]
pub struct DeduplicationConfig {
    /// Enable/disable deduplication
    #[serde(default)]
    pub enabled: bool,

    /// Semantic field groups - defines field name equivalences
    ///
    /// Defines how field names from different data sources map to canonical dimensions.
    /// Example: `["host", "hostname", "server"]` all map to semantic group ID "host".
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub semantic_field_groups: Vec<SemanticFieldGroup>,

    /// Fingerprint fields - semantic group IDs to use for deduplication
    ///
    /// These define which dimensions to include when calculating alert fingerprints.
    /// Alerts with the same fingerprint within the time window are considered duplicates.
    ///
    /// Example: `["service", "host"]` means alerts are unique per service+host combination.
    ///
    /// Note: Called "fields" (not "dimensions") to emphasize fingerprint construction.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fingerprint_fields: Vec<String>,

    /// Time window in minutes for deduplication
    ///
    /// Alerts with the same fingerprint within this window are suppressed.
    /// If None, defaults to 2x the alert evaluation frequency.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_window_minutes: Option<i64>,
}

impl DeduplicationConfig {
    /// Validate the deduplication configuration
    pub fn validate(&self) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }

        // Validate semantic groups
        if self.semantic_field_groups.len() > 50 {
            return Err("Maximum 50 semantic groups allowed per alert".to_string());
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
            if group.display_name.is_empty() {
                return Err(format!(
                    "Display name required for semantic group '{}'",
                    group.id
                ));
            }

            // Validate field names
            if group.field_names.is_empty() {
                return Err(format!(
                    "Semantic group '{}' must have at least one field name",
                    group.id
                ));
            }

            if group.field_names.len() > 20 {
                return Err(format!(
                    "Semantic group '{}' has too many field names (max 20)",
                    group.id
                ));
            }

            // Track field name overlaps (warn but allow)
            // Precedence: first-defined group wins when extracting dimensions
            for field_name in &group.field_names {
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

        // Validate fingerprint fields
        if self.fingerprint_fields.is_empty() {
            return Err(
                "At least one fingerprint field required when deduplication is enabled".to_string(),
            );
        }

        if self.fingerprint_fields.len() > 10 {
            return Err("Maximum 10 fingerprint fields allowed".to_string());
        }

        // Validate fingerprint fields reference existing semantic groups
        for field_id in &self.fingerprint_fields {
            if !seen_ids.contains(field_id) {
                return Err(format!(
                    "Fingerprint field '{field_id}' does not reference a defined semantic group"
                ));
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
        assert!(SemanticFieldGroup::validate_id("ip-address"));
        assert!(SemanticFieldGroup::validate_id("service-123"));

        assert!(!SemanticFieldGroup::validate_id(""));
        assert!(!SemanticFieldGroup::validate_id("Host"));
        assert!(!SemanticFieldGroup::validate_id("k8s_cluster"));
        assert!(!SemanticFieldGroup::validate_id("-host"));
        assert!(!SemanticFieldGroup::validate_id("host-"));
        assert!(!SemanticFieldGroup::validate_id("host--name"));
    }

    #[test]
    fn test_deduplication_config_default() {
        let config = DeduplicationConfig::default();
        assert!(!config.enabled);
        assert!(config.semantic_field_groups.is_empty());
        assert!(config.fingerprint_fields.is_empty());
        assert_eq!(config.time_window_minutes, None);
    }

    #[test]
    fn test_deduplication_config_validation() {
        let mut config = DeduplicationConfig {
            enabled: true,
            semantic_field_groups: vec![
                SemanticFieldGroup {
                    id: "service".to_string(),
                    display_name: "Service".to_string(),
                    field_names: vec!["service".to_string(), "service_name".to_string()],
                    normalize: true,
                },
                SemanticFieldGroup {
                    id: "host".to_string(),
                    display_name: "Host".to_string(),
                    field_names: vec!["host".to_string(), "hostname".to_string()],
                    normalize: true,
                },
            ],
            fingerprint_fields: vec!["service".to_string(), "host".to_string()],
            time_window_minutes: Some(10),
        };

        assert!(config.validate().is_ok());

        // Test invalid ID
        config.semantic_field_groups[0].id = "Invalid_ID".to_string();
        assert!(config.validate().is_err());
        config.semantic_field_groups[0].id = "service".to_string();

        // Test duplicate ID
        config.semantic_field_groups.push(SemanticFieldGroup {
            id: "service".to_string(),
            display_name: "Service 2".to_string(),
            field_names: vec!["svc".to_string()],
            normalize: true,
        });
        assert!(config.validate().is_err());
        config.semantic_field_groups.pop();

        // Test overlapping field names - now allowed with warning
        config.semantic_field_groups[1]
            .field_names
            .push("service".to_string());
        assert!(config.validate().is_ok()); // Should succeed, just warns
        config.semantic_field_groups[1].field_names.pop();

        // Test invalid fingerprint field reference
        config.fingerprint_fields.push("nonexistent".to_string());
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_deduplication_config_overlapping_field_names() {
        // Test that overlapping field names are allowed (with warning)
        // Precedence: first-defined group wins
        let config = DeduplicationConfig {
            enabled: true,
            semantic_field_groups: vec![
                SemanticFieldGroup {
                    id: "service-primary".to_string(),
                    display_name: "Primary Service".to_string(),
                    field_names: vec!["service".to_string(), "primary_service".to_string()],
                    normalize: true,
                },
                SemanticFieldGroup {
                    id: "service-backup".to_string(),
                    display_name: "Backup Service".to_string(),
                    field_names: vec!["service".to_string(), "backup_service".to_string()], /* "service" overlaps */
                    normalize: true,
                },
            ],
            fingerprint_fields: vec!["service-primary".to_string()],
            time_window_minutes: Some(10),
        };

        // Should succeed - overlaps are allowed, just logged as warnings
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_deduplication_config_serialization() {
        let config = DeduplicationConfig {
            enabled: true,
            semantic_field_groups: vec![
                SemanticFieldGroup {
                    id: "service".to_string(),
                    display_name: "Service".to_string(),
                    field_names: vec!["service".to_string(), "service_name".to_string()],
                    normalize: true,
                },
                SemanticFieldGroup {
                    id: "host".to_string(),
                    display_name: "Host".to_string(),
                    field_names: vec!["host".to_string(), "hostname".to_string()],
                    normalize: true,
                },
            ],
            fingerprint_fields: vec!["service".to_string(), "host".to_string()],
            time_window_minutes: Some(10),
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        let deserialized: DeduplicationConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, deserialized);
    }

    #[test]
    fn test_deduplication_config_minimal_serialization() {
        let config = DeduplicationConfig {
            enabled: true,
            ..Default::default()
        };

        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["enabled"], true);
        // semantic_field_groups should be omitted when empty
        assert!(json.get("semantic_field_groups").is_none());
        // fingerprint_fields should be omitted when empty
        assert!(json.get("fingerprint_fields").is_none());
        // time_window_minutes should be omitted when None
        assert!(json.get("time_window_minutes").is_none());
    }

    #[test]
    fn test_default_presets() {
        let presets = SemanticFieldGroup::default_presets();
        assert!(!presets.is_empty());

        // Check that we have common groups
        assert!(presets.iter().any(|g| g.id == "host"));
        assert!(presets.iter().any(|g| g.id == "service"));
        assert!(presets.iter().any(|g| g.id == "k8s-cluster"));

        // Validate all preset IDs
        for preset in &presets {
            assert!(SemanticFieldGroup::validate_id(&preset.id));
            assert!(!preset.display_name.is_empty());
            assert!(!preset.field_names.is_empty());
        }
    }
}
