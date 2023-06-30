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

use chrono::{DateTime, Duration, TimeZone, Utc};
use std::{
    collections::{HashMap, HashSet},
    io::Write,
};

use crate::common::{json, utils::is_local_disk_storage};
use crate::infra::{
    cache,
    cluster::{get_node_by_uuid, LOCAL_NODE_UUID},
    config::CONFIG,
    dist_lock, ider, storage,
};
use crate::meta::{
    common::{FileKey, FileMeta},
    StreamType,
};
use crate::service::{db, file_list};

pub async fn delete_by_stream(
    lifecycle_end: &str,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    // get schema
    let stats = cache::stats::get_stream_stats(org_id, stream_name, stream_type);
    let created_at = stats.doc_time_min;
    if created_at == 0 {
        return Ok(()); // no data, just skip
    }
    let created_at: DateTime<Utc> = Utc.timestamp_nanos(created_at * 1000);
    let lifecycle_start = created_at.format("%Y-%m-%d").to_string();
    let lifecycle_start = lifecycle_start.as_str();
    if lifecycle_start.ge(lifecycle_end) {
        return Ok(()); // created_at is after lifecycle_end, just skip
    }

    // delete files
    db::compact::retention::delete_stream(
        org_id,
        stream_name,
        stream_type,
        Some((lifecycle_start, lifecycle_end)),
    )
    .await
}

pub async fn delete_all(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    let lock_key = format!("compact/retention/{org_id}/{stream_type}/{stream_name}");
    let mut locker = dist_lock::lock(&lock_key).await?;
    let node = db::compact::retention::get_stream(org_id, stream_name, stream_type, None).await;
    if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
        log::error!("[COMPACT] stream {org_id}/{stream_type}/{stream_name} is deleting by {node}");
        dist_lock::unlock(&mut locker).await?;
        return Ok(()); // not this node, just skip
    }

    // before start merging, set current node to lock the stream
    db::compact::retention::process_stream(
        org_id,
        stream_name,
        stream_type,
        None,
        &LOCAL_NODE_UUID.clone(),
    )
    .await?;
    // already bind to this node, we can unlock now
    dist_lock::unlock(&mut locker).await?;
    drop(locker);

    if is_local_disk_storage() {
        let data_dir = format!(
            "{}/files/{org_id}/{stream_type}/{stream_name}",
            CONFIG.common.data_stream_dir
        );
        let path = std::path::Path::new(&data_dir);
        if path.exists() {
            std::fs::remove_dir_all(path)?;
        }
        log::info!("deleted all files: {:?}", path);
    } else {
        // delete files from s3
        // first fetch file list from local cache
        let files = file_list::get_file_list(org_id, stream_name, stream_type, 0, 0)?;
        match storage::del(&files.iter().map(|v| v.as_str()).collect::<Vec<_>>()).await {
            Ok(_) => {}
            Err(e) => {
                log::error!("[COMPACT] delete file failed: {}", e);
            }
        }

        // at the end, fetch a file list from s3 to guatantte there is no file
        let prefix = format!("files/{org_id}/{stream_type}/{stream_name}/");
        loop {
            let files = storage::list(&prefix).await?;
            if files.is_empty() {
                break;
            }
            match storage::del(&files.iter().map(|v| v.as_str()).collect::<Vec<_>>()).await {
                Ok(_) => {}
                Err(e) => {
                    log::error!("[COMPACT] delete file failed: {}", e);
                }
            }
            tokio::task::yield_now().await; // yield to other tasks
        }
    }

    // delete from file list
    delete_from_file_list(org_id, stream_name, stream_type, (0, 0)).await?;
    log::info!(
        "deleted file list for: {}/{}/{}",
        org_id,
        stream_type,
        stream_name
    );

    // mark delete done
    db::compact::retention::delete_stream_done(org_id, stream_name, stream_type, None).await?;
    log::info!(
        "deleted stream all: {}/{}/{}",
        org_id,
        stream_type,
        stream_name
    );

    Ok(())
}

