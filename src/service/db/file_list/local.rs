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

use crate::common::{
    infra::{config::CONFIG, file_list, wal},
    meta::{
        common::{FileKey, FileMeta},
        stream::StreamParams,
        StreamType,
    },
    utils::json,
};

pub async fn set(key: &str, meta: Option<FileMeta>, deleted: bool) -> Result<(), anyhow::Error> {
    let (_stream_key, date_key, _file_name) = file_list::parse_file_key_columns(key)?;
    let file_data = FileKey::new(key, meta.clone().unwrap_or_default(), deleted);

    // write into file_list storage
    // retry 5 times
    for _ in 0..5 {
        if let Err(e) = super::progress(key, meta.as_ref(), deleted, true).await {
            log::error!("[FILE_LIST] Error saving file to storage, retrying: {}", e);
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        } else {
            break;
        }
    }
    if CONFIG.common.meta_store_external {
        return Ok(());
    }

    // write into local cache for s3
    let mut write_buf = json::to_vec(&file_data)?;
    write_buf.push(b'\n');
    let file = wal::get_or_create(
        0,
        StreamParams::new("", "", StreamType::Filelist),
        None,
        &date_key,
        false,
    )
    .await;
    file.write(write_buf.as_ref()).await;

    // notifiy other nodes
    tokio::task::spawn(async move { super::broadcast::send(&[file_data], None).await });
    tokio::task::yield_now().await;

    Ok(())
}

pub async fn broadcast_cache(node_uuid: Option<String>) -> Result<(), anyhow::Error> {
    let files = file_list::list().await?;
    if files.is_empty() {
        return Ok(());
    }
    for chunk in files.chunks(100) {
        let chunk = chunk
            .iter()
            .map(|(k, v)| FileKey::new(k, v.to_owned(), false))
            .collect::<Vec<_>>();
        if let Err(e) = super::broadcast::send(&chunk, node_uuid.clone()).await {
            log::error!("[FILE_LIST] broadcast cached file list failed: {}", e);
        }
    }
    Ok(())
}
