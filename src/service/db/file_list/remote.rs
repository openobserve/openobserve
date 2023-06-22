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

use bytes::Buf;
use futures::future::try_join_all;
use once_cell::sync::Lazy;
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use tokio::sync::RwLock;

use crate::common::json;
use crate::infra::{config::CONFIG, storage};
use crate::meta::common::FileKey;

pub static LOADED_FILES: Lazy<RwLock<HashSet<String>>> =
    Lazy::new(|| RwLock::new(HashSet::with_capacity(24)));

pub async fn cache(prefix: &str) -> Result<(), anyhow::Error> {
    let prefix = format!("file_list/{prefix}");
    let mut rw = LOADED_FILES.write().await;
    if rw.contains(&prefix) {
        return Ok(());
    }

    log::info!("Load file_list [{prefix}] begin");
    let files = storage::list(&prefix).await?;
    log::info!("Load file_list [{prefix}] gets {} files", files.len());
    if files.is_empty() {
        // cache result
        rw.insert(prefix);
        return Ok(());
    }

    let mut tasks = Vec::new();
    let chunk_size = std::cmp::max(1, files.len() / CONFIG.limit.query_thread_num);
    for chunk in files.chunks(chunk_size) {
        let chunk = chunk.to_vec();
        let task: tokio::task::JoinHandle<Result<usize, anyhow::Error>> =
            tokio::task::spawn(async move {
                let mut count = 0;
                for file in chunk {
                    count += proccess_file(&file).await?;
                    tokio::task::yield_now().await;
                }
                Ok(count)
            });
        tasks.push(task);
    }

    let mut count = 0;
    let task_results = try_join_all(tasks).await?;
    for task_result in task_results {
        count += task_result?;
    }

    // delete files
    for item in super::DELETED_FILES.iter() {
        super::progress(item.key(), item.value().to_owned(), true).await?;
    }

    log::info!(
        "Load file_list [{prefix}] load {}:{} done",
        files.len(),
        count
    );

    // cache result
    rw.insert(prefix);

    // clean deleted files
    super::DELETED_FILES.clear();
    super::DELETED_FILES.shrink_to_fit();

    Ok(())
}

async fn proccess_file(file: &str) -> Result<usize, anyhow::Error> {
    // download file list from storage
    let data = storage::get(file).await?;
    // uncompress file
    let uncompress = zstd::decode_all(data.reader())?;
    let uncompress_reader = BufReader::new(uncompress.reader());
    // parse file list
    let mut count = 0;
    for line in uncompress_reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        count += 1;
        let item: FileKey = json::from_slice(line.as_bytes())?;
        // check backlist
        if !super::BLOCKED_ORGS.is_empty() {
            let columns = item.key.split('/').collect::<Vec<&str>>();
            let org_id = columns.get(1).unwrap_or(&"");
            if super::BLOCKED_ORGS.contains(org_id) {
                // log::error!("Load file_list skip blacklist org: {}", org_id);
                continue;
            }
        }
        // check deleted files
        if item.deleted {
            super::DELETED_FILES.insert(item.key, item.meta.to_owned());
            continue;
        }
        super::progress(&item.key, item.meta, item.deleted).await?;
    }
    Ok(count)
}
