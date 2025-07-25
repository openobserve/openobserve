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

/// Statement to create the enrichment tables table.
fn create_enrichment_tables_statement() -> TableCreateStatement {
    Table::create()
        .table(EnrichmentTables::Table)
        .if_not_exists()
        // The ID is a unique auto-incrementing integer.
        .col(
            ColumnDef::new(EnrichmentTables::Id)
                .big_integer()
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
        .if_not_exists()
        .name(ENRICHMENT_TABLES_ORG_NAME_IDX)
        .table(EnrichmentTables::Table)
        .col(EnrichmentTables::Org)
        .col(EnrichmentTables::Name)
        .to_owned()
}

fn create_enrichment_tables_index_statement_created_at() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
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
            &create_enrichment_tables_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "enrichment_tables" ( 
                "id" bigserial PRIMARY KEY,
                "org" varchar(256) NOT NULL,
                "name" varchar(256) NOT NULL,
                "data" bytea NOT NULL,
                "created_at" bigint NOT NULL
            )"#
        );

        collapsed_eq!(
            &create_enrichment_tables_index_statement().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "enrichment_table_org_name_idx" ON "enrichment_tables" ("org", "name")"#
        );

        collapsed_eq!(
            &create_enrichment_tables_index_statement_created_at().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "enrichment_table_created_at_idx" ON "enrichment_tables" ("created_at")"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_enrichment_tables_statement().to_string(MysqlQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS `enrichment_tables` ( 
                `id` bigint AUTO_INCREMENT PRIMARY KEY,
                `org` varchar(256) NOT NULL,
                `name` varchar(256) NOT NULL,
                `data` binary(1) NOT NULL,
                `created_at` bigint UNSIGNED NOT NULL
            )"#
        );

        collapsed_eq!(
            &create_enrichment_tables_index_statement().to_string(MysqlQueryBuilder),
            r#"CREATE INDEX `enrichment_table_org_name_idx` ON `enrichment_tables` (`org`, `name`)"#
        );

        collapsed_eq!(
            &create_enrichment_tables_index_statement_created_at().to_string(MysqlQueryBuilder),
            r#"CREATE INDEX `enrichment_table_created_at_idx` ON `enrichment_tables` (`created_at`)"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_enrichment_tables_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "enrichment_tables" ( 
                "id" integer PRIMARY KEY AUTOINCREMENT,
                "org" varchar(256) NOT NULL,
                "name" varchar(256) NOT NULL,
                "data" blob(1) NOT NULL,
                "created_at" bigint NOT NULL
            )"#
        );

        collapsed_eq!(
            &create_enrichment_tables_index_statement().to_string(SqliteQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "enrichment_table_org_name_idx" ON "enrichment_tables" ("org", "name")"#
        );

        collapsed_eq!(
            &create_enrichment_tables_index_statement_created_at().to_string(SqliteQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "enrichment_table_created_at_idx" ON "enrichment_tables" ("created_at")"#
        );
    }
}
