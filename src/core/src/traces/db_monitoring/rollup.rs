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

//! Database Monitoring rollup: the Phase-2 `_o2_db_stats` writer
//! (design: `docs/___databsepages/dbm-design-doc.md` §5).
//!
//! A dedicated windowed job (structurally cloned from the service-graph
//! processor, but with no enterprise cfg — unlike parts of the read API in
//! `api.rs`, this module is identical in both builds) that, per `(org, trace
//! stream)` and per window, runs THREE aggregation queries over the
//! ingest-stamped `o2_db_*` columns and writes three record families into the
//! `_o2_db_stats` summary stream:
//!
//! 1. `query_stats` — per-fingerprint stats, bounded in SQL to the top-N fingerprints per
//!    `(db_system, db_instance)` by total time (rank stage live-verified on a production cluster,
//!    §5.2), keeping ALL constituent rows (per namespace × env × service) of each winning
//!    fingerprint, plus arithmetically derived `_other` remainder rows;
//! 2. `db_totals` — exact per-`(system, instance, namespace)` window totals with their own
//!    percentiles, plus per-`(system, instance, stmt_class)` class totals (one query via `UNION
//!    ALL`) — the reconciliation base for `_other` and FR-1's latency numbers;
//! 3. `error_class` — per-status-code error counts, restricted to the winning fingerprint set with
//!    the remainder folded into one "other-errors" row per `(system, instance, code)`.
//!
//! Offsets are PER-`(org, stream)` (`/db_monitoring/offsets/{org}/{stream}`):
//! a failing stream retries its window next tick WITHOUT advancing its own
//! offset and WITHOUT blocking any other stream (design D3).

use std::collections::{HashMap, HashSet};

use config::{cluster::LOCAL_NODE, get_config, meta::stream::StreamType, utils::time::now_micros};
use futures::StreamExt;
use infra::cluster::get_node_by_uuid;
use serde_json::{Value, json};

/// The summary stream written by this job. Declared as
/// `StreamType::ServiceGraph` in the internal ingestion request (the stream
/// NAME separates the data), read back as Logs — the exact mechanics of
/// `_o2_service_graph` (design §5.3).
pub const O2_DB_STATS_STREAM: &str = "_o2_db_stats";

/// Request size for each rollup search. A query returning exactly this many
/// rows means the answer was truncated by the request cap — the window's
/// records are then flagged `truncated=true` (design §5.2 defense in depth).
/// Shared with the read API's live tail (design D4), which applies the same
/// exactly-the-cap rule to set `tail_truncated`.
pub(crate) const SEARCH_SIZE: usize = 100000;

/// Catch-up cap: never scan more than this many windows per (stream, tick).
const MAX_CATCHUP_WINDOWS: usize = 4;

/// How many streams roll up concurrently per tick. Streams are independent
/// (per-stream offsets and locks), so a modest fan-out shortens the tick
/// without stampeding the search path.
const STREAM_CONCURRENCY: usize = 4;

#[derive(serde::Deserialize)]
struct RecentIngestedTraceStream {
    org_id: String,
    stream_name: String,
}

// ─── SQL builders (pure — unit-tested against exact strings) ─────────────────

/// The shared §5.1 metric block: batch-aware statement count, call/error
/// counts, total/percentile/max latency (ns — `start_time`/`end_time` are
/// nanoseconds), distinct traces, and (schema-gated) row-count columns.
fn metric_block(has_rows_col: bool) -> String {
    let rows = if has_rows_col {
        ",\n    SUM(CASE WHEN db_response_returned_rows IS NOT NULL THEN db_response_returned_rows ELSE 0 END) AS rows_returned,\n    COUNT(db_response_returned_rows) AS rows_emitting_calls"
    } else {
        ""
    };
    format!(
        "SUM(COALESCE(o2_db_batch_multiplier, 1)) AS statements,\n    \
         COUNT(*) AS calls,\n    \
         COUNT(*) FILTER (WHERE span_status = 'ERROR') AS errors,\n    \
         SUM(end_time - start_time) AS total_time_ns,\n    \
         CAST(approx_median(end_time - start_time) AS BIGINT) AS p50_ns,\n    \
         CAST(approx_percentile_cont(end_time - start_time, 0.95) AS BIGINT) AS p95_ns,\n    \
         CAST(approx_percentile_cont(end_time - start_time, 0.99) AS BIGINT) AS p99_ns,\n    \
         MAX(end_time - start_time) AS max_ns,\n    \
         COUNT(DISTINCT trace_id) AS traces{rows}"
    )
}

/// Stage-1 rank query (design §5.2, live-verified shape): inner §5.1 aggregate
/// per (fingerprint, system, namespace, instance, env, service_name) → window
/// `SUM(total_time_ns)` per (system, instance, fingerprint) → `DENSE_RANK` per
/// (system, instance) ordered by that fingerprint total → keep `rnk <= top_n`,
/// retaining ALL constituent rows of each winning fingerprint.
pub(crate) fn build_rank_sql(
    stream_name: &str,
    start_time: i64,
    end_time: i64,
    top_n: usize,
    has_rows_col: bool,
) -> String {
    let metrics = metric_block(has_rows_col);
    format!(
        r#"SELECT * FROM (
  SELECT *, DENSE_RANK() OVER (PARTITION BY db_system, db_instance ORDER BY fp_total DESC) AS rnk FROM (
    SELECT *, SUM(total_time_ns) OVER (PARTITION BY db_system, db_instance, fingerprint) AS fp_total FROM (
SELECT
    o2_db_fingerprint AS fingerprint,
    max(o2_db_query_norm) AS query_norm,
    o2_db_system AS db_system,
    o2_db_namespace AS db_namespace,
    o2_db_instance AS db_instance,
    o2_db_env AS env,
    service_name,
    max(o2_db_operation) AS operation,
    max(o2_db_stmt_class) AS stmt_class,
    {metrics}
FROM "{stream_name}"
WHERE _timestamp >= {start_time} AND _timestamp < {end_time}
    AND o2_db_fingerprint IS NOT NULL
GROUP BY o2_db_fingerprint, o2_db_system, o2_db_namespace, o2_db_instance, o2_db_env, service_name
    ) AS agg
  ) AS fp_totaled
) AS ranked WHERE rnk <= {top_n}"#
    )
}

