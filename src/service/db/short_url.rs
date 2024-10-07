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
    short_url::ShortUrlRecord,
};

use crate::{common::infra::config::SHORT_URLS, service::db};

// DBKey to set short URL's
pub const SHORT_URL_KEY: &str = "/short_urls/";
// GC interval for `SHORT_URLS` cache in days
pub const SHORT_URL_GC_INTERVAL: i64 = 1; // days

pub async fn get(short_id: &str) -> Result<String, anyhow::Error> {
    match SHORT_URLS.get(short_id) {
        Some(val) => Ok(val.original_url.to_string()),
        None => {
            let val = short_url::get(short_id)
                .await
                .map_err(|_| anyhow!("Short URL not found in db"))?;
            SHORT_URLS.insert(short_id.to_string(), val.clone());
            Ok(val.original_url)
        }
    }
}

pub async fn set(short_id: &str, entry: ShortUrlRecord) -> Result<(), anyhow::Error> {
    if let Err(e) = short_url::add(short_id, &entry.original_url).await {
        return Err(e).context("Failed to add short URL to DB");
    }

    SHORT_URLS.insert(short_id.to_string(), entry.clone());

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

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = SHORT_URL_KEY;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching short URLs");

    // Spawn a background task for garbage collection
    let config = get_config();
    tokio::spawn(run_gc_task(
        days_to_minutes(SHORT_URL_GC_INTERVAL),
        days_to_minutes(config.short_url.short_url_retention_days),
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
                SHORT_URLS.insert(item_key.to_string(), item_value);
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
    let config = get_config();
    let retention_minutes = days_to_minutes(config.compact.data_retention_days);
    let retention_period = chrono::Duration::minutes(retention_minutes);
    let now = Utc::now();

    // List limited to 10k records
    let ret = short_url::list(Some(10_000)).await?;
    for row in ret.into_iter() {
        if now - row.created_at < retention_period {
            SHORT_URLS.insert(row.short_id.to_owned(), row.clone());
        }
    }
    log::info!("[SHORT_URLS] Cached with len: {}", SHORT_URLS.len());
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
        "[SHORT_URLS] Garbage collection start with cache size: {}",
        SHORT_URLS.len(),
    );
    let retention_period = chrono::Duration::minutes(retention_period_minutes);
    let now = Utc::now();
    SHORT_URLS.retain(|_short_id, entry| now - entry.created_at < retention_period);

    log::info!(
        "[SHORT_URLS] Garbage collection end with cache size: {}",
        SHORT_URLS.len(),
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
        let expired_entry = ShortUrlRecord {
            short_id: "expired".to_string(),
            original_url: "https://expired.com".to_string(),
            created_at: now - chrono::Duration::hours(2),
        };
        SHORT_URLS.insert("expired".to_string(), expired_entry.clone());

        // Insert a valid entry (30 minutes old)
        let valid_entry = ShortUrlRecord {
            short_id: "valid".to_string(),
            original_url: "https://valid.com".to_string(),
            created_at: now - chrono::Duration::minutes(30),
        };
        SHORT_URLS.insert("valid".to_string(), valid_entry.clone());

        // Run garbage collection
        gc_cache(retention_minutes).await.unwrap();

        // Assert expired entry is removed
        assert!(SHORT_URLS.get("expired").is_none());

        // Assert valid entry is still present
        assert!(SHORT_URLS.get("valid").is_some());
    }
}