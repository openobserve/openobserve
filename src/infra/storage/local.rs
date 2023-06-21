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

use async_trait::async_trait;
use bytes::Bytes;
use futures::{stream::BoxStream, StreamExt};
use object_store::{
    limit::LimitStore, local::LocalFileSystem, path::Path, Error, GetResult, ListResult,
    MultipartId, ObjectMeta, ObjectStore, Result,
};
use std::ops::Range;
use tokio::io::AsyncWrite;

use super::{format_key, CONCURRENT_REQUESTS};
use crate::infra::{config::CONFIG, metrics};

pub struct Local {
    client: LimitStore<Box<dyn object_store::ObjectStore>>,
}

impl Default for Local {
    fn default() -> Self {
        Self {
            client: LimitStore::new(init_client(), CONCURRENT_REQUESTS),
        }
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
    async fn put(&self, location: &Path, bytes: Bytes) -> Result<()> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let data_size = bytes.len();
        match self.client.put(&(format_key(&file).into()), bytes).await {
            Ok(_output) => {
                // metrics
                let columns = file.split('/').collect::<Vec<&str>>();
                if columns[0] == "files" {
                    metrics::STORAGE_WRITE_BYTES
                        .with_label_values(&[columns[1], columns[3], columns[2]])
                        .inc_by(data_size as u64);

                    let time = start.elapsed().as_secs_f64();
                    metrics::STORAGE_TIME
                        .with_label_values(&[columns[1], columns[3], columns[2], "put"])
                        .inc_by(time);
                }
                log::info!("disk File upload succeeded: {}", file);
                Ok(())
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
        let result = self.client.get(&(format_key(&file).into())).await?;

        // metrics
        let data = result.bytes().await?;
        let data_len = data.len();
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[3], columns[2]])
                .inc_by(data_len as u64);

            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[3], columns[2], "get"])
                .inc_by(time);
        }

        Ok(GetResult::Stream(
            futures::stream::once(async move { Ok(data) }).boxed(),
        ))
    }

    async fn get_range(&self, location: &Path, range: Range<usize>) -> Result<Bytes> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let data = self
            .client
            .get_range(&(format_key(&file).into()), range)
            .await?;

        // metrics
        let data_len = data.len();
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[3], columns[2]])
                .inc_by(data_len as u64);

            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[3], columns[2], "get"])
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
                .delete(&(format_key(location.as_ref()).into()))
                .await;
            if result.is_ok() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        result
    }

    async fn list(&self, prefix: Option<&Path>) -> Result<BoxStream<'_, Result<ObjectMeta>>> {
        self.client
            .list(Some(&format_key(prefix.unwrap().as_ref()).into()))
            .await
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

fn init_client() -> Box<dyn object_store::ObjectStore> {
    Box::new(
        LocalFileSystem::new_with_prefix(
            std::path::Path::new(&CONFIG.common.data_stream_dir)
                .to_str()
                .unwrap(),
        )
        .unwrap(),
    )
}
