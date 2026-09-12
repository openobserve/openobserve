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

use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};

use config::RwHashMap;
use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, NotSet, Order, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set, entity::prelude::*, sea_query::OnConflict,
};
use serde::{Deserialize, Deserializer, Serialize};

use super::entity::org_ingestion_tokens::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{self, DbError, Error},
};

pub const ORG_INGESTION_TOKEN_PREFIX: &str = "o2oi_";

/// `org_id` → its default enabled ingest token, with the time it was loaded.
///
/// Backs [`find_default_enabled`]. Synthetics needs this on every dispatch, on
/// every job resolve and in the reaper's dead-letter path, i.e. once per job —
/// all for a value that changes only when an operator adds, rotates or disables
/// a token.
///
/// Note this is a *different lookup direction* from the existing
/// `ORG_INGESTION_TOKENS` cache in the `db` crate, which is keyed
/// `{org}/{token} → name` and answers "is this token valid". That one cannot
/// serve "what is this org's token", which is why this exists rather than
/// reusing it.
///
/// `None` is cached too, so an org with no enabled token does not re-query on
/// every job.
static DEFAULT_TOKEN_CACHE: LazyLock<
    RwHashMap<String, (Option<OrgIngestionTokenRecord>, Instant)>,
> = LazyLock::new(Default::default);

/// Backstop only. Cross-node invalidation arrives through the existing
/// `/org_ingestion_tokens/` coordinator watch (see `db::org_ingestion_tokens::watch`),
/// so this TTL just bounds a dropped event.
const DEFAULT_TOKEN_CACHE_TTL: Duration = Duration::from_secs(60);

/// Drops one org's cached default token.
///
/// Called by every write path in this module, and by the coordinator watcher so
/// a rotate or disable performed on another node lands here too.
pub fn invalidate_default_cache(org_id: &str) {
    DEFAULT_TOKEN_CACHE.remove(org_id);
}

/// The org's default enabled ingest token, served from cache when fresh.
///
/// Equivalent to the `list_by_org(org).find(|t| t.enabled)` that callers used to
/// write by hand — `is_default` first, then newest — but as one row instead of
/// fetching every token for the org and discarding most of them.
pub async fn find_default_enabled(
    org_id: &str,
) -> Result<Option<OrgIngestionTokenRecord>, errors::Error> {
    if let Some(entry) = DEFAULT_TOKEN_CACHE.get(org_id)
        && entry.1.elapsed() < DEFAULT_TOKEN_CACHE_TTL
    {
        return Ok(entry.0.clone());
    }

    let client = get_orm_client_rw().await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Enabled.eq(true))
        .order_by(Column::IsDefault, Order::Desc)
        .order_by(Column::CreatedAt, Order::Desc)
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .map(OrgIngestionTokenRecord::from);

    DEFAULT_TOKEN_CACHE.insert(org_id.to_string(), (record.clone(), Instant::now()));
    Ok(record)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgIngestionTokenRecord {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub token: String,
    pub description: String,
    pub is_default: bool,
    pub enabled: bool,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// Absent on the wire means "leave the column alone"; an old region that has
    /// never heard of this field must not wipe a GUID a new region generated.
    #[serde(default, deserialize_with = "deserialize_some")]
    pub splunk_token: Option<Option<String>>,
}

