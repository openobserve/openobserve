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

//! Grouped SLOs — the exact overall row and the two-tier cap (S-9, S-10, D46).
//!
//! The contradiction this module resolves: S-9 requires the overall row to
//! aggregate **every** group, while S-10 keeps at most a few hundred per-group
//! rows. Both are satisfied because the overall is computed **in the engine
//! over the full group set** and the cap truncates only which *per-group* rows
//! are persisted. Getting that wrong resolves in the direction that inflates
//! the SLO of the worst service.
//!
//! The other subtlety is the time-slice overall. It is not a plain
//! `MIN(good_flag)` over returned groups — that is blind to groups that
//! returned nothing. It is a **three-valued** MIN over the *expected* set,
//! ordered `Bad < Unknown < Good`, so a proven violation beats an unmeasured
//! group and an all-good-but-incomplete slice is uncovered rather than good.

/// A group's verdict for one slice, ordered by "how much it constrains the
/// overall". `Bad` wins because a proven violation is a violation regardless
/// of what else went unmeasured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SliceVerdict {
    /// The group was measured and violated the condition.
    Bad,
    /// The group was expected but produced no value — unmeasured.
    Unknown,
    /// The group was measured and satisfied the condition.
    Good,
}

/// The overall verdict for a time-slice SLO's slice: the three-valued MIN over
/// the **expected group set**.
///
/// Takes keyed observations and expected keys rather than a slice plus a
/// count. A count cannot tell expected `{a, b}` from observed `{a, a}` or
/// `{a, c}` — both have length 2 and would report `Good` while `b` went
/// entirely unmeasured, inflating the exact overall row that S-9 depends on.
///
/// * every expected key missing from `observed` contributes `Unknown`
/// * duplicate observations of one key collapse to their **worst** verdict
/// * keys observed but not expected (a group appearing mid-window, before the active set catches
///   up) do not fabricate absences and do not vote
pub fn overall_time_slice(
    observed: &[(String, SliceVerdict)],
    expected: &[String],
) -> SliceVerdict {
    let _ = (observed, expected);
    todo!("group::overall_time_slice")
}

/// The overall good/total for a **count** SLO: a straight sum across every
/// group, which is exactly the ungrouped query (S-9).
pub fn overall_count(groups: &[(f64, f64)]) -> (f64, f64) {
    let _ = groups;
    todo!("group::overall_count")
}

/// A candidate for the per-group status roster.
#[derive(Debug, Clone, PartialEq)]
pub struct RosterCandidate {
    pub group_key: String,
    /// Window SLI, aggregated from the persisted slices by the election pass.
    /// Lower is worse.
    pub sli: f64,
}

/// Elect the per-group status roster, worst-SLI-first with a deterministic
/// tie-break (S-10 tier 2).
///
/// This is possible only because tier 1 persists slices for *every* observed
/// group: ranking a group needs its window SLI, which needs slices that a
/// naive "cap the slices" design would already have discarded (D55).
pub fn elect_roster(candidates: Vec<RosterCandidate>, cap: usize) -> Vec<String> {
    let _ = (candidates, cap);
    todo!("group::elect_roster")
}

