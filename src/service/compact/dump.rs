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

use arrow::{
    array::{BooleanBuilder, Int64Builder, StringBuilder},
    record_batch::RecordBatch,
};
use arrow_schema::Schema;
use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc};
use config::{
    FileFormat, PARQUET_MAX_ROW_GROUP_SIZE,
    cluster::LOCAL_NODE,
    get_batch_size, get_config, get_parquet_compression,
    meta::{
        cluster::Role,
        stream::{FileKey, FileListDeleted, FileMeta, PartitionTimeLevel, StreamStats, StreamType},
    },
    utils::{
        parquet::get_recordbatch_reader_from_bytes,
        time::{BASE_TIME, get_ymdh_from_micros, hour_micros, now, now_micros},
    },
};
use futures::StreamExt;
use infra::{
    cluster::get_node_from_consistent_hash,
    errors, file_list as infra_file_list,
    file_list::FileRecord,
    schema::{STREAM_SCHEMAS_LATEST, SchemaCache, get_partition_time_level, get_settings},
};
use itertools::Itertools;
use parquet::{arrow::AsyncArrowWriter, file::properties::WriterProperties};
use tokio::sync::mpsc;

use crate::service::{db, file_list_dump::*};

#[derive(Clone)]
pub struct DumpJob {
    pub org_id: String,
    pub stream_type: StreamType,
    pub stream_name: String,
    pub job_id: i64,
    pub offset: i64,
}

// compactor dump run steps:
// 1. we only get the jobs with node is empty and if any job picked upby this node will set the node
//    to this node then no other node will pick it up again.
// 2.also we will start a thread to keepalive the updated_at that can't be reset by
//    check_running_jobs.
// 3. if one job wasn't update for a long time, we will reset the node to empty and another job will
//    pick it up
pub async fn run(tx: mpsc::Sender<DumpJob>) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let jobs =
        infra_file_list::get_pending_dump_jobs(&LOCAL_NODE.uuid, cfg.compact.batch_size).await?;
    if jobs.is_empty() {
        return Ok(());
    }

    let now = now();
    let data_lifecycle_end = now - Duration::try_days(cfg.compact.data_retention_days).unwrap();

    // check jobs before dumping
    let mut need_release_ids = Vec::new();
    let mut need_done_ids = Vec::new();
    let mut dump_jobs = Vec::with_capacity(jobs.len());
    for (job_id, stream, offset) in jobs.iter() {
        // if the stream partition_time_level is daily we only allow one compactor
        let columns = stream.split('/').collect::<Vec<&str>>();
        assert_eq!(columns.len(), 3);
        let org_id = columns[0].to_string();
        let stream_type = StreamType::from(columns[1]);
        let stream_name = columns[2].to_string();
        if stream_type == StreamType::Filelist {
            need_done_ids.push(*job_id); // we don't dump for file_list stream
            continue;
        }
        let stream_settings = get_settings(&org_id, &stream_name, stream_type)
            .await
            .unwrap_or_default();
        let partition_time_level = get_partition_time_level(stream_type);
        // to avoid compacting conflict with retention, need check the data retention time
        let stream_data_retention_end = if stream_settings.data_retention > 0 {
            now - Duration::try_days(stream_settings.data_retention).unwrap()
        } else {
            data_lifecycle_end
        };
        if *offset <= stream_data_retention_end.timestamp_micros() {
            need_done_ids.push(*job_id); // the data will be deleted by retention, just skip
            continue;
        }
        // check if we are allowed to merge or just skip
        if db::compact::retention::is_deleting_stream(&org_id, stream_type, &stream_name, None) {
            need_done_ids.push(*job_id); // the data will be deleted by retention, just skip
            continue;
        }
        if partition_time_level == PartitionTimeLevel::Daily {
            // check if this stream need process by this node
            let Some(node_name) =
                get_node_from_consistent_hash(&stream_name, &Role::Compactor, None).await
            else {
                continue; // no compactor node
            };
            if LOCAL_NODE.name.ne(&node_name) {
                need_release_ids.push(*job_id); // not this node
                continue;
            }

            // check if already running a job for this stream
            if db::compact::stream::is_running(stream) {
                need_release_ids.push(*job_id); // another job is running
                continue;
            } else {
                db::compact::stream::set_running(stream);
            }
        }
        // collect the dump jobs
        dump_jobs.push(DumpJob {
            org_id,
            stream_type,
            stream_name,
            job_id: *job_id,
            offset: *offset,
        });
    }

    if !need_release_ids.is_empty() {
        // release those jobs
        if let Err(e) = infra_file_list::set_job_dumped_status(&need_release_ids, false).await {
            log::error!("[COMPACTOR::DUMP] set_job_dumped_status failed: {e}");
        }
    }

    if !need_done_ids.is_empty() {
        // set those jobs to done
        if let Err(e) = infra_file_list::set_job_dumped_status(&need_done_ids, true).await {
            log::error!("[COMPACTOR::DUMP] set_job_dumped_status failed: {e}");
        }
    }

    // create a thread to keep updating the job status
    //
    // Update job status (updated_at) to prevent pickup by another node
    // convert job_timeout from secs to micros, and check 1/4 of job_timeout
    // why 1/4 of job_run_timeout?
    // because the timeout is for the entire job, we need to update the job status
    // before it timeout, using 1/2 might still risk a timeout, so we use 1/4 for safety
    let ttl = std::cmp::max(60, cfg.compact.job_run_timeout / 4) as u64;
    let job_ids = dump_jobs.iter().map(|job| job.job_id).collect::<Vec<_>>();
    let (_tx, mut rx) = mpsc::channel::<()>(1);
    tokio::task::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(ttl)) => {}
                _ = rx.recv() => {
                    log::debug!("[COMPACTOR::DUMP] update_running_jobs done");
                    return;
                }
            }
            if let Err(e) = infra_file_list::update_running_jobs(&job_ids).await {
                log::error!("[COMPACTOR::DUMP] update_job_status failed: {e}");
            }
        }
    });

    for job in dump_jobs {
        if let Err(e) = tx.send(job.clone()).await {
            log::error!(
                "[COMPACTOR::DUMP] error in sending dump job to worker thread for [{}/{}/{}] offset {}: {e}",
                job.org_id,
                job.stream_type,
                job.stream_name,
                job.offset,
            );
        }
    }
    Ok(())
}

