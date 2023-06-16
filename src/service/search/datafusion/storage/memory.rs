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
    path::Path, GetResult, ListResult, MultipartId, ObjectMeta, ObjectStore, Result,
};
use std::ops::Range;
use tokio::io::AsyncWrite;

use crate::common::time::BASE_TIME;
use crate::infra::{cache::file_data, storage};

/// fsm: File system with memory cache
#[derive(Debug, Default)]
pub struct FS {}

impl FS {
    /// Create new in-memory storage.
    pub fn new() -> Self {
        Self::default()
    }

    async fn get_cache(&self, location: &Path) -> Result<Bytes> {
        let path = location.to_string();
        let data = file_data::get(&path);
        tokio::task::yield_now().await;
        match data {
            Ok(data) => Ok(data),
            Err(err) => Err(object_store::Error::NotFound {
                path,
                source: err.into(),
            }),
        }
    }
}

impl std::fmt::Display for FS {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "FsMemory")
    }
}

#[async_trait]
impl ObjectStore for FS {
    async fn get(&self, location: &Path) -> Result<GetResult> {
        let data = match self.get_cache(location).await {
            Ok(data) => data,
            Err(_) => return storage::DEFAULT.get(location).await,
        };
        Ok(GetResult::Stream(
            futures::stream::once(async move { Ok(data) }).boxed(),
        ))
    }

    async fn get_range(&self, location: &Path, range: Range<usize>) -> Result<Bytes> {
        let data = match self.get_cache(location).await {
            Ok(data) => data,
            Err(_) => return storage::DEFAULT.get_range(location, range).await,
        };
        if range.end > data.len() {
            let file = location.to_string();
            let file_meta = crate::service::file_list::get_file_meta(&file).unwrap_or_default();
            log::error!(
                "get_range: OutOfRange, file: {:?}, meta: {:?}, range.end {} > data.len() {}",
                file,
                file_meta,
                range.end,
                data.len()
            );
            return Err(super::Error::OutOfRange(location.to_string()).into());
        }
        if range.start > range.end {
            return Err(super::Error::BadRange(location.to_string()).into());
        }
        Ok(data.slice(range))
    }

    async fn get_ranges(&self, location: &Path, ranges: &[Range<usize>]) -> Result<Vec<Bytes>> {
        let data = match self.get_cache(location).await {
            Ok(data) => data,
            Err(_) => return storage::DEFAULT.get_ranges(location, ranges).await,
        };
        ranges
            .iter()
            .map(|range| {
                if range.end > data.len() {
                    let file = location.to_string();
                    let file_meta =
                        crate::service::file_list::get_file_meta(&file).unwrap_or_default();
                    log::error!(
                        "get_ranges: OutOfRange, file: {:?}, meta: {:?}, range.end {} > data.len() {}",
                        file,
                        file_meta,
                        range.end,
                        data.len()
                    );
                    return Err(super::Error::OutOfRange(location.to_string()).into());
                }
                if range.start > range.end {
                    return Err(super::Error::BadRange(location.to_string()).into());
                }
                Ok(data.slice(range.clone()))
            })
            .collect()
    }

    async fn head(&self, location: &Path) -> Result<ObjectMeta> {
        let data = match self.get_cache(location).await {
            Ok(data) => data,
            Err(_) => return storage::DEFAULT.head(location).await,
        };
        Ok(ObjectMeta {
            location: location.clone(),
            last_modified: *BASE_TIME,
            size: data.len(),
        })
    }

    #[tracing::instrument(name = "datafusion::storage::memory::list", skip_all)]
    async fn list(&self, prefix: Option<&Path>) -> Result<BoxStream<'_, Result<ObjectMeta>>> {
        let key = prefix.unwrap().to_string();
        let objects = super::file_list::get(&key).unwrap();
        let values = objects
            .iter()
            .map(|file| Ok(file.to_owned()))
            .collect::<Vec<Result<ObjectMeta>>>();
        Ok(futures::stream::iter(values).boxed())
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        log::error!("NotImplemented list_with_delimiter: {:?}", prefix);
        Err(object_store::Error::NotImplemented {})
    }

    async fn put(&self, location: &Path, _bytes: Bytes) -> Result<()> {
        log::error!("NotImplemented put: {}", location);
        Err(object_store::Error::NotImplemented {})
    }

    async fn put_multipart(
        &self,
        location: &Path,
    ) -> Result<(MultipartId, Box<dyn AsyncWrite + Unpin + Send>)> {
        log::error!("NotImplemented put_multipart: {}", location);
        Err(object_store::Error::NotImplemented {})
    }

    async fn abort_multipart(&self, location: &Path, _multipart_id: &MultipartId) -> Result<()> {
        log::error!("NotImplemented abort_multipart: {}", location);
        Err(object_store::Error::NotImplemented {})
    }

    async fn delete(&self, location: &Path) -> Result<()> {
        log::error!("NotImplemented delete: {}", location);
        Err(object_store::Error::NotImplemented {})
    }

    async fn copy(&self, from: &Path, to: &Path) -> Result<()> {
        log::error!("NotImplemented copy: from {} to {}", from, to);
        Err(object_store::Error::NotImplemented {})
    }

    async fn copy_if_not_exists(&self, from: &Path, to: &Path) -> Result<()> {
        log::error!("NotImplemented copy_if_not_exists: from {} to {}", from, to);
        Err(object_store::Error::NotImplemented {})
    }
}
