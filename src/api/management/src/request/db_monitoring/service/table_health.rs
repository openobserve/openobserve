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

//! `/table_health` — the table and index health reads.

// The models these pull in are named only from enterprise-gated bodies, so the
// glob is genuinely unused on OSS. Keep the import (enterprise needs it) and
// silence the OSS-only lint rather than splitting it behind a cfg.
#[cfg_attr(not(feature = "enterprise"), allow(unused_imports))]
use super::{super::models::*, *};

/// Which engines this signal is collected for.
///
/// Postgres (`pg_table_stats` over `pg_class`/`pg_stat_user_tables`), MySQL
/// (`mysql_table_stats` over `information_schema.TABLES` +
/// `mysql.innodb_table_stats`), MariaDB (`mariadb_table_stats`, the same
/// catalogs) and SQL Server (`mssql_table_stats` over
/// `sys.tables`/`sys.partitions`/`sys.allocation_units`) all ship recipes.
///
/// **`supported` is a claim about the SIGNAL, not about every column.** SQL
/// Server has no autovacuum and no dead-tuple accounting, so its rows carry
/// sizes and row counts but NO vacuum/analyze counters, no vacuum timestamps
/// and no bloat estimate. The recipe omits those columns rather than
/// zero-filling them, and they must render as ABSENT — a fabricated `0` reads
/// as "0% bloat, last vacuumed just now", which is the healthy-looking lie this
/// module exists to prevent. Coverage `supported` therefore means "these rows
/// are real", not "every cell is populated".
///
/// This exists so the UI can distinguish "no tables have problems" from "this
/// signal was never collected for your engine". Rendering an empty table for an
/// unsupported engine's user is the single most dangerous empty state the
/// feature can produce: it reads as an all-clear about a check that never ran.
///
/// `""` (no engine filter) answers `unknown` rather than guessing: an unfiltered
/// request spans every engine in the fleet, so no single verdict is true of it.
#[cfg(feature = "enterprise")]
pub(crate) fn table_health_engine_support(engine: &str) -> &'static str {
    match engine {
        "postgresql" | "mysql" | "mariadb" | "mssql" => "supported",
        "" => "unknown",
        // Named negatively rather than by an allowlist of the engines we know:
        // a fourth engine with no recipe is also unsupported, and defaulting a
        // stranger to `unknown` would render the ambiguous empty state for an
        // engine we are certain about.
        _ => "unsupported",
    }
}

/// The newest snapshot of every relation in the window.
///
/// **A GROUP BY, never a row fetch folded in Rust.** The recipe re-emits every
/// table every 60 s, so an hour's window holds ~60 rows per table and a raw
/// fetch would render the same table sixty times — making "the 20 largest
/// tables" a list of one table repeated.
///
/// **`MAX`, never `SUM` or `AVG`.** Every measurement here is a point-in-time
/// state of a relation. Summing sixty snapshots of a 13 MB table reports a
/// 780 MB table; averaging a cumulative counter across a window in which it grew
/// reports a number that was true at no instant. `MAX` is honest for both cases
/// at once: it is the latest value for a size that fluctuates, and the latest
/// value for a lifetime counter that only rises.
///
/// Returns `None` when the stream's schema lacks the relation column — naming an
/// absent column in a `GROUP BY` fails the WHOLE query with a schema error, and
/// the exposed case is the common one: no deployment has shipped this recipe
/// yet.
#[cfg(feature = "enterprise")]
pub(crate) fn build_dbm_table_health_sql(
    stream_name: &str,
    preds: &str,
    limit: usize,
    present: &HashSet<String>,
) -> Option<String> {
    if !present.contains(server_vantage::O2_DBM_RELATION)
        || !present.contains(server_vantage::O2_DBM_SCHEMA)
    {
        return None;
    }
    // Optional columns: a partially-upgraded cluster can have written the
    // relation without the rest. Project only what exists, so one missing
    // column degrades a cell instead of failing the page.
    let mut cols = Vec::new();
    for (storage, wire) in [
        (server_vantage::O2_DBM_TOTAL_BYTES, "total_bytes"),
        (server_vantage::O2_DBM_HEAP_BYTES, "heap_bytes"),
        (server_vantage::O2_DBM_LIVE_TUPLES, "live_tuples"),
        (server_vantage::O2_DBM_DEAD_TUPLES, "dead_tuples"),
        (server_vantage::O2_DBM_DEAD_TUP_PCT, "dead_tup_pct"),
        (
            server_vantage::O2_DBM_MOD_SINCE_ANALYZE,
            "mod_since_analyze",
        ),
        (server_vantage::O2_DBM_SEQ_SCAN_COUNT, "seq_scan_count"),
        (server_vantage::O2_DBM_SEQ_TUP_READ, "seq_tup_read"),
        (server_vantage::O2_DBM_IDX_SCAN_COUNT, "idx_scan_count"),
        (server_vantage::O2_DBM_AUTOVACUUM_COUNT, "autovacuum_count"),
        (server_vantage::O2_DBM_FROZEN_XID_AGE, "frozen_xid_age"),
        (server_vantage::O2_DBM_LAST_VACUUM, "last_vacuum"),
        (server_vantage::O2_DBM_LAST_AUTOVACUUM, "last_autovacuum"),
        (server_vantage::O2_DBM_LAST_ANALYZE, "last_analyze"),
        (server_vantage::O2_DBM_INSTANCE, "instance"),
        (server_vantage::O2_DBM_ENGINE, "engine"),
    ] {
        if present.contains(storage) {
            cols.push(format!("MAX({storage}) AS {wire}"));
        } else {
            cols.push(format!("NULL AS {wire}"));
        }
    }
    let projected = cols.join(", ");
    Some(format!(
        "SELECT {schema} AS schema_name, {relation} AS relation, {projected}, \
         MAX(_timestamp) AS last_seen FROM \"{stream}\"\n\
         WHERE {kind} = '{kind_val}'{preds}\n\
         GROUP BY {schema}, {relation}\n\
         ORDER BY total_bytes DESC NULLS LAST\nLIMIT {limit}",
        schema = server_vantage::O2_DBM_SCHEMA,
        relation = server_vantage::O2_DBM_RELATION,
        stream = escape_ident(stream_name),
        kind = server_vantage::O2_DBM_KIND,
        kind_val = escape_sq(server_vantage::KIND_TABLE_STATS),
    ))
}

