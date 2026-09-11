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
use common::infra::config::{ORG_INGESTION_TOKENS, SPLUNK_HEC_TOKENS};
use infra::{
    db::{self, delete_from_db_coordinator, get_coordinator, put_into_db_coordinator},
    table::org_ingestion_tokens::{self, OrgIngestionTokenListRecord, OrgIngestionTokenRecord},
};

const ORG_INGESTION_TOKENS_KEY_PREFIX: &str = "/org_ingestion_tokens/";
/// Matches `DEFAULT_TOKEN_CACHE_TTL` in the table layer.
const SPLUNK_TOKEN_RELOAD_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);

#[inline]
pub fn cache_key(org_id: &str, token: &str) -> String {
    format!("{}/{}", org_id, token)
}

fn event_key(org_id: &str, token: &str) -> String {
    format!("{ORG_INGESTION_TOKENS_KEY_PREFIX}{}/{}", org_id, token)
}

/// Mirror one row's Splunk GUID into the lookup map, or evict it.
fn sync_splunk_token(record: &OrgIngestionTokenRecord, enabled: bool) {
    let Some(guid) = record.splunk_token.clone().flatten() else {
        return;
    };
    if enabled {
        SPLUNK_HEC_TOKENS.insert(guid, (record.org_id.clone(), record.id.clone()));
    } else {
        SPLUNK_HEC_TOKENS.remove(&guid);
    }
}

/// Drop one org's tokens from both local lookup maps.
///
/// Neither map has a TTL and the validator answers from a cache hit before any
/// DB lookup, so a row deleted without this stays usable on every node forever.
fn evict_token_caches(org_id: &str, records: &[OrgIngestionTokenListRecord]) {
    for record in records {
        ORG_INGESTION_TOKENS.remove(&cache_key(org_id, &record.token));
        if let Some(guid) = &record.splunk_token {
            SPLUNK_HEC_TOKENS.remove(guid);
        }
    }
}

/// Insert a new org ingestion token and notify the cluster.
pub async fn add(record: &OrgIngestionTokenRecord) -> Result<(), anyhow::Error> {
    org_ingestion_tokens::add(record).await?;
    let key = event_key(&record.org_id, &record.token);
    let _ = put_into_db_coordinator(&key, Bytes::new(), true, None).await;
    #[cfg(feature = "enterprise")]
    super_cluster::org_ingestion_token_put(&key, record).await?;
    Ok(())
}

/// Rotate a token's value and notify the cluster.
pub async fn rotate_token(org_id: &str, name: &str) -> Result<String, anyhow::Error> {
    let existing = org_ingestion_tokens::get_by_name(org_id, name)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Token '{}' not found", name))?;

    let new_token = org_ingestion_tokens::rotate_token(org_id, name).await?;

    // Notify about old token removal
    let old_key = event_key(org_id, &existing.token);
    let _ = delete_from_db_coordinator(&old_key, false, true, None).await;

    // Notify about new token
    let new_key = event_key(org_id, &new_token);
    let _ = put_into_db_coordinator(&new_key, Bytes::new(), true, None).await;

    #[cfg(feature = "enterprise")]
    {
        super_cluster::org_ingestion_token_delete(&old_key).await?;
        // Replicate the committed row, not a patched pre-update copy, so a
        // concurrent write to another column is not replicated away.
        if let Some(committed) = org_ingestion_tokens::get_by_name(org_id, name).await? {
            super_cluster::org_ingestion_token_put(&new_key, &committed).await?;
        }
    }
    Ok(new_token)
}

/// Enable or disable a named token and notify the cluster.
pub async fn set_enabled(org_id: &str, name: &str, enabled: bool) -> Result<(), anyhow::Error> {
    let existing = org_ingestion_tokens::get_by_name(org_id, name)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Token '{}' not found", name))?;

    org_ingestion_tokens::set_enabled(org_id, name, enabled).await?;

    let key = event_key(org_id, &existing.token);
    if enabled {
        let _ = put_into_db_coordinator(&key, Bytes::new(), true, None).await;
    } else {
        let _ = delete_from_db_coordinator(&key, false, true, None).await;
    }
    // Always replicate the token with its new `enabled` state; the receiving
    // cluster fires the matching coordinator event based on the flag.
    #[cfg(feature = "enterprise")]
    if let Some(committed) = org_ingestion_tokens::get_by_name(org_id, name).await? {
        super_cluster::org_ingestion_token_put(&key, &committed).await?;
    }
    Ok(())
}

