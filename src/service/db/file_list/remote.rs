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
use dashmap::DashSet;
use futures::future::try_join_all;
use once_cell::sync::Lazy;
use std::io::{BufRead, BufReader};

use crate::common::json;
use crate::infra::{
    config::{RwHashSet, CONFIG},
    db::etcd,
    storage,
};
use crate::meta::common::FileKey;

pub static LOADED_FILES: Lazy<RwHashSet<String>> =
    Lazy::new(|| DashSet::with_capacity_and_hasher(64, Default::default()));

pub async fn cache(prefix: &str) -> Result<(), anyhow::Error> {
    let prefix = format!("file_list/{prefix}");

    // get a cluster lock for compactor stream
    let lock_key = format!("file_list/remote/cache/{prefix}");
    let mut lock = etcd::Locker::new(&lock_key);
    if lock.lock(0).await.is_err() {
        return Ok(()); // lock failed, just skip
    }

    if LOADED_FILES.contains(&prefix) {
        // release cluster lock
        lock.unlock().await?;
        return Ok(());
    }

    log::info!("Load file_list [{prefix}] begin");
    let files = storage::list(&prefix).await?;
    log::info!("Load file_list [{prefix}] gets {} files", files.len());
    if files.is_empty() {
        // release cluster lock
        lock.unlock().await?;
        return Ok(());
    }

    let mut tasks = Vec::new();
    let chunk_size = std::cmp::max(1, files.len() / CONFIG.limit.query_thread_num);
    let files_chunks = files
        .chunks(chunk_size)
        .map(|chunk| chunk.to_vec())
        .collect::<Vec<Vec<String>>>();
    for chunk in files_chunks {
        let task: tokio::task::JoinHandle<Result<usize, anyhow::Error>> =
            tokio::task::spawn(async move {
                let mut count = 0;
                for file in chunk {
                    count += proccess_file(&file).await?;
                }
                Ok(count)
            });
        tasks.push(task);
    }

    let mut count = 0;
    let task_results = try_join_all(tasks).await?;
    for task_result in task_results {
        match task_result {
            Ok(v) => {
                count += v;
            }
            Err(e) => {
                // release cluster lock
                lock.unlock().await?;
                return Err(anyhow::anyhow!("Load file_list err: {:?}", e));
            }
        }
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
    LOADED_FILES.insert(prefix);

    // clean deleted files
    super::DELETED_FILES.clear();
    super::DELETED_FILES.shrink_to_fit();

    // release cluster lock
    lock.unlock().await?;

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
        // check deleted files
        if item.deleted {
            super::DELETED_FILES.insert(item.key, item.meta.to_owned());
            continue;
        }
        super::progress(&item.key, item.meta, item.deleted).await?;
    }
    Ok(count)
}
