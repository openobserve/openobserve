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

//! SLO status corrections (D8, D10): slices inside a downtime window are written `0 / 0`.

use std::collections::{BTreeSet, HashSet};

use config::meta::{
    downtimes::{CorrectionWindow, Downtime, SloCorrectionMode},
    slo::{
        SliType, Slo,
        slice::SliceRow,
        window::{align_down, align_up, read_window},
    },
};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::{slo as slo_table, slo_backfill_jobs as jobs},
};

use super::ingest::PassParams;

/// Fills empty buckets inside windows, corrects slices starting in one; returns rows added.
pub fn apply(
    slices: &mut Vec<SliceRow>,
    windows: &[CorrectionWindow],
    sli_type: SliType,
    params: &PassParams,
) -> usize {
    if windows.is_empty() {
        return 0;
    }
    let added = fill_windows(slices, windows, params);
    for slice in slices.iter_mut() {
        if let Some(window) = window_for(windows, slice.slice_start) {
            correct(slice, window, sli_type, params.slice_interval_secs);
        }
    }
    added
}

/// Queues a re-measure of `before` and `after` windows for every SLO they match; never fails.
pub async fn remeasure_for_downtime(
    org: &str,
    before: Option<&Downtime>,
    after: &Downtime,
) -> Result<(), anyhow::Error> {
    let rows: Vec<Downtime> = before
        .into_iter()
        .chain(std::iter::once(after))
        .cloned()
        .collect();
    let slos = infra::table::slos::list(get_orm_client_ro().await, org, None).await?;
    for slo in slos.iter().filter(|slo| slo.enabled) {
        match remeasure_slo(slo, &rows).await {
            Ok(Some((start, end))) => log::info!(
                "[slo] re-measuring {} over [{start}, {end}) for downtime {}",
                slo.id,
                after.id
            ),
            Ok(None) => {}
            Err(e) => log::warn!(
                "[slo] re-measure of {} for downtime {} failed: {e}",
                slo.id,
                after.id
            ),
        }
    }
    Ok(())
}

/// The one aligned range inside `[from, to)` covering every window, gaps between windows included.
pub fn remeasure_span(
    windows: &[CorrectionWindow],
    from: i64,
    to: i64,
    slice_interval_secs: i64,
) -> Option<(i64, i64)> {
    let start = windows
        .iter()
        .map(|w| w.start.div_euclid(1_000_000))
        .min()?;
    let end = windows
        .iter()
        .map(|w| (w.end + 999_999).div_euclid(1_000_000))
        .max()?;
    let start = align_down(start.max(from), slice_interval_secs);
    let end = align_up(end.min(to), slice_interval_secs);
    (start < end).then_some((start, end))
}

async fn remeasure_slo(slo: &Slo, rows: &[Downtime]) -> Result<Option<(i64, i64)>, anyhow::Error> {
    let db = get_orm_client_ro().await;
    let Some(status) = slo_table::load_status(db, &slo.id, "").await? else {
        return Ok(None);
    };
    if status.definition_generation != slo.definition_generation {
        return Ok(None);
    }
    let Some(watermark_end) = status.watermark_end else {
        return Ok(None);
    };
    let (from, to) = read_window(watermark_end, slo.definition.window_secs);
    // An alert SLI never measures before the floor its own backfill was clamped to.
    let from = super::service::measurement_floor(db, slo)
        .await
        .map_or(from, |floor| from.max(floor));
    let windows = downtime_windows(slo, rows, from, to).await;
    let Some((start, end)) = remeasure_span(&windows, from, to, slo.definition.slice_interval_secs)
    else {
        return Ok(None);
    };
    let now = config::utils::time::now_micros() / 1_000_000;
    jobs::queue_remeasure(
        get_orm_client_rw().await,
        &slo.id,
        slo.definition_generation,
        start,
        end,
        now,
    )
    .await?;
    super::service::push_backfill_trigger(slo).await;
    Ok(Some((start, end)))
}

#[cfg(feature = "enterprise")]
async fn downtime_windows(
    slo: &Slo,
    rows: &[Downtime],
    from: i64,
    to: i64,
) -> Vec<CorrectionWindow> {
    let dims = crate::alerts::downtimes::dimensions_for_slo(slo).await;
    crate::alerts::downtimes::enterprise::corrections_in(
        rows,
        slo,
        &dims,
        from * 1_000_000,
        to * 1_000_000,
    )
}

#[cfg(not(feature = "enterprise"))]
async fn downtime_windows(
    _slo: &Slo,
    _rows: &[Downtime],
    _from: i64,
    _to: i64,
) -> Vec<CorrectionWindow> {
    Vec::new()
}

