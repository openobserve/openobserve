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

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect, Set};

use super::{
    entity::kv_store::{ActiveModel, Column, Entity, Model},
    get_lock,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// Gets a KV value by org_id and key
pub async fn get(org_id: &str, key: &str) -> Result<Option<Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let kv_entry = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Key.eq(key))
        .one(client)
        .await?;
    Ok(kv_entry)
}

/// Sets a KV value (upsert: insert or update)
pub async fn set(org_id: &str, key: &str, value: &[u8]) -> Result<(), errors::Error> {
    // Get client first, then acquire lock to prevent deadlock
    // (get_or_init may internally acquire locks during connection)
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database (only for sqlite)
    let _lock = get_lock().await;
    let now = chrono::Utc::now().timestamp_micros();

    let active_model = ActiveModel {
        org_id: Set(org_id.to_string()),
        key: Set(key.to_string()),
        value: Set(value.to_vec()),
        created_at: Set(now),
        updated_at: Set(now),
    };

    // Use insert with on_conflict to handle upsert
    Entity::insert(active_model)
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([Column::OrgId, Column::Key])
                .update_columns([Column::Value, Column::UpdatedAt])
                .to_owned(),
        )
        .exec(client)
        .await?;

    Ok(())
}

/// Deletes a KV entry by org_id and key
pub async fn delete(org_id: &str, key: &str) -> Result<(), errors::Error> {
    // Get client first, then acquire lock to prevent deadlock
    // (get_or_init may internally acquire locks during connection)
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database (only for sqlite)
    let _lock = get_lock().await;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Key.eq(key))
        .exec(client)
        .await?;
    Ok(())
}

/// Lists all keys for an org_id with optional prefix filter
pub async fn list(org_id: &str, prefix: &str) -> Result<Vec<String>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .select_only()
        .column(Column::Key);

    // Add prefix filter if provided
    if !prefix.is_empty() {
        let prefix_pattern = format!("{}%", prefix);
        query = query.filter(Column::Key.like(&prefix_pattern));
    }

    let keys = query.into_tuple::<String>().all(client).await?;

    Ok(keys)
}

/// Clears all KV entries from the table
pub async fn clear() -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database (only for sqlite)
    let _lock = get_lock().await;
    Entity::delete_many().exec(client).await?;
    Ok(())
}
