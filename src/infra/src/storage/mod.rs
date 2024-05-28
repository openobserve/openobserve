// Copyright 2023 Zinc Labs Inc.
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

use config::{is_local_disk_storage, metrics, CONFIG};
use futures::{StreamExt, TryStreamExt};
use object_store::ObjectStore;
use once_cell::sync::Lazy;

pub mod local;
pub mod remote;

pub const CONCURRENT_REQUESTS: usize = 1000;

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
        std::fs::create_dir_all(&CONFIG.blocking_read().common.data_stream_dir)
            .expect("create stream data dir success");
        Box::<local::Local>::default()
    } else {
        Box::<remote::Remote>::default()
    }
}

fn local_cache() -> Box<dyn ObjectStore> {
    let config = CONFIG.blocking_read();

    std::fs::create_dir_all(&config.common.data_cache_dir).expect("create cache dir success");
    Box::new(local::Local::new(&config.common.data_cache_dir, true))
}

fn local_wal() -> Box<dyn ObjectStore> {
    let config = CONFIG.blocking_read();
    std::fs::create_dir_all(&config.common.data_wal_dir).expect("create wal dir success");
    Box::new(local::Local::new(&config.common.data_wal_dir, false))
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
    DEFAULT.put(&file.into(), data).await?;
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
        .for_each_concurrent(CONFIG.read().await.limit.cpu_num, |file| async move {
            match DEFAULT.delete(&(file.as_str().into())).await {
                Ok(_) => {
                    log::debug!("Deleted object: {}", file);
                }
                Err(e) => {
                    log::error!("Failed to delete object: {:?}", e);
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
    let config = CONFIG.blocking_read();
    if !is_local_disk_storage()
        && with_prefix
        && !config.s3.bucket_prefix.is_empty()
        && !key.starts_with(&config.s3.bucket_prefix)
    {
        format!("{}{}", config.s3.bucket_prefix, key)
    } else {
        key.to_string()
    }
}
