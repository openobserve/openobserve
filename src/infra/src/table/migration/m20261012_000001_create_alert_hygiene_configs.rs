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

//! Per-org alert hygiene configuration.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(table_statement()).await?;
        manager.create_index(org_index_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AlertHygieneConfigs::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

fn table_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertHygieneConfigs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertHygieneConfigs::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::Enabled)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::FrequencyMinutes)
                .integer()
                .not_null()
                .default(1440),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::WindowMinutes)
                .integer()
                .not_null()
                .default(43200),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertHygieneConfigs::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn org_index_statement() -> IndexCreateStatement {
    Index::create()
        .name("idx_alert_hygiene_configs_org")
        .table(AlertHygieneConfigs::Table)
        .col(AlertHygieneConfigs::Org)
        .unique()
        .if_not_exists()
        .to_owned()
}

#[derive(DeriveIden)]
enum AlertHygieneConfigs {
    Table,
    Id,
    Org,
    Enabled,
    FrequencyMinutes,
    WindowMinutes,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};

    use super::*;
    use crate::table::alert_hygiene::{DEFAULT_FREQUENCY_MINUTES, DEFAULT_WINDOW_MINUTES};

    async fn migrated() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        db
    }

    async fn query(db: &DatabaseConnection, sql: &str) -> Vec<sea_orm::QueryResult> {
        db.query_all(Statement::from_string(DbBackend::Sqlite, sql.to_owned()))
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn up_pins_every_column_and_is_idempotent() {
        let db = migrated().await;
        let columns: Vec<(String, String, i32, i32)> = query(
            &db,
            "SELECT name, type, \"notnull\", pk FROM pragma_table_info('alert_hygiene_configs') \
             ORDER BY cid",
        )
        .await
        .iter()
        .map(|r| {
            (
                r.try_get("", "name").unwrap(),
                r.try_get::<String>("", "type").unwrap().to_lowercase(),
                r.try_get("", "notnull").unwrap(),
                r.try_get("", "pk").unwrap(),
            )
        })
        .collect();
        let expected = [
            ("id", "varchar(27)", 1, 1),
            ("org", "varchar(100)", 1, 0),
            ("enabled", "boolean", 1, 0),
            ("frequency_minutes", "integer", 1, 0),
            ("window_minutes", "integer", 1, 0),
            ("created_at", "bigint", 1, 0),
            ("updated_at", "bigint", 1, 0),
        ]
        .map(|(n, t, nn, pk)| (n.to_string(), t.to_string(), nn, pk));
        assert_eq!(columns, expected);
    }

    #[tokio::test]
    async fn one_row_per_org_and_the_defaults_match_the_writer() {
        let db = migrated().await;
        let insert = "INSERT INTO alert_hygiene_configs (id, org, created_at, updated_at) \
                      VALUES ('{id}', 'acme', 1, 1)";
        db.execute_unprepared(&insert.replace("{id}", "a"))
            .await
            .unwrap();
        assert!(
            db.execute_unprepared(&insert.replace("{id}", "b"))
                .await
                .is_err(),
            "a second row for the same org must be refused"
        );
        let row = &query(
            &db,
            "SELECT enabled, frequency_minutes, window_minutes FROM alert_hygiene_configs",
        )
        .await[0];
        assert!(!row.try_get::<bool>("", "enabled").unwrap());
        assert_eq!(
            row.try_get::<i32>("", "frequency_minutes").unwrap(),
            DEFAULT_FREQUENCY_MINUTES
        );
        assert_eq!(
            row.try_get::<i32>("", "window_minutes").unwrap(),
            DEFAULT_WINDOW_MINUTES
        );
    }

    #[tokio::test]
    async fn down_drops_the_table() {
        let db = migrated().await;
        let manager = SchemaManager::new(&db);
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("alert_hygiene_configs").await.unwrap());
    }
}
