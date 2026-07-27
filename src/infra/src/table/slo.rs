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

//! The SLO publication protocol — `alerts_2.md` §6b.4a, D53/D58/D59/D62/D63.
//!
//! Slices live in a columnar stream and the commit state lives here, in the
//! meta store, with **no transaction spanning the two**. Everything in this
//! module exists to make that boundary safe:
//!
//! ```text
//!   reserve_batch()      one txn: write the manifest (the write-ahead intent)
//!        ↓
//!   write slices         columnar; NOT transactional; may tear
//!        ↓
//!   commit_batch()       one txn: status deltas + marks + watermark
//!                        + abandonment + clear the manifest,
//!                        all CAS-fenced on definition_generation
//! ```
//!
//! A manifest row surviving into the next pass is exactly the signature of a
//! crash between write and commit. Recovery abandons that batch number and
//! allocates a fresh one (D63) — abandonment, not revision ordering, is what
//! hides the orphans, which is why a key whose correct value is *no row at
//! all* needs no tombstone.
//!
//! The pure decision logic lives in `config::meta::slo::slice`; this module is
//! only responsible for making those decisions durable **atomically**.

use config::meta::slo::slice::Writer;
use sea_orm::{ConnectionTrait, DatabaseConnection, TransactionTrait};

use super::entity::{slo_batch_manifest, slo_status};
use crate::errors;

/// Storage id for a writer.
pub fn writer_id(writer: Writer) -> i16 {
    match writer {
        Writer::Incremental => slo_batch_manifest::WRITER_INCREMENTAL,
        Writer::Backfill => slo_batch_manifest::WRITER_BACKFILL,
    }
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

/// Everything one commit makes durable, in a single transaction.
#[derive(Debug, Clone, PartialEq)]
pub struct BatchCommit {
    pub slo_id: String,
    /// The generation the pass was planned under — CAS-fenced (D59). A commit
    /// whose generation no longer matches the stored one must fail, or a
    /// writer that outlived a computation edit would advance the *new*
    /// generation's marks using the *old* definition's arithmetic.
    pub definition_generation: i32,
    pub writer: Writer,
    pub batch_rev: i64,
    pub deltas: Vec<GroupDelta>,
    /// Advanced by the incremental writer only; backfill never touches it.
    pub watermark_end: Option<i64>,
    /// The torn batch this pass is superseding, recorded in the same
    /// transaction so a crash cannot leave it half-abandoned (D63).
    pub abandon: Option<i64>,
    pub trailing_slices: Option<serde_json::Value>,
    pub computed_at: i64,
}

/// Why a commit did not take effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitOutcome {
    Committed,
    /// The SLO's generation moved while this pass was in flight. The pass's
    /// columnar rows stay orphaned under its batch number and are abandoned by
    /// whoever runs next.
    FencedByGeneration {
        expected: i32,
        found: i32,
    },
}

/// Record the intent to write a batch, **before** any columnar row exists.
pub async fn reserve_batch(
    db: &DatabaseConnection,
    slo_id: &str,
    writer: Writer,
    batch_rev: i64,
    range: (i64, i64),
    definition_generation: i32,
    now: i64,
) -> Result<(), errors::Error> {
    let _ = (
        db,
        slo_id,
        writer,
        batch_rev,
        range,
        definition_generation,
        now,
    );
    todo!("slo::reserve_batch")
}

/// Read a writer's outstanding manifest, if it has one.
pub async fn load_pending(
    db: &DatabaseConnection,
    slo_id: &str,
    writer: Writer,
) -> Result<Option<slo_batch_manifest::Model>, errors::Error> {
    let _ = (db, slo_id, writer);
    todo!("slo::load_pending")
}

/// Apply a batch: status deltas, the writer's committed mark, the watermark,
/// any abandonment, and clearing the manifest — **all or nothing**.
pub async fn commit_batch(
    db: &DatabaseConnection,
    commit: &BatchCommit,
) -> Result<CommitOutcome, errors::Error> {
    let _ = (db, commit);
    todo!("slo::commit_batch")
}

