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

use std::collections::HashSet as StdHashSet;

use config::{
    get_config,
    meta::promql::{
        BUCKET_LABEL, EXEMPLARS_LABEL, HASH_LABEL, NAME_LABEL, QUANTILE_LABEL, TYPE_LABEL,
        VALUE_LABEL,
    },
    utils::json::{Map, Value},
};

/// Core metric fields that are ALWAYS included regardless of UDS configuration
/// These fields are essential for metric functionality and cannot be excluded
const CORE_METRIC_FIELDS: &[&str] = &[
    NAME_LABEL,      // __name__ - metric name (stream identifier)
    TYPE_LABEL,      // __type__ - metric type (counter, gauge, histogram, etc.)
    HASH_LABEL,      // __hash__ - series identifier
    VALUE_LABEL,     // value - the actual metric value
    "_timestamp",    // timestamp
    BUCKET_LABEL,    // le - histogram bucket upper bound
    QUANTILE_LABEL,  // quantile - summary quantile
    EXEMPLARS_LABEL, // exemplars - trace exemplars
];

/// Refactors a metric record by filtering labels based on user-defined schema configuration.
///
/// This function separates labels into two categories:
/// 1. Schema labels (core fields + user-defined fields) - stored as individual columns
/// 2. Non-schema labels - serialized into the `_all` column as JSON
///
/// # Arguments
///
/// * `original_map` - The original metric record with all labels
/// * `defined_schema_fields` - Set of field names that should be kept in the schema
///
/// # Returns
///
/// A new map containing:
/// - All core metric fields (always included)
/// - User-defined schema fields
/// - An `_all` field containing JSON-serialized non-schema labels (if any exist)
///
/// # Example
///
/// ```
/// let original = json!({
///     "__name__": "http_requests_total",
///     "__type__": "counter",
///     "__hash__": "abc123",
///     "value": 42.0,
///     "_timestamp": 1234567890,
///     "method": "GET",
///     "status": "200",
///     "endpoint": "/api/users",
///     "instance": "server-1",
///     "datacenter": "us-east-1"
/// });
///
/// let uds_fields = HashSet::from(["method", "status"]);
/// let result = refactor_metric_map(original, &uds_fields);
///
/// // Result contains:
/// // - Core fields: __name__, __type__, __hash__, value, _timestamp
/// // - UDS fields: method, status
/// // - _all: {"endpoint":"/api/users","instance":"server-1","datacenter":"us-east-1"}
/// ```
pub fn refactor_metric_map(
    original_map: Map<String, Value>,
    defined_schema_fields: &StdHashSet<String>,
) -> Map<String, Value> {
    let cfg = get_config();
    let mut new_map =
        Map::with_capacity(defined_schema_fields.len() + CORE_METRIC_FIELDS.len() + 2);
    let mut non_schema_labels = Map::new();

    for (key, value) in original_map {
        // Always include core metric fields
        if CORE_METRIC_FIELDS.contains(&key.as_str()) {
            new_map.insert(key, value);
        }
        // Include user-defined schema fields
        else if defined_schema_fields.contains(&key) {
            new_map.insert(key, value);
        }
        // Collect non-schema fields for _all column
        else {
            non_schema_labels.insert(key, value);
        }
    }

    // Add _all column if there are non-schema labels
    // IMPORTANT: _all must be a JSON string, not an object, to match Parquet schema
    // (DataType::Utf8)
    if !non_schema_labels.is_empty() {
        let all_values_json = serde_json::to_string(&non_schema_labels).unwrap_or_else(|e| {
            log::error!("[UDS] Failed to serialize non-schema labels to JSON: {}", e);
            "{}".to_string()
        });
        new_map.insert(
            cfg.common.column_all.to_string(),
            Value::String(all_values_json),
        );
    }

    new_map
}

