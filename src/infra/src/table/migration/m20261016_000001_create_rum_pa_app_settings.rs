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

const FUNNELS_TABLE: &str = "rum_pa_funnels";
const RULES_HASH: &str = "rules_hash";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(settings_table()).await?;
        // add_column_if_not_exists renders IF NOT EXISTS, which MySQL rejects.
        if !manager.has_column(FUNNELS_TABLE, RULES_HASH).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(RumPaFunnels::Table)
                        .add_column(
                            ColumnDef::new(RumPaFunnels::RulesHash)
                                .string_len(16)
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(FUNNELS_TABLE, RULES_HASH).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(RumPaFunnels::Table)
                        .drop_column(RumPaFunnels::RulesHash)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(
                Table::drop()
                    .table(RumPaAppSettings::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum RumPaAppSettings {
    Table,
    Id,
    OrgId,
    App,
    Bots,
    Sessions,
    Pages,
    Version,
    CreatedBy,
    UpdatedBy,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum RumPaFunnels {
    Table,
    RulesHash,
}

fn settings_table() -> TableCreateStatement {
    Table::create()
        .table(RumPaAppSettings::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RumPaAppSettings::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(RumPaAppSettings::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaAppSettings::App)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaAppSettings::Bots)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(ColumnDef::new(RumPaAppSettings::Sessions).json().not_null())
        .col(ColumnDef::new(RumPaAppSettings::Pages).json().not_null())
        .col(
            ColumnDef::new(RumPaAppSettings::Version)
                .integer()
                .not_null()
                .default(1),
        )
        .col(
            ColumnDef::new(RumPaAppSettings::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaAppSettings::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaAppSettings::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaAppSettings::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection};

    use super::*;

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn sqlite() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        super::super::m20261003_000001_create_rum_pa_tables::Migration
            .up(&SchemaManager::new(&db))
            .await
            .unwrap();
        db
    }

    /// `(name, declared type, notnull, pk)` per column, in table order.
    async fn columns(db: &DatabaseConnection, table: &str) -> Vec<(String, String, i32, i32)> {
        db.query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            format!(
                "SELECT name, type, \"notnull\", pk FROM pragma_table_info('{table}') ORDER BY cid"
            ),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| {
            (
                row.try_get::<String>("", "name").unwrap(),
                row.try_get::<String>("", "type").unwrap().to_lowercase(),
                row.try_get::<i32>("", "notnull").unwrap(),
                row.try_get::<i32>("", "pk").unwrap(),
            )
        })
        .collect()
    }

    async fn names(db: &DatabaseConnection, table: &str) -> Vec<String> {
        columns(db, table).await.into_iter().map(|c| c.0).collect()
    }

    async fn column(
        db: &DatabaseConnection,
        table: &str,
        name: &str,
    ) -> (String, String, i32, i32) {
        columns(db, table)
            .await
            .into_iter()
            .find(|c| c.0 == name)
            .unwrap_or_else(|| panic!("{table} has no column {name}"))
    }

    async fn insert_settings(
        db: &DatabaseConnection,
        id: &str,
        org: &str,
        app: &str,
    ) -> Result<(), DbErr> {
        db.execute_unprepared(&format!(
            "INSERT INTO rum_pa_app_settings (id, org_id, app, sessions, pages, created_by, \
             updated_by, created_at, updated_at) VALUES ('{id}', '{org}', '{app}', '[]', '[]', \
             'a@b.c', 'a@b.c', 1, 1)"
        ))
        .await
        .map(|_| ())
    }

    #[tokio::test]
    async fn p1_r3_up_twice_builds_app_settings_and_rules_hash_with_exact_columns() {
        let db = sqlite().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert_eq!(
            names(&db, "rum_pa_app_settings").await,
            [
                "id",
                "org_id",
                "app",
                "bots",
                "sessions",
                "pages",
                "version",
                "created_by",
                "updated_by",
                "created_at",
                "updated_at"
            ]
        );
        assert_eq!(
            names(&db, "rum_pa_funnels").await,
            [
                "id",
                "org_id",
                "app",
                "name",
                "name_key",
                "description",
                "definition",
                "sql",
                "event_ids",
                "version",
                "created_by",
                "updated_by",
                "created_at",
                "updated_at",
                "rules_hash"
            ]
        );
    }

    #[tokio::test]
    async fn p1_r1_app_settings_key_columns_have_the_specified_types() {
        let db = sqlite().await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        let t = "rum_pa_app_settings";
        let (_, ty, _, pk) = column(&db, t, "id").await;
        assert_eq!((ty.as_str(), pk), ("varchar(27)", 1));
        assert_eq!(column(&db, t, "org_id").await.1, "varchar(256)");
        assert_eq!(column(&db, t, "app").await.1, "varchar(256)");
        assert_eq!(column(&db, t, "bots").await.1, "boolean");
        assert_eq!(column(&db, t, "version").await.1, "integer");
        let json = column(&db, "rum_pa_funnels", "definition").await.1;
        assert_eq!(column(&db, t, "sessions").await.1, json);
        assert_eq!(column(&db, t, "pages").await.1, json);
    }

    #[tokio::test]
    async fn p1_r1_bots_defaults_to_true_and_version_to_one() {
        let db = sqlite().await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        insert_settings(&db, "s1", "acme", "web").await.unwrap();
        let row = db
            .query_one(sea_orm::Statement::from_string(
                sea_orm::DatabaseBackend::Sqlite,
                "SELECT bots, version FROM rum_pa_app_settings WHERE id = 's1'".to_string(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert!(row.try_get::<bool>("", "bots").unwrap());
        assert_eq!(row.try_get::<i32>("", "version").unwrap(), 1);
    }

    #[tokio::test]
    async fn one_settings_row_per_id_and_apps_differing_in_case_coexist() {
        let db = sqlite().await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        insert_settings(&db, "s1", "acme", "web").await.unwrap();
        let err = insert_settings(&db, "s1", "acme", "ios").await.unwrap_err();
        assert!(
            matches!(
                err.sql_err(),
                Some(sea_orm::SqlErr::UniqueConstraintViolation(_))
            ),
            "{err}"
        );
        insert_settings(&db, "s2", "acme", "Web").await.unwrap();
        insert_settings(&db, "s3", "other", "web").await.unwrap();
    }

    #[tokio::test]
    async fn p1_r2_rules_hash_is_a_nullable_varchar_16_on_funnels() {
        let db = sqlite().await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        let (_, ty, notnull, _) = column(&db, "rum_pa_funnels", "rules_hash").await;
        assert_eq!((ty.as_str(), notnull), ("varchar(16)", 0));
    }

    #[tokio::test]
    async fn p1_r3_down_drops_the_settings_table_and_the_rules_hash_column() {
        let db = sqlite().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("rum_pa_app_settings").await.unwrap());
        assert!(
            !manager
                .has_column("rum_pa_funnels", "rules_hash")
                .await
                .unwrap()
        );
        assert!(manager.has_table("rum_pa_funnels").await.unwrap());
    }

    #[tokio::test]
    async fn p1_r2_down_skips_a_rules_hash_column_that_is_absent() {
        let db = sqlite().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        db.execute_unprepared("ALTER TABLE rum_pa_funnels DROP COLUMN rules_hash")
            .await
            .unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("rum_pa_app_settings").await.unwrap());
    }

    #[tokio::test]
    async fn p1_r2_up_after_down_adds_rules_hash_again() {
        let db = sqlite().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(
            manager
                .has_column("rum_pa_funnels", "rules_hash")
                .await
                .unwrap()
        );
        assert!(manager.has_table("rum_pa_app_settings").await.unwrap());
    }
}
