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

use std::{fmt::Debug, ops::Range, sync::Arc};

use async_trait::async_trait;
use bytes::{Bytes, buf::Buf};
use config::{get_config, is_local_disk_storage, meta::stream::FileMeta, metrics};
use datafusion::parquet::{data_type::AsBytes, file::metadata::ParquetMetaData};
use futures::{StreamExt, TryStreamExt, stream::BoxStream};
use hashbrown::HashMap;
use object_store::{
    GetOptions, GetRange, GetResult, ListResult, MultipartUpload, ObjectMeta, PutMultipartOpts,
    PutOptions, PutPayload, PutResult, Result, WriteMultipart, path::Path,
};
use once_cell::sync::Lazy;
use parquet::file::metadata::ParquetMetaDataReader;

pub mod accounts;
mod local;
mod remote;
pub mod wal;

pub use remote::test_config as test_remote_config;

pub const CONCURRENT_REQUESTS: usize = 1000;

static MULTI_ACCOUNTS: Lazy<Box<dyn ObjectStoreExt>> = Lazy::new(accounts::default);

// Create a wrapper trait that extends ObjectStore
#[async_trait]
pub trait ObjectStoreExt: std::fmt::Display + Send + Sync + Debug + 'static {
    fn get_account(&self, file: &str) -> Option<String>;
    async fn put(&self, account: &str, location: &Path, payload: PutPayload) -> Result<PutResult>;
    async fn put_opts(
        &self,
        account: &str,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult>;
    async fn put_multipart(
        &self,
        account: &str,
        location: &Path,
    ) -> Result<Box<dyn MultipartUpload>>;
    async fn put_multipart_opts(
        &self,
        account: &str,
        location: &Path,
        opts: PutMultipartOpts,
    ) -> Result<Box<dyn MultipartUpload>>;
    async fn get(&self, account: &str, location: &Path) -> Result<GetResult>;
    async fn get_opts(
        &self,
        account: &str,
        location: &Path,
        options: GetOptions,
    ) -> Result<GetResult>;
    async fn get_range(&self, account: &str, location: &Path, range: Range<usize>)
    -> Result<Bytes>;
    async fn get_ranges(
        &self,
        account: &str,
        location: &Path,
        ranges: &[Range<usize>],
    ) -> Result<Vec<Bytes>>;
    async fn head(&self, account: &str, location: &Path) -> Result<ObjectMeta>;
    async fn delete(&self, account: &str, location: &Path) -> Result<()>;
    fn delete_stream<'a>(
        &'a self,
        account: &str,
        locations: BoxStream<'a, Result<Path>>,
    ) -> BoxStream<'a, Result<Path>>;
    fn list(&self, account: &str, prefix: Option<&Path>) -> BoxStream<'_, Result<ObjectMeta>>;
    fn list_with_offset(
        &self,
        account: &str,
        prefix: Option<&Path>,
        offset: &Path,
    ) -> BoxStream<'_, Result<ObjectMeta>>;
    async fn list_with_delimiter(&self, account: &str, prefix: Option<&Path>)
    -> Result<ListResult>;
    async fn copy(&self, account: &str, from: &Path, to: &Path) -> Result<()>;
    async fn rename(&self, account: &str, from: &Path, to: &Path) -> Result<()>;
    async fn copy_if_not_exists(&self, account: &str, from: &Path, to: &Path) -> Result<()>;
    async fn rename_if_not_exists(&self, account: &str, from: &Path, to: &Path) -> Result<()>;
}

pub async fn list(account: &str, prefix: &str) -> Result<Vec<String>> {
    let files = MULTI_ACCOUNTS
        .list(account, Some(&prefix.into()))
        .map_ok(|meta| meta.location.to_string())
        .try_collect::<Vec<String>>()
        .await
        .expect("Error listing files");
    Ok(files)
}

pub fn get_account(file: &str) -> Option<String> {
    MULTI_ACCOUNTS.get_account(file)
}

pub async fn get(account: &str, file: &str) -> Result<GetResult> {
    MULTI_ACCOUNTS.get(account, &file.into()).await
}

pub async fn get_opts(account: &str, file: &str, options: GetOptions) -> Result<GetResult> {
    MULTI_ACCOUNTS
        .get_opts(account, &file.into(), options)
        .await
}

