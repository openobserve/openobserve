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

use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set, sea_query::Expr};
use tokio::sync::RwLock;

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

/// Whole-table cache.
///
/// The locations registry is routing configuration: a couple of dozen rows that
/// change only when an operator adds a region or an org creates a private
/// location. It was being re-read on the hottest paths in the product —
/// `dispatcher_pools()` ran `list_visible("")` **every 2 s** forever, and the
/// scheduler called `get()` once *per location per firing check* (~200/min at
/// 100 checks). See `docs/synthetics-lcl/2026-07-31-synthetics-caching-and-db-load.md`
/// P3/P4.
///
/// Caching the whole table rather than one entry per key is deliberate: every
/// read shape (`get` by id, `find_by_pool`, `list_visible` per org) is a
/// different view of the same tiny row set, so one load serves all three and
/// there is no per-key stampede to reason about.
///
/// TTL-based rather than event-invalidated: `coordinator::synthetics` does not
/// exist yet, so a short TTL is what bounds staleness across pods. Writes in
/// this module invalidate eagerly, so the TTL only covers changes made by a
/// *different* node.
/// The cached rows and the instant they were loaded, absent until first load.
type CachedLocations = Option<(Vec<SyntheticsLocationRecord>, Instant)>;

static LOCATIONS_CACHE: LazyLock<RwLock<CachedLocations>> = LazyLock::new(|| RwLock::new(None));

const LOCATIONS_CACHE_TTL: Duration = Duration::from_secs(30);

/// Drops the cached table. Called by every write path in this module so a
/// change made on *this* node is visible immediately rather than after the TTL.
pub async fn invalidate_cache() {
    *LOCATIONS_CACHE.write().await = None;
}

/// Invalidates locally **and** tells every other node. Write paths call this;
/// the coordinator watcher calls [`invalidate_cache`] so events do not echo.
async fn invalidate_and_publish() {
    invalidate_cache().await;
    if let Err(e) = crate::coordinator::synthetics::emit_locations_changed().await {
        log::error!("[synthetics] emit location cache event failed: {e}");
    }
}

/// Refreshes the cached table if it is missing or past its TTL.
///
/// Two callers racing a cold cache will both query and the second write wins —
/// harmless for an idempotent read, and cheaper than holding the write lock
/// across a DB round trip.
async fn ensure_fresh() -> Result<(), errors::Error> {
    if let Some((_, loaded_at)) = LOCATIONS_CACHE.read().await.as_ref()
        && loaded_at.elapsed() < LOCATIONS_CACHE_TTL
    {
        return Ok(());
    }

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let rows: Vec<SyntheticsLocationRecord> = Entity::find()
        .order_by_asc(Column::Kind)
        .order_by_asc(Column::Label)
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .into_iter()
        .map(Into::into)
        .collect();

    *LOCATIONS_CACHE.write().await = Some((rows, Instant::now()));
    Ok(())
}

/// Runs `f` over the cached rows, refreshing first if stale.
///
/// Callers project what they need under the read lock instead of cloning the
/// whole table — `get`/`find_by_pool` run on every scheduler tick and every
/// probe lease, so cloning ~20 records per call to return one would be the bulk
/// of the work this cache exists to avoid.
async fn with_cached<T>(
    f: impl FnOnce(&[SyntheticsLocationRecord]) -> T,
) -> Result<T, errors::Error> {
    ensure_fresh().await?;
    let guard = LOCATIONS_CACHE.read().await;
    let rows = guard.as_ref().map(|(r, _)| r.as_slice()).unwrap_or(&[]);
    Ok(f(rows))
}

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
        // A new location has never been notified as down.
        down_notified_at: Set(0),
        created_at: Set(record.created_at),
        updated_at: Set(record.updated_at),
    };
    Entity::insert(model)
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    // Release the SQLite write mutex BEFORE emitting. On a sqlite meta_store
    // the coordinator's put() takes the *same* CLIENT_RW lock `get_lock()`
    // returns, so emitting while holding it deadlocks the process — and the
    // mutex is then held forever, hanging every later synthetics query.
    drop(_lock);
    invalidate_and_publish().await;
    Ok(())
}

