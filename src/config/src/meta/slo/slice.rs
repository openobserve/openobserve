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

//! Slice rows: dedupe, gap-fill, and the one clamp that matters — §6b.4a/§6b.4b.
//!
//! **Slices publish at-least-once, like every other stream in the product**
//! (D64). There is no transactional publication protocol here, and that is a
//! deliberate reversal of three earlier designs. The reasoning, in short:
//!
//! * A torn batch's rows are **not corrupt** — they were computed from real data by the query that
//!   would have run anyway. The only thing that did not happen is their delta being folded into the
//!   running aggregate.
//! * The running aggregate is a **cache**, rebuilt from slices by reconciliation. So a torn batch
//!   causes cache drift, which self-heals.
//! * Alerts read the cache (`slo_status.burn_windows`, §6b.4c), never slices directly, so an
//!   unaccounted slice cannot page anyone.
//! * A partially-written batch shows up as **reduced coverage**, and coverage gating — which exists
//!   for search outages anyway — already bounds the damage: above the floor it is bounded by
//!   definition, below it the alert freezes.
//! * The trailing-K recompute re-emits any slice near a crash on the next pass regardless.
//!
//! What survives from those designs, because each earns its place for a reason
//! unrelated to torn batches:
//!
//! * **The watermark**, a forward clamp only. Not a commit barrier — it stops readers seeing the
//!   *currently filling* slice, which for a time-slice SLI would classify against a partial bucket
//!   and then flip.
//! * **Latest-revision-wins dedupe**, needed for late data. `MAX(good)` is *wrong* here: a
//!   recomputed time-slice can flip good → bad, and MAX would keep the stale 300 — a failure that
//!   only ever over-reports uptime.
//! * **Type-specific gap-fill** (D48): "no rows in the bucket" is an observation of zero traffic
//!   for a count SLI and an absence of measurement for a time-slice one.
//! * **Ingest-boundary validation**, so non-finite values never reach a slice.

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
    /// Monotonic within the generation; higher wins on the same key. Exists
    /// for late-data re-emission, not for publication ordering.
    pub rev: i64,
}

/// Whether a row is visible to readers.
///
/// One clamp: the row must belong to the current generation and start strictly
/// before the watermark. Three earlier designs added a backward barrier here —
/// per-writer committed marks, an abandoned-batch set, a write-ahead manifest
/// — to hide rows from batches that never committed. D64 removed all of it:
/// those rows are valid measurements whose delta was never folded into the
/// cache, the cache is rebuilt by reconciliation, and alerts read the cache
/// rather than slices.
pub fn is_visible(row: &SliceRow, watermark_end: i64, generation: i32) -> bool {
    row.definition_generation == generation && row.slice_start < watermark_end
}

/// Collapse duplicate revisions of the same key, keeping the **latest
/// revision** (never the max value).
///
/// Input need not be sorted. Output is ascending by `(group_key, slice_start)`
/// so downstream aggregation is deterministic.
pub fn dedupe_latest_rev(rows: Vec<SliceRow>) -> Vec<SliceRow> {
    use std::collections::BTreeMap;

    // BTreeMap so the output order is deterministic by (group_key,
    // slice_start) without a separate sort.
    let mut best: BTreeMap<(String, i64), SliceRow> = BTreeMap::new();
    for row in rows {
        let key = (row.group_key.clone(), row.slice_start);
        match best.get(&key) {
            // Strictly greater: an equal revision must not flip the winner, or
            // the result would depend on input order.
            Some(existing) if existing.rev >= row.rev => {}
            _ => {
                best.insert(key, row);
            }
        }
    }
    best.into_values().collect()
}

/// Clamp and dedupe — the canonical read path.
pub fn visible_slices(rows: Vec<SliceRow>, watermark_end: i64, generation: i32) -> Vec<SliceRow> {
    // Clamp BEFORE dedupe: a row from another generation must not win a key
    // just because its revision is higher.
    let visible = rows
        .into_iter()
        .filter(|r| is_visible(r, watermark_end, generation))
        .collect();
    dedupe_latest_rev(visible)
}

/// What the ingest job emits for a bucket the query did not return.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GapFill {
    /// Emit `good = 0, total = 0` — a real observation of zero traffic, which
    /// counts as covered.
    CoveredZero,
    /// Emit `good = 0, total = interval` — the slice was PROVEN empty and
    /// absence is the failure (`absent_is_bad`). Covered, and fully bad.
    CoveredBad,
    /// Emit nothing — the slice is a gap and reduces coverage.
    Nothing,
}

