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

#[cfg(unix)]
use std::{ops::Range, path::PathBuf};

use async_trait::async_trait;
#[cfg(unix)]
use bytes::Bytes;
use config::metrics;
use futures::{StreamExt, stream::BoxStream};
use object_store::{
    CopyOptions, Error, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta,
    ObjectStore, PutMultipartOptions, PutOptions, PutPayload, PutResult, Result, limit::LimitStore,
    local::LocalFileSystem, path::Path,
};

use crate::storage::{CONCURRENT_REQUESTS, format_key};

pub struct Local {
    client: LimitStore<Box<dyn object_store::ObjectStore>>,
    #[cfg(unix)]
    root_dir: PathBuf,
    with_prefix: bool,
}

impl Local {
    pub fn name() -> &'static str {
        "local"
    }

    pub fn new(root_dir: &str, with_prefix: bool) -> Self {
        Self {
            client: LimitStore::new(init_client(root_dir), CONCURRENT_REQUESTS),
            #[cfg(unix)]
            root_dir: PathBuf::from(root_dir),
            with_prefix,
        }
    }

    #[cfg(unix)]
    async fn get_ranges_fallback(
        &self,
        location: &Path,
        ranges: &[Range<u64>],
    ) -> Result<Vec<Bytes>> {
        super::coalesce_ranges_checked(
            ranges,
            |range| async move {
                self.client
                    .get_opts(
                        location,
                        GetOptions {
                            range: Some(range.into()),
                            ..Default::default()
                        },
                    )
                    .await?
                    .bytes()
                    .await
            },
            object_store::OBJECT_STORE_COALESCE_DEFAULT,
        )
        .await
    }
}

impl Default for Local {
    fn default() -> Self {
        Local::new(&config::get_config().common.data_stream_dir, true)
    }
}

impl std::fmt::Debug for Local {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("storage for local disk")
    }
}

impl std::fmt::Display for Local {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("storage for local disk")
    }
}

#[async_trait]
impl ObjectStore for Local {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let data_size = payload.content_length();
        match self
            .client
            .put_opts(&(format_key(&file, self.with_prefix).into()), payload, opts)
            .await
        {
            Ok(_output) => {
                // metrics
                let columns = file.split('/').collect::<Vec<&str>>();
                if columns[0] == "files" {
                    metrics::STORAGE_WRITE_BYTES
                        .with_label_values(&[columns[1], columns[2], "local"])
                        .inc_by(data_size as u64);
                    metrics::STORAGE_WRITE_REQUESTS
                        .with_label_values(&[columns[1], columns[2], "local"])
                        .inc();
                    let time = start.elapsed().as_secs_f64();
                    metrics::STORAGE_TIME
                        .with_label_values(&[columns[1], columns[2], "put", "local"])
                        .inc_by(time);
                }
                Ok(PutResult {
                    e_tag: None,
                    version: None,
                })
            }
            Err(err) => {
                log::error!("disk File upload error: {err:?}");
                Err(err)
            }
        }
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.client
            .put_multipart_opts(
                &(format_key(location.as_ref(), self.with_prefix).into()),
                opts,
            )
            .await
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let result = self
            .client
            .get_opts(&(format_key(&file, self.with_prefix).into()), options)
            .await
            .map_err(|e| {
                log::error!("[STORAGE] get_opts local file: {file}, error: {e:?}");
                e
            })?;

