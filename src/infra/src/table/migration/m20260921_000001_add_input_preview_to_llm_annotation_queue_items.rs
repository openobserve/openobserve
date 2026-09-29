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

//! `llm_annotation_queue_items.input_preview`: a bounded plain-text excerpt of
//! the item's first user turn, captured when the item is enqueued so the
//! Workbench item list can label items without one trace search per row.
//! NULL means no preview was captured; the Workbench falls back to the ref id.

use sea_orm_migration::prelude::*;

const TABLE: &str = "llm_annotation_queue_items";
const COLUMN: &str = "input_preview";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden, Clone)]
enum LlmAnnotationQueueItems {
    #[sea_orm(iden = "llm_annotation_queue_items")]
    Table,
    InputPreview,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // A has_column guard: add_column_if_not_exists renders IF NOT EXISTS, which MySQL rejects.
        if manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(add_column_stmt()).await?;
        Ok(())
    }

    /// Nothing to restore: the preview is derived from the trace stream and is
    /// recaptured the next time an item is opened.
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(drop_column_stmt()).await?;
        Ok(())
    }
}

/// Nullable text: the service bounds the excerpt before writing it.
fn add_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(LlmAnnotationQueueItems::Table)
        .add_column(
            ColumnDef::new(LlmAnnotationQueueItems::InputPreview)
                .text()
                .null(),
        )
        .to_owned()
}

fn drop_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(LlmAnnotationQueueItems::Table)
        .drop_column(LlmAnnotationQueueItems::InputPreview)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &add_column_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "llm_annotation_queue_items" ADD COLUMN "input_preview" text NULL"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &add_column_stmt().to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `llm_annotation_queue_items` ADD COLUMN `input_preview` text NULL"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_column_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "llm_annotation_queue_items" ADD COLUMN "input_preview" text NULL"#
        );
    }

    #[test]
    fn postgres_down() {
        collapsed_eq!(
            &drop_column_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "llm_annotation_queue_items" DROP COLUMN "input_preview""#
        );
    }

    /// up() and down() must name the same column, or a rollback silently drops the wrong one.
    #[test]
    fn up_and_down_agree_on_the_column() {
        let up = add_column_stmt().to_string(SqliteQueryBuilder);
        let down = drop_column_stmt().to_string(SqliteQueryBuilder);
        assert!(up.contains(COLUMN));
        assert!(down.contains(COLUMN));
        assert_eq!(down.matches("DROP COLUMN").count(), 1);
    }

    /// SQLite panics on an ALTER carrying more than one option, so this must stay a single ADD.
    #[test]
    fn adds_exactly_one_column() {
        let sql = add_column_stmt().to_string(SqliteQueryBuilder);
        assert_eq!(sql.matches("ADD COLUMN").count(), 1);
        assert_eq!(
            COLUMN,
            LlmAnnotationQueueItems::InputPreview
                .into_iden()
                .to_string()
        );
    }
}
