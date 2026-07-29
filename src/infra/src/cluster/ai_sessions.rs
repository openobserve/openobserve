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

//! Read side of the o2-ai session→owner directory.
//!
//! o2-ai keeps each conversation in an embedded opencode process backed by a
//! node-local database, so a session can only be served by the replica that
//! created it. Each o2-ai replica records the sessions it owns in a NATS KV
//! bucket; this module reads that bucket so the AI client can dial the owning
//! replica instead of load-balancing across replicas that have never seen the
//! session.
//!
//! # Why this doesn't use the shared coordinator
//!
//! [`crate::db::get_coordinator`] would be the obvious way in, but it
//! base64-encodes every key (`key_encode` in `db::nats`) and derives the bucket
//! name from the key's first path segment. o2-ai writes plain, unencoded keys
//! via `nats-py`, so a read through the coordinator would never find them. This
//! talks to the bucket directly with the same plain-key convention o2-ai uses.
//!
//! The directory is a routing *hint*: every failure here degrades to "unknown
//! owner", which the caller handles by falling back to the configured agent
//! URL. o2-ai enforces actual ownership itself and refuses sessions it does not
//! own, so a stale or unavailable directory costs efficiency, never
//! correctness.

use async_nats::jetstream;
use config::{get_config, utils::hash::Sum64};
use futures::StreamExt;
use serde::Deserialize;
use tokio::sync::OnceCell;

use crate::db::nats::get_nats_client;

/// Bucket holding the session→owner records (prefixed with `ZO_NATS_PREFIX`,
/// so o2-ai and openobserve share one NATS namespace). Must match the bucket
/// name in o2-ai's `src/cluster/directory.py`.
const BUCKET: &str = "ai_session_owners";

/// Bucket holding short-TTL liveness records, one per live o2-ai replica.
/// Used to place NEW sessions; existing sessions route by their claim.
const REPLICAS_BUCKET: &str = "ai_replicas";

/// A directory record, as written by o2-ai.
///
/// Unknown fields are ignored so the two sides can evolve independently; the
/// o2-ai image ships on its own cadence.
#[derive(Debug, Deserialize)]
struct SessionOwner {
    owner: String,
    /// URL that reaches the owning replica specifically. Published by the
    /// replica itself (`O2_AI_ADVERTISE_URL`) rather than derived from `owner`,
    /// since a replica name is not necessarily resolvable — that depends on the
    /// deployment's DNS shape, which openobserve cannot assume.
    #[serde(default)]
    addr: String,
}

/// Cached handle to the session-owner bucket.
///
/// `get_key_value` costs a JetStream round-trip to fetch stream metadata, and
/// this lookup runs on every chat turn and confirmation — resolving the bucket
/// each time would double the network cost of routing. The handle is stable for
/// the process lifetime, so it is resolved once.
///
/// Only successful resolutions are stored. If the bucket does not exist yet —
/// o2-ai creates it on its first claim — a later call retries, rather than
/// routing being permanently disabled by a startup ordering accident.
static SESSION_BUCKET: OnceCell<jetstream::kv::Store> = OnceCell::const_new();

async fn session_bucket() -> Option<&'static jetstream::kv::Store> {
    if let Some(bucket) = SESSION_BUCKET.get() {
        return Some(bucket);
    }

    let cfg = get_config();
    let bucket_name = format!("{}{}", cfg.nats.prefix, BUCKET);
    let client = get_nats_client().await.clone();
    let jetstream = jetstream::new(client);

    // Deliberately get-only, never create: o2-ai owns this bucket's lifecycle
    // (including its TTL). If it doesn't exist yet, no replica has claimed
    // anything and there is nothing to route.
    match jetstream.get_key_value(&bucket_name).await {
        Ok(b) => Some(SESSION_BUCKET.get_or_init(|| async { b }).await),
        Err(e) => {
            log::debug!("[AI_SESSIONS] bucket {bucket_name} unavailable: {e}");
            None
        }
    }
}

/// A live-replica record, as written by o2-ai's heartbeat.
#[derive(Debug, Deserialize)]
struct ReplicaEntry {
    name: String,
    #[serde(default)]
    addr: String,
}

/// The o2-ai replicas currently heartbeating, as `(name, addr)` pairs.
///
/// Deliberately not cached, unlike the session bucket: this is the *live* set,
/// and a stale copy would keep routing to a replica that is gone.
async fn live_replicas() -> Vec<(String, String)> {
    let cfg = get_config();
    let bucket_name = format!("{}{}", cfg.nats.prefix, REPLICAS_BUCKET);

    let client = get_nats_client().await.clone();
    let jetstream = jetstream::new(client);
    let bucket = match jetstream.get_key_value(&bucket_name).await {
        Ok(b) => b,
        Err(e) => {
            log::debug!("[AI_SESSIONS] replica registry {bucket_name} unavailable: {e}");
            return Vec::new();
        }
    };

    let mut keys = match bucket.keys().await {
        Ok(k) => k,
        Err(e) => {
            log::debug!("[AI_SESSIONS] cannot list replicas: {e}");
            return Vec::new();
        }
    };

    let mut replicas: Vec<(String, String)> = Vec::new();
    while let Some(Ok(key)) = keys.next().await {
        if let Ok(Some(entry)) = bucket.get(&key).await
            && let Ok(v) = config::utils::json::from_slice::<ReplicaEntry>(&entry)
            && !v.addr.is_empty()
        {
            replicas.push((v.name, v.addr.trim_end_matches('/').to_string()));
        }
    }
    replicas
}