// ─── W11 · Index health read API ─────────────────────────────────────────────
//
// One row per INDEX, from the index-stats recipes (`pg_index_stats` /
// `mysql_index_stats` / `mariadb_index_stats` / `mssql_index_stats`). The
// companion to table health, and the source of the never-scanned signal:
// `idx_scan = 0` on an index means the planner has not chosen it since the
// counters were last reset.
//
// The counters are LIFETIME totals exactly as the table ones are, and the
// envelope re-states it so the UI cannot render "never scanned" as a claim
// about the selected window.

/// Which engines this signal is collected for. Postgres (`pg_index_stats`),
/// MySQL (`mysql_index_stats`), MariaDB (`mariadb_index_stats`) and SQL Server
/// (`mssql_index_stats`, over `sys.indexes` left-joined to
/// `sys.dm_db_index_usage_stats`) all ship recipes.
///
/// As with [`table_health_engine_support`], `supported` is a claim about the
/// SIGNAL and not about every column: MariaDB's recipe honestly omits the usage
/// counter, and SQL Server — having no autovacuum and no dead-tuple accounting
/// — carries index size and usage but none of the vacuum or bloat columns its
/// table rows also lack. Those cells must render ABSENT rather than zero. See
/// [`table_health_engine_support`] for why the empty filter answers `unknown`
/// rather than guessing.
#[cfg(feature = "enterprise")]
pub(crate) fn index_health_engine_support(engine: &str) -> &'static str {
    match engine {
        "postgresql" | "mysql" | "mariadb" | "mssql" => "supported",
        "" => "unknown",
        _ => "unsupported",
    }
}

/// The newest snapshot of every index in the window, largest first.
///
/// **Grouped by (schema, relation, index), not by relation.** Two indexes on one
/// table share a relation, so a relation-keyed GROUP BY would fold them together
/// and drop one from the list entirely.
///
/// **`MAX`, never `SUM`.** The recipe re-emits every index every 60 s, so an
/// hour's window holds ~60 snapshots each; summing reports an index 60x its real
/// size, and averaging a lifetime counter reports a number true at no instant.
///
/// Returns `None` when the stream's schema lacks the index column — naming an
/// absent column in a GROUP BY fails the whole query, and the common case is a
/// deployment that has not shipped this recipe.
#[cfg(feature = "enterprise")]
pub(crate) fn build_dbm_index_health_sql(
    stream_name: &str,
    preds: &str,
    limit: usize,
    present: &HashSet<String>,
) -> Option<String> {
    if !present.contains(server_vantage::O2_DBM_INDEX_NAME)
        || !present.contains(server_vantage::O2_DBM_SCHEMA)
        || !present.contains(server_vantage::O2_DBM_RELATION)
    {
        return None;
    }
    // Optional columns degrade a cell rather than failing the page.
    let mut cols = Vec::new();
    for (storage, wire) in [
        (server_vantage::O2_DBM_INDEX_BYTES, "index_bytes"),
        (server_vantage::O2_DBM_IDX_SCAN_COUNT, "idx_scan_count"),
        (server_vantage::O2_DBM_IDX_TUP_READ, "idx_tup_read"),
        (server_vantage::O2_DBM_IDX_TUP_FETCH, "idx_tup_fetch"),
        (server_vantage::O2_DBM_INSTANCE, "instance"),
        (server_vantage::O2_DBM_ENGINE, "engine"),
        // MAX over a boolean is the right fold: uniqueness is a property of the
        // index, identical across every snapshot in the window.
        (server_vantage::O2_DBM_INDEX_IS_UNIQUE, "is_unique"),
    ] {
        if present.contains(storage) {
            cols.push(format!("MAX({storage}) AS {wire}"));
        } else {
            cols.push(format!("NULL AS {wire}"));
        }
    }
    let projected = cols.join(", ");
    Some(format!(
        "SELECT {schema} AS schema_name, {relation} AS relation, \
         {index} AS index_name, {projected}, \
         MAX(_timestamp) AS last_seen FROM \"{stream}\"\n\
         WHERE {kind} = '{kind_val}'{preds}\n\
         GROUP BY {schema}, {relation}, {index}\n\
         ORDER BY index_bytes DESC NULLS LAST\nLIMIT {limit}",
        schema = server_vantage::O2_DBM_SCHEMA,
        relation = server_vantage::O2_DBM_RELATION,
        index = server_vantage::O2_DBM_INDEX_NAME,
        stream = escape_ident(stream_name),
        kind = server_vantage::O2_DBM_KIND,
        kind_val = escape_sq(server_vantage::KIND_INDEX_STATS),
    ))
}

// ─── Wire-or-storage column readers (shared by the two health DTOs) ──────────
//
// Health rows arrive from two shapes: the SQL aggregates' wire aliases and, in
// tests, the canonicalizer's own storage names. Reading both keeps the
// writer/reader loop closeable — a DTO that only understood the aggregate
// could not be fed what ingest wrote, and a write/read name split would go
// unnoticed.

/// The column under its wire alias, falling back to its storage name.
#[cfg(feature = "enterprise")]
fn pick_col(row: &Value, wire: &str, storage: &str) -> Value {
    match row.get(wire) {
        Some(v) if !v.is_null() => v.clone(),
        _ => row.get(storage).cloned().unwrap_or(Value::Null),
    }
}

