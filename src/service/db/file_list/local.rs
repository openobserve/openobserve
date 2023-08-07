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

use std::fs::File;
use std::io::{BufRead, BufReader};

use crate::common::infra::{cache::file_list::parse_file_key_columns, config::CONFIG, wal};
use crate::common::meta::stream::StreamParams;
use crate::common::meta::{
    common::{FileKey, FileMeta},
    StreamType,
};
use crate::common::{file::scan_files, json};

pub async fn set(key: &str, meta: FileMeta, deleted: bool) -> Result<(), anyhow::Error> {
    let (_stream_key, date_key, _file_name) = parse_file_key_columns(key)?;
    let file_data = FileKey {
        key: key.to_string(),
        meta,
        deleted,
    };

    // dynamodb mode
    if CONFIG.common.use_dynamo_meta_store {
        // retry 5 times
        for _ in 0..5 {
            if let Err(e) = super::dynamo_db::write_file(&file_data).await {
                log::error!("[FILE_LIST] Error saving file to dynamo, retrying: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            } else {
                break;
            }
        }
        return Ok(());
    }

    // local mode
    let mut write_buf = json::to_vec(&file_data)?;
    write_buf.push(b'\n');
    let hour_key = date_key.replace('/', "_");
    let file = wal::get_or_create(
        0,
        StreamParams {
            org_id: "",
            stream_name: "",
            stream_type: StreamType::Filelist,
        },
        None,
        &hour_key,
        false,
    );
    file.write(write_buf.as_ref());

    super::progress(key, meta, deleted, true).await?;
    // if !CONFIG.common.local_mode {
    //     tokio::task::spawn(async move { super::broadcast::send(&[file_data], None).await });
    //     tokio::task::yield_now().await;
    // }

    Ok(())
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
    let items = get_all().await?;
    for item in items {
        // check deleted files
        if item.deleted {
            super::DELETED_FILES.insert(item.key, item.meta.to_owned());
            continue;
        }
        super::progress(&item.key, item.meta, item.deleted, false).await?;
    }
    Ok(())
}

#[inline]
pub async fn broadcast_cache(node_uuid: Option<&str>) -> Result<(), anyhow::Error> {
    let files = get_all().await?;
    if files.is_empty() {
        return Ok(());
    }
    for chunk in files.chunks(100) {
        if let Err(e) = super::broadcast::send(chunk, node_uuid).await {
            log::error!("broadcast cached file list failed: {}", e);
        }
    }
    Ok(())
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
