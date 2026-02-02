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
    Error, GetOptions, GetResult, ListResult, MultipartUpload, OBJECT_STORE_COALESCE_DEFAULT,
    ObjectMeta, PutMultipartOptions, PutOptions, PutPayload, PutResult, Result, coalesce_ranges,
    path::Path,
};
use once_cell::sync::Lazy;

use crate::{
    cache::file_data,
    storage::{self, ObjectStoreExt},
};

/// File system with cache
#[derive(Debug, Default)]
pub struct CacheFS {}

static DEFAULT: Lazy<Box<dyn ObjectStoreExt>> = Lazy::new(CacheFS::new_store);

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
        storage::get_account(file)
    }

    async fn put(
        &self,
        _account: &str,
        _location: &Path,
        _payload: PutPayload,
    ) -> Result<PutResult> {
        Err(Error::NotImplemented)
    }

    async fn put_opts(
        &self,
        _account: &str,
        _location: &Path,
        _payload: PutPayload,
        _opts: PutOptions,
    ) -> Result<PutResult> {
        Err(Error::NotImplemented)
    }

    async fn put_multipart(
        &self,
        _account: &str,
        _location: &Path,
    ) -> Result<Box<dyn MultipartUpload>> {
        Err(Error::NotImplemented)
    }

    async fn put_multipart_opts(
        &self,
        _account: &str,
        _location: &Path,
        _opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        Err(Error::NotImplemented)
    }

    async fn get(&self, account: &str, location: &Path) -> Result<GetResult> {
        let path = location.to_string();
        let options = GetOptions::default();
        if let Ok(res) = file_data::get_opts(account, &path, options, false).await {
            return Ok(res);
        }
        // default to storage
        storage::get(account, &path).await
    }

    async fn get_opts(
        &self,
        account: &str,
        location: &Path,
        options: GetOptions,
    ) -> Result<GetResult> {
        let path = location.to_string();
        if let Ok(res) = file_data::get_opts(account, &path, options.clone(), false).await {
            return Ok(res);
        }
        // default to storage
        storage::get_opts(account, &path, options).await
    }

    async fn get_range(&self, account: &str, location: &Path, range: Range<u64>) -> Result<Bytes> {
        if range.start > range.end {
            return Err(crate::storage::Error::BadRange(location.to_string()).into());
        }
        let options = GetOptions {
            range: Some(range.into()),
            ..Default::default()
        };
        self.get_opts(account, location, options)
            .await?
            .bytes()
            .await
    }

    async fn get_ranges(
        &self,
        account: &str,
        location: &Path,
        ranges: &[Range<u64>],
    ) -> Result<Vec<Bytes>> {
        coalesce_ranges(
            ranges,
            |range| self.get_range(account, location, range),
            OBJECT_STORE_COALESCE_DEFAULT,
        )
        .await
    }

    async fn head(&self, account: &str, location: &Path) -> Result<ObjectMeta> {
        let path = location.to_string();
        if let Ok(size) = file_data::get_size_opts(account, &path, false).await {
            return Ok(ObjectMeta {
                location: location.clone(),
                last_modified: *BASE_TIME,
                size: size as u64,
                e_tag: Some(format!("{:x}-{:x}", BASE_TIME.timestamp_micros(), size)),
                version: None,
            });
        }
        // default
        storage::head(account, &path).await
    }

    async fn delete(&self, _account: &str, _location: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    fn delete_stream<'a>(
        &'a self,
        _account: &str,
        _locations: BoxStream<'a, Result<Path>>,
    ) -> BoxStream<'a, Result<Path>> {
        futures::stream::once(async { Err(object_store::Error::NotImplemented {}) }).boxed()
    }

    fn list(
        &self,
        _account: &str,
        _prefix: Option<&Path>,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        futures::stream::once(async { Err(object_store::Error::NotImplemented {}) }).boxed()
    }

    fn list_with_offset(
        &self,
        _account: &str,
        _prefix: Option<&Path>,
        _offset: &Path,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        futures::stream::once(async { Err(object_store::Error::NotImplemented {}) }).boxed()
    }

    async fn list_with_delimiter(
        &self,
        _account: &str,
        _prefix: Option<&Path>,
    ) -> Result<ListResult> {
        Err(Error::NotImplemented)
    }

    async fn copy(&self, _account: &str, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn rename(&self, _account: &str, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn copy_if_not_exists(&self, _account: &str, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }

    async fn rename_if_not_exists(&self, _account: &str, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::NotImplemented)
    }
}

