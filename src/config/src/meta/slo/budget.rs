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

//! The per-org slice budget — S-14, D57.
//!
//! `ZO_SLO_MAX_PER_ORG` (200) and `ZO_SLO_MAX_GROUPS` (500) are each
//! defensible alone; their **product is not** — 200 × 500 groups over the
//! 97-day horizon is billions of rows. So the binding limit is on the product,
//! and it is charged three ways that a naive design gets wrong:
//!
//! * **Reservations, not estimates.** A save-time check is bypassable by organic group growth: a
//!   1-group SLO can grow to thousands with no further save to check it at.
//! * **Residuals, not instant release.** A superseded generation's rows and a deleted SLO's rows
//!   stay in the stream until the horizon, so releasing the charge at delete time lets
//!   create/backfill/delete cycles exceed the budget arbitrarily.
//! * **Logical rows with priced headroom.** The stream also holds late-data re-emissions, so the
//!   budget is over *logical* `(group, slice)` rows with a revision multiplier — not a physical-row
//!   invariant the formula cannot honestly deliver.

/// Stream retention horizon: max window (90d) + 7d margin (D57).
pub const RETENTION_HORIZON_SECS: i64 = 97 * 86_400;

/// Reserved groups for an SLO (S-14a).
///
/// An ungrouped SLO reserves exactly **1** — it can never grow a second
/// series, and an unconditional floor would charge it ~1.79M rows, letting 200
/// ungrouped SLOs exceed the whole default budget.
pub fn groups_reserved(is_grouped: bool, groups_estimate: i64, hard_cap: i64) -> i64 {
    let _ = (is_grouped, groups_estimate, hard_cap);
    todo!("budget::groups_reserved")
}

/// Logical slice rows a reservation costs at the retention horizon, including
/// the revision headroom multiplier.
pub fn rows_charged(groups_reserved: i64, slice_interval_secs: i64, revision_headroom: f64) -> i64 {
    let _ = (groups_reserved, slice_interval_secs, revision_headroom);
    todo!("budget::rows_charged")
}

/// A charge's lifecycle state (S-14c).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChargeState {
    /// The SLO/generation is live and writing.
    Active,
    /// Superseded or deleted; the rows persist until they age out.
    Residual { expires_at: i64 },
}

/// One row of `slo_budget_charges`.
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetCharge {
    pub slo_id: String,
    pub generation: i32,
    pub rows_charged: i64,
    pub state: ChargeState,
}

/// Convert a charge to a residual expiring one horizon after its last write.
pub fn to_residual(charge: BudgetCharge, last_write_secs: i64) -> BudgetCharge {
    let _ = (charge, last_write_secs);
    todo!("budget::to_residual")
}

