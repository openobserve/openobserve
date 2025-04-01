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
use chrono::{Datelike, Timelike};
use config::{
    PARQUET_BATCH_SIZE, PARQUET_MAX_ROW_GROUP_SIZE,
    cluster::{self, LOCAL_NODE},
    get_config, get_parquet_compression,
};
use infra::{file_list::FileRecord, table::file_list_dump::FileListDump};
use once_cell::sync::Lazy;
use parquet::{arrow::AsyncArrowWriter, file::properties::WriterProperties};

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

pub async fn run() -> Result<(), anyhow::Error> {
    // cache generation is only done on compactor
    if !LOCAL_NODE.is_compactor() {
        return Ok(());
    }
    let config = get_config();

    if !config.common.file_list_dump_enabled {
        return Ok(());
    }

    loop {
        if cluster::is_offline() {
            break;
        }

        // TOD (YJDoc2) check nats lock needed or not for multiple compactors
        // TODO (YJDoc2) set config limit to min old time for picking up jobs
        // TODO (YJDoc2) split into threads
        let pending = infra::file_list::get_pending_dump_jobs().await?;

        for (job_id, org, stream, offset) in pending {
            let start = offset;
            let end = offset + HOUR_IN_MS * 1000;
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
                    log::error!(
                        "error in setting dumped = true for job with id {job_id}, error : {e}"
                    );
                }
            }
        }

        // sleep
        // because we depend on the compact jobs, we run with the same interval
        tokio::time::sleep(tokio::time::Duration::from_secs(
            get_config().compact.interval,
        ))
        .await;
    }
    log::info!("[COMPACTOR:JOB] job::files::file_list_dump is stopped");
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