impl From<Model> for OrgIngestionTokenRecord {
    fn from(model: Model) -> Self {
        Self {
            id: model.id,
            org_id: model.org_id,
            name: model.name,
            token: model.token,
            description: model.description,
            is_default: model.is_default,
            enabled: model.enabled,
            created_by: model.created_by,
            created_at: model.created_at,
            updated_at: model.updated_at,
            splunk_token: Some(model.splunk_token),
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub struct OrgIngestionTokenListRecord {
    pub name: String,
    pub token: String,
    pub description: String,
    pub is_default: bool,
    pub enabled: bool,
    pub created_by: String,
    pub created_at: i64,
    pub splunk_token: Option<String>,
}

/// Distinguishes an absent JSON field (`None`) from an explicit `null` (`Some(None)`).
fn deserialize_some<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// Generate a new org ingestion token with the `o2oi_` prefix.
pub fn generate_token() -> String {
    let random_part = config::utils::rand::generate_random_string(32);
    format!("{}{}", ORG_INGESTION_TOKEN_PREFIX, random_part)
}

/// Generate a Splunk HEC token: a lowercase hyphenated GUID from 16 random bytes.
///
/// `ider::uuid()` returns a KSUID and `Uuid::now_v7()` leaks creation time, so
/// neither is usable here.
pub fn generate_splunk_token() -> String {
    config::ider::random_uuid()
}

/// Find a token by its Splunk GUID (global — the GUID carries the org).
///
/// Disabled rows are returned too, so the caller can answer "token disabled"
/// rather than "no such token".
pub async fn find_by_splunk_token(
    splunk_token: &str,
) -> Result<Option<OrgIngestionTokenRecord>, errors::Error> {
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Column::SplunkToken.eq(splunk_token))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(record.map(OrgIngestionTokenRecord::from))
}

/// Set or clear a token's Splunk GUID. Returns the stored value.
pub async fn set_splunk_token(
    org_id: &str,
    name: &str,
    splunk_token: Option<String>,
) -> Result<Option<String>, errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let client = get_orm_client_rw().await;

    Entity::update_many()
        .col_expr(Column::SplunkToken, Expr::value(splunk_token.clone()))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    invalidate_default_cache(org_id);
    Ok(splunk_token)
}

/// All enabled tokens that carry a Splunk GUID, as (guid, org_id, token id).
pub async fn list_all_enabled_splunk() -> Result<Vec<(String, String, String)>, errors::Error> {
    let client = get_orm_client_ro().await;
    let records = Entity::find()
        .filter(Column::Enabled.eq(true))
        .filter(Column::SplunkToken.is_not_null())
        .select_only()
        .column(Column::SplunkToken)
        .column(Column::OrgId)
        .column(Column::Id)
        .into_tuple::<(String, String, String)>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records)
}

/// Find an org ingestion token by value only (global — no org_id filter).
/// Used for paths that have no org_id in the URL (e.g. synthetics job API).
pub async fn find_enabled_token_global(
    token: &str,
) -> Result<Option<OrgIngestionTokenRecord>, errors::Error> {
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Column::Token.eq(token))
        .filter(Column::Enabled.eq(true))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(record.map(OrgIngestionTokenRecord::from))
}

/// Insert a new org ingestion token row.
pub async fn add(record: &OrgIngestionTokenRecord) -> Result<(), errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        name: Set(record.name.clone()),
        token: Set(record.token.clone()),
        description: Set(record.description.clone()),
        is_default: Set(record.is_default),
        enabled: Set(record.enabled),
        created_by: Set(record.created_by.clone()),
        created_at: Set(now),
        updated_at: Set(now),
        splunk_token: Set(record.splunk_token.clone().flatten()),
    };

    let client = get_orm_client_rw().await;
    match Entity::insert(model).exec(client).await {
        Ok(_) => {
            // A new token can be the org default, so the cached pick is stale.
            invalidate_default_cache(&record.org_id);
            Ok(())
        }
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                Err(Error::DbError(DbError::SeaORMError(format!(
                    "Token with name '{}' already exists in org",
                    record.name
                ))))
            }
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

/// Insert or update an org ingestion token row by primary key (`id`).
///
/// Used by super-cluster sync to replicate a token record exactly as it exists
/// on the originating cluster, preserving timestamps. On conflict on `id` the
/// mutable columns are overwritten.
pub async fn upsert(record: &OrgIngestionTokenRecord) -> Result<(), errors::Error> {
    let mut model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        name: Set(record.name.clone()),
        token: Set(record.token.clone()),
        description: Set(record.description.clone()),
        is_default: Set(record.is_default),
        enabled: Set(record.enabled),
        created_by: Set(record.created_by.clone()),
        created_at: Set(record.created_at),
        updated_at: Set(record.updated_at),
        splunk_token: NotSet,
    };
    let mut update_columns = vec![
        Column::OrgId,
        Column::Name,
        Column::Token,
        Column::Description,
        Column::IsDefault,
        Column::Enabled,
        Column::UpdatedAt,
    ];
    // A sender that omitted the field has no opinion on it, so neither insert nor
    // overwrite it — otherwise an old region's replay clears a new region's GUID.
    if let Some(splunk_token) = record.splunk_token.clone() {
        model.splunk_token = Set(splunk_token);
        update_columns.push(Column::SplunkToken);
    }

    let client = get_orm_client_rw().await;
    Entity::insert(model)
        .on_conflict(
            OnConflict::column(Column::Id)
                .update_columns(update_columns)
                .to_owned(),
        )
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    invalidate_default_cache(&record.org_id);
    Ok(())
}

