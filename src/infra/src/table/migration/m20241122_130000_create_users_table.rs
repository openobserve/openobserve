// Copyright 2024 OpenObserve Inc.
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

use datafusion::common::Column;
use sea_orm::Schema;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const USER_ID_IDX: &str = "users_id_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_users_table_statement()).await?;
        manager.create_index(create_users_id_idx_stmnt()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(USER_ID_IDX).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Users::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the folder table.
fn create_users_table_statement() -> TableCreateStatement {
    Table::create()
        .table(Users::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(Users::Id)
                .big_integer()
                .auto_increment()
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(Users::Email).string_len(100).not_null())
        .col(ColumnDef::new(Users::FirstName).string_len(80).not_null())
        .col(ColumnDef::new(Users::LastName).string_len(80).not_null())
        .col(ColumnDef::new(Users::Password).not_null())
        .col(ColumnDef::new(Users::Salt).string_len(256).not_null())
        .col(ColumnDef::new(Users::IsRoot).boolean().not_null())
        .col(ColumnDef::new(Users::PasswordExt).string_len(256))
        // Users type where...
        // - 0 is a internal user
        // - 1 is a external user
        .col(ColumnDef::new(Users::UserType).small_integer().not_null())
        .col(
            ColumnDef::new(Uses::CreatedAt)
            .big_unsigned()
                .not_null(),
        )
        .col(ColumnDef::new(Users::UpdatedAt).big_unsigned().not_null())
        .to_owned()
}

/// Statement to create index on org.
fn create_users_id_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(USER_ID_IDX)
        .table(Users::Table)
        .unique()
        .col(Users::Email)
        .to_owned()
}

/// Identifiers used in queries on the folders table.
#[derive(DeriveIden)]
pub(super) enum Users {
    Table,
    Id,
    Email,
    FirstName,
    LastName,
    Password,
    Salt,
    IsRoot,
    PasswordExt,
    UserType,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_folders_table_statement().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "folders" (
                "id" bigserial NOT NULL PRIMARY KEY,
                "org" varchar(100) NOT NULL,
                "folder_id" varchar(256) NOT NULL,
                "name" varchar(256) NOT NULL,
                "description" text,
                "type" smallint NOT NULL,
                "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
            )"#
        );
        assert_eq!(
            &create_folders_org_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "folders_org_idx" ON "folders" ("org")"#
        );
        assert_eq!(
            &create_folders_org_folder_id_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "folders_org_folder_id_idx" ON "folders" ("org", "folder_id")"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_folders_table_statement().to_string(MysqlQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS `folders` (
                `id` bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `org` varchar(100) NOT NULL,
                `folder_id` varchar(256) NOT NULL,
                `name` varchar(256) NOT NULL,
                `description` text,
                `type` smallint NOT NULL,
                `created_at` timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
            )"#
        );
        assert_eq!(
            &create_folders_org_idx_stmnt().to_string(MysqlQueryBuilder),
            r#"CREATE INDEX `folders_org_idx` ON `folders` (`org`)"#
        );
        assert_eq!(
            &create_folders_org_folder_id_idx_stmnt().to_string(MysqlQueryBuilder),
            r#"CREATE UNIQUE INDEX `folders_org_folder_id_idx` ON `folders` (`org`, `folder_id`)"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_folders_table_statement().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "folders" (
                "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                "org" varchar(100) NOT NULL,
                "folder_id" varchar(256) NOT NULL,
                "name" varchar(256) NOT NULL,
                "description" text,
                "type" smallint NOT NULL,
                "created_at" timestamp_text DEFAULT CURRENT_TIMESTAMP NOT NULL
            )"#
        );
        assert_eq!(
            &create_folders_org_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "folders_org_idx" ON "folders" ("org")"#
        );
        assert_eq!(
            &create_folders_org_folder_id_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "folders_org_folder_id_idx" ON "folders" ("org", "folder_id")"#
        );
    }
}
