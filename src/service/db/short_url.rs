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

use anyhow::{anyhow, Context};
use bytes::Bytes;
use chrono::Utc;
use config::get_config;
use infra::{
    db::{Event, NEED_WATCH},
    short_url,
};

use crate::{
    common::{
        infra::config::{ORIGINAL_URLS, SHORT_URLS},
        meta::short_url::ShortUrlCacheEntry,
    },
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
    ORIGINAL_URLS.insert(entry.original_url.to_string(), short_id.to_string());

    if let Err(e) = short_url::add(short_id, &entry.original_url).await {
        // roll back
        SHORT_URLS.remove(short_id);
        ORIGINAL_URLS.remove(&entry.original_url);
        return Err(e).context("Failed to add short URL to DB");
    };

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

pub async fn get_by_original_url(original_url: &str) -> Result<String, anyhow::Error> {
    if let Some(short_id) = ORIGINAL_URLS.get(original_url) {
        return Ok(short_id.to_string());
    }

    let original_url = original_url.to_string();
    let row = short_url::get_by_original_url(&original_url).await?;
    SHORT_URLS.insert(row.short_id.to_owned(), row.clone().into());
    Ok(row.short_id)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = SHORT_URL_KEY;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching short URLs");

    // Spawn a background task for garbage collection
    let config = get_config();
    tokio::spawn(run_gc_task(
        days_to_minutes(config.compact.data_gc_interval_days),
        days_to_minutes(config.compact.data_retention_days),
    ));

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

// Background task to run GC at a regular interval
async fn run_gc_task(gc_interval_minutes: i64, retention_days: i64) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
        gc_interval_minutes as u64 * 60,
    ));

    loop {
        interval.tick().await;

        if let Err(e) = gc_cache(retention_days).await {
            log::error!("Error during garbage collection: {}", e);
        }
    }
}

// Garbage Collection to clean up expired entries from cache
pub async fn gc_cache(retention_period_minutes: i64) -> Result<(), anyhow::Error> {
    log::info!(
        "Garbage collection start. Cache size SHORT_URLS: {}, ORIGINAL_URLS: {}",
        SHORT_URLS.len(),
        ORIGINAL_URLS.len()
    );
    let retention_period = chrono::Duration::minutes(retention_period_minutes);
    let now = Utc::now();
    let mut original_urls_to_remove = Vec::new();
    SHORT_URLS.retain(|_short_id, entry| {
        let is_valid = now - entry.timestamp < retention_period;

        if !is_valid {
            original_urls_to_remove.push(entry.original_url.clone());
        }

        is_valid
    });

    for original_url in original_urls_to_remove {
        ORIGINAL_URLS.remove(&original_url);
    }
    log::info!(
        "Garbage collection completed. Cache size SHORT_URLS: {}, ORIGINAL_URLS: {}",
        SHORT_URLS.len(),
        ORIGINAL_URLS.len()
    );
    Ok(())
}

fn days_to_minutes(days: i64) -> i64 {
    days * 24 * 60
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_gc_removes_expired_entries_and_retains_valid_entries() {
        let retention_minutes = 60; // 1 hour retention period
        let now = Utc::now();

        // Insert an expired entry (2 hours old)
        let expired_entry = ShortUrlCacheEntry {
            short_id: "expired".to_string(),
            original_url: "https://expired.com".to_string(),
            timestamp: now - chrono::Duration::hours(2),
        };
        SHORT_URLS.insert("expired".to_string(), expired_entry.clone());
        ORIGINAL_URLS.insert(expired_entry.original_url.clone(), "expired".to_string());

        // Insert a valid entry (30 minutes old)
        let valid_entry = ShortUrlCacheEntry {
            short_id: "valid".to_string(),
            original_url: "https://valid.com".to_string(),
            timestamp: now - chrono::Duration::minutes(30),
        };
        SHORT_URLS.insert("valid".to_string(), valid_entry.clone());
        ORIGINAL_URLS.insert(valid_entry.original_url.clone(), "valid".to_string());

        // Run garbage collection
        gc_cache(retention_minutes).await.unwrap();

        // Assert expired entry is removed
        assert!(SHORT_URLS.get("expired").is_none());
        assert!(ORIGINAL_URLS.get("https://expired.com").is_none());

        // Assert valid entry is still present
        assert!(SHORT_URLS.get("valid").is_some());
        assert!(ORIGINAL_URLS.get("https://valid.com").is_some());
    }
}
