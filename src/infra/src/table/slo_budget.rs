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

//! Per-org row-budget accounting (`alerts_2.md` §6b.8, S-14d).
//!
//! The arithmetic lives in `config::meta::slo::budget_rows`; this module is
//! the persistence, and the one thing it must get right is that **the check
//! and the charge are the same operation**.
//!
//! Read-then-write is the obvious implementation and it is wrong: two
//! concurrent creates both read the pre-charge total, both see headroom, and
//! both commit. The row's `version` is compare-and-swapped inside the same
//! transaction as the counters, so the second one fails and retries against
//! the post-charge total.

use config::meta::slo::budget_rows::{BudgetError, check_headroom};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};

use super::entity::{slo_budget, slo_budget_charges};
use crate::errors::Error;

/// Charge states, as stored.
pub const STATE_ACTIVE: i32 = 1;
pub const STATE_RESIDUAL: i32 = 2;

/// How many times to retry a charge whose CAS lost.
///
/// Contention here is between concurrent SLO *saves* in one org, which is
/// rare. A handful of retries is plenty, and failing after them is better
/// than looping: the caller is a request handler, not a background job.
const CAS_RETRIES: u32 = 5;

/// A charge could not be applied.
#[derive(Debug)]
pub enum ChargeError {
    /// The org has no room. Carries the arithmetic for the user-facing message.
    Budget(BudgetError),
    /// Lost the compare-and-swap `CAS_RETRIES` times running.
    Contended,
    Db(Error),
}

impl std::fmt::Display for ChargeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Budget(e) => write!(f, "{e}"),
            Self::Contended => write!(
                f,
                "the organization's SLO budget is being modified concurrently; retry"
            ),
            Self::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ChargeError {}

impl From<Error> for ChargeError {
    fn from(e: Error) -> Self {
        Self::Db(e)
    }
}

impl From<sea_orm::DbErr> for ChargeError {
    fn from(e: sea_orm::DbErr) -> Self {
        Self::Db(Error::from(e))
    }
}

/// The org's current accounting. Absent means nothing charged yet.
pub async fn get(db: &DatabaseConnection, org: &str) -> Result<Option<slo_budget::Model>, Error> {
    Ok(slo_budget::Entity::find_by_id(org.to_string())
        .one(db)
        .await?)
}

/// Reserve `rows` for `(slo_id, generation)`, or fail with the arithmetic.
///
/// Idempotent per `(org, slo_id, generation)`: re-charging the same generation
/// replaces its charge rather than adding to it, so a retried save cannot
/// double-charge.
pub async fn charge(
    db: &DatabaseConnection,
    org: &str,
    slo_id: &str,
    generation: i32,
    rows: i64,
    cap: i64,
) -> Result<(), ChargeError> {
    for _ in 0..CAS_RETRIES {
        let current = get(db, org).await?;
        let (version, active, residual) = match &current {
            Some(b) => (b.version, b.active_rows, b.residual_rows),
            None => (0, 0, 0),
        };

        // What this generation already holds, if this is a re-charge. Counted
        // out of `active` before the check, or a retried save would appear to
        // need room it already owns.
        let existing = slo_budget_charges::Entity::find_by_id((
            org.to_string(),
            slo_id.to_string(),
            generation,
        ))
        .one(db)
        .await?;
        let already = existing
            .as_ref()
            .filter(|c| c.state == STATE_ACTIVE)
            .map(|c| c.rows_charged)
            .unwrap_or(0);

        check_headroom(rows, active - already, residual, cap).map_err(ChargeError::Budget)?;

        let txn = db.begin().await?;
        let new_active = active - already + rows;

        let swapped = if current.is_some() {
            // The CAS. `version` is in the WHERE clause, so a concurrent
            // charge that already moved it makes this affect zero rows.
            slo_budget::Entity::update_many()
                .col_expr(slo_budget::Column::Version, (version + 1).into())
                .col_expr(slo_budget::Column::ActiveRows, new_active.into())
                .filter(slo_budget::Column::Org.eq(org))
                .filter(slo_budget::Column::Version.eq(version))
                .exec(&txn)
                .await?
                .rows_affected
                == 1
        } else {
            // First charge for this org. A concurrent insert loses on the
            // primary key, which is the same outcome as losing the CAS.
            slo_budget::ActiveModel {
                org: Set(org.to_string()),
                version: Set(1),
                active_rows: Set(new_active),
                residual_rows: Set(0),
            }
            .insert(&txn)
            .await
            .is_ok()
        };

        if !swapped {
            let _ = txn.rollback().await;
            continue;
        }

        // The per-charge detail, in the same transaction. Without it the
        // totals cannot be un-charged correctly when this generation retires.
        let charge = slo_budget_charges::ActiveModel {
            org: Set(org.to_string()),
            slo_id: Set(slo_id.to_string()),
            generation: Set(generation),
            rows_charged: Set(rows),
            state: Set(STATE_ACTIVE),
            expires_at: Set(None),
        };
        if existing.is_some() {
            slo_budget_charges::Entity::update(charge)
                .exec(&txn)
                .await?;
        } else {
            charge.insert(&txn).await?;
        }

        txn.commit().await?;
        return Ok(());
    }
    Err(ChargeError::Contended)
}

