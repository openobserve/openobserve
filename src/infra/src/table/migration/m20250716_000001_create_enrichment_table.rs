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

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const ENRICHMENT_TABLES_ORG_NAME_IDX: &str = "enrichment_table_org_name_idx";
const ENRICHMENT_TABLES_CREATED_AT_IDX: &str = "enrichment_table_created_at_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_enrichment_tables_statement())
            .await?;
        manager
            .create_index(create_enrichment_tables_index_statement())
            .await?;
        manager
            .create_index(create_enrichment_tables_index_statement_created_at())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(EnrichmentTables::Table).to_owned())
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(ENRICHMENT_TABLES_ORG_NAME_IDX)
                    .table(EnrichmentTables::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(ENRICHMENT_TABLES_CREATED_AT_IDX)
                    .table(EnrichmentTables::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

/// Statement to create the reports table.
fn create_enrichment_tables_statement() -> TableCreateStatement {
    Table::create()
        .table(EnrichmentTables::Table)
        .if_not_exists()
        // The ID is a unique auto-incrementing integer.
        .col(
            ColumnDef::new(EnrichmentTables::Id)
                .unsigned()
                .auto_increment()
                .primary_key(),
        )
        .col(ColumnDef::new(EnrichmentTables::Org).string_len(256).not_null())
        .col(ColumnDef::new(EnrichmentTables::Name).string_len(256).not_null())
        .col(ColumnDef::new(EnrichmentTables::Data).binary().not_null())
        .col(ColumnDef::new(EnrichmentTables::CreatedAt).big_unsigned().not_null())
        .to_owned()
}

fn create_enrichment_tables_index_statement() -> IndexCreateStatement {
    Index::create()
        .name(ENRICHMENT_TABLES_ORG_NAME_IDX)
        .table(EnrichmentTables::Table)
        .col(EnrichmentTables::Org)
        .col(EnrichmentTables::Name)
        .to_owned()
}

fn create_enrichment_tables_index_statement_created_at() -> IndexCreateStatement {
    Index::create()
        .name(ENRICHMENT_TABLES_CREATED_AT_IDX)
        .table(EnrichmentTables::Table)
        .col(EnrichmentTables::CreatedAt)
        .to_owned()
}

/// Identifiers used in queries on the enrichment table.
#[derive(DeriveIden)]
enum EnrichmentTables {
    Table,
    Id,
    Org,
    Name,
    Data,
    CreatedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_reports_table_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "reports" ( 
                "id" char(27) NOT NULL PRIMARY KEY,
                "org" varchar(256) NOT NULL,
                "folder_id" char(27) NOT NULL,
                "name" varchar(256) NOT NULL,
                "title" varchar(256) NOT NULL,
                "description" text NULL,
                "enabled" bool NOT NULL,
                "frequency" json NOT NULL,
                "destinations" json NOT NULL,
                "message" text NULL,
                "timezone" varchar(256) NOT NULL,
                "tz_offset" integer NOT NULL,
                "owner" varchar(256) NULL,
                "last_edited_by" varchar(256) NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NULL,
                "start_at" bigint NOT NULL,
                CONSTRAINT "reports_folders_fk" FOREIGN KEY ("folder_id") REFERENCES "folders" ("id") 
            )"#
        );

        collapsed_eq!(
            &create_report_dashboards_table_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "report_dashboards" ( 
                "report_id" char(27) NOT NULL,
                "dashboard_id" char(27) NOT NULL,
                "tab_names" json NOT NULL,
                "variables" json NOT NULL,
                "timerange" json NOT NULL,
                PRIMARY KEY ("report_id", "dashboard_id"),
                CONSTRAINT "report_dashboards_reports_fk" FOREIGN KEY ("report_id") REFERENCES "reports" ("id") ON DELETE CASCADE,
                CONSTRAINT "report_dashboards_dashboards_fk" FOREIGN KEY ("dashboard_id") REFERENCES "dashboards" ("id") ON DELETE CASCADE 
            )"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_reports_table_statement().to_string(MysqlQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS `reports` ( 
                `id` char(27) NOT NULL PRIMARY KEY,
                `org` varchar(256) NOT NULL,
                `folder_id` char(27) NOT NULL,
                `name` varchar(256) NOT NULL,
                `title` varchar(256) NOT NULL,
                `description` text NULL,
                `enabled` bool NOT NULL,
                `frequency` json NOT NULL,
                `destinations` json NOT NULL,
                `message` text NULL,
                `timezone` varchar(256) NOT NULL,
                `tz_offset` int NOT NULL,
                `owner` varchar(256) NULL,
                `last_edited_by` varchar(256) NULL,
                `created_at` bigint NOT NULL,
                `updated_at` bigint NULL,
                `start_at` bigint NOT NULL,
                CONSTRAINT `reports_folders_fk` FOREIGN KEY (`folder_id`) REFERENCES `folders` (`id`)
            )"#
        );

        collapsed_eq!(
            &create_report_dashboards_table_statement().to_string(MysqlQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS `report_dashboards` ( 
                `report_id` char(27) NOT NULL,
                `dashboard_id` char(27) NOT NULL,
                `tab_names` json NOT NULL,
                `variables` json NOT NULL,
                `timerange` json NOT NULL,
                PRIMARY KEY (`report_id`, `dashboard_id`),
                CONSTRAINT `report_dashboards_reports_fk` FOREIGN KEY (`report_id`) REFERENCES `reports` (`id`) ON DELETE CASCADE,
                CONSTRAINT `report_dashboards_dashboards_fk` FOREIGN KEY (`dashboard_id`) REFERENCES `dashboards` (`id`) ON DELETE CASCADE 
            )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_reports_table_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "reports" ( 
                "id" char(27) NOT NULL PRIMARY KEY,
                "org" varchar(256) NOT NULL,
                "folder_id" char(27) NOT NULL,
                "name" varchar(256) NOT NULL,
                "title" varchar(256) NOT NULL,
                "description" text NULL,
                "enabled" boolean NOT NULL,
                "frequency" json_text NOT NULL,
                "destinations" json_text NOT NULL,
                "message" text NULL,
                "timezone" varchar(256) NOT NULL,
                "tz_offset" integer NOT NULL,
                "owner" varchar(256) NULL,
                "last_edited_by" varchar(256) NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NULL,
                "start_at" bigint NOT NULL,
                FOREIGN KEY ("folder_id") REFERENCES "folders" ("id") 
            )"#
        );

        collapsed_eq!(
            &create_report_dashboards_table_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "report_dashboards" ( 
                "report_id" char(27) NOT NULL,
                "dashboard_id" char(27) NOT NULL,
                "tab_names" json_text NOT NULL,
                "variables" json_text NOT NULL,
                "timerange" json_text NOT NULL,
                PRIMARY KEY ("report_id", "dashboard_id"),
                FOREIGN KEY ("report_id") REFERENCES "reports" ("id") ON DELETE CASCADE,
                FOREIGN KEY ("dashboard_id") REFERENCES "dashboards" ("id") ON DELETE CASCADE 
            )"#
        );
    }
}
