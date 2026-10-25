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

use std::sync::{
    Arc, LazyLock as Lazy,
    atomic::{AtomicU64, Ordering},
};

#[cfg(feature = "cloud")]
use config::utils::time::day_micros;
use config::{RwAHashMap, meta::organization::OrganizationType};
use hashbrown::HashMap;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, Order, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Schema, Set, TransactionTrait, entity::prelude::*,
};

use super::entity::organizations::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{self, DbError, Error},
};

const STATUS_DELETED: &str = "deleted";

static CACHE: Lazy<Arc<RwAHashMap<String, OrganizationRecord>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));
// Bumped under the cache lock by every invalidation, so a fill read before one is dropped.
static CACHE_EPOCH: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone)]
pub struct OrganizationRecord {
    pub identifier: String,
    pub org_name: String,
    pub org_type: OrganizationType,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    #[cfg(feature = "cloud")]
    pub trial_ends_at: i64,
}

impl OrganizationRecord {
    pub fn new(identifier: &str, org_name: &str, org_type: OrganizationType) -> Self {
        let now = chrono::Utc::now().timestamp_micros();
        Self {
            identifier: identifier.to_string(),
            org_name: org_name.to_string(),
            org_type,
            status: "active".to_string(),
            created_at: now,
            updated_at: now,
            deleted_at: None,
            #[cfg(feature = "cloud")]
            trial_ends_at: now + day_micros(14),
        }
    }
}

impl From<Model> for OrganizationRecord {
    fn from(model: Model) -> Self {
        Self {
            identifier: model.identifier,
            org_name: model.org_name,
            org_type: model.org_type.into(),
            status: model.status,
            created_at: model.created_at,
            updated_at: model.updated_at,
            deleted_at: model.deleted_at,
            #[cfg(feature = "cloud")]
            trial_ends_at: model.trial_ends_at,
        }
    }
}

// internal struct to pass filters to list orgs
#[derive(Default)]
pub struct ListFilter {
    pub created_after: Option<i64>,
    pub created_before: Option<i64>,
    pub limit: Option<i64>,
    pub exclude_deleted: bool,
}

impl ListFilter {
    pub fn with_limit(limit: Option<i64>) -> Self {
        Self {
            created_after: None,
            created_before: None,
            limit,
            exclude_deleted: false,
        }
    }
}

#[derive(FromQueryResult, Debug)]
pub struct OrgId {
    pub identifier: String,
}

/// A tombstone and its `updated_at`, which tells it apart from a later org with the same id.
#[derive(FromQueryResult, Debug, Clone, PartialEq)]
pub struct TombstoneRow {
    pub identifier: String,
    pub updated_at: i64,
}

#[derive(FromQueryResult, Debug)]
struct OrgStatusRow {
    status: String,
}

