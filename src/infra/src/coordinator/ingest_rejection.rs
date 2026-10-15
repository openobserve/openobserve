// Copyright 2026 OpenObserve Inc.
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

//! One coordinator key per org holding its live ingest rejections.

use std::future::Future;

use async_nats::jetstream::kv::{self, CreateErrorKind, Operation, UpdateErrorKind};
use async_trait::async_trait;
use bytes::Bytes;
use config::get_config;
use tokio::sync::OnceCell;

use crate::{
    db::nats,
    errors::{Error, Result},
};

pub const INGEST_REJECTION_KEY_PREFIX: &str = "/ingest_rejection/";

// NatsDb fetches stream info per call and lists the bucket on a miss, so this path keeps a store.
static STORE: OnceCell<kv::Store> = OnceCell::const_new();

/// The org's rejection key operations, so the recording gate can run on a counting fake.
#[async_trait]
pub trait RejectionKv: Send + Sync + 'static {
    /// The value and its revision; a deleted key reads as an empty value with its revision.
    async fn get(&self, org_id: &str) -> Result<Option<(Bytes, u64)>>;
    async fn put_if_revision(
        &self,
        org_id: &str,
        value: Bytes,
        revision: Option<u64>,
    ) -> Result<bool>;
    async fn delete(&self, org_id: &str) -> Result<()>;
}

/// NATS through one cached key-value store in cluster mode, the coordinator `Db` in local mode.
pub struct LiveKv;

#[async_trait]
impl RejectionKv for LiveKv {
    async fn get(&self, org_id: &str) -> Result<Option<(Bytes, u64)>> {
        if get_config().common.local_mode {
            let coordinator = super::get_coordinator().await;
            return coordinator
                .get_with_revision(&coordinator_key(org_id))
                .await;
        }
        store().await?.entry_with_revision(&nats_key(org_id)).await
    }

    async fn put_if_revision(
        &self,
        org_id: &str,
        value: Bytes,
        revision: Option<u64>,
    ) -> Result<bool> {
        if get_config().common.local_mode {
            let coordinator = super::get_coordinator().await;
            return coordinator
                .put_if_revision(&coordinator_key(org_id), value, revision)
                .await;
        }
        raw_put(store().await?, &nats_key(org_id), value, revision).await
    }

    async fn delete(&self, org_id: &str) -> Result<()> {
        if get_config().common.local_mode {
            let coordinator = super::get_coordinator().await;
            return coordinator
                .delete_if_exists(&coordinator_key(org_id), false, false)
                .await;
        }
        store().await?.delete_key(&nats_key(org_id)).await
    }
}

/// The calls the NATS path makes on its store; none of them lists keys or fetches stream info.
#[async_trait]
trait RawKv: Sync {
    async fn entry_with_revision(&self, key: &str) -> Result<Option<(Bytes, u64)>>;
    async fn create_key(&self, key: &str, value: Bytes) -> Result<bool>;
    async fn update_key(&self, key: &str, value: Bytes, revision: u64) -> Result<bool>;
    async fn delete_key(&self, key: &str) -> Result<()>;
}

#[async_trait]
impl RawKv for kv::Store {
    async fn entry_with_revision(&self, key: &str) -> Result<Option<(Bytes, u64)>> {
        let entry = self
            .entry(key)
            .await
            .map_err(|e| Error::Message(format!("[INGEST_REJECTION] get: {e}")))?;
        Ok(entry.map(|entry| match entry.operation {
            Operation::Put => (entry.value, entry.revision),
            // A tombstone keeps its revision, so the next write is one update and not a create.
            Operation::Delete | Operation::Purge => (Bytes::new(), entry.revision),
        }))
    }

    async fn create_key(&self, key: &str, value: Bytes) -> Result<bool> {
        match self.create(key, value).await {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == CreateErrorKind::AlreadyExists => Ok(false),
            Err(e) => Err(Error::Message(format!("[INGEST_REJECTION] create: {e}"))),
        }
    }

