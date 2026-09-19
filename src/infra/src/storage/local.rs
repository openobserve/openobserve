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
use std::ops::Range;

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
    with_prefix: bool,
}

impl Local {
    pub fn name() -> &'static str {
        "local"
    }

    pub fn new(root_dir: &str, with_prefix: bool) -> Self {
        Self {
            client: LimitStore::new(init_client(root_dir), CONCURRENT_REQUESTS),
            with_prefix,
        }
    }

    pub(super) async fn try_open_file(&self, location: &Path) -> Result<Option<super::LocalFile>> {
        let start = std::time::Instant::now();
        let key = location.to_string();
        let result = self
            .client
            .get_opts(
                &Path::from(format_key(&key, self.with_prefix)),
                GetOptions::default(),
            )
            .await?;
        let object_store::GetResultPayload::File(file, _) = result.payload else {
            return Ok(None);
        };
        let columns = key.split('/').collect::<Vec<_>>();
        if columns.len() >= 3 && columns[0] == "files" {
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "open_local_file", "local"])
                .inc();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "open_local_file", "local"])
                .inc_by(start.elapsed().as_secs_f64());
        }
        Ok(Some(super::LocalFile {
            file,
            meta: result.meta,
        }))
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

    /// Read multiple byte ranges using a single file open and N `pread` calls,
    /// all inside one `block_in_place`.
    ///
    /// This is the hot path for Parquet column-chunk reads (DataFusion issues
    /// multiple ranges per row-group). Opening the file once and batching all
    /// reads in a single blocking section avoids per-range thread scheduling
    /// overhead and repeated file-open cost.
    #[cfg(unix)]
    async fn get_ranges(&self, location: &Path, ranges: &[Range<u64>]) -> Result<Vec<Bytes>> {
        if ranges.is_empty() {
            return Ok(Vec::new());
        }
        let start = std::time::Instant::now();
        let file = location.to_string();
        let location = Path::from(format_key(&file, self.with_prefix));
        let result = self
            .client
            .get_opts(&location, GetOptions::default())
            .await?;
        let results = match result.payload {
            object_store::GetResultPayload::File(handle, _) => {
                tokio::task::block_in_place(|| super::read_ranges_from_file(&handle, ranges))
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
            }
            object_store::GetResultPayload::Stream(stream) => {
                drop(stream);
                self.client.get_ranges(&location, ranges).await?
            }
        };

        // metrics — count one read per input range so the counter reflects
        // actual pread calls, not just the outer batched API call.
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

    #[tokio::test(flavor = "current_thread")]
    async fn test_try_open_file_preserves_prefix_path_validation_and_readonly_mode() {
        use std::io::Write;
        for prefix in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let store = Local::new(directory.path().to_str().unwrap(), prefix);
            let key = Path::from("nested/object");
            store
                .put_opts(
                    &key,
                    bytes::Bytes::from_static(b"native").into(),
                    PutOptions::default(),
                )
                .await
                .unwrap();
            let opened = store.try_open_file(&key).await.unwrap().unwrap();
            let normal = store.get_opts(&key, GetOptions::default()).await.unwrap();
            assert_eq!(opened.meta, normal.meta);
            assert_eq!(opened.file.metadata().unwrap().len(), 6);
            assert!((&opened.file).write_all(b"overwrite").is_err());
            let formatted = format_key(key.as_ref(), prefix);
            assert!(directory.path().join(formatted).is_file());
            let invalid = Path::ROOT;
            let expected = store
                .get_opts(&invalid, GetOptions::default())
                .await
                .unwrap_err();
            let actual = store.try_open_file(&invalid).await.unwrap_err();
            assert_eq!(actual.to_string(), expected.to_string());
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn test_try_open_file_records_open_without_counting_whole_body() {
        let directory = tempfile::tempdir().unwrap();
        let store = Local::new(directory.path().to_str().unwrap(), false);
        let org = directory.path().file_name().unwrap().to_str().unwrap();
        let key = Path::from(format!("files/{org}/midx/test"));
        store
            .put_opts(
                &key,
                bytes::Bytes::from_static(b"body-not-read").into(),
                PutOptions::default(),
            )
            .await
            .unwrap();
        let labels = &[org, "midx", "open_local_file", "local"];
        let requests = metrics::STORAGE_READ_REQUESTS.with_label_values(labels);
        let body = metrics::STORAGE_READ_BYTES.with_label_values(labels);
        let before = requests.get();
        let bytes_before = body.get();
        let opened = store.try_open_file(&key).await.unwrap().unwrap();
        assert_eq!(opened.meta.size, 13);
        assert_eq!(requests.get(), before + 1);
        assert_eq!(body.get(), bytes_before);
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn test_try_open_file_survives_atomic_replace_and_unlink() {
        use std::os::unix::fs::FileExt;
        let directory = tempfile::tempdir().unwrap();
        let store = Local::new(directory.path().to_str().unwrap(), false);
        let key = Path::from("immutable");
        store
            .put_opts(
                &key,
                Bytes::from_static(b"old").into(),
                PutOptions::default(),
            )
            .await
            .unwrap();
        let old = store.try_open_file(&key).await.unwrap().unwrap();
        store
            .put_opts(
                &key,
                Bytes::from_static(b"new").into(),
                PutOptions::default(),
            )
            .await
            .unwrap();
        let new = store.try_open_file(&key).await.unwrap().unwrap();
        object_store::ObjectStoreExt::delete(&store, &key)
            .await
            .unwrap();
        assert!(store.try_open_file(&key).await.is_err());
        let mut bytes = [0; 3];
        old.file.read_exact_at(&mut bytes, 0).unwrap();
        assert_eq!(&bytes, b"old");
        new.file.read_exact_at(&mut bytes, 0).unwrap();
        assert_eq!(&bytes, b"new");
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
    #[derive(Debug)]
    struct GatedLocalStore {
        inner: LocalFileSystem,
        calls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        entered: std::sync::Arc<tokio::sync::Notify>,
        release: std::sync::Arc<tokio::sync::Notify>,
    }

    #[cfg(unix)]
    impl std::fmt::Display for GatedLocalStore {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("gated-local")
        }
    }

    #[cfg(unix)]
    #[async_trait]
    impl ObjectStore for GatedLocalStore {
        async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
            if self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                self.entered.notify_one();
                self.release.notified().await;
            }
            self.inner.get_opts(location, options).await
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

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    async fn test_try_open_file_shares_admission_and_releases_on_cancellation() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("object"), b"data").unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let backend = GatedLocalStore {
            inner: LocalFileSystem::new_with_prefix(directory.path()).unwrap(),
            calls: Arc::clone(&calls),
            entered: Arc::new(tokio::sync::Notify::new()),
            release: Arc::new(tokio::sync::Notify::new()),
        };
        let store = Local {
            client: LimitStore::new(Box::new(backend) as Box<dyn ObjectStore>, 1),
            with_prefix: false,
        };
        let key = Path::from("object");
        let mut blocked_get = Box::pin(store.client.get_opts(&key, GetOptions::default()));
        assert!(futures::poll!(blocked_get.as_mut()).is_pending());
        let mut waiting_open = Box::pin(store.try_open_file(&key));
        assert!(futures::poll!(waiting_open.as_mut()).is_pending());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        drop(waiting_open);
        drop(blocked_get);
        let opened =
            tokio::time::timeout(std::time::Duration::from_secs(5), store.try_open_file(&key))
                .await
                .unwrap()
                .unwrap()
                .unwrap();
        // Holding the returned file must not hold the open/metadata permit.
        let second =
            tokio::time::timeout(std::time::Duration::from_secs(5), store.try_open_file(&key))
                .await
                .unwrap()
                .unwrap()
                .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert_eq!(opened.meta.size, second.meta.size);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn test_try_open_file_drops_unexpected_stream_permit() {
        let memory = object_store::memory::InMemory::new();
        let key = Path::from("object");
        memory
            .put_opts(
                &key,
                bytes::Bytes::from_static(b"data").into(),
                PutOptions::default(),
            )
            .await
            .unwrap();
        let store = Local {
            client: LimitStore::new(Box::new(memory) as Box<dyn ObjectStore>, 1),
            with_prefix: false,
        };
        assert!(store.try_open_file(&key).await.unwrap().is_none());
        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(5), store.try_open_file(&key))
                .await
                .unwrap()
                .unwrap()
                .is_none()
        );
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_shares_open_admission_with_get_opts() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };

        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("ranges"), b"0123456789abcdef").unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let entered = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let backend = GatedLocalStore {
            inner: LocalFileSystem::new_with_prefix(directory.path()).unwrap(),
            calls: Arc::clone(&calls),
            entered: Arc::clone(&entered),
            release: Arc::clone(&release),
        };
        let store = Arc::new(Local {
            client: LimitStore::new(Box::new(backend) as Box<dyn ObjectStore>, 1),
            with_prefix: false,
        });
        let blocker = tokio::spawn({
            let store = Arc::clone(&store);
            async move {
                store
                    .client
                    .get_opts(&Path::from("ranges"), GetOptions::default())
                    .await
            }
        });
        entered.notified().await;
        let location = Path::from("ranges");
        let ranges = [1..3, 5..7];
        let mut batch = Box::pin(store.get_ranges(&location, &ranges));
        assert!(futures::poll!(batch.as_mut()).is_pending());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        release.notify_one();
        let opened = blocker.await.unwrap().unwrap();
        assert!(matches!(
            &opened.payload,
            object_store::GetResultPayload::File(..)
        ));
        assert_eq!(
            batch.await.unwrap(),
            vec![Bytes::from_static(b"12"), Bytes::from_static(b"56")]
        );
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        drop(opened);
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_ranges_drops_stream_permit_before_fallback() {
        let inner = object_store::memory::InMemory::new();
        let location = Path::from("ranges");
        inner
            .put_opts(
                &location,
                Bytes::from_static(b"0123456789abcdef").into(),
                PutOptions::default(),
            )
            .await
            .unwrap();
        let store = Local {
            client: LimitStore::new(Box::new(inner) as Box<dyn ObjectStore>, 1),
            with_prefix: false,
        };
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            store.get_ranges(&location, &[1..3, 5..7]),
        )
        .await
        .expect("stream fallback retained the only client permit")
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
