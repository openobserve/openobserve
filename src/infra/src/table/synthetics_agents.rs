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

use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};

use config::RwHashMap;
use sea_orm::{
    ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set, sea_query::Expr,
};

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
    /// Probe token the agent last authenticated with (for "N agents on this
    /// token"). `None` for agents registered before this was tracked.
    pub token_id: Option<String>,
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
            token_id: m.token_id,
            last_seen_at: m.last_seen_at,
            created_at: m.created_at,
        }
    }
}

/// `agent_id` → the agent row, with load time.
///
/// Backs [`get_cached`] only. The lease path reads an agent once per poll purely
/// for its `capabilities`, and agents poll every 2 s — ~330 reads/min for 11
/// agents, all for a value that changes only when an agent re-registers.
///
/// # Staleness contract
///
/// `last_seen_at` is rewritten by [`touch`] on **every lease**, and `touch` does
/// not invalidate — invalidating there would defeat the cache entirely, since it
/// fires at exactly the rate of the reads being served. Anything that judges
/// agent liveness (the staleness watcher, location health) must use [`get`].
static AGENT_CACHE: LazyLock<RwHashMap<String, (SyntheticsAgentRecord, Instant)>> =
    LazyLock::new(Default::default);

const AGENT_CACHE_TTL: Duration = Duration::from_secs(15);

/// Drops one agent from the cache. Called on register, where capabilities change.
pub fn invalidate_cache(agent_id: &str) {
    AGENT_CACHE.remove(agent_id);
}

/// Invalidates locally **and** tells every other node. Write paths call this;
/// the coordinator watcher calls [`invalidate_cache`] so events do not echo.
async fn invalidate_and_publish(agent_id: &str) {
    invalidate_cache(agent_id);
    if let Err(e) = crate::coordinator::synthetics::emit_agent_changed(agent_id).await {
        log::error!("[synthetics] emit agent cache event failed for {agent_id}: {e}");
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
                .col_expr(Column::TokenId, Expr::value(record.token_id.clone()))
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
                token_id: Set(record.token_id.clone()),
                last_seen_at: Set(record.last_seen_at),
                created_at: Set(record.created_at),
            };
            Entity::insert(model)
                .exec(client)
                .await
                .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
        }
    }
    // Release the SQLite write mutex BEFORE emitting. On a sqlite meta_store
    // the coordinator's put() takes the *same* CLIENT_RW lock `get_lock()`
    // returns, so emitting while holding it deadlocks the process — and the
    // mutex is then held forever, hanging every later synthetics query.
    drop(_lock);
    // Register is where capabilities change, so the cached copy is now stale.
    invalidate_and_publish(&record.id).await;
    Ok(())
}

/// Refresh `last_seen_at` for an agent (called on heartbeat and every lease).
///
/// Deliberately does **not** invalidate [`AGENT_CACHE`] — it fires once per
/// lease, which is exactly the rate of the reads the cache serves. Callers that
/// need a current `last_seen_at` use [`get`], not [`get_cached`].
pub async fn touch(agent_id: &str, now_us: i64) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
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

/// All agents for a set of locations, grouped by `location_id`.
///
/// One query for the whole set instead of [`list_by_location`] per location —
/// the locations list endpoint iterates every visible location to compute
/// per-type availability, so the per-location form issued ~20 queries to build
/// one response. Locations with no agents are absent from the map; callers
/// should treat a missing key as an empty slice.
pub async fn list_by_locations(
    location_ids: &[String],
) -> Result<std::collections::HashMap<String, Vec<SyntheticsAgentRecord>>, errors::Error> {
    if location_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let rows = Entity::find()
        .filter(Column::LocationId.is_in(location_ids.to_vec()))
        .order_by_desc(Column::LastSeenAt)
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    let mut grouped: std::collections::HashMap<String, Vec<SyntheticsAgentRecord>> =
        std::collections::HashMap::new();
    for row in rows {
        let rec: SyntheticsAgentRecord = row.into();
        grouped
            .entry(rec.location_id.clone())
            .or_default()
            .push(rec);
    }
    Ok(grouped)
}

/// Find an agent by its deploy identity. Agents hold no persistent state, so
/// a restarted container re-registers with the same (org, location, name) but
/// without its previous server-issued id — this lookup lets register reuse the
/// existing row instead of minting a ghost.
pub async fn find_by_identity(
    org_id: &str,
    location_id: &str,
    name: &str,
) -> Result<Option<SyntheticsAgentRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let row = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::LocationId.eq(location_id))
        .filter(Column::Name.eq(name))
        .order_by_desc(Column::LastSeenAt)
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(row.map(Into::into))
}

/// Count agents per token for an org (`token_id` → count). Agents with no
/// `token_id` yet (registered before this was tracked) are omitted. Powers
/// "N agents on this token" so a token can be safely disabled once its count
/// reaches zero.
pub async fn count_by_token(
    org_id: &str,
) -> Result<std::collections::HashMap<String, i64>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let rows: Vec<Option<String>> = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .select_only()
        .column(Column::TokenId)
        .into_tuple::<Option<String>>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    let mut counts = std::collections::HashMap::new();
    for tid in rows.into_iter().flatten() {
        *counts.entry(tid).or_insert(0) += 1;
    }
    Ok(counts)
}

/// Find one agent by id.
/// Reads an agent from cache when fresh — see [`AGENT_CACHE`] for the staleness
/// contract. Use [`get`] when `last_seen_at` matters.
pub async fn get_cached(agent_id: &str) -> Result<Option<SyntheticsAgentRecord>, errors::Error> {
    if let Some(entry) = AGENT_CACHE.get(agent_id)
        && entry.1.elapsed() < AGENT_CACHE_TTL
    {
        return Ok(Some(entry.0.clone()));
    }
    let found = get(agent_id).await?;
    if let Some(rec) = &found {
        AGENT_CACHE.insert(agent_id.to_string(), (rec.clone(), Instant::now()));
    }
    Ok(found)
}

/// Reads an agent straight from the database, `last_seen_at` included.
pub async fn get(agent_id: &str) -> Result<Option<SyntheticsAgentRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let row = Entity::find_by_id(agent_id)
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(row.map(Into::into))
}
