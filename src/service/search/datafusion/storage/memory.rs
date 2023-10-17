// Copyright 2023 Zinc Labs Inc.
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
    path::Path, GetOptions, GetResult, GetResultPayload, ListResult, MultipartId, ObjectMeta,
    ObjectStore, Result,
};
use std::ops::Range;
use tokio::io::AsyncWrite;

use crate::common::infra::{cache::file_data, storage};
use crate::common::utils::time::BASE_TIME;

/// File system with memory cache
#[derive(Debug, Default)]
pub struct FS {}

impl FS {
    /// Create new memory storage.
    pub fn new() -> Self {
        Self::default()
    }

    fn format_location(&self, location: &Path) -> Path {
        let mut path = location.to_string();
        if let Some(p) = path.find("/$$/") {
            path = path[p + 4..].to_string();
        }
        path.into()
    }

    async fn get_cache(&self, location: &Path, range: Option<Range<usize>>) -> Option<Bytes> {
        let path = location.to_string();
        let data = file_data::memory::get(&path, range).await;
        tokio::task::yield_now().await;
        data
    }
}

impl std::fmt::Display for FS {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Memory")
    }
}

#[async_trait]
impl ObjectStore for FS {
    async fn get(&self, location: &Path) -> Result<GetResult> {
        let location = &self.format_location(location);
        match self.get_cache(location, None).await {
            Some(data) => {
                let meta = ObjectMeta {
                    location: location.clone(),
                    last_modified: *BASE_TIME,
                    size: data.len(),
                    e_tag: None,
                };
                let range = Range {
                    start: 0,
                    end: data.len(),
                };
                Ok(GetResult {
                    payload: GetResultPayload::Stream(
                        futures::stream::once(async move { Ok(data) }).boxed(),
                    ),
                    meta,
                    range,
                })
            }
            None => match storage::LOCAL_CACHE.get(location).await {
                Ok(data) => Ok(data),
                Err(_) => storage::DEFAULT.get(location).await,
            },
        }
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let location = &self.format_location(location);
        match self.get_cache(location, None).await {
            Some(data) => {
                let meta = ObjectMeta {
                    location: location.clone(),
                    last_modified: *BASE_TIME,
                    size: data.len(),
                    e_tag: None,
                };
                let (range, data) = match options.range {
                    Some(range) => (range.clone(), data.slice(range)),
                    None => (0..data.len(), data),
                };
                Ok(GetResult {
                    payload: GetResultPayload::Stream(
                        futures::stream::once(async move { Ok(data) }).boxed(),
                    ),
                    meta,
                    range,
                })
            }
            None => match storage::LOCAL_CACHE
                .get_opts(
                    location,
                    GetOptions {
                        range: options.range.clone(),
                        if_modified_since: options.if_modified_since,
                        if_unmodified_since: options.if_unmodified_since,
                        if_match: options.if_match.clone(),
                        if_none_match: options.if_none_match.clone(),
                    },
                )
                .await
            {
                Ok(ret) => Ok(ret),
                Err(_) => storage::DEFAULT.get_opts(location, options).await,
            },
        }
    }

    async fn get_range(&self, location: &Path, range: Range<usize>) -> Result<Bytes> {
        let location = &self.format_location(location);
        match self.get_cache(location, Some(range.clone())).await {
            Some(data) => {
                if range.start > range.end {
                    return Err(super::Error::BadRange(location.to_string()).into());
                }
                if range.end - range.start != data.len() {
                    return Err(super::Error::BadRange(location.to_string()).into());
                }
                Ok(data)
            }
            None => match storage::LOCAL_CACHE
                .get_range(location, range.clone())
                .await
            {
                Ok(data) => Ok(data),
                Err(_) => storage::DEFAULT.get_range(location, range).await,
            },
        }
    }

    async fn get_ranges(&self, location: &Path, ranges: &[Range<usize>]) -> Result<Vec<Bytes>> {
        if ranges.is_empty() {
            return Ok(vec![]);
        }
        let location = &self.format_location(location);
        match self.get_cache(location, None).await {
            Some(data) => ranges
                .iter()
                .map(|range| {
                    if range.start > range.end {
                        return Err(super::Error::BadRange(location.to_string()).into());
                    }
                    if range.end > data.len() {
                        return Err(super::Error::OutOfRange(location.to_string()).into());
                    }
                    Ok(data.slice(range.clone()))
                })
                .collect(),
            None => match storage::LOCAL_CACHE.get_ranges(location, ranges).await {
                Ok(data) => Ok(data),
                Err(_) => storage::DEFAULT.get_ranges(location, ranges).await,
            },
        }
    }

    async fn head(&self, location: &Path) -> Result<ObjectMeta> {
        let location = &self.format_location(location);
        match self.get_cache(location, None).await {
            Some(data) => Ok(ObjectMeta {
                location: location.clone(),
                last_modified: *BASE_TIME,
                size: data.len(),
                e_tag: None,
            }),
            None => match storage::LOCAL_CACHE.head(location).await {
                Ok(data) => Ok(data),
                Err(_) => storage::DEFAULT.head(location).await,
            },
        }
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
