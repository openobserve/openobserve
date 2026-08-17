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

//! The trailing-slice buffer and burn-window aggregates (`alerts_2.md`
//! §6b.4c, SA-19).
//!
//! A burn-rate alert compares a short window against a long one, both far
//! shorter than the SLO window. Recomputing them from the slices at alert time
//! would put a query back on the read path — the one thing §6b.9 exists to
//! avoid. Instead the ingest pass keeps a small **trailing buffer** of recent
//! slices on the rollup row and folds it into one aggregate **per distinct
//! window duration**, which every alert on the SLO then reads for free.
//!
//! Two rules carry the arithmetic:
//!
//! 1. **A re-measured slice REPLACES its earlier value, never adds to it.** The pass recomputes the
//!    last K slices for late data (`ZO_SLO_RECOMPUTE_SLICES`), so the same `slice_start` arrives
//!    repeatedly. Summing would inflate every window it touches — the same latest-revision-wins
//!    rule the reconcile SQL applies with `ROW_NUMBER()`, and wrong in the same direction
//!    (over-reporting uptime) if broken.
//! 2. **`expected` comes from the aligned grid, never from what the buffer holds.** It is the
//!    denominator of coverage, so deriving it from the data would make a window that measured one
//!    slice out of sixty read as fully covered — exactly the "unmeasured time reads as uptime"
//!    failure S-8 forbids.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::window::expected_slices;

/// The trailing buffer: `slice_start` → `(good, total)`.
///
/// A `BTreeMap` rather than a `HashMap` because every read is a **range** over
/// `[watermark − window, watermark)`, which is O(log n + k) here and a full
/// scan otherwise.
pub type TrailingSlices = BTreeMap<i64, (f64, f64)>;

/// One window's aggregate — the value stored under `burn_windows[secs]` and
/// read back by the alert evaluator.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowAgg {
    pub good: f64,
    pub total: f64,
    /// Slices actually present in the window.
    pub covered: i64,
    /// Slices the window *should* hold, from the grid.
    pub expected: i64,
}

/// Parse the stored buffer. A malformed or absent entry reads as empty rather
/// than failing the pass: the buffer is a cache, and a pass that cannot read
/// it must still be able to rebuild it.
pub fn parse_trailing(v: Option<&Value>) -> TrailingSlices {
    let mut out = TrailingSlices::new();
    let Some(Value::Object(map)) = v else {
        return out;
    };
    for (k, entry) in map {
        let Ok(slice_start) = k.parse::<i64>() else {
            continue;
        };
        // `[good, total]` — a two-element array, which is half the bytes of
        // an object with named fields and this is written every pass.
        let Some(pair) = entry.as_array() else {
            continue;
        };
        let (Some(good), Some(total)) = (
            pair.first().and_then(Value::as_f64),
            pair.get(1).and_then(Value::as_f64),
        ) else {
            continue;
        };
        out.insert(slice_start, (good, total));
    }
    out
}

/// Serialize the buffer for storage.
pub fn trailing_to_json(buf: &TrailingSlices) -> Value {
    let mut map = serde_json::Map::with_capacity(buf.len());
    for (slice_start, (good, total)) in buf {
        map.insert(slice_start.to_string(), json!([good, total]));
    }
    Value::Object(map)
}

/// Fold this pass's slices into the buffer and drop what has aged out.
///
/// `new_slices` is `(slice_start, good, total)` for the **rollup** series only
/// — burn windows live on the rollup row, and a grouped SLO's per-group rows
/// carry no watermark to read them against.
///
/// Insertion is `insert`, i.e. **replace**: see rule 1 in the module note.
pub fn fold_trailing(
    mut buf: TrailingSlices,
    new_slices: impl IntoIterator<Item = (i64, f64, f64)>,
    watermark_end: i64,
    retain_secs: i64,
) -> TrailingSlices {
    for (slice_start, good, total) in new_slices {
        buf.insert(slice_start, (good, total));
    }
    // Everything at or after the horizon stays; older slices can no longer
    // appear in any window and would grow the row without bound.
    let horizon = watermark_end - retain_secs.max(0);
    buf.split_off(&horizon)
}

/// How much history the buffer must retain to serve `durations`.
pub fn retain_secs(durations: &[i64]) -> i64 {
    durations.iter().copied().max().unwrap_or(0)
}

