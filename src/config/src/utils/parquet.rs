// Copyright 2024 Zinc Labs Inc.
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

use std::{cmp::min, io::Cursor, path::PathBuf, sync::Arc};

use arrow::record_batch::RecordBatch;
use arrow_schema::Schema;
use futures::TryStreamExt;
use parquet::{
    arrow::{arrow_reader::ArrowReaderMetadata, AsyncArrowWriter, ParquetRecordBatchStreamBuilder},
    basic::{Compression, Encoding},
    file::{metadata::KeyValue, properties::WriterProperties},
    format::SortingColumn,
};

use crate::{config::*, ider, meta::stream::FileMeta};

pub fn new_parquet_writer<'a>(
    buf: &'a mut Vec<u8>,
    schema: &'a Arc<Schema>,
    bloom_filter_fields: &'a [String],
    full_text_search_fields: &'a [String],
    metadata: &'a FileMeta,
) -> AsyncArrowWriter<&'a mut Vec<u8>> {
    let sort_column_id = schema
        .index_of(&CONFIG.common.column_timestamp)
        .expect("Not found timestamp field");
    let row_group_size = if CONFIG.limit.parquet_max_row_group_size > 0 {
        CONFIG.limit.parquet_max_row_group_size
    } else {
        PARQUET_MAX_ROW_GROUP_SIZE
    };
    let mut writer_props = WriterProperties::builder()
        .set_write_batch_size(PARQUET_BATCH_SIZE) // in bytes
        .set_data_page_size_limit(PARQUET_PAGE_SIZE) // maximum size of a data page in bytes
        .set_max_row_group_size(row_group_size) // maximum number of rows in a row group
        .set_compression(Compression::ZSTD(Default::default()))
        .set_dictionary_enabled(true)
        .set_encoding(Encoding::PLAIN)
        .set_sorting_columns(Some(
            vec![SortingColumn::new(sort_column_id as i32, true, false)],
        ))
        .set_column_dictionary_enabled(
            CONFIG.common.column_timestamp.as_str().into(),
            false,
        )
        .set_column_encoding(
            CONFIG.common.column_timestamp.as_str().into(),
            Encoding::DELTA_BINARY_PACKED,
        )
        .set_key_value_metadata(Some(vec![
            KeyValue::new("min_ts".to_string(), metadata.min_ts.to_string()),
            KeyValue::new("max_ts".to_string(), metadata.max_ts.to_string()),
            KeyValue::new("records".to_string(), metadata.records.to_string()),
            KeyValue::new(
                "original_size".to_string(),
                metadata.original_size.to_string(),
            ),
        ]));
    for field in SQL_FULL_TEXT_SEARCH_FIELDS.iter() {
        writer_props = writer_props.set_column_dictionary_enabled(field.as_str().into(), false);
    }
    for field in full_text_search_fields.iter() {
        writer_props = writer_props.set_column_dictionary_enabled(field.as_str().into(), false);
    }
    // Bloom filter stored by row_group, so if the num_rows can limit to row_group_size
    let num_rows = min(metadata.records as u64, row_group_size as u64);
    if CONFIG.common.bloom_filter_enabled {
        // if bloom_filter_on_all_fields is true, then use all string fields
        let fields = if CONFIG.common.bloom_filter_on_all_fields {
            schema
                .fields()
                .iter()
                .filter(|f| {
                    f.data_type() == &arrow::datatypes::DataType::Utf8
                        && !SQL_FULL_TEXT_SEARCH_FIELDS.contains(f.name())
                        && !full_text_search_fields.contains(f.name())
                })
                .map(|f| f.name().to_string())
                .collect::<Vec<_>>()
        } else {
            let mut fields = bloom_filter_fields.to_vec();
            fields.extend(BLOOM_FILTER_DEFAULT_FIELDS.clone());
            fields.sort();
            fields.dedup();
            fields
        };
        for field in fields {
            if metadata.records > 0 {
                writer_props =
                    writer_props.set_column_bloom_filter_ndv(field.as_str().into(), num_rows);
            }
            writer_props = writer_props
                .set_column_dictionary_enabled(field.as_str().into(), false)
                .set_column_bloom_filter_enabled(field.into(), true); // take the field ownership
        }
    }
    let writer_props = writer_props.build();
    AsyncArrowWriter::try_new(buf, schema.clone(), Some(writer_props)).unwrap()
}