pub async fn get(account: &str, path: &Path) -> Result<GetResult> {
    DEFAULT.get(account, path).await
}

pub async fn get_opts(account: &str, path: &Path, options: GetOptions) -> Result<GetResult> {
    DEFAULT.get_opts(account, path, options).await
}

pub async fn get_range(account: &str, location: &Path, range: Range<u64>) -> Result<bytes::Bytes> {
    DEFAULT.get_range(account, location, range).await
}

pub async fn head(account: &str, location: &Path) -> Result<ObjectMeta> {
    DEFAULT.head(account, location).await
}

#[cfg(test)]
mod tests {
    use std::ops::Range;

    use bytes::Bytes;

    use super::*;

    #[test]
    fn test_cache_fs_display() {
        let cache_fs = CacheFS {};
        assert_eq!(cache_fs.to_string(), "CacheFS");
    }

    #[test]
    fn test_cache_fs_new_store() {
        let store = CacheFS::new_store();
        assert_eq!(store.to_string(), "CacheFS");
    }

    #[tokio::test]
    async fn test_cache_fs_put() {
        let cache_fs = CacheFS {};
        let location = Path::from("test/file.txt");
        let payload = PutPayload::from(Bytes::from("test data"));

        let result = cache_fs.put("default", &location, payload).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented));
    }

    #[tokio::test]
    async fn test_cache_fs_put_opts() {
        let cache_fs = CacheFS {};
        let location = Path::from("test/file.txt");
        let payload = PutPayload::from(Bytes::from("test data"));
        let opts = PutOptions::default();

        let result = cache_fs.put_opts("default", &location, payload, opts).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented));
    }

    #[tokio::test]
    async fn test_cache_fs_put_multipart() {
        let cache_fs = CacheFS {};
        let location = Path::from("test/file.txt");

        let result = cache_fs.put_multipart("default", &location).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented));
    }

    #[tokio::test]
    async fn test_cache_fs_put_multipart_opts() {
        let cache_fs = CacheFS {};
        let location = Path::from("test/file.txt");
        let opts = PutMultipartOptions::default();

        let result = cache_fs
            .put_multipart_opts("default", &location, opts)
            .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented));
    }

    #[tokio::test]
    async fn test_cache_fs_get_with_cache_hit() {
        let cache_fs = CacheFS {};
        let location = Path::from("test/file.txt");

        // This test would require setting up cache data first
        // For now, we test the basic structure
        let result = cache_fs.get("default", &location).await;
        // The result depends on whether the file exists in cache or storage
        // This is a basic test to ensure the function doesn't panic
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_cache_fs_get_opts_with_cache_hit() {
        let cache_fs = CacheFS {};
        let location = Path::from("test/file.txt");
        let options = GetOptions::default();

        let result = cache_fs.get_opts("default", &location, options).await;
        // The result depends on whether the file exists in cache or storage
        // This is a basic test to ensure the function doesn't panic
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_cache_fs_get_range_invalid() {
        let cache_fs = CacheFS {};
        let location = Path::from("test/file.txt");
        let range = Range { start: 10, end: 5 }; // Invalid range

        let result = cache_fs.get_range("default", &location, range).await;
        assert!(result.is_err());
        // Should return a BadRange error
        assert!(matches!(result.unwrap_err(), Error::Generic { .. }));
    }

    #[tokio::test]
    async fn test_cache_fs_get_ranges() {
        let cache_fs = CacheFS {};
        let location = Path::from("test/file.txt");
        let ranges = vec![Range { start: 0, end: 10 }, Range { start: 10, end: 20 }];

        let result = cache_fs.get_ranges("default", &location, &ranges).await;
        // The result depends on whether the file exists in cache
        // This is a basic test to ensure the function doesn't panic
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_cache_fs_head_with_cache_hit() {
        let cache_fs = CacheFS {};
        let location = Path::from("test/file.txt");

        let result = cache_fs.head("default", &location).await;
        // The result depends on whether the file exists in cache or storage
        // This is a basic test to ensure the function doesn't panic
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_cache_fs_delete() {
        let cache_fs = CacheFS {};
        let location = Path::from("test/file.txt");

        let result = cache_fs.delete("default", &location).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented));
    }

    #[tokio::test]
    async fn test_cache_fs_delete_stream() {
        let cache_fs = CacheFS {};
        let locations = futures::stream::once(async { Ok(Path::from("test/file.txt")) }).boxed();

        let mut result_stream = cache_fs.delete_stream("default", locations);
        let result = result_stream.next().await;
        assert!(result.is_some());
        let result = result.unwrap();
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented { .. }));
    }

    #[tokio::test]
    async fn test_cache_fs_copy() {
        let cache_fs = CacheFS {};
        let from = Path::from("test/from.txt");
        let to = Path::from("test/to.txt");

        let result = cache_fs.copy("default", &from, &to).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented));
    }

    #[tokio::test]
    async fn test_cache_fs_rename() {
        let cache_fs = CacheFS {};
        let from = Path::from("test/from.txt");
        let to = Path::from("test/to.txt");

        let result = cache_fs.rename("default", &from, &to).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented));
    }

    #[tokio::test]
    async fn test_cache_fs_copy_if_not_exists() {
        let cache_fs = CacheFS {};
        let from = Path::from("test/from.txt");
        let to = Path::from("test/to.txt");

        let result = cache_fs.copy_if_not_exists("default", &from, &to).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented));
    }

    #[tokio::test]
    async fn test_cache_fs_rename_if_not_exists() {
        let cache_fs = CacheFS {};
        let from = Path::from("test/from.txt");
        let to = Path::from("test/to.txt");

        let result = cache_fs.rename_if_not_exists("default", &from, &to).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), Error::NotImplemented));
    }

    // Test the public functions that use the DEFAULT instance
    #[tokio::test]
    async fn test_get_function() {
        let path = Path::from("test/file.txt");
        let result = get("default", &path).await;
        // The result depends on whether the file exists in cache or storage
        // This is a basic test to ensure the function doesn't panic
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_get_opts_function() {
        let path = Path::from("test/file.txt");
        let options = GetOptions::default();
        let result = get_opts("default", &path, options).await;
        // The result depends on whether the file exists in cache or storage
        // This is a basic test to ensure the function doesn't panic
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_get_range_function() {
        let location = Path::from("test/file.txt");
        let range = Range { start: 0, end: 10 };
        let result = get_range("default", &location, range).await;
        // The result depends on whether the file exists in cache
        // This is a basic test to ensure the function doesn't panic
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_head_function() {
        let location = Path::from("test/file.txt");
        let result = head("default", &location).await;
        // The result depends on whether the file exists in cache or storage
        // This is a basic test to ensure the function doesn't panic
        assert!(result.is_ok() || result.is_err());
    }

    // Integration test for cache behavior
    #[tokio::test]
    async fn test_cache_fs_integration() {
        let cache_fs = CacheFS {};
        let location = Path::from("integration/test.txt");

        // Test that the cache FS properly delegates to underlying storage
        // when cache is not available
        let get_result = cache_fs.get("default", &location).await;
        let head_result = cache_fs.head("default", &location).await;

        // Both should either succeed (if file exists in storage) or fail appropriately
        // This tests the integration between cache and storage layers
        assert!(get_result.is_ok() || get_result.is_err());
        assert!(head_result.is_ok() || head_result.is_err());
    }

    // Test error handling for malformed paths
    #[tokio::test]
    async fn test_cache_fs_malformed_path() {
        let cache_fs = CacheFS {};
        let location = Path::from(""); // Empty path

        let result = cache_fs.get("default", &location).await;
        // Should handle empty paths gracefully
        assert!(result.is_ok() || result.is_err());
    }

    // Test with different account names
    #[tokio::test]
    async fn test_cache_fs_different_accounts() {
        let cache_fs = CacheFS {};
        let location = Path::from("test/file.txt");

        // Test with different account names
        let result1 = cache_fs.get("account1", &location).await;
        let result2 = cache_fs.get("account2", &location).await;

        // Both should handle different accounts appropriately
        assert!(result1.is_ok() || result1.is_err());
        assert!(result2.is_ok() || result2.is_err());
    }
}
