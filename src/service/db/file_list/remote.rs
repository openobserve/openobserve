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

use crate::common::infra::{config::CONFIG, storage};
use crate::common::json;
use crate::common::meta::common::FileKey;

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
        let task: tokio::task::JoinHandle<Result<ProcessStats, anyhow::Error>> =
            tokio::task::spawn(async move {
                let mut stats = ProcessStats::default();
                for file in chunk {
                    match process_file(&file).await {
                        Ok(ret) => stats = stats + ret,
                        Err(err) => {
                            log::error!("Error processing file: {:?} {:?}", file, err);
                            continue;
                        }
                    }
                    tokio::task::yield_now().await;
                }
                Ok(stats)
            });
        tasks.push(task);
    }

    let mut stats = ProcessStats::default();
    let task_results = try_join_all(tasks).await?;
    for task_result in task_results {
        stats = stats + task_result?;
    }

    // delete files
    for item in super::DELETED_FILES.iter() {
        super::progress(item.key(), item.value().to_owned(), true, false).await?;
    }

    log::info!(
        "Load file_list [{prefix}] load {}:{} done, download: {}ms, uncompress: {}ms, caching: {}ms",
        files.len(),
        stats.file_count,
        stats.download_time,
        stats.uncompress_time,
        stats.caching_time
    );

    // cache result
    rw.insert(prefix);

    // clean deleted files
    super::DELETED_FILES.clear();
    super::DELETED_FILES.shrink_to_fit();

    Ok(())
}

async fn process_file(file: &str) -> Result<ProcessStats, anyhow::Error> {
    let start = std::time::Instant::now();
    let mut stats = ProcessStats::default();
    // download file list from storage
    let data = match storage::get(file).await {
        Ok(data) => data,
        Err(_) => {
            return Ok(stats);
        }
    };
    stats.download_time = start.elapsed().as_millis() as usize;

    // uncompress file
    let uncompress = zstd::decode_all(data.reader())?;
    stats.uncompress_time = start.elapsed().as_millis() as usize - stats.download_time;
    let uncompress_reader = BufReader::new(uncompress.reader());
    // parse file list
    for line in uncompress_reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        stats.file_count += 1;
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
        super::progress(&item.key, item.meta, item.deleted, false).await?;
    }
    stats.caching_time =
        start.elapsed().as_millis() as usize - stats.uncompress_time - stats.download_time;
    Ok(stats)
}

#[derive(Debug, Clone, Default)]
struct ProcessStats {
    pub file_count: usize,
    pub download_time: usize,
    pub uncompress_time: usize,
    pub caching_time: usize,
}

impl std::ops::Add<ProcessStats> for ProcessStats {
    type Output = ProcessStats;

    fn add(self, rhs: ProcessStats) -> Self::Output {
        ProcessStats {
            file_count: self.file_count + rhs.file_count,
            download_time: self.download_time + rhs.download_time,
            uncompress_time: self.uncompress_time + rhs.uncompress_time,
            caching_time: self.caching_time + rhs.caching_time,
        }
    }
}
