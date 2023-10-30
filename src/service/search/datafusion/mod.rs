// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use datafusion::arrow::datatypes::Schema;
use parquet::{
    arrow::ArrowWriter,
    basic::{Compression, Encoding},
    file::properties::WriterProperties,
    format::SortingColumn,
    schema::types::ColumnPath,
};
use std::{str::FromStr, sync::Arc};

use crate::common::{
    infra::config::{

        BLOOM_FILTER_DEFAULT_COLUMNS, CONFIG, PARQUET_BATCH_SIZE, PARQUET_MAX_ROW_GROUP_SIZE,
        PARQUET_PAGE_SIZE, SQL_FULL_TEXT_SEARCH_FIELDS,
    },
    meta::functions::ZoFunction,
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
    num_rows: u64,
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
        );
    for field in SQL_FULL_TEXT_SEARCH_FIELDS.iter() {
        writer_props = writer_props
            .set_column_dictionary_enabled(ColumnPath::from(vec![field.to_string()]), false);
    }
    // Bloom filter stored by row_group, so if the num_rows can limit to PARQUET_MAX_ROW_GROUP_SIZE,
    let num_rows = if num_rows > PARQUET_MAX_ROW_GROUP_SIZE as u64 {
        PARQUET_MAX_ROW_GROUP_SIZE as u64
    } else {
        num_rows
    };
    if let Some(fields) = BLOOM_FILTER_DEFAULT_COLUMNS.as_ref() {
        for field in fields {
            writer_props = writer_props
                .set_column_bloom_filter_enabled(ColumnPath::from(vec![field.to_string()]), true);
            if num_rows > 0 {
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