/// Seconds against micros; the first window wins, and `Exclude` windows come first.
fn window_for(windows: &[CorrectionWindow], slice_start: i64) -> Option<&CorrectionWindow> {
    let start = slice_start.saturating_mul(1_000_000);
    windows.iter().find(|w| w.start <= start && start < w.end)
}

/// A maintenance bucket often has no data, and without a row the window reads as uncovered.
fn fill_windows(
    slices: &mut Vec<SliceRow>,
    windows: &[CorrectionWindow],
    params: &PassParams,
) -> usize {
    let mut groups: BTreeSet<String> = slices.iter().map(|s| s.group_key.clone()).collect();
    if groups.is_empty() {
        groups.insert(String::new());
    }
    let present: HashSet<(String, i64)> = slices
        .iter()
        .map(|s| (s.group_key.clone(), s.slice_start))
        .collect();
    let before = slices.len();
    let mut t = params.range_start;
    while t < params.range_end {
        if window_for(windows, t).is_some() {
            for group in &groups {
                if !present.contains(&(group.clone(), t)) {
                    slices.push(empty_slice(group, t, params));
                }
            }
        }
        t += params.slice_interval_secs.max(1);
    }
    slices.len() - before
}

fn empty_slice(group_key: &str, slice_start: i64, params: &PassParams) -> SliceRow {
    SliceRow {
        slo_id: params.slo_id.clone(),
        definition_generation: params.definition_generation,
        group_key: group_key.to_string(),
        slice_start,
        good: 0.0,
        total: 0.0,
        rev: params.rev,
        corrected_by: None,
    }
}