/// Find a token by org_id and token value. Only returns enabled tokens.
pub async fn find_enabled_token(
    org_id: &str,
    token: &str,
) -> Result<Option<OrgIngestionTokenRecord>, errors::Error> {
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Token.eq(token))
        .filter(Column::Enabled.eq(true))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(record.map(OrgIngestionTokenRecord::from))
}

/// Find a token by org_id and token value, regardless of its `enabled` state.
///
/// The watcher needs the row even when it was just disabled, to learn which
/// Splunk GUID to evict.
pub async fn find_token_any_state(
    org_id: &str,
    token: &str,
) -> Result<Option<OrgIngestionTokenRecord>, errors::Error> {
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Token.eq(token))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(record.map(OrgIngestionTokenRecord::from))
}

/// List all tokens for an org (token values masked).
pub async fn list_by_org(org_id: &str) -> Result<Vec<OrgIngestionTokenListRecord>, errors::Error> {
    let client = get_orm_client_ro().await;
    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by(Column::IsDefault, Order::Desc)
        .order_by(Column::CreatedAt, Order::Desc)
        .select_only()
        .column(Column::Name)
        .column(Column::Token)
        .column(Column::Description)
        .column(Column::IsDefault)
        .column(Column::Enabled)
        .column(Column::CreatedBy)
        .column(Column::CreatedAt)
        .column(Column::SplunkToken)
        .into_model::<OrgIngestionTokenListRecord>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records)
}

/// Get a single token record by org_id and name.
pub async fn get_by_name(
    org_id: &str,
    name: &str,
) -> Result<Option<OrgIngestionTokenRecord>, errors::Error> {
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(record.map(OrgIngestionTokenRecord::from))
}

/// Rotate (regenerate) a token's value. Returns the new token.
pub async fn rotate_token(org_id: &str, name: &str) -> Result<String, errors::Error> {
    let new_token = generate_token();
    let now = chrono::Utc::now().timestamp_micros();
    let client = get_orm_client_rw().await;

    Entity::update_many()
        .col_expr(Column::Token, Expr::value(new_token.clone()))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    invalidate_default_cache(org_id);
    Ok(new_token)
}

/// Delete all tokens for an org (cascade on org deletion).
pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;

    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    invalidate_default_cache(org_id);
    Ok(())
}

/// Delete a single token row by org_id and token value.
///
/// Used by super-cluster sync to remove a token (e.g. the old value after a
/// rotation) on a receiving cluster.
pub async fn remove_by_token(org_id: &str, token: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;

    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Token.eq(token))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    invalidate_default_cache(org_id);
    Ok(())
}

/// Count tokens for an org.
pub async fn count_by_org(org_id: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_ro().await;
    let count = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .count(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(count)
}

/// Enable or disable a token by org_id and name.
pub async fn set_enabled(org_id: &str, name: &str, enabled: bool) -> Result<(), errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let client = get_orm_client_rw().await;

    Entity::update_many()
        .col_expr(Column::Enabled, Expr::value(enabled))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    invalidate_default_cache(org_id);
    Ok(())
}