/// The distinct window **durations** an SLO must precompute, given its alerts'
/// `(long, short)` pairs and the SA-19 cap.
///
/// The cap counts **pairs** — that is the unit an alert author configures —
/// but the work is per duration, and pairs share them: `(1h, 5m)` and
/// `(2h, 5m)` are two pairs but three aggregates, not four.
///
/// Deterministic under input order, which is not cosmetic: every node running
/// a pass must precompute the *same* set, or an alert reads a window on one
/// node and freezes on another. Sorting before the cap is what guarantees it.
pub fn durations_for_pairs(pairs: &[(i64, i64)], max_pairs: usize) -> Vec<i64> {
    let mut distinct: Vec<(i64, i64)> = pairs
        .iter()
        .copied()
        .filter(|(l, s)| *l > 0 && *s > 0)
        .collect();
    distinct.sort_unstable();
    distinct.dedup();
    distinct.truncate(max_pairs);

    let mut durations: Vec<i64> = distinct.iter().flat_map(|&(l, s)| [l, s]).collect();
    durations.sort_unstable();
    durations.dedup();
    durations
}

/// Aggregate one window out of the buffer: `[watermark − window, watermark)`.
pub fn window_aggregate(
    buf: &TrailingSlices,
    window_secs: i64,
    watermark_end: i64,
    slice_interval_secs: i64,
) -> WindowAgg {
    let from = watermark_end - window_secs;
    let (mut good, mut total, mut covered) = (0.0, 0.0, 0);
    // Half-open, matching `read_window`: the slice starting exactly AT the
    // watermark is not yet published.
    for (_, (g, t)) in buf.range(from..watermark_end) {
        good += g;
        total += t;
        covered += 1;
    }
    WindowAgg {
        good,
        total,
        covered,
        // From the grid — rule 2 in the module note.
        expected: expected_slices(from, watermark_end, slice_interval_secs),
    }
}

