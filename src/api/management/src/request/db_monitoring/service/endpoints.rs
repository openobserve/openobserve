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

//! `/query/endpoints` — the calling-endpoint aggregation for one fingerprint.

use super::{super::models::*, *};

pub(super) const DEFAULT_ENDPOINTS_LIMIT: usize = 50;

pub(super) const MAX_ENDPOINTS_LIMIT: usize = 500;

/// Calling-endpoints: on-demand raw-trace aggregation for ONE fingerprint,
/// joining DB spans to their trace ROOT spans — the self-join GROUP BY shape
/// of the service-graph processor's `compute_stream_edges`. Bounded by the
/// fingerprint predicate on the DB side and by the request payload's window,
/// which the planner attaches as a `_timestamp` FilterExec to EACH scan — so
/// `dbspan` and `root` are each bounded independently even though neither
/// alias names `_timestamp` here. (Verified live: identical `calls`,
/// `total_time_ns`, `traces` and `scan_records` with and without the inline
/// bounds, including a narrow window whose root spans fall outside it.)
///
/// `scope_preds` carries the rest of the join key (engine, database, …) as
/// `dbspan.`-qualified fragments from [`ScopeFilters::span_sql_preds_for`], and
/// it is the difference between attributing callers and inventing them.
///
/// **A fingerprint is not a join key.** It hashes statement TEXT ONLY, so the
/// same `SELECT` under Postgres and under MySQL is one fingerprint — measured
/// live: fp `69219a9c7fc5039d` in org `default` is 125,195 postgres spans AND
/// 219,713 mysql spans. Aggregated on the fingerprint alone this returns one
/// 344,908-call row that belongs to neither engine, and hands it to a
/// server-vantage row that describes exactly one of them. The caller passes
/// the engine it resolved; with none passed the behaviour is unchanged, which
/// is why the parameter is additive rather than required.
pub(crate) fn build_endpoints_sql(
    stream_name: &str,
    fingerprint: &str,
    scope_preds: &str,
    limit: usize,
) -> String {
    let stream = escape_ident(stream_name);
    format!(
        r#"SELECT
    root.service_name AS service_name,
    root.operation_name AS endpoint,
    COUNT(*) AS calls,
    COUNT(*) FILTER (WHERE dbspan.span_status = 'ERROR') AS errors,
    SUM(dbspan.end_time - dbspan.start_time) AS total_time_ns,
    CAST(approx_percentile_cont(dbspan.end_time - dbspan.start_time, 0.95) AS BIGINT) AS p95_ns,
    COUNT(DISTINCT dbspan.trace_id) AS traces
FROM "{stream}" AS dbspan
LEFT JOIN "{stream}" AS root
    ON dbspan.trace_id = root.trace_id
    AND (root.reference_parent_span_id IS NULL OR root.reference_parent_span_id = '')
WHERE dbspan.o2_db_fingerprint = '{}'{scope_preds}
GROUP BY root.service_name, root.operation_name
ORDER BY calls DESC
LIMIT {limit}"#,
        escape_sq(fingerprint)
    )
}

