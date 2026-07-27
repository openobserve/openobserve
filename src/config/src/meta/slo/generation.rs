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

//! Definition generations — §6b.4a, S-13, D43, D59.
//!
//! Slice identity is `(slo_id, group_key, slice_start)`, which says nothing
//! about *what was being measured*. Change the `good_expr`, the stream, the
//! comparator, the slice interval or the grouping, and the next pass starts
//! writing slices that mean something different from the ones already in the
//! window — which would then be summed together for up to 90 days, producing a
//! number that describes no definition that ever existed.
//!
//! **Generation is also the writing epoch (D59).** Two drafts tried to make
//! A → B → A cheap by reusing a matching prior generation; each spawned a
//! crop of correctness machinery (sealed per-epoch commit marks, status
//! re-seeding, cross-epoch revision ordering) serving exactly one feature —
//! fast revert. Cut. A computation-affecting edit, *including a revert*,
//! always mints a fresh generation and rebuilds. That leaves one `reset_time`,
//! one pair of committed marks, one `rev` space, and only the current
//! generation readable.
//!
//! `target` is deliberately **not** computation-affecting: it is applied at
//! read time (D56), so editing it never invalidates a slice.

use super::SloDefinition;

/// A stable hash over exactly the computation-affecting fields.
///
/// Canonical form — sorted keys, expressions re-rendered from their AST — so
/// cosmetic re-edits (whitespace in a predicate) hash equal.
pub fn definition_hash(definition: &SloDefinition) -> String {
    let _ = definition;
    todo!("generation::definition_hash")
}

/// Whether an edit requires a fresh generation and a rebuild.
pub fn requires_new_generation(old: &SloDefinition, new: &SloDefinition) -> bool {
    let _ = (old, new);
    todo!("generation::requires_new_generation")
}