/// [`pick_col`] as an integer, or null.
#[cfg(feature = "enterprise")]
fn int_col(row: &Value, wire: &str, storage: &str) -> Value {
    match server_vantage::as_i64_loose(&pick_col(row, wire, storage)) {
        Some(n) => json!(n),
        None => Value::Null,
    }
}

/// [`pick_col`] as a non-empty string, or null.
#[cfg(feature = "enterprise")]
fn text_col(row: &Value, wire: &str, storage: &str) -> Value {
    match pick_col(row, wire, storage) {
        Value::String(s) if !s.is_empty() => json!(s),
        _ => Value::Null,
    }
}

/// One index's size and usage, in WIRE names (see the reader helpers above).
#[cfg(feature = "enterprise")]
fn index_health_row_to_dto(row: &Value) -> Value {
    let pick = |wire: &str, storage: &str| pick_col(row, wire, storage);
    let int = |wire: &str, storage: &str| int_col(row, wire, storage);
    let text = |wire: &str, storage: &str| text_col(row, wire, storage);
    json!({
        "index_name": text("index_name", server_vantage::O2_DBM_INDEX_NAME),
        "relation": text("relation", server_vantage::O2_DBM_RELATION),
        "schema": text("schema_name", server_vantage::O2_DBM_SCHEMA),
        "instance": text("instance", server_vantage::O2_DBM_INSTANCE),
        "engine": text("engine", server_vantage::O2_DBM_ENGINE),
        "index_bytes": int("index_bytes", server_vantage::O2_DBM_INDEX_BYTES),
        // LIFETIME totals — see `counters_are_cumulative` on the envelope. A
        // measured 0 is the never-scanned finding and must stay 0.
        "idx_scan_count": int("idx_scan_count", server_vantage::O2_DBM_IDX_SCAN_COUNT),
        "idx_tup_read": int("idx_tup_read", server_vantage::O2_DBM_IDX_TUP_READ),
        "idx_tup_fetch": int("idx_tup_fetch", server_vantage::O2_DBM_IDX_TUP_FETCH),
        // A CONSTRAINT index is not a drop candidate. `null` when the recipe
        // predates the column — unknown, which the rule treats as "cannot
        // exclude" rather than as "ordinary index".
        "is_unique": match pick("is_unique", server_vantage::O2_DBM_INDEX_IS_UNIQUE) {
            Value::Bool(b) => json!(b),
            Value::String(s) if s == "true" || s == "t" => json!(true),
            Value::String(s) if s == "false" || s == "f" => json!(false),
            _ => Value::Null,
        },
        "last_seen": int("last_seen", server_vantage::O2_DBM_TIMESTAMP),
    })
}

/// One relation's health, in WIRE names.
///
/// Storage names never reach the browser. Every counter carries its honesty
/// qualifier on the RESPONSE ENVELOPE rather than per-row: the flags are
/// properties of the feed, not of a table, and repeating them on every row
/// would invite a reader to assume a row without them is exact.
#[cfg(feature = "enterprise")]
fn table_health_row_to_dto(row: &Value) -> Value {
    let pick = |wire: &str, storage: &str| pick_col(row, wire, storage);
    let int = |wire: &str, storage: &str| int_col(row, wire, storage);
    let text = |wire: &str, storage: &str| text_col(row, wire, storage);
    json!({
        "relation": text("relation", server_vantage::O2_DBM_RELATION),
        "schema": text("schema_name", server_vantage::O2_DBM_SCHEMA),
        "instance": text("instance", server_vantage::O2_DBM_INSTANCE),
        "engine": text("engine", server_vantage::O2_DBM_ENGINE),
        "total_bytes": int("total_bytes", server_vantage::O2_DBM_TOTAL_BYTES),
        "heap_bytes": int("heap_bytes", server_vantage::O2_DBM_HEAP_BYTES),
        // ESTIMATES — see `tuples_are_estimated` on the envelope.
        "live_tuples": int("live_tuples", server_vantage::O2_DBM_LIVE_TUPLES),
        "dead_tuples": int("dead_tuples", server_vantage::O2_DBM_DEAD_TUPLES),
        "dead_tup_pct": as_f64_loose(&pick("dead_tup_pct", server_vantage::O2_DBM_DEAD_TUP_PCT)),
        "mod_since_analyze": int("mod_since_analyze", server_vantage::O2_DBM_MOD_SINCE_ANALYZE),
        // LIFETIME totals — see `counters_are_cumulative` on the envelope.
        "seq_scan_count": int("seq_scan_count", server_vantage::O2_DBM_SEQ_SCAN_COUNT),
        "seq_tup_read": int("seq_tup_read", server_vantage::O2_DBM_SEQ_TUP_READ),
        "idx_scan_count": int("idx_scan_count", server_vantage::O2_DBM_IDX_SCAN_COUNT),
        "autovacuum_count": int("autovacuum_count", server_vantage::O2_DBM_AUTOVACUUM_COUNT),
        "frozen_xid_age": int("frozen_xid_age", server_vantage::O2_DBM_FROZEN_XID_AGE),
        // `null` means NEVER, not "unknown" — the recipe COALESCEs a null
        // vacuum time to `''` and canonicalization drops the empty string.
        "last_vacuum": text("last_vacuum", server_vantage::O2_DBM_LAST_VACUUM),
        "last_autovacuum": text("last_autovacuum", server_vantage::O2_DBM_LAST_AUTOVACUUM),
        "last_analyze": text("last_analyze", server_vantage::O2_DBM_LAST_ANALYZE),
        "last_seen": int("last_seen", server_vantage::O2_DBM_TIMESTAMP),
    })
}

