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

//! Correlation types for service identity and telemetry correlation.
//!
//! This module contains types used for:
//! - Service FQN (Fully Qualified Name) derivation
//! - Semantic field groups for dimension extraction
//! - Cross-telemetry correlation (logs, traces, metrics)

use itertools::Itertools;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Semantic field group - defines field names that represent the same entity
///
/// Used for:
/// - Service FQN derivation (scope vs workload dimensions)
/// - Alert deduplication fingerprinting
/// - Cross-telemetry correlation
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
    pub display: String,

    /// Category/group this semantic field belongs to (e.g., "Common", "Kubernetes", "AWS", "GCP",
    /// "Azure") Used for UI organization and preset templates
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,

    /// List of field names that are equivalent (e.g., ["host", "hostname", "node"])
    ///
    /// Note: Field names can overlap with other groups. First-defined group wins.
    pub fields: Vec<String>,

    /// Whether to normalize values (lowercase + trim)
    #[serde(default)]
    pub normalize: bool,

    /// Whether this dimension is stable (low cardinality) and should be used for correlation key
    ///
    /// Stable dimensions (true): service, environment, k8s-cluster, k8s-namespace, k8s-deployment
    /// Transient dimensions (false): k8s-pod, host, ip-address, container-id, trace-id
    ///
    /// Stable dimensions are used to compute correlation_key which prevents DB explosion.
    /// Transient dimensions are stored but not used for service record identity.
    #[serde(default = "default_is_stable")]
    pub is_stable: bool,

    /// Whether this dimension is a scope dimension for FQN derivation
    ///
    /// Scope dimensions define environmental boundaries and are concatenated with "/"
    /// to form the scope part of the compound FQN: {scope}/{workload}
    ///
    /// Scope dimensions (true): k8s-cluster, region, cloud-account, host, azure-resource-group
    /// Workload dimensions (false): k8s-deployment, k8s-statefulset, aws-ecs-task, service
    ///
    /// Example with k8s-cluster as scope and k8s-deployment as workload:
    /// FQN = "do_openobserve_ai/o2-openobserve-querier"
    ///
    /// Users can toggle this to customize FQN derivation for their environment.
    /// For multi-tenant K8s clusters, enable is_scope on k8s-namespace to get:
    /// FQN = "do_openobserve_ai/production/o2-openobserve-querier"
    #[serde(default = "default_is_scope")]
    pub is_scope: bool,
}

fn default_is_stable() -> bool {
    false // Conservative default: assume dimensions are transient unless marked stable
}

fn default_is_scope() -> bool {
    false // Conservative default: assume dimensions are workload (not scope) unless marked
}

impl SemanticFieldGroup {
    pub fn new(
        id: impl Into<String>,
        display: impl Into<String>,
        fields: &[&str],
        normalize: bool,
    ) -> Self {
        let fields = fields.iter().map(|v| v.to_string()).collect_vec();

        Self {
            id: id.into(),
            display: display.into(),
            group: None,
            fields,
            normalize,
            is_stable: false, // Default to transient
            is_scope: false,  // Default to workload (not scope)
        }
    }

    pub fn new_stable(
        id: impl Into<String>,
        display: impl Into<String>,
        fields: &[&str],
        normalize: bool,
        is_stable: bool,
    ) -> Self {
        let fields = fields.iter().map(|v| v.to_string()).collect_vec();

        Self {
            id: id.into(),
            display: display.into(),
            group: None,
            fields,
            normalize,
            is_stable,
            is_scope: false, // Default to workload (not scope)
        }
    }

    /// Create a new semantic field group with full configuration including scope
    pub fn new_full(
        id: impl Into<String>,
        display: impl Into<String>,
        fields: &[&str],
        normalize: bool,
        is_stable: bool,
        is_scope: bool,
    ) -> Self {
        let fields = fields.iter().map(|v| v.to_string()).collect_vec();

        Self {
            id: id.into(),
            display: display.into(),
            group: None,
            fields,
            normalize,
            is_stable,
            is_scope,
        }
    }

    pub fn with_group(
        id: impl Into<String>,
        display: impl Into<String>,
        group: impl Into<String>,
        fields: &[&str],
        normalize: bool,
    ) -> Self {
        let fields = fields.iter().map(|v| v.to_string()).collect_vec();

        Self {
            id: id.into(),
            display: display.into(),
            group: Some(group.into()),
            fields,
            normalize,
            is_stable: false, // Default to transient
            is_scope: false,  // Default to workload (not scope)
        }
    }

    pub fn with_group_stable(
        id: impl Into<String>,
        display: impl Into<String>,
        group: impl Into<String>,
        fields: &[&str],
        normalize: bool,
        is_stable: bool,
    ) -> Self {
        let fields = fields.iter().map(|v| v.to_string()).collect_vec();

        Self {
            id: id.into(),
            display: display.into(),
            group: Some(group.into()),
            fields,
            normalize,
            is_stable,
            is_scope: false, // Default to workload (not scope)
        }
    }

    /// Create a new semantic field group with group, stability, and scope configuration
    pub fn with_group_full(
        id: impl Into<String>,
        display: impl Into<String>,
        group: impl Into<String>,
        fields: &[&str],
        normalize: bool,
        is_stable: bool,
        is_scope: bool,
    ) -> Self {
        let fields = fields.iter().map(|v| v.to_string()).collect_vec();

        Self {
            id: id.into(),
            display: display.into(),
            group: Some(group.into()),
            fields,
            normalize,
            is_stable,
            is_scope,
        }
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

    /// Get default semantic groups for common use cases
    ///
    /// **NOTE**: This is a minimal OSS fallback. The canonical source of defaults
    /// for enterprise builds is in:
    /// `o2-enterprise/o2_enterprise/src/enterprise/alerts/default_semantic_groups.json`
    ///
    /// Enterprise code should call
    /// `o2_enterprise::enterprise::alerts::semantic_config::load_defaults_from_file()`
    /// instead.
    #[allow(dead_code)]
    pub fn default_presets() -> Vec<Self> {
        vec![]
    }

    /// Load default semantic groups
    ///
    /// For OSS builds, this returns the minimal preset.
    /// For enterprise builds with full JSON, call
    /// `o2_enterprise::enterprise::alerts::semantic_config::load_defaults_from_file()`
    /// instead.
    pub fn load_defaults_from_file() -> Vec<Self> {
        // OSS fallback: return minimal preset
        Self::default_presets()
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
    fn test_semantic_field_group_new() {
        let group = SemanticFieldGroup::new("host", "Host", &["host", "hostname"], true);
        assert_eq!(group.id, "host");
        assert_eq!(group.display, "Host");
        assert_eq!(group.fields, vec!["host", "hostname"]);
        assert!(group.normalize);
        assert!(!group.is_stable);
        assert!(!group.is_scope);
    }

    #[test]
    fn test_semantic_field_group_new_full() {
        let group = SemanticFieldGroup::new_full(
            "k8s-cluster",
            "K8s Cluster",
            &["cluster"],
            false,
            true,
            true,
        );
        assert_eq!(group.id, "k8s-cluster");
        assert!(group.is_stable);
        assert!(group.is_scope);
    }

    #[test]
    fn test_default_presets() {
        // OSS builds return empty defaults - semantic groups are loaded from
        // enterprise JSON or configured via API
        let presets = SemanticFieldGroup::default_presets();
        assert!(presets.is_empty());
    }
}