/// How a missing bucket is interpreted for a specific SLO definition.
///
/// Refines [`gap_fill_policy`]: the per-TYPE answer (D48) holds except where
/// the definition itself says otherwise — a time-slice SLO with
/// `absent_is_bad` treats a proven-empty bucket as downtime rather than as a
/// gap. Callers holding a config should ask here; the type-level function
/// remains for callers that have only the discriminant.
pub fn gap_fill_policy_for(sli: &crate::meta::slo::SliConfig) -> GapFill {
    if let crate::meta::slo::SliConfig::TimeSlice {
        absent_is_bad: true,
        ..
    } = sli
    {
        return GapFill::CoveredBad;
    }
    gap_fill_policy(sli.sli_type())
}

/// How a missing bucket is interpreted, per SLI type (D48).
pub fn gap_fill_policy(sli_type: SliType) -> GapFill {
    match sli_type {
        // "No rows" is a real observation of zero traffic.
        SliType::Count => GapFill::CoveredZero,
        // The aggregate had no input, so there is no value to compare.
        SliType::TimeSlice => GapFill::Nothing,
        // Coverage comes from the triggers stream instead (S-16, D65).
        SliType::Alert => GapFill::Nothing,
    }
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
    if gap_fill_policy(sli_type) == GapFill::Nothing {
        return observed;
    }

    use std::collections::HashSet;
    let present: HashSet<(String, i64)> = observed
        .iter()
        .map(|r| (r.group_key.clone(), r.slice_start))
        .collect();

    let mut out = observed;
    for group_key in group_keys {
        for &slice_start in expected_starts {
            if present.contains(&(group_key.clone(), slice_start)) {
                continue;
            }
            out.push(SliceRow {
                group_key: group_key.clone(),
                slice_start,
                good: 0.0,
                total: 0.0,
                ..template.clone()
            });
        }
    }
    out
}

/// Whether a recomputed slice should be re-emitted (D55 write-on-change).
///
/// Re-emitting unconditionally makes the trailing-K recompute cost ~K physical
/// rows per logical slice forever — at documented defaults that was ~8 billion
/// rows over a 90-day window.
pub fn should_emit(previous: Option<(f64, f64)>, recomputed: (f64, f64)) -> bool {
    let Some((prev_good, prev_total)) = previous else {
        return true;
    };
    // `same` rather than `!=` so an unchanged NaN compares as unchanged;
    // `NaN != NaN` would make the slice churn on every pass forever.
    let same = |a: f64, b: f64| a == b || (a.is_nan() && b.is_nan());
    !(same(prev_good, recomputed.0) && same(prev_total, recomputed.1))
}

/// Which lane wrote a batch.
///
/// Still meaningful for **scheduling** — bulk backfill runs in its own
/// concurrency lane so it cannot starve latency-sensitive incremental passes
/// (D58) — but no longer for visibility. Both lanes write ordinary slices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Writer {
    Incremental,
    Backfill,
}

