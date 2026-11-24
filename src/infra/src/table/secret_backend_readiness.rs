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

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DatabaseBackend, EntityTrait, QueryFilter, Set,
    Statement, TransactionTrait, sea_query::OnConflict,
};

pub use super::entity::secret_backend_readiness::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors::Error};

pub async fn get_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    backend_id: &str,
    identity_rev: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::BackendId.eq(backend_id))
        .filter(Column::IdentityRev.eq(identity_rev))
        .one(conn)
        .await?)
}

pub async fn pass_in<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    backend_id: &str,
    identity_rev: &str,
    backend_rev: &str,
    passed_at: i64,
) -> Result<(), Error> {
    let txn = conn.begin().await?;
    lock_backend_in(&txn, org_id, backend_id).await?;
    Entity::insert(ActiveModel {
        org_id: Set(org_id.to_owned()),
        backend_id: Set(backend_id.to_owned()),
        identity_rev: Set(identity_rev.to_owned()),
        backend_rev: Set(backend_rev.to_owned()),
        passed_at: Set(passed_at),
    })
    .on_conflict(
        OnConflict::columns([Column::OrgId, Column::BackendId, Column::IdentityRev])
            .update_columns([Column::BackendRev, Column::PassedAt])
            .to_owned(),
    )
    .exec_without_returning(&txn)
    .await?;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::BackendId.eq(backend_id))
        .filter(
            Condition::any()
                .add(Column::IdentityRev.ne(identity_rev))
                .add(Column::BackendRev.ne(backend_rev)),
        )
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

pub async fn withdraw_in<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    backend_id: &str,
) -> Result<u64, Error> {
    let txn = conn.begin().await?;
    lock_backend_in(&txn, org_id, backend_id).await?;
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::BackendId.eq(backend_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(res.rows_affected)
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    delete_by_org_in(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_in<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

async fn lock_backend_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    backend_id: &str,
) -> Result<(), Error> {
    // Concurrent first passes at different identities share no row to lock. SQLite serializes
    // writes.
    if conn.get_database_backend() == DatabaseBackend::Postgres {
        conn.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [format!("secret_backend_readiness/{org_id}/{backend_id}").into()],
        ))
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::PaginatorTrait;

    use super::*;
    use crate::table::testing::{meta_store, unique};

    #[tokio::test]
    async fn readiness_tracks_the_current_backend_and_identity_revisions() {
        if !meta_store().await {
            return;
        }
        let conn = get_orm_client_rw().await;
        let org = unique("backend_readiness");
        let backend = config::ider::ksuid();
        pass_in(conn, &org, &backend, "east:i1", "rev1", 1)
            .await
            .unwrap();
        pass_in(conn, &org, &backend, "east:i1", "rev2", 2)
            .await
            .unwrap();
        let current = get_in(conn, &org, &backend, "east:i1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            (current.backend_rev.as_str(), current.passed_at),
            ("rev2", 2)
        );
        assert!(
            get_in(conn, &org, &backend, "west:i1")
                .await
                .unwrap()
                .is_none()
        );
        pass_in(conn, &org, &backend, "west:i1", "rev2", 3)
            .await
            .unwrap();
        assert!(
            get_in(conn, &org, &backend, "east:i1")
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(withdraw_in(conn, &org, &backend).await.unwrap(), 1);
        assert!(
            get_in(conn, &org, &backend, "west:i1")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn concurrent_first_passes_leave_one_current_identity() {
        if !meta_store().await {
            return;
        }
        let conn = get_orm_client_rw().await;
        let org = unique("backend_parallel");
        let backend = config::ider::ksuid();
        let (east, west) = tokio::join!(
            pass_in(conn, &org, &backend, "east:i1", "r1", 1),
            pass_in(conn, &org, &backend, "west:i1", "r2", 2)
        );
        east.unwrap();
        west.unwrap();
        assert_eq!(
            Entity::find()
                .filter(Column::OrgId.eq(&org))
                .count(conn)
                .await
                .unwrap(),
            1
        );
        delete_by_org(&org).await.unwrap();
    }
}
