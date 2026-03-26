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

use config::SOURCEMAP_MEM_CACHE_SIZE;
use hashbrown::HashMap;
use hashlink::lru_cache::LruCache;
use infra::{
    coordinator::get_coordinator,
    db::Event,
    errors::{self, DbError},
    table::source_maps::SourceMap,
};
use once_cell::sync::Lazy;
use parquet::data_type::AsBytes;
use serde::Serialize;
use tokio::sync::RwLock;

use crate::service::db;

// DBKey to set sourcemaps keys
pub const SOURCEMAP_PREFIX: &str = "/sourcemaps/";

pub const SOURCEMAP_VALUES_LIMIT: u64 = 10;

type SourceMapKey = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
);

#[derive(Serialize, Clone)]
pub struct ParamValues {
    services: Vec<String>,
    envs: Vec<String>,
    versions: Vec<String>,
}

static CACHE: Lazy<RwLock<LruCache<SourceMapKey, SourceMap>>> =
    Lazy::new(|| RwLock::new(LruCache::new(SOURCEMAP_MEM_CACHE_SIZE)));

static VALUES_CACHE: Lazy<RwLock<HashMap<String, ParamValues>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

pub async fn add_many(entries: Vec<SourceMap>) -> Result<(), anyhow::Error> {
    if entries.is_empty() {
        return Ok(());
    }
    match infra::table::source_maps::add_many(entries.clone()).await {
        Ok(_) => {}
        Err(errors::Error::DbError(DbError::UniqueViolation)) => {
            return Err(anyhow::anyhow!("One of the sourcemaps already exists"));
        }
        Err(e) => {
            log::info!("error while saving sourcemap to db : {e}");
            return Err(anyhow::anyhow!(e));
        }
    }
    let org = entries[0].org.clone();

    {
        let mut cache = CACHE.write().await;
        for entry in &entries {
            let key = (
                entry.org.clone(),
                entry.service.clone(),
                entry.env.clone(),
                entry.version.clone(),
                entry.source_map_file_name.clone(),
            );
            cache.insert(key, entry.clone());
        }
    }

    {
        let mut cache = VALUES_CACHE.write().await;
        cache.remove(&org);
        drop(cache);
    }

    for entry in entries {
        // trigger watch event by putting value to cluster coordinator
        let cluster_coordinator = get_coordinator().await;
        cluster_coordinator
            .put(
                SOURCEMAP_PREFIX,
                serde_json::to_vec(&entry)?.into(),
                true,
                None,
            )
            .await?;

        #[cfg(feature = "enterprise")]
        {
            let config = o2_enterprise::enterprise::common::config::get_config();
            if config.super_cluster.enabled {
                match o2_enterprise::enterprise::super_cluster::queue::add_sourcemap(entry.clone())
                    .await
                {
                    Ok(_) => {
                        log::info!(
                            "successfully sent sourcemap add notification to super cluster queue for {}/{}",
                            entry.org,
                            entry.source_map_file_name
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "error in sending sourcemap add notification to super cluster queue for {}/{} : {e}",
                            entry.org,
                            entry.source_map_file_name
                        );
                    }
                }
            }
        }
    }

    Ok(())
}

pub async fn get_sourcemap_file(
    org: &str,
    source_file: &str,
    service: &Option<String>,
    env: &Option<String>,
    version: &Option<String>,
) -> Result<Option<SourceMap>, anyhow::Error> {
    let k = (
        org.to_string(),
        service.to_owned(),
        env.to_owned(),
        version.to_owned(),
        source_file.to_string(),
    );
    {
        // because we use LRU cache, we must use write, it even get needs to update
        // the lru access time
        let mut cache = CACHE.write().await;
        if let Some(v) = cache.get(&k) {
            return Ok(Some(v.clone()));
        }
    }

    let ret =
        infra::table::source_maps::get_sourcemap_file(org, source_file, service, env, version)
            .await?;

    if let Some(v) = &ret {
        {
            let mut cache = CACHE.write().await;
            cache.insert(k, v.clone());
        }
    }

    Ok(ret)
}

pub async fn list_files(
    org: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
) -> Result<Vec<SourceMap>, errors::Error> {
    let ret = infra::table::source_maps::list_files(org, service, env, version).await?;
    Ok(ret)
}