/// Generate or revoke a token's Splunk HEC GUID and notify the cluster.
///
/// Returns the new GUID, or `None` when revoked.
pub async fn set_splunk_token(
    org_id: &str,
    name: &str,
    generate: bool,
) -> Result<Option<String>, anyhow::Error> {
    let existing = org_ingestion_tokens::get_by_name(org_id, name)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Token '{}' not found", name))?;

    let new_value = generate.then(org_ingestion_tokens::generate_splunk_token);
    org_ingestion_tokens::set_splunk_token(org_id, name, new_value.clone()).await?;

    if let Some(old) = existing.splunk_token.flatten() {
        SPLUNK_HEC_TOKENS.remove(&old);
    }
    if let Some(new) = &new_value
        && existing.enabled
    {
        SPLUNK_HEC_TOKENS.insert(new.clone(), (org_id.to_string(), existing.id.clone()));
    }

    let key = event_key(org_id, &existing.token);
    let _ = put_into_db_coordinator(&key, Bytes::new(), true, None).await;

    #[cfg(feature = "enterprise")]
    if let Some(committed) = org_ingestion_tokens::get_by_name(org_id, name).await? {
        super_cluster::org_ingestion_token_put(&key, &committed).await?;
    }
    Ok(new_value)
}

/// Delete every token for an org and evict the caches cluster-wide.
///
/// The table-layer delete alone leaves each node's `ORG_INGESTION_TOKENS` /
/// `SPLUNK_HEC_TOKENS` entries resident forever (neither map has a TTL, and the
/// validator answers from a cache hit before any DB lookup), so a hard-deleted
/// org would keep ingesting on its old tokens.
pub async fn delete_by_org(org_id: &str) -> Result<(), anyhow::Error> {
    let existing = org_ingestion_tokens::list_by_org(org_id).await?;

    org_ingestion_tokens::delete_by_org(org_id).await?;

    evict_token_caches(org_id, &existing);

    for record in &existing {
        let key = event_key(org_id, &record.token);
        let _ = delete_from_db_coordinator(&key, false, true, None).await;
        #[cfg(feature = "enterprise")]
        super_cluster::org_ingestion_token_delete(&key).await?;
    }
    Ok(())
}

/// Find an enabled token by org_id and token value.
pub async fn find_enabled_token(
    org_id: &str,
    token: &str,
) -> Result<Option<OrgIngestionTokenRecord>, anyhow::Error> {
    org_ingestion_tokens::find_enabled_token(org_id, token)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))
}

/// Get a single token record by org_id and name.
pub async fn get_by_name(
    org_id: &str,
    name: &str,
) -> Result<Option<OrgIngestionTokenRecord>, anyhow::Error> {
    org_ingestion_tokens::get_by_name(org_id, name)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))
}

/// List all tokens for an org.
pub async fn list_by_org(org_id: &str) -> Result<Vec<OrgIngestionTokenListRecord>, anyhow::Error> {
    org_ingestion_tokens::list_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))
}

/// Bootstrap the org ingestion token cache from the database.
pub async fn cache() -> Result<(), anyhow::Error> {
    let records = org_ingestion_tokens::list_all_enabled().await?;
    for (org_id, token, name) in records {
        ORG_INGESTION_TOKENS.insert(cache_key(&org_id, &token), name);
    }
    log::info!(
        "Org ingestion tokens cached: {}",
        ORG_INGESTION_TOKENS.len()
    );
    reload_splunk_tokens().await
}

/// Rebuild the Splunk HEC token map from the database, dropping stale entries.
pub async fn reload_splunk_tokens() -> Result<(), anyhow::Error> {
    let records = org_ingestion_tokens::list_all_enabled_splunk().await?;
    let mut seen = std::collections::HashSet::with_capacity(records.len());
    for (splunk_token, org_id, id) in records {
        seen.insert(splunk_token.clone());
        SPLUNK_HEC_TOKENS.insert(splunk_token, (org_id, id));
    }
    SPLUNK_HEC_TOKENS.retain(|guid, _| seen.contains(guid));
    Ok(())
}

/// Periodic full reload of the Splunk HEC token map.
///
/// Coordinator put/delete failures are discarded by every write path here, and
/// `watch` exits `Ok(())` when its channel closes, so a lost event would
/// otherwise leave the map wrong forever with nothing to repair it.
pub async fn run_splunk_token_reload() -> Result<(), anyhow::Error> {
    let mut interval = tokio::time::interval(SPLUNK_TOKEN_RELOAD_INTERVAL);
    interval.tick().await;
    loop {
        interval.tick().await;
        if let Err(e) = reload_splunk_tokens().await {
            log::error!("[SPLUNK_HEC] failed to reload splunk token cache: {e}");
        }
    }
}

