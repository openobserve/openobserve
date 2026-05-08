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

use infra::{db, table::org_ingestion_tokens};

use crate::common::infra::config::ORG_INGESTION_TOKENS;

const ORG_INGESTION_TOKENS_KEY_PREFIX: &str = "/org_ingestion_tokens/";

/// Bootstrap the org ingestion token cache from the database.
pub async fn cache() -> Result<(), anyhow::Error> {
    let records = org_ingestion_tokens::list_all_enabled().await?;
    for (org_id, token, name) in records {
        ORG_INGESTION_TOKENS.insert(cache_key(&org_id, &token), name);
    }
    log::info!("Org ingestion tokens cached: {}", ORG_INGESTION_TOKENS.len());
    Ok(())
}

/// Watch for cluster-wide cache invalidation events.
pub async fn watch() -> Result<(), anyhow::Error> {
    let key = ORG_INGESTION_TOKENS_KEY_PREFIX;
    let cluster_coordinator = db::get_coordinator().await;
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
                // Key format: "org_id/token" — fetch name from DB, then cache.
                let parts: Vec<&str> = item_key.splitn(2, '/').collect();
                if parts.len() == 2 {
                    if let Ok(Some(record)) =
                        org_ingestion_tokens::find_by_token(parts[0], parts[1]).await
                    {
                        ORG_INGESTION_TOKENS.insert(item_key.to_string(), record.name);
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

#[inline]
pub fn cache_key(org_id: &str, token: &str) -> String {
    format!("{}/{}", org_id, token)
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
    fn test_cache_key_empty_org() {
        let key = cache_key("", "o2oi_token");
        assert_eq!(key, "/o2oi_token");
    }
}
