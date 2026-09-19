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

use std::{
    ops::Range,
    sync::{Arc, LazyLock as Lazy},
};

use arc_swap::ArcSwap;
use async_trait::async_trait;
use bytes::Bytes;
use config::{get_config, is_local_disk_storage, utils::hash::Sum64};
use futures::{TryStreamExt, stream::BoxStream};
use hashbrown::{HashMap, HashSet};
use object_store::{
    GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    ObjectStoreExt as ObjStoreExt, PutMultipartOptions, PutOptions, PutPayload, PutResult, Result,
    path::Path,
};
use tokio::sync::Mutex;

use crate::storage::{ObjectStoreExt, get_stream_from_file, remote::StorageConfig};

const DEFAULT_ACCOUNT: &str = "default";

static ADD_ACCOUNT_LOCK: Lazy<Arc<Mutex<()>>> = Lazy::new(|| Arc::new(Mutex::new(())));

struct NativeLocalClient {
    client: Arc<Box<dyn ObjectStore>>,
    local: Arc<super::local::Local>,
}

impl NativeLocalClient {
    fn new(local: super::local::Local) -> Self {
        let local = Arc::new(local);
        let client: Arc<Box<dyn ObjectStore>> = Arc::new(Box::new(Arc::clone(&local)));
        Self { client, local }
    }
}

// The reason accounts has the type like this is
// 1. arc swap so we can add a new store dynamically and swap the whole map with new map with store
//    added
//  also, arcswap has better read perf compared to rwlock or mutex, and this is read on a very hot
// path,  the write/swap itself should be very rare op, so arcswap is preferable
// 2. Because, we need to duplicate the list, we need to clone the existing object, but ObjectStore
//    trait does
//  not provide Clone, so instead we wrap it up in Arc, so we can clone it
pub struct StorageClientFactory {
    accounts: ArcSwap<HashMap<String, Arc<Box<dyn ObjectStore>>>>,
    stream_strategy: StreamStrategy,
    only_default: bool,
    native_local: Option<NativeLocalClient>,
}

impl Default for StorageClientFactory {
    fn default() -> Self {
        Self::new()
    }
}

/// Returns the default object store based on the configuration.
/// It creates a remote object store with multiple accounts.
pub(crate) fn default() -> Box<dyn ObjectStoreExt> {
    Box::<StorageClientFactory>::default()
}

/// StorageClientFactory is a factory for creating storage clients.
/// It is used to manage multiple storage clients for different accounts.
impl StorageClientFactory {
    pub fn new() -> Self {
        let cfg = get_config();
        Self::new_with_config(&cfg.s3, is_local_disk_storage())
    }

    pub fn new_with_config(config: &config::S3, local_mode: bool) -> Self {
        let (stream_strategy, accounts) = parse_storage_config(config);
        let mut temp: HashMap<String, Arc<Box<dyn ObjectStore>>> =
            HashMap::with_capacity(accounts.len());
        let mut only_default = accounts.len() == 1;
        let mut native_local = None;

        if local_mode {
            std::fs::create_dir_all(&get_config().common.data_stream_dir)
                .expect("create stream data dir success");
            let native = NativeLocalClient::new(super::local::Local::default());
            temp.insert(DEFAULT_ACCOUNT.to_string(), Arc::clone(&native.client));
            native_local = Some(native);
            // local storage only has one account
            only_default = true;
        } else {
            for (name, config) in accounts {
                temp.insert(name, Arc::new(Box::new(super::remote::Remote::new(config))));
            }
        }

        Self {
            accounts: ArcSwap::from_pointee(temp),
            only_default,
            stream_strategy,
            native_local,
        }
    }

