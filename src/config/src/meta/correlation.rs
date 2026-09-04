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

//! Correlation types for service identity and telemetry correlation.

use itertools::Itertools;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Field alias group — defines a set of field names that represent the same concept.
///
/// Used for:
/// - Mapping equivalent field names across logs, traces, and metrics (e.g., `service`,
///   `service.name`, `app` all mean "service identity")
/// - Alert deduplication fingerprinting
/// - Populating `ServiceIdentityConfig` and `IncidentGroupingConfig` via the recommendations UI
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
pub struct FieldAlias {
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

    /// When true, this alias is a workload-type dimension used to build identity sets.
    /// Aliases with this flag are grouped by their `group` field to form `IdentitySet`
    /// entries with `distinguish_by` populated from those alias IDs.
    /// Aliases without this flag (HTTP, Database, System, etc.) are never used as
    /// identity set discriminators.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_workload_type: bool,
}

impl FieldAlias {
    pub fn new(id: impl Into<String>, display: impl Into<String>, fields: &[&str]) -> Self {
        let fields = fields.iter().map(|v| v.to_string()).collect_vec();

        Self {
            id: id.into(),
            display: display.into(),
            group: None,
            fields,
            is_workload_type: false,
        }
    }

    pub fn with_group(
        id: impl Into<String>,
        display: impl Into<String>,
        group: impl Into<String>,
        fields: &[&str],
    ) -> Self {
        let fields = fields.iter().map(|v| v.to_string()).collect_vec();

        Self {
            id: id.into(),
            display: display.into(),
            group: Some(group.into()),
            fields,
            is_workload_type: false,
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
    /// `o2_enterprise::enterprise::common::semantic_config::load_defaults_from_file()`
    /// instead.
    #[allow(dead_code)]
    pub fn default_presets() -> Vec<Self> {
        vec![]
    }

    /// Load default semantic groups
    ///
    /// For OSS builds, this returns the minimal preset.
    /// For enterprise builds with full JSON, call
    /// `o2_enterprise::enterprise::common::semantic_config::load_defaults_from_file()`
    /// instead.
    pub fn load_defaults_from_file() -> Vec<Self> {
        // OSS fallback: return minimal preset
        Self::default_presets()
    }
}

const MAX_SETS: usize = 5;
const MAX_DISTINGUISH_BY: usize = 5;
const MAX_GROUP_BY: usize = 5;
const MAX_TRACKED_ALIASES: usize = 30;

/// One identity set — a disambiguation scheme for one class of workloads.
///
/// The `id` is the semantic category slug (e.g. "k8s", "aws", "gcp", "azure").
/// At processing time the system tries ALL configured sets against each record and
/// ranks them by coverage of the record's non-empty dimensions: a fully-covered set
/// wins first, then the highest covered ratio, then the highest raw count; ties are
/// broken by declaration order (first-in-list). See `resolve_best_set_by_coverage`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ToSchema, PartialEq)]
pub struct IdentitySet {
    /// Semantic category slug: "k8s", "aws", "gcp", "azure", or a custom slug.
    /// Must be lowercase, alphanumeric, dash-separated (same rules as FieldAlias IDs).
    pub id: String,

    /// Human-readable display name, e.g. "Kubernetes".
    pub label: String,

    /// Semantic group IDs used for disambiguation (1..=5).
    pub distinguish_by: Vec<String>,
}

impl IdentitySet {
    pub fn validate(&self) -> Result<(), String> {
        if !FieldAlias::validate_id(&self.id) {
            return Err(format!(
                "set id '{}' is invalid (must be lowercase, alphanumeric, dash-separated, no leading/trailing/double dashes)",
                self.id
            ));
        }
        if self.label.is_empty() {
            return Err(format!("set '{}': label is required", self.id));
        }
        if self.distinguish_by.is_empty() {
            return Err(format!(
                "set '{}': distinguish_by requires at least 1 field",
                self.id
            ));
        }
        if self.distinguish_by.len() > MAX_DISTINGUISH_BY {
            return Err(format!(
                "set '{}': distinguish_by max {} fields",
                self.id, MAX_DISTINGUISH_BY
            ));
        }
        let mut seen = std::collections::HashSet::new();
        for field in &self.distinguish_by {
            if !seen.insert(field.as_str()) {
                return Err(format!(
                    "set '{}': duplicate distinguish_by field '{}'",
                    self.id, field
                ));
            }
        }
        Ok(())
    }
}

/// Org-level service identity configuration.
///
/// Contains 1–5 identity sets. Service name is always derived from the "service"
/// semantic group — hardcoded, not configurable.
///
/// At processing time each record is matched against ALL sets and ranked by
/// coverage of the record's non-empty dimensions: full coverage > highest ratio >
/// highest count, ties broken by declaration order. The same ranking is used on the
/// correlation read path so ingest files records under the set reads will select.
/// If no set has any coverage the record is skipped.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ServiceIdentityConfig {
    pub sets: Vec<IdentitySet>,

    /// Semantic alias group IDs whose values are tracked per service record.
    /// Each entry is the `id` of a `FieldAlias` group (e.g. "k8s-cluster", "environment").
    /// The "service" group is always tracked implicitly and must NOT be listed here.
    #[serde(default)]
    pub tracked_alias_ids: Vec<String>,

    /// When true, correlation matches streams to services without requiring the `service`
    /// dimension. Useful when some streams (e.g. metrics) lack `service.name` but share
    /// infrastructure attributes (e.g. `k8s-namespace`) with streams that do (e.g. logs).
    /// Trade-off: multiple services in the same namespace/cluster can collapse into one
    /// correlated bucket. Defaults to false (current behavior preserved).
    #[serde(default)]
    pub service_optional: bool,
}

impl ServiceIdentityConfig {
    /// Returns an empty config used as a bootstrap fallback.
    ///
    /// Identity sets and tracked alias IDs are not hardcoded here. Instead:
    /// - `tracked_alias_ids` is sourced from `O2_SERVICE_STREAMS_TRACKED_ALIAS_IDS` (enterprise env
    ///   config) and populated by `get_service_identity_config()` at load time.
    /// - `sets` are derived dynamically from semantic field groups where `is_workload_type=true`,
    ///   grouped by their `group` field, by the auto-configure path in
    ///   `get_service_identity_config()`.
    ///
    /// If `tracked_alias_ids` resolves to empty (env var unset or explicitly `""`), service
    /// streams processing treats the feature as disabled for that org.
    pub fn new_default() -> Self {
        Self {
            sets: vec![],
            tracked_alias_ids: vec![],
            service_optional: false,
        }
    }

