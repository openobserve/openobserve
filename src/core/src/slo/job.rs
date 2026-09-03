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
            CountSource, QueryLanguage, SliConfig, Slo,
            alert_uptime::{EvalInterval, UptimeGrid, uptime_slices},
            slice::SliceRow,
            stream::{SLO_SLICES_STREAM, SloSliceRow},
            window::{IngestRangeParams, ingest_range},
        },
        stream::StreamType,
    },
    utils::{json, time::now_micros},
};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::{slo as slo_table, slos as slos_table},
};

use super::{
    ingest::{
        PassParams, PassResult, QueryRow, RejectReason, build_slices, exact_rollup, fill_missing,
    },
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
    let db = get_orm_client_ro().await;

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
        log::warn!("here, skipped the pass");
        return Ok(PassOutcome::NothingToDo);
    };

    // for promql query, we add the slice interval sec to start to get the actual query start time
    // see the prom_query fn for more details. But if after that calculation the start > = end
    // we will get error in downstream processing and the slo will freeze. Thus instead we check
    // here and skip early
    match &slo.definition.sli_config {
        SliConfig::TimeSlice { query_language, .. }
            if matches!(query_language, QueryLanguage::PromQl)
                && range.start + slo.definition.slice_interval_secs >= range.end =>
        {
            return Ok(PassOutcome::NothingToDo);
        }

        SliConfig::Count { source }
            if matches!(source, CountSource::PromQl { .. })
                && range.start + slo.definition.slice_interval_secs >= range.end =>
        {
            return Ok(PassOutcome::NothingToDo);
        }

        _ => {}
    }

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

    let (rows, query_rejects) = fetch_rows(slo, &group_by, &range, &params).await?;
    let mut result = build_slices(&slo.definition.sli_config, rows, &params);
    // Rows the query layer itself refused never reach `build_slices`, so their
    // reasons are merged in here. Dropping them would report a window that is
    // silently short of measurements as a clean pass, and the count is the only
    // signal that an ambiguous PromQL aggregate is eating slices.
    result.rejected.extend(query_rejects);

    // Gap fill BEFORE the rollup, or a grouped SLO's zero-traffic buckets
    // would be missing from the exact overall row.
    let filled = fill_missing(&slo.definition.sli_config, &result.slices, &params);
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
///
/// Returns the rows **and** the rows the normalization itself refused. Only the
/// PromQL time-slice arm can produce the latter — an ambiguous aggregate is not
/// a value that [`build_slices`] could reject downstream, it is the absence of
/// one — and it is returned rather than logged here so the pass's single
/// `rejected` count stays the one place that says how much of the window went
/// unmeasured.
async fn fetch_rows(
    slo: &Slo,
    group_by: &[String],
    range: &config::meta::slo::window::IngestRange,
    params: &PassParams,
) -> Result<(Vec<QueryRow>, Vec<(String, RejectReason)>), anyhow::Error> {
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
        SliQueryPlan::NoQuery => Ok((Vec::new(), Vec::new())),
        SliQueryPlan::AlertLedger {
            alert_id,
            start_secs,
            end_secs,
        } => {
            // An ORM meta-DB read like `load_status`, which this pass already
            // performs — not a search, so it does not go through the
            // background-querier discipline.
            let intervals = infra::table::alert_eval_intervals::list_overlapping(
                &alert_id,
                start_secs * 1_000_000,
                end_secs * 1_000_000,
            )
            .await?;
            Ok((
                ledger_query_rows(
                    &intervals,
                    UptimeGrid {
                        range_start_secs: start_secs,
                        range_end_secs: end_secs,
                        slice_interval_secs: params.slice_interval_secs,
                        min_coverage: get_config().slo.min_coverage,
                    },
                ),
                Vec::new(),
            ))
        }
        SliQueryPlan::Single(q) => {
            let hits = search(&slo.org, &q.sql, q.start_micros, q.end_micros, stream_type).await?;
            Ok((
                single_query_rows(&hits, group_by, &slo.definition.sli_config),
                Vec::new(),
            ))
        }
        SliQueryPlan::PromQl { good, total } => {
            let good_series = prom_search(&slo.org, &good).await?;
            let total_series = prom_search(&slo.org, &total).await?;
            Ok((
                promql_rows(
                    good_series,
                    total_series,
                    group_by,
                    params.slice_interval_secs,
                ),
                Vec::new(),
            ))
        }
        SliQueryPlan::PromQlValue(q) => {
            let series = prom_search(&slo.org, &q).await?;
            Ok(promql_value_rows(
                series,
                group_by,
                params.slice_interval_secs,
            ))
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
            Ok((join_dual(&good_hits, &total_hits, group_by), Vec::new()))
        }
    }
}

/// Fold ledger intervals onto the pass's slice grid and shape them as rows.
///
/// The arithmetic is [`uptime_slices`]; this is the boundary between the
/// storage row and the pure reader, and the `level` copy is the part that
/// matters — a stored level this build cannot interpret arrives as `None` and
/// must stay unmeasured, or unknown time becomes uptime (D34).
///
/// Every row carries the **empty group key**: the ledger records one run per
/// alert, and `""` is the reserved overall-rollup key. A grouped alert SLO is
/// refused at save for exactly this reason.
fn ledger_query_rows(
    intervals: &[infra::table::alert_eval_intervals::AlertEvalInterval],
    grid: UptimeGrid,
) -> Vec<QueryRow> {
    let ledger: Vec<EvalInterval> = intervals
        .iter()
        .map(|i| EvalInterval {
            level: i.level,
            frequency_secs: i.frequency_secs,
            from_us: i.from_us,
            to_us: i.to_us,
        })
        .collect();

    uptime_slices(&ledger, grid)
        .into_iter()
        .map(|s| QueryRow {
            slice_start: s.slice_start,
            group_key: String::new(),
            group_labels: String::new(),
            good: s.good_secs,
            total: s.total_secs,
        })
        .collect()
}

/// Normalize the hits of a [`SliQueryPlan::Single`] scan.
///
/// `plan` folds two SLI shapes onto that one variant and they do not project
/// the same columns: a count single-query emits its conditional SUM under
/// `zo_slo_good` beside the row count, while a time-slice query emits only its
/// aggregate and leaves the good/bad decision to [`build_slices`]. Which
/// column holds the numerator therefore comes from the SLI, never from
/// whichever columns a hit happens to carry — an absent column is silent, so
/// guessing would read a count bucket whose SUM came back NULL as fully good
/// and invent uptime.
fn single_query_rows(hits: &[json::Value], group_by: &[String], sli: &SliConfig) -> Vec<QueryRow> {
    let with_good_column = matches!(
        sli,
        SliConfig::Count {
            source: config::meta::slo::CountSource::SingleQuery { .. }
        }
    );
    hits.iter()
        .filter_map(|h| to_row(h, group_by, with_good_column))
        .collect()
}

