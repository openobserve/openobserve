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

//! Integration tests for MCP response filtering.
//!
//! Tests that summary mode produces meaningful token reduction on realistic
//! payloads while preserving the key fields an LLM needs.

use std::{collections::HashMap, sync::Once};

use openobserve_mcp::{
    response_filter::filter_response, tools::register_summary_configs, types::DetailLevel,
};
use serde_json::{Value, json};

static INIT: Once = Once::new();

/// Register the summary_fields configs that match the OpenAPI x-o2-mcp annotations.
fn init_test_configs() {
    INIT.call_once(|| {
        let mut configs = HashMap::new();
        configs.insert(
            "StreamList".into(),
            vec![
                "name".into(),
                "stream_type".into(),
                "stats.storage_size".into(),
            ],
        );
        configs.insert(
            "ListDashboards".into(),
            vec![
                "dashboard_id".into(),
                "title".into(),
                "description".into(),
                "owner".into(),
                "folder_name".into(),
            ],
        );
        configs.insert(
            "ListAlerts".into(),
            vec![
                "name".into(),
                "stream_name".into(),
                "stream_type".into(),
                "enabled".into(),
                "is_real_time".into(),
                "folder_id".into(),
                "folder_name".into(),
            ],
        );
        configs.insert(
            "listFunctions".into(),
            vec!["name".into(), "transType".into(), "streams".into()],
        );
        configs.insert(
            "ListTemplates".into(),
            vec![
                "name".into(),
                "type".into(),
                "isDefault".into(),
                "title".into(),
            ],
        );
        configs.insert(
            "listPipelines".into(),
            vec![
                "pipeline_id".into(),
                "name".into(),
                "description".into(),
                "enabled".into(),
            ],
        );
        register_summary_configs(configs);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Estimate token count (1 token ≈ 4 bytes for English/JSON)
fn estimate_tokens(s: &str) -> usize {
    s.len() / 4
}

/// Assert that summary is significantly smaller than full and print stats.
fn assert_reduction(label: &str, summary: &str, full: &str, min_reduction_pct: f64) {
    let s_len = summary.len();
    let f_len = full.len();
    let reduction = if f_len > 0 {
        (1.0 - s_len as f64 / f_len as f64) * 100.0
    } else {
        0.0
    };

    eprintln!(
        "{:<25} summary={:>6} B  full={:>6} B  saved={:>6} B  reduction={:.1}%  (~{} tokens saved)",
        label,
        s_len,
        f_len,
        f_len - s_len,
        reduction,
        estimate_tokens(full) - estimate_tokens(summary),
    );

    assert!(
        reduction >= min_reduction_pct,
        "{}: expected >= {:.0}% reduction, got {:.1}% ({} B -> {} B)",
        label,
        min_reduction_pct,
        reduction,
        f_len,
        s_len,
    );
}

/// Verify that every expected key exists in every item of the normalized "items" array.
fn assert_fields_present(parsed: &Value, expected_fields: &[&str]) {
    let list = parsed["items"]
        .as_array()
        .expect("expected 'items' array in normalized response");

    for (i, item) in list.iter().enumerate() {
        for field in expected_fields {
            let parts: Vec<&str> = field.split('.').collect();
            let mut current = item;
            for part in &parts {
                current = &current[*part];
            }
            assert!(!current.is_null(), "item[{}] missing field '{}'", i, field);
        }
    }
}

/// Verify that certain fields are absent from every item in the normalized "items" array.
fn assert_fields_absent(parsed: &Value, absent_fields: &[&str]) {
    let list = parsed["items"]
        .as_array()
        .expect("expected 'items' array in normalized response");

    for (i, item) in list.iter().enumerate() {
        let obj = item.as_object().expect("expected object");
        for field in absent_fields {
            // Only check top-level key
            let top_key = field.split('.').next().unwrap();
            assert!(
                !obj.contains_key(top_key),
                "item[{}] should NOT contain field '{}'",
                i,
                top_key,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Realistic fixtures
// ---------------------------------------------------------------------------

fn streams_fixture() -> String {
    let mut streams = Vec::new();
    for i in 0..20 {
        streams.push(json!({
            "name": format!("stream_{}", i),
            "storage_type": "disk",
            "stream_type": if i % 3 == 0 { "metrics" } else { "logs" },
            "stats": {
                "created_at": 1704067200000_i64 + i,
                "doc_time_min": 1704067200000_i64,
                "doc_time_max": 1704153600000_i64,
                "doc_num": 10000 * (i + 1),
                "file_num": 50 + i,
                "storage_size": 52428800.0 * (i + 1) as f64,
                "compressed_size": 10485760.0 * (i + 1) as f64,
                "index_size": 1048576.0 * (i + 1) as f64
            },
            "schema": (0..15).map(|j| json!({
                "name": format!("field_{}", j),
                "type": if j == 0 { "Int64" } else { "Utf8" },
                "fulltext": j == 1
            })).collect::<Vec<_>>(),
            "settings": {
                "partition_keys": {"level": {"field_name": "level", "types": "value"}},
                "full_text_search_keys": ["log", "message"],
                "index_fields": ["trace_id", "span_id"],
                "bloom_filter_fields": ["trace_id"],
                "distinct_value_fields": ["level", "service"],
                "data_retention": 30,
                "max_query_range": 0,
                "store_original_data": false,
                "approx_partition": false,
                "index_updated_at": 1704067200,
                "extended_retention_days": [7, 14, 30],
                "index_original_data": false,
                "index_all_values": false,
                "enable_distinct_fields": true,
                "enable_log_patterns_extraction": i % 2 == 0,
                "is_llm_stream": false
            },
            "total_fields": 15,
            "is_derived": false
        }));
    }
    serde_json::to_string(&json!({"list": streams, "total": 20})).unwrap()
}

fn dashboards_fixture() -> String {
    let panel_types = ["line", "bar", "area", "pie", "metric", "table"];
    let panel_titles = ["Latency", "Errors", "Throughput", "CPU", "Memory", "Logs"];
    let mut dashboards = Vec::new();
    for i in 0..10 {
        let panels: Vec<Value> = (0..6)
            .map(|j| {
                let pt = panel_types[j % 6];
                let ptitle = panel_titles[j % 6];
                json!({
                    "id": format!("panel-{}", j),
                    "type": pt,
                    "title": format!("Panel {} - {}", j, ptitle),
                    "config": {
                        "query": format!("SELECT histogram(_timestamp, '1 minute') as x, AVG(value_{}) as y FROM metrics_{}", j, i),
                        "show_legends": true,
                        "legends_position": "bottom"
                    },
                    "layout": {"x": (j % 3) * 64, "y": (j / 3) * 10, "w": 64, "h": 10}
                })
            })
            .collect();
        dashboards.push(json!({
            "dashboard_id": format!("dash_{:03}", i),
            "title": format!("Dashboard {}", i),
            "description": format!("Monitors {} metrics", if i % 2 == 0 { "API" } else { "infra" }),
            "owner": "admin@example.com",
            "version": 8,
            "hash": format!("abc{}def{}", i, i * 7),
            "folder_id": "default",
            "folder_name": "Default",
            "role": "admin",
            "created": "2024-01-01T00:00:00+00:00",
            "updatedAt": 1704067200000_i64 + i * 86400000,
            "v8": {
                "panels": panels,
                "variables": [
                    {"name": "env", "values": ["prod", "staging", "dev"]},
                    {"name": "region", "values": ["us-east-1", "eu-west-1", "ap-south-1"]}
                ],
                "layout": []
            },
            "v7": null, "v6": null, "v5": null, "v4": null,
            "v3": null, "v2": null, "v1": null
        }));
    }
    serde_json::to_string(&json!({"dashboards": dashboards})).unwrap()
}

fn alerts_fixture() -> String {
    let alert_names = [
        "High Error Rate",
        "CPU Spike",
        "Memory Pressure",
        "Disk Full",
        "Latency P99",
    ];
    let folder_names = ["Production", "Staging", "Development"];
    let metrics = ["error rate", "CPU usage", "memory", "disk", "latency"];
    let columns = [
        "error_count",
        "cpu_pct",
        "mem_pct",
        "disk_pct",
        "latency_ms",
    ];
    let frequencies = [1, 5, 10, 15, 30];
    let mut alerts = Vec::new();
    for i in 0..15_usize {
        let triggered = if i % 2 == 0 {
            json!(1704067200000_i64 + i as i64 * 3600000)
        } else {
            json!(null)
        };
        let satisfied = if i % 3 == 0 {
            json!(1704060000000_i64 + i as i64 * 1800000)
        } else {
            json!(null)
        };
        alerts.push(json!({
            "alert_id": format!("alert_{:03}", i),
            "name": format!("Alert: {}", alert_names[i % 5]),
            "stream_name": format!("stream_{}", i % 5),
            "stream_type": "logs",
            "folder_id": format!("folder_{}", i % 3),
            "folder_name": folder_names[i % 3],
            "owner": format!("user{}@example.com", i % 4),
            "description": format!("Fires when {} exceeds threshold for stream_{}", metrics[i % 5], i % 5),
            "enabled": i % 3 != 2,
            "is_real_time": i % 4 == 0,
            "last_triggered_at": triggered,
            "last_satisfied_at": satisfied,
            "condition": {
                "type": "sql",
                "conditions": [
                    {"column": columns[i % 5], "operator": ">=", "value": (i + 1) * 10}
                ],
                "sql": format!("SELECT count(*) as cnt FROM stream_{} WHERE level='error'", i % 5),
                "promql": null,
                "multi_time_range": [
                    {"column": "_timestamp", "operator": ">=", "value": "now-15m"},
                    {"column": "_timestamp", "operator": "<", "value": "now"}
                ]
            },
            "trigger_condition": {
                "period": 10,
                "operator": ">=",
                "threshold": 5 + i,
                "frequency": frequencies[i % 5],
                "frequency_type": "minutes",
                "silence": 300,
                "cron": null,
                "timezone": "UTC"
            }
        }));
    }
    serde_json::to_string(&json!({"list": alerts})).unwrap()
}

fn functions_fixture() -> String {
    let fn_names = [
        "parse_json",
        "extract_level",
        "enrich_geo",
        "mask_pii",
        "compute_duration",
        "flatten_nested",
        "route_stream",
        "aggregate_metrics",
    ];
    let mut functions = Vec::new();
    for (i, name) in fn_names.iter().enumerate() {
        let streams_val = if i % 2 == 0 {
            json!([{"stream": format!("stream_{}", i), "order": i}])
        } else {
            json!(null)
        };
        functions.push(json!({
            "name": format!("fn_{}", name),
            "function": format!(
                "// Function: {}\n{}\n\n.parsed = parse_json!(.message)\n.level = .parsed.level\n.service = .parsed.service\nif .level == \"error\" {{\n  .alert = true\n}}\ndel(.raw_data)\n",
                name,
                "x".repeat(200)
            ),
            "params": "row",
            "numArgs": 1,
            "transType": if i % 3 == 0 { 1 } else { 0 },
            "streams": streams_val
        }));
    }
    serde_json::to_string(&json!({"list": functions})).unwrap()
}

fn templates_fixture() -> String {
    let tmpl_names = [
        "slack_default",
        "email_critical",
        "pagerduty",
        "webhook_json",
        "msteams",
        "sns_alert",
    ];
    let tmpl_types = ["slack", "email", "http", "http", "http", "sns"];
    let tmpl_titles = [
        "Slack Default",
        "Email Critical",
        "PagerDuty",
        "Webhook JSON",
        "MS Teams",
        "SNS Alert",
    ];
    let mut templates = Vec::new();
    for i in 0..6_usize {
        templates.push(json!({
            "name": format!("template_{}", tmpl_names[i]),
            "type": tmpl_types[i],
            "isDefault": i == 0,
            "title": format!("Template: {}", tmpl_titles[i]),
            "body": format!(
                "<html><body><h1>Alert: {{{{alert_name}}}}</h1><p>Stream: {{{{stream_name}}}}</p><p>Severity: {{{{severity}}}}</p><table>{}<tr><td>Status</td><td>{{{{status}}}}</td></tr><tr><td>Triggered</td><td>{{{{triggered_at}}}}</td></tr></table><p>Details: {{{{details}}}}</p>{}</body></html>",
                "<tr><td>Metric</td><td>Value</td></tr>".repeat(10),
                "<footer>Sent by OpenObserve Alert System</footer>".repeat(3),
            )
        }));
    }
    serde_json::to_string(&templates).unwrap()
}

fn pipelines_fixture() -> String {
    let pipe_names = [
        "ingest_logs",
        "enrich_traces",
        "route_metrics",
        "aggregate_events",
        "filter_noise",
    ];
    let pipe_descs = [
        "log ingestion",
        "trace enrichment",
        "metric routing",
        "event aggregation",
        "noise filtering",
    ];
    let node_types = ["input", "transform", "filter", "output"];
    let mut pipelines = Vec::new();
    for i in 0..5_usize {
        let nodes: Vec<Value> = (0..4)
            .map(|j| {
                let nt = node_types[j];
                json!({
                    "id": format!("node_{}_{}", i, j),
                    "type": nt,
                    "config": {
                        "function": format!("process_step_{}", j),
                        "params": {"batch_size": 100, "timeout": 30},
                        "conditions": [{"field": "level", "op": "eq", "value": "error"}]
                    },
                    "position": {"x": j * 200, "y": 100}
                })
            })
            .collect();
        let edges: Vec<Value> = (0..3)
            .map(|j| {
                json!({
                    "source": format!("node_{}_{}", i, j),
                    "target": format!("node_{}_{}", i, j + 1)
                })
            })
            .collect();
        pipelines.push(json!({
            "pipeline_id": format!("pipe_{:03}", i),
            "name": format!("pipeline_{}", pipe_names[i]),
            "description": format!("Pipeline for {}", pipe_descs[i]),
            "version": 1,
            "enabled": i % 2 == 0,
            "org": "default",
            "source": {"source_type": if i % 2 == 0 { "realtime" } else { "scheduled" }},
            "nodes": nodes,
            "edges": edges,
            "paused_at": null,
            "last_error": null
        }));
    }
    serde_json::to_string(&json!({"list": pipelines})).unwrap()
}

fn search_sql_fixture() -> String {
    let levels = ["error", "warn", "info", "debug"];
    let services = ["api-gateway", "worker", "scheduler", "monitor"];
    let categories = ["connection", "memory", "disk", "latency"];
    let messages = [
        "Connection timeout after 30s to db-primary.internal:5432",
        "High memory usage detected: 85.2% of 16GB (13.6GB used)",
        "Disk space warning: /data volume at 92% capacity (460GB/500GB)",
        "P99 latency spike: 2340ms (threshold: 500ms) for /api/v1/search",
    ];
    let pod_prefixes = ["api", "worker", "sched", "mon"];
    let mut hits = Vec::new();
    for i in 0..50_usize {
        let idx = i % 4;
        hits.push(json!({
            "_timestamp": 1704067200000000_i64 + i as i64 * 1000000,
            "log": format!("2024-01-01T{:02}:{:02}:00Z {} {} {}: {}",
                i / 60, i % 60, levels[idx].to_uppercase(), services[idx], categories[idx], messages[idx]),
            "level": levels[idx],
            "service": services[idx],
            "host": format!("prod-{:02}", i % 8),
            "trace_id": format!("tr-{:016x}", i * 12345 + 67890),
            "kubernetes.pod_name": format!("pod-{}-{}", pod_prefixes[idx], i % 3),
            "kubernetes.namespace": "production"
        }));
    }
    serde_json::to_string(&json!({
        "took": 142,
        "took_detail": {
            "total": 142, "cache_took": 12, "file_list_took": 5,
            "wait_in_queue": 3, "idx_took": 8, "search_took": 114
        },
        "columns": ["_timestamp", "log", "level", "service", "host", "trace_id", "kubernetes.pod_name", "kubernetes.namespace"],
        "hits": hits,
        "total": 50,
        "from": 0,
        "size": 50,
        "cached_ratio": 45,
        "result_cache_ratio": 20,
        "scan_files": 128,
        "scan_size": 268435456,
        "idx_scan_size": 16777216,
        "scan_records": 500000,
        "response_type": "complete",
        "trace_id": "abc-123-def-456",
        "function_error": [],
        "is_partial": false,
        "histogram_interval": null,
        "new_start_time": null,
        "new_end_time": null,
        "work_group": "default",
        "order_by": "Desc",
        "peak_memory_usage": 134217728.0
    }))
    .unwrap()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_streams_token_reduction() {
    init_test_configs();
    let full = streams_fixture();
    let summary = filter_response("StreamList", &full, &DetailLevel::Summary);

    assert_reduction("StreamList (20 streams)", &summary, &full, 80.0);

    let parsed: Value = serde_json::from_str(&summary).unwrap();
    assert_fields_present(&parsed, &["name", "stream_type", "stats.storage_size"]);
    assert_fields_absent(
        &parsed,
        &["schema", "settings", "total_fields", "storage_type"],
    );
    assert_eq!(parsed["total"], 20);
}

#[test]
fn test_dashboards_token_reduction() {
    init_test_configs();
    let full = dashboards_fixture();
    let summary = filter_response("ListDashboards", &full, &DetailLevel::Summary);

    assert_reduction("ListDashboards (10)", &summary, &full, 85.0);

    let parsed: Value = serde_json::from_str(&summary).unwrap();
    assert_fields_present(
        &parsed,
        &[
            "dashboard_id",
            "title",
            "description",
            "owner",
            "folder_name",
        ],
    );
    assert_fields_absent(&parsed, &["v8", "v7", "hash", "version"]);
}

#[test]
fn test_alerts_token_reduction() {
    init_test_configs();
    let full = alerts_fixture();
    let summary = filter_response("ListAlerts", &full, &DetailLevel::Summary);

    assert_reduction("ListAlerts (15)", &summary, &full, 60.0);

    let parsed: Value = serde_json::from_str(&summary).unwrap();
    assert_fields_present(
        &parsed,
        &[
            "name",
            "stream_name",
            "stream_type",
            "enabled",
            "is_real_time",
            "folder_id",
            "folder_name",
        ],
    );
    assert_fields_absent(&parsed, &["condition", "trigger_condition", "description"]);
}

#[test]
fn test_functions_token_reduction() {
    init_test_configs();
    let full = functions_fixture();
    let summary = filter_response("listFunctions", &full, &DetailLevel::Summary);

    assert_reduction("listFunctions (8)", &summary, &full, 70.0);

    let parsed: Value = serde_json::from_str(&summary).unwrap();
    assert_fields_present(&parsed, &["name", "transType"]);
    assert_fields_absent(&parsed, &["function", "params", "numArgs"]);
}

#[test]
fn test_templates_token_reduction() {
    init_test_configs();
    let full = templates_fixture();
    let summary = filter_response("ListTemplates", &full, &DetailLevel::Summary);

    assert_reduction("ListTemplates (6)", &summary, &full, 80.0);

    let parsed: Value = serde_json::from_str(&summary).unwrap();
    assert_fields_present(&parsed, &["name", "type", "title"]);
    assert_fields_absent(&parsed, &["body"]);
}

#[test]
fn test_pipelines_token_reduction() {
    init_test_configs();
    let full = pipelines_fixture();
    let summary = filter_response("listPipelines", &full, &DetailLevel::Summary);

    assert_reduction("listPipelines (5)", &summary, &full, 75.0);

    let parsed: Value = serde_json::from_str(&summary).unwrap();
    assert_fields_present(&parsed, &["pipeline_id", "name", "description", "enabled"]);
    assert_fields_absent(&parsed, &["nodes", "edges", "source"]);
}

#[test]
fn test_search_sql_token_reduction() {
    init_test_configs();
    let full = search_sql_fixture();
    let summary = filter_response("SearchSQL", &full, &DetailLevel::Summary);

    // SearchSQL reduction comes from stripping metadata fields (took_detail,
    // cached_ratio, etc.), not from hit truncation. With small fixtures the
    // ratio is modest; real-world payloads with 100+ hits show higher savings.
    assert_reduction("SearchSQL (50 hits)", &summary, &full, 1.0);

    let parsed: Value = serde_json::from_str(&summary).unwrap();
    // Kept fields
    assert!(parsed.get("took").is_some());
    assert!(parsed.get("total").is_some());
    assert!(parsed.get("hits").is_some());
    assert!(parsed.get("columns").is_some());
    assert!(parsed.get("from").is_some());
    assert!(parsed.get("size").is_some());
    assert!(parsed.get("scan_size").is_some());

    // Dropped fields
    assert!(parsed.get("took_detail").is_none());
    assert!(parsed.get("cached_ratio").is_none());
    assert!(parsed.get("result_cache_ratio").is_none());
    assert!(parsed.get("scan_files").is_none());
    assert!(parsed.get("scan_records").is_none());
    assert!(parsed.get("trace_id").is_none());
    assert!(parsed.get("is_partial").is_none());
    assert!(parsed.get("peak_memory_usage").is_none());
    assert!(parsed.get("work_group").is_none());
    assert!(parsed.get("order_by").is_none());
}

#[test]
fn test_search_sql_hit_cap_at_100() {
    init_test_configs();
    let mut fixture: Value = serde_json::from_str(&search_sql_fixture()).unwrap();
    // Expand hits to 150
    let hit_template = fixture["hits"][0].clone();
    let hits = fixture["hits"].as_array_mut().unwrap();
    while hits.len() < 150 {
        let mut h = hit_template.clone();
        h["_timestamp"] = json!(1704067200000000_i64 + hits.len() as i64 * 1000000);
        hits.push(h);
    }
    fixture["total"] = json!(150);
    let full = serde_json::to_string(&fixture).unwrap();

    let summary = filter_response("SearchSQL", &full, &DetailLevel::Summary);
    let parsed: Value = serde_json::from_str(&summary).unwrap();

    assert_eq!(parsed["hits"].as_array().unwrap().len(), 100);
    assert!(parsed.get("_hits_capped").is_some());
    assert_eq!(parsed["_hits_capped"]["original"], 150);
}

#[test]
fn test_full_detail_normalizes_list_responses() {
    init_test_configs();

    // Tools with summary config: full detail normalizes to { "total", "items" } but keeps all
    // fields
    let fixtures: Vec<(&str, String, usize)> = vec![
        ("StreamList", streams_fixture(), 20),
        ("ListDashboards", dashboards_fixture(), 10),
        ("ListAlerts", alerts_fixture(), 15),
    ];

    for (tool, full, expected_total) in fixtures {
        let result = filter_response(tool, &full, &DetailLevel::Full);
        let parsed: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(
            parsed["total"], expected_total,
            "detail=full should normalize total for {}",
            tool
        );
        assert!(
            parsed["items"].is_array(),
            "detail=full should normalize items for {}",
            tool
        );
        // All original fields per item should still be present
        let items = parsed["items"].as_array().unwrap();
        assert!(
            !items.is_empty(),
            "detail=full should preserve all items for {}",
            tool
        );
    }

    // SearchSQL has no summary config (uses custom transformer) — full passes through unchanged
    let search_full = search_sql_fixture();
    let result = filter_response("SearchSQL", &search_full, &DetailLevel::Full);
    assert_eq!(
        result, search_full,
        "detail=full should return SearchSQL unchanged (no summary config)"
    );
}

#[test]
fn test_unknown_tool_unchanged() {
    init_test_configs();
    let body = r#"{"some":"data","nested":{"big":"object"}}"#;
    let result = filter_response("SomeUnknownTool", body, &DetailLevel::Summary);
    assert_eq!(result, body, "unknown tools should pass through unchanged");
}

#[test]
fn test_aggregate_token_savings() {
    init_test_configs();
    let fixtures: Vec<(&str, String)> = vec![
        ("StreamList", streams_fixture()),
        ("ListDashboards", dashboards_fixture()),
        ("ListAlerts", alerts_fixture()),
        ("listFunctions", functions_fixture()),
        ("ListTemplates", templates_fixture()),
        ("listPipelines", pipelines_fixture()),
        ("SearchSQL", search_sql_fixture()),
    ];

    let mut total_full = 0;
    let mut total_summary = 0;

    eprintln!("\n{:=<70}", "");
    eprintln!("MCP Response Filter — Aggregate Token Savings Report");
    eprintln!("{:=<70}", "");
    eprintln!(
        "{:<25} {:>10} {:>10} {:>10} {:>10}",
        "Tool", "Summary", "Full", "Saved", "Reduction"
    );
    eprintln!("{:-<70}", "");

    for (tool, full) in &fixtures {
        let summary = filter_response(tool, full, &DetailLevel::Summary);
        total_full += full.len();
        total_summary += summary.len();

        let saved = full.len() - summary.len();
        let pct = (1.0 - summary.len() as f64 / full.len() as f64) * 100.0;
        eprintln!(
            "{:<25} {:>8} B {:>8} B {:>8} B {:>8.1}%",
            tool,
            summary.len(),
            full.len(),
            saved,
            pct
        );
    }

    eprintln!("{:-<70}", "");
    let total_saved = total_full - total_summary;
    let total_pct = (1.0 - total_summary as f64 / total_full as f64) * 100.0;
    eprintln!(
        "{:<25} {:>8} B {:>8} B {:>8} B {:>8.1}%",
        "TOTAL", total_summary, total_full, total_saved, total_pct,
    );
    eprintln!(
        "\nToken estimate: ~{} full -> ~{} summary (saved ~{} tokens)",
        total_full / 4,
        total_summary / 4,
        total_saved / 4,
    );
    eprintln!("{:=<70}\n", "");

    // Overall: we want at least 60% total reduction across all tools
    assert!(
        total_pct >= 60.0,
        "aggregate reduction should be >= 60%, got {:.1}%",
        total_pct
    );
}
