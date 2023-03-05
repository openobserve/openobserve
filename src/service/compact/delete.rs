use chrono::{Duration, TimeZone, Utc};
use std::collections::HashMap;
use std::io::Write;
use tokio::time;

use crate::common::json;
use crate::common::utils::is_local_disk_storage;
use crate::infra::config::CONFIG;
use crate::infra::{cache, ider, storage};
use crate::meta::common::{FileKey, FileMeta};
use crate::meta::StreamType;
use crate::service::{db, file_list};

pub async fn delete_all(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    // println!("delete_all: {}/{}/{}", org_id, stream_type, stream_name);
    if is_local_disk_storage() {
        let data_dir = format!(
            "{}/files/{}/{}/{}",
            CONFIG.common.data_stream_dir, org_id, stream_type, stream_name
        );
        let path = std::path::Path::new(&data_dir);
        if path.exists() {
            std::fs::remove_dir_all(path)?;
        }
    } else {
        // delete files from s3
        // first fetch file list from local cache
        let files = file_list::get_file_list(org_id, stream_name, Some(stream_type), 0, 0).await?;
        let storage = &storage::DEFAULT;
        match storage
            .del(&files.iter().map(|v| v.as_str()).collect::<Vec<_>>())
            .await
        {
            Ok(_) => {}
            Err(e) => {
                log::error!("[COMPACT] delete file failed: {}", e);
            }
        }

        // at the end, fetch a file list from s3 to guatantte there is no file
        let prefix = format!("files/{}/{}/{}/", org_id, stream_type, stream_name);
        loop {
            let files = storage.list(&prefix).await?;
            if files.is_empty() {
                break;
            }
            match storage
                .del(&files.iter().map(|v| v.as_str()).collect::<Vec<_>>())
                .await
            {
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

    // mark delete done
    db::compact::delete::delete_stream_done(org_id, stream_name, stream_type, None).await
}

pub async fn delete_by_date(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    date_range: (&str, &str),
) -> Result<(), anyhow::Error> {
    // println!(
    //     "delete_by_date: {}/{}/{}, {:?}",
    //     org_id, stream_type, stream_name, date_range
    // );
    let mut date_start = Utc.datetime_from_str(
        format!("{}T00:00:00Z", date_range.0).as_str(),
        "%Y-%m-%dT%H:%M:%SZ",
    )?;
    let date_end = Utc.datetime_from_str(
        format!("{}T23:59:59Z", date_range.1).as_str(),
        "%Y-%m-%dT%H:%M:%SZ",
    )?;
    let time_range = { (date_start.timestamp_micros(), date_end.timestamp_micros()) };

    if is_local_disk_storage() {
        while date_start <= date_end {
            let data_dir = format!(
                "{}/files/{}/{}/{}/{}",
                CONFIG.common.data_stream_dir,
                org_id,
                stream_type,
                stream_name,
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
        let files = file_list::get_file_list(
            org_id,
            stream_name,
            Some(stream_type),
            time_range.0,
            time_range.1,
        )
        .await?;
        let storage = &storage::DEFAULT;
        match storage
            .del(&files.iter().map(|v| v.as_str()).collect::<Vec<_>>())
            .await
        {
            Ok(_) => {}
            Err(e) => {
                log::error!("[COMPACT] delete file failed: {}", e);
            }
        }

        // at the end, fetch a file list from s3 to guatantte there is no file
        while date_start <= date_end {
            let prefix = format!(
                "files/{}/{}/{}/{}/",
                org_id,
                stream_type,
                stream_name,
                date_start.format("%Y/%m/%d")
            );
            loop {
                let files = storage.list(&prefix).await?;
                if files.is_empty() {
                    break;
                }
                match storage
                    .del(&files.iter().map(|v| v.as_str()).collect::<Vec<_>>())
                    .await
                {
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
    cache::stats::reset_stream_stats(
        org_id,
        stream_name,
        stream_type,
        FileMeta {
            min_ts: time_range.1,
            ..Default::default()
        },
    )?;

    // delete from file list
    delete_from_file_list(org_id, stream_name, stream_type, time_range).await?;

    // mark delete done
    db::compact::delete::delete_stream_done(org_id, stream_name, stream_type, Some(date_range))
        .await
}

async fn delete_from_file_list(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_range: (i64, i64),
) -> Result<(), anyhow::Error> {
    let files = file_list::get_file_list(
        org_id,
        stream_name,
        Some(stream_type),
        time_range.0,
        time_range.1,
    )
    .await?;
    if files.is_empty() {
        return Ok(());
    }

    let mut hours_files: HashMap<String, Vec<FileKey>> = HashMap::with_capacity(24);
    for file in files {
        let columns: Vec<_> = file.split('/').collect();
        let key = format!(
            "{}/{}/{}/{}",
            columns[4], columns[5], columns[6], columns[7]
        );
        let entry = hours_files.entry(key).or_default();
        entry.push(FileKey {
            key: file,
            meta: FileMeta::default(),
            deleted: true,
        });
    }

    let storage = &storage::DEFAULT;
    for (key, items) in hours_files {
        // upload the new file_list to storage
        let new_file_list_key = format!("file_list/{}/{}.json.zst", key, ider::generate());
        let mut buf = zstd::Encoder::new(Vec::new(), 3)?;
        for file in items.iter() {
            let mut write_buf = json::to_vec(&file)?;
            write_buf.push(b'\n');
            buf.write_all(&write_buf)?;
        }
        let compressed_bytes = buf.finish().unwrap();
        storage
            .put(&new_file_list_key, compressed_bytes.into())
            .await?;

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
                    time::sleep(time::Duration::from_secs(1)).await;
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
                time::sleep(time::Duration::from_secs(1)).await;
                continue;
            }
            break;
        }
    }

    Ok(())
}