fn sli_stream_type(sli: &SliConfig) -> StreamType {
    let raw = match sli {
        SliConfig::Count { source } => match source {
            config::meta::slo::CountSource::SingleQuery { stream_type, .. } => stream_type.as_str(),
            // The importer fallback carries its stream inside the SQL.
            config::meta::slo::CountSource::DualQuery { .. } => "logs",
            // PromQL only addresses metrics.
            config::meta::slo::CountSource::PromQl { .. } => "metrics",
        },
        SliConfig::TimeSlice { stream_type, .. } => stream_type.as_str(),
        SliConfig::Alert { .. } => "logs",
    };
    StreamType::from(raw)
}

/// One PromQL series in a neutral shape — labels plus `(micros, value)`
/// samples — so [`promql_rows`] stays decoupled from the promql engine's
/// types and testable without one.
#[derive(Debug, Clone, PartialEq)]
pub struct PromSeries {
    pub labels: std::collections::BTreeMap<String, String>,
    pub samples: Vec<(i64, f64)>,
}

/// Turn two PromQL range evaluations into joined [`QueryRow`]s.
///
/// Semantics, in order:
///
/// 1. A sample at instant T covers the slice **ending** at T — the plan evaluates at slice ends, so
///    `slice_start = T - interval`.
/// 2. Each side is summed to the **group grain first** (the SLO's `group_by` read from the series'
///    labels; a missing label is an empty value), then the sides are joined — exactly as the SQL
///    dual's per-side GROUP BY aggregates each scan before its join. A series-grain join would drop
///    a numerator series whose label set the denominator lacks even though its group is present on
///    both sides.
/// 3. Join rules follow [`join_dual`]: good with no total is dropped (an infinite SLI), total with
///    no good is a real fully-bad bucket.
/// 4. `good` is clamped to `total`: `increase()` over two different counters carries float error,
///    and a counter reset can transiently put good above total. Unclamped, the row is rejected
///    downstream (`GoodExceedsTotal`) and the slice becomes a coverage hole — routine pod restarts
///    would freeze the SLO. Written as a `>` comparison, NOT `f64::min`: `min(NaN, x)` returns `x`,
///    which would launder an unmeasurable numerator into a fully GOOD slice. NaN survives to the
///    ingest boundary, which rejects it.
pub fn promql_rows(
    good: Vec<PromSeries>,
    total: Vec<PromSeries>,
    group_by: &[String],
    slice_interval_secs: i64,
) -> Vec<QueryRow> {
    type Acc = std::collections::BTreeMap<(i64, String), (f64, String)>;
    let accumulate = |series: Vec<PromSeries>| -> Acc {
        let mut acc: Acc = Default::default();
        for s in series {
            let values: Vec<Option<String>> =
                group_by.iter().map(|g| s.labels.get(g).cloned()).collect();
            let key = group_key(group_by, &values);
            let labels = group_by
                .iter()
                .zip(&values)
                .map(|(k, v)| format!("{k}: {}", v.as_deref().unwrap_or("")))
                .collect::<Vec<_>>()
                .join(", ");
            for (t_micros, value) in s.samples {
                let slice_start = t_micros / 1_000_000 - slice_interval_secs;
                let e = acc
                    .entry((slice_start, key.clone()))
                    .or_insert((0.0, labels.clone()));
                e.0 += value;
            }
        }
        acc
    };

    let goods = accumulate(good);
    let totals = accumulate(total);

    totals
        .into_iter()
        .map(|((slice_start, group_key), (total, labels))| {
            let mut good = goods
                .get(&(slice_start, group_key.clone()))
                .map(|(v, _)| *v)
                .unwrap_or(0.0);
            if good > total {
                good = total;
            }
            QueryRow {
                slice_start,
                group_key,
                group_labels: labels,
                good,
                total,
            }
        })
        .collect()
}

/// Turn ONE PromQL range evaluation into time-slice [`QueryRow`]s, plus the
/// `(slice_start, group)` pairs that were too ambiguous to answer.
///
/// The mapping is [`promql_rows`]': a sample at instant T measures the slice
/// **ending** at T, so `slice_start = T - interval`, and the group key comes
/// from the series' labels so it matches the SQL path byte-for-byte.
///
/// What differs is the collision rule, and it is the reason this is not
/// [`promql_rows`]. When several series fold onto one `(slice_start, group)` —
/// the routine result of a query whose grain is finer than the SLO's grouping,
/// and the default for an ungrouped SLO over an unaggregated
/// `histogram_quantile` — the count path SUMS them, which is right for
/// counters: two pods' `increase()` genuinely add up. An aggregate has no such
/// combining rule. Two p95s do not add to a p95, do not average to one, and
/// taking whichever arrived last is arbitrary and unstable between passes.
///
/// Summing is the dangerous answer rather than the merely-imprecise one: two
/// 250ms p95s would read as 500ms and fail a `p95 < 300ms` objective, inventing
/// downtime out of a grouping mismatch. So the pair is refused — no row, and a
/// [`RejectReason::AmbiguousSeries`] naming the group — which leaves a coverage
/// hole with a reason attached instead of a confident wrong number. The refusal
/// is scoped to the ambiguous slice, never to the group or the pass: one
/// double-reporting instant must not black out a group's other instants.
///
/// Non-finite values are passed through untouched. `build_slices` rejects them;
/// substituting anything here would hand the classifier a real-looking number
/// (`0.0 < 300` reads as fully GOOD) and report an unmeasurable window as
/// uptime.
pub fn promql_value_rows(
    series: Vec<PromSeries>,
    group_by: &[String],
    slice_interval_secs: i64,
) -> (Vec<QueryRow>, Vec<(String, RejectReason)>) {
    // `None` marks a pair that a second series has already contested. Ordered
    // so both outputs are deterministic across passes: the same matrix must not
    // produce differently-ordered rejects run to run.
    type Seen = std::collections::BTreeMap<(i64, String), Option<(f64, String)>>;
    let mut seen: Seen = Default::default();

    for s in series {
        let values: Vec<Option<String>> =
            group_by.iter().map(|g| s.labels.get(g).cloned()).collect();
        let key = group_key(group_by, &values);
        let labels = group_by
            .iter()
            .zip(&values)
            .map(|(k, v)| format!("{k}: {}", v.as_deref().unwrap_or("")))
            .collect::<Vec<_>>()
            .join(", ");
        for (t_micros, value) in s.samples {
            let slice_start = t_micros / 1_000_000 - slice_interval_secs;
            seen.entry((slice_start, key.clone()))
                .and_modify(|slot| *slot = None)
                .or_insert_with(|| Some((value, labels.clone())));
        }
    }

    let mut rows = Vec::new();
    let mut rejected = Vec::new();
    for ((slice_start, key), slot) in seen {
        match slot {
            // One value column, so it is both `good` and `total` — the same
            // shape `to_row` gives a SQL time-slice hit, so nothing downstream
            // has to know which source produced the row.
            Some((value, labels)) => rows.push(QueryRow {
                slice_start,
                group_key: key,
                group_labels: labels,
                good: value,
                total: value,
            }),
            None => rejected.push((key, RejectReason::AmbiguousSeries)),
        }
    }
    (rows, rejected)
}

