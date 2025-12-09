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

use arrow::{
    array::{BooleanBuilder, Int64Builder, StringBuilder},
    record_batch::RecordBatch,
};
use arrow_schema::Schema;
use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc};
use config::{
    PARQUET_BATCH_SIZE, PARQUET_MAX_ROW_GROUP_SIZE,
    cluster::LOCAL_NODE,
    get_config, get_parquet_compression,
    meta::{
        cluster::Role,
        stream::{FileKey, FileListDeleted, FileMeta, PartitionTimeLevel, StreamType},
    },
    utils::time::{BASE_TIME, get_ymdh_from_micros, hour_micros, now},
};
use infra::{
    errors, file_list as infra_file_list,
    file_list::FileRecord,
    schema::{STREAM_SCHEMAS_LATEST, SchemaCache, get_settings, unwrap_partition_time_level},
};
use itertools::Itertools;
use parquet::{arrow::AsyncArrowWriter, file::properties::WriterProperties};
use tokio::sync::mpsc;

use crate::{
    common::infra::cluster::get_node_from_consistent_hash,
    service::{db, file_list_dump::*},
};

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
        let partition_time_level =
            unwrap_partition_time_level(stream_settings.partition_time_level, stream_type);
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

    let stream_settings = get_settings(&job.org_id, &job.stream_name, job.stream_type)
        .await
        .unwrap_or_default();
    let partition_time_level =
        unwrap_partition_time_level(stream_settings.partition_time_level, job.stream_type);

    // check offset
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
                "[COMPACTOR::DUMP] error in setting dumped = true for job with id {}, error : {e}",
                job.job_id,
            );
        }
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
    if schema.is_none() || schema.unwrap().fields_map().len() != FILE_LIST_SCHEMA.fields().len() {
        if let Err(e) = super::db::schema::merge(
            &job.org_id,
            &dump_stream_name,
            StreamType::Filelist,
            &FILE_LIST_SCHEMA,
            None,
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
        infra_file_list::set_job_dumped_status(&[job.job_id], true).await?;
        log::info!(
            "[COMPACTOR::DUMP] successfully dumped file list for stream [{}/{}/{}] offset {start_time} records {records} to file {file_name}, took: {} ms",
            job.org_id,
            job.stream_type,
            job.stream_name,
            start.elapsed().as_millis(),
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
    is_daily: bool,
) -> Result<(), errors::Error> {
    let dump_stream_name = generate_dump_stream_name(stream_type, stream_name);
    let list =
        infra::file_list::query_for_dump(org_id, StreamType::Filelist, &dump_stream_name, range)
            .await?;
    if list.is_empty() {
        return Ok(());
    }
    if is_daily {
        if let Err(e) = delete_daily_inner(org_id, list, range).await {
            log::error!("[FILE_LIST_DUMP] delete_daily_inner failed: {e}");
            return Err(e);
        }
    } else if let Err(e) = delete_hourly_inner(org_id, stream_type, stream_name, list, range).await
    {
        log::error!("[FILE_LIST_DUMP] delete_hourly_inner failed: {e}");
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

    let del_items: Vec<_> = files
        .iter()
        .map(|f| FileListDeleted {
            id: 0,
            account: f.account.to_string(),
            file: format!("files/{}/{}/{}", f.stream, f.date, f.file),
            index_file: false,
            flattened: false,
        })
        .collect();

    let mut inserted_into_deleted = false;
    for _ in 0..5 {
        if !inserted_into_deleted
            && let Err(e) = infra::file_list::batch_add_deleted(
                org_id,
                Utc::now().timestamp_micros(),
                &del_items,
            )
            .await
        {
            log::error!("[FILE_LIST_DUMP] batch_add_deleted to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        inserted_into_deleted = true;
        let items: Vec<_> = dump_files
            .iter()
            .map(|f| {
                let mut f = f.clone();
                f.deleted = true;
                f.segment_ids = None;
                f
            })
            .collect();
        if let Err(e) = infra::file_list::batch_process(&items).await {
            log::error!("[FILE_LIST_DUMP] batch_delete to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        break;
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

    // generate new dump file with files_to_keep and upload to storage
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
    if let Some(new_dump_file) = new_dump_file {
        items.push(new_dump_file);
    }

    // Create deleted items for file_list_deleted table
    let del_items: Vec<_> = files_to_delete
        .iter()
        .map(|f| FileListDeleted {
            id: 0,
            account: f.account.to_string(),
            file: format!("files/{}/{}/{}", f.stream, f.date, f.file),
            index_file: false,
            flattened: false,
        })
        .collect();

    // Insert deleted items into file_list_deleted table with retry logic
    let mut inserted_into_deleted = false;
    for _ in 0..5 {
        if !inserted_into_deleted
            && let Err(e) = infra::file_list::batch_add_deleted(
                org_id,
                Utc::now().timestamp_micros(),
                &del_items,
            )
            .await
        {
            log::error!("[FILE_LIST_DUMP] batch_add_deleted to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        inserted_into_deleted = true;

        if let Err(e) = infra::file_list::batch_process(&items).await {
            log::error!("[FILE_LIST_DUMP] batch_process to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        break;
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
    // we split the file list into vec of vecs, with each sub-vec having PARQUET_BATCH_SIZE elements
    // at most (last may be shorter) doing this the following way means we don't have to clone
    // anything, we simply shift the ownership via iterator
    let chunks: Vec<Vec<_>> = files
        .into_iter()
        .chunks(PARQUET_BATCH_SIZE)
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
    let account = infra::storage::get_account(&file_key).unwrap_or_default();
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

fn get_writer(
    schema: Arc<Schema>,
    buf: &mut Vec<u8>,
) -> Result<AsyncArrowWriter<&mut Vec<u8>>, errors::Error> {
    let cfg = get_config();
    let writer_props = WriterProperties::builder()
        .set_write_batch_size(PARQUET_BATCH_SIZE) // in bytes
        .set_max_row_group_size(PARQUET_MAX_ROW_GROUP_SIZE) // maximum number of rows in a row group
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
    let mut field_created_at = Int64Builder::with_capacity(batch_size);
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
        field_created_at.append_value(file.created_at);
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
            Arc::new(field_created_at.finish()),
            Arc::new(field_updated_at.finish()),
        ],
    )?;
    Ok(batch)
}
