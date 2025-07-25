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

const RE_PATTERNS_ORG_NAME_IDX: &str = "re_patterns_org_name_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_re_table_statement()).await?;
        manager
            .create_index(create_pattern_org_name_idx_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(RePatterns::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the re patterns table.
fn create_re_table_statement() -> TableCreateStatement {
    Table::create()
        .table(RePatterns::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RePatterns::Id)
                .string_len(100)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(RePatterns::Org).string_len(100).not_null())
        .col(ColumnDef::new(RePatterns::Name).string_len(256).not_null())
        .col(ColumnDef::new(RePatterns::Description).text().not_null())
        .col(
            ColumnDef::new(RePatterns::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RePatterns::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RePatterns::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(RePatterns::Pattern).text().not_null())
        .to_owned()
}

/// Statement to create index on pattern table.
fn create_pattern_org_name_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(RE_PATTERNS_ORG_NAME_IDX)
        .table(RePatterns::Table)
        .unique()
        .col(RePatterns::Org)
        .col(RePatterns::Name)
        .to_owned()
}

/// Identifiers used in queries on the re_patterns table.
#[derive(DeriveIden)]
pub(super) enum RePatterns {
    Table,
    Id,
    Org,
    Name,
    Description,
    CreatedBy,
    CreatedAt,
    UpdatedAt,
    Pattern,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_re_table_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "re_patterns" ( 
            "id" varchar(100) NOT NULL PRIMARY KEY, 
            "org" varchar(100) NOT NULL, 
            "name" varchar(256) NOT NULL,
            "description" text NOT NULL,
            "created_by" varchar(256) NOT NULL,
            "created_at" bigint NOT NULL, 
            "updated_at" bigint NOT NULL, 
            "pattern" text NOT NULL 
            )"#
        );
        assert_eq!(
            &create_pattern_org_name_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "re_patterns_org_name_idx" ON "re_patterns" ("org", "name")"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_re_table_statement().to_string(MysqlQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS `re_patterns` ( 
            `id` varchar(100) NOT NULL PRIMARY KEY, 
            `org` varchar(100) NOT NULL, 
            `name` varchar(256) NOT NULL,
            `description` text NOT NULL,
            `created_by` varchar(256) NOT NULL,
            `created_at` bigint NOT NULL, 
            `updated_at` bigint NOT NULL, 
            `pattern` text NOT NULL 
            )"#
        );
        assert_eq!(
            &create_pattern_org_name_idx_stmnt().to_string(MysqlQueryBuilder),
            r#"CREATE UNIQUE INDEX `re_patterns_org_name_idx` ON `re_patterns` (`org`, `name`)"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_re_table_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "re_patterns" ( 
            "id" varchar(100) NOT NULL PRIMARY KEY, 
            "org" varchar(100) NOT NULL, 
            "name" varchar(256) NOT NULL,
            "description" text NOT NULL,
            "created_by" varchar(256) NOT NULL,
            "created_at" bigint NOT NULL, 
            "updated_at" bigint NOT NULL, 
            "pattern" text NOT NULL 
            )"#
        );
        assert_eq!(
            &create_pattern_org_name_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "re_patterns_org_name_idx" ON "re_patterns" ("org", "name")"#
        );
    }
}
