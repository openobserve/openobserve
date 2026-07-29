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

//! Turning query results into slices and status deltas (`alerts_2.md` §6b.4a).
//!
//! Everything here is pure. The search cluster, the stream writer and the
//! status table live in [`super::job`]; this is the arithmetic, so it can be
//! tested exhaustively without any of them.
//!
//! Two rules that the shape of the code depends on:
//!
//! * **Gap-fill is type-specific** (D48). An empty bucket is an observation of zero traffic for a
//!   count SLI, and an *absence of measurement* for a time-slice one. Treating them alike would
//!   either invent uptime or destroy it.
//! * **The rollup is exact, not a sum of groups** (S-9). A grouped SLO's overall row is computed
//!   from the same scan, because summing per-group ratios weights a 3-event group like a
//!   30,000-event one.

use config::meta::{
    alerts::Operator,
    slo::{
        SliConfig, SliType,
        slice::{GapFill, ObservationError, SliceRow, gap_fill_policy, validate_observation},
        window::align_down,
    },
};

/// A bucket the query returned that does not sit on the pass's grid.
///
/// Not an [`ObservationError`]: those are about a value being unusable, and
/// this is about the *histogram* disagreeing with `align_down`. That agreement
/// is a coincidence of `date_bin`'s 2001-01-01 origin, so if it ever stops
/// holding this must be loud rather than silently corrupting the window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OffGrid;

/// Why a returned row did not become a slice.
#[derive(Debug, Clone, PartialEq)]
pub enum RejectReason {
    OffGrid,
    Observation(ObservationError),
}

/// One row as the search returned it, already keyed.
#[derive(Debug, Clone, PartialEq)]
pub struct QueryRow {
    pub slice_start: i64,
    pub group_key: String,
    pub group_labels: String,
    /// Numerator for a count SLI; the aggregate value for a time-slice one.
    pub good: f64,
    /// Denominator for a count SLI; unused for time-slice.
    pub total: f64,
}

/// What a pass produced.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PassResult {
    pub slices: Vec<SliceRow>,
    /// Rows the ingest boundary refused, with why. Non-empty is a bug in the
    /// query or the data, not a normal outcome — it is surfaced rather than
    /// silently dropped.
    pub rejected: Vec<(String, RejectReason)>,
    /// Distinct groups seen this pass.
    pub groups_seen: usize,
    /// True when group cardinality hit the cap, so the caller can raise the
    /// reservation or trip `GroupOverflow` rather than silently truncating.
    pub group_overflow: bool,
}

/// Parameters a pass needs beyond its rows.
#[derive(Debug, Clone)]
pub struct PassParams {
    pub slo_id: String,
    pub definition_generation: i32,
    pub range_start: i64,
    pub range_end: i64,
    pub slice_interval_secs: i64,
    /// Monotonic within the generation. Higher wins on the same key.
    pub rev: i64,
    pub max_groups: i64,
}

/// Classify a time-slice aggregate into good/bad seconds.
///
/// Returns seconds, not a ratio: `good`/`total` are unified on **units** so
/// one evaluator serves all three SLI types. A good slice is
/// `(interval, interval)`; a bad one `(0, interval)`.
pub fn classify_time_slice(
    value: f64,
    comparator: Operator,
    threshold: f64,
    slice_interval_secs: i64,
) -> (f64, f64) {
    let interval = slice_interval_secs as f64;
    // Checked BEFORE the comparison, not after. NaN compares false against
    // every operator, so falling through would classify an unmeasurable
    // bucket as `!good` — recording an absence of measurement as real
    // downtime. Returning NaN sends it to the ingest boundary, which rejects
    // it, so the slice is simply missing and coverage falls.
    if !value.is_finite() {
        return (f64::NAN, f64::NAN);
    }
    let good = match comparator {
        Operator::GreaterThan => value > threshold,
        Operator::GreaterThanEquals => value >= threshold,
        Operator::LessThan => value < threshold,
        Operator::LessThanEquals => value <= threshold,
        // validate_slo rejects these at save time; treating an unexpected
        // comparator as "bad" would invent downtime, so treat it as
        // unmeasurable instead.
        _ => return (f64::NAN, f64::NAN),
    };
    if good {
        (interval, interval)
    } else {
        (0.0, interval)
    }
}

