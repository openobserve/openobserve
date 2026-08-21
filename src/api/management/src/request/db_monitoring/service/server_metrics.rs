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

//! `/server_metrics` — the engine-reported statement metrics read.

use super::{super::models::*, *};

/// Whether server-side counters have EVER been captured on this stream —
/// `"on"` or `"off"`.
///
/// Zero server metrics has two causes and only one is the reader's to fix, so
/// the response has to say which it is. `"off"`: the stream carries no counter
/// column, meaning nothing was ever captured — no top-query producer has
/// pointed at this stream — and the collector hint is the right thing to show. `"on"`: the columns
/// exist, the query ran, and this particular statement has no server counterpart. That is a NORMAL
/// state given the partial join above, not a gap.
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
         FROM \"{stream}\"\n\
         WHERE {kind} = '{kind_val}'\n    AND {fp} = '{fp_val}'\n    \
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
pub(super) fn exec_time_kind(engine: &str) -> &'static str {
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

/// The server-metrics endpoint's whole body as a callable — same extraction and
/// same `prologue` contract as [`read_plans_body`].
pub(crate) async fn read_server_metrics_body(
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

    let rows = match build_dbm_server_metrics_sql(stream, engine, database, fingerprint, &present) {
        Some(sql) => {
            match run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time).await
            {
                Ok(rows) => rows,
                Err(e) => {
                    log::error!(
                        "[DbMonitoring] server metrics read failed for {org_id}/{stream}: {e}"
                    );
                    return Err(MetaHttpResponse::internal_error(e));
                }
            }
        }
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{super::testutil::*, *};

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
            "_o2_dbm_server",
            "postgresql",
            Some("shop"),
            "3a74e60b4bd45cc6",
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
        // (The requested window is the request payload's, not this string's.)
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
            "_o2_dbm_server",
            "postgresql",
            Some("shop"),
            "fp",
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
        let sql = build_dbm_server_metrics_sql("_o2_dbm_server", "mysql", None, "fp", &all_cols())
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
        let instance_wide = server_metrics_envelope(&rows, "mysql", "_o2_dbm_server", "on", false);
        assert_eq!(instance_wide["attribution"], "instance");
        let scoped = server_metrics_envelope(&rows, "postgresql", "_o2_dbm_server", "on", true);
        assert_eq!(scoped["attribution"], "database");
    }

    /// Only `top_query` records carry these counters.
    #[test]
    fn test_server_metrics_sql_reads_only_top_query_records() {
        let sql = build_dbm_server_metrics_sql(
            "_o2_dbm_server",
            "postgresql",
            Some("shop"),
            "fp",
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
    /// the exposed case is the common one: a stream that never ingested top
    /// queries has none of these columns and must render an empty section
    /// rather than a 500.
    #[test]
    fn test_server_metrics_sql_skips_when_the_counter_columns_are_absent() {
        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_CALLS);
        assert_eq!(
            build_dbm_server_metrics_sql(
                "_o2_dbm_server",
                "postgresql",
                Some("shop"),
                "fp",
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
                "_o2_dbm_server",
                "postgresql",
                Some("shop"),
                "fp",
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
                "_o2_dbm_server",
                "postgresql",
                Some("shop"),
                "fp",
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
        let env = server_metrics_envelope(&rows, "postgresql", "_o2_dbm_server", "on", true);

        assert_eq!(env["server_metrics_capture"], json!("on"));
        assert_eq!(env["stream"], json!("_o2_dbm_server"));
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
        let unmatched = server_metrics_envelope(&[], "postgresql", "_o2_dbm_server", "on", true);
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

        let off = server_metrics_envelope(&[], "postgresql", "_o2_dbm_server", "off", true);
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
        let env = server_metrics_envelope(&rows, "postgresql", "_o2_dbm_server", "on", true);

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

        let pg = server_metrics_envelope(&rows, "postgresql", "_o2_dbm_server", "on", true);
        assert_eq!(pg["exec_time_kind"], json!("execution"));

        let mysql = server_metrics_envelope(&rows, "mysql", "_o2_dbm_server", "on", false);
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
        let env = server_metrics_envelope(&rows, "postgresql", "_o2_dbm_server", "on", true);
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
        let router = include_str!("../../../../../http/src/handler/http/router/mod.rs");
        assert!(
            router.contains("db_monitoring/query/server_metrics"),
            "the server-metrics route must be registered"
        );
        assert!(
            router.contains("get_dbm_query_server_metrics"),
            "the route must point at the handler"
        );
        assert!(
            router.contains("db_monitoring::handler::get_dbm_query_server_metrics"),
            "the route must name the handler through its own module — \
             a route pointing anywhere else is not this handler"
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
}
