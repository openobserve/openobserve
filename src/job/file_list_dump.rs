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
    datatypes::Field,
    record_batch::RecordBatch,
};
use arrow_schema::Schema;
use chrono::{Datelike, Timelike, Utc};
use config::{
    PARQUET_BATCH_SIZE, PARQUET_MAX_ROW_GROUP_SIZE,
    cluster::{self, LOCAL_NODE},
    get_config, get_parquet_compression,
    meta::stream::StreamType,
};
use infra::{file_list::FileRecord, table::file_list_dump::FileListDump};
use once_cell::sync::Lazy;
use parquet::{arrow::AsyncArrowWriter, file::properties::WriterProperties};
use tokio::sync::{
    Mutex,
    mpsc::{Receiver, Sender},
};

use crate::{common::infra::cluster::get_node_by_uuid, service::db};

const HOUR_IN_MS: i64 = 3600 * 1000;
pub static FILE_LIST_SCHEMA: Lazy<Arc<Schema>> = Lazy::new(|| {
    Arc::new(Schema::new(vec![
        Field::new("id", arrow_schema::DataType::Int64, false),
        Field::new("org", arrow_schema::DataType::Utf8, false),
        Field::new("stream", arrow_schema::DataType::Utf8, false),
        Field::new("date", arrow_schema::DataType::Utf8, false),
        Field::new("file", arrow_schema::DataType::Utf8, false),
        Field::new("deleted", arrow_schema::DataType::Boolean, false),
        Field::new("flattened", arrow_schema::DataType::Boolean, false),
        Field::new("min_ts", arrow_schema::DataType::Int64, false),
        Field::new("max_ts", arrow_schema::DataType::Int64, false),
        Field::new("records", arrow_schema::DataType::Int64, false),
        Field::new("original_size", arrow_schema::DataType::Int64, false),
        Field::new("compressed_size", arrow_schema::DataType::Int64, false),
        Field::new("index_size", arrow_schema::DataType::Int64, true),
    ]))
});
pub const FILE_LIST_CACHE_DIR_NAME: &str = "_oo_file_list_dump";

type JobInfo = (i64, String, String, i64);

struct DownloadQueue {
    sender: Sender<JobInfo>,
    receiver: Arc<Mutex<Receiver<JobInfo>>>,
}

impl DownloadQueue {
    fn new(sender: Sender<JobInfo>, receiver: Arc<Mutex<Receiver<JobInfo>>>) -> Self {
        Self { sender, receiver }
    }
}

const FILE_LIST_DUMP_QUEUE_SIZE: usize = 10000;
const FILE_LIST_DUMP_THREAD_COUNT: usize = 25;
static FILE_LIST_DUMP_CHANNEL: Lazy<DownloadQueue> = Lazy::new(|| {
    let (tx, rx) = tokio::sync::mpsc::channel::<JobInfo>(FILE_LIST_DUMP_QUEUE_SIZE);
    DownloadQueue::new(tx, Arc::new(Mutex::new(rx)))
});

async fn lock_stream(org: &str, stream: &str) -> Option<()> {
    // we make this dummy stream name, because the actual file_list stream will also
    // be used by compactor to compact the dump files
    let stream_name = format!("file_list_dump/{stream}");
    let (_, node) = db::compact::files::get_offset(org, StreamType::Filelist, &stream_name).await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return None; // other node is processing
    }

    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        let lock_key = format!(
            "/file_list_dump/{}/{}/{}",
            org,
            StreamType::Filelist,
            stream,
        );
        let locker = match infra::dist_lock::lock(&lock_key, 10).await {
            Ok(l) => l,
            Err(_) => return None,
        };
        // check the working node again, maybe other node locked it first
        let (_, node) =
            db::compact::files::get_offset(org, StreamType::Filelist, &stream_name).await;
        if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            let _ = infra::dist_lock::unlock(&locker).await;
            return None; // other node is processing
        }
        // set to current node
        let _ = db::compact::files::set_offset(
            org,
            StreamType::Filelist,
            &stream_name,
            0, // we don't care about the actual offset
            Some(&LOCAL_NODE.uuid.clone()),
        )
        .await;
        let _ = infra::dist_lock::unlock(&locker).await;
        drop(locker);
    }
    Some(())
}

