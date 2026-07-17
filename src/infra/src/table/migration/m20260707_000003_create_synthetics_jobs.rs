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

const SYNTHETICS_JOBS_DEQUEUE_IDX: &str = "synthetics_jobs_dequeue_idx";
const SYNTHETICS_JOBS_MONITOR_IDX: &str = "synthetics_jobs_monitor_idx";
const SYNTHETICS_JOBS_STATUS_IDX: &str = "synthetics_jobs_status_idx";
const SYNTHETICS_JOBS_RUN_IDX: &str = "synthetics_jobs_run_idx";
const SYNTHETICS_JOBS_DEDUP_UQ: &str = "synthetics_jobs_dedup_uq";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_synthetics_jobs_table()).await?;
        manager.create_index(create_dequeue_idx()).await?;
        manager.create_index(create_monitor_idx()).await?;
        manager.create_index(create_status_idx()).await?;
        manager.create_index(create_run_idx()).await?;
        manager.create_index(create_dedup_uq()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for name in [
            SYNTHETICS_JOBS_DEDUP_UQ,
            SYNTHETICS_JOBS_RUN_IDX,
            SYNTHETICS_JOBS_STATUS_IDX,
            SYNTHETICS_JOBS_MONITOR_IDX,
            SYNTHETICS_JOBS_DEQUEUE_IDX,
        ] {
            manager
                .drop_index(
                    Index::drop()
                        .name(name)
                        .table(SyntheticsJobs::Table)
                        .to_owned(),
                )
                .await?;
        }
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
                .string_len(27)
                .not_null()
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
            ColumnDef::new(SyntheticsJobs::DispatchAttempts)
                .integer()
                .not_null()
                .default(0_i32),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::RunId)
                .string_len(27)
                .not_null()
                .default(""),
        )
        .col(ColumnDef::new(SyntheticsJobs::BrowserDevices).text().null())
        .col(
            ColumnDef::new(SyntheticsJobs::Metadata)
                .text()
                .not_null()
                .default("{}"),
        )
        .col(ColumnDef::new(SyntheticsJobs::Result).text().null())
        .col(
            ColumnDef::new(SyntheticsJobs::StartedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(SyntheticsJobs::CompletedAt)
                .big_integer()
                .null(),
        )
        .foreign_key(
            ForeignKey::create()
                .name("fk_synthetics_jobs_run_id")
                .from(SyntheticsJobs::Table, SyntheticsJobs::RunId)
                .to(SyntheticsRuns::Table, SyntheticsRuns::Id)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

fn create_dequeue_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_JOBS_DEQUEUE_IDX)
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
        .name(SYNTHETICS_JOBS_MONITOR_IDX)
        .table(SyntheticsJobs::Table)
        .col(SyntheticsJobs::SyntheticsId)
        .to_owned()
}

fn create_status_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_JOBS_STATUS_IDX)
        .table(SyntheticsJobs::Table)
        .col(SyntheticsJobs::OrgId)
        .col(SyntheticsJobs::SyntheticsId)
        .col(SyntheticsJobs::Status)
        .to_owned()
}

fn create_run_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_JOBS_RUN_IDX)
        .table(SyntheticsJobs::Table)
        .col(SyntheticsJobs::RunId)
        .to_owned()
}

fn create_dedup_uq() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_JOBS_DEDUP_UQ)
        .table(SyntheticsJobs::Table)
        .col(SyntheticsJobs::SyntheticsId)
        .col(SyntheticsJobs::Location)
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
    ScheduledTs,
    ValidUntil,
    Status,
    ClaimedBy,
    ClaimedAt,
    LeaseExpiresAt,
    DispatchAttempts,
    RunId,
    BrowserDevices,
    Metadata,
    Result,
    StartedAt,
    CompletedAt,
}

#[derive(DeriveIden)]
enum SyntheticsRuns {
    Table,
    Id,
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
                "id" varchar(27) NOT NULL PRIMARY KEY,
                "synthetics_id" varchar(256) NOT NULL,
                "synthetics_name" varchar(256) NOT NULL DEFAULT '',
                "org_id" varchar(100) NOT NULL,
                "location" varchar(256) NOT NULL,
                "pool" varchar(256) NOT NULL,
                "scheduled_ts" bigint NOT NULL,
                "valid_until" bigint NOT NULL,
                "status" integer NOT NULL DEFAULT 0,
                "claimed_by" varchar(256) NULL,
                "claimed_at" bigint NULL,
                "lease_expires_at" bigint NULL,
                "dispatch_attempts" integer NOT NULL DEFAULT 0,
                "run_id" varchar(27) NOT NULL DEFAULT '',
                "browser_devices" text NULL,
                "metadata" text NOT NULL DEFAULT '{}',
                "result" text NULL,
                "started_at" bigint NULL,
                "completed_at" bigint NULL,
                CONSTRAINT "fk_synthetics_jobs_run_id" FOREIGN KEY ("run_id") REFERENCES "synthetics_runs" ("id") ON DELETE CASCADE
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
            &create_status_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_jobs_status_idx" ON "synthetics_jobs" ("org_id", "synthetics_id", "status")"#
        );
        assert_eq!(
            &create_run_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_jobs_run_idx" ON "synthetics_jobs" ("run_id")"#
        );
        assert_eq!(
            &create_dedup_uq().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "synthetics_jobs_dedup_uq" ON "synthetics_jobs" ("synthetics_id", "location", "scheduled_ts")"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_synthetics_jobs_table().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_jobs" (
                "id" varchar(27) NOT NULL PRIMARY KEY,
                "synthetics_id" varchar(256) NOT NULL,
                "synthetics_name" varchar(256) NOT NULL DEFAULT '',
                "org_id" varchar(100) NOT NULL,
                "location" varchar(256) NOT NULL,
                "pool" varchar(256) NOT NULL,
                "scheduled_ts" bigint NOT NULL,
                "valid_until" bigint NOT NULL,
                "status" integer NOT NULL DEFAULT 0,
                "claimed_by" varchar(256) NULL,
                "claimed_at" bigint NULL,
                "lease_expires_at" bigint NULL,
                "dispatch_attempts" integer NOT NULL DEFAULT 0,
                "run_id" varchar(27) NOT NULL DEFAULT '',
                "browser_devices" text NULL,
                "metadata" text NOT NULL DEFAULT '{}',
                "result" text NULL,
                "started_at" bigint NULL,
                "completed_at" bigint NULL,
                FOREIGN KEY ("run_id") REFERENCES "synthetics_runs" ("id") ON DELETE CASCADE
            )"#
        );
    }
}
