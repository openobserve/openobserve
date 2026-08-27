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

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.alter_table(get_update_stmt_alerts()).await?;
        manager.alter_table(get_update_stmt_composites()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .drop_column(Alerts::PendingPeriodSec)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(AlertComposites::Table)
                    .drop_column(AlertComposites::PendingPeriodSec)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

fn get_update_stmt_alerts() -> TableAlterStatement {
    Table::alter()
        .table(Alerts::Table)
        .add_column_if_not_exists(
            ColumnDef::new(Alerts::PendingPeriodSec)
                .integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

fn get_update_stmt_composites() -> TableAlterStatement {
    Table::alter()
        .table(AlertComposites::Table)
        .add_column_if_not_exists(
            ColumnDef::new(AlertComposites::PendingPeriodSec)
                .integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    PendingPeriodSec,
}

#[derive(DeriveIden)]
enum AlertComposites {
    Table,
    PendingPeriodSec,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &get_update_stmt_alerts().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "pending_period_sec" integer NOT NULL DEFAULT 0"#
        );
        collapsed_eq!(
            &get_update_stmt_composites().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alert_composites" ADD COLUMN IF NOT EXISTS "pending_period_sec" integer NOT NULL DEFAULT 0"#
        );
    }

    #[test]
    fn sqlite() {
        // Note: SQLite doesn't support IF NOT EXISTS in ALTER TABLE ADD COLUMN,
        // so add_column_if_not_exists generates the same SQL as add_column
        collapsed_eq!(
            &get_update_stmt_alerts().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN "pending_period_sec" integer NOT NULL DEFAULT 0"#
        );
        collapsed_eq!(
            &get_update_stmt_composites().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "alert_composites" ADD COLUMN "pending_period_sec" integer NOT NULL DEFAULT 0"#
        );
    }
}
