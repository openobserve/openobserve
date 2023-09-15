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

use ahash::AHashMap;
use bytes::Buf;
use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc};
use std::{
    io::{BufRead, BufReader, Write},
    sync::Arc,
};
use tokio::sync::{RwLock, Semaphore};

use crate::common::infra::{
    cluster::{get_node_by_uuid, LOCAL_NODE_UUID},
    config::{CONFIG, STREAM_SCHEMAS},
    dist_lock, ider, storage,
};
use crate::common::meta::common::FileKey;
use crate::common::utils::json;
use crate::service::db;

pub async fn run(offset: i64) -> Result<(), anyhow::Error> {
    run_merge(offset).await?;
    run_delete().await?;
    Ok(())
}

/// check all streams done compact in this hour
/// merge all small file list keys in this hour to a single file and upload to storage
/// delete all small file list keys in this hour from storage
/// node should load new file list from storage
pub async fn run_merge(offset: i64) -> Result<(), anyhow::Error> {
    let time_now: DateTime<Utc> = Utc::now();
    let time_now_hour = Utc
        .with_ymd_and_hms(
            time_now.year(),
            time_now.month(),
            time_now.day(),
            time_now.hour(),
            0,
            0,
        )
        .unwrap()
        .timestamp_micros();

    let mut offset = offset;
    if offset == 0 {
        // get earilest date from schema
        offset = time_now.timestamp_micros();
        for item in STREAM_SCHEMAS.iter() {
            if let Some(val) = item.value().first().unwrap().metadata.get("created_at") {
                let time_min = val.parse().unwrap();
                if time_min == 0 {
                    log::info!(
                        "[COMPACT] file_list stream [{}] created_at is 0, just skip",
                        item.key()
                    );
                    continue;
                }
                if time_min < offset {
                    offset = time_min;
                }
            }
        }
    }

    // still not found, just return
    if offset == 0 {
        log::info!("[COMPACT] file_list no stream, no need to compact");
        return Ok(()); // no stream
    }
    // only compact for the past hour
    if offset >= time_now_hour {
        return Ok(());
    }

    let offset_time: DateTime<Utc> = Utc.timestamp_nanos(offset * 1000);
    let offset_time_hour = Utc
        .with_ymd_and_hms(
            offset_time.year(),
            offset_time.month(),
            offset_time.day(),
            offset_time.hour(),
            0,
            0,
        )
        .unwrap()
        .timestamp_micros();

    // check compact is done
    let offsets = db::compact::files::list_offset().await?;
    if offsets.is_empty() {
        return Ok(()); // no stream
    }
    // compact offset already is next hour, we need fix it, get the latest compact offset
    let mut is_waiting_streams = false;
    for (key, val) in offsets {
        if (val - Duration::hours(1).num_microseconds().unwrap()) < offset {
            log::info!("[COMPACT] file_list is waiting for stream: {key}, offset: {val}");
            is_waiting_streams = true;
            break;
        }
    }

    if is_waiting_streams {
        // compact zero hour for daily partiton
        let time_zero_hour = Utc
            .with_ymd_and_hms(time_now.year(), time_now.month(), time_now.day(), 0, 0, 0)
            .unwrap()
            .timestamp_micros();
        merge_file_list(time_zero_hour).await?;
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        // compact last hour, because it just done compaction that generated a lot of small file_list files
        let time_last_hour = time_now - Duration::hours(1);
        let time_last_hour = Utc
            .with_ymd_and_hms(
                time_last_hour.year(),
                time_last_hour.month(),
                time_last_hour.day(),
                time_last_hour.hour(),
                0,
                0,
            )
            .unwrap()
            .timestamp_micros();
        merge_file_list(time_last_hour).await?;
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        // compact current hour, because it continue to generate small file_list files
        merge_file_list(time_now_hour).await?;
        // it waiting, no need update offset
        return Ok(());
    }

    // compact zero hour for daily partiton
    let offset_zero_hour = Utc
        .with_ymd_and_hms(
            offset_time.year(),
            offset_time.month(),
            offset_time.day(),
            0,
            0,
            0,
        )
        .unwrap()
        .timestamp_micros();
    merge_file_list(offset_zero_hour).await?;
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

    // compact offset file list
    merge_file_list(offset).await?;

    // write new sync offset
    offset = offset_time_hour + Duration::hours(1).num_microseconds().unwrap();
    db::compact::file_list::set_offset(offset).await
}

pub async fn run_delete() -> Result<(), anyhow::Error> {
    let days = db::compact::file_list::list_delete().await?;
    if days.is_empty() {
        return Ok(()); // no delete
    }

    for day in days {
        let mut t = Utc.datetime_from_str(&format!("{day}T00:00:00Z"), "%Y-%m-%dT%H:%M:%SZ")?;
        for _hour in 0..24 {
            let offset = t.timestamp_micros();
            merge_file_list(offset).await?;
            t += Duration::hours(1);
        }

        // delete day
        db::compact::file_list::del_delete(&day).await?;
    }

    Ok(())
}

