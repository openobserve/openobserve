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

//! The read-time view of an SLO's measurement (`alerts_2.md` §6b.4c, D56).
//!
//! Nothing here is stored. `slo_status` keeps only **target-free** raw
//! counts, and every number a user sees is derived from those plus the
//! *current* target — which is what lets a target edit take effect instantly
//! instead of invalidating 90 days of measurement.
//!
//! The other rule this type enforces is that **unmeasured time never reads as
//! uptime** (D34). Below the coverage floor the view reports `no_data` and
//! leaves the derived figures `None`, rather than reporting an SLI computed
//! from a fraction of the window as though it described all of it.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::math::{burn_rate, error_budget_remaining, sli, time_to_exhaust_secs};

/// What the UI and the API render for one SLO or one group.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SloStatusView {
    pub group_key: String,
    /// Fraction of the window actually measured, 0..1.
    pub coverage: f64,
    /// True when coverage is below the floor. Every derived figure is `None`
    /// in that case — the SLO is frozen, not healthy and not breached.
    pub no_data: bool,
    /// Percentage, 0..100. `None` when frozen or not yet measured.
    pub sli: Option<f64>,
    /// **Percentage** of the error budget still unspent, not a fraction.
    /// Negative once the budget is overspent, which is meaningful and
    /// deliberately not clamped: "-80% remaining" is what a user needs to see
    /// when they have burned 180% of the budget.
    pub error_budget_remaining: Option<f64>,
    /// Current burn rate — multiples of the budget-neutral rate.
    pub burn_rate: Option<f64>,
    /// Seconds until the budget is exhausted at the current burn. `None` when
    /// the burn is at or below neutral, because nothing is being exhausted.
    pub time_to_exhaust_secs: Option<i64>,
    pub good: f64,
    pub total: f64,
    pub covered_slices: i64,
    pub computed_at: Option<i64>,
}

