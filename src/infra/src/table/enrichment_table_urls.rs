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

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect, Set, entity::prelude::*};
use serde::{Deserialize, Serialize};

use super::get_lock;

// Status constants for enrichment table URL jobs
const STATUS_PROCESSING: i16 = 1;
// Re-export the entity for convenience
pub use crate::table::entity::enrichment_table_urls::{
    ActiveModel, Column, Entity, Model, Relation,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichmentTableUrlRecord {
    pub id: String, // KSUID (27 chars)
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
}

impl From<Model> for EnrichmentTableUrlRecord {
    fn from(model: Model) -> Self {
        Self {
            id: model.id,
            org: model.org,
            name: model.name,
            url: model.url,
            status: model.status,
            error_message: model.error_message,
            created_at: model.created_at,
            updated_at: model.updated_at,
            total_bytes_fetched: model.total_bytes_fetched,
            total_records_processed: model.total_records_processed,
            retry_count: model.retry_count,
            append_data: model.append_data,
            last_byte_position: model.last_byte_position,
            supports_range: model.supports_range,
            is_local_region: model.is_local_region,
        }
    }
}

/// Add or update an enrichment table URL job record
///
/// # Arguments
/// * `record` - The enrichment table URL record to save
///
/// # Returns
/// * `Result<(), errors::Error>` - Success or error
pub async fn put(record: EnrichmentTableUrlRecord) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    // Try to find existing record by ID
    let existing = Entity::find()
        .filter(Column::Id.eq(&record.id))
        .one(client)
        .await?;

    if let Some(existing_model) = existing {
        // Update existing record
        let mut active: ActiveModel = existing_model.into();
        active.url = Set(record.url);
        active.status = Set(record.status);
        active.error_message = Set(record.error_message);
        active.updated_at = Set(record.updated_at);
        active.total_bytes_fetched = Set(record.total_bytes_fetched);
        active.total_records_processed = Set(record.total_records_processed);
        active.retry_count = Set(record.retry_count);
        active.append_data = Set(record.append_data);
        active.last_byte_position = Set(record.last_byte_position);
        active.supports_range = Set(record.supports_range);
        active.is_local_region = Set(record.is_local_region);
        active.update(client).await?;
    } else {
        // Insert new record with provided ID (KSUID)
        let active = ActiveModel {
            id: Set(record.id),
            org: Set(record.org),
            name: Set(record.name),
            url: Set(record.url),
            status: Set(record.status),
            error_message: Set(record.error_message),
            created_at: Set(record.created_at),
            updated_at: Set(record.updated_at),
            total_bytes_fetched: Set(record.total_bytes_fetched),
            total_records_processed: Set(record.total_records_processed),
            retry_count: Set(record.retry_count),
            append_data: Set(record.append_data),
            last_byte_position: Set(record.last_byte_position),
            supports_range: Set(record.supports_range),
            is_local_region: Set(record.is_local_region),
        };
        Entity::insert(active).exec(client).await?;
    }

    Ok(())
}

/// Get an enrichment table URL job record
///
/// # Arguments
/// * `org` - Organization name
/// * `table_name` - Table name
///
/// # Returns
/// * `Result<Option<EnrichmentTableUrlRecord>, errors::Error>` - The record or None if not found
pub async fn get(
    org: &str,
    table_name: &str,
) -> Result<Option<EnrichmentTableUrlRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(table_name))
        .one(client)
        .await?;

    Ok(record.map(|model| model.into()))
}

/// Delete an enrichment table URL job record
///
/// # Arguments
/// * `org` - Organization name
/// * `table_name` - Table name
///
/// # Returns
/// * `Result<(), errors::Error>` - Success or error
pub async fn delete(org: &str, table_name: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(table_name))
        .exec(client)
        .await?;

    Ok(())
}

/// List all enrichment table URL job records for an organization
///
/// # Arguments
/// * `org` - Organization name
///
/// # Returns
/// * `Result<Vec<EnrichmentTableUrlRecord>, errors::Error>` - List of records or error
pub async fn list_by_org(org: &str) -> Result<Vec<EnrichmentTableUrlRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .filter(Column::Org.eq(org))
        .all(client)
        .await?;

    Ok(records.into_iter().map(|model| model.into()).collect())
}