/// Run one PromQL range evaluation and normalize its matrix.
async fn prom_search(
    org: &str,
    q: &super::query::PromQuery,
) -> Result<Vec<PromSeries>, anyhow::Error> {
    let req = promql_service::MetricsQueryRequest {
        query: q.expr.clone(),
        start: q.start_micros,
        end: q.end_micros,
        step: q.step_micros,
        query_exemplars: false,
        use_cache: None,
        search_type: Some(config::meta::search::SearchEventType::DerivedStream),
        regions: vec![],
        clusters: vec![],
    };
    #[cfg(not(feature = "enterprise"))]
    let is_super_cluster = false;
    #[cfg(feature = "enterprise")]
    let is_super_cluster = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;

    let trace_id = config::ider::generate_trace_id();
    let resp =
        promql_service::search::search(&trace_id, org, &req, "", 0, is_super_cluster).await?;
    let config::meta::promql::value::Value::Matrix(matrix) = resp else {
        // The same rule as a partial SQL response: an unusable result is an
        // ERROR that fails the pass, so coverage falls — never an empty
        // window that reads as data.
        anyhow::bail!(
            "SLO PromQL query returned a non-matrix response : {resp:?} trace : {trace_id}",
        );
    };
    Ok(matrix
        .into_iter()
        .map(|rv| PromSeries {
            labels: rv
                .labels
                .iter()
                .map(|l| (l.name.to_string(), l.value.to_string()))
                .collect(),
            samples: rv.samples.iter().map(|s| (s.timestamp, s.value)).collect(),
        })
        .collect())
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

    // The burn-window cache (§6b.4c). Computed here rather than at alert time
    // so five alerts on one SLO cost zero extra scans (§6b.9). A failure to
    // build it must NOT fail the pass: the running aggregate is the primary
    // product, and a missing burn window freezes the burn-rate alerts (safe)
    // rather than losing the measurement (not).
    let (trailing_slices, burn_windows) =
        match build_burn_cache(db, slo, result, watermark_end).await {
            Ok(v) => v,
            Err(e) => {
                log::warn!(
                    "[slo] could not build burn windows for {}: {e} — the pass still publishes",
                    slo.id
                );
                (None, None)
            }
        };

    Ok(slo_table::apply_status(
        db,
        &slo_table::StatusWrite {
            slo_id: slo.id.clone(),
            definition_generation: slo.definition_generation,
            writer: config::meta::slo::slice::Writer::Incremental,
            deltas,
            watermark_end: Some(watermark_end),
            trailing_slices,
            burn_windows,
            computed_at: now_secs,
        },
    )
    .await?)
}

/// Build the trailing buffer and the burn-window aggregates for this pass.
///
/// Both live on the **rollup** row only: a grouped SLO's per-group rows carry
/// no watermark, so a per-group burn window would have nothing to be read
/// against (see `slo::evaluate`, and the deferral of per-group SLO alerts).
///
/// Returns `(None, None)` when no enabled alert asks for a burn window — an
/// SLO nobody alerts on burn-rate over pays nothing for the machinery.
async fn build_burn_cache(
    db: &sea_orm::DatabaseConnection,
    slo: &Slo,
    result: &PassResult,
    watermark_end: i64,
) -> Result<(Option<serde_json::Value>, Option<serde_json::Value>), anyhow::Error> {
    use config::meta::slo::burn;

    let cfg = get_config();
    // `None`: the ingest pass must see EVERY enabled alert's pair. Excluding
    // anything here would stop precomputing a window some alert still needs.
    let pairs =
        infra::table::alerts::list_slo_burn_window_pairs(db, &slo.org, &slo.id, None).await?;
    let durations = burn::durations_for_pairs(&pairs, cfg.slo.max_burn_window_pairs as usize);
    if durations.is_empty() {
        return Ok((None, None));
    }

    // The previous buffer, from the rollup row. Absent on the first pass of a
    // generation, and absent (rather than fatal) if it cannot be parsed.
    let prev = slo_table::load_status(db, &slo.id, "")
        .await?
        .filter(|row| row.definition_generation == slo.definition_generation)
        .and_then(|row| row.trailing_slices);
    let buf = burn::parse_trailing(prev.as_ref());

    // Only the rollup series feeds the buffer.
    let rollup = result
        .slices
        .iter()
        .filter(|s| s.group_key.is_empty())
        .map(|s| (s.slice_start, s.good, s.total));

    let buf = burn::fold_trailing(buf, rollup, watermark_end, burn::retain_secs(&durations));
    let windows = burn::burn_windows_json(
        &buf,
        &durations,
        watermark_end,
        slo.definition.slice_interval_secs,
    );
    Ok((Some(burn::trailing_to_json(&buf)), Some(windows)))
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
    let db = get_orm_client_rw().await;

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

    let (rows, query_rejects) = fetch_rows(slo, &group_by, &range, &params).await?;
    let mut result = build_slices(&slo.definition.sli_config, rows, &params);
    result.rejected.extend(query_rejects);
    let filled = fill_missing(&slo.definition.sli_config, &result.slices, &params);
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
            // it from its own range end. The trailing buffer and burn windows
            // follow the watermark for the same reason: they describe the
            // window ENDING at it, and backfill fills history behind it.
            watermark_end: None,
            trailing_slices: None,
            burn_windows: None,
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

/// Tests for turning availability-ledger intervals into [`QueryRow`]s (S-16).
///
/// The arithmetic itself lives in `config::meta::slo::alert_uptime` and is
/// tested there; what matters here is the mapping onto the pass's row shape.
#[cfg(test)]
mod alert_ledger_tests {
    use config::meta::{alerts::level::AlertLevel, slo::alert_uptime::UptimeGrid};
    use infra::table::alert_eval_intervals::AlertEvalInterval;

    use super::*;

    const SEC: i64 = 1_000_000;
    /// Deliberately not zero, and deliberately not the epoch: `0` reads the
    /// same in seconds and in microseconds, and a range starting at 0 cannot
    /// tell an absolute `slice_start` from an offset into the range.
    const RANGE_START: i64 = 1_200;

    fn stored(
        level: Option<AlertLevel>,
        from_secs: i64,
        to_secs: i64,
        freq: i64,
    ) -> AlertEvalInterval {
        AlertEvalInterval {
            id: 1,
            org: "myorg".into(),
            alert_id: "alert-1".into(),
            level,
            frequency_secs: freq,
            from_us: from_secs * SEC,
            to_us: to_secs * SEC,
        }
    }

    fn grid() -> UptimeGrid {
        UptimeGrid {
            range_start_secs: RANGE_START,
            range_end_secs: RANGE_START + 600,
            slice_interval_secs: 300,
            min_coverage: 0.9,
        }
    }

    /// The ledger is written once per alert, not once per group — `""` is the
    /// reserved overall-rollup key, and it is the only key an alert SLI can
    /// have. A grouped alert SLO is refused at save for exactly this reason.
    #[test]
    fn ledger_rows_carry_the_empty_group_key() {
        let rows = ledger_query_rows(
            &[stored(
                Some(AlertLevel::Ok),
                RANGE_START,
                RANGE_START + 540,
                60,
            )],
            grid(),
        );
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.group_key.is_empty()));
        assert!(rows.iter().all(|r| r.group_labels.is_empty()));
    }

    /// `slice_start` is **seconds**, unlike every other time on this path —
    /// `SliQuery` and the PromQL samples are microseconds. A row in micros is
    /// silently discarded downstream as `OffGrid`, so the SLO would freeze
    /// forever with nothing but a rejection count to show for it.
    #[test]
    fn ledger_rows_carry_absolute_slice_starts_in_seconds() {
        let rows = ledger_query_rows(
            &[stored(
                Some(AlertLevel::Ok),
                RANGE_START,
                RANGE_START + 540,
                60,
            )],
            grid(),
        );
        let starts: Vec<i64> = rows.iter().map(|r| r.slice_start).collect();
        assert_eq!(starts, vec![RANGE_START, RANGE_START + 300]);
    }

    /// Seconds go straight through: `build_slices` does not classify an alert
    /// SLI, so whatever the ledger reader computed is what the slice stores.
    #[test]
    fn ledger_rows_carry_good_and_total_seconds() {
        let rows = ledger_query_rows(
            &[stored(
                Some(AlertLevel::Ok),
                RANGE_START,
                RANGE_START + 240,
                60,
            )],
            grid(),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].slice_start, RANGE_START);
        assert_eq!(rows[0].good, 300.0);
        assert_eq!(rows[0].total, 300.0);
    }

    /// A measured but bad run is still a row: the seconds belong in the
    /// denominator, or downtime would read as a gap.
    #[test]
    fn a_bad_run_produces_a_zero_good_row_rather_than_no_row() {
        let rows = ledger_query_rows(
            &[stored(
                Some(AlertLevel::Critical),
                RANGE_START,
                RANGE_START + 240,
                60,
            )],
            grid(),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].good, rows[0].total), (0.0, 300.0));
    }

    /// The `level` copy is the one field in this mapping carrying an
    /// invariant: a stored integer this build cannot interpret must reach the
    /// reader as unmeasured. Defaulting it to `Ok` would turn unknown time
    /// into uptime — the D34 failure the ledger exists to prevent.
    #[test]
    fn an_uninterpretable_stored_level_produces_no_rows() {
        let rows = ledger_query_rows(&[stored(None, RANGE_START, RANGE_START + 540, 60)], grid());
        assert!(rows.is_empty(), "an unknown level must not read as uptime");
    }

    /// An alert with no ledger history produces no rows at all — which becomes
    /// a coverage hole and a freeze, never a window of zeros.
    #[test]
    fn an_empty_ledger_produces_no_rows() {
        assert!(ledger_query_rows(&[], grid()).is_empty());
    }
}

