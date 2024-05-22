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
    limit::LimitStore, local::LocalFileSystem, path::Path, Error, GetOptions, GetResult,
    ListResult, MultipartId, ObjectMeta, ObjectStore, PutOptions, PutResult, Result,
};
use tokio::io::AsyncWrite;

use crate::storage::{format_key, CONCURRENT_REQUESTS};

pub struct Local {
    client: LimitStore<Box<dyn object_store::ObjectStore>>,
    with_prefix: bool,
}

impl Local {
    pub fn new(root_dir: &str, with_prefix: bool) -> Self {
        Self {
            client: LimitStore::new(init_client(root_dir), CONCURRENT_REQUESTS),
            with_prefix,
        }
    }
}

impl Default for Local {
    fn default() -> Self {
        Local::new(&CONFIG.common.data_stream_dir, true)
    }
}

impl std::fmt::Debug for Local {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("storage for local disk")
    }
}

impl std::fmt::Display for Local {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("storage for local disk")
    }
}

#[async_trait]
impl ObjectStore for Local {
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
            .put(&(format_key(&file, self.with_prefix).into()), bytes)
            .await
        {
            Ok(_output) => {
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
                        .with_label_values(&[columns[1], columns[2], "put", "local"])
                        .inc_by(time);
                }
                Ok(PutResult {
                    e_tag: None,
                    version: None,
                })
            }
            Err(err) => {
                log::error!("disk File upload error: {:?}", err);
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
        let result = self
            .client
            .get(&(format_key(&file, self.with_prefix).into()))
            .await?;

        // metrics
        let data_len = result.meta.size;
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "local"])
                .inc_by(data_len as u64);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "local"])
                .inc();
            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "get", "local"])
                .inc_by(time);
        }

        Ok(result)
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let result = self
            .client
            .get_opts(&(format_key(&file, self.with_prefix).into()), options)
            .await?;

        // metrics
        let data_len = result.meta.size;
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "local"])
                .inc_by(data_len as u64);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "local"])
                .inc();
            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "get", "local"])
                .inc_by(time);
        }

        Ok(result)
    }

    async fn get_range(&self, location: &Path, range: Range<usize>) -> Result<Bytes> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let data = self
            .client
            .get_range(&(format_key(&file, self.with_prefix).into()), range)
            .await?;

        // metrics
        let data_len = data.len();
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "local"])
                .inc_by(data_len as u64);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "local"])
                .inc();
            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "get", "local"])
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
                .delete(&(format_key(location.as_ref(), self.with_prefix).into()))
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
        let prefix = format_key(prefix.unwrap().as_ref(), self.with_prefix);
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

fn init_client(root_dir: &str) -> Box<dyn object_store::ObjectStore> {
    Box::new(
        LocalFileSystem::new_with_prefix(std::path::Path::new(root_dir).to_str().unwrap())
            .expect("Error creating local file system"),
    )
}