/// Build the pass's slices from the rows a search returned.
pub fn build_slices(sli: &SliConfig, rows: Vec<QueryRow>, params: &PassParams) -> PassResult {
    let mut out = PassResult::default();
    let mut groups: std::collections::BTreeSet<String> = Default::default();

    for row in rows {
        // A bucket outside the requested range means the histogram grid and
        // `align_down` disagreed — the coincidence the spike pins. Dropping
        // it silently would corrupt the window; it is rejected loudly.
        if row.slice_start < params.range_start || row.slice_start >= params.range_end {
            out.rejected
                .push((row.group_key.clone(), RejectReason::OffGrid));
            continue;
        }
        if row.slice_start != align_down(row.slice_start, params.slice_interval_secs) {
            out.rejected
                .push((row.group_key.clone(), RejectReason::OffGrid));
            continue;
        }

        let (good, total) = match sli {
            SliConfig::TimeSlice {
                comparator,
                threshold,
                ..
            } => classify_time_slice(
                row.good,
                *comparator,
                *threshold,
                params.slice_interval_secs,
            ),
            _ => (row.good, row.total),
        };

        if let Err(e) = validate_observation(good, total) {
            out.rejected
                .push((row.group_key.clone(), RejectReason::Observation(e)));
            continue;
        }

        if groups.len() as i64 >= params.max_groups && !groups.contains(&row.group_key) {
            out.group_overflow = true;
            continue;
        }
        groups.insert(row.group_key.clone());

        out.slices.push(SliceRow {
            slo_id: params.slo_id.clone(),
            definition_generation: params.definition_generation,
            group_key: row.group_key,
            slice_start: row.slice_start,
            good,
            total,
            rev: params.rev,
        });
    }

    out.groups_seen = groups.len();
    out
}

/// Fill buckets the query returned nothing for.
///
/// The policy is type-specific (D48) and this is where it bites:
///
/// * a **count** SLI's empty bucket is `(0, 0)` — zero traffic, which is neither uptime nor
///   downtime and contributes nothing to either;
/// * a **time-slice** SLI's empty bucket is *not measured at all*, so it produces no slice and
///   shows up as reduced coverage.
///
/// Writing `(0, interval)` for the time-slice case would be the tempting
/// shortcut and it invents downtime out of a search outage.
pub fn fill_missing(sli_type: SliType, present: &[SliceRow], params: &PassParams) -> Vec<SliceRow> {
    if gap_fill_policy(sli_type) != GapFill::CoveredZero {
        return Vec::new();
    }
    let mut by_group: std::collections::BTreeMap<&str, std::collections::BTreeSet<i64>> =
        Default::default();
    for s in present {
        by_group
            .entry(&s.group_key)
            .or_default()
            .insert(s.slice_start);
    }
    // An ungrouped SLO that returned nothing at all still has a series to
    // fill: the empty group key.
    if by_group.is_empty() {
        by_group.insert("", Default::default());
    }

    let mut out = Vec::new();
    for (group, seen) in by_group {
        let mut t = params.range_start;
        while t < params.range_end {
            if !seen.contains(&t) {
                out.push(SliceRow {
                    slo_id: params.slo_id.clone(),
                    definition_generation: params.definition_generation,
                    group_key: group.to_string(),
                    slice_start: t,
                    good: 0.0,
                    total: 0.0,
                    rev: params.rev,
                });
            }
            t += params.slice_interval_secs;
        }
    }
    out
}