/// Recalculates the metric hash based only on UDS labels and core fields.
///
/// When UDS is enabled, we need to recalculate the `__hash__` field because:
/// 1. Non-UDS labels are moved to the `_all` column
/// 2. The hash should only reflect the labels that are in the schema
/// 3. This ensures consistent series identification with reduced cardinality
///
/// # Arguments
///
/// * `map` - The metric record (after refactoring)
/// * `defined_schema_fields` - Set of user-defined schema fields
///
/// # Returns
///
/// The updated map with recalculated `__hash__` value
pub fn recalculate_metric_hash(
    mut map: Map<String, Value>,
    _defined_schema_fields: &StdHashSet<String>,
) -> Map<String, Value> {
    use super::signature_without_labels;

    let cfg = get_config();

    // Calculate hash from UDS labels only (excluding core fields that shouldn't affect hash)
    // CRITICAL: Must exclude _all column from hash calculation!
    // The whole point of UDS is to reduce cardinality by moving high-cardinality labels to _all.
    // If _all is included in the hash, we get the same cardinality as before UDS.
    let exclude_for_hash = &[
        VALUE_LABEL,
        HASH_LABEL,
        EXEMPLARS_LABEL,
        "_timestamp",
        cfg.common.column_all.as_str(), // MUST exclude _all from hash
    ];
    let new_hash = signature_without_labels(&map, exclude_for_hash);

    // Update the hash value
    map.insert(HASH_LABEL.to_string(), Value::String(new_hash.to_string()));

    map
}

