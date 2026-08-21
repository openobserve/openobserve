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

//! `/samples` — the global sample-span read and its per-stream fold.

use super::{super::models::*, *};

/// FR-6 global samples: a deliberately small answer — the page shows "the
/// slowest executions", not "all executions", and 100 rows is already more
/// than a reader scans. Well under the 100k search cap by construction.
pub(super) const DEFAULT_SAMPLES_LIMIT: usize = 100;

pub(super) const MAX_SAMPLES_LIMIT: usize = 500;

/// The same predicate over RAW TRACE SPANS, which carry the column under its
/// `o2_db_` name — the split [`ScopeFilters::span_sql_preds`] exists for.
///
/// Escaping and stream-name validation live here, with the rest of this
/// module's SQL, so they stay injection-tested in one place.
pub(crate) fn span_fingerprint_pred(fingerprint: &str) -> String {
    format!("\n    AND o2_db_fingerprint = '{}'", escape_sq(fingerprint))
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
pub(crate) fn build_samples_sql(stream_name: &str, preds: &str, limit: usize) -> String {
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
WHERE o2_db_fingerprint IS NOT NULL{preds}
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

/// The samples endpoint's whole body as a callable — the same extraction as
/// [`read_databases_body`], and here it is also what keeps the ROUTE
/// compiling: the per-stream reads run through `buffered` closures capturing
/// `&org_id`, and awaiting the `include_server_fallback` section after them
/// inside the handler itself made those lifetimes early-bound, so
/// `get_dbm_samples` stopped satisfying axum's `for<'a>` Handler bound. That
/// fails at the route registration in `api/http`, naming neither the closure
/// nor the await. Inside a plain `async fn` the same code is fine.
pub(crate) async fn read_samples_body(
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
    let totals_sql = build_stats_sql(org_id, "db_totals", &totals_filters.sql_preds());
    let totals_rows =
        match run_stats_search(org_id, Some(user_id), totals_sql, start_time, end_time).await {
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
                .map(|s| openobserve_core::db_monitoring::stream_supports_db_monitoring(&s))
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
            let sql = build_samples_sql(&stream, &preds, limit);
            async move {
                let rows = rollup::run_dbm_search(org, Some(user_id), sql, start_time, end_time, true).await;
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
// `server_vantage` — never a raw receiver field. That is the D1 contract:
// receiver vocabularies are Development-stability and shift with collector
// releases; absorbing the drift once at ingest keeps these queries and the whole
// UI stable across upgrades.

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{super::testutil::*, *};

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
        let sql = build_samples_sql("otel_demo", &preds, 50);
        assert!(sql.contains("AND o2_db_system = 'postgresql'"));
        assert!(sql.contains("AND o2_db_fingerprint = 'deadbeef''x'"));
        // Still the one fixed shape — the scope narrows the WHERE, it does not
        // rewrite the projection or the ordering.
        assert!(sql.contains("ORDER BY duration_ns DESC\nLIMIT 50"));
        assert!(sql.contains("FROM \"otel_demo\""));
    }

    #[test]
    fn test_samples_sql_shape_and_injection() {
        let sql = build_samples_sql("otel_demo", "", 100);
        // Raw-span read: per-span rows, ns duration from the span bounds (the
        // module's one duration unit — never the µs `duration` column),
        // DB-span predicate, slowest first, bounded.
        assert!(sql.contains("end_time - start_time AS duration_ns"));
        assert!(
            !sql.contains(" duration DESC"),
            "must not read the µs column"
        );
        assert!(sql.contains("FROM \"otel_demo\""));
        assert!(sql.contains("WHERE o2_db_fingerprint IS NOT NULL"));
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
        let sql = build_samples_sql("s\" --", "", 10);
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
        // Handler + delegated body: the gate and the raw-span read are on
        // opposite sides of the split, and their ORDER is the invariant.
        let handler = endpoint_impl("get_dbm_samples", "read_samples_body");
        let handler = handler.as_str();

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
    ///
    /// Now a genuinely CROSS-FILE assertion: the thin half must be in
    /// `handler.rs` and the extracted body in the service layer. Reading one
    /// file could no longer tell the two apart — a handler that inlined its
    /// body again would still look thin if you only measured the file it moved
    /// out of — so each half is read from the layer it belongs to, and the
    /// delegation between them is asserted explicitly.
    ///
    /// The service half is THIS module rather than the whole corpus: the body
    /// belongs to `/samples`, so `samples.rs` is where it must be, and reading
    /// only this file keeps the assertion honest — the body reappearing in some
    /// other feature module would not satisfy it.
    #[test]
    fn test_samples_body_is_extracted_from_the_handler() {
        let service = prod_half(include_str!("samples.rs"));
        let handlers = prod_half(include_str!("../handler.rs"));

        // The body lives in the SERVICE layer, as a callable.
        assert!(
            service.contains("async fn read_samples_body("),
            "the samples body must be a callable in the service layer, like \
             every other DBM read"
        );
        // ...and NOT in the handler layer, which is the regression this pins.
        assert!(
            !handlers.contains("async fn read_samples_body("),
            "the samples body moved back into the handler layer"
        );

        // The handler is bounded by its own closing brace, so the measurement
        // cannot silently run on past the end of the fn.
        let start = handlers
            .find("pub async fn get_dbm_samples")
            .expect("the handler must exist");
        let handler = handlers[start..]
            .split("\n}\n")
            .next()
            .expect("the handler must have a body");
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
        let src = dbm_prod_source();
        let code = src;
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
}
