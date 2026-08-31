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

use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};

use config::RwHashMap;
use sea_orm::{
    ColumnTrait, EntityTrait, QueryFilter, Set, SqlErr, TransactionTrait, sea_query::Expr,
};

use super::entity::synthetics_probe_tokens::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{self, DbError, Error},
};

pub const SYNTHETICS_PROBE_TOKEN_PREFIX: &str = "o2syn_";

/// Token → lookup result, with the time it was loaded.
///
/// `find_global` runs in the auth middleware on **every** probe request
/// (`api/common/src/auth/validator.rs`), so it fired once per lease, resolve and
/// ack — the single highest-frequency query in the feature, always for the same
/// handful of token strings.
///
/// `None` is cached as well as `Some`: an unknown or disabled token must not be
/// able to force a DB round trip per request, which is what makes an uncached
/// validator a cheap way to generate load from outside.
///
/// **The TTL is a security parameter, not a performance one.** It bounds how
/// long a disabled token keeps working. 10 s is short enough that revocation is
/// effectively immediate for an operator and long enough to remove ~99 % of the
/// queries. Writes in this module invalidate eagerly, so the TTL only covers a
/// disable performed on a *different* node.
static TOKEN_CACHE: LazyLock<RwHashMap<String, (Option<SyntheticsProbeTokenRecord>, Instant)>> =
    LazyLock::new(Default::default);

/// Org → its default enabled token, same TTL rules as [`TOKEN_CACHE`].
static DEFAULT_TOKEN_CACHE: LazyLock<
    RwHashMap<String, (Option<SyntheticsProbeTokenRecord>, Instant)>,
> = LazyLock::new(Default::default);

const TOKEN_CACHE_TTL: Duration = Duration::from_secs(10);

/// Clears both token caches. Called by every write path here so a disable,
/// rotate or default-change takes effect on this node immediately.
pub fn invalidate_cache() {
    TOKEN_CACHE.clear();
    DEFAULT_TOKEN_CACHE.clear();
}

/// Invalidates locally **and** tells every other node.
///
/// This is the revocation path: `set_enabled(false)` reaches other nodes as a
/// coordinator event rather than waiting out their TTL, which is what makes a
/// disable effectively fleet-wide-immediate.
async fn invalidate_and_publish(org_id: &str) {
    invalidate_cache();
    if let Err(e) = crate::coordinator::synthetics::emit_tokens_changed(org_id).await {
        log::error!("[synthetics] emit probe token cache event failed for {org_id}: {e}");
    }
}

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
    let model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        name: Set(record.name.clone()),
        token: Set(record.token.clone()),
        is_default: Set(record.is_default),
        enabled: Set(record.enabled),
        created_by: Set(record.created_by.clone()),
        // The record's own timestamps, not this node's clock. Every local
        // caller already stamps them with `now`, so this changes nothing for
        // them — but a token replicated from another region must land with the
        // origin's `created_at`, or `list_by_org` (ordered by it) shows the
        // org's tokens in a different order in every region.
        created_at: Set(record.created_at),
        updated_at: Set(record.updated_at),
    };
    let client = get_orm_client_rw().await;
    match Entity::insert(model).exec(client).await {
        Ok(_) => {
            // A new token can become the org default, so both caches are stale.
            invalidate_and_publish(&record.org_id).await;
            Ok(())
        }
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
    if let Some(entry) = TOKEN_CACHE.get(token)
        && entry.1.elapsed() < TOKEN_CACHE_TTL
    {
        return Ok(entry.0.clone());
    }

    let client = get_orm_client_rw().await;
    let record = Entity::find()
        .filter(Column::Token.eq(token))
        .filter(Column::Enabled.eq(true))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .map(SyntheticsProbeTokenRecord::from);

    TOKEN_CACHE.insert(token.to_string(), (record.clone(), Instant::now()));
    Ok(record)
}

/// Find the org's default enabled probe token — the one handed out by
/// `agent-setup` / install and injected into Lambda invokes by the dispatcher.
pub async fn find_default(
    org_id: &str,
) -> Result<Option<SyntheticsProbeTokenRecord>, errors::Error> {
    if let Some(entry) = DEFAULT_TOKEN_CACHE.get(org_id)
        && entry.1.elapsed() < TOKEN_CACHE_TTL
    {
        return Ok(entry.0.clone());
    }

    let client = get_orm_client_rw().await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IsDefault.eq(true))
        .filter(Column::Enabled.eq(true))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .map(SyntheticsProbeTokenRecord::from);

    DEFAULT_TOKEN_CACHE.insert(org_id.to_string(), (record.clone(), Instant::now()));
    Ok(record)
}

/// List all probe tokens for an org (enabled + disabled), newest-default first.
/// Callers mask the token value before returning it to a UI.
pub async fn list_by_org(org_id: &str) -> Result<Vec<SyntheticsProbeTokenRecord>, errors::Error> {
    use sea_orm::{Order, QueryOrder};
    let client = get_orm_client_ro().await;
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
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(record.map(SyntheticsProbeTokenRecord::from))
}

/// Enable or disable a token by `(org_id, name)`. Disabling is how a token is
/// revoked.
///
/// Revocation is immediate **on this node** — the caches are cleared below —
/// and effectively immediate on every other node in the cluster, because
/// [`invalidate_and_publish`] emits a coordinator event and every node's watcher
/// clears its cache on receipt. `TOKEN_CACHE_TTL` (10 s) is the fallback for a
/// node that missed the event, not the normal path.
///
/// Across a **super cluster** the same holds one level up: the replicated
/// `SetEnabled` is applied through this function in the receiving region, so it
/// emits that region's coordinator event too. The revocation window there is
/// queue latency plus event delivery, with the 10 s TTL as the same fallback.
/// Do not remove the cache to shrink it — `find_global` runs in the auth
/// middleware on every probe request, and an uncached validator is a cheap way
/// to generate load from outside.
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
    invalidate_and_publish(org_id).await;
    Ok(())
}

/// Make `(org_id, name)` the org's sole default (clears `is_default` on every
/// other row of the org, in one transaction). Does NOT touch `enabled`, so the
/// previous default stays valid during a rotation overlap window until it is
/// explicitly disabled.
pub async fn set_default(org_id: &str, name: &str) -> Result<(), errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let client = get_orm_client_rw().await;
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
    invalidate_and_publish(org_id).await;
    Ok(())
}

/// Create the default probe token for a new org.
///
/// Returns the row it inserted so the caller can replicate it. The caller has
/// to be the one to publish: this module is `infra`, which cannot reach the
/// enterprise crate at all, and that missing edge is what stops a region
/// re-broadcasting a token it just applied from another region.
pub async fn create_for_org(
    org_id: &str,
    created_by: &str,
) -> Result<SyntheticsProbeTokenRecord, errors::Error> {
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
    add(&record).await?;
    Ok(record)
}
