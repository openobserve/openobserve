// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use bytes::Bytes;
use infra::{
    db::{delete_from_db_coordinator, put_into_db_coordinator},
    errors::{Error, Result},
};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType};

use crate::common::infra::config::KVS;

/// Process KV messages from super cluster queue
///
/// This handler processes KV put/delete messages from the super cluster.
/// Unlike other handlers that write to the meta table, this handler:
/// 1. Writes to the dedicated kv_store table
/// 2. Publishes coordinator event for within-cluster synchronization
/// 3. Updates the local KVS cache
///
/// Key format: /kv/{org_id}/{key}
pub(crate) async fn process(msg: Message) -> Result<()> {
    // Parse the key to extract org_id and kv_key
    // Expected format: /kv/{org_id}/{key}
    let key = msg.key.strip_prefix("/kv/").ok_or_else(|| {
        Error::Message(format!(
            "Invalid KV key format, expected /kv/{{org_id}}/{{key}}: {}",
            msg.key
        ))
    })?;

    let parts: Vec<&str> = key.splitn(2, '/').collect();
    if parts.len() != 2 {
        return Err(Error::Message(format!(
            "Invalid KV key format, expected org_id/key: {}",
            key
        )));
    }

    let org_id = parts[0];
    let kv_key = parts[1];

    match msg.message_type {
        MessageType::Put => {
            let value = msg.value.ok_or_else(|| {
                Error::Message(format!("KV put message missing value for key: {}", msg.key))
            })?;

            // Write to kv_store table (primary storage)
            infra::table::kv_store::set(org_id, kv_key, &value).await?;

            // Publish coordinator event for within-cluster synchronization
            // This ensures other nodes in the same cluster get notified
            // put_into_db_coordinator handles local vs cluster mode correctly
            if let Err(e) = put_into_db_coordinator(&msg.key, Bytes::new(), true, None).await {
                log::error!(
                    "[SUPER_CLUSTER:KV] Failed to sync to coordinator: {} - {e}",
                    msg.key
                );
            }

            // Update local cache
            let cache_key = format!("{}/{}", org_id, kv_key);
            KVS.insert(cache_key, value);

            log::debug!(
                "[SUPER_CLUSTER:KV] Put key: {}/{} to kv_store table and coordinator",
                org_id,
                kv_key
            );
        }
        MessageType::Delete(_with_prefix) => {
            // Delete from kv_store table (primary storage)
            infra::table::kv_store::delete(org_id, kv_key).await?;

            // Publish coordinator delete event for within-cluster synchronization
            if let Err(e) = delete_from_db_coordinator(&msg.key, false, true, None).await {
                log::error!(
                    "[SUPER_CLUSTER:KV] Failed to delete from coordinator: {} - {e}",
                    msg.key
                );
            }

            // Remove from local cache
            let cache_key = format!("{}/{}", org_id, kv_key);
            KVS.remove(&cache_key);

            log::debug!(
                "[SUPER_CLUSTER:KV] Delete key: {}/{} from kv_store table and coordinator",
                org_id,
                kv_key
            );
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:KV] Invalid message type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type for KV".to_string()));
        }
    }

    Ok(())
}