/// `db_totals` query (design §5.2): exact per-(system, instance, namespace)
/// window totals with their own percentiles, UNION ALL'd with the
/// per-(system, instance, stmt_class) class totals. Namespace-grain rows carry
/// `stmt_class = NULL`; class-grain rows carry `db_namespace = NULL`.
///
/// TODO(perf): the UNION ALL scans the window twice differing only in GROUP
/// BY; DataFusion's GROUPING SETS could halve that. NOT converted yet: (a) the
/// search harness's SQL rewrite layer has not been verified against GROUPING
/// SETS on a live cluster (the UNION ALL shape is the live-verified one), and
/// (b) without `GROUPING()` discriminator columns a genuinely-NULL group value
/// would be ambiguous with the other grain's NULL marker.
pub(crate) fn build_totals_sql(
    stream_name: &str,
    start_time: i64,
    end_time: i64,
    has_rows_col: bool,
) -> String {
    let metrics = metric_block(has_rows_col);
    format!(
        r#"SELECT
    o2_db_system AS db_system,
    o2_db_instance AS db_instance,
    o2_db_namespace AS db_namespace,
    CAST(NULL AS STRING) AS stmt_class,
    {metrics}
FROM "{stream_name}"
WHERE _timestamp >= {start_time} AND _timestamp < {end_time}
    AND o2_db_fingerprint IS NOT NULL
GROUP BY o2_db_system, o2_db_instance, o2_db_namespace
UNION ALL
SELECT
    o2_db_system AS db_system,
    o2_db_instance AS db_instance,
    CAST(NULL AS STRING) AS db_namespace,
    o2_db_stmt_class AS stmt_class,
    {metrics}
FROM "{stream_name}"
WHERE _timestamp >= {start_time} AND _timestamp < {end_time}
    AND o2_db_fingerprint IS NOT NULL
GROUP BY o2_db_system, o2_db_instance, o2_db_stmt_class"#
    )
}

/// `error_class` query (design §5.1 errors-by-code): error spans only, per
/// (fingerprint, system, instance, env, status code). Bounding to the winning
/// fingerprint set happens client-side ([`fold_error_class`]) — the IN-list is
/// already in hand from the rank stage and the search path is subquery-hostile.
fn build_error_class_sql(stream_name: &str, start_time: i64, end_time: i64) -> String {
    format!(
        r#"SELECT
    o2_db_fingerprint AS fingerprint,
    o2_db_system AS db_system,
    o2_db_instance AS db_instance,
    o2_db_env AS env,
    COALESCE(o2_db_status_code, 'unknown') AS status_code,
    COUNT(*) AS errors
FROM "{stream_name}"
WHERE _timestamp >= {start_time} AND _timestamp < {end_time}
    AND o2_db_fingerprint IS NOT NULL
    AND span_status = 'ERROR'
GROUP BY o2_db_fingerprint, o2_db_system, o2_db_instance, o2_db_env, COALESCE(o2_db_status_code, 'unknown')"#
    )
}

// ─── Pure row transforms (unit-tested over synthetic rows) ───────────────────

pub(crate) fn get_str(row: &Value, key: &str) -> String {
    row.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

/// Borrowed variant of [`get_str`] for the hot client-side folds: at
/// `SEARCH_SIZE` rows the owned version costs ~10^6 short String allocations
/// per window. The rows outlive every map keyed by these slices, so the folds
/// borrow and convert to owned only for emitted `_other` rows.
pub(crate) fn get_str_ref<'a>(row: &'a Value, key: &str) -> &'a str {
    row.get(key).and_then(|v| v.as_str()).unwrap_or_default()
}

/// Numeric extraction tolerant of the search path's i64/u64/f64 JSON numbers.
pub(crate) fn get_i64(row: &Value, key: &str) -> i64 {
    match row.get(key) {
        Some(Value::Number(n)) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f as i64))
            .unwrap_or(0),
        _ => 0,
    }
}

/// The winning fingerprint set of a window, keyed by
/// `(db_system, db_instance, fingerprint)` — rank is per (system, instance),
/// so the same fingerprint may win on one instance and lose on another.
fn winning_fingerprints(stage1_rows: &[Value]) -> HashSet<(&str, &str, &str)> {
    stage1_rows
        .iter()
        .map(|r| {
            (
                get_str_ref(r, "db_system"),
                get_str_ref(r, "db_instance"),
                get_str_ref(r, "fingerprint"),
            )
        })
        .collect()
}

/// Restrict error_class rows to the stage-1 winning fingerprint set; fold the
/// rest into ONE "other-errors" row per (system, instance, code) with
/// `fingerprint = "_other"` (env intentionally dropped on folded rows — they
/// merge across envs).
fn fold_error_class(error_rows: Vec<Value>, winning: &HashSet<(&str, &str, &str)>) -> Vec<Value> {
    // Pass 1 (borrowed): classify each row and fold loser sums keyed by
    // borrowed slices — owned Strings only materialize for emitted rows.
    let mut folded: HashMap<(&str, &str, &str), i64> = HashMap::new();
    let mut keep = Vec::with_capacity(error_rows.len());
    for row in &error_rows {
        let key = (
            get_str_ref(row, "db_system"),
            get_str_ref(row, "db_instance"),
            get_str_ref(row, "fingerprint"),
        );
        let is_winner = winning.contains(&key);
        keep.push(is_winner);
        if !is_winner {
            *folded
                .entry((key.0, key.1, get_str_ref(row, "status_code")))
                .or_insert(0) += get_i64(row, "errors");
        }
    }
    // Deterministic output order for the folded rows.
    let mut folded: Vec<_> = folded.into_iter().collect();
    folded.sort_by_key(|&(key, _)| key);
    let other: Vec<Value> = folded
        .into_iter()
        .map(|((db_system, db_instance, status_code), errors)| {
            json!({
                "fingerprint": "_other",
                "db_system": db_system,
                "db_instance": db_instance,
                "status_code": status_code,
                "errors": errors,
            })
        })
        .collect();
    let mut kept: Vec<Value> = error_rows
        .into_iter()
        .zip(keep)
        .filter_map(|(row, k)| k.then_some(row))
        .collect();
    kept.extend(other);
    kept
}

