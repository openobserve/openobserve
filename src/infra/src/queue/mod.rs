// Copyright 2023 Zinc Labs Inc.
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

use async_trait::async_trait;
use bytes::Bytes;
use config::{meta::meta_store::MetaStore, CONFIG};
use tokio::sync::OnceCell;

use crate::errors::Result;

pub mod nats;

static DEFAULT: OnceCell<Box<dyn Queue>> = OnceCell::const_new();
static SUPER_CLUSTER: OnceCell<Box<dyn Queue>> = OnceCell::const_new();

pub async fn get_queue() -> &'static Box<dyn Queue> {
    DEFAULT.get_or_init(default).await
}

pub async fn get_super_cluster() -> &'static Box<dyn Queue> {
    SUPER_CLUSTER.get_or_init(init_super_cluster).await
}

pub async fn init() -> Result<()> {
    if CONFIG.common.local_mode {
        return Ok(());
    }
    nats::init().await
}

async fn default() -> Box<dyn Queue> {
    match CONFIG.common.queue_store.as_str().into() {
        MetaStore::Nats => Box::<nats::NatsQueue>::default(),
        _ => panic!("unsupported queue store"),
    }
}

async fn init_super_cluster() -> Box<dyn Queue> {
    match CONFIG.common.queue_store.as_str().into() {
        MetaStore::Nats => Box::new(nats::NatsQueue::super_cluster()),
        _ => panic!("unsupported queue store"),
    }
}

#[async_trait]
pub trait Queue: Sync + Send + 'static {
    async fn create(&self, topic: &str) -> Result<()>;
    async fn publish(&self, topic: &str, value: Bytes) -> Result<()>;
    async fn sub(&self, topic: &str) -> Result<Bytes>;
    async fn purge(&self, topic: &str, sequence: usize) -> Result<()>;
}
