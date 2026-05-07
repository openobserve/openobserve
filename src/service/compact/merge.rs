// Copyright 2026 OpenObserve Inc.
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

use std::sync::Arc;

use ::datafusion::{arrow::datatypes::Schema, error::DataFusionError};
use arrow::array::RecordBatch;
use bytes::Bytes;
use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc};
use config::{
    FileFormat, TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config, ider, is_local_disk_storage,
    meta::stream::{
        FileKey, FileListDeleted, FileMeta, MergeStrategy, PartitionTimeLevel, StorageType,
        StreamType,
    },
    metrics,
    utils::{
        parquet::{get_recordbatch_reader_from_bytes, read_schema_from_bytes},
        record_batch_ext::concat_batches,
        schema_ext::SchemaExt,
        time::{day_micros, hour_micros},
    },
};
use hashbrown::{HashMap, HashSet};
use infra::{
    cache::file_data,
    cluster::get_node_by_uuid,
    dist_lock, file_list as infra_file_list,
    runtime::DATAFUSION_RUNTIME,
    schema::{
        SchemaCache, get_partition_time_level, get_stream_setting_bloom_filter_fields,
        get_stream_setting_fts_fields, get_stream_setting_index_fields, unwrap_stream_created_at,
    },
    storage,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::downsampling::get_largest_downsampling_rule;
use tokio::{
    sync::{Semaphore, mpsc},
    task::JoinHandle,
};

use super::worker::{MergeBatch, MergeSender};
use crate::service::{
    db, file_list,
    schema::generate_schema_for_defined_schema_fields,
    search::datafusion::{
        exec::TableBuilder,
        merge::{self, MergeParquetResult},
    },
    tantivy::create_tantivy_index,
};

/// Generate merging job by stream
/// 1. get offset from db
/// 2. check if other node is processing
/// 3. create job or return
pub async fn generate_job_by_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    // get last compacted offset
    let (mut offset, node) = db::compact::files::get_offset(org_id, stream_type, stream_name).await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(()); // other node is processing
    }

    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        let lock_key = format!("/compact/merge/{org_id}/{stream_type}/{stream_name}");
        let locker = dist_lock::lock(&lock_key, 0).await?;
        // check the working node again, maybe other node locked it first
        let (offset, node) = db::compact::files::get_offset(org_id, stream_type, stream_name).await;
        if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            dist_lock::unlock(&locker).await?;
            return Ok(()); // other node is processing
        }
        // set to current node
        let ret = db::compact::files::set_offset(
            org_id,
            stream_type,
            stream_name,
            offset,
            Some(&LOCAL_NODE.uuid.clone()),
        )
        .await;
        dist_lock::unlock(&locker).await?;
        drop(locker);
        ret?;
    }

    // get schema
    let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    let stream_created = unwrap_stream_created_at(&schema).unwrap_or_default();
    if offset == 0 && stream_created > 0 {
        offset = stream_created
    } else if offset == 0 {
        return Ok(()); // no data
    }

    // format to hour with zero minutes, seconds
    let offset = offset - offset % hour_micros(1);

    let cfg = get_config();
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
    // must wait for at least 3 * max_file_retention_time
    // -- first period: the last hour local file upload to storage, write file list
    // -- second period, the last hour file list upload to storage
    // -- third period, we can do the merge, so, at least 3 times of
    // max_file_retention_time
    if offset >= time_now_hour
        || time_now.timestamp_micros() - offset
            <= Duration::try_seconds(cfg.limit.max_file_retention_time as i64)
                .unwrap()
                .num_microseconds()
                .unwrap()
                * 3
    {
        return Ok(()); // the time is future, just wait
    }

    log::debug!(
        "[COMPACTOR] generate_job_by_stream [{org_id}/{stream_type}/{stream_name}] offset: {offset}"
    );

    // generate merging job
    if let Err(e) = infra_file_list::add_job(org_id, stream_type, stream_name, offset).await {
        return Err(anyhow::anyhow!(
            "[COMPACTOR] add file_list_jobs failed: {e}"
        ));
    }

    // write new offset
    let offset = offset + hour_micros(1);
    db::compact::files::set_offset(
        org_id,
        stream_type,
        stream_name,
        offset,
        Some(&LOCAL_NODE.uuid.clone()),
    )
    .await?;

    Ok(())
}

/// Generate merging job by stream
/// 1. get old data by hour
/// 2. check if other node is processing
/// 3. create job or return
pub async fn generate_old_data_job_by_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    // get last compacted offset
    let (offset, node) = db::compact::files::get_offset(org_id, stream_type, stream_name).await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(()); // other node is processing
    }

    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        let lock_key = format!("/compact/merge/{org_id}/{stream_type}/{stream_name}");
        let locker = dist_lock::lock(&lock_key, 0).await?;
        // check the working node again, maybe other node locked it first
        let (offset, node) = db::compact::files::get_offset(org_id, stream_type, stream_name).await;
        if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            dist_lock::unlock(&locker).await?;
            return Ok(()); // other node is processing
        }
        // set to current node
        let ret = db::compact::files::set_offset(
            org_id,
            stream_type,
            stream_name,
            offset,
            Some(&LOCAL_NODE.uuid.clone()),
        )
        .await;
        dist_lock::unlock(&locker).await?;
        drop(locker);
        ret?;
    }

    if offset == 0 {
        return Ok(()); // no data
    }

    let cfg = get_config();
    let stream_settings = infra::schema::get_settings(org_id, stream_name, stream_type)
        .await
        .unwrap_or_default();
    let mut stream_data_retention_days = cfg.compact.data_retention_days;
    if stream_settings.data_retention > 0 {
        stream_data_retention_days = stream_settings.data_retention;
    }
    if stream_data_retention_days > cfg.compact.old_data_max_days {
        stream_data_retention_days = cfg.compact.old_data_max_days;
    }
    if stream_data_retention_days == 0 {
        return Ok(()); // no need to check old data
    }

    // get old data by hour, `offset - cfg.compact.old_data_min_hours hours` as old data
    let end_time = offset - hour_micros(cfg.compact.old_data_min_hours);
    let start_time = end_time
        - Duration::try_days(stream_data_retention_days)
            .unwrap()
            .num_microseconds()
            .unwrap();
    let hours = infra_file_list::query_old_data_hours(
        org_id,
        stream_type,
        stream_name,
        (start_time, end_time - 1),
    )
    .await?;

    // generate merging job
    for hour in hours {
        let column = hour.split('/').collect::<Vec<_>>();
        if column.len() != 4 {
            return Err(anyhow::anyhow!(
                "Unexpected hour format in {hour}, Expected format YYYY/MM/DD/HH",
            ));
        }
        let offset = DateTime::parse_from_rfc3339(&format!(
            "{}-{}-{}T{}:00:00Z",
            column[0], column[1], column[2], column[3]
        ))?
        .with_timezone(&Utc);
        let offset = offset.timestamp_micros();
        log::debug!(
            "[COMPACTOR] generate_old_data_job_by_stream [{org_id}/{stream_type}/{stream_name}] hours: {hour}, offset: {offset}"
        );
        if let Err(e) = infra_file_list::add_job(org_id, stream_type, stream_name, offset).await {
            return Err(anyhow::anyhow!(
                "[COMPACTOR] add file_list_jobs for old data failed: {e}"
            ));
        }
    }

    Ok(())
}

