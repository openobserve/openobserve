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

use ::datafusion::{
    arrow::datatypes::Schema, datasource::file_format::file_type::FileType, error::DataFusionError,
};
use ahash::AHashMap;
use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc};
use std::{collections::HashMap, io::Write, sync::Arc};
use tokio::time;

use crate::common::json;
use crate::infra::{
    cache,
    cluster::{get_node_by_uuid, LOCAL_NODE_UUID},
    config::{CONFIG, FILE_EXT_PARQUET},
    db::etcd,
    dist_lock, ider, metrics, storage,
};
use crate::meta::{
    common::{FileKey, FileMeta},
    StreamType,
};
use crate::service::{db, file_list, search::datafusion};

/// compactor run steps on a stream:
/// 3. get a cluster lock for compactor stream
/// 4. read last compacted offset: year/month/day/hour
/// 5. read current hour all files
/// 6. compact small files to big files -> COMPACTOR_MAX_FILE_SIZE
/// 7. write to storage
/// 8. delete small files keys & write big files keys, use transaction
/// 9. delete small files from storage
/// 10. update last compacted offset
/// 11. release cluster lock
pub async fn merge_by_stream(
    last_file_list_offset: i64,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    let start = std::time::Instant::now();
    let lock_key = format!("compact/files/{org_id}/{stream_type}/{stream_name}");
    let mut locker = dist_lock::lock(&lock_key).await?;

    // get last compacted offset
    let (mut offset, node) =
        match db::compact::files::get_offset(org_id, stream_name, stream_type).await {
            Ok((offset, node)) => (offset, node),
            Err(e) => {
                dist_lock::unlock(&mut locker).await?;
                return Err(e);
            }
        };
    if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
        log::error!("[COMPACT] stream {org_id}/{stream_type}/{stream_name} is merging by {node}");
        dist_lock::unlock(&mut locker).await?;
        return Ok(()); // not this node, just skip
    }

    // get schema
    let schema = db::schema::get(org_id, stream_name, stream_type).await?;
    let schema_metadata = schema.metadata.clone();
    let schema = Arc::new(schema.with_metadata(HashMap::new()));
    if offset == 0 {
        offset = schema_metadata
            .get("created_at")
            .unwrap_or(&String::from("0"))
            .parse::<i64>()
            .unwrap();
    }
    if offset == 0 {
        dist_lock::unlock(&mut locker).await?;
        return Ok(()); // no data
    }
    let offset = offset;
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

    // check sync offset, if already synced, just set to next hour
    if offset < last_file_list_offset {
        // write new offset
        let offset = offset_time_hour + Duration::hours(1).num_microseconds().unwrap();
        db::compact::files::set_offset(org_id, stream_name, stream_type, offset, None).await?;
        // release cluster lock
        dist_lock::unlock(&mut locker).await?;
        return Ok(()); // the time is current hour, just wait
    }

    // check offset
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
    // if offset is future, just wait
    // if offset is last hour, must wait for at least 3 times of max_file_retention_time
    // - first period: the last hour local file upload to storage, write file list
    // - second period, the last hour file list upload to storage
    // - third period, we can do the merge, at least 3 times of max_file_retention_time
    if offset >= time_now_hour
        || (offset_time_hour + Duration::hours(1).num_microseconds().unwrap() == time_now_hour
            && time_now.timestamp_micros() - time_now_hour
                < Duration::seconds(CONFIG.limit.max_file_retention_time as i64)
                    .num_microseconds()
                    .unwrap()
                    * 3)
    {
        dist_lock::unlock(&mut locker).await?;
        return Ok(()); // the time is future, just wait
    }

    // before start merging, set current node to lock the stream
    db::compact::files::set_offset(
        org_id,
        stream_name,
        stream_type,
        offset,
        Some(&LOCAL_NODE_UUID.clone()),
    )
    .await?;
    // already bind to this node, we can unlock now
    dist_lock::unlock(&mut locker).await?;
    drop(locker);

    // get current hour all files
    let files = match file_list::get_file_list(
        org_id,
        stream_name,
        stream_type,
        offset_time_hour,
        offset_time_hour + Duration::hours(1).num_microseconds().unwrap()
            - Duration::seconds(1).num_microseconds().unwrap(),
    ) {
        Ok(files) => files,
        Err(err) => {
            return Err(err);
        }
    };

    if files.is_empty() {
        // this hour is no data, and check if pass allowed_upto, then just write new offset
        // if offset > 0 && offset_time_hour + Duration::hours(CONFIG.limit.allowed_upto).num_microseconds().unwrap() < time_now_hour {
        // -- no check it
        // }
        let offset = offset_time_hour + Duration::hours(1).num_microseconds().unwrap();
        db::compact::files::set_offset(org_id, stream_name, stream_type, offset, None).await?;
        return Ok(());
    }

    // do partition by partition key
    let mut partition_files_with_size: HashMap<String, Vec<(String, u64)>> = HashMap::default();
    for file in files {
        let prefix = {
            let pos = file.rfind('/').unwrap();
            file[..pos].to_string()
        };
        let partition = partition_files_with_size.entry(prefix).or_default();
        let file_meta = file_list::get_file_meta(&file)?;
        partition.push((file.clone(), file_meta.original_size));
    }

    for (prefix, files_with_size) in partition_files_with_size.iter_mut() {
        // sort by file size
        files_with_size.sort_by(|a, b| a.1.cmp(&b.1));
        // delete duplicated files
        files_with_size.dedup_by(|a, b| a.0 == b.0);
        loop {
            // yield to other tasks
            tokio::task::yield_now().await;
            // merge file and get the big file key
            let (new_file_name, new_file_meta, new_file_list) = merge_files(
                org_id,
                stream_name,
                stream_type,
                schema.clone(),
                prefix,
                files_with_size,
            )
            .await?;
            if new_file_name.is_empty() {
                break; // no file need to merge
            }

            // delete small files keys & write big files keys, use transaction
            let mut events = Vec::with_capacity(new_file_list.len() + 1);
            events.push(FileKey {
                key: new_file_name.clone(),
                meta: new_file_meta,
                deleted: false,
            });
            for file in new_file_list.iter() {
                events.push(FileKey {
                    key: file.clone(),
                    meta: FileMeta::default(),
                    deleted: true,
                });
            }

            // upload the new file_list to storage
            let new_file_list_key = format!(
                "file_list/{}/{}.json.zst",
                offset_time.format("%Y/%m/%d/%H"),
                ider::generate()
            );
            let mut buf = zstd::Encoder::new(Vec::new(), 3)?;
            for file in events.iter() {
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
                for event in &events {
                    if let Err(e) =
                        db::file_list::progress(&event.key, event.meta, event.deleted).await
                    {
                        cache_success = false;
                        log::error!("[COMPACT] set local cache failed, retrying: {}", e);
                        time::sleep(time::Duration::from_secs(1)).await;
                        break;
                    }
                }
                if !cache_success {
                    continue;
                }
                // send broadcast to other nodes
                if let Err(e) = db::file_list::broadcast::send(&events).await {
                    log::error!("[COMPACT] send broadcast failed, retrying: {}", e);
                    time::sleep(time::Duration::from_secs(1)).await;
                    continue;
                }
                // broadcast success
                break;
            }

            // delete small files from storage
            match storage::del(&new_file_list.iter().map(|v| v.as_str()).collect::<Vec<_>>()).await
            {
                Ok(_) => {}
                Err(e) => {
                    log::error!("[COMPACT] delete file failed: {}", e);
                }
            }
            // delete files from file list
            files_with_size.retain(|value| !&new_file_list.contains(&value.0));
        }
    }

    // write new offset
    let offset = offset_time_hour + Duration::hours(1).num_microseconds().unwrap();
    db::compact::files::set_offset(org_id, stream_name, stream_type, offset, None).await?;

    // metrics
    let time = start.elapsed().as_secs_f64();
    metrics::COMPACT_USED_TIME
        .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
        .inc_by(time);
    metrics::COMPACT_DELAY_HOURS
        .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
        .set((time_now_hour - offset_time_hour) / Duration::hours(1).num_microseconds().unwrap());

    // after delete, we need to shrink the file list
    cache::file_list::shrink_to_fit();

    Ok(())
}

