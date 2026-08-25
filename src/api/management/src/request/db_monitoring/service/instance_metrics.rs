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

//! `/instance_metrics` — the instance-health sweep: the metric catalog and the
//! single `UNION ALL` that reads every arm in one plan.

use super::{super::models::*, *};

/// How rows sharing a timestamp combine into one instance's figure.
///
/// Mirrors `DbmMetricAggregate` in `web/src/utils/dbm/instanceMetrics.ts` —
/// the FOLD still runs in the browser (see [`build_instance_metrics_sql`] on
/// why), so this exists to travel with the row and tell the client which rule
/// applies without the client re-deriving it from a stream name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DbmMetricAggregate {
    /// One row per database; only their total is the instance's figure.
    Sum,
    /// One reading per instance, repeated. Summing repeats would multiply a
    /// denominator and halve every saturation figure.
    Single,
    /// One row per REPLICA. An instance's lag is its worst replica's; summing
    /// reports a lag no replica actually has.
    Max,
}

impl DbmMetricAggregate {
    /// The wire token, matching the client's `DbmMetricAggregate` union.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Sum => "sum",
            Self::Single => "single",
            Self::Max => "max",
        }
    }
}

/// One metric stream in the instance-health catalog.
///
/// A PORT of `DBM_INSTANCE_METRICS` in `web/src/utils/dbm/instanceMetrics.ts`,
/// deliberately field-for-field: the client still folds these rows, so a
/// divergence between the two lists is a silent wrong answer rather than a
/// compile error. `instance_metrics_catalog_matches_the_client_spec` pins the
/// two together against the TypeScript source itself.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DbmMetricSpec {
    /// Canonical engine token, matching the client vantage's `db_system`.
    pub system: &'static str,
    /// The role this reading plays in the health column.
    pub role: &'static str,
    /// The metric name as OpenObserve stores it — one stream per metric.
    pub stream: &'static str,
    /// A monotonic counter: the window's figure is its delta, not its reading.
    pub cumulative: bool,
    pub aggregate: DbmMetricAggregate,
    /// Columns that split one instance's rows into separate series — the
    /// database on a per-database metric, the replica on replication lag.
    pub series_columns: &'static [&'static str],
    /// The column carrying this engine's instance endpoint.
    pub identity_column: &'static str,
    /// Narrows a stream carrying several series, e.g. `mysql_threads`' kinds.
    pub filter: Option<(&'static str, &'static str)>,
}

/// postgresqlreceiver writes its endpoint here; mysqlreceiver writes a UUID.
const PG_IDENTITY: &str = "service_instance_id";

/// mysqlreceiver's endpoint — the only MySQL column worth joining on.
const MYSQL_IDENTITY: &str = "mysql_instance_endpoint";

