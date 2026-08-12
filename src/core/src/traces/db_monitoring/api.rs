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

//! Database Monitoring read API (design: `docs/___databsepages/dbm-design-doc.md`
//! §6 routes + §5.4/D4 hybrid live tail).
//!
//! Four plain-OSS GET handlers (no 403 stub, no `#[cfg]` — DBM is an OSS
//! feature, D2) structurally modeled on the service-graph read API
//! (`../service_graph/api.rs`): fixed SQL over the `_o2_db_stats` summary
//! stream via `crate::search::search`, read as `StreamType::Logs`.
//!
//! The three rollup-backed endpoints (databases / queries / query history)
//! serve a **hybrid**: rolled-up records for the requested window PLUS a live
//! DataFusion pass over the un-rolled-up span tail, merged server-side. All D4
//! guard rails apply:
//!
//! - tail spans `[max(offset, now − 1 rollup interval), now]` — never `now − offset` raw; a stalled
//!   job surfaces as staleness (`data_through`), never as an unbounded raw scan;
//! - the tail runs the SAME bounded two-stage SQL as the rollup ([`super::rollup::build_rank_sql`]
//!   and [`super::rollup::build_totals_sql`]), never the raw unbounded aggregate; a tail query
//!   answering exactly the request cap sets `tail_truncated=true` in the response;
//! - the tail is computed **unfiltered** and cached per `(org, stream, offset)` for `min(30 s,
//!   interval/10)` — the stored rollup offset IS the window-bucket: when the rollup advances, the
//!   key changes and a stale tail can never double-count against the new rollup rows. Scope filters
//!   are applied at merge time from the cached aggregate;
//! - merge math: counts/totals add exactly; `traces` adds as an UPPER BOUND (§5.1 merge rule);
//!   merged percentiles are request(calls)-weighted (the `aggregate_baselines` precedent) and
//!   labeled `percentiles_estimated`;
//! - `ZO_DB_MONITORING_LIVE_TAIL=false` skips the tail entirely — staleness then surfaces through
//!   `data_through` alone.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    sync::{LazyLock, Mutex},
};

use axum::{
    extract::{Path, Query},
    response::Response as HttpResponse,
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::{get_config, meta::stream::StreamType, utils::time::now_micros};
#[cfg(feature = "enterprise")]
use o2_openfga::config::get_config as get_openfga_config;
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    chains,
    rollup::{self, O2_DB_STATS_STREAM, get_i64, get_str},
    server_vantage,
};
use crate::auth::UserEmail;
#[cfg(feature = "enterprise")]
use crate::auth::check_permissions;

/// Default server-vantage logs stream — the name the shipped collector recipes
/// export to (`stream-name: dbm_server`).
const DEFAULT_SERVER_STREAM: &str = "dbm_server";

/// Whether `user_id` may read `stream_name` of `stream_type` in `org_id`.
///
/// WHY THIS EXISTS. Every DBM read runs its SQL with `user_id: None` (org-scoped
/// like the service-graph template it was modelled on), and three endpoints take
/// a caller-supplied `stream` parameter. Without a check here, any org member
/// could read ANY trace or logs stream in the org through DBM — including
/// streams their role denies them everywhere else in the product.
///
/// Delegates to [`crate::auth::check_permissions`], which is the app-wide
/// convention (alerts, dashboards, model pricing, org management all call it):
/// it is dual-implemented, resolves the caller's role from the DB, maps the
/// stream type through `OFGA_MODELS`, and returns `true` for root users.
///
/// On OSS the underlying helper is a stub returning `false`, so this wrapper
/// returns `true` there — DBM is an OSS feature whose documented posture is
/// org-level visibility (FRD NFR-6), and denying every read on a build with no
/// OFGA to consult would break the feature rather than secure it. The gate that
/// matters is the enterprise one, where RBAC is actually configured.
async fn can_read_stream(
    org_id: &str,
    user_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> bool {
    #[cfg(feature = "enterprise")]
    {
        // Same guard every other caller uses: with OFGA off there is no
        // authorization model to consult, so the org-level posture stands.
        if !get_openfga_config().enabled {
            return true;
        }
        return check_permissions(
            &config::utils::str::into_ofga_supported_format(stream_name),
            org_id,
            user_id,
            stream_type.as_str(),
            "GET",
            None,
            false,
            true,
            false,
        )
        .await;
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, user_id, stream_name, stream_type);
        true
    }
}

/// The response for a stream the caller may not read.
///
/// Deliberately identical to the app-wide wording (`"Unauthorized Access"`) and
/// a 403 — the same shape the traces search endpoints return, so a client can
/// treat DBM denials like any other.
fn unauthorized_response() -> HttpResponse {
    MetaHttpResponse::forbidden("Unauthorized Access")
}

/// Default query window when the request carries no time range.
const DEFAULT_WINDOW_MICROS: i64 = 60 * 60 * 1_000_000; // 1 h

/// K — maximum below-top-N windows backfilled from raw spans per history
/// request (design §6: a fingerprint predicate is not a cost bound; beyond the
/// cap the UI renders the distinct "below top-N" band).
pub(crate) const HISTORY_BACKFILL_MAX_WINDOWS: usize = 6;

/// Request size for `_o2_db_stats` reads.
const STATS_READ_SIZE: usize = 100000;

const DEFAULT_QUERIES_LIMIT: usize = 100;
const MAX_QUERIES_LIMIT: usize = 1000;
const DEFAULT_ENDPOINTS_LIMIT: usize = 50;
const MAX_ENDPOINTS_LIMIT: usize = 500;

/// Metrics merged additively across windows/rows. `traces` is deliberately in
/// this list but is an UPPER BOUND, not exact (§5.1 merge rule) — the response
/// labels it through `freshness.traces_upper_bound`.
const MERGE_ADDITIVE: [&str; 7] = [
    "statements",
    "calls",
    "errors",
    "total_time_ns",
    "traces",
    "rows_returned",
    "rows_emitting_calls",
];

const PERCENTILE_COLS: [&str; 3] = ["p50_ns", "p95_ns", "p99_ns"];

// ─── Escaping (injection safety — every user input passes through these) ─────

/// Escape a value for inclusion in a single-quoted SQL string literal.
pub(crate) fn escape_sq(s: &str) -> String {
    s.replace('\'', "''")
}

/// Escape a stream name for inclusion in a double-quoted SQL identifier.
pub(crate) fn escape_ident(s: &str) -> String {
    s.replace('"', "\"\"")
}

// ─── Scope filters ───────────────────────────────────────────────────────────

/// The user-supplied scope. Applied twice, deliberately: escaped SQL predicates
/// on the rollup-stream read (efficiency) AND merge-time row filtering
/// ([`ScopeFilters::matches`]) so the UNFILTERED cached tail rows go through
/// the exact same filter.
#[derive(Debug, Default, Clone)]
pub(crate) struct ScopeFilters {
    pub system: Option<String>,
    pub instance: Option<String>,
    pub namespace: Option<String>,
    pub env: Option<String>,
    pub service: Option<String>,
    /// Trace stream (matched against the `trace_stream_name` record column).
    pub stream: Option<String>,
}

/// Accessor from a [`ScopeFilters`] to one of its optional fields.
type ScopeGetter = fn(&ScopeFilters) -> Option<&String>;

impl ScopeFilters {
    const COLS: [(&'static str, ScopeGetter); 6] = [
        ("db_system", |f| f.system.as_ref()),
        ("db_instance", |f| f.instance.as_ref()),
        ("db_namespace", |f| f.namespace.as_ref()),
        ("env", |f| f.env.as_ref()),
        ("service_name", |f| f.service.as_ref()),
        ("trace_stream_name", |f| f.stream.as_ref()),
    ];

    /// True when the scope is narrower than the `(system, instance [, class])`
    /// grains that `_other` remainders exist at (design §5.2): the view then
    /// shows a "top-N subset" marker instead of an unreconcilable `_other` row.
    pub(crate) fn narrower_than_other_grain(&self) -> bool {
        self.namespace.is_some() || self.env.is_some() || self.service.is_some()
    }

    /// Escaped `AND col = 'value'` predicate fragments for `_o2_db_stats`
    /// reads. Values are single-quote-escaped; column names are a fixed
    /// whitelist — user input can never name a column.
    pub(crate) fn sql_preds(&self) -> String {
        let mut out = String::new();
        for (col, get) in Self::COLS {
            if let Some(v) = get(self) {
                out.push_str("\n    AND ");
                out.push_str(col);
                out.push_str(" = '");
                out.push_str(&escape_sq(v));
                out.push('\'');
            }
        }
        out
    }

    /// Merge-time row filter (rollup rows and cached unfiltered tail rows go
    /// through the same predicate). A set filter fails rows where the column
    /// is absent/null.
    pub(crate) fn matches(&self, row: &Value) -> bool {
        for (col, get) in Self::COLS {
            if let Some(v) = get(self)
                && row.get(col).and_then(|x| x.as_str()) != Some(v.as_str())
            {
                return false;
            }
        }
        true
    }
}

// ─── SQL builders (pure — unit-tested, incl. injection) ──────────────────────

/// Read one record family from `_o2_db_stats`.
///
/// Time semantics: rollup `_timestamp` is the window END, so the read keeps
/// windows ending inside `(start_time, end_time]`.
pub(crate) fn build_stats_sql(
    org_id: &str,
    record_type: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
) -> String {
    format!(
        "SELECT * FROM \"{O2_DB_STATS_STREAM}\"\nWHERE _timestamp > {start_time} AND _timestamp <= {end_time}\n    AND org_id = '{}'\n    AND record_type = '{record_type}'{preds}\nLIMIT {STATS_READ_SIZE}",
        escape_sq(org_id)
    )
}

/// The `query_stats` read for the queries endpoint. The free-text `search`
/// parameter is DELIBERATELY not part of this SQL — it is applied at merge
/// time in Rust (it must filter the cached unfiltered tail anyway), so user
/// search text never reaches the SQL string at all.
pub(crate) fn build_queries_stats_sql(
    org_id: &str,
    start_time: i64,
    end_time: i64,
    filters: &ScopeFilters,
    _search: Option<&str>,
) -> String {
    build_stats_sql(
        org_id,
        "query_stats",
        start_time,
        end_time,
        &filters.sql_preds(),
    )
}

/// Escaped `AND fingerprint = '…'` fragment.
pub(crate) fn fingerprint_pred(fingerprint: &str) -> String {
    format!("\n    AND fingerprint = '{}'", escape_sq(fingerprint))
}

/// History backfill: flat single-fingerprint aggregate over raw spans for ONE
/// window — bounded by the fingerprint + time predicates and by the K-window
/// request cap ([`HISTORY_BACKFILL_MAX_WINDOWS`]).
pub(crate) fn build_backfill_sql(
    stream_name: &str,
    fingerprint: &str,
    start_time: i64,
    end_time: i64,
) -> String {
    format!(
        "SELECT\n    COUNT(*) AS calls,\n    COUNT(*) FILTER (WHERE span_status = 'ERROR') AS errors,\n    SUM(end_time - start_time) AS total_time_ns,\n    CAST(approx_median(end_time - start_time) AS BIGINT) AS p50_ns,\n    CAST(approx_percentile_cont(end_time - start_time, 0.95) AS BIGINT) AS p95_ns,\n    CAST(approx_percentile_cont(end_time - start_time, 0.99) AS BIGINT) AS p99_ns,\n    MAX(end_time - start_time) AS max_ns,\n    COUNT(DISTINCT trace_id) AS traces\nFROM \"{}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    AND o2_db_fingerprint = '{}'",
        escape_ident(stream_name),
        escape_sq(fingerprint)
    )
}

/// Calling-endpoints: on-demand raw-trace aggregation for ONE fingerprint,
/// joining DB spans to their trace ROOT spans — the self-join GROUP BY shape
/// of the service-graph processor's `compute_stream_edges`. Bounded by the
/// fingerprint + time predicates on the DB side and time predicates in the
/// join ON clause on the root side.
pub(crate) fn build_endpoints_sql(
    stream_name: &str,
    fingerprint: &str,
    start_time: i64,
    end_time: i64,
    limit: usize,
) -> String {
    let stream = escape_ident(stream_name);
    format!(
        r#"SELECT
    root.service_name AS service_name,
    root.operation_name AS endpoint,
    COUNT(*) AS calls,
    COUNT(*) FILTER (WHERE dbspan.span_status = 'ERROR') AS errors,
    SUM(dbspan.end_time - dbspan.start_time) AS total_time_ns,
    CAST(approx_percentile_cont(dbspan.end_time - dbspan.start_time, 0.95) AS BIGINT) AS p95_ns,
    COUNT(DISTINCT dbspan.trace_id) AS traces
FROM "{stream}" AS dbspan
LEFT JOIN "{stream}" AS root
    ON dbspan.trace_id = root.trace_id
    AND (root.reference_parent_span_id IS NULL OR root.reference_parent_span_id = '')
    AND root._timestamp >= {start_time} AND root._timestamp < {end_time}
WHERE dbspan._timestamp >= {start_time} AND dbspan._timestamp < {end_time}
    AND dbspan.o2_db_fingerprint = '{}'
GROUP BY root.service_name, root.operation_name
ORDER BY calls DESC
LIMIT {limit}"#,
        escape_sq(fingerprint)
    )
}

// ─── Merge math (pure — unit-tested) ─────────────────────────────────────────

/// Merge stat rows into one aggregate (used across windows, across constituent
/// rows, and across rollup + tail):
///
/// - additive metrics SUM (presence-gated: a metric absent from every input stays absent — 0 would
///   conflate "not emitted" with "0");
/// - `traces` sums as an UPPER BOUND (§5.1 merge rule — never exact);
/// - percentiles are request-weighted: `Σ(pXX·calls) / Σ(calls)` over the rows that carry the
///   column (the `aggregate_baselines` precedent, D4) — approximate, labeled
///   `percentiles_estimated` by the caller;
/// - `max_ns` takes the max.
pub(crate) fn merge_rows<'a>(rows: impl IntoIterator<Item = &'a Value>) -> Value {
    let mut sums: HashMap<&'static str, i64> = HashMap::new();
    let mut present: HashSet<&'static str> = HashSet::new();
    // (weighted sum, weight) per percentile column — i128 so pXX·calls cannot
    // overflow on ns-scale latencies times large call counts.
    let mut p_acc: [(i128, i128); 3] = [(0, 0); 3];
    let mut max_ns: Option<i64> = None;

    for row in rows {
        for metric in MERGE_ADDITIVE {
            if row.get(metric).is_some_and(|v| !v.is_null()) {
                present.insert(metric);
                *sums.entry(metric).or_insert(0) += get_i64(row, metric);
            }
        }
        let calls = get_i64(row, "calls") as i128;
        for (i, col) in PERCENTILE_COLS.iter().enumerate() {
            if row.get(*col).is_some_and(|v| !v.is_null()) && calls > 0 {
                p_acc[i].0 += get_i64(row, col) as i128 * calls;
                p_acc[i].1 += calls;
            }
        }
        if row.get("max_ns").is_some_and(|v| !v.is_null()) {
            max_ns = Some(max_ns.unwrap_or(i64::MIN).max(get_i64(row, "max_ns")));
        }
    }

    let mut out = json!({});
    for metric in MERGE_ADDITIVE {
        if present.contains(metric) {
            out[metric] = json!(sums.get(metric).copied().unwrap_or(0));
        }
    }
    for (i, col) in PERCENTILE_COLS.iter().enumerate() {
        let (wsum, weight) = p_acc[i];
        if weight > 0 {
            out[*col] = json!((wsum / weight) as i64);
        }
    }
    if let Some(m) = max_ns {
        out["max_ns"] = json!(m);
    }
    out
}

/// Stamp the trace-stream provenance of a merged row from its constituents.
///
/// A merged row can fuse rows from several trace streams (an unscoped request
/// where the same fingerprint runs under two trace streams, or rollup + tail).
/// Semantics chosen for the consumer (FR-2 query-detail page, which must issue
/// a RAW span query for slow samples / calling endpoints and therefore needs a
/// concrete stream name):
///
/// - `trace_streams`: ALWAYS present — the sorted distinct set. Empty only when no constituent
///   carried the column (pre-`trace_stream_name` records).
/// - `trace_stream_name`: present ONLY when unambiguous (exactly one distinct stream). Callers can
///   then use it directly; when it is absent the row spans streams and the consumer must either fan
///   out over `trace_streams` or ask the user to scope with the `stream` param. Emitting a single
///   "winner" here would silently point raw-span drill-downs at the wrong stream, which is worse
///   than an explicit absence.
fn stamp_trace_streams<'a>(merged: &mut Value, rows: impl IntoIterator<Item = &'a Value>) {
    let streams: BTreeSet<String> = rows
        .into_iter()
        .map(|r| get_str(r, "trace_stream_name"))
        .filter(|s| !s.is_empty())
        .collect();
    if streams.len() == 1 {
        merged["trace_stream_name"] = json!(streams.iter().next().unwrap());
    }
    merged["trace_streams"] = json!(streams);
}

/// The windows a fingerprint is "below top-N" in: windows that HAVE rollup
/// data (`db_totals` rows exist) but where the fingerprint has no `query_stats`
/// row. Windows with no data at all are NOT in the output — absence of the
/// whole window means "no data", never "below top-N" (design §6: the endpoint
/// MUST distinguish the two).
pub(crate) fn below_top_n_windows(
    windows_with_data: &BTreeSet<i64>,
    fp_windows: &HashSet<i64>,
) -> Vec<i64> {
    windows_with_data
        .iter()
        .filter(|w| !fp_windows.contains(w))
        .copied()
        .collect()
}

/// Split below-top-N windows into (backfill from raw spans, flag-only), capped
/// at [`HISTORY_BACKFILL_MAX_WINDOWS`] backfills per request — most recent
/// windows win the backfill budget.
pub(crate) fn split_backfill_windows(mut below: Vec<i64>, cap: usize) -> (Vec<i64>, Vec<i64>) {
    below.sort_unstable_by(|a, b| b.cmp(a)); // most recent first
    let flag_only = below.split_off(below.len().min(cap));
    (below, flag_only)
}

/// Group `query_stats` rows (rollup + tail, already scope-filtered) per
/// `(fingerprint, db_system, db_instance)` — rank is per (system, instance),
/// so the same fingerprint on two instances stays two rows.
///
/// `class_filter`: `Some(class)` keeps fingerprint rows of that `stmt_class`
/// and `_other` rows at the CLASS grain (design §5.2 — the class totals exist
/// precisely so the default `query` view has its own reconciling remainder);
/// `None` keeps all fingerprint rows and `_other` rows at the INSTANCE grain
/// (`stmt_class` absent).
///
/// `allow_other`: false (scope narrower than the `_other` grains, or free-text
/// search) drops `_other` entirely — the caller sets the `top_n_subset`
/// marker instead.
///
/// Returns `(fingerprint_rows, other_rows)` — `_other` remainders pass through
/// merged but never mix with real fingerprints.
pub(crate) fn group_query_rows(
    rows: &[Value],
    class_filter: Option<&str>,
    allow_other: bool,
) -> (Vec<Value>, Vec<Value>) {
    type Key = (String, String, String); // (fingerprint, system, instance)
    let mut groups: BTreeMap<Key, Vec<&Value>> = BTreeMap::new();

    for row in rows {
        let fp = get_str(row, "fingerprint");
        if fp.is_empty() {
            continue;
        }
        let class = row.get("stmt_class").and_then(|v| v.as_str());
        if fp == "_other" {
            if !allow_other {
                continue;
            }
            // Grain selection: class filter active → class-grain remainder;
            // no class filter → instance-grain remainder.
            let keep = match class_filter {
                Some(cf) => class == Some(cf),
                None => class.is_none(),
            };
            if !keep {
                continue;
            }
        } else if let Some(cf) = class_filter
            && class != Some(cf)
        {
            continue;
        }
        groups
            .entry((fp, get_str(row, "db_system"), get_str(row, "db_instance")))
            .or_default()
            .push(row);
    }

    let mut hits = Vec::new();
    let mut other = Vec::new();
    for ((fp, system, instance), rows) in groups {
        let mut merged = merge_rows(rows.iter().copied());
        merged["fingerprint"] = json!(fp);
        merged["db_system"] = json!(system);
        merged["db_instance"] = json!(instance);
        stamp_trace_streams(&mut merged, rows.iter().copied());
        if fp != "_other" {
            // Representative text/operation/class (longest non-empty text wins
            // — constituents can differ at the 4 KB truncation boundary) plus
            // distinct dimension sets.
            let mut norm = String::new();
            let mut operation = String::new();
            let mut stmt_class = String::new();
            let mut namespaces: BTreeSet<String> = BTreeSet::new();
            let mut envs: BTreeSet<String> = BTreeSet::new();
            let mut services: BTreeSet<String> = BTreeSet::new();
            for row in &rows {
                let n = get_str(row, "query_norm");
                if n.len() > norm.len() {
                    norm = n;
                }
                if operation.is_empty() {
                    operation = get_str(row, "operation");
                }
                if stmt_class.is_empty() {
                    stmt_class = get_str(row, "stmt_class");
                }
                for (set, col) in [
                    (&mut namespaces, "db_namespace"),
                    (&mut envs, "env"),
                    (&mut services, "service_name"),
                ] {
                    let v = get_str(row, col);
                    if !v.is_empty() {
                        set.insert(v);
                    }
                }
            }
            merged["query_norm"] = json!(norm);
            merged["operation"] = json!(operation);
            merged["stmt_class"] = json!(stmt_class);
            merged["namespaces"] = json!(namespaces);
            merged["envs"] = json!(envs);
            merged["services"] = json!(services);
            hits.push(merged);
        } else {
            if let Some(cf) = class_filter {
                merged["stmt_class"] = json!(cf);
            }
            other.push(merged);
        }
    }
    (hits, other)
}

/// Group namespace-grain `db_totals` rows (rollup + tail, already
/// scope-filtered) per `(db_system, db_instance, db_namespace)` — the FR-1
/// overview rows. Percentiles come from the totals rows themselves (never a
/// fusion of per-fingerprint approximations), request-weighted across windows.
pub(crate) fn group_database_rows(rows: &[Value]) -> Vec<Value> {
    type Key = (String, String, String);
    let mut groups: BTreeMap<Key, Vec<&Value>> = BTreeMap::new();
    for row in rows {
        // Namespace-grain discriminator: stmt_class is NULL (class-grain
        // totals rows carry stmt_class and NULL namespace, §5.2).
        if row.get("stmt_class").is_some_and(|v| !v.is_null()) {
            continue;
        }
        groups
            .entry((
                get_str(row, "db_system"),
                get_str(row, "db_instance"),
                get_str(row, "db_namespace"),
            ))
            .or_default()
            .push(row);
    }
    groups
        .into_iter()
        .map(|((system, instance, namespace), rows)| {
            let mut merged = merge_rows(rows.iter().copied());
            merged["db_system"] = json!(system);
            merged["db_instance"] = json!(instance);
            merged["db_namespace"] = json!(namespace);
            stamp_trace_streams(&mut merged, rows.iter().copied());
            merged
        })
        .collect()
}

/// Distinct calling services per `(system, instance, namespace)` from
/// `query_stats`-shaped rows (rollup + tail rank rows).
pub(crate) fn calling_services(
    rows: &[Value],
) -> HashMap<(String, String, String), BTreeSet<String>> {
    let mut out: HashMap<(String, String, String), BTreeSet<String>> = HashMap::new();
    for row in rows {
        let service = get_str(row, "service_name");
        if service.is_empty() || get_str(row, "fingerprint") == "_other" {
            continue;
        }
        out.entry((
            get_str(row, "db_system"),
            get_str(row, "db_instance"),
            get_str(row, "db_namespace"),
        ))
        .or_default()
        .insert(service);
    }
    out
}

/// Whitelisted sort keys for the queries endpoint. Sorting happens in Rust
/// post-merge — user input never reaches an ORDER BY.
const SORT_KEYS: [&str; 9] = [
    "calls",
    "errors",
    "total_time_ns",
    "p50_ns",
    "p95_ns",
    "p99_ns",
    "max_ns",
    "traces",
    "statements",
];

/// Sort merged rows descending by a whitelisted key (default `total_time_ns`).
pub(crate) fn sort_rows(rows: &mut [Value], sort: Option<&str>) {
    let key = sort
        .and_then(|s| SORT_KEYS.iter().find(|k| **k == s))
        .copied()
        .unwrap_or("total_time_ns");
    rows.sort_by_key(|r| std::cmp::Reverse(get_i64(r, key)));
}

/// Case-insensitive substring match over `query_norm` (and exact-prefix over
/// the fingerprint, as a convenience). Applied at merge time — never in SQL.
pub(crate) fn search_matches(row: &Value, search: &str) -> bool {
    let needle = search.to_lowercase();
    get_str(row, "query_norm").to_lowercase().contains(&needle)
        || get_str(row, "fingerprint").starts_with(&needle)
}

// ─── Live-tail cache (D4) ────────────────────────────────────────────────────

/// One computed (unfiltered) live tail for a `(org, trace stream)`.
#[derive(Debug, Default, Clone)]
pub(crate) struct TailData {
    pub tail_start: i64,
    pub tail_end: i64,
    /// Stage-1 rank rows (`query_stats`-shaped, rank artifacts stripped,
    /// `trace_stream_name` stamped). UNFILTERED — scope filters apply at merge.
    pub rank_rows: Vec<Value>,
    /// `db_totals`-shaped rows (namespace grain + class grain).
    pub totals_rows: Vec<Value>,
    /// A tail query answered exactly the request cap (D4 guard rail).
    pub truncated: bool,
    /// The stream has the `o2_db_fingerprint` column (negative results are
    /// cached too so non-DBM streams don't re-probe the schema every request).
    pub relevant: bool,
    /// Tail computation failed — cached so an erroring stream cannot turn every
    /// page load into a retry storm; callers treat it as "no tail".
    pub failed: bool,
}

struct TailCacheEntry {
    computed_at: i64, // µs
    offset: i64,      // the rollup offset the tail was computed against
    data: TailData,
}

/// In-process tail cache. Keyed per `(org, stream)` with the rollup OFFSET as
/// the window-bucket validity check: entries are served only while younger
/// than the TTL AND while the stored offset still matches — when the rollup
/// job advances a stream's offset, the old tail (which starts at the old
/// offset) would double-count against the new rollup rows, so it is treated as
/// a miss immediately. The key deliberately contains NO filter components:
/// the tail is cached unfiltered and every distinct filter combination shares
/// one entry (keying on filters would make every filter a miss and unwind the
/// coalescing entirely — D4).
pub(crate) struct TailCache {
    map: Mutex<HashMap<(String, String), TailCacheEntry>>,
}

impl TailCache {
    pub(crate) fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn get(
        &self,
        org_id: &str,
        stream: &str,
        offset: i64,
        now: i64,
        ttl_micros: i64,
    ) -> Option<TailData> {
        let map = self.map.lock().unwrap();
        let entry = map.get(&(org_id.to_string(), stream.to_string()))?;
        if entry.offset != offset || now - entry.computed_at >= ttl_micros {
            return None;
        }
        Some(entry.data.clone())
    }

    pub(crate) fn put(&self, org_id: &str, stream: &str, offset: i64, now: i64, data: TailData) {
        let mut map = self.map.lock().unwrap();
        map.insert(
            (org_id.to_string(), stream.to_string()),
            TailCacheEntry {
                computed_at: now,
                offset,
                data,
            },
        );
    }
}

static TAIL_CACHE: LazyLock<TailCache> = LazyLock::new(TailCache::new);

/// Tail cache TTL: `min(30 s, interval/10)` (D4), floored at 1 s.
pub(crate) fn tail_ttl_micros(interval_secs: u64) -> i64 {
    let tenth = (interval_secs as i64).saturating_mul(1_000_000) / 10;
    tenth.clamp(1_000_000, 30_000_000)
}

/// Compute (or serve from cache) the live tail for one `(org, trace stream)`.
/// Returns `None` only when the live tail is disabled.
async fn get_or_compute_tail(org_id: &str, stream: &str) -> Option<TailData> {
    let cfg = get_config();
    if !cfg.db_monitoring.live_tail {
        return None;
    }
    let now = now_micros();
    let interval_micros = (cfg.db_monitoring.interval_secs as i64).max(1) * 1_000_000;
    let ttl = tail_ttl_micros(cfg.db_monitoring.interval_secs);
    let (offset, _) = crate::db::db_monitoring::get_offset(org_id, stream).await;

    if let Some(t) = TAIL_CACHE.get(org_id, stream, offset, now, ttl) {
        return Some(t);
    }

    // Tail cap (D4): [max(offset, now − 1 rollup interval), now] — a stalled
    // job's gap beyond the cap surfaces as staleness, never as a raw scan.
    let tail_start = offset.max(now - interval_micros).min(now);

    // Schema gate; negative results are cached like everything else.
    let schema = infra::schema::get(org_id, stream, StreamType::Traces).await;
    let (relevant, has_rows_col) = match &schema {
        Ok(s) => (
            s.field_with_name(super::O2_DB_FINGERPRINT).is_ok(),
            s.field_with_name("db_response_returned_rows").is_ok(),
        ),
        Err(_) => (false, false),
    };
    if !relevant {
        let data = TailData {
            tail_start,
            tail_end: now,
            ..Default::default()
        };
        TAIL_CACHE.put(org_id, stream, offset, now, data.clone());
        return Some(data);
    }

    // The BOUNDED two-stage form (§5.2), reusing the rollup's own builders —
    // never the raw unbounded aggregate.
    let rank_sql = rollup::build_rank_sql(
        stream,
        tail_start,
        now,
        cfg.db_monitoring.top_n,
        has_rows_col,
    );
    let totals_sql = rollup::build_totals_sql(stream, tail_start, now, has_rows_col);

    let mut data = TailData {
        tail_start,
        tail_end: now,
        relevant: true,
        ..Default::default()
    };
    let rank_rows = rollup::run_dbm_search(org_id, rank_sql, tail_start, now).await;
    let totals_rows = rollup::run_dbm_search(org_id, totals_sql, tail_start, now).await;
    match (rank_rows, totals_rows) {
        (Ok(rank), Ok(totals)) => {
            data.truncated =
                rank.len() == rollup::SEARCH_SIZE || totals.len() == rollup::SEARCH_SIZE;
            data.rank_rows = rank
                .into_iter()
                .map(|mut r| {
                    if let Some(obj) = r.as_object_mut() {
                        obj.remove("rnk");
                        obj.remove("fp_total");
                        obj.insert("trace_stream_name".into(), json!(stream));
                    }
                    r
                })
                .collect();
            data.totals_rows = totals
                .into_iter()
                .map(|mut r| {
                    if let Some(obj) = r.as_object_mut() {
                        obj.insert("trace_stream_name".into(), json!(stream));
                    }
                    r
                })
                .collect();
        }
        (rank, totals) => {
            for e in [rank.err(), totals.err()].into_iter().flatten() {
                log::warn!("[DbMonitoring] live tail query failed for {org_id}/{stream}: {e}");
            }
            data.failed = true;
        }
    }
    TAIL_CACHE.put(org_id, stream, offset, now, data.clone());
    Some(data)
}

// ─── Search harnesses ────────────────────────────────────────────────────────

/// Run one read over the `_o2_db_stats` summary stream (read as
/// `StreamType::Logs`, exactly like `_o2_service_graph` — design §5.3).
/// Returns empty when the stream does not exist yet.
async fn run_stats_search(
    org_id: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<Value>, anyhow::Error> {
    // `schema::get` resolves a MISSING stream to `Ok(<empty schema>)` rather than
    // `Err` (`get_cache` returns an empty `SchemaCache` when the DB has no row),
    // so an `is_err()` test never fires and the read falls through to a search
    // that dies with "Search stream not found". Before the first rollup tick
    // that turned every DBM screen into a 500 on a brand-new deployment — the
    // exact moment the self-diagnosing empty state is supposed to explain
    // itself. `exists` is the predicate that actually distinguishes the two.
    if !infra::schema::exists(org_id, StreamType::Logs, O2_DB_STATS_STREAM).await {
        return Ok(Vec::new());
    }
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: 0,
            size: STATS_READ_SIZE as i64,
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
    // `user_id: None` is deliberate HERE: stream scoping happens up-front in
    // `involved_streams`, which filters to what the caller may read and drives
    // both the rollup rows and the tail. Passing a user here as well would
    // double-authorize the same request.
    let trace_id = config::ider::generate();
    let resp = crate::search::search(&trace_id, org_id, StreamType::Logs, None, &req).await?;
    Ok(resp.hits)
}

// ─── Shared handler plumbing ─────────────────────────────────────────────────

/// Resolve `(start_time, end_time)`, defaulting to the last hour.
fn resolve_range(start: Option<i64>, end: Option<i64>) -> (i64, i64) {
    match (start, end) {
        (Some(s), Some(e)) => (s, e),
        _ => {
            let now = now_micros();
            (now - DEFAULT_WINDOW_MICROS, now)
        }
    }
}

/// The trace streams a request involves: the explicit `stream` param, else the
/// distinct `trace_stream_name`s in the rollup rows, else (cold start — no
/// rollup rows yet) every trace stream of the org from the schema cache (each
/// tail then schema-gates itself, with negatives cached).
///
/// The result is filtered to what `user_id` may READ. This is the one chokepoint
/// the three rollup-backed endpoints (databases / queries / history) resolve
/// their tail streams through, so filtering here scopes all of them at once —
/// including the cold-start branch, which would otherwise hand back every trace
/// stream in the org regardless of the caller's role.
///
/// Filtering (rather than rejecting) is deliberate for the non-param branches:
/// those are a fan-out over whatever streams happen to hold data, so a stream
/// the caller cannot read is not an error, it is simply not theirs to see. The
/// explicit `stream` param is different — an unreadable one is an explicit ask
/// that must fail loudly, so it returns `None` for the caller to 403 on.
async fn involved_streams(
    org_id: &str,
    user_id: &str,
    stream_param: Option<&String>,
    rollup_rows: &[&[Value]],
) -> Option<Vec<String>> {
    if let Some(s) = stream_param {
        return if can_read_stream(org_id, user_id, s, StreamType::Traces).await {
            Some(vec![s.clone()])
        } else {
            None
        };
    }
    let mut set: BTreeSet<String> = BTreeSet::new();
    for rows in rollup_rows {
        for row in *rows {
            let s = get_str(row, "trace_stream_name");
            if !s.is_empty() {
                set.insert(s);
            }
        }
    }
    if set.is_empty() {
        let mut grouped = crate::db::schema::list_all_streams_grouped().await;
        if let Some(streams) = grouped
            .get_mut(org_id)
            .and_then(|types| types.remove(&StreamType::Traces))
        {
            set.extend(streams);
        }
    }

    let mut readable = Vec::with_capacity(set.len());
    for stream in set {
        if can_read_stream(org_id, user_id, &stream, StreamType::Traces).await {
            readable.push(stream);
        }
    }
    Some(readable)
}

/// Freshness block carried by every rollup-backed response (D4).
struct Freshness {
    /// Minimum rollup offset across the involved streams (µs). 0 = a stream
    /// has never been rolled up. This is the staleness signal when the live
    /// tail is off or failed.
    data_through: i64,
    live_tail: bool,
    /// Where the live tail begins (µs). When this is LATER than
    /// `data_through`, the rollup job has stalled beyond the one-interval tail
    /// cap and the gap `(data_through, tail_covers_from)` is NOT covered by
    /// either source — the UI's staleness banner condition (D4/NFR-5).
    tail_covers_from: Option<i64>,
    tail_through: Option<i64>,
    tail_truncated: bool,
    percentiles_estimated: bool,
}

impl Freshness {
    fn to_json(&self) -> Value {
        json!({
            "data_through": self.data_through,
            "live_tail": self.live_tail,
            "tail_covers_from": self.tail_covers_from,
            "tail_through": self.tail_through,
            "tail_truncated": self.tail_truncated,
            // Merged percentiles are request-weighted (can be inaccurate when
            // latency shifts within the range) and `traces` is an upper bound.
            "percentiles_estimated": self.percentiles_estimated,
            "traces_upper_bound": true,
        })
    }
}

/// Tails + freshness bookkeeping for the involved streams.
struct CollectedTails {
    tails: Vec<TailData>,
    data_through: i64,
    tail_covers_from: Option<i64>,
    tail_through: Option<i64>,
    tail_truncated: bool,
}

/// Does a tail covering `[tail_start, tail_end)` intersect the requested
/// `[start_time, end_time)`? Both intervals are half-open, so a tail that
/// merely abuts the window (starts exactly at `end_time`, or ends exactly at
/// `start_time`) contributes nothing and is excluded.
pub(crate) fn tail_overlaps(
    tail_start: i64,
    tail_end: i64,
    start_time: i64,
    end_time: i64,
) -> bool {
    tail_start < end_time && tail_end > start_time
}

/// Collect the live tails that are RELEVANT TO THE REQUESTED RANGE.
///
/// `start_time`/`end_time` are the caller's window. The tail is always computed
/// against the clock — `[max(offset, now − interval), now]` — so it describes
/// the present, not the request. Merging it unconditionally made every read
/// return "now" regardless of the window asked for: a request for
/// `[now−30m, now−15m]` came back byte-identical to `[now−15m, now]`, which
/// silently zeroed every window-over-window delta the UI computes (the Δ column
/// and every comparison insight) and, worse, answered a question about the past
/// with data from the present. A tail that does not overlap the requested range
/// is simply not part of the answer.
async fn collect_tails(
    org_id: &str,
    streams: &[String],
    start_time: i64,
    end_time: i64,
) -> CollectedTails {
    let cfg = get_config();
    let mut data_through = i64::MAX;
    for stream in streams {
        let (offset, _) = crate::db::db_monitoring::get_offset(org_id, stream).await;
        data_through = data_through.min(offset);
    }
    if streams.is_empty() {
        data_through = 0;
    }

    let mut tails = Vec::new();
    let mut tail_covers_from: Option<i64> = None;
    let mut tail_through: Option<i64> = None;
    let mut truncated = false;
    if cfg.db_monitoring.live_tail {
        for stream in streams {
            if let Some(t) = get_or_compute_tail(org_id, stream).await {
                if t.failed || !t.relevant {
                    continue;
                }
                // Half-open overlap test against the caller's window.
                if !tail_overlaps(t.tail_start, t.tail_end, start_time, end_time) {
                    continue;
                }
                // Latest tail start across streams: any stream whose tail
                // begins after its offset has a stall gap (D4 staleness).
                tail_covers_from = Some(tail_covers_from.unwrap_or(i64::MIN).max(t.tail_start));
                tail_through = Some(tail_through.unwrap_or(0).max(t.tail_end));
                truncated |= t.truncated;
                tails.push(t);
            }
        }
    }
    CollectedTails {
        tails,
        data_through,
        tail_covers_from,
        tail_through,
        tail_truncated: truncated,
    }
}

fn disabled_response() -> HttpResponse {
    MetaHttpResponse::not_found("Database Monitoring is disabled (ZO_DB_MONITORING_ENABLED=false)")
}

// ─── Handlers ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct DatabasesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub service: Option<String>,
}

