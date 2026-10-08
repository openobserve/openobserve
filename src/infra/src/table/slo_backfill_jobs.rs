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

//! Backfill job state (`alerts_2.md` §6b.8, S-11).
//!
//! Keyed by `(slo_id, definition_generation)`, not by `slo_id` alone: a
//! generation bump starts a *different* backfill over a different definition,
//! and inheriting the old one's progress would leave a hole exactly where the
//! new definition's history should be.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    Set,
    sea_query::{Expr, OnConflict},
};

use super::entity::slo_backfill_jobs;
use crate::errors::Error;

pub const STATE_QUEUED: i32 = 1;
pub const STATE_RUNNING: i32 = 2;
pub const STATE_DONE: i32 = 3;
pub const STATE_FAILED: i32 = 4;
pub const STATE_CANCELLED: i32 = 5;

pub const KIND_BACKFILL: &str = "backfill";
/// Re-measures slices a downtime corrected or un-corrected (D8).
pub const KIND_REMEASURE: &str = "remeasure";

/// Retries of [extend_range] when another writer changed the row between its read and write.
const EXTEND_ATTEMPTS: usize = 5;

pub async fn get(
    db: &DatabaseConnection,
    slo_id: &str,
    generation: i32,
) -> Result<Option<slo_backfill_jobs::Model>, Error> {
    Ok(
        slo_backfill_jobs::Entity::find_by_id((slo_id.to_string(), generation))
            .one(db)
            .await?,
    )
}

/// Queue a backfill. Idempotent: re-queueing an existing job leaves its
/// progress alone, so a retried save cannot restart a half-finished fill.
pub async fn queue(
    db: &DatabaseConnection,
    slo_id: &str,
    generation: i32,
    range_start: i64,
    range_end: i64,
    now: i64,
) -> Result<(), Error> {
    if get(db, slo_id, generation).await?.is_some() {
        return Ok(());
    }

    slo_backfill_jobs::ActiveModel {
        slo_id: Set(slo_id.to_string()),
        definition_generation: Set(generation),
        state: Set(STATE_QUEUED),
        range_start: Set(range_start),
        range_end: Set(range_end),
        done_through: Set(None),
        rows_written: Set(0),
        error: Set(None),
        updated_at: Set(now),
        kind: Set(KIND_BACKFILL.to_string()),
    }
    .insert(db)
    .await?;
    Ok(())
}

