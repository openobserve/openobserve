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

//! Read side of the o2-ai session->owner directory. o2-ai keeps each
//! conversation node-local, claims it and heartbeats its liveness; both are read
//! here via [`crate::db::get_coordinator`] (see o2-ai's `cluster/directory.py`).
//!
//! A routing *hint* only: every failure degrades to "unknown owner" and the
//! caller falls back to the configured agent URL.

use std::{
    sync::{Once, RwLock},
    time::{Duration, Instant},
};

use config::utils::hash::Sum64;
use serde::Deserialize;

use crate::db::get_coordinator;

/// Bucket holding session->owner claims. Claims outlive a replica restart so a
/// session stays pinned to its owner.
pub const AI_SESSION_OWNERS_BUCKET: &str = "ai_session_owners";

/// Bucket holding one short-TTL liveness record per live o2-ai replica. Used to
/// place NEW sessions; existing sessions route by their claim.
pub const AI_REPLICAS_BUCKET: &str = "ai_replicas";

/// The coordinator derives the bucket from a key's first path segment, so these
/// prefixes are what map onto the buckets above.
fn session_key(session_id: &str) -> String {
    format!("/{AI_SESSION_OWNERS_BUCKET}/{session_id}")
}

fn replicas_prefix() -> String {
    format!("/{AI_REPLICAS_BUCKET}/")
}

/// A claim record, as written by o2-ai. Unknown fields are ignored so the two
/// sides can evolve independently.
#[derive(Debug, Deserialize)]
struct SessionOwner {
    owner: String,
    /// URL reaching the owning replica. Published by the replica itself
    /// (`O2_AI_ADVERTISE_URL`), since a replica name may not be resolvable.
    #[serde(default)]
    addr: String,
}

/// A liveness record, as written by o2-ai's heartbeat.
#[derive(Debug, Deserialize)]
struct ReplicaEntry {
    name: String,
    #[serde(default)]
    addr: String,
}

/// A live o2-ai replica: its name in the directory, and the URL that reaches it.
type Replica = (String, String);

/// How long a non-empty live set may be reused. Replicas beat every 10s, so this
/// adds no staleness the registry doesn't have while keeping a listing off every
/// chat turn.
const LIVE_REPLICAS_TTL: Duration = Duration::from_secs(2);

/// How long a *confirmed-empty* registry may be reused. Longer: this is the
/// steady state of every non-HA deployment, and nothing about it goes stale.
const EMPTY_REPLICAS_TTL: Duration = Duration::from_secs(30);

/// Two concurrent misses may both fetch — harmless, and cheaper than
/// serialising every caller. The critical section never awaits.
static LIVE_REPLICAS_CACHE: RwLock<Option<(Instant, Vec<Replica>)>> = RwLock::new(None);

/// The o2-ai replicas currently heartbeating, or `None` if the registry could not
/// be read. Not the same answer: an empty registry proves a claimed owner is
/// gone, a failed read proves nothing.
async fn live_replicas() -> Option<Vec<Replica>> {
    if let Ok(guard) = LIVE_REPLICAS_CACHE.read()
        && let Some((fetched_at, replicas)) = guard.as_ref()
        && fetched_at.elapsed() < ttl_for(replicas)
    {
        return Some(replicas.clone());
    }

    // Only successful reads are cached, empty or not. A failure must not pin
    // routing to "no replicas" for the whole window.
    let replicas = fetch_live_replicas().await?;

    if let Ok(mut guard) = LIVE_REPLICAS_CACHE.write() {
        *guard = Some((Instant::now(), replicas.clone()));
    }

    Some(replicas)
}

fn ttl_for(replicas: &[Replica]) -> Duration {
    if replicas.is_empty() {
        EMPTY_REPLICAS_TTL
    } else {
        LIVE_REPLICAS_TTL
    }
}

