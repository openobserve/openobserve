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

//! `template` on synthetics: the check's template override.

use sea_orm_migration::prelude::*;

const TABLE: &str = "synthetics";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden, Clone)]
enum Synthetics {
    Table,
    Template,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // The table is created from the entity on a fresh database, so the column is guarded.
        if !manager.has_column(TABLE, "template").await? {
            manager.alter_table(add_template_stmt()).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(TABLE, "template").await? {
            manager.alter_table(drop_template_stmt()).await?;
        }
        Ok(())
    }
}

fn add_template_stmt() -> TableAlterStatement {
    Table::alter()
        .table(Synthetics::Table)
        .add_column(ColumnDef::new(Synthetics::Template).string_len(256).null())
        .to_owned()
}

fn drop_template_stmt() -> TableAlterStatement {
    Table::alter()
        .table(Synthetics::Table)
        .drop_column(Synthetics::Template)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &add_template_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "synthetics" ADD COLUMN "template" varchar(256) NULL"#
        );
        collapsed_eq!(
            &drop_template_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "synthetics" DROP COLUMN "template""#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_template_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "synthetics" ADD COLUMN "template" varchar(256) NULL"#
        );
    }
}
