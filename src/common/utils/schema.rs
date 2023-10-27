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

use std::borrow::Borrow;
use std::io::{BufRead, Seek};
use std::sync::Arc;

use datafusion::arrow::datatypes::{DataType, Field, Schema};
use datafusion::arrow::error::ArrowError;
use datafusion::arrow::json::reader;

use crate::common::meta::StreamType;
use crate::common::utils::json::Value;

pub fn infer_json_schema<R: BufRead>(
    reader: R,
    max_read_records: Option<usize>,
    stream_type: StreamType,
) -> Result<Schema, ArrowError> {
    let mut schema = reader::infer_json_schema(reader, max_read_records)?;
    if stream_type == StreamType::Traces {
        schema = fix_traces_schema(schema);
    }
    Ok(schema)
}

pub fn infer_json_schema_from_seekable<R: BufRead + Seek>(
    reader: R,
    max_read_records: Option<usize>,
    stream_type: StreamType,
) -> Result<Schema, ArrowError> {
    let mut schema = reader::infer_json_schema_from_seekable(reader, max_read_records)?;
    if stream_type == StreamType::Traces {
        schema = fix_traces_schema(schema);
    }
    Ok(schema)
}

pub fn infer_json_schema_from_iterator<I, V>(
    value_iter: I,
    stream_type: StreamType,
) -> Result<Schema, ArrowError>
where
    I: Iterator<Item = Result<V, ArrowError>>,
    V: Borrow<Value>,
{
    let mut schema = reader::infer_json_schema_from_iterator(value_iter)?;
    if stream_type == StreamType::Traces {
        schema = fix_traces_schema(schema);
    }
    Ok(schema)
}

fn fix_traces_schema(schema: Schema) -> Schema {
    let fields = itertools::chain(
        schema
            .fields()
            .into_iter()
            .filter(|f| f.name() != "start_time" && f.name() != "end_time")
            .map(|f| f.to_owned()),
        vec![
            Arc::new(Field::new("start_time", DataType::UInt64, false)),
            Arc::new(Field::new("end_time", DataType::UInt64, false)),
        ],
    );
    Schema::new(fields.collect::<Vec<_>>())
}