/// `None` when the registry could not be read; `Some(vec![])` when it was read
/// and nobody is registered.
async fn fetch_live_replicas() -> Option<Vec<Replica>> {
    let values = match get_coordinator()
        .await
        .list_values(&replicas_prefix())
        .await
    {
        Ok(v) => v,
        Err(e) => {
            log::debug!("[AI_SESSIONS] cannot list replicas: {e}");
            return None;
        }
    };

    Some(
        values
            .iter()
            .filter_map(|v| config::utils::json::from_slice::<ReplicaEntry>(v).ok())
            .filter(|v| !v.addr.is_empty())
            .map(|v| (v.name, v.addr.trim_end_matches('/').to_string()))
            .collect(),
    )
}

/// Pick a live o2-ai replica to host a NEW session — never an existing one,
/// which would land on a replica that has never seen it. Hashing the sorted live
/// set makes every openobserve node place a session identically, uncoordinated.
///
/// `None` when no replica is heartbeating; the caller falls back to the
/// configured agent URL.
pub async fn pick_replica_for_new_session(session_id: &str) -> Option<String> {
    // Unreadable and empty are the same answer here: nowhere to place it.
    let mut replicas = live_replicas().await.unwrap_or_default();

    if replicas.is_empty() {
        log::debug!("[AI_SESSIONS] no live o2-ai replicas registered");
        return None;
    }

    // Sort so every node sees the same ordering — listing order may differ, and
    // two nodes must not place one session differently.
    replicas.sort_by(|a, b| a.0.cmp(&b.0));
    let hash = config::utils::hash::gxhash::new().sum64(session_id);
    let idx = (hash % replicas.len() as u64) as usize;

    let (name, addr) = &replicas[idx];
    log::debug!(
        "[AI_SESSIONS] placing new session {session_id} on {name} ({addr}) of {} live",
        replicas.len()
    );
    Some(addr.clone())
}

/// Where a session should be routed.
#[derive(Debug, Clone, PartialEq)]
pub enum SessionRoute {
    /// The owning replica is alive: dial this address.
    Owner(String),
    /// Claimed by a replica that is no longer heartbeating, so the conversation
    /// is gone. Callers report this instead of an opaque connect error, so the
    /// UI can offer to restore.
    OwnerUnavailable { owner: String },
    /// No claim recorded — a new conversation, free to be placed anywhere.
    Unclaimed,
    /// The directory could not answer. Distinct from [`SessionRoute::Unclaimed`]:
    /// "no claim" lets the caller place the session, "we don't know" does not —
    /// placing an existing conversation gets it refused.
    Unknown,
}