/// Tests for turning PromQL matrices into [`QueryRow`]s. Written before the
/// conversion exists; `PromSeries`/`promql_rows` below are the specification.
#[cfg(test)]
mod promql_rows_tests {
    use config::meta::slo::{CountSource, SliConfig};

    use super::*;

    fn series(labels: &[(&str, &str)], samples: &[(i64, f64)]) -> PromSeries {
        PromSeries {
            labels: labels
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            samples: samples.to_vec(),
        }
    }

    /// Micros, matching promql sample timestamps.
    const T1500: i64 = 1_500 * 1_000_000;
    const T1800: i64 = 1_800 * 1_000_000;

    #[test]
    fn a_sample_is_attributed_to_the_slice_it_closes() {
        let rows = promql_rows(
            vec![series(&[], &[(T1500, 7.0)])],
            vec![series(&[], &[(T1500, 10.0)])],
            &[],
            300,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].slice_start, 1_200,
            "a sample at T covers (T-interval, T], i.e. the slice STARTING at T-interval"
        );
        assert_eq!((rows[0].good, rows[0].total), (7.0, 10.0));
    }

    /// The key must agree byte-for-byte with what the SQL path would produce,
    /// because stored group keys survive a source change within a generation.
    #[test]
    fn series_labels_become_the_group_key_in_definition_order() {
        let gb = vec!["region".to_string(), "tier".to_string()];
        let rows = promql_rows(
            vec![series(
                &[("tier", "gold"), ("region", "eu")],
                &[(T1500, 1.0)],
            )],
            vec![series(
                &[("region", "eu"), ("tier", "gold")],
                &[(T1500, 2.0)],
            )],
            &gb,
            300,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].group_key, "region=eu,tier=gold");
    }

    #[test]
    fn a_missing_group_label_reads_as_empty_not_dropped() {
        let gb = vec!["region".to_string()];
        let rows = promql_rows(
            vec![series(&[], &[(T1500, 1.0)])],
            vec![series(&[], &[(T1500, 1.0)])],
            &gb,
            300,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].group_key, "region=");
    }

    /// Users routinely return finer series than the SLO's grouping (per-pod
    /// series, per-region SLO). They sum — exactly what the SQL path's
    /// GROUP BY would have done.
    #[test]
    fn series_finer_than_the_group_by_are_summed() {
        let gb = vec!["region".to_string()];
        let rows = promql_rows(
            vec![
                series(&[("region", "eu"), ("pod", "a")], &[(T1500, 3.0)]),
                series(&[("region", "eu"), ("pod", "b")], &[(T1500, 4.0)]),
            ],
            vec![
                series(&[("region", "eu"), ("pod", "a")], &[(T1500, 5.0)]),
                series(&[("region", "eu"), ("pod", "b")], &[(T1500, 5.0)]),
            ],
            &gb,
            300,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].good, rows[0].total), (7.0, 10.0));
    }

    #[test]
    fn an_ungrouped_slo_sums_every_series_into_the_empty_key() {
        let rows = promql_rows(
            vec![
                series(&[("pod", "a")], &[(T1500, 1.0)]),
                series(&[("pod", "b")], &[(T1500, 2.0)]),
            ],
            vec![
                series(&[("pod", "a")], &[(T1500, 2.0)]),
                series(&[("pod", "b")], &[(T1500, 2.0)]),
            ],
            &[],
            300,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].group_key, "");
        assert_eq!((rows[0].good, rows[0].total), (3.0, 4.0));
    }

    /// Same rules as the SQL dual join: a numerator with no denominator would
    /// make the SLI infinite and is dropped; a denominator with no numerator
    /// is a real, fully-bad bucket.
    #[test]
    fn the_join_follows_the_dual_query_rules() {
        let dropped = promql_rows(vec![series(&[], &[(T1500, 5.0)])], vec![], &[], 300);
        assert!(
            dropped.is_empty(),
            "a good series with no total must be dropped"
        );

        let bad = promql_rows(vec![], vec![series(&[], &[(T1500, 5.0)])], &[], 300);
        assert_eq!(bad.len(), 1);
        assert_eq!((bad[0].good, bad[0].total), (0.0, 5.0));
    }

    /// The join happens at the GROUP grain, not the series grain — each side
    /// is summed to the group first, exactly as the SQL dual's GROUP BY
    /// aggregates each scan before the join. A series-grain join would
    /// silently drop a numerator series whose labels the denominator lacks,
    /// even though its GROUP is present on both sides.
    #[test]
    fn each_side_is_summed_to_the_group_before_the_join() {
        let gb = vec!["region".to_string()];
        let rows = promql_rows(
            vec![
                series(&[("region", "eu"), ("pod", "a")], &[(T1500, 3.0)]),
                // No pod=c in the denominator — but region=eu is on both sides.
                series(&[("region", "eu"), ("pod", "c")], &[(T1500, 7.0)]),
            ],
            vec![series(&[("region", "eu"), ("pod", "a")], &[(T1500, 10.0)])],
            &gb,
            300,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].good, rows[0].total),
            (10.0, 10.0),
            "a series-grain join would have dropped pod=c and answered (3, 10)"
        );
    }

    /// `increase()` over two DIFFERENT counters carries float error, and a
    /// counter reset can transiently put good above total. Unclamped, the row
    /// is rejected downstream (GoodExceedsTotal) and the slice becomes a
    /// coverage hole — routine pod restarts would freeze the SLO.
    #[test]
    fn good_is_clamped_to_total_against_counter_jitter() {
        let rows = promql_rows(
            vec![series(&[], &[(T1500, 100.001)])],
            vec![series(&[], &[(T1500, 100.0)])],
            &[],
            300,
        );
        assert_eq!(rows[0].good, 100.0);
    }

    /// `f64::min(NaN, x)` returns x — a clamp written with `.min()` would
    /// launder an unmeasurable numerator into a fully GOOD slice. NaN must
    /// survive to the ingest boundary, which rejects the row and lets
    /// coverage fall instead.
    #[test]
    fn a_nan_numerator_is_not_laundered_into_good_by_the_clamp() {
        let rows = promql_rows(
            vec![series(&[], &[(T1500, f64::NAN)])],
            vec![series(&[], &[(T1500, 5.0)])],
            &[],
            300,
        );
        assert_eq!(rows.len(), 1);
        assert!(
            rows[0].good.is_nan(),
            "NaN was replaced by {}",
            rows[0].good
        );
    }

    #[test]
    fn each_sample_becomes_its_own_slice_in_time_order() {
        let rows = promql_rows(
            vec![series(&[], &[(T1500, 1.0), (T1800, 2.0)])],
            vec![series(&[], &[(T1500, 2.0), (T1800, 2.0)])],
            &[],
            300,
        );
        assert_eq!(rows.len(), 2);
        let starts: Vec<i64> = rows.iter().map(|r| r.slice_start).collect();
        assert_eq!(starts, vec![1_200, 1_500]);
    }

    /// The promql search must be issued against the metrics stream.
    #[test]
    fn a_promql_source_reads_the_metrics_stream_type() {
        let sli = SliConfig::Count {
            source: CountSource::PromQl {
                good: "g".into(),
                total: "t".into(),
            },
        };
        assert_eq!(sli_stream_type(&sli), StreamType::Metrics);
    }
}

