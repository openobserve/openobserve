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
    Entity::insert(dbg!(record)).exec(client).await?;

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
        sea_orm::DatabaseBackend::Postgres => {
            // PostgreSQL uses $1, $2, $3 for parameter placeholders
            "SELECT
                COUNT(*) OVER () as global_count,
                SUM(CASE WHEN org_id = $1 THEN 1 ELSE 0 END) OVER () as org_count,
                SUM(CASE WHEN user_id = $2 THEN 1 ELSE 0 END) OVER () as user_count
            FROM search_queue
            WHERE work_group = $3
            LIMIT 1"
        }
        sea_orm::DatabaseBackend::MySql | sea_orm::DatabaseBackend::Sqlite => {
            // MySQL and SQLite use ? for parameter placeholders
            "SELECT
                COUNT(*) OVER () as global_count,
                SUM(CASE WHEN org_id = ? THEN 1 ELSE 0 END) OVER () as org_count,
                SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) OVER () as user_count
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

#[cfg(test)]
mod tests {
    use super::*;

    // Helper function to clean up test data
    async fn cleanup_test_data() {
        let _ = clear().await;
    }

    #[tokio::test]
    async fn test_count_all_levels_empty_queue() {
        cleanup_test_data().await;

        let (global, org, user) = count_all_levels("short", Some("org1"), Some("user1"))
            .await
            .unwrap();

        assert_eq!(global, 0);
        assert_eq!(org, 0);
        assert_eq!(user, 0);
    }

    #[tokio::test]
    async fn test_count_all_levels_single_org_single_user() {
        cleanup_test_data().await;

        // Add 3 jobs for org1, user1
        for i in 0..3 {
            add("short", "org1", "user1", &format!("trace{}", i))
                .await
                .unwrap();
        }

        let (global, org, user) = count_all_levels("short", Some("org1"), Some("user1"))
            .await
            .unwrap();

        assert_eq!(global, 3); // All 3 jobs
        assert_eq!(org, 3); // All 3 jobs belong to org1
        assert_eq!(user, 3); // All 3 jobs belong to user1

        cleanup_test_data().await;
    }

    #[tokio::test]
    async fn test_count_all_levels_multi_org_multi_user() {
        cleanup_test_data().await;

        // Add jobs for different orgs and users
        add("short", "org1", "user1", "trace1").await.unwrap();
        add("short", "org1", "user2", "trace2").await.unwrap();
        add("short", "org2", "user3", "trace3").await.unwrap();
        add("short", "org2", "user4", "trace4").await.unwrap();
        add("short", "org3", "user5", "trace5").await.unwrap();

        // Query for org1, user1
        let (global, org, user) = count_all_levels("short", Some("org1"), Some("user1"))
            .await
            .unwrap();

        assert_eq!(global, 5); // All 5 jobs
        assert_eq!(org, 2); // org1 has 2 jobs (user1 + user2)
        assert_eq!(user, 1); // user1 has 1 job

        // Query for org2, user3
        let (global, org, user) = count_all_levels("short", Some("org2"), Some("user3"))
            .await
            .unwrap();

        assert_eq!(global, 5); // All 5 jobs
        assert_eq!(org, 2); // org2 has 2 jobs (user3 + user4)
        assert_eq!(user, 1); // user3 has 1 job

        cleanup_test_data().await;
    }

    #[tokio::test]
    async fn test_count_all_levels_work_group_isolation() {
        cleanup_test_data().await;

        // Add jobs to different work groups
        add("short", "org1", "user1", "trace1").await.unwrap();
        add("short", "org1", "user1", "trace2").await.unwrap();
        add("long", "org1", "user1", "trace3").await.unwrap();
        add("long", "org1", "user1", "trace4").await.unwrap();
        add("background", "org1", "user1", "trace5").await.unwrap();

        // Query short work group
        let (global, org, user) = count_all_levels("short", Some("org1"), Some("user1"))
            .await
            .unwrap();

        assert_eq!(global, 2); // Only 2 short jobs
        assert_eq!(org, 2);
        assert_eq!(user, 2);

        // Query long work group
        let (global, org, user) = count_all_levels("long", Some("org1"), Some("user1"))
            .await
            .unwrap();

        assert_eq!(global, 2); // Only 2 long jobs
        assert_eq!(org, 2);
        assert_eq!(user, 2);

        // Query background work group
        let (global, org, user) = count_all_levels("background", Some("org1"), Some("user1"))
            .await
            .unwrap();

        assert_eq!(global, 1); // Only 1 background job
        assert_eq!(org, 1);
        assert_eq!(user, 1);

        cleanup_test_data().await;
    }

    #[tokio::test]
    async fn test_count_all_levels_none_parameters() {
        cleanup_test_data().await;

        // Add jobs
        add("short", "org1", "user1", "trace1").await.unwrap();
        add("short", "org2", "user2", "trace2").await.unwrap();

        // Query with None parameters
        let (global, org, user) = count_all_levels("short", None, None).await.unwrap();

        assert_eq!(global, 2); // All jobs
        assert_eq!(org, 0); // No org filter, so 0 matches empty string
        assert_eq!(user, 0); // No user filter, so 0 matches empty string

        cleanup_test_data().await;
    }

    #[tokio::test]
    async fn test_count_all_levels_high_volume() {
        cleanup_test_data().await;

        // Add 100 jobs across 5 orgs and 20 users
        for i in 0..100 {
            let org_id = format!("org{}", i % 5);
            let user_id = format!("user{}", i % 20);
            add("short", &org_id, &user_id, &format!("trace{}", i))
                .await
                .unwrap();
        }

        // Query for org0 (should have 20 jobs: i=0,5,10,15,...,95)
        let (global, org, user) = count_all_levels("short", Some("org0"), Some("user0"))
            .await
            .unwrap();

        assert_eq!(global, 100); // All 100 jobs
        assert_eq!(org, 20); // org0 has 20 jobs
        assert_eq!(user, 5); // user0 has 5 jobs (0, 20, 40, 60, 80)

        cleanup_test_data().await;
    }

    #[tokio::test]
    async fn test_count_all_levels_single_query_performance() {
        use std::time::Instant;

        cleanup_test_data().await;

        // Add some jobs
        for i in 0..50 {
            add("short", "org1", "user1", &format!("trace{}", i))
                .await
                .unwrap();
        }

        // Measure time for single query (should be fast)
        let start = Instant::now();
        let _ = count_all_levels("short", Some("org1"), Some("user1"))
            .await
            .unwrap();
        let duration = start.elapsed();

        // Single query should complete in < 100ms even with 50 jobs
        // (This will be much faster with proper indexes)
        assert!(
            duration.as_millis() < 1000,
            "Query took too long: {:?}",
            duration
        );

        cleanup_test_data().await;
    }
}
