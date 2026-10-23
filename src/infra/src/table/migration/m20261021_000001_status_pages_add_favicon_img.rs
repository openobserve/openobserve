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

//! `favicon_img`: a status page's browser-tab icon, kept apart from its header logo.

use sea_orm_migration::prelude::*;

const TABLE: &str = "status_pages";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum StatusPages {
    Table,
    FaviconImg,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // add_column_if_not_exists renders IF NOT EXISTS, which MySQL rejects.
        if manager.has_column(TABLE, "favicon_img").await? {
            return Ok(());
        }
        manager.alter_table(add_column_stmt()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(TABLE, "favicon_img").await? {
            return Ok(());
        }
        manager.alter_table(drop_column_stmt()).await
    }
}

fn add_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(StatusPages::Table)
        .add_column(ColumnDef::new(StatusPages::FaviconImg).text().null())
        .to_owned()
}

fn drop_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(StatusPages::Table)
        .drop_column(StatusPages::FaviconImg)
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
            r#"ALTER TABLE "status_pages" ADD COLUMN "favicon_img" text NULL"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &add_column_stmt().to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `status_pages` ADD COLUMN `favicon_img` text NULL"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_column_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "status_pages" ADD COLUMN "favicon_img" text NULL"#
        );
        collapsed_eq!(
            &drop_column_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "status_pages" DROP COLUMN "favicon_img""#
        );
    }
}