pub async fn get_range(account: &str, file: &str, range: Range<usize>) -> Result<bytes::Bytes> {
    MULTI_ACCOUNTS.get_range(account, &file.into(), range).await
}

pub async fn head(account: &str, file: &str) -> Result<ObjectMeta> {
    MULTI_ACCOUNTS.head(account, &file.into()).await
}

pub async fn get_bytes(account: &str, file: &str) -> Result<bytes::Bytes> {
    let data = get(account, file).await?;
    data.bytes().await
}

pub async fn get_opts_bytes(
    account: &str,
    file: &str,
    options: GetOptions,
) -> Result<bytes::Bytes> {
    let data = get_opts(account, file, options).await?;
    data.bytes().await
}

pub async fn put(account: &str, file: &str, data: bytes::Bytes) -> Result<()> {
    let multi_part_upload_size = get_config().s3.multi_part_upload_size;
    if multi_part_upload_size > 0 && multi_part_upload_size < bytes_size_in_mb(&data) as usize {
        put_multipart(account, file, data).await?;
    } else {
        MULTI_ACCOUNTS
            .put(account, &file.into(), data.into())
            .await?;
    }
    Ok(())
}

pub async fn put_multipart(account: &str, file: &str, data: bytes::Bytes) -> Result<()> {
    let path = Path::from(file);
    let upload = MULTI_ACCOUNTS.put_multipart(account, &path).await?;
    let mut write = WriteMultipart::new(upload);
    write.write(data.as_bytes());
    write.finish().await?;
    Ok(())
}

/// Delete files from the object store.
/// params: account, file
pub async fn del(files: Vec<(&str, &str)>) -> Result<()> {
    if files.is_empty() {
        return Ok(());
    }

    let start = std::time::Instant::now();
    let columns = files[0].1.split('/').collect::<Vec<&str>>();

    if !is_local_disk_storage() && get_config().s3.feature_bulk_delete {
        // group the files by account
        let mut file_groups = HashMap::new();
        for (account, file) in files {
            file_groups
                .entry(account)
                .or_insert_with(Vec::new)
                .push(file);
        }
        for (account, files) in file_groups {
            let files = futures::stream::iter(files)
                .map(|file| Ok(Path::from(file)))
                .boxed();
            match MULTI_ACCOUNTS
                .delete_stream(account, files)
                .try_collect::<Vec<Path>>()
                .await
            {
                Ok(files) => {
                    log::debug!("Deleted objects: {:?}", files);
                }
                Err(e) => {
                    log::error!("Failed to delete objects: {:?}", e);
                }
            }
        }
    } else {
        let files = files
            .into_iter()
            .map(|(account, file)| (account, file.to_string()))
            .collect::<Vec<_>>();
        let files = futures::stream::iter(files);
        files
            .for_each_concurrent(get_config().limit.cpu_num, |(account, file)| async move {
                match MULTI_ACCOUNTS
                    .delete(account, &Path::from(file.as_str()))
                    .await
                {
                    Ok(_) => {
                        log::debug!("Deleted object: {}", file);
                    }
                    Err(e) => {
                        // TODO: need a better solution for identifying the error
                        if file.ends_with(".result.json") {
                            // ignore search job file deletion error
                            log::debug!("Failed to delete object: {}, error: {:?}", file, e);
                        } else if !is_local_disk_storage() {
                            log::error!("Failed to delete object: {:?}", e);
                        }
                    }
                }
            })
            .await;
    }

    if columns[0] == "files" {
        let time = start.elapsed().as_secs_f64();
        metrics::STORAGE_TIME
            .with_label_values(&[columns[1], columns[2], "del", "remote"])
            .inc_by(time);
    }

    Ok(())
}

pub async fn get_file_meta(account: &str, file: &str) -> Result<FileMeta, anyhow::Error> {
    let mut file_meta = FileMeta::default();
    let (file_size, parquet_meta) = get_parquet_metadata(account, file).await?;
    if let Some(metadata) = parquet_meta.file_metadata().key_value_metadata() {
        file_meta = metadata.as_slice().into();
    }
    file_meta.compressed_size = file_size as i64;
    Ok(file_meta)
}

