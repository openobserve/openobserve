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

//! Shared read-layer machinery: the authorization gates, SQL escaping,
//! window/range math, the three search harnesses, the merge/fold/sort helpers,
//! and the server-vantage prologue every feature module builds on.

// The models these pull in are named only from enterprise-gated bodies, so the
// glob is genuinely unused on OSS. Keep the import (enterprise needs it) and
// silence the OSS-only lint rather than splitting it behind a cfg.
#[cfg_attr(not(feature = "enterprise"), allow(unused_imports))]
use super::{super::models::*, *};

/// Default server-vantage logs stream — the name the shipped collector recipes
/// export to (`stream-name: _o2_dbm_server`).
pub(super) const DEFAULT_SERVER_STREAM: &str = "_o2_dbm_server";

/// The DBM stream-read decision, split from the OFGA round trips that produce
/// its inputs so the rule itself is unit-testable without a live OpenFGA store.
///
/// `module_grant` is `db_monitoring:_all_{org}` — the module-level permission
/// the role editor hands out; `stream_grant` is the per-stream check. Either
/// one suffices, and neither means denied — that last clause is the security
/// property, so it has its own test.
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
pub(super) const fn stream_read_decision(module_grant: bool, stream_grant: bool) -> bool {
    module_grant || stream_grant
}

