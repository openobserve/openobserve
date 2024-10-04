// Copyright 2024 Zinc Labs Inc.
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

use anyhow::anyhow;
use config::utils::json;
use infra::db::Event;

use crate::{
    common::infra::config::URL_MAP,
    service::db::{self},
};

// DBKey to set short URL's
pub const SHORT_URL_KEY: &str = "/short_urls/";

pub async fn get(short_id: &str) -> Result<String, anyhow::Error> {
    match URL_MAP.get(short_id) {
        Some(val) => Ok(val.to_string()),
        None => {
            let val = db::get(&format!("{SHORT_URL_KEY}{short_id}"))
                .await
                .map_err(|_| anyhow!("Short URL not found in db"))?;

            let original_url: String = json::from_slice(&val)
                .map_err(|_| anyhow!("Failed to deserialize original url from db"))?;

            URL_MAP.insert(short_id.to_string(), original_url.clone());

            Ok(original_url)
        }
    }
}

pub async fn set(short_id: &str, original_url: &str) -> Result<(), anyhow::Error> {
    URL_MAP.insert(short_id.to_string(), original_url.to_string());

    db::put(
        &format!("{SHORT_URL_KEY}{short_id}"),
        json::to_vec(&original_url).unwrap().into(),
        db::NEED_WATCH,
        None,
    )
    .await?;

    Ok(())
}

pub async fn get_by_original_url(original_url: &str) -> Option<String> {
    if let Some(short_id) = URL_MAP.iter().find_map(|entry| {
        let (k, v) = entry.pair();
        if v == original_url {
            return Some(k.clone());
        }
        None
    }) {
        return Some(short_id);
    }

    let original_url = original_url.to_string();
    // TODO: Verify this operation
    match db::get(&format!("{SHORT_URL_KEY}{original_url}")).await {
        Ok(val) => match json::from_slice::<String>(&val) {
            Ok(short_id) => {
                URL_MAP.insert(short_id.clone(), original_url.clone());
                Some(short_id)
            }
            Err(e) => {
                log::error!(
                    "Failed to deserialize short_id for original_url from db: {}",
                    e
                );
                None
            }
        },
        Err(e) => {
            log::error!("Original URL not found in db: {}", e);
            None
        }
    }
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = SHORT_URL_KEY;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching short URLs");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_short_url: event channel closed");
                return Ok(());
            }
        };

        match ev {
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value = if config::get_config().common.meta_store_external {
                    match db::get(&ev.key).await {
                        Ok(val) => match json::from_slice(&val) {
                            Ok(val) => val,
                            Err(e) => {
                                log::error!("Error getting value: {}", e);
                                continue;
                            }
                        },
                        Err(e) => {
                            log::error!("Error getting value: {}", e);
                            continue;
                        }
                    }
                } else {
                    json::from_slice(&ev.value.unwrap()).unwrap()
                };
                URL_MAP.insert(item_key.to_string(), item_value);
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                URL_MAP.remove(item_key);
            }
            Event::Empty => {}
        }
    }
}

/// Preload all short URLs from the database into the cache at startup.
pub async fn cache() -> Result<(), anyhow::Error> {
    let key = SHORT_URL_KEY;
    let ret = db::list(key).await?;
    for (item_key, item_value) in ret {
        let short_id = item_key.strip_prefix(key).unwrap();
        let original_url: String = json::from_slice(&item_value).unwrap();
        URL_MAP.insert(short_id.to_owned(), original_url);
    }
    log::info!("Short URLs Cached");
    Ok(())
}
