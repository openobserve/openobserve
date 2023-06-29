// Copyright 2022 Zinc Labs Inc. and Contributors
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
use parquet::{arrow::ArrowWriter, file::properties::WriterProperties, format::SortingColumn};
use std::sync::Arc;

use crate::infra::config::{get_parquet_compression, CONFIG};
use crate::meta::functions::ZoFunction;

mod date_format_udf;
pub mod exec;
pub mod match_udf;
pub mod regexp_udf;
pub mod storage;
mod time_range_udf;

mod transform_udf;

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

pub fn new_writer<'a>(
    buf: &'a mut Vec<u8>,
    schema: &'a Arc<Schema>,
) -> ArrowWriter<&'a mut Vec<u8>> {
    let sort_column_id = schema.index_of(&CONFIG.common.column_timestamp).unwrap();
    let writer_props = WriterProperties::builder()
        .set_compression(get_parquet_compression())
        .set_write_batch_size(8192)
        .set_data_pagesize_limit(1024 * 512)
        .set_max_row_group_size(1024 * 1024 * 256)
        .set_sorting_columns(Some(
            [SortingColumn::new(sort_column_id as i32, true, false)].to_vec(),
        ))
        .build();
    ArrowWriter::try_new(buf, schema.clone(), Some(writer_props)).unwrap()
}
