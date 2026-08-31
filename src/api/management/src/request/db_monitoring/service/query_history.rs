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

//! `/query/history` — the per-fingerprint time series, its raw-span backfill
//! and the folds (error codes, per-instance breakdown) layered onto it.

use super::{super::models::*, *};

/// The ONE raw trace stream the history backfill may aggregate over, or `None`.
///
/// `stream_param` (an explicit `?stream=`) wins and passes through unfiltered:
/// it has its own gate at the top of `get_dbm_query_history`, which 403s an
/// unreadable one. Re-filtering it here would turn that 403 into a silent 200.
///
/// Otherwise the stream is INFERRED from the rollup rows' `trace_stream_name`
/// — and that inference is why `readable` exists. `_o2_db_stats` is read
/// ORG-SCOPED, so its rows name every trace stream in the org regardless of the
/// caller's role. Feeding one straight to the backfill runs raw-span
/// aggregations against a stream the caller may not read: `run_dbm_search`
/// carries `user_id` for attribution and range limits but explicitly does not
/// authorize, and `involved_streams` catches it only afterwards — so the 403
/// discards the rows while the work has already run and its duration is
/// observable. Intersecting with `readable` here closes that window.
///
/// Ambiguity still beats permission: two candidate streams yield `None` (the
/// handler must not guess which one carries the fingerprint), and that holds
/// whether the second one was readable or not.
pub(crate) fn resolve_backfill_stream(
    stream_param: Option<&String>,
    rollup_rows: &[Value],
    readable: &BTreeSet<String>,
) -> Option<String> {
    if let Some(s) = stream_param {
        return Some(s.clone());
    }
    let names: BTreeSet<String> = rollup_rows
        .iter()
        .map(|r| get_str(r, "trace_stream_name"))
        .filter(|s| !s.is_empty() && readable.contains(s))
        .collect();
    (names.len() == 1).then(|| names.into_iter().next().unwrap())
}

/// K — maximum below-top-N windows backfilled from raw spans per history
/// request (design §6: a fingerprint predicate is not a cost bound; beyond the
/// cap the UI renders the distinct "below top-N" band).
pub(crate) const HISTORY_BACKFILL_MAX_WINDOWS: usize = 6;

/// Escaped `AND fingerprint = '…'` fragment.
pub(crate) fn fingerprint_pred(fingerprint: &str) -> String {
    format!("\n    AND fingerprint = '{}'", escape_sq(fingerprint))
}

/// History backfill: flat single-fingerprint aggregate over raw spans for ONE
/// window — bounded by the fingerprint predicate, by the per-window request
/// payload range the caller passes to [`rollup::run_dbm_search`], and by the
/// K-window request cap ([`HISTORY_BACKFILL_MAX_WINDOWS`]).
///
/// The window is NOT in this string: each backfill point runs its own search
/// whose payload carries `[window_end - interval_micros, window_end)`, which is
/// what separates one point from the next.
pub(crate) fn build_backfill_sql(stream_name: &str, fingerprint: &str) -> String {
    format!(
        "SELECT\n    COUNT(*) AS calls,\n    COUNT(*) FILTER (WHERE span_status = 'ERROR') AS errors,\n    SUM(end_time - start_time) AS total_time_ns,\n    CAST(approx_median(end_time - start_time) AS BIGINT) AS p50_ns,\n    CAST(approx_percentile_cont(end_time - start_time, 0.95) AS BIGINT) AS p95_ns,\n    CAST(approx_percentile_cont(end_time - start_time, 0.99) AS BIGINT) AS p99_ns,\n    MAX(end_time - start_time) AS max_ns,\n    COUNT(DISTINCT trace_id) AS traces\nFROM \"{}\"\nWHERE o2_db_fingerprint = '{}'",
        escape_ident(stream_name),
        escape_sq(fingerprint)
    )
}

/// Fold `error_class` rollup rows (one per window × (system, instance, env,
/// status code)) into one exact count per status code, largest first — the
/// FR-5 errors-by-code breakdown. These are the rollup's exact per-SQLSTATE
/// counts, never a sample-derived approximation: samples are capped, so
/// counting them undercounts precisely when errors matter most. An empty code
/// becomes `unknown`, matching the rollup's
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

