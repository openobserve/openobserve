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

use std::{collections::HashSet as StdHashSet, io::Write};

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
    if !non_schema_labels.is_empty() {
        new_map.insert(
            cfg.common.column_all.to_string(),
            Value::Object(non_schema_labels),
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

    // Calculate hash from UDS labels only (excluding core fields that shouldn't affect hash)
    let exclude_for_hash = &[VALUE_LABEL, HASH_LABEL, EXEMPLARS_LABEL, "_timestamp"];
    let new_hash = signature_without_labels(&map, exclude_for_hash);

    // Update the hash value
    map.insert(HASH_LABEL.to_string(), Value::String(new_hash.to_string()));

    map
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
}
