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

use std::collections::{BTreeSet, HashMap, HashSet};

use config::{
    meta::{
        downtimes::{CorrectionWindow, Downtime, SloCorrectionMode},
        slo::{
            SliType, Slo,
            slice::SliceRow,
            stream::SLO_SLICES_STREAM,
            window::{align_down, align_up, read_window},
        },
    },
    utils::json,
};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::{slo as slo_table, slo_backfill_jobs as jobs},
};
use sea_orm::DatabaseConnection;

use super::ingest::PassParams;

/// `(group_key, slice_start)` of a slice row.
pub type SliceKey = (String, i64);

/// Fills and corrects slices in windows, un-corrects keys corrected before; returns rows added.
pub fn apply(
    slices: &mut Vec<SliceRow>,
    windows: &[CorrectionWindow],
    corrected_before: &HashSet<SliceKey>,
    sli_type: SliType,
    params: &PassParams,
) -> usize {
    if windows.is_empty() && corrected_before.is_empty() {
        return 0;
    }
    let added = fill_windows(slices, windows, params);
    for slice in slices.iter_mut() {
        if let Some(window) = window_for(windows, slice.slice_start) {
            correct(slice, window, sli_type, params.slice_interval_secs);
        }
    }
    added + restore_corrected(slices, windows, corrected_before, sli_type, params)
}

/// Queues, before returning, a re-measure of the windows the change moved for every SLO it covers.
pub async fn remeasure_for_downtime(
    org: &str,
    before: Option<&Downtime>,
    after: &Downtime,
) -> Result<usize, anyhow::Error> {
    let slos = infra::table::slos::list(get_orm_client_ro().await, org, None).await?;
    let db = get_orm_client_rw().await;
    let now = config::utils::time::now_micros() / 1_000_000;
    let mut covered = Vec::with_capacity(slos.len());
    for slo in slos.into_iter().filter(|slo| slo.enabled) {
        let dims = crate::alerts::downtimes::dimensions_for_slo(&slo).await;
        covered.push((slo, dims));
    }
    let queued = queue_remeasures(db, &covered, before, after, now).await;
    for slo in &queued {
        super::service::push_backfill_trigger(slo).await;
    }
    Ok(queued.len())
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

/// The windows only one side of an edit has; an unchanged window needs no re-measure.
pub fn changed_windows(
    old: Vec<CorrectionWindow>,
    new: Vec<CorrectionWindow>,
) -> Vec<CorrectionWindow> {
    let mut changed: Vec<CorrectionWindow> =
        old.iter().filter(|w| !new.contains(w)).cloned().collect();
    changed.extend(new.iter().filter(|w| !old.contains(w)).cloned());
    changed
}

/// The keys whose latest slice in `[start, end)` was corrected, every page of them.
pub async fn corrected_keys(
    slo: &Slo,
    start: i64,
    end: i64,
) -> Result<HashSet<SliceKey>, anyhow::Error> {
    // A stream from before corrections has no `corrected_by`, so nothing in it was corrected.
    if !super::reconcile::slices_carry_corrections(&slo.org).await {
        return Ok(HashSet::new());
    }
    let sql = corrected_keys_sql(&slo.id, slo.definition_generation, start, end);
    let hits = super::reconcile::search_all_slices(&slo.org, &sql, start).await?;
    Ok(hits
        .iter()
        .filter_map(|hit| {
            let group = hit.get("group_key").and_then(json::Value::as_str)?;
            let slice_start = hit.get("slice_start").and_then(json::Value::as_i64)?;
            Some((group.to_string(), slice_start))
        })
        .collect())
}

/// Latest revision per key, so a key measured again is left out; ordered so pages never overlap.
pub fn corrected_keys_sql(slo_id: &str, generation: i32, start: i64, end: i64) -> String {
    format!(
        "SELECT group_key, slice_start FROM ( \
           SELECT group_key, slice_start, corrected_by, \
                  ROW_NUMBER() OVER ( \
                    PARTITION BY group_key, slice_start ORDER BY rev DESC \
                  ) AS zo_rn \
           FROM {SLO_SLICES_STREAM} \
           WHERE slo_id = '{slo_id}' \
             AND definition_generation = {generation} \
             AND slice_start >= {start} AND slice_start < {end} \
         ) WHERE zo_rn = 1 AND corrected_by <> '' \
         ORDER BY slice_start, group_key"
    )
}

/// Queues the re-measure of every SLO the edit moved a window of; the SLOs queued.
async fn queue_remeasures<'a>(
    db: &DatabaseConnection,
    slos: &'a [(Slo, HashMap<String, String>)],
    before: Option<&Downtime>,
    after: &Downtime,
    now: i64,
) -> Vec<&'a Slo> {
    let mut queued = Vec::new();
    for (slo, dims) in slos {
        match remeasure_slo(db, slo, dims, before, after, now).await {
            Ok(Some((start, end))) => {
                log::info!(
                    "[slo] re-measuring {} over [{start}, {end}) for downtime {}",
                    slo.id,
                    after.id
                );
                queued.push(slo);
            }
            Ok(None) => {}
            Err(e) => log::warn!(
                "[slo] re-measure of {} for downtime {} failed: {e}",
                slo.id,
                after.id
            ),
        }
    }
    queued
}

