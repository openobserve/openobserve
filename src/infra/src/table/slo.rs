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

//! SLO status writes — `alerts_2.md` §6b.4c, §6b.8, D64.
//!
//! Slices go to a columnar stream; this table holds the running window
//! aggregate that status reads and alerts evaluate against, plus the watermark
//! that keeps readers off the currently-filling slice.
//!
//! **There is no transactional publication protocol.** Three earlier designs
//! built one — a write-ahead manifest, per-writer committed marks, an
//! abandoned-batch set — to guarantee a reader never sees rows from a batch
//! that did not commit. D64 removed all of it, because the guarantee was
//! protecting against a harm that does not exist: a torn batch's rows are real
//! measurements whose delta was never folded into this cache, the cache is
//! rebuilt from slices by reconciliation, alerts read the cache rather than
//! slices, and a partial batch shows up as reduced coverage, which is already
//! gated. Slices publish at-least-once, like every other stream in the
//! product.
//!
//! What this module still owes the caller is ordinary and small:
//!
//! * the status write is **one transaction** — a rollup inconsistent with its group rows would hand
//!   composites a state that never existed;
//! * it is **CAS-fenced on `definition_generation`** (D59), because mixing two definitions across a
//!   90-day window is real corruption that no amount of eventual consistency repairs.

use config::meta::slo::slice::Writer;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DatabaseConnection, EntityTrait,
    QueryFilter, Set, TransactionTrait,
    sea_query::{Expr, Func, SimpleExpr},
};

use super::entity::slo_status;
use crate::errors;

/// `COALESCE(col, 0) + delta` — the increment applied in SQL rather than
/// read-modify-write in Rust. Two passes that overlap must both land; a
/// Rust-side `good + delta` would lose one silently.
///
/// `COALESCE` is what turns "not yet measured" (NULL) into the first
/// measurement, so a fresh generation does not need a zero row seeded first.
fn increment(col: slo_status::Column, delta: f64) -> SimpleExpr {
    Expr::expr(Func::coalesce([
        Expr::col(col).into(),
        Expr::val(0.0).into(),
    ]))
    .add(delta)
}

fn increment_i32(col: slo_status::Column, delta: i32) -> SimpleExpr {
    Expr::expr(Func::coalesce([Expr::col(col).into(), Expr::val(0).into()])).add(delta)
}

fn row_of(slo_id: &str, group_key: &str) -> Condition {
    Condition::all()
        .add(slo_status::Column::SloId.eq(slo_id))
        .add(slo_status::Column::GroupKey.eq(group_key))
}

/// One group's contribution to the running window aggregate.
#[derive(Debug, Clone, PartialEq)]
pub struct GroupDelta {
    pub group_key: String,
    /// Added to the running totals. Slices leaving the trailing edge arrive
    /// here as negatives.
    pub good_delta: f64,
    pub total_delta: f64,
    pub covered_slices_delta: i32,
}

/// One pass's effect on the status table.
#[derive(Debug, Clone, PartialEq)]
pub struct StatusWrite {
    pub slo_id: String,
    /// The generation the pass was planned under — CAS-fenced (D59). A write
    /// whose generation no longer matches the stored one must fail, or a pass
    /// that outlived a computation edit would fold the *old* definition's
    /// arithmetic into the *new* generation's aggregate.
    pub definition_generation: i32,
    pub writer: Writer,
    pub deltas: Vec<GroupDelta>,
    /// Advanced by the incremental writer only. Backfill fills history behind
    /// the watermark and never moves it.
    pub watermark_end: Option<i64>,
    pub trailing_slices: Option<serde_json::Value>,
    pub computed_at: i64,
}

/// Why a status write did not take effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    Applied,
    /// The SLO's generation moved while this pass was in flight. Its slices
    /// remain in the stream under the old generation and are invisible to
    /// readers, which filter on the current one.
    FencedByGeneration {
        expected: i32,
        found: i32,
    },
}

/// Apply a pass's deltas, watermark and trailing buffer — all in one
/// transaction, fenced on generation.
pub async fn apply_status(
    db: &DatabaseConnection,
    write: &StatusWrite,
) -> Result<WriteOutcome, errors::Error> {
    let txn = db.begin().await?;
    let outcome = match apply_status_in_txn(&txn, write).await {
        Ok(outcome) => outcome,
        Err(e) => {
            // Best-effort: the rollback failing does not change what the
            // caller needs to know, which is that the write did not apply.
            let _ = txn.rollback().await;
            return Err(e);
        }
    };
    // A fenced write applied nothing, so there is nothing to commit — but
    // rolling back is what makes that true even if a caller later adds work
    // before the fence check.
    if matches!(outcome, WriteOutcome::FencedByGeneration { .. }) {
        let _ = txn.rollback().await;
        return Ok(outcome);
    }
    txn.commit().await?;
    Ok(outcome)
}

