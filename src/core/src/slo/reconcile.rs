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

//! Rebuilding the running aggregate from the slices (`alerts_2.md` §6b.4c).
//!
//! This is what makes at-least-once publication safe (D64), so it is
//! **load-bearing, not hygiene**. The running aggregate in `slo_status` is a
//! cache; the slices are the source of truth. A pass that wrote slices and
//! died before applying its delta leaves the cache stale, and this is what
//! repairs it. The bound on that staleness is
//! `ZO_SLO_RECONCILE_INTERVAL_SECS` — if it ever proves too loose, the fix is
//! to reconcile more often, not to rebuild a publication protocol.
//!
//! The read is deliberately **latest-revision-wins**, not `MAX(good)`.
//! `MAX` looks equivalent and is wrong: a recomputed time-slice can flip
//! good → bad, and `MAX` would keep the stale higher value — a failure mode
//! that only ever over-reports uptime.

use config::{
    get_config,
    meta::{
        slo::{SliType, Slo, stream::SLO_SLICES_STREAM, window::read_window},
        stream::StreamType,
    },
    utils::json,
};
use infra::{db::get_orm_client_rw, table::slo as slo_table};
use sea_orm::ConnectionTrait;

/// What a measured slice meets; a time-slice or alert `0 / 0` row nobody corrected is a tombstone.
pub const MEASURED_SQL: &str = "(total > 0 OR corrected_by <> '')";

/// Rows per request when every hit of a slices query is needed.
const SLICE_PAGE_SIZE: i64 = 10_000;

/// The per-group figures a rebuild produced.
#[derive(Debug, Clone, PartialEq)]
pub struct Rebuilt {
    pub group_key: String,
    pub good: f64,
    pub total: f64,
    pub covered_slices: i32,
}

/// A rebuild with the watermark it read up to, so a guarded write can tell if a pass moved it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Rebuild {
    pub watermark_end: Option<i64>,
    pub rows: Vec<Rebuilt>,
}

/// Rebuild every group's aggregate for one SLO and write the results.
pub async fn reconcile(slo: &Slo) -> Result<Vec<Rebuilt>, anyhow::Error> {
    let rows = rebuild(slo).await?.rows;
    write_rebuilt(get_orm_client_rw().await, &slo.id, &rows).await?;
    Ok(rows)
}

/// The figures [reconcile] would write, read without writing, so a caller can write them guarded.
pub async fn rebuild(slo: &Slo) -> Result<Rebuild, anyhow::Error> {
    let db = get_orm_client_rw().await;

    let Some(status) = slo_table::load_status(db, &slo.id, "").await? else {
        return Ok(Rebuild::default());
    };
    // Nothing has been measured under this generation yet, so there is no
    // cache to repair — and no watermark to bound the read by.
    let Some(watermark) = status.watermark_end else {
        return Ok(Rebuild::default());
    };
    // A rebuild computed under a superseded generation would write the old
    // definition's arithmetic into the new epoch. Reconciliation is exactly
    // where that mistake is easy to make: it looks like a pure repair.
    if status.definition_generation != slo.definition_generation {
        return Ok(Rebuild::default());
    }

    let (from, to) = read_window(watermark, slo.definition.window_secs);
    Ok(Rebuild {
        watermark_end: Some(watermark),
        rows: read_aggregate(slo, from, to).await?,
    })
}

pub async fn write_rebuilt<C: ConnectionTrait>(
    conn: &C,
    slo_id: &str,
    rows: &[Rebuilt],
) -> Result<(), anyhow::Error> {
    for r in rows {
        slo_table::reconcile_from_slices(
            conn,
            slo_id,
            &r.group_key,
            (r.good, r.total, r.covered_slices),
        )
        .await?;
    }
    Ok(())
}

