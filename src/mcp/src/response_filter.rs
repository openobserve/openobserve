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

//! Response filtering for MCP tool calls.
//!
//! Reduces token usage by filtering tool responses based on the requested
//! `DetailLevel`. Supports two mechanisms:
//!
//! 1. **Custom transformers** for complex tools (SearchSQL, testFunction)
//! 2. **Declarative `summary_fields`** config from `x-o2-mcp` extensions

use serde_json::{Map, Value, json};

use super::{tools::get_summary_config, types::*};

/// Maximum number of hits to include in SearchSQL summary responses
const SEARCH_SQL_MAX_HITS: usize = 100;
/// Maximum number of results to include in testFunction summary responses
const TEST_FUNCTION_MAX_RESULTS: usize = 5;

/// Fields to keep from SearchSQL responses (everything else is dropped)
/// Fields to keep from SearchSQL responses (everything else is dropped)
const SEARCH_SQL_KEEP_FIELDS: &[&str] = &[
    "took",
    "hits",
    "total",
    "from",
    "size",
    "columns",
    "scan_size",
    "function_error",
];

/// Filter a tool's response body based on the requested detail level.
///
/// Returns the (possibly filtered) response body as a string.
///
/// For tools with `summary_fields` config, the response is always normalized to
/// `{ "total": N, "items": [...] }` regardless of detail level. The difference:
/// - `DetailLevel::Full`: normalize only (all fields per item, standard wrapper)
/// - `DetailLevel::Summary`: normalize + extract declared fields + cap at 50 items
///
/// For tools without config, `Full` returns unchanged; `Summary` tries custom transformers.
pub fn filter_response(tool_name: &str, response_body: &str, detail: &DetailLevel) -> String {
    log::debug!(
        "filter_response: tool={}, detail={}, body_len={}",
        tool_name,
        detail,
        response_body.len()
    );

    // Try custom transformer first (only for summary mode)
    if *detail == DetailLevel::Summary
        && let Some(filtered) = apply_custom_transformer(tool_name, response_body)
    {
        log::debug!(
            "filter_response: custom transformer applied for {}",
            tool_name
        );
        return filtered;
    }

    // Try declarative summary_fields config
    if let Some(config) = get_summary_config(tool_name) {
        // Both full and summary normalize the response shape
        if let Some(filtered) = match detail {
            DetailLevel::Full => normalize_list_response(response_body),
            DetailLevel::Summary => apply_summary_fields(response_body, &config),
        } {
            log::debug!(
                "filter_response: {} applied for {} ({} -> {} bytes)",
                detail,
                tool_name,
                response_body.len(),
                filtered.len()
            );
            return filtered;
        }
    }

    // Full detail without config: pass through unchanged
    if *detail == DetailLevel::Full {
        return response_body.to_string();
    }

    log::debug!("filter_response: no filter for {}", tool_name);
    // No filter configured: return full response
    response_body.to_string()
}

/// Apply a custom transformer for tools with complex response shapes.
fn apply_custom_transformer(tool_name: &str, response_body: &str) -> Option<String> {
    match tool_name {
        "SearchSQL" | "SearchSQLAroundKey" => Some(filter_search_sql(response_body)),
        "testFunction" => Some(filter_test_function(response_body)),
        _ => None,
    }
}

/// Filter SearchSQL responses: strip noisy metadata, cap hits at 100.
///
/// Keeps only: took, hits (capped), total, from, size, columns, scan_size, function_error.
/// Drops: took_detail, cached_ratio, result_cache_ratio, scan_files, scan_records,
/// idx_scan_size, trace_id, response_type, histogram_interval, new_start_time,
/// new_end_time, work_group, order_by, order_by_metadata, converted_histogram_query,
/// is_histogram_eligible, query_index, peak_memory_usage, is_partial.
fn filter_search_sql(response_body: &str) -> String {
    let parsed: Value = match serde_json::from_str(response_body) {
        Ok(v) => v,
        Err(_) => return response_body.to_string(),
    };

    let obj = match parsed.as_object() {
        Some(o) => o,
        None => return response_body.to_string(),
    };

    // Build a new object with only the fields we want
    let mut result = serde_json::Map::new();
    for &field in SEARCH_SQL_KEEP_FIELDS {
        if let Some(val) = obj.get(field) {
            result.insert(field.to_string(), val.clone());
        }
    }

    // Cap hits at SEARCH_SQL_MAX_HITS
    if let Some(hits) = result.get_mut("hits")
        && let Some(arr) = hits.as_array_mut()
        && arr.len() > SEARCH_SQL_MAX_HITS
    {
        let original_len = arr.len();
        arr.truncate(SEARCH_SQL_MAX_HITS);
        result.insert(
            "_hits_capped".to_string(),
            json!({
                "original": original_len,
                "shown": SEARCH_SQL_MAX_HITS
            }),
        );
    }

    serde_json::to_string(&Value::Object(result)).unwrap_or_else(|_| response_body.to_string())
}

