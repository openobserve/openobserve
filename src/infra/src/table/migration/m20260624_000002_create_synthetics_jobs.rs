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

const SYNTHETICS_PENDING_CHECKS_DEQUEUE_IDX: &str = "synthetics_jobs_dequeue_idx";
const SYNTHETICS_PENDING_CHECKS_MONITOR_IDX: &str = "synthetics_jobs_monitor_idx";
const SYNTHETICS_PENDING_CHECKS_DEDUP_UQ: &str = "synthetics_jobs_dedup_uq";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_synthetics_jobs_table()).await?;
        manager.create_index(create_dequeue_idx()).await?;
        manager.create_index(create_monitor_idx()).await?;
        manager.create_index(create_dedup_uq()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_PENDING_CHECKS_DEDUP_UQ)
                    .table(SyntheticsJobs::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_PENDING_CHECKS_MONITOR_IDX)
                    .table(SyntheticsJobs::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_PENDING_CHECKS_DEQUEUE_IDX)
                    .table(SyntheticsJobs::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(SyntheticsJobs::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_synthetics_jobs_table() -> TableCreateStatement {
    Table::create()
        .table(SyntheticsJobs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SyntheticsJobs::Id)
                .big_integer()
                .not_null()
                .auto_increment()
                .primary_key(),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::SyntheticsId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::SyntheticsName)
                .string_len(256)
                .not_null()
                .default(""),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::Location)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::Pool)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::BrowserEngine)
                .string_len(64)
                .null(),
        )
        .col(ColumnDef::new(SyntheticsJobs::Device).string_len(64).null())
        .col(
            ColumnDef::new(SyntheticsJobs::ScheduledTs)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::ValidUntil)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::Status)
                .integer()
                .not_null()
                .default(0_i32),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::ClaimedBy)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::ClaimedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::LeaseExpiresAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::Attempts)
                .integer()
                .not_null()
                .default(0_i32),
        )
        .to_owned()
}

fn create_dequeue_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_PENDING_CHECKS_DEQUEUE_IDX)
        .table(SyntheticsJobs::Table)
        .col(SyntheticsJobs::Pool)
        .col(SyntheticsJobs::Status)
        .col(SyntheticsJobs::ValidUntil)
        .col(SyntheticsJobs::ScheduledTs)
        .to_owned()
}

fn create_monitor_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_PENDING_CHECKS_MONITOR_IDX)
        .table(SyntheticsJobs::Table)
        .col(SyntheticsJobs::SyntheticsId)
        .to_owned()
}

fn create_dedup_uq() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_PENDING_CHECKS_DEDUP_UQ)
        .table(SyntheticsJobs::Table)
        .col(SyntheticsJobs::SyntheticsId)
        .col(SyntheticsJobs::Location)
        .col(SyntheticsJobs::Pool)
        .col(SyntheticsJobs::Device)
        .col(SyntheticsJobs::ScheduledTs)
        .unique()
        .to_owned()
}

#[derive(DeriveIden)]
enum SyntheticsJobs {
    Table,
    Id,
    SyntheticsId,
    SyntheticsName,
    OrgId,
    Location,
    Pool,
    BrowserEngine,
    Device,
    ScheduledTs,
    ValidUntil,
    Status,
    ClaimedBy,
    ClaimedAt,
    LeaseExpiresAt,
    Attempts,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_synthetics_jobs_table().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_jobs" (
                "id" bigint NOT NULL PRIMARY KEY AUTO_INCREMENT,
                "synthetics_id" varchar(256) NOT NULL,
                "synthetics_name" varchar(256) NOT NULL DEFAULT '',
                "org_id" varchar(100) NOT NULL,
                "location" varchar(256) NOT NULL,
                "pool" varchar(256) NOT NULL,
                "browser_engine" varchar(64),
                "scheduled_ts" bigint NOT NULL,
                "valid_until" bigint NOT NULL,
                "status" integer NOT NULL DEFAULT 0,
                "claimed_by" varchar(256),
                "claimed_at" bigint,
                "lease_expires_at" bigint,
                "attempts" integer NOT NULL DEFAULT 0
            )"#
        );
        assert_eq!(
            &create_dequeue_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_jobs_dequeue_idx" ON "synthetics_jobs" ("pool", "status", "valid_until", "scheduled_ts")"#
        );
        assert_eq!(
            &create_monitor_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_jobs_monitor_idx" ON "synthetics_jobs" ("synthetics_id")"#
        );
        assert_eq!(
            &create_dedup_uq().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "synthetics_jobs_dedup_uq" ON "synthetics_jobs" ("synthetics_id", "location", "pool", "device", "scheduled_ts")"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_synthetics_jobs_table().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_jobs" (
                "id" bigint NOT NULL PRIMARY KEY AUTOINCREMENT,
                "synthetics_id" varchar(256) NOT NULL,
                "synthetics_name" varchar(256) NOT NULL DEFAULT '',
                "org_id" varchar(100) NOT NULL,
                "location" varchar(256) NOT NULL,
                "pool" varchar(256) NOT NULL,
                "browser_engine" varchar(64),
                "scheduled_ts" bigint NOT NULL,
                "valid_until" bigint NOT NULL,
                "status" integer NOT NULL DEFAULT 0,
                "claimed_by" varchar(256),
                "claimed_at" bigint,
                "lease_expires_at" bigint,
                "attempts" integer NOT NULL DEFAULT 0
            )"#
        );
    }
}