/// The EXACT overall row for a grouped SLO (S-9).
///
/// Summed from raw good/total counts, never from per-group ratios: averaging
/// ratios weights a 3-event group the same as a 30,000-event one, which is how
/// a tiny group's bad minute can swamp the real number.
pub fn exact_rollup(slices: &[SliceRow], params: &PassParams) -> Vec<SliceRow> {
    let mut by_slice: std::collections::BTreeMap<i64, (f64, f64)> = Default::default();
    for s in slices {
        // Guard against a caller passing rollup rows back in.
        if s.group_key.is_empty() {
            continue;
        }
        let e = by_slice.entry(s.slice_start).or_insert((0.0, 0.0));
        e.0 += s.good;
        e.1 += s.total;
    }
    by_slice
        .into_iter()
        .map(|(slice_start, (good, total))| SliceRow {
            slo_id: params.slo_id.clone(),
            definition_generation: params.definition_generation,
            group_key: String::new(),
            slice_start,
            good,
            total,
            rev: params.rev,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use config::meta::slo::CountSource;

    use super::*;

    const SLO: &str = "slo1";

    fn params() -> PassParams {
        PassParams {
            slo_id: SLO.to_string(),
            definition_generation: 1,
            range_start: 0,
            range_end: 900,
            slice_interval_secs: 300,
            rev: 7,
            max_groups: 500,
        }
    }

    fn count_sli() -> SliConfig {
        SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "s".into(),
                stream_type: "logs".into(),
                scope: None,
                good_expr: "ok".into(),
            },
        }
    }

    fn time_slice_sli(comparator: Operator, threshold: f64) -> SliConfig {
        SliConfig::TimeSlice {
            stream: "s".into(),
            stream_type: "logs".into(),
            query_language: config::meta::slo::QueryLanguage::Sql,
            query: "p95(d)".into(),
            scope: None,
            comparator,
            threshold,
        }
    }

    fn row(slice_start: i64, group: &str, good: f64, total: f64) -> QueryRow {
        QueryRow {
            slice_start,
            group_key: group.to_string(),
            group_labels: String::new(),
            good,
            total,
        }
    }

    // ===================== count SLI ======================================

    #[test]
    fn a_count_row_becomes_a_slice_verbatim() {
        let r = build_slices(&count_sli(), vec![row(0, "", 98.0, 100.0)], &params());
        assert_eq!(r.slices.len(), 1);
        assert_eq!(r.slices[0].good, 98.0);
        assert_eq!(r.slices[0].total, 100.0);
        assert_eq!(r.slices[0].rev, 7);
        assert_eq!(r.slices[0].definition_generation, 1);
    }

    #[test]
    fn a_bucket_outside_the_requested_range_is_rejected() {
        // The histogram grid and align_down agreeing is a coincidence of the
        // date_bin origin. If it ever stops holding, this must be loud.
        for bad in [-300, 900, 1_200] {
            let r = build_slices(&count_sli(), vec![row(bad, "", 1.0, 1.0)], &params());
            assert!(r.slices.is_empty(), "accepted out-of-range {bad}");
            assert_eq!(r.rejected.len(), 1);
        }
    }

    #[test]
    fn an_unaligned_bucket_is_rejected() {
        let r = build_slices(&count_sli(), vec![row(150, "", 1.0, 1.0)], &params());
        assert!(r.slices.is_empty());
        assert_eq!(r.rejected.len(), 1);
    }

    #[test]
    fn a_non_finite_observation_is_rejected_not_stored() {
        for bad in [f64::NAN, f64::INFINITY] {
            let r = build_slices(&count_sli(), vec![row(0, "", bad, 100.0)], &params());
            assert!(r.slices.is_empty(), "stored {bad}");
            assert_eq!(r.rejected.len(), 1);
        }
    }

    // ===================== time-slice SLI =================================

    #[test]
    fn a_time_slice_under_threshold_is_a_full_good_slice() {
        let r = build_slices(
            &time_slice_sli(Operator::LessThan, 300.0),
            vec![row(0, "", 250.0, 0.0)],
            &params(),
        );
        assert_eq!(r.slices[0].good, 300.0, "seconds, not a ratio");
        assert_eq!(r.slices[0].total, 300.0);
    }

    #[test]
    fn a_time_slice_over_threshold_is_a_full_bad_slice() {
        let r = build_slices(
            &time_slice_sli(Operator::LessThan, 300.0),
            vec![row(0, "", 400.0, 0.0)],
            &params(),
        );
        assert_eq!(r.slices[0].good, 0.0);
        assert_eq!(
            r.slices[0].total, 300.0,
            "the slice still counts as measured"
        );
    }

    #[test]
    fn every_orderable_comparator_classifies_at_its_boundary() {
        for (op, value, expect_good) in [
            (Operator::LessThan, 300.0, false),
            (Operator::LessThanEquals, 300.0, true),
            (Operator::GreaterThan, 300.0, false),
            (Operator::GreaterThanEquals, 300.0, true),
        ] {
            let (good, total) = classify_time_slice(value, op, 300.0, 300);
            assert_eq!(total, 300.0);
            assert_eq!(good == 300.0, expect_good, "{op:?} at its boundary");
        }
    }

    /// NaN compares false against everything, so a naive implementation would
    /// classify an unmeasurable bucket as BAD — inventing downtime out of an
    /// absence of measurement.
    #[test]
    fn a_nan_aggregate_is_unmeasurable_not_bad() {
        let r = build_slices(
            &time_slice_sli(Operator::LessThan, 300.0),
            vec![row(0, "", f64::NAN, 0.0)],
            &params(),
        );
        assert!(
            r.slices.is_empty(),
            "an unmeasurable bucket was recorded as downtime"
        );
        assert_eq!(r.rejected.len(), 1);
    }

    // ===================== gap fill (D48) =================================

    /// For a count SLI an empty bucket is real information: zero traffic. It
    /// is neither uptime nor downtime, so it contributes nothing to either.
    #[test]
    fn a_count_slis_empty_bucket_is_zero_traffic() {
        let present = vec![SliceRow {
            slo_id: SLO.into(),
            definition_generation: 1,
            group_key: String::new(),
            slice_start: 0,
            good: 5.0,
            total: 5.0,
            rev: 7,
        }];
        let filled = fill_missing(SliType::Count, &present, &params());
        assert_eq!(filled.len(), 2, "buckets 300 and 600");
        for f in &filled {
            assert_eq!((f.good, f.total), (0.0, 0.0));
        }
    }

    /// A time-slice SLI's empty bucket was not measured at all. Writing
    /// `(0, interval)` would be the tempting shortcut and it invents downtime
    /// out of a search outage.
    #[test]
    fn a_time_slice_slis_empty_bucket_produces_no_slice() {
        assert!(
            fill_missing(SliType::TimeSlice, &[], &params()).is_empty(),
            "gap-filling a time-slice SLI invented measurements"
        );
    }

    #[test]
    fn an_ungrouped_count_slo_with_no_rows_still_fills_its_series() {
        let filled = fill_missing(SliType::Count, &[], &params());
        assert_eq!(filled.len(), 3);
        assert!(filled.iter().all(|f| f.group_key.is_empty()));
    }

    #[test]
    fn gap_fill_is_per_group() {
        let present = vec![
            SliceRow {
                slo_id: SLO.into(),
                definition_generation: 1,
                group_key: "region=eu".into(),
                slice_start: 0,
                good: 1.0,
                total: 1.0,
                rev: 7,
            },
            SliceRow {
                slo_id: SLO.into(),
                definition_generation: 1,
                group_key: "region=us".into(),
                slice_start: 300,
                good: 1.0,
                total: 1.0,
                rev: 7,
            },
        ];
        let filled = fill_missing(SliType::Count, &present, &params());
        assert_eq!(filled.len(), 4, "2 groups x 3 buckets - 2 present");
    }

    // ===================== the exact rollup (S-9) =========================

    /// Averaging per-group ratios weights a 3-event group like a
    /// 30,000-event one. The rollup sums raw counts instead.
    #[test]
    fn the_rollup_sums_raw_counts_not_ratios() {
        let slices = vec![
            SliceRow {
                slo_id: SLO.into(),
                definition_generation: 1,
                group_key: "region=eu".into(),
                slice_start: 0,
                good: 30_000.0,
                total: 30_000.0,
                rev: 7,
            },
            SliceRow {
                slo_id: SLO.into(),
                definition_generation: 1,
                group_key: "region=us".into(),
                slice_start: 0,
                good: 0.0,
                total: 3.0,
                rev: 7,
            },
        ];
        let rollup = exact_rollup(&slices, &params());
        assert_eq!(rollup.len(), 1);
        assert_eq!(rollup[0].good, 30_000.0);
        assert_eq!(rollup[0].total, 30_003.0);
        assert!(rollup[0].group_key.is_empty());

        // The ratio-averaging answer would be 50%. The exact answer is 99.99%.
        let exact = rollup[0].good / rollup[0].total;
        assert!(exact > 0.999, "got {exact}, the ratio average would be 0.5");
    }

    #[test]
    fn the_rollup_is_per_slice() {
        let mk = |slice_start, good, total| SliceRow {
            slo_id: SLO.into(),
            definition_generation: 1,
            group_key: "region=eu".into(),
            slice_start,
            good,
            total,
            rev: 7,
        };
        let rollup = exact_rollup(&[mk(0, 1.0, 2.0), mk(300, 3.0, 4.0)], &params());
        assert_eq!(rollup.len(), 2);
        assert_eq!((rollup[0].good, rollup[0].total), (1.0, 2.0));
        assert_eq!((rollup[1].good, rollup[1].total), (3.0, 4.0));
    }

    /// Feeding rollup rows back in would double-count them.
    #[test]
    fn existing_rollup_rows_are_not_counted_again() {
        let mk = |group: &str, good, total| SliceRow {
            slo_id: SLO.into(),
            definition_generation: 1,
            group_key: group.to_string(),
            slice_start: 0,
            good,
            total,
            rev: 7,
        };
        let rollup = exact_rollup(&[mk("region=eu", 1.0, 2.0), mk("", 1.0, 2.0)], &params());
        assert_eq!((rollup[0].good, rollup[0].total), (1.0, 2.0));
    }

    // ===================== group cap ======================================

    #[test]
    fn group_cardinality_past_the_cap_trips_overflow_rather_than_truncating_silently() {
        let mut p = params();
        p.max_groups = 2;
        let rows = vec![
            row(0, "a", 1.0, 1.0),
            row(0, "b", 1.0, 1.0),
            row(0, "c", 1.0, 1.0),
        ];
        let r = build_slices(&count_sli(), rows, &p);
        assert!(r.group_overflow, "overflow was not signalled");
        assert_eq!(r.groups_seen, 2);
        assert_eq!(r.slices.len(), 2);
    }

    #[test]
    fn a_group_already_seen_still_writes_its_later_slices_at_the_cap() {
        let mut p = params();
        p.max_groups = 1;
        let rows = vec![row(0, "a", 1.0, 1.0), row(300, "a", 2.0, 2.0)];
        let r = build_slices(&count_sli(), rows, &p);
        assert!(!r.group_overflow);
        assert_eq!(r.slices.len(), 2, "the cap is on groups, not on slices");
    }
}