/// Tests for normalizing a `SliQueryPlan::Single` hit.
///
/// `plan` returns `Single` for **two** different SLI shapes, and they project
/// different columns: a count single-query projects `zo_slo_good` alongside
/// `zo_slo_value`, a time-slice query projects `zo_slo_value` alone. One
/// `Single` arm therefore has to normalize two shapes, and reading the
/// numerator from a column that only one of them has is silent — the missing
/// column defaults to `0.0` rather than failing.
///
/// These call [`single_query_rows`], the production normalizer, rather than
/// re-implementing it: `fetch_rows` wraps it in a search RPC that a unit test
/// cannot reach, so the extracted function is the seam and the arm's whole
/// job is to call it.
#[cfg(test)]
mod single_query_row_tests {
    use config::meta::{
        alerts::Operator,
        slo::{QueryLanguage, SliConfig},
    };

    use super::*;

    /// Aligned to the 300s grid so `build_slices` accepts it, and written in
    /// the datetime encoding the search layer actually returns.
    const SLICE_START: i64 = 1_785_333_000;
    const SLICE_START_TEXT: &str = "2026-07-29T13:50:00";
    const SLICE_SECS: i64 = 300;

    /// A hit shaped like `time_slice_sql`'s projection: the bucket and ONE
    /// value column. There is deliberately no `zo_slo_good` — a time-slice
    /// query aggregates and leaves the good/bad decision to Rust, so the
    /// column does not exist to be read.
    fn time_slice_hit(value: f64) -> json::Value {
        json::json!({
            "slice_start": SLICE_START_TEXT,
            "zo_slo_value": value,
        })
    }

    /// A hit shaped like `single_count_sql`'s projection: the conditional sum
    /// under `zo_slo_good` and the row count under `zo_slo_value`. Integers,
    /// as `SUM(CASE …)` and `COUNT(*)` actually come back.
    fn count_hit(good: i64, total: i64) -> json::Value {
        json::json!({
            "slice_start": SLICE_START_TEXT,
            "zo_slo_good": good,
            "zo_slo_value": total,
        })
    }

    fn time_slice_sli(comparator: Operator, threshold: f64) -> SliConfig {
        SliConfig::TimeSlice {
            stream: "requests".into(),
            stream_type: "logs".into(),
            query_language: QueryLanguage::Sql,
            query: "approx_percentile_cont(duration_ms, 0.95)".into(),
            scope: None,
            comparator,
            threshold,
            absent_is_bad: false,
        }
    }

    fn params() -> PassParams {
        PassParams {
            slo_id: "slo1".to_string(),
            definition_generation: 1,
            range_start: SLICE_START,
            range_end: SLICE_START + SLICE_SECS,
            slice_interval_secs: SLICE_SECS,
            rev: 7,
            max_groups: 500,
        }
    }

    fn count_sli() -> SliConfig {
        SliConfig::Count {
            source: config::meta::slo::CountSource::SingleQuery {
                stream: "requests".into(),
                stream_type: "logs".into(),
                scope: None,
                good_expr: "status_code < 500".into(),
            },
        }
    }