pub async fn create_table() -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    let builder = client.get_database_backend();

    let schema = Schema::new(builder);
    let create_table_stmt = schema
        .create_table_from_entity(Entity)
        .if_not_exists()
        .take();

    client
        .execute(builder.build(&create_table_stmt))
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn add(
    org_id: &str,
    org_name: &str,
    org_type: OrganizationType,
) -> Result<(), errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let record = ActiveModel {
        identifier: Set(org_id.to_string()),
        org_name: Set(org_name.to_string()),
        org_type: Set(org_type.into()),
        status: Set("active".to_string()),
        created_at: Set(now),
        updated_at: Set(now),
        deleted_at: Set(None),
        #[cfg(feature = "cloud")]
        trial_ends_at: Set(now + day_micros(15)),
    };

    let org = OrganizationRecord {
        identifier: org_id.to_string(),
        org_name: org_name.to_string(),
        org_type,
        status: "active".to_string(),
        created_at: now,
        updated_at: now,
        deleted_at: None,
        #[cfg(feature = "cloud")]
        trial_ends_at: now + day_micros(15),
    };

    let client = get_orm_client_rw().await;
    match Entity::insert(record).exec(client).await {
        Ok(_) => {
            let mut cache = CACHE.write().await;
            cache.insert(org_id.to_string(), org);
            Ok(())
        }
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => Ok(()),
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

#[cfg(feature = "cloud")]
pub async fn set_trial_period_end(org_id: &str, new_end: i64) -> Result<(), errors::Error> {
    let update_time = chrono::Utc::now().timestamp_micros();

    let client = get_orm_client_rw().await;
    Entity::update_many()
        .col_expr(Column::TrialEndsAt, Expr::value(new_end))
        .col_expr(Column::UpdatedAt, Expr::value(update_time))
        .filter(Column::Identifier.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    {
        let mut cache = CACHE.write().await;
        if let Some(v) = cache.get_mut(org_id) {
            v.updated_at = update_time;
            v.trial_ends_at = new_end;
        }
    }

    Ok(())
}

pub async fn rename(org_id: &str, new_name: &str) -> Result<(), errors::Error> {
    let update_time = chrono::Utc::now().timestamp_micros();

    let client = get_orm_client_rw().await;
    Entity::update_many()
        .col_expr(Column::OrgName, Expr::value(new_name.to_string()))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(chrono::Utc::now().timestamp_micros()),
        )
        .filter(Column::Identifier.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    {
        let mut cache = CACHE.write().await;
        if let Some(v) = cache.get_mut(org_id) {
            v.updated_at = update_time;
            v.org_name = new_name.to_string();
        }
    }

    Ok(())
}

pub async fn remove(org_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Identifier.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    {
        let mut cache = CACHE.write().await;
        cache.remove_entry(org_id);
    }

    Ok(())
}

pub async fn get(org_id: &str) -> Result<OrganizationRecord, errors::Error> {
    find(org_id)
        .await?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("Organization not found".to_string())))
}

/// Like `get`, but a missing row is `Ok(None)`, so only a failed read is an error.
pub async fn find(org_id: &str) -> Result<Option<OrganizationRecord>, errors::Error> {
    {
        let cache = CACHE.read().await;
        if let Some(v) = cache.get(org_id) {
            return Ok(Some(v.clone()));
        }
    }
    let epoch = cache_epoch();
    let Some(org) = find_in_db(get_orm_client_rw().await, org_id).await? else {
        return Ok(None);
    };
    fill_cache(org_id, org.clone(), epoch).await;
    Ok(Some(org))
}

/// The org row read from the database, bypassing the cache and leaving it untouched.
pub async fn get_from_db(org_id: &str) -> Result<OrganizationRecord, errors::Error> {
    find_in_db(get_orm_client_ro().await, org_id)
        .await?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("Organization not found".to_string())))
}

/// `get_from_db` on the writer, for a check that must not lag a status flip on a replica.
pub async fn get_on_writer(org_id: &str) -> Result<OrganizationRecord, errors::Error> {
    find_in_db(get_orm_client_rw().await, org_id)
        .await?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("Organization not found".to_string())))
}

pub async fn list(filter: ListFilter) -> Result<Vec<OrganizationRecord>, errors::Error> {
    let client = get_orm_client_ro().await;
    let mut res = Entity::find().order_by(Column::CreatedAt, Order::Desc);
    if let Some(limit) = filter.limit {
        res = res.limit(limit as u64);
    }
    if let Some(start) = filter.created_before {
        res = res.filter(Column::CreatedAt.lt(start));
    }
    if let Some(end) = filter.created_after {
        res = res.filter(Column::CreatedAt.gt(end))
    }
    if filter.exclude_deleted {
        res = res.filter(Column::Status.ne(STATUS_DELETED));
    }
    let records = res
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .into_iter()
        .map(OrganizationRecord::from)
        .collect();

    Ok(records)
}