pub async fn delete_group(
    org: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
) -> Result<(), errors::Error> {
    infra::table::source_maps::delete_group(org, service.clone(), env.clone(), version.clone())
        .await?;

    {
        let mut cache = CACHE.write().await;
        let mut keys = Vec::new();
        for (k, _) in cache.iter() {
            let (org_id, s, e, v, _) = &k;
            if org_id == org && s == &service && e == &env && v == &version {
                keys.push(k.clone());
            }
        }
        for k in keys {
            cache.remove(&k);
        }
    }

    {
        let mut cache = VALUES_CACHE.write().await;
        cache.remove(org);
        drop(cache);
    }

    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .delete(
            &format!(
                "{SOURCEMAP_PREFIX}{org}/{}/{}/{}",
                service.as_deref().unwrap_or(""),
                env.as_deref().unwrap_or(""),
                version.as_deref().unwrap_or("")
            ),
            false,
            true,
            None,
        )
        .await?;

    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::delete_sourcemaps(
                org,
                service.clone(),
                env.clone(),
                version.clone(),
            )
            .await
            {
                Ok(_) => {
                    log::info!(
                        "successfully sent sourcemap delete notification to super cluster queue for {org}/{}/{}/{}",
                        service.unwrap_or_default(),
                        env.unwrap_or_default(),
                        version.unwrap_or_default()
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending sourcemap delete notification to super cluster queue for {org}/{}/{}/{} : {e}",
                        service.unwrap_or_default(),
                        env.unwrap_or_default(),
                        version.unwrap_or_default()
                    );
                }
            }
        }
    }

    Ok(())
}

pub async fn update_file_cluster(entry: SourceMap) -> Result<(), anyhow::Error> {
    infra::table::source_maps::update_cluster(entry.clone()).await?;

    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .put(
            SOURCEMAP_PREFIX,
            serde_json::to_vec(&entry)?.into(),
            true,
            None,
        )
        .await?;

    // no need for super cluster, as this update is only for local db

    Ok(())
}

pub async fn list_values(org_id: &str) -> Result<ParamValues, anyhow::Error> {
    {
        let cache = VALUES_CACHE.read().await;
        if let Some(v) = cache.get(org_id) {
            return Ok(v.clone());
        }
    }

    let res = infra::table::source_maps::get_values(org_id, SOURCEMAP_VALUES_LIMIT).await?;
    let ret = ParamValues {
        services: res.0,
        envs: res.1,
        versions: res.2,
    };

    {
        let mut cache = VALUES_CACHE.write().await;
        cache.insert(org_id.to_string(), ret.clone());
    }

    Ok(ret)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let prefix = SOURCEMAP_PREFIX;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(prefix).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching sourcemaps keys");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_sourcemaps: event channel closed");
                return Ok(());
            }
        };

        match ev {
            Event::Put(ev) => {
                let Some(item_v) = ev.value else {
                    log::error!("watch_sourcemaps : missing value for put");
                    continue;
                };
                let Ok(entry) = serde_json::from_slice::<SourceMap>(item_v.as_bytes()) else {
                    log::error!("watch_sourcemaps : invalid json value for put");
                    continue;
                };
                let org = entry.org.clone();

                {
                    let key = (
                        entry.org.clone(),
                        entry.service.clone(),
                        entry.env.clone(),
                        entry.version.clone(),
                        entry.source_map_file_name.clone(),
                    );
                    let mut cache = CACHE.write().await;
                    cache.insert(key, entry);
                }
                {
                    let mut cache = VALUES_CACHE.write().await;
                    cache.remove(&org);
                    drop(cache);
                }
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(prefix).unwrap();
                let splits: Vec<_> = item_key.split("/").collect();
                if splits.len() != 4 {
                    log::error!("watch_sourcemaps : invalid key {item_key} for delete");
                    continue;
                }
                let org = splits[0];
                let service = splits[1];
                let env = splits[2];
                let version = splits[3];
                {
                    let mut cache = CACHE.write().await;
                    let mut keys = Vec::new();
                    for (k, _) in cache.iter() {
                        let (org_id, s, e, v, _) = &k;
                        if org_id == org
                            && s.as_deref().unwrap_or("") == service
                            && e.as_deref().unwrap_or("") == env
                            && v.as_deref().unwrap_or("") == version
                        {
                            keys.push(k.clone());
                        }
                    }
                    for k in keys {
                        cache.remove(&k);
                    }
                }
                {
                    let mut cache = VALUES_CACHE.write().await;
                    cache.remove(org);
                    drop(cache);
                }
            }
            Event::Empty => {}
        }
    }
}
