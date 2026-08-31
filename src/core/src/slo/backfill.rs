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

//! Historical fill (`alerts_2.md` §6b.4e, S-11).
//!
//! A newly created SLO has no history, so its 30-day window is meaningless for
//! 30 days. Backfill runs the same bucketed query over the past — **one**
//! aggregate per chunk producing every slice in it, never one query per slice.
//!
//! Backfill is the second writer, and the two never race because their ranges
//! are **disjoint by construction**: a generation bump records `reset_time`,
//! the incremental job owns `[reset_time, ∞)` and the watermark, and backfill
//! owns strictly *before* `reset_time` and never touches the watermark. They
//! cannot emit the same `slice_start`.

use config::{
    get_config,
    meta::slo::{
        Slo,
        window::{align_down, align_up},
    },
};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::{slo as slo_table, slo_backfill_jobs as jobs},
};

/// Whether the job has more work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChunkOutcome {
    More,
    Done,
}

/// The next chunk to fill, walking **backwards** from the present.
///
/// Backwards on purpose: the most recent history is what makes an SLO usable
/// immediately, and a forward walk would leave the useful end until last. The
/// range returned is always strictly before `reset_time`.
pub fn next_chunk(
    done_through: Option<i64>,
    range_start: i64,
    range_end: i64,
    chunk_secs: i64,
    slice_interval_secs: i64,
) -> Option<(i64, i64)> {
    if chunk_secs <= 0 || slice_interval_secs <= 0 || range_end <= range_start {
        return None;
    }
    // `done_through` is the earliest point already filled, since the walk goes
    // backwards.
    let end = done_through.unwrap_or(range_end).min(range_end);
    if end <= range_start {
        return None;
    }
    let start = align_down(end - chunk_secs, slice_interval_secs).max(range_start);
    if end <= start {
        return None;
    }
    Some((start, end))
}

/// Fill one chunk for `slo`.
pub async fn run_chunk(slo: &Slo) -> Result<ChunkOutcome, anyhow::Error> {
    let cfg = get_config();
    let db = get_orm_client_rw().await;

    let Some(job) = jobs::get(db, &slo.id, slo.definition_generation).await? else {
        return Ok(ChunkOutcome::Done);
    };
    if job.state == jobs::STATE_DONE || job.state == jobs::STATE_CANCELLED {
        return Ok(ChunkOutcome::Done);
    }

    let Some((start, end)) = next_chunk(
        job.done_through,
        job.range_start,
        job.range_end,
        cfg.slo.backfill_chunk_secs,
        slo.definition.slice_interval_secs,
    ) else {
        jobs::mark_done(db, &slo.id, slo.definition_generation).await?;
        return Ok(ChunkOutcome::Done);
    };

    let written =
        super::job::run_range(slo, start, end, config::meta::slo::slice::Writer::Backfill).await?;

    // `done_through` moves to the chunk's START, because the walk is
    // backwards: everything from here to the end of the range is filled.
    jobs::record_progress(
        db,
        &slo.id,
        slo.definition_generation,
        start,
        written as i64,
    )
    .await?;

    if start <= job.range_start {
        jobs::mark_done(db, &slo.id, slo.definition_generation).await?;
        return Ok(ChunkOutcome::Done);
    }
    Ok(ChunkOutcome::More)
}

/// The range a new backfill should cover: the SLO's window, ending where the
/// incremental writer begins.
///
/// Ending at `reset_time` rather than `now` is what keeps the two writers
/// disjoint — see the module note.
pub fn backfill_range(window_secs: i64, reset_time: i64, slice_interval_secs: i64) -> (i64, i64) {
    let end = align_down(reset_time, slice_interval_secs);
    (end - window_secs, end)
}

