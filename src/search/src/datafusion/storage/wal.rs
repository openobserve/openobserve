// Copyright 2026 OpenObserve Inc.
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

use async_trait::async_trait;
use futures::{StreamExt, stream::BoxStream};
use infra::storage;
use object_store::{
    CopyOptions, Error, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta,
    ObjectStore, PutMultipartOptions, PutOptions, PutPayload, PutResult, Result, path::Path,
};

use super::format_location;

/// File system for local wal
#[derive(Debug, Default)]
pub struct FS {}

impl FS {
    pub fn name() -> &'static str {
        "Wal"
    }

    /// Create new local wal storage.
    pub fn new() -> Self {
        Self::default()
    }
}

impl std::fmt::Display for FS {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", Self::name())
    }
}

#[async_trait]
impl ObjectStore for FS {
    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let (_, location) = format_location(location);
        storage::wal::get_opts(&location, options).await
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        let key = prefix.unwrap().to_string();
        let objects = match super::file_list::get(&key) {
            Ok(objects) => objects,
            Err(e) => {
                log::error!("Error getting file list for wal storage: {e}");
                vec![]
            }
        };
        let values = objects
            .iter()
            .map(|file| Ok(file.to_owned()))
            .collect::<Vec<Result<ObjectMeta>>>();
        futures::stream::iter(values).boxed()
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        log::error!("NotImplemented list_with_delimiter: {prefix:?}");
        Err(Error::NotImplemented {
            operation: "list_with_delimiter".to_string(),
            implementer: Self::name().to_string(),
        })
    }

    async fn put_opts(
        &self,
        location: &Path,
        _payload: PutPayload,
        _opts: PutOptions,
    ) -> Result<PutResult> {
        log::error!("NotImplemented put_opts: {location}");
        Err(Error::NotImplemented {
            operation: "put_opts".to_string(),
            implementer: Self::name().to_string(),
        })
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        _opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        log::error!("NotImplemented put_multipart_opts: {location}");
        Err(Error::NotImplemented {
            operation: "put_multipart_opts".to_string(),
            implementer: Self::name().to_string(),
        })
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        log::error!("NotImplemented delete_stream");
        locations
            .map(|_| {
                Err(Error::NotImplemented {
                    operation: "delete_stream".to_string(),
                    implementer: Self::name().to_string(),
                })
            })
            .boxed()
    }

    async fn copy_opts(&self, from: &Path, to: &Path, _options: CopyOptions) -> Result<()> {
        log::error!("NotImplemented copy_opts: from {from} to {to}");
        Err(Error::NotImplemented {
            operation: "copy_opts".to_string(),
            implementer: Self::name().to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use object_store::path::Path;

    use super::*;

    #[test]
    fn test_name_returns_wal() {
        assert_eq!(FS::name(), "Wal");
    }

    #[test]
    fn test_display_formats_wal() {
        let fs = FS::new();
        assert_eq!(format!("{fs}"), "Wal");
    }

    #[tokio::test]
    async fn test_put_opts_returns_not_implemented() {
        let fs = FS::new();
        let path = Path::from("test/file.parquet");
        let result = fs
            .put_opts(&path, PutPayload::default(), PutOptions::default())
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented { .. }));
    }

    #[tokio::test]
    async fn test_list_with_delimiter_returns_not_implemented() {
        let fs = FS::new();
        let result = fs.list_with_delimiter(None).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented { .. }));
    }

    #[tokio::test]
    async fn test_copy_opts_returns_not_implemented() {
        let fs = FS::new();
        let from = Path::from("src/file.parquet");
        let to = Path::from("dst/file.parquet");
        let result = fs.copy_opts(&from, &to, CopyOptions::default()).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented { .. }));
    }
}
