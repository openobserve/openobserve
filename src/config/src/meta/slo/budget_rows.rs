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

//! Row-budget arithmetic (`alerts_2.md` §6b.4d, S-14).
//!
//! The limit exists because `SLOs × GROUPS × window` is indefensible even
//! where each factor is individually fine: 100 SLOs × 500 groups × 90 days at
//! 5-minute slices is 1.3 **billion** rows, and every factor in that product
//! passes its own limit. So the budget is on the product.
//!
//! Two rules that look like details and are not:
//!
//! * **Priced at the horizon, not the window.** Slices live until retention regardless of how long
//!   the SLO's window is, so a 7-day SLO occupies the same storage as a 90-day one. Pricing by
//!   window would let an org buy unlimited storage by declaring short windows.
//! * **Physical, not logical.** Late data and recomputes re-emit rows; the dedupe happens at read
//!   time, not in storage. `ZO_SLO_REVISION_HEADROOM` prices that.

/// The retention horizon slices are priced against: the longest window plus
/// the 7-day grace that keeps a just-expired window readable.
pub const SLICE_HORIZON_SECS: i64 = 97 * 86_400;

/// Why a reservation could not be granted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BudgetError {
    /// The org's budget is already committed. Carries the arithmetic, because
    /// "quota exceeded" without numbers is unactionable — §6b.4d requires the
    /// rejection to show its working.
    OrgBudgetExceeded {
        requested: i64,
        active: i64,
        residual: i64,
        cap: i64,
    },
    /// The reservation itself is larger than any org could hold.
    RequestExceedsCap { requested: i64, cap: i64 },
}

impl std::fmt::Display for BudgetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OrgBudgetExceeded {
                requested,
                active,
                residual,
                cap,
            } => write!(
                f,
                "SLO would reserve {requested} slice rows; the org already holds \
                 {active} active + {residual} residual of a {cap} row budget \
                 ({} free)",
                (cap - active - residual).max(0)
            ),
            Self::RequestExceedsCap { requested, cap } => write!(
                f,
                "SLO would reserve {requested} slice rows, more than the entire \
                 {cap} row org budget"
            ),
        }
    }
}

impl std::error::Error for BudgetError {}

/// How many groups an SLO reserves.
///
/// `1` when ungrouped. Otherwise **twice** the preflight estimate, floored at
/// 64 and capped: the doubling is headroom for organic group growth, because
/// a reservation that exactly matched today's cardinality would trip the
/// moment one new region appeared.
pub fn groups_reserved(is_grouped: bool, estimate: Option<i64>, hard_cap: i64) -> i64 {
    if !is_grouped {
        return 1;
    }
    let doubled = estimate.unwrap_or(0).saturating_mul(2);
    doubled.clamp(64, hard_cap.max(64))
}

/// Logical rows an SLO reserves: groups × slices-to-the-horizon × revision
/// headroom.
///
/// Priced at the **horizon**, not the SLO's window — see the module note.
pub fn rows_for_reservation(
    groups_reserved: i64,
    slice_interval_secs: i64,
    revision_headroom: f64,
) -> i64 {
    if slice_interval_secs <= 0 {
        return 0;
    }
    let slices = SLICE_HORIZON_SECS / slice_interval_secs;
    let logical = groups_reserved.saturating_mul(slices);
    // Headroom below 1.0 would under-price; it is a multiplier for
    // re-emissions, not a discount.
    let headroom = revision_headroom.max(1.0);
    ((logical as f64) * headroom).ceil() as i64
}

