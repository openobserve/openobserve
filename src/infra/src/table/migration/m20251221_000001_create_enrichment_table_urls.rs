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

const ENRICHMENT_TABLE_URLS_ORG_NAME_IDX: &str = "enrichment_table_urls_org_name_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_enrichment_table_urls_statement())
            .await?;
        manager
            .create_index(create_enrichment_table_urls_index_statement())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(ENRICHMENT_TABLE_URLS_ORG_NAME_IDX)
                    .table(EnrichmentTableUrls::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(EnrichmentTableUrls::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the enrichment_table_urls table.
fn create_enrichment_table_urls_statement() -> TableCreateStatement {
    Table::create()
        .table(EnrichmentTableUrls::Table)
        .if_not_exists()
        // The ID is a unique auto-incrementing integer.
        .col(
            ColumnDef::new(EnrichmentTableUrls::Id)
                .big_integer()
                .auto_increment()
                .primary_key(),
        )
        .col(ColumnDef::new(EnrichmentTableUrls::Org).string_len(256).not_null())
        .col(ColumnDef::new(EnrichmentTableUrls::Name).string_len(256).not_null())
        .col(ColumnDef::new(EnrichmentTableUrls::Url).string_len(2048).not_null())
        .col(ColumnDef::new(EnrichmentTableUrls::Status).small_integer().not_null())
        .col(ColumnDef::new(EnrichmentTableUrls::ErrorMessage).text())
        .col(ColumnDef::new(EnrichmentTableUrls::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(EnrichmentTableUrls::UpdatedAt).big_integer().not_null())
        .col(ColumnDef::new(EnrichmentTableUrls::TotalBytesFetched).big_integer().not_null())
        .col(ColumnDef::new(EnrichmentTableUrls::TotalRecordsProcessed).big_integer().not_null())
        .col(ColumnDef::new(EnrichmentTableUrls::RetryCount).integer().not_null())
        .col(ColumnDef::new(EnrichmentTableUrls::AppendData).boolean().not_null())
        .col(ColumnDef::new(EnrichmentTableUrls::LastBytePosition).big_integer().not_null().default(0))
        .col(ColumnDef::new(EnrichmentTableUrls::SupportsRange).boolean().not_null().default(false))
        .to_owned()
}

fn create_enrichment_table_urls_index_statement() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(ENRICHMENT_TABLE_URLS_ORG_NAME_IDX)
        .table(EnrichmentTableUrls::Table)
        .col(EnrichmentTableUrls::Org)
        .col(EnrichmentTableUrls::Name)
        .unique()
        .to_owned()
}

/// Identifiers used in queries on the enrichment_table_urls table.
#[derive(DeriveIden)]
enum EnrichmentTableUrls {
    Table,
    Id,
    Org,
    Name,
    Url,
    Status,
    ErrorMessage,
    CreatedAt,
    UpdatedAt,
    TotalBytesFetched,
    TotalRecordsProcessed,
    RetryCount,
    AppendData,
    LastBytePosition,
    SupportsRange,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_enrichment_table_urls_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "enrichment_table_urls" (
                "id" bigserial PRIMARY KEY,
                "org" varchar(256) NOT NULL,
                "name" varchar(256) NOT NULL,
                "url" varchar(2048) NOT NULL,
                "status" smallint NOT NULL,
                "error_message" text,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                "total_bytes_fetched" bigint NOT NULL,
                "total_records_processed" bigint NOT NULL,
                "retry_count" integer NOT NULL,
                "append_data" bool NOT NULL,
                "last_byte_position" bigint NOT NULL DEFAULT 0,
                "supports_range" bool NOT NULL DEFAULT FALSE
            )"#
        );

        collapsed_eq!(
            &create_enrichment_table_urls_index_statement().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "enrichment_table_urls_org_name_idx" ON "enrichment_table_urls" ("org", "name")"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_enrichment_table_urls_statement().to_string(MysqlQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS `enrichment_table_urls` (
                `id` bigint AUTO_INCREMENT PRIMARY KEY,
                `org` varchar(256) NOT NULL,
                `name` varchar(256) NOT NULL,
                `url` varchar(2048) NOT NULL,
                `status` smallint NOT NULL,
                `error_message` text,
                `created_at` bigint NOT NULL,
                `updated_at` bigint NOT NULL,
                `total_bytes_fetched` bigint NOT NULL,
                `total_records_processed` bigint NOT NULL,
                `retry_count` int NOT NULL,
                `append_data` bool NOT NULL,
                `last_byte_position` bigint NOT NULL DEFAULT 0,
                `supports_range` bool NOT NULL DEFAULT FALSE
            )"#
        );

        collapsed_eq!(
            &create_enrichment_table_urls_index_statement().to_string(MysqlQueryBuilder),
            r#"CREATE UNIQUE INDEX `enrichment_table_urls_org_name_idx` ON `enrichment_table_urls` (`org`, `name`)"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_enrichment_table_urls_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "enrichment_table_urls" (
                "id" integer PRIMARY KEY AUTOINCREMENT,
                "org" varchar(256) NOT NULL,
                "name" varchar(256) NOT NULL,
                "url" varchar(2048) NOT NULL,
                "status" smallint NOT NULL,
                "error_message" text,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                "total_bytes_fetched" bigint NOT NULL,
                "total_records_processed" bigint NOT NULL,
                "retry_count" integer NOT NULL,
                "append_data" boolean NOT NULL,
                "last_byte_position" bigint NOT NULL DEFAULT 0,
                "supports_range" boolean NOT NULL DEFAULT FALSE
            )"#
        );

        collapsed_eq!(
            &create_enrichment_table_urls_index_statement().to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "enrichment_table_urls_org_name_idx" ON "enrichment_table_urls" ("org", "name")"#
        );
    }
}
