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

use std::{cmp::max, sync::Arc};

use async_nats::jetstream::{self, consumer::DeliverPolicy};
use async_trait::async_trait;
use bytes::Bytes;
use config::{get_cluster_name, get_config};
use futures::TryStreamExt;
use tokio::{sync::mpsc, task::JoinHandle};

use crate::{db::nats::get_nats_client, errors::*, queue};

pub async fn init() -> Result<()> {
    Ok(())
}

pub struct NatsQueue {
    prefix: String,
    consumer_name: String,
    is_durable: bool,
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
        let config = jetstream::stream::Config {
            name: topic_name.to_string(),
            subjects: vec![topic_name.to_string(), format!("{}.*", topic_name)],
            retention: config.retention_policy.into(),
            storage: config.storage_type.into(),
            num_replicas: cfg.nats.replicas,
            max_bytes: cfg.nats.queue_max_size,
            max_age,
            ..Default::default()
        };
        _ = jetstream.get_or_create_stream(config).await?;
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

    async fn consume(
        &self,
        topic: &str,
        deliver_policy: Option<queue::DeliverPolicy>,
    ) -> Result<Arc<mpsc::Receiver<super::Message>>> {
        let (tx, rx) = mpsc::channel(1024);
        let stream_name = format!("{}{}", self.prefix, format_key(topic));
        let consumer_name = self.consumer_name.clone();
        let is_durable = self.is_durable;
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
                let message = super::Message::Nats(message);
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

    async fn purge(&self, _topic: &str, _sequence: usize) -> Result<()> {
        Ok(())
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

// format the key to be a valid nats key
// refer to: https://docs.nats.io/nats-concepts/subjects#characters-allowed-and-recommended-for-subject-names
fn format_key(key: &str) -> String {
    let mut result = String::new();

    for ch in key.chars() {
        match ch {
            // Keep recommended characters as-is
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => result.push(ch),
            // Replace other characters with underscore for safety
            _ => result.push('_'),
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::format_key;

    #[test]
    fn test_queue_nats_format_key() {
        // Test basic functionality
        assert_eq!(format_key("test"), "test");
        assert_eq!(format_key("test123"), "test123");
        assert_eq!(format_key("test-key"), "test-key");
        assert_eq!(format_key("test_key"), "test_key");

        // Test forbidden characters
        assert_eq!(format_key("test.key"), "test_key");
        assert_eq!(format_key("test*key"), "test_key");
        assert_eq!(format_key("test>key"), "test_key");
        assert_eq!(format_key("test key"), "test_key");
        assert_eq!(format_key("test\0key"), "test_key");

        // Test empty string
        assert_eq!(format_key(""), "");

        // Test mixed characters
        assert_eq!(format_key("test@#$%^&*()key"), "test_________key");
        assert_eq!(format_key("test.key*value>data"), "test_key_value_data");

        // Test unicode characters (should be replaced with _)
        assert_eq!(format_key("test中文key"), "test__key");
        assert_eq!(format_key("test🚀key"), "test_key");
    }
}