/// Move a generation's charge from active to residual.
///
/// Called when a generation is superseded or its SLO deleted. The rows are
/// NOT released: they persist to the horizon regardless of whether anything
/// reads them, and releasing them instantly would make create-backfill-delete
/// an unlimited storage loophole (S-14c).
pub async fn retire(
    db: &DatabaseConnection,
    org: &str,
    slo_id: &str,
    generation: i32,
    expires_at: i64,
) -> Result<(), ChargeError> {
    for _ in 0..CAS_RETRIES {
        let Some(budget) = get(db, org).await? else {
            return Ok(());
        };
        let Some(charge) = slo_budget_charges::Entity::find_by_id((
            org.to_string(),
            slo_id.to_string(),
            generation,
        ))
        .one(db)
        .await?
        else {
            return Ok(());
        };
        if charge.state != STATE_ACTIVE {
            return Ok(());
        }

        let txn = db.begin().await?;
        let swapped = slo_budget::Entity::update_many()
            .col_expr(slo_budget::Column::Version, (budget.version + 1).into())
            .col_expr(
                slo_budget::Column::ActiveRows,
                (budget.active_rows - charge.rows_charged).max(0).into(),
            )
            .col_expr(
                slo_budget::Column::ResidualRows,
                (budget.residual_rows + charge.rows_charged).into(),
            )
            .filter(slo_budget::Column::Org.eq(org))
            .filter(slo_budget::Column::Version.eq(budget.version))
            .exec(&txn)
            .await?
            .rows_affected
            == 1;
        if !swapped {
            let _ = txn.rollback().await;
            continue;
        }

        let mut active: slo_budget_charges::ActiveModel = charge.into();
        active.state = Set(STATE_RESIDUAL);
        active.expires_at = Set(Some(expires_at));
        active.update(&txn).await?;
        txn.commit().await?;
        return Ok(());
    }
    Err(ChargeError::Contended)
}

