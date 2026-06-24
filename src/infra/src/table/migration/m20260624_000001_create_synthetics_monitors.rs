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

const SYNTHETICS_MONITORS_ORG_IDX: &str = "synthetics_monitors_org_idx";
const SYNTHETICS_MONITORS_ORG_FOLDER_IDX: &str = "synthetics_monitors_org_folder_idx";
const SYNTHETICS_MONITORS_SCHEDULE_IDX: &str = "synthetics_monitors_schedule_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_synthetics_monitors_table())
            .await?;
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
                    .table(SyntheticsMonitors::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_MONITORS_ORG_FOLDER_IDX)
                    .table(SyntheticsMonitors::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_MONITORS_ORG_IDX)
                    .table(SyntheticsMonitors::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(SyntheticsMonitors::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_synthetics_monitors_table() -> TableCreateStatement {
    Table::create()
        .table(SyntheticsMonitors::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SyntheticsMonitors::Id)
                .string_len(256)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(SyntheticsMonitors::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsMonitors::FolderId)
                .string_len(256)
                .not_null()
                .default("default"),
        )
        .col(
            ColumnDef::new(SyntheticsMonitors::Name)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsMonitors::MonitorType)
                .string_len(32)
                .not_null(),
        )
        .col(ColumnDef::new(SyntheticsMonitors::Target).text().not_null())
        .col(ColumnDef::new(SyntheticsMonitors::Config).json().not_null())
        .col(
            ColumnDef::new(SyntheticsMonitors::IntervalSecs)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsMonitors::Locations)
                .json()
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsMonitors::Enabled)
                .boolean()
                .not_null()
                .default(SimpleExpr::Value(Value::Bool(Some(true)))),
        )
        .col(
            ColumnDef::new(SyntheticsMonitors::NextRunAt)
                .big_integer()
                .not_null()
                .default(0_i64),
        )
        .col(
            ColumnDef::new(SyntheticsMonitors::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsMonitors::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_org_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_MONITORS_ORG_IDX)
        .table(SyntheticsMonitors::Table)
        .col(SyntheticsMonitors::OrgId)
        .to_owned()
}

fn create_org_folder_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_MONITORS_ORG_FOLDER_IDX)
        .table(SyntheticsMonitors::Table)
        .col(SyntheticsMonitors::OrgId)
        .col(SyntheticsMonitors::FolderId)
        .to_owned()
}

fn create_schedule_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_MONITORS_SCHEDULE_IDX)
        .table(SyntheticsMonitors::Table)
        .col(SyntheticsMonitors::Enabled)
        .col(SyntheticsMonitors::NextRunAt)
        .to_owned()
}

#[derive(DeriveIden)]
enum SyntheticsMonitors {
    Table,
    Id,
    OrgId,
    FolderId,
    Name,
    MonitorType,
    Target,
    Config,
    IntervalSecs,
    Locations,
    Enabled,
    NextRunAt,
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
            &create_synthetics_monitors_table().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_monitors" (
                "id" varchar(256) NOT NULL PRIMARY KEY,
                "org_id" varchar(100) NOT NULL,
                "folder_id" varchar(256) NOT NULL DEFAULT 'default',
                "name" varchar(256) NOT NULL,
                "monitor_type" varchar(32) NOT NULL,
                "target" text NOT NULL,
                "config" json NOT NULL,
                "interval_secs" integer NOT NULL,
                "locations" json NOT NULL,
                "enabled" bool NOT NULL DEFAULT TRUE,
                "next_run_at" bigint NOT NULL DEFAULT 0,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL
            )"#
        );
        assert_eq!(
            &create_org_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_monitors_org_idx" ON "synthetics_monitors" ("org_id")"#
        );
        assert_eq!(
            &create_org_folder_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_monitors_org_folder_idx" ON "synthetics_monitors" ("org_id", "folder_id")"#
        );
        assert_eq!(
            &create_schedule_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_monitors_schedule_idx" ON "synthetics_monitors" ("enabled", "next_run_at")"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_synthetics_monitors_table().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_monitors" (
                "id" varchar(256) NOT NULL PRIMARY KEY,
                "org_id" varchar(100) NOT NULL,
                "folder_id" varchar(256) NOT NULL DEFAULT 'default',
                "name" varchar(256) NOT NULL,
                "monitor_type" varchar(32) NOT NULL,
                "target" text NOT NULL,
                "config" json_text NOT NULL,
                "interval_secs" integer NOT NULL,
                "locations" json_text NOT NULL,
                "enabled" boolean NOT NULL DEFAULT TRUE,
                "next_run_at" bigint NOT NULL DEFAULT 0,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL
            )"#
        );
    }
}
