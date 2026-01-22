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

use config::utils::time::now_micros;
use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, Order, QueryFilter, QueryOrder, QuerySelect, Set,
    entity::prelude::*,
};
use serde::{Deserialize, Serialize};

use super::get_lock;
// Re-export the entity for convenience
pub use crate::table::entity::enrichment_tables::{ActiveModel, Column, Entity, Model, Relation};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

#[derive(FromQueryResult, Debug, Serialize, Deserialize)]
pub struct EnrichmentTableRecord {
    pub org: String,
    pub name: String,
    pub data: Vec<u8>,
    pub created_at: i64,
}

#[derive(FromQueryResult, Debug, Serialize, Deserialize)]
pub struct EnrichmentTableOrgName {
    pub org: String,
    pub name: String,
}

impl EnrichmentTableRecord {
    pub fn new(org: &str, name: &str, data: Vec<u8>) -> Self {
        Self {
            org: org.to_string(),
            name: name.to_string(),
            data,
            created_at: now_micros(),
        }
    }
}

/// Add a new enrichment table record
///
/// # Arguments
/// * `org` - Organization name
/// * `table_name` - Table name
/// * `payload` - Binary data payload as Vec<u8>
/// * `created_at` - Timestamp of the record creation
///
/// # Returns
/// * `Result<(), errors::Error>` - Success or error
pub async fn add(
    org: &str,
    table_name: &str,
    payload: Vec<u8>,
    created_at: i64,
) -> Result<(), errors::Error> {
    let record = ActiveModel {
        org: Set(org.to_string()),
        name: Set(table_name.to_string()),
        data: Set(payload),
        created_at: Set(created_at),
        ..Default::default()
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

/// Delete all enrichment table records for a specific organization and table name
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

/// Get all enrichment table records for a specific organization and table name
///
/// # Arguments
/// * `org` - Organization name
/// * `table_name` - Table name
///
/// # Returns
/// * `Result<Vec<EnrichmentTableRecord>, errors::Error>` - List of records or error
pub async fn get_by_org_and_name(
    org: &str,
    table_name: &str,
) -> Result<Vec<EnrichmentTableRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .select_only()
        .column(Column::Org)
        .column(Column::Name)
        .column(Column::Data)
        .column(Column::CreatedAt)
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(table_name))
        .order_by(Column::CreatedAt, Order::Desc)
        .into_model::<EnrichmentTableRecord>()
        .all(client)
        .await?;

    Ok(records)
}

/// Get enrichment table records for a specific organization and table name with optional end time
/// filter
///
/// # Arguments
/// * `org` - Organization name
/// * `table_name` - Table name
/// * `end_time_exclusive` - Optional end time (exclusive). If provided, only returns records where
///   created_at < end_time_exclusive
///
/// # Returns
/// * `Result<Vec<EnrichmentTableRecord>, errors::Error>` - List of records or error
///
/// # Note
/// The end_time is exclusive, meaning records with created_at >= end_time_exclusive are not
/// included. This aligns with search time ranges where end_time is exclusive.
pub async fn get_by_org_and_name_with_end_time(
    org: &str,
    table_name: &str,
    end_time_exclusive: Option<i64>,
) -> Result<Vec<EnrichmentTableRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut query = Entity::find()
        .select_only()
        .column(Column::Org)
        .column(Column::Name)
        .column(Column::Data)
        .column(Column::CreatedAt)
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(table_name));

    // Add end_time filter if provided
    // created_at < end_time_exclusive (exclusive upper bound)
    if let Some(end_time) = end_time_exclusive {
        query = query.filter(Column::CreatedAt.lt(end_time));
    }

    let records = query
        .order_by(Column::CreatedAt, Order::Desc)
        .into_model::<EnrichmentTableRecord>()
        .all(client)
        .await?;

    Ok(records)
}

/// Get all enrichment table records for a specific organization
///
/// # Arguments
/// * `org` - Organization name
///
/// # Returns
/// * `Result<Vec<EnrichmentTableRecord>, errors::Error>` - List of records or error
pub async fn get_by_org(org: &str) -> Result<Vec<EnrichmentTableRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .select_only()
        .column(Column::Org)
        .column(Column::Name)
        .column(Column::Data)
        .column(Column::CreatedAt)
        .filter(Column::Org.eq(org))
        .order_by(Column::CreatedAt, Order::Desc)
        .into_model::<EnrichmentTableRecord>()
        .all(client)
        .await?;

    Ok(records)
}

/// Check if any enrichment table records exist for a specific organization and table name
///
/// # Arguments
/// * `org` - Organization name
/// * `table_name` - Table name
///
/// # Returns
/// * `Result<bool, errors::Error>` - True if records exist, false otherwise
pub async fn contains(org: &str, table_name: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(table_name))
        .into_model::<EnrichmentTableRecord>()
        .one(client)
        .await?;

    Ok(record.is_some())
}

/// Get the count of enrichment table records for a specific organization and table name
///
/// # Arguments
/// * `org` - Organization name
/// * `table_name` - Table name
///
/// # Returns
/// * `Result<usize, errors::Error>` - Count of records
pub async fn count_by_org_and_name(org: &str, table_name: &str) -> Result<usize, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let count = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(table_name))
        .count(client)
        .await?;

    Ok(count as usize)
}

/// Get the total count of enrichment table records
///
/// # Returns
/// * `Result<usize, errors::Error>` - Total count of records
pub async fn count() -> Result<usize, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let count = Entity::find().count(client).await?;

    Ok(count as usize)
}

/// Clear all enrichment table records
///
/// # Returns
/// * `Result<(), errors::Error>` - Success or error
pub async fn clear() -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}

/// Check if the enrichment tables table is empty
///
/// # Returns
/// * `Result<bool, errors::Error>` - True if empty, false otherwise
pub async fn is_empty() -> Result<bool, errors::Error> {
    let count = count().await?;
    Ok(count == 0)
}

/// List all the unique (org_id, table_name) pairs present in the table
///
/// # Returns
/// * `Result<Vec<(String, String)>, errors::Error>` - List of (org_id, table_name) pairs
pub async fn list() -> Result<Vec<(String, String)>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .select_only()
        .column(Column::Org)
        .column(Column::Name)
        .distinct()
        .into_model::<EnrichmentTableOrgName>()
        .all(client)
        .await?;
    Ok(records
        .iter()
        .map(|r| (r.org.clone(), r.name.clone()))
        .collect())
}
