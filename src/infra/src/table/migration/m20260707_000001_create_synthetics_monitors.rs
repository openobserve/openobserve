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

const SYNTHETICS_MONITORS_ORG_IDX: &str = "synthetics_org_idx";
const SYNTHETICS_MONITORS_ORG_FOLDER_IDX: &str = "synthetics_org_folder_idx";
const SYNTHETICS_MONITORS_SCHEDULE_IDX: &str = "synthetics_schedule_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_synthetics_table()).await?;
        manager.create_index(create_org_idx()).await?;
        manager.create_index(create_org_folder_idx()).await?;
        manager.create_index(create_schedule_idx()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_MONITORS_SCHEDULE_IDX)
                    .table(Synthetics::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_MONITORS_ORG_FOLDER_IDX)
                    .table(Synthetics::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_MONITORS_ORG_IDX)
                    .table(Synthetics::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(Synthetics::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_synthetics_table() -> TableCreateStatement {
    Table::create()
        .table(Synthetics::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(Synthetics::Id)
                .string_len(256)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(Synthetics::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(Synthetics::FolderId)
                .char_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(Synthetics::TzOffset)
                .integer()
                .not_null()
                .default(0i32),
        )
        .foreign_key(
            ForeignKey::create()
                .name("synthetics_folder_fk")
                .from(Synthetics::Table, Synthetics::FolderId)
                .to(Folders::Table, Folders::Id),
        )
        .col(
            ColumnDef::new(Synthetics::Name)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(Synthetics::SyntheticsType)
                .string_len(32)
                .not_null(),
        )
        .col(ColumnDef::new(Synthetics::Target).text().not_null())
        .col(ColumnDef::new(Synthetics::Description).text().not_null().default(""))
        // Tags: JSON array of strings — supports filter-by-tag queries.
        .col(ColumnDef::new(Synthetics::Tags).json().not_null())
        .col(ColumnDef::new(Synthetics::Config).json().not_null())
        // Frequency stored as JSON: { type, interval, cron }
        .col(ColumnDef::new(Synthetics::Frequency).json().not_null())
        .col(
            ColumnDef::new(Synthetics::Locations)
                .json()
                .not_null(),
        )
        .col(
            ColumnDef::new(Synthetics::Enabled)
                .boolean()
                .not_null()
                .default(SimpleExpr::Value(Value::Bool(Some(true)))),
        )
        .col(
            ColumnDef::new(Synthetics::Destinations)
                .json()
                .not_null(),
        )
        // Extra monitor settings: retries, cooldown, rum toggles, etc. (no secrets here).
        .col(ColumnDef::new(Synthetics::Settings).json().not_null())
        // Single secrets column — JSON blob with per-value AESenc:<base64> encryption using org DEK.
        // Shape: { "auth": {...}, "cookies": [...], "variables": [...] }
        // All three are optional; new secret types can be added without a migration.
        .col(ColumnDef::new(Synthetics::Secrets).text().not_null().default("{}"))
        // Scheduler fields — managed by the synthetics scheduler, not by the client.
        .col(
            ColumnDef::new(Synthetics::NextRunAt)
                .big_integer()
                .not_null()
                .default(0i64),
        )
        .col(
            ColumnDef::new(Synthetics::LastTriggeredAt)
                .big_integer()
                .not_null()
                .default(0i64),
        )
        .col(
            ColumnDef::new(Synthetics::LastCheckStatus)
                .integer()
                .not_null()
                .default(0i32),
        )
        .col(
            ColumnDef::new(Synthetics::Owner)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(Synthetics::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(Synthetics::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_org_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_MONITORS_ORG_IDX)
        .table(Synthetics::Table)
        .col(Synthetics::OrgId)
        .to_owned()
}

fn create_org_folder_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_MONITORS_ORG_FOLDER_IDX)
        .table(Synthetics::Table)
        .col(Synthetics::OrgId)
        .col(Synthetics::FolderId)
        .to_owned()
}

/// Composite index for the scheduler's hot path: WHERE enabled = true AND next_run_at <= now
fn create_schedule_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_MONITORS_SCHEDULE_IDX)
        .table(Synthetics::Table)
        .col(Synthetics::Enabled)
        .col(Synthetics::NextRunAt)
        .to_owned()
}

#[derive(DeriveIden)]
enum Folders {
    Table,
    Id,
}

// SyntheticsType must keep its name — DeriveIden derives the column name
// "synthetics_type" from the variant.
#[allow(clippy::enum_variant_names)]
#[derive(DeriveIden)]
enum Synthetics {
    Table,
    Id,
    OrgId,
    FolderId,
    TzOffset,
    Name,
    SyntheticsType,
    Target,
    Description,
    Tags,
    Config,
    Frequency,
    Locations,
    Enabled,
    Destinations,
    Settings,
    Secrets,
    NextRunAt,
    LastTriggeredAt,
    LastCheckStatus,
    Owner,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_synthetics_table().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics" (
                "id" varchar(256) NOT NULL PRIMARY KEY,
                "org_id" varchar(100) NOT NULL,
                "folder_id" char(27) NOT NULL,
                "tz_offset" integer NOT NULL DEFAULT 0,
                "name" varchar(256) NOT NULL,
                "synthetics_type" varchar(32) NOT NULL,
                "target" text NOT NULL,
                "description" text NOT NULL DEFAULT '',
                "tags" json NOT NULL,
                "config" json NOT NULL,
                "frequency" json NOT NULL,
                "locations" json NOT NULL,
                "enabled" bool NOT NULL DEFAULT TRUE,
                "destinations" json NOT NULL,
                "settings" json NOT NULL,
                "secrets" text NOT NULL DEFAULT '{}',
                "next_run_at" bigint NOT NULL DEFAULT 0,
                "last_triggered_at" bigint NOT NULL DEFAULT 0,
                "last_check_status" integer NOT NULL DEFAULT 0,
                "owner" varchar(256) NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                CONSTRAINT "synthetics_folder_fk" FOREIGN KEY ("folder_id") REFERENCES "folders" ("id")
            )"#
        );
        assert_eq!(
            &create_org_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_org_idx" ON "synthetics" ("org_id")"#
        );
        assert_eq!(
            &create_org_folder_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_org_folder_idx" ON "synthetics" ("org_id", "folder_id")"#
        );
        assert_eq!(
            &create_schedule_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_schedule_idx" ON "synthetics" ("enabled", "next_run_at")"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_synthetics_table().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics" (
                "id" varchar(256) NOT NULL PRIMARY KEY,
                "org_id" varchar(100) NOT NULL,
                "folder_id" char(27) NOT NULL,
                "tz_offset" integer NOT NULL DEFAULT 0,
                "name" varchar(256) NOT NULL,
                "synthetics_type" varchar(32) NOT NULL,
                "target" text NOT NULL,
                "description" text NOT NULL DEFAULT '',
                "tags" json_text NOT NULL,
                "config" json_text NOT NULL,
                "frequency" json_text NOT NULL,
                "locations" json_text NOT NULL,
                "enabled" boolean NOT NULL DEFAULT TRUE,
                "destinations" json_text NOT NULL,
                "settings" json_text NOT NULL,
                "secrets" text NOT NULL DEFAULT '{}',
                "next_run_at" bigint NOT NULL DEFAULT 0,
                "last_triggered_at" bigint NOT NULL DEFAULT 0,
                "last_check_status" integer NOT NULL DEFAULT 0,
                "owner" varchar(256) NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                FOREIGN KEY ("folder_id") REFERENCES "folders" ("id")
            )"#
        );
    }
}
