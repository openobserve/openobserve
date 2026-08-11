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

//! Mutable annotation Queue storage for LLM Observability Phase 2.5a.
//!
//! Queue target and binding mutations are published through the existing audit
//! stream rather than stored in a Queue-specific audit table. Each binding
//! points at one immutable physical Score Config version row. Queue-update and
//! review-submit APIs must lock the Queue row and compare the exact submitted
//! Score Config row-ID set with the current bindings in the same transaction;
//! there is no separate rubric revision counter.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_annotation_queues_statement())
            .await?;
        manager
            .create_table(create_queue_bindings_statement())
            .await?;
        manager.create_table(create_queue_items_statement()).await?;

        for index in indexes() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(LlmAnnotationQueueItems::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(LlmAnnotationQueueBindings::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(LlmAnnotationQueues::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_annotation_queues_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmAnnotationQueues::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmAnnotationQueues::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueues::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueues::Name)
                .string_len(255)
                .not_null(),
        )
        .col(ColumnDef::new(LlmAnnotationQueues::Description).text().null())
        .col(
            ColumnDef::new(LlmAnnotationQueues::TargetDatasetId)
                .string_len(27)
                .null(),
        )
        // Server-owned subset of session | trace | span, not a 2.5a form field.
        .col(
            ColumnDef::new(LlmAnnotationQueues::AllowedRefTypes)
                .json()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueues::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueues::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueues::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueues::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_queue_bindings_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmAnnotationQueueBindings::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmAnnotationQueueBindings::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueueBindings::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueueBindings::QueueId)
                .string_len(27)
                .not_null(),
        )
        .col(
            // score_configs.id is the physical ID of one immutable version;
            // entity_id is the logical identity shared by all versions.
            ColumnDef::new(LlmAnnotationQueueBindings::ScoreConfigRowId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueueBindings::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .foreign_key(
            ForeignKey::create()
                .name("fk_llm_queue_bindings_score_config_row")
                .from(
                    LlmAnnotationQueueBindings::Table,
                    LlmAnnotationQueueBindings::ScoreConfigRowId,
                )
                .to(ScoreConfigs::Table, ScoreConfigs::Id)
                .on_delete(ForeignKeyAction::Restrict),
        )
        .to_owned()
}

fn create_queue_items_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmAnnotationQueueItems::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::QueueId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::RefType)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::RefId)
                .string_len(256)
                .not_null(),
        )
        // Span-only context locator. Trace/session items leave ref_trace_id null.
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::RefTraceId)
                .string_len(256)
                .null(),
        )
        // Required for every scope as the lower bound for Workbench score searches.
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::RefTraceStartTime)
                .big_integer()
                .not_null(),
        )
        // pending | reviewed only. Archive is orthogonal via archived_at.
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::Status)
                .string_len(16)
                .not_null()
                .default("pending"),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::ReviewedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::ArchivedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmAnnotationQueueItems::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn indexes() -> Vec<IndexCreateStatement> {
    vec![
        unique_index(
            "uq_llm_annotation_queues_org_name",
            LlmAnnotationQueues::Table,
            [LlmAnnotationQueues::OrgId, LlmAnnotationQueues::Name],
        ),
        unique_index(
            "uq_llm_queue_bindings_config",
            LlmAnnotationQueueBindings::Table,
            [
                LlmAnnotationQueueBindings::QueueId,
                LlmAnnotationQueueBindings::ScoreConfigRowId,
            ],
        ),
        unique_index(
            "uq_llm_queue_items_ref",
            LlmAnnotationQueueItems::Table,
            [
                LlmAnnotationQueueItems::QueueId,
                LlmAnnotationQueueItems::RefType,
                LlmAnnotationQueueItems::RefId,
            ],
        ),
        index(
            "idx_llm_queue_items_status",
            LlmAnnotationQueueItems::Table,
            [
                LlmAnnotationQueueItems::QueueId,
                LlmAnnotationQueueItems::Status,
                LlmAnnotationQueueItems::ArchivedAt,
            ],
        ),
        index(
            "idx_llm_queue_items_discovery",
            LlmAnnotationQueueItems::Table,
            [
                LlmAnnotationQueueItems::OrgId,
                LlmAnnotationQueueItems::RefType,
                LlmAnnotationQueueItems::Status,
                LlmAnnotationQueueItems::RefId,
            ],
        ),
    ]
}