/// Why an observation may not be persisted as a slice.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ObservationError {
    /// `NaN` or `±inf`. Poisons every downstream aggregate, comparison and
    /// serialized status value.
    NotFinite { field: &'static str, value: f64 },
    /// Counts and seconds cannot be negative.
    Negative { field: &'static str, value: f64 },
    /// More good units than total — the SLI would exceed 100%.
    GoodExceedsTotal { good: f64, total: f64 },
}

/// Reject a non-finite or incoherent observation at the **ingest boundary**,
/// before it can reach a slice row.
///
/// Deliberately not `should_emit`'s job: making write-on-change tolerate `NaN`
/// stops the row churning, but still lets invalid data into the stream, where
/// it silently corrupts every window aggregate that touches it.
pub fn validate_observation(good: f64, total: f64) -> Result<(), ObservationError> {
    for (field, value) in [("good", good), ("total", total)] {
        if !value.is_finite() {
            return Err(ObservationError::NotFinite { field, value });
        }
        if value < 0.0 {
            return Err(ObservationError::Negative { field, value });
        }
    }
    if good > total {
        return Err(ObservationError::GoodExceedsTotal { good, total });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(group: &str, start: i64, good: f64, total: f64, rev: i64) -> SliceRow {
        SliceRow {
            slo_id: "slo1".into(),
            definition_generation: 1,
            group_key: group.into(),
            slice_start: start,
            good,
            total,
            rev,
        }
    }

    const WATERMARK: i64 = 10_000;

    // ---- the forward clamp -------------------------------------------------

    #[test]
    fn rows_before_the_watermark_are_visible() {
        assert!(is_visible(&row("", 9_700, 1.0, 1.0, 1), WATERMARK, 1));
    }

    /// The one thing the watermark is for: the currently-filling slice must
    /// not be published. A bucket that is 10% full reads as 90% less traffic,
    /// and for a time-slice SLI it can classify bad and then flip good.
    #[test]
    fn the_currently_filling_slice_is_not_visible() {
        assert!(!is_visible(&row("", 10_000, 1.0, 1.0, 1), WATERMARK, 1));
        assert!(!is_visible(&row("", 10_300, 1.0, 1.0, 1), WATERMARK, 1));
    }

    #[test]
    fn rows_from_another_generation_are_invisible() {
        let mut old = row("", 9_000, 1.0, 1.0, 99);
        old.definition_generation = 1;
        assert!(!is_visible(&old, WATERMARK, 2));
    }

    /// D64, stated as a test so the reversal is not silently undone: a row
    /// whose batch never committed IS visible. It is a real measurement whose
    /// delta was not folded into the cache; reconciliation repairs the cache,
    /// and alerts read the cache rather than slices. Re-adding a backward
    /// barrier would break this test, which is the intent.
    #[test]
    fn an_unaccounted_row_is_visible_because_publication_is_at_least_once() {
        assert!(
            is_visible(&row("", 9_000, 1.0, 1.0, 5), WATERMARK, 1),
            "at-least-once publication: slices are not gated on a commit record"
        );
    }

    // ---- dedupe: latest revision wins -------------------------------------

    #[test]
    fn dedupe_keeps_the_highest_revision() {
        let out = dedupe_latest_rev(vec![
            row("a", 100, 5.0, 10.0, 1),
            row("a", 100, 7.0, 12.0, 2),
        ]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].good, 7.0);
        assert_eq!(out[0].total, 12.0);
    }

    #[test]
    fn dedupe_is_order_independent() {
        let ascending = dedupe_latest_rev(vec![
            row("a", 100, 5.0, 10.0, 1),
            row("a", 100, 7.0, 12.0, 2),
        ]);
        let descending = dedupe_latest_rev(vec![
            row("a", 100, 7.0, 12.0, 2),
            row("a", 100, 5.0, 10.0, 1),
        ]);
        assert_eq!(ascending, descending);
    }

    /// D54, the one that matters: a recomputed time-slice can flip good→bad.
    /// `MAX(good)` would keep the stale 300 and over-report uptime.
    #[test]
    fn dedupe_lets_a_recomputed_slice_flip_from_good_to_bad() {
        let out = dedupe_latest_rev(vec![
            row("a", 100, 300.0, 300.0, 1), // good slice
            row("a", 100, 0.0, 300.0, 2),   // late data flipped it bad
        ]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].good, 0.0, "MAX would wrongly keep 300 here");
    }

    #[test]
    fn dedupe_keys_on_group_and_slice_independently() {
        let out = dedupe_latest_rev(vec![
            row("a", 100, 1.0, 1.0, 1),
            row("b", 100, 2.0, 2.0, 1),
            row("a", 200, 3.0, 3.0, 1),
        ]);
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn dedupe_returns_deterministic_order() {
        let out = dedupe_latest_rev(vec![
            row("b", 200, 1.0, 1.0, 1),
            row("a", 300, 1.0, 1.0, 1),
            row("a", 100, 1.0, 1.0, 1),
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
    fn visible_slices_clamps_then_dedupes() {
        let rows = vec![
            row("a", 9_000, 1.0, 2.0, 1),  // superseded
            row("a", 9_000, 5.0, 9.0, 2),  // the later revision
            row("a", 10_500, 9.0, 9.0, 1), // at/after the watermark
        ];
        let out = visible_slices(rows, WATERMARK, 1);
        assert_eq!(out.len(), 1, "the unclosed slice is clamped away");
        assert_eq!(
            out[0].good, 5.0,
            "the later revision wins — there is no commit record to gate on (D64)"
        );
    }

    /// Order matters: clamping must happen BEFORE dedupe, or a row from
    /// another generation could win a key on revision alone and then be
    /// filtered out, leaving the key empty.
    #[test]
    fn clamping_happens_before_dedupe_not_after() {
        let mut foreign = row("a", 9_000, 99.0, 99.0, 9);
        foreign.definition_generation = 2;
        let current = row("a", 9_000, 1.0, 1.0, 1);
        let out = visible_slices(vec![foreign, current], WATERMARK, 1);
        assert_eq!(out.len(), 1);
        assert_eq!(
            out[0].good, 1.0,
            "a higher revision in the wrong generation must not consume the key"
        );
    }

    #[test]
    fn visible_slices_excludes_other_generations() {
        let mut old = row("a", 9_000, 1.0, 1.0, 5);
        old.definition_generation = 1;
        let mut new = row("a", 9_000, 2.0, 2.0, 1);
        new.definition_generation = 2;
        let out = visible_slices(vec![old, new], WATERMARK, 2);
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
        let template = row("", 0, 0.0, 0.0, 1);
        let out = fill_gaps(
            vec![row("a", 300, 5.0, 10.0, 1)],
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
        let template = row("", 0, 0.0, 0.0, 1);
        let out = fill_gaps(
            vec![row("a", 300, 300.0, 300.0, 1)],
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
        let template = row("", 0, 0.0, 0.0, 1);
        let out = fill_gaps(
            vec![row("a", 0, 1.0, 1.0, 1)],
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
        let template = row("", 0, 0.0, 0.0, 1);
        let out = fill_gaps(
            vec![row("a", 0, 7.0, 9.0, 3)],
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

    /// Defence in depth only: `NaN` must be rejected at the ingest boundary
    /// (see `validate_observation`), but if one ever reaches the trailing
    /// buffer it must not make the slice churn forever — `NaN != NaN` under a
    /// naive equality check would defeat write-on-change entirely.
    #[test]
    fn a_nan_value_does_not_re_emit_forever() {
        assert!(
            !should_emit(Some((f64::NAN, 10.0)), (f64::NAN, 10.0)),
            "an unchanged NaN must compare as unchanged"
        );
    }

    // ---- ingest-boundary validation ---------------------------------------

    #[test]
    fn a_coherent_observation_is_accepted() {
        assert_eq!(validate_observation(5.0, 10.0), Ok(()));
        assert_eq!(
            validate_observation(0.0, 0.0),
            Ok(()),
            "zero traffic is valid"
        );
        assert_eq!(validate_observation(10.0, 10.0), Ok(()));
    }

    #[test]
    fn non_finite_observations_are_rejected_before_persistence() {
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(
                matches!(
                    validate_observation(bad, 10.0),
                    Err(ObservationError::NotFinite { .. })
                ),
                "good={bad} accepted"
            );
            assert!(
                matches!(
                    validate_observation(1.0, bad),
                    Err(ObservationError::NotFinite { .. })
                ),
                "total={bad} accepted"
            );
        }
    }

    #[test]
    fn negative_observations_are_rejected() {
        assert!(matches!(
            validate_observation(-1.0, 10.0),
            Err(ObservationError::Negative { .. })
        ));
        assert!(matches!(
            validate_observation(1.0, -10.0),
            Err(ObservationError::Negative { .. })
        ));
    }

    /// More good units than total would put the SLI above 100% and the burn
    /// rate below zero.
    #[test]
    fn more_good_than_total_is_rejected() {
        assert_eq!(
            validate_observation(11.0, 10.0),
            Err(ObservationError::GoodExceedsTotal {
                good: 11.0,
                total: 10.0
            })
        );
    }
}

/// Tests for the config-aware gap-fill policy — the seam `absent_is_bad`
/// turns on. Written before the function exists.
#[cfg(test)]
mod gap_fill_policy_for_tests {
    use super::*;
    use crate::meta::{
        alerts::Operator,
        slo::{CountSource, QueryLanguage, SliConfig},
    };

    fn ts(absent_is_bad: bool) -> SliConfig {
        SliConfig::TimeSlice {
            stream: "s".into(),
            stream_type: "logs".into(),
            query_language: QueryLanguage::Sql,
            query: "count(*)".into(),
            scope: None,
            comparator: Operator::GreaterThanEquals,
            threshold: 1.0,
            absent_is_bad,
        }
    }

    /// The freshness semantics: a slice the search proved empty is BAD, not a
    /// gap. Only the POLICY changes — a failed search still writes nothing
    /// for every type, because gap fill runs only after a successful query.
    #[test]
    fn an_absent_is_bad_time_slice_fills_covered_bad() {
        assert_eq!(gap_fill_policy_for(&ts(true)), GapFill::CoveredBad);
    }

    /// Off keeps S-8 exactly: absence is a gap, coverage falls, the SLO
    /// freezes rather than inventing downtime.
    #[test]
    fn a_plain_time_slice_still_fills_nothing() {
        assert_eq!(gap_fill_policy_for(&ts(false)), GapFill::Nothing);
    }

    #[test]
    fn count_and_alert_policies_are_unchanged() {
        let count = SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "s".into(),
                stream_type: "logs".into(),
                scope: None,
                good_expr: "ok".into(),
            },
        };
        assert_eq!(gap_fill_policy_for(&count), GapFill::CoveredZero);
        assert_eq!(
            gap_fill_policy_for(&SliConfig::Alert {
                alert_id: "a".into()
            }),
            GapFill::Nothing
        );
        // The type-level answer stays for callers that have no config.
        assert_eq!(gap_fill_policy(SliType::Count), GapFill::CoveredZero);
        assert_eq!(gap_fill_policy(SliType::TimeSlice), GapFill::Nothing);
    }
}
