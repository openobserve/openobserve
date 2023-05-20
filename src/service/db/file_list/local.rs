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
use std::fs::File;
use std::io::{BufRead, BufReader};

use crate::common::file::scan_files;
use crate::common::json;
use crate::infra::config::CONFIG;
use crate::infra::file_lock;
use crate::meta::common::{FileKey, FileMeta};
use crate::meta::StreamType;

pub async fn set(key: &str, meta: FileMeta, deleted: bool) -> Result<(), anyhow::Error> {
    let file_data = FileKey {
        key: key.to_string(),
        meta,
        deleted,
    };
    let mut write_buf = json::to_vec(&file_data)?;
    write_buf.push(b'\n');
    let hour_key = Utc
        .timestamp_nanos(meta.min_ts * 1000)
        .format("%Y_%m_%d_%H")
        .to_string();
    let file = file_lock::get_or_create(0, "", "", StreamType::Filelist, &hour_key, false);
    file.write(write_buf.as_ref());

    super::progress(key, meta, deleted).await?;
    super::broadcast::send(&[file_data]).await
}

pub async fn get_all() -> Result<Vec<FileKey>, anyhow::Error> {
    let mut result = Vec::new();
    let pattern = format!("{}/file_list/*.json", &CONFIG.common.data_wal_dir);
    let files = scan_files(&pattern);
    let mut line_num = 0;
    for file in files {
        line_num += 1;
        let f = File::open(&file).expect("open file list failed");
        let reader = BufReader::new(f);
        // parse file list
        for line in reader.lines() {
            let line = line?;
            if line.is_empty() {
                continue;
            }
            let item: FileKey = match json::from_slice(line.as_bytes()) {
                Ok(item) => item,
                Err(err) => {
                    panic!(
                        "parse file list failed:\nfile: {}\nline_no: {}\nline: {}\nerr: {}",
                        file, line_num, line, err
                    );
                }
            };
            result.push(item);
        }
    }
    Ok(result)
}

#[inline]
pub async fn cache() -> Result<(), anyhow::Error> {
    let files = get_all().await?;
    for file in files {
        super::progress(&file.key, file.meta, false).await?;
    }
    Ok(())
}

#[inline]
pub async fn broadcast_cache() -> Result<(), anyhow::Error> {
    let files = get_all().await?;
    if files.is_empty() {
        return Ok(());
    }
    super::broadcast::send(&files).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[actix_web::test]
    async fn test_files() {
        let file_key = "files/nexus/logs/default/2022/10/03/10/6982652937134804993_1.parquet";

        let file_meta = FileMeta {
            min_ts: 1667978841110,
            max_ts: 1667978845354,
            records: 300,
            original_size: 10,
            compressed_size: 1,
        };

        let resp = set(file_key, file_meta, false).await;
        //let resp = cache().await;

        assert!(resp.is_ok());
    }
}
