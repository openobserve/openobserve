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

//! `/instances` — the scope picker's instance identity source.

use super::{super::models::*, *};

/// The distinct identities, as [`get_dbm_instances`] returns them.
///
/// An instance whose rows carry an engine but no instance name degrades to a
/// `null` instance rather than being dropped: it is the only evidence that
/// engine exists, and the picker renders it as an engine-level choice.
pub(crate) async fn read_dbm_instances_body(
    org_id: &str,
    user_id: &str,
    q: &DbmInstancesQuery,
) -> Result<Value, HttpResponse> {
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    // Auth BEFORE range parsing, so stream existence cannot be probed by a
    // caller who may not read it — the same ordering every sibling uses.
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
    // A failed schema read is reported, never absorbed into an empty set: an
    // empty picker and a broken picker must not look alike. Same rule as
    // `read_table_health_body`.
    let present = match present_dbm_columns(org_id, stream).await {
        Ok(present) => present,
        Err(e) => {
            log::error!("[DbMonitoring] instances schema read failed for {org_id}/{stream}: {e}");
            return Err(MetaHttpResponse::internal_error(e));
        }
    };
    // The stream has never carried DBM identity columns — an empty list, not
    // an error: nothing has been ingested yet is a real, renderable answer.
    if !present.contains(server_vantage::O2_DBM_ENGINE) {
        return Ok(json!({ "hits": [] }));
    }

    let hits = match build_dbm_instances_sql(stream, q.system.as_deref(), &present) {
        Some(sql) => run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time)
            .await
            .map_err(|e| {
                log::error!("[DbMonitoring] instances search failed for {org_id}/{stream}: {e}");
                MetaHttpResponse::internal_error(e)
            })?,
        None => Vec::new(),
    };

    // Project onto the wire names the fleet union already speaks, so the
    // client needs no second vocabulary for the same identity.
    let out: Vec<Value> = hits
        .iter()
        .filter_map(|row| {
            let engine = row
                .get(server_vantage::O2_DBM_ENGINE)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())?;
            let instance = row
                .get(server_vantage::O2_DBM_INSTANCE)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty());
            Some(json!({ "db_system": engine, "db_instance": instance }))
        })
        .collect();
    Ok(json!({ "hits": out }))
}

/// The distinct `(engine, instance)` identities in the server stream, as a
/// GROUP BY with a grid-stamped `_timestamp` beside it.
///
/// Deliberately NO `o2_dbm_kind` predicate. Every feed's records carry the
/// identity columns, so filtering to one kind is exactly the per-feed
/// incompleteness this endpoint exists to remove.
///
/// WHY GROUP BY AND NOT `SELECT DISTINCT`, which is what this was.
///
/// The result cache resolves a complex query's timestamp column from its
/// SELECT OUTPUT (`get_timestamp_column_name`). `DISTINCT` and `GROUP BY` are
/// both "complex" to the planner, so swapping one for the other changes
/// nothing on its own — what the old shape lacked was a projected
/// `_timestamp`, so the resolver returned none and the cache declined every
/// read. Verified against the real resolver: `has_ts=false` for the old SQL,
/// `has_ts=true` for this one.
///
/// `DISTINCT a, b` and `GROUP BY a, b` dedup identically; the group form is
/// used only because an aggregate projection cannot sit beside `DISTINCT`.
///
/// The stamp is the window's GRID BOUNDARY, not `MAX(_timestamp)`. A true max
/// moves with every ingest, so two viewers of the same window would hash to
/// different keys and the entry would never be reused — the resolver satisfied
/// and not one hit delivered. Flooring to the shared grid (the rollup's own
/// `floor_to_grid`) makes every viewer of a window agree on the key.
///
/// The extra column never reaches the wire: the handler projects
/// `db_system`/`db_instance` and drops the rest.
pub(crate) fn build_dbm_instances_sql(
    stream_name: &str,
    system: Option<&str>,
    present: &HashSet<String>,
) -> Option<String> {
    build_dbm_instances_sql_at(stream_name, system, present, now_micros())
}