        // metrics — use the actual returned range size, not the full file
        // size. For range / suffix GETs `result.meta.size` is the total file
        // length, which would over-count bytes by ~the file size each call.
        let mut data_len = result.range.end - result.range.start;
        if data_len == 0 {
            data_len = result.meta.size;
        }
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "get_opts", "local"])
                .inc_by(data_len);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "get_opts", "local"])
                .inc();
            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "get_opts", "local"])
                .inc_by(time);
        }

        Ok(result)
    }

    #[cfg(unix)]
    async fn get_ranges(&self, location: &Path, ranges: &[Range<u64>]) -> Result<Vec<Bytes>> {
        if ranges.is_empty() {
            return Ok(Vec::new());
        }
        if ranges.iter().any(|range| {
            range.start > range.end || usize::try_from(range.end - range.start).is_err()
        }) {
            return Err(super::Error::BadRange(location.to_string()).into());
        }
        let start = std::time::Instant::now();
        let file = location.to_string();
        let location = Path::from(format_key(&file, self.with_prefix));
        let can_block = tokio::runtime::Handle::try_current().is_ok_and(|handle| {
            matches!(
                handle.runtime_flavor(),
                tokio::runtime::RuntimeFlavor::MultiThread
            )
        });
        let results = if can_block && ranges.iter().all(|range| range.start < range.end) {
            let full_path = self.root_dir.join(location.as_ref());
            // Keep the open and all reads in one blocking section: going through
            // the async client adds a spawn_blocking round trip per batch.
            tokio::task::block_in_place(|| {
                let handle = std::fs::File::open(&full_path)?;
                super::read_ranges_from_file(&handle, ranges)
            })
            .map_err(|error| {
                log::error!("[STORAGE] get_ranges local file: {file}, error: {error:?}");
                if error.kind() == std::io::ErrorKind::NotFound {
                    Error::NotFound {
                        path: file.clone(),
                        source: Box::new(error),
                    }
                } else {
                    Error::Generic {
                        store: "LocalFileSystem",
                        source: Box::new(error),
                    }
                }
            })?
        } else {
            self.get_ranges_fallback(&location, ranges).await?
        };

        // Returned lengths account for EOF clipping.
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns.len() >= 3 && columns[0] == "files" {
            let total_bytes: u64 = results.iter().map(|bytes| bytes.len() as u64).sum();
            let n = ranges.len() as u64;
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "get_ranges", "local"])
                .inc_by(total_bytes);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "get_ranges", "local"])
                .inc_by(n);
            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "get_ranges", "local"])
                .inc_by(time);
        }

        Ok(results)
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        let with_prefix = self.with_prefix;
        let formatted = locations
            .map(move |result| result.map(|path| format_key(path.as_ref(), with_prefix).into()))
            .boxed();
        self.client.delete_stream(formatted)
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        let key = prefix.map(|p| p.as_ref());
        let prefix = format_key(key.unwrap_or(""), self.with_prefix);
        self.client.list(Some(&prefix.into()))
    }

    async fn list_with_delimiter(&self, _prefix: Option<&Path>) -> Result<ListResult> {
        Err(Error::NotImplemented {
            operation: "list_with_delimiter".to_string(),
            implementer: Self::name().to_string(),
        })
    }

    async fn copy_opts(&self, _from: &Path, _to: &Path, _options: CopyOptions) -> Result<()> {
        Err(Error::NotImplemented {
            operation: "copy_opts".to_string(),
            implementer: Self::name().to_string(),
        })
    }
}