/// Selects important metric labels for auto-selection in UDS.
///
/// This function analyzes metric labels and identifies which ones are likely to be
/// important based on common label patterns and usage frequencies.
///
/// # Arguments
///
/// * `metrics` - Collection of metric records to analyze
/// * `max_fields` - Maximum number of fields to select for UDS
///
/// # Returns
///
/// A set of label names that should be included in the UDS configuration
///
/// Priority order:
/// 1. Common observability labels (method, status, endpoint, etc.)
/// 2. Low-cardinality labels (appear frequently across metrics)
/// 3. Labels matching semantic conventions
pub fn select_important_metric_labels(
    metrics: &[Map<String, Value>],
    max_fields: usize,
) -> StdHashSet<String> {
    use std::collections::HashMap;

    let mut selected = StdHashSet::new();

    // Define common important labels in priority order
    let important_labels = [
        // HTTP-related
        vec![
            "method",
            "status",
            "status_code",
            "endpoint",
            "route",
            "path",
        ],
        // Service identification
        vec!["service", "service_name", "job", "instance"],
        // Environment
        vec!["env", "environment", "region", "datacenter", "cluster"],
        // Resource types
        vec!["resource_type", "resource", "component"],
    ];

    // Add important labels if they exist in any metric
    for label_group in &important_labels {
        if selected.len() >= max_fields {
            break;
        }
        for label_name in label_group {
            if selected.len() >= max_fields {
                break;
            }
            // Check if any metric has this label
            if metrics
                .iter()
                .any(|metric| metric.contains_key(*label_name))
            {
                selected.insert(label_name.to_string());
            }
        }
    }

    // Count label frequencies (excluding core fields)
    if selected.len() < max_fields {
        let mut label_frequencies: HashMap<String, usize> = HashMap::new();
        for metric in metrics {
            for key in metric.keys() {
                if !CORE_METRIC_FIELDS.contains(&key.as_str()) && !selected.contains(key) {
                    *label_frequencies.entry(key.clone()).or_insert(0) += 1;
                }
            }
        }

        // Sort by frequency and add most common labels
        let mut freq_vec: Vec<_> = label_frequencies.into_iter().collect();
        freq_vec.sort_by(|a, b| b.1.cmp(&a.1));

        for (label_name, _freq) in freq_vec {
            if selected.len() >= max_fields {
                break;
            }
            selected.insert(label_name);
        }
    }

    selected
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use serde_json::json;

    use super::*;

    #[test]
    fn test_refactor_metric_map_with_uds() {
        let original = serde_json::from_value::<Map<String, Value>>(json!({
            "__name__": "http_requests_total",
            "__type__": "counter",
            "__hash__": "abc123",
            "value": 42.0,
            "_timestamp": 1234567890,
            "method": "GET",
            "status": "200",
            "endpoint": "/api/users",
            "instance": "server-1",
            "datacenter": "us-east-1"
        }))
        .unwrap();

        let mut uds_fields = StdHashSet::new();
        uds_fields.insert("method".to_string());
        uds_fields.insert("status".to_string());

        let result = refactor_metric_map(original, &uds_fields);

        // Core fields should be present
        assert!(result.contains_key("__name__"));
        assert!(result.contains_key("__type__"));
        assert!(result.contains_key("__hash__"));
        assert!(result.contains_key("value"));
        assert!(result.contains_key("_timestamp"));

        // UDS fields should be present
        assert!(result.contains_key("method"));
        assert!(result.contains_key("status"));

        // Non-UDS fields should be in _all
        assert!(result.contains_key("_all"));
        let all_value = result.get("_all").unwrap().as_str().unwrap();
        assert!(all_value.contains("endpoint"));
        assert!(all_value.contains("instance"));
        assert!(all_value.contains("datacenter"));
    }

    #[test]
    fn test_refactor_metric_map_without_uds() {
        let original = serde_json::from_value::<Map<String, Value>>(json!({
            "__name__": "http_requests_total",
            "__type__": "counter",
            "__hash__": "abc123",
            "value": 42.0,
            "_timestamp": 1234567890,
            "method": "GET",
            "status": "200"
        }))
        .unwrap();

        let uds_fields = HashSet::new(); // Empty UDS config

        let result = refactor_metric_map(original.clone(), &uds_fields);

        // Core fields should be present
        assert!(result.contains_key("__name__"));
        assert!(result.contains_key("value"));

        // Non-core fields should be in _all
        assert!(result.contains_key("_all"));
        let all_value = result.get("_all").unwrap().as_str().unwrap();
        assert!(all_value.contains("method"));
        assert!(all_value.contains("status"));
    }

    #[test]
    fn test_refactor_metric_map_all_fields_in_uds() {
        let original = serde_json::from_value::<Map<String, Value>>(json!({
            "__name__": "http_requests_total",
            "value": 42.0,
            "_timestamp": 1234567890,
            "method": "GET"
        }))
        .unwrap();

        let mut uds_fields = StdHashSet::new();
        uds_fields.insert("method".to_string());

        let result = refactor_metric_map(original, &uds_fields);

        // Should not have _all field since all non-core fields are in UDS
        assert!(!result.contains_key("_all"));
        assert!(result.contains_key("method"));
    }

    #[test]
    fn test_core_fields_always_included() {
        let original = serde_json::from_value::<Map<String, Value>>(json!({
            "__name__": "metric",
            "__type__": "gauge",
            "__hash__": "hash123",
            "value": 1.0,
            "_timestamp": 123456,
            "le": "0.5",
            "quantile": "0.95",
            "exemplars": "[]",
            "custom_label": "custom_value"
        }))
        .unwrap();

        let uds_fields = HashSet::new(); // Empty UDS

        let result = refactor_metric_map(original, &uds_fields);

        // All core fields should be present even with empty UDS
        for core_field in CORE_METRIC_FIELDS {
            if *core_field != "le" && *core_field != "quantile" && *core_field != "exemplars" {
                // These might not be in all metrics
                assert!(
                    result.contains_key(*core_field),
                    "Core field {} should be present",
                    core_field
                );
            }
        }
    }

    #[test]
    fn test_refactor_metric_map_high_cardinality() {
        // Test with 100 labels to simulate high cardinality
        let mut original = serde_json::from_value::<Map<String, Value>>(json!({
            "__name__": "high_cardinality_metric",
            "__type__": "counter",
            "__hash__": "hash123",
            "value": 100.0,
            "_timestamp": 1234567890,
            "service": "api",
            "method": "GET"
        }))
        .unwrap();

        // Add 100 high-cardinality labels
        for i in 1..=100 {
            original.insert(
                format!("label_{}", i),
                Value::String(format!("value_{}", i)),
            );
        }

        let mut uds_fields = StdHashSet::new();
        uds_fields.insert("service".to_string());
        uds_fields.insert("method".to_string());

        let result = refactor_metric_map(original, &uds_fields);

        // Core fields should be present
        assert!(result.contains_key("__name__"));
        assert!(result.contains_key("value"));

        // UDS fields should be present
        assert!(result.contains_key("service"));
        assert!(result.contains_key("method"));

        // _all should contain the 100 labels
        assert!(result.contains_key("_all"));
        let all_value = result.get("_all").unwrap().as_str().unwrap();
        assert!(all_value.contains("label_1"));
        assert!(all_value.contains("label_50"));
        assert!(all_value.contains("label_100"));
    }

    #[test]
    fn test_refactor_metric_map_empty_input() {
        let original = Map::new();
        let uds_fields = StdHashSet::new();

        let result = refactor_metric_map(original, &uds_fields);

        // Should return empty map
        assert!(result.is_empty());
    }

    #[test]
    fn test_refactor_metric_map_only_core_fields() {
        let original = serde_json::from_value::<Map<String, Value>>(json!({
            "__name__": "metric",
            "__type__": "gauge",
            "value": 1.0,
            "_timestamp": 123456
        }))
        .unwrap();

        let uds_fields = StdHashSet::new();

        let result = refactor_metric_map(original, &uds_fields);

        // Should only have core fields, no _all
        assert!(result.contains_key("__name__"));
        assert!(result.contains_key("value"));
        assert!(!result.contains_key("_all"));
    }

    #[test]
    fn test_recalculate_metric_hash_excludes_all() {
        let mut map = serde_json::from_value::<Map<String, Value>>(json!({
            "__name__": "test_metric",
            "__hash__": "old_hash",
            "value": 42.0,
            "_timestamp": 123456,
            "service": "api",
            "_all": "{\"high_cardinality_label\":\"unique_value_12345\"}"
        }))
        .unwrap();

        let uds_fields = StdHashSet::new();
        let result = recalculate_metric_hash(map.clone(), &uds_fields);

        // Hash should be different from original
        let new_hash = result.get("__hash__").unwrap().as_str().unwrap();
        assert_ne!(new_hash, "old_hash");

        // Calculate hash without _all
        map.remove("_all");
        let expected_result = recalculate_metric_hash(map, &uds_fields);
        let expected_hash = expected_result.get("__hash__").unwrap().as_str().unwrap();

        // Hashes should be the same (proving _all is excluded)
        assert_eq!(new_hash, expected_hash, "Hash should exclude _all column");
    }

    #[test]
    fn test_select_important_metric_labels() {
        let metrics = vec![
            serde_json::from_value::<Map<String, Value>>(json!({
                "__name__": "http_requests",
                "method": "GET",
                "status": "200",
                "endpoint": "/api/users",
                "service": "api-gateway",
                "custom1": "val1"
            }))
            .unwrap(),
            serde_json::from_value::<Map<String, Value>>(json!({
                "__name__": "http_requests",
                "method": "POST",
                "status": "201",
                "endpoint": "/api/orders",
                "service": "api-gateway",
                "custom2": "val2"
            }))
            .unwrap(),
        ];

        let selected = select_important_metric_labels(&metrics, 10);

        // Should prioritize common important labels
        assert!(
            selected.contains("method"),
            "Should select 'method' as important"
        );
        assert!(
            selected.contains("status"),
            "Should select 'status' as important"
        );
        assert!(
            selected.contains("service"),
            "Should select 'service' as important"
        );

        // Should respect max_fields limit
        assert!(selected.len() <= 10, "Should not exceed max_fields limit");
    }

    #[test]
    fn test_select_important_metric_labels_respects_limit() {
        let metrics = vec![
            serde_json::from_value::<Map<String, Value>>(json!({
                "__name__": "metric",
                "label1": "v1",
                "label2": "v2",
                "label3": "v3",
                "label4": "v4",
                "label5": "v5"
            }))
            .unwrap(),
        ];

        let selected = select_important_metric_labels(&metrics, 3);

        assert!(
            selected.len() <= 3,
            "Should not exceed limit of 3, got {}",
            selected.len()
        );
    }
}