/// Whether the observed group count has crossed the hard cap, which freezes
/// per-group tracking while leaving the overall exact (S-10).
pub fn is_group_overflow(observed_groups: i64, hard_cap: i64) -> bool {
    let _ = (observed_groups, hard_cap);
    todo!("group::is_group_overflow")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(key: &str, sli: f64) -> RosterCandidate {
        RosterCandidate {
            group_key: key.into(),
            sli,
        }
    }

    // ---- verdict ordering --------------------------------------------------

    #[test]
    fn verdicts_are_ordered_bad_then_unknown_then_good() {
        assert!(SliceVerdict::Bad < SliceVerdict::Unknown);
        assert!(SliceVerdict::Unknown < SliceVerdict::Good);
    }

    // ---- the three-valued overall -----------------------------------------

    fn obs(pairs: &[(&str, SliceVerdict)]) -> Vec<(String, SliceVerdict)> {
        pairs.iter().map(|(k, v)| ((*k).to_string(), *v)).collect()
    }

    fn keys(ks: &[&str]) -> Vec<String> {
        ks.iter().map(|k| (*k).to_string()).collect()
    }

    #[test]
    fn all_groups_good_makes_the_slice_good() {
        let o = obs(&[
            ("a", SliceVerdict::Good),
            ("b", SliceVerdict::Good),
            ("c", SliceVerdict::Good),
        ]);
        assert_eq!(
            overall_time_slice(&o, &keys(&["a", "b", "c"])),
            SliceVerdict::Good
        );
    }

    #[test]
    fn any_bad_group_makes_the_slice_bad() {
        let o = obs(&[
            ("a", SliceVerdict::Good),
            ("b", SliceVerdict::Bad),
            ("c", SliceVerdict::Good),
        ]);
        assert_eq!(
            overall_time_slice(&o, &keys(&["a", "b", "c"])),
            SliceVerdict::Bad
        );
    }

    #[test]
    fn an_absent_group_makes_an_otherwise_good_slice_uncovered() {
        let o = obs(&[("a", SliceVerdict::Good), ("b", SliceVerdict::Good)]);
        assert_eq!(
            overall_time_slice(&o, &keys(&["a", "b", "c"])),
            SliceVerdict::Unknown,
            "c was expected and never reported — `all groups good` is unprovable"
        );
    }

    /// A count-based signature could not catch this: two observations of `a`
    /// and none of `b` has the same length as one each.
    #[test]
    fn a_duplicated_group_does_not_stand_in_for_a_missing_one() {
        let o = obs(&[("a", SliceVerdict::Good), ("a", SliceVerdict::Good)]);
        assert_eq!(
            overall_time_slice(&o, &keys(&["a", "b"])),
            SliceVerdict::Unknown,
            "b is unmeasured however many times a reported"
        );
    }

    /// Likewise an unexpected key must not fill an expected one's slot.
    #[test]
    fn an_unexpected_group_does_not_stand_in_for_a_missing_one() {
        let o = obs(&[("a", SliceVerdict::Good), ("zz", SliceVerdict::Good)]);
        assert_eq!(
            overall_time_slice(&o, &keys(&["a", "b"])),
            SliceVerdict::Unknown
        );
    }

    #[test]
    fn duplicate_observations_of_one_key_collapse_to_the_worst() {
        let o = obs(&[("a", SliceVerdict::Good), ("a", SliceVerdict::Bad)]);
        assert_eq!(
            overall_time_slice(&o, &keys(&["a"])),
            SliceVerdict::Bad,
            "a disagreeing duplicate must not be resolved optimistically"
        );
    }

    /// The invariant break a previous PRD draft had: if absence dominated
    /// badness, a bad group plus an absent sibling would make the slice
    /// *uncovered*, excluding it from the overall's denominator and letting
    /// the overall read HIGHER than the group.
    #[test]
    fn a_proven_violation_beats_an_unmeasured_sibling() {
        let o = obs(&[("a", SliceVerdict::Bad)]);
        assert_eq!(
            overall_time_slice(&o, &keys(&["a", "b"])),
            SliceVerdict::Bad,
            "absence must not mask a violation"
        );
    }

    #[test]
    fn the_overall_never_exceeds_the_worst_group() {
        // Ten slices; group A is bad in slice 3; group B is absent in slice 3.
        let expected = keys(&["a", "b"]);
        let mut a_good = 0;
        let mut overall_good = 0;
        let mut overall_measured = 0;
        for i in 0..10 {
            let o = if i == 3 {
                obs(&[("a", SliceVerdict::Bad)])
            } else {
                obs(&[("a", SliceVerdict::Good), ("b", SliceVerdict::Good)])
            };
            if o.iter().any(|(k, v)| k == "a" && *v == SliceVerdict::Good) {
                a_good += 1;
            }
            match overall_time_slice(&o, &expected) {
                SliceVerdict::Good => {
                    overall_good += 1;
                    overall_measured += 1;
                }
                SliceVerdict::Bad => overall_measured += 1,
                SliceVerdict::Unknown => {}
            }
        }
        let a_sli = a_good as f64 / 10.0;
        let overall_sli = overall_good as f64 / overall_measured as f64;
        assert!(
            overall_sli <= a_sli,
            "overall {overall_sli} exceeded group A {a_sli} — S-9 invariant broken"
        );
    }

    #[test]
    fn an_empty_expected_set_is_unknown_not_good() {
        assert_eq!(overall_time_slice(&[], &[]), SliceVerdict::Unknown);
    }

    #[test]
    fn every_group_absent_is_unknown() {
        assert_eq!(
            overall_time_slice(&[], &keys(&["a", "b", "c"])),
            SliceVerdict::Unknown
        );
    }

    /// A group that reported before the active set caught up must not make the
    /// slice uncovered.
    #[test]
    fn extra_observations_do_not_fabricate_absences() {
        let o = obs(&[
            ("a", SliceVerdict::Good),
            ("b", SliceVerdict::Good),
            ("c", SliceVerdict::Good),
        ]);
        assert_eq!(
            overall_time_slice(&o, &keys(&["a", "b"])),
            SliceVerdict::Good
        );
    }

    #[test]
    fn an_unexpected_group_does_not_vote_bad() {
        // `zz` is not in the active set; its verdict must not drag the overall
        // down before the roster admits it.
        let o = obs(&[("a", SliceVerdict::Good), ("zz", SliceVerdict::Bad)]);
        assert_eq!(overall_time_slice(&o, &keys(&["a"])), SliceVerdict::Good);
    }

    // ---- count overall -----------------------------------------------------

    #[test]
    fn count_overall_sums_every_group() {
        let (good, total) = overall_count(&[(90.0, 100.0), (8.0, 10.0), (1.0, 1.0)]);
        assert_eq!((good, total), (99.0, 111.0));
    }

    /// S-9: the count overall is `Σgood / Σtotal`, which weights by traffic —
    /// NOT the mean of the per-group ratios.
    #[test]
    fn count_overall_is_traffic_weighted_not_an_average_of_ratios() {
        // A tiny perfect group must not drag a huge broken one up.
        let (good, total) = overall_count(&[(0.0, 1_000_000.0), (1.0, 1.0)]);
        let overall = 100.0 * good / total;
        let mean_of_ratios: f64 = (0.0 + 100.0) / 2.0;
        assert!(overall < 0.01);
        assert!(
            (mean_of_ratios - 50.0).abs() < 1e-9 && overall < mean_of_ratios,
            "averaging ratios would report 50%"
        );
    }

    #[test]
    fn count_overall_of_nothing_is_zero_zero() {
        assert_eq!(overall_count(&[]), (0.0, 0.0));
    }

    // ---- roster election ---------------------------------------------------

    #[test]
    fn the_roster_keeps_the_worst_groups() {
        let out = elect_roster(
            vec![
                cand("a", 99.9),
                cand("b", 98.0),
                cand("c", 99.99),
                cand("d", 95.0),
            ],
            2,
        );
        assert_eq!(out, vec!["d".to_string(), "b".to_string()]);
    }

    #[test]
    fn the_roster_is_capped() {
        let cands: Vec<_> = (0..100)
            .map(|i| cand(&format!("g{i:03}"), 99.0 - i as f64 * 0.01))
            .collect();
        assert_eq!(elect_roster(cands, 10).len(), 10);
    }

    #[test]
    fn a_roster_smaller_than_the_cap_keeps_everything() {
        let out = elect_roster(vec![cand("a", 99.0), cand("b", 98.0)], 500);
        assert_eq!(out.len(), 2);
    }

    /// Determinism matters: an unstable roster would churn which groups can
    /// page between elections.
    #[test]
    fn ties_break_deterministically_on_the_group_key() {
        let out = elect_roster(
            vec![cand("zebra", 99.0), cand("alpha", 99.0), cand("mike", 99.0)],
            2,
        );
        assert_eq!(out, vec!["alpha".to_string(), "mike".to_string()]);
    }

    #[test]
    fn election_is_order_independent() {
        let forward = elect_roster(vec![cand("a", 99.0), cand("b", 98.0), cand("c", 97.0)], 2);
        let reverse = elect_roster(vec![cand("c", 97.0), cand("b", 98.0), cand("a", 99.0)], 2);
        assert_eq!(forward, reverse);
    }

    #[test]
    fn a_zero_cap_elects_nobody() {
        assert!(elect_roster(vec![cand("a", 1.0)], 0).is_empty());
    }

    // ---- overflow ----------------------------------------------------------

    #[test]
    fn observed_groups_under_the_hard_cap_do_not_overflow() {
        assert!(!is_group_overflow(9_999, 10_000));
        assert!(!is_group_overflow(10_000, 10_000));
    }

    #[test]
    fn observed_groups_past_the_hard_cap_overflow() {
        assert!(is_group_overflow(10_001, 10_000));
    }
}
