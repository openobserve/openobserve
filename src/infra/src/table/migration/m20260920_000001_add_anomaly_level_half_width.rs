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

//! `level_half_width_seconds`: NULL means the shipped one-day default, so existing configs
//! keep the level bandwidth they were fitted with.

use sea_orm_migration::prelude::*;

const TABLE: &str = "anomaly_detection_config";
const COLUMN: &str = "level_half_width_seconds";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden, Clone)]
enum AnomalyConfig {
    #[sea_orm(iden = "anomaly_detection_config")]
    Table,
    LevelHalfWidthSeconds,
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

    /// Losing it only returns every config to the default half-width, which is the value they
    /// all carry today.
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Symmetric with up(): a down on a schema that never got the column must not error.
        if !manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(drop_column_stmt()).await?;
        Ok(())
    }
}

/// Seconds, not microseconds: a half-width is a human-scale span an operator types, and
/// `big_integer` still spans centuries at that resolution.
fn add_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(AnomalyConfig::Table)
        .add_column(
            ColumnDef::new(AnomalyConfig::LevelHalfWidthSeconds)
                .big_integer()
                .null(),
        )
        .to_owned()
}

fn drop_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(AnomalyConfig::Table)
        .drop_column(AnomalyConfig::LevelHalfWidthSeconds)
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
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "level_half_width_seconds" bigint NULL"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &add_column_stmt().to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `anomaly_detection_config` ADD COLUMN `level_half_width_seconds` bigint NULL"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_column_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "level_half_width_seconds" bigint NULL"#
        );
    }

    #[test]
    fn postgres_down() {
        collapsed_eq!(
            &drop_column_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "anomaly_detection_config" DROP COLUMN "level_half_width_seconds""#
        );
    }

    #[test]
    fn mysql_down() {
        collapsed_eq!(
            &drop_column_stmt().to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `anomaly_detection_config` DROP COLUMN `level_half_width_seconds`"#
        );
    }

    #[test]
    fn sqlite_down() {
        collapsed_eq!(
            &drop_column_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "anomaly_detection_config" DROP COLUMN "level_half_width_seconds""#
        );
    }
}
