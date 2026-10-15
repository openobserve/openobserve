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
    /// How many times a consumer receives one message before the server stops
    /// redelivering it; 0 keeps the server default, which is unlimited.
    max_deliver: i64,
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
            max_deliver: 0,
        }
    }

    /// Super-cluster consumers leave a message unacked when they fail to apply
    /// it, so they must cap redelivery or one bad message is retried forever.
    pub fn super_cluster() -> Self {
        Self {
            max_deliver: get_config().nats.super_cluster_max_deliver,
            ..Self::new("super_cluster_queue_").with_consumer_name(get_cluster_name(), true)
        }
    }

    pub fn with_consumer_name(&self, consumer_name: String, is_durable: bool) -> Self {
        Self {
            prefix: self.prefix.clone(),
            consumer_name: format_key(&consumer_name),
            is_durable,
            max_deliver: self.max_deliver,
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
            max_deliver: self.max_deliver,
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
        reconcile_max_deliver(&stream, &consumer.cached_info().config, self.max_deliver).await;
        let ack_wait = consumer.cached_info().config.ack_wait;

        Ok(NatsPullConsumer { consumer, ack_wait })
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
        let stream_config = jetstream::stream::Config {
            name: topic_name.to_string(),
            subjects: vec![topic_name.to_string(), format!("{}.*", topic_name)],
            retention: config.retention_policy.into(),
            storage: config.storage_type.into(),
            num_replicas: cfg.nats.replicas,
            max_bytes: cfg.nats.queue_max_size,
            max_age,
            ..Default::default()
        };
        let stream = jetstream.get_or_create_stream(stream_config).await?;
        // create() passes no max_age and must leave existing streams untouched
        if config.max_age.is_some() {
            reconcile_max_age(&jetstream, &stream.cached_info().config, max_age).await;
        }
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
        let stream_name = format!("{}{}", self.prefix, format_key(topic));
        let consumer_name = self.consumer_name.clone();
        let is_durable = self.is_durable;
        let max_deliver = self.max_deliver;
        let _task: JoinHandle<Result<()>> = tokio::task::spawn(async move {
            let client = get_nats_client().await.clone();
            let jetstream = jetstream::new(client);
            let stream = jetstream.get_stream(&stream_name).await.map_err(|e| {
                log::error!("Failed to get nats stream {stream_name}: {e}");
                Error::Message(format!("Failed to get nats stream {stream_name}: {e}"))
            })?;
            let config = jetstream::consumer::pull::Config {
                name: Some(consumer_name.to_string()),
                durable_name: if is_durable {
                    Some(consumer_name.to_string())
                } else {
                    None
                },
                deliver_policy: get_deliver_policy(deliver_policy),
                max_deliver,
                ..Default::default()
            };
            let consumer = stream
                .get_or_create_consumer(&consumer_name, config)
                .await
                .map_err(|e| {
                    log::error!(
                        "Failed to get_or_create_consumer for nats stream {stream_name}: {e}"
                    );
                    Error::Message(format!(
                        "Failed to get_or_create_consumer for nats stream {stream_name}: {e}"
                    ))
                })?;
            reconcile_max_deliver(&stream, &consumer.cached_info().config, max_deliver).await;
            // Consume messages from the consumer
            let mut messages = consumer.messages().await.map_err(|e| {
                log::error!("Failed to get nats consumer messages for stream {stream_name}: {e}");
                Error::Message(format!(
                    "Failed to get nats consumer messages for stream {stream_name}: {e}"
                ))
            })?;
            loop {
                let message = match messages.try_next().await {
                    Ok(Some(message)) => message,
                    Ok(None) => {
                        log::warn!(
                            "Nats consumer messages for stream {} is closed",
                            stream_name
                        );
                        break;
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to get nats consumer messages for stream {}: {}",
                            stream_name,
                            e
                        );
                        break;
                    }
                };
                let message = super::Message::from_nats(message);
                tx.send(message).await.map_err(|e| {
                    log::error!("Failed to send nats message for stream {stream_name}: {e}");
                    Error::Message(format!(
                        "Failed to send nats message for stream {stream_name}: {e}"
                    ))
                })?;
            }
            Ok(())
        });
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

// failure only warns: the stream still works, and an update can time out while a replica is down
async fn reconcile_max_age(
    jetstream: &jetstream::Context,
    current: &jetstream::stream::Config,
    max_age: Duration,
) {
    let Some(updated) = max_age_update(current, max_age) else {
        return;
    };
    match jetstream.update_stream(&updated).await {
        Ok(_) => log::info!(
            "[NATS:queue] stream {} max_age updated from {:?} to {max_age:?}",
            current.name,
            current.max_age
        ),
        Err(e) => log::warn!(
            "[NATS:queue] failed to update stream {} max_age from {:?} to {max_age:?}: {e}",
            current.name,
            current.max_age
        ),
    }
}

fn max_age_update(
    current: &jetstream::stream::Config,
    max_age: Duration,
) -> Option<jetstream::stream::Config> {
    (current.max_age != max_age).then(|| jetstream::stream::Config {
        max_age,
        ..current.clone()
    })
}

// get_or_create_consumer returns an existing durable consumer unchanged, so a
// deployment that predates the limit is updated in place; failure only warns:
// the consumer still works, it just keeps redelivering without a limit
async fn reconcile_max_deliver(
    stream: &jetstream::stream::Stream,
    current: &jetstream::consumer::Config,
    max_deliver: i64,
) {
    let Some(updated) = max_deliver_update(current, max_deliver) else {
        return;
    };
    let consumer = current.name.as_deref().unwrap_or_default();
    let stream_name = &stream.cached_info().config.name;
    match stream.update_consumer(updated).await {
        Ok(_) => log::info!(
            "[NATS:queue] consumer {consumer} on stream {stream_name} max_deliver updated from {} \
             to {max_deliver}",
            current.max_deliver
        ),
        Err(e) => log::warn!(
            "[NATS:queue] failed to update consumer {consumer} on stream {stream_name} max_deliver \
             from {} to {max_deliver}: {e}",
            current.max_deliver
        ),
    }
}

fn max_deliver_update(
    current: &jetstream::consumer::Config,
    max_deliver: i64,
) -> Option<jetstream::consumer::Config> {
    (max_deliver > 0 && current.max_deliver != max_deliver).then(|| jetstream::consumer::Config {
        max_deliver,
        ..current.clone()
    })
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
    fn test_max_age_update_none_when_equal() {
        let current = existing_stream_config(Duration::from_secs(3600));
        assert!(max_age_update(&current, Duration::from_secs(3600)).is_none());
    }

    #[test]
    fn test_max_age_update_changes_only_max_age() {
        let current = existing_stream_config(Duration::from_secs(60 * 24 * 3600));
        let updated = max_age_update(&current, Duration::from_secs(3600)).unwrap();
        assert_eq!(updated.max_age, Duration::from_secs(3600));
        assert_eq!(
            jetstream::stream::Config {
                max_age: current.max_age,
                ..updated
            },
            current
        );
    }

    /// A durable consumer as the server reports it: an unlimited one reads
    /// back as -1.
    fn existing_consumer_config(max_deliver: i64) -> jetstream::consumer::Config {
        jetstream::consumer::Config {
            name: Some("region-a".to_string()),
            durable_name: Some("region-a".to_string()),
            deliver_policy: DeliverPolicy::All,
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            ack_wait: Duration::from_secs(30),
            max_deliver,
            max_ack_pending: 1000,
            ..Default::default()
        }
    }

    #[test]
    fn test_max_deliver_update_none_when_equal() {
        let current = existing_consumer_config(10);
        assert!(max_deliver_update(&current, 10).is_none());
    }

    #[test]
    fn test_max_deliver_update_none_when_unlimited_requested() {
        let current = existing_consumer_config(-1);
        assert!(max_deliver_update(&current, 0).is_none());
    }

    #[test]
    fn test_max_deliver_update_limits_an_unlimited_consumer() {
        let current = existing_consumer_config(-1);
        let updated = max_deliver_update(&current, 10).unwrap();
        assert_eq!(updated.max_deliver, 10);
        assert_eq!(
            jetstream::consumer::Config {
                max_deliver: current.max_deliver,
                ..updated
            },
            current
        );
    }

    #[test]
    fn test_with_consumer_name_keeps_max_deliver() {
        let q = NatsQueue {
            max_deliver: 10,
            ..NatsQueue::new("prefix")
        };
        assert_eq!(
            q.with_consumer_name("cluster".to_string(), true).max_deliver,
            10
        );
    }
}
