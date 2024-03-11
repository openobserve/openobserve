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

use std::sync::Arc;

use async_trait::async_trait;
use bytes::Bytes;
use config::{meta::meta_store::MetaStore, CONFIG};
use hashbrown::HashMap;
use tokio::sync::{mpsc, OnceCell};

use crate::errors::{DbError, Error, Result};

pub mod dynamo;
pub mod etcd;
pub mod mysql;
pub mod nats;
pub mod postgres;
pub mod sled;
pub mod sqlite;

pub static NEED_WATCH: bool = true;
pub static NO_NEED_WATCH: bool = false;

static DEFAULT: OnceCell<Box<dyn Db>> = OnceCell::const_new();
static CLUSTER_COORDINATOR: OnceCell<Box<dyn Db>> = OnceCell::const_new();

pub async fn get_db() -> &'static Box<dyn Db> {
    DEFAULT.get_or_init(default).await
}

pub async fn get_coordinator() -> &'static Box<dyn Db> {
    CLUSTER_COORDINATOR
        .get_or_init(init_cluster_coordinator)
        .await
}

pub async fn init() -> Result<()> {
    etcd::init().await;
    Ok(())
}

async fn default() -> Box<dyn Db> {
    if !CONFIG.common.local_mode
        && (CONFIG.common.meta_store == "sled" || CONFIG.common.meta_store == "sqlite")
    {
        panic!("cluster mode is not supported for ZO_META_STORE=sled/sqlite");
    }

    match CONFIG.common.meta_store.as_str().into() {
        MetaStore::Sled => Box::<sled::SledDb>::default(),
        MetaStore::Sqlite => Box::<sqlite::SqliteDb>::default(),
        MetaStore::Etcd => Box::<etcd::Etcd>::default(),
        MetaStore::Nats => Box::<nats::NatsDb>::default(),
        MetaStore::DynamoDB => Box::<dynamo::DynamoDb>::default(),
        MetaStore::MySQL => Box::<mysql::MysqlDb>::default(),
        MetaStore::PostgreSQL => Box::<postgres::PostgresDb>::default(),
    }
}

async fn init_cluster_coordinator() -> Box<dyn Db> {
    if CONFIG.common.local_mode {
        match CONFIG.common.meta_store.as_str().into() {
            MetaStore::Sled => Box::<sled::SledDb>::default(),
            _ => Box::<sqlite::SqliteDb>::default(),
        }
    } else {
        match CONFIG.common.cluster_coordinator.as_str().into() {
            MetaStore::Nats => Box::<nats::NatsDb>::default(),
            _ => Box::<etcd::Etcd>::default(),
        }
    }
}

pub async fn create_table() -> Result<()> {
    // check db dir
    std::fs::create_dir_all(&CONFIG.common.data_db_dir)?;
    // create for meta store
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator.create_table().await?;
    let db = get_db().await;
    db.create_table().await?;
    Ok(())
}

#[async_trait]
pub trait Db: Sync + Send + 'static {
    async fn create_table(&self) -> Result<()>;
    async fn stats(&self) -> Result<Stats>;
    async fn get(&self, key: &str) -> Result<Bytes>;
    async fn put(&self, key: &str, value: Bytes, need_watch: bool) -> Result<()>;
    async fn delete(&self, key: &str, with_prefix: bool, need_watch: bool) -> Result<()>;

    /// Contrary to `delete`, this call won't fail if `key` is missing.
    async fn delete_if_exists(&self, key: &str, with_prefix: bool, need_watch: bool) -> Result<()> {
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
    async fn close(&self) -> Result<()>;
}

pub fn parse_key(mut key: &str) -> (String, String, String, String) {
    let mut module = "".to_string();
    let mut key1 = "".to_string();
    let mut key2 = "".to_string();
    let mut key3 = "".to_string();
    if key.starts_with('/') {
        key = &key[1..];
    }
    if key.is_empty() {
        return (module, key1, key2, key3);
    }
    let columns = key.split('/').collect::<Vec<&str>>();
    match columns.len() {
        0 => {}
        1 => {
            module = columns[0].to_string();
        }
        2 => {
            module = columns[0].to_string();
            key1 = columns[1].to_string();
        }
        3 => {
            module = columns[0].to_string();
            key1 = columns[1].to_string();
            key2 = columns[2].to_string();
        }
        _ => {
            module = columns[0].to_string();
            key1 = columns[1].to_string();
            key2 = columns[2].to_string();
            key3 = columns[3..].join("/");
        }
    }
    (module, key1, key2, key3)
}

pub fn build_key(module: &str, key1: &str, key2: &str, key3: &str) -> String {
    if key1.is_empty() {
        format!("/{module}/")
    } else if key2.is_empty() {
        format!("/{module}/{key1}")
    } else if key3.is_empty() {
        format!("/{module}/{key1}/{key2}")
    } else {
        format!("/{module}/{key1}/{key2}/{key3}")
    }
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
    pub key3: String,
    pub value: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_put() {
        create_table().await.unwrap();
        let db = get_db().await;
        db.put("/foo/put/bar", Bytes::from("hello"), false)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_get() {
        create_table().await.unwrap();
        let db = get_db().await;
        let hello = Bytes::from("hello");
        db.put("/foo/get/bar", hello.clone(), false).await.unwrap();
        assert_eq!(db.get("/foo/get/bar").await.unwrap(), hello);
    }

    #[tokio::test]
    async fn test_delete() {
        create_table().await.unwrap();
        let db = get_db().await;
        let hello = Bytes::from("hello");

        db.put("/foo/del/bar1", hello.clone(), false).await.unwrap();
        db.put("/foo/del/bar2", hello.clone(), false).await.unwrap();
        db.put("/foo/del/bar3", hello.clone(), false).await.unwrap();
        db.delete("/foo/del/bar1", false, false).await.unwrap();
        assert!(db.delete("/foo/del/bar4", false, false).await.is_ok());
        db.delete("/foo/del/", true, false).await.unwrap();

        db.put("/foo/del/bar1", hello.clone(), false).await.unwrap();
        db.put("/foo/del/bar2", hello.clone(), false).await.unwrap();
        db.put("/foo/del/bar3", hello, false).await.unwrap();
        assert_eq!(db.list_keys("/foo/del/").await.unwrap().len(), 3);
        assert_eq!(db.list_values("/foo/del/").await.unwrap().len(), 3);
    }
}
