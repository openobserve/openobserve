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

//! Agent Signals read API.
//!
//! Reads the pre-computed `_agent_signals` derived stream (produced by the
//! rollup) and returns the signals for a window. This is a small, bounded
//! read — it never touches raw trace content. HTTP handler stays in OSS with a
//! dual `#[cfg]` impl (enterprise reads the stream; OSS returns 403), mirroring
//! `service_graph::api::get_current_topology`.

use axum::response::Response as HttpResponse;
use common::meta::http::HttpResponse as MetaHttpResponse;
use serde::Deserialize;

/// Query params for the agent-signals read endpoint.
#[derive(Debug, Deserialize)]
pub struct AgentSignalsQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    /// Optional filter: "failure" | "loop" | "cost".
    pub signal_type: Option<String>,
    /// Optional filter by source trace stream.
    pub source_stream: Option<String>,
}

#[cfg(feature = "enterprise")]
pub async fn get_agent_signals(
    axum::extract::Path(org_id): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<AgentSignalsQuery>,
) -> HttpResponse {
    use config::meta::stream::StreamType;

    let stream_name = "_agent_signals";

    let (start_time, end_time) =
        if let (Some(start), Some(end)) = (query.start_time, query.end_time) {
            (start, end)
        } else {
            let now = chrono::Utc::now().timestamp_micros();
            let window_micros =
                super::super::service_graph::DEFAULT_QUERY_WINDOW_MINUTES * 60 * 1_000_000;
            (now - window_micros, now)
        };

    // Build a bounded read over the tiny derived stream.
    let mut filters = format!("org_id = '{org_id}'");
    if let Some(st) = query.signal_type.as_deref() {
        // signal_type is a fixed small enum; guard against quote-breaking just in case.
        let st = st.replace('\'', "");
        filters.push_str(&format!(" AND signal_type = '{st}'"));
    }
    if let Some(src) = query.source_stream.as_deref() {
        let src = src.replace('\'', "");
        filters.push_str(&format!(" AND source_stream = '{src}'"));
    }
    let sql = format!(
        "SELECT * FROM \"{stream_name}\" \
         WHERE _timestamp >= {start_time} AND _timestamp < {end_time} AND {filters} \
         ORDER BY _timestamp DESC LIMIT 10000"
    );

    // If the stream doesn't exist yet (feature never ran), return an empty list.
    let schema = infra::schema::get(&org_id, stream_name, StreamType::Logs).await;
    if schema.is_err() {
        return MetaHttpResponse::json(serde_json::json!({ "signals": [] }));
    }

    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: 0,
            size: 10000,
            start_time,
            end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            action_id: None,
            histogram_interval: 0,
            streaming_id: None,
            streaming_output: false,
            sampling_config: None,
            sampling_ratio: None,
            timezone: None,
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 30,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: Some(false),
        agent_options: None,
    };

    let trace_id = config::ider::generate();
    match crate::search::search(&trace_id, &org_id, StreamType::Logs, None, &req).await {
        Ok(resp) => MetaHttpResponse::json(serde_json::json!({ "signals": resp.hits })),
        Err(e) => {
            log::error!("[AgentSignals] read query failed for org '{org_id}': {e}");
            MetaHttpResponse::json(serde_json::json!({ "signals": [] }))
        }
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn get_agent_signals(
    axum::extract::Path(_org_id): axum::extract::Path<String>,
    axum::extract::Query(_query): axum::extract::Query<AgentSignalsQuery>,
) -> HttpResponse {
    MetaHttpResponse::forbidden("Not Supported")
}

/// One arm (A or B) of a version-compare request.
#[derive(Debug, Clone, Deserialize)]
pub struct CompareArm {
    pub agent_name: String,
    pub env: Option<String>,
    pub version: Option<String>,
    pub start_time: i64,
    pub end_time: i64,
}

/// Request body for the version-compare sketch-merge endpoint.
#[derive(Debug, Clone, Deserialize)]
pub struct CompareRequest {
    pub a: CompareArm,
    pub b: CompareArm,
}

/// Aggregated per-arm inputs collected from the `_agent_signals` cost rows:
/// the per-window `latency_sketch` blobs (to be merged) and the summed cost
/// moments (additive across windows).
#[derive(Debug, Default, Clone, PartialEq)]
struct ArmAggregate {
    sketches: Vec<String>,
    cost_sum: f64,
    cost_sqsum: f64,
    cost_n: u64,
}

/// Pure helper: fold a set of `_agent_signals` cost-pass hits into an
/// [`ArmAggregate`]. Extracted so the summation/collection logic is
/// unit-testable without a search round-trip.
fn aggregate_cost_hits(hits: &[serde_json::Value]) -> ArmAggregate {
    let mut agg = ArmAggregate::default();
    // Dedup by window `_timestamp`: the rollup can write duplicate rows for the
    // same window (multi-alert-manager offset race, or a reset overlapping an
    // already-processed window), and merging duplicates would double-count.
    // Hits arrive `_timestamp DESC`, so the FIRST row seen for a timestamp is
    // the newest ingest — keep it, skip the rest.
    let mut seen_windows: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for hit in hits {
        // Rows without a parseable _timestamp are treated as distinct (fall back
        // to a per-row sentinel so we never silently drop them).
        let ts = hit.get("_timestamp").and_then(|v| v.as_i64());
        if let Some(ts) = ts
            && !seen_windows.insert(ts)
        {
            continue; // duplicate window row — already counted the newest
        }
        if let Some(s) = hit.get("latency_sketch").and_then(|v| v.as_str())
            && !s.is_empty()
        {
            agg.sketches.push(s.to_string());
        }
        if let Some(c) = hit.get("cost").and_then(|v| v.as_f64()) {
            agg.cost_sum += c;
        }
        if let Some(c) = hit.get("cost_sqsum").and_then(|v| v.as_f64()) {
            agg.cost_sqsum += c;
        }
        if let Some(n) = hit.get("cost_n").and_then(|v| v.as_u64()) {
            agg.cost_n += n;
        }
    }
    agg
}

#[cfg(feature = "enterprise")]
async fn fetch_arm_aggregate(org_id: &str, arm: &CompareArm) -> ArmAggregate {
    use config::meta::stream::StreamType;

    let stream_name = "_agent_signals";

    let mut filters = format!(
        "org_id = '{}' AND signal_type = 'cost' AND agent_name = '{}'",
        org_id.replace('\'', ""),
        arm.agent_name.replace('\'', "")
    );
    if let Some(env) = arm.env.as_deref() {
        filters.push_str(&format!(
            " AND gen_ai_agent_env = '{}'",
            env.replace('\'', "")
        ));
    }
    if let Some(version) = arm.version.as_deref() {
        filters.push_str(&format!(
            " AND gen_ai_agent_version = '{}'",
            version.replace('\'', "")
        ));
    }

    // Select `_timestamp` so the fold can dedup to ONE row per rollup window.
    // The rollup stamps every row of a window at its window-end `ts`, so a
    // window that was double-processed (e.g. multiple alert-managers racing the
    // offset-ownership handoff, or a reset that overlapped an already-processed
    // window) produces duplicate rows sharing a `_timestamp`. Merging all of
    // them would double-count that window's latency/cost — so dedup by
    // `_timestamp` (keep the newest ingest) before merging.
    let sql = format!(
        "SELECT _timestamp, latency_sketch, cost, cost_sqsum, cost_n FROM \"{stream_name}\" \
         WHERE _timestamp >= {} AND _timestamp < {} AND {filters} \
         ORDER BY _timestamp DESC \
         LIMIT 10000",
        arm.start_time, arm.end_time
    );

    let schema = infra::schema::get(org_id, stream_name, StreamType::Logs).await;
    if schema.is_err() {
        return ArmAggregate::default();
    }

    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: 0,
            size: 10000,
            start_time: arm.start_time,
            end_time: arm.end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            action_id: None,
            histogram_interval: 0,
            streaming_id: None,
            streaming_output: false,
            sampling_config: None,
            sampling_ratio: None,
            timezone: None,
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 30,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: Some(false),
        agent_options: None,
    };

    let trace_id = config::ider::generate();
    match crate::search::search(&trace_id, org_id, StreamType::Logs, None, &req).await {
        Ok(resp) => aggregate_cost_hits(&resp.hits),
        Err(e) => {
            log::error!("[AgentSignals] compare read query failed for org '{org_id}': {e}");
            ArmAggregate::default()
        }
    }
}

