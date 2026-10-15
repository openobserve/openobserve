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

use config::utils::time::now_micros;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, PaginatorTrait, QueryFilter, Set,
    Statement,
};

use super::entity::search_queue::*;
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

pub async fn add(
    work_group: &str,
    org_id: &str,
    user_id: &str,
    trace_id: &str,
    search_type: Option<&str>,
) -> Result<(), errors::Error> {
    add_on(
        get_orm_client_rw().await,
        work_group,
        org_id,
        user_id,
        trace_id,
        search_type,
    )
    .await
}

pub async fn add_on<C: ConnectionTrait>(
    db: &C,
    work_group: &str,
    org_id: &str,
    user_id: &str,
    trace_id: &str,
    search_type: Option<&str>,
) -> Result<(), errors::Error> {
    let record = ActiveModel {
        work_group: Set(work_group.to_string()),
        org_id: Set(org_id.to_string()),
        user_id: Set(user_id.to_string()),
        trace_id: Set(trace_id.to_string()),
        created_at: Set(now_micros()),
        search_type: Set(search_type.map(str::to_string)),
        ..Default::default()
    };
    Entity::insert(record).exec(db).await?;
    Ok(())
}

pub async fn delete(id: i64) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn delete_by_trace_id(trace_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::TraceId.eq(trace_id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn count(work_group: &str, user_id: Option<&str>) -> Result<usize, errors::Error> {
    let client = get_orm_client_ro().await;
    let mut query = Entity::find().filter(Column::WorkGroup.eq(work_group));
    if let Some(user_id) = user_id {
        query = query.filter(Column::UserId.eq(user_id));
    }
    let res = query.count(client).await?;
    Ok(res as usize)
}

/// Admitted searches of one work group by level; the `type_*` counts are of one search type.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct QueueCounts {
    pub global: usize,
    pub org: usize,
    pub user: usize,
    pub type_global: usize,
    pub type_org: usize,
}

/// Counts admitted searches per level and per search type in one query; `None` counts zero.
pub async fn count_all_levels(
    work_group: &str,
    org_id: Option<&str>,
    user_id: Option<&str>,
    search_type: Option<&str>,
) -> Result<QueueCounts, errors::Error> {
    count_all_levels_on(
        get_orm_client_ro().await,
        work_group,
        org_id,
        user_id,
        search_type,
    )
    .await
}

pub async fn count_all_levels_on<C: ConnectionTrait>(
    db: &C,
    work_group: &str,
    org_id: Option<&str>,
    user_id: Option<&str>,
    search_type: Option<&str>,
) -> Result<QueueCounts, errors::Error> {
    let sql = "SELECT
            COUNT(*) as global_count,
            SUM(CASE WHEN org_id = $1 THEN 1 ELSE 0 END) as org_count,
            SUM(CASE WHEN org_id = $2 AND user_id = $3 THEN 1 ELSE 0 END) as user_count,
            SUM(CASE WHEN search_type = $4 THEN 1 ELSE 0 END) as type_count,
            SUM(CASE WHEN org_id = $5 AND search_type = $6 THEN 1 ELSE 0 END) as type_org_count
        FROM search_queue
        WHERE work_group = $7
        LIMIT 1";

    #[derive(Debug, FromQueryResult)]
    struct CountResult {
        global_count: Option<i64>,
        org_count: Option<i64>,
        user_count: Option<i64>,
        type_count: Option<i64>,
        type_org_count: Option<i64>,
    }

    let org = org_id.unwrap_or("");
    let search_type = search_type.unwrap_or("");
    let result = CountResult::find_by_statement(Statement::from_sql_and_values(
        db.get_database_backend(),
        sql,
        vec![
            org.into(),
            org.into(),
            user_id.unwrap_or("").into(),
            search_type.into(),
            org.into(),
            search_type.into(),
            work_group.into(),
        ],
    ))
    .one(db)
    .await?;

    let n = |v: Option<i64>| v.unwrap_or(0) as usize;
    Ok(result.map_or_else(QueueCounts::default, |c| QueueCounts {
        global: n(c.global_count),
        org: n(c.org_count),
        user: n(c.user_count),
        type_global: n(c.type_count),
        type_org: n(c.type_org_count),
    }))
}

pub async fn clear() -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}

pub async fn clean_incomplete(expired: i64) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::CreatedAt.lt(expired))
        .exec(client)
        .await?;

    Ok(())
}

/// Deletes all search queue entries belonging to the given org.
pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection};

    use super::*;
    use crate::table::migration::create_search_queue_schema_for_test;

    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        create_search_queue_schema_for_test(&db).await.unwrap();
        db
    }

    #[tokio::test]
    async fn the_search_type_is_counted_per_work_group_and_per_org() {
        let db = db().await;
        let public = Some("public_dashboard");
        for (i, org) in ["o1", "o1", "o2"].into_iter().enumerate() {
            let user = format!("public-dashboard.org-{org}@openobserve.internal");
            add_on(&db, "short", org, &user, &format!("p{i}"), public)
                .await
                .unwrap();
        }
        add_on(&db, "short", "o1", "u1", "d1", Some("dashboards"))
            .await
            .unwrap();
        add_on(&db, "short", "o1", "u1", "n1", None).await.unwrap();
        add_on(&db, "long", "o1", "u2", "p-long", public)
            .await
            .unwrap();

        let counts = count_all_levels_on(&db, "short", Some("o1"), Some("u1"), public)
            .await
            .unwrap();
        assert_eq!(
            counts,
            QueueCounts {
                global: 5,
                org: 4,
                user: 2,
                type_global: 3,
                type_org: 2,
            }
        );

        let other = count_all_levels_on(&db, "short", Some("o2"), None, Some("dashboards"))
            .await
            .unwrap();
        assert_eq!((other.type_global, other.type_org), (1, 0));

        // No type counts nothing, including the untyped rows written before migration 109.
        let untyped = count_all_levels_on(&db, "short", Some("o1"), None, None)
            .await
            .unwrap();
        assert_eq!((untyped.type_global, untyped.type_org), (0, 0));

        let long = count_all_levels_on(&db, "long", Some("o1"), None, public)
            .await
            .unwrap();
        assert_eq!((long.global, long.type_global, long.type_org), (1, 1, 1));
    }

    #[tokio::test]
    async fn an_empty_queue_counts_zero() {
        let db = db().await;
        let counts = count_all_levels_on(&db, "short", Some("o1"), Some("u1"), Some("ui"))
            .await
            .unwrap();
        assert_eq!(counts, QueueCounts::default());
    }
}