    /// Validate a user-supplied config. Requires at least 1 set.
    /// (The empty default_config() is only used as a fallback before first save.)
    pub fn validate(&self) -> Result<(), String> {
        if self.sets.is_empty() {
            return Err("sets requires at least 1 identity set".into());
        }
        if self.sets.len() > MAX_SETS {
            return Err(format!("sets max {} identity sets", MAX_SETS));
        }
        let mut seen_ids = std::collections::HashSet::new();
        for set in &self.sets {
            set.validate()?;
            if !seen_ids.insert(set.id.as_str()) {
                return Err(format!("duplicate set id '{}'", set.id));
            }
        }
        // tracked_alias_ids may be empty: ingest tracking is the UNION of this list and
        // every set's distinguish_by, and >=1 set is enforced above — sets alone are
        // a complete config (custom set dims need not be re-listed here).
        if self.tracked_alias_ids.len() > MAX_TRACKED_ALIASES {
            return Err(format!(
                "tracked_alias_ids cannot exceed {} entries",
                MAX_TRACKED_ALIASES
            ));
        }
        if self.tracked_alias_ids.iter().any(|id| id == "service") {
            return Err("\"service\" is always tracked implicitly and must not be listed".into());
        }
        Ok(())
    }

    /// Pick the best-matching identity set for `dims` using best-coverage resolution.
    ///
    /// Only non-empty values in `dims` count as available. Ranking is delegated to
    /// [`resolve_best_set_by_coverage`] — full coverage > highest ratio > highest
    /// count, ties broken by declaration order. Returns `None` if no set has any
    /// coverage.
    pub fn resolve_best_set<'a>(
        &'a self,
        dims: &std::collections::HashMap<String, String>,
    ) -> Option<&'a IdentitySet> {
        let available: std::collections::HashSet<&str> = dims
            .iter()
            .filter(|(_, v)| !v.is_empty())
            .map(|(k, _)| k.as_str())
            .collect();
        resolve_best_set_by_coverage(&self.sets, &available).map(|(set, _)| set)
    }
}