pub async fn get_by_name(org_name: &str) -> Result<Vec<OrganizationRecord>, errors::Error> {
    let client = get_orm_client_ro().await;
    let records = Entity::find()
        .filter(Column::OrgName.eq(org_name))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .into_iter()
        .map(OrganizationRecord::from)
        .collect();

    Ok(records)
}

pub async fn len() -> usize {
    let client = get_orm_client_ro().await;
    let len = Entity::find().count(client).await;

    match len {
        Ok(len) => len as usize,
        Err(e) => {
            log::error!("organizations len error: {e}");
            0
        }
    }
}

pub async fn clear() -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn is_empty() -> bool {
    len().await == 0
}

pub async fn batch_remove(org_ids: Vec<String>) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Identifier.is_in(org_ids.clone()))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    {
        let mut cache = CACHE.write().await;
        for id in &org_ids {
            cache.remove_entry(id);
        }
    }

    Ok(())
}

pub async fn set_status(org_id: &str, status: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    let now = config::utils::time::now_micros();
    Entity::update_many()
        .col_expr(Column::Status, Expr::value(status))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::Identifier.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    invalidate_cache(Some(org_id)).await;
    Ok(())
}

/// CAS update: sets status to `new_status` only when current status is `expected_status`.
/// Returns `true` if the row was updated (i.e. this caller won the race), `false` if another
/// writer already changed the status.
pub async fn set_status_if(
    org_id: &str,
    expected_status: &str,
    new_status: &str,
) -> Result<bool, errors::Error> {
    let won = set_status_if_in(
        get_orm_client_rw().await,
        org_id,
        expected_status,
        new_status,
    )
    .await?;
    if won {
        invalidate_cache(Some(org_id)).await;
    }
    Ok(won)
}

/// `set_status_if` on a caller's connection; the caller invalidates the cache after commit.
pub async fn set_status_if_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    expected_status: &str,
    new_status: &str,
) -> Result<bool, errors::Error> {
    let now = config::utils::time::now_micros();
    let result = Entity::update_many()
        .col_expr(Column::Status, Expr::value(new_status))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::Identifier.eq(org_id))
        .filter(Column::Status.eq(expected_status))
        .exec(conn)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(result.rows_affected > 0)
}

/// CAS update that also sets `deleted_at` in the same statement. Sets status to
/// `new_status` (and `deleted_at` to the given value) only when the current status
/// is `expected_status`. Returns true if a row was updated.
pub async fn set_status_if_with_deleted_at(
    org_id: &str,
    expected_status: &str,
    new_status: &str,
    deleted_at: Option<i64>,
) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let now = config::utils::time::now_micros();
    let result = Entity::update_many()
        .col_expr(Column::Status, Expr::value(new_status))
        .col_expr(Column::DeletedAt, Expr::value(deleted_at))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::Identifier.eq(org_id))
        .filter(Column::Status.eq(expected_status))
        .exec(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    if result.rows_affected > 0 {
        invalidate_cache(Some(org_id)).await;
        Ok(true)
    } else {
        Ok(false)
    }
}

pub async fn list_ids_by_status(status: &str) -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_ro().await;
    Entity::find()
        .select_only()
        .column(Column::Identifier)
        .filter(Column::Status.eq(status))
        .into_tuple::<String>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// `list_ids_by_status` with each org's `deleted_at`.
