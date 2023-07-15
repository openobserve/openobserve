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

use std::io::Write;

use crate::common;
use crate::common::infra::{cache::file_list, ider, storage};
use crate::common::meta::{
    common::{FileKey, FileMeta},
    stream::ScanStats,
    StreamType,
};
use crate::service::db;

#[inline]
pub fn get_file_list(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_min: i64,
    time_max: i64,
) -> Result<Vec<String>, anyhow::Error> {
    file_list::get_file_list(org_id, stream_name, stream_type, time_min, time_max)
}

#[inline]
pub fn get_file_meta(file: &str) -> Result<FileMeta, anyhow::Error> {
    file_list::get_file_from_cache(file)
}

#[inline]
pub fn calculate_files_size(files: &[String]) -> Result<ScanStats, anyhow::Error> {
    let mut stats = ScanStats::new();
    stats.files = files.len() as u64;
    for file in files {
        let resp = get_file_meta(file)?;
        stats.records += resp.records;
        stats.original_size += resp.original_size;
        stats.compressed_size += resp.compressed_size;
    }
    Ok(stats)
}

#[inline]
pub fn calculate_local_files_size(files: &[String]) -> Result<u64, anyhow::Error> {
    let mut size = 0;
    for file in files {
        let file_size = match common::file::get_file_meta(file) {
            Ok(resp) => resp.len(),
            Err(_) => 0,
        };
        size += file_size;
    }
    Ok(size)
}

// Delete one parquet file and update the file list
pub async fn delete_parquet_file(key: &str, file_list_only: bool) -> Result<(), anyhow::Error> {
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
    let mut write_buf = common::json::to_vec(&file_data)?;
    write_buf.push(b'\n');
    buf.write_all(&write_buf)?;
    let compressed_bytes = buf.finish().unwrap();
    storage::put(&new_file_list_key, compressed_bytes.into()).await?;
    db::file_list::progress(key, meta, deleted, false).await?;
    db::file_list::broadcast::send(&[file_data]).await?;

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
        );
        assert!(res.is_ok());
    }
}