/// The metrics the health column reads.
///
/// Stream names are the metric names after OpenObserve's sanitisation (every
/// run outside `[A-Za-z0-9_:]` becomes `_`), so a typo here reads an empty
/// stream forever and is indistinguishable from a receiver switched off.
///
/// Every column name is a CLAIM about the collector, never a fact about the
/// stream — collectors rename attributes across versions. Which is why
/// [`build_instance_metrics_sql`] intersects this list with each stream's REAL
/// schema before naming a single column.
///
/// NO `mariadb_*` ENTRY, deliberately. No mariadb receiver exists upstream — a
/// MariaDB server is scraped by the MYSQL receiver pointed at it, so its
/// readings land in the `mysql_*` streams. The client aliases `mariadb` to
/// `mysql` at the join (`metricSystemFor`); duplicating the specs here would
/// read every mysql stream twice and fabricate a second fleet row per instance.
pub(crate) const DBM_INSTANCE_METRICS: &[DbmMetricSpec] = &[
    DbmMetricSpec {
        system: "postgresql",
        role: "connections",
        stream: "postgresql_backends",
        cumulative: false,
        aggregate: DbmMetricAggregate::Sum,
        // The RECEIVER's attribute (`postgresql.database.name`, sanitised),
        // not semconv's `db.namespace` — schemas are trusted over specs.
        series_columns: &["postgresql_database_name"],
        identity_column: PG_IDENTITY,
        filter: None,
    },
    DbmMetricSpec {
        system: "postgresql",
        role: "connectionLimit",
        stream: "postgresql_connection_max",
        cumulative: false,
        aggregate: DbmMetricAggregate::Single,
        series_columns: &[],
        identity_column: PG_IDENTITY,
        filter: None,
    },
    DbmMetricSpec {
        system: "postgresql",
        role: "replicationLag",
        stream: "postgresql_replication_data_delay",
        cumulative: false,
        // One row per replica (`replication_client` is the replica's address).
        aggregate: DbmMetricAggregate::Max,
        series_columns: &["replication_client"],
        identity_column: PG_IDENTITY,
        filter: None,
    },
    DbmMetricSpec {
        system: "postgresql",
        role: "cacheHit",
        stream: "postgresql_blks_hit",
        cumulative: true,
        aggregate: DbmMetricAggregate::Sum,
        series_columns: &["postgresql_database_name"],
        identity_column: PG_IDENTITY,
        filter: None,
    },
    DbmMetricSpec {
        system: "postgresql",
        role: "cacheRead",
        stream: "postgresql_blks_read",
        cumulative: true,
        aggregate: DbmMetricAggregate::Sum,
        series_columns: &["postgresql_database_name"],
        identity_column: PG_IDENTITY,
        filter: None,
    },
    DbmMetricSpec {
        system: "postgresql",
        role: "deadlocks",
        stream: "postgresql_deadlocks",
        cumulative: true,
        aggregate: DbmMetricAggregate::Sum,
        series_columns: &["postgresql_database_name"],
        identity_column: PG_IDENTITY,
        filter: None,
    },
    DbmMetricSpec {
        system: "mysql",
        role: "connections",
        stream: "mysql_threads",
        cumulative: false,
        aggregate: DbmMetricAggregate::Sum,
        series_columns: &[],
        identity_column: MYSQL_IDENTITY,
        // One stream carries all four thread kinds; `created` is a lifetime
        // total, and summing it in reads as massive saturation.
        filter: Some(("kind", "connected")),
    },
    DbmMetricSpec {
        system: "mysql",
        role: "replicationLag",
        stream: "mysql_replica_time_behind_source",
        cumulative: false,
        aggregate: DbmMetricAggregate::Max,
        series_columns: &[],
        identity_column: MYSQL_IDENTITY,
        filter: None,
    },
    // ONE STREAM, TWO ROLES. Postgres publishes hits and disk reads as two
    // metrics; mysqlreceiver publishes `mysql.buffer_pool.operations` with an
    // `operation` dimension, so both roles read one stream and are told apart
    // by `filter`. The two values are NOT disjoint — `read_requests` counts
    // every logical read and `reads` is the subset that missed — which is why
    // the client routes MySQL through `overlappingCacheHitRatio`.
    DbmMetricSpec {
        system: "mysql",
        role: "cacheHit",
        stream: "mysql_buffer_pool_operations",
        cumulative: true,
        aggregate: DbmMetricAggregate::Sum,
        series_columns: &[],
        identity_column: MYSQL_IDENTITY,
        filter: Some(("operation", "read_requests")),
    },
    DbmMetricSpec {
        system: "mysql",
        role: "cacheRead",
        stream: "mysql_buffer_pool_operations",
        cumulative: true,
        aggregate: DbmMetricAggregate::Sum,
        series_columns: &[],
        identity_column: MYSQL_IDENTITY,
        filter: Some(("operation", "reads")),
    },
    DbmMetricSpec {
        system: "mysql",
        role: "connectionLimit",
        // `mysql.connection.max` from the setup card's `sqlquery/mysql_limits`
        // recipe — mysqlreceiver publishes no `max_connections` of its own.
        stream: "mysql_connection_max",
        cumulative: false,
        aggregate: DbmMetricAggregate::Single,
        series_columns: &[],
        identity_column: MYSQL_IDENTITY,
        filter: None,
    },
];

/// The wire column carrying each row's role, so one result set folds per spec.
///
/// The arms have DIFFERENT identity columns and different label columns, so
/// without a discriminator a `connections` row and a `connectionLimit` row are
/// indistinguishable once unioned and every reading folds under the wrong role.
/// Prefixed `o2_` because it is ours, not the collector's — a receiver that one
/// day publishes a `role` label cannot collide with it.
const METRIC_ROLE_COL: &str = "o2_metric_role";

/// The wire column carrying each row's ENGINE.
///
/// The role is not enough on its own: `connections` is served by
/// `postgresql_backends` AND `mysql_threads`, so a client grouping by role
/// alone cannot tell which of the two identity columns a row's instance came
/// from. The join key is `(engine, host)`, so guessing wrong keys the reading
/// under an instance that does not exist and the health cell stays blank with
/// a full result set behind it.
const METRIC_SYSTEM_COL: &str = "o2_metric_system";

/// How many samples one instance-metrics sweep may return.
///
/// The whole sweep now shares ONE budget where the browser gave each of eight
/// streams its own 5000. A metric arrives once per collection interval per
/// instance, so this stays generous for a real fleet while bounding the union.
const INSTANCE_METRICS_SAMPLE_LIMIT: usize = 20000;

