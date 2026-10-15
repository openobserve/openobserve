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

const EVENTS_NAME_IDX: &str = "rum_pa_named_events_org_app_name_idx";
const FUNNELS_NAME_IDX: &str = "rum_pa_funnels_org_app_name_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(events_table()).await?;
        manager.create_table(funnels_table()).await?;
        manager.create_table(tombstones_table()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(RumPaTombstones::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(RumPaFunnels::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(RumPaNamedEvents::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum RumPaNamedEvents {
    Table,
    Id,
    OrgId,
    App,
    Name,
    NameKey,
    Rules,
    Version,
    CreatedBy,
    UpdatedBy,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum RumPaFunnels {
    Table,
    Id,
    OrgId,
    App,
    Name,
    NameKey,
    Description,
    Definition,
    Sql,
    EventIds,
    Version,
    CreatedBy,
    UpdatedBy,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum RumPaTombstones {
    Table,
    Kind,
    Id,
    OrgId,
    Version,
    DeletedAt,
}

fn events_table() -> TableCreateStatement {
    Table::create()
        .table(RumPaNamedEvents::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RumPaNamedEvents::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(RumPaNamedEvents::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaNamedEvents::App)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaNamedEvents::Name)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaNamedEvents::NameKey)
                .string_len(128)
                .not_null(),
        )
        .col(ColumnDef::new(RumPaNamedEvents::Rules).json().not_null())
        .col(
            ColumnDef::new(RumPaNamedEvents::Version)
                .integer()
                .not_null()
                .default(1),
        )
        .col(
            ColumnDef::new(RumPaNamedEvents::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaNamedEvents::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaNamedEvents::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaNamedEvents::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .index(
            Index::create()
                .name(EVENTS_NAME_IDX)
                .col(RumPaNamedEvents::OrgId)
                .col(RumPaNamedEvents::App)
                .col(RumPaNamedEvents::NameKey)
                .unique(),
        )
        .to_owned()
}

fn funnels_table() -> TableCreateStatement {
    Table::create()
        .table(RumPaFunnels::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RumPaFunnels::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(RumPaFunnels::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(RumPaFunnels::App).string_len(256).not_null())
        .col(
            ColumnDef::new(RumPaFunnels::Name)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaFunnels::NameKey)
                .string_len(128)
                .not_null(),
        )
        .col(ColumnDef::new(RumPaFunnels::Description).text().null())
        .col(ColumnDef::new(RumPaFunnels::Definition).json().not_null())
        .col(ColumnDef::new(RumPaFunnels::Sql).text().not_null())
        .col(ColumnDef::new(RumPaFunnels::EventIds).json().not_null())
        .col(
            ColumnDef::new(RumPaFunnels::Version)
                .integer()
                .not_null()
                .default(1),
        )
        .col(
            ColumnDef::new(RumPaFunnels::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaFunnels::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaFunnels::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaFunnels::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .index(
            Index::create()
                .name(FUNNELS_NAME_IDX)
                .col(RumPaFunnels::OrgId)
                .col(RumPaFunnels::App)
                .col(RumPaFunnels::NameKey)
                .unique(),
        )
        .to_owned()
}

/// One row per deleted id, so a replicated put older than the delete cannot bring the row back.
fn tombstones_table() -> TableCreateStatement {
    Table::create()
        .table(RumPaTombstones::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RumPaTombstones::Kind)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaTombstones::Id)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaTombstones::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaTombstones::Version)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RumPaTombstones::DeletedAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(RumPaTombstones::Kind)
                .col(RumPaTombstones::Id),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;
    use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection};

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &events_table().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "rum_pa_named_events" (
                "id" varchar(27) NOT NULL PRIMARY KEY,
                "org_id" varchar(256) NOT NULL,
                "app" varchar(256) NOT NULL,
                "name" varchar(128) NOT NULL,
                "name_key" varchar(128) NOT NULL,
                "rules" json NOT NULL,
                "version" integer NOT NULL DEFAULT 1,
                "created_by" varchar(256) NOT NULL,
                "updated_by" varchar(256) NOT NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                CONSTRAINT "rum_pa_named_events_org_app_name_idx" UNIQUE ("org_id", "app", "name_key")
            )"#
        );
        collapsed_eq!(
            &funnels_table().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "rum_pa_funnels" (
                "id" varchar(27) NOT NULL PRIMARY KEY,
                "org_id" varchar(256) NOT NULL,
                "app" varchar(256) NOT NULL,
                "name" varchar(128) NOT NULL,
                "name_key" varchar(128) NOT NULL,
                "description" text NULL,
                "definition" json NOT NULL,
                "sql" text NOT NULL,
                "event_ids" json NOT NULL,
                "version" integer NOT NULL DEFAULT 1,
                "created_by" varchar(256) NOT NULL,
                "updated_by" varchar(256) NOT NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                CONSTRAINT "rum_pa_funnels_org_app_name_idx" UNIQUE ("org_id", "app", "name_key")
            )"#
        );
        collapsed_eq!(
            &tombstones_table().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "rum_pa_tombstones" (
                "kind" varchar(16) NOT NULL,
                "id" varchar(27) NOT NULL,
                "org_id" varchar(256) NOT NULL,
                "version" integer NOT NULL,
                "deleted_at" bigint NOT NULL,
                PRIMARY KEY ("kind", "id")
            )"#
        );
    }

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn sqlite() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        Database::connect(opts).await.unwrap()
    }

    async fn columns(db: &DatabaseConnection, table: &str) -> Vec<String> {
        db.query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            format!("SELECT name FROM pragma_table_info('{table}') ORDER BY cid"),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").unwrap())
        .collect()
    }

    async fn insert_event(db: &DatabaseConnection, id: &str, name_key: &str) -> Result<(), DbErr> {
        db.execute_unprepared(&format!(
            "INSERT INTO rum_pa_named_events (id, org_id, app, name, name_key, rules, created_by, \
             updated_by, created_at, updated_at) VALUES ('{id}', 'acme', 'web', 'Signup', \
             '{name_key}', '[]', 'a@b.c', 'a@b.c', 1, 1)"
        ))
        .await
        .map(|_| ())
    }

    #[tokio::test]
    async fn up_twice_builds_both_tables_with_their_exact_columns() {
        let db = sqlite().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert_eq!(
            columns(&db, "rum_pa_named_events").await,
            [
                "id",
                "org_id",
                "app",
                "name",
                "name_key",
                "rules",
                "version",
                "created_by",
                "updated_by",
                "created_at",
                "updated_at"
            ]
        );
        assert_eq!(
            columns(&db, "rum_pa_funnels").await,
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
                "updated_at"
            ]
        );
        assert_eq!(
            columns(&db, "rum_pa_tombstones").await,
            ["kind", "id", "org_id", "version", "deleted_at"]
        );
    }

    #[tokio::test]
    async fn a_tombstone_is_unique_per_kind_and_id() {
        let db = sqlite().await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        let stone = |kind: &str| {
            format!(
                "INSERT INTO rum_pa_tombstones (kind, id, org_id, version, deleted_at) \
                 VALUES ('{kind}', 'x', 'acme', 1, 1)"
            )
        };
        db.execute_unprepared(&stone("funnels")).await.unwrap();
        db.execute_unprepared(&stone("named_events")).await.unwrap();
        let err = db.execute_unprepared(&stone("funnels")).await.unwrap_err();
        assert!(
            matches!(
                err.sql_err(),
                Some(sea_orm::SqlErr::UniqueConstraintViolation(_))
            ),
            "{err}"
        );
    }

    #[tokio::test]
    async fn the_same_name_key_in_one_app_is_a_unique_violation() {
        let db = sqlite().await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        insert_event(&db, "a", "signup").await.unwrap();
        let err = insert_event(&db, "b", "signup").await.unwrap_err();
        assert!(
            matches!(
                err.sql_err(),
                Some(sea_orm::SqlErr::UniqueConstraintViolation(_))
            ),
            "{err}"
        );
        insert_event(&db, "c", "login").await.unwrap();
    }

    #[tokio::test]
    async fn down_drops_both_tables() {
        let db = sqlite().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("rum_pa_named_events").await.unwrap());
        assert!(!manager.has_table("rum_pa_funnels").await.unwrap());
        assert!(!manager.has_table("rum_pa_tombstones").await.unwrap());
    }
}
