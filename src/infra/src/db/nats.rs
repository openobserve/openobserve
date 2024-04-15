// Copyright 2024 Zinc Labs Inc.
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

use std::{
    cmp::min,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    time::Duration,
};

use async_nats::{jetstream, Client, ServerAddr};
use async_trait::async_trait;
use bytes::Bytes;
use config::{cluster, ider, utils::base64, CONFIG};
use futures::{StreamExt, TryStreamExt};
use hashbrown::HashMap;
use tokio::{
    sync::{mpsc, OnceCell},
    task::JoinHandle,
};

use crate::{
    db::{Event, EventData},
    dist_lock,
    errors::*,
};

static NATS_CLIENT: OnceCell<Client> = OnceCell::const_new();

pub async fn get_nats_client() -> &'static Client {
    NATS_CLIENT.get_or_init(connect).await
}

async fn get_bucket_by_key<'a>(
    prefix: &'a str,
    key: &'a str,
) -> Result<(jetstream::kv::Store, &'a str)> {
    let client = get_nats_client().await.clone();
    let jetstream = jetstream::new(client);
    let key = key.trim_start_matches('/');
    let bucket_name = key.split('/').next().unwrap();
    let mut bucket = jetstream::kv::Config {
        bucket: format!("{}{}", prefix, bucket_name),
        num_replicas: CONFIG.nats.replicas,
        history: 3,
        ..Default::default()
    };
    if bucket_name == "nodes" || bucket_name == "clusters" {
        // if changed ttl need recreate the bucket
        // CMD: nats kv del -f o2_nodes
        bucket.max_age = Duration::from_secs(CONFIG.limit.node_heartbeat_ttl as u64);
    }
    let kv = jetstream.create_key_value(bucket).await?;
    Ok((kv, key.trim_start_matches(bucket_name)))
}

pub async fn init() {}

pub struct NatsDb {
    prefix: String,
}

impl NatsDb {
    pub fn new(prefix: &str) -> Self {
        let prefix = prefix.trim_end_matches(|v| v == '/');
        Self {
            prefix: prefix.to_string(),
        }
    }

    pub fn super_cluster() -> Self {
        Self::new("super_cluster_kv_")
    }

    async fn get_key_value(&self, key: &str) -> Result<(String, Bytes)> {
        let (bucket, new_key) = get_bucket_by_key(&self.prefix, key).await?;
        let bucket_name = bucket.status().await?.bucket;
        let en_key = base64::encode(new_key);
        if let Some(v) = bucket.get(&en_key).await? {
            return Ok((key.to_string(), v));
        }
        // try as prefix, with start_dt
        let keys = bucket.keys().await?.try_collect::<Vec<String>>().await?;
        let mut keys = keys
            .into_iter()
            .filter_map(|k| {
                let key = base64::decode(&k).unwrap();
                if key.starts_with(new_key) {
                    Some(key)
                } else {
                    None
                }
            })
            .collect::<Vec<String>>();
        let keys_len = keys.len();
        if keys_len == 0 {
            return Err(Error::from(DbError::KeyNotExists(key.to_string())));
        }
        keys.sort();
        let key = keys.last().unwrap();
        let en_key = base64::encode(key);
        match bucket.get(&en_key).await? {
            None => Err(Error::from(DbError::KeyNotExists(key.to_string()))),
            Some(v) => {
                let bucket_prefix = "/".to_string() + bucket_name.trim_start_matches(&self.prefix);
                let key = bucket_prefix.to_string() + key;
                Ok((key, v))
            }
        }
    }
}

impl Default for NatsDb {
    fn default() -> Self {
        Self::new(&CONFIG.nats.prefix)
    }
}

#[async_trait]
impl super::Db for NatsDb {
    async fn create_table(&self) -> Result<()> {
        Ok(())
    }

    async fn stats(&self) -> Result<super::Stats> {
        let client = get_nats_client().await.clone();
        let jetstream = async_nats::jetstream::new(client);
        let mut keys_count = 0;
        let mut bytes_len = 0;
        let mut streams = jetstream.streams();
        while let Some(stream) = streams.try_next().await? {
            keys_count += stream.state.messages;
            bytes_len += stream.state.bytes;
        }
        Ok(super::Stats {
            bytes_len: bytes_len as i64,
            keys_count: keys_count as i64,
        })
    }

