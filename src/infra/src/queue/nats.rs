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

use std::{cmp::max, sync::Arc, time::Duration};

use async_nats::{
    HeaderMap,
    header::NATS_MESSAGE_ID,
    jetstream::{self, consumer::DeliverPolicy},
};
use async_trait::async_trait;
use bytes::Bytes;
use config::{get_cluster_name, get_config};
use futures::TryStreamExt;
use tokio::{sync::mpsc, task::JoinHandle};

use crate::{db::nats::get_nats_client, errors::*, queue, queue::format_key};

pub async fn init() -> Result<()> {
    crate::db::nats::init().await
}

pub struct NatsQueue {
    prefix: String,
    consumer_name: String,
    is_durable: bool,
}

pub struct NatsPullConsumer {
    consumer: jetstream::consumer::PullConsumer,
    ack_wait: Duration,
}

impl NatsPullConsumer {
    pub fn ack_wait(&self) -> Duration {
        self.ack_wait
    }

    pub async fn next(&mut self) -> Result<Option<super::Message>> {
        let mut messages = self
            .consumer
            .batch()
            .max_messages(1)
            .expires(Duration::from_secs(30))
            .messages()
            .await
            .map_err(|e| Error::Message(format!("failed to request NATS message: {e}")))?;

        messages
            .try_next()
            .await
            .map(|message| message.map(super::Message::from_nats))
            .map_err(|e| Error::Message(format!("failed to receive NATS message: {e}")))
    }
}

impl NatsQueue {
    pub fn new(prefix: &str) -> Self {
        let prefix = prefix.trim_end_matches('/');
        Self {
            prefix: prefix.to_string(),
            consumer_name: format_key(&get_config().common.instance_name),
            is_durable: false,
        }
    }

    pub fn super_cluster() -> Self {
        Self::new("super_cluster_queue_").with_consumer_name(get_cluster_name(), true)
    }

    pub fn with_consumer_name(&self, consumer_name: String, is_durable: bool) -> Self {
        Self {
            prefix: self.prefix.clone(),
            consumer_name: format_key(&consumer_name),
            is_durable,
        }
    }

    pub async fn pull_consumer(
        &self,
        topic: &str,
        deliver_policy: Option<queue::DeliverPolicy>,
    ) -> Result<NatsPullConsumer> {
        let stream_name = format!("{}{}", self.prefix, format_key(topic));
        let client = get_nats_client().await.clone();
        let jetstream = jetstream::new(client);
        let stream = jetstream
            .get_stream(&stream_name)
            .await
            .map_err(|e| Error::Message(format!("failed to get NATS stream {stream_name}: {e}")))?;
        let config = jetstream::consumer::pull::Config {
            name: Some(self.consumer_name.clone()),
            durable_name: self.is_durable.then(|| self.consumer_name.clone()),
            deliver_policy: get_deliver_policy(deliver_policy),
            ..Default::default()
        };
        let consumer = stream
            .get_or_create_consumer(&self.consumer_name, config)
            .await
            .map_err(|e| {
                Error::Message(format!(
                    "failed to get or create NATS consumer {} for stream {stream_name}: {e}",
                    self.consumer_name
                ))
            })?;
        let ack_wait = consumer.cached_info().config.ack_wait;

        Ok(NatsPullConsumer { consumer, ack_wait })
    }

    async fn open_messages(
        &self,
        topic: &str,
        deliver_policy: Option<queue::DeliverPolicy>,
    ) -> Result<jetstream::consumer::pull::Stream> {
        self.pull_consumer(topic, deliver_policy)
            .await?
            .consumer
            .messages()
            .await
            .map_err(|e| Error::Message(format!("failed to open NATS consumer messages: {e}")))
    }
}

impl Default for NatsQueue {
    fn default() -> Self {
        Self::new(&config::get_config().nats.prefix)
    }
}

impl From<queue::RetentionPolicy> for jetstream::stream::RetentionPolicy {
    fn from(retention_policy: queue::RetentionPolicy) -> Self {
        match retention_policy {
            queue::RetentionPolicy::Interest => jetstream::stream::RetentionPolicy::Interest,
            queue::RetentionPolicy::Limits => jetstream::stream::RetentionPolicy::Limits,
        }
    }
}

impl From<queue::StorageType> for jetstream::stream::StorageType {
    fn from(storage_type: queue::StorageType) -> Self {
        match storage_type {
            queue::StorageType::File => jetstream::stream::StorageType::File,
            queue::StorageType::Memory => jetstream::stream::StorageType::Memory,
        }
    }
}

#[async_trait]
impl super::Queue for NatsQueue {
    async fn create(&self, topic: &str) -> Result<()> {
        self.create_with_config(topic, super::QueueConfigBuilder::new().build())
            .await
    }