/// The same work against an already-open transaction, so callers can compose
/// it and tests can roll back instead of committing.
pub async fn commit_batch_in_txn<C: ConnectionTrait>(
    txn: &C,
    commit: &BatchCommit,
) -> Result<CommitOutcome, errors::Error> {
    let _ = (txn, commit);
    todo!("slo::commit_batch_in_txn")
}

/// Read the rollup row, which carries the commit state.
pub async fn load_status(
    db: &DatabaseConnection,
    slo_id: &str,
    group_key: &str,
) -> Result<Option<slo_status::Model>, errors::Error> {
    let _ = (db, slo_id, group_key);
    todo!("slo::load_status")
}

/// Create the rollup row for a new generation, resetting the barrier.
pub async fn init_generation(
    db: &DatabaseConnection,
    slo_id: &str,
    definition_generation: i32,
    reset_time: i64,
) -> Result<(), errors::Error> {
    let _ = (db, slo_id, definition_generation, reset_time);
    todo!("slo::init_generation")
}

/// Bump the SLO to a new generation, clearing every running aggregate — the
/// rebuild path (D59).
pub async fn bump_generation(
    db: &DatabaseConnection,
    slo_id: &str,
    new_generation: i32,
    reset_time: i64,
) -> Result<(), errors::Error> {
    let _ = (db, slo_id, new_generation, reset_time);
    todo!("slo::bump_generation")
}

#[cfg(test)]
mod tests {
    use config::meta::slo::slice::Writer;
    use sea_orm::{Database, DatabaseConnection};

    use super::*;
    use crate::table::migration::create_slo_tables_for_test;

    const SLO: &str = "slo00000000000000000000000";
    const ROLLUP: &str = slo_status::ROLLUP_GROUP_KEY;

    /// A real SQLite database with the SLO tables applied.
    ///
    /// `sea-orm`'s mock connection cannot be used for any of this: these tests
    /// are *about* transaction atomicity, rollback and the CAS fence, none of
    /// which a mock models — it replays canned results.
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

    fn commit_of(batch_rev: i64, generation: i32) -> BatchCommit {
        BatchCommit {
            slo_id: SLO.to_string(),
            definition_generation: generation,
            writer: Writer::Incremental,
            batch_rev,
            deltas: vec![
                delta(ROLLUP, 10.0, 10.0, 1),
                delta("region:eu", 5.0, 5.0, 1),
            ],
            watermark_end: Some(9_900),
            abandon: None,
            trailing_slices: Some(serde_json::json!({"9600": [10.0, 10.0]})),
            computed_at: 1_000,
        }
    }

    // ===================== schema =========================================

    #[tokio::test]
    async fn the_migration_applies_to_a_fresh_database() {
        let db = db().await;
        // Both tables must be queryable after migrating.
        assert!(load_status(&db, SLO, ROLLUP).await.unwrap().is_none());
        assert!(
            load_pending(&db, SLO, Writer::Incremental)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn the_migration_is_idempotent() {
        let db = db().await;
        // Re-running must not fail — a migration interrupted part-way has to
        // be retryable (§8b trap 3). `create_table_if_not_exists` gives this
        // for free, which is one reason new tables are cheaper than ALTERs.
        create_slo_tables_for_test(&db).await.expect("second run");
    }

    // ===================== the happy path =================================

    #[tokio::test]
    async fn a_clean_pass_reserves_writes_and_commits() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();

        reserve_batch(&db, SLO, Writer::Incremental, 101, (9_000, 9_900), 1, 1)
            .await
            .unwrap();
        assert!(
            load_pending(&db, SLO, Writer::Incremental)
                .await
                .unwrap()
                .is_some(),
            "the manifest exists between reserve and commit"
        );

        let outcome = commit_batch(&db, &commit_of(101, 1)).await.unwrap();
        assert_eq!(outcome, CommitOutcome::Committed);

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.committed_batch_rev_incr, Some(101));
        assert_eq!(status.watermark_end, Some(9_900));
        assert_eq!(status.good, Some(10.0));
        assert!(
            load_pending(&db, SLO, Writer::Incremental)
                .await
                .unwrap()
                .is_none(),
            "a successful commit clears its own manifest"
        );
    }

