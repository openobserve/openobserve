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
use config::get_config;
use serde::Deserialize;
use tokio::sync::OnceCell;

use crate::db::nats::get_nats_client;

/// Bucket holding the session→owner records (prefixed with `ZO_NATS_PREFIX`,
/// so o2-ai and openobserve share one NATS namespace). Must match the bucket
/// name in o2-ai's `src/cluster/directory.py`.
const BUCKET: &str = "ai_session_owners";

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

/// The routable address of the o2-ai replica owning `session_id`.
///
/// Returns `None` for every non-answer: no claim recorded yet (a new
/// conversation), no advertised address, NATS unreachable, or a malformed
/// record. Callers treat them identically — fall back to the configured agent
/// URL and let o2-ai's own ownership check catch a genuine misroute.
///
/// # Consumers
///
/// This has no open-source callers: it is used by the enterprise crate's
/// `AiAgentClient` (`o2_enterprise::enterprise::ai::client`) to route a session
/// to its owning replica. Signature changes here must be made in lockstep with
/// that crate.
pub async fn get_session_owner_addr(session_id: &str) -> Option<String> {
    if session_id.is_empty() {
        return None;
    }

    let bucket = session_bucket().await?;

    let entry = match bucket.get(session_id).await {
        Ok(Some(v)) => v,
        Ok(None) => return None,
        Err(e) => {
            log::debug!("[AI_SESSIONS] lookup of session {session_id} failed: {e}");
            return None;
        }
    };

    match config::utils::json::from_slice::<SessionOwner>(&entry) {
        Ok(v) if !v.addr.is_empty() => {
            log::debug!(
                "[AI_SESSIONS] session {session_id} owned by {} at {}",
                v.owner,
                v.addr
            );
            Some(v.addr.trim_end_matches('/').to_string())
        }
        Ok(v) => {
            // Claimed, but the owner published no address — it is running
            // without O2_AI_ADVERTISE_URL, so it cannot be dialled directly.
            log::warn!(
                "[AI_SESSIONS] session {session_id} is owned by {} but has no advertised \
                 address; falling back to the configured agent URL",
                v.owner
            );
            None
        }
        Err(e) => {
            log::warn!("[AI_SESSIONS] malformed record for session {session_id}: {e}");
            None
        }
    }
}
