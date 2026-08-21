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

//! `/server_samples` — the server-vantage sample read and its producer-twin
//! de-duplication.

use super::{super::models::*, *};

/// The stream the demo tailer routes the raw database-log remainder to — the
/// sibling of [`DEFAULT_SERVER_STREAM`], and where `KIND_STATEMENT` rows land
/// (the collector's routing sends only deadlock/explain lines to
/// `_o2_dbm_server`; everything else in the tailed log, statement durations
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
        "SELECT {cols} FROM \"{stream}\"\n\
         WHERE {kind} IN ('{kind_stmt}', '{kind_explain}')\n    AND {dur} IS NOT NULL{preds}\n\
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

/// The server-samples endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`]. [`get_dbm_badges`] runs it as the zero-trace
/// fallback slice, keeping the two-stream merge and the producer-twin dedupe.
pub(crate) async fn read_server_samples_body(
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
    // The two default streams are processed CONCURRENTLY (schema read, then
    // ranked search, per stream); results are folded in stream order so the
    // first failing stream's error is the one reported, as the serial loop
    // did. The scope predicates are built PER STREAM, after that stream's
    // schema read: the instance predicate is presence-gated (N5), so one
    // stream's single-instance shape must not decide another's filter.
    let q = &q;
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
        let preds = dbm_event_preds(
            q.system.as_deref(),
            q.instance.as_deref(),
            q.database(),
            &present,
        );
        let capture_on = server_samples_capture_state(&present) == "on";
        // A stream that never captured contributes nothing — not an error.
        let stream_rows = match build_dbm_server_samples_sql(stream, &preds, limit, &present) {
            Some(sql) => {
                match run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time)
                    .await
                {
                    Ok(stream_rows) => stream_rows,
                    Err(e) => {
                        log::error!(
                            "[DbMonitoring] server samples read failed for {org_id}/{stream}: {e}"
                        );
                        return Err(MetaHttpResponse::internal_error(e));
                    }
                }
            }
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{super::testutil::*, *};

    /// The SQL pin, schema-complete: BOTH per-execution duration columns
    /// present, so the duration is their COALESCE (statement first — the
    /// plainer measurement wins) and both kinds are admitted. Wire aliases
    /// only; ranked slowest-first; bounded.
    #[test]
    fn test_server_samples_sql_pins_the_projection() {
        let sql = build_dbm_server_samples_sql("dbm_server_logs", "", 100, &all_cols()).unwrap();
        let expected = "SELECT _timestamp, o2_dbm_kind AS kind, o2_dbm_fingerprint AS fingerprint, \
                        o2_dbm_activity_query AS query, COALESCE(o2_dbm_stmt_duration_ms, o2_dbm_plan_duration_ms) AS duration_ms, \
                        o2_dbm_plan_rows_actual AS rows_actual, o2_dbm_engine AS db_system, \
                        o2_dbm_database AS db_namespace, o2_dbm_instance AS db_instance, \
                        o2_dbm_session_user AS db_user, o2_dbm_session_pid AS session_pid FROM \"dbm_server_logs\"\n\
                        WHERE o2_dbm_kind IN ('statement', 'explain')\n    \
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
        let sql = build_dbm_server_samples_sql("s", "", 100, &present).unwrap();
        assert!(sql.contains("o2_dbm_stmt_duration_ms AS duration_ms"));
        assert!(!sql.contains("COALESCE"));
        assert!(!sql.contains(server_vantage::O2_DBM_PLAN_DURATION_MS));
    }

    /// No per-execution duration column has ever landed → no SQL, an empty
    /// section rather than a 500. The capture state must agree — the SAME
    /// condition, reported and gated together so they cannot drift.
    #[test]
    fn test_server_samples_capture_gate_matches_the_sql_gate() {
        let mut present = all_cols();
        present.remove(server_vantage::O2_DBM_STMT_DURATION_MS);
        present.remove(server_vantage::O2_DBM_PLAN_DURATION_MS);
        assert!(build_dbm_server_samples_sql("s", "", 100, &present).is_none());
        assert_eq!(server_samples_capture_state(&present), "off");
        present.insert(server_vantage::O2_DBM_STMT_DURATION_MS.to_string());
        assert!(build_dbm_server_samples_sql("s", "", 100, &present).is_some());
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
        let env = server_samples_envelope(&rows, "_o2_dbm_server,dbm_server_logs", "on", 100);
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
}
