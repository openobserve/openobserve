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

use std::ops::Range;

use async_trait::async_trait;
use bytes::Bytes;
use futures::{StreamExt, stream::BoxStream};
use object_store::{
    CopyOptions, Error, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta,
    ObjectStore, PutMultipartOptions, PutOptions, PutPayload, PutResult, Result, path::Path,
};

use super::format_location;

/// File system with memory cache
#[derive(Debug, Default)]
pub struct FS {}

impl FS {
    pub fn name() -> &'static str {
        "Memory"
    }

    /// Create new memory storage.
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
        let (account, location) = format_location(location);
        infra::cache::storage::get_opts(&account, &location, options).await
    }

    async fn get_ranges(&self, location: &Path, ranges: &[Range<u64>]) -> Result<Vec<Bytes>> {
        if ranges.is_empty() {
            return Ok(Vec::new());
        }
        let (account, location) = format_location(location);
        if ranges.iter().any(|range| {
            range.start > range.end || usize::try_from(range.end - range.start).is_err()
        }) {
            return Err(infra::storage::Error::BadRange(location.to_string()).into());
        }
        let can_block = tokio::runtime::Handle::try_current().is_ok_and(|handle| {
            matches!(
                handle.runtime_flavor(),
                tokio::runtime::RuntimeFlavor::MultiThread
            )
        });
        if cfg!(unix)
            && can_block
            && ranges.iter().all(|range| range.start < range.end)
            && let Ok(bytes) = infra::cache::storage::get_ranges(&account, &location, ranges).await
        {
            return Ok(bytes);
        }
        infra::storage::coalesce_ranges_checked(
            ranges,
            |range| infra::cache::storage::get_range(&account, &location, range),
            object_store::OBJECT_STORE_COALESCE_DEFAULT,
        )
        .await
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
    use bytes::Bytes;
    use object_store::{GetOptions, PutOptions, PutPayload};

    use super::*;

    #[derive(Debug)]
    struct RangeTrackingStore {
        inner: object_store::memory::InMemory,
        range_calls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        option_calls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }

    impl std::fmt::Display for RangeTrackingStore {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("range-tracking")
        }
    }

    #[async_trait]
    impl ObjectStore for RangeTrackingStore {
        async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
            self.option_calls
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            self.inner.get_opts(location, options).await
        }

        async fn get_ranges(&self, location: &Path, ranges: &[Range<u64>]) -> Result<Vec<Bytes>> {
            self.range_calls
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let data = self
                .inner
                .get_opts(location, GetOptions::default())
                .await?
                .bytes()
                .await?;
            if ranges.iter().any(|range| range.end > data.len() as u64) {
                return Err(Error::Generic {
                    store: "RangeTrackingStore",
                    source: Box::new(std::io::Error::from(std::io::ErrorKind::UnexpectedEof)),
                });
            }
            Ok(ranges
                .iter()
                .map(|range| data.slice(range.start as usize..range.end as usize))
                .collect())
        }

        async fn put_opts(
            &self,
            location: &Path,
            payload: PutPayload,
            options: PutOptions,
        ) -> Result<PutResult> {
            self.inner.put_opts(location, payload, options).await
        }

        async fn put_multipart_opts(
            &self,
            location: &Path,
            options: PutMultipartOptions,
        ) -> Result<Box<dyn MultipartUpload>> {
            self.inner.put_multipart_opts(location, options).await
        }

        fn delete_stream(
            &self,
            locations: BoxStream<'static, Result<Path>>,
        ) -> BoxStream<'static, Result<Path>> {
            self.inner.delete_stream(locations)
        }

        fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
            self.inner.list(prefix)
        }

        async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
            self.inner.list_with_delimiter(prefix).await
        }

        async fn copy_opts(&self, from: &Path, to: &Path, options: CopyOptions) -> Result<()> {
            self.inner.copy_opts(from, to, options).await
        }
    }

    #[test]
    fn test_fs_constructors_and_traits() {
        // Test constructors and trait implementations
        let fs_new = FS::new();
        let fs_default = FS::default();
        let fs_direct = FS {};

        // All should display as "Memory"
        assert_eq!(fs_new.to_string(), FS::name());
        assert_eq!(fs_default.to_string(), FS::name());
        assert_eq!(fs_direct.to_string(), FS::name());

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
            Error::NotImplemented { .. }
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
            Error::NotImplemented { .. }
        ));
        assert!(matches!(
            put_multipart_opts_result.unwrap_err(),
            Error::NotImplemented { .. }
        ));
        assert!(matches!(
            copy_opts_result.unwrap_err(),
            Error::NotImplemented { .. }
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
    async fn range_tracking_fixture() -> (
        Path,
        std::sync::Arc<std::sync::atomic::AtomicUsize>,
        std::sync::Arc<std::sync::atomic::AtomicUsize>,
    ) {
        let id = config::ider::uuid();
        let key = Path::from(format!("files/{id}/logs/range_fixture"));
        let inner = object_store::memory::InMemory::new();
        inner
            .put_opts(
                &key,
                Bytes::from_static(b"0123456789abcdef").into(),
                PutOptions::default(),
            )
            .await
            .unwrap();
        let range_calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let option_calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        infra::storage::add_account(
            &id,
            Box::new(RangeTrackingStore {
                inner,
                range_calls: std::sync::Arc::clone(&range_calls),
                option_calls: std::sync::Arc::clone(&option_calls),
            }),
        )
        .await;
        let location = Path::from(format!("trace/$$/{id}:default/::/{key}"));
        (location, range_calls, option_calls)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_cache_inspection_skips_sample_gets_and_preserves_on_demand_fallback() {
        use std::sync::atomic::Ordering;

        use config::meta::search::ScanStats;

        use crate::file_cache::{cache_files, inspect_file_cache};

        for size in [16, i64::MAX] {
            let (location, range_calls, option_calls) = range_tracking_fixture().await;
            let (account, key) = format_location(&location);
            let key = key.to_string();
            let entries = [(
                0,
                &account,
                &key,
                size,
                chrono::Utc::now().timestamp_micros(),
            )];
            let mut stats = ScanStats {
                compressed_size: size,
                ..Default::default()
            };
            let (cached, hits, misses) =
                inspect_file_cache("blocks", &entries, &mut stats, "parquet").await;
            assert!(cached.is_empty());
            assert_eq!((hits, misses), (0, 1));
            assert_eq!(
                stats.querier_memory_cached_files + stats.querier_disk_cached_files,
                0
            );
            assert_eq!(option_calls.load(Ordering::Relaxed), 0);
            assert_eq!(range_calls.load(Ordering::Relaxed), 0);
            let payload = FS::new()
                .get_ranges(&location, &[0..8, 8..16])
                .await
                .unwrap();
            assert_eq!(
                payload,
                vec![
                    Bytes::from_static(b"01234567"),
                    Bytes::from_static(b"89abcdef")
                ]
            );
            assert_eq!(range_calls.load(Ordering::Relaxed), 1);
        }
        if config::get_config().memory_cache.enabled {
            let (location, _, option_calls) = range_tracking_fixture().await;
            let (account, key) = format_location(&location);
            let key = key.to_string();
            let entries = [(0, &account, &key, 16, chrono::Utc::now().timestamp_micros())];
            let mut stats = ScanStats {
                compressed_size: 16,
                ..Default::default()
            };
            cache_files("normal", &entries, &mut stats, "parquet").await;
            assert!(option_calls.load(Ordering::Relaxed) > 0);
            let mut inspected = ScanStats::default();
            let (cached, hits, misses) =
                inspect_file_cache("blocks", &entries, &mut inspected, "parquet").await;
            assert_eq!((cached.len(), hits, misses), (1, 1, 0));
            assert_eq!(inspected.querier_memory_cached_files, 1);
            infra::cache::file_data::memory::remove(&key).await.unwrap();
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_delegates_batch_and_preserves_order_and_scope() {
        let (location, range_calls, option_calls) = range_tracking_fixture().await;
        let ranges = [10..14, 1..5, 3..7, 1..5];
        let result = FS::new().get_ranges(&location, &ranges).await.unwrap();
        assert_eq!(
            result,
            vec![
                Bytes::from_static(b"abcd"),
                Bytes::from_static(b"1234"),
                Bytes::from_static(b"3456"),
                Bytes::from_static(b"1234"),
            ]
        );
        assert_eq!(
            range_calls.load(std::sync::atomic::Ordering::Relaxed),
            usize::from(cfg!(unix))
        );
        assert_eq!(
            option_calls.load(std::sync::atomic::Ordering::Relaxed),
            usize::from(!cfg!(unix))
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_empty_and_invalid_do_not_read_storage() {
        let (location, range_calls, option_calls) = range_tracking_fixture().await;
        let fs = FS::new();
        assert!(fs.get_ranges(&location, &[]).await.unwrap().is_empty());
        let invalid = Range { start: 7, end: 3 };
        assert!(fs.get_ranges(&location, &[invalid]).await.is_err());
        assert_eq!(range_calls.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(option_calls.load(std::sync::atomic::Ordering::Relaxed), 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_preserves_eof_clipping_after_batch_error() {
        let (location, range_calls, option_calls) = range_tracking_fixture().await;
        let result = FS::new()
            .get_ranges(&location, std::slice::from_ref(&(14..20)))
            .await
            .unwrap();
        assert_eq!(result, vec![Bytes::from_static(b"ef")]);
        assert_eq!(
            range_calls.load(std::sync::atomic::Ordering::Relaxed),
            usize::from(cfg!(unix))
        );
        assert_eq!(option_calls.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_huge_endpoint_is_clipped_without_huge_allocation() {
        let (location, ..) = range_tracking_fixture().await;
        let result = FS::new()
            .get_ranges(&location, std::slice::from_ref(&(14..u64::MAX)))
            .await;
        if usize::BITS == 64 {
            assert_eq!(result.unwrap(), vec![Bytes::from_static(b"ef")]);
        } else {
            assert!(result.is_err());
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_backend_error_survives_fallback() {
        let (location, range_calls, option_calls) = range_tracking_fixture().await;
        let missing = Path::from(format!("{location}-missing"));
        let error = FS::new()
            .get_ranges(&missing, std::slice::from_ref(&(1..3)))
            .await
            .unwrap_err();
        assert!(matches!(error, Error::NotFound { .. }));
        assert_eq!(
            range_calls.load(std::sync::atomic::Ordering::Relaxed),
            usize::from(cfg!(unix))
        );
        assert_eq!(option_calls.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn test_get_ranges_current_thread_keeps_async_fallback() {
        let (location, range_calls, option_calls) = range_tracking_fixture().await;
        let result = FS::new()
            .get_ranges(&location, std::slice::from_ref(&(1..3)))
            .await
            .unwrap();
        assert_eq!(result, vec![Bytes::from_static(b"12")]);
        assert_eq!(range_calls.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(option_calls.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_preserves_zero_width_subrange() {
        let (location, range_calls, option_calls) = range_tracking_fixture().await;
        let result = FS::new()
            .get_ranges(&location, &[1..3, 3..3])
            .await
            .unwrap();
        assert_eq!(result, vec![Bytes::from_static(b"12"), Bytes::new()]);
        assert_eq!(range_calls.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(option_calls.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_mixed_clipped_subranges_return_errors() {
        let (location, ..) = range_tracking_fixture().await;
        for ranges in [
            vec![1..3, 20..21, 3..3],
            vec![14..20, 16..17],
            vec![1..3, 20..20],
        ] {
            assert!(FS::new().get_ranges(&location, &ranges).await.is_err());
        }
    }

    #[cfg(all(not(unix), target_pointer_width = "64"))]
    #[tokio::test(flavor = "multi_thread")]
    async fn test_non_unix_large_disk_cache_range_uses_bounded_scalar_path() {
        let (location, range_calls, option_calls) = range_tracking_fixture().await;
        let (_, key) = format_location(&location);
        let key = key.to_string();
        assert!(config::get_config().disk_cache.enabled);
        infra::cache::file_data::disk::set(&key, Bytes::from_static(b"0123456789abcdef"))
            .await
            .unwrap();
        assert!(infra::cache::file_data::disk::exist(&key).await);
        let result = FS::new()
            .get_ranges(&location, std::slice::from_ref(&(0..(1_u64 << 40))))
            .await
            .unwrap();
        assert_eq!(result, vec![Bytes::from_static(b"0123456789abcdef")]);
        assert_eq!(range_calls.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(option_calls.load(std::sync::atomic::Ordering::Relaxed), 0);
        infra::cache::file_data::disk::remove(&key).await.unwrap();
    }
}