/// Pick a live o2-ai replica to host a NEW session.
///
/// Only for sessions with no claim yet. Existing sessions must always route to
/// their recorded owner ([`get_session_route`]) — placing an existing
/// session would send it to a replica that has never seen it.
///
/// Selection hashes the session id over the sorted live set, so it is
/// deterministic and spreads sessions evenly without any coordination between
/// openobserve nodes. This mirrors how queriers are dispatched
/// (`get_node_from_consistent_hash`), but over o2-ai's own registry rather than
/// the cluster ring — o2-ai replicas are not cluster nodes.
///
/// Returns `None` if no replica is heartbeating, in which case the caller falls
/// back to the configured agent URL.
pub async fn pick_replica_for_new_session(session_id: &str) -> Option<String> {
    let mut replicas = live_replicas().await;

    if replicas.is_empty() {
        log::debug!("[AI_SESSIONS] no live o2-ai replicas registered");
        return None;
    }

    // Sort so every openobserve node sees the same ordering, then index by a
    // hash of the session id. Without the sort, KV listing order could differ
    // between nodes and two nodes could place the same new session differently
    // — which the o2-ai claim would catch, but only by refusing one of them.
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
    /// The session is claimed by a replica that is no longer heartbeating.
    ///
    /// Its conversation is gone — no other replica can serve it. Dialling the
    /// dead address would surface as a connect error ("failed to send request"),
    /// which the client cannot distinguish from a network blip and the UI cannot
    /// act on. Callers must instead report this as an owner-unavailable
    /// condition so the UI can restore the conversation into a fresh session.
    OwnerUnavailable { owner: String },
    /// No claim recorded — a new conversation, free to be placed anywhere.
    Unclaimed,
}

/// Where to route `session_id`.
///
/// Cross-checks the recorded owner against the live-replica registry, because a
/// claim deliberately outlives its replica (so a session stays pinned across a
/// restart). Without that check a session owned by a dead replica resolves to an
/// unreachable address and the request fails at the transport layer.
///
/// # Consumers
///
/// This has no open-source callers: it is used by the enterprise crate's
/// `AiAgentClient` (`o2_enterprise::enterprise::ai::client`) to route a session
/// to its owning replica. Signature changes here must be made in lockstep with
/// that crate.
pub async fn get_session_route(session_id: &str) -> SessionRoute {
    if session_id.is_empty() {
        return SessionRoute::Unclaimed;
    }

    let Some(bucket) = session_bucket().await else {
        return SessionRoute::Unclaimed;
    };

    let entry = match bucket.get(session_id).await {
        Ok(Some(v)) => v,
        Ok(None) => return SessionRoute::Unclaimed,
        Err(e) => {
            log::debug!("[AI_SESSIONS] lookup of session {session_id} failed: {e}");
            return SessionRoute::Unclaimed;
        }
    };

    match config::utils::json::from_slice::<SessionOwner>(&entry) {
        Ok(v) if !v.addr.is_empty() => {
            // A claim outlives its replica by design. Confirm the owner is still
            // heartbeating before sending anything to it.
            let live = live_replicas().await;
            if live.is_empty() {
                // Registry unavailable — don't declare a healthy replica dead on
                // the strength of a failed lookup. Route to the claim and let the
                // request succeed or fail on its own merits.
                log::debug!(
                    "[AI_SESSIONS] replica registry empty; routing session {session_id} to \
                     recorded owner {} without a liveness check",
                    v.owner
                );
                return SessionRoute::Owner(v.addr.trim_end_matches('/').to_string());
            }
            if live.iter().any(|(name, _)| name == &v.owner) {
                log::debug!(
                    "[AI_SESSIONS] session {session_id} owned by {} at {}",
                    v.owner,
                    v.addr
                );
                SessionRoute::Owner(v.addr.trim_end_matches('/').to_string())
            } else {
                log::warn!(
                    "[AI_SESSIONS] session {session_id} is owned by {}, which is no longer \
                     registered; the conversation is unavailable",
                    v.owner
                );
                SessionRoute::OwnerUnavailable { owner: v.owner }
            }
        }
        Ok(v) => {
            // Claimed, but the owner published no address — it is running
            // without O2_AI_ADVERTISE_URL, so it cannot be dialled directly.
            log::warn!(
                "[AI_SESSIONS] session {session_id} is owned by {} but has no advertised \
                 address; falling back to the configured agent URL",
                v.owner
            );
            SessionRoute::Unclaimed
        }
        Err(e) => {
            log::warn!("[AI_SESSIONS] malformed record for session {session_id}: {e}");
            SessionRoute::Unclaimed
        }
    }
}
