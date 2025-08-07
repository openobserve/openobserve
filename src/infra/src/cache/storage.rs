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
use config::utils::time::BASE_TIME;
use futures::{StreamExt, stream::BoxStream};
use object_store::{
    Attributes, Error, GetOptions, GetResult, GetResultPayload, ListResult, MultipartUpload,
    OBJECT_STORE_COALESCE_DEFAULT, ObjectMeta, ObjectStore, PutMultipartOptions, PutOptions,
    PutPayload, PutResult, Result, coalesce_ranges, path::Path,
};
use once_cell::sync::Lazy;

use crate::{cache::file_data, storage};

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
                size: data.len() as u64,
                e_tag: None,
                version: None,
            };
            let range = Range {
                start: 0,
                end: data.len() as u64,
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
        let path = location.to_string();
        if let Ok(data) = file_data::get_opts(&path, None, false).await {
            let meta = ObjectMeta {
                location: location.clone(),
                last_modified: *BASE_TIME,
                size: data.len() as u64,
                e_tag: None,
                version: None,
            };
            let (range, data) = match options.range {
                Some(range) => {
                    let r = range
                        .as_range(data.len() as u64)
                        .map_err(|e| crate::storage::Error::BadRange(e.to_string()))?;
                    (r.clone(), data.slice(r.start as usize..r.end as usize))
                }
                None => (0..data.len() as u64, data),
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

    async fn get_range(&self, location: &Path, range: Range<u64>) -> Result<Bytes> {
        if range.start > range.end {
            return Err(crate::storage::Error::BadRange(location.to_string()).into());
        }
        let path = location.to_string();
        let data = file_data::get_opts(&path, Some(range), true).await?;
        Ok(data)
    }

    async fn get_ranges(&self, location: &Path, ranges: &[Range<u64>]) -> Result<Vec<Bytes>> {
        coalesce_ranges(
            ranges,
            |range| self.get_range(location, range),
            OBJECT_STORE_COALESCE_DEFAULT,
        )
        .await
    }

    async fn head(&self, location: &Path) -> Result<ObjectMeta> {
        let path = location.to_string();
        if let Ok(size) = file_data::get_size_opts(&path, false).await {
            return Ok(ObjectMeta {
                location: location.clone(),
                last_modified: *BASE_TIME,
                size: size as u64,
                e_tag: None,
                version: None,
            });
        }
        // default
        storage::DEFAULT.head(location).await
    }

    async fn delete(&self, _location: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    fn delete_stream<'a>(
        &'a self,
        _locations: BoxStream<'a, Result<Path>>,
    ) -> BoxStream<'a, Result<Path>> {
        futures::stream::once(async { Err(object_store::Error::NotImplemented {}) }).boxed()
    }

    fn list(&self, _prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        futures::stream::once(async { Err(object_store::Error::NotImplemented {}) }).boxed()
    }

    fn list_with_offset(
        &self,
        _prefix: Option<&Path>,
        _offset: &Path,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        futures::stream::once(async { Err(object_store::Error::NotImplemented {}) }).boxed()
    }

    async fn list_with_delimiter(&self, _prefix: Option<&Path>) -> Result<ListResult> {
        Err(Error::NotImplemented)
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
        _opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        Err(object_store::Error::NotImplemented)
    }

    async fn copy(&self, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn rename(&self, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn copy_if_not_exists(&self, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn rename_if_not_exists(&self, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }
}

pub async fn get(path: &Path) -> Result<GetResult> {
    DEFAULT.get(path).await
}

pub async fn get_opts(path: &Path, options: GetOptions) -> Result<GetResult> {
    DEFAULT.get_opts(path, options).await
}

pub async fn get_range(location: &Path, range: Range<u64>) -> Result<bytes::Bytes> {
    DEFAULT.get_range(location, range).await
}

pub async fn head(location: &Path) -> Result<ObjectMeta> {
    DEFAULT.head(location).await
}
