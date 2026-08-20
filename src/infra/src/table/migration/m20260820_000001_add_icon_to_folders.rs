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
                    .table(Folders::Table)
                    .add_column_if_not_exists(ColumnDef::new(Folders::Icon).string_len(64).null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Folders::Table)
                    .drop_column(Folders::Icon)
                    .to_owned(),
            )
            .await
    }
}

/// Nullable with no default: a folder that has never been given an icon is
/// distinct from one whose icon was deliberately cleared, and both read as NULL
/// rather than as an empty string.
///
/// 64 chars is well clear of the longest token the picker can produce today
/// (`o2:ai-microsoft-agent-framework`, 31) while leaving room for a multi
/// code-point emoji, which can run to ~28 bytes with skin-tone and ZWJ
/// sequences.
#[derive(DeriveIden)]
enum Folders {
    Table,
    Icon,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &Table::alter()
                .table(Folders::Table)
                .add_column_if_not_exists(ColumnDef::new(Folders::Icon).string_len(64).null())
                .to_owned()
                .to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "icon" varchar(64) NULL"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &Table::alter()
                .table(Folders::Table)
                .add_column_if_not_exists(ColumnDef::new(Folders::Icon).string_len(64).null())
                .to_owned()
                .to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `folders` ADD COLUMN `icon` varchar(64) NULL"#
        );
    }

    #[test]
    fn sqlite() {
        // SQLite has no IF NOT EXISTS on ALTER TABLE ADD COLUMN, so
        // add_column_if_not_exists emits the same SQL as add_column.
        collapsed_eq!(
            &Table::alter()
                .table(Folders::Table)
                .add_column_if_not_exists(ColumnDef::new(Folders::Icon).string_len(64).null())
                .to_owned()
                .to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "folders" ADD COLUMN "icon" varchar(64) NULL"#
        );
    }
}