/// The table-health endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`], auth included.
#[cfg(feature = "enterprise")]
pub(crate) async fn read_table_health_body(
    org_id: &str,
    user_id: &str,
    q: &TableHealthQuery,
) -> Result<Value, HttpResponse> {
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    // Same rule as `get_dbm_query_server_metrics`: Logs-stream auth, checked
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
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .clamp(1, MAX_EVENTS_LIMIT);
    // No `database` filter: this feed carries no database (see
    // `server_vantage::O2_DBM_SCHEMA`), so accepting one would silently return
    // nothing for every value a user could pass.
    // Same rule as `read_deadlocks_body`: a failed schema read is reported,
    // never absorbed into an empty set. See `present_dbm_columns`.
    let present = match present_dbm_columns(org_id, stream).await {
        Ok(present) => present,
        Err(e) => {
            log::error!(
                "[DbMonitoring] table health schema read failed for {org_id}/{stream}: {e}"
            );
            return Err(MetaHttpResponse::internal_error(e));
        }
    };
    let preds = dbm_event_preds(q.system.as_deref(), q.instance.as_deref(), None, &present);

    // The two sections are two searches over the same stream, run concurrently
    // when both are wanted. They keep one meaningful independence: tables are
    // the page, so a table failure is a 500, while an index failure degrades to
    // an empty section — the rules that need no index data must keep rendering.
    let table_search = async {
        match build_dbm_table_health_sql(stream, &preds, limit, &present) {
            Some(sql) => {
                run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time)
                    .await
                    .map(Some)
            }
            // The stream has never carried table stats — an empty section, not
            // an error.
            None => Ok(None),
        }
    };
    let want_indexes = q.include_indexes.unwrap_or(false);
    let index_search = async {
        if !want_indexes {
            return Ok(None);
        }
        match build_dbm_index_health_sql(stream, &preds, limit, &present) {
            Some(sql) => {
                run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time)
                    .await
                    .map(Some)
            }
            None => Ok(None),
        }
    };
    let (table_rows, index_rows) = tokio::join!(table_search, index_search);

    let rows = match table_rows {
        Ok(rows) => rows.unwrap_or_default(),
        Err(e) => {
            log::error!("[DbMonitoring] table health read failed for {org_id}/{stream}: {e}");
            return Err(MetaHttpResponse::internal_error(e));
        }
    };
    let (index_hits, index_read_failed): (Vec<Value>, bool) = match index_rows {
        Ok(rows) => (
            rows.unwrap_or_default()
                .iter()
                .map(index_health_row_to_dto)
                .collect(),
            false,
        ),
        Err(e) => {
            log::error!("[DbMonitoring] index health read failed for {org_id}/{stream}: {e}");
            (Vec::new(), true)
        }
    };

    let hits: Vec<Value> = rows.iter().map(table_health_row_to_dto).collect();

    Ok(table_health_envelope(
        &hits,
        stream,
        q.system.as_deref().unwrap_or(""),
        limit,
        want_indexes.then_some((index_hits.as_slice(), index_read_failed)),
    ))
}

/// The table-health response envelope — pure shape assembly (no I/O), same
/// extraction rationale as [`server_metrics_envelope`]: the
/// cumulative/estimated disclosures are asserted on real JSON instead of
/// scraped out of the handler's source text. `index_section` is
/// `(index_hits, index_read_failed)` when the caller asked for indexes.
#[cfg(feature = "enterprise")]
pub(crate) fn table_health_envelope(
    hits: &[Value],
    stream: &str,
    engine_filter: &str,
    // The row cap the read ran under, so the envelope can disclose whether it
    // was reached — `total` is otherwise a ceiling printed as a population.
    limit: usize,
    index_section: Option<(&[Value], bool)>,
) -> Value {
    let mut body = json!({
        "hits": hits,
        "stream": stream,
        "total": hits.len(),
        // A CAPPED read is a floor, not a population — the same disclosure the
        // deadlocks and blocking reads make. Without it the Table health badge
        // printed the cap as a total: a fleet with 400 relations rendered a
        // stable `100`, which reads as a measurement that is not changing
        // rather than one that is not being taken. `badgeCount` renders a
        // disclosed cap as `100+`.
        "truncated": hits.len() >= limit,
        // ── the honesty contract, stated by the API ───────────────────────
        //
        // `seq_scan`, `idx_scan` and `autovacuum_count` come from
        // `pg_stat_user_tables` and count from the last `pg_stat_reset()` — a
        // point in time this feed never observes. Rendering them under a window
        // filter as "in the last hour" is a strictly stronger claim than the
        // data supports. We disclose rather than delta: a delta needs two
        // snapshots and a guarantee no reset happened between them, and a reset
        // makes the later value smaller, so a naive subtraction renders a
        // negative scan count.
        "counters_are_cumulative": true,
        // `n_live_tup`/`n_dead_tup` are statistics-collector estimates
        // reconciled against `reltuples` at ANALYZE, not a COUNT(*), and can be
        // arbitrarily stale on an un-analyzed table (which `mod_since_analyze`
        // on the same row quantifies). Sizes are exact by contrast, hence one
        // flag about TUPLES rather than a blanket one.
        "tuples_are_estimated": true,
        // Whether this signal is collected for the filtered engine at all.
        // Without it a MySQL user sees an empty table and reads it as "no
        // problems found" — an all-clear about a check that never ran.
        "engine_coverage": table_health_engine_support(engine_filter),
    });
    if let Some((index_hits, index_read_failed)) = index_section {
        let extra = body.as_object_mut().expect("body is an object");
        extra.insert("index_hits".into(), json!(index_hits));
        extra.insert("index_total".into(), json!(index_hits.len()));
        // Same disclosure as the table counters: `idx_scan` counts from the
        // last `pg_stat_reset()`, so "never scanned" is a lifetime claim.
        extra.insert("index_counters_are_cumulative".into(), json!(true));
        extra.insert(
            "index_engine_coverage".into(),
            json!(index_health_engine_support(engine_filter)),
        );
        // Stated, not implied by emptiness: an empty index list is the honest
        // answer on a fresh install, but "we could not read" must not wear
        // that costume — the unused-index rule stays silent instead of
        // declaring every index healthy.
        extra.insert("index_read_failed".into(), json!(index_read_failed));
    }
    body
}

// ─── Shared _o2_dbm_server prologue (badges fan-in) ──────────────────────────────

