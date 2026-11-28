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

//! `llm_annotation_queue_items.source_stream`: the traces stream an item's ref resolved to.

use sea_orm_migration::prelude::*;

const TABLE: &str = "llm_annotation_queue_items";
const COLUMN: &str = "source_stream";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden, Clone)]
enum LlmAnnotationQueueItems {
    #[sea_orm(iden = "llm_annotation_queue_items")]
    Table,
    SourceStream,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // A has_column guard: SQLite rejects ADD COLUMN IF NOT EXISTS.
        if manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(add_column_stmt()).await?;
        Ok(())
    }

    /// Nothing to restore: a NULL source_stream is re-resolved when the item is next opened.
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(drop_column_stmt()).await?;
        Ok(())
    }
}

fn add_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(LlmAnnotationQueueItems::Table)
        .add_column(
            ColumnDef::new(LlmAnnotationQueueItems::SourceStream)
                .text()
                .null(),
        )
        .to_owned()
}

fn drop_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(LlmAnnotationQueueItems::Table)
        .drop_column(LlmAnnotationQueueItems::SourceStream)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;
    use sea_orm::Database;

    use super::*;
    use crate::table::migration::m20260731_000001_create_llm_annotation_queue_tables as create_queue_tables;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &add_column_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "llm_annotation_queue_items" ADD COLUMN "source_stream" text NULL"#
        );
    }

    #[test]
    fn postgres_down() {
        collapsed_eq!(
            &drop_column_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "llm_annotation_queue_items" DROP COLUMN "source_stream""#
        );
    }

    #[tokio::test]
    async fn up_is_rerunnable_and_down_drops_the_column() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        create_queue_tables::Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        Migration
            .up(&manager)
            .await
            .expect("re-running must not add source_stream twice");
        assert!(manager.has_column(TABLE, COLUMN).await.unwrap());
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(TABLE, COLUMN).await.unwrap());
        Migration.down(&manager).await.unwrap();
    }
}
