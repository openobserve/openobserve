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

use std::sync::Arc;

use bytes::Bytes;
use common::infra::config::KVS;
use infra::db::{delete_from_db_coordinator, put_into_db_coordinator};

use crate as db;

fn mk_cache_key(org_id: &str, key: &str) -> String {
    // NOTE: This assumes org_id does not contain '/' character.
    // org_id is typically a simple identifier (e.g., "default", "o2_pkce_state")
    // and should not contain slashes. If org_id contains '/', parsing will fail.
    format!("{org_id}/{key}")
}

pub async fn get(org_id: &str, key: &str) -> Result<Bytes, anyhow::Error> {
    let cache_key = mk_cache_key(org_id, key);
    if cacheable(key)
        && let Some(it) = KVS.get(&cache_key)
    {
        return Ok(it.value().clone());
    }

    // Get from database table
    let val = match infra::table::kv_store::get(org_id, key).await? {
        Some(model) => Bytes::from(model.value),
        None => return Err(anyhow::anyhow!("Key not found")),
    };

    cache(cache_key, key, val.clone());
    Ok(val)
}

pub async fn set(org_id: &str, key: &str, val: Bytes) -> Result<(), anyhow::Error> {
    // Validate that org_id doesn't contain '/' to prevent parsing issues
    if org_id.contains('/') {
        return Err(anyhow::anyhow!("org_id cannot contain '/' character"));
    }

    infra::table::kv_store::set(org_id, key, &val).await?;
    announce_put(org_id, key, val).await
}

/// Writes and replicates only while the stored value is `expected` (None: no row); false otherwise.
pub async fn compare_and_set(
    org_id: &str,
    key: &str,
    expected: Option<&[u8]>,
    val: Bytes,
) -> Result<bool, anyhow::Error> {
    if org_id.contains('/') {
        return Err(anyhow::anyhow!("org_id cannot contain '/' character"));
    }
    if !infra::table::kv_store::compare_and_set(org_id, key, expected, &val).await? {
        return Ok(false);
    }
    announce_put(org_id, key, val).await?;
    Ok(true)
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

#[cfg(feature = "enterprise")]
pub async fn compare_and_delete(
    org_id: &str,
    key: &str,
    expected: &[u8],
) -> Result<bool, anyhow::Error> {
    if !infra::table::kv_store::compare_and_delete(org_id, key, expected).await? {
        return Ok(false);
    }
    let cache_key = mk_cache_key(org_id, key);
    KVS.remove(&cache_key);
    super_cluster::emit_delete_event(org_id, key).await?;
    let coord_key = format!("/kv/{cache_key}");
    coordinator_notification(
        key,
        delete_from_db_coordinator(&coord_key, false, true, None).await,
    )?;
    Ok(true)
}

/// One region only, and the announcement carries no bytes: a late one cannot undo a newer write.
#[cfg(feature = "enterprise")]
pub async fn compare_and_mutate_guarded(
    org_id: &str,
    key: &str,
    expected: Option<&[u8]>,
    value: Option<Bytes>,
    guard_key: &str,
    guard: &[u8],
) -> Result<bool, anyhow::Error> {
    if org_id.contains('/') {
        anyhow::bail!("org_id cannot contain '/' character");
    }
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        anyhow::bail!("a guarded write is not replicated across regions");
    }
    if !o2_enterprise::enterprise::autoobserve::marks::compare_and_mutate_guarded(
        org_id,
        key,
        expected,
        value.as_deref(),
        guard_key,
        guard,
    )
    .await?
    {
        return Ok(false);
    }
    let cache_key = mk_cache_key(org_id, key);
    KVS.remove(&cache_key);
    let coord_key = format!("/kv/{cache_key}");
    let announced = match value {
        Some(_) => put_into_db_coordinator(&coord_key, Bytes::new(), true, None).await,
        None => delete_from_db_coordinator(&coord_key, false, true, None).await,
    };
    coordinator_notification(key, announced)?;
    Ok(true)
}

