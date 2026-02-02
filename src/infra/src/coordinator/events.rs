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

use bytes::Bytes;
use config::utils::json;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tokio::sync::{RwLock, mpsc};

use crate::{
    errors::{Error, Result},
    queue,
};

pub const COORDINATOR_STREAM: &str = "coordinator_events";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CoordinatorEvent {
    Meta(MetaEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetaEvent {
    pub action: MetaAction,
    pub key: String,
    pub start_dt: Option<i64>,
    pub value: Option<Bytes>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MetaAction {
    Put,
    Delete,
}

impl From<MetaEvent> for crate::db::Event {
    fn from(event: MetaEvent) -> Self {
        match event.action {
            MetaAction::Put => crate::db::Event::Put(crate::db::EventData {
                key: event.key,
                value: event.value,
                start_dt: event.start_dt,
            }),
            MetaAction::Delete => crate::db::Event::Delete(crate::db::EventData {
                key: event.key,
                value: event.value,
                start_dt: event.start_dt,
            }),
        }
    }
}

/// The prefix to watch for coordinator events.
type WatcherPrefix = (String, mpsc::Sender<crate::db::Event>);
static COORDINATOR_WATCHER_PREFIXES: Lazy<RwLock<Vec<WatcherPrefix>>> =
    Lazy::new(|| RwLock::new(Vec::new()));

pub async fn init() -> Result<()> {
    // if local node is single node or meta store is not nats, return ok
    let cfg = config::get_config();
    let meta_store: config::meta::meta_store::MetaStore = cfg.common.queue_store.as_str().into();
    if cfg.common.local_mode || meta_store != config::meta::meta_store::MetaStore::Nats {
        return Ok(());
    }

    // create the coordinator stream if not exists
    create_stream().await?;

    let (tx, mut rx) = mpsc::channel(65535);
    tokio::task::spawn(async move {
        if let Err(e) = subscribe(tx).await {
            log::error!("[COORDINATOR::EVENTS] failed to subscribe to coordinator topic: {e}");
        }
    });
    tokio::task::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CoordinatorEvent::Meta(event) => {
                    let r = COORDINATOR_WATCHER_PREFIXES.read().await;
                    for (prefix, tx) in r.iter() {
                        if event.key.starts_with(prefix) {
                            log::debug!(
                                "[COORDINATOR::EVENTS] sending event to watcher: {:?}:{}, start_dt: {:?}",
                                event.action,
                                event.key,
                                event.start_dt
                            );
                            if let Err(e) = tx.send(event.clone().into()).await {
                                log::error!(
                                    "[COORDINATOR::EVENTS] failed to send event to watcher: {e}"
                                );
                            }
                        }
                    }
                }
            }
        }
    });
    Ok(())
}

pub async fn watch(prefix: &str) -> Result<Arc<mpsc::Receiver<crate::db::Event>>> {
    let (tx, rx) = mpsc::channel(65535);
    let mut w = COORDINATOR_WATCHER_PREFIXES.write().await;
    w.push((prefix.to_string(), tx));
    w.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(Arc::new(rx))
}

async fn create_stream() -> Result<()> {
    log::info!("[COORDINATOR::EVENTS] creating coordinator stream");
    let cfg = config::get_config();
    let max_age = cfg.nats.event_max_age; // seconds
    let max_age_secs = std::time::Duration::from_secs(std::cmp::max(1, max_age));
    let storage = if cfg.nats.event_storage.to_lowercase() == "memory" {
        queue::StorageType::Memory
    } else {
        queue::StorageType::File
    };
    let q = queue::get_queue().await;
    let config = queue::QueueConfigBuilder::new()
        .max_age(max_age_secs)
        .retention_policy(queue::RetentionPolicy::Limits)
        .storage_type(storage)
        .build();
    q.create_with_config(COORDINATOR_STREAM, config).await
}

async fn subscribe(tx: mpsc::Sender<CoordinatorEvent>) -> Result<()> {
    let q = queue::get_queue().await;
    let mut reconnect = false;
    loop {
        if config::cluster::is_offline() {
            break;
        }

        let deliver_policy = if reconnect {
            queue::DeliverPolicy::All
        } else {
            queue::DeliverPolicy::New
        };
        log::info!(
            "[COORDINATOR::EVENTS] subscribing to coordinator topic with deliver policy: {:?}",
            deliver_policy
        );
        let mut receiver: Arc<mpsc::Receiver<queue::Message>> = match q
            .consume(COORDINATOR_STREAM, Some(deliver_policy))
            .await
        {
            Ok(receiver) => receiver,
            Err(e) => {
                log::error!("[COORDINATOR::EVENTS] failed to subscribe to coordinator topic: {e}");
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                reconnect = true;
                continue;
            }
        };
        let receiver = Arc::get_mut(&mut receiver).unwrap_or_else(|| {
            panic!("[COORDINATOR::EVENTS] failed to get mutable reference to receiver")
        });
        loop {
            match receiver.recv().await {
                Some(message) => match message {
                    queue::Message::Nats(message) => {
                        let event: CoordinatorEvent = match serde_json::from_slice(&message.payload)
                        {
                            Ok(event) => event,
                            Err(e) => {
                                log::error!(
                                    "[COORDINATOR::EVENTS] failed to deserialize coordinator event: {e}"
                                );
                                continue;
                            }
                        };
                        match tx.send(event).await {
                            Ok(_) => {
                                if let Err(e) = message.ack().await {
                                    log::error!(
                                        "[COORDINATOR::EVENTS] failed to ack coordinator event: {e}"
                                    );
                                }
                            }
                            Err(e) => {
                                // don't ack the message if the channel is closed
                                log::error!(
                                    "[COORDINATOR::EVENTS] failed to process coordinator event: {e}"
                                );
                            }
                        }
                    }
                },
                None => {
                    log::error!("[COORDINATOR::EVENTS] coordinator topic closed");
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    reconnect = true;
                    break;
                }
            }
        }
    }
    Ok(())
}

/// `event` should be a json string. The message will be published to the coordinator stream.
async fn publish(event: CoordinatorEvent) -> Result<()> {
    let payload = json::to_vec(&event)
        .map_err(|e| Error::Message(format!("Failed to serialize coordinator event: {e}")))?;
    let q = queue::get_queue().await;
    if let Err(e) = q.publish(COORDINATOR_STREAM, Bytes::from(payload)).await {
        log::error!("[COORDINATOR::EVENTS] failed to publish coordinator event: {e}");
        return Err(e);
    }
    Ok(())
}

pub async fn put_event(key: &str, start_dt: Option<i64>, value: Option<Bytes>) -> Result<()> {
    log::debug!("[COORDINATOR::EVENTS] publishing put event for key: {key}");
    if let Err(e) = publish(CoordinatorEvent::Meta(MetaEvent {
        action: MetaAction::Put,
        key: key.to_string(),
        start_dt,
        value,
    }))
    .await
    {
        log::error!("[COORDINATOR::EVENTS] failed to publish put event for key: {key}: {e}");
        return Err(e);
    }
    Ok(())
}

pub async fn delete_event(key: &str, start_dt: Option<i64>) -> Result<()> {
    log::debug!(
        "[COORDINATOR::EVENTS] publishing delete event for key: {key}, start_dt: {start_dt:?}"
    );
    if let Err(e) = publish(CoordinatorEvent::Meta(MetaEvent {
        action: MetaAction::Delete,
        key: key.to_string(),
        start_dt,
        value: None,
    }))
    .await
    {
        log::error!("[COORDINATOR::EVENTS] failed to publish delete event for key: {key}: {e}");
        return Err(e);
    }
    Ok(())
}
