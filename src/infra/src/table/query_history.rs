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
    ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set, TransactionTrait, sea_query::Expr,
};

use super::entity::query_history::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors};

pub const MAX_UNSTARRED_PER_USER: u64 = 1000;

pub async fn record(
    org_id: &str,
    user_email: &str,
    query: &str,
    context: serde_json::Value,
    now_us: i64,
) -> Result<Model, errors::Error> {
    let client = get_orm_client_rw().await;
    record_with(client, org_id, user_email, query, context, now_us).await
}

pub async fn record_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    query: &str,
    context: serde_json::Value,
    now_us: i64,
) -> Result<Model, errors::Error> {
    let txn = conn.begin().await?;
    let latest = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email))
        .order_by_desc(Column::CreatedAt)
        .order_by_desc(Column::Id)
        .one(&txn)
        .await?;
    let model = match latest {
        Some(latest) if latest.query == query => {
            Entity::update_many()
                .col_expr(Column::CreatedAt, Expr::value(now_us))
                .col_expr(Column::Context, Expr::value(context.clone()))
                .filter(Column::Id.eq(&latest.id))
                .exec(&txn)
                .await?;
            Model {
                created_at: now_us,
                context,
                ..latest
            }
        }
        _ => {
            let model = Model {
                id: config::ider::uuid(),
                org_id: org_id.to_string(),
                user_email: user_email.to_string(),
                query: query.to_string(),
                context,
                starred: false,
                created_at: now_us,
            };
            Entity::insert(ActiveModel {
                id: Set(model.id.clone()),
                org_id: Set(model.org_id.clone()),
                user_email: Set(model.user_email.clone()),
                query: Set(model.query.clone()),
                context: Set(model.context.clone()),
                starred: Set(false),
                created_at: Set(now_us),
            })
            .exec(&txn)
            .await?;
            model
        }
    };

    let unstarred = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email))
        .filter(Column::Starred.eq(false));
    let count = unstarred.clone().count(&txn).await?;
    if count > MAX_UNSTARRED_PER_USER {
        let oldest: Vec<String> = unstarred
            .select_only()
            .column(Column::Id)
            .order_by_asc(Column::CreatedAt)
            .order_by_asc(Column::Id)
            .limit(count - MAX_UNSTARRED_PER_USER)
            .into_tuple()
            .all(&txn)
            .await?;
        Entity::delete_many()
            .filter(Column::Id.is_in(oldest))
            .exec(&txn)
            .await?;
    }
    txn.commit().await?;
    Ok(model)
}

pub async fn list(
    org_id: &str,
    user_email: &str,
    starred: Option<bool>,
    q: Option<&str>,
    limit: u64,
    offset: u64,
) -> Result<Vec<Model>, errors::Error> {
    let client = get_orm_client_rw().await;
    list_with(client, org_id, user_email, starred, q, limit, offset).await
}

pub async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    starred: Option<bool>,
    q: Option<&str>,
    limit: u64,
    offset: u64,
) -> Result<Vec<Model>, errors::Error> {
    let mut select = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email));
    if let Some(starred) = starred {
        select = select.filter(Column::Starred.eq(starred));
    }
    if let Some(q) = q.filter(|q| !q.is_empty()) {
        select = select.filter(Column::Query.contains(q));
    }
    Ok(select
        .order_by_desc(Column::CreatedAt)
        .order_by_desc(Column::Id)
        .limit(limit)
        .offset(offset)
        .all(conn)
        .await?)
}

pub async fn set_starred(
    org_id: &str,
    user_email: &str,
    id: &str,
    starred: bool,
) -> Result<Option<Model>, errors::Error> {
    let client = get_orm_client_rw().await;
    set_starred_with(client, org_id, user_email, id, starred).await
}

pub async fn set_starred_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    id: &str,
    starred: bool,
) -> Result<Option<Model>, errors::Error> {
    // Look the entry up first: MySQL's rows_affected counts changed rows, so
    // re-starring a starred entry reports 0 and cannot signal "not found".
    let Some(entry) = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email))
        .filter(Column::Id.eq(id))
        .one(conn)
        .await?
    else {
        return Ok(None);
    };
    Entity::update_many()
        .col_expr(Column::Starred, Expr::value(starred))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(Some(Model { starred, ..entry }))
}