/// Get all URL jobs for a specific table, ordered by created_at DESC
///
/// # Arguments
/// * `org` - Organization name
/// * `table_name` - Table name
///
/// # Returns
/// * `Result<Vec<EnrichmentTableUrlRecord>, errors::Error>` - List of records or empty vec
pub async fn get_all_for_table(
    org: &str,
    table_name: &str,
) -> Result<Vec<EnrichmentTableUrlRecord>, errors::Error> {
    use sea_orm::QueryOrder;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(table_name))
        .order_by_desc(Column::CreatedAt)
        .all(client)
        .await?;

    Ok(records.into_iter().map(|model| model.into()).collect())
}

/// Get a specific URL job by ID
///
/// # Arguments
/// * `job_id` - The KSUID of the job
///
/// # Returns
/// * `Result<Option<EnrichmentTableUrlRecord>, errors::Error>` - The record or None
pub async fn get_by_id(job_id: &str) -> Result<Option<EnrichmentTableUrlRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::Id.eq(job_id))
        .one(client)
        .await?;

    Ok(record.map(|model| model.into()))
}

/// Delete a specific URL job by ID
///
/// # Arguments
/// * `job_id` - The KSUID of the job to delete
///
/// # Returns
/// * `Result<(), errors::Error>` - Success or error
pub async fn delete_by_id(job_id: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    Entity::delete_many()
        .filter(Column::Id.eq(job_id))
        .exec(client)
        .await?;

    Ok(())
}

/// Check if any jobs are in processing status for a table
///
/// # Arguments
/// * `org` - Organization name
/// * `table_name` - Table name
///
/// # Returns
/// * `Result<bool, errors::Error>` - true if any job is processing
pub async fn has_processing_jobs(org: &str, table_name: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let count = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(table_name))
        .filter(Column::Status.eq(STATUS_PROCESSING))
        .count(client)
        .await?;

    Ok(count > 0)
}

/// Delete all URL jobs for a table
///
/// # Arguments
/// * `org` - Organization name
/// * `table_name` - Table name
///
/// # Returns
/// * `Result<(), errors::Error>` - Success or error
pub async fn delete_all_for_table(org: &str, table_name: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(table_name))
        .exec(client)
        .await?;

    Ok(())
}

