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

fn add_icon_statement() -> TableAlterStatement {
    Table::alter()
        .table(Folders::Table)
        .add_column_if_not_exists(ColumnDef::new(Folders::Icon).string_len(64).null())
        .to_owned()
}

fn drop_icon_statement() -> TableAlterStatement {
    Table::alter()
        .table(Folders::Table)
        .drop_column(Folders::Icon)
        .to_owned()
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.alter_table(add_icon_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.alter_table(drop_icon_statement()).await
    }
}

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
            &add_icon_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "icon" varchar(64) NULL"#
        );
    }

    #[test]
    fn sqlite() {
        // SQLite has no IF NOT EXISTS on ALTER TABLE ADD COLUMN, so
        // add_column_if_not_exists emits the same SQL as add_column.
        collapsed_eq!(
            &add_icon_statement().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "folders" ADD COLUMN "icon" varchar(64) NULL"#
        );
    }
}
