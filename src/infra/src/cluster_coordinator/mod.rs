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

pub mod alerts;
pub mod destinations;
pub mod events;
pub mod pipelines;

use std::sync::Arc;

use bytes::Bytes;
use config::{get_config, meta::meta_store::MetaStore, utils::json};
use tokio::sync::mpsc;

use crate::{
    cluster_coordinator::events::{InternalCoordinatorEvent, MetaAction, MetaEvent},
    db::Db,
    errors::Error,
    queue::{self, RetentionPolicy},
};

pub const INTERNAL_COORDINATOR_STREAM: &str = "coordinator_events";
pub async fn get_coordinator() -> &'static Box<dyn Db> {
    super::db::get_coordinator().await
}

pub async fn create_stream() -> Result<(), Error> {
    if !should_watch_through_queue() {
        return Ok(());
    }
    log::info!("[INTERNAL_COORDINATOR::CREATE_STREAM] creating internal coordinator stream");
    let queue = queue::get_queue().await;
    queue
        .create_with_retention_policy(INTERNAL_COORDINATOR_STREAM, RetentionPolicy::Interest)
        .await
}

/// `event` should be a json string. The message will be published to the internal coordinator
/// stream.
pub async fn publish(event: InternalCoordinatorEvent) -> Result<(), Error> {
    if !should_watch_through_queue() {
        return Ok(());
    }
    let payload = json::to_vec(&event).map_err(|e| {
        Error::Message(format!(
            "Failed to serialize internal coordinator event: {}",
            e
        ))
    })?;
    let queue = queue::get_queue().await;
    queue
        .publish(INTERNAL_COORDINATOR_STREAM, Bytes::from(payload))
        .await
}

pub async fn subscribe<F, Fut>(callback: F) -> Result<(), Error>
where
    F: Fn(Vec<u8>) -> Fut,
    Fut: Future<Output = Result<(), anyhow::Error>>,
{
    if !should_watch_through_queue() {
        return Ok(());
    }
    log::info!("[INTERNAL_COORDINATOR::SUBSCRIBE] subscribing to internal coordinator stream");
    let queue = queue::get_queue().await;
    let mut receiver: Arc<mpsc::Receiver<super::queue::Message>> = queue
        .consume(INTERNAL_COORDINATOR_STREAM)
        .await
        .unwrap_or_else(|_| {
            panic!("failed to subscribe to topic \"{INTERNAL_COORDINATOR_STREAM}\"")
        });
    let receiver = Arc::get_mut(&mut receiver)
        .unwrap_or_else(|| panic!("failed to get mutable reference to receiver"));
    while let Some(message) = receiver.recv().await {
        if let Err(e) = callback(message.message().to_vec()).await {
            log::error!("failed to process internal coordinator event: {}", e);
        } else {
            message.ack().await.unwrap_or_else(|e| {
                log::error!("failed to ack internal coordinator event: {}", e);
            });
        }
    }
    Ok(())
}

/// If the cluster coordinator is nats, we use the nats queue to watch the events.
/// Otherwise, we use the cluster coordinator to watch the events.
pub fn should_watch_through_queue() -> bool {
    let cfg = get_config();
    let cluster_coordinator: MetaStore = cfg.common.cluster_coordinator.as_str().into();
    !cfg.common.local_mode && cluster_coordinator == MetaStore::Nats
}

/// Publish a coordinator event to the nats cluster coordinator queue
pub async fn publish_event(event: MetaEvent) -> crate::errors::Result<()> {
    log::debug!(
        "[INTERNAL_COORDINATOR::PUBLISH_EVENT] publish coordinator event: {:?}",
        event
    );
    let event = InternalCoordinatorEvent::Meta(event);
    publish(event).await?;
    Ok(())
}

pub fn meta_delete_event(key: &str, start_dt: Option<i64>) -> MetaEvent {
    MetaEvent {
        action: MetaAction::Delete,
        key: key.to_string(),
        start_dt,
        value: None,
    }
}

pub fn meta_put_event(key: &str, start_dt: Option<i64>) -> MetaEvent {
    MetaEvent {
        action: MetaAction::Put,
        key: key.to_string(),
        start_dt,
        value: None,
    }
}

pub fn coordinator_put_event(key: &str, start_dt: Option<i64>, value: Option<Bytes>) -> MetaEvent {
    MetaEvent {
        action: MetaAction::Put,
        key: key.to_string(),
        start_dt,
        value,
    }
}
