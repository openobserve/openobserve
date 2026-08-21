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

//! `/server_queries` — the single-statement server-vantage lookup.

use super::{super::models::*, *};

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
/// — an empty section, not a 500 (streams without a top-query producer never
/// acquire them).
pub(crate) fn build_dbm_server_queries_sql(
    stream_name: &str,
    preds: &str,
    limit: usize,
    present: &HashSet<String>,
) -> Option<String> {
    // THE FINGERPRINT is what this list is keyed on and the one column it
    // cannot do without. `calls` is a RANKING figure, and requiring it hid
    // every statement on an engine that reports statements without call
    // counts: sqlserverreceiver's `db.server.top_query` carries the statement
    // text and its plan but no execution metrics, so on a SQL Server-only
    // stream this returned nothing and the query-detail header fell through to
    // painting a bare fingerprint at a reader who came to see a statement.
    if !present.contains(server_vantage::O2_DBM_FINGERPRINT) {
        return None;
    }
    let has_calls = present.contains(server_vantage::O2_DBM_CALLS);
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
    // Same conditional shape `exec_time` already uses. The DTO keeps its
    // `calls` FIELD either way so the wire contract does not change per
    // engine — it is simply null, which is the honest value for a feed that
    // reports no call count.
    let calls_col = if has_calls {
        format!("SUM({}) AS calls", server_vantage::O2_DBM_CALLS)
    } else {
        "NULL AS calls".to_string()
    };
    // Ranking needs a figure to rank BY. With no call count the newest
    // statements are the useful ones, which is also what the reader gets on
    // every other feed that has no ranking metric.
    let order_by = if has_calls {
        "calls DESC"
    } else {
        "last_seen DESC"
    };
    // `MAX(_timestamp) AS _timestamp` is projected BESIDE `last_seen`, which
    // carries the same value under the name `ORDER BY` and the envelope use.
    //
    // The duplicate is what makes the read cacheable: the result cache resolves
    // a complex query's timestamp column from the SELECT output, and every
    // timestamp here was aliased away as `first_seen`/`last_seen`, so it found
    // none and declined the query. Verified against the real resolver —
    // `has_ts=false` before, `has_ts=true` with this column present.
    //
    // Unlike the identity list above, this one is NOT grid-stamped: these rows
    // are ranked by `calls`/`last_seen`, so a floored stamp would reorder them.
    // The cache entry is therefore narrower than the instances one; recognizing
    // the column is still what lets an entry exist at all.
    Some(format!(
        "SELECT {proj}, {query_text}, {calls_col}, {exec_time}, \
         MIN(_timestamp) AS first_seen, MAX(_timestamp) AS last_seen, \
         MAX(_timestamp) AS _timestamp \
         FROM \"{stream}\"\n\
         WHERE {kind} = '{kind_val}'{preds}\nGROUP BY {group}\n\
         ORDER BY {order_by}\nLIMIT {limit}",
        proj = projected.join(", "),
        calls_col = calls_col,
        order_by = order_by,
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

/// The server-queries endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`]. [`get_dbm_badges`] runs it as the zero-trace
/// fallback slice, under the same Logs-stream auth this endpoint enforces.
pub(crate) async fn read_server_queries_body(
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
    let mut preds = dbm_event_preds(
        q.system.as_deref(),
        q.instance.as_deref(),
        q.database(),
        &present,
    );
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

    let rows = match build_dbm_server_queries_sql(stream, &preds, limit, &present) {
        Some(sql) => {
            match run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time).await
            {
                Ok(rows) => rows,
                Err(e) => {
                    log::error!(
                        "[DbMonitoring] server queries read failed for {org_id}/{stream}: {e}"
                    );
                    return Err(MetaHttpResponse::internal_error(e));
                }
            }
        }
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
// explain) to `_o2_dbm_server`; the tailed database-log remainder — which is
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{super::testutil::*, *};

    fn cols(with_calls: bool) -> HashSet<String> {
        let mut c: HashSet<String> = [
            server_vantage::O2_DBM_FINGERPRINT,
            server_vantage::O2_DBM_ACTIVITY_QUERY,
            server_vantage::O2_DBM_KIND,
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        if with_calls {
            c.insert(server_vantage::O2_DBM_CALLS.to_string());
        }
        c
    }

    /// An engine that reports statements but no call counts must still list
    /// them.
    ///
    /// `sqlserverreceiver`'s `db.server.top_query` carries the statement text
    /// and its execution plan but NO metrics — no `calls`, no `exec_time`. This
    /// builder required `calls`, so on a SQL Server stream it returned nothing
    /// and the query-detail header fell through to painting a bare fingerprint
    /// at a reader who came to see a statement. The fingerprint is the only
    /// column this list truly cannot do without; `calls` is a ranking figure.
    #[test]
    fn server_queries_sql_builds_without_a_calls_column() {
        let sql = build_dbm_server_queries_sql("_o2_dbm_server", "", 50, &cols(false))
            .expect("statements without call counts are still statements");
        assert!(
            sql.contains("NULL AS calls"),
            "the wire field must survive as null: {sql}"
        );
        assert!(
            sql.contains("ORDER BY last_seen DESC"),
            "with no figure to rank by, newest-first is the honest order: {sql}"
        );
    }

    #[test]
    fn server_queries_sql_still_ranks_by_calls_where_it_can() {
        let sql = build_dbm_server_queries_sql("_o2_dbm_server", "", 50, &cols(true)).expect("sql");
        assert!(sql.contains("ORDER BY calls DESC"), "{sql}");
        assert!(
            sql.contains(&format!("SUM({})", server_vantage::O2_DBM_CALLS)),
            "{sql}"
        );
    }

    #[cfg(feature = "enterprise")]
    /// Same defect, same fix, on the server-queries list: it already grouped,
    /// but aliased its timestamps `first_seen`/`last_seen`, so the resolver saw
    /// no `_timestamp` and declined. Verified `has_ts=false` before, `true` after.
    #[test]
    fn test_server_queries_sql_projects_a_timestamp_the_cache_recognizes() {
        let sql = build_dbm_server_queries_sql("_o2_dbm_server", "", 50, &cols(true)).expect("sql");
        assert!(
            sql.contains("AS _timestamp"),
            "aliasing every timestamp to first_seen/last_seen hides it from the cache: {sql}"
        );
    }

    #[test]
    fn server_queries_sql_still_needs_a_fingerprint() {
        let mut without = cols(true);
        without.remove(server_vantage::O2_DBM_FINGERPRINT);
        assert_eq!(
            build_dbm_server_queries_sql("_o2_dbm_server", "", 50, &without),
            None,
            "the list is KEYED on the fingerprint — without it there is nothing to group"
        );
    }

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
        let sql = build_dbm_server_queries_sql("s", &preds, 50, &present).unwrap();
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
        let env = server_queries_envelope(&rows, "_o2_dbm_server", "on", 50);
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
        let found_nothing = server_queries_envelope(&[], "_o2_dbm_server", "on", 50);
        assert_eq!(found_nothing["total"], json!(0));
        assert_eq!(found_nothing["server_queries_capture"], json!("on"));
        assert_eq!(found_nothing["truncated"], json!(false));

        let never_captured = server_queries_envelope(&[], "_o2_dbm_server", "off", 50);
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
        let env = server_queries_envelope(&rows, "_o2_dbm_server", "on", 50);
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
        let env = server_queries_envelope(&rows, "_o2_dbm_server", "on", 50);
        assert_eq!(env["hits"][0]["exec_time_s"], Value::Null);
        assert_eq!(
            env["hits"][0]["mean_exec_time_s"],
            Value::Null,
            "no total means no mean — 0 would be a measurement nobody made"
        );
    }

    /// The route + re-export wiring, source-pinned like its siblings: a
    /// handler nothing routes to is dead code that reads as a feature.
    #[test]
    fn test_server_samples_route_is_registered() {
        let router = include_str!("../../../../../http/src/handler/http/router/mod.rs");
        assert!(
            router.contains("db_monitoring/server_samples"),
            "the server-samples route must be registered"
        );
        assert!(router.contains("get_dbm_server_samples"));
        assert!(
            router.contains("db_monitoring::handler::get_dbm_server_samples"),
            "the route must name the handler through its own module — \
             a route pointing anywhere else is not this handler"
        );
    }
}
