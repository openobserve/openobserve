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
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, IntoActiveModel, QueryFilter,
    Set,
};

use super::entity::slo_backfill_jobs;
use crate::errors::Error;

pub const STATE_QUEUED: i32 = 1;
pub const STATE_RUNNING: i32 = 2;
pub const STATE_DONE: i32 = 3;
pub const STATE_FAILED: i32 = 4;
pub const STATE_CANCELLED: i32 = 5;

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
    }
    .insert(db)
    .await?;
    Ok(())
}

/// Record a completed chunk. `done_through` is the earliest point filled,
/// because the walk runs backwards from the present.
pub async fn record_progress(
    db: &DatabaseConnection,
    slo_id: &str,
    generation: i32,
    done_through: i64,
    rows_written: i64,
) -> Result<(), Error> {
    let Some(model) = get(db, slo_id, generation).await? else {
        return Ok(());
    };
    let previous = model.rows_written;
    let mut active = model.into_active_model();
    active.state = Set(STATE_RUNNING);
    active.done_through = Set(Some(done_through));
    active.rows_written = Set(previous + rows_written);
    active.update(db).await?;
    Ok(())
}

pub async fn mark_done(
    db: &DatabaseConnection,
    slo_id: &str,
    generation: i32,
) -> Result<(), Error> {
    set_state(db, slo_id, generation, STATE_DONE, None).await
}

pub async fn mark_failed(
    db: &DatabaseConnection,
    slo_id: &str,
    generation: i32,
    error: &str,
) -> Result<(), Error> {
    set_state(db, slo_id, generation, STATE_FAILED, Some(error)).await
}

pub async fn cancel(db: &DatabaseConnection, slo_id: &str, generation: i32) -> Result<(), Error> {
    set_state(db, slo_id, generation, STATE_CANCELLED, None).await
}

async fn set_state(
    db: &DatabaseConnection,
    slo_id: &str,
    generation: i32,
    state: i32,
    error: Option<&str>,
) -> Result<(), Error> {
    let Some(model) = get(db, slo_id, generation).await? else {
        return Ok(());
    };
    let mut active = model.into_active_model();
    active.state = Set(state);
    if let Some(e) = error {
        active.error = Set(Some(e.to_string()));
    }
    active.update(db).await?;
    Ok(())
}

/// Drop every job for an SLO — used when the SLO itself is deleted.
pub async fn delete_all(db: &DatabaseConnection, slo_id: &str) -> Result<(), Error> {
    slo_backfill_jobs::Entity::delete_many()
        .filter(slo_backfill_jobs::Column::SloId.eq(slo_id))
        .exec(db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;

    use super::*;
    use crate::table::migration::create_slo_tables_for_test;

    const SLO: &str = "slo1";

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_slo_tables_for_test(&db).await.unwrap();
        db
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
        record_progress(&db, SLO, 1, 300, 50).await.unwrap();
        queue(&db, SLO, 1, 0, 900, 200).await.unwrap();

        let j = get(&db, SLO, 1).await.unwrap().unwrap();
        assert_eq!(j.done_through, Some(300), "progress was reset");
        assert_eq!(j.rows_written, 50);
    }

    #[tokio::test]
    async fn progress_accumulates_rows_but_replaces_the_resume_point() {
        let db = db().await;
        queue(&db, SLO, 1, 0, 900, 100).await.unwrap();
        record_progress(&db, SLO, 1, 600, 10).await.unwrap();
        record_progress(&db, SLO, 1, 300, 20).await.unwrap();

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
        record_progress(&db, SLO, 1, 300, 50).await.unwrap();
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
        mark_done(&db, SLO, 1).await.unwrap();
        assert_eq!(get(&db, SLO, 1).await.unwrap().unwrap().state, STATE_DONE);

        queue(&db, SLO, 2, 0, 900, 100).await.unwrap();
        mark_failed(&db, SLO, 2, "search timeout").await.unwrap();
        let j = get(&db, SLO, 2).await.unwrap().unwrap();
        assert_eq!(j.state, STATE_FAILED);
        assert_eq!(j.error.as_deref(), Some("search timeout"));

        queue(&db, SLO, 3, 0, 900, 100).await.unwrap();
        cancel(&db, SLO, 3).await.unwrap();
        assert_eq!(
            get(&db, SLO, 3).await.unwrap().unwrap().state,
            STATE_CANCELLED
        );
    }

    #[tokio::test]
    async fn progress_on_a_missing_job_is_a_no_op() {
        let db = db().await;
        record_progress(&db, SLO, 9, 300, 50).await.unwrap();
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
}
