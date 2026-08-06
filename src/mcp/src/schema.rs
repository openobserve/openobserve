// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.

//! MCP Schema Optimization
//!
//! This module provides schema simplification for MCP tools to reduce
//! context size while preserving the structure LLMs need to understand.
//!
//! Key optimizations:
//! 1. Simplify versioned schemas (e.g., Dashboard v1-v8) to latest only
//! 2. Remove redundant JSON Schema metadata ($id, $schema, additionalProperties, etc.)
//! 3. Remove verbose descriptions (keep only essential ones)
//! 4. Simplify nullable types

use serde_json::{Value, json};

/// JSON Schema keys that can be safely removed to reduce size
/// These are metadata for validation but not needed for LLM understanding
const REMOVABLE_KEYS: &[&str] = &[
    "$id",
    "$schema",
    "additionalProperties",
    // Note: OpenAPI extensions (x-*) are removed dynamically in cleanup_schema_metadata()
];

/// Tools that have large schemas with multiple versions (oneOf)
/// These will be simplified to only keep the latest version
const TOOLS_WITH_VERSIONED_SCHEMA: &[&str] = &["CreateDashboard"];

/// Tools that share the same request_body schema as another tool
/// Format: (tool_name, reference_tool_name)
/// These tools will have their request_body replaced with a reference description
const TOOLS_WITH_SHARED_SCHEMA: &[(&str, &str)] = &[
    ("UpdateDashboard", "CreateDashboard"),
    ("UpdateAlert", "CreateAlert"),
];

/// Fields to remove from request_body per tool.
/// Use this to strip internal/misleading fields from the LLM-visible schema.
/// Internal fields stripped from all search tool schemas so LLMs don't set them.
/// Specified as JSON pointer paths relative to the tool's input schema:
///   - Top-level URL params:       "/properties/<field>"
///   - Request body fields:        "/properties/request_body/properties/<field>"
///   - Nested query object fields: "/properties/request_body/properties/query/properties/<field>"
const SEARCH_REMOVED_FIELD_PATHS: &[&str] = &[
    // Top-level URL params — internal routing / UI hints
    "/properties/is_ui_histogram",
    "/properties/is_multi_stream_search",
    "/properties/validate",
    // Request body (Request struct) — internal tracking fields
    "/properties/request_body/properties/encoding",
    "/properties/request_body/properties/clear_cache",
    "/properties/request_body/properties/search_type",
    "/properties/request_body/properties/search_event_context",
    // Query object (Query struct) — internal performance / streaming fields
    "/properties/request_body/properties/query/properties/quick_mode",
    "/properties/request_body/properties/query/properties/action_id",
    "/properties/request_body/properties/query/properties/histogram_interval",
    "/properties/request_body/properties/query/properties/streaming_id",
    "/properties/request_body/properties/query/properties/streaming_output",
    "/properties/request_body/properties/query/properties/track_total_hits",
    "/properties/request_body/properties/query/properties/query_type",
    "/properties/request_body/properties/query/properties/skip_wal",
    "/properties/request_body/properties/query/properties/sampling_config",
    "/properties/request_body/properties/query/properties/sampling_ratio",
];

const TOOLS_WITH_REMOVED_FIELD_PATHS: &[(&str, &[&str])] = &[
    ("SearchSQL", SEARCH_REMOVED_FIELD_PATHS),
    ("SearchAround", SEARCH_REMOVED_FIELD_PATHS),
    ("SearchAroundV2", SEARCH_REMOVED_FIELD_PATHS),
];

/// Check if a tool needs schema simplification
pub fn needs_schema_simplification(tool_name: &str) -> bool {
    TOOLS_WITH_VERSIONED_SCHEMA.contains(&tool_name)
}

/// Check if a tool has a shared schema with another tool
/// Returns the reference tool name if found
pub fn get_shared_schema_reference(tool_name: &str) -> Option<&'static str> {
    TOOLS_WITH_SHARED_SCHEMA
        .iter()
        .find(|(name, _)| *name == tool_name)
        .map(|(_, ref_tool)| *ref_tool)
}

