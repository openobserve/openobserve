// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use chrono::{TimeZone, Utc};
use futures::{StreamExt, TryStreamExt};
use object_store::ObjectStore;
use once_cell::sync::Lazy;

use super::{config::CONFIG, metrics};
use crate::common::utils::is_local_disk_storage;
use crate::infra::ider;
use crate::meta::StreamType;

pub mod local;
pub mod remote;

pub const CONCURRENT_REQUESTS: usize = 1000;

pub static DEFAULT: Lazy<Box<dyn ObjectStore>> = Lazy::new(default);

fn default() -> Box<dyn ObjectStore> {
    if is_local_disk_storage() {
        std::fs::create_dir_all(&CONFIG.common.data_stream_dir)
            .expect("create stream data dir success");
        Box::<local::Local>::default()
    } else {
        Box::<remote::Remote>::default()
    }
}

pub async fn list(prefix: &str) -> Result<Vec<String>, anyhow::Error> {
    let files = DEFAULT
        .list(Some(&prefix.into()))
        .await?
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
        .for_each_concurrent(CONFIG.limit.query_thread_num, |file| async move {
            match DEFAULT.delete(&(file.as_str().into())).await {
                Ok(_) => {
                    log::info!("Deleted object: {}", file);
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
            .with_label_values(&[columns[1], columns[3], columns[2], "del"])
            .inc_by(time);
    }

    Ok(())
}

pub fn format_key(key: &str) -> String {
    if !is_local_disk_storage()
        && !CONFIG.s3.bucket_prefix.is_empty()
        && !key.starts_with(&CONFIG.s3.bucket_prefix)
    {
        format!("{}{}", CONFIG.s3.bucket_prefix, key)
    } else {
        key.to_string()
    }
}

pub fn generate_partioned_file_key(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    min_ts: i64,
    extn: &str,
) -> (std::string::String, std::string::String) {
    let id = ider::generate();
    let time = Utc.timestamp_nanos(min_ts * 1000);

    let prefix = time.format("%Y/%m/%d/%H").to_string();
    (
        format!("{org_id}/{stream_type}/{stream_name}/{prefix}/"),
        format!("{id}{extn}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::config::CONFIG;

    #[test]
    fn test_generate_partioned_file_key() {
        let file_key = generate_partioned_file_key(
            "org",
            "stream_name",
            StreamType::Logs,
            1665580243211047,
            &CONFIG.common.file_ext_parquet,
        );
        assert_eq!(file_key.0.as_str(), "org/logs/stream_name/2022/10/12/13/");
        assert!(file_key.1.as_str().contains(".parquet"));
    }
}
