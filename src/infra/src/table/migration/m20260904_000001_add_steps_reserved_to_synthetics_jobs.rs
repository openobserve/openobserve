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

/// New rows carry what the enqueue actually took: 0 whenever gate 3's deduct was
/// refused, and the ack reads that as billable overage. Legacy rows are
/// backfilled from `steps_configured` instead, so the handful of jobs in flight
/// across the deploy stay free — the grant already paid for them, and billing
/// them would charge a customer twice for the same steps.
const NOT_RESERVED: i32 = 0;

#[derive(DeriveMigrationName)]
pub struct Migration;

fn add_steps_reserved_statement() -> TableAlterStatement {
    Table::alter()
        .table(SyntheticsJobs::Table)
        .add_column_if_not_exists(
            ColumnDef::new(SyntheticsJobs::StepsReserved)
                .integer()
                .not_null()
                .default(NOT_RESERVED),
        )
        .to_owned()
}

fn backfill_statement() -> UpdateStatement {
    Query::update()
        .table(SyntheticsJobs::Table)
        .value(
            SyntheticsJobs::StepsReserved,
            Expr::col(SyntheticsJobs::StepsConfigured),
        )
        .and_where(Expr::col(SyntheticsJobs::StepsReserved).eq(NOT_RESERVED))
        .to_owned()
}

fn drop_steps_reserved_statement() -> TableAlterStatement {
    Table::alter()
        .table(SyntheticsJobs::Table)
        .drop_column(SyntheticsJobs::StepsReserved)
        .to_owned()
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.alter_table(add_steps_reserved_statement()).await?;
        manager.exec_stmt(backfill_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.alter_table(drop_steps_reserved_statement()).await
    }
}

#[derive(DeriveIden)]
enum SyntheticsJobs {
    Table,
    StepsConfigured,
    StepsReserved,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &add_steps_reserved_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "synthetics_jobs" ADD COLUMN IF NOT EXISTS "steps_reserved" integer NOT NULL DEFAULT 0"#
        );
        collapsed_eq!(
            &backfill_statement().to_string(PostgresQueryBuilder),
            r#"UPDATE "synthetics_jobs" SET "steps_reserved" = "steps_configured" WHERE "steps_reserved" = 0"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &add_steps_reserved_statement().to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `synthetics_jobs` ADD COLUMN IF NOT EXISTS `steps_reserved` int NOT NULL DEFAULT 0"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_steps_reserved_statement().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "synthetics_jobs" ADD COLUMN "steps_reserved" integer NOT NULL DEFAULT 0"#
        );
    }
}