/// GET /{org_id}/traces/db_monitoring/databases — FR-1 overview.
///
/// `db_totals` rows grouped per (system, instance, namespace) — exact window
/// totals with true percentiles, never fingerprint-fused — plus the distinct
/// calling services from `query_stats` rows. Rollup + live tail (D4). With a
/// `service` filter the totals grain does not exist, so rows aggregate from
/// service-filtered `query_stats` instead and `top_n_subset` is set.
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/databases",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringDatabases",
    summary = "Database Monitoring: databases overview",
    description = "Per-(system, instance, namespace) rollup totals with calling services, merged with a bounded live tail over the un-rolled-up spans.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Trace stream filter"),
        ("system" = Option<String>, Query, description = "Database system filter"),
        ("service" = Option<String>, Query, description = "Calling service filter"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_databases(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<DatabasesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }
    let filters = ScopeFilters {
        system: q.system.clone(),
        service: q.service.clone(),
        stream: q.stream.clone(),
        ..Default::default()
    };
    // Totals rows carry no service dimension — only system/stream predicates
    // apply to them; the service scope acts through query_stats.
    let totals_filters = ScopeFilters {
        system: q.system.clone(),
        stream: q.stream.clone(),
        ..Default::default()
    };

    let totals_sql = build_stats_sql(
        &org_id,
        "db_totals",
        start_time,
        end_time,
        &totals_filters.sql_preds(),
    );
    let qs_sql = build_stats_sql(
        &org_id,
        "query_stats",
        start_time,
        end_time,
        &filters.sql_preds(),
    );
    let (totals_rows, qs_rows) = match (
        run_stats_search(&org_id, totals_sql, start_time, end_time).await,
        run_stats_search(&org_id, qs_sql, start_time, end_time).await,
    ) {
        (Ok(t), Ok(q)) => (t, q),
        (t, q) => {
            let e = t.err().or(q.err()).unwrap();
            log::error!("[DbMonitoring] databases rollup read failed for {org_id}: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    let Some(streams) = involved_streams(
        &org_id,
        &user_email.user_id,
        q.stream.as_ref(),
        &[&totals_rows[..], &qs_rows[..]],
    )
    .await
    else {
        return unauthorized_response();
    };
    let collected = collect_tails(&org_id, &streams, start_time, end_time).await;
    let tails = &collected.tails;

    // Pool rollup + tail rows, uniformly re-filtered in Rust (the tail is
    // cached unfiltered; rollup rows pass unchanged).
    let mut totals_pool: Vec<Value> = totals_rows
        .into_iter()
        .filter(|r| totals_filters.matches(r))
        .collect();
    let mut qs_pool: Vec<Value> = qs_rows.into_iter().filter(|r| filters.matches(r)).collect();
    for tail in tails {
        totals_pool.extend(
            tail.totals_rows
                .iter()
                .filter(|r| totals_filters.matches(r))
                .cloned(),
        );
        qs_pool.extend(
            tail.rank_rows
                .iter()
                .filter(|r| filters.matches(r))
                .cloned(),
        );
    }

    let top_n_subset = q.service.is_some();
    let mut hits = if top_n_subset {
        // Service-scoped: totals at this grain do not exist — aggregate the
        // service-filtered top-N constituent rows and say so (§5.2).
        let mut groups: BTreeMap<(String, String, String), Vec<&Value>> = BTreeMap::new();
        for row in qs_pool
            .iter()
            .filter(|r| get_str(r, "fingerprint") != "_other")
        {
            groups
                .entry((
                    get_str(row, "db_system"),
                    get_str(row, "db_instance"),
                    get_str(row, "db_namespace"),
                ))
                .or_default()
                .push(row);
        }
        groups
            .into_iter()
            .map(|((system, instance, namespace), rows)| {
                let mut merged = merge_rows(rows.iter().copied());
                merged["db_system"] = json!(system);
                merged["db_instance"] = json!(instance);
                merged["db_namespace"] = json!(namespace);
                stamp_trace_streams(&mut merged, rows.iter().copied());
                merged
            })
            .collect()
    } else {
        group_database_rows(&totals_pool)
    };

    let services = calling_services(&qs_pool);
    for row in &mut hits {
        let key = (
            get_str(row, "db_system"),
            get_str(row, "db_instance"),
            get_str(row, "db_namespace"),
        );
        row["calling_services"] = json!(services.get(&key).cloned().unwrap_or_default());
    }
    sort_rows(&mut hits, None);

    // Estimated whenever any group fused more than one source row (multiple
    // windows, or rollup + tail).
    let percentiles_estimated =
        !tails.iter().all(|t| t.totals_rows.is_empty()) || totals_pool.len() > hits.len();
    let freshness = Freshness {
        data_through: collected.data_through,
        live_tail: cfg.db_monitoring.live_tail,
        tail_covers_from: collected.tail_covers_from,
        tail_through: collected.tail_through,
        tail_truncated: collected.tail_truncated,
        percentiles_estimated,
    };

    MetaHttpResponse::json(json!({
        "hits": hits,
        "top_n_subset": top_n_subset,
        "freshness": freshness.to_json(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct QueriesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    pub namespace: Option<String>,
    pub env: Option<String>,
    pub service: Option<String>,
    /// Statement class filter — defaults to `query` (FR-2: COMMIT/SET/ping
    /// noise must not dominate calls-sorted views); `all` disables.
    pub stmt_class: Option<String>,
    pub sort: Option<String>,
    pub limit: Option<usize>,
    /// Free-text search over the normalized query text. Applied at merge time
    /// in Rust — never interpolated into SQL.
    pub search: Option<String>,
}

/// GET /{org_id}/traces/db_monitoring/queries — FR-2 top queries.
///
/// `query_stats` rows merged per (fingerprint, system, instance) across
/// windows and constituent rows, `_other` remainders passed through at their
/// own grains, rollup + live tail (D4).
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/queries",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueries",
    summary = "Database Monitoring: top queries",
    description = "Top query fingerprints with merged stats and _other remainder, merged with a bounded live tail over the un-rolled-up spans.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Trace stream filter"),
        ("system" = Option<String>, Query, description = "Database system filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("namespace" = Option<String>, Query, description = "Database namespace filter"),
        ("env" = Option<String>, Query, description = "Environment filter"),
        ("service" = Option<String>, Query, description = "Calling service filter"),
        ("stmt_class" = Option<String>, Query, description = "Statement class filter (default 'query'; 'all' disables)"),
        ("sort" = Option<String>, Query, description = "Sort key (whitelist; default total_time_ns)"),
        ("limit" = Option<usize>, Query, description = "Max rows (default 100)"),
        ("search" = Option<String>, Query, description = "Free-text search over normalized query text"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_queries(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<QueriesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }
    let filters = ScopeFilters {
        system: q.system.clone(),
        instance: q.instance.clone(),
        namespace: q.namespace.clone(),
        env: q.env.clone(),
        service: q.service.clone(),
        stream: q.stream.clone(),
    };
    let search = q.search.as_deref().filter(|s| !s.trim().is_empty());
    let class_filter = match q.stmt_class.as_deref() {
        Some("all") | Some("") => None,
        Some(c) => Some(c.to_string()),
        None => Some("query".to_string()),
    };
    // `_other` reconciles only at the (system, instance [, class]) grains
    // (§5.2): narrower scopes and free-text search show `top_n_subset` instead.
    let allow_other = !filters.narrower_than_other_grain() && search.is_none();

    let qs_sql = build_queries_stats_sql(&org_id, start_time, end_time, &filters, search);
    let qs_rows = match run_stats_search(&org_id, qs_sql, start_time, end_time).await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[DbMonitoring] queries rollup read failed for {org_id}: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    let Some(streams) = involved_streams(
        &org_id,
        &user_email.user_id,
        q.stream.as_ref(),
        &[&qs_rows[..]],
    )
    .await
    else {
        return unauthorized_response();
    };
    let collected = collect_tails(&org_id, &streams, start_time, end_time).await;
    let tails = &collected.tails;

    let mut pool: Vec<Value> = qs_rows.into_iter().filter(|r| filters.matches(r)).collect();
    let mut tail_used = false;
    for tail in tails {
        // The tail's own `_other` remainder derives from its rank + totals
        // rows with the SAME arithmetic as the rollup writer.
        let tail_other = rollup::derive_other_rows(&tail.rank_rows, &tail.totals_rows);
        let before = pool.len();
        pool.extend(
            tail.rank_rows
                .iter()
                .filter(|r| filters.matches(r))
                .cloned(),
        );
        pool.extend(tail_other.into_iter().filter(|r| filters.matches(r)));
        tail_used |= pool.len() > before;
    }
    if let Some(s) = search {
        pool.retain(|r| get_str(r, "fingerprint") == "_other" || search_matches(r, s));
    }

    let (mut hits, other) = group_query_rows(&pool, class_filter.as_deref(), allow_other);
    let percentiles_estimated = tail_used || pool.len() > hits.len() + other.len();
    sort_rows(&mut hits, q.sort.as_deref());
    let total = hits.len();
    let limit = q
        .limit
        .unwrap_or(DEFAULT_QUERIES_LIMIT)
        .min(MAX_QUERIES_LIMIT);
    hits.truncate(limit);

    let freshness = Freshness {
        data_through: collected.data_through,
        live_tail: cfg.db_monitoring.live_tail,
        tail_covers_from: collected.tail_covers_from,
        tail_through: collected.tail_through,
        tail_truncated: collected.tail_truncated,
        percentiles_estimated,
    };
    MetaHttpResponse::json(json!({
        "hits": hits,
        "other": other,
        "total": total,
        "top_n_subset": !allow_other,
        "freshness": freshness.to_json(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub fingerprint: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    pub namespace: Option<String>,
    pub env: Option<String>,
    pub service: Option<String>,
}

/// GET /{org_id}/traces/db_monitoring/query/history — FR-5 per-fingerprint
/// series.
///
/// Distinguishes "below top-N" from zero: a window whose `db_totals` rows
/// exist but whose fingerprint row is absent means "ranked below top-N", never
/// "0 calls". Up to [`HISTORY_BACKFILL_MAX_WINDOWS`] such windows are
/// backfilled from raw spans (fingerprint + time bounded); the rest carry
/// `below_top_n: true` without metrics. The live tail renders as the `live`
/// point (D4).
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/query/history",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueryHistory",
    summary = "Database Monitoring: per-query time series",
    description = "Per-window series for one query fingerprint, distinguishing below-top-N windows from zero, with bounded raw-span backfill and a live-tail point.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fingerprint" = String, Query, description = "Query fingerprint (required)"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Trace stream filter"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Missing fingerprint", content_type = "application/json", body = ()),
    )
)]
pub async fn get_dbm_query_history(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<HistoryQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let Some(fingerprint) = q.fingerprint.as_deref().filter(|f| !f.is_empty()) else {
        return MetaHttpResponse::bad_request("fingerprint is required");
    };
    // An explicit `stream` is checked HERE, before any read runs.
    //
    // It is caller-supplied and it is what the backfill loop below aggregates
    // over — up to `HISTORY_BACKFILL_MAX_WINDOWS` raw-span queries through
    // `rollup::run_dbm_search` with `user_id: None`. The `involved_streams` gate
    // further down catches the same param, but only AFTER that loop has already
    // executed: the 403 discards the aggregates, so nothing leaks, but the work
    // ran on another team's stream and its duration is observable. Same reasoning
    // and same placement as `get_dbm_query_endpoints` — before range parsing too,
    // so existence cannot be probed through error-message differences.
    //
    // The no-param branches stay with `involved_streams`, which FILTERS rather
    // than rejects (a fan-out over whatever streams hold data is not an explicit
    // ask); this early return is only for the explicit one.
    if let Some(stream) = q.stream.as_deref().filter(|s| !s.is_empty())
        && !can_read_stream(&org_id, &user_email.user_id, stream, StreamType::Traces).await
    {
        return unauthorized_response();
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }
    let filters = ScopeFilters {
        system: q.system.clone(),
        instance: q.instance.clone(),
        namespace: q.namespace.clone(),
        env: q.env.clone(),
        service: q.service.clone(),
        stream: q.stream.clone(),
    };
    // Window existence is judged at the grains db_totals rows exist at —
    // namespace/env/service scopes don't apply to them.
    let totals_filters = ScopeFilters {
        system: q.system.clone(),
        instance: q.instance.clone(),
        stream: q.stream.clone(),
        ..Default::default()
    };

    let fp_sql = build_stats_sql(
        &org_id,
        "query_stats",
        start_time,
        end_time,
        &format!("{}{}", filters.sql_preds(), fingerprint_pred(fingerprint)),
    );
    let totals_sql = build_stats_sql(
        &org_id,
        "db_totals",
        start_time,
        end_time,
        &totals_filters.sql_preds(),
    );
    let (fp_rows, totals_rows) = match (
        run_stats_search(&org_id, fp_sql, start_time, end_time).await,
        run_stats_search(&org_id, totals_sql, start_time, end_time).await,
    ) {
        (Ok(f), Ok(t)) => (f, t),
        (f, t) => {
            let e = f.err().or(t.err()).unwrap();
            log::error!("[DbMonitoring] history rollup read failed for {org_id}: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    // Per-window fingerprint points (constituent rows merged per window).
    let mut fp_by_window: BTreeMap<i64, Vec<&Value>> = BTreeMap::new();
    for row in fp_rows.iter().filter(|r| filters.matches(r)) {
        fp_by_window
            .entry(get_i64(row, "_timestamp"))
            .or_default()
            .push(row);
    }
    let windows_with_data: BTreeSet<i64> = totals_rows
        .iter()
        .filter(|r| totals_filters.matches(r))
        .map(|r| get_i64(r, "_timestamp"))
        .collect();
    let fp_windows: HashSet<i64> = fp_by_window.keys().copied().collect();
    let below = below_top_n_windows(&windows_with_data, &fp_windows);
    let (to_backfill, flag_only) = split_backfill_windows(below, HISTORY_BACKFILL_MAX_WINDOWS);

    // Backfill needs ONE raw trace stream: the explicit param, else the unique
    // trace_stream_name of the window rows. Ambiguous multi-stream scopes skip
    // backfill (flag-only) rather than guess.
    let backfill_stream: Option<String> = q.stream.clone().or_else(|| {
        let names: BTreeSet<String> = totals_rows
            .iter()
            .map(|r| get_str(r, "trace_stream_name"))
            .filter(|s| !s.is_empty())
            .collect();
        (names.len() == 1).then(|| names.into_iter().next().unwrap())
    });

    let interval_micros = (cfg.db_monitoring.interval_secs as i64).max(1) * 1_000_000;
    let mut series: Vec<Value> = Vec::new();
    for (window_end, rows) in &fp_by_window {
        let mut point = merge_rows(rows.iter().copied());
        point["timestamp"] = json!(window_end);
        series.push(point);
    }
    for window_end in &to_backfill {
        let mut point = json!({ "timestamp": window_end, "below_top_n": true });
        if let Some(stream) = &backfill_stream {
            let sql = build_backfill_sql(
                stream,
                fingerprint,
                window_end - interval_micros,
                *window_end,
            );
            match rollup::run_dbm_search(&org_id, sql, window_end - interval_micros, *window_end)
                .await
            {
                Ok(rows) if !rows.is_empty() && get_i64(&rows[0], "calls") > 0 => {
                    let mut merged = rows[0].clone();
                    if let Some(obj) = merged.as_object_mut() {
                        obj.insert("timestamp".into(), json!(window_end));
                        obj.insert("below_top_n".into(), json!(true));
                        obj.insert("backfilled".into(), json!(true));
                    }
                    point = merged;
                }
                Ok(_) => {
                    // Genuinely zero calls in this window for this fingerprint.
                    point["backfilled"] = json!(true);
                    point["calls"] = json!(0);
                }
                Err(e) => {
                    log::warn!("[DbMonitoring] history backfill failed for {org_id}: {e}");
                }
            }
        }
        series.push(point);
    }
    for window_end in &flag_only {
        series.push(json!({ "timestamp": window_end, "below_top_n": true }));
    }
    series.sort_by_key(|p| get_i64(p, "timestamp"));

    // Live-tail point (D4 — the series' live segment, never flat/zero).
    let Some(streams) = involved_streams(
        &org_id,
        &user_email.user_id,
        q.stream.as_ref(),
        &[&totals_rows[..]],
    )
    .await
    else {
        return unauthorized_response();
    };
    let collected = collect_tails(&org_id, &streams, start_time, end_time).await;
    let tail_rows: Vec<Value> = collected
        .tails
        .iter()
        .flat_map(|t| t.rank_rows.iter())
        .filter(|r| get_str(r, "fingerprint") == fingerprint && filters.matches(r))
        .cloned()
        .collect();
    if !tail_rows.is_empty() {
        let mut point = merge_rows(tail_rows.iter());
        point["timestamp"] = json!(collected.tail_through.unwrap_or_else(now_micros));
        point["live"] = json!(true);
        series.push(point);
    }

    let freshness = Freshness {
        data_through: collected.data_through,
        live_tail: cfg.db_monitoring.live_tail,
        tail_covers_from: collected.tail_covers_from,
        tail_through: collected.tail_through,
        tail_truncated: collected.tail_truncated,
        percentiles_estimated: true,
    };
    MetaHttpResponse::json(json!({
        "fingerprint": fingerprint,
        "series": series,
        // The raw trace stream this fingerprint resolves to (same resolution as
        // the backfill: explicit param, else the unique stream of the window
        // rows; null when ambiguous). The query-detail page reuses it for its
        // raw-span panels instead of guessing a default stream.
        "trace_stream_name": backfill_stream,
        "backfill_capped": !flag_only.is_empty(),
        "freshness": freshness.to_json(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct EndpointsQuery {
    pub fingerprint: Option<String>,
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub limit: Option<usize>,
}

/// GET /{org_id}/traces/db_monitoring/query/endpoints — FR-5 calling
/// endpoints: on-demand raw-trace aggregation for ONE fingerprint joining DB
/// spans to their trace roots. Bounded by the fingerprint + time predicates —
/// no rollup, no tail.
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/query/endpoints",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueryEndpoints",
    summary = "Database Monitoring: calling endpoints for a query",
    description = "Aggregates raw DB spans for one fingerprint joined to their trace root spans, grouped per calling service + endpoint.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fingerprint" = String, Query, description = "Query fingerprint (required)"),
        ("stream" = String, Query, description = "Trace stream name (required)"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("limit" = Option<usize>, Query, description = "Max rows (default 50)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Missing fingerprint/stream", content_type = "application/json", body = ()),
    )
)]
pub async fn get_dbm_query_endpoints(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<EndpointsQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let Some(fingerprint) = q.fingerprint.as_deref().filter(|f| !f.is_empty()) else {
        return MetaHttpResponse::bad_request("fingerprint is required");
    };
    let Some(stream) = q.stream.as_deref().filter(|s| !s.is_empty()) else {
        return MetaHttpResponse::bad_request("stream is required");
    };
    // `stream` is caller-supplied and feeds a raw-trace aggregation, so it is
    // checked BEFORE the range/limit parsing below — a caller must not be able
    // to probe stream existence through error-message differences.
    if !can_read_stream(&org_id, &user_email.user_id, stream, StreamType::Traces).await {
        return unauthorized_response();
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_ENDPOINTS_LIMIT)
        .clamp(1, MAX_ENDPOINTS_LIMIT);

    let sql = build_endpoints_sql(stream, fingerprint, start_time, end_time, limit);
    match rollup::run_dbm_search(&org_id, sql, start_time, end_time).await {
        Ok(hits) => MetaHttpResponse::json(json!({ "hits": hits })),
        Err(e) => {
            log::error!("[DbMonitoring] endpoints query failed for {org_id}/{stream}: {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

// ─── Server-vantage endpoints (deadlocks / blocking) ─────────────────────────
//
// These read the CANONICAL `o2_dbm_*` columns written at ingest by
// `super::server_vantage` — never a raw receiver field. That is the D1 contract:
// receiver vocabularies are Development-stability and shift with collector
// releases; absorbing the drift once at ingest keeps these queries and the whole
// UI stable across upgrades.

/// Default result cap for the server-vantage endpoints.
const DEFAULT_EVENTS_LIMIT: usize = 100;
const MAX_EVENTS_LIMIT: usize = 1000;

/// Scope predicates shared by both server-vantage endpoints. Column names are a
/// fixed whitelist; values are single-quote-escaped — user input can never name
/// a column (same contract as [`ScopeFilters::sql_preds`]).
fn dbm_event_preds(system: Option<&str>, instance: Option<&str>, database: Option<&str>) -> String {
    let mut out = String::new();
    for (col, val) in [
        (server_vantage::O2_DBM_ENGINE, system),
        (server_vantage::O2_DBM_INSTANCE, instance),
        (server_vantage::O2_DBM_DATABASE, database),
    ] {
        if let Some(v) = val.filter(|s| !s.is_empty()) {
            out.push_str("\n    AND ");
            out.push_str(col);
            out.push_str(" = '");
            out.push_str(&escape_sq(v));
            out.push('\'');
        }
    }
    out
}

/// Which canonical DBM columns this stream actually has.
///
/// `ALL_DBM_FIELDS` is what the ingest side may WRITE, not what any given
/// stream contains: a deployment running only the filelog recipes never emits
/// the blocking-only columns, so they are absent from its schema. Naming an
/// absent column in a projection fails the whole query with a schema error
/// (not a null column), so the projection is intersected with this.
///
/// An unreadable schema is an ERROR, never an empty set.
///
/// This returned `.unwrap_or_default()` and that was a false-verdict generator:
/// an `Err` from `infra::schema::get` (a DB/etcd blip) became the same empty
/// `HashSet` as "this stream genuinely has no DBM columns", and both callers then
/// stated a confident, wrong conclusion from it.
///
///  - Blocking degrades to the `_timestamp`-only projection while the `o2_dbm_kind = 'blocking'`
///    filter still matches rows, so `BlockingSample::from_record` — which requires both pids —
///    drops EVERY row, `hits` is empty, the probe runs and the page reports `not_collecting: true`.
///    That is the operator being told their collector is broken because a schema read blipped, i.e.
///    exactly the false alarm the design note above [`LIVENESS_PROBE_MICROS`] says must never be
///    raised.
///  - Deadlocks has no such guard, so it emits N events with `engine: None`, zero participants and
///    no victim. `hits` is non-empty, so the probe is SKIPPED and the tab renders content-free rows
///    with no diagnostic at all.
///
/// A stream that does not exist is not this case — `infra::schema::get` answers
/// `Ok` with an empty schema for it (`schema/mod.rs:167`), which is the honest
/// empty set and still yields the degraded projection. So propagating the `Err`
/// costs the not-yet-shipped-recipe deployment nothing and buys "we could not
/// read the schema" (a 500) in place of an invented verdict.
async fn present_dbm_columns(
    org_id: &str,
    stream_name: &str,
) -> Result<HashSet<String>, anyhow::Error> {
    let schema = infra::schema::get(org_id, stream_name, StreamType::Logs).await?;
    Ok(server_vantage::ALL_DBM_FIELDS
        .into_iter()
        .filter(|f| schema.field_with_name(f).is_ok())
        .map(str::to_string)
        .collect())
}

// ─── W2.3 · Activity read API ────────────────────────────────────────────────

/// Distinct poll timestamps for one record kind, newest first.
///
/// The sampling interval is inferred from the SPACING OF POLLS, so what it needs
/// is distinct timestamps — not rows. The shared liveness probe cannot supply
/// them at activity's volume: it scans `PROBE_SCAN_LIMIT` (2000) rows of ANY
/// kind, and activity writes one row PER SESSION PER POLL, so on a busy instance
/// those 2000 rows span only one or two polls and
/// `CollectionProbe::sample_interval_seconds` (which needs three) returns null —
/// nulling the sampling disclosure precisely on the largest deployments.
///
/// `SELECT DISTINCT` moves the deduplication to the engine, so the cap counts
/// POLLS rather than sessions and the inference is independent of how many
/// sessions each poll observed.
pub(crate) fn build_dbm_sample_times_sql(
    stream_name: &str,
    kind: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
) -> String {
    format!(
        "SELECT DISTINCT _timestamp FROM \"{}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    AND {} = '{}'{preds}\nORDER BY _timestamp DESC\nLIMIT {SAMPLE_TIMES_LIMIT}",
        escape_ident(stream_name),
        server_vantage::O2_DBM_KIND,
        escape_sq(kind),
    )
}

/// Enough polls to infer a median interval robustly, few enough to stay cheap.
const SAMPLE_TIMES_LIMIT: usize = 200;

/// The wire name for a storage column, used as its SQL alias in the breakdowns.
///
/// One mapping, consulted by both the SQL builder and (via the tests) the DTO
/// readers, so the projection and the reader cannot drift apart. Storage names
/// never reach the browser — that contract is why the alias exists at all rather
/// than the DTOs simply reading `o2_dbm_*` keys.
fn wire_alias_of(col: &str) -> &'static str {
    match col {
        c if c == server_vantage::O2_DBM_SESSION_STATE => "state",
        c if c == server_vantage::O2_DBM_WAIT_EVENT_TYPE => "wait_event_type",
        c if c == server_vantage::O2_DBM_WAIT_EVENT => "wait_event",
        // Unreachable for the two shipped breakdowns; a new grouping column must
        // add its alias here rather than silently projecting a storage name.
        _ => "grouped_value",
    }
}

/// A breakdown of sampled sessions, computed by SQL `GROUP BY`.
///
/// **The aggregate is SQL, never a Rust fold over fetched rows.** `dbm_server`
/// is a single shared logs stream whose deadlock path writes a handful of rows
/// per hour; activity sampling writes ~200 rows/sec for a 200-session instance,
/// so a 5-minute window across a fleet holds millions. Folding the row-limited
/// fetch (capped at [`MAX_EVENTS_LIMIT`]) would present a truncated,
/// unrepresentative sample AS a population breakdown — the worst available
/// failure, because it looks like an answer.
///
/// Returns `None` when the stream's schema lacks a grouping column. Naming an
/// absent column in a `GROUP BY` fails the WHOLE query with a schema error
/// rather than yielding nulls, and the exposed case is the common one: every
/// stream that predates activity ingest, and every deployment leaving
/// `ZO_DB_MONITORING_ACTIVITY_ENABLED` at its default of OFF, has none of these
/// columns. The rows query degrades to `_timestamp` and returns empty there, so
/// the breakdown must skip rather than 500 the endpoint.
///
/// Deliberately UNBOUNDED: a `LIMIT` on an aggregate is the same truncation this
/// function exists to avoid.
///
/// Each grouping column is SELECTed **under its wire alias** ([`wire_alias_of`]),
/// so the result rows arrive keyed the way the breakdown DTOs read them. Without
/// the alias the rows come back keyed `o2_dbm_session_state` while
/// [`state_breakdown`] looks up `state`, and every label renders `null` beside a
/// correct count — a breakdown that looks like a working answer while naming
/// nothing.
pub(crate) fn build_dbm_activity_breakdown_sql(
    stream_name: &str,
    group_col: &str,
    second_col: Option<&str>,
    start_time: i64,
    end_time: i64,
    preds: &str,
    present: &HashSet<String>,
) -> Option<String> {
    if !present.contains(group_col) {
        return None;
    }
    let second_col = match second_col {
        Some(c) if !present.contains(c) => return None,
        other => other,
    };
    // GROUP BY names the storage columns; the projection aliases them to the
    // wire names the DTOs read.
    let group_cols = match second_col {
        Some(c) => format!("{group_col}, {c}"),
        None => group_col.to_string(),
    };
    let projected = match second_col {
        Some(c) => format!(
            "{group_col} AS {}, {c} AS {}",
            wire_alias_of(group_col),
            wire_alias_of(c)
        ),
        None => format!("{group_col} AS {}", wire_alias_of(group_col)),
    };
    let cols = projected;
    let cols_group = group_cols;
    // COUNT(DISTINCT pid), not COUNT(*): activity writes one row per session
    // per poll, so COUNT(*) counts OBSERVATIONS. Over an hour at a 10s interval
    // a 200-session instance would report ~72,000 "sessions" — inflated by the
    // window over the poll interval, and inflated in the direction that looks
    // like a busy database, which is the worst way for a number to be wrong.
    //
    // A pid is unique per instance, not globally, so the count is only sound
    // because every caller scopes to one instance via `preds` or groups by a
    // column that cannot span instances. Revisit if a fleet-wide breakdown is
    // ever added.
    Some(format!(
        "SELECT {cols}, COUNT(DISTINCT {}) AS sessions FROM \"{}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    AND {} = '{}'{preds}\nGROUP BY {cols_group}\nORDER BY sessions DESC",
        server_vantage::O2_DBM_SESSION_PID,
        escape_ident(stream_name),
        server_vantage::O2_DBM_KIND,
        escape_sq(server_vantage::KIND_ACTIVITY),
    ))
}

/// One sampled session, as the browser sees it.
///
/// Storage names never reach the wire: `o2_dbm_engine` becomes `db_system`,
/// `o2_dbm_database` becomes `db_namespace`, and so on — the same vocabulary
/// every other DBM endpoint uses. Leaking the prefix would make every
/// ingest-schema change a breaking UI change.
fn activity_row_to_dto(row: &Value) -> Value {
    let pids = server_vantage::blocking_pids_of(row);
    json!({
        "timestamp": row
            .get(server_vantage::O2_DBM_TIMESTAMP)
            .and_then(server_vantage::as_i64_loose)
            .or_else(|| row.get("_timestamp").and_then(server_vantage::as_i64_loose))
            .unwrap_or(0),
        "session_pid": row.get(server_vantage::O2_DBM_SESSION_PID).and_then(server_vantage::as_i64_loose),
        "session_user": str_or_null(row, server_vantage::O2_DBM_SESSION_USER),
        "session_app": str_or_null(row, server_vantage::O2_DBM_SESSION_APP),
        "state": str_or_null(row, server_vantage::O2_DBM_SESSION_STATE),
        "query": str_or_null(row, server_vantage::O2_DBM_ACTIVITY_QUERY),
        "fingerprint": str_or_null(row, server_vantage::O2_DBM_FINGERPRINT),
        "server_query_id": str_or_null(row, server_vantage::O2_DBM_SERVER_QUERY_ID),
        "wait_event": str_or_null(row, server_vantage::O2_DBM_WAIT_EVENT),
        "wait_event_type": str_or_null(row, server_vantage::O2_DBM_WAIT_EVENT_TYPE),
        "query_start": str_or_null(row, server_vantage::O2_DBM_QUERY_START),
        // Transaction age is a different clock from query age — it is what
        // separates a 5ms idle-in-transaction from a 20-minute incident.
        "xact_start": str_or_null(row, server_vantage::O2_DBM_XACT_START),
        "wait_start": str_or_null(row, server_vantage::O2_DBM_WAIT_START),
        "exec_time_ms": row.get(server_vantage::O2_DBM_EXEC_TIME_MS).and_then(as_f64_loose),
        // Present ONLY for a still-running session, so the UI never renders a
        // completed duration as an elapsed one.
        "duration_ms": row.get(server_vantage::O2_DBM_DURATION_MS).and_then(as_f64_loose),
        // A real array on the wire, though stored as a scalar (the logs schema
        // inferrer rejects nested values). Never `[0]` for an unblocked session.
        "blocking_pids": pids,
        "blocked": !pids.is_empty(),
        "lock_mode": str_or_null(row, server_vantage::O2_DBM_LOCK_MODE),
        "lock_type": str_or_null(row, server_vantage::O2_DBM_LOCK_TYPE),
        "lock_relation": str_or_null(row, server_vantage::O2_DBM_LOCK_RELATION),
        "client_address": str_or_null(row, server_vantage::O2_DBM_CLIENT_ADDR),
        "client_host": str_or_null(row, server_vantage::O2_DBM_CLIENT_HOST),
        "client_port": row.get(server_vantage::O2_DBM_CLIENT_PORT).and_then(server_vantage::as_i64_loose),
        "db_system": get_str(row, server_vantage::O2_DBM_ENGINE),
        "db_instance": str_or_null(row, server_vantage::O2_DBM_INSTANCE),
        "db_namespace": str_or_null(row, server_vantage::O2_DBM_DATABASE),
    })
}

/// A string column, or JSON null when absent/empty.
fn str_or_null(row: &Value, key: &str) -> Value {
    match row.get(key).and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => json!(s),
        _ => Value::Null,
    }
}

fn as_f64_loose(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// Turn the `GROUP BY` result into the wire breakdown, with `share` derived from
/// the SQL counts.
///
/// Grouped by ENGINE-NATIVE `wait_event_type`/`wait_event`. A unified
/// cross-engine taxonomy was considered and withdrawn as unsound: PG's
/// `wait_event` is a point-in-time sampled state with no duration, while MySQL's
/// `performance_schema` instruments are timed events aggregated over a period,
/// so summing them into one `share` yields a number with no consistent meaning.
/// A DBA's next action is engine-specific anyway, and a unified bucket erases
/// the token they would paste into a search.
fn wait_event_breakdown(rows: &[Value]) -> Vec<Value> {
    let total: i64 = rows.iter().map(|r| get_i64(r, "sessions")).sum();
    rows.iter()
        .map(|r| {
            let sessions = get_i64(r, "sessions");
            json!({
                // Null survives as null: a Postgres backend on CPU reports no
                // wait event, and that bucket is a real answer, not a gap.
                "wait_event_type": r.get("wait_event_type").cloned().unwrap_or(Value::Null),
                "wait_event": r.get("wait_event").cloned().unwrap_or(Value::Null),
                "sessions": sessions,
                "share": if total > 0 { sessions as f64 / total as f64 } else { 0.0 },
            })
        })
        .collect()
}

/// The `by_state` breakdown — same shape over one column.
fn state_breakdown(rows: &[Value]) -> Vec<Value> {
    rows.iter()
        .map(|r| {
            json!({
                "state": r.get("state").cloned().unwrap_or(Value::Null),
                "sessions": get_i64(r, "sessions"),
            })
        })
        .collect()
}

/// Read canonical server-vantage events of one kind from a LOGS stream.
/// Read canonical server-vantage events of one kind from a LOGS stream.
pub(crate) fn build_dbm_events_sql(
    stream_name: &str,
    kind: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
    limit: usize,
    present: &HashSet<String>,
) -> String {
    // An EXPLICIT projection, never `SELECT *`.
    //
    // The recipes export into a stream that also carries ordinary log lines, so
    // its schema is the union of every field those lines ever had — 195 columns
    // on a real deployment, of which the readers below touch 21. `SELECT *`
    // makes a columnar engine fetch all 195 per row, and the 174 it does not
    // need dominate the read. Naming the columns keeps the cost proportional to
    // what is actually deserialized.
    //
    // `present` is the caller-supplied intersection with the STREAM SCHEMA, and
    // it is what makes this safe: `ALL_DBM_FIELDS` is the write-side
    // reservation list, so a field no recipe has ever emitted (e.g.
    // `o2_dbm_instance` on a filelog-only deployment) is simply absent — and
    // naming one missing column fails the ENTIRE query with a schema error
    // rather than returning it as null. Gate on the schema, the same way the
    // rollup gates its optional row-count columns.
    let cols = std::iter::once("_timestamp")
        .chain(
            server_vantage::ALL_DBM_FIELDS
                .into_iter()
                .filter(|f| present.contains(*f)),
        )
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "SELECT {cols} FROM \"{}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    AND {} = '{}'{preds}\nORDER BY _timestamp DESC\nLIMIT {limit}",
        escape_ident(stream_name),
        server_vantage::O2_DBM_KIND,
        escape_sq(kind),
    )
}

/// Run a read over a server-vantage LOGS stream. Returns empty (not an error)
/// when the stream does not exist — a deployment that has not yet shipped the
/// collector recipes must render an empty state, not a 500.
async fn run_events_search(
    org_id: &str,
    stream: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<Value>, anyhow::Error> {
    if !infra::schema::exists(org_id, StreamType::Logs, stream).await {
        return Ok(Vec::new());
    }
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: 0,
            size: STATS_READ_SIZE as i64,
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
    // `user_id: None` is deliberate HERE: the caller's read permission on
    // `stream` is verified by every handler that reaches this function (see
    // `can_read_stream`), so re-resolving it per search would re-query OFGA on
    // a path that is already authorized. Any NEW caller of this function must
    // check first — it does not authorize itself.
    let trace_id = config::ider::generate();
    let resp = crate::search::search(&trace_id, org_id, StreamType::Logs, None, &req).await?;
    Ok(resp.hits)
}

// ─── UI-facing DTOs (the API *is* the contract) ──────────────────────────────
//
// The read handlers below return a reshaped view, never the raw stored rows.
// Three reasons this reconciliation lives here and not in the frontend:
//
//  1. `o2_dbm_*` are STORAGE column names. They exist because the canonical ingest path needs a
//     flat, collision-proof namespace on a shared logs stream. Leaking them to the browser makes
//     every ingest-schema change a breaking UI change.
//  2. `o2_dbm_participants` is a JSON *string* purely because the logs schema inferrer rejects
//     nested values (see `DeadlockEvent::to_record`). That is a storage workaround; asking the
//     browser to undo it exports an implementation detail. `serde_json` has no such restriction on
//     the way out, so the wire carries a real array.
//  3. Stream-level RBAC is enforced in the handlers via `can_read_stream`, before any search runs.
//     Shaping server-side keeps field-level redaction in the one place that already knows the
//     caller's permissions.
//
// MySQL stitching (below) makes this mandatory rather than merely preferable:
// once the server merges N rows into one event, "the raw rows" are no longer a
// coherent thing to return.

/// Micro-seconds within which two MySQL single-participant entries are taken to
/// be two sides of ONE deadlock.
///
/// InnoDB writes each `*** (N) TRANSACTION:` block as its own timestamped log
/// entry; the lab measured the sides ~150 µs apart. The bound is deliberately
/// generous (2 s) because a false split is worse than a false merge here: a
/// split double-counts the deadlock AND lands the two halves in different query
/// shape groups, so the same bug reads as two unrelated half-sized ones.
///
/// That trade only holds ONCE THE SERVER IS KNOWN to be the same one — hence the
/// identity guard in [`stitch_mysql_deadlocks`]. Across two servers the window is
/// not evidence of anything, and a false merge fabricates a cycle.
const MYSQL_SIDE_WINDOW_MICROS: i64 = 2_000_000;

/// Rebuild a [`server_vantage::DeadlockEvent`] from one stored canonical row.
///
/// Reads only the canonical `o2_dbm_*` columns — the engine-specific fields they
/// were derived from (`dl_query_1`, `my_trx_thread`) are ingest-side inputs and
/// are never re-read here.
fn deadlock_event_from_row(row: &Value) -> server_vantage::DeadlockEvent {
    let ts = match get_i64(row, server_vantage::O2_DBM_TIMESTAMP) {
        0 => get_i64(row, "_timestamp"),
        t => t,
    };
    let opt = |k: &str| {
        let s = get_str(row, k);
        (!s.is_empty()).then_some(s)
    };
    server_vantage::DeadlockEvent {
        engine: opt(server_vantage::O2_DBM_ENGINE),
        database: opt(server_vantage::O2_DBM_DATABASE),
        instance: opt(server_vantage::O2_DBM_INSTANCE),
        timestamp: (ts != 0).then_some(ts),
        victim_pid: row
            .get(server_vantage::O2_DBM_VICTIM_PID)
            .and_then(server_vantage::as_i64_loose),
        participants: server_vantage::participants_of(row),
        raw: opt(server_vantage::O2_DBM_RAW),
        // Carries MySQL's rollback verdict from its own row into the stitch —
        // without this the sides and the verdict never meet.
        victim_side: row
            .get(server_vantage::O2_DBM_VICTIM_SIDE)
            .and_then(server_vantage::as_i64_loose),
    }
}

/// Stitch MySQL single-participant deadlock entries into whole deadlocks.
///
/// **Why at read time.** `merge_mysql_deadlocks` has existed since the ingest
/// work but had no production caller: canonicalization runs per-record, and a
/// per-record hook cannot hold the cross-record state that stitching needs. The
/// read path is the first place that sees a whole window at once.
///
/// Correlation key is `(engine, instance, database)` — pids and transaction ids
/// are only comparable within one server, so merging across instances would
/// fabricate a deadlock between unrelated databases. Within a group, entries
/// within [`MYSQL_SIDE_WINDOW_MICROS`] of the open event join it unless they
/// repeat a transaction id already present (that is the NEXT deadlock reusing
/// the window, not another side).
///
/// **An EMPTY instance is not a group.** The shipped filelog deadlock recipes tag
/// neither instance nor database, so every MySQL/MariaDB host reporting into one
/// `dbm_server` stream used to land in the single bucket `("mysql", "", "")` —
/// `unwrap_or_default()` turned "we do not know which server" into "the same
/// server". Verified against this merge: two hosts each having their own
/// two-sided deadlock inside the 2 s window fused into ONE 4-participant event
/// (pids 41/42/71/72), and `rank_deadlock_shapes` then ranked a `query_shape`
/// matching no real lock-ordering bug. The transaction-id guard does not catch it
/// — ids differ across servers, so it PERMITS the merge.
///
/// So an untagged side is not stitched at all: it passes through as the
/// one-participant event it is, flagged `partial` on the wire. That over-reports
/// deadlock COUNT on an untagged deployment, which is the safe direction —
/// dropping it would turn a real deadlock into no deadlock, while merging it
/// invents a cycle that never happened. The fix on the collector side is to tag
/// an instance in the recipe, which restores full stitching.
///
/// Postgres events pass through untouched: the `DETAIL:` entry already carries
/// the whole wait cycle, so a PG event arrives with both sides and merging two
/// of them would invent a 4-way cycle that never happened.
pub(crate) fn stitch_mysql_deadlocks(
    events: Vec<server_vantage::DeadlockEvent>,
) -> Vec<server_vantage::DeadlockEvent> {
    let mut passthrough: Vec<server_vantage::DeadlockEvent> = Vec::new();
    // Group key: only same-server single-participant MySQL entries can stitch.
    let mut groups: BTreeMap<(String, String, String), Vec<server_vantage::DeadlockEvent>> =
        BTreeMap::new();

    for ev in events {
        // MariaDB splits a deadlock the same way MySQL does (side, side, then
        // the rollback verdict alone), so it needs the identical stitch. The
        // group key includes the engine, so MariaDB and MySQL rows can never
        // merge into one another's events.
        let is_mysql = matches!(ev.engine.as_deref(), Some("mysql") | Some("mariadb"));
        // A MySQL row joins the stitch if it is a SIDE (exactly one
        // participant) or the ROLLBACK VERDICT (no participants, just
        // `victim_side`). The verdict must reach the merge — it is the only
        // record naming which side was cancelled, and dropping it here is what
        // left every MySQL participant unflagged and the "cancelled by the
        // database" panel blank.
        //
        // Anything else is already whole (Postgres DETAIL entries, or a MySQL
        // event a future collector ships pre-assembled) and passes through.
        let is_side = ev.participants.len() == 1;
        let is_verdict = ev.participants.is_empty() && ev.victim_side.is_some();
        if !is_mysql || !(is_side || is_verdict) {
            passthrough.push(ev);
            continue;
        }
        // Identity, not `unwrap_or_default()`: without an instance there is no
        // group to belong to (see the doc comment). Sides still surface, as
        // partial one-participant events.
        let Some(instance) = ev.instance.clone().filter(|s| !s.is_empty()) else {
            // A participant-LESS verdict record (`WE ROLL BACK TRANSACTION (N)`)
            // is the one thing that must NOT pass through: alone it names a side
            // number and nothing else — no pid, no statement — so it would
            // render as a content-free deadlock row and inflate the count with a
            // record that describes no event. It is only ever meaningful joined
            // to the sides, and unstitchable means it can never be joined.
            if is_side {
                passthrough.push(ev);
            }
            continue;
        };
        let key = (
            ev.engine.clone().unwrap_or_default(),
            instance,
            ev.database.clone().unwrap_or_default(),
        );
        groups.entry(key).or_default().push(ev);
    }

    let mut out = passthrough;
    for (_, sides) in groups {
        // `merge_mysql_deadlocks` sorts by timestamp and enforces the
        // distinct-transaction-id rule; a 3+ way pileup therefore accumulates
        // into one event, and an unmatched singleton simply stays a
        // one-participant event (flagged `partial` on the wire).
        out.extend(server_vantage::merge_mysql_deadlocks(
            sides,
            MYSQL_SIDE_WINDOW_MICROS,
        ));
    }
    // Newest first — the order the UI renders and the order the raw read used.
    out.sort_by_key(|e| std::cmp::Reverse(e.timestamp.unwrap_or(0)));
    out
}

/// Serialize one assembled deadlock into the UI-facing DTO.
///
/// `participants` is a real ARRAY here, and `query_shape` is recomputed from the
/// assembled participant set rather than read off the row: a stitched MySQL
/// event's shape must cover BOTH sides, but each stored row only ever knew its
/// own. Recomputing routes both engines through the identical
/// `DeadlockEvent::query_shape` — the sorted, deduped, victim-order-independent
/// fingerprint set — so a MySQL deadlock and a Postgres one group by the same
/// rule.
fn deadlock_event_to_dto(ev: &server_vantage::DeadlockEvent) -> Value {
    let ts = ev.timestamp.unwrap_or(0);
    let participants: Vec<Value> = ev
        .participants
        .iter()
        .map(|p| {
            json!({
                "pid": p.pid,
                "transaction_id": p.transaction_id,
                "query": p.query,
                "query_norm": p.query_norm,
                "fingerprint": p.fingerprint,
                "application": p.app,
                "user": p.user,
                "lock_mode": p.lock_mode,
                "lock_target": p.lock_target,
                // The event's explicit victim verdict wins over the
                // per-participant flag when the log named a process.
                "victim": match ev.victim_pid {
                    Some(v) => p.pid == Some(v),
                    None => p.victim,
                },
            })
        })
        .collect();
    json!({
        // pid + timestamp is unique per event: one session cannot deadlock
        // twice at the same microsecond.
        "id": format!(
            "{ts}-{}",
            ev.victim_pid
                .or_else(|| ev.participants.first().and_then(|p| p.pid))
                .map(|p| p.to_string())
                .unwrap_or_else(|| "x".to_string())
        ),
        "timestamp": ts,
        "db_system": ev.engine.clone().unwrap_or_default(),
        "db_instance": ev.instance,
        "db_namespace": ev.database,
        "victim_pid": ev.victim_pid,
        "participant_count": ev.participants.len(),
        // A deadlock needs two sides. One side means the other never arrived
        // (MySQL entry lost, or the window cut it off) — the UI must be able to
        // say "partial" rather than render a nonsensical one-sided cycle.
        "partial": ev.participants.len() < 2,
        "query_shape": ev.query_shape(),
        "objects": objects_of(ev),
        "participants": participants,
        "raw": ev.raw,
    })
}

/// The table(s) the sides fought over, in participant order and deduped.
fn objects_of(ev: &server_vantage::DeadlockEvent) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for p in &ev.participants {
        if let Some(t) = p.lock_target.as_deref()
            && !t.is_empty()
            && !seen.iter().any(|s| s == t)
        {
            seen.push(t.to_string());
        }
    }
    seen
}

/// Rank deadlock events by QUERY SHAPE — the sorted participant-fingerprint set.
///
/// The victim alternating between firings is the SIGNATURE of a symmetric
/// lock-ordering bug (proof Demo 2), so the grouping key must be victim-order
/// independent or one bug would split into two rows that each look half as bad.
///
/// Takes ASSEMBLED events, not stored rows. The stored `o2_dbm_query_shape`
/// column is written per record, so on MySQL — where each record is one SIDE —
/// it holds a single participant's fingerprint. Grouping on it put the two
/// halves of one MySQL deadlock in different rows while Postgres, whose record
/// already carries both sides, grouped correctly. Recomputing from the stitched
/// event via `DeadlockEvent::query_shape` makes the key the sorted, deduped
/// fingerprint SET on both engines.
pub(crate) fn rank_deadlock_shapes(events: &[server_vantage::DeadlockEvent]) -> Vec<Value> {
    let mut groups: BTreeMap<String, (i64, i64, BTreeSet<String>, Vec<String>)> = BTreeMap::new();
    for ev in events {
        let Some(shape) = ev.query_shape() else {
            // Participants whose SQL failed to normalize have no fingerprint,
            // so there is no shape to rank them under.
            continue;
        };
        let ts = ev.timestamp.unwrap_or(0);
        let entry = groups
            .entry(shape)
            .or_insert_with(|| (0, 0, BTreeSet::new(), Vec::new()));
        entry.0 += 1;
        entry.1 = entry.1.max(ts);
        for p in &ev.participants {
            if let Some(fp) = p.fingerprint.clone() {
                entry.2.insert(fp);
            }
            if let Some(q) = p.query_norm.clone().or_else(|| p.query.clone())
                && entry.3.len() < 4
                && !entry.3.contains(&q)
            {
                entry.3.push(q);
            }
        }
    }
    let mut out: Vec<Value> = groups
        .into_iter()
        .map(|(shape, (count, last_seen, fps, queries))| {
            json!({
                "query_shape": shape,
                "count": count,
                "last_seen": last_seen,
                "fingerprints": fps.into_iter().collect::<Vec<_>>(),
                "queries": queries,
            })
        })
        .collect();
    out.sort_by(|a, b| {
        get_i64(b, "count")
            .cmp(&get_i64(a, "count"))
            .then(get_i64(b, "last_seen").cmp(&get_i64(a, "last_seen")))
    });
    out
}

// ─── Collection diagnostics: "nothing happened" vs "nothing is watching" ─────
//
// An empty Deadlocks or Blocked tab has two OPPOSITE meanings and the operator
// cannot tell them apart from the absence itself. "No deadlocks" shown while the
// filelog receiver is misconfigured is not a neutral blank — it is an active
// lie, and it is a lie told exactly on the day it matters. The competitor study
// found no product in the category that draws this line at all.
//
// The ONLY honest way to draw it is from evidence in the data. We never assert
// "collection is healthy" from configuration, from the endpoint answering, or
// from the stream merely existing — all three are true in the broken case. We
// assert it from RECORDS: the server-vantage stream is one stream shared by
// every recipe and by the raw log tail, so records of ANY kind in or near the
// window prove the pipe from that database to us is carrying traffic. If a
// deadlock had happened it would have travelled the same pipe.
//
// The corollary is the load-bearing half: NO records of any kind means we have
// no evidence anyone is watching, so we must NOT claim healthy silence.

/// How far either side of the window we look for proof-of-life records.
///
/// The probe answers "is this collector alive", not "what happened in the
/// window", so it deliberately reaches outside the window: a 5-minute window
/// asked for at :00 can legitimately contain no sample yet while a collector
/// polling every 10 s is perfectly healthy. One hour is comfortably longer than
/// any recipe interval in the shipped recipes (10 s) and than a filelog batch.
const LIVENESS_PROBE_MICROS: i64 = 60 * 60 * 1_000_000;

/// How far back we look for the most recent event BEFORE the window.
///
/// Bounds the "last one was 3 days ago" lookup. 30 days is long enough that a
/// quiet-but-not-silent database still gets an answer, and short enough that
/// the scan stays cheap.
const LAST_SEEN_LOOKBACK_MICROS: i64 = 30 * 24 * 60 * 60 * 1_000_000;

/// Evidence that the server-vantage collector is alive, derived from the data.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct CollectionProbe {
    /// Records of ANY kind seen in the stream within the probe range. This is
    /// the whole basis for distinguishing the two empty states.
    pub(crate) records_seen: i64,
    /// Newest `_timestamp` of ANY record in the stream within the probe range
    /// (µs), or `None` when the stream has none. Drives "last look 4s ago".
    pub(crate) newest_record: Option<i64>,
    /// Records in the probe range that are NOT canonical `o2_dbm_*` events —
    /// raw tailed log lines and non-lock recipe rows. See
    /// [`CollectionProbe::log_lines_seen`].
    pub(crate) non_event_records: i64,
    /// Distinct `_timestamp` values of the kind being diagnosed, newest first,
    /// within the probe range. Feeds interval inference.
    pub(crate) kind_sample_times: Vec<i64>,
    /// Newest event of this kind STRICTLY BEFORE the window (µs).
    pub(crate) last_seen_before: Option<i64>,
}

impl CollectionProbe {
    /// Is the tab empty because collection is broken, rather than because
    /// nothing went wrong?
    ///
    /// True only when we have NO evidence of life: not one record of any kind
    /// reached this stream in or near the window. Deliberately conservative in
    /// the direction of NOT crying wolf — one record is enough to prove the
    /// pipe carries traffic, and a false "collection is broken" on a healthy
    /// quiet database would train the operator to ignore the warning.
    ///
    /// Only meaningful when the result set is empty; a tab with rows in it is
    /// self-evidently collecting, so callers pass `false` there.
    fn not_collecting(&self) -> bool {
        self.records_seen == 0
    }

    /// Raw log lines the deadlock recipe has seen — the "healthy silence"
    /// signal.
    ///
    /// The filelog receiver ships EVERY matched line to this stream, and only
    /// the ones matching a deadlock pattern become canonical `o2_dbm_kind`
    /// records. So a high count here with zero deadlocks is the good case
    /// stated positively: the tail is running, it is parsing lines, and none of
    /// them was a deadlock. Zero of both is the bad case.
    ///
    /// `None` when the stream is absent entirely — we cannot honestly report a
    /// count of something we never read.
    fn log_lines_seen(&self) -> Option<i64> {
        (self.records_seen > 0).then_some(self.non_event_records)
    }

    /// Interval the blocking recipe polls on, in whole seconds, inferred from
    /// the spacing of observed samples.
    ///
    /// The recipe polls `pg_stat_activity` on a fixed `collection_interval`
    /// that we cannot read back from telemetry, but every poll that found a
    /// blocked session stamps a record, so the MEDIAN gap between distinct
    /// sample timestamps recovers it. Median, not mean, because a quiet period
    /// leaves one huge gap that would drag a mean to nonsense.
    ///
    /// `None` with fewer than three samples: two points give one gap and no way
    /// to tell a real interval from a coincidence, and the UI's fallback copy
    /// ("on the schedule your collector is configured with") is more honest
    /// than a guess.
    fn sample_interval_seconds(&self) -> Option<i64> {
        if self.kind_sample_times.len() < 3 {
            return None;
        }
        let mut gaps: Vec<i64> = self
            .kind_sample_times
            .windows(2)
            .map(|w| (w[0] - w[1]).abs())
            .filter(|g| *g > 0)
            .collect();
        if gaps.is_empty() {
            return None;
        }
        gaps.sort_unstable();
        let median = gaps[gaps.len() / 2];
        // Round to the nearest second; sub-second polling is not a thing any
        // shipped recipe does, and reporting "0 seconds" would read as broken.
        Some(((median as f64) / 1_000_000.0).round().max(1.0) as i64)
    }
}

/// SQL for the liveness probe: every record in the stream in the probe range,
/// carrying only the two columns the probe reads.
///
/// `o2_dbm_kind` is selected (not filtered on) precisely because the records
/// that prove liveness best are the ones that are NOT events.
pub(crate) fn build_probe_sql(stream_name: &str, start_time: i64, end_time: i64) -> String {
    // NO kind predicate here, deliberately — see `probe_collection`, which
    // counts untagged rows as `non_event_records`. Those are the evidence that
    // the collector is alive on a healthy database that simply has not
    // deadlocked, so filtering them would turn "nothing went wrong" into
    // "nothing is being collected" — exactly the misread the lock empty-states
    // exist to prevent. This scan stays cheap through PROBE_SCAN_LIMIT.
    format!(
        "SELECT _timestamp, {} FROM \"{}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\nORDER BY _timestamp DESC\nLIMIT {PROBE_SCAN_LIMIT}",
        server_vantage::O2_DBM_KIND,
        escape_ident(stream_name),
    )
}

/// SQL for the most recent event of one kind strictly before the window.
pub(crate) fn build_last_seen_sql(
    stream_name: &str,
    kind: &str,
    lookback_start: i64,
    window_start: i64,
    preds: &str,
) -> String {
    format!(
        "SELECT _timestamp FROM \"{}\"\nWHERE _timestamp >= {lookback_start} AND _timestamp < {window_start}\n    AND {} = '{}'{preds}\nORDER BY _timestamp DESC\nLIMIT 1",
        escape_ident(stream_name),
        server_vantage::O2_DBM_KIND,
        escape_sq(kind),
    )
}

/// Cap on the liveness scan. The probe only ever needs to know "any, and how
/// recent" plus enough spacing to infer an interval — it is not a count the UI
/// does arithmetic on, so a bounded scan is correct rather than merely cheap.
const PROBE_SCAN_LIMIT: usize = 2000;

/// Build the [`CollectionProbe`] for one kind, from the two bounded reads.
///
/// Returns a default (all-zero) probe when the stream does not exist, which is
/// exactly the `not_collecting` verdict — no stream means nothing ever wrote
/// one server-vantage record.
async fn probe_collection(
    org_id: &str,
    stream: &str,
    kind: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
) -> CollectionProbe {
    let probe_start = start_time - LIVENESS_PROBE_MICROS;
    let probe_end = end_time + LIVENESS_PROBE_MICROS;
    let sql = build_probe_sql(stream, probe_start, probe_end);
    let rows = run_events_search(org_id, stream, sql, probe_start, probe_end)
        .await
        .unwrap_or_else(|e| {
            // A failed probe must not turn into a false "collection is broken".
            // Reporting `records_seen == 0` on a read error would name a
            // prerequisite that is in fact fine; an empty vec here yields the
            // same conservative default, so we log and carry on with "unknown".
            log::warn!("[DbMonitoring] liveness probe failed for {org_id}/{stream}: {e}");
            Vec::new()
        });

    let mut probe = CollectionProbe {
        records_seen: rows.len() as i64,
        ..Default::default()
    };
    for row in &rows {
        let ts = get_i64(row, "_timestamp");
        if ts != 0 {
            probe.newest_record = Some(probe.newest_record.unwrap_or(i64::MIN).max(ts));
        }
        let row_kind = get_str(row, server_vantage::O2_DBM_KIND);
        if row_kind.is_empty() {
            probe.non_event_records += 1;
        } else if row_kind == kind && ts != 0 {
            probe.kind_sample_times.push(ts);
        }
    }
    // Newest first, deduped: two rows of the same poll (several blocked
    // sessions in one sample) share a timestamp and must not read as a
    // zero-length interval.
    probe.kind_sample_times.sort_unstable_by(|a, b| b.cmp(a));
    probe.kind_sample_times.dedup();

    // The "last one was 3 days ago" lookup, strictly before the window so it can
    // never restate a row the table is already showing.
    let sql = build_last_seen_sql(
        stream,
        kind,
        start_time - LAST_SEEN_LOOKBACK_MICROS,
        start_time,
        preds,
    );
    if let Ok(rows) = run_events_search(
        org_id,
        stream,
        sql,
        start_time - LAST_SEEN_LOOKBACK_MICROS,
        start_time,
    )
    .await
        && let Some(ts) = rows
            .first()
            .map(|r| get_i64(r, "_timestamp"))
            .filter(|t| *t != 0)
    {
        probe.last_seen_before = Some(ts);
    }
    probe
}

/// Freshness for the server-vantage endpoints.
///
/// Deliberately NOT [`Freshness`]: that block describes the rollup job and its
/// live tail, and neither exists on this path — these events are read straight
/// from the ingested stream. Reusing it would report `data_through: 0` (never
/// rolled up) on a perfectly healthy collector and trip the UI's staleness
/// banner. `data_through` here means "the newest server-vantage record we can
/// see", which is what the tab's "most recent line read" claim needs.
fn event_freshness(probe: &CollectionProbe) -> Value {
    json!({
        "data_through": probe.newest_record,
        // No rollup job on this path, so no tail and no estimation.
        "live_tail": false,
        "tail_truncated": false,
        "percentiles_estimated": false,
    })
}

#[derive(Debug, Deserialize)]
pub struct DeadlocksQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    /// Server-vantage LOGS stream carrying the canonical events.
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    /// The database name. Accepted as `namespace` too — that is the name the
    /// rollup endpoints use for the same concept (`db_namespace`), and the UI
    /// sends one vocabulary to every DBM endpoint.
    pub database: Option<String>,
    #[serde(alias = "namespace")]
    pub namespace: Option<String>,
    /// Free text matched over participant statements, applications and objects.
    /// Applied in Rust AFTER stitching so a term matching only one MySQL side
    /// still returns the whole deadlock.
    pub search: Option<String>,
    pub limit: Option<usize>,
}

impl DeadlocksQuery {
    /// The database filter, under either spelling.
    fn database(&self) -> Option<&str> {
        self.database
            .as_deref()
            .or(self.namespace.as_deref())
            .filter(|s| !s.is_empty())
    }
}

/// Does this assembled event match the free-text term?
///
/// Matches over the fields a reader would search by: the statements, the
/// applications and users on each side, and the lock targets. Case-insensitive
/// substring — the term is a needle from the incident, not a pattern language.
fn deadlock_matches_search(ev: &server_vantage::DeadlockEvent, needle_lower: &str) -> bool {
    if needle_lower.is_empty() {
        return true;
    }
    let hit = |s: &Option<String>| {
        s.as_deref()
            .is_some_and(|v| v.to_lowercase().contains(needle_lower))
    };
    ev.participants.iter().any(|p| {
        hit(&p.query)
            || hit(&p.query_norm)
            || hit(&p.app)
            || hit(&p.user)
            || hit(&p.lock_target)
            || hit(&p.fingerprint)
    }) || hit(&ev.database)
        || hit(&ev.instance)
}

/// GET /{org_id}/traces/db_monitoring/deadlocks — FR-16 deadlock events.
///
/// Returns assembled deadlock EVENTS in the UI-facing DTO shape — never the raw
/// stored rows. Newest first, each with a real `participants[]` array whose
/// members carry the same `fingerprint` the span enrichment computes, so a
/// deadlock JOINs straight to the query rows the UI already shows (proof §2.6).
/// Also returns per-query-shape counts so the UI can rank "which query shape
/// deadlocks most".
///
/// MySQL entries — one per transaction side — are stitched into whole deadlocks
/// here (see [`stitch_mysql_deadlocks`]); Postgres records already carry the
/// whole cycle and pass through untouched.
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/deadlocks",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringDeadlocks",
    summary = "Database Monitoring: deadlock events",
    description = "Canonical deadlock events with assembled participants and per-query-shape ranking.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default 'dbm_server')"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("database" = Option<String>, Query, description = "Database name filter (alias: namespace)"),
        ("search" = Option<String>, Query, description = "Free text over participant statements, applications and objects"),
        ("limit" = Option<usize>, Query, description = "Max raw records scanned (default 100)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_deadlocks(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<DeadlocksQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    // Server-vantage events live in a LOGS stream (`dbm_server` by default),
    // not a trace stream — the permission is checked against the type actually
    // read, or the check would consult the wrong OFGA object.
    if !can_read_stream(&org_id, &user_email.user_id, stream, StreamType::Logs).await {
        return unauthorized_response();
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .clamp(1, MAX_EVENTS_LIMIT);
    let preds = dbm_event_preds(q.system.as_deref(), q.instance.as_deref(), q.database());

    // Rows are read at the RAW-RECORD limit, then stitched. On MySQL that means
    // the event count after stitching is lower than the row count — which is
    // the point: the cap bounds the scan, not the answer.
    // A failed schema read is reported, never absorbed: an empty set here would
    // emit events with no engine, no participants and no victim, and the probe
    // would be skipped because `hits` is non-empty — content-free rows with no
    // diagnostic. See `present_dbm_columns`.
    let present = match present_dbm_columns(&org_id, stream).await {
        Ok(present) => present,
        Err(e) => {
            log::error!("[DbMonitoring] deadlocks schema read failed for {org_id}/{stream}: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };
    let sql = build_dbm_events_sql(
        stream,
        server_vantage::KIND_DEADLOCK,
        start_time,
        end_time,
        &preds,
        limit,
        &present,
    );
    let rows = match run_events_search(&org_id, stream, sql, start_time, end_time).await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[DbMonitoring] deadlocks read failed for {org_id}/{stream}: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };
    let row_count = rows.len();

    let events: Vec<server_vantage::DeadlockEvent> =
        rows.iter().map(deadlock_event_from_row).collect();
    // GAP 2: MySQL logs one entry per transaction side. Without this the tab
    // shows ~2 rows per real deadlock AND splits the sides into different shape
    // groups, so the same bug reads as two unrelated half-sized ones.
    let events = stitch_mysql_deadlocks(events);

    let needle = q.search.as_deref().unwrap_or("").trim().to_lowercase();
    let events: Vec<server_vantage::DeadlockEvent> = events
        .into_iter()
        .filter(|e| deadlock_matches_search(e, &needle))
        .collect();

    // Shapes are ranked over the SAME assembled, filtered set the rows come
    // from, so the ranking and the table can never disagree.
    let shapes = rank_deadlock_shapes(&events);
    let hits: Vec<Value> = events.iter().map(deadlock_event_to_dto).collect();

    // Only diagnose an EMPTY tab. A tab with rows is self-evidently collecting,
    // and the probe is two extra reads that would buy nothing there.
    let probe = if hits.is_empty() {
        probe_collection(
            &org_id,
            stream,
            server_vantage::KIND_DEADLOCK,
            start_time,
            end_time,
            &preds,
        )
        .await
    } else {
        CollectionProbe::default()
    };

    MetaHttpResponse::json(json!({
        "hits": hits,
        "query_shapes": shapes,
        // EVENT count (post-stitch), which is what the tab badge means by
        // "how many deadlocks happened".
        "total": hits.len(),
        // The RAW READ hit its cap, so events older than the oldest returned one
        // exist. Measured on rows, because that is what was capped.
        "truncated": row_count >= limit,
        "stream": stream,
        // ── collection diagnostics (empty state) ──────────────────────────
        // Empty AND no evidence of life: name the missing prerequisite rather
        // than reporting healthy silence.
        "not_collecting": hits.is_empty() && probe.not_collecting(),
        // Log lines the tail carried that were not deadlocks — "we looked at N
        // lines and none was a deadlock".
        "log_lines_seen": probe.log_lines_seen(),
        // The most recent deadlock BEFORE this window, so an empty window can
        // still say "the last one was 3 days ago".
        "last_seen_before": probe.last_seen_before,
        // HONESTY: this is a MySQL server variable
        // (`SET GLOBAL innodb_print_all_deadlocks`). It is not present in any
        // telemetry we receive — with it OFF the engine simply writes nothing,
        // so its absence is indistinguishable from "no deadlocks happened".
        // Detecting it would mean fabricating a fact, so we return `null` =
        // UNKNOWN and the UI phrases it as a checklist item to verify rather
        // than as something we observed.
        "innodb_print_all_deadlocks": Value::Null,
        "freshness": event_freshness(&probe),
    }))
}

#[derive(Debug, Deserialize)]
pub struct BlockingQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    /// See [`DeadlocksQuery::database`] — `namespace` is the same concept under
    /// the rollup endpoints' spelling.
    pub database: Option<String>,
    pub namespace: Option<String>,
    /// Free text over the blocked/blocking statements and applications.
    pub search: Option<String>,
    /// Drop samples whose blocked session waited less than this.
    pub min_wait_seconds: Option<f64>,
    pub limit: Option<usize>,
}

impl BlockingQuery {
    fn database(&self) -> Option<&str> {
        self.database
            .as_deref()
            .or(self.namespace.as_deref())
            .filter(|s| !s.is_empty())
    }
}

/// Free-text match over one blocking sample.
fn blocking_matches_search(s: &server_vantage::BlockingSample, needle_lower: &str) -> bool {
    if needle_lower.is_empty() {
        return true;
    }
    let hit = |v: &Option<String>| {
        v.as_deref()
            .is_some_and(|x| x.to_lowercase().contains(needle_lower))
    };
    hit(&s.blocked_query)
        || hit(&s.blocking_query)
        || hit(&s.blocked_app)
        || hit(&s.blocking_app)
        || hit(&s.blocked_fingerprint)
        || hit(&s.blocking_fingerprint)
        || hit(&s.wait_event)
        || hit(&s.wait_event_type)
        || hit(&s.database)
        || hit(&s.instance)
}

/// Serialize one blocking sample into the UI-facing DTO.
///
/// Same contract as the deadlock DTO: no `o2_dbm_` prefixes, and `db_system` /
/// `db_instance` / `db_namespace` are the names every other DBM endpoint uses
/// for these three, so the UI reads one vocabulary across the whole feature.
fn blocking_sample_to_dto(s: &server_vantage::BlockingSample) -> Value {
    json!({
        "timestamp": s.timestamp.unwrap_or(0),
        "blocked_pid": s.blocked_pid,
        "blocking_pid": s.blocking_pid,
        "blocked_query": s.blocked_query,
        "blocking_query": s.blocking_query,
        "blocked_fingerprint": s.blocked_fingerprint,
        "blocking_fingerprint": s.blocking_fingerprint,
        "blocked_application": s.blocked_app,
        "blocking_application": s.blocking_app,
        "wait_event_type": s.wait_event_type,
        "wait_event": s.wait_event,
        "wait_seconds": s.wait_seconds,
        "db_system": s.engine.clone().unwrap_or_default(),
        "db_instance": s.instance,
        "db_namespace": s.database,
    })
}

/// GET /{org_id}/traces/db_monitoring/blocking — FR-16 blocking chains.
///
/// Returns the flat canonical samples AND server-assembled root-blocker
/// `chains[]`. `pg_blocking_pids()` yields only DIRECT blocker edges (proof
/// §2.2/§4) — the transitive closure that identifies the one session worth
/// killing is ours to build, and is [`super::chains::assemble_chains`].
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/blocking",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringBlocking",
    summary = "Database Monitoring: blocking samples and root-blocker chains",
    description = "Canonical blocking samples plus server-assembled transitive blocking chains with the root blocker identified.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default 'dbm_server')"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("database" = Option<String>, Query, description = "Database name filter (alias: namespace)"),
        ("search" = Option<String>, Query, description = "Free text over statements and applications"),
        ("min_wait_seconds" = Option<f64>, Query, description = "Minimum blocked wait to include"),
        ("limit" = Option<usize>, Query, description = "Max samples (default 100)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_blocking(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<BlockingQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    // Logs stream, same reasoning as `get_dbm_deadlocks`.
    if !can_read_stream(&org_id, &user_email.user_id, stream, StreamType::Logs).await {
        return unauthorized_response();
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .clamp(1, MAX_EVENTS_LIMIT);
    let preds = dbm_event_preds(q.system.as_deref(), q.instance.as_deref(), q.database());

    // Same contract as the deadlocks handler, and here the false verdict is the
    // loud one: an empty set drops the pid columns, `BlockingSample::from_record`
    // then filters out every row, and the page tells the operator
    // `not_collecting: true` — a healthy collector reported as broken.
    let present = match present_dbm_columns(&org_id, stream).await {
        Ok(present) => present,
        Err(e) => {
            log::error!("[DbMonitoring] blocking schema read failed for {org_id}/{stream}: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };
    let sql = build_dbm_events_sql(
        stream,
        server_vantage::KIND_BLOCKING,
        start_time,
        end_time,
        &preds,
        limit,
        &present,
    );
    let rows = match run_events_search(&org_id, stream, sql, start_time, end_time).await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[DbMonitoring] blocking read failed for {org_id}/{stream}: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    // The min-wait and search filters are applied in Rust, deliberately: they
    // must filter the SAME rows that feed chain assembly, and a float predicate
    // in SQL over a column that may be stored as text would silently drop rows.
    let min_wait = q.min_wait_seconds.unwrap_or(f64::MIN);
    let needle = q.search.as_deref().unwrap_or("").trim().to_lowercase();
    let samples: Vec<server_vantage::BlockingSample> = rows
        .iter()
        .filter_map(server_vantage::BlockingSample::from_record)
        .filter(|s| s.wait_seconds.unwrap_or(0.0) >= min_wait)
        .filter(|s| blocking_matches_search(s, &needle))
        .collect();

    let chains = chains::assemble_chains(&samples);
    let hits: Vec<Value> = samples.iter().map(blocking_sample_to_dto).collect();

    // See the deadlocks handler: diagnose only the empty case.
    let probe = if hits.is_empty() {
        probe_collection(
            &org_id,
            stream,
            server_vantage::KIND_BLOCKING,
            start_time,
            end_time,
            &preds,
        )
        .await
    } else {
        CollectionProbe::default()
    };

    MetaHttpResponse::json(json!({
        "hits": hits,
        "chains": chains.iter().map(|c| c.to_json()).collect::<Vec<_>>(),
        "total": hits.len(),
        "truncated": rows.len() >= limit,
        "stream": stream,
        // ── collection diagnostics (empty state) ──────────────────────────
        "not_collecting": hits.is_empty() && probe.not_collecting(),
        // When the lock tables were last read AT ALL. Blocking is a STATE, not
        // an event: the poll that finds nothing is the healthy case and leaves
        // no blocking record, so this is the newest record of ANY kind — the
        // only honest evidence that the sampler ran.
        "sampled_at": probe.newest_record,
        // Inferred from the spacing of observed samples; `null` when too few to
        // infer, and the UI falls back to non-numeric copy.
        "sample_interval_seconds": probe.sample_interval_seconds(),
        "freshness": event_freshness(&probe),
    }))
}

#[derive(Debug, Deserialize)]
pub struct ActivityQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    /// See [`DeadlocksQuery::database`] — `namespace` is the same concept under
    /// the rollup endpoints' spelling.
    pub database: Option<String>,
    pub namespace: Option<String>,
    pub limit: Option<usize>,
}

impl ActivityQuery {
    fn database(&self) -> Option<&str> {
        self.database
            .as_deref()
            .or(self.namespace.as_deref())
            .filter(|s| !s.is_empty())
    }
}

/// GET /{org_id}/traces/db_monitoring/activity — sampled active sessions.
///
/// `hits` is a row-limited SAMPLE OF SESSIONS, not the population;
/// `by_wait_event` and `by_state` are SQL aggregates over the whole window, so
/// the breakdown stays representative however many rows the table shows.
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/activity",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringActivity",
    summary = "Database Monitoring: sampled active sessions and wait-event breakdown",
    description = "Sampled sessions from the server-vantage query_sample feed, with SQL-computed wait-event and state breakdowns over the full window.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default 'dbm_server')"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("database" = Option<String>, Query, description = "Database name filter (alias: namespace)"),
        ("limit" = Option<usize>, Query, description = "Max sampled sessions returned (default 100)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_activity(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<ActivityQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    // A LOGS stream, same as deadlocks/blocking. StreamType::Traces here would
    // consult the wrong OFGA object and silently authorize.
    if !can_read_stream(&org_id, &user_email.user_id, stream, StreamType::Logs).await {
        return unauthorized_response();
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .clamp(1, MAX_EVENTS_LIMIT);
    let preds = dbm_event_preds(q.system.as_deref(), q.instance.as_deref(), q.database());

    // A failed schema read is reported, never absorbed into an empty set — an
    // empty set drops the projection and the page would report a healthy
    // collector as broken. See `present_dbm_columns`.
    let present = match present_dbm_columns(&org_id, stream).await {
        Ok(present) => present,
        Err(e) => {
            log::error!("[DbMonitoring] activity schema read failed for {org_id}/{stream}: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    let sql = build_dbm_events_sql(
        stream,
        server_vantage::KIND_ACTIVITY,
        start_time,
        end_time,
        &preds,
        limit,
        &present,
    );
    let rows = match run_events_search(&org_id, stream, sql, start_time, end_time).await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[DbMonitoring] activity read failed for {org_id}/{stream}: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };
    let row_count = rows.len();
    let hits: Vec<Value> = rows.iter().map(activity_row_to_dto).collect();

    // ── the aggregates, from SQL over the WHOLE window ────────────────────
    let by_wait_event = match build_dbm_activity_breakdown_sql(
        stream,
        server_vantage::O2_DBM_WAIT_EVENT_TYPE,
        Some(server_vantage::O2_DBM_WAIT_EVENT),
        start_time,
        end_time,
        &preds,
        &present,
    ) {
        Some(sql) => wait_event_breakdown(
            &run_events_search(&org_id, stream, sql, start_time, end_time)
                .await
                .unwrap_or_default(),
        ),
        None => Vec::new(),
    };
    let by_state = match build_dbm_activity_breakdown_sql(
        stream,
        server_vantage::O2_DBM_SESSION_STATE,
        None,
        start_time,
        end_time,
        &preds,
        &present,
    ) {
        Some(sql) => state_breakdown(
            &run_events_search(&org_id, stream, sql, start_time, end_time)
                .await
                .unwrap_or_default(),
        ),
        None => Vec::new(),
    };

    // The probe runs UNCONDITIONALLY here, unlike the deadlocks/blocking
    // template which computes it only on an empty tab.
    //
    // That template is right for a rare EVENT and wrong for a continuous 10s
    // POLL: `sample_interval_seconds` is the disclosure that this page is
    // sampled rather than live, so gating it on emptiness would state the
    // page's fidelity only when there were no sessions to state it about —
    // inverting the honesty requirement exactly. Named `interval_probe` because
    // it is read for the interval whether or not the tab is empty.
    let mut interval_probe = probe_collection(
        &org_id,
        stream,
        server_vantage::KIND_ACTIVITY,
        start_time,
        end_time,
        &preds,
    )
    .await;
    // Recover the poll spacing from a DISTINCT query rather than from the shared
    // probe's row scan: activity writes one row per session per poll, so 2000
    // scanned rows can be a single poll on a busy instance and the interval
    // would read null exactly where the disclosure matters most.
    if let Ok(times) = run_events_search(
        &org_id,
        stream,
        build_dbm_sample_times_sql(
            stream,
            server_vantage::KIND_ACTIVITY,
            start_time,
            end_time,
            &preds,
        ),
        start_time,
        end_time,
    )
    .await
        && !times.is_empty()
    {
        let mut ts: Vec<i64> = times.iter().map(|r| get_i64(r, "_timestamp")).collect();
        ts.sort_unstable_by(|a, b| b.cmp(a));
        ts.dedup();
        interval_probe.kind_sample_times = ts;
    }

    MetaHttpResponse::json(json!({
        // A SAMPLE of sessions, not the population — the breakdowns below are
        // the population. `truncated` says whether this sample hit its cap.
        "hits": hits,
        "sampled_sessions": true,
        "by_wait_event": by_wait_event,
        "by_state": by_state,
        "total": hits.len(),
        // Measured on the ROW query, independently of the aggregates: the
        // aggregates carry no LIMIT and so are never truncated, and reading
        // `truncated` off them would report a capped sample as complete.
        "truncated": row_count >= limit,
        "stream": stream,
        // ── collection diagnostics (empty state) ──────────────────────────
        "not_collecting": hits.is_empty() && interval_probe.not_collecting(),
        "log_lines_seen": interval_probe.log_lines_seen(),
        "sampled_at": interval_probe.newest_record,
        // The honesty requirement: how often the collector actually polls,
        // inferred from the spacing of observed samples. Null when too few
        // samples to infer, and the UI falls back to non-numeric copy.
        "sample_interval_seconds": interval_probe.sample_interval_seconds(),
        "freshness": event_freshness(&interval_probe),
    }))
}

// ─── W3.4 · Plans read API ───────────────────────────────────────────────────
//
// **What this endpoint may and may not claim (D-H).** The plan it returns is a
// GENERIC, NULL-BOUND, ESTIMATED plan: the receiver sets
// `plan_cache_mode = force_generic_plan`, PREPAREs the statement, and EXPLAINs
// it with every bind parameter bound to literal `null`. So:
//
//   * it is not "the plan that ran" — Postgres's default `plan_cache_mode = auto` means production
//     may well have executed a CUSTOM plan;
//   * a hash CHANGE is a real signal (a dropped index or a repartition moves it);
//   * a STABLE hash is NOT an all-clear — generic plans are a pure function of (statement, schema,
//     stats) and are stable by construction, so the classic "planner flipped to a seq scan at
//     03:04" incident may never move it;
//   * LATENCY IS NEVER ATTRIBUTED TO A PLAN. Per-plan latency would come from `pg_stat_statements`
//     real executions while this plan was never executed.
//
// The response states the first point in `plan_source` so the UI cannot label it
// wrongly, and carries no latency field at all so the fourth cannot be
// reintroduced by a UI that finds the column lying around.

/// Distinct plans for one fingerprint over the window, with first/last seen.
///
/// A `GROUP BY` on the hash, not a row fetch folded in Rust: the same reasoning
/// as the activity breakdowns — a row-limited fetch presented as the set of
/// distinct plans would be a truncated sample rendered as a population.
///
/// `MAX(plan)` picks one representative document per hash. Every row sharing a
/// hash is structurally identical by construction, so which one is arbitrary and
/// they differ only in the costs the hash deliberately ignores.
///
/// Returns `None` when the stream's schema has no plan hash column. Naming an
/// absent column in a `GROUP BY` fails the WHOLE query with a schema error, and
/// the exposed case is the common one — `ZO_DB_MONITORING_TOP_QUERY_ENABLED`
/// defaults OFF (D-G), so every stream that never ingested plans has none of
/// these columns and must render an empty section rather than a 500.
/// Whether plan capture has EVER run against this stream — `"on"` or `"off"`.
///
/// Zero plans has two causes and only one of them is the reader's to fix, so
/// the response has to say which it is. `"off"`: the stream carries no plan
/// hash column, meaning nothing was ever captured — `ZO_DB_MONITORING_TOP_QUERY_ENABLED`
/// defaults OFF (D-G), and the config hint is the right thing to show.
/// `"on"`: the column exists, the query ran, and this particular statement has
/// no plan. That is a NORMAL state, not a gap — Postgres cannot `EXPLAIN` a
/// `COMMIT`, `ROLLBACK` or `SHOW`, nor an already-`EXPLAIN`ed statement, and a
/// live deployment legitimately has fingerprints with no plan for that reason.
///
/// Named for the CAPTURE PIPELINE rather than the result (`has_plans` would be
/// a restatement of `hits.is_empty()` the UI can already compute) and kept a
/// string beside `plan_source` rather than a bool, so a third state — capture
/// on but degraded — can be added without changing the field's type.
///
/// Deliberately the SAME condition `build_dbm_plans_sql` skips on: reported
/// independently the two would drift, and the UI would tell a user their
/// `COMMIT` is unplannable when in truth nothing was ever captured.
pub(crate) fn plan_capture_state(present: &HashSet<String>) -> &'static str {
    if present.contains(server_vantage::O2_DBM_PLAN_HASH) {
        "on"
    } else {
        "off"
    }
}

pub(crate) fn build_dbm_plans_sql(
    stream_name: &str,
    fingerprint: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
    present: &HashSet<String>,
) -> Option<String> {
    if !present.contains(server_vantage::O2_DBM_PLAN_HASH) {
        return None;
    }
    // Optional columns: a stream can carry the hash without the others if it was
    // written by a partially-upgraded cluster. Project only what exists.
    let plan_col = if present.contains(server_vantage::O2_DBM_PLAN) {
        format!("MAX({}) AS plan", server_vantage::O2_DBM_PLAN)
    } else {
        "NULL AS plan".to_string()
    };
    let version_col = if present.contains(server_vantage::O2_DBM_PLAN_HASH_VERSION) {
        format!(
            "MAX({}) AS plan_hash_version",
            server_vantage::O2_DBM_PLAN_HASH_VERSION
        )
    } else {
        "NULL AS plan_hash_version".to_string()
    };
    // Deliberately SUM(calls) and never any exec-time aggregate: see D-H above.
    let calls_col = if present.contains(server_vantage::O2_DBM_CALLS) {
        format!("SUM({}) AS calls", server_vantage::O2_DBM_CALLS)
    } else {
        "0 AS calls".to_string()
    };
    Some(format!(
        "SELECT {hash} AS plan_hash, {plan_col}, {version_col}, {calls_col}, \
         MIN(_timestamp) AS first_seen, MAX(_timestamp) AS last_seen \
         FROM \"{stream}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    \
         AND {kind} = '{kind_val}'\n    AND {fp} = '{fp_val}'{preds}\nGROUP BY {hash}\n\
         ORDER BY last_seen DESC",
        hash = server_vantage::O2_DBM_PLAN_HASH,
        stream = escape_ident(stream_name),
        kind = server_vantage::O2_DBM_KIND,
        kind_val = escape_sq(server_vantage::KIND_TOP_QUERY),
        fp = server_vantage::O2_DBM_FINGERPRINT,
        fp_val = escape_sq(fingerprint),
    ))
}

/// One distinct plan, in WIRE names.
///
/// Storage names never reach the browser (the contract documented at the
/// hand-built `json!` convention above). Carries NO latency field — see D-H.
///
/// **No call SHARE either (W2).** `calls` is `SUM(o2_dbm_calls)` over a DELTA
/// feed whose first emission per statement carries the entire
/// `pg_stat_statements` backlog — 19,687 calls where every subsequent emission
/// carries ~2. A window containing one first emission, or a re-registration
/// after LRU eviction, has its denominator inflated by a whole backlog, so any
/// share computed from it is a proportion of a total that never described the
/// window. No arithmetic recovers a true count from a feed like this, so the
/// share is absent rather than approximated.
fn plan_row_to_dto(row: &Value) -> Value {
    let calls = get_i64(row, "calls");
    json!({
        "plan_hash": row.get("plan_hash").and_then(Value::as_str),
        // The PARSED tree, so the UI renders a structure rather than re-parsing
        // a string. Malformed input reads as absent rather than failing the
        // read — a bad plan must never break a page that would otherwise work.
        "plan": server_vantage::plan_of(&json!({
            server_vantage::O2_DBM_PLAN: row.get("plan").cloned().unwrap_or(Value::Null)
        }))
        .unwrap_or(Value::Null),
        "plan_hash_version": row.get("plan_hash_version").and_then(Value::as_i64),
        "first_seen": get_i64(row, "first_seen"),
        "last_seen": get_i64(row, "last_seen"),
        "calls": calls,
    })
}

// ─── W6 · server-side query metrics ──────────────────────────────────────────
//
// The database's OWN account of a statement — `pg_stat_statements` /
// `events_statements_summary_by_digest` — beside the client-observed latency
// the rest of the query page is built from. Two vantages, deliberately kept in
// two separate blocks: the client sees only instrumented callers and measures
// round-trip; the server sees every client and measures in-engine work.
//
// **The join is (engine, database, fingerprint). `instance` is NOT in the key.**
// Measured behind PgBouncer: the client records `o2_db_instance = "pgbouncer"`
// while the server records `o2_dbm_instance = "postgres"`. Instance agreement
// is 16/16 with no pooler and 3/9 with one, so an instance-keyed join fails
// EVERY Postgres match behind a pooler — the topology the product already ships
// a `pooler` unmatched-reason for. The price is that two instances sharing a
// database name are indistinguishable, and `server_metrics_envelope` refuses to
// pick one rather than attributing the wrong instance's counters silently.
//
// **The join is permanently PARTIAL and that is the normal case.** Same-engine
// fingerprint convergence measures 43% (Postgres) and 56% (MySQL). The dominant
// cause is not a defect: the server legitimately sees statements no instrumented
// client issued — the collector's own `pg_stat_activity` polls, `BEGIN`, `SHOW
// server_version`. The set of statements visible ONLY client-side is empty. A
// secondary real divergence is that `pg_stat_statements` collapses the parameter
// list and re-spaces tokens, which no normalizer change chases down: the
// normalizer is a hot path and FP_VERSION-pinned.

/// Whether server-side counters have EVER been captured on this stream —
/// `"on"` or `"off"`.
///
/// Zero server metrics has two causes and only one is the reader's to fix, so
/// the response has to say which it is. `"off"`: the stream carries no counter
/// column, meaning nothing was ever captured —
/// `ZO_DB_MONITORING_TOP_QUERY_ENABLED` defaults OFF — and the config hint is
/// the right thing to show. `"on"`: the columns exist, the query ran, and this
/// particular statement has no server counterpart. That is a NORMAL state given
/// the partial join above, not a gap.
///
/// Named for the CAPTURE PIPELINE rather than the result (`has_server_metrics`
/// would restate `matched` the UI can already read) and kept a string rather
/// than a bool, so a third state — capture on but degraded — can be added
/// without changing the field's type.
///
/// Deliberately the SAME condition `build_dbm_server_metrics_sql` skips on:
/// reported independently the two would drift, and the UI would tell a user
/// their capture is off while the query it gates ran fine.
pub(crate) fn server_metrics_capture_state(present: &HashSet<String>) -> &'static str {
    if present.contains(server_vantage::O2_DBM_CALLS) {
        "on"
    } else {
        "off"
    }
}

/// Server-side counters for one fingerprint, one row PER INSTANCE.
///
/// Grouped by instance rather than pre-aggregated across instances: the
/// ambiguity guard needs to COUNT candidates, and a query that sums across them
/// has already destroyed the evidence it would need.
///
/// `None` when the stream carries no counter columns — naming an absent column
/// fails the whole query with a schema error, and the exposed case is the
/// common one (top-query capture defaults OFF).
#[allow(clippy::too_many_arguments)]
pub(crate) fn build_dbm_server_metrics_sql(
    stream_name: &str,
    engine: &str,
    database: &str,
    fingerprint: &str,
    start_time: i64,
    end_time: i64,
    present: &HashSet<String>,
) -> Option<String> {
    if !present.contains(server_vantage::O2_DBM_CALLS) {
        return None;
    }
    // Optional columns: a partially-upgraded cluster can carry calls without
    // the rest. Project only what exists — MySQL's top_query ships no row or
    // block counters at all, so this is the ordinary case rather than an edge.
    let optional = |col: &str, alias: &str| -> String {
        if present.contains(col) {
            format!("SUM({col}) AS {alias}")
        } else {
            format!("NULL AS {alias}")
        }
    };
    let cols = [
        optional(server_vantage::O2_DBM_ROWS, "rows"),
        optional(server_vantage::O2_DBM_EXEC_TIME_S, "exec_time_s"),
        optional(server_vantage::O2_DBM_SHARED_BLKS_HIT, "shared_blks_hit"),
        optional(server_vantage::O2_DBM_SHARED_BLKS_READ, "shared_blks_read"),
        optional(
            server_vantage::O2_DBM_SHARED_BLKS_DIRTIED,
            "shared_blks_dirtied",
        ),
        optional(
            server_vantage::O2_DBM_SHARED_BLKS_WRITTEN,
            "shared_blks_written",
        ),
        optional(server_vantage::O2_DBM_TEMP_BLKS_READ, "temp_blks_read"),
        optional(
            server_vantage::O2_DBM_TEMP_BLKS_WRITTEN,
            "temp_blks_written",
        ),
    ]
    .join(", ");

    // NOTE the absent instance predicate: see the module note above. The
    // instance is SELECTed and GROUPed (display + ambiguity detection) but
    // never constrained, or every match behind a pooler is lost.
    Some(format!(
        "SELECT {inst} AS instance, SUM({calls}) AS calls, {cols}, \
         MIN(_timestamp) AS first_seen, MAX(_timestamp) AS last_seen \
         FROM \"{stream}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    \
         AND {kind} = '{kind_val}'\n    AND {fp} = '{fp_val}'\n    \
         AND {eng} = '{eng_val}'\n    AND {db} = '{db_val}'\nGROUP BY {inst}\n\
         ORDER BY calls DESC",
        inst = server_vantage::O2_DBM_INSTANCE,
        calls = server_vantage::O2_DBM_CALLS,
        stream = escape_ident(stream_name),
        kind = server_vantage::O2_DBM_KIND,
        kind_val = escape_sq(server_vantage::KIND_TOP_QUERY),
        fp = server_vantage::O2_DBM_FINGERPRINT,
        fp_val = escape_sq(fingerprint),
        eng = server_vantage::O2_DBM_ENGINE,
        eng_val = escape_sq(engine),
        db = server_vantage::O2_DBM_DATABASE,
        db_val = escape_sq(database),
    ))
}

/// What `o2_dbm_exec_time_s` actually MEASURED, per engine.
///
/// `server_vantage.rs:1838-1844` folds Postgres `total_exec_time` (time spent
/// EXECUTING) and MySQL `sum_timer_wait` (time spent WAITING) into one storage
/// field. They are two different measurements, and a header that calls the
/// MySQL one "execution time" attributes a measurement to a thing it did not
/// measure. The wire states which it is so the UI cannot mislabel it.
fn exec_time_kind(engine: &str) -> &'static str {
    if engine.eq_ignore_ascii_case("mysql") || engine.eq_ignore_ascii_case("mariadb") {
        "wait"
    } else {
        "execution"
    }
}

/// The server-metrics response envelope.
///
/// A callable fn rather than an inline `json!` in the handler, so the shape is
/// tested for real instead of scraped out of the handler's source text.
///
/// Three distinct absence states, because each names a different fix and none
/// may collapse into a generic "no data":
///   - `capture == "off"` — nothing was ever captured; the collector hint applies.
///   - matched == false with no reason — capture ran and this statement has no server counterpart.
///     NORMAL (the join is permanently partial), not an error.
///   - `unmatched_reason == "pooler"` — MORE THAN ONE candidate instance. The join deliberately
///     omits `instance`, so two instances sharing a database name are indistinguishable; picking
///     one would silently attribute another instance's counters to this query. The numbers are
///     WITHHELD and the candidates named, reusing the shipped unmatched vocabulary.
///
/// Carries NO client/server difference figure: subtracting a server mean from a
/// client percentile, over different populations, over windows that do not even
/// align (the client rollup is keyed on window-END, these reads on raw event
/// time), is arithmetic on incomparable quantities.
pub(crate) fn server_metrics_envelope(
    rows: &[Value],
    engine: &str,
    stream: &str,
    capture: &str,
) -> Value {
    let base = json!({
        "stream": stream,
        "server_metrics_capture": capture,
        // What the folded exec-time field measured on THIS engine, so the
        // header can name it rather than guessing.
        "exec_time_kind": exec_time_kind(engine),
    });
    let mut env = base.as_object().cloned().unwrap_or_default();

    // More than one candidate instance: refuse to pick. See the doc comment.
    if rows.len() > 1 {
        let candidates: Vec<Value> = rows
            .iter()
            .map(|r| json!(rollup::get_str(r, "instance")))
            .collect();
        env.insert("matched".into(), json!(false));
        env.insert("unmatched_reason".into(), json!("pooler"));
        env.insert("candidate_instances".into(), json!(candidates));
        return Value::Object(env);
    }

    let Some(row) = rows.first() else {
        env.insert("matched".into(), json!(false));
        return Value::Object(env);
    };

    let calls = rollup::get_i64(row, "calls");
    let exec_time_s = row.get("exec_time_s").and_then(Value::as_f64);
    // The MEAN, and never a percentile: `pg_stat_statements` accumulates a
    // total and a count, so a quotient is the only central tendency this feed
    // can support. Naming it p95 would be a fabrication.
    let mean_exec_time_s = match (exec_time_s, calls) {
        (Some(total), c) if c > 0 => json!(total / c as f64),
        _ => Value::Null,
    };

    let opt_i64 = |key: &str| -> Value {
        match row.get(key) {
            Some(Value::Number(_)) => json!(rollup::get_i64(row, key)),
            _ => Value::Null,
        }
    };

    env.insert("matched".into(), json!(true));
    env.insert("instance".into(), json!(rollup::get_str(row, "instance")));
    env.insert("calls".into(), json!(calls));
    env.insert("rows".into(), opt_i64("rows"));
    env.insert("exec_time_s".into(), json!(exec_time_s));
    env.insert("mean_exec_time_s".into(), mean_exec_time_s);
    env.insert("shared_blks_hit".into(), opt_i64("shared_blks_hit"));
    env.insert("shared_blks_read".into(), opt_i64("shared_blks_read"));
    env.insert("shared_blks_dirtied".into(), opt_i64("shared_blks_dirtied"));
    env.insert("shared_blks_written".into(), opt_i64("shared_blks_written"));
    env.insert("temp_blks_read".into(), opt_i64("temp_blks_read"));
    env.insert("temp_blks_written".into(), opt_i64("temp_blks_written"));
    env.insert("first_seen".into(), opt_i64("first_seen"));
    env.insert("last_seen".into(), opt_i64("last_seen"));
    Value::Object(env)
}

#[derive(Debug, Deserialize)]
pub struct ServerMetricsQuery {
    pub fingerprint: Option<String>,
    pub engine: Option<String>,
    pub database: Option<String>,
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
}

/// GET /{org_id}/traces/db_monitoring/query/server_metrics — W6.
///
/// The database's own counters for one fingerprint, to sit BESIDE (never
/// merged into) the client-observed latency on the query detail page.
///
/// A sibling of `/query/plans` rather than a field on `/queries`: `/queries`
/// reads the `_o2_db_stats` rollup AND live trace tails under
/// `StreamType::Traces` auth, and folding a Logs-auth server source into it
/// would put three provenances under two auth models in one response.
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/query/server_metrics",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueryServerMetrics",
    summary = "Database Monitoring: server-side counters for a query",
    description = "The database's OWN counters (pg_stat_statements / events_statements_summary_by_digest) for one query fingerprint, joined on (engine, database, fingerprint). Reports a MEAN and never a percentile, and withholds numbers when more than one instance is a candidate.",
    security(("Authorization" = [])),
)]
pub async fn get_dbm_query_server_metrics(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<ServerMetricsQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let Some(fingerprint) = q.fingerprint.as_deref().filter(|f| !f.is_empty()) else {
        return MetaHttpResponse::bad_request("fingerprint is required");
    };
    let Some(engine) = q.engine.as_deref().filter(|e| !e.is_empty()) else {
        return MetaHttpResponse::bad_request("engine is required");
    };
    // The database is part of the join key, so an absent one cannot be defaulted
    // — an empty predicate would match every database and attribute the wrong
    // one's counters. MySQL top_query carries no `db.namespace` at all, so this
    // legitimately 400s for MySQL rather than inventing a database.
    let Some(database) = q.database.as_deref().filter(|d| !d.is_empty()) else {
        return MetaHttpResponse::bad_request("database is required");
    };
    // Defaults, like `/query/plans`: these are server-vantage records in the
    // single shared LOGS stream. Requiring it would make the UI hardcode a
    // backend constant to reach its own endpoint.
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    // Checked BEFORE the range parsing, so a caller cannot probe stream
    // existence through error-message differences. A LOGS stream — these are
    // server-vantage records, and `StreamType::Traces` (which the
    // client-vantage endpoints correctly use) would consult the wrong OFGA
    // object and silently authorize.
    if !can_read_stream(&org_id, &user_email.user_id, stream, StreamType::Logs).await {
        return unauthorized_response();
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }

    // A failed schema read is reported, never absorbed into an empty set — an
    // empty set drops the projection and the page reports a healthy collector
    // as broken. See `present_dbm_columns`.
    let present = match present_dbm_columns(&org_id, stream).await {
        Ok(present) => present,
        Err(e) => {
            log::error!(
                "[DbMonitoring] server metrics schema read failed for {org_id}/{stream}: {e}"
            );
            return MetaHttpResponse::internal_error(e);
        }
    };

    let rows = match build_dbm_server_metrics_sql(
        stream,
        engine,
        database,
        fingerprint,
        start_time,
        end_time,
        &present,
    ) {
        Some(sql) => match run_events_search(&org_id, stream, sql, start_time, end_time).await {
            Ok(rows) => rows,
            Err(e) => {
                log::error!("[DbMonitoring] server metrics read failed for {org_id}/{stream}: {e}");
                return MetaHttpResponse::internal_error(e);
            }
        },
        // The stream has never carried server counters — an empty section, not
        // an error.
        None => Vec::new(),
    };

    MetaHttpResponse::json(server_metrics_envelope(
        &rows,
        engine,
        stream,
        server_metrics_capture_state(&present),
    ))
}

#[derive(Debug, Deserialize)]
pub struct PlansQuery {
    pub fingerprint: Option<String>,
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
}

/// GET /{org_id}/traces/db_monitoring/query/plans — W3.4.
///
/// Distinct generic plans captured for one fingerprint over the window. See the
/// module comment above for what this data is and is not.
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/query/plans",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueryPlans",
    summary = "Database Monitoring: captured query plans for a query",
    description = "Distinct GENERIC, NULL-BOUND EXPLAIN plans captured for one query fingerprint, with first and last seen. Not the plan Postgres executed, and carries no per-plan latency.",
    security(("Authorization" = [])),
)]
pub async fn get_dbm_query_plans(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<PlansQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let Some(fingerprint) = q.fingerprint.as_deref().filter(|f| !f.is_empty()) else {
        return MetaHttpResponse::bad_request("fingerprint is required");
    };
    // The stream DEFAULTS, unlike `get_dbm_query_endpoints` which this handler
    // otherwise mirrors: that one aggregates a caller-chosen TRACE stream, while
    // plans are server-vantage records in the single shared LOGS stream that
    // deadlocks, blocking and activity all read. Requiring it would make the UI
    // hardcode a backend constant to reach its own endpoint.
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    // Checked BEFORE the range parsing, so a caller cannot probe stream
    // existence through error-message differences. A LOGS stream — these are
    // server-vantage records, and `StreamType::Traces` here (as the endpoints
    // handler this mirrors uses) would consult the wrong OFGA object and
    // silently authorize.
    if !can_read_stream(&org_id, &user_email.user_id, stream, StreamType::Logs).await {
        return unauthorized_response();
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }

    // A failed schema read is reported, never absorbed into an empty set — an
    // empty set drops the projection and the page reports a healthy collector as
    // broken. See `present_dbm_columns`.
    let present = match present_dbm_columns(&org_id, stream).await {
        Ok(present) => present,
        Err(e) => {
            log::error!("[DbMonitoring] plans schema read failed for {org_id}/{stream}: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    let rows = match build_dbm_plans_sql(stream, fingerprint, start_time, end_time, "", &present) {
        Some(sql) => match run_events_search(&org_id, stream, sql, start_time, end_time).await {
            Ok(rows) => rows,
            Err(e) => {
                log::error!("[DbMonitoring] plans read failed for {org_id}/{stream}: {e}");
                return MetaHttpResponse::internal_error(e);
            }
        },
        // The stream has never carried plans — an empty section, not an error.
        None => Vec::new(),
    };

    let hits: Vec<Value> = rows.iter().map(plan_row_to_dto).collect();

    MetaHttpResponse::json(json!({
        "hits": hits,
        "stream": stream,
        // The honesty contract, stated by the API so the UI cannot mislabel it.
        // `generic_null_bound` is what the plan IS: EXPLAINed under
        // force_generic_plan with every parameter bound to NULL, never executed.
        "plan_source": "generic_null_bound",
        // Which of the TWO causes of an empty `hits` this is. `off` means the
        // stream never carried a plan hash column, so nothing ever looked and
        // the collector hint is the right advice. `on` means capture ran and
        // this statement simply has no plan — Postgres cannot EXPLAIN a
        // COMMIT, ROLLBACK or SHOW. Without this the UI can only render one
        // sentence for both and tells a DBA whose capture is already running
        // to go switch it on.
        "plan_capture": plan_capture_state(&present),
        // More than one distinct plan in the window. Named `drift_detected`
        // rather than `plan_changed` deliberately: this detects STRUCTURAL DRIFT
        // in the generic plan, and its absence is NOT evidence that no plan
        // regression occurred — the custom plan Postgres actually ran is not
        // observed here at all.
        "drift_detected": hits.len() > 1,
        "total": hits.len(),
    }))
}

// ─── W10 · Table health read API ─────────────────────────────────────────────
//
// One row per RELATION, from the `pg_table_stats` feed. See
// `server_vantage::KIND_TABLE_STATS` for what this data is; the two properties
// that bind this module are that the scan/vacuum counters are LIFETIME totals
// and the tuple counts are PLANNER ESTIMATES, both re-stated on the response
// envelope so the UI cannot mislabel what it renders.

/// Which engines this signal is collected for.
///
/// `pg_table_stats` queries `pg_class`/`pg_stat_user_tables`, which exist only
/// on Postgres. MySQL, MariaDB and SQL Server expose schema statistics through
/// entirely different catalogs that no shipped recipe reads.
///
/// This exists so the UI can distinguish "no tables have problems" from "this
/// signal was never collected for your engine". Rendering an empty table for a
/// MySQL user is the single most dangerous empty state the feature can produce:
/// it reads as an all-clear about a check that never ran.
///
/// `""` (no engine filter) answers `unknown` rather than guessing: an unfiltered
/// request spans every engine in the fleet, so no single verdict is true of it.
pub(crate) fn table_health_engine_support(engine: &str) -> &'static str {
    match engine {
        "postgresql" => "supported",
        "" => "unknown",
        // Named negatively rather than by an allowlist of the three we know:
        // a fourth engine with no recipe is also unsupported, and defaulting a
        // stranger to `unknown` would render the ambiguous empty state for an
        // engine we are certain about.
        _ => "unsupported",
    }
}

/// The newest snapshot of every relation in the window.
///
/// **A GROUP BY, never a row fetch folded in Rust.** The recipe re-emits every
/// table every 60 s, so an hour's window holds ~60 rows per table and a raw
/// fetch would render the same table sixty times — making "the 20 largest
/// tables" a list of one table repeated.
///
/// **`MAX`, never `SUM` or `AVG`.** Every measurement here is a point-in-time
/// state of a relation. Summing sixty snapshots of a 13 MB table reports a
/// 780 MB table; averaging a cumulative counter across a window in which it grew
/// reports a number that was true at no instant. `MAX` is honest for both cases
/// at once: it is the latest value for a size that fluctuates, and the latest
/// value for a lifetime counter that only rises.
///
/// Returns `None` when the stream's schema lacks the relation column — naming an
/// absent column in a `GROUP BY` fails the WHOLE query with a schema error, and
/// the exposed case is the common one: no deployment has shipped this recipe
/// yet.
pub(crate) fn build_dbm_table_health_sql(
    stream_name: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
    limit: usize,
    present: &HashSet<String>,
) -> Option<String> {
    if !present.contains(server_vantage::O2_DBM_RELATION)
        || !present.contains(server_vantage::O2_DBM_SCHEMA)
    {
        return None;
    }
    // Optional columns: a partially-upgraded cluster can have written the
    // relation without the rest. Project only what exists, so one missing
    // column degrades a cell instead of failing the page.
    let mut cols = Vec::new();
    for (storage, wire) in [
        (server_vantage::O2_DBM_TOTAL_BYTES, "total_bytes"),
        (server_vantage::O2_DBM_HEAP_BYTES, "heap_bytes"),
        (server_vantage::O2_DBM_LIVE_TUPLES, "live_tuples"),
        (server_vantage::O2_DBM_DEAD_TUPLES, "dead_tuples"),
        (server_vantage::O2_DBM_DEAD_TUP_PCT, "dead_tup_pct"),
        (
            server_vantage::O2_DBM_MOD_SINCE_ANALYZE,
            "mod_since_analyze",
        ),
        (server_vantage::O2_DBM_SEQ_SCAN_COUNT, "seq_scan_count"),
        (server_vantage::O2_DBM_SEQ_TUP_READ, "seq_tup_read"),
        (server_vantage::O2_DBM_IDX_SCAN_COUNT, "idx_scan_count"),
        (server_vantage::O2_DBM_AUTOVACUUM_COUNT, "autovacuum_count"),
        (server_vantage::O2_DBM_FROZEN_XID_AGE, "frozen_xid_age"),
        (server_vantage::O2_DBM_LAST_VACUUM, "last_vacuum"),
        (server_vantage::O2_DBM_LAST_AUTOVACUUM, "last_autovacuum"),
        (server_vantage::O2_DBM_LAST_ANALYZE, "last_analyze"),
        (server_vantage::O2_DBM_INSTANCE, "instance"),
        (server_vantage::O2_DBM_ENGINE, "engine"),
    ] {
        if present.contains(storage) {
            cols.push(format!("MAX({storage}) AS {wire}"));
        } else {
            cols.push(format!("NULL AS {wire}"));
        }
    }
    let projected = cols.join(", ");
    Some(format!(
        "SELECT {schema} AS schema_name, {relation} AS relation, {projected}, \
         MAX(_timestamp) AS last_seen FROM \"{stream}\"\n\
         WHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    \
         AND {kind} = '{kind_val}'{preds}\n\
         GROUP BY {schema}, {relation}\n\
         ORDER BY total_bytes DESC NULLS LAST\nLIMIT {limit}",
        schema = server_vantage::O2_DBM_SCHEMA,
        relation = server_vantage::O2_DBM_RELATION,
        stream = escape_ident(stream_name),
        kind = server_vantage::O2_DBM_KIND,
        kind_val = escape_sq(server_vantage::KIND_TABLE_STATS),
    ))
}

/// One relation's health, in WIRE names.
///
/// Storage names never reach the browser. Every counter carries its honesty
/// qualifier on the RESPONSE ENVELOPE rather than per-row: the flags are
/// properties of the feed, not of a table, and repeating them on every row
/// would invite a reader to assume a row without them is exact.
fn table_health_row_to_dto(row: &Value) -> Value {
    // Rows arrive from two shapes: the SQL aggregate above (wire aliases) and,
    // in tests, the canonicalizer's own output (storage names). Reading both
    // keeps the writer/reader loop closeable — a DTO that only understood the
    // aggregate could not be fed the canonicalizer's output, which is the one
    // test that catches a write/read name split.
    let pick = |wire: &str, storage: &str| -> Value {
        match row.get(wire) {
            Some(v) if !v.is_null() => v.clone(),
            _ => row.get(storage).cloned().unwrap_or(Value::Null),
        }
    };
    let int = |wire: &str, storage: &str| -> Value {
        match server_vantage::as_i64_loose(&pick(wire, storage)) {
            Some(n) => json!(n),
            None => Value::Null,
        }
    };
    let text = |wire: &str, storage: &str| -> Value {
        match pick(wire, storage) {
            Value::String(s) if !s.is_empty() => json!(s),
            _ => Value::Null,
        }
    };
    json!({
        "relation": text("relation", server_vantage::O2_DBM_RELATION),
        "schema": text("schema_name", server_vantage::O2_DBM_SCHEMA),
        "instance": text("instance", server_vantage::O2_DBM_INSTANCE),
        "engine": text("engine", server_vantage::O2_DBM_ENGINE),
        "total_bytes": int("total_bytes", server_vantage::O2_DBM_TOTAL_BYTES),
        "heap_bytes": int("heap_bytes", server_vantage::O2_DBM_HEAP_BYTES),
        // ESTIMATES — see `tuples_are_estimated` on the envelope.
        "live_tuples": int("live_tuples", server_vantage::O2_DBM_LIVE_TUPLES),
        "dead_tuples": int("dead_tuples", server_vantage::O2_DBM_DEAD_TUPLES),
        "dead_tup_pct": as_f64_loose(&pick("dead_tup_pct", server_vantage::O2_DBM_DEAD_TUP_PCT)),
        "mod_since_analyze": int("mod_since_analyze", server_vantage::O2_DBM_MOD_SINCE_ANALYZE),
        // LIFETIME totals — see `counters_are_cumulative` on the envelope.
        "seq_scan_count": int("seq_scan_count", server_vantage::O2_DBM_SEQ_SCAN_COUNT),
        "seq_tup_read": int("seq_tup_read", server_vantage::O2_DBM_SEQ_TUP_READ),
        "idx_scan_count": int("idx_scan_count", server_vantage::O2_DBM_IDX_SCAN_COUNT),
        "autovacuum_count": int("autovacuum_count", server_vantage::O2_DBM_AUTOVACUUM_COUNT),
        "frozen_xid_age": int("frozen_xid_age", server_vantage::O2_DBM_FROZEN_XID_AGE),
        // `null` means NEVER, not "unknown" — the recipe COALESCEs a null
        // vacuum time to `''` and canonicalization drops the empty string.
        "last_vacuum": text("last_vacuum", server_vantage::O2_DBM_LAST_VACUUM),
        "last_autovacuum": text("last_autovacuum", server_vantage::O2_DBM_LAST_AUTOVACUUM),
        "last_analyze": text("last_analyze", server_vantage::O2_DBM_LAST_ANALYZE),
        "last_seen": int("last_seen", server_vantage::O2_DBM_TIMESTAMP),
    })
}

#[derive(Debug, Deserialize)]
pub struct TableHealthQuery {
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub system: Option<String>,
    pub instance: Option<String>,
    pub limit: Option<usize>,
}

/// GET /{org_id}/traces/db_monitoring/table_health — W10.
///
/// The newest snapshot of every relation in the window, largest first.
///
/// Two disclosures ride on the envelope because the UI cannot phrase them
/// correctly otherwise: the scan and vacuum counters are LIFETIME totals since
/// the last `pg_stat_reset()` (not per-window counts), and the tuple figures are
/// PLANNER ESTIMATES (not exact counts).
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/table_health",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringTableHealth",
    summary = "Database Monitoring: table size, bloat and vacuum state",
    description = "Newest snapshot per relation from the Postgres pg_table_stats feed. Scan and vacuum counters are LIFETIME totals since the last statistics reset; tuple counts and bloat percentage are planner estimates. Postgres only.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default 'dbm_server')"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("limit" = Option<usize>, Query, description = "Max relations returned (default 100)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_table_health(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<TableHealthQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    // Checked BEFORE the range parsing, so a caller cannot probe stream
    // existence through error-message differences. A LOGS stream — these are
    // server-vantage records, and `StreamType::Traces` here would consult the
    // wrong OFGA object and silently authorize.
    if !can_read_stream(&org_id, &user_email.user_id, stream, StreamType::Logs).await {
        return unauthorized_response();
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .clamp(1, MAX_EVENTS_LIMIT);
    // No `database` filter: this feed carries no database (see
    // `server_vantage::O2_DBM_SCHEMA`), so accepting one would silently return
    // nothing for every value a user could pass.
    let preds = dbm_event_preds(q.system.as_deref(), q.instance.as_deref(), None);

    // A failed schema read is reported, never absorbed into an empty set — an
    // empty set drops the projection and the page would report a healthy
    // collector as broken. See `present_dbm_columns`.
    let present = match present_dbm_columns(&org_id, stream).await {
        Ok(present) => present,
        Err(e) => {
            log::error!(
                "[DbMonitoring] table health schema read failed for {org_id}/{stream}: {e}"
            );
            return MetaHttpResponse::internal_error(e);
        }
    };

    let rows =
        match build_dbm_table_health_sql(stream, start_time, end_time, &preds, limit, &present) {
            Some(sql) => {
                match run_events_search(&org_id, stream, sql, start_time, end_time).await {
                    Ok(rows) => rows,
                    Err(e) => {
                        log::error!(
                            "[DbMonitoring] table health read failed for {org_id}/{stream}: {e}"
                        );
                        return MetaHttpResponse::internal_error(e);
                    }
                }
            }
            // The stream has never carried table stats — an empty section, not an
            // error.
            None => Vec::new(),
        };

    let hits: Vec<Value> = rows.iter().map(table_health_row_to_dto).collect();

    MetaHttpResponse::json(json!({
        "hits": hits,
        "stream": stream,
        "total": hits.len(),
        // ── the honesty contract, stated by the API ───────────────────────
        //
        // `seq_scan`, `idx_scan` and `autovacuum_count` come from
        // `pg_stat_user_tables` and count from the last `pg_stat_reset()` — a
        // point in time this feed never observes. Rendering them under a window
        // filter as "in the last hour" is a strictly stronger claim than the
        // data supports. We disclose rather than delta: a delta needs two
        // snapshots and a guarantee no reset happened between them, and a reset
        // makes the later value smaller, so a naive subtraction renders a
        // negative scan count.
        "counters_are_cumulative": true,
        // `n_live_tup`/`n_dead_tup` are statistics-collector estimates
        // reconciled against `reltuples` at ANALYZE, not a COUNT(*), and can be
        // arbitrarily stale on an un-analyzed table (which `mod_since_analyze`
        // on the same row quantifies). Sizes are exact by contrast, hence one
        // flag about TUPLES rather than a blanket one.
        "tuples_are_estimated": true,
        // Whether this signal is collected for the filtered engine at all.
        // Without it a MySQL user sees an empty table and reads it as "no
        // problems found" — an all-clear about a check that never ran.
        "engine_coverage": table_health_engine_support(q.system.as_deref().unwrap_or("")),
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// Every canonical column present — the schema-complete case. Builders are
    /// pure, so the schema lookup itself is exercised at the handler level.
    fn all_cols() -> HashSet<String> {
        server_vantage::ALL_DBM_FIELDS
            .into_iter()
            .map(str::to_string)
            .collect()
    }

    // ── Stream RBAC ─────────────────────────────────────────────────────────

    /// On OSS there is no OFGA to consult, so `can_read_stream` must pass
    /// everything through — DBM's documented OSS posture is org-level
    /// visibility (FRD NFR-6). Denying here would break the feature on the
    /// build where it cannot be configured, rather than secure it.
    ///
    /// The enterprise arm is exercised against a live OFGA store in the
    /// enterprise test suite; what matters at this layer is that the OSS
    /// behaviour is an explicit decision rather than an accident of the stub
    /// returning `false`.
    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn can_read_stream_is_permissive_on_oss() {
        assert!(
            can_read_stream(
                "org",
                "someone@example.com",
                "any_stream",
                StreamType::Traces
            )
            .await,
            "OSS builds must not deny DBM reads"
        );
        assert!(
            can_read_stream("org", "", "any_stream", StreamType::Logs).await,
            "even an empty user resolves permissively on OSS"
        );
    }

    /// The explicit `?stream=` gate must run BEFORE the history backfill.
    ///
    /// `get_dbm_query_history` takes `backfill_stream` from the caller's
    /// `?stream=` and runs up to `HISTORY_BACKFILL_MAX_WINDOWS` raw-span
    /// aggregations through `rollup::run_dbm_search` with `user_id: None`. The
    /// `involved_streams` gate catches the same param, but it used to be the ONLY
    /// gate and it runs after that loop: the 403 discards the aggregates, so
    /// nothing leaks, but the queries had already executed against another team's
    /// stream and their duration is observable. `get_dbm_query_endpoints`
    /// (`can_read_stream` at the top, before range parsing) is the pattern.
    ///
    /// Asserted on SOURCE ORDER because it cannot be asserted on behaviour here:
    /// `can_read_stream` is unconditionally permissive on OSS (see
    /// `can_read_stream_is_permissive_on_oss`), so no OSS-observable response
    /// distinguishes a gate that runs early from one that runs late. Ordering is
    /// the whole invariant, so ordering is what this pins.
    #[test]
    fn test_history_checks_stream_permission_before_backfilling() {
        let src = include_str!("api.rs");
        let handler = src
            .split("pub async fn get_dbm_query_history(")
            .nth(1)
            .expect("handler must exist")
            .split("\npub ")
            .next()
            .unwrap();

        let gate = handler
            .find("can_read_stream(")
            .expect("history must gate an explicit stream param on can_read_stream");
        let backfill = handler
            .find("rollup::run_dbm_search(")
            .expect("history must run the backfill aggregation");
        assert!(
            gate < backfill,
            "the permission gate must precede the backfill query, \
             or an unauthorized caller's stream is aggregated before the 403"
        );

        // And before range parsing, so stream existence cannot be probed through
        // the difference between a 400 and a 403 — same reason as endpoints.
        let range = handler
            .find("resolve_range(")
            .expect("history must resolve a range");
        assert!(gate < range, "gate must also precede range parsing");
    }

    // ── SQL builders: exact strings + injection safety ──────────────────────

    // ── Live tail vs the requested window ───────────────────────────────────

    /// The live tail is computed against the CLOCK, not the request. Before
    /// this gate every read merged it unconditionally, so a query for a past
    /// window came back with present data — `[now-30m, now-15m]` returned the
    /// same rows as `[now-15m, now]`, which flattened every window-over-window
    /// delta to zero and answered a question about the past with "now".
    #[test]
    fn test_tail_overlaps_requested_window() {
        // Tail [100, 200). The current window contains it.
        assert!(tail_overlaps(100, 200, 50, 250), "tail inside window");
        assert!(
            tail_overlaps(100, 200, 150, 250),
            "partial overlap at start"
        );
        assert!(tail_overlaps(100, 200, 50, 150), "partial overlap at end");

        // The previous-window case that caused the bug: window entirely before
        // the tail must NOT pick it up.
        assert!(
            !tail_overlaps(100, 200, 0, 100),
            "window ends where tail begins"
        );
        assert!(
            !tail_overlaps(100, 200, 0, 50),
            "window entirely before tail"
        );

        // ...and a window entirely after the tail.
        assert!(
            !tail_overlaps(100, 200, 200, 300),
            "window starts where tail ends"
        );
        assert!(
            !tail_overlaps(100, 200, 250, 300),
            "window entirely after tail"
        );
    }

    #[test]
    fn test_build_stats_sql_exact() {
        let sql = build_stats_sql("default", "db_totals", 100, 200, "");
        let expected = "SELECT * FROM \"_o2_db_stats\"\nWHERE _timestamp > 100 AND _timestamp <= 200\n    AND org_id = 'default'\n    AND record_type = 'db_totals'\nLIMIT 100000";
        assert_eq!(sql, expected);
    }

    #[test]
    fn test_scope_filters_sql_preds_exact() {
        let f = ScopeFilters {
            system: Some("postgresql".into()),
            service: Some("cart".into()),
            stream: Some("otel_demo".into()),
            ..Default::default()
        };
        assert_eq!(
            f.sql_preds(),
            "\n    AND db_system = 'postgresql'\n    AND service_name = 'cart'\n    AND trace_stream_name = 'otel_demo'"
        );
    }

    // Every user-controlled value is single-quote-escaped: a classic injection
    // payload must arrive neutralized (quotes doubled), keeping the literal
    // closed.
    #[test]
    fn test_scope_filters_injection_neutralized() {
        let f = ScopeFilters {
            system: Some("pg'; DROP TABLE users;--".into()),
            ..Default::default()
        };
        let preds = f.sql_preds();
        assert!(preds.contains("db_system = 'pg''; DROP TABLE users;--'"));
        assert!(!preds.contains("= 'pg';")); // the quote never closes early
    }

    #[test]
    fn test_stats_sql_org_id_escaped() {
        let sql = build_stats_sql("org'--", "query_stats", 1, 2, "");
        assert!(sql.contains("org_id = 'org''--'"));
    }

    // The queries endpoint's free-text search NEVER reaches the SQL string —
    // it is applied at merge time in Rust (it must filter the cached
    // unfiltered tail anyway), so no escaping question even arises.
    #[test]
    fn test_queries_search_text_never_in_sql() {
        let hostile = "' OR 1=1 UNION SELECT password FROM users --";
        let sql = build_queries_stats_sql("default", 1, 2, &ScopeFilters::default(), Some(hostile));
        assert!(!sql.contains("OR 1=1"));
        assert!(!sql.contains("UNION"));
        assert!(!sql.contains("password"));
    }

    #[test]
    fn test_fingerprint_pred_escaped() {
        let pred = fingerprint_pred("abc'; DELETE FROM t;--");
        assert_eq!(pred, "\n    AND fingerprint = 'abc''; DELETE FROM t;--'");
    }

    #[test]
    fn test_backfill_sql_exact_and_escaped() {
        let sql = build_backfill_sql("otel_demo", "deadbeef", 100, 200);
        assert!(sql.starts_with("SELECT\n    COUNT(*) AS calls,"));
        assert!(sql.contains("FROM \"otel_demo\"\nWHERE _timestamp >= 100 AND _timestamp < 200"));
        assert!(sql.ends_with("AND o2_db_fingerprint = 'deadbeef'"));

        // stream name is identifier-escaped, fingerprint quote-escaped
        let sql = build_backfill_sql("s\" --", "fp'x", 1, 2);
        assert!(sql.contains("FROM \"s\"\" --\""));
        assert!(sql.contains("o2_db_fingerprint = 'fp''x'"));
    }

    #[test]
    fn test_endpoints_sql_shape_and_injection() {
        let sql = build_endpoints_sql("otel_demo", "deadbeef", 100, 200, 50);
        // The compute_stream_edges self-join shape: db spans joined to trace
        // roots, time-bounded on BOTH sides, flat GROUP BY.
        assert!(sql.contains("FROM \"otel_demo\" AS dbspan"));
        assert!(sql.contains("LEFT JOIN \"otel_demo\" AS root"));
        assert!(sql.contains("ON dbspan.trace_id = root.trace_id"));
        assert!(sql.contains(
            "(root.reference_parent_span_id IS NULL OR root.reference_parent_span_id = '')"
        ));
        assert!(sql.contains("root._timestamp >= 100 AND root._timestamp < 200"));
        assert!(sql.contains("dbspan._timestamp >= 100 AND dbspan._timestamp < 200"));
        assert!(sql.contains("dbspan.o2_db_fingerprint = 'deadbeef'"));
        assert!(sql.contains("GROUP BY root.service_name, root.operation_name"));
        assert!(sql.ends_with("LIMIT 50"));

        let sql = build_endpoints_sql("s\"x", "fp' OR '1'='1", 1, 2, 10);
        assert!(sql.contains("FROM \"s\"\"x\" AS dbspan"));
        assert!(sql.contains("o2_db_fingerprint = 'fp'' OR ''1''=''1'"));
    }

    #[test]
    fn test_escape_helpers() {
        assert_eq!(escape_sq("a'b''c"), "a''b''''c");
        assert_eq!(escape_sq("clean"), "clean");
        assert_eq!(escape_ident("a\"b"), "a\"\"b");
    }

    // ── Merge math ──────────────────────────────────────────────────────────

    #[test]
    fn test_merge_rows_counts_add() {
        let a =
            json!({"calls": 10, "errors": 1, "total_time_ns": 100, "statements": 12, "traces": 4});
        let b =
            json!({"calls": 30, "errors": 2, "total_time_ns": 300, "statements": 31, "traces": 7});
        let m = merge_rows([&a, &b]);
        assert_eq!(m["calls"], 40);
        assert_eq!(m["errors"], 3);
        assert_eq!(m["total_time_ns"], 400);
        assert_eq!(m["statements"], 43);
    }

    // traces adds as an UPPER BOUND — the merge sums it, and the response
    // labels it (a trace can straddle windows and constituent rows).
    #[test]
    fn test_merge_rows_traces_upper_bound() {
        let a = json!({"calls": 10, "traces": 4});
        let b = json!({"calls": 10, "traces": 4});
        let m = merge_rows([&a, &b]);
        assert_eq!(m["traces"], 8); // could really be as few as 4
    }

    // Request-weighted percentile combination (aggregate_baselines-style):
    // p95 = (100·10 + 300·30) / 40 = 250.
    #[test]
    fn test_merge_rows_percentiles_request_weighted() {
        let a = json!({"calls": 10, "p50_ns": 50, "p95_ns": 100, "p99_ns": 200, "max_ns": 500});
        let b = json!({"calls": 30, "p50_ns": 150, "p95_ns": 300, "p99_ns": 400, "max_ns": 900});
        let m = merge_rows([&a, &b]);
        assert_eq!(m["p50_ns"], 125); // (50·10 + 150·30) / 40
        assert_eq!(m["p95_ns"], 250);
        assert_eq!(m["p99_ns"], 350);
        assert_eq!(m["max_ns"], 900); // max, not weighted
    }

    // Rows without percentile columns (e.g. _other) contribute counts but no
    // percentile weight — they must not drag the estimate toward zero.
    #[test]
    fn test_merge_rows_percentiles_skip_rows_without_cols() {
        let a = json!({"calls": 10, "p95_ns": 100});
        let other = json!({"calls": 90}); // no latency distribution by design
        let m = merge_rows([&a, &other]);
        assert_eq!(m["p95_ns"], 100);
        assert_eq!(m["calls"], 100);
    }

    // Presence gating: metrics absent from every input stay absent (0 would
    // conflate "not emitted" with "0").
    #[test]
    fn test_merge_rows_presence_gated() {
        let a = json!({"calls": 5});
        let m = merge_rows([&a]);
        assert!(m.get("rows_returned").is_none());
        assert!(m.get("p95_ns").is_none());
        assert!(m.get("max_ns").is_none());

        let b = json!({"calls": 5, "rows_returned": 7, "rows_emitting_calls": 2});
        let m = merge_rows([&a, &b]);
        assert_eq!(m["rows_returned"], 7);
        assert_eq!(m["rows_emitting_calls"], 2);
    }

    #[test]
    fn test_merge_rows_empty() {
        let m = merge_rows(std::iter::empty::<&Value>());
        assert!(m.as_object().unwrap().is_empty());
    }

    // ── Below-top-N detection ───────────────────────────────────────────────

    // A window that HAS data but no fingerprint row is "below top-N"; a window
    // with no data at all is neither below-top-N nor zero — it's a gap.
    #[test]
    fn test_below_top_n_distinguished_from_no_data() {
        let windows: BTreeSet<i64> = [100, 200, 300].into();
        let fp: HashSet<i64> = [100, 300].into();
        assert_eq!(below_top_n_windows(&windows, &fp), vec![200]);

        // fingerprint absent everywhere data exists → all below
        let none: HashSet<i64> = HashSet::new();
        assert_eq!(below_top_n_windows(&windows, &none), vec![100, 200, 300]);

        // no windows at all → nothing is "below top-N" (it's a data gap)
        let empty: BTreeSet<i64> = BTreeSet::new();
        assert!(below_top_n_windows(&empty, &fp).is_empty());
    }

    // K-window backfill cap: most recent windows win the budget, the rest are
    // flag-only.
    #[test]
    fn test_split_backfill_windows_caps_at_k() {
        let below = vec![100, 200, 300, 400, 500, 600, 700, 800];
        let (backfill, flag_only) = split_backfill_windows(below, HISTORY_BACKFILL_MAX_WINDOWS);
        assert_eq!(backfill, vec![800, 700, 600, 500, 400, 300]);
        assert_eq!(flag_only, vec![200, 100]);

        let (backfill, flag_only) = split_backfill_windows(vec![10, 20], 6);
        assert_eq!(backfill, vec![20, 10]);
        assert!(flag_only.is_empty());
    }

    // ── Query grouping (_other passthrough, class filter) ───────────────────

    fn query_pool() -> Vec<Value> {
        vec![
            // fingerprint abc, two windows, class query
            json!({"fingerprint": "abc", "db_system": "postgresql", "db_instance": "db1",
                   "db_namespace": "ns1", "env": "prod", "service_name": "cart",
                   "stmt_class": "query", "query_norm": "SELECT * FROM users WHERE id = ?",
                   "operation": "SELECT", "calls": 10, "errors": 1, "total_time_ns": 100,
                   "statements": 10, "traces": 5, "p95_ns": 100}),
            json!({"fingerprint": "abc", "db_system": "postgresql", "db_instance": "db1",
                   "db_namespace": "ns1", "env": "prod", "service_name": "checkout",
                   "stmt_class": "query", "query_norm": "SELECT * FROM users WHERE id = ?",
                   "operation": "SELECT", "calls": 30, "errors": 0, "total_time_ns": 300,
                   "statements": 30, "traces": 9, "p95_ns": 300}),
            // a transaction-control fingerprint (filtered out by default view)
            json!({"fingerprint": "tcl", "db_system": "postgresql", "db_instance": "db1",
                   "stmt_class": "transaction-control", "query_norm": "COMMIT",
                   "operation": "COMMIT", "calls": 99, "errors": 0, "total_time_ns": 9,
                   "statements": 99, "traces": 40}),
            // instance-grain _other (no stmt_class)
            json!({"fingerprint": "_other", "db_system": "postgresql", "db_instance": "db1",
                   "calls": 50, "errors": 2, "total_time_ns": 500, "statements": 55, "traces": 20}),
            // query-class-grain _other
            json!({"fingerprint": "_other", "db_system": "postgresql", "db_instance": "db1",
                   "stmt_class": "query", "calls": 40, "errors": 1, "total_time_ns": 400,
                   "statements": 44, "traces": 15}),
        ]
    }

    // Default 'query' view: class-filtered fingerprints + the CLASS-grain
    // _other remainder (never the instance-grain one).
    #[test]
    fn test_group_query_rows_default_class_filter() {
        let (hits, other) = group_query_rows(&query_pool(), Some("query"), true);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0]["fingerprint"], "abc");
        assert_eq!(hits[0]["calls"], 40); // constituent rows merged
        assert_eq!(hits[0]["p95_ns"], 250); // request-weighted
        assert_eq!(
            hits[0]["services"],
            json!(["cart", "checkout"]) // distinct, sorted
        );
        // _other passthrough at the class grain
        assert_eq!(other.len(), 1);
        assert_eq!(other[0]["fingerprint"], "_other");
        assert_eq!(other[0]["stmt_class"], "query");
        assert_eq!(other[0]["calls"], 40);
    }

    // 'all' view: every class + the INSTANCE-grain _other remainder.
    #[test]
    fn test_group_query_rows_all_classes() {
        let (hits, other) = group_query_rows(&query_pool(), None, true);
        assert_eq!(hits.len(), 2); // abc + tcl
        assert!(hits.iter().any(|h| h["fingerprint"] == "tcl"));
        assert_eq!(other.len(), 1);
        assert!(other[0].get("stmt_class").is_none()); // instance grain
        assert_eq!(other[0]["calls"], 50);
    }

    // Scopes narrower than the _other grains drop the remainder entirely —
    // the caller shows the top-N-subset marker instead of a fake remainder.
    #[test]
    fn test_group_query_rows_other_suppressed() {
        let (hits, other) = group_query_rows(&query_pool(), Some("query"), false);
        assert_eq!(hits.len(), 1);
        assert!(other.is_empty());
    }

    // The same fingerprint on two instances stays two rows — rank is per
    // (system, instance).
    #[test]
    fn test_group_query_rows_keyed_per_instance() {
        let pool = vec![
            json!({"fingerprint": "abc", "db_system": "pg", "db_instance": "db1",
                   "stmt_class": "query", "calls": 1, "total_time_ns": 10, "statements": 1, "traces": 1}),
            json!({"fingerprint": "abc", "db_system": "pg", "db_instance": "db2",
                   "stmt_class": "query", "calls": 2, "total_time_ns": 20, "statements": 2, "traces": 1}),
        ];
        let (hits, _) = group_query_rows(&pool, Some("query"), true);
        assert_eq!(hits.len(), 2);
    }

    // ── Databases grouping ──────────────────────────────────────────────────

    #[test]
    fn test_group_database_rows_namespace_grain_only() {
        let rows = vec![
            // two windows of the same (system, instance, namespace)
            json!({"db_system": "pg", "db_instance": "db1", "db_namespace": "ns1",
                   "stmt_class": null, "calls": 10, "errors": 0, "total_time_ns": 100,
                   "statements": 10, "traces": 3, "p95_ns": 100}),
            json!({"db_system": "pg", "db_instance": "db1", "db_namespace": "ns1",
                   "stmt_class": null, "calls": 30, "errors": 3, "total_time_ns": 300,
                   "statements": 30, "traces": 8, "p95_ns": 300}),
            // a class-grain totals row: MUST be excluded (its counts would
            // double the namespace-grain totals)
            json!({"db_system": "pg", "db_instance": "db1", "db_namespace": null,
                   "stmt_class": "query", "calls": 35, "errors": 3, "total_time_ns": 350,
                   "statements": 35, "traces": 9}),
        ];
        let out = group_database_rows(&rows);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["calls"], 40);
        assert_eq!(out[0]["p95_ns"], 250);
        assert_eq!(out[0]["db_namespace"], "ns1");
    }

    // ── trace_stream_name provenance survives merging (FR-2 drill-down) ──────

    // The query-detail page needs a concrete raw trace stream to query slow
    // samples / calling endpoints. A single-stream merge must expose it.
    #[test]
    fn test_group_query_rows_keeps_trace_stream_name() {
        let pool = vec![
            json!({"fingerprint": "abc", "db_system": "pg", "db_instance": "db1",
                   "stmt_class": "query", "trace_stream_name": "otel_demo",
                   "calls": 10, "total_time_ns": 100, "statements": 10, "traces": 3}),
            json!({"fingerprint": "abc", "db_system": "pg", "db_instance": "db1",
                   "stmt_class": "query", "trace_stream_name": "otel_demo",
                   "calls": 30, "total_time_ns": 300, "statements": 30, "traces": 5}),
        ];
        let (hits, _) = group_query_rows(&pool, Some("query"), true);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0]["calls"], 40); // still merged
        assert_eq!(hits[0]["trace_stream_name"], "otel_demo");
        assert_eq!(hits[0]["trace_streams"], json!(["otel_demo"]));
    }

    // Ambiguous merge: the scalar is withheld (pointing a raw-span drill-down
    // at an arbitrary "winner" would query the wrong stream) but the full set
    // is always returned so the consumer can fan out or ask the user to scope.
    #[test]
    fn test_group_query_rows_multi_stream_omits_scalar_keeps_array() {
        let pool = vec![
            json!({"fingerprint": "abc", "db_system": "pg", "db_instance": "db1",
                   "stmt_class": "query", "trace_stream_name": "traces_b",
                   "calls": 10, "total_time_ns": 100, "statements": 10, "traces": 3}),
            json!({"fingerprint": "abc", "db_system": "pg", "db_instance": "db1",
                   "stmt_class": "query", "trace_stream_name": "traces_a",
                   "calls": 30, "total_time_ns": 300, "statements": 30, "traces": 5}),
        ];
        let (hits, _) = group_query_rows(&pool, Some("query"), true);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].get("trace_stream_name").is_none());
        assert_eq!(hits[0]["trace_streams"], json!(["traces_a", "traces_b"]));
    }

    // Tail-derived `_other` rows carry no stream (derive_other_rows builds
    // fresh remainders): an empty contributor must not make a single-stream
    // group look ambiguous, and a stream-less group reports an empty array
    // rather than a bogus name.
    #[test]
    fn test_group_query_rows_trace_streams_ignores_missing() {
        let pool = vec![
            json!({"fingerprint": "abc", "db_system": "pg", "db_instance": "db1",
                   "stmt_class": "query", "trace_stream_name": "otel_demo",
                   "calls": 10, "total_time_ns": 100, "statements": 10, "traces": 3}),
            // same group, no trace_stream_name stamped
            json!({"fingerprint": "abc", "db_system": "pg", "db_instance": "db1",
                   "stmt_class": "query",
                   "calls": 5, "total_time_ns": 50, "statements": 5, "traces": 1}),
        ];
        let (hits, _) = group_query_rows(&pool, Some("query"), true);
        assert_eq!(hits[0]["calls"], 15);
        assert_eq!(hits[0]["trace_stream_name"], "otel_demo");
        assert_eq!(hits[0]["trace_streams"], json!(["otel_demo"]));

        // No constituent carries it at all → empty array, no scalar.
        let bare = vec![json!({"fingerprint": "abc", "db_system": "pg",
                               "db_instance": "db1", "stmt_class": "query", "calls": 1})];
        let (hits, _) = group_query_rows(&bare, Some("query"), true);
        assert!(hits[0].get("trace_stream_name").is_none());
        assert_eq!(hits[0]["trace_streams"], json!([]));
    }

    // `_other` remainder rows get the same provenance treatment.
    #[test]
    fn test_group_query_rows_other_keeps_trace_stream_name() {
        let pool = vec![json!({"fingerprint": "_other", "db_system": "pg",
                               "db_instance": "db1", "stmt_class": "query",
                               "trace_stream_name": "otel_demo", "calls": 40})];
        let (_, other) = group_query_rows(&pool, Some("query"), true);
        assert_eq!(other.len(), 1);
        assert_eq!(other[0]["trace_stream_name"], "otel_demo");
    }

    #[test]
    fn test_group_database_rows_keeps_trace_stream_name() {
        let rows = vec![
            json!({"db_system": "pg", "db_instance": "db1", "db_namespace": "ns1",
                   "stmt_class": null, "trace_stream_name": "otel_demo",
                   "calls": 10, "total_time_ns": 100, "statements": 10, "traces": 3}),
            json!({"db_system": "pg", "db_instance": "db1", "db_namespace": "ns1",
                   "stmt_class": null, "trace_stream_name": "otel_demo",
                   "calls": 30, "total_time_ns": 300, "statements": 30, "traces": 5}),
        ];
        let out = group_database_rows(&rows);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["calls"], 40);
        assert_eq!(out[0]["trace_stream_name"], "otel_demo");
        assert_eq!(out[0]["trace_streams"], json!(["otel_demo"]));
    }

    #[test]
    fn test_group_database_rows_multi_stream_omits_scalar() {
        let rows = vec![
            json!({"db_system": "pg", "db_instance": "db1", "db_namespace": "ns1",
                   "stmt_class": null, "trace_stream_name": "traces_a", "calls": 10}),
            json!({"db_system": "pg", "db_instance": "db1", "db_namespace": "ns1",
                   "stmt_class": null, "trace_stream_name": "traces_b", "calls": 30}),
        ];
        let out = group_database_rows(&rows);
        assert_eq!(out.len(), 1);
        assert!(out[0].get("trace_stream_name").is_none());
        assert_eq!(out[0]["trace_streams"], json!(["traces_a", "traces_b"]));
    }

    #[test]
    fn test_calling_services_from_query_stats() {
        let rows = vec![
            json!({"fingerprint": "a", "db_system": "pg", "db_instance": "db1",
                   "db_namespace": "ns1", "service_name": "cart"}),
            json!({"fingerprint": "b", "db_system": "pg", "db_instance": "db1",
                   "db_namespace": "ns1", "service_name": "checkout"}),
            // _other rows never contribute services
            json!({"fingerprint": "_other", "db_system": "pg", "db_instance": "db1",
                   "db_namespace": "ns1", "service_name": "ghost"}),
        ];
        let map = calling_services(&rows);
        let key = ("pg".to_string(), "db1".to_string(), "ns1".to_string());
        assert_eq!(
            map[&key],
            BTreeSet::from(["cart".to_string(), "checkout".to_string()])
        );
    }

    // ── Sorting / search filters ────────────────────────────────────────────

    #[test]
    fn test_sort_rows_whitelist_and_default() {
        let mut rows = vec![
            json!({"fingerprint": "a", "calls": 1, "total_time_ns": 300}),
            json!({"fingerprint": "b", "calls": 9, "total_time_ns": 100}),
        ];
        sort_rows(&mut rows, Some("calls"));
        assert_eq!(rows[0]["fingerprint"], "b");
        // non-whitelisted (hostile) sort key falls back to total_time_ns —
        // user input never reaches an ORDER BY
        sort_rows(&mut rows, Some("calls; DROP TABLE x"));
        assert_eq!(rows[0]["fingerprint"], "a");
        sort_rows(&mut rows, None);
        assert_eq!(rows[0]["fingerprint"], "a");
    }

    #[test]
    fn test_search_matches_case_insensitive() {
        let row =
            json!({"fingerprint": "deadbeef", "query_norm": "SELECT * FROM Users WHERE id = ?"});
        assert!(search_matches(&row, "from users"));
        assert!(search_matches(&row, "SELECT"));
        assert!(search_matches(&row, "deadbe"));
        assert!(!search_matches(&row, "DELETE"));
    }

    // ── Scope filter row matching (merge-time, applied to cached tail) ──────

    #[test]
    fn test_scope_filters_matches_rows() {
        let row = json!({"db_system": "pg", "db_instance": "db1", "service_name": "cart"});
        let f = ScopeFilters {
            system: Some("pg".into()),
            ..Default::default()
        };
        assert!(f.matches(&row));
        let f = ScopeFilters {
            system: Some("mysql".into()),
            ..Default::default()
        };
        assert!(!f.matches(&row));
        // a set filter fails rows where the column is absent (e.g. env filter
        // vs an _other row that carries no env)
        let f = ScopeFilters {
            env: Some("prod".into()),
            ..Default::default()
        };
        assert!(!f.matches(&row));
        assert!(ScopeFilters::default().matches(&row));
    }

    #[test]
    fn test_narrower_than_other_grain() {
        assert!(!ScopeFilters::default().narrower_than_other_grain());
        assert!(
            !ScopeFilters {
                system: Some("pg".into()),
                instance: Some("db1".into()),
                stream: Some("s".into()),
                ..Default::default()
            }
            .narrower_than_other_grain()
        );
        for f in [
            ScopeFilters {
                namespace: Some("ns".into()),
                ..Default::default()
            },
            ScopeFilters {
                env: Some("prod".into()),
                ..Default::default()
            },
            ScopeFilters {
                service: Some("cart".into()),
                ..Default::default()
            },
        ] {
            assert!(f.narrower_than_other_grain());
        }
    }

    // ── Tail cache (D4: unfiltered key, TTL, offset window-bucket) ──────────

    fn tail_fixture() -> TailData {
        TailData {
            tail_start: 1_000,
            tail_end: 2_000,
            rank_rows: vec![json!({"fingerprint": "abc", "calls": 5})],
            totals_rows: vec![json!({"db_system": "pg", "calls": 5})],
            truncated: false,
            relevant: true,
            failed: false,
        }
    }

    #[test]
    fn test_tail_cache_hit_within_ttl() {
        let cache = TailCache::new();
        cache.put("org1", "s1", 1_000, 10_000, tail_fixture());
        let hit = cache.get("org1", "s1", 1_000, 10_000 + 29_999_999, 30_000_000);
        assert!(hit.is_some());
        assert_eq!(hit.unwrap().rank_rows.len(), 1);
        // other (org, stream) keys miss
        assert!(cache.get("org2", "s1", 1_000, 10_001, 30_000_000).is_none());
        assert!(cache.get("org1", "s2", 1_000, 10_001, 30_000_000).is_none());
    }

    #[test]
    fn test_tail_cache_expires_after_ttl() {
        let cache = TailCache::new();
        cache.put("org1", "s1", 1_000, 10_000, tail_fixture());
        assert!(
            cache
                .get("org1", "s1", 1_000, 10_000 + 30_000_000, 30_000_000)
                .is_none()
        );
    }

    // The rollup offset is the window-bucket: when the job advances the
    // offset, the cached tail (which starts at the OLD offset) would
    // double-count against the new rollup rows — it must miss immediately,
    // even inside the TTL.
    #[test]
    fn test_tail_cache_offset_advance_invalidates() {
        let cache = TailCache::new();
        cache.put("org1", "s1", 1_000, 10_000, tail_fixture());
        assert!(cache.get("org1", "s1", 2_000, 10_001, 30_000_000).is_none());
    }

    // The cache key carries NO filter components: the same (unfiltered) entry
    // serves every filter combination — filters apply at merge time. The
    // stored rows are the full unfiltered aggregate.
    #[test]
    fn test_tail_cache_key_is_unfiltered() {
        let cache = TailCache::new();
        let mut data = tail_fixture();
        data.rank_rows = vec![
            json!({"fingerprint": "a", "db_system": "pg", "calls": 1}),
            json!({"fingerprint": "b", "db_system": "redis", "calls": 2}),
        ];
        cache.put("org1", "s1", 1_000, 10_000, data);
        // two "requests" with different scopes read the SAME entry…
        let for_pg = cache.get("org1", "s1", 1_000, 10_001, 30_000_000).unwrap();
        let for_redis = cache.get("org1", "s1", 1_000, 10_002, 30_000_000).unwrap();
        assert_eq!(for_pg.rank_rows, for_redis.rank_rows);
        // …and each applies its own filter at merge time.
        let pg = ScopeFilters {
            system: Some("pg".into()),
            ..Default::default()
        };
        let redis = ScopeFilters {
            system: Some("redis".into()),
            ..Default::default()
        };
        assert_eq!(for_pg.rank_rows.iter().filter(|r| pg.matches(r)).count(), 1);
        assert_eq!(
            for_redis
                .rank_rows
                .iter()
                .filter(|r| redis.matches(r))
                .count(),
            1
        );
    }

    // ── Server-vantage endpoints ────────────────────────────────────────────

    /// Note `all_cols()` is derived from `ALL_DBM_FIELDS`, so this golden grows
    /// whenever a canonical field is reserved — the 19 activity columns (W2) are
    /// the most recent, after `o2_event_name` (W1). That is safe: at runtime the
    /// projection is intersected with the STREAM SCHEMA (`present_dbm_columns`),
    /// so a reserved-but-absent column is filtered out rather than named in the
    /// SELECT — which is exactly why a deadlock-only deployment does not pay for
    /// the activity columns here.
    #[test]
    fn test_build_dbm_events_sql_exact() {
        let sql = build_dbm_events_sql("dbm_server", "deadlock", 100, 200, "", 50, &all_cols());
        let expected = "SELECT _timestamp, o2_dbm_kind, o2_dbm_engine, o2_dbm_database, o2_dbm_instance, o2_dbm_timestamp, o2_dbm_raw, o2_dbm_victim_pid, o2_dbm_participants, o2_dbm_participant_count, o2_dbm_victim_side, o2_dbm_blocked_pid, o2_dbm_blocked_app, o2_dbm_blocked_query, o2_dbm_blocked_fingerprint, o2_dbm_blocking_pid, o2_dbm_blocking_app, o2_dbm_blocking_query, o2_dbm_blocking_fingerprint, o2_dbm_wait_event_type, o2_dbm_wait_event, o2_dbm_wait_seconds, o2_dbm_query_shape, o2_event_name, o2_dbm_session_pid, o2_dbm_session_user, o2_dbm_session_app, o2_dbm_session_state, o2_dbm_query_start, o2_dbm_xact_start, o2_dbm_wait_start, o2_dbm_duration_ms, o2_dbm_exec_time_ms, o2_dbm_server_query_id, o2_dbm_activity_query, o2_dbm_fingerprint, o2_dbm_blocking_pids, o2_dbm_lock_mode, o2_dbm_lock_type, o2_dbm_lock_relation, o2_dbm_client_addr, o2_dbm_client_host, o2_dbm_client_port, o2_dbm_plan, o2_dbm_plan_hash, o2_dbm_plan_hash_version, o2_dbm_calls, o2_dbm_rows, o2_dbm_exec_time_s, o2_dbm_shared_blks_hit, o2_dbm_shared_blks_read, o2_dbm_shared_blks_dirtied, o2_dbm_shared_blks_written, o2_dbm_temp_blks_read, o2_dbm_temp_blks_written, o2_dbm_metrics_are_delta, o2_dbm_receiver_version, o2_dbm_relation, o2_dbm_schema, o2_dbm_total_bytes, o2_dbm_heap_bytes, o2_dbm_live_tuples, o2_dbm_dead_tuples, o2_dbm_dead_tup_pct, o2_dbm_mod_since_analyze, o2_dbm_seq_scan_count, o2_dbm_seq_tup_read, o2_dbm_idx_scan_count, o2_dbm_autovacuum_count, o2_dbm_frozen_xid_age, o2_dbm_last_vacuum, o2_dbm_last_autovacuum, o2_dbm_last_analyze, o2_dbm_counters_are_cumulative, o2_dbm_tuples_are_estimated FROM \"dbm_server\"\nWHERE _timestamp >= 100 AND _timestamp < 200\n    AND o2_dbm_kind = 'deadlock'\nORDER BY _timestamp DESC\nLIMIT 50";
        assert_eq!(sql, expected);
    }

    /// A column absent from the stream must be OMITTED, not named.
    ///
    /// Regression: the first version of this projection listed every field in
    /// `ALL_DBM_FIELDS`, which is the write-side reservation list — not what a
    /// given stream contains. A filelog-only deployment has no
    /// `o2_dbm_instance`, and naming it failed the ENTIRE query with
    /// "Search field not found", turning the Deadlocks page into a 500.
    #[test]
    fn test_build_dbm_events_sql_omits_columns_absent_from_the_stream() {
        let mut present = all_cols();
        present.remove(server_vantage::O2_DBM_INSTANCE);

        let sql = build_dbm_events_sql("dbm_server", "deadlock", 100, 200, "", 50, &present);
        assert!(
            !sql.contains(server_vantage::O2_DBM_INSTANCE),
            "absent column must not be projected"
        );
        // The rest still are, and the query is still well-formed.
        assert!(sql.contains(server_vantage::O2_DBM_KIND));
        assert!(sql.starts_with("SELECT _timestamp, "));
    }

    /// A GENUINELY empty schema degrades to `_timestamp` only, and the builder
    /// stays well-formed. This is the honest empty case (a deployment that has
    /// not shipped the recipes); the FAILED-READ case must never arrive here —
    /// see `test_present_dbm_columns_reports_errors_instead_of_empty`.
    #[test]
    fn test_build_dbm_events_sql_survives_an_empty_schema() {
        let sql = build_dbm_events_sql("dbm_server", "deadlock", 100, 200, "", 50, &HashSet::new());
        assert!(sql.starts_with("SELECT _timestamp FROM"));
    }

    // ── A failed schema read is an error, not an empty schema ───────────────
    //
    // `present_dbm_columns` used to end in `.unwrap_or_default()`, which made an
    // `Err` from `infra::schema::get` indistinguishable from "this stream has no
    // DBM columns". The two tests below pin the two halves of the fix: the type
    // can now CARRY an error, and the honest empty case is still `Ok`.

    /// The signature must be able to say "the read failed".
    ///
    /// Asserted structurally rather than by faking a DB fault: with the old
    /// `-> HashSet<String>` return type there is no value that expresses failure
    /// at all, so both callers were forced to invent a verdict from an empty set.
    /// A nonexistent stream is NOT that failure — `infra::schema::get` answers
    /// `Ok` with an empty schema for it (verified live below), which is why
    /// propagating the `Err` costs the not-yet-shipped-recipe deployment nothing.
    ///
    /// IGNORED because it is an integration test wearing a unit test's clothes.
    /// `present_dbm_columns` calls the real `infra::schema::get`, so the result
    /// depends on ambient meta-store state: it passes against a provisioned
    /// store and fails with "error communicating with database: Connection
    /// reset by peer" against a bare checkout. Observed BOTH outcomes on the
    /// same commit, minutes apart, which is the definition of a flake — and a
    /// flake in the suite is worse than a gap, because it trains the next
    /// person to ignore a red run.
    ///
    /// The behaviour it describes is still pinned, structurally and without a
    /// database, by `test_no_caller_swallows_a_schema_read_error` below: that
    /// one discovers every `get_dbm_*` handler from source and asserts none of
    /// them flattens a failed schema read into an empty set. Run this with
    /// `--ignored` against a live meta store when changing `present_dbm_columns`.
    #[tokio::test]
    #[ignore = "needs a provisioned meta store; see test_no_caller_swallows_a_schema_read_error"]
    async fn test_present_dbm_columns_reports_errors_instead_of_empty() {
        let result: Result<HashSet<String>, anyhow::Error> =
            present_dbm_columns("nosuchorg", "nosuchstream").await;
        let cols = result.expect("an absent stream is Ok(empty), never Err");
        assert!(
            cols.is_empty(),
            "an absent stream genuinely has no DBM columns"
        );
    }

    /// The signature alone is not the fix — every CALLER must honour it.
    ///
    /// Mutation-tested: reintroducing the bug one level up
    /// (`present_dbm_columns(..).await.unwrap_or_default()` at a call site) keeps
    /// the honest `Result` type and passes every other test in this file, while
    /// restoring the exact false verdict — so the call sites are pinned too.
    ///
    /// The handler list is DISCOVERED from the source rather than hardcoded.
    /// It used to name `deadlocks` and `blocking` literally, which meant a new
    /// `get_dbm_*` handler silently escaped the guard — the one failure mode a
    /// pinning test must not have, since nothing would fail to tell you.
    #[test]
    fn test_no_caller_swallows_a_schema_read_error() {
        let src = include_str!("api.rs");

        // Discover every `get_dbm_*` handler and keep the ones that actually
        // read the stream schema — the others have no Result to swallow.
        // `\n}\n` is the body boundary: a handler is a top-level item, so the
        // first column-0 closing brace ends it. (Splitting on `\npub ` instead
        // ran past private items like `present_dbm_columns` itself.)
        // Scan only the real code: the test module below contains the same
        // literal inside other source-scraping tests, and matching those pulls
        // in a bogus "handler" whose body is the rest of the file.
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let guarded: Vec<(&str, &str)> = code
            .match_indices("pub async fn get_dbm_")
            .filter_map(|(i, _)| {
                let rest = &code[i..];
                let open = rest.find('(')?;
                let name = rest["pub async fn ".len()..open].trim();
                let body = rest[open..].split("\n}\n").next()?;
                body.contains("present_dbm_columns(")
                    .then_some((name, body))
            })
            .collect();
        assert!(
            guarded.len() >= 2,
            "expected to discover the schema-reading handlers, found {:?}",
            guarded.iter().map(|(n, _)| *n).collect::<Vec<_>>()
        );

        for (name, body) in &guarded {
            let call = body
                .find("present_dbm_columns(")
                .unwrap_or_else(|| panic!("{name} must read the stream schema"));
            let tail = &body[call..];
            assert!(
                !tail[..tail.len().min(200)].contains("unwrap_or_default"),
                "{name} must not flatten a failed schema read back into an empty set"
            );
            assert!(
                tail[..tail.len().min(400)].contains("MetaHttpResponse::internal_error"),
                "{name} must report a failed schema read instead of inventing a verdict"
            );
        }
    }

    /// WHY the error must not be flattened, half one: BLOCKING.
    ///
    /// With an empty column set the projection drops both pid columns, and
    /// `BlockingSample::from_record` requires both — so every row is filtered
    /// out, `hits` is empty, the liveness probe runs and the page reports
    /// `not_collecting: true`. That tells the operator their collector is broken
    /// when only a schema read blipped, which is exactly the false alarm the
    /// design note above `LIVENESS_PROBE_MICROS` says must never be raised.
    #[test]
    fn test_empty_columns_would_silently_drop_every_blocking_row() {
        let sql = build_dbm_events_sql("dbm_server", "blocking", 100, 200, "", 50, &HashSet::new());
        assert!(!sql.contains(server_vantage::O2_DBM_BLOCKED_PID));
        assert!(!sql.contains(server_vantage::O2_DBM_BLOCKING_PID));

        // What such a projection returns per row, and what the reader makes of
        // it: nothing at all — hence the false `not_collecting`.
        let row = json!({ "_timestamp": 1_000_000 });
        assert!(
            server_vantage::BlockingSample::from_record(&row).is_none(),
            "a pid-less row cannot become a sample, so hits would be empty"
        );
    }

    /// WHY the error must not be flattened, half two: DEADLOCKS.
    ///
    /// Deadlocks has no from_record guard, so the same projection yields events
    /// with no engine, no participants and no victim. Worse than blocking's
    /// false alarm: `hits` is non-empty, so the probe is SKIPPED and the tab
    /// renders content-free rows with no diagnostic at all.
    #[test]
    fn test_empty_columns_would_yield_content_free_deadlock_events() {
        let sql = build_dbm_events_sql("dbm_server", "deadlock", 100, 200, "", 50, &HashSet::new());
        assert!(!sql.contains(server_vantage::O2_DBM_PARTICIPANTS));

        let ev = deadlock_event_from_row(&json!({ "_timestamp": 1_000_000 }));
        assert!(ev.engine.is_none());
        assert!(ev.participants.is_empty());
        assert!(ev.victim_pid.is_none());
        // Non-empty `hits` is what suppresses the probe, so this row would reach
        // the UI with no diagnostic beside it.
        let dto = deadlock_event_to_dto(&ev);
        assert_eq!(dto["participant_count"], json!(0));
        assert_eq!(dto["db_system"], json!(""));
    }

    /// NEVER `SELECT *` on a server-vantage stream.
    ///
    /// The recipes export alongside ordinary log lines, so the stream's schema
    /// is the union of every field those lines ever carried — 195 columns on a
    /// real deployment against 21 the readers touch. `SELECT *` makes the
    /// columnar engine fetch all of them per row, and that read dominated the
    /// Deadlocks page (8-18 s). This asserts the projection stays explicit and
    /// stays in lockstep with what `from_record` deserializes.
    #[test]
    fn test_build_dbm_events_sql_projects_only_canonical_columns() {
        let sql = build_dbm_events_sql("dbm_server", "deadlock", 100, 200, "", 50, &all_cols());
        assert!(!sql.contains("SELECT *"), "must not select every column");
        assert!(sql.starts_with("SELECT _timestamp, "));
        for field in server_vantage::ALL_DBM_FIELDS {
            assert!(sql.contains(field), "projection is missing {field}");
        }
    }

    /// Every user-supplied value on these endpoints is escaped — a stream name
    /// or filter value can never break out of its literal/identifier.
    #[test]
    fn test_dbm_events_sql_injection_is_escaped() {
        let preds = dbm_event_preds(Some("pg' OR '1'='1"), None, None);
        assert!(preds.contains("'pg'' OR ''1''=''1'"));
        assert!(!preds.contains("OR '1'='1'"));

        let sql = build_dbm_events_sql("ev\"il", "blocking", 1, 2, &preds, 10, &all_cols());
        assert!(sql.contains("\"ev\"\"il\""), "stream identifier escaped");
    }

    #[test]
    fn test_dbm_event_preds_only_whitelisted_columns() {
        let preds = dbm_event_preds(Some("postgresql"), Some("db1"), Some("dbmlab"));
        assert_eq!(
            preds,
            "\n    AND o2_dbm_engine = 'postgresql'\n    AND o2_dbm_instance = 'db1'\n    AND o2_dbm_database = 'dbmlab'"
        );
        assert_eq!(dbm_event_preds(None, None, None), "");
        // Empty strings are not filters.
        assert_eq!(dbm_event_preds(Some(""), None, None), "");
    }

    // ── Deadlock read path: row → event → stitch → DTO ─────────────────────
    //
    // Every test below feeds STORED-ROW fixtures through `deadlock_event_from_row`
    // rather than building `DeadlockEvent` structs directly, so the parse of the
    // JSON-string `o2_dbm_participants` column is covered on the way through.

    /// A stored Postgres row: one record already carrying the whole cycle.
    fn pg_row(ts: i64, victim: i64, parts: Value) -> Value {
        json!({
            "_timestamp": ts,
            "o2_dbm_kind": "deadlock",
            "o2_dbm_engine": "postgresql",
            "o2_dbm_instance": "pg1",
            "o2_dbm_database": "dbmlab",
            "o2_dbm_victim_pid": victim,
            // The canonical write path stores this as a JSON STRING.
            "o2_dbm_participants": parts.to_string(),
        })
    }

    /// A stored MySQL row: ONE transaction side, as InnoDB logs it.
    fn my_row(ts: i64, thread: i64, trx: &str, fp: &str, victim: bool) -> Value {
        json!({
            "_timestamp": ts,
            "o2_dbm_kind": "deadlock",
            "o2_dbm_engine": "mysql",
            "o2_dbm_instance": "my1",
            "o2_dbm_database": "dbmlab",
            "o2_dbm_victim_pid": if victim { json!(thread) } else { Value::Null },
            "o2_dbm_participants": json!([{
                "pid": thread,
                "transaction_id": trx,
                "fingerprint": fp,
                "query_norm": format!("UPDATE t{fp} SET c = ? WHERE id = ?"),
                "victim": victim,
            }])
            .to_string(),
        })
    }

    fn events_of(rows: &[Value]) -> Vec<server_vantage::DeadlockEvent> {
        stitch_mysql_deadlocks(rows.iter().map(deadlock_event_from_row).collect())
    }

    /// The participants column round-trips out of its JSON-string storage form.
    #[test]
    fn test_deadlock_event_from_row_parses_string_participants() {
        let row = pg_row(
            300,
            11,
            json!([{"pid": 11, "fingerprint": "aaa"}, {"pid": 22, "fingerprint": "bbb"}]),
        );
        let ev = deadlock_event_from_row(&row);
        assert_eq!(ev.participants.len(), 2);
        assert_eq!(ev.engine.as_deref(), Some("postgresql"));
        assert_eq!(ev.instance.as_deref(), Some("pg1"));
        assert_eq!(ev.database.as_deref(), Some("dbmlab"));
        assert_eq!(ev.victim_pid, Some(11));
        assert_eq!(ev.timestamp, Some(300));
    }

    /// The shape ranking answers "which query shape deadlocks most". The victim
    /// alternating between firings must NOT split one bug into two rows.
    #[test]
    fn test_rank_deadlock_shapes_groups_and_ranks() {
        let rows = vec![
            pg_row(
                300,
                11,
                json!([
                    {"pid": 11, "fingerprint": "aaa", "query_norm": "UPDATE accounts SET balance = ? WHERE id = ?"},
                    {"pid": 22, "fingerprint": "bbb", "query_norm": "UPDATE inventory SET qty = ? WHERE id = ?"},
                ]),
            ),
            // Same pair, victim swapped — must group with the row above.
            pg_row(
                200,
                22,
                json!([{"pid": 22, "fingerprint": "bbb"}, {"pid": 11, "fingerprint": "aaa"}]),
            ),
            pg_row(100, 33, json!([{"pid": 33, "fingerprint": "ccc"}])),
        ];
        let ranked = rank_deadlock_shapes(&events_of(&rows));
        assert_eq!(ranked.len(), 2, "two distinct shapes");
        assert_eq!(get_str(&ranked[0], "query_shape"), "aaa+bbb");
        assert_eq!(get_i64(&ranked[0], "count"), 2, "both firings grouped");
        assert_eq!(get_i64(&ranked[0], "last_seen"), 300);
        assert_eq!(get_i64(&ranked[1], "count"), 1);

        // Fingerprints are deduped across firings — they are the join keys the UI
        // uses to pivot into the query view.
        let fps = ranked[0]["fingerprints"].as_array().unwrap();
        assert_eq!(fps.len(), 2);
    }

    #[test]
    fn test_rank_deadlock_shapes_skips_shapeless_rows() {
        // A deadlock whose participants had unparseable SQL has no fingerprint,
        // so no shape, and must not create a phantom empty-key group.
        let rows = vec![pg_row(1, 0, json!([{"pid": 9}]))];
        assert!(rank_deadlock_shapes(&events_of(&rows)).is_empty());
    }

    // ── GAP 2: MySQL side stitching ────────────────────────────────────────

    /// The headline case: two InnoDB entries ~150 µs apart are ONE deadlock.
    #[test]
    fn test_stitch_mysql_merges_two_sides() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_150, 42, "trxB", "bbb", true),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 1, "two sides collapse to one deadlock");
        assert_eq!(events[0].participants.len(), 2);
        // The victim verdict survives the merge regardless of arrival order.
        assert_eq!(events[0].victim_pid, Some(42));
    }

    /// Postgres records already carry both sides. Merging two of them would
    /// invent a four-way cycle that never happened.
    #[test]
    fn test_stitch_leaves_postgres_untouched() {
        let rows = vec![
            pg_row(
                1_000_000,
                11,
                json!([{"pid": 11, "fingerprint": "aaa"}, {"pid": 22, "fingerprint": "bbb"}]),
            ),
            // Well inside the MySQL window — must still stay two events.
            pg_row(
                1_000_150,
                33,
                json!([{"pid": 33, "fingerprint": "ccc"}, {"pid": 44, "fingerprint": "ddd"}]),
            ),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 2, "PG events never merge with each other");
        assert!(events.iter().all(|e| e.participants.len() == 2));
    }

    /// A mixed window must not cross engines: a PG event and a MySQL side that
    /// happen to share a microsecond are unrelated.
    #[test]
    fn test_stitch_never_merges_across_engines() {
        let rows = vec![
            pg_row(
                1_000_000,
                11,
                json!([{"pid": 11, "fingerprint": "aaa"}, {"pid": 22, "fingerprint": "bbb"}]),
            ),
            my_row(1_000_000, 41, "trxA", "ccc", false),
            my_row(1_000_100, 42, "trxB", "ddd", true),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 2, "one PG event + one stitched MySQL event");
        let mysql: Vec<_> = events
            .iter()
            .filter(|e| e.engine.as_deref() == Some("mysql"))
            .collect();
        assert_eq!(mysql.len(), 1);
        assert_eq!(mysql[0].participants.len(), 2);
    }

    /// pids and transaction ids are only comparable within one server, so two
    /// sides logged by DIFFERENT instances are not one deadlock.
    #[test]
    fn test_stitch_never_merges_across_instances() {
        let mut a = my_row(1_000_000, 41, "trxA", "aaa", false);
        let b = my_row(1_000_100, 42, "trxB", "bbb", true);
        a["o2_dbm_instance"] = json!("my2");
        let events = events_of(&[a, b]);
        assert_eq!(events.len(), 2, "different instances stay separate");
    }

    /// The UNTAGGED shape, which is what the shipped recipes actually emit.
    ///
    /// `test_stitch_never_merges_across_instances` above hardcodes distinct
    /// instances, so it only ever proved the guard works when identity is
    /// KNOWN — and identity is exactly what production lacks: the filelog
    /// deadlock recipes tag neither instance nor database. Grouping on
    /// `unwrap_or_default()` collapsed every MySQL host into `("mysql","","")`,
    /// so two hosts each with their own two-sided deadlock inside the 2 s window
    /// fused into ONE 4-participant event describing no real lock cycle.
    #[test]
    fn test_stitch_never_merges_untagged_rows_from_two_servers() {
        // Two hosts, two independent two-sided deadlocks, all four entries
        // within the window and none tagged — the production shape.
        let rows: Vec<Value> = [
            (1_000_000, 41, "trxA1", "aaa", false),
            (1_000_100, 42, "trxA2", "bbb", true),
            (1_000_200, 71, "trxB1", "ccc", false),
            (1_000_300, 72, "trxB2", "ddd", true),
        ]
        .into_iter()
        .map(|(ts, pid, trx, fp, victim)| {
            let mut row = my_row(ts, pid, trx, fp, victim);
            row["o2_dbm_instance"] = Value::Null;
            row["o2_dbm_database"] = Value::Null;
            row
        })
        .collect();

        let events = events_of(&rows);
        // Every entry survives as its own partial event. Over-reporting the
        // COUNT is the safe direction; fabricating a cycle is not.
        assert_eq!(
            events.len(),
            4,
            "untagged sides must not fuse — got {:?}",
            events
                .iter()
                .map(|e| e.participants.len())
                .collect::<Vec<_>>()
        );
        assert!(
            events.iter().all(|e| e.participants.len() == 1),
            "no event may claim participants from another server"
        );
        // The specific fabrication this guards: a 4-participant event whose
        // shape (`aaa+bbb+ccc+ddd`) matches no lock-ordering bug that exists.
        assert!(
            !events
                .iter()
                .any(|e| e.query_shape().as_deref() == Some("aaa+bbb+ccc+ddd")),
            "cross-server shape must never reach rank_deadlock_shapes"
        );
    }

    /// A side that cannot be stitched must still REACH the caller: dropping it
    /// would turn a real deadlock into no deadlock at all. It arrives as the
    /// one-participant event it is, flagged `partial`, exactly as an unmatched
    /// tagged singleton does.
    #[test]
    fn test_stitch_keeps_untagged_side_as_partial_event() {
        let mut row = my_row(1_000_000, 41, "trxA", "aaa", true);
        row["o2_dbm_instance"] = Value::Null;
        let events = events_of(&[row]);
        assert_eq!(events.len(), 1, "an untagged side is never dropped");
        let dto = deadlock_event_to_dto(&events[0]);
        assert_eq!(dto["partial"], json!(true));
        assert_eq!(dto["participant_count"], json!(1));
    }

    /// The one untagged record that must NOT surface: the participant-less
    /// `WE ROLL BACK TRANSACTION (N)` verdict. It carries a side number and
    /// nothing else — no pid, no statement — so alone it would render a
    /// content-free deadlock row and inflate the count with a non-event. It is
    /// only meaningful joined to its sides, and untagged means it never can be.
    #[test]
    fn test_stitch_drops_untagged_participantless_verdict() {
        let verdict = json!({
            "_timestamp": 1_000_000,
            "o2_dbm_kind": "deadlock",
            "o2_dbm_engine": "mysql",
            "o2_dbm_victim_side": 2,
            "o2_dbm_participants": json!([]).to_string(),
        });
        assert!(events_of(&[verdict]).is_empty());
    }

    /// The guard must not cost the TAGGED deployment its stitch — tagging an
    /// instance in the recipe is the documented fix, so it has to work.
    #[test]
    fn test_stitch_still_merges_when_instance_is_tagged() {
        let events = events_of(&[
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_150, 42, "trxB", "bbb", true),
        ]);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].participants.len(), 2);
        assert_eq!(events[0].instance.as_deref(), Some("my1"));
    }

    /// Sides far apart in time are two different deadlocks that each lost a half.
    #[test]
    fn test_stitch_leaves_far_apart_sides_separate() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            // 3 s > the 2 s window.
            my_row(4_000_000, 42, "trxB", "bbb", true),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|e| e.participants.len() == 1));
    }

    /// An unmatched singleton is returned as-is and flagged `partial`, not
    /// dropped: "a deadlock happened and we only caught one side" is true and
    /// useful, while silently discarding it under-reports the incident.
    #[test]
    fn test_stitch_keeps_unmatched_singleton_flagged_partial() {
        let events = events_of(&[my_row(1_000_000, 41, "trxA", "aaa", true)]);
        assert_eq!(events.len(), 1);
        let dto = deadlock_event_to_dto(&events[0]);
        assert_eq!(dto["partial"], json!(true));
        assert_eq!(dto["participant_count"], json!(1));
    }

    /// A 3-way pileup: InnoDB can log three transactions in one cycle. All
    /// three sides belong to ONE deadlock, not one-and-a-half.
    #[test]
    fn test_stitch_handles_three_way_pileup() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_100, 42, "trxB", "bbb", false),
            my_row(1_000_200, 43, "trxC", "ccc", true),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].participants.len(), 3);
        assert_eq!(events[0].victim_pid, Some(43));
    }

    /// A repeated transaction id inside the window is the NEXT deadlock reusing
    /// a hot pair, not a third side of the open one.
    #[test]
    fn test_stitch_repeated_transaction_id_starts_new_event() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_100, 42, "trxB", "bbb", true),
            // Same trxA again, still inside the window.
            my_row(1_000_200, 41, "trxA", "aaa", false),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 2, "the repeat opens a second deadlock");
        let sizes: Vec<usize> = events.iter().map(|e| e.participants.len()).collect();
        assert!(sizes.contains(&2) && sizes.contains(&1));
    }

    /// Identical timestamps must not blow up or drop a side — a tie is just a
    /// tie, and the two entries are still two sides of one deadlock.
    #[test]
    fn test_stitch_identical_timestamps_tie() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_000, 42, "trxB", "bbb", true),
        ];
        let events = events_of(&rows);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].participants.len(), 2);
    }

    /// GAP 2's grouping half: a stitched MySQL deadlock and the equivalent
    /// Postgres one must land under the SAME shape key. Before stitching, the
    /// MySQL sides carried one fingerprint each and grouped as two half-sized
    /// bugs while Postgres grouped as one.
    #[test]
    fn test_shape_grouping_is_engine_consistent() {
        let pg = events_of(&[pg_row(
            2_000_000,
            11,
            json!([{"pid": 11, "fingerprint": "aaa"}, {"pid": 22, "fingerprint": "bbb"}]),
        )]);
        let my = events_of(&[
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_100, 42, "trxB", "bbb", true),
        ]);
        assert_eq!(pg[0].query_shape(), my[0].query_shape());
        assert_eq!(pg[0].query_shape().as_deref(), Some("aaa+bbb"));

        // And the shape is victim-order independent on the MySQL side too:
        // swapping which side lost must not change the key.
        let my_swapped = events_of(&[
            my_row(1_000_000, 41, "trxA", "bbb", true),
            my_row(1_000_100, 42, "trxB", "aaa", false),
        ]);
        assert_eq!(my_swapped[0].query_shape(), my[0].query_shape());
    }

    /// Stitched MySQL events rank as ONE firing, not two.
    #[test]
    fn test_rank_shapes_counts_stitched_mysql_once() {
        let rows = vec![
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_100, 42, "trxB", "bbb", true),
            my_row(5_000_000, 43, "trxC", "aaa", false),
            my_row(5_000_100, 44, "trxD", "bbb", true),
        ];
        let ranked = rank_deadlock_shapes(&events_of(&rows));
        assert_eq!(ranked.len(), 1, "one shape");
        assert_eq!(
            get_i64(&ranked[0], "count"),
            2,
            "two deadlocks, not four sides"
        );
    }

    // ── The UI-facing DTO shape ────────────────────────────────────────────

    /// The DTO is the contract: no `o2_dbm_` prefixes anywhere, `participants`
    /// is a real ARRAY, and the field names match what the UI service declares.
    #[test]
    fn test_deadlock_dto_shape() {
        let events = events_of(&[pg_row(
            300,
            22,
            json!([
                {"pid": 11, "fingerprint": "aaa", "query": "UPDATE a SET x = 1",
                 "app": "checkout", "user": "svc", "lock_mode": "ShareLock",
                 "lock_target": "accounts", "transaction_id": "1430"},
                {"pid": 22, "fingerprint": "bbb", "query": "UPDATE b SET y = 2",
                 "lock_target": "inventory"},
            ]),
        )]);
        let dto = deadlock_event_to_dto(&events[0]);

        // No storage-layer names leak.
        let obj = dto.as_object().unwrap();
        assert!(
            obj.keys().all(|k| !k.starts_with("o2_dbm_")),
            "DTO leaked a storage column name: {:?}",
            obj.keys().collect::<Vec<_>>()
        );

        assert_eq!(dto["timestamp"], json!(300));
        assert_eq!(dto["db_system"], json!("postgresql"));
        assert_eq!(dto["db_instance"], json!("pg1"));
        assert_eq!(dto["db_namespace"], json!("dbmlab"));
        assert_eq!(dto["victim_pid"], json!(22));
        assert_eq!(dto["participant_count"], json!(2));
        assert_eq!(dto["partial"], json!(false));
        assert_eq!(dto["query_shape"], json!("aaa+bbb"));
        assert_eq!(dto["objects"], json!(["accounts", "inventory"]));
        assert_eq!(dto["id"], json!("300-22"));

        // participants is an ARRAY, not a JSON string.
        let ps = dto["participants"].as_array().expect("array, not a string");
        assert_eq!(ps.len(), 2);
        assert_eq!(ps[0]["pid"], json!(11));
        assert_eq!(ps[0]["application"], json!("checkout"));
        assert_eq!(ps[0]["user"], json!("svc"));
        assert_eq!(ps[0]["lock_mode"], json!("ShareLock"));
        assert_eq!(ps[0]["lock_target"], json!("accounts"));
        assert_eq!(ps[0]["transaction_id"], json!("1430"));
        assert_eq!(ps[0]["fingerprint"], json!("aaa"));
        // The event's victim_pid decides, not the per-participant flag.
        assert_eq!(ps[0]["victim"], json!(false));
        assert_eq!(ps[1]["victim"], json!(true));
    }

    /// The blocking DTO drops the prefixes too and speaks the same
    /// `db_system`/`db_instance`/`db_namespace` vocabulary.
    #[test]
    fn test_blocking_dto_shape() {
        let row = json!({
            "_timestamp": 500,
            "o2_dbm_kind": "blocking",
            "o2_dbm_engine": "postgresql",
            "o2_dbm_instance": "pg1",
            "o2_dbm_database": "dbmlab",
            "o2_dbm_blocked_pid": 101,
            "o2_dbm_blocking_pid": 202,
            "o2_dbm_blocked_query": "SELECT 1",
            "o2_dbm_blocking_query": "UPDATE t SET x = 1",
            "o2_dbm_blocked_app": "cart",
            "o2_dbm_blocking_app": "batch",
            "o2_dbm_blocked_fingerprint": "aaa",
            "o2_dbm_blocking_fingerprint": "bbb",
            "o2_dbm_wait_event_type": "Lock",
            "o2_dbm_wait_event": "transactionid",
            "o2_dbm_wait_seconds": 12.5,
        });
        let s = server_vantage::BlockingSample::from_record(&row).unwrap();
        let dto = blocking_sample_to_dto(&s);

        let obj = dto.as_object().unwrap();
        assert!(obj.keys().all(|k| !k.starts_with("o2_dbm_")));
        assert_eq!(dto["timestamp"], json!(500));
        assert_eq!(dto["blocked_pid"], json!(101));
        assert_eq!(dto["blocking_pid"], json!(202));
        assert_eq!(dto["blocked_application"], json!("cart"));
        assert_eq!(dto["blocking_application"], json!("batch"));
        assert_eq!(dto["wait_event_type"], json!("Lock"));
        assert_eq!(dto["wait_seconds"], json!(12.5));
        assert_eq!(dto["db_system"], json!("postgresql"));
        assert_eq!(dto["db_instance"], json!("pg1"));
        assert_eq!(dto["db_namespace"], json!("dbmlab"));
    }

    // ── Free-text search (the UI has always sent it; it was ignored) ────────

    #[test]
    fn test_deadlock_search_matches_and_is_case_insensitive() {
        let events = events_of(&[pg_row(
            300,
            11,
            json!([
                {"pid": 11, "fingerprint": "aaa", "query": "UPDATE accounts SET balance = 1",
                 "app": "checkout", "lock_target": "accounts"},
                {"pid": 22, "fingerprint": "bbb", "query": "UPDATE inventory SET qty = 2"},
            ]),
        )]);
        let ev = &events[0];
        assert!(deadlock_matches_search(ev, ""), "empty term matches all");
        assert!(deadlock_matches_search(ev, "inventory"), "statement text");
        assert!(deadlock_matches_search(ev, "checkout"), "application");
        assert!(deadlock_matches_search(ev, "accounts"), "lock target");
        assert!(deadlock_matches_search(ev, "aaa"), "fingerprint");
        assert!(deadlock_matches_search(ev, "dbmlab"), "database");
        assert!(!deadlock_matches_search(ev, "shipping"));
    }

    /// Search runs AFTER stitching, so a term matching only ONE MySQL side
    /// still returns the whole two-sided deadlock rather than half of it.
    #[test]
    fn test_deadlock_search_runs_after_stitching() {
        let events = events_of(&[
            my_row(1_000_000, 41, "trxA", "aaa", false),
            my_row(1_000_100, 42, "trxB", "bbb", true),
        ]);
        assert_eq!(events.len(), 1);
        // "taaa" appears only in the FIRST side's statement text.
        assert!(deadlock_matches_search(&events[0], "taaa"));
        assert_eq!(events[0].participants.len(), 2, "both sides retained");
    }

    #[test]
    fn test_blocking_search_matches_both_ends() {
        let row = json!({
            "_timestamp": 500,
            "o2_dbm_engine": "postgresql",
            "o2_dbm_blocked_pid": 101,
            "o2_dbm_blocking_pid": 202,
            "o2_dbm_blocked_query": "SELECT * FROM orders",
            "o2_dbm_blocking_query": "UPDATE inventory SET qty = 1",
            "o2_dbm_blocked_app": "cart",
        });
        let s = server_vantage::BlockingSample::from_record(&row).unwrap();
        assert!(blocking_matches_search(&s, ""));
        assert!(blocking_matches_search(&s, "orders"), "blocked side");
        // The handler lowercases the needle before calling; matching is then
        // case-insensitive against mixed-case STORED text.
        assert!(blocking_matches_search(&s, "inventory"), "blocking side");
        assert!(blocking_matches_search(&s, "cart"), "application");
        assert!(!blocking_matches_search(&s, "shipping"));
    }

    /// `namespace` is the spelling the rollup endpoints use; both must reach
    /// the same filter or the UI's one vocabulary silently drops the filter.
    #[test]
    fn test_database_param_accepts_namespace_alias() {
        let q: DeadlocksQuery =
            serde_json::from_value(json!({"namespace": "dbmlab"})).expect("deserializes");
        assert_eq!(q.database(), Some("dbmlab"));

        let q: DeadlocksQuery =
            serde_json::from_value(json!({"database": "explicit"})).expect("deserializes");
        assert_eq!(q.database(), Some("explicit"));

        // Empty is not a filter.
        let q: DeadlocksQuery = serde_json::from_value(json!({"namespace": ""})).unwrap();
        assert_eq!(q.database(), None);

        let b: BlockingQuery = serde_json::from_value(json!({"namespace": "dbmlab"})).unwrap();
        assert_eq!(b.database(), Some("dbmlab"));
    }

    #[test]
    fn test_tail_ttl_micros() {
        // default interval 900 s → min(30 s, 90 s) = 30 s
        assert_eq!(tail_ttl_micros(900), 30_000_000);
        // short interval 60 s → min(30 s, 6 s) = 6 s
        assert_eq!(tail_ttl_micros(60), 6_000_000);
        // degenerate interval → floored at 1 s
        assert_eq!(tail_ttl_micros(1), 1_000_000);
        // huge interval → capped at 30 s
        assert_eq!(tail_ttl_micros(86_400), 30_000_000);
    }

    // ── collection diagnostics ──────────────────────────────────────────────

    /// The load-bearing distinction: no records of ANY kind = we have no
    /// evidence anyone is watching, so we must not claim healthy silence.
    #[test]
    fn test_not_collecting_only_when_no_records_at_all() {
        let silent = CollectionProbe::default();
        assert!(silent.not_collecting());

        // ONE record of any kind is enough to prove the pipe carries traffic.
        // Deliberately conservative: a false "collection is broken" on a
        // healthy quiet database trains the operator to ignore the warning.
        let alive = CollectionProbe {
            records_seen: 1,
            non_event_records: 1,
            ..Default::default()
        };
        assert!(!alive.not_collecting());
    }

    /// Healthy silence, stated positively: lines were parsed, none was a
    /// deadlock. Distinct from "we never read the stream", which is `None`.
    #[test]
    fn test_log_lines_seen_none_when_stream_never_read() {
        assert_eq!(CollectionProbe::default().log_lines_seen(), None);

        let probe = CollectionProbe {
            records_seen: 500,
            non_event_records: 480,
            ..Default::default()
        };
        assert_eq!(probe.log_lines_seen(), Some(480));

        // Records exist but every one is a canonical event: zero raw lines is a
        // real, reportable answer, not "unknown".
        let all_events = CollectionProbe {
            records_seen: 7,
            non_event_records: 0,
            ..Default::default()
        };
        assert_eq!(all_events.log_lines_seen(), Some(0));
    }

    /// The recipe's `collection_interval` is not in the telemetry, so it is
    /// recovered from the MEDIAN gap between distinct sample timestamps.
    #[test]
    fn test_sample_interval_inferred_from_median_gap() {
        let sec = 1_000_000i64;
        // Newest-first, 10 s apart — the shipped recipe interval.
        let probe = CollectionProbe {
            records_seen: 4,
            kind_sample_times: vec![100 * sec, 90 * sec, 80 * sec, 70 * sec],
            ..Default::default()
        };
        assert_eq!(probe.sample_interval_seconds(), Some(10));
    }

    /// A quiet period leaves one huge gap. Median must ignore it; a mean would
    /// report an interval no collector is actually running.
    #[test]
    fn test_sample_interval_median_survives_a_quiet_period() {
        let sec = 1_000_000i64;
        let probe = CollectionProbe {
            records_seen: 5,
            // gaps: 10, 10, 3600, 10 → median 10, mean would be ~907
            kind_sample_times: vec![3630 * sec, 3620 * sec, 3610 * sec, 10 * sec, 0],
            ..Default::default()
        };
        assert_eq!(probe.sample_interval_seconds(), Some(10));
    }

    /// Two points give one gap and no way to tell a real interval from a
    /// coincidence — `None` lets the UI use its non-numeric fallback copy
    /// instead of stating a made-up number.
    #[test]
    fn test_sample_interval_none_when_too_few_samples() {
        let sec = 1_000_000i64;
        assert_eq!(CollectionProbe::default().sample_interval_seconds(), None);
        let two = CollectionProbe {
            records_seen: 2,
            kind_sample_times: vec![10 * sec, 0],
            ..Default::default()
        };
        assert_eq!(two.sample_interval_seconds(), None);
    }

    /// Several blocked sessions found by ONE poll share a timestamp. Deduping
    /// happens in `probe_collection`; if identical stamps did reach the
    /// inference they must not read as a zero-length interval.
    #[test]
    fn test_sample_interval_ignores_zero_gaps() {
        let sec = 1_000_000i64;
        let probe = CollectionProbe {
            records_seen: 6,
            kind_sample_times: vec![20 * sec, 20 * sec, 10 * sec, 10 * sec, 0, 0],
            ..Default::default()
        };
        // Only the real 10 s gaps count.
        assert_eq!(probe.sample_interval_seconds(), Some(10));
    }

    /// Sub-second spacing must never render as "sampled every 0 seconds",
    /// which reads as broken.
    #[test]
    fn test_sample_interval_floors_at_one_second() {
        let probe = CollectionProbe {
            records_seen: 4,
            kind_sample_times: vec![300_000, 200_000, 100_000, 0],
            ..Default::default()
        };
        assert_eq!(probe.sample_interval_seconds(), Some(1));
    }

    /// The probe reaches OUTSIDE the window on purpose, and selects
    /// `o2_dbm_kind` rather than filtering on it — the records that best prove
    /// liveness are the ones that are not events.
    #[test]
    fn test_build_probe_sql_selects_kind_and_does_not_filter_it() {
        let sql = build_probe_sql("dbm_server", 1_000, 2_000);
        assert!(sql.contains("SELECT _timestamp, o2_dbm_kind"));
        assert!(sql.contains("FROM \"dbm_server\""));
        assert!(sql.contains("_timestamp >= 1000 AND _timestamp < 2000"));
        // No kind predicate: filtering it out would discard the evidence.
        assert!(!sql.contains("o2_dbm_kind = "));
        assert!(sql.contains("LIMIT 2000"));
    }

    /// "Last one was 3 days ago" must look STRICTLY before the window, or it
    /// would restate a row the table is already showing.
    #[test]
    fn test_build_last_seen_sql_is_strictly_before_the_window() {
        let sql = build_last_seen_sql("dbm_server", "deadlock", 100, 900, "");
        assert!(sql.contains("_timestamp >= 100 AND _timestamp < 900"));
        assert!(sql.contains("o2_dbm_kind = 'deadlock'"));
        assert!(sql.contains("ORDER BY _timestamp DESC"));
        assert!(sql.contains("LIMIT 1"));
    }

    /// Scope filters carry into the lookback, and stay injection-safe.
    #[test]
    fn test_build_last_seen_sql_applies_and_escapes_scope() {
        let preds = dbm_event_preds(Some("mysql"), None, Some("d'b"));
        let sql = build_last_seen_sql("dbm_server", "deadlock", 0, 10, &preds);
        assert!(sql.contains("o2_dbm_engine = 'mysql'"));
        assert!(sql.contains("o2_dbm_database = 'd''b'"));
    }

    /// The server-vantage path has no rollup job, so reusing the rollup
    /// `Freshness` would report `data_through: 0` on a healthy collector and
    /// trip the staleness banner. `data_through` here is the newest record.
    #[test]
    fn test_event_freshness_reports_newest_record_not_rollup_offset() {
        let probe = CollectionProbe {
            records_seen: 3,
            newest_record: Some(1_700_000_000_000_000),
            ..Default::default()
        };
        let f = event_freshness(&probe);
        assert_eq!(f["data_through"], json!(1_700_000_000_000_000i64));
        assert_eq!(f["live_tail"], json!(false));
        assert_eq!(f["percentiles_estimated"], json!(false));

        // Nothing read at all is null — not 0, which would read as an epoch.
        let f = event_freshness(&CollectionProbe::default());
        assert_eq!(f["data_through"], Value::Null);
    }

    // ── W2.3 · Activity read API ───────────────────────────────────────────
    //
    // Spec §3 W2.3. The load-bearing decision here is that `by_wait_event` and
    // `by_state` are computed by SQL `GROUP BY`, never by folding fetched rows
    // in Rust.
    //
    // WHY IT MATTERS, stated once: `dbm_server` is a SINGLE SHARED logs stream
    // whose deadlock path writes a handful of rows per HOUR. Activity sampling
    // writes ~200 rows/sec for a 200-session instance; across 50 instances that
    // is ~10k rows/sec into the same stream, so a 5-minute window holds millions
    // of rows. Folding the row-limited fetch (capped at MAX_EVENTS_LIMIT = 1000)
    // would present a truncated, unrepresentative sample AS a breakdown — the
    // worst failure shape available, because it looks like an answer.

    /// A stored activity row, keyed on the CANONICAL CONSTANTS rather than on
    /// literal column names.
    ///
    /// Keying a read-side fixture on invented literals is a self-fulfilling
    /// round trip: the DTO would be pinned to the names the TEST chose, not the
    /// names `ActivitySample::to_record()` writes, so a writer/reader split on
    /// any column passes both sides while the endpoint returns nulls in
    /// production. `activity_row_matches_the_writers_own_output` below closes
    /// the loop end-to-end; this keeps the pure-DTO tests honest meanwhile.
    fn activity_row(pid: i64, state: &str, wet: &str, we: &str) -> Value {
        json!({
            "_timestamp": 1_786_415_519_730_706i64,
            server_vantage::O2_DBM_KIND: server_vantage::KIND_ACTIVITY,
            server_vantage::O2_DBM_ENGINE: "postgresql",
            server_vantage::O2_DBM_INSTANCE: "pg1",
            server_vantage::O2_DBM_DATABASE: "dbmlab",
            server_vantage::O2_DBM_SESSION_PID: pid,
            server_vantage::O2_DBM_SESSION_USER: "dbm",
            server_vantage::O2_DBM_SESSION_APP: "dbm-sv-oltp",
            server_vantage::O2_DBM_SESSION_STATE: state,
            server_vantage::O2_DBM_WAIT_EVENT_TYPE: wet,
            server_vantage::O2_DBM_WAIT_EVENT: we,
            server_vantage::O2_DBM_ACTIVITY_QUERY: "UPDATE accounts SET balance = balance ? WHERE id = ?",
            server_vantage::O2_DBM_FINGERPRINT: "abc123",
            server_vantage::O2_DBM_SERVER_QUERY_ID: "4863467322651468673",
            server_vantage::O2_DBM_EXEC_TIME_MS: 859.2,
        })
    }

    /// A "session" count must count SESSIONS, not samples of them.
    ///
    /// Activity writes one row per session per poll, so `COUNT(*)` over a
    /// window counts *observations*: a 200-session instance sampled every 10s
    /// reports ~72,000 "sessions" over an hour. The number is wrong by a factor
    /// of the window length over the poll interval, and it is wrong in the
    /// direction that looks like a busy database — an answer-shaped wrong
    /// answer, which is worse than an empty panel.
    ///
    /// Counting distinct backend pids collapses the samples back to sessions.
    #[test]
    fn test_activity_breakdown_counts_sessions_not_samples() {
        let sql = build_dbm_activity_breakdown_sql(
            "dbm_server",
            server_vantage::O2_DBM_SESSION_STATE,
            None,
            100,
            200,
            "",
            &all_cols(),
        )
        .expect("state breakdown builds");
        assert!(
            sql.contains("COUNT(DISTINCT"),
            "a session count must de-duplicate the per-poll samples, got:\n{sql}"
        );
        assert!(
            !sql.contains("COUNT(*) AS sessions"),
            "COUNT(*) counts samples, not sessions, got:\n{sql}"
        );
    }

    /// The aggregates come from SQL, and the aggregate SQL must actually
    /// AGGREGATE — `GROUP BY` plus a count, not a row projection the caller
    /// folds afterwards.
    #[test]
    fn test_activity_wait_event_aggregate_is_computed_by_sql() {
        let sql = build_dbm_activity_breakdown_sql(
            "dbm_server",
            server_vantage::O2_DBM_WAIT_EVENT_TYPE,
            Some(server_vantage::O2_DBM_WAIT_EVENT),
            100,
            200,
            "",
            &all_cols(),
        )
        .expect("a schema carrying the wait columns must yield a breakdown");
        let upper = sql.to_uppercase();
        assert!(
            upper.contains("GROUP BY"),
            "the breakdown MUST be a GROUP BY: folding a 1000-row fetch over a \
             window holding millions of rows presents a truncated sample as a \
             population breakdown. SQL was: {sql}"
        );
        assert!(
            upper.contains("COUNT("),
            "a breakdown needs a server-side count, got: {sql}"
        );
        assert!(
            sql.contains(server_vantage::O2_DBM_WAIT_EVENT_TYPE)
                && sql.contains(server_vantage::O2_DBM_WAIT_EVENT),
            "grouping is by the ENGINE-NATIVE wait columns (the unified \
             cross-engine taxonomy was withdrawn as unsound)"
        );
        assert!(
            sql.contains(&format!(
                "{} = '{}'",
                server_vantage::O2_DBM_KIND,
                server_vantage::KIND_ACTIVITY
            )),
            "the breakdown must count ACTIVITY rows only, got: {sql}"
        );
        assert!(
            sql.contains("_timestamp >= 100") && sql.contains("_timestamp < 200"),
            "the breakdown must be bounded by the SAME window as the rows"
        );
    }

    /// `by_state` is the same shape over one column.
    #[test]
    fn test_activity_state_aggregate_is_computed_by_sql() {
        let sql = build_dbm_activity_breakdown_sql(
            "dbm_server",
            server_vantage::O2_DBM_SESSION_STATE,
            None,
            100,
            200,
            "",
            &all_cols(),
        )
        .expect("a schema carrying the state column must yield a breakdown");
        let upper = sql.to_uppercase();
        assert!(upper.contains("GROUP BY"), "by_state must aggregate in SQL");
        assert!(upper.contains("COUNT("));
        assert!(sql.contains(server_vantage::O2_DBM_SESSION_STATE));
        assert!(
            !sql.contains(server_vantage::O2_DBM_WAIT_EVENT),
            "a single-column breakdown must not group by a second column"
        );
    }

    /// The breakdown must NOT inherit the row cap. A `LIMIT 1000` on the rows is
    /// correct (they are a labelled sample); the same cap on an aggregate would
    /// silently truncate the breakdown itself.
    #[test]
    fn test_activity_breakdown_is_not_capped_at_the_row_limit() {
        let sql = build_dbm_activity_breakdown_sql(
            "dbm_server",
            server_vantage::O2_DBM_SESSION_STATE,
            None,
            100,
            200,
            "",
            &all_cols(),
        )
        .expect("breakdown");
        assert!(
            !sql.to_uppercase().contains("LIMIT"),
            "the breakdown must not be capped AT ALL: any row cap on an aggregate \
             presents a truncated sample as a population breakdown, which is the \
             exact failure W2.3 [R2] exists to prevent. SQL was: {sql}"
        );
    }

    /// Scope filters carry into the aggregate, or the breakdown describes a
    /// different population than the table beneath it.
    #[test]
    fn test_activity_breakdown_honours_scope_filters_and_escapes_them() {
        let preds = dbm_event_preds(Some("pg' OR '1'='1"), Some("pg1"), None);
        let sql = build_dbm_activity_breakdown_sql(
            "ev\"il",
            server_vantage::O2_DBM_SESSION_STATE,
            None,
            1,
            2,
            &preds,
            &all_cols(),
        )
        .expect("breakdown");
        assert!(
            sql.contains("o2_dbm_instance = 'pg1'"),
            "scope filters must apply to the aggregate too: {sql}"
        );
        assert!(sql.contains("'pg'' OR ''1''=''1'"), "values are escaped");
        assert!(sql.contains("\"ev\"\"il\""), "identifier is escaped");
    }

    /// The rows query stays row-limited and reads the activity kind.
    #[test]
    fn test_activity_rows_sql_reads_the_activity_kind() {
        let sql = build_dbm_events_sql(
            "dbm_server",
            server_vantage::KIND_ACTIVITY,
            100,
            200,
            "",
            50,
            &all_cols(),
        );
        assert!(sql.contains("o2_dbm_kind = 'activity'"));
        assert!(sql.contains("LIMIT 50"));
        assert!(!sql.contains("SELECT *"));
        for col in [
            server_vantage::O2_DBM_SESSION_PID,
            server_vantage::O2_DBM_SESSION_STATE,
            server_vantage::O2_DBM_WAIT_EVENT,
            server_vantage::O2_DBM_BLOCKING_PIDS,
        ] {
            assert!(sql.contains(col), "activity projection is missing {col}");
        }
    }

    /// Storage names must never reach the wire. `o2_dbm_engine` → `db_system`,
    /// `o2_dbm_database` → `db_namespace`, and so on: leaking the prefix makes
    /// every ingest-schema change a breaking UI change.
    #[test]
    fn test_activity_dto_uses_wire_names_not_storage_names() {
        let dto = activity_row_to_dto(&activity_row(81491, "active", "Lock", "transactionid"));
        for wire in [
            "session_pid",
            "session_user",
            "session_app",
            "state",
            "wait_event",
            "wait_event_type",
            "db_system",
            "db_instance",
            "db_namespace",
        ] {
            assert!(
                dto.get(wire).is_some(),
                "the DTO must expose `{wire}`, got: {dto}"
            );
        }
        let rendered = dto.to_string();
        assert!(
            !rendered.contains("o2_dbm_"),
            "no storage name may reach the browser: {rendered}"
        );
        assert_eq!(dto["db_system"], json!("postgresql"));
        assert_eq!(dto["db_namespace"], json!("dbmlab"));
        assert_eq!(dto["session_pid"], json!(81491));
        assert_eq!(dto["wait_event"], json!("transactionid"));
    }

    /// `blocking_pids` is stored as a scalar (X5) but is a real ARRAY on the
    /// wire — the UI must be able to render N blockers.
    #[test]
    fn test_activity_dto_renders_blocking_pids_as_an_array() {
        let mut row = activity_row(81517, "active", "Lock", "tuple");
        row[server_vantage::O2_DBM_BLOCKING_PIDS] =
            server_vantage::store_blocking_pids(&[82363, 81491]);
        let dto = activity_row_to_dto(&row);
        assert_eq!(
            dto["blocking_pids"],
            json!([82363, 81491]),
            "multiple blockers must reach the wire as an array, never a string"
        );
        assert_eq!(dto["blocked"], json!(true));

        let unblocked = activity_row_to_dto(&activity_row(81491, "idle", "Client", "ClientRead"));
        assert_eq!(
            unblocked["blocking_pids"],
            json!([]),
            "an unblocked session renders NO blockers — never [0]"
        );
        assert_eq!(unblocked["blocked"], json!(false));
    }

    /// The breakdown rows become the wire shape, with `share` derived from the
    /// SQL counts — and shares must sum to 1 over the counted population.
    #[test]
    fn test_wait_event_breakdown_dto_computes_share_from_sql_counts() {
        let rows = vec![
            json!({ "wait_event_type": "Lock", "wait_event": "transactionid", "sessions": 30 }),
            json!({ "wait_event_type": "Client", "wait_event": "ClientRead", "sessions": 70 }),
        ];
        let out = wait_event_breakdown(&rows);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["wait_event_type"], json!("Lock"));
        assert_eq!(out[0]["sessions"], json!(30));
        assert!(
            (out[0]["share"].as_f64().unwrap() - 0.3).abs() < 1e-9,
            "share is the fraction of the SQL-counted population, got {}",
            out[0]["share"]
        );
        let total: f64 = out.iter().map(|r| r["share"].as_f64().unwrap()).sum();
        assert!(
            (total - 1.0).abs() < 1e-9,
            "shares must sum to 1, got {total}"
        );
    }

    /// An empty breakdown must not divide by zero.
    #[test]
    fn test_wait_event_breakdown_handles_no_rows() {
        assert!(wait_event_breakdown(&[]).is_empty());
    }

    /// A GROUP BY over a column that is NULL on some rows still counts them:
    /// a Postgres backend on CPU reports `wait_event IS NULL`, and dropping
    /// those would overstate every other bucket's share.
    #[test]
    fn test_wait_event_breakdown_keeps_the_no_wait_bucket() {
        let rows = vec![
            json!({ "wait_event_type": Value::Null, "wait_event": Value::Null, "sessions": 40 }),
            json!({ "wait_event_type": "Lock", "wait_event": "transactionid", "sessions": 60 }),
        ];
        let out = wait_event_breakdown(&rows);
        assert_eq!(out.len(), 2, "the on-CPU (null wait) bucket must survive");
        let total: f64 = out.iter().map(|r| r["share"].as_f64().unwrap()).sum();
        assert!((total - 1.0).abs() < 1e-9, "shares still sum to 1");
    }

    /// `by_state` DTO shape.
    #[test]
    fn test_state_breakdown_dto_shape() {
        let rows = vec![
            json!({ "state": "active", "sessions": 12 }),
            json!({ "state": "idle in transaction", "sessions": 3 }),
        ];
        let out = state_breakdown(&rows);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["state"], json!("active"));
        assert_eq!(out[0]["sessions"], json!(12));
        let rendered = serde_json::to_string(&out).unwrap();
        assert!(
            !rendered.contains("o2_dbm_"),
            "no storage names on the wire"
        );
    }

    /// The activity handler must be registered on the router and re-exported —
    /// a handler nothing routes to is dead code that still passes every unit
    /// test. Both wire-up lines live OUTSIDE api.rs, so nothing else catches it.
    #[test]
    fn test_activity_endpoint_is_wired_up() {
        let router = include_str!("../../../../api/http/src/handler/http/router/mod.rs");
        assert!(
            router.contains("db_monitoring/activity"),
            "the activity route must be registered"
        );
        assert!(
            router.contains("get_dbm_activity"),
            "the route must point at the handler"
        );
        let reexport = include_str!("../../../../api/search/src/traces/mod.rs");
        assert!(
            reexport.contains("get_dbm_activity"),
            "the handler must be re-exported, or the router cannot name it"
        );
    }

    /// **Closes the writer/reader loop.** Every other DTO test builds its own
    /// row; this one feeds the CANONICALIZER'S OWN OUTPUT through the reader, so
    /// a column the writer emits under one name and the reader looks up under
    /// another cannot pass. That split is invisible to both sides in isolation
    /// and surfaces only in production, as an endpoint returning nulls.
    #[test]
    fn test_activity_dto_reads_the_writers_own_output() {
        // The real captured blocked session (see tests_server_vantage.rs).
        let captured = json!({
            "_timestamp": 1_786_415_609_732_198i64,
            "db_system_name": "postgresql",
            "db_namespace": "dbmlab",
            "db_query_text": "UPDATE accounts SET balance = balance ? WHERE id = ?",
            "user_name": "dbm",
            "postgresql_state": "active",
            "postgresql_pid": 82363,
            "postgresql_application_name": "psql",
            "postgresql_query_start": "2026-08-11 02:33:28.874029+00",
            "postgresql_wait_event": "transactionid",
            "postgresql_wait_event_type": "Lock",
            "postgresql_query_id": "4863467322651468673",
            "postgresql_total_exec_time": 859.2,
            "postgresql_blocking_pids": "{82334}",
            "postgresql_blocking_lock_mode": "ShareLock",
        });
        let written = server_vantage::canonicalize_query_sample(
            captured.as_object().expect("fixture is an object"),
        )
        .expect("the captured record must canonicalize")
        .to_record();
        // A stored row is exactly what the writer emitted.
        let row: Value = written
            .into_iter()
            .collect::<serde_json::Map<_, _>>()
            .into();

        let dto = activity_row_to_dto(&row);
        assert_eq!(dto["session_pid"], json!(82363), "dto: {dto}");
        assert_eq!(dto["state"], json!("active"));
        assert_eq!(dto["wait_event"], json!("transactionid"));
        assert_eq!(dto["wait_event_type"], json!("Lock"));
        assert_eq!(dto["db_system"], json!("postgresql"));
        assert_eq!(dto["db_namespace"], json!("dbmlab"));
        assert_eq!(dto["blocking_pids"], json!([82334]));
        assert_eq!(dto["blocked"], json!(true));
        assert!(
            !dto.to_string().contains("o2_dbm_"),
            "no storage name may reach the browser: {dto}"
        );
    }

    /// **The response envelope carries the honesty contract, and nothing else
    /// tests it.**
    ///
    /// W2.3 names the shape literally. Three of those keys are load-bearing
    /// rather than decorative: `sample_interval_seconds` is the disclosure that
    /// the Activity page is SAMPLED (10s by default, not Datadog's 1 Hz), and
    /// `not_collecting`/`freshness` drive the healthy-vs-broken empty state. A
    /// handler returning only `{hits, by_wait_event, by_state}` satisfies every
    /// other test in this file while the page reports a healthy idle database as
    /// broken — the false alarm `LIVENESS_PROBE_MICROS` exists to prevent.
    ///
    /// A source-scrape, matching the four existing `include_str!` guards in this
    /// file: assembling the envelope needs a live search backend, so the keys
    /// cannot be asserted behaviourally in a unit test.
    #[test]
    fn test_activity_response_carries_every_contract_key() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_activity")
            .expect("the activity handler must exist");
        let body = code[start..]
            .split("\n}\n")
            .next()
            .expect("the handler must have a body");

        for key in [
            "hits",
            "by_wait_event",
            "by_state",
            "sample_interval_seconds",
            "not_collecting",
            "log_lines_seen",
            "freshness",
        ] {
            assert!(
                body.contains(&format!("\"{key}\"")),
                "the activity response must carry `{key}` (spec W2.3 response shape)"
            );
        }

        // `truncated` comes from the ROW query, independently of the aggregates.
        // Setting it from the aggregate — which has no LIMIT and so is never
        // truncated — would report a capped 1000-row sample as complete.
        assert!(
            body.contains("\"truncated\""),
            "the activity response must report whether the ROW sample was capped"
        );
    }

    /// **`can_read_stream` must be checked against `StreamType::Logs`.**
    ///
    /// §5.1: server-vantage events live in a LOGS stream, so copy-pasting the
    /// permission check from a TRACE endpoint consults the wrong OFGA object and
    /// SILENTLY AUTHORIZES. This is the one wire-up mistake with a security
    /// consequence, and — like route registration — it is invisible to every
    /// behavioural unit test.
    #[test]
    fn test_activity_checks_read_permission_against_the_logs_stream() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_activity")
            .expect("the activity handler must exist");
        let body = code[start..]
            .split("\n}\n")
            .next()
            .expect("the handler must have a body");

        let call = body
            .find("can_read_stream(")
            .expect("the activity handler must check read permission at all");
        let args = &body[call..body.len().min(call + 200)];
        assert!(
            args.contains("StreamType::Logs"),
            "activity reads a LOGS stream; StreamType::Traces here checks the wrong \
             OFGA object and silently authorizes"
        );
        assert!(
            !args.contains("StreamType::Traces"),
            "the trace stream type is the copy-paste hazard §5.1 names explicitly"
        );
    }

    /// **The breakdown must be gated on the stream schema, exactly as the rows
    /// projection is.**
    ///
    /// `present_dbm_columns` exists because naming an absent column in a
    /// projection fails the WHOLE query with a schema error rather than
    /// returning nulls. That applies to a `GROUP BY` column as much as to a
    /// `SELECT` one — and the exposed case is the common one, not an edge:
    /// every `dbm_server` stream that predates activity ingest, and every
    /// deployment leaving `ZO_DB_MONITORING_ACTIVITY_ENABLED` at its D-G default
    /// of OFF, has no `o2_dbm_session_state` column at all.
    ///
    /// The rows query degrades gracefully there (the projection intersects to
    /// `_timestamp`) and returns empty. An ungated breakdown instead errors, so
    /// the handler 500s where it should have rendered the empty state.
    #[test]
    fn test_activity_breakdown_is_skipped_when_the_column_is_absent() {
        let empty: HashSet<String> = HashSet::new();
        assert!(
            build_dbm_activity_breakdown_sql(
                "dbm_server",
                server_vantage::O2_DBM_SESSION_STATE,
                None,
                100,
                200,
                "",
                &empty,
            )
            .is_none(),
            "a stream with no activity columns must yield NO breakdown query — \
             naming an absent GROUP BY column 500s the endpoint on every \
             not-yet-ingesting deployment"
        );

        // A partial schema: the state column exists but the wait columns do not.
        // The wait breakdown must be skipped while by_state still works.
        let mut partial: HashSet<String> = HashSet::new();
        partial.insert(server_vantage::O2_DBM_SESSION_STATE.to_string());
        assert!(
            build_dbm_activity_breakdown_sql(
                "dbm_server",
                server_vantage::O2_DBM_SESSION_STATE,
                None,
                100,
                200,
                "",
                &partial,
            )
            .is_some(),
            "the column that IS present must still be grouped"
        );
        assert!(
            build_dbm_activity_breakdown_sql(
                "dbm_server",
                server_vantage::O2_DBM_WAIT_EVENT_TYPE,
                Some(server_vantage::O2_DBM_WAIT_EVENT),
                100,
                200,
                "",
                &partial,
            )
            .is_none(),
            "a breakdown naming an absent column must be skipped, not issued"
        );
    }

    /// **The sample-interval disclosure must survive a NON-EMPTY response.**
    ///
    /// This is the honesty requirement, and the 9-step template inverts it by
    /// default. Both shipped handlers compute the probe only `if
    /// hits.is_empty()` — correct for deadlocks, which are rare events, but
    /// activity is a continuous 10s poll. Copying that shape verbatim yields
    /// `sample_interval_seconds: null` on exactly the responses that HAVE
    /// sessions to disclose about, so the page states its sampling fidelity only
    /// when there is nothing to state it about.
    ///
    /// Source-scraped for the same reason as the envelope test: assembling a
    /// response needs a live search backend.
    #[test]
    fn test_activity_discloses_its_sample_interval_even_when_it_has_hits() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_activity")
            .expect("the activity handler must exist");
        let body = code[start..]
            .split("\n}\n")
            .next()
            .expect("the handler must have a body");

        // Find where the interval reaches the response, and make sure it is not
        // fed by a probe that only ran on the empty branch.
        assert!(
            body.contains("sample_interval_seconds"),
            "precondition: the response carries the disclosure"
        );
        let empty_gated_probe = body.contains("if hits.is_empty()")
            && !body.contains("interval_probe")
            && !body.contains("always");
        assert!(
            !empty_gated_probe,
            "sample_interval_seconds must be computed for NON-EMPTY responses too. \
             The deadlocks/blocking template computes its probe only when \
             `hits.is_empty()`, which nulls the sampling disclosure on precisely \
             the responses that have sessions to disclose about. Compute the \
             interval unconditionally (or via a separate always-run probe) and \
             name that path `interval_probe` so this guard can see it."
        );
    }

    /// **A page WITH sessions must never report "collection is broken".**
    ///
    /// `not_collecting` is `hits.is_empty() AND probe.not_collecting()`, and the
    /// conjunction is load-bearing rather than belt-and-braces. The probe read
    /// can fail independently — `probe_collection` deliberately swallows a read
    /// error into an empty row set so a blip cannot name a prerequisite that is
    /// actually fine — which leaves `records_seen == 0` and
    /// `not_collecting() == true` on a perfectly healthy stream.
    ///
    /// Under `OR`, that blip makes the page announce a broken collector WHILE
    /// RENDERING SESSIONS. Found by a surviving `&& → ||` mutation.
    #[test]
    fn test_not_collecting_requires_both_an_empty_page_and_a_silent_probe() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_activity")
            .expect("the activity handler must exist");
        let body = code[start..]
            .split("\n}\n")
            .next()
            .expect("the handler must have a body");

        let line = body
            .lines()
            .find(|l| l.contains("\"not_collecting\""))
            .expect("the response must carry not_collecting");
        assert!(
            line.contains("hits.is_empty()") && line.contains("&&"),
            "not_collecting must require BOTH an empty page AND a silent probe: a \
             failed probe read alone would otherwise report a healthy collector \
             as broken while the table shows sessions. Got: {line}"
        );
        assert!(
            !line.contains("||"),
            "a disjunction here turns a probe read blip into a false alarm: {line}"
        );
    }

    /// **Closes the breakdown seam: the SQL's output keys must be the keys the
    /// DTO reads.**
    ///
    /// The two halves were tested on opposite sides of this join — the DTO tests
    /// hand-built `{"state": …}` rows, and the SQL test only asserted the column
    /// NAME appeared somewhere in the string. Both passed while the builder
    /// emitted an unaliased `SELECT o2_dbm_session_state …`, so the real result
    /// rows were keyed `o2_dbm_session_state` and `state_breakdown`'s
    /// `r.get("state")` found nothing. Every label would have rendered `null`
    /// beside a correct count — a breakdown that names nothing while looking
    /// like an answer.
    ///
    /// This drives the DTO with rows shaped by the BUILDER'S OWN aliases.
    #[test]
    fn test_breakdown_dtos_read_the_keys_the_sql_actually_returns() {
        // Derive the aliases from the SQL the builder emits, not from a literal.
        let sql = build_dbm_activity_breakdown_sql(
            "dbm_server",
            server_vantage::O2_DBM_SESSION_STATE,
            None,
            100,
            200,
            "",
            &all_cols(),
        )
        .expect("breakdown");
        let alias = sql
            .split(" AS ")
            .nth(1)
            .and_then(|s| s.split(',').next())
            .expect("the grouping column must be aliased")
            .trim()
            .to_string();
        assert_eq!(
            alias, "state",
            "by_state must project its grouping column as `state`, got `{alias}` — \
             the DTO reads that key and a storage name here yields null labels"
        );
        // A row shaped exactly as that SQL returns it.
        let out = state_breakdown(&[json!({ alias: "idle in transaction", "sessions": 261 })]);
        assert_eq!(
            out[0]["state"],
            json!("idle in transaction"),
            "the DTO must resolve the label from the SQL's own key, got: {out:?}"
        );

        // Same for the two-column wait breakdown.
        let sql = build_dbm_activity_breakdown_sql(
            "dbm_server",
            server_vantage::O2_DBM_WAIT_EVENT_TYPE,
            Some(server_vantage::O2_DBM_WAIT_EVENT),
            100,
            200,
            "",
            &all_cols(),
        )
        .expect("breakdown");
        assert!(
            sql.contains(&format!(
                "{} AS wait_event_type",
                server_vantage::O2_DBM_WAIT_EVENT_TYPE
            )) && sql.contains(&format!(
                "{} AS wait_event",
                server_vantage::O2_DBM_WAIT_EVENT
            )),
            "both wait columns must carry their wire alias: {sql}"
        );
        let out = wait_event_breakdown(&[
            json!({ "wait_event_type": "Lock", "wait_event": "transactionid", "sessions": 288 }),
        ]);
        assert_eq!(out[0]["wait_event_type"], json!("Lock"));
        assert_eq!(out[0]["wait_event"], json!("transactionid"));

        // And no storage name may survive into the projection's output names.
        assert!(
            !sql.contains("AS o2_dbm_"),
            "a storage name must never be the projected key: {sql}"
        );
    }

    /// **The interval query must count POLLS, not rows.**
    ///
    /// The shared liveness probe scans `PROBE_SCAN_LIMIT` rows of any kind.
    /// Activity writes one row PER SESSION PER POLL, so on a 700-session
    /// instance those 2000 rows span fewer than three polls and
    /// `sample_interval_seconds` — which needs three — returns null. That nulls
    /// the sampling disclosure on the largest deployments, which is precisely
    /// where "is this live or sampled?" is least obvious.
    ///
    /// `SELECT DISTINCT` makes the cap count polls instead of sessions.
    #[test]
    fn test_sample_times_query_counts_polls_not_rows() {
        let sql =
            build_dbm_sample_times_sql("dbm_server", server_vantage::KIND_ACTIVITY, 100, 200, "");
        assert!(
            sql.to_uppercase().contains("SELECT DISTINCT"),
            "the cap must count distinct polls, not rows — one row per session \
             per poll otherwise collapses the window to a single timestamp: {sql}"
        );
        assert!(
            sql.contains("o2_dbm_kind = 'activity'"),
            "the interval is inferred from ACTIVITY polls only: {sql}"
        );
        assert!(
            sql.contains("_timestamp >= 100") && sql.contains("_timestamp < 200"),
            "bounded to the same window: {sql}"
        );
        // Only the timestamp is needed; projecting session columns would make
        // DISTINCT operate on the wrong tuple and restore the row-per-session
        // collapse this query exists to avoid.
        assert!(
            !sql.contains(server_vantage::O2_DBM_SESSION_PID),
            "DISTINCT must be over the timestamp alone: {sql}"
        );

        // Injection-safe like every other builder here.
        let preds = dbm_event_preds(Some("pg' OR '1'='1"), None, None);
        let sql = build_dbm_sample_times_sql("ev\"il", "activity", 1, 2, &preds);
        assert!(sql.contains("'pg'' OR ''1''=''1'"));
        assert!(sql.contains("\"ev\"\"il\""));
    }

    /// D-F: everything stays OSS. An `#[cfg(feature = "enterprise")]` anywhere in
    /// the DBM read API would 404 the endpoint on OSS builds.
    #[test]
    fn test_activity_endpoint_is_not_enterprise_gated() {
        let router = include_str!("../../../../api/http/src/handler/http/router/mod.rs");
        let idx = router
            .find("db_monitoring/activity")
            .expect("route must exist");
        // The ungated DBM block registers the existing six routes; the new one
        // must sit with them, not in an enterprise-gated section.
        let neighbourhood = &router[idx.saturating_sub(2000)..idx];
        assert!(
            neighbourhood.contains("db_monitoring/deadlocks"),
            "the activity route must live beside the other ungated DBM routes"
        );
    }
    // ── W3.4 · Plans read API ───────────────────────────────────────────────

    /// The plans query groups by hash and returns first/last seen plus the call
    /// share — the shape W3.4 specifies.
    #[test]
    fn test_build_dbm_plans_sql_groups_by_hash() {
        let sql = build_dbm_plans_sql("dbm_server", "3a74e60b4bd45cc6", 100, 200, "", &all_cols())
            .expect("the plans query must build when the columns are present");

        assert!(
            sql.contains(&format!("GROUP BY {}", server_vantage::O2_DBM_PLAN_HASH)),
            "distinct plans come from a GROUP BY, not a row fetch folded in Rust: {sql}"
        );
        assert!(
            sql.contains(&format!(
                "{} = '{}'",
                server_vantage::O2_DBM_KIND,
                server_vantage::KIND_TOP_QUERY
            )),
            "the plans query must read top_query records only: {sql}"
        );
        assert!(
            sql.contains("3a74e60b4bd45cc6"),
            "it must be scoped to the requested fingerprint: {sql}"
        );
        assert!(
            sql.contains("_timestamp >= 100 AND _timestamp < 200"),
            "and to the requested window: {sql}"
        );
        for expected in ["first_seen", "last_seen", "calls"] {
            assert!(
                sql.contains(expected),
                "the response needs `{expected}`: {sql}"
            );
        }
    }

    /// **D-H: no per-plan latency, in the SQL or anywhere else.**
    ///
    /// The plan was never executed — the receiver EXPLAINs it with every bind
    /// parameter bound to NULL — while `o2_dbm_exec_time_s` comes from
    /// `pg_stat_statements` REAL executions. Grouping one by the other fabricates
    /// causality, and an earlier draft shipped exactly that as
    /// "the plan that appeared at 03:04 is 8x slower".
    #[test]
    fn test_plans_sql_never_aggregates_latency_by_plan() {
        let sql =
            build_dbm_plans_sql("dbm_server", "fp", 100, 200, "", &all_cols()).expect("plans sql");
        assert!(
            !sql.contains(server_vantage::O2_DBM_EXEC_TIME_S),
            "per-plan latency attributes execution time to a plan that never ran (D-H): {sql}"
        );
        for banned in ["AVG(", "SUM(o2_dbm_exec", "PERCENTILE"] {
            assert!(
                !sql.contains(banned),
                "`{banned}` in the plans query is latency attribution (D-H): {sql}"
            );
        }
    }

    /// The query degrades rather than 500s when the stream predates plan ingest.
    ///
    /// Naming an absent column in a `GROUP BY` fails the WHOLE query with a
    /// schema error, and the exposed case is the common one: every deployment
    /// leaving `ZO_DB_MONITORING_TOP_QUERY_ENABLED` at its default of OFF has
    /// none of these columns.
    #[test]
    fn test_plans_sql_skips_when_the_plan_columns_are_absent() {
        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_PLAN_HASH);
        assert_eq!(
            build_dbm_plans_sql("dbm_server", "fp", 100, 200, "", &without),
            None,
            "a stream with no plan_hash column must skip the query, not 500 the endpoint"
        );
    }

    /// The DTO speaks WIRE names; storage names never reach the browser.
    #[test]
    fn test_plan_row_to_dto_uses_wire_names() {
        let row = json!({
            "plan_hash": "abc123def4567890",
            "plan": "[{\"Plan\":{\"Node Type\":\"Seq Scan\",\"Relation Name\":\"orders\"}}]",
            "first_seen": 100i64,
            "last_seen": 200i64,
            "calls": 42i64,
            "plan_hash_version": 1i64,
        });
        let dto = plan_row_to_dto(&row);

        assert_eq!(dto["plan_hash"], json!("abc123def4567890"));
        assert_eq!(dto["first_seen"], json!(100));
        assert_eq!(dto["last_seen"], json!(200));
        assert_eq!(dto["calls"], json!(42));
        assert_eq!(
            dto["plan_hash_version"],
            json!(1),
            "the version that produced the hash travels with it"
        );
        assert!(
            dto.get("latency").is_none() && dto.get("exec_time_s").is_none(),
            "no latency on a plan DTO (D-H): {dto}"
        );
        for storage in dto.as_object().unwrap().keys() {
            assert!(
                !storage.starts_with("o2_dbm_"),
                "`{storage}` is a STORAGE name and must never reach the browser"
            );
        }
    }

    /// **W2: no call share, because this feed cannot support one.**
    ///
    /// `calls` is `SUM(o2_dbm_calls)` over a DELTA feed, and the receiver's
    /// FIRST emission per statement carries the whole `pg_stat_statements`
    /// backlog — 19,687 calls where every later emission carries ~2. Any window
    /// holding a first emission (or a post-LRU-eviction re-registration)
    /// inflates the denominator by an entire backlog, so the share is a
    /// fabricated proportion of a total that never described the window.
    ///
    /// No arithmetic recovers a true count from this feed, so the field is
    /// DELETED rather than corrected. The three surviving fields are asserted
    /// alongside the absence: an implementation that returned nothing at all
    /// would satisfy the absence check on its own.
    #[test]
    fn test_plan_dto_carries_no_call_share() {
        let row = json!({
            "plan_hash": "h",
            "calls": 42i64,
            "first_seen": 100i64,
            "last_seen": 200i64,
        });
        // The pathological window: one first-emission row dwarfs the real one.
        let dto = plan_row_to_dto(&row);

        assert!(
            dto.get("call_share").is_none(),
            "a share over a delta-feed backlog is not a proportion of the window (W2): {dto}"
        );
        // ...and the fields that DO survive still carry their values, so this
        // is a deletion and not an emptied DTO.
        assert_eq!(dto["plan_hash"], json!("h"));
        assert_eq!(dto["first_seen"], json!(100));
        assert_eq!(dto["last_seen"], json!(200));
    }

    /// The plan text is stored as a JSON STRING and must be parsed for the wire,
    /// tolerating a malformed one rather than failing the read (D-B).
    #[test]
    fn test_plan_dto_parses_the_stored_plan_and_tolerates_garbage() {
        let good = json!({
            "plan_hash": "h",
            "plan": "[{\"Plan\":{\"Node Type\":\"Seq Scan\"}}]",
            "calls": 1i64,
        });
        let dto = plan_row_to_dto(&good);
        assert_eq!(
            dto["plan"][0]["Plan"]["Node Type"],
            json!("Seq Scan"),
            "the wire carries the PARSED plan tree so the UI need not re-parse a string"
        );

        let bad = json!({ "plan_hash": "h", "plan": "{not json", "calls": 1i64 });
        let dto = plan_row_to_dto(&bad);
        assert_eq!(
            dto["plan"],
            Value::Null,
            "a malformed plan reads as absent — it must never fail a read that would \
             otherwise succeed"
        );
        assert_eq!(
            dto["plan_hash"],
            json!("h"),
            "and the rest of the row still lands"
        );
    }

    /// **The response must carry the D-H honesty flags.**
    ///
    /// The UI cannot phrase the disclosure correctly unless the API states the
    /// nature of the data: the plan is generic and NULL-bound, and a stable hash
    /// is not an all-clear. Asserted as a source-scrape, matching the four
    /// existing `include_str!` guards in this file — assembling the envelope
    /// needs a live search backend.
    #[test]
    fn test_plans_response_carries_every_contract_key() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_query_plans")
            .expect("the plans handler must exist");
        let body = code[start..]
            .split("\n}\n")
            .next()
            .expect("the handler must have a body");

        for key in [
            "hits",
            "plan_source",
            "drift_detected",
            "stream",
            "plan_capture",
        ] {
            assert!(
                body.contains(&format!("\"{key}\"")),
                "the plans response must carry `{key}`"
            );
        }
        assert!(
            body.contains("generic_null_bound"),
            "the response must declare the plan is a GENERIC, NULL-BOUND estimate (D-H) — \
             without it the UI cannot honestly label what it renders"
        );
    }

    /// **An empty `hits` has two causes and the UI must be able to tell them
    /// apart.**
    ///
    /// Capture OFF: the stream never ingested a plan hash column at all, so
    /// `build_dbm_plans_sql` returns `None` and no query runs. Capture ON: the
    /// column exists, the query ran, and this particular statement simply has
    /// no plan — `COMMIT`, `ROLLBACK`, `SHOW`, and an already-`EXPLAIN`ed
    /// statement cannot be EXPLAINed at all, so a live deployment legitimately
    /// has fingerprints with zero plans (13 of 50 on the reference rig).
    ///
    /// Both produce `hits: []`. Without this field the UI can only render one
    /// sentence for both and tells a DBA whose capture is already ON to go
    /// switch on `ZO_DB_MONITORING_TOP_QUERY_ENABLED` — sending them to fix a
    /// non-problem.
    #[test]
    fn test_plan_capture_state_reports_off_only_when_the_column_is_absent() {
        assert_eq!(
            plan_capture_state(&all_cols()),
            "on",
            "the stream carries a plan hash column, so capture HAS run — an empty result \
             means this statement is unplannable, not that the feature is off"
        );

        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_PLAN_HASH);
        assert_eq!(
            plan_capture_state(&without),
            "off",
            "no plan hash column has ever been written to this stream, so capture never ran"
        );
    }

    /// The state is a property of the SCHEMA, and must agree with the very same
    /// condition that decides whether a query is issued at all.
    ///
    /// Reported independently of the two, these drift: a future optional-column
    /// tweak could make the builder skip while the state still claimed `on`,
    /// and the UI would tell a user their `COMMIT` is unplannable when in truth
    /// nothing was ever captured.
    #[test]
    fn test_plan_capture_state_agrees_with_whether_the_query_runs() {
        for present in [all_cols(), HashSet::new()] {
            let runs = build_dbm_plans_sql("dbm_server", "fp", 100, 200, "", &present).is_some();
            let claimed_on = plan_capture_state(&present) == "on";
            assert_eq!(
                claimed_on, runs,
                "`plan_capture` must be `on` exactly when the plans query is issued"
            );
        }
    }

    /// **`can_read_stream` must be checked against `StreamType::Logs`.**
    ///
    /// Server-vantage events live in a LOGS stream. Copy-pasting the permission
    /// check from a TRACE endpoint — and `get_dbm_query_endpoints`, the template
    /// this handler mirrors, uses `StreamType::Traces` — consults the wrong OFGA
    /// object and SILENTLY AUTHORIZES.
    #[test]
    fn test_plans_checks_read_permission_against_the_logs_stream() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_query_plans")
            .expect("the plans handler must exist");
        let body = code[start..].split("\n}\n").next().expect("body");

        let call = body
            .find("can_read_stream(")
            .expect("the plans handler must check read permission at all");
        let args = &body[call..body.len().min(call + 200)];
        assert!(
            args.contains("StreamType::Logs"),
            "plans read a LOGS stream; StreamType::Traces here checks the wrong OFGA object \
             and silently authorizes"
        );
    }

    /// The fingerprint is required; the STREAM defaults, as it does for every
    /// other server-vantage read.
    ///
    /// `get_dbm_query_endpoints` — the handler this one otherwise mirrors —
    /// requires `stream` because it aggregates a caller-chosen TRACE stream.
    /// Plans are server-vantage records in the single shared LOGS stream, where
    /// deadlocks, blocking and activity all default to `DEFAULT_SERVER_STREAM`.
    /// Requiring it here would make the UI hardcode a backend constant to call
    /// its own endpoint, and would diverge from its three siblings for no
    /// reason.
    #[test]
    fn test_plans_requires_a_fingerprint_and_defaults_the_stream() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_query_plans")
            .expect("handler");
        let body = code[start..].split("\n}\n").next().expect("body");

        assert!(
            body.contains("fingerprint is required"),
            "a plans query with no fingerprint would scan the whole stream"
        );
        assert!(
            body.contains("DEFAULT_SERVER_STREAM"),
            "an absent stream must fall back to the shared server-vantage stream, matching \
             the deadlocks/blocking/activity handlers"
        );
        assert!(
            !body.contains("stream is required"),
            "requiring the stream would force the UI to hardcode a backend constant"
        );
        // The permission check must precede the range/limit parsing, so a caller
        // cannot probe stream existence through error-message differences.
        let perm = body.find("can_read_stream(").expect("permission check");
        let range = body.find("resolve_range(").expect("range parse");
        assert!(
            perm < range,
            "the stream permission check must run BEFORE the range parsing"
        );
    }

    // ─── W6 · server-side query metrics ──────────────────────────────────────

    /// **The join key is (engine, database, fingerprint) — NOT instance.**
    ///
    /// Measured behind PgBouncer (rig `pooled` profile): the CLIENT vantage
    /// records `o2_db_instance = "pgbouncer"` while the SERVER records
    /// `o2_dbm_instance = "postgres"`. Instance agreement is 16/16 with no
    /// pooler and 3/9 with one, so an instance-keyed join drops EVERY Postgres
    /// match behind a pooler — the exact topology the product already ships a
    /// `pooler` unmatched-reason for.
    ///
    /// `instance` stays in the projection as a DISPLAY field (and as the input
    /// to the ambiguity guard), but constraining on it is the bug.
    #[test]
    fn test_server_metrics_sql_joins_without_instance() {
        let sql = build_dbm_server_metrics_sql(
            "dbm_server",
            "postgresql",
            "shop",
            "3a74e60b4bd45cc6",
            100,
            200,
            &all_cols(),
        )
        .expect("server metrics sql");

        assert!(
            sql.contains("3a74e60b4bd45cc6"),
            "scoped to the requested fingerprint: {sql}"
        );
        assert!(
            sql.contains("postgresql") && sql.contains("shop"),
            "scoped to the requested engine and database: {sql}"
        );
        assert!(
            sql.contains("_timestamp >= 100 AND _timestamp < 200"),
            "scoped to the requested window: {sql}"
        );
        // The instance must never appear as a PREDICATE. It may only appear as
        // a projected/grouped display column.
        assert!(
            !sql.contains(&format!("{} = ", server_vantage::O2_DBM_INSTANCE)),
            "constraining on instance drops every match behind a pooler: {sql}"
        );
    }

    /// The instance is GROUPED, because the guard needs to count candidates.
    ///
    /// Joining without the instance can attribute server metrics to the wrong
    /// instance when two instances share a database name. The response cannot
    /// detect that unless the query returns one row PER instance — a query that
    /// pre-aggregates across instances has already destroyed the evidence.
    #[test]
    fn test_server_metrics_sql_groups_by_instance_so_ambiguity_is_detectable() {
        let sql = build_dbm_server_metrics_sql(
            "dbm_server",
            "postgresql",
            "shop",
            "fp",
            100,
            200,
            &all_cols(),
        )
        .expect("server metrics sql");
        let group_by = sql
            .split("GROUP BY")
            .nth(1)
            .expect("the query must group, or per-instance rows collapse");
        assert!(
            group_by.contains(server_vantage::O2_DBM_INSTANCE),
            "instance must be grouped so >1 candidate is detectable: {sql}"
        );
    }

    /// Only `top_query` records carry these counters.
    #[test]
    fn test_server_metrics_sql_reads_only_top_query_records() {
        let sql = build_dbm_server_metrics_sql(
            "dbm_server",
            "postgresql",
            "shop",
            "fp",
            100,
            200,
            &all_cols(),
        )
        .expect("server metrics sql");
        assert!(
            sql.contains(server_vantage::KIND_TOP_QUERY),
            "the counters live on top_query records only: {sql}"
        );
    }

    /// Degrades rather than 500s when the stream predates top-query ingest.
    ///
    /// Naming an absent column fails the WHOLE query with a schema error, and
    /// the exposed case is the common one: `ZO_DB_MONITORING_TOP_QUERY_ENABLED`
    /// defaults OFF, so a stream that never ingested top queries has none of
    /// these columns and must render an empty section rather than a 500.
    #[test]
    fn test_server_metrics_sql_skips_when_the_counter_columns_are_absent() {
        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_CALLS);
        assert_eq!(
            build_dbm_server_metrics_sql(
                "dbm_server",
                "postgresql",
                "shop",
                "fp",
                100,
                200,
                &without
            ),
            None,
            "a stream with no calls column must skip the query, not 500 the endpoint"
        );
    }

    /// **The capture flag and the SQL gate must not drift.**
    ///
    /// Modelled on `plan_capture_state`: reported independently, the two would
    /// disagree and the UI would tell a user their capture is off while the
    /// query it gates ran fine (or the reverse). This calls BOTH functions —
    /// it is not a source scrape — so the agreement is real.
    #[test]
    fn test_server_metrics_capture_state_agrees_with_the_sql_gate() {
        let present = all_cols();
        assert_eq!(server_metrics_capture_state(&present), "on");
        assert!(
            build_dbm_server_metrics_sql(
                "dbm_server",
                "postgresql",
                "shop",
                "fp",
                100,
                200,
                &present
            )
            .is_some(),
            "`on` must mean the SQL builder actually runs"
        );

        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_CALLS);
        assert_eq!(server_metrics_capture_state(&without), "off");
        assert_eq!(
            build_dbm_server_metrics_sql(
                "dbm_server",
                "postgresql",
                "shop",
                "fp",
                100,
                200,
                &without
            ),
            None,
            "`off` must mean the SQL builder skipped — a flag that disagrees with \
             the gate misreports the pipeline"
        );
    }

    /// The envelope is assembled by a CALLABLE fn, so its shape is tested for
    /// real rather than scraped out of the handler's source text.
    #[test]
    fn test_server_metrics_envelope_shape() {
        let rows = vec![json!({
            "instance": "postgres",
            "calls": 1200i64,
            "rows": 4800i64,
            "exec_time_s": 24.0f64,
            "shared_blks_hit": 900i64,
            "shared_blks_read": 100i64,
            "temp_blks_read": 0i64,
            "temp_blks_written": 0i64,
        })];
        let env = server_metrics_envelope(&rows, "postgresql", "dbm_server", "on");

        assert_eq!(env["server_metrics_capture"], json!("on"));
        assert_eq!(env["stream"], json!("dbm_server"));
        assert_eq!(env["matched"], json!(true));
        assert_eq!(env["instance"], json!("postgres"));
        assert_eq!(env["calls"], json!(1200));
        assert_eq!(env["rows"], json!(4800));
        // The derived mean, which is the ONLY central tendency this feed can
        // support: pg_stat_statements has no percentile.
        assert_eq!(env["mean_exec_time_s"], json!(0.02));
        assert!(
            env.get("p95_exec_time_s").is_none() && env.get("p95").is_none(),
            "a quotient is not a percentile — calling one p95 is a fabrication: {env}"
        );
        for storage in env.as_object().unwrap().keys() {
            assert!(
                !storage.starts_with("o2_dbm_"),
                "`{storage}` is a STORAGE name and must never reach the browser"
            );
        }
    }

    /// **No server match is a NORMAL state, not an error, and not "off".**
    ///
    /// The join is permanently partial by measurement: same-engine fingerprint
    /// convergence is 43% on Postgres and 56% on MySQL, and the dominant cause
    /// is not a defect — the server legitimately sees statements no
    /// instrumented client issued. The three states must be distinguishable.
    #[test]
    fn test_server_metrics_unmatched_is_distinct_from_capture_off() {
        let unmatched = server_metrics_envelope(&[], "postgresql", "dbm_server", "on");
        assert_eq!(unmatched["matched"], json!(false));
        assert_eq!(
            unmatched["server_metrics_capture"],
            json!("on"),
            "capture ran and simply found no counterpart — that is not `off`"
        );
        assert!(
            unmatched.get("unmatched_reason").is_none(),
            "a plain miss blames nothing: {unmatched}"
        );

        let off = server_metrics_envelope(&[], "postgresql", "dbm_server", "off");
        assert_eq!(off["matched"], json!(false));
        assert_eq!(
            off["server_metrics_capture"],
            json!("off"),
            "nothing was ever captured — a different sentence from a plain miss"
        );
    }

    /// **The ambiguity guard: more than one candidate instance resolves to
    /// NOTHING, labelled with the shipped `pooler` vocabulary.**
    ///
    /// Dropping `instance` from the join key is what makes the join survive a
    /// pooler, and the price is that two instances sharing a database name are
    /// indistinguishable. Picking one would attribute another instance's
    /// counters to this query silently. The guard surfaces it instead, and must
    /// not emit the numbers.
    #[test]
    fn test_server_metrics_ambiguous_instances_yield_no_numbers() {
        let rows = vec![
            json!({ "instance": "pg-a", "calls": 10i64, "exec_time_s": 1.0f64 }),
            json!({ "instance": "pg-b", "calls": 90i64, "exec_time_s": 9.0f64 }),
        ];
        let env = server_metrics_envelope(&rows, "postgresql", "dbm_server", "on");

        assert_eq!(
            env["matched"],
            json!(false),
            "two candidates is not a match: {env}"
        );
        assert_eq!(
            env["unmatched_reason"],
            json!("pooler"),
            "reuse the SHIPPED unmatched vocabulary rather than inventing copy"
        );
        assert_eq!(
            env["candidate_instances"],
            json!(["pg-a", "pg-b"]),
            "name the candidates so the reader can disambiguate by hand"
        );
        for banned in ["calls", "rows", "mean_exec_time_s", "exec_time_s"] {
            assert!(
                env.get(banned).is_none(),
                "`{banned}` under ambiguity attributes another instance's counters \
                 to this query: {env}"
            );
        }
    }

    /// **`exec_time_s` means different things per engine and the wire must say
    /// so.**
    ///
    /// `server_vantage.rs:1838-1844` folds Postgres `total_exec_time`
    /// (EXECUTION time) and MySQL `sum_timer_wait` (WAIT time) into one field.
    /// Two different measurements under one name: a reader told "mean execution
    /// time" for MySQL is being told something the collector never measured.
    #[test]
    fn test_server_metrics_names_the_measurement_per_engine() {
        let rows = vec![json!({ "instance": "i", "calls": 100i64, "exec_time_s": 5.0f64 })];

        let pg = server_metrics_envelope(&rows, "postgresql", "dbm_server", "on");
        assert_eq!(pg["exec_time_kind"], json!("execution"));

        let mysql = server_metrics_envelope(&rows, "mysql", "dbm_server", "on");
        assert_eq!(
            mysql["exec_time_kind"],
            json!("wait"),
            "MySQL's sum_timer_wait is WAIT time; calling it execution time \
             attributes a measurement to a thing it did not measure"
        );
    }

    /// **No derived "network + pool wait" figure, anywhere.**
    ///
    /// It would subtract a server MEAN from a client PERCENTILE, over different
    /// populations, over windows that do not even align — the client rollup is
    /// keyed on window-END while these reads are on raw event time.
    #[test]
    fn test_server_metrics_envelope_derives_no_client_server_difference() {
        let rows = vec![json!({ "instance": "i", "calls": 100i64, "exec_time_s": 5.0f64 })];
        let env = server_metrics_envelope(&rows, "postgresql", "dbm_server", "on");
        for banned in [
            "network_time_s",
            "network_and_pool_wait_s",
            "client_server_delta_s",
            "overhead_s",
        ] {
            assert!(
                env.get(banned).is_none(),
                "`{banned}` subtracts a mean from a percentile over misaligned \
                 windows: {env}"
            );
        }
    }

    /// The server-metrics handler must be registered on the router and
    /// re-exported. Both wire-up lines live OUTSIDE api.rs, so nothing else
    /// catches it — and the two existing guards are hardcoded to `activity`,
    /// so this route gets zero coverage without its own pair.
    #[test]
    fn test_server_metrics_endpoint_is_wired_up() {
        let router = include_str!("../../../../api/http/src/handler/http/router/mod.rs");
        assert!(
            router.contains("db_monitoring/query/server_metrics"),
            "the server-metrics route must be registered"
        );
        assert!(
            router.contains("get_dbm_query_server_metrics"),
            "the route must point at the handler"
        );
        let reexport = include_str!("../../../../api/search/src/traces/mod.rs");
        assert!(
            reexport.contains("get_dbm_query_server_metrics"),
            "the handler must be re-exported, or the router cannot name it"
        );
    }

    /// **Server vantage reads a LOGS stream.**
    ///
    /// `StreamType::Traces` here — which the client-vantage endpoints correctly
    /// use — would consult the wrong OFGA object and silently authorize. The
    /// slip is a one-word copy/paste from the neighbouring handler.
    #[test]
    fn test_server_metrics_authorizes_against_the_logs_stream() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_query_server_metrics")
            .expect("the server-metrics handler must exist");
        let body = code[start..]
            .split("\n}\n")
            .next()
            .expect("the handler must have a body");

        // Comments are stripped before asserting. The handler's prose
        // deliberately NAMES `StreamType::Traces` to explain the hazard (as
        // `get_dbm_query_plans` does), and a test that banned the literal
        // would be satisfied by deleting the warning rather than by keeping
        // the call correct. What must be pinned is the CODE.
        let code_only: String = body
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        assert!(
            code_only.contains("can_read_stream(") && code_only.contains("StreamType::Logs"),
            "server-vantage reads must authorize against the LOGS stream: {code_only}"
        );
        assert!(
            !code_only.contains("StreamType::Traces"),
            "Traces is the client-vantage stream type — wrong OFGA object: {code_only}"
        );
    }

    // ── W10 · Table health read API ─────────────────────────────────────────

    /// **One row per RELATION, not one per snapshot.**
    ///
    /// The recipe re-emits every table every 60 s, so an hour's window holds 60
    /// identical-looking rows per table. Returning them raw would render the
    /// same table sixty times and make "the 20 largest tables" a list of one
    /// table. The latest snapshot per relation is the only reading that answers
    /// the question the page asks.
    #[test]
    fn test_build_dbm_table_health_sql_is_one_row_per_relation() {
        let sql = build_dbm_table_health_sql("dbm_server", 100, 200, "", 50, &all_cols())
            .expect("the table-health query must build when the columns are present");

        assert!(
            sql.contains(&format!(
                "GROUP BY {}, {}",
                server_vantage::O2_DBM_SCHEMA,
                server_vantage::O2_DBM_RELATION
            )),
            "distinct tables come from a GROUP BY on (schema, relation), not a \
             row fetch folded in Rust: {sql}"
        );
        assert!(
            sql.contains(&format!(
                "{} = '{}'",
                server_vantage::O2_DBM_KIND,
                server_vantage::KIND_TABLE_STATS
            )),
            "it must read table_stats records only: {sql}"
        );
        assert!(
            sql.contains("_timestamp >= 100 AND _timestamp < 200"),
            "and be scoped to the requested window: {sql}"
        );
        assert!(
            sql.contains("LIMIT 50"),
            "and to the requested limit: {sql}"
        );
    }

    /// **The aggregate must take the LATEST snapshot, never a SUM or an AVG.**
    ///
    /// Every measurement on this feed is a point-in-time state of a relation:
    /// size, live/dead tuples, and cumulative lifetime counters. Summing sixty
    /// snapshots of a 13 MB table reports a 780 MB table; averaging the
    /// cumulative `seq_scan` across a window where it grew reports a number
    /// that was never true at any instant. `MAX` over a monotonic lifetime
    /// counter and over the newest size is the one aggregate that is honest for
    /// both.
    #[test]
    fn test_table_health_sql_never_sums_or_averages_a_snapshot() {
        let sql = build_dbm_table_health_sql("dbm_server", 100, 200, "", 50, &all_cols())
            .expect("table health sql");

        for banned in ["SUM(", "AVG(", "COUNT(o2_dbm"] {
            assert!(
                !sql.contains(banned),
                "`{banned}` over point-in-time snapshots reports a total that was \
                 never true at any instant: {sql}"
            );
        }
        assert!(
            sql.contains(&format!("MAX({})", server_vantage::O2_DBM_TOTAL_BYTES)),
            "size must be the latest observed value: {sql}"
        );
    }

    /// The query degrades rather than 500s when the stream predates table
    /// ingest — the common case, since no shipped deployment has the recipe yet.
    #[test]
    fn test_table_health_sql_skips_when_the_columns_are_absent() {
        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_RELATION);
        assert_eq!(
            build_dbm_table_health_sql("dbm_server", 100, 200, "", 50, &without),
            None,
            "a stream with no relation column must skip the query, not 500 the endpoint"
        );
    }

    /// Injection-safe, like every other builder here.
    #[test]
    fn test_table_health_sql_escapes_its_inputs() {
        let preds = dbm_event_preds(Some("pg' OR '1'='1"), None, None);
        let sql = build_dbm_table_health_sql("ev\"il", 1, 2, &preds, 10, &all_cols())
            .expect("table health sql");
        assert!(sql.contains("'pg'' OR ''1''=''1'"));
        assert!(sql.contains("\"ev\"\"il\""));
    }

    /// **Closes the writer/reader loop** — the DTO is fed the CANONICALIZER'S
    /// OWN OUTPUT, so a column written under one name and read under another
    /// cannot pass. That split is invisible to both sides in isolation and
    /// surfaces only in production, as an endpoint returning nulls.
    #[test]
    fn test_table_health_dto_reads_the_writers_own_output() {
        // The real captured record (see tests_server_vantage.rs).
        let captured = json!({
            "_timestamp": 1_786_500_000_000_000i64,
            "o2_recipe": "pg_table_stats",
            "body": "audit_log",
            "schema_name": "public",
            "heap_bytes": "10510336",
            "total_bytes": "13639680",
            "n_live_tup": "137268",
            "n_dead_tup": "0",
            "dead_tup_pct": "0.00",
            "n_mod_since_analyze": "5547",
            "seq_scan": "0",
            "idx_scan": "0",
            "autovacuum_count": "8",
            "frozen_xid_age": "335437",
            "last_autovacuum": "2026-08-11 23:39:57.939725+00",
            "last_vacuum": "",
            "server_address": "pg-primary:5432",
        });
        let written = server_vantage::canonicalize_table_stats(
            captured.as_object().expect("fixture is an object"),
        )
        .expect("the captured record must canonicalize")
        .to_record();
        let row: Value = written
            .into_iter()
            .collect::<serde_json::Map<_, _>>()
            .into();

        let dto = table_health_row_to_dto(&row);
        assert_eq!(dto["relation"], json!("audit_log"));
        assert_eq!(dto["schema"], json!("public"));
        assert_eq!(dto["total_bytes"], json!(13_639_680i64));
        assert_eq!(dto["live_tuples"], json!(137_268i64));
        assert_eq!(dto["dead_tuples"], json!(0));
        assert_eq!(dto["idx_scan_count"], json!(0));
        assert_eq!(dto["autovacuum_count"], json!(8));
        assert_eq!(
            dto["last_autovacuum"],
            json!("2026-08-11 23:39:57.939725+00")
        );
        assert_eq!(
            dto["last_vacuum"],
            Value::Null,
            "never manually vacuumed reads as null, not an empty string"
        );
    }

    /// **A SECOND, materially different relation — the discriminator.**
    ///
    /// The writer/reader-loop test above uses one fixture, and a DTO hard-coded
    /// to it passed both DTO tests (measured: rung-1 stub attack). A real
    /// reader and a lookup only diverge on a different record, so this one
    /// inverts every value that matters and arrives in the OTHER shape the DTO
    /// must read — the SQL aggregate's wire aliases rather than storage names.
    #[test]
    fn test_table_health_dto_reads_the_aggregate_row_shape() {
        let row = json!({
            "schema_name": "app",
            "relation": "sessions",
            "instance": "pg-replica-2",
            "engine": "postgresql",
            "total_bytes": 1_245_184i64,
            "heap_bytes": 884_736i64,
            "live_tuples": 412i64,
            "dead_tuples": 9130i64,
            "dead_tup_pct": 95.68,
            "mod_since_analyze": 12i64,
            "seq_scan_count": 88_214i64,
            "seq_tup_read": 3_120_044i64,
            "idx_scan_count": 17i64,
            "autovacuum_count": 0i64,
            "frozen_xid_age": 51i64,
            "last_vacuum": "2026-08-10 04:00:01.113402+00",
            "last_analyze": "2026-08-10 04:00:02.881190+00",
            "last_seen": 1_786_600_000_000_000i64,
        });
        let dto = table_health_row_to_dto(&row);

        assert_eq!(dto["relation"], json!("sessions"));
        assert_eq!(dto["schema"], json!("app"));
        assert_eq!(dto["instance"], json!("pg-replica-2"));
        assert_eq!(dto["total_bytes"], json!(1_245_184i64));
        assert_eq!(dto["heap_bytes"], json!(884_736i64));
        assert_eq!(dto["live_tuples"], json!(412i64));
        assert_eq!(dto["dead_tuples"], json!(9130i64));
        assert_eq!(
            dto["dead_tup_pct"],
            json!(95.68),
            "the bloat figure is fractional and must not be truncated"
        );
        assert_eq!(dto["mod_since_analyze"], json!(12i64));
        assert_eq!(dto["seq_scan_count"], json!(88_214i64));
        assert_eq!(dto["seq_tup_read"], json!(3_120_044i64));
        assert_eq!(dto["idx_scan_count"], json!(17i64));
        assert_eq!(
            dto["autovacuum_count"],
            json!(0),
            "zero autovacuums is the finding, not an absence"
        );
        assert_eq!(dto["frozen_xid_age"], json!(51i64));
        assert_eq!(dto["last_vacuum"], json!("2026-08-10 04:00:01.113402+00"));
        assert_eq!(
            dto["last_autovacuum"],
            Value::Null,
            "absent from the row means never autovacuumed"
        );
        assert_eq!(dto["last_analyze"], json!("2026-08-10 04:00:02.881190+00"));
        assert_eq!(dto["last_seen"], json!(1_786_600_000_000_000i64));
    }

    /// The DTO speaks WIRE names; storage names never reach the browser.
    #[test]
    fn test_table_health_dto_uses_wire_names() {
        let row = json!({
            server_vantage::O2_DBM_RELATION: "orders",
            server_vantage::O2_DBM_TOTAL_BYTES: 1000i64,
        });
        let dto = table_health_row_to_dto(&row);
        for storage in dto.as_object().unwrap().keys() {
            assert!(
                !storage.starts_with("o2_dbm_"),
                "`{storage}` is a STORAGE name and must never reach the browser"
            );
        }
    }

    /// **The cumulative/estimated disclosure must reach the WIRE.**
    ///
    /// The ingest side marks every row, but the UI reads the RESPONSE, not the
    /// stored row. Without these on the envelope the page is free to render
    /// "0 sequential scans" under an hour filter — a per-window claim the data
    /// does not support — and "137,268 rows" as an exact count.
    #[test]
    fn test_table_health_response_declares_cumulative_and_estimated() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_table_health")
            .expect("the table-health handler must exist");
        let body = code[start..].split("\n}\n").next().expect("body");

        for key in ["counters_are_cumulative", "tuples_are_estimated"] {
            assert!(
                body.contains(&format!("\"{key}\"")),
                "the response must carry `{key}` — the UI cannot phrase the \
                 disclosure correctly unless the API states it"
            );
        }
        for key in ["hits", "stream", "engine_coverage"] {
            assert!(
                body.contains(&format!("\"{key}\"")),
                "the table-health response must carry `{key}`"
            );
        }
    }

    /// **Postgres-only, and the surface must SAY so per engine.**
    ///
    /// `pg_table_stats` reads `pg_class`/`pg_stat_user_tables`; MySQL, MariaDB
    /// and SQL Server have no equivalent in this recipe set. A MySQL user
    /// filtering to their instance must be told the signal is not collected for
    /// their engine — an empty table with no explanation reads as "no problems
    /// found", which is the single most dangerous empty state this feature can
    /// render.
    #[test]
    fn test_table_health_reports_engine_support_rather_than_an_empty_table() {
        assert_eq!(
            table_health_engine_support("postgresql"),
            "supported",
            "postgres is the engine this recipe queries"
        );
        for unsupported in ["mysql", "mariadb", "mssql"] {
            assert_eq!(
                table_health_engine_support(unsupported),
                "unsupported",
                "`{unsupported}` has no table-stats recipe, and the UI must say \
                 'not collected for this engine' rather than render an empty list"
            );
        }
        assert_eq!(
            table_health_engine_support(""),
            "unknown",
            "an unfiltered request spans engines, so no single verdict applies"
        );
    }

    /// **`can_read_stream` must be checked against `StreamType::Logs`.**
    ///
    /// Server-vantage events live in a LOGS stream. Copy-pasting the permission
    /// check from a TRACE endpoint consults the wrong OFGA object and SILENTLY
    /// AUTHORIZES.
    #[test]
    fn test_table_health_checks_read_permission_against_the_logs_stream() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_table_health")
            .expect("the table-health handler must exist");
        let body = code[start..].split("\n}\n").next().expect("body");

        let call = body
            .find("can_read_stream(")
            .expect("the handler must check read permission at all");
        let args = &body[call..body.len().min(call + 200)];
        assert!(
            args.contains("StreamType::Logs"),
            "table health reads a LOGS stream; StreamType::Traces here checks the \
             wrong OFGA object and silently authorizes"
        );
        // The permission check must precede the range parsing, so a caller
        // cannot probe stream existence through error-message differences.
        let perm = body.find("can_read_stream(").expect("permission check");
        let range = body.find("resolve_range(").expect("range parse");
        assert!(
            perm < range,
            "the stream permission check must run BEFORE the range parsing"
        );
    }

    /// The handler must report a failed schema read rather than absorbing it
    /// into an empty set — an empty set drops the projection and the page would
    /// report a healthy collector as broken.
    #[test]
    fn test_table_health_reports_schema_errors() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_table_health")
            .expect("handler");
        let body = code[start..].split("\n}\n").next().expect("body");

        let call = body
            .find("present_dbm_columns(")
            .expect("the handler must gate on the stream schema");
        let after = &body[call..body.len().min(call + 400)];
        assert!(
            !after.contains("unwrap_or_default()"),
            "swallowing a schema error makes a DB blip indistinguishable from \
             'this stream has no DBM columns'"
        );
        assert!(
            after.contains("internal_error"),
            "a failed schema read must be reported"
        );
    }

    /// The table-health handler must be registered on the router and
    /// re-exported — a handler nothing routes to is dead code that still passes
    /// every unit test. Both wire-up lines live OUTSIDE api.rs, so nothing else
    /// catches it.
    #[test]
    fn test_table_health_endpoint_is_wired_up() {
        let router = include_str!("../../../../api/http/src/handler/http/router/mod.rs");
        assert!(
            router.contains("db_monitoring/table_health"),
            "the table-health route must be registered"
        );
        assert!(
            router.contains("get_dbm_table_health"),
            "the route must point at the handler"
        );
        let reexport = include_str!("../../../../api/search/src/traces/mod.rs");
        assert!(
            reexport.contains("get_dbm_table_health"),
            "the handler must be re-exported, or the router cannot name it"
        );
    }

    /// D-F: everything stays OSS. An `#[cfg(feature = "enterprise")]` here would
    /// 404 the endpoint on OSS builds.
    #[test]
    fn test_table_health_endpoint_is_not_enterprise_gated() {
        let router = include_str!("../../../../api/http/src/handler/http/router/mod.rs");
        let idx = router
            .find("db_monitoring/table_health")
            .expect("route must exist");
        let neighbourhood = &router[idx.saturating_sub(2000)..idx];
        assert!(
            neighbourhood.contains("db_monitoring/deadlocks"),
            "the table-health route must live beside the other ungated DBM routes"
        );
    }
}
