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
    meta::stream::{FileKey, FileMeta, StreamType},
    utils::time::hour_micros,
};
use hashbrown::HashSet;
use infra::{
    dist_lock,
    file_list::FileRecord,
    schema::{STREAM_SCHEMAS_LATEST, SchemaCache},
};
use itertools::Itertools;
use once_cell::sync::Lazy;
use parquet::{arrow::AsyncArrowWriter, file::properties::WriterProperties};
use tokio::sync::{
    Mutex, RwLock,
    mpsc::{Receiver, Sender},
};

use crate::{common::infra::cluster::get_node_by_uuid, service::db};

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

const DUMP_JOB_MIN_INTERVAL: i64 = 30;

// these correspond to job_id, org_id, stream and offset
// job id is the id from db for that job row
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

// The reason we set it to 1 here is there is no special benefit for having larger queue in this
// case the sender can simply wait on the channel if there is no worker available.
static FILE_LIST_DUMP_CHANNEL: Lazy<DownloadQueue> = Lazy::new(|| {
    let (tx, rx) = tokio::sync::mpsc::channel::<JobInfo>(1);
    DownloadQueue::new(tx, Arc::new(Mutex::new(rx)))
});

// This stores the job ids that are currently in the queue for dumping
// normally the queue should be big enough and dumping should be fast enough
// that before the dump job runs again, everyhting from queue is dumped. But in extream cases
// it is possible that there are still jobs in the queue witing to be dumped, and the
// dump job (enqueing new jobs) runs again. In this case, it will again pick up the jobs which are
// currently in queue, because they are not marked as done in the db. In such case, it is possible
// that files in that time range get dumped before they are compacted. So instead we maintain this
// and before enqueing, check if the job_id is already waiting in queue or not.
static ONGOING_JOB_IDS: Lazy<RwLock<HashSet<i64>>> = Lazy::new(|| RwLock::new(HashSet::new()));

fn get_dump_stream_key(org: &str, stream: &str) -> String {
    format!(
        "{}/{}/{}",
        org,
        StreamType::Filelist,
        stream.replace('/', "_")
    )
}

async fn lock_stream(org_id: &str, stream_type: StreamType, stream_name: &str) -> Option<()> {
    let (_, node) = db::compact::files::get_offset(org_id, stream_type, stream_name).await;
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return None; // other node is processing
    }

    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        let lock_key = format!("/compact/merge/{}/{}/{}", org_id, stream_type, stream_name);
        let locker = match dist_lock::lock(&lock_key, 0).await {
            Ok(v) => v,
            Err(_) => return None,
        };
        // check the working node again, maybe other node locked it first
        let (offset, node) = db::compact::files::get_offset(org_id, stream_type, stream_name).await;
        if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            // we cannot do anything even if unlock fails, so ignore
            let _ = dist_lock::unlock(&locker).await;
            return None; // other node is processing
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
        let _ = dist_lock::unlock(&locker).await;
        drop(locker);
        match ret {
            Ok(_) => {}
            Err(_) => return None,
        }
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
    for _ in 0..config.limit.file_merge_thread_num {
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
                            log::error!("error in dumping files {stream} offset {offset} : {e}");
                        }
                        let mut ongoing = ONGOING_JOB_IDS.write().await;
                        ongoing.remove(&job_id);
                        drop(ongoing);
                    }
                }
            }
        });
    }

    let interval: u64 = std::cmp::max(config.compact.interval as i64, DUMP_JOB_MIN_INTERVAL)
        .try_into()
        .unwrap();

    // loop and keep checking on file_list_jobs for next dump jobs
    loop {
        if cluster::is_offline() {
            break;
        }

        // sleep
        tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;

        let pending = infra::file_list::get_pending_dump_jobs().await?;
        let threshold_hour = Utc::now().timestamp_micros()
            - (config.common.file_list_dump_min_hour as i64 * hour_micros(1));

        let ongoing = ONGOING_JOB_IDS.read().await;
        let pending = pending
            .into_iter()
            .filter(|(id, _, _, offset)| {
                let end = offset + hour_micros(1);
                if end >= threshold_hour {
                    return false;
                }
                // if we already have that job in queue, we should not re-queue it
                !ongoing.contains(id)
            })
            .collect::<Vec<_>>();
        // it is important to drop this here, as the worker threads will
        // also write lock this in order to remove successful jobs
        // if we don't drop, we can deadlock if the queue gets full, because
        // worker will block on this lock, queue is full, and we block on queue to have space
        // but no worker free to remove from queue.
        drop(ongoing);
        for (job_id, org, stream, offset) in pending {
            if let Err(e) = FILE_LIST_DUMP_CHANNEL
                .sender
                .send((job_id, org, stream, offset))
                .await
            {
                log::error!("error in sending dump job to worker thread for {job_id} : {e}");
            } else {
                let mut ongoing = ONGOING_JOB_IDS.write().await;
                ongoing.insert(job_id);
                drop(ongoing);
            }
        }
    }
    log::info!("[COMPACTOR:JOB] job::files::file_list_dump is stopped");
    Ok(())
}