    async fn create_with_config(&self, topic: &str, config: super::QueueConfig) -> Result<()> {
        let max_age = match config.max_age {
            Some(dur) => dur,
            None => {
                let max_age = config::get_config().nats.queue_max_age; // days
                std::time::Duration::from_secs(max(1, max_age) * 24 * 60 * 60) // seconds
            }
        };
        let cfg = config::get_config();
        let client = get_nats_client().await.clone();
        let jetstream = jetstream::new(client);
        let topic_name = format!("{}{}", self.prefix, format_key(topic));
        let stream_config = stream_config(&topic_name, &config, max_age, &cfg.nats);
        let stream = jetstream.get_or_create_stream(stream_config).await?;
        // create() passes no max_age or window and must leave existing streams untouched
        reconcile_stream(
            &jetstream,
            &stream.cached_info().config,
            config.max_age.map(|_| max_age),
            config.duplicate_window,
        )
        .await;
        Ok(())
    }

    /// you can pub message with the topic or topic.* to match the topic
    async fn publish(&self, topic: &str, value: Bytes) -> Result<()> {
        let client = get_nats_client().await.clone();
        let jetstream = jetstream::new(client);
        // Publish a message to the stream
        let topic_name = format!("{}{}", self.prefix, format_key(topic));
        let ack = jetstream.publish(topic_name, value).await?;
        ack.await?;
        Ok(())
    }

    async fn publish_with_id(&self, topic: &str, value: Bytes, message_id: &str) -> Result<()> {
        let client = get_nats_client().await.clone();
        let jetstream = jetstream::new(client);
        let topic_name = format!("{}{}", self.prefix, format_key(topic));
        let mut headers = HeaderMap::new();
        headers.insert(NATS_MESSAGE_ID, message_id);
        let ack = jetstream
            .publish_with_headers(topic_name, headers, value)
            .await?;
        ack.await?;
        Ok(())
    }

    async fn consume(
        &self,
        topic: &str,
        deliver_policy: Option<queue::DeliverPolicy>,
    ) -> Result<Arc<mpsc::Receiver<super::Message>>> {
        let (tx, rx) = mpsc::channel(1024);
        let queue = self.with_consumer_name(self.consumer_name.clone(), self.is_durable);
        let topic = topic.to_string();
        let _task: JoinHandle<Result<()>> = tokio::spawn(async move {
            let messages = queue
                .open_messages(&topic, deliver_policy)
                .await
                .map_err(|error| {
                    log::error!("Failed to open NATS consumer for {topic}: {error}");
                    error
                })?;
            forward_messages(messages, tx).await
        });
        Ok(Arc::new(rx))
    }

    async fn consume_ready(
        &self,
        topic: &str,
        deliver_policy: Option<queue::DeliverPolicy>,
    ) -> Result<Arc<mpsc::Receiver<super::Message>>> {
        let messages = self.open_messages(topic, deliver_policy).await?;
        let (tx, rx) = mpsc::channel(1024);
        tokio::spawn(forward_messages(messages, tx));
        Ok(Arc::new(rx))
    }

    async fn pull_consume(
        &self,
        topic: &str,
        group: &str,
        deliver_policy: Option<queue::DeliverPolicy>,
    ) -> Result<queue::PullConsumer> {
        let consumer = self
            .with_consumer_name(group.to_string(), true)
            .pull_consumer(topic, deliver_policy)
            .await?;
        Ok(queue::PullConsumer::from_nats(consumer))
    }

    async fn purge(&self, _topic: &str, _sequence: usize) -> Result<()> {
        Ok(())
    }
}

fn stream_config(
    topic_name: &str,
    config: &queue::QueueConfig,
    max_age: Duration,
    nats: &config::Nats,
) -> jetstream::stream::Config {
    let mut stream = jetstream::stream::Config {
        name: topic_name.to_string(),
        subjects: vec![topic_name.to_string(), format!("{topic_name}.*")],
        retention: config.retention_policy.into(),
        storage: config.storage_type.into(),
        num_replicas: nats.replicas,
        max_bytes: nats.queue_max_size,
        max_age,
        ..Default::default()
    };
    if let Some(window) = config.duplicate_window {
        stream.duplicate_window = window;
    }
    stream
}

// failure only warns: the stream still works, and an update can time out while a replica is down
async fn reconcile_stream(
    jetstream: &jetstream::Context,
    current: &jetstream::stream::Config,
    max_age: Option<Duration>,
    duplicate_window: Option<Duration>,
) {
    let Some(updated) = stream_update(current, max_age, duplicate_window) else {
        return;
    };
    match jetstream.update_stream(&updated).await {
        Ok(_) => log::info!(
            "[NATS:queue] stream {} updated: max_age {:?} -> {:?}, duplicate_window {:?} -> {:?}",
            current.name,
            current.max_age,
            updated.max_age,
            current.duplicate_window,
            updated.duplicate_window
        ),
        Err(e) => log::warn!(
            "[NATS:queue] failed to update stream {} to max_age {:?}, duplicate_window {:?}: {e}",
            current.name,
            updated.max_age,
            updated.duplicate_window
        ),
    }
}