/// A stream name is interpolated as an identifier and must never escape it.
/// The catalog is a constant so this can only ever fail on a typo above, but
/// the gate is cheap and the failure mode it forecloses is SQL injection.
fn is_safe_metric_stream(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b':' || b == b'-')
}

/// `build_dbm_instances_sql_at` for the same argument at length.
///
/// `fields_by_stream` is each stream's REAL schema. A stream absent from the
/// map does not exist and is skipped — four of the catalog's metrics are
/// `enabled: false` upstream, so a missing stream is the ORDINARY case, and
/// naming one would 400 the entire union and blank the column for the streams
/// that do exist.
/// Used by the tests, which assert on the SQL TEXT; the handler wants the
/// swept list beside it and calls [`build_instance_metrics_query`] directly.
#[cfg(test)]
pub(crate) fn build_instance_metrics_sql(
    fields_by_stream: &HashMap<String, HashSet<String>>,
    anchor_micros: i64,
) -> Option<String> {
    build_instance_metrics_query(fields_by_stream, anchor_micros).map(|(sql, _)| sql)
}

/// [`build_instance_metrics_sql`] with the list of specs the union ACTUALLY
/// swept beside it.
///
/// The two must be derived together. A stream can be present in the schema map
/// and still be dropped from the union — a missing identity or filter column
/// makes it unqueryable — so a caller that reported "swept" from the schema map
/// alone would tell the client a stream was read that never entered the query.
/// The client folds by that list, and a role it is told to expect but never
/// receives is a cell that renders as an unread stream rather than an absent
/// one.
pub(crate) fn build_instance_metrics_query(
    fields_by_stream: &HashMap<String, HashSet<String>>,
    anchor_micros: i64,
) -> Option<(String, Vec<&'static DbmMetricSpec>)> {
    // The window's upper bound, FLOORED to the rollup grid.
    //
    // The scan is really bounded by the request payload (the planner pushes
    // `(start_time, end_time)` down onto each arm — see the rollup's builder
    // note), so this predicate narrows nothing the payload had not narrowed.
    // Its job is to make the SQL TEXT identical for every viewer of one grid
    // window: the raw `end_time` moves with each reader's clock, and a cache
    // key derived from SQL that never repeats is a cache that never hits.
    let grid = rollup::floor_to_grid(anchor_micros);
    let ts = config::TIMESTAMP_COL_NAME;

    let mut arms: Vec<String> = Vec::new();
    let mut swept: Vec<&'static DbmMetricSpec> = Vec::new();
    for spec in DBM_INSTANCE_METRICS {
        if !is_safe_metric_stream(spec.stream) {
            continue;
        }
        let Some(fields) = fields_by_stream.get(spec.stream) else {
            // The stream does not exist. Ordinary — skip it.
            continue;
        };
        // The identity is LOAD-BEARING: a reading with no instance joins to
        // nothing, so the stream is dropped rather than queried without it.
        if !fields.contains(spec.identity_column) {
            continue;
        }
        // A filter column is load-bearing too — `mysql_threads` without its
        // `kind` predicate sums four thread kinds into the connection count.
        if let Some((column, _)) = spec.filter
            && !fields.contains(column)
        {
            continue;
        }
        // The value and timestamp are the reading itself.
        if !fields.contains("value") || !fields.contains(ts) {
            continue;
        }
        // The series columns are OPTIONAL: they buy the per-database split,
        // and not every collector emits the label. Losing the whole health
        // signal over one absent label inverts the contract, so a missing one
        // costs the split and nothing else — the same trade the client's
        // retry-without-series-columns path already makes.
        let label = spec
            .series_columns
            .iter()
            .find(|column| fields.contains(**column))
            .map(|column| (*column).to_string())
            .unwrap_or_else(|| "CAST(NULL AS VARCHAR)".to_string());

        let filter = match spec.filter {
            Some((column, value)) => {
                format!(" AND {column} = '{}'", escape_sq(value))
            }
            None => String::new(),
        };
        arms.push(format!(
            "SELECT {ts}, value AS o2_metric_value, '{role}' AS {role_col}, \
             '{system}' AS {system_col}, \
             {identity} AS o2_metric_instance, {label} AS o2_metric_series \
             FROM \"{stream}\" WHERE {ts} <= {grid} AND {identity} IS NOT NULL{filter}",
            role = spec.role,
            role_col = METRIC_ROLE_COL,
            // The ENGINE, projected per row. One role is served by two engines
            // (`connections` is both `postgresql_backends` and `mysql_threads`),
            // so a client folding by role alone cannot tell which identity
            // column a row's instance came out of — and keying a MySQL endpoint
            // under Postgres's column produces a key that joins to nothing.
            system = spec.system,
            system_col = METRIC_SYSTEM_COL,
            identity = spec.identity_column,
            stream = escape_ident(spec.stream),
        ));
        swept.push(spec);
    }

    // No arm at all is no query — a union with no arms is not valid SQL, and
    // an empty health column is a renderable answer.
    if arms.is_empty() {
        return None;
    }
    // Newest FIRST. The search caps the rows it returns, and ordered oldest
    // first that cap discards the most RECENT readings — "latest" then comes
    // from early in the window and a saturated instance reads as calm.
    Some((
        format!(
            "SELECT * FROM ({}) ORDER BY {ts} DESC",
            arms.join(" UNION ALL "),
        ),
        swept,
    ))
}