fn init_client(root_dir: &str) -> Box<dyn object_store::ObjectStore> {
    Box::new(
        LocalFileSystem::new_with_prefix(std::path::Path::new(root_dir).to_str().unwrap())
            .expect("Error creating local file system"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_local(root: &str, with_prefix: bool) -> Local {
        Local::new(root, with_prefix)
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_mixed_eof_and_zero_width_returns_error() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("ranges"), b"0123456789abcdef").unwrap();
        let store = Local::new(directory.path().to_str().unwrap(), false);
        assert!(
            store
                .get_ranges(&Path::from("ranges"), &[1..3, 20..21, 3..3])
                .await
                .is_err()
        );
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn test_get_ranges_current_thread_rejects_clipped_subrange_starts() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("ranges"), b"0123456789abcdef").unwrap();
        let store = Local::new(directory.path().to_str().unwrap(), false);
        for ranges in [
            vec![1..3, 20..21, 3..3],
            vec![14..20, 16..17],
            vec![1..3, 20..20],
        ] {
            assert!(
                store
                    .get_ranges(&Path::from("ranges"), &ranges)
                    .await
                    .is_err()
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn test_get_ranges_current_thread_matches_bounded_backend() {
        for prefix in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let store = Local::new(directory.path().to_str().unwrap(), prefix);
            let reference = object_store::memory::InMemory::new();
            let location = Path::from("ranges");
            for backend in [&store as &dyn ObjectStore, &reference as &dyn ObjectStore] {
                backend
                    .put_opts(
                        &location,
                        Bytes::from_static(b"0123456789abcdef").into(),
                        PutOptions::default(),
                    )
                    .await
                    .unwrap();
            }
            let mut cases = vec![vec![10..14, 1..5, 3..7, 1..5, 14..20], vec![1..3, 3..3]];
            if usize::BITS == 64 {
                cases.push(std::iter::once(14..u64::MAX).collect());
            }
            for ranges in cases {
                let expected = object_store::coalesce_ranges(
                    &ranges,
                    |range| object_store::ObjectStoreExt::get_range(&reference, &location, range),
                    object_store::OBJECT_STORE_COALESCE_DEFAULT,
                )
                .await
                .unwrap();
                if ranges == [1..3, 3..3] {
                    assert_eq!(expected, vec![Bytes::from_static(b"12"), Bytes::new()]);
                }
                assert_eq!(
                    store.get_ranges(&location, &ranges).await.unwrap(),
                    expected
                );
            }
            for range in [Range { start: 7, end: 3 }, 3..3, 16..17] {
                assert!(
                    store
                        .get_ranges(&location, std::slice::from_ref(&range))
                        .await
                        .is_err()
                );
            }
            assert!(
                store
                    .get_ranges(&Path::from("missing"), &[])
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_zero_width_uses_async_coalescing() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("ranges"), b"0123456789abcdef").unwrap();
        let store = Local::new(directory.path().to_str().unwrap(), false);
        assert_eq!(
            store
                .get_ranges(&Path::from("ranges"), &[1..3, 3..3])
                .await
                .unwrap(),
            vec![Bytes::from_static(b"12"), Bytes::new()]
        );
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_preserves_root_and_missing_file_error() {
        let directory = tempfile::tempdir().unwrap();
        let account = directory.path().join("account");
        std::fs::create_dir(&account).unwrap();
        std::fs::write(directory.path().join("ranges"), b"outside").unwrap();
        std::fs::write(account.join("ranges"), b"inside").unwrap();
        let store = Local::new(account.to_str().unwrap(), false);
        assert_eq!(
            store
                .get_ranges(&Path::from("ranges"), &[0..2, 2..6])
                .await
                .unwrap(),
            vec![Bytes::from_static(b"in"), Bytes::from_static(b"side")]
        );
        assert!(matches!(
            store
                .get_ranges(&Path::from("missing"), std::slice::from_ref(&(0..1)))
                .await
                .unwrap_err(),
            Error::NotFound { .. }
        ));
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_counts_clipped_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let org = config::ider::uuid();
        let location = Path::from(format!("files/{org}/logs/ranges"));
        let store = Local::new(directory.path().to_str().unwrap(), false);
        store
            .put_opts(
                &location,
                Bytes::from_static(b"0123456789abcdef").into(),
                PutOptions::default(),
            )
            .await
            .unwrap();
        let bytes =
            metrics::STORAGE_READ_BYTES.with_label_values(&[&org, "logs", "get_ranges", "local"]);
        let requests = metrics::STORAGE_READ_REQUESTS.with_label_values(&[
            &org,
            "logs",
            "get_ranges",
            "local",
        ]);
        let before = (bytes.get(), requests.get());
        assert_eq!(
            store.get_ranges(&location, &[14..20, 1..3]).await.unwrap(),
            vec![Bytes::from_static(b"ef"), Bytes::from_static(b"12")]
        );
        assert_eq!((bytes.get(), requests.get()), (before.0 + 4, before.1 + 2));
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_preserves_bounded_reads_and_empty_request() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("ranges"), b"0123456789abcdef").unwrap();
        let store = Local::new(directory.path().to_str().unwrap(), false);
        let location = Path::from("ranges");
        let ranges = [10..14, 1..5, 3..7, 1..5, 14..20];
        let actual = store.get_ranges(&location, &ranges).await.unwrap();
        for (range, bytes) in ranges.into_iter().zip(actual) {
            let options = GetOptions {
                range: Some(range.into()),
                ..Default::default()
            };
            assert_eq!(
                bytes,
                store
                    .get_opts(&location, options)
                    .await
                    .unwrap()
                    .bytes()
                    .await
                    .unwrap()
            );
        }
        assert!(
            store
                .get_ranges(&Path::from("missing"), &[])
                .await
                .unwrap()
                .is_empty()
        );
        let invalid = Range { start: 7, end: 3 };
        assert!(store.get_ranges(&location, &[invalid]).await.is_err());
        assert!(
            store
                .get_ranges(&location, std::slice::from_ref(&(16..17)))
                .await
                .is_err()
        );
        if usize::BITS == 64 {
            assert_eq!(
                store
                    .get_ranges(&location, std::slice::from_ref(&(14..u64::MAX)))
                    .await
                    .unwrap(),
                vec![Bytes::from_static(b"ef")]
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_fast_path_bypasses_client_admission() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("ranges"), b"0123456789abcdef").unwrap();
        let store = Local {
            client: LimitStore::new(init_client(directory.path().to_str().unwrap()), 0),
            root_dir: directory.path().to_path_buf(),
            with_prefix: false,
        };
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            store.get_ranges(&Path::from("ranges"), &[1..3, 5..7]),
        )
        .await
        .expect("local batch unexpectedly waited for client admission")
        .unwrap();
        assert_eq!(
            result,
            vec![Bytes::from_static(b"12"), Bytes::from_static(b"56")]
        );
    }

    #[test]
    fn test_name_returns_local() {
        assert_eq!(Local::name(), "local");
    }

    #[test]
    fn test_display_format() {
        let l = make_local("/tmp", false);
        assert_eq!(format!("{l}"), "storage for local disk");
    }

    #[test]
    fn test_debug_format() {
        let l = make_local("/tmp", false);
        let s = format!("{l:?}");
        assert!(s.contains("storage for local disk"));
    }

    #[test]
    fn test_new_stores_with_prefix_flag() {
        let l_true = make_local("/tmp", true);
        assert!(l_true.with_prefix);
        let l_false = make_local("/tmp", false);
        assert!(!l_false.with_prefix);
    }
}
