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
use tokio::{sync::mpsc, task::JoinHandle};

use super::{Event, EventData};
use crate::common::infra::{cluster, config::CONFIG, errors::*};

pub static SLED_CLIENT: Lazy<Option<::sled::Db>> = Lazy::new(connect_sled);

pub struct SledDb {
    prefix: String,
}

impl SledDb {
    pub fn new(prefix: &str) -> SledDb {
        let prefix = prefix.trim_end_matches(|v| v == '/');
        Self {
            prefix: prefix.to_string(),
        }
    }
}

impl Default for SledDb {
    fn default() -> Self {
        Self::new(&CONFIG.sled.prefix)
    }
}

#[async_trait]
impl super::Db for SledDb {
    async fn stats(&self) -> Result<super::Stats> {
        let client = SLED_CLIENT.clone().unwrap();
        let bytes_len = client.size_on_disk()?;
        let keys_count = client.len();
        Ok(super::Stats {
            bytes_len: bytes_len as i64,
            keys_count: keys_count as i64,
        })
    }

    async fn get(&self, key: &str) -> Result<Bytes> {
        let key = format!("{}{}", self.prefix, key);
        let client = SLED_CLIENT.clone().unwrap();
        let result = client.get(&key);

        match result {
            Ok(Some(data)) => Ok(Bytes::from(data.as_ref().to_vec())),
            Ok(None) | Err(_) => Err(Error::from(DbError::KeyNotExists(key))),
        }
    }

    async fn put(&self, key: &str, value: Bytes) -> Result<()> {
        let key = format!("{}{}", self.prefix, key);
        let client = SLED_CLIENT.clone().unwrap();
        client.insert(key.as_str(), value.to_vec())?;
        Ok(())
    }

    async fn delete(&self, key: &str, with_prefix: bool) -> Result<()> {
        let key = format!("{}{}", self.prefix, key);
        let client = SLED_CLIENT.clone().unwrap();
        if !with_prefix {
            let result = client.remove(&key)?;
            if result.is_none() {
                return Err(Error::from(DbError::KeyNotExists(key)));
            }
            return Ok(());
        }

        // prefix mod
        let mut resp = client.scan_prefix(key);
        loop {
            let item = resp.next();
            if item.is_none() {
                break;
            }
            let item = item.unwrap();
            let (k, _v) = item.unwrap();
            client.remove(&k)?;
        }
        Ok(())
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>> {
        let mut result = HashMap::default();
        let key = format!("{}{}", self.prefix, prefix);
        let client = SLED_CLIENT.clone().unwrap();
        let mut resp = client.scan_prefix(key);
        loop {
            let item = resp.next();
            if item.is_none() {
                break;
            }
            let item = item.unwrap();
            let (k, v) = item.unwrap();
            let item_key = std::str::from_utf8(k.as_ref()).unwrap();
            let item_key = item_key.strip_prefix(&self.prefix).unwrap();
            result.insert(item_key.to_string(), Bytes::from(v.as_ref().to_vec()));
        }
        Ok(result)
    }

    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        let mut result = Vec::new();
        let key = format!("{}{}", self.prefix, prefix);
        let client = SLED_CLIENT.clone().unwrap();
        let mut resp = client.scan_prefix(key);
        loop {
            let item = resp.next();
            if item.is_none() {
                break;
            }
            let item = item.unwrap();
            let (k, _v) = item.unwrap();
            let item_key = std::str::from_utf8(k.as_ref()).unwrap();
            let item_key = item_key.strip_prefix(&self.prefix).unwrap();
            result.push(item_key.to_string());
        }
        Ok(result)
    }

    async fn list_values(&self, prefix: &str) -> Result<Vec<Bytes>> {
        let mut result = Vec::new();
        let key = format!("{}{}", self.prefix, prefix);
        let client = SLED_CLIENT.clone().unwrap();
        let mut resp = client.scan_prefix(key);
        loop {
            let item = resp.next();
            if item.is_none() {
                break;
            }
            let item = item.unwrap();
            let (_k, v) = item.unwrap();
            result.push(Bytes::from(v.as_ref().to_vec()));
        }
        Ok(result)
    }

    async fn count(&self, prefix: &str) -> Result<i64> {
        let key = format!("{}{}", self.prefix, prefix);
        let client = SLED_CLIENT.clone().unwrap();
        let resp = client.scan_prefix(key);
        Ok(resp.into_iter().count() as i64)
    }

    async fn watch(&self, prefix: &str) -> Result<Arc<mpsc::Receiver<Event>>> {
        let (tx, rx) = mpsc::channel(1024);
        let key = format!("{}{}", &self.prefix, prefix);
        let prefix_key = self.prefix.to_string();
        let _task: JoinHandle<Result<()>> = tokio::task::spawn(async move {
            loop {
                if cluster::is_offline() {
                    break;
                }
                let client = SLED_CLIENT.clone().unwrap();
                let mut subscriber = client.watch_prefix(key.clone());
                while let Some(event) = (&mut subscriber).await {
                    match event {
                        ::sled::Event::Insert { key, value } => {
                            let item_key = std::str::from_utf8(key.as_ref()).unwrap();
                            let item_key = item_key.strip_prefix(&prefix_key.clone()).unwrap();
                            tx.send(Event::Put(EventData {
                                key: item_key.to_string(),
                                value: Some(Bytes::from(value.as_ref().to_vec())),
                            }))
                            .await
                            .unwrap();
                        }
                        ::sled::Event::Remove { key } => {
                            let item_key = std::str::from_utf8(key.as_ref()).unwrap();
                            let item_key = item_key.strip_prefix(&prefix_key.clone()).unwrap();
                            tx.send(Event::Delete(EventData {
                                key: item_key.to_string(),
                                value: None,
                            }))
                            .await
                            .unwrap();
                        }
                    };
                }
            }
            Ok(())
        });

        Ok(Arc::new(rx))
    }
}

pub fn connect_sled() -> Option<::sled::Db> {
    if !CONFIG.common.local_mode {
        return None;
    }

    let db = ::sled::open(&CONFIG.sled.data_dir).expect("sled db dir create failed");
    Some(db)
}

pub async fn create_table() -> Result<()> {
    Ok(())
}
