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

const DOWNTIMES_ORG_IDX: &str = "downtimes_org_idx";
const DOWNTIMES_ORG_FOLDER_IDX: &str = "downtimes_org_folder_idx";
const DOWNTIMES_ORG_ENDS_AT_IDX: &str = "downtimes_org_ends_at_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_downtimes_table()).await?;
        manager.create_index(create_org_idx()).await?;
        manager.create_index(create_org_folder_idx()).await?;
        manager.create_index(create_org_ends_at_idx()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Downtimes::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_downtimes_table() -> TableCreateStatement {
    Table::create()
        .table(Downtimes::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(Downtimes::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(Downtimes::Org).string_len(100).not_null())
        .col(ColumnDef::new(Downtimes::FolderId).char_len(27).not_null())
        .col(ColumnDef::new(Downtimes::Name).string_len(256).not_null())
        .col(ColumnDef::new(Downtimes::Reason).text())
        .col(ColumnDef::new(Downtimes::Condition).json())
        .col(ColumnDef::new(Downtimes::Targets).json().not_null())
        .col(
            ColumnDef::new(Downtimes::ShowBanner)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(ColumnDef::new(Downtimes::Repeat).small_integer().not_null())
        .col(ColumnDef::new(Downtimes::StartsAt).big_integer().not_null())
        .col(ColumnDef::new(Downtimes::EndsAt).big_integer())
        .col(
            ColumnDef::new(Downtimes::Timezone)
                .string_len(64)
                .not_null(),
        )
        .col(ColumnDef::new(Downtimes::StartTimeLocal).string_len(5))
        .col(
            ColumnDef::new(Downtimes::DurationSecs)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(Downtimes::Weekdays).json())
        .col(ColumnDef::new(Downtimes::CancelledAt).big_integer())
        .col(ColumnDef::new(Downtimes::CancelledBy).string_len(256))
        .col(ColumnDef::new(Downtimes::DeletedAt).big_integer())
        .col(ColumnDef::new(Downtimes::Notifications).json().null())
        .col(
            ColumnDef::new(Downtimes::OriginRegion)
                .string_len(64)
                .null(),
        )
        .col(
            ColumnDef::new(Downtimes::Version)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(Downtimes::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(Downtimes::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(Downtimes::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(Downtimes::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .foreign_key(
            ForeignKey::create()
                .name("downtimes_folder_fk")
                .from(Downtimes::Table, Downtimes::FolderId)
                .to(Folders::Table, Folders::Id),
        )
        .to_owned()
}

fn create_org_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(DOWNTIMES_ORG_IDX)
        .table(Downtimes::Table)
        .col(Downtimes::Org)
        .to_owned()
}

fn create_org_folder_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(DOWNTIMES_ORG_FOLDER_IDX)
        .table(Downtimes::Table)
        .col(Downtimes::Org)
        .col(Downtimes::FolderId)
        .to_owned()
}

fn create_org_ends_at_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(DOWNTIMES_ORG_ENDS_AT_IDX)
        .table(Downtimes::Table)
        .col(Downtimes::Org)
        .col(Downtimes::EndsAt)
        .to_owned()
}

#[derive(DeriveIden)]
enum Folders {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Downtimes {
    Table,
    Id,
    Org,
    FolderId,
    Name,
    Reason,
    Condition,
    Targets,
    ShowBanner,
    Repeat,
    StartsAt,
    EndsAt,
    Timezone,
    StartTimeLocal,
    DurationSecs,
    Weekdays,
    CancelledAt,
    CancelledBy,
    DeletedAt,
    Notifications,
    OriginRegion,
    Version,
    CreatedBy,
    CreatedAt,
    UpdatedBy,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;
    use sea_orm::{ConnectionTrait, Database, Statement};

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_downtimes_table().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "downtimes" (
                "id" varchar(27) NOT NULL PRIMARY KEY,
                "org" varchar(100) NOT NULL,
                "folder_id" char(27) NOT NULL,
                "name" varchar(256) NOT NULL,
                "reason" text,
                "condition" json,
                "targets" json NOT NULL,
                "show_banner" bool NOT NULL DEFAULT TRUE,
                "repeat" smallint NOT NULL,
                "starts_at" bigint NOT NULL,
                "ends_at" bigint,
                "timezone" varchar(64) NOT NULL,
                "start_time_local" varchar(5),
                "duration_secs" bigint NOT NULL,
                "weekdays" json,
                "cancelled_at" bigint,
                "cancelled_by" varchar(256),
                "deleted_at" bigint,
                "notifications" json NULL,
                "origin_region" varchar(64) NULL,
                "version" bigint NOT NULL DEFAULT 0,
                "created_by" varchar(256) NOT NULL,
                "created_at" bigint NOT NULL,
                "updated_by" varchar(256) NOT NULL,
                "updated_at" bigint NOT NULL,
                CONSTRAINT "downtimes_folder_fk" FOREIGN KEY ("folder_id") REFERENCES "folders" ("id")
            )"#
        );
    }

    #[test]
    fn the_indexes_cover_org_folder_and_retention() {
        assert_eq!(
            &create_org_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "downtimes_org_idx" ON "downtimes" ("org")"#
        );
        assert_eq!(
            &create_org_folder_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "downtimes_org_folder_idx" ON "downtimes" ("org", "folder_id")"#
        );
        assert_eq!(
            &create_org_ends_at_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "downtimes_org_ends_at_idx" ON "downtimes" ("org", "ends_at")"#
        );
    }

    #[tokio::test]
    async fn test_up_reruns_without_error_and_keeps_the_new_columns() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE folders (id char(27) PRIMARY KEY); INSERT INTO folders VALUES ('f1')",
        )
        .await
        .unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");

        for column in ["notifications", "origin_region", "version"] {
            assert!(manager.has_column("downtimes", column).await.unwrap());
        }
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "INSERT INTO downtimes (id, org, folder_id, name, targets, repeat, starts_at, \
             timezone, duration_secs, created_by, created_at, updated_by, updated_at) \
             VALUES ('d1', 'acme', 'f1', 'n', '[]', 0, 1, 'UTC', 60, 'lin', 1, 'lin', 1)"
                .to_owned(),
        ))
        .await
        .expect("a row is insertable without the new columns");
        let row = db
            .query_one(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                "SELECT version FROM downtimes WHERE id = 'd1'".to_owned(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i64>("", "version").unwrap(), 0);
    }

    #[tokio::test]
    async fn test_down_drops_the_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("downtimes").await.unwrap());
    }
}