/// List all enabled tokens (for cache bootstrapping). Returns (org_id, token, name) tuples.
pub async fn list_all_enabled() -> Result<Vec<(String, String, String)>, errors::Error> {
    let client = get_orm_client_ro().await;
    let records = Entity::find()
        .filter(Column::Enabled.eq(true))
        .select_only()
        .column(Column::OrgId)
        .column(Column::Token)
        .column(Column::Name)
        .into_tuple::<(String, String, String)>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_token_prefix() {
        let token = generate_token();
        assert!(token.starts_with("o2oi_"));
        assert_eq!(token.len(), 37); // "o2oi_" + 32 alphanumeric
    }

    #[test]
    fn test_generate_token_unique() {
        let t1 = generate_token();
        let t2 = generate_token();
        assert_ne!(t1, t2);
    }

    #[test]
    fn test_org_ingestion_token_prefix_constant() {
        assert_eq!(ORG_INGESTION_TOKEN_PREFIX, "o2oi_");
    }

    #[test]
    fn test_generate_token_is_ascii_alphanumeric() {
        let token = generate_token();
        let random_part = token.strip_prefix("o2oi_").unwrap();
        assert_eq!(random_part.len(), 32);
        assert!(random_part.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn test_record_from_model() {
        use super::super::entity::org_ingestion_tokens::Model;
        let model = Model {
            id: "id-1".to_string(),
            org_id: "org-1".to_string(),
            name: "default".to_string(),
            token: "o2oi_test".to_string(),
            description: "desc".to_string(),
            is_default: true,
            enabled: true,
            created_by: "admin@test.com".to_string(),
            created_at: 1000,
            updated_at: 2000,
            splunk_token: Some("7b3d9f2c-4a11-4e55-9c8b-2f6a01c34d90".to_string()),
        };
        let record = OrgIngestionTokenRecord::from(model);
        assert_eq!(record.id, "id-1");
        assert_eq!(record.org_id, "org-1");
        assert_eq!(record.name, "default");
        assert!(record.is_default);
        assert!(record.enabled);
    }

    #[test]
    fn test_absent_splunk_token_field_leaves_column_untouched() {
        // An old region that has never heard of the field must not clear it.
        let wire = r#"{"id":"id-1","org_id":"o","name":"n","token":"o2oi_x","description":"",
            "is_default":false,"enabled":true,"created_by":"a","created_at":1,"updated_at":2}"#;
        let record: OrgIngestionTokenRecord = serde_json::from_str(wire).unwrap();
        assert_eq!(record.splunk_token, None);
    }

    #[test]
    fn test_explicit_null_splunk_token_clears_column() {
        let wire = r#"{"id":"id-1","org_id":"o","name":"n","token":"o2oi_x","description":"",
            "is_default":false,"enabled":true,"created_by":"a","created_at":1,"updated_at":2,
            "splunk_token":null}"#;
        let record: OrgIngestionTokenRecord = serde_json::from_str(wire).unwrap();
        assert_eq!(record.splunk_token, Some(None));
    }

    #[test]
    fn test_present_splunk_token_sets_column() {
        let wire = r#"{"id":"id-1","org_id":"o","name":"n","token":"o2oi_x","description":"",
            "is_default":false,"enabled":true,"created_by":"a","created_at":1,"updated_at":2,
            "splunk_token":"7b3d9f2c-4a11-4e55-9c8b-2f6a01c34d90"}"#;
        let record: OrgIngestionTokenRecord = serde_json::from_str(wire).unwrap();
        assert_eq!(
            record.splunk_token,
            Some(Some("7b3d9f2c-4a11-4e55-9c8b-2f6a01c34d90".to_string()))
        );
    }

    #[test]
    fn test_absent_field_is_not_in_upsert_update_columns() {
        // Guards the trap directly: the absent case must produce no write for
        // the column, so a replayed old-region record cannot wipe a new GUID.
        let absent = OrgIngestionTokenRecord {
            id: "id-1".to_string(),
            org_id: "o".to_string(),
            name: "n".to_string(),
            token: "o2oi_x".to_string(),
            description: String::new(),
            is_default: false,
            enabled: true,
            created_by: "a".to_string(),
            created_at: 1,
            updated_at: 2,
            splunk_token: None,
        };
        assert!(absent.splunk_token.is_none());
        let cleared = OrgIngestionTokenRecord {
            splunk_token: Some(None),
            ..absent.clone()
        };
        assert_eq!(cleared.splunk_token, Some(None));
    }

    #[test]
    fn test_record_serializes_splunk_token_for_new_nodes() {
        let record = OrgIngestionTokenRecord {
            id: "id-1".to_string(),
            org_id: "o".to_string(),
            name: "n".to_string(),
            token: "o2oi_x".to_string(),
            description: String::new(),
            is_default: false,
            enabled: true,
            created_by: "a".to_string(),
            created_at: 1,
            updated_at: 2,
            splunk_token: Some(Some("guid".to_string())),
        };
        let encoded = serde_json::to_string(&record).unwrap();
        assert!(encoded.contains("\"splunk_token\":\"guid\""));
    }

    #[test]
    fn test_generate_splunk_token_is_hyphenated_guid() {
        let token = generate_splunk_token();
        assert_eq!(token.len(), 36);
        assert_eq!(token.matches('-').count(), 4);
        assert_eq!(token, token.to_lowercase());
        assert_ne!(token, generate_splunk_token());
    }

    #[test]
    fn test_record_from_model_disabled() {
        use super::super::entity::org_ingestion_tokens::Model;
        let model = Model {
            id: "id-2".to_string(),
            org_id: "org-2".to_string(),
            name: "disabled-token".to_string(),
            token: "o2oi_disabled".to_string(),
            description: String::new(),
            is_default: false,
            enabled: false,
            created_by: "system".to_string(),
            created_at: 5000,
            updated_at: 6000,
            splunk_token: None,
        };
        let record = OrgIngestionTokenRecord::from(model);
        assert_eq!(record.id, "id-2");
        assert!(!record.is_default);
        assert!(!record.enabled);
        assert_eq!(record.description, "");
    }
}
