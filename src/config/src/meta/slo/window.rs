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

//! Slice and window arithmetic — `alerts_2.md` §6b.4a.
//!
//! Two rules carry the whole ingest path:
//!
//! 1. **The range is `[start, end)` and `end` is the last *completed* slice.** A query with only
//!    `_timestamp >= watermark` publishes the currently-open slice: a bucket that is 10% full reads
//!    as 90% less traffic, and for a time-slice SLI a half-filled slice can classify bad and then
//!    flip good on the next pass.
//! 2. **Everything is aligned in UTC and computed in absolute seconds.** "30 days" is 30 × 86,400
//!    s, not a calendar month — which is exactly why calendar windows are a v1 non-goal rather than
//!    a rounding detail.

/// Align a timestamp down to the start of its slice.
pub fn align_down(ts_secs: i64, slice_interval_secs: i64) -> i64 {
    if slice_interval_secs <= 0 {
        return ts_secs;
    }
    // `div_euclid`, not `/`: integer division truncates toward zero, so a
    // negative timestamp would align *up* and land inside the wrong bucket.
    ts_secs.div_euclid(slice_interval_secs) * slice_interval_secs
}

/// Align a timestamp **up** to the next slice boundary, leaving an exact
/// boundary alone.
fn align_up(ts_secs: i64, slice_interval_secs: i64) -> i64 {
    if slice_interval_secs <= 0 {
        return ts_secs;
    }
    let down = align_down(ts_secs, slice_interval_secs);
    if down == ts_secs {
        down
    } else {
        down + slice_interval_secs
    }
}

/// A closed ingest range: `[start, end)`, both aligned to the slice grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IngestRange {
    /// Inclusive lower bound, aligned.
    pub start: i64,
    /// **Exclusive** upper bound, aligned — the start of the first slice that
    /// is *not* yet complete.
    pub end: i64,
}

impl IngestRange {
    /// Number of slices the range covers.
    pub fn slice_count(&self, slice_interval_secs: i64) -> i64 {
        if slice_interval_secs <= 0 {
            return 0;
        }
        (self.end - self.start).max(0) / slice_interval_secs
    }

    /// Every aligned `slice_start` in the range, ascending.
    pub fn slice_starts(&self, slice_interval_secs: i64) -> Vec<i64> {
        if slice_interval_secs <= 0 {
            return Vec::new();
        }
        let mut out = Vec::new();
        let mut s = self.start;
        while s < self.end {
            out.push(s);
            s += slice_interval_secs;
        }
        out
    }
}

/// Inputs to the range computation, named so the call sites cannot transpose
/// them.
#[derive(Debug, Clone, Copy)]
pub struct IngestRangeParams {
    /// Wall clock at the start of the pass.
    pub now_secs: i64,
    /// The current published watermark; `None` on the very first pass of a
    /// generation.
    pub watermark_end: Option<i64>,
    pub slice_interval_secs: i64,
    /// Settle time for normal ingestion lag before a slice is closed
    /// (`ZO_SLO_INGEST_DELAY_SECS`).
    pub ingest_delay_secs: i64,
    /// How many trailing slices to recompute for late data
    /// (`ZO_SLO_RECOMPUTE_SLICES`).
    pub recompute_slices: i64,
    /// Floor for the first pass of a generation — never scan before this.
    pub generation_reset_time: i64,
}

/// Compute the pass's `[start, end)`.
///
/// ```text
/// end   = align_down(now - ingest_delay)          the last COMPLETE slice
/// start = min(watermark_end, align_down(now) - K × slice)
/// start = max(start, generation_reset_time)
/// ```
///
/// `None` — the pass does nothing — **iff no new slice has closed**, i.e.
/// `end <= watermark_end` (or the degenerate `end <= start`).
///
/// That condition is the whole reason this returns an `Option`, and it needs
/// stating because the obvious alternative is wrong in both directions. With
/// `K > 0` the range *always* reaches back K slices, so `start < end` holds
/// unconditionally and a `end <= start` test alone could never fire — the job
/// would re-query the same trailing slices on every scheduler tick, at up to
/// `slice_interval / cadence` times the necessary query load. Gating on "did a
/// slice close" costs nothing in late-data coverage: the trailing K slices are
/// still recomputed at the next slice boundary, which is the soonest any of
/// their values could matter.
///
/// A watermark ahead of `now` (clock skew) therefore also yields `None`, which
/// is the safe response — never a backwards range.
pub fn ingest_range(params: IngestRangeParams) -> Option<IngestRange> {
    let slice = params.slice_interval_secs;
    if slice <= 0 {
        return None;
    }

    // The last COMPLETE slice: never the one still filling.
    let end = align_down(params.now_secs - params.ingest_delay_secs, slice);

    // Nothing new has closed — do not re-query the same trailing slices on
    // every tick. A watermark ahead of `now` (clock skew) lands here too,
    // which is the safe response.
    if let Some(watermark) = params.watermark_end
        && end <= watermark
    {
        return None;
    }

    // Reach back K slices for late data. On the first pass of a generation
    // there is no watermark to reach back from.
    let reach_back = align_down(params.now_secs, slice) - params.recompute_slices * slice;
    let start = match params.watermark_end {
        Some(watermark) => watermark.min(reach_back),
        None => params.generation_reset_time,
    };

    // Never scan before the generation began, and keep `start` on the grid:
    // an unaligned start would make the histogram emit a `slice_start` below
    // it, i.e. a bucket that partly predates the generation.
    let floor = align_up(params.generation_reset_time, slice);
    let start = align_down(start, slice).max(floor);

    if end <= start {
        return None;
    }
    Some(IngestRange { start, end })
}