/// Additive metrics used by the `_other` arithmetic. `traces` is NOT additive
/// (§5.1 merge rule) — the derived value is an upper bound, clamped at 0 like
/// the rest; percentiles/max are omitted entirely (`_other` carries no
/// latency distribution by design).
const ADDITIVE_METRICS: [&str; 7] = [
    "statements",
    "calls",
    "errors",
    "total_time_ns",
    "traces",
    "rows_returned",
    "rows_emitting_calls",
];

/// Per-`(db_system, db_instance)` sums of the additive metrics, keyed by
/// slices borrowed from the input rows (the rows outlive the map at every
/// call site — owned copies only materialize for emitted `_other` rows).
type InstanceSums<'a> = HashMap<(&'a str, &'a str), HashMap<&'static str, i64>>;

/// Sum `ADDITIVE_METRICS` of `rows` grouped by `(db_system, db_instance)`,
/// tracking which metric keys were actually present in any input row (rows
/// columns are schema-gated, so absent keys must stay absent in `_other`).
fn accumulate<'a>(
    rows: impl Iterator<Item = &'a Value>,
) -> (InstanceSums<'a>, HashSet<&'static str>) {
    let mut sums: InstanceSums = HashMap::new();
    let mut present: HashSet<&'static str> = HashSet::new();
    for row in rows {
        let key = (
            get_str_ref(row, "db_system"),
            get_str_ref(row, "db_instance"),
        );
        let entry = sums.entry(key).or_default();
        for metric in ADDITIVE_METRICS {
            if row.get(metric).is_some_and(|v| !v.is_null()) {
                present.insert(metric);
                *entry.entry(metric).or_insert(0) += get_i64(row, metric);
            }
        }
    }
    (sums, present)
}

/// Derive the arithmetic `_other` remainder rows (design §5.2):
/// - at `(db_system, db_instance)` grain: namespace-grain `db_totals` sums minus the stage-1 top-N
///   sums;
/// - at `(db_system, db_instance, stmt_class='query')` grain: the class totals for `query` minus
///   the stage-1 rows classed `query`.
///
/// All differences clamp at 0; a remainder with `calls == 0` is not emitted.
pub(crate) fn derive_other_rows<'a>(
    stage1_rows: &'a [Value],
    totals_rows: &'a [Value],
) -> Vec<Value> {
    // Split db_totals into its two grains by which discriminator is set.
    let namespace_grain: Vec<&Value> = totals_rows
        .iter()
        .filter(|r| r.get("stmt_class").is_none_or(|v| v.is_null()))
        .collect();
    let query_class_grain: Vec<&Value> = totals_rows
        .iter()
        .filter(|r| r.get("stmt_class").and_then(|v| v.as_str()) == Some("query"))
        .collect();

    let (instance_totals, present) = accumulate(namespace_grain.into_iter());
    let (topn_sums, _) = accumulate(stage1_rows.iter());
    let (class_totals, class_present) = accumulate(query_class_grain.into_iter());
    let (topn_class_sums, _) = accumulate(
        stage1_rows
            .iter()
            .filter(|r| r.get("stmt_class").and_then(|v| v.as_str()) == Some("query")),
    );

    let mut out = Vec::new();
    let mut emit = |totals: InstanceSums<'a>,
                    topn: &InstanceSums<'a>,
                    present: &HashSet<&'static str>,
                    stmt_class: Option<&str>| {
        let mut keys: Vec<_> = totals.keys().copied().collect();
        keys.sort();
        for key in keys {
            let total = &totals[&key];
            let top = topn.get(&key);
            let mut row = json!({
                "fingerprint": "_other",
                "db_system": key.0,
                "db_instance": key.1,
            });
            if let Some(class) = stmt_class {
                row["stmt_class"] = json!(class);
            }
            let mut calls = 0;
            for metric in ADDITIVE_METRICS {
                if !present.contains(metric) {
                    continue;
                }
                let diff = (total.get(metric).copied().unwrap_or(0)
                    - top.and_then(|t| t.get(metric)).copied().unwrap_or(0))
                .max(0);
                if metric == "calls" {
                    calls = diff;
                }
                row[metric] = json!(diff);
            }
            if calls > 0 {
                out.push(row);
            }
        }
    };
    emit(instance_totals, &topn_sums, &present, None);
    emit(
        class_totals,
        &topn_class_sums,
        &class_present,
        Some("query"),
    );
    out
}

/// Stamp one aggregated row into a final `_o2_db_stats` record:
/// `_timestamp` = window END (µs), org/stream identity, `record_type`,
/// `fp_version`, and `truncated` (only when true). Rank-stage artifacts
/// (`rnk`, `fp_total`) are stripped — they are not part of the record schema.
fn to_record(
    mut row: Value,
    record_type: &str,
    window_end: i64,
    org_id: &str,
    trace_stream_name: &str,
    truncated: bool,
) -> Value {
    if let Some(obj) = row.as_object_mut() {
        obj.remove("rnk");
        obj.remove("fp_total");
        obj.insert("_timestamp".into(), json!(window_end));
        obj.insert("org_id".into(), json!(org_id));
        obj.insert("trace_stream_name".into(), json!(trace_stream_name));
        obj.insert("record_type".into(), json!(record_type));
        // fp_version: one scalar with the ingest-side `o2_db_fp_version` —
        // both stamp [`super::FP_VERSION`], reconciled by definition.
        obj.insert("fp_version".into(), json!(super::FP_VERSION));
        if truncated {
            obj.insert("truncated".into(), json!(true));
        }
    }
    row
}

