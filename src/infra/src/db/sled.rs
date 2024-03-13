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
use config::{cluster, CONFIG};
use hashbrown::HashMap;
use once_cell::sync::Lazy;
use tokio::{sync::mpsc, task::JoinHandle};

use crate::{
    db::{Event, EventData},
    errors::*,
};

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
    async fn create_table(&self) -> Result<()> {
        Ok(())
    }

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

    async fn put(
        &self,
        key: &str,
        value: Bytes,
        _need_watch: bool,
        _updated_at: i64,
    ) -> Result<()> {
        let key = format!("{}{}", self.prefix, key);
        let client = SLED_CLIENT.clone().unwrap();
        client.insert(key.as_str(), value.to_vec())?;
        Ok(())
    }

    async fn delete(
        &self,
        key: &str,
        with_prefix: bool,
        _need_watch: bool,
        _updated_at: Option<i64>,
    ) -> Result<()> {
        let key = format!("{}{}", self.prefix, key);
        let client = SLED_CLIENT.clone().unwrap();
        if !with_prefix {
            let _ = client.remove(&key)?;
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

    async fn close(&self) -> Result<()> {
        Ok(())
    }
    async fn add_updated_at_column(&self) -> Result<()> {
        Ok(())
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
