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
/// An unreadable schema yields an empty set, which the caller renders as the
/// `_timestamp`-only projection — degraded, but not a 500.
async fn present_dbm_columns(org_id: &str, stream_name: &str) -> HashSet<String> {
    infra::schema::get(org_id, stream_name, StreamType::Logs)
        .await
        .map(|s| {
            server_vantage::ALL_DBM_FIELDS
                .into_iter()
                .filter(|f| s.field_with_name(f).is_ok())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

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
        let is_mysql = ev.engine.as_deref() == Some("mysql");
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
        let key = (
            ev.engine.clone().unwrap_or_default(),
            ev.instance.clone().unwrap_or_default(),
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
    let present = present_dbm_columns(&org_id, stream).await;
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

    let present = present_dbm_columns(&org_id, stream).await;
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

    #[test]
    fn test_build_dbm_events_sql_exact() {
        let sql = build_dbm_events_sql("dbm_server", "deadlock", 100, 200, "", 50, &all_cols());
        let expected = "SELECT _timestamp, o2_dbm_kind, o2_dbm_engine, o2_dbm_database, o2_dbm_instance, o2_dbm_timestamp, o2_dbm_raw, o2_dbm_victim_pid, o2_dbm_participants, o2_dbm_participant_count, o2_dbm_victim_side, o2_dbm_blocked_pid, o2_dbm_blocked_app, o2_dbm_blocked_query, o2_dbm_blocked_fingerprint, o2_dbm_blocking_pid, o2_dbm_blocking_app, o2_dbm_blocking_query, o2_dbm_blocking_fingerprint, o2_dbm_wait_event_type, o2_dbm_wait_event, o2_dbm_wait_seconds, o2_dbm_query_shape FROM \"dbm_server\"\nWHERE _timestamp >= 100 AND _timestamp < 200\n    AND o2_dbm_kind = 'deadlock'\nORDER BY _timestamp DESC\nLIMIT 50";
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

    /// An unreadable schema degrades to `_timestamp` only — never a 500.
    #[test]
    fn test_build_dbm_events_sql_survives_an_empty_schema() {
        let sql = build_dbm_events_sql("dbm_server", "deadlock", 100, 200, "", 50, &HashSet::new());
        assert!(sql.starts_with("SELECT _timestamp FROM"));
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
}
