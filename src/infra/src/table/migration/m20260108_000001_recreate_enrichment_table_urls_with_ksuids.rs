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

//! This migration recreates the `enrichment_table_urls` table with KSUID primary key.
//!
//! Rather than using auto-incrementing integer indices, as it was before, the
//! `enrichment_table_urls` table is recreated using KSUIDs as the primary key.
//! This enables better distributed system support and allows multiple URLs per table.
//!
//! The migration strategy follows these steps:
//! 1. Rename the legacy `enrichment_table_urls` table to `legacy_enrichment_table_urls`
//! 2. Add a temporary `ksuid` column to the `legacy_enrichment_table_urls` table and populate it
//! 3. Create new `enrichment_table_urls` table with KSUID as primary key
//! 4. Select all records from the `legacy_enrichment_table_urls` table and copy them to the new
//!    table
//! 5. Drop the `legacy_enrichment_table_urls` table

use sea_orm::{ConnectionTrait, PaginatorTrait, QueryOrder, TransactionTrait};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Step 1: Rename the legacy table
        manager
            .rename_table(legacy_enrichment_table_urls::rename_to_legacy())
            .await?;

        // Step 2: Add temporary `ksuid` column to legacy table
        manager
            .alter_table(legacy_enrichment_table_urls::add_ksuid_column())
            .await?;

        // Step 3: Populate KSUIDs
        let txn = manager.get_connection().begin().await?;
        legacy_enrichment_table_urls::populate_ksuid_column(&txn, 100).await?;
        txn.commit().await?;

        // Step 4: Create new table with KSUID primary key
        manager
            .create_table(new_enrichment_table_urls::create_table_statement())
            .await?;

        // Step 5: Create indices
        manager
            .create_index(new_enrichment_table_urls::create_org_name_created_idx())
            .await?;
        manager
            .create_index(new_enrichment_table_urls::create_org_name_url_idx())
            .await?;
        manager
            .create_index(new_enrichment_table_urls::create_status_idx())
            .await?;
        manager
            .create_index(new_enrichment_table_urls::create_is_local_region_idx())
            .await?;

        // Step 6: Copy data from legacy table to new table
        let txn = manager.get_connection().begin().await?;
        new_enrichment_table_urls::copy_from_legacy(&txn, 100).await?;
        txn.commit().await?;

        // Step 7: Drop legacy table
        manager
            .drop_table(legacy_enrichment_table_urls::drop_table())
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Note: This is a destructive migration. Down migration is not fully supported
        // as it would require recreating the auto-increment IDs.

        // Drop indices
        manager
            .drop_index(
                Index::drop()
                    .name("enrichment_table_urls_is_local_region_idx")
                    .table(EnrichmentTableUrls::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name("enrichment_table_urls_status_idx")
                    .table(EnrichmentTableUrls::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name("enrichment_table_urls_org_name_url_idx")
                    .table(EnrichmentTableUrls::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name("enrichment_table_urls_org_name_created_idx")
                    .table(EnrichmentTableUrls::Table)
                    .to_owned(),
            )
            .await?;

        // Drop new table
        manager
            .drop_table(Table::drop().table(EnrichmentTableUrls::Table).to_owned())
            .await?;

        Ok(())
    }
}

/// Legacy enrichment_table_urls table operations
mod legacy_enrichment_table_urls {
    use super::*;

    const OLD_TABLE_NAME: &str = "enrichment_table_urls";
    const NEW_TABLE_NAME: &str = "legacy_enrichment_table_urls";

    /// Rename enrichment_table_urls to legacy_enrichment_table_urls
    pub fn rename_to_legacy() -> TableRenameStatement {
        Table::rename()
            .table(Alias::new(OLD_TABLE_NAME), Alias::new(NEW_TABLE_NAME))
            .to_owned()
    }

    /// Add temporary ksuid column to legacy table
    pub fn add_ksuid_column() -> TableAlterStatement {
        Table::alter()
            .table(Alias::new(NEW_TABLE_NAME))
            .add_column(ColumnDef::new(Alias::new("ksuid")).char_len(27).null())
            .to_owned()
    }

    /// Populate ksuid column for all records
    pub async fn populate_ksuid_column<C: ConnectionTrait>(
        conn: &C,
        page_size: u64,
    ) -> Result<(), DbErr> {
        use sea_orm::entity::*;

        let mut pages = legacy_entities::legacy_enrichment_table_urls::Entity::find()
            .order_by_asc(legacy_entities::legacy_enrichment_table_urls::Column::Id)
            .paginate(conn, page_size);

        while let Some(jobs) = pages.fetch_and_next().await? {
            for job in jobs {
                // Generate deterministic KSUID from org + name hash
                // This ensures all super cluster regions get the same ID for the same job
                // We use org+name (not org+name+url) because before migration there was
                // a unique constraint on (org, name), so only one job per table existed
                let ksuid = enrichment_job_ksuid_from_hash(&job.org, &job.name);
                log::info!(
                    "[ENRICHMENT::URL] enrichment_table_url job {}/{} deterministic ksuid: {}",
                    job.org,
                    job.name,
                    ksuid
                );
                let mut am = job.into_active_model();
                am.ksuid = Set(Some(ksuid.to_string()));
                am.update(conn).await?;
            }
        }

        Ok(())
    }

    /// Drop legacy table
    pub fn drop_table() -> TableDropStatement {
        Table::drop().table(Alias::new(NEW_TABLE_NAME)).to_owned()
    }

    /// Generates a KSUID from a hash of the enrichment job's `org` and `name`.
    ///
    /// To generate a KSUID this function generates the 160-bit SHA-1 hash of the job's `org` and
    /// `name` and interprets that 160-bit hash as a 160-bit KSUID. Therefore two KSUIDs generated
    /// in this manner will always be equal if the jobs have the same `org` and `name`.
    ///
    /// This is used during migration to ensure all super cluster regions generate the same ID
    /// for the same enrichment table job.
    ///
    /// It is important to note that KSUIDs generated in this manner will have timestamp bits which
    /// are effectively random, meaning that the timestamp in any KSUID generated with this
    /// function will be random.
    fn enrichment_job_ksuid_from_hash(org: &str, name: &str) -> svix_ksuid::Ksuid {
        use sha1::{Digest, Sha1};
        use svix_ksuid::KsuidLike;
        let mut hasher = Sha1::new();
        hasher.update(org);
        hasher.update(name);
        let hash = hasher.finalize();
        svix_ksuid::Ksuid::from_bytes(hash.into())
    }
}

/// New enrichment_table_urls table with KSUID primary key
mod new_enrichment_table_urls {
    use super::*;

    /// Create new table with KSUID primary key
    pub fn create_table_statement() -> TableCreateStatement {
        Table::create()
            .table(EnrichmentTableUrls::Table)
            .if_not_exists()
            // KSUID (27 chars) - PRIMARY KEY
            .col(
                ColumnDef::new(EnrichmentTableUrls::Id)
                    .char_len(27)
                    .not_null()
                    .primary_key(),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::Org)
                    .string_len(256)
                    .not_null(),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::Name)
                    .string_len(256)
                    .not_null(),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::Url)
                    .string_len(2048)
                    .not_null(),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::Status)
                    .small_integer()
                    .not_null(),
            )
            .col(ColumnDef::new(EnrichmentTableUrls::ErrorMessage).text())
            .col(
                ColumnDef::new(EnrichmentTableUrls::CreatedAt)
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::UpdatedAt)
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::TotalBytesFetched)
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::TotalRecordsProcessed)
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::RetryCount)
                    .integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::AppendData)
                    .boolean()
                    .not_null(),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::LastBytePosition)
                    .big_integer()
                    .not_null()
                    .default(0),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::SupportsRange)
                    .boolean()
                    .not_null()
                    .default(false),
            )
            .col(
                ColumnDef::new(EnrichmentTableUrls::IsLocalRegion)
                    .boolean()
                    .not_null(),
            )
            .to_owned()
    }

    /// Index for fetching all URLs for a table, ordered by creation time
    pub fn create_org_name_created_idx() -> IndexCreateStatement {
        Index::create()
            .if_not_exists()
            .name("enrichment_table_urls_org_name_created_idx")
            .table(EnrichmentTableUrls::Table)
            .col(EnrichmentTableUrls::Org)
            .col(EnrichmentTableUrls::Name)
            .col((EnrichmentTableUrls::CreatedAt, IndexOrder::Desc))
            .to_owned()
    }

    /// Unique index for preventing duplicate URLs within a table
    pub fn create_org_name_url_idx() -> IndexCreateStatement {
        Index::create()
            .if_not_exists()
            .name("enrichment_table_urls_org_name_url_idx")
            .table(EnrichmentTableUrls::Table)
            .col(EnrichmentTableUrls::Org)
            .col(EnrichmentTableUrls::Name)
            .col(EnrichmentTableUrls::Url)
            .unique()
            .to_owned()
    }

    /// Index for status queries (finding pending/processing jobs)
    pub fn create_status_idx() -> IndexCreateStatement {
        Index::create()
            .if_not_exists()
            .name("enrichment_table_urls_status_idx")
            .table(EnrichmentTableUrls::Table)
            .col(EnrichmentTableUrls::Status)
            .to_owned()
    }

    /// Index for local region filtering
    pub fn create_is_local_region_idx() -> IndexCreateStatement {
        Index::create()
            .if_not_exists()
            .name("enrichment_table_urls_is_local_region_idx")
            .table(EnrichmentTableUrls::Table)
            .col(EnrichmentTableUrls::IsLocalRegion)
            .to_owned()
    }

    /// Copy all records from legacy table to new table
    pub async fn copy_from_legacy<C: ConnectionTrait>(
        conn: &C,
        page_size: u64,
    ) -> Result<(), DbErr> {
        use sea_orm::entity::*;

        let mut pages = legacy_entities::legacy_enrichment_table_urls::Entity::find()
            .order_by_asc(legacy_entities::legacy_enrichment_table_urls::Column::Id)
            .paginate(conn, page_size);

        while let Some(legacy_jobs) = pages.fetch_and_next().await? {
            for legacy_job in legacy_jobs {
                // Use the KSUID from legacy table
                let ksuid = legacy_job
                    .ksuid
                    .expect("ksuid should be populated in legacy table");

                // Create new record in new table
                let new_job = crate::table::entity::enrichment_table_urls::ActiveModel {
                    id: Set(ksuid),
                    org: Set(legacy_job.org),
                    name: Set(legacy_job.name),
                    url: Set(legacy_job.url),
                    status: Set(legacy_job.status),
                    error_message: Set(legacy_job.error_message),
                    created_at: Set(legacy_job.created_at),
                    updated_at: Set(legacy_job.updated_at),
                    total_bytes_fetched: Set(legacy_job.total_bytes_fetched),
                    total_records_processed: Set(legacy_job.total_records_processed),
                    retry_count: Set(legacy_job.retry_count),
                    append_data: Set(legacy_job.append_data),
                    last_byte_position: Set(legacy_job.last_byte_position),
                    supports_range: Set(legacy_job.supports_range),
                    is_local_region: Set(legacy_job.is_local_region),
                };

                new_job.insert(conn).await?;
            }
        }

        Ok(())
    }
}

/// Legacy entities module for accessing old table structure
mod legacy_entities {
    pub mod legacy_enrichment_table_urls {
        use sea_orm::entity::prelude::*;

        #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
        #[sea_orm(table_name = "legacy_enrichment_table_urls")]
        pub struct Model {
            #[sea_orm(primary_key)]
            pub id: i64,
            pub org: String,
            pub name: String,
            pub url: String,
            pub status: i16,
            pub error_message: Option<String>,
            pub created_at: i64,
            pub updated_at: i64,
            pub total_bytes_fetched: i64,
            pub total_records_processed: i64,
            pub retry_count: i32,
            pub append_data: bool,
            pub last_byte_position: i64,
            pub supports_range: bool,
            pub is_local_region: bool,
            pub ksuid: Option<String>,
        }

        #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
        pub enum Relation {}

        impl ActiveModelBehavior for ActiveModel {}
    }
}

/// Identifiers for enrichment_table_urls table
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
    IsLocalRegion,
}