    async fn get(&self, key: &str) -> Result<Bytes> {
        let (bucket, new_key) = get_bucket_by_key(&self.prefix, key).await?;
        let key = base64::encode(new_key);
        if let Some(v) = bucket.get(&key).await? {
            return Ok(v);
        }
        // try as prefix, with start_dt
        let keys = bucket.keys().await?.try_collect::<Vec<String>>().await?;
        let mut keys = keys
            .into_iter()
            .filter_map(|k| {
                let key = base64::decode(&k).unwrap();
                if key.starts_with(new_key) {
                    Some(key)
                } else {
                    None
                }
            })
            .collect::<Vec<String>>();
        let keys_len = keys.len();
        if keys_len == 0 {
            return Err(Error::from(DbError::KeyNotExists(key.to_string())));
        }
        keys.sort();
        let key = keys.last().unwrap();
        match bucket.get(key).await? {
            None => Err(Error::from(DbError::KeyNotExists(key.to_string()))),
            Some(v) => Ok(v),
        }
    }

    async fn put(
        &self,
        key: &str,
        value: Bytes,
        _need_watch: bool,
        start_dt: Option<i64>,
    ) -> Result<()> {
        let key = if start_dt.is_some() {
            format!("{}/{}", key, start_dt.unwrap())
        } else {
            key.to_string()
        };
        let (bucket, new_key) = get_bucket_by_key(&self.prefix, &key).await?;
        let key = base64::encode(new_key);
        _ = bucket.put(&key, value).await?;
        Ok(())
    }

    async fn get_for_update(
        &self,
        key: &str,
        need_watch: bool,
        start_dt: Option<i64>,
        update_fn: Box<super::UpdateFn>,
    ) -> Result<()> {
        // acquire lock and update
        let lock_key = format!("/meta{key}/{}", start_dt.unwrap_or_default());
        let locker = match dist_lock::lock(&lock_key, 0).await {
            Ok(v) => v,
            Err(e) => {
                return Err(Error::Message(format!(
                    "dist_lock key: {}, acquire error: {}",
                    lock_key, e
                )));
            }
        };
        log::info!("Acquired lock for cluster key: {}", lock_key);

        // get value and update
        let value = self.get_key_value(key).await.ok();
        let old_key = value.as_ref().map(|v| v.0.clone());
        let old_value = value.map(|v| v.1);
        let ret = match update_fn(old_value) {
            Err(e) => Err(e),
            Ok(None) => Ok(()),
            Ok(Some((value, new_value))) => {
                if let Some(value) = value {
                    if let Err(e) = self.put(&old_key.unwrap(), value, need_watch, None).await {
                        if let Err(e) = dist_lock::unlock(&locker).await {
                            log::error!("dist_lock unlock err: {}", e);
                        }
                        log::info!("Released lock for cluster key: {}", lock_key);
                        return Err(e);
                    }
                }
                if let Some((new_key, new_value, new_start_dt)) = new_value {
                    if let Err(e) = self
                        .put(&new_key, new_value, need_watch, new_start_dt)
                        .await
                    {
                        if let Err(e) = dist_lock::unlock(&locker).await {
                            log::error!("dist_lock unlock err: {}", e);
                        }
                        log::info!("Released lock for cluster key: {}", lock_key);
                        return Err(e);
                    }
                }
                Ok(())
            }
        };

        // release lock
        if let Err(e) = dist_lock::unlock(&locker).await {
            log::error!("dist_lock unlock err: {}", e);
        }
        log::info!("Released lock for cluster key: {}", lock_key);
        ret
    }

