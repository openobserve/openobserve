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

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_org_cleanup_tasks_table())
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("org_cleanup_tasks_org_step_idx")
                    .table(OrgCleanupTasks::Table)
                    .col(OrgCleanupTasks::OrgId)
                    .col(OrgCleanupTasks::Step)
                    .unique()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("org_cleanup_tasks_status_idx")
                    .table(OrgCleanupTasks::Table)
                    .col(OrgCleanupTasks::Status)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(OrgCleanupTasks::Table).to_owned())
            .await
    }
}

fn create_org_cleanup_tasks_table() -> TableCreateStatement {
    Table::create()
        .table(OrgCleanupTasks::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(OrgCleanupTasks::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(OrgCleanupTasks::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgCleanupTasks::OrgName)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgCleanupTasks::Step)
                .string_len(512)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgCleanupTasks::StepOrder)
                .integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(OrgCleanupTasks::Status)
                .string_len(16)
                .not_null()
                .default("pending"),
        )
        .col(
            ColumnDef::new(OrgCleanupTasks::Attempts)
                .integer()
                .not_null()
                .default(0),
        )
        .col(ColumnDef::new(OrgCleanupTasks::LastError).text().null())
        .col(
            ColumnDef::new(OrgCleanupTasks::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgCleanupTasks::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum OrgCleanupTasks {
    Table,
    Id,
    OrgId,
    OrgName,
    Step,
    StepOrder,
    Status,
    Attempts,
    LastError,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_table_statement_contains_table_name() {
        let sql = create_org_cleanup_tasks_table().build(SqliteQueryBuilder);
        assert!(sql.contains("org_cleanup_tasks"));
    }

    #[test]
    fn test_migration_name() {
        use sea_orm_migration::MigrationName;
        assert_eq!(
            Migration.name(),
            "m20260623_000001_create_org_cleanup_tasks"
        );
    }
}
