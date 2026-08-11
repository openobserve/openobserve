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

//! Availability-ledger intervals → slices, for an `alert` SLI (S-16).
//!
//! Pure, like the rest of this module: the ledger read lives in
//! `infra::table::alert_eval_intervals` and the pass lives in `core::slo::job`,
//! so the arithmetic that decides whether an alert-based SLO is measured can be
//! tested exhaustively without a database.

use std::collections::BTreeMap;

use crate::meta::alerts::level::AlertLevel;

/// One ledger interval, in the shape this module needs.
///
/// Deliberately not `infra`'s row type: this crate has no dependency on the
/// storage layer, and the reader needs only four of its columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EvalInterval {
    /// `None` when the stored integer is one this build cannot interpret.
    /// Treated as **unmeasured** — an interval whose level is unknown cannot
    /// say whether the time was good.
    pub level: Option<AlertLevel>,
    /// The cadence in effect for THIS interval (§5.3), which is how far it
    /// covers forward.
    pub frequency_secs: i64,
    pub from_us: i64,
    pub to_us: i64,
}

/// The aligned slice grid a pass measures over, plus the floor a slice must
/// clear to count as observed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UptimeGrid {
    /// Inclusive, aligned — the pass's `IngestRange::start`.
    pub range_start_secs: i64,
    /// **Exclusive**, aligned — the pass's `IngestRange::end`.
    pub range_end_secs: i64,
    pub slice_interval_secs: i64,
    /// `ZO_SLO_MIN_COVERAGE`. A slice measured for less than this fraction of
    /// its width emits no row at all (§5.5).
    pub min_coverage: f64,
}

/// One emitted slice: the `(slice_start, good_secs, total_secs)` triple.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UptimeSlice {
    pub slice_start: i64,
    /// Seconds within the slice that were measured AND `Ok`.
    pub good_secs: f64,
    /// Seconds within the slice that were measured.
    pub total_secs: f64,
}

