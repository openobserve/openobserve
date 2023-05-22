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
use sled::transaction::ConflictableTransactionError;
use std::sync::Arc;
use tokio::{sync::mpsc, task::JoinHandle};

use super::{Event, EventData};
use crate::infra::cluster;
use crate::infra::{config::CONFIG, errors::*};

lazy_static! {
    pub static ref SLED_CLIENT: Option<::sled::Db> = connect_sled();
}

pub struct Sled {
    prefix: String,
}

impl Sled {
    pub fn new(prefix: &str) -> Sled {
        let prefix = prefix.trim_end_matches(|v| v == '/');
        Sled {
            prefix: prefix.to_string(),
        }
    }
}

impl Default for Sled {
    fn default() -> Self {
        Self::new(&CONFIG.sled.prefix)
    }
}

#[async_trait]
impl super::Db for Sled {
    async fn stats(&self) -> Result<super::Stats> {
        let client = SLED_CLIENT.clone().unwrap();
        let bytes_len = client.size_on_disk()?;
        let keys_count = client.len();
        Ok(super::Stats {
            bytes_len,
            keys_count,
        })
    }

    async fn get(&self, key: &str) -> Result<Bytes> {
        let key = format!("{}{}", self.prefix, key);
        let client = SLED_CLIENT.clone().unwrap();
        let result = client.get(&key);
        if result.is_err() {
            return Err(Error::from(DbError::KeyNotExists(key)));
        }
        let result = result.unwrap();
        if result.is_none() {
            return Err(Error::from(DbError::KeyNotExists(key)));
        }
        let value: Bytes = Bytes::from(result.unwrap().as_ref().to_vec());
        Ok(value)
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

    async fn list_use_channel(&self, prefix: &str) -> Result<Arc<mpsc::Receiver<(String, Bytes)>>> {
        let (tx, rx) = mpsc::channel(CONFIG.etcd.load_page_size as usize);
        let key = format!("{}{}", self.prefix, prefix);
        let prefix_key = self.prefix.to_string();
        let _task: JoinHandle<Result<()>> = tokio::task::spawn(async move {
            let client = SLED_CLIENT.clone().unwrap();
            let mut resp = client.scan_prefix(key);
            let mut load_num = 0;
            loop {
                let item = resp.next();
                if item.is_none() {
                    break;
                }
                let item = item.unwrap();
                let (k, v) = item.unwrap();
                let item_key = std::str::from_utf8(k.as_ref()).unwrap();
                let item_key = item_key.strip_prefix(&prefix_key).unwrap();
                tx.send((item_key.to_string(), Bytes::from(v.as_ref().to_vec())))
                    .await
                    .unwrap();
                load_num += 1;
                if load_num % CONFIG.etcd.load_page_size == 0 {
                    tokio::task::yield_now().await; // yield to other tasks
                }
            }
            Ok(())
        });
        Ok(Arc::new(rx))
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

    async fn count(&self, prefix: &str) -> Result<usize> {
        let key = format!("{}{}", self.prefix, prefix);
        let client = SLED_CLIENT.clone().unwrap();
        let resp = client.scan_prefix(key);
        Ok(resp.into_iter().count())
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

    async fn transaction(
        &self,
        check_key: &str,
        and_ops: Vec<Event>,
        else_ops: Vec<Event>,
    ) -> Result<()> {
        let client = SLED_CLIENT.clone().unwrap();
        let mut check_result = false;
        let key = format!("{}{}", self.prefix, check_key);
        let ret = client.get(key);
        if ret.is_err() {
            return Err(Error::from(ret.err().unwrap()));
        }
        let ret = ret.unwrap();
        if ret.is_some() {
            check_result = true;
        }
        match client.transaction(|db| {
            match check_result {
                true => {
                    for op in &and_ops {
                        match op {
                            Event::Put(data) => {
                                let key = format!("{}{}", self.prefix, data.key);
                                let value = data.value.clone().unwrap();
                                if let Err(e) = db.insert(key.as_str(), value.to_vec()) {
                                    return Err(ConflictableTransactionError::Abort(e));
                                }
                            }
                            Event::Delete(data) => {
                                let key = format!("{}{}", self.prefix, data.key);
                                if let Err(e) = db.remove(key.as_str()) {
                                    return Err(ConflictableTransactionError::Abort(e));
                                }
                            }
                        }
                    }
                }
                false => {
                    for op in &else_ops {
                        match op {
                            Event::Put(data) => {
                                let key = format!("{}{}", self.prefix, data.key);
                                let value = data.value.clone().unwrap();
                                if let Err(e) = db.insert(key.as_str(), value.to_vec()) {
                                    return Err(ConflictableTransactionError::Abort(e));
                                }
                            }
                            Event::Delete(data) => {
                                let key = format!("{}{}", self.prefix, data.key);
                                if let Err(e) = db.remove(key.as_str()) {
                                    return Err(ConflictableTransactionError::Abort(e));
                                }
                            }
                        }
                    }
                }
            }
            Ok(())
        }) {
            Ok(_) => Ok(()),
            Err(e) => Err(Error::Message(e.to_string())),
        }
    }
}

pub fn connect_sled() -> Option<::sled::Db> {
    if !CONFIG.common.local_mode {
        return None;
    }

    let db = ::sled::open(&CONFIG.sled.data_dir).expect("sled db dir create failed");
    Some(db)
}
