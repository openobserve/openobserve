use std::{sync::Arc, fs::File};

use arrow_schema::Schema;
use itertools::chain;
use once_cell::sync::Lazy;
use parquet::{
    arrow::ArrowWriter,
    basic::{Compression, Encoding},
    file::{metadata::KeyValue, properties::WriterProperties},
    format::SortingColumn,
    schema::types::ColumnPath,
};
use serde::{Deserialize, Serialize};

pub const SIZE_IN_MB: f64 = 1024.0 * 1024.0;
pub const PARQUET_BATCH_SIZE: usize = 8 * 1024;
pub const PARQUET_PAGE_SIZE: usize = 1024 * 1024;
pub const PARQUET_MAX_ROW_GROUP_SIZE: usize = 1024 * 1024;

const _DEFAULT_SQL_FULL_TEXT_SEARCH_FIELDS: [&str; 7] =
    ["log", "message", "msg", "content", "data", "events", "json"];
pub static SQL_FULL_TEXT_SEARCH_FIELDS: Lazy<Vec<String>> = Lazy::new(|| {
    chain(
        _DEFAULT_SQL_FULL_TEXT_SEARCH_FIELDS
            .iter()
            .map(|s| s.to_string()),
        "".split(',').filter_map(|s| {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        }),
    )
    .collect()
});

const _DEFAULT_DISTINCT_FIELDS: [&str; 2] = ["service_name", "operation_name"];
pub static DISTINCT_FIELDS: Lazy<Vec<String>> = Lazy::new(|| {
    chain(
        _DEFAULT_DISTINCT_FIELDS.iter().map(|s| s.to_string()),
        "".split(',').filter_map(|s| {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        }),
    )
    .collect()
});

const _DEFAULT_BLOOM_FILTER_FIELDS: [&str; 1] = ["trace_id"];
pub static BLOOM_FILTER_DEFAULT_FIELDS: Lazy<Vec<String>> = Lazy::new(|| {
    chain(
        _DEFAULT_BLOOM_FILTER_FIELDS.iter().map(|s| s.to_string()),
        "".split(',').filter_map(|s| {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        }),
    )
    .collect()
});

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct FileMeta {
    pub min_ts: i64, // microseconds
    pub max_ts: i64, // microseconds
    pub records: i64,
    pub original_size: i64,
    pub compressed_size: i64,
}

pub(crate) fn new_parquet_writer<'a>(
    f: &'a mut File,
    schema: &'a Arc<Schema>,
    bloom_filter_fields: &'a [String],
    metadata: &'a FileMeta,
) -> ArrowWriter<&'a mut File> {
    let sort_column_id = schema
        .index_of("_timestamp")
        .expect("Not found timestamp field");
    let mut writer_props = WriterProperties::builder()
        .set_write_batch_size(PARQUET_BATCH_SIZE) // in bytes
        .set_data_page_size_limit(PARQUET_PAGE_SIZE) // maximum size of a data page in bytes
        .set_max_row_group_size(PARQUET_MAX_ROW_GROUP_SIZE) // maximum number of rows in a row group
        .set_compression(Compression::ZSTD(Default::default()))
        .set_dictionary_enabled(true)
        .set_encoding(Encoding::PLAIN)
        .set_sorting_columns(Some(
            [SortingColumn::new(sort_column_id as i32, false, false)].to_vec(),
        ))
        .set_column_dictionary_enabled(
            ColumnPath::from(vec!["_timestamp".to_string()]),
            false,
        )
        .set_column_encoding(
            ColumnPath::from(vec!["_timestamp".to_string()]),
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
        writer_props = writer_props
            .set_column_dictionary_enabled(ColumnPath::from(vec![field.to_string()]), false);
    }
    // Bloom filter stored by row_group, so if the num_rows can limit to
    // PARQUET_MAX_ROW_GROUP_SIZE,
    let num_rows = metadata.records as u64;
    let num_rows = if num_rows > PARQUET_MAX_ROW_GROUP_SIZE as u64 {
        PARQUET_MAX_ROW_GROUP_SIZE as u64
    } else {
        num_rows
    };

    let fields = if bloom_filter_fields.is_empty() {
        BLOOM_FILTER_DEFAULT_FIELDS.as_slice()
    } else {
        bloom_filter_fields
    };
    for field in fields.iter() {
        writer_props = writer_props
            .set_column_bloom_filter_enabled(ColumnPath::from(vec![field.to_string()]), true);
        if metadata.records > 0 {
            writer_props = writer_props
                .set_column_bloom_filter_ndv(ColumnPath::from(vec![field.to_string()]), num_rows);
        }
    }
    let writer_props = writer_props.build();
    ArrowWriter::try_new(f, schema.clone(), Some(writer_props)).unwrap()
}