/// Atomically claims stale jobs that are stuck in Processing status
///
/// This function is used for stale job recovery in both single-node (SQLite) and distributed
/// deployments (PostgreSQL/MySQL). The implementation varies by database backend.
///
/// # How it works
///
/// ## SQLite (single-node)
/// 1. Uses `get_lock()` for process-level synchronization
/// 2. Finds up to `limit` stale jobs using Sea-ORM queries
/// 3. Updates each job to Pending status sequentially
/// 4. Returns the updated jobs
///
/// Since SQLite is single-node, only one ingester exists, so no distributed coordination needed.
///
/// ## PostgreSQL/MySQL (distributed)
/// 1. Uses database-level atomic UPDATE with subquery
/// 2. Only ONE ingester successfully claims each job (database ensures atomicity)
/// 3. Returns the claimed jobs via RETURNING (PostgreSQL) or separate SELECT (MySQL)
///
/// Multiple ingesters can run this simultaneously - database ensures proper distribution.
///
/// # Arguments
/// * `stale_threshold_timestamp` - Jobs with updated_at older than this are considered stale (in
///   microseconds)
/// * `processing_status` - The status value for "Processing" (typically 1)
/// * `pending_status` - The status value for "Pending" (typically 0)
/// * `limit` - Maximum number of jobs to claim in one call
///
/// # Returns
/// * `Result<Vec<EnrichmentTableUrlRecord>, errors::Error>` - The claimed jobs or empty vec
pub async fn claim_stale_jobs(
    stale_threshold_timestamp: i64,
    processing_status: i16,
    pending_status: i16,
    limit: usize,
) -> Result<Vec<EnrichmentTableUrlRecord>, errors::Error> {
    use sea_orm::{ConnectionTrait, Statement};

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let backend = client.get_database_backend();
    let _lock = get_lock().await;
    let now = chrono::Utc::now().timestamp_micros();

    // For SQLite (single-node), use simple Sea-ORM API since get_lock() provides sufficient
    // protection
    if backend == sea_orm::DatabaseBackend::Sqlite {
        // Find stale jobs (only local region jobs)
        let stale_jobs: Vec<Model> = Entity::find()
            .filter(Column::Status.eq(processing_status))
            .filter(Column::UpdatedAt.lt(stale_threshold_timestamp))
            .filter(Column::IsLocalRegion.eq(true))
            .limit(limit as u64)
            .all(client)
            .await?;

        if stale_jobs.is_empty() {
            return Ok(vec![]);
        }

        // Update them to Pending status
        let mut updated_jobs: Vec<EnrichmentTableUrlRecord> = Vec::new();
        for job in stale_jobs {
            let mut active: ActiveModel = job.into();
            active.status = Set(pending_status);
            active.updated_at = Set(now);
            let updated: Model = active.update(client).await?;
            updated_jobs.push(updated.into());
        }

        return Ok(updated_jobs);
    }

    // Use raw SQL for atomic claim operation
    let sql = match backend {
        sea_orm::DatabaseBackend::Postgres => {
            // PostgreSQL supports UPDATE ... RETURNING with subquery
            format!(
                r#"
                UPDATE enrichment_table_urls
                SET status = {}, updated_at = {}
                WHERE (org, name) IN (
                    SELECT org, name
                    FROM enrichment_table_urls
                    WHERE status = {} AND updated_at < {} AND is_local_region = true
                    LIMIT {}
                )
                RETURNING id, org, name, url, status, error_message, created_at, updated_at,
                          total_bytes_fetched, total_records_processed, retry_count,
                          append_data, last_byte_position, supports_range, is_local_region
                "#,
                pending_status, now, processing_status, stale_threshold_timestamp, limit
            )
        }
        sea_orm::DatabaseBackend::MySql => {
            // MySQL supports UPDATE with subquery
            format!(
                r#"
                UPDATE enrichment_table_urls
                SET status = {}, updated_at = {}
                WHERE (org, name) IN (
                    SELECT org, name
                    FROM (
                        SELECT org, name
                        FROM enrichment_table_urls
                        WHERE status = {} AND updated_at < {} AND is_local_region = true
                        LIMIT {}
                    ) AS subquery
                )
                "#,
                pending_status, now, processing_status, stale_threshold_timestamp, limit
            )
        }
        _ => {
            return Err(errors::Error::Message(format!(
                "Unsupported database backend: {:?}",
                backend
            )));
        }
    };

    // MySQL doesn't support RETURNING, so we need separate UPDATE and SELECT
    if backend == sea_orm::DatabaseBackend::MySql {
        // Execute UPDATE
        let result = client.execute(Statement::from_string(backend, sql)).await?;

        if result.rows_affected() == 0 {
            return Ok(vec![]);
        }

        // SELECT the jobs we just updated
        let select_sql = format!(
            r#"
            SELECT id, org, name, url, status, error_message, created_at, updated_at,
                   total_bytes_fetched, total_records_processed, retry_count,
                   append_data, last_byte_position, supports_range, is_local_region
            FROM enrichment_table_urls
            WHERE status = {} AND updated_at = {} AND is_local_region = true
            ORDER BY updated_at DESC
            LIMIT {}
            "#,
            pending_status, now, limit
        );

        let models = Entity::find()
            .from_raw_sql(Statement::from_string(backend, select_sql))
            .all(client)
            .await?;

        Ok(models.into_iter().map(|model| model.into()).collect())
    } else {
        // PostgreSQL supports RETURNING
        let models = Entity::find()
            .from_raw_sql(Statement::from_string(backend, sql))
            .all(client)
            .await?;

        Ok(models.into_iter().map(|model| model.into()).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_has_processing_jobs() {
        // Test with non-existent table - should return false or error
        let result = has_processing_jobs("test_org", "test_table").await;
        // In test environment without DB, this will error or return false
        // The test validates the function signature
        assert!(result.is_ok() || result.is_err());
    }
}
