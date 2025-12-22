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
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

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
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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