/// merge some small files into one big file, upload to storage, returns the big file key and merged files
async fn merge_files(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: Arc<Schema>,
    prefix: &str,
    files_with_size: &Vec<(String, u64)>,
) -> Result<(String, FileMeta, Vec<String>), anyhow::Error> {
    if files_with_size.len() <= 1 {
        return Ok((String::from(""), FileMeta::default(), Vec::new()));
    }

    let mut new_file_size = 0;
    let mut new_file_list = Vec::new();
    let mut deleted_files = Vec::new();
    for (new_files_num, (file, size)) in files_with_size.iter().enumerate() {
        if new_files_num > etcd::MAX_OPS_PER_TXN
            || new_file_size + size > CONFIG.compact.max_file_size
        {
            break;
        }
        new_file_size += size;
        new_file_list.push(file.to_owned());
        log::info!("[COMPACT] merge small file: {}", file);
        // metrics
        metrics::COMPACT_MERGED_FILES
            .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
            .inc();
        metrics::COMPACT_MERGED_BYTES
            .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
            .inc_by(*size);
    }
    // no files need to merge
    if new_file_list.len() <= 1 {
        return Ok((String::from(""), FileMeta::default(), Vec::new()));
    }

    // write parquet files into tmpfs
    let tmp_dir = cache::tmpfs::Directory::default();
    for file in &new_file_list {
        let data = match storage::get(file).await {
            Ok(body) => body,
            Err(err) => {
                log::error!("[COMPACT] merge small file: {}, err: {}", file, err);
                deleted_files.push(file);
                continue;
            }
        };
        tmp_dir.set(file, data)?;
    }

    // convert the file to the latest version of schema
    let schema_versions = db::schema::get_versions(org_id, stream_name, stream_type).await?;
    let schema_latest = schema_versions.last().unwrap();
    let schema_latest_id = schema_versions.len() - 1;
    if CONFIG.common.widening_schema_evolution && schema_versions.len() > 1 {
        for file in &new_file_list {
            if deleted_files.contains(&file) {
                continue;
            }
            // get the schema version of the file
            let mut file_meta = file_list::get_file_meta(file).unwrap_or_default();
            let schema_ver_id = match db::schema::filter_schema_version_id(
                &schema_versions,
                file_meta.min_ts,
                file_meta.max_ts,
            ) {
                Some(id) => id,
                None => {
                    log::error!(
                        "[COMPACT] merge small file: {}, schema version not found, min_ts: {}, max_ts: {}",
                        file,
                        file_meta.min_ts,
                        file_meta.max_ts
                    );
                    // HACK: use the latest verion if not found in schema versions
                    schema_latest_id
                }
            };
            if schema_ver_id == schema_latest_id {
                continue;
            }
            // cacluate the diff between latest schema and current schema
            let schema = schema_versions[schema_ver_id]
                .clone()
                .with_metadata(HashMap::new());
            let mut diff_fields = AHashMap::default();
            let cur_fields = schema.fields();
            for field in cur_fields {
                if let Ok(v) = schema_latest.field_with_name(field.name()) {
                    if v.data_type() != field.data_type() {
                        diff_fields.insert(v.name().clone(), v.data_type().clone());
                    }
                }
            }
            if diff_fields.is_empty() {
                continue;
            }

            // do the convert
            if CONFIG.compact.fake_mode {
                log::info!("[COMPACT] fake convert parquet file: {file}");
                continue;
            }
            let mut buf = Vec::new();
            let file_tmp_dir = cache::tmpfs::Directory::default();
            let file_data = storage::get(file).await?;
            file_tmp_dir.set(file, file_data)?;
            datafusion::exec::convert_parquet_file(
                file_tmp_dir.name(),
                &mut buf,
                Arc::new(schema),
                diff_fields,
                FileType::PARQUET,
            )
            .await
            .map_err(|e| {
                DataFusionError::Plan(format!("convert_parquet_file {}, err: {}", file, e))
            })?;
            file_meta.compressed_size = buf.len() as u64;

            // replace the file in tmpfs
            tmp_dir.set(file, buf.into())?;
        }
    }

    // FAKE MODE
    if CONFIG.compact.fake_mode {
        log::info!(
            "[COMPACT] fake merge file succeeded, new file: fake.parquet, orginal_size: {new_file_size}, compressed_size: 0", 
        );
        return Ok(("".to_string(), FileMeta::default(), vec![]));
    }

    let mut buf = Vec::new();
    let mut new_file_meta =
        datafusion::exec::merge_parquet_files(tmp_dir.name(), &mut buf, schema).await?;
    new_file_meta.original_size = new_file_size;
    new_file_meta.compressed_size = buf.len() as u64;

    let id = ider::generate();
    let new_file_key = format!("{prefix}/{id}{}", FILE_EXT_PARQUET);

    log::info!(
        "[COMPACT] merge file succeeded, new file: {}, orginal_size: {}, compressed_size: {}",
        new_file_key,
        new_file_meta.original_size,
        new_file_meta.compressed_size,
    );

    // upload file
    match storage::put(&new_file_key, buf.into()).await {
        Ok(_) => Ok((new_file_key, new_file_meta, new_file_list)),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_compact() {
        let off_set = Duration::hours(2).num_microseconds().unwrap();
        let _ =
            db::compact::files::set_offset("nexus", "default", "logs".into(), off_set, None).await;
        let off_set_for_run = Duration::hours(1).num_microseconds().unwrap();
        let resp = merge_by_stream(off_set_for_run, "nexus", "default", "logs".into()).await;
        assert!(resp.is_ok());
    }
}