/// Release residual charges whose slices have genuinely aged out.
///
/// Returns how many rows were freed.
pub async fn expire_residuals(
    db: &DatabaseConnection,
    org: &str,
    now: i64,
) -> Result<i64, ChargeError> {
    for _ in 0..CAS_RETRIES {
        let Some(budget) = get(db, org).await? else {
            return Ok(0);
        };
        let expired = slo_budget_charges::Entity::find()
            .filter(slo_budget_charges::Column::Org.eq(org))
            .filter(slo_budget_charges::Column::State.eq(STATE_RESIDUAL))
            .filter(slo_budget_charges::Column::ExpiresAt.lte(now))
            .all(db)
            .await?;
        if expired.is_empty() {
            return Ok(0);
        }
        let freed: i64 = expired.iter().map(|c| c.rows_charged).sum();

        let txn = db.begin().await?;
        let swapped = slo_budget::Entity::update_many()
            .col_expr(slo_budget::Column::Version, (budget.version + 1).into())
            .col_expr(
                slo_budget::Column::ResidualRows,
                (budget.residual_rows - freed).max(0).into(),
            )
            .filter(slo_budget::Column::Org.eq(org))
            .filter(slo_budget::Column::Version.eq(budget.version))
            .exec(&txn)
            .await?
            .rows_affected
            == 1;
        if !swapped {
            let _ = txn.rollback().await;
            continue;
        }
        for c in expired {
            slo_budget_charges::Entity::delete_by_id((c.org, c.slo_id, c.generation))
                .exec(&txn)
                .await?;
        }
        txn.commit().await?;
        return Ok(freed);
    }
    Err(ChargeError::Contended)
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;

    use super::*;
    use crate::table::migration::create_slo_tables_for_test;

    const ORG: &str = "acme";
    const CAP: i64 = 1_000;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_slo_tables_for_test(&db).await.unwrap();
        db
    }

    async fn totals(db: &DatabaseConnection) -> (i64, i64) {
        let b = get(db, ORG).await.unwrap().unwrap();
        (b.active_rows, b.residual_rows)
    }

    #[tokio::test]
    async fn an_org_with_no_slos_has_no_budget_row() {
        assert!(get(&db().await, ORG).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn the_first_charge_creates_the_org_row() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 100, CAP).await.unwrap();
        assert_eq!(totals(&db).await, (100, 0));
    }

    #[tokio::test]
    async fn charges_accumulate_across_slos() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 100, CAP).await.unwrap();
        charge(&db, ORG, "slo2", 1, 250, CAP).await.unwrap();
        assert_eq!(totals(&db).await, (350, 0));
    }

    /// A retried save must not double-charge. The charge is keyed by
    /// generation, so re-charging replaces rather than adds.
    #[tokio::test]
    async fn recharging_the_same_generation_replaces_rather_than_adds() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 100, CAP).await.unwrap();
        charge(&db, ORG, "slo1", 1, 100, CAP).await.unwrap();
        assert_eq!(totals(&db).await, (100, 0), "a retry double-charged");
    }

    #[tokio::test]
    async fn raising_a_generations_reservation_charges_only_the_difference() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 100, CAP).await.unwrap();
        charge(&db, ORG, "slo1", 1, 180, CAP).await.unwrap();
        assert_eq!(totals(&db).await, (180, 0));
    }

    /// Growth past the reservation must still be checked against the org's
    /// headroom, not waved through because the SLO already holds a charge.
    #[tokio::test]
    async fn raising_a_reservation_past_the_cap_is_rejected() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 900, CAP).await.unwrap();
        assert!(matches!(
            charge(&db, ORG, "slo1", 1, 1_100, CAP).await,
            Err(ChargeError::Budget(_))
        ));
        assert_eq!(totals(&db).await, (900, 0), "a rejected raise still landed");
    }

    #[tokio::test]
    async fn a_charge_past_the_cap_is_rejected_with_its_arithmetic() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 900, CAP).await.unwrap();
        let err = charge(&db, ORG, "slo2", 1, 200, CAP).await.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("900"), "{msg}");
        assert!(msg.contains("200"), "{msg}");
        assert_eq!(totals(&db).await, (900, 0), "a rejected charge landed");
    }

    // ===================== retirement =====================================

    /// The rows persist to the horizon regardless of whether anything reads
    /// them, so retiring moves the charge rather than releasing it (S-14c).
    #[tokio::test]
    async fn retiring_a_generation_moves_its_charge_to_residual() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 100, CAP).await.unwrap();
        retire(&db, ORG, "slo1", 1, 9_000).await.unwrap();
        assert_eq!(totals(&db).await, (0, 100));
    }

    /// The loophole this closes: create, backfill, delete, repeat.
    #[tokio::test]
    async fn delete_and_recreate_does_not_free_storage_that_still_exists() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 600, CAP).await.unwrap();
        retire(&db, ORG, "slo1", 1, 9_000).await.unwrap();
        // The slices are still on disk, so the org still holds 600.
        assert!(
            matches!(
                charge(&db, ORG, "slo2", 1, 600, CAP).await,
                Err(ChargeError::Budget(_))
            ),
            "delete-and-recreate freed storage that still exists"
        );
    }

    #[tokio::test]
    async fn retiring_twice_is_a_no_op() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 100, CAP).await.unwrap();
        retire(&db, ORG, "slo1", 1, 9_000).await.unwrap();
        retire(&db, ORG, "slo1", 1, 9_000).await.unwrap();
        assert_eq!(totals(&db).await, (0, 100), "the charge was moved twice");
    }

    #[tokio::test]
    async fn retiring_an_unknown_charge_is_a_no_op() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 100, CAP).await.unwrap();
        retire(&db, ORG, "nonexistent", 7, 9_000).await.unwrap();
        assert_eq!(totals(&db).await, (100, 0));
    }

    /// A superseded generation and its successor are charged separately —
    /// the old slices survive alongside the new ones.
    #[tokio::test]
    async fn a_generation_bump_charges_both_epochs_until_the_old_one_expires() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 300, CAP).await.unwrap();
        retire(&db, ORG, "slo1", 1, 9_000).await.unwrap();
        charge(&db, ORG, "slo1", 2, 300, CAP).await.unwrap();
        assert_eq!(totals(&db).await, (300, 300));
    }

    // ===================== expiry =========================================

    #[tokio::test]
    async fn a_residual_is_released_once_its_slices_have_aged_out() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 100, CAP).await.unwrap();
        retire(&db, ORG, "slo1", 1, 9_000).await.unwrap();

        assert_eq!(expire_residuals(&db, ORG, 8_999).await.unwrap(), 0);
        assert_eq!(totals(&db).await, (0, 100), "released early");

        assert_eq!(expire_residuals(&db, ORG, 9_000).await.unwrap(), 100);
        assert_eq!(totals(&db).await, (0, 0));
    }

    #[tokio::test]
    async fn expiry_releases_exactly_what_that_generation_reserved() {
        let db = db().await;
        // Two generations of different sizes, expiring at different times.
        charge(&db, ORG, "slo1", 1, 100, CAP).await.unwrap();
        retire(&db, ORG, "slo1", 1, 5_000).await.unwrap();
        charge(&db, ORG, "slo1", 2, 250, CAP).await.unwrap();
        retire(&db, ORG, "slo1", 2, 9_000).await.unwrap();
        assert_eq!(totals(&db).await, (0, 350));

        // Only the first has aged out. A running total could not tell these
        // apart — which is why the per-charge detail exists.
        assert_eq!(expire_residuals(&db, ORG, 5_000).await.unwrap(), 100);
        assert_eq!(totals(&db).await, (0, 250));
    }

    #[tokio::test]
    async fn expiry_leaves_active_charges_alone() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 100, CAP).await.unwrap();
        assert_eq!(expire_residuals(&db, ORG, i64::MAX).await.unwrap(), 0);
        assert_eq!(totals(&db).await, (100, 0));
    }

    #[tokio::test]
    async fn expiry_on_an_org_with_no_budget_is_a_no_op() {
        assert_eq!(
            expire_residuals(&db().await, ORG, i64::MAX).await.unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn freed_headroom_is_reusable() {
        let db = db().await;
        charge(&db, ORG, "slo1", 1, 900, CAP).await.unwrap();
        retire(&db, ORG, "slo1", 1, 5_000).await.unwrap();
        expire_residuals(&db, ORG, 5_000).await.unwrap();
        charge(&db, ORG, "slo2", 1, 900, CAP).await.unwrap();
        assert_eq!(totals(&db).await, (900, 0));
    }

    // ===================== concurrency ====================================

    /// The reason `version` exists. Two creates racing for the last of an
    /// org's headroom must not both succeed by each reading the pre-charge
    /// total.
    ///
    /// File-backed, because separate connections to `sqlite::memory:` get
    /// separate databases — an in-memory race would test nothing.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_charges_cannot_double_spend_headroom() {
        let dir = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}/budget.db?mode=rwc", dir.path().display());
        let setup = Database::connect(&url).await.unwrap();
        create_slo_tables_for_test(&setup).await.unwrap();
        // Seed the row so both racers take the CAS path rather than the
        // insert path.
        charge(&setup, ORG, "seed", 1, 1, CAP).await.unwrap();

        let a = Database::connect(&url).await.unwrap();
        let b = Database::connect(&url).await.unwrap();
        // Together these exceed the cap; individually neither does.
        let (x, y) = tokio::join!(
            charge(&a, ORG, "slo1", 1, 600, CAP),
            charge(&b, ORG, "slo2", 1, 600, CAP)
        );

        let granted: i64 = [(&x, 600), (&y, 600)]
            .iter()
            .filter(|(r, _)| r.is_ok())
            .map(|(_, n)| *n)
            .sum();
        let (active, _) = totals(&setup).await;
        assert_eq!(active, granted + 1, "the ledger disagrees with the grants");
        assert!(
            active <= CAP,
            "two concurrent charges double-spent headroom: {active} > {CAP}"
        );
    }
}
