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

//! `/plans` — the captured execution plans read.

use super::{super::models::*, *};

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
/// the exposed case is the common one — every stream that never ingested plans
/// (no top-query producer pointed at it) has none of these columns and must
/// render an empty section rather than a 500.
/// Whether plan capture has EVER run against this stream — `"on"` or `"off"`.
///
/// Zero plans has two causes and only one of them is the reader's to fix, so
/// the response has to say which it is. `"off"`: the stream carries no plan
/// hash column, meaning nothing was ever captured — no top-query producer has
/// pointed at this stream, and the collector hint is the right thing to show.
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
    preds: &str,
    present: &HashSet<String>,
) -> Option<String> {
    // The PLAN is what this view exists to show; the hash is how identical
    // plans are collapsed. A stream carrying plans but no hash column is
    // therefore still answerable, and refusing it here would hide every plan on
    // an engine whose plans cannot be hashed.
    if !present.contains(server_vantage::O2_DBM_PLAN)
        && !present.contains(server_vantage::O2_DBM_PLAN_HASH)
    {
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
    // GROUP BY THE HASH WHERE THERE IS ONE, and by the plan text where there is
    // not.
    //
    // Grouping on the hash alone made every HASHLESS plan invisible: they all
    // collapsed into a single NULL bucket that the detail page cannot key a
    // card on. That is not a hypothetical — `plan_hash` canonicalizes a plan by
    // walking its JSON structure, and SQL Server ships XML, so EVERY SQL Server
    // plan is hashless. They were stored correctly and then never rendered.
    //
    // The fallback is the plan TEXT itself, so two identical showplans still
    // collapse to one row and two different ones stay apart — which is the only
    // job the group key has here. It is deliberately NOT a hash we mint
    // ourselves over the raw XML: the showplan embeds per-execution costs and
    // row estimates, so such a key would change almost every collection and
    // report a plan regression that never happened. `plan_hash` stays NULL on
    // these rows, and the drift rules that read it keep correctly declining to
    // claim drift.
    //
    // The COALESCE is CONDITIONAL on the hash column existing in the schema.
    // Naming a column the stream has never written is not a null — it is
    // `unknown field`, which fails the whole query. A SQL Server-only stream
    // has no `o2_dbm_plan_hash` at all (nothing there can produce one), so on
    // that stream the group key is the plan text alone.
    let has_hash = present.contains(server_vantage::O2_DBM_PLAN_HASH);
    let has_plan = present.contains(server_vantage::O2_DBM_PLAN);
    let group_key = match (has_hash, has_plan) {
        (true, true) => format!(
            "COALESCE({hash}, {plan})",
            hash = server_vantage::O2_DBM_PLAN_HASH,
            plan = server_vantage::O2_DBM_PLAN,
        ),
        (true, false) => server_vantage::O2_DBM_PLAN_HASH.to_string(),
        // No hash column on this stream: group by the plan itself.
        (false, _) => server_vantage::O2_DBM_PLAN.to_string(),
    };
    // Only name the hash in the GROUP BY when the stream carries it.
    let hash_group = if has_hash {
        format!(", {}", server_vantage::O2_DBM_PLAN_HASH)
    } else {
        String::new()
    };
    // Same rule for the projection: a stream with no hash column still owes the
    // caller a `plan_hash` FIELD, so the DTO shape is stable — it is simply
    // null, which is the honest value for a plan that cannot be hashed.
    let hash_select = if has_hash {
        server_vantage::O2_DBM_PLAN_HASH.to_string()
    } else {
        "NULL".to_string()
    };
    Some(format!(
        "SELECT {hash_select} AS plan_hash, {plan_col}, {version_col}, {calls_col}, \
         MIN(_timestamp) AS first_seen, MAX(_timestamp) AS last_seen{source_col}{duration_cols} \
         FROM \"{stream}\"\n\
         WHERE {kind} IN ('{kind_top}', '{kind_explain}')\n    AND {fp} = '{fp_val}'\n\
    AND {plan_not_null}{preds}\n\
         GROUP BY {group_key}{hash_group}{source_group}\nORDER BY last_seen DESC",
        group_key = group_key,
        hash_group = hash_group,
        hash_select = hash_select,
        stream = escape_ident(stream_name),
        kind = server_vantage::O2_DBM_KIND,
        kind_top = escape_sq(server_vantage::KIND_TOP_QUERY),
        kind_explain = escape_sq(server_vantage::KIND_EXPLAIN),
        fp = server_vantage::O2_DBM_FINGERPRINT,
        fp_val = escape_sq(fingerprint),
        // A row with NO plan is not a plan row. Rows for the same statement
        // that carry only metrics must not form their own group: that renders
        // an empty card beside the real one, and on SQL Server — where there is
        // no hash to distinguish them — the empty group can sort first.
        plan_not_null = if has_plan {
            format!("{} IS NOT NULL", server_vantage::O2_DBM_PLAN)
        } else {
            "1 = 1".to_string()
        },
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
        //
        // NOT EVERY PLAN IS JSON. SQL Server ships an XML showplan, which
        // `plan_of` cannot parse and correctly declines — and returning null
        // there meant the plans view showed an empty card for a plan that was
        // stored, read and grouped perfectly well. A plan we cannot parse is
        // still a plan a reader can READ, so the raw text is passed through
        // when parsing fails. The UI already renders a string plan verbatim.
        "plan": server_vantage::plan_of(&json!({
            server_vantage::O2_DBM_PLAN: row.get("plan").cloned().unwrap_or(Value::Null)
        }))
        .or_else(|| {
            // ONLY a recognisable XML showplan, never arbitrary unparsed text.
            // The rule this must not break: malformed input reads as ABSENT so
            // a bad plan cannot fail a read. `{not json` is garbage and stays
            // null; `<ShowPlanXML …>` is a plan in a format we do not parse,
            // which is a different thing and worth showing.
            row.get("plan")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|p| p.starts_with("<ShowPlanXML"))
                .map(|p| Value::String(p.to_string()))
        })
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

/// The plans endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`], so [`get_dbm_query_insights`] emits a section
/// byte-identical to the standalone response rather than a re-derivation of it.
///
/// `prologue` shares the `(stream, schema)` pair with the sibling section when
/// both read the SAME default stream; `None` computes its own, exactly as the
/// standalone handler does.
pub(crate) async fn read_plans_body(
    org_id: &str,
    user_id: &str,
    q: &PlansQuery,
    prologue: Option<&DbmServerPrologue>,
) -> Result<Value, HttpResponse> {
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

    let rows = match build_dbm_plans_sql(stream, fingerprint, "", &present) {
        Some(sql) => {
            match run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time).await
            {
                Ok(rows) => rows,
                Err(e) => {
                    log::error!("[DbMonitoring] plans read failed for {org_id}/{stream}: {e}");
                    return Err(MetaHttpResponse::internal_error(e));
                }
            }
        }
        // The stream has never carried plans — an empty section, not an error.
        None => Vec::new(),
    };

    let hits: Vec<Value> = rows.iter().map(plan_row_to_dto).collect();

    Ok(plans_envelope(
        &hits,
        stream,
        plan_capture_state(&present),
        // auto_explain ingest has no gate of its own any more — DBM enabled
        // (checked by the handler) means it is on. The envelope keeps the
        // field so the UI's empty-state contract is unchanged.
        true,
    ))
}

// ─── The query-detail Logs-side pair (`/query/insights`) ─────────────────────

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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{super::testutil::*, *};

    /// The plans query groups by hash and returns first/last seen plus the call
    /// share — the shape W3.4 specifies.
    #[test]
    fn test_build_dbm_plans_sql_groups_by_hash() {
        let sql = build_dbm_plans_sql("_o2_dbm_server", "3a74e60b4bd45cc6", "", &all_cols())
            .expect("the plans query must build when the columns are present");

        assert!(
            sql.contains("GROUP BY COALESCE("),
            "distinct plans come from a GROUP BY, not a row fetch folded in Rust: {sql}"
        );
        assert!(
            sql.contains(server_vantage::O2_DBM_PLAN_HASH),
            "the hash is still the grouping key wherever a plan HAS one: {sql}"
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
        // (The requested window is the request payload's, not this string's.)
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
        let sql = build_dbm_plans_sql("_o2_dbm_server", "fp", "", &all_cols()).expect("plans sql");
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
    /// schema error, and the exposed case is the common one: every stream that
    /// never ingested plans has none of these columns.
    #[test]
    fn test_plans_sql_skips_when_the_plan_columns_are_absent() {
        // BOTH must be missing to skip. The hash alone is not the feature — the
        // PLAN is — and refusing to answer without a hash column hid every plan
        // on an engine whose plans cannot be hashed (SQL Server ships XML,
        // which the JSON plan walker correctly declines).
        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_PLAN_HASH);
        without.remove(server_vantage::O2_DBM_PLAN);
        assert_eq!(
            build_dbm_plans_sql("_o2_dbm_server", "fp", "", &without),
            None,
            "a stream with neither plan column must skip the query, not 500 the endpoint"
        );
    }

    #[test]
    fn test_plans_sql_still_answers_when_only_the_hash_is_missing() {
        // The SQL Server case. Every one of its plans is hashless, so a query
        // that bails without the hash column renders an empty plans view for a
        // statement whose plan is sitting in the stream.
        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_PLAN_HASH);
        let sql = build_dbm_plans_sql("_o2_dbm_server", "fp", "", &without)
            .expect("plans without a hash are still plans worth showing");
        assert!(
            sql.contains(server_vantage::O2_DBM_PLAN),
            "the plan must be projected: {sql}"
        );
    }

    #[test]
    fn test_plans_sql_groups_hashless_plans_by_their_text() {
        // Two identical showplans must collapse to ONE row and two different
        // ones must stay apart — the only job the group key has. Falling back
        // to the plan text does that without minting a hash over raw XML, which
        // would change on nearly every collection (the showplan embeds
        // per-execution costs) and fake a plan regression every interval.
        let sql = build_dbm_plans_sql("_o2_dbm_server", "fp", "", &all_cols()).expect("plans sql");
        assert!(
            sql.contains(&format!(
                "COALESCE({}, {})",
                server_vantage::O2_DBM_PLAN_HASH,
                server_vantage::O2_DBM_PLAN
            )),
            "a hashless plan must group by its own text, not collapse into one NULL bucket: {sql}"
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
        let env = plans_envelope(&hits, "_o2_dbm_server", "on", true);
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
            plans_envelope(
                std::slice::from_ref(&executed),
                "_o2_dbm_server",
                "on",
                true
            )["plan_source"],
            json!("auto_explain"),
            "hardcoding generic_null_bound at the response level mislabels every \
             executed plan in the window (E-C)"
        );
        assert_eq!(
            plans_envelope(
                &[executed, json!({"plan_source": "generic_null_bound"})],
                "_o2_dbm_server",
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
        let sql = build_dbm_plans_sql("_o2_dbm_server", "fp", "", &all_cols()).expect("plans sql");
        // The producer is still part of the key — the group list now begins
        // with the hash-or-text fallback, so this asserts the SOURCE is present
        // in the GROUP BY rather than pinning the exact prefix.
        let group_by = sql.split("GROUP BY").nth(1).expect("a GROUP BY clause");
        assert!(
            group_by.contains(server_vantage::O2_DBM_PLAN_SOURCE),
            "same hash + different producer must stay two rows: {sql}"
        );
        assert!(
            group_by.contains(server_vantage::O2_DBM_PLAN_HASH),
            "the hash must still group plans that have one: {sql}"
        );

        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_PLAN_SOURCE);
        without.remove(server_vantage::O2_DBM_PLAN_DURATION_MS);
        let sql = build_dbm_plans_sql("_o2_dbm_server", "fp", "", &without)
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
    /// reconfigure their collector — sending them to fix a non-problem.
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
            let runs = build_dbm_plans_sql("_o2_dbm_server", "fp", "", &present).is_some();
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
        let src = dbm_prod_source();
        let code = src;
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
}