/// Assemble the full record batch for one (stream, window).
#[allow(clippy::too_many_arguments)]
fn build_records(
    stage1_rows: Vec<Value>,
    other_rows: Vec<Value>,
    totals_rows: Vec<Value>,
    error_rows: Vec<Value>,
    window_end: i64,
    org_id: &str,
    trace_stream_name: &str,
    truncated: bool,
) -> Vec<Value> {
    let mut records = Vec::with_capacity(
        stage1_rows.len() + other_rows.len() + totals_rows.len() + error_rows.len(),
    );
    for row in stage1_rows.into_iter().chain(other_rows) {
        records.push(to_record(
            row,
            "query_stats",
            window_end,
            org_id,
            trace_stream_name,
            truncated,
        ));
    }
    for row in totals_rows {
        records.push(to_record(
            row,
            "db_totals",
            window_end,
            org_id,
            trace_stream_name,
            truncated,
        ));
    }
    for row in error_rows {
        records.push(to_record(
            row,
            "error_class",
            window_end,
            org_id,
            trace_stream_name,
            truncated,
        ));
    }
    records
}

// ─── Processor ───────────────────────────────────────────────────────────────

/// Main entry point, called by the OSS `db_monitoring` job each tick.
///
/// Discovery = usage-active trace streams ∪ every trace stream in the schema
/// cache (same union + rationale as the service-graph processor). Each stream
/// is schema-gated on `o2_db_fingerprint` via the DB-BACKED lookup BEFORE any
/// search — a cold in-memory cache on this node must not silently disable the
/// rollup — then processed independently against its own offset.
pub async fn process_db_monitoring() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return Ok(());
    }
    let now = now_micros();
    let window_micros = (cfg.db_monitoring.interval_secs as i64).max(1) * 1_000_000;

    // Query the usage stream for recently-ingesting trace streams.
    let sql = r#"SELECT org_id, stream_name
        FROM "usage"
        WHERE event = 'Ingestion' AND stream_type = 'traces'
        GROUP BY org_id, stream_name"#
        .to_string();
    let usage_results = match crate::self_reporting::search::get_usage(
        sql,
        now - window_micros,
        now,
        false,
    )
    .await
    {
        Ok(v) => v
            .into_iter()
            .filter_map(
                |v| match serde_json::from_value::<RecentIngestedTraceStream>(v) {
                    Ok(usage) => Some(usage),
                    Err(e) => {
                        log::warn!("[DbMonitoring] Failed to deserialize usage row: {e}");
                        None
                    }
                },
            )
            .collect::<Vec<_>>(),
        Err(e) => {
            log::warn!(
                "[DbMonitoring] usage-stream discovery failed ({e}); using schema cache only"
            );
            Vec::new()
        }
    };

    // Union with every trace stream in the schema cache, deduped.
    let mut discovered = usage_results;
    let mut seen: HashSet<(String, String)> = discovered
        .iter()
        .map(|s| (s.org_id.clone(), s.stream_name.clone()))
        .collect();
    match crate::organization::list_all_orgs(None).await {
        Ok(orgs) => {
            let mut grouped = crate::db::schema::list_all_streams_grouped().await;
            for org in orgs {
                let Some(streams) = grouped
                    .get_mut(&org.identifier)
                    .and_then(|types| types.remove(&StreamType::Traces))
                else {
                    continue;
                };
                for stream_name in streams {
                    if seen.insert((org.identifier.clone(), stream_name.clone())) {
                        discovered.push(RecentIngestedTraceStream {
                            org_id: org.identifier.clone(),
                            stream_name,
                        });
                    }
                }
            }
        }
        Err(e) => log::warn!(
            "[DbMonitoring] org list failed; processing usage-discovered streams only: {e}"
        ),
    }

    log::debug!(
        "[DbMonitoring] Considering {} trace streams (usage ∪ schema cache)",
        discovered.len()
    );

    // Streams are independent (per-stream offsets/locks) — process a few
    // concurrently, keeping per-stream error isolation.
    futures::stream::iter(discovered)
        .for_each_concurrent(
            STREAM_CONCURRENCY,
            |RecentIngestedTraceStream {
                 org_id,
                 stream_name,
             }| async move {
                // Schema gate BEFORE any search: skip streams without the
                // fingerprint column. DB-backed lookup, deliberately not the
                // cache-only variant. Fetched ONCE per (stream, tick) — the
                // schema-gated rows columns are derived from the same fetch
                // and passed down to every catch-up window.
                let Ok(schema) = infra::schema::get(&org_id, &stream_name, StreamType::Traces)
                    .await
                else {
                    return;
                };
                if schema.field_with_name(super::O2_DB_FINGERPRINT).is_err() {
                    return;
                }
                // Row-count columns are opportunistic (rare in the wild).
                let has_rows_col = schema.field_with_name("db_response_returned_rows").is_ok();

                // Per-stream isolation: a failing stream logs, keeps its
                // offset, and never blocks the others.
                if let Err(e) =
                    process_stream(&org_id, &stream_name, now, window_micros, has_rows_col).await
                {
                    log::error!(
                        "[DbMonitoring] stream {org_id}/{stream_name} failed (offset NOT advanced, retried next tick): {e}"
                    );
                }
            },
        )
        .await;

    Ok(())
}