/// Fold the ledger onto the slice grid.
///
/// Three states per slice, never two (§2): **good** is a measured `Ok`, **bad**
/// is a measured `Warning`/`Critical`, and everything else is **unmeasured** —
/// which contributes to neither numerator nor denominator, so a paused alert
/// lowers coverage instead of reading as a good month (D34).
///
/// Each interval covers `[from_us, to_us + frequency_secs)` — an evaluation is
/// an assessment that stands until the next one is due (§5.3) — under two
/// mandatory clamps:
///
/// 1. never past the pass's range end, or the newest slice reads covered before it was measured;
/// 2. never past the next interval's `from_us`, or a pause shorter than one cadence is erased —
///    which also, as a consequence rather than a third rule, stops a closed interval's tail
///    outliving the level change that closed it.
///
/// Clamp 2 is what makes overlapping or duplicated rows harmless: a run is
/// truncated where its successor begins, so no microsecond is ever counted
/// twice.
///
/// A slice with no measured seconds at all emits **no row** — that is what
/// makes it a gap rather than a zero (§2), and `GapFill::Nothing` is what
/// keeps it one. Finally §5.5 extends the same rule to thin slices: one
/// measured for less than `min_coverage` of its width emits no row either. Counting a
/// 60-seconds-of-300 slice as fully observed would let an alert cycling run-1min/pause-4min report
/// coverage 1.0 on 20% real measurement, bypassing freeze protection entirely. The
/// discarded boundary seconds are the price, and the direction is safe —
/// discarding lowers coverage and freezes earlier, never later.
///
/// Slices are returned ascending by `slice_start`, on the caller's grid.
pub fn uptime_slices(intervals: &[EvalInterval], grid: UptimeGrid) -> Vec<UptimeSlice> {
    let interval_us = grid.slice_interval_secs.saturating_mul(MICROS);
    let range_start_us = grid.range_start_secs.saturating_mul(MICROS);
    let range_end_us = grid.range_end_secs.saturating_mul(MICROS);
    if interval_us <= 0 || range_end_us <= range_start_us {
        return Vec::new();
    }

    // Sorted rather than trusted: `list_overlapping` returns oldest-first, but
    // clamp 2 reads the *successor*, so the answer would otherwise depend on
    // the read's ordering.
    let mut sorted: Vec<&EvalInterval> = intervals.iter().collect();
    sorted.sort_by_key(|i| (i.from_us, i.to_us));

    // Microseconds, not seconds, and integers, not floats: a slice's seconds
    // are a sum of many spans, and accumulating those in `f64` would make the
    // §5.5 comparison depend on how the spans happened to be split.
    let mut measured: BTreeMap<i64, (i64, i64)> = BTreeMap::new();

    for (idx, iv) in sorted.iter().enumerate() {
        let Some(is_good) = classify(iv.level) else {
            // Unmeasured. It still bounds its predecessor below — an interval
            // exists at that instant, so the previous run had ended.
            continue;
        };

        // §5.3: an evaluation is an assessment that stands until the next one
        // is due. A non-positive cadence makes that window zero-width, which
        // is why §5.1 refuses such a source at save.
        let extension = iv.frequency_secs.max(0).saturating_mul(MICROS);
        let mut end_us = iv.to_us.saturating_add(extension);
        // Clamp 1: never past the pass's range end.
        end_us = end_us.min(range_end_us);
        // Clamp 2: never past the next interval's start.
        if let Some(next) = sorted.get(idx + 1) {
            end_us = end_us.min(next.from_us);
        }

        let start_us = iv.from_us.max(range_start_us);
        if end_us <= start_us {
            continue;
        }

        let mut cursor = start_us;
        while cursor < end_us {
            let slice_start_us = cursor.div_euclid(interval_us) * interval_us;
            // Saturating like every other bound here: a corrupt row near
            // `i64::MAX` would otherwise wrap the slice end negative, and the
            // walk would step backwards instead of terminating.
            let segment_end = end_us.min(slice_start_us.saturating_add(interval_us));
            let entry = measured.entry(slice_start_us).or_insert((0, 0));
            entry.1 += segment_end - cursor;
            if is_good {
                entry.0 += segment_end - cursor;
            }
            cursor = segment_end;
        }
    }

    measured
        .into_iter()
        .filter(|(_, (_, total_us))| {
            // A slice with no measured time at all is a gap, not a zero (§2),
            // and §5.5 extends that to thin ones: judged by the same standard
            // the window is, as a fraction rather than a product, so a slice
            // exactly at the floor is observed.
            *total_us > 0 && (*total_us as f64 / interval_us as f64) >= grid.min_coverage
        })
        .map(|(slice_start_us, (good_us, total_us))| UptimeSlice {
            slice_start: slice_start_us / MICROS,
            // Defensive: `good` only ever accrues where `total` does, so this
            // cannot bite — but a row with `good > total` is refused at the
            // ingest boundary, turning an arithmetic slip into a coverage hole
            // rather than a loud failure.
            good_secs: good_us.min(total_us) as f64 / MICROS as f64,
            total_secs: total_us as f64 / MICROS as f64,
        })
        .collect()
}

const MICROS: i64 = 1_000_000;