pub async fn list_ids_and_deleted_at_by_status(
    status: &str,
) -> Result<Vec<(String, Option<i64>)>, errors::Error> {
    let client = get_orm_client_ro().await;
    Entity::find()
        .select_only()
        .column(Column::Identifier)
        .column(Column::DeletedAt)
        .filter(Column::Status.eq(status))
        .into_tuple::<(String, Option<i64>)>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Tombstones whose deletion finished (`updated_at`) before `before`.
pub async fn list_expired_tombstone_rows(before: i64) -> Result<Vec<TombstoneRow>, errors::Error> {
    let client = get_orm_client_ro().await;
    Entity::find()
        .select_only()
        .column(Column::Identifier)
        .column(Column::UpdatedAt)
        .filter(Column::Status.eq(STATUS_DELETED))
        .filter(Column::UpdatedAt.lt(before))
        .into_model::<TombstoneRow>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Deletes the org row only while it is the tombstone written at `updated_at`; the caller evicts.
pub async fn remove_tombstone_at(org_id: &str, updated_at: i64) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let result = Entity::delete_many()
        .filter(Column::Identifier.eq(org_id))
        .filter(Column::Status.eq(STATUS_DELETED))
        .filter(Column::UpdatedAt.eq(updated_at))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    invalidate_cache(Some(org_id)).await;
    Ok(result.rows_affected > 0)
}

/// The row's status read from the database, bypassing the cache; `None` when no row exists.
pub async fn get_status_uncached(org_id: &str) -> Result<Option<String>, errors::Error> {
    status_in(get_orm_client_ro().await, org_id).await
}

/// Flips a pending org to `deleting` only once its `deleted_at` is at or before `deleted_before`.
pub async fn promote_due_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    deleted_before: i64,
) -> Result<bool, errors::Error> {
    use crate::coordinator::org_status::{STATUS_DELETING, STATUS_PENDING_DELETION};

    let result = Entity::update_many()
        .col_expr(Column::Status, Expr::value(STATUS_DELETING))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(config::utils::time::now_micros()),
        )
        .filter(Column::Identifier.eq(org_id))
        .filter(Column::Status.eq(STATUS_PENDING_DELETION))
        .filter(Column::DeletedAt.lte(deleted_before))
        .exec(conn)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(result.rows_affected > 0)
}

/// Flips a pending org to active; returns the `deleted_at` it cleared, or None when not pending.
pub async fn restore_pending(org_id: &str) -> Result<Option<Option<i64>>, errors::Error> {
    use crate::coordinator::org_status::{STATUS_ACTIVE, STATUS_PENDING_DELETION};

    let db_err = |e: sea_orm::DbErr| Error::DbError(DbError::SeaORMError(e.to_string()));
    let txn = get_orm_client_rw().await.begin().await.map_err(db_err)?;
    let pending = Entity::find()
        .select_only()
        .column(Column::DeletedAt)
        .filter(Column::Identifier.eq(org_id))
        .filter(Column::Status.eq(STATUS_PENDING_DELETION))
        .into_tuple::<Option<i64>>()
        .one(&txn)
        .await
        .map_err(db_err)?;
    let Some(deleted_at) = pending else {
        txn.rollback().await.map_err(db_err)?;
        return Ok(None);
    };
    let restored = Entity::update_many()
        .col_expr(Column::Status, Expr::value(STATUS_ACTIVE))
        .col_expr(Column::DeletedAt, Expr::value(Option::<i64>::None))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(config::utils::time::now_micros()),
        )
        .filter(Column::Identifier.eq(org_id))
        .filter(Column::Status.eq(STATUS_PENDING_DELETION))
        .exec(&txn)
        .await
        .map_err(db_err)?;
    if restored.rows_affected == 0 {
        txn.rollback().await.map_err(db_err)?;
        return Ok(None);
    }
    txn.commit().await.map_err(db_err)?;
    invalidate_cache(Some(org_id)).await;
    Ok(Some(deleted_at))
}

pub async fn invalidate_cache(org_id: Option<&str>) {
    let mut cache = CACHE.write().await;
    CACHE_EPOCH.fetch_add(1, Ordering::AcqRel);
    if let Some(v) = org_id {
        cache.remove(v);
    } else {
        cache.drain();
    }
}