/// The SQL that rebuilds one SLO's window.
///
/// `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY rev DESC)` picks the latest
/// revision per `(group_key, slice_start)` before aggregating. The §6b.4a
/// spike confirmed the engine supports it; the alternative — `MAX(good)` — is
/// wrong for the reason in the module note.
pub fn reconcile_sql(
    slo_id: &str,
    generation: i32,
    from: i64,
    to: i64,
    tombstones: bool,
) -> String {
    // Only a stream that can hold tombstones is asked for `corrected_by`, which older streams lack.
    let (covered, columns) = if tombstones {
        (
            format!("SUM(CASE WHEN {MEASURED_SQL} THEN 1 ELSE 0 END)"),
            ", corrected_by",
        )
    } else {
        ("COUNT(*)".to_string(), "")
    };
    format!(
        "SELECT group_key, \
                SUM(good) AS good, \
                SUM(total) AS total, \
                {covered} AS covered_slices \
         FROM ( \
           SELECT group_key, slice_start, good, total{columns}, \
                  ROW_NUMBER() OVER ( \
                    PARTITION BY group_key, slice_start ORDER BY rev DESC \
                  ) AS zo_rn \
           FROM {SLO_SLICES_STREAM} \
           WHERE slo_id = '{slo_id}' \
             AND definition_generation = {generation} \
             AND slice_start >= {from} AND slice_start < {to} \
         ) WHERE zo_rn = 1 \
         GROUP BY group_key"
    )
}

/// Whether a slice of this SLO can be a tombstone: a time-slice or alert SLI with `corrected_by`.
pub async fn tombstones_possible(slo: &Slo) -> bool {
    slo.definition.sli_config.sli_type() != SliType::Count
        && slices_carry_corrections(&slo.org).await
}

/// False when the org's slices stream has no `corrected_by` column, so no slice was ever corrected.
pub async fn slices_carry_corrections(org: &str) -> bool {
    match infra::schema::get(org, SLO_SLICES_STREAM, StreamType::Logs).await {
        Ok(schema) => has_corrected_by(&schema),
        // Unknown: the query that follows reports the real error and the job retries.
        Err(_) => true,
    }
}

pub fn has_corrected_by(schema: &arrow_schema::Schema) -> bool {
    schema.field_with_name("corrected_by").is_ok()
}

/// Every hit of `sql`, page by page until an empty page, so a result limit cannot drop rows.
pub async fn search_all_slices(
    org: &str,
    sql: &str,
    from: i64,
) -> Result<Vec<json::Value>, anyhow::Error> {
    collect_pages(|offset| search_slices_page(org, sql.to_string(), from, offset, SLICE_PAGE_SIZE))
        .await
}

/// Calls `fetch` with the running offset until it returns no hits; pages may be shorter than asked.
pub async fn collect_pages<F, Fut>(mut fetch: F) -> Result<Vec<json::Value>, anyhow::Error>
where
    F: FnMut(i64) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<json::Value>, anyhow::Error>>,
{
    let mut all = Vec::new();
    loop {
        let page = fetch(all.len() as i64).await?;
        if page.is_empty() {
            return Ok(all);
        }
        all.extend(page);
    }
}

/// The first 100,000 hits of `sql` over the slices stream, scanning from `from` minus the horizon.
pub async fn search_slices(
    org: &str,
    sql: String,
    from: i64,
) -> Result<Vec<json::Value>, anyhow::Error> {
    search_slices_page(org, sql, from, 0, 100_000).await
}

async fn search_slices_page(
    org: &str,
    sql: String,
    from: i64,
    offset: i64,
    size: i64,
) -> Result<Vec<json::Value>, anyhow::Error> {
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: offset,
            size,
            // Slices are written when measured, so a slice for `from` can
            // have been written well after it. Widen the scan by the
            // horizon rather than the window, or a late-written slice would
            // be invisible to the rebuild that is meant to find it.
            start_time: (from - get_config().slo.ingest_delay_secs) * 1_000_000,
            end_time: config::utils::time::now_micros(),
            quick_mode: false,
            track_total_hits: false,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        timeout: 300,
        use_cache: false,
        local_mode: Some(false),
        ..Default::default()
    };
    let trace_id = config::ider::generate_trace_id();
    let resp = crate::search::grpc_search::grpc_search(
        &trace_id,
        org,
        StreamType::Logs,
        None,
        &req,
        Some(config::meta::cluster::RoleGroup::Background),
    )
    .await?;
    if resp.is_partial {
        // A partial rebuild would write an under-count into the cache as if
        // it were authoritative — strictly worse than the drift it is meant
        // to repair, because the next pass's deltas accumulate on top of it.
        anyhow::bail!("SLO reconciliation returned a partial result; leaving the cache alone");
    }
    Ok(resp.hits)
}

