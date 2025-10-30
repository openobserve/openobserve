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
use std::io::Write;

use config::{
    get_config,
    utils::json::{Map, Value},
};

/// Core log fields that are ALWAYS included regardless of UDS configuration
/// These fields are essential for log functionality and cannot be excluded
const CORE_LOG_FIELDS: &[&str] = &[
    "_timestamp",
    "_id",
    "_original",
];

/// Refactors a log record by filtering fields based on user-defined schema configuration.
///
/// This function separates fields into two categories:
/// 1. Schema fields (core fields + user-defined fields) - stored as individual columns
/// 2. Non-schema fields - serialized into the `_all` column as JSON
///
/// # Arguments
///
/// * `original_map` - The original log record with all fields
/// * `defined_schema_fields` - Set of field names that should be kept in the schema
///
/// # Returns
///
/// A new map containing:
/// - All core log fields (always included)
/// - User-defined schema fields
/// - An `_all` field containing JSON-serialized non-schema fields (if any exist)
///
/// # Example
///
/// ```
/// let original = json!({
///     "_timestamp": 1234567890,
///     "message": "User logged in",
///     "level": "INFO",
///     "user_id": "12345",
///     "session_id": "abc-def-ghi",
///     "ip_address": "192.168.1.1"
/// });
///
/// let uds_fields = HashSet::from(["message", "level"]);
/// let result = refactor_log_map(original, &uds_fields);
///
/// // Result contains:
/// // - Core fields: _timestamp
/// // - UDS fields: message, level
/// // - _all: {"user_id":"12345","session_id":"abc-def-ghi","ip_address":"192.168.1.1"}
/// ```
pub fn refactor_log_map(
    original_map: Map<String, Value>,
    defined_schema_fields: &StdHashSet<String>,
) -> Map<String, Value> {
    let cfg = get_config();
    let mut new_map = Map::with_capacity(defined_schema_fields.len() + CORE_LOG_FIELDS.len() + 2);
    let mut non_schema_fields = Map::new();

    for (key, value) in original_map {
        // Always include core log fields
        if CORE_LOG_FIELDS.contains(&key.as_str()) {
            new_map.insert(key, value);
        }
        // Include user-defined schema fields
        else if defined_schema_fields.contains(&key) {
            new_map.insert(key, value);
        }
        // Collect non-schema fields for _all column
        else {
            non_schema_fields.insert(key, value);
        }
    }

    // Add _all column if there are non-schema fields
    // IMPORTANT: _all must be a JSON string, not an object, to match Parquet schema (DataType::Utf8)
    if !non_schema_fields.is_empty() {
        let all_values_json = serde_json::to_string(&non_schema_fields).unwrap_or_else(|e| {
            log::error!("[UDS] Failed to serialize non-schema fields to JSON: {}", e);
            "{}".to_string()
        });
        new_map.insert(
            cfg.common.column_all.to_string(),
            Value::String(all_values_json),
        );
    }

    new_map
}

/// Legacy function for backward compatibility - converts values to strings
/// This maintains the existing behavior for logs that need string conversion
pub fn refactor_map_legacy(
    original_map: Map<String, Value>,
    defined_schema_keys: &StdHashSet<String>,
) -> Map<String, Value> {
    let cfg = get_config();
    let mut new_map = Map::with_capacity(defined_schema_keys.len() + 2);

    // Use configurable buffer size with dynamic growth for large field counts
    // Estimate: 100 bytes per overflow field
    let expected_overflow = original_map.len().saturating_sub(defined_schema_keys.len());
    let estimated_size = expected_overflow * 100;
    let buffer_size = std::cmp::max(cfg.limit.uds_all_field_buffer_size, estimated_size);
    let mut non_schema_map = Vec::with_capacity(buffer_size);

    let mut has_elements = false;
    non_schema_map.write_all(b"{").unwrap();
    for (key, value) in original_map {
        if defined_schema_keys.contains(&key) {
            new_map.insert(key, value);
        } else {
            if has_elements {
                non_schema_map.write_all(b",").unwrap();
            } else {
                has_elements = true;
            }
            non_schema_map.write_all(b"\"").unwrap();
            non_schema_map.write_all(key.as_bytes()).unwrap();
            non_schema_map.write_all(b"\":\"").unwrap();
            non_schema_map
                .write_all(super::pickup_string_value(value).as_bytes())
                .unwrap();
            non_schema_map.write_all(b"\"").unwrap();
        }
    }
    non_schema_map.write_all(b"}").unwrap();

    if has_elements {
        new_map.insert(
            get_config().common.column_all.to_string(),
            Value::String(String::from_utf8(non_schema_map).unwrap()),
        );
    }

    new_map
}