/// How many slices a read window *should* contain — the denominator of
/// coverage. Derived from the aligned grid, never from what a query returned.
pub fn expected_slices(from_secs: i64, to_secs: i64, slice_interval_secs: i64) -> i64 {
    if slice_interval_secs <= 0 {
        return 0;
    }
    (to_secs - from_secs).max(0) / slice_interval_secs
}

/// The `[from, to)` a read window covers, anchored at the watermark rather
/// than the wall clock (SA-14).
pub fn read_window(watermark_end: i64, window_secs: i64) -> (i64, i64) {
    (watermark_end - window_secs, watermark_end)
}

/// Whether a watermark is too old to trust — `now > watermark + K × slice`
/// (SA-14). A stale watermark means the evaluation is unobserved, not that the
/// SLO recovered.
pub fn watermark_is_stale(
    now_secs: i64,
    watermark_end: i64,
    slice_interval_secs: i64,
    stale_k: i64,
) -> bool {
    now_secs > watermark_end + stale_k * slice_interval_secs
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60;
    const FIVE_MIN: i64 = 300;

    fn params(now: i64, watermark: Option<i64>, slice: i64) -> IngestRangeParams {
        IngestRangeParams {
            now_secs: now,
            watermark_end: watermark,
            slice_interval_secs: slice,
            ingest_delay_secs: 60,
            recompute_slices: 3,
            generation_reset_time: 0,
        }
    }

    // ---- alignment ---------------------------------------------------------

    #[test]
    fn align_down_snaps_to_the_slice_grid() {
        assert_eq!(align_down(1_000_000, FIVE_MIN), 999_900);
        assert_eq!(align_down(1_000_000, MIN), 1_000_000 - 40);
    }

    #[test]
    fn align_down_is_idempotent() {
        let aligned = align_down(1_234_567, FIVE_MIN);
        assert_eq!(align_down(aligned, FIVE_MIN), aligned);
    }

    #[test]
    fn align_down_leaves_an_exact_boundary_alone() {
        assert_eq!(align_down(3600, FIVE_MIN), 3600);
        assert_eq!(align_down(0, FIVE_MIN), 0);
    }

    // ---- the exclusive upper bound ----------------------------------------

    /// The defect this rule exists to prevent: publishing the slice that is
    /// still filling.
    #[test]
    fn range_never_includes_the_currently_open_slice() {
        // now sits 100s into the slice that starts at 3600.
        let now = 3600 + 100;
        let r = ingest_range(IngestRangeParams {
            ingest_delay_secs: 0,
            ..params(now, Some(3000), FIVE_MIN)
        })
        .unwrap();
        assert_eq!(r.end, 3600, "end must be the START of the open slice");
        assert!(r.end <= now);
    }

    #[test]
    fn range_end_is_aligned() {
        let r = ingest_range(params(1_234_567, Some(1_200_000), FIVE_MIN)).unwrap();
        assert_eq!(align_down(r.end, FIVE_MIN), r.end);
    }

    #[test]
    fn ingest_delay_pushes_the_end_back_by_whole_slices() {
        let now = 7200; // exactly on a slice boundary
        let no_delay = ingest_range(IngestRangeParams {
            ingest_delay_secs: 0,
            ..params(now, Some(3600), FIVE_MIN)
        })
        .unwrap();
        let delayed = ingest_range(IngestRangeParams {
            ingest_delay_secs: 60,
            ..params(now, Some(3600), FIVE_MIN)
        })
        .unwrap();
        assert_eq!(no_delay.end, 7200);
        assert_eq!(delayed.end, 6900, "a 60s delay drops the last slice");
    }

    /// The pass is a no-op while no new slice has closed — otherwise a job
    /// running faster than its slice interval re-queries the same trailing
    /// slices every tick.
    #[test]
    fn range_is_none_when_no_new_slice_has_closed() {
        // end = align(7300 - 60) = 7200, which the watermark already covers.
        assert_eq!(ingest_range(params(7300, Some(7200), FIVE_MIN)), None);
    }

    #[test]
    fn range_is_some_again_as_soon_as_one_slice_closes() {
        // Same watermark, one slice later: end = align(7600-60) = 7500.
        let r = ingest_range(params(7600, Some(7200), FIVE_MIN)).unwrap();
        assert_eq!(r.end, 7500);
    }

    #[test]
    fn range_is_none_when_the_watermark_is_ahead_of_now() {
        // Clock skew must never produce a backwards range.
        assert_eq!(ingest_range(params(3600, Some(99_999), FIVE_MIN)), None);
    }

    // ---- the trailing recompute window ------------------------------------

    #[test]
    fn range_reaches_back_k_slices_for_late_data() {
        let r = ingest_range(params(10_000, Some(9000), FIVE_MIN)).unwrap();
        // now - delay = 9940 -> end = 9900; align(now) - 3 slices = 9000,
        // and the watermark is also 9000, so start is 9000.
        assert_eq!(r.end, 9900);
        assert_eq!(r.start, 9000, "3 slices back from align(now)");
    }

    /// The recompute window must actually re-cover already-published slices,
    /// otherwise late data is never picked up.
    #[test]
    fn the_recompute_window_reaches_behind_the_watermark() {
        // A watermark well ahead of align(now) - K*slice: start is pulled back.
        let r = ingest_range(params(10_000, Some(9_800), FIVE_MIN)).unwrap();
        assert!(
            r.start < 9_800,
            "start {} must reach behind the watermark for late data",
            r.start
        );
        assert_eq!(r.start, 9_000);
    }

    #[test]
    fn recompute_never_reaches_past_the_generation_reset() {
        let r = ingest_range(IngestRangeParams {
            generation_reset_time: 9600,
            ..params(10_000, Some(9000), FIVE_MIN)
        })
        .unwrap();
        assert!(
            r.start >= 9600,
            "must not scan before the generation started: {}",
            r.start
        );
    }

    /// An unaligned reset would put `start` inside a bucket, so the histogram
    /// emits a `slice_start` BELOW `start` — which then falls on the backfill
    /// side of `reset_time` and is judged against the wrong committed mark.
    #[test]
    fn an_unaligned_generation_reset_still_yields_an_aligned_start() {
        let r = ingest_range(IngestRangeParams {
            generation_reset_time: 9601,
            ..params(11_000, Some(9_000), FIVE_MIN)
        })
        .unwrap();
        assert_eq!(
            align_down(r.start, FIVE_MIN),
            r.start,
            "start {} is not on the slice grid",
            r.start
        );
        assert!(
            r.start >= 9601,
            "start {} would scan data from before the generation began",
            r.start
        );
    }

    #[test]
    fn an_unaligned_reset_never_emits_a_slice_owned_by_the_other_writer() {
        let reset = 9601;
        let r = ingest_range(IngestRangeParams {
            generation_reset_time: reset,
            ..params(11_000, Some(9_000), FIVE_MIN)
        })
        .unwrap();
        for s in r.slice_starts(FIVE_MIN) {
            assert!(
                s >= reset,
                "slice_start {s} is below reset_time {reset}, so the backfill \
                 writer's mark would judge an incremental row"
            );
        }
    }

    #[test]
    fn the_first_pass_of_a_generation_starts_at_the_reset_time() {
        let r = ingest_range(IngestRangeParams {
            watermark_end: None,
            generation_reset_time: 9000,
            ..params(10_000, None, FIVE_MIN)
        })
        .unwrap();
        assert_eq!(r.start, 9000);
    }

    #[test]
    fn zero_recompute_starts_exactly_at_the_watermark() {
        let r = ingest_range(IngestRangeParams {
            recompute_slices: 0,
            ..params(10_000, Some(9000), FIVE_MIN)
        })
        .unwrap();
        assert_eq!(r.start, 9000);
    }

    // ---- slice enumeration -------------------------------------------------

    #[test]
    fn slice_count_is_the_half_open_length() {
        let r = IngestRange {
            start: 0,
            end: 1500,
        };
        assert_eq!(r.slice_count(FIVE_MIN), 5);
    }

    #[test]
    fn slice_starts_are_ascending_aligned_and_exclude_the_end() {
        let r = IngestRange {
            start: 600,
            end: 1800,
        };
        let starts = r.slice_starts(FIVE_MIN);
        assert_eq!(starts, vec![600, 900, 1200, 1500]);
        assert!(!starts.contains(&1800), "end is exclusive");
    }

    #[test]
    fn an_empty_range_enumerates_nothing() {
        let r = IngestRange {
            start: 900,
            end: 900,
        };
        assert_eq!(r.slice_count(FIVE_MIN), 0);
        assert!(r.slice_starts(FIVE_MIN).is_empty());
    }

    // ---- expected slices (the coverage denominator) ------------------------

    #[test]
    fn expected_slices_counts_the_grid_not_the_data() {
        assert_eq!(expected_slices(0, 3600, FIVE_MIN), 12);
        assert_eq!(expected_slices(0, 3600, MIN), 60);
    }

    #[test]
    fn a_thirty_day_window_has_the_documented_slice_count() {
        // The §6b.4d volume table: 8,640 slices per 30 days at 5-min.
        assert_eq!(expected_slices(0, 30 * 86_400, FIVE_MIN), 8_640);
        assert_eq!(expected_slices(0, 30 * 86_400, MIN), 43_200);
    }

    #[test]
    fn a_ninety_day_window_at_five_minutes_is_the_documented_row_count() {
        assert_eq!(expected_slices(0, 90 * 86_400, FIVE_MIN), 25_920);
    }

    #[test]
    fn expected_slices_of_an_empty_window_is_zero() {
        assert_eq!(expected_slices(1000, 1000, FIVE_MIN), 0);
    }

    /// These are `pub` entry points, so a zero interval must be defined rather
    /// than a divide-by-zero panic — validate_slo rejects it upstream, but the
    /// functions must not be a landmine for a caller that skips validation.
    #[test]
    fn a_zero_slice_interval_does_not_panic() {
        assert_eq!(align_down(1234, 0), 1234);
        assert_eq!(expected_slices(0, 3600, 0), 0);
        let r = IngestRange { start: 0, end: 900 };
        assert_eq!(r.slice_count(0), 0);
        assert!(r.slice_starts(0).is_empty());
    }

    #[test]
    fn a_negative_slice_interval_does_not_panic() {
        assert_eq!(align_down(1234, -60), 1234);
        assert_eq!(expected_slices(0, 3600, -60), 0);
    }

    #[test]
    fn expected_slices_never_goes_negative() {
        assert_eq!(expected_slices(2000, 1000, FIVE_MIN), 0);
    }

    // ---- read windows are anchored at the watermark ------------------------

    /// SA-14: an alert that anchors at `now()` reads a window missing its most
    /// recent slice — systematically optimistic, and worst during an incident.
    #[test]
    fn read_window_ends_at_the_watermark_not_the_clock() {
        let (from, to) = read_window(9_000, 3600);
        assert_eq!(to, 9_000);
        assert_eq!(from, 9_000 - 3600);
    }

    #[test]
    fn read_window_length_is_exactly_the_window() {
        let (from, to) = read_window(1_000_000, 30 * 86_400);
        assert_eq!(to - from, 30 * 86_400);
    }

    // ---- watermark staleness ----------------------------------------------

    #[test]
    fn a_fresh_watermark_is_not_stale() {
        assert!(!watermark_is_stale(10_000, 9_900, FIVE_MIN, 3));
    }

    #[test]
    fn a_watermark_older_than_k_slices_is_stale() {
        // K=3 at 5-min slices = 900s of tolerance.
        assert!(!watermark_is_stale(10_000, 9_150, FIVE_MIN, 3));
        assert!(watermark_is_stale(10_000, 9_000, FIVE_MIN, 3));
    }

    #[test]
    fn staleness_scales_with_the_slice_interval() {
        // The same absolute gap is stale at 1-min slices but fine at 5-min.
        let gap_secs = 500;
        assert!(watermark_is_stale(10_000, 10_000 - gap_secs, MIN, 3));
        assert!(!watermark_is_stale(10_000, 10_000 - gap_secs, FIVE_MIN, 3));
    }

    #[test]
    fn a_future_watermark_is_never_stale() {
        assert!(!watermark_is_stale(10_000, 20_000, FIVE_MIN, 3));
    }
}
