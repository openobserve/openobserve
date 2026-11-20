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

//! The database monitoring views' SQL, shared with AutoObserve so "deadlock" and "blocked"
//! have one definition. Every builder is schema-gated: naming an absent column fails the query.

use std::collections::HashSet;

use config::meta::stream::StreamType;

use super::{rollup, server_vantage};

/// The raw deadlock columns a stream can be queried for.
pub struct RawDeadlockFallback {
    pub present: HashSet<String>,
}

impl RawDeadlockFallback {
    /// Marker terms restricted to marker columns the stream has.
    pub fn marker_terms(&self) -> Vec<String> {
        server_vantage::DEADLOCK_MARKERS
            .into_iter()
            .filter(|(col, _)| self.present.contains(*col))
            .map(|(col, val)| format!("{col} = '{val}'"))
            .collect()
    }
}

/// The raw blocking columns a stream can be queried for.
pub struct RawBlockingFallback {
    pub present: HashSet<String>,
}

impl RawBlockingFallback {
    /// All four blocking recipes share `o2_recipe`, so the terms are all or nothing.
    pub fn marker_terms(&self) -> Vec<String> {
        server_vantage::BLOCKING_MARKERS
            .into_iter()
            .filter(|(col, _)| self.present.contains(*col))
            .map(|(col, val)| format!("{col} = '{val}'"))
            .collect()
    }
}

pub fn escape_sq(s: &str) -> String {
    s.replace('\'', "''")
}

/// Escape a stream name for inclusion in a double-quoted SQL identifier.
pub fn escape_ident(s: &str) -> String {
    s.replace('"', "\"\"")
}

/// The canonical columns the stream has; a failed schema read is an error, never an empty set.
pub async fn present_dbm_columns(
    org_id: &str,
    stream_name: &str,
) -> Result<HashSet<String>, anyhow::Error> {
    let schema = infra::schema::get(org_id, stream_name, StreamType::Logs).await?;
    Ok(server_vantage::ALL_DBM_FIELDS
        .into_iter()
        .filter(|f| schema.field_with_name(f).is_ok())
        .map(str::to_string)
        .collect())
}

/// Columns in the schema and, when User-Defined Schema is on (non-empty), kept by it.
pub fn queryable_columns(
    candidates: &[&str],
    schema: &arrow_schema::Schema,
    uds_fields: &[String],
) -> HashSet<String> {
    candidates
        .iter()
        .filter(|f| schema.field_with_name(f).is_ok())
        .filter(|f| uds_fields.is_empty() || uds_fields.iter().any(|u| u == **f))
        .map(|f| f.to_string())
        .collect()
}

/// The earliest canonical row of `kind` in the request's window.
pub fn build_earliest_canonical_sql(stream_name: &str, kind: &str) -> String {
    format!(
        "SELECT _timestamp FROM \"{}\"\nWHERE {} = '{}'\nORDER BY _timestamp ASC\nLIMIT 1",
        escape_ident(stream_name),
        server_vantage::O2_DBM_KIND,
        escape_sq(kind),
    )
}

/// The distinct (engine, instance) identities, stamped with the window's grid boundary so the
/// result cache keys agree across viewers.
pub fn build_dbm_instances_sql_at(
    stream_name: &str,
    system: Option<&str>,
    present: &HashSet<String>,
    anchor_micros: i64,
) -> Option<String> {
    if !present.contains(server_vantage::O2_DBM_ENGINE) {
        return None;
    }
    let engine = server_vantage::O2_DBM_ENGINE;
    // A partially upgraded cluster can lack the instance column; NULL keeps the row shape.
    let instance_col = if present.contains(server_vantage::O2_DBM_INSTANCE) {
        server_vantage::O2_DBM_INSTANCE.to_string()
    } else {
        format!(
            "CAST(NULL AS VARCHAR) AS {}",
            server_vantage::O2_DBM_INSTANCE
        )
    };
    let mut sql = format!(
        "SELECT {engine}, {instance_col}, {grid} AS {ts} \
         FROM \"{stream}\" WHERE {engine} IS NOT NULL",
        grid = rollup::floor_to_grid(anchor_micros),
        ts = config::TIMESTAMP_COL_NAME,
        stream = escape_ident(stream_name),
    );
    if let Some(system) = system.map(str::trim).filter(|s| !s.is_empty()) {
        sql.push_str(&format!(" AND {engine} = '{}'", system.replace('\'', "''")));
    }
    // A literal NULL projection cannot be grouped by, so the group names storage columns.
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

/// Any raw-marker deadlock row in the window; None when the stream has no marker column.
pub fn build_raw_deadlock_presence_sql(
    stream_name: &str,
    raw: &RawDeadlockFallback,
) -> Option<String> {
    let markers = raw.marker_terms();
    if markers.is_empty() {
        return None;
    }
    Some(format!(
        "SELECT _timestamp FROM \"{}\"\nWHERE ({})\nLIMIT 1",
        escape_ident(stream_name),
        markers.join(" OR "),
    ))
}

/// Any raw-marker blocking row in the window; None when the stream has no `o2_recipe` column.
pub fn build_raw_blocking_presence_sql(
    stream_name: &str,
    raw: &RawBlockingFallback,
) -> Option<String> {
    let markers = raw.marker_terms();
    if markers.is_empty() {
        return None;
    }
    Some(format!(
        "SELECT _timestamp FROM \"{}\"\nWHERE ({})\nLIMIT 1",
        escape_ident(stream_name),
        markers.join(" OR "),
    ))
}

/// Each minute holding a canonical row of `kind`, as the earliest-row probe defines it.
pub fn build_canonical_minutes_sql(stream_name: &str, kind: &str) -> String {
    minutes_sql(
        stream_name,
        &format!("{} = '{}'", server_vantage::O2_DBM_KIND, escape_sq(kind)),
    )
}

/// Each minute holding a raw deadlock marker; None when the stream has no marker column.
pub fn build_raw_deadlock_minutes_sql(
    stream_name: &str,
    raw: &RawDeadlockFallback,
) -> Option<String> {
    let markers = raw.marker_terms();
    (!markers.is_empty()).then(|| minutes_sql(stream_name, &format!("({})", markers.join(" OR "))))
}

/// Each minute holding a raw blocking marker; None when the stream has no `o2_recipe` column.
pub fn build_raw_blocking_minutes_sql(
    stream_name: &str,
    raw: &RawBlockingFallback,
) -> Option<String> {
    let markers = raw.marker_terms();
    (!markers.is_empty()).then(|| minutes_sql(stream_name, &format!("({})", markers.join(" OR "))))
}

/// The newest snapshot of every relation: `MAX`, since each value is a point-in-time state.
pub fn build_dbm_table_health_sql(
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

fn minutes_sql(stream_name: &str, predicate: &str) -> String {
    format!(
        "SELECT histogram(_timestamp, '1 minute') AS minute, count(*) AS n FROM \"{}\"\nWHERE {predicate}\nGROUP BY minute ORDER BY minute",
        escape_ident(stream_name),
    )
}