pub async fn dump(job: &DumpJob) -> Result<(), anyhow::Error> {
    let start = std::time::Instant::now();
    let stream = format!("{}/{}/{}", job.org_id, job.stream_type, job.stream_name);
    log::debug!(
        "[COMPACTOR::DUMP] dumping job {} start for {stream} offset: {}",
        job.job_id,
        job.offset
    );

    // check offset
    let partition_time_level = get_partition_time_level(job.stream_type);
    let offset_time: DateTime<Utc> = Utc.timestamp_nanos(job.offset * 1000);
    let offset_hour = Utc
        .with_ymd_and_hms(
            offset_time.year(),
            offset_time.month(),
            offset_time.day(),
            offset_time.hour(),
            0,
            0,
        )
        .unwrap();
    let (start_time, end_time) = if partition_time_level == PartitionTimeLevel::Daily {
        (
            // start of the day
            offset_hour.with_hour(0).unwrap().timestamp_micros(),
            // start of next hour
            offset_hour.timestamp_micros() + hour_micros(1) - 1,
        )
    } else {
        (
            // start of the hour
            offset_hour.timestamp_micros(),
            // start of next hour
            offset_hour.timestamp_micros() + hour_micros(1) - 1,
        )
    };

    let files = infra_file_list::query_for_dump(
        &job.org_id,
        job.stream_type,
        &job.stream_name,
        (start_time, end_time),
    )
    .await?;
    if files.is_empty() {
        if let Err(e) = infra_file_list::set_job_dumped_status(&[job.job_id], true).await {
            log::error!(
                "[COMPACTOR::DUMP] error in setting dumped = true for job with id {}, error: {e}",
                job.job_id,
            );
        }
        log::debug!(
            "[COMPACTOR::DUMP] no files to dump for stream [{}/{}/{}] offset [{start_time},{end_time}]",
            job.org_id,
            job.stream_type,
            job.stream_name,
        );
        return Ok(());
    }

    // check if the schema need to be updated
    let dump_stream_name = generate_dump_stream_name(job.stream_type, &job.stream_name);
    let dump_stream_key = format!(
        "{}/{}/{}",
        job.org_id,
        StreamType::Filelist,
        dump_stream_name
    );
    let r = STREAM_SCHEMAS_LATEST.read().await;
    let schema = r.get(&dump_stream_key).cloned();
    drop(r);
    if schema
        .as_ref()
        .is_none_or(|s| s.fields_map().len() != FILE_LIST_SCHEMA.fields().len())
    {
        if let Err(e) = super::db::schema::merge(
            &job.org_id,
            &dump_stream_name,
            StreamType::Filelist,
            &FILE_LIST_SCHEMA,
            Some(start_time),
        )
        .await
        {
            log::error!(
                "[COMPACTOR::DUMP] erroring in saving file list dump schema for {dump_stream_key} to db: {e}"
            );
            return Err(e);
        }

        let cache = SchemaCache::new(FILE_LIST_SCHEMA.as_ref().to_owned());
        let mut w = STREAM_SCHEMAS_LATEST.write().await;
        w.insert(dump_stream_key, cache);
    }

    // calculate stats from files before they are moved
    let mut stats = StreamStats {
        created_at: now_micros(),
        doc_time_min: i64::MAX,
        doc_time_max: 0,
        doc_num: 0,
        file_num: 0,
        storage_size: 0.0,
        compressed_size: 0.0,
        index_size: 0.0,
    };
    for file in &files {
        stats.file_num += 1;
        stats.doc_num += file.records;
        stats.doc_time_min = stats.doc_time_min.min(file.min_ts);
        stats.doc_time_max = stats.doc_time_max.max(file.max_ts);
        stats.storage_size += file.original_size as f64;
        stats.compressed_size += file.compressed_size as f64;
        stats.index_size += file.index_size as f64;
    }
    if stats.doc_time_min == i64::MAX {
        stats.doc_time_min = 0;
    }

    // generate the dump file
    let ids: Vec<i64> = files.iter().map(|r| r.id).collect();
    let dump_file = match generate_dump(
        &job.org_id,
        job.stream_type,
        &job.stream_name,
        (start_time, end_time),
        files,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            log::error!("[COMPACTOR::DUMP] file_list dump file generation error: {e}");
            return Err(e.into());
        }
    };

    if let Some(dump_file) = dump_file {
        // update the entries in db
        let records = dump_file.meta.records;
        let file_name = dump_file.key.clone();
        infra_file_list::update_dump_records(&dump_file, &ids).await?;

        // insert dump stats
        if let Err(e) = infra_file_list::insert_dump_stats(&file_name, &stats).await {
            log::error!("[COMPACTOR::DUMP] error inserting dump stats for {file_name}: {e}");
        }

        infra_file_list::set_job_dumped_status(&[job.job_id], true).await?;
        log::info!(
            "[COMPACTOR::DUMP] successfully dumped {records} records to file {file_name}, took: {} ms",
            start.elapsed().as_millis(),
        );
    } else {
        log::error!(
            "[COMPACTOR::DUMP] failed to generate dump file for stream [{}/{}/{}] offset [{start_time},{end_time}]",
            job.org_id,
            job.stream_type,
            job.stream_name,
        );
    }

    Ok(())
}

pub async fn delete_all(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), errors::Error> {
    delete_by_time_range(
        org_id,
        stream_type,
        stream_name,
        (BASE_TIME.timestamp_micros(), Utc::now().timestamp_micros()),
        true,
    )
    .await
}

// check this delete is daily or hourly
// -> daily
//   1. we need to get all the files in the range
//   2. simple mark these files as deleted
//   3. insert the deleted items into file_list_deleted table
// -> hourly
//   1. we need to get all the files in the range
//   2. pickup the items that need to be deleted
//   3. insert the deleted items into file_list_deleted table
//   4. generate a new dump file excluding the items that need to be deleted
//   5. make the old files deleted and add the new file to file_list table
pub async fn delete_by_time_range(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    range: (i64, i64),
    is_hourly: bool,
) -> Result<(), errors::Error> {
    let cfg = get_config();
    if !cfg.compact.file_list_dump_enabled {
        return Ok(());
    }
    let dump_stream_name = generate_dump_stream_name(stream_type, stream_name);
    let list =
        infra::file_list::query_for_dump(org_id, StreamType::Filelist, &dump_stream_name, range)
            .await?;
    if list.is_empty() {
        return Ok(());
    }
    if is_hourly {
        if let Err(e) = delete_hourly_inner(org_id, stream_type, stream_name, list, range).await {
            log::error!("[FILE_LIST_DUMP] delete_hourly_inner failed: {e}");
            return Err(e);
        }
    } else if let Err(e) = delete_daily_inner(org_id, list, range).await {
        log::error!("[FILE_LIST_DUMP] delete_daily_inner failed: {e}");
        return Err(e);
    }
    Ok(())
}

