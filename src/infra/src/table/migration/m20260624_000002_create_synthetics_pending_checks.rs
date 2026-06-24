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

const SYNTHETICS_PENDING_CHECKS_DEQUEUE_IDX: &str = "synthetics_pending_checks_dequeue_idx";
const SYNTHETICS_PENDING_CHECKS_MONITOR_IDX: &str = "synthetics_pending_checks_monitor_idx";
const SYNTHETICS_PENDING_CHECKS_DEDUP_UQ: &str = "synthetics_pending_checks_dedup_uq";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_synthetics_pending_checks_table())
            .await?;
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
                    .table(SyntheticsPendingChecks::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_PENDING_CHECKS_MONITOR_IDX)
                    .table(SyntheticsPendingChecks::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_PENDING_CHECKS_DEQUEUE_IDX)
                    .table(SyntheticsPendingChecks::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(SyntheticsPendingChecks::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

fn create_synthetics_pending_checks_table() -> TableCreateStatement {
    Table::create()
        .table(SyntheticsPendingChecks::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SyntheticsPendingChecks::Id)
                .big_integer()
                .not_null()
                .auto_increment()
                .primary_key(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::MonitorId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::Location)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::Pool)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::BrowserEngine)
                .string_len(64)
                .null(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::Device)
                .string_len(64)
                .null(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::ScheduledTs)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::ValidUntil)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::Status)
                .integer()
                .not_null()
                .default(0_i32),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::ClaimedBy)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::ClaimedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::LeaseExpiresAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(SyntheticsPendingChecks::Attempts)
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
        .table(SyntheticsPendingChecks::Table)
        .col(SyntheticsPendingChecks::Pool)
        .col(SyntheticsPendingChecks::Status)
        .col(SyntheticsPendingChecks::ValidUntil)
        .col(SyntheticsPendingChecks::ScheduledTs)
        .to_owned()
}

fn create_monitor_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_PENDING_CHECKS_MONITOR_IDX)
        .table(SyntheticsPendingChecks::Table)
        .col(SyntheticsPendingChecks::MonitorId)
        .to_owned()
}

fn create_dedup_uq() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_PENDING_CHECKS_DEDUP_UQ)
        .table(SyntheticsPendingChecks::Table)
        .col(SyntheticsPendingChecks::MonitorId)
        .col(SyntheticsPendingChecks::Pool)
        .col(SyntheticsPendingChecks::Device)
        .col(SyntheticsPendingChecks::ScheduledTs)
        .unique()
        .to_owned()
}

#[derive(DeriveIden)]
enum SyntheticsPendingChecks {
    Table,
    Id,
    MonitorId,
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
            &create_synthetics_pending_checks_table().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_pending_checks" (
                "id" bigint NOT NULL PRIMARY KEY AUTO_INCREMENT,
                "monitor_id" varchar(256) NOT NULL,
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
            r#"CREATE INDEX IF NOT EXISTS "synthetics_pending_checks_dequeue_idx" ON "synthetics_pending_checks" ("pool", "status", "valid_until", "scheduled_ts")"#
        );
        assert_eq!(
            &create_monitor_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_pending_checks_monitor_idx" ON "synthetics_pending_checks" ("monitor_id")"#
        );
        assert_eq!(
            &create_dedup_uq().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "synthetics_pending_checks_dedup_uq" ON "synthetics_pending_checks" ("monitor_id", "pool", "scheduled_ts")"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_synthetics_pending_checks_table().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_pending_checks" (
                "id" bigint NOT NULL PRIMARY KEY AUTOINCREMENT,
                "monitor_id" varchar(256) NOT NULL,
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
