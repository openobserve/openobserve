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
use async_once::AsyncOnce;
use async_trait::async_trait;
use bytes::Bytes;
use etcd_client::{
    Compare, CompareOp, DeleteOptions, EventType, GetOptions, SortOrder, SortTarget, TxnOp,
};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time;
use tonic::transport::{Certificate, ClientTlsConfig, Identity};

use super::{Event, EventData};
use crate::infra::cluster;
use crate::infra::{config::CONFIG, errors::*};

/// max operations in txn request
pub const MAX_OPS_PER_TXN: usize = 120; // etcd hard coded limit is 128

lazy_static! {
    pub static ref ETCD_CLIENT: AsyncOnce<Option<etcd_client::Client>> =
        AsyncOnce::new(async { connect_etcd().await });
}

pub struct Etcd {
    prefix: String,
}

impl Etcd {
    pub fn new(prefix: &str) -> Etcd {
        let prefix = prefix.trim_end_matches(|v| v == '/');
        Etcd {
            prefix: prefix.to_string(),
        }
    }
}

impl Default for Etcd {
    fn default() -> Self {
        Self::new(&CONFIG.etcd.prefix)
    }
}

#[async_trait]
impl super::Db for Etcd {
    async fn stats(&self) -> Result<super::Stats> {
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let stats = client.status().await?;
        let bytes_len = stats.db_size() as u64;
        let resp = client
            .get(
                "",
                Some(GetOptions::new().with_all_keys().with_count_only()),
            )
            .await?;
        let keys_count = resp.count() as usize;
        Ok(super::Stats {
            bytes_len,
            keys_count,
        })
    }

    async fn get(&self, key: &str) -> Result<Bytes> {
        let key = format!("{}{}", self.prefix, key);
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let ret = client.get(key.as_str(), None).await?;
        if ret.kvs().is_empty() {
            return Err(Error::from(DbError::KeyNotExists(key)));
        }
        Ok(Bytes::from(ret.kvs()[0].value().to_vec()))
    }

    async fn put(&self, key: &str, value: Bytes) -> Result<()> {
        let key = format!("{}{}", self.prefix, key);
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let _ = client.put(key, value, None).await?;
        Ok(())
    }

