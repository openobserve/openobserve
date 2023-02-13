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
    match CONFIG.common.local_mode {
        true => Box::new(sled::Sled::new(&CONFIG.sled.prefix)),
        false => Box::new(etcd::Etcd::new(&CONFIG.etcd.prefix)),
    }
}

#[derive(Clone, Debug)]
pub enum Event {
    Put(EventData),
    Delete(EventData),
}

#[derive(Clone, Debug)]
pub struct EventData {
    pub key: String,
    pub value: Option<Bytes>,
}

#[async_trait]
pub trait Db: Sync + 'static {
    async fn get(&self, key: &str) -> Result<Bytes>;
    async fn put(&self, key: &str, value: Bytes) -> Result<()>;
    async fn delete(&self, key: &str, with_prefix: bool) -> Result<()>;
    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>>;
    async fn list_use_channel(&self, prefix: &str) -> Result<Arc<mpsc::Receiver<(String, Bytes)>>>;
    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>>;
    async fn list_values(&self, prefix: &str) -> Result<Vec<Bytes>>;
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
    use super::default;
    use bytes::Bytes;

    #[tokio::test]
    #[ignore]
    async fn test_get() {
        let db = default();
        db.put("/foo/bar", Bytes::from("hello")).await.unwrap();
        let value = db.get("/foo/bar").await.unwrap();
        assert_eq!(value, Bytes::from("hello"));
    }

    #[tokio::test]
    #[ignore]
    async fn test_put() {
        let db = default();
        assert_eq!(true, db.put("/foo/bar", Bytes::from("hello")).await.is_ok());
    }

    #[tokio::test]
    #[ignore]
    async fn test_delete() {
        let db = default();
        assert_eq!(
            true,
            db.put("/foo/bar1", Bytes::from("hello")).await.is_ok()
        );
        assert_eq!(
            true,
            db.put("/foo/bar2", Bytes::from("hello")).await.is_ok()
        );
        assert_eq!(
            true,
            db.put("/foo/bar3", Bytes::from("hello")).await.is_ok()
        );
        assert_eq!(true, db.delete("/foo/bar1", false).await.is_ok());
        assert_eq!(true, db.delete("/foo/bar4", false).await.is_err());
        assert_eq!(true, db.delete("/foo/", true).await.is_ok());
        let value = db.list_keys("/foo/").await.unwrap();
        assert_eq!(value.len(), 0);
    }
}