impl SloStatusView {
    /// Derive the view from raw counts and the current target.
    pub fn derive(
        group_key: String,
        good: Option<f64>,
        total: Option<f64>,
        covered_slices: Option<i64>,
        expected_slices: i64,
        target: f64,
        window_secs: i64,
        coverage_floor: f64,
        computed_at: Option<i64>,
    ) -> Self {
        let good = good.unwrap_or(0.0);
        let total = total.unwrap_or(0.0);
        let covered = covered_slices.unwrap_or(0);
        let coverage = if expected_slices > 0 {
            (covered as f64 / expected_slices as f64).clamp(0.0, 1.0)
        } else {
            0.0
        };

        // Nothing measured yet is NOT the same as measured-and-empty. A brand
        // new SLO must not render as 0% available.
        let unmeasured = covered_slices.is_none() || covered == 0;
        let no_data = unmeasured || coverage < coverage_floor;

        let sli_pct = if no_data { None } else { sli(good, total) };
        let (budget, burn, ttl) = match sli_pct {
            Some(s) => {
                let remaining = error_budget_remaining(s, target);
                let b = burn_rate(s, target);
                (
                    Some(remaining),
                    Some(b),
                    time_to_exhaust_secs(window_secs, b),
                )
            }
            None => (None, None, None),
        };

        Self {
            group_key,
            coverage,
            no_data,
            sli: sli_pct,
            error_budget_remaining: budget,
            burn_rate: burn,
            time_to_exhaust_secs: ttl,
            good,
            total,
            covered_slices: covered,
            computed_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(
        good: Option<f64>,
        total: Option<f64>,
        covered: Option<i64>,
        expected: i64,
    ) -> SloStatusView {
        SloStatusView::derive(
            String::new(),
            good,
            total,
            covered,
            expected,
            99.0,
            30 * 86_400,
            0.9,
            Some(100),
        )
    }

    #[test]
    fn a_healthy_slo_derives_its_sli_and_budget() {
        let v = view(Some(999.0), Some(1000.0), Some(100), 100);
        assert!(!v.no_data);
        assert_eq!(v.sli, Some(99.9));
        // Target 99% allows 1% errors; 0.1% used leaves 90% of the budget.
        // A PERCENTAGE, matching `math::error_budget_remaining` — not 0.9.
        let remaining = v.error_budget_remaining.unwrap();
        assert!((remaining - 90.0).abs() < 1e-9, "got {remaining}");
    }

    /// The property the whole coverage mechanism exists for (D34).
    #[test]
    fn unmeasured_time_never_reads_as_uptime() {
        // Half the window measured, all of it good.
        let v = view(Some(50.0), Some(50.0), Some(50), 100);
        assert!(v.no_data, "50% coverage read as a real measurement");
        assert_eq!(v.sli, None, "an SLI was reported from half a window");
        assert_eq!(v.error_budget_remaining, None);
        assert_eq!(v.burn_rate, None);
    }

    #[test]
    fn coverage_exactly_at_the_floor_is_measured() {
        let v = view(Some(90.0), Some(90.0), Some(90), 100);
        assert!(!v.no_data, "the floor is inclusive");
        assert_eq!(v.sli, Some(100.0));
    }

    #[test]
    fn one_slice_below_the_floor_freezes() {
        let v = view(Some(89.0), Some(89.0), Some(89), 100);
        assert!(v.no_data);
    }

    /// "Not yet measured" and "measured as zero" are different, and a UI that
    /// conflates them shows a brand-new SLO as 0% available.
    #[test]
    fn a_brand_new_slo_is_no_data_not_zero_percent() {
        let v = view(None, None, None, 100);
        assert!(v.no_data);
        assert_eq!(v.sli, None);
        assert_eq!(v.coverage, 0.0);
    }

    #[test]
    fn a_fully_measured_but_empty_window_is_still_no_data() {
        // covered = 0 means nothing was observed, even if expected > 0.
        let v = view(Some(0.0), Some(0.0), Some(0), 100);
        assert!(v.no_data);
    }

    /// D56: the target is applied at READ time, so the same stored counts
    /// yield different budgets under different targets — with no rebuild.
    #[test]
    fn the_target_is_applied_at_read_time() {
        let counts = (Some(999.0), Some(1000.0), Some(100));
        let lenient = SloStatusView::derive(
            String::new(),
            counts.0,
            counts.1,
            counts.2,
            100,
            99.0,
            30 * 86_400,
            0.9,
            None,
        );
        let strict = SloStatusView::derive(
            String::new(),
            counts.0,
            counts.1,
            counts.2,
            100,
            99.95,
            30 * 86_400,
            0.9,
            None,
        );
        assert_eq!(lenient.sli, strict.sli, "the SLI is target-free");
        assert_ne!(
            lenient.error_budget_remaining, strict.error_budget_remaining,
            "the budget must move with the target"
        );
        assert!(
            strict.error_budget_remaining.unwrap() < 0.0,
            "99.9% against a 99.95% target has overspent its budget"
        );
    }

    /// Negative remaining budget is meaningful and deliberately not clamped:
    /// "180% consumed" is what a user needs to see.
    #[test]
    fn an_overspent_budget_reports_a_negative_remainder() {
        let v = SloStatusView::derive(
            String::new(),
            Some(980.0),
            Some(1000.0),
            Some(100),
            100,
            99.0,
            30 * 86_400,
            0.9,
            None,
        );
        let remaining = v.error_budget_remaining.unwrap();
        assert!(remaining < 0.0, "got {remaining}");
    }

    #[test]
    fn a_burn_at_or_below_neutral_never_exhausts() {
        // Exactly on target: burn = 1.0, so the budget lasts exactly the
        // window and nothing is being exhausted early.
        let v = SloStatusView::derive(
            String::new(),
            Some(990.0),
            Some(1000.0),
            Some(100),
            100,
            99.0,
            30 * 86_400,
            0.9,
            None,
        );
        assert_eq!(v.burn_rate, Some(1.0));

        // No errors at all: burn 0, nothing to exhaust.
        let perfect = view(Some(1000.0), Some(1000.0), Some(100), 100);
        assert_eq!(perfect.burn_rate, Some(0.0));
        assert_eq!(perfect.time_to_exhaust_secs, None);
    }

    #[test]
    fn coverage_is_clamped_to_one() {
        // More slices than expected (a late-data re-emission miscount) must
        // not report 130% coverage.
        let v = view(Some(1.0), Some(1.0), Some(130), 100);
        assert_eq!(v.coverage, 1.0);
    }

    #[test]
    fn a_zero_expected_window_does_not_divide_by_zero() {
        let v = view(Some(1.0), Some(1.0), Some(0), 0);
        assert_eq!(v.coverage, 0.0);
        assert!(v.no_data);
    }
}