async fn get_parquet_metadata(
    account: &str,
    file: &str,
) -> Result<(usize, Arc<ParquetMetaData>), anyhow::Error> {
    // get file info
    let info = head(account, file).await?;
    let file_size = info.size;

    // read metadata len
    let mut data = get_range(
        account,
        file,
        file_size - parquet::file::FOOTER_SIZE..file_size,
    )
    .await?;
    let mut buf = [0_u8; parquet::file::FOOTER_SIZE];
    data.copy_to_slice(&mut buf);
    let metadata_len = ParquetMetaDataReader::decode_footer(&buf)?;

    // read metadata
    let data = get_range(
        account,
        file,
        file_size - parquet::file::FOOTER_SIZE - metadata_len
            ..file_size - parquet::file::FOOTER_SIZE,
    )
    .await?;

    Ok((
        file_size,
        Arc::new(ParquetMetaDataReader::decode_metadata(&data)?),
    ))
}

pub fn format_key(key: &str, with_prefix: bool) -> String {
    let cfg = get_config();
    if !is_local_disk_storage()
        && with_prefix
        && !cfg.s3.bucket_prefix.is_empty()
        && !key.starts_with(&cfg.s3.bucket_prefix)
    {
        format!("{}{}", cfg.s3.bucket_prefix, key)
    } else {
        key.to_string()
    }
}

pub fn get_stream_from_file(file: &Path) -> Option<String> {
    // eg: files/default/logs/olympics/2023/08/21/08/a.parquet
    // eg: files/default/traces/default/2023/09/04/05/default/service_name=ingester/
    let parts = file.parts().collect::<Vec<_>>();
    if parts.len() < 9 || parts[0] != "files".into() {
        return None;
    }
    // 0 files
    // 1 org_id
    // 2 stream_type
    // 3 stream_name
    Some(parts[3].as_ref().to_string())
}

fn bytes_size_in_mb(b: &bytes::Bytes) -> f64 {
    b.len() as f64 / (1024.0 * 1024.0)
}

#[derive(Debug)]
pub enum Error {
    OutOfRange(String),
    BadRange(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OutOfRange(s) => write!(f, "Out of range: {}", s),
            Self::BadRange(s) => write!(f, "Bad range: {}", s),
        }
    }
}

impl From<Error> for object_store::Error {
    fn from(source: Error) -> Self {
        Self::Generic {
            store: "storage",
            source: Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                source.to_string(),
            )),
        }
    }
}

#[derive(Debug)]
pub enum InvalidGetRange {
    StartTooLarge { requested: usize, length: usize },
    Inconsistent { start: usize, end: usize },
}

impl std::fmt::Display for InvalidGetRange {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::StartTooLarge { requested, length } => {
                write!(
                    f,
                    "Start too large: requested {} but length is {}",
                    requested, length
                )
            }
            Self::Inconsistent { start, end } => {
                write!(
                    f,
                    "Inconsistent range: start {} is greater than end {}",
                    start, end
                )
            }
        }
    }
}

pub trait GetRangeExt {
    fn is_valid(&self) -> Result<(), InvalidGetRange>;
    /// Convert to a [`Range`] if valid.
    fn as_range(&self, len: usize) -> Result<Range<usize>, InvalidGetRange>;
}

impl GetRangeExt for GetRange {
    fn is_valid(&self) -> Result<(), InvalidGetRange> {
        match self {
            Self::Bounded(r) if r.end <= r.start => {
                return Err(InvalidGetRange::Inconsistent {
                    start: r.start,
                    end: r.end,
                });
            }
            _ => (),
        };
        Ok(())
    }

    /// Convert to a [`Range`] if valid.
    fn as_range(&self, len: usize) -> Result<Range<usize>, InvalidGetRange> {
        self.is_valid()?;
        match self {
            Self::Bounded(r) => {
                if r.start >= len {
                    Err(InvalidGetRange::StartTooLarge {
                        requested: r.start,
                        length: len,
                    })
                } else if r.end > len {
                    Ok(r.start..len)
                } else {
                    Ok(r.clone())
                }
            }
            Self::Offset(o) => {
                if *o >= len {
                    Err(InvalidGetRange::StartTooLarge {
                        requested: *o,
                        length: len,
                    })
                } else {
                    Ok(*o..len)
                }
            }
            Self::Suffix(n) => Ok(len.saturating_sub(*n)..len),
        }
    }
}
