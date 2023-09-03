// Copyright 2023 Zinc Labs Inc.
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

use std::io::Write;

use crate::common;
use crate::common::infra::{config::CONFIG, file_list, ider, storage};
use crate::common::meta::{
    common::{FileKey, FileMeta},
    stream::{PartitionTimeLevel, ScanStats},
    StreamType,
};
use crate::service::db;

#[inline]
pub async fn query(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_level: PartitionTimeLevel,
    time_min: i64,
    time_max: i64,
) -> Result<Vec<FileKey>, anyhow::Error> {
    let files = file_list::query(
        org_id,
        stream_type,
        stream_name,
        time_level,
        (time_min, time_max),
    )
    .await?;
    let mut file_keys = Vec::with_capacity(files.len());
    for file in files {
        file_keys.push(FileKey {
            key: file.0,
            meta: file.1,
            deleted: false,
        });
    }
    Ok(file_keys)
}

#[inline]
pub async fn get_file_meta(file: &str) -> Result<FileMeta, anyhow::Error> {
    Ok(file_list::get(file).await?)
}

#[inline]
pub async fn calculate_files_size(files: &[FileKey]) -> Result<ScanStats, anyhow::Error> {
    let mut stats = ScanStats::new();
    stats.files = files.len() as i64;
    for file in files {
        stats.records += file.meta.records;
        stats.original_size += file.meta.original_size;
        stats.compressed_size += file.meta.compressed_size;
    }
    Ok(stats)
}

#[inline]
pub fn calculate_local_files_size(files: &[String]) -> Result<u64, anyhow::Error> {
    let mut size = 0;
    for file in files {
        let file_size = match common::utils::file::get_file_meta(file) {
            Ok(resp) => resp.len(),
            Err(_) => 0,
        };
        size += file_size;
    }
    Ok(size)
}

// Delete one parquet file and update the file list
pub async fn delete_parquet_file(key: &str, file_list_only: bool) -> Result<(), anyhow::Error> {
    if CONFIG.common.meta_store_external {
        delete_parquet_file_db_only(key, file_list_only).await
    } else {
        delete_parquet_file_s3(key, file_list_only).await
    }
}

async fn delete_parquet_file_db_only(key: &str, file_list_only: bool) -> Result<(), anyhow::Error> {
    // delete from file list in dynamo
    file_list::batch_remove(&[key.to_string()]).await?;

    // delete the parquet whaterever the file is exists or not
    if !file_list_only {
        _ = storage::del(&[key]).await;
    }
    Ok(())
}

async fn delete_parquet_file_s3(key: &str, file_list_only: bool) -> Result<(), anyhow::Error> {
    let columns = key.split('/').collect::<Vec<&str>>();
    if columns[0] != "files" || columns.len() < 9 {
        return Ok(());
    }
    let new_file_list_key = format!(
        "file_list/{}/{}/{}/{}/{}.json.zst",
        columns[4],
        columns[5],
        columns[6],
        columns[7],
        ider::generate()
    );

    let meta = FileMeta::default();
    let deleted = true;
    let file_data = FileKey {
        key: key.to_string(),
        meta,
        deleted,
    };

    // generate the new file list
    let mut buf = zstd::Encoder::new(Vec::new(), 3)?;
    let mut write_buf = common::utils::json::to_vec(&file_data)?;
    write_buf.push(b'\n');
    buf.write_all(&write_buf)?;
    let compressed_bytes = buf.finish().unwrap();
    storage::put(&new_file_list_key, compressed_bytes.into()).await?;
    db::file_list::progress(key, meta, deleted, false).await?;
    db::file_list::broadcast::send(&[file_data], None).await?;

    // delete the parquet whaterever the file is exists or not
    if !file_list_only {
        _ = storage::del(&[key]).await;
    }
    Ok(())
}

#[cfg(test)]
mod test {
    use super::*;

    #[actix_web::test]
    async fn test_get_file_meta() {
        let res = get_file_meta(
            "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
        )
        .await;
        assert!(res.is_err());
    }
}
