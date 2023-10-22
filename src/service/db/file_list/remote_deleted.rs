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

use ahash::HashMap;
use bytes::Buf;
use futures::future::try_join_all;
use std::io::{BufRead, BufReader};

use crate::common::infra::{config::CONFIG, file_list as infra_file_list, storage};

pub async fn cache() -> Result<(), anyhow::Error> {
    let start = std::time::Instant::now();
    let mut stats = ProcessStats::default();

    let prefix = "file_list_deleted/";
    let files = storage::list(prefix).await?;
    let files_num = files.len();
    log::info!("Load file_list_deleted gets {} files", files_num);
    if files.is_empty() {
        return Ok(());
    }

    let mut tasks = Vec::with_capacity(CONFIG.limit.query_thread_num + 1);
    let chunk_size = std::cmp::max(1, files_num / CONFIG.limit.query_thread_num);
    for chunk in files.chunks(chunk_size) {
        let chunk = chunk.to_vec();
        let task: tokio::task::JoinHandle<Result<ProcessStats, anyhow::Error>> =
            tokio::task::spawn(async move {
                let start = std::time::Instant::now();
                let mut stats = ProcessStats::default();
                for file in chunk {
                    match process_file(&file).await {
                        Err(err) => {
                            log::error!("Error processing file: {:?} {:?}", file, err);
                            continue;
                        }
                        Ok(files) => {
                            if files.is_empty() {
                                continue;
                            }
                            for (created_at, files) in files {
                                stats.file_count += files.len();
                                if let Err(e) =
                                    infra_file_list::batch_add_deleted(created_at, &files).await
                                {
                                    log::error!("Error sending file: {:?} {:?}", file, e);
                                    continue;
                                }
                            }
                        }
                    }
                    tokio::task::yield_now().await;
                }
                stats.download_time = start.elapsed().as_millis() as usize;
                Ok(stats)
            });
        tasks.push(task);
    }

    let task_results = try_join_all(tasks).await?;
    for task_result in task_results {
        stats = stats + task_result?;
    }
    stats.caching_time = start.elapsed().as_millis() as usize;

    log::info!(
        "Load file_list_deleted load {}:{} done, download: {}ms, caching: {}ms",
        files_num,
        stats.file_count,
        stats.download_time,
        stats.caching_time
    );

    // create table index
    infra_file_list::create_table_index().await?;
    log::info!("Load file_list_deleted create table index done");

    Ok(())
}

async fn process_file(file: &str) -> Result<HashMap<i64, Vec<String>>, anyhow::Error> {
    // download file list from storage
    let data = match storage::get(file).await {
        Ok(data) => data,
        Err(_) => {
            return Ok(HashMap::default());
        }
    };

    // uncompress file
    let uncompress = zstd::decode_all(data.reader())?;
    let uncompress_reader = BufReader::new(uncompress.reader());
    // parse file list
    let mut records = HashMap::default();
    for line in uncompress_reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        let (created_at, file) = line.split_once(';').unwrap();
        let created_at: i64 = created_at.parse()?;
        let entry = records.entry(created_at).or_insert_with(Vec::new);
        entry.push(file.to_string());
    }

    Ok(records)
}

#[derive(Debug, Clone, Default)]
struct ProcessStats {
    pub file_count: usize,
    pub download_time: usize,
    pub caching_time: usize,
}

impl std::ops::Add<ProcessStats> for ProcessStats {
    type Output = ProcessStats;

    fn add(self, rhs: ProcessStats) -> Self::Output {
        ProcessStats {
            file_count: self.file_count + rhs.file_count,
            download_time: self.download_time + rhs.download_time,
            caching_time: self.caching_time + rhs.caching_time,
        }
    }
}
