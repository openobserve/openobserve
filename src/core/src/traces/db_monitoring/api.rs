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
//! GET handlers structurally modeled on the service-graph read API
//! (`../service_graph/api.rs`): fixed SQL over the `_o2_db_stats` summary
//! stream via `crate::search::search`, read as `StreamType::Logs`.
//!
//! Most of them carry no `#[cfg]` and serve both builds. Three do not:
//! `get_dbm_deadlocks`, `get_dbm_blocking` and `get_dbm_table_health` are
//! dual-implemented — the real handler behind `#[cfg(feature = "enterprise")]`
//! and, on OSS, a stub returning 403 (`unauthorized_response`) before any auth
//! or search work. Their bodies and the server-vantage canonicalizers they read
//! live in `o2_enterprise`.
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
    future::Future,
    sync::{Arc, LazyLock, Mutex},
};

use axum::{
    extract::{Path, Query},
    response::Response as HttpResponse,
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::{get_config, meta::stream::StreamType, utils::time::now_micros};
use futures::{StreamExt, future::join_all};
#[cfg(feature = "enterprise")]
use o2_openfga::config::get_config as get_openfga_config;
use serde::Deserialize;
use serde_json::{Value, json};

/// The chain assembler moved to `o2_enterprise` with the blocking canonicalizer
/// it consumes; `super::chains` is the re-export that keeps this path valid.
#[cfg(feature = "enterprise")]
use super::chains;
use super::{
    rollup::{self, O2_DB_STATS_STREAM, get_i64, get_str, get_str_ref},
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
/// returns `true` there — the endpoints that DO reach it on OSS are the ones
/// whose documented posture is org-level visibility (FRD NFR-6), and denying
/// every read on a build with no OFGA to consult would break them rather than
/// secure them. The gate that matters is the enterprise one, where RBAC is
/// actually configured.
///
/// Note this wrapper is not what gates the enterprise-only endpoints: on OSS,
/// deadlocks/blocking/table health never get here at all, because their
/// handlers are `#[cfg]`-stubbed to 403 before any auth or search runs.
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

/// Which VANTAGE a DBM read is taken from — the one fact that decides which
/// OFGA object its permission check must consult.
///
/// §5.1: the client vantage is application trace spans (a TRACES stream); the
/// server vantage is the database's own records, which arrive as LOGS. Copying
/// a permission check between the two consults the wrong OFGA object and
/// SILENTLY AUTHORIZES — the one wire-up mistake in this file with a security
/// consequence, and one no behavioural test can catch on OSS (where
/// [`can_read_stream`] is permissive by design; see
/// `can_read_stream_is_permissive_on_oss`).
///
/// So the mapping is a VALUE rather than a literal repeated at fifteen call
/// sites: [`required_stream_for`] is pure and asserted directly, and a read
/// that names its vantage cannot name the wrong stream type by copy-paste.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DbmVantage {
    /// What the APPLICATION saw — raw trace spans and the rollup over them.
    Client,
    /// What the DATABASE reported about itself — top queries, plans, activity,
    /// deadlocks, blocking, table health.
    Server,
}

/// The OFGA object type a read from this vantage must be authorized against.
pub(crate) const fn required_stream_for(vantage: DbmVantage) -> StreamType {
    match vantage {
        DbmVantage::Client => StreamType::Traces,
        DbmVantage::Server => StreamType::Logs,
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
/// FR-6 global samples: a deliberately small answer — the page shows "the
/// slowest executions", not "all executions", and 100 rows is already more
/// than a reader scans. Well under the 100k search cap by construction.
const DEFAULT_SAMPLES_LIMIT: usize = 100;
const MAX_SAMPLES_LIMIT: usize = 500;
/// Rows per instance in the `include_breakdown` split. Matches the `limit=200`
/// the page passed on its per-row `GET /queries` call, so folding the split
/// into the overview response shows the same rows it always showed — the
/// breakdown is a SHAPE, not a ranking, and the long tail past this adds
/// pixels rather than meaning.
const DEFAULT_BREAKDOWN_LIMIT: usize = 200;

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

    /// The same scope, as predicates over RAW TRACE SPANS rather than rollup
    /// rows: spans carry the `o2_db_*` column names, not the rollup's aliases
    /// (`db_system` etc.), and have no `trace_stream_name` column at all — the
    /// stream is the table being read, so that filter is applied by choosing
    /// which streams to read (`involved_streams`), never as a predicate.
    /// Same injection contract as [`Self::sql_preds`]: fixed column whitelist,
    /// values single-quote-escaped.
    const SPAN_COLS: [(&'static str, ScopeGetter); 5] = [
        ("o2_db_system", |f| f.system.as_ref()),
        ("o2_db_instance", |f| f.instance.as_ref()),
        ("o2_db_namespace", |f| f.namespace.as_ref()),
        ("o2_db_env", |f| f.env.as_ref()),
        ("service_name", |f| f.service.as_ref()),
    ];

    /// Escaped `AND col = 'value'` fragments for raw-span reads (see
    /// [`Self::SPAN_COLS`]).
    pub(crate) fn span_sql_preds(&self) -> String {
        self.span_sql_preds_for("")
    }

    /// [`Self::span_sql_preds`], qualified for a self-join that ALIASES the
    /// span table (`dbspan.o2_db_system = …`). A bare column name is ambiguous
    /// the moment the same table appears twice, so the alias is not cosmetic —
    /// without it the planner rejects the query outright.
    ///
    /// `alias` is a compile-time literal at every call site, never user input;
    /// the injection contract of the VALUES is unchanged.
    pub(crate) fn span_sql_preds_for(&self, alias: &str) -> String {
        let mut out = String::new();
        for (col, get) in Self::SPAN_COLS {
            if let Some(v) = get(self) {
                out.push_str("\n    AND ");
                out.push_str(alias);
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
    build_stats_sql_projected(org_id, record_type, start_time, end_time, preds, "*")
}

/// [`build_stats_sql`] with an explicit projection, for the reads that consume
/// a handful of columns from rows that drag an up-to-4 KB `query_norm` each
/// under `SELECT *`. `projection` must come from [`stats_projection`] (or be
/// `"*"`): naming a column absent from the stream schema fails the WHOLE query
/// with a schema error, so projections are schema-gated, never assumed.
pub(crate) fn build_stats_sql_projected(
    org_id: &str,
    record_type: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
    projection: &str,
) -> String {
    format!(
        "SELECT {projection} FROM \"{O2_DB_STATS_STREAM}\"\nWHERE _timestamp > {start_time} AND _timestamp <= {end_time}\n    AND org_id = '{}'\n    AND record_type = '{record_type}'{preds}\nLIMIT {STATS_READ_SIZE}",
        escape_sq(org_id)
    )
}

/// The subset of `wanted` columns actually present on the `_o2_db_stats`
/// schema, as a projection list. Falls back to `*` when the schema cannot be
/// read (never fail a read over an optimization) or when nothing intersects
/// (the stream is brand new; the read returns empty anyway).
async fn stats_projection(org_id: &str, wanted: &[&str]) -> String {
    match infra::schema::get(org_id, O2_DB_STATS_STREAM, StreamType::Logs).await {
        Ok(schema) => {
            let cols: Vec<&str> = wanted
                .iter()
                .copied()
                .filter(|c| schema.field_with_name(c).is_ok())
                .collect();
            if cols.is_empty() {
                "*".to_string()
            } else {
                cols.join(", ")
            }
        }
        Err(_) => "*".to_string(),
    }
}

/// Escaped `AND fingerprint = '…'` fragment.
pub(crate) fn fingerprint_pred(fingerprint: &str) -> String {
    format!("\n    AND fingerprint = '{}'", escape_sq(fingerprint))
}

/// The same predicate over RAW TRACE SPANS, which carry the column under its
/// `o2_db_` name — the split [`ScopeFilters::span_sql_preds`] exists for.
///
/// This is the last piece of DBM SQL the BROWSER used to build. The query
/// detail page could not scope `/samples` to one statement, so it hand-rolled
/// `SELECT … WHERE o2_db_fingerprint = '…'` against the trace stream and
/// carried its own `escapeSingleQuotes` and `isSafeStreamName` defenses to do
/// it. Both the escaping and the stream-name validation now live here, where
/// the rest of this module's SQL is built and injection-tested.
pub(crate) fn span_fingerprint_pred(fingerprint: &str) -> String {
    format!("\n    AND o2_db_fingerprint = '{}'", escape_sq(fingerprint))
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
///
/// `scope_preds` carries the rest of the join key (engine, database, …) as
/// `dbspan.`-qualified fragments from [`ScopeFilters::span_sql_preds_for`], and
/// it is the difference between attributing callers and inventing them.
///
/// **A fingerprint is not a join key.** It hashes statement TEXT ONLY, so the
/// same `SELECT` under Postgres and under MySQL is one fingerprint — measured
/// live: fp `69219a9c7fc5039d` in org `default` is 125,195 postgres spans AND
/// 219,713 mysql spans. Aggregated on the fingerprint alone this returns one
/// 344,908-call row that belongs to neither engine, and hands it to a
/// server-vantage row that describes exactly one of them. The caller passes
/// the engine it resolved; with none passed the behaviour is unchanged, which
/// is why the parameter is additive rather than required.
pub(crate) fn build_endpoints_sql(
    stream_name: &str,
    fingerprint: &str,
    start_time: i64,
    end_time: i64,
    scope_preds: &str,
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
    AND dbspan.o2_db_fingerprint = '{}'{scope_preds}
GROUP BY root.service_name, root.operation_name
ORDER BY calls DESC
LIMIT {limit}"#,
        escape_sq(fingerprint)
    )
}

/// FR-6 global samples: the slowest individual DB spans in the window, one
/// stream at a time — no rollup, no fingerprint predicate, the whole DB-span
/// population of the stream ordered by how long each call took.
///
/// Same column vocabulary as [`rollup::build_rank_sql`] (the precedent for
/// referencing `o2_db_*` columns unconditionally on a stream that carries
/// `o2_db_fingerprint`), and durations as `end_time - start_time` — NANOSECONDS,
/// the module's raw-span convention. The span's own `duration` column is
/// MICROseconds and is deliberately not read: one unit for every number this
/// module emits.
pub(crate) fn build_samples_sql(
    stream_name: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
    limit: usize,
) -> String {
    format!(
        r#"SELECT
    _timestamp,
    trace_id,
    end_time - start_time AS duration_ns,
    o2_db_fingerprint AS fingerprint,
    o2_db_query_norm AS query_norm,
    o2_db_system AS db_system,
    o2_db_instance AS db_instance,
    o2_db_namespace AS db_namespace,
    o2_db_env AS env,
    o2_db_operation AS operation,
    o2_db_stmt_class AS stmt_class,
    service_name,
    span_status,
    o2_db_status_code AS status_code
FROM "{}"
WHERE _timestamp >= {start_time} AND _timestamp < {end_time}
    AND o2_db_fingerprint IS NOT NULL{preds}
ORDER BY duration_ns DESC
LIMIT {limit}"#,
        escape_ident(stream_name)
    )
}

/// Merge the per-stream top-`limit` sample reads into one global top-`limit`.
///
/// Each input stream's rows are its own slowest spans (its SQL is
/// `ORDER BY … DESC LIMIT limit`), so the union contains the true global
/// top-`limit` — a span missing from its stream's top-`limit` cannot be in the
/// global one. Rows are stamped with the stream they came from
/// (`trace_stream_name`) because the trace pivot needs a concrete stream to
/// open.
///
/// `truncated` answers "were there more qualifying spans than returned?": true
/// when the union outgrew the cap, or when any single stream answered exactly
/// its per-stream cap (its own read was cut, so spans beyond the returned set
/// exist even if the union fit). Ties order by timestamp then trace id so the
/// answer is deterministic.
pub(crate) fn fold_sample_rows(
    per_stream: Vec<(String, Vec<Value>)>,
    limit: usize,
) -> (Vec<Value>, bool) {
    let mut any_capped = false;
    let mut all: Vec<Value> = Vec::new();
    for (stream, rows) in per_stream {
        any_capped |= rows.len() >= limit;
        for mut row in rows {
            row["trace_stream_name"] = json!(stream);
            all.push(row);
        }
    }
    let total = all.len();
    all.sort_by(|a, b| {
        get_i64(b, "duration_ns")
            .cmp(&get_i64(a, "duration_ns"))
            .then_with(|| get_i64(b, "_timestamp").cmp(&get_i64(a, "_timestamp")))
            .then_with(|| get_str(a, "trace_id").cmp(&get_str(b, "trace_id")))
    });
    all.truncate(limit);
    (all, any_capped || total > limit)
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

/// Fold `error_class` rollup rows (one per window × (system, instance, env,
/// status code)) into one exact count per status code, largest first — the
/// FR-5 errors-by-code breakdown. These are the rollup's exact per-SQLSTATE
/// counts, never the sample-derived approximation the detail page previously
/// held: samples are capped, so counting them undercounts precisely when
/// errors matter most. An empty code becomes `unknown`, matching the rollup's
/// own `COALESCE(o2_db_status_code, 'unknown')` bucket. Ties sort by code so
/// the output is deterministic.
pub(crate) fn fold_error_code_counts(rows: &[Value]) -> Vec<Value> {
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for row in rows {
        let code = get_str(row, "status_code");
        let code = if code.is_empty() {
            "unknown".to_string()
        } else {
            code
        };
        *counts.entry(code).or_insert(0) += get_i64(row, "errors");
    }
    let mut out: Vec<(String, i64)> = counts.into_iter().collect();
    out.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    out.into_iter()
        .map(|(status_code, errors)| json!({ "status_code": status_code, "errors": errors }))
        .collect()
}

/// Fold the constituent `query_stats` rows fetched for ONE fingerprint into
/// per-(instance, namespace) totals — the FR-5 "where it runs" breakdown.
///
/// The history series merges these same rows per WINDOW, discarding the
/// dimension detail the rollup deliberately keeps (rank stage keeps ALL
/// constituent rows of a winning fingerprint, per namespace × env × service).
/// This fold is the other projection of the same fetch: per dimension,
/// summed across windows. Zero additional reads.
///
/// Two contracts the caller relies on:
///
/// - NULL and `""` both mean "absent" in `_o2_db_stats` — `get_str` collapses both to `""`, so one
///   instance can never split into two rows over which spelling of absent its spans carried.
/// - These are totals over the windows the fingerprint was TRACKED in on that instance (rank is per
///   (system, instance)). A window where it ranked below the per-instance cutoff contributes
///   nothing, so the figures are floors, never exact window totals — the UI must disclose, not
///   render absence as zero.
///
/// Sorted by total time descending; ties break by (instance, namespace) so the
/// output is deterministic. Percentiles/max ride along from [`merge_rows`]
/// (request-weighted, i.e. estimates).
pub(crate) fn fold_instance_breakdown<'a>(rows: impl IntoIterator<Item = &'a Value>) -> Vec<Value> {
    let mut groups: BTreeMap<(String, String), Vec<&'a Value>> = BTreeMap::new();
    for row in rows {
        let key = (get_str(row, "db_instance"), get_str(row, "db_namespace"));
        groups.entry(key).or_default().push(row);
    }
    let mut out: Vec<Value> = groups
        .into_iter()
        .map(|((instance, namespace), group)| {
            let mut merged = merge_rows(group);
            merged["db_instance"] = json!(instance);
            merged["db_namespace"] = json!(namespace);
            merged
        })
        .collect();
    out.sort_by(|a, b| {
        get_i64(b, "total_time_ns")
            .cmp(&get_i64(a, "total_time_ns"))
            .then_with(|| get_str(a, "db_instance").cmp(&get_str(b, "db_instance")))
            .then_with(|| get_str(a, "db_namespace").cmp(&get_str(b, "db_namespace")))
    });
    out
}

/// Stamp each overview row with its calls-per-second over the requested window
/// (FR-1). Computed at READ time because only the read knows the window it was
/// asked for — the stored rows carry raw window counts. Left unrounded; the UI
/// owns display precision. Rows without a `calls` metric (a trafficless
/// instance never emitted one) are left unstamped, so absence keeps meaning
/// "not measured" rather than becoming a fabricated 0/s.
pub(crate) fn stamp_qps(hits: &mut [Value], start_time: i64, end_time: i64) {
    let window_secs = (end_time - start_time) as f64 / 1_000_000.0;
    if window_secs <= 0.0 {
        return;
    }
    for row in hits.iter_mut() {
        if row.get("calls").is_some_and(|v| !v.is_null()) {
            row["qps"] = json!(get_i64(row, "calls") as f64 / window_secs);
        }
    }
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
            // distinct dimension sets. `query_norm` is up to 4 KB per row, so
            // the candidates are BORROWED and only the winner is cloned.
            let mut norm: &str = "";
            let mut operation = String::new();
            let mut stmt_class = String::new();
            let mut namespaces: BTreeSet<String> = BTreeSet::new();
            let mut envs: BTreeSet<String> = BTreeSet::new();
            let mut services: BTreeSet<String> = BTreeSet::new();
            for row in &rows {
                let n = get_str_ref(row, "query_norm");
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
            // The scalar survives the fold when the constituents agree on
            // exactly one database. It used to vanish here unconditionally —
            // collected into `namespaces` but never re-emitted — and the
            // scalar is the server-vantage JOIN KEY: without it the detail
            // page could not ask for the database's own counters and rendered
            // "not collected" over 1,000+ matching server records (verified
            // live on fingerprint fa61ae4b0c9ff1a2). Never invented when the
            // fingerprint genuinely ran on several databases: attributing one
            // database's counters to another is worse than asking nothing.
            if namespaces.len() == 1 {
                merged["db_namespace"] = json!(namespaces.iter().next().unwrap());
            }
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
///
/// Takes the ALREADY-LOWERCASED needle: the caller hoists the one
/// `to_lowercase()` out of its retain loop instead of paying it per row. For
/// an ASCII needle (SQL search terms, overwhelmingly) the match compares in
/// place instead of allocating a lowered copy of up-to-4 KB query text per
/// row; non-ASCII needles keep the full Unicode-folding comparison.
pub(crate) fn search_matches(row: &Value, needle_lower: &str) -> bool {
    let norm = get_str_ref(row, "query_norm");
    let norm_hit = if needle_lower.is_empty() {
        true
    } else if needle_lower.is_ascii() {
        let needle = needle_lower.as_bytes();
        norm.as_bytes()
            .windows(needle.len())
            .any(|w| w.eq_ignore_ascii_case(needle))
    } else {
        norm.to_lowercase().contains(needle_lower)
    };
    norm_hit || get_str_ref(row, "fingerprint").starts_with(needle_lower)
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
    /// `Arc`, so a hit hands out a pointer copy instead of deep-cloning two
    /// row vectors under the global mutex — the hold time is what every other
    /// request in the process queues on.
    data: Arc<TailData>,
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
    ) -> Option<Arc<TailData>> {
        let map = self.map.lock().unwrap();
        let entry = map.get(&(org_id.to_string(), stream.to_string()))?;
        if entry.offset != offset || now - entry.computed_at >= ttl_micros {
            return None;
        }
        Some(Arc::clone(&entry.data))
    }

    /// Store one computed tail; returns the shared handle so the computing
    /// caller keeps the same allocation it just cached.
    pub(crate) fn put(
        &self,
        org_id: &str,
        stream: &str,
        offset: i64,
        now: i64,
        data: TailData,
    ) -> Arc<TailData> {
        let data = Arc::new(data);
        let mut map = self.map.lock().unwrap();
        map.insert(
            (org_id.to_string(), stream.to_string()),
            TailCacheEntry {
                computed_at: now,
                offset,
                data: Arc::clone(&data),
            },
        );
        data
    }
}

static TAIL_CACHE: LazyLock<TailCache> = LazyLock::new(TailCache::new);

/// Single-flight guard for tail computation. The current and the Δ-baseline
/// windows resolve the same `(org, stream)` tails CONCURRENTLY, and on a cache
/// miss both used to compute the identical tail — two full two-stage searches
/// for one answer. One caller computes under the per-key lock, the other
/// awaits it and re-reads the cache. Entries are one small `Arc` per
/// `(org, stream)` — the same bounded population the cache itself holds.
type TailFlights = HashMap<(String, String), Arc<tokio::sync::Mutex<()>>>;
static TAIL_FLIGHTS: LazyLock<Mutex<TailFlights>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Tail cache TTL: `min(30 s, interval/10)` (D4), floored at 1 s.
pub(crate) fn tail_ttl_micros(interval_secs: u64) -> i64 {
    let tenth = (interval_secs as i64).saturating_mul(1_000_000) / 10;
    tenth.clamp(1_000_000, 30_000_000)
}

/// Compute (or serve from cache) the live tail for one `(org, trace stream)`.
/// Returns `None` when the live tail is disabled.
///
/// `offset` is the stream's rollup offset, resolved by the caller — the whole
/// fleet's offsets come from ONE prefix read in [`collect_tails`], where this
/// function used to issue its own per-stream meta-DB round trip on every
/// request.
async fn get_or_compute_tail(org_id: &str, stream: &str, offset: i64) -> Option<Arc<TailData>> {
    let cfg = get_config();
    if !cfg.db_monitoring.live_tail {
        return None;
    }
    let now = now_micros();
    let interval_micros = (cfg.db_monitoring.interval_secs as i64).max(1) * 1_000_000;
    let ttl = tail_ttl_micros(cfg.db_monitoring.interval_secs);

    if let Some(t) = TAIL_CACHE.get(org_id, stream, offset, now, ttl) {
        return Some(t);
    }

    // Single-flight: whoever holds the per-key lock computes; everyone else
    // waits and finds the fresh entry on the re-check below.
    let flight = {
        let mut flights = TAIL_FLIGHTS.lock().unwrap();
        Arc::clone(
            flights
                .entry((org_id.to_string(), stream.to_string()))
                .or_default(),
        )
    };
    let _guard = flight.lock().await;
    if let Some(t) = TAIL_CACHE.get(org_id, stream, offset, now_micros(), ttl) {
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
        return Some(TAIL_CACHE.put(org_id, stream, offset, now, data));
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
    // Rank and totals are independent stages of the same bounded form — run
    // them concurrently rather than back to back.
    let (rank_rows, totals_rows) = tokio::join!(
        rollup::run_dbm_search(org_id, rank_sql, tail_start, now),
        rollup::run_dbm_search(org_id, totals_sql, tail_start, now),
    );
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
    Some(TAIL_CACHE.put(org_id, stream, offset, now, data))
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
    let req = rollup::dbm_search_request(sql, start_time, end_time, STATS_READ_SIZE as i64, 30);
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
        return if can_read_stream(org_id, user_id, s, required_stream_for(DbmVantage::Client)).await
        {
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

    // One RBAC check per stream, CONCURRENTLY — on enterprise each is a
    // network OFGA round trip, and the serial form summed them.
    let streams: Vec<String> = set.into_iter().collect();
    let verdicts = join_all(streams.iter().map(|stream| {
        can_read_stream(
            org_id,
            user_id,
            stream,
            required_stream_for(DbmVantage::Client),
        )
    }))
    .await;
    Some(
        streams
            .into_iter()
            .zip(verdicts)
            .filter_map(|(stream, ok)| ok.then_some(stream))
            .collect(),
    )
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
    tails: Vec<Arc<TailData>>,
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
    // ONE prefix read for every stream's offset — this used to be a meta-DB
    // round trip per stream here, plus a second one inside each tail
    // computation. A stream absent from the map is a fresh stream (offset 0),
    // exactly as `get_offset` answers for a missing key; a failed LIST is not
    // a fleet of fresh streams — the tails are skipped for this request and
    // staleness surfaces through `data_through` alone, the same degradation
    // the per-stream read failure produced.
    let offsets = match crate::db::db_monitoring::list_offsets(org_id).await {
        Ok(map) => Some(map),
        Err(e) => {
            log::warn!(
                "[DbMonitoring] {org_id} offsets read failed; live tails skipped, streams excluded from data_through: {e}"
            );
            None
        }
    };
    let offset_of = |stream: &str| -> i64 {
        offsets
            .as_ref()
            .and_then(|m| m.get(stream))
            .map_or(0, |o| o.0)
    };

    let mut data_through = i64::MAX;
    if offsets.is_some() {
        for stream in streams {
            data_through = data_through.min(offset_of(stream));
        }
    }
    // No streams, or no readable offset at all.
    if data_through == i64::MAX {
        data_through = 0;
    }

    let mut tails = Vec::new();
    let mut tail_covers_from: Option<i64> = None;
    let mut tail_through: Option<i64> = None;
    let mut truncated = false;
    if cfg.db_monitoring.live_tail && offsets.is_some() {
        // Every stream's tail concurrently — each is its own bounded pair of
        // searches (or a cache hit), with no ordering between streams.
        let computed = join_all(
            streams
                .iter()
                .map(|stream| get_or_compute_tail(org_id, stream, offset_of(stream))),
        )
        .await;
        for t in computed.into_iter().flatten() {
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

// ─── Δ-baseline plumbing (shared by the databases and queries bodies) ────────

/// Validate the Δ baseline pair: both or neither, start before end.
fn parse_baseline_pair(
    start: Option<i64>,
    end: Option<i64>,
) -> Result<Option<(i64, i64)>, HttpResponse> {
    match (start, end) {
        (Some(bs), Some(be)) if bs < be => Ok(Some((bs, be))),
        (None, None) => Ok(None),
        _ => Err(MetaHttpResponse::bad_request(
            "baseline_start_time and baseline_end_time must be supplied together, start before end",
        )),
    }
}

/// Run one window reader for the current window and — CONCURRENTLY, when one
/// was requested — the Δ baseline window. The pair used to be two sequential
/// HTTP requests from the page.
async fn read_current_and_baseline<T, F, Fut>(
    read_window: F,
    start_time: i64,
    end_time: i64,
    baseline: Option<(i64, i64)>,
) -> (Result<T, HttpResponse>, Option<Result<T, HttpResponse>>)
where
    F: Fn(i64, i64) -> Fut,
    Fut: Future<Output = Result<T, HttpResponse>>,
{
    let current_fut = read_window(start_time, end_time);
    match baseline {
        Some((bs, be)) => {
            let (c, b) = tokio::join!(current_fut, read_window(bs, be));
            (c, Some(b))
        }
        None => (current_fut.await, None),
    }
}

/// Insert the baseline enrichment keys plus the `baseline_read_failed` flag.
///
/// The baseline is enrichment — it feeds the Δ comparison, not the table — so
/// its failure degrades to empty sections, STATED rather than implied by
/// emptiness (each section key gets `[]` and the flag says why), exactly as
/// table_health's index section does.
fn stamp_baseline_sections(body: &mut Value, sections: Vec<(&str, Value)>, failed: bool) {
    let extra = body.as_object_mut().expect("body is an object");
    for (key, value) in sections {
        extra.insert(key.to_string(), value);
    }
    extra.insert("baseline_read_failed".into(), json!(failed));
}

// ─── Handlers ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct DatabasesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub service: Option<String>,
    /// The Δ baseline window, returned as `baseline_hits` in the same
    /// response. The CLIENT computes the bounds — the baseline is a reader
    /// choice (previous window, same hours yesterday) this endpoint must not
    /// guess at. Both or neither; the pair rides one round trip and the two
    /// windows are read concurrently, where the page used to issue two
    /// requests for them.
    pub baseline_start_time: Option<i64>,
    pub baseline_end_time: Option<i64>,
    /// Fold the per-instance schema → service split into THIS response, keyed
    /// by instance, instead of the page issuing `GET /queries?instance=<row>`
    /// once per expanded row (and re-issuing all of them on every window
    /// change). Opt-in for the same reason `include_indexes` is: the split is
    /// a drill-down nobody has opened yet on first paint.
    ///
    /// It costs no additional search: the fingerprint rows the split needs are
    /// the `query_stats` pool this window ALREADY read to compute
    /// `calling_services`. The fold is the same `group_query_rows(.., None,
    /// false)` the queries endpoint runs for `stmt_class=all` under an
    /// instance scope, so the rows are the ones the page used to receive.
    pub include_breakdown: Option<bool>,
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
        ("baseline_start_time" = Option<i64>, Query, description = "Δ baseline window start (microseconds); returns baseline_hits in the same response"),
        ("baseline_end_time" = Option<i64>, Query, description = "Δ baseline window end (microseconds)"),
        ("include_breakdown" = Option<bool>, Query, description = "Also return the per-instance schema→service split as `breakdown` (one entry per instance), folded from the query_stats rows this window already read"),
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
    match read_databases_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// The databases endpoint's whole body — validation, both windows, envelope —
/// as a callable, so [`get_dbm_badges`] runs the SAME pipeline the tab renders
/// and the badge cannot disagree with the page by construction. `Err` carries
/// the ready HTTP response, exactly as [`read_databases_window`] does.
async fn read_databases_body(
    org_id: &str,
    user_id: &str,
    q: &DatabasesQuery,
) -> Result<Value, HttpResponse> {
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let baseline = parse_baseline_pair(q.baseline_start_time, q.baseline_end_time)?;

    let (current, baseline_out) = read_current_and_baseline(
        |s, e| read_databases_window(org_id, user_id, q, s, e),
        start_time,
        end_time,
        baseline,
    )
    .await;
    let window = current?;

    let mut body = json!({
        "hits": window.hits,
        "top_n_subset": window.top_n_subset,
        "freshness": window.freshness.to_json(),
    });
    if let Some(breakdown) = window.breakdown {
        let extra = body.as_object_mut().expect("body is an object");
        extra.insert("breakdown".into(), breakdown);
        // Stated, never implied by emptiness — the same rule `index_read_failed`
        // follows. The split rides the pool this window already read, so the
        // only way it can be absent is the whole window failing (which is a
        // 500, not this flag); the flag exists so the page can tell "no rows
        // to attribute" from "we could not attribute", and stays wired for a
        // future fold that CAN fail independently.
        extra.insert("breakdown_read_failed".into(), json!(false));
    }
    if let Some(baseline_result) = baseline_out {
        match baseline_result {
            Ok(b) => {
                stamp_baseline_sections(&mut body, vec![("baseline_hits", json!(b.hits))], false)
            }
            Err(_) => stamp_baseline_sections(&mut body, vec![("baseline_hits", json!([]))], true),
        }
    }
    Ok(body)
}

/// One window of the FR-1 overview, ready to serialize.
struct DatabasesWindow {
    hits: Vec<Value>,
    top_n_subset: bool,
    freshness: Freshness,
    /// The per-instance split, present only when `include_breakdown` asked for
    /// it. A JSON object `{ db_instance: [query_stats rows] }` — see
    /// [`fold_breakdown_by_instance`]. Only the CURRENT window's is serialized;
    /// the Δ baseline has no drill-down to draw.
    breakdown: Option<Value>,
}

/// The whole per-window pipeline of the databases overview — searches, RBAC,
/// tails, grouping, services, freshness — extracted verbatim from the handler
/// so the Δ baseline can be a second concurrent call rather than a second
/// endpoint round trip. `Err` carries the ready HTTP response because each
/// failure already knew its status; the handler returns it for the CURRENT
/// window and degrades on the baseline.
async fn read_databases_window(
    org_id: &str,
    user_id: &str,
    q: &DatabasesQuery,
    start_time: i64,
    end_time: i64,
) -> Result<DatabasesWindow, HttpResponse> {
    let cfg = get_config();
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
        org_id,
        "db_totals",
        start_time,
        end_time,
        &totals_filters.sql_preds(),
    );
    // The overview consumes only dimensions, `calling_services` inputs and the
    // merge metrics from `query_stats` rows — never `query_norm` (up to 4 KB
    // per row) nor `operation`/`stmt_class`. Projecting spares the columnar
    // read its dominant column. Schema-gated (see `stats_projection`).
    let qs_projection = stats_projection(
        org_id,
        &[
            "fingerprint",
            "db_system",
            "db_instance",
            "db_namespace",
            "env",
            "service_name",
            "trace_stream_name",
            "statements",
            "calls",
            "errors",
            "total_time_ns",
            "traces",
            "rows_returned",
            "rows_emitting_calls",
            "p50_ns",
            "p95_ns",
            "p99_ns",
            "max_ns",
        ],
    )
    .await;
    let qs_sql = build_stats_sql_projected(
        org_id,
        "query_stats",
        start_time,
        end_time,
        &filters.sql_preds(),
        &qs_projection,
    );
    // Concurrent, where they were awaited one after the other: two independent
    // record families over the same summary stream have no ordering to honour.
    let (totals_rows, qs_rows) = match tokio::join!(
        run_stats_search(org_id, totals_sql, start_time, end_time),
        run_stats_search(org_id, qs_sql, start_time, end_time),
    ) {
        (Ok(t), Ok(q)) => (t, q),
        (t, q) => {
            let e = t.err().or(q.err()).unwrap();
            log::error!("[DbMonitoring] databases rollup read failed for {org_id}: {e}");
            return Err(MetaHttpResponse::internal_error(e));
        }
    };

    let Some(streams) = involved_streams(
        org_id,
        user_id,
        q.stream.as_ref(),
        &[&totals_rows[..], &qs_rows[..]],
    )
    .await
    else {
        return Err(unauthorized_response());
    };
    let collected = collect_tails(org_id, &streams, start_time, end_time).await;
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
    // FR-1: calls-per-second over THIS window (the baseline call passes its own
    // bounds, so baseline rows carry a rate over the baseline window).
    stamp_qps(&mut hits, start_time, end_time);
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

    // The drill-down, folded from the pool this window ALREADY read — it is
    // the same `query_stats` set `calling_services` above consumed, so the
    // split costs no search of its own. This replaced one
    // `GET /queries?instance=<row>&stmt_class=all` PER EXPANDED ROW, re-fired
    // for every open row on every window change.
    let breakdown = q
        .include_breakdown
        .unwrap_or(false)
        .then(|| fold_breakdown_by_instance(&qs_pool));

    Ok(DatabasesWindow {
        hits,
        top_n_subset,
        freshness,
        breakdown,
    })
}

/// Fold scope-filtered `query_stats` rows into `{ db_instance: [rows] }` — the
/// per-instance drill-down the overview's expandable rows render.
///
/// Each instance's rows are EXACTLY what `GET /queries?instance=<it>&
/// stmt_class=all&sort=<default>` returns for the same window and scope: the
/// same [`group_query_rows`] fold, with `class_filter: None` (the row's own
/// total counts every statement class, so filtering to one would manufacture a
/// shortfall) and `allow_other: false` (an instance scope is narrower than the
/// grain `_other` reconciles at — §5.2 — which is why the standalone call also
/// dropped the remainder and reported `top_n_subset`). Sorted and truncated the
/// same way, so an expanded row shows the rows it always showed.
fn fold_breakdown_by_instance(qs_pool: &[Value]) -> Value {
    let mut by_instance: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for row in qs_pool {
        let instance = get_str(row, "db_instance");
        if instance.is_empty() {
            continue;
        }
        by_instance.entry(instance).or_default().push(row.clone());
    }
    let folded: serde_json::Map<String, Value> = by_instance
        .into_iter()
        .map(|(instance, rows)| {
            let (mut hits, _other) = group_query_rows(&rows, None, false);
            sort_rows(&mut hits, None);
            hits.truncate(DEFAULT_BREAKDOWN_LIMIT);
            (instance, json!(hits))
        })
        .collect();
    Value::Object(folded)
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
    /// The Δ baseline window, returned as `baseline_hits` in the same
    /// response — same contract as the databases endpoint: client-computed
    /// bounds, both or neither, read concurrently with the current window.
    /// The baseline is fetched under the SAME filters and sort so the two
    /// sets are comparable row-for-row.
    pub baseline_start_time: Option<i64>,
    pub baseline_end_time: Option<i64>,
    /// Narrows the SERVER FALLBACK to one statement — it does not filter the
    /// client-vantage rows, which the detail page already selects from the
    /// ranked page it reads.
    ///
    /// The query-detail page looks up ONE fingerprint. Its client read is a
    /// ranked page it filters in the browser, which is fine while traces
    /// exist; with none, the fallback below is the only vantage that can
    /// answer, and it must answer about THIS statement rather than handing
    /// back the org's fifty most-frequent.
    pub fingerprint: Option<String>,
    /// Run the database-reported fallback list in this same request when — and
    /// only when — the client-vantage answer is an EXACT zero, returning it as
    /// `server_fallback`.
    ///
    /// On a deployment with the collector wired but no traced application
    /// traffic, this page's client read is honestly empty while the databases
    /// have been reporting their statement counters all along. The page
    /// handled that by awaiting this response and THEN issuing
    /// `/server_queries` — two sequential round trips on every load, in the
    /// deployment least able to spare them.
    ///
    /// The server already runs exactly this conditional inside `/badges`; this
    /// exposes it to the tab that renders the rows. Armed only by an exact
    /// zero: a failed read is unknown, and unknown is not zero.
    pub include_server_fallback: Option<bool>,
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
        ("include_server_fallback" = Option<bool>, Query, description = "When the client-vantage answer is an exact zero, also run the database-reported list and return it as `server_fallback` (with per-section forbidden/read-failed flags)"),
        ("fingerprint" = Option<String>, Query, description = "Narrows the `server_fallback` section to one statement (the query-detail row lookup). Does not filter the client-vantage rows."),
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
    let mut body = match read_queries_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => body,
        Err(resp) => return resp,
    };

    // ── The zero-trace fallback, folded server-side ──────────────────────
    //
    // The SAME conditional `/badges` runs, exposed to the tab that draws the
    // rows: the page used to await this response and then issue
    // `/server_queries` itself, which is two sequential round trips on the one
    // deployment where the second is guaranteed to be needed.
    //
    // Armed only by an EXACT zero. A `total` of 0 is the client vantage saying
    // truthfully "no traced traffic", which is false about the ORG when the
    // databases themselves are reporting; a failed read says nothing, and
    // unknown is not zero.
    if q.include_server_fallback.unwrap_or(false) && queries_body_reports_zero(&body) {
        let sq = ServerQueriesQuery {
            start_time: q.start_time,
            end_time: q.end_time,
            stream: None,
            system: q.system.clone(),
            instance: q.instance.clone(),
            database: None,
            namespace: q.namespace.clone(),
            // Forwarded so the detail page's single-statement lookup gets that
            // statement, not the ranked browse list it would have to search —
            // and could miss entirely below the cap.
            fingerprint: q.fingerprint.clone(),
            limit: None,
        };
        stamp_server_fallback(
            &mut body,
            read_server_queries_body(&org_id, &user_email.user_id, &sq).await,
        );
    }
    MetaHttpResponse::json(body)
}

/// Attach the database-reported fallback list as `server_fallback`, with the
/// two flags that keep its three outcomes apart.
///
/// The fallback body reads a LOGS stream while the primary is Traces-auth, so
/// a caller may legitimately be allowed one and denied the other. That must
/// NOT become a whole-request 403 — the client-vantage rows the caller IS
/// entitled to are already in this response — so a denial is a section flag,
/// exactly as `/badges` treats a denied slice. `server_fallback_forbidden`
/// separates "you may not see this" from `server_fallback_read_failed`'s "it
/// broke", because the page's copy for the two is different: one is a
/// permission to request, the other is a retry.
fn stamp_server_fallback(body: &mut Value, result: Result<Value, HttpResponse>) {
    let (section, forbidden, failed) = match result {
        Ok(section) => (section, false, false),
        Err(resp) if is_forbidden(&resp) => (Value::Null, true, false),
        Err(_) => (Value::Null, false, true),
    };
    let extra = body.as_object_mut().expect("body is an object");
    extra.insert("server_fallback".into(), section);
    extra.insert("server_fallback_forbidden".into(), json!(forbidden));
    extra.insert("server_fallback_read_failed".into(), json!(failed));
}

/// The top-queries endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`], for the same badges-agree-with-tabs reason.
async fn read_queries_body(
    org_id: &str,
    user_id: &str,
    q: &QueriesQuery,
) -> Result<Value, HttpResponse> {
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let baseline = parse_baseline_pair(q.baseline_start_time, q.baseline_end_time)?;

    let (current, baseline_out) = read_current_and_baseline(
        |s, e| read_queries_window(org_id, user_id, q, s, e),
        start_time,
        end_time,
        baseline,
    )
    .await;
    let window = current?;

    let mut body = json!({
        "hits": window.hits,
        "other": window.other,
        "total": window.total,
        "top_n_subset": window.top_n_subset,
        "freshness": window.freshness.to_json(),
    });
    if let Some(baseline_result) = baseline_out {
        match baseline_result {
            // The remainder too: the page measures Δ shares against the
            // WHOLE scope (shown + `_other`), so a baseline without its
            // remainder would silently inflate every previous-window share.
            Ok(b) => stamp_baseline_sections(
                &mut body,
                vec![
                    ("baseline_hits", json!(b.hits)),
                    ("baseline_other", json!(b.other)),
                ],
                false,
            ),
            Err(_) => stamp_baseline_sections(
                &mut body,
                vec![("baseline_hits", json!([])), ("baseline_other", json!([]))],
                true,
            ),
        }
    }
    Ok(body)
}

/// One window of the FR-2 top-queries pipeline, ready to serialize. Same
/// extraction as [`DatabasesWindow`], for the same reason.
struct QueriesWindow {
    hits: Vec<Value>,
    other: Vec<Value>,
    total: usize,
    top_n_subset: bool,
    freshness: Freshness,
}

async fn read_queries_window(
    org_id: &str,
    user_id: &str,
    q: &QueriesQuery,
    start_time: i64,
    end_time: i64,
) -> Result<QueriesWindow, HttpResponse> {
    let cfg = get_config();
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

    // The free-text `search` is DELIBERATELY not part of this SQL — it is
    // applied at merge time in Rust (it must filter the cached unfiltered tail
    // anyway), so user search text never reaches the SQL string at all.
    let qs_sql = build_stats_sql(
        org_id,
        "query_stats",
        start_time,
        end_time,
        &filters.sql_preds(),
    );
    let qs_rows = match run_stats_search(org_id, qs_sql, start_time, end_time).await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[DbMonitoring] queries rollup read failed for {org_id}: {e}");
            return Err(MetaHttpResponse::internal_error(e));
        }
    };

    let Some(streams) = involved_streams(org_id, user_id, q.stream.as_ref(), &[&qs_rows[..]]).await
    else {
        return Err(unauthorized_response());
    };
    let collected = collect_tails(org_id, &streams, start_time, end_time).await;
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
        // Lowered ONCE, here — `search_matches` takes the pre-lowered needle
        // so the loop never re-lowercases it per row.
        let needle_lower = s.to_lowercase();
        pool.retain(|r| {
            get_str_ref(r, "fingerprint") == "_other" || search_matches(r, &needle_lower)
        });
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
    Ok(QueriesWindow {
        hits,
        other,
        total,
        top_n_subset: !allow_other,
        freshness,
    })
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
    /// Also return the FR-5 calling-endpoints aggregation as `endpoints`, in
    /// this same response.
    ///
    /// The query-detail page fired `/query/history` and `/query/endpoints`
    /// together on every entry, with the identical fingerprint and window —
    /// and endpoints REQUIRES a `stream` the page had to resolve first, which
    /// is the very stream this handler already resolves for its own backfill
    /// (`trace_stream_name` in the response below). So the second request was
    /// waiting on a fact this one had computed.
    ///
    /// Opt-in, like `include_indexes`: a caller who wants the series alone
    /// should not pay for a raw-span aggregation.
    pub include_endpoints: Option<bool>,
    /// Cap for the `endpoints` section — the standalone endpoint's `limit`,
    /// under the same default and clamp.
    pub endpoints_limit: Option<usize>,
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
        ("include_endpoints" = Option<bool>, Query, description = "Also return the FR-5 calling-endpoints aggregation as `endpoints`, run against the trace stream this handler already resolves"),
        ("endpoints_limit" = Option<usize>, Query, description = "Max endpoint rows when include_endpoints is set (default 50, max 500)"),
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
        && !can_read_stream(
            &org_id,
            &user_email.user_id,
            stream,
            required_stream_for(DbmVantage::Client),
        )
        .await
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
    // The history `db_totals` read feeds only window existence (distinct
    // `_timestamp`s under the totals filters) and backfill-stream resolution —
    // never the metrics — so it projects the four columns those consume
    // instead of dragging every stored column per row.
    let totals_projection = stats_projection(
        &org_id,
        &[
            "_timestamp",
            "trace_stream_name",
            "db_system",
            "db_instance",
        ],
    )
    .await;
    let totals_sql = build_stats_sql_projected(
        &org_id,
        "db_totals",
        start_time,
        end_time,
        &totals_filters.sql_preds(),
        &totals_projection,
    );

    // FR-5 errors-by-code: the rollup's EXACT per-status-code counts
    // (`error_class` records), summed across the windows in range. The detail
    // page used to derive these from its capped sample rows, which undercounts
    // exactly when errors spike.
    //
    // `error_class` rows exist at (system, instance, env) — they carry no
    // namespace/service columns, so under one of those narrower filters the
    // counts would describe a different population than the series beside
    // them. Omitted rather than overstated; the page falls back to its
    // sample-derived counts and says so.
    //
    // Non-fatal on read failure: this block is enrichment, and a 500 here
    // would take the whole series down with it.
    let ec_filters = ScopeFilters {
        system: q.system.clone(),
        instance: q.instance.clone(),
        env: q.env.clone(),
        stream: q.stream.clone(),
        ..Default::default()
    };
    let error_classes_fut = async {
        if q.namespace.is_some() || q.service.is_some() {
            return Vec::new();
        }
        let ec_sql = build_stats_sql(
            &org_id,
            "error_class",
            start_time,
            end_time,
            &format!(
                "{}{}",
                ec_filters.sql_preds(),
                fingerprint_pred(fingerprint)
            ),
        );
        match run_stats_search(&org_id, ec_sql, start_time, end_time).await {
            Ok(rows) => {
                let rows: Vec<Value> = rows.into_iter().filter(|r| ec_filters.matches(r)).collect();
                fold_error_code_counts(&rows)
            }
            Err(e) => {
                log::warn!("[DbMonitoring] history error-class read failed for {org_id}: {e}");
                Vec::new()
            }
        }
    };

    // Three independent reads over the same summary stream, CONCURRENTLY —
    // this chain (plus the backfill and tails below) used to be a serial
    // sequence of up to ~10 awaited searches.
    let (fp_res, totals_res, error_classes) = tokio::join!(
        run_stats_search(&org_id, fp_sql, start_time, end_time),
        run_stats_search(&org_id, totals_sql, start_time, end_time),
        error_classes_fut,
    );
    let (fp_rows, totals_rows) = match (fp_res, totals_res) {
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
    // The K backfill windows run CONCURRENTLY (`HISTORY_BACKFILL_MAX_WINDOWS`
    // bounds the fan-out), overlapped with stream resolution + tail
    // collection, which depend on `totals_rows` but not on the backfill.
    let org = org_id.as_str();
    let backfill_stream_ref = backfill_stream.as_ref();
    let backfill_fut = join_all(to_backfill.iter().map(|window_end| async move {
        let mut point = json!({ "timestamp": window_end, "below_top_n": true });
        if let Some(stream) = backfill_stream_ref {
            let sql = build_backfill_sql(
                stream,
                fingerprint,
                window_end - interval_micros,
                *window_end,
            );
            match rollup::run_dbm_search(org, sql, window_end - interval_micros, *window_end).await
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
                    log::warn!("[DbMonitoring] history backfill failed for {org}: {e}");
                }
            }
        }
        point
    }));
    // Live-tail point inputs (D4 — the series' live segment, never flat/zero).
    let tails_fut = async {
        let streams = involved_streams(
            &org_id,
            &user_email.user_id,
            q.stream.as_ref(),
            &[&totals_rows[..]],
        )
        .await?;
        Some(collect_tails(&org_id, &streams, start_time, end_time).await)
    };
    // FR-5 calling endpoints, folded into this response when asked for.
    //
    // It runs against `backfill_stream` — the stream THIS handler resolved,
    // which is exactly what the standalone `/query/endpoints` call had to be
    // told and what the page had to wait to learn. Concurrent with the
    // backfill and the tail collection, so the section costs latency only when
    // it is the slowest of the three.
    //
    // `None` (the stream is ambiguous or absent) is not a failure: it is the
    // same "no stream, no answer" the page already renders, stated as an
    // absent section rather than an empty list that would read as "no callers".
    let want_endpoints = q.include_endpoints.unwrap_or(false);
    let endpoints_limit = q
        .endpoints_limit
        .unwrap_or(DEFAULT_ENDPOINTS_LIMIT)
        .clamp(1, MAX_ENDPOINTS_LIMIT);
    let endpoints_fut = async {
        if !want_endpoints {
            return None;
        }
        let stream = backfill_stream_ref?;
        // The SAME scope the series is read under, applied to the raw spans.
        // Without it the aggregation keys on the fingerprint alone, which fuses
        // engines (see `build_endpoints_sql`) — and the caller list is the one
        // section on the page a server-vantage row is enriched FROM, so a fused
        // list attributes another engine's services to this row's counters.
        let sql = build_endpoints_sql(
            stream,
            fingerprint,
            start_time,
            end_time,
            &filters.span_sql_preds_for("dbspan."),
            endpoints_limit,
        );
        Some(rollup::run_dbm_search(org, sql, start_time, end_time).await)
    };

    let (backfill_points, collected, endpoints) =
        tokio::join!(backfill_fut, tails_fut, endpoints_fut);
    series.extend(backfill_points);
    for window_end in &flag_only {
        series.push(json!({ "timestamp": window_end, "below_top_n": true }));
    }
    series.sort_by_key(|p| get_i64(p, "timestamp"));

    let Some(collected) = collected else {
        return unauthorized_response();
    };
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

    // FR-5 "where it runs": the same constituent rows the series above merged
    // away, folded per (instance, namespace) instead. Tail rows are included so
    // the breakdown covers the same span as the series' live point. Backfilled
    // below-cutoff windows are NOT in it — the backfill aggregates without
    // dimensions — so these are totals over the tracked windows only, and the
    // UI must say so rather than present them as exact window totals.
    let breakdown = fold_instance_breakdown(
        fp_rows
            .iter()
            .filter(|r| filters.matches(r))
            .chain(tail_rows.iter()),
    );

    let freshness = Freshness {
        data_through: collected.data_through,
        live_tail: cfg.db_monitoring.live_tail,
        tail_covers_from: collected.tail_covers_from,
        tail_through: collected.tail_through,
        tail_truncated: collected.tail_truncated,
        percentiles_estimated: true,
    };
    let mut body = json!({
        "fingerprint": fingerprint,
        "series": series,
        // The raw trace stream this fingerprint resolves to (same resolution as
        // the backfill: explicit param, else the unique stream of the window
        // rows; null when ambiguous). The query-detail page reuses it for its
        // raw-span panels instead of guessing a default stream.
        "trace_stream_name": backfill_stream,
        "backfill_capped": !flag_only.is_empty(),
        // Exact per-status-code error counts over the range (largest first).
        // Empty when the scope is narrower than the counts' grain — the page
        // must then fall back to sample-derived counts, not claim exactness.
        "error_classes": error_classes,
        // Per-(instance, namespace) totals for this fingerprint over its
        // TRACKED windows (see `fold_instance_breakdown`) — heaviest first.
        // Windows where the fingerprint ranked below the per-instance cutoff
        // contribute nothing, so these are floors, not exact window totals.
        "breakdown": breakdown,
        "freshness": freshness.to_json(),
    });

    if want_endpoints {
        let extra = body.as_object_mut().expect("body is an object");
        // Three outcomes, kept apart because the page renders three different
        // sentences: rows (the answer), `null` (no stream to aggregate — the
        // "which stream?" prompt, NOT "no callers"), and the failure flag (a
        // read that ran and broke). An empty list would collapse the first two.
        let (hits, failed) = match endpoints {
            Some(Ok(hits)) => (json!(hits), false),
            Some(Err(e)) => {
                log::error!("[DbMonitoring] endpoints section failed for {org_id}: {e}");
                (Value::Null, true)
            }
            None => (Value::Null, false),
        };
        extra.insert("endpoints".into(), hits);
        extra.insert("endpoints_read_failed".into(), json!(failed));
    }
    MetaHttpResponse::json(body)
}

#[derive(Debug, Deserialize)]
pub struct EndpointsQuery {
    pub fingerprint: Option<String>,
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    /// The REST of the join key. A fingerprint hashes statement text only, so
    /// on a mixed fleet it names one statement running on several engines and
    /// databases at once; aggregating callers without these fuses them into one
    /// row that describes no engine (see [`build_endpoints_sql`]).
    ///
    /// Optional so the existing contract is unchanged for a caller that has no
    /// engine to give — a fused answer is still what an unscoped question
    /// deserves, and the caller that DOES enrich a server row now sends them.
    pub system: Option<String>,
    pub namespace: Option<String>,
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
        ("system" = Option<String>, Query, description = "Database system — the rest of the join key; without it a fingerprint shared by two engines returns their callers fused into one row"),
        ("namespace" = Option<String>, Query, description = "Database/schema — the rest of the join key (see `system`)"),
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
    if !can_read_stream(
        &org_id,
        &user_email.user_id,
        stream,
        required_stream_for(DbmVantage::Client),
    )
    .await
    {
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

    let scope = ScopeFilters {
        system: q.system.clone(),
        namespace: q.namespace.clone(),
        ..Default::default()
    };
    let sql = build_endpoints_sql(
        stream,
        fingerprint,
        start_time,
        end_time,
        &scope.span_sql_preds_for("dbspan."),
        limit,
    );
    match rollup::run_dbm_search(&org_id, sql, start_time, end_time).await {
        Ok(hits) => MetaHttpResponse::json(json!({ "hits": hits })),
        Err(e) => {
            log::error!("[DbMonitoring] endpoints query failed for {org_id}/{stream}: {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SamplesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    pub namespace: Option<String>,
    pub env: Option<String>,
    pub service: Option<String>,
    pub limit: Option<usize>,
    /// Run the database-reported fallback list (`/server_samples`) in this same
    /// request when the client-vantage answer is an EXACT zero, returning it as
    /// `server_fallback`. See [`QueriesQuery::include_server_fallback`] — same
    /// contract, same reason, same per-section permission handling.
    pub include_server_fallback: Option<bool>,
    /// Scope the ranking to ONE statement — "show me the slowest executions of
    /// this query", the question the detail page asks.
    ///
    /// Without it that page had no endpoint to ask, so it built the SQL in the
    /// BROWSER: raw `SELECT … FROM "<stream>" WHERE o2_db_fingerprint = '…'`,
    /// with its own single-quote escaping and its own stream-name validator,
    /// against a stream name that arrives from `route.query`. The predicate is
    /// built here now, through the same escaping every other predicate in this
    /// module uses, and the stream is resolved through `involved_streams`
    /// rather than interpolated from a URL.
    pub fingerprint: Option<String>,
}

/// GET /{org_id}/traces/db_monitoring/samples — FR-6 global slow samples: the
/// slowest DB spans in the window ACROSS every system, instance and query.
///
/// The per-query samples on the detail page answer "show me one bad execution
/// of THIS query"; this endpoint answers the shape of question that starts an
/// incident — "what were the worst database calls anywhere, just now?" — before
/// the reader knows which query to blame.
///
/// Reads RAW trace spans (the client vantage), no rollup and no tail: every
/// row is one real completed execution with its trace attached. Stream
/// resolution and RBAC follow the rollup-backed endpoints exactly — explicit
/// `stream` param 403s loudly when unreadable; otherwise the involved streams
/// are discovered from the window's rollup rows (falling back to the org's
/// trace streams) and FILTERED to what the caller may read, then schema-gated
/// on `o2_db_fingerprint` so a stream that never carried a DB span is skipped
/// rather than queried.
///
/// Bounded: one fixed-shape SQL per involved stream, each `LIMIT limit`
/// (default 100, max 500 — far under the search cap), merged in Rust
/// ([`fold_sample_rows`]). `truncated` in the response says when more
/// qualifying spans existed than were returned.
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/samples",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringSamples",
    summary = "Database Monitoring: slowest database calls in the window",
    description = "The slowest raw DB spans across all systems, instances and queries in the window, with trace ids for pivoting. Client-observed, completed calls only.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Trace stream filter"),
        ("system" = Option<String>, Query, description = "Database system filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("namespace" = Option<String>, Query, description = "Database/schema filter"),
        ("env" = Option<String>, Query, description = "Deployment environment filter"),
        ("service" = Option<String>, Query, description = "Calling service filter"),
        ("limit" = Option<usize>, Query, description = "Max spans (default 100, max 500)"),
        ("fingerprint" = Option<String>, Query, description = "Scope the ranking to one query fingerprint — the slowest executions of THAT statement"),
        ("include_server_fallback" = Option<bool>, Query, description = "When the client-vantage answer is an exact zero, also run the database-reported list and return it as `server_fallback`"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_samples(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<SamplesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_samples_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// The samples endpoint's whole body as a callable — the same extraction as
/// [`read_databases_body`], and here it is also what keeps the ROUTE
/// compiling: the per-stream reads run through `buffered` closures capturing
/// `&org_id`, and awaiting the `include_server_fallback` section after them
/// inside the handler itself made those lifetimes early-bound, so
/// `get_dbm_samples` stopped satisfying axum's `for<'a>` Handler bound. That
/// fails at the route registration in `api/http`, naming neither the closure
/// nor the await. Inside a plain `async fn` the same code is fine.
async fn read_samples_body(
    org_id: &str,
    user_id: &str,
    q: &SamplesQuery,
) -> Result<Value, HttpResponse> {
    // An explicit `stream` is checked HERE, before range parsing and before any
    // read runs — same placement and same reasoning as `get_dbm_query_endpoints`
    // and `get_dbm_query_history`: the caller must not be able to run raw-span
    // work on an unreadable stream, nor probe stream existence through the
    // difference between a 400 and a 403.
    if let Some(stream) = q.stream.as_deref().filter(|s| !s.is_empty())
        && !can_read_stream(
            org_id,
            user_id,
            stream,
            required_stream_for(DbmVantage::Client),
        )
        .await
    {
        return Err(unauthorized_response());
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_SAMPLES_LIMIT)
        .clamp(1, MAX_SAMPLES_LIMIT);
    let filters = ScopeFilters {
        system: q.system.clone(),
        instance: q.instance.clone(),
        namespace: q.namespace.clone(),
        env: q.env.clone(),
        service: q.service.clone(),
        stream: q.stream.clone(),
    };

    // Stream discovery, through the same chokepoint the rollup-backed endpoints
    // use: the window's `db_totals` rows name the trace streams that held DB
    // spans, `involved_streams` falls back to the org's trace streams on a cold
    // start and filters to what the caller may read. The discovery read is
    // scoped at the grains `db_totals` rows exist at (system, instance) —
    // narrower filters apply to the span read itself, below. Non-fatal: the
    // rollup here only narrows the fan-out, it is not the data.
    let totals_filters = ScopeFilters {
        system: q.system.clone(),
        instance: q.instance.clone(),
        stream: q.stream.clone(),
        ..Default::default()
    };
    let totals_sql = build_stats_sql(
        org_id,
        "db_totals",
        start_time,
        end_time,
        &totals_filters.sql_preds(),
    );
    let totals_rows = match run_stats_search(org_id, totals_sql, start_time, end_time).await {
        Ok(rows) => rows,
        Err(e) => {
            log::warn!("[DbMonitoring] samples stream discovery failed for {org_id}: {e}");
            Vec::new()
        }
    };
    let Some(streams) =
        involved_streams(org_id, user_id, q.stream.as_ref(), &[&totals_rows[..]]).await
    else {
        return Err(unauthorized_response());
    };

    // Schema gate (the rollup discovery's own rule): only streams that carry
    // `o2_db_fingerprint` have DB spans to rank, and querying one that does not
    // would error on the column rather than answer empty. Probes run
    // CONCURRENTLY (capped — the list can be every trace stream in the org),
    // `buffered` so the stream order — and with it `streams_scanned` — stays
    // deterministic.
    const SAMPLES_CONCURRENCY: usize = 4;
    let org = org_id;
    let probes: Vec<(String, bool)> =
        futures::stream::iter(streams.into_iter().map(|stream| async move {
            let has_fp = infra::schema::get(org, &stream, StreamType::Traces)
                .await
                .map(|s| s.field_with_name(super::O2_DB_FINGERPRINT).is_ok())
                .unwrap_or(false);
            (stream, has_fp)
        }))
        .buffered(SAMPLES_CONCURRENCY)
        .collect()
        .await;
    let db_streams: Vec<String> = probes
        .into_iter()
        .filter_map(|(stream, has_fp)| has_fp.then_some(stream))
        .collect();

    // One ranked read per stream, CONCURRENTLY under the same cap; results
    // arrive in stream order, so the per-item error semantics (`first_err` =
    // first failing stream) are exactly the serial loop's.
    let mut preds = filters.span_sql_preds();
    // The per-query scope rides the same predicate string as every other
    // filter, so it inherits the same escaping and the same injection tests.
    if let Some(fp) = q.fingerprint.as_deref().filter(|f| !f.is_empty()) {
        preds.push_str(&span_fingerprint_pred(fp));
    }
    let reads: Vec<(String, Result<Vec<Value>, anyhow::Error>)> =
        // `into_iter`, not `iter`, and that is load-bearing rather than
        // stylistic. With `iter()` this closure takes a `&String`, which makes
        // its lifetime EARLY-bound; once anything is awaited after the fold —
        // which `include_server_fallback` now is — `get_dbm_samples` stops
        // satisfying axum's `for<'a>` Handler bound, and the build fails at the
        // ROUTE REGISTRATION in `api/http` with "implementation of `FnOnce` is
        // not general enough", naming neither this closure nor the await.
        // Taking the `String` by value keeps the lifetimes late-bound.
        // `db_streams` is not read after this point.
        futures::stream::iter(db_streams.clone().into_iter().map(|stream| {
            let sql = build_samples_sql(&stream, start_time, end_time, &preds, limit);
            async move {
                let rows = rollup::run_dbm_search(org, sql, start_time, end_time).await;
                (stream, rows)
            }
        }))
        .buffered(SAMPLES_CONCURRENCY)
        .collect()
        .await;
    let mut per_stream: Vec<(String, Vec<Value>)> = Vec::new();
    let mut first_err: Option<anyhow::Error> = None;
    let mut failed = 0usize;
    for (stream, result) in reads {
        match result {
            Ok(rows) => per_stream.push((stream, rows)),
            Err(e) => {
                log::warn!("[DbMonitoring] samples read failed for {org_id}/{stream}: {e}");
                failed += 1;
                first_err.get_or_insert(e);
            }
        }
    }
    // One bad stream must not take down the fleet view (the `collect_tails`
    // posture) — but EVERY read failing is not a quiet empty window, it is an
    // error the caller must see.
    if failed > 0
        && per_stream.is_empty()
        && let Some(e) = first_err
    {
        log::error!("[DbMonitoring] samples: all {failed} stream reads failed for {org_id}");
        return Err(MetaHttpResponse::internal_error(e));
    }

    let (hits, truncated) = fold_sample_rows(per_stream, limit);
    let client_reports_zero = hits.is_empty();
    let mut body = json!({
        "hits": hits,
        // More qualifying spans existed than were returned (same disclosure
        // convention as the rollup responses' `tail_truncated`/`truncated`).
        "truncated": truncated,
        "limit": limit,
        // The streams actually read, so the UI can say where the answer came
        // from — and, when a read failed, that the answer is partial.
        "streams_scanned": db_streams,
        "streams_failed": failed,
    });

    // The zero-trace fallback, folded server-side — the `/queries` twin, and
    // the same conditional `/badges` already runs for `server_samples`. The
    // page awaited this response and then issued `/server_samples`: two
    // sequential round trips on the deployment least able to spare them.
    //
    // Armed by an EXACT zero, and only when no read failed: a partial answer
    // (`streams_failed > 0`) that happens to be empty is UNKNOWN, not zero, and
    // firing the fallback there would present database-reported rows as the
    // answer to a question whose client half simply broke.
    if q.include_server_fallback.unwrap_or(false) && client_reports_zero && failed == 0 {
        stamp_samples_server_fallback(org_id, user_id, q, &mut body).await;
    }
    Ok(body)
}

/// Run and attach `/samples`' database-reported fallback section.
///
/// A separate `async fn` rather than an inline block, and deliberately so: the
/// handler's per-stream reads go through a `buffered` closure over a borrowed
/// `Vec<String>`, and awaiting anything after it inside the same body extends
/// that closure's inferred region past the await — which makes the whole
/// handler fail axum's `for<'a>` Handler bound with "implementation of `FnOnce`
/// is not general enough", at the ROUTE registration in another crate rather
/// than here. Moving the await out keeps the closure's lifetimes late-bound.
async fn stamp_samples_server_fallback(
    org_id: &str,
    user_id: &str,
    q: &SamplesQuery,
    body: &mut Value,
) {
    let ss = ServerSamplesQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        stream: None,
        system: q.system.clone(),
        instance: q.instance.clone(),
        database: None,
        namespace: q.namespace.clone(),
        limit: None,
    };
    stamp_server_fallback(body, read_server_samples_body(org_id, user_id, &ss).await);
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

// ─── A1 · the RAW presence gate ──────────────────────────────────────────────
//
// The A1 read-time fallback projects RAW vendor columns beside the canonical
// ones, and [`present_dbm_columns`]'s hazard is exactly SYMMETRIC there: naming
// a column absent from the stream fails the WHOLE query with a 400, not a null
// column. Measured on a real OSS-ingested stream, all 9 MSSQL raw columns and 3
// MariaDB ones are absent from the merged schema — so a hardcoded raw
// projection, which is the obvious implementation, takes the Deadlocks page down
// on any deployment that never ran those recipes. That is most of them.
//
// So the raw side needs its own gate. It needs one MORE thing than the canonical
// side does, and that is the reason this is a separate function rather than a
// second call to `present_dbm_columns` with a different array.

/// Which of `candidates` this stream can actually be QUERIED for.
///
/// Two independent 400s are being avoided here, and a check that catches only
/// the first still ships a broken page:
///
/// 1. **Absent from the schema.** `unknown field 'x'` — the failure [`present_dbm_columns`]
///    documents.
/// 2. **Present in the schema but truncated out of an enabled User-Defined Schema.** *"Field exists
///    in the stream but not in its User-Defined Schema (UDS)"*
///    (`src/api/search/src/search/utils.rs`). Past `ZO_SCHEMA_MAX_FIELDS_TO_ENABLE_UDS` (default
///    1000) fields, UDS auto-enables and truncates which fields stay queryable — while
///    `infra::schema::get` keeps returning the FULL merged schema. A gate that consults only the
///    stored schema therefore passes and then 400s at query time.
///
/// Variant 2 is not hypothetical for this design: the DBM stream is a shared
/// logs stream carrying ordinary log lines (195-283 columns measured on real
/// deployments), so crossing 1000 is realistic, and the raw vendor columns —
/// old, and neither FTS nor index fields — are exactly the low-priority names
/// the auto-enable truncates.
///
/// **An empty `uds_fields` means UDS is DISABLED, not "everything truncated".**
/// The two are the same empty vector on the wire, and conflating them would
/// degrade every deployment that never enabled UDS — almost all of them — to a
/// `_timestamp`-only projection that silently shows zero deadlocks. Same
/// false-verdict shape `present_dbm_columns` refuses for a failed schema read.
///
/// Pure, and takes the schema and UDS list rather than reading them, so both
/// halves are testable without a meta store — the reason
/// `test_present_dbm_columns_reports_errors_instead_of_empty` had to be
/// `#[ignore]`d.
#[cfg(feature = "enterprise")]
fn queryable_columns(
    candidates: &[&str],
    schema: &arrow_schema::Schema,
    uds_fields: &[String],
) -> HashSet<String> {
    candidates
        .iter()
        .filter(|f| schema.field_with_name(f).is_ok())
        .filter(|f| uds_fields.is_empty() || uds_fields.iter().any(|u| u == **f))
        .map(|f| f.to_string())
        .collect()
}

/// The raw deadlock columns this stream can be queried for.
///
/// Candidates come from `config`'s shared [`server_vantage::RAW_DEADLOCK_FIELDS`]
/// and never from a local list: the enterprise canonicalizers that CONSUME these
/// names cannot see this crate, so a second copy here would drift silently and
/// the cross-repo contract test
/// (`every_raw_field_the_oss_read_projects_is_read_by_a_canonicalizer`) would
/// not be able to see the drift.
#[cfg(feature = "enterprise")]
fn raw_deadlock_columns_in(
    schema: &arrow_schema::Schema,
    uds_fields: &[String],
) -> HashSet<String> {
    queryable_columns(&server_vantage::RAW_DEADLOCK_FIELDS, schema, uds_fields)
}

/// Read the raw-column gate for one stream.
///
/// Propagates `Err` rather than `unwrap_or_default()`, for the reason
/// [`present_dbm_columns`] spells out at length: an empty set from a DB blip is
/// indistinguishable from "this stream has no raw deadlock columns", and both
/// then produce a confident wrong answer — here, an empty Deadlocks page over a
/// stream full of deadlocks, which is the very bug A1 exists to fix.
///
/// The stream SETTINGS read is deliberately not fatal on its own: `get_settings`
/// returns `Option` and answers `None` both for "no settings" and for a read it
/// could not serve. `None` is treated as UDS-disabled, which is the same
/// assumption every other reader in the codebase makes
/// (`get_stream_setting_defined_schema_fields` maps `None` to an empty vec), and
/// the failure mode if that assumption is ever wrong is a 400 on the page — loud
/// — rather than a silent under-report.
#[cfg(feature = "enterprise")]
async fn present_raw_deadlock_columns(
    org_id: &str,
    stream_name: &str,
) -> Result<HashSet<String>, anyhow::Error> {
    let schema = infra::schema::get(org_id, stream_name, StreamType::Logs).await?;
    let settings = infra::schema::get_settings(org_id, stream_name, StreamType::Logs).await;
    let uds = infra::schema::get_stream_setting_defined_schema_fields(&settings);
    Ok(raw_deadlock_columns_in(&schema, &uds))
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
    let cols_group = match second_col {
        Some(c) => format!("{group_col}, {c}"),
        None => group_col.to_string(),
    };
    let cols = match second_col {
        Some(c) => format!(
            "{group_col} AS {}, {c} AS {}",
            wire_alias_of(group_col),
            wire_alias_of(c)
        ),
        None => format!("{group_col} AS {}", wire_alias_of(group_col)),
    };
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
///
/// The five blocking fields (`blocking_pids`, `blocked`, `lock_mode`,
/// `lock_type`, `lock_relation`) are enterprise-only — they ARE the Blocked
/// Queries capability, and serving them on OSS would let a user read which
/// sessions are blocked and by whom. Activity itself stays OSS: what a session
/// waits ON (`wait_event`/`wait_event_type`) is dual-use and deliberately
/// retained.
fn activity_row_to_dto(row: &Value) -> Value {
    // Gated with its only consumer below: on OSS this binding would be unused
    // and trip `unused_variables`.
    #[cfg(feature = "enterprise")]
    let pids = server_vantage::blocking_pids_of(row);

    // The five blocking keys are inserted after this literal rather than
    // `#[cfg]`-annotated inside it: `serde_json::json!` does not accept
    // attributes on its members, so gating them in place will not compile.
    //
    // `unused_mut` is allowed because the mutation is itself `cfg`-gated — on
    // OSS nothing writes to `dto`, and the lint fires there and only there.
    #[allow(unused_mut)]
    let mut dto = json!({
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
        "client_address": str_or_null(row, server_vantage::O2_DBM_CLIENT_ADDR),
        "client_host": str_or_null(row, server_vantage::O2_DBM_CLIENT_HOST),
        "client_port": row.get(server_vantage::O2_DBM_CLIENT_PORT).and_then(server_vantage::as_i64_loose),
        "db_system": get_str(row, server_vantage::O2_DBM_ENGINE),
        "db_instance": str_or_null(row, server_vantage::O2_DBM_INSTANCE),
        "db_namespace": str_or_null(row, server_vantage::O2_DBM_DATABASE),
    });

    // The blocking RELATIONSHIP is the Blocked Queries capability, so an OSS
    // build does not serve it. OMITTED rather than nulled: `"blocked": false`
    // on every row is an affirmative claim about lock state that an OSS build
    // never looked for and is not licensed to make, whereas an absent key says
    // "not available" — which is what the frontend's `Array.isArray` guard and
    // its `showsLocks` column spread already handle (the "Blocked by" column
    // drops rather than rendering a column of blanks, the same path a
    // MySQL-only fleet already takes).
    #[cfg(feature = "enterprise")]
    {
        let obj = dto.as_object_mut().expect("dto is an object");
        // A real array on the wire, though stored as a scalar (the logs schema
        // inferrer rejects nested values). Never `[0]` for an unblocked
        // session.
        obj.insert("blocking_pids".into(), json!(pids));
        obj.insert("blocked".into(), json!(!pids.is_empty()));
        obj.insert(
            "lock_mode".into(),
            str_or_null(row, server_vantage::O2_DBM_LOCK_MODE),
        );
        obj.insert(
            "lock_type".into(),
            str_or_null(row, server_vantage::O2_DBM_LOCK_TYPE),
        );
        obj.insert(
            "lock_relation".into(),
            str_or_null(row, server_vantage::O2_DBM_LOCK_RELATION),
        );
    }

    dto
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

/// The A1 raw-deadlock widening, when it is active.
///
/// Carries the SCHEMA-GATED raw column set — the output of
/// [`raw_deadlock_columns_in`], never a hardcoded list — because both halves of
/// the widening (the projection and the marker predicate) name real columns, and
/// naming an absent one fails the whole query.
///
/// A distinct type rather than a bare `HashSet` so the builder's other two
/// callers cannot pass one by accident: blocking and activity share the builder
/// and must be untouched in phase 1.
///
/// NOT `#[cfg]`-gated, unlike everything else A1 adds, because activity is an
/// OSS-owned ungated page that calls the same builder — so the parameter's type
/// has to exist in both builds. It is inert on OSS: nothing there constructs one
/// (only the enterprise deadlocks body does), so every OSS caller passes `None`
/// and the emitted SQL is byte-identical to before A1.
pub(crate) struct RawDeadlockFallback {
    /// Raw columns this stream can actually be queried for.
    pub present: HashSet<String>,
}

impl RawDeadlockFallback {
    /// The marker terms for the `WHERE`, restricted to marker columns the stream
    /// HAS.
    ///
    /// Each marker is itself a column, so an ungated term is the same 400 as an
    /// ungated projection entry — the half of the hazard that lives in the
    /// predicate. A stream that never saw a MariaDB deadlock has no
    /// `o2_maria_event` column, and naming it takes the page down.
    ///
    /// Values are the fixed `KIND_DEADLOCK` literal from `config`, not user
    /// input, so there is nothing here to escape; the column names are a
    /// compile-time whitelist for the same reason [`dbm_event_preds`] documents.
    fn marker_terms(&self) -> Vec<String> {
        server_vantage::DEADLOCK_MARKERS
            .into_iter()
            .filter(|(col, _)| self.present.contains(*col))
            .map(|(col, val)| format!("{col} = '{val}'"))
            .collect()
    }
}

// ─── A1.1 · the canonicalization boundary ────────────────────────────────────
//
// A1 shipped ALWAYS-ON: every deadlocks read widened its SQL with the raw
// markers and the raw projection and branched per row, forever — including on a
// deployment that has been enterprise for a year and has not written a raw
// deadlock row since. The fallback is meant to be TRANSITIONAL: it exists to
// carry a deployment across its OSS→enterprise upgrade, and once the
// pre-upgrade window ages out of retention it should cost nothing.
//
// So the widening is scoped to the window BEFORE this deployment started
// canonicalizing. That makes it SELF-LIMITING — no operator action, no date to
// set, no knob to remember. It narrows on its own as history ages out.
//
// This narrows WHICH READS adapt. It does NOT touch a stored row: adapted
// queries only, permanently (§9). No backfill, no re-canonicalization, no
// materializing canonical columns into stored rows.

/// The evidence the boundary probe gathers about one requested window.
///
/// # The boundary is not the question — presence is
///
/// This was designed as "find the timestamp at which canonicalization started,
/// and widen only before it". Writing the interleaving test collapsed that: the
/// boundary TIMESTAMP turns out to be **entirely subsumed** by the cheaper
/// question, and keeping it would have been a bug.
///
/// The argument, in the two directions:
///
///  - **A raw row is present in the window.** The canonical-only fast path cannot see it, so the
///    widening is needed — *no matter where the boundary is*. A cluster can run mixed builds or be
///    downgraded, so raw rows can appear AFTER canonical ones; a boundary-only verdict says
///    "canonicalization predates this window, go fast" and silently drops them. That is A1
///    reintroduced, in the code that was supposed to be A1's refinement.
///  - **No raw row is present in the window.** The widening can surface nothing, so it is pure cost
///    — *again no matter where the boundary is*, including on a window that entirely predates
///    canonicalization but happens to hold no deadlock.
///
/// In both directions the boundary timestamp changes nothing. So the verdict is
/// exactly `has_raw_row`, and the honest name for this mechanism is not
/// "canonicalization boundary" but **"is there anything here the fast path would
/// miss"**. It delivers the requested property — self-limiting, narrowing on its
/// own as the pre-upgrade window ages out of retention, no operator action —
/// because once no raw deadlock row remains in retention no window contains one.
/// It is strictly MORE self-limiting than a boundary: a canonical-only
/// deployment pays nothing for windows that predate its upgrade too, which a
/// boundary test would have widened.
///
/// [`earliest_canonical`](Self::earliest_canonical) is therefore retained as an
/// OBSERVATION, not an input — see [`Self::fallback_needed`].
///
/// Both fields are scoped to the REQUESTED window, so answering costs no rows
/// the main read was not about to scan anyway.
#[cfg(feature = "enterprise")]
#[derive(Debug, Clone, Copy)]
pub(crate) struct BoundaryProbe {
    /// `_timestamp` of the earliest CANONICAL deadlock row in the window — the
    /// point at which this deployment was demonstrably canonicalizing. `None` =
    /// no canonical row in the window at all.
    ///
    /// **Diagnostic only. It is deliberately NOT consulted by the verdict** (the
    /// doc on [`BoundaryProbe`] shows why it cannot change one), and it is
    /// deliberately not deleted: it is what makes the "widening on a
    /// fully-canonicalized window" case legible in a log line when someone asks
    /// why a read was wide.
    pub earliest_canonical: Option<i64>,
    /// Whether the window contains any row carrying a RAW deadlock marker.
    /// **This alone is the verdict.**
    pub has_raw_row: bool,
}

#[cfg(feature = "enterprise")]
impl BoundaryProbe {
    /// Does this window need the raw widening?
    ///
    /// Exactly [`has_raw_row`](Self::has_raw_row) — the widening is needed when
    /// and only when the window holds a row the canonical fast path cannot see.
    /// The [`BoundaryProbe`] doc works through why the boundary timestamp cannot
    /// move this answer in either direction; `start_time` is taken so that a
    /// future window-relative rule has a seam to land in without rewriting every
    /// call site, and is intentionally unused today.
    ///
    /// A window that straddles the upgrade is served with the widening on for
    /// the WHOLE window, never split into a raw half and a canonical half.
    /// Splitting would have to re-derive the stitch groups across the seam, and
    /// `merge_mysql_deadlocks` groups by 2 s proximity — so a MySQL deadlock
    /// whose sides straddle the seam would be torn into two half-sized
    /// deadlocks. That is exactly the bug GAP 2 exists to prevent, reintroduced
    /// by an optimization. Widening a window that is 99% canonical is only a
    /// cost, never a wrong answer: `deadlock_event_for_row` branches PER ROW, so
    /// a canonical row still takes the canonical reader.
    ///
    /// House rule (`plan_row_to_dto`): the ambiguous cases resolve toward
    /// SHOWING data. A probe that errors is not represented here at all — the
    /// caller widens without constructing a `BoundaryProbe`, so an unreadable
    /// window can never be mistaken for an empty one.
    fn fallback_needed(&self, _start_time: i64) -> bool {
        self.has_raw_row
    }
}

/// SQL for the EARLIEST canonical row of one kind inside the window.
///
/// Ordered ASCENDING — deliberately the mirror of [`build_last_seen_sql`], which
/// is DESC because it wants the latest. Getting this backwards returns the
/// newest canonical row, which is inside the window by construction, so it would
/// answer "yes, covered" for every window that has ever seen a canonical row and
/// silently disable the fallback on the deployments that need it.
///
/// Bounded to the REQUESTED window rather than `MIN(_timestamp)` over all
/// history: the unbounded form is a full scan and would cost more than the
/// widening it saves. `LIMIT 1` over the same range the main read is about to
/// scan is the cheapest question that answers the boundary.
#[cfg(feature = "enterprise")]
pub(crate) fn build_earliest_canonical_sql(
    stream_name: &str,
    kind: &str,
    start_time: i64,
    end_time: i64,
) -> String {
    format!(
        "SELECT _timestamp FROM \"{}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    AND {} = '{}'\nORDER BY _timestamp ASC\nLIMIT 1",
        escape_ident(stream_name),
        server_vantage::O2_DBM_KIND,
        escape_sq(kind),
    )
}

/// SQL for ANY raw-marker deadlock row inside the window.
///
/// Schema-gated exactly like the widening it guards: each marker is a COLUMN,
/// and naming one absent from the stream fails the WHOLE query with a 400 — so a
/// probe that hardcodes all four markers takes the page down on precisely the
/// deployments the fallback exists for.
///
/// `None` when the stream has no marker column at all: there is then no query to
/// run, and no raw row can exist, so the caller reads that as "no raw rows" for
/// free.
#[cfg(feature = "enterprise")]
pub(crate) fn build_raw_deadlock_presence_sql(
    stream_name: &str,
    start_time: i64,
    end_time: i64,
    raw: &RawDeadlockFallback,
) -> Option<String> {
    let markers = raw.marker_terms();
    if markers.is_empty() {
        return None;
    }
    Some(format!(
        "SELECT _timestamp FROM \"{}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    AND ({})\nLIMIT 1",
        escape_ident(stream_name),
        markers.join(" OR "),
    ))
}

/// Run both boundary probes concurrently and decide whether this window needs
/// the raw widening.
///
/// Errors degrade to the SAFE direction — the pre-A1.1 always-on behaviour —
/// rather than to an error page: a failed probe means we do not know whether the
/// window is fully canonicalized, and the house rule is to show data. The cost
/// of being wrong that way is a wider read; the cost of being wrong the other
/// way is the empty page over real deadlocks that A1 exists to fix.
#[cfg(feature = "enterprise")]
async fn deadlock_window_needs_fallback(
    org_id: &str,
    stream: &str,
    start_time: i64,
    end_time: i64,
    raw: &RawDeadlockFallback,
) -> bool {
    let Some(raw_sql) = build_raw_deadlock_presence_sql(stream, start_time, end_time, raw) else {
        // No marker column on this stream, so no raw row can exist. Nothing for
        // the widening to surface, and we did not even have to ask.
        return false;
    };
    let canonical_sql =
        build_earliest_canonical_sql(stream, server_vantage::KIND_DEADLOCK, start_time, end_time);
    // Two independent bounded reads — the same `tokio::join!` shape
    // `probe_collection` already uses for its pair.
    let (canonical_rows, raw_rows) = tokio::join!(
        run_events_search(org_id, stream, canonical_sql, start_time, end_time),
        run_events_search(org_id, stream, raw_sql, start_time, end_time),
    );
    let (canonical_rows, raw_rows) = match (canonical_rows, raw_rows) {
        (Ok(c), Ok(r)) => (c, r),
        (c, r) => {
            let e = c.err().or_else(|| r.err());
            log::warn!(
                "[DbMonitoring] deadlock boundary probe failed for {org_id}/{stream}, \
                 widening the read as before: {e:?}"
            );
            return true;
        }
    };
    let probe = BoundaryProbe {
        // NOT `get_i64`, deliberately: that maps an absent or unparseable value
        // to 0, and 0 is a valid-looking timestamp at the epoch. The verdict
        // does not read this field, so today that would be harmless — but it
        // would silently turn "we could not read the row" into "canonicalization
        // started in 1970" in the diagnostic below, which is the log line an
        // operator would be reading precisely when something is wrong.
        earliest_canonical: canonical_rows
            .first()
            .and_then(|r| r.get("_timestamp"))
            .and_then(Value::as_i64),
        has_raw_row: !raw_rows.is_empty(),
    };
    let needed = probe.fallback_needed(start_time);
    if needed {
        // The one question an operator asks about this feature is "why is my
        // deadlocks read wide?", and the answer is a raw row in the window. The
        // canonical boundary is logged beside it because the useful follow-up is
        // "and has this deployment started canonicalizing at all" — a `None`
        // there on a supposedly-upgraded cluster means ingest is still landing
        // on an OSS node, which is a different problem with the same symptom.
        log::debug!(
            "[DbMonitoring] deadlocks widening for {org_id}/{stream}: a raw \
             deadlock row is present in the window; earliest canonical row in \
             window = {:?}",
            probe.earliest_canonical,
        );
    }
    needed
}

/// Everything the builder may project, gated on what the stream actually has.
///
/// The two halves travel together because they are answers to the same
/// question — "which of the columns I want can this stream be queried for" —
/// and both are schema-gated for the same reason: naming an absent column fails
/// the WHOLE query.
pub(crate) struct DbmProjection<'a> {
    /// Canonical `o2_dbm_*` columns present on the stream.
    pub present: &'a HashSet<String>,
    /// The A1 deadlock read-time fallback. `Some` for the DEADLOCKS caller only
    /// — blocking and activity pass `None` and get byte-identical SQL to what
    /// they emitted before A1. Widening the shared builder for everyone would
    /// push raw deadlock columns into their projections: cost with no reader,
    /// and for blocking a real risk, since its degraded projection already drops
    /// every row.
    pub raw: Option<&'a RawDeadlockFallback>,
}

/// Read canonical server-vantage events of one kind from a LOGS stream.
pub(crate) fn build_dbm_events_sql(
    stream_name: &str,
    kind: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
    limit: usize,
    projection: &DbmProjection<'_>,
) -> String {
    let DbmProjection { present, raw } = *projection;
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
    //
    // A1 widens BOTH halves for the deadlocks caller, and both widenings are
    // schema-gated for the same reason the canonical projection is. The raw
    // names come from `RAW_DEADLOCK_FIELDS` (in `config`, shared with the
    // enterprise canonicalizers that read them) intersected with what this
    // stream can be queried for — never a hardcoded list, which is the
    // implementation that 400s the page on any deployment that never ran an
    // MSSQL or MariaDB-with-locks recipe.
    //
    // The two vocabularies are disjoint by construction
    // (`raw_deadlock_fields_never_overlap_the_canonical_ones` in `config`), so
    // chaining them cannot name a column twice.
    let cols = std::iter::once("_timestamp")
        .chain(
            server_vantage::ALL_DBM_FIELDS
                .into_iter()
                .filter(|f| present.contains(*f)),
        )
        .chain(
            server_vantage::RAW_DEADLOCK_FIELDS
                .into_iter()
                .filter(|f| raw.is_some_and(|r| r.present.contains(*f))),
        )
        .collect::<Vec<_>>()
        .join(", ");

    // The kind predicate. Canonical-only by default; for deadlocks with the
    // fallback active it is OR-ed with the raw markers, which is what makes ONE
    // query return both populations — no UNION, because this page projects
    // columns and folds in Rust rather than aggregating in SQL.
    //
    // The markers are gated on presence too, and an EMPTY marker set collapses
    // back to the bare canonical predicate rather than emitting `OR ()`.
    let kind_pred = {
        let canonical = format!("{} = '{}'", server_vantage::O2_DBM_KIND, escape_sq(kind),);
        let markers = raw
            .map(RawDeadlockFallback::marker_terms)
            .unwrap_or_default();
        if markers.is_empty() {
            canonical
        } else {
            format!("({canonical} OR {})", markers.join(" OR "))
        }
    };

    format!(
        "SELECT {cols} FROM \"{}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    AND {kind_pred}{preds}\nORDER BY _timestamp DESC\nLIMIT {limit}",
        escape_ident(stream_name),
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
    let req = rollup::dbm_search_request(sql, start_time, end_time, STATS_READ_SIZE as i64, 30);
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
#[cfg(feature = "enterprise")]
const MYSQL_SIDE_WINDOW_MICROS: i64 = 2_000_000;

/// Rebuild a [`server_vantage::DeadlockEvent`] from one stored canonical row.
///
/// Reads only the canonical `o2_dbm_*` columns — the engine-specific fields they
/// were derived from (`dl_query_1`, `my_trx_thread`) are ingest-side inputs and
/// are never re-read here.
#[cfg(feature = "enterprise")]
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

/// Turn ONE stored row into a [`server_vantage::DeadlockEvent`], whichever shape
/// it is in — the A1 read-time fallback's row-level branch.
///
/// **The discriminator is per-ROW, not per-stream.** A deployment that upgraded
/// OSS → enterprise mid-window has both shapes inside a single query result, so
/// there is no stream-level mode flag that could decide this.
///
/// **This is also the dedup (§4.1).** The two populations are disjoint by
/// construction: a row either has `o2_dbm_kind = 'deadlock'` or it does not, and
/// this branches on exactly that, consuming each row exactly once. There is no
/// path that emits both forms of one row — including for a row that carries BOTH
/// vocabularies, where the canonical branch wins because those fields were
/// resolved once already at ingest and re-deriving them would be strictly worse.
///
/// A raw row the canonicalizer refuses yields `None` and is DROPPED, not emitted
/// blank. That is load-bearing for Postgres, which logs a banner entry beside
/// every DETAIL entry: emitting banners would put a participant-less row on the
/// page for every PG deadlock and double the visible count.
///
/// The residual duplicate risk is not double-EMISSION but double-INGESTION — the
/// same log line ingested by both an OSS and an enterprise node in a mixed
/// cluster is two distinct rows, and the fallback makes the previously-invisible
/// one visible. That duplicate was always there, merely hidden; it resolves once
/// every node is enterprise.
#[cfg(feature = "enterprise")]
fn deadlock_event_for_row(row: &Value) -> Option<server_vantage::DeadlockEvent> {
    if get_str(row, server_vantage::O2_DBM_KIND) == server_vantage::KIND_DEADLOCK {
        return Some(deadlock_event_from_row(row));
    }
    // Not canonical — hand the raw record to the SAME canonicalizer the ingest
    // path uses, so a row read back reads exactly as it would have been written.
    let rec = row.as_object()?;
    o2_enterprise::enterprise::db_monitoring::deadlock::canonicalize_deadlock_event(rec)
}

/// Scope filters (`?system=` / `?instance=` / `?database=`) applied in RUST
/// rather than SQL.
///
/// **Why not SQL.** [`dbm_event_preds`] names `o2_dbm_engine` /
/// `o2_dbm_instance` / `o2_dbm_database`, and a RAW row has none of them —
/// measured, 0 non-null of 137. Appending those predicates to the widened
/// `WHERE` silently drops EVERY raw row, so the fallback would appear to work
/// with no filter and mysteriously under-report with one. The other option,
/// pushing the filters onto the raw rows' vendor equivalents, means reproducing
/// `detect_engine`/`detect_instance` — each of which reads several aliases with
/// fallbacks — in SQL, where it will drift from the Rust it was copied from.
///
/// So narrowing moves to the assembled events, where the canonicalizer has
/// already populated the same three fields on both shapes and ONE filter serves
/// both. This is the shape the page already had for its free-text `search`
/// filter, which has always run in Rust after stitching.
///
/// **Cost.** Raw rows are no longer narrowed before the `LIMIT`, so a
/// heavily-filtered query over a wide history scans up to `limit` rows and may
/// return fewer than `limit` events. Accepted for phase 1 — the page is a
/// diagnostic, not an exhaustive audit — and it is the main candidate for a
/// phase-2 refinement.
///
/// **An UNKNOWN field does not match.** House rule (`plan_row_to_dto`): an
/// absent field defaults to the WEAKER claim. "We do not know which engine this
/// is" is not evidence that it is the one asked for — and it keeps this
/// agreeing with the SQL predicate it replaces, since `AND o2_dbm_engine = 'x'`
/// does not match a NULL column either. Without that agreement the same request
/// would return different rows depending on the kill-switch.
#[cfg(feature = "enterprise")]
struct ScopeNarrowing {
    system: Option<String>,
    instance: Option<String>,
    database: Option<String>,
}

#[cfg(feature = "enterprise")]
impl ScopeNarrowing {
    fn new(q: &DeadlocksQuery) -> Self {
        ScopeNarrowing {
            system: q.system.clone(),
            instance: q.instance.clone(),
            database: q.database().map(str::to_string),
        }
    }

    fn matches(&self, ev: &server_vantage::DeadlockEvent) -> bool {
        // An EMPTY STRING is not a filter, matching `dbm_event_preds`'s own
        // `filter(|s| !s.is_empty())`. The two must agree, or one request
        // narrows differently depending on which path serves it.
        let ok = |want: &Option<String>, got: &Option<String>| match want
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            None => true,
            Some(w) => got.as_deref() == Some(w),
        };
        ok(&self.system, &ev.engine)
            && ok(&self.instance, &ev.instance)
            && ok(&self.database, &ev.database)
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
#[cfg(feature = "enterprise")]
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
#[cfg(feature = "enterprise")]
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
#[cfg(feature = "enterprise")]
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
#[cfg(feature = "enterprise")]
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
    // The liveness scan and the "last one before the window" lookup are
    // independent bounded reads — run them concurrently.
    let last_seen_sql = build_last_seen_sql(
        stream,
        kind,
        start_time - LAST_SEEN_LOOKBACK_MICROS,
        start_time,
        preds,
    );
    let (rows, last_seen_rows) = tokio::join!(
        run_events_search(org_id, stream, sql, probe_start, probe_end),
        run_events_search(
            org_id,
            stream,
            last_seen_sql,
            start_time - LAST_SEEN_LOOKBACK_MICROS,
            start_time,
        ),
    );
    let rows = rows.unwrap_or_else(|e| {
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

    // The "last one was 3 days ago" lookup, strictly before the window so it
    // can never restate a row the table is already showing.
    if let Ok(rows) = last_seen_rows
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

#[cfg(feature = "enterprise")]
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
    pub namespace: Option<String>,
    /// Free text matched over participant statements, applications and objects.
    /// Applied in Rust AFTER stitching so a term matching only one MySQL side
    /// still returns the whole deadlock.
    pub search: Option<String>,
    pub limit: Option<usize>,
}

/// The database filter, under either spelling (`database` or the rollup
/// endpoints' `namespace`) — one accessor for the five server-vantage query
/// structs that carry the pair.
macro_rules! impl_database_filter {
    ($($query:ty),+ $(,)?) => {$(
        impl $query {
            fn database(&self) -> Option<&str> {
                self.database
                    .as_deref()
                    .or(self.namespace.as_deref())
                    .filter(|s| !s.is_empty())
            }
        }
    )+};
}

impl_database_filter!(ActivityQuery, ServerQueriesQuery, ServerSamplesQuery,);

// The two enterprise query types use the same accessor, but only exist on an
// enterprise build.
#[cfg(feature = "enterprise")]
impl_database_filter!(DeadlocksQuery, BlockingQuery,);

/// Does this assembled event match the free-text term?
///
/// Matches over the fields a reader would search by: the statements, the
/// applications and users on each side, and the lock targets. Case-insensitive
/// substring — the term is a needle from the incident, not a pattern language.
#[cfg(feature = "enterprise")]
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
#[cfg(feature = "enterprise")]
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
#[cfg(feature = "enterprise")]
pub async fn get_dbm_deadlocks(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<DeadlocksQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_deadlocks_body(&org_id, &user_email.user_id, &q, false, None).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// OSS stub — deadlocks are an Enterprise capability.
///
/// The ROUTE stays registered (see `router/mod.rs`); only the body is gated.
/// Gating the route would answer 404, which reads as "this build is broken" or
/// "you have the wrong URL"; 403 is what tells the UI to render an upgrade
/// prompt. Deliberately NOT `disabled_response()`, which means
/// `ZO_DB_MONITORING_ENABLED=false` and would send the operator to a collector
/// checklist for a feature no amount of configuration will enable here.
///
/// The `Query<DeadlocksQuery>` extractor is dropped because that type is gated.
#[cfg(not(feature = "enterprise"))]
pub async fn get_dbm_deadlocks(
    Path(_org_id): Path<String>,
    _user_email: UserEmail,
) -> HttpResponse {
    unauthorized_response()
}

/// The deadlocks badge member — only the count-bearing fields the tab strip
/// consumes: `total` (post-stitch, post-filter — the same count the tab
/// renders), `truncated` and `stream`; shape ranking, the DTO serialization
/// and the probe reads are enrichment it never consumes. A callable, like
/// [`server_metrics_envelope`], so the shape is tested for real instead of
/// scraped out of the handler's source text.
#[cfg(feature = "enterprise")]
pub(crate) fn deadlocks_badge_envelope(total: usize, truncated: bool, stream: &str) -> Value {
    json!({
        "total": total,
        "truncated": truncated,
        "stream": stream,
    })
}

/// The full deadlocks response envelope — pure shape assembly (no I/O), same
/// extraction rationale as [`server_metrics_envelope`]: the contract keys are
/// asserted on real JSON instead of scraped out of the handler's source text.
#[cfg(feature = "enterprise")]
pub(crate) fn deadlocks_envelope(
    hits: &[Value],
    shapes: &[Value],
    truncated: bool,
    stream: &str,
    probe: &CollectionProbe,
) -> Value {
    json!({
        "hits": hits,
        "query_shapes": shapes,
        // EVENT count (post-stitch), which is what the tab badge means by
        // "how many deadlocks happened".
        "total": hits.len(),
        // The RAW READ hit its cap, so events older than the oldest returned one
        // exist. Measured on rows, because that is what was capped.
        "truncated": truncated,
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
        "freshness": event_freshness(probe),
    })
}

/// The deadlocks endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`]. The stream permission check stays INSIDE the
/// body, so a badges caller is held to exactly the auth this endpoint
/// enforces.
///
/// `badge_mode` (the badges fan-in) returns [`deadlocks_badge_envelope`] —
/// computed by this same assembly, so agreement with the tab holds — and
/// skips the enrichment nothing on the strip reads. `prologue` shares the
/// fan-in's one (auth, schema) prologue when it covers this body's stream.
#[cfg(feature = "enterprise")]
async fn read_deadlocks_body(
    org_id: &str,
    user_id: &str,
    q: &DeadlocksQuery,
    badge_mode: bool,
    prologue: Option<&DbmServerPrologue>,
) -> Result<Value, HttpResponse> {
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    let shared_prologue = prologue.filter(|p| p.stream == stream);
    // Server-vantage events live in a LOGS stream (`dbm_server` by default),
    // not a trace stream — the permission is checked against the type actually
    // read, or the check would consult the wrong OFGA object. A shared
    // prologue already verified exactly this check for this stream.
    if shared_prologue.is_none()
        && !can_read_stream(
            org_id,
            user_id,
            stream,
            required_stream_for(DbmVantage::Server),
        )
        .await
    {
        return Err(unauthorized_response());
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
    let present = match shared_prologue {
        Some(p) => p.present.clone(),
        None => match present_dbm_columns(org_id, stream).await {
            Ok(present) => present,
            Err(e) => {
                log::error!(
                    "[DbMonitoring] deadlocks schema read failed for {org_id}/{stream}: {e}"
                );
                return Err(MetaHttpResponse::internal_error(e));
            }
        },
    };
    // A1 · the read-time fallback over OSS-ingested rows.
    //
    // An Open Source build stores a deadlock log line VERBATIM and canonicalizes
    // nothing, so an enterprise build reading that history finds no
    // `o2_dbm_kind = 'deadlock'` row and renders an empty page over real
    // deadlocks — measured on a real stream, 239 deadlock rows and 0 visible.
    // With the fallback on, the read ALSO projects the raw vendor columns and
    // canonicalizes those rows here, through the same enterprise canonicalizers
    // the ingest path uses.
    //
    // A failed raw-schema read degrades to `None` rather than failing the
    // request, and that asymmetry with `present` above is deliberate: `present`
    // failing means the CANONICAL path would emit content-free rows, which is a
    // false verdict and must be a 500. The raw gate failing means only that the
    // fallback cannot run — the canonical path is still correct and complete, so
    // the honest answer is today's answer, not an error page. The operator sees
    // the reason in the log.
    //
    // A1.1 · and it is TRANSITIONAL, not permanent. The widening applies only to
    // a window that predates the point at which this deployment started
    // canonicalizing — after that, the canonical fast path only, with no marker
    // terms, no raw projection and no per-row dispatch. That makes it
    // self-limiting: as the pre-upgrade window ages out of retention the
    // fallback stops doing any work, with no operator action and no date to set.
    // See `BoundaryProbe`.
    let raw_fallback = if config::get_config().db_monitoring.deadlock_read_fallback {
        match present_raw_deadlock_columns(org_id, stream).await {
            // The kill-switch short-circuits BEFORE the boundary probe, so
            // turning it off costs nothing at all — the probe never fires.
            Ok(present) => {
                let candidate = RawDeadlockFallback { present };
                if deadlock_window_needs_fallback(org_id, stream, start_time, end_time, &candidate)
                    .await
                {
                    Some(candidate)
                } else {
                    None
                }
            }
            Err(e) => {
                log::warn!(
                    "[DbMonitoring] deadlocks raw-column read failed for {org_id}/{stream}, \
                     serving canonical rows only: {e}"
                );
                None
            }
        }
    } else {
        None
    };

    // SCOPE FILTERS MUST NOT REACH THE RAW ROWS' SQL.
    //
    // `dbm_event_preds` names `o2_dbm_engine`/`o2_dbm_instance`/
    // `o2_dbm_database`, and a raw row has NONE of them — measured, 0 non-null
    // of 137. Appending those predicates to the widened `WHERE` therefore
    // silently drops EVERY raw row, so the page would look correct with no
    // filter and mysteriously under-report with one. The alternative,
    // reproducing `detect_engine`/`detect_instance`'s multi-alias fallbacks in
    // SQL, duplicates logic that will drift.
    //
    // So when the fallback is active the scope narrowing moves to Rust, applied
    // to the assembled events of BOTH shapes — the canonicalizer populates the
    // same three fields on a raw-derived event, so one filter serves both. The
    // free-text `search` filter already worked this way.
    let scope = ScopeNarrowing::new(&q);
    let sql_preds = if raw_fallback.is_some() { "" } else { &preds };
    let sql = build_dbm_events_sql(
        stream,
        server_vantage::KIND_DEADLOCK,
        start_time,
        end_time,
        sql_preds,
        limit,
        &DbmProjection {
            present: &present,
            raw: raw_fallback.as_ref(),
        },
    );
    let rows = match run_events_search(org_id, stream, sql, start_time, end_time).await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[DbMonitoring] deadlocks read failed for {org_id}/{stream}: {e}");
            return Err(MetaHttpResponse::internal_error(e));
        }
    };
    let row_count = rows.len();

    // Per-ROW branch: canonical rows keep the canonical reader, raw rows go to
    // the enterprise canonicalizer, and a raw row it refuses (the PG banner) is
    // dropped rather than emitted blank. Each row is consumed exactly once —
    // that is the dedup, and it is why no deadlock can appear twice.
    let events: Vec<server_vantage::DeadlockEvent> =
        rows.iter().filter_map(deadlock_event_for_row).collect();
    // GAP 2: MySQL logs one entry per transaction side. Without this the tab
    // shows ~2 rows per real deadlock AND splits the sides into different shape
    // groups, so the same bug reads as two unrelated half-sized ones.
    //
    // Unchanged by A1: the stitcher is shape-agnostic, keying on canonical
    // `engine`/`participants`/`victim_side`, which is exactly what the
    // canonicalizer's output provides. The hardest part of the fallback —
    // cross-record assembly — was therefore paid for already by the canonical
    // read path, and the fallback inherits it for free.
    let events = stitch_mysql_deadlocks(events);

    // Scope narrowing, in Rust and AFTER assembly, when the fallback moved it
    // off the SQL. A no-op when the fallback is inactive, because then the SQL
    // predicates already applied and every surviving event matches — but running
    // it unconditionally would be a second, differently-implemented filter on
    // the same request, so it runs exactly where the SQL one did not.
    let events: Vec<server_vantage::DeadlockEvent> = if raw_fallback.is_some() {
        events.into_iter().filter(|e| scope.matches(e)).collect()
    } else {
        events
    };

    let needle = q.search.as_deref().unwrap_or("").trim().to_lowercase();
    let events: Vec<server_vantage::DeadlockEvent> = events
        .into_iter()
        .filter(|e| deadlock_matches_search(e, &needle))
        .collect();

    if badge_mode {
        return Ok(deadlocks_badge_envelope(
            events.len(),
            row_count >= limit,
            stream,
        ));
    }

    // Shapes are ranked over the SAME assembled, filtered set the rows come
    // from, so the ranking and the table can never disagree.
    let shapes = rank_deadlock_shapes(&events);
    let hits: Vec<Value> = events.iter().map(deadlock_event_to_dto).collect();

    // Only diagnose an EMPTY tab. A tab with rows is self-evidently collecting,
    // and the probe is two extra reads that would buy nothing there.
    let probe = if hits.is_empty() {
        probe_collection(
            org_id,
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

    Ok(deadlocks_envelope(
        &hits,
        &shapes,
        row_count >= limit,
        stream,
        &probe,
    ))
}

#[cfg(feature = "enterprise")]
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

/// Free-text match over one blocking sample.
#[cfg(feature = "enterprise")]
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
#[cfg(feature = "enterprise")]
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
#[cfg(feature = "enterprise")]
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
#[cfg(feature = "enterprise")]
pub async fn get_dbm_blocking(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<BlockingQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_blocking_body(&org_id, &user_email.user_id, &q, false, None).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// OSS stub — blocked queries are an Enterprise capability.
/// See [`get_dbm_deadlocks`]'s OSS stub for why this is 403 and not 404 or
/// `disabled_response()`, and why the route stays registered.
#[cfg(not(feature = "enterprise"))]
pub async fn get_dbm_blocking(Path(_org_id): Path<String>, _user_email: UserEmail) -> HttpResponse {
    unauthorized_response()
}

/// The blocking badge member — the strip reads `total`/`truncated` for the
/// badge and `hits` for its high-impact-blocker rule — the same samples the
/// tab renders; chain assembly and the probe reads are enrichment it never
/// consumes. A callable, like [`server_metrics_envelope`], so the shape is
/// tested for real instead of scraped out of the handler's source text.
#[cfg(feature = "enterprise")]
pub(crate) fn blocking_badge_envelope(hits: &[Value], truncated: bool, stream: &str) -> Value {
    json!({
        "hits": hits,
        "total": hits.len(),
        "truncated": truncated,
        "stream": stream,
    })
}

/// The full blocking response envelope — pure shape assembly (no I/O), same
/// extraction rationale as [`server_metrics_envelope`].
#[cfg(feature = "enterprise")]
pub(crate) fn blocking_envelope(
    hits: &[Value],
    chains: &[Value],
    truncated: bool,
    stream: &str,
    probe: &CollectionProbe,
) -> Value {
    json!({
        "hits": hits,
        "chains": chains,
        "total": hits.len(),
        "truncated": truncated,
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
        "freshness": event_freshness(probe),
    })
}

/// The blocking endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`], auth included. `badge_mode`/`prologue`: see
/// [`read_deadlocks_body`] — the badge member is [`blocking_badge_envelope`],
/// which skips chain assembly and the probe reads.
#[cfg(feature = "enterprise")]
async fn read_blocking_body(
    org_id: &str,
    user_id: &str,
    q: &BlockingQuery,
    badge_mode: bool,
    prologue: Option<&DbmServerPrologue>,
) -> Result<Value, HttpResponse> {
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    let shared_prologue = prologue.filter(|p| p.stream == stream);
    // Logs stream, same reasoning as `get_dbm_deadlocks`.
    if shared_prologue.is_none()
        && !can_read_stream(
            org_id,
            user_id,
            stream,
            required_stream_for(DbmVantage::Server),
        )
        .await
    {
        return Err(unauthorized_response());
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
    let present = match shared_prologue {
        Some(p) => p.present.clone(),
        None => match present_dbm_columns(org_id, stream).await {
            Ok(present) => present,
            Err(e) => {
                log::error!(
                    "[DbMonitoring] blocking schema read failed for {org_id}/{stream}: {e}"
                );
                return Err(MetaHttpResponse::internal_error(e));
            }
        },
    };
    let sql = build_dbm_events_sql(
        stream,
        server_vantage::KIND_BLOCKING,
        start_time,
        end_time,
        &preds,
        limit,
        &DbmProjection {
            present: &present,
            // Phase 1 is DEADLOCKS ONLY. Blocking needs its own raw-field
            // mapping via `canonicalize_blocking`, which is engine-agnostic over
            // recipe-aliased columns — a different detection shape from the
            // three deadlock markers. Activity is an OSS-owned ungated page and
            // is not in A1's scope at all.
            raw: None,
        },
    );
    let rows = match run_events_search(org_id, stream, sql, start_time, end_time).await {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[DbMonitoring] blocking read failed for {org_id}/{stream}: {e}");
            return Err(MetaHttpResponse::internal_error(e));
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
    let hits: Vec<Value> = samples.iter().map(blocking_sample_to_dto).collect();

    if badge_mode {
        return Ok(blocking_badge_envelope(&hits, rows.len() >= limit, stream));
    }

    let chains = chains::assemble_chains(&samples);

    // See the deadlocks handler: diagnose only the empty case.
    let probe = if hits.is_empty() {
        probe_collection(
            org_id,
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

    let chain_hits: Vec<Value> = chains.iter().map(|c| c.to_json()).collect();
    Ok(blocking_envelope(
        &hits,
        &chain_hits,
        rows.len() >= limit,
        stream,
        &probe,
    ))
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
    match read_activity_body(&org_id, &user_email.user_id, &q, false, None).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// The activity badge member — the strip reads `hits` (its long-running-query
/// rule's sessions), `by_state` (the badge counts the POPULATION, never the
/// row-capped sample) and `truncated`; the wait-event breakdown, the probe
/// pair and the sample-times read are enrichment nothing on the strip
/// consumes. A callable, like [`server_metrics_envelope`], so the shape is
/// tested for real instead of scraped out of the handler's source text.
pub(crate) fn activity_badge_envelope(
    hits: &[Value],
    by_state: &[Value],
    truncated: bool,
    stream: &str,
) -> Value {
    json!({
        "hits": hits,
        "sampled_sessions": true,
        "by_state": by_state,
        "total": hits.len(),
        "truncated": truncated,
        "stream": stream,
    })
}

/// The full activity response envelope — pure shape assembly (no I/O), same
/// extraction rationale as [`server_metrics_envelope`]: the W2.3 contract
/// keys are asserted on real JSON instead of scraped out of the handler's
/// source text.
pub(crate) fn activity_envelope(
    hits: &[Value],
    by_wait_event: &[Value],
    by_state: &[Value],
    truncated: bool,
    stream: &str,
    probe: &CollectionProbe,
) -> Value {
    json!({
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
        "truncated": truncated,
        "stream": stream,
        // ── collection diagnostics (empty state) ──────────────────────────
        // BOTH conditions, never either: the probe read can fail independently
        // (swallowed into an empty row set by design), and under `OR` that blip
        // would announce a broken collector WHILE RENDERING SESSIONS.
        "not_collecting": hits.is_empty() && probe.not_collecting(),
        "log_lines_seen": probe.log_lines_seen(),
        "sampled_at": probe.newest_record,
        // The honesty requirement: how often the collector actually polls,
        // inferred from the spacing of observed samples. Null when too few
        // samples to infer, and the UI falls back to non-numeric copy.
        "sample_interval_seconds": probe.sample_interval_seconds(),
        "freshness": event_freshness(probe),
    })
}

/// The activity endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`], auth included. `badge_mode`/`prologue`: see
/// [`read_deadlocks_body`] — the badge member is [`activity_badge_envelope`],
/// which skips the wait-event breakdown, the probe and the sample-times
/// reads.
async fn read_activity_body(
    org_id: &str,
    user_id: &str,
    q: &ActivityQuery,
    badge_mode: bool,
    prologue: Option<&DbmServerPrologue>,
) -> Result<Value, HttpResponse> {
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    let shared_prologue = prologue.filter(|p| p.stream == stream);
    // A LOGS stream, same as deadlocks/blocking. StreamType::Traces here would
    // consult the wrong OFGA object and silently authorize.
    if shared_prologue.is_none()
        && !can_read_stream(
            org_id,
            user_id,
            stream,
            required_stream_for(DbmVantage::Server),
        )
        .await
    {
        return Err(unauthorized_response());
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .clamp(1, MAX_EVENTS_LIMIT);
    let preds = dbm_event_preds(q.system.as_deref(), q.instance.as_deref(), q.database());

    // Same rule as `read_deadlocks_body`: a failed schema read is reported,
    // never absorbed into an empty set. See `present_dbm_columns`.
    let present = match shared_prologue {
        Some(p) => p.present.clone(),
        None => match present_dbm_columns(org_id, stream).await {
            Ok(present) => present,
            Err(e) => {
                log::error!(
                    "[DbMonitoring] activity schema read failed for {org_id}/{stream}: {e}"
                );
                return Err(MetaHttpResponse::internal_error(e));
            }
        },
    };

    let sql = build_dbm_events_sql(
        stream,
        server_vantage::KIND_ACTIVITY,
        start_time,
        end_time,
        &preds,
        limit,
        &DbmProjection {
            present: &present,
            // Phase 1 is DEADLOCKS ONLY. Blocking needs its own raw-field
            // mapping via `canonicalize_blocking`, which is engine-agnostic over
            // recipe-aliased columns — a different detection shape from the
            // three deadlock markers. Activity is an OSS-owned ungated page and
            // is not in A1's scope at all.
            raw: None,
        },
    );
    // ── all five reads CONCURRENTLY ───────────────────────────────────────
    //
    // Session rows, the two breakdowns, the probe and the sample-times query
    // are independent questions over the same window, and awaited in series
    // their latencies added: measured live at a 12h window this handler took
    // 5.4s, by far the slowest read in DBM. Only the ROW query is fatal on
    // failure; the aggregates keep their degrade-to-empty behaviour.
    let rows_fut = run_events_search(org_id, stream, sql, start_time, end_time);
    let by_wait_fut = async {
        match build_dbm_activity_breakdown_sql(
            stream,
            server_vantage::O2_DBM_WAIT_EVENT_TYPE,
            Some(server_vantage::O2_DBM_WAIT_EVENT),
            start_time,
            end_time,
            &preds,
            &present,
        ) {
            Some(sql) => wait_event_breakdown(
                &run_events_search(org_id, stream, sql, start_time, end_time)
                    .await
                    .unwrap_or_default(),
            ),
            None => Vec::new(),
        }
    };
    let by_state_fut = async {
        match build_dbm_activity_breakdown_sql(
            stream,
            server_vantage::O2_DBM_SESSION_STATE,
            None,
            start_time,
            end_time,
            &preds,
            &present,
        ) {
            Some(sql) => state_breakdown(
                &run_events_search(org_id, stream, sql, start_time, end_time)
                    .await
                    .unwrap_or_default(),
            ),
            None => Vec::new(),
        }
    };

    if badge_mode {
        // The strip reads `hits` (its long-running-query rule's sessions),
        // `by_state` (the badge counts the POPULATION, never the row-capped
        // sample) and `truncated` — two searches instead of six; the
        // wait-event breakdown, the probe pair and the sample-times read are
        // enrichment nothing on the strip consumes.
        let (rows, by_state) = tokio::join!(rows_fut, by_state_fut);
        let rows = match rows {
            Ok(rows) => rows,
            Err(e) => {
                log::error!("[DbMonitoring] activity read failed for {org_id}/{stream}: {e}");
                return Err(MetaHttpResponse::internal_error(e));
            }
        };
        let row_count = rows.len();
        let hits: Vec<Value> = rows.iter().map(activity_row_to_dto).collect();
        return Ok(activity_badge_envelope(
            &hits,
            &by_state,
            row_count >= limit,
            stream,
        ));
    }

    // The probe runs UNCONDITIONALLY here, unlike the deadlocks/blocking
    // template which computes it only on an empty tab.
    //
    // That template is right for a rare EVENT and wrong for a continuous 10s
    // POLL: `sample_interval_seconds` is the disclosure that this page is
    // sampled rather than live, so gating it on emptiness would state the
    // page's fidelity only when there were no sessions to state it about —
    // inverting the honesty requirement exactly. Named `interval_probe` because
    // it is read for the interval whether or not the tab is empty.
    let probe_fut = probe_collection(
        org_id,
        stream,
        server_vantage::KIND_ACTIVITY,
        start_time,
        end_time,
        &preds,
    );
    // Recover the poll spacing from a DISTINCT query rather than from the shared
    // probe's row scan: activity writes one row per session per poll, so 2000
    // scanned rows can be a single poll on a busy instance and the interval
    // would read null exactly where the disclosure matters most.
    let times_fut = run_events_search(
        org_id,
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
    );

    let (rows, by_wait_event, by_state, mut interval_probe, times_result) =
        tokio::join!(rows_fut, by_wait_fut, by_state_fut, probe_fut, times_fut);

    let rows = match rows {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[DbMonitoring] activity read failed for {org_id}/{stream}: {e}");
            return Err(MetaHttpResponse::internal_error(e));
        }
    };
    let row_count = rows.len();
    let hits: Vec<Value> = rows.iter().map(activity_row_to_dto).collect();

    if let Ok(times) = times_result
        && !times.is_empty()
    {
        let mut ts: Vec<i64> = times.iter().map(|r| get_i64(r, "_timestamp")).collect();
        ts.sort_unstable_by(|a, b| b.cmp(a));
        ts.dedup();
        interval_probe.kind_sample_times = ts;
    }

    Ok(activity_envelope(
        &hits,
        &by_wait_event,
        &by_state,
        row_count >= limit,
        stream,
        &interval_probe,
    ))
}

// ─── W3.4 · Plans read API ───────────────────────────────────────────────────
//
// **What this endpoint may and may not claim (D-H), PER RECORD.** Two producers
// write plans now, with different epistemic status, and every claim below is
// conditional on the row's `o2_dbm_plan_source`:
//
// `generic_null_bound` (the receiver's `db.server.top_query`): a GENERIC,
// NULL-BOUND, ESTIMATED plan — `plan_cache_mode = force_generic_plan`,
// PREPAREd, EXPLAINed with every bind bound to literal `null`. So:
//
//   * it is not "the plan that ran" — Postgres's default `plan_cache_mode = auto` means production
//     may well have executed a CUSTOM plan;
//   * a hash CHANGE is a real signal (a dropped index or a repartition moves it);
//   * a STABLE hash is NOT an all-clear — generic plans are a pure function of (statement, schema,
//     stats) and are stable by construction, so the classic "planner flipped to a seq scan at
//     03:04" incident may never move it;
//   * LATENCY IS NEVER ATTRIBUTED TO one of these plans. Per-plan latency would come from
//     `pg_stat_statements` real executions while this plan was never executed.
//
// `auto_explain` (the W-E3 filelog producer): the plan Postgres ACTUALLY
// EXECUTED, with real binds, and — when `log_analyze` was on — real row counts
// and a real per-execution duration. For these rows a duration IS defensible:
// each record carries its OWN measured wall clock, so `avg/max duration across
// N captured executions` attributes latency only to executions that really ran
// under that plan. Two hard limits survive: the capture is threshold-filtered
// and possibly sampled (`log_min_duration` / `sample_rate`), so aggregates
// describe the CAPTURED population, never "average latency"; and a generic
// row still never gets a latency — the absent-not-null DTO shape makes the
// executed/generic distinction structural, not stylistic.
//
// The per-hit `plan_source` states which contract each row is under (absent ⇒
// generic: rows written before the column existed can only be generic); the
// response-level `plan_source` is a derived summary of the hits.

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
    // Deliberately SUM(calls) and never any pg_stat_statements exec-time
    // aggregate: see D-H above.
    let calls_col = if present.contains(server_vantage::O2_DBM_CALLS) {
        format!("SUM({}) AS calls", server_vantage::O2_DBM_CALLS)
    } else {
        "0 AS calls".to_string()
    };
    // Provenance is part of the GROUP key when the stream has it (E-C): the two
    // producers can — by design — yield the SAME structural hash, and collapsing
    // an executed group into a generic one would erase the very distinction the
    // per-record column exists to surface. A stream written before the column
    // existed can only hold generic rows, so grouping by hash alone stays
    // correct there and the DTO backfills the source.
    let has_source = present.contains(server_vantage::O2_DBM_PLAN_SOURCE);
    let (source_col, source_group) = if has_source {
        (
            format!(
                ", MAX({}) AS plan_source",
                server_vantage::O2_DBM_PLAN_SOURCE
            ),
            format!(", {}", server_vantage::O2_DBM_PLAN_SOURCE),
        )
    } else {
        (String::new(), String::new())
    };
    // EXECUTED-only aggregates, over the per-execution durations auto_explain
    // measured. This is NOT the banned latency-by-plan: each explain row
    // carries its OWN real wall clock for an execution that really ran under
    // this plan. The generic groups yield NULLs here (top_query rows have no
    // duration column) and the DTO omits the keys for them.
    let duration_cols = if present.contains(server_vantage::O2_DBM_PLAN_DURATION_MS) {
        format!(
            ", AVG({d}) AS avg_duration_ms, MAX({d}) AS max_duration_ms, \
             COUNT({d}) AS executions",
            d = server_vantage::O2_DBM_PLAN_DURATION_MS
        )
    } else {
        String::new()
    };
    Some(format!(
        "SELECT {hash} AS plan_hash, {plan_col}, {version_col}, {calls_col}, \
         MIN(_timestamp) AS first_seen, MAX(_timestamp) AS last_seen{source_col}{duration_cols} \
         FROM \"{stream}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    \
         AND {kind} IN ('{kind_top}', '{kind_explain}')\n    AND {fp} = '{fp_val}'{preds}\n\
         GROUP BY {hash}{source_group}\nORDER BY last_seen DESC",
        hash = server_vantage::O2_DBM_PLAN_HASH,
        stream = escape_ident(stream_name),
        kind = server_vantage::O2_DBM_KIND,
        kind_top = escape_sq(server_vantage::KIND_TOP_QUERY),
        kind_explain = escape_sq(server_vantage::KIND_EXPLAIN),
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
    // Per-hit provenance (E-C). Absent ⇒ generic: rows written before the
    // column existed can only be generic — nothing else could have written
    // them — so the backfill defaults to the WEAKER claim. Defaulting the
    // other way would silently upgrade every historical row to a claim it
    // cannot support.
    let plan_source = row
        .get("plan_source")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(server_vantage::PLAN_SOURCE_GENERIC);
    let mut dto = json!({
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
        "plan_source": plan_source,
    });
    // Duration keys — ONLY on executed hits that measured one, and ABSENT (not
    // null) everywhere else. A null latency on a generic plan invites a UI to
    // render "—" in a latency column and thereby implies the column APPLIES to
    // that row, which is the exact framing D-H forbids. The invariant: a claim
    // about duration appears on a hit if and only if that hit carries a real
    // duration.
    if plan_source == server_vantage::PLAN_SOURCE_AUTO_EXPLAIN
        && let Some(avg) = row.get("avg_duration_ms").and_then(Value::as_f64)
    {
        let obj = dto.as_object_mut().unwrap();
        obj.insert("avg_duration_ms".into(), json!(avg));
        if let Some(max) = row.get("max_duration_ms").and_then(Value::as_f64) {
            obj.insert("max_duration_ms".into(), json!(max));
        }
        if let Some(execs) = row.get("executions").and_then(Value::as_i64) {
            obj.insert("executions".into(), json!(execs));
        }
    }
    dto
}

/// The response-level `plan_source` summary, derived from the hits (E-C).
///
/// Kept for the UI type that predates per-hit provenance, but no longer a
/// constant: a window holding both producers is `"mixed"`, and calling it
/// either single value would mislabel half the rows. An empty window reads as
/// generic — the weaker claim, same reasoning as the DTO backfill.
fn derived_plan_source(hits: &[Value]) -> &'static str {
    let mut saw_executed = false;
    let mut saw_generic = false;
    for h in hits {
        match h.get("plan_source").and_then(Value::as_str) {
            Some(server_vantage::PLAN_SOURCE_AUTO_EXPLAIN) => saw_executed = true,
            _ => saw_generic = true,
        }
    }
    match (saw_executed, saw_generic) {
        (true, true) => "mixed",
        (true, false) => server_vantage::PLAN_SOURCE_AUTO_EXPLAIN,
        _ => server_vantage::PLAN_SOURCE_GENERIC,
    }
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
    database: Option<&str>,
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

    // The database predicate exists only when the engine's records carry one:
    // mysql/mariadb top_query rows ship NO database field at all (verified
    // live — 43k records, zero with a database), so a database predicate
    // against them matches nothing forever, and the section told every MySQL
    // reader to "set up" capture that was already running. Absent, the match
    // is (fingerprint, engine) and the instance GROUPing below carries the
    // cross-instance protection exactly as it always did.
    let db_pred = match database {
        Some(db) => format!(
            "\n    AND {} = '{}'",
            server_vantage::O2_DBM_DATABASE,
            escape_sq(db)
        ),
        None => String::new(),
    };
    // NOTE the absent instance predicate: see the module note above. The
    // instance is SELECTed and GROUPed (display + ambiguity detection) but
    // never constrained, or every match behind a pooler is lost.
    Some(format!(
        "SELECT {inst} AS instance, SUM({calls}) AS calls, {cols}, \
         MIN(_timestamp) AS first_seen, MAX(_timestamp) AS last_seen \
         FROM \"{stream}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    \
         AND {kind} = '{kind_val}'\n    AND {fp} = '{fp_val}'\n    \
         AND {eng} = '{eng_val}'{db_pred}\nGROUP BY {inst}\n\
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
    database_scoped: bool,
) -> Value {
    let base = json!({
        "stream": stream,
        "server_metrics_capture": capture,
        // What the folded exec-time field measured on THIS engine, so the
        // header can name it rather than guessing.
        "exec_time_kind": exec_time_kind(engine),
        // Whether the counters were narrowed to ONE database or cover the
        // whole instance. mysql/mariadb records carry no database, so their
        // numbers are instance-wide by construction — the UI must caption
        // that rather than let them read as per-database figures.
        "attribution": if database_scoped { "database" } else { "instance" },
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
///
/// SUPERSEDED by [`get_dbm_query_insights`], which returns this exact envelope
/// as its `server_metrics` section. That merge is the one this endpoint's own
/// doc comment argued FOR: `/query/plans` shares this handler's stream, auth
/// model and schema read, so the pair costs nothing to fold — unlike
/// `/queries`, which does not. Kept registered and unchanged for compatibility.
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
    match read_server_metrics_body(&org_id, &user_email.user_id, &q, None).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// The server-metrics endpoint's whole body as a callable — same extraction and
/// same `prologue` contract as [`read_plans_body`].
async fn read_server_metrics_body(
    org_id: &str,
    user_id: &str,
    q: &ServerMetricsQuery,
    prologue: Option<&DbmServerPrologue>,
) -> Result<Value, HttpResponse> {
    let Some(fingerprint) = q.fingerprint.as_deref().filter(|f| !f.is_empty()) else {
        return Err(MetaHttpResponse::bad_request("fingerprint is required"));
    };
    let Some(engine) = q.engine.as_deref().filter(|e| !e.is_empty()) else {
        return Err(MetaHttpResponse::bad_request("engine is required"));
    };
    // The database is part of the join key WHERE THE ENGINE'S RECORDS CARRY
    // ONE — for those engines an absent database cannot be defaulted, since an
    // empty predicate would match every database and attribute the wrong one's
    // counters. mysql/mariadb top_query records carry NO database field at all
    // (receiver contract, verified live), so for them the predicate is
    // dropped: the match is (fingerprint, engine), instance ambiguity is
    // still refused by the envelope, and the response says the attribution is
    // instance-wide so the UI can caption it honestly.
    //
    // The rule itself lives in [`has_server_metrics_join_key`], shared with
    // `/query/insights` so its decision to skip the section and this handler's
    // decision to 400 are the SAME rule — a drift would show up as a failed
    // section where the truth is "there was no key to join on".
    let database_less_engine = matches!(engine.to_ascii_lowercase().as_str(), "mysql" | "mariadb");
    let database = q.database.as_deref().filter(|d| !d.is_empty());
    if !has_server_metrics_join_key(Some(engine), database) {
        return Err(MetaHttpResponse::bad_request("database is required"));
    }
    // Sent-but-unusable: a database predicate against records that carry no
    // database column matches nothing forever — the exact bug this branch
    // exists to end.
    let database = if database_less_engine { None } else { database };
    // Defaults, like `/query/plans`: these are server-vantage records in the
    // single shared LOGS stream. Requiring it would make the UI hardcode a
    // backend constant to reach its own endpoint.
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    // The shared prologue only applies to the stream it was computed for — see
    // `read_plans_body`.
    let shared = prologue.filter(|p| p.stream == stream);
    if shared.is_none() {
        // Checked BEFORE the range parsing, so a caller cannot probe stream
        // existence through error-message differences. A LOGS stream — these
        // are server-vantage records, and `StreamType::Traces` (which the
        // client-vantage endpoints correctly use) would consult the wrong OFGA
        // object and silently authorize.
        if !can_read_stream(
            org_id,
            user_id,
            stream,
            required_stream_for(DbmVantage::Server),
        )
        .await
        {
            return Err(unauthorized_response());
        }
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }

    // Same rule as `read_deadlocks_body`: a failed schema read is reported,
    // never absorbed into an empty set. See `present_dbm_columns`.
    let present = match shared {
        Some(p) => p.present.clone(),
        None => match present_dbm_columns(org_id, stream).await {
            Ok(present) => present,
            Err(e) => {
                log::error!(
                    "[DbMonitoring] server metrics schema read failed for {org_id}/{stream}: {e}"
                );
                return Err(MetaHttpResponse::internal_error(e));
            }
        },
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
        Some(sql) => match run_events_search(org_id, stream, sql, start_time, end_time).await {
            Ok(rows) => rows,
            Err(e) => {
                log::error!("[DbMonitoring] server metrics read failed for {org_id}/{stream}: {e}");
                return Err(MetaHttpResponse::internal_error(e));
            }
        },
        // The stream has never carried server counters — an empty section, not
        // an error.
        None => Vec::new(),
    };

    Ok(server_metrics_envelope(
        &rows,
        engine,
        stream,
        server_metrics_capture_state(&present),
        database.is_some(),
    ))
}

// ─── Server-vantage query list (`/server_queries`) ───────────────────────────
//
// The whole-list sibling of `/query/server_metrics`: the same per-fingerprint
// fold, grouped over every statement in the window instead of filtered to one.
// It exists for the deployment that wired the database collector but traces no
// application traffic — there the client-vantage `/queries` list is honestly
// empty, while the databases themselves have been reporting their statement
// counters all along.
//
// A SEPARATE endpoint, never a fallback folded into `/queries`: `/queries`
// reads the rollup and live trace tails under `StreamType::Traces` auth, and
// folding a Logs-auth server source into it would put three provenances under
// two auth models in one response (see `get_dbm_query_server_metrics`). The UI
// renders these rows under their own heading for the same reason — a
// server-side call count sitting unlabelled in a client-vantage table would
// read as traced traffic that never existed.
//
// **This list ranks by CALL COUNT and can do nothing else honestly.** The
// receiver's top_query feed is a most-FREQUENT top-N (`KIND_TOP_QUERY` docs):
// the expensive-but-rare statement may never have been sent at all, so a list
// re-ranked by total time would present a call-count-selected sample as "your
// most expensive queries". `ranked_by` states the ordering on the wire so the
// UI cannot silently retitle it.

/// A browse page, not an export: 50 rows is what a reader scans, and the cap
/// keeps the grouped fold bounded on a stream holding weeks of intervals.
const DEFAULT_SERVER_QUERIES_LIMIT: usize = 50;
const MAX_SERVER_QUERIES_LIMIT: usize = 200;

/// Whether server-side counters have EVER been captured on this stream —
/// `"on"` or `"off"`. Same contract as [`server_metrics_capture_state`], with
/// one addition: this list also needs the FINGERPRINT column (it is the group
/// key and the navigation key to the detail page), so a stream carrying calls
/// but no fingerprints reports `"off"` here while the single-query endpoint
/// still answers.
///
/// Deliberately the SAME condition [`build_dbm_server_queries_sql`] skips on:
/// reported independently the two would drift, and the UI would tell a user
/// their capture is off while the query it gates ran fine.
pub(crate) fn server_queries_capture_state(present: &HashSet<String>) -> &'static str {
    if present.contains(server_vantage::O2_DBM_CALLS)
        && present.contains(server_vantage::O2_DBM_FINGERPRINT)
    {
        "on"
    } else {
        "off"
    }
}

/// The window's statements as the databases reported them, one row per
/// (fingerprint, engine, database, instance), ranked by summed call count.
///
/// The counters are PER-INTERVAL DELTAS (`o2_dbm_metrics_are_delta`, stated
/// unconditionally by the writer), so `SUM` over the window is the correct
/// fold and the SAME one `build_dbm_server_metrics_sql` performs — treating
/// them as cumulative gauges (MAX) would discard every interval but one.
/// The known asymmetry is inherited from the writer, not introduced here: the
/// first emission per statement carries the whole `pg_stat_statements`
/// backlog, which the writer documents as undetectable per record.
///
/// `MAX(query)` picks one representative text per group — every row in a group
/// shares a fingerprint, so the texts differ only in normalizer-invisible
/// spacing and which one is arbitrary (the `MAX(plan)` reasoning).
///
/// The dimension columns are grouped only when the STREAM carries them:
/// naming an absent column fails the whole query with a schema error, and
/// mysql/mariadb feeds legitimately ship no database at all.
///
/// `None` when the stream has never carried the counter or fingerprint columns
/// — an empty section, not a 500 (`ZO_DB_MONITORING_TOP_QUERY_ENABLED`
/// defaults OFF).
pub(crate) fn build_dbm_server_queries_sql(
    stream_name: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
    limit: usize,
    present: &HashSet<String>,
) -> Option<String> {
    if !present.contains(server_vantage::O2_DBM_CALLS)
        || !present.contains(server_vantage::O2_DBM_FINGERPRINT)
    {
        return None;
    }
    // Group keys under their WIRE aliases: storage names never reach the
    // browser (the `activity_row_to_dto` contract), and aliasing in SQL keeps
    // the reader below a plain key lookup. GROUP BY names the storage columns.
    let mut group_cols: Vec<&str> = vec![server_vantage::O2_DBM_FINGERPRINT];
    let mut projected: Vec<String> = vec![format!(
        "{} AS fingerprint",
        server_vantage::O2_DBM_FINGERPRINT
    )];
    for (col, alias) in [
        (server_vantage::O2_DBM_ENGINE, "db_system"),
        (server_vantage::O2_DBM_DATABASE, "db_namespace"),
        (server_vantage::O2_DBM_INSTANCE, "db_instance"),
    ] {
        if present.contains(col) {
            group_cols.push(col);
            projected.push(format!("{col} AS {alias}"));
        } else {
            projected.push(format!("NULL AS {alias}"));
        }
    }
    let query_text = if present.contains(server_vantage::O2_DBM_ACTIVITY_QUERY) {
        format!("MAX({}) AS query", server_vantage::O2_DBM_ACTIVITY_QUERY)
    } else {
        "NULL AS query".to_string()
    };
    let exec_time = if present.contains(server_vantage::O2_DBM_EXEC_TIME_S) {
        format!("SUM({}) AS exec_time_s", server_vantage::O2_DBM_EXEC_TIME_S)
    } else {
        "NULL AS exec_time_s".to_string()
    };
    Some(format!(
        "SELECT {proj}, {query_text}, SUM({calls}) AS calls, {exec_time}, \
         MIN(_timestamp) AS first_seen, MAX(_timestamp) AS last_seen \
         FROM \"{stream}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    \
         AND {kind} = '{kind_val}'{preds}\nGROUP BY {group}\n\
         ORDER BY calls DESC\nLIMIT {limit}",
        proj = projected.join(", "),
        calls = server_vantage::O2_DBM_CALLS,
        stream = escape_ident(stream_name),
        kind = server_vantage::O2_DBM_KIND,
        kind_val = escape_sq(server_vantage::KIND_TOP_QUERY),
        group = group_cols.join(", "),
    ))
}

/// The server-queries response envelope — a callable fn, so the shape is
/// tested for real instead of scraped out of the handler's source text.
///
/// Per hit: the MEAN and never a percentile (`pg_stat_statements` accumulates
/// a total and a count, so a quotient is the only central tendency this feed
/// supports), and `exec_time_kind` states what the folded time field measured
/// on that row's engine — Postgres execution vs MySQL wait (see
/// [`exec_time_kind`]) — so a mixed-engine list cannot mislabel either.
pub(crate) fn server_queries_envelope(
    rows: &[Value],
    stream: &str,
    capture: &str,
    limit: usize,
) -> Value {
    let hits: Vec<Value> = rows
        .iter()
        .map(|r| {
            let calls = rollup::get_i64(r, "calls");
            let exec_time_s = r.get("exec_time_s").and_then(Value::as_f64);
            let engine = rollup::get_str(r, "db_system");
            // The MEAN, and never a percentile — see the envelope docs.
            let mean_exec_time_s = match (exec_time_s, calls) {
                (Some(total), c) if c > 0 => json!(total / c as f64),
                _ => Value::Null,
            };
            json!({
                "fingerprint": rollup::get_str(r, "fingerprint"),
                "query": str_or_null(r, "query"),
                "db_system": engine,
                "db_namespace": str_or_null(r, "db_namespace"),
                "db_instance": str_or_null(r, "db_instance"),
                "calls": calls,
                "exec_time_s": exec_time_s,
                "mean_exec_time_s": mean_exec_time_s,
                "exec_time_kind": exec_time_kind(&engine),
                "first_seen": rollup::get_i64(r, "first_seen"),
                "last_seen": rollup::get_i64(r, "last_seen"),
            })
        })
        .collect();
    json!({
        "hits": hits,
        "total": hits.len(),
        // Group count against the cap: the SQL LIMIT bites on GROUPS, so a
        // full page means more statements existed than were returned.
        "truncated": rows.len() >= limit,
        "stream": stream,
        "server_queries_capture": capture,
        // The feed's own selection criterion, stated so the UI titles the list
        // as "most frequently run" rather than implying most expensive — the
        // receiver sends a most-frequent slice and rows outside it never
        // arrive (see KIND_TOP_QUERY).
        "ranked_by": "calls",
    })
}

#[derive(Debug, Deserialize)]
pub struct ServerQueriesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    /// See [`DeadlocksQuery::database`] — `namespace` is the same concept under
    /// the rollup endpoints' spelling.
    pub database: Option<String>,
    pub namespace: Option<String>,
    /// Narrow the list to ONE statement, for the query-detail page's row
    /// lookup on a deployment with no traced traffic. Without it that page can
    /// only find its row by paging the whole ranked list, and a statement
    /// ranked below the cap is indistinguishable from one that does not exist.
    ///
    /// Additive and optional: absent, this endpoint is byte-identically the
    /// ranked browse list it has always been.
    pub fingerprint: Option<String>,
    pub limit: Option<usize>,
}

/// GET /{org_id}/traces/db_monitoring/server_queries — the statement list as
/// the DATABASES report it, for deployments with no traced application
/// traffic.
///
/// Ranked by call count because the underlying feed is a most-frequent top-N
/// and can support no other ranking honestly — see the module note above.
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/server_queries",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringServerQueries",
    summary = "Database Monitoring: statements as reported by the databases themselves",
    description = "Per-statement counters (pg_stat_statements / events_statements_summary_by_digest) aggregated over the window, ranked by call count. Server-vantage: measured inside the database across every client, disjoint from the trace-derived /queries list. Reports a MEAN and never a percentile.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default 'dbm_server')"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("database" = Option<String>, Query, description = "Database name filter (alias: namespace)"),
        ("fingerprint" = Option<String>, Query, description = "Narrow to one statement — the query-detail row lookup on a deployment with no traced traffic. Omit for the ranked browse list."),
        ("limit" = Option<usize>, Query, description = "Max statements returned (default 50, cap 200)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_server_queries(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<ServerQueriesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_server_queries_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// The server-queries endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`]. [`get_dbm_badges`] runs it as the zero-trace
/// fallback slice, under the same Logs-stream auth this endpoint enforces.
async fn read_server_queries_body(
    org_id: &str,
    user_id: &str,
    q: &ServerQueriesQuery,
) -> Result<Value, HttpResponse> {
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    // Same rule as `get_dbm_query_server_metrics`: Logs-stream auth, checked
    // BEFORE range parsing so stream existence cannot be probed.
    if !can_read_stream(
        org_id,
        user_id,
        stream,
        required_stream_for(DbmVantage::Server),
    )
    .await
    {
        return Err(unauthorized_response());
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_SERVER_QUERIES_LIMIT)
        .clamp(1, MAX_SERVER_QUERIES_LIMIT);
    let mut preds = dbm_event_preds(q.system.as_deref(), q.instance.as_deref(), q.database());
    // The fingerprint narrows to ONE statement. Safe to name unguarded: the
    // SQL builder below already refuses to run at all unless the fingerprint
    // column is present (it is the GROUP key), so this predicate can never
    // name a column the stream lacks.
    if let Some(fp) = q.fingerprint.as_deref().filter(|f| !f.is_empty()) {
        preds.push_str("\n    AND ");
        preds.push_str(server_vantage::O2_DBM_FINGERPRINT);
        preds.push_str(" = '");
        preds.push_str(&escape_sq(fp));
        preds.push('\'');
    }

    // Same rule as `read_deadlocks_body` (see `present_dbm_columns`), and here
    // an absorbed error would report a healthy capture pipeline as `off`.
    let present = match present_dbm_columns(org_id, stream).await {
        Ok(present) => present,
        Err(e) => {
            log::error!(
                "[DbMonitoring] server queries schema read failed for {org_id}/{stream}: {e}"
            );
            return Err(MetaHttpResponse::internal_error(e));
        }
    };

    let rows =
        match build_dbm_server_queries_sql(stream, start_time, end_time, &preds, limit, &present) {
            Some(sql) => match run_events_search(org_id, stream, sql, start_time, end_time).await {
                Ok(rows) => rows,
                Err(e) => {
                    log::error!(
                        "[DbMonitoring] server queries read failed for {org_id}/{stream}: {e}"
                    );
                    return Err(MetaHttpResponse::internal_error(e));
                }
            },
            // The stream has never carried server counters — an empty section, not
            // an error.
            None => Vec::new(),
        };

    Ok(server_queries_envelope(
        &rows,
        stream,
        server_queries_capture_state(&present),
        limit,
    ))
}

// ─── Server-vantage slowest executions (`/server_samples`) ───────────────────
//
// The server-vantage sibling of `/samples` (FR-6), for the same
// no-traced-traffic deployment `/server_queries` serves. Each hit is ONE real
// execution with its OWN measured wall-clock duration, from either of the two
// per-execution producers the server vantage has:
//
//   • `KIND_STATEMENT` — a `log_min_duration_statement` completed-statement
//     line (exact duration, every client, no plan), and
//   • `KIND_EXPLAIN` — a Postgres `auto_explain` record (the same measurement
//     with the executed plan attached).
//
// The top_query counters CANNOT power this list: they are interval
// aggregates, and presenting an interval total (or its mean) as "a slow call"
// would invent executions that never happened.
//
// **The two producers land on DIFFERENT streams by design.** The demo
// collector routes only the kinds it knew the backend could read (deadlock /
// explain) to `dbm_server`; the tailed database-log remainder — which is
// where statement-duration lines live — goes to the `dbm_server_logs`
// sibling. So when the caller names no stream, the handler reads BOTH
// defaults and merges, rather than defaulting to one and silently losing the
// other producer's rows. An explicit `?stream=` still means that one stream.
//
// What these rows honestly are, and the envelope states both limits:
//   • measured INSIDE the database — in-engine time from statement start to
//     completion, not what any caller experienced (network and connection
//     wait are not in it);
//   • a THRESHOLD-FILTERED capture: `log_min_duration_statement` /
//     `auto_explain.log_min_duration` (and possibly `sample_rate`) decide
//     which executions get logged, so the rows describe the captured
//     population, never "all executions". The rows the threshold admitted ARE
//     the slow ones, which is what this page ranks — but a quiet window means
//     "nothing crossed the threshold", not "nothing ran".

/// The stream the demo tailer routes the raw database-log remainder to — the
/// sibling of [`DEFAULT_SERVER_STREAM`], and where `KIND_STATEMENT` rows land
/// (the collector's routing sends only deadlock/explain lines to
/// `dbm_server`; everything else in the tailed log, statement durations
/// included, goes here).
const DEFAULT_SERVER_LOGS_STREAM: &str = "dbm_server_logs";

/// The per-execution duration columns, in COALESCE order: the statement-log
/// duration first — on any row carrying both (impossible today: the kinds are
/// disjoint) the plainer measurement wins.
const SAMPLE_DURATION_COLS: [&str; 2] = [
    server_vantage::O2_DBM_STMT_DURATION_MS,
    server_vantage::O2_DBM_PLAN_DURATION_MS,
];

/// Whether per-execution capture has EVER run against this stream — `"on"` or
/// `"off"`. Gate: EITHER per-execution duration column, the field that makes
/// a row a single execution rather than an interval aggregate.
///
/// Deliberately the SAME condition [`build_dbm_server_samples_sql`] skips on —
/// see [`server_queries_capture_state`] for why the two must not drift.
pub(crate) fn server_samples_capture_state(present: &HashSet<String>) -> &'static str {
    if SAMPLE_DURATION_COLS.iter().any(|c| present.contains(*c)) {
        "on"
    } else {
        "off"
    }
}

/// The slowest captured executions in the window, one row per EXECUTION.
///
/// A plain ranked fetch, no grouping: each `KIND_STATEMENT` / `KIND_EXPLAIN`
/// record is one real execution carrying its own measured duration, so a
/// top-N by that duration is exact over the captured population.
///
/// The duration expression COALESCEs whichever of the two per-execution
/// columns the stream carries, and only the present ones are named — naming
/// an absent column fails the whole query with a schema error, and a stream
/// normally carries exactly one of the two (the producers land on different
/// streams).
///
/// `None` when the stream has never carried EITHER per-execution duration
/// column — an empty section, not a 500 (both captures are opt-in database
/// settings).
pub(crate) fn build_dbm_server_samples_sql(
    stream_name: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
    limit: usize,
    present: &HashSet<String>,
) -> Option<String> {
    let dur_cols: Vec<&str> = SAMPLE_DURATION_COLS
        .iter()
        .copied()
        .filter(|c| present.contains(*c))
        .collect();
    let dur = match dur_cols.as_slice() {
        [] => return None,
        [one] => (*one).to_string(),
        many => format!("COALESCE({})", many.join(", ")),
    };
    // Wire aliases, optional-column gating: same reasoning as
    // `build_dbm_server_queries_sql`.
    let opt = |col: &str, alias: &str| -> String {
        if present.contains(col) {
            format!("{col} AS {alias}")
        } else {
            format!("NULL AS {alias}")
        }
    };
    let cols = [
        "_timestamp".to_string(),
        // Which producer captured the row — the read side maps it to the
        // per-hit `source` field, so a mixed window cannot mislabel a hit.
        opt(server_vantage::O2_DBM_KIND, "kind"),
        opt(server_vantage::O2_DBM_FINGERPRINT, "fingerprint"),
        opt(server_vantage::O2_DBM_ACTIVITY_QUERY, "query"),
        format!("{dur} AS duration_ms"),
        // Present only when `auto_explain.log_analyze` was on — absent stays
        // absent rather than becoming a confident zero.
        opt(server_vantage::O2_DBM_PLAN_ROWS_ACTUAL, "rows_actual"),
        opt(server_vantage::O2_DBM_ENGINE, "db_system"),
        opt(server_vantage::O2_DBM_DATABASE, "db_namespace"),
        opt(server_vantage::O2_DBM_INSTANCE, "db_instance"),
        // The session user from the statement-log prefix; auto_explain rows
        // never carry one.
        opt(server_vantage::O2_DBM_SESSION_USER, "db_user"),
        // Identity for the producer-twin dedupe (`dedupe_producer_twins`),
        // never surfaced in the envelope: both producers' lines carry the
        // same log prefix, so the pid travels on both.
        opt(server_vantage::O2_DBM_SESSION_PID, "session_pid"),
    ]
    .join(", ");
    Some(format!(
        "SELECT {cols} FROM \"{stream}\"\nWHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    \
         AND {kind} IN ('{kind_stmt}', '{kind_explain}')\n    AND {dur} IS NOT NULL{preds}\n\
         ORDER BY duration_ms DESC\nLIMIT {limit}",
        stream = escape_ident(stream_name),
        kind = server_vantage::O2_DBM_KIND,
        kind_stmt = escape_sq(server_vantage::KIND_STATEMENT),
        kind_explain = escape_sq(server_vantage::KIND_EXPLAIN),
    ))
}

/// Per-hit provenance for the server-samples envelope: which producer
/// captured the execution. `KIND_STATEMENT` rows are statement-log lines;
/// `KIND_EXPLAIN` rows are auto_explain documents. Absent/unknown kinds
/// default to the WEAKER claim (`statement_log` — duration only, no plan),
/// mirroring how `plan_source` treats absent as generic.
fn sample_source_of(kind: Option<&str>) -> &'static str {
    match kind {
        Some(server_vantage::KIND_EXPLAIN) => "auto_explain",
        _ => "statement_log",
    }
}

/// Drop auto_explain rows that describe an execution the statement log
/// already reported.
///
/// With both producers wide open (statement logging AND auto_explain), one
/// completed statement writes TWO log lines — a `duration:` line and a plan
/// document — and both canonicalize into per-execution rows. Left merged,
/// every slow call lists twice: once with the session user, once without
/// (verified live: twin rows share the exact prefix timestamp, durations
/// ~1 ms apart because the statement duration includes parse/plan time).
///
/// Identity is (completion timestamp, fingerprint) — the log prefix stamps
/// the same millisecond on both lines. The pid CANNOT anchor the identity:
/// verified live, plan documents carry no `o2_dbm_session_pid` (only the
/// statement line's prefix is pid-parsed), so it refines the match only when
/// the explain row actually has one. The rules are asymmetric on purpose:
///  • a STATEMENT row is never dropped — it carries the user and the full
///    statement duration;
///  • an EXPLAIN row is dropped only when a statement row claims its
///    identity (and, when the explain row carries a pid, the same pid) — a
///    deployment that captures only auto_explain (thresholds differ per
///    knob) keeps every row;
///  • two rows of the SAME kind sharing an identity are both kept: two
///    sessions can complete the same statement inside a millisecond, and
///    collapsing them would undercount real work. N statement rows absorb
///    all their explain twins and the count stays N — the executions.
///
/// Known edge, accepted: same statement, same millisecond, one execution
/// above the statement-log threshold and one below it — the below-threshold
/// explain row is absorbed by the other's statement row. Requires two
/// same-shape completions in one millisecond straddling the threshold.
pub(crate) fn dedupe_producer_twins(rows: &mut Vec<Value>) {
    let base =
        |r: &Value| -> (i64, String) { (get_i64(r, "_timestamp"), get_str(r, "fingerprint")) };
    let mut statement_pids: HashMap<(i64, String), HashSet<i64>> = HashMap::new();
    for r in rows.iter() {
        if r.get("kind").and_then(Value::as_str) != Some(server_vantage::KIND_EXPLAIN) {
            statement_pids
                .entry(base(r))
                .or_default()
                .insert(get_i64(r, "session_pid"));
        }
    }
    rows.retain(|r| {
        if r.get("kind").and_then(Value::as_str) != Some(server_vantage::KIND_EXPLAIN) {
            return true;
        }
        match statement_pids.get(&base(r)) {
            None => true,
            Some(pids) => {
                let pid = get_i64(r, "session_pid");
                // No pid on the explain row (the normal case): any statement
                // twin absorbs it. A pid present must actually match.
                pid != 0 && !pids.contains(&pid)
            }
        }
    });
}

/// The server-samples response envelope — callable, like its siblings, so the
/// honesty keys are tested for real.
pub(crate) fn server_samples_envelope(
    rows: &[Value],
    stream: &str,
    capture: &str,
    limit: usize,
) -> Value {
    let hits: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "timestamp": get_i64(r, "_timestamp"),
                "fingerprint": str_or_null(r, "fingerprint"),
                "query": str_or_null(r, "query"),
                "duration_ms": r.get("duration_ms").and_then(as_f64_loose),
                "rows_actual": r.get("rows_actual").and_then(server_vantage::as_i64_loose),
                "db_system": str_or_null(r, "db_system"),
                "db_namespace": str_or_null(r, "db_namespace"),
                "db_instance": str_or_null(r, "db_instance"),
                "db_user": str_or_null(r, "db_user"),
                "source": sample_source_of(r.get("kind").and_then(Value::as_str)),
            })
        })
        .collect();
    json!({
        "hits": hits,
        "total": hits.len(),
        "truncated": rows.len() >= limit,
        "stream": stream,
        "server_samples_capture": capture,
        // The capture is threshold-filtered (log_min_duration_statement /
        // auto_explain.log_min_duration / sample_rate), so these rows describe
        // the CAPTURED population — the UI must not present them as every
        // execution.
        "threshold_filtered": true,
    })
}

#[derive(Debug, Deserialize)]
pub struct ServerSamplesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub stream: Option<String>,
    pub system: Option<String>,
    pub instance: Option<String>,
    /// See [`DeadlocksQuery::database`].
    pub database: Option<String>,
    pub namespace: Option<String>,
    pub limit: Option<usize>,
}

/// GET /{org_id}/traces/db_monitoring/server_samples — the slowest executions
/// the DATABASE ITSELF captured, for deployments with no traced traffic.
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/server_samples",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringServerSamples",
    summary = "Database Monitoring: slowest executions captured by the database's own logging",
    description = "Single executions with their measured in-engine durations — from log_min_duration_statement completed-statement lines and Postgres auto_explain records — ranked slowest first. A threshold-filtered capture: rows describe only the executions the database chose to log.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream; when absent BOTH defaults ('dbm_server' and 'dbm_server_logs') are read and merged"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("database" = Option<String>, Query, description = "Database name filter (alias: namespace)"),
        ("limit" = Option<usize>, Query, description = "Max executions returned (default 100, cap 500)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_server_samples(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<ServerSamplesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_server_samples_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// The server-samples endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`]. [`get_dbm_badges`] runs it as the zero-trace
/// fallback slice, keeping the two-stream merge and the producer-twin dedupe.
async fn read_server_samples_body(
    org_id: &str,
    user_id: &str,
    q: &ServerSamplesQuery,
) -> Result<Value, HttpResponse> {
    // An explicit stream means that one stream. NO stream means both default
    // streams: the two per-execution producers land on different ones by
    // design (statement lines on the raw-log sibling, auto_explain on the
    // events stream — see the module note), and defaulting to either alone
    // would silently lose the other producer's rows.
    let candidates: Vec<&str> = match q.stream.as_deref().filter(|s| !s.is_empty()) {
        Some(s) => vec![s],
        None => vec![DEFAULT_SERVER_STREAM, DEFAULT_SERVER_LOGS_STREAM],
    };
    // Permission before range parsing; Logs, not Traces — see
    // `get_dbm_server_queries`. On the default pair a stream the caller
    // cannot read is DROPPED rather than failing the whole read — per-stream
    // RBAC means the answer is what the caller may see — and only a caller
    // who may see nothing gets the 403.
    let mut streams: Vec<&str> = Vec::with_capacity(candidates.len());
    for s in candidates {
        if can_read_stream(org_id, user_id, s, required_stream_for(DbmVantage::Server)).await {
            streams.push(s);
        }
    }
    if streams.is_empty() {
        return Err(unauthorized_response());
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_SAMPLES_LIMIT)
        .clamp(1, MAX_SAMPLES_LIMIT);
    let preds = dbm_event_preds(q.system.as_deref(), q.instance.as_deref(), q.database());

    // The two default streams are processed CONCURRENTLY (schema read, then
    // ranked search, per stream); results are folded in stream order so the
    // first failing stream's error is the one reported, as the serial loop
    // did.
    let preds = preds.as_str();
    let per_stream = join_all(streams.iter().map(|stream| async move {
        // Reported, never absorbed — see `present_dbm_columns`.
        let present = match present_dbm_columns(org_id, stream).await {
            Ok(present) => present,
            Err(e) => {
                log::error!(
                    "[DbMonitoring] server samples schema read failed for {org_id}/{stream}: {e}"
                );
                return Err(MetaHttpResponse::internal_error(e));
            }
        };
        let capture_on = server_samples_capture_state(&present) == "on";
        // A stream that never captured contributes nothing — not an error.
        let stream_rows = match build_dbm_server_samples_sql(
            stream, start_time, end_time, preds, limit, &present,
        ) {
            Some(sql) => match run_events_search(org_id, stream, sql, start_time, end_time).await {
                Ok(stream_rows) => stream_rows,
                Err(e) => {
                    log::error!(
                        "[DbMonitoring] server samples read failed for {org_id}/{stream}: {e}"
                    );
                    return Err(MetaHttpResponse::internal_error(e));
                }
            },
            None => Vec::new(),
        };
        Ok((capture_on, stream_rows))
    }))
    .await;

    let mut rows: Vec<Value> = Vec::new();
    let mut any_truncated = false;
    let mut capture = "off";
    for result in per_stream {
        let (capture_on, stream_rows) = result?;
        if capture_on {
            capture = "on";
        }
        any_truncated |= stream_rows.len() >= limit;
        rows.extend(stream_rows);
    }

    // Merge to ONE ranked list: each stream returned its own top-N, so the
    // union re-sorts by duration and re-cuts. `truncated` is true when the
    // merge cut rows OR any single stream's read hit its limit — either way
    // more qualifying executions existed than were returned.
    rows.sort_by(|a, b| {
        let da = a.get("duration_ms").and_then(as_f64_loose).unwrap_or(0.0);
        let db = b.get("duration_ms").and_then(as_f64_loose).unwrap_or(0.0);
        db.partial_cmp(&da).unwrap_or(std::cmp::Ordering::Equal)
    });
    // One execution, one row — the two producers each logged it.
    dedupe_producer_twins(&mut rows);
    let truncated = any_truncated || rows.len() > limit;
    rows.truncate(limit);

    let envelope_stream = streams.join(",");
    let mut envelope = server_samples_envelope(&rows, &envelope_stream, capture, limit);
    // The per-stream cut may already have hidden rows even when the merged
    // list is short — restate truncation over the whole read.
    if let Some(obj) = envelope.as_object_mut() {
        obj.insert("truncated".to_string(), json!(truncated));
    }
    Ok(envelope)
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
///
/// SUPERSEDED by [`get_dbm_query_insights`], which returns this exact envelope
/// as its `plans` section alongside the server counters the detail page always
/// requested in the same breath. Kept registered and unchanged for
/// compatibility; new callers should use `/query/insights`.
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
    match read_plans_body(&org_id, &user_email.user_id, &q, None).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// The plans endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`], so [`get_dbm_query_insights`] emits a section
/// byte-identical to the standalone response rather than a re-derivation of it.
///
/// `prologue` shares the `(stream, schema)` pair with the sibling section when
/// both read the SAME default stream; `None` computes its own, exactly as the
/// standalone handler does.
async fn read_plans_body(
    org_id: &str,
    user_id: &str,
    q: &PlansQuery,
    prologue: Option<&DbmServerPrologue>,
) -> Result<Value, HttpResponse> {
    let cfg = get_config();
    let Some(fingerprint) = q.fingerprint.as_deref().filter(|f| !f.is_empty()) else {
        return Err(MetaHttpResponse::bad_request("fingerprint is required"));
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
    // The shared prologue only applies when this section reads the very stream
    // it was computed for — an explicit `?stream=` must get its own auth and
    // schema, never the default stream's.
    let shared = prologue.filter(|p| p.stream == stream);
    if shared.is_none() {
        // Same rule as `get_dbm_query_server_metrics`: Logs-stream auth (never
        // the endpoints handler's Traces, the wrong OFGA object), checked
        // BEFORE range parsing so stream existence cannot be probed.
        if !can_read_stream(
            org_id,
            user_id,
            stream,
            required_stream_for(DbmVantage::Server),
        )
        .await
        {
            return Err(unauthorized_response());
        }
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }

    // Same rule as `read_deadlocks_body`: a failed schema read is reported,
    // never absorbed into an empty set. See `present_dbm_columns`.
    let present = match shared {
        Some(p) => p.present.clone(),
        None => match present_dbm_columns(org_id, stream).await {
            Ok(present) => present,
            Err(e) => {
                log::error!("[DbMonitoring] plans schema read failed for {org_id}/{stream}: {e}");
                return Err(MetaHttpResponse::internal_error(e));
            }
        },
    };

    let rows = match build_dbm_plans_sql(stream, fingerprint, start_time, end_time, "", &present) {
        Some(sql) => match run_events_search(org_id, stream, sql, start_time, end_time).await {
            Ok(rows) => rows,
            Err(e) => {
                log::error!("[DbMonitoring] plans read failed for {org_id}/{stream}: {e}");
                return Err(MetaHttpResponse::internal_error(e));
            }
        },
        // The stream has never carried plans — an empty section, not an error.
        None => Vec::new(),
    };

    let hits: Vec<Value> = rows.iter().map(plan_row_to_dto).collect();

    Ok(plans_envelope(
        &hits,
        stream,
        plan_capture_state(&present),
        cfg.db_monitoring.explain_enabled,
    ))
}

// ─── The query-detail Logs-side pair (`/query/insights`) ─────────────────────

#[derive(Debug, Deserialize)]
pub struct QueryInsightsQuery {
    pub fingerprint: Option<String>,
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    /// The server-metrics join key. Absent (or, for a database-carrying engine,
    /// an absent `database`) means there IS no key — the section comes back
    /// `null` and the page renders its "no join key" line, exactly as it did
    /// when it decided not to send the second request at all.
    pub engine: Option<String>,
    pub database: Option<String>,
}

/// GET /{org_id}/traces/db_monitoring/query/insights — the query-detail page's
/// Logs-side pair in one round trip.
///
/// `/query/plans` and `/query/server_metrics` were ALWAYS co-fired from the
/// detail page: both default to `dbm_server`, both run the same
/// `present_dbm_columns` schema read, both query `KIND_TOP_QUERY` records for
/// the same fingerprint and window. That is two OFGA round trips, two schema
/// reads and two HTTP round trips to answer one question about one statement.
///
/// The two sections are the SAME envelopes the standalone endpoints return —
/// produced by the same `read_*_body` callables, so a section here and the
/// endpoint it came from cannot drift. Both standalone routes keep working
/// (they are marked superseded, not removed).
///
/// Per-section failure, never a whole-request failure: this page is about the
/// query, and a server-counters read that failed must not take the plans list
/// down with it. Each section carries its own `*_read_failed` flag rather than
/// letting an empty section imply "nothing captured".
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/query/insights",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringQueryInsights",
    summary = "Database Monitoring: plans + server counters for a query",
    description = "The query-detail page's server-vantage pair in one response: `plans` (the /query/plans envelope) and `server_metrics` (the /query/server_metrics envelope), each nullable with its own read-failed flag.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fingerprint" = String, Query, description = "Query fingerprint (required)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (defaults to dbm_server)"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("engine" = Option<String>, Query, description = "Server-metrics join key: database engine. Omit and `server_metrics` is null."),
        ("database" = Option<String>, Query, description = "Server-metrics join key: database name. Required for engines whose records carry one."),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Missing fingerprint", content_type = "application/json", body = ()),
    )
)]
pub async fn get_dbm_query_insights(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<QueryInsightsQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let org = org_id.as_str();
    let user = user_email.user_id.as_str();
    // Validated ONCE, up front: a missing fingerprint is a malformed request
    // for both sections, so it stays a 400 rather than becoming two nulls the
    // page would render as "nothing captured".
    if q.fingerprint.as_deref().filter(|f| !f.is_empty()).is_none() {
        return MetaHttpResponse::bad_request("fingerprint is required");
    }

    let plans_q = PlansQuery {
        fingerprint: q.fingerprint.clone(),
        stream: q.stream.clone(),
        start_time: q.start_time,
        end_time: q.end_time,
    };
    let metrics_q = ServerMetricsQuery {
        fingerprint: q.fingerprint.clone(),
        engine: q.engine.clone(),
        database: q.database.clone(),
        stream: q.stream.clone(),
        start_time: q.start_time,
        end_time: q.end_time,
    };

    // One (auth, schema) prologue for both sections — the same sharing the
    // badges fan-out does, and for the same reason: they read the SAME default
    // stream. `None` merely declines to share; each section then computes its
    // own and owns its own denial/error, byte-identically to the standalone
    // endpoints. An explicit `?stream=` is not the prologue's stream, so
    // `read_*_body` ignores the share and re-authorizes.
    let prologue = server_prologue(org, user).await;
    let prologue = prologue.as_ref();

    // No join key, no request — the same decision the page used to make in the
    // browser.
    let wants_metrics = has_server_metrics_join_key(q.engine.as_deref(), q.database.as_deref());

    let (plans, server_metrics) =
        tokio::join!(read_plans_body(org, user, &plans_q, prologue), async {
            if !wants_metrics {
                return None;
            }
            Some(read_server_metrics_body(org, user, &metrics_q, prologue).await)
        },);

    // A denial on BOTH sections is a denial of the request: returning 200 with
    // two nulls would let the page render "nothing captured" over a permission
    // problem. One section failing is a section flag — the other still answers.
    let plans_forbidden = plans.as_ref().err().is_some_and(is_forbidden);
    let metrics_forbidden = server_metrics
        .as_ref()
        .and_then(|r| r.as_ref().err())
        .is_some_and(is_forbidden);
    if plans_forbidden && (metrics_forbidden || !wants_metrics) {
        return unauthorized_response();
    }

    let (plans_section, plans_read_failed) = match plans {
        Ok(body) => (body, false),
        Err(_) => (Value::Null, true),
    };
    let (metrics_section, metrics_read_failed) = match server_metrics {
        // Not asked for: `null` with the flag FALSE. "We did not look" and "we
        // looked and could not read" are different sentences, and the page
        // renders different copy for each.
        None => (Value::Null, false),
        Some(Ok(body)) => (body, false),
        Some(Err(_)) => (Value::Null, true),
    };

    MetaHttpResponse::json(json!({
        "plans": plans_section,
        "plans_read_failed": plans_read_failed,
        "server_metrics": metrics_section,
        "server_metrics_read_failed": metrics_read_failed,
    }))
}

/// Whether a ready `HttpResponse` this module produced is the 403 the stream
/// gate returns. Used to distinguish "may not read" from "read failed" when
/// folding sections — the two must not collapse into one flag.
fn is_forbidden(resp: &HttpResponse) -> bool {
    resp.status() == axum::http::StatusCode::FORBIDDEN
}

/// Whether the server-counters join key is complete enough to ask at all.
///
/// The key is (engine, database, fingerprint) — WHERE THE ENGINE'S RECORDS
/// CARRY A DATABASE. mysql/mariadb top_query records carry no database field
/// (receiver contract, verified live), so for them (engine, fingerprint) is the
/// whole key and a missing database is no obstacle. For every other engine an
/// absent database cannot be defaulted: an empty predicate matches every
/// database and attributes the wrong one's counters.
///
/// Pure, and shared with [`read_server_metrics_body`]'s own validation, so the
/// merged endpoint's decision to SKIP the section and the standalone endpoint's
/// decision to 400 cannot drift apart into "asked and got a 400" — the case
/// that would surface to the reader as a failed section rather than a missing
/// join key.
pub(crate) fn has_server_metrics_join_key(engine: Option<&str>, database: Option<&str>) -> bool {
    let Some(engine) = engine.filter(|e| !e.is_empty()) else {
        return false;
    };
    let database_less_engine = matches!(engine.to_ascii_lowercase().as_str(), "mysql" | "mariadb");
    database_less_engine || database.is_some_and(|d| !d.is_empty())
}

/// The plans response envelope — pure shape assembly (no I/O), same
/// extraction rationale as [`server_metrics_envelope`]: the D-H honesty flags
/// are asserted on real JSON instead of scraped out of the handler's source
/// text.
pub(crate) fn plans_envelope(
    hits: &[Value],
    stream: &str,
    plan_capture: &str,
    explain_enabled: bool,
) -> Value {
    json!({
        "hits": hits,
        "stream": stream,
        // The honesty contract, stated by the API so the UI cannot mislabel
        // it — now DERIVED, because two producers exist: `generic_null_bound`
        // when every hit is the receiver's never-executed NULL-bound estimate,
        // `auto_explain` when every hit is a real executed plan, `mixed` when
        // the window holds both. The per-hit `plan_source` is authoritative;
        // this summary exists for the response-level consumers that predate it.
        "plan_source": derived_plan_source(hits),
        // Which of the TWO causes of an empty `hits` this is. `off` means the
        // stream never carried a plan hash column, so nothing ever looked and
        // the collector hint is the right advice. `on` means capture ran and
        // this statement simply has no plan — Postgres cannot EXPLAIN a
        // COMMIT, ROLLBACK or SHOW. Without this the UI can only render one
        // sentence for both and tells a DBA whose capture is already running
        // to go switch it on.
        "plan_capture": plan_capture,
        // Whether auto_explain ingest is switched on (W-E3). With capture on,
        // hits empty AND this true, the UI can render the third empty state —
        // "capture is running; no execution of this query was slow enough" —
        // which is good news and must not be blamed on config.
        "explain_enabled": explain_enabled,
        // More than one distinct plan in the window. Named `drift_detected`
        // rather than `plan_changed` deliberately: this detects STRUCTURAL DRIFT
        // in the generic plan, and its absence is NOT evidence that no plan
        // regression occurred — the custom plan Postgres actually ran is not
        // observed here at all.
        "drift_detected": hits.len() > 1,
        "total": hits.len(),
    })
}

// ─── W10 · Table health read API ─────────────────────────────────────────────
//
// One row per RELATION, from the table-stats recipes (`pg_table_stats` /
// `mysql_table_stats` / `mariadb_table_stats` — one shared shape). See
// `server_vantage::KIND_TABLE_STATS` for what this data is; the two properties
// that bind this module are that the scan/vacuum counters are LIFETIME totals
// and the tuple counts are PLANNER ESTIMATES, both re-stated on the response
// envelope so the UI cannot mislabel what it renders.

/// Which engines this signal is collected for.
///
/// Postgres (`pg_table_stats` over `pg_class`/`pg_stat_user_tables`), MySQL
/// (`mysql_table_stats` over `information_schema.TABLES` +
/// `mysql.innodb_table_stats`) and MariaDB (`mariadb_table_stats`, the same
/// catalogs) all ship recipes. SQL Server exposes schema statistics through
/// `sys.dm_db_partition_stats`, which no shipped recipe reads yet.
///
/// This exists so the UI can distinguish "no tables have problems" from "this
/// signal was never collected for your engine". Rendering an empty table for an
/// unsupported engine's user is the single most dangerous empty state the
/// feature can produce: it reads as an all-clear about a check that never ran.
///
/// `""` (no engine filter) answers `unknown` rather than guessing: an unfiltered
/// request spans every engine in the fleet, so no single verdict is true of it.
#[cfg(feature = "enterprise")]
pub(crate) fn table_health_engine_support(engine: &str) -> &'static str {
    match engine {
        "postgresql" | "mysql" | "mariadb" => "supported",
        "" => "unknown",
        // Named negatively rather than by an allowlist of the engines we know:
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
#[cfg(feature = "enterprise")]
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

// ─── W11 · Index health read API ─────────────────────────────────────────────
//
// One row per INDEX, from the index-stats recipes (`pg_index_stats` /
// `mysql_index_stats` / `mariadb_index_stats`). The companion to table
// health, and the source of the never-scanned signal: `idx_scan = 0` on an
// index means the planner has not chosen it since the counters were last reset.
//
// The counters are LIFETIME totals exactly as the table ones are, and the
// envelope re-states it so the UI cannot render "never scanned" as a claim
// about the selected window.

/// Which engines this signal is collected for. Postgres (`pg_index_stats`),
/// MySQL (`mysql_index_stats`) and MariaDB (`mariadb_index_stats`) all ship
/// recipes — MariaDB's honestly omits the usage counter, but size and
/// definition still make its rows worth collecting. See
/// [`table_health_engine_support`] for why the empty filter answers `unknown`
/// rather than guessing.
#[cfg(feature = "enterprise")]
pub(crate) fn index_health_engine_support(engine: &str) -> &'static str {
    match engine {
        "postgresql" | "mysql" | "mariadb" => "supported",
        "" => "unknown",
        _ => "unsupported",
    }
}

/// The newest snapshot of every index in the window, largest first.
///
/// **Grouped by (schema, relation, index), not by relation.** Two indexes on one
/// table share a relation, so a relation-keyed GROUP BY would fold them together
/// and drop one from the list entirely.
///
/// **`MAX`, never `SUM`.** The recipe re-emits every index every 60 s, so an
/// hour's window holds ~60 snapshots each; summing reports an index 60x its real
/// size, and averaging a lifetime counter reports a number true at no instant.
///
/// Returns `None` when the stream's schema lacks the index column — naming an
/// absent column in a GROUP BY fails the whole query, and the common case is a
/// deployment that has not shipped this recipe.
#[cfg(feature = "enterprise")]
pub(crate) fn build_dbm_index_health_sql(
    stream_name: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
    limit: usize,
    present: &HashSet<String>,
) -> Option<String> {
    if !present.contains(server_vantage::O2_DBM_INDEX_NAME)
        || !present.contains(server_vantage::O2_DBM_SCHEMA)
        || !present.contains(server_vantage::O2_DBM_RELATION)
    {
        return None;
    }
    // Optional columns degrade a cell rather than failing the page.
    let mut cols = Vec::new();
    for (storage, wire) in [
        (server_vantage::O2_DBM_INDEX_BYTES, "index_bytes"),
        (server_vantage::O2_DBM_IDX_SCAN_COUNT, "idx_scan_count"),
        (server_vantage::O2_DBM_IDX_TUP_READ, "idx_tup_read"),
        (server_vantage::O2_DBM_IDX_TUP_FETCH, "idx_tup_fetch"),
        (server_vantage::O2_DBM_INSTANCE, "instance"),
        (server_vantage::O2_DBM_ENGINE, "engine"),
        // MAX over a boolean is the right fold: uniqueness is a property of the
        // index, identical across every snapshot in the window.
        (server_vantage::O2_DBM_INDEX_IS_UNIQUE, "is_unique"),
    ] {
        if present.contains(storage) {
            cols.push(format!("MAX({storage}) AS {wire}"));
        } else {
            cols.push(format!("NULL AS {wire}"));
        }
    }
    let projected = cols.join(", ");
    Some(format!(
        "SELECT {schema} AS schema_name, {relation} AS relation, \
         {index} AS index_name, {projected}, \
         MAX(_timestamp) AS last_seen FROM \"{stream}\"\n\
         WHERE _timestamp >= {start_time} AND _timestamp < {end_time}\n    \
         AND {kind} = '{kind_val}'{preds}\n\
         GROUP BY {schema}, {relation}, {index}\n\
         ORDER BY index_bytes DESC NULLS LAST\nLIMIT {limit}",
        schema = server_vantage::O2_DBM_SCHEMA,
        relation = server_vantage::O2_DBM_RELATION,
        index = server_vantage::O2_DBM_INDEX_NAME,
        stream = escape_ident(stream_name),
        kind = server_vantage::O2_DBM_KIND,
        kind_val = escape_sq(server_vantage::KIND_INDEX_STATS),
    ))
}

// ─── Wire-or-storage column readers (shared by the two health DTOs) ──────────
//
// Health rows arrive from two shapes: the SQL aggregates' wire aliases and, in
// tests, the canonicalizer's own storage names. Reading both keeps the
// writer/reader loop closeable — a DTO that only understood the aggregate
// could not be fed what ingest wrote, and a write/read name split would go
// unnoticed.

/// The column under its wire alias, falling back to its storage name.
#[cfg(feature = "enterprise")]
fn pick_col(row: &Value, wire: &str, storage: &str) -> Value {
    match row.get(wire) {
        Some(v) if !v.is_null() => v.clone(),
        _ => row.get(storage).cloned().unwrap_or(Value::Null),
    }
}

/// [`pick_col`] as an integer, or null.
#[cfg(feature = "enterprise")]
fn int_col(row: &Value, wire: &str, storage: &str) -> Value {
    match server_vantage::as_i64_loose(&pick_col(row, wire, storage)) {
        Some(n) => json!(n),
        None => Value::Null,
    }
}

/// [`pick_col`] as a non-empty string, or null.
#[cfg(feature = "enterprise")]
fn text_col(row: &Value, wire: &str, storage: &str) -> Value {
    match pick_col(row, wire, storage) {
        Value::String(s) if !s.is_empty() => json!(s),
        _ => Value::Null,
    }
}

/// One index's size and usage, in WIRE names (see the reader helpers above).
#[cfg(feature = "enterprise")]
fn index_health_row_to_dto(row: &Value) -> Value {
    let pick = |wire: &str, storage: &str| pick_col(row, wire, storage);
    let int = |wire: &str, storage: &str| int_col(row, wire, storage);
    let text = |wire: &str, storage: &str| text_col(row, wire, storage);
    json!({
        "index_name": text("index_name", server_vantage::O2_DBM_INDEX_NAME),
        "relation": text("relation", server_vantage::O2_DBM_RELATION),
        "schema": text("schema_name", server_vantage::O2_DBM_SCHEMA),
        "instance": text("instance", server_vantage::O2_DBM_INSTANCE),
        "engine": text("engine", server_vantage::O2_DBM_ENGINE),
        "index_bytes": int("index_bytes", server_vantage::O2_DBM_INDEX_BYTES),
        // LIFETIME totals — see `counters_are_cumulative` on the envelope. A
        // measured 0 is the never-scanned finding and must stay 0.
        "idx_scan_count": int("idx_scan_count", server_vantage::O2_DBM_IDX_SCAN_COUNT),
        "idx_tup_read": int("idx_tup_read", server_vantage::O2_DBM_IDX_TUP_READ),
        "idx_tup_fetch": int("idx_tup_fetch", server_vantage::O2_DBM_IDX_TUP_FETCH),
        // A CONSTRAINT index is not a drop candidate. `null` when the recipe
        // predates the column — unknown, which the rule treats as "cannot
        // exclude" rather than as "ordinary index".
        "is_unique": match pick("is_unique", server_vantage::O2_DBM_INDEX_IS_UNIQUE) {
            Value::Bool(b) => json!(b),
            Value::String(s) if s == "true" || s == "t" => json!(true),
            Value::String(s) if s == "false" || s == "f" => json!(false),
            _ => Value::Null,
        },
        "last_seen": int("last_seen", server_vantage::O2_DBM_TIMESTAMP),
    })
}

/// One relation's health, in WIRE names.
///
/// Storage names never reach the browser. Every counter carries its honesty
/// qualifier on the RESPONSE ENVELOPE rather than per-row: the flags are
/// properties of the feed, not of a table, and repeating them on every row
/// would invite a reader to assume a row without them is exact.
#[cfg(feature = "enterprise")]
fn table_health_row_to_dto(row: &Value) -> Value {
    let pick = |wire: &str, storage: &str| pick_col(row, wire, storage);
    let int = |wire: &str, storage: &str| int_col(row, wire, storage);
    let text = |wire: &str, storage: &str| text_col(row, wire, storage);
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

#[cfg(feature = "enterprise")]
#[derive(Debug, Deserialize)]
pub struct TableHealthQuery {
    pub stream: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub system: Option<String>,
    pub instance: Option<String>,
    pub limit: Option<usize>,
    /// Also return the index-health section (`index_hits` and its
    /// disclosures) in the same response. Off by default: the tab-count badge
    /// hits this endpoint purely to count tables, and making it pay for index
    /// rows it discards would tax six pages to spare one round trip on one.
    pub include_indexes: Option<bool>,
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
    description = "Newest snapshot per relation from the table-stats server-vantage feed (pg_table_stats / mysql_table_stats / mariadb_table_stats). Scan and vacuum counters are LIFETIME totals since the last statistics reset; tuple counts and bloat percentage are planner estimates. Postgres, MySQL and MariaDB.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("stream" = Option<String>, Query, description = "Server-vantage logs stream (default 'dbm_server')"),
        ("system" = Option<String>, Query, description = "Database engine filter"),
        ("instance" = Option<String>, Query, description = "Database instance filter"),
        ("limit" = Option<usize>, Query, description = "Max relations returned (default 100)"),
        ("include_indexes" = Option<bool>, Query, description = "Also return the index-health section (index_hits, disclosures) in the same response"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
#[cfg(feature = "enterprise")]
pub async fn get_dbm_table_health(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<TableHealthQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    match read_table_health_body(&org_id, &user_email.user_id, &q).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(resp) => resp,
    }
}

/// OSS stub — Table Health is an Enterprise capability.
///
/// The ROUTE stays registered (see `router/mod.rs`); only the body is gated.
/// Gating the route would answer 404, which reads as "this build is broken" or
/// "you have the wrong URL"; 403 is what tells the UI to render an upgrade
/// prompt. Deliberately NOT `disabled_response()`, which means
/// `ZO_DB_MONITORING_ENABLED=false` and would send the operator to a collector
/// checklist for a feature no amount of configuration will enable here.
///
/// The `Query<TableHealthQuery>` extractor is dropped because that type is
/// gated.
#[cfg(not(feature = "enterprise"))]
pub async fn get_dbm_table_health(
    Path(_org_id): Path<String>,
    _user_email: UserEmail,
) -> HttpResponse {
    unauthorized_response()
}

/// The table-health endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`], auth included.
#[cfg(feature = "enterprise")]
async fn read_table_health_body(
    org_id: &str,
    user_id: &str,
    q: &TableHealthQuery,
) -> Result<Value, HttpResponse> {
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    // Same rule as `get_dbm_query_server_metrics`: Logs-stream auth, checked
    // BEFORE range parsing so stream existence cannot be probed.
    if !can_read_stream(
        org_id,
        user_id,
        stream,
        required_stream_for(DbmVantage::Server),
    )
    .await
    {
        return Err(unauthorized_response());
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .clamp(1, MAX_EVENTS_LIMIT);
    // No `database` filter: this feed carries no database (see
    // `server_vantage::O2_DBM_SCHEMA`), so accepting one would silently return
    // nothing for every value a user could pass.
    let preds = dbm_event_preds(q.system.as_deref(), q.instance.as_deref(), None);

    // Same rule as `read_deadlocks_body`: a failed schema read is reported,
    // never absorbed into an empty set. See `present_dbm_columns`.
    let present = match present_dbm_columns(org_id, stream).await {
        Ok(present) => present,
        Err(e) => {
            log::error!(
                "[DbMonitoring] table health schema read failed for {org_id}/{stream}: {e}"
            );
            return Err(MetaHttpResponse::internal_error(e));
        }
    };

    // The two sections are two searches over the same stream, run CONCURRENTLY
    // when both are wanted — they used to be two endpoints, which the page
    // called sequentially and paid a full extra round trip for. The merge
    // keeps their one meaningful independence: tables are the page, so a table
    // failure is still a 500, while an index failure degrades to an empty
    // section — the rules that need no index data must keep rendering.
    let table_search = async {
        match build_dbm_table_health_sql(stream, start_time, end_time, &preds, limit, &present) {
            Some(sql) => run_events_search(org_id, stream, sql, start_time, end_time)
                .await
                .map(Some),
            // The stream has never carried table stats — an empty section, not
            // an error.
            None => Ok(None),
        }
    };
    let want_indexes = q.include_indexes.unwrap_or(false);
    let index_search = async {
        if !want_indexes {
            return Ok(None);
        }
        match build_dbm_index_health_sql(stream, start_time, end_time, &preds, limit, &present) {
            Some(sql) => run_events_search(org_id, stream, sql, start_time, end_time)
                .await
                .map(Some),
            None => Ok(None),
        }
    };
    let (table_rows, index_rows) = tokio::join!(table_search, index_search);

    let rows = match table_rows {
        Ok(rows) => rows.unwrap_or_default(),
        Err(e) => {
            log::error!("[DbMonitoring] table health read failed for {org_id}/{stream}: {e}");
            return Err(MetaHttpResponse::internal_error(e));
        }
    };
    let (index_hits, index_read_failed): (Vec<Value>, bool) = match index_rows {
        Ok(rows) => (
            rows.unwrap_or_default()
                .iter()
                .map(index_health_row_to_dto)
                .collect(),
            false,
        ),
        Err(e) => {
            log::error!("[DbMonitoring] index health read failed for {org_id}/{stream}: {e}");
            (Vec::new(), true)
        }
    };

    let hits: Vec<Value> = rows.iter().map(table_health_row_to_dto).collect();

    Ok(table_health_envelope(
        &hits,
        stream,
        q.system.as_deref().unwrap_or(""),
        want_indexes.then_some((index_hits.as_slice(), index_read_failed)),
    ))
}

/// The table-health response envelope — pure shape assembly (no I/O), same
/// extraction rationale as [`server_metrics_envelope`]: the
/// cumulative/estimated disclosures are asserted on real JSON instead of
/// scraped out of the handler's source text. `index_section` is
/// `(index_hits, index_read_failed)` when the caller asked for indexes.
#[cfg(feature = "enterprise")]
pub(crate) fn table_health_envelope(
    hits: &[Value],
    stream: &str,
    engine_filter: &str,
    index_section: Option<(&[Value], bool)>,
) -> Value {
    let mut body = json!({
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
        "engine_coverage": table_health_engine_support(engine_filter),
    });
    if let Some((index_hits, index_read_failed)) = index_section {
        let extra = body.as_object_mut().expect("body is an object");
        extra.insert("index_hits".into(), json!(index_hits));
        extra.insert("index_total".into(), json!(index_hits.len()));
        // Same disclosure as the table counters: `idx_scan` counts from the
        // last `pg_stat_reset()`, so "never scanned" is a lifetime claim.
        extra.insert("index_counters_are_cumulative".into(), json!(true));
        extra.insert(
            "index_engine_coverage".into(),
            json!(index_health_engine_support(engine_filter)),
        );
        // Stated, not implied by emptiness: an empty index list is the honest
        // answer on a fresh install, but "we could not read" must not wear
        // that costume — the unused-index rule stays silent instead of
        // declaring every index healthy.
        extra.insert("index_read_failed".into(), json!(index_read_failed));
    }
    body
}

// ─── Shared dbm_server prologue (badges fan-in) ──────────────────────────────

/// The `(stream, schema)` prologue the deadlocks / blocking / activity bodies
/// each compute for the shared server-vantage stream: read permission plus the
/// present-column set. Under the badges fan-in all three ask about the SAME
/// default stream, so the OFGA round trip and the schema read need not run
/// three times.
struct DbmServerPrologue {
    stream: String,
    present: HashSet<String>,
}

/// Compute the shared prologue for [`DEFAULT_SERVER_STREAM`], or `None` when
/// the caller may not read it or the schema read failed — each slice then runs
/// its own prologue and owns its own denial/error, byte-identically to the
/// standalone endpoints. `None` is deliberately NOT a verdict (see
/// [`present_dbm_columns`] on why a flattened schema error lies): it only
/// declines to share, never absorbs.
async fn server_prologue(org_id: &str, user_id: &str) -> Option<DbmServerPrologue> {
    if !can_read_stream(
        org_id,
        user_id,
        DEFAULT_SERVER_STREAM,
        required_stream_for(DbmVantage::Server),
    )
    .await
    {
        return None;
    }
    match present_dbm_columns(org_id, DEFAULT_SERVER_STREAM).await {
        Ok(present) => Some(DbmServerPrologue {
            stream: DEFAULT_SERVER_STREAM.to_string(),
            present,
        }),
        Err(_) => None,
    }
}

// ─── Badges (`/badges`) — the tab strip's one fan-in ─────────────────────────
//
// Every DBM route renders the SAME seven-tab strip, and the strip's badges
// describe the same org over the same window whichever tab is open. Filling
// them from the browser cost six endpoint reads per window — plus, in an org
// with no traced traffic, up to two more fallback reads — before the page's
// own table read. This endpoint runs those same reads server-side,
// CONCURRENTLY, and returns one envelope; a page then costs one badges call
// plus its own read.
//
// The members are the sibling endpoints' OWN bodies (`read_*_body`), not
// re-implemented counts: a badge computed by a second pipeline can disagree
// with the tab it labels, and agreement here is by construction. That also
// means each slice runs under exactly the auth its endpoint enforces — client
// slices under the trace-stream RBAC inside their window readers,
// server-vantage slices under the Logs-stream check — so a caller lacking one
// permission loses that member (null), never the whole response. Only a
// caller who may read NOTHING gets the 403.

#[derive(Debug, Deserialize)]
pub struct BadgesQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    /// Database system filter. Applied only to the slices whose browser
    /// fan-out applied it (databases, queries and the two server fallbacks) —
    /// the event slices took the bare window there, and this endpoint must
    /// answer the same questions the six reads answered.
    pub system: Option<String>,
}

/// The six slice outcomes plus the two conditionally-run fallbacks, ready to
/// fold. A struct rather than parameters so the envelope fold is a callable
/// the tests drive with real member fixtures.
pub(crate) struct BadgeSliceResults {
    pub databases: Result<Value, HttpResponse>,
    pub queries: Result<Value, HttpResponse>,
    pub activity: Result<Value, HttpResponse>,
    pub deadlocks: Result<Value, HttpResponse>,
    pub blocking: Result<Value, HttpResponse>,
    pub table_health: Result<Value, HttpResponse>,
    /// `None` when the fallback condition did not fire — the member is then
    /// ABSENT from the envelope, which is distinct from "fired and failed"
    /// (present as null). The reader must be able to tell "not needed" from
    /// "unknown".
    pub server_queries: Option<Result<Value, HttpResponse>>,
    pub server_samples: Option<Result<Value, HttpResponse>>,
}

impl BadgeSliceResults {
    /// Whether every slice was DENIED — the only case the whole request 403s.
    /// A mix of denials and other failures still answers with the members
    /// that could: each badge owns its own failure, exactly as the browser
    /// fan-out's `allSettled` did.
    pub(crate) fn all_forbidden(&self) -> bool {
        let forbidden = |r: &Result<Value, HttpResponse>| matches!(r, Err(resp) if resp.status() == axum::http::StatusCode::FORBIDDEN);
        let all =
            forbidden(&self.databases) && forbidden(&self.queries) && forbidden(&self.activity);
        // On OSS `deadlocks`, `blocking` and `table_health` are ALWAYS
        // `Err(403)` — they are Enterprise capabilities — so consulting them
        // here would make a whole-request 403 strictly EASIER to reach: a
        // caller who used to get a 200 with partial members (because the
        // deadlocks slice succeeded) would now get a blanket denial. Only
        // members that can actually succeed are consulted. A `let` rebinding
        // rather than `#[cfg]` on a `return`, which trips
        // `clippy::needless_return`.
        #[cfg(feature = "enterprise")]
        let all = all
            && forbidden(&self.deadlocks)
            && forbidden(&self.blocking)
            && forbidden(&self.table_health);
        all
    }

    /// Fold into the response envelope: each member is its endpoint's own
    /// body on success and `null` on any failure — mirroring the frontend's
    /// "null is a failed read, never 0" discipline, so a dead slice blanks
    /// its badges instead of claiming zero.
    pub(crate) fn into_envelope(self) -> Value {
        fn member(r: Result<Value, HttpResponse>) -> Value {
            r.unwrap_or(Value::Null)
        }
        let mut body = json!({
            "databases": member(self.databases),
            "queries": member(self.queries),
            "activity": member(self.activity),
            "deadlocks": member(self.deadlocks),
            "blocking": member(self.blocking),
            "table_health": member(self.table_health),
        });
        let extra = body.as_object_mut().expect("body is an object");
        if let Some(r) = self.server_queries {
            extra.insert("server_queries".into(), member(r));
        }
        if let Some(r) = self.server_samples {
            extra.insert("server_samples".into(), member(r));
        }
        body
    }
}

/// Whether the client-vantage queries slice answered EXACTLY zero distinct
/// statements — the condition that arms the `server_queries` fallback. A
/// failed slice (`Err`) must NOT arm it: unknown is not zero, and firing the
/// fallback there would put a database-reported claim on a badge whose client
/// answer may simply have blipped.
pub(crate) fn queries_slice_reports_zero(queries: &Result<Value, HttpResponse>) -> bool {
    match queries {
        Ok(body) => queries_body_reports_zero(body),
        Err(_) => false,
    }
}

/// The same rule on a body that already succeeded — what `/queries` itself
/// uses to arm `include_server_fallback`.
///
/// Shared with [`queries_slice_reports_zero`] deliberately: the badge and the
/// tab must fall back under the SAME condition, or the strip counts a
/// database-reported list the page did not render (or vice versa) and the
/// badges-agree-with-tabs invariant breaks at exactly the deployment this
/// fallback exists for.
pub(crate) fn queries_body_reports_zero(body: &Value) -> bool {
    // `total` is counted before the row cap, so it is the population — the
    // body always carries it.
    body.get("total").and_then(Value::as_i64) == Some(0)
}

/// Whether the client-vantage databases slice summed EXACTLY zero finished
/// calls — the condition that arms the `server_samples` fallback. Same
/// unknown-is-not-zero rule as [`queries_slice_reports_zero`]. The sum is the
/// same fold the tab strip performs over these rows (a row without `calls`
/// contributes 0), so the fallback fires exactly where the badge would have
/// read 0.
pub(crate) fn databases_slice_reports_zero_calls(databases: &Result<Value, HttpResponse>) -> bool {
    match databases {
        Ok(body) => match body.get("hits").and_then(Value::as_array) {
            Some(hits) => {
                hits.iter()
                    .map(|r| r.get("calls").and_then(as_f64_loose).unwrap_or(0.0))
                    .sum::<f64>()
                    == 0.0
            }
            // No rows array at all folds like an empty one — the same answer
            // the strip's own `hits ?? []` fold gives.
            None => true,
        },
        Err(_) => false,
    }
}

/// GET /{org_id}/traces/db_monitoring/badges — every tab badge in one read.
///
/// Runs the six sibling endpoints' bodies concurrently and — when the
/// client-vantage answer is exactly zero — the server-vantage fallbacks the
/// strip used to fetch itself, so the shell's per-window cost is this call
/// plus the page's own read. Each member is that endpoint's unchanged
/// response body, or `null` when its read failed.
#[utoipa::path(
    get,
    path = "/{org_id}/traces/db_monitoring/badges",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetDbMonitoringBadges",
    summary = "Database Monitoring: all tab badges in one read",
    description = "One envelope carrying the databases, queries, activity, deadlocks, blocking and table-health response bodies for the window, read concurrently; members are null when their read failed. When the client-vantage answer is exactly zero, the server-vantage fallback members (server_queries, server_samples) are included too.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_time" = Option<i64>, Query, description = "Start time (microseconds)"),
        ("end_time" = Option<i64>, Query, description = "End time (microseconds)"),
        ("system" = Option<String>, Query, description = "Database system filter (applied to the databases/queries slices and the server fallbacks)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn get_dbm_badges(
    Path(org_id): Path<String>,
    user_email: UserEmail,
    Query(q): Query<BadgesQuery>,
) -> HttpResponse {
    let cfg = get_config();
    if !cfg.db_monitoring.enabled {
        return disabled_response();
    }
    let org = org_id.as_str();
    let user = user_email.user_id.as_str();

    // Each slice's query is the EXACT request the tab strip's own fan-out
    // sent: window + system on databases, window + system + `limit=1` on
    // queries (the badge needs `total`, counted before the cap, and none of
    // the rows), and the bare window on the four event slices.
    let databases_q = DatabasesQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        stream: None,
        system: q.system.clone(),
        service: None,
        baseline_start_time: None,
        baseline_end_time: None,
        // A badge is a COUNT of rows; the per-instance split is a drill-down
        // nothing in the strip renders.
        include_breakdown: None,
    };
    let queries_q = QueriesQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        stream: None,
        system: q.system.clone(),
        instance: None,
        namespace: None,
        env: None,
        service: None,
        stmt_class: None,
        sort: None,
        limit: Some(1),
        search: None,
        baseline_start_time: None,
        baseline_end_time: None,
        // The strip runs its OWN fallback below, over both slices at once and
        // under the same arming rule (`queries_slice_reports_zero`). Setting
        // the flag here would run it twice.
        include_server_fallback: None,
        // A badge counts the window's statements, never one.
        fingerprint: None,
    };
    let activity_q = ActivityQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        stream: None,
        system: None,
        instance: None,
        database: None,
        namespace: None,
        limit: None,
    };
    // `DeadlocksQuery` / `BlockingQuery` / `TableHealthQuery` only exist on an
    // enterprise build, so their construction is gated together with the join
    // arm that consumes them. Task 5 does the full badges split; this is the
    // minimum that keeps OSS compiling now that the three types are
    // enterprise-only.
    #[cfg(feature = "enterprise")]
    let deadlocks_q = DeadlocksQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        stream: None,
        system: None,
        instance: None,
        database: None,
        namespace: None,
        search: None,
        limit: None,
    };
    #[cfg(feature = "enterprise")]
    let blocking_q = BlockingQuery {
        start_time: q.start_time,
        end_time: q.end_time,
        stream: None,
        system: None,
        instance: None,
        database: None,
        namespace: None,
        search: None,
        min_wait_seconds: None,
        limit: None,
    };
    #[cfg(feature = "enterprise")]
    let table_health_q = TableHealthQuery {
        stream: None,
        start_time: q.start_time,
        end_time: q.end_time,
        system: None,
        instance: None,
        limit: None,
        include_indexes: None,
    };

    // One (auth, schema) prologue for the three dbm_server slices — they all
    // read the same default stream, so the OFGA check and the schema read need
    // not run three times. `None` merely declines to share: each slice then
    // computes its own and owns its own denial/error, exactly as before.
    let prologue = server_prologue(org, user).await;
    let prologue = prologue.as_ref();

    #[cfg(feature = "enterprise")]
    let (databases, queries, activity, deadlocks, blocking, table_health) = tokio::join!(
        read_databases_body(org, user, &databases_q),
        read_queries_body(org, user, &queries_q),
        read_activity_body(org, user, &activity_q, true, prologue),
        read_deadlocks_body(org, user, &deadlocks_q, true, prologue),
        read_blocking_body(org, user, &blocking_q, true, prologue),
        read_table_health_body(org, user, &table_health_q),
    );
    // On OSS the three enterprise slices are refused without a read. The
    // envelope already maps `Err` to `null` per member, so their badges render
    // blank rather than as a misleading 0.
    #[cfg(not(feature = "enterprise"))]
    let (databases, queries, activity, deadlocks, blocking, table_health) = {
        let (databases, queries, activity) = tokio::join!(
            read_databases_body(org, user, &databases_q),
            read_queries_body(org, user, &queries_q),
            read_activity_body(org, user, &activity_q, true, prologue),
        );
        (
            databases,
            queries,
            activity,
            Err(unauthorized_response()),
            Err(unauthorized_response()),
            Err(unauthorized_response()),
        )
    };

    // ── The zero-trace fallback, folded server-side ──────────────────────
    //
    // A client-vantage zero is truthful about TRACES and false about the ORG
    // when the databases themselves are reporting: the Top-queries and
    // Slowest-calls tabs render database-reported lists there, and the strip
    // must count what those tabs show. Armed only by an EXACT zero — a null
    // (failed) slice must not fire it, because unknown is not zero.
    let wants_server_queries = queries_slice_reports_zero(&queries);
    let wants_server_samples = databases_slice_reports_zero_calls(&databases);
    let (server_queries, server_samples) = tokio::join!(
        async {
            if !wants_server_queries {
                return None;
            }
            let sq = ServerQueriesQuery {
                start_time: q.start_time,
                end_time: q.end_time,
                stream: None,
                system: q.system.clone(),
                instance: None,
                database: None,
                namespace: None,
                // The badges slice counts the window's statements — narrowing
                // it to one would make the badge report 1.
                fingerprint: None,
                limit: None,
            };
            Some(read_server_queries_body(org, user, &sq).await)
        },
        async {
            if !wants_server_samples {
                return None;
            }
            let ss = ServerSamplesQuery {
                start_time: q.start_time,
                end_time: q.end_time,
                stream: None,
                system: q.system.clone(),
                instance: None,
                database: None,
                namespace: None,
                limit: None,
            };
            Some(read_server_samples_body(org, user, &ss).await)
        },
    );

    let slices = BadgeSliceResults {
        databases,
        queries,
        activity,
        deadlocks,
        blocking,
        table_health,
        server_queries,
        server_samples,
    };
    if slices.all_forbidden() {
        return unauthorized_response();
    }
    MetaHttpResponse::json(slices.into_envelope())
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

    /// The raw-fallback opts for a stream whose queryable raw columns are
    /// exactly these. Members are checked against the shared vocabulary, so a
    /// test cannot invent a column the projection would never legitimately name.
    #[cfg(feature = "enterprise")]
    fn raw_cols(present: &[&str]) -> RawDeadlockFallback {
        for f in present {
            assert!(
                server_vantage::RAW_DEADLOCK_FIELDS.contains(f),
                "{f} is not a RAW_DEADLOCK_FIELDS member — the fixture is testing a \
                 column the gate could never return"
            );
        }
        RawDeadlockFallback {
            present: present.iter().map(|f| f.to_string()).collect(),
        }
    }

    /// Bundle the two projection halves the builder takes.
    fn proj<'a>(
        present: &'a HashSet<String>,
        raw: Option<&'a RawDeadlockFallback>,
    ) -> DbmProjection<'a> {
        DbmProjection { present, raw }
    }

    /// A stream schema with exactly these fields, for the presence gates.
    ///
    /// Types are irrelevant to the gates — they only ever ask whether a name
    /// resolves — so everything is a nullable Utf8. Nullable deliberately: the
    /// one column DataFusion cannot null-fill is a NON-nullable missing one, and
    /// nothing the projection may name is allowed to be that.
    #[cfg(feature = "enterprise")]
    fn schema_of(fields: &[&str]) -> arrow_schema::Schema {
        arrow_schema::Schema::new(
            fields
                .iter()
                .map(|f| arrow_schema::Field::new(*f, arrow_schema::DataType::Utf8, true))
                .collect::<Vec<_>>(),
        )
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

    // ── Enterprise gating of the three read endpoints ───────────────────────

    /// The three enterprise endpoints must refuse with 403 on OSS — NOT with
    /// [`disabled_response`], which means `ZO_DB_MONITORING_ENABLED=false` and
    /// would make the UI render a collector checklist (a configuration problem
    /// the operator could fix) instead of an upgrade prompt. And NOT 404: the
    /// routes stay registered precisely so the client can tell "you may not"
    /// from "no such thing".
    ///
    /// Asserted BEHAVIOURALLY by calling the handlers, not by scraping the
    /// source: `include_str!` ignores `cfg`, so a scrape would find the
    /// enterprise copy of `pub async fn get_dbm_deadlocks` first and assert
    /// against a body this build does not contain.
    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn enterprise_read_endpoints_are_forbidden_on_oss() {
        use axum::http::StatusCode;

        let org = || Path("default".to_string());
        let user = || UserEmail {
            user_id: "a@a.com".to_string(),
        };

        assert_eq!(
            get_dbm_deadlocks(org(), user()).await.status(),
            StatusCode::FORBIDDEN,
            "deadlocks must be 403 on OSS, not 404 and not disabled_response()'s 404"
        );
        assert_eq!(
            get_dbm_blocking(org(), user()).await.status(),
            StatusCode::FORBIDDEN,
            "blocked queries must be 403 on OSS"
        );
        assert_eq!(
            get_dbm_table_health(org(), user()).await.status(),
            StatusCode::FORBIDDEN,
            "table health must be 403 on OSS"
        );
    }

    /// The 403 must come from [`unauthorized_response`] and NOT from
    /// [`disabled_response`]. They are easy to confuse at the call site and the
    /// difference is invisible to a status-code assertion alone if
    /// `disabled_response` were ever changed — this pins the two apart, so a
    /// future edit that swaps one for the other fails here rather than
    /// silently sending OSS operators to a collector checklist.
    #[test]
    fn disabled_and_unauthorized_responses_are_distinct() {
        use axum::http::StatusCode;

        assert_eq!(unauthorized_response().status(), StatusCode::FORBIDDEN);
        assert_ne!(
            disabled_response().status(),
            StatusCode::FORBIDDEN,
            "disabled_response must not be a 403, or the OSS stubs' choice of \
             helper would stop mattering"
        );
    }

    /// **The vantage → OFGA-object mapping, asserted directly.**
    ///
    /// §5.1: the client vantage is application trace spans; the server vantage
    /// is the database's own records, which arrive as LOGS. Getting this
    /// backwards consults the wrong OFGA object and SILENTLY AUTHORIZES.
    ///
    /// This used to be five separate tests that GREPPED each handler's source
    /// for the literal `StreamType::Logs` near its `can_read_stream(` call —
    /// which is how they kept surviving refactors vacuously: when a check moved
    /// out of the function the grep was pointed at, the scrape found a
    /// different function's body (or a wrapper with no check in it) and either
    /// panicked on an unrelated message or passed on someone else's gate. The
    /// mapping is a pure function now, so the rule itself is a behavioural
    /// assertion, and `assert_gates_on_vantage` only has to prove each read
    /// NAMES its vantage — a much weaker thing to scrape, with a guard that
    /// fails loudly if the function it scraped is not the one it meant.
    #[test]
    fn test_required_stream_matches_the_vantage() {
        assert_eq!(
            required_stream_for(DbmVantage::Server),
            StreamType::Logs,
            "server-vantage records arrive as LOGS; Traces here checks the wrong \
             OFGA object and silently authorizes"
        );
        assert_eq!(
            required_stream_for(DbmVantage::Client),
            StreamType::Traces,
            "client-vantage reads are application trace spans"
        );
        assert_ne!(
            required_stream_for(DbmVantage::Client),
            required_stream_for(DbmVantage::Server),
            "the two vantages must never resolve to the same OFGA object — \
             collapsing them is the copy-paste hazard §5.1 names explicitly"
        );
    }

    /// Prove one read gates on the vantage it belongs to.
    ///
    /// Still a source assertion, because it cannot be a behavioural one:
    /// `can_read_stream` is unconditionally permissive on OSS (see
    /// `can_read_stream_is_permissive_on_oss`), so no OSS-observable response
    /// distinguishes a Logs check from a Traces one. What CHANGED is how much
    /// this has to scrape — the stream-type rule is asserted for real in
    /// `test_required_stream_matches_the_vantage`, leaving this to check only
    /// that the named function exists, contains a gate, and names the right
    /// vantage at it.
    ///
    /// The guards are the point: a moved or renamed function fails LOUDLY here
    /// (not found, or found but trivial) rather than silently scraping a
    /// neighbour and passing on its gate.
    fn assert_gates_on_vantage(fn_name: &str, vantage: DbmVantage) {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find(&format!("async fn {fn_name}"))
            .unwrap_or_else(|| panic!("{fn_name} must exist — a renamed fn must fail, not pass"));
        let body = code[start..]
            .split("\n}\n")
            .next()
            .unwrap_or_else(|| panic!("{fn_name} must have a body"));

        // Guard: the scrape found a REAL function body, not a stub or the tail
        // of a doc comment. Every read gated here parses a range and reads a
        // stream, so both landmarks must be present.
        assert!(
            body.len() > 300,
            "{fn_name}'s scraped body is {} bytes — too short to be the real \
             function; the scrape is pointing at the wrong place",
            body.len()
        );
        assert!(
            body.contains("resolve_range(") || body.contains("start_time"),
            "{fn_name}'s scraped body carries no window handling — the scrape \
             is pointing at the wrong function"
        );

        let call = body
            .find("can_read_stream(")
            .unwrap_or_else(|| panic!("{fn_name} must check read permission at all"));
        let args = &body[call..body.len().min(call + 200)];
        let expected = match vantage {
            DbmVantage::Server => "DbmVantage::Server",
            DbmVantage::Client => "DbmVantage::Client",
        };
        assert!(
            args.contains(expected),
            "{fn_name} reads from the {vantage:?} vantage, so its gate must name \
             {expected}; naming the other one checks the wrong OFGA object and \
             silently authorizes"
        );
        // And never the raw literal: a hand-written StreamType at a gate is the
        // copy-paste this mapping exists to prevent.
        assert!(
            !args.contains("StreamType::"),
            "{fn_name} must reach its stream type through required_stream_for, \
             never by writing StreamType:: at the gate"
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
    // unfiltered tail anyway), so no escaping question even arises. The read
    // builds its SQL through `build_stats_sql` from the scope filters ALONE:
    // there is no parameter a search term could even travel through, and the
    // source scrape pins the call site so one cannot be reintroduced.
    #[test]
    fn test_queries_search_text_never_in_sql() {
        let sql = build_stats_sql(
            "default",
            "query_stats",
            1,
            2,
            &ScopeFilters::default().sql_preds(),
        );
        assert!(!sql.contains("OR 1=1"));
        assert!(!sql.contains("UNION"));
        assert!(!sql.contains("password"));

        // The call site takes only the filters — `search` must not appear in
        // the statement that builds the queries SQL.
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let window_fn = code
            .find("async fn read_queries_window")
            .expect("the queries window fn must exist");
        let body = code[window_fn..].split("\n}\n").next().expect("body");
        let build = body
            .find("let qs_sql = build_stats_sql(")
            .expect("the queries read must build its SQL through build_stats_sql");
        let stmt = body[build..].split(';').next().expect("statement");
        assert!(
            !stmt.contains("search"),
            "user search text must never reach the queries SQL: {stmt}"
        );
    }

    #[test]
    fn test_fingerprint_pred_escaped() {
        let pred = fingerprint_pred("abc'; DELETE FROM t;--");
        assert_eq!(pred, "\n    AND fingerprint = 'abc''; DELETE FROM t;--'");
    }

    /// The raw-span twin, on the `o2_db_` column name spans actually carry.
    /// This predicate replaced a SQL string the BROWSER built with its own
    /// escaping helper — the escaping is here now, and tested here.
    #[test]
    fn test_span_fingerprint_pred_escaped() {
        let pred = span_fingerprint_pred("abc'; DROP TABLE t;--");
        assert_eq!(
            pred,
            "\n    AND o2_db_fingerprint = 'abc''; DROP TABLE t;--'"
        );
    }

    /// The per-query scope rides the SAME predicate string every other samples
    /// filter uses, so it lands inside the fixed-shape SQL rather than beside
    /// it — the whole reason the browser no longer needs to build one.
    #[test]
    fn test_samples_sql_carries_a_fingerprint_scope() {
        let preds = format!(
            "{}{}",
            ScopeFilters {
                system: Some("postgresql".into()),
                ..Default::default()
            }
            .span_sql_preds(),
            span_fingerprint_pred("deadbeef'x")
        );
        let sql = build_samples_sql("otel_demo", 100, 200, &preds, 50);
        assert!(sql.contains("AND o2_db_system = 'postgresql'"));
        assert!(sql.contains("AND o2_db_fingerprint = 'deadbeef''x'"));
        // Still the one fixed shape — the scope narrows the WHERE, it does not
        // rewrite the projection or the ordering.
        assert!(sql.contains("ORDER BY duration_ns DESC\nLIMIT 50"));
        assert!(sql.contains("FROM \"otel_demo\""));
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

    /// D5 join guard. A fingerprint hashes statement TEXT ONLY, so the caller
    /// aggregation MUST be able to carry the rest of the key — otherwise the
    /// services it returns belong to whichever engines happen to share the
    /// statement, and the server row they enrich belongs to exactly one.
    ///
    /// Live on org `default`, fp `69219a9c7fc5039d`: 125,195 postgres spans and
    /// 219,713 mysql spans under one fingerprint. Unscoped this endpoint
    /// returns their union as a single caller row.
    #[test]
    fn test_endpoints_sql_scopes_by_engine_and_database() {
        let scope = ScopeFilters {
            system: Some("postgresql".into()),
            namespace: Some("dbmlab".into()),
            ..Default::default()
        };
        let sql = build_endpoints_sql(
            "otel_demo",
            "69219a9c7fc5039d",
            100,
            200,
            &scope.span_sql_preds_for("dbspan."),
            50,
        );
        // Qualified, because the query self-joins the stream to itself: a bare
        // `o2_db_system` is ambiguous across `dbspan` and `root`.
        assert!(sql.contains("AND dbspan.o2_db_system = 'postgresql'"));
        assert!(sql.contains("AND dbspan.o2_db_namespace = 'dbmlab'"));
        assert!(
            !sql.contains("AND o2_db_system = "),
            "an unqualified column would be ambiguous in the self-join"
        );
        // The scope narrows the WHERE only — same projection, same grouping.
        assert!(sql.contains("GROUP BY root.service_name, root.operation_name"));
        assert!(sql.ends_with("LIMIT 50"));

        // mysql/mariadb `top_query` records carry no database, so the caller
        // drops it and the engine alone is the key. Still scoped — the fusion
        // this guards against is BETWEEN engines.
        let mysql = ScopeFilters {
            system: Some("mysql".into()),
            ..Default::default()
        };
        let sql = build_endpoints_sql(
            "otel_demo",
            "69219a9c7fc5039d",
            100,
            200,
            &mysql.span_sql_preds_for("dbspan."),
            50,
        );
        assert!(sql.contains("AND dbspan.o2_db_system = 'mysql'"));
        assert!(!sql.contains("o2_db_namespace"));

        // Values are escaped exactly as every other predicate in this module,
        // and the alias is a literal, so no user input can name a column.
        let hostile = ScopeFilters {
            system: Some("pg'; DROP TABLE t;--".into()),
            ..Default::default()
        };
        let sql = build_endpoints_sql(
            "otel_demo",
            "fp",
            1,
            2,
            &hostile.span_sql_preds_for("dbspan."),
            5,
        );
        assert!(sql.contains("dbspan.o2_db_system = 'pg''; DROP TABLE t;--'"));
    }

    #[test]
    fn test_endpoints_sql_shape_and_injection() {
        let sql = build_endpoints_sql("otel_demo", "deadbeef", 100, 200, "", 50);
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

        let sql = build_endpoints_sql("s\"x", "fp' OR '1'='1", 1, 2, "", 10);
        assert!(sql.contains("FROM \"s\"\"x\" AS dbspan"));
        assert!(sql.contains("o2_db_fingerprint = 'fp'' OR ''1''=''1'"));
    }

    #[test]
    fn test_escape_helpers() {
        assert_eq!(escape_sq("a'b''c"), "a''b''''c");
        assert_eq!(escape_sq("clean"), "clean");
        assert_eq!(escape_ident("a\"b"), "a\"\"b");
    }

    // ── FR-6 global samples ─────────────────────────────────────────────────

    #[test]
    fn test_samples_sql_shape_and_injection() {
        let sql = build_samples_sql("otel_demo", 100, 200, "", 100);
        // Raw-span read: per-span rows, ns duration from the span bounds (the
        // module's one duration unit — never the µs `duration` column),
        // DB-span predicate, slowest first, bounded.
        assert!(sql.contains("end_time - start_time AS duration_ns"));
        assert!(
            !sql.contains(" duration DESC"),
            "must not read the µs column"
        );
        assert!(sql.contains("FROM \"otel_demo\""));
        assert!(sql.contains("WHERE _timestamp >= 100 AND _timestamp < 200"));
        assert!(sql.contains("AND o2_db_fingerprint IS NOT NULL"));
        assert!(sql.contains("ORDER BY duration_ns DESC"));
        assert!(sql.ends_with("LIMIT 100"));
        // Everything the row needs downstream: trace pivot, detail pivot,
        // identity and status columns under their rollup-facing aliases.
        for col in [
            "trace_id",
            "o2_db_fingerprint AS fingerprint",
            "o2_db_query_norm AS query_norm",
            "o2_db_system AS db_system",
            "o2_db_instance AS db_instance",
            "o2_db_env AS env",
            "service_name",
            "span_status",
            "o2_db_status_code AS status_code",
        ] {
            assert!(sql.contains(col), "samples SQL must project {col}");
        }

        // Stream name is identifier-escaped so it cannot break out of the
        // double-quoted table position.
        let sql = build_samples_sql("s\" --", 1, 2, "", 10);
        assert!(sql.contains("FROM \"s\"\" --\""));
    }

    #[test]
    fn test_span_sql_preds_exact_and_whitelisted() {
        let f = ScopeFilters {
            system: Some("postgresql".into()),
            instance: Some("db-1".into()),
            namespace: Some("orders".into()),
            env: Some("prod".into()),
            service: Some("cart".into()),
            // `stream` is NOT a span column — it picks which streams are read,
            // so it must never appear as a predicate.
            stream: Some("otel_demo".into()),
        };
        assert_eq!(
            f.span_sql_preds(),
            "\n    AND o2_db_system = 'postgresql'\n    AND o2_db_instance = 'db-1'\n    AND o2_db_namespace = 'orders'\n    AND o2_db_env = 'prod'\n    AND service_name = 'cart'"
        );

        // Same injection contract as sql_preds: values are quote-escaped, and
        // user input can never name a column.
        let hostile = ScopeFilters {
            instance: Some("x'; DROP TABLE t;--".into()),
            ..Default::default()
        };
        let preds = hostile.span_sql_preds();
        assert!(preds.contains("o2_db_instance = 'x''; DROP TABLE t;--'"));
        assert!(!preds.contains("= 'x';"));
    }

    #[test]
    fn test_fold_sample_rows_global_order_and_stream_stamp() {
        let per_stream = vec![
            (
                "stream_a".to_string(),
                vec![
                    json!({"_timestamp": 10, "trace_id": "a1", "duration_ns": 900}),
                    json!({"_timestamp": 11, "trace_id": "a2", "duration_ns": 300}),
                ],
            ),
            (
                "stream_b".to_string(),
                vec![json!({"_timestamp": 12, "trace_id": "b1", "duration_ns": 500})],
            ),
        ];
        let (hits, truncated) = fold_sample_rows(per_stream, 10);
        // Global order by duration, across streams.
        assert_eq!(
            hits.iter()
                .map(|h| get_str(h, "trace_id"))
                .collect::<Vec<_>>(),
            vec!["a1", "b1", "a2"]
        );
        // Every row says which stream it came from — the trace pivot needs it.
        assert_eq!(get_str(&hits[0], "trace_stream_name"), "stream_a");
        assert_eq!(get_str(&hits[1], "trace_stream_name"), "stream_b");
        // 3 rows, cap 10, no stream cut: the answer is complete and says so.
        assert!(!truncated);
    }

    #[test]
    fn test_fold_sample_rows_truncates_and_discloses() {
        // Union outgrows the cap → cut to the cap, truncated.
        let per_stream = vec![
            (
                "a".to_string(),
                vec![
                    json!({"trace_id": "a1", "duration_ns": 900}),
                    json!({"trace_id": "a2", "duration_ns": 700}),
                ],
            ),
            (
                "b".to_string(),
                vec![json!({"trace_id": "b1", "duration_ns": 800})],
            ),
        ];
        let (hits, truncated) = fold_sample_rows(per_stream, 2);
        assert_eq!(hits.len(), 2);
        assert_eq!(get_str(&hits[0], "trace_id"), "a1");
        assert_eq!(get_str(&hits[1], "trace_id"), "b1");
        assert!(truncated, "a cut union must be disclosed");

        // A single stream answering EXACTLY its per-stream cap also discloses:
        // its own read was cut, so spans beyond the returned set exist even
        // though the union fits the cap.
        let per_stream = vec![(
            "a".to_string(),
            vec![
                json!({"trace_id": "a1", "duration_ns": 900}),
                json!({"trace_id": "a2", "duration_ns": 700}),
            ],
        )];
        let (hits, truncated) = fold_sample_rows(per_stream, 2);
        assert_eq!(hits.len(), 2);
        assert!(truncated, "a stream that hit its own cap must disclose it");

        // Deterministic tie-break: same duration orders by timestamp desc,
        // then trace id.
        let per_stream = vec![(
            "a".to_string(),
            vec![
                json!({"_timestamp": 1, "trace_id": "t2", "duration_ns": 500}),
                json!({"_timestamp": 2, "trace_id": "t1", "duration_ns": 500}),
            ],
        )];
        let (hits, _) = fold_sample_rows(per_stream, 10);
        assert_eq!(get_str(&hits[0], "trace_id"), "t1");
        assert_eq!(get_str(&hits[1], "trace_id"), "t2");
    }

    #[test]
    fn test_fold_sample_rows_empty() {
        let (hits, truncated) = fold_sample_rows(Vec::new(), 100);
        assert!(hits.is_empty());
        assert!(!truncated);
    }

    /// The explicit `?stream=` gate must run BEFORE any raw-span read — same
    /// invariant (and same source-order pinning, for the same OSS-permissive
    /// reason) as `test_history_checks_stream_permission_before_backfilling`.
    #[test]
    fn test_samples_checks_stream_permission_before_reading() {
        let src = include_str!("api.rs");
        let handler = src
            .split("pub async fn get_dbm_samples(")
            .nth(1)
            .expect("handler must exist")
            .split("\npub ")
            .next()
            .unwrap();

        let gate = handler
            .find("can_read_stream(")
            .expect("samples must gate an explicit stream param on can_read_stream");
        let read = handler
            .find("rollup::run_dbm_search(")
            .expect("samples must run the raw-span read");
        assert!(
            gate < read,
            "the permission gate must precede the raw-span read"
        );
        let range = handler
            .find("resolve_range(")
            .expect("samples must resolve a range");
        assert!(gate < range, "gate must also precede range parsing");
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

    // ── Errors-by-code fold (FR-5) ──────────────────────────────────────────

    // Counts sum across windows per status code; largest first; ties break by
    // code so the order is deterministic; an empty code lands in the rollup's
    // own `unknown` bucket rather than minting a second nameless one.
    #[test]
    fn test_fold_error_code_counts_sums_across_windows() {
        let rows = vec![
            json!({"status_code": "57014", "errors": 5}),
            json!({"status_code": "40P01", "errors": 2}),
            json!({"status_code": "57014", "errors": 7}),
            json!({"status_code": "", "errors": 3}),
            json!({"status_code": "23505", "errors": 3}),
        ];
        let out = fold_error_code_counts(&rows);
        assert_eq!(out.len(), 4);
        assert_eq!(out[0]["status_code"], "57014");
        assert_eq!(out[0]["errors"], 12);
        // 3-count tie: "23505" before "unknown" (code order, deterministic).
        assert_eq!(out[1]["status_code"], "23505");
        assert_eq!(out[1]["errors"], 3);
        assert_eq!(out[2]["status_code"], "unknown");
        assert_eq!(out[2]["errors"], 3);
        assert_eq!(out[3]["status_code"], "40P01");
        assert_eq!(out[3]["errors"], 2);
    }

    #[test]
    fn test_fold_error_code_counts_empty() {
        assert!(fold_error_code_counts(&[]).is_empty());
    }

    // ── Where-it-runs breakdown fold (FR-5) ─────────────────────────────────

    // Constituent rows group per (instance, namespace), additive metrics sum
    // across windows, and the output ranks by total time descending with a
    // deterministic (instance, namespace) tiebreak.
    #[test]
    fn test_fold_instance_breakdown_groups_and_sums() {
        let rows = [
            json!({"db_instance": "db1", "db_namespace": "orders", "calls": 10, "errors": 1, "total_time_ns": 500}),
            json!({"db_instance": "db1", "db_namespace": "orders", "calls": 5, "errors": 0, "total_time_ns": 300}),
            json!({"db_instance": "db2", "db_namespace": "orders", "calls": 100, "errors": 2, "total_time_ns": 900}),
            json!({"db_instance": "db1", "db_namespace": "users", "calls": 1, "errors": 0, "total_time_ns": 900}),
        ];
        let out = fold_instance_breakdown(rows.iter());
        assert_eq!(out.len(), 3);
        // 900-ns tie: db1 before db2 (instance order, deterministic).
        assert_eq!(out[0]["db_instance"], "db1");
        assert_eq!(out[0]["db_namespace"], "users");
        assert_eq!(out[1]["db_instance"], "db2");
        assert_eq!(out[1]["db_namespace"], "orders");
        assert_eq!(out[2]["db_instance"], "db1");
        assert_eq!(out[2]["db_namespace"], "orders");
        assert_eq!(out[2]["calls"], 15);
        assert_eq!(out[2]["errors"], 1);
        assert_eq!(out[2]["total_time_ns"], 800);
    }

    // `_o2_db_stats` mixes NULL and "" for an absent dimension — the fold must
    // coalesce the spellings or one instance splits into two rows.
    #[test]
    fn test_fold_instance_breakdown_coalesces_absent_dims() {
        let rows = [
            json!({"db_instance": "db1", "db_namespace": null, "calls": 3, "total_time_ns": 30}),
            json!({"db_instance": "db1", "db_namespace": "", "calls": 4, "total_time_ns": 40}),
            json!({"db_instance": "db1", "calls": 5, "total_time_ns": 50}),
        ];
        let out = fold_instance_breakdown(rows.iter());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["db_instance"], "db1");
        assert_eq!(out[0]["db_namespace"], "");
        assert_eq!(out[0]["calls"], 12);
        assert_eq!(out[0]["total_time_ns"], 120);
    }

    // Percentiles ride merge_rows' request weighting; a metric absent from
    // every constituent stays absent (never a fabricated 0).
    #[test]
    fn test_fold_instance_breakdown_weighted_percentiles_and_absence() {
        let rows = [
            json!({"db_instance": "db1", "db_namespace": "d", "calls": 1, "p95_ns": 100}),
            json!({"db_instance": "db1", "db_namespace": "d", "calls": 3, "p95_ns": 500}),
        ];
        let out = fold_instance_breakdown(rows.iter());
        assert_eq!(out.len(), 1);
        // (100·1 + 500·3) / 4 = 400.
        assert_eq!(out[0]["p95_ns"], 400);
        // No constituent carried errors — the key must not appear as 0.
        assert!(out[0].get("errors").is_none_or(|v| v.is_null()));
    }

    #[test]
    fn test_fold_instance_breakdown_empty() {
        assert!(fold_instance_breakdown(std::iter::empty::<&Value>()).is_empty());
    }

    // ── QPS stamping (FR-1) ─────────────────────────────────────────────────

    // calls / window_seconds, over the window the CALLER asked for. A row with
    // no calls metric stays unstamped: it never measured a count, so a 0/s
    // would be a fabricated exactness.
    #[test]
    fn test_stamp_qps_divides_by_window_seconds() {
        let mut hits = vec![
            json!({"db_instance": "db1", "calls": 900}),
            json!({"db_instance": "idle-replica"}),
            json!({"db_instance": "db2", "calls": 0}),
        ];
        // A 15-minute window in microseconds.
        stamp_qps(&mut hits, 0, 900 * 1_000_000);
        assert_eq!(hits[0]["qps"], 1.0);
        assert!(
            hits[1].get("qps").is_none(),
            "no calls metric must mean no qps claim"
        );
        assert_eq!(hits[2]["qps"], 0.0, "a measured zero IS a 0/s rate");

        // A degenerate window must not divide by zero or stamp anything.
        let mut degenerate = vec![json!({"calls": 10})];
        stamp_qps(&mut degenerate, 100, 100);
        assert!(degenerate[0].get("qps").is_none());
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

    // ── The zero-trace fallback, folded into the tab endpoints ─────────────

    /// The badge and the tab must arm the fallback under the SAME rule.
    ///
    /// The strip's counts are produced by the same assembly the pages render,
    /// so if `/queries` fell back where `/badges` did not (or the reverse) the
    /// tab would show a database-reported list under a badge reading 0 — at
    /// precisely the deployment this fallback exists for.
    #[test]
    fn test_queries_fallback_arms_on_the_same_rule_for_badge_and_tab() {
        let zero = json!({"hits": [], "other": [], "total": 0, "top_n_subset": false});
        let some = json!({"hits": [{}], "other": [], "total": 1, "top_n_subset": false});

        // The body-level rule, which `/queries` uses…
        assert!(queries_body_reports_zero(&zero));
        assert!(!queries_body_reports_zero(&some));
        // …is literally the rule the badge slice uses.
        assert!(queries_slice_reports_zero(&Ok(zero)));
        assert!(!queries_slice_reports_zero(&Ok(some)));

        // A FAILED slice must never arm it: unknown is not zero, and firing
        // there puts a database-reported claim over a client answer that
        // merely blipped.
        assert!(!queries_slice_reports_zero(&Err(
            MetaHttpResponse::internal_error("boom")
        )));
        // A body with no `total` at all is not a zero either.
        assert!(!queries_body_reports_zero(&json!({"hits": []})));
    }

    /// The fallback's three outcomes stay three, and a DENIAL is one of them.
    ///
    /// The fallback body reads a LOGS stream while the primary is Traces-auth,
    /// so a caller can be entitled to one and not the other. Collapsing that
    /// into a whole-request 403 would withhold the client-vantage rows the
    /// caller IS entitled to; collapsing it into "read failed" would tell them
    /// to retry something that will never succeed.
    #[test]
    fn test_server_fallback_section_keeps_denied_apart_from_failed() {
        let mut body = json!({"hits": [], "total": 0});
        stamp_server_fallback(&mut body, Ok(json!({"hits": [{"query": "SELECT 1"}]})));
        assert_eq!(body["server_fallback"]["hits"][0]["query"], "SELECT 1");
        assert_eq!(body["server_fallback_forbidden"], json!(false));
        assert_eq!(body["server_fallback_read_failed"], json!(false));

        let mut body = json!({"hits": [], "total": 0});
        stamp_server_fallback(&mut body, Err(unauthorized_response()));
        assert!(body["server_fallback"].is_null());
        assert_eq!(
            body["server_fallback_forbidden"],
            json!(true),
            "a denial must be stated as a denial, not as a failed read"
        );
        assert_eq!(body["server_fallback_read_failed"], json!(false));

        let mut body = json!({"hits": [], "total": 0});
        stamp_server_fallback(&mut body, Err(MetaHttpResponse::internal_error("boom")));
        assert!(body["server_fallback"].is_null());
        assert_eq!(body["server_fallback_forbidden"], json!(false));
        assert_eq!(body["server_fallback_read_failed"], json!(true));

        // And the primary's own rows are untouched in every case — the section
        // is additive, never a replacement.
        let mut body = json!({"hits": [{"fingerprint": "abc"}], "total": 1});
        stamp_server_fallback(&mut body, Err(unauthorized_response()));
        assert_eq!(body["hits"][0]["fingerprint"], "abc");
        assert_eq!(body["total"], 1);
    }

    /// Opt-in, exact-zero-armed, and — on samples — never armed by a PARTIAL
    /// answer. A stream read that failed makes an empty list unknown rather
    /// than zero, and the fallback must not answer an unknown.
    #[test]
    fn test_samples_fallback_is_opt_in_and_refuses_partial_answers() {
        let body = samples_body_src();
        assert!(
            body.contains(
                "q.include_server_fallback.unwrap_or(false) && client_reports_zero && failed == 0"
            ),
            "the fallback must be opt-in, armed by an exact zero, and refused \
             on a partial answer"
        );
    }

    /// **The samples read must take its stream names BY VALUE.**
    ///
    /// This is not style. `db_streams.iter().map(|stream| ...)` gives the
    /// closure a `&String` parameter, which makes its lifetime EARLY-bound.
    /// That was harmless until `include_server_fallback` added an await AFTER
    /// the fold: with an early-bound closure alive across it, `get_dbm_samples`
    /// stops satisfying axum's `for<'a>` Handler bound and the build fails —
    /// not here, but at the ROUTE REGISTRATION in `api/http`, with
    /// "implementation of `FnOnce` is not general enough", naming neither this
    /// closure nor the await that caused it.
    ///
    /// It broke exactly that way once, and `cargo check -p openobserve-core`
    /// stayed green throughout. Nothing in this crate's own tests can catch it,
    /// so the shape is pinned here instead.
    #[test]
    fn test_samples_reads_take_stream_names_by_value() {
        let body = samples_body_src();
        assert!(
            body.contains("db_streams.clone().into_iter().map(|stream|"),
            "the per-stream reads must take owned String names — `.iter()` here \
             makes the closure early-bound and breaks the route's Handler bound \
             in api/http, with an error that names neither this line nor the \
             await that exposes it"
        );
        assert!(
            !body.contains("db_streams.iter().map("),
            "borrowing the stream names is the exact shape that broke the route"
        );
    }

    /// The samples body is a plain `async fn`, not the handler — the extraction
    /// every other DBM read follows, and here also what keeps axum's Handler
    /// bound satisfiable while the body awaits its optional section.
    #[test]
    fn test_samples_body_is_extracted_from_the_handler() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        assert!(
            code.contains("async fn read_samples_body("),
            "the samples body must be a callable, like every other DBM read"
        );
        let start = code
            .find("pub async fn get_dbm_samples")
            .expect("the handler must exist");
        let handler = code[start..]
            .split("\n/// The samples endpoint's whole body")
            .next()
            .expect("handler body");
        assert!(
            handler.contains("read_samples_body(&org_id, &user_email.user_id, &q)"),
            "the handler must delegate to the body fn"
        );
        assert!(
            handler.len() < 700,
            "the handler must stay thin — {} bytes suggests the body moved back in",
            handler.len()
        );
    }

    /// The samples body's source, with the guard every scrape in this file
    /// carries: a fn that moved or was renamed fails LOUDLY here rather than
    /// silently scraping a neighbour and passing on its code.
    fn samples_body_src() -> &'static str {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("async fn read_samples_body(")
            .expect("read_samples_body must exist — a renamed fn must fail, not pass");
        let body = code[start..]
            .split("\n/// Run and attach")
            .next()
            .expect("the body fn must have a body");
        assert!(
            body.len() > 1500 && body.contains("fold_sample_rows("),
            "scraped the wrong function — read_samples_body must be the fn that \
             folds the per-stream reads"
        );
        body
    }

    // ── The history endpoint's folded endpoints section ────────────────────

    /// The calling-endpoints aggregation, folded into `/query/history`.
    ///
    /// It runs against the stream THIS handler resolves for its own backfill —
    /// the fact the standalone `/query/endpoints` had to be told, and which the
    /// page could only learn from this very response. Concurrent with the
    /// backfill and the tail collection, opt-in, and three-valued: rows, `null`
    /// (no stream), or the read-failed flag.
    #[test]
    fn test_history_folds_the_endpoints_section() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_query_history")
            .expect("the history handler must exist");
        let handler = code[start..]
            .split("\n#[derive")
            .next()
            .expect("the handler must have a body");
        // Guard: prove the scrape landed on the real handler.
        assert!(
            handler.len() > 2000 && handler.contains("build_backfill_sql("),
            "scraped the wrong function — get_dbm_query_history must be found \
             and be the fn that backfills"
        );

        // Opt-in, and against the stream this handler already resolved.
        assert!(handler.contains("q.include_endpoints.unwrap_or(false)"));
        assert!(
            handler.contains("build_endpoints_sql(") && handler.contains("backfill_stream_ref"),
            "the section must aggregate the stream this handler resolved, not a \
             second one the caller had to supply"
        );
        // Concurrent with the reads it joins, not sequenced after them.
        assert!(
            handler.contains("tokio::join!(backfill_fut, tails_fut, endpoints_fut)"),
            "the section must ride the existing fan-out"
        );
        // Three outcomes, kept apart.
        assert!(handler.contains("endpoints_read_failed"));
        assert!(
            handler.contains("Value::Null"),
            "a missing stream must be a null section, never an empty list that \
             reads as 'no callers'"
        );
        // The standalone route survives — this wave adds, never removes.
        assert!(src.contains("pub async fn get_dbm_query_endpoints("));
    }

    /// The section's cap is the standalone endpoint's cap, under the same
    /// default and clamp — a fold that silently returned a different number of
    /// rows would not be the same answer.
    #[test]
    fn test_history_endpoints_section_shares_the_endpoints_limit() {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find("pub async fn get_dbm_query_history")
            .expect("handler");
        let handler = code[start..].split("\n#[derive").next().expect("body");
        assert!(handler.len() > 2000, "scraped the wrong function");
        assert!(handler.contains("DEFAULT_ENDPOINTS_LIMIT"));
        assert!(handler.contains("MAX_ENDPOINTS_LIMIT"));
    }

    // ── The query-detail Logs-side pair (/query/insights) ──────────────────

    /// The join-key rule, which decides whether the `server_metrics` section is
    /// asked for at all. Shared with the standalone handler's 400, so the two
    /// answers to "is this key usable?" cannot drift.
    #[test]
    fn test_server_metrics_join_key_rule() {
        // Engine is always required — the counters are engine-specific tables.
        assert!(!has_server_metrics_join_key(None, Some("orders")));
        assert!(!has_server_metrics_join_key(Some(""), Some("orders")));
        // Postgres records carry a database, so an absent one cannot be
        // defaulted: an empty predicate matches every database.
        assert!(!has_server_metrics_join_key(Some("postgresql"), None));
        assert!(!has_server_metrics_join_key(Some("postgresql"), Some("")));
        assert!(has_server_metrics_join_key(
            Some("postgresql"),
            Some("orders")
        ));
        // mysql/mariadb top_query records carry NO database field, so
        // (engine, fingerprint) is the whole key there.
        assert!(has_server_metrics_join_key(Some("mysql"), None));
        assert!(has_server_metrics_join_key(Some("mariadb"), None));
        // Case-insensitively — the engine arrives from a row, not a constant.
        assert!(has_server_metrics_join_key(Some("MySQL"), None));
    }

    /// The merged endpoint's contract: two nullable sections, each with its own
    /// read-failed flag, from the SAME callables the standalone endpoints use
    /// (so a section cannot drift from the endpoint it supersedes), and a 403
    /// only when every section the caller asked for was denied.
    #[test]
    fn test_query_insights_folds_two_nullable_sections() {
        let src = include_str!("api.rs");
        let handler = src
            .split("pub async fn get_dbm_query_insights(")
            .nth(1)
            .expect("the merged handler must exist")
            .split("\n/// Whether a ready")
            .next()
            .unwrap();
        assert!(
            handler.len() > 800 && handler.contains("tokio::join!"),
            "scraped the wrong function — get_dbm_query_insights must be found and non-trivial"
        );

        // Same callables, not a re-derivation.
        assert!(handler.contains("read_plans_body("));
        assert!(handler.contains("read_server_metrics_body("));
        // Concurrent, like every other fan-out in this file.
        assert!(handler.contains("tokio::join!"));
        // One prologue for the pair — the whole point of merging two reads of
        // the same stream.
        assert!(handler.contains("server_prologue("));
        // Per-section failure, never a whole-request failure.
        for flag in ["plans_read_failed", "server_metrics_read_failed"] {
            assert!(handler.contains(flag), "missing section flag {flag}");
        }
        // A 403 survives as a 403 rather than becoming "nothing captured".
        assert!(handler.contains("unauthorized_response()"));
        // Both superseded routes stay registered — this wave adds, never
        // removes.
        assert!(src.contains("pub async fn get_dbm_query_plans("));
        assert!(src.contains("pub async fn get_dbm_query_server_metrics("));
    }

    /// A missing fingerprint is malformed for BOTH sections, so it must stay a
    /// 400 rather than degrading into two nulls the page reads as "nothing
    /// captured".
    #[test]
    fn test_query_insights_rejects_a_missing_fingerprint_up_front() {
        let src = include_str!("api.rs");
        let handler = src
            .split("pub async fn get_dbm_query_insights(")
            .nth(1)
            .expect("the merged handler must exist")
            .split("\n/// Whether a ready")
            .next()
            .unwrap();
        let reject = handler
            .find("fingerprint is required")
            .expect("insights must reject a missing fingerprint");
        let join = handler
            .find("tokio::join!")
            .expect("insights must fan out to both sections");
        assert!(
            reject < join,
            "the fingerprint check must precede the fan-out, or a malformed \
             request runs two searches before failing"
        );
    }

    // ── The per-instance breakdown fold (include_breakdown) ────────────────

    /// The split is keyed by instance and each key holds ONLY that instance's
    /// rows — this is the whole reason one response can replace one request per
    /// expanded row.
    #[test]
    fn test_fold_breakdown_by_instance_keys_by_instance() {
        let pool = vec![
            json!({"fingerprint": "abc", "db_system": "pg", "db_instance": "db1",
                   "stmt_class": "query", "calls": 1, "total_time_ns": 10, "statements": 1, "traces": 1}),
            json!({"fingerprint": "xyz", "db_system": "pg", "db_instance": "db2",
                   "stmt_class": "query", "calls": 2, "total_time_ns": 20, "statements": 2, "traces": 1}),
        ];
        let folded = fold_breakdown_by_instance(&pool);
        let obj = folded.as_object().expect("breakdown is an object");
        assert_eq!(obj.len(), 2);
        assert_eq!(obj["db1"].as_array().unwrap().len(), 1);
        assert_eq!(obj["db1"][0]["fingerprint"], "abc");
        assert_eq!(obj["db2"][0]["fingerprint"], "xyz");
    }

    /// Every statement class, exactly as the page's `stmt_class=all` call did.
    /// Filtering to `query` here would drop COMMIT/SET time out of the split
    /// while the parent row's total still counted it, manufacturing a
    /// shortfall the reader would be told to worry about.
    #[test]
    fn test_fold_breakdown_by_instance_keeps_every_class() {
        let folded = fold_breakdown_by_instance(&query_pool());
        let rows = folded["db1"].as_array().expect("db1 rows");
        let fps: Vec<&str> = rows
            .iter()
            .map(|r| r["fingerprint"].as_str().unwrap())
            .collect();
        assert!(fps.contains(&"abc"), "the query-class fingerprint survives");
        assert!(
            fps.contains(&"tcl"),
            "the transaction-control fingerprint survives too — the parent total counts it"
        );
    }

    /// `_other` never enters the split. An instance scope is narrower than the
    /// grain the remainder reconciles at (§5.2), so passing it through would
    /// present a synthetic row as if it were a service's own time — and the
    /// standalone per-row call dropped it for the same reason.
    #[test]
    fn test_fold_breakdown_by_instance_drops_the_other_remainder() {
        let folded = fold_breakdown_by_instance(&query_pool());
        let rows = folded["db1"].as_array().expect("db1 rows");
        assert!(
            rows.iter().all(|r| r["fingerprint"] != "_other"),
            "the _other remainder must not be attributed to a schema or service"
        );
    }

    /// A row with no instance has no drill-down to belong to; keying it under
    /// `""` would invent an instance the overview never rendered.
    #[test]
    fn test_fold_breakdown_by_instance_skips_instanceless_rows() {
        let pool = vec![json!({"fingerprint": "abc", "db_system": "pg",
                               "stmt_class": "query", "calls": 1, "total_time_ns": 10})];
        let folded = fold_breakdown_by_instance(&pool);
        assert!(folded.as_object().unwrap().is_empty());
    }

    /// Capped per instance at the same limit the page used to pass, and ranked
    /// heaviest first so the cap keeps the rows that carry the shape.
    #[test]
    fn test_fold_breakdown_by_instance_ranks_and_caps() {
        let pool: Vec<Value> = (0..DEFAULT_BREAKDOWN_LIMIT + 10)
            .map(|i| {
                json!({"fingerprint": format!("fp{i}"), "db_system": "pg", "db_instance": "db1",
                       "stmt_class": "query", "calls": 1, "total_time_ns": i, "statements": 1, "traces": 1})
            })
            .collect();
        let folded = fold_breakdown_by_instance(&pool);
        let rows = folded["db1"].as_array().unwrap();
        assert_eq!(rows.len(), DEFAULT_BREAKDOWN_LIMIT);
        // Heaviest first: the highest total_time_ns survives the cap, the
        // lightest does not.
        assert_eq!(rows[0]["total_time_ns"], json!(DEFAULT_BREAKDOWN_LIMIT + 9));
        assert!(rows.iter().all(|r| r["fingerprint"] != "fp0"));
    }

    /// The split is opt-in: without the flag the response is byte-identical to
    /// what every existing caller already receives.
    #[test]
    fn test_databases_breakdown_is_opt_in() {
        let src = include_str!("api.rs");
        let body = src
            .split("async fn read_databases_body(")
            .nth(1)
            .expect("read_databases_body must exist")
            .split("\n/// One window")
            .next()
            .unwrap();
        assert!(
            body.len() > 500 && body.contains("read_current_and_baseline"),
            "scraped the wrong function — read_databases_body must be found and non-trivial"
        );
        assert!(
            body.contains("if let Some(breakdown) = window.breakdown"),
            "the breakdown section must be conditional on the caller having asked"
        );
        assert!(
            body.contains("breakdown_read_failed"),
            "a partial section must state its own failure, never imply it by emptiness"
        );
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
        // The caller lowers the needle once per request (the fn's contract);
        // the match itself must stay case-insensitive over the HAYSTACK.
        assert!(search_matches(&row, &"from users".to_lowercase()));
        assert!(search_matches(&row, &"SELECT".to_lowercase()));
        assert!(search_matches(&row, &"deadbe".to_lowercase()));
        assert!(!search_matches(&row, &"DELETE".to_lowercase()));
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
        let sql = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            "",
            50,
            &proj(&all_cols(), None),
        );
        let expected = "SELECT _timestamp, o2_dbm_kind, o2_dbm_engine, o2_dbm_database, o2_dbm_instance, o2_dbm_timestamp, o2_dbm_raw, o2_dbm_victim_pid, o2_dbm_participants, o2_dbm_participant_count, o2_dbm_victim_side, o2_dbm_blocked_pid, o2_dbm_blocked_app, o2_dbm_blocked_query, o2_dbm_blocked_fingerprint, o2_dbm_blocking_pid, o2_dbm_blocking_app, o2_dbm_blocking_query, o2_dbm_blocking_fingerprint, o2_dbm_wait_event_type, o2_dbm_wait_event, o2_dbm_wait_seconds, o2_dbm_query_shape, o2_event_name, o2_dbm_session_pid, o2_dbm_session_user, o2_dbm_session_app, o2_dbm_session_state, o2_dbm_query_start, o2_dbm_xact_start, o2_dbm_wait_start, o2_dbm_duration_ms, o2_dbm_exec_time_ms, o2_dbm_server_query_id, o2_dbm_activity_query, o2_dbm_fingerprint, o2_dbm_blocking_pids, o2_dbm_lock_mode, o2_dbm_lock_type, o2_dbm_lock_relation, o2_dbm_client_addr, o2_dbm_client_host, o2_dbm_client_port, o2_dbm_plan, o2_dbm_plan_hash, o2_dbm_plan_hash_version, o2_dbm_calls, o2_dbm_rows, o2_dbm_exec_time_s, o2_dbm_shared_blks_hit, o2_dbm_shared_blks_read, o2_dbm_shared_blks_dirtied, o2_dbm_shared_blks_written, o2_dbm_temp_blks_read, o2_dbm_temp_blks_written, o2_dbm_metrics_are_delta, o2_dbm_receiver_version, o2_dbm_plan_source, o2_dbm_plan_duration_ms, o2_dbm_plan_rows_actual, o2_dbm_relation, o2_dbm_schema, o2_dbm_total_bytes, o2_dbm_heap_bytes, o2_dbm_live_tuples, o2_dbm_dead_tuples, o2_dbm_dead_tup_pct, o2_dbm_mod_since_analyze, o2_dbm_seq_scan_count, o2_dbm_seq_tup_read, o2_dbm_idx_scan_count, o2_dbm_autovacuum_count, o2_dbm_frozen_xid_age, o2_dbm_last_vacuum, o2_dbm_last_autovacuum, o2_dbm_last_analyze, o2_dbm_counters_are_cumulative, o2_dbm_tuples_are_estimated, o2_dbm_index_name, o2_dbm_index_bytes, o2_dbm_idx_tup_read, o2_dbm_idx_tup_fetch, o2_dbm_index_is_unique, o2_dbm_stmt_duration_ms FROM \"dbm_server\"\nWHERE _timestamp >= 100 AND _timestamp < 200\n    AND o2_dbm_kind = 'deadlock'\nORDER BY _timestamp DESC\nLIMIT 50";
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

        let sql = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            "",
            50,
            &proj(&present, None),
        );
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
        let sql = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            "",
            50,
            &proj(&HashSet::new(), None),
        );
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
        // Both spellings a schema-reading pipeline can have: a handler that
        // still owns its body, and a `read_*_body` fn extracted for the
        // badges fan-in. Scanning only the first would let an extracted body
        // silently escape the guard — the failure mode this test must not
        // have.
        let discover = |prefix: &'static str| {
            code.match_indices(prefix)
                .filter_map(move |(i, _)| {
                    let rest = &code[i..];
                    let open = rest.find('(')?;
                    let name = rest[prefix.len()..open].trim();
                    let body = rest[open..].split("\n}\n").next()?;
                    body.contains("present_dbm_columns(")
                        .then_some((name, body))
                })
                .collect::<Vec<(&str, &str)>>()
        };
        let mut guarded = discover("pub async fn get_dbm_");
        guarded.extend(discover("async fn read_"));
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

    // ── A1 · the RAW presence gate (`queryable_columns`) ────────────────────
    //
    // `present_dbm_columns` exists because naming an absent column fails the
    // WHOLE query with a 400 rather than yielding a null column. The A1 fallback
    // projects RAW vendor columns alongside the canonical ones, and the hazard
    // is exactly symmetric — measured on a real OSS-ingested stream, all 9 MSSQL
    // raw columns and 3 MariaDB ones are absent from the merged schema. A
    // hardcoded raw projection 400s the Deadlocks page on any deployment that
    // never ran those recipes, which is most of them.
    //
    // There is a SECOND variant a naive fix still misses. Past
    // `ZO_SCHEMA_MAX_FIELDS_TO_ENABLE_UDS` (default 1000) fields, User-Defined
    // Schema auto-enables and truncates which fields stay QUERYABLE, while
    // `infra::schema::get` still returns the full merged schema. A presence
    // check that consults only the stored schema therefore passes, and the query
    // then 400s with a different message: "Field exists in the stream but not in
    // its User-Defined Schema (UDS)". The DBM stream is a shared logs stream
    // carrying ordinary log lines (195-283 columns measured on real
    // deployments), so crossing 1000 is realistic, and the raw vendor columns —
    // old and low-priority — are plausible truncation candidates.
    //
    // `queryable_columns` is the pure core of both checks, split out from the
    // async wrapper so the UDS half is testable without a meta store.

    /// A candidate absent from the schema must be dropped.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_queryable_columns_drops_candidates_absent_from_the_schema() {
        let schema = schema_of(&["_timestamp", "o2_pg_event", "dl_waiter_pid"]);
        let got = queryable_columns(
            &[
                "o2_pg_event",
                "dl_waiter_pid",
                "mssql_spid",
                "maria_lock_mode",
            ],
            &schema,
            &[],
        );
        assert_eq!(
            got,
            ["o2_pg_event", "dl_waiter_pid"]
                .into_iter()
                .map(str::to_string)
                .collect::<HashSet<String>>(),
            "a column absent from the schema fails the WHOLE query, so it must not \
             reach the projection"
        );
    }

    /// THE UDS VARIANT. A field present in the stored schema but truncated out
    /// of an auto-enabled User-Defined Schema is NOT queryable, and naming it
    /// 400s the page just as an absent one does.
    ///
    /// This is the case a schema-only check passes and then fails at query time,
    /// which is why the gate takes the UDS list as well as the schema.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_queryable_columns_honours_an_enabled_user_defined_schema() {
        let schema = schema_of(&["_timestamp", "o2_pg_event", "dl_waiter_pid", "dl_query_1"]);
        // UDS enabled, and it kept only one of the three raw columns.
        let uds = vec!["_timestamp".to_string(), "o2_pg_event".to_string()];

        let got = queryable_columns(
            &["o2_pg_event", "dl_waiter_pid", "dl_query_1"],
            &schema,
            &uds,
        );
        assert_eq!(
            got,
            ["o2_pg_event"]
                .into_iter()
                .map(str::to_string)
                .collect::<HashSet<String>>(),
            "`dl_waiter_pid`/`dl_query_1` are in the merged schema but truncated out \
             of the UDS — naming them returns 'Field exists in the stream but not in \
             its User-Defined Schema (UDS)' and fails the whole page"
        );
    }

    /// An EMPTY UDS list means UDS is not enabled — it must not be read as
    /// "nothing is queryable".
    ///
    /// This is the same false-verdict shape `present_dbm_columns` documents: the
    /// disabled case and the everything-truncated case are both empty vectors on
    /// the wire, and treating them alike would degrade every deployment that
    /// never enabled UDS (i.e. almost all of them) to a `_timestamp`-only
    /// projection and silently show zero deadlocks.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_queryable_columns_treats_an_empty_uds_as_disabled_not_as_empty() {
        let schema = schema_of(&["_timestamp", "o2_pg_event", "dl_waiter_pid"]);
        let got = queryable_columns(&["o2_pg_event", "dl_waiter_pid"], &schema, &[]);
        assert_eq!(
            got.len(),
            2,
            "an empty defined_schema_fields means UDS is OFF, not that every field \
             was truncated"
        );
    }

    /// The gate is candidate-driven: a schema field nobody asked for must not
    /// appear, or the projection grows without bound on a 283-column stream.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_queryable_columns_returns_only_what_was_asked_for() {
        let schema = schema_of(&["_timestamp", "o2_pg_event", "unrelated_log_field"]);
        let got = queryable_columns(&["o2_pg_event"], &schema, &[]);
        assert_eq!(got.len(), 1);
        assert!(!got.contains("unrelated_log_field"));
    }

    /// The raw gate must be built from the SHARED vocabulary, not a local copy.
    ///
    /// `RAW_DEADLOCK_FIELDS` lives in `config` precisely so the enterprise
    /// canonicalizers and this projection cannot drift; a second literal list
    /// here would defeat that and the cross-repo contract test could not see it.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_present_raw_deadlock_columns_gates_the_shared_vocabulary() {
        let schema = schema_of(&[
            "_timestamp",
            "o2_pg_event",
            "dl_waiter_pid",
            "an_unrelated_field",
        ]);
        let got = raw_deadlock_columns_in(&schema, &[]);
        assert_eq!(
            got,
            ["o2_pg_event", "dl_waiter_pid"]
                .into_iter()
                .map(str::to_string)
                .collect::<HashSet<String>>()
        );
        // Every candidate it considers comes from the shared array.
        for f in &got {
            assert!(
                server_vantage::RAW_DEADLOCK_FIELDS.contains(&f.as_str()),
                "{f} is not a RAW_DEADLOCK_FIELDS member — the gate is using a local list"
            );
        }
    }

    // ── A1.1 · the canonicalization boundary ────────────────────────────────
    //
    // The fallback must be TRANSITIONAL, not permanent: it should widen the read
    // only over the window BEFORE this deployment started canonicalizing. These
    // pin the decision function that makes that call from two bounded probes.

    /// EDGE CASE (a) — an org that has ONLY raw rows.
    ///
    /// No canonical deadlock row exists anywhere in the window, so nothing tells
    /// us canonicalization had started. The fallback must cover the WHOLE range
    /// or A1 regresses to the empty page it exists to fix.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_boundary_keeps_the_fallback_on_for_an_all_raw_window() {
        let probe = BoundaryProbe {
            earliest_canonical: None,
            has_raw_row: true,
        };
        assert!(
            probe.fallback_needed(1_000),
            "a window with raw rows and no canonical row is exactly the A1 case"
        );
    }

    /// EDGE CASE (b) — an org that has ONLY canonical rows.
    ///
    /// Canonicalization covers the window from its first instant and there is no
    /// raw row to miss, so the fallback must be INERT: no widening at all. This
    /// is the entire point of A1.1 — steady-state reads pay nothing.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_boundary_turns_the_fallback_off_for_an_all_canonical_window() {
        let probe = BoundaryProbe {
            earliest_canonical: Some(1_000),
            has_raw_row: false,
        };
        assert!(
            !probe.fallback_needed(1_000),
            "canonicalization covering the window start with no raw row present \
             means the fast path is complete"
        );
    }

    /// THE FINDING: the boundary TIMESTAMP cannot move the verdict, in either
    /// direction, at any position relative to the window.
    ///
    /// This started as an "is the boundary inclusive at `start_time`" test and
    /// became the test that killed the boundary. Sweeping the earliest canonical
    /// row across every interesting position — before the window, exactly at its
    /// start, one microsecond after, deep inside, and absent altogether — while
    /// holding `has_raw_row` fixed must not change the answer once. If a future
    /// change makes it change, the mechanism has silently acquired a
    /// timestamp-comparison bug of exactly the kind that hides raw rows under
    /// interleaving.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_boundary_timestamp_never_changes_the_verdict() {
        let start = 1_000;
        let positions = [None, Some(500), Some(1_000), Some(1_001), Some(5_000)];
        for has_raw_row in [true, false] {
            for earliest_canonical in positions {
                let probe = BoundaryProbe {
                    earliest_canonical,
                    has_raw_row,
                };
                assert_eq!(
                    probe.fallback_needed(start),
                    has_raw_row,
                    "the verdict must be exactly `has_raw_row`, but a canonical \
                     row at {earliest_canonical:?} changed it — with raw rows \
                     present that HIDES them (A1 reintroduced), and with none \
                     present it widens a read that can surface nothing"
                );
            }
        }
    }

    /// A window that STRADDLES the boundary is served with the fallback on for
    /// the WHOLE window, never split into a raw half and a canonical half.
    ///
    /// Splitting would re-derive the stitch groups across the seam, and
    /// `merge_mysql_deadlocks` groups by 2 s proximity — so a MySQL deadlock
    /// whose sides straddle the boundary would be torn into two half-sized
    /// deadlocks. That is precisely the bug GAP 2 exists to prevent.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_boundary_does_not_split_a_straddling_window() {
        let probe = BoundaryProbe {
            earliest_canonical: Some(5_000),
            has_raw_row: true,
        };
        assert!(probe.fallback_needed(1_000));
    }

    /// INTERLEAVING — the reason the OFF verdict needs BOTH conditions.
    ///
    /// A cluster can run mixed builds or be downgraded, so raw rows can appear
    /// AFTER canonical ones. Then canonicalization covers the window start and a
    /// boundary-only test would say OFF — hiding the interleaved raw rows. The
    /// verdict therefore also requires that the window contain no raw row.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_boundary_stays_on_when_raw_rows_interleave_after_canonical_ones() {
        let probe = BoundaryProbe {
            earliest_canonical: Some(500),
            has_raw_row: true,
        };
        assert!(
            probe.fallback_needed(1_000),
            "canonicalization predates the window, but a raw row inside it would \
             be invisible to the canonical-only fast path"
        );
    }

    /// An EMPTY window — no rows of either shape — must not pay for a widening
    /// that has nothing to find, but must also not claim coverage it cannot
    /// prove. There is nothing to show either way, so the cheap verdict is the
    /// honest one.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_boundary_is_inert_on_a_window_with_neither_shape() {
        let probe = BoundaryProbe {
            earliest_canonical: None,
            has_raw_row: false,
        };
        assert!(
            !probe.fallback_needed(1_000),
            "no raw row in the window means the widening cannot surface anything"
        );
    }

    /// The whole win, asserted rather than inspected: with the boundary
    /// resolving to OFF the emitted SQL is BYTE-IDENTICAL to a read that never
    /// had a fallback — no marker terms, no raw projection.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_fallback_off_emits_byte_identical_sql_to_no_fallback() {
        let with_none = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            " AND o2_dbm_engine = 'mysql'",
            50,
            &proj(&all_cols(), None),
        );
        // What the deadlocks caller now passes when the boundary says the window
        // is fully canonicalized.
        let boundary_off: Option<&RawDeadlockFallback> = None;
        let steady_state = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            " AND o2_dbm_engine = 'mysql'",
            50,
            &proj(&all_cols(), boundary_off),
        );
        assert_eq!(with_none, steady_state);

        // Checked as whole IDENTIFIERS, not substrings: several raw names are
        // substrings of canonical ones the fast path legitimately projects
        // (`database` inside `o2_dbm_database`), so a `contains` check reports a
        // widening that is not there.
        let named: HashSet<&str> = steady_state
            .split(|c: char| !(c.is_alphanumeric() || c == '_'))
            .collect();
        for (col, _) in server_vantage::DEADLOCK_MARKERS {
            assert!(
                !named.contains(col),
                "a steady-state read must not name the raw marker {col}:\n{steady_state}"
            );
        }
        for f in server_vantage::RAW_DEADLOCK_FIELDS {
            assert!(
                !named.contains(f),
                "a steady-state read must not project the raw column {f}:\n{steady_state}"
            );
        }
    }

    /// The probe SQL asks the cheapest question that answers the boundary:
    /// the EARLIEST canonical row in the window, one row.
    ///
    /// Ordered ASCENDING — the mirror of `build_last_seen_sql`, which is DESC
    /// because it wants the latest. Getting this backwards returns the newest
    /// canonical row, which is always inside the window and would answer "yes,
    /// covered" for every window that has ever seen a canonical row.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_earliest_canonical_probe_sql_is_a_single_ascending_row() {
        let sql = build_earliest_canonical_sql("dbm_server", "deadlock", 100, 200);
        assert!(sql.contains("ORDER BY _timestamp ASC"), "{sql}");
        assert!(sql.contains("LIMIT 1"), "{sql}");
        assert!(sql.contains("o2_dbm_kind = 'deadlock'"), "{sql}");
        assert!(
            sql.contains("_timestamp >= 100 AND _timestamp < 200"),
            "the probe must be bounded to the REQUESTED window — an unbounded \
             MIN() over all history costs more than the widening it saves:\n{sql}"
        );
    }

    /// The raw probe is schema-gated exactly like the widening it guards.
    ///
    /// Each marker is a column, and naming an absent one fails the WHOLE query —
    /// so a probe that hardcodes all four markers 400s on the very deployments
    /// the fallback exists for. With NO marker column present there is no query
    /// to run at all.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_raw_presence_probe_names_only_marker_columns_the_stream_has() {
        let raw = raw_cols(&["o2_pg_event"]);
        let sql = build_raw_deadlock_presence_sql("dbm_server", 100, 200, &raw)
            .expect("one marker present means one probe");
        assert!(sql.contains("o2_pg_event = 'deadlock'"), "{sql}");
        assert!(!sql.contains("o2_my_event"), "{sql}");
        assert!(!sql.contains("o2_recipe"), "{sql}");
        assert!(sql.contains("LIMIT 1"), "{sql}");

        let none = raw_cols(&[]);
        assert!(
            build_raw_deadlock_presence_sql("dbm_server", 100, 200, &none).is_none(),
            "with no marker column there is nothing to probe for"
        );
    }

    // ── A1 · the widened deadlocks SQL ──────────────────────────────────────

    /// The whole fallback in one assertion: BOTH shapes in ONE query.
    ///
    /// No UNION and no second query — deadlocks projects columns and folds in
    /// Rust rather than aggregating in SQL, so one widened `WHERE` plus a
    /// widened projection covers canonical and raw rows together. Verified live:
    /// a single `OR`-ed predicate returned all 239 raw rows on a stream with 0
    /// canonical ones.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_sql_matches_both_the_canonical_and_the_raw_shape() {
        let raw = raw_cols(&["o2_pg_event", "o2_my_event", "o2_maria_event", "dl_query_1"]);
        let sql = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            "",
            50,
            &proj(&all_cols(), Some(&raw)),
        );

        assert!(
            sql.contains(
                "(o2_dbm_kind = 'deadlock' OR o2_pg_event = 'deadlock' OR \
                          o2_my_event = 'deadlock' OR o2_maria_event = 'deadlock')"
            ),
            "the canonical predicate must be OR-ed with the markers, not replaced:\n{sql}"
        );
        assert!(
            sql.contains("dl_query_1"),
            "the raw columns must be projected too, or the canonicalizer gets nothing to read"
        );
        assert!(!sql.contains("UNION"), "one query, not two");
    }

    /// THE §1.3 REGRESSION TEST — the one that would have caught the 400.
    ///
    /// On a real OSS-ingested stream all 9 MSSQL raw columns and 3 MariaDB ones
    /// are ABSENT from the merged schema, and naming an absent column fails the
    /// WHOLE query with `unknown field 'x'` — a 400 on the entire Deadlocks
    /// page, not a null column. A hardcoded raw projection is the obvious
    /// implementation and it breaks the page on most deployments.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_sql_never_names_a_raw_column_absent_from_the_stream() {
        // Exactly the rig's shape: pg present, the three maria lock columns and
        // every mssql column absent.
        let raw = raw_cols(&[
            "o2_pg_event",
            "o2_my_event",
            "dl_waiter_pid",
            "dl_query_1",
            "my_trx_side",
        ]);
        let sql = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            "",
            50,
            &proj(&all_cols(), Some(&raw)),
        );

        for absent in [
            "maria_lock_mode",
            "maria_lock_table",
            "maria_lock_index",
            "mssql_spid",
            "mssql_is_victim",
            "mssql_query",
        ] {
            assert!(
                !sql.contains(absent),
                "{absent} is absent from this stream — naming it 400s the WHOLE page:\n{sql}"
            );
        }
        assert!(
            sql.contains("dl_waiter_pid"),
            "present raw columns still project"
        );
    }

    /// The mssql arm's own presence hazard: PARTIAL presence, measured live.
    ///
    /// Adding mssql to the vocabulary did not remove the hazard, it added a new
    /// instance of it that the all-absent test above cannot see. On the rig — a
    /// stream with real SQL Server deadlocks flowing — 8 of the 9 mssql columns
    /// materialized and `mssql_query` did NOT, because the shred emits it as an
    /// empty string and the collector drops empty attributes. So the realistic
    /// mssql deployment is not "all present" or "all absent"; it is 8-of-9, and
    /// naming the ninth 400s the whole Deadlocks page.
    ///
    /// This is the test that proves the mssql names are CANDIDATES intersected
    /// with the schema, not a projection hardcoded alongside the new arm.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_sql_projects_mssql_partially_when_only_some_columns_exist() {
        // Exactly the rig's post-DSN-fix shape.
        let raw = raw_cols(&[
            "o2_recipe",
            "mssql_spid",
            "mssql_is_victim",
            "mssql_app",
            "mssql_user",
            "mssql_lock_mode",
            "mssql_lock_target",
            "mssql_db",
        ]);
        let sql = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            "",
            50,
            &proj(&all_cols(), Some(&raw)),
        );

        assert!(
            !sql.contains("mssql_query"),
            "mssql_query is absent on a stream that HAS live mssql deadlocks — \
             naming it 400s the whole page:\n{sql}"
        );
        for present in ["mssql_spid", "mssql_is_victim", "mssql_lock_target"] {
            assert!(
                sql.contains(present),
                "{present} is present and must still project:\n{sql}"
            );
        }
        assert!(
            sql.contains("o2_recipe = 'mssql_deadlock'"),
            "the mssql marker is a RECIPE TAG — comparing it to 'deadlock' would \
             match zero rows while looking correct:\n{sql}"
        );
    }

    /// The MARKER columns are columns too, so the widened predicate is gated on
    /// presence exactly like the projection.
    ///
    /// A stream that never saw a MariaDB deadlock has no `o2_maria_event`
    /// column, and naming it in the `WHERE` fails the page just as naming it in
    /// the `SELECT` would. This is the half of the hazard that lives in the
    /// predicate rather than the projection, and it is easy to miss because the
    /// projection half is the one the design calls out.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_sql_only_predicates_on_marker_columns_the_stream_has() {
        let raw = raw_cols(&["o2_my_event", "my_trx_side"]);
        let sql = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            "",
            50,
            &proj(&all_cols(), Some(&raw)),
        );

        assert!(sql.contains("o2_my_event = 'deadlock'"));
        assert!(
            !sql.contains("o2_pg_event"),
            "an absent marker column in the WHERE fails the page as surely as one in \
             the SELECT:\n{sql}"
        );
        assert!(!sql.contains("o2_maria_event"));
    }

    /// A stream with NO raw columns at all must fall back to today's exact
    /// query, not to a malformed `OR ()`.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_deadlock_sql_with_no_raw_markers_present_is_the_unwidened_query() {
        let none = raw_cols(&[]);
        let widened = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            "",
            50,
            &proj(&all_cols(), Some(&none)),
        );
        let today = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            "",
            50,
            &proj(&all_cols(), None),
        );
        assert_eq!(
            widened, today,
            "with no marker column present there is nothing to OR, and an empty \
             disjunction must not become `OR ()`"
        );
    }

    /// THE KILL-SWITCH CONTRACT: off ⇒ byte-identical SQL to today.
    ///
    /// `ZO_DB_MONITORING_DEADLOCK_READ_FALLBACK=false` is an escape hatch for a
    /// deployment whose OSS history makes the widened scan too expensive. An
    /// escape hatch that still emits the wider query buys nothing, so "off"
    /// must reach all the way to the emitted bytes — expressed here as the
    /// `None` opts the disabled path passes.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_kill_switch_restores_byte_identical_sql() {
        let preds = dbm_event_preds(Some("mysql"), Some("db-1"), Some("shop"));
        let off = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            &preds,
            50,
            &proj(&all_cols(), None),
        );
        let expected_kind = format!("AND {} = 'deadlock'", server_vantage::O2_DBM_KIND);
        assert!(
            off.contains(&expected_kind),
            "with the fallback off the predicate is the bare canonical one:\n{off}"
        );
        assert!(
            !off.contains(" OR "),
            "nothing is OR-ed when it is off:\n{off}"
        );
        // Assert on the PROJECTED COLUMN LIST, not on substrings of the whole
        // statement: several raw names (`database`, `instance`, `body`) are
        // substrings of canonical column names, so a `contains` over the SQL
        // text reports a false positive that has nothing to do with the
        // fallback.
        let projected: HashSet<&str> = off["SELECT ".len()..off.find(" FROM ").unwrap()]
            .split(", ")
            .collect();
        for raw in server_vantage::RAW_DEADLOCK_FIELDS {
            assert!(
                !projected.contains(raw),
                "raw column {raw} must not be projected with the fallback off:\n{off}"
            );
        }
        // ...and the guarantee that makes it a real kill-switch: turning it ON
        // over the SAME stream must produce a DIFFERENT query, so "off" is
        // demonstrably doing something.
        let on = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            &preds,
            50,
            &proj(
                &all_cols(),
                Some(&raw_cols(&["o2_my_event", "my_trx_side"])),
            ),
        );
        assert_ne!(
            on, off,
            "if on and off emit the same SQL, the knob is inert"
        );
    }

    /// The OTHER two callers must be untouched in phase 1.
    ///
    /// `build_dbm_events_sql` is shared with blocking (`read_blocking_body`) and
    /// activity, and widening it for everyone would push raw deadlock columns
    /// into their projections — cost with no reader, and for blocking a real
    /// risk, since its degraded projection already drops rows.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_fallback_does_not_reach_the_blocking_or_activity_callers() {
        let src = include_str!("api.rs");
        // Only the real code — the test module below calls the builder many
        // times and matching those would make this vacuous.
        let code = &src[..src.find("\n#[cfg(test)]\nmod tests").unwrap_or(src.len())];

        // Every call site, discovered rather than listed: a NEW caller added
        // without a raw argument is exactly the drift this must catch.
        let sites: Vec<&str> = code
            .match_indices("build_dbm_events_sql(")
            // ...minus the definition itself, which is `fn build_dbm_events_sql(`.
            .filter(|(i, _)| !code[..*i].ends_with("fn "))
            .map(|(i, _)| {
                let rest = &code[i..];
                &rest[..rest.find(");").expect("call site is closed") + 2]
            })
            .collect();
        assert_eq!(
            sites.len(),
            3,
            "expected the deadlocks / blocking / activity call sites; found \
             {} — the extractor is broken, or a caller was added without \
             deciding what it passes for the raw opts",
            sites.len()
        );

        // Exactly ONE may be widened, and it must be the deadlocks one.
        let widened: Vec<&&str> = sites.iter().filter(|s| !s.contains("raw: None")).collect();
        assert_eq!(
            widened.len(),
            1,
            "exactly ONE caller — deadlocks — may pass the raw opts in phase 1; \
             blocking and activity must keep passing `raw: None`. Widened: {widened:?}"
        );
        assert!(
            widened[0].contains("KIND_DEADLOCK"),
            "the widened caller must be deadlocks, not {}",
            widened[0]
        );
        for kind in ["KIND_BLOCKING", "KIND_ACTIVITY"] {
            let site = sites
                .iter()
                .find(|s| s.contains(kind))
                .unwrap_or_else(|| panic!("no {kind} call site"));
            assert!(
                site.contains("raw: None"),
                "the {kind} caller must pass `raw: None`, or A1 pushes raw deadlock \
                 columns into a projection with no reader:\n{site}"
            );
        }
    }

    // ── A1 · the row-level branch and the Rust-side scope narrowing ─────────

    /// A CANONICAL row must still go through the canonical reader, unchanged.
    ///
    /// The fallback must not become the only path — the canonical reader is the
    /// one that has been correct all along, and rerouting its rows through the
    /// canonicalizer would re-derive fields from vendor columns that are not
    /// even projected on such a row.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_canonical_row_still_uses_the_canonical_reader() {
        let row = json!({
            "_timestamp": 1_786_166_303_139_783i64,
            server_vantage::O2_DBM_KIND: "deadlock",
            server_vantage::O2_DBM_ENGINE: "mysql",
            server_vantage::O2_DBM_INSTANCE: "db-1",
            server_vantage::O2_DBM_VICTIM_SIDE: 2,
        });
        let ev = deadlock_event_for_row(&row).expect("a canonical row yields an event");
        assert_eq!(ev.engine.as_deref(), Some("mysql"));
        assert_eq!(ev.instance.as_deref(), Some("db-1"));
        assert_eq!(ev.victim_side, Some(2), "read off the canonical column");
    }

    /// A RAW row — the whole point — must reach the enterprise canonicalizer.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_raw_row_is_canonicalized_at_read_time() {
        let row = json!({
            "_timestamp": 1_786_166_303_139_783i64,
            "o2_my_event": "deadlock",
            "my_trx_side": "1",
            "my_trx_id": "4589",
            "my_trx_thread": "89",
            "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
            "server_address": "db-7.internal:3306",
        });
        let ev = deadlock_event_for_row(&row).expect("a raw row must canonicalize at read time");
        assert_eq!(ev.engine.as_deref(), Some("mysql"));
        assert_eq!(
            ev.instance.as_deref(),
            Some("db-7.internal"),
            "the instance must be derived, or the event never stitches and never \
             matches ?instance="
        );
        assert_eq!(ev.participants.len(), 1);
        assert_eq!(ev.participants[0].pid, Some(89));
        assert_eq!(ev.participants[0].side, Some(1));
    }

    /// DEDUP (§4.1): a row is used EXACTLY ONCE.
    ///
    /// The two populations are disjoint at the row level — a row either carries
    /// `o2_dbm_kind = 'deadlock'` or it does not. A row carrying BOTH the
    /// canonical column and its original raw columns (an enterprise-ingested row
    /// whose raw fields the strip left in place) must therefore take the
    /// canonical branch only, and never be emitted twice.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_row_with_both_shapes_is_used_exactly_once_canonically() {
        let both = json!({
            "_timestamp": 1_786_166_303_139_783i64,
            // canonical
            server_vantage::O2_DBM_KIND: "deadlock",
            server_vantage::O2_DBM_ENGINE: "mariadb",
            server_vantage::O2_DBM_INSTANCE: "db-canon",
            // ...and the raw marker plus vendor fields still on the same row
            "o2_maria_event": "deadlock",
            "maria_trx_side": "1",
            "maria_trx_thread": "14",
            "server_address": "db-raw.internal:3306",
        });
        let ev = deadlock_event_for_row(&both).expect("event");
        assert_eq!(
            ev.instance.as_deref(),
            Some("db-canon"),
            "the CANONICAL branch owns a row that has both shapes — taking the raw \
             branch would re-derive fields the canonical path already resolved"
        );

        // ...and over a batch, one row in is one event out.
        let batch = vec![
            both,
            json!({
                "_timestamp": 1_786_166_303_139_900i64,
                "o2_pg_event": "deadlock",
                "dl_waiter_pid": "1071", "dl_waiter2_pid": "1072",
                "dl_query_1": "UPDATE a SET x = 1", "dl_query_2": "UPDATE b SET y = 2",
            }),
        ];
        let events: Vec<_> = batch.iter().filter_map(deadlock_event_for_row).collect();
        assert_eq!(events.len(), 2, "two rows, two events — never four");
    }

    /// A raw row the canonicalizer refuses (the PG banner) is DROPPED, not
    /// emitted as a content-free event.
    ///
    /// Postgres logs a banner and a DETAIL entry per deadlock. Emitting the
    /// banner would put a participant-less row on the page for every PG
    /// deadlock, doubling the visible count against 19 real events.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_an_unparsable_raw_row_is_dropped_not_emitted_blank() {
        let banner = json!({
            "_timestamp": 1_786_843_262_880_000i64,
            "o2_pg_event": "deadlock",
            "pg_pid": "1071",
            "o2_deadlock_raw": "deadlock detected",
        });
        assert!(
            deadlock_event_for_row(&banner).is_none(),
            "a banner is not a deadlock — emitting it doubles the PG count"
        );
        // A row with no marker at all is likewise nobody's event.
        assert!(deadlock_event_for_row(&json!({"_timestamp": 1i64, "body": "hi"})).is_none());
    }

    /// THE CROSS-RECORD ASSEMBLY the fallback inherits for free: raw MySQL
    /// side + side + verdict must stitch into ONE event with the victim flagged.
    ///
    /// This is the case the design calls the hardest in principle and already
    /// solved in practice — `stitch_mysql_deadlocks` is shape-agnostic, keying
    /// on canonical `engine`/`participants`/`victim_side`, which is exactly what
    /// the canonicalizer's output provides. Pinned here because "it should just
    /// work" is precisely the claim that needs a test.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_raw_mysql_sides_and_verdict_stitch_into_one_flagged_event() {
        let rows = vec![
            json!({
                "_timestamp": 1_786_166_303_139_783i64, "o2_my_event": "deadlock",
                "my_trx_side": "1", "my_trx_id": "4589", "my_trx_thread": "89",
                "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
                "server_address": "db-7:3306",
            }),
            json!({
                "_timestamp": 1_786_166_303_139_834i64, "o2_my_event": "deadlock",
                "my_trx_side": "2", "my_trx_id": "4678", "my_trx_thread": "82",
                "my_trx_query": "UPDATE accounts SET balance = balance + 1 WHERE id = 12",
                "server_address": "db-7:3306",
            }),
            // The verdict rides its OWN record — the one whose loss left every
            // MySQL participant unflagged and the "cancelled by the database"
            // panel blank.
            json!({
                "_timestamp": 1_786_166_303_139_966i64, "o2_my_event": "deadlock",
                "my_victim_side": "2", "server_address": "db-7:3306",
            }),
        ];
        let events: Vec<_> = rows.iter().filter_map(deadlock_event_for_row).collect();
        assert_eq!(events.len(), 3, "three raw records before the stitch");

        let stitched = stitch_mysql_deadlocks(events);
        assert_eq!(
            stitched.len(),
            1,
            "three records are ONE deadlock — without the stitch the tab shows a \
             deadlock per side and splits the sides into different shape groups"
        );
        let ev = &stitched[0];
        assert_eq!(ev.participants.len(), 2);
        let victim: Vec<i64> = ev
            .participants
            .iter()
            .filter(|p| p.victim)
            .filter_map(|p| p.pid)
            .collect();
        assert_eq!(
            victim,
            vec![82],
            "the verdict names side 2, so thread 82 is the victim — resolved in the \
             stitcher's deferred post-pass, not on any single record"
        );
        assert_eq!(ev.victim_pid, Some(82));
    }

    /// A raw PG DETAIL row is self-contained: ONE event, both participants, and
    /// the stitcher must leave it alone.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_raw_pg_detail_row_yields_one_two_participant_event_unstitched() {
        let rows = vec![
            // banner — dropped
            json!({
                "_timestamp": 1_786_843_262_880_000i64, "o2_pg_event": "deadlock",
                "pg_pid": "1071", "o2_deadlock_raw": "deadlock detected",
            }),
            // DETAIL — the whole wait cycle
            json!({
                "_timestamp": 1_786_843_262_880_000i64, "o2_pg_event": "deadlock",
                "deadlock_victim_pid": "1071",
                "dl_waiter_pid": "1071", "dl_waiter2_pid": "1072",
                "dl_query_1": "UPDATE accounts SET balance = balance - 1 WHERE id = 2",
                "dl_query_2": "UPDATE accounts SET balance = balance - 1 WHERE id = 1",
                "pg_db": "dbmlab",
            }),
        ];
        let events: Vec<_> = rows.iter().filter_map(deadlock_event_for_row).collect();
        assert_eq!(events.len(), 1, "the banner is dropped, the DETAIL is kept");

        let stitched = stitch_mysql_deadlocks(events);
        assert_eq!(stitched.len(), 1);
        assert_eq!(
            stitched[0].participants.len(),
            2,
            "PG carries the whole cycle on one entry — merging two of them would \
             invent a 4-way cycle"
        );
        assert_eq!(stitched[0].engine.as_deref(), Some("postgresql"));
    }

    // ── The Rust-side scope narrowing (§4.3) ────────────────────────────────

    /// A raw-derived event must SURVIVE a scope filter that matches it.
    ///
    /// This is the gap the design flags: raw rows have no `o2_dbm_*` scope
    /// column at all (measured, 0 non-null of 137), so pushing `?system=` to SQL
    /// drops every one of them — the page looks right with no filter and
    /// under-reports with one. Narrowing in Rust, after canonicalization, uses
    /// the engine the canonicalizer derived.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_scope_narrowing_keeps_raw_events_that_match() {
        let ev = deadlock_event_for_row(&json!({
            "_timestamp": 1i64, "o2_my_event": "deadlock",
            "my_trx_side": "1", "my_trx_thread": "89", "my_trx_query": "SELECT 1",
            "server_address": "db-7.internal:3306", "my_db": "shop",
        }))
        .expect("event");

        let by_engine = ScopeNarrowing {
            system: Some("mysql".into()),
            instance: None,
            database: None,
        };
        assert!(
            by_engine.matches(&ev),
            "the engine was DERIVED by the canonicalizer, so ?system=mysql must \
             still find this event"
        );
        assert!(
            ScopeNarrowing {
                system: None,
                instance: Some("db-7.internal".into()),
                database: None
            }
            .matches(&ev),
            "the instance is port-stripped by detect_instance and must match that form"
        );
        assert!(
            ScopeNarrowing {
                system: None,
                instance: None,
                database: Some("shop".into())
            }
            .matches(&ev)
        );
    }

    /// ...and it must EXCLUDE what does not match, or the filter is decorative.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_scope_narrowing_excludes_events_that_do_not_match() {
        let ev = deadlock_event_for_row(&json!({
            "_timestamp": 1i64, "o2_my_event": "deadlock",
            "my_trx_side": "1", "my_trx_thread": "89", "my_trx_query": "SELECT 1",
            "server_address": "db-7.internal:3306", "my_db": "shop",
        }))
        .expect("event");

        for narrowing in [
            ScopeNarrowing {
                system: Some("postgresql".into()),
                instance: None,
                database: None,
            },
            ScopeNarrowing {
                system: None,
                instance: Some("other-host".into()),
                database: None,
            },
            ScopeNarrowing {
                system: None,
                instance: None,
                database: Some("billing".into()),
            },
        ] {
            assert!(
                !narrowing.matches(&ev),
                "a non-matching scope must exclude the event, or ?system= does nothing"
            );
        }
    }

    /// An event whose field is UNKNOWN is excluded by a filter on that field.
    ///
    /// House rule (`plan_row_to_dto`): an absent field defaults to the WEAKER
    /// claim. "We do not know which engine this is" is not evidence that it is
    /// the one asked for — and the SQL predicate it replaces would likewise not
    /// match a NULL column, so this keeps the filtered and unfiltered paths
    /// answering the same question.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_scope_narrowing_excludes_an_event_with_an_unknown_field() {
        let untagged = deadlock_event_for_row(&json!({
            "_timestamp": 1i64, "o2_my_event": "deadlock",
            "my_trx_side": "1", "my_trx_thread": "89", "my_trx_query": "SELECT 1",
        }))
        .expect("event");
        assert!(untagged.instance.is_none(), "the recipe tagged no instance");

        assert!(
            !ScopeNarrowing {
                system: None,
                instance: Some("db-7".into()),
                database: None
            }
            .matches(&untagged),
            "unknown is not a match — `AND o2_dbm_instance = 'db-7'` would not \
             match a NULL either"
        );
        // ...but a filter on a field it DOES have still works.
        assert!(
            ScopeNarrowing {
                system: Some("mysql".into()),
                instance: None,
                database: None
            }
            .matches(&untagged)
        );
    }

    /// NO filter means no narrowing — every event survives.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_an_empty_scope_narrowing_keeps_everything() {
        let ev = deadlock_event_for_row(&json!({
            "_timestamp": 1i64, "o2_my_event": "deadlock",
            "my_trx_side": "1", "my_trx_thread": "89", "my_trx_query": "SELECT 1",
        }))
        .expect("event");
        assert!(
            ScopeNarrowing {
                system: None,
                instance: None,
                database: None
            }
            .matches(&ev)
        );
        // An EMPTY STRING is not a filter either — the SQL side already treats
        // it that way (`dbm_event_preds` filters on `!s.is_empty()`), and the two
        // must agree or the same request narrows differently depending on which
        // path serves it.
        assert!(
            ScopeNarrowing {
                system: Some(String::new()),
                instance: Some(String::new()),
                database: Some(String::new()),
            }
            .matches(&ev)
        );
    }

    /// The Rust narrowing and the SQL predicate must answer the SAME question.
    ///
    /// The canonical path keeps its SQL predicates when the fallback is off, and
    /// moves to the Rust filter when it is on. If the two disagree, the same
    /// request returns different rows depending on a kill-switch — so the
    /// narrowing is checked against a canonical event built the way a
    /// SQL-filtered row would be.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_rust_narrowing_agrees_with_the_sql_predicate_on_canonical_events() {
        let canonical = deadlock_event_for_row(&json!({
            "_timestamp": 1i64,
            server_vantage::O2_DBM_KIND: "deadlock",
            server_vantage::O2_DBM_ENGINE: "postgresql",
            server_vantage::O2_DBM_INSTANCE: "db-1",
            server_vantage::O2_DBM_DATABASE: "dbmlab",
        }))
        .expect("event");

        // The SQL form of the same three filters, for the record.
        let preds = dbm_event_preds(Some("postgresql"), Some("db-1"), Some("dbmlab"));
        assert!(preds.contains("o2_dbm_engine = 'postgresql'"));

        assert!(
            ScopeNarrowing {
                system: Some("postgresql".into()),
                instance: Some("db-1".into()),
                database: Some("dbmlab".into()),
            }
            .matches(&canonical),
            "what the SQL predicate would have kept, the Rust narrowing must keep"
        );
        assert!(
            !ScopeNarrowing {
                system: Some("mysql".into()),
                instance: None,
                database: None
            }
            .matches(&canonical),
            "and what it would have dropped, the Rust narrowing must drop"
        );
    }

    /// THE A1.1 REGRESSION GUARD: the deadlocks read must CONSULT the boundary,
    /// not merely have one available.
    ///
    /// This is the A1.1 analogue of the scope-predicate guard below, and it was
    /// written because the corresponding mutation **survived**: replacing the
    /// whole boundary branch with a bare `Some(RawDeadlockFallback { present })`
    /// restores the always-on behaviour this change exists to remove, and every
    /// one of the nine behavioural tests above still passes — because they all
    /// exercise the pure decision function, and the pure function is still
    /// perfect. The defect lives in the WIRING, so the guard has to.
    ///
    /// What always-on costs, and why it is worth a structural test: every
    /// deadlocks read on a fully-canonicalized deployment widens its projection
    /// by up to ~50 raw columns, ORs four marker terms into the `WHERE`, moves
    /// the scope filters out of SQL so they stop narrowing before the `LIMIT`,
    /// and dispatches every row through the canonicalizer. Silently — nothing
    /// errors, the page is correct, and it stays that way forever.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_deadlocks_read_consults_the_boundary_before_widening() {
        let src = include_str!("api.rs");
        let code = &src[..src.find("\n#[cfg(test)]\nmod tests").unwrap_or(src.len())];

        let body_at = code
            .find("async fn read_deadlocks_body")
            .or_else(|| code.find("fn read_deadlocks_body"))
            .expect("the deadlocks body must exist");
        let body = &code[body_at..];
        let body = &body[..body.find("\n}\n").unwrap_or(body.len())];

        // The binding that decides whether the widening happens at all.
        let bind_at = body
            .find("let raw_fallback =")
            .expect("`raw_fallback` must be bound in the deadlocks body");
        let bind = &body[bind_at..];
        let bind = &bind[..bind.find("\n    };").map(|i| i + 6).unwrap_or(bind.len())];

        assert!(
            bind.contains("deadlock_window_needs_fallback("),
            "`raw_fallback` must be gated on the boundary probe — without it the \
             fallback is always-on again, which is the state A1.1 exists to \
             end:\n{bind}"
        );
        // ...and the gate must be able to answer NO. A call whose result is
        // discarded reads as wired but is not.
        assert!(
            bind.contains("None"),
            "the boundary gate must have a `None` arm, or it can never turn the \
             widening off and the probe is pure cost:\n{bind}"
        );
        // The kill-switch must still short-circuit BEFORE the probe, so turning
        // it off costs nothing rather than costing two extra searches.
        let switch_at = bind
            .find("deadlock_read_fallback")
            .expect("the kill-switch must still gate the whole branch");
        let probe_at = bind
            .find("deadlock_window_needs_fallback(")
            .expect("checked above");
        assert!(
            switch_at < probe_at,
            "the kill-switch must be tested BEFORE the boundary probe runs, or \
             `=false` still pays for two searches per read:\n{bind}"
        );
    }

    /// THE §4.3 REGRESSION GUARD: scope predicates must NOT reach the SQL while
    /// the fallback is active.
    ///
    /// This is the single most dangerous mutation in A1 and the one every
    /// behavioural test above misses. `dbm_event_preds` names
    /// `o2_dbm_engine`/`o2_dbm_instance`/`o2_dbm_database`, and a RAW row has
    /// none of them — measured, 0 non-null of 137. So appending them to the
    /// widened `WHERE` silently drops EVERY raw row: the page looks correct with
    /// no filter and under-reports with one, which is the worst shape a bug can
    /// take because nothing errors and the wrong answer is plausible.
    ///
    /// Pinned STRUCTURALLY, in the spirit of
    /// `test_no_caller_swallows_a_schema_read_error`, because the failure lives
    /// in the handler's wiring rather than in any pure function: reverting
    /// `sql_preds` to `&preds` passes every other test in this file while
    /// restoring the bug exactly. Verified by doing precisely that.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_scope_predicates_never_reach_the_sql_while_the_fallback_is_active() {
        let src = include_str!("api.rs");
        let code = &src[..src.find("\n#[cfg(test)]\nmod tests").unwrap_or(src.len())];

        // The deadlocks call site, discovered from its kind argument.
        let at = code
            .find("build_dbm_events_sql(\n        stream,\n        server_vantage::KIND_DEADLOCK,")
            .expect("the deadlocks call site must exist");
        let site = &code[at..at + code[at..].find(");").expect("closed") + 2];

        assert!(
            !site.contains("&preds,"),
            "the deadlocks read must NOT pass the raw scope predicates straight \
             through — with the fallback active they name canonical columns a raw \
             row does not have, and every raw row is silently dropped:\n{site}"
        );
        assert!(
            site.contains("sql_preds,"),
            "it must pass the fallback-aware predicate string:\n{site}"
        );

        // ...and that string must actually be emptied when the fallback is on.
        // Asserted on the binding rather than on a substring of the file, so a
        // renamed-but-still-wrong version cannot pass.
        let bind = code
            .find("let sql_preds =")
            .map(|i| &code[i..i + code[i..].find(';').expect("statement ends") + 1])
            .expect("sql_preds must be bound");
        assert!(
            bind.contains("raw_fallback.is_some()") && bind.contains("\"\""),
            "`sql_preds` must be EMPTY when the fallback is active — that is what \
             moves the narrowing to Rust:\n{bind}"
        );

        // The other half of the same contract: having removed the SQL narrowing,
        // the handler MUST apply the Rust one, or the filter silently stops
        // working altogether.
        let body_at = code
            .find("async fn read_deadlocks_body")
            .or_else(|| code.find("fn read_deadlocks_body"))
            .expect("the deadlocks body must exist");
        let body = &code[body_at..];
        let body = &body[..body.find("\n}\n").unwrap_or(body.len())];
        assert!(
            body.contains("scope.matches("),
            "with the SQL predicates removed the handler must narrow in Rust, or \
             ?system= / ?instance= / ?database= stop filtering entirely"
        );
        assert!(
            body.contains("raw_fallback.is_some()"),
            "the Rust narrowing runs exactly where the SQL one did not"
        );
    }

    /// WHY the error must not be flattened, half one: BLOCKING.
    ///
    /// With an empty column set the projection drops both pid columns, and
    /// `BlockingSample::from_record` requires both — so every row is filtered
    /// out, `hits` is empty, the liveness probe runs and the page reports
    /// `not_collecting: true`. That tells the operator their collector is broken
    /// when only a schema read blipped, which is exactly the false alarm the
    /// design note above `LIVENESS_PROBE_MICROS` says must never be raised.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_empty_columns_would_silently_drop_every_blocking_row() {
        let sql = build_dbm_events_sql(
            "dbm_server",
            "blocking",
            100,
            200,
            "",
            50,
            &proj(&HashSet::new(), None),
        );
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
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_empty_columns_would_yield_content_free_deadlock_events() {
        let sql = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            "",
            50,
            &proj(&HashSet::new(), None),
        );
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
        let sql = build_dbm_events_sql(
            "dbm_server",
            "deadlock",
            100,
            200,
            "",
            50,
            &proj(&all_cols(), None),
        );
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

        let sql = build_dbm_events_sql(
            "ev\"il",
            "blocking",
            1,
            2,
            &preds,
            10,
            &proj(&all_cols(), None),
        );
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
    // ── Deadlock / blocking read path — ENTERPRISE ONLY ────────────────────
    //
    // Everything down to `test_database_param_accepts_namespace_alias`
    // exercises `deadlock_event_from_row`, `stitch_mysql_deadlocks`,
    // `rank_deadlock_shapes`, the two DTOs, the two search predicates and the
    // two query types — all gated to the enterprise build now that deadlocks
    // and blocking are Enterprise capabilities. Every fixture and assertion is
    // unchanged; only availability moved.

    // ── Deadlock read path: row → event → stitch → DTO ─────────────────────
    //
    // Every test below feeds STORED-ROW fixtures through `deadlock_event_from_row`
    // rather than building `DeadlockEvent` structs directly, so the parse of the
    // JSON-string `o2_dbm_participants` column is covered on the way through.

    /// A stored Postgres row: one record already carrying the whole cycle.
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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

    #[cfg(feature = "enterprise")]
    fn events_of(rows: &[Value]) -> Vec<server_vantage::DeadlockEvent> {
        stitch_mysql_deadlocks(rows.iter().map(deadlock_event_from_row).collect())
    }

    /// The participants column round-trips out of its JSON-string storage form.
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_rank_deadlock_shapes_skips_shapeless_rows() {
        // A deadlock whose participants had unparseable SQL has no fingerprint,
        // so no shape, and must not create a phantom empty-key group.
        let rows = vec![pg_row(1, 0, json!([{"pid": 9}]))];
        assert!(rank_deadlock_shapes(&events_of(&rows)).is_empty());
    }

    // ── GAP 2: MySQL side stitching ────────────────────────────────────────

    /// The headline case: two InnoDB entries ~150 µs apart are ONE deadlock.
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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

    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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

    #[cfg(feature = "enterprise")]
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
    #[cfg(feature = "enterprise")]
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
            &proj(&all_cols(), None),
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

    /// **A2: the OSS Activity DTO omits the five blocking fields — and keeps
    /// `wait_event`/`wait_event_type`.**
    ///
    /// Activity itself stays OSS. But `blocking_pids`, `blocked`, `lock_mode`,
    /// `lock_type` and `lock_relation` ARE the Blocked Queries capability:
    /// serving them would let an OSS user read which sessions are blocked and
    /// by whom, making "Blocked Queries is Enterprise" disprovable from the
    /// product's own UI.
    ///
    /// OMITTED, not nulled. `"blocked": false` on every row is an affirmative
    /// claim about lock state that an OSS build is not licensed to make; an
    /// absent key says "not available", which is what the frontend's
    /// `Array.isArray` guard and `showsLocks` column spread already handle —
    /// the column drops rather than rendering a row of blanks.
    ///
    /// `wait_event`/`wait_event_type` deliberately STAY: they say what a
    /// session waits ON (I/O, CPU, lock), not who blocks it. They are dual-use
    /// and removing them would gut the OSS tab while protecting nothing —
    /// which is why they are asserted PRESENT here, not merely unmentioned.
    #[cfg(not(feature = "enterprise"))]
    #[test]
    fn test_activity_dto_omits_the_blocking_fields_on_oss() {
        let mut row = activity_row(81517, "active", "Lock", "tuple");
        row[server_vantage::O2_DBM_BLOCKING_PIDS] =
            server_vantage::store_blocking_pids(&[82363, 81491]);
        row[server_vantage::O2_DBM_LOCK_MODE] = json!("ShareLock");
        row[server_vantage::O2_DBM_LOCK_TYPE] = json!("transactionid");
        row[server_vantage::O2_DBM_LOCK_RELATION] = json!("accounts");

        let dto = activity_row_to_dto(&row);
        let obj = dto.as_object().expect("dto is an object");
        for key in [
            "blocking_pids",
            "blocked",
            "lock_mode",
            "lock_type",
            "lock_relation",
        ] {
            assert!(
                !obj.contains_key(key),
                "OSS must not serve `{key}` — absent, not null: {dto}"
            );
        }
        // Present even though the stored row carries blockers: an omitted key
        // must not be achievable by emptying the row.
        assert_eq!(
            dto["wait_event"],
            json!("tuple"),
            "wait_event is dual-use and stays on OSS"
        );
        assert_eq!(
            dto["wait_event_type"],
            json!("Lock"),
            "wait_event_type is dual-use and stays on OSS"
        );
        // The rest of the tab is untouched.
        assert_eq!(dto["session_pid"], json!(81517));
        assert_eq!(dto["state"], json!("active"));
    }

    /// `blocking_pids` is stored as a scalar (X5) but is a real ARRAY on the
    /// wire — the UI must be able to render N blockers.
    ///
    /// Enterprise-only: the five blocking fields are absent from the OSS DTO
    /// (see `test_activity_dto_omits_the_blocking_fields_on_oss`), so there is
    /// no array to assert there. Gated rather than deleted — the array-shape
    /// contract still holds wherever the fields are served.
    #[cfg(feature = "enterprise")]
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

    // ── W11 · Index health read API ─────────────────────────────────────

    #[cfg(feature = "enterprise")]
    /// The newest snapshot per INDEX, keyed on the index — not the relation.
    ///
    /// Two indexes on one table share a relation, so grouping by relation alone
    /// would collapse them and silently drop one from the list.
    #[test]
    fn test_index_health_sql_groups_by_the_index_not_the_relation() {
        let sql = build_dbm_index_health_sql("dbm_server", 100, 200, "", 50, &all_cols())
            .expect("index health sql");
        assert!(
            sql.contains(&format!("GROUP BY {}", server_vantage::O2_DBM_SCHEMA)),
            "grouping must start at the schema: {sql}"
        );
        assert!(
            sql.contains(server_vantage::O2_DBM_INDEX_NAME),
            "the index name must be in the grouping key, or two indexes on one \
             table collapse into one row: {sql}"
        );
        assert!(
            sql.contains(&format!("{} = 'index_stats'", server_vantage::O2_DBM_KIND)),
            "it must read index_stats records only: {sql}"
        );
        assert!(sql.contains("LIMIT 50"));
    }

    #[cfg(feature = "enterprise")]
    /// MAX, never SUM: these are point-in-time snapshots re-emitted every 60s.
    /// Summing them multiplies an index's size by the number of samples.
    #[test]
    fn test_index_health_sql_uses_max_not_sum() {
        let sql = build_dbm_index_health_sql("dbm_server", 100, 200, "", 50, &all_cols())
            .expect("index health sql");
        assert!(
            sql.contains(&format!("MAX({})", server_vantage::O2_DBM_INDEX_BYTES)),
            "size must be MAX: {sql}"
        );
        assert!(
            !sql.to_uppercase().contains("SUM("),
            "SUM over snapshots reports an index N times its real size: {sql}"
        );
    }

    #[cfg(feature = "enterprise")]
    /// A stream that never carried index stats yields no query at all, rather
    /// than a query naming an absent column — which fails the WHOLE request.
    #[test]
    fn test_index_health_sql_is_absent_without_the_index_column() {
        let mut cols = all_cols();
        cols.remove(server_vantage::O2_DBM_INDEX_NAME);
        assert!(
            build_dbm_index_health_sql("dbm_server", 100, 200, "", 50, &cols).is_none(),
            "no index column means no query, not a schema error"
        );
    }

    #[cfg(feature = "enterprise")]
    /// Scope filters reach the aggregate, and injection is neutralized.
    #[test]
    fn test_index_health_sql_honours_scope_filters_and_escapes_them() {
        let preds = dbm_event_preds(Some("pg' OR '1'='1"), Some("pg1"), None);
        let sql = build_dbm_index_health_sql("ev\"il", 1, 2, &preds, 10, &all_cols())
            .expect("index health sql");
        assert!(sql.contains("o2_dbm_instance = 'pg1'"), "{sql}");
        assert!(
            sql.contains("'pg'' OR ''1''=''1'"),
            "values are escaped: {sql}"
        );
        assert!(sql.contains("\"ev\"\"il\""), "identifier is escaped: {sql}");
    }

    #[cfg(feature = "enterprise")]
    /// Storage names must never reach the browser, and a measured ZERO must
    /// survive as 0 rather than becoming null — it is the whole finding.
    #[test]
    fn test_index_health_dto_uses_wire_names_and_keeps_a_measured_zero() {
        let row = json!({
            "schema_name": "public",
            "relation": "orders",
            "index_name": "idx_orders_note_unused",
            "index_bytes": 2_859_008,
            "idx_scan_count": 0,
            "idx_tup_read": 0,
            "idx_tup_fetch": 0,
            "instance": "pg-primary:5432",
            "engine": "postgresql",
            "last_seen": 1_786_505_777_063_921i64,
        });
        let dto = index_health_row_to_dto(&row);

        assert_eq!(dto["index_name"], json!("idx_orders_note_unused"));
        assert_eq!(dto["relation"], json!("orders"));
        assert_eq!(dto["schema"], json!("public"));
        assert_eq!(
            dto["idx_scan_count"],
            json!(0),
            "a measured zero is the never-scanned FINDING and must not become null"
        );
        assert_eq!(dto["index_bytes"], json!(2_859_008));
        let rendered = dto.to_string();
        assert!(
            !rendered.contains("o2_dbm_"),
            "no storage name may reach the browser: {rendered}"
        );
    }

    #[cfg(feature = "enterprise")]
    /// The DTO must also read the CANONICALIZER's own output, closing the
    /// write/read loop — a DTO that only understood the SQL aliases could not
    /// be fed what ingest actually wrote, which is how a name split hides.
    #[test]
    fn test_index_health_dto_reads_canonicalizer_output() {
        let rec = server_vantage::canonicalize_index_stats(
            &json!({
                "o2_recipe": "pg_index_stats",
                "index_name": "demo_orders_status_idx",
                "table_name": "demo_orders",
                "schema_name": "public",
                "idx_scan": "44916",
                "idx_tup_read": "2937877460",
                "idx_tup_fetch": "2222646612",
                "index_bytes": "2301952",
            })
            .as_object()
            .unwrap()
            .clone(),
        )
        .expect("canonicalizes")
        .to_record();
        let row = Value::Object(rec.into_iter().collect());

        let dto = index_health_row_to_dto(&row);
        assert_eq!(dto["index_name"], json!("demo_orders_status_idx"));
        assert_eq!(dto["relation"], json!("demo_orders"));
        assert_eq!(dto["idx_scan_count"], json!(44916));
        assert_eq!(
            dto["idx_tup_read"],
            json!(2_937_877_460i64),
            "counters exceed i32 on real data"
        );
    }

    #[cfg(feature = "enterprise")]
    /// Index health is collected for the three engines with index-stats
    /// recipes, and the envelope must say so per engine — an empty list for an
    /// unsupported engine's user reads as "no problems found".
    #[test]
    fn test_index_health_engine_support_names_the_recipe_engines() {
        for supported in ["postgresql", "mysql", "mariadb"] {
            assert_eq!(
                index_health_engine_support(supported),
                "supported",
                "`{supported}` ships an index-stats recipe"
            );
        }
        assert_eq!(
            index_health_engine_support("mssql"),
            "unsupported",
            "no mssql index-stats recipe ships yet"
        );
        assert_eq!(
            index_health_engine_support(""),
            "unknown",
            "an unfiltered request spans every engine, so no single verdict is true"
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
        // The blocking relationship is the Blocked Queries capability, so only
        // an enterprise build serves it. The round-trip itself — writer output
        // in, wire DTO out — is what this test exists for and stays OSS.
        #[cfg(feature = "enterprise")]
        {
            assert_eq!(dto["blocking_pids"], json!([82334]));
            assert_eq!(dto["blocked"], json!(true));
        }
        #[cfg(not(feature = "enterprise"))]
        {
            let obj = dto.as_object().expect("dto is an object");
            assert!(
                !obj.contains_key("blocking_pids") && !obj.contains_key("blocked"),
                "OSS must not serve the blocking relationship even when the \
                 written row carries it: {dto}"
            );
        }
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
    /// Asserted on the real JSON: [`activity_envelope`] is the pure shape
    /// assembly the endpoint itself calls, so the keys are proven on the wire
    /// value rather than scraped out of the handler's source text. The FULL
    /// standalone envelope, never [`activity_badge_envelope`] — the badge
    /// member deliberately drops most of this contract.
    #[test]
    fn test_activity_response_carries_every_contract_key() {
        let probe = CollectionProbe {
            records_seen: 12,
            non_event_records: 4,
            newest_record: Some(1_700_000_000_000_000),
            kind_sample_times: vec![
                1_700_000_020_000_000,
                1_700_000_010_000_000,
                1_700_000_000_000_000,
            ],
            ..Default::default()
        };
        let hits = vec![json!({"query": "SELECT 1"})];
        let env = activity_envelope(
            &hits,
            &[json!({"wait_event": "Lock", "count": 3i64})],
            &[json!({"state": "active", "count": 2i64})],
            true,
            "dbm_server",
            &probe,
        );
        let body = env.as_object().expect("the envelope is a JSON object");

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
                body.contains_key(key),
                "the activity response must carry `{key}` (spec W2.3 response shape)"
            );
        }

        // `truncated` comes from the ROW query, independently of the aggregates.
        // Setting it from the aggregate — which has no LIMIT and so is never
        // truncated — would report a capped 1000-row sample as complete.
        assert_eq!(
            body.get("truncated"),
            Some(&json!(true)),
            "the activity response must report whether the ROW sample was capped"
        );
        // The three load-bearing keys must carry VALUES, not just exist: a
        // null `sample_interval_seconds` on a probe with three evenly spaced
        // samples would drop the sampling disclosure silently.
        assert_eq!(
            body.get("sample_interval_seconds"),
            Some(&json!(10i64)),
            "the sampling disclosure must be computed, not nulled"
        );
        assert_eq!(body.get("log_lines_seen"), Some(&json!(4i64)));
        assert_eq!(
            body.get("sampled_sessions"),
            Some(&json!(true)),
            "the page renders a SAMPLE of sessions and must say so"
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
        assert_gates_on_vantage("read_activity_body", DbmVantage::Server);
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
            .find("async fn read_activity_body")
            .expect("the activity body fn must exist");
        let body = code[start..]
            .split("\n}\n")
            .next()
            .expect("the body fn must have a body");

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
        let silent = CollectionProbe::default();
        let alive = CollectionProbe {
            records_seen: 9,
            ..Default::default()
        };
        let session = vec![json!({"query": "SELECT 1"})];
        let flag = |hits: &[Value], probe: &CollectionProbe| {
            activity_envelope(hits, &[], &[], false, "dbm_server", probe)["not_collecting"].clone()
        };

        // The only true case: nothing on the page AND no evidence of life.
        assert_eq!(flag(&[], &silent), json!(true));
        // Each half alone must NOT trip it. The second of these is the one a
        // `&& → ||` mutation breaks: a probe read blip (swallowed into an empty
        // row set by design) would announce a broken collector WHILE RENDERING
        // SESSIONS.
        assert_eq!(
            flag(&[], &alive),
            json!(false),
            "records prove the pipe carries traffic — an empty page alone is not a broken collector"
        );
        assert_eq!(
            flag(&session, &silent),
            json!(false),
            "not_collecting must require BOTH an empty page AND a silent probe: a \
             failed probe read alone would otherwise report a healthy collector \
             as broken while the table shows sessions"
        );
        assert_eq!(flag(&session, &alive), json!(false));
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
                "{} IN ('{}', '{}')",
                server_vantage::O2_DBM_KIND,
                server_vantage::KIND_TOP_QUERY,
                server_vantage::KIND_EXPLAIN
            )),
            "the plans query must read BOTH producers' kinds — top_query \
             (generic) and explain (executed) — and nothing else: {sql}"
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

    /// **D-H: no pg_stat_statements latency by plan, in the SQL or anywhere
    /// else.**
    ///
    /// The generic plan was never executed — the receiver EXPLAINs it with
    /// every bind parameter bound to NULL — while `o2_dbm_exec_time_s` comes
    /// from `pg_stat_statements` REAL executions. Grouping one by the other
    /// fabricates causality, and an earlier draft shipped exactly that as
    /// "the plan that appeared at 03:04 is 8x slower".
    ///
    /// **The ban is NARROWED, not lifted, for W-E3**: `o2_dbm_plan_duration_ms`
    /// is a per-execution wall clock measured by auto_explain on an execution
    /// that really ran under that plan, so aggregating IT by plan is honest.
    /// The banned literal is therefore the exec-time family (`AVG(o2_dbm_exec`)
    /// rather than every `AVG(` — while the `O2_DBM_EXEC_TIME_S` ban stays
    /// absolute, so no projection, predicate or alias can smuggle the
    /// pg_stat_statements column in under any aggregate.
    #[test]
    fn test_plans_sql_never_aggregates_pgss_latency_by_plan() {
        let sql =
            build_dbm_plans_sql("dbm_server", "fp", 100, 200, "", &all_cols()).expect("plans sql");
        assert!(
            !sql.contains(server_vantage::O2_DBM_EXEC_TIME_S),
            "per-plan pg_stat_statements latency attributes execution time to a \
             plan that never ran (D-H): {sql}"
        );
        for banned in [
            "AVG(o2_dbm_exec",
            "MAX(o2_dbm_exec",
            "SUM(o2_dbm_exec",
            "PERCENTILE",
        ] {
            assert!(
                !sql.contains(banned),
                "`{banned}` in the plans query is latency attribution (D-H): {sql}"
            );
        }
        // The complement, so the narrowing cannot rot into a lift: the ONLY
        // duration the query may aggregate is the per-execution auto_explain
        // measurement.
        for (i, _) in sql.match_indices("AVG(") {
            let rest = &sql[i..];
            assert!(
                rest.starts_with(&format!("AVG({}", server_vantage::O2_DBM_PLAN_DURATION_MS)),
                "every AVG in the plans query must aggregate the executed \
                 per-plan duration and nothing else: {sql}"
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
    /// is not an all-clear. Asserted on the real JSON: [`plans_envelope`] is
    /// the pure shape assembly `get_dbm_query_plans` itself calls.
    #[test]
    fn test_plans_response_carries_every_contract_key() {
        let hits = vec![
            json!({"plan_hash": "a", "plan_source": "generic_null_bound"}),
            json!({"plan_hash": "b", "plan_source": "generic_null_bound"}),
        ];
        let env = plans_envelope(&hits, "dbm_server", "on", true);
        let body = env.as_object().expect("the envelope is a JSON object");

        for key in [
            "hits",
            "plan_source",
            "drift_detected",
            "stream",
            "plan_capture",
        ] {
            assert!(
                body.contains_key(key),
                "the plans response must carry `{key}`"
            );
        }
        assert_eq!(body.get("plan_capture"), Some(&json!("on")));
        assert_eq!(body.get("explain_enabled"), Some(&json!(true)));
        // Two distinct plans in the window: structural drift, and its absence
        // is not evidence that no regression occurred.
        assert_eq!(body.get("drift_detected"), Some(&json!(true)));

        // EXTENDED for W-E3, never relaxed: the response-level source is
        // DERIVED per window rather than hardcoded — a hardcoded value would
        // mislabel every executed plan (or, worse, every generic one). A
        // constant `generic_null_bound` passes the all-generic case above, so
        // the executed and mixed windows are what pin it.
        assert_eq!(body.get("plan_source"), Some(&json!("generic_null_bound")));
        let executed = json!({"plan_hash": "a", "plan_source": "auto_explain"});
        assert_eq!(
            plans_envelope(std::slice::from_ref(&executed), "dbm_server", "on", true)["plan_source"],
            json!("auto_explain"),
            "hardcoding generic_null_bound at the response level mislabels every \
             executed plan in the window (E-C)"
        );
        assert_eq!(
            plans_envelope(
                &[executed, json!({"plan_source": "generic_null_bound"})],
                "dbm_server",
                "on",
                true
            )["plan_source"],
            json!("mixed"),
            "a window holding both producers is `mixed` and neither single label is honest"
        );
    }

    /// The derivation itself: all-generic, all-executed, mixed, and the empty
    /// window defaulting to the WEAKER claim.
    #[test]
    fn test_derived_plan_source_covers_all_three_states() {
        let generic = json!({"plan_source": "generic_null_bound"});
        let executed = json!({"plan_source": "auto_explain"});
        let legacy = json!({}); // pre-column row: backfilled generic by the DTO
        assert_eq!(derived_plan_source(&[]), "generic_null_bound");
        assert_eq!(
            derived_plan_source(&[generic.clone(), legacy.clone()]),
            "generic_null_bound"
        );
        assert_eq!(
            derived_plan_source(std::slice::from_ref(&executed)),
            "auto_explain"
        );
        assert_eq!(derived_plan_source(&[executed, generic]), "mixed");
    }

    /// **E-C at the SQL layer**: provenance joins the GROUP key when the stream
    /// has the column — the two producers can yield the SAME structural hash
    /// (that equality is the entire comparison story, proven on rig captures),
    /// and grouping by hash alone would collapse an executed group into a
    /// generic one. A stream that predates the column groups by hash alone —
    /// naming an absent column in GROUP BY fails the whole query.
    #[test]
    fn test_plans_sql_groups_by_plan_source_only_when_present() {
        let sql =
            build_dbm_plans_sql("dbm_server", "fp", 100, 200, "", &all_cols()).expect("plans sql");
        assert!(
            sql.contains(&format!(
                "GROUP BY {}, {}",
                server_vantage::O2_DBM_PLAN_HASH,
                server_vantage::O2_DBM_PLAN_SOURCE
            )),
            "same hash + different producer must stay two rows: {sql}"
        );

        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_PLAN_SOURCE);
        without.remove(server_vantage::O2_DBM_PLAN_DURATION_MS);
        let sql = build_dbm_plans_sql("dbm_server", "fp", 100, 200, "", &without)
            .expect("the query still builds for a pre-W-E3 stream");
        assert!(
            !sql.contains(server_vantage::O2_DBM_PLAN_SOURCE),
            "an absent column must not be named anywhere in the query: {sql}"
        );
        assert!(
            !sql.contains("avg_duration_ms"),
            "no duration aggregate without the duration column: {sql}"
        );
    }

    /// **The absent-not-null invariant, at the DTO**: a duration key appears on
    /// a hit if and only if that hit is an executed plan carrying a measured
    /// duration. A null latency on a generic row would imply the column
    /// APPLIES to it — the exact framing D-H forbids.
    #[test]
    fn test_plan_dto_duration_keys_present_iff_executed_and_measured() {
        // Executed hit with measured durations: keys present, values real.
        let executed = json!({
            "plan_hash": "h1", "plan_source": "auto_explain",
            "avg_duration_ms": 1.25f64, "max_duration_ms": 30.0f64, "executions": 4i64,
        });
        let dto = plan_row_to_dto(&executed);
        assert_eq!(dto["plan_source"], json!("auto_explain"));
        assert_eq!(dto["avg_duration_ms"], json!(1.25));
        assert_eq!(dto["max_duration_ms"], json!(30.0));
        assert_eq!(dto["executions"], json!(4));

        // Generic hit — even if the search layer hands back NULL aggregate
        // values for the group, the keys must be ABSENT, not null.
        let generic = json!({
            "plan_hash": "h2", "plan_source": "generic_null_bound",
            "avg_duration_ms": Value::Null, "max_duration_ms": Value::Null,
        });
        let dto = plan_row_to_dto(&generic);
        for key in ["avg_duration_ms", "max_duration_ms", "executions"] {
            assert!(
                dto.get(key).is_none(),
                "`{key}` must be ABSENT on a generic hit — null implies the column applies: {dto}"
            );
        }

        // Adversarial: a generic group that somehow carries numbers (a future
        // SQL regression) must STILL not leak them — the gate is plan_source,
        // not value presence.
        let leaky = json!({
            "plan_hash": "h3", "plan_source": "generic_null_bound",
            "avg_duration_ms": 9.0f64,
        });
        assert!(
            plan_row_to_dto(&leaky).get("avg_duration_ms").is_none(),
            "a generic hit must never carry a duration, whatever the row says"
        );
    }

    /// **The backfill posture (E-C)**: absent `plan_source` ⇒ generic. Rows
    /// written before the column existed are, with certainty, generic — nothing
    /// else could have written them — and defaulting the other way would
    /// silently upgrade history to a claim it cannot support.
    #[test]
    fn test_plan_dto_backfills_absent_plan_source_as_generic() {
        let legacy = json!({ "plan_hash": "h", "calls": 1i64 });
        let dto = plan_row_to_dto(&legacy);
        assert_eq!(
            dto["plan_source"],
            json!("generic_null_bound"),
            "absent provenance must read as the WEAKER claim"
        );
        let empty = json!({ "plan_hash": "h", "plan_source": "" });
        assert_eq!(
            plan_row_to_dto(&empty)["plan_source"],
            json!("generic_null_bound"),
            "an empty-string source is absent, not a third state"
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
        // The gate lives in the body fn, which both the endpoint and
        // `/query/insights` call — one gate, asserted where it is.
        assert_gates_on_vantage("read_plans_body", DbmVantage::Server);
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
            .find("async fn read_plans_body")
            .expect("the plans body fn must exist");
        let body = code[start..].split("\n}\n").next().expect("body");
        // Guard: prove the scrape landed on the real body fn, not a wrapper or
        // a doc-comment tail. Without this the assertions below can all pass
        // against someone else's function.
        assert!(
            body.len() > 500 && body.contains("build_dbm_plans_sql("),
            "scraped the wrong function — read_plans_body must be found and be \
             the fn that builds the plans query"
        );

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
        assert_gate_precedes_range("read_plans_body");
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
            Some("shop"),
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
            Some("shop"),
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

    /// mysql/mariadb top_query records carry no database column, so a
    /// database predicate against them matches nothing forever — the caller
    /// passes `None` and the SQL must not constrain on database at all.
    /// (Verified live: 43k MySQL records, zero matches with the predicate.)
    #[test]
    fn test_server_metrics_sql_omits_database_predicate_when_none() {
        let sql =
            build_dbm_server_metrics_sql("dbm_server", "mysql", None, "fp", 100, 200, &all_cols())
                .unwrap();
        assert!(!sql.contains(server_vantage::O2_DBM_DATABASE));
        // The identity predicates survive: this is a narrower match, not a
        // broader one.
        assert!(sql.contains("o2_dbm_fingerprint = 'fp'"));
        assert!(sql.contains("o2_dbm_engine = 'mysql'"));
    }

    /// The envelope states WHOSE numbers these are: one database's, or the
    /// whole instance's. Without the flag a database-less MySQL match would
    /// read as per-database figures — a claim the data cannot support.
    #[test]
    fn test_server_metrics_envelope_states_attribution() {
        let rows = vec![json!({"instance": "mysql", "calls": 5})];
        let instance_wide = server_metrics_envelope(&rows, "mysql", "dbm_server", "on", false);
        assert_eq!(instance_wide["attribution"], "instance");
        let scoped = server_metrics_envelope(&rows, "postgresql", "dbm_server", "on", true);
        assert_eq!(scoped["attribution"], "database");
    }

    /// Only `top_query` records carry these counters.
    #[test]
    fn test_server_metrics_sql_reads_only_top_query_records() {
        let sql = build_dbm_server_metrics_sql(
            "dbm_server",
            "postgresql",
            Some("shop"),
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
                Some("shop"),
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
                Some("shop"),
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
                Some("shop"),
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
        let env = server_metrics_envelope(&rows, "postgresql", "dbm_server", "on", true);

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
        let unmatched = server_metrics_envelope(&[], "postgresql", "dbm_server", "on", true);
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

        let off = server_metrics_envelope(&[], "postgresql", "dbm_server", "off", true);
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
        let env = server_metrics_envelope(&rows, "postgresql", "dbm_server", "on", true);

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

        let pg = server_metrics_envelope(&rows, "postgresql", "dbm_server", "on", true);
        assert_eq!(pg["exec_time_kind"], json!("execution"));

        let mysql = server_metrics_envelope(&rows, "mysql", "dbm_server", "on", false);
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
        let env = server_metrics_envelope(&rows, "postgresql", "dbm_server", "on", true);
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
        // The gate lives in the body fn, which both the endpoint and
        // `/query/insights` call.
        assert_gates_on_vantage("read_server_metrics_body", DbmVantage::Server);
        assert_gate_precedes_range("read_server_metrics_body");
    }

    // ── W10 · Table health read API ─────────────────────────────────────────

    #[cfg(feature = "enterprise")]
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

    #[cfg(feature = "enterprise")]
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

    #[cfg(feature = "enterprise")]
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

    #[cfg(feature = "enterprise")]
    /// Injection-safe, like every other builder here.
    #[test]
    fn test_table_health_sql_escapes_its_inputs() {
        let preds = dbm_event_preds(Some("pg' OR '1'='1"), None, None);
        let sql = build_dbm_table_health_sql("ev\"il", 1, 2, &preds, 10, &all_cols())
            .expect("table health sql");
        assert!(sql.contains("'pg'' OR ''1''=''1'"));
        assert!(sql.contains("\"ev\"\"il\""));
    }

    #[cfg(feature = "enterprise")]
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

    #[cfg(feature = "enterprise")]
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

    #[cfg(feature = "enterprise")]
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

    #[cfg(feature = "enterprise")]
    /// **The cumulative/estimated disclosure must reach the WIRE.**
    ///
    /// The ingest side marks every row, but the UI reads the RESPONSE, not the
    /// stored row. Without these on the envelope the page is free to render
    /// "0 sequential scans" under an hour filter — a per-window claim the data
    /// does not support — and "137,268 rows" as an exact count.
    #[test]
    fn test_table_health_response_declares_cumulative_and_estimated() {
        // Asserted on the real JSON: [`table_health_envelope`] is the pure
        // shape assembly the body fn itself calls.
        let hits = vec![json!({"relation": "orders", "total_bytes": 1000i64})];
        let env = table_health_envelope(&hits, "dbm_server", "postgresql", None);
        let body = env.as_object().expect("the envelope is a JSON object");

        for key in ["counters_are_cumulative", "tuples_are_estimated"] {
            assert_eq!(
                body.get(key),
                Some(&json!(true)),
                "the response must carry `{key}` — the UI cannot phrase the \
                 disclosure correctly unless the API states it"
            );
        }
        for key in ["hits", "stream", "engine_coverage"] {
            assert!(
                body.contains_key(key),
                "the table-health response must carry `{key}`"
            );
        }
        assert_eq!(body.get("engine_coverage"), Some(&json!("supported")));

        // The index section rides the same envelope when asked for, and carries
        // its own cumulative disclosure plus the read-failed flag — an empty
        // index list must not be able to wear "we could not read" as a costume.
        let with_indexes =
            table_health_envelope(&hits, "dbm_server", "postgresql", Some((&[], true)));
        for key in [
            "index_hits",
            "index_total",
            "index_counters_are_cumulative",
            "index_engine_coverage",
            "index_read_failed",
        ] {
            assert!(
                with_indexes.get(key).is_some(),
                "the index section must carry `{key}`"
            );
        }
        assert_eq!(with_indexes["index_read_failed"], json!(true));
        // Absent by default: a caller that did not ask for indexes must not be
        // handed an empty list it could read as "no unused indexes".
        assert!(body.get("index_hits").is_none());
    }

    #[cfg(feature = "enterprise")]
    /// **Per-engine honesty: the surface must SAY which engines collect this.**
    ///
    /// Postgres, MySQL and MariaDB all ship table-stats recipes; SQL Server
    /// has no equivalent in this recipe set. A user filtering to an engine with
    /// no recipe must be told the signal is not collected for their engine — an
    /// empty table with no explanation reads as "no problems found", which is
    /// the single most dangerous empty state this feature can render.
    #[test]
    fn test_table_health_reports_engine_support_rather_than_an_empty_table() {
        for supported in ["postgresql", "mysql", "mariadb"] {
            assert_eq!(
                table_health_engine_support(supported),
                "supported",
                "`{supported}` ships a table-stats recipe"
            );
        }
        for unsupported in ["mssql", "oracle"] {
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
        assert_gates_on_vantage("read_table_health_body", DbmVantage::Server);
        // The permission check must precede the range parsing, so a caller
        // cannot probe stream existence through error-message differences.
        assert_gate_precedes_range("read_table_health_body");
    }

    /// The gate must run BEFORE the range parsing, or a caller distinguishes an
    /// existing stream from a missing one by whether they get a 400 or a 403.
    ///
    /// Same guard discipline as [`assert_gates_on_vantage`]: a scrape that
    /// cannot find its landmarks fails rather than passing vacuously.
    fn assert_gate_precedes_range(fn_name: &str) {
        let src = include_str!("api.rs");
        let code = src.split("\nmod tests {").next().unwrap_or(src);
        let start = code
            .find(&format!("async fn {fn_name}"))
            .unwrap_or_else(|| panic!("{fn_name} must exist"));
        let body = code[start..]
            .split("\n}\n")
            .next()
            .unwrap_or_else(|| panic!("{fn_name} must have a body"));
        assert!(
            body.len() > 300,
            "{fn_name}'s scraped body is too short to be the real function"
        );
        let perm = body
            .find("can_read_stream(")
            .unwrap_or_else(|| panic!("{fn_name} must check read permission"));
        let range = body
            .find("resolve_range(")
            .unwrap_or_else(|| panic!("{fn_name} must resolve a range"));
        assert!(
            perm < range,
            "{fn_name}'s stream permission check must run BEFORE the range parsing"
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
            .find("async fn read_table_health_body")
            .expect("body fn");
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

    /// **The table-health ROUTE stays registered unconditionally, even though
    /// the capability is enterprise-only.**
    ///
    /// The gate lives in the HANDLER BODY, which answers 403 on OSS (see
    /// `enterprise_read_endpoints_are_forbidden_on_oss`). An
    /// `#[cfg(feature = "enterprise")]` on the route registration would instead
    /// answer 404 — "no such endpoint" — and the UI would render a broken-build
    /// or wrong-URL story rather than an upgrade prompt. This is the only
    /// automated guard against someone reaching for the route-level `#[cfg]`,
    /// so the assertion stands whether or not the capability is gated: it
    /// checks the route still sits among its ungated DBM siblings.
    #[test]
    fn test_table_health_route_is_registered_ungated() {
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
    // ── Server samples (`/server_samples`) ─────────────────────────────────

    /// The SQL pin, schema-complete: BOTH per-execution duration columns
    /// present, so the duration is their COALESCE (statement first — the
    /// plainer measurement wins) and both kinds are admitted. Wire aliases
    /// only; ranked slowest-first; bounded.
    #[test]
    fn test_server_samples_sql_pins_the_projection() {
        let sql = build_dbm_server_samples_sql("dbm_server_logs", 100, 200, "", 100, &all_cols())
            .unwrap();
        let expected = "SELECT _timestamp, o2_dbm_kind AS kind, o2_dbm_fingerprint AS fingerprint, \
                        o2_dbm_activity_query AS query, COALESCE(o2_dbm_stmt_duration_ms, o2_dbm_plan_duration_ms) AS duration_ms, \
                        o2_dbm_plan_rows_actual AS rows_actual, o2_dbm_engine AS db_system, \
                        o2_dbm_database AS db_namespace, o2_dbm_instance AS db_instance, \
                        o2_dbm_session_user AS db_user, o2_dbm_session_pid AS session_pid FROM \"dbm_server_logs\"\n\
                        WHERE _timestamp >= 100 AND _timestamp < 200\n    \
                        AND o2_dbm_kind IN ('statement', 'explain')\n    \
                        AND COALESCE(o2_dbm_stmt_duration_ms, o2_dbm_plan_duration_ms) IS NOT NULL\n\
                        ORDER BY duration_ms DESC\nLIMIT 100";
        assert_eq!(sql, expected);
    }

    /// A stream carrying only ONE duration column (the normal case — the two
    /// producers land on different streams) names only that column: naming an
    /// absent one fails the whole query with a schema error.
    #[test]
    fn test_server_samples_sql_names_only_present_duration_columns() {
        let mut present = all_cols();
        present.remove(server_vantage::O2_DBM_PLAN_DURATION_MS);
        let sql = build_dbm_server_samples_sql("s", 100, 200, "", 100, &present).unwrap();
        assert!(sql.contains("o2_dbm_stmt_duration_ms AS duration_ms"));
        assert!(!sql.contains("COALESCE"));
        assert!(!sql.contains(server_vantage::O2_DBM_PLAN_DURATION_MS));
    }

    // ── `/server_queries` — the single-statement lookup (A6) ────────────────

    /// The fingerprint predicate reaches the SQL, escaped, on the fingerprint
    /// COLUMN — this is the query-detail page's only way to resolve its row on
    /// a deployment with no traced traffic, and it must narrow rather than
    /// re-rank (`ORDER BY calls` is the feed's only honest ordering).
    #[test]
    fn test_server_queries_sql_takes_a_fingerprint_predicate() {
        let present = all_cols();
        let preds = format!(
            "\n    AND {} = 'abc''123'",
            server_vantage::O2_DBM_FINGERPRINT
        );
        let sql = build_dbm_server_queries_sql("s", 100, 200, &preds, 50, &present).unwrap();
        assert!(
            sql.contains("o2_dbm_fingerprint = 'abc''123'"),
            "the quote must stay doubled or the predicate is an injection: {sql}"
        );
        // Still the grouped, calls-ranked fold — narrowing must not turn this
        // into a different question.
        assert!(sql.contains("GROUP BY") && sql.contains("ORDER BY calls DESC"));
    }

    /// Narrowing to one statement returns that statement's REAL counters —
    /// `calls`, the summed in-database time, the derived mean, and the
    /// per-engine `exec_time_kind` that says which measurement it is. These
    /// are exactly the figures the list page showed and the detail page used
    /// to lose.
    #[test]
    fn test_server_queries_envelope_carries_the_figures_the_list_showed() {
        let rows = vec![json!({
            "fingerprint": "17e5b5a191ddb2f8",
            "query": "SELECT sku, qty FROM order_lines WHERE order_id = ?",
            "db_system": "postgresql",
            "db_namespace": "dbmlab",
            "db_instance": "postgres",
            "calls": 1000i64,
            "exec_time_s": 20.0f64,
            "first_seen": 100i64,
            "last_seen": 200i64,
        })];
        let env = server_queries_envelope(&rows, "dbm_server", "on", 50);
        let hit = &env["hits"][0];

        assert_eq!(hit["fingerprint"], json!("17e5b5a191ddb2f8"));
        assert_eq!(hit["calls"], json!(1000));
        assert_eq!(hit["exec_time_s"], json!(20.0));
        assert_eq!(hit["mean_exec_time_s"], json!(0.02));
        // Postgres measures EXECUTION; MySQL measures WAIT. One generic "time"
        // label would tell a reader the database measured something it did not.
        assert_eq!(hit["exec_time_kind"], json!("execution"));
        assert!(
            hit.get("p95_ns").is_none() && hit.get("p50_ns").is_none(),
            "this feed has no percentile — a mean must never be dressed as one: {hit}"
        );
        // A one-row answer under a cap of 50 is the whole answer.
        assert_eq!(env["truncated"], json!(false));
    }

    /// A statement the server never reported comes back as an empty list with
    /// capture still `"on"` — "we looked and it is not there", which is a
    /// different sentence from "nothing is captured". The detail page renders
    /// different copy for each, so the two must not collapse.
    #[test]
    fn test_server_queries_envelope_empty_lookup_keeps_capture_state() {
        let found_nothing = server_queries_envelope(&[], "dbm_server", "on", 50);
        assert_eq!(found_nothing["total"], json!(0));
        assert_eq!(found_nothing["server_queries_capture"], json!("on"));
        assert_eq!(found_nothing["truncated"], json!(false));

        let never_captured = server_queries_envelope(&[], "dbm_server", "off", 50);
        assert_eq!(never_captured["server_queries_capture"], json!("off"));
    }

    /// A row whose engine reports WAIT time must say so — the label is the
    /// only thing distinguishing two different physical measurements sharing
    /// one field.
    #[test]
    fn test_server_queries_envelope_labels_mysql_wait_time() {
        let rows = vec![json!({
            "fingerprint": "f1",
            "db_system": "mysql",
            "calls": 10i64,
            "exec_time_s": 1.0f64,
        })];
        let env = server_queries_envelope(&rows, "dbm_server", "on", 50);
        assert_eq!(env["hits"][0]["exec_time_kind"], json!("wait"));
    }

    /// An absent exec-time column stays ABSENT: no total, and therefore no
    /// mean. A zero would claim the database measured no time at all.
    #[test]
    fn test_server_queries_envelope_absent_exec_time_is_null_not_zero() {
        let rows = vec![json!({
            "fingerprint": "f1",
            "db_system": "postgresql",
            "calls": 10i64,
            "exec_time_s": Value::Null,
        })];
        let env = server_queries_envelope(&rows, "dbm_server", "on", 50);
        assert_eq!(env["hits"][0]["exec_time_s"], Value::Null);
        assert_eq!(
            env["hits"][0]["mean_exec_time_s"],
            Value::Null,
            "no total means no mean — 0 would be a measurement nobody made"
        );
    }

    /// No per-execution duration column has ever landed → no SQL, an empty
    /// section rather than a 500. The capture state must agree — the SAME
    /// condition, reported and gated together so they cannot drift.
    #[test]
    fn test_server_samples_capture_gate_matches_the_sql_gate() {
        let mut present = all_cols();
        present.remove(server_vantage::O2_DBM_STMT_DURATION_MS);
        present.remove(server_vantage::O2_DBM_PLAN_DURATION_MS);
        assert!(build_dbm_server_samples_sql("s", 100, 200, "", 100, &present).is_none());
        assert_eq!(server_samples_capture_state(&present), "off");
        present.insert(server_vantage::O2_DBM_STMT_DURATION_MS.to_string());
        assert!(build_dbm_server_samples_sql("s", 100, 200, "", 100, &present).is_some());
        assert_eq!(server_samples_capture_state(&present), "on");
    }

    /// The envelope: per-hit fields (user and provenance included), the
    /// honesty keys, and the truncation claim over the cap.
    #[test]
    fn test_server_samples_envelope_shape() {
        let rows = vec![
            json!({
                "_timestamp": 1_786_612_398_267_000i64,
                "kind": "statement",
                "fingerprint": "abc123",
                "query": "SELECT count(*), sum(amount) FROM orders WHERE customer_ref = ?",
                "duration_ms": 63.149,
                "db_system": "postgresql",
                "db_namespace": "dbmlab",
                "db_instance": "postgres",
                "db_user": "dbm",
            }),
            json!({
                "_timestamp": 1_786_612_398_000_000i64,
                "kind": "explain",
                "fingerprint": "def456",
                "query": "SELECT owner FROM accounts WHERE id = ?",
                "duration_ms": 12.5,
                "rows_actual": 1,
                "db_system": "postgresql",
            }),
        ];
        let env = server_samples_envelope(&rows, "dbm_server,dbm_server_logs", "on", 100);
        assert_eq!(env["total"], json!(2));
        assert_eq!(env["truncated"], json!(false));
        assert_eq!(env["server_samples_capture"], json!("on"));
        // Threshold-filtered is UNCONDITIONAL: both producers are gated by the
        // database's own logging thresholds, so the rows always describe the
        // captured population.
        assert_eq!(env["threshold_filtered"], json!(true));
        let first = &env["hits"][0];
        assert_eq!(first["duration_ms"], json!(63.149));
        assert_eq!(first["db_user"], json!("dbm"));
        assert_eq!(first["source"], json!("statement_log"));
        assert_eq!(first["rows_actual"], json!(null));
        let second = &env["hits"][1];
        assert_eq!(second["source"], json!("auto_explain"));
        assert_eq!(second["db_user"], json!(null));
        assert_eq!(second["rows_actual"], json!(1));
    }

    /// A full page means the read hit its cap — more qualifying executions
    /// existed than were returned, and the envelope must say so.
    #[test]
    fn test_server_samples_envelope_truncation() {
        let rows: Vec<Value> = (0..3)
            .map(|i| json!({"_timestamp": i, "duration_ms": i as f64}))
            .collect();
        let env = server_samples_envelope(&rows, "s", "on", 3);
        assert_eq!(env["truncated"], json!(true));
    }

    /// One execution, one row: with both producers wide open, a completed
    /// statement writes a `duration:` line AND a plan document, and the merge
    /// would list it twice (verified live — twins share the prefix timestamp
    /// and pid, one with a user and one without). The statement row wins; the
    /// explain twin is absorbed.
    #[test]
    fn test_server_samples_dedupes_producer_twins() {
        let stmt = |ts: i64, pid: i64, fp: &str| {
            json!({"_timestamp": ts, "session_pid": pid, "fingerprint": fp,
                   "kind": server_vantage::KIND_STATEMENT, "duration_ms": 25002.2, "db_user": "dbm"})
        };
        // Plan documents carry NO pid — verified live; the identity must not
        // depend on one being there.
        let explain = |ts: i64, fp: &str| {
            json!({"_timestamp": ts, "fingerprint": fp,
                   "kind": server_vantage::KIND_EXPLAIN, "duration_ms": 25001.3})
        };
        let mut rows = vec![
            stmt(1_000, 7, "fp-a"),
            explain(1_000, "fp-a"), // twin of the row above — absorbed
            explain(2_000, "fp-a"), // explain-only capture — kept
            explain(1_000, "fp-b"), // same ms, different statement — kept
            // A pid-carrying explain row must actually match a statement pid
            // to be absorbed.
            json!({"_timestamp": 1_000, "session_pid": 9, "fingerprint": "fp-a",
                   "kind": server_vantage::KIND_EXPLAIN, "duration_ms": 25001.0}),
        ];
        dedupe_producer_twins(&mut rows);
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0]["kind"], json!(server_vantage::KIND_STATEMENT));
        assert!(
            rows.iter()
                .all(|r| r["kind"] == json!(server_vantage::KIND_STATEMENT)
                    || r["_timestamp"] != json!(1_000)
                    || r["fingerprint"] != json!("fp-a")
                    || r["session_pid"] == json!(9)),
            "the (1000, fp-a) identity must keep only the statement row and the mismatched-pid explain"
        );
    }

    /// Two rows of the SAME kind sharing an identity are two real executions
    /// — a pid can complete two fast runs of one statement inside the log
    /// prefix's millisecond — and collapsing them would undercount work.
    #[test]
    fn test_server_samples_dedupe_never_merges_same_kind() {
        let mut rows = vec![
            json!({"_timestamp": 1, "session_pid": 7, "fingerprint": "fp",
                   "kind": server_vantage::KIND_STATEMENT, "duration_ms": 0.4}),
            json!({"_timestamp": 1, "session_pid": 7, "fingerprint": "fp",
                   "kind": server_vantage::KIND_STATEMENT, "duration_ms": 0.3}),
        ];
        dedupe_producer_twins(&mut rows);
        assert_eq!(rows.len(), 2);
    }

    /// The route + re-export wiring, source-pinned like its siblings: a
    /// handler nothing routes to is dead code that reads as a feature.
    #[test]
    fn test_server_samples_route_is_registered() {
        let router = include_str!("../../../../api/http/src/handler/http/router/mod.rs");
        assert!(
            router.contains("db_monitoring/server_samples"),
            "the server-samples route must be registered"
        );
        assert!(router.contains("get_dbm_server_samples"));
        let reexport = include_str!("../../../../api/search/src/traces/mod.rs");
        assert!(
            reexport.contains("get_dbm_server_samples"),
            "the handler must be re-exported, or the router cannot name it"
        );
    }

    // ── Badges (`/badges`) ──────────────────────────────────────────────────

    /// A slice set where everything answered, and no fallback fired.
    fn all_ok_slices() -> BadgeSliceResults {
        BadgeSliceResults {
            databases: Ok(json!({"hits": [{"calls": 12}], "top_n_subset": false})),
            queries: Ok(json!({"hits": [], "total": 7, "other": []})),
            activity: Ok(json!({"hits": [], "by_state": [{"state": "active", "sessions": 3}]})),
            deadlocks: Ok(json!({"hits": [], "total": 0, "truncated": false})),
            blocking: Ok(json!({"hits": [], "total": 0, "truncated": false})),
            table_health: Ok(json!({"hits": [], "total": 0})),
            server_queries: None,
            server_samples: None,
        }
    }

    /// The envelope carries each endpoint's body UNDER ITS OWN KEY, unchanged
    /// — agreement with the tabs is the whole design, so the member must be
    /// the body, not a digest of it. Fallback members are ABSENT when their
    /// condition never fired: absent means "not needed", which the reader
    /// must be able to tell from "fired and failed" (null).
    #[test]
    fn test_badges_envelope_shape() {
        let env = all_ok_slices().into_envelope();
        assert_eq!(env["databases"]["hits"][0]["calls"], json!(12));
        assert_eq!(env["queries"]["total"], json!(7));
        assert_eq!(env["activity"]["by_state"][0]["sessions"], json!(3));
        assert_eq!(env["deadlocks"]["truncated"], json!(false));
        assert_eq!(env["blocking"]["total"], json!(0));
        assert_eq!(env["table_health"]["total"], json!(0));
        let obj = env.as_object().expect("envelope is an object");
        assert!(
            !obj.contains_key("server_queries") && !obj.contains_key("server_samples"),
            "an unfired fallback must be absent, not null: {env}"
        );
    }

    /// One failed slice nulls ITS member and nothing else — the per-badge
    /// failure isolation the browser fan-out's `allSettled` provided, kept
    /// across the move server-side.
    #[test]
    fn test_badges_member_failure_is_null_and_isolated() {
        let mut slices = all_ok_slices();
        slices.queries = Err(MetaHttpResponse::internal_error("search failed"));
        let env = slices.into_envelope();
        assert_eq!(env["queries"], Value::Null, "the failed member reads null");
        assert_eq!(
            env["databases"]["hits"][0]["calls"],
            json!(12),
            "the other members must be untouched"
        );
        assert_eq!(env["activity"]["by_state"][0]["sessions"], json!(3));
    }

    /// A fallback that FIRED and then failed is `null` — present, unknown —
    /// while one that fired and answered carries its body.
    #[test]
    fn test_badges_fired_fallback_failure_is_null_not_absent() {
        let mut slices = all_ok_slices();
        slices.server_queries = Some(Err(MetaHttpResponse::internal_error("read failed")));
        slices.server_samples = Some(Ok(json!({"hits": [], "total": 0, "truncated": false})));
        let env = slices.into_envelope();
        assert_eq!(env["server_queries"], Value::Null);
        assert_eq!(env["server_samples"]["total"], json!(0));
    }

    /// The fallback arms on an EXACT zero and never on a failure: unknown is
    /// not zero, and a blipped client read must not put a database-reported
    /// claim on the badge.
    #[test]
    fn test_badges_fallback_fires_on_zero_not_on_null() {
        // Queries → server_queries.
        assert!(queries_slice_reports_zero(&Ok(
            json!({"hits": [], "total": 0})
        )));
        assert!(!queries_slice_reports_zero(&Ok(
            json!({"hits": [], "total": 5})
        )));
        assert!(
            !queries_slice_reports_zero(&Err(MetaHttpResponse::internal_error("down"))),
            "a failed slice is unknown, and unknown is not zero"
        );

        // Databases → server_samples. The sum folds exactly as the strip
        // does: missing `calls` contributes 0, an empty list sums to 0.
        assert!(databases_slice_reports_zero_calls(&Ok(json!({"hits": []}))));
        assert!(databases_slice_reports_zero_calls(&Ok(
            json!({"hits": [{"db_system": "postgresql"}]})
        )));
        assert!(!databases_slice_reports_zero_calls(&Ok(
            json!({"hits": [{"calls": 3}]})
        )));
        assert!(
            !databases_slice_reports_zero_calls(&Err(MetaHttpResponse::internal_error("down"))),
            "a failed slice is unknown, and unknown is not zero"
        );
    }

    /// The whole request 403s ONLY when every slice was denied; a mix of
    /// denials and other failures still answers with what it could.
    #[test]
    fn test_badges_403_only_when_every_slice_is_denied() {
        let denied = || -> Result<Value, HttpResponse> { Err(unauthorized_response()) };
        let all_denied = BadgeSliceResults {
            databases: denied(),
            queries: denied(),
            activity: denied(),
            deadlocks: denied(),
            blocking: denied(),
            table_health: denied(),
            server_queries: None,
            server_samples: None,
        };
        assert!(all_denied.all_forbidden());

        // The readable slice is `activity` — an OSS member on purpose. The
        // three enterprise members are ALWAYS `Err(403)` on OSS and
        // `all_forbidden` deliberately does not consult them there, so using
        // one of them here would assert nothing on the OSS build.
        let mut one_answers = BadgeSliceResults {
            databases: denied(),
            queries: denied(),
            activity: Ok(json!({"hits": [], "total": 0})),
            deadlocks: denied(),
            blocking: denied(),
            table_health: denied(),
            server_queries: None,
            server_samples: None,
        };
        assert!(
            !one_answers.all_forbidden(),
            "one readable slice means the caller gets an answer, not a 403"
        );
        one_answers.activity = Err(MetaHttpResponse::internal_error("down"));
        assert!(
            !one_answers.all_forbidden(),
            "a non-auth failure is not a denial — the caller may retry, not be locked out"
        );
    }

    /// **The OSS badge strip: the three enterprise members read `null`, the
    /// rest read their real counts, and the request is NOT a blanket 403.**
    ///
    /// This is the exact slice set `get_dbm_badges` builds on an OSS build —
    /// the three enterprise reads are refused without ever running, and the
    /// OSS three answer. Two things must hold together, and each protects
    /// against a different regression:
    ///
    /// 1. `null`, never `0`. A `0` is an affirmative claim that this org had no deadlocks in the
    ///    window; an OSS build did not look and cannot make it. `null` is what the strip already
    ///    renders as a blank badge.
    /// 2. No whole-request 403. `all_forbidden` must not consult the three always-denied members on
    ///    OSS — if it did, this very set (three healthy answers plus three licence denials) would
    ///    403 the caller out of badges that do work.
    #[cfg(not(feature = "enterprise"))]
    #[test]
    fn test_badges_on_oss_nulls_the_enterprise_three_without_denying_the_request() {
        let slices = BadgeSliceResults {
            databases: Ok(json!({"hits": [{"calls": 12}], "top_n_subset": false})),
            queries: Ok(json!({"hits": [], "total": 7, "other": []})),
            activity: Ok(json!({"hits": [], "by_state": [{"state": "active", "sessions": 3}]})),
            // Exactly what the OSS arm of the join substitutes.
            deadlocks: Err(unauthorized_response()),
            blocking: Err(unauthorized_response()),
            table_health: Err(unauthorized_response()),
            server_queries: None,
            server_samples: None,
        };
        assert!(
            !slices.all_forbidden(),
            "three licence denials must not deny a request whose OSS members all answered"
        );

        let env = slices.into_envelope();
        for member in ["deadlocks", "blocking", "table_health"] {
            assert_eq!(
                env[member],
                Value::Null,
                "{member} must be null on OSS — a 0 would claim the window was read and empty"
            );
            assert_ne!(env[member], json!(0), "{member} must never read as 0");
        }
        assert_eq!(
            env["databases"]["hits"][0]["calls"],
            json!(12),
            "the OSS members keep their real counts"
        );
        assert_eq!(env["queries"]["total"], json!(7));
        assert_eq!(env["activity"]["by_state"][0]["sessions"], json!(3));
    }

    /// The route + re-export wiring, source-pinned like its siblings, and
    /// ungated beside them — an `#[cfg]` here would 404 the endpoint on OSS.
    #[test]
    fn test_badges_route_is_registered() {
        let router = include_str!("../../../../api/http/src/handler/http/router/mod.rs");
        assert!(
            router.contains("db_monitoring/badges"),
            "the badges route must be registered"
        );
        assert!(router.contains("get_dbm_badges"));
        let idx = router
            .find("db_monitoring/badges")
            .expect("route must exist");
        let neighbourhood = &router[idx.saturating_sub(2000)..idx];
        assert!(
            neighbourhood.contains("db_monitoring/"),
            "the badges route must live beside the other ungated DBM routes"
        );
        let reexport = include_str!("../../../../api/search/src/traces/mod.rs");
        assert!(
            reexport.contains("get_dbm_badges"),
            "the handler must be re-exported, or the router cannot name it"
        );
    }
}
