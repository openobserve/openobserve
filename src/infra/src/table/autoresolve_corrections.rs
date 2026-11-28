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

//! `autoresolve_corrections`: what a person told a run was wrong; active rows of a saved
//! autoresolve feed its later runs' planning turns.

use config::meta::autoresolve::CorrectionKind;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set, sea_query::Expr,
};
use svix_ksuid::KsuidLike;

use super::entity::autoresolve_corrections::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

#[derive(Debug, Clone)]
pub struct NewCorrection {
    pub org: String,
    pub autoresolve_id: Option<String>,
    pub run_id: String,
    pub revision: i32,
    pub kind: CorrectionKind,
    pub note: String,
    pub option_title: Option<String>,
    pub created_by: String,
    pub created_at_us: i64,
    pub active: bool,
}

pub async fn insert_with<C: ConnectionTrait>(conn: &C, row: NewCorrection) -> Result<Model, Error> {
    Ok(ActiveModel {
        id: Set(svix_ksuid::Ksuid::new(None, None).to_string()),
        org: Set(row.org),
        autoresolve_id: Set(row.autoresolve_id),
        run_id: Set(row.run_id),
        revision: Set(row.revision),
        kind: Set(row.kind.as_str().to_string()),
        note: Set(row.note),
        option_title: Set(row.option_title),
        created_by: Set(row.created_by),
        created_at_us: Set(row.created_at_us),
        active: Set(row.active),
    }
    .insert(conn)
    .await?)
}

/// The saved autoresolve's active corrections, newest first.
pub async fn active_for_autoresolve(
    org: &str,
    autoresolve_id: &str,
    limit: u64,
) -> Result<Vec<Model>, Error> {
    active_for_autoresolve_with(get_orm_client_ro().await, org, autoresolve_id, limit).await
}

pub async fn active_for_autoresolve_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    autoresolve_id: &str,
    limit: u64,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::AutoresolveId.eq(autoresolve_id))
        .filter(Column::Active.eq(true))
        .order_by_desc(Column::CreatedAtUs)
        .order_by_desc(Column::Id)
        .limit(limit)
        .all(conn)
        .await?)
}

pub async fn count_active(org: &str, autoresolve_id: &str) -> Result<u64, Error> {
    count_active_with(get_orm_client_ro().await, org, autoresolve_id).await
}

pub async fn count_active_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    autoresolve_id: &str,
) -> Result<u64, Error> {
    Ok(Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::AutoresolveId.eq(autoresolve_id))
        .filter(Column::Active.eq(true))
        .count(conn)
        .await?)
}

/// Every correction sent on the run, remembered or not, newest first.
pub async fn for_run(org: &str, run_id: &str) -> Result<Vec<Model>, Error> {
    for_run_with(get_orm_client_ro().await, org, run_id).await
}

pub async fn for_run_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    run_id: &str,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::RunId.eq(run_id))
        .order_by_desc(Column::CreatedAtUs)
        .order_by_desc(Column::Id)
        .all(conn)
        .await?)
}

/// Rows by id, removed ones included, newest first; unknown ids are skipped.
pub async fn by_ids(org: &str, ids: &[String]) -> Result<Vec<Model>, Error> {
    by_ids_with(get_orm_client_ro().await, org, ids).await
}

pub async fn by_ids_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    ids: &[String],
) -> Result<Vec<Model>, Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    Ok(Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Id.is_in(ids.iter().cloned()))
        .order_by_desc(Column::CreatedAtUs)
        .order_by_desc(Column::Id)
        .all(conn)
        .await?)
}

/// Stops an active correction feeding later runs; false when no active row of that autoresolve has
/// the id. The row stays, so past runs keep what they read.
pub async fn deactivate(org: &str, autoresolve_id: &str, id: &str) -> Result<bool, Error> {
    deactivate_with(get_orm_client_rw().await, org, autoresolve_id, id).await
}

