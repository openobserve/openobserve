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

//! `/activity` — the live session snapshot with its wait-event and state
//! breakdowns.

use super::{super::models::*, *};

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
pub(crate) fn build_dbm_sample_times_sql(stream_name: &str, kind: &str, preds: &str) -> String {
    format!(
        "SELECT DISTINCT _timestamp FROM \"{}\"\nWHERE {} = '{}'{preds}\nORDER BY _timestamp DESC\nLIMIT {SAMPLE_TIMES_LIMIT}",
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
/// **The aggregate is SQL, never a Rust fold over fetched rows.** `_o2_dbm_server`
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
/// stream that predates activity ingest has none of these columns. The rows
/// query degrades to `_timestamp` and returns empty there, so the breakdown
/// must skip rather than 500 the endpoint.
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
        "SELECT {cols}, COUNT(DISTINCT {}) AS sessions FROM \"{}\"\nWHERE {} = '{}'{preds}\nGROUP BY {cols_group}\nORDER BY sessions DESC",
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
pub(super) fn activity_row_to_dto(row: &Value) -> Value {
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
pub(crate) async fn read_activity_body(
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
    let preds = dbm_event_preds(
        q.system.as_deref(),
        q.instance.as_deref(),
        q.database(),
        &present,
    );

    let sql = build_dbm_events_sql(
        stream,
        server_vantage::KIND_ACTIVITY,
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
    let rows_fut = run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time);
    let by_wait_fut = async {
        match build_dbm_activity_breakdown_sql(
            stream,
            server_vantage::O2_DBM_WAIT_EVENT_TYPE,
            Some(server_vantage::O2_DBM_WAIT_EVENT),
            &preds,
            &present,
        ) {
            Some(sql) => wait_event_breakdown(
                &run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time)
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
            &preds,
            &present,
        ) {
            Some(sql) => state_breakdown(
                &run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time)
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
        Some(user_id),
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
        Some(user_id),
        stream,
        build_dbm_sample_times_sql(stream, server_vantage::KIND_ACTIVITY, &preds),
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{super::testutil::*, *};

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
            "_o2_dbm_server",
            server_vantage::O2_DBM_SESSION_STATE,
            None,
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
            "_o2_dbm_server",
            server_vantage::O2_DBM_WAIT_EVENT_TYPE,
            Some(server_vantage::O2_DBM_WAIT_EVENT),
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
        // (The window bound is the request payload's — every DBM read passes
        // the same `(start_time, end_time)` — so it is no longer spelled in
        // this SQL and there is nothing to assert on here.)
    }

    /// `by_state` is the same shape over one column.
    #[test]
    fn test_activity_state_aggregate_is_computed_by_sql() {
        let sql = build_dbm_activity_breakdown_sql(
            "_o2_dbm_server",
            server_vantage::O2_DBM_SESSION_STATE,
            None,
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
            "_o2_dbm_server",
            server_vantage::O2_DBM_SESSION_STATE,
            None,
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
        let preds = dbm_event_preds(Some("pg' OR '1'='1"), Some("pg1"), None, &all_cols());
        let sql = build_dbm_activity_breakdown_sql(
            "ev\"il",
            server_vantage::O2_DBM_SESSION_STATE,
            None,
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
            "_o2_dbm_server",
            server_vantage::KIND_ACTIVITY,
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
            "_o2_dbm_server",
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
    /// every `_o2_dbm_server` stream that predates activity ingest has no
    /// `o2_dbm_session_state` column at all.
    ///
    /// The rows query degrades gracefully there (the projection intersects to
    /// `_timestamp`) and returns empty. An ungated breakdown instead errors, so
    /// the handler 500s where it should have rendered the empty state.
    #[test]
    fn test_activity_breakdown_is_skipped_when_the_column_is_absent() {
        let empty: HashSet<String> = HashSet::new();
        assert!(
            build_dbm_activity_breakdown_sql(
                "_o2_dbm_server",
                server_vantage::O2_DBM_SESSION_STATE,
                None,
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
                "_o2_dbm_server",
                server_vantage::O2_DBM_SESSION_STATE,
                None,
                "",
                &partial,
            )
            .is_some(),
            "the column that IS present must still be grouped"
        );
        assert!(
            build_dbm_activity_breakdown_sql(
                "_o2_dbm_server",
                server_vantage::O2_DBM_WAIT_EVENT_TYPE,
                Some(server_vantage::O2_DBM_WAIT_EVENT),
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
        let src = dbm_prod_source();
        let code = src;
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
    /// RENDERING SESSIONS.
    #[test]
    fn test_not_collecting_requires_both_an_empty_page_and_a_silent_probe() {
        let silent = CollectionProbe::default();
        let alive = CollectionProbe {
            records_seen: 9,
            ..Default::default()
        };
        let session = vec![json!({"query": "SELECT 1"})];
        let flag = |hits: &[Value], probe: &CollectionProbe| {
            activity_envelope(hits, &[], &[], false, "_o2_dbm_server", probe)["not_collecting"]
                .clone()
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
            "_o2_dbm_server",
            server_vantage::O2_DBM_SESSION_STATE,
            None,
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
            "_o2_dbm_server",
            server_vantage::O2_DBM_WAIT_EVENT_TYPE,
            Some(server_vantage::O2_DBM_WAIT_EVENT),
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
        let sql = build_dbm_sample_times_sql("_o2_dbm_server", server_vantage::KIND_ACTIVITY, "");
        assert!(
            sql.to_uppercase().contains("SELECT DISTINCT"),
            "the cap must count distinct polls, not rows — one row per session \
             per poll otherwise collapses the window to a single timestamp: {sql}"
        );
        assert!(
            sql.contains("o2_dbm_kind = 'activity'"),
            "the interval is inferred from ACTIVITY polls only: {sql}"
        );
        // (The window bound is no longer in the SQL — the request payload
        // carries it — so there is nothing to assert about it here.)
        // Only the timestamp is needed; projecting session columns would make
        // DISTINCT operate on the wrong tuple and restore the row-per-session
        // collapse this query exists to avoid.
        assert!(
            !sql.contains(server_vantage::O2_DBM_SESSION_PID),
            "DISTINCT must be over the timestamp alone: {sql}"
        );

        // Injection-safe like every other builder here.
        let preds = dbm_event_preds(Some("pg' OR '1'='1"), None, None, &all_cols());
        let sql = build_dbm_sample_times_sql("ev\"il", "activity", &preds);
        assert!(sql.contains("'pg'' OR ''1''=''1'"));
        assert!(sql.contains("\"ev\"\"il\""));
    }
}
