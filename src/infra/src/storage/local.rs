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
use std::os::unix::fs::FileExt;
use std::{ops::Range, path::PathBuf};

use async_trait::async_trait;
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
            root_dir: PathBuf::from(root_dir),
            with_prefix,
        }
    }

    /// Resolve an object-store Path to a filesystem path.
    /// For local storage format_key is a no-op, so the file lives at
    /// `root_dir / key`.
    #[inline]
    fn full_path(&self, location: &Path) -> PathBuf {
        self.root_dir
            .join(format_key(location.as_ref(), self.with_prefix))
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

        // metrics
        let data_len = result.meta.size;
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
        let file = location.to_string();
        let full_path = self.full_path(location);
        let ranges_owned: Vec<Range<u64>> = ranges.to_vec();

        let results = tokio::task::block_in_place(|| -> std::io::Result<Vec<Bytes>> {
            let f = std::fs::File::open(&full_path)?;
            let mut out = Vec::with_capacity(ranges_owned.len());
            for range in &ranges_owned {
                let len = (range.end - range.start) as usize;
                let mut buf = vec![0u8; len];
                f.read_exact_at(&mut buf, range.start)?;
                out.push(Bytes::from(buf));
            }
            Ok(out)
        })
        .map_err(|e| {
            log::error!("[STORAGE] get_ranges local file: {file}, error: {e:?}");
            if e.kind() == std::io::ErrorKind::NotFound {
                Error::NotFound {
                    path: file.clone(),
                    source: Box::new(e),
                }
            } else {
                Error::Generic {
                    store: "LocalFileSystem",
                    source: Box::new(e),
                }
            }
        })?;

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
    fn test_new_stores_root_dir() {
        let l = make_local("/tmp", false);
        assert_eq!(l.root_dir, std::path::PathBuf::from("/tmp"));
    }

    #[test]
    fn test_new_stores_with_prefix_flag() {
        let l_true = make_local("/tmp", true);
        assert!(l_true.with_prefix);
        let l_false = make_local("/tmp", false);
        assert!(!l_false.with_prefix);
    }
}
