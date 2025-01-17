// Copyright 2024 OpenObserve Inc.
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
use config::utils::time::BASE_TIME;
use futures::{stream::BoxStream, StreamExt};
use object_store::{
    path::Path, Attributes, GetOptions, GetResult, GetResultPayload, ListResult, MultipartUpload,
    ObjectMeta, ObjectStore, PutMultipartOpts, PutOptions, PutPayload, PutResult, Result,
};
use once_cell::sync::Lazy;

use crate::{cache::file_data, storage, storage::GetRangeExt};

/// File system with cache
#[derive(Debug, Default)]
pub struct CacheFS {}

pub static DEFAULT: Lazy<Box<dyn ObjectStore>> = Lazy::new(CacheFS::new_store);

impl std::fmt::Display for CacheFS {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CacheFS")
    }
}

impl CacheFS {
    pub fn new_store() -> Box<dyn ObjectStore> {
        Box::new(Self {})
    }
}

#[async_trait]
impl ObjectStore for CacheFS {
    async fn get(&self, location: &Path) -> Result<GetResult> {
        let path = location.to_string();
        if let Ok(data) = file_data::get_opts(&path, None, false).await {
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
            return Ok(GetResult {
                payload: GetResultPayload::Stream(
                    futures::stream::once(async move { Ok(data) }).boxed(),
                ),
                attributes: Attributes::default(),
                meta,
                range,
            });
        }
        // default to storage
        storage::DEFAULT.get(location).await
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        log::warn!("OOPS: please check cache:storage:get_opts: {:?}", location);
        let path = location.to_string();
        if let Ok(data) = file_data::get_opts(&path, None, false).await {
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
                        .map_err(|e| crate::storage::Error::BadRange(e.to_string()))?;
                    (r.clone(), data.slice(r))
                }
                None => (0..data.len(), data),
            };
            return Ok(GetResult {
                payload: GetResultPayload::Stream(
                    futures::stream::once(async move { Ok(data) }).boxed(),
                ),
                attributes: Attributes::default(),
                meta,
                range,
            });
        }
        // default to storage
        storage::DEFAULT.get_opts(location, options).await
    }

    async fn get_range(&self, location: &Path, range: Range<usize>) -> Result<Bytes> {
        if range.start > range.end {
            return Err(crate::storage::Error::BadRange(location.to_string()).into());
        }
        let path = location.to_string();
        let data = file_data::get_opts(&path, Some(range), true).await?;
        Ok(data)
    }

    async fn head(&self, location: &Path) -> Result<ObjectMeta> {
        let path = location.to_string();
        if let Ok(size) = file_data::get_size_opts(&path, false).await {
            return Ok(ObjectMeta {
                location: location.clone(),
                last_modified: *BASE_TIME,
                size,
                e_tag: None,
                version: None,
            });
        }
        // default
        storage::DEFAULT.head(location).await
    }

    #[tracing::instrument(name = "datafusion::storage::memory::list", skip_all)]
    fn list(&self, prefix: Option<&Path>) -> BoxStream<'_, Result<ObjectMeta>> {
        log::error!("NotImplemented list_with_delimiter: {:?}", prefix);
        futures::stream::once(async { Err(object_store::Error::NotImplemented {}) }).boxed()
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        log::error!("NotImplemented list_with_delimiter: {:?}", prefix);
        Err(object_store::Error::NotImplemented {})
    }

    async fn put_opts(
        &self,
        location: &Path,
        _payload: PutPayload,
        _opts: PutOptions,
    ) -> Result<PutResult> {
        log::error!("NotImplemented put_opts: {}", location);
        Err(object_store::Error::NotImplemented {})
    }

    async fn put_multipart(&self, _location: &Path) -> Result<Box<dyn MultipartUpload>> {
        Err(object_store::Error::NotImplemented)
    }

    async fn put_multipart_opts(
        &self,
        _location: &Path,
        _opts: PutMultipartOpts,
    ) -> Result<Box<dyn MultipartUpload>> {
        Err(object_store::Error::NotImplemented)
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

pub async fn get(location: &Path) -> object_store::Result<bytes::Bytes> {
    let data = DEFAULT.get(location).await?;
    let data = data.bytes().await?;
    Ok(data)
}

pub async fn get_range(location: &Path, range: Range<usize>) -> object_store::Result<bytes::Bytes> {
    let data = DEFAULT.get_range(location, range).await?;
    Ok(data)
}
