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

use std::sync::{Arc, LazyLock as Lazy};

use hashbrown::HashMap;
use infra::{
    coordinator::get_coordinator, db::Event, table::org_storage_providers::OrgStorageProvider,
};
use parquet::data_type::AsBytes;
use tokio::sync::RwLock;

use crate::service::db;

// DBKey to set sourcemaps keys
pub const OSP_PREFIX: &str = "/org_storage_providers/";

static CACHE: Lazy<RwLock<HashMap<String, Option<OrgStorageProvider>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

pub async fn add(entry: OrgStorageProvider) -> Result<(), anyhow::Error> {
    match infra::table::org_storage_providers::add(entry.clone()).await {
        Ok(_) => {}
        Err(e) => {
            log::info!(
                "error while saving storage provider for org {} to db : {e}",
                entry.org_id
            );
            return Err(anyhow::anyhow!(e));
        }
    }

    {
        let mut cache = CACHE.write().await;
        cache.insert(entry.org_id.clone(), Some(entry.clone()));
    }

    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .put(OSP_PREFIX, serde_json::to_vec(&entry)?.into(), true, None)
        .await?;
    // no need for SC, as org storage is cluster scoped
    Ok(())
}

pub async fn get_for_org(org_id: &str) -> Result<Option<OrgStorageProvider>, anyhow::Error> {
    {
        let cache = CACHE.read().await;
        if let Some(v) = cache.get(org_id) {
            return Ok(v.clone());
        }
    }

    let ret = infra::table::org_storage_providers::get_for_org(org_id).await?;

    // usually we would not insert None in the cache, however given that storage providers will
    // rarely change and the get for these are on hot paths like search , compaction, ingestion etc
    // we do store None and handler the cache invalidation in nats queue handlers
    // that way we don't hit db each time for an org which does not have a provider, instead we hit
    // it once, cache the None, and keep it till  org sets a provider
    {
        let mut cache = CACHE.write().await;
        cache.insert(org_id.to_string(), ret.clone());
    }

    Ok(ret)
}

pub async fn list_all() -> Result<Vec<OrgStorageProvider>, anyhow::Error> {
    let ret = infra::table::org_storage_providers::list_all().await?;
    Ok(ret)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let prefix = OSP_PREFIX;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(prefix).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching org_storage_providers");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_org_storage_providers: event channel closed");
                return Ok(());
            }
        };

        match ev {
            Event::Put(ev) => {
                let Some(item_v) = ev.value else {
                    log::error!("watch_org_storage_providers : missing value for put");
                    continue;
                };
                let Ok(entry) = serde_json::from_slice::<OrgStorageProvider>(item_v.as_bytes())
                else {
                    log::error!("watch_org_storage_providers : invalid json value for put");
                    continue;
                };
                let org = entry.org_id.clone();

                let provider = match super::super::org_storage_providers::get_provider(
                    &org,
                    entry.provider_type,
                    &entry.data,
                )
                .await
                {
                    Ok(v) => v,
                    Err(e) => {
                        log::error!(
                            "[org_storage] error getting provider for org {org} which was synced via events, skipping update : {e}"
                        );
                        continue;
                    }
                };
                log::info!("[org_storage]: received provider info via nats org {org}");
                infra::storage::add_account(&org, provider).await;

                // we must invalidate the infra level cache, or there be dragons!
                infra::table::org_storage_providers::update_cache(&org, entry.clone());

                {
                    let mut cache = CACHE.write().await;
                    cache.insert(org, Some(entry));
                }
            }
            Event::Delete(ev) => {
                log::error!(
                    "watch_org_storage_providers: delete is not supported, yet received for key {}",
                    ev.key
                );
            }
            Event::Empty => {}
        }
    }
}
