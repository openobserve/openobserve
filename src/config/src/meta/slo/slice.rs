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

//! Slice rows, the publication barrier, and gap-fill — §6b.4a / §6b.4b.
//!
//! Three rules, each of which was a review finding before it was a rule:
//!
//! * **Latest revision wins, not `MAX`** (D54). `MAX(good), MAX(total)` is correct for a count SLI
//!   (late data only adds) and *wrong* for a time-slice SLI, where recomputation can flip a slice
//!   from `good = 300` to `good = 0`. The failure is one-directional: it can only over-report
//!   uptime.
//! * **The barrier is two-sided** (D53/D58). Clamping forward to the watermark hides torn writes at
//!   the leading edge; it cannot hide the trailing recompute, which lands *behind* the watermark.
//!   Hence a committed revision, **per writer** — a shared scalar would expose one writer's torn
//!   batch the moment the other commits.
//! * **Gap-fill is SLI-type-specific** (D48). "No rows in the bucket" is an observation of zero
//!   traffic for a count SLI and an absence of measurement for a time-slice SLI. A uniform
//!   zero-fill stamps unmeasured latency as covered.

use super::SliType;

/// One row of the `slo_slices` stream.
#[derive(Debug, Clone, PartialEq)]
pub struct SliceRow {
    pub slo_id: String,
    /// The definition this slice was measured under — and, since D59, also the
    /// writing epoch. Reads filter to the current generation only.
    pub definition_generation: i32,
    /// `""` is the exact overall row (S-9).
    pub group_key: String,
    pub slice_start: i64,
    /// `f64` **units**: events for a count SLI, seconds for time-slice and
    /// alert-based. Unifying on units is what lets one evaluator serve all
    /// three.
    pub good: f64,
    pub total: f64,
    /// Monotonic within the generation; higher wins on the same key.
    pub rev: i64,
    /// The ingest pass that emitted the row — the commit-barrier witness.
    pub batch_rev: i64,
}

/// The commit state a reader checks rows against (§6b.4a).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommitMarks {
    /// Forward barrier: rows at or after this are invisible.
    pub watermark_end: i64,
    /// Split point between the two writers' ownership ranges.
    pub reset_time: i64,
    /// Highest committed batch of the incremental writer, which owns
    /// `slice_start >= reset_time`.
    pub committed_batch_rev_incr: i64,
    /// Highest committed batch of the backfill writer, which owns
    /// `slice_start < reset_time`.
    pub committed_batch_rev_bf: i64,
}

/// Whether a row is visible to readers — the full two-sided barrier.
pub fn is_visible(row: &SliceRow, marks: &CommitMarks) -> bool {
    let _ = (row, marks);
    todo!("slice::is_visible")
}

/// Collapse duplicate revisions of the same key, keeping the **latest
/// revision** (never the max value).
///
/// Input need not be sorted. Output is ascending by `(group_key, slice_start)`
/// so downstream aggregation is deterministic.
pub fn dedupe_latest_rev(rows: Vec<SliceRow>) -> Vec<SliceRow> {
    let _ = rows;
    todo!("slice::dedupe_latest_rev")
}

/// Apply the barrier and then dedupe — the canonical read path.
pub fn visible_slices(rows: Vec<SliceRow>, marks: &CommitMarks, generation: i32) -> Vec<SliceRow> {
    let _ = (rows, marks, generation);
    todo!("slice::visible_slices")
}

/// What the ingest job emits for a bucket the query did not return.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GapFill {
    /// Emit `good = 0, total = 0` — a real observation of zero traffic, which
    /// counts as covered.
    CoveredZero,
    /// Emit nothing — the slice is a gap and reduces coverage.
    Nothing,
}

/// How a missing bucket is interpreted, per SLI type (D48).
pub fn gap_fill_policy(sli_type: SliType) -> GapFill {
    let _ = sli_type;
    todo!("slice::gap_fill_policy")
}