/// The same work against an already-open transaction, so callers can compose
/// it and tests can roll back instead of committing.
pub async fn apply_status_in_txn<C: ConnectionTrait>(
    txn: &C,
    write: &StatusWrite,
) -> Result<WriteOutcome, errors::Error> {
    // The fence, first: everything below is arithmetic that must not happen
    // at all if the definition moved underneath this pass (D59).
    let rollup = slo_status::Entity::find_by_id((
        write.slo_id.clone(),
        slo_status::ROLLUP_GROUP_KEY.to_string(),
    ))
    .one(txn)
    .await?;
    if let Some(existing) = &rollup
        && existing.definition_generation != write.definition_generation
    {
        return Ok(WriteOutcome::FencedByGeneration {
            expected: write.definition_generation,
            found: existing.definition_generation,
        });
    }

    for d in &write.deltas {
        let updated = slo_status::Entity::update_many()
            .col_expr(
                slo_status::Column::Good,
                increment(slo_status::Column::Good, d.good_delta),
            )
            .col_expr(
                slo_status::Column::Total,
                increment(slo_status::Column::Total, d.total_delta),
            )
            .col_expr(
                slo_status::Column::CoveredSlices,
                increment_i32(slo_status::Column::CoveredSlices, d.covered_slices_delta),
            )
            .col_expr(
                slo_status::Column::ComputedAt,
                Expr::value(write.computed_at),
            )
            .filter(row_of(&write.slo_id, &d.group_key))
            .exec(txn)
            .await?;

        if updated.rows_affected == 0 {
            // First sight of this group under this generation. The row is
            // born carrying the generation it was written under, so a later
            // bump can tell old rows from new ones.
            slo_status::ActiveModel {
                slo_id: Set(write.slo_id.clone()),
                group_key: Set(d.group_key.clone()),
                definition_generation: Set(write.definition_generation),
                good: Set(Some(d.good_delta)),
                total: Set(Some(d.total_delta)),
                covered_slices: Set(Some(d.covered_slices_delta)),
                computed_at: Set(Some(write.computed_at)),
                ..Default::default()
            }
            .insert(txn)
            .await?;
        }
    }

    // The watermark and the trailing buffer live on the rollup row only, and
    // only the incremental writer owns them: backfill fills history *behind*
    // the watermark, so advancing it would publish slices the incremental
    // writer has not reached.
    if write.writer == Writer::Incremental
        && let Some(wm) = write.watermark_end
    {
        slo_status::Entity::update_many()
            .col_expr(slo_status::Column::WatermarkEnd, Expr::value(wm))
            .filter(row_of(&write.slo_id, slo_status::ROLLUP_GROUP_KEY))
            // A forward clamp. Expressed as a filter rather than a Rust-side
            // comparison so two overlapping passes cannot walk it backwards:
            // readers have already been shown everything below it.
            .filter(
                Condition::any()
                    .add(slo_status::Column::WatermarkEnd.is_null())
                    .add(slo_status::Column::WatermarkEnd.lt(wm)),
            )
            .exec(txn)
            .await?;
    }

    if let Some(trailing) = &write.trailing_slices {
        slo_status::Entity::update_many()
            .col_expr(
                slo_status::Column::TrailingSlices,
                Expr::value(trailing.clone()),
            )
            .filter(row_of(&write.slo_id, slo_status::ROLLUP_GROUP_KEY))
            .exec(txn)
            .await?;
    }

    Ok(WriteOutcome::Applied)
}

/// Read one status row. `group_key = ""` is the rollup.
pub async fn load_status(
    db: &DatabaseConnection,
    slo_id: &str,
    group_key: &str,
) -> Result<Option<slo_status::Model>, errors::Error> {
    Ok(
        slo_status::Entity::find_by_id((slo_id.to_string(), group_key.to_string()))
            .one(db)
            .await?,
    )
}

