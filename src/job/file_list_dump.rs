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
use chrono::{Datelike, Duration, Timelike, Utc};
use config::{
    PARQUET_BATCH_SIZE, PARQUET_MAX_ROW_GROUP_SIZE, PARQUET_PAGE_SIZE,
    cluster::{self, LOCAL_NODE},
    get_config, get_parquet_compression,
};
use parquet::{arrow::AsyncArrowWriter, file::properties::WriterProperties};

const HOUR_IN_MS: i64 = 3600 * 1000;
const FILE_LIST_CACHE_DIR_NAME: &str = "_oo_file_list_cache";

pub async fn run() -> Result<(), anyhow::Error> {
    // cache generation is only done on compactor
    if !LOCAL_NODE.is_compactor() {
        return Ok(());
    }
    // prepare files
    loop {
        if cluster::is_offline() {
            break;
        }
        if let Err(e) = generate_cache_file().await {
            log::error!("[COMPACTOR:JOB] cache file generation error : {e}");
        }
        // sleep
        tokio::time::sleep(tokio::time::Duration::from_secs(60 * 60)).await;
    }
    log::info!("[COMPACTOR:JOB] job::files::file_list_cache is stopped");
    Ok(())
}

fn get_schema() -> Schema {
    Schema::new(vec![
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
    ])
}

fn get_writer(schema: Arc<Schema>, buf: &mut Vec<u8>) -> AsyncArrowWriter<&mut Vec<u8>> {
    let cfg = get_config();
    let writer_props = WriterProperties::builder()
        .set_write_batch_size(PARQUET_BATCH_SIZE) // in bytes
        .set_data_page_size_limit(PARQUET_PAGE_SIZE) // maximum size of a data page in bytes
        .set_max_row_group_size(PARQUET_MAX_ROW_GROUP_SIZE) // maximum number of rows in a row group
        .set_compression(get_parquet_compression(&cfg.common.parquet_compression));

    let writer_props = writer_props.build();
    AsyncArrowWriter::try_new(buf, schema.clone(), Some(writer_props)).unwrap()
}

async fn generate_cache_file() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let start_time = (Utc::now() - Duration::try_hours(cfg.limit.ingest_allowed_upto).unwrap())
        .timestamp_millis();

    // we need to get file_list in 1 hour duration before the ingest_allowed_upto
    // however we might not be on exact 1 hour mark when this run. So we subtract 1 more
    // hour from it, to get in the safe zone where we are sure the start time (hour) is beyond
    // the ingest_allowed_upto mark. Finally the end_time is 2 hours beyond the
    // ingest_allowed_upto mark
    let start_time = (start_time - start_time % HOUR_IN_MS);
    let end_time = start_time - HOUR_IN_MS;

    // TODO(YJDoc2) check if we can paginate
    let entries = infra::file_list::get_entries_in_range(start_time, end_time).await?;
    let batch_size = entries.len();

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

    for entry in entries {
        field_id.append_value(entry.id);
        field_org.append_value(entry.org);
        field_stream.append_value(entry.stream);
        field_date.append_value(entry.date);
        field_file.append_value(entry.file);
        field_deleted.append_value(entry.deleted);
        field_min_ts.append_value(entry.min_ts);
        field_max_ts.append_value(entry.max_ts);
        field_records.append_value(entry.records);
        field_original_size.append_value(entry.original_size);
        field_compressed_size.append_value(entry.compressed_size);
        field_index_size.append_value(entry.index_size);
        field_flattened.append_value(entry.flattened);
    }

    // TODO(YJDoc2) extract schema to static arc
    let schema = Arc::new(get_schema());

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

    let ts = chrono::DateTime::from_timestamp_millis(start_time).unwrap();
    // TODO(YJDoc2): add version suffix
    let file_key = format!(
        "files/{}/{:04}_{:02}_{:02}_{:02}.parquet",
        FILE_LIST_CACHE_DIR_NAME,
        ts.year(),
        ts.month(),
        ts.day(),
        ts.hour()
    );
    infra::storage::put(&file_key, buf.into()).await?;
    Ok(())
}
