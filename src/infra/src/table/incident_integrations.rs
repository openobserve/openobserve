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

//! External alert source integrations.
//!
//! `o2iat_` prefixed tokens identify an org's configured alert-source
//! integration (e.g. an "auto" default catch-all, or a named source) used by
//! the incident events ingestion endpoint. `incident_integration_senders`
//! tracks distinct upstream senders observed per integration for visibility.

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, SqlErr, sea_query::Expr};

use super::{
    entity::{
        incident_integration_senders::{
            ActiveModel as SenderActiveModel, Column as SenderColumn, Entity as SenderEntity,
            Model as SenderModel,
        },
        incident_integrations::{ActiveModel, Column, Entity, Model},
    },
    get_lock,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

pub const INCIDENT_INTEGRATION_TOKEN_PREFIX: &str = "o2iat_";

/// Name of the org's get-or-create default catch-all integration.
pub const DEFAULT_INTEGRATION_NAME: &str = "default";

#[derive(Debug, Clone)]
pub struct IncidentIntegrationRecord {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub source_type: String,
    pub token: String,
    pub enabled: bool,
    pub config: serde_json::Value,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Model> for IncidentIntegrationRecord {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            org_id: m.org_id,
            name: m.name,
            source_type: m.source_type,
            token: m.token,
            enabled: m.enabled,
            config: serde_json::from_str(&m.config).unwrap_or_else(|_| serde_json::json!({})),
            created_by: m.created_by,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SenderRecord {
    pub integration_id: String,
    pub detected_source: String,
    pub sender_label: Option<String>,
    pub first_received_at: i64,
    pub last_received_at: i64,
    pub accepted_count: i64,
    pub rejected_count: i64,
    pub resolved_seen: bool,
}

impl From<SenderModel> for SenderRecord {
    fn from(m: SenderModel) -> Self {
        Self {
            integration_id: m.integration_id,
            detected_source: m.detected_source,
            sender_label: m.sender_label,
            first_received_at: m.first_received_at,
            last_received_at: m.last_received_at,
            accepted_count: m.accepted_count,
            rejected_count: m.rejected_count,
            resolved_seen: m.resolved_seen,
        }
    }
}

pub fn generate_token() -> String {
    format!(
        "{}{}",
        INCIDENT_INTEGRATION_TOKEN_PREFIX,
        config::utils::rand::generate_random_string(32)
    )
}

/// Insert a new integration row. Fails with a clear message if the token is
/// already in use (the unique constraint).
pub async fn add(record: &IncidentIntegrationRecord) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let now = chrono::Utc::now().timestamp_micros();
    let model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        name: Set(record.name.clone()),
        source_type: Set(record.source_type.clone()),
        token: Set(record.token.clone()),
        enabled: Set(record.enabled),
        config: Set(record.config.to_string()),
        created_by: Set(record.created_by.clone()),
        created_at: Set(now),
        updated_at: Set(now),
    };
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match Entity::insert(model).exec(client).await {
        Ok(_) => Ok(()),
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                Err(Error::DbError(DbError::SeaORMError(format!(
                    "incident integration '{}' already exists in org",
                    record.name
                ))))
            }
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

/// Find an enabled integration by token value (global — no org_id filter). The
/// events ingestion handler uses this to authenticate the token.
pub async fn find_by_token(
    token: &str,
) -> Result<Option<IncidentIntegrationRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::Token.eq(token))
        .filter(Column::Enabled.eq(true))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(record.map(IncidentIntegrationRecord::from))
}

/// List all integrations for an org (enabled + disabled).
pub async fn list_by_org(org_id: &str) -> Result<Vec<IncidentIntegrationRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(records
        .into_iter()
        .map(IncidentIntegrationRecord::from)
        .collect())
}