/// Whether `user_id` may read `stream_name` of `stream_type` in `org_id`.
///
/// DBM runs its SQL with `user_id: None` (org-scoped), and three endpoints take
/// a caller-supplied `stream` parameter, so without this check any org member
/// could read any trace or logs stream in the org through DBM.
///
/// Delegates to [`openobserve_core::auth::check_permissions`], which resolves the caller's
/// role from the DB, maps the stream type through `OFGA_MODELS`, and returns
/// `true` for root users.
///
/// Two grants satisfy it, per [`stream_read_decision`]. The `db_monitoring`
/// module grant is consulted first, since that grant is how DBM access is
/// handed out; failing that, the per-stream check runs.
///
/// On OSS the underlying helper is a stub returning `false`, so this wrapper
/// returns `true` there: the endpoints that reach it on OSS are the ones whose
/// documented posture is org-level visibility (FRD NFR-6). The enterprise path
/// is the gate that matters.
///
/// This wrapper does not gate the enterprise-only endpoints — on OSS,
/// deadlocks/blocking/table health are `#[cfg]`-stubbed to 403 before any auth
/// or search runs.
pub(super) async fn can_read_stream(
    org_id: &str,
    user_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> bool {
    #[cfg(feature = "enterprise")]
    {
        // With OFGA off there is no authorization model to consult, so the
        // org-level posture stands: the deployment has expressed no per-stream
        // policy for this check to enforce.
        if !get_openfga_config().enabled {
            return true;
        }

        // The module grant first. `db_monitoring` is an org-level resource with
        // no per-object entities, so the object id is the org and `use_all_org`
        // is true — the check lands on `db_monitoring:_all_{org}`, the tuple the
        // role editor writes for the module toggle.
        //
        // This short-circuit is scoped to DBM: `can_read_stream` is private to
        // this module. It is not a general stream bypass — every row-bearing DBM
        // query constrains itself to database records: the client vantage on
        // `o2_db_fingerprint IS NOT NULL`, the server vantage on
        // `o2_dbm_kind = '<kind>'` (or `o2_dbm_engine IS NOT NULL` for
        // instances). A module grant buys the DB rows of a stream and nothing
        // else.
        //
        // One deliberate exception: `build_probe_sql` scans without a kind
        // predicate, because counting untagged rows is how the liveness probe
        // distinguishes "collector alive, database healthy" from "collector
        // dead". It projects only `_timestamp` and the kind column and reduces
        // them to counts, so no field value reaches the wire — but on a
        // caller-supplied `?stream=` it does expose a row count (capped at
        // PROBE_SCAN_LIMIT) and a newest-row timestamp. Known and accepted.
        if check_permissions(
            org_id,
            org_id,
            user_id,
            "db_monitoring",
            "GET",
            None,
            true,
            false,
            false,
        )
        .await
        {
            return stream_read_decision(true, false);
        }

        return stream_read_decision(
            false,
            check_permissions(
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
            .await,
        );
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
pub(crate) fn unauthorized_response() -> HttpResponse {
    MetaHttpResponse::forbidden("Unauthorized Access")
}

/// Default query window when the request carries no time range.
const DEFAULT_WINDOW_MICROS: i64 = 60 * 60 * 1_000_000; // 1 h

/// Request size for `_o2_db_stats` reads.
const STATS_READ_SIZE: usize = 100000;

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
/// Time semantics: rollup `_timestamp` is the window END, so the read must keep
/// windows ending inside `(start_time, end_time)` — the window whose END lands
/// exactly on `start_time` belongs to the PREVIOUS range, and admitting it
/// double-counts one window at every adjacent range boundary (the paging /
/// refresh case where two successive reads share an edge). The UPPER edge is
/// exclusive too; see [`stats_read_range`] for why.
///
/// **No builder here spells a `_timestamp` bound** — this one used to, and the
/// inline `_timestamp > start AND _timestamp <= end` it carried was measured to
/// be a NO-OP. Against the live `_o2_db_stats` stream (17,849 rows) with a
/// boundary `_timestamp` carrying 97 rows, the read returned 13,483 rows both
/// WITH the inline predicate and WITHOUT it: the boundary rows were admitted
/// either way, so the double-count the old comment claimed to prevent was
/// happening in production the whole time. Only shifting the PAYLOAD excluded
/// them (13,386, −97).
///
/// The window is therefore carried solely by the request payload, which the
/// planner pushes down as a physical `_timestamp >= start AND _timestamp < end`
/// FilterExec per scan (`search/src/datafusion/table_provider/helpers.rs`).
/// [`stats_read_range`] converts the caller's range into that payload:
/// `_timestamp` is integer µs, so on integers `> start` ≡ `>= start + 1`, and
/// `< end` is already exclusive, making the payload `[start + 1, end)` exactly
/// the intended `(start, end)`.
pub(crate) fn build_stats_sql(org_id: &str, record_type: &str, preds: &str) -> String {
    build_stats_sql_projected(org_id, record_type, preds, "*")
}

/// [`build_stats_sql`] with an explicit projection, for the reads that consume
/// a handful of columns from rows that drag an up-to-4 KB `query_norm` each
/// under `SELECT *`. `projection` must come from [`stats_projection`] (or be
/// `"*"`): naming a column absent from the stream schema fails the WHOLE query
/// with a schema error, so projections are schema-gated, never assumed.
pub(crate) fn build_stats_sql_projected(
    org_id: &str,
    record_type: &str,
    preds: &str,
    projection: &str,
) -> String {
    format!(
        "SELECT {projection} FROM \"{O2_DB_STATS_STREAM}\"\nWHERE org_id = '{}'\n    AND record_type = '{record_type}'{preds}\nLIMIT {STATS_READ_SIZE}",
        escape_sq(org_id)
    )
}

/// The payload window for a `_o2_db_stats` read: the ONLY thing that bounds
/// these scans (see [`build_stats_sql`]).
///
/// Rollup `_timestamp` is the window END, so a stats read wants the OPEN span
/// `(start, end)` — BOTH edges exclusive, for the same reason at each end:
///
/// * a window ending exactly on `start_time` finished before the range opened; it is the PREVIOUS
///   range's last window.
/// * a window ending exactly on `end_time` has not finished inside the range; it is the NEXT
///   range's first window. The caller's `[start, end)` is a half-open span of wall clock, so its
///   own last window is the one ending one grid step BEFORE `end_time`.
///
/// Counting either edge makes two adjacent reads (paging, refresh, the Δ
/// baseline) both claim the same window.
///
/// The payload filter is `>= lo AND < hi` and `_timestamp` is integer µs, so
/// `> start` ≡ `>= start + 1`, and `< end` is already exclusive: `(start, end)`
/// is the payload `[start + 1, end)`.
///
/// The upper edge stays EXCLUSIVE: `hi` is `end_time`, not `end_time + 1`.
/// Admitting the window that ends exactly at `end_time` over-counts by one
/// window (a uniform +33% on a 1h window against 900s rollups). See
/// `test_stats_read_range_excludes_window_ending_at_end_time`.
///
/// Saturating, so an `i64::MAX` end cannot wrap the window inside out.
pub(crate) fn stats_read_range(start_time: i64, end_time: i64) -> (i64, i64) {
    (start_time.saturating_add(1), end_time)
}

/// The subset of `wanted` columns actually present on the `_o2_db_stats`
/// schema, as a projection list. Falls back to `*` when the schema cannot be
/// read (never fail a read over an optimization) or when nothing intersects
/// (the stream is brand new; the read returns empty anyway).
pub(super) async fn stats_projection(org_id: &str, wanted: &[&str]) -> String {
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
pub(super) fn stamp_trace_streams<'a>(
    merged: &mut Value,
    rows: impl IntoIterator<Item = &'a Value>,
) {
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
            // exactly one database. It is the server-vantage join key: without
            // it the detail page cannot ask for the database's own counters.
            // Never invented when the fingerprint genuinely ran on several
            // databases — attributing one database's counters to another is
            // worse than asking nothing.
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

// ─── Live delta over the un-rolled-up window (D4) ────────────────────────────

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
    /// The stream has the `o2_db_fingerprint` column — i.e. it can answer a DBM
    /// read at all. A stream without it contributes no delta.
    pub relevant: bool,
    /// Delta computation failed; callers treat it as "no delta" and the read
    /// degrades to rollup-only rather than failing the request.
    pub failed: bool,
}

/// Compute the delta for one `(org, trace stream)` — the part of the caller's
/// window the rollup has not covered. Returns `None` when the delta is
/// disabled.
///
/// NOT memoised here. There was a process-local cache keyed `(org, stream)` +
/// offset, with its own TTL and single-flight lock; the search RESULT cache
/// replaced it. That cache keys on the query AND its time range — which is what
/// identifies a delta now that the window comes from the request rather than
/// the clock — and it is shared across the cluster, where the old one was per
/// process (N queriers meant N cold misses on the same window). It also needs no
/// invalidation of its own: once the rollup advances, `delta_start` moves and
/// the read is simply a different query.
///
/// `offset` is the stream's rollup offset, resolved by the caller — the whole
/// fleet's offsets come from ONE prefix read in [`collect_tails`].
async fn compute_tail(
    org_id: &str,
    stream: &str,
    offset: i64,
    q_start: i64,
    q_end: i64,
) -> Option<TailData> {
    // The delta is the part of the caller's range the rollup has not covered.
    //
    // The rollup offset is the split point: everything at or before it is
    // already in `_o2_db_stats` (cheap), everything after it is still only raw
    // spans (expensive). So the delta is exactly `[max(offset, q_start), q_end]`
    // — both bounds derived from the REQUEST, never from the wall clock.
    //
    // Deriving both bounds from the request is what makes the read cacheable:
    // a `now`-anchored window moves on every request, so no two requests ask
    // the same question and the search result cache can never match one.
    //
    // Clamped to the request: a rollup ahead of `q_end` (a historical window
    // fully rolled up) leaves nothing to do, and `tail_start > tail_end` would
    // otherwise invert the window.
    //
    // BOUNDED. `delta_start` also refuses to read further back than the
    // catch-up budget: a stalled rollup must not turn every page load into an
    // ever-widening raw-span scan. When the bound binds, the span between
    // `data_through` and `tail_start` is covered by neither source — which is
    // exactly what `tail_covers_from` reports, and what the UI's staleness
    // banner is for.
    let tail_start = rollup::delta_start(offset, q_start, q_end);
    let tail_end = q_end;

    // Schema gate: a stream without the DBM columns contributes no delta.
    let schema = infra::schema::get(org_id, stream, StreamType::Traces).await;
    let (relevant, has_rows_col) = match &schema {
        Ok(s) => (
            openobserve_core::db_monitoring::stream_supports_db_monitoring(s),
            s.field_with_name("db_response_returned_rows").is_ok(),
        ),
        Err(_) => (false, false),
    };
    if !relevant {
        let data = TailData {
            tail_start,
            tail_end,
            ..Default::default()
        };
        return Some(data);
    }

    // The BOUNDED two-stage form (§5.2), reusing the rollup's own builders —
    // never the raw unbounded aggregate.
    // Stamp the delta rows on the SAME grid the rollup writes to: the window
    // the rollup will itself write once it catches up, so a cached delta row
    // and the eventual rollup row are the same window on the same lattice —
    // comparable, and not double-counted. Derived from the request's end, not
    // the clock, so the stamp is stable for a given window.
    let grid_stamp = rollup::floor_to_grid(tail_end);
    let rank_sql = rollup::build_rank_sql(stream, rollup::ROLLUP_TOP_N, has_rows_col, grid_stamp);
    let totals_sql = rollup::build_totals_sql(stream, has_rows_col, grid_stamp);

    let mut data = TailData {
        tail_start,
        tail_end,
        relevant: true,
        ..Default::default()
    };
    // Rank and totals are independent stages of the same bounded form — run
    // them concurrently rather than back to back.
    let (rank_rows, totals_rows) = tokio::join!(
        rollup::run_dbm_search(org_id, None, rank_sql, tail_start, tail_end, true),
        rollup::run_dbm_search(org_id, None, totals_sql, tail_start, tail_end, true),
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
    Some(data)
}

// ─── Search harnesses ────────────────────────────────────────────────────────

/// Run one read over the `_o2_db_stats` summary stream (read as
/// `StreamType::Logs`, exactly like `_o2_service_graph` — design §5.3).
/// Returns empty when the stream does not exist yet.
pub(super) async fn run_stats_search(
    org_id: &str,
    user_id: Option<&str>,
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
    // The window is carried ENTIRELY by the payload — no stats SQL string spells
    // a `_timestamp` bound — and it is shifted to `(start, end]` here, at the one
    // chokepoint every stats read passes through, so no call site can forget.
    let (lo, hi) = stats_read_range(start_time, end_time);
    // Cached. The range is the CALLER'S (shifted to `(start, end]` above), so
    // every viewer of the same window asks the identical question and the
    // result cache can answer it — the rollup read is the cheap half, but it is
    // also the one every DBM tab issues on every load.
    let req = rollup::dbm_search_request(sql, lo, hi, STATS_READ_SIZE as i64, 30, true);
    // The caller's identity is carried into the search, not dropped. It does NOT
    // authorize the read — `search_service` performs no permission check; that is
    // the handler's job (see `can_read_stream`). What it does carry is the
    // role-derived query-range limit (`get_settings_max_query_range`) and the
    // attribution every search task, cancellation and audit record is keyed on.
    // `None` is reserved for the background rollup writer, which has no user.
    let trace_id = config::ider::generate();
    // Through the CACHE wrapper, not the bare planner: `search_service::search`
    // only stores `use_cache` on the request and never consults the cache —
    // the caching lives in `search_service::cache::search`
    // (`prepare_cache_response`/`check_cache`). Same entrypoint every sibling
    // traces read uses.
    let resp = search_service::cache::search(
        &trace_id,
        org_id,
        StreamType::Logs,
        user_id.map(str::to_string),
        &req,
        String::new(),
        false,
        None,
        false,
    )
    .await?;
    // A PARTIAL response is not an empty one — see `hits_or_partial_error`.
    openobserve_core::db_monitoring::hits_or_partial_error(resp, O2_DB_STATS_STREAM)
}

// ─── Shared handler plumbing ─────────────────────────────────────────────────

/// Resolve `(start_time, end_time)`, defaulting to the last hour.
pub(super) fn resolve_range(start: Option<i64>, end: Option<i64>) -> (i64, i64) {
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
pub(super) async fn involved_streams(
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
        let mut grouped = db::schema::list_all_streams_grouped().await;
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
pub(super) struct Freshness {
    /// Minimum rollup offset across the involved streams (µs). 0 = a stream
    /// has never been rolled up. This is the staleness signal when the live
    /// tail is off or failed.
    pub(super) data_through: i64,
    pub(super) live_tail: bool,
    /// Where the live tail begins (µs). When this is LATER than
    /// `data_through`, the rollup job has stalled beyond the one-interval tail
    /// cap and the gap `(data_through, tail_covers_from)` is NOT covered by
    /// either source — the UI's staleness banner condition (D4/NFR-5).
    pub(super) tail_covers_from: Option<i64>,
    pub(super) tail_through: Option<i64>,
    pub(super) tail_truncated: bool,
    pub(super) percentiles_estimated: bool,
}

impl Freshness {
    pub(super) fn to_json(&self) -> Value {
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
pub(super) struct CollectedTails {
    pub(super) tails: Vec<TailData>,
    pub(super) data_through: i64,
    pub(super) tail_covers_from: Option<i64>,
    pub(super) tail_through: Option<i64>,
    pub(super) tail_truncated: bool,
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
pub(super) async fn collect_tails(
    org_id: &str,
    streams: &[String],
    start_time: i64,
    end_time: i64,
) -> CollectedTails {
    // ONE prefix read for every stream's offset, rather than a meta-DB round
    // trip per stream. A stream absent from the map is a fresh stream (offset 0),
    // exactly as `get_offset` answers for a missing key; a failed LIST is not
    // a fleet of fresh streams — the tails are skipped for this request and
    // staleness surfaces through `data_through` alone, the same degradation
    // the per-stream read failure produced.
    let offsets = match db::db_monitoring::list_offsets(org_id).await {
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
    if offsets.is_some() {
        // Every stream's tail concurrently — each is its own bounded pair of
        // searches (or a cache hit), with no ordering between streams.
        let computed =
            join_all(streams.iter().map(|stream| {
                compute_tail(org_id, stream, offset_of(stream), start_time, end_time)
            }))
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

pub(crate) fn disabled_response() -> HttpResponse {
    MetaHttpResponse::not_found("Database Monitoring is disabled (ZO_DB_MONITORING_ENABLED=false)")
}

// ─── Δ-baseline plumbing (shared by the databases and queries bodies) ────────

/// Validate the Δ baseline pair: both or neither, start before end.
pub(super) fn parse_baseline_pair(
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

/// Run one window reader for the current window and — concurrently, when one
/// was requested — the Δ baseline window.
pub(super) async fn read_current_and_baseline<T, F, Fut>(
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
pub(super) fn stamp_baseline_sections(
    body: &mut Value,
    sections: Vec<(&str, Value)>,
    failed: bool,
) {
    let extra = body.as_object_mut().expect("body is an object");
    for (key, value) in sections {
        extra.insert(key.to_string(), value);
    }
    extra.insert("baseline_read_failed".into(), json!(failed));
}

// ─── Handlers ────────────────────────────────────────────────────────────────

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
pub(super) fn fold_breakdown_by_instance(qs_pool: &[Value]) -> Value {
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
pub(super) fn stamp_server_fallback(body: &mut Value, result: Result<Value, HttpResponse>) {
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

/// Default result cap for the server-vantage endpoints.
pub(super) const DEFAULT_EVENTS_LIMIT: usize = 100;

pub(super) const MAX_EVENTS_LIMIT: usize = 1000;

/// Scope predicates shared by both server-vantage endpoints. Column names are a
/// fixed whitelist; values are single-quote-escaped — user input can never name
/// a column (same contract as [`ScopeFilters::sql_preds`]).
///
/// **The instance predicate is presence-gated on the stream schema** (N5), the
/// same rule the SELECT projections apply through `present_dbm_columns`. A
/// stream whose rows never carried `o2_dbm_instance` — the statement/explain
/// filelog feeds predate the instance stamp — would otherwise turn every
/// `?instance=` request into a confident empty 200 (or a schema error when the
/// column is absent outright). The documented decision: when the column is
/// absent from the schema the predicate is SKIPPED, treating a single-instance
/// stream as matching, which is preferable to silently matching nothing. The
/// engine/database predicates stay unconditional: every canonicalizer stamps
/// them, so their absence genuinely means "no such rows".
pub(super) fn dbm_event_preds(
    system: Option<&str>,
    instance: Option<&str>,
    database: Option<&str>,
    present: &HashSet<String>,
) -> String {
    let mut out = String::new();
    for (col, val) in [
        (server_vantage::O2_DBM_ENGINE, system),
        (server_vantage::O2_DBM_INSTANCE, instance),
        (server_vantage::O2_DBM_DATABASE, database),
    ] {
        if col == server_vantage::O2_DBM_INSTANCE && !present.contains(col) {
            // Single-instance stream: nothing to narrow by, so the filter
            // matches rather than silently excluding every row (N5).
            continue;
        }
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
pub(super) async fn present_dbm_columns(
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
pub(super) fn queryable_columns(
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

/// A string column, or JSON null when absent/empty.
pub(super) fn str_or_null(row: &Value, key: &str) -> Value {
    match row.get(key).and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => json!(s),
        _ => Value::Null,
    }
}

pub(super) fn as_f64_loose(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

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
    pub(super) fn fallback_needed(&self, _start_time: i64) -> bool {
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
pub(crate) fn build_earliest_canonical_sql(stream_name: &str, kind: &str) -> String {
    format!(
        "SELECT _timestamp FROM \"{}\"\nWHERE {} = '{}'\nORDER BY _timestamp ASC\nLIMIT 1",
        escape_ident(stream_name),
        server_vantage::O2_DBM_KIND,
        escape_sq(kind),
    )
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
    /// The A1 read-time fallback for this caller's KIND, or `None` for the
    /// canonical fast path.
    ///
    /// `Some` for the DEADLOCKS (phase 1) and BLOCKING (phase 2a) callers.
    /// ACTIVITY passes `None` and gets byte-identical SQL to what it emitted
    /// before A1: it is an OSS-owned ungated page, so a raw projection there is
    /// cost with no reader on every build.
    ///
    /// The two vocabularies are carried by DIFFERENT TYPES rather than one
    /// generic set, so a caller cannot be handed the wrong one — see
    /// [`RawProjection`].
    pub raw: Option<RawProjection<'a>>,
}

/// Which raw vocabulary a widened read is using.
///
/// The projection and the marker predicate are both derived from this, and both
/// must come from the SAME vocabulary: projecting the deadlock columns while
/// matching the blocking markers would fetch bytes nobody reads and return rows
/// the caller's canonicalizer refuses. Making it one enum means the builder
/// cannot mix them, and adding a third capability is a new variant the compiler
/// demands be handled everywhere.
///
/// The variants are `dead_code`-exempt because on an OSS build NOTHING
/// constructs them — only the enterprise deadlocks and blocking bodies do — yet
/// the type itself must exist in both builds, because activity is an OSS-owned
/// ungated page that calls the same builder and so names this type in its
/// signature. That is the same "inert on OSS" property `RawDeadlockFallback`
/// documents; it only needs an attribute here because an unconstructed VARIANT
/// is dead code where an unconstructed struct's read field is not.
#[derive(Clone, Copy)]
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
pub(crate) enum RawProjection<'a> {
    Deadlock(&'a RawDeadlockFallback),
    Blocking(&'a RawBlockingFallback),
}

impl RawProjection<'_> {
    /// The candidate vocabulary for this variant — the array the projection is
    /// intersected against.
    pub(super) fn fields(&self) -> &'static [&'static str] {
        match self {
            RawProjection::Deadlock(_) => &server_vantage::RAW_DEADLOCK_FIELDS,
            RawProjection::Blocking(_) => &server_vantage::RAW_BLOCKING_FIELDS,
        }
    }

    /// Whether this stream can be queried for a given raw column.
    pub(super) fn has(&self, field: &str) -> bool {
        match self {
            RawProjection::Deadlock(r) => r.present.contains(field),
            RawProjection::Blocking(r) => r.present.contains(field),
        }
    }

    /// The marker terms for the widened `WHERE`, already schema-gated.
    pub(super) fn marker_terms(&self) -> Vec<String> {
        match self {
            RawProjection::Deadlock(r) => r.marker_terms(),
            RawProjection::Blocking(r) => r.marker_terms(),
        }
    }
}

/// Read canonical server-vantage events of one kind from a LOGS stream.
pub(crate) fn build_dbm_events_sql(
    stream_name: &str,
    kind: &str,
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
            raw.into_iter()
                .flat_map(|r| r.fields().iter().copied().filter(move |f| r.has(f))),
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
        let markers = raw.map(|r| r.marker_terms()).unwrap_or_default();
        if markers.is_empty() {
            canonical
        } else {
            format!("({canonical} OR {})", markers.join(" OR "))
        }
    };

    format!(
        "SELECT {cols} FROM \"{}\"\nWHERE {kind_pred}{preds}\nORDER BY _timestamp DESC\nLIMIT {limit}",
        escape_ident(stream_name),
    )
}

/// Run a read over a server-vantage LOGS stream. Returns empty (not an error)
/// when the stream does not exist — a deployment that has not yet shipped the
/// collector recipes must render an empty state, not a 500.
pub(super) async fn run_events_search(
    org_id: &str,
    user_id: Option<&str>,
    stream: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<Value>, anyhow::Error> {
    if !infra::schema::exists(org_id, StreamType::Logs, stream).await {
        return Ok(Vec::new());
    }
    // Cached, for the same reason as `run_stats_search`: the window is the
    // caller's, so repeated views of one window share one answer.
    let req =
        rollup::dbm_search_request(sql, start_time, end_time, STATS_READ_SIZE as i64, 30, true);
    // The caller's identity is carried into the search — see `run_stats_search`
    // for why (query-range limits and attribution, NOT authorization). This
    // function still does not authorize itself: every handler that reaches it
    // must check the caller's read permission on `stream` first.
    let trace_id = config::ider::generate();
    // Through the CACHE wrapper, not the bare planner: `search_service::search`
    // only stores `use_cache` on the request and never consults the cache —
    // the caching lives in `search_service::cache::search`
    // (`prepare_cache_response`/`check_cache`). Same entrypoint every sibling
    // traces read uses.
    let resp = search_service::cache::search(
        &trace_id,
        org_id,
        StreamType::Logs,
        user_id.map(str::to_string),
        &req,
        String::new(),
        false,
        None,
        false,
    )
    .await?;
    // A PARTIAL response is not an empty one — see `hits_or_partial_error`.
    openobserve_core::db_monitoring::hits_or_partial_error(resp, stream)
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
/// would return different rows depending on whether the fallback is active.
#[cfg(feature = "enterprise")]
pub(super) struct ScopeNarrowing {
    pub(super) system: Option<String>,
    pub(super) instance: Option<String>,
    pub(super) database: Option<String>,
}

#[cfg(feature = "enterprise")]
impl ScopeNarrowing {
    pub(super) fn new(q: &DeadlocksQuery) -> Self {
        ScopeNarrowing {
            system: q.system.clone(),
            instance: q.instance.clone(),
            database: q.database().map(str::to_string),
        }
    }

    pub(super) fn matches(&self, ev: &server_vantage::DeadlockEvent) -> bool {
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
    pub(super) fn not_collecting(&self) -> bool {
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
    pub(super) fn log_lines_seen(&self) -> Option<i64> {
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
    pub(super) fn sample_interval_seconds(&self) -> Option<i64> {
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
pub(crate) fn build_probe_sql(stream_name: &str) -> String {
    // NO kind predicate here, deliberately — see `probe_collection`, which
    // counts untagged rows as `non_event_records`. Those are the evidence that
    // the collector is alive on a healthy database that simply has not
    // deadlocked, so filtering them would turn "nothing went wrong" into
    // "nothing is being collected" — exactly the misread the lock empty-states
    // exist to prevent. This scan stays cheap through PROBE_SCAN_LIMIT.
    format!(
        "SELECT _timestamp, {} FROM \"{}\"\nORDER BY _timestamp DESC\nLIMIT {PROBE_SCAN_LIMIT}",
        server_vantage::O2_DBM_KIND,
        escape_ident(stream_name),
    )
}

/// SQL for the most recent event of one kind strictly before the window.
///
/// "Strictly before the window" is NOT in this string — it is the request
/// payload's range, and [`probe_collection`] is the only caller that sets it:
/// `[start_time - LAST_SEEN_LOOKBACK_MICROS, start_time)`. The payload filter
/// is half-open (`>= start AND < end`), so `start_time` itself is excluded and
/// this read can never restate a row the window's own table is already
/// showing. Any NEW caller must pass the same shape; a payload ending at
/// `end_time` would make this "the newest event IN the window" instead.
pub(crate) fn build_last_seen_sql(stream_name: &str, kind: &str, preds: &str) -> String {
    format!(
        "SELECT _timestamp FROM \"{}\"\nWHERE {} = '{}'{preds}\nORDER BY _timestamp DESC\nLIMIT 1",
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
pub(super) async fn probe_collection(
    org_id: &str,
    user_id: Option<&str>,
    stream: &str,
    kind: &str,
    start_time: i64,
    end_time: i64,
    preds: &str,
) -> CollectionProbe {
    let probe_start = start_time - LIVENESS_PROBE_MICROS;
    let probe_end = end_time + LIVENESS_PROBE_MICROS;
    let sql = build_probe_sql(stream);
    // The liveness scan and the "last one before the window" lookup are
    // independent bounded reads — run them concurrently.
    //
    // NEITHER SQL string carries a `_timestamp` bound; each read's window is
    // the one passed to `run_events_search` below, and the two are deliberately
    // DIFFERENT and non-overlapping in intent:
    //   - the probe widens the window by ±LIVENESS_PROBE_MICROS, because "is the collector alive?"
    //     is answered by rows just outside the window as well as inside it;
    //   - last-seen looks BACK from the window start over LAST_SEEN_LOOKBACK_MICROS and stops AT
    //     `start_time` (exclusive), so it can only ever return an event the window itself does not
    //     contain.
    // Collapsing them onto one shared range would break both.
    let last_seen_sql = build_last_seen_sql(stream, kind, preds);
    let (rows, last_seen_rows) = tokio::join!(
        run_events_search(org_id, user_id, stream, sql, probe_start, probe_end),
        run_events_search(
            org_id,
            user_id,
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
pub(super) fn event_freshness(probe: &CollectionProbe) -> Value {
    json!({
        "data_through": probe.newest_record,
        // No rollup job on this path, so no tail and no estimation.
        "live_tail": false,
        "tail_truncated": false,
        "percentiles_estimated": false,
    })
}

/// Whether a ready `HttpResponse` this module produced is the 403 the stream
/// gate returns. Used to distinguish "may not read" from "read failed" when
/// folding sections — the two must not collapse into one flag.
pub(super) fn is_forbidden(resp: &HttpResponse) -> bool {
    resp.status() == axum::http::StatusCode::FORBIDDEN
}

/// The `(stream, schema)` prologue the deadlocks / blocking / activity bodies
/// each compute for the shared server-vantage stream: read permission plus the
/// present-column set. Under the badges fan-in all three ask about the SAME
/// default stream, so the OFGA round trip and the schema read need not run
/// three times.
pub(crate) struct DbmServerPrologue {
    pub(super) stream: String,
    pub(super) present: HashSet<String>,
}

/// Compute the shared prologue for [`DEFAULT_SERVER_STREAM`], or `None` when
/// the caller may not read it or the schema read failed — each slice then runs
/// its own prologue and owns its own denial/error, byte-identically to the
/// standalone endpoints. `None` is deliberately NOT a verdict (see
/// [`present_dbm_columns`] on why a flattened schema error lies): it only
/// declines to share, never absorbs.
pub(super) async fn server_prologue(org_id: &str, user_id: &str) -> Option<DbmServerPrologue> {
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{super::testutil::*, *};
    /// A role granting the `db_monitoring` MODULE
    /// (`{"object":"db_monitoring:_all_default","permission":"AllowAll"}`) and
    /// nothing else must reach all ten DBM endpoints.
    ///
    /// Six of them — `instances`, `activity`, `server_queries`, `deadlocks`,
    /// `blocking`, `table_health` — route through `involved_streams`, which
    /// filters every candidate through `can_read_stream`. If `can_read_stream`
    /// consults only the `traces`/`logs`/`metrics` stream objects, the module
    /// grant is never consulted, every candidate filters out, and each handler
    /// maps the empty result to `unauthorized_response()`. The other four
    /// (`badges`, `databases`, `queries`, `samples`) are rollup-backed and never
    /// reach it.
    ///
    /// The module grant is the intended way to hand someone DBM: it must cover
    /// the DB-related streams these handlers read.
    #[test]
    fn module_grant_alone_authorizes_a_dbm_stream_read() {
        assert!(
            stream_read_decision(true, false),
            "a caller holding the db_monitoring module grant must be able to \
             read a DBM stream with no per-stream grant — that grant is the \
             whole point of making DBM a grantable module"
        );
    }

    /// The guard that keeps the module-grant short-circuit from being a blanket
    /// allow: a caller holding NEITHER the module grant NOR a per-stream grant
    /// must still be denied. Without this, `stream_read_decision` could quietly
    /// become `true` and every DBM read would authorize everyone.
    #[test]
    fn neither_grant_is_still_denied() {
        assert!(
            !stream_read_decision(false, false),
            "no module grant and no stream grant must stay denied — this is \
             the line between scoping DBM reads to the module permission and \
             opening every stream to every org member"
        );
    }

    /// The per-stream path DBM has always had must keep working on its own,
    /// for callers granted individual streams rather than the module.
    #[test]
    fn per_stream_grant_alone_still_authorizes() {
        assert!(
            stream_read_decision(false, true),
            "the pre-existing per-stream grant must keep authorizing"
        );
    }

    /// The module grant must be consulted against the `db_monitoring` object
    /// at the ORG level, not against a stream object.
    ///
    /// `db_monitoring` is registered in OFGA as a module-level resource with
    /// no per-object entities (`Resource::new("db_monitoring", ..., false)`),
    /// and the route table authorizes every `/{org}/db_monitoring/*` endpoint
    /// as `EntitySource::Org` — which `resolve_permission` turns into object
    /// id = org_id with `use_all_org = true`, i.e. the check lands on
    /// `db_monitoring:_all_{org}`, exactly the tuple the role editor writes.
    ///
    /// Passing the stream name as the object id, or `use_all_org = false`,
    /// would check `db_monitoring:{stream}` / `db_monitoring:{org}` — objects
    /// no grant ever creates, so the module grant would silently never match
    /// and the defect would come straight back. Asserted by scraping the
    /// source because the call itself needs a live OFGA store.
    /// Opens `can_read_stream`'s non-enterprise arm, and so closes the
    /// enterprise one this test reads.
    #[cfg(feature = "enterprise")]
    const OSS_ARM: &str = "#[cfg(not(feature = \"enterprise\"))]";

    #[cfg(feature = "enterprise")]
    #[test]
    fn module_grant_is_checked_against_the_org_level_db_monitoring_object() {
        let src = dbm_prod_source();
        let start = src
            .find("async fn can_read_stream(")
            .expect("can_read_stream must exist");
        // Bound the window on the syntax that ends the enterprise arm, not on a
        // byte count: a comment edit inside the function shifts every offset,
        // and a count that lands mid-character panics rather than fails.
        let end = src[start..]
            .find(OSS_ARM)
            .map(|offset| start + offset)
            .expect("can_read_stream must keep its non-enterprise arm");
        let body = &src[start..end];

        // The FIRST check_permissions call is the module check — it has to be,
        // or the per-stream check would run first and the grant would be
        // consulted only after a denial. The next call opens the fallback.
        let call = body
            .find("check_permissions(")
            .expect("can_read_stream must consult check_permissions");
        let args = match body[call + 1..].find("check_permissions(") {
            Some(next) => &body[call..call + 1 + next],
            None => &body[call..],
        };

        assert!(
            args.contains("\"db_monitoring\""),
            "can_read_stream must ask OFGA about the `db_monitoring` module \
             object; asking only about the stream type is the defect"
        );
        // Object id is the org, not the stream: `db_monitoring` has no
        // per-object entities, so a stream-named object can never match.
        assert!(
            !args.contains("into_ofga_supported_format(stream_name)"),
            "the module check must not pass the stream name as the object id"
        );
    }

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
        use axum::{extract::Path, http::StatusCode};
        use openobserve_api_common::extractors::Headers;
        use openobserve_core::auth::UserEmail;

        use crate::request::db_monitoring::handler::{
            get_dbm_blocking, get_dbm_deadlocks, get_dbm_table_health,
        };

        let org = || Path("default".to_string());
        let user = || {
            Headers(UserEmail {
                user_id: "a@a.com".to_string(),
            })
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
    /// The mapping is a pure function, so the rule is asserted behaviourally
    /// rather than by grepping handler source for `StreamType::Logs` near a
    /// `can_read_stream(` call — a scrape that passes vacuously once the check
    /// moves. `assert_gates_on_vantage` only has to prove each read NAMES its
    /// vantage, with a guard that fails loudly if the function it scraped is
    /// not the one it meant.
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
        let sql = build_stats_sql("default", "db_totals", "");
        let expected = "SELECT * FROM \"_o2_db_stats\"\nWHERE org_id = 'default'\n    AND record_type = 'db_totals'\nLIMIT 100000";
        assert_eq!(sql, expected);
    }

    // No stats SQL string may carry a `_timestamp` bound: an inline bound here
    // was measured to be a NO-OP against the live stream (the payload admitted
    // the boundary rows either way), so the window lives ONLY in the payload.
    // A reintroduced inline bound would be silently inert again.
    #[test]
    fn test_stats_sql_never_bounds_timestamp() {
        for record_type in ["db_totals", "query_stats", "error_class"] {
            let sql = build_stats_sql("default", record_type, "");
            assert!(
                !sql.contains("_timestamp"),
                "stats SQL must not bound _timestamp (it is a no-op): {sql}"
            );
            let projected =
                build_stats_sql_projected("default", record_type, "", "fingerprint, _timestamp");
            let where_clause = projected.split("\nWHERE ").nth(1).expect("WHERE clause");
            assert!(
                !where_clause.contains("_timestamp"),
                "stats WHERE must not bound _timestamp: {projected}"
            );
        }
    }

    // Rollup `_timestamp` is the window
    // END, so a row stamped exactly on `start_time` is the PREVIOUS range's
    // last window: two adjacent reads sharing an edge must not both count it.
    // The payload filter is `>= lo AND < hi`, so excluding that row requires
    // `lo == start_time + 1` — which is what `stats_read_range` produces.
    #[test]
    fn test_stats_read_range_excludes_row_at_start_time() {
        let (start, end) = (1_786_512_485_424_263_i64, 1_786_999_999_000_000_i64);
        let (lo, hi) = stats_read_range(start, end);

        // A row stamped EXACTLY at start_time is excluded by `>= lo`.
        assert!(
            start < lo,
            "a window ending exactly at start_time must be excluded: {start} >= {lo}"
        );
        // The first row that must survive is one µs later.
        assert!(start + 1 >= lo, "start_time + 1 must be admitted");
        // The upper edge is EXCLUSIVE for the mirror-image reason: a window
        // ending exactly at end_time has not finished inside the caller's
        // half-open `[start, end)` — it is the NEXT range's first window.
        assert!(
            end >= hi,
            "a window ending exactly at end_time must be excluded: {end} < {hi}"
        );
        assert!(end - 1 < hi, "one µs before end_time must be kept");
    }

    /// REGRESSION (measured live: every database uniformly 4/3 = +33% on a
    /// narrow window). Rollup `_timestamp` is the window END, and the caller's
    /// `[start_time, end_time)` is a HALF-OPEN span of wall clock: the window
    /// ending exactly at `end_time` has not finished inside the range, it is
    /// the FIRST window of the NEXT range. Counting it here counts it twice
    /// across two adjacent reads — the same double-count `lo` guards at the
    /// bottom edge, unguarded at the top.
    ///
    /// Before the inline predicate was removed, the effective range was the
    /// INTERSECTION of the payload `[start, end)` and the inline
    /// `(start, end]`, i.e. the OPEN span `(start, end)`. The payload alone
    /// must reproduce that, so `hi == end_time`, NOT `end_time + 1`.
    ///
    /// The blast radius is worst exactly where it was measured: a request whose
    /// width is a whole number of rollup windows AND is phase-aligned to the
    /// rollup grid admits one extra window out of N. At the 1h window / 900s
    /// rollup of the live check that is 4 windows counted where 3 belong.
    #[test]
    fn test_stats_read_range_excludes_window_ending_at_end_time() {
        let w = 900_i64 * 1_000_000; // rollup::ROLLUP_INTERVAL_SECS
        let start = 1_786_512_485_424_263_i64;
        let end = start + 4 * w; // exactly 4 windows wide, grid-phase-aligned
        let (lo, hi) = stats_read_range(start, end);

        // The window ending EXACTLY at end_time belongs to the next range.
        assert!(
            !(lo..hi).contains(&end),
            "window ending exactly at end_time must be excluded: {end} in [{lo},{hi})"
        );
        // ...while the range's own last window (one grid step earlier) stays.
        assert!(
            (lo..hi).contains(&(end - w)),
            "the range's last window must be kept: {} not in [{lo},{hi})",
            end - w
        );
        // The bottom edge keeps its existing exclusive semantics.
        assert!(
            !(lo..hi).contains(&start),
            "window ending exactly at start_time must be excluded"
        );

        // The count itself: 3 windows, not 4. This is the measured 4/3 inflation.
        let admitted = (0..=4)
            .map(|i| start + i * w)
            .filter(|t| (lo..hi).contains(t))
            .count();
        assert_eq!(
            admitted, 3,
            "a 4-window-wide aligned request must admit 3 grid windows, not 4"
        );
    }

    #[test]
    fn test_stats_read_range_saturates() {
        let (lo, hi) = stats_read_range(i64::MAX, i64::MAX);
        assert_eq!((lo, hi), (i64::MAX, i64::MAX), "must not wrap");
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
        let sql = build_stats_sql("org'--", "query_stats", "");
        assert!(sql.contains("org_id = 'org''--'"));
    }

    #[test]
    fn test_escape_helpers() {
        assert_eq!(escape_sq("a'b''c"), "a''b''''c");
        assert_eq!(escape_sq("clean"), "clean");
        assert_eq!(escape_ident("a\"b"), "a\"\"b");
    }

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

    /// Capped per instance and ranked heaviest first, so the cap keeps the rows
    /// that carry the shape.
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
            "_o2_dbm_server",
            "deadlock",
            "",
            50,
            &proj(&all_cols(), None),
        );
        let expected = "SELECT _timestamp, o2_dbm_kind, o2_dbm_engine, o2_dbm_database, o2_dbm_instance, o2_dbm_timestamp, o2_dbm_raw, o2_dbm_victim_pid, o2_dbm_participants, o2_dbm_participant_count, o2_dbm_victim_side, o2_dbm_blocked_pid, o2_dbm_blocked_app, o2_dbm_blocked_query, o2_dbm_blocked_fingerprint, o2_dbm_blocking_pid, o2_dbm_blocking_app, o2_dbm_blocking_query, o2_dbm_blocking_fingerprint, o2_dbm_wait_event_type, o2_dbm_wait_event, o2_dbm_wait_seconds, o2_dbm_query_shape, o2_event_name, o2_dbm_session_pid, o2_dbm_session_user, o2_dbm_session_app, o2_dbm_session_state, o2_dbm_query_start, o2_dbm_xact_start, o2_dbm_wait_start, o2_dbm_duration_ms, o2_dbm_exec_time_ms, o2_dbm_server_query_id, o2_dbm_activity_query, o2_dbm_fingerprint, o2_dbm_blocking_pids, o2_dbm_lock_mode, o2_dbm_lock_type, o2_dbm_lock_relation, o2_dbm_client_addr, o2_dbm_client_host, o2_dbm_client_port, o2_dbm_plan, o2_dbm_plan_hash, o2_dbm_plan_hash_version, o2_dbm_calls, o2_dbm_rows, o2_dbm_exec_time_s, o2_dbm_shared_blks_hit, o2_dbm_shared_blks_read, o2_dbm_shared_blks_dirtied, o2_dbm_shared_blks_written, o2_dbm_temp_blks_read, o2_dbm_temp_blks_written, o2_dbm_metrics_are_delta, o2_dbm_receiver_version, o2_dbm_plan_source, o2_dbm_plan_duration_ms, o2_dbm_plan_rows_actual, o2_dbm_relation, o2_dbm_schema, o2_dbm_total_bytes, o2_dbm_heap_bytes, o2_dbm_live_tuples, o2_dbm_dead_tuples, o2_dbm_dead_tup_pct, o2_dbm_mod_since_analyze, o2_dbm_seq_scan_count, o2_dbm_seq_tup_read, o2_dbm_idx_scan_count, o2_dbm_autovacuum_count, o2_dbm_frozen_xid_age, o2_dbm_last_vacuum, o2_dbm_last_autovacuum, o2_dbm_last_analyze, o2_dbm_counters_are_cumulative, o2_dbm_tuples_are_estimated, o2_dbm_index_name, o2_dbm_index_bytes, o2_dbm_idx_tup_read, o2_dbm_idx_tup_fetch, o2_dbm_index_is_unique, o2_dbm_stmt_duration_ms FROM \"_o2_dbm_server\"\nWHERE o2_dbm_kind = 'deadlock'\nORDER BY _timestamp DESC\nLIMIT 50";
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

        let sql = build_dbm_events_sql("_o2_dbm_server", "deadlock", "", 50, &proj(&present, None));
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
            "_o2_dbm_server",
            "deadlock",
            "",
            50,
            &proj(&HashSet::new(), None),
        );
        assert!(sql.starts_with("SELECT _timestamp FROM"));
    }

    /// The signature must be able to say "the read failed".
    ///
    /// Asserted structurally rather than by faking a DB fault: with a bare
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

    /// The signature alone is not enough — every CALLER must honour it.
    ///
    /// Mutation-tested: `present_dbm_columns(..).await.unwrap_or_default()` at a
    /// call site keeps the honest `Result` type and passes every other test in
    /// this file while restoring the false verdict, so the call sites are pinned
    /// too.
    ///
    /// The handler list is DISCOVERED from the source rather than hardcoded, so
    /// a new `get_dbm_*` handler cannot silently escape the guard.
    #[test]
    fn test_no_caller_swallows_a_schema_read_error() {
        let src = dbm_prod_source();

        // Discover every `get_dbm_*` handler and keep the ones that actually
        // read the stream schema — the others have no Result to swallow.
        // `\n}\n` is the body boundary: a handler is a top-level item, so the
        // first column-0 closing brace ends it. (Splitting on `\npub ` instead
        // ran past private items like `present_dbm_columns` itself.)
        // Scan only the real code: the test module below contains the same
        // literal inside other source-scraping tests, and matching those pulls
        // in a bogus "handler" whose body is the rest of the file.
        let code = src;
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

    /// The probe selects `o2_dbm_kind` rather than filtering on it — the
    /// records that best prove liveness are the ones that are not events.
    ///
    /// The probe's reach OUTSIDE the window is no longer in this string: it is
    /// the request payload's range, widened by `LIVENESS_PROBE_MICROS` at the
    /// `probe_collection` call site.
    #[test]
    fn test_build_probe_sql_selects_kind_and_does_not_filter_it() {
        let sql = build_probe_sql("_o2_dbm_server");
        assert!(sql.contains("SELECT _timestamp, o2_dbm_kind"));
        assert!(sql.contains("FROM \"_o2_dbm_server\""));
        // No kind predicate: filtering it out would discard the evidence.
        assert!(!sql.contains("o2_dbm_kind = "));
        assert!(sql.contains("LIMIT 2000"));
    }

    /// Scope filters carry into the lookback, and stay injection-safe.
    #[test]
    fn test_build_last_seen_sql_applies_and_escapes_scope() {
        let preds = dbm_event_preds(Some("mysql"), None, Some("d'b"), &all_cols());
        let sql = build_last_seen_sql("_o2_dbm_server", "deadlock", &preds);
        assert!(sql.contains("o2_dbm_kind = 'deadlock'"));
        assert!(sql.contains("ORDER BY _timestamp DESC"));
        assert!(sql.contains("LIMIT 1"));
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

    /// The whole bug in one assertion: partial in, `Err` out.
    use openobserve_core::db_monitoring::hits_or_partial_error;

    #[test]
    fn test_a_partial_response_is_an_error_not_empty_hits() {
        let resp = config::meta::search::Response {
            is_partial: true,
            function_error: vec!["leaf node left the cluster".into()],
            ..Default::default()
        };
        let err = hits_or_partial_error(resp, "blocking")
            .expect_err("a partial read must not be reported as a clean result");
        let msg = err.to_string();
        assert!(
            msg.contains("partial"),
            "the error must name the condition so the page can say what went \
             wrong, got: {msg}"
        );
        assert!(
            msg.contains("leaf node left the cluster"),
            "the error must carry `function_error` — it is the only description \
             of WHY the read tore, got: {msg}"
        );
    }

    /// The empty-hits case is the dangerous one, and the one the live rig hit:
    /// a partial read that returns NO rows is byte-identical to a healthy empty
    /// window. It must still error.
    #[test]
    fn test_a_partial_response_with_no_hits_still_errors() {
        let resp = config::meta::search::Response {
            is_partial: true,
            hits: vec![],
            ..Default::default()
        };
        assert!(
            hits_or_partial_error(resp, "deadlocks").is_err(),
            "an EMPTY partial read is the false-'no data' page: it looks exactly \
             like a healthy empty window and must never be returned as one"
        );
    }

    /// A partial read carrying SOME rows is equally a lie — the page would
    /// render a subset as if it were the whole window.
    #[test]
    fn test_a_partial_response_with_some_hits_still_errors() {
        let resp = config::meta::search::Response {
            is_partial: true,
            hits: vec![json!({"_timestamp": 1})],
            ..Default::default()
        };
        assert!(
            hits_or_partial_error(resp, "queries").is_err(),
            "a partial read with rows is a SUBSET presented as the whole window"
        );
    }

    /// A partial response with no `function_error` must still error, and must
    /// still say something useful. Nothing guarantees the two travel together.
    #[test]
    fn test_a_partial_response_without_a_function_error_still_errors() {
        let resp = config::meta::search::Response {
            is_partial: true,
            function_error: vec![],
            ..Default::default()
        };
        let err = hits_or_partial_error(resp, "activity")
            .expect_err("`is_partial` alone is sufficient grounds to fail");
        assert!(
            err.to_string().contains("activity"),
            "with no `function_error` to quote, the read's NAME is the only \
             context the operator gets: {err}"
        );
    }

    /// The negative: a clean response is passed through untouched. Without this
    /// the guard could "pass" by failing everything.
    #[test]
    fn test_a_clean_response_passes_its_hits_through() {
        let resp = config::meta::search::Response {
            is_partial: false,
            hits: vec![json!({"a": 1}), json!({"a": 2})],
            ..Default::default()
        };
        let hits = hits_or_partial_error(resp, "blocking").expect("a clean read must succeed");
        assert_eq!(hits, vec![json!({"a": 1}), json!({"a": 2})]);
    }

    /// A clean, genuinely EMPTY response stays `Ok` — the honest empty window
    /// is the case the whole self-diagnosing empty state is built for, and
    /// erroring on it would replace a good page with a 500.
    #[test]
    fn test_a_clean_empty_response_is_still_ok() {
        let resp = config::meta::search::Response {
            is_partial: false,
            hits: vec![],
            ..Default::default()
        };
        let hits = hits_or_partial_error(resp, "deadlocks")
            .expect("an honest empty window is not an error");
        assert!(hits.is_empty());
    }

    /// `function_error` WITHOUT `is_partial` is not this bug and must not be
    /// turned into one: VRL function errors are per-row notes on an otherwise
    /// complete read, and failing them would 500 pages that are fine today.
    #[test]
    fn test_a_function_error_alone_does_not_fail_a_complete_read() {
        let resp = config::meta::search::Response {
            is_partial: false,
            function_error: vec!["vrl: field missing on 3 rows".into()],
            hits: vec![json!({"a": 1})],
            ..Default::default()
        };
        assert!(
            hits_or_partial_error(resp, "blocking").is_ok(),
            "`is_partial` is the completeness signal; `function_error` alone \
             describes rows that WERE read"
        );
    }

    /// Every `crate::search::search` in this module hands its response to the
    /// guard. Discovered, not listed: a NEW read added with a bare `Ok(resp.hits)`
    /// is exactly the drift this must catch.
    #[test]
    fn test_every_dbm_search_routes_through_the_partial_guard() {
        // EVERY read module, not just this one. `rollup::run_dbm_search` is a
        // third read harness — it feeds the live tail, the sparklines, the
        // endpoints endpoint AND the rollup WRITER, where a partial read does
        // not merely render a wrong page but persists wrong aggregates.
        // The DBM read layer enters as its PRODUCTION corpus (all three of
        // models/service/handler, test tails already stripped per layer); the
        // two core modules are still whole files, so each is stripped here.
        let modules = [
            ("dbm read layer", dbm_prod_source()),
            (
                "rollup.rs",
                prod_half(include_str!(
                    "../../../../../../core/src/db_monitoring/rollup.rs"
                )),
            ),
            (
                "server_vantage.rs",
                prod_half(include_str!(
                    "../../../../../../core/src/db_monitoring/server_vantage.rs"
                )),
            ),
        ];
        // BOTH entrypoints count. A DBM read reaches the search layer either
        // through the bare planner (`crate::search::search`) or through the
        // result-cache wrapper (`search_service::cache::search`) — the latter is
        // what a cached read must use, because the planner never consults the
        // cache. A partial response is equally possible through either, so
        // discovering only one would let a whole family of reads skip this guard.
        let entrypoints = ["crate::search::search(", "search_service::cache::search("];
        let mut total = 0;
        for (name, src) in modules {
            let code = src;
            for (i, _) in entrypoints.iter().flat_map(|e| code.match_indices(e)) {
                total += 1;
                // The guard must appear in the lines that consume the response,
                // before the function's own closing brace.
                let after = &code[i..];
                let window = &after[..after.find("\n}\n").map_or(after.len(), |e| e + 3)];
                assert!(
                    window.contains("hits_or_partial_error"),
                    "{name}: this search returns its hits without the partial \
                     guard — a torn read would render as a clean empty page, or \
                     persist as a wrong rollup:\n{window}"
                );
                assert!(
                    !window.contains("Ok(resp.hits)"),
                    "{name}: `Ok(resp.hits)` discards `is_partial`; the response \
                     must go through `hits_or_partial_error`:\n{window}"
                );
            }
        }
        // FIVE: the stats harness, the events harness, the METRICS harness
        // (`run_metrics_search`, the instance-health sweep), and the rollup
        // harness — the last spelling the call TWICE, once through the cache
        // wrapper (reads) and once through the bare planner (the rollup writer,
        // which must not cache). Every branch consumes a response; all guarded.
        assert_eq!(
            total, 5,
            "expected the stats, events and metrics harnesses plus the rollup \
             harness's cached/uncached pair; found {total} — a new search was \
             added, and it must decide what it does with a partial response"
        );
    }

    /// The guard is what keeps a partial read from reaching the
    /// `hits.is_empty()`-gated collection probe — the false `not_collecting`
    /// alarm. Structural, because the ordering is the property: the main read's
    /// `Err` must return BEFORE the probe is consulted.
    ///
    /// Note `probe_collection` deliberately swallows its own read errors into an
    /// empty vec (a failed probe must not itself become a verdict), so the probe
    /// cannot defend this boundary. Only the main read erroring out can.
    #[test]
    fn test_a_partial_read_cannot_reach_the_not_collecting_probe() {
        let src = dbm_prod_source();
        let code = src;

        // The gate lives in the pure envelope builders, which receive `hits` as
        // a PARAMETER — so the property is about the handler bodies that feed
        // them, not about text adjacent to the gate.
        let gated: Vec<&str> = [
            "deadlocks_envelope",
            "blocking_envelope",
            "activity_envelope",
        ]
        .into_iter()
        .filter(|f| {
            code.find(&format!("fn {f}("))
                .map(|i| code[i..].starts_with(&format!("fn {f}(")))
                .unwrap_or(false)
        })
        .collect();
        assert_eq!(
            gated.len(),
            3,
            "expected the three `not_collecting` envelopes; found {gated:?} — \
             the gate moved and this tripwire is now vacuous"
        );
        for f in &gated {
            let i = code.find(&format!("fn {f}(")).unwrap();
            let body = &code[i..];
            let body = &body[..body.find("\n}\n").map_or(body.len(), |e| e + 3)];
            assert!(
                body.contains("hits.is_empty() && probe.not_collecting()"),
                "{f} must gate `not_collecting` on empty hits, or this test \
                 guards nothing"
            );
        }

        // Each handler that builds one of those envelopes must take its rows
        // from a FATAL read. The aggregates beside it (`by_state`, `by_wait`)
        // deliberately degrade to empty and correctly never feed `hits`.
        for handler in [
            "async fn read_deadlocks_body",
            "async fn read_blocking_body",
            "async fn read_activity_body",
        ] {
            let i = code
                .find(handler)
                .unwrap_or_else(|| panic!("{handler} not found — handler renamed?"));
            let body = &code[i..];
            let body = &body[..body.find("\n}\n").map_or(body.len(), |e| e + 3)];

            // The row read: the one bound to `rows`, fatal by construction.
            //
            // Matched on a WHITESPACE-COLLAPSED copy of the body, because the
            // shape of this statement is rustfmt's to decide, not ours: adding
            // one argument to `run_events_search` pushed it over the width and
            // rustfmt split it into `let rows =` / `match run_events_search(…`,
            // which a single-line literal stopped finding. The test then failed
            // claiming the handler "has no fatal row read" — a false alarm about
            // the very invariant it exists to protect. Collapsing runs of
            // whitespace to one space makes the scrape immune to re-wrapping
            // while keeping the assertion below exactly as strict.
            let flat = body.split_whitespace().collect::<Vec<_>>().join(" ");
            let read = flat
                .find("let rows = match run_events_search(")
                .or_else(|| flat.find("let rows_fut = run_events_search("))
                .unwrap_or_else(|| panic!("{handler} has no fatal row read"));
            let stmt = &flat[read..];
            // `"; "` rather than `";\n"`: the newline is gone from the flattened
            // copy, and the statement still ends at the first semicolon.
            let stmt = &stmt[..stmt.find("; ").map_or(stmt.len(), |e| e + 1)];
            assert!(
                !stmt.contains("unwrap_or_default()") && !stmt.contains("unwrap_or_else"),
                "{handler}: the read feeding a `not_collecting` verdict must \
                 PROPAGATE its error, never absorb it into empty hits — an \
                 absorbed partial read reports a healthy collector as \
                 broken:\n{stmt}"
            );
        }

        // Propagation is only worth anything if the read DETECTS the tear.
        // Anchor the two together, so deleting the guard cannot leave this test
        // passing on the strength of `?` alone.
        assert!(
            code.contains("hits_or_partial_error"),
            "propagating an error the read never raises defends nothing — the \
             partial guard must exist for this ordering to matter"
        );
    }
}
