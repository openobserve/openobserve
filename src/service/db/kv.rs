// Copyright 2025 OpenObserve Inc.
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

use std::sync::Arc;

use bytes::Bytes;
use infra::db::{delete_from_db_coordinator, put_into_db_coordinator};

use crate::{common::infra::config::KVS, service::db};

fn mk_cache_key(org_id: &str, key: &str) -> String {
    // NOTE: This assumes org_id does not contain '/' character.
    // org_id is typically a simple identifier (e.g., "default", "o2_pkce_state")
    // and should not contain slashes. If org_id contains '/', parsing will fail.
    format!("{org_id}/{key}")
}

pub async fn get(org_id: &str, key: &str) -> Result<Bytes, anyhow::Error> {
    let cache_key = mk_cache_key(org_id, key);
    if let Some(it) = KVS.get(&cache_key) {
        return Ok(it.value().clone());
    }

    // Get from database table
    let val = match infra::table::kv_store::get(org_id, key).await? {
        Some(model) => Bytes::from(model.value),
        None => return Err(anyhow::anyhow!("Key not found")),
    };

    KVS.insert(cache_key, val.clone());
    Ok(val)
}

pub async fn set(org_id: &str, key: &str, val: Bytes) -> Result<(), anyhow::Error> {
    // Validate that org_id doesn't contain '/' to prevent parsing issues
    if org_id.contains('/') {
        return Err(anyhow::anyhow!("org_id cannot contain '/' character"));
    }

    let cache_key = mk_cache_key(org_id, key);

    infra::table::kv_store::set(org_id, key, &val).await?;

    // Send to super cluster (if enabled)
    #[cfg(feature = "enterprise")]
    super_cluster::emit_put_event(org_id, key, val.clone()).await?;

    // Publish event to coordinator for cluster cache synchronization
    // NOTE: put_into_db_coordinator handles local vs cluster mode:
    // - In local mode: stores actual value
    // - In cluster mode: stores empty bytes (coordinator is just event bus)
    // The actual KV data is stored in the kv_store table; watchers fetch from there.
    let coord_key = format!("/kv/{}", cache_key);
    if let Err(e) = put_into_db_coordinator(&coord_key, Bytes::new(), true, None).await {
        log::error!("[KV] Failed to sync KV to coordinator: {coord_key} - {e}");
    }

    KVS.insert(cache_key, val);
    Ok(())
}

pub async fn delete(org_id: &str, key: &str) -> Result<(), anyhow::Error> {
    let cache_key = mk_cache_key(org_id, key);
    KVS.remove(&cache_key);

    infra::table::kv_store::delete(org_id, key).await?;

    // Send to super cluster (if enabled)
    #[cfg(feature = "enterprise")]
    super_cluster::emit_delete_event(org_id, key).await?;

    // Publish delete event to coordinator for cluster cache synchronization
    let coord_key = format!("/kv/{}", cache_key);
    if let Err(e) = delete_from_db_coordinator(&coord_key, false, true, None).await {
        log::error!("[KV] Failed to delete KV from coordinator: {coord_key} - {e}");
    }

    Ok(())
}

pub async fn list_keys(org_id: &str, prefix: &str) -> Result<Vec<String>, anyhow::Error> {
    let prefix = if prefix.ends_with('*') {
        prefix.strip_suffix('*').unwrap()
    } else {
        prefix
    };

    // List from database table
    let keys = infra::table::kv_store::list(org_id, prefix).await?;
    Ok(keys)
}

/// Watch function for KV changes
///
/// This function watches the `/kv/` path in the coordinator for event notifications.
/// When a put/delete event is received, it fetches the actual data from the `kv_store`
/// table (primary storage) and updates the local cache.
///
/// The coordinator only stores empty values for event notification purposes.
/// Actual KV data is stored in the `kv_store` table.
pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/kv/";
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching kv");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_kv: event channel closed");
                return Ok(());
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                // Parse org_id and key from item_key (format: "org_id/key")
                let parts: Vec<&str> = item_key.splitn(2, '/').collect();
                if parts.len() != 2 {
                    log::error!("Invalid kv key format: {}", item_key);
                    continue;
                }
                let (org_id, kv_key) = (parts[0], parts[1]);

                // Fetch actual value from kv_store table (primary storage)
                let item_value = match infra::table::kv_store::get(org_id, kv_key).await {
                    Ok(Some(model)) => Bytes::from(model.value),
                    Ok(None) => {
                        log::error!("KV key not found in table: {}", item_key);
                        continue;
                    }
                    Err(e) => {
                        log::error!("Error getting kv value from table: {e}");
                        continue;
                    }
                };
                KVS.insert(item_key.to_string(), item_value);
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                KVS.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
}

/// Super cluster support for KV operations
#[cfg(feature = "enterprise")]
mod super_cluster {
    use bytes::Bytes;
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

    /// Sends KV put event to super cluster queue
    pub async fn emit_put_event(
        org_id: &str,
        key: &str,
        value: Bytes,
    ) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            let coord_key = format!("/kv/{}/{}", org_id, key);
            o2_enterprise::enterprise::super_cluster::queue::put(&coord_key, value, true, None)
                .await
                .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Sends KV delete event to super cluster queue
    pub async fn emit_delete_event(org_id: &str, key: &str) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            let coord_key = format!("/kv/{}/{}", org_id, key);
            o2_enterprise::enterprise::super_cluster::queue::delete(&coord_key, false, true, None)
                .await
                .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }
}
