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

use crate::common::{
    infra::{config::CONFIG, errors::Result},
    meta::{
        common::{FileKey, FileMeta},
        meta_store::MetaStore,
        stream::StreamStats,
    },
};

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
    // create for meta store
    CLUSTER_COORDINATOR.create_table().await?;
    DEFAULT.create_table().await?;
    Ok(())
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
    async fn create_table(&self) -> Result<()>;
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
    async fn close(&self) -> Result<()>;
}

pub fn parse_key(mut key: &str) -> (String, String, String) {
    let mut module = "".to_string();
    let mut key1 = "".to_string();
    let mut key2 = "".to_string();
    if key.starts_with('/') {
        key = &key[1..];
    }
    if key.is_empty() {
        return (module, key1, key2);
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
            key2 = columns[2..].join("/");
        }
    }
    (module, key1, key2)
}

pub fn build_key(module: &str, key1: &str, key2: &str) -> String {
    if key1.is_empty() {
        format!("/{module}/")
    } else if key2.is_empty() {
        format!("/{module}/{key1}")
    } else {
        format!("/{module}/{key1}/{key2}")
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
    pub value: String,
}

#[derive(Debug)]
pub enum DbEvent {
    Meta(DbEventMeta),
    FileList(DbEventFileList),
    FileListDeleted(DbEventFileListDeleted),
    StreamStats(DbEventStreamStats),
    CreateTableMeta,
    CreateTableFileList,
    CreateTableFileListIndex,
    Shutdown,
}

pub enum DbEventMeta {
    Put(String, Bytes, bool),
    Delete(String, bool, bool),
}

impl std::fmt::Debug for DbEventMeta {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbEventMeta::Put(key, _, _) => write!(f, "Put({})", key),
            DbEventMeta::Delete(key, _, _) => write!(f, "Delete({})", key),
        }
    }
}

pub enum DbEventFileList {
    Add(String, FileMeta),
    BatchAdd(Vec<FileKey>),
    BatchRemove(Vec<String>),
    Initialized,
}

impl std::fmt::Debug for DbEventFileList {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbEventFileList::Add(key, _) => write!(f, "Add({})", key),
            DbEventFileList::BatchAdd(keys) => write!(f, "BatchAdd({})", keys.len()),
            DbEventFileList::BatchRemove(keys) => write!(f, "BatchRemove({})", keys.len()),
            DbEventFileList::Initialized => write!(f, "Initialized"),
        }
    }
}

pub enum DbEventFileListDeleted {
    BatchAdd(i64, Vec<String>),
    BatchRemove(Vec<String>),
}

impl std::fmt::Debug for DbEventFileListDeleted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbEventFileListDeleted::BatchAdd(_, keys) => write!(f, "BatchAdd({})", keys.len()),
            DbEventFileListDeleted::BatchRemove(keys) => write!(f, "BatchRemove({})", keys.len()),
        }
    }
}

pub enum DbEventStreamStats {
    Set(String, Vec<(String, StreamStats)>),
    ResetMinTS(String, i64),
    ResetAll,
}

impl std::fmt::Debug for DbEventStreamStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbEventStreamStats::Set(key, _) => write!(f, "Set({})", key),
            DbEventStreamStats::ResetMinTS(key, _) => write!(f, "ResetMinTS({})", key),
            DbEventStreamStats::ResetAll => write!(f, "ResetAll"),
        }
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;

    #[actix_web::test]
    async fn test_put() {
        create_table().await.unwrap();
        let db = default();
        db.put("/foo/put/bar", Bytes::from("hello"), false)
            .await
            .unwrap();
    }

    #[actix_web::test]
    async fn test_get() {
        create_table().await.unwrap();
        let db = default();
        let hello = Bytes::from("hello");

        db.put("/foo/get/bar", hello.clone(), false).await.unwrap();
        assert_eq!(db.get("/foo/get/bar").await.unwrap(), hello);
    }

    #[actix_web::test]
    async fn test_delete() {
        create_table().await.unwrap();
        let db = default();
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