/// Build the `burn_windows` column: one entry per **distinct** window
/// duration, keyed by that duration in seconds.
///
/// Keyed by duration rather than by `(long, short)` pair because that is what
/// the cost actually scales with — two pairs sharing a short window compute
/// three aggregates, not four — and it is the shape the evaluator reads
/// (`cond.long_window_secs` looked up directly).
pub fn burn_windows_json(
    buf: &TrailingSlices,
    durations: &[i64],
    watermark_end: i64,
    slice_interval_secs: i64,
) -> Value {
    let mut distinct: Vec<i64> = durations.iter().copied().filter(|d| *d > 0).collect();
    distinct.sort_unstable();
    distinct.dedup();

    let mut map = serde_json::Map::with_capacity(distinct.len());
    for d in distinct {
        let a = window_aggregate(buf, d, watermark_end, slice_interval_secs);
        map.insert(
            d.to_string(),
            json!({
                "good": a.good,
                "total": a.total,
                "covered": a.covered,
                "expected": a.expected,
            }),
        );
    }
    Value::Object(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SLICE: i64 = 300;
    const WM: i64 = 100_000;

    fn buf_of(entries: &[(i64, f64, f64)]) -> TrailingSlices {
        entries.iter().map(|&(s, g, t)| (s, (g, t))).collect()
    }

    /// A gap-free window of `count` slices ending at the watermark.
    fn contiguous(count: i64, good: f64, total: f64) -> TrailingSlices {
        (1..=count)
            .map(|i| (WM - i * SLICE, (good, total)))
            .collect()
    }

    // ── fold: replacement, not accumulation ─────────────────────────────────

    /// Rule 1. The pass recomputes trailing slices for late data, so the same
    /// `slice_start` arrives repeatedly; summing would inflate every window it
    /// touches and only ever over-report uptime.
    #[test]
    fn folding_a_re_measured_slice_replaces_its_earlier_value() {
        let prev = buf_of(&[(WM - SLICE, 5.0, 10.0)]);
        let out = fold_trailing(prev, [(WM - SLICE, 8.0, 10.0)], WM, 3600);
        assert_eq!(
            out.get(&(WM - SLICE)),
            Some(&(8.0, 10.0)),
            "a revision must REPLACE, not add"
        );
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn folding_adds_slices_the_buffer_has_not_seen() {
        let prev = buf_of(&[(WM - 2 * SLICE, 1.0, 2.0)]);
        let out = fold_trailing(prev, [(WM - SLICE, 3.0, 4.0)], WM, 3600);
        assert_eq!(out.len(), 2);
        assert_eq!(out.get(&(WM - SLICE)), Some(&(3.0, 4.0)));
        assert_eq!(out.get(&(WM - 2 * SLICE)), Some(&(1.0, 2.0)));
    }

    // ── fold: trimming ──────────────────────────────────────────────────────

    #[test]
    fn folding_drops_slices_that_have_aged_past_the_retention_horizon() {
        let prev = buf_of(&[
            (WM - 7200, 1.0, 1.0), // older than the 3600s horizon
            (WM - 1800, 2.0, 2.0),
        ]);
        let out = fold_trailing(prev, [], WM, 3600);
        assert!(!out.contains_key(&(WM - 7200)), "aged-out slice retained");
        assert!(out.contains_key(&(WM - 1800)));
    }

    /// The horizon is inclusive: a slice exactly `retain_secs` back is the
    /// oldest one a window of that length still needs.
    #[test]
    fn the_slice_exactly_on_the_horizon_is_kept() {
        let prev = buf_of(&[(WM - 3600, 1.0, 1.0)]);
        let out = fold_trailing(prev, [], WM, 3600);
        assert!(
            out.contains_key(&(WM - 3600)),
            "the boundary slice is inside the longest window and must survive"
        );
    }

    #[test]
    fn retention_covers_the_longest_configured_window() {
        assert_eq!(retain_secs(&[300, 3600, 1800]), 3600);
        assert_eq!(retain_secs(&[]), 0);
    }

    // ── which durations to precompute (SA-19) ───────────────────────────────

    /// The cost model: pairs SHARE durations, so two pairs on a common short
    /// window are three aggregates, not four.
    #[test]
    fn pairs_sharing_a_window_share_its_aggregate() {
        let d = durations_for_pairs(&[(3600, 300), (7200, 300)], 8);
        assert_eq!(
            d,
            vec![300, 3600, 7200],
            "the shared 300s was computed twice"
        );
    }

    #[test]
    fn identical_pairs_cost_one_set_of_durations() {
        let d = durations_for_pairs(&[(3600, 300), (3600, 300), (3600, 300)], 8);
        assert_eq!(d, vec![300, 3600]);
    }

    /// The cap counts PAIRS, not durations — 3 pairs under a cap of 2 keeps
    /// two pairs, whose durations may still number three or four.
    #[test]
    fn the_cap_bounds_pairs_not_durations() {
        let d = durations_for_pairs(&[(3600, 300), (7200, 600), (10800, 900)], 2);
        // Sorted pairs: (3600,300), (7200,600), (10800,900); first two kept.
        assert_eq!(d, vec![300, 600, 3600, 7200]);
        assert!(!d.contains(&10800), "a pair past the cap was computed");
    }

    /// Every node must precompute the SAME set: one node computing a window
    /// another does not means an alert observes on one and freezes on the
    /// other, depending on which node ran the pass.
    #[test]
    fn the_duration_set_is_independent_of_input_order() {
        let a = durations_for_pairs(&[(3600, 300), (7200, 600), (1800, 150)], 2);
        let b = durations_for_pairs(&[(7200, 600), (1800, 150), (3600, 300)], 2);
        assert_eq!(a, b, "the cap must not depend on the order alerts arrived");
    }

    #[test]
    fn an_slo_with_no_burn_alerts_precomputes_nothing() {
        assert!(durations_for_pairs(&[], 8).is_empty());
    }

    /// Error-budget alerts store no windows and reach here as zeros; they
    /// must not create a degenerate `"0"` entry.
    #[test]
    fn non_positive_windows_are_ignored() {
        let d = durations_for_pairs(&[(0, 0), (3600, 300)], 8);
        assert_eq!(d, vec![300, 3600]);
    }

    // ── window aggregation ──────────────────────────────────────────────────

    #[test]
    fn a_window_sums_only_the_slices_inside_it() {
        let buf = buf_of(&[
            (WM - 4 * SLICE, 100.0, 100.0), // outside a 900s window
            (WM - 3 * SLICE, 1.0, 2.0),
            (WM - 2 * SLICE, 3.0, 4.0),
            (WM - SLICE, 5.0, 6.0),
        ]);
        let a = window_aggregate(&buf, 3 * SLICE, WM, SLICE);
        assert_eq!(a.good, 9.0, "the slice outside the window leaked in");
        assert_eq!(a.total, 12.0);
        assert_eq!(a.covered, 3);
    }

    /// Half-open `[from, watermark)`, matching `read_window`: the slice
    /// starting AT the watermark is the one still filling.
    #[test]
    fn a_window_excludes_the_slice_starting_at_the_watermark() {
        let buf = buf_of(&[(WM, 99.0, 99.0), (WM - SLICE, 1.0, 1.0)]);
        let a = window_aggregate(&buf, 3600, WM, SLICE);
        assert_eq!(a.good, 1.0, "the open slice was published");
        assert_eq!(a.covered, 1);
    }

    /// Rule 2, and the whole reason coverage means anything: a window that
    /// measured one slice out of twelve must not read as fully covered.
    #[test]
    fn expected_comes_from_the_grid_not_from_what_the_buffer_holds() {
        let buf = buf_of(&[(WM - SLICE, 1.0, 1.0)]);
        let a = window_aggregate(&buf, 3600, WM, SLICE);
        assert_eq!(a.covered, 1);
        assert_eq!(a.expected, 12, "3600s / 300s, from the grid");
        assert!(
            a.covered < a.expected,
            "a one-slice sample must not read as fully covered"
        );
    }

    #[test]
    fn a_gap_free_window_is_exactly_covered() {
        let buf = contiguous(12, 9.0, 10.0);
        let a = window_aggregate(&buf, 3600, WM, SLICE);
        assert_eq!(a.covered, 12);
        assert_eq!(a.expected, 12);
        assert_eq!(a.good, 108.0);
        assert_eq!(a.total, 120.0);
    }

    #[test]
    fn an_empty_buffer_aggregates_to_zero_covered_but_full_expected() {
        let a = window_aggregate(&TrailingSlices::new(), 3600, WM, SLICE);
        assert_eq!(a.covered, 0);
        assert_eq!(a.expected, 12, "expected never depends on the data");
        assert_eq!(a.total, 0.0);
    }

    // ── the stored column ───────────────────────────────────────────────────

    #[test]
    fn burn_windows_are_keyed_by_window_seconds() {
        let buf = contiguous(12, 9.0, 10.0);
        let v = burn_windows_json(&buf, &[3600, 300], WM, SLICE);
        let obj = v.as_object().unwrap();
        assert!(obj.contains_key("3600"), "long window missing");
        assert!(obj.contains_key("300"), "short window missing");
        assert_eq!(obj.len(), 2);
    }

    /// SA-19's cost model: alerts sharing a duration share its aggregate, so
    /// a repeated duration must not produce a second entry.
    #[test]
    fn a_repeated_duration_is_computed_once() {
        let buf = contiguous(12, 9.0, 10.0);
        let v = burn_windows_json(&buf, &[3600, 3600, 300, 3600], WM, SLICE);
        assert_eq!(v.as_object().unwrap().len(), 2);
    }

    /// The four field names ARE the contract with the evaluator
    /// (`slo::evaluate::burn_windows`), which treats a missing field as
    /// unobserved. Renaming one here silently freezes every burn-rate alert.
    #[test]
    fn each_entry_carries_the_four_fields_the_evaluator_reads() {
        let buf = contiguous(12, 9.0, 10.0);
        let v = burn_windows_json(&buf, &[3600], WM, SLICE);
        let e = &v["3600"];
        assert_eq!(e["good"], 108.0);
        assert_eq!(e["total"], 120.0);
        assert_eq!(e["covered"], 12);
        assert_eq!(e["expected"], 12);
    }

    #[test]
    fn a_non_positive_duration_is_skipped_rather_than_stored() {
        let buf = contiguous(4, 1.0, 1.0);
        let v = burn_windows_json(&buf, &[0, -300, 600], WM, SLICE);
        let obj = v.as_object().unwrap();
        assert_eq!(obj.len(), 1);
        assert!(obj.contains_key("600"));
    }

    #[test]
    fn no_durations_yields_an_empty_object_not_null() {
        let v = burn_windows_json(&TrailingSlices::new(), &[], WM, SLICE);
        assert!(v.is_object(), "null would read as 'no windows precomputed'");
        assert_eq!(v.as_object().unwrap().len(), 0);
    }

    // ── round trip through storage ──────────────────────────────────────────

    #[test]
    fn the_buffer_round_trips_through_json() {
        let buf = buf_of(&[(WM - SLICE, 1.5, 2.5), (WM - 2 * SLICE, 3.0, 4.0)]);
        let back = parse_trailing(Some(&trailing_to_json(&buf)));
        assert_eq!(back, buf);
    }

    /// The buffer is a cache: a pass that cannot read it must still rebuild
    /// it rather than failing.
    #[test]
    fn a_malformed_buffer_reads_as_empty_rather_than_failing() {
        assert!(parse_trailing(None).is_empty());
        assert!(parse_trailing(Some(&json!(null))).is_empty());
        assert!(parse_trailing(Some(&json!("nonsense"))).is_empty());
        // Individually bad entries are skipped; good ones survive.
        let mixed = json!({ "not_a_number": [1.0, 2.0], "900": [1.0], "600": [1.0, 2.0] });
        let out = parse_trailing(Some(&mixed));
        assert_eq!(out.len(), 1);
        assert_eq!(out.get(&600), Some(&(1.0, 2.0)));
    }

    /// End to end at the arithmetic level: fold a pass's slices in, then read
    /// the window back out.
    #[test]
    fn folding_then_aggregating_reproduces_the_slices_that_were_folded() {
        let new: Vec<(i64, f64, f64)> = (1..=12).map(|i| (WM - i * SLICE, 9.0, 10.0)).collect();
        let buf = fold_trailing(TrailingSlices::new(), new, WM, 3600);
        let a = window_aggregate(&buf, 3600, WM, SLICE);
        assert_eq!(a.covered, 12);
        assert_eq!(a.expected, 12);
        assert_eq!(a.good, 108.0);
    }
}