async fn dump(job_id: i64, org: &str, stream: &str, offset: i64) -> Result<(), anyhow::Error> {
    let start = offset;
    let end = offset + hour_micros(1);

    let columns = stream.split('/').collect::<Vec<&str>>();
    if columns.len() != 3 {
        log::warn!("invalid stream name format for {job_id} : {stream}");
        infra::file_list::set_job_dumped_status(job_id, true).await?;
        return Ok(());
    }
    let stream_type = StreamType::from(columns[1]);
    if stream_type == StreamType::Filelist {
        // we do not want to dump the dumped files
        infra::file_list::set_job_dumped_status(job_id, true).await?;
        return Ok(());
    }

    if lock_stream(org, stream_type, stream).await.is_none() {
        // someone else is processing this.
        return Ok(());
    }
    let files = infra::file_list::get_entries_in_range(org, Some(stream), start, end, None).await?;
    if files.is_empty() {
        if let Err(e) = infra::file_list::set_job_dumped_status(job_id, true).await {
            log::error!("error in setting dumped = true for job with id {job_id}, error : {e}");
        }
        return Ok(());
    }
    if let Err(e) = generate_dump(org, stream, (start, end), files, job_id).await {
        log::error!("[COMPACTOR:JOB] file_list dump file generation error : {e}");
    } else {
        let stream_key = get_dump_stream_key(org, stream);
        let schema_exists = STREAM_SCHEMAS_LATEST
            .read()
            .await
            .get(&stream_key)
            .is_some();
        if !schema_exists {
            if let Err(e) = super::db::schema::merge(
                org,
                &stream.replace('/', "_"),
                StreamType::Filelist,
                &FILE_LIST_SCHEMA,
                Some(Utc::now().timestamp_micros()),
            )
            .await
            {
                log::error!("erroring in saving file list schema for {stream_key} to db : {e}");
            }

            let cache = SchemaCache::new(FILE_LIST_SCHEMA.as_ref().to_owned());
            let mut w = STREAM_SCHEMAS_LATEST.write().await;
            w.insert(stream_key.clone(), cache);
        }
    }
    Ok(())
}

fn get_writer(
    schema: Arc<Schema>,
    buf: &mut Vec<u8>,
) -> Result<AsyncArrowWriter<&mut Vec<u8>>, anyhow::Error> {
    let cfg = get_config();
    let writer_props = WriterProperties::builder()
        .set_write_batch_size(PARQUET_BATCH_SIZE) // in bytes
        .set_max_row_group_size(PARQUET_MAX_ROW_GROUP_SIZE) // maximum number of rows in a row group
        .set_compression(get_parquet_compression(&cfg.common.parquet_compression));

    let writer_props = writer_props.build();
    let writer = AsyncArrowWriter::try_new(buf, schema.clone(), Some(writer_props))?;
    Ok(writer)
}

fn create_record_batch(files: Vec<FileRecord>) -> Result<RecordBatch, anyhow::Error> {
    let schema = FILE_LIST_SCHEMA.clone();
    if files.is_empty() {
        return Ok(RecordBatch::new_empty(schema));
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
    Ok(batch)
}

async fn generate_dump(
    org: &str,
    stream: &str,
    range: (i64, i64),
    files: Vec<FileRecord>,
    job_id: i64,
) -> Result<(), anyhow::Error> {
    // if there are no files to dump, no point in making a dump file
    if files.is_empty() {
        return Ok(());
    }

    let config = get_config();
    let batch_size = files.len();

    // if dual write is not enabled, we will remove the records
    // else keep them
    let ids: Vec<i64> = if !config.common.file_list_dump_dual_write {
        files.iter().map(|r| r.id).collect()
    } else {
        vec![]
    };

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

    let ts = chrono::DateTime::from_timestamp_micros(range.0).unwrap();

    let file_name = format!(
        "{:04}/{:02}/{:02}/{:02}/{}.parquet",
        ts.year(),
        ts.month(),
        ts.day(),
        ts.hour(),
        config::ider::generate()
    );

    let stream_key = get_dump_stream_key(org, stream);
    let file_key = format!("files/{stream_key}/{file_name}");

    let meta = FileMeta {
        min_ts: range.0,
        max_ts: range.1,
        records: batch_size as i64,
        original_size: buf.len() as i64,
        compressed_size: buf.len() as i64,
        index_size: 0,
        flattened: false,
    };

    // first store the file in storage
    // then update the entries in db,
    // and if both pass only then set the job as dumped=true
    let account = infra::storage::get_account(&file_key).unwrap_or_default();
    infra::storage::put(&account, &file_key, buf.into()).await?;

    let dump_file = FileKey {
        account: account.clone(),
        key: file_key.clone(),
        meta: meta.clone(),
        deleted: false,
        segment_ids: None,
    };
    infra::file_list::update_dump_records(&dump_file, &ids).await?;
    infra::file_list::set_job_dumped_status(job_id, true).await?;
    log::info!(
        "successfully dumped file list {stream} offset {} count {batch_size}",
        range.0
    );
    Ok(())
}