/// Fill the buckets a successful query did not return, per the type's policy.
///
/// `observed` are the rows the query produced; `expected_starts` is the full
/// aligned grid for the pass. Only applies to a **successful** query — a
/// failed one emits nothing for any type, which is what coverage is for.
pub fn fill_gaps(
    observed: Vec<SliceRow>,
    expected_starts: &[i64],
    group_keys: &[String],
    template: &SliceRow,
    sli_type: SliType,
) -> Vec<SliceRow> {
    let _ = (observed, expected_starts, group_keys, template, sli_type);
    todo!("slice::fill_gaps")
}

/// Whether a recomputed slice should be re-emitted (D55 write-on-change).
///
/// Re-emitting unconditionally makes the trailing-K recompute cost ~K physical
/// rows per logical slice forever — at documented defaults that was ~8 billion
/// rows over a 90-day window.
pub fn should_emit(previous: Option<(f64, f64)>, recomputed: (f64, f64)) -> bool {
    let _ = (previous, recomputed);
    todo!("slice::should_emit")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(group: &str, start: i64, good: f64, total: f64, rev: i64, batch: i64) -> SliceRow {
        SliceRow {
            slo_id: "slo1".into(),
            definition_generation: 1,
            group_key: group.into(),
            slice_start: start,
            good,
            total,
            rev,
            batch_rev: batch,
        }
    }

    fn marks() -> CommitMarks {
        CommitMarks {
            watermark_end: 10_000,
            reset_time: 5_000,
            committed_batch_rev_incr: 100,
            committed_batch_rev_bf: 50,
        }
    }

    // ---- forward barrier ---------------------------------------------------

    #[test]
    fn rows_before_the_watermark_are_visible() {
        assert!(is_visible(&row("", 9_700, 1.0, 1.0, 1, 100), &marks()));
    }

    #[test]
    fn rows_at_or_after_the_watermark_are_invisible() {
        assert!(!is_visible(&row("", 10_000, 1.0, 1.0, 1, 100), &marks()));
        assert!(!is_visible(&row("", 10_300, 1.0, 1.0, 1, 100), &marks()));
    }

    // ---- backward barrier, per writer -------------------------------------

    #[test]
    fn an_uncommitted_incremental_row_is_invisible() {
        // batch 101 > committed 100 — the pass wrote it but never committed.
        assert!(!is_visible(&row("", 9_700, 1.0, 1.0, 9, 101), &marks()));
    }

    /// The defect the forward clamp alone could not catch: the trailing
    /// recompute writes BEHIND the watermark.
    #[test]
    fn a_torn_recompute_behind_the_watermark_is_invisible() {
        let torn = row("", 9_400, 0.0, 1.0, 99, 101); // higher rev, uncommitted batch
        assert!(
            torn.slice_start < marks().watermark_end,
            "behind the watermark"
        );
        assert!(
            !is_visible(&torn, &marks()),
            "the watermark cannot hide this; the committed mark must"
        );
    }

    #[test]
    fn backfill_rows_are_checked_against_the_backfill_mark() {
        // slice_start < reset_time (5000) => owned by backfill (mark 50).
        assert!(is_visible(&row("", 4_000, 1.0, 1.0, 1, 50), &marks()));
        assert!(!is_visible(&row("", 4_000, 1.0, 1.0, 1, 51), &marks()));
    }

    /// D58's decisive case: a shared scalar would expose backfill's torn batch
    /// the moment the incremental writer commits a higher revision. Per-writer
    /// marks make that impossible.
    #[test]
    fn a_high_incremental_mark_does_not_expose_a_torn_backfill_batch() {
        let m = CommitMarks {
            committed_batch_rev_incr: 9_999, // incremental has raced far ahead
            committed_batch_rev_bf: 50,
            ..marks()
        };
        let torn_backfill = row("", 4_000, 1.0, 1.0, 1, 60);
        assert!(
            !is_visible(&torn_backfill, &m),
            "backfill's uncommitted batch must stay hidden regardless of the other writer"
        );
    }

    #[test]
    fn the_two_writers_own_disjoint_ranges_at_the_reset_time() {
        let m = marks();
        // Exactly at reset_time belongs to the incremental writer.
        assert!(is_visible(&row("", 5_000, 1.0, 1.0, 1, 100), &m));
        assert!(!is_visible(&row("", 5_000, 1.0, 1.0, 1, 51), &m));
        // Just below belongs to backfill.
        assert!(is_visible(&row("", 4_999, 1.0, 1.0, 1, 50), &m));
    }

    // ---- dedupe: latest revision wins -------------------------------------

    #[test]
    fn dedupe_keeps_the_highest_revision() {
        let out = dedupe_latest_rev(vec![
            row("a", 100, 5.0, 10.0, 1, 1),
            row("a", 100, 7.0, 12.0, 2, 2),
        ]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].good, 7.0);
        assert_eq!(out[0].total, 12.0);
    }

    #[test]
    fn dedupe_is_order_independent() {
        let ascending = dedupe_latest_rev(vec![
            row("a", 100, 5.0, 10.0, 1, 1),
            row("a", 100, 7.0, 12.0, 2, 2),
        ]);
        let descending = dedupe_latest_rev(vec![
            row("a", 100, 7.0, 12.0, 2, 2),
            row("a", 100, 5.0, 10.0, 1, 1),
        ]);
        assert_eq!(ascending, descending);
    }

    /// D54, the one that matters: a recomputed time-slice can flip good→bad.
    /// `MAX(good)` would keep the stale 300 and over-report uptime.
    #[test]
    fn dedupe_lets_a_recomputed_slice_flip_from_good_to_bad() {
        let out = dedupe_latest_rev(vec![
            row("a", 100, 300.0, 300.0, 1, 1), // good slice
            row("a", 100, 0.0, 300.0, 2, 2),   // late data flipped it bad
        ]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].good, 0.0, "MAX would wrongly keep 300 here");
    }

    #[test]
    fn dedupe_keys_on_group_and_slice_independently() {
        let out = dedupe_latest_rev(vec![
            row("a", 100, 1.0, 1.0, 1, 1),
            row("b", 100, 2.0, 2.0, 1, 1),
            row("a", 200, 3.0, 3.0, 1, 1),
        ]);
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn dedupe_returns_deterministic_order() {
        let out = dedupe_latest_rev(vec![
            row("b", 200, 1.0, 1.0, 1, 1),
            row("a", 300, 1.0, 1.0, 1, 1),
            row("a", 100, 1.0, 1.0, 1, 1),
        ]);
        let keys: Vec<_> = out
            .iter()
            .map(|r| (r.group_key.clone(), r.slice_start))
            .collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
    }

    #[test]
    fn dedupe_of_nothing_is_nothing() {
        assert!(dedupe_latest_rev(vec![]).is_empty());
    }

    // ---- the composed read path -------------------------------------------

    #[test]
    fn visible_slices_filters_barrier_then_dedupes() {
        let rows = vec![
            row("a", 9_000, 1.0, 2.0, 1, 100),  // visible
            row("a", 9_000, 5.0, 9.0, 2, 101),  // NEWER but uncommitted
            row("a", 10_500, 9.0, 9.0, 1, 100), // past the watermark
        ];
        let out = visible_slices(rows, &marks(), 1);
        assert_eq!(out.len(), 1);
        assert_eq!(
            out[0].good, 1.0,
            "the uncommitted higher revision must not win"
        );
    }

    #[test]
    fn visible_slices_excludes_other_generations() {
        let mut old = row("a", 9_000, 1.0, 1.0, 5, 100);
        old.definition_generation = 1;
        let mut new = row("a", 9_000, 2.0, 2.0, 1, 100);
        new.definition_generation = 2;
        let out = visible_slices(vec![old, new], &marks(), 2);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].definition_generation, 2);
        assert_eq!(
            out[0].good, 2.0,
            "a higher rev in an older generation must never win"
        );
    }

    // ---- gap-fill policy ---------------------------------------------------

    /// D48: the two types disagree, and the disagreement is the point.
    #[test]
    fn count_treats_a_missing_bucket_as_measured_zero_traffic() {
        assert_eq!(gap_fill_policy(SliType::Count), GapFill::CoveredZero);
    }

    #[test]
    fn time_slice_treats_a_missing_bucket_as_unmeasured() {
        assert_eq!(gap_fill_policy(SliType::TimeSlice), GapFill::Nothing);
    }

    #[test]
    fn alert_sli_takes_coverage_from_the_ledger_not_gap_fill() {
        assert_eq!(gap_fill_policy(SliType::Alert), GapFill::Nothing);
    }

    // ---- gap-fill behaviour ------------------------------------------------

    #[test]
    fn count_fills_missing_buckets_with_covered_zeros() {
        let template = row("", 0, 0.0, 0.0, 1, 1);
        let out = fill_gaps(
            vec![row("a", 300, 5.0, 10.0, 1, 1)],
            &[0, 300, 600],
            &["a".to_string()],
            &template,
            SliType::Count,
        );
        assert_eq!(out.len(), 3, "every bucket in the grid is emitted");
        let filled: Vec<_> = out.iter().filter(|r| r.slice_start != 300).collect();
        assert!(filled.iter().all(|r| r.good == 0.0 && r.total == 0.0));
    }

    #[test]
    fn time_slice_leaves_missing_buckets_absent() {
        let template = row("", 0, 0.0, 0.0, 1, 1);
        let out = fill_gaps(
            vec![row("a", 300, 300.0, 300.0, 1, 1)],
            &[0, 300, 600],
            &["a".to_string()],
            &template,
            SliType::TimeSlice,
        );
        assert_eq!(out.len(), 1, "gaps stay gaps");
        assert_eq!(out[0].slice_start, 300);
    }

    #[test]
    fn gap_fill_covers_every_group_not_just_the_ones_that_reported() {
        let template = row("", 0, 0.0, 0.0, 1, 1);
        let out = fill_gaps(
            vec![row("a", 0, 1.0, 1.0, 1, 1)],
            &[0],
            &["a".to_string(), "b".to_string()],
            &template,
            SliType::Count,
        );
        assert_eq!(out.len(), 2);
        assert!(out.iter().any(|r| r.group_key == "b" && r.total == 0.0));
    }

    #[test]
    fn gap_fill_preserves_observed_values() {
        let template = row("", 0, 0.0, 0.0, 1, 1);
        let out = fill_gaps(
            vec![row("a", 0, 7.0, 9.0, 3, 4)],
            &[0, 300],
            &["a".to_string()],
            &template,
            SliType::Count,
        );
        let observed = out.iter().find(|r| r.slice_start == 0).unwrap();
        assert_eq!((observed.good, observed.total), (7.0, 9.0));
    }

    // ---- write-on-change ---------------------------------------------------

    #[test]
    fn a_first_observation_is_always_emitted() {
        assert!(should_emit(None, (1.0, 2.0)));
    }

    #[test]
    fn an_unchanged_recompute_is_not_re_emitted() {
        assert!(!should_emit(Some((1.0, 2.0)), (1.0, 2.0)));
    }

    #[test]
    fn a_changed_recompute_is_re_emitted() {
        assert!(should_emit(Some((1.0, 2.0)), (1.0, 3.0)));
        assert!(should_emit(Some((1.0, 2.0)), (0.0, 2.0)));
    }

    /// The steady-state claim behind the §6b.4d volume numbers, exercised over
    /// a realistic trailing-recompute window rather than by repetition: only
    /// the slice whose value actually moved is re-emitted.
    #[test]
    fn a_recompute_pass_emits_only_the_slices_that_changed() {
        let previous = [(0, (10.0, 10.0)), (300, (9.0, 10.0)), (600, (10.0, 10.0))];
        let recomputed = [(0, (10.0, 10.0)), (300, (9.0, 11.0)), (600, (10.0, 10.0))];
        let emitted: Vec<i64> = previous
            .iter()
            .zip(recomputed.iter())
            .filter(|((_, prev), (_, now))| should_emit(Some(*prev), *now))
            .map(|((start, _), _)| *start)
            .collect();
        assert_eq!(emitted, vec![300], "only the slice that gained late data");
    }

    /// NaN must not make a slice re-emit forever — `NaN != NaN` under a naive
    /// equality check, which would defeat write-on-change entirely.
    #[test]
    fn a_nan_value_does_not_re_emit_forever() {
        assert!(
            !should_emit(Some((f64::NAN, 10.0)), (f64::NAN, 10.0)),
            "an unchanged NaN must compare as unchanged"
        );
    }
}