/// Where to route `session_id`. Cross-checks the claim against the liveness
/// registry, since a claim outlives its replica and a dead owner would otherwise
/// resolve to an unreachable address.
///
/// Called only from the enterprise `AiAgentClient`, so signature changes must be
/// made in lockstep with that crate.
pub async fn get_session_route(session_id: &str) -> SessionRoute {
    if session_id.is_empty() {
        // Not identifiable, so not placeable — hashing "" would pin every
        // anonymous request to one replica.
        return SessionRoute::Unknown;
    }

    let entry = match get_coordinator()
        .await
        .get_if_exists(&session_key(session_id))
        .await
    {
        Ok(Some(v)) => v,
        // The only "definitely no claim" answer, so the only placeable one.
        Ok(None) => return SessionRoute::Unclaimed,
        Err(e) => {
            log::debug!("[AI_SESSIONS] lookup of session {session_id} failed: {e}");
            return SessionRoute::Unknown;
        }
    };

    let owner = match config::utils::json::from_slice::<SessionOwner>(&entry) {
        Ok(v) if !v.addr.is_empty() => v,
        Ok(v) => {
            // Claimed but not dialable (no O2_AI_ADVERTISE_URL). NOT `Unclaimed`:
            // the session belongs to someone we just can't reach.
            log::warn!(
                "[AI_SESSIONS] session {session_id} is owned by {} but has no advertised address; \
                 falling back to the configured agent URL",
                v.owner
            );
            return SessionRoute::Unknown;
        }
        Err(e) => {
            log::warn!("[AI_SESSIONS] malformed record for session {session_id}: {e}");
            return SessionRoute::Unknown;
        }
    };

    let addr = owner.addr.trim_end_matches('/').to_string();

    // Registry unreadable — route to the claim rather than declare a healthy
    // replica dead. An empty registry is NOT this case: the owner really is gone.
    let Some(live) = live_replicas().await else {
        log::debug!(
            "[AI_SESSIONS] replica registry unreadable; routing session {session_id} to recorded \
             owner {} without a liveness check",
            owner.owner
        );
        return SessionRoute::Owner(addr);
    };

    if live.iter().any(|(name, _)| name == &owner.owner) {
        // Routing has no config flag, so this once-per-process line is the only
        // signal an operator gets that session affinity is in effect.
        static ROUTING_ENGAGED: Once = Once::new();
        ROUTING_ENGAGED.call_once(|| {
            log::info!(
                "[AI_SESSIONS] o2-ai session affinity is active: {} replica(s) advertising, \
                 sessions now route to their owner",
                live.len()
            );
        });
        log::debug!(
            "[AI_SESSIONS] session {session_id} owned by {} at {addr}",
            owner.owner
        );
        SessionRoute::Owner(addr)
    } else {
        log::warn!(
            "[AI_SESSIONS] session {session_id} is owned by {}, which is no longer registered; the \
             conversation is unavailable",
            owner.owner
        );
        SessionRoute::OwnerUnavailable { owner: owner.owner }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keys_map_onto_the_shared_buckets() {
        // The coordinator derives a bucket from the first path segment, so
        // these must stay in step with o2-ai's bucket names.
        assert_eq!(
            session_key("abc"),
            format!("/{AI_SESSION_OWNERS_BUCKET}/abc")
        );
        assert_eq!(replicas_prefix(), format!("/{AI_REPLICAS_BUCKET}/"));
    }

    #[test]
    fn test_bucket_names_match_o2_ai() {
        assert_eq!(AI_SESSION_OWNERS_BUCKET, "ai_session_owners");
        assert_eq!(AI_REPLICAS_BUCKET, "ai_replicas");
    }

    #[test]
    fn test_bucket_ttls_are_configured_on_the_nats_side() {
        // db/nats.rs matches these names literally rather than importing them, so
        // this assertion is all that keeps the two in step. Without a TTL, the
        // `ai_replicas` bucket would keep dead replicas alive forever.
        for bucket in [AI_SESSION_OWNERS_BUCKET, AI_REPLICAS_BUCKET] {
            assert!(
                crate::db::nats::bucket_has_ttl(bucket),
                "{bucket} lost its TTL in get_bucket_by_key"
            );
        }
    }

    #[test]
    fn test_a_confirmed_empty_registry_is_cached_far_longer() {
        // A non-HA deployment reaches this path on every turn, so its empty
        // registry must not cost a listing each time.
        assert_eq!(ttl_for(&[]), EMPTY_REPLICAS_TTL);
        assert!(EMPTY_REPLICAS_TTL > LIVE_REPLICAS_TTL);
    }

    #[test]
    fn test_a_populated_registry_keeps_the_short_window() {
        // A live set does go stale — a replica that dies has to drop out before
        // new sessions stop being placed on it.
        let replicas = vec![("o2ai-0".to_string(), "http://o2ai-0:8000".to_string())];
        assert_eq!(ttl_for(&replicas), LIVE_REPLICAS_TTL);
    }

    #[test]
    fn test_live_replicas_ttl_stays_under_the_heartbeat_interval() {
        // o2-ai beats every 10s; a longer window would serve sets older than the
        // heartbeat that produced them.
        assert!(LIVE_REPLICAS_TTL < Duration::from_secs(10));
    }
}
