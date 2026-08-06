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
            .create_table(create_workflow_errors_table_statement())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(WorkflowErrors::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the workflow errors table
fn create_workflow_errors_table_statement() -> TableCreateStatement {
    Table::create()
        .table(WorkflowErrors::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(WorkflowErrors::Id)
                .integer()
                .primary_key()
                .auto_increment(),
        )
        .col(
            ColumnDef::new(WorkflowErrors::Cluster)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowErrors::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowErrors::WorkflowId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowErrors::RunId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowErrors::RanAt)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(WorkflowErrors::Data).string().not_null())
        .col(ColumnDef::new(WorkflowErrors::InputData).string().null())
        .to_owned()
}

#[derive(DeriveIden)]
enum WorkflowErrors {
    Table,
    Id,
    WorkflowId,
    RunId,
    OrgId,
    RanAt,
    Data,
    Cluster,
    InputData,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_workflow_errors_table_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "workflow_errors" ( 
            "id" serial PRIMARY KEY,
            "cluster" varchar(100) NOT NULL,
            "org_id" varchar(256) NOT NULL,
            "workflow_id" varchar(100) NOT NULL,
            "run_id" varchar(100) NOT NULL,
            "ran_at" bigint NOT NULL,
            "data" varchar NOT NULL,
            "input_data" varchar NULL
            )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_workflow_errors_table_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "workflow_errors" ( 
            "id" integer PRIMARY KEY AUTOINCREMENT,
            "cluster" varchar(100) NOT NULL,
            "org_id" varchar(256) NOT NULL,
            "workflow_id" varchar(100) NOT NULL,
            "run_id" varchar(100) NOT NULL,
            "ran_at" bigint NOT NULL,
            "data" varchar NOT NULL,
            "input_data" varchar NULL
            )"#
        );
    }
}
