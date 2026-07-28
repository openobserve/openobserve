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

//! Synthetics probe token storage.
//!
//! `o2syn_` prefixed tokens scoped to the synthetics Job API
//! (`/synthetics/jobs/resolve`, `/ack`, `/lease`). Separate from
//! `org_ingestion_tokens` (`o2oi_`) which is write-only ingest.

use sea_orm::{
    ColumnTrait, EntityTrait, QueryFilter, Set, SqlErr, TransactionTrait, sea_query::Expr,
};

use super::{
    entity::synthetics_probe_tokens::{ActiveModel, Column, Entity, Model},
    get_lock,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

pub const SYNTHETICS_PROBE_TOKEN_PREFIX: &str = "o2syn_";

/// Name of the token every org starts with (backfilled / created at org
/// creation). Named tokens minted later carry their own operator-chosen name.
pub const DEFAULT_TOKEN_NAME: &str = "default";

#[derive(Debug, Clone)]
pub struct SyntheticsProbeTokenRecord {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub token: String,
    pub is_default: bool,
    pub enabled: bool,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Model> for SyntheticsProbeTokenRecord {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            org_id: m.org_id,
            name: m.name,
            token: m.token,
            is_default: m.is_default,
            enabled: m.enabled,
            created_by: m.created_by,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

pub fn generate_token() -> String {
    format!(
        "{}{}",
        SYNTHETICS_PROBE_TOKEN_PREFIX,
        config::utils::rand::generate_random_string(32)
    )
}

/// Insert a new probe token row. Fails with a clear message if a token with the
/// same `(org_id, name)` already exists (the unique constraint).
pub async fn add(record: &SyntheticsProbeTokenRecord) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let now = chrono::Utc::now().timestamp_micros();
    let model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        name: Set(record.name.clone()),
        token: Set(record.token.clone()),
        is_default: Set(record.is_default),
        enabled: Set(record.enabled),
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
                    "probe token '{}' already exists in org",
                    record.name
                ))))
            }
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

/// Find an enabled probe token by value (global — no org_id filter). The
/// validator uses this to authenticate the token; the handler then asserts the
/// token's org equals the `{org_id}` in the `/{org}/synthetics/{jobs,agent}/*`
/// path (the tenant boundary). Matches ANY enabled token, so old + new tokens
/// coexist during a rotation overlap window.
pub async fn find_global(token: &str) -> Result<Option<SyntheticsProbeTokenRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::Token.eq(token))
        .filter(Column::Enabled.eq(true))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(record.map(SyntheticsProbeTokenRecord::from))
}

/// Find the org's default enabled probe token — the one handed out by
/// `agent-setup` / install and injected into Lambda invokes by the dispatcher.
pub async fn find_default(
    org_id: &str,
) -> Result<Option<SyntheticsProbeTokenRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IsDefault.eq(true))
        .filter(Column::Enabled.eq(true))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(record.map(SyntheticsProbeTokenRecord::from))
}

/// List all probe tokens for an org (enabled + disabled), newest-default first.
/// Callers mask the token value before returning it to a UI.
pub async fn list_by_org(org_id: &str) -> Result<Vec<SyntheticsProbeTokenRecord>, errors::Error> {
    use sea_orm::{Order, QueryOrder};
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by(Column::IsDefault, Order::Desc)
        .order_by(Column::CreatedAt, Order::Desc)
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(records
        .into_iter()
        .map(SyntheticsProbeTokenRecord::from)
        .collect())
}

/// Get a single token by `(org_id, name)`.
pub async fn get_by_name(
    org_id: &str,
    name: &str,
) -> Result<Option<SyntheticsProbeTokenRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(record.map(SyntheticsProbeTokenRecord::from))
}

/// Enable or disable a token by `(org_id, name)`. Disabling is how a token is
/// revoked — because there is no validator cache for probe tokens, it takes
/// effect on the next request (no invalidation step needed).
pub async fn set_enabled(org_id: &str, name: &str, enabled: bool) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let now = chrono::Utc::now().timestamp_micros();
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update_many()
        .col_expr(Column::Enabled, Expr::value(enabled))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(())
}

/// Make `(org_id, name)` the org's sole default (clears `is_default` on every
/// other row of the org, in one transaction). Does NOT touch `enabled`, so the
/// previous default stays valid during a rotation overlap window until it is
/// explicitly disabled.
pub async fn set_default(org_id: &str, name: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let now = chrono::Utc::now().timestamp_micros();
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let txn = client
        .begin()
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Entity::update_many()
        .col_expr(Column::IsDefault, Expr::value(false))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .exec(&txn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Entity::update_many()
        .col_expr(Column::IsDefault, Expr::value(true))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .exec(&txn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    txn.commit()
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(())
}

/// Create the default probe token for a new org.
pub async fn create_for_org(org_id: &str, created_by: &str) -> Result<(), errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let record = SyntheticsProbeTokenRecord {
        id: config::ider::uuid(),
        org_id: org_id.to_owned(),
        name: DEFAULT_TOKEN_NAME.to_owned(),
        token: generate_token(),
        is_default: true,
        enabled: true,
        created_by: created_by.to_owned(),
        created_at: now,
        updated_at: now,
    };
    add(&record).await
}
