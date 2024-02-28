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

use std::{cmp::min, sync::Arc, time::Duration};

use async_nats::{
    jetstream::{self, kv},
    Client, ServerAddr,
};
use async_trait::async_trait;
use bytes::Bytes;
use config::{utils::base64, CONFIG};
use futures::{StreamExt, TryStreamExt};
use hashbrown::HashMap;
use tokio::sync::{mpsc, OnceCell};

use crate::{db::Event, errors::*};

static NATS_CLIENT: OnceCell<Client> = OnceCell::const_new();

pub async fn get_nats_client() -> &'static Client {
    NATS_CLIENT.get_or_init(connect).await
}

async fn get_bucket_by_key<'a>(prefix: &'a str, key: &'a str) -> Result<(kv::Store, &'a str)> {
    let client = get_nats_client().await.clone();
    let jetstream = jetstream::new(client);
    let key = key.trim_start_matches('/');
    let bucket_name = key.split('/').next().unwrap();
    let mut bucket = kv::Config {
        bucket: format!("{}{}", prefix, bucket_name),
        history: 3,
        ..Default::default()
    };
    if bucket_name == "node" {
        bucket.max_age = Duration::from_secs(30);
    }
    let kv = jetstream.create_key_value(bucket).await?;
    Ok((kv, key.trim_start_matches(bucket_name)))
}

pub async fn init() {}

pub struct Nats {
    prefix: String,
}

impl Nats {
    pub fn new(prefix: &str) -> Nats {
        let prefix = prefix.trim_end_matches(|v| v == '/');
        Nats {
            prefix: prefix.to_string(),
        }
    }
}

impl Default for Nats {
    fn default() -> Self {
        Self::new(&CONFIG.nats.prefix)
    }
}

#[async_trait]
impl super::Db for Nats {
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
        let key = base64::encode_url(new_key);
        match bucket.get(&key).await? {
            None => Err(Error::from(DbError::KeyNotExists(key.to_string()))),
            Some(v) => Ok(v),
        }
    }

    async fn put(&self, key: &str, value: Bytes, _need_watch: bool) -> Result<()> {
        let (bucket, new_key) = get_bucket_by_key(&self.prefix, key).await?;
        let key = base64::encode_url(new_key);
        let _ = bucket.put(&key, value).await?;
        Ok(())
    }

    async fn delete(&self, key: &str, with_prefix: bool, _need_watch: bool) -> Result<()> {
        let (bucket, new_key) = get_bucket_by_key(&self.prefix, key).await?;
        if !with_prefix {
            let key = base64::encode_url(new_key);
            bucket.purge(key).await?;
            return Ok(());
        }
        let mut del_keys = Vec::new();
        let mut keys = bucket.keys().await?.boxed();
        while let Some(key) = keys.try_next().await? {
            let decoded_key = base64::decode_url(&key).unwrap();
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
                let key = base64::decode_url(&k).unwrap();
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
                let encoded_key = base64::encode_url(&key);
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
        let keys = keys
            .into_iter()
            .filter_map(|k| {
                let key = base64::decode_url(&k).unwrap();
                if key.starts_with(new_key) {
                    Some(bucket_prefix.to_string() + &key)
                } else {
                    None
                }
            })
            .collect::<Vec<String>>();
        Ok(keys)
    }

    async fn list_values(&self, prefix: &str) -> Result<Vec<Bytes>> {
        let (bucket, new_key) = get_bucket_by_key(&self.prefix, prefix).await?;
        let bucket = &bucket;
        let keys = bucket.keys().await?.try_collect::<Vec<String>>().await?;
        let keys = keys
            .into_iter()
            .filter_map(|k| {
                let key = base64::decode_url(&k).unwrap();
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
        let values = futures::stream::iter(keys)
            .map(|key| async move {
                let encoded_key = base64::encode_url(&key);
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

    async fn watch(&self, _prefix: &str) -> Result<Arc<mpsc::Receiver<Event>>> {
        Err(Error::NotImplemented)
    }

    async fn close(&self) -> Result<()> {
        Ok(())
    }
}

pub async fn create_table() -> Result<()> {
    Ok(())
}

pub async fn connect() -> async_nats::Client {
    if CONFIG.common.print_key_config {
        log::info!("Nats init config: {:?}", CONFIG.etcd);
    }

    let opts = async_nats::ConnectOptions::new()
        .connection_timeout(core::time::Duration::from_secs(CONFIG.nats.connect_timeout));
    let addrs = CONFIG
        .nats
        .addr
        .split(',')
        .map(|a| a.parse().unwrap())
        .collect::<Vec<ServerAddr>>();
    async_nats::connect_with_options(addrs, opts)
        .await
        .expect("Nats connect failed")
}