/// Simplify the input schema for a tool
///
/// Applies multiple optimizations:
/// 1. For tools with shared schemas, replace request_body with a reference
/// 2. For versioned schemas (Dashboard), keeps only the latest version
/// 3. Removes redundant JSON Schema metadata
/// 4. Simplifies nullable type unions
pub fn simplify_schema(tool_name: &str, mut schema: Value) -> Value {
    // For tools with shared schemas, replace request_body with a minimal reference
    if let Some(ref_tool) = get_shared_schema_reference(tool_name) {
        if let Some(obj) = schema.as_object_mut()
            && let Some(props) = obj.get_mut("properties")
            && let Some(props_obj) = props.as_object_mut()
        {
            // Replace request_body with a simple reference description
            props_obj.insert(
                "request_body".to_string(),
                json!({
                    "description": format!("Same schema as {} request_body", ref_tool)
                }),
            );
        }
        // Apply metadata cleanup and return early
        cleanup_schema_metadata(&mut schema);
        return schema;
    }

    // For versioned schemas, keep only the latest version and remove the
    // internal `version` field so the LLM doesn't set it (server defaults to latest)
    if needs_schema_simplification(tool_name)
        && let Some(obj) = schema.as_object_mut()
        && let Some(props) = obj.get_mut("properties")
        && let Some(props_obj) = props.as_object_mut()
        && let Some(request_body) = props_obj.get_mut("request_body")
    {
        simplify_oneof_schema(request_body);
        // Remove the version field from request_body properties so the LLM
        // doesn't generate it — the server defaults to the latest version
        if let Some(rb_props) = request_body
            .pointer_mut("/properties")
            .and_then(|v| v.as_object_mut())
        {
            rb_props.remove("version");
        }
    }

    // Remove internal fields that would mislead LLMs, specified as JSON pointer paths.
    // Each path points directly to the field inside a `properties` object, e.g.:
    //   "/properties/is_ui_histogram"
    //   "/properties/request_body/properties/search_event_context"
    //   "/properties/request_body/properties/query/properties/skip_wal"
    if let Some(paths) = TOOLS_WITH_REMOVED_FIELD_PATHS
        .iter()
        .find(|(name, _)| *name == tool_name)
        .map(|(_, paths)| *paths)
    {
        for path in paths {
            // Split "/a/b/properties/field_name" into:
            //   props_ptr  = "/a/b/properties"  (the properties map)
            //   field_name = "field_name"
            if let Some(slash) = path.rfind('/') {
                let props_ptr = &path[..slash]; // pointer to the properties object
                let field_name = &path[slash + 1..];

                // Remove from the properties map
                if let Some(props) = schema
                    .pointer_mut(props_ptr)
                    .and_then(|v| v.as_object_mut())
                {
                    props.remove(field_name);
                }

                // Remove from the sibling `required` array (same parent level).
                // props_ptr ends with "/properties", so strip that to get the parent.
                let required_ptr = if let Some(p) = props_ptr.strip_suffix("/properties") {
                    format!("{p}/required")
                } else {
                    // top-level properties → required is at root
                    "/required".to_string()
                };
                if let Some(required) = schema
                    .pointer_mut(&required_ptr)
                    .and_then(|v| v.as_array_mut())
                {
                    required.retain(|f| f.as_str() != Some(field_name));
                }
            }
        }
    }

    // Apply metadata cleanup to reduce size while preserving structure
    cleanup_schema_metadata(&mut schema);

    schema
}

/// Simplify a schema that uses oneOf with multiple versions
/// Removes the oneOf and replaces the entire schema with only the last (latest) variant
fn simplify_oneof_schema(schema: &mut Value) {
    if let Some(obj) = schema.as_object_mut()
        && let Some(one_of) = obj.get("oneOf")
        && let Some(variants) = one_of.as_array()
        && !variants.is_empty()
    {
        // Get the last variant (latest version) and replace the entire schema
        let latest = variants.last().unwrap().clone();
        *schema = latest;
    }
}