    async fn update_key(&self, key: &str, value: Bytes, revision: u64) -> Result<bool> {
        match self.update(key, value, revision).await {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == UpdateErrorKind::WrongLastRevision => Ok(false),
            Err(e) => Err(Error::Message(format!("[INGEST_REJECTION] update: {e}"))),
        }
    }

    async fn delete_key(&self, key: &str) -> Result<()> {
        self.delete(key)
            .await
            .map_err(|e| Error::Message(format!("[INGEST_REJECTION] delete: {e}")))
    }
}

pub async fn get(org_id: &str) -> Result<Option<(Bytes, u64)>> {
    LiveKv.get(org_id).await
}

pub async fn put_if_revision(org_id: &str, value: Bytes, revision: Option<u64>) -> Result<bool> {
    LiveKv.put_if_revision(org_id, value, revision).await
}

pub async fn delete(org_id: &str) -> Result<()> {
    LiveKv.delete(org_id).await
}

async fn store() -> Result<&'static kv::Store> {
    open_once(&STORE, || nats::kv_store(INGEST_REJECTION_KEY_PREFIX)).await
}

async fn open_once<S, F, Fut>(cell: &OnceCell<S>, open: F) -> Result<&S>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<S>>,
{
    cell.get_or_try_init(open).await
}

async fn raw_put<S: RawKv>(
    store: &S,
    key: &str,
    value: Bytes,
    revision: Option<u64>,
) -> Result<bool> {
    match revision {
        Some(revision) => store.update_key(key, value, revision).await,
        None => store.create_key(key, value).await,
    }
}

fn coordinator_key(org_id: &str) -> String {
    format!("{INGEST_REJECTION_KEY_PREFIX}{org_id}")
}