/// Generate downsampling job by stream and rule
/// 1. get offset from db
/// 2. check if other node is processing
/// 3. create job or return
pub async fn generate_downsampling_job_by_stream_and_rule(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    rule: (i64, i64), // offset, step
) -> Result<(), anyhow::Error> {
    assert!(stream_type == StreamType::Metrics);
    // get last compacted offset
    let (mut offset, node) =
        db::compact::downsampling::get_offset(org_id, stream_type, stream_name, rule).await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(()); // other node is processing
    }

    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        let lock_key = format!(
            "/compact/downsampling/{org_id}/{stream_type}/{stream_name}/{}/{}",
            rule.0, rule.1
        );
        let locker = dist_lock::lock(&lock_key, 0).await?;
        // check the working node again, maybe other node locked it first
        let (offset, node) =
            db::compact::downsampling::get_offset(org_id, stream_type, stream_name, rule).await;
        if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            dist_lock::unlock(&locker).await?;
            return Ok(()); // other node is processing
        }
        // set to current node
        let ret = db::compact::downsampling::set_offset(
            org_id,
            stream_type,
            stream_name,
            rule,
            offset,
            Some(&LOCAL_NODE.uuid.clone()),
        )
        .await;
        dist_lock::unlock(&locker).await?;
        drop(locker);
        ret?;
    }

    // get schema
    let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    let stream_created = unwrap_stream_created_at(&schema).unwrap_or_default();
    if offset == 0 {
        offset = stream_created
    }
    if offset == 0 {
        return Ok(()); // no data
    }

    let cfg = get_config();
    // check offset
    let time_now: DateTime<Utc> = Utc::now();
    let time_now_day = Utc
        .with_ymd_and_hms(time_now.year(), time_now.month(), time_now.day(), 0, 0, 0)
        .unwrap()
        .timestamp_micros();
    // must wait for at least 3 * max_file_retention_time + 1 day
    // -- first period: the last hour local file upload to storage, write file list
    // -- second period, the last hour file list upload to storage
    // -- third period, we can do the merge, so, at least 3 times of
    // -- 1 day, downsampling is in day level
    // max_file_retention_time
    if offset >= time_now_day
        || time_now.timestamp_micros() - offset
            <= Duration::try_seconds(cfg.limit.max_file_retention_time as i64)
                .unwrap()
                .num_microseconds()
                .unwrap()
                * 3
                + day_micros(1)
        || time_now.timestamp_micros() - rule.0 * 1_000_000 < offset
    {
        return Ok(()); // the time is future, just wait
    }

    log::debug!(
        "[DOWNSAMPLING] generate_downsampling_job_by_stream_and_rule [{org_id}/{stream_type}/{stream_name}] rule: {rule:?}, offset: {offset}"
    );

    // generate downsampling job
    if let Err(e) = infra_file_list::add_job(org_id, stream_type, stream_name, offset).await {
        return Err(anyhow::anyhow!(
            "[DOWNSAMPLING] add file_list_jobs failed: {e}"
        ));
    }

    // write new offset
    let offset = offset + day_micros(1);
    // format to day with zero hour, minutes, seconds
    let offset = offset - offset % day_micros(1);
    db::compact::downsampling::set_offset(
        org_id,
        stream_type,
        stream_name,
        rule,
        offset,
        Some(&LOCAL_NODE.uuid.clone()),
    )
    .await?;

    Ok(())
}

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
    worker_tx: mpsc::Sender<(MergeSender, MergeBatch)>,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    job_id: i64,
    offset: i64,
) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let start = std::time::Instant::now();

    // get schema
    let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    if schema == Schema::empty() {
        // the stream was deleted, mark the job as done
        if let Err(e) = infra_file_list::set_job_done(&[job_id]).await {
            log::error!("[COMPACTOR] set_job_done failed: {e}");
        }
        return Ok(());
    }

    log::debug!(
        "[COMPACTOR] merge_by_stream [{org_id}/{stream_type}/{stream_name}] offset: {offset}"
    );

    // check offset
    let partition_time_level = get_partition_time_level(stream_type);
    let offset_time: DateTime<Utc> = Utc.timestamp_nanos(offset * 1000);
    let (date_start, date_end) = if partition_time_level == PartitionTimeLevel::Daily {
        (
            offset_time.format("%Y/%m/%d/00").to_string(),
            offset_time.format("%Y/%m/%d/23").to_string(),
        )
    } else {
        (
            offset_time.format("%Y/%m/%d/%H").to_string(),
            offset_time.format("%Y/%m/%d/%H").to_string(),
        )
    };
    let files =
        file_list::query_for_merge(org_id, stream_type, stream_name, &date_start, &date_end)
            .await
            .map_err(|e| anyhow::anyhow!("query file list failed: {e}"))?;

    log::debug!(
        "[COMPACTOR] merge_by_stream [{org_id}/{stream_type}/{stream_name}] date range: [{date_start},{date_end}], files: {}",
        files.len(),
    );

    if files.is_empty() {
        // update job status
        if let Err(e) = infra_file_list::set_job_done(&[job_id]).await {
            log::error!("[COMPACTOR] set_job_done failed: {e}");
        }
        return Ok(());
    }

    // do partition by partition key
    let mut partition_files_with_size: HashMap<String, Vec<FileKey>> = HashMap::default();
    for file in files {
        let file_name = file.key.clone();
        let prefix = file_name[..file_name.rfind('/').unwrap()].to_string();
        let partition = partition_files_with_size.entry(prefix).or_default();
        partition.push(file.to_owned());
    }

    // use multiple threads to merge
    let semaphore = std::sync::Arc::new(Semaphore::new(cfg.limit.file_merge_thread_num));
    let mut tasks = Vec::with_capacity(partition_files_with_size.len());
    for (prefix, mut files_with_size) in partition_files_with_size.into_iter() {
        let org_id = org_id.to_string();
        let stream_name = stream_name.to_string();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let worker_tx = worker_tx.clone();
        let task: JoinHandle<Result<(), anyhow::Error>> = tokio::task::spawn(async move {
            let cfg = get_config();
            // sort by file size
            let job_strategy = MergeStrategy::from(&cfg.compact.strategy);
            match job_strategy {
                MergeStrategy::FileSize => {
                    files_with_size.sort_by(|a, b| a.meta.original_size.cmp(&b.meta.original_size));
                }
                MergeStrategy::FileTime => {
                    files_with_size.sort_by(|a, b| a.meta.min_ts.cmp(&b.meta.min_ts));
                }
                MergeStrategy::TimeRange => {
                    files_with_size = sort_by_time_range(files_with_size);
                }
            }

            #[cfg(feature = "enterprise")]
            let skip_group_files = stream_type == StreamType::Metrics
                && get_largest_downsampling_rule(
                    &stream_name,
                    files_with_size.iter().map(|f| f.meta.max_ts).max().unwrap(),
                )
                .is_some();

            #[cfg(not(feature = "enterprise"))]
            let skip_group_files = false;

            if files_with_size.len() <= 1 && !skip_group_files {
                return Ok(());
            }

            // group files need to merge
            let mut batch_groups = Vec::new();
            if skip_group_files {
                batch_groups.push(MergeBatch {
                    batch_id: 0,
                    org_id: org_id.clone(),
                    stream_type,
                    stream_name: stream_name.clone(),
                    prefix: prefix.clone(),
                    files: files_with_size.clone(),
                });
            } else {
                let mut new_file_list = Vec::new();
                let mut new_file_size = 0;
                for file in files_with_size.iter() {
                    if new_file_size + file.meta.original_size > cfg.compact.max_file_size as i64
                        || (cfg.compact.max_group_files > 0
                            && new_file_list.len() >= cfg.compact.max_group_files)
                    {
                        if new_file_list.len() <= 1 {
                            if job_strategy == MergeStrategy::FileSize {
                                break;
                            }
                            new_file_size = 0;
                            new_file_list.clear();
                            continue; // this batch don't need to merge, skip
                        }
                        batch_groups.push(MergeBatch {
                            batch_id: batch_groups.len(),
                            org_id: org_id.clone(),
                            stream_type,
                            stream_name: stream_name.clone(),
                            prefix: prefix.clone(),
                            files: new_file_list.clone(),
                        });
                        new_file_size = 0;
                        new_file_list.clear();
                    }
                    new_file_size += file.meta.original_size;
                    new_file_list.push(file.clone());
                }
                if new_file_list.len() > 1 {
                    batch_groups.push(MergeBatch {
                        batch_id: batch_groups.len(),
                        org_id: org_id.clone(),
                        stream_type,
                        stream_name: stream_name.clone(),
                        prefix: prefix.clone(),
                        files: new_file_list.clone(),
                    });
                }

                if batch_groups.is_empty() {
                    return Ok(()); // no files need to merge
                }
            }

            // send to worker
            let batch_group_len = batch_groups.len();
            let (inner_tx, mut inner_rx) = mpsc::channel(batch_group_len);
            for batch in batch_groups.iter() {
                if let Err(e) = worker_tx.send((inner_tx.clone(), batch.clone())).await {
                    log::error!("[COMPACTOR] send batch to worker failed: {e}");
                    return Err(anyhow::Error::msg("send batch to worker failed"));
                }
            }
            let mut worker_results = Vec::with_capacity(batch_group_len);
            for _ in 0..batch_group_len {
                let result = inner_rx.recv().await.unwrap();
                worker_results.push(result);
            }

            let mut last_error = None;
            let mut check_guard = HashSet::with_capacity(batch_groups.len());
            for ret in worker_results {
                let (batch_id, new_files) = match ret {
                    Ok(v) => v,
                    Err(e) => {
                        log::error!("[COMPACTOR] merge files failed: {e}");
                        last_error = Some(e);
                        continue;
                    }
                };

                if check_guard.contains(&batch_id) {
                    log::warn!(
                        "[COMPACTOR] merge files for stream: [{org_id}/{stream_type}/{stream_name}] found error files, batch_id: {batch_id} duplicate"
                    );
                    continue;
                }
                check_guard.insert(batch_id);

                // delete small files keys & write big files keys, use transaction
                let delete_file_list = batch_groups.get(batch_id).unwrap().files.as_slice();
                let mut events = Vec::with_capacity(new_files.len() + delete_file_list.len());
                for new_file in new_files {
                    if !new_file.key.is_empty() {
                        events.push(new_file);
                    }
                }

                for file in delete_file_list {
                    events.push(FileKey {
                        deleted: true,
                        segment_ids: None,
                        ..file.clone()
                    });
                }
                events.sort_by(|a, b| a.key.cmp(&b.key));

                // write file list to storage
                if let Err(e) = write_file_list(&org_id, stream_type, &events).await {
                    log::error!("[COMPACTOR] write file list failed: {e}");
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    continue;
                }
            }
            drop(permit);
            if let Some(e) = last_error {
                return Err(e);
            }
            Ok(())
        });
        tasks.push(task);
    }

    for task in tasks {
        task.await??;
    }

    // update job status
    if let Err(e) = infra_file_list::set_job_done(&[job_id]).await {
        log::error!("[COMPACTOR] set_job_done failed: {e}");
    }

    // metrics
    let time = start.elapsed().as_secs_f64();
    metrics::COMPACT_USED_TIME
        .with_label_values(&[org_id, stream_type.as_str()])
        .inc_by(time);

    Ok(())
}