/// Coverage of one identity set against a request's available dimension keys.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SetCoverage {
    pub is_full: bool,
    pub ratio: f64,
    pub count: usize,
}

impl SetCoverage {
    fn rank(&self) -> (bool, f64, usize) {
        (self.is_full, self.ratio, self.count)
    }
}

/// Shared ingest/read ranking: full coverage > highest ratio > highest count;
/// ties broken by declaration order (strict `>` keeps the earlier set).
/// Raw-count ranking is WRONG here — a 3/5 partial beating a 2/2 full set files
/// records under a set the read side will never select (cross-workload pollution).
pub fn resolve_best_set_by_coverage<'a>(
    sets: &'a [IdentitySet],
    available: &std::collections::HashSet<&str>,
) -> Option<(&'a IdentitySet, SetCoverage)> {
    let mut best: Option<(&IdentitySet, SetCoverage)> = None;
    for set in sets {
        if set.distinguish_by.is_empty() {
            continue;
        }
        let total = set.distinguish_by.len();
        let count = set
            .distinguish_by
            .iter()
            .filter(|f| available.contains(f.as_str()))
            .count();
        if count == 0 {
            continue;
        }
        let cov = SetCoverage {
            is_full: count == total,
            ratio: count as f64 / total as f64,
            count,
        };
        match &best {
            None => best = Some((set, cov)),
            Some((_, b)) if cov.rank() > b.rank() => best = Some((set, cov)),
            _ => {}
        }
    }
    best
}