/// `Some(true)` = measured and good, `Some(false)` = measured and bad,
/// `None` = not measured at all.
fn classify(level: Option<AlertLevel>) -> Option<bool> {
    match level {
        // §5.2: good = `Ok`, and nothing else. A warn-level match burns budget.
        Some(AlertLevel::Ok) => Some(true),
        Some(AlertLevel::Warning) | Some(AlertLevel::Critical) => Some(false),
        // §5.2: `NoData` means "the alert could not tell", which under D34 is a
        // gap rather than downtime — counting it bad would invent downtime.
        // No producer today; decided now so shipping one cannot silently
        // change the meaning of stored SLOs.
        Some(AlertLevel::NoData) => None,
        // A stored level this build cannot interpret. It must not read as
        // `Ok`, which would turn unknown time into uptime.
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEC: i64 = 1_000_000;
    /// 5-minute slices, the coarse grid, so partial slices are easy to state.
    const SLICE: i64 = 300;

    fn interval(
        level: Option<AlertLevel>,
        from_secs: i64,
        to_secs: i64,
        freq: i64,
    ) -> EvalInterval {
        EvalInterval {
            level,
            frequency_secs: freq,
            from_us: from_secs * SEC,
            to_us: to_secs * SEC,
        }
    }

    fn ok(from_secs: i64, to_secs: i64, freq: i64) -> EvalInterval {
        interval(Some(AlertLevel::Ok), from_secs, to_secs, freq)
    }

    fn critical(from_secs: i64, to_secs: i64, freq: i64) -> EvalInterval {
        interval(Some(AlertLevel::Critical), from_secs, to_secs, freq)
    }

    /// A grid with the coverage floor switched off, so a test about the
    /// interval arithmetic is not also a test of §5.5's threshold.
    fn grid(start_secs: i64, end_secs: i64) -> UptimeGrid {
        UptimeGrid {
            range_start_secs: start_secs,
            range_end_secs: end_secs,
            slice_interval_secs: SLICE,
            min_coverage: 0.0,
        }
    }

    /// `(slice_start, good, total)` triples, which is what the doc specifies
    /// and what the caller turns into rows.
    fn triples(slices: &[UptimeSlice]) -> Vec<(i64, f64, f64)> {
        slices
            .iter()
            .map(|s| (s.slice_start, s.good_secs, s.total_secs))
            .collect()
    }

    // ── the basic shape ─────────────────────────────────────────────────────

    #[test]
    fn no_intervals_produce_no_slices() {
        assert!(uptime_slices(&[], grid(0, 900)).is_empty());
    }

    /// A whole slice measured `Ok` is `(interval, interval)`, matching the
    /// time-slice arm's convention for a good slice (§2 units).
    #[test]
    fn a_fully_measured_ok_slice_is_good_for_its_whole_width() {
        // Evaluations every 60s from 0 through 240; the last one covers to 300.
        let out = uptime_slices(&[ok(0, 240, 60)], grid(0, 300));
        assert_eq!(triples(&out), vec![(0, 300.0, 300.0)]);
    }

    /// Bad time is *measured* time: it belongs in the denominator, or downtime
    /// would silently read as a gap and the SLI would never fall.
    #[test]
    fn a_fully_measured_critical_slice_is_measured_but_not_good() {
        let out = uptime_slices(&[critical(0, 240, 60)], grid(0, 300));
        assert_eq!(triples(&out), vec![(0, 0.0, 300.0)]);
    }

    #[test]
    fn good_and_bad_within_one_slice_split_the_seconds() {
        // Ok for [0, 120), Critical for [120, 300).
        let out = uptime_slices(&[ok(0, 60, 60), critical(120, 240, 60)], grid(0, 300));
        assert_eq!(triples(&out), vec![(0, 120.0, 300.0)]);
    }

    #[test]
    fn one_interval_spanning_several_slices_is_split_onto_the_grid() {
        let out = uptime_slices(&[ok(0, 840, 60)], grid(0, 900));
        assert_eq!(
            triples(&out),
            vec![(0, 300.0, 300.0), (300, 300.0, 300.0), (600, 300.0, 300.0)]
        );
    }

    /// The ledger arrives oldest-first, but nothing downstream re-sorts, and
    /// the grid walk is what puts the rows in order — so hand it interleaved
    /// input rather than input that is already sorted.
    #[test]
    fn slices_come_back_ascending_whatever_order_the_ledger_arrives_in() {
        let out = uptime_slices(
            &[ok(600, 840, 60), ok(0, 240, 60), ok(300, 540, 60)],
            grid(0, 900),
        );
        let starts: Vec<i64> = out.iter().map(|s| s.slice_start).collect();
        assert_eq!(starts, vec![0, 300, 600]);
    }

    // ── §5.3 forward extension, and its two clamps ──────────────────────────

    /// The extension itself: six evaluations at 10:00..10:05 prove six
    /// instants, but the alert had assessed the whole span — and one period
    /// beyond, until the next run was due.
    #[test]
    fn an_evaluation_covers_forward_to_the_next_expected_one() {
        // A single evaluation at t=0 with a 60s cadence covers [0, 60).
        let out = uptime_slices(&[ok(0, 0, 60)], grid(0, 300));
        assert_eq!(triples(&out), vec![(0, 60.0, 60.0)]);
    }

    /// **Clamp 1.** The trailing `+ frequency_secs` must not claim time that
    /// has not happened yet, or the newest slice reads covered before it was
    /// measured.
    #[test]
    fn the_forward_extension_never_reaches_past_the_range_end() {
        // to_us = 550s with a 300s cadence would reach 850s; the range ends at
        // 600s.
        let out = uptime_slices(&[ok(0, 550, 300)], grid(0, 600));
        assert_eq!(
            triples(&out),
            vec![(0, 300.0, 300.0), (300, 300.0, 300.0)],
            "the tail must stop at the range end, not run 250s past it"
        );
        let measured: f64 = out.iter().map(|s| s.total_secs).sum();
        assert_eq!(measured, 600.0);
    }

    /// **Clamp 2.** Otherwise a pause shorter than one cadence is erased — the
    /// very gap the ledger exists to record — and the two intervals' coverage
    /// overlaps.
    #[test]
    fn the_forward_extension_never_reaches_past_the_next_intervals_start() {
        // A run ends at 0 with a 300s cadence (tail would reach 300s); the next
        // run starts at 60s, so 240s of the tail is not real.
        let out = uptime_slices(&[ok(0, 0, 300), ok(60, 60, 300)], grid(0, 900));
        assert_eq!(
            triples(&out),
            vec![(0, 300.0, 300.0), (300, 60.0, 60.0)],
            "coverage is [0,60) + [60,360), not [0,300) + [60,360)"
        );
    }

    /// A consequence of clamp 2, not a third clamp: a level change closes the
    /// interval and opens the next at the transition instant, so the old
    /// level's tail cannot outlive it.
    #[test]
    fn a_level_change_truncates_the_previous_intervals_tail() {
        let out = uptime_slices(&[ok(0, 0, 300), critical(100, 100, 300)], grid(0, 600));
        assert_eq!(
            triples(&out),
            vec![(0, 100.0, 300.0), (300, 0.0, 100.0)],
            "only [0,100) may count as good; the Critical run owns [100,400)"
        );
    }

    /// The clamp is against the next *interval*, whatever it records. An
    /// unmeasured run still proves the previous one had ended.
    #[test]
    fn an_unmeasured_next_interval_still_truncates_the_tail() {
        let out = uptime_slices(
            &[
                ok(0, 0, 300),
                interval(Some(AlertLevel::NoData), 100, 100, 300),
            ],
            grid(0, 600),
        );
        assert_eq!(triples(&out), vec![(0, 100.0, 100.0)]);
    }

    /// The reason `list_overlapping` over-fetches one row backwards: an
    /// interval that ended before the range still covers into its first slice.
    #[test]
    fn an_interval_that_ended_before_the_range_still_covers_into_it() {
        // Ends at 290s with a 60s cadence, so it covers to 350s.
        let out = uptime_slices(&[ok(0, 290, 60)], grid(300, 600));
        assert_eq!(triples(&out), vec![(300, 50.0, 50.0)]);
    }

    /// An interval that spans the range start is clipped, not dropped — the
    /// pass must not credit itself with coverage from before its own range.
    #[test]
    fn an_interval_spanning_the_range_start_is_clipped_to_it() {
        // Covers [0, 900); the pass only looks at [300, 600).
        let out = uptime_slices(&[ok(0, 840, 60)], grid(300, 600));
        assert_eq!(triples(&out), vec![(300, 300.0, 300.0)]);
    }

    /// §2 Units: "a slice with `total == 0` emits no row at all — that is what
    /// makes it a gap rather than a zero". Interior pause slices are the case
    /// that produces it, and this holds at any floor, including none.
    #[test]
    fn an_interior_pause_leaves_a_hole_in_the_grid() {
        let out = uptime_slices(&[ok(0, 240, 60), ok(600, 840, 60)], grid(0, 900));
        assert_eq!(
            triples(&out),
            vec![(0, 300.0, 300.0), (600, 300.0, 300.0)],
            "the paused slice must be absent, not (0, 300)"
        );
    }

    /// Every emitted slice must sit inside the pass's range, or `build_slices`
    /// rejects it as off-grid and the measurement is lost loudly.
    #[test]
    fn no_slice_falls_outside_the_passs_range() {
        let out = uptime_slices(&[ok(0, 1_200, 60)], grid(300, 900));
        assert!(
            out.iter()
                .all(|s| s.slice_start >= 300 && s.slice_start < 900),
            "{out:?}"
        );
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn an_interval_whose_tail_stops_short_of_the_range_contributes_nothing() {
        // Covers to 160s; the range starts at 300s.
        assert!(uptime_slices(&[ok(0, 100, 60)], grid(300, 600)).is_empty());
    }

    #[test]
    fn an_interval_starting_after_the_range_contributes_nothing() {
        assert!(uptime_slices(&[ok(900, 960, 60)], grid(0, 600)).is_empty());
    }

    // ── level classification (§5.2) ─────────────────────────────────────────

    /// `NoData` means "the alert could not tell", which under D34 is a gap, not
    /// downtime. Counting it bad would invent downtime — the mirror image of
    /// the failure this feature exists to prevent. Pinned even though the
    /// variant has no producer today.
    #[test]
    fn a_no_data_interval_is_unmeasured_not_downtime() {
        let out = uptime_slices(
            &[interval(Some(AlertLevel::NoData), 0, 240, 60)],
            grid(0, 300),
        );
        assert!(
            out.is_empty(),
            "NoData must produce no row at all, not (0, 300)"
        );
    }

    /// A level integer this build cannot interpret must not read as `Ok`, and
    /// must not read as downtime either.
    #[test]
    fn an_uninterpretable_level_is_unmeasured() {
        let out = uptime_slices(&[interval(None, 0, 240, 60)], grid(0, 300));
        assert!(out.is_empty());
    }

    #[test]
    fn a_warning_interval_is_measured_but_not_good() {
        let out = uptime_slices(
            &[interval(Some(AlertLevel::Warning), 0, 240, 60)],
            grid(0, 300),
        );
        assert_eq!(triples(&out), vec![(0, 0.0, 300.0)]);
    }

    // ── degenerate and adversarial ledger rows ──────────────────────────────

    /// An interval opens as a single instant, not a span (PR 1's write path),
    /// so this is the commonest row in the table.
    #[test]
    fn a_zero_length_interval_covers_exactly_one_cadence() {
        let out = uptime_slices(&[ok(120, 120, 60)], grid(0, 300));
        assert_eq!(triples(&out), vec![(0, 60.0, 60.0)]);
    }

    /// §5.1 rejects a non-positive cadence at save precisely because the
    /// forward extension is then zero-width and coverage never accrues. A row
    /// that predates that check must read as a gap, never as an error or as
    /// uptime.
    #[test]
    fn a_non_positive_cadence_accrues_no_coverage() {
        for freq in [0, -60] {
            let out = uptime_slices(&[ok(120, 120, freq)], grid(0, 300));
            assert!(out.is_empty(), "cadence {freq} accrued coverage");
        }
    }

    #[test]
    fn duplicate_intervals_are_not_counted_twice() {
        let single = uptime_slices(&[ok(0, 240, 60)], grid(0, 300));
        let doubled = uptime_slices(&[ok(0, 240, 60), ok(0, 240, 60)], grid(0, 300));
        assert_eq!(triples(&doubled), triples(&single));
        assert_eq!(triples(&doubled), vec![(0, 300.0, 300.0)]);
    }

    /// Overlapping rows cannot be produced by PR 1's write path, but a range
    /// read that double-counted them would report more measured seconds than
    /// the slice is wide — and `validate_observation` would then reject the
    /// row, turning a data oddity into a coverage hole.
    #[test]
    fn overlapping_intervals_are_not_counted_twice() {
        let out = uptime_slices(&[ok(0, 100, 60), ok(50, 150, 60)], grid(0, 300));
        // [0,50) from the first, [50,210) from the second.
        assert_eq!(triples(&out), vec![(0, 210.0, 210.0)]);
    }

    /// Overlap across a level change is the only shape in which a naive
    /// per-interval sum makes `good` exceed `total` — the numerator comes from
    /// the run that clamp 2 truncated, the denominator from both.
    #[test]
    fn overlapping_intervals_at_different_levels_do_not_inflate_good() {
        let out = uptime_slices(&[ok(0, 100, 60), critical(50, 150, 60)], grid(0, 300));
        // Ok truncated to [0,50); Critical covers [50, 150+60).
        assert_eq!(triples(&out), vec![(0, 50.0, 210.0)]);
    }

    #[test]
    fn measured_seconds_never_exceed_the_slice_width() {
        let out = uptime_slices(
            &[ok(0, 240, 60), ok(0, 240, 60), ok(30, 260, 300)],
            grid(0, 300),
        );
        // Duplicates clamp to [0,0) and [0,30); the 300s-cadence run covers
        // [30, 560) and clamp 1 cuts it at the range end.
        assert_eq!(triples(&out), vec![(0, 300.0, 300.0)]);
        for s in &out {
            assert!(
                s.total_secs <= SLICE as f64,
                "{s:?} claims more than {SLICE}s of a {SLICE}s slice"
            );
            assert!(s.good_secs <= s.total_secs, "{s:?} has good > total");
        }
    }

    /// §5.3 puts the cadence on the row so a cadence edit cannot retroactively
    /// rewrite history. A reader that took one cadence for the whole batch
    /// would pass every other test in this module.
    #[test]
    fn each_interval_extends_by_its_own_cadence() {
        let out = uptime_slices(&[ok(0, 0, 60), ok(120, 120, 300)], grid(0, 600));
        assert_eq!(
            triples(&out),
            vec![(0, 240.0, 240.0), (300, 120.0, 120.0)],
            "the 60s run covers [0,60) and the 300s run [120,420)"
        );
    }

    /// The rows arrive oldest-first from `list_overlapping`, but the clamps are
    /// order-dependent, so the answer must not be.
    #[test]
    fn the_result_does_not_depend_on_the_input_order() {
        let expected = vec![(0, 100.0, 300.0), (300, 0.0, 100.0)];
        let ordered = [ok(0, 0, 300), critical(100, 100, 300)];
        let reversed = [critical(100, 100, 300), ok(0, 0, 300)];
        assert_eq!(triples(&uptime_slices(&ordered, grid(0, 600))), expected);
        assert_eq!(triples(&uptime_slices(&reversed, grid(0, 600))), expected);
    }

    // ── §5.5 the partial-slice threshold ────────────────────────────────────

    fn floored_grid(start_secs: i64, end_secs: i64) -> UptimeGrid {
        UptimeGrid {
            min_coverage: 0.9,
            ..grid(start_secs, end_secs)
        }
    }

    /// At the threshold the row is emitted with its true partial seconds, so
    /// the SLI stays exact over measured time. 270s is exactly 0.9 x 300s.
    #[test]
    fn a_slice_exactly_at_the_coverage_floor_is_emitted_with_its_partial_seconds() {
        // [0, 270): evaluations 0..210 at a 60s cadence.
        let out = uptime_slices(&[ok(0, 210, 60)], floored_grid(0, 300));
        assert_eq!(
            triples(&out),
            vec![(0, 270.0, 270.0)],
            "at the floor the slice is observed, and its partial seconds are exact"
        );
    }

    /// One microsecond below, and the slice is a gap — no row, not a zero.
    #[test]
    fn a_slice_one_microsecond_below_the_coverage_floor_emits_nothing() {
        let just_under = EvalInterval {
            level: Some(AlertLevel::Ok),
            frequency_secs: 60,
            from_us: 0,
            to_us: 210 * SEC - 1,
        };
        let out = uptime_slices(&[just_under], floored_grid(0, 300));
        assert!(
            out.is_empty(),
            "269.999999s of a 300s slice is thin measurement, which is a gap (D48)"
        );
    }

    /// A below-threshold slice must not become a zero row either — that would
    /// be measured-and-fully-bad, i.e. invented downtime. Stated against a
    /// pass that DID emit something, so the assertion is not vacuous.
    #[test]
    fn a_below_threshold_slice_is_absent_rather_than_zeroed() {
        // [0, 300) fully covered; [600, 640) only.
        let out = uptime_slices(&[ok(0, 240, 60), ok(600, 600, 40)], floored_grid(0, 900));
        assert_eq!(
            triples(&out),
            vec![(0, 300.0, 300.0)],
            "the thin slice must vanish, and only it"
        );
        assert!(
            !out.iter().any(|s| s.slice_start == 600),
            "a gap is an absent row, never a (0, 0) one"
        );
    }

    /// The floor is a fraction of the slice, so the fine grid has its own
    /// boundary: 54s is exactly 0.9 x 60s.
    #[test]
    fn the_floor_scales_with_the_slice_width() {
        let g = UptimeGrid {
            slice_interval_secs: 60,
            min_coverage: 0.9,
            ..grid(0, 60)
        };
        // 54s of a 60s slice is exactly at the floor.
        assert_eq!(
            triples(&uptime_slices(&[ok(0, 0, 54)], g)),
            vec![(0, 54.0, 54.0)]
        );
        // One second under it, and the same shape is a gap.
        assert!(uptime_slices(&[ok(0, 0, 53)], g).is_empty());
    }

    /// The adversarial case §5.5 exists for: an alert cycling
    /// run-1min/pause-4min, aligned to the grid, would otherwise report
    /// coverage 1.0 on 20% real measurement and bypass freeze protection
    /// entirely. It must emit **zero rows per pass**, so the pass never
    /// reaches `commit_status` and the SLO freezes on `StaleWatermark`.
    #[test]
    fn a_cycling_pause_emits_no_slices_at_all() {
        let cycling: Vec<EvalInterval> = (0..6).map(|i| ok(i * 300, i * 300, 60)).collect();
        let out = uptime_slices(&cycling, floored_grid(0, 1_800));
        assert!(
            out.is_empty(),
            "20% measurement must not read as a fully covered window: {out:?}"
        );
    }

    /// The floor is read from the grid, not hardcoded — and the same source
    /// under a zero floor emits one thin row per slice, which is exactly the
    /// coverage-1.0-on-20%-measurement bypass the floor exists to close.
    #[test]
    fn without_the_floor_the_cycling_pause_would_look_fully_covered() {
        let cycling: Vec<EvalInterval> = (0..6).map(|i| ok(i * 300, i * 300, 60)).collect();
        let out = uptime_slices(&cycling, grid(0, 1_800));
        assert_eq!(
            out.len(),
            6,
            "one thin row per slice — coverage would be 1.0"
        );
        assert!(out.iter().all(|s| s.total_secs == 60.0));
    }

    #[test]
    fn a_floor_of_one_admits_only_fully_measured_slices() {
        let g = UptimeGrid {
            min_coverage: 1.0,
            ..grid(0, 600)
        };
        // [0, 300) complete; [300, 599) one second short.
        let out = uptime_slices(&[ok(0, 539, 60)], g);
        assert_eq!(triples(&out), vec![(0, 300.0, 300.0)]);
    }

    /// The floor is applied to `total_secs`, not to `good_secs`: a fully
    /// measured but fully bad slice is observed, and must stay observed.
    #[test]
    fn a_fully_measured_bad_slice_clears_the_floor() {
        let out = uptime_slices(&[critical(0, 240, 60)], floored_grid(0, 300));
        assert_eq!(triples(&out), vec![(0, 0.0, 300.0)]);
    }

    // ── grid edge cases ─────────────────────────────────────────────────────

    #[test]
    fn an_empty_range_produces_no_slices() {
        assert_eq!(
            uptime_slices(&[ok(0, 240, 60)], grid(300, 300)),
            Vec::new(),
            "an empty range has no slices to fill"
        );
    }

    #[test]
    fn a_non_positive_slice_interval_produces_no_slices() {
        for interval_secs in [0, -60] {
            let g = UptimeGrid {
                slice_interval_secs: interval_secs,
                ..grid(0, 600)
            };
            assert!(uptime_slices(&[ok(0, 240, 60)], g).is_empty());
        }
    }

    /// The fine grid, since 60s slices make every cadence a boundary case.
    #[test]
    fn one_minute_slices_are_supported() {
        let g = UptimeGrid {
            slice_interval_secs: 60,
            ..grid(0, 180)
        };
        let out = uptime_slices(&[ok(0, 120, 60)], g);
        assert_eq!(
            triples(&out),
            vec![(0, 60.0, 60.0), (60, 60.0, 60.0), (120, 60.0, 60.0)]
        );
    }

    /// Real ledger timestamps are ~1.75e15 microseconds, and the forward
    /// extension adds to them. Nothing may overflow or lose precision there.
    #[test]
    fn realistic_epoch_timestamps_are_handled_exactly() {
        let base = 1_750_000_000i64; // a realistic wall-clock second
        let start = base - base % SLICE;
        let out = uptime_slices(&[ok(start, start + 240, 60)], grid(start, start + 300));
        assert_eq!(triples(&out), vec![(start, 300.0, 300.0)]);
    }

    #[test]
    fn an_absurd_cadence_cannot_overflow_the_forward_extension() {
        let huge = EvalInterval {
            level: Some(AlertLevel::Ok),
            frequency_secs: i64::MAX / 1_000,
            from_us: 0,
            to_us: 0,
        };
        // Clamp 1 still applies, so the answer is the whole range.
        let out = uptime_slices(&[huge], grid(0, 600));
        assert_eq!(triples(&out), vec![(0, 300.0, 300.0), (300, 300.0, 300.0)]);
    }
}