/// Filter testFunction responses: limit results count.
fn filter_test_function(response_body: &str) -> String {
    let mut parsed: Value = match serde_json::from_str(response_body) {
        Ok(v) => v,
        Err(_) => return response_body.to_string(),
    };

    let obj = match parsed.as_object_mut() {
        Some(o) => o,
        None => return response_body.to_string(),
    };

    // Truncate results array
    if let Some(results) = obj.get_mut("results")
        && let Some(arr) = results.as_array_mut()
    {
        let original_len = arr.len();
        arr.truncate(TEST_FUNCTION_MAX_RESULTS);
        if original_len > TEST_FUNCTION_MAX_RESULTS {
            obj.insert(
                "_truncated".to_string(),
                json!({
                    "original_results": original_len,
                    "shown_results": TEST_FUNCTION_MAX_RESULTS
                }),
            );
        }
    }

    serde_json::to_string(&parsed).unwrap_or_else(|_| response_body.to_string())
}

/// Normalize a list response to `{ "total": N, "items": [...] }`.
///
/// Detects the array in the response by:
/// 1. If root is an array → items = root, total = len
/// 2. If root is an object: a. Look for "total" or "count" key → use as total b. Find the first
///    array-valued key → use as items c. If no array found → return None (not a list response)
fn normalize_list_response(response_body: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(response_body).ok()?;
    let (items, total) = detect_list_and_total(&parsed)?;

    let mut result = Map::new();
    result.insert("total".to_string(), json!(total));
    result.insert("items".to_string(), json!(items));

    serde_json::to_string(&Value::Object(result)).ok()
}

/// Apply declarative summary_fields extraction to a response body.
///
/// Normalizes the response to `{ "total": N, "items": [...] }`, then extracts
/// only the declared fields from each item (supporting dot notation).
///
/// No hard item cap is applied here — pagination limits are enforced upstream
/// by the agent's poka-yoke layer (capping `limit`/`pageSize` params before
/// the API call). Non-paginated endpoints return all items.
fn apply_summary_fields(response_body: &str, fields: &SummaryFieldsConfig) -> Option<String> {
    let parsed: Value = serde_json::from_str(response_body).ok()?;
    let (items, total) = detect_list_and_total(&parsed)?;

    // Extract only the declared fields from each item
    let filtered_items: Vec<Value> = items
        .iter()
        .map(|item| extract_fields(item, fields))
        .collect();

    let mut result = Map::new();
    result.insert("total".to_string(), json!(total));
    result.insert("items".to_string(), json!(filtered_items));

    serde_json::to_string(&Value::Object(result)).ok()
}

/// Detect the list array and total count from a parsed JSON value.
///
/// Returns (items_slice, total_count) or None if no array is found.
fn detect_list_and_total(parsed: &Value) -> Option<(&[Value], usize)> {
    // Root array
    if let Some(arr) = parsed.as_array() {
        return Some((arr.as_slice(), arr.len()));
    }

    let obj = parsed.as_object()?;

    // Look for explicit total/count
    let explicit_total = obj
        .get("total")
        .or_else(|| obj.get("count"))
        .and_then(|v| v.as_u64())
        .map(|v| v as usize);

    // Find the first array-valued key
    let items = obj.values().find_map(|v| v.as_array())?;

    let total = explicit_total.unwrap_or(items.len());
    Some((items.as_slice(), total))
}

/// Extract specified fields from a JSON object, supporting dot notation.
///
/// Example: `extract_fields(item, &["name", "stats.doc_num"])` returns
/// `{"name": "...", "stats": {"doc_num": ...}}`
fn extract_fields(item: &Value, fields: &[String]) -> Value {
    let obj = match item.as_object() {
        Some(o) => o,
        None => return item.clone(),
    };

    let mut result = Map::new();

    for field_path in fields {
        let parts: Vec<&str> = field_path.split('.').collect();

        if parts.len() == 1 {
            // Simple field
            if let Some(val) = obj.get(parts[0]) {
                result.insert(parts[0].to_string(), val.clone());
            }
        } else {
            // Nested field (e.g., "stats.doc_num")
            if let Some(val) = get_nested_value(item, field_path) {
                // Reconstruct the nested structure
                set_nested_value(&mut result, &parts, val.clone());
            }
        }
    }

    Value::Object(result)
}

