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
        // Add org_id column with a default of empty string so existing rows are
        // non-null. Existing short URLs without an org are effectively "legacy"
        // and will be accessible to any org (the service layer treats "" as a
        // wildcard for backwards compatibility).
        //
        // The `short_urls` table is created from the entity definition
        // (`create_table_from_entity`), so on a fresh database the column already
        // exists by the time this migration runs. SQLite ignores the
        // `IF NOT EXISTS` guard on `ADD COLUMN`, so guard explicitly with
        // `has_column` to keep this idempotent across backends.
        if !manager.has_column("short_urls", "org_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(ShortUrls::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(ShortUrls::OrgId)
                                .string_len(256)
                                .not_null()
                                .default(""),
                        )
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("short_urls", "org_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(ShortUrls::Table)
                        .drop_column(ShortUrls::OrgId)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ShortUrls {
    Table,
    OrgId,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260622_000001_add_org_id_to_short_urls"
        );
    }

    async fn create_short_urls_table(db: &sea_orm::DatabaseConnection, with_org_id: bool) {
        let org_id_col = if with_org_id {
            ", org_id TEXT NOT NULL DEFAULT ''"
        } else {
            ""
        };
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "CREATE TABLE short_urls (id INTEGER PRIMARY KEY AUTOINCREMENT, \
                 short_id TEXT NOT NULL, original_url TEXT NOT NULL, \
                 created_ts BIGINT NOT NULL{org_id_col});"
            ),
        ))
        .await
        .unwrap();
    }

    // Reproduces the CI failure: on a fresh DB the table is created from the
    // entity (which already has org_id), so `up()` must be a no-op rather than
    // panicking with "duplicate column name".
    #[tokio::test]
    async fn test_up_is_noop_when_column_already_exists() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_short_urls_table(&db, true).await;
        let manager = SchemaManager::new(&db);
        Migration
            .up(&manager)
            .await
            .expect("up must not fail when org_id already exists");
        assert!(manager.has_column("short_urls", "org_id").await.unwrap());
    }

    // Upgrading an old DB created before org_id existed: the column must be added.
    #[tokio::test]
    async fn test_up_adds_column_when_missing() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_short_urls_table(&db, false).await;
        let manager = SchemaManager::new(&db);
        assert!(!manager.has_column("short_urls", "org_id").await.unwrap());
        Migration
            .up(&manager)
            .await
            .expect("up must add org_id when missing");
        assert!(manager.has_column("short_urls", "org_id").await.unwrap());
    }

    // up() then down() then up() must all succeed (idempotency both directions).
    #[tokio::test]
    async fn test_up_down_round_trip() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_short_urls_table(&db, false).await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column("short_urls", "org_id").await.unwrap());
        Migration
            .down(&manager)
            .await
            .expect("down must be idempotent");
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_column("short_urls", "org_id").await.unwrap());
    }
}
