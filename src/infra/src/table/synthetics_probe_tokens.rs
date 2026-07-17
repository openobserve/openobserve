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

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set};

use super::{
    entity::synthetics_probe_tokens::{ActiveModel, Column, Entity},
    get_lock,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

pub const SYNTHETICS_PROBE_TOKEN_PREFIX: &str = "o2syn_";

#[derive(Debug, Clone)]
pub struct SyntheticsProbeTokenRecord {
    pub id: String,
    pub org_id: String,
    pub token: String,
    pub enabled: bool,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn generate_token() -> String {
    format!(
        "{}{}",
        SYNTHETICS_PROBE_TOKEN_PREFIX,
        config::utils::rand::generate_random_string(32)
    )
}

/// Insert a new probe token row.
pub async fn add(record: &SyntheticsProbeTokenRecord) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let now = chrono::Utc::now().timestamp_micros();
    let model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        token: Set(record.token.clone()),
        enabled: Set(record.enabled),
        created_by: Set(record.created_by.clone()),
        created_at: Set(now),
        updated_at: Set(now),
    };
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(model)
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(())
}

/// Find an enabled probe token by value (global — no org_id filter).
/// Used by the validator on `/synthetics/jobs/*` paths (no org_id in URL).
pub async fn find_global(token: &str) -> Result<Option<SyntheticsProbeTokenRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::Token.eq(token))
        .filter(Column::Enabled.eq(true))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(record.map(|m| SyntheticsProbeTokenRecord {
        id: m.id,
        org_id: m.org_id,
        token: m.token,
        enabled: m.enabled,
        created_by: m.created_by,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }))
}

/// List all enabled probe tokens for an org.
/// Used by the dispatcher to find the token to include in a Lambda invoke.
pub async fn find_by_org(
    org_id: &str,
) -> Result<Option<SyntheticsProbeTokenRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Enabled.eq(true))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(record.map(|m| SyntheticsProbeTokenRecord {
        id: m.id,
        org_id: m.org_id,
        token: m.token,
        enabled: m.enabled,
        created_by: m.created_by,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }))
}

/// Create the default probe token for a new org.
pub async fn create_for_org(org_id: &str, created_by: &str) -> Result<(), errors::Error> {
    let record = SyntheticsProbeTokenRecord {
        id: config::ider::uuid(),
        org_id: org_id.to_owned(),
        token: generate_token(),
        enabled: true,
        created_by: created_by.to_owned(),
        created_at: chrono::Utc::now().timestamp_micros(),
        updated_at: chrono::Utc::now().timestamp_micros(),
    };
    add(&record).await
}
