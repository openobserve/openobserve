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
use bytes::Bytes;
use infra::{
    db::{Event, NEED_WATCH},
    short_url,
};

use crate::{
    common::{infra::config::SHORT_URLS, meta::short_url::ShortUrlCacheEntry},
    service::db,
};

// DBKey to set short URL's
pub const SHORT_URL_KEY: &str = "/short_urls/";

pub async fn get(short_id: &str) -> Result<String, anyhow::Error> {
    match SHORT_URLS.get(short_id) {
        Some(val) => Ok(val.original_url.to_string()),
        None => {
            let val = short_url::get(short_id)
                .await
                .map_err(|_| anyhow!("Short URL not found in db"))?;
            SHORT_URLS.insert(short_id.to_string(), val.clone().into());

            Ok(val.original_url)
        }
    }
}

pub async fn set(short_id: &str, entry: ShortUrlCacheEntry) -> Result<(), anyhow::Error> {
    SHORT_URLS.insert(short_id.to_string(), entry.clone());
    short_url::add(short_id, &entry.original_url).await?;

    // trigger watch event
    db::put(
        &format!("{SHORT_URL_KEY}{short_id}"),
        Bytes::new(),
        NEED_WATCH,
        None,
    )
    .await?;
    Ok(())
}

pub async fn get_by_original_url(original_url: &str) -> Option<String> {
    // TODO: need to optimize this for larger number of short URLs
    if let Some(short_id) = SHORT_URLS.iter().find_map(|entry| {
        let (k, v) = entry.pair();
        if v.original_url == original_url {
            return Some(k.clone());
        }
        None
    }) {
        return Some(short_id);
    }

    let original_url = original_url.to_string();
    match short_url::get_by_original_url(&original_url).await {
        Ok(row) => {
            SHORT_URLS.insert(row.short_id.to_owned(), row.clone().into());
            Some(row.short_id)
        }
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
                let item_value = match short_url::get(item_key).await {
                    Ok(val) => val,
                    Err(e) => {
                        log::error!("Error getting value: {}", e);
                        continue;
                    }
                };
                SHORT_URLS.insert(item_key.to_string(), item_value.into());
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                SHORT_URLS.remove(item_key);
            }
            Event::Empty => {}
        }

        // TODO: Implement gc for SHORT_URLS cache based on ZO_COMPACT_DATA_RETENTION_DAYS
    }
}

/// Preload all short URLs from the database into the cache at startup.
pub async fn cache() -> Result<(), anyhow::Error> {
    // FIXME: get only entries that are with it retention period
    let ret = short_url::list().await?;
    for row in ret.into_iter() {
        SHORT_URLS.insert(row.short_id.to_owned(), row.into());
    }
    log::info!("Short URLs Cached");
    Ok(())
}