/// The key inside the bucket, encoded as NatsDb encodes `/ingest_rejection/{org_id}`.
fn nats_key(org_id: &str) -> String {
    nats::key_encode(&format!("/{org_id}"))
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    };

    use hashbrown::HashMap;

    use super::*;

    /// An in-memory store that counts every call the NATS path makes.
    #[derive(Default)]
    struct CountingStore {
        keys: Mutex<HashMap<String, (Bytes, u64)>>,
        entries: AtomicUsize,
        writes: AtomicUsize,
    }

    impl CountingStore {
        fn with_keys(count: usize) -> Self {
            let store = Self::default();
            {
                let mut keys = store.keys.lock().unwrap();
                for i in 0..count {
                    keys.insert(nats_key(&format!("org_{i}")), (Bytes::from("[]"), 1));
                }
            }
            store
        }
    }

    #[async_trait]
    impl RawKv for CountingStore {
        async fn entry_with_revision(&self, key: &str) -> Result<Option<(Bytes, u64)>> {
            self.entries.fetch_add(1, Ordering::SeqCst);
            Ok(self.keys.lock().unwrap().get(key).cloned())
        }

        async fn create_key(&self, key: &str, value: Bytes) -> Result<bool> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            let mut keys = self.keys.lock().unwrap();
            if keys.contains_key(key) {
                return Ok(false);
            }
            keys.insert(key.to_string(), (value, 1));
            Ok(true)
        }

        async fn update_key(&self, key: &str, value: Bytes, revision: u64) -> Result<bool> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            let mut keys = self.keys.lock().unwrap();
            match keys.get_mut(key) {
                Some(current) if current.1 == revision => {
                    *current = (value, revision + 1);
                    Ok(true)
                }
                _ => Ok(false),
            }
        }

        async fn delete_key(&self, key: &str) -> Result<()> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            self.keys.lock().unwrap().remove(key);
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_store_is_opened_once_across_a_thousand_calls() {
        let cell = OnceCell::new();
        let opened = AtomicUsize::new(0);
        let calls = (0..1_000).map(|_| {
            open_once(&cell, || async {
                opened.fetch_add(1, Ordering::SeqCst);
                tokio::task::yield_now().await;
                Ok(7_u64)
            })
        });
        let stores = futures::future::join_all(calls).await;
        assert!(stores.iter().all(|store| matches!(store, Ok(7))));
        assert_eq!(opened.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_missing_key_is_one_direct_get_at_1k_and_100k_keys() {
        for count in [1_000, 100_000] {
            let store = CountingStore::with_keys(count);
            let missing = store
                .entry_with_revision(&nats_key("absent_org"))
                .await
                .unwrap();
            assert!(missing.is_none());
            assert_eq!(store.entries.load(Ordering::SeqCst), 1, "{count} keys");
            assert_eq!(store.writes.load(Ordering::SeqCst), 0, "{count} keys");
        }
    }

    #[tokio::test]
    async fn test_put_creates_when_absent_and_updates_by_revision() {
        let store = CountingStore::default();
        let key = nats_key("org_put");
        assert!(raw_put(&store, &key, Bytes::from("a"), None).await.unwrap());
        assert!(!raw_put(&store, &key, Bytes::from("b"), None).await.unwrap());
        let (_, revision) = store.entry_with_revision(&key).await.unwrap().unwrap();
        assert!(
            raw_put(&store, &key, Bytes::from("c"), Some(revision))
                .await
                .unwrap()
        );
        assert!(
            !raw_put(&store, &key, Bytes::from("d"), Some(revision))
                .await
                .unwrap()
        );
        assert_eq!(
            store.entry_with_revision(&key).await.unwrap().unwrap().0,
            Bytes::from("c")
        );
    }

    #[test]
    fn test_keys_match_the_coordinator_layout() {
        assert_eq!(coordinator_key("acme"), "/ingest_rejection/acme");
        assert_eq!(nats_key("acme"), nats::key_encode("/acme"));
        assert!(!nats_key("acme").contains('/'));
    }

    /// Runs the raw store against a real server: `O2_TEST_NATS_URL=nats://127.0.0.1:4333`.
    #[tokio::test]
    #[ignore = "needs a nats-server with JetStream"]
    async fn test_raw_store_against_a_nats_server() {
        let url = std::env::var("O2_TEST_NATS_URL").expect("O2_TEST_NATS_URL");
        let client = async_nats::connect(url).await.unwrap();
        let jetstream = async_nats::jetstream::new(client);
        let bucket = "o2_test_ingest_rejection";
        _ = jetstream.delete_key_value(bucket).await;
        let store = jetstream
            .create_key_value(kv::Config {
                bucket: bucket.to_string(),
                history: 1,
                max_age: std::time::Duration::from_secs(3_600),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(store.stream.cached_info().config.allow_direct);
        let key = nats_key("raw_org");

        assert!(store.entry_with_revision(&key).await.unwrap().is_none());
        assert!(raw_put(&store, &key, Bytes::from("a"), None).await.unwrap());
        assert!(!raw_put(&store, &key, Bytes::from("x"), None).await.unwrap());
        let (value, revision) = store.entry_with_revision(&key).await.unwrap().unwrap();
        assert_eq!(value, Bytes::from("a"));
        assert!(
            raw_put(&store, &key, Bytes::from("b"), Some(revision))
                .await
                .unwrap()
        );
        assert!(
            !raw_put(&store, &key, Bytes::from("c"), Some(revision))
                .await
                .unwrap(),
            "stale revision refused"
        );

        store.delete_key(&key).await.unwrap();
        let (value, tombstone) = store.entry_with_revision(&key).await.unwrap().unwrap();
        assert!(value.is_empty());
        assert!(
            raw_put(&store, &key, Bytes::from("d"), Some(tombstone))
                .await
                .unwrap(),
            "a write after a delete is one update"
        );
        assert_eq!(
            store.entry_with_revision(&key).await.unwrap().unwrap().0,
            Bytes::from("d")
        );
        jetstream.delete_key_value(bucket).await.unwrap();
    }
}
