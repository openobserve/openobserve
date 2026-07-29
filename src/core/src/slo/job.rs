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

//! The SLI ingest pass — the IO shell around [`super::ingest`]
//! (`alerts_2.md` §6b.4a, §6b.9).
//!
//! One job per enabled SLO, cadence = its slice interval, claimed through
//! `scheduled_jobs` like every other module so single-evaluator semantics are
//! inherited rather than reinvented.
//!
//! **Failure freezes; it does not zero.** A failed slice query writes no
//! slice, so coverage drops, and once coverage crosses `ZO_SLO_MIN_COVERAGE`
//! the SLO reads as no-data and its alerts freeze. The alternative — writing
//! zeros for what could not be measured — would report a search outage as
//! 100% downtime and page everyone.

use config::{
    get_config,
    meta::{
        search::{Query, Request, RequestEncoding},
        slo::{
            SliConfig, Slo,
            slice::SliceRow,
            stream::{SLO_SLICES_STREAM, SloSliceRow},
            window::{IngestRangeParams, ingest_range},
        },
        stream::StreamType,
    },
    utils::{json, time::now_micros},
};
use infra::table::{slo as slo_table, slos as slos_table};

use super::{
    ingest::{PassParams, PassResult, QueryRow, build_slices, exact_rollup, fill_missing},
    query::{SLICE_ALIAS, SliQueryPlan, VALUE_ALIAS, group_key, plan},
};

/// What one pass did, for logging and for the `triggers` usage record.
#[derive(Debug, Clone, PartialEq)]
pub enum PassOutcome {
    /// No new slice has closed since the watermark. The common case on a
    /// scheduler tick faster than the slice interval.
    NothingToDo,
    Wrote {
        slices: usize,
        groups: usize,
        rejected: usize,
        group_overflow: bool,
    },
    /// The generation moved while this pass was in flight. Its slices remain
    /// in the stream under the old generation, invisible to readers.
    Fenced { expected: i32, found: i32 },
}

/// Run one SLI ingest pass for `slo`.
pub async fn run_pass(slo: &Slo, now_secs: i64) -> Result<PassOutcome, anyhow::Error> {
    let cfg = get_config();
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("database not initialized"))?;

    let status = slo_table::load_status(db, &slo.id, "").await?;
    // A status row whose generation has already moved on means this pass was
    // planned under a definition that no longer exists. Stop before querying:
    // the work would be discarded by the CAS fence anyway.
    if let Some(s) = &status
        && s.definition_generation != slo.definition_generation
    {
        return Ok(PassOutcome::Fenced {
            expected: slo.definition_generation,
            found: s.definition_generation,
        });
    }

    let generation_reset_time = slos_table::generation_reset_time(db, &slo.id)
        .await?
        .unwrap_or(0);

    let Some(range) = ingest_range(IngestRangeParams {
        now_secs,
        watermark_end: status.as_ref().and_then(|s| s.watermark_end),
        slice_interval_secs: slo.definition.slice_interval_secs,
        ingest_delay_secs: cfg.slo.ingest_delay_secs,
        recompute_slices: cfg.slo.recompute_slices,
        generation_reset_time,
    }) else {
        return Ok(PassOutcome::NothingToDo);
    };

    let group_by = slo.definition.group_by.clone().unwrap_or_default();
    let params = PassParams {
        slo_id: slo.id.clone(),
        definition_generation: slo.definition_generation,
        range_start: range.start,
        range_end: range.end,
        slice_interval_secs: slo.definition.slice_interval_secs,
        // The pass's own end is a monotonic revision within the generation:
        // a later pass covering the same slice always has a later end, so its
        // rows win the dedupe. No counter to persist and no reuse across a
        // generation reset.
        rev: range.end,
        max_groups: cfg.slo.max_groups,
    };

    let rows = fetch_rows(slo, &group_by, &range, &params).await?;
    let mut result = build_slices(&slo.definition.sli_config, rows, &params);

    // Gap fill BEFORE the rollup, or a grouped SLO's zero-traffic buckets
    // would be missing from the exact overall row.
    let filled = fill_missing(
        slo.definition.sli_config.sli_type(),
        &result.slices,
        &params,
    );
    result.slices.extend(filled);

    if !group_by.is_empty() {
        let rollup = exact_rollup(&result.slices, &params);
        result.slices.extend(rollup);
    }

    if result.slices.is_empty() {
        // Nothing measurable. Deliberately NOT an error and deliberately not
        // zeros: coverage falls, and the freeze that follows is the correct
        // response to an absence of measurement.
        return Ok(PassOutcome::Wrote {
            slices: 0,
            groups: 0,
            rejected: result.rejected.len(),
            group_overflow: result.group_overflow,
        });
    }

    write_slices(&slo.org, &result.slices, now_secs).await?;

    let outcome = commit_status(db, slo, &result, range.end, now_secs).await?;
    if let slo_table::WriteOutcome::FencedByGeneration { expected, found } = outcome {
        return Ok(PassOutcome::Fenced { expected, found });
    }

    Ok(PassOutcome::Wrote {
        slices: result.slices.len(),
        groups: result.groups_seen,
        rejected: result.rejected.len(),
        group_overflow: result.group_overflow,
    })
}