/// Watch for cluster-wide cache invalidation events.
pub async fn watch() -> Result<(), anyhow::Error> {
    let key = ORG_INGESTION_TOKENS_KEY_PREFIX;
    let cluster_coordinator = get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching org_ingestion_tokens");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_org_ingestion_tokens: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let parts: Vec<&str> = item_key.splitn(2, '/').collect();
                if parts.len() == 2 {
                    // Also drop the org -> default-token pick, which synthetics
                    // reads once per job. Reusing this existing watch means a
                    // rotate or disable on another node lands here without a
                    // second event stream.
                    org_ingestion_tokens::invalidate_default_cache(parts[0]);
                    // find_enabled_token only returns enabled tokens.
                    // If found → token is enabled → cache it.
                    // If not found → token is disabled/missing → remove from cache.
                    if let Ok(Some(record)) =
                        org_ingestion_tokens::find_enabled_token(parts[0], parts[1]).await
                    {
                        sync_splunk_token(&record, true);
                        ORG_INGESTION_TOKENS.insert(item_key.to_string(), record.name);
                    } else {
                        if let Ok(Some(record)) =
                            org_ingestion_tokens::find_token_any_state(parts[0], parts[1]).await
                        {
                            sync_splunk_token(&record, false);
                        }
                        ORG_INGESTION_TOKENS.remove(item_key);
                    }
                }
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                if let Some((org_id, token)) = item_key.split_once('/') {
                    org_ingestion_tokens::invalidate_default_cache(org_id);
                    if let Ok(Some(record)) =
                        org_ingestion_tokens::find_token_any_state(org_id, token).await
                    {
                        sync_splunk_token(&record, false);
                    }
                }
                ORG_INGESTION_TOKENS.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

#[cfg(feature = "enterprise")]
mod super_cluster {
    use config::utils::json;
    use infra::{errors::Error, table::org_ingestion_tokens::OrgIngestionTokenRecord};
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

    /// Replicate a token (with its current `enabled` state) to other clusters on
    /// the `org_users` topic. The receiving cluster upserts the row and fires the
    /// appropriate coordinator event based on the record's `enabled` flag.
    pub async fn org_ingestion_token_put(
        key: &str,
        record: &OrgIngestionTokenRecord,
    ) -> Result<(), Error> {
        if get_o2_config().super_cluster.enabled {
            let value = json::to_vec(record)?.into();
            o2_enterprise::enterprise::super_cluster::queue::org_ingestion_token_put(
                key,
                value,
                infra::db::NEED_WATCH,
                None,
            )
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Replicate a token removal (e.g. the old value after a rotation) to other
    /// clusters on the `org_users` topic.
    pub async fn org_ingestion_token_delete(key: &str) -> Result<(), Error> {
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::org_ingestion_token_delete(
                key,
                infra::db::NEED_WATCH,
                None,
            )
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_key_format() {
        let key = cache_key("default", "o2oi_abc123");
        assert_eq!(key, "default/o2oi_abc123");
    }

    #[test]
    fn test_cache_key_with_special_org_id() {
        let key = cache_key("acme-corp", "o2oi_token");
        assert_eq!(key, "acme-corp/o2oi_token");
    }

    #[test]
    fn test_event_key_format() {
        let key = event_key("default", "o2oi_abc123");
        assert_eq!(key, "/org_ingestion_tokens/default/o2oi_abc123");
    }

    fn list_record(token: &str, splunk_token: Option<&str>) -> OrgIngestionTokenListRecord {
        OrgIngestionTokenListRecord {
            name: token.to_string(),
            token: token.to_string(),
            description: String::new(),
            is_default: false,
            enabled: true,
            created_by: String::new(),
            created_at: 0,
            splunk_token: splunk_token.map(str::to_string),
        }
    }

    /// A cached token outliving its deleted org is how a hard-deleted org keeps
    /// ingesting: the validator answers from a cache hit before any DB lookup.
    #[test]
    fn evict_token_caches_drops_only_the_named_org() {
        ORG_INGESTION_TOKENS.insert(cache_key("gone", "o2oi_a"), "a".to_string());
        ORG_INGESTION_TOKENS.insert(cache_key("gone", "o2oi_b"), "b".to_string());
        ORG_INGESTION_TOKENS.insert(cache_key("kept", "o2oi_c"), "c".to_string());
        SPLUNK_HEC_TOKENS.insert(
            "guid-a".to_string(),
            ("gone".to_string(), "id-a".to_string()),
        );
        SPLUNK_HEC_TOKENS.insert(
            "guid-c".to_string(),
            ("kept".to_string(), "id-c".to_string()),
        );

        evict_token_caches(
            "gone",
            &[
                list_record("o2oi_a", Some("guid-a")),
                list_record("o2oi_b", None),
            ],
        );

        assert!(!ORG_INGESTION_TOKENS.contains_key(&cache_key("gone", "o2oi_a")));
        assert!(!ORG_INGESTION_TOKENS.contains_key(&cache_key("gone", "o2oi_b")));
        assert!(!SPLUNK_HEC_TOKENS.contains_key("guid-a"));
        assert!(ORG_INGESTION_TOKENS.contains_key(&cache_key("kept", "o2oi_c")));
        assert!(SPLUNK_HEC_TOKENS.contains_key("guid-c"));

        ORG_INGESTION_TOKENS.remove(&cache_key("kept", "o2oi_c"));
        SPLUNK_HEC_TOKENS.remove("guid-c");
    }

    /// A token row with no GUID must not take an unrelated Splunk entry with it.
    #[test]
    fn evict_token_caches_leaves_other_guids_alone() {
        SPLUNK_HEC_TOKENS.insert(
            "guid-other".to_string(),
            ("other".to_string(), "id".to_string()),
        );
        evict_token_caches("gone", &[list_record("o2oi_x", None)]);
        assert!(SPLUNK_HEC_TOKENS.contains_key("guid-other"));
        SPLUNK_HEC_TOKENS.remove("guid-other");
    }
}