/// Whether `requested` fits in the org's remaining budget.
///
/// Residual rows count against the cap. They are real storage — a superseded
/// generation's slices persist to the horizon whether or not anything reads
/// them — and not charging them would make delete-and-recreate an unlimited
/// storage loophole (S-14c).
pub fn check_headroom(
    requested: i64,
    active: i64,
    residual: i64,
    cap: i64,
) -> Result<(), BudgetError> {
    if requested > cap {
        return Err(BudgetError::RequestExceedsCap { requested, cap });
    }
    if active.saturating_add(residual).saturating_add(requested) > cap {
        return Err(BudgetError::OrgBudgetExceeded {
            requested,
            active,
            residual,
            cap,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAP: i64 = 250_000_000;

    // ===================== reservation sizing =============================

    #[test]
    fn an_ungrouped_slo_reserves_one_group() {
        assert_eq!(groups_reserved(false, None, 500), 1);
        // Even if an estimate somehow came back — ungrouped is one series.
        assert_eq!(groups_reserved(false, Some(400), 500), 1);
    }

    /// The doubling is headroom for organic growth: a reservation that exactly
    /// matched today's cardinality would trip the first time a new region
    /// appeared.
    #[test]
    fn a_grouped_slo_reserves_twice_its_estimate() {
        assert_eq!(groups_reserved(true, Some(100), 500), 200);
    }

    #[test]
    fn a_small_estimate_is_floored_at_64() {
        assert_eq!(groups_reserved(true, Some(3), 500), 64);
        assert_eq!(groups_reserved(true, Some(0), 500), 64);
        // No preflight result is not a licence to reserve nothing.
        assert_eq!(groups_reserved(true, None, 500), 64);
    }

    #[test]
    fn a_large_estimate_is_capped() {
        assert_eq!(groups_reserved(true, Some(10_000), 500), 500);
    }

    /// The floor must survive a hard cap set below it, or a misconfigured
    /// deployment would reserve less than the minimum.
    #[test]
    fn the_floor_wins_over_an_absurdly_low_cap() {
        assert_eq!(groups_reserved(true, Some(100), 10), 64);
    }

    #[test]
    fn a_huge_estimate_does_not_overflow() {
        assert_eq!(groups_reserved(true, Some(i64::MAX), 500), 500);
    }

    // ===================== row pricing ====================================

    /// The §6b.4d figure: an ungrouped 5-minute SLO is negligible.
    #[test]
    fn an_ungrouped_five_minute_slo_is_cheap() {
        // 97d / 5min = 27,936 slices.
        assert_eq!(rows_for_reservation(1, 300, 1.0), 27_936);
    }

    #[test]
    fn a_one_minute_slo_costs_five_times_a_five_minute_one() {
        assert_eq!(
            rows_for_reservation(1, 60, 1.0),
            rows_for_reservation(1, 300, 1.0) * 5
        );
    }

    /// Pricing by window rather than horizon would let an org buy unlimited
    /// storage by declaring short windows — the slices live to the horizon
    /// either way.
    #[test]
    fn the_price_does_not_depend_on_the_slo_window() {
        // There is no window parameter, and that is the point. Pinned as a
        // test so adding one is a deliberate act.
        let seven_day_slo = rows_for_reservation(64, 300, 1.0);
        let ninety_day_slo = rows_for_reservation(64, 300, 1.0);
        assert_eq!(seven_day_slo, ninety_day_slo);
    }

    #[test]
    fn revision_headroom_multiplies_and_rounds_up() {
        let base = rows_for_reservation(1, 300, 1.0);
        assert_eq!(
            rows_for_reservation(1, 300, 1.5),
            (base as f64 * 1.5).ceil() as i64
        );
    }

    /// Headroom prices re-emissions. A value below 1.0 would under-price them,
    /// so it is clamped rather than honoured.
    #[test]
    fn headroom_below_one_does_not_discount() {
        assert_eq!(
            rows_for_reservation(10, 300, 0.5),
            rows_for_reservation(10, 300, 1.0)
        );
    }

    #[test]
    fn a_nonsensical_slice_interval_prices_at_zero_rather_than_dividing_by_it() {
        assert_eq!(rows_for_reservation(10, 0, 1.0), 0);
        assert_eq!(rows_for_reservation(10, -300, 1.0), 0);
    }

    /// The product this whole budget exists to bound (§6b.4d): each factor
    /// passes its own limit, and together they are 1.3 billion rows.
    #[test]
    fn the_indefensible_product_is_rejected() {
        let per_slo = rows_for_reservation(500, 300, 1.0);
        let hundred_slos = per_slo * 100;
        assert!(
            hundred_slos > CAP,
            "100 x 500 groups x 97d @5m = {hundred_slos}, which must not fit \
             in a {CAP} row budget"
        );
    }

    // ===================== headroom check =================================

    #[test]
    fn a_reservation_that_fits_is_granted() {
        assert_eq!(check_headroom(1_000, 500, 500, CAP), Ok(()));
    }

    #[test]
    fn a_reservation_that_exactly_fills_the_budget_is_granted() {
        assert_eq!(check_headroom(10, 80, 10, 100), Ok(()));
    }

    #[test]
    fn one_row_past_the_budget_is_rejected() {
        assert_eq!(
            check_headroom(11, 80, 10, 100),
            Err(BudgetError::OrgBudgetExceeded {
                requested: 11,
                active: 80,
                residual: 10,
                cap: 100
            })
        );
    }

    /// Residual rows are real storage. Not charging them would make
    /// delete-and-recreate an unlimited storage loophole (S-14c).
    #[test]
    fn residual_rows_count_against_the_budget() {
        assert!(check_headroom(50, 0, 0, 100).is_ok());
        assert!(
            check_headroom(50, 0, 60, 100).is_err(),
            "a residual charge was ignored"
        );
    }

    #[test]
    fn a_request_larger_than_the_whole_budget_says_so_specifically() {
        assert_eq!(
            check_headroom(500, 0, 0, 100),
            Err(BudgetError::RequestExceedsCap {
                requested: 500,
                cap: 100
            })
        );
    }

    /// "Quota exceeded" without numbers is unactionable — §6b.4d requires the
    /// rejection to show its arithmetic.
    #[test]
    fn the_rejection_shows_its_arithmetic() {
        let msg = check_headroom(11, 80, 10, 100).unwrap_err().to_string();
        for part in ["11", "80", "10", "100"] {
            assert!(msg.contains(part), "{msg} omits {part}");
        }
    }

    #[test]
    fn the_free_figure_never_goes_negative_in_the_message() {
        // An org already over budget (a cap lowered under it) must still get a
        // sensible message rather than "-40 free".
        let msg = check_headroom(10, 90, 50, 100).unwrap_err().to_string();
        assert!(msg.contains("0 free"), "{msg}");
    }

    #[test]
    fn saturating_arithmetic_survives_absurd_inputs() {
        assert!(check_headroom(i64::MAX, i64::MAX, i64::MAX, CAP).is_err());
    }
}