/// [`build_dbm_instances_sql`] with the grid anchor passed in, so the stamping
/// is testable without a clock.
pub(crate) fn build_dbm_instances_sql_at(
    stream_name: &str,
    system: Option<&str>,
    present: &HashSet<String>,
    anchor_micros: i64,
) -> Option<String> {
    if !present.contains(server_vantage::O2_DBM_ENGINE) {
        return None;
    }
    let engine = server_vantage::O2_DBM_ENGINE;
    // The instance column can be absent on a partially-upgraded cluster.
    // Project a literal NULL so the row shape is stable either way.
    let instance_col = if present.contains(server_vantage::O2_DBM_INSTANCE) {
        server_vantage::O2_DBM_INSTANCE.to_string()
    } else {
        format!(
            "CAST(NULL AS VARCHAR) AS {}",
            server_vantage::O2_DBM_INSTANCE
        )
    };
    // `escape_ident`, not raw interpolation: a stream name carrying a double
    // quote would otherwise terminate the identifier. Same helper every
    // sibling builder uses.
    let mut sql = format!(
        "SELECT {engine}, {instance_col}, {grid} AS {ts} \
         FROM \"{stream}\" WHERE {engine} IS NOT NULL",
        grid = rollup::floor_to_grid(anchor_micros),
        ts = config::TIMESTAMP_COL_NAME,
        stream = escape_ident(stream_name),
    );
    if let Some(system) = system.map(str::trim).filter(|s| !s.is_empty()) {
        // Same escaping rule the sibling builders use for a user-supplied
        // literal: double any quote so it cannot terminate the string.
        sql.push_str(&format!(" AND {engine} = '{}'", system.replace('\'', "''")));
    }
    // GROUP BY names the STORAGE columns: `instance_col` may be a
    // `CAST(NULL AS VARCHAR) AS ...` projection on a partially-upgraded
    // stream, and a literal cannot be grouped by.
    let group_instance = if present.contains(server_vantage::O2_DBM_INSTANCE) {
        format!(", {}", server_vantage::O2_DBM_INSTANCE)
    } else {
        String::new()
    };
    sql.push_str(&format!(
        " GROUP BY {engine}{group_instance} ORDER BY {engine}"
    ));
    Some(sql)
}

#[cfg(test)]
mod tests {
    // Used only by enterprise-gated tests below; unused on an OSS build.
    #[cfg_attr(not(feature = "enterprise"), allow(unused_imports))]
    use super::{super::testutil::*, *};

    #[cfg(feature = "enterprise")]
    /// The whole point of this endpoint: NO kind predicate.
    ///
    /// Every feed's records carry the identity columns, so filtering to one
    /// kind reintroduces the per-feed incompleteness this exists to remove: a
    /// per-feed list names only the engines that feed has rows for, so a tab
    /// could not offer an instance it had no rows for.
    #[test]
    fn test_instances_sql_unions_every_feed() {
        let sql =
            build_dbm_instances_sql("_o2_dbm_server", None, &all_cols()).expect("instances sql");
        assert!(
            sql.contains("GROUP BY"),
            "the identity list must dedup, not read rows — GROUP BY since the \
             cache needs an aggregate timestamp beside it (see the builder)"
        );
        assert!(
            !sql.contains(server_vantage::O2_DBM_KIND),
            "filtering by kind would drop every engine whose feed is not that kind — \
             the exact defect this endpoint removes"
        );
        assert!(sql.contains(server_vantage::O2_DBM_ENGINE));
        assert!(sql.contains(server_vantage::O2_DBM_INSTANCE));
    }

    #[cfg(feature = "enterprise")]
    /// The identity list must be CACHEABLE.
    ///
    /// The result cache resolves a complex query's timestamp column from its
    /// SELECT output (`get_timestamp_column_name`). `SELECT DISTINCT a, b`
    /// projects no `_timestamp`, so the resolver returned nothing and every
    /// load re-scanned the window — verified against the real resolver, which
    /// answered `has_ts=false` for the old shape and `has_ts=true` for this one.
    ///
    /// `DISTINCT` → `GROUP BY` over the SAME columns is the same dedup; what
    /// earns the cache entry is the projected `_timestamp` beside it.
    #[test]
    fn test_instances_sql_projects_a_timestamp_so_the_result_cache_accepts_it() {
        let sql =
            build_dbm_instances_sql("_o2_dbm_server", None, &all_cols()).expect("instances sql");
        assert!(
            sql.contains("AS _timestamp"),
            "no projected _timestamp means the cache declines the query: {sql}"
        );
        assert!(
            sql.contains("GROUP BY"),
            "dedup moves to GROUP BY so the timestamp can be aggregated beside it: {sql}"
        );
        assert!(
            !sql.contains("SELECT DISTINCT"),
            "DISTINCT and an aggregate projection cannot coexist: {sql}"
        );
    }