/// The existing stream's config with each requested setting applied, or None when none differs.
fn stream_update(
    current: &jetstream::stream::Config,
    max_age: Option<Duration>,
    duplicate_window: Option<Duration>,
) -> Option<jetstream::stream::Config> {
    let updated = jetstream::stream::Config {
        max_age: max_age.unwrap_or(current.max_age),
        duplicate_window: duplicate_window.unwrap_or(current.duplicate_window),
        ..current.clone()
    };
    (updated != *current).then_some(updated)
}

async fn forward_messages(
    mut messages: jetstream::consumer::pull::Stream,
    tx: mpsc::Sender<super::Message>,
) -> Result<()> {
    loop {
        let message = tokio::select! {
            _ = tx.closed() => return Ok(()),
            message = messages.try_next() => message,
        };
        match message {
            Ok(Some(message)) => {
                if tx.send(super::Message::from_nats(message)).await.is_err() {
                    return Ok(());
                }
            }
            Ok(None) => return Ok(()),
            Err(error) => {
                log::error!("Failed to receive NATS consumer message: {error}");
                return Err(Error::Message(error.to_string()));
            }
        }
    }
}

fn get_deliver_policy(deliver_policy: Option<queue::DeliverPolicy>) -> DeliverPolicy {
    if let Some(deliver_policy) = deliver_policy {
        return match deliver_policy {
            queue::DeliverPolicy::All => DeliverPolicy::All,
            queue::DeliverPolicy::Last => DeliverPolicy::Last,
            queue::DeliverPolicy::New => DeliverPolicy::New,
        };
    }
    match get_config().nats.deliver_policy.to_lowercase().as_str() {
        "all" | "deliverall" | "deliver_all" => DeliverPolicy::All,
        "last" | "deliverlast" | "deliver_last" => DeliverPolicy::Last,
        "new" | "delivernew" | "deliver_new" => DeliverPolicy::New,
        _ => DeliverPolicy::All,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nats_queue_new_strips_trailing_slash() {
        let q = NatsQueue::new("myprefix/");
        assert_eq!(q.prefix, "myprefix");
    }

    #[test]
    fn test_with_consumer_name_sets_fields() {
        let q = NatsQueue::new("prefix").with_consumer_name("My Consumer".to_string(), true);
        assert_eq!(q.consumer_name, "My_Consumer");
        assert!(q.is_durable);
    }

    fn existing_stream_config(max_age: Duration) -> jetstream::stream::Config {
        jetstream::stream::Config {
            name: "o2_ratelimit_ha_queue".to_string(),
            subjects: vec![
                "o2_ratelimit_ha_queue".to_string(),
                "o2_ratelimit_ha_queue.*".to_string(),
            ],
            retention: jetstream::stream::RetentionPolicy::Interest,
            storage: jetstream::stream::StorageType::Memory,
            num_replicas: 3,
            max_bytes: 2 * 1024 * 1024 * 1024,
            max_age,
            ..Default::default()
        }
    }

    #[test]
    fn stream_config_carries_the_duplicate_window() {
        let cfg = config::get_config();
        let nats = &cfg.nats;
        let windowed = queue::QueueConfigBuilder::new()
            .duplicate_window(Duration::from_secs(3600))
            .build();
        let built = stream_config("o2_slack_inbound", &windowed, Duration::from_secs(60), nats);
        assert_eq!(built.duplicate_window, Duration::from_secs(3600));
        assert_eq!(built.max_age, Duration::from_secs(60));
        assert_eq!(built.subjects, ["o2_slack_inbound", "o2_slack_inbound.*"]);

        let plain = queue::QueueConfigBuilder::new().build();
        let built = stream_config("o2_other", &plain, Duration::from_secs(60), nats);
        assert_eq!(
            built.duplicate_window,
            jetstream::stream::Config::default().duplicate_window,
            "without a window the server default applies"
        );
    }

    #[test]
    fn test_max_age_update_none_when_equal() {
        let current = existing_stream_config(Duration::from_secs(3600));
        assert!(stream_update(&current, Some(Duration::from_secs(3600)), None).is_none());
        assert!(stream_update(&current, None, None).is_none());
    }

    #[test]
    fn test_duplicate_window_is_reconciled_on_an_existing_stream() {
        let hour = Duration::from_secs(3600);
        let current = existing_stream_config(hour);
        let updated = stream_update(&current, None, Some(hour)).unwrap();
        assert_eq!(updated.duplicate_window, hour);
        assert_eq!(
            jetstream::stream::Config {
                duplicate_window: current.duplicate_window,
                ..updated.clone()
            },
            current
        );
        assert!(stream_update(&updated, Some(hour), Some(hour)).is_none());
        let both = stream_update(&current, Some(2 * hour), Some(hour)).unwrap();
        assert_eq!((both.max_age, both.duplicate_window), (2 * hour, hour));
    }

    #[test]
    fn test_max_age_update_changes_only_max_age() {
        let current = existing_stream_config(Duration::from_secs(60 * 24 * 3600));
        let updated = stream_update(&current, Some(Duration::from_secs(3600)), None).unwrap();
        assert_eq!(updated.max_age, Duration::from_secs(3600));
        assert_eq!(
            jetstream::stream::Config {
                max_age: current.max_age,
                ..updated
            },
            current
        );
    }
}
