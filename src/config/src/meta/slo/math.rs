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

//! The normative SLO math — `alerts_2.md` §6b.6a.
//!
//! Stated once, here, and derived everywhere else. Every number the UI shows
//! and every threshold comparison an SLO alert makes comes through these
//! functions.
//!
//! ```text
//! sli(R)          = 100 × Σgood / Σtotal          undefined if Σtotal = 0 (SA-18)
//! error_rate(R)   = 100 − sli(R)
//! burn_rate(R)    = error_rate(R) / (100 − target)
//! max_burn_rate   = 100 / (100 − target)          the SA-6 cap
//!
//! over the full window W:
//!   consumed%  = 100 × burn_rate(W)
//!   remaining% = 100 − consumed%
//! ```
//!
//! The last identity matters: **error-budget consumption and burn rate are the
//! same quantity at two scalings**, differing only in the window they are read
//! over. That is why one evaluator serves both SLO-alert kinds.

/// SLI as a percentage. `None` when there is nothing to divide by — a covered
/// window with zero events is *not* 100% and *not* 0%, it is undefined, and
/// SA-18 turns that into "unobserved" rather than a recovery.
pub fn sli(good: f64, total: f64) -> Option<f64> {
    // `<= 0` rather than `== 0`: a negative total is corruption, not a 0% SLI.
    // NaN is checked explicitly — it must not reach the division either.
    if total.is_nan() || total <= 0.0 {
        return None;
    }
    Some(100.0 * good / total)
}

/// Error rate as a percentage: the complement of the SLI.
pub fn error_rate(sli: f64) -> f64 {
    100.0 - sli
}

/// Burn rate: observed error rate divided by the budgeted error rate.
///
/// 1.0 means the budget lands exactly at the window's end. 14.4 over a 30-day
/// SLO exhausts it in about two days.
pub fn burn_rate(sli: f64, target: f64) -> f64 {
    error_rate(sli) / (100.0 - target)
}

/// The largest burn rate physically reachable for a target — `1/(1 − target)`.
/// A threshold above this needs an error rate over 100% and can never fire
/// (SA-6).
pub fn max_burn_rate(target: f64) -> f64 {
    // Identically `burn_rate(0.0, target)` — the burn rate of a totally failed
    // window. Written out so the SA-6 cap reads as its own idea.
    100.0 / (100.0 - target)
}

/// Percentage of the error budget consumed over the full window.
/// Identically `100 × burn_rate(window)`.
pub fn error_budget_consumed(sli_window: f64, target: f64) -> f64 {
    100.0 * burn_rate(sli_window, target)
}

/// Percentage of the error budget remaining — **signed**. A blown budget reads
/// negative and is rendered that way; it is never clamped to zero (S-6).
pub fn error_budget_remaining(sli_window: f64, target: f64) -> f64 {
    100.0 - error_budget_consumed(sli_window, target)
}

