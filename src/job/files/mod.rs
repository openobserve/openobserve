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

pub mod disk;
pub mod memory;

use crate::infra::config::get_parquet_compression;
use parquet::{arrow::ArrowWriter, file::properties::WriterProperties};
use std::sync::Arc;

fn get_writer<'a>(
    buf_parquet: &'a mut Vec<u8>,
    arrow_schema: &'a Arc<arrow_schema::Schema>,
) -> ArrowWriter<&'a mut Vec<u8>> {
    let props = WriterProperties::builder()
        .set_compression(get_parquet_compression())
        .set_write_batch_size(8192)
        .set_data_pagesize_limit(1024 * 512)
        .set_max_row_group_size(1024 * 1024 * 256);
    let writer_props = props.build();

    ArrowWriter::try_new(buf_parquet, arrow_schema.clone(), Some(writer_props)).unwrap()
}