    async fn delete(&self, key: &str, with_prefix: bool) -> Result<()> {
        let key = format!("{}{}", self.prefix, key);
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let opt = with_prefix.then(|| DeleteOptions::new().with_prefix());
        let nr_deleted_keys = client.delete(key.as_str(), opt).await?.deleted();
        if nr_deleted_keys <= 0 {
            return Err(Error::from(DbError::KeyNotExists(key)));
        }
        Ok(())
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>> {
        let mut result = HashMap::default();
        let key = format!("{}{}", self.prefix, prefix);
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let mut opt = GetOptions::new()
            .with_prefix()
            .with_sort(SortTarget::Key, SortOrder::Ascend)
            .with_limit(CONFIG.etcd.load_page_size);
        let mut resp = client.get(key.clone(), Some(opt.clone())).await?;
        let mut first_call = true;
        let mut have_next = true;
        let mut last_key = String::new();
        loop {
            let kvs_num = resp.kvs().len() as i64;
            if kvs_num < CONFIG.etcd.load_page_size {
                have_next = false;
            }
            for kv in resp.kvs() {
                let item_key = kv.key_str().unwrap();
                if !item_key.starts_with(&key) {
                    have_next = false;
                    break;
                }
                if item_key.eq(last_key.as_str()) {
                    continue;
                }
                let item_key = item_key.strip_prefix(&self.prefix).unwrap();
                result.insert(item_key.to_string(), Bytes::from(kv.value().to_vec()));
            }
            tokio::task::yield_now().await; // yield to other tasks

            if !have_next {
                break;
            }
            if first_call {
                first_call = false;
                opt = opt.with_from_key();
            }
            last_key = resp.kvs().last().unwrap().key_str().unwrap().to_string();
            resp = client.get(last_key.clone(), Some(opt.clone())).await?;
        }
        Ok(result)
    }

    async fn list_use_channel(&self, prefix: &str) -> Result<Arc<mpsc::Receiver<(String, Bytes)>>> {
        let (tx, rx) = mpsc::channel(CONFIG.etcd.load_page_size as usize);
        let key = format!("{}{}", self.prefix, prefix);
        let prefix_key = self.prefix.to_string();
        let _task: JoinHandle<Result<()>> = tokio::task::spawn(async move {
            let mut client = ETCD_CLIENT.get().await.clone().unwrap();
            let mut opt = GetOptions::new()
                .with_prefix()
                .with_sort(SortTarget::Key, SortOrder::Ascend)
                .with_limit(CONFIG.etcd.load_page_size);
            let mut resp = match client.get(key.clone(), Some(opt.clone())).await {
                Ok(resp) => resp,
                Err(err) => {
                    log::error!("get prefix error: {}", err);
                    return Err(Error::from(err));
                }
            };
            let mut first_call = true;
            let mut have_next = true;
            let mut last_key = String::new();
            loop {
                let kvs_num = resp.kvs().len() as i64;
                if kvs_num < CONFIG.etcd.load_page_size {
                    have_next = false;
                }
                for kv in resp.kvs() {
                    let item_key = kv.key_str().unwrap();
                    if !item_key.starts_with(&key) {
                        have_next = false;
                        break;
                    }
                    if item_key.eq(last_key.as_str()) {
                        continue;
                    }
                    let item_key = item_key.strip_prefix(&prefix_key).unwrap();
                    tx.send((item_key.to_string(), Bytes::from(kv.value().to_vec())))
                        .await
                        .unwrap();
                }
                tokio::task::yield_now().await; // yield to other tasks

                if !have_next {
                    break;
                }
                if first_call {
                    first_call = false;
                    opt = opt.with_from_key();
                }
                last_key = resp.kvs().last().unwrap().key_str().unwrap().to_string();
                resp = client.get(last_key.clone(), Some(opt.clone())).await?;
            }
            Ok(())
        });
        Ok(Arc::new(rx))
    }

    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        let mut result = Vec::new();
        let key = format!("{}{}", self.prefix, prefix);
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let mut opt = GetOptions::new()
            .with_prefix()
            .with_sort(SortTarget::Key, SortOrder::Ascend)
            .with_limit(CONFIG.etcd.load_page_size);
        let mut resp = client.get(key.clone(), Some(opt.clone())).await?;
        let mut first_call = true;
        let mut have_next = true;
        let mut last_key = String::new();
        loop {
            let kvs_num = resp.kvs().len() as i64;
            if kvs_num < CONFIG.etcd.load_page_size {
                have_next = false;
            }
            for kv in resp.kvs() {
                let item_key = kv.key_str().unwrap();
                if !item_key.starts_with(&key) {
                    have_next = false;
                    break;
                }
                if item_key.eq(last_key.as_str()) {
                    continue;
                }
                let item_key = item_key.strip_prefix(&self.prefix).unwrap();
                result.push(item_key.to_string());
            }
            tokio::task::yield_now().await; // yield to other tasks

            if !have_next {
                break;
            }
            if first_call {
                first_call = false;
                opt = opt.with_from_key();
            }
            last_key = resp.kvs().last().unwrap().key_str().unwrap().to_string();
            resp = client.get(last_key.clone(), Some(opt.clone())).await?;
        }
        Ok(result)
    }

    async fn list_values(&self, prefix: &str) -> Result<Vec<Bytes>> {
        let mut result = Vec::new();
        let key = format!("{}{}", self.prefix, prefix);
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let mut opt = GetOptions::new()
            .with_prefix()
            .with_sort(SortTarget::Key, SortOrder::Ascend)
            .with_limit(CONFIG.etcd.load_page_size);
        let mut resp = client.get(key.clone(), Some(opt.clone())).await?;
        let mut first_call = true;
        let mut have_next = true;
        let mut last_key = String::new();
        loop {
            let kvs_num = resp.kvs().len() as i64;
            if kvs_num < CONFIG.etcd.load_page_size {
                have_next = false;
            }
            for kv in resp.kvs() {
                let item_key = kv.key_str().unwrap();
                if !item_key.starts_with(&key) {
                    have_next = false;
                    break;
                }
                if item_key.eq(last_key.as_str()) {
                    continue;
                }
                result.push(Bytes::from(kv.value().to_vec()));
            }
            tokio::task::yield_now().await; // yield to other tasks

            if !have_next {
                break;
            }
            if first_call {
                first_call = false;
                opt = opt.with_from_key();
            }
            last_key = resp.kvs().last().unwrap().key_str().unwrap().to_string();
            resp = client.get(last_key.clone(), Some(opt.clone())).await?;
        }
        Ok(result)
    }