    // here we use external locking to make sure the account is added correctly
    // ObjectStore trait does not implement clone itself, so we wrap it up in
    // arc so we can clone it.
    // arcswap allows atomic swapping, but does not let us atomically mutate the values
    // which means we need to swap with a complete new value. Without a lock,
    // there is a chance that two concurrent add requests from two different orgs
    // would clone the existing, add their own store, and whichever one swaps the last wins,
    // effectively erasing one org's storage.
    // Additionally adding a org level account is a very rare event, so we can take the cost
    // of a full on lock, and basically guarantee that even with concurrent requests,
    // both of the new stores will get added properly.
    pub async fn add_account(&self, key: String, acc: Box<dyn ObjectStore>) {
        let lock = ADD_ACCOUNT_LOCK.clone();
        let lock = lock.lock().await;
        let r = self.accounts.load_full();
        let mut temp = HashMap::with_capacity(r.len() + 1);
        for (k, v) in r.iter() {
            temp.insert(k.clone(), v.clone());
        }
        temp.insert(key, Arc::new(acc));
        self.accounts.swap(Arc::new(temp));
        drop(lock);
    }

    /// Get the account name for the path by the given strategy.
    pub fn get_name_by_path(&self, org_id: &str, path: &Path) -> Option<String> {
        // org level storage will override any other strategy, so check that first
        // if found, return that account name else continue with flow for other strategies
        if crate::table::org_storage_providers::get_for_org_from_cache(org_id).is_some() {
            return Some(super::get_org_storage_key(org_id));
        }

        if self.only_default {
            return None;
        }
        match &self.stream_strategy {
            StreamStrategy::Default => None,
            StreamStrategy::FileHash(account_names) => {
                let file = path.to_string();
                let mut h = config::utils::hash::gxhash::new();
                let v = h.sum64(&file);
                let account_name = account_names[v as usize % account_names.len()].clone();
                Some(account_name)
            }
            StreamStrategy::StreamHash(account_names) => get_stream_from_file(path).map(|stream| {
                let mut h = config::utils::hash::gxhash::new();
                let v = h.sum64(&stream);
                account_names[v as usize % account_names.len()].clone()
            }),
            StreamStrategy::Stream(stream_map) => get_stream_from_file(path)
                .and_then(|stream| stream_map.get(&stream).map(|s| s.to_string())),
        }
    }

    /// Get the client for the given name.
    /// If the name is not found, return the default client.
    pub fn get_client_by_name(&self, name: &str) -> Arc<Box<dyn ObjectStore>> {
        if !name.is_empty()
            && let Some(client) = self.accounts.load().get(name).cloned()
        {
            return client;
        }
        self.accounts
            .load()
            .get(DEFAULT_ACCOUNT)
            .cloned()
            .expect("default object store account not found")
    }
}

pub fn parse_storage_config(
    config: &config::S3,
) -> (StreamStrategy, HashMap<String, StorageConfig>) {
    // check account based on ZO_S3_ACCOUNTS
    let account_names = config
        .accounts
        .split(",")
        .map(|s| s.trim().to_string())
        .collect::<Vec<String>>();
    let account_num = account_names.len();
    let mut accounts = HashMap::with_capacity(account_num);

    // check multi accounts config
    let providers = config.provider.split(",").collect::<Vec<&str>>();
    let server_urls = config.server_url.split(",").collect::<Vec<&str>>();
    let region_names = config.region_name.split(",").collect::<Vec<&str>>();
    let access_keys = config.access_key.split(",").collect::<Vec<&str>>();
    let secret_keys = config.secret_key.split(",").collect::<Vec<&str>>();
    let bucket_names = config.bucket_name.split(",").collect::<Vec<&str>>();
    let bucket_prefixes = config.bucket_prefix.split(",").collect::<Vec<&str>>();
    if (!config.provider.is_empty() && providers.len() != account_num)
        || (!config.server_url.is_empty() && server_urls.len() != account_num)
        || (!config.region_name.is_empty() && region_names.len() != account_num)
        || (!config.access_key.is_empty() && access_keys.len() != account_num)
        || (!config.secret_key.is_empty() && secret_keys.len() != account_num)
        || (!config.bucket_name.is_empty() && bucket_names.len() != account_num)
        || (!config.bucket_prefix.is_empty() && bucket_prefixes.len() != account_num)
    {
        panic!("Invalid multi object store accounts config");
    }

    // add accounts
    for (i, name) in account_names.iter().enumerate() {
        if i == 0 {
            // the first we will use as default account
            accounts.insert(
                DEFAULT_ACCOUNT.to_string(),
                StorageConfig {
                    name: DEFAULT_ACCOUNT.to_string(),
                    provider: get_value_by_idx(&providers, i),
                    server_url: get_value_by_idx(&server_urls, i),
                    region_name: get_value_by_idx(&region_names, i),
                    access_key: get_value_by_idx(&access_keys, i),
                    secret_key: get_value_by_idx(&secret_keys, i),
                    bucket_name: get_value_by_idx(&bucket_names, i),
                    bucket_prefix: get_value_by_idx(&bucket_prefixes, i),
                },
            );
        }
        accounts.insert(
            name.to_string(),
            StorageConfig {
                name: name.to_string(),
                provider: get_value_by_idx(&providers, i),
                server_url: get_value_by_idx(&server_urls, i),
                region_name: get_value_by_idx(&region_names, i),
                access_key: get_value_by_idx(&access_keys, i),
                secret_key: get_value_by_idx(&secret_keys, i),
                bucket_name: get_value_by_idx(&bucket_names, i),
                bucket_prefix: get_value_by_idx(&bucket_prefixes, i),
            },
        );
    }

    // parse stream strategy
    let stream_strategy = StreamStrategy::new(&config.stream_strategy, account_names);

    (stream_strategy, accounts)
}