// merge small files into big file, upload to storage, returns the big file key and merged files
// params:
// - thread_id: the id of the thread
// - org_id: the id of the organization
// - stream_type: the type of the stream
// - stream_name: the name of the stream
// - prefix: the prefix of the files
// - files_with_size: the files to merge
// returns:
// - new_files: the files that are merged
// - retain_file_list: the files that are not merged
pub async fn merge_files(
    thread_id: usize,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    prefix: &str,
    files_with_size: &[FileKey],
) -> Result<(Vec<FileKey>, Vec<FileKey>), anyhow::Error> {
    let start = std::time::Instant::now();
    #[cfg(feature = "enterprise")]
    let is_match_downsampling_rule = get_largest_downsampling_rule(
        stream_name,
        files_with_size.iter().map(|f| f.meta.max_ts).max().unwrap(),
    )
    .is_some();

    #[cfg(not(feature = "enterprise"))]
    let is_match_downsampling_rule = false;

    if files_with_size.len() <= 1 && !is_match_downsampling_rule {
        return Ok((Vec::new(), Vec::new()));
    }

    let mut new_file_size = 0;
    let mut new_compressed_file_size = 0;
    let mut new_file_list = Vec::new();
    let cfg = get_config();
    for file in files_with_size.iter() {
        if (new_file_size + file.meta.original_size > cfg.compact.max_file_size as i64
            || new_compressed_file_size + file.meta.compressed_size
                > cfg.compact.max_file_size as i64)
            && !is_match_downsampling_rule
        {
            break;
        }
        new_file_size += file.meta.original_size;
        new_compressed_file_size += file.meta.compressed_size;
        new_file_list.push(file.clone());
        // metrics
        metrics::COMPACT_MERGED_FILES
            .with_label_values(&[org_id, stream_type.as_str()])
            .inc();
        metrics::COMPACT_MERGED_BYTES
            .with_label_values(&[org_id, stream_type.as_str()])
            .inc_by(file.meta.original_size as u64);
    }
    // no files need to merge
    if new_file_list.len() <= 1 && !is_match_downsampling_rule {
        return Ok((Vec::new(), Vec::new()));
    }

    let retain_file_list = new_file_list.clone();

    // cache parquet files
    let deleted_files = cache_remote_files(&new_file_list).await?;
    log::info!(
        "[COMPACTOR:WORKER:{thread_id}] download {} parquet files, took: {} ms",
        new_file_list.len(),
        start.elapsed().as_millis()
    );
    if !deleted_files.is_empty() {
        new_file_list.retain(|f| !deleted_files.contains(&f.key));
    }
    if new_file_list.len() <= 1 && !is_match_downsampling_rule {
        return Ok((Vec::new(), retain_file_list));
    }

    // get time range and stats for these files in a single iteration
    let (min_ts, max_ts, total_records, new_file_size) = new_file_list.iter().fold(
        (i64::MAX, i64::MIN, 0, 0),
        |(min_ts, max_ts, records, size), file| {
            (
                min_ts.min(file.meta.min_ts),
                max_ts.max(file.meta.max_ts),
                records + file.meta.records,
                size + file.meta.original_size,
            )
        },
    );
    let min_ts = if min_ts == i64::MAX { 0 } else { min_ts };
    let max_ts = if max_ts == i64::MIN { 0 } else { max_ts };
    let new_file_meta = FileMeta {
        min_ts,
        max_ts,
        records: total_records,
        original_size: new_file_size,
        compressed_size: 0,
        flattened: false,
        index_size: 0,
    };
    if new_file_meta.records == 0 {
        return Err(anyhow::anyhow!("merge_files error: records is 0"));
    }

    // get latest version of schema
    let latest_schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    let stream_settings = infra::schema::unwrap_stream_settings(&latest_schema);
    let bloom_filter_fields = get_stream_setting_bloom_filter_fields(&stream_settings);
    let full_text_search_fields = get_stream_setting_fts_fields(&stream_settings);
    let index_fields = get_stream_setting_index_fields(&stream_settings);
    let (defined_schema_fields, need_original, index_original_data, index_all_values, storage_type) =
        match stream_settings {
            Some(s) => (
                s.defined_schema_fields,
                s.store_original_data,
                s.index_original_data,
                s.index_all_values,
                s.storage_type,
            ),
            None => (Vec::new(), false, false, false, StorageType::Normal),
        };
    let latest_schema = if !defined_schema_fields.is_empty() {
        let latest_schema = SchemaCache::new(latest_schema);
        let latest_schema = generate_schema_for_defined_schema_fields(
            stream_type,
            &latest_schema,
            &defined_schema_fields,
            need_original,
            index_original_data,
            index_all_values,
        );
        latest_schema.schema().clone()
    } else {
        Arc::new(latest_schema)
    };

    // read schema from parquet file and group files by schema
    let mut schemas = HashMap::new();
    let files = new_file_list.clone();
    let mut fi = 0;
    for file in new_file_list.iter() {
        fi += 1;
        log::info!(
            "[COMPACTOR:WORKER:{thread_id}:{fi}] merge small file: {}",
            &file.key
        );
        let buf = file_data::get(&file.account, &file.key, None).await?;
        let file_format = FileFormat::from_extension(&file.key)
            .ok_or_else(|| anyhow::anyhow!("invalid file format: {}", file.key))?;
        let schema = match read_schema_from_bytes(file_format, &buf).await {
            Ok(schema) => schema,
            Err(e) => {
                log::error!(
                    "[COMPACTOR:WORKER:{thread_id}:{fi}] read schema error for file: {}, err: {e}",
                    &file.key
                );
                return Err(e);
            }
        };
        let schema = schema.as_ref().clone().with_metadata(Default::default());
        let schema_key = schema.hash_key();
        if !schemas.contains_key(&schema_key) {
            schemas.insert(schema_key.clone(), schema);
        }
    }

    // generate the parquet schema
    let all_fields = schemas
        .values()
        .flat_map(|s| s.fields().iter().map(|f| f.name().to_string()))
        .collect::<HashSet<_>>();
    let schema = Arc::new(latest_schema.retain(all_fields));

    // generate datafusion tables
    let trace_id = ider::generate();
    let session = config::meta::search::Session {
        id: trace_id.to_string(),
        storage_type: config::meta::search::StorageType::Memory,
        work_group: None,
        target_partitions: 2,
    };

    let tables = match TableBuilder::new()
        .sorted_by_time(true)
        .build(session, files.clone(), schema.clone())
        .await
    {
        Ok(tables) => tables,
        Err(e) => {
            log::error!("create_parquet_table err: {e}, files: {files:?}, schema: {schema:?}");
            return Err(DataFusionError::Plan(format!("create_parquet_table err: {e}")).into());
        }
    };

    let merge_result = {
        let stream_name = stream_name.to_string();
        DATAFUSION_RUNTIME
            .spawn(async move {
                merge::merge_parquet_files(
                    stream_type,
                    &stream_name,
                    schema,
                    tables,
                    &bloom_filter_fields,
                    new_file_meta,
                    false,
                )
                .await
            })
            .await?
    };

    // clear session data
    crate::service::search::datafusion::storage::file_list::clear(&trace_id);

    let files = new_file_list.into_iter().map(|f| f.key).collect::<Vec<_>>();
    let buf = match merge_result {
        Ok(v) => v,
        Err(e) => {
            log::error!("merge_parquet_files err: {e}, files: {files:?}");
            return Err(DataFusionError::Plan(format!("merge_parquet_files err: {e}")).into());
        }
    };

    let latest_schema_fields = latest_schema
        .fields()
        .iter()
        .map(|f| f.name())
        .collect::<HashSet<_>>();
    let need_index = full_text_search_fields
        .iter()
        .chain(index_fields.iter())
        .any(|f| latest_schema_fields.contains(f));
    if !need_index {
        log::debug!("skip index generation for stream: {org_id}/{stream_type}/{stream_name}");
    }

    let mut new_files = Vec::new();
    match buf {
        MergeParquetResult::Single(buf, mut new_file_meta) => {
            if new_file_meta.compressed_size == 0 {
                return Err(anyhow::anyhow!(
                    "merge_parquet_files error: compressed_size is 0"
                ));
            }

            let id = ider::generate_file_name();
            let file_format = get_config().common.file_format.extension();
            let new_file_key = format!("{prefix}/{id}{file_format}");
            log::info!(
                "[COMPACTOR:WORKER:{thread_id}] merged {} files into a new file: {new_file_key}, original_size: {}, compressed_size: {}, took: {} ms",
                retain_file_list.len(),
                new_file_meta.original_size,
                new_file_meta.compressed_size,
                start.elapsed().as_millis(),
            );

            // upload file to storage
            let buf = Bytes::from(buf);
            if cfg.cache_latest_files.enabled
                && cfg.cache_latest_files.cache_parquet
                && cfg.cache_latest_files.download_from_node
            {
                infra::cache::file_data::disk::set(&new_file_key, buf.clone()).await?;
                log::debug!("merge_files {new_file_key} file_data::disk::set success");
            }

            let account = storage::get_account(&new_file_key).unwrap_or_default();
            if cfg.s3.feature_force_infrequent_access && storage_type.is_compliance() {
                storage::put_with_compliance(&account, &new_file_key, buf.clone()).await?;
            } else {
                storage::put(&account, &new_file_key, buf.clone()).await?;
            }

            if cfg.common.inverted_index_enabled && stream_type.support_index() && need_index {
                // generate inverted index
                generate_inverted_index(
                    &new_file_key,
                    &full_text_search_fields,
                    &index_fields,
                    &retain_file_list,
                    &mut new_file_meta,
                    latest_schema.clone(),
                    buf,
                )
                .await?;
            }
            new_files.push(FileKey::new(0, account, new_file_key, new_file_meta, false));
        }
        MergeParquetResult::Multiple { bufs, file_metas } => {
            for (buf, file_meta) in bufs.into_iter().zip(file_metas.into_iter()) {
                let mut new_file_meta = file_meta;
                new_file_meta.compressed_size = buf.len() as i64;
                if new_file_meta.compressed_size == 0 {
                    return Err(anyhow::anyhow!(
                        "merge_parquet_files error: compressed_size is 0"
                    ));
                }

                let id = ider::generate_file_name();
                let file_format = get_config().common.file_format.extension();
                let new_file_key = format!("{prefix}/{id}{file_format}");

                // upload file to storage
                let buf = Bytes::from(buf);
                if cfg.cache_latest_files.enabled
                    && cfg.cache_latest_files.cache_parquet
                    && cfg.cache_latest_files.download_from_node
                {
                    infra::cache::file_data::disk::set(&new_file_key, buf.clone()).await?;
                    log::debug!("merge_files {new_file_key} file_data::disk::set success");
                }

                let account = storage::get_account(&new_file_key).unwrap_or_default();
                if cfg.s3.feature_force_infrequent_access && storage_type.is_compliance() {
                    storage::put_with_compliance(&account, &new_file_key, buf.clone()).await?;
                } else {
                    storage::put(&account, &new_file_key, buf.clone()).await?;
                }

                if cfg.common.inverted_index_enabled && stream_type.support_index() && need_index {
                    // generate inverted index
                    generate_inverted_index(
                        &new_file_key,
                        &full_text_search_fields,
                        &index_fields,
                        &retain_file_list,
                        &mut new_file_meta,
                        latest_schema.clone(),
                        buf,
                    )
                    .await?;
                }

                new_files.push(FileKey::new(0, account, new_file_key, new_file_meta, false));
            }
            log::info!(
                "[COMPACTOR:WORKER:{thread_id}] merged {} files into a new file: {:?}, original_size: {}, compressed_size: {}, took: {} ms",
                retain_file_list.len(),
                new_files.iter().map(|f| f.key.as_str()).collect::<Vec<_>>(),
                new_files.iter().map(|f| f.meta.original_size).sum::<i64>(),
                new_files
                    .iter()
                    .map(|f| f.meta.compressed_size)
                    .sum::<i64>(),
                start.elapsed().as_millis(),
            );
        }
    };

    Ok((new_files, retain_file_list))
}

async fn generate_inverted_index(
    new_file_key: &str,
    full_text_search_fields: &[String],
    index_fields: &[String],
    retain_file_list: &[FileKey],
    new_file_meta: &mut FileMeta,
    latest_schema: Arc<Schema>,
    buf: Bytes,
) -> Result<(), anyhow::Error> {
    let file_format = get_config().common.file_format;
    let (_, reader) = get_recordbatch_reader_from_bytes(file_format, buf).await?;
    let index_size = create_tantivy_index(
        "COMPACTOR",
        new_file_key,
        full_text_search_fields,
        index_fields,
        latest_schema, // Use stream schema to include all configured fields
        reader,
    )
    .await
    .map_err(|e| {
        anyhow::anyhow!(
            "create_tantivy_index_on_compactor for file: {new_file_key}, error: {e}, need delete files: {retain_file_list:?}",
        )
    })?;
    new_file_meta.index_size = index_size as i64;

    Ok(())
}

