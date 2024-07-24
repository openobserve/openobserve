// Copyright 2024 Zinc Labs Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{
    io::{BufRead, BufReader, Write},
    sync::Arc,
};

use bytes::Buf;
use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc};
use config::{cluster::LOCAL_NODE_UUID, ider, meta::stream::FileKey, utils::json};
use hashbrown::HashMap;
use infra::{dist_lock, schema::STREAM_SCHEMAS_LATEST, storage};
use tokio::sync::{RwLock, Semaphore};

use crate::{common::infra::cluster::get_node_by_uuid, service::db};

pub async fn run(offset: i64) -> Result<(), anyhow::Error> {
    run_merge(offset).await?;
    run_delete().await?;
    Ok(())
}

/// check all streams done compact in this hour
/// merge all small file list keys in this hour to a single file and upload to
/// storage delete all small file list keys in this hour from storage
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
        // get earliest date from schema
        offset = time_now.timestamp_micros();
        let r = STREAM_SCHEMAS_LATEST.read().await;
        for (key, val) in r.iter() {
            if let Some(val) = val.schema().metadata.get("created_at") {
                let time_min = val.parse().unwrap();
                if time_min == 0 {
                    log::info!(
                        "[COMPACT] file_list stream [{}] created_at is 0, just skip",
                        key
                    );
                    continue;
                }
                if time_min < offset {
                    offset = time_min;
                }
            }
        }
        drop(r);
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
    // compact offset already is next hour, we need fix it, get the latest compact
    // offset
    let mut is_waiting_streams = false;
    for (key, val) in offsets {
        if (val - Duration::try_hours(1).unwrap().num_microseconds().unwrap()) < offset {
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
        // compact last hour, because it just done compaction that generated a lot of
        // small file_list files
        let time_last_hour = time_now - Duration::try_hours(1).unwrap();
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
    offset = offset_time_hour + Duration::try_hours(1).unwrap().num_microseconds().unwrap();
    db::compact::file_list::set_offset(offset).await
}

pub async fn run_delete() -> Result<(), anyhow::Error> {
    let days = db::compact::file_list::list_delete().await?;
    if days.is_empty() {
        return Ok(()); // no delete
    }

    for day in days {
        let mut t = DateTime::parse_from_rfc3339(&format!("{day}T00:00:00Z"))?.with_timezone(&Utc);
        for _hour in 0..24 {
            let offset = t.timestamp_micros();
            merge_file_list(offset).await?;
            t += Duration::try_hours(1).unwrap();
        }

        // delete day
        db::compact::file_list::del_delete(&day).await?;
    }

    Ok(())
}

/// merge and delete the small file list keys in this hour from etcd
/// upload new file list into storage
async fn merge_file_list(offset: i64) -> Result<(), anyhow::Error> {
    let lock_key = format!("/compact/file_list/{offset}");
    let locker = dist_lock::lock(&lock_key, 0, None).await?;
    let node = db::compact::file_list::get_process(offset).await;
    if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        dist_lock::unlock(&locker).await?;
        return Ok(()); // not this node, just skip
    }

    // before start merging, set current node to lock the offset
    let ret = db::compact::file_list::set_process(offset, &LOCAL_NODE_UUID.clone()).await;
    // already bind to this node, we can unlock now
    dist_lock::unlock(&locker).await?;
    drop(locker);
    ret?;

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
    let filter_file_keys: Arc<RwLock<HashMap<String, FileKey>>> =
        Arc::new(RwLock::new(HashMap::new()));
    let semaphore = std::sync::Arc::new(Semaphore::new(
        config::get_config().limit.file_merge_thread_num,
    ));
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
                log::info!(
                    "[COMPACT] file_list merge succeed, {} files into a new file: {}",
                    file_list.len(),
                    file_name
                );
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