#[cfg(test)]
mod tests {
    // Used only by enterprise-gated tests below; unused on an OSS build.
    #[cfg_attr(not(feature = "enterprise"), allow(unused_imports))]
    use serde_json::json;

    use super::{super::testutil::*, *};

    #[cfg(feature = "enterprise")]
    /// The newest snapshot per INDEX, keyed on the index — not the relation.
    ///
    /// Two indexes on one table share a relation, so grouping by relation alone
    /// would collapse them and silently drop one from the list.
    #[test]
    fn test_index_health_sql_groups_by_the_index_not_the_relation() {
        let sql = build_dbm_index_health_sql("_o2_dbm_server", "", 50, &all_cols())
            .expect("index health sql");
        assert!(
            sql.contains(&format!("GROUP BY {}", server_vantage::O2_DBM_SCHEMA)),
            "grouping must start at the schema: {sql}"
        );
        assert!(
            sql.contains(server_vantage::O2_DBM_INDEX_NAME),
            "the index name must be in the grouping key, or two indexes on one \
             table collapse into one row: {sql}"
        );
        assert!(
            sql.contains(&format!("{} = 'index_stats'", server_vantage::O2_DBM_KIND)),
            "it must read index_stats records only: {sql}"
        );
        assert!(sql.contains("LIMIT 50"));
    }

    #[cfg(feature = "enterprise")]
    /// MAX, never SUM: these are point-in-time snapshots re-emitted every 60s.
    /// Summing them multiplies an index's size by the number of samples.
    #[test]
    fn test_index_health_sql_uses_max_not_sum() {
        let sql = build_dbm_index_health_sql("_o2_dbm_server", "", 50, &all_cols())
            .expect("index health sql");
        assert!(
            sql.contains(&format!("MAX({})", server_vantage::O2_DBM_INDEX_BYTES)),
            "size must be MAX: {sql}"
        );
        assert!(
            !sql.to_uppercase().contains("SUM("),
            "SUM over snapshots reports an index N times its real size: {sql}"
        );
    }

    #[cfg(feature = "enterprise")]
    /// A stream that never carried index stats yields no query at all, rather
    /// than a query naming an absent column — which fails the WHOLE request.
    #[test]
    fn test_index_health_sql_is_absent_without_the_index_column() {
        let mut cols = all_cols();
        cols.remove(server_vantage::O2_DBM_INDEX_NAME);
        assert!(
            build_dbm_index_health_sql("_o2_dbm_server", "", 50, &cols).is_none(),
            "no index column means no query, not a schema error"
        );
    }

    #[cfg(feature = "enterprise")]
    /// Scope filters reach the aggregate, and injection is neutralized.
    #[test]
    fn test_index_health_sql_honours_scope_filters_and_escapes_them() {
        let preds = dbm_event_preds(Some("pg' OR '1'='1"), Some("pg1"), None, &all_cols());
        let sql = build_dbm_index_health_sql("ev\"il", &preds, 10, &all_cols())
            .expect("index health sql");
        assert!(sql.contains("o2_dbm_instance = 'pg1'"), "{sql}");
        assert!(
            sql.contains("'pg'' OR ''1''=''1'"),
            "values are escaped: {sql}"
        );
        assert!(sql.contains("\"ev\"\"il\""), "identifier is escaped: {sql}");
    }

    #[cfg(feature = "enterprise")]
    /// Storage names must never reach the browser, and a measured ZERO must
    /// survive as 0 rather than becoming null — it is the whole finding.
    #[test]
    fn test_index_health_dto_uses_wire_names_and_keeps_a_measured_zero() {
        let row = json!({
            "schema_name": "public",
            "relation": "orders",
            "index_name": "idx_orders_note_unused",
            "index_bytes": 2_859_008,
            "idx_scan_count": 0,
            "idx_tup_read": 0,
            "idx_tup_fetch": 0,
            "instance": "pg-primary:5432",
            "engine": "postgresql",
            "last_seen": 1_786_505_777_063_921i64,
        });
        let dto = index_health_row_to_dto(&row);

        assert_eq!(dto["index_name"], json!("idx_orders_note_unused"));
        assert_eq!(dto["relation"], json!("orders"));
        assert_eq!(dto["schema"], json!("public"));
        assert_eq!(
            dto["idx_scan_count"],
            json!(0),
            "a measured zero is the never-scanned FINDING and must not become null"
        );
        assert_eq!(dto["index_bytes"], json!(2_859_008));
        let rendered = dto.to_string();
        assert!(
            !rendered.contains("o2_dbm_"),
            "no storage name may reach the browser: {rendered}"
        );
    }

    #[cfg(feature = "enterprise")]
    /// The DTO must also read the CANONICALIZER's own output, closing the
    /// write/read loop — a DTO that only understood the SQL aliases could not
    /// be fed what ingest actually wrote, which is how a name split hides.
    #[test]
    fn test_index_health_dto_reads_canonicalizer_output() {
        let rec = server_vantage::canonicalize_index_stats(
            &json!({
                "o2_recipe": "pg_index_stats",
                "index_name": "demo_orders_status_idx",
                "table_name": "demo_orders",
                "schema_name": "public",
                "idx_scan": "44916",
                "idx_tup_read": "2937877460",
                "idx_tup_fetch": "2222646612",
                "index_bytes": "2301952",
            })
            .as_object()
            .unwrap()
            .clone(),
        )
        .expect("canonicalizes")
        .to_record();
        let row = Value::Object(rec.into_iter().collect());

        let dto = index_health_row_to_dto(&row);
        assert_eq!(dto["index_name"], json!("demo_orders_status_idx"));
        assert_eq!(dto["relation"], json!("demo_orders"));
        assert_eq!(dto["idx_scan_count"], json!(44916));
        assert_eq!(
            dto["idx_tup_read"],
            json!(2_937_877_460i64),
            "counters exceed i32 on real data"
        );
    }