/// Set IDs whose stored service rows are stale after a config change: sets that were
/// removed, plus sets whose `distinguish_by` changed (their rows' disambiguation was
/// keyed to the old field list). Rows under these IDs linger and pollute correlation
/// unions until aged out (F10) — callers should delete them and emit a reload event.
pub fn obsolete_set_ids(old: &ServiceIdentityConfig, new: &ServiceIdentityConfig) -> Vec<String> {
    old.sets
        .iter()
        .filter(
            |old_set| match new.sets.iter().find(|s| s.id == old_set.id) {
                None => true,
                Some(new_set) => new_set.distinguish_by != old_set.distinguish_by,
            },
        )
        .map(|s| s.id.clone())
        .collect()
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct IncidentGroupingConfig {
    pub group_by: Vec<String>,
    pub fallback_group_by: Vec<String>,
    #[serde(default = "default_upgrade_window")]
    pub upgrade_window_minutes: u32,
}

fn default_upgrade_window() -> u32 {
    30
}

impl IncidentGroupingConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.group_by.len() > MAX_GROUP_BY {
            return Err(format!("group_by max {} fields", MAX_GROUP_BY));
        }
        if self.fallback_group_by.len() > MAX_GROUP_BY {
            return Err(format!("fallback_group_by max {} fields", MAX_GROUP_BY));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_semantic_field_group_id_validation() {
        assert!(FieldAlias::validate_id("host"));
        assert!(FieldAlias::validate_id("k8s-cluster"));
        assert!(FieldAlias::validate_id("service-123"));

        assert!(!FieldAlias::validate_id(""));
        assert!(!FieldAlias::validate_id("Host"));
        assert!(!FieldAlias::validate_id("k8s_cluster"));
        assert!(!FieldAlias::validate_id("-host"));
        assert!(!FieldAlias::validate_id("host-"));
        assert!(!FieldAlias::validate_id("host--name"));
    }

    #[test]
    fn test_semantic_field_group_new() {
        let group = FieldAlias::new("host", "Host", &["host", "hostname"]);
        assert_eq!(group.id, "host");
        assert_eq!(group.display, "Host");
        assert_eq!(group.fields, vec!["host", "hostname"]);
    }

    #[test]
    fn test_default_presets() {
        // OSS builds return empty defaults - semantic groups are loaded from
        // enterprise JSON or configured via API
        let presets = FieldAlias::default_presets();
        assert!(presets.is_empty());
    }

    // ========== IdentitySet::validate() Tests ==========

    fn make_set(id: &str, label: &str, fields: &[&str]) -> IdentitySet {
        IdentitySet {
            id: id.to_string(),
            label: label.to_string(),
            distinguish_by: fields.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn test_identity_set_validate_ok() {
        let set = make_set("k8s", "Kubernetes", &["k8s-cluster", "k8s-namespace"]);
        assert!(set.validate().is_ok());
    }

    #[test]
    fn test_identity_set_validate_invalid_id() {
        let set = make_set("K8S", "Kubernetes", &["k8s-cluster"]);
        assert!(set.validate().unwrap_err().contains("invalid"));
    }

    #[test]
    fn test_identity_set_validate_empty_label() {
        let set = make_set("k8s", "", &["k8s-cluster"]);
        assert!(set.validate().unwrap_err().contains("label"));
    }

    #[test]
    fn test_identity_set_validate_empty_distinguish_by() {
        let set = make_set("k8s", "Kubernetes", &[]);
        assert!(set.validate().unwrap_err().contains("distinguish_by"));
    }

    #[test]
    fn test_identity_set_validate_too_many_distinguish_by() {
        let set = make_set("k8s", "Kubernetes", &["a", "b", "c", "d", "e", "f"]);
        let err = set.validate().unwrap_err();
        assert!(err.contains("distinguish_by max"));
    }

    #[test]
    fn test_identity_set_validate_duplicate_distinguish_by() {
        let set = make_set("k8s", "Kubernetes", &["k8s-cluster", "k8s-cluster"]);
        let err = set.validate().unwrap_err();
        assert!(err.contains("duplicate"));
    }

    #[test]
    fn test_service_identity_config_validate_ok() {
        let cfg = ServiceIdentityConfig {
            sets: vec![make_set("k8s", "Kubernetes", &["k8s-cluster"])],
            tracked_alias_ids: vec!["k8s-cluster".to_string()],
            ..Default::default()
        };
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn test_service_identity_config_validate_multiple_sets_ok() {
        let cfg = ServiceIdentityConfig {
            sets: vec![
                make_set("k8s", "Kubernetes", &["k8s-cluster", "k8s-namespace"]),
                make_set("aws", "AWS", &["aws-region", "aws-account"]),
            ],
            tracked_alias_ids: vec!["k8s-cluster".to_string()],
            ..Default::default()
        };
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn test_service_identity_config_validate_empty_sets() {
        let cfg = ServiceIdentityConfig {
            sets: vec![],
            tracked_alias_ids: vec!["k8s-cluster".to_string()],
            ..Default::default()
        };
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("at least 1"));
    }

    #[test]
    fn test_service_identity_config_validate_too_many_sets() {
        let cfg = ServiceIdentityConfig {
            sets: vec![
                make_set("k8s", "K8s", &["k8s-cluster"]),
                make_set("aws", "AWS", &["region"]),
                make_set("gcp", "GCP", &["gcp-project"]),
                make_set("azure", "Azure", &["azure-resource-group"]),
                make_set("custom1", "Custom1", &["host"]),
                make_set("custom2", "Custom2", &["dc"]), // 6 exceeds MAX_SETS = 5
            ],
            tracked_alias_ids: vec!["k8s-cluster".to_string()],
            ..Default::default()
        };
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("max 5"));
    }

    #[test]
    fn test_service_identity_config_validate_duplicate_set_ids() {
        let cfg = ServiceIdentityConfig {
            sets: vec![
                make_set("k8s", "Kubernetes", &["k8s-cluster"]),
                make_set("k8s", "K8s Dupe", &["k8s-namespace"]),
            ],
            tracked_alias_ids: vec!["k8s-cluster".to_string()],
            ..Default::default()
        };
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("duplicate set id"));
    }

    #[test]
    fn test_resolve_best_set_picks_highest_coverage() {
        let cfg = ServiceIdentityConfig {
            sets: vec![
                make_set(
                    "k8s",
                    "Kubernetes",
                    &["k8s-cluster", "k8s-namespace", "k8s-deployment"],
                ),
                make_set("aws", "AWS", &["aws-region"]),
            ],
            ..Default::default()
        };

        let mut dims = std::collections::HashMap::new();
        dims.insert("k8s-cluster".to_string(), "prod".to_string());
        dims.insert("k8s-namespace".to_string(), "app".to_string());
        dims.insert("aws-region".to_string(), "us-east-1".to_string());

        // F8: k8s is 2/3 (partial), aws is 1/1 (full) — full coverage wins over raw
        // count, matching the correlation read path's ranking.
        let best = cfg.resolve_best_set(&dims).unwrap();
        assert_eq!(best.id, "aws");

        // Without the aws dimension, k8s is the only set with any coverage.
        dims.remove("aws-region");
        assert_eq!(cfg.resolve_best_set(&dims).unwrap().id, "k8s");
    }

    #[test]
    fn test_resolve_best_set_first_wins_on_tie() {
        let cfg = ServiceIdentityConfig {
            sets: vec![
                make_set("k8s", "Kubernetes", &["k8s-cluster"]),
                make_set("aws", "AWS", &["region"]),
            ],
            ..Default::default()
        };

        let mut dims = std::collections::HashMap::new();
        dims.insert("k8s-cluster".to_string(), "prod".to_string());
        dims.insert("region".to_string(), "us-east-1".to_string());

        // Both have 1 match — first (k8s) wins
        let best = cfg.resolve_best_set(&dims).unwrap();
        assert_eq!(best.id, "k8s");
    }

    #[test]
    fn test_resolve_best_set_no_coverage_returns_none() {
        let cfg = ServiceIdentityConfig {
            sets: vec![make_set("k8s", "Kubernetes", &["k8s-cluster"])],
            ..Default::default()
        };

        // Record has no k8s fields at all
        let dims = std::collections::HashMap::new();
        assert!(cfg.resolve_best_set(&dims).is_none());
    }

    #[test]
    fn test_resolve_best_set_empty_value_not_counted() {
        let cfg = ServiceIdentityConfig {
            sets: vec![make_set("k8s", "Kubernetes", &["k8s-cluster"])],
            ..Default::default()
        };

        let mut dims = std::collections::HashMap::new();
        dims.insert("k8s-cluster".to_string(), "".to_string()); // empty = not counted

        assert!(cfg.resolve_best_set(&dims).is_none());
    }

    #[test]
    fn test_resolve_best_set_disjoint_workloads() {
        let cfg = ServiceIdentityConfig {
            sets: vec![
                make_set("k8s", "Kubernetes", &["k8s-cluster", "k8s-namespace"]),
                make_set("vm", "VM", &["host", "datacenter"]),
            ],
            ..Default::default()
        };

        // VM record: only host + datacenter present
        let mut vm_dims = std::collections::HashMap::new();
        vm_dims.insert("host".to_string(), "server-01".to_string());
        vm_dims.insert("datacenter".to_string(), "us-east".to_string());

        let best = cfg.resolve_best_set(&vm_dims).unwrap();
        assert_eq!(best.id, "vm");

        // K8s record: only k8s fields present
        let mut k8s_dims = std::collections::HashMap::new();
        k8s_dims.insert("k8s-cluster".to_string(), "prod".to_string());
        k8s_dims.insert("k8s-namespace".to_string(), "app".to_string());

        let best = cfg.resolve_best_set(&k8s_dims).unwrap();
        assert_eq!(best.id, "k8s");
    }

    #[test]
    fn test_resolve_best_set_prefers_full_coverage_over_raw_count() {
        // F8: a fully-covered 2-field set must beat a 3/5 partial set at ingest,
        // matching the read-side ranking (is_full, ratio, count).
        let cfg = ServiceIdentityConfig {
            sets: vec![
                make_set("big", "Big", &["a", "b", "c", "d", "e"]),
                make_set("small", "Small", &["x", "y"]),
            ],
            tracked_alias_ids: vec!["a".into()],
            service_optional: false,
        };
        let dims: std::collections::HashMap<String, String> = [
            ("a", "1"),
            ("b", "1"),
            ("c", "1"), // big: 3/5 partial
            ("x", "1"),
            ("y", "1"), // small: 2/2 full
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        assert_eq!(cfg.resolve_best_set(&dims).unwrap().id, "small");
    }

    #[test]
    fn test_resolve_best_set_ties_broken_by_declaration_order() {
        let cfg = ServiceIdentityConfig {
            sets: vec![
                make_set("first", "F", &["a"]),
                make_set("second", "S", &["b"]),
            ],
            tracked_alias_ids: vec!["a".into()],
            service_optional: false,
        };
        let dims: std::collections::HashMap<String, String> = [("a", "1"), ("b", "1")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        assert_eq!(cfg.resolve_best_set(&dims).unwrap().id, "first");
    }

    #[test]
    fn test_resolve_best_set_by_coverage_reports_coverage() {
        let sets = vec![
            make_set("k8s", "Kubernetes", &["k8s-cluster", "k8s-namespace"]),
            make_set("aws", "AWS", &["aws-region"]),
        ];
        let available: std::collections::HashSet<&str> =
            ["k8s-cluster", "aws-region"].into_iter().collect();
        let (set, cov) = resolve_best_set_by_coverage(&sets, &available).unwrap();
        // aws is fully covered (1/1); k8s is only 1/2 → aws wins on is_full
        assert_eq!(set.id, "aws");
        assert!(cov.is_full);
        assert_eq!(cov.count, 1);
        assert_eq!(cov.ratio, 1.0);
    }

    // ========== IncidentGroupingConfig::validate() Tests ==========

    #[test]
    fn test_incident_grouping_config_validate_empty_ok() {
        // Empty group_by and fallback_group_by are valid (up to max)
        let cfg = IncidentGroupingConfig::default();
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn test_incident_grouping_config_validate_max_group_by() {
        let cfg = IncidentGroupingConfig {
            group_by: vec![
                "k8s-cluster".to_string(),
                "k8s-namespace".to_string(),
                "region".to_string(),
                "cloud-account".to_string(),
                "environment".to_string(),
            ],
            fallback_group_by: vec![],
            upgrade_window_minutes: 30,
        };
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn test_incident_grouping_config_validate_too_many_group_by() {
        let cfg = IncidentGroupingConfig {
            group_by: vec![
                "a".to_string(),
                "b".to_string(),
                "c".to_string(),
                "d".to_string(),
                "e".to_string(),
                "f".to_string(), // 6 exceeds MAX_GROUP_BY = 5
            ],
            fallback_group_by: vec![],
            upgrade_window_minutes: 30,
        };
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("group_by max"));
    }

    #[test]
    fn test_incident_grouping_config_validate_too_many_fallback_group_by() {
        let cfg = IncidentGroupingConfig {
            group_by: vec![],
            fallback_group_by: vec![
                "a".to_string(),
                "b".to_string(),
                "c".to_string(),
                "d".to_string(),
                "e".to_string(),
                "f".to_string(), // 6 exceeds MAX_GROUP_BY = 5
            ],
            upgrade_window_minutes: 30,
        };
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("fallback_group_by max"));
    }

    #[test]
    fn test_incident_grouping_config_validate_max_both_ok() {
        // Both group_by and fallback_group_by at max (3) is valid
        let cfg = IncidentGroupingConfig {
            group_by: vec![
                "a".to_string(),
                "b".to_string(),
                "c".to_string(),
                "d".to_string(),
                "e".to_string(),
            ],
            fallback_group_by: vec![
                "x".to_string(),
                "y".to_string(),
                "z".to_string(),
                "1".to_string(),
                "2".to_string(),
            ],
            upgrade_window_minutes: 30,
        };
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn test_field_alias_group_none_absent_from_json() {
        let alias = FieldAlias::new("host", "Host", &["host", "hostname"]);
        let json = serde_json::to_value(&alias).unwrap();
        let obj = json.as_object().unwrap();
        // group: None → skip_serializing_if = "Option::is_none" → absent
        assert!(!obj.contains_key("group"));
        // is_workload_type: false → skip_serializing_if = "std::ops::Not::not" → absent
        assert!(!obj.contains_key("is_workload_type"));
    }

    #[test]
    fn test_field_alias_group_some_present_in_json() {
        let alias = FieldAlias::with_group("host", "Host", "Common", &["host"]);
        let json = serde_json::to_value(&alias).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("group"));
        assert_eq!(obj["group"], serde_json::json!("Common"));
    }

    #[test]
    fn test_field_alias_is_workload_type_true_present_in_json() {
        let mut alias = FieldAlias::new("service", "Service", &["service"]);
        alias.is_workload_type = true;
        let json = serde_json::to_value(&alias).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("is_workload_type"));
        assert_eq!(obj["is_workload_type"], serde_json::json!(true));
    }

    #[test]
    fn test_default_upgrade_window() {
        assert_eq!(default_upgrade_window(), 30);
    }

    #[test]
    fn test_obsolete_set_ids_removed_and_changed() {
        let mk = |id: &str, fields: &[&str]| IdentitySet {
            id: id.into(),
            label: id.into(),
            distinguish_by: fields.iter().map(|s| s.to_string()).collect(),
        };
        let old = ServiceIdentityConfig {
            sets: vec![
                mk("k8s", &["k8s-cluster", "k8s-namespace"]),
                mk("aws", &["aws-region"]),
                mk("keep", &["environment"]),
            ],
            tracked_alias_ids: vec!["environment".into()],
            service_optional: false,
        };
        let new = ServiceIdentityConfig {
            sets: vec![mk("k8s", &["k8s-cluster"]), mk("keep", &["environment"])],
            tracked_alias_ids: vec!["environment".into()],
            service_optional: false,
        };
        let mut ids = obsolete_set_ids(&old, &new);
        ids.sort();
        // "aws" removed; "k8s" distinguish_by changed; "keep" untouched
        assert_eq!(ids, vec!["aws".to_string(), "k8s".to_string()]);
    }

    #[test]
    fn test_obsolete_set_ids_unchanged_config_is_empty() {
        let cfg = ServiceIdentityConfig {
            sets: vec![IdentitySet {
                id: "k8s".into(),
                label: "Kubernetes".into(),
                distinguish_by: vec!["k8s-cluster".into(), "k8s-namespace".into()],
            }],
            tracked_alias_ids: vec!["environment".into()],
            service_optional: false,
        };
        assert!(obsolete_set_ids(&cfg, &cfg).is_empty());
    }

    #[test]
    fn test_obsolete_set_ids_field_reorder_is_obsolete() {
        // Order of distinguish_by decides the disambiguation key layout, so a reorder
        // invalidates stored rows just like a membership change.
        let mk = |fields: &[&str]| ServiceIdentityConfig {
            sets: vec![IdentitySet {
                id: "k8s".into(),
                label: "Kubernetes".into(),
                distinguish_by: fields.iter().map(|s| s.to_string()).collect(),
            }],
            tracked_alias_ids: vec![],
            service_optional: false,
        };
        let old = mk(&["k8s-cluster", "k8s-namespace"]);
        let new = mk(&["k8s-namespace", "k8s-cluster"]);
        assert_eq!(obsolete_set_ids(&old, &new), vec!["k8s".to_string()]);
    }

    #[test]
    fn test_validate_allows_empty_tracked_alias_ids_with_sets() {
        // tracked_ids at ingest are the UNION of tracked_alias_ids and every set's
        // distinguish_by, and validate() already requires >=1 set — so an empty
        // tracked_alias_ids list is a fully functional config and must not be rejected.
        let cfg = ServiceIdentityConfig {
            sets: vec![IdentitySet {
                id: "custom".into(),
                label: "Custom".into(),
                distinguish_by: vec!["region".into(), "version".into()],
            }],
            tracked_alias_ids: vec![],
            service_optional: false,
        };
        assert!(cfg.validate().is_ok());
    }
}