/// Deletes in this region only, and only while the row still holds `expected`.
pub async fn compare_and_delete_in_region(
    org_id: &str,
    key: &str,
    expected: &[u8],
) -> Result<bool, anyhow::Error> {
    if !infra::table::kv_store::compare_and_delete(org_id, key, expected).await? {
        return Ok(false);
    }
    let cache_key = mk_cache_key(org_id, key);
    KVS.remove(&cache_key);
    let coord_key = format!("/kv/{cache_key}");
    if let Err(e) = delete_from_db_coordinator(&coord_key, false, true, None).await {
        log::error!("[KV] Failed to delete KV from coordinator: {coord_key} - {e}");
    }
    Ok(true)
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

/// Org teardown: each key's eviction goes before its row, so a failed one leaves the row to retry.
pub async fn delete_by_org(org_id: &str) -> Result<(), anyhow::Error> {
    let keys = infra::table::kv_store::list_keys_by_org(org_id).await?;
    let local = |key: String| async move {
        KVS.remove(&mk_cache_key(org_id, &key));
    };
    let broadcast = |key: String| async move {
        #[cfg(feature = "enterprise")]
        super_cluster::emit_delete_event(org_id, &key).await?;
        let cache_key = mk_cache_key(org_id, &key);
        delete_from_db_coordinator(&format!("/kv/{cache_key}"), false, true, None).await?;
        Ok::<(), anyhow::Error>(())
    };
    db::teardown::evict_then_delete(keys, &local, &broadcast, |key: String| async move {
        infra::table::kv_store::delete(org_id, &key).await?;
        Ok(())
    })
    .await?;
    // The org-wide delete names any row the listing missed, so it still loses its copies.
    for key in infra::table::kv_store::delete_by_org(org_id).await? {
        db::teardown::evict(local(key.clone()), broadcast(key)).await?;
    }
    Ok(())
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
                cache(item_key.to_string(), kv_key, item_value);
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                KVS.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
}

async fn announce_put(org_id: &str, key: &str, val: Bytes) -> Result<(), anyhow::Error> {
    let cache_key = mk_cache_key(org_id, key);

    // Send to super cluster (if enabled)
    #[cfg(feature = "enterprise")]
    super_cluster::emit_put_event(org_id, key, val.clone()).await?;

    // Publish event to coordinator for cluster cache synchronization
    // NOTE: put_into_db_coordinator handles local vs cluster mode:
    // - In local mode: stores actual value
    // - In cluster mode: stores empty bytes (coordinator is just event bus)
    // The actual KV data is stored in the kv_store table; watchers fetch from there.
    let coord_key = format!("/kv/{}", cache_key);
    coordinator_notification(
        key,
        put_into_db_coordinator(&coord_key, Bytes::new(), true, None).await,
    )?;

    cache(cache_key, key, val);
    Ok(())
}

/// Every writer and filler of the node cache goes through here, so no path caches a mark.
pub fn cache(cache_key: String, key: &str, val: Bytes) {
    if cacheable(key) {
        KVS.insert(cache_key, val);
    } else {
        KVS.remove(&cache_key);
    }
}

/// A mark's bytes are never cached: a late fill could outlast a newer write; readers use the table.
fn cacheable(key: &str) -> bool {
    !(cfg!(feature = "enterprise") && key.starts_with(config::meta::autoobserve::KV_MARK_PREFIX))
}

fn coordinator_notification(
    key: &str,
    result: Result<(), infra::errors::Error>,
) -> anyhow::Result<()> {
    if let Err(error) = result {
        log::error!("[KV] Failed to notify coordinator for {key}: {error}");
        #[cfg(feature = "enterprise")]
        {
            use config::meta::autoobserve::{
                DISMISSAL_PREFIX, KV_MARK_PREFIX, KV_SUGGESTION_PREFIX,
            };

            if [KV_MARK_PREFIX, KV_SUGGESTION_PREFIX, DISMISSAL_PREFIX]
                .iter()
                .any(|prefix| key.starts_with(prefix))
            {
                return Err(error.into());
            }
        }
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "enterprise")]
    #[test]
    fn decision_publication_reports_coordinator_failure() {
        use config::meta::autoobserve::{DISMISSAL_PREFIX, KV_MARK_PREFIX, KV_SUGGESTION_PREFIX};

        for prefix in [KV_MARK_PREFIX, KV_SUGGESTION_PREFIX, DISMISSAL_PREFIX] {
            let key = format!("{prefix}decision");
            let error = infra::errors::Error::Message("coordinator unavailable".into());
            assert!(coordinator_notification(&key, Err(error)).is_err(), "{key}");
            assert!(coordinator_notification(&key, Ok(())).is_ok());
        }
        for key in [
            "customer-key",
            "_o2_ao/mark",
            "_o2_ao/suggestion",
            "_o2_ao/dismissal",
        ] {
            let error = infra::errors::Error::Message("coordinator unavailable".into());
            assert!(coordinator_notification(key, Err(error)).is_ok(), "{key}");
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_guarded_write_caches_no_bytes_a_late_announcement_could_restore() {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
        let org = format!("t_guarded_{}", config::utils::time::now_micros());
        let key = format!("{}guarded", config::meta::autoobserve::KV_MARK_PREFIX);
        let cache_key = mk_cache_key(&org, &key);
        infra::table::kv_store::set(&org, "intent", b"held")
            .await
            .unwrap();
        KVS.insert(cache_key.clone(), Bytes::from_static(b"older"));
        let accepted = Bytes::from_static(b"accepted");
        assert!(
            compare_and_mutate_guarded(&org, &key, None, Some(accepted), "intent", b"held")
                .await
                .unwrap()
        );
        assert!(KVS.get(&cache_key).is_none(), "the writer's bytes stay out");
        assert_eq!(get(&org, &key).await.unwrap(), "accepted");
        assert!(
            compare_and_mutate_guarded(&org, &key, Some(b"accepted"), None, "intent", b"held")
                .await
                .unwrap()
        );
        assert!(KVS.get(&cache_key).is_none());
        assert!(get(&org, &key).await.is_err());
        set(&org, &key, Bytes::from_static(b"by hand"))
            .await
            .unwrap();
        assert!(
            KVS.get(&cache_key).is_none(),
            "a plain mark write caches nothing"
        );
        assert_eq!(get(&org, &key).await.unwrap(), "by hand");
        assert!(KVS.get(&cache_key).is_none(), "a mark read fills nothing");
        cache(cache_key.clone(), &key, Bytes::from_static(b"late"));
        assert!(KVS.get(&cache_key).is_none());
        infra::table::kv_store::delete_by_org(&org).await.unwrap();
    }

    #[test]
    fn test_mk_cache_key() {
        // Test basic cache key generation
        assert_eq!(mk_cache_key("org1", "key1"), "org1/key1");
        assert_eq!(mk_cache_key("default", "config"), "default/config");

        // Test with special characters in key
        assert_eq!(mk_cache_key("org", "user:alice"), "org/user:alice");

        // Test with empty strings
        assert_eq!(mk_cache_key("", "key"), "/key");
        assert_eq!(mk_cache_key("org", ""), "org/");
    }

    #[test]
    fn test_mk_cache_key_format() {
        // Verify the format is always "org_id/key"
        let result = mk_cache_key("test_org", "test_key");
        assert!(result.contains('/'));
        let parts: Vec<&str> = result.split('/').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], "test_org");
        assert_eq!(parts[1], "test_key");
    }

    #[tokio::test]
    async fn test_set_validates_org_id_with_slash() {
        // Test that org_id with '/' character is rejected
        let result = set("org/with/slash", "key", Bytes::from("value")).await;
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("org_id cannot contain '/' character")
        );
    }

    #[tokio::test]
    async fn test_set_validates_org_id_without_slash() {
        // Test that org_id without '/' passes validation
        // Note: This will fail at DB level, but validation passes
        let result = set("valid_org", "key", Bytes::from("value")).await;
        // We expect a DB error, not a validation error
        if let Err(e) = result {
            assert!(
                !e.to_string()
                    .contains("org_id cannot contain '/' character")
            );
        }
    }

    #[test]
    fn test_list_keys_prefix_without_asterisk() {
        // Test prefix without trailing asterisk (should be used as-is)
        let prefix = "user:";
        let result = if prefix.ends_with('*') {
            prefix.strip_suffix('*').unwrap()
        } else {
            prefix
        };
        assert_eq!(result, "user:");
    }

    #[test]
    fn test_list_keys_prefix_with_asterisk() {
        // Test prefix with trailing asterisk (should be stripped)
        let prefix = "user:*";
        let result = if prefix.ends_with('*') {
            prefix.strip_suffix('*').unwrap()
        } else {
            prefix
        };
        assert_eq!(result, "user:");
    }

    #[test]
    fn test_list_keys_asterisk_only() {
        // Test asterisk only
        let prefix = "*";
        let result = if prefix.ends_with('*') {
            prefix.strip_suffix('*').unwrap()
        } else {
            prefix
        };
        assert_eq!(result, "");
    }

    #[test]
    fn test_list_keys_multiple_asterisks() {
        // Test multiple asterisks (only strips last one)
        let prefix = "**";
        let result = if prefix.ends_with('*') {
            prefix.strip_suffix('*').unwrap()
        } else {
            prefix
        };
        assert_eq!(result, "*");
    }

    #[test]
    fn test_watch_key_parsing_valid() {
        // Test valid key parsing logic from watch function
        let item_key = "org1/mykey";
        let parts: Vec<&str> = item_key.splitn(2, '/').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], "org1");
        assert_eq!(parts[1], "mykey");
    }

    #[test]
    fn test_watch_key_parsing_with_slash_in_key() {
        // Test key parsing when key itself contains slashes
        let item_key = "org1/path/to/key";
        let parts: Vec<&str> = item_key.splitn(2, '/').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], "org1");
        assert_eq!(parts[1], "path/to/key");
    }

    #[test]
    fn test_watch_key_parsing_invalid() {
        // Test invalid key format (no slash)
        let item_key = "invalid_key";
        let parts: Vec<&str> = item_key.splitn(2, '/').collect();
        // Should only have 1 part
        assert_eq!(parts.len(), 1);
    }

    #[test]
    fn test_coord_key_format() {
        // Test coordinator key format generation
        let cache_key = mk_cache_key("test_org", "test_key");
        let coord_key = format!("/kv/{}", cache_key);
        assert_eq!(coord_key, "/kv/test_org/test_key");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_super_cluster_key_format() {
        // Test super cluster key format
        let org_id = "org1";
        let key = "key1";
        let coord_key = format!("/kv/{}/{}", org_id, key);
        assert_eq!(coord_key, "/kv/org1/key1");
    }
}
