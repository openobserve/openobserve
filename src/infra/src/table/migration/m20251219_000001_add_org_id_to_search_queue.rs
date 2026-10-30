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

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SEARCH_QUEUE_ORG_USER_IDX: &str = "search_queue_org_user_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // present on a re-run, and SQLite has no ADD COLUMN IF NOT EXISTS
        if !manager.has_column("search_queue", "org_id").await? {
            // Add org_id column to search_queue table
            manager
                .alter_table(
                    Table::alter()
                        .table(SearchQueue::Table)
                        .add_column(
                            ColumnDef::new(SearchQueue::OrgId)
                                .string_len(256)
                                .not_null()
                                .default(""),
                        )
                        .to_owned(),
                )
                .await?;
        }

        // Create composite index for efficient org-level concurrency checking
        manager.create_index(create_index_org_user_stmt()).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop the index first
        manager
            .drop_index(
                Index::drop()
                    .name(SEARCH_QUEUE_ORG_USER_IDX)
                    .table(SearchQueue::Table)
                    .to_owned(),
            )
            .await?;

        // Drop the org_id column
        manager
            .alter_table(
                Table::alter()
                    .table(SearchQueue::Table)
                    .drop_column(SearchQueue::OrgId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

/// Statement to create composite index for org and user level concurrency checking.
/// This index enables efficient single-query checking of global, org, and user level concurrency.
fn create_index_org_user_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SEARCH_QUEUE_ORG_USER_IDX)
        .table(SearchQueue::Table)
        .col(SearchQueue::WorkGroup)
        .col(SearchQueue::OrgId)
        .col(SearchQueue::UserId)
        .to_owned()
}

#[derive(DeriveIden)]
enum SearchQueue {
    Table,
    OrgId,
    WorkGroup,
    UserId,
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;
    use sea_query::SqliteQueryBuilder;

    use super::*;
    use crate::table::migration::m20241204_143100_create_table_search_queue as create_search_queue;

    #[test]
    fn test_org_user_idx_contains_name() {
        let sql = create_index_org_user_stmt().build(SqliteQueryBuilder);
        assert!(sql.contains(SEARCH_QUEUE_ORG_USER_IDX));
    }

    #[test]
    fn test_org_user_idx_constant_value() {
        assert_eq!(SEARCH_QUEUE_ORG_USER_IDX, "search_queue_org_user_idx");
    }

    #[tokio::test]
    async fn test_up_adds_org_id_and_index() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        create_search_queue::Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_column("search_queue", "org_id").await.unwrap());
        assert!(
            manager
                .has_index("search_queue", SEARCH_QUEUE_ORG_USER_IDX)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_up_reruns_when_org_id_exists() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        create_search_queue::Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        Migration
            .up(&manager)
            .await
            .expect("re-running must not add org_id twice");
        assert!(manager.has_column("search_queue", "org_id").await.unwrap());
    }
}