    #[cfg(feature = "enterprise")]
    /// Index health is collected for the four engines with index-stats
    /// recipes, and the envelope must say so per engine — an empty list for an
    /// unsupported engine's user reads as "no problems found", and claiming
    /// `unsupported` for an engine whose rows ARE arriving is the same lie
    /// pointing the other way.
    #[test]
    fn test_index_health_engine_support_names_the_recipe_engines() {
        for supported in ["postgresql", "mysql", "mariadb", "mssql"] {
            assert_eq!(
                index_health_engine_support(supported),
                "supported",
                "`{supported}` ships an index-stats recipe"
            );
        }
        assert_eq!(
            index_health_engine_support("oracle"),
            "unsupported",
            "no oracle index-stats recipe ships, and the UI must say \
             'not collected for this engine' rather than render an empty list"
        );
        assert_eq!(
            index_health_engine_support(""),
            "unknown",
            "an unfiltered request spans every engine, so no single verdict is true"
        );
    }

    /// The activity handler must be registered on the router and re-exported —
    /// a handler nothing routes to is dead code that still passes every unit
    /// test. Both wire-up lines live OUTSIDE api.rs, so nothing else catches it.
    #[test]
    fn test_activity_endpoint_is_wired_up() {
        let router = include_str!("../../../../../http/src/handler/http/router/mod.rs");
        assert!(
            router.contains("db_monitoring/activity"),
            "the activity route must be registered"
        );
        assert!(
            router.contains("get_dbm_activity"),
            "the route must point at the handler"
        );
        assert!(
            router.contains("db_monitoring::handler::get_dbm_activity"),
            "the route must name the handler through its own module — \
             a route pointing anywhere else is not this handler"
        );
    }

    /// D-F: everything stays OSS. An `#[cfg(feature = "enterprise")]` anywhere in
    /// the DBM read API would 404 the endpoint on OSS builds.
    #[test]
    fn test_activity_endpoint_is_not_enterprise_gated() {
        let router = include_str!("../../../../../http/src/handler/http/router/mod.rs");
        let idx = router
            .find("db_monitoring/activity")
            .expect("route must exist");
        // The ungated DBM block registers the existing six routes; the new one
        // must sit with them, not in an enterprise-gated section.
        let neighbourhood = &router[idx.saturating_sub(2000)..idx];
        assert!(
            neighbourhood.contains("db_monitoring/deadlocks"),
            "the activity route must live beside the other ungated DBM routes"
        );
    }

    #[cfg(feature = "enterprise")]
    /// **One row per RELATION, not one per snapshot.**
    ///
    /// The recipe re-emits every table every 60 s, so an hour's window holds 60
    /// identical-looking rows per table. Returning them raw would render the
    /// same table sixty times and make "the 20 largest tables" a list of one
    /// table. The latest snapshot per relation is the only reading that answers
    /// the question the page asks.
    #[test]
    fn test_build_dbm_table_health_sql_is_one_row_per_relation() {
        let sql = build_dbm_table_health_sql("_o2_dbm_server", "", 50, &all_cols())
            .expect("the table-health query must build when the columns are present");

        assert!(
            sql.contains(&format!(
                "GROUP BY {}, {}",
                server_vantage::O2_DBM_SCHEMA,
                server_vantage::O2_DBM_RELATION
            )),
            "distinct tables come from a GROUP BY on (schema, relation), not a \
             row fetch folded in Rust: {sql}"
        );
        assert!(
            sql.contains(&format!(
                "{} = '{}'",
                server_vantage::O2_DBM_KIND,
                server_vantage::KIND_TABLE_STATS
            )),
            "it must read table_stats records only: {sql}"
        );
        // (The requested window is the request payload's, not this string's.)
        assert!(
            sql.contains("LIMIT 50"),
            "and to the requested limit: {sql}"
        );
    }

    #[cfg(feature = "enterprise")]
    /// **The aggregate must take the LATEST snapshot, never a SUM or an AVG.**
    ///
    /// Every measurement on this feed is a point-in-time state of a relation:
    /// size, live/dead tuples, and cumulative lifetime counters. Summing sixty
    /// snapshots of a 13 MB table reports a 780 MB table; averaging the
    /// cumulative `seq_scan` across a window where it grew reports a number
    /// that was never true at any instant. `MAX` over a monotonic lifetime
    /// counter and over the newest size is the one aggregate that is honest for
    /// both.
    #[test]
    fn test_table_health_sql_never_sums_or_averages_a_snapshot() {
        let sql = build_dbm_table_health_sql("_o2_dbm_server", "", 50, &all_cols())
            .expect("table health sql");

        for banned in ["SUM(", "AVG(", "COUNT(o2_dbm"] {
            assert!(
                !sql.contains(banned),
                "`{banned}` over point-in-time snapshots reports a total that was \
                 never true at any instant: {sql}"
            );
        }
        assert!(
            sql.contains(&format!("MAX({})", server_vantage::O2_DBM_TOTAL_BYTES)),
            "size must be the latest observed value: {sql}"
        );
    }

    #[cfg(feature = "enterprise")]
    /// The query degrades rather than 500s when the stream predates table
    /// ingest — the common case, since no shipped deployment has the recipe yet.
    #[test]
    fn test_table_health_sql_skips_when_the_columns_are_absent() {
        let mut without = all_cols();
        without.remove(server_vantage::O2_DBM_RELATION);
        assert_eq!(
            build_dbm_table_health_sql("_o2_dbm_server", "", 50, &without),
            None,
            "a stream with no relation column must skip the query, not 500 the endpoint"
        );
    }

    #[cfg(feature = "enterprise")]
    /// Injection-safe, like every other builder here.
    #[test]
    fn test_table_health_sql_escapes_its_inputs() {
        let preds = dbm_event_preds(Some("pg' OR '1'='1"), None, None, &all_cols());
        let sql = build_dbm_table_health_sql("ev\"il", &preds, 10, &all_cols())
            .expect("table health sql");
        assert!(sql.contains("'pg'' OR ''1''=''1'"));
        assert!(sql.contains("\"ev\"\"il\""));
    }