    #[tokio::test]
    async fn deltas_accumulate_across_commits() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        for batch in 101..=103 {
            reserve_batch(&db, SLO, Writer::Incremental, batch, (0, 1), 1, 1)
                .await
                .unwrap();
            commit_batch(&db, &commit_of(batch, 1)).await.unwrap();
        }
        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.good, Some(30.0), "three commits of +10");
        assert_eq!(status.committed_batch_rev_incr, Some(103));
    }

    #[tokio::test]
    async fn a_negative_delta_retires_a_slice_leaving_the_window() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (0, 1), 1, 1)
            .await
            .unwrap();
        commit_batch(&db, &commit_of(101, 1)).await.unwrap();

        let mut retire = commit_of(102, 1);
        retire.deltas = vec![delta(ROLLUP, -10.0, -10.0, -1)];
        reserve_batch(&db, SLO, Writer::Incremental, 102, (0, 1), 1, 1)
            .await
            .unwrap();
        commit_batch(&db, &retire).await.unwrap();

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.good, Some(0.0), "the trailing edge subtracted");
    }

    // ===================== failure injection: the crash ===================

    /// The signature of a crash between the columnar write and the commit: the
    /// manifest survives, and nothing else moved.
    #[tokio::test]
    async fn a_crash_after_reserve_leaves_the_manifest_and_nothing_else() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (9_000, 9_300), 1, 1)
            .await
            .unwrap();
        // ...rows were written to the stream here, then the process died.

        let pending = load_pending(&db, SLO, Writer::Incremental)
            .await
            .unwrap()
            .expect("the manifest must survive the crash");
        assert_eq!(pending.batch_rev, 101);
        assert_eq!((pending.range_start, pending.range_end), (9_000, 9_300));

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(
            status.committed_batch_rev_incr, None,
            "the mark must not have moved"
        );
        assert_eq!(status.watermark_end, None);
        assert_eq!(status.good, None, "no delta may have been applied");
    }

    /// Recovery abandons the torn number, allocates a fresh one, and records
    /// both facts in the SAME transaction — so a second crash cannot leave the
    /// batch half-abandoned.
    #[tokio::test]
    async fn recovery_abandons_the_torn_batch_atomically_with_its_replacement() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (9_000, 9_300), 1, 1)
            .await
            .unwrap();
        // crash

        // Recovery: fresh number, abandoning 101.
        reserve_batch(&db, SLO, Writer::Incremental, 102, (8_700, 11_100), 1, 2)
            .await
            .unwrap();
        let mut repair = commit_of(102, 1);
        repair.abandon = Some(101);
        assert_eq!(
            commit_batch(&db, &repair).await.unwrap(),
            CommitOutcome::Committed
        );

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        let abandoned: Vec<i64> =
            serde_json::from_value(status.abandoned_batch_revs.clone().unwrap()).unwrap();
        assert_eq!(abandoned, vec![101]);
        assert_eq!(status.committed_batch_rev_incr, Some(102));
        assert!(
            load_pending(&db, SLO, Writer::Incremental)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn repeated_abandonments_accumulate_rather_than_replace() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        for (batch, abandon) in [(102, 101), (104, 103)] {
            reserve_batch(&db, SLO, Writer::Incremental, batch, (0, 1), 1, 1)
                .await
                .unwrap();
            let mut c = commit_of(batch, 1);
            c.abandon = Some(abandon);
            commit_batch(&db, &c).await.unwrap();
        }
        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        let abandoned: Vec<i64> =
            serde_json::from_value(status.abandoned_batch_revs.clone().unwrap()).unwrap();
        assert_eq!(
            abandoned,
            vec![101, 103],
            "losing an earlier abandonment would republish its orphans"
        );
    }

    // ===================== failure injection: atomicity ===================

    /// The whole commit is one transaction. A failure part-way must leave
    /// **nothing** behind — not the deltas, not the mark, not the watermark,
    /// not the abandonment, and not the manifest clear.
    #[tokio::test]
    async fn a_failed_commit_leaves_no_partial_state() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (9_000, 9_300), 1, 1)
            .await
            .unwrap();

        // Do the work inside a transaction, then abort instead of committing —
        // exactly what a crash mid-transaction looks like to the database.
        let txn = db.begin().await.unwrap();
        let mut c = commit_of(101, 1);
        c.abandon = Some(100);
        commit_batch_in_txn(&txn, &c).await.unwrap();
        txn.rollback().await.unwrap();

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.committed_batch_rev_incr, None, "mark leaked");
        assert_eq!(status.watermark_end, None, "watermark leaked");
        assert_eq!(status.good, None, "delta leaked");
        assert_eq!(status.abandoned_batch_revs, None, "abandonment leaked");
        assert!(
            load_pending(&db, SLO, Writer::Incremental)
                .await
                .unwrap()
                .is_some(),
            "the manifest must survive a failed commit, or the torn batch \
             becomes unrecoverable"
        );
    }

    /// The manifest clear is part of the same transaction — losing only that
    /// would make the next pass repair a batch that already committed,
    /// abandoning a *live* batch number.
    #[tokio::test]
    async fn the_manifest_clear_is_atomic_with_the_marks() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (0, 1), 1, 1)
            .await
            .unwrap();

        let txn = db.begin().await.unwrap();
        commit_batch_in_txn(&txn, &commit_of(101, 1)).await.unwrap();
        txn.commit().await.unwrap();

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.committed_batch_rev_incr, Some(101));
        assert!(
            load_pending(&db, SLO, Writer::Incremental)
                .await
                .unwrap()
                .is_none(),
            "mark advanced but manifest survived — the next pass would abandon \
             a committed batch"
        );
    }

    // ===================== failure injection: the CAS fence ===============

    /// A writer that outlived a computation edit must fail its commit, not
    /// advance the new generation's marks with the old definition's
    /// arithmetic (D59).
    #[tokio::test]
    async fn a_commit_from_a_superseded_generation_is_fenced() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (0, 1), 1, 1)
            .await
            .unwrap();

        // A computation edit lands while the pass is in flight.
        bump_generation(&db, SLO, 2, 10_000).await.unwrap();

        let outcome = commit_batch(&db, &commit_of(101, 1)).await.unwrap();
        assert_eq!(
            outcome,
            CommitOutcome::FencedByGeneration {
                expected: 1,
                found: 2
            }
        );

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.definition_generation, 2);
        assert_eq!(
            status.committed_batch_rev_incr, None,
            "the fenced writer must not have advanced the new generation's mark"
        );
        assert_eq!(status.good, None, "nor applied its deltas");
    }

    #[tokio::test]
    async fn a_fenced_commit_leaves_the_manifest_for_the_next_pass() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (0, 1), 1, 1)
            .await
            .unwrap();
        bump_generation(&db, SLO, 2, 10_000).await.unwrap();
        commit_batch(&db, &commit_of(101, 1)).await.unwrap();

        assert!(
            load_pending(&db, SLO, Writer::Incremental)
                .await
                .unwrap()
                .is_some(),
            "the orphaned rows still need abandoning by whoever runs next"
        );
    }

    #[tokio::test]
    async fn a_generation_bump_clears_the_running_aggregate() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (0, 1), 1, 1)
            .await
            .unwrap();
        commit_batch(&db, &commit_of(101, 1)).await.unwrap();

        bump_generation(&db, SLO, 2, 10_000).await.unwrap();
        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.definition_generation, 2);
        assert_eq!(
            status.good, None,
            "the old generation's arithmetic must not survive into the new one"
        );
        assert_eq!(status.watermark_end, None, "the barrier resets");
        assert_eq!(status.committed_batch_rev_incr, None);
    }

    // ===================== concurrent writers =============================

    /// Incremental and backfill hold independent marks. One committing must
    /// never move the other's — that is what stops a high incremental mark
    /// from publishing a torn backfill batch (D58).
    #[tokio::test]
    async fn the_two_writers_advance_independent_marks() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();

        reserve_batch(&db, SLO, Writer::Incremental, 900, (0, 1), 1, 1)
            .await
            .unwrap();
        commit_batch(&db, &commit_of(900, 1)).await.unwrap();

        reserve_batch(&db, SLO, Writer::Backfill, 5, (0, 1), 1, 1)
            .await
            .unwrap();
        let mut bf = commit_of(5, 1);
        bf.writer = Writer::Backfill;
        bf.watermark_end = None; // backfill never touches the watermark
        commit_batch(&db, &bf).await.unwrap();

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(status.committed_batch_rev_incr, Some(900));
        assert_eq!(status.committed_batch_rev_bf, Some(5));
        assert_eq!(
            status.watermark_end,
            Some(9_900),
            "backfill must not have moved the watermark"
        );
    }

    #[tokio::test]
    async fn each_writer_keeps_its_own_manifest() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (9_000, 9_300), 1, 1)
            .await
            .unwrap();
        reserve_batch(&db, SLO, Writer::Backfill, 7, (0, 3_000), 1, 1)
            .await
            .unwrap();

        // Committing one must not clear the other's outstanding intent.
        commit_batch(&db, &commit_of(101, 1)).await.unwrap();
        assert!(
            load_pending(&db, SLO, Writer::Incremental)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            load_pending(&db, SLO, Writer::Backfill)
                .await
                .unwrap()
                .is_some(),
            "backfill's torn batch must still be recoverable"
        );
    }

    /// Both writers committing at once must serialize into a consistent row,
    /// not interleave into a lost update.
    #[tokio::test]
    async fn concurrent_commits_do_not_lose_an_update() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (0, 1), 1, 1)
            .await
            .unwrap();
        reserve_batch(&db, SLO, Writer::Backfill, 7, (0, 1), 1, 1)
            .await
            .unwrap();

        let mut bf = commit_of(7, 1);
        bf.writer = Writer::Backfill;
        bf.watermark_end = None;
        bf.deltas = vec![delta(ROLLUP, 3.0, 3.0, 1)];

        // Sequenced rather than raced: SQLite serializes writers anyway, so a
        // race would only make this flaky, not more truthful. What must hold
        // is that neither writer's delta is lost.
        commit_batch(&db, &commit_of(101, 1)).await.unwrap();
        commit_batch(&db, &bf).await.unwrap();

        let status = load_status(&db, SLO, ROLLUP).await.unwrap().unwrap();
        assert_eq!(
            status.good,
            Some(13.0),
            "both writers' deltas must survive: 10 + 3"
        );
        assert_eq!(status.committed_batch_rev_incr, Some(101));
        assert_eq!(status.committed_batch_rev_bf, Some(7));
    }

    // ===================== per-group rows =================================

    #[tokio::test]
    async fn per_group_deltas_land_on_their_own_rows() {
        let db = db().await;
        init_generation(&db, SLO, 1, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (0, 1), 1, 1)
            .await
            .unwrap();
        commit_batch(&db, &commit_of(101, 1)).await.unwrap();

        let group = load_status(&db, SLO, "region:eu").await.unwrap().unwrap();
        assert_eq!(group.good, Some(5.0));
        assert_eq!(
            group.committed_batch_rev_incr, None,
            "only the rollup row carries commit state"
        );
    }

    #[tokio::test]
    async fn a_group_row_inherits_the_generation_it_was_written_under() {
        let db = db().await;
        init_generation(&db, SLO, 3, 0).await.unwrap();
        reserve_batch(&db, SLO, Writer::Incremental, 101, (0, 1), 3, 1)
            .await
            .unwrap();
        commit_batch(&db, &commit_of(101, 3)).await.unwrap();

        let group = load_status(&db, SLO, "region:eu").await.unwrap().unwrap();
        assert_eq!(group.definition_generation, 3);
    }
}