/// Create the rollup row for a new generation.
///
/// The running aggregates are left **NULL, not zero**. `Some(0.0)` is "we
/// measured, and it was zero"; `None` is "nothing has been measured yet". A
/// fresh generation is the latter, and coverage must not read it as a real
/// observation of an empty window.
pub async fn init_generation(
    db: &DatabaseConnection,
    slo_id: &str,
    definition_generation: i32,
) -> Result<(), errors::Error> {
    slo_status::ActiveModel {
        slo_id: Set(slo_id.to_string()),
        group_key: Set(slo_status::ROLLUP_GROUP_KEY.to_string()),
        definition_generation: Set(definition_generation),
        ..Default::default()
    }
    .insert(db)
    .await?;
    Ok(())
}

/// Bump the SLO to a new generation, clearing every running aggregate — the
/// rebuild path (D59).
pub async fn bump_generation(
    db: &DatabaseConnection,
    slo_id: &str,
    new_generation: i32,
) -> Result<(), errors::Error> {
    let txn = db.begin().await?;
    // Delete rather than null out: the group set itself belongs to the old
    // definition, so a group that no longer exists under the new one must not
    // linger as an empty row that reads as an observed group.
    slo_status::Entity::delete_many()
        .filter(slo_status::Column::SloId.eq(slo_id))
        .exec(&txn)
        .await?;
    slo_status::ActiveModel {
        slo_id: Set(slo_id.to_string()),
        group_key: Set(slo_status::ROLLUP_GROUP_KEY.to_string()),
        definition_generation: Set(new_generation),
        ..Default::default()
    }
    .insert(&txn)
    .await?;
    txn.commit().await?;
    Ok(())
}