    async fn delete(
        &self,
        key: &str,
        with_prefix: bool,
        _need_watch: bool,
        _start_dt: Option<i64>,
    ) -> Result<()> {
        let (bucket, new_key) = get_bucket_by_key(&self.prefix, key).await?;
        if !with_prefix {
            let key = base64::encode(new_key);
            bucket.purge(key).await?;
            return Ok(());
        }
        let mut del_keys = Vec::new();
        let mut keys = bucket.keys().await?.boxed();
        while let Some(key) = keys.try_next().await? {
            let decoded_key = base64::decode(&key).unwrap();
            if decoded_key.starts_with(new_key) {
                del_keys.push(key);
            }
        }
        for key in del_keys {
            bucket.purge(key).await?;
        }
        Ok(())
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>> {
        let (bucket, new_key) = get_bucket_by_key(&self.prefix, prefix).await?;
        let bucket = &bucket;
        let bucket_name = bucket.status().await?.bucket;
        let bucket_prefix = "/".to_string() + bucket_name.trim_start_matches(&self.prefix);
        let keys = bucket.keys().await?.try_collect::<Vec<String>>().await?;
        let keys = keys
            .into_iter()
            .filter_map(|k| {
                let key = base64::decode(&k).unwrap();
                if key.starts_with(new_key) {
                    Some(key)
                } else {
                    None
                }
            })
            .collect::<Vec<String>>();
        let keys_len = keys.len();
        if keys_len == 0 {
            return Ok(HashMap::new());
        }
        let values = futures::stream::iter(keys)
            .map(|key| async move {
                let encoded_key = base64::encode(&key);
                let value = bucket.get(&encoded_key).await?;
                Ok::<(String, Option<Bytes>), Error>((key, value))
            })
            .buffer_unordered(min(keys_len, 10))
            .try_collect::<Vec<(String, Option<Bytes>)>>()
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        let result = values
            .into_iter()
            .filter_map(|(k, v)| v.map(|v| (bucket_prefix.to_string() + &k, v)))
            .collect();
        Ok(result)
    }

    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        let (bucket, new_key) = get_bucket_by_key(&self.prefix, prefix).await?;
        let bucket = &bucket;
        let bucket_name = bucket.status().await?.bucket;
        let bucket_prefix = "/".to_string() + bucket_name.trim_start_matches(&self.prefix);
        let keys = bucket.keys().await?.try_collect::<Vec<String>>().await?;
        let mut keys = keys
            .into_iter()
            .filter_map(|k| {
                let key = base64::decode(&k).unwrap();
                if key.starts_with(new_key) {
                    Some(bucket_prefix.to_string() + &key)
                } else {
                    None
                }
            })
            .collect::<Vec<String>>();
        keys.sort();
        Ok(keys)
    }

    async fn list_values(&self, prefix: &str) -> Result<Vec<Bytes>> {
        let (bucket, new_key) = get_bucket_by_key(&self.prefix, prefix).await?;
        let bucket = &bucket;
        let keys = bucket.keys().await?.try_collect::<Vec<String>>().await?;
        let mut keys = keys
            .into_iter()
            .filter_map(|k| {
                let key = base64::decode(&k).unwrap();
                if key.starts_with(new_key) {
                    Some(key)
                } else {
                    None
                }
            })
            .collect::<Vec<String>>();
        let keys_len = keys.len();
        if keys_len == 0 {
            return Ok(vec![]);
        }
        keys.sort();
        let values = futures::stream::iter(keys)
            .map(|key| async move {
                let encoded_key = base64::encode(&key);
                let value = bucket.get(&encoded_key).await?;
                Ok::<Option<Bytes>, Error>(value)
            })
            .buffer_unordered(min(keys_len, 10))
            .try_collect::<Vec<Option<Bytes>>>()
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        let result = values.into_iter().flatten().collect();
        Ok(result)
    }

    async fn count(&self, prefix: &str) -> Result<i64> {
        let keys = self.list_keys(prefix).await?;
        Ok(keys.len() as i64)
    }

    async fn watch(&self, prefix: &str) -> Result<Arc<mpsc::Receiver<Event>>> {
        let (tx, rx) = mpsc::channel(1024);
        let prefix = prefix.to_string();
        let self_prefix = self.prefix.to_string();
        let _task: JoinHandle<Result<()>> = tokio::task::spawn(async move {
            loop {
                if cluster::is_offline() {
                    break;
                }
                let (bucket, new_key) = get_bucket_by_key(&self_prefix, &prefix).await?;
                let bucket_name = bucket.status().await?.bucket;
                let bucket_prefix = "/".to_string() + bucket_name.trim_start_matches(&self_prefix);
                let mut entries = bucket.watch_all().await?;
                loop {
                    match entries.next().await {
                        None => {
                            log::error!("watching prefix: {}, get message error", new_key);
                            break;
                        }
                        Some(entry) => {
                            let entry = match entry {
                                Ok(entry) => entry,
                                Err(e) => {
                                    log::error!(
                                        "watching prefix: {}, get message error: {}",
                                        new_key,
                                        e
                                    );
                                    break;
                                }
                            };
                            let item_key = base64::decode(&entry.key).unwrap();
                            if !item_key.starts_with(new_key) {
                                continue;
                            }
                            match entry.operation {
                                jetstream::kv::Operation::Put => tx
                                    .send(Event::Put(EventData {
                                        key: bucket_prefix.to_string() + &item_key,
                                        value: Some(entry.value),
                                    }))
                                    .await
                                    .unwrap(),
                                jetstream::kv::Operation::Delete
                                | jetstream::kv::Operation::Purge => tx
                                    .send(Event::Delete(EventData {
                                        key: bucket_prefix.to_string() + &item_key,
                                        value: None,
                                    }))
                                    .await
                                    .unwrap(),
                            }
                        }
                    }
                }
            }
            Ok(())
        });
        Ok(Arc::new(rx))
    }