/// Pull a backfill range's start forward to the earliest instant the source can
/// honestly be measured from (S-16 PR 4).
///
/// The floor is `max(ledger start, the source alert's last edit)`, and this
/// takes the later of it and the range's own start. Two reasons it is not
/// enough to stop at the ledger's earliest row:
///
/// * the eligibility rules (§5.1, §5.4) validate the alert's config **as of SLO save**, so history
///   before the alert's last edit was produced under a config those checks never saw — an alert
///   with `silence = 10` last month and `silence = 0` today passes §5.4 cleanly while its old
///   intervals carry exactly §5.4's correlated-missingness bias, and that bias lives in the *gaps*,
///   where no per-row stamp can reach;
/// * the same clamp covers pre-SLO condition edits, which D59's generation bump cannot reach
///   backwards.
///
/// Either bound may be absent — a source alert that has never been edited
/// carries no `updated_at`, and one that has never evaluated has no ledger —
/// and an absent bound constrains nothing.
///
/// Aligned **up**: aligning down would hand the pass a slice that starts before
/// the floor, which is the one thing the clamp exists to prevent. Clamped to
/// `range_end` so a floor newer than the whole range yields an empty range
/// rather than an inverted one.
pub fn clamp_backfill_start(
    range_start: i64,
    range_end: i64,
    ledger_start_secs: Option<i64>,
    source_last_edit_secs: Option<i64>,
    slice_interval_secs: i64,
) -> i64 {
    let floor = match (ledger_start_secs, source_last_edit_secs) {
        (Some(a), Some(b)) => a.max(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => return range_start,
    };
    align_up(floor, slice_interval_secs)
        .max(range_start)
        .min(range_end)
}

/// Whether a status row still needs its history filled.
pub async fn is_needed(slo: &Slo) -> Result<bool, anyhow::Error> {
    let db = get_orm_client_ro().await;
    let status = slo_table::load_status(db, &slo.id, "").await?;
    Ok(status.is_some_and(|s| s.definition_generation == slo.definition_generation))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400;

    /// Backwards on purpose: recent history is what makes an SLO usable
    /// immediately, and a forward walk leaves the useful end until last.
    #[test]
    fn the_first_chunk_is_the_most_recent_one() {
        let (start, end) = next_chunk(None, 0, 30 * DAY, DAY, 300).unwrap();
        assert_eq!(end, 30 * DAY);
        assert_eq!(start, 29 * DAY);
    }

    #[test]
    fn each_chunk_walks_further_back() {
        let (start, end) = next_chunk(Some(29 * DAY), 0, 30 * DAY, DAY, 300).unwrap();
        assert_eq!(end, 29 * DAY);
        assert_eq!(start, 28 * DAY);
    }

    #[test]
    fn the_last_chunk_is_clamped_to_the_range_start() {
        let (start, end) = next_chunk(Some(DAY / 2), 0, 30 * DAY, DAY, 300).unwrap();
        assert_eq!(start, 0, "the final chunk must not scan before the range");
        assert_eq!(end, DAY / 2);
    }

    #[test]
    fn a_completed_backfill_has_no_next_chunk() {
        assert_eq!(next_chunk(Some(0), 0, 30 * DAY, DAY, 300), None);
        assert_eq!(next_chunk(Some(-100), 0, 30 * DAY, DAY, 300), None);
    }

    #[test]
    fn a_degenerate_range_produces_no_chunk() {
        assert_eq!(next_chunk(None, 100, 100, DAY, 300), None);
        assert_eq!(next_chunk(None, 200, 100, DAY, 300), None);
        assert_eq!(next_chunk(None, 0, 30 * DAY, 0, 300), None);
        assert_eq!(next_chunk(None, 0, 30 * DAY, DAY, 0), None);
    }

    /// An unaligned chunk boundary would make the histogram emit a
    /// `slice_start` that straddles two chunks, so the same slice would be
    /// written twice with different values.
    #[test]
    fn chunk_boundaries_stay_on_the_slice_grid() {
        let (start, _) = next_chunk(Some(30 * DAY + 137), 0, 40 * DAY, DAY, 300).unwrap();
        assert_eq!(start % 300, 0, "chunk start {start} is off the grid");
    }

    /// The rule that keeps the two writers from ever emitting the same
    /// slice: backfill ends where the incremental writer begins.
    #[test]
    fn the_backfill_range_ends_at_the_generation_reset() {
        let reset = 1_000_000;
        let (start, end) = backfill_range(30 * DAY, reset, 300);
        assert_eq!(end, align_down(reset, 300));
        assert_eq!(start, end - 30 * DAY);
        assert!(end <= reset, "backfill must not reach into the live range");
    }

    #[test]
    fn the_backfill_range_covers_exactly_the_window() {
        let (start, end) = backfill_range(7 * DAY, 7_776_000, 60);
        assert_eq!(end - start, 7 * DAY);
    }

    // ---- the alert-source clamp (S-16 PR 4) --------------------------------

    const RANGE_START: i64 = 0;
    const RANGE_END: i64 = 30 * DAY;

    fn clamp(ledger: Option<i64>, edit: Option<i64>) -> i64 {
        clamp_backfill_start(RANGE_START, RANGE_END, ledger, edit, 300)
    }

    /// The whole point of PR 4's clamp: the ledger's earliest row is NOT
    /// enough on its own. History before the source alert's last edit was
    /// produced under a config the eligibility checks never saw, and §5.4's
    /// bias lives in the gaps, where no per-row stamp can reach.
    #[test]
    fn the_clamp_takes_the_later_of_the_ledger_and_the_last_edit() {
        // Ledger reaches back 20 days; the alert was edited 5 days ago.
        assert_eq!(
            clamp(Some(10 * DAY), Some(25 * DAY)),
            25 * DAY,
            "an edit newer than the ledger must win"
        );
        // And the other way round: an alert untouched for months whose ledger
        // only starts a week ago.
        assert_eq!(
            clamp(Some(23 * DAY), Some(2 * DAY)),
            23 * DAY,
            "a ledger newer than the last edit must win"
        );
    }

    /// A missing bound constrains nothing — a source that has never been
    /// edited carries no `updated_at`, and one that has never evaluated has no
    /// ledger.
    #[test]
    fn an_absent_bound_does_not_clamp() {
        assert_eq!(clamp(Some(10 * DAY), None), 10 * DAY);
        assert_eq!(clamp(None, Some(10 * DAY)), 10 * DAY);
        assert_eq!(clamp(None, None), RANGE_START);
    }

    /// Both bounds older than the window: there is nothing to clamp, and the
    /// SLO gets its full window.
    #[test]
    fn bounds_older_than_the_range_leave_it_whole() {
        assert_eq!(clamp(Some(-5 * DAY), Some(-DAY)), RANGE_START);
    }

    /// An off-grid floor must align UP. Aligning down would hand the pass a
    /// slice that begins before the floor — measuring exactly the history the
    /// clamp exists to exclude.
    ///
    /// Checked on WHICHEVER bound wins, not just one: a ledger start is a
    /// persist-time evaluation instant (§5.3) and is essentially never a
    /// multiple of the slice, so it is the bound most likely to be off-grid.
    #[test]
    fn an_off_grid_floor_aligns_up_not_down() {
        let floor = 10 * DAY + 137;
        for (ledger, edit) in [
            (None, Some(floor)),
            (Some(floor), None),
            (Some(floor), Some(2 * DAY)),
            (Some(2 * DAY), Some(floor)),
        ] {
            let start = clamp(ledger, edit);
            assert_eq!(start % 300, 0, "start {start} is off the slice grid");
            assert!(start >= floor, "start {start} reaches before the floor");
            assert_eq!(start, 10 * DAY + 300);
        }
    }

    /// A floor newer than the whole range leaves nothing to backfill — an
    /// empty range, never an inverted one, so the walk terminates immediately
    /// instead of scanning backwards forever.
    #[test]
    fn a_floor_past_the_range_end_leaves_nothing_to_fill() {
        let start = clamp(None, Some(RANGE_END + DAY));
        assert_eq!(start, RANGE_END);
        assert_eq!(
            next_chunk(None, start, RANGE_END, DAY, 300),
            None,
            "a clamped-away range must produce no chunk"
        );
    }

    /// The clamp feeds `next_chunk` as `range_start`, so the final chunk must
    /// still land on the slice grid — an off-grid boundary makes the histogram
    /// emit a `slice_start` that straddles two chunks.
    #[test]
    fn a_clamped_range_still_walks_on_the_slice_grid() {
        let start = clamp(None, Some(10 * DAY + 137));
        let mut done_through = None;
        for _ in 0..100 {
            let Some((s, _)) = next_chunk(done_through, start, RANGE_END, DAY, 300) else {
                break;
            };
            assert_eq!(s % 300, 0, "chunk start {s} is off the grid");
            assert!(s >= start, "chunk start {s} reaches before the clamp");
            done_through = Some(s);
        }
        assert_eq!(done_through, Some(start), "the walk must reach the clamp");
    }

    /// Walking the whole range must terminate, and must cover it exactly once.
    #[test]
    fn walking_the_range_terminates_and_covers_it_exactly() {
        let (range_start, range_end) = (0, 10 * DAY);
        let mut covered = Vec::new();
        let mut done_through = None;
        for _ in 0..100 {
            let Some((s, e)) = next_chunk(done_through, range_start, range_end, DAY, 300) else {
                break;
            };
            covered.push((s, e));
            done_through = Some(s);
        }
        assert_eq!(covered.len(), 10, "expected 10 daily chunks");
        assert_eq!(covered.first().unwrap().1, range_end);
        assert_eq!(covered.last().unwrap().0, range_start);
        // Contiguous, no gaps and no overlaps.
        for w in covered.windows(2) {
            assert_eq!(w[0].0, w[1].1, "chunks {:?} and {:?} disagree", w[0], w[1]);
        }
    }
}