/// The instance-health rows, as [`get_dbm_instance_metrics`] returns them.
///
/// GRACEFUL DEGRADATION IS THE CONTRACT. The client deliberately does not await
/// this read and swallows its errors — the query table is the page, and the
/// health column is an ornament on it. So every recoverable condition here
/// returns an EMPTY 200 rather than an error: no metric stream exists, no
/// stream carries the identity columns, the catalog is empty. Only a genuine
/// search failure is a 500, and the client treats even that as a blank column.
pub(crate) async fn read_instance_metrics_body(
    org_id: &str,
    user_id: &str,
    q: &InstanceMetricsQuery,
) -> Result<Value, HttpResponse> {
    // Auth BEFORE anything else, so stream existence cannot be probed by a
    // caller who may not read it — the same ordering every sibling uses.
    //
    // Authorized against METRICS, which is what these streams are. On
    // enterprise `can_read_stream` consults the `db_monitoring` module grant
    // first and falls back to a per-stream check, so a module grantee is
    // admitted here exactly as they are on the other DBM routes, while a caller
    // with neither the module grant nor metrics access is denied. The stream
    // named in the check is the
    // catalog's first, standing for the fixed set: the caller cannot choose it.
    let probe_stream = DBM_INSTANCE_METRICS
        .first()
        .map(|spec| spec.stream)
        .unwrap_or("postgresql_backends");
    if !can_read_stream(org_id, user_id, probe_stream, StreamType::Metrics).await {
        return Err(unauthorized_response());
    }
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }

    // Each catalog stream's REAL schema, concurrently. This is the server-side
    // replacement for the browser's `/streams?type=metrics` catalog read plus
    // its per-stream `/streams/{s}/schema` calls — nine round trips collapsed
    // into cache-backed local lookups. A stream that does not exist resolves to
    // `None` and is simply absent from the map, which is how
    // `build_instance_metrics_sql` learns to skip it.
    let mut wanted: Vec<&str> = DBM_INSTANCE_METRICS.iter().map(|s| s.stream).collect();
    wanted.sort_unstable();
    wanted.dedup();
    let schemas = join_all(wanted.into_iter().map(|stream| async move {
        let fields = match infra::schema::get(org_id, stream, StreamType::Metrics).await {
            Ok(schema) => schema
                .fields()
                .iter()
                .map(|f| f.name().to_string())
                .collect::<HashSet<String>>(),
            // A stream that has never been written has no schema. That is the
            // ordinary "receiver not enabled" case, NOT an error.
            Err(_) => HashSet::new(),
        };
        (stream.to_string(), fields)
    }))
    .await;
    let fields_by_stream: HashMap<String, HashSet<String>> = schemas
        .into_iter()
        .filter(|(_, fields)| !fields.is_empty())
        .collect();

    let Some((sql, swept)) = build_instance_metrics_query(&fields_by_stream, end_time) else {
        // No metric stream exists. An empty answer, not an error — this is what
        // a deployment whose collector ships no database metrics looks like.
        return Ok(json!({ "hits": [], "streams": [] }));
    };

    let hits = run_metrics_search(org_id, Some(user_id), sql, start_time, end_time)
        .await
        .map_err(|e| {
            log::error!("[DbMonitoring] instance metrics search failed for {org_id}: {e}");
            MetaHttpResponse::internal_error(e)
        })?;

    // Project onto the shape the client's `foldMetricRows` consumes. The spec
    // travels WITH the rows so the client folds by the server's catalog rather
    // than a second copy of it that could drift.
    // Exactly the specs the union swept — NOT every stream whose schema
    // exists. A stream present but unqueryable (no identity column) never
    // entered the query, and telling the client to expect its role would
    // render an unread stream as a read one that reported nothing.
    let streams: Vec<Value> = swept
        .iter()
        .map(|spec| {
            json!({
                "stream": spec.stream,
                "role": spec.role,
                "system": spec.system,
                "cumulative": spec.cumulative,
                "aggregate": spec.aggregate.as_str(),
            })
        })
        .collect();

    let out: Vec<Value> = hits
        .iter()
        .filter_map(|row| {
            let role = row.get(METRIC_ROLE_COL).and_then(|v| v.as_str())?;
            let instance = row
                .get("o2_metric_instance")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())?;
            let value = row.get("o2_metric_value").and_then(as_f64_loose)?;
            let timestamp = get_i64(row, config::TIMESTAMP_COL_NAME);
            if timestamp == 0 {
                return None;
            }
            let system = row.get(METRIC_SYSTEM_COL).and_then(|v| v.as_str())?;
            let series = row
                .get("o2_metric_series")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty());
            Some(json!({
                "role": role,
                "system": system,
                "instance": instance,
                "series": series,
                "value": value,
                config::TIMESTAMP_COL_NAME: timestamp,
            }))
        })
        .collect();

    Ok(json!({ "hits": out, "streams": streams }))
}