/// The query-history endpoint's whole body, as a callable — the same handler/body
/// split every other DBM read uses, so the handler stays a config guard plus a
/// delegation. It returns [`HttpResponse`] rather than `Result<Value, _>` because
/// this read has several distinct 4xx exits (missing fingerprint, inverted range,
/// stream denial) that each carry their own status and message.
pub(crate) async fn read_query_history_response(
    org_id: &str,
    user_id: &str,
    q: &HistoryQuery,
) -> HttpResponse {
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
            org_id,
            user_id,
            stream,
            required_stream_for(DbmVantage::Client),
        )
        .await
    {
        return unauthorized_response();
    }
    // Carried into every search this handler runs — see `run_stats_search`.
    // The search-layer spelling of the caller: the `run_*_search` helpers
    // take an `Option`, while the auth gates take the plain `&str` param.
    let search_user = Some(user_id);
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
        org_id,
        "query_stats",
        &format!("{}{}", filters.sql_preds(), fingerprint_pred(fingerprint)),
    );
    // The history `db_totals` read feeds only window existence (distinct
    // `_timestamp`s under the totals filters) and backfill-stream resolution —
    // never the metrics — so it projects the four columns those consume
    // instead of dragging every stored column per row.
    let totals_projection = stats_projection(
        org_id,
        &[
            "_timestamp",
            "trace_stream_name",
            "db_system",
            "db_instance",
        ],
    )
    .await;
    let totals_sql = build_stats_sql_projected(
        org_id,
        "db_totals",
        &totals_filters.sql_preds(),
        &totals_projection,
    );

    // FR-5 errors-by-code: the rollup's EXACT per-status-code counts
    // (`error_class` records), summed across the windows in range. Sample-derived
    // counts undercount exactly when errors spike, so they are not used here.
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
            org_id,
            "error_class",
            &format!(
                "{}{}",
                ec_filters.sql_preds(),
                fingerprint_pred(fingerprint)
            ),
        );
        match run_stats_search(org_id, search_user, ec_sql, start_time, end_time).await {
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

    // Three independent reads over the same summary stream, concurrently.
    let (fp_res, totals_res, error_classes) = tokio::join!(
        run_stats_search(org_id, search_user, fp_sql, start_time, end_time),
        run_stats_search(org_id, search_user, totals_sql, start_time, end_time),
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
    //
    // Resolved BEFORE the backfill runs and intersected with what the caller may
    // read (see `resolve_backfill_stream`): the inferred name comes from
    // org-scoped rollup rows, so without this the backfill could aggregate raw
    // spans from a stream this caller has no access to.
    let readable_streams: BTreeSet<String> = involved_streams(
        org_id,
        user_id,
        // The explicit param is deliberately NOT passed: it is already gated at
        // the top of this handler, and `involved_streams` would return `None`
        // for an unreadable one — collapsing the readable set that the INFERRED
        // branch needs. Here we only ever want "what may this caller read".
        None,
        &[&totals_rows[..]],
    )
    .await
    .unwrap_or_default()
    .into_iter()
    .collect();
    let backfill_stream: Option<String> =
        resolve_backfill_stream(q.stream.as_ref(), &totals_rows, &readable_streams);

    let interval_micros = rollup::rollup_interval_secs() as i64 * 1_000_000;
    let mut series: Vec<Value> = Vec::new();
    for (window_end, rows) in &fp_by_window {
        let mut point = merge_rows(rows.iter().copied());
        point["timestamp"] = json!(window_end);
        series.push(point);
    }
    // The K backfill windows run CONCURRENTLY (`HISTORY_BACKFILL_MAX_WINDOWS`
    // bounds the fan-out), overlapped with stream resolution + tail
    // collection, which depend on `totals_rows` but not on the backfill.
    let org = org_id;
    let backfill_stream_ref = backfill_stream.as_ref();
    let backfill_fut = join_all(to_backfill.iter().map(|window_end| async move {
        let mut point = json!({ "timestamp": window_end, "below_top_n": true });
        if let Some(stream) = backfill_stream_ref {
            let sql = build_backfill_sql(stream, fingerprint);
            match rollup::run_dbm_search(
                org,
                search_user,
                sql,
                window_end - interval_micros,
                *window_end,
                true,
            )
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
                    log::warn!("[DbMonitoring] history backfill failed for {org}: {e}");
                }
            }
        }
        point
    }));
    // Live-tail point inputs (D4 — the series' live segment, never flat/zero).
    let tails_fut = async {
        // With no `?stream=`, this is exactly `readable_streams` — already
        // resolved above for the backfill, so reuse it rather than pay a second
        // round of per-stream OFGA checks. The explicit-param case keeps going
        // through `involved_streams`, which returns `None` for an unreadable
        // name so the handler can still 403 on it.
        let streams: Vec<String> = match q.stream.as_ref() {
            Some(_) => {
                involved_streams(org_id, user_id, q.stream.as_ref(), &[&totals_rows[..]]).await?
            }
            None => readable_streams.iter().cloned().collect(),
        };
        Some(collect_tails(org_id, &streams, start_time, end_time).await)
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
            &filters.span_sql_preds_for("dbspan."),
            endpoints_limit,
        );
        Some(rollup::run_dbm_search(org, search_user, sql, start_time, end_time, true).await)
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
        live_tail: true,
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{super::testutil::*, *};

    /// The INFERRED backfill stream must be filtered to what the caller may read.
    ///
    /// With no `?stream=`, `backfill_stream` is inferred from the rollup rows'
    /// `trace_stream_name` — and `_o2_db_stats` is read ORG-SCOPED, so those rows
    /// name every trace stream in the org, not the caller's. The inferred name
    /// then feeds up to `HISTORY_BACKFILL_MAX_WINDOWS` raw-span aggregations
    /// through `rollup::run_dbm_search`, whose `user_id` explicitly does NOT
    /// authorize (see its doc). `involved_streams` catches it only afterwards, so
    /// the work ran against another team's stream and its duration is observable
    /// — the same defect the explicit-param case above already fixed, on the
    /// branch that fix missed.
    ///
    /// [`resolve_backfill_stream`] is the chokepoint: it takes the readable set
    /// and returns `None` for anything outside it, so an unreadable inferred
    /// stream yields no backfill rather than an unauthorized scan.
    #[test]
    fn inferred_backfill_stream_is_dropped_when_the_caller_cannot_read_it() {
        let rows = vec![json!({ "trace_stream_name": "traces_finance" })];
        let readable: BTreeSet<String> = ["traces_prod".to_string()].into_iter().collect();

        assert_eq!(
            resolve_backfill_stream(None, &rows, &readable),
            None,
            "a stream absent from the readable set must not be backfilled"
        );
    }

    /// The readable case still resolves — the filter must not disable backfill.
    #[test]
    fn inferred_backfill_stream_survives_when_the_caller_can_read_it() {
        let rows = vec![json!({ "trace_stream_name": "traces_prod" })];
        let readable: BTreeSet<String> = ["traces_prod".to_string()].into_iter().collect();

        assert_eq!(
            resolve_backfill_stream(None, &rows, &readable),
            Some("traces_prod".to_string())
        );
    }

    /// Ambiguity still wins over the filter: two readable streams is a scope the
    /// handler must not guess between, exactly as before.
    #[test]
    fn inferred_backfill_stream_stays_none_when_two_readable_streams_match() {
        let rows = vec![
            json!({ "trace_stream_name": "traces_a" }),
            json!({ "trace_stream_name": "traces_b" }),
        ];
        let readable: BTreeSet<String> = ["traces_a".to_string(), "traces_b".to_string()]
            .into_iter()
            .collect();

        assert_eq!(resolve_backfill_stream(None, &rows, &readable), None);
    }

    /// An explicit `?stream=` bypasses inference — it is gated at the top of the
    /// handler by `can_read_stream`, which 403s rather than silently dropping.
    #[test]
    fn explicit_backfill_stream_is_passed_through_unfiltered() {
        let param = "traces_explicit".to_string();
        assert_eq!(
            resolve_backfill_stream(Some(&param), &[], &BTreeSet::new()),
            Some("traces_explicit".to_string()),
            "the explicit param has its own gate; re-filtering here would 200 \
             where the handler must 403"
        );
    }

    /// Asserted on SOURCE ORDER because it cannot be asserted on behaviour here:
    /// `can_read_stream` is unconditionally permissive on OSS (see
    /// `can_read_stream_is_permissive_on_oss`), so no OSS-observable response
    /// distinguishes a gate that runs early from one that runs late. Ordering is
    /// the whole invariant, so ordering is what this pins.
    #[test]
    fn test_history_checks_stream_permission_before_backfilling() {
        // Handler + the body it delegates to: the gate and the backfill are
        // now on opposite sides of that split, and the ORDER between them is
        // the invariant, so both halves are read as one.
        let handler = endpoint_impl("get_dbm_query_history", "read_query_history_response");
        let handler = handler.as_str();

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

    #[test]
    fn test_fingerprint_pred_escaped() {
        let pred = fingerprint_pred("abc'; DELETE FROM t;--");
        assert_eq!(pred, "\n    AND fingerprint = 'abc''; DELETE FROM t;--'");
    }

    #[test]
    fn test_backfill_sql_exact_and_escaped() {
        let sql = build_backfill_sql("otel_demo", "deadbeef");
        assert!(sql.starts_with("SELECT\n    COUNT(*) AS calls,"));
        assert!(sql.contains("FROM \"otel_demo\""));
        assert!(sql.ends_with("WHERE o2_db_fingerprint = 'deadbeef'"));

        // stream name is identifier-escaped, fingerprint quote-escaped
        let sql = build_backfill_sql("s\" --", "fp'x");
        assert!(sql.contains("FROM \"s\"\" --\""));
        assert!(sql.contains("o2_db_fingerprint = 'fp''x'"));
    }

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

    /// The calling-endpoints aggregation, folded into `/query/history`.
    ///
    /// It runs against the stream THIS handler resolves for its own backfill —
    /// the fact the standalone `/query/endpoints` had to be told, and which the
    /// page could only learn from this very response. Concurrent with the
    /// backfill and the tail collection, opt-in, and three-valued: rows, `null`
    /// (no stream), or the read-failed flag.
    #[test]
    fn test_history_folds_the_endpoints_section() {
        let src = dbm_prod_source();
        // Handler + delegated body. The folded section is built in the body
        // half; the handler half is what proves the body is still this
        // endpoint's. Scraped together so the property stays "the /query/history
        // ENDPOINT folds the section", independent of which file a line is in.
        let handler = endpoint_impl("get_dbm_query_history", "read_query_history_response");
        let handler = handler.as_str();
        // Guard: prove the scrape landed on the real implementation.
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
        // The standalone route stays registered alongside the folded section.
        assert!(src.contains("pub async fn get_dbm_query_endpoints("));
    }
}
