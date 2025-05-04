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

use std::{ops::Range, time::Duration};

use async_trait::async_trait;
use bytes::Bytes;
use config::{get_config, metrics};
use futures::stream::BoxStream;
use object_store::{
    Error, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOpts, PutOptions, PutPayload, PutResult, Result, limit::LimitStore, path::Path,
};

use crate::storage::{CONCURRENT_REQUESTS, format_key};

// test only
const TEST_FILE: &str = "o2_test/check.txt";

#[derive(Debug)]
pub struct StorageConfig {
    pub name: String,          // ZO_S3_ACCOUNTS
    pub provider: String,      // ZO_S3_PROVIDER
    pub server_url: String,    // ZO_S3_SERVER_URL
    pub region_name: String,   // ZO_S3_REGION_NAME
    pub access_key: String,    // ZO_S3_ACCESS_KEY
    pub secret_key: String,    // ZO_S3_SECRET_KEY
    pub bucket_name: String,   // ZO_S3_BUCKET_NAME
    pub bucket_prefix: String, // ZO_S3_BUCKET_PREFIX
}

pub struct Remote {
    client: LimitStore<Box<dyn object_store::ObjectStore>>,
}

impl Remote {
    pub fn new(config: StorageConfig) -> Self {
        Self {
            client: LimitStore::new(init_client(config), CONCURRENT_REQUESTS),
        }
    }
}

impl std::fmt::Debug for Remote {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("storage for remote")
    }
}

impl std::fmt::Display for Remote {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("storage for remote")
    }
}

