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

use super::{
    m20241121_000001_create_organizations_table::Organizations,
    m20241122_130000_create_users_table::Users,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

const ORG_USER_ID_IDX: &str = "org_users_id_email_idx";
const ORG_USER_ORGANIZATION_FOREIGN_KEY: &str = "org_users_org_id_fk";
const ORG_USER_USER_FOREIGN_KEY: &str = "org_users_user_email_fk";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_org_users_table_statement())
            .await?;
        manager
            .create_foreign_key(create_org_users_org_id_foreign_key_stmnt())
            .await?;
        manager
            .create_foreign_key(create_org_users_user_email_foreign_key_stmnt())
            .await?;
        manager
            .create_index(create_org_users_id_email_idx_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(ORG_USER_ID_IDX).to_owned())
            .await?;
        manager
            .drop_foreign_key(
                ForeignKey::drop()
                    .name(ORG_USER_USER_FOREIGN_KEY)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_foreign_key(
                ForeignKey::drop()
                    .name(ORG_USER_ORGANIZATION_FOREIGN_KEY)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(OrgUsers::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the org_users table.
fn create_org_users_table_statement() -> TableCreateStatement {
    Table::create()
        .table(OrgUsers::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(OrgUsers::Id)
                .big_integer()
                .auto_increment()
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(OrgUsers::Email).string_len(100).not_null())
        .col(ColumnDef::new(OrgUsers::OrgId).string_len(256).not_null())
        // Users type where...
        // - 0 is root user
        // - 1 is admin
        // - 2 is viewer
        // - 3 is editor
        // - 4 is user
        // - 5 is service account
        .col(ColumnDef::new(OrgUsers::Role).small_integer().not_null())
        .col(ColumnDef::new(OrgUsers::Token).string_len(256).not_null())
        .col(ColumnDef::new(OrgUsers::RumToken).string_len(256))
        .col(ColumnDef::new(OrgUsers::CreatedAt).big_unsigned().not_null())
        .col(ColumnDef::new(OrgUsers::UpdatedAt).big_unsigned().not_null())
        .to_owned()
}

fn create_org_users_org_id_foreign_key_stmnt() -> ForeignKeyCreateStatement {
    sea_query::ForeignKeyCreateStatement::create()
        .name(ORG_USER_ORGANIZATION_FOREIGN_KEY)
        .from(OrgUsers::Table, OrgUsers::OrgId)
        .to(Organizations::Table, Organizations::Identifier)
        .on_delete(ForeignKeyAction::Cascade)
        .on_update(ForeignKeyAction::Cascade)
        .to_owned()
}

fn create_org_users_user_email_foreign_key_stmnt() -> ForeignKeyCreateStatement {
    sea_query::ForeignKeyCreateStatement::create()
        .name(ORG_USER_USER_FOREIGN_KEY)
        .from(OrgUsers::Table, OrgUsers::Email)
        .to(Users::Table, Users::Email)
        .on_delete(ForeignKeyAction::Cascade)
        .on_update(ForeignKeyAction::Cascade)
        .to_owned()
}

/// Statement to create index on org.
fn create_org_users_id_email_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ORG_USER_ID_IDX)
        .table(OrgUsers::Table)
        .unique()
        .col(OrgUsers::Email)
        .col(OrgUsers::OrgId)
        .to_owned()
}

/// Identifiers used in queries on the folders table.
#[derive(DeriveIden)]
enum OrgUsers {
    Table,
    Id,
    Email,
    OrgId,
    Role,
    Token,
    RumToken,
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
