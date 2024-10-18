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

use config::{get_config, is_local_disk_storage, metrics};
use datafusion::parquet::data_type::AsBytes;
use futures::{StreamExt, TryStreamExt};
use object_store::{path::Path, ObjectStore, WriteMultipart};
use once_cell::sync::Lazy;

pub mod local;
pub mod remote;

pub const CONCURRENT_REQUESTS: usize = 1000;
pub const MULTI_PART_UPLOAD_DATA_SIZE: f64 = 100.0;

pub static DEFAULT: Lazy<Box<dyn ObjectStore>> = Lazy::new(default);
pub static LOCAL_CACHE: Lazy<Box<dyn ObjectStore>> = Lazy::new(local_cache);
pub static LOCAL_WAL: Lazy<Box<dyn ObjectStore>> = Lazy::new(local_wal);

/// Returns the default object store based on the configuration.
/// If the local disk storage is enabled, it creates a local object store.
/// Otherwise, it creates a remote object store.
///
/// # Examples
///
/// ```
/// use infra::storage::default;
///
/// let object_store = default();
/// ```
fn default() -> Box<dyn ObjectStore> {
    if is_local_disk_storage() {
        std::fs::create_dir_all(&get_config().common.data_stream_dir)
            .expect("create stream data dir success");
        Box::<local::Local>::default()
    } else {
        Box::<remote::Remote>::default()
    }
}

fn local_cache() -> Box<dyn ObjectStore> {
    let cfg = get_config();
    std::fs::create_dir_all(&cfg.common.data_cache_dir).expect("create cache dir success");
    Box::new(local::Local::new(&cfg.common.data_cache_dir, true))
}

fn local_wal() -> Box<dyn ObjectStore> {
    let cfg = get_config();
    std::fs::create_dir_all(&cfg.common.data_wal_dir).expect("create wal dir success");
    Box::new(local::Local::new(&cfg.common.data_wal_dir, false))
}

pub async fn list(prefix: &str) -> Result<Vec<String>, anyhow::Error> {
    let files = DEFAULT
        .list(Some(&prefix.into()))
        .map_ok(|meta| meta.location.to_string())
        .try_collect::<Vec<String>>()
        .await
        .expect("Error listing files");
    Ok(files)
}

pub async fn get(file: &str) -> Result<bytes::Bytes, anyhow::Error> {
    let data = DEFAULT.get(&file.into()).await?;
    let data = data.bytes().await?;
    Ok(data)
}

pub async fn put(file: &str, data: bytes::Bytes) -> Result<(), anyhow::Error> {
    if bytes_size_in_mb(&data) >= MULTI_PART_UPLOAD_DATA_SIZE {
        put_multipart(file, data).await?;
    } else {
        DEFAULT.put(&file.into(), data.into()).await?;
    }
    Ok(())
}

pub async fn put_multipart(file: &str, data: bytes::Bytes) -> Result<(), anyhow::Error> {
    let path = Path::from(file);
    let upload = DEFAULT.put_multipart(&path).await?;
    let mut write = WriteMultipart::new(upload);
    write.write(data.as_bytes());
    write.finish().await?;
    Ok(())
}

pub async fn del(files: &[&str]) -> Result<(), anyhow::Error> {
    if files.is_empty() {
        return Ok(());
    }

    let start = std::time::Instant::now();
    let columns = files[0].split('/').collect::<Vec<&str>>();
    let files = files
        .iter()
        .map(|file| file.to_string())
        .collect::<Vec<_>>();
    let files_stream = futures::stream::iter(files);
    files_stream
        .for_each_concurrent(get_config().limit.cpu_num, |file| async move {
            match DEFAULT.delete(&(file.as_str().into())).await {
                Ok(_) => {
                    log::debug!("Deleted object: {}", file);
                }
                Err(e) => {
                    // TODO: need a better solution for identifying the error
                    if file.ends_with(".puffin") {
                        // ignore puffin file deletion error
                    } else {
                        log::error!("Failed to delete object: {:?}", e);
                    }
                }
            }
        })
        .await;

    if columns[0] == "files" {
        let time = start.elapsed().as_secs_f64();
        metrics::STORAGE_TIME
            .with_label_values(&[columns[1], columns[2], "del", "remote"])
            .inc_by(time);
    }

    Ok(())
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

fn bytes_size_in_mb(b: &bytes::Bytes) -> f64 {
    b.len() as f64 / (1024.0 * 1024.0)
}
