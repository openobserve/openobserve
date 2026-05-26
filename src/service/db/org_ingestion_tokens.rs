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
use infra::{
    db::{self, delete_from_db_coordinator, get_coordinator, put_into_db_coordinator},
    table::org_ingestion_tokens::{self, OrgIngestionTokenListRecord, OrgIngestionTokenRecord},
};

use crate::common::infra::config::ORG_INGESTION_TOKENS;

const ORG_INGESTION_TOKENS_KEY_PREFIX: &str = "/org_ingestion_tokens/";

#[inline]
pub fn cache_key(org_id: &str, token: &str) -> String {
    format!("{}/{}", org_id, token)
}

fn event_key(org_id: &str, token: &str) -> String {
    format!("{ORG_INGESTION_TOKENS_KEY_PREFIX}{}/{}", org_id, token)
}

/// Insert a new org ingestion token and notify the cluster.
pub async fn add(record: &OrgIngestionTokenRecord) -> Result<(), anyhow::Error> {
    org_ingestion_tokens::add(record).await?;
    let key = event_key(&record.org_id, &record.token);
    let _ = put_into_db_coordinator(&key, Bytes::new(), true, None).await;
    #[cfg(feature = "enterprise")]
    super_cluster::org_ingestion_token_put(&key).await?;
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
        super_cluster::org_ingestion_token_put(&new_key).await?;
    }
    Ok(new_token)
}

/// Enable or disable a named token and notify the cluster.
pub async fn set_enabled(
    org_id: &str,
    name: &str,
    enabled: bool,
) -> Result<(), anyhow::Error> {
    let existing = org_ingestion_tokens::get_by_name(org_id, name)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Token '{}' not found", name))?;

    org_ingestion_tokens::set_enabled(org_id, name, enabled).await?;

    let key = event_key(org_id, &existing.token);
    if enabled {
        let _ = put_into_db_coordinator(&key, Bytes::new(), true, None).await;
        #[cfg(feature = "enterprise")]
        super_cluster::org_ingestion_token_put(&key).await?;
    } else {
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
pub async fn list_by_org(
    org_id: &str,
) -> Result<Vec<OrgIngestionTokenListRecord>, anyhow::Error> {
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
    Ok(())
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
                    // find_enabled_token only returns enabled tokens.
                    // If found → token is enabled → cache it.
                    // If not found → token is disabled/missing → remove from cache.
                    if let Ok(Some(record)) =
                        org_ingestion_tokens::find_enabled_token(parts[0], parts[1]).await
                    {
                        ORG_INGESTION_TOKENS.insert(item_key.to_string(), record.name);
                    } else {
                        ORG_INGESTION_TOKENS.remove(item_key);
                    }
                }
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                ORG_INGESTION_TOKENS.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

#[cfg(feature = "enterprise")]
mod super_cluster {
    use infra::errors::Error;

    pub async fn org_ingestion_token_put(key: &str) -> Result<(), Error> {
        if o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
        {
            o2_enterprise::enterprise::super_cluster::queue::put(
                key,
                bytes::Bytes::new(),
                infra::db::NEED_WATCH,
                None,
            )
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    pub async fn org_ingestion_token_delete(key: &str) -> Result<(), Error> {
        if o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
        {
            o2_enterprise::enterprise::super_cluster::queue::delete(
                key,
                false,
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
}