/// The calling-endpoints endpoint's whole body, as a callable. Returns
/// [`HttpResponse`] rather than `Result<Value, _>` because this read has several
/// distinct 4xx exits (missing fingerprint, missing stream, stream denial,
/// inverted range) that each carry their own status and message.
pub(crate) async fn read_query_endpoints_response(
    org_id: &str,
    user_id: &str,
    q: &EndpointsQuery,
) -> HttpResponse {
    let Some(fingerprint) = q.fingerprint.as_deref().filter(|f| !f.is_empty()) else {
        return MetaHttpResponse::bad_request("fingerprint is required");
    };
    let Some(stream) = q.stream.as_deref().filter(|s| !s.is_empty()) else {
        return MetaHttpResponse::bad_request("stream is required");
    };
    // `stream` is caller-supplied and feeds a raw-trace aggregation, so it is
    // checked BEFORE the range/limit parsing below — a caller must not be able
    // to probe stream existence through error-message differences.
    if !can_read_stream(
        org_id,
        user_id,
        stream,
        required_stream_for(DbmVantage::Client),
    )
    .await
    {
        return unauthorized_response();
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return MetaHttpResponse::bad_request("start_time must be before end_time");
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_ENDPOINTS_LIMIT)
        .clamp(1, MAX_ENDPOINTS_LIMIT);

    let scope = ScopeFilters {
        system: q.system.clone(),
        namespace: q.namespace.clone(),
        ..Default::default()
    };
    // Carried into the search — see `run_dbm_search`.
    // The search-layer spelling of the caller: the `run_*_search` helpers
    // take an `Option`, while the auth gates take the plain `&str` param.
    let search_user = Some(user_id);
    let sql = build_endpoints_sql(
        stream,
        fingerprint,
        &scope.span_sql_preds_for("dbspan."),
        limit,
    );
    match rollup::run_dbm_search(org_id, search_user, sql, start_time, end_time, true).await {
        Ok(hits) => MetaHttpResponse::json(json!({ "hits": hits })),
        Err(e) => {
            log::error!("[DbMonitoring] endpoints query failed for {org_id}/{stream}: {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{super::testutil::*, *};

    /// D5 join guard. A fingerprint hashes statement TEXT ONLY, so the caller
    /// aggregation MUST be able to carry the rest of the key — otherwise the
    /// services it returns belong to whichever engines happen to share the
    /// statement, and the server row they enrich belongs to exactly one.
    ///
    /// Live on org `default`, fp `69219a9c7fc5039d`: 125,195 postgres spans and
    /// 219,713 mysql spans under one fingerprint. Unscoped this endpoint
    /// returns their union as a single caller row.
    #[test]
    fn test_endpoints_sql_scopes_by_engine_and_database() {
        let scope = ScopeFilters {
            system: Some("postgresql".into()),
            namespace: Some("dbmlab".into()),
            ..Default::default()
        };
        let sql = build_endpoints_sql(
            "otel_demo",
            "69219a9c7fc5039d",
            &scope.span_sql_preds_for("dbspan."),
            50,
        );
        // Qualified, because the query self-joins the stream to itself: a bare
        // `o2_db_system` is ambiguous across `dbspan` and `root`.
        assert!(sql.contains("AND dbspan.o2_db_system = 'postgresql'"));
        assert!(sql.contains("AND dbspan.o2_db_namespace = 'dbmlab'"));
        assert!(
            !sql.contains("AND o2_db_system = "),
            "an unqualified column would be ambiguous in the self-join"
        );
        // The scope narrows the WHERE only — same projection, same grouping.
        assert!(sql.contains("GROUP BY root.service_name, root.operation_name"));
        assert!(sql.ends_with("LIMIT 50"));

        // mysql/mariadb `top_query` records carry no database, so the caller
        // drops it and the engine alone is the key. Still scoped — the fusion
        // this guards against is BETWEEN engines.
        let mysql = ScopeFilters {
            system: Some("mysql".into()),
            ..Default::default()
        };
        let sql = build_endpoints_sql(
            "otel_demo",
            "69219a9c7fc5039d",
            &mysql.span_sql_preds_for("dbspan."),
            50,
        );
        assert!(sql.contains("AND dbspan.o2_db_system = 'mysql'"));
        assert!(!sql.contains("o2_db_namespace"));

        // Values are escaped exactly as every other predicate in this module,
        // and the alias is a literal, so no user input can name a column.
        let hostile = ScopeFilters {
            system: Some("pg'; DROP TABLE t;--".into()),
            ..Default::default()
        };
        let sql = build_endpoints_sql("otel_demo", "fp", &hostile.span_sql_preds_for("dbspan."), 5);
        assert!(sql.contains("dbspan.o2_db_system = 'pg''; DROP TABLE t;--'"));
    }

    #[test]
    fn test_endpoints_sql_shape_and_injection() {
        let sql = build_endpoints_sql("otel_demo", "deadbeef", "", 50);
        // The compute_stream_edges self-join shape: db spans joined to trace
        // roots, flat GROUP BY. The time window rides the search request
        // payload, not an inline predicate.
        assert!(sql.contains("FROM \"otel_demo\" AS dbspan"));
        assert!(sql.contains("LEFT JOIN \"otel_demo\" AS root"));
        assert!(sql.contains("ON dbspan.trace_id = root.trace_id"));
        assert!(sql.contains(
            "(root.reference_parent_span_id IS NULL OR root.reference_parent_span_id = '')"
        ));
        assert!(sql.contains("dbspan.o2_db_fingerprint = 'deadbeef'"));
        assert!(sql.contains("GROUP BY root.service_name, root.operation_name"));
        assert!(sql.ends_with("LIMIT 50"));

        let sql = build_endpoints_sql("s\"x", "fp' OR '1'='1", "", 10);
        assert!(sql.contains("FROM \"s\"\"x\" AS dbspan"));
        assert!(sql.contains("o2_db_fingerprint = 'fp'' OR ''1''=''1'"));
    }

    /// The section's cap is the standalone endpoint's cap, under the same
    /// default and clamp — a fold that silently returned a different number of
    /// rows would not be the same answer.
    #[test]
    fn test_history_endpoints_section_shares_the_endpoints_limit() {
        // Handler + delegated body: the clamp moved into the body half, and the
        // property is about the ENDPOINT's cap, not about a file.
        let handler = endpoint_impl("get_dbm_query_history", "read_query_history_response");
        let handler = handler.as_str();
        assert!(handler.len() > 2000, "scraped the wrong function");
        assert!(handler.contains("DEFAULT_ENDPOINTS_LIMIT"));
        assert!(handler.contains("MAX_ENDPOINTS_LIMIT"));
    }
}