/// Run one instance-metrics query against the METRICS streams.
///
/// The twin of [`run_events_search`], differing only in stream type — which is
/// the one thing that must not be shared by a parameter, because a read that
/// names the wrong stream type consults the wrong OFGA object and silently
/// authorizes (see [`DbmVantage`]). Cached, through the same cache wrapper
/// every sibling read uses: the window is the caller's, so repeated views of
/// one window share one answer.
async fn run_metrics_search(
    org_id: &str,
    user_id: Option<&str>,
    sql: String,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<Value>, anyhow::Error> {
    let req = rollup::dbm_search_request(
        sql,
        start_time,
        end_time,
        INSTANCE_METRICS_SAMPLE_LIMIT as i64,
        30,
        true,
    );
    // `user_id` carries the role-derived query-range limit and attribution, NOT
    // authorization — the handler above checked that already.
    let trace_id = config::ider::generate();
    let resp = search_service::cache::search(
        &trace_id,
        org_id,
        StreamType::Metrics,
        user_id.map(str::to_string),
        &req,
        String::new(),
        false,
        None,
        false,
    )
    .await?;
    openobserve_core::db_monitoring::hits_or_partial_error(resp, "instance_metrics")
}

#[cfg(test)]
mod tests_instance_metrics {
    use super::*;

    /// Every stream the catalog names, as a schema-complete deployment.
    fn all_metric_fields() -> HashMap<String, HashSet<String>> {
        DBM_INSTANCE_METRICS
            .iter()
            .map(|spec| {
                let mut fields: HashSet<String> = HashSet::new();
                fields.insert(config::TIMESTAMP_COL_NAME.to_string());
                fields.insert("value".to_string());
                fields.insert(spec.identity_column.to_string());
                for column in spec.series_columns {
                    fields.insert((*column).to_string());
                }
                if let Some((column, _)) = spec.filter {
                    fields.insert(column.to_string());
                }
                (spec.stream.to_string(), fields)
            })
            .collect()
    }

    /// RED 1 — the sweep is ONE query, not N.
    ///
    /// The whole speedup is that eight searches become one UNION ALL, so the
    /// builder must emit a single statement that names every present stream.
    #[test]
    fn test_instance_metrics_sql_is_one_union_over_every_present_stream() {
        let fields = all_metric_fields();
        let sql = build_instance_metrics_sql(&fields, 1_800_000_000_000_000)
            .expect("a schema-complete deployment must yield sql");

        for spec in DBM_INSTANCE_METRICS {
            assert!(
                sql.contains(&format!("FROM \"{}\"", spec.stream)),
                "every present stream must be a UNION arm: {} missing from {sql}",
                spec.stream
            );
        }
        assert!(
            sql.contains("UNION ALL"),
            "the sweep must be one union, not N searches: {sql}"
        );
    }

    /// RED 2 — a stream that does not exist is SKIPPED, not an error.
    ///
    /// Four of the catalog's metrics are `enabled: false` upstream, so a
    /// missing stream is the ordinary case. Naming one in the union 400s the
    /// whole read and blanks the health column for the streams that DO exist.
    #[test]
    fn test_absent_metric_stream_is_skipped_rather_than_named() {
        let mut fields = all_metric_fields();
        fields.remove("postgresql_deadlocks");
        let sql = build_instance_metrics_sql(&fields, 1_800_000_000_000_000).expect("sql");

        assert!(
            !sql.contains("postgresql_deadlocks"),
            "an absent stream must not be named — it 400s the whole union: {sql}"
        );
        assert!(
            sql.contains("FROM \"postgresql_backends\""),
            "the streams that DO exist must still be read: {sql}"
        );
    }

    /// RED 3 — no present stream at all is `None`, never a malformed union.
    #[test]
    fn test_no_present_streams_yields_no_sql() {
        assert!(
            build_instance_metrics_sql(&HashMap::new(), 1_800_000_000_000_000).is_none(),
            "an empty catalog must yield no query rather than a union with no arms"
        );
    }

    /// RED 4 — every arm carries the ROLE, so one result set folds per spec.
    ///
    /// The arms have different identity columns and different label columns;
    /// without a discriminator the client cannot tell a `connections` row from
    /// a `connectionLimit` row and every reading folds under the wrong role.
    #[test]
    fn test_every_union_arm_tags_its_role_and_stream() {
        let fields = all_metric_fields();
        let sql = build_instance_metrics_sql(&fields, 1_800_000_000_000_000).expect("sql");
        for spec in DBM_INSTANCE_METRICS {
            assert!(
                sql.contains(&format!("'{}' AS o2_metric_role", spec.role)),
                "role {} must be projected so the fold can route the row: {sql}",
                spec.role
            );
        }
    }

    /// RED 5 — a stream missing its IDENTITY column is dropped whole.
    ///
    /// The identity is what joins a reading to a database row. Querying around
    /// it would return numbers that belong to no instance, and naming a column
    /// the stream lacks 400s the union.
    #[test]
    fn test_stream_without_its_identity_column_is_dropped() {
        let mut fields = all_metric_fields();
        fields
            .get_mut("postgresql_backends")
            .expect("fixture")
            .remove("service_instance_id");
        let sql = build_instance_metrics_sql(&fields, 1_800_000_000_000_000).expect("sql");
        assert!(
            !sql.contains("postgresql_backends"),
            "a reading with no instance identity joins to nothing: {sql}"
        );
    }

    /// RED 6 — a missing OPTIONAL label column costs the split, not the stream.
    ///
    /// The series columns buy the per-database split. Losing the whole health
    /// signal over one optional label inverts the contract — the client's
    /// `collectInstanceMetrics` already retries without them for this reason.
    #[test]
    fn test_missing_series_column_keeps_the_stream_without_the_split() {
        let mut fields = all_metric_fields();
        fields
            .get_mut("postgresql_backends")
            .expect("fixture")
            .remove("postgresql_database_name");
        let sql = build_instance_metrics_sql(&fields, 1_800_000_000_000_000).expect("sql");
        // Scoped to the AFFECTED arm: the sibling streams still carry the
        // label legitimately, so asserting over the whole union would pass
        // only by accident and fail for the wrong reason.
        let arm = sql
            .split(" UNION ALL ")
            .find(|arm| arm.contains("FROM \"postgresql_backends\""))
            .expect("an optional label must not cost the whole stream");
        assert!(
            !arm.contains("postgresql_database_name"),
            "a column this stream lacks must not be named in its arm: {arm}"
        );
        assert!(
            arm.contains("CAST(NULL AS VARCHAR) AS o2_metric_series"),
            "the arm must still project the union's fixed shape: {arm}"
        );
        // The union stays uniform — the label column is filled, not dropped.
        assert!(
            sql.contains("postgresql_database_name AS o2_metric_series"),
            "streams that DO carry the label must keep their split: {sql}"
        );
    }

    /// RED 7 — the window is GRID-STAMPED, so the result cache can key it.
    ///
    /// Same rule the instances read follows: two viewers of one window must
    /// produce byte-identical SQL, or the cache key differs and no entry is
    /// ever reused.
    #[test]
    fn test_instance_metrics_sql_is_stable_within_a_grid_window() {
        let fields = all_metric_fields();
        let end = 1_800_000_000_000_000_i64;
        let a = build_instance_metrics_sql(&fields, end).expect("sql");
        let b = build_instance_metrics_sql(&fields, end + 1_000_000).expect("sql");
        assert_eq!(
            a, b,
            "two reads one second apart in one window must hash to the same cache key"
        );
    }
}

#[cfg(test)]
mod tests_instance_metrics_contract {
    use super::*;

    /// The client TypeScript source, read at compile time.
    ///
    /// Path is relative to this file:
    ///   src/api/management/src/request/db_monitoring/service/instance_metrics.rs
    ///   → ../../../../../../../web/src/utils/dbm/instanceMetrics.ts
    const CLIENT_SPEC: &str =
        include_str!("../../../../../../../web/src/utils/dbm/instanceMetrics.ts");

    /// The catalog here and the catalog in the browser must name the SAME
    /// streams.
    ///
    /// The fold still runs client-side, keyed by role, so a stream this server
    /// sweeps but the client cannot fold is wasted work, and a stream the
    /// client expects but this server never sweeps is a silently blank health
    /// cell. Neither shows up as a failure anywhere else — the page just
    /// renders slightly less, which is exactly the defect class this whole
    /// module keeps refusing to ship.
    #[test]
    fn instance_metrics_catalog_matches_the_client_spec() {
        for spec in DBM_INSTANCE_METRICS {
            assert!(
                CLIENT_SPEC.contains(&format!("stream: \"{}\"", spec.stream)),
                "server sweeps `{}` but the client spec does not name it — the \
                 rows come back and nothing folds them",
                spec.stream
            );
            assert!(
                CLIENT_SPEC.contains(&format!("role: \"{}\"", spec.role)),
                "server tags rows `{}` but the client knows no such role",
                spec.role
            );
        }
        // And the other direction: a stream the CLIENT names that this server
        // never sweeps is a permanently blank cell.
        for line in CLIENT_SPEC.lines() {
            let Some(rest) = line.trim().strip_prefix("stream: \"") else {
                continue;
            };
            let Some(stream) = rest.split('"').next() else {
                continue;
            };
            assert!(
                DBM_INSTANCE_METRICS.iter().any(|s| s.stream == stream),
                "the client spec names `{stream}` but the server sweep omits it \
                 — that cell can never populate"
            );
        }
    }

    /// The identity columns must agree across the two languages too.
    ///
    /// The identity is what joins a reading to a database row. If the server
    /// projected `service_instance_id` where the client reads
    /// `mysql_instance_endpoint`, every row would arrive and every one would
    /// fail to join — a blank column with a full result set behind it.
    #[test]
    fn instance_metrics_identity_columns_match_the_client_spec() {
        assert!(
            CLIENT_SPEC.contains("PG_IDENTITY = \"service_instance_id\""),
            "the client's Postgres identity column moved; the server's join key \
             is now wrong and every PG health cell will blank"
        );
        assert!(
            CLIENT_SPEC.contains("MYSQL_IDENTITY = \"mysql_instance_endpoint\""),
            "the client's MySQL identity column moved; see above"
        );
        for spec in DBM_INSTANCE_METRICS {
            let expected = match spec.system {
                "postgresql" => PG_IDENTITY,
                "mysql" => MYSQL_IDENTITY,
                other => panic!("unknown engine in the catalog: {other}"),
            };
            assert_eq!(
                spec.identity_column, expected,
                "`{}` must join on its own engine's identity column — MySQL's \
                 `service_instance_id` is a UUID and joins to nothing",
                spec.stream
            );
        }
    }

    /// The endpoint accepts NO stream and NO SQL from the caller.
    ///
    /// This is the security property the whole design rests on. The
    /// `db_monitoring` module grant is meant to buy DATABASE HEALTH COLUMNS;
    /// a `?streams=` or `?sql=` parameter would turn this route into the
    /// generic metrics search API wearing a DBM path, and hand every DBM
    /// grantee exactly the arbitrary metrics access the module boundary exists
    /// to withhold. Asserted structurally because no behavioural test can see
    /// a parameter that was never added.
    #[test]
    fn instance_metrics_query_accepts_no_caller_supplied_sql_or_streams() {
        let src = dbm_prod_source();
        let start = src
            .find("pub struct InstanceMetricsQuery {")
            .expect("InstanceMetricsQuery must exist");
        let end = start
            + src[start..]
                .find('}')
                .expect("InstanceMetricsQuery must be a struct");
        let body = &src[start..end];

        for forbidden in ["sql", "stream", "streams", "query", "table", "metric"] {
            assert!(
                !body.contains(&format!("pub {forbidden}:")),
                "InstanceMetricsQuery must not accept `{forbidden}` — the SQL and \
                 the stream list are server-constructed, and that is a security \
                 property, not a convenience:\n{body}"
            );
        }
        // Only the window is the caller's.
        assert!(
            body.contains("pub start_time:") && body.contains("pub end_time:"),
            "the window is the one thing the caller does supply:\n{body}"
        );
    }

    /// Every stream the sweep can ever name is a safe identifier.
    ///
    /// The catalog is a constant, so this can only fail on a typo — but the
    /// failure it forecloses is SQL injection through a table name, and the
    /// guard is one loop.
    #[test]
    fn every_catalog_stream_is_a_safe_identifier() {
        for spec in DBM_INSTANCE_METRICS {
            assert!(
                is_safe_metric_stream(spec.stream),
                "`{}` is not a safe identifier and would be interpolated into \
                 a FROM clause",
                spec.stream
            );
            if let Some((column, value)) = spec.filter {
                assert!(
                    is_safe_metric_stream(column),
                    "filter column `{column}` is interpolated bare into the WHERE"
                );
                assert!(
                    !value.contains('\''),
                    "filter value `{value}` must not carry a quote"
                );
            }
        }
    }

    /// A caller with NEITHER the module grant NOR metrics access is denied.
    ///
    /// The endpoint's whole reason for existing is that the `db_monitoring`
    /// module grant admits a caller the generic `/streams` and `/_search`
    /// routes turned away. That must not become "admits everyone": the read
    /// goes through `can_read_stream`, whose deny path is
    /// `stream_read_decision(false, false)`.
    #[test]
    fn instance_metrics_denies_a_caller_with_neither_grant() {
        assert!(
            !stream_read_decision(false, false),
            "no module grant and no metrics grant must stay denied"
        );
    }

    /// The read authorizes against METRICS, which is what these streams are.
    ///
    /// Naming the wrong stream type consults the wrong OFGA object and
    /// SILENTLY AUTHORIZES — the one wire-up mistake in this file with a
    /// security consequence (see `DbmVantage`). These streams are neither
    /// vantage's: they are the COLLECTOR's, so the check names
    /// `StreamType::Metrics` directly rather than borrowing a vantage.
    #[test]
    fn instance_metrics_authorizes_against_the_metrics_stream_type() {
        let src = dbm_prod_source();
        let start = src
            .find("async fn read_instance_metrics_body(")
            .expect("the read body must exist");
        let body = &src[start..start + 2200];
        let call = body
            .find("can_read_stream(")
            .expect("the read must authorize before it does anything else");
        let args = &body[call..body.len().min(call + 200)];
        assert!(
            args.contains("StreamType::Metrics"),
            "these are metrics streams; authorizing them as Logs or Traces \
             consults an object no grant ever creates:\n{args}"
        );
        // Auth comes FIRST — before the range parse and before any schema
        // lookup, so stream existence cannot be probed by a caller who may not
        // read it. Same ordering every sibling enforces.
        let range = body
            .find("resolve_range(")
            .expect("the read must resolve its range");
        assert!(
            call < range,
            "auth must precede range parsing and schema reads, or existence \
             becomes probeable"
        );
    }
}

#[cfg(test)]
mod tests_instance_metrics_swept {
    use super::*;

    fn fields_for(spec: &DbmMetricSpec) -> HashSet<String> {
        let mut fields: HashSet<String> = HashSet::new();
        fields.insert(config::TIMESTAMP_COL_NAME.to_string());
        fields.insert("value".to_string());
        fields.insert(spec.identity_column.to_string());
        for column in spec.series_columns {
            fields.insert((*column).to_string());
        }
        if let Some((column, _)) = spec.filter {
            fields.insert(column.to_string());
        }
        fields
    }

    fn all_metric_fields() -> HashMap<String, HashSet<String>> {
        DBM_INSTANCE_METRICS
            .iter()
            .map(|spec| (spec.stream.to_string(), fields_for(spec)))
            .collect()
    }

    /// The reported sweep list is what the QUERY did, not what the schema map
    /// held.
    ///
    /// A stream can exist and still be unqueryable — no identity column means
    /// its readings join to nothing, so it never enters the union. Reporting
    /// it as swept tells the client to expect a role that can never arrive,
    /// and the cell renders an unread stream as a read one that found nothing.
    /// Those are different facts and the page words them differently.
    #[test]
    fn swept_list_names_only_the_streams_the_union_really_reads() {
        let mut fields = all_metric_fields();
        // Present in the catalog, but missing the column that makes it
        // queryable — the exact case the schema map alone cannot see.
        fields
            .get_mut("postgresql_backends")
            .expect("fixture")
            .remove("service_instance_id");

        let (sql, swept) =
            build_instance_metrics_query(&fields, 1_800_000_000_000_000).expect("sql");

        assert!(
            !swept
                .iter()
                .any(|spec| spec.stream == "postgresql_backends"),
            "a stream dropped from the union must not be reported as swept"
        );
        assert!(
            !sql.contains("postgresql_backends"),
            "and it must genuinely not be in the query: {sql}"
        );
        // Every stream that IS reported swept must really be an arm.
        for spec in &swept {
            assert!(
                sql.contains(&format!("FROM \"{}\"", spec.stream)),
                "`{}` is reported swept but is not a union arm",
                spec.stream
            );
        }
    }

    /// Every arm of the union is reported, so the client can fold all of it.
    #[test]
    fn swept_list_covers_every_arm_of_a_complete_sweep() {
        let (_, swept) =
            build_instance_metrics_query(&all_metric_fields(), 1_800_000_000_000_000).expect("sql");
        assert_eq!(
            swept.len(),
            DBM_INSTANCE_METRICS.len(),
            "a schema-complete deployment must report every catalog entry as swept"
        );
    }
}