async fn find_in_db<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Option<OrganizationRecord>, errors::Error> {
    let record = Entity::find()
        .filter(Column::Identifier.eq(org_id))
        .one(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(record.map(OrganizationRecord::from))
}

async fn status_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Option<String>, errors::Error> {
    let row = Entity::find()
        .select_only()
        .column(Column::Status)
        .filter(Column::Identifier.eq(org_id))
        .into_model::<OrgStatusRow>()
        .one(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(row.map(|r| r.status))
}

fn cache_epoch() -> u64 {
    CACHE_EPOCH.load(Ordering::Acquire)
}

async fn fill_cache(org_id: &str, org: OrganizationRecord, epoch: u64) {
    let mut cache = CACHE.write().await;
    if CACHE_EPOCH.load(Ordering::Acquire) == epoch {
        cache.insert(org_id.to_string(), org);
    }
}

#[cfg(test)]
mod tests {
    use config::meta::organization::OrganizationType;

    use super::*;

    #[tokio::test]
    async fn test_a_fill_read_before_an_invalidation_is_dropped() {
        let org_id = "t-stale-fill";
        let epoch = cache_epoch();
        invalidate_cache(Some(org_id)).await;
        let stale = OrganizationRecord::new(org_id, org_id, OrganizationType::Default);
        fill_cache(org_id, stale, epoch).await;
        let cached = CACHE.write().await.remove(org_id).is_some();
        assert!(!cached, "a row read before the invalidation was cached");
    }

    #[test]
    fn test_organization_record_new_fields() {
        let rec = OrganizationRecord::new("org-1", "My Org", OrganizationType::Default);
        assert_eq!(rec.identifier, "org-1");
        assert_eq!(rec.org_name, "My Org");
        assert_eq!(rec.org_type, OrganizationType::Default);
        assert!(rec.created_at > 0);
        assert_eq!(rec.created_at, rec.updated_at);
    }

    #[test]
    fn test_organization_record_new_custom_type() {
        let rec = OrganizationRecord::new("acme", "Acme Corp", OrganizationType::Custom);
        assert_eq!(rec.identifier, "acme");
        assert_eq!(rec.org_type, OrganizationType::Custom);
    }

    #[test]
    fn test_list_filter_with_limit_some() {
        let f = ListFilter::with_limit(Some(50));
        assert_eq!(f.limit, Some(50));
        assert!(f.created_after.is_none());
        assert!(f.created_before.is_none());
    }

    #[test]
    fn test_list_filter_with_limit_none() {
        let f = ListFilter::with_limit(None);
        assert!(f.limit.is_none());
        assert!(f.created_after.is_none());
        assert!(f.created_before.is_none());
    }

    #[test]
    fn test_list_filter_default() {
        let f = ListFilter::default();
        assert!(f.limit.is_none());
        assert!(f.created_after.is_none());
        assert!(f.created_before.is_none());
    }

    #[test]
    #[cfg(not(feature = "cloud"))]
    fn test_from_model_to_organization_record() {
        use super::super::entity::organizations::Model;
        let model = Model {
            identifier: "test-org".to_string(),
            org_name: "Test Org".to_string(),
            org_type: 0,
            status: "active".to_string(),
            created_at: 1_000_000,
            updated_at: 2_000_000,
            deleted_at: None,
        };
        let rec = OrganizationRecord::from(model);
        assert_eq!(rec.identifier, "test-org");
        assert_eq!(rec.org_name, "Test Org");
        assert_eq!(rec.org_type, OrganizationType::Default);
        assert_eq!(rec.created_at, 1_000_000);
        assert_eq!(rec.updated_at, 2_000_000);
        assert!(rec.deleted_at.is_none());
    }

    #[test]
    fn test_organization_record_has_deleted_at_field() {
        let rec = OrganizationRecord {
            identifier: "o".to_string(),
            org_name: "o".to_string(),
            org_type: OrganizationType::Default,
            status: "active".to_string(),
            created_at: 1,
            updated_at: 2,
            deleted_at: None,
            #[cfg(feature = "cloud")]
            trial_ends_at: 0,
        };
        assert!(rec.deleted_at.is_none());
    }
}
