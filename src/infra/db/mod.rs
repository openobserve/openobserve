// Copyright 2022 Zinc Labs Inc. and Contributors
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
use std::sync::Arc;
use tokio::sync::mpsc;

use super::config::CONFIG;
use super::errors::Result;

pub mod etcd;
pub mod sled;

pub use self::etcd::ETCD_CLIENT;
pub use self::sled::SLED_CLIENT;

lazy_static! {
    pub static ref DEFAULT: Box<dyn Db> = default();
}

pub fn default() -> Box<dyn Db> {
    if CONFIG.common.local_mode {
        Box::<sled::Sled>::default()
    } else {
        Box::<etcd::Etcd>::default()
    }
}

#[derive(Debug, Default)]
pub struct Stats {
    pub bytes_len: u64,
    pub keys_count: usize,
}

#[derive(Debug)]
pub enum Event {
    Put(EventData),
    Delete(EventData),
}

#[derive(Debug)]
pub struct EventData {
    pub key: String,
    pub value: Option<Bytes>,
}

#[async_trait]
pub trait Db: Sync + 'static {
    async fn stats(&self) -> Result<Stats>;
    async fn get(&self, key: &str) -> Result<Bytes>;
    async fn put(&self, key: &str, value: Bytes) -> Result<()>;
    async fn delete(&self, key: &str, with_prefix: bool) -> Result<()>;

    /// Contrary to `delete`, this call won't fail if `key` is missing.
    async fn delete_if_exists(&self, key: &str, with_prefix: bool) -> Result<()> {
        use crate::infra::errors::{DbError, Error};

        match self.delete(key, with_prefix).await {
            Ok(()) | Err(Error::DbError(DbError::KeyNotExists(_))) => Ok(()),
            Err(e) => Err(e),
        }
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>>;
    async fn list_use_channel(&self, prefix: &str) -> Result<Arc<mpsc::Receiver<(String, Bytes)>>>;
    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>>;
    async fn list_values(&self, prefix: &str) -> Result<Vec<Bytes>>;
    async fn count(&self, prefix: &str) -> Result<usize>;
    async fn watch(&self, prefix: &str) -> Result<Arc<mpsc::Receiver<Event>>>;
    async fn transaction(
        &self,
        check_key: &str, // check the key exists
        and_ops: Vec<Event>,
        else_ops: Vec<Event>,
    ) -> Result<()>;
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;

    #[actix_web::test]
    async fn test_put() {
        let db = default();
        db.put("/foo/bar", Bytes::from("hello")).await.unwrap();
    }

    #[actix_web::test]
    async fn test_get() {
        let db = default();
        let hello = Bytes::from("hello");

        db.put("/foo/bar", hello.clone()).await.unwrap();
        assert_eq!(db.get("/foo/bar").await.unwrap(), hello);
    }

    #[actix_web::test]
    async fn test_delete() {
        let db = default();
        let hello = Bytes::from("hello");

        db.put("/foo/bar1", hello.clone()).await.unwrap();
        db.put("/foo/bar2", hello.clone()).await.unwrap();
        db.put("/foo/bar3", hello.clone()).await.unwrap();
        db.delete("/foo/bar1", false).await.unwrap();
        assert!(db.delete("/foo/bar4", false).await.is_err());
        db.delete("/foo/", true).await.unwrap();

        db.put("/foo/bar1", hello.clone()).await.unwrap();
        db.put("/foo/bar2", hello.clone()).await.unwrap();
        db.put("/foo/bar3", hello).await.unwrap();
        assert_eq!(db.list_keys("/foo/").await.unwrap().len(), 3);
        assert_eq!(db.list_values("/foo/").await.unwrap().len(), 3);

        let mut events = db.list_use_channel("/foo/").await.unwrap();
        let events = Arc::get_mut(&mut events).unwrap();
        assert_eq!(events.recv().await.unwrap().0, "/foo/bar1");
    }
}
