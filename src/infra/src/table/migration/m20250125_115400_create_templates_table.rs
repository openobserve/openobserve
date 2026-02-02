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

const TEMPLATES_ORG_IDX: &str = "templates_org_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_templates_table_statement())
            .await?;
        manager
            .create_index(create_templates_org_idx_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(TEMPLATES_ORG_IDX).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Templates::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the templates table.
fn create_templates_table_statement() -> TableCreateStatement {
    let text_type = super::get_text_type();
    Table::create()
        .table(Templates::Table)
        .if_not_exists()
        // The ID is 27-character human readable KSUID.
        .col(
            ColumnDef::new(Templates::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(Templates::Org).string_len(100).not_null())
        .col(ColumnDef::new(Templates::Name).string_len(256).not_null())
        .col(ColumnDef::new(Templates::IsDefault).boolean().not_null())
        .col(ColumnDef::new(Templates::Type).string_len(10).not_null())
        .col(ColumnDef::new(Templates::Body).custom(Alias::new(text_type)).not_null())
        .col(ColumnDef::new(Templates::Title).text().null())
        .to_owned()
}

/// Statement to create index on the org column of the templates table.
fn create_templates_org_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(TEMPLATES_ORG_IDX)
        .table(Templates::Table)
        .col(Templates::Org)
        .to_owned()
}

/// Identifiers used in queries on the alerts table.
#[derive(DeriveIden)]
enum Templates {
    Table,
    Id,
    Org,
    Name,
    IsDefault,
    Type,
    Body,
    Title,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_templates_table_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "templates" ( "id" char(27) NOT NULL PRIMARY KEY, "org" varchar(100) NOT NULL, "name" varchar(256) NOT NULL, "is_default" bool NOT NULL, "type" varchar(10) NOT NULL, "body" text NOT NULL, "title" text NULL )"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_templates_table_statement().to_string(MysqlQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS `templates` ( `id` char(27) NOT NULL PRIMARY KEY, `org` varchar(100) NOT NULL, `name` varchar(256) NOT NULL, `is_default` bool NOT NULL, `type` varchar(10) NOT NULL, `body` text NOT NULL, `title` text NULL )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_templates_table_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "templates" ( "id" char(27) NOT NULL PRIMARY KEY, "org" varchar(100) NOT NULL, "name" varchar(256) NOT NULL, "is_default" boolean NOT NULL, "type" varchar(10) NOT NULL, "body" text NOT NULL, "title" text NULL )"#
        );
    }
}
