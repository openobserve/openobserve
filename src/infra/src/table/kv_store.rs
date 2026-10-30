// Copyright 2026 OpenObserve Inc.
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

use super::entity::kv_store::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// Gets a KV value by org_id and key
pub async fn get(org_id: &str, key: &str) -> Result<Option<Model>, errors::Error> {
    let client = get_orm_client_ro().await;
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
    let client = get_orm_client_rw().await;
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
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Key.eq(key))
        .exec(client)
        .await?;
    Ok(())
}

/// Lists all keys for an org_id with optional prefix filter
pub async fn list(org_id: &str, prefix: &str) -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_ro().await;

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

/// Every key of the org.
pub async fn list_keys_by_org(org_id: &str) -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_ro().await;
    let keys = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .select_only()
        .column(Column::Key)
        .into_tuple::<String>()
        .all(client)
        .await?;
    Ok(keys)
}

/// Clears all KV entries from the table
pub async fn clear() -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many().exec(client).await?;
    Ok(())
}

/// Deletes all KV entries belonging to the given org and returns their keys.
pub async fn delete_by_org(org_id: &str) -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_rw().await;
    let delete = Entity::delete_many().filter(Column::OrgId.eq(org_id));
    Ok(super::delete_returning(client, delete, &[Column::Key]).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_org_delete_returns_exactly_the_keys_it_removed() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let org = crate::table::testing::unique("t_kv");
        let other = format!("{org}_other");
        for (org, key) in [(&org, "a"), (&org, "b"), (&other, "a")] {
            set(org, key, b"v").await.unwrap();
        }

        let mut removed = delete_by_org(&org).await.unwrap();
        removed.sort();
        let left = list_keys_by_org(&org).await.unwrap();
        let kept = list_keys_by_org(&other).await.unwrap();
        delete_by_org(&other).await.unwrap();

        assert_eq!(removed, ["a", "b"]);
        assert!(left.is_empty());
        assert_eq!(kept, ["a"]);
    }
}
