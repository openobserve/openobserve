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

//! Unified synthetics location registry.
//!
//! Public rows (`org_id` NULL) are o2-operated regions seeded/managed by ops;
//! private rows belong to one org and are managed via the Private Locations
//! CRUD. `pool` is the queue routing key the scheduler writes jobs into and
//! probes/agents lease from.

use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter, QueryOrder, Set, sea_query::Expr};

use super::{
    entity::synthetics_locations::{ActiveModel, Column, Entity, Model},
    get_lock,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

pub const KIND_PUBLIC: &str = "public";
pub const KIND_PRIVATE: &str = "private";

#[derive(Debug, Clone, serde::Serialize)]
pub struct SyntheticsLocationRecord {
    pub id: String,
    pub org_id: Option<String>,
    pub kind: String,
    pub provider: String,
    pub region: String,
    pub label: String,
    pub pool: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Model> for SyntheticsLocationRecord {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            org_id: m.org_id,
            kind: m.kind,
            provider: m.provider,
            region: m.region,
            label: m.label,
            pool: m.pool,
            enabled: m.enabled,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

/// Insert a new location row.
pub async fn add(record: &SyntheticsLocationRecord) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        kind: Set(record.kind.clone()),
        provider: Set(record.provider.clone()),
        region: Set(record.region.clone()),
        label: Set(record.label.clone()),
        pool: Set(record.pool.clone()),
        enabled: Set(record.enabled),
        created_at: Set(record.created_at),
        updated_at: Set(record.updated_at),
    };
    Entity::insert(model)
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(())
}

/// Locations visible to an org: all public rows + the org's private rows.
pub async fn list_visible(org_id: &str) -> Result<Vec<SyntheticsLocationRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let rows = Entity::find()
        .filter(
            Condition::any()
                .add(Column::OrgId.is_null())
                .add(Column::OrgId.eq(org_id)),
        )
        .order_by_asc(Column::Kind)
        .order_by_asc(Column::Label)
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// Find one location by id.
pub async fn get(id: &str) -> Result<Option<SyntheticsLocationRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let row = Entity::find_by_id(id)
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(row.map(Into::into))
}

/// Find one location by its pool routing key.
pub async fn find_by_pool(pool: &str) -> Result<Option<SyntheticsLocationRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let row = Entity::find()
        .filter(Column::Pool.eq(pool))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(row.map(Into::into))
}

/// Update label/enabled on a location.
pub async fn update(id: &str, label: &str, enabled: bool) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();
    Entity::update_many()
        .col_expr(Column::Label, Expr::value(label))
        .col_expr(Column::Enabled, Expr::value(enabled))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(())
}

/// Delete a location row.
pub async fn remove(id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_by_id(id)
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(())
}