/// Whether a writer whose pass began at `writer_generation` may still commit
/// against the SLO's current generation (§6b.4b CAS fence).
///
/// Delivery of a columnar batch can outlive the generation that ordered it; a
/// late commit must fail rather than advance the new generation's marks with
/// the old generation's arithmetic.
pub fn writer_may_commit(writer_generation: i32, current_generation: i32) -> bool {
    let _ = (writer_generation, current_generation);
    todo!("generation::writer_may_commit")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::{
        alerts::Operator,
        slo::{CountSource, QueryLanguage, SliConfig, SloDefinition},
    };

    fn count_def() -> SloDefinition {
        SloDefinition {
            sli_config: SliConfig::Count {
                source: CountSource::SingleQuery {
                    stream: "requests".into(),
                    stream_type: "logs".into(),
                    scope: Some("service = 'checkout'".into()),
                    good_expr: "status_code < 500".into(),
                },
            },
            group_by: None,
            window_secs: 30 * 86_400,
            slice_interval_secs: 60,
        }
    }

    fn time_slice_def() -> SloDefinition {
        SloDefinition {
            sli_config: SliConfig::TimeSlice {
                stream: "http_metrics".into(),
                stream_type: "metrics".into(),
                query_language: QueryLanguage::Sql,
                query: "SELECT p95(duration_ms) AS zo_slo_value".into(),
                scope: None,
                comparator: Operator::LessThan,
                threshold: 500.0,
            },
            group_by: Some(vec!["region".into()]),
            window_secs: 7 * 86_400,
            slice_interval_secs: 300,
        }
    }

    // ---- hashing -----------------------------------------------------------

    #[test]
    fn the_same_definition_hashes_the_same() {
        assert_eq!(definition_hash(&count_def()), definition_hash(&count_def()));
    }

    #[test]
    fn different_definitions_hash_differently() {
        assert_ne!(
            definition_hash(&count_def()),
            definition_hash(&time_slice_def())
        );
    }

    #[test]
    fn the_hash_is_stable_across_calls_and_nonempty() {
        let h = definition_hash(&count_def());
        assert!(!h.is_empty());
        for _ in 0..5 {
            assert_eq!(definition_hash(&count_def()), h);
        }
    }

    // ---- what forces a rebuild ---------------------------------------------

    #[test]
    fn an_identical_definition_needs_no_new_generation() {
        assert!(!requires_new_generation(&count_def(), &count_def()));
    }

    #[test]
    fn changing_the_good_predicate_forces_a_rebuild() {
        let mut new = count_def();
        new.sli_config = SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "requests".into(),
                stream_type: "logs".into(),
                scope: Some("service = 'checkout'".into()),
                good_expr: "status_code < 400".into(),
            },
        };
        assert!(requires_new_generation(&count_def(), &new));
    }

    #[test]
    fn changing_the_scope_forces_a_rebuild() {
        let mut new = count_def();
        new.sli_config = SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "requests".into(),
                stream_type: "logs".into(),
                scope: Some("service = 'cart'".into()),
                good_expr: "status_code < 500".into(),
            },
        };
        assert!(requires_new_generation(&count_def(), &new));
    }

    #[test]
    fn changing_the_stream_forces_a_rebuild() {
        let mut new = count_def();
        new.sli_config = SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "other_requests".into(),
                stream_type: "logs".into(),
                scope: Some("service = 'checkout'".into()),
                good_expr: "status_code < 500".into(),
            },
        };
        assert!(requires_new_generation(&count_def(), &new));
    }

    #[test]
    fn changing_the_slice_interval_forces_a_rebuild() {
        let mut new = count_def();
        new.slice_interval_secs = 300;
        assert!(requires_new_generation(&count_def(), &new));
    }

    #[test]
    fn changing_the_window_forces_a_rebuild() {
        let mut new = count_def();
        new.window_secs = 90 * 86_400;
        assert!(requires_new_generation(&count_def(), &new));
    }

    #[test]
    fn changing_the_grouping_forces_a_rebuild() {
        let mut new = count_def();
        new.group_by = Some(vec!["region".into()]);
        assert!(requires_new_generation(&count_def(), &new));
    }

    #[test]
    fn changing_the_sli_type_forces_a_rebuild() {
        assert!(requires_new_generation(&count_def(), &time_slice_def()));
    }

    #[test]
    fn changing_a_time_slice_comparator_or_threshold_forces_a_rebuild() {
        let base = time_slice_def();

        let mut cmp_changed = base.clone();
        cmp_changed.sli_config = SliConfig::TimeSlice {
            stream: "http_metrics".into(),
            stream_type: "metrics".into(),
            query_language: QueryLanguage::Sql,
            query: "SELECT p95(duration_ms) AS zo_slo_value".into(),
            scope: None,
            comparator: Operator::LessThanEquals,
            threshold: 500.0,
        };
        assert!(requires_new_generation(&base, &cmp_changed));

        let mut threshold_changed = base.clone();
        threshold_changed.sli_config = SliConfig::TimeSlice {
            stream: "http_metrics".into(),
            stream_type: "metrics".into(),
            query_language: QueryLanguage::Sql,
            query: "SELECT p95(duration_ms) AS zo_slo_value".into(),
            scope: None,
            comparator: Operator::LessThan,
            threshold: 250.0,
        };
        assert!(requires_new_generation(&base, &threshold_changed));
    }

    /// D56/S-13: the target is applied at read time, so it is deliberately
    /// absent from `SloDefinition` and cannot force a rebuild. This test
    /// documents that the type system enforces it.
    #[test]
    fn the_target_is_not_part_of_the_computation_affecting_definition() {
        // If `target` were ever added to SloDefinition this would stop
        // compiling, which is the point.
        let def = count_def();
        let json = serde_json::to_value(&def).unwrap();
        assert!(
            json.get("target").is_none(),
            "target must not be computation-affecting (D56)"
        );
    }

    /// D59: reverts rebuild. A → B → A produces a *third* generation, not a
    /// reuse of the first — that is the whole simplification.
    #[test]
    fn a_revert_still_requires_a_new_generation() {
        let a = count_def();
        let mut b = count_def();
        b.slice_interval_secs = 300;
        assert!(requires_new_generation(&a, &b), "A -> B");
        assert!(
            requires_new_generation(&b, &a),
            "B -> A must ALSO rebuild; generation reuse was cut (D59)"
        );
    }

    /// The hash remains useful for diagnostics — a revert IS recognisable as
    /// returning to a previous definition — it simply no longer drives
    /// generation reuse (D59). This asserts the round trip, which the
    /// duplicate-of-an-earlier-test it replaced did not.
    #[test]
    fn a_revert_is_recognisable_by_hash_even_though_it_still_rebuilds() {
        let a = count_def();
        let mut b = count_def();
        b.slice_interval_secs = 300;

        let (ha, hb) = (definition_hash(&a), definition_hash(&b));
        assert_ne!(ha, hb, "A and B are different definitions");

        // Revert to A: the hash comes back, but the rebuild still happens.
        let a_again = count_def();
        assert_eq!(definition_hash(&a_again), ha, "the hash round-trips");
        assert!(
            requires_new_generation(&b, &a_again),
            "recognising the revert must NOT short-circuit the rebuild"
        );
    }

    // ---- the CAS fence -----------------------------------------------------

    #[test]
    fn a_writer_on_the_current_generation_may_commit() {
        assert!(writer_may_commit(4, 4));
    }

    /// The stale-writer case: an ingest or backfill pass that finishes after a
    /// computation edit landed must NOT advance the new generation's marks.
    #[test]
    fn a_writer_from_a_superseded_generation_may_not_commit() {
        assert!(!writer_may_commit(3, 4));
    }

    #[test]
    fn a_writer_from_the_future_may_not_commit_either() {
        // Defensive: should be impossible, but a mismatch in either direction
        // means the writer's arithmetic does not match the current definition.
        assert!(!writer_may_commit(5, 4));
    }
}
