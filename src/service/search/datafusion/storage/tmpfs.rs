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
use chrono::Utc;
use futures::{stream::BoxStream, StreamExt};
use object_store::{path::Path, MultipartId};
use object_store::{GetResult, ListResult, ObjectMeta, ObjectStore, Result};
use std::ops::Range;
use thiserror::Error as ThisError;
use tokio::io::AsyncWrite;

use crate::infra::cache::tmpfs;

/// A specialized `Error` for in-memory object store-related errors
#[derive(ThisError, Debug)]
#[allow(missing_docs)]
enum Error {
    #[error("Out of range")]
    OutOfRange(String),
    #[error("Bad range")]
    BadRange(String),
}

impl From<Error> for object_store::Error {
    fn from(source: Error) -> Self {
        Self::Generic {
            store: "tmpfs",
            source: Box::new(source),
        }
    }
}

/// Tmpfs storage suitable for testing or for opting out of using a cloud
/// storage provider.
#[derive(Debug, Default)]
pub struct Tmpfs {}

impl std::fmt::Display for Tmpfs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "tmpfs")
    }
}

#[async_trait]
impl ObjectStore for Tmpfs {
    async fn get(&self, location: &Path) -> Result<GetResult> {
        // log::info!("get: {}", location);
        let data = self.get_bytes(location).await?;

        Ok(GetResult::Stream(
            futures::stream::once(async move { Ok(data) }).boxed(),
        ))
    }

    async fn get_range(&self, location: &Path, range: Range<usize>) -> Result<Bytes> {
        // log::info!("get_range: {}, {:?}", location, range);
        let data = self.get_bytes(location).await?;
        if range.end > data.len() {
            return Err(Error::OutOfRange(location.to_string()).into());
        }
        if range.start > range.end {
            return Err(Error::BadRange(location.to_string()).into());
        }
        Ok(data.slice(range))
    }

    async fn get_ranges(&self, location: &Path, ranges: &[Range<usize>]) -> Result<Vec<Bytes>> {
        // log::info!("get_ranges: {}, {:?}", location, ranges);
        let data = self.get_bytes(location).await?;
        ranges
            .iter()
            .map(|range| {
                if range.end > data.len() {
                    return Err(Error::OutOfRange(location.to_string()).into());
                }
                if range.start > range.end {
                    return Err(Error::BadRange(location.to_string()).into());
                }
                Ok(data.slice(range.clone()))
            })
            .collect()
    }

    async fn head(&self, location: &Path) -> Result<ObjectMeta> {
        log::info!("head: {}", location);
        let last_modified = Utc::now();
        let bytes = self.get_bytes(location).await?;
        Ok(ObjectMeta {
            location: location.clone(),
            last_modified,
            size: bytes.len(),
        })
    }

    async fn list(&self, prefix: Option<&Path>) -> Result<BoxStream<'_, Result<ObjectMeta>>> {
        // log::info!("list: {:?}", prefix);
        let mut values = Vec::new();
        let key = prefix.unwrap().to_string();
        let objects = tmpfs::list(&key).unwrap();
        for file in objects {
            values.push(Ok(ObjectMeta {
                location: file.location.into(),
                last_modified: file.last_modified,
                size: file.size,
            }));
        }
        Ok(futures::stream::iter(values).boxed())
    }

    /// The memory implementation returns all results, as opposed to the cloud
    /// versions which limit their results to 1k or more because of API
    /// limitations.
    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        log::info!("list_with_delimiter: {:?}", prefix);
        let mut values = Vec::new();
        let key = prefix.unwrap().to_string();
        let objects = tmpfs::list(&key).unwrap();
        for file in objects {
            values.push(ObjectMeta {
                location: file.location.into(),
                last_modified: file.last_modified,
                size: file.size,
            });
        }
        Ok(ListResult {
            objects: values,
            common_prefixes: vec![prefix.unwrap().clone()],
        })
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

impl Tmpfs {
    pub fn new() -> Self {
        Self::default()
    }

    async fn get_bytes(&self, location: &Path) -> Result<Bytes> {
        // log::info!("get_bytes: {}", &location);
        let file = location.to_string();
        match tmpfs::get(&file) {
            Ok(data) => Ok(data),
            Err(e) => Err(object_store::Error::NotFound {
                path: location.to_string(),
                source: e.into(),
            }),
        }
    }
}
