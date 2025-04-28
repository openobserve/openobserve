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
use config::get_config;
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
        let accounts = parse_storage_config();
        let mut storage = Self {
            accounts: HashMap::with_capacity(accounts.len()),
            only_default: accounts.len() == 1,
        };
        for (name, config) in accounts {
            storage
                .accounts
                .insert(name, Box::new(super::remote::Remote::new(config)));
        }
        storage
    }

    /// Get the client for the given path.
    /// If the path is not a valid stream, return the default client.
    pub fn get_client(&self, path: &Path) -> &dyn ObjectStore {
        if !self.only_default {
            let stream = get_stream_from_file(path);
            // TODO: get account by strategy: stream name, stream name hash, etc.
            if let Some(name) = stream {
                if let Some(client) = self.accounts.get(&name) {
                    return client;
                }
            }
        }
        self.accounts
            .get(DEFAULT_ACCOUNT)
            .expect("default object store not found")
    }
}

pub fn parse_storage_config() -> HashMap<String, StorageConfig> {
    let cfg = get_config();
    // check account based on ZO_S3_ACCOUNTS
    let account_names = cfg.s3.accounts.split(",").collect::<Vec<&str>>();
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

    // only one account, use default
    if account_num <= 1 {
        return accounts;
    }

    // check multi accounts config
    let providers = cfg.s3.provider.split(",").collect::<Vec<&str>>();
    let server_urls = cfg.s3.server_url.split(",").collect::<Vec<&str>>();
    let region_names = cfg.s3.region_name.split(",").collect::<Vec<&str>>();
    let access_keys = cfg.s3.access_key.split(",").collect::<Vec<&str>>();
    let secret_keys = cfg.s3.secret_key.split(",").collect::<Vec<&str>>();
    let bucket_names = cfg.s3.bucket_name.split(",").collect::<Vec<&str>>();
    let bucket_prefixes = cfg.s3.bucket_prefix.split(",").collect::<Vec<&str>>();
    if providers.len() != account_num
        || (!server_urls.is_empty() && server_urls.len() != account_num)
        || (!region_names.is_empty() && region_names.len() != account_num)
        || (!access_keys.is_empty() && access_keys.len() != account_num)
        || (!secret_keys.is_empty() && secret_keys.len() != account_num)
        || (!bucket_names.is_empty() && bucket_names.len() != account_num)
        || (!bucket_prefixes.is_empty() && bucket_prefixes.len() != account_num)
    {
        panic!("Invalid multi accounts config");
    }

    // add accounts
    for i in 0..account_num {
        let name = account_names[i].to_string();
        accounts.insert(
            name.clone(),
            StorageConfig {
                name: name.clone(),
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
    accounts
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

#[async_trait]
impl ObjectStore for StorageClientFactory {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        self.get_client(location)
            .put_opts(location, payload, opts)
            .await
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOpts,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.get_client(location)
            .put_multipart_opts(location, opts)
            .await
    }

    async fn get(&self, location: &Path) -> Result<GetResult> {
        self.get_client(location).get(location).await
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        self.get_client(location).get_opts(location, options).await
    }

    async fn get_range(&self, location: &Path, range: Range<usize>) -> Result<Bytes> {
        self.get_client(location).get_range(location, range).await
    }

    async fn delete(&self, location: &Path) -> Result<()> {
        self.get_client(location).delete(location).await
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'_, Result<ObjectMeta>> {
        match prefix {
            Some(prefix) => self.get_client(prefix).list(Some(prefix)),
            None => self.get_client(&Path::from("")).list(None),
        }
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
