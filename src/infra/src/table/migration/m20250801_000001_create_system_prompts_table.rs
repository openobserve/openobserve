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

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_system_prompts_table_statement())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SystemPrompts::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the system prompts table.
fn create_system_prompts_table_statement() -> TableCreateStatement {
    Table::create()
        .table(SystemPrompts::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SystemPrompts::Type)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(SystemPrompts::Content).text().not_null())
        .col(
            ColumnDef::new(SystemPrompts::UpdatedAt)
                .big_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

/// Identifiers used in queries on the system prompts table.
#[derive(DeriveIden)]
enum SystemPrompts {
    Table,
    Type,
    Content,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_system_prompts_table_statement().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "system_prompts" (
                "type" varchar(27) NOT NULL PRIMARY KEY,
                "content" text NOT NULL,
                "updated_at" bigint NOT NULL DEFAULT 0
            )"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_system_prompts_table_statement().to_string(MysqlQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS `system_prompts` (
                `type` varchar(27) NOT NULL PRIMARY KEY,
                `content` text NOT NULL,
                `updated_at` bigint NOT NULL DEFAULT 0
            )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_system_prompts_table_statement().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "system_prompts" (
                "type" varchar(27) NOT NULL PRIMARY KEY,
                "content" text NOT NULL,
                "updated_at" bigint NOT NULL DEFAULT 0
            )"#
        );
    }
}