pub async fn run() -> Result<(), anyhow::Error> {
    // cache generation is only done on compactor
    if !LOCAL_NODE.is_compactor() {
        return Ok(());
    }
    let config = get_config();

    if !config.common.file_list_dump_enabled {
        return Ok(());
    }

    // spawn threads which will do the actual dumping
    for _ in 0..FILE_LIST_DUMP_THREAD_COUNT {
        let rx = FILE_LIST_DUMP_CHANNEL.receiver.clone();
        tokio::spawn(async move {
            loop {
                let ret = rx.lock().await.recv().await;
                match ret {
                    None => {
                        log::debug!("[FILE_LIST_DUMP:JOB] Receiving channel is closed");
                        break;
                    }
                    Some((job_id, org, stream, offset)) => {
                        if let Err(e) = dump(job_id, &org, &stream, offset).await {
                            log::error!(
                                "error in dumping files {org}/{stream} offset {offset} : {e}"
                            );
                        }
                    }
                }
            }
        });
    }

    // loop and keep checking on file_list_jobs for next dump jobs
    loop {
        if cluster::is_offline() {
            break;
        }

        let pending = infra::file_list::get_pending_dump_jobs().await?;
        let threshold_hour = Utc::now().timestamp_millis()
            - (config.common.file_list_dump_min_hour as i64 * HOUR_IN_MS);

        for (job_id, org, stream, offset) in pending {
            let end = offset + HOUR_IN_MS * 1000;
            if end >= threshold_hour {
                continue;
            }
            FILE_LIST_DUMP_CHANNEL
                .sender
                .send((job_id, org, stream, offset))
                .await?;
        }
        // sleep
        // because we depend on the compact jobs, we run it at 1/3 interval of
        // either compact interval or job cleanup interval, whichever is smaller
        // that way we can be sure that we will run at least twice before jobs are cleaned up
        // and we won't miss a job.
        let interval = (std::cmp::min(
            config.compact.interval as i64,
            config.compact.job_clean_wait_time,
        ) / 3)
            + 1;
        tokio::time::sleep(tokio::time::Duration::from_secs(
            interval.try_into().unwrap(),
        ))
        .await;
    }
    log::info!("[COMPACTOR:JOB] job::files::file_list_dump is stopped");
    Ok(())
}

async fn dump(job_id: i64, org: &str, stream: &str, offset: i64) -> Result<(), anyhow::Error> {
    let config = get_config();
    let start = offset;
    let end = offset + HOUR_IN_MS * 1000;

    if let None = lock_stream(org, stream).await {
        // someone else is processing this.
        return Ok(());
    }
    let files = infra::file_list::get_entries_in_range(&org, &stream, start, end).await?;
    let ids: Vec<i64> = files.iter().map(|r| r.id).collect();
    if let Err(e) = generate_cache_file(&org, &stream, (start, end), files).await {
        log::error!("[COMPACTOR:JOB] file_list dump file generation error : {e}");
    } else {
        log::info!("successfully dumped file list {org}/{stream} offset {offset}");
        // we remove files only if not dual writing
        if !config.common.file_list_dump_dual_write {
            if let Err(e) = remove_files_from_file_list(&ids).await {
                log::error!(
                    "error in removing dumped files from file_list, error : {}, ids {:?}",
                    e,
                    ids
                )
            } else {
                log::info!(
                    "successfully removed dumped files from file_list for {org}/{stream} offset {offset}"
                );
            }
        }
        if let Err(e) = infra::file_list::set_job_dumped_status(job_id, true).await {
            log::error!("error in setting dumped = true for job with id {job_id}, error : {e}");
        }
    }
    Ok(())
}

fn get_writer(schema: Arc<Schema>, buf: &mut Vec<u8>) -> AsyncArrowWriter<&mut Vec<u8>> {
    let cfg = get_config();
    let writer_props = WriterProperties::builder()
        .set_write_batch_size(PARQUET_BATCH_SIZE) // in bytes
        .set_max_row_group_size(PARQUET_MAX_ROW_GROUP_SIZE) // maximum number of rows in a row group
        .set_compression(get_parquet_compression(&cfg.common.parquet_compression));

    let writer_props = writer_props.build();
    AsyncArrowWriter::try_new(buf, schema.clone(), Some(writer_props)).unwrap()
}

async fn remove_files_from_file_list(ids: &[i64]) -> Result<(), anyhow::Error> {
    infra::file_list::batch_remove_by_ids(&ids).await?;
    Ok(())
}

async fn generate_cache_file(
    org: &str,
    stream: &str,
    range: (i64, i64),
    files: Vec<FileRecord>,
) -> Result<(), anyhow::Error> {
    // if there are no files to dump, no point in making a dump file
    if files.is_empty() {
        return Ok(());
    }
    let batch_size = files.len();

    let mut field_id = Int64Builder::with_capacity(batch_size);
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

    for file in files {
        field_id.append_value(file.id);
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
    }

    let schema = FILE_LIST_SCHEMA.clone();

    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(field_id.finish()),
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
        ],
    )?;

    let mut buf = Vec::new();
    let mut writer = get_writer(schema, &mut buf);
    writer.write(&batch).await?;
    writer.close().await?;

    let ts = chrono::DateTime::from_timestamp_micros(range.0).unwrap();

    let file_name = format!(
        "{:04}/{:02}/{:02}/{:02}/{}.parquet",
        ts.year(),
        ts.month(),
        ts.day(),
        ts.hour(),
        config::ider::generate()
    );

    let file_key = format!(
        "files/{org}/{}/{stream}/{}",
        FILE_LIST_CACHE_DIR_NAME, file_name
    );
    let entry = FileListDump {
        id: 0, // will be set by db
        org: org.to_string(),
        stream: stream.to_string(),
        start_ts: range.0,
        end_ts: range.1,
        file: file_name,
        records: batch_size as i64,
        original_size: buf.len() as i64,
        compressed_size: buf.len() as i64,
    };
    infra::storage::put(&file_key, buf.into()).await?;
    infra::table::file_list_dump::add_dump_file(entry).await?;
    Ok(())
}