    /// `QueryRow::good` is documented as "the aggregate value for a time-slice
    /// one", and `build_slices` classifies `row.good` against the threshold.
    /// A normalization that looks for `zo_slo_good` — a column
    /// `time_slice_sql` never projects — and defaults it to `0.0` hands the
    /// classifier a zero for every bucket in every pass.
    #[test]
    fn a_time_slice_hit_normalizes_its_aggregate_into_good() {
        let rows = single_query_rows(
            &[time_slice_hit(450.0)],
            &[],
            &time_slice_sli(Operator::LessThan, 300.0),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].good, 450.0,
            "the aggregate is what the classifier compares against"
        );
        assert_eq!(
            rows[0].total, 450.0,
            "a time-slice row has one value column, so good and total are it"
        );
    }

    /// The count shape must keep reading its numerator from its own column:
    /// the two shapes share the `Single` arm, so the fix for one must not
    /// swap the columns of the other.
    #[test]
    fn a_count_hit_reads_its_numerator_from_zo_slo_good() {
        let rows = single_query_rows(&[count_hit(97, 100)], &[], &count_sli());
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].good, rows[0].total), (97.0, 100.0));
    }

    /// The mirror-image hazard, and the reason the flag must come from the
    /// SLI rather than from which columns happen to be present. Guessing
    /// ("no `zo_slo_good`? then the value column is the numerator") reads a
    /// count bucket whose conditional SUM came back NULL as **fully good**
    /// instead of fully bad — the same silent zero this module exists to
    /// stop, pointing the other way and inventing uptime.
    #[test]
    fn a_count_hit_missing_its_good_column_is_fully_bad_not_fully_good() {
        let no_good_column = json::json!({
            "slice_start": SLICE_START_TEXT,
            "zo_slo_value": 100,
        });
        let rows = single_query_rows(&[no_good_column], &[], &count_sli());
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].good, rows[0].total),
            (0.0, 100.0),
            "an absent numerator is zero good, never all good"
        );
    }

    /// Every hit is normalized, and an unreadable one is DROPPED rather than
    /// aborting the batch. The unreadable hit is deliberately first: a
    /// normalizer that took only the head, or that unwrapped instead of
    /// filtering, would return nothing here while still satisfying every
    /// single-hit assertion above.
    #[test]
    fn a_batch_normalizes_every_readable_hit_and_drops_the_rest() {
        let unreadable = json::json!({
            "slice_start": "not-a-timestamp",
            "zo_slo_value": 1.0,
        });
        let second_bucket = json::json!({
            "slice_start": "2026-07-29T13:55:00",
            "zo_slo_value": 275.0,
        });
        let rows = single_query_rows(
            &[unreadable, time_slice_hit(450.0), second_bucket],
            &[],
            &time_slice_sli(Operator::LessThan, 300.0),
        );
        assert_eq!(
            rows.len(),
            2,
            "one hit is unreadable, the other two are not"
        );
        assert_eq!(
            (rows[0].slice_start, rows[0].good),
            (SLICE_START, 450.0),
            "hits keep their order"
        );
        assert_eq!(
            (rows[1].slice_start, rows[1].good),
            (SLICE_START + SLICE_SECS, 275.0)
        );
    }

    /// The user-visible symptom, from search hit to stored slice: a 450ms p95
    /// against a `p95 < 300ms` objective is a fully BAD slice. If the
    /// aggregate never reaches `QueryRow::good` the classifier compares
    /// `0.0 < 300` instead and stores a fully GOOD one — the SLO reads 100%
    /// forever and its alerts can never fire.
    #[test]
    fn a_time_slice_aggregate_over_its_threshold_stores_a_fully_bad_slice() {
        let sli = time_slice_sli(Operator::LessThan, 300.0);
        let result = build_slices(
            &sli,
            single_query_rows(&[time_slice_hit(450.0)], &[], &sli),
            &params(),
        );
        assert_eq!(result.slices.len(), 1);
        assert_eq!(
            (result.slices[0].good, result.slices[0].total),
            (0.0, 300.0),
            "seconds, not a ratio — and the slice still counts as measured"
        );
    }

    /// A `>` objective is where the zero is unmistakable: an availability
    /// aggregate of 99.9 against `> 99.0` is good, but a laundered `0.0`
    /// compares false and reads as a fully bad slice — the same defect
    /// pointing the other way, which pages continuously instead of never.
    #[test]
    fn a_greater_than_objective_is_not_inverted_by_a_lost_aggregate() {
        let sli = time_slice_sli(Operator::GreaterThan, 99.0);
        let result = build_slices(
            &sli,
            single_query_rows(&[time_slice_hit(99.9)], &[], &sli),
            &params(),
        );
        assert_eq!(result.slices.len(), 1);
        assert_eq!(
            (result.slices[0].good, result.slices[0].total),
            (300.0, 300.0)
        );
    }
}

/// Tests for turning a PromQL time-slice matrix into [`QueryRow`]s.
///
/// A time-slice SLI is **one number per slice**, not a good/total pair, so
/// this normalizer is not [`promql_rows`] with an argument dropped — the two
/// differ on the one thing that matters. `promql_rows` SUMS series that fold
/// onto the same group, which is right for counters: two pods' `increase()`
/// really do add up. Summing is *wrong* for an aggregate. Two series carrying
/// a p95 for the same slice and group do not add to a p95, do not average to
/// one, and picking either is arbitrary — so the pair is AMBIGUOUS and is
/// rejected rather than answered wrongly (D2).
///
/// Written before `promql_value_rows` exists; the assertions below are its
/// specification.
#[cfg(test)]
mod promql_value_rows_tests {
    use config::meta::{alerts::Operator, slo::QueryLanguage};

    use super::*;
    use crate::slo::ingest::RejectReason;

    const SLICE_SECS: i64 = 300;
    /// Aligned to the 300s grid so `build_slices` accepts it, and chosen to
    /// match the datetime the SQL path's fixture renders — the cross-source
    /// comparison below depends on both sources landing on the same slice.
    const SLICE_START: i64 = 1_785_333_000;
    const SLICE_START_TEXT: &str = "2026-07-29T13:50:00";
    /// The instant a sample for `SLICE_START` arrives at: PromQL is evaluated
    /// at slice ENDS, so a sample at T covers the slice starting at
    /// `T - interval`. Micros, matching promql sample timestamps.
    const T_END: i64 = (SLICE_START + SLICE_SECS) * 1_000_000;
    const T_END_NEXT: i64 = (SLICE_START + 2 * SLICE_SECS) * 1_000_000;

    fn series(labels: &[(&str, &str)], samples: &[(i64, f64)]) -> PromSeries {
        PromSeries {
            labels: labels
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            samples: samples.to_vec(),
        }
    }

