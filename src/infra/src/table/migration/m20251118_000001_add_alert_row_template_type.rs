// Copyright 2025 OpenObserve Inc.
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
        let db_backend = manager.get_database_backend();

        if matches!(db_backend, sea_orm::DbBackend::MySql) {
            // MySQL doesn't support IF NOT EXISTS in ALTER TABLE
            manager
                .alter_table(
                    Table::alter()
                        .table(Alerts::Table)
                        .add_column(
                            ColumnDef::new(Alerts::RowTemplateType)
                                .small_integer()
                                .not_null()
                                .default(0), // 0 = String, 1 = Json
                        )
                        .to_owned(),
                )
                .await
        } else {
            // PostgreSQL and SQLite support IF NOT EXISTS
            manager
                .alter_table(
                    Table::alter()
                        .table(Alerts::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(Alerts::RowTemplateType)
                                .small_integer()
                                .not_null()
                                .default(0), // 0 = String, 1 = Json
                        )
                        .to_owned(),
                )
                .await
        }
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .drop_column(Alerts::RowTemplateType)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    RowTemplateType,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &Table::alter()
                .table(Alerts::Table)
                .add_column_if_not_exists(
                    ColumnDef::new(Alerts::RowTemplateType)
                        .small_integer()
                        .not_null()
                        .default(0),
                )
                .to_owned()
                .to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "row_template_type" smallint NOT NULL DEFAULT 0"#
        );
    }

    #[test]
    fn mysql() {
        // MySQL doesn't support IF NOT EXISTS in ALTER TABLE
        collapsed_eq!(
            &Table::alter()
                .table(Alerts::Table)
                .add_column(
                    ColumnDef::new(Alerts::RowTemplateType)
                        .small_integer()
                        .not_null()
                        .default(0),
                )
                .to_owned()
                .to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `alerts` ADD COLUMN `row_template_type` smallint NOT NULL DEFAULT 0"#
        );
    }

    #[test]
    fn sqlite() {
        // Note: SQLite doesn't support IF NOT EXISTS in ALTER TABLE ADD COLUMN,
        // so add_column_if_not_exists generates the same SQL as add_column
        collapsed_eq!(
            &Table::alter()
                .table(Alerts::Table)
                .add_column_if_not_exists(
                    ColumnDef::new(Alerts::RowTemplateType)
                        .small_integer()
                        .not_null()
                        .default(0),
                )
                .to_owned()
                .to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN "row_template_type" smallint NOT NULL DEFAULT 0"#
        );
    }
}
