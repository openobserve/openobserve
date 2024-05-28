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

use std::ops::Range;

use async_trait::async_trait;
use bytes::Bytes;
use config::{metrics, CONFIG};
use futures::stream::BoxStream;
use object_store::{
    limit::LimitStore, path::Path, Error, GetOptions, GetResult, ListResult, MultipartId,
    ObjectMeta, ObjectStore, PutOptions, PutResult, Result,
};
use tokio::io::AsyncWrite;

use crate::storage::{format_key, CONCURRENT_REQUESTS};

pub struct Remote {
    client: LimitStore<Box<dyn object_store::ObjectStore>>,
}

impl Default for Remote {
    fn default() -> Self {
        Self {
            client: LimitStore::new(init_client(), CONCURRENT_REQUESTS),
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
        bytes: Bytes,
        _opts: PutOptions,
    ) -> Result<PutResult> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let data_size = bytes.len();
        match self
            .client
            .put(&(format_key(&file, true).into()), bytes)
            .await
        {
            Ok(_) => {
                // metrics
                let columns = file.split('/').collect::<Vec<&str>>();
                if columns[0] == "files" {
                    metrics::STORAGE_WRITE_BYTES
                        .with_label_values(&[columns[1], columns[2]])
                        .inc_by(data_size as u64);
                    metrics::STORAGE_WRITE_REQUESTS
                        .with_label_values(&[columns[1], columns[2]])
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
                log::error!("s3 File upload error: {:?}", err);
                Err(err)
            }
        }
    }

    async fn put_multipart(
        &self,
        _location: &Path,
    ) -> Result<(MultipartId, Box<dyn AsyncWrite + Unpin + Send>)> {
        Err(Error::NotImplemented)
    }

    async fn abort_multipart(&self, _location: &Path, _multipart_id: &MultipartId) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn get(&self, location: &Path) -> Result<GetResult> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let result = self.client.get(&(format_key(&file, true).into())).await?;

        // metrics
        let data_len = result.meta.size;
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "remote"])
                .inc_by(data_len as u64);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "remote"])
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
            .await?;

        // metrics
        let data_len = result.meta.size;
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "remote"])
                .inc_by(data_len as u64);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "remote"])
                .inc();
            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "get", "remote"])
                .inc_by(time);
        }

        Ok(result)
    }

    async fn get_range(&self, location: &Path, range: Range<usize>) -> Result<Bytes> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let data = self
            .client
            .get_range(&(format_key(&file, true).into()), range)
            .await?;

        // metrics
        let data_len = data.len();
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "remote"])
                .inc_by(data_len as u64);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "remote"])
                .inc();
            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "get", "remote"])
                .inc_by(time);
        }

        Ok(data)
    }

    async fn head(&self, _location: &Path) -> Result<ObjectMeta> {
        Err(Error::NotImplemented)
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
                    .with_label_values(&[columns[1], columns[2]])
                    .inc();
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        result
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'_, Result<ObjectMeta>> {
        self.client
            .list(Some(&format_key(prefix.unwrap().as_ref(), true).into()))
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

fn init_aws_config() -> object_store::Result<object_store::aws::AmazonS3> {
    let config = CONFIG.blocking_read();
    let mut opts = object_store::ClientOptions::default()
        .with_connect_timeout(std::time::Duration::from_secs(config.s3.connect_timeout))
        .with_timeout(std::time::Duration::from_secs(config.s3.request_timeout))
        .with_allow_invalid_certificates(config.s3.allow_invalid_certificates)
        .with_allow_http(true);
    if config.s3.feature_http1_only {
        opts = opts.with_http1_only();
    }
    if config.s3.feature_http2_only {
        opts = opts.with_http2_only();
    }
    let force_hosted_style =
        config.s3.feature_force_hosted_style || config.s3.feature_force_path_style;
    let mut builder = object_store::aws::AmazonS3Builder::from_env()
        .with_client_options(opts)
        .with_bucket_name(&config.s3.bucket_name)
        .with_virtual_hosted_style_request(force_hosted_style);
    if !config.s3.server_url.is_empty() {
        builder = builder.with_endpoint(&config.s3.server_url);
    }
    if !config.s3.region_name.is_empty() {
        builder = builder.with_region(&config.s3.region_name);
    }
    if !config.s3.access_key.is_empty() {
        builder = builder.with_access_key_id(&config.s3.access_key);
    }
    if !config.s3.secret_key.is_empty() {
        builder = builder.with_secret_access_key(&config.s3.secret_key);
    }
    builder.build()
}

fn init_azure_config() -> object_store::Result<object_store::azure::MicrosoftAzure> {
    let config = CONFIG.blocking_read();
    let mut builder = object_store::azure::MicrosoftAzureBuilder::from_env()
        .with_client_options(
            object_store::ClientOptions::default()
                .with_connect_timeout(std::time::Duration::from_secs(config.s3.connect_timeout))
                .with_timeout(std::time::Duration::from_secs(config.s3.request_timeout))
                .with_allow_invalid_certificates(config.s3.allow_invalid_certificates),
        )
        .with_container_name(&config.s3.bucket_name);
    if !config.s3.access_key.is_empty() {
        builder = builder.with_account(&config.s3.access_key);
    }
    if !config.s3.secret_key.is_empty() {
        builder = builder.with_access_key(&config.s3.secret_key);
    }
    builder.build()
}

fn init_gcp_config() -> object_store::Result<object_store::gcp::GoogleCloudStorage> {
    let config = CONFIG.blocking_read();
    let mut builder = object_store::gcp::GoogleCloudStorageBuilder::from_env()
        .with_client_options(
            object_store::ClientOptions::default()
                .with_connect_timeout(std::time::Duration::from_secs(config.s3.connect_timeout))
                .with_timeout(std::time::Duration::from_secs(config.s3.request_timeout))
                .with_allow_invalid_certificates(config.s3.allow_invalid_certificates),
        )
        .with_bucket_name(&config.s3.bucket_name);
    if !config.s3.access_key.is_empty() {
        builder = builder.with_service_account_path(&config.s3.access_key);
    }
    builder.build()
}

fn init_client() -> Box<dyn object_store::ObjectStore> {
    let config = CONFIG.blocking_read();

    if config.common.print_key_config {
        log::info!("s3 init config: {:?}", config.s3);
    }

    match config.s3.provider.as_str() {
        "aws" | "s3" => match init_aws_config() {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("s3 init config error: {:?}", e);
            }
        },
        "azure" => match init_azure_config() {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("azure init config error: {:?}", e);
            }
        },
        "gcs" | "gcp" => match init_gcp_config() {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("gcp init config error: {:?}", e);
            }
        },
        _ => match init_aws_config() {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("{} init config error: {:?}", config.s3.provider, e);
            }
        },
    }
}