/// Queue a re-measure of `[range_start, range_end)`, widening the generation's job if one exists.
pub async fn queue_remeasure(
    db: &DatabaseConnection,
    slo_id: &str,
    generation: i32,
    range_start: i64,
    range_end: i64,
    now: i64,
) -> Result<(), Error> {
    let job = slo_backfill_jobs::ActiveModel {
        slo_id: Set(slo_id.to_string()),
        definition_generation: Set(generation),
        state: Set(STATE_QUEUED),
        range_start: Set(range_start),
        range_end: Set(range_end),
        done_through: Set(None),
        rows_written: Set(0),
        error: Set(None),
        updated_at: Set(now),
        kind: Set(KIND_REMEASURE.to_string()),
    };
    let inserted = slo_backfill_jobs::Entity::insert(job)
        .on_conflict(
            OnConflict::columns([
                slo_backfill_jobs::Column::SloId,
                slo_backfill_jobs::Column::DefinitionGeneration,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec_without_returning(db)
        .await?;
    if inserted == 0 {
        return extend_range(db, slo_id, generation, range_start, range_end, now).await;
    }
    Ok(())
}

/// Makes the job a re-measure of the range and restarts its walk; an unfinished job is widened.
pub async fn extend_range(
    db: &DatabaseConnection,
    slo_id: &str,
    generation: i32,
    range_start: i64,
    range_end: i64,
    now: i64,
) -> Result<(), Error> {
    for _ in 0..EXTEND_ATTEMPTS {
        let Some(model) = get(db, slo_id, generation).await? else {
            return Ok(());
        };
        let (start, end) = extended_range(&model, range_start, range_end);
        let res = slo_backfill_jobs::Entity::update_many()
            .col_expr(slo_backfill_jobs::Column::State, Expr::value(STATE_QUEUED))
            .col_expr(slo_backfill_jobs::Column::RangeStart, Expr::value(start))
            .col_expr(slo_backfill_jobs::Column::RangeEnd, Expr::value(end))
            .col_expr(
                slo_backfill_jobs::Column::DoneThrough,
                Expr::value(Option::<i64>::None),
            )
            .col_expr(
                slo_backfill_jobs::Column::Error,
                Expr::value(Option::<String>::None),
            )
            .col_expr(
                slo_backfill_jobs::Column::UpdatedAt,
                Expr::value(next_updated_at(model.updated_at, now)),
            )
            .col_expr(slo_backfill_jobs::Column::Kind, Expr::value(KIND_REMEASURE))
            .filter(slo_backfill_jobs::Column::SloId.eq(slo_id))
            .filter(slo_backfill_jobs::Column::DefinitionGeneration.eq(generation))
            .filter(slo_backfill_jobs::Column::UpdatedAt.eq(model.updated_at))
            .exec(db)
            .await?;
        if res.rows_affected > 0 {
            return Ok(());
        }
    }
    Err(Error::Message(format!(
        "SLO backfill job {slo_id}/{generation} kept changing while its range was widened"
    )))
}

/// The `updated_at` a CAS write stores: always past `expected`, so a stale writer fails.
pub fn next_updated_at(expected: i64, now: i64) -> i64 {
    now.max(expected.saturating_add(1))
}

fn extended_range(model: &slo_backfill_jobs::Model, start: i64, end: i64) -> (i64, i64) {
    let finished = matches!(model.state, STATE_DONE | STATE_CANCELLED | STATE_FAILED);
    if finished {
        (start, end)
    } else {
        (model.range_start.min(start), model.range_end.max(end))
    }
}

/// Records a chunk (`done_through` is the earliest point filled); false if the row changed.
pub async fn record_progress(
    db: &DatabaseConnection,
    slo_id: &str,
    generation: i32,
    done_through: i64,
    rows_written: i64,
    expected_updated_at: i64,
    now: i64,
) -> Result<bool, Error> {
    let res = slo_backfill_jobs::Entity::update_many()
        .col_expr(slo_backfill_jobs::Column::State, Expr::value(STATE_RUNNING))
        .col_expr(
            slo_backfill_jobs::Column::DoneThrough,
            Expr::value(Some(done_through)),
        )
        .col_expr(
            slo_backfill_jobs::Column::RowsWritten,
            Expr::col(slo_backfill_jobs::Column::RowsWritten).add(rows_written),
        )
        .col_expr(
            slo_backfill_jobs::Column::UpdatedAt,
            Expr::value(next_updated_at(expected_updated_at, now)),
        )
        .filter(slo_backfill_jobs::Column::SloId.eq(slo_id))
        .filter(slo_backfill_jobs::Column::DefinitionGeneration.eq(generation))
        .filter(slo_backfill_jobs::Column::UpdatedAt.eq(expected_updated_at))
        .exec(db)
        .await?;
    Ok(res.rows_affected > 0)
}

pub async fn mark_done<C: ConnectionTrait>(
    db: &C,
    slo_id: &str,
    generation: i32,
    expected_updated_at: i64,
    now: i64,
) -> Result<bool, Error> {
    set_state(
        db,
        slo_id,
        generation,
        STATE_DONE,
        None,
        expected_updated_at,
        now,
    )
    .await
}

pub async fn mark_failed(
    db: &DatabaseConnection,
    slo_id: &str,
    generation: i32,
    error: &str,
    expected_updated_at: i64,
    now: i64,
) -> Result<bool, Error> {
    set_state(
        db,
        slo_id,
        generation,
        STATE_FAILED,
        Some(error),
        expected_updated_at,
        now,
    )
    .await
}

pub async fn cancel(
    db: &DatabaseConnection,
    slo_id: &str,
    generation: i32,
    expected_updated_at: i64,
    now: i64,
) -> Result<bool, Error> {
    set_state(
        db,
        slo_id,
        generation,
        STATE_CANCELLED,
        None,
        expected_updated_at,
        now,
    )
    .await
}

/// False, writing nothing, if the row changed since it was read at `expected_updated_at`.
async fn set_state<C: ConnectionTrait>(
    db: &C,
    slo_id: &str,
    generation: i32,
    state: i32,
    error: Option<&str>,
    expected_updated_at: i64,
    now: i64,
) -> Result<bool, Error> {
    let mut update = slo_backfill_jobs::Entity::update_many()
        .col_expr(slo_backfill_jobs::Column::State, Expr::value(state))
        .col_expr(
            slo_backfill_jobs::Column::UpdatedAt,
            Expr::value(next_updated_at(expected_updated_at, now)),
        );
    if let Some(e) = error {
        update = update.col_expr(slo_backfill_jobs::Column::Error, Expr::value(e));
    }
    let res = update
        .filter(slo_backfill_jobs::Column::SloId.eq(slo_id))
        .filter(slo_backfill_jobs::Column::DefinitionGeneration.eq(generation))
        .filter(slo_backfill_jobs::Column::UpdatedAt.eq(expected_updated_at))
        .exec(db)
        .await?;
    Ok(res.rows_affected > 0)
}

/// Drop every job for an SLO — used when the SLO itself is deleted.
pub async fn delete_all(db: &DatabaseConnection, slo_id: &str) -> Result<(), Error> {
    slo_backfill_jobs::Entity::delete_many()
        .filter(slo_backfill_jobs::Column::SloId.eq(slo_id))
        .exec(db)
        .await?;
    Ok(())
}

/// Drop every job belonging to an org's SLOs — the org-teardown path.
///
/// Jobs carry no org of their own, so the ids come from `slos`. This therefore
/// has to run BEFORE `slos::delete_by_org`, or there is nothing left to
/// resolve through.
pub async fn delete_by_org(db: &DatabaseConnection, org: &str) -> Result<(), Error> {
    let slo_ids = super::slos::ids_in_org(db, org).await?;
    if slo_ids.is_empty() {
        return Ok(());
    }

    slo_backfill_jobs::Entity::delete_many()
        .filter(slo_backfill_jobs::Column::SloId.is_in(slo_ids))
        .exec(db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;

    use super::*;
    // Jobs carry no org column, so the org lives one hop away in `slos` —
    // the by-org tests need a real row there to resolve through.
    use crate::table::{
        migration::create_slo_tables_for_test, slos::insert_for_test as register_slo,
    };

    const SLO: &str = "slo1";

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_slo_tables_for_test(&db).await.unwrap();
        db
    }

    async fn version(db: &DatabaseConnection, slo_id: &str, generation: i32) -> i64 {
        get(db, slo_id, generation)
            .await
            .unwrap()
            .map_or(0, |j| j.updated_at)
    }

    /// [record_progress] against the row as it is now, as a chunk that just loaded it.
    async fn progress(
        db: &DatabaseConnection,
        slo_id: &str,
        generation: i32,
        done_through: i64,
        rows_written: i64,
    ) -> Result<bool, Error> {
        let expected = version(db, slo_id, generation).await;
        record_progress(
            db,
            slo_id,
            generation,
            done_through,
            rows_written,
            expected,
            0,
        )
        .await
    }

    async fn done(db: &DatabaseConnection, slo_id: &str, generation: i32) -> Result<bool, Error> {
        let expected = version(db, slo_id, generation).await;
        mark_done(db, slo_id, generation, expected, 0).await
    }

    #[tokio::test]
    async fn a_queued_job_starts_with_no_progress() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        let j = get(&db, SLO, 1).await.unwrap().unwrap();
        assert_eq!(j.state, STATE_QUEUED);
        assert_eq!(j.done_through, None);
        assert_eq!(j.rows_written, 0);
    }

    /// A retried save must not restart a half-finished fill.
    #[tokio::test]
    async fn requeueing_leaves_existing_progress_alone() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        progress(&db, SLO, 1, 300, 50).await.unwrap();
        queue(&db, SLO, 1, 0, 900, 200).await.unwrap();

        let j = get(&db, SLO, 1).await.unwrap().unwrap();
        assert_eq!(j.done_through, Some(300), "progress was reset");
        assert_eq!(j.rows_written, 50);
    }

    #[tokio::test]
    async fn progress_accumulates_rows_but_replaces_the_resume_point() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        progress(&db, SLO, 1, 600, 10).await.unwrap();
        progress(&db, SLO, 1, 300, 20).await.unwrap();

        let j = get(&db, SLO, 1).await.unwrap().unwrap();
        assert_eq!(j.done_through, Some(300), "the walk runs backwards");
        assert_eq!(j.rows_written, 30);
        assert_eq!(j.state, STATE_RUNNING);
    }

    /// A generation bump starts a different backfill over a different
    /// definition. Inheriting the old progress would leave a hole exactly
    /// where the new definition's history should be.
    #[tokio::test]
    async fn a_new_generation_gets_its_own_job() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        progress(&db, SLO, 1, 300, 50).await.unwrap();
        queue(&db, SLO, 2, 0, 900, 100).await.unwrap();

        assert_eq!(get(&db, SLO, 2).await.unwrap().unwrap().done_through, None);
        assert_eq!(
            get(&db, SLO, 1).await.unwrap().unwrap().done_through,
            Some(300),
            "the old generation's job was disturbed"
        );
    }

    #[tokio::test]
    async fn a_job_can_be_completed_failed_or_cancelled() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        assert!(done(&db, SLO, 1).await.unwrap());
        assert_eq!(get(&db, SLO, 1).await.unwrap().unwrap().state, STATE_DONE);

        queue(&db, SLO, 2, 0, 900, 100).await.unwrap();
        assert!(
            mark_failed(&db, SLO, 2, "search timeout", version(&db, SLO, 2).await, 0)
                .await
                .unwrap()
        );
        let j = get(&db, SLO, 2).await.unwrap().unwrap();
        assert_eq!(j.state, STATE_FAILED);
        assert_eq!(j.error.as_deref(), Some("search timeout"));

        queue(&db, SLO, 3, 0, 900, 100).await.unwrap();
        assert!(
            cancel(&db, SLO, 3, version(&db, SLO, 3).await, 0)
                .await
                .unwrap()
        );
        assert_eq!(
            get(&db, SLO, 3).await.unwrap().unwrap().state,
            STATE_CANCELLED
        );
    }

    #[tokio::test]
    async fn progress_on_a_missing_job_is_a_no_op() {
        let db = db().await;
        progress(&db, SLO, 9, 300, 50).await.unwrap();
        assert!(get(&db, SLO, 9).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn deleting_an_slo_drops_every_generations_job() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        queue(&db, SLO, 2, 0, 900, 100).await.unwrap();
        queue(&db, "other", 1, 0, 900, 100).await.unwrap();

        delete_all(&db, SLO).await.unwrap();
        assert!(get(&db, SLO, 1).await.unwrap().is_none());
        assert!(get(&db, SLO, 2).await.unwrap().is_none());
        assert!(
            get(&db, "other", 1).await.unwrap().is_some(),
            "another SLO's job was deleted"
        );
    }

    // ===================== org teardown ===================================

    const ORG: &str = "acme";
    const OTHER_ORG: &str = "globex";
    const OTHER_SLO: &str = "slo2";

    #[tokio::test]
    async fn delete_by_org_removes_every_generations_job_for_the_orgs_slos() {
        let db = db().await;
        register_slo(&db, ORG, SLO).await;
        register_slo(&db, ORG, OTHER_SLO).await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        queue(&db, SLO, 2, 0, 900, 100).await.unwrap();
        queue(&db, OTHER_SLO, 1, 0, 900, 100).await.unwrap();

        delete_by_org(&db, ORG).await.unwrap();
        assert!(get(&db, SLO, 1).await.unwrap().is_none());
        assert!(get(&db, SLO, 2).await.unwrap().is_none());
        assert!(get(&db, OTHER_SLO, 1).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_by_org_leaves_another_orgs_jobs_alone() {
        let db = db().await;
        register_slo(&db, ORG, SLO).await;
        register_slo(&db, OTHER_ORG, OTHER_SLO).await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        queue(&db, OTHER_SLO, 1, 0, 900, 100).await.unwrap();

        delete_by_org(&db, ORG).await.unwrap();
        assert!(get(&db, SLO, 1).await.unwrap().is_none());
        assert!(
            get(&db, OTHER_SLO, 1).await.unwrap().is_some(),
            "another org's backfill job was deleted"
        );
    }

    /// Org cleanup retries steps, so a second pass must find nothing and
    /// still succeed.
    #[tokio::test]
    async fn delete_by_org_on_an_org_with_no_slos_is_a_no_op() {
        let db = db().await;
        register_slo(&db, OTHER_ORG, OTHER_SLO).await;
        queue(&db, OTHER_SLO, 1, 0, 900, 100).await.unwrap();

        delete_by_org(&db, ORG).await.unwrap();
        delete_by_org(&db, ORG).await.unwrap();
        assert!(get(&db, OTHER_SLO, 1).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn a_remeasure_on_a_fresh_generation_is_its_own_job() {
        let db = db().await;
        queue_remeasure(&db, SLO, 1, 300, 600, 100).await.unwrap();
        let j = get(&db, SLO, 1).await.unwrap().unwrap();
        assert_eq!(j.kind, KIND_REMEASURE);
        assert_eq!((j.range_start, j.range_end), (300, 600));
        assert_eq!(j.state, STATE_QUEUED);
    }

    #[tokio::test]
    async fn a_remeasure_replaces_a_finished_backfill_and_restarts_the_walk() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        progress(&db, SLO, 1, 0, 50).await.unwrap();
        done(&db, SLO, 1).await.unwrap();
        queue_remeasure(&db, SLO, 1, 300, 600, 200).await.unwrap();

        let j = get(&db, SLO, 1).await.unwrap().unwrap();
        assert_eq!(j.kind, KIND_REMEASURE);
        assert_eq!((j.range_start, j.range_end), (300, 600));
        assert_eq!(j.done_through, None, "the walk must restart");
        assert_eq!(j.state, STATE_QUEUED);
    }

    #[tokio::test]
    async fn a_remeasure_widens_an_unfinished_job() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        progress(&db, SLO, 1, 600, 10).await.unwrap();
        extend_range(&db, SLO, 1, 800, 1_200, 200).await.unwrap();

        let j = get(&db, SLO, 1).await.unwrap().unwrap();
        assert_eq!((j.range_start, j.range_end), (0, 1_200));
        assert_eq!(j.done_through, None);
        assert_eq!(j.kind, KIND_REMEASURE);
    }

    #[tokio::test]
    async fn a_plain_backfill_is_queued_as_backfill() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        assert_eq!(get(&db, SLO, 1).await.unwrap().unwrap().kind, KIND_BACKFILL);
    }

    /// A chunk that loaded the job before a re-measure reset it must not write over the reset.
    #[tokio::test]
    async fn a_stale_chunk_records_no_progress() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        let loaded = version(&db, SLO, 1).await;
        queue_remeasure(&db, SLO, 1, 300, 600, 100).await.unwrap();
        let reset = get(&db, SLO, 1).await.unwrap().unwrap();
        assert_ne!(
            reset.updated_at, loaded,
            "a reset in the same second still moves the version"
        );

        assert!(
            !record_progress(&db, SLO, 1, 300, 50, loaded, 100)
                .await
                .unwrap()
        );
        assert_eq!(get(&db, SLO, 1).await.unwrap().unwrap(), reset);
    }

    #[tokio::test]
    async fn a_stale_mark_done_leaves_the_requeued_job_queued() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        let loaded = version(&db, SLO, 1).await;
        assert!(
            record_progress(&db, SLO, 1, 0, 5, loaded, 150)
                .await
                .unwrap()
        );
        let after_chunk = next_updated_at(loaded, 150);
        assert_eq!(version(&db, SLO, 1).await, after_chunk);
        queue_remeasure(&db, SLO, 1, 300, 600, 150).await.unwrap();

        assert!(!mark_done(&db, SLO, 1, after_chunk, 150).await.unwrap());
        let j = get(&db, SLO, 1).await.unwrap().unwrap();
        assert_eq!(j.state, STATE_QUEUED);
        assert_eq!(j.kind, KIND_REMEASURE);
        assert!(!cancel(&db, SLO, 1, after_chunk, 150).await.unwrap());
        assert!(
            !mark_failed(&db, SLO, 1, "x", after_chunk, 150)
                .await
                .unwrap()
        );
        assert_eq!(get(&db, SLO, 1).await.unwrap().unwrap(), j);
    }

    #[tokio::test]
    async fn two_remeasures_of_one_job_end_in_one_row_covering_both() {
        let db = db().await;
        let (a, b) = tokio::join!(
            queue_remeasure(&db, SLO, 1, 300, 600, 100),
            queue_remeasure(&db, SLO, 1, 500, 900, 100)
        );
        a.unwrap();
        b.unwrap();
        queue_remeasure(&db, SLO, 1, 100, 200, 100).await.unwrap();

        let rows = slo_backfill_jobs::Entity::find().all(&db).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].range_start, rows[0].range_end), (100, 900));
        assert_eq!(rows[0].state, STATE_QUEUED);
    }

    #[test]
    fn the_next_version_always_moves_forward() {
        assert_eq!(next_updated_at(100, 200), 200);
        assert_eq!(next_updated_at(100, 100), 101);
        assert_eq!(
            next_updated_at(100, 50),
            101,
            "a clock behind the row still moves it"
        );
    }
}
