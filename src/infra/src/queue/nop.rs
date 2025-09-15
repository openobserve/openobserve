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

use async_trait::async_trait;
use bytes::Bytes;
use tokio::sync::mpsc;

use crate::{
    errors::*,
    queue::{DeliverPolicy, RetentionPolicy},
};

pub async fn init() -> Result<()> {
    Ok(())
}

pub struct NopQueue {}

impl NopQueue {
    pub fn new(_prefix: &str) -> Self {
        Self {}
    }

    pub fn super_cluster() -> Self {
        Self::new("")
    }
}

impl Default for NopQueue {
    fn default() -> Self {
        Self::new("")
    }
}

#[async_trait]
impl super::Queue for NopQueue {
    async fn create(&self, _topic: &str) -> Result<()> {
        self.create_with_retention_policy(_topic, RetentionPolicy::Limits)
            .await
    }

    async fn create_with_retention_policy(
        &self,
        _topic: &str,
        _retention_policy: RetentionPolicy,
    ) -> Result<()> {
        let max_age = config::get_config().nats.queue_max_age; // days
        let max_age_secs = std::time::Duration::from_secs(max_age * 24 * 60 * 60);
        self.create_with_retention_policy_and_max_age(_topic, _retention_policy, max_age_secs)
            .await
    }

    async fn create_with_max_age(&self, _topic: &str, _max_age: std::time::Duration) -> Result<()> {
        self.create_with_retention_policy_and_max_age(_topic, RetentionPolicy::Limits, _max_age)
            .await
    }

    async fn create_with_retention_policy_and_max_age(
        &self,
        _topic: &str,
        _retention_policy: RetentionPolicy,
        _max_age: std::time::Duration,
    ) -> Result<()> {
        todo!()
    }

    async fn publish(&self, _topic: &str, _value: Bytes) -> Result<()> {
        todo!()
    }

    async fn consume(
        &self,
        _topic: &str,
        _deliver_policy: Option<DeliverPolicy>,
    ) -> Result<Arc<mpsc::Receiver<super::Message>>> {
        todo!()
    }

    async fn purge(&self, _topic: &str, _sequence: usize) -> Result<()> {
        todo!()
    }
}