#[cfg(feature = "enterprise")]
pub async fn compare_agent_versions(
    axum::extract::Path(org_id): axum::extract::Path<String>,
    axum::Json(req): axum::Json<CompareRequest>,
) -> HttpResponse {
    use o2_enterprise::enterprise::agent_signals::compare::{
        MetricDelta, merge_sketches, quantile_delta_ci, welch_mean_diff_ci,
    };

    let agg_a = fetch_arm_aggregate(&org_id, &req.a).await;
    let agg_b = fetch_arm_aggregate(&org_id, &req.b).await;

    let insufficient = || MetricDelta {
        a: 0.0,
        b: 0.0,
        delta: 0.0,
        lo: 0.0,
        hi: 0.0,
        straddles_zero: true,
        insufficient: true,
    };

    let merged_a = merge_sketches(&agg_a.sketches).unwrap_or(None);
    let merged_b = merge_sketches(&agg_b.sketches).unwrap_or(None);

    let (p50, p95, p99) = match (&merged_a, &merged_b) {
        (Some(sa), Some(sb)) => (
            quantile_delta_ci(sa, sb, 0.5, 0.90),
            quantile_delta_ci(sa, sb, 0.95, 0.90),
            quantile_delta_ci(sa, sb, 0.99, 0.90),
        ),
        _ => (insufficient(), insufficient(), insufficient()),
    };

    let cost = welch_mean_diff_ci(
        agg_a.cost_sum,
        agg_a.cost_sqsum,
        agg_a.cost_n,
        agg_b.cost_sum,
        agg_b.cost_sqsum,
        agg_b.cost_n,
        0.90,
    );

    MetaHttpResponse::json(serde_json::json!({
        "p50": p50,
        "p95": p95,
        "p99": p99,
        "cost": cost,
    }))
}

