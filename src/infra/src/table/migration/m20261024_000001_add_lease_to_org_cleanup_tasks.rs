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

//! Adds the worker lease to `org_cleanup_tasks`, so two compactors never run one step at once.

use sea_orm_migration::prelude::*;

const ORG_CLEANUP_TASKS: &str = "org_cleanup_tasks";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One alter option per statement, plus a `has_column` guard — see `m20260824_000001`.
        add_column(
            manager,
            ColumnDef::new(OrgCleanupTasks::RunningBy).text().null(),
        )
        .await?;
        add_column(
            manager,
            ColumnDef::new(OrgCleanupTasks::LeaseUntil)
                .big_integer()
                .null(),
        )
        .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [OrgCleanupTasks::LeaseUntil, OrgCleanupTasks::RunningBy] {
            if manager
                .has_column(ORG_CLEANUP_TASKS, &column.to_string())
                .await?
            {
                manager
                    .alter_table(
                        Table::alter()
                            .table(OrgCleanupTasks::Table)
                            .drop_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum OrgCleanupTasks {
    Table,
    RunningBy,
    LeaseUntil,
}

async fn add_column(manager: &SchemaManager<'_>, def: &mut ColumnDef) -> Result<(), DbErr> {
    let name = def.get_column_name();
    if manager.has_column(ORG_CLEANUP_TASKS, &name).await? {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(OrgCleanupTasks::Table)
                .add_column(def.to_owned())
                .to_owned(),
        )
        .await
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[tokio::test]
    async fn test_up_adds_lease_columns_and_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE org_cleanup_tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL)",
        )
        .await
        .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(
            manager
                .has_column(ORG_CLEANUP_TASKS, "running_by")
                .await
                .unwrap()
        );
        assert!(
            manager
                .has_column(ORG_CLEANUP_TASKS, "lease_until")
                .await
                .unwrap()
        );

        Migration.down(&manager).await.unwrap();
        assert!(
            !manager
                .has_column(ORG_CLEANUP_TASKS, "running_by")
                .await
                .unwrap()
        );
        assert!(
            !manager
                .has_column(ORG_CLEANUP_TASKS, "lease_until")
                .await
                .unwrap()
        );
    }
}