/// Get-or-create the org's `auto` default integration named `"default"`.
pub async fn ensure_default_for_org(
    org_id: &str,
    created_by: &str,
) -> Result<IncidentIntegrationRecord, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let existing = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(DEFAULT_INTEGRATION_NAME))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    if let Some(m) = existing {
        return Ok(IncidentIntegrationRecord::from(m));
    }

    let now = chrono::Utc::now().timestamp_micros();
    let record = IncidentIntegrationRecord {
        id: config::ider::uuid(),
        org_id: org_id.to_owned(),
        name: DEFAULT_INTEGRATION_NAME.to_owned(),
        source_type: "auto".to_owned(),
        token: generate_token(),
        enabled: true,
        config: serde_json::json!({}),
        created_by: created_by.to_owned(),
        created_at: now,
        updated_at: now,
    };
    match add(&record).await {
        Ok(_) => Ok(record),
        Err(_) => {
            // Concurrent create raced us — re-fetch and return the winner.
            let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
            let winner = Entity::find()
                .filter(Column::OrgId.eq(org_id))
                .filter(Column::Name.eq(DEFAULT_INTEGRATION_NAME))
                .one(client)
                .await
                .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
                .ok_or_else(|| {
                    Error::DbError(DbError::SeaORMError(
                        "failed to create or find default incident integration".to_string(),
                    ))
                })?;
            Ok(IncidentIntegrationRecord::from(winner))
        }
    }
}

/// Enable or disable an integration by `(org_id, id)`.
pub async fn set_enabled(org_id: &str, id: &str, enabled: bool) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let now = chrono::Utc::now().timestamp_micros();
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update_many()
        .col_expr(Column::Enabled, Expr::value(enabled))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(())
}

/// Rotate an integration's token to a new random value, returning it.
pub async fn rotate_token(org_id: &str, id: &str) -> Result<String, errors::Error> {
    let _lock = get_lock().await;
    let new_token = generate_token();
    let now = chrono::Utc::now().timestamp_micros();
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update_many()
        .col_expr(Column::Token, Expr::value(new_token.clone()))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(new_token)
}

/// Parameters for [`touch_sender`] — bundled to keep the function's arg count
/// reasonable now that sender rows also carry a derived label.
#[derive(Debug, Clone, Copy)]
pub struct TouchSenderParams<'a> {
    pub integration_id: &'a str,
    pub detected_source: &'a str,
    pub sender_label: Option<&'a str>,
    pub now: i64,
    pub accepted: u32,
    pub rejected: u32,
    pub saw_resolved: bool,
}

