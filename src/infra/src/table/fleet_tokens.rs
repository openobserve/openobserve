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

//! Fleet enrollment tokens (`o2ft_`), stored hashed.

use std::collections::HashSet;

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set, SqlErr, sea_query::Expr,
};

pub use super::entity::fleet_tokens::Model;
use super::entity::fleet_tokens::{ActiveModel, Column, Entity};
use crate::{
    db::get_orm_client_rw,
    errors::{DbError, Error},
};

pub async fn insert_with<C: ConnectionTrait>(conn: &C, row: Model) -> Result<(), Error> {
    let record = ActiveModel {
        id: Set(row.id),
        org_id: Set(row.org_id),
        name: Set(row.name),
        prefix: Set(row.prefix),
        token_hash: Set(row.token_hash),
        token: Set(row.token),
        scope: Set(row.scope),
        expires_at: Set(row.expires_at),
        max_uses: Set(row.max_uses),
        uses: Set(row.uses),
        revoked: Set(row.revoked),
        created_at: Set(row.created_at),
        created_by: Set(row.created_by),
        fleet_id: Set(row.fleet_id),
    };
    match Entity::insert(record).exec_without_returning(conn).await {
        Ok(_) => Ok(()),
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                Err(Error::DbError(DbError::UniqueViolation))
            }
            _ => Err(e.into()),
        },
    }
}

pub async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleets: Option<&HashSet<String>>,
) -> Result<Vec<Model>, Error> {
    let mut query = Entity::find().filter(Column::OrgId.eq(org_id));
    if let Some(fleets) = fleets {
        query = query.filter(Column::FleetId.is_in(fleets.iter().map(String::as_str)));
    }
    Ok(query.order_by_desc(Column::CreatedAt).all(conn).await?)
}

/// Tokens that can still place a collector in the fleet; a revoked one never can.
pub async fn count_live_for_fleet_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleet: &str,
) -> Result<u64, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::FleetId.eq(fleet))
        .filter(Column::Revoked.eq(false))
        .count(conn)
        .await?)
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(conn)
        .await?)
}

pub async fn find_by_hash_with<C: ConnectionTrait>(
    conn: &C,
    token_hash: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::TokenHash.eq(token_hash))
        .one(conn)
        .await?)
}

/// Returns 0 for an id unknown in this org or a token already revoked.
pub async fn revoke_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<u64, Error> {
    let res = Entity::update_many()
        .col_expr(Column::Revoked, Expr::value(true))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::Revoked.eq(false))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_by_org(org_id: &str) -> Result<Vec<String>, Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<String>, Error> {
    let ids: Vec<String> = Entity::find()
        .select_only()
        .column(Column::Id)
        .filter(Column::OrgId.eq(org_id))
        .into_tuple()
        .all(conn)
        .await?;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection};

    use super::*;
    use crate::table::migration::create_fleet_collectors_for_test;

    const NOW: i64 = 1_790_000_000_000_000;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_fleet_collectors_for_test(&db).await.unwrap();
        db
    }

    fn token(org_id: &str, id: &str) -> Model {
        Model {
            id: id.to_string(),
            org_id: org_id.to_string(),
            name: format!("name-{id}"),
            prefix: "o2ft_abcd".to_string(),
            token_hash: format!("hash-{org_id}-{id}"),
            token: None,
            scope: "fleet_agent".to_string(),
            expires_at: None,
            max_uses: None,
            uses: 0,
            revoked: false,
            created_at: NOW - 1_000,
            created_by: "root@example.com".to_string(),
            fleet_id: "default".to_string(),
        }
    }

    async fn seed(db: &DatabaseConnection, tokens: &[Model]) {
        for t in tokens {
            insert_with(db, t.clone()).await.unwrap();
        }
    }

    #[tokio::test]
    async fn list_is_org_scoped_newest_first_and_names_are_unique_per_org() {
        let db = db().await;
        let older = token("o1", "a");
        let newer = Model {
            created_at: NOW,
            ..token("o1", "b")
        };
        seed(&db, &[older, newer, token("o2", "c")]).await;
        let ids: Vec<String> = list_with(&db, "o1", None)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(ids, vec!["b", "a"]);

        let duplicate = Model {
            name: "name-a".to_string(),
            ..token("o1", "d")
        };
        assert!(matches!(
            insert_with(&db, duplicate).await,
            Err(Error::DbError(DbError::UniqueViolation))
        ));
        let other_org = Model {
            name: "name-a".to_string(),
            ..token("o2", "e")
        };
        insert_with(&db, other_org).await.expect("another org");
    }

    #[tokio::test]
    async fn find_by_hash_spans_orgs_and_unknown_is_none() {
        let db = db().await;
        let t = token("o2", "a");
        seed(&db, std::slice::from_ref(&t)).await;
        let found = find_by_hash_with(&db, &t.token_hash).await.unwrap();
        assert_eq!(
            found.map(|m| (m.org_id, m.id)),
            Some(("o2".into(), "a".into()))
        );
        assert!(
            find_by_hash_with(&db, "hash-unknown")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn revoke_is_idempotent_and_org_scoped() {
        let db = db().await;
        seed(&db, &[token("o1", "a")]).await;
        assert_eq!(revoke_with(&db, "o1", "a").await.unwrap(), 1);
        assert_eq!(revoke_with(&db, "o1", "a").await.unwrap(), 0);
        assert!(get_with(&db, "o1", "a").await.unwrap().unwrap().revoked);
        assert_eq!(revoke_with(&db, "o1", "missing").await.unwrap(), 0);
        assert_eq!(revoke_with(&db, "o2", "a").await.unwrap(), 0);
    }

    #[tokio::test]
    async fn delete_by_org_returns_the_deleted_ids() {
        let db = db().await;
        seed(&db, &[token("o1", "a"), token("o1", "b"), token("o2", "c")]).await;
        let mut ids = delete_by_org_with(&db, "o1").await.unwrap();
        ids.sort();
        assert_eq!(ids, vec!["a", "b"]);
        assert!(list_with(&db, "o1", None).await.unwrap().is_empty());
        assert_eq!(list_with(&db, "o2", None).await.unwrap().len(), 1);
    }

    fn in_f(id: &str) -> Model {
        Model {
            fleet_id: "f".to_string(),
            ..token("o1", id)
        }
    }

    #[tokio::test]
    async fn the_list_filters_by_fleet_and_only_live_tokens_hold_a_fleet() {
        let db = db().await;
        let revoked = Model {
            revoked: true,
            ..in_f("b")
        };
        seed(&db, &[in_f("a"), revoked, token("o1", "c")]).await;
        let only_f = HashSet::from(["f".to_string()]);
        let mut ids: Vec<String> = list_with(&db, "o1", Some(&only_f))
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        ids.sort();
        assert_eq!(ids, vec!["a", "b"]);
        assert!(
            list_with(&db, "o1", Some(&HashSet::new()))
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(count_live_for_fleet_with(&db, "o1", "f").await.unwrap(), 1);
        revoke_with(&db, "o1", "a").await.unwrap();
        assert_eq!(count_live_for_fleet_with(&db, "o1", "f").await.unwrap(), 0);
    }
}