    fn time_slice_sli(query_language: QueryLanguage, comparator: Operator) -> SliConfig {
        SliConfig::TimeSlice {
            stream: "http_request_duration_seconds".into(),
            stream_type: "metrics".into(),
            query_language,
            query: "histogram_quantile(0.95, rate(latency_bucket[5m]))".into(),
            scope: None,
            comparator,
            threshold: 300.0,
            absent_is_bad: false,
        }
    }

    fn params() -> PassParams {
        PassParams {
            slo_id: "slo1".to_string(),
            definition_generation: 1,
            range_start: SLICE_START,
            range_end: SLICE_START + SLICE_SECS,
            slice_interval_secs: SLICE_SECS,
            rev: 7,
            max_groups: 500,
        }
    }

    // ===================== sample-to-slice mapping ========================

    /// The plan evaluates at slice ends, so a sample at T is the measurement
    /// of `(T - interval, T]`. Recording it at T instead would file every
    /// value one slice late — invisible in the values and wrong in all of
    /// them, and out of range at the pass boundary.
    #[test]
    fn a_sample_is_attributed_to_the_slice_it_closes() {
        let (rows, rejected) =
            promql_value_rows(vec![series(&[], &[(T_END, 450.0)])], &[], SLICE_SECS);
        assert!(rejected.is_empty());
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].slice_start, SLICE_START);
    }

    /// A time-slice `QueryRow` has ONE value column, so it carries that value
    /// in BOTH fields — exactly what the SQL path already does (`to_row`'s
    /// `with_good_column: false` arm sets `good = total = value`, pinned by
    /// `a_time_slice_hit_normalizes_its_aggregate_into_good`). `build_slices`
    /// reads only `good`, so the two sources must not disagree about `total`:
    /// one shape carrying the value and the other a zero for the same SLI type
    /// is a landmine for anything that later reads a denominator.
    #[test]
    fn the_aggregate_lands_in_both_columns_as_the_sql_path_does() {
        let (rows, _) = promql_value_rows(vec![series(&[], &[(T_END, 450.0)])], &[], SLICE_SECS);
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].good, rows[0].total),
            (450.0, 450.0),
            "one value column, so good and total are it — one rule for both sources"
        );
    }

    #[test]
    fn each_sample_becomes_its_own_slice_in_time_order() {
        let (rows, _) = promql_value_rows(
            vec![series(&[], &[(T_END, 1.0), (T_END_NEXT, 2.0)])],
            &[],
            SLICE_SECS,
        );
        assert_eq!(rows.len(), 2);
        let starts: Vec<i64> = rows.iter().map(|r| r.slice_start).collect();
        assert_eq!(starts, vec![SLICE_START, SLICE_START + SLICE_SECS]);
    }

    // ===================== group identity =================================

    /// The key must agree byte-for-byte with what the SQL path would produce,
    /// because stored group keys survive a source change within a generation —
    /// a differently-ordered key makes every group look new and restarts the
    /// SLO.
    #[test]
    fn series_labels_become_the_group_key_in_definition_order() {
        let gb = vec!["region".to_string(), "tier".to_string()];
        let (rows, _) = promql_value_rows(
            vec![series(
                &[("tier", "gold"), ("region", "eu")],
                &[(T_END, 12.5)],
            )],
            &gb,
            SLICE_SECS,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].group_key, "region=eu,tier=gold");
        assert_eq!(rows[0].group_labels, "region: eu, tier: gold");
    }

    /// A series that simply lacks one of the SLO's group labels is still a
    /// measurement. Dropping it would silently shrink the window; the empty
    /// value keeps it, in the same shape the SQL path gives a NULL column.
    #[test]
    fn a_missing_group_label_reads_as_empty_not_dropped() {
        let gb = vec!["region".to_string()];
        let (rows, rejected) =
            promql_value_rows(vec![series(&[], &[(T_END, 12.5)])], &gb, SLICE_SECS);
        assert!(rejected.is_empty());
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].group_key, "region=");
        assert_eq!(rows[0].group_labels, "region: ");
    }

    #[test]
    fn an_ungrouped_slo_gets_the_empty_group_key() {
        let (rows, _) = promql_value_rows(
            vec![series(&[("pod", "a")], &[(T_END, 12.5)])],
            &[],
            SLICE_SECS,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].group_key, "");
        assert_eq!(rows[0].group_labels, "");
    }

    // ===================== ambiguity (D2) =================================

    /// The whole reason this is not `promql_rows`. Two series folding onto one
    /// `(slice_start, group_key)` is the routine result of a query returning a
    /// finer grain than the SLO groups by — per-pod series under a per-region
    /// SLO. For counters that SUMS correctly. For an aggregate there is no
    /// correct answer: two p95s neither add nor average to a p95, and taking
    /// whichever arrived last is arbitrary and unstable between passes.
    ///
    /// A summed answer here is the dangerous outcome, not a missing one: two
    /// 250ms p95s would sum to 500ms and read as a fully BAD slice under
    /// `< 300`, inventing downtime out of a grouping mismatch. The pair is
    /// rejected instead: the slice is not written, so coverage falls with a
    /// reason attached — unless the SLO opts into `absent_is_bad`, which
    /// records the unwritten bucket as downtime rather than as a hole.
    #[test]
    fn two_series_colliding_on_one_slice_and_group_are_rejected_not_summed() {
        let gb = vec!["region".to_string()];
        let (rows, rejected) = promql_value_rows(
            vec![
                series(&[("region", "eu"), ("pod", "a")], &[(T_END, 250.0)]),
                series(&[("region", "eu"), ("pod", "b")], &[(T_END, 250.0)]),
            ],
            &gb,
            SLICE_SECS,
        );
        assert!(
            rows.is_empty(),
            "an ambiguous aggregate was answered anyway: {rows:?}"
        );
        assert_eq!(
            rejected,
            vec![("region=eu".to_string(), RejectReason::AmbiguousSeries)],
            "the ambiguous pair must be surfaced with a reason, not dropped"
        );
    }

    /// Ambiguity is not a property of grouping, and this is the likeliest way
    /// it actually shows up: a `histogram_quantile` written without a
    /// `sum by (…)` returns one series per instance, and an UNGROUPED SLO
    /// folds every one of them onto the empty key. An implementation that
    /// only looks for collisions when `!group_by.is_empty()` — and otherwise
    /// sums into `""`, which is exactly what the count path is required to do
    /// (`an_ungrouped_slo_sums_every_series_into_the_empty_key`) — passes
    /// every other test in this section and still adds two p95s together.
    #[test]
    fn two_series_colliding_on_the_empty_group_are_rejected_too() {
        let (rows, rejected) = promql_value_rows(
            vec![
                series(&[("pod", "a")], &[(T_END, 250.0)]),
                series(&[("pod", "b")], &[(T_END, 250.0)]),
            ],
            &[],
            SLICE_SECS,
        );
        assert!(
            rows.is_empty(),
            "an ungrouped collision was summed into the empty key: {rows:?}"
        );
        assert_eq!(
            rejected,
            vec![(String::new(), RejectReason::AmbiguousSeries)]
        );
    }

    /// The rejection is scoped to the ambiguous SLICE, not to the pass and not
    /// to the group. Refusing the whole pass — or blacklisting `region=eu` for
    /// the pass because one of its instants collided — would turn one
    /// mislabelled or briefly-double-reporting series into a blackout, which
    /// is a far worse failure than the one being prevented.
    ///
    /// The colliding group therefore carries a SECOND, uncontested instant
    /// that must survive. Without it a group-wide veto is indistinguishable
    /// from a slice-scoped one, and this test would pass either way.
    #[test]
    fn an_ambiguous_slice_does_not_reject_its_unambiguous_neighbours() {
        let gb = vec!["region".to_string()];
        let (rows, rejected) = promql_value_rows(
            vec![
                // The two eu series collide at T_END only; pod=a alone reports
                // at T_END_NEXT, so that slice of region=eu is unambiguous.
                series(
                    &[("region", "eu"), ("pod", "a")],
                    &[(T_END, 250.0), (T_END_NEXT, 275.0)],
                ),
                series(&[("region", "eu"), ("pod", "b")], &[(T_END, 260.0)]),
                series(&[("region", "us")], &[(T_END, 100.0)]),
                // An untouched group, across both slices.
                series(&[("region", "ap")], &[(T_END, 1.0), (T_END_NEXT, 2.0)]),
            ],
            &gb,
            SLICE_SECS,
        );
        assert_eq!(rejected.len(), 1, "collateral rejections: {rejected:?}");
        // Sorted rather than compared in emission order: what this test is
        // about is which rows SURVIVED, not the order they came back in.
        let mut kept: Vec<(i64, String, String)> = rows
            .iter()
            .map(|r| (r.slice_start, r.group_key.clone(), r.good.to_string()))
            .collect();
        kept.sort();
        assert_eq!(
            kept,
            vec![
                (SLICE_START, "region=ap".to_string(), "1".to_string()),
                (SLICE_START, "region=us".to_string(), "100".to_string()),
                (
                    SLICE_START + SLICE_SECS,
                    "region=ap".to_string(),
                    "2".to_string()
                ),
                (
                    SLICE_START + SLICE_SECS,
                    "region=eu".to_string(),
                    "275".to_string()
                ),
            ],
            "the colliding group lost its uncontested slice too"
        );
    }

    // ===================== non-finite values ==============================

    /// NaN must reach the ingest boundary, which rejects it: the slice is not
    /// written and coverage falls, unless the SLO opts into `absent_is_bad`
    /// and the bucket is recorded as downtime instead. Laundering it here — to
    /// `0.0`, or by skipping the sample — would hand `classify_time_slice` a
    /// real-looking number: `0.0 < 300` reads as a fully GOOD slice, so an
    /// unmeasurable window would report 100% uptime. This mirrors
    /// `promql_rows`' refusal to clamp with `f64::min`.
    #[test]
    fn a_non_finite_value_survives_to_the_ingest_boundary() {
        for bad in [f64::NAN, f64::INFINITY] {
            let (rows, rejected) =
                promql_value_rows(vec![series(&[], &[(T_END, bad)])], &[], SLICE_SECS);
            assert!(rejected.is_empty(), "rejected here rather than at ingest");
            assert_eq!(rows.len(), 1, "the sample was silently dropped");
            assert!(
                !rows[0].good.is_finite(),
                "{bad} was laundered into {}",
                rows[0].good
            );

            let result = build_slices(
                &time_slice_sli(QueryLanguage::PromQl, Operator::LessThan),
                rows,
                &params(),
            );
            assert!(
                result.slices.is_empty(),
                "an unmeasurable slice was recorded as uptime"
            );
            assert_eq!(result.rejected.len(), 1);
        }
    }

    // ===================== one classifier, two sources =====================

    /// The core property of the feature: PromQL is a new *source*, not a new
    /// *semantics*. Both paths hand `build_slices` the same aggregate under
    /// `QueryRow::good`, so the identical definition must produce byte-equal
    /// slices — same seconds, same coverage, same rev. Any divergence means
    /// the language, not the objective, decides whether a slice is good.
    #[test]
    fn a_promql_row_classifies_exactly_as_a_sql_row_with_the_same_value() {
        let sql_sli = time_slice_sli(QueryLanguage::Sql, Operator::LessThan);
        let promql_sli = time_slice_sli(QueryLanguage::PromQl, Operator::LessThan);

        let sql_hit = json::json!({
            "slice_start": SLICE_START_TEXT,
            "zo_slo_value": 450.0,
        });
        let from_sql = build_slices(
            &sql_sli,
            single_query_rows(&[sql_hit], &[], &sql_sli),
            &params(),
        );

        let (prom_rows, rejected) =
            promql_value_rows(vec![series(&[], &[(T_END, 450.0)])], &[], SLICE_SECS);
        assert!(rejected.is_empty());
        let from_promql = build_slices(&promql_sli, prom_rows, &params());

        assert_eq!(from_sql.slices, from_promql.slices);
        assert_eq!(from_sql.slices.len(), 1);
        assert_eq!(
            (from_sql.slices[0].good, from_sql.slices[0].total),
            (0.0, 300.0),
            "450ms against `p95 < 300ms` is a fully bad — but measured — slice"
        );
    }

    /// The good branch of the same agreement. Both sources hand their value to
    /// one `classify_time_slice`, so this cannot disagree with the case above
    /// on the classification itself — what it pins is that the PromQL row
    /// reaches the classifier carrying the same NUMBER when that number is on
    /// the other side of the threshold.
    #[test]
    fn a_good_aggregate_also_agrees_across_the_two_sources() {
        let sql_sli = time_slice_sli(QueryLanguage::Sql, Operator::LessThan);
        let promql_sli = time_slice_sli(QueryLanguage::PromQl, Operator::LessThan);

        let sql_hit = json::json!({
            "slice_start": SLICE_START_TEXT,
            "zo_slo_value": 120.0,
        });
        let from_sql = build_slices(
            &sql_sli,
            single_query_rows(&[sql_hit], &[], &sql_sli),
            &params(),
        );
        let (prom_rows, _) =
            promql_value_rows(vec![series(&[], &[(T_END, 120.0)])], &[], SLICE_SECS);
        let from_promql = build_slices(&promql_sli, prom_rows, &params());

        assert_eq!(from_sql.slices, from_promql.slices);
        assert_eq!(
            (from_sql.slices[0].good, from_sql.slices[0].total),
            (300.0, 300.0)
        );
    }
}