pub async fn delete_by_date(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    date_range: (&str, &str),
) -> Result<(), anyhow::Error> {
    let lock_key = format!("compact/retention/{org_id}/{stream_type}/{stream_name}");
    let mut locker = dist_lock::lock(&lock_key).await?;
    let node =
        db::compact::retention::get_stream(org_id, stream_name, stream_type, Some(date_range))
            .await;
    if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
        log::error!(
            "[COMPACT] stream {org_id}/{stream_type}/{stream_name}/{:?} is deleting by {node}",
            date_range
        );
        dist_lock::unlock(&mut locker).await?;
        return Ok(()); // not this node, just skip
    }

    // before start merging, set current node to lock the stream
    db::compact::retention::process_stream(
        org_id,
        stream_name,
        stream_type,
        Some(date_range),
        &LOCAL_NODE_UUID.clone(),
    )
    .await?;
    // already bind to this node, we can unlock now
    dist_lock::unlock(&mut locker).await?;
    drop(locker);

    let mut date_start =
        Utc.datetime_from_str(&format!("{}T00:00:00Z", date_range.0), "%Y-%m-%dT%H:%M:%SZ")?;
    let date_end =
        Utc.datetime_from_str(&format!("{}T23:59:59Z", date_range.1), "%Y-%m-%dT%H:%M:%SZ")?;
    let time_range = { (date_start.timestamp_micros(), date_end.timestamp_micros()) };

    if is_local_disk_storage() {
        while date_start <= date_end {
            let data_dir = format!(
                "{}/files/{org_id}/{stream_type}/{stream_name}/{}",
                CONFIG.common.data_stream_dir,
                date_start.format("%Y/%m/%d")
            );
            let path = std::path::Path::new(&data_dir);
            if path.exists() {
                std::fs::remove_dir_all(path)?;
            }
            date_start += Duration::days(1);
        }
    } else {
        // delete files from s3
        // first fetch file list from local cache
        let files =
            file_list::get_file_list(org_id, stream_name, stream_type, time_range.0, time_range.1)?;
        match storage::del(&files.iter().map(|v| v.as_str()).collect::<Vec<_>>()).await {
            Ok(_) => {}
            Err(e) => {
                log::error!("[COMPACT] delete file failed: {}", e);
            }
        }

        // at the end, fetch a file list from s3 to guatantte there is no file
        while date_start <= date_end {
            let prefix = format!(
                "files/{org_id}/{stream_type}/{stream_name}/{}/",
                date_start.format("%Y/%m/%d")
            );
            loop {
                let files = storage::list(&prefix).await?;
                if files.is_empty() {
                    break;
                }
                match storage::del(&files.iter().map(|v| v.as_str()).collect::<Vec<_>>()).await {
                    Ok(_) => {}
                    Err(e) => {
                        log::error!("[COMPACT] delete file failed: {}", e);
                    }
                }
                tokio::task::yield_now().await; // yield to other tasks
            }
            date_start += Duration::days(1);
        }
    }

    // update metadata
    cache::stats::reset_stream_stats_time(org_id, stream_name, stream_type, (time_range.1, 0))?;

    // delete from file list
    delete_from_file_list(org_id, stream_name, stream_type, time_range).await?;

    // mark delete done
    db::compact::retention::delete_stream_done(org_id, stream_name, stream_type, Some(date_range))
        .await
}

async fn delete_from_file_list(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_range: (i64, i64),
) -> Result<(), anyhow::Error> {
    let files =
        file_list::get_file_list(org_id, stream_name, stream_type, time_range.0, time_range.1)?;
    if files.is_empty() {
        return Ok(());
    }

    let mut file_list_days: HashSet<String> = HashSet::new();
    let mut hours_files: HashMap<String, Vec<FileKey>> = HashMap::with_capacity(24);
    for file in files {
        let columns: Vec<_> = file.split('/').collect();
        let day_key = format!("{}-{}-{}", columns[4], columns[5], columns[6]);
        file_list_days.insert(day_key);
        let hour_key = format!(
            "{}/{}/{}/{}",
            columns[4], columns[5], columns[6], columns[7]
        );
        let entry = hours_files.entry(hour_key).or_default();
        entry.push(FileKey {
            key: file,
            meta: FileMeta::default(),
            deleted: true,
        });
    }

    for (key, items) in hours_files {
        // upload the new file_list to storage
        let new_file_list_key = format!("file_list/{key}/{}.json.zst", ider::generate());
        let mut buf = zstd::Encoder::new(Vec::new(), 3)?;
        for file in items.iter() {
            let mut write_buf = json::to_vec(&file)?;
            write_buf.push(b'\n');
            buf.write_all(&write_buf)?;
        }
        let compressed_bytes = buf.finish().unwrap();
        storage::put(&new_file_list_key, compressed_bytes.into()).await?;

        // set to local cache & send broadcast
        // retry 10 times
        for _ in 0..9 {
            // set to local cache
            let mut cache_success = true;
            for event in &items {
                if let Err(e) = db::file_list::progress(&event.key, event.meta, event.deleted).await
                {
                    cache_success = false;
                    log::error!(
                        "[COMPACT] delete_from_file_list set local cache failed, retrying: {}",
                        e
                    );
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    break;
                }
            }
            if !cache_success {
                continue;
            }
            // send broadcast to other nodes
            if let Err(e) = db::file_list::broadcast::send(&items).await {
                log::error!(
                    "[COMPACT] delete_from_file_list send broadcast failed, retrying: {}",
                    e
                );
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                continue;
            }
            break;
        }
    }

    // mark file list need to do merge again
    for key in file_list_days {
        db::compact::file_list::set_delete(&key).await?;
    }

    Ok(())
}
