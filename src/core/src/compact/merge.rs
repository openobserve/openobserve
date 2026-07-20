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
use bytes::Bytes;
use chrono::{DateTime, Datelike, Duration, TimeZone, Utc};
use config::{
    FileFormat,
    cluster::LOCAL_NODE,
    get_config, ider, is_local_disk_storage,
    meta::stream::{
        FileKey, FileListDeleted, FileMeta, MergeStrategy, PartitionTimeLevel, StorageType,
        StreamType,
    },
    metrics,
    utils::{
        parquet::read_schema_from_bytes,
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
use crate::{
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
    if !super::is_past_hour(offset) {
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

    // A job whose offset hour has not yet fully passed is an incremental round on the
    // still-open current hour (enqueued by the ingester, see service::compact::incremental):
    // only seal full-size groups and carry the remainder, so each file is merged into a
    // sealed output exactly once. The scheduled hour-end pass seals whatever is left.
    let offset = offset - offset % hour_micros(1);
    let is_incremental = !super::is_past_hour(offset);

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
        let task: JoinHandle<Result<Vec<i64>, anyhow::Error>> = tokio::task::spawn(async move {
            let cfg = get_config();
            // sort by file size
            let job_strategy = MergeStrategy::from(&cfg.compact.strategy);
            match job_strategy {
                MergeStrategy::FileSize => {
                    files_with_size.sort_by_key(|k| k.meta.original_size);
                }
                MergeStrategy::FileTime => {
                    files_with_size.sort_by_key(|k| k.meta.min_ts);
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
                return Ok(vec![]);
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
                            new_file_list.clear();
                            new_file_size = file.meta.original_size;
                            new_file_list.push(file.clone());
                            continue; // replace previous file with current file
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
                // The trailing batch is always below max_file_size (the loop flushes a group
                // only when adding the next file would exceed it). In incremental mode we do
                // NOT seal this remainder: more files will arrive in the still-open hour, and
                // sealing now would force re-merging it later (write amplification). Carry it
                // to the next round; the scheduled hour-end pass seals whatever is left.
                if new_file_list.len() > 1 && !is_incremental {
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
                    return Ok(vec![]); // no files need to merge
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
            let mut orphan_blooms = Vec::new();
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
                        selection: None,
                        row_group_size: None,
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

                // collect orphan blooms after writing file list successfully
                for file in delete_file_list {
                    if file.meta.bloom_ver > 0 {
                        orphan_blooms.push(file.meta.bloom_ver);
                    }
                }
            }
            drop(permit);
            if let Some(e) = last_error {
                return Err(e);
            }
            Ok(orphan_blooms)
        });
        tasks.push(task);
    }

    // collect bloom files which need to be clean
    let mut orphan_blooms = Vec::new();
    for task in tasks {
        orphan_blooms.extend(task.await??);
    }

    let _ = (is_incremental, orphan_blooms);

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
        bloom_ver: 0,
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
            file.key
        );
        let buf = file_data::get(&file.account, &file.key, None).await?;
        let file_format = FileFormat::from_extension(&file.key)
            .ok_or_else(|| anyhow::anyhow!("invalid file format: {}", file.key))?;
        let schema = match read_schema_from_bytes(file_format, &buf).await {
            Ok(schema) => schema,
            Err(e) => {
                log::error!(
                    "[COMPACTOR:WORKER:{thread_id}:{fi}] read schema error for file: {}, err: {e}",
                    file.key
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
    crate::search::datafusion::storage::file_list::clear(&trace_id);

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
        MergeParquetResult::Single {
            buf,
            file_meta: mut new_file_meta,
            file_format,
        } => {
            if new_file_meta.compressed_size == 0 {
                return Err(anyhow::anyhow!(
                    "merge_parquet_files error: compressed_size is 0"
                ));
            }

            let id = ider::generate_file_name();
            let new_file_key = format!("{prefix}/{id}{}", file_format.extension());
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

            // TODO: check how compliance will interact with org storage
            let account = storage::get_account(org_id, &new_file_key).unwrap_or_default();
            if cfg.s3.feature_force_infrequent_access && storage_type.is_compliance() {
                storage::put_with_compliance(&account, &new_file_key, buf.clone()).await?;
            } else {
                storage::put(&account, &new_file_key, buf.clone()).await?;
            }

            if cfg.common.inverted_index_enabled && stream_type.support_index() && need_index {
                generate_inverted_index(
                    org_id,
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
        MergeParquetResult::Multiple {
            bufs,
            file_metas,
            file_format,
        } => {
            for (buf, file_meta) in bufs.into_iter().zip(file_metas) {
                let mut new_file_meta = file_meta;
                new_file_meta.compressed_size = buf.len() as i64;
                if new_file_meta.compressed_size == 0 {
                    return Err(anyhow::anyhow!(
                        "merge_parquet_files error: compressed_size is 0"
                    ));
                }

                let id = ider::generate_file_name();
                let new_file_key = format!("{prefix}/{id}{}", file_format.extension());

                // upload file to storage
                let buf = Bytes::from(buf);
                if cfg.cache_latest_files.enabled
                    && cfg.cache_latest_files.cache_parquet
                    && cfg.cache_latest_files.download_from_node
                {
                    infra::cache::file_data::disk::set(&new_file_key, buf.clone()).await?;
                    log::debug!("merge_files {new_file_key} file_data::disk::set success");
                }

                // TODO: check how compliance will interact with org storage
                let account = storage::get_account(org_id, &new_file_key).unwrap_or_default();
                if cfg.s3.feature_force_infrequent_access && storage_type.is_compliance() {
                    storage::put_with_compliance(&account, &new_file_key, buf.clone()).await?;
                } else {
                    storage::put(&account, &new_file_key, buf.clone()).await?;
                }

                if cfg.common.inverted_index_enabled && stream_type.support_index() && need_index {
                    generate_inverted_index(
                        org_id,
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

#[allow(clippy::too_many_arguments)]
async fn generate_inverted_index(
    org_id: &str,
    new_file_key: &str,
    fts_fields: &[String],
    index_fields: &[String],
    retain_file_list: &[FileKey],
    new_file_meta: &mut FileMeta,
    latest_schema: Arc<Schema>,
    buf: Bytes,
) -> Result<(), anyhow::Error> {
    let index_size = create_tantivy_index(
        "COMPACTOR",
        org_id,
        new_file_key,
        fts_fields,
        index_fields,
        latest_schema, // Use stream schema to include all configured fields
        buf,
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
        openobserve_compactor::dump::handle_dump_stats_on_merge(&deleted_files, &new_files).await;
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
                bloom_ver: 0,
            },
            deleted: false,
            selection: None,
            row_group_size: None,
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
        assert!(file_key.selection.is_none());
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