async fn write_file_list(
    org_id: &str,
    stream_type: StreamType,
    events: &[FileKey],
) -> Result<(), anyhow::Error> {
    if events.is_empty() {
        return Ok(());
    }

    let del_items = events
        .iter()
        .filter(|v| v.deleted)
        .map(|v| FileListDeleted {
            id: 0,
            account: v.account.clone(),
            file: v.key.clone(),
            index_file: v.meta.index_size > 0,
            flattened: v.meta.flattened,
        })
        .collect::<Vec<_>>();

    // set to db
    // retry 5 times
    let cfg = get_config();
    let mut success = false;
    let mut mark_deleted_done = false;
    let created_at = config::utils::time::now_micros();
    for _ in 0..5 {
        if !mark_deleted_done && let Err(e) = infra::file_list::batch_process(events).await {
            log::error!("[COMPACTOR] batch_process to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        mark_deleted_done = true;
        if !del_items.is_empty()
            && let Err(e) = infra_file_list::batch_add_deleted(org_id, created_at, &del_items).await
        {
            log::error!("[COMPACTOR] batch_add_deleted to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        success = true;
        break;
    }

    // handle dump_stats for file_list type streams
    if success && stream_type == StreamType::Filelist && cfg.compact.file_list_dump_enabled {
        let (deleted_files, new_files): (Vec<_>, Vec<_>) = events.iter().partition(|e| e.deleted);
        super::dump::handle_dump_stats_on_merge(&deleted_files, &new_files).await;
    }

    if success {
        // send broadcast to other nodes
        if cfg.cache_latest_files.enabled {
            // get id for all the new files
            let file_ids = infra_file_list::query_ids_by_files(events).await?;
            let mut events = events.to_vec();
            for event in events.iter_mut() {
                if let Some(id) = file_ids.get(&event.key) {
                    event.id = *id;
                }
            }
            if let Err(e) = db::file_list::broadcast::send(&events).await {
                log::error!("[COMPACTOR] send broadcast for file_list failed: {e}");
            }
        }
    } else {
        return Err(anyhow::anyhow!("batch_write to db failed"));
    }

    Ok(())
}

pub fn generate_inverted_idx_recordbatch(
    schema: Arc<Schema>,
    batches: &[RecordBatch],
    stream_type: StreamType,
    full_text_search_fields: &[String],
    index_fields: &[String],
) -> Result<Option<RecordBatch>, anyhow::Error> {
    let cfg = get_config();
    if !cfg.common.inverted_index_enabled || batches.is_empty() || !stream_type.support_index() {
        return Ok(None);
    }

    let schema_fields = schema
        .fields()
        .iter()
        .map(|f| f.name())
        .collect::<HashSet<_>>();

    let mut inverted_idx_columns: Vec<String> = if !full_text_search_fields.is_empty() {
        full_text_search_fields.to_vec()
    } else {
        config::SQL_FULL_TEXT_SEARCH_FIELDS.to_vec()
    };
    inverted_idx_columns.extend(index_fields.to_vec());
    inverted_idx_columns.sort();
    inverted_idx_columns.dedup();
    inverted_idx_columns.retain(|f| schema_fields.contains(f));
    if inverted_idx_columns.is_empty() {
        return Ok(None);
    }
    // add _timestamp column to columns_to_index
    if !inverted_idx_columns.contains(&TIMESTAMP_COL_NAME.to_string()) {
        inverted_idx_columns.push(TIMESTAMP_COL_NAME.to_string());
    }

    let mut inverted_idx_batches = Vec::with_capacity(batches.len());
    for batch in batches {
        let selected_column_indices: Vec<usize> = inverted_idx_columns
            .iter()
            .filter_map(|name| batch.schema().index_of(name).ok())
            .collect();

        // Use the found indices to select the columns
        let selected_columns = selected_column_indices
            .iter()
            .map(|&i| batch.column(i).clone())
            .collect();

        // Create a new schema for the new RecordBatch based on the selected columns
        let selected_fields: Vec<arrow_schema::Field> = selected_column_indices
            .iter()
            .map(|&i| batch.schema().field(i).clone())
            .collect();
        let new_schema = Arc::new(Schema::new(selected_fields));

        // Create a new RecordBatch with the selected columns
        inverted_idx_batches.push(RecordBatch::try_new(new_schema, selected_columns).unwrap());
    }

    if inverted_idx_batches.is_empty() {
        Ok(None)
    } else {
        let new_batch = if inverted_idx_batches.len() == 1 {
            inverted_idx_batches.remove(0)
        } else {
            let new_schema = inverted_idx_batches.first().unwrap().schema();
            concat_batches(new_schema, inverted_idx_batches).map_err(anyhow::Error::from)?
        };

        if matches!(
            new_batch.schema().fields().len(),
            0 | 1 if new_batch.schema().field(0).name() == TIMESTAMP_COL_NAME
        ) {
            Ok(None)
        } else {
            Ok(Some(new_batch))
        }
    }
}

async fn cache_remote_files(files: &[FileKey]) -> Result<Vec<String>, anyhow::Error> {
    let cfg = get_config();
    let scan_size = files.iter().map(|f| f.meta.compressed_size).sum::<i64>();
    if is_local_disk_storage()
        || !cfg.disk_cache.enabled
        || scan_size >= cfg.disk_cache.skip_size as i64
    {
        return Ok(Vec::new());
    };

    let mut tasks = Vec::with_capacity(files.len());
    let semaphore = std::sync::Arc::new(Semaphore::new(cfg.limit.cpu_num));
    for file in files.iter() {
        let file_account = file.account.to_string();
        let file_name = file.key.to_string();
        let file_size = file.meta.compressed_size as usize;
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<Option<String>> = tokio::task::spawn(async move {
            let ret = if !file_data::disk::exist(&file_name).await {
                file_data::disk::download(&file_account, &file_name, Some(file_size)).await
            } else {
                Ok(0)
            };
            // In case where the parquet file is not found or has no data, we assume that it
            // must have been deleted by some external entity, and hence we
            // should remove the entry from file_list table.
            let file_name = match ret {
                Ok(data_len) => {
                    if data_len > 0 && data_len != file_size {
                        log::warn!(
                            "[COMPACT] download file {file_name} found size mismatch, expected: {file_size}, actual: {data_len}, will skip it",
                        );
                        // update database
                        // if let Err(e) =
                        //     file_list::update_compressed_size(&file_name, data_len as i64).await
                        // {
                        //     log::error!(
                        //         "[COMPACT] update file size for file {} err: {}",
                        //         file_name,
                        //         e
                        //     );
                        // }
                        // skip this file for compact
                        Some(file_name)
                    } else {
                        None
                    }
                }
                Err(e) => {
                    if e.to_string().to_lowercase().contains("not found")
                        || e.to_string().to_lowercase().contains("data size is zero")
                    {
                        // delete file from file list
                        log::error!("[COMPACT] found invalid file: {file_name}, will delete it");
                        if let Err(e) =
                            file_list::delete_parquet_file(&file_account, &file_name, true).await
                        {
                            log::error!("[COMPACT] delete from file_list err: {e}");
                        }
                        Some(file_name)
                    } else {
                        log::error!("[COMPACT] download file to cache err: {e}");
                        // remove downloaded file
                        let _ = file_data::disk::remove(&file_name).await;
                        None
                    }
                }
            };
            drop(permit);
            file_name
        });
        tasks.push(task);
    }

    let mut delete_files = Vec::new();
    for task in tasks {
        match task.await {
            Ok(file) => {
                if let Some(file) = file {
                    delete_files.push(file);
                }
            }
            Err(e) => {
                log::error!("[COMPACTOR] load file task err: {e}");
            }
        }
    }

    Ok(delete_files)
}

/// sort by time range without overlapping
fn sort_by_time_range(mut file_list: Vec<FileKey>) -> Vec<FileKey> {
    let files_num = file_list.len();
    file_list.sort_by_key(|f| f.meta.min_ts);
    let mut groups: Vec<Vec<FileKey>> = Vec::with_capacity(files_num);
    for file in file_list {
        let mut inserted = None;
        for (i, group) in groups.iter().enumerate() {
            if group
                .last()
                .is_some_and(|f| file.meta.min_ts >= f.meta.max_ts)
            {
                inserted = Some(i);
                break;
            }
        }
        if let Some(i) = inserted {
            groups[i].push(file);
        } else {
            groups.push(vec![file]);
        }
    }
    let mut files = Vec::with_capacity(files_num);
    for group in groups {
        files.extend(group);
    }
    files
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use config::meta::stream::{FileKey, FileMeta};

    use super::*;

    // Helper function to create test FileKey
    fn create_file_key(key: &str, min_ts: i64, max_ts: i64, original_size: i64) -> FileKey {
        FileKey {
            id: 0,
            account: "test_account".to_string(),
            key: key.to_string(),
            meta: FileMeta {
                min_ts,
                max_ts,
                records: 100,
                original_size,
                compressed_size: original_size / 2, // assume 50% compression
                index_size: 0,
                flattened: false,
            },
            deleted: false,
            segment_ids: None,
        }
    }

    #[test]
    fn test_sort_by_time_range_edge_case_adjacent_files() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 2000, 1024),
            create_file_key("file2.parquet", 2000, 3000, 1024), // exactly adjacent
            create_file_key("file3.parquet", 3000, 4000, 1024), // exactly adjacent
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);

        // Adjacent files should be able to be in the same group
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[1].key, "file2.parquet");
        assert_eq!(result[2].key, "file3.parquet");
    }

    // Test helper function creation
    #[test]
    fn test_create_file_key_helper() {
        let file_key = create_file_key("test.parquet", 1000, 2000, 1024);
        assert_eq!(file_key.key, "test.parquet");
        assert_eq!(file_key.meta.min_ts, 1000);
        assert_eq!(file_key.meta.max_ts, 2000);
        assert_eq!(file_key.meta.original_size, 1024);
        assert_eq!(file_key.meta.compressed_size, 512); // 50% compression
        assert_eq!(file_key.meta.records, 100);
        assert!(!file_key.meta.flattened);
        assert_eq!(file_key.id, 0);
        assert_eq!(file_key.account, "test_account");
        assert!(!file_key.deleted);
        assert!(file_key.segment_ids.is_none());
    }

    // Boundary tests for sort_by_time_range
    #[test]
    fn test_sort_by_time_range_negative_timestamps() {
        let files = vec![
            create_file_key("file1.parquet", -2000, -1000, 1024),
            create_file_key("file2.parquet", -1000, 0, 1024),
            create_file_key("file3.parquet", 0, 1000, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[1].key, "file2.parquet");
        assert_eq!(result[2].key, "file3.parquet");
    }

    #[test]
    fn test_sort_by_time_range_large_timestamps() {
        let files = vec![
            create_file_key("file1.parquet", i64::MAX - 2000, i64::MAX - 1000, 1024),
            create_file_key("file2.parquet", i64::MAX - 1000, i64::MAX, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[1].key, "file2.parquet");
    }

    // Edge case where min_ts equals max_ts (point in time)
    #[test]
    fn test_sort_by_time_range_point_in_time() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 1000, 1024), // Point in time
            create_file_key("file2.parquet", 1000, 2000, 1024), // Overlaps with file1
            create_file_key("file3.parquet", 2000, 2000, 1024), // Point in time, adjacent
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);

        // Verify all files are present
        let keys: Vec<&String> = result.iter().map(|f| &f.key).collect();
        assert!(keys.contains(&&"file1.parquet".to_string()));
        assert!(keys.contains(&&"file2.parquet".to_string()));
        assert!(keys.contains(&&"file3.parquet".to_string()));
    }

    #[test]
    fn test_sort_by_time_range_many_files_random_order() {
        let files = vec![
            create_file_key("file_f.parquet", 6000, 7000, 1024),
            create_file_key("file_b.parquet", 2000, 3000, 1024),
            create_file_key("file_d.parquet", 4000, 5000, 1024),
            create_file_key("file_a.parquet", 1000, 2000, 1024),
            create_file_key("file_c.parquet", 3000, 4000, 1024),
            create_file_key("file_e.parquet", 5000, 6000, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 6);

        // Should be sorted by min_ts (all adjacent files)
        assert_eq!(result[0].key, "file_a.parquet");
        assert_eq!(result[1].key, "file_b.parquet");
        assert_eq!(result[2].key, "file_c.parquet");
        assert_eq!(result[3].key, "file_d.parquet");
        assert_eq!(result[4].key, "file_e.parquet");
        assert_eq!(result[5].key, "file_f.parquet");
    }

    #[test]
    fn test_sort_by_time_range_gaps_between_files() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 2000, 1024),
            create_file_key("file2.parquet", 5000, 6000, 1024), // gap after file1
            create_file_key("file3.parquet", 3000, 4000, 1024), // fits in gap
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);

        // Should be sorted by min_ts
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[1].key, "file3.parquet");
        assert_eq!(result[2].key, "file2.parquet");
    }

    #[test]
    fn test_sort_by_time_range_empty_list() {
        let files = vec![];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_sort_by_time_range_single_file() {
        let files = vec![create_file_key("file1.parquet", 1000, 2000, 1024)];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[0].meta.min_ts, 1000);
        assert_eq!(result[0].meta.max_ts, 2000);
    }

    #[test]
    fn test_sort_by_time_range_already_sorted_non_overlapping() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 2000, 1024),
            create_file_key("file2.parquet", 2000, 3000, 1024),
            create_file_key("file3.parquet", 3000, 4000, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[1].key, "file2.parquet");
        assert_eq!(result[2].key, "file3.parquet");
    }

    #[test]
    fn test_sort_by_time_range_unsorted_non_overlapping() {
        let files = vec![
            create_file_key("file3.parquet", 3000, 4000, 1024),
            create_file_key("file1.parquet", 1000, 2000, 1024),
            create_file_key("file2.parquet", 2000, 3000, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);
        // Should be sorted by min_ts
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[1].key, "file2.parquet");
        assert_eq!(result[2].key, "file3.parquet");
    }

    #[test]
    fn test_sort_by_time_range_overlapping_files() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 2500, 1024), // overlaps with file2
            create_file_key("file2.parquet", 2000, 3000, 1024), // overlaps with file1
            create_file_key("file3.parquet", 3500, 4000, 1024), // non-overlapping
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);

        // First file should be file1 (min_ts = 1000)
        assert_eq!(result[0].key, "file1.parquet");

        // Due to overlapping, file3 should come next (can fit in same group as file1)
        // file2 would be in a separate group since it overlaps with file1
        let mut found_file2 = false;
        let mut found_file3 = false;
        for file in &result {
            if file.key == "file2.parquet" {
                found_file2 = true;
            }
            if file.key == "file3.parquet" {
                found_file3 = true;
            }
        }
        assert!(found_file2);
        assert!(found_file3);
    }

    #[test]
    fn test_sort_by_time_range_complex_overlapping() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 1500, 1024),
            create_file_key("file2.parquet", 1200, 1800, 1024), // overlaps with file1
            create_file_key("file3.parquet", 1600, 2000, 1024), // overlaps with file2
            create_file_key("file4.parquet", 2000, 2500, 1024), // adjacent to file3
            create_file_key("file5.parquet", 3000, 3500, 1024), // separate group
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 5);

        // Verify all files are present
        let keys: Vec<&String> = result.iter().map(|f| &f.key).collect();
        assert!(keys.contains(&&"file1.parquet".to_string()));
        assert!(keys.contains(&&"file2.parquet".to_string()));
        assert!(keys.contains(&&"file3.parquet".to_string()));
        assert!(keys.contains(&&"file4.parquet".to_string()));
        assert!(keys.contains(&&"file5.parquet".to_string()));
    }

    #[test]
    fn test_sort_by_time_range_identical_timestamps() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 2000, 1024),
            create_file_key("file2.parquet", 1000, 2000, 512),
            create_file_key("file3.parquet", 1000, 2000, 2048),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);

        // All files have same timestamp, so they should all be in separate groups
        // due to overlap, but ordering should be maintained based on original order after sorting
        let keys: Vec<&String> = result.iter().map(|f| &f.key).collect();
        assert_eq!(keys.len(), 3);
        assert!(keys.contains(&&"file1.parquet".to_string()));
        assert!(keys.contains(&&"file2.parquet".to_string()));
        assert!(keys.contains(&&"file3.parquet".to_string()));
    }

    // Test cases for generate_inverted_idx_recordbatch function
    #[test]
    fn test_generate_inverted_idx_recordbatch_empty_batches() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("field1", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batches: Vec<RecordBatch> = vec![];
        let full_text_search_fields = vec!["field1".to_string()];
        let index_fields = vec![];

        let result = generate_inverted_idx_recordbatch(
            schema,
            &batches,
            StreamType::Logs,
            &full_text_search_fields,
            &index_fields,
        );

        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_generate_inverted_idx_recordbatch_with_fts_fields() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("message", DataType::Utf8, true),
            Field::new("level", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let message_array = StringArray::from(vec!["log message 1", "log message 2"]);
        let level_array = StringArray::from(vec!["info", "error"]);
        let timestamp_array = Int64Array::from(vec![1000, 2000]);

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(message_array),
                Arc::new(level_array),
                Arc::new(timestamp_array),
            ],
        )
        .unwrap();

        let batches = vec![batch];
        let full_text_search_fields = vec!["message".to_string()];
        let index_fields = vec![];

        let result = generate_inverted_idx_recordbatch(
            schema,
            &batches,
            StreamType::Logs,
            &full_text_search_fields,
            &index_fields,
        );

        assert!(result.is_ok());
        let batch_result = result.unwrap();
        assert!(batch_result.is_some());

        let inverted_batch = batch_result.unwrap();
        assert_eq!(inverted_batch.num_rows(), 2);
        assert_eq!(inverted_batch.num_columns(), 2); // message + _timestamp
    }

    #[test]
    fn test_generate_inverted_idx_recordbatch_with_index_fields() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("user_id", DataType::Utf8, true),
            Field::new("session_id", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let user_id_array = StringArray::from(vec!["user1", "user2"]);
        let session_id_array = StringArray::from(vec!["session1", "session2"]);
        let timestamp_array = Int64Array::from(vec![1000, 2000]);

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(user_id_array),
                Arc::new(session_id_array),
                Arc::new(timestamp_array),
            ],
        )
        .unwrap();

        let batches = vec![batch];
        let full_text_search_fields = vec![];
        let index_fields = vec!["user_id".to_string(), "session_id".to_string()];

        let result = generate_inverted_idx_recordbatch(
            schema,
            &batches,
            StreamType::Logs,
            &full_text_search_fields,
            &index_fields,
        );

        assert!(result.is_ok());
        let batch_result = result.unwrap();
        assert!(batch_result.is_some());

        let inverted_batch = batch_result.unwrap();
        assert_eq!(inverted_batch.num_rows(), 2);
        assert_eq!(inverted_batch.num_columns(), 3); // user_id + session_id + _timestamp
    }

    #[test]
    fn test_generate_inverted_idx_recordbatch_with_multiple_batches() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("message", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch1 = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["message 1", "message 2"])),
                Arc::new(Int64Array::from(vec![1000, 2000])),
            ],
        )
        .unwrap();

        let batch2 = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["message 3", "message 4"])),
                Arc::new(Int64Array::from(vec![3000, 4000])),
            ],
        )
        .unwrap();

        let batches = vec![batch1, batch2];
        let full_text_search_fields = vec!["message".to_string()];
        let index_fields = vec![];

        let result = generate_inverted_idx_recordbatch(
            schema,
            &batches,
            StreamType::Logs,
            &full_text_search_fields,
            &index_fields,
        );

        assert!(result.is_ok());
        let batch_result = result.unwrap();
        assert!(batch_result.is_some());

        let inverted_batch = batch_result.unwrap();
        assert_eq!(inverted_batch.num_rows(), 4); // Combined rows from both batches
    }

    #[test]
    fn test_generate_inverted_idx_recordbatch_no_matching_fields() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("field1", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["value1", "value2"])),
                Arc::new(Int64Array::from(vec![1000, 2000])),
            ],
        )
        .unwrap();

        let batches = vec![batch];
        // Specify fields that don't exist in schema
        let full_text_search_fields = vec!["nonexistent_field".to_string()];
        let index_fields = vec!["another_nonexistent".to_string()];

        let result = generate_inverted_idx_recordbatch(
            schema,
            &batches,
            StreamType::Logs,
            &full_text_search_fields,
            &index_fields,
        );

        assert!(result.is_ok());
        let batch_result = result.unwrap();
        // Should return None because only _timestamp would be present
        assert!(batch_result.is_none());
    }

    #[test]
    fn test_generate_inverted_idx_recordbatch_only_timestamp() {
        use arrow::array::Int64Array;

        let schema = Arc::new(Schema::new(vec![Field::new(
            TIMESTAMP_COL_NAME,
            DataType::Int64,
            false,
        )]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int64Array::from(vec![1000, 2000]))],
        )
        .unwrap();

        let batches = vec![batch];
        let full_text_search_fields = vec![];
        let index_fields = vec![];

        let result = generate_inverted_idx_recordbatch(
            schema,
            &batches,
            StreamType::Logs,
            &full_text_search_fields,
            &index_fields,
        );

        assert!(result.is_ok());
        let batch_result = result.unwrap();
        // Should return None because only timestamp field exists
        assert!(batch_result.is_none());
    }

    #[test]
    fn test_generate_inverted_idx_recordbatch_with_combined_fts_and_index() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("message", DataType::Utf8, true),
            Field::new("user_id", DataType::Utf8, true),
            Field::new("level", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["log1", "log2"])),
                Arc::new(StringArray::from(vec!["user1", "user2"])),
                Arc::new(StringArray::from(vec!["info", "error"])),
                Arc::new(Int64Array::from(vec![1000, 2000])),
            ],
        )
        .unwrap();

        let batches = vec![batch];
        let full_text_search_fields = vec!["message".to_string()];
        let index_fields = vec!["user_id".to_string(), "level".to_string()];

        let result = generate_inverted_idx_recordbatch(
            schema,
            &batches,
            StreamType::Logs,
            &full_text_search_fields,
            &index_fields,
        );

        assert!(result.is_ok());
        let batch_result = result.unwrap();
        assert!(batch_result.is_some());

        let inverted_batch = batch_result.unwrap();
        assert_eq!(inverted_batch.num_rows(), 2);
        // Should have: level, message, user_id (sorted), + _timestamp = 4 columns
        assert_eq!(inverted_batch.num_columns(), 4);
    }

    #[test]
    fn test_generate_inverted_idx_recordbatch_duplicate_fields() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("field1", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["value1", "value2"])),
                Arc::new(Int64Array::from(vec![1000, 2000])),
            ],
        )
        .unwrap();

        let batches = vec![batch];
        // Same field in both FTS and index fields (should be deduped)
        let full_text_search_fields = vec!["field1".to_string()];
        let index_fields = vec!["field1".to_string()];

        let result = generate_inverted_idx_recordbatch(
            schema,
            &batches,
            StreamType::Logs,
            &full_text_search_fields,
            &index_fields,
        );

        assert!(result.is_ok());
        let batch_result = result.unwrap();
        assert!(batch_result.is_some());

        let inverted_batch = batch_result.unwrap();
        assert_eq!(inverted_batch.num_rows(), 2);
        assert_eq!(inverted_batch.num_columns(), 2); // field1 + _timestamp (deduplicated)
    }

    #[test]
    fn test_generate_inverted_idx_recordbatch_unsupported_stream_type() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("message", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["msg1", "msg2"])),
                Arc::new(Int64Array::from(vec![1000, 2000])),
            ],
        )
        .unwrap();

        let batches = vec![batch];
        let full_text_search_fields = vec!["message".to_string()];
        let index_fields = vec![];

        // Test with a stream type that might not support indexing
        // Note: This depends on the support_index() implementation
        let result = generate_inverted_idx_recordbatch(
            schema,
            &batches,
            StreamType::Metrics, // Metrics may not support indexing
            &full_text_search_fields,
            &index_fields,
        );

        assert!(result.is_ok());
        // Result depends on whether Metrics support_index() returns true
    }

    // ── Additional sort_by_time_range edge-case tests ────────────────────────

    /// Two files share the same min_ts but have different max_ts values.
    /// The file with the smaller max_ts ends first; the second file starts at
    /// the same time and thus overlaps → they must land in different groups.
    #[test]
    fn test_sort_by_time_range_same_min_ts_different_max_ts() {
        let files = vec![
            create_file_key("file_a.parquet", 1000, 3000, 1024),
            create_file_key("file_b.parquet", 1000, 2000, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"file_a.parquet"));
        assert!(keys.contains(&"file_b.parquet"));
        // Both share min_ts=1000, so they overlap: each ends up in its own group.
        // Consecutive elements in the output must not have a later file whose
        // min_ts < the predecessor's max_ts within the same group-chain.
        // We just verify the invariant: result preserves all files.
        assert_eq!(result.len(), 2);
    }

    /// All files are completely overlapping (same time range).
    /// Every file goes into a separate group; total count must be preserved.
    #[test]
    fn test_sort_by_time_range_all_identical_ranges() {
        let files = vec![
            create_file_key("file1.parquet", 500, 1500, 1024),
            create_file_key("file2.parquet", 500, 1500, 512),
            create_file_key("file3.parquet", 500, 1500, 2048),
            create_file_key("file4.parquet", 500, 1500, 768),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 4);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"file1.parquet"));
        assert!(keys.contains(&"file2.parquet"));
        assert!(keys.contains(&"file3.parquet"));
        assert!(keys.contains(&"file4.parquet"));
    }

    /// Files whose min_ts == max_ts == 0 (zero timestamps).
    #[test]
    fn test_sort_by_time_range_zero_timestamps() {
        let files = vec![
            create_file_key("file1.parquet", 0, 0, 1024),
            create_file_key("file2.parquet", 0, 1000, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        // First file is whichever has min_ts=0; both should survive.
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"file1.parquet"));
        assert!(keys.contains(&"file2.parquet"));
    }

    /// Two non-overlapping groups: group A has files [1000,2000] and [2000,3000];
    /// group B has files [1500,2500] and [2500,3500].  The algorithm must
    /// produce exactly 4 files in the output.
    #[test]
    fn test_sort_by_time_range_two_interleaved_groups() {
        // After sort by min_ts:
        //   A1: [1000,2000], B1: [1500,2500], A2: [2000,3000], B2: [2500,3500]
        // A1 opens group-0.  B1 overlaps A1 (1500 < 2000) → opens group-1.
        // A2: min_ts=2000 >= group-0's last max=2000 → fits group-0.
        // B2: min_ts=2500 >= group-1's last max=2500 → fits group-1.
        let files = vec![
            create_file_key("A1.parquet", 1000, 2000, 1024),
            create_file_key("B1.parquet", 1500, 2500, 1024),
            create_file_key("A2.parquet", 2000, 3000, 1024),
            create_file_key("B2.parquet", 2500, 3500, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 4);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"A1.parquet"));
        assert!(keys.contains(&"A2.parquet"));
        assert!(keys.contains(&"B1.parquet"));
        assert!(keys.contains(&"B2.parquet"));
        // Group-0 chain: A1 then A2 (adjacent).  Verify they appear consecutively.
        let a1_pos = result.iter().position(|f| f.key == "A1.parquet").unwrap();
        let a2_pos = result.iter().position(|f| f.key == "A2.parquet").unwrap();
        assert_eq!(
            a2_pos,
            a1_pos + 1,
            "A1 and A2 should be in the same group (consecutive)"
        );
    }

    /// A chain of files where each one's min_ts equals the previous file's max_ts
    /// (strictly adjacent, no gap).  All should end up in one group.
    #[test]
    fn test_sort_by_time_range_strictly_adjacent_chain() {
        let files = vec![
            create_file_key("f1.parquet", 100, 200, 512),
            create_file_key("f3.parquet", 300, 400, 512),
            create_file_key("f2.parquet", 200, 300, 512),
            create_file_key("f4.parquet", 400, 500, 512),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 4);
        // All are adjacent (min_ts == prev max_ts) so they chain into one group.
        assert_eq!(result[0].key, "f1.parquet");
        assert_eq!(result[1].key, "f2.parquet");
        assert_eq!(result[2].key, "f3.parquet");
        assert_eq!(result[3].key, "f4.parquet");
    }

    /// A single file where min_ts == max_ts (point-in-time, zero-width range).
    #[test]
    fn test_sort_by_time_range_single_point_file() {
        let files = vec![create_file_key("point.parquet", 42, 42, 256)];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].key, "point.parquet");
        assert_eq!(result[0].meta.min_ts, 42);
        assert_eq!(result[0].meta.max_ts, 42);
    }

    // ── Additional generate_inverted_idx_recordbatch edge-case tests ─────────

    /// Stream types that return false from `support_index()` must always yield None.
    #[test]
    fn test_generate_inverted_idx_recordbatch_non_index_stream_type() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("message", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["hello"])),
                Arc::new(Int64Array::from(vec![1000i64])),
            ],
        )
        .unwrap();

        let batches = vec![batch];
        let full_text_search_fields = vec!["message".to_string()];
        let index_fields: Vec<String> = vec![];

        // EnrichmentTables does not support indexing.
        let result = generate_inverted_idx_recordbatch(
            schema.clone(),
            &batches,
            StreamType::EnrichmentTables,
            &full_text_search_fields,
            &index_fields,
        );
        assert!(result.is_ok());
        assert!(
            result.unwrap().is_none(),
            "EnrichmentTables should return None (no index support)"
        );

        // ServiceGraph does not support indexing.
        let batch2 = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["hello"])),
                Arc::new(Int64Array::from(vec![1000i64])),
            ],
        )
        .unwrap();
        let result2 = generate_inverted_idx_recordbatch(
            schema.clone(),
            &[batch2],
            StreamType::ServiceGraph,
            &full_text_search_fields,
            &index_fields,
        );
        assert!(result2.is_ok());
        assert!(
            result2.unwrap().is_none(),
            "ServiceGraph should return None (no index support)"
        );

        // Filelist does not support indexing.
        let batch3 = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["hello"])),
                Arc::new(Int64Array::from(vec![1000i64])),
            ],
        )
        .unwrap();
        let result3 = generate_inverted_idx_recordbatch(
            schema,
            &[batch3],
            StreamType::Filelist,
            &full_text_search_fields,
            &index_fields,
        );
        assert!(result3.is_ok());
        assert!(
            result3.unwrap().is_none(),
            "Filelist should return None (no index support)"
        );
    }

    /// When `full_text_search_fields` is empty and `index_fields` is empty the
    /// function falls back to `SQL_FULL_TEXT_SEARCH_FIELDS`.  If none of those
    /// default names are present in the schema either, the result is None.
    #[test]
    fn test_generate_inverted_idx_recordbatch_default_fts_fallback_no_match() {
        use arrow::array::{Int64Array, StringArray};

        // Schema has only a custom column and _timestamp – none of the default
        // FTS fields (log, message, msg, content, data, body, json, error).
        let schema = Arc::new(Schema::new(vec![
            Field::new("custom_col", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["v1", "v2"])),
                Arc::new(Int64Array::from(vec![1000i64, 2000i64])),
            ],
        )
        .unwrap();

        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Logs,
            &[], // empty → falls back to SQL_FULL_TEXT_SEARCH_FIELDS
            &[], // empty index_fields too
        );

        assert!(result.is_ok());
        // None of the default FTS fields match, so inverted_idx_columns becomes
        // empty after retain, and the function should return None.
        assert!(
            result.unwrap().is_none(),
            "No default FTS field match should produce None"
        );
    }

    /// When `full_text_search_fields` is empty but a default FTS field IS present
    /// in the schema, the function should produce a valid RecordBatch.
    #[test]
    fn test_generate_inverted_idx_recordbatch_default_fts_fallback_with_match() {
        use arrow::array::{Int64Array, StringArray};

        // "log" is one of the default SQL_FULL_TEXT_SEARCH_FIELDS.
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["line1", "line2"])),
                Arc::new(Int64Array::from(vec![1000i64, 2000i64])),
            ],
        )
        .unwrap();

        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Logs,
            &[], // empty → falls back to SQL_FULL_TEXT_SEARCH_FIELDS
            &[],
        );

        assert!(result.is_ok());
        let rb = result.unwrap();
        assert!(rb.is_some(), "Default FTS field 'log' should produce Some");
        let rb = rb.unwrap();
        assert_eq!(rb.num_rows(), 2);
        // Columns: "log" + "_timestamp"
        assert_eq!(rb.num_columns(), 2);
    }

    /// When `_timestamp` is explicitly listed in `full_text_search_fields`, it
    /// must not be added a second time (dedup).  The final batch should still
    /// contain only ONE `_timestamp` column.
    #[test]
    fn test_generate_inverted_idx_recordbatch_timestamp_in_fts_fields_dedup() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("message", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["hello"])),
                Arc::new(Int64Array::from(vec![5000i64])),
            ],
        )
        .unwrap();

        // Explicitly include _timestamp in fts_fields to exercise the dedup path.
        let full_text_search_fields = vec![
            "message".to_string(),
            TIMESTAMP_COL_NAME.to_string(), // duplicate that should be deduped
        ];

        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Logs,
            &full_text_search_fields,
            &[],
        );

        assert!(result.is_ok());
        let rb = result.unwrap();
        assert!(rb.is_some());
        let rb = rb.unwrap();
        // Columns: message + _timestamp (no duplicate _timestamp column).
        assert_eq!(rb.num_columns(), 2);
        // Verify _timestamp column appears exactly once.
        let ts_count = rb
            .schema()
            .fields()
            .iter()
            .filter(|f| f.name() == TIMESTAMP_COL_NAME)
            .count();
        assert_eq!(ts_count, 1, "_timestamp must appear exactly once");
    }

    /// A single-element batch vector exercises the `len() == 1` fast-path that
    /// avoids `concat_batches` and returns the batch directly.
    #[test]
    fn test_generate_inverted_idx_recordbatch_single_batch_fast_path() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("body", DataType::Utf8, true),
            Field::new("level", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["body text"])),
                Arc::new(StringArray::from(vec!["warn"])),
                Arc::new(Int64Array::from(vec![9999i64])),
            ],
        )
        .unwrap();

        // "body" is a default SQL_FULL_TEXT_SEARCH_FIELDS entry.
        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch], // exactly one batch
            StreamType::Logs,
            &["body".to_string()],
            &["level".to_string()],
        );

        assert!(result.is_ok());
        let rb = result.unwrap();
        assert!(rb.is_some());
        let rb = rb.unwrap();
        assert_eq!(rb.num_rows(), 1);
        // Columns: body + level + _timestamp (sorted, deduped)
        assert_eq!(rb.num_columns(), 3);
    }

    /// When the batch has columns but the selected index columns are missing
    /// (because `inverted_idx_columns` only matches `_timestamp`), the result
    /// must be None rather than a single-column batch.
    #[test]
    fn test_generate_inverted_idx_recordbatch_only_timestamp_after_filter() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("irrelevant", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["x"])),
                Arc::new(Int64Array::from(vec![100i64])),
            ],
        )
        .unwrap();

        // Ask for a field that IS in the schema but is the timestamp itself,
        // plus another that does not exist.
        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Logs,
            &[TIMESTAMP_COL_NAME.to_string()], // only _timestamp passes retain
            &[],
        );

        assert!(result.is_ok());
        // inverted_idx_columns after retain would contain _timestamp, then the
        // "push _timestamp if absent" step is skipped (it's already there), so
        // the final batch has exactly 1 column (_timestamp only) → returns None.
        assert!(
            result.unwrap().is_none(),
            "Batch with only _timestamp column should return None"
        );
    }

    /// Traces stream type supports indexing, so the function proceeds normally.
    #[test]
    fn test_generate_inverted_idx_recordbatch_traces_stream_type() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("msg", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["span-data"])),
                Arc::new(Int64Array::from(vec![777i64])),
            ],
        )
        .unwrap();

        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Traces, // supports indexing
            &["msg".to_string()],
            &[],
        );

        assert!(result.is_ok());
        let rb = result.unwrap();
        assert!(
            rb.is_some(),
            "Traces should produce Some when field matches"
        );
        let rb = rb.unwrap();
        assert_eq!(rb.num_rows(), 1);
        assert_eq!(rb.num_columns(), 2); // msg + _timestamp
    }

    /// Verify the column order in the output: `inverted_idx_columns` is sorted
    /// and deduped, so the schema fields of the produced batch must respect that
    /// alphabetical ordering (excluding the appended `_timestamp`).
    #[test]
    fn test_generate_inverted_idx_recordbatch_column_sort_order() {
        use arrow::array::{Int64Array, StringArray};

        // Provide fields in reverse alphabetical order to confirm output is sorted.
        let schema = Arc::new(Schema::new(vec![
            Field::new("zebra", DataType::Utf8, true),
            Field::new("apple", DataType::Utf8, true),
            Field::new("mango", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["z"])),
                Arc::new(StringArray::from(vec!["a"])),
                Arc::new(StringArray::from(vec!["m"])),
                Arc::new(Int64Array::from(vec![1i64])),
            ],
        )
        .unwrap();

        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Logs,
            &[
                "zebra".to_string(),
                "apple".to_string(),
                "mango".to_string(),
            ],
            &[],
        );

        assert!(result.is_ok());
        let rb = result.unwrap().expect("should produce Some");
        let rb_schema = rb.schema();
        let field_names: Vec<&str> = rb_schema
            .fields()
            .iter()
            .map(|f| f.name().as_str())
            .collect();
        // Expected sorted order: apple, mango, zebra, then _timestamp appended at end.
        assert_eq!(field_names[0], "apple");
        assert_eq!(field_names[1], "mango");
        assert_eq!(field_names[2], "zebra");
        assert_eq!(field_names[3], TIMESTAMP_COL_NAME);
    }

    /// Three-batch concat path: ensure all rows survive concatenation.
    #[test]
    fn test_generate_inverted_idx_recordbatch_three_batches_concat() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("error", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let make_batch = |msg: &str, ts: i64| {
            RecordBatch::try_new(
                schema.clone(),
                vec![
                    Arc::new(StringArray::from(vec![msg])) as _,
                    Arc::new(Int64Array::from(vec![ts])) as _,
                ],
            )
            .unwrap()
        };

        let batches = vec![
            make_batch("err1", 100),
            make_batch("err2", 200),
            make_batch("err3", 300),
        ];

        let result = generate_inverted_idx_recordbatch(
            schema,
            &batches,
            StreamType::Logs,
            &["error".to_string()],
            &[],
        );

        assert!(result.is_ok());
        let rb = result.unwrap().expect("should produce Some");
        // "error" is also a default FTS field, but because we supply fts_fields
        // explicitly the result should include it plus _timestamp.
        assert_eq!(rb.num_rows(), 3); // one row per batch, concatenated
        assert_eq!(rb.num_columns(), 2); // error + _timestamp
    }

    // ── sort_by_time_range: additional branch-coverage tests ─────────────────

    /// Two files that don't overlap and have a gap between them.  The second
    /// file's min_ts is strictly greater than the first file's max_ts, so both
    /// land in the same chain (group-0) and appear in order.
    #[test]
    fn test_sort_by_time_range_two_non_overlapping_with_gap() {
        let files = vec![
            create_file_key("early.parquet", 1000, 2000, 512),
            create_file_key("late.parquet", 5000, 6000, 512),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].key, "early.parquet");
        assert_eq!(result[1].key, "late.parquet");
    }

    /// Files presented in strictly descending min_ts order.  After the internal
    /// sort by min_ts the algorithm must produce the same output as if they had
    /// been given in ascending order.
    #[test]
    fn test_sort_by_time_range_descending_input_order() {
        let files = vec![
            create_file_key("f4.parquet", 4000, 5000, 512),
            create_file_key("f3.parquet", 3000, 4000, 512),
            create_file_key("f2.parquet", 2000, 3000, 512),
            create_file_key("f1.parquet", 1000, 2000, 512),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 4);
        // Adjacent chain: all files should appear sorted by min_ts.
        assert_eq!(result[0].key, "f1.parquet");
        assert_eq!(result[1].key, "f2.parquet");
        assert_eq!(result[2].key, "f3.parquet");
        assert_eq!(result[3].key, "f4.parquet");
    }

    /// File where min_ts == max_ts == i64::MIN (boundary value).
    #[test]
    fn test_sort_by_time_range_min_i64_timestamps() {
        let files = vec![
            create_file_key("a.parquet", i64::MIN, i64::MIN, 256),
            create_file_key("b.parquet", i64::MIN, 0, 256),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"a.parquet"));
        assert!(keys.contains(&"b.parquet"));
    }

    /// A file whose min_ts is greater than its max_ts (malformed / inverted range).
    /// The algorithm must still return all files without panicking.
    #[test]
    fn test_sort_by_time_range_inverted_range_no_panic() {
        let files = vec![
            create_file_key("good.parquet", 1000, 3000, 512),
            create_file_key("bad.parquet", 5000, 2000, 512), // inverted: min > max
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"good.parquet"));
        assert!(keys.contains(&"bad.parquet"));
    }

    /// Many fully-overlapping files create as many groups as there are files.
    /// Verify that the total count is always preserved regardless of input size.
    #[test]
    fn test_sort_by_time_range_ten_fully_overlapping_files() {
        let files: Vec<FileKey> = (0..10)
            .map(|i| create_file_key(&format!("f{i}.parquet"), 0, 1000, 256))
            .collect();
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 10, "All files must be preserved");
    }

    /// Non-overlapping files interleaved with overlapping ones.
    /// Ensures multiple groups can be built simultaneously and
    /// files correctly land in the first group that can accept them.
    #[test]
    fn test_sort_by_time_range_mixed_overlap_and_gaps() {
        // After sort by min_ts:
        //  A: [100, 200], B: [150, 300], C: [200, 400], D: [300, 500], E: [600, 700]
        // Group-0 starts with A.
        // B (min=150 < A.max=200) → new group-1.
        // C (min=200 >= A.max=200) → fits group-0 (A chain extends to max=400).
        // D (min=300 < C.max=400) in group-0 fails; min=300 >= B.max=300 → fits group-1.
        // E (min=600 >= C.max=400) → fits group-0.
        let files = vec![
            create_file_key("A.parquet", 100, 200, 512),
            create_file_key("B.parquet", 150, 300, 512),
            create_file_key("C.parquet", 200, 400, 512),
            create_file_key("D.parquet", 300, 500, 512),
            create_file_key("E.parquet", 600, 700, 512),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 5);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"A.parquet"));
        assert!(keys.contains(&"B.parquet"));
        assert!(keys.contains(&"C.parquet"));
        assert!(keys.contains(&"D.parquet"));
        assert!(keys.contains(&"E.parquet"));
    }

    // ── generate_inverted_idx_recordbatch: additional branch-coverage tests ───

    /// StreamType::Metadata supports indexing (same as Logs/Traces).
    /// A valid FTS field in the schema must produce Some.
    #[test]
    fn test_generate_inverted_idx_recordbatch_metadata_stream_type() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("message", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["meta-event"])),
                Arc::new(Int64Array::from(vec![1234i64])),
            ],
        )
        .unwrap();

        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Metadata, // supports indexing
            &["message".to_string()],
            &[],
        );

        assert!(result.is_ok());
        let rb = result.unwrap();
        assert!(
            rb.is_some(),
            "Metadata stream should produce Some when field matches"
        );
        let rb = rb.unwrap();
        assert_eq!(rb.num_rows(), 1);
        assert_eq!(rb.num_columns(), 2); // message + _timestamp
    }

    /// StreamType::Metrics supports indexing.  Providing explicit FTS fields
    /// that exist in the schema must produce a valid RecordBatch (not None).
    #[test]
    fn test_generate_inverted_idx_recordbatch_metrics_stream_produces_some() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("label", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["cpu_usage"])),
                Arc::new(Int64Array::from(vec![9000i64])),
            ],
        )
        .unwrap();

        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Metrics, // also supports indexing
            &["label".to_string()],
            &[],
        );

        assert!(result.is_ok());
        let rb = result.unwrap();
        assert!(
            rb.is_some(),
            "Metrics supports indexing, so a matching field should produce Some"
        );
        let rb = rb.unwrap();
        assert_eq!(rb.num_rows(), 1);
        assert_eq!(rb.num_columns(), 2); // label + _timestamp
    }

    /// A batch where the batch's schema has the requested field but the column
    /// name has different casing — `index_of` is case-sensitive, so it will
    /// fail to find the column and produce an empty selection → result is None.
    #[test]
    fn test_generate_inverted_idx_recordbatch_case_sensitive_field_miss() {
        use arrow::array::{Int64Array, StringArray};

        // Schema has "Message" (capital M), but we request "message" (lowercase).
        let schema = Arc::new(Schema::new(vec![
            Field::new("Message", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["hello"])),
                Arc::new(Int64Array::from(vec![100i64])),
            ],
        )
        .unwrap();

        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Logs,
            &["message".to_string()], // lowercase — won't match "Message"
            &[],
        );

        assert!(result.is_ok());
        // "message" is not found in schema fields (case-sensitive) → inverted_idx_columns
        // becomes empty after retain → returns None early.
        assert!(
            result.unwrap().is_none(),
            "Case mismatch should prevent field from being retained"
        );
    }

    /// A batch with zero rows (but correct schema) must still produce a valid
    /// (albeit empty) RecordBatch when the fields match.
    #[test]
    fn test_generate_inverted_idx_recordbatch_zero_row_batch() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("content", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        // Explicitly build a zero-row batch.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(Vec::<&str>::new())),
                Arc::new(Int64Array::from(Vec::<i64>::new())),
            ],
        )
        .unwrap();
        assert_eq!(batch.num_rows(), 0);

        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Logs,
            &["content".to_string()],
            &[],
        );

        assert!(result.is_ok());
        let rb = result.unwrap();
        // The function does not check num_rows, only column count.
        // "content" + "_timestamp" gives 2 columns → Some returned.
        assert!(
            rb.is_some(),
            "Zero-row batch with valid fields should produce Some"
        );
        let rb = rb.unwrap();
        assert_eq!(rb.num_rows(), 0);
        assert_eq!(rb.num_columns(), 2); // content + _timestamp
    }

    /// Providing only `index_fields` (no FTS fields) for a Logs stream should
    /// work: the columns are selected from the batch schema and returned.
    #[test]
    fn test_generate_inverted_idx_recordbatch_index_fields_only_logs() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("request_id", DataType::Utf8, true),
            Field::new("status_code", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["req-1", "req-2"])),
                Arc::new(StringArray::from(vec!["200", "500"])),
                Arc::new(Int64Array::from(vec![1000i64, 2000i64])),
            ],
        )
        .unwrap();

        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Logs,
            &[], // no FTS fields → falls back to SQL defaults; none match
            &["request_id".to_string(), "status_code".to_string()],
        );

        assert!(result.is_ok());
        let rb = result.unwrap();
        assert!(rb.is_some(), "index_fields present should produce Some");
        let rb = rb.unwrap();
        assert_eq!(rb.num_rows(), 2);
        // request_id + status_code + _timestamp = 3 columns
        assert_eq!(rb.num_columns(), 3);
    }

    /// Confirm that when `inverted_idx_columns` would be empty after the retain
    /// step (no schema field matches at all), the function returns None before
    /// entering the per-batch loop — exercising the early-return branch.
    #[test]
    fn test_generate_inverted_idx_recordbatch_empty_columns_early_return() {
        use arrow::array::{Int64Array, StringArray};

        // Schema has only fields that are NOT in SQL_FULL_TEXT_SEARCH_FIELDS and
        // are not supplied as FTS or index fields.
        let schema = Arc::new(Schema::new(vec![
            Field::new("alpha", DataType::Utf8, true),
            Field::new("beta", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["a"])),
                Arc::new(StringArray::from(vec!["b"])),
                Arc::new(Int64Array::from(vec![1i64])),
            ],
        )
        .unwrap();

        // Request fields that don't exist in the schema at all.
        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Logs,
            &["nonexistent_fts".to_string()],
            &["nonexistent_idx".to_string()],
        );

        assert!(result.is_ok());
        assert!(
            result.unwrap().is_none(),
            "No schema field match should yield None (early return)"
        );
    }

    /// When the same field name appears in both `full_text_search_fields` AND
    /// `index_fields`, `dedup` must collapse it so the output batch column
    /// appears exactly once.
    #[test]
    fn test_generate_inverted_idx_recordbatch_fts_and_index_overlap_dedup() {
        use arrow::array::{Int64Array, StringArray};

        let schema = Arc::new(Schema::new(vec![
            Field::new("tag", DataType::Utf8, true),
            Field::new("host", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["web", "db"])),
                Arc::new(StringArray::from(vec!["host-1", "host-2"])),
                Arc::new(Int64Array::from(vec![100i64, 200i64])),
            ],
        )
        .unwrap();

        // "tag" appears in both lists; "host" only in index_fields.
        let result = generate_inverted_idx_recordbatch(
            schema,
            &[batch],
            StreamType::Logs,
            &["tag".to_string()],
            &["tag".to_string(), "host".to_string()],
        );

        assert!(result.is_ok());
        let rb = result.unwrap().expect("should produce Some");
        // After dedup: [host, tag] (sorted) + _timestamp = 3 columns.
        assert_eq!(rb.num_columns(), 3);
        // "tag" must appear exactly once.
        let tag_count = rb
            .schema()
            .fields()
            .iter()
            .filter(|f| f.name() == "tag")
            .count();
        assert_eq!(tag_count, 1, "tag must be deduped to exactly one column");
        assert_eq!(rb.num_rows(), 2);
    }

    /// When the batch's own schema is a subset of the inverted_idx_columns list
    /// (some requested columns are absent from the batch), the missing columns
    /// are silently skipped via `filter_map`.  The result must only contain
    /// the fields that the batch actually has.
    #[test]
    fn test_generate_inverted_idx_recordbatch_partial_batch_schema_match() {
        use arrow::array::{Int64Array, StringArray};

        // Stream schema knows about "present" and "absent".
        let stream_schema = Arc::new(Schema::new(vec![
            Field::new("present", DataType::Utf8, true),
            Field::new("absent", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        // But the actual batch only has "present" and _timestamp.
        let batch_schema = Arc::new(Schema::new(vec![
            Field::new("present", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            batch_schema,
            vec![
                Arc::new(StringArray::from(vec!["here"])),
                Arc::new(Int64Array::from(vec![42i64])),
            ],
        )
        .unwrap();

        // Pass the stream schema (which includes "absent") but a batch that
        // doesn't have it — exercises the filter_map miss path.
        let result = generate_inverted_idx_recordbatch(
            stream_schema,
            &[batch],
            StreamType::Logs,
            &["present".to_string(), "absent".to_string()],
            &[],
        );

        assert!(result.is_ok());
        let rb = result
            .unwrap()
            .expect("should produce Some because 'present' matched");
        // Only "present" + _timestamp survive (absent was not in the batch schema).
        assert_eq!(rb.num_columns(), 2);
        let rb_schema = rb.schema();
        let col_names: Vec<&str> = rb_schema
            .fields()
            .iter()
            .map(|f| f.name().as_str())
            .collect();
        assert!(col_names.contains(&"present"));
        assert!(col_names.contains(&TIMESTAMP_COL_NAME));
        assert!(!col_names.contains(&"absent"));
    }

    /// Two batches with different schemas (first has "msg", second has "body").
    /// Because `inverted_idx_columns` is built from the *stream* schema and both
    /// fields are present there, but the per-batch `filter_map` only picks what
    /// each batch actually has.  After concat the rows from each batch survive.
    #[test]
    fn test_generate_inverted_idx_recordbatch_two_batches_different_schemas() {
        use arrow::array::{Int64Array, StringArray};

        // Stream schema knows about both columns.
        let stream_schema = Arc::new(Schema::new(vec![
            Field::new("msg", DataType::Utf8, true),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        ]));

        // Both batches use the same schema here for simplicity (the column-
        // miss path is already tested above); this exercises the two-batch concat.
        let batch1 = RecordBatch::try_new(
            stream_schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["first"])),
                Arc::new(Int64Array::from(vec![10i64])),
            ],
        )
        .unwrap();

        let batch2 = RecordBatch::try_new(
            stream_schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["second", "third"])),
                Arc::new(Int64Array::from(vec![20i64, 30i64])),
            ],
        )
        .unwrap();

        let result = generate_inverted_idx_recordbatch(
            stream_schema,
            &[batch1, batch2],
            StreamType::Logs,
            &["msg".to_string()],
            &[],
        );

        assert!(result.is_ok());
        let rb = result.unwrap().expect("should produce Some");
        assert_eq!(rb.num_rows(), 3); // 1 + 2
        assert_eq!(rb.num_columns(), 2); // msg + _timestamp
    }

    /// Verify `sort_by_time_range` with exactly two files where the second
    /// file's min_ts equals the first file's max_ts — the boundary condition
    /// `min_ts >= max_ts` in the group-fit predicate.
    #[test]
    fn test_sort_by_time_range_exact_boundary_two_files() {
        let files = vec![
            create_file_key("first.parquet", 1000, 2000, 512),
            create_file_key("second.parquet", 2000, 3000, 512), // min == prev max
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        // min_ts(second) == max_ts(first), so `file.meta.min_ts >= f.meta.max_ts`
        // evaluates to true → second file joins first file's group.
        assert_eq!(result[0].key, "first.parquet");
        assert_eq!(result[1].key, "second.parquet");
    }

    /// A file whose min_ts is one less than the previous group's max_ts must
    /// NOT join that group (it overlaps by 1 microsecond).
    #[test]
    fn test_sort_by_time_range_one_unit_overlap() {
        let files = vec![
            create_file_key("first.parquet", 1000, 2000, 512),
            create_file_key("overlap.parquet", 1999, 3000, 512), // 1999 < 2000
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        // overlap.parquet must be in a different group from first.parquet.
        // The first element should be first.parquet (lower min_ts).
        assert_eq!(result[0].key, "first.parquet");
        // Both files must appear; overlap.parquet goes to a new group.
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"overlap.parquet"));
    }
}