/// Recompute a status row from its slices — the reconciliation path.
///
/// This is what makes at-least-once publication safe (D64): the running
/// aggregate is a cache, and this rebuilds it from the slices that are the
/// source of truth. It is therefore **load-bearing**, not hygiene.
pub async fn reconcile_from_slices(
    db: &DatabaseConnection,
    slo_id: &str,
    group_key: &str,
    recomputed: (f64, f64, i32),
) -> Result<(), errors::Error> {
    let (good, total, covered) = recomputed;
    // Assignment, not increment: this is a rebuild from the source of truth,
    // and the watermark is deliberately untouched — reconciliation repairs the
    // aggregate, not the read clamp.
    slo_status::Entity::update_many()
        .col_expr(slo_status::Column::Good, Expr::value(good))
        .col_expr(slo_status::Column::Total, Expr::value(total))
        .col_expr(slo_status::Column::CoveredSlices, Expr::value(covered))
        .filter(row_of(slo_id, group_key))
        .exec(db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::slo::slice::Writer;
    use sea_orm::{Database, DatabaseConnection};

    use super::*;
    use crate::table::migration::create_slo_tables_for_test;

    const SLO: &str = "slo00000000000000000000000";
    const ROLLUP: &str = slo_status::ROLLUP_GROUP_KEY;

    /// A real SQLite database with the SLO table applied.
    ///
    /// `sea-orm`'s mock connection cannot be used here: these tests are about
    /// transaction atomicity, rollback and the CAS fence, none of which a mock
    /// models — it replays canned results.
    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        create_slo_tables_for_test(&db)
            .await
            .expect("slo tables apply");
        db
    }

    fn delta(group: &str, good: f64, total: f64, covered: i32) -> GroupDelta {
        GroupDelta {
            group_key: group.to_string(),
            good_delta: good,
            total_delta: total,
            covered_slices_delta: covered,
        }
    }

    fn write_of(generation: i32) -> StatusWrite {
        StatusWrite {
            slo_id: SLO.to_string(),
            definition_generation: generation,
            writer: Writer::Incremental,
            deltas: vec![
                delta(ROLLUP, 10.0, 10.0, 1),
                delta("region:eu", 5.0, 5.0, 1),
            ],
            watermark_end: Some(9_900),
            trailing_slices: Some(serde_json::json!({"9600": [10.0, 10.0]})),
            computed_at: 1_000,
        }
    }

    // ===================== schema =========================================

    #[tokio::test]
    async fn the_migration_applies_to_a_fresh_database() {
        let db = db().await;
        assert!(load_status(&db, SLO, ROLLUP).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn the_migration_is_idempotent() {
        let db = db().await;
        // A migration interrupted part-way has to be retryable (§8b trap 3).
        // `create_table_if_not_exists` gives this for free, which is one reason
        // new tables are cheaper than ALTERs.
        create_slo_tables_for_test(&db).await.expect("second run");
    }

    // ===================== the write path =================================

    #[tokio::test]
    async fn a_pass_applies_its_deltas_and_watermark() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        assert_eq!(
            apply_status(&db, &write_of(1)).await.unwrap(),
            WriteOutcome::Applied
        );

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.good, Some(10.0));
        assert_eq!(status.watermark_end, Some(9_900));
    }

    #[tokio::test]
    async fn deltas_accumulate_across_passes() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        for _ in 0..3 {
            apply_status(&db, &write_of(1)).await.unwrap();
        }
        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.good, Some(30.0), "three passes of +10");
    }

    #[tokio::test]
    async fn a_negative_delta_retires_a_slice_leaving_the_window() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        apply_status(&db, &write_of(1)).await.unwrap();

        let mut retire = write_of(1);
        retire.deltas = vec![delta(ROLLUP, -10.0, -10.0, -1)];
        apply_status(&db, &retire).await.unwrap();

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.good, Some(0.0), "the trailing edge subtracted");
    }

    #[tokio::test]
    async fn per_group_deltas_land_on_their_own_rows() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        apply_status(&db, &write_of(1)).await.unwrap();

        let group = load_status(&db, SLO, "region:eu").await.unwrap().unwrap();
        assert_eq!(group.good, Some(5.0));
        assert_eq!(
            group.watermark_end, None,
            "only the rollup row carries the watermark"
        );
    }

    /// Backfill fills history *behind* the watermark, so moving it would
    /// publish slices the incremental writer has not reached.
    #[tokio::test]
    async fn backfill_does_not_move_the_watermark() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        apply_status(&db, &write_of(1)).await.unwrap(); // watermark 9_900

        let mut bf = write_of(1);
        bf.writer = Writer::Backfill;
        bf.watermark_end = None;
        bf.deltas = vec![delta(ROLLUP, 3.0, 3.0, 1)];
        apply_status(&db, &bf).await.unwrap();

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.watermark_end, Some(9_900));
        assert_eq!(status.good, Some(13.0), "but its delta still lands");
    }

    /// The watermark is a forward clamp; letting it retreat would hide slices
    /// that readers have already been shown.
    #[tokio::test]
    async fn the_watermark_never_moves_backwards() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        apply_status(&db, &write_of(1)).await.unwrap();

        let mut backwards = write_of(1);
        backwards.watermark_end = Some(5_000);
        let _ = apply_status(&db, &backwards).await;

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.watermark_end, Some(9_900));
    }

    // ===================== atomicity ======================================

    /// The rollup and its group rows go in one transaction: composites read
    /// the rollup, and a rollup inconsistent with partially-written group rows
    /// would feed them a state that never existed.
    #[tokio::test]
    async fn a_failed_write_leaves_no_partial_state() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();

        let txn = db.begin().await.unwrap();
        apply_status_in_txn(&txn, &write_of(1)).await.unwrap();
        txn.rollback().await.unwrap();

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.good, None, "delta leaked");
        assert_eq!(status.watermark_end, None, "watermark leaked");
        assert!(
            load_status(&db, SLO, "region:eu").await.unwrap().is_none(),
            "a group row leaked from a rolled-back write"
        );
    }

    #[tokio::test]
    async fn a_committed_transaction_applies_the_rollup_and_its_groups_together() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();

        let txn = db.begin().await.unwrap();
        apply_status_in_txn(&txn, &write_of(1)).await.unwrap();
        txn.commit().await.unwrap();

        assert_eq!(
            load_status(&db, SLO, ROLLUP).await.unwrap().unwrap().good,
            Some(10.0)
        );
        assert_eq!(
            load_status(&db, SLO, "region:eu")
                .await
                .unwrap()
                .unwrap()
                .good,
            Some(5.0)
        );
    }

    // ===================== the CAS fence ==================================

    /// A pass that outlived a computation edit must not fold the old
    /// definition's arithmetic into the new generation (D59). This is the one
    /// corruption eventual consistency does NOT repair — reconciliation would
    /// happily rebuild a cache that mixes two definitions.
    #[tokio::test]
    async fn a_write_from_a_superseded_generation_is_fenced() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        bump_generation(&db, SLO, 2).await.unwrap();

        assert_eq!(
            apply_status(&db, &write_of(1)).await.unwrap(),
            WriteOutcome::FencedByGeneration {
                expected: 1,
                found: 2
            }
        );

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.definition_generation, 2);
        assert_eq!(status.good, None, "the fenced pass applied nothing");
    }

    #[tokio::test]
    async fn a_generation_bump_clears_the_running_aggregate() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        apply_status(&db, &write_of(1)).await.unwrap();

        bump_generation(&db, SLO, 2).await.unwrap();
        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.definition_generation, 2);
        assert_eq!(status.good, None, "the old arithmetic must not survive");
        assert_eq!(status.watermark_end, None);
    }

    #[tokio::test]
    async fn a_group_row_inherits_the_generation_it_was_written_under() {
        let db = db().await;
        init_generation(&db, SLO, 3).await.unwrap();
        apply_status(&db, &write_of(3)).await.unwrap();

        let group = load_status(&db, SLO, "region:eu").await.unwrap().unwrap();
        assert_eq!(group.definition_generation, 3);
    }

    // ===================== reconciliation =================================

    /// The mechanism that makes at-least-once publication safe (D64). A cache
    /// that has drifted — because a pass wrote slices and never applied its
    /// delta — is repaired from the slices themselves.
    #[tokio::test]
    async fn reconciliation_repairs_a_drifted_aggregate() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        apply_status(&db, &write_of(1)).await.unwrap(); // cache says 10/10

        // The stream actually holds 12/12: one pass wrote slices and died
        // before applying its delta.
        reconcile_from_slices(&db, SLO, ROLLUP, (12.0, 12.0, 2))
            .await
            .unwrap();

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.good, Some(12.0));
        assert_eq!(status.total, Some(12.0));
        assert_eq!(status.covered_slices, Some(2));
    }

    #[tokio::test]
    async fn reconciliation_does_not_disturb_the_watermark() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        apply_status(&db, &write_of(1)).await.unwrap();
        reconcile_from_slices(&db, SLO, ROLLUP, (12.0, 12.0, 2))
            .await
            .unwrap();

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(
            status.watermark_end,
            Some(9_900),
            "reconciliation repairs the aggregate, not the read clamp"
        );
    }

    // ===================== stored shapes ==================================

    /// `Some(0.0)` is "measured and empty"; `None` is "not yet measured".
    /// Coverage must not confuse the two.
    #[tokio::test]
    async fn a_fresh_generation_has_null_aggregates_not_zero() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.good, None);
        assert_eq!(status.total, None);
        assert_eq!(status.covered_slices, None);
        assert_eq!(status.coverage, None);
    }

    #[tokio::test]
    async fn the_trailing_buffer_round_trips() {
        let db = db().await;
        init_generation(&db, SLO, 1).await.unwrap();
        apply_status(&db, &write_of(1)).await.unwrap();

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(
            status.trailing_slices,
            Some(serde_json::json!({"9600": [10.0, 10.0]})),
            "write-on-change compares against this; losing it would re-emit \
             every trailing slice on every pass"
        );
    }

    // ===================== concurrency ====================================

    /// A genuine race. The hazard is a read-modify-write lost update — two
    /// passes both reading `good` and both writing `good + delta` — which is
    /// invisible unless they overlap.
    ///
    /// Uses a **file-backed** database: separate connections to
    /// `sqlite::memory:` get separate databases, so an in-memory race would
    /// silently test nothing.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_writes_do_not_lose_an_update() {
        let dir = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}/slo.db?mode=rwc", dir.path().display());
        let setup = Database::connect(&url).await.unwrap();
        create_slo_tables_for_test(&setup).await.unwrap();
        init_generation(&setup, SLO, 1).await.unwrap();

        let a = Database::connect(&url).await.unwrap();
        let b = Database::connect(&url).await.unwrap();
        let mut first = write_of(1);
        first.deltas = vec![delta(ROLLUP, 10.0, 10.0, 1)];
        let mut second = write_of(1);
        second.deltas = vec![delta(ROLLUP, 3.0, 3.0, 1)];

        let (x, y) = tokio::join!(apply_status(&a, &first), apply_status(&b, &second));

        // Whatever the outcomes, the stored total must equal the sum of the
        // writes that reported success — never less.
        let expected: f64 = [(&x, 10.0), (&y, 3.0)]
            .iter()
            .filter(|(r, _)| matches!(r, Ok(WriteOutcome::Applied)))
            .map(|(_, d)| *d)
            .sum();
        let status = load_status(&setup, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(
            status.good.unwrap_or(0.0),
            expected,
            "a write that reported success must not have been lost"
        );
    }
}