    #[cfg(feature = "enterprise")]
    /// **Closes the writer/reader loop** — the DTO is fed the CANONICALIZER'S
    /// OWN OUTPUT, so a column written under one name and read under another
    /// cannot pass. That split is invisible to both sides in isolation and
    /// surfaces only in production, as an endpoint returning nulls.
    #[test]
    fn test_table_health_dto_reads_the_writers_own_output() {
        // The real captured record (see tests_server_vantage.rs).
        let captured = json!({
            "_timestamp": 1_786_500_000_000_000i64,
            "o2_recipe": "pg_table_stats",
            "body": "audit_log",
            "schema_name": "public",
            "heap_bytes": "10510336",
            "total_bytes": "13639680",
            "n_live_tup": "137268",
            "n_dead_tup": "0",
            "dead_tup_pct": "0.00",
            "n_mod_since_analyze": "5547",
            "seq_scan": "0",
            "idx_scan": "0",
            "autovacuum_count": "8",
            "frozen_xid_age": "335437",
            "last_autovacuum": "2026-08-11 23:39:57.939725+00",
            "last_vacuum": "",
            "server_address": "pg-primary:5432",
        });
        let written = server_vantage::canonicalize_table_stats(
            captured.as_object().expect("fixture is an object"),
        )
        .expect("the captured record must canonicalize")
        .to_record();
        let row: Value = written
            .into_iter()
            .collect::<serde_json::Map<_, _>>()
            .into();

        let dto = table_health_row_to_dto(&row);
        assert_eq!(dto["relation"], json!("audit_log"));
        assert_eq!(dto["schema"], json!("public"));
        assert_eq!(dto["total_bytes"], json!(13_639_680i64));
        assert_eq!(dto["live_tuples"], json!(137_268i64));
        assert_eq!(dto["dead_tuples"], json!(0));
        assert_eq!(dto["idx_scan_count"], json!(0));
        assert_eq!(dto["autovacuum_count"], json!(8));
        assert_eq!(
            dto["last_autovacuum"],
            json!("2026-08-11 23:39:57.939725+00")
        );
        assert_eq!(
            dto["last_vacuum"],
            Value::Null,
            "never manually vacuumed reads as null, not an empty string"
        );
    }

    #[cfg(feature = "enterprise")]
    /// **A SECOND, materially different relation — the discriminator.**
    ///
    /// The writer/reader-loop test above uses one fixture, and a DTO hard-coded
    /// to it passed both DTO tests (measured: rung-1 stub attack). A real
    /// reader and a lookup only diverge on a different record, so this one
    /// inverts every value that matters and arrives in the OTHER shape the DTO
    /// must read — the SQL aggregate's wire aliases rather than storage names.
    #[test]
    fn test_table_health_dto_reads_the_aggregate_row_shape() {
        let row = json!({
            "schema_name": "app",
            "relation": "sessions",
            "instance": "pg-replica-2",
            "engine": "postgresql",
            "total_bytes": 1_245_184i64,
            "heap_bytes": 884_736i64,
            "live_tuples": 412i64,
            "dead_tuples": 9130i64,
            "dead_tup_pct": 95.68,
            "mod_since_analyze": 12i64,
            "seq_scan_count": 88_214i64,
            "seq_tup_read": 3_120_044i64,
            "idx_scan_count": 17i64,
            "autovacuum_count": 0i64,
            "frozen_xid_age": 51i64,
            "last_vacuum": "2026-08-10 04:00:01.113402+00",
            "last_analyze": "2026-08-10 04:00:02.881190+00",
            "last_seen": 1_786_600_000_000_000i64,
        });
        let dto = table_health_row_to_dto(&row);

        assert_eq!(dto["relation"], json!("sessions"));
        assert_eq!(dto["schema"], json!("app"));
        assert_eq!(dto["instance"], json!("pg-replica-2"));
        assert_eq!(dto["total_bytes"], json!(1_245_184i64));
        assert_eq!(dto["heap_bytes"], json!(884_736i64));
        assert_eq!(dto["live_tuples"], json!(412i64));
        assert_eq!(dto["dead_tuples"], json!(9130i64));
        assert_eq!(
            dto["dead_tup_pct"],
            json!(95.68),
            "the bloat figure is fractional and must not be truncated"
        );
        assert_eq!(dto["mod_since_analyze"], json!(12i64));
        assert_eq!(dto["seq_scan_count"], json!(88_214i64));
        assert_eq!(dto["seq_tup_read"], json!(3_120_044i64));
        assert_eq!(dto["idx_scan_count"], json!(17i64));
        assert_eq!(
            dto["autovacuum_count"],
            json!(0),
            "zero autovacuums is the finding, not an absence"
        );
        assert_eq!(dto["frozen_xid_age"], json!(51i64));
        assert_eq!(dto["last_vacuum"], json!("2026-08-10 04:00:01.113402+00"));
        assert_eq!(
            dto["last_autovacuum"],
            Value::Null,
            "absent from the row means never autovacuumed"
        );
        assert_eq!(dto["last_analyze"], json!("2026-08-10 04:00:02.881190+00"));
        assert_eq!(dto["last_seen"], json!(1_786_600_000_000_000i64));
    }

    #[cfg(feature = "enterprise")]
    /// The DTO speaks WIRE names; storage names never reach the browser.
    #[test]
    fn test_table_health_dto_uses_wire_names() {
        let row = json!({
            server_vantage::O2_DBM_RELATION: "orders",
            server_vantage::O2_DBM_TOTAL_BYTES: 1000i64,
        });
        let dto = table_health_row_to_dto(&row);
        for storage in dto.as_object().unwrap().keys() {
            assert!(
                !storage.starts_with("o2_dbm_"),
                "`{storage}` is a STORAGE name and must never reach the browser"
            );
        }
    }

