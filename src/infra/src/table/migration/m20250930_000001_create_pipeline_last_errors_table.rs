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

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_pipeline_last_errors_table_statement())
            .await?;

        // Create index for efficient org_id queries
        manager
            .create_index(
                Index::create()
                    .name("idx_pipeline_last_errors_org_timestamp")
                    .table(PipelineLastErrors::Table)
                    .col(PipelineLastErrors::OrgId)
                    .col(PipelineLastErrors::LastErrorTimestamp)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(PipelineLastErrors::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the pipeline_last_errors table.
fn create_pipeline_last_errors_table_statement() -> TableCreateStatement {
    Table::create()
        .table(PipelineLastErrors::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(PipelineLastErrors::PipelineId)
                .string_len(255)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(PipelineLastErrors::OrgId)
                .string_len(255)
                .not_null(),
        )
        .col(
            ColumnDef::new(PipelineLastErrors::PipelineName)
                .string_len(255)
                .not_null(),
        )
        .col(
            ColumnDef::new(PipelineLastErrors::LastErrorTimestamp)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(PipelineLastErrors::ErrorSummary).text())
        .col(ColumnDef::new(PipelineLastErrors::NodeErrors).json())
        .col(
            ColumnDef::new(PipelineLastErrors::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(PipelineLastErrors::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

/// Identifiers used in queries on the pipeline_last_errors table.
#[derive(DeriveIden)]
enum PipelineLastErrors {
    Table,
    PipelineId,
    OrgId,
    PipelineName,
    LastErrorTimestamp,
    ErrorSummary,
    NodeErrors,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_pipeline_last_errors_table_statement().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "pipeline_last_errors" (
                "pipeline_id" varchar(255) NOT NULL PRIMARY KEY,
                "org_id" varchar(255) NOT NULL,
                "pipeline_name" varchar(255) NOT NULL,
                "last_error_timestamp" bigint NOT NULL,
                "error_summary" text,
                "node_errors" json,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL
            )"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_pipeline_last_errors_table_statement().to_string(MysqlQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS `pipeline_last_errors` (
                `pipeline_id` varchar(255) NOT NULL PRIMARY KEY,
                `org_id` varchar(255) NOT NULL,
                `pipeline_name` varchar(255) NOT NULL,
                `last_error_timestamp` bigint NOT NULL,
                `error_summary` text,
                `node_errors` json,
                `created_at` bigint NOT NULL,
                `updated_at` bigint NOT NULL
            )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_pipeline_last_errors_table_statement().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "pipeline_last_errors" (
                "pipeline_id" varchar(255) NOT NULL PRIMARY KEY,
                "org_id" varchar(255) NOT NULL,
                "pipeline_name" varchar(255) NOT NULL,
                "last_error_timestamp" bigint NOT NULL,
                "error_summary" text,
                "node_errors" json_text,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL
            )"#
        );
    }
}
