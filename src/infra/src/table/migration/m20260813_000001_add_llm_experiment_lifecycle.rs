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
        for (column, statement) in add_column_statements() {
            if !manager
                .has_column(LlmExperiments::Table.to_string(), column)
                .await?
            {
                manager.alter_table(statement).await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [
            LlmExperiments::RetryCount,
            LlmExperiments::LifecycleVersion,
            LlmExperiments::CompletedAt,
            LlmExperiments::DeadlineAt,
            LlmExperiments::StatusReason,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(LlmExperiments::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum LlmExperiments {
    Table,
    StatusReason,
    DeadlineAt,
    CompletedAt,
    LifecycleVersion,
    RetryCount,
}

fn add_column_statements() -> Vec<(&'static str, TableAlterStatement)> {
    vec![
        (
            "status_reason",
            Table::alter()
                .table(LlmExperiments::Table)
                .add_column(ColumnDef::new(LlmExperiments::StatusReason).text().null())
                .to_owned(),
        ),
        (
            "deadline_at",
            Table::alter()
                .table(LlmExperiments::Table)
                .add_column(
                    ColumnDef::new(LlmExperiments::DeadlineAt)
                        .big_integer()
                        .not_null()
                        .default(0),
                )
                .to_owned(),
        ),
        (
            "completed_at",
            Table::alter()
                .table(LlmExperiments::Table)
                .add_column(
                    ColumnDef::new(LlmExperiments::CompletedAt)
                        .big_integer()
                        .null(),
                )
                .to_owned(),
        ),
        (
            "lifecycle_version",
            Table::alter()
                .table(LlmExperiments::Table)
                .add_column(
                    ColumnDef::new(LlmExperiments::LifecycleVersion)
                        .big_integer()
                        .not_null()
                        .default(0),
                )
                .to_owned(),
        ),
        (
            "retry_count",
            Table::alter()
                .table(LlmExperiments::Table)
                .add_column(
                    ColumnDef::new(LlmExperiments::RetryCount)
                        .integer()
                        .not_null()
                        .default(0),
                )
                .to_owned(),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use sea_query::{PostgresQueryBuilder, SqliteQueryBuilder};

    use super::*;

    #[test]
    fn adds_durable_lifecycle_columns_on_postgres_and_sqlite() {
        let statements = add_column_statements();
        let postgres = statements
            .iter()
            .map(|(_, statement)| statement.build(PostgresQueryBuilder))
            .collect::<Vec<_>>()
            .join(" ");
        let sqlite = statements
            .iter()
            .map(|(_, statement)| statement.build(SqliteQueryBuilder))
            .collect::<Vec<_>>()
            .join(" ");
        for sql in [postgres, sqlite] {
            for column in [
                "status_reason",
                "deadline_at",
                "completed_at",
                "lifecycle_version",
                "retry_count",
            ] {
                assert!(sql.contains(column));
            }
        }
    }
}
