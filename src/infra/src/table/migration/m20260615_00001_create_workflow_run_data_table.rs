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
            .create_table(create_workflow_run_data_table_statement())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(WorkflowRunData::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the workflow run data table
fn create_workflow_run_data_table_statement() -> TableCreateStatement {
    Table::create()
        .table(WorkflowRunData::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(WorkflowRunData::Id)
                .integer()
                .primary_key()
                .auto_increment(),
        )
        .col(
            ColumnDef::new(WorkflowRunData::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowRunData::WorkflowId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowRunData::RunId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowRunData::TriggeredAt)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(WorkflowRunData::Data).string().not_null())
        .to_owned()
}

#[derive(DeriveIden)]
enum WorkflowRunData {
    Id,
    Table,
    OrgId,
    WorkflowId,
    RunId,
    TriggeredAt,
    Data,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_workflow_run_data_table_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "workflow_run_data" ( 
            "id" serial PRIMARY KEY,
            "org_id" varchar(256) NOT NULL,
            "workflow_id" varchar(100) NOT NULL,
            "run_id" varchar(100) NOT NULL,
            "triggered_at" bigint NOT NULL,
            "data" varchar NOT NULL
            )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_workflow_run_data_table_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "workflow_run_data" ( 
            "id" integer PRIMARY KEY AUTOINCREMENT,
            "org_id" varchar(256) NOT NULL,
            "workflow_id" varchar(100) NOT NULL,
            "run_id" varchar(100) NOT NULL,
            "triggered_at" bigint NOT NULL,
            "data" varchar NOT NULL
            )"#
        );
    }
}
