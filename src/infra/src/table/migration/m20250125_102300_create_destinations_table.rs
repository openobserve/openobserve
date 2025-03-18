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

const DESTINATIONS_TEMPLATES_FK: &str = "destinations_templates_fk";
const DESTINATIONS_ID_NAME_ORG_IDX: &str = "destinations_id_org_name_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_destinations_table_statement())
            .await?;
        manager
            .create_index(create_destinations_template_id_destination_id_idx_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(DESTINATIONS_ID_NAME_ORG_IDX).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Destinations::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the destinations table.
fn create_destinations_table_statement() -> TableCreateStatement {
    Table::create()
        .table(Destinations::Table)
        .if_not_exists()
        // The ID is 27-character human readable KSUID.
        .col(
            ColumnDef::new(Destinations::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(Destinations::Org).string_len(100).not_null())
        .col(ColumnDef::new(Destinations::Name).string_len(256).not_null())
        .col(ColumnDef::new(Destinations::Module).string_len(10).not_null())
        .col(ColumnDef::new(Destinations::TemplateId).char_len(27).null())
        .col(ColumnDef::new(Destinations::Type).json().not_null())
        .foreign_key(sea_query::ForeignKey::create().name(DESTINATIONS_TEMPLATES_FK).from(Destinations::Table, Destinations::TemplateId).to(Templates::Table, Templates::Id))
        .to_owned()
}

/// Statement to create index on on destinations_id.
fn create_destinations_template_id_destination_id_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(DESTINATIONS_ID_NAME_ORG_IDX)
        .table(Destinations::Table)
        // .col(Destinations::TemplateId)
        .col(Destinations::Id)
        .col(Destinations::Name)
        .col(Destinations::Org)
        .unique()
        .to_owned() // not unique since template_id is nullable for pipeline destinations
}

/// Identifiers used in queries on the alerts table.
#[derive(DeriveIden)]
enum Destinations {
    Table,
    Id,
    Org,
    Name,
    Module,
    TemplateId,
    Type,
}

/// Identifiers used in queries on the templates table.
#[derive(DeriveIden)]
enum Templates {
    Table,
    Id,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_destinations_table_statement().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "destinations" ( 
                "id" char(27) NOT NULL PRIMARY KEY,
                "org" varchar(100) NOT NULL,
                "name" varchar(256) NOT NULL,
                "module" varchar(10) NOT NULL,
                "template_id" char(27) NULL,
                "type" json NOT NULL,
                CONSTRAINT "destinations_templates_fk" FOREIGN KEY ("template_id") REFERENCES "templates" ("id") 
            )"#
        );
        assert_eq!(
            &create_destinations_template_id_destination_id_idx_stmnt()
                .to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "destinations_id_org_name_idx" ON "destinations" ("id", "name", "org")"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_destinations_table_statement().to_string(MysqlQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS `destinations` (
                `id` char(27) NOT NULL PRIMARY KEY,
                `org` varchar(100) NOT NULL,
                `name` varchar(256) NOT NULL,
                `module` varchar(10) NOT NULL,
                `template_id` char(27) NULL,
                `type` json NOT NULL,
                CONSTRAINT `destinations_templates_fk` FOREIGN KEY (`template_id`) REFERENCES `templates` (`id`) 
            )"#
        );
        assert_eq!(
            &create_destinations_template_id_destination_id_idx_stmnt()
                .to_string(MysqlQueryBuilder),
            r#"CREATE UNIQUE INDEX `destinations_id_org_name_idx` ON `destinations` (`id`, `name`, `org`)"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_destinations_table_statement().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "destinations" ( 
                "id" char(27) NOT NULL PRIMARY KEY,
                "org" varchar(100) NOT NULL,
                "name" varchar(256) NOT NULL,
                "module" varchar(10) NOT NULL,
                "template_id" char(27) NULL,
                "type" json_text NOT NULL,
                FOREIGN KEY ("template_id") REFERENCES "templates" ("id") 
            )"#
        );
        assert_eq!(
            &create_destinations_template_id_destination_id_idx_stmnt()
                .to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "destinations_id_org_name_idx" ON "destinations" ("id", "name", "org")"#
        );
    }
}