fn index<T, C, const N: usize>(name: &str, table: T, columns: [C; N]) -> IndexCreateStatement
where
    T: IntoIden + 'static,
    C: IntoIden + 'static,
{
    let mut statement = Index::create();
    statement.if_not_exists().name(name).table(table);
    for column in columns {
        statement.col(column);
    }
    statement.to_owned()
}

fn unique_index<T, C, const N: usize>(name: &str, table: T, columns: [C; N]) -> IndexCreateStatement
where
    T: IntoIden + 'static,
    C: IntoIden + 'static,
{
    let mut statement = Index::create();
    statement.if_not_exists().unique().name(name).table(table);
    for column in columns {
        statement.col(column);
    }
    statement.to_owned()
}

#[derive(DeriveIden)]
enum LlmAnnotationQueues {
    Table,
    Id,
    OrgId,
    Name,
    Description,
    TargetDatasetId,
    AllowedRefTypes,
    CreatedBy,
    CreatedAt,
    UpdatedBy,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum LlmAnnotationQueueBindings {
    Table,
    Id,
    OrgId,
    QueueId,
    ScoreConfigRowId,
    CreatedAt,
}

#[derive(DeriveIden)]
enum ScoreConfigs {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum LlmAnnotationQueueItems {
    Table,
    Id,
    OrgId,
    QueueId,
    RefType,
    RefId,
    RefTraceId,
    RefTraceStartTime,
    Status,
    ReviewedAt,
    ArchivedAt,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_item_has_two_state_status_and_orthogonal_archive_timestamp() {
        let sql = create_queue_items_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"status\" varchar(16) NOT NULL DEFAULT 'pending'"));
        assert!(sql.contains("\"archived_at\" bigint NULL"));
    }

    #[test]
    fn queue_has_no_rubric_revision_counter() {
        let sql = create_annotation_queues_statement().to_string(PostgresQueryBuilder);
        assert!(!sql.contains("\"rubric_revision\""));
    }

    #[test]
    fn binding_references_one_physical_score_config_version_row() {
        let sql = create_queue_bindings_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"score_config_row_id\" varchar(27) NOT NULL"));
        assert!(!sql.contains("\"score_config_version\""));
        assert!(sql.contains(
            "FOREIGN KEY (\"score_config_row_id\") REFERENCES \"score_configs\" (\"id\")"
        ));
    }

    #[test]
    fn unique_indexes_enforce_queue_identities() {
        let sql = indexes()
            .into_iter()
            .map(|index| index.to_string(PostgresQueryBuilder))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(sql.contains("uq_llm_annotation_queues_org_name"));
        assert!(sql.contains("uq_llm_queue_bindings_config"));
        assert!(sql.contains("uq_llm_queue_items_ref"));
        assert_eq!(sql.matches("CREATE UNIQUE INDEX").count(), 3);
    }

    #[test]
    fn discovery_index_covers_membership_filters_and_result() {
        let sql = indexes()
            .into_iter()
            .map(|index| index.to_string(PostgresQueryBuilder))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(sql.contains("idx_llm_queue_items_discovery"));
        assert!(sql.contains("(\"org_id\", \"ref_type\", \"status\", \"ref_id\")"));
    }

    #[test]
    fn migration_creates_all_queue_tables() {
        let tables = [
            create_annotation_queues_statement().to_string(PostgresQueryBuilder),
            create_queue_bindings_statement().to_string(PostgresQueryBuilder),
            create_queue_items_statement().to_string(PostgresQueryBuilder),
        ];
        for expected in [
            "llm_annotation_queues",
            "llm_annotation_queue_bindings",
            "llm_annotation_queue_items",
        ] {
            assert!(tables.iter().any(|sql| sql.contains(expected)));
        }
    }
}
