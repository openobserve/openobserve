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

use async_trait::async_trait;
use futures::{StreamExt, stream::BoxStream};
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, Result, path::Path,
};

use super::format_location;

/// File system with memory cache
#[derive(Debug, Default)]
pub struct FS {}

impl FS {
    /// Create new memory storage.
    pub fn new() -> Self {
        Self::default()
    }
}

impl std::fmt::Display for FS {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Memory")
    }
}

#[async_trait]
impl ObjectStore for FS {
    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let (account, location) = format_location(location);
        infra::cache::storage::get_opts(&account, &location, options).await
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        let key = match prefix {
            Some(p) => p.to_string(),
            None => {
                // Return empty stream when prefix is None
                return futures::stream::empty().boxed();
            }
        };
        let objects = match super::file_list::get(&key) {
            Ok(objects) => objects,
            Err(e) => {
                log::error!("Error getting file list for memory storage: {e}");
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
        Err(object_store::Error::NotImplemented {
            operation: "list_with_delimiter".to_string(),
            implementer: "Memory".to_string(),
        })
    }

    async fn put_opts(
        &self,
        location: &Path,
        _payload: PutPayload,
        _opts: PutOptions,
    ) -> Result<PutResult> {
        log::error!("NotImplemented put_opts: {location}");
        Err(object_store::Error::NotImplemented {
            operation: "put_opts".to_string(),
            implementer: "Memory".to_string(),
        })
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        _opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        log::error!("NotImplemented put_multipart_opts: {location}");
        Err(object_store::Error::NotImplemented {
            operation: "put_multipart_opts".to_string(),
            implementer: "Memory".to_string(),
        })
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        log::error!("NotImplemented delete_stream");
        locations
            .map(|_| {
                Err(object_store::Error::NotImplemented {
                    operation: "delete_stream".to_string(),
                    implementer: "Memory".to_string(),
                })
            })
            .boxed()
    }

    async fn copy_opts(&self, from: &Path, to: &Path, _options: CopyOptions) -> Result<()> {
        log::error!("NotImplemented copy_opts: from {from} to {to}");
        Err(object_store::Error::NotImplemented {
            operation: "copy_opts".to_string(),
            implementer: "Memory".to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;
    use object_store::{GetOptions, PutOptions, PutPayload};

    use super::*;

    #[test]
    fn test_fs_constructors_and_traits() {
        // Test constructors and trait implementations
        let fs_new = FS::new();
        let fs_default = FS::default();
        let fs_direct = FS {};

        // All should display as "Memory"
        assert_eq!(fs_new.to_string(), "Memory");
        assert_eq!(fs_default.to_string(), "Memory");
        assert_eq!(fs_direct.to_string(), "Memory");

        // Debug should show "FS"
        assert_eq!(format!("{fs_direct:?}"), "FS");
    }

    #[tokio::test]
    async fn test_read_operations() {
        let fs = FS::new();
        let location = Path::from("test/file.txt");
        let options = GetOptions::default();

        // Test read operations with non-existent files
        let get_opts_result = fs.get_opts(&location, options).await;

        assert!(get_opts_result.is_err());
    }

    #[tokio::test]
    async fn test_list_operations() {
        let fs = FS::new();

        // Test list with valid prefix
        let prefix = Some(Path::from("test/"));
        let stream = fs.list(prefix.as_ref());
        let results: Vec<Result<ObjectMeta>> = stream.collect().await;
        assert!(results.is_empty());

        // Test list with None prefix
        let prefix_none: Option<&Path> = None;
        let stream_none = fs.list(prefix_none);
        let results_none: Vec<Result<ObjectMeta>> = stream_none.collect().await;
        assert!(results_none.is_empty());

        // Test list with invalid prefix (error handling)
        let prefix_invalid = Some(Path::from("invalid_prefix_that_will_cause_error"));
        let stream_invalid = fs.list(prefix_invalid.as_ref());
        let results_invalid: Vec<Result<ObjectMeta>> = stream_invalid.collect().await;
        assert!(results_invalid.is_empty());

        // Test list_with_delimiter
        let delimiter_result = fs.list_with_delimiter(prefix.as_ref()).await;
        assert!(delimiter_result.is_err());
        assert!(matches!(
            delimiter_result.unwrap_err(),
            object_store::Error::NotImplemented { .. }
        ));
    }

    #[tokio::test]
    async fn test_unimplemented_operations() {
        let fs = FS::new();
        let location = Path::from("test/file.txt");
        let from = Path::from("test/from.txt");
        let to = Path::from("test/to.txt");
        let payload = PutPayload::from(Bytes::from("test data"));
        let opts = PutOptions::default();
        let multipart_opts = PutMultipartOptions::default();

        // Test all operations that return NotImplemented
        let put_opts_result = fs.put_opts(&location, payload, opts).await;
        let put_multipart_opts_result = fs.put_multipart_opts(&location, multipart_opts).await;
        let copy_opts_result = fs.copy_opts(&from, &to, CopyOptions::default()).await;

        // All should return NotImplemented error
        assert!(matches!(
            put_opts_result.unwrap_err(),
            object_store::Error::NotImplemented { .. }
        ));
        assert!(matches!(
            put_multipart_opts_result.unwrap_err(),
            object_store::Error::NotImplemented { .. }
        ));
        assert!(matches!(
            copy_opts_result.unwrap_err(),
            object_store::Error::NotImplemented { .. }
        ));
    }

    #[test]
    fn test_format_location() {
        // Test the format_location function from the parent module
        let test_cases = [
            (
                "/test/$$/file.txt",
                ("".to_string(), Path::from("file.txt")),
            ),
            (
                "/test/account/::/file.txt",
                ("test/account".to_string(), Path::from("file.txt")),
            ),
            ("::/file.txt", ("".to_string(), Path::from("file.txt"))),
            (
                "/test/file.txt",
                ("".to_string(), Path::from("/test/file.txt")),
            ),
        ];

        for (input, expected) in &test_cases {
            let path = Path::from(*input);
            let result = super::format_location(&path);
            assert_eq!(result, *expected, "Failed for input: {input}");
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_concurrent_operations() {
        let fs = FS::new();
        let location = Path::from("test/concurrent.txt");
        let options1 = GetOptions::default();
        let options2 = GetOptions::default();

        // Test multiple concurrent get_opts operations
        let get_results = futures::future::join_all([
            fs.get_opts(&location, options1),
            fs.get_opts(&location, options2),
        ])
        .await;

        // All operations should fail with errors
        for result in get_results {
            assert!(result.is_err());
        }
    }

    #[tokio::test]
    async fn test_different_path_formats() {
        let fs = FS::new();
        let test_paths = [
            Path::from("simple.txt"),
            Path::from("/absolute/path/file.txt"),
            Path::from("nested/directory/file.txt"),
            Path::from("file with spaces.txt"),
            Path::from("file-with-special-chars@#$%.txt"),
        ];

        for path in &test_paths {
            let result = fs.get_opts(path, GetOptions::default()).await;
            assert!(result.is_err(), "Should fail for path: {path}");
        }
    }
}