/// Run the pass's query and normalize its rows.
async fn fetch_rows(
    slo: &Slo,
    group_by: &[String],
    range: &config::meta::slo::window::IngestRange,
    params: &PassParams,
) -> Result<Vec<QueryRow>, anyhow::Error> {
    let plan = plan(
        &slo.definition.sli_config,
        group_by,
        super::query::PlanRange {
            start_secs: range.start,
            end_secs: range.end,
            slice_interval_secs: params.slice_interval_secs,
        },
    );
    let stream_type = sli_stream_type(&slo.definition.sli_config);

    match plan {
        SliQueryPlan::NoQuery => Ok(Vec::new()),
        SliQueryPlan::Single(q) => {
            let hits = search(&slo.org, &q.sql, q.start_micros, q.end_micros, stream_type).await?;
            Ok(hits
                .iter()
                .filter_map(|h| to_row(h, group_by, true))
                .collect())
        }
        SliQueryPlan::Dual { good, total } => {
            let good_hits = search(
                &slo.org,
                &good.sql,
                good.start_micros,
                good.end_micros,
                stream_type,
            )
            .await?;
            let total_hits = search(
                &slo.org,
                &total.sql,
                total.start_micros,
                total.end_micros,
                stream_type,
            )
            .await?;
            Ok(join_dual(&good_hits, &total_hits, group_by))
        }
    }
}

fn sli_stream_type(sli: &SliConfig) -> StreamType {
    let raw = match sli {
        SliConfig::Count { source } => match source {
            config::meta::slo::CountSource::SingleQuery { stream_type, .. } => stream_type.as_str(),
            // The importer fallback carries its stream inside the SQL.
            config::meta::slo::CountSource::DualQuery { .. } => "logs",
        },
        SliConfig::TimeSlice { stream_type, .. } => stream_type.as_str(),
        SliConfig::Alert { .. } => "logs",
    };
    StreamType::from(raw)
}

/// Pair the numerator and denominator scans on `(slice_start, group_key)`.
///
/// A `good` row with no matching `total` is dropped rather than treated as
/// `total = 0`: it would make the SLI infinite. A `total` with no `good` is
/// kept as zero good, which is a real measurement of a fully-bad bucket.
fn join_dual(
    good_hits: &[json::Value],
    total_hits: &[json::Value],
    group_by: &[String],
) -> Vec<QueryRow> {
    let mut goods: std::collections::HashMap<(i64, String), f64> = Default::default();
    for h in good_hits {
        if let Some(r) = to_row(h, group_by, false) {
            goods.insert((r.slice_start, r.group_key), r.good);
        }
    }
    total_hits
        .iter()
        .filter_map(|h| to_row(h, group_by, false))
        .map(|mut r| {
            r.total = r.good;
            r.good = goods
                .get(&(r.slice_start, r.group_key.clone()))
                .copied()
                .unwrap_or(0.0);
            r
        })
        .collect()
}

