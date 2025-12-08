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

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db_backend = manager.get_database_backend();
        let text_type = get_text_type();

        if matches!(db_backend, sea_orm::DbBackend::MySql) {
            // MySQL doesn't support IF NOT EXISTS in ALTER TABLE
            manager
                .alter_table(
                    Table::alter()
                        .table(Alerts::Table)
                        .add_column(
                            ColumnDef::new(Alerts::FooterTemplate)
                                .custom(Alias::new(&text_type))
                                .not_null()
                                .default(""),
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
                            ColumnDef::new(Alerts::FooterTemplate)
                                .text()
                                .not_null()
                                .default(""),
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
                    .drop_column(Alerts::FooterTemplate)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    FooterTemplate,
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
                    ColumnDef::new(Alerts::FooterTemplate)
                        .text()
                        .not_null()
                        .default(""),
                )
                .to_owned()
                .to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "footer_template" text NOT NULL DEFAULT ''"#
        );
    }

    #[test]
    fn mysql() {
        // Note: This test uses text type, but actual migration uses get_text_type()
        collapsed_eq!(
            &Table::alter()
                .table(Alerts::Table)
                .add_column(
                    ColumnDef::new(Alerts::FooterTemplate)
                        .text()
                        .not_null()
                        .default(""),
                )
                .to_owned()
                .to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `alerts` ADD COLUMN `footer_template` text NOT NULL DEFAULT ''"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &Table::alter()
                .table(Alerts::Table)
                .add_column_if_not_exists(
                    ColumnDef::new(Alerts::FooterTemplate)
                        .text()
                        .not_null()
                        .default(""),
                )
                .to_owned()
                .to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN "footer_template" text NOT NULL DEFAULT ''"#
        );
    }
}
