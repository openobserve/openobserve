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

use std::{
    sync::RwLock,
    time::{Duration, Instant},
};

use async_nats::jetstream;
use config::{get_config, utils::hash::Sum64};
use futures::StreamExt;
use serde::Deserialize;
use tokio::sync::OnceCell;

use crate::db::nats::get_nats_client;

/// Result of the last NATS reachability probe, and when it ran.
static NATS_PROBE: RwLock<Option<(Instant, bool)>> = RwLock::new(None);

/// How long a *failed* probe is trusted before trying again. A success is cached
/// for the process lifetime; a failure must not be, or a NATS that starts after
/// openobserve would never be picked up.
const NATS_PROBE_RETRY: Duration = Duration::from_secs(30);

/// Whether NATS is actually reachable, without risking a panic to find out.
///
/// [`get_nats_client`] **panics** when it cannot connect (`db::nats::connect`
/// ends in `panic!("NATS connect failed")`, and its address parsing `unwrap`s).
/// On this path that would abort the request task on every AI turn — and since
/// the `OnceCell` is left uninitialized, forever after. So probe with a separate
/// bounded connection first and only touch the shared client once we know it
/// will succeed.
///
/// Deliberately **not** gated on `local_mode`. One openobserve node in local
/// mode routing to several o2-ai replicas is a legitimate topology — openobserve
/// reaches NATS there perfectly well, it just doesn't use it as its own cluster
/// coordinator. Gating on `local_mode` silently disables session affinity for
/// exactly that deployment, which is the failure this whole feature exists to
/// prevent.
async fn nats_reachable() -> bool {
    if let Ok(guard) = NATS_PROBE.read()
        && let Some((probed_at, reachable)) = *guard
        && (reachable || probed_at.elapsed() < NATS_PROBE_RETRY)
    {
        return reachable;
    }

    let cfg = get_config();
    let addrs: Vec<async_nats::ServerAddr> = cfg
        .nats
        .addr
        .split(',')
        // `parse`, not `unwrap`: a malformed address is a config error, not a
        // reason to take the process down from inside a chat turn.
        .filter_map(|a| a.trim().parse().ok())
        .collect();

    let reachable = if addrs.is_empty() {
        log::warn!("[AI_SESSIONS] no usable ZO_NATS_ADDR; session routing is inert");
        false
    } else {
        let mut opts = async_nats::ConnectOptions::new()
            .connection_timeout(Duration::from_secs(cfg.nats.connect_timeout.max(1)));
        if !cfg.nats.user.is_empty() {
            opts = opts.user_and_password(cfg.nats.user.clone(), cfg.nats.password.clone());
        }
        match async_nats::connect_with_options(addrs, opts).await {
            Ok(client) => {
                // Probe only — the real work goes through the shared pooled
                // client. Drop this one rather than leaving it open.
                drop(client);
                true
            }
            Err(e) => {
                log::warn!(
                    "[AI_SESSIONS] NATS unreachable at {}: {e}. Session routing falls back to \
                     the configured agent URL; retrying in {}s.",
                    cfg.nats.addr,
                    NATS_PROBE_RETRY.as_secs()
                );
                false
            }
        }
    };

    if let Ok(mut guard) = NATS_PROBE.write() {
        *guard = Some((Instant::now(), reachable));
    }
    reachable
}

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

    if !nats_reachable().await {
        return None;
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

/// Cached handle to the replica-registry bucket, for the same reason as
/// [`SESSION_BUCKET`]: resolving it costs a JetStream round-trip, and this runs
/// on every session-routed request. Only successful resolutions are stored.
static REPLICAS_BUCKET_HANDLE: OnceCell<jetstream::kv::Store> = OnceCell::const_new();

/// How long a fetched live set may be reused.
///
/// The set itself is only ever as fresh as the heartbeat that produces it —
/// replicas beat every `O2_AI_REPLICA_HEARTBEAT_INTERVAL` (10s) and expire after
/// `O2_AI_REPLICA_HEARTBEAT_TTL` (30s) — so a window this short adds no
/// staleness that the registry's own resolution doesn't already have. What it
/// removes is real: listing the registry costs a `get_key_value`, a freshly
/// created ordered push consumer (`Store::keys` builds one per call), and a
/// `get` per replica, all on the front of every chat turn.
const LIVE_REPLICAS_TTL: Duration = Duration::from_secs(2);

/// Last fetched live set and when it was fetched.
///
/// `std::sync` rather than `tokio::sync`: the critical section only clones a
/// short Vec and never awaits, so an async lock would buy nothing. Two
/// concurrent misses may both fetch; that is harmless and cheaper than
/// serialising every caller behind one lock.
static LIVE_REPLICAS_CACHE: RwLock<Option<(Instant, Vec<(String, String)>)>> = RwLock::new(None);

async fn replicas_bucket() -> Option<&'static jetstream::kv::Store> {
    if let Some(bucket) = REPLICAS_BUCKET_HANDLE.get() {
        return Some(bucket);
    }

    if !nats_reachable().await {
        return None;
    }

    let cfg = get_config();
    let bucket_name = format!("{}{}", cfg.nats.prefix, REPLICAS_BUCKET);
    let client = get_nats_client().await.clone();
    let jetstream = jetstream::new(client);

    match jetstream.get_key_value(&bucket_name).await {
        Ok(b) => Some(REPLICAS_BUCKET_HANDLE.get_or_init(|| async { b }).await),
        Err(e) => {
            log::debug!("[AI_SESSIONS] replica registry {bucket_name} unavailable: {e}");
            None
        }
    }
}