    async fn close(&self) -> Result<()> {
        Ok(())
    }
    async fn add_start_dt_column(&self) -> Result<()> {
        Ok(())
    }
}

pub async fn create_table() -> Result<()> {
    Ok(())
}

pub async fn connect() -> async_nats::Client {
    if CONFIG.common.print_key_config {
        log::info!("Nats init config: {:?}", CONFIG.nats);
    }

    let mut opts = async_nats::ConnectOptions::new()
        .connection_timeout(Duration::from_secs(CONFIG.nats.connect_timeout));
    if !CONFIG.nats.user.is_empty() {
        opts = opts.user_and_password(
            CONFIG.nats.user.to_string(),
            CONFIG.nats.password.to_string(),
        );
    }
    let addrs = CONFIG
        .nats
        .addr
        .split(',')
        .map(|a| a.parse().unwrap())
        .collect::<Vec<ServerAddr>>();
    match async_nats::connect_with_options(addrs.clone(), opts).await {
        Ok(client) => client,
        Err(e) => {
            log::error!(
                "NATS connect failed for address(es): {:?}, err: {}",
                addrs,
                e
            );
            panic!("NATS connect failed");
        }
    }
}

pub(crate) struct Locker {
    key: String,
    lock_id: String,
    state: Arc<AtomicU8>, // 0: init, 1: locking, 2: release
}

impl Locker {
    pub(crate) fn new(key: &str) -> Self {
        Self {
            key: format!("/locker{}", key),
            lock_id: ider::uuid(),
            state: Arc::new(AtomicU8::new(0)),
        }
    }

    /// lock with timeout, 0 means use default timeout, unit: second
    pub(crate) async fn lock(&mut self, timeout: u64) -> Result<()> {
        let (bucket, new_key) = get_bucket_by_key(&CONFIG.nats.prefix, &self.key).await?;
        let timeout = if timeout == 0 {
            CONFIG.nats.lock_wait_timeout
        } else {
            timeout
        };
        let expiration =
            chrono::Utc::now().timestamp_micros() + Duration::from_secs(timeout).as_micros() as i64;
        let value = Bytes::from(format!("{}:{}", self.lock_id, expiration));
        let key = base64::encode(new_key);
        // check if the locker already expired, clean it
        if let Ok(Some(ret)) = bucket.get(&key).await {
            let ret = String::from_utf8_lossy(&ret).to_string();
            let expiration = ret.split(':').last().unwrap();
            let expiration = expiration.parse::<i64>().unwrap();
            if expiration < chrono::Utc::now().timestamp_micros() {
                if let Err(err) = bucket.purge(&key).await {
                    log::error!("nats purge lock for key: {}, error: {}", self.key, err);
                    return Err(Error::Message("nats lock error".to_string()));
                };
            }
        }
        let mut last_err = None;
        while expiration > chrono::Utc::now().timestamp_micros() {
            match bucket.create(&key, value.clone()).await {
                Ok(_) => {
                    self.state.store(1, Ordering::SeqCst);
                    last_err = None;
                    break;
                }
                Err(err) => {
                    // created error, means the key locked by other thread, wait and retry
                    last_err = Some(err.to_string());
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            };
        }
        if let Some(err) = last_err {
            return Err(Error::Message(format!(
                "nats lock for key: {}, error: {}",
                self.key, err
            )));
        }
        Ok(())
    }

    pub(crate) async fn unlock(&self) -> Result<()> {
        if self.state.load(Ordering::SeqCst) != 1 {
            return Ok(());
        }
        let (bucket, new_key) = get_bucket_by_key(&CONFIG.nats.prefix, &self.key).await?;
        let key = base64::encode(new_key);
        let ret = bucket.get(&key).await?;
        let Some(ret) = ret else {
            return Ok(());
        };
        let ret = String::from_utf8_lossy(&ret).to_string();
        if !ret.starts_with(&self.lock_id) {
            return Ok(());
        }
        if let Err(err) = bucket.purge(&key).await {
            log::error!("nats unlock for key: {}, error: {}", self.key, err);
            return Err(Error::Message("nats unlock error".to_string()));
        };
        self.state.store(2, Ordering::SeqCst);
        Ok(())
    }
}
