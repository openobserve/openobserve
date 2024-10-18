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
use infra::{cache::file_data, storage};
use object_store::{
    path::Path, Attributes, GetOptions, GetResult, GetResultPayload, ListResult, MultipartUpload,
    ObjectMeta, ObjectStore, PutMultipartOpts, PutOptions, PutPayload, PutResult, Result,
};

use super::GetRangeExt;

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
                    attributes: Attributes::default(),
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
                    attributes: Attributes::default(),
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
                        version: options.version.clone(),
                        head: options.head,
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
                version: None,
            }),
            None => match storage::LOCAL_CACHE.head(location).await {
                Ok(data) => Ok(data),
                Err(_) => storage::DEFAULT.head(location).await,
            },
        }
    }

    #[tracing::instrument(name = "datafusion::storage::memory::list", skip_all)]
    fn list(&self, prefix: Option<&Path>) -> BoxStream<'_, Result<ObjectMeta>> {
        let key = prefix.unwrap().to_string();
        let objects = super::file_list::get(&key).unwrap_or_default();
        let values = objects
            .iter()
            .map(|file| Ok(file.to_owned()))
            .collect::<Vec<Result<ObjectMeta>>>();
        futures::stream::iter(values).boxed()
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
