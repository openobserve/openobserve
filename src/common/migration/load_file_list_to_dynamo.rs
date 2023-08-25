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

use bytes::Buf;
use chrono::Local;
use futures::future::try_join_all;
use once_cell::sync::Lazy;
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use tokio::sync::RwLock;

use crate::common::{
    infra::{config::CONFIG, file_list, storage},
    meta::common::FileKey,
    utils::json,
};
use crate::service::db::file_list::{BLOCKED_ORGS, DELETED_FILES};

lazy_static! {
    static ref DYNAMO_DB_CLIENT: Box<dyn file_list::FileList> = connect();
}

pub fn connect() -> Box<dyn file_list::FileList> {
    Box::<file_list::dynamo::DynamoFileList>::default()
}

pub static LOADED_FILES: Lazy<RwLock<HashSet<String>>> =
    Lazy::new(|| RwLock::new(HashSet::with_capacity(24)));

pub async fn load(prefix: &str) -> Result<(), anyhow::Error> {
    println!("Start Loading file_list");
    let prefix = format!("file_list/{prefix}");
    let mut rw = LOADED_FILES.write().await;
    if rw.contains(&prefix) {
        return Ok(());
    }
    println!("Load file_list [{prefix}] begin");
    let mut files = storage::list(&prefix).await?;
    files.sort();
    for file in files.iter() {
        println!("file file: {:?}", file);
    }

    println!("Load file_list [{prefix}] gets {:?} files", files.len());
    if files.is_empty() {
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
                    match process_file(&file).await {
                        Ok(file_count) => count += file_count,
                        Err(err) => {
                            log::error!("Error processing file: {:?} {:?}", file, err);
                            continue;
                        }
                    }
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
    let delete_files = DELETED_FILES
        .iter()
        .map(|v| v.key().clone())
        .collect::<Vec<String>>();
    DYNAMO_DB_CLIENT.batch_remove(&delete_files).await?;

    println!(
        "Load file_list [{prefix}] load {}:{} done",
        files.len(),
        count
    );

    Ok(())
}

async fn process_file(file: &str) -> Result<usize, anyhow::Error> {
    let data = match storage::get(file).await {
        Ok(data) => data,
        Err(_) => {
            return Ok(0);
        }
    };
    // uncompress file
    let uncompress = zstd::decode_all(data.reader())?;
    let uncompress_reader = BufReader::new(uncompress.reader());
    // parse file list
    let mut count = 0;
    let mut total_count = 0;
    let mut file_keys = Vec::new();
    for line in uncompress_reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        let item: FileKey = json::from_slice(line.as_bytes())?;
        total_count += 1;
        // check blocked orgs
        if !BLOCKED_ORGS.is_empty() {
            let columns = item.key.split('/').collect::<Vec<&str>>();
            let org_id = columns.get(1).unwrap_or(&"");
            if BLOCKED_ORGS.contains(org_id) {
                continue;
            }
        }
        // check deleted files
        if item.deleted {
            DELETED_FILES.insert(item.key, item.meta.to_owned());
            continue;
        }
        count += 1;
        file_keys.push(item);
    }
    let now = Local::now();
    println!(
        "{}: Writing files to dynamo {} from total {}",
        now.format("%Y-%m-%d %H:%M:%S"),
        file_keys.len(),
        total_count
    );

    DYNAMO_DB_CLIENT.batch_add(&file_keys).await?;
    Ok(count)
}
