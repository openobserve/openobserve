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

//! Dataset storage with append-only Dataset Item MVCC and logical
//! `review_submission_id` provenance into the authoritative `_llm_scores`
//! stream for LLM Observability Phase 2.5a. Explicit adjudication is deferred
//! to a later phase.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_datasets_statement()).await?;
        manager
            .create_table(create_dataset_items_statement())
            .await?;

        for index in indexes() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(LlmDatasetItems::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(LlmDatasets::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_datasets_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmDatasets::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmDatasets::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmDatasets::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmDatasets::Name)
                .string_len(255)
                .not_null(),
        )
        .col(ColumnDef::new(LlmDatasets::Description).text().null())
        .col(ColumnDef::new(LlmDatasets::Tags).json().null())
        // Allocated transactionally for every Dataset Item insert, edit, or
        // soft-delete. Dataset Item rows themselves are never updated.
        .col(
            ColumnDef::new(LlmDatasets::GlobalVersion)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(LlmDatasets::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmDatasets::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmDatasets::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmDatasets::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_dataset_items_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmDatasetItems::Table)
        .if_not_exists()
        // Immutable physical identity. Phase 3 ExperimentRunItem points here.
        .col(
            ColumnDef::new(LlmDatasetItems::RowId)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        // Stable identity shared by all versions of one golden datum.
        .col(
            ColumnDef::new(LlmDatasetItems::LogicalId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmDatasetItems::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmDatasetItems::DatasetId)
                .string_len(27)
                .not_null(),
        )
        .col(ColumnDef::new(LlmDatasetItems::Input).json().not_null())
        // Non-empty is validated on every write path; NULL is forbidden here.
        .col(
            ColumnDef::new(LlmDatasetItems::ExpectedOutput)
                .json()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmDatasetItems::GlobalVersion)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmDatasetItems::IsDeleted)
                .boolean()
                .not_null()
                .default(false),
        )
        // trace | annotation | manual. CSV import is intentionally manual.
        .col(
            ColumnDef::new(LlmDatasetItems::Source)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmDatasetItems::SourceRef)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(LlmDatasetItems::SourceSpanId)
                .string_len(256)
                .null(),
        )
        .col(ColumnDef::new(LlmDatasetItems::Metadata).json().null())
        .col(ColumnDef::new(LlmDatasetItems::Tags).json().null())
        .col(
            ColumnDef::new(LlmDatasetItems::QueueId)
                .string_len(27)
                .null(),
        )
        .col(
            ColumnDef::new(LlmDatasetItems::ReviewSubmissionId)
                .string_len(27)
                .null(),
        )
        .col(
            ColumnDef::new(LlmDatasetItems::ImportFilename)
                .string_len(255)
                .null(),
        )
        .col(
            ColumnDef::new(LlmDatasetItems::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmDatasetItems::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn indexes() -> Vec<IndexCreateStatement> {
    vec![
        unique_index(
            "uq_llm_datasets_org_name",
            LlmDatasets::Table,
            [LlmDatasets::OrgId, LlmDatasets::Name],
        ),
        // One dataset-wide sequence value identifies exactly one immutable row.
        unique_index(
            "uq_llm_dataset_items_version",
            LlmDatasetItems::Table,
            [LlmDatasetItems::DatasetId, LlmDatasetItems::GlobalVersion],
        ),
        index(
            "idx_llm_dataset_items_latest",
            LlmDatasetItems::Table,
            [
                LlmDatasetItems::DatasetId,
                LlmDatasetItems::LogicalId,
                LlmDatasetItems::GlobalVersion,
            ],
        ),
        index(
            "idx_llm_dataset_items_source",
            LlmDatasetItems::Table,
            [LlmDatasetItems::OrgId, LlmDatasetItems::SourceRef],
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
enum LlmDatasets {
    Table,
    Id,
    OrgId,
    Name,
    Description,
    Tags,
    GlobalVersion,
    CreatedBy,
    CreatedAt,
    UpdatedBy,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum LlmDatasetItems {
    Table,
    RowId,
    LogicalId,
    OrgId,
    DatasetId,
    Input,
    ExpectedOutput,
    GlobalVersion,
    IsDeleted,
    Source,
    SourceRef,
    SourceSpanId,
    Metadata,
    Tags,
    QueueId,
    ReviewSubmissionId,
    ImportFilename,
    UpdatedBy,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dataset_item_schema_is_append_only_mvcc_without_lifecycle_or_scope() {
        let sql = create_dataset_items_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"row_id\" varchar(27) NOT NULL PRIMARY KEY"));
        assert!(sql.contains("\"logical_id\" varchar(27) NOT NULL"));
        assert!(sql.contains("\"global_version\" bigint NOT NULL"));
        assert!(sql.contains("\"expected_output\" json NOT NULL"));
        assert!(!sql.contains("\"status\""));
        assert!(!sql.contains("\"source_scope\""));
    }

    #[test]
    fn dataset_schema_includes_metadata_tags() {
        let sql = create_datasets_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"tags\" json NULL"));
    }

    #[test]
    fn dataset_item_keeps_stream_review_submission_provenance() {
        let sql = create_dataset_items_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"queue_id\" varchar(27) NULL"));
        assert!(sql.contains("\"review_submission_id\" varchar(27) NULL"));
        assert!(!sql.contains("\"adjudication_id\""));
        assert!(!sql.contains("\"adjudicated_by\""));
        assert!(!sql.contains("\"adjudicated_at\""));
    }

    #[test]
    fn unique_indexes_protect_dataset_names_and_global_versions() {
        let sql = indexes()
            .into_iter()
            .map(|index| index.to_string(PostgresQueryBuilder))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(sql.contains("uq_llm_datasets_org_name"));
        assert!(sql.contains("uq_llm_dataset_items_version"));
        assert_eq!(sql.matches("CREATE UNIQUE INDEX").count(), 2);
    }
}