#[cfg(not(feature = "enterprise"))]
pub async fn compare_agent_versions(
    axum::extract::Path(_org_id): axum::extract::Path<String>,
    axum::Json(_req): axum::Json<CompareRequest>,
) -> HttpResponse {
    fn insufficient() -> serde_json::Value {
        serde_json::json!({
            "a": 0.0,
            "b": 0.0,
            "delta": 0.0,
            "lo": 0.0,
            "hi": 0.0,
            "straddles_zero": true,
            "insufficient": true,
        })
    }

    MetaHttpResponse::json(serde_json::json!({
        "p50": insufficient(),
        "p95": insufficient(),
        "p99": insufficient(),
        "cost": insufficient(),
        "note": "CI math requires the enterprise build; point-only comparison is not available in OSS.",
    }))
}

#[cfg(test)]
mod compare_tests {
    use super::*;

    #[test]
    fn aggregate_cost_hits_sums_moments_and_collects_sketches() {
        let hits = vec![
            serde_json::json!({
                "latency_sketch": "sketchA",
                "cost": 1.5,
                "cost_sqsum": 2.25,
                "cost_n": 3,
            }),
            serde_json::json!({
                "latency_sketch": "sketchB",
                "cost": 2.0,
                "cost_sqsum": 4.0,
                "cost_n": 5,
            }),
            // A row missing the sketch/cost fields should not break the fold.
            serde_json::json!({ "org_id": "o1" }),
        ];

        let agg = aggregate_cost_hits(&hits);
        assert_eq!(agg.sketches, vec!["sketchA".to_string(), "sketchB".to_string()]);
        assert!((agg.cost_sum - 3.5).abs() < 1e-9);
        assert!((agg.cost_sqsum - 6.25).abs() < 1e-9);
        assert_eq!(agg.cost_n, 8);
    }

    #[test]
    fn aggregate_cost_hits_dedups_duplicate_window_rows_by_timestamp() {
        // Two rows share _timestamp=1000 (a double-processed window: multi
        // alert-manager race / reset overlap). Only the FIRST (newest ingest,
        // since input is _timestamp DESC) must count — no double-counting.
        let hits = vec![
            serde_json::json!({ "_timestamp": 2000, "latency_sketch": "w2", "cost": 5.0, "cost_sqsum": 25.0, "cost_n": 10 }),
            serde_json::json!({ "_timestamp": 1000, "latency_sketch": "w1_new", "cost": 3.0, "cost_sqsum": 9.0, "cost_n": 6 }),
            serde_json::json!({ "_timestamp": 1000, "latency_sketch": "w1_dup", "cost": 3.0, "cost_sqsum": 9.0, "cost_n": 6 }),
        ];
        let agg = aggregate_cost_hits(&hits);
        // window 1000 counted ONCE (the newest, "w1_new"), window 2000 once.
        assert_eq!(agg.sketches, vec!["w2".to_string(), "w1_new".to_string()]);
        assert!((agg.cost_sum - 8.0).abs() < 1e-9, "cost not double-counted: {}", agg.cost_sum);
        assert_eq!(agg.cost_n, 16, "n not double-counted");
    }

    #[test]
    fn aggregate_cost_hits_empty_input_is_zeroed_default() {
        let agg = aggregate_cost_hits(&[]);
        assert_eq!(agg, ArmAggregate::default());
    }
}
