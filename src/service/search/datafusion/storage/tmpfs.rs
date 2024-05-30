// Copyright 2024 Zinc Labs Inc.
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
use chrono::Utc;
use config::utils::time::BASE_TIME;
use futures::{stream::BoxStream, StreamExt};
use infra::cache::tmpfs;
use object_store::{
    path::Path, GetOptions, GetResult, GetResultPayload, ListResult, MultipartId, ObjectMeta,
    ObjectStore, PutOptions, PutResult, Result,
};
use thiserror::Error as ThisError;
use tokio::io::AsyncWrite;

use super::GetRangeExt;

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
        let meta = ObjectMeta {
            location: location.clone(),
            last_modified: *BASE_TIME,
            size: data.len(),
            e_tag: None,
            version: None,
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

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        // log::info!("get_opts: {}", location);
        let data = self.get_bytes(location).await?;
        let meta = ObjectMeta {
            location: location.clone(),
            last_modified: *BASE_TIME,
            size: data.len(),
            e_tag: None,
            version: None,
        };
        let (range, data) = match options.range {
            Some(range) => {
                let r = range
                    .as_range(data.len())
                    .map_err(|e| super::Error::BadRange(e.to_string()))?;
                (r.clone(), data.slice(r))
            }
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
        // log::info!("head: {}", location);
        let last_modified = Utc::now();
        let bytes = self.get_bytes(location).await?;
        Ok(ObjectMeta {
            location: location.clone(),
            last_modified,
            size: bytes.len(),
            e_tag: None,
            version: None,
        })
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'_, Result<ObjectMeta>> {
        // log::info!("list: {:?}", prefix);
        let mut values = Vec::new();
        let key = prefix.unwrap().to_string();
        let objects = tmpfs::list(&key, "all").unwrap_or_default();
        for file in objects {
            values.push(Ok(ObjectMeta {
                location: file.location.into(),
                last_modified: file.last_modified,
                size: file.size,
                e_tag: None,
                version: None,
            }));
        }
        futures::stream::iter(values).boxed()
    }

    /// The memory implementation returns all results, as opposed to the cloud
    /// versions which limit their results to 1k or more because of API
    /// limitations.
    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        log::info!("list_with_delimiter: {:?}", prefix);
        let mut values = Vec::new();
        let key = prefix.unwrap().to_string();
        let objects = tmpfs::list(&key, "all").unwrap();
        for file in objects {
            values.push(ObjectMeta {
                location: file.location.into(),
                last_modified: file.last_modified,
                size: file.size,
                e_tag: None,
                version: None,
            });
        }
        Ok(ListResult {
            objects: values,
            common_prefixes: vec![prefix.unwrap().clone()],
        })
    }

    async fn put_opts(
        &self,
        location: &Path,
        _bytes: Bytes,
        _opts: PutOptions,
    ) -> Result<PutResult> {
        log::error!("NotImplemented put_opts: {}", location);
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