/// Process one stream's pending windows against its own offset.
///
/// First run (offset 0) starts one window back from now. On each successful
/// window the offset advances and persists; on failure it does NOT advance —
/// the same window is retried next tick. At most [`MAX_CATCHUP_WINDOWS`]
/// windows are scanned per tick.
async fn process_stream(
    org_id: &str,
    stream_name: &str,
    now: i64,
    window_micros: i64,
    has_rows_col: bool,
) -> Result<(), anyhow::Error> {
    // A meta-DB read failure is NOT a fresh stream: treating it as (0, "")
    // would restart one window back AND steal the coordination lock from
    // whichever node holds it. Skip this tick — offset and lock untouched.
    let (mut offset, node) = match crate::db::db_monitoring::get_offset(org_id, stream_name).await {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "[DbMonitoring] {org_id}/{stream_name} offset read failed; skipping this tick (offset and lock untouched): {e}"
            );
            return Ok(());
        }
    };
    // Another live node holds this stream's lock — skip.
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(());
    }
    // Claim the lock before processing.
    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        crate::db::db_monitoring::set_offset(org_id, stream_name, offset, Some(&LOCAL_NODE.uuid))
            .await?;
    }

    // First run: begin one window back — never a full-history backfill.
    if offset == 0 {
        offset = now - window_micros;
    }

    let mut processed = 0;
    while offset + window_micros <= now && processed < MAX_CATCHUP_WINDOWS {
        let (start_time, end_time) = (offset, offset + window_micros);
        // Any window failure propagates WITHOUT advancing the offset.
        process_window(org_id, stream_name, start_time, end_time, has_rows_col).await?;
        offset = end_time;
        crate::db::db_monitoring::set_offset(org_id, stream_name, offset, Some(&LOCAL_NODE.uuid))
            .await?;
        processed += 1;
    }
    Ok(())
}

/// Run the three window queries for one (stream, window), fold client-side,
/// and write the `_o2_db_stats` records.
async fn process_window(
    org_id: &str,
    stream_name: &str,
    start_time: i64,
    end_time: i64,
    has_rows_col: bool,
) -> Result<(), anyhow::Error> {
    let cfg = get_config();

    // (1) stage-1 rank query: top-N fingerprints per (system, instance).
    let rank_sql = build_rank_sql(
        stream_name,
        start_time,
        end_time,
        cfg.db_monitoring.top_n,
        has_rows_col,
    );
    let stage1_rows = run_dbm_search(org_id, rank_sql, start_time, end_time).await?;
    if stage1_rows.is_empty() {
        // Idle window — nothing to roll up, nothing to write.
        return Ok(());
    }

    // (2) db_totals + class totals (one UNION ALL query) and (3) error_class:
    // independent of each other — only the empty-window early exit above
    // depends on stage 1 — so they run concurrently.
    let totals_sql = build_totals_sql(stream_name, start_time, end_time, has_rows_col);
    let error_sql = build_error_class_sql(stream_name, start_time, end_time);
    let (totals_rows, error_rows) = tokio::join!(
        run_dbm_search(org_id, totals_sql, start_time, end_time),
        run_dbm_search(org_id, error_sql, start_time, end_time)
    );
    let (totals_rows, error_rows) = (totals_rows?, error_rows?);

    // A query answering exactly the request size was truncated by the cap.
    let truncated = stage1_rows.len() == SEARCH_SIZE
        || totals_rows.len() == SEARCH_SIZE
        || error_rows.len() == SEARCH_SIZE;
    if truncated {
        log::warn!(
            "[DbMonitoring] {org_id}/{stream_name} window [{start_time},{end_time}) hit the {SEARCH_SIZE}-row request cap; records flagged truncated=true"
        );
    }

    let winning = winning_fingerprints(&stage1_rows);
    let error_rows = fold_error_class(error_rows, &winning);
    let other_rows = derive_other_rows(&stage1_rows, &totals_rows);

    let records = build_records(
        stage1_rows,
        other_rows,
        totals_rows,
        error_rows,
        end_time,
        org_id,
        stream_name,
        truncated,
    );
    write_db_stats(org_id, stream_name, records).await
}

/// The one `config::meta::search::Request` shape every DBM search issues —
/// this 30-field literal used to be restated verbatim at three sites (here,
/// the read API's `run_stats_search` and `run_events_search`), which is
/// exactly how field drift starts. `size` and `timeout` are the only knobs
/// that legitimately differ between the rollup job and the read API.
pub(crate) fn dbm_search_request(
    sql: String,
    start_time: i64,
    end_time: i64,
    size: i64,
    timeout: i64,
) -> config::meta::search::Request {
    config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: 0,
            size,
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
        timeout,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: Some(false),
        agent_options: None,
    }
}

