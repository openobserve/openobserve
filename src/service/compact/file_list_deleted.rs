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

use ahash::AHashMap as HashMap;
use bytes::Buf;
use chrono::{DateTime, Duration, TimeZone, Utc};
use futures::future::try_join_all;
use std::io::{BufRead, BufReader};

use crate::common::infra::{config::CONFIG, file_list as infra_file_list, storage};

pub async fn delete(org_id: &str, time_min: i64, time_max: i64) -> Result<(), anyhow::Error> {
    let files = query_deleted(org_id, time_min, time_max).await?;
    if files.is_empty() {
        return Ok(());
    }
    // delete files from storage
    if let Err(e) = storage::del(
        &files
            .values()
            .flatten()
            .map(|file| file.as_str())
            .collect::<Vec<_>>(),
    )
    .await
    {
        // maybe the file already deleted, so we just skip the `not found` error
        if !e.to_string().to_lowercase().contains("not found") {
            log::error!("[COMPACT] delete files from storage failed: {}", e);
            return Err(e);
        }
    }

    // delete files from file_list_deleted s3
    if files.keys().len() > 1 || !files.contains_key("") {
        if let Err(e) =
            storage::del(&files.keys().map(|file| file.as_str()).collect::<Vec<_>>()).await
        {
            log::error!("[COMPACT] delete files from storage failed: {}", e);
            return Err(e);
        }
    }

    // delete files from file_list_deleted table
    if let Err(e) = infra_file_list::batch_remove_deleted(
        &files
            .values()
            .flatten()
            .map(|file| file.to_owned())
            .collect::<Vec<_>>(),
    )
    .await
    {
        log::error!("[COMPACT] delete files from table failed: {}", e);
        return Err(e.into());
    }

    Ok(())
}

async fn query_deleted(
    org_id: &str,
    time_min: i64,
    time_max: i64,
) -> Result<HashMap<String, Vec<String>>, anyhow::Error> {
    if CONFIG.common.meta_store_external {
        query_deleted_from_table(org_id, time_min, time_max).await
    } else {
        query_deleted_from_s3(org_id, time_min, time_max).await
    }
}

async fn query_deleted_from_table(
    org_id: &str,
    _time_min: i64,
    time_max: i64,
) -> Result<HashMap<String, Vec<String>>, anyhow::Error> {
    let files = infra_file_list::query_deleted(org_id, time_max).await?;
    let mut hash_files = HashMap::default();
    if !files.is_empty() {
        hash_files.insert("".to_string(), files);
    }
    Ok(hash_files)
}

async fn query_deleted_from_s3(
    org_id: &str,
    time_min: i64,
    time_max: i64,
) -> Result<HashMap<String, Vec<String>>, anyhow::Error> {
    let mut cur_time = if time_min != 0 {
        time_min
    } else {
        let prefix = format!("file_list_deleted/{org_id}/");
        let mut files = storage::list(&prefix).await?;
        if files.is_empty() {
            return Ok(HashMap::default());
        }
        files.sort();
        // file_list_deleted/{org_id}/{year}/{month}/{day}/{hour}/{file}.json.zst
        let file = files.first().unwrap();
        let columns = file.split('/').collect::<Vec<_>>();
        let time = Utc
            .with_ymd_and_hms(
                columns[2].parse::<i32>().unwrap(),
                columns[3].parse::<u32>().unwrap(),
                columns[4].parse::<u32>().unwrap(),
                columns[5].parse::<u32>().unwrap(),
                0,
                0,
            )
            .unwrap();
        time.timestamp_micros()
    };
    let mut files = HashMap::with_capacity(16);
    while cur_time <= time_max {
        let offset_time: DateTime<Utc> = Utc.timestamp_nanos(cur_time * 1000);
        let file_list_prefix = format!("{org_id}/{}", offset_time.format("%Y/%m/%d/%H/"));
        let prefix_files = load_prefix_from_s3(&file_list_prefix).await?;
        for (file, records) in prefix_files {
            let entry = files.entry(file).or_insert_with(Vec::new);
            entry.extend(records);
        }
        cur_time += Duration::hours(1).num_microseconds().unwrap();
    }
    Ok(files)
}

pub async fn load_prefix_from_s3(
    prefix: &str,
) -> Result<HashMap<String, Vec<String>>, anyhow::Error> {
    let prefix = format!("file_list_deleted/{prefix}/");
    let files = storage::list(&prefix).await?;
    let files_num = files.len();
    log::info!("Load file_list_deleted gets {} files", files_num);
    if files.is_empty() {
        return Ok(HashMap::default());
    }

    let mut tasks = Vec::with_capacity(CONFIG.limit.query_thread_num + 1);
    let chunk_size = std::cmp::max(1, files_num / CONFIG.limit.query_thread_num);
    for chunk in files.chunks(chunk_size) {
        let chunk = chunk.to_vec();
        let task: tokio::task::JoinHandle<Result<HashMap<String, Vec<String>>, anyhow::Error>> =
            tokio::task::spawn(async move {
                let mut files = HashMap::with_capacity(chunk.len());
                for file in chunk {
                    match process_file(&file).await {
                        Err(err) => {
                            log::error!("Error processing file: {:?} {:?}", file, err);
                            continue;
                        }
                        Ok(records) => {
                            if records.is_empty() {
                                continue;
                            }
                            let entry = files.entry(file).or_insert_with(Vec::new);
                            entry.extend(records);
                        }
                    }
                    tokio::task::yield_now().await;
                }
                Ok(files)
            });
        tasks.push(task);
    }

    let mut files = HashMap::with_capacity(files_num);
    let task_results = try_join_all(tasks).await?;
    for task_result in task_results {
        for (file, records) in task_result? {
            let entry = files.entry(file).or_insert_with(Vec::new);
            entry.extend(records);
        }
    }
    Ok(files)
}

async fn process_file(file: &str) -> Result<Vec<String>, anyhow::Error> {
    // download file list from storage
    let data = match storage::get(file).await {
        Ok(data) => data,
        Err(_) => {
            return Ok(Vec::new());
        }
    };

    // uncompress file
    let uncompress = zstd::decode_all(data.reader())?;
    let uncompress_reader = BufReader::new(uncompress.reader());
    // parse file list
    let mut records = Vec::with_capacity(16);
    for line in uncompress_reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        records.push(line);
    }

    Ok(records)
}
