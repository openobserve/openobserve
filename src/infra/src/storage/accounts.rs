// Copyright 2025 OpenObserve Inc.
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

use std::ops::Range;

use async_trait::async_trait;
use bytes::Bytes;
use config::{get_config, is_local_disk_storage, utils::hash::Sum64};
use futures::stream::BoxStream;
use hashbrown::{HashMap, HashSet};
use object_store::{
    GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore, PutMultipartOpts,
    PutOptions, PutPayload, PutResult, Result, path::Path,
};

use crate::storage::{ObjectStoreExt, get_stream_from_file, remote::StorageConfig};

const DEFAULT_ACCOUNT: &str = "default";

pub struct StorageClientFactory {
    accounts: HashMap<String, Box<dyn ObjectStore>>,
    stream_strategy: StreamStrategy,
    only_default: bool,
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
        let config = get_config();
        Self::new_with_config(&config.s3, is_local_disk_storage())
    }

    pub fn new_with_config(config: &config::S3, local_mode: bool) -> Self {
        let (stream_strategy, accounts) = parse_storage_config(config);
        let mut storage = Self {
            accounts: HashMap::with_capacity(accounts.len()),
            only_default: accounts.len() == 1,
            stream_strategy,
        };

        if local_mode {
            std::fs::create_dir_all(&get_config().common.data_stream_dir)
                .expect("create stream data dir success");
            storage.accounts.insert(
                DEFAULT_ACCOUNT.to_string(),
                Box::<super::local::Local>::default(),
            );
            // local storage only has one account
            storage.only_default = true;
        } else {
            for (name, config) in accounts {
                storage
                    .accounts
                    .insert(name, Box::new(super::remote::Remote::new(config)));
            }
        }
        storage
    }

    /// Get the account name for the path by the given strategy.
    pub fn get_name_by_path(&self, path: &Path) -> Option<String> {
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
    pub fn get_client_by_name(&self, name: &str) -> &dyn ObjectStore {
        if !name.is_empty() {
            if let Some(client) = self.accounts.get(name) {
                return client;
            }
        }
        self.accounts
            .get(DEFAULT_ACCOUNT)
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
    fn get_account(&self, file: &str) -> Option<String> {
        self.get_name_by_path(&file.into())
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
        opts: PutMultipartOpts,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.get_client_by_name(account)
            .put_multipart_opts(location, opts)
            .await
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

    async fn get_range(
        &self,
        account: &str,
        location: &Path,
        range: Range<usize>,
    ) -> Result<Bytes> {
        self.get_client_by_name(account)
            .get_range(location, range)
            .await
    }

    async fn get_ranges(
        &self,
        account: &str,
        location: &Path,
        ranges: &[Range<usize>],
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

    fn delete_stream<'a>(
        &'a self,
        account: &str,
        locations: BoxStream<'a, Result<Path>>,
    ) -> BoxStream<'a, Result<Path>> {
        self.get_client_by_name(account).delete_stream(locations)
    }

    fn list(&self, account: &str, prefix: Option<&Path>) -> BoxStream<'_, Result<ObjectMeta>> {
        self.get_client_by_name(account).list(prefix)
    }

    fn list_with_offset(
        &self,
        account: &str,
        prefix: Option<&Path>,
        offset: &Path,
    ) -> BoxStream<'_, Result<ObjectMeta>> {
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
        assert_eq!(factory.accounts.len(), 1);
        assert!(factory.accounts.contains_key("default"));
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
        assert_eq!(factory.accounts.len(), 1); // includes "default" 
    }

    #[test]
    fn test_storage_client_factory_single_account_default() {
        let config = base_s3_config();
        let factory = StorageClientFactory::new_with_config(&config, false);
        assert!(factory.only_default);
        assert_eq!(factory.accounts.len(), 1);
        assert!(factory.accounts.contains_key("default"));
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
        assert_eq!(factory.accounts.len(), 3); // includes "default"
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
        assert_eq!(factory.accounts.len(), 3); // includes "default"
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
        assert_eq!(factory.accounts.len(), 3); // includes "default"
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
}