/// Navigate a dot-separated path in a JSON value.
fn get_nested_value<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    Some(current)
}

/// Set a value at a dot-notation path in a JSON map, creating intermediate objects.
fn set_nested_value(map: &mut Map<String, Value>, parts: &[&str], value: Value) {
    if parts.len() == 1 {
        map.insert(parts[0].to_string(), value);
        return;
    }

    let entry = map
        .entry(parts[0].to_string())
        .or_insert_with(|| Value::Object(Map::new()));

    if let Some(inner) = entry.as_object_mut() {
        set_nested_value(inner, &parts[1..], value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- DetailLevel pass-through tests --

    #[test]
    fn test_full_detail_passes_through() {
        // Tool without summary config: passes through unchanged
        let body = r#"{"data":"keep everything"}"#;
        let result = filter_response("UnknownToolNoConfig", body, &DetailLevel::Full);
        assert_eq!(result, body);
    }

    // -- Custom transformer tests --

    #[test]
    fn test_search_sql_caps_hits_at_100() {
        let hits: Vec<Value> = (0..150)
            .map(|i| json!({"_timestamp": i, "log": format!("line {}", i)}))
            .collect();
        let body = serde_json::to_string(&json!({
            "hits": hits,
            "total": 150,
            "took": 42,
            "columns": ["_timestamp", "log"],
            "from": 0,
            "size": 150,
            "scan_size": 1024
        }))
        .unwrap();

        let result = filter_response("SearchSQL", &body, &DetailLevel::Summary);
        let parsed: Value = serde_json::from_str(&result).unwrap();

        assert_eq!(
            parsed["hits"].as_array().unwrap().len(),
            SEARCH_SQL_MAX_HITS
        );
        assert_eq!(parsed["total"], 150);
        assert_eq!(parsed["took"], 42);
        assert_eq!(parsed["_hits_capped"]["original"], 150);
    }

    #[test]
    fn test_search_sql_strips_noisy_metadata() {
        let body = serde_json::to_string(&json!({
            "hits": [{"log": "test"}],
            "total": 1,
            "took": 5,
            "took_detail": {"total": 5, "cache_took": 1, "search_took": 4},
            "columns": ["log"],
            "from": 0,
            "size": 100,
            "scan_size": 2048,
            "cached_ratio": 50,
            "result_cache_ratio": 25,
            "scan_files": 10,
            "scan_records": 500,
            "idx_scan_size": 128,
            "trace_id": "abc-123",
            "response_type": "complete",
            "is_partial": false,
            "histogram_interval": 60,
            "peak_memory_usage": 1048576,
            "function_error": ["warning: something"]
        }))
        .unwrap();

        let result = filter_response("SearchSQL", &body, &DetailLevel::Summary);
        let parsed: Value = serde_json::from_str(&result).unwrap();

        // Kept
        assert_eq!(parsed["hits"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["total"], 1);
        assert_eq!(parsed["took"], 5);
        assert_eq!(parsed["from"], 0);
        assert_eq!(parsed["size"], 100);
        assert_eq!(parsed["scan_size"], 2048);
        assert_eq!(parsed["columns"][0], "log");
        assert_eq!(parsed["function_error"][0], "warning: something");

        // Dropped
        assert!(parsed.get("took_detail").is_none());
        assert!(parsed.get("cached_ratio").is_none());
        assert!(parsed.get("result_cache_ratio").is_none());
        assert!(parsed.get("scan_files").is_none());
        assert!(parsed.get("scan_records").is_none());
        assert!(parsed.get("idx_scan_size").is_none());
        assert!(parsed.get("trace_id").is_none());
        assert!(parsed.get("response_type").is_none());
        assert!(parsed.get("is_partial").is_none());
        assert!(parsed.get("histogram_interval").is_none());
        assert!(parsed.get("peak_memory_usage").is_none());
    }

    #[test]
    fn test_search_sql_no_string_truncation() {
        let long_string = "x".repeat(5000);
        let body = serde_json::to_string(&json!({
            "hits": [{"log": long_string}],
            "total": 1,
            "took": 1
        }))
        .unwrap();

        let result = filter_response("SearchSQL", &body, &DetailLevel::Summary);
        let parsed: Value = serde_json::from_str(&result).unwrap();

        // String should NOT be truncated
        assert_eq!(parsed["hits"][0]["log"].as_str().unwrap().len(), 5000);
    }

    #[test]
    fn test_search_sql_small_response_passes_through() {
        let body = serde_json::to_string(&json!({
            "hits": [{"log": "short"}],
            "total": 1,
            "took": 1
        }))
        .unwrap();

        let result = filter_response("SearchSQL", &body, &DetailLevel::Summary);
        let parsed: Value = serde_json::from_str(&result).unwrap();

        assert_eq!(parsed["hits"].as_array().unwrap().len(), 1);
        assert!(parsed.get("_hits_capped").is_none());
    }

    #[test]
    fn test_search_sql_invalid_json() {
        let body = "not json";
        let result = filter_response("SearchSQL", body, &DetailLevel::Summary);
        assert_eq!(result, body);
    }

    #[test]
    fn test_test_function_truncates_results() {
        let results: Vec<Value> = (0..20)
            .map(|i| json!({"output": format!("r{}", i)}))
            .collect();
        let body = serde_json::to_string(&json!({"results": results})).unwrap();

        let result = filter_response("testFunction", &body, &DetailLevel::Summary);
        let parsed: Value = serde_json::from_str(&result).unwrap();

        assert_eq!(
            parsed["results"].as_array().unwrap().len(),
            TEST_FUNCTION_MAX_RESULTS
        );
        assert_eq!(parsed["_truncated"]["original_results"], 20);
    }

    // -- Declarative summary_fields tests --

    #[test]
    fn test_summary_fields_list_extraction() {
        let fields: SummaryFieldsConfig = vec!["name".to_string(), "stream_type".to_string()];

        let body = serde_json::to_string(&json!({
            "list": [
                {"name": "logs", "stream_type": "logs", "stats": {"doc_num": 1000}, "schema": [{"field": "a"}]},
                {"name": "metrics", "stream_type": "metrics", "stats": {"doc_num": 500}, "schema": [{"field": "b"}]}
            ],
            "total": 2
        }))
        .unwrap();

        let result = apply_summary_fields(&body, &fields).unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();

        let items = parsed["items"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["name"], "logs");
        assert_eq!(items[0]["stream_type"], "logs");
        assert!(items[0].get("stats").is_none()); // filtered out
        assert!(items[0].get("schema").is_none()); // filtered out
        assert_eq!(parsed["total"], 2);
    }

    #[test]
    fn test_summary_fields_nested_dot_notation() {
        let fields: SummaryFieldsConfig = vec![
            "name".to_string(),
            "stats.doc_num".to_string(),
            "stats.storage_size".to_string(),
        ];

        let body = serde_json::to_string(&json!({
            "list": [
                {"name": "test", "stats": {"doc_num": 100, "storage_size": 5000, "compressed_size": 2000}}
            ]
        }))
        .unwrap();

        let result = apply_summary_fields(&body, &fields).unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();

        let item = &parsed["items"][0];
        assert_eq!(item["name"], "test");
        assert_eq!(item["stats"]["doc_num"], 100);
        assert_eq!(item["stats"]["storage_size"], 5000);
        assert!(item["stats"].get("compressed_size").is_none());
    }

    #[test]
    fn test_summary_fields_root_array() {
        let fields: SummaryFieldsConfig = vec!["name".to_string(), "type".to_string()];

        let body = serde_json::to_string(&json!([
            {"name": "tmpl1", "type": "slack", "body": "very long body content"},
            {"name": "tmpl2", "type": "email", "body": "another long body"}
        ]))
        .unwrap();

        let result = apply_summary_fields(&body, &fields).unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();

        let items = parsed["items"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["name"], "tmpl1");
        assert_eq!(items[0]["type"], "slack");
        assert!(items[0].get("body").is_none());
        assert_eq!(parsed["total"], 2);
    }

    #[test]
    fn test_summary_fields_invalid_json() {
        let fields: SummaryFieldsConfig = vec!["name".to_string()];
        let result = apply_summary_fields("not json", &fields);
        assert!(result.is_none());
    }

    #[test]
    fn test_summary_fields_no_array_in_response() {
        let fields: SummaryFieldsConfig = vec!["name".to_string()];
        let body = r#"{"key": "value"}"#;
        let result = apply_summary_fields(body, &fields);
        assert!(result.is_none());
    }

    #[test]
    fn test_normalize_list_response_object_with_list() {
        let body = r#"{"list": [{"name": "a"}, {"name": "b"}], "total": 2}"#;
        let result = normalize_list_response(body).unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();

        assert_eq!(parsed["total"], 2);
        assert_eq!(parsed["items"].as_array().unwrap().len(), 2);
        assert_eq!(parsed["items"][0]["name"], "a");
    }

    #[test]
    fn test_normalize_list_response_root_array() {
        let body = r#"[{"name": "a"}, {"name": "b"}]"#;
        let result = normalize_list_response(body).unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();

        assert_eq!(parsed["total"], 2);
        assert_eq!(parsed["items"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_normalize_list_response_dashboards_key() {
        let body = r#"{"dashboards": [{"title": "d1"}]}"#;
        let result = normalize_list_response(body).unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();

        assert_eq!(parsed["total"], 1);
        assert_eq!(parsed["items"][0]["title"], "d1");
    }

    #[test]
    fn test_normalize_no_array() {
        let body = r#"{"key": "value"}"#;
        let result = normalize_list_response(body);
        assert!(result.is_none());
    }

    // -- Token reduction tests --

    #[test]
    fn test_stream_list_token_reduction() {
        let full_response = serde_json::to_string(&json!({
            "list": [
                {
                    "name": "default",
                    "stream_type": "logs",
                    "stats": {
                        "doc_num": 15000,
                        "storage_size": 52428800,
                        "compressed_size": 10485760,
                        "doc_time_min": 1704067200000_i64,
                        "doc_time_max": 1704153600000_i64
                    },
                    "schema": [
                        {"name": "_timestamp", "type": "Int64", "fulltext": false},
                        {"name": "log", "type": "Utf8", "fulltext": true},
                        {"name": "kubernetes.pod_name", "type": "Utf8", "fulltext": false},
                        {"name": "kubernetes.namespace", "type": "Utf8", "fulltext": false}
                    ],
                    "settings": {
                        "partition_keys": {},
                        "full_text_search_keys": ["log"],
                        "bloom_filter_fields": [],
                        "data_retention": 30,
                        "max_query_range": 0,
                        "flatten_level": 0,
                        "defined_schema_fields": []
                    },
                    "total_fields": 4,
                    "storage_type": "local"
                },
                {
                    "name": "metrics_stream",
                    "stream_type": "metrics",
                    "stats": {
                        "doc_num": 500000,
                        "storage_size": 104857600,
                        "compressed_size": 20971520,
                        "doc_time_min": 1704067200000_i64,
                        "doc_time_max": 1704153600000_i64
                    },
                    "schema": [
                        {"name": "_timestamp", "type": "Int64", "fulltext": false},
                        {"name": "value", "type": "Float64", "fulltext": false},
                        {"name": "metric_name", "type": "Utf8", "fulltext": false}
                    ],
                    "settings": {
                        "partition_keys": {},
                        "full_text_search_keys": [],
                        "bloom_filter_fields": [],
                        "data_retention": 15,
                        "max_query_range": 0,
                        "flatten_level": 0,
                        "defined_schema_fields": []
                    },
                    "total_fields": 3,
                    "storage_type": "local"
                }
            ],
            "total": 2
        }))
        .unwrap();

        let fields: SummaryFieldsConfig = vec![
            "name".to_string(),
            "stream_type".to_string(),
            "stats.storage_size".to_string(),
        ];

        let summary = apply_summary_fields(&full_response, &fields).unwrap();

        // Assert meaningful size reduction
        assert!(
            summary.len() < full_response.len() / 2,
            "Summary ({} bytes) should be <50% of full ({} bytes)",
            summary.len(),
            full_response.len()
        );

        // Assert key fields preserved in normalized { "total", "items" } shape
        let parsed: Value = serde_json::from_str(&summary).unwrap();
        let items = parsed["items"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        for item in items {
            assert!(item.get("name").is_some());
            assert!(item.get("stream_type").is_some());
            assert!(item["stats"].get("storage_size").is_some());
            // schema, settings, total_fields should be gone
            assert!(item.get("schema").is_none());
            assert!(item.get("settings").is_none());
        }
        assert_eq!(parsed["total"], 2);
    }

    #[test]
    fn test_dashboard_list_token_reduction() {
        let full_response = serde_json::to_string(&json!({
            "dashboards": [
                {
                    "dashboard_id": "dash_001",
                    "title": "API Latency",
                    "description": "Monitors API latency metrics",
                    "owner": "admin@example.com",
                    "version": 8,
                    "hash": "abc123def456",
                    "folder_id": "folder_001",
                    "folder_name": "Production",
                    "role": "admin",
                    "created": "2024-01-01T00:00:00+00:00",
                    "updatedAt": 1704067200000_i64,
                    "v8": {
                        "panels": [
                            {"id": "p1", "type": "line", "config": {"query": "SELECT * FROM metrics"}},
                            {"id": "p2", "type": "bar", "config": {"query": "SELECT count(*) FROM logs"}}
                        ],
                        "variables": [{"name": "env", "values": ["prod", "staging", "dev"]}],
                        "layout": [{"x": 0, "y": 0, "w": 12, "h": 6}]
                    }
                }
            ]
        }))
        .unwrap();

        let fields: SummaryFieldsConfig = vec![
            "dashboard_id".to_string(),
            "title".to_string(),
            "description".to_string(),
            "owner".to_string(),
        ];

        let summary = apply_summary_fields(&full_response, &fields).unwrap();

        assert!(
            summary.len() < full_response.len() / 2,
            "Summary ({} bytes) should be <50% of full ({} bytes)",
            summary.len(),
            full_response.len()
        );

        let parsed: Value = serde_json::from_str(&summary).unwrap();
        let items = parsed["items"].as_array().unwrap();
        assert_eq!(items[0]["title"], "API Latency");
        assert!(items[0].get("v8").is_none());
    }

    #[test]
    fn test_alert_list_token_reduction() {
        let full_response = serde_json::to_string(&json!({
            "list": [
                {
                    "alert_id": "alert_001",
                    "name": "High Error Rate",
                    "stream_name": "default",
                    "stream_type": "logs",
                    "enabled": true,
                    "is_real_time": false,
                    "folder_id": "folder_001",
                    "folder_name": "Production",
                    "owner": "admin@example.com",
                    "description": "Fires when error rate exceeds 5%",
                    "condition": {
                        "type": "sql",
                        "conditions": [{"column": "error", "operator": ">=", "value": "5"}],
                        "sql": "SELECT count(*) as error_count FROM logs WHERE level='error'",
                        "promql": null,
                        "multi_time_range": []
                    },
                    "trigger_condition": {
                        "period": 10,
                        "operator": ">=",
                        "threshold": 5,
                        "frequency": 1,
                        "frequency_type": "minutes"
                    },
                    "last_triggered_at": 1704067200000_i64,
                    "last_satisfied_at": 1704060000000_i64
                }
            ]
        }))
        .unwrap();

        let fields: SummaryFieldsConfig = vec![
            "name".to_string(),
            "stream_name".to_string(),
            "stream_type".to_string(),
            "enabled".to_string(),
            "is_real_time".to_string(),
        ];

        let summary = apply_summary_fields(&full_response, &fields).unwrap();

        assert!(
            summary.len() < full_response.len() / 2,
            "Summary ({} bytes) should be <50% of full ({} bytes)",
            summary.len(),
            full_response.len()
        );

        let parsed: Value = serde_json::from_str(&summary).unwrap();
        let items = parsed["items"].as_array().unwrap();
        assert_eq!(items[0]["name"], "High Error Rate");
        assert_eq!(items[0]["enabled"], true);
        assert!(items[0].get("condition").is_none());
        assert!(items[0].get("trigger_condition").is_none());
    }

    // -- Helper function tests --

    #[test]
    fn test_get_nested_value() {
        let val = json!({"a": {"b": {"c": 42}}});
        assert_eq!(get_nested_value(&val, "a.b.c"), Some(&json!(42)));
        assert_eq!(get_nested_value(&val, "a.b"), Some(&json!({"c": 42})));
        assert!(get_nested_value(&val, "a.x").is_none());
    }

    #[test]
    fn test_extract_fields() {
        let item = json!({
            "name": "test",
            "type": "logs",
            "stats": {"doc_num": 100, "size": 5000},
            "extra": "data"
        });

        let result = extract_fields(&item, &["name".to_string(), "stats.doc_num".to_string()]);

        assert_eq!(result["name"], "test");
        assert_eq!(result["stats"]["doc_num"], 100);
        assert!(result.get("type").is_none());
        assert!(result.get("extra").is_none());
        assert!(result["stats"].get("size").is_none());
    }

    #[test]
    fn test_no_filter_for_unknown_tool() {
        let body = r#"{"data":"keep everything"}"#;
        let result = filter_response("UnknownTool", body, &DetailLevel::Summary);
        assert_eq!(result, body);
    }
}