async fn delete_daily_inner(
    org_id: &str,
    list: Vec<FileRecord>,
    _range: (i64, i64),
) -> Result<(), errors::Error> {
    let cfg = get_config();
    let dump_files = list.iter().map(|f| f.into()).collect::<Vec<_>>();
    let query = "SELECT * FROM file_list";
    let trace_id = config::ider::generate_trace_id();
    let ret = exec(&trace_id, cfg.limit.cpu_num, dump_files.clone(), query).await?;
    let files = ret
        .into_iter()
        .flat_map(record_batch_to_file_record)
        .collect::<Vec<_>>();

    // create deleted items for file_list_deleted table
    let mut del_items: Vec<_> = files
        .iter()
        .map(|f| FileListDeleted {
            id: 0,
            account: f.account.to_string(),
            file: format!("files/{}/{}/{}", f.stream, f.date, f.file),
            index_file: false,
            flattened: false,
        })
        .collect();

    // we also need to delete the dump files
    del_items.extend(dump_files.iter().map(|f| FileListDeleted {
        id: 0,
        account: f.account.to_string(),
        file: f.key.clone(),
        index_file: false,
        flattened: false,
    }));

    let items: Vec<_> = dump_files
        .into_iter()
        .map(|mut f| {
            f.deleted = true;
            f.segment_ids = None;
            f
        })
        .collect();

    let mut mark_deleted_done = false;
    for _ in 0..5 {
        if !mark_deleted_done && let Err(e) = infra::file_list::batch_process(&items).await {
            log::error!("[FILE_LIST_DUMP] batch_delete to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        mark_deleted_done = true;

        if let Err(e) =
            infra::file_list::batch_add_deleted(org_id, Utc::now().timestamp_micros(), &del_items)
                .await
        {
            log::error!("[FILE_LIST_DUMP] batch_add_deleted to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        break;
    }

    // Delete dump_stats for deleted dump files
    for item in &items {
        if let Err(e) = infra_file_list::delete_dump_stats(&item.key).await {
            log::error!(
                "[FILE_LIST_DUMP] delete_dump_stats for {} failed: {e}",
                item.key
            );
        }
    }

    Ok(())
}

async fn delete_hourly_inner(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    list: Vec<FileRecord>,
    range: (i64, i64),
) -> Result<(), errors::Error> {
    let cfg = get_config();
    let dump_files = list.iter().map(|f| f.into()).collect::<Vec<_>>();
    let query = "SELECT * FROM file_list;";
    let trace_id = config::ider::generate_trace_id();
    let ret = exec(&trace_id, cfg.limit.cpu_num, dump_files.clone(), query).await?;
    let files = ret
        .into_iter()
        .flat_map(record_batch_to_file_record)
        .collect::<Vec<_>>();

    // Filter files based on the time range to find files to delete
    let start_date = get_ymdh_from_micros(range.0);
    let end_date = get_ymdh_from_micros(range.1);
    let (files_to_delete, files_to_keep): (Vec<_>, Vec<_>) = files
        .into_iter()
        .partition(|f| f.date >= start_date && f.date <= end_date);

    if files_to_delete.is_empty() {
        return Ok(()); // nothing need to do
    }

    let new_dump_file = if !files_to_keep.is_empty() {
        match generate_dump(org_id, stream_type, stream_name, range, files_to_keep).await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[FILE_LIST_DUMP] failed to generate dump file for delete hourly data, time range: {range:?}, error: {e}"
                );
                return Err(e);
            }
        }
    } else {
        None
    };

    // Create deleted items for file_list_deleted table
    let mut del_items: Vec<_> = files_to_delete
        .iter()
        .map(|f| FileListDeleted {
            id: 0,
            account: f.account.to_string(),
            file: format!("files/{}/{}/{}", f.stream, f.date, f.file),
            index_file: false,
            flattened: false,
        })
        .collect();

    // we also need to delete the dump files
    del_items.extend(dump_files.iter().map(|f| FileListDeleted {
        id: 0,
        account: f.account.to_string(),
        file: f.key.clone(),
        index_file: false,
        flattened: false,
    }));

    // create deleted items for file_list table
    let mut items: Vec<_> = dump_files
        .into_iter()
        .map(|mut f| {
            f.deleted = true;
            f.segment_ids = None;
            f
        })
        .collect();

    // insert the new dump file into file_list table
    if let Some(ref new_dump_file) = new_dump_file {
        items.push(new_dump_file.clone());
    }

    // Insert deleted items into file_list_deleted table with retry logic
    let mut mark_deleted_done = false;
    for _ in 0..5 {
        if !mark_deleted_done && let Err(e) = infra::file_list::batch_process(&items).await {
            log::error!("[FILE_LIST_DUMP] batch_process to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        mark_deleted_done = true;

        if let Err(e) =
            infra::file_list::batch_add_deleted(org_id, Utc::now().timestamp_micros(), &del_items)
                .await
        {
            log::error!("[FILE_LIST_DUMP] batch_add_deleted to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        break;
    }

    // Handle dump_stats: delete old and insert new if needed
    // Delete dump_stats for old dump files
    for item in &items {
        if item.deleted
            && let Err(e) = infra_file_list::delete_dump_stats(&item.key).await
        {
            log::error!(
                "[FILE_LIST_DUMP] delete_dump_stats for {} failed: {e}",
                item.key
            );
        }
    }

    // If a new dump file was created, calculate and insert its stats
    if let Some(ref new_dump_file) = new_dump_file {
        match calculate_dump_file_stats(&new_dump_file.account, &new_dump_file.key).await {
            Ok(stats) => {
                // Insert dump_stats for the new dump file
                if let Err(e) = infra_file_list::insert_dump_stats(&new_dump_file.key, &stats).await
                {
                    log::error!(
                        "[FILE_LIST_DUMP] insert_dump_stats for {} failed: {e}",
                        new_dump_file.key
                    );
                }
            }
            Err(e) => {
                log::error!(
                    "[FILE_LIST_DUMP] failed to calculate stats for new dump file {}: {e}",
                    new_dump_file.key
                );
            }
        }
    }

    Ok(())
}

// Generate a new dump file and upload to storage
async fn generate_dump(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    range: (i64, i64),
    files: Vec<FileRecord>,
) -> Result<Option<FileKey>, errors::Error> {
    // if there are no files to dump, no point in making a dump file
    if files.is_empty() {
        return Ok(None);
    }

    let records = files.len();

    let mut buf = Vec::new();
    let mut writer = get_writer(FILE_LIST_SCHEMA.clone(), &mut buf)?;
    // we split the file list into vec of vecs, with each sub-vec having batch_size elements
    // at most (last may be shorter) doing this the following way means we don't have to clone
    // anything, we simply shift the ownership via iterator
    let chunks: Vec<Vec<_>> = files
        .into_iter()
        .chunks(get_batch_size())
        .into_iter()
        .map(|c| c.collect())
        .collect();
    for chunk in chunks {
        let batch = create_record_batch(chunk)?;
        writer.write(&batch).await?;
    }
    writer.close().await?;

    let ts = Utc.timestamp_nanos(range.0 * 1000);

    let file_name = format!(
        "{:04}/{:02}/{:02}/{:02}/{}.parquet",
        ts.year(),
        ts.month(),
        ts.day(),
        "00", // we use daily partition
        config::ider::generate_file_name()
    );

    let dump_stream_name = generate_dump_stream_name(stream_type, stream_name);
    let file_key = format!(
        "files/{}/{}/{dump_stream_name}/{file_name}",
        org_id,
        StreamType::Filelist,
    );

    let meta = FileMeta {
        min_ts: range.0,
        max_ts: range.1 - 1, // because the end_time is the start of next hour
        records: records as i64,
        original_size: buf.len() as i64,
        compressed_size: buf.len() as i64,
        index_size: 0,
        flattened: false,
    };

    // store the file in storage
    let account = infra::storage::get_account(org_id, &file_key).unwrap_or_default();
    infra::storage::put(&account, &file_key, buf.into()).await?;

    let dump_file = FileKey {
        id: 0,
        account,
        key: file_key,
        meta,
        deleted: false,
        segment_ids: None,
    };

    Ok(Some(dump_file))
}

/// Handle dump stats when merging file_list type streams.
/// This function reads the new merged dump files, calculates stats from their contents,
/// deletes old stats, and inserts stats for new merged files.
pub async fn handle_dump_stats_on_merge(deleted_files: &[&FileKey], new_files: &[&FileKey]) {
    if deleted_files.is_empty() && new_files.is_empty() {
        return;
    }

    // Delete dump_stats for deleted files
    for file in deleted_files.iter() {
        if let Err(e) = infra_file_list::delete_dump_stats(&file.key).await {
            log::error!("[COMPACTOR] delete_dump_stats for {} failed: {e}", file.key);
        }
    }

    // For each new merged file, calculate and insert stats
    for file in new_files.iter() {
        match calculate_dump_file_stats(&file.account, &file.key).await {
            Ok(stats) => {
                // Insert dump_stats for this new merged file
                if let Err(e) = infra_file_list::insert_dump_stats(&file.key, &stats).await {
                    log::error!("[COMPACTOR] insert_dump_stats for {} failed: {e}", file.key);
                }
            }
            Err(e) => {
                log::error!(
                    "[COMPACTOR] failed to calculate stats for dump file {}: {e}",
                    file.key
                );
            }
        }
    }
}

/// Calculate statistics from a dump file by reading its contents.
/// This function reads a dump parquet file, parses all FileRecords in it,
/// and calculates aggregated statistics.
async fn calculate_dump_file_stats(account: &str, file_key: &str) -> Result<StreamStats, String> {
    // Read the dump parquet file from storage
    let file_data = infra::cache::file_data::get(account, file_key, None)
        .await
        .map_err(|e| format!("failed to read dump file from storage: {e}"))?;

    // Parse the parquet file to get FileRecord list
    let file_format = FileFormat::from_extension(file_key).unwrap_or(FileFormat::Parquet);
    let (_, mut reader) = get_recordbatch_reader_from_bytes(file_format, file_data)
        .await
        .map_err(|e| format!("failed to parse dump file as parquet: {e}"))?;

    // Calculate stats from all FileRecords in the dump file
    let mut stats = StreamStats {
        created_at: now_micros(),
        doc_time_min: i64::MAX,
        doc_time_max: 0,
        doc_num: 0,
        file_num: 0,
        storage_size: 0.0,
        compressed_size: 0.0,
        index_size: 0.0,
    };

    while let Some(batch_result) = reader.next().await {
        match batch_result {
            Ok(batch) => {
                let file_records = record_batch_to_file_record(batch);
                for record in file_records {
                    stats.file_num += 1;
                    stats.doc_num += record.records;
                    stats.storage_size += record.original_size as f64;
                    stats.compressed_size += record.compressed_size as f64;
                    stats.index_size += record.index_size as f64;
                    if record.min_ts > 0 {
                        stats.doc_time_min = stats.doc_time_min.min(record.min_ts);
                    }
                    stats.doc_time_max = stats.doc_time_max.max(record.max_ts);
                }
            }
            Err(e) => {
                return Err(format!("failed to read batch from dump file: {e}"));
            }
        }
    }

    // Fix doc_time_min if no valid min was found
    if stats.doc_time_min == i64::MAX {
        stats.doc_time_min = 0;
    }

    Ok(stats)
}

fn get_writer(
    schema: Arc<Schema>,
    buf: &mut Vec<u8>,
) -> Result<AsyncArrowWriter<&mut Vec<u8>>, errors::Error> {
    let cfg = get_config();
    let writer_props = WriterProperties::builder()
        .set_write_batch_size(get_batch_size()) // in bytes
        .set_max_row_group_row_count(Some(PARQUET_MAX_ROW_GROUP_SIZE)) // maximum number of rows in a row group
        .set_compression(get_parquet_compression(&cfg.common.parquet_compression));

    let writer_props = writer_props.build();
    let writer = AsyncArrowWriter::try_new(buf, schema.clone(), Some(writer_props))?;
    Ok(writer)
}

fn create_record_batch(files: Vec<FileRecord>) -> Result<RecordBatch, errors::Error> {
    let schema = FILE_LIST_SCHEMA.clone();
    if files.is_empty() {
        return Ok(RecordBatch::new_empty(schema));
    }
    let batch_size = files.len();

    let mut field_id = Int64Builder::with_capacity(batch_size);
    let mut field_account = StringBuilder::with_capacity(batch_size, batch_size * 128);
    let mut field_org = StringBuilder::with_capacity(batch_size, batch_size * 128);
    let mut field_stream = StringBuilder::with_capacity(batch_size, batch_size * 256);
    let mut field_date = StringBuilder::with_capacity(batch_size, batch_size * 10);
    let mut field_file = StringBuilder::with_capacity(batch_size, batch_size * 20);
    let mut field_deleted = BooleanBuilder::with_capacity(batch_size);
    let mut field_min_ts = Int64Builder::with_capacity(batch_size);
    let mut field_max_ts = Int64Builder::with_capacity(batch_size);
    let mut field_records = Int64Builder::with_capacity(batch_size);
    let mut field_original_size = Int64Builder::with_capacity(batch_size);
    let mut field_compressed_size = Int64Builder::with_capacity(batch_size);
    let mut field_index_size = Int64Builder::with_capacity(batch_size);
    let mut field_flattened = BooleanBuilder::with_capacity(batch_size);
    let mut field_updated_at = Int64Builder::with_capacity(batch_size);

    for file in files {
        field_id.append_value(file.id);
        field_account.append_value(file.account);
        field_org.append_value(file.org);
        field_stream.append_value(file.stream);
        field_date.append_value(file.date);
        field_file.append_value(file.file);
        field_deleted.append_value(file.deleted);
        field_min_ts.append_value(file.min_ts);
        field_max_ts.append_value(file.max_ts);
        field_records.append_value(file.records);
        field_original_size.append_value(file.original_size);
        field_compressed_size.append_value(file.compressed_size);
        field_index_size.append_value(file.index_size);
        field_flattened.append_value(file.flattened);
        field_updated_at.append_value(file.updated_at);
    }

    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(field_id.finish()),
            Arc::new(field_account.finish()),
            Arc::new(field_org.finish()),
            Arc::new(field_stream.finish()),
            Arc::new(field_date.finish()),
            Arc::new(field_file.finish()),
            Arc::new(field_deleted.finish()),
            Arc::new(field_flattened.finish()),
            Arc::new(field_min_ts.finish()),
            Arc::new(field_max_ts.finish()),
            Arc::new(field_records.finish()),
            Arc::new(field_original_size.finish()),
            Arc::new(field_compressed_size.finish()),
            Arc::new(field_index_size.finish()),
            Arc::new(field_updated_at.finish()),
        ],
    )?;
    Ok(batch)
}

#[cfg(test)]
mod tests {
    use arrow::array::{BooleanArray, Int64Array, StringArray};

    use super::*;

    // ---- DumpJob ----

    #[test]
    fn test_dump_job_creation() {
        let job = DumpJob {
            org_id: "test_org".to_string(),
            stream_type: StreamType::Logs,
            stream_name: "test_stream".to_string(),
            job_id: 123,
            offset: 1000000,
        };

        assert_eq!(job.org_id, "test_org");
        assert_eq!(job.stream_type, StreamType::Logs);
        assert_eq!(job.stream_name, "test_stream");
        assert_eq!(job.job_id, 123);
        assert_eq!(job.offset, 1000000);
    }

    #[test]
    fn test_dump_job_clone() {
        let job = DumpJob {
            org_id: "test_org".to_string(),
            stream_type: StreamType::Metrics,
            stream_name: "metric_stream".to_string(),
            job_id: 456,
            offset: 2000000,
        };

        let cloned = job.clone();
        assert_eq!(cloned.org_id, job.org_id);
        assert_eq!(cloned.stream_type, job.stream_type);
        assert_eq!(cloned.stream_name, job.stream_name);
        assert_eq!(cloned.job_id, job.job_id);
        assert_eq!(cloned.offset, job.offset);
    }

    #[test]
    fn test_dump_job_traces_stream_type() {
        let job = DumpJob {
            org_id: "org".to_string(),
            stream_type: StreamType::Traces,
            stream_name: "trace_stream".to_string(),
            job_id: 1,
            offset: 100,
        };
        assert_eq!(job.stream_type, StreamType::Traces);
    }

    #[test]
    fn test_dump_job_zero_offset() {
        let job = DumpJob {
            org_id: "org".to_string(),
            stream_type: StreamType::Logs,
            stream_name: "stream".to_string(),
            job_id: 0,
            offset: 0,
        };
        assert_eq!(job.job_id, 0);
        assert_eq!(job.offset, 0);
    }

    #[test]
    fn test_dump_job_negative_offset() {
        // offsets can technically be any i64
        let job = DumpJob {
            org_id: "org".to_string(),
            stream_type: StreamType::Logs,
            stream_name: "stream".to_string(),
            job_id: 99,
            offset: -1,
        };
        assert_eq!(job.offset, -1);
    }

    #[test]
    fn test_dump_job_max_values() {
        let job = DumpJob {
            org_id: "org".to_string(),
            stream_type: StreamType::Metrics,
            stream_name: "stream".to_string(),
            job_id: i64::MAX,
            offset: i64::MAX,
        };
        assert_eq!(job.job_id, i64::MAX);
        assert_eq!(job.offset, i64::MAX);
    }

    #[test]
    fn test_dump_job_clone_independence() {
        // Modifying the original should not affect the clone (String fields are value types)
        let original = DumpJob {
            org_id: "original_org".to_string(),
            stream_type: StreamType::Logs,
            stream_name: "original_stream".to_string(),
            job_id: 1,
            offset: 100,
        };
        let mut cloned = original.clone();
        cloned.job_id = 999;
        cloned.offset = 9999;
        assert_eq!(original.job_id, 1);
        assert_eq!(original.offset, 100);
    }

    // ---- create_record_batch ----

    #[test]
    fn test_dump_create_record_batch_empty() {
        let files: Vec<FileRecord> = vec![];
        let result = create_record_batch(files);

        assert!(result.is_ok());
        let batch = result.unwrap();
        assert_eq!(batch.num_rows(), 0);
        assert_eq!(batch.num_columns(), 15);
    }

    #[test]
    fn test_dump_create_record_batch_single_file() {
        let file = FileRecord {
            id: 1,
            account: "test_account".to_string(),
            org: "test_org".to_string(),
            stream: "test_stream".to_string(),
            date: "2024-01-01".to_string(),
            file: "file1.parquet".to_string(),
            deleted: false,
            flattened: true,
            min_ts: 1000,
            max_ts: 2000,
            records: 100,
            original_size: 10000,
            compressed_size: 5000,
            index_size: 500,
            updated_at: 1100,
        };

        let files = vec![file];
        let result = create_record_batch(files);

        assert!(result.is_ok());
        let batch = result.unwrap();
        assert_eq!(batch.num_rows(), 1);
        assert_eq!(batch.num_columns(), 15);

        // Verify column values
        let id_col = batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(id_col.value(0), 1);

        let org_col = batch
            .column(2)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(org_col.value(0), "test_org");

        let deleted_col = batch
            .column(6)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        assert!(!deleted_col.value(0));

        let flattened_col = batch
            .column(7)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        assert!(flattened_col.value(0));
    }

    #[test]
    fn test_dump_create_record_batch_multiple_files() {
        let files = vec![
            FileRecord {
                id: 1,
                account: "account1".to_string(),
                org: "org1".to_string(),
                stream: "stream1".to_string(),
                date: "2024-01-01".to_string(),
                file: "file1.parquet".to_string(),
                deleted: false,
                flattened: true,
                min_ts: 1000,
                max_ts: 2000,
                records: 100,
                original_size: 10000,
                compressed_size: 5000,
                index_size: 500,
                updated_at: 1100,
            },
            FileRecord {
                id: 2,
                account: "account2".to_string(),
                org: "org2".to_string(),
                stream: "stream2".to_string(),
                date: "2024-01-02".to_string(),
                file: "file2.parquet".to_string(),
                deleted: true,
                flattened: false,
                min_ts: 3000,
                max_ts: 4000,
                records: 200,
                original_size: 20000,
                compressed_size: 10000,
                index_size: 1000,
                updated_at: 2100,
            },
            FileRecord {
                id: 3,
                account: "account3".to_string(),
                org: "org3".to_string(),
                stream: "stream3".to_string(),
                date: "2024-01-03".to_string(),
                file: "file3.parquet".to_string(),
                deleted: false,
                flattened: true,
                min_ts: 5000,
                max_ts: 6000,
                records: 300,
                original_size: 30000,
                compressed_size: 15000,
                index_size: 1500,
                updated_at: 3100,
            },
        ];

        let result = create_record_batch(files.clone());

        assert!(result.is_ok());
        let batch = result.unwrap();
        assert_eq!(batch.num_rows(), 3);

        // Verify the data integrity
        let id_col = batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(id_col.value(0), 1);
        assert_eq!(id_col.value(1), 2);
        assert_eq!(id_col.value(2), 3);

        let records_col = batch
            .column(10)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(records_col.value(0), 100);
        assert_eq!(records_col.value(1), 200);
        assert_eq!(records_col.value(2), 300);

        let deleted_col = batch
            .column(6)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        assert!(!deleted_col.value(0));
        assert!(deleted_col.value(1));
        assert!(!deleted_col.value(2));
    }

    #[test]
    fn test_dump_create_record_batch_with_special_characters() {
        let file = FileRecord {
            id: 999,
            account: "test-account_2024".to_string(),
            org: "org/with/slashes".to_string(),
            stream: "stream@special#chars".to_string(),
            date: "2024-12-10".to_string(),
            file: "file-with-dashes_and_underscores.parquet".to_string(),
            deleted: false,
            flattened: false,
            min_ts: 1234567890,
            max_ts: 1234567999,
            records: 5000,
            original_size: 500000,
            compressed_size: 250000,
            index_size: 25000,
            updated_at: 1234568000,
        };

        let result = create_record_batch(vec![file]);

        assert!(result.is_ok());
        let batch = result.unwrap();
        assert_eq!(batch.num_rows(), 1);

        let org_col = batch
            .column(2)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(org_col.value(0), "org/with/slashes");

        let stream_col = batch
            .column(3)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(stream_col.value(0), "stream@special#chars");
    }

    #[test]
    fn test_dump_create_record_batch_column_order() {
        let file = FileRecord {
            id: 1,
            account: "account".to_string(),
            org: "org".to_string(),
            stream: "stream".to_string(),
            date: "2024-01-01".to_string(),
            file: "file.parquet".to_string(),
            deleted: false,
            flattened: false,
            min_ts: 1000,
            max_ts: 2000,
            records: 100,
            original_size: 10000,
            compressed_size: 5000,
            index_size: 500,
            updated_at: 1100,
        };

        let result = create_record_batch(vec![file]);
        assert!(result.is_ok());

        let batch = result.unwrap();
        let schema = batch.schema();

        // Verify column names are in the expected order
        let expected_columns = vec![
            "id",
            "account",
            "org",
            "stream",
            "date",
            "file",
            "deleted",
            "flattened",
            "min_ts",
            "max_ts",
            "records",
            "original_size",
            "compressed_size",
            "index_size",
            "updated_at",
        ];

        for (i, expected_name) in expected_columns.iter().enumerate() {
            assert_eq!(schema.field(i).name(), expected_name);
        }
    }

    // ---- New tests for uncovered branches ----

    #[test]
    fn test_dump_create_record_batch_zero_sizes() {
        // Test files with all-zero numeric fields
        let file = FileRecord {
            id: 0,
            account: "".to_string(),
            org: "".to_string(),
            stream: "".to_string(),
            date: "".to_string(),
            file: "".to_string(),
            deleted: false,
            flattened: false,
            min_ts: 0,
            max_ts: 0,
            records: 0,
            original_size: 0,
            compressed_size: 0,
            index_size: 0,
            updated_at: 0,
        };

        let result = create_record_batch(vec![file]);
        assert!(result.is_ok());
        let batch = result.unwrap();
        assert_eq!(batch.num_rows(), 1);

        let id_col = batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(id_col.value(0), 0);

        let records_col = batch
            .column(10)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(records_col.value(0), 0);
    }

    #[test]
    fn test_dump_create_record_batch_max_timestamps() {
        let file = FileRecord {
            id: i64::MAX,
            account: "acc".to_string(),
            org: "org".to_string(),
            stream: "stream".to_string(),
            date: "9999-12-31".to_string(),
            file: "f.parquet".to_string(),
            deleted: false,
            flattened: false,
            min_ts: i64::MAX - 1,
            max_ts: i64::MAX,
            records: i64::MAX,
            original_size: i64::MAX,
            compressed_size: i64::MAX,
            index_size: i64::MAX,
            updated_at: i64::MAX,
        };

        let result = create_record_batch(vec![file]);
        assert!(result.is_ok());
        let batch = result.unwrap();

        let min_ts_col = batch
            .column(8)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(min_ts_col.value(0), i64::MAX - 1);

        let max_ts_col = batch
            .column(9)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(max_ts_col.value(0), i64::MAX);
    }

    #[test]
    fn test_dump_create_record_batch_all_deleted() {
        let files: Vec<FileRecord> = (0..5)
            .map(|i| FileRecord {
                id: i,
                account: "acc".to_string(),
                org: "org".to_string(),
                stream: "stream".to_string(),
                date: "2024-01-01".to_string(),
                file: format!("file{}.parquet", i),
                deleted: true, // all deleted
                flattened: false,
                min_ts: i * 1000,
                max_ts: i * 1000 + 999,
                records: 10,
                original_size: 1024,
                compressed_size: 512,
                index_size: 64,
                updated_at: i * 1000 + 1000,
            })
            .collect();

        let result = create_record_batch(files);
        assert!(result.is_ok());
        let batch = result.unwrap();
        assert_eq!(batch.num_rows(), 5);

        let deleted_col = batch
            .column(6)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        for i in 0..5 {
            assert!(deleted_col.value(i), "row {} should be deleted", i);
        }
    }

    #[test]
    fn test_dump_create_record_batch_all_flattened() {
        let files: Vec<FileRecord> = (0..3)
            .map(|i| FileRecord {
                id: i,
                account: "acc".to_string(),
                org: "org".to_string(),
                stream: "stream".to_string(),
                date: "2024-06-15".to_string(),
                file: format!("file{}.parquet", i),
                deleted: false,
                flattened: true, // all flattened
                min_ts: 1000,
                max_ts: 2000,
                records: 50,
                original_size: 2048,
                compressed_size: 1024,
                index_size: 128,
                updated_at: 3000,
            })
            .collect();

        let result = create_record_batch(files);
        assert!(result.is_ok());
        let batch = result.unwrap();
        assert_eq!(batch.num_rows(), 3);

        let flattened_col = batch
            .column(7)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        for i in 0..3 {
            assert!(flattened_col.value(i), "row {} should be flattened", i);
        }
    }

    #[test]
    fn test_dump_create_record_batch_account_field() {
        let file = FileRecord {
            id: 42,
            account: "my-unique-account-id".to_string(),
            org: "org".to_string(),
            stream: "stream".to_string(),
            date: "2024-01-15".to_string(),
            file: "file.parquet".to_string(),
            deleted: false,
            flattened: false,
            min_ts: 100,
            max_ts: 200,
            records: 5,
            original_size: 100,
            compressed_size: 50,
            index_size: 5,
            updated_at: 200,
        };

        let result = create_record_batch(vec![file]);
        assert!(result.is_ok());
        let batch = result.unwrap();

        let account_col = batch
            .column(1)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(account_col.value(0), "my-unique-account-id");
    }

    #[test]
    fn test_dump_create_record_batch_file_and_date_fields() {
        let file = FileRecord {
            id: 7,
            account: "acc".to_string(),
            org: "org".to_string(),
            stream: "stream".to_string(),
            date: "2025-03-22".to_string(),
            file: "2025/03/22/00/abc123.parquet".to_string(),
            deleted: false,
            flattened: false,
            min_ts: 0,
            max_ts: 0,
            records: 0,
            original_size: 0,
            compressed_size: 0,
            index_size: 0,
            updated_at: 0,
        };

        let result = create_record_batch(vec![file]);
        assert!(result.is_ok());
        let batch = result.unwrap();

        let date_col = batch
            .column(4)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(date_col.value(0), "2025-03-22");

        let file_col = batch
            .column(5)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(file_col.value(0), "2025/03/22/00/abc123.parquet");
    }

    #[test]
    fn test_dump_create_record_batch_size_columns() {
        let file = FileRecord {
            id: 1,
            account: "acc".to_string(),
            org: "org".to_string(),
            stream: "stream".to_string(),
            date: "2024-01-01".to_string(),
            file: "f.parquet".to_string(),
            deleted: false,
            flattened: false,
            min_ts: 0,
            max_ts: 0,
            records: 777,
            original_size: 100_000,
            compressed_size: 40_000,
            index_size: 5_000,
            updated_at: 9999,
        };

        let result = create_record_batch(vec![file]);
        assert!(result.is_ok());
        let batch = result.unwrap();

        let orig_col = batch
            .column(11)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(orig_col.value(0), 100_000);

        let comp_col = batch
            .column(12)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(comp_col.value(0), 40_000);

        let idx_col = batch
            .column(13)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(idx_col.value(0), 5_000);

        let upd_col = batch
            .column(14)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(upd_col.value(0), 9999);
    }

    #[test]
    fn test_dump_create_record_batch_large_batch() {
        // 100 files — checks builder capacity handling
        let files: Vec<FileRecord> = (0..100)
            .map(|i| FileRecord {
                id: i,
                account: format!("acc{}", i),
                org: format!("org{}", i),
                stream: format!("stream{}", i),
                date: "2024-01-01".to_string(),
                file: format!("{}.parquet", i),
                deleted: i % 3 == 0,
                flattened: i % 2 == 0,
                min_ts: i * 100,
                max_ts: i * 100 + 99,
                records: i * 10,
                original_size: i * 1000,
                compressed_size: i * 500,
                index_size: i * 50,
                updated_at: i * 100 + 100,
            })
            .collect();

        let result = create_record_batch(files);
        assert!(result.is_ok());
        let batch = result.unwrap();
        assert_eq!(batch.num_rows(), 100);
    }

    // ---- Round-trip: create_record_batch -> record_batch_to_file_record ----

    #[test]
    fn test_roundtrip_single_file() {
        let original = FileRecord {
            id: 42,
            account: "acc42".to_string(),
            org: "org_rt".to_string(),
            stream: "stream_rt".to_string(),
            date: "2024-07-04".to_string(),
            file: "roundtrip.parquet".to_string(),
            deleted: false,
            flattened: true,
            min_ts: 10_000,
            max_ts: 20_000,
            records: 250,
            original_size: 25_000,
            compressed_size: 12_500,
            index_size: 1_250,
            updated_at: 20_001,
        };

        let batch = create_record_batch(vec![original.clone()]).unwrap();
        let recovered = crate::service::file_list_dump::record_batch_to_file_record(batch);

        assert_eq!(recovered.len(), 1);
        let r = &recovered[0];
        assert_eq!(r.id, original.id);
        assert_eq!(r.account, original.account);
        assert_eq!(r.org, original.org);
        assert_eq!(r.stream, original.stream);
        assert_eq!(r.date, original.date);
        assert_eq!(r.file, original.file);
        assert_eq!(r.deleted, original.deleted);
        assert_eq!(r.flattened, original.flattened);
        assert_eq!(r.min_ts, original.min_ts);
        assert_eq!(r.max_ts, original.max_ts);
        assert_eq!(r.records, original.records);
        assert_eq!(r.original_size, original.original_size);
        assert_eq!(r.compressed_size, original.compressed_size);
        assert_eq!(r.index_size, original.index_size);
        assert_eq!(r.updated_at, original.updated_at);
    }

    #[test]
    fn test_roundtrip_multiple_files_preserves_count() {
        let files: Vec<FileRecord> = (1..=10)
            .map(|i| FileRecord {
                id: i,
                account: format!("a{}", i),
                org: "org".to_string(),
                stream: "stream".to_string(),
                date: "2024-01-01".to_string(),
                file: format!("{}.parquet", i),
                deleted: false,
                flattened: false,
                min_ts: i * 1000,
                max_ts: i * 1000 + 999,
                records: i * 5,
                original_size: i * 100,
                compressed_size: i * 50,
                index_size: i * 5,
                updated_at: i * 1000 + 1000,
            })
            .collect();

        let count = files.len();
        let batch = create_record_batch(files).unwrap();
        let recovered = crate::service::file_list_dump::record_batch_to_file_record(batch);

        assert_eq!(recovered.len(), count);
        // Verify sorting: record_batch_to_file_record sorts by id
        for w in recovered.windows(2) {
            assert!(w[0].id <= w[1].id);
        }
    }

    #[test]
    fn test_roundtrip_empty_batch() {
        let batch = create_record_batch(vec![]).unwrap();
        let recovered = crate::service::file_list_dump::record_batch_to_file_record(batch);
        assert_eq!(recovered.len(), 0);
    }

    // ---- generate_dump_stream_name (via file_list_dump) ----

    #[test]
    fn test_generate_dump_stream_name_logs() {
        let name = generate_dump_stream_name(StreamType::Logs, "app_logs");
        assert_eq!(name, "app_logs_logs");
    }

    #[test]
    fn test_generate_dump_stream_name_metrics() {
        let name = generate_dump_stream_name(StreamType::Metrics, "cpu_metrics");
        assert_eq!(name, "cpu_metrics_metrics");
    }

    #[test]
    fn test_generate_dump_stream_name_traces() {
        let name = generate_dump_stream_name(StreamType::Traces, "http_traces");
        assert_eq!(name, "http_traces_traces");
    }

    #[test]
    fn test_generate_dump_stream_name_filelist() {
        let name = generate_dump_stream_name(StreamType::Filelist, "fl_stream");
        assert_eq!(name, "fl_stream_file_list");
    }

    #[test]
    fn test_generate_dump_stream_name_enrichment_tables() {
        let name = generate_dump_stream_name(StreamType::EnrichmentTables, "geo_table");
        assert_eq!(name, "geo_table_enrichment_tables");
    }

    #[test]
    fn test_generate_dump_stream_name_empty_stream() {
        let name = generate_dump_stream_name(StreamType::Logs, "");
        assert_eq!(name, "_logs");
    }

    #[test]
    fn test_generate_dump_stream_name_stream_with_underscores() {
        let name = generate_dump_stream_name(StreamType::Metrics, "my_stream_name");
        assert_eq!(name, "my_stream_name_metrics");
    }

    #[test]
    fn test_generate_dump_stream_name_stream_with_hyphens() {
        let name = generate_dump_stream_name(StreamType::Logs, "my-stream-2024");
        assert_eq!(name, "my-stream-2024_logs");
    }

    #[test]
    fn test_generate_dump_stream_name_format_pattern() {
        // Verify the pattern is always {stream_name}_{stream_type}
        for (stype, suffix) in &[
            (StreamType::Logs, "logs"),
            (StreamType::Metrics, "metrics"),
            (StreamType::Traces, "traces"),
        ] {
            let name = generate_dump_stream_name(*stype, "test");
            assert_eq!(name, format!("test_{}", suffix));
        }
    }

    // ---- StreamStats accumulation logic (pure arithmetic) ----

    #[test]
    fn test_stream_stats_default_values() {
        let stats = StreamStats {
            created_at: 0,
            doc_time_min: i64::MAX,
            doc_time_max: 0,
            doc_num: 0,
            file_num: 0,
            storage_size: 0.0,
            compressed_size: 0.0,
            index_size: 0.0,
        };
        // Check the sentinel value for doc_time_min (as used in dump() function)
        assert_eq!(stats.doc_time_min, i64::MAX);
        // After normalisation this would be set to 0
        let normalized_min = if stats.doc_time_min == i64::MAX {
            0
        } else {
            stats.doc_time_min
        };
        assert_eq!(normalized_min, 0);
    }

    #[test]
    fn test_stream_stats_accumulation_from_files() {
        // Mirrors the stats accumulation logic inside dump()
        let file_records = vec![
            (
                100i64,
                1_000i64,
                1_000_000i64,
                50i64,
                200i64,
                5_000i64,
                2_500i64,
                250i64,
            ),
            (200, 1_500, 1_500_000, 100, 300, 10_000, 5_000, 500),
        ];

        let mut stats = StreamStats {
            created_at: 0,
            doc_time_min: i64::MAX,
            doc_time_max: 0,
            doc_num: 0,
            file_num: 0,
            storage_size: 0.0,
            compressed_size: 0.0,
            index_size: 0.0,
        };

        for (records, min_ts, max_ts, file_num_delta, _doc, orig, comp, idx) in &file_records {
            stats.file_num += file_num_delta;
            stats.doc_num += records;
            stats.doc_time_min = stats.doc_time_min.min(*min_ts);
            stats.doc_time_max = stats.doc_time_max.max(*max_ts);
            stats.storage_size += *orig as f64;
            stats.compressed_size += *comp as f64;
            stats.index_size += *idx as f64;
        }

        if stats.doc_time_min == i64::MAX {
            stats.doc_time_min = 0;
        }

        assert_eq!(stats.doc_num, 300);
        assert_eq!(stats.file_num, 150);
        assert_eq!(stats.doc_time_min, 1_000);
        assert_eq!(stats.doc_time_max, 1_500_000);
        assert_eq!(stats.storage_size, 15_000.0);
        assert_eq!(stats.compressed_size, 7_500.0);
        assert_eq!(stats.index_size, 750.0);
    }

    #[test]
    fn test_stream_stats_doc_time_min_sentinel_no_files() {
        // When no files have been processed, doc_time_min stays at MAX
        // and should be clamped to 0 as the dump() function does
        let mut stats = StreamStats {
            created_at: 0,
            doc_time_min: i64::MAX,
            doc_time_max: 0,
            doc_num: 0,
            file_num: 0,
            storage_size: 0.0,
            compressed_size: 0.0,
            index_size: 0.0,
        };

        if stats.doc_time_min == i64::MAX {
            stats.doc_time_min = 0;
        }

        assert_eq!(stats.doc_time_min, 0);
    }

    #[test]
    fn test_dump_job_various_stream_types_for_stream_format() {
        // The dump function formats stream as "org/stream_type/name"
        // Verify this pattern is consistent with DumpJob fields
        let cases = vec![
            (StreamType::Logs, "logs"),
            (StreamType::Metrics, "metrics"),
            (StreamType::Traces, "traces"),
        ];
        for (stype, type_str) in cases {
            let job = DumpJob {
                org_id: "org".to_string(),
                stream_type: stype,
                stream_name: "stream".to_string(),
                job_id: 1,
                offset: 0,
            };
            let formatted = format!("{}/{}/{}", job.org_id, job.stream_type, job.stream_name);
            assert!(
                formatted.contains(type_str),
                "formatted stream '{}' should contain type '{}'",
                formatted,
                type_str
            );
        }
    }
}