    #[cfg(feature = "enterprise")]
    /// **The cumulative/estimated disclosure must reach the WIRE.**
    ///
    /// The ingest side marks every row, but the UI reads the RESPONSE, not the
    /// stored row. Without these on the envelope the page is free to render
    /// "0 sequential scans" under an hour filter — a per-window claim the data
    /// does not support — and "137,268 rows" as an exact count.
    #[test]
    fn test_table_health_response_declares_cumulative_and_estimated() {
        // Asserted on the real JSON: [`table_health_envelope`] is the pure
        // shape assembly the body fn itself calls.
        let hits = vec![json!({"relation": "orders", "total_bytes": 1000i64})];
        let env = table_health_envelope(&hits, "_o2_dbm_server", "postgresql", 100, None);
        let body = env.as_object().expect("the envelope is a JSON object");

        for key in ["counters_are_cumulative", "tuples_are_estimated"] {
            assert_eq!(
                body.get(key),
                Some(&json!(true)),
                "the response must carry `{key}` — the UI cannot phrase the \
                 disclosure correctly unless the API states it"
            );
        }
        for key in ["hits", "stream", "engine_coverage"] {
            assert!(
                body.contains_key(key),
                "the table-health response must carry `{key}`"
            );
        }
        assert_eq!(body.get("engine_coverage"), Some(&json!("supported")));

        // The index section rides the same envelope when asked for, and carries
        // its own cumulative disclosure plus the read-failed flag — an empty
        // index list must not be able to wear "we could not read" as a costume.
        let with_indexes = table_health_envelope(
            &hits,
            "_o2_dbm_server",
            "postgresql",
            100,
            Some((&[], true)),
        );
        for key in [
            "index_hits",
            "index_total",
            "index_counters_are_cumulative",
            "index_engine_coverage",
            "index_read_failed",
        ] {
            assert!(
                with_indexes.get(key).is_some(),
                "the index section must carry `{key}`"
            );
        }
        assert_eq!(with_indexes["index_read_failed"], json!(true));
        // Absent by default: a caller that did not ask for indexes must not be
        // handed an empty list it could read as "no unused indexes".
        assert!(body.get("index_hits").is_none());
    }

    #[cfg(feature = "enterprise")]
    /// **Per-engine honesty: the surface must SAY which engines collect this.**
    ///
    /// Postgres, MySQL, MariaDB and SQL Server all ship table-stats recipes. A
    /// user filtering to an engine with no recipe must be told the signal is
    /// not collected for their engine — an empty table with no explanation
    /// reads as "no problems found", which is the single most dangerous empty
    /// state this feature can render. The inverse is just as wrong: SQL Server
    /// rows DO arrive, so answering `unsupported` for `mssql` would hide real
    /// data behind "not collected for your engine".
    #[test]
    fn test_table_health_reports_engine_support_rather_than_an_empty_table() {
        for supported in ["postgresql", "mysql", "mariadb", "mssql"] {
            assert_eq!(
                table_health_engine_support(supported),
                "supported",
                "`{supported}` ships a table-stats recipe"
            );
        }
        for unsupported in ["oracle"] {
            assert_eq!(
                table_health_engine_support(unsupported),
                "unsupported",
                "`{unsupported}` has no table-stats recipe, and the UI must say \
                 'not collected for this engine' rather than render an empty list"
            );
        }
        assert_eq!(
            table_health_engine_support(""),
            "unknown",
            "an unfiltered request spans engines, so no single verdict applies"
        );
    }

    /// **`can_read_stream` must be checked against `StreamType::Logs`.**
    ///
    /// Server-vantage events live in a LOGS stream. Copy-pasting the permission
    /// check from a TRACE endpoint consults the wrong OFGA object and SILENTLY
    /// AUTHORIZES.
    #[test]
    fn test_table_health_checks_read_permission_against_the_logs_stream() {
        assert_gates_on_vantage("read_table_health_body", DbmVantage::Server);
        // The permission check must precede the range parsing, so a caller
        // cannot probe stream existence through error-message differences.
        assert_gate_precedes_range("read_table_health_body");
    }

    /// The handler must report a failed schema read rather than absorbing it
    /// into an empty set — an empty set drops the projection and the page would
    /// report a healthy collector as broken.
    #[test]
    fn test_table_health_reports_schema_errors() {
        let src = dbm_prod_source();
        let code = src;
        let start = code
            .find("async fn read_table_health_body")
            .expect("body fn");
        let body = code[start..].split("\n}\n").next().expect("body");

        let call = body
            .find("present_dbm_columns(")
            .expect("the handler must gate on the stream schema");
        let after = &body[call..body.len().min(call + 400)];
        assert!(
            !after.contains("unwrap_or_default()"),
            "swallowing a schema error makes a DB blip indistinguishable from \
             'this stream has no DBM columns'"
        );
        assert!(
            after.contains("internal_error"),
            "a failed schema read must be reported"
        );
    }

    /// A capped read must say so.
    ///
    /// `/table_health` returns `total: hits.len()`, so without a `truncated`
    /// flag the number is the row cap rather than the population — and it is
    /// the number the Table health badge prints, making a capped count read as
    /// a stable measurement. Every sibling that caps discloses it with
    /// `rows.len() >= limit`, and `badgeCount` renders a capped claim as
    /// `100+`.
    #[test]
    fn test_table_health_discloses_its_row_cap() {
        let src = dbm_prod_source();
        let start = src
            .find("async fn read_table_health_body")
            .expect("table health body reader must exist");
        let end = src[start..]
            .find("\n/// GET /{org_id}/db_monitoring/table_health")
            .map(|i| start + i)
            .unwrap_or_else(|| (start + 6000).min(src.len()));
        let body = &src[start..end];

        assert!(
            body.contains("\"truncated\""),
            "table_health must disclose whether its read hit the row cap — the \
             badge prints this number as a population"
        );
    }
}