impl std::fmt::Debug for StorageClientFactory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("storage for StorageClientFactory")
    }
}

impl std::fmt::Display for StorageClientFactory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("storage for StorageClientFactory")
    }
}

fn get_value_by_idx(values: &[&str], index: usize) -> String {
    if values.is_empty() || index >= values.len() {
        "".to_string()
    } else {
        values[index].to_string()
    }
}

#[derive(Debug)]
pub enum StreamStrategy {
    Default,
    FileHash(Vec<String>),           // account name list
    StreamHash(Vec<String>),         // account name list
    Stream(HashMap<String, String>), // stream name -> account name
}

impl StreamStrategy {
    pub fn new(strategy: &str, account_names: Vec<String>) -> Self {
        match strategy.to_lowercase().as_str() {
            "" => Self::Default,
            "file_hash" => Self::FileHash(account_names),
            "stream_hash" => Self::StreamHash(account_names),
            _ => {
                let account_set = account_names.iter().collect::<HashSet<&String>>();
                let mut stream_map = HashMap::new();
                for part in strategy.split(",") {
                    let pos = part
                        .rfind(":")
                        .expect("invalid value of ZO_S3_STREAM_STRATEGY");
                    if pos == 0 || part.len() <= pos + 1 {
                        panic!("invalid value of ZO_S3_STREAM_STRATEGY");
                    }
                    let stream_name = part[0..pos].to_string();
                    let account_name = part[pos + 1..].to_string();
                    if !account_set.contains(&account_name) {
                        panic!("invalid value of ZO_S3_STREAM_STRATEGY");
                    }
                    stream_map.insert(stream_name, account_name);
                }
                Self::Stream(stream_map)
            }
        }
    }
}

#[async_trait]
impl ObjectStoreExt for StorageClientFactory {
    fn get_account(&self, org_id: &str, file: &str) -> Option<String> {
        self.get_name_by_path(org_id, &file.into())
    }

    async fn add_account(&self, key: String, acc: Box<dyn ObjectStore>) {
        self.add_account(key, acc).await;
    }

    async fn put(&self, account: &str, location: &Path, payload: PutPayload) -> Result<PutResult> {
        self.get_client_by_name(account)
            .put(location, payload)
            .await
    }

    async fn put_opts(
        &self,
        account: &str,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        self.get_client_by_name(account)
            .put_opts(location, payload, opts)
            .await
    }

    async fn put_multipart(
        &self,
        account: &str,
        location: &Path,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.get_client_by_name(account)
            .put_multipart(location)
            .await
    }