pub async fn deactivate_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    autoresolve_id: &str,
    id: &str,
) -> Result<bool, Error> {
    let res = Entity::update_many()
        .col_expr(Column::Active, Expr::value(false))
        .filter(Column::Org.eq(org))
        .filter(Column::AutoresolveId.eq(autoresolve_id))
        .filter(Column::Id.eq(id))
        .filter(Column::Active.eq(true))
        .exec(conn)
        .await?;
    Ok(res.rows_affected == 1)
}

/// Every correction of the saved autoresolve, as it is deleted.
pub async fn delete_for_autoresolve_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    autoresolve_id: &str,
) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::AutoresolveId.eq(autoresolve_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_by_org(org: &str) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(res.rows_affected)
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::{MigrationTrait, SchemaManager};

    use super::*;
    use crate::table::{
        autoresolve_test_support::{backends, drop_schema},
        migration::autoresolve_corrections_migration_for_test,
    };

    fn row(autoresolve_id: Option<&str>, run_id: &str, at: i64, active: bool) -> NewCorrection {
        NewCorrection {
            org: "acme".into(),
            autoresolve_id: autoresolve_id.map(String::from),
            run_id: run_id.into(),
            revision: 1,
            kind: CorrectionKind::WrongFix,
            note: format!("note {at}"),
            option_title: None,
            created_by: "dana@acme.com".into(),
            created_at_us: at,
            active,
        }
    }

    fn notes(rows: Vec<Model>) -> Vec<String> {
        rows.into_iter().map(|r| r.note).collect()
    }

    #[tokio::test]
    async fn corrections_list_active_newest_first() {
        for (backend, db, schema) in backends().await {
            // A retried migration must not fail on the columns and table it already made.
            autoresolve_corrections_migration_for_test()
                .up(&SchemaManager::new(&db))
                .await
                .unwrap();
            let mut ids = Vec::new();
            for at in 1..=7 {
                ids.push(
                    insert_with(&db, row(Some("f1"), "r1", at, true))
                        .await
                        .unwrap()
                        .id,
                );
            }
            insert_with(&db, row(Some("f2"), "r2", 8, true))
                .await
                .unwrap();
            insert_with(&db, row(None, "r3", 9, false)).await.unwrap();
            assert!(deactivate_with(&db, "acme", "f1", &ids[6]).await.unwrap());
            assert!(!deactivate_with(&db, "acme", "f1", &ids[6]).await.unwrap());
            assert!(!deactivate_with(&db, "acme", "f2", &ids[5]).await.unwrap());
            let deleted = delete_for_autoresolve_with(&db, "acme", "f2")
                .await
                .unwrap();
            assert_eq!(deleted, 1, "{backend}");

            let active = active_for_autoresolve_with(&db, "acme", "f1", 5)
                .await
                .unwrap();
            let cases: [(&str, Vec<String>, Vec<&str>); 5] = [
                (
                    "removed one is skipped, limit 5",
                    notes(active),
                    vec!["note 6", "note 5", "note 4", "note 3", "note 2"],
                ),
                (
                    "ad-hoc run reads its own inactive row",
                    notes(for_run_with(&db, "acme", "r3").await.unwrap()),
                    vec!["note 9"],
                ),
                (
                    "by id keeps removed rows",
                    notes(by_ids_with(&db, "acme", &ids[5..]).await.unwrap()),
                    vec!["note 7", "note 6"],
                ),
                (
                    "a deleted autoresolve's rows are gone",
                    notes(for_run_with(&db, "acme", "r2").await.unwrap()),
                    vec![],
                ),
                (
                    "other org reads nothing",
                    notes(
                        active_for_autoresolve_with(&db, "other", "f1", 5)
                            .await
                            .unwrap(),
                    ),
                    vec![],
                ),
            ];
            for (name, got, want) in cases {
                assert_eq!(got, want, "{backend}: {name}");
            }
            assert_eq!(
                count_active_with(&db, "acme", "f1").await.unwrap(),
                6,
                "{backend}"
            );
            drop_schema(schema).await;
        }
    }
}
