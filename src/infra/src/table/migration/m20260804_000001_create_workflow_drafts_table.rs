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
            .create_table(create_workflow_drafts_table_statement())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(WorkflowDrafts::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the workflow drafts table
fn create_workflow_drafts_table_statement() -> TableCreateStatement {
    Table::create()
        .table(WorkflowDrafts::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(WorkflowDrafts::Id)
                .string_len(100)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(WorkflowDrafts::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowDrafts::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowDrafts::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowDrafts::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowDrafts::Name)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(WorkflowDrafts::Description)
                .string_len(500)
                .not_null(),
        )
        .col(ColumnDef::new(WorkflowDrafts::Nodes).string().not_null())
        .col(ColumnDef::new(WorkflowDrafts::Edges).string().not_null())
        .to_owned()
}

#[derive(DeriveIden)]
enum WorkflowDrafts {
    Table,
    Id,
    Name,
    Description,
    OrgId,
    Nodes,
    Edges,
    CreatedAt,
    UpdatedAt,
    CreatedBy,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_workflow_drafts_table_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "workflow_drafts" ( 
            "id" varchar(100) NOT NULL PRIMARY KEY,
            "org_id" varchar(256) NOT NULL,
            "created_at" bigint NOT NULL,
            "updated_at" bigint NOT NULL,
            "created_by" varchar(256) NOT NULL,
            "name" varchar(256) NOT NULL,
            "description" varchar(500) NOT NULL,
            "nodes" varchar NOT NULL,
            "edges" varchar NOT NULL 
            )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_workflow_drafts_table_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "workflow_drafts" ( 
            "id" varchar(100) NOT NULL PRIMARY KEY,
            "org_id" varchar(256) NOT NULL,
            "created_at" bigint NOT NULL,
            "updated_at" bigint NOT NULL,
            "created_by" varchar(256) NOT NULL,
            "name" varchar(256) NOT NULL,
            "description" varchar(500) NOT NULL,
            "nodes" varchar NOT NULL,
            "edges" varchar NOT NULL 
            )"#
        );
    }
}