#[async_trait]
impl ObjectStore for Remote {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let data_size = payload.content_length();
        match self
            .client
            .put_opts(&(format_key(&file, true).into()), payload, opts)
            .await
        {
            Ok(_) => {
                // metrics
                let columns = file.split('/').collect::<Vec<&str>>();
                if columns[0] == "files" {
                    metrics::STORAGE_WRITE_BYTES
                        .with_label_values(&[columns[1], columns[2], "remote"])
                        .inc_by(data_size as u64);
                    metrics::STORAGE_WRITE_REQUESTS
                        .with_label_values(&[columns[1], columns[2], "remote"])
                        .inc();
                    let time = start.elapsed().as_secs_f64();
                    metrics::STORAGE_TIME
                        .with_label_values(&[columns[1], columns[2], "put", "remote"])
                        .inc_by(time);
                }
                Ok(PutResult {
                    e_tag: None,
                    version: None,
                })
            }
            Err(err) => {
                log::error!("[STORAGE] put_opts remote file: {}, error: {:?}", file, err);
                Err(err)
            }
        }
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOpts,
    ) -> Result<Box<dyn MultipartUpload>> {
        let file = location.to_string();
        match self
            .client
            .put_multipart_opts(&(format_key(&file, true).into()), opts)
            .await
        {
            Ok(r) => Ok(r),
            Err(err) => {
                log::error!(
                    "[STORAGE] put_multipart_opts remote file: {}, error: {:?}",
                    file,
                    err
                );
                Err(err)
            }
        }
    }

    async fn get(&self, location: &Path) -> Result<GetResult> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let result = self
            .client
            .get(&(format_key(&file, true).into()))
            .await
            .map_err(|e| {
                if file.ne(TEST_FILE) {
                    log::error!("[STORAGE] get remote file: {}, error: {:?}", file, e);
                }
                e
            })?;

        // metrics
        let data_len = result.meta.size;
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "get", "remote"])
                .inc_by(data_len as u64);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "get", "remote"])
                .inc();
            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "get", "remote"])
                .inc_by(time);
        }
        log::debug!("[STORAGE] get remote file: {}", file);

        Ok(result)
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let result = self
            .client
            .get_opts(&(format_key(&file, true).into()), options)
            .await
            .map_err(|e| {
                log::error!("[STORAGE] get_opts remote file: {}, error: {:?}", file, e);
                e
            })?;

        // metrics
        let data_len = result.meta.size;
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "get_opts", "remote"])
                .inc_by(data_len as u64);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "get_opts", "remote"])
                .inc();
            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "get_opts", "remote"])
                .inc_by(time);
        }

        Ok(result)
    }

    async fn get_range(&self, location: &Path, range: Range<usize>) -> Result<Bytes> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let data = self
            .client
            .get_range(&(format_key(&file, true).into()), range.clone())
            .await
            .map_err(|e| {
                log::error!(
                    "[STORAGE] get_range remote file: {}, range: {:?}, error: {:?}",
                    file,
                    range,
                    e
                );
                e
            })?;

        // metrics
        let data_len = data.len();
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "get_range", "remote"])
                .inc_by(data_len as u64);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "get_range", "remote"])
                .inc();
            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "get_range", "remote"])
                .inc_by(time);
        }

        Ok(data)
    }

    async fn delete(&self, location: &Path) -> Result<()> {
        let mut result: Result<()> = Ok(());
        for _ in 0..3 {
            result = self
                .client
                .delete(&(format_key(location.as_ref(), true).into()))
                .await;
            if result.is_ok() {
                let file = location.to_string();
                let columns = file.split('/').collect::<Vec<&str>>();
                metrics::STORAGE_WRITE_REQUESTS
                    .with_label_values(&[columns[1], columns[2], "remote"])
                    .inc();
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        result
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'_, Result<ObjectMeta>> {
        let key = prefix.map(|p| p.as_ref());
        let prefix = format_key(key.unwrap_or(""), true);
        self.client.list(Some(&prefix.into()))
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

fn init_aws_config(config: StorageConfig) -> object_store::Result<object_store::aws::AmazonS3> {
    let cfg = get_config();
    let mut opts = object_store::ClientOptions::default()
        .with_connect_timeout(std::time::Duration::from_secs(cfg.s3.connect_timeout))
        .with_timeout(std::time::Duration::from_secs(cfg.s3.request_timeout))
        .with_allow_invalid_certificates(cfg.s3.allow_invalid_certificates)
        .with_http2_keep_alive_timeout(Duration::from_secs(cfg.s3.keepalive_timeout))
        .with_allow_http(true);
    if cfg.s3.feature_http1_only {
        opts = opts.with_http1_only();
    }
    if cfg.s3.feature_http2_only {
        opts = opts.with_http2_only();
    }
    if cfg.s3.max_idle_per_host > 0 {
        opts = opts.with_pool_max_idle_per_host(cfg.s3.max_idle_per_host)
    }
    let force_hosted_style = cfg.s3.feature_force_hosted_style;
    let retry_config = object_store::RetryConfig {
        max_retries: cfg.s3.max_retries,
        // this value is from the default arrow-rs object
        // https://github.com/apache/arrow-rs/blob/678517018ddfd21b202a94df13b06dfa1ab8a378/object_store/src/client/retry.rs#L171-L179
        retry_timeout: Duration::from_secs(3 * 60),
        backoff: object_store::BackoffConfig::default(),
    };
    let mut builder = object_store::aws::AmazonS3Builder::from_env()
        .with_client_options(opts)
        .with_bucket_name(&config.bucket_name)
        .with_retry(retry_config)
        .with_virtual_hosted_style_request(force_hosted_style);
    if !config.server_url.is_empty() {
        builder = builder.with_endpoint(&config.server_url);
    }
    if !config.region_name.is_empty() {
        builder = builder.with_region(&config.region_name);
    }
    if !config.access_key.is_empty() {
        builder = builder.with_access_key_id(&config.access_key);
    }
    if !config.secret_key.is_empty() {
        builder = builder.with_secret_access_key(&config.secret_key);
    }
    builder.build()
}

fn init_azure_config(
    config: StorageConfig,
) -> object_store::Result<object_store::azure::MicrosoftAzure> {
    let cfg = get_config();
    let mut builder = object_store::azure::MicrosoftAzureBuilder::from_env()
        .with_client_options(
            object_store::ClientOptions::default()
                .with_connect_timeout(std::time::Duration::from_secs(cfg.s3.connect_timeout))
                .with_timeout(std::time::Duration::from_secs(cfg.s3.request_timeout))
                .with_allow_invalid_certificates(cfg.s3.allow_invalid_certificates),
        )
        .with_container_name(&config.bucket_name);
    if !config.access_key.is_empty() {
        builder = builder.with_account(&config.access_key);
    }
    if !config.secret_key.is_empty() {
        builder = builder.with_access_key(&config.secret_key);
    }
    builder.build()
}

fn init_gcp_config(
    config: StorageConfig,
) -> object_store::Result<object_store::gcp::GoogleCloudStorage> {
    let cfg = get_config();
    let mut builder = object_store::gcp::GoogleCloudStorageBuilder::from_env()
        .with_client_options(
            object_store::ClientOptions::default()
                .with_connect_timeout(std::time::Duration::from_secs(cfg.s3.connect_timeout))
                .with_timeout(std::time::Duration::from_secs(cfg.s3.request_timeout))
                .with_allow_invalid_certificates(cfg.s3.allow_invalid_certificates),
        )
        .with_bucket_name(&config.bucket_name);
    if !config.access_key.is_empty() {
        builder = builder.with_service_account_path(&config.access_key);
    }
    builder.build()
}

fn init_client(config: StorageConfig) -> Box<dyn object_store::ObjectStore> {
    if get_config().common.print_key_config {
        log::info!("s3 init config: {:?}", config);
    }

    let provider = config.provider.to_string();
    match provider.as_str() {
        "aws" | "s3" => match init_aws_config(config) {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("s3 init config error: {:?}", e);
            }
        },
        "azure" => match init_azure_config(config) {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("azure init config error: {:?}", e);
            }
        },
        "gcs" | "gcp" => match init_gcp_config(config) {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("gcp init config error: {:?}", e);
            }
        },
        _ => match init_aws_config(config) {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("{} init config error: {:?}", provider, e);
            }
        },
    }
}

pub async fn test_config() -> Result<(), anyhow::Error> {
    // Test download
    if let Err(e) = super::get("", TEST_FILE).await {
        if matches!(e, object_store::Error::NotFound { .. }) {
            let test_content = Bytes::from("Hello, S3!");
            // Test upload
            if let Err(e) = super::put("", TEST_FILE, test_content).await {
                return Err(anyhow::anyhow!("S3 upload test failed: {:?}", e));
            }
        } else {
            return Err(anyhow::anyhow!("S3 download test failed: {:?}", e));
        }
    }

    Ok(())
}