/// Run one rollup query through the same search harness as the service-graph
/// processor (`crate::search::search`, `StreamType::Traces`). Also used by the
/// read API's live tail, which runs the same bounded two-stage SQL over the
/// un-rolled-up span tail (design D4).
pub(crate) async fn run_dbm_search(
    org_id: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<Value>, anyhow::Error> {
    let req = dbm_search_request(sql, start_time, end_time, SEARCH_SIZE as i64, 300);

    let trace_id = config::ider::generate();
    let resp = crate::search::search(&trace_id, org_id, StreamType::Traces, None, &req).await?;
    Ok(resp.hits)
}

/// Write the window's records to `_o2_db_stats` via the internal ingestion
/// path the aggregators use: `StreamType::ServiceGraph` declared in the
/// request (the gRPC handler funnels it into the logs pipeline with the
/// internal-writer/`is_derived` flags set, passing the `_o2_` write guard's
/// internal exemption), distinct stream name, read back as Logs.
async fn write_db_stats(
    org_id: &str,
    trace_stream_name: &str,
    records: Vec<Value>,
) -> Result<(), anyhow::Error> {
    if records.is_empty() {
        return Ok(());
    }
    let record_count = records.len();

    use proto::cluster_rpc;
    let req = cluster_rpc::IngestionRequest {
        org_id: org_id.to_string(),
        stream_type: StreamType::ServiceGraph.as_str().to_string(),
        stream_name: O2_DB_STATS_STREAM.to_string(),
        data: Some(cluster_rpc::IngestionData {
            data: serde_json::to_vec(&records)?,
        }),
        ingestion_type: Some(cluster_rpc::IngestionType::Json as i32),
        metadata: None,
    };
    crate::ingestion::ingestion_service::ingest(req)
        .await
        .map(|_| ())
        .map_err(|e| anyhow::anyhow!("{e}"))
        .inspect_err(|e| {
            log::error!(
                "[DbMonitoring] Failed to write {record_count} records for {org_id}/{trace_stream_name}: {e}"
            );
        })?;

    log::info!(
        "[DbMonitoring] Wrote {record_count} _o2_db_stats records for {org_id}/{trace_stream_name}"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    // ── SQL builders: exact strings ─────────────────────────────────────────

    #[test]
    fn test_rank_sql_exact_with_rows_columns() {
        let sql = build_rank_sql("otel_demo", 100, 200, 200, true);
        let expected = r#"SELECT * FROM (
  SELECT *, DENSE_RANK() OVER (PARTITION BY db_system, db_instance ORDER BY fp_total DESC) AS rnk FROM (
    SELECT *, SUM(total_time_ns) OVER (PARTITION BY db_system, db_instance, fingerprint) AS fp_total FROM (
SELECT
    o2_db_fingerprint AS fingerprint,
    max(o2_db_query_norm) AS query_norm,
    o2_db_system AS db_system,
    o2_db_namespace AS db_namespace,
    o2_db_instance AS db_instance,
    o2_db_env AS env,
    service_name,
    max(o2_db_operation) AS operation,
    max(o2_db_stmt_class) AS stmt_class,
    SUM(COALESCE(o2_db_batch_multiplier, 1)) AS statements,
    COUNT(*) AS calls,
    COUNT(*) FILTER (WHERE span_status = 'ERROR') AS errors,
    SUM(end_time - start_time) AS total_time_ns,
    CAST(approx_median(end_time - start_time) AS BIGINT) AS p50_ns,
    CAST(approx_percentile_cont(end_time - start_time, 0.95) AS BIGINT) AS p95_ns,
    CAST(approx_percentile_cont(end_time - start_time, 0.99) AS BIGINT) AS p99_ns,
    MAX(end_time - start_time) AS max_ns,
    COUNT(DISTINCT trace_id) AS traces,
    SUM(CASE WHEN db_response_returned_rows IS NOT NULL THEN db_response_returned_rows ELSE 0 END) AS rows_returned,
    COUNT(db_response_returned_rows) AS rows_emitting_calls
FROM "otel_demo"
WHERE _timestamp >= 100 AND _timestamp < 200
    AND o2_db_fingerprint IS NOT NULL
GROUP BY o2_db_fingerprint, o2_db_system, o2_db_namespace, o2_db_instance, o2_db_env, service_name
    ) AS agg
  ) AS fp_totaled
) AS ranked WHERE rnk <= 200"#;
        assert_eq!(sql, expected);
    }

    // Rows columns are schema-gated: streams without db_response_returned_rows
    // must never reference it (a missing column is a hard error, not NULL).
    #[test]
    fn test_rank_sql_omits_rows_columns_when_absent() {
        let sql = build_rank_sql("s", 1, 2, 50, false);
        assert!(!sql.contains("db_response_returned_rows"));
        assert!(!sql.contains("rows_returned"));
        assert!(sql.contains("COUNT(DISTINCT trace_id) AS traces\nFROM \"s\""));
        assert!(sql.ends_with(") AS ranked WHERE rnk <= 50"));
    }

    // Property assertions (not an exact golden — the rank golden above pins
    // the live-verified shape; here only the load-bearing structure matters):
    // two grains via one UNION ALL, each with the NULL marker for the OTHER
    // grain's discriminator, the shared metric block, time bounds, and the
    // fingerprint filter.
    #[test]
    fn test_totals_sql_shape() {
        let sql = build_totals_sql("s", 1, 2, false);
        assert_eq!(sql.matches("UNION ALL").count(), 1);
        let (ns_arm, class_arm) = sql.split_once("UNION ALL").unwrap();
        // Namespace grain: stmt_class = NULL marker.
        assert!(ns_arm.contains("o2_db_namespace AS db_namespace"));
        assert!(ns_arm.contains("CAST(NULL AS STRING) AS stmt_class"));
        assert!(ns_arm.contains("GROUP BY o2_db_system, o2_db_instance, o2_db_namespace"));
        // Class grain: db_namespace = NULL marker.
        assert!(class_arm.contains("o2_db_stmt_class AS stmt_class"));
        assert!(class_arm.contains("CAST(NULL AS STRING) AS db_namespace"));
        assert!(class_arm.contains("GROUP BY o2_db_system, o2_db_instance, o2_db_stmt_class"));
        for arm in [ns_arm, class_arm] {
            assert!(arm.contains(r#"FROM "s""#));
            assert!(arm.contains("WHERE _timestamp >= 1 AND _timestamp < 2"));
            assert!(arm.contains("AND o2_db_fingerprint IS NOT NULL"));
            for agg in [
                "AS statements",
                "AS calls",
                "AS errors",
                "AS total_time_ns",
                "AS p50_ns",
                "AS p95_ns",
                "AS p99_ns",
                "AS max_ns",
                "AS traces",
            ] {
                assert!(arm.contains(agg), "missing aggregate {agg}");
            }
        }
        // Rows columns are schema-gated off in this call.
        assert!(!sql.contains("rows_returned"));
    }

    // Property assertions (see test_totals_sql_shape rationale): error spans
    // only, per (fingerprint, system, instance, env, code), with the
    // 'unknown' status-code coalesce in both SELECT and GROUP BY.
    #[test]
    fn test_error_class_sql_shape() {
        let sql = build_error_class_sql("s", 1, 2);
        assert!(sql.contains(r#"FROM "s""#));
        assert!(sql.contains("WHERE _timestamp >= 1 AND _timestamp < 2"));
        assert!(sql.contains("AND o2_db_fingerprint IS NOT NULL"));
        assert!(sql.contains("AND span_status = 'ERROR'"));
        assert!(sql.contains("COALESCE(o2_db_status_code, 'unknown') AS status_code"));
        assert!(sql.contains("COUNT(*) AS errors"));
        assert!(sql.contains(
            "GROUP BY o2_db_fingerprint, o2_db_system, o2_db_instance, o2_db_env, COALESCE(o2_db_status_code, 'unknown')"
        ));
    }

    // ── Winning-set extraction ──────────────────────────────────────────────

    // Rank is per (system, instance): the same fingerprint can win on one
    // instance and lose on another, so membership must be keyed by the triple.
    #[test]
    fn test_winning_fingerprints_keyed_per_instance() {
        let rows = vec![
            json!({"db_system": "postgresql", "db_instance": "db1", "fingerprint": "abc"}),
            // second constituent row of the same fingerprint — no duplicate entry
            json!({"db_system": "postgresql", "db_instance": "db1", "fingerprint": "abc"}),
            json!({"db_system": "redis", "db_instance": "c1", "fingerprint": "get"}),
        ];
        let winning = winning_fingerprints(&rows);
        assert_eq!(winning.len(), 2);
        assert!(winning.contains(&("postgresql", "db1", "abc")));
        // Same fingerprint, other instance: NOT winning.
        assert!(!winning.contains(&("postgresql", "db2", "abc")));
    }

    // ── error_class fold ────────────────────────────────────────────────────

    #[test]
    fn test_fold_error_class_keeps_winners_folds_rest() {
        let winning: HashSet<(&str, &str, &str)> = [("postgresql", "db1", "abc")].into();
        let rows = vec![
            // winner: kept verbatim (env preserved)
            json!({"fingerprint": "abc", "db_system": "postgresql", "db_instance": "db1",
                   "env": "prod", "status_code": "23505", "errors": 3}),
            // two losers with the SAME (system, instance, code) but different
            // env/fingerprint: folded into ONE row, errors summed, env dropped
            json!({"fingerprint": "zzz", "db_system": "postgresql", "db_instance": "db1",
                   "env": "prod", "status_code": "40001", "errors": 2}),
            json!({"fingerprint": "yyy", "db_system": "postgresql", "db_instance": "db1",
                   "env": "stage", "status_code": "40001", "errors": 5}),
            // the winning fingerprint on a DIFFERENT instance is a loser there
            json!({"fingerprint": "abc", "db_system": "postgresql", "db_instance": "db2",
                   "env": "prod", "status_code": "57014", "errors": 1}),
        ];
        let out = fold_error_class(rows, &winning);
        assert_eq!(out.len(), 3);
        // Winner row intact.
        assert_eq!(out[0]["fingerprint"], "abc");
        assert_eq!(out[0]["env"], "prod");
        assert_eq!(out[0]["errors"], 3);
        // Folded rows: fingerprint=_other, per (system, instance, code), no env.
        let folded: Vec<&Value> = out
            .iter()
            .filter(|r| r["fingerprint"] == "_other")
            .collect();
        assert_eq!(folded.len(), 2);
        let f40001 = folded.iter().find(|r| r["status_code"] == "40001").unwrap();
        assert_eq!(f40001["errors"], 7);
        assert_eq!(f40001["db_instance"], "db1");
        assert!(f40001.get("env").is_none());
        let f57014 = folded.iter().find(|r| r["status_code"] == "57014").unwrap();
        assert_eq!(f57014["errors"], 1);
        assert_eq!(f57014["db_instance"], "db2");
    }

    // ── "_other" arithmetic ─────────────────────────────────────────────────

    fn stage1_fixture() -> Vec<Value> {
        vec![
            // fingerprint abc, two constituent rows (per service), class query
            json!({"fingerprint": "abc", "db_system": "postgresql", "db_instance": "db1",
                   "stmt_class": "query", "calls": 6, "errors": 1, "total_time_ns": 60,
                   "statements": 7, "traces": 3}),
            json!({"fingerprint": "abc", "db_system": "postgresql", "db_instance": "db1",
                   "stmt_class": "query", "calls": 4, "errors": 0, "total_time_ns": 40,
                   "statements": 5, "traces": 2}),
            // fingerprint def, class update
            json!({"fingerprint": "def", "db_system": "postgresql", "db_instance": "db1",
                   "stmt_class": "update", "calls": 5, "errors": 0, "total_time_ns": 50,
                   "statements": 5, "traces": 2}),
        ]
    }

    fn totals_fixture() -> Vec<Value> {
        vec![
            // namespace-grain instance totals: two namespaces on (postgresql, db1)
            json!({"db_system": "postgresql", "db_instance": "db1", "db_namespace": "ns1",
                   "stmt_class": null, "calls": 20, "errors": 3, "total_time_ns": 200,
                   "statements": 25, "traces": 9}),
            json!({"db_system": "postgresql", "db_instance": "db1", "db_namespace": "ns2",
                   "stmt_class": null, "calls": 5, "errors": 0, "total_time_ns": 30,
                   "statements": 5, "traces": 2}),
            // class totals for the default FR-2 'query' view
            json!({"db_system": "postgresql", "db_instance": "db1", "db_namespace": null,
                   "stmt_class": "query", "calls": 18, "errors": 2, "total_time_ns": 180,
                   "statements": 20, "traces": 8}),
            // a non-query class total: never produces an _other row
            json!({"db_system": "postgresql", "db_instance": "db1", "db_namespace": null,
                   "stmt_class": "update", "calls": 7, "errors": 1, "total_time_ns": 50,
                   "statements": 10, "traces": 3}),
        ]
    }

    #[test]
    fn test_derive_other_instance_grain() {
        let out = derive_other_rows(&stage1_fixture(), &totals_fixture());
        // one instance-grain row + one query-class row
        assert_eq!(out.len(), 2);
        let inst = out
            .iter()
            .find(|r| r.get("stmt_class").is_none())
            .expect("instance-grain _other row");
        assert_eq!(inst["fingerprint"], "_other");
        assert_eq!(inst["db_system"], "postgresql");
        assert_eq!(inst["db_instance"], "db1");
        // totals (25 calls, 230ns, 30 stmts, 3 errors, 11 traces)
        // minus top-N (15 calls, 150ns, 17 stmts, 1 error, 7 traces)
        assert_eq!(inst["calls"], 10);
        assert_eq!(inst["total_time_ns"], 80);
        assert_eq!(inst["statements"], 13);
        assert_eq!(inst["errors"], 2);
        assert_eq!(inst["traces"], 4); // upper bound, not exact (§5.1 merge rule)
        // no latency distribution on _other
        assert!(inst.get("p95_ns").is_none());
        assert!(inst.get("max_ns").is_none());
    }

    #[test]
    fn test_derive_other_query_class_grain() {
        let out = derive_other_rows(&stage1_fixture(), &totals_fixture());
        let class = out
            .iter()
            .find(|r| r.get("stmt_class").is_some())
            .expect("query-class _other row");
        assert_eq!(class["stmt_class"], "query");
        assert_eq!(class["fingerprint"], "_other");
        // query-class totals (18, 180, 20, 2, 8) minus query-classed top-N
        // rows only (10, 100, 12, 1, 5) — the 'update' fingerprint is excluded
        assert_eq!(class["calls"], 8);
        assert_eq!(class["total_time_ns"], 80);
        assert_eq!(class["statements"], 8);
        assert_eq!(class["errors"], 1);
        assert_eq!(class["traces"], 3);
    }

    // Zero remainder (top-N covers everything) emits NO _other row; a negative
    // difference (approx skew) clamps to 0 and is likewise not emitted.
    #[test]
    fn test_derive_other_zero_and_negative_remainders_skipped() {
        let stage1 = vec![json!({"fingerprint": "abc", "db_system": "mysql",
            "db_instance": "m1", "stmt_class": "query", "calls": 10, "errors": 0,
            "total_time_ns": 100, "statements": 10, "traces": 4})];
        // exact totals == top-N sums → no remainder
        let totals = vec![json!({"db_system": "mysql", "db_instance": "m1",
            "db_namespace": "ns", "stmt_class": null, "calls": 10, "errors": 0,
            "total_time_ns": 100, "statements": 10, "traces": 4})];
        assert!(derive_other_rows(&stage1, &totals).is_empty());

        // totals BELOW top-N sums (pathological) → clamped, still nothing
        let totals_low = vec![json!({"db_system": "mysql", "db_instance": "m1",
            "db_namespace": "ns", "stmt_class": null, "calls": 8, "errors": 0,
            "total_time_ns": 90, "statements": 8, "traces": 3})];
        assert!(derive_other_rows(&stage1, &totals_low).is_empty());
    }

    // Rows columns are schema-gated: when absent from the inputs they must be
    // absent from _other too (0 would conflate "not emitted" with "0 rows").
    #[test]
    fn test_derive_other_rows_columns_presence_gated() {
        let out = derive_other_rows(&stage1_fixture(), &totals_fixture());
        for row in &out {
            assert!(row.get("rows_returned").is_none());
            assert!(row.get("rows_emitting_calls").is_none());
        }

        // With the columns present in totals, they flow into _other.
        let stage1 = vec![json!({"fingerprint": "abc", "db_system": "mysql",
            "db_instance": "m1", "calls": 1, "errors": 0, "total_time_ns": 10,
            "statements": 1, "traces": 1, "rows_returned": 5, "rows_emitting_calls": 1})];
        let totals = vec![json!({"db_system": "mysql", "db_instance": "m1",
            "db_namespace": "ns", "stmt_class": null, "calls": 3, "errors": 0,
            "total_time_ns": 30, "statements": 3, "traces": 2,
            "rows_returned": 20, "rows_emitting_calls": 3})];
        let out = derive_other_rows(&stage1, &totals);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["rows_returned"], 15);
        assert_eq!(out[0]["rows_emitting_calls"], 2);
    }

    // ── Record building ─────────────────────────────────────────────────────

    #[test]
    fn test_build_records_stamps_identity_and_strips_rank_artifacts() {
        let stage1 = vec![json!({"fingerprint": "abc", "db_system": "postgresql",
            "db_instance": "db1", "calls": 10, "rnk": 1, "fp_total": 100})];
        let other = vec![json!({"fingerprint": "_other", "db_system": "postgresql",
            "db_instance": "db1", "calls": 2})];
        let totals = vec![json!({"db_system": "postgresql", "db_instance": "db1",
            "db_namespace": "ns1", "calls": 12})];
        let errors = vec![json!({"fingerprint": "abc", "db_system": "postgresql",
            "db_instance": "db1", "status_code": "23505", "errors": 1})];

        let records = build_records(
            stage1,
            other,
            totals,
            errors,
            1_700_000_900_000_000,
            "org1",
            "traces_a",
            false,
        );
        assert_eq!(records.len(), 4);
        for r in &records {
            assert_eq!(r["_timestamp"], 1_700_000_900_000_000_i64); // window END
            assert_eq!(r["org_id"], "org1");
            assert_eq!(r["trace_stream_name"], "traces_a");
            assert_eq!(r["fp_version"], crate::traces::db_monitoring::FP_VERSION);
            assert!(r.get("truncated").is_none()); // only stamped when true
            assert!(r.get("rnk").is_none());
            assert!(r.get("fp_total").is_none());
        }
        // record_type per family; _other rides as query_stats.
        assert_eq!(records[0]["record_type"], "query_stats");
        assert_eq!(records[1]["record_type"], "query_stats");
        assert_eq!(records[1]["fingerprint"], "_other");
        assert_eq!(records[2]["record_type"], "db_totals");
        assert_eq!(records[3]["record_type"], "error_class");
    }

    #[test]
    fn test_build_records_truncated_flag() {
        let records = build_records(
            vec![json!({"fingerprint": "a"})],
            vec![],
            vec![json!({"db_system": "s"})],
            vec![],
            10,
            "o",
            "s",
            true,
        );
        for r in &records {
            assert_eq!(r["truncated"], true);
        }
    }

    #[test]
    fn test_get_i64_tolerates_number_shapes() {
        let row = json!({"i": 5, "f": 7.9, "s": "8", "n": null});
        assert_eq!(get_i64(&row, "i"), 5);
        assert_eq!(get_i64(&row, "f"), 7);
        assert_eq!(get_i64(&row, "s"), 0); // strings are not silently parsed
        assert_eq!(get_i64(&row, "n"), 0);
        assert_eq!(get_i64(&row, "missing"), 0);
    }
}