/// Locations visible to an org: all public rows + the org's private rows.
///
/// Served from the whole-table cache; the org filter is applied in Rust. Note
/// `list_visible("")` matches public rows only, which is how `dispatcher_pools()`
/// enumerates the public net pools.
pub async fn list_visible(org_id: &str) -> Result<Vec<SyntheticsLocationRecord>, errors::Error> {
    with_cached(|rows| {
        rows.iter()
            .filter(|r| match &r.org_id {
                None => true,
                Some(o) => o == org_id,
            })
            .cloned()
            .collect()
    })
    .await
}

/// All private rows across orgs — used by the staleness watcher.
pub async fn list_private() -> Result<Vec<SyntheticsLocationRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let rows = Entity::find()
        .filter(Column::Kind.eq(KIND_PRIVATE))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// Find one location by id. Served from the whole-table cache.
pub async fn get(id: &str) -> Result<Option<SyntheticsLocationRecord>, errors::Error> {
    with_cached(|rows| rows.iter().find(|r| r.id == id).cloned()).await
}

/// Find one location by its pool routing key. Served from the whole-table cache.
pub async fn find_by_pool(pool: &str) -> Result<Option<SyntheticsLocationRecord>, errors::Error> {
    with_cached(|rows| rows.iter().find(|r| r.pool == pool).cloned()).await
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
    // Release the SQLite write mutex BEFORE emitting. On a sqlite meta_store
    // the coordinator's put() takes the *same* CLIENT_RW lock `get_lock()`
    // returns, so emitting while holding it deadlocks the process — and the
    // mutex is then held forever, hanging every later synthetics query.
    drop(_lock);
    invalidate_and_publish().await;
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
    // Release the SQLite write mutex BEFORE emitting. On a sqlite meta_store
    // the coordinator's put() takes the *same* CLIENT_RW lock `get_lock()`
    // returns, so emitting while holding it deadlocks the process — and the
    // mutex is then held forever, hanging every later synthetics query.
    drop(_lock);
    invalidate_and_publish().await;
    Ok(())
}

/// Claims the right to send this location's "location down" notification,
/// returning whether THIS caller won it.
///
/// The staleness watcher runs on **every** scheduler node. Its suppression
/// flag used to be an in-process `HashSet`, so N nodes each decided
/// independently that they had not notified yet and N notifications went out for
/// one outage — repeating on every down → recover → down cycle.
///
/// `WHERE down_notified_at = 0` makes the transition a compare-and-swap: exactly
/// one node flips 0 → now and gets `rows_affected == 1`; the rest see 0 and stay
/// quiet. Same primitive as `synthetics_jobs::lease_batch` and
/// `synthetics_checks::try_claim_slot`.
///
/// Deliberately NOT cached — `LOCATIONS_CACHE` serves definition reads, and a
/// stale `down_notified_at` would reintroduce exactly the duplicate this fixes.
pub async fn try_claim_down_notification(id: &str, now_us: i64) -> Result<bool, errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::update_many()
        .col_expr(Column::DownNotifiedAt, Expr::value(now_us))
        .filter(Column::Id.eq(id))
        .filter(Column::DownNotifiedAt.eq(0i64))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(res.rows_affected > 0)
}

/// Clears the down flag so a future outage notifies again.
///
/// Idempotent and unguarded on purpose: every node may call this on recovery and
/// the result is the same. Guarding it would leave the flag set if the one node
/// that "won" the clear died before the next tick, silencing the next outage.
pub async fn clear_down_notification(id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update_many()
        .col_expr(Column::DownNotifiedAt, Expr::value(0i64))
        .filter(Column::Id.eq(id))
        .filter(Column::DownNotifiedAt.ne(0i64))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(())
}
