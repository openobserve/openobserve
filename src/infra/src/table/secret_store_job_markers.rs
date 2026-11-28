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

//! `secret_store_job_markers`: `(job, org_id)` done markers, plus deployment-wide markers
//! under `org_id = _meta`.

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, sea_query};

pub use super::entity::secret_store_job_markers::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors::Error};

/// `org_id` of a deployment-wide marker; org cleanup never deletes it.
pub const META_ORG: &str = "_meta";
pub const SYNTHETICS_WRITE_ONLY: &str = "synthetics_write_only";
pub const TOKENLESS_RECORDER: &str = "tokenless_recorder";
pub const AGENT_TOKEN_CUTOVER: &str = "agent_token_cutover";
pub const ORIGINS_BACKFILL: &str = "origins_backfill";
/// `org_id` of a fill marker that covers every org.
pub const ALL_ORGS: &str = "_all";
pub const FILL_ENV_INCARNATION: &str = "fill_env_incarnation";
pub const FILL_ORG_INCARNATION: &str = "fill_org_incarnation";

pub async fn get_marker_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    job: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Job.eq(job))
        .one(conn)
        .await?)
}

/// Writes the marker unless one exists, so the first writer's `done_at` stands; true when
/// this call wrote it.
pub async fn insert_if_absent_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    job: &str,
    done_at: i64,
) -> Result<bool, Error> {
    let row = ActiveModel {
        job: Set(job.to_string()),
        org_id: Set(org_id.to_string()),
        done_at: Set(done_at),
    };
    let written = Entity::insert(row)
        .on_conflict(
            sea_query::OnConflict::columns([Column::Job, Column::OrgId])
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(written > 0)
}

/// Stamps `now` and returns true only when the last stamp is at least `min_gap` old.
pub async fn claim_due_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    job: &str,
    now: i64,
    min_gap: i64,
) -> Result<bool, Error> {
    if insert_if_absent_in(conn, org_id, job, now).await? {
        return Ok(true);
    }
    let res = Entity::update_many()
        .col_expr(Column::DoneAt, sea_query::Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Job.eq(job))
        .filter(Column::DoneAt.lte(now.saturating_sub(min_gap)))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

pub async fn set_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    job: &str,
    done_at: i64,
) -> Result<(), Error> {
    let row = ActiveModel {
        job: Set(job.to_string()),
        org_id: Set(org_id.to_string()),
        done_at: Set(done_at),
    };
    Entity::insert(row)
        .on_conflict(
            sea_query::OnConflict::columns([Column::Job, Column::OrgId])
                .update_column(Column::DoneAt)
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(())
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    delete_by_org_in(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_in<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<u64, Error> {
    if org_id == META_ORG {
        return Ok(0);
    }
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::table::testing::{meta_store, unique};

    #[tokio::test]
    async fn concurrent_boots_write_each_marker_once_and_the_first_time_stands() {
        if !meta_store().await {
            return;
        }
        let conn = get_orm_client_rw().await;
        let job = unique("tokenless_recorder");
        let (a, b) = tokio::join!(
            insert_if_absent_in(conn, META_ORG, &job, 100),
            insert_if_absent_in(conn, META_ORG, &job, 200),
        );
        let (a, b) = (a.unwrap(), b.unwrap());
        assert!(a ^ b, "exactly one boot writes the marker: {a} {b}");
        let first = if a { 100 } else { 200 };
        assert!(
            !insert_if_absent_in(conn, META_ORG, &job, 300)
                .await
                .unwrap()
        );
        let row = get_marker_in(conn, META_ORG, &job).await.unwrap().unwrap();
        assert_eq!(row.done_at, first);

        assert_eq!(delete_by_org(META_ORG).await.unwrap(), 0);
        assert!(get_marker_in(conn, META_ORG, &job).await.unwrap().is_some());
        Entity::delete_many()
            .filter(Column::OrgId.eq(META_ORG))
            .filter(Column::Job.eq(job.as_str()))
            .exec(conn)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn org_cleanup_removes_only_that_orgs_markers() {
        if !meta_store().await {
            return;
        }
        let conn = get_orm_client_rw().await;
        let (org_a, org_b) = (unique("mk_a"), unique("mk_b"));
        insert_if_absent_in(conn, &org_a, "prescan", 1)
            .await
            .unwrap();
        insert_if_absent_in(conn, &org_b, "prescan", 1)
            .await
            .unwrap();
        assert_eq!(delete_by_org(&org_a).await.unwrap(), 1);
        assert!(
            get_marker_in(conn, &org_a, "prescan")
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            get_marker_in(conn, &org_b, "prescan")
                .await
                .unwrap()
                .is_some()
        );
        delete_by_org(&org_b).await.unwrap();
    }

    #[tokio::test]
    async fn claim_due_runs_once_per_gap_across_racing_nodes() {
        if !meta_store().await {
            return;
        }
        let conn = get_orm_client_rw().await;
        let org = unique("mk_claim");
        assert!(
            claim_due_in(conn, &org, "respell", 1_000, 500)
                .await
                .unwrap()
        );
        let (a, b) = tokio::join!(
            claim_due_in(conn, &org, "respell", 1_200, 500),
            claim_due_in(conn, &org, "respell", 1_300, 500),
        );
        assert!(!a.unwrap() && !b.unwrap(), "inside the gap nobody runs");
        let (a, b) = tokio::join!(
            claim_due_in(conn, &org, "respell", 1_600, 500),
            claim_due_in(conn, &org, "respell", 1_600, 500),
        );
        assert!(
            a.unwrap() ^ b.unwrap(),
            "exactly one node claims a due pass"
        );
        set_in(conn, &org, "respell", 7).await.unwrap();
        let row = get_marker_in(conn, &org, "respell").await.unwrap().unwrap();
        assert_eq!(row.done_at, 7);
        delete_by_org(&org).await.unwrap();
    }
}
