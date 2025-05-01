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
    OBJECT_STORE_COALESCE_DEFAULT, ObjectMeta, ObjectStore, PutMultipartOpts, PutOptions,
    PutPayload, PutResult, Result, coalesce_ranges, path::Path,
};
use once_cell::sync::Lazy;

use crate::{
    cache::file_data,
    storage::{self, GetRangeExt, ObjectStoreExt},
};

/// File system with cache
#[derive(Debug, Default)]
pub struct CacheFS {}

pub static DEFAULT: Lazy<Box<dyn ObjectStoreExt>> = Lazy::new(CacheFS::new_store);

impl std::fmt::Display for CacheFS {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CacheFS")
    }
}

impl CacheFS {
    pub fn new_store() -> Box<dyn ObjectStoreExt> {
        Box::new(Self {})
    }
}

#[async_trait]
impl ObjectStoreExt for CacheFS {
    fn get_account(&self, file: &str) -> Option<String> {
        storage::DEFAULT.get_account(file)
    }

    async fn get_by_account(&self, account: &str, location: &Path) -> Result<GetResult> {
        let path = location.to_string();
        if let Ok(data) = file_data::get_opts(account, &path, None, false).await {
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
        storage::DEFAULT.get_by_account(account, location).await
    }

    async fn get_opts_by_account(
        &self,
        account: &str,
        location: &Path,
        options: GetOptions,
    ) -> Result<GetResult> {
        log::warn!("OOPS: please check cache:storage:get_opts: {:?}", location);
        let path = location.to_string();
        if let Ok(data) = file_data::get_opts(account, &path, None, false).await {
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
        storage::DEFAULT
            .get_opts_by_account(account, location, options)
            .await
    }

    async fn get_range_by_account(
        &self,
        account: &str,
        location: &Path,
        range: Range<usize>,
    ) -> Result<Bytes> {
        if range.start > range.end {
            return Err(crate::storage::Error::BadRange(location.to_string()).into());
        }
        let path = location.to_string();
        let data = file_data::get_opts(account, &path, Some(range), true).await?;
        Ok(data)
    }

    async fn get_ranges_by_account(
        &self,
        account: &str,
        location: &Path,
        ranges: &[Range<usize>],
    ) -> Result<Vec<Bytes>> {
        coalesce_ranges(
            ranges,
            |range| self.get_range_by_account(account, location, range),
            OBJECT_STORE_COALESCE_DEFAULT,
        )
        .await
    }

    async fn head_by_account(&self, account: &str, location: &Path) -> Result<ObjectMeta> {
        let path = location.to_string();
        if let Ok(size) = file_data::get_size_opts(account, &path, false).await {
            return Ok(ObjectMeta {
                location: location.clone(),
                last_modified: *BASE_TIME,
                size,
                e_tag: None,
                version: None,
            });
        }
        // default
        storage::DEFAULT.head_by_account(account, location).await
    }

    async fn delete_by_account(&self, _account: &str, _location: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    fn delete_stream_by_account<'a>(
        &'a self,
        _account: &str,
        _locations: BoxStream<'a, Result<Path>>,
    ) -> BoxStream<'a, Result<Path>> {
        futures::stream::once(async { Err(object_store::Error::NotImplemented {}) }).boxed()
    }

    fn list_by_account(
        &self,
        _account: &str,
        _prefix: Option<&Path>,
    ) -> BoxStream<'_, Result<ObjectMeta>> {
        futures::stream::once(async { Err(object_store::Error::NotImplemented {}) }).boxed()
    }

    fn list_with_offset_by_account(
        &self,
        _account: &str,
        _prefix: Option<&Path>,
        _offset: &Path,
    ) -> BoxStream<'_, Result<ObjectMeta>> {
        futures::stream::once(async { Err(object_store::Error::NotImplemented {}) }).boxed()
    }

    async fn list_with_delimiter_by_account(
        &self,
        _account: &str,
        _prefix: Option<&Path>,
    ) -> Result<ListResult> {
        Err(Error::NotImplemented)
    }

    async fn copy_by_account(&self, _account: &str, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn rename_by_account(&self, _account: &str, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn copy_if_not_exists_by_account(
        &self,
        _account: &str,
        _from: &Path,
        _to: &Path,
    ) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn rename_if_not_exists_by_account(
        &self,
        _account: &str,
        _from: &Path,
        _to: &Path,
    ) -> Result<()> {
        Err(Error::NotImplemented)
    }
}

#[async_trait]
impl ObjectStore for CacheFS {
    async fn get(&self, _location: &Path) -> Result<GetResult> {
        Err(Error::NotImplemented)
    }

    async fn get_opts(&self, _location: &Path, _options: GetOptions) -> Result<GetResult> {
        Err(Error::NotImplemented)
    }

    async fn get_range(&self, _location: &Path, _range: Range<usize>) -> Result<Bytes> {
        Err(Error::NotImplemented)
    }

    async fn head(&self, _location: &Path) -> Result<ObjectMeta> {
        Err(Error::NotImplemented)
    }

    #[tracing::instrument(name = "datafusion::storage::memory::list", skip_all)]
    fn list(&self, _prefix: Option<&Path>) -> BoxStream<'_, Result<ObjectMeta>> {
        futures::stream::once(async { Err(object_store::Error::NotImplemented {}) }).boxed()
    }

    async fn list_with_delimiter(&self, _prefix: Option<&Path>) -> Result<ListResult> {
        Err(Error::NotImplemented)
    }

    async fn put_opts(
        &self,
        _location: &Path,
        _payload: PutPayload,
        _opts: PutOptions,
    ) -> Result<PutResult> {
        Err(Error::NotImplemented)
    }

    async fn put_multipart(&self, _location: &Path) -> Result<Box<dyn MultipartUpload>> {
        Err(Error::NotImplemented)
    }

    async fn put_multipart_opts(
        &self,
        _location: &Path,
        _opts: PutMultipartOpts,
    ) -> Result<Box<dyn MultipartUpload>> {
        Err(Error::NotImplemented)
    }

    async fn delete(&self, _location: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn copy(&self, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn copy_if_not_exists(&self, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }
}

pub async fn get(account: &str, location: &Path) -> object_store::Result<bytes::Bytes> {
    let data = DEFAULT.get_by_account(account, location).await?;
    let data = data.bytes().await?;
    Ok(data)
}

pub async fn get_range(
    account: &str,
    location: &Path,
    range: Range<usize>,
) -> object_store::Result<bytes::Bytes> {
    let data = DEFAULT
        .get_range_by_account(account, location, range)
        .await?;
    Ok(data)
}
