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
        manager
            .alter_table(
                Table::alter()
                    .table(Templates::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(Templates::Kind)
                            .string_len(16)
                            .not_null()
                            .default("custom"),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Templates::Table)
                    .drop_column(Templates::Kind)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Templates {
    Table,
    Kind,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &Table::alter()
                .table(Templates::Table)
                .add_column_if_not_exists(
                    ColumnDef::new(Templates::Kind)
                        .string_len(16)
                        .not_null()
                        .default("custom"),
                )
                .to_owned()
                .to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "kind" varchar(16) NOT NULL DEFAULT 'custom'"#
        );
    }

    #[test]
    fn sqlite() {
        // Note: SQLite doesn't support IF NOT EXISTS in ALTER TABLE ADD COLUMN,
        // so add_column_if_not_exists generates the same SQL as add_column
        collapsed_eq!(
            &Table::alter()
                .table(Templates::Table)
                .add_column_if_not_exists(
                    ColumnDef::new(Templates::Kind)
                        .string_len(16)
                        .not_null()
                        .default("custom"),
                )
                .to_owned()
                .to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "templates" ADD COLUMN "kind" varchar(16) NOT NULL DEFAULT 'custom'"#
        );
    }
}
