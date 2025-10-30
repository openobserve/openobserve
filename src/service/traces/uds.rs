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

use std::collections::{HashMap, HashSet as StdHashSet};

use config::{
    get_config,
    utils::json::{Map, Value},
};

/// Core trace fields that are ALWAYS included regardless of UDS configuration
/// These fields are essential for trace functionality and cannot be excluded
///
/// IMPORTANT: These fields MUST be preserved even when UDS is active to ensure
/// DataFusion can execute SELECT * with WHERE clauses on core fields like trace_id
const CORE_TRACE_FIELDS: &[&str] = &[
    "trace_id",
    "span_id",
    "_timestamp",
    "start_time",
    "end_time",
    "duration",
    "service_name",
    "operation_name",
    "span_kind",
    "span_status",
    "flags",
    "events",
    "links",
    // Flattened reference fields (may or may not be present)
    "reference.parent_span_id",
    "reference.parent_trace_id",
    "reference.ref_type",
    "parent_span_id",  // Alternative flattened name
];

/// Refactors span attributes by filtering them based on user-defined schema configuration.
///
/// This function separates span attributes into two categories:
/// 1. Schema attributes (core fields + user-defined fields) - stored as individual columns
/// 2. Non-schema attributes - serialized into the `_all` column as JSON
///
/// # Arguments
///
/// * `span_map` - The complete span record as a JSON map (includes all fields from Span struct)
/// * `defined_schema_fields` - Set of attribute names that should be kept in the schema
///
/// # Returns
///
/// A new map containing:
/// - All core trace fields (always included)
/// - User-defined schema attributes
/// - An `_all` field containing JSON-serialized non-schema attributes (if any exist)
///
/// # Example
///
/// ```
/// let span = json!({
///     "trace_id": "abc123...",
///     "span_id": "def456...",
///     "service_name": "api-server",
///     "operation_name": "/api/users",
///     "duration": 1234,
///     "http_method": "GET",
///     "http_status_code": 200,
///     "http_target": "/api/users",
///     "user_id": "12345",
///     "debug_flag": "true"
/// });
///
/// let uds_fields = HashSet::from(["http_method", "http_status_code", "http_target"]);
/// let result = refactor_span_attributes(span, &uds_fields);
///
/// // Result contains:
/// // - Core fields: trace_id, span_id, service_name, operation_name, duration, etc.
/// // - UDS attributes: http_method, http_status_code, http_target
/// // - _all: {"user_id":"12345","debug_flag":"true"}
/// ```
pub fn refactor_span_attributes(
    span_map: Map<String, Value>,
    defined_schema_fields: &StdHashSet<String>,
) -> Map<String, Value> {
    let cfg = get_config();
    let mut new_map = Map::with_capacity(CORE_TRACE_FIELDS.len() + defined_schema_fields.len() + 2);
    let mut non_schema_attrs = Map::new();

    // Process all fields
    for (key, value) in span_map {
        // ALWAYS include core trace fields regardless of UDS configuration
        if CORE_TRACE_FIELDS.contains(&key.as_str()) {
            new_map.insert(key, value);
        }
        // Also include user-defined schema attributes
        else if defined_schema_fields.contains(&key) {
            new_map.insert(key, value);
        }
        // Everything else goes to _all column
        else {
            non_schema_attrs.insert(key, value);
        }
    }

    // Add _all column if there are non-schema attributes
    // IMPORTANT: _all must be a JSON string, not an object, to match Parquet schema (DataType::Utf8)
    if !non_schema_attrs.is_empty() {
        let all_values_json = serde_json::to_string(&non_schema_attrs).unwrap_or_else(|e| {
            log::error!("[UDS] Failed to serialize non-schema attributes to JSON: {}",
                e
            );
            "{}".to_string()
        });
        new_map.insert(
            cfg.common.column_all.to_string(),
            Value::String(all_values_json),
        );
    }

    new_map
}

