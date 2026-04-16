// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Service Routing Config Table Operations
//!
//! CRUD for operator-configured notification routing per service_streams row.
//! Upsert semantics: at most one config per (org_id, service_stream_id).

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set};
use svix_ksuid::KsuidLike;

use super::entity::service_routing_config;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

/// Get routing config for a specific service, if one exists.
pub async fn get(
    org_id: &str,
    service_stream_id: &str,
) -> Result<Option<service_routing_config::Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    service_routing_config::Entity::find()
        .filter(service_routing_config::Column::OrgId.eq(org_id))
        .filter(service_routing_config::Column::ServiceStreamId.eq(service_stream_id))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// List all routing configs for an org.
pub async fn list_by_org(
    org_id: &str,
) -> Result<Vec<service_routing_config::Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    service_routing_config::Entity::find()
        .filter(service_routing_config::Column::OrgId.eq(org_id))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Upsert routing config for a service.
///
/// Creates a new record or replaces the existing one for `(org_id, service_stream_id)`.
/// Returns the resulting model.
pub async fn upsert(
    org_id: &str,
    service_stream_id: &str,
    owner_emails: serde_json::Value,
    oncall_schedule_id: Option<String>,
    escalation_policy_id: Option<String>,
    notification_targets: serde_json::Value,
) -> Result<service_routing_config::Model, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();

    // Check if one already exists so we can preserve its id and created_at
    let existing = get(org_id, service_stream_id).await?;

    let (id, created_at) = match &existing {
        Some(e) => (e.id.clone(), e.created_at),
        None => (svix_ksuid::Ksuid::new(None, None).to_string(), now),
    };

    let model = service_routing_config::ActiveModel {
        id: Set(id),
        org_id: Set(org_id.to_string()),
        service_stream_id: Set(service_stream_id.to_string()),
        owner_emails: Set(owner_emails),
        oncall_schedule_id: Set(oncall_schedule_id),
        escalation_policy_id: Set(escalation_policy_id),
        notification_targets: Set(notification_targets),
        created_at: Set(created_at),
        updated_at: Set(now),
    };

    use sea_orm::ActiveModelTrait;
    model
        .insert(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Delete the routing config for a service. The service_streams row is untouched.
///
/// Returns `true` if a record was deleted, `false` if none existed.
pub async fn delete(org_id: &str, service_stream_id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let result = service_routing_config::Entity::delete_many()
        .filter(service_routing_config::Column::OrgId.eq(org_id))
        .filter(service_routing_config::Column::ServiceStreamId.eq(service_stream_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected > 0)
}
