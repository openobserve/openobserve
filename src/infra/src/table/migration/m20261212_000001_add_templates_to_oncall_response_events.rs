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

//! `templates`: per destination, the template a delivery rendered with and where it came from.

use sea_orm_migration::prelude::*;

const TABLE: &str = "oncall_response_events";
const COLUMN: &str = "templates";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden, Clone)]
enum OncallResponseEvents {
    Table,
    Templates,
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

/// Nullable: rows written before this column, or by an old node, have no template record.
fn add_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(OncallResponseEvents::Table)
        .add_column(
            ColumnDef::new(OncallResponseEvents::Templates)
                .text()
                .null(),
        )
        .to_owned()
}

fn drop_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(OncallResponseEvents::Table)
        .drop_column(OncallResponseEvents::Templates)
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
            r#"ALTER TABLE "oncall_response_events" ADD COLUMN "templates" text NULL"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_column_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "oncall_response_events" ADD COLUMN "templates" text NULL"#
        );
    }
}
