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

//! Creates `ai_toolset_health`, the last call outcome per org × toolset.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AiToolsetHealth::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AiToolsetHealth {
    Table,
    Org,
    Toolset,
    LastOkAt,
    LastErrorAt,
    FailingSince,
    LastError,
}

fn create_table_statement() -> TableCreateStatement {
    Table::create()
        .table(AiToolsetHealth::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiToolsetHealth::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiToolsetHealth::Toolset)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiToolsetHealth::LastOkAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AiToolsetHealth::LastErrorAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AiToolsetHealth::FailingSince)
                .big_integer()
                .null(),
        )
        .col(ColumnDef::new(AiToolsetHealth::LastError).text().null())
        .primary_key(
            Index::create()
                .col(AiToolsetHealth::Org)
                .col(AiToolsetHealth::Toolset),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_the_health_table_once() {
        let sql = create_table_statement().to_string(PostgresQueryBuilder);
        assert!(
            sql.starts_with(r#"CREATE TABLE IF NOT EXISTS "ai_toolset_health""#),
            "{sql}"
        );
        assert!(sql.contains(r#"PRIMARY KEY ("org", "toolset")"#), "{sql}");
    }
}