/// Total rows an org currently owes: active reservations plus unexpired
/// residuals.
pub fn org_usage(charges: &[BudgetCharge], now_secs: i64) -> i64 {
    let _ = (charges, now_secs);
    todo!("budget::org_usage")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BudgetError {
    /// The org would exceed its slice budget. Carries the arithmetic so the
    /// 400 can show it.
    OrgBudgetExceeded {
        requested: i64,
        in_use: i64,
        limit: i64,
    },
    /// The preflight estimate is above the hard cardinality cap.
    HardCapExceeded { estimate: i64, hard_cap: i64 },
}

/// Whether a new charge fits.
pub fn can_admit(
    charges: &[BudgetCharge],
    requested_rows: i64,
    limit: i64,
    now_secs: i64,
) -> Result<(), BudgetError> {
    let _ = (charges, requested_rows, limit, now_secs);
    todo!("budget::can_admit")
}

/// Whether the ingest job may raise a reservation in place, or must trip
/// `GroupOverflow` (S-14b).
pub fn can_raise_reservation(
    charges: &[BudgetCharge],
    slo_id: &str,
    generation: i32,
    new_rows: i64,
    limit: i64,
    now_secs: i64,
) -> bool {
    let _ = (charges, slo_id, generation, new_rows, limit, now_secs);
    todo!("budget::can_raise_reservation")
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADROOM: f64 = 1.5;
    const HARD_CAP: i64 = 10_000;

    fn active(id: &str, generation: i32, rows: i64) -> BudgetCharge {
        BudgetCharge {
            slo_id: id.into(),
            generation,
            rows_charged: rows,
            state: ChargeState::Active,
        }
    }

    // ---- reservations ------------------------------------------------------

    /// S-14a: the fix for the unconditional 64-floor, which charged every
    /// ungrouped SLO ~1.79M rows.
    #[test]
    fn an_ungrouped_slo_reserves_exactly_one_group() {
        assert_eq!(groups_reserved(false, 1, HARD_CAP), 1);
        assert_eq!(
            groups_reserved(false, 500, HARD_CAP),
            1,
            "an ungrouped SLO can never grow a second series"
        );
    }

    #[test]
    fn a_grouped_slo_reserves_double_the_estimate() {
        assert_eq!(groups_reserved(true, 200, HARD_CAP), 400);
    }

    #[test]
    fn a_grouped_reservation_has_a_floor_of_sixty_four() {
        assert_eq!(groups_reserved(true, 5, HARD_CAP), 64);
        assert_eq!(groups_reserved(true, 1, HARD_CAP), 64);
    }

    #[test]
    fn a_grouped_reservation_is_clamped_at_the_hard_cap() {
        assert_eq!(groups_reserved(true, 9_000, HARD_CAP), HARD_CAP);
    }

    #[test]
    fn two_hundred_ungrouped_slos_fit_comfortably_in_the_default_budget() {
        let per_slo = rows_charged(groups_reserved(false, 1, HARD_CAP), 300, HEADROOM);
        let total = per_slo * 200;
        assert!(
            total < 250_000_000,
            "200 ungrouped SLOs charged {total}, over the 250M default"
        );
    }

    // ---- row arithmetic ----------------------------------------------------

    #[test]
    fn rows_are_charged_at_the_horizon_not_the_slo_window() {
        // D57: retention is global, so a 7-day SLO's slices still live 97 days.
        let rows = rows_charged(1, 300, 1.0);
        assert_eq!(rows, RETENTION_HORIZON_SECS / 300);
        assert_eq!(rows, 27_936);
    }

    #[test]
    fn a_finer_slice_interval_charges_proportionally_more() {
        assert_eq!(rows_charged(1, 60, 1.0), rows_charged(1, 300, 1.0) * 5);
    }

    #[test]
    fn the_headroom_multiplier_prices_late_data_re_emissions() {
        let bare = rows_charged(10, 300, 1.0);
        let with_headroom = rows_charged(10, 300, 1.5);
        assert_eq!(with_headroom, (bare as f64 * 1.5) as i64);
    }

    #[test]
    fn a_five_hundred_group_slo_charges_the_documented_magnitude() {
        // §6b.4d: ~14M logical rows steady state at the horizon.
        let rows = rows_charged(500, 300, 1.0);
        assert!(
            (13_000_000..15_000_000).contains(&rows),
            "expected ~14M, got {rows}"
        );
    }

    // ---- admission ---------------------------------------------------------

    #[test]
    fn a_charge_that_fits_is_admitted() {
        assert!(can_admit(&[active("a", 1, 100)], 50, 1_000, 0).is_ok());
    }

    #[test]
    fn a_charge_that_would_exceed_the_limit_is_rejected_with_the_arithmetic() {
        let err = can_admit(&[active("a", 1, 900)], 200, 1_000, 0).unwrap_err();
        assert_eq!(
            err,
            BudgetError::OrgBudgetExceeded {
                requested: 200,
                in_use: 900,
                limit: 1_000
            }
        );
    }

    #[test]
    fn admission_is_exact_at_the_limit() {
        assert!(can_admit(&[active("a", 1, 900)], 100, 1_000, 0).is_ok());
        assert!(can_admit(&[active("a", 1, 900)], 101, 1_000, 0).is_err());
    }

    // ---- residuals: the create/delete cycling bypass ------------------------

    #[test]
    fn a_deleted_slo_becomes_a_residual_rather_than_releasing_immediately() {
        let charge = to_residual(active("a", 1, 100), 1_000);
        assert_eq!(
            charge.state,
            ChargeState::Residual {
                expires_at: 1_000 + RETENTION_HORIZON_SECS
            }
        );
    }

    #[test]
    fn an_unexpired_residual_still_counts_against_the_org() {
        let charges = vec![to_residual(active("a", 1, 500), 1_000)];
        assert_eq!(org_usage(&charges, 1_000 + 86_400), 500);
    }

    #[test]
    fn an_expired_residual_stops_counting() {
        let charges = vec![to_residual(active("a", 1, 500), 1_000)];
        assert_eq!(org_usage(&charges, 1_000 + RETENTION_HORIZON_SECS + 1), 0);
    }

    /// The bypass residuals exist to close: without them, create → backfill →
    /// delete in a loop consumes unbounded storage while the budget reads
    /// zero.
    #[test]
    fn create_delete_cycling_cannot_exceed_the_budget() {
        let mut charges = Vec::new();
        let mut now = 0;
        for i in 0..10 {
            let c = active(&format!("slo{i}"), 1, 200);
            // Admission must see the residuals from every prior cycle.
            let admitted = can_admit(&charges, 200, 1_000, now).is_ok();
            if admitted {
                charges.push(to_residual(c, now));
            }
            now += 3_600;
        }
        let live = org_usage(&charges, now);
        assert!(
            live <= 1_000,
            "cycling accumulated {live} rows against a 1,000 limit"
        );
        assert!(
            charges.len() < 10,
            "some creates must have been rejected; {} were admitted",
            charges.len()
        );
    }

    /// The other bypass: repeated computation edits, each leaving a full
    /// superseded generation behind.
    #[test]
    fn repeated_generation_bumps_accumulate_residual_charges() {
        let mut charges = vec![];
        for generation in 1..=3 {
            charges.push(to_residual(
                active("a", generation, 300),
                (generation as i64) * 60,
            ));
        }
        assert_eq!(
            org_usage(&charges, 1_000),
            900,
            "all three generations' rows are still in the stream"
        );
    }

    #[test]
    fn a_superseded_generation_and_its_successor_are_both_charged() {
        let charges = vec![to_residual(active("a", 1, 300), 100), active("a", 2, 300)];
        assert_eq!(org_usage(&charges, 200), 600);
    }

    // ---- runtime reservation raises ----------------------------------------

    #[test]
    fn a_reservation_can_be_raised_when_the_org_has_headroom() {
        let charges = vec![active("a", 1, 100)];
        assert!(can_raise_reservation(&charges, "a", 1, 300, 1_000, 0));
    }

    #[test]
    fn a_reservation_cannot_be_raised_past_the_org_limit() {
        let charges = vec![active("a", 1, 100), active("b", 1, 800)];
        assert!(
            !can_raise_reservation(&charges, "a", 1, 500, 1_000, 0),
            "raising a to 500 would total 1300 against a 1000 limit"
        );
    }

    /// The raise must replace the SLO's own charge, not add to it — otherwise
    /// growth double-counts and trips overflow early.
    #[test]
    fn raising_replaces_the_slos_existing_charge() {
        let charges = vec![active("a", 1, 900)];
        assert!(
            can_raise_reservation(&charges, "a", 1, 950, 1_000, 0),
            "950 replaces 900; it does not sum to 1850"
        );
    }
}