/// The o2-ai replicas currently heartbeating, as `(name, addr)` pairs.
///
/// Cached for [`LIVE_REPLICAS_TTL`] only. This is the *live* set — a long-lived
/// copy would keep routing to a replica that is gone — but a window far shorter
/// than the heartbeat interval that feeds it costs no accuracy.
async fn live_replicas() -> Vec<(String, String)> {
    if let Ok(guard) = LIVE_REPLICAS_CACHE.read()
        && let Some((fetched_at, replicas)) = guard.as_ref()
        && fetched_at.elapsed() < LIVE_REPLICAS_TTL
    {
        return replicas.clone();
    }

    let replicas = fetch_live_replicas().await;

    // Don't cache an empty result: the registry being briefly unreadable must
    // not pin routing to "no replicas" for the whole window, and an empty set is
    // what makes `get_session_route` skip the liveness check entirely.
    if !replicas.is_empty()
        && let Ok(mut guard) = LIVE_REPLICAS_CACHE.write()
    {
        *guard = Some((Instant::now(), replicas.clone()));
    }

    replicas
}

async fn fetch_live_replicas() -> Vec<(String, String)> {
    let Some(bucket) = replicas_bucket().await else {
        return Vec::new();
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
    ///
    /// This means the directory was read successfully and said "nothing here",
    /// which is the only condition under which placing the session is correct.
    Unclaimed,
    /// The directory could not answer: unreachable, a failed read, or a record
    /// that cannot be used (malformed, or claimed with no advertised address).
    ///
    /// Distinct from [`SessionRoute::Unclaimed`] on purpose. "No claim" licenses
    /// the caller to *place* the session on a replica of its choosing; "we don't
    /// know" does not. An existing conversation routed as if it were new lands
    /// on a replica that has never seen it, gets refused, and the UI abandons a
    /// perfectly good session — so a transient directory error would cost the
    /// user their working state. Callers must fall back to the configured agent
    /// URL here, which is exactly today's non-HA behavior.
    Unknown,
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
        // Not identifiable, so not placeable either — hashing "" would pin every
        // anonymous request to one replica.
        return SessionRoute::Unknown;
    }

    let Some(bucket) = session_bucket().await else {
        // Either NATS is unreachable or no replica has ever claimed anything. In
        // the first case placing would be actively wrong; in the second the
        // replica registry is empty too, so placement would decline anyway.
        return SessionRoute::Unknown;
    };

    let entry = match bucket.get(session_id).await {
        Ok(Some(v)) => v,
        // The only "definitely no claim" answer, and so the only one that may
        // be placed.
        Ok(None) => return SessionRoute::Unclaimed,
        Err(e) => {
            log::debug!("[AI_SESSIONS] lookup of session {session_id} failed: {e}");
            return SessionRoute::Unknown;
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
            // Emphatically NOT `Unclaimed`: the session belongs to someone, we
            // just can't reach them by name. Placing it would hand an existing
            // conversation to a replica guaranteed not to own it.
            log::warn!(
                "[AI_SESSIONS] session {session_id} is owned by {} but has no advertised \
                 address; falling back to the configured agent URL",
                v.owner
            );
            SessionRoute::Unknown
        }
        Err(e) => {
            log::warn!("[AI_SESSIONS] malformed record for session {session_id}: {e}");
            SessionRoute::Unknown
        }
    }
}
