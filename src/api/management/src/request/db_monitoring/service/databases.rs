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

//! `/databases` — the namespace-grain rollup read.

use super::{super::models::*, *};

/// The databases endpoint's whole body — validation, both windows, envelope —
/// as a callable, so [`get_dbm_badges`] runs the SAME pipeline the tab renders
/// and the badge cannot disagree with the page by construction. `Err` carries
/// the ready HTTP response, exactly as [`read_databases_window`] does.
pub(crate) async fn read_databases_body(
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

    let totals_sql = build_stats_sql(org_id, "db_totals", &totals_filters.sql_preds());
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
    let qs_sql =
        build_stats_sql_projected(org_id, "query_stats", &filters.sql_preds(), &qs_projection);
    // Concurrent, where they were awaited one after the other: two independent
    // record families over the same summary stream have no ordering to honour.
    let (totals_rows, qs_rows) = match tokio::join!(
        run_stats_search(org_id, Some(user_id), totals_sql, start_time, end_time),
        run_stats_search(org_id, Some(user_id), qs_sql, start_time, end_time),
    ) {
        (Ok(t), Ok(q)) => (t, q),
        (t, q) => {
            let e = t.err().or(q.err()).unwrap();
            log::error!("[DbMonitoring] databases rollup read failed for {org_id}: {e}");
            return Err(MetaHttpResponse::internal_error(e));
        }
    };

    // Scopes the LIVE TAIL only -- the rollup pools below are intentionally
    // unfiltered by it. See the same call in `queries.rs` for why: the module
    // grant this route requires already authorizes every stream's DB rows.
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
        live_tail: true,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The split is opt-in: without the flag the response is byte-identical to
    /// what every existing caller already receives.
    #[test]
    fn test_databases_breakdown_is_opt_in() {
        let src = dbm_prod_source();
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
}