/// Normalize one search hit.
///
/// `with_good_column` distinguishes the single-query shape (which projects a
/// separate `zo_slo_good`) from the dual shape (where the one value column is
/// the numerator or denominator depending on which scan it came from).
fn to_row(hit: &json::Value, group_by: &[String], with_good_column: bool) -> Option<QueryRow> {
    let obj = hit.as_object()?;
    let slice_start = parse_slice_start(obj.get(SLICE_ALIAS)?)?;

    let values: Vec<Option<String>> = group_by
        .iter()
        .map(|g| {
            obj.get(g.as_str()).and_then(|v| match v {
                json::Value::String(s) => Some(s.clone()),
                json::Value::Null => None,
                other => Some(other.to_string()),
            })
        })
        .collect();
    let key = group_key(group_by, &values);
    let labels = group_by
        .iter()
        .zip(&values)
        .map(|(k, v)| format!("{k}: {}", v.as_deref().unwrap_or("")))
        .collect::<Vec<_>>()
        .join(", ");

    let total = num(obj.get(VALUE_ALIAS)?)?;
    let good = if with_good_column {
        obj.get("zo_slo_good").and_then(num).unwrap_or(0.0)
    } else {
        total
    };

    Some(QueryRow {
        slice_start,
        group_key: key,
        group_labels: labels,
        good,
        total,
    })
}

/// Read the `slice_start` column as epoch **seconds**.
///
/// `histogram()` does NOT come back as a number. The search layer formats a
/// timestamp column for display, so the value arrives as
/// `"2026-07-29T13:56:00"` — and a numeric-only parse silently drops every
/// row, which shows up as a fully gap-filled window of `(0, 0)` slices rather
/// than as an error. That is what this cost to find, so all three encodings
/// are accepted explicitly:
///
/// * a datetime string, which is what the search layer actually returns today;
/// * epoch micros, which is how the value is stored;
/// * epoch seconds, in case a caller has already normalized.
fn parse_slice_start(v: &json::Value) -> Option<i64> {
    if let Some(s) = v.as_str()
        && let Some(secs) = parse_datetime_secs(s)
    {
        return Some(secs);
    }
    let n = num(v)? as i64;
    // Micros are ~1e15 for present-day timestamps and seconds ~1e9, so the
    // threshold is unambiguous for any date this product supports.
    Some(if n > 1_000_000_000_000 {
        n / 1_000_000
    } else {
        n
    })
}

/// Parse the search layer's timestamp rendering. Naive strings are UTC — the
/// search layer formats in UTC unless a timezone is requested, and the ingest
/// job never requests one.
fn parse_datetime_secs(s: &str) -> Option<i64> {
    use chrono::{DateTime, NaiveDateTime, Utc};
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp());
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%.f",
    ] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(dt.and_utc().timestamp());
        }
    }
    let _ = Utc::now;
    None
}