/// Recursively clean up JSON Schema metadata to reduce size
/// Preserves the structure LLMs need while removing validation-only metadata
fn cleanup_schema_metadata(value: &mut Value) {
    match value {
        Value::Object(map) => {
            // Remove keys that don't help LLM understanding
            for key in REMOVABLE_KEYS {
                map.remove(*key);
            }

            // Remove keys starting with "x-" (OpenAPI extensions)
            let keys_to_remove: Vec<String> = map
                .keys()
                .filter(|k| k.starts_with("x-"))
                .cloned()
                .collect();
            for key in keys_to_remove {
                map.remove(&key);
            }

            // Remove oneOf constraints for MCP compatibility
            // Case 1 - Nullable pattern: {"oneOf": [{"type": "X"}, {"type": "null"}]} -> {"type":
            // "X"} Case 2 - Single variant: {"oneOf": [schema]} -> schema
            if let Some(one_of) = map.get("oneOf")
                && let Some(variants) = one_of.as_array()
                && !variants.is_empty()
            {
                // Clone variants first to avoid borrow checker issues
                let variants_clone = variants.clone();

                // Case 1: Nullable pattern (2 variants, one is null)
                if variants_clone.len() == 2 {
                    let has_null = variants_clone
                        .iter()
                        .any(|v| v.get("type").and_then(|t| t.as_str()) == Some("null"));
                    if has_null {
                        // Find the non-null variant
                        if let Some(non_null) = variants_clone
                            .iter()
                            .find(|v| v.get("type").and_then(|t| t.as_str()) != Some("null"))
                        {
                            // Replace the entire object with the non-null variant
                            let mut replacement = non_null.clone();
                            cleanup_schema_metadata(&mut replacement);
                            *value = replacement;
                            return;
                        }
                    }
                }

                // Case 2: Single variant oneOf
                if variants_clone.len() == 1 {
                    // Replace the entire object with the single variant
                    let mut replacement = variants_clone[0].clone();
                    cleanup_schema_metadata(&mut replacement);
                    *value = replacement;
                    return;
                }
            }

            // Recursively clean nested objects
            for (_, v) in map.iter_mut() {
                cleanup_schema_metadata(v);
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                cleanup_schema_metadata(v);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn test_needs_schema_simplification() {
        assert!(needs_schema_simplification("CreateDashboard"));
        assert!(!needs_schema_simplification("UpdateDashboard"));
        assert!(!needs_schema_simplification("ListDashboards"));
        assert!(!needs_schema_simplification("CreateAlert"));
    }

    #[test]
    fn test_get_shared_schema_reference() {
        assert_eq!(
            get_shared_schema_reference("UpdateDashboard"),
            Some("CreateDashboard")
        );
        assert_eq!(
            get_shared_schema_reference("UpdateAlert"),
            Some("CreateAlert")
        );
        assert_eq!(get_shared_schema_reference("CreateDashboard"), None);
        assert_eq!(get_shared_schema_reference("ListDashboards"), None);
    }

    #[test]
    fn test_simplify_schema_shared_reference() {
        let schema = json!({
            "type": "object",
            "properties": {
                "org_id": {"type": "string"},
                "dashboard_id": {"type": "string"},
                "request_body": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "panels": {"type": "array"}
                    }
                }
            }
        });

        let simplified = simplify_schema("UpdateDashboard", schema);

        // request_body should be replaced with a reference
        let request_body = &simplified["properties"]["request_body"];
        assert_eq!(
            request_body["description"],
            "Same schema as CreateDashboard request_body"
        );
        // Should not have the original properties
        assert!(request_body.get("properties").is_none());
        // Other properties should be preserved
        assert!(simplified["properties"]["org_id"].is_object());
        assert!(simplified["properties"]["dashboard_id"].is_object());
    }

    #[test]
    fn test_simplify_oneof_schema() {
        let mut schema = json!({
            "oneOf": [
                {"type": "object", "title": "v1"},
                {"type": "object", "title": "v2"},
                {"type": "object", "title": "v3"},
                {"type": "object", "title": "v8"}
            ]
        });

        simplify_oneof_schema(&mut schema);

        // oneOf should be completely removed and replaced with the latest variant
        assert!(schema.get("oneOf").is_none());
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["title"], "v8");
    }

    #[test]
    fn test_simplify_schema_dashboard() {
        let schema = json!({
            "type": "object",
            "properties": {
                "org_id": {"type": "string"},
                "request_body": {
                    "oneOf": [
                        {"type": "object", "title": "v1", "properties": {"version": {"const": 1}}},
                        {"type": "object", "title": "v2", "properties": {"version": {"const": 2}}},
                        {"type": "object", "title": "v8", "properties": {"version": {"const": 8}}}
                    ]
                }
            }
        });

        let simplified = simplify_schema("CreateDashboard", schema);

        // oneOf should be removed and replaced with the latest variant
        let request_body = &simplified["properties"]["request_body"];
        assert!(request_body.get("oneOf").is_none());
        assert_eq!(request_body["type"], "object");
        assert_eq!(request_body["title"], "v8");
        // version field should be removed so the LLM doesn't set it
        assert!(
            request_body["properties"].get("version").is_none(),
            "version field should be stripped from dashboard schema"
        );
    }

    #[test]
    fn test_cleanup_removes_metadata() {
        let mut schema = json!({
            "type": "object",
            "$id": "some-id",
            "$schema": "http://json-schema.org/draft-07/schema#",
            "additionalProperties": false,
            "x-custom-extension": "value",
            "properties": {
                "name": {"type": "string"}
            }
        });

        cleanup_schema_metadata(&mut schema);

        assert!(schema.get("$id").is_none());
        assert!(schema.get("$schema").is_none());
        assert!(schema.get("additionalProperties").is_none());
        assert!(schema.get("x-custom-extension").is_none());
        assert!(schema.get("type").is_some());
        assert!(schema.get("properties").is_some());
    }

    #[test]
    fn test_cleanup_simplifies_nullable() {
        let mut schema = json!({
            "oneOf": [
                {"type": "string"},
                {"type": "null"}
            ]
        });

        cleanup_schema_metadata(&mut schema);

        // Should be simplified to just {"type": "string"}
        assert_eq!(schema["type"], "string");
        assert!(schema.get("oneOf").is_none());
    }

    #[test]
    fn test_cleanup_preserves_multi_variant_oneof() {
        // Test that oneOf with multiple non-null variants (like QueryCondition) is preserved
        // but nested schemas are cleaned up
        let mut schema = json!({
            "oneOf": [
                {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["custom"]},
                        "conditions": {"type": "object"},
                        "aggregation": {"type": "object"}
                    },
                    "required": ["type"]
                },
                {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["sql"]},
                        "sql": {"type": "string"}
                    },
                    "required": ["type", "sql"]
                },
                {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["promql"]},
                        "promql": {"type": "string"},
                        "promql_condition": {"type": "object"}
                    },
                    "required": ["type"]
                }
            ]
        });

        cleanup_schema_metadata(&mut schema);

        // oneOf with multiple non-null variants should be preserved
        assert!(schema.get("oneOf").is_some());
        let variants = schema["oneOf"].as_array().unwrap();
        assert_eq!(variants.len(), 3);
        // Nested schemas should be cleaned but structure preserved
        assert_eq!(variants[0]["type"], "object");
        assert_eq!(variants[1]["type"], "object");
        assert_eq!(variants[2]["type"], "object");
    }

    #[test]
    fn test_remove_internal_fields_from_search_sql() {
        let schema = json!({
            "type": "object",
            "properties": {
                // Top-level URL query params (internal)
                "org_id": {"type": "string"},
                "is_ui_histogram": {"type": "boolean"},
                "is_multi_stream_search": {"type": "boolean"},
                "validate": {"type": "boolean"},
                "request_body": {
                    "type": "object",
                    "properties": {
                        // Request struct fields
                        "search_type": {"type": "string"},
                        "search_event_context": {"type": "object"},
                        "clear_cache": {"type": "boolean"},
                        // Query struct (nested)
                        "query": {
                            "type": "object",
                            "properties": {
                                "sql": {"type": "string"},
                                "start_time": {"type": "integer"},
                                "skip_wal": {"type": "boolean"},
                                "streaming_id": {"type": "string"},
                                "streaming_output": {"type": "boolean"},
                                "query_type": {"type": "string"},
                                "quick_mode": {"type": "boolean"},
                                "sampling_config": {"type": "object"},
                                "sampling_ratio": {"type": "number"}
                            }
                        }
                    }
                }
            }
        });

        let simplified = simplify_schema("SearchSQL", schema);

        // Top-level URL params must be gone
        let top = &simplified["properties"];
        assert!(
            top.get("is_ui_histogram").is_none(),
            "is_ui_histogram should be removed"
        );
        assert!(
            top.get("is_multi_stream_search").is_none(),
            "is_multi_stream_search should be removed"
        );
        assert!(top.get("validate").is_none(), "validate should be removed");
        assert!(top.get("org_id").is_some(), "org_id should be preserved");

        // Request body fields must be gone
        let rb = &simplified["properties"]["request_body"]["properties"];
        assert!(
            rb.get("search_event_context").is_none(),
            "search_event_context should be removed"
        );
        assert!(
            rb.get("clear_cache").is_none(),
            "clear_cache should be removed"
        );
        assert!(
            rb.get("search_type").is_none(),
            "search_type should be removed"
        );

        // Query object fields must be gone
        let q = &simplified["properties"]["request_body"]["properties"]["query"]["properties"];
        for field in &[
            "skip_wal",
            "streaming_id",
            "streaming_output",
            "query_type",
            "quick_mode",
            "sampling_config",
            "sampling_ratio",
        ] {
            assert!(
                q.get(field).is_none(),
                "{field} should be removed from query"
            );
        }
        assert!(q.get("sql").is_some(), "sql should be preserved");
        assert!(
            q.get("start_time").is_some(),
            "start_time should be preserved"
        );
    }

    #[test]
    fn test_remove_internal_fields_from_search_around() {
        let schema = json!({
            "type": "object",
            "properties": {
                "is_ui_histogram": {"type": "boolean"},
                "request_body": {
                    "type": "object",
                    "properties": {
                        "search_event_context": {"type": "object"},
                        "query": {
                            "type": "object",
                            "properties": {
                                "sql": {"type": "string"},
                                "skip_wal": {"type": "boolean"}
                            }
                        }
                    }
                }
            }
        });

        let simplified = simplify_schema("SearchAround", schema);
        assert!(simplified["properties"].get("is_ui_histogram").is_none());
        assert!(
            simplified["properties"]["request_body"]["properties"]
                .get("search_event_context")
                .is_none()
        );
        assert!(
            simplified["properties"]["request_body"]["properties"]["query"]["properties"]
                .get("skip_wal")
                .is_none()
        );
        assert!(
            simplified["properties"]["request_body"]["properties"]["query"]["properties"]
                .get("sql")
                .is_some()
        );
    }

    #[test]
    fn test_cleanup_preserves_structure() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "panels": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "object",
                                "properties": {
                                    "sql": {"type": "string"}
                                }
                            }
                        }
                    }
                }
            }
        });

        let original = schema.clone();
        cleanup_schema_metadata(&mut schema);

        // Structure should be preserved
        assert_eq!(schema, original);
    }
}