/// How long the window's budget lasts at a sustained burn rate:
/// `window / burn`. `None` when the burn rate is zero or negative — the budget
/// is not being consumed at all.
pub fn time_to_exhaust_secs(window_secs: i64, burn: f64) -> Option<i64> {
    // NaN is checked explicitly — it must not reach the division.
    if burn.is_nan() || burn <= 0.0 {
        return None;
    }
    Some((window_secs as f64 / burn) as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The §9 accuracy gate is 0.001 percentage points; these are closed-form
    /// identities, so the tests hold themselves several orders tighter.
    const EPS: f64 = 1e-9;

    /// Absolute for small values, **relative** for large ones.
    ///
    /// A flat `1e-9` was tighter than f64 can represent for the larger
    /// quantities here: `max_burn_rate(99.99)` is `9999.999999994885`, off by
    /// 5.1e-9 purely from `100.0 - 99.99` not being exact. That is a
    /// representation limit, not an arithmetic error — the relative error is
    /// 5e-13 — and it is well inside the §9 gate. Asserting a flat epsilon
    /// against a four-digit multiplier was the mistake.
    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() <= EPS.max(b.abs() * 1e-12)
    }

    // ---- sli ---------------------------------------------------------------

    #[test]
    fn sli_is_the_good_fraction_as_a_percentage() {
        assert!(close(sli(999.0, 1000.0).unwrap(), 99.9));
        assert!(close(sli(1.0, 2.0).unwrap(), 50.0));
    }

    #[test]
    fn sli_of_a_perfect_window_is_exactly_one_hundred() {
        assert_eq!(sli(1000.0, 1000.0), Some(100.0));
    }

    #[test]
    fn sli_of_a_totally_failed_window_is_exactly_zero() {
        assert_eq!(sli(0.0, 1000.0), Some(0.0));
    }

    /// SA-18: a covered window with no events is *undefined*, not zero and not
    /// a hundred. Returning a number here is how "traffic stopped entirely"
    /// silently clears a page.
    #[test]
    fn sli_is_undefined_when_total_is_zero() {
        assert_eq!(sli(0.0, 0.0), None);
    }

    #[test]
    fn sli_is_undefined_for_a_negative_total() {
        // Defensive: totals are counts or seconds and cannot be negative; if
        // one ever is, that is corruption, not a 0% SLI.
        assert_eq!(sli(0.0, -1.0), None);
    }

    // ---- error_rate --------------------------------------------------------

    #[test]
    fn error_rate_is_the_complement_of_the_sli() {
        assert!(close(error_rate(99.9), 0.1));
        assert!(close(error_rate(100.0), 0.0));
        assert!(close(error_rate(0.0), 100.0));
    }

    // ---- burn_rate ---------------------------------------------------------

    /// The §6b.6a sanity checks, encoded.
    #[test]
    fn burn_rate_is_zero_for_a_perfect_sli() {
        assert!(close(burn_rate(100.0, 99.9), 0.0));
    }

    #[test]
    fn burn_rate_is_one_when_the_sli_sits_exactly_on_target() {
        assert!(close(burn_rate(99.9, 99.9), 1.0));
        assert!(close(burn_rate(99.0, 99.0), 1.0));
        assert!(close(burn_rate(95.0, 95.0), 1.0));
    }

    #[test]
    fn burn_rate_of_a_totally_failed_window_equals_the_max() {
        assert!(close(burn_rate(0.0, 99.9), max_burn_rate(99.9)));
        assert!(close(burn_rate(0.0, 99.0), max_burn_rate(99.0)));
    }

    /// Datadog's headline example: 14.4 over a 30-day SLO.
    #[test]
    fn burn_rate_matches_the_datadog_worked_example() {
        // A 99.9% target has a 0.1% budget. An observed error rate of 1.44%
        // is 14.4× the budgeted rate.
        assert!(close(burn_rate(100.0 - 1.44, 99.9), 14.4));
    }

    #[test]
    fn burn_rate_scales_linearly_with_the_error_rate() {
        let a = burn_rate(99.0, 99.9); // 1% errors
        let b = burn_rate(98.0, 99.9); // 2% errors
        assert!(close(b, a * 2.0));
    }

    // ---- max_burn_rate -----------------------------------------------------

    #[test]
    fn max_burn_rate_is_the_reciprocal_of_the_budget() {
        assert!(close(max_burn_rate(99.0), 100.0));
        assert!(close(max_burn_rate(99.9), 1000.0));
        assert!(close(max_burn_rate(99.99), 10_000.0));
        assert!(close(max_burn_rate(90.0), 10.0));
    }

    /// SA-6's direction, which an earlier PRD draft had inverted: TIGHTENING a
    /// target RAISES the ceiling, so it can never strand an existing
    /// threshold. Loosening is the dangerous direction.
    #[test]
    fn tightening_the_target_raises_the_max_burn_rate() {
        assert!(max_burn_rate(99.9) > max_burn_rate(99.0));
    }

    #[test]
    fn loosening_the_target_lowers_the_max_burn_rate() {
        // 99.9 -> 99.0 drops the ceiling from 1000 to 100, which can strand a
        // saved threshold of 500 as permanently unfireable.
        let before = max_burn_rate(99.9);
        let after = max_burn_rate(99.0);
        assert!(after < before);
        assert!(500.0 <= before && 500.0 > after);
    }

    #[test]
    fn no_reachable_burn_rate_exceeds_the_max() {
        for target in [90.0, 99.0, 99.9, 99.99] {
            for sli_v in [0.0, 1.0, 50.0, 99.0, 100.0] {
                assert!(
                    burn_rate(sli_v, target) <= max_burn_rate(target) + EPS,
                    "burn({sli_v}, {target}) exceeded the max"
                );
            }
        }
    }

    // ---- error budget ------------------------------------------------------

    #[test]
    fn a_perfect_window_consumes_no_budget_and_leaves_all_of_it() {
        assert!(close(error_budget_consumed(100.0, 99.9), 0.0));
        assert!(close(error_budget_remaining(100.0, 99.9), 100.0));
    }

    #[test]
    fn sitting_exactly_on_target_consumes_the_whole_budget() {
        assert!(close(error_budget_consumed(99.9, 99.9), 100.0));
        assert!(close(error_budget_remaining(99.9, 99.9), 0.0));
    }

    /// S-6: remaining is SIGNED. Clamping it to zero hides how deep the hole
    /// is, which is the number an SRE actually needs.
    #[test]
    fn a_blown_budget_reports_negative_remaining() {
        // 99.8% against a 99.9% target = twice the budget spent.
        let remaining = error_budget_remaining(99.8, 99.9);
        assert!(remaining < 0.0, "expected negative, got {remaining}");
        assert!(close(remaining, -100.0));
    }

    #[test]
    fn consumed_and_remaining_always_sum_to_one_hundred() {
        for (sli_v, target) in [(100.0, 99.9), (99.95, 99.9), (99.9, 99.9), (99.5, 99.9)] {
            let sum = error_budget_consumed(sli_v, target) + error_budget_remaining(sli_v, target);
            assert!(close(sum, 100.0), "sli={sli_v} target={target} sum={sum}");
        }
    }

    /// The identity that lets one evaluator serve both alert kinds: an
    /// error-budget alert is a burn-rate read over the whole window, ×100.
    #[test]
    fn consumed_is_exactly_one_hundred_times_the_window_burn_rate() {
        for (sli_v, target) in [(99.95, 99.9), (99.5, 99.9), (98.0, 99.0), (100.0, 95.0)] {
            assert!(
                close(
                    error_budget_consumed(sli_v, target),
                    100.0 * burn_rate(sli_v, target)
                ),
                "identity failed for sli={sli_v} target={target}"
            );
        }
    }

    // ---- time to exhaust ---------------------------------------------------

    #[test]
    fn budget_lasts_exactly_the_window_at_burn_rate_one() {
        let window = 30 * 86_400;
        assert_eq!(time_to_exhaust_secs(window, 1.0), Some(window));
    }

    /// Datadog's stated example: 14.4 exhausts a 30-day budget in ~2 days.
    #[test]
    fn burn_rate_fourteen_point_four_exhausts_thirty_days_in_about_two() {
        let secs = time_to_exhaust_secs(30 * 86_400, 14.4).unwrap();
        let days = secs as f64 / 86_400.0;
        assert!((days - 2.083).abs() < 0.01, "got {days} days");
    }

    #[test]
    fn a_higher_burn_rate_exhausts_the_budget_sooner() {
        let w = 30 * 86_400;
        assert!(time_to_exhaust_secs(w, 14.4).unwrap() < time_to_exhaust_secs(w, 3.0).unwrap());
    }

    #[test]
    fn a_zero_burn_rate_never_exhausts_the_budget() {
        assert_eq!(time_to_exhaust_secs(30 * 86_400, 0.0), None);
    }

    #[test]
    fn a_negative_burn_rate_never_exhausts_the_budget() {
        assert_eq!(time_to_exhaust_secs(30 * 86_400, -1.0), None);
    }

    // ---- cross-checks ------------------------------------------------------

    /// Every suggested Datadog row should spend the documented fraction of the
    /// budget over its long window.
    ///
    /// Derived through `burn_rate` and `error_budget_consumed` rather than from
    /// literals: an earlier version of this test did the arithmetic inline and
    /// would have passed with every function in this module returning zero.
    #[test]
    fn datadog_suggested_rows_consume_the_documented_budget_fraction() {
        // (slo window days, burn, long window hours, documented budget %)
        let rows: [(f64, f64, f64, f64); 9] = [
            (30.0, 14.4, 1.0, 2.0),
            (30.0, 6.0, 6.0, 5.0),
            (30.0, 3.0, 24.0, 10.0),
            (7.0, 16.8, 1.0, 10.0),
            (7.0, 5.6, 6.0, 20.0),
            (7.0, 2.8, 24.0, 40.0),
            (90.0, 21.6, 1.0, 1.0),
            (90.0, 10.8, 6.0, 3.0),
            (90.0, 4.5, 24.0, 5.0),
        ];
        let target = 99.9;
        for (window_days, burn, long_hours, budget_pct) in rows {
            // Invert the burn rate to the SLI that would produce it, then push
            // that SLI back through the real functions.
            let sli_v = 100.0 - burn * (100.0 - target);
            assert!(
                close(burn_rate(sli_v, target), burn),
                "burn_rate did not round-trip for {burn}"
            );

            // Budget spent over the long window = consumed% × (long / window).
            let consumed_over_window = error_budget_consumed(sli_v, target);
            let fraction = consumed_over_window * (long_hours / 24.0) / window_days;
            assert!(
                (fraction - budget_pct).abs() < 1e-6,
                "burn {burn} over {long_hours}h of a {window_days}d SLO spends {fraction:.4}%, \
                 Datadog documents {budget_pct}%"
            );
        }
    }

    /// The exhaustion helper must agree with the same rows: window ÷ burn.
    #[test]
    fn datadog_suggested_rows_exhaust_the_budget_over_their_long_window() {
        // At burn B, the budget lasts window/B. Firing after `long` hours means
        // the fraction spent is long / (window/B) — the check above, restated
        // through time_to_exhaust_secs.
        let window_secs = 30 * 86_400;
        let secs = time_to_exhaust_secs(window_secs, 14.4).unwrap();
        let spent_in_one_hour = 3600.0 / secs as f64;
        assert!(
            (spent_in_one_hour * 100.0 - 2.0).abs() < 0.01,
            "expected ~2% of the budget in 1h, got {:.3}%",
            spent_in_one_hour * 100.0
        );
    }
}