/// Queues the re-measure one SLO needs for the edit; the queued range, or `None` if nothing moved.
async fn remeasure_slo(
    db: &DatabaseConnection,
    slo: &Slo,
    dims: &HashMap<String, String>,
    before: Option<&Downtime>,
    after: &Downtime,
    now: i64,
) -> Result<Option<(i64, i64)>, anyhow::Error> {
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
    let old = before.map_or_else(Vec::new, |row| {
        downtime_windows(slo, dims, std::slice::from_ref(row), from, to)
    });
    let new = downtime_windows(slo, dims, std::slice::from_ref(after), from, to);
    let windows = changed_windows(old, new);
    let Some((start, end)) = remeasure_span(&windows, from, to, slo.definition.slice_interval_secs)
    else {
        return Ok(None);
    };
    jobs::queue_remeasure(db, &slo.id, slo.definition_generation, start, end, now).await?;
    Ok(Some((start, end)))
}

#[cfg(feature = "enterprise")]
fn downtime_windows(
    slo: &Slo,
    dims: &HashMap<String, String>,
    rows: &[Downtime],
    from: i64,
    to: i64,
) -> Vec<CorrectionWindow> {
    crate::alerts::downtimes::enterprise::corrections_in(
        rows,
        slo,
        dims,
        from * 1_000_000,
        to * 1_000_000,
    )
}

