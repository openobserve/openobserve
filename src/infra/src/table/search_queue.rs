// Copyright 2025 OpenObserve Inc.
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

use super::{entity::search_queue::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

pub async fn add(
    work_group: &str,
    org_id: &str,
    user_id: &str,
    trace_id: &str,
) -> Result<(), errors::Error> {
    let record = ActiveModel {
        work_group: Set(work_group.to_string()),
        org_id: Set(org_id.to_string()),
        user_id: Set(user_id.to_string()),
        trace_id: Set(trace_id.to_string()),
        created_at: Set(now_micros()),
        ..Default::default()
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn delete(id: i64) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn delete_by_trace_id(trace_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::TraceId.eq(trace_id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn count(work_group: &str, user_id: Option<&str>) -> Result<usize, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut query = Entity::find().filter(Column::WorkGroup.eq(work_group));
    if let Some(user_id) = user_id {
        query = query.filter(Column::UserId.eq(user_id));
    }
    let res = query.count(client).await?;
    Ok(res as usize)
}

/// Count concurrency at all three levels (global, org, user) in a single query.
/// Uses window functions with CASE statements for efficient counting.
///
/// # Arguments
/// * `work_group` - The work group to filter by ("short", "long", or "background")
/// * `org_id` - Optional organization ID to count org-level concurrency
/// * `user_id` - Optional user ID to count user-level concurrency
///
/// # Returns
/// A tuple of (global_count, org_count, user_count)
/// - global_count: Total jobs for this work_group
/// - org_count: Jobs for this work_group + org_id (0 if org_id is None)
/// - user_count: Jobs for this work_group + user_id (0 if user_id is None)
pub async fn count_all_levels(
    work_group: &str,
    org_id: Option<&str>,
    user_id: Option<&str>,
) -> Result<(usize, usize, usize), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let backend = client.get_database_backend();

    // Build the SQL query using window functions for efficient counting
    // This counts all three levels in a single query to avoid multiple round-trips
    let sql = match backend {
        sea_orm::DatabaseBackend::Postgres | sea_orm::DatabaseBackend::Sqlite => {
            // PostgreSQL uses $1, $2, $3 for parameter placeholders
            "SELECT
                COUNT(*) as global_count,
                SUM(CASE WHEN org_id = $1 THEN 1 ELSE 0 END) as org_count,
                SUM(CASE WHEN org_id = $2 AND user_id = $3 THEN 1 ELSE 0 END) as user_count
            FROM search_queue
            WHERE work_group = $4
            LIMIT 1"
        }
        sea_orm::DatabaseBackend::MySql => {
            // MySQL uses ? for parameter placeholders
            // MySQL's SUM() returns DECIMAL, so cast to SIGNED INTEGER
            "SELECT
                COUNT(*) as global_count,
                CAST(SUM(CASE WHEN org_id = ? THEN 1 ELSE 0 END) AS SIGNED) as org_count,
                CAST(SUM(CASE WHEN org_id = ? AND user_id = ? THEN 1 ELSE 0 END) AS SIGNED) as user_count
            FROM search_queue
            WHERE work_group = ?
            LIMIT 1"
        }
    };

    #[derive(Debug, FromQueryResult)]
    struct CountResult {
        global_count: Option<i64>,
        org_count: Option<i64>,
        user_count: Option<i64>,
    }

    // Execute the query with parameters
    let result = CountResult::find_by_statement(Statement::from_sql_and_values(
        backend,
        sql,
        vec![
            org_id.unwrap_or("").into(),
            org_id.unwrap_or("").into(),
            user_id.unwrap_or("").into(),
            work_group.into(),
        ],
    ))
    .one(client)
    .await?;

    // Handle empty queue case (no rows returned)
    match result {
        Some(counts) => Ok((
            counts.global_count.unwrap_or(0) as usize,
            counts.org_count.unwrap_or(0) as usize,
            counts.user_count.unwrap_or(0) as usize,
        )),
        None => Ok((0, 0, 0)), // Empty queue
    }
}

pub async fn clear() -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}

pub async fn clean_incomplete(expired: i64) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::CreatedAt.lt(expired))
        .exec(client)
        .await?;

    Ok(())
}
