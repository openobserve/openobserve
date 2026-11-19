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

//! Super-cluster replication of AI memory (message 103): every write sends the memory as it now
//! is, the newest head by `(time, region)` wins in every region, and deletes leave 30-day
//! tombstones. Logs name the org and scope only, never a user id or memory text.

use config::{meta::ai::memory::MemoryTombstone, utils::time::now_micros};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Result,
    table::{
        ai_memory::{self as table, MemoryKey, Replicated, TOMBSTONE_KEEP_MICROS},
        cipher,
    },
};
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config, super_cluster::queue::AiMemoryMessage,
};

/// Sends `key`'s memory as it now is; `also` is the id of a revision just discarded.
pub async fn publish_put(key: &MemoryKey, also: Option<&str>) {
    if !replicating() {
        return;
    }
    let replica = async {
        let dek = cipher::get_dek(&key.org).await?;
        let conn = get_orm_client_ro().await;
        table::replica_with(conn, &dek, key, also, &local_region()).await
    };
    match replica.await {
        Ok(Some(replica)) => send(&AiMemoryMessage::Put(Box::new(replica))).await,
        Ok(None) => {}
        Err(e) => log::error!(
            "[SUPER_CLUSTER:sync] failed to read a {} memory of org '{}' to replicate: {e}",
            key.scope,
            key.org
        ),
    }
}

/// Records and sends the delete of `key`'s memory; off a super cluster nothing is kept.
pub async fn publish_delete(key: &MemoryKey, deleted_at: i64) {
    if !replicating() {
        return;
    }
    let tombstone = MemoryTombstone {
        org: key.org.clone(),
        scope: key.scope,
        scope_key: key.scope_key.clone(),
        deleted_at,
        region: local_region(),
    };
    if let Err(e) = table::put_tombstone_with(get_orm_client_rw().await, &tombstone).await {
        log::error!(
            "[SUPER_CLUSTER:sync] failed to record the delete of a {} memory of org '{}': {e}",
            key.scope,
            key.org
        );
    }
    send(&AiMemoryMessage::Delete(tombstone)).await;
}

/// Re-sends every memory of the org (applied head, settings, pending revisions) and its deletes
/// of the last 30 days, so a region that missed messages catches up; adds only, never removes a
/// memory another region lacks. Returns how many messages went out.
pub async fn resync(org: &str, now: i64) -> Result<usize> {
    if !replicating() {
        return Ok(0);
    }
    let (dek, region) = (cipher::get_dek(org).await?, local_region());
    let conn = get_orm_client_rw().await;
    let mut messages = Vec::new();
    for key in table::list_keys_with(conn, org).await? {
        if let Some(replica) = table::replica_with(conn, &dek, &key, None, &region).await? {
            messages.push(AiMemoryMessage::Put(Box::new(replica)));
        }
    }
    for tombstone in table::live_tombstones_with(conn, org, now - TOMBSTONE_KEEP_MICROS).await? {
        messages.push(AiMemoryMessage::Delete(tombstone));
    }
    for msg in &messages {
        send(msg).await;
    }
    Ok(messages.len())
}

/// Applies another region's message without publishing it again; the same message twice is a
/// no-op.
pub async fn apply_replicated(msg: AiMemoryMessage) -> Result<Replicated> {
    let (conn, region) = (get_orm_client_rw().await, local_region());
    match msg {
        AiMemoryMessage::Put(replica) => {
            let dek = cipher::get_dek(&replica.org).await?;
            table::apply_replica_with(conn, &dek, &replica, &region, now_micros()).await
        }
        AiMemoryMessage::Delete(tombstone) => {
            table::apply_tombstone_with(conn, &tombstone, &region).await
        }
    }
}

fn local_region() -> String {
    get_o2_config().super_cluster.region.clone()
}

fn replicating() -> bool {
    get_o2_config().super_cluster.enabled && !config::get_config().common.local_mode
}

async fn send(msg: &AiMemoryMessage) {
    if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::ai_memory(msg).await {
        let (org, scope) = match msg {
            AiMemoryMessage::Put(r) => (&r.org, r.scope),
            AiMemoryMessage::Delete(t) => (&t.org, t.scope),
        };
        log::error!(
            "[SUPER_CLUSTER:sync] failed to publish a {scope} memory change of org '{org}': {e}"
        );
    }
}