#[cfg(not(feature = "enterprise"))]
fn downtime_windows(
    _slo: &Slo,
    _dims: &HashMap<String, String>,
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

/// A row for each key corrected before that has none now, or its old correction stays the latest.
fn restore_corrected(
    slices: &mut Vec<SliceRow>,
    windows: &[CorrectionWindow],
    corrected_before: &HashSet<SliceKey>,
    sli_type: SliType,
    params: &PassParams,
) -> usize {
    let present: HashSet<(&str, i64)> = slices
        .iter()
        .map(|s| (s.group_key.as_str(), s.slice_start))
        .collect();
    let mut missing: Vec<&SliceKey> = corrected_before
        .iter()
        .filter(|(group, t)| {
            (params.range_start..params.range_end).contains(t)
                && !present.contains(&(group.as_str(), *t))
        })
        .collect();
    missing.sort();
    let mut restored: Vec<SliceRow> = missing
        .into_iter()
        .map(|(group, t)| {
            let mut row = empty_slice(group, *t, params);
            if let Some(window) = window_for(windows, *t) {
                correct(&mut row, window, sli_type, params.slice_interval_secs);
            }
            row
        })
        .collect();
    // A grouped SLO derives its rollup from group rows; a standalone one is kept only without them.
    let grouped_starts: HashSet<i64> = slices
        .iter()
        .chain(&restored)
        .filter(|s| !s.group_key.is_empty())
        .map(|s| s.slice_start)
        .collect();
    restored.retain(|s| !s.group_key.is_empty() || !grouped_starts.contains(&s.slice_start));
    let added = restored.len();
    slices.extend(restored);
    added
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

    fn none() -> HashSet<SliceKey> {
        HashSet::new()
    }

    fn keys(starts: &[i64]) -> HashSet<SliceKey> {
        starts.iter().map(|t| (String::new(), *t)).collect()
    }

    fn time_slice_sli() -> config::meta::slo::SliConfig {
        config::meta::slo::SliConfig::TimeSlice {
            stream: "s".into(),
            stream_type: "logs".into(),
            query_language: config::meta::slo::QueryLanguage::Sql,
            query: "p95(d)".into(),
            scope: None,
            comparator: config::meta::alerts::Operator::LessThan,
            threshold: 1.0,
            absent_is_bad: false,
        }
    }

    /// The claim behind 4.3: without the corrected keys a cancel writes over no filled bucket.
    #[test]
    fn a_cancel_alone_writes_no_row_over_a_filled_time_slice_bucket() {
        let filled_by_the_window = {
            let mut slices = Vec::new();
            let windows = [window("dt", 300, 600, SloCorrectionMode::Exclude)];
            apply(
                &mut slices,
                &windows,
                &none(),
                SliType::TimeSlice,
                &params(),
            );
            slices
        };
        assert_eq!(filled_by_the_window[0].corrected_by.as_deref(), Some("dt"));

        let mut slices = super::super::ingest::fill_missing(&time_slice_sli(), &[], &params());
        apply(&mut slices, &[], &none(), SliType::TimeSlice, &params());
        assert!(
            slices.is_empty(),
            "nothing replaces the filler row, so it stays the latest revision"
        );
    }

    #[test]
    fn a_withdrawn_correction_writes_an_uncorrected_row_over_the_filler() {
        let mut slices = Vec::new();
        let added = apply(
            &mut slices,
            &[],
            &keys(&[300]),
            SliType::TimeSlice,
            &params(),
        );
        assert_eq!(added, 1);
        let row = at(&slices, 300);
        assert_eq!(
            (row.good, row.total, row.corrected_by.clone()),
            (0.0, 0.0, None)
        );
        assert_eq!(row.rev, 7, "the replacement must win the dedupe");
    }

    #[test]
    fn a_shrunk_window_keeps_correcting_what_it_still_covers() {
        let mut slices = Vec::new();
        let windows = [window("dt", 300, 600, SloCorrectionMode::CountAsGood)];
        apply(
            &mut slices,
            &windows,
            &keys(&[300, 600]),
            SliType::Alert,
            &params(),
        );
        assert_eq!(slices.len(), 2);
        let kept = at(&slices, 300);
        assert_eq!(kept.corrected_by.as_deref(), Some("dt"));
        assert_eq!((kept.good, kept.total), (300.0, 300.0));
        let released = at(&slices, 600);
        assert_eq!(released.corrected_by, None);
        assert_eq!((released.good, released.total), (0.0, 0.0));
    }

    #[test]
    fn a_corrected_key_of_a_group_the_pass_did_not_see_is_still_corrected() {
        let mut slices = vec![slice("region=eu", 300, 300.0, 300.0)];
        let windows = [window("dt", 300, 600, SloCorrectionMode::Exclude)];
        let before: HashSet<SliceKey> = [("region=us".to_string(), 300)].into();
        apply(
            &mut slices,
            &windows,
            &before,
            SliType::TimeSlice,
            &params(),
        );
        let us = slices.iter().find(|s| s.group_key == "region=us").unwrap();
        assert_eq!(us.corrected_by.as_deref(), Some("dt"));
    }

    #[test]
    fn a_measured_key_needs_no_replacement() {
        let mut slices = vec![slice("", 300, 300.0, 300.0)];
        assert_eq!(
            apply(
                &mut slices,
                &[],
                &keys(&[300]),
                SliType::TimeSlice,
                &params()
            ),
            0
        );
        assert_eq!((slices[0].good, slices[0].total), (300.0, 300.0));
    }

    #[test]
    fn a_corrected_key_outside_the_pass_is_left_alone() {
        let mut slices = Vec::new();
        apply(
            &mut slices,
            &[],
            &keys(&[-300, 1_200]),
            SliType::TimeSlice,
            &params(),
        );
        assert!(slices.is_empty());
    }

    #[test]
    fn the_corrected_keys_read_the_latest_revision_in_a_stable_order() {
        let sql = corrected_keys_sql("slo1", 2, 0, 900);
        assert!(sql.contains("ORDER BY rev DESC"), "{sql}");
        assert!(sql.contains("zo_rn = 1 AND corrected_by <> ''"), "{sql}");
        assert!(sql.contains("definition_generation = 2"), "{sql}");
        assert!(sql.contains("ORDER BY slice_start, group_key"), "{sql}");
        assert!(
            !sql.contains("group_key <> ''"),
            "a standalone rollup filler is a corrected key too"
        );
    }

    /// A grouped SLO measured nothing while corrected, so the filler sits on the rollup alone.
    #[test]
    fn a_grouped_slos_standalone_rollup_filler_is_withdrawn() {
        let mut slices = Vec::new();
        let added = apply(
            &mut slices,
            &[],
            &keys(&[300]),
            SliType::TimeSlice,
            &params(),
        );
        assert_eq!(added, 1);
        let rollup = at(&slices, 300);
        assert_eq!(rollup.group_key, "");
        assert_eq!(rollup.corrected_by, None);
    }

    #[test]
    fn a_rollup_key_is_left_to_the_rollup_when_group_rows_exist() {
        let mut slices = vec![slice("region=eu", 300, 300.0, 300.0)];
        let mut before = keys(&[300, 600]);
        before.insert(("region=us".to_string(), 600));
        apply(&mut slices, &[], &before, SliType::TimeSlice, &params());
        let rollups: Vec<i64> = slices
            .iter()
            .filter(|s| s.group_key.is_empty())
            .map(|s| s.slice_start)
            .collect();
        assert!(rollups.is_empty(), "exact_rollup derives them: {rollups:?}");
        assert!(
            slices
                .iter()
                .any(|s| s.group_key == "region=us" && s.slice_start == 600)
        );
    }

    #[test]
    fn only_windows_one_side_has_are_changed() {
        let kept = window("dt", 0, 300, SloCorrectionMode::Exclude);
        let old = window("dt", 300, 600, SloCorrectionMode::Exclude);
        let new = window("dt", 900, 1_200, SloCorrectionMode::Exclude);
        assert_eq!(
            changed_windows(
                vec![kept.clone(), old.clone()],
                vec![kept.clone(), new.clone()]
            ),
            vec![old.clone(), new]
        );
        assert!(changed_windows(vec![kept.clone()], vec![kept]).is_empty());
        let as_good = CorrectionWindow {
            mode: SloCorrectionMode::CountAsGood,
            ..old.clone()
        };
        assert_eq!(
            changed_windows(vec![old.clone()], vec![as_good.clone()]).len(),
            2
        );
    }

    #[test]
    fn an_empty_bucket_inside_a_window_gets_a_corrected_row_for_a_time_slice_sli() {
        let mut slices = vec![slice("", 0, 300.0, 300.0)];
        let windows = [window("dt", 300, 600, SloCorrectionMode::Exclude)];
        let added = apply(
            &mut slices,
            &windows,
            &none(),
            SliType::TimeSlice,
            &params(),
        );
        assert_eq!(added, 1);
        let filled = at(&slices, 300);
        assert_eq!((filled.good, filled.total), (0.0, 0.0));
        assert_eq!(filled.corrected_by.as_deref(), Some("dt"));
    }

    #[test]
    fn an_alert_sli_gets_the_same_fill() {
        let mut slices = Vec::new();
        let windows = [window("dt", 0, 600, SloCorrectionMode::Exclude)];
        assert_eq!(
            apply(&mut slices, &windows, &none(), SliType::Alert, &params()),
            2
        );
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
        apply(
            &mut slices,
            &windows,
            &none(),
            SliType::TimeSlice,
            &params(),
        );
        assert_eq!(slices.len(), 1);
        assert_eq!(slices[0].group_key, "");
    }

    #[test]
    fn nothing_is_added_outside_a_window() {
        let mut slices = vec![slice("", 0, 300.0, 300.0)];
        let windows = [window("dt", 900, 1_200, SloCorrectionMode::Exclude)];
        apply(
            &mut slices,
            &windows,
            &none(),
            SliType::TimeSlice,
            &params(),
        );
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
        assert_eq!(
            apply(&mut slices, &windows, &none(), SliType::Count, &params()),
            0
        );
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
            apply(
                &mut slices,
                &windows,
                &none(),
                SliType::TimeSlice,
                &params()
            ),
            2
        );
    }

    #[test]
    fn exclude_zeroes_a_slice_inside_the_window() {
        let mut slices = vec![slice("", 300, 250.0, 300.0)];
        apply(
            &mut slices,
            &[window("dt", 300, 600, SloCorrectionMode::Exclude)],
            &none(),
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
            &none(),
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
            &none(),
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
            &none(),
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
            &none(),
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
            &none(),
            SliType::Count,
            &params(),
        );
        assert_eq!(slices[0].corrected_by.as_deref(), Some("exclude"));
        assert_eq!((slices[0].good, slices[0].total), (0.0, 0.0));
    }

    #[test]
    fn no_window_changes_nothing() {
        let mut slices = vec![slice("", 300, 10.0, 40.0)];
        assert_eq!(
            apply(&mut slices, &[], &none(), SliType::Count, &params()),
            0
        );
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
    /// The save path's fan-out, against a real job table.
    #[cfg(feature = "enterprise")]
    mod fan_out {
        use config::meta::{
            downtimes::{DowntimeSchedule, DowntimeTarget, Repeat, TargetFolders, TargetModule},
            slo::{CountSource, SliConfig, SloDefinition, slice::Writer},
        };
        use infra::table::entity::{slo_backfill_jobs, slo_status};
        use sea_orm::{ConnectOptions, ConnectionTrait, Database, EntityTrait, Schema};

        use super::*;

        const HOUR: i64 = 3_600;
        const WATERMARK: i64 = 20 * HOUR;

        async fn db_with(slo_ids: &[&str]) -> DatabaseConnection {
            let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
            opts.max_connections(1);
            let db = Database::connect(opts).await.unwrap();
            let backend = db.get_database_backend();
            let schema = Schema::new(backend);
            for table in [
                schema.create_table_from_entity(slo_backfill_jobs::Entity),
                schema.create_table_from_entity(slo_status::Entity),
            ] {
                db.execute(backend.build(&table)).await.unwrap();
            }
            for id in slo_ids {
                slo_table::init_generation(&db, id, 1).await.unwrap();
                slo_table::apply_status(
                    &db,
                    &slo_table::StatusWrite {
                        slo_id: id.to_string(),
                        definition_generation: 1,
                        writer: Writer::Incremental,
                        deltas: vec![],
                        watermark_end: Some(WATERMARK),
                        trailing_slices: None,
                        burn_windows: None,
                        computed_at: WATERMARK,
                    },
                )
                .await
                .unwrap();
            }
            db
        }

        fn slo(id: &str) -> (Slo, HashMap<String, String>) {
            let slo = Slo {
                id: id.to_string(),
                org: "acme".to_string(),
                folder_id: "default".to_string(),
                name: id.to_string(),
                description: String::new(),
                definition: SloDefinition {
                    sli_config: SliConfig::Count {
                        source: CountSource::SingleQuery {
                            stream: "requests".to_string(),
                            stream_type: "logs".to_string(),
                            scope: None,
                            good_expr: "status < 500".to_string(),
                        },
                    },
                    group_by: None,
                    window_secs: 86_400,
                    slice_interval_secs: 300,
                },
                target: 99.9,
                tags: vec![],
                enabled: true,
                owner: None,
                definition_generation: 1,
                groups_estimate: None,
                groups_reserved: 1,
            };
            (slo, HashMap::new())
        }

        fn downtime(start_hour: i64, end_hour: i64) -> Downtime {
            Downtime {
                id: "dt".to_string(),
                org: "acme".to_string(),
                folder_id: "default".to_string(),
                name: "maintenance".to_string(),
                reason: None,
                condition: None,
                targets: vec![DowntimeTarget {
                    module: TargetModule::Slos,
                    folders: TargetFolders::All,
                    tags: vec![],
                    ids: vec![],
                    slo_mode: None,
                    incident_mode: Default::default(),
                }],
                schedule: DowntimeSchedule {
                    repeat: Repeat::None,
                    starts_at: start_hour * HOUR * 1_000_000,
                    ends_at: Some(end_hour * HOUR * 1_000_000),
                    timezone: "UTC".to_string(),
                    start_time_local: None,
                    duration_secs: (end_hour - start_hour) * HOUR,
                    weekdays: vec![],
                },
                cancelled_at: None,
                cancelled_by: None,
                show_banner: true,
                notifications: None,
                origin_region: None,
                version: 0,
                created_by: "lin".to_string(),
                created_at: 0,
                updated_by: "lin".to_string(),
                updated_at: 0,
            }
        }

        async fn jobs_of(db: &DatabaseConnection) -> Vec<slo_backfill_jobs::Model> {
            slo_backfill_jobs::Entity::find().all(db).await.unwrap()
        }

        #[tokio::test]
        async fn a_save_that_covers_three_slos_leaves_three_queued_jobs() {
            let db = db_with(&["a", "b", "c"]).await;
            let slos = [slo("a"), slo("b"), slo("c"), slo("unmeasured")];
            let queued = queue_remeasures(&db, &slos, None, &downtime(10, 11), WATERMARK).await;
            assert_eq!(queued.len(), 3);

            let jobs = jobs_of(&db).await;
            assert_eq!(jobs.len(), 3);
            for job in jobs {
                assert_eq!(job.state, jobs::STATE_QUEUED);
                assert_eq!(job.kind, jobs::KIND_REMEASURE);
                assert_eq!((job.range_start, job.range_end), (10 * HOUR, 11 * HOUR));
            }
        }

        #[tokio::test]
        async fn a_rename_queues_nothing() {
            let db = db_with(&["a"]).await;
            let before = downtime(10, 11);
            let after = Downtime {
                name: "renamed".to_string(),
                ..before.clone()
            };
            let slos = [slo("a")];
            let queued = queue_remeasures(&db, &slos, Some(&before), &after, WATERMARK).await;
            assert!(queued.is_empty());
            assert!(jobs_of(&db).await.is_empty());
        }

        #[tokio::test]
        async fn a_schedule_change_queues_the_old_and_the_new_window() {
            let db = db_with(&["a"]).await;
            let before = downtime(10, 11);
            let after = downtime(14, 15);
            queue_remeasures(&db, &[slo("a")], Some(&before), &after, WATERMARK).await;
            let jobs = jobs_of(&db).await;
            assert_eq!(
                (jobs[0].range_start, jobs[0].range_end),
                (10 * HOUR, 15 * HOUR)
            );
        }

        #[tokio::test]
        async fn a_cancel_after_the_window_ended_queues_nothing() {
            let db = db_with(&["a"]).await;
            let before = downtime(10, 11);
            let after = Downtime {
                cancelled_at: Some(12 * HOUR * 1_000_000),
                ..before.clone()
            };
            let slos = [slo("a")];
            let queued = queue_remeasures(&db, &slos, Some(&before), &after, WATERMARK).await;
            assert!(queued.is_empty());
        }

        #[tokio::test]
        async fn a_cancel_inside_the_window_re_measures_it() {
            let db = db_with(&["a"]).await;
            let before = downtime(10, 12);
            let after = Downtime {
                cancelled_at: Some(11 * HOUR * 1_000_000),
                ..before.clone()
            };
            queue_remeasures(&db, &[slo("a")], Some(&before), &after, WATERMARK).await;
            let jobs = jobs_of(&db).await;
            assert_eq!(
                (jobs[0].range_start, jobs[0].range_end),
                (10 * HOUR, 12 * HOUR)
            );
        }
    }
}