    async fn put_multipart_opts(
        &self,
        account: &str,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.get_client_by_name(account)
            .put_multipart_opts(location, opts)
            .await
    }

    async fn try_open_local_file(
        &self,
        account: &str,
        location: &Path,
    ) -> Result<Option<super::LocalFile>> {
        let Some(native) = &self.native_local else {
            return Ok(None);
        };
        let name = if account.is_empty() {
            DEFAULT_ACCOUNT
        } else {
            account
        };
        let client = self.accounts.load().get(name).cloned();
        let Some(client) = client else {
            return Ok(None);
        };
        if !Arc::ptr_eq(&client, &native.client) {
            return Ok(None);
        }
        native.local.try_open_file(location).await
    }

    async fn get(&self, account: &str, location: &Path) -> Result<GetResult> {
        self.get_client_by_name(account).get(location).await
    }

    async fn get_opts(
        &self,
        account: &str,
        location: &Path,
        options: GetOptions,
    ) -> Result<GetResult> {
        self.get_client_by_name(account)
            .get_opts(location, options)
            .await
    }

    async fn get_range(&self, account: &str, location: &Path, range: Range<u64>) -> Result<Bytes> {
        self.get_client_by_name(account)
            .get_range(location, range)
            .await
    }

    async fn get_ranges(
        &self,
        account: &str,
        location: &Path,
        ranges: &[Range<u64>],
    ) -> Result<Vec<Bytes>> {
        self.get_client_by_name(account)
            .get_ranges(location, ranges)
            .await
    }

    async fn head(&self, account: &str, location: &Path) -> Result<ObjectMeta> {
        self.get_client_by_name(account).head(location).await
    }

    async fn delete(&self, account: &str, location: &Path) -> Result<()> {
        self.get_client_by_name(account).delete(location).await
    }

    async fn delete_stream(
        &self,
        account: &str,
        locations: BoxStream<'static, Result<Path>>,
    ) -> Result<Vec<Path>> {
        self.get_client_by_name(account)
            .delete_stream(locations)
            .try_collect::<Vec<Path>>()
            .await
    }

    fn list(&self, account: &str, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        self.get_client_by_name(account).list(prefix)
    }

    fn list_with_offset(
        &self,
        account: &str,
        prefix: Option<&Path>,
        offset: &Path,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        self.get_client_by_name(account)
            .list_with_offset(prefix, offset)
    }

    async fn list_with_delimiter(
        &self,
        account: &str,
        prefix: Option<&Path>,
    ) -> Result<ListResult> {
        self.get_client_by_name(account)
            .list_with_delimiter(prefix)
            .await
    }

    async fn copy(&self, account: &str, from: &Path, to: &Path) -> Result<()> {
        self.get_client_by_name(account).copy(from, to).await
    }

    async fn rename(&self, account: &str, from: &Path, to: &Path) -> Result<()> {
        self.get_client_by_name(account).rename(from, to).await
    }

    async fn copy_if_not_exists(&self, account: &str, from: &Path, to: &Path) -> Result<()> {
        self.get_client_by_name(account)
            .copy_if_not_exists(from, to)
            .await
    }

    async fn rename_if_not_exists(&self, account: &str, from: &Path, to: &Path) -> Result<()> {
        self.get_client_by_name(account)
            .rename_if_not_exists(from, to)
            .await
    }
}

#[cfg(test)]
mod tests {
    use config::S3;

    use super::*;

    #[derive(Debug)]
    struct ProbeStore {
        inner: Arc<dyn ObjectStore>,
        gets: Arc<std::sync::atomic::AtomicUsize>,
        heads: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl std::fmt::Display for ProbeStore {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            // A backend name is deliberately not proof of native capability.
            f.write_str("storage for local disk")
        }
    }

