// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::HashMap;
use async_trait::async_trait;
use bytes::Bytes;
use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::common::meta::meta_store::MetaStore;

use super::config::CONFIG;
use super::errors::Result;

pub mod dynamo;
pub mod etcd;
pub mod postgres;
pub mod sled;
pub mod sqlite;

pub static NEED_WATCH: bool = true;
pub static NO_NEED_WATCH: bool = false;

pub static DEFAULT: Lazy<Box<dyn Db>> = Lazy::new(default);
pub static CLUSTER_COORDINATOR: Lazy<Box<dyn Db>> = Lazy::new(cluster_coordinator);

pub fn default() -> Box<dyn Db> {
    if !CONFIG.common.local_mode
        && (CONFIG.common.meta_store == "sled" || CONFIG.common.meta_store == "sqlite")
    {
        panic!("cluster mode is not supported for ZO_META_STORE=sled/sqlite");
    }

    match CONFIG.common.meta_store.as_str().into() {
        MetaStore::Sled => Box::<sled::SledDb>::default(),
        MetaStore::Sqlite => Box::<sqlite::SqliteDb>::default(),
        MetaStore::Etcd => Box::<etcd::Etcd>::default(),
        MetaStore::DynamoDB => Box::<dynamo::DynamoDb>::default(),
        MetaStore::PostgreSQL => Box::<postgres::PostgresDb>::default(),
    }
}

pub async fn create_table() -> Result<()> {
    // check db dir
    std::fs::create_dir_all(&CONFIG.common.data_db_dir)?;
    match CONFIG.common.meta_store.as_str().into() {
        MetaStore::Sled => sled::create_table().await,
        MetaStore::Sqlite => sqlite::create_table().await,
        MetaStore::Etcd => etcd::create_table().await,
        MetaStore::DynamoDB => dynamo::create_table().await,
        MetaStore::PostgreSQL => postgres::create_table().await,
    }
}

pub fn cluster_coordinator() -> Box<dyn Db> {
    if CONFIG.common.local_mode {
        match CONFIG.common.meta_store.as_str().into() {
            MetaStore::Sled => Box::<sled::SledDb>::default(),
            _ => Box::<sqlite::SqliteDb>::default(),
        }
    } else {
        Box::<etcd::Etcd>::default()
    }
}

#[async_trait]
pub trait Db: Sync + Send + 'static {
    async fn stats(&self) -> Result<Stats>;
    async fn get(&self, key: &str) -> Result<Bytes>;
    async fn put(&self, key: &str, value: Bytes, need_watch: bool) -> Result<()>;
    async fn delete(&self, key: &str, with_prefix: bool, need_watch: bool) -> Result<()>;

    /// Contrary to `delete`, this call won't fail if `key` is missing.
    async fn delete_if_exists(&self, key: &str, with_prefix: bool, need_watch: bool) -> Result<()> {
        use crate::common::infra::errors::{DbError, Error};

        match self.delete(key, with_prefix, need_watch).await {
            Ok(()) | Err(Error::DbError(DbError::KeyNotExists(_))) => Ok(()),
            Err(e) => Err(e),
        }
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>>;
    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>>;
    async fn list_values(&self, prefix: &str) -> Result<Vec<Bytes>>;
    async fn count(&self, prefix: &str) -> Result<i64>;
    async fn watch(&self, prefix: &str) -> Result<Arc<mpsc::Receiver<Event>>>;
}

#[derive(Debug, Default)]
pub struct Stats {
    pub bytes_len: i64,
    pub keys_count: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Put(EventData),
    Delete(EventData),
    Empty,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EventData {
    pub key: String,
    pub value: Option<Bytes>,
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct MetaRecord {
    pub module: String,
    pub key1: String,
    pub key2: String,
    pub value: Vec<u8>,
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;

    #[actix_web::test]
    async fn test_put() {
        let db = default();
        db.put("/foo/bar", Bytes::from("hello"), false)
            .await
            .unwrap();
    }

    #[actix_web::test]
    async fn test_get() {
        let db = default();
        let hello = Bytes::from("hello");

        db.put("/foo/bar", hello.clone(), false).await.unwrap();
        assert_eq!(db.get("/foo/bar").await.unwrap(), hello);
    }

    #[actix_web::test]
    async fn test_delete() {
        let db = default();
        let hello = Bytes::from("hello");

        db.put("/foo/bar1", hello.clone(), false).await.unwrap();
        db.put("/foo/bar2", hello.clone(), false).await.unwrap();
        db.put("/foo/bar3", hello.clone(), false).await.unwrap();
        db.delete("/foo/bar1", false, false).await.unwrap();
        assert!(db.delete("/foo/bar4", false, false).await.is_err());
        db.delete("/foo/", true, false).await.unwrap();

        db.put("/foo/bar1", hello.clone(), false).await.unwrap();
        db.put("/foo/bar2", hello.clone(), false).await.unwrap();
        db.put("/foo/bar3", hello, false).await.unwrap();
        assert_eq!(db.list_keys("/foo/").await.unwrap().len(), 3);
        assert_eq!(db.list_values("/foo/").await.unwrap().len(), 3);
    }
}
