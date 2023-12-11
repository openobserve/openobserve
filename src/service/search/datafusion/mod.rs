// Copyright 2023 Zinc Labs Inc.
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

use std::{str::FromStr, sync::Arc};

use datafusion::arrow::datatypes::Schema;
use parquet::{
    arrow::ArrowWriter,
    basic::{Compression, Encoding},
    file::{metadata::KeyValue, properties::WriterProperties},
    format::SortingColumn,
    schema::types::ColumnPath,
};

use crate::common::{
    infra::config::{
        BLOOM_FILTER_DEFAULT_FIELDS, CONFIG, PARQUET_BATCH_SIZE, PARQUET_MAX_ROW_GROUP_SIZE,
        PARQUET_PAGE_SIZE, SQL_FULL_TEXT_SEARCH_FIELDS,
    },
    meta::{common::FileMeta, functions::ZoFunction},
};

mod date_format_udf;
pub mod exec;
pub mod match_udf;
pub mod regexp_udf;
pub mod storage;
mod time_range_udf;
mod transform_udf;

#[derive(PartialEq, Debug)]
pub enum MemoryPoolType {
    Greedy,
    Fair,
    None,
}

impl FromStr for MemoryPoolType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "greedy" => Ok(MemoryPoolType::Greedy),
            "fair" | "" => Ok(MemoryPoolType::Fair), // default is fair
            "none" | "off" => Ok(MemoryPoolType::None),
            _ => Err(format!("Invalid memory pool type '{}'", s)),
        }
    }
}

/// The name of the match UDF given to DataFusion.
pub const MATCH_UDF_NAME: &str = "str_match";
/// The name of the match_ignore_case UDF given to DataFusion.
pub const MATCH_UDF_IGNORE_CASE_NAME: &str = "str_match_ignore_case";
/// The name of the regex_match UDF given to DataFusion.
pub const REGEX_MATCH_UDF_NAME: &str = "re_match";
/// The name of the not_regex_match UDF given to DataFusion.
pub const REGEX_NOT_MATCH_UDF_NAME: &str = "re_not_match";

pub const DEFAULT_FUNCTIONS: [ZoFunction; 6] = [
    ZoFunction {
        name: "match_all",
        text: "match_all('v')",
    },
    ZoFunction {
        name: "match_all_ignore_case",
        text: "match_all_ignore_case('v')",
    },
    ZoFunction {
        name: MATCH_UDF_NAME,
        text: "match_all('v')",
    },
    ZoFunction {
        name: MATCH_UDF_IGNORE_CASE_NAME,
        text: "match_all_ignore_case('v')",
    },
    ZoFunction {
        name: REGEX_MATCH_UDF_NAME,
        text: "re_match(field, 'pattern')",
    },
    ZoFunction {
        name: REGEX_NOT_MATCH_UDF_NAME,
        text: "re_not_match(field, 'pattern')",
    },
];

pub fn new_parquet_writer<'a>(
    buf: &'a mut Vec<u8>,
    schema: &'a Arc<Schema>,
    bloom_filter_fields: &'a [String],
    metadata: &'a FileMeta,
) -> ArrowWriter<&'a mut Vec<u8>> {
    let sort_column_id = schema
        .index_of(&CONFIG.common.column_timestamp)
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
            ColumnPath::from(vec![CONFIG.common.column_timestamp.to_string()]),
            false,
        )
        .set_column_encoding(
            ColumnPath::from(vec![CONFIG.common.column_timestamp.to_string()]),
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
    if CONFIG.common.bloom_filter_enabled {
        let fields = if bloom_filter_fields.is_empty() {
            BLOOM_FILTER_DEFAULT_FIELDS.as_slice()
        } else {
            bloom_filter_fields
        };
        for field in fields.iter() {
            writer_props = writer_props
                .set_column_bloom_filter_enabled(ColumnPath::from(vec![field.to_string()]), true);
            if metadata.records > 0 {
                writer_props = writer_props.set_column_bloom_filter_ndv(
                    ColumnPath::from(vec![field.to_string()]),
                    num_rows,
                );
            }
        }
    }
    let writer_props = writer_props.build();
    ArrowWriter::try_new(buf, schema.clone(), Some(writer_props)).unwrap()
}
