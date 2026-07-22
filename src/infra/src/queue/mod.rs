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

use std::sync::Arc;

use async_nats::jetstream::AckKind;
use async_trait::async_trait;
use bytes::Bytes;
use config::meta::queue_store::QueueStore;
use tokio::sync::{OnceCell, mpsc};

use crate::errors::{Error, Result};

pub mod memory;
pub mod nats;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetentionPolicy {
    Interest,
    Limits,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliverPolicy {
    All,
    Last,
    New,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageType {
    File,
    Memory,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueConfig {
    pub max_age: Option<std::time::Duration>,
    pub retention_policy: RetentionPolicy,
    pub storage_type: StorageType,
}

pub struct QueueConfigBuilder {
    config: QueueConfig,
}

impl QueueConfigBuilder {
    pub fn new() -> Self {
        Self {
            config: QueueConfig {
                max_age: None,
                retention_policy: RetentionPolicy::Limits,
                storage_type: StorageType::File,
            },
        }
    }

    pub fn retention_policy(mut self, policy: RetentionPolicy) -> Self {
        self.config.retention_policy = policy;
        self
    }

    pub fn max_age(mut self, max_age: std::time::Duration) -> Self {
        self.config.max_age = Some(max_age);
        self
    }

    pub fn storage_type(mut self, storage_type: StorageType) -> Self {
        self.config.storage_type = storage_type;
        self
    }

    pub fn build(self) -> QueueConfig {
        self.config
    }
}

impl Default for QueueConfigBuilder {
    fn default() -> Self {
        Self::new()
    }
}

static DEFAULT: OnceCell<Box<dyn Queue>> = OnceCell::const_new();
static SUPER_CLUSTER: OnceCell<Box<dyn Queue>> = OnceCell::const_new();

pub async fn get_queue() -> &'static Box<dyn Queue> {
    DEFAULT.get_or_init(default).await
}

pub async fn get_super_cluster() -> &'static Box<dyn Queue> {
    SUPER_CLUSTER.get_or_init(init_super_cluster).await
}

pub async fn init() -> Result<()> {
    nats::init().await
}

async fn default() -> Box<dyn Queue> {
    let cfg = config::get_config();
    // config validation rejects unknown values at startup, so an error here is a bug
    match QueueStore::try_from(cfg.common.queue_store.as_str()) {
        Ok(QueueStore::Nats) => Box::<nats::NatsQueue>::default(),
        Ok(QueueStore::Memory) => {
            let queue = memory::MemoryQueue::default();
            log::info!(
                "queue backend=memory max_size_bytes={} durability=none scope=process",
                queue.limit_bytes()
            );
            Box::new(queue)
        }
        Err(e) => panic!("invalid queue store configuration: {e}"),
    }
}

async fn init_super_cluster() -> Box<dyn Queue> {
    if config::get_config().common.local_mode {
        panic!("super cluster is not supported in local mode");
    }
    Box::new(nats::NatsQueue::super_cluster())
}

#[async_trait]
pub trait Queue: Sync + Send + 'static {
    async fn create(&self, topic: &str) -> Result<()>;
    async fn create_with_config(&self, topic: &str, config: QueueConfig) -> Result<()>;
    async fn publish(&self, topic: &str, value: Bytes) -> Result<()>;
    async fn consume(
        &self,
        topic: &str,
        deliver_policy: Option<DeliverPolicy>,
    ) -> Result<Arc<mpsc::Receiver<Message>>>;
    async fn purge(&self, topic: &str, sequence: usize) -> Result<()>;
}

/// A queue message with a backend-independent payload and acknowledgement
/// handle. Callers must use [`Message::message`] and [`Message::ack`] and must
/// not depend on which backend produced the message.
pub struct Message {
    payload: Bytes,
    ack: AckHandle,
}

// messages are transient, so the size difference between variants is fine
#[allow(clippy::large_enum_variant)]
enum AckHandle {
    Nats(async_nats::jetstream::Message),
    Memory(memory::MemoryAckHandle),
}

impl Message {
    pub(crate) fn from_nats(msg: async_nats::jetstream::Message) -> Self {
        Self {
            // Bytes clone is a cheap refcount bump, not a payload copy
            payload: msg.payload.clone(),
            ack: AckHandle::Nats(msg),
        }
    }

    pub(crate) fn from_memory(payload: Bytes, handle: memory::MemoryAckHandle) -> Self {
        Self {
            payload,
            ack: AckHandle::Memory(handle),
        }
    }

    pub fn message(&self) -> &Bytes {
        &self.payload
    }

    pub async fn ack(&self) -> Result<()> {
        match &self.ack {
            AckHandle::Nats(msg) => msg
                .ack()
                .await
                .map_err(|e| Error::Message(format!("ack error:{e}")))?,
            AckHandle::Memory(handle) => handle.ack(),
        }
        Ok(())
    }

    pub async fn progress(&self) -> Result<()> {
        match self {
            Message::Nats(msg) => msg
                .ack_with(AckKind::Progress)
                .await
                .map_err(|e| Error::Message(format!("progress ack error:{e}")))?,
        }
        Ok(())
    }

    pub async fn double_ack(&self) -> Result<()> {
        match self {
            Message::Nats(msg) => msg
                .double_ack()
                .await
                .map_err(|e| Error::Message(format!("double ack error:{e}")))?,
        }
        Ok(())
    }
}

/// Normalize a topic name so it is valid for every queue backend.
///
/// The rules follow the NATS subject-name recommendations so both backends
/// resolve the same input to the same topic:
/// <https://docs.nats.io/nats-concepts/subjects#characters-allowed-and-recommended-for-subject-names>
pub(crate) fn format_key(key: &str) -> String {
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
    use std::time::Duration;

    use super::*;

    #[test]
    fn test_builder_default_has_no_max_age() {
        let cfg = QueueConfigBuilder::new().build();
        assert!(cfg.max_age.is_none());
    }

    #[test]
    fn test_builder_default_impl_equals_new() {
        let a = QueueConfigBuilder::new().build();
        let b = QueueConfigBuilder::default().build();
        assert!(a.max_age.is_none());
        assert!(b.max_age.is_none());
        // Both should have the same defaults
        assert!(matches!(a.retention_policy, RetentionPolicy::Limits));
        assert!(matches!(b.retention_policy, RetentionPolicy::Limits));
    }

    #[test]
    fn test_builder_set_max_age() {
        let cfg = QueueConfigBuilder::new()
            .max_age(Duration::from_secs(3600))
            .build();
        assert_eq!(cfg.max_age, Some(Duration::from_secs(3600)));
    }

    #[test]
    fn test_builder_set_retention_policy_interest() {
        let cfg = QueueConfigBuilder::new()
            .retention_policy(RetentionPolicy::Interest)
            .build();
        assert!(matches!(cfg.retention_policy, RetentionPolicy::Interest));
    }

    #[test]
    fn test_builder_set_storage_type_memory() {
        let cfg = QueueConfigBuilder::new()
            .storage_type(StorageType::Memory)
            .build();
        assert!(matches!(cfg.storage_type, StorageType::Memory));
    }

    #[test]
    fn test_builder_chained() {
        let cfg = QueueConfigBuilder::new()
            .max_age(Duration::from_secs(60))
            .retention_policy(RetentionPolicy::Limits)
            .storage_type(StorageType::File)
            .build();
        assert_eq!(cfg.max_age, Some(Duration::from_secs(60)));
        assert!(matches!(cfg.retention_policy, RetentionPolicy::Limits));
        assert!(matches!(cfg.storage_type, StorageType::File));
    }

    #[test]
    fn test_format_key() {
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
