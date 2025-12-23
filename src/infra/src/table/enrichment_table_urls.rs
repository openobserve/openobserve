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

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, entity::prelude::*};
use serde::{Deserialize, Serialize};

use super::get_lock;
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
}

impl From<Model> for EnrichmentTableUrlRecord {
    fn from(model: Model) -> Self {
        Self {
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

    // Try to find existing record
    let existing = Entity::find()
        .filter(Column::Org.eq(&record.org))
        .filter(Column::Name.eq(&record.name))
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
        active.update(client).await?;
    } else {
        // Insert new record
        let active = ActiveModel {
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
            ..Default::default()
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

/// Atomically claims stale jobs that are stuck in Processing status
///
/// This function is used for stale job recovery in distributed deployments (PostgreSQL/MySQL).
/// It uses database-level atomic operations to ensure only ONE ingester claims each stale job.
///
/// # Important: SQLite is NOT supported
///
/// This function returns an error if called with SQLite backend. SQLite is only used in
/// single-node deployments where there's only one ingester, so distributed job claiming
/// is not needed.
///
/// # How it works (PostgreSQL/MySQL only)
///
/// 1. Finds jobs in Processing status where updated_at < stale_threshold
/// 2. Selects up to `limit` jobs (LIMIT N)
/// 3. Atomically updates their status to Pending and updated_at to now
/// 4. Returns the claimed jobs (or empty vec if no stale jobs exist)
///
/// The SELECT and UPDATE happen atomically, so only one ingester succeeds per job.
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

    // SQLite doesn't need distributed job claiming - only one ingester in single-node mode
    if backend == sea_orm::DatabaseBackend::Sqlite {
        return Err(errors::Error::Message(
            "Stale job claiming is not supported for SQLite backend. SQLite is single-node only."
                .to_string(),
        ));
    }

    let _lock = get_lock().await;
    let now = chrono::Utc::now().timestamp_micros();

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
                    WHERE status = {} AND updated_at < {}
                    LIMIT {}
                )
                RETURNING id, org, name, url, status, error_message, created_at, updated_at,
                          total_bytes_fetched, total_records_processed, retry_count,
                          append_data, last_byte_position, supports_range
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
                        WHERE status = {} AND updated_at < {}
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
                   append_data, last_byte_position, supports_range
            FROM enrichment_table_urls
            WHERE status = {} AND updated_at = {}
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
