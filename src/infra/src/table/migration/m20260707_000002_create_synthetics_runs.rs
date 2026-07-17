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

const SYNTHETICS_RUNS_MONITOR_IDX: &str = "synthetics_runs_monitor_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_synthetics_runs_table()).await?;
        manager.create_index(create_monitor_idx()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_RUNS_MONITOR_IDX)
                    .table(SyntheticsRuns::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(SyntheticsRuns::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_synthetics_runs_table() -> TableCreateStatement {
    Table::create()
        .table(SyntheticsRuns::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SyntheticsRuns::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(SyntheticsRuns::SyntheticsId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsRuns::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsRuns::ScheduledTs)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsRuns::TriggerType)
                .string_len(64)
                .not_null()
                .default("schedule"),
        )
        .col(
            ColumnDef::new(SyntheticsRuns::JobCount)
                .integer()
                .not_null()
                .default(0_i32),
        )
        .col(
            ColumnDef::new(SyntheticsRuns::JobsDone)
                .integer()
                .not_null()
                .default(0_i32),
        )
        .col(ColumnDef::new(SyntheticsRuns::RunResult).integer().null())
        .col(
            ColumnDef::new(SyntheticsRuns::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsRuns::CompletedAt)
                .big_integer()
                .null(),
        )
        .foreign_key(
            ForeignKey::create()
                .name("fk_synthetics_runs_synthetics_id")
                .from(SyntheticsRuns::Table, SyntheticsRuns::SyntheticsId)
                .to(Synthetics::Table, Synthetics::Id)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

fn create_monitor_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYNTHETICS_RUNS_MONITOR_IDX)
        .table(SyntheticsRuns::Table)
        .col(SyntheticsRuns::OrgId)
        .col(SyntheticsRuns::SyntheticsId)
        .col(SyntheticsRuns::ScheduledTs)
        .to_owned()
}

#[derive(DeriveIden)]
enum SyntheticsRuns {
    Table,
    Id,
    SyntheticsId,
    OrgId,
    ScheduledTs,
    TriggerType,
    JobCount,
    JobsDone,
    RunResult,
    CreatedAt,
    CompletedAt,
}

#[derive(DeriveIden)]
enum Synthetics {
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
            &create_synthetics_runs_table().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_runs" (
                "id" varchar(27) NOT NULL PRIMARY KEY,
                "synthetics_id" varchar(256) NOT NULL,
                "org_id" varchar(100) NOT NULL,
                "scheduled_ts" bigint NOT NULL,
                "trigger_type" varchar(64) NOT NULL DEFAULT 'schedule',
                "job_count" integer NOT NULL DEFAULT 0,
                "jobs_done" integer NOT NULL DEFAULT 0,
                "run_result" integer NULL,
                "created_at" bigint NOT NULL,
                "completed_at" bigint NULL,
                CONSTRAINT "fk_synthetics_runs_synthetics_id" FOREIGN KEY ("synthetics_id") REFERENCES "synthetics" ("id") ON DELETE CASCADE
            )"#
        );
        assert_eq!(
            &create_monitor_idx().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_runs_monitor_idx" ON "synthetics_runs" ("org_id", "synthetics_id", "scheduled_ts")"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_synthetics_runs_table().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_runs" (
                "id" varchar(27) NOT NULL PRIMARY KEY,
                "synthetics_id" varchar(256) NOT NULL,
                "org_id" varchar(100) NOT NULL,
                "scheduled_ts" bigint NOT NULL,
                "trigger_type" varchar(64) NOT NULL DEFAULT 'schedule',
                "job_count" integer NOT NULL DEFAULT 0,
                "jobs_done" integer NOT NULL DEFAULT 0,
                "run_result" integer NULL,
                "created_at" bigint NOT NULL,
                "completed_at" bigint NULL,
                FOREIGN KEY ("synthetics_id") REFERENCES "synthetics" ("id") ON DELETE CASCADE
            )"#
        );
    }
}