fn correct(
    slice: &mut SliceRow,
    window: &CorrectionWindow,
    sli_type: SliType,
    slice_interval_secs: i64,
) {
    slice.corrected_by = Some(window.downtime_id.clone());
    match (window.mode, sli_type) {
        (SloCorrectionMode::Exclude, _) => {
            slice.good = 0.0;
            slice.total = 0.0;
        }
        (SloCorrectionMode::CountAsGood, SliType::Count) => slice.good = slice.total,
        (SloCorrectionMode::CountAsGood, SliType::TimeSlice | SliType::Alert) => {
            slice.good = slice_interval_secs as f64;
            slice.total = slice_interval_secs as f64;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MICROS: i64 = 1_000_000;

    fn params() -> PassParams {
        PassParams {
            slo_id: "slo1".to_string(),
            definition_generation: 1,
            range_start: 0,
            range_end: 1_200,
            slice_interval_secs: 300,
            rev: 7,
            max_groups: 500,
        }
    }

    fn window(id: &str, start: i64, end: i64, mode: SloCorrectionMode) -> CorrectionWindow {
        CorrectionWindow {
            downtime_id: id.to_string(),
            start: start * MICROS,
            end: end * MICROS,
            mode,
        }
    }

    fn slice(group: &str, start: i64, good: f64, total: f64) -> SliceRow {
        SliceRow {
            good,
            total,
            ..empty_slice(group, start, &params())
        }
    }

    fn at(slices: &[SliceRow], start: i64) -> &SliceRow {
        slices.iter().find(|s| s.slice_start == start).unwrap()
    }

    #[test]
    fn an_empty_bucket_inside_a_window_gets_a_corrected_row_for_a_time_slice_sli() {
        let mut slices = vec![slice("", 0, 300.0, 300.0)];
        let windows = [window("dt", 300, 600, SloCorrectionMode::Exclude)];
        let added = apply(&mut slices, &windows, SliType::TimeSlice, &params());
        assert_eq!(added, 1);
        let filled = at(&slices, 300);
        assert_eq!((filled.good, filled.total), (0.0, 0.0));
        assert_eq!(filled.corrected_by.as_deref(), Some("dt"));
    }

    #[test]
    fn an_alert_sli_gets_the_same_fill() {
        let mut slices = Vec::new();
        let windows = [window("dt", 0, 600, SloCorrectionMode::Exclude)];
        assert_eq!(apply(&mut slices, &windows, SliType::Alert, &params()), 2);
        assert!(
            slices
                .iter()
                .all(|s| s.corrected_by.as_deref() == Some("dt"))
        );
    }

    #[test]
    fn a_pass_that_found_nothing_still_writes_the_corrected_rows() {
        let mut slices = Vec::new();
        let windows = [window("dt", 300, 600, SloCorrectionMode::Exclude)];
        apply(&mut slices, &windows, SliType::TimeSlice, &params());
        assert_eq!(slices.len(), 1);
        assert_eq!(slices[0].group_key, "");
    }

    #[test]
    fn nothing_is_added_outside_a_window() {
        let mut slices = vec![slice("", 0, 300.0, 300.0)];
        let windows = [window("dt", 900, 1_200, SloCorrectionMode::Exclude)];
        apply(&mut slices, &windows, SliType::TimeSlice, &params());
        assert!(
            slices
                .iter()
                .all(|s| s.slice_start == 0 || s.slice_start == 900)
        );
    }

    #[test]
    fn a_count_sli_gets_no_extra_row_because_fill_missing_made_one() {
        let mut slices = vec![slice("", 300, 0.0, 0.0)];
        let windows = [window("dt", 300, 600, SloCorrectionMode::Exclude)];
        assert_eq!(apply(&mut slices, &windows, SliType::Count, &params()), 0);
        assert_eq!(slices.len(), 1);
    }

    #[test]
    fn every_group_seen_is_filled() {
        let mut slices = vec![
            slice("region=eu", 0, 1.0, 1.0),
            slice("region=us", 0, 1.0, 1.0),
        ];
        let windows = [window("dt", 300, 600, SloCorrectionMode::Exclude)];
        assert_eq!(
            apply(&mut slices, &windows, SliType::TimeSlice, &params()),
            2
        );
    }

    #[test]
    fn exclude_zeroes_a_slice_inside_the_window() {
        let mut slices = vec![slice("", 300, 250.0, 300.0)];
        apply(
            &mut slices,
            &[window("dt", 300, 600, SloCorrectionMode::Exclude)],
            SliType::Count,
            &params(),
        );
        assert_eq!((slices[0].good, slices[0].total), (0.0, 0.0));
    }

    #[test]
    fn a_slice_that_starts_before_the_window_is_left_alone() {
        let mut slices = vec![slice("", 0, 250.0, 300.0)];
        apply(
            &mut slices,
            &[window("dt", 60, 600, SloCorrectionMode::Exclude)],
            SliType::Count,
            &params(),
        );
        let first = at(&slices, 0);
        assert_eq!((first.good, first.total), (250.0, 300.0));
        assert_eq!(first.corrected_by, None);
    }

    #[test]
    fn a_slice_that_starts_inside_and_ends_after_is_corrected() {
        let mut slices = vec![slice("", 300, 250.0, 300.0)];
        apply(
            &mut slices,
            &[window("dt", 240, 360, SloCorrectionMode::Exclude)],
            SliType::Count,
            &params(),
        );
        assert_eq!(slices[0].corrected_by.as_deref(), Some("dt"));
    }

    #[test]
    fn count_as_good_writes_a_full_good_slice_for_a_time_slice_sli() {
        let mut slices = vec![slice("", 300, 0.0, 300.0)];
        apply(
            &mut slices,
            &[window("dt", 300, 600, SloCorrectionMode::CountAsGood)],
            SliType::TimeSlice,
            &params(),
        );
        assert_eq!((slices[0].good, slices[0].total), (300.0, 300.0));
    }

    #[test]
    fn count_as_good_keeps_the_event_count_of_a_count_sli() {
        let mut slices = vec![slice("", 300, 10.0, 40.0), slice("", 600, 0.0, 0.0)];
        apply(
            &mut slices,
            &[window("dt", 300, 900, SloCorrectionMode::CountAsGood)],
            SliType::Count,
            &params(),
        );
        assert_eq!(
            (at(&slices, 300).good, at(&slices, 300).total),
            (40.0, 40.0)
        );
        assert_eq!((at(&slices, 600).good, at(&slices, 600).total), (0.0, 0.0));
    }

    #[test]
    fn the_first_of_two_overlapping_windows_wins() {
        let mut slices = vec![slice("", 300, 10.0, 40.0)];
        apply(
            &mut slices,
            &[
                window("exclude", 300, 600, SloCorrectionMode::Exclude),
                window("good", 300, 600, SloCorrectionMode::CountAsGood),
            ],
            SliType::Count,
            &params(),
        );
        assert_eq!(slices[0].corrected_by.as_deref(), Some("exclude"));
        assert_eq!((slices[0].good, slices[0].total), (0.0, 0.0));
    }

    #[test]
    fn no_window_changes_nothing() {
        let mut slices = vec![slice("", 300, 10.0, 40.0)];
        assert_eq!(apply(&mut slices, &[], SliType::Count, &params()), 0);
        assert_eq!(slices[0].corrected_by, None);
    }

    #[test]
    fn the_remeasure_span_is_aligned_outward_and_clipped() {
        let windows = [
            window("a", 310, 400, SloCorrectionMode::Exclude),
            window("b", 700, 950, SloCorrectionMode::Exclude),
        ];
        assert_eq!(remeasure_span(&windows, 0, 1_200, 300), Some((300, 1_200)));
        assert_eq!(remeasure_span(&windows, 600, 900, 300), Some((600, 900)));
        assert_eq!(remeasure_span(&[], 0, 1_200, 300), None);
        assert_eq!(remeasure_span(&windows, 1_200, 1_500, 300), None);
    }
}