/// Extracts important attributes from spans for auto-selection in UDS.
///
/// This function analyzes span attributes and identifies which ones are likely to be
/// important based on semantic conventions (HTTP, DB, RPC, etc.) and usage patterns.
///
/// # Arguments
///
/// * `spans` - Collection of span records to analyze
/// * `max_fields` - Maximum number of fields to select for UDS
///
/// # Returns
///
/// A set of attribute names that should be included in the UDS configuration
///
/// Priority order:
/// 1. HTTP semantic convention attributes (http.method, http.status_code, etc.)
/// 2. Database semantic convention attributes (db.system, db.statement, etc.)
/// 3. RPC semantic convention attributes (rpc.method, rpc.service, etc.)
/// 4. Messaging semantic convention attributes (messaging.system, messaging.destination, etc.)
/// 5. Attributes from full_text_search_keys configuration
/// 6. Most frequently occurring attributes (low cardinality preferred)
pub fn select_important_trace_attributes(
    spans: &[Map<String, Value>],
    max_fields: usize,
) -> Vec<String> {
    let mut selected = Vec::new();

    // Define semantic convention prefixes in priority order
    // Note: OTLP normalizes dots to underscores during ingestion, so we use underscored names
    let semantic_prefixes = [
        // HTTP attributes (highest priority - most common)
        vec![
            "http_method",
            "http_status_code",
            "http_target",
            "http_route",
            "http_url",
        ],
        // Database attributes
        vec!["db_system", "db_statement", "db_name", "db_operation"],
        // RPC attributes
        vec!["rpc_method", "rpc_service", "rpc_system"],
        // Messaging attributes
        vec![
            "messaging_system",
            "messaging_destination",
            "messaging_operation",
        ],
        // Network attributes
        vec!["net_peer_name", "net_peer_ip", "net_peer_port"],
        // Error tracking
        vec!["error", "error_type", "error_message", "exception_type"],
    ];

    // Add semantic convention attributes if they exist in any span
    for prefix_group in &semantic_prefixes {
        if selected.len() >= max_fields {
            break;
        }
        for attr_name in prefix_group {
            if selected.len() >= max_fields {
                break;
            }
            // Check if any span has this attribute
            if spans.iter().any(|span| span.contains_key(*attr_name)) {
                if !selected.contains(&attr_name.to_string()) {
                    selected.push(attr_name.to_string());
                }
            }
        }
    }

    // Count attribute frequencies (excluding core fields)
    if selected.len() < max_fields {
        let mut attr_frequencies: HashMap<String, usize> = HashMap::new();
        for span in spans {
            for key in span.keys() {
                if !CORE_TRACE_FIELDS.contains(&key.as_str()) && !selected.contains(key) {
                    *attr_frequencies.entry(key.clone()).or_insert(0) += 1;
                }
            }
        }

        // Sort by frequency and add most common attributes
        let mut freq_vec: Vec<_> = attr_frequencies.into_iter().collect();
        freq_vec.sort_by(|a, b| b.1.cmp(&a.1));

        for (attr_name, _freq) in freq_vec {
            if selected.len() >= max_fields {
                break;
            }
            if !selected.contains(&attr_name) {
                selected.push(attr_name);
            }
        }
    }

    selected
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn test_refactor_span_attributes_with_uds() {
        let span = serde_json::from_value::<Map<String, Value>>(json!({
            "trace_id": "abc123",
            "span_id": "def456",
            "service_name": "api-server",
            "operation_name": "/api/users",
            "duration": 1234,
            "_timestamp": 1234567890,
            "span_kind": "SERVER",
            "span_status": "OK",
            "http_method": "GET",
            "http_status_code": 200,
            "http_target": "/api/users",
            "user_id": "12345",
            "debug_flag": "true"
        }))
        .unwrap();

        let mut uds_fields = StdHashSet::new();
        uds_fields.insert("http_method".to_string());
        uds_fields.insert("http_status_code".to_string());
        uds_fields.insert("http_target".to_string());

        let result = refactor_span_attributes(span, &uds_fields);

        // Core fields should be present
        assert!(result.contains_key("trace_id"));
        assert!(result.contains_key("span_id"));
        assert!(result.contains_key("service_name"));
        assert!(result.contains_key("duration"));

        // UDS attributes should be present
        assert!(result.contains_key("http_method"));
        assert!(result.contains_key("http_status_code"));
        assert!(result.contains_key("http_target"));

        // Non-UDS attributes should be in _all
        assert!(result.contains_key("_all"));
        let all_value = result.get("_all").unwrap().as_str().unwrap();
        assert!(all_value.contains("user_id"));
        assert!(all_value.contains("debug_flag"));
    }

    #[test]
    fn test_refactor_span_attributes_without_uds() {
        let span = serde_json::from_value::<Map<String, Value>>(json!({
            "trace_id": "abc123",
            "span_id": "def456",
            "service_name": "api-server",
            "duration": 1234,
            "http_method": "GET",
            "custom_attr": "value"
        }))
        .unwrap();

        let uds_fields = StdHashSet::new(); // Empty UDS config

        let result = refactor_span_attributes(span, &uds_fields);

        // Core fields should be present
        assert!(result.contains_key("trace_id"));
        assert!(result.contains_key("service_name"));

        // Non-core attributes should be in _all
        assert!(result.contains_key("_all"));
        let all_value = result.get("_all").unwrap().as_str().unwrap();
        assert!(all_value.contains("http_method"));
        assert!(all_value.contains("custom_attr"));
    }

    #[test]
    fn test_refactor_span_attributes_all_in_uds() {
        let span = serde_json::from_value::<Map<String, Value>>(json!({
            "trace_id": "abc123",
            "service_name": "api-server",
            "http_method": "GET"
        }))
        .unwrap();

        let mut uds_fields = StdHashSet::new();
        uds_fields.insert("http_method".to_string());

        let result = refactor_span_attributes(span, &uds_fields);

        // Should not have _all field since all non-core attributes are in UDS
        assert!(!result.contains_key("_all"));
        assert!(result.contains_key("http_method"));
    }

    #[test]
    fn test_core_fields_always_included() {
        let span = serde_json::from_value::<Map<String, Value>>(json!({
            "trace_id": "abc123",
            "span_id": "def456",
            "service_name": "api-server",
            "operation_name": "GET /api",
            "duration": 100,
            "_timestamp": 123456,
            "span_kind": "SERVER",
            "span_status": "OK",
            "custom_attr": "value"
        }))
        .unwrap();

        let uds_fields = StdHashSet::new(); // Empty UDS

        let result = refactor_span_attributes(span, &uds_fields);

        // Core fields should be present even with empty UDS
        assert!(result.contains_key("trace_id"));
        assert!(result.contains_key("span_id"));
        assert!(result.contains_key("service_name"));
        assert!(result.contains_key("operation_name"));
        assert!(result.contains_key("duration"));
    }

    #[test]
    fn test_select_important_trace_attributes_http() {
        let spans = vec![
            serde_json::from_value::<Map<String, Value>>(json!({
                "trace_id": "1",
                "http_method": "GET",
                "http_status_code": 200,
                "http_target": "/api/users",
                "custom_attr": "value1"
            }))
            .unwrap(),
            serde_json::from_value::<Map<String, Value>>(json!({
                "trace_id": "2",
                "http_method": "POST",
                "http_status_code": 201,
                "custom_attr": "value2"
            }))
            .unwrap(),
        ];

        let selected = select_important_trace_attributes(&spans, 5);

        // Should select HTTP semantic convention attributes
        assert!(selected.contains("http_method"));
        assert!(selected.contains("http_status_code"));
        assert!(selected.contains("http_target"));
    }

    #[test]
    fn test_select_important_trace_attributes_respects_limit() {
        let spans = vec![
            serde_json::from_value::<Map<String, Value>>(json!({
                "trace_id": "1",
                "attr1": "v1",
                "attr2": "v2",
                "attr3": "v3",
                "attr4": "v4",
                "attr5": "v5"
            }))
            .unwrap(),
        ];

        let selected = select_important_trace_attributes(&spans, 3);

        // Should not exceed the limit
        assert!(selected.len() <= 3);
    }
}
