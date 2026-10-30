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

//! `alert_budget_per_day`: NULL means percentile mode, so existing configs are unchanged.

use sea_orm_migration::prelude::*;

const TABLE: &str = "anomaly_detection_config";
const COLUMN: &str = "alert_budget_per_day";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden, Clone)]
enum AnomalyConfig {
    #[sea_orm(iden = "anomaly_detection_config")]
    Table,
    AlertBudgetPerDay,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // A has_column guard: add_column_if_not_exists renders IF NOT EXISTS, which MySQL rejects.
        if manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(add_column_stmt()).await?;
        Ok(())
    }

    /// Losing it only returns every config to percentile mode, which is the pre-budget default.
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Symmetric with up(): a down on a schema that never got the column must not error.
        if !manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(drop_column_stmt()).await?;
        Ok(())
    }
}

/// Fractional budgets like 1/week (0.1428...) need a double, not an integer.
fn add_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(AnomalyConfig::Table)
        .add_column(
            ColumnDef::new(AnomalyConfig::AlertBudgetPerDay)
                .double()
                .null(),
        )
        .to_owned()
}

fn drop_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(AnomalyConfig::Table)
        .drop_column(AnomalyConfig::AlertBudgetPerDay)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &add_column_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "alert_budget_per_day" double precision NULL"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &add_column_stmt().to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `anomaly_detection_config` ADD COLUMN `alert_budget_per_day` double NULL"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_column_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "alert_budget_per_day" double NULL"#
        );
    }

    #[test]
    fn postgres_down() {
        collapsed_eq!(
            &drop_column_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "anomaly_detection_config" DROP COLUMN "alert_budget_per_day""#
        );
    }

    #[test]
    fn mysql_down() {
        collapsed_eq!(
            &drop_column_stmt().to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `anomaly_detection_config` DROP COLUMN `alert_budget_per_day`"#
        );
    }

    #[test]
    fn sqlite_down() {
        collapsed_eq!(
            &drop_column_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "anomaly_detection_config" DROP COLUMN "alert_budget_per_day""#
        );
    }

    /// up() and down() must name the same column, or a rollback silently drops the wrong one.
    #[test]
    fn up_and_down_agree_on_the_column() {
        let up = add_column_stmt().to_string(SqliteQueryBuilder);
        let down = drop_column_stmt().to_string(SqliteQueryBuilder);
        assert!(up.contains(COLUMN));
        assert!(down.contains(COLUMN));
        assert_eq!(down.matches("DROP COLUMN").count(), 1);
    }

    /// SQLite panics on an ALTER carrying more than one option, so this must stay a single ADD.
    #[test]
    fn adds_exactly_one_column() {
        let sql = add_column_stmt().to_string(SqliteQueryBuilder);
        assert_eq!(sql.matches("ADD COLUMN").count(), 1);
        assert_eq!(
            COLUMN,
            AnomalyConfig::AlertBudgetPerDay.into_iden().to_string()
        );
    }
}
