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
use sea_orm::{ConnectionTrait, DatabaseConnection, TransactionTrait};

use super::entity::slo_status;
use crate::errors;

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
    let _ = (db, write);
    todo!("slo::apply_status")
}

/// The same work against an already-open transaction, so callers can compose
/// it and tests can roll back instead of committing.
pub async fn apply_status_in_txn<C: ConnectionTrait>(
    txn: &C,
    write: &StatusWrite,
) -> Result<WriteOutcome, errors::Error> {
    let _ = (txn, write);
    todo!("slo::apply_status_in_txn")
}

/// Read one status row. `group_key = ""` is the rollup.
pub async fn load_status(
    db: &DatabaseConnection,
    slo_id: &str,
    group_key: &str,
) -> Result<Option<slo_status::Model>, errors::Error> {
    let _ = (db, slo_id, group_key);
    todo!("slo::load_status")
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
    let _ = (db, slo_id, definition_generation);
    todo!("slo::init_generation")
}

/// Bump the SLO to a new generation, clearing every running aggregate — the
/// rebuild path (D59).
pub async fn bump_generation(
    db: &DatabaseConnection,
    slo_id: &str,
    new_generation: i32,
) -> Result<(), errors::Error> {
    let _ = (db, slo_id, new_generation);
    todo!("slo::bump_generation")
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
    let _ = (db, slo_id, group_key, recomputed);
    todo!("slo::reconcile_from_slices")
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
