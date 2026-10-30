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

//! Drops the folder's created_at column since Sea ORM maps this column's data
//! type to different Rust types creating runtime errors when running on a
//! non-PostgreSQL database.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        drop_created_at_column(manager).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Reversing this migration is not supported.
        Ok(())
    }
}

// Removes the old created_at column.
async fn drop_created_at_column(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    // gone on a re-run, and the KSUID rebuild recreates folders without it
    if !manager.has_column("folders", "created_at").await? {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(Folders::Table)
                .drop_column(Folders::CreatedAt)
                .to_owned(),
        )
        .await?;
    Ok(())
}

/// Identifiers used in queries on the folders table.
#[derive(DeriveIden)]
enum Folders {
    Table,
    CreatedAt,
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;
    use sea_orm_migration::MigrationName;

    use super::*;
    use crate::table::migration::m20241114_000001_create_folders_table as create_folders;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20241116_000002_drop_folders_created_at_column"
        );
    }

    #[tokio::test]
    async fn test_up_drops_created_at() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        create_folders::Migration.up(&manager).await.unwrap();
        assert!(manager.has_column("folders", "created_at").await.unwrap());
        Migration.up(&manager).await.unwrap();
        assert!(!manager.has_column("folders", "created_at").await.unwrap());
    }

    #[tokio::test]
    async fn test_up_reruns_once_created_at_is_gone() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        create_folders::Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        Migration
            .up(&manager)
            .await
            .expect("re-running must not fail on the dropped column");
        assert!(!manager.has_column("folders", "created_at").await.unwrap());
    }
}