pub async fn write_recordbatch_to_parquet(
    schema: Arc<Schema>,
    record_batches: &[RecordBatch],
    bloom_filter_fields: &[String],
    full_text_search_fields: &[String],
    metadata: &FileMeta,
) -> Result<Vec<u8>, anyhow::Error> {
    let mut buf = Vec::new();
    let mut writer = new_parquet_writer(
        &mut buf,
        &schema,
        bloom_filter_fields,
        full_text_search_fields,
        metadata,
    );
    for batch in record_batches {
        writer.write(batch).await?;
    }
    writer.close().await?;
    Ok(buf)
}

// parse file key to get stream_key, date_key, file_name
pub fn parse_file_key_columns(key: &str) -> Result<(String, String, String), anyhow::Error> {
    // eg: files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet
    let columns = key.splitn(9, '/').collect::<Vec<&str>>();
    if columns.len() < 9 {
        return Err(anyhow::anyhow!("[file_list] Invalid file path: {}", key));
    }
    // let _ = columns[0].to_string(); // files/
    let stream_key = format!("{}/{}/{}", columns[1], columns[2], columns[3]);
    let date_key = format!(
        "{}/{}/{}/{}",
        columns[4], columns[5], columns[6], columns[7]
    );
    let file_name = columns[8].to_string();
    Ok((stream_key, date_key, file_name))
}

pub async fn read_recordbatch_from_bytes(
    data: &bytes::Bytes,
) -> Result<(Arc<Schema>, Vec<RecordBatch>), anyhow::Error> {
    let schema_reader = Cursor::new(data.clone());
    let arrow_reader = ParquetRecordBatchStreamBuilder::new(schema_reader).await?;
    let schema = arrow_reader.schema().clone();
    let record_reader = arrow_reader.build()?;
    let batches = record_reader.try_collect().await?;
    Ok((schema, batches))
}

pub async fn read_recordbatch_from_file(
    path: &PathBuf,
) -> Result<(Arc<Schema>, Vec<RecordBatch>), anyhow::Error> {
    let file = tokio::fs::File::open(path).await?;
    let arrow_reader = ParquetRecordBatchStreamBuilder::new(file).await?;
    let schema = arrow_reader.schema().clone();
    let record_reader = arrow_reader.build()?;
    let batches = record_reader.try_collect().await?;
    Ok((schema, batches))
}

pub async fn read_schema_from_file(path: &PathBuf) -> Result<Arc<Schema>, anyhow::Error> {
    let mut file = tokio::fs::File::open(path).await?;
    let arrow_reader = ArrowReaderMetadata::load_async(&mut file, Default::default()).await?;
    Ok(arrow_reader.schema().clone())
}

pub async fn read_schema_from_bytes(data: &bytes::Bytes) -> Result<Arc<Schema>, anyhow::Error> {
    let schema_reader = Cursor::new(data.clone());
    let arrow_reader = ParquetRecordBatchStreamBuilder::new(schema_reader).await?;
    Ok(arrow_reader.schema().clone())
}

pub async fn read_metadata_from_bytes(data: &bytes::Bytes) -> Result<FileMeta, anyhow::Error> {
    let mut meta = FileMeta::default();
    let schema_reader = Cursor::new(data.clone());
    let arrow_reader = ParquetRecordBatchStreamBuilder::new(schema_reader).await?;
    if let Some(metadata) = arrow_reader.metadata().file_metadata().key_value_metadata() {
        meta = metadata.as_slice().into();
    }
    Ok(meta)
}

pub async fn read_metadata_from_file(path: &PathBuf) -> Result<FileMeta, anyhow::Error> {
    let mut meta = FileMeta::default();
    let mut file = tokio::fs::File::open(path).await?;
    // read the file size
    let metadata = file.metadata().await?;
    let compressed_size = metadata.len();
    let arrow_reader = ArrowReaderMetadata::load_async(&mut file, Default::default()).await?;
    if let Some(metadata) = arrow_reader.metadata().file_metadata().key_value_metadata() {
        meta = metadata.as_slice().into();
    }
    meta.compressed_size = compressed_size as i64;
    Ok(meta)
}

pub fn generate_filename_with_time_range(min_ts: i64, max_ts: i64) -> String {
    format!(
        "{}.{}.{}{}",
        min_ts,
        max_ts,
        ider::generate(),
        FILE_EXT_PARQUET
    )
}

pub fn parse_time_range_from_filename(mut name: &str) -> (i64, i64) {
    if let Some(v) = name.rfind('/') {
        name = &name[v + 1..];
    }
    let columns = name.split('.').collect::<Vec<&str>>();
    if columns.len() < 4 {
        return (0, 0);
    }
    let min_ts = columns[0].parse::<i64>().unwrap_or(0);
    let max_ts = columns[1].parse::<i64>().unwrap_or(0);
    (min_ts, max_ts)
}
