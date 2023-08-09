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

use crate::common::infra::{config::CONFIG, file_list, wal};
use crate::common::meta::{
    common::{FileKey, FileMeta},
    stream::StreamParams,
    StreamType,
};
use crate::common::{file::scan_files, json};

pub async fn set(key: &str, meta: FileMeta, deleted: bool) -> Result<(), anyhow::Error> {
    let file_data = FileKey::new(key, meta, deleted);

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

    super::progress(key, meta, deleted, true).await?;
    if !CONFIG.common.local_mode {
        tokio::task::spawn(async move { super::broadcast::send(&[file_data], None).await });
        tokio::task::yield_now().await;
    }

    Ok(())
}

pub async fn broadcast_cache(node_uuid: Option<&str>) -> Result<(), anyhow::Error> { 
    let files = file_list::list().await?;
    if files.is_empty() {
        return Ok(());
    }
    for chunk in files.chunks(100) {
        let chunk = chunk
            .iter()
            .map(|(k, v)| FileKey::new(k, v.to_owned(), false))
            .collect::<Vec<_>>();
        if let Err(e) = super::broadcast::send(&chunk, node_uuid).await {
            log::error!("broadcast cached file list failed: {}", e);
        }
    }
    Ok(())
}
