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

pub mod collector;

use std::sync::Arc;

pub use collector::NatsVisibilityCollector;
use config::{get_config, meta::self_reporting::nats::NatsVisibilityEvent};
use once_cell::sync::Lazy;
use tokio::{
    sync::RwLock,
    time::{Duration, interval},
};

// Global in-memory buffer for NATS visibility events
static EVENT_BUFFER: Lazy<Arc<RwLock<Vec<NatsVisibilityEvent>>>> =
    Lazy::new(|| Arc::new(RwLock::new(Vec::new())));

/// Add events to the global buffer
pub async fn buffer_events(events: Vec<NatsVisibilityEvent>) {
    let event_count = events.len();
    let mut buffer = EVENT_BUFFER.write().await;
    buffer.extend(events);
    log::info!(
        "[NATS Visibility] Buffered {} events (total: {})",
        event_count,
        buffer.len()
    );
}

/// Take all buffered events (drains the buffer)
async fn take_buffered_events() -> Vec<NatsVisibilityEvent> {
    let mut buffer = EVENT_BUFFER.write().await;
    std::mem::take(&mut *buffer)
}

/// Initialize and start NATS visibility collector and ingestion tasks
pub fn start_collector() {
    let cfg = get_config();

    if !cfg.nats_visibility.enabled {
        log::info!("[NATS Visibility] Disabled via ZO_NATS_VISIBILITY_ENABLED=false");
        return;
    }

    log::info!(
        "[NATS Visibility] Starting collector (interval: {}s)",
        cfg.nats_visibility.interval_secs
    );

    // Capture intervals before moving cfg
    let collection_interval = cfg.nats_visibility.interval_secs;
    let ingestion_interval = cfg.nats_visibility.interval_secs * 2;

    // Start collection task - writes to in-memory buffer
    tokio::spawn(async move {
        let mut collector = NatsVisibilityCollector::new();
        let mut tick = interval(Duration::from_secs(collection_interval));

        loop {
            tick.tick().await;

            if let Err(e) = collector.collect_and_buffer().await {
                log::error!("[NATS Visibility] Collection error: {}", e);
            }
        }
    });

    // Start ingestion task - reads from buffer and writes to WAL
    // Run at double the collection interval to batch more events
    tokio::spawn(async move {
        let mut tick = interval(Duration::from_secs(ingestion_interval));

        loop {
            tick.tick().await;

            let events = take_buffered_events().await;
            if events.is_empty() {
                log::info!("[NATS Visibility] No events to ingest");
                continue;
            }

            log::info!(
                "[NATS Visibility] Ingesting {} buffered events",
                events.len()
            );

            if let Err(e) = ingest_events(events).await {
                log::error!("[NATS Visibility] Ingestion error: {}", e);
            }
        }
    });

    log::info!("[NATS Visibility] Collector and ingestion tasks started");
}

/// Ingest events via HTTP _json API (works across all nodes)
async fn ingest_events(events: Vec<NatsVisibilityEvent>) -> crate::errors::Result<()> {
    const META_ORG: &str = "_meta";
    const STREAM_NAME: &str = "nats_visibility";

    if events.is_empty() {
        return Ok(());
    }

    // Convert to JSON array format for _json API
    let json_array: Vec<serde_json::Value> = events
        .into_iter()
        .filter_map(|e| serde_json::to_value(e).ok())
        .collect();

    if json_array.is_empty() {
        log::warn!("[NATS Visibility] All events failed to serialize");
        return Ok(());
    }

    // Get local HTTP address
    let cfg = get_config();
    let base_url = format!("http://127.0.0.1:{}", cfg.http.port);
    let url = format!("{}/api/{}/{}/_json", base_url, META_ORG, STREAM_NAME);

    // Create HTTP client
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| {
            crate::errors::Error::Message(format!("Failed to create HTTP client: {}", e))
        })?;

    // Get root user credentials for authentication
    let auth_user = cfg.auth.root_user_email.clone();
    let auth_password = cfg.auth.root_user_password.clone();

    // Send POST request to _json API with Basic Auth
    match client
        .post(&url)
        .basic_auth(&auth_user, Some(&auth_password))
        .header("Content-Type", "application/json")
        .json(&json_array)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                log::info!(
                    "[NATS Visibility] Successfully ingested {} events via _json API",
                    json_array.len()
                );
            } else {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                log::error!(
                    "[NATS Visibility] _json API returned error {}: {}",
                    status,
                    error_text
                );
            }
        }
        Err(e) => {
            log::error!(
                "[NATS Visibility] Failed to send to _json API: {}. Will retry next cycle.",
                e
            );
        }
    }

    Ok(())
}