async fn read_aggregate(slo: &Slo, from: i64, to: i64) -> Result<Vec<Rebuilt>, anyhow::Error> {
    let sql = reconcile_sql(
        &slo.id,
        slo.definition_generation,
        from,
        to,
        tombstones_possible(slo).await,
    );
    let hits = search_slices(&slo.org, sql, from).await?;
    Ok(hits
        .iter()
        .filter_map(|h| {
            let o = h.as_object()?;
            Some(Rebuilt {
                group_key: o
                    .get("group_key")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                good: o.get("good").and_then(json::Value::as_f64)?,
                total: o.get("total").and_then(json::Value::as_f64)?,
                covered_slices: o.get("covered_slices").and_then(json::Value::as_i64)? as i32,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `MAX(good)` looks equivalent and is wrong: a recomputed time-slice can
    /// flip good → bad, and MAX keeps the stale higher value — a failure that
    /// only ever over-reports uptime.
    #[test]
    fn the_rebuild_dedupes_by_latest_revision_not_by_max() {
        let sql = reconcile_sql("slo1", 3, 0, 900, false);
        assert!(sql.contains("ROW_NUMBER() OVER"), "{sql}");
        assert!(sql.contains("ORDER BY rev DESC"), "{sql}");
        assert!(sql.contains("zo_rn = 1"), "{sql}");
        assert!(
            !sql.contains("MAX(good)"),
            "MAX over-reports uptime after a good->bad recompute: {sql}"
        );
    }

    /// Reading another generation's slices would mix two definitions into one
    /// number that describes neither — the one corruption eventual
    /// consistency does not repair.
    #[test]
    fn the_rebuild_is_scoped_to_one_generation() {
        let sql = reconcile_sql("slo1", 3, 0, 900, false);
        assert!(sql.contains("definition_generation = 3"), "{sql}");
        assert!(sql.contains("slo_id = 'slo1'"), "{sql}");
    }

    #[test]
    fn the_rebuild_is_bounded_by_the_read_window() {
        let sql = reconcile_sql("slo1", 1, 100, 900, false);
        assert!(sql.contains("slice_start >= 100"), "{sql}");
        assert!(sql.contains("slice_start < 900"), "{sql}");
    }

    /// Partitioning by group_key alone would dedupe across time and collapse
    /// the whole window to one slice per group.
    #[test]
    fn dedupe_partitions_by_group_and_slice_together() {
        let sql = reconcile_sql("slo1", 1, 0, 900, false);
        assert!(sql.contains("PARTITION BY group_key, slice_start"), "{sql}");
    }

    #[test]
    fn a_withdrawn_correction_does_not_count_as_covered_for_a_time_slice_sli() {
        let sql = reconcile_sql("slo1", 1, 0, 900, true);
        assert!(
            sql.contains("SUM(CASE WHEN (total > 0 OR corrected_by <> '') THEN 1 ELSE 0 END)"),
            "{sql}"
        );
    }

    /// A count SLI's `0 / 0` is a quiet bucket; a stream without `corrected_by` has no tombstone.
    #[test]
    fn without_tombstones_every_slice_counts_as_covered() {
        let sql = reconcile_sql("slo1", 1, 0, 900, false);
        assert!(sql.contains("COUNT(*) AS covered_slices"), "{sql}");
        assert!(
            !sql.contains("corrected_by"),
            "an old stream lacks the column: {sql}"
        );
    }

    #[test]
    fn a_stream_from_before_corrections_has_no_corrected_by() {
        use arrow_schema::{DataType, Field, Schema};

        let old = Schema::new(vec![
            Field::new("slice_start", DataType::Int64, false),
            Field::new("good", DataType::Float64, false),
        ]);
        assert!(!has_corrected_by(&old));
        let new = Schema::new(vec![Field::new("corrected_by", DataType::Utf8, true)]);
        assert!(has_corrected_by(&new));
        assert!(
            !has_corrected_by(&Schema::empty()),
            "a stream not yet created"
        );
    }

    /// Pages stop only on an empty page, so a server cap below the asked size loses nothing.
    #[tokio::test]
    async fn paging_reads_every_hit_past_the_first_100k() {
        let total = 250_001_usize;
        let all = collect_pages(|offset| async move {
            let offset = offset as usize;
            let end = (offset + 7_000).min(total);
            Ok((offset..end).map(|i| json::json!({ "i": i })).collect())
        })
        .await
        .unwrap();
        assert_eq!(all.len(), total);
        assert_eq!(all[total - 1]["i"], total - 1);
    }

    #[test]
    fn the_rebuild_groups_by_group_key() {
        let sql = reconcile_sql("slo1", 1, 0, 900, false);
        assert!(sql.contains("GROUP BY group_key"), "{sql}");
        assert!(sql.contains("COUNT(*) AS covered_slices"), "{sql}");
    }
}
