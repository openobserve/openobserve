// Copyright 2025 OpenObserve Inc.
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
#[cfg(feature = "enterprise")]
use config::utils::parquet::read_recordbatch_from_bytes;
use config::{
    FILE_EXT_PARQUET, TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config, ider, is_local_disk_storage,
    meta::{
        search::StorageType,
        stream::{
            FileKey, FileListDeleted, FileMeta, MergeStrategy, PartitionTimeLevel, StreamType,
        },
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
        SchemaCache, get_stream_setting_bloom_filter_fields, get_stream_setting_fts_fields,
        get_stream_setting_index_fields, unwrap_partition_time_level, unwrap_stream_created_at,
        unwrap_stream_settings,
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
    search::datafusion::exec::{self, MergeParquetResult, TableBuilder},
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
            "[COMPACTOR] add file_list_jobs failed: {}",
            e
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
                "Unexpected hour format in {}, Expected format YYYY/MM/DD/HH",
                hour
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
                "[COMPACTOR] add file_list_jobs for old data failed: {}",
                e
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
            "/compact/downsampling/{}/{}/{}/{}/{}",
            org_id, stream_type, stream_name, rule.0, rule.1
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
            "[DOWNSAMPLING] add file_list_jobs failed: {}",
            e
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

    let stream_settings = unwrap_stream_settings(&schema).unwrap_or_default();
    let partition_time_level =
        unwrap_partition_time_level(stream_settings.partition_time_level, stream_type);

    log::debug!(
        "[COMPACTOR] merge_by_stream [{org_id}/{stream_type}/{stream_name}] offset: {offset}"
    );

    // check offset
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
            .map_err(|e| anyhow::anyhow!("query file list failed: {}", e))?;

    log::debug!(
        "[COMPACTOR] merge_by_stream [{}/{}/{}] date range: [{},{}], files: {}",
        org_id,
        stream_type,
        stream_name,
        date_start,
        date_end,
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
        // skip the files which already reach the max_file_size * 95%
        if file.meta.original_size > cfg.compact.max_file_size as i64 * 95 / 100 {
            continue;
        }
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
    let mut new_file_meta = FileMeta {
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
    let (defined_schema_fields, need_original, index_original_data, index_all_values) =
        match stream_settings {
            Some(s) => (
                s.defined_schema_fields,
                s.store_original_data,
                s.index_original_data,
                s.index_all_values,
            ),
            None => (Vec::new(), false, false, false),
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
        latest_schema.schema().as_ref().clone()
    } else {
        latest_schema
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
        let schema = read_schema_from_bytes(&buf).await?;
        let schema = schema.as_ref().clone().with_metadata(Default::default());
        let schema_key = schema.hash_key();
        if !schemas.contains_key(&schema_key) {
            schemas.insert(schema_key.clone(), schema);
        }
    }

    // generate the final schema
    let all_fields = schemas
        .values()
        .flat_map(|s| s.fields().iter().map(|f| f.name().to_string()))
        .collect::<HashSet<_>>();
    // Keep original schema for index generation (has all stream fields)
    let stream_schema_for_index = Arc::new(latest_schema.clone());
    // Create filtered schema for parquet merging (only fields in parquet files)
    let latest_schema = Arc::new(latest_schema.retain(all_fields));
    let mut latest_schema_fields = HashMap::with_capacity(latest_schema.fields().len());
    for field in latest_schema.fields() {
        latest_schema_fields.insert(field.name(), field);
    }

    // generate datafusion tables
    let trace_id = ider::generate();
    let session = config::meta::search::Session {
        id: trace_id.to_string(),
        storage_type: StorageType::Memory,
        work_group: None,
        target_partitions: 2,
    };

    let table = match TableBuilder::new()
        .sorted_by_time(true)
        .build(session, files.clone(), latest_schema.clone())
        .await
    {
        Ok(table) => table,
        Err(e) => {
            log::error!(
                "create_parquet_table err: {e}, files: {files:?}, schema: {latest_schema:?}"
            );
            return Err(DataFusionError::Plan(format!("create_parquet_table err: {e}")).into());
        }
    };

    let merge_result = {
        let stream_name = stream_name.to_string();
        let latest_schema = latest_schema.clone();
        let new_file_meta = new_file_meta.clone();
        DATAFUSION_RUNTIME
            .spawn(async move {
                exec::merge_parquet_files(
                    stream_type,
                    &stream_name,
                    latest_schema,
                    vec![table],
                    &bloom_filter_fields,
                    &new_file_meta,
                    false,
                )
                .await
            })
            .await?
    };

    // clear session data
    crate::service::search::datafusion::storage::file_list::clear(&trace_id);

    let files = new_file_list.into_iter().map(|f| f.key).collect::<Vec<_>>();
    let (_new_schema, buf) = match merge_result {
        Ok(v) => v,
        Err(e) => {
            log::error!(
                "merge_parquet_files err: {e}, files: {files:?}, schema: {latest_schema:?}"
            );
            return Err(DataFusionError::Plan(format!("merge_parquet_files err: {e}")).into());
        }
    };

    // Process service streams if in compactor mode
    #[cfg(feature = "enterprise")]
    {
        let o2_config = o2_enterprise::enterprise::common::config::get_config();
        // Skip self-reporting streams from _meta organization to avoid processing internal metrics
        if o2_config.service_streams.enabled
            && o2_config.service_streams.is_compactor_mode()
            && org_id != config::META_ORG_ID
            && (stream_type == StreamType::Logs
                || stream_type == StreamType::Metrics
                || stream_type == StreamType::Traces)
        {
            // Apply two-tier sampling to ensure fair processing across all streams
            // Use the first file key as identifier for this merge operation
            let file_identifier = files.first().map(|f| f.as_str()).unwrap_or("unknown");
            let should_process =
                o2_enterprise::enterprise::service_streams::sampler::should_process_file(
                    org_id,
                    stream_type,
                    stream_name,
                    file_identifier,
                );

            if should_process {
                // Process the merged data for service discovery
                // Works with all stream types (same as ingester mode)
                if let Err(e) =
                    process_service_streams_from_parquet(org_id, stream_name, stream_type, &buf)
                        .await
                {
                    log::warn!(
                        "[COMPACTOR] Failed to process service streams for {org_id}/{stream_type}/{stream_name}: {}",
                        e
                    );
                }
            }
        }
    }

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
        MergeParquetResult::Single(buf) => {
            new_file_meta.compressed_size = buf.len() as i64;
            if new_file_meta.compressed_size == 0 {
                return Err(anyhow::anyhow!(
                    "merge_parquet_files error: compressed_size is 0"
                ));
            }

            let id = ider::generate_file_name();
            let new_file_key = format!("{prefix}/{id}{FILE_EXT_PARQUET}");
            log::info!(
                "[COMPACTOR:WORKER:{thread_id}] merged {} files into a new file: {}, original_size: {}, compressed_size: {}, took: {} ms",
                retain_file_list.len(),
                new_file_key,
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
            storage::put(&account, &new_file_key, buf.clone()).await?;

            if cfg.common.inverted_index_enabled && stream_type.support_index() && need_index {
                // generate inverted index
                generate_inverted_index(
                    &new_file_key,
                    &full_text_search_fields,
                    &index_fields,
                    &retain_file_list,
                    &mut new_file_meta,
                    stream_schema_for_index.clone(),
                    &buf,
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
                let new_file_key = format!("{prefix}/{id}{FILE_EXT_PARQUET}");

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
                storage::put(&account, &new_file_key, buf.clone()).await?;

                if cfg.common.inverted_index_enabled && stream_type.support_index() && need_index {
                    // generate inverted index
                    generate_inverted_index(
                        &new_file_key,
                        &full_text_search_fields,
                        &index_fields,
                        &retain_file_list,
                        &mut new_file_meta,
                        stream_schema_for_index.clone(),
                        &buf,
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
    buf: &Bytes,
) -> Result<(), anyhow::Error> {
    let (_parquet_schema, reader) = get_recordbatch_reader_from_bytes(buf).await?;
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
            "create_tantivy_index_on_compactor for file: {}, error: {}, need delete files: {:?}",
            new_file_key,
            e,
            retain_file_list
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

/// Process service streams from merged parquet data (compactor mode)
#[cfg(feature = "enterprise")]
async fn process_service_streams_from_parquet(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    parquet_result: &exec::MergeParquetResult,
) -> Result<(), anyhow::Error> {
    let parquet_bytes = match parquet_result {
        exec::MergeParquetResult::Single(buf) => buf,
        exec::MergeParquetResult::Multiple { bufs, .. } => {
            // For multiple files, process each one
            for buf in bufs {
                process_single_parquet_buffer(org_id, stream_name, stream_type, buf).await?;
            }
            return Ok(());
        }
    };

    process_single_parquet_buffer(org_id, stream_name, stream_type, parquet_bytes).await
}

#[cfg(feature = "enterprise")]
async fn process_single_parquet_buffer(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    parquet_bytes: &[u8],
) -> Result<(), anyhow::Error> {
    // Read record batches from parquet bytes
    let bytes = Bytes::from(parquet_bytes.to_vec());
    let (_schema, batches) = read_recordbatch_from_bytes(&bytes).await?;

    if batches.is_empty() {
        return Ok(());
    }

    // Get semantic field groups from system_settings (user-customizable via UI, with caching)
    let semantic_groups =
        crate::service::db::system_settings::get_semantic_field_groups(org_id).await;

    // Get FQN priority from DB/cache (org-level setting or system default)
    let fqn_priority =
        crate::service::db::system_settings::get_fqn_priority_dimensions(org_id).await;

    let processor = std::sync::Arc::new(
        o2_enterprise::enterprise::service_streams::processor::StreamProcessor::new(
            org_id.to_string(),
            semantic_groups,
            fqn_priority,
        ),
    );

    // Get config values for channel capacity
    let ss_config = &o2_enterprise::enterprise::common::config::get_config().service_streams;
    let channel_capacity = ss_config.channel_capacity;

    // Use bounded channel with backpressure for memory control
    // ARROW-NATIVE: Channel now sends RecordBatch directly (no HashMap conversion!)
    let (tx, mut rx) = mpsc::channel::<arrow::record_batch::RecordBatch>(channel_capacity);

    let org_id_owned = org_id.to_string();
    let stream_name_owned = stream_name.to_string();

    // Spawn producer task to send Arrow batches directly through channel
    // ARROW-NATIVE: No HashMap conversion! Sends RecordBatch directly.
    let producer_handle = tokio::spawn(async move {
        let mut records_sent: u64 = 0;
        let mut records_dropped: u64 = 0;

        for batch in batches {
            let num_rows = batch.num_rows();
            if num_rows == 0 {
                continue;
            }

            // Send Arrow batch directly (no conversion!)
            match tx.try_send(batch) {
                Ok(()) => {
                    records_sent += num_rows as u64;
                }
                Err(mpsc::error::TrySendError::Full(dropped_batch)) => {
                    let dropped = dropped_batch.num_rows() as u64;
                    records_dropped += dropped;
                    if records_dropped.is_multiple_of(1000) {
                        log::warn!(
                            "[COMPACTOR] Service streams channel full, dropped {} records so far",
                            records_dropped
                        );
                    }
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    return (records_sent, records_dropped);
                }
            }
        }

        (records_sent, records_dropped)
    });

    // Consumer: process Arrow batches as they arrive
    // ARROW-NATIVE: Process RecordBatch directly (no HashMap conversion!)
    let mut total_services = 0u64;
    while let Some(batch) = rx.recv().await {
        if batch.num_rows() == 0 {
            continue;
        }

        let services = processor
            .process_arrow_batch(&batch, stream_type, &stream_name_owned)
            .await;

        if !services.is_empty() {
            let service_count = services.len() as u64;
            total_services += service_count;

            // Queue services for batched processing
            o2_enterprise::enterprise::service_streams::batch_processor::queue_services(
                org_id_owned.clone(),
                services,
            )
            .await;
        }
    }

    // Wait for producer to finish and get stats
    let (records_sent, records_dropped) = producer_handle.await.unwrap_or((0, 0));

    if total_services > 0 || records_dropped > 0 {
        log::info!(
            "[COMPACTOR] Service streams for {}/{}/{}: {} services discovered, {} records processed, {} records dropped",
            org_id_owned,
            stream_type,
            stream_name_owned,
            total_services,
            records_sent,
            records_dropped
        );
    }

    Ok(())
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
}
