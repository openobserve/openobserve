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
use config::{get_config, utils::hash::Sum64};
use futures::stream::BoxStream;
use hashbrown::HashMap;
use object_store::{
    Error, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOpts, PutOptions, PutPayload, PutResult, Result, path::Path,
};

use super::{get_stream_from_file, remote::StorageConfig};

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

/// StorageClientFactory is a factory for creating storage clients.
/// It is used to manage multiple storage clients for different accounts.
impl StorageClientFactory {
    pub fn new() -> Self {
        let (stream_strategy, accounts) = parse_storage_config();
        let mut storage = Self {
            accounts: HashMap::with_capacity(accounts.len()),
            only_default: accounts.len() == 1,
            stream_strategy,
        };
        for (name, config) in accounts {
            storage
                .accounts
                .insert(name, Box::new(super::remote::Remote::new(config)));
        }
        storage
    }

    /// Get the account name for the given stream with the given strategy.
    pub fn get_name_by_stream(&self, stream: &str) -> Option<String> {
        if self.only_default {
            return None;
        }
        match &self.stream_strategy {
            StreamStrategy::Default => None,
            StreamStrategy::Hash(account_names) => {
                let mut h = config::utils::hash::gxhash::new();
                let v = h.sum64(stream);
                let account_name = account_names[v as usize % account_names.len()].clone();
                Some(account_name)
            }
            StreamStrategy::Stream(stream_map) => stream_map.get(stream).map(|s| s.to_string()),
        }
    }

    /// Get the client name for the given path.
    pub fn get_client_name(&self, path: Option<&Path>) -> Option<String> {
        if !self.only_default && path.is_some() {
            let stream = get_stream_from_file(path.unwrap());
            if let Some(stream) = stream {
                return self.get_name_by_stream(&stream);
            }
        }
        None
    }

    /// Get the client for the given name.
    /// If the name is not found, return the default client.
    pub fn get_client_by_name(&self, name: &str) -> &dyn ObjectStore {
        if let Some(client) = self.accounts.get(name) {
            return client;
        }
        self.accounts
            .get(DEFAULT_ACCOUNT)
            .expect("default object store account not found")
    }

    /// Get the client for the given path.
    /// If the path is not a valid stream, return the default client.
    pub fn get_client(&self, path: Option<&Path>) -> &dyn ObjectStore {
        if let Some(name) = self.get_client_name(path) {
            return self.get_client_by_name(&name);
        }
        self.get_client_by_name(DEFAULT_ACCOUNT)
    }
}

pub fn parse_storage_config() -> (StreamStrategy, HashMap<String, StorageConfig>) {
    let cfg = get_config();
    // check account based on ZO_S3_ACCOUNTS
    let account_names = cfg
        .s3
        .accounts
        .split(",")
        .map(|s| s.trim().to_string())
        .collect::<Vec<String>>();
    let account_num = account_names.len();
    let mut accounts = HashMap::with_capacity(account_num);

    // add default account
    accounts.insert(
        DEFAULT_ACCOUNT.to_string(),
        StorageConfig {
            name: DEFAULT_ACCOUNT.to_string(),
            provider: cfg.s3.provider.to_string(),
            server_url: cfg.s3.server_url.to_string(),
            region_name: cfg.s3.region_name.to_string(),
            access_key: cfg.s3.access_key.to_string(),
            secret_key: cfg.s3.secret_key.to_string(),
            bucket_name: cfg.s3.bucket_name.to_string(),
            bucket_prefix: cfg.s3.bucket_prefix.to_string(),
        },
    );

    // parse stream strategy
    let stream_strategy = StreamStrategy::new(&cfg.s3.stream_strategy, account_names.clone());

    // only one account, use default
    if account_num <= 1 {
        return (stream_strategy, accounts);
    }

    // check multi accounts config
    let providers = cfg.s3.provider.split(",").collect::<Vec<&str>>();
    let server_urls = cfg.s3.server_url.split(",").collect::<Vec<&str>>();
    let region_names = cfg.s3.region_name.split(",").collect::<Vec<&str>>();
    let access_keys = cfg.s3.access_key.split(",").collect::<Vec<&str>>();
    let secret_keys = cfg.s3.secret_key.split(",").collect::<Vec<&str>>();
    let bucket_names = cfg.s3.bucket_name.split(",").collect::<Vec<&str>>();
    let bucket_prefixes = cfg.s3.bucket_prefix.split(",").collect::<Vec<&str>>();
    if (!cfg.s3.provider.is_empty() && providers.len() != account_num)
        || (!cfg.s3.server_url.is_empty() && server_urls.len() != account_num)
        || (!cfg.s3.region_name.is_empty() && region_names.len() != account_num)
        || (!cfg.s3.access_key.is_empty() && access_keys.len() != account_num)
        || (!cfg.s3.secret_key.is_empty() && secret_keys.len() != account_num)
        || (!cfg.s3.bucket_name.is_empty() && bucket_names.len() != account_num)
        || (!cfg.s3.bucket_prefix.is_empty() && bucket_prefixes.len() != account_num)
    {
        panic!("Invalid multi object store accounts config");
    }

    // add accounts
    for (i, name) in account_names.into_iter().enumerate() {
        accounts.insert(
            name.clone(),
            StorageConfig {
                name,
                provider: providers[i].to_string(),
                server_url: server_urls[i].to_string(),
                region_name: region_names[i].to_string(),
                access_key: access_keys[i].to_string(),
                secret_key: secret_keys[i].to_string(),
                bucket_name: bucket_names[i].to_string(),
                bucket_prefix: bucket_prefixes[i].to_string(),
            },
        );
    }
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

#[derive(Debug)]
pub enum StreamStrategy {
    Default,
    Hash(Vec<String>),               // account name list
    Stream(HashMap<String, String>), // stream name -> account name
}

impl StreamStrategy {
    pub fn new(strategy: &str, account_names: Vec<String>) -> Self {
        match strategy.to_lowercase().as_str() {
            "" => Self::Default,
            "hash" | "hashing" => Self::Hash(account_names),
            _ => {
                let mut stream_map = HashMap::new();
                for part in strategy.split(",") {
                    let pos = part.rfind(":").unwrap();
                    let stream_name = part[0..pos].to_string();
                    let account_name = part[pos + 1..].to_string();
                    stream_map.insert(stream_name, account_name);
                }
                Self::Stream(stream_map)
            }
        }
    }
}

#[async_trait]
impl ObjectStore for StorageClientFactory {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        self.get_client(Some(location))
            .put_opts(location, payload, opts)
            .await
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOpts,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.get_client(Some(location))
            .put_multipart_opts(location, opts)
            .await
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        self.get_client(Some(location))
            .get_opts(location, options)
            .await
    }

    async fn get_range(&self, location: &Path, range: Range<usize>) -> Result<Bytes> {
        self.get_client(Some(location))
            .get_range(location, range)
            .await
    }

    async fn delete(&self, location: &Path) -> Result<()> {
        self.get_client(Some(location)).delete(location).await
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'_, Result<ObjectMeta>> {
        self.get_client(prefix).list(prefix)
    }

    async fn list_with_delimiter(&self, _prefix: Option<&Path>) -> Result<ListResult> {
        Err(Error::NotImplemented)
    }

    async fn copy(&self, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn copy_if_not_exists(&self, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }
}
