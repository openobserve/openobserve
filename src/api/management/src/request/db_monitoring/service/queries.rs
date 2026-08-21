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

//! `/queries` — the ranked statement list and its server-vantage fallback.

use super::{super::models::*, *};

const DEFAULT_QUERIES_LIMIT: usize = 100;

const MAX_QUERIES_LIMIT: usize = 1000;

/// The queries endpoint's whole body, as a callable — the ranked read plus the
/// conditional server-vantage fallback, kept out of the handler so the handler is
/// a config guard plus a delegation.
pub(crate) async fn read_queries_response(
    org_id: &str,
    user_id: &str,
    q: &QueriesQuery,
) -> HttpResponse {
    let mut body = match read_queries_body(org_id, user_id, q).await {
        Ok(body) => body,
        Err(resp) => return resp,
    };

    // ── The zero-trace fallback, folded server-side ──────────────────────
    //
    // The same conditional `/badges` runs, exposed to the tab that draws the
    // rows, so the fallback costs one round trip instead of two.
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
            read_server_queries_body(org_id, user_id, &sq).await,
        );
    }
    MetaHttpResponse::json(body)
}

/// The top-queries endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`], for the same badges-agree-with-tabs reason.
pub(super) async fn read_queries_body(
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
    let qs_sql = build_stats_sql(org_id, "query_stats", &filters.sql_preds());
    let qs_rows = match run_stats_search(org_id, Some(user_id), qs_sql, start_time, end_time).await
    {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[DbMonitoring] queries rollup read failed for {org_id}: {e}");
            return Err(MetaHttpResponse::internal_error(e));
        }
    };

    // `streams` scopes the LIVE TAIL, which reads raw spans where the stream is
    // the table. It deliberately does NOT filter `qs_rows`: those are
    // `_o2_db_stats` rollup rows, and reaching this function at all requires the
    // `db_monitoring` module grant (the route table makes it a hard prerequisite,
    // `bypass: false`), which `can_read_stream` treats as authorizing every
    // stream's DB rows -- see its doc comment. Filtering the pool by `streams`
    // would be a no-op that reads as a boundary this endpoint does not have.
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
        .clamp(1, MAX_QUERIES_LIMIT);
    hits.truncate(limit);

    let freshness = Freshness {
        data_through: collected.data_through,
        live_tail: true,
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

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
            &ScopeFilters::default().sql_preds(),
        );
        assert!(!sql.contains("OR 1=1"));
        assert!(!sql.contains("UNION"));
        assert!(!sql.contains("password"));

        // The call site takes only the filters — `search` must not appear in
        // the statement that builds the queries SQL.
        let src = dbm_prod_source();
        let code = src;
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
}