pub async fn delete(org_id: &str, user_email: &str, id: &str) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_with(client, org_id, user_email, id).await
}

pub async fn delete_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    id: &str,
) -> Result<bool, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

pub async fn delete_unstarred_before(cutoff_us: i64) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_unstarred_before_with(client, cutoff_us).await
}

pub async fn delete_unstarred_before_with<C: ConnectionTrait>(
    conn: &C,
    cutoff_us: i64,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::Starred.eq(false))
        .filter(Column::CreatedAt.lt(cutoff_us))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_by_org_with(client, org_id).await
}

pub async fn delete_by_org_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_by_user(org_id: &str, user_email: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_by_user_with(client, org_id, user_email).await
}

pub async fn delete_by_user_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_by_email(user_email: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_by_email_with(client, user_email).await
}

pub async fn delete_by_email_with<C: ConnectionTrait>(
    conn: &C,
    user_email: &str,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::UserEmail.eq(user_email))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection, Schema};
    use serde_json::json;

    use super::*;

    const A: &str = "a@x.com";
    const B: &str = "b@x.com";

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    async fn all(db: &DatabaseConnection, user: &str) -> Vec<Model> {
        list_with(db, "default", user, None, None, 10_000, 0)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn test_same_query_as_latest_updates_time_and_context() {
        let db = db().await;
        let first = record_with(&db, "default", A, "up", json!({"chart": "line"}), 1)
            .await
            .unwrap();
        let again = record_with(&db, "default", A, "up", json!({"chart": "bar"}), 2)
            .await
            .unwrap();
        assert_eq!(again.id, first.id);
        let rows = all(&db, A).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].created_at, 2);
        assert_eq!(rows[0].context, json!({"chart": "bar"}));

        record_with(&db, "default", A, "rate(x[5m])", json!({}), 3)
            .await
            .unwrap();
        record_with(&db, "default", A, "up", json!({}), 4)
            .await
            .unwrap();
        assert_eq!(all(&db, A).await.len(), 3, "only the latest entry dedupes");
    }

    #[tokio::test]
    async fn test_dedupe_is_per_user() {
        let db = db().await;
        record_with(&db, "default", A, "up", json!({}), 1)
            .await
            .unwrap();
        record_with(&db, "default", B, "up", json!({}), 2)
            .await
            .unwrap();
        assert_eq!(all(&db, A).await.len(), 1);
        assert_eq!(all(&db, B).await.len(), 1);
    }

    #[tokio::test]
    async fn test_cap_prunes_oldest_unstarred_and_keeps_starred() {
        let db = db().await;
        let starred = record_with(&db, "default", A, "starred", json!({}), 0)
            .await
            .unwrap();
        set_starred_with(&db, "default", A, &starred.id, true)
            .await
            .unwrap();
        for i in 1..=MAX_UNSTARRED_PER_USER as i64 {
            record_with(&db, "default", A, &format!("q{i}"), json!({}), i)
                .await
                .unwrap();
        }
        record_with(&db, "default", B, "other user", json!({}), 1)
            .await
            .unwrap();
        assert_eq!(all(&db, A).await.len(), 1001);

        record_with(&db, "default", A, "q1001", json!({}), 1001)
            .await
            .unwrap();
        let rows = all(&db, A).await;
        assert_eq!(rows.len(), 1001);
        assert!(rows.iter().all(|r| r.query != "q1"), "oldest is pruned");
        assert!(rows.iter().any(|r| r.query == "q2"));
        assert!(rows.iter().any(|r| r.id == starred.id && r.starred));
        assert_eq!(all(&db, B).await.len(), 1);
    }

    #[tokio::test]
    async fn test_list_filters_newest_first() {
        let db = db().await;
        let up = record_with(&db, "default", A, "up", json!({}), 1)
            .await
            .unwrap();
        record_with(&db, "default", A, "rate(http_total[5m])", json!({}), 2)
            .await
            .unwrap();
        record_with(&db, "default", A, "sum(http_total)", json!({}), 3)
            .await
            .unwrap();
        record_with(&db, "other", A, "http_total", json!({}), 4)
            .await
            .unwrap();
        set_starred_with(&db, "default", A, &up.id, true)
            .await
            .unwrap();

        let queries = |rows: Vec<Model>| rows.into_iter().map(|r| r.query).collect::<Vec<_>>();
        assert_eq!(
            queries(all(&db, A).await),
            vec!["sum(http_total)", "rate(http_total[5m])", "up"]
        );
        let starred = list_with(&db, "default", A, Some(true), None, 50, 0)
            .await
            .unwrap();
        assert_eq!(queries(starred), vec!["up"]);
        let matched = list_with(&db, "default", A, None, Some("http_total"), 50, 0)
            .await
            .unwrap();
        assert_eq!(
            queries(matched),
            vec!["sum(http_total)", "rate(http_total[5m])"]
        );
        let page = list_with(&db, "default", A, None, None, 1, 1)
            .await
            .unwrap();
        assert_eq!(queries(page), vec!["rate(http_total[5m])"]);
    }

    #[tokio::test]
    async fn test_by_id_operations_are_scoped_to_org_and_user() {
        let db = db().await;
        let entry = record_with(&db, "default", A, "up", json!({}), 1)
            .await
            .unwrap();

        assert!(
            set_starred_with(&db, "default", B, &entry.id, true)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            set_starred_with(&db, "other", A, &entry.id, true)
                .await
                .unwrap()
                .is_none()
        );
        assert!(!delete_with(&db, "default", B, &entry.id).await.unwrap());
        assert!(!delete_with(&db, "other", A, &entry.id).await.unwrap());
        assert!(!all(&db, A).await[0].starred);

        let starred = set_starred_with(&db, "default", A, &entry.id, true)
            .await
            .unwrap()
            .unwrap();
        assert!(starred.starred);
        assert!(delete_with(&db, "default", A, &entry.id).await.unwrap());
        assert!(all(&db, A).await.is_empty());
    }

    // MySQL counts changed rows, so a no-op update reports 0; existence is a lookup.
    #[tokio::test]
    async fn test_starring_twice_still_returns_the_entry() {
        let db = db().await;
        let entry = record_with(&db, "default", A, "up", json!({}), 1)
            .await
            .unwrap();
        for _ in 0..2 {
            let starred = set_starred_with(&db, "default", A, &entry.id, true)
                .await
                .unwrap()
                .expect("an existing entry is found however often it is starred");
            assert!(starred.starred);
        }
        let unstarred = set_starred_with(&db, "default", A, &entry.id, false)
            .await
            .unwrap()
            .unwrap();
        assert!(!unstarred.starred);
        assert!(
            set_starred_with(&db, "default", A, "missing", true)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn test_retention_deletes_only_old_unstarred_rows() {
        let db = db().await;
        let day_us = 86_400 * 1_000_000;
        let now = 100 * day_us;
        let old = record_with(&db, "default", A, "old", json!({}), now - 15 * day_us)
            .await
            .unwrap();
        let old_starred = record_with(
            &db,
            "default",
            A,
            "old starred",
            json!({}),
            now - 15 * day_us,
        )
        .await
        .unwrap();
        set_starred_with(&db, "default", A, &old_starred.id, true)
            .await
            .unwrap();
        record_with(&db, "default", A, "fresh", json!({}), now)
            .await
            .unwrap();

        let deleted = delete_unstarred_before_with(&db, now - 14 * day_us)
            .await
            .unwrap();
        assert_eq!(deleted, 1);
        let ids: Vec<String> = all(&db, A).await.into_iter().map(|r| r.id).collect();
        assert!(!ids.contains(&old.id));
        assert!(ids.contains(&old_starred.id));
        assert_eq!(ids.len(), 2);
    }

    #[tokio::test]
    async fn test_cleanup_by_org_user_and_email() {
        let db = db().await;
        for (org, user) in [("default", A), ("default", B), ("other", A), ("other", B)] {
            record_with(&db, org, user, "up", json!({}), 1)
                .await
                .unwrap();
        }
        assert_eq!(delete_by_user_with(&db, "default", A).await.unwrap(), 1);
        assert!(all(&db, A).await.is_empty());
        assert_eq!(all(&db, B).await.len(), 1);

        assert_eq!(delete_by_email_with(&db, B).await.unwrap(), 2);
        assert_eq!(delete_by_org_with(&db, "other").await.unwrap(), 1);
        assert_eq!(Entity::find().count(&db).await.unwrap(), 0);
    }
}