    async fn count(&self, prefix: &str) -> Result<usize> {
        let key = format!("{}{}", self.prefix, prefix);
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let opt = GetOptions::new().with_prefix().with_count_only();
        let resp = client.get(key.clone(), Some(opt)).await?;
        Ok(resp.count() as usize)
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
                let mut client = ETCD_CLIENT.get().await.clone().unwrap();
                let opt = etcd_client::WatchOptions::new().with_prefix();
                let (mut _watcher, mut stream) =
                    match client.watch(key.clone(), Some(opt.clone())).await {
                        Ok((watcher, stream)) => (watcher, stream),
                        Err(e) => {
                            log::error!("watching prefix: {}, error: {}", key, e);
                            time::sleep(time::Duration::from_secs(1)).await;
                            continue;
                        }
                    };
                loop {
                    let resp = match stream.message().await {
                        Ok(resp) => resp,
                        Err(e) => {
                            log::error!("watching prefix: {}, get message error: {}", key, e);
                            break;
                        }
                    };
                    if let Some(ev) = resp {
                        for ev in ev.events() {
                            let kv = ev.kv().unwrap();
                            let item_key = kv.key_str().unwrap();
                            let item_key = item_key.strip_prefix(&prefix_key).unwrap();
                            match ev.event_type() {
                                EventType::Put => tx
                                    .send(Event::Put(EventData {
                                        key: item_key.to_string(),
                                        value: Some(Bytes::from(kv.value().to_vec())),
                                    }))
                                    .await
                                    .unwrap(),
                                EventType::Delete => tx
                                    .send(Event::Delete(EventData {
                                        key: item_key.to_string(),
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

    async fn transaction(
        &self,
        check_key: &str,
        and_ops: Vec<Event>,
        else_ops: Vec<Event>,
    ) -> Result<()> {
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let mut txn = etcd_client::Txn::new();
        let compares = vec![Compare::value(
            check_key.to_string(),
            CompareOp::NotEqual,
            "",
        )];
        txn = txn.when(compares);
        let mut txn_and_ops = Vec::new();
        for op in and_ops {
            match op {
                Event::Put(data) => {
                    let key = format!("{}{}", self.prefix, data.key);
                    txn_and_ops.push(TxnOp::put(key, data.value.unwrap(), None));
                }
                Event::Delete(data) => {
                    let key = format!("{}{}", self.prefix, data.key);
                    txn_and_ops.push(TxnOp::delete(key, None));
                }
            }
        }
        let mut txn_else_ops = Vec::new();
        for op in else_ops {
            match op {
                Event::Put(data) => {
                    let key = format!("{}{}", self.prefix, data.key);
                    txn_else_ops.push(TxnOp::put(key, data.value.unwrap(), None));
                }
                Event::Delete(data) => {
                    let key = format!("{}{}", self.prefix, data.key);
                    txn_else_ops.push(TxnOp::delete(key, None));
                }
            }
        }
        txn = txn.and_then(txn_and_ops);
        txn = txn.or_else(txn_else_ops);
        let _ = client.txn(txn).await?;
        Ok(())
    }
}

pub async fn connect_etcd() -> Option<etcd_client::Client> {
    if CONFIG.common.local_mode {
        return None;
    }
    if CONFIG.common.print_key_config {
        log::info!("etcd init config: {:?}", CONFIG.etcd);
    }

    let mut opts = etcd_client::ConnectOptions::new()
        .with_timeout(core::time::Duration::from_secs(CONFIG.etcd.command_timeout))
        .with_connect_timeout(core::time::Duration::from_secs(CONFIG.etcd.connect_timeout));
    if !&CONFIG.etcd.user.is_empty() {
        opts = opts.with_user(&CONFIG.etcd.user, &CONFIG.etcd.password);
    }
    if CONFIG.etcd.cert_auth {
        let server_root_ca_cert = tokio::fs::read(&CONFIG.etcd.ca_file).await.unwrap();
        let server_root_ca_cert = Certificate::from_pem(server_root_ca_cert);
        let client_cert = tokio::fs::read(&CONFIG.etcd.cert_file).await.unwrap();
        let client_key = tokio::fs::read(&CONFIG.etcd.key_file).await.unwrap();
        let client_identity = Identity::from_pem(client_cert, client_key);
        let tls = ClientTlsConfig::new()
            .domain_name(&CONFIG.etcd.domain_name)
            .ca_certificate(server_root_ca_cert)
            .identity(client_identity);
        opts = opts.with_tls(tls);
    }
    let client = etcd_client::Client::connect([&CONFIG.etcd.addr], Some(opts))
        .await
        .expect("Etcd connect failed");

    // enable keep alive for auth token
    tokio::task::spawn(async move { keepalive_connection().await });

    Some(client)
}

pub async fn keepalive_connection() -> Result<()> {
    loop {
        if cluster::is_offline() {
            break;
        }
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let key = format!("{}healthz", &CONFIG.etcd.prefix);
        let key = key.as_str();
        client.put(key, "OK", None).await?;
        let mut interval = time::interval(time::Duration::from_secs(60));
        interval.tick().await; // trigger the first run
        loop {
            interval.tick().await;
            match client.get(key, None).await {
                Ok(ret) => for _item in ret.kvs() {},
                Err(e) => {
                    log::error!("keep alive connection error: {:?}", e);
                    break;
                }
            };
        }
    }

    Ok(())
}

pub async fn keepalive_lease_id<F>(id: i64, ttl: i64, stopper: F) -> Result<()>
where
    F: Fn() -> bool,
{
    let mut ttl_keep_alive = (ttl / 2) as u64;
    loop {
        if stopper() {
            break;
        }
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let (mut keeper, mut stream) = match client.lease_keep_alive(id).await {
            Ok((keeper, stream)) => (keeper, stream),
            Err(e) => {
                log::error!("lease {:?} keep alive error: {:?}", id, e);
                time::sleep(time::Duration::from_secs(1)).await;
                continue;
            }
        };
        loop {
            if stopper() {
                break;
            }
            time::sleep(time::Duration::from_secs(ttl_keep_alive)).await;
            match keeper.keep_alive().await {
                Ok(_) => {}
                Err(e) => {
                    log::error!("lease {:?} keep alive do keeper error: {:?}", id, e);
                    ttl_keep_alive = 1;
                    break;
                }
            }
            match stream.message().await {
                Ok(v) => {
                    if v.unwrap().ttl() == 0 {
                        log::error!("lease {:?} keep alive ttl is 0", id);
                        return Err(Error::from(etcd_client::Error::LeaseKeepAliveError(
                            "lease expired or revoked".to_string(),
                        )));
                    }
                    ttl_keep_alive = (ttl / 2) as u64;
                }
                Err(e) => {
                    log::error!("lease {:?} keep alive receive message: {:?}", id, e);
                    ttl_keep_alive = 1;
                    break;
                }
            };
        }
    }

    Ok(())
}

pub struct Locker {
    key: String,
    lock_id: String,
    state: Arc<AtomicU8>, // 0: init, 1: locking, 2: release
}

impl Locker {
    pub fn new(key: &str) -> Self {
        let key = format!("{}lock/{}", &CONFIG.etcd.prefix, key);
        Self {
            key,
            lock_id: "".to_string(),
            state: Arc::new(AtomicU8::new(0)),
        }
    }

    /// lock with timeout, 0 means use default timeout, unit: second
    pub async fn lock(&mut self, timeout: u64) -> Result<()> {
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        let mut last_err = None;
        let timeout = if timeout == 0 {
            CONFIG.etcd.lock_wait_timeout
        } else {
            timeout
        };
        let mut n = timeout / CONFIG.etcd.command_timeout;
        if n < 1 {
            n = 1;
        }
        for _ in 0..n {
            match client.lock(self.key.as_str(), None).await {
                Ok(resp) => {
                    self.lock_id = String::from_utf8_lossy(resp.key()).to_string();
                    self.state.store(1, Ordering::SeqCst);
                    last_err = None;
                    break;
                }
                Err(err) => {
                    last_err = Some(err.to_string());
                    if !err.to_string().contains("Timeout expired") {
                        break;
                    }
                }
            };
        }
        if let Some(err) = last_err {
            return Err(Error::Message(format!("etcd lock error: {err}")));
        }
        Ok(())
    }

    pub async fn unlock(&mut self) -> Result<()> {
        if self.state.load(Ordering::SeqCst) != 1 {
            return Ok(());
        }
        let mut client = ETCD_CLIENT.get().await.clone().unwrap();
        match client.unlock(self.lock_id.as_str()).await {
            Ok(_) => {}
            Err(err) => {
                log::error!("etcd unlock error: {}, key: {}", err, self.key);
                return Err(Error::Message("etcd unlock error".to_string()));
            }
        };
        self.state.store(2, Ordering::SeqCst);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::Db;
    use super::*;

    #[tokio::test]
    async fn test_etcd_prefix() {
        let client = Etcd::default();
        assert_eq!(client.prefix, "/zinc/observe".to_string());
    }

    #[tokio::test]
    async fn test_etcd_count() {
        if CONFIG.common.local_mode {
            return;
        }
        let client = Etcd::default();
        client
            .put("/test/count/1", bytes::Bytes::from("1"))
            .await
            .unwrap();
        client
            .put("/test/count/2", bytes::Bytes::from("2"))
            .await
            .unwrap();
        client
            .put("/test/count/3", bytes::Bytes::from("3"))
            .await
            .unwrap();
        let count = client.count("/test/count").await.unwrap();
        assert_eq!(count, 3);
    }
}