    #[async_trait]
    impl ObjectStore for ProbeStore {
        async fn get_opts(&self, path: &Path, options: GetOptions) -> Result<GetResult> {
            let counter = if options.head {
                &self.heads
            } else {
                &self.gets
            };
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.inner.get_opts(path, options).await
        }
        async fn put_opts(
            &self,
            path: &Path,
            payload: PutPayload,
            options: PutOptions,
        ) -> Result<PutResult> {
            self.inner.put_opts(path, payload, options).await
        }
        async fn put_multipart_opts(
            &self,
            path: &Path,
            options: PutMultipartOptions,
        ) -> Result<Box<dyn MultipartUpload>> {
            self.inner.put_multipart_opts(path, options).await
        }
        fn delete_stream(
            &self,
            paths: BoxStream<'static, Result<Path>>,
        ) -> BoxStream<'static, Result<Path>> {
            self.inner.delete_stream(paths)
        }
        fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
            self.inner.list(prefix)
        }
        async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
            self.inner.list_with_delimiter(prefix).await
        }
        async fn copy_opts(
            &self,
            from: &Path,
            to: &Path,
            options: object_store::CopyOptions,
        ) -> Result<()> {
            self.inner.copy_opts(from, to, options).await
        }
    }

    fn probe(
        inner: Arc<dyn ObjectStore>,
    ) -> (
        ProbeStore,
        Arc<std::sync::atomic::AtomicUsize>,
        Arc<std::sync::atomic::AtomicUsize>,
    ) {
        let gets = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let heads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        (
            ProbeStore {
                inner,
                gets: Arc::clone(&gets),
                heads: Arc::clone(&heads),
            },
            gets,
            heads,
        )
    }

    #[tokio::test(flavor = "current_thread")]
    async fn test_try_open_local_file_has_no_remote_or_custom_probes() {
        use std::sync::atomic::Ordering;
        let directory = tempfile::tempdir().unwrap();
        let backends: Vec<Arc<dyn ObjectStore>> = vec![
            Arc::new(object_store::memory::InMemory::new()),
            Arc::new(
                object_store::local::LocalFileSystem::new_with_prefix(directory.path()).unwrap(),
            ),
        ];
        for inner in backends {
            let (store, gets, heads) = probe(inner);
            let client: Arc<Box<dyn ObjectStore>> = Arc::new(Box::new(store));
            let factory = StorageClientFactory {
                accounts: ArcSwap::from_pointee(HashMap::from([(
                    DEFAULT_ACCOUNT.to_owned(),
                    client,
                )])),
                stream_strategy: StreamStrategy::Default,
                only_default: true,
                native_local: None,
            };
            for name in ["", DEFAULT_ACCOUNT, "unknown"] {
                assert!(
                    factory
                        .try_open_local_file(name, &Path::from("missing"))
                        .await
                        .unwrap()
                        .is_none()
                );
            }
            assert_eq!(gets.load(Ordering::SeqCst), 0);
            assert_eq!(heads.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn test_try_open_local_file_requires_current_native_identity() {
        use std::sync::atomic::Ordering;
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("object"), b"native").unwrap();
        let native = NativeLocalClient::new(super::super::local::Local::new(
            directory.path().to_str().unwrap(),
            false,
        ));
        let factory = StorageClientFactory {
            accounts: ArcSwap::from_pointee(HashMap::from([(
                DEFAULT_ACCOUNT.to_owned(),
                Arc::clone(&native.client),
            )])),
            stream_strategy: StreamStrategy::Default,
            only_default: true,
            native_local: Some(native),
        };
        let key = Path::from("object");
        let opened = factory
            .try_open_local_file("", &key)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(opened.meta.size, 6);
        assert_eq!(opened.file.metadata().unwrap().len(), 6);
        assert!(
            factory
                .try_open_local_file(DEFAULT_ACCOUNT, &key)
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            factory
                .try_open_local_file("unknown", &key)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            factory
                .get("unknown", &key)
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap(),
            Bytes::from_static(b"native")
        );

        let custom_local: Arc<dyn ObjectStore> = Arc::new(
            object_store::local::LocalFileSystem::new_with_prefix(directory.path()).unwrap(),
        );
        let (custom, gets, heads) = probe(custom_local);
        factory.add_account("custom".into(), Box::new(custom)).await;
        assert!(
            factory
                .try_open_local_file("custom", &key)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(gets.load(Ordering::SeqCst), 0);
        assert_eq!(heads.load(Ordering::SeqCst), 0);

        let replacement = object_store::memory::InMemory::new();
        replacement
            .put_opts(
                &key,
                Bytes::from_static(b"replacement").into(),
                PutOptions::default(),
            )
            .await
            .unwrap();
        let (replacement, gets, heads) = probe(Arc::new(replacement));
        factory
            .add_account(DEFAULT_ACCOUNT.to_owned(), Box::new(replacement))
            .await;
        for name in ["", DEFAULT_ACCOUNT, "unknown"] {
            assert!(
                factory
                    .try_open_local_file(name, &key)
                    .await
                    .unwrap()
                    .is_none()
            );
        }
        assert_eq!(gets.load(Ordering::SeqCst), 0);
        assert_eq!(heads.load(Ordering::SeqCst), 0);
        assert_eq!(
            factory
                .get("unknown", &key)
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap(),
            Bytes::from_static(b"replacement")
        );
        assert_eq!(gets.load(Ordering::SeqCst), 1);
        assert_eq!(heads.load(Ordering::SeqCst), 0);
    }

    fn base_s3_config() -> S3 {
        S3 {
            accounts: "default".to_string(),
            provider: "aws".to_string(),
            server_url: "https://s3.amazonaws.com".to_string(),
            region_name: "us-east-1".to_string(),
            access_key: "AKIA...".to_string(),
            secret_key: "SECRET".to_string(),
            bucket_name: "mybucket".to_string(),
            bucket_prefix: "".to_string(),
            stream_strategy: "".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn test_storage_client_factory_local_mode_default() {
        let config = base_s3_config();
        let factory = StorageClientFactory::new_with_config(&config, true);
        assert!(factory.only_default);
        assert_eq!(factory.accounts.load().len(), 1);
        assert!(factory.accounts.load().contains_key("default"));
        assert!(matches!(factory.stream_strategy, StreamStrategy::Default));
    }

    #[test]
    fn test_storage_client_factory_multiple_account_local_mode_strategy() {
        let mut config = base_s3_config();
        config.accounts = "acc1,acc2".to_string();
        config.provider = "aws,aws".to_string();
        config.server_url = "url1,url2".to_string();
        config.region_name = "r1,r2".to_string();
        config.access_key = "k1,k2".to_string();
        config.secret_key = "s1,s2".to_string();
        config.bucket_name = "b1,b2".to_string();
        config.bucket_prefix = "p1,p2".to_string();

        let factory = StorageClientFactory::new_with_config(&config, true);
        assert!(factory.only_default);
        assert_eq!(factory.accounts.load().len(), 1); // includes "default" 
    }

    #[test]
    fn test_storage_client_factory_single_account_default() {
        let config = base_s3_config();
        let factory = StorageClientFactory::new_with_config(&config, false);
        assert!(factory.only_default);
        assert_eq!(factory.accounts.load().len(), 1);
        assert!(factory.accounts.load().contains_key("default"));
        assert!(matches!(factory.stream_strategy, StreamStrategy::Default));
    }

    #[test]
    fn test_storage_client_factory_multiple_accounts_file_hash_strategy() {
        let mut config = base_s3_config();
        config.accounts = "acc1,acc2".to_string();
        config.provider = "aws,aws".to_string();
        config.server_url = "url1,url2".to_string();
        config.region_name = "r1,r2".to_string();
        config.access_key = "k1,k2".to_string();
        config.secret_key = "s1,s2".to_string();
        config.bucket_name = "b1,b2".to_string();
        config.bucket_prefix = "p1,p2".to_string();
        config.stream_strategy = "file_hash".to_string();

        let factory = StorageClientFactory::new_with_config(&config, false);
        assert!(!factory.only_default);
        assert_eq!(factory.accounts.load().len(), 3); // includes "default"
        assert!(matches!(
            factory.stream_strategy,
            StreamStrategy::FileHash(_)
        ));
    }

    #[test]
    fn test_storage_client_factory_multiple_accounts_stream_hash_strategy() {
        let mut config = base_s3_config();
        config.accounts = "acc1,acc2".to_string();
        config.provider = "aws,aws".to_string();
        config.server_url = "url1,url2".to_string();
        config.region_name = "r1,r2".to_string();
        config.access_key = "k1,k2".to_string();
        config.secret_key = "s1,s2".to_string();
        config.bucket_name = "b1,b2".to_string();
        config.bucket_prefix = "p1,p2".to_string();
        config.stream_strategy = "stream_hash".to_string();

        let factory = StorageClientFactory::new_with_config(&config, false);
        assert!(!factory.only_default);
        assert_eq!(factory.accounts.load().len(), 3); // includes "default"
        assert!(matches!(
            factory.stream_strategy,
            StreamStrategy::StreamHash(_)
        ));
    }

    #[test]
    fn test_storage_client_factory_multiple_accounts_stream_strategy() {
        let mut config = base_s3_config();
        config.accounts = "acc1,acc2".to_string();
        config.provider = "aws,aws".to_string();
        config.server_url = "url1,url2".to_string();
        config.region_name = "r1,r2".to_string();
        config.access_key = "k1,k2".to_string();
        config.secret_key = "s1,s2".to_string();
        config.bucket_name = "b1,b2".to_string();
        config.bucket_prefix = "p1,p2".to_string();
        config.stream_strategy = "stream1:acc1,stream2:acc2".to_string();

        let factory = StorageClientFactory::new_with_config(&config, false);
        assert!(!factory.only_default);
        assert_eq!(factory.accounts.load().len(), 3); // includes "default"
        match &factory.stream_strategy {
            StreamStrategy::Stream(map) => {
                assert_eq!(map.get("stream1").unwrap(), "acc1");
                assert_eq!(map.get("stream2").unwrap(), "acc2");
            }
            _ => panic!("Expected StreamStrategy::Stream"),
        }
    }

    #[test]
    #[should_panic(expected = "Invalid multi object store accounts config")]
    fn test_storage_client_factory_invalid_multi_account_config() {
        let mut config = base_s3_config();
        config.accounts = "acc1,acc2".to_string();
        config.provider = "aws".to_string(); // Only one provider, should panic
        StorageClientFactory::new_with_config(&config, false);
    }

    #[test]
    #[should_panic(expected = "invalid value of ZO_S3_STREAM_STRATEGY")]
    fn test_storage_client_factory_invalid_stream_strategy() {
        let mut config = base_s3_config();
        config.accounts = "acc1,acc2".to_string();
        config.provider = "aws,aws".to_string();
        config.server_url = "url1,url2".to_string();
        config.region_name = "r1,r2".to_string();
        config.access_key = "k1,k2".to_string();
        config.secret_key = "s1,s2".to_string();
        config.bucket_name = "b1,b2".to_string();
        config.bucket_prefix = "p1,p2".to_string();
        config.stream_strategy = "stream1:acc3".to_string(); // acc3 does not exist
        StorageClientFactory::new_with_config(&config, false);
    }

    #[test]
    fn test_get_value_by_idx_normal() {
        let vals = ["a", "b", "c"];
        assert_eq!(get_value_by_idx(&vals, 0), "a");
        assert_eq!(get_value_by_idx(&vals, 1), "b");
        assert_eq!(get_value_by_idx(&vals, 2), "c");
    }

    #[test]
    fn test_get_value_by_idx_empty_slice() {
        assert_eq!(get_value_by_idx(&[], 0), "");
    }

    #[test]
    fn test_get_value_by_idx_index_out_of_bounds() {
        let vals = ["x"];
        assert_eq!(get_value_by_idx(&vals, 5), "");
    }

    #[test]
    fn test_storage_client_factory_debug_and_display() {
        let config = base_s3_config();
        let factory = StorageClientFactory::new_with_config(&config, true);
        assert_eq!(format!("{factory}"), "storage for StorageClientFactory");
        assert_eq!(format!("{factory:?}"), "storage for StorageClientFactory");
    }
}