    #[cfg(feature = "enterprise")]
    /// The projected `_timestamp` is a GRID BOUNDARY, not `MAX(_timestamp)`.
    ///
    /// A true max moves on every ingest, so two viewers of the same window
    /// would hash to different cache keys and the entry would never be reused
    /// — satisfying the resolver without delivering a single hit. The rollup
    /// already floors to the same grid for exactly this reason.
    #[test]
    fn test_instances_sql_grid_stamps_its_timestamp_so_the_key_is_stable() {
        let end = 1_800_000_000_000_000_i64;
        let a = build_dbm_instances_sql_at("_o2_dbm_server", None, &all_cols(), end).expect("sql");
        let b = build_dbm_instances_sql_at("_o2_dbm_server", None, &all_cols(), end + 1_000_000)
            .expect("sql");
        assert_eq!(
            a, b,
            "two reads one second apart in the same window must produce the SAME sql, \
             or the cache key differs and the entry is never reused"
        );
        assert!(
            !a.contains(&format!("MAX({})", config::TIMESTAMP_COL_NAME)),
            "a moving max defeats the cache key it was added to enable: {a}"
        );
    }

    #[cfg(feature = "enterprise")]
    /// A `system` chip must narrow the instance list beside it.
    #[test]
    fn test_instances_sql_narrows_by_engine() {
        let sql = build_dbm_instances_sql("_o2_dbm_server", Some("mssql"), &all_cols())
            .expect("instances sql");
        assert!(sql.contains("= 'mssql'"));
    }

    #[cfg(feature = "enterprise")]
    /// A partially-upgraded stream has the engine but not the instance column.
    /// The row SHAPE must stay stable so the client needs no second branch.
    #[test]
    fn test_instances_sql_survives_a_missing_instance_column() {
        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_INSTANCE);
        let sql = build_dbm_instances_sql("_o2_dbm_server", None, &without)
            .expect("engine alone is still a usable identity list");
        assert!(
            sql.contains("CAST(NULL AS VARCHAR)"),
            "the instance column must be projected as NULL, not omitted"
        );
    }

    #[cfg(feature = "enterprise")]
    /// No engine column at all — nothing to list, and that is not an error.
    #[test]
    fn test_instances_sql_skips_when_the_stream_has_no_identity() {
        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_ENGINE);
        assert_eq!(
            build_dbm_instances_sql("_o2_dbm_server", None, &without),
            None,
            "a stream with no engine column must skip the query, not 500 the endpoint"
        );
    }

    #[cfg(feature = "enterprise")]
    /// Injection-safe, like every other builder here.
    #[test]
    fn test_instances_sql_escapes_its_inputs() {
        let sql = build_dbm_instances_sql("ev\"il", Some("pg' OR '1'='1"), &all_cols())
            .expect("instances sql");
        assert!(sql.contains("'pg'' OR ''1''=''1'"));
        assert!(sql.contains("\"ev\"\"il\""));
    }

    /// The table-health handler must be registered on the router and
    /// re-exported — a handler nothing routes to is dead code that still passes
    /// every unit test. Both wire-up lines live OUTSIDE api.rs, so nothing else
    /// catches it.
    #[test]
    fn test_table_health_endpoint_is_wired_up() {
        let router = include_str!("../../../../../http/src/handler/http/router/mod.rs");
        assert!(
            router.contains("db_monitoring/table_health"),
            "the table-health route must be registered"
        );
        assert!(
            router.contains("get_dbm_table_health"),
            "the route must point at the handler"
        );
        assert!(
            router.contains("db_monitoring::handler::get_dbm_table_health"),
            "the route must name the handler through its own module — \
             a route pointing anywhere else is not this handler"
        );
    }

    /// **The table-health ROUTE stays registered unconditionally, even though
    /// the capability is enterprise-only.**
    ///
    /// The gate lives in the HANDLER BODY, which answers 403 on OSS (see
    /// `enterprise_read_endpoints_are_forbidden_on_oss`). An
    /// `#[cfg(feature = "enterprise")]` on the route registration would instead
    /// answer 404 — "no such endpoint" — and the UI would render a broken-build
    /// or wrong-URL story rather than an upgrade prompt. This is the only
    /// automated guard against someone reaching for the route-level `#[cfg]`,
    /// so the assertion stands whether or not the capability is gated: it
    /// checks the route still sits among its ungated DBM siblings.
    #[test]
    fn test_table_health_route_is_registered_ungated() {
        let router = include_str!("../../../../../http/src/handler/http/router/mod.rs");
        let idx = router
            .find("db_monitoring/table_health")
            .expect("route must exist");
        let neighbourhood = &router[idx.saturating_sub(2000)..idx];
        assert!(
            neighbourhood.contains("db_monitoring/deadlocks"),
            "the table-health route must live beside the other ungated DBM routes"
        );
    }
}
