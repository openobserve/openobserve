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

const SYSTEM_PROMPTS_NAME_VERSION_IDX: &str = "system_prompts_name_version_idx";
const SYSTEM_PROMPTS_NAME_ACTIVE_IDX: &str = "system_prompts_name_active_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_system_prompts_table_statement())
            .await?;
        manager
            .create_index(create_system_prompts_name_version_idx_stmnt())
            .await?;
        manager
            .create_index(create_system_prompts_name_active_idx_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(SYSTEM_PROMPTS_NAME_ACTIVE_IDX)
                    .table(SystemPrompts::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(SYSTEM_PROMPTS_NAME_VERSION_IDX)
                    .table(SystemPrompts::Table)
                    .to_owned(),
            )
            .await?;
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
            ColumnDef::new(SystemPrompts::Id)
                .big_integer()
                .not_null()
                .auto_increment()
                .primary_key(),
        )
        .col(
            ColumnDef::new(SystemPrompts::Name)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(SystemPrompts::Content).text().not_null())
        .col(
            ColumnDef::new(SystemPrompts::Version)
                .small_integer()
                .not_null(),
        )
        .col(ColumnDef::new(SystemPrompts::IsActive).boolean().not_null())
        .col(
            ColumnDef::new(SystemPrompts::CreatedAt)
                .timestamp()
                .default(SimpleExpr::Keyword(Keyword::CurrentTimestamp))
                .not_null(),
        )
        .to_owned()
}

/// Statement to create unique index on name and version.
fn create_system_prompts_name_version_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYSTEM_PROMPTS_NAME_VERSION_IDX)
        .table(SystemPrompts::Table)
        .col(SystemPrompts::Name)
        .col(SystemPrompts::Version)
        .unique()
        .to_owned()
}

/// Statement to create unique index on name and is_active to ensure only one active version per
/// name.
fn create_system_prompts_name_active_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SYSTEM_PROMPTS_NAME_ACTIVE_IDX)
        .table(SystemPrompts::Table)
        .col(SystemPrompts::Name)
        .col(SystemPrompts::IsActive)
        .unique()
        .to_owned()
}

/// Identifiers used in queries on the system prompts table.
#[derive(DeriveIden)]
enum SystemPrompts {
    Table,
    Id,
    Name,
    Content,
    Version,
    IsActive,
    CreatedAt,
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
                "id" bigserial NOT NULL PRIMARY KEY,
                "name" varchar(256) NOT NULL,
                "content" text NOT NULL,
                "version" smallint NOT NULL,
                "is_active" boolean NOT NULL,
                "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
            )"#
        );
        assert_eq!(
            &create_system_prompts_name_version_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "system_prompts_name_version_idx" ON "system_prompts" ("name", "version")"#
        );
        assert_eq!(
            &create_system_prompts_name_active_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "system_prompts_name_active_idx" ON "system_prompts" ("name", "is_active")"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_system_prompts_table_statement().to_string(MysqlQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS `system_prompts` (
                `id` bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `name` varchar(256) NOT NULL,
                `content` text NOT NULL,
                `version` smallint NOT NULL,
                `is_active` boolean NOT NULL,
                `created_at` timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
            )"#
        );
        assert_eq!(
            &create_system_prompts_name_version_idx_stmnt().to_string(MysqlQueryBuilder),
            r#"CREATE UNIQUE INDEX `system_prompts_name_version_idx` ON `system_prompts` (`name`, `version`)"#
        );
        assert_eq!(
            &create_system_prompts_name_active_idx_stmnt().to_string(MysqlQueryBuilder),
            r#"CREATE UNIQUE INDEX `system_prompts_name_active_idx` ON `system_prompts` (`name`, `is_active`)"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_system_prompts_table_statement().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "system_prompts" (
                "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                "name" varchar(256) NOT NULL,
                "content" text NOT NULL,
                "version" smallint NOT NULL,
                "is_active" boolean NOT NULL,
                "created_at" timestamp_text DEFAULT CURRENT_TIMESTAMP NOT NULL
            )"#
        );
        assert_eq!(
            &create_system_prompts_name_version_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "system_prompts_name_version_idx" ON "system_prompts" ("name", "version")"#
        );
        assert_eq!(
            &create_system_prompts_name_active_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "system_prompts_name_active_idx" ON "system_prompts" ("name", "is_active")"#
        );
    }
}