/// merge and delete the small file list keys in this hour from etcd
/// upload new file list into storage
async fn merge_file_list(offset: i64) -> Result<(), anyhow::Error> {
    let lock_key = format!("compact/file_list/{offset}");
    let locker = dist_lock::lock(&lock_key, CONFIG.etcd.command_timeout).await?;
    let node = db::compact::file_list::get_process(offset).await;
    if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
        log::error!("[COMPACT] list_list offset [{offset}] is merging by {node}");
        dist_lock::unlock(&locker).await?;
        return Ok(()); // not this node, just skip
    }

    // before start merging, set current node to lock the offset
    db::compact::file_list::set_process(offset, &LOCAL_NODE_UUID.clone()).await?;
    // already bind to this node, we can unlock now
    dist_lock::unlock(&locker).await?;
    drop(locker);

    // get all small file list keys in this hour
    let offset_time = Utc.timestamp_nanos(offset * 1000);
    let offset_prefix = offset_time.format("/%Y/%m/%d/%H/").to_string();
    let key = format!("file_list{offset_prefix}");
    log::info!("[COMPACT] file_list is merging, prefix: {key}");
    let file_list = storage::list(&key).await?;
    if file_list.len() <= 1 {
        db::compact::file_list::del_process(offset).await?;
        return Ok(()); // only one file list, no need merge
    }
    log::info!(
        "[COMPACT] file_list is merging, prefix: {key}, got files: {}",
        file_list.len()
    );

    // filter deleted file keys
    let filter_file_keys: Arc<RwLock<AHashMap<String, FileKey>>> =
        Arc::new(RwLock::new(AHashMap::default()));
    let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.file_move_thread_num));
    let mut tasks = Vec::new();
    for file in file_list.clone() {
        let filter_file_keys = filter_file_keys.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<Result<(), anyhow::Error>> =
            tokio::task::spawn(async move {
                log::info!("[COMPACT] file_list merge small files: {}", file);
                let data = match storage::get(&file).await {
                    Ok(val) => val,
                    Err(err) => {
                        drop(permit);
                        return Err(err);
                    }
                };
                // uncompress file
                let uncompress = match zstd::decode_all(data.reader()) {
                    Ok(val) => val,
                    Err(err) => {
                        drop(permit);
                        return Err(err.into());
                    }
                };
                let uncompress_reader = BufReader::new(uncompress.reader());
                // parse file list
                for line in uncompress_reader.lines() {
                    let line = match line {
                        Ok(val) => val,
                        Err(err) => {
                            drop(permit);
                            return Err(err.into());
                        }
                    };
                    if line.is_empty() {
                        continue;
                    }
                    let item: FileKey = match json::from_slice(line.as_bytes()) {
                        Ok(val) => val,
                        Err(err) => {
                            drop(permit);
                            return Err(err.into());
                        }
                    };
                    let mut filter_file_keys = filter_file_keys.write().await;
                    match filter_file_keys.get(&item.key) {
                        Some(_) => {
                            if item.deleted {
                                filter_file_keys.insert(item.key.clone(), item);
                            }
                        }
                        None => {
                            filter_file_keys.insert(item.key.clone(), item);
                        }
                    }
                }
                drop(permit);
                Ok(())
            });
        tasks.push(task);
    }

    // wait all tasks done
    for task in tasks {
        match task.await {
            Ok(ret) => match ret {
                Ok(_) => {}
                Err(err) => {
                    log::error!("[COMPACT] file_list merge small files failed: {}", err);
                }
            },
            Err(err) => {
                log::error!("[COMPACT] file_list merge small files failed: {}", err);
            }
        }
    }

    // write new file list
    let id = ider::generate();
    let file_name = format!("file_list{offset_prefix}{id}.json.zst");
    let mut buf = zstd::Encoder::new(Vec::new(), 3)?;
    let mut has_content = false;
    let filter_file_keys = filter_file_keys.read().await;
    for (_, item) in filter_file_keys.iter() {
        if item.deleted {
            continue;
        }
        let val = json::to_vec(&item)?;
        buf.write_all(val.as_slice())?;
        buf.write_all(b"\n")?;
        has_content = true;
    }
    let compressed_bytes = buf.finish().unwrap();

    let new_file_ok = if has_content {
        match storage::put(&file_name, compressed_bytes.into()).await {
            Ok(_) => {
                log::info!("[COMPACT] file_list merge succeed, new file: {}", file_name);
                true
            }
            Err(err) => {
                log::error!("[COMPACT] file_list upload failed: {}", err);
                false
            }
        }
    } else {
        true
    };
    if new_file_ok {
        // delete all small file list keys in this hour from storage
        if let Err(e) =
            storage::del(&file_list.iter().map(|v| v.as_str()).collect::<Vec<_>>()).await
        {
            log::error!("[COMPACT] file_list delete small file failed: {}", e);
        }
    }

    // clean progress mark
    db::compact::file_list::del_process(offset).await?;
    Ok(())
}
