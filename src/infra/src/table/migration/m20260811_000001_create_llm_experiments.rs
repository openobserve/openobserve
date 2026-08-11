// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        manager
            .create_index(
                Index::create()
                    .name("uq_llm_experiments_org_idempotency")
                    .table(LlmExperiments::Table)
                    .col(LlmExperiments::OrgId)
                    .col(LlmExperiments::IdempotencyKey)
                    .unique()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_llm_experiments_org_created")
                    .table(LlmExperiments::Table)
                    .col(LlmExperiments::OrgId)
                    .col(LlmExperiments::CreatedAt)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(LlmExperiments::Table).to_owned())
            .await
    }
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmExperiments::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmExperiments::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmExperiments::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperiments::Name)
                .string_len(255)
                .not_null(),
        )
        .col(ColumnDef::new(LlmExperiments::Description).text().null())
        .col(
            ColumnDef::new(LlmExperiments::DatasetId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperiments::DatasetVersion)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(LlmExperiments::DatasetFilter).json().null())
        .col(ColumnDef::new(LlmExperiments::TaskConfig).json().not_null())
        .col(ColumnDef::new(LlmExperiments::Scorers).json().not_null())
        .col(
            ColumnDef::new(LlmExperiments::TrialCount)
                .integer()
                .not_null(),
        )
        .col(ColumnDef::new(LlmExperiments::Metadata).json().null())
        .col(
            ColumnDef::new(LlmExperiments::Status)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperiments::IdempotencyKey)
                .string_len(255)
                .null(),
        )
        .col(
            ColumnDef::new(LlmExperiments::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmExperiments::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum LlmExperiments {
    Table,
    Id,
    OrgId,
    Name,
    Description,
    DatasetId,
    DatasetVersion,
    DatasetFilter,
    TaskConfig,
    Scorers,
    TrialCount,
    Metadata,
    Status,
    IdempotencyKey,
    CreatedBy,
    CreatedAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn experiment_schema_contains_only_immutable_definition_and_audit_fields() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"dataset_version\" bigint NOT NULL"));
        assert!(sql.contains("\"task_config\" json NOT NULL"));
        assert!(sql.contains("\"scorers\" json NOT NULL"));
        assert!(sql.contains("\"created_by\" varchar(256) NOT NULL"));
        assert!(!sql.contains("updated_at"));
        assert!(!sql.contains("updated_by"));
    }
}
