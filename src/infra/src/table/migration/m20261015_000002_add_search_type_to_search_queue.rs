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

//! Phase 2 admission: the search type of each queued search, so a per-type cap can count it.

use sea_orm_migration::prelude::*;

const SEARCH_QUEUE_TYPE_IDX: &str = "search_queue_work_group_search_type_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite has no ADD COLUMN IF NOT EXISTS, so a re-run checks first.
        if !manager.has_column("search_queue", "search_type").await? {
            manager.alter_table(add_column_stmt()).await?;
        }
        manager.create_index(type_idx()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name(SEARCH_QUEUE_TYPE_IDX)
                    .table(SearchQueue::Table)
                    .to_owned(),
            )
            .await?;
        if manager.has_column("search_queue", "search_type").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(SearchQueue::Table)
                        .drop_column(SearchQueue::SearchType)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

fn add_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(SearchQueue::Table)
        .add_column(
            ColumnDef::new(SearchQueue::SearchType)
                .string_len(32)
                .null(),
        )
        .to_owned()
}

fn type_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SEARCH_QUEUE_TYPE_IDX)
        .table(SearchQueue::Table)
        .col(SearchQueue::WorkGroup)
        .col(SearchQueue::SearchType)
        .to_owned()
}

#[derive(DeriveIden)]
enum SearchQueue {
    Table,
    WorkGroup,
    SearchType,
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;

    use super::*;
    use crate::table::migration::{
        m20241204_143100_create_table_search_queue as create_search_queue,
        m20251219_000001_add_org_id_to_search_queue as add_org_id,
    };

    #[test]
    fn adds_a_nullable_varchar_32() {
        let sql = add_column_stmt().to_string(PostgresQueryBuilder);
        assert!(sql.contains(r#""search_type" varchar(32) NULL"#), "{sql}");
    }

    #[tokio::test]
    async fn up_adds_the_column_and_index_and_runs_twice() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        create_search_queue::Migration.up(&manager).await.unwrap();
        add_org_id::Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(
            manager
                .has_column("search_queue", "search_type")
                .await
                .unwrap()
        );
        assert!(
            manager
                .has_index("search_queue", SEARCH_QUEUE_TYPE_IDX)
                .await
                .unwrap()
        );
    }
}
