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

use std::{
    borrow::Borrow,
    io::{BufRead, Seek},
    sync::Arc,
};

use config::meta::stream::StreamType;
use datafusion::arrow::{
    datatypes::{DataType, Field, Schema},
    error::ArrowError,
    json::reader,
};

use crate::common::utils::json::Value;

pub fn infer_json_schema<R: BufRead>(
    reader: R,
    max_read_records: Option<usize>,
    stream_type: StreamType,
) -> Result<Schema, ArrowError> {
    let (mut schema, _) = reader::infer_json_schema(reader, max_read_records)?;
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
    let (mut schema, _) = reader::infer_json_schema_from_seekable(reader, max_read_records)?;
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
