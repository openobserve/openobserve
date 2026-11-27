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

//! Adds what super-cluster replication of AI memory needs: when and where a memory's settings
//! last changed, and 30-day delete tombstones.

use sea_orm_migration::prelude::*;

const TABLE: &str = "ai_memory";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite drops IF NOT EXISTS on columns, so a retry must skip a column already added.
        for (column, statement) in add_column_statements() {
            if !manager.has_column(TABLE, column).await? {
                manager.alter_table(statement).await?;
            }
        }
        manager.create_table(create_tombstones_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AiMemoryTombstones::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        for column in [AiMemory::SettingsAt, AiMemory::SettingsRegion] {
            if manager.has_column(TABLE, &column.to_string()).await? {
                let drop = Table::alter()
                    .table(AiMemory::Table)
                    .drop_column(column)
                    .to_owned();
                manager.alter_table(drop).await?;
            }
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum AiMemory {
    Table,
    SettingsAt,
    SettingsRegion,
}

#[derive(DeriveIden)]
enum AiMemoryTombstones {
    Table,
    Org,
    Scope,
    ScopeKey,
    DeletedAt,
    Region,
}

fn add_column_statements() -> [(&'static str, TableAlterStatement); 2] {
    let alter = |column: ColumnDef| {
        Table::alter()
            .table(AiMemory::Table)
            .add_column(column)
            .to_owned()
    };
    [
        (
            "settings_at",
            alter(
                ColumnDef::new(AiMemory::SettingsAt)
                    .big_integer()
                    .null()
                    .to_owned(),
            ),
        ),
        (
            "settings_region",
            alter(
                ColumnDef::new(AiMemory::SettingsRegion)
                    .string_len(256)
                    .null()
                    .to_owned(),
            ),
        ),
    ]
}

fn create_tombstones_statement() -> TableCreateStatement {
    Table::create()
        .table(AiMemoryTombstones::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiMemoryTombstones::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiMemoryTombstones::Scope)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiMemoryTombstones::ScopeKey)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiMemoryTombstones::DeletedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AiMemoryTombstones::Region)
                .string_len(256)
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(AiMemoryTombstones::Org)
                .col(AiMemoryTombstones::Scope)
                .col(AiMemoryTombstones::ScopeKey),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_the_settings_stamp_and_creates_the_tombstones() {
        let [(_, at), (_, region)] = add_column_statements();
        assert_eq!(
            at.to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "ai_memory" ADD COLUMN "settings_at" bigint NULL"#
        );
        assert_eq!(
            region.to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "ai_memory" ADD COLUMN "settings_region" varchar(256) NULL"#
        );
        let sql = create_tombstones_statement().to_string(PostgresQueryBuilder);
        assert!(
            sql.contains(r#"PRIMARY KEY ("org", "scope", "scope_key")"#),
            "{sql}"
        );
    }
}