fn num(v: &json::Value) -> Option<f64> {
    match v {
        json::Value::Number(n) => n.as_f64(),
        json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// Execute one query on a background querier.
///
/// `grpc_search` with `RoleGroup::Background`, not the local search path: SLO
/// ingest is a scheduled bulk read and must not compete with interactive
/// queries. This is the same reason the alert evaluator switched.
async fn search(
    org: &str,
    sql: &str,
    start_micros: i64,
    end_micros: i64,
    stream_type: StreamType,
) -> Result<Vec<json::Value>, anyhow::Error> {
    let req = Request {
        query: Query {
            sql: sql.to_string(),
            from: 0,
            // A pass covers at most `recompute_slices + 1` buckets per group,
            // and group cardinality is capped, so this cannot be unbounded.
            size: 100_000,
            start_time: start_micros,
            end_time: end_micros,
            quick_mode: false,
            track_total_hits: false,
            ..Default::default()
        },
        encoding: RequestEncoding::Empty,
        timeout: 300,
        use_cache: false,
        local_mode: Some(false),
        ..Default::default()
    };
    let trace_id = config::ider::generate_trace_id();
    let resp = crate::search::grpc_search::grpc_search(
        &trace_id,
        org,
        stream_type,
        None,
        &req,
        Some(config::meta::cluster::RoleGroup::Background),
    )
    .await?;
    // A partial response would silently under-count, which reads as a dip in
    // the SLI rather than as the outage it is. Fail the pass instead: coverage
    // falls, and the freeze that follows is correct.
    if resp.is_partial {
        anyhow::bail!("SLO slice query returned a partial result");
    }
    Ok(resp.hits)
}

/// Publish slices to the reserved stream.
async fn write_slices(org: &str, slices: &[SliceRow], now_secs: i64) -> Result<(), anyhow::Error> {
    let rows: Vec<json::Value> = slices
        .iter()
        .map(|s| {
            json::to_value(SloSliceRow {
                _timestamp: now_secs * 1_000_000,
                org: org.to_string(),
                slo_id: s.slo_id.clone(),
                definition_generation: s.definition_generation,
                group_key: s.group_key.clone(),
                group_labels: String::new(),
                slice_start: s.slice_start,
                good: s.good,
                total: s.total,
                rev: s.rev,
            })
            .unwrap_or(json::Value::Null)
        })
        .collect();
    crate::slo::writer::publish(org, SLO_SLICES_STREAM, rows).await
}

/// Fold the pass's slices into the running aggregate, CAS-fenced.
async fn commit_status(
    db: &sea_orm::DatabaseConnection,
    slo: &Slo,
    result: &PassResult,
    watermark_end: i64,
    now_secs: i64,
) -> Result<slo_table::WriteOutcome, anyhow::Error> {
    let mut by_group: std::collections::BTreeMap<String, (f64, f64, i32)> = Default::default();
    for s in &result.slices {
        let e = by_group.entry(s.group_key.clone()).or_insert((0.0, 0.0, 0));
        e.0 += s.good;
        e.1 += s.total;
        e.2 += 1;
    }
    let deltas = by_group
        .into_iter()
        .map(
            |(group_key, (good, total, covered))| slo_table::GroupDelta {
                group_key,
                good_delta: good,
                total_delta: total,
                covered_slices_delta: covered,
            },
        )
        .collect();

    Ok(slo_table::apply_status(
        db,
        &slo_table::StatusWrite {
            slo_id: slo.id.clone(),
            definition_generation: slo.definition_generation,
            writer: config::meta::slo::slice::Writer::Incremental,
            deltas,
            watermark_end: Some(watermark_end),
            trailing_slices: None,
            computed_at: now_secs,
        },
    )
    .await?)
}

/// Measure an explicit `[start, end)` and publish it.
///
/// Shared by the incremental pass and by backfill. The `writer` argument is
/// what keeps them apart: backfill passes [`Writer::Backfill`], and
/// `apply_status` refuses to move the watermark for it — backfill fills
/// history *behind* the watermark, so advancing it would publish slices the
/// incremental writer has not reached.
pub async fn run_range(
    slo: &Slo,
    start: i64,
    end: i64,
    writer: config::meta::slo::slice::Writer,
) -> Result<usize, anyhow::Error> {
    let cfg = get_config();
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("database not initialized"))?;

    let group_by = slo.definition.group_by.clone().unwrap_or_default();
    let params = PassParams {
        slo_id: slo.id.clone(),
        definition_generation: slo.definition_generation,
        range_start: start,
        range_end: end,
        slice_interval_secs: slo.definition.slice_interval_secs,
        rev: end,
        max_groups: cfg.slo.max_groups,
    };
    let range = config::meta::slo::window::IngestRange { start, end };

    let rows = fetch_rows(slo, &group_by, &range, &params).await?;
    let mut result = build_slices(&slo.definition.sli_config, rows, &params);
    let filled = fill_missing(
        slo.definition.sli_config.sli_type(),
        &result.slices,
        &params,
    );
    result.slices.extend(filled);
    if !group_by.is_empty() {
        let rollup = exact_rollup(&result.slices, &params);
        result.slices.extend(rollup);
    }
    if result.slices.is_empty() {
        return Ok(0);
    }

    let now_secs = now_micros() / 1_000_000;
    write_slices(&slo.org, &result.slices, now_secs).await?;

    let mut by_group: std::collections::BTreeMap<String, (f64, f64, i32)> = Default::default();
    for s in &result.slices {
        let e = by_group.entry(s.group_key.clone()).or_insert((0.0, 0.0, 0));
        e.0 += s.good;
        e.1 += s.total;
        e.2 += 1;
    }
    let deltas = by_group
        .into_iter()
        .map(
            |(group_key, (good, total, covered))| slo_table::GroupDelta {
                group_key,
                good_delta: good,
                total_delta: total,
                covered_slices_delta: covered,
            },
        )
        .collect();

    slo_table::apply_status(
        db,
        &slo_table::StatusWrite {
            slo_id: slo.id.clone(),
            definition_generation: slo.definition_generation,
            writer,
            deltas,
            // Backfill never moves the watermark; the incremental writer sets
            // it from its own range end.
            watermark_end: None,
            trailing_slices: None,
            computed_at: now_secs,
        },
    )
    .await?;

    Ok(result.slices.len())
}

/// Schedule the next pass for an SLO.
pub fn next_run_at(slice_interval_secs: i64) -> i64 {
    now_micros() + slice_interval_secs * 1_000_000
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The encoding that actually comes back from `histogram()`. A
    /// numeric-only parse drops every row silently, which surfaces as a fully
    /// gap-filled window rather than as an error — found by end-to-end
    /// testing, not by review.
    #[test]
    fn a_formatted_timestamp_parses() {
        let v = json::Value::String("2026-07-29T13:56:00".into());
        assert_eq!(parse_slice_start(&v), Some(1_785_333_360));
    }

    #[test]
    fn an_rfc3339_timestamp_parses() {
        let v = json::Value::String("2026-07-29T13:56:00Z".into());
        assert_eq!(parse_slice_start(&v), Some(1_785_333_360));
        let v = json::Value::String("2026-07-29T13:56:00+00:00".into());
        assert_eq!(parse_slice_start(&v), Some(1_785_333_360));
    }

    #[test]
    fn a_space_separated_timestamp_parses() {
        let v = json::Value::String("2026-07-29 13:56:00".into());
        assert_eq!(parse_slice_start(&v), Some(1_785_333_360));
    }

    #[test]
    fn fractional_seconds_parse() {
        let v = json::Value::String("2026-07-29T13:56:00.000".into());
        assert_eq!(parse_slice_start(&v), Some(1_785_333_360));
    }

    #[test]
    fn epoch_micros_are_normalized_to_seconds() {
        let v = json::Value::Number(1_785_333_360_000_000i64.into());
        assert_eq!(parse_slice_start(&v), Some(1_785_333_360));
    }

    #[test]
    fn epoch_seconds_pass_through() {
        let v = json::Value::Number(1_785_333_360i64.into());
        assert_eq!(parse_slice_start(&v), Some(1_785_333_360));
    }

    /// A value that is neither must be None rather than 0 — 1970 would be
    /// silently out of every window, which is the same silent-drop failure in
    /// a different disguise.
    #[test]
    fn an_unparseable_value_is_none_not_zero() {
        assert_eq!(
            parse_slice_start(&json::Value::String("nonsense".into())),
            None
        );
        assert_eq!(parse_slice_start(&json::Value::Null), None);
        assert_eq!(parse_slice_start(&json::Value::Bool(true)), None);
    }
}
