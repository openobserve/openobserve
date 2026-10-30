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

const TABLE: &str = "rum_pa_tombstones";
const COLUMN: &str = "name";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum RumPaTombstones {
    Table,
    Name,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // A has_column guard: add_column_if_not_exists renders IF NOT EXISTS, which Sqlite
        // ignores, so a bare re-run (tests replay this migration directly, bypassing the
        // applied-migrations table) would otherwise fail with "duplicate column name".
        if manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(RumPaTombstones::Table)
                    .add_column(ColumnDef::new(RumPaTombstones::Name).string_len(128).null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Symmetric with up(): a down on a schema that never got the column must not error.
        if !manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(RumPaTombstones::Table)
                    .drop_column(RumPaTombstones::Name)
                    .to_owned(),
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection};

    use super::*;
    use crate::table::migration::m20261003_000001_create_rum_pa_tables;

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn sqlite() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        Database::connect(opts).await.unwrap()
    }

    async fn columns(db: &DatabaseConnection) -> Vec<String> {
        db.query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "SELECT name FROM pragma_table_info('rum_pa_tombstones') ORDER BY cid".to_string(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").unwrap())
        .collect()
    }

    #[tokio::test]
    async fn up_adds_a_nullable_name_column_and_down_drops_it() {
        let db = sqlite().await;
        let manager = SchemaManager::new(&db);
        m20261003_000001_create_rum_pa_tables::Migration
            .up(&manager)
            .await
            .unwrap();
        Migration.up(&manager).await.unwrap();
        assert_eq!(
            columns(&db).await,
            ["kind", "id", "org_id", "version", "deleted_at", "name"]
        );
        db.execute_unprepared(
            "INSERT INTO rum_pa_tombstones (kind, id, org_id, version, deleted_at) \
             VALUES ('named_events', 'x', 'acme', 1, 1)",
        )
        .await
        .unwrap();
        Migration.down(&manager).await.unwrap();
        assert_eq!(
            columns(&db).await,
            ["kind", "id", "org_id", "version", "deleted_at"]
        );
    }

    /// A second `up()` (as happens when a test process is retried against a persistent store)
    /// must not fail with "duplicate column name".
    #[tokio::test]
    async fn up_and_down_are_each_idempotent() {
        let db = sqlite().await;
        let manager = SchemaManager::new(&db);
        m20261003_000001_create_rum_pa_tables::Migration
            .up(&manager)
            .await
            .unwrap();
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert_eq!(
            columns(&db).await,
            ["kind", "id", "org_id", "version", "deleted_at", "name"]
        );
        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert_eq!(
            columns(&db).await,
            ["kind", "id", "org_id", "version", "deleted_at"]
        );
    }
}
