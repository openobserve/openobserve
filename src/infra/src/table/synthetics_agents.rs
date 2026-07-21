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

//! Liveness registry of synthetics agent processes.
//!
//! One row per agent process serving a location. Upserted by
//! `/synthetics/agent/register`; `last_seen_at` refreshed by register and by
//! every job lease. A location whose agents are all stale is reported "down".

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set, sea_query::Expr};

use super::{
    entity::synthetics_agents::{ActiveModel, Column, Entity, Model},
    get_lock,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

#[derive(Debug, Clone)]
pub struct SyntheticsAgentRecord {
    pub id: String,
    pub org_id: String,
    pub location_id: String,
    pub name: String,
    pub version: Option<String>,
    pub capabilities: Option<serde_json::Value>,
    pub last_seen_at: i64,
    pub created_at: i64,
}

impl From<Model> for SyntheticsAgentRecord {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            org_id: m.org_id,
            location_id: m.location_id,
            name: m.name,
            version: m.version,
            capabilities: m.capabilities,
            last_seen_at: m.last_seen_at,
            created_at: m.created_at,
        }
    }
}

/// Insert an agent row, or refresh version/capabilities/last_seen_at when the
/// id already exists (idempotent re-register after restart).
pub async fn register(record: &SyntheticsAgentRecord) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let existing = Entity::find_by_id(&record.id)
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    match existing {
        Some(_) => {
            Entity::update_many()
                .col_expr(Column::Name, Expr::value(record.name.clone()))
                .col_expr(Column::Version, Expr::value(record.version.clone()))
                .col_expr(
                    Column::Capabilities,
                    Expr::value(record.capabilities.clone()),
                )
                .col_expr(Column::LastSeenAt, Expr::value(record.last_seen_at))
                .filter(Column::Id.eq(&record.id))
                .exec(client)
                .await
                .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
        }
        None => {
            let model = ActiveModel {
                id: Set(record.id.clone()),
                org_id: Set(record.org_id.clone()),
                location_id: Set(record.location_id.clone()),
                name: Set(record.name.clone()),
                version: Set(record.version.clone()),
                capabilities: Set(record.capabilities.clone()),
                last_seen_at: Set(record.last_seen_at),
                created_at: Set(record.created_at),
            };
            Entity::insert(model)
                .exec(client)
                .await
                .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
        }
    }
    Ok(())
}

/// Refresh `last_seen_at` for an agent (called on heartbeat and every lease).
pub async fn touch(agent_id: &str, now_us: i64) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update_many()
        .col_expr(Column::LastSeenAt, Expr::value(now_us))
        .filter(Column::Id.eq(agent_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(())
}

/// All agents serving a location, most recently seen first.
pub async fn list_by_location(
    location_id: &str,
) -> Result<Vec<SyntheticsAgentRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let rows = Entity::find()
        .filter(Column::LocationId.eq(location_id))
        .order_by_desc(Column::LastSeenAt)
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// Find one agent by id.
pub async fn get(agent_id: &str) -> Result<Option<SyntheticsAgentRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let row = Entity::find_by_id(agent_id)
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(row.map(Into::into))
}