/// Upsert an observed sender row for an integration: increments counters, sets
/// `last_received_at`, and ORs `resolved_seen`.
pub async fn touch_sender(params: TouchSenderParams<'_>) -> Result<(), errors::Error> {
    let TouchSenderParams {
        integration_id,
        detected_source,
        sender_label,
        now,
        accepted,
        rejected,
        saw_resolved,
    } = params;

    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut existing_query = SenderEntity::find()
        .filter(SenderColumn::IntegrationId.eq(integration_id))
        .filter(SenderColumn::DetectedSource.eq(detected_source));
    existing_query = match sender_label {
        Some(label) => existing_query.filter(SenderColumn::SenderLabel.eq(label)),
        None => existing_query.filter(SenderColumn::SenderLabel.is_null()),
    };
    let existing = existing_query
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    if let Some(existing) = existing {
        return update_sender(
            client,
            params.with_saw_resolved(saw_resolved || existing.resolved_seen),
        )
        .await;
    }

    let model = SenderActiveModel {
        id: Set(config::ider::uuid()),
        integration_id: Set(integration_id.to_owned()),
        detected_source: Set(detected_source.to_owned()),
        sender_label: Set(sender_label.map(|s| s.to_owned())),
        first_received_at: Set(now),
        last_received_at: Set(now),
        accepted_count: Set(accepted as i64),
        rejected_count: Set(rejected as i64),
        resolved_seen: Set(saw_resolved),
    };
    match SenderEntity::insert(model).exec(client).await {
        Ok(_) => Ok(()),
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                // Concurrent insert raced us — fall back to the update path.
                update_sender(client, params).await
            }
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

impl<'a> TouchSenderParams<'a> {
    fn with_saw_resolved(self, saw_resolved: bool) -> Self {
        Self {
            saw_resolved,
            ..self
        }
    }
}

async fn update_sender(
    client: &sea_orm::DatabaseConnection,
    params: TouchSenderParams<'_>,
) -> Result<(), errors::Error> {
    let TouchSenderParams {
        integration_id,
        detected_source,
        sender_label,
        now,
        accepted,
        rejected,
        saw_resolved: resolved_seen,
    } = params;

    let mut query = SenderEntity::update_many()
        .col_expr(
            SenderColumn::AcceptedCount,
            Expr::col(SenderColumn::AcceptedCount).add(accepted as i64),
        )
        .col_expr(
            SenderColumn::RejectedCount,
            Expr::col(SenderColumn::RejectedCount).add(rejected as i64),
        )
        .col_expr(SenderColumn::LastReceivedAt, Expr::value(now))
        .col_expr(SenderColumn::ResolvedSeen, Expr::value(resolved_seen))
        .filter(SenderColumn::IntegrationId.eq(integration_id))
        .filter(SenderColumn::DetectedSource.eq(detected_source));
    query = match sender_label {
        Some(label) => query.filter(SenderColumn::SenderLabel.eq(label)),
        None => query.filter(SenderColumn::SenderLabel.is_null()),
    };
    query
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(())
}

/// Delete an integration and its companion sender rows. There is no FK/cascade
/// on `incident_integration_senders` or `external_alerts.integration_id`, so
/// sender rows are removed manually here; `external_alerts` history rows are
/// deliberately left in place (audit trail — they retain their own org/data
/// and don't block re-listing).
///
/// Returns `Ok(false)` if no matching row was found (already deleted / wrong
/// org), `Ok(true)` on success.
pub async fn delete(org_id: &str, id: &str) -> Result<bool, errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let existing = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    let Some(existing) = existing else {
        return Ok(false);
    };

    SenderEntity::delete_many()
        .filter(SenderColumn::IntegrationId.eq(id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(existing.id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(true)
}

/// List all observed senders for an integration.
pub async fn list_senders(integration_id: &str) -> Result<Vec<SenderRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = SenderEntity::find()
        .filter(SenderColumn::IntegrationId.eq(integration_id))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(records.into_iter().map(SenderRecord::from).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_token_shape() {
        let t = generate_token();
        assert!(t.starts_with(INCIDENT_INTEGRATION_TOKEN_PREFIX));
        assert_eq!(t.len(), INCIDENT_INTEGRATION_TOKEN_PREFIX.len() + 32);
        assert_ne!(generate_token(), generate_token());
    }

    #[test]
    fn test_record_from_model_parses_config_json() {
        let m = super::super::entity::incident_integrations::Model {
            id: "i1".into(),
            org_id: "o1".into(),
            name: "default".into(),
            source_type: "auto".into(),
            token: "o2iat_x".into(),
            enabled: true,
            config: r#"{"destinations":["slack"]}"#.into(),
            created_by: "a@b.c".into(),
            created_at: 1,
            updated_at: 1,
        };
        let r = IncidentIntegrationRecord::from(m);
        assert_eq!(r.config["destinations"][0], "slack");
    }

    #[test]
    fn test_record_from_model_bad_config_defaults_empty_object() {
        let m = super::super::entity::incident_integrations::Model {
            id: "i1".into(),
            org_id: "o1".into(),
            name: "default".into(),
            source_type: "auto".into(),
            token: "o2iat_x".into(),
            enabled: true,
            config: "not-json".into(),
            created_by: "a@b.c".into(),
            created_at: 1,
            updated_at: 1,
        };
        let r = IncidentIntegrationRecord::from(m);
        assert!(r.config.is_object() && r.config.as_object().unwrap().is_empty());
    }
}
