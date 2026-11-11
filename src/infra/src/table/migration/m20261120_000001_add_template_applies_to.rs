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

//! `applies_to`: the kinds a template is meant for, as JSON array text; `[]` is every kind.

use sea_orm_migration::prelude::*;

const TABLE: &str = "templates";
const COLUMN: &str = "applies_to";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden, Clone)]
enum Templates {
    Table,
    AppliesTo,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(add_column_stmt()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(drop_column_stmt()).await?;
        Ok(())
    }
}

/// Not null with a default, so an old node's insert that omits the column stores every kind.
fn add_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(Templates::Table)
        .add_column(
            ColumnDef::new(Templates::AppliesTo)
                .text()
                .not_null()
                .default("[]"),
        )
        .to_owned()
}

fn drop_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(Templates::Table)
        .drop_column(Templates::AppliesTo)
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
            r#"ALTER TABLE "templates" ADD COLUMN "applies_to" text NOT NULL DEFAULT '[]'"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_column_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "templates" ADD COLUMN "applies_to" text NOT NULL DEFAULT '[]'"#
        );
    }

    #[test]
    fn down_drops_the_same_column() {
        collapsed_eq!(
            &drop_column_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "templates" DROP COLUMN "applies_to""#
        );
        assert_eq!(COLUMN, Templates::AppliesTo.into_iden().to_string());
    }
}
