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

use arrow_json::reader;
use arrow_schema::{ArrowError, DataType, Field, Schema};

use crate::meta::stream::StreamType;

pub fn infer_json_schema<R: BufRead>(
    reader: R,
    max_read_records: Option<usize>,
    stream_type: StreamType,
) -> Result<Schema, ArrowError> {
    let (schema, _) = reader::infer_json_schema(reader, max_read_records)?;
    Ok(fix_schema(schema, stream_type))
}

pub fn infer_json_schema_from_seekable<R: BufRead + Seek>(
    reader: R,
    max_read_records: Option<usize>,
    stream_type: StreamType,
) -> Result<Schema, ArrowError> {
    let (schema, _) = reader::infer_json_schema_from_seekable(reader, max_read_records)?;
    Ok(fix_schema(schema, stream_type))
}

pub fn infer_json_schema_from_iterator<I, V>(
    value_iter: I,
    stream_type: impl Into<StreamType>,
) -> Result<Schema, ArrowError>
where
    I: Iterator<Item = Result<V, ArrowError>>,
    V: Borrow<serde_json::Value>,
{
    let schema = reader::infer_json_schema_from_iterator(value_iter)?;
    Ok(fix_schema(schema, stream_type.into()))
}

/// Fix the schema to ensure that the start_time and end_time fields are always
/// present with uint64 and that null fields are removed and sort the fields by
/// name.
fn fix_schema(schema: Schema, stream_type: StreamType) -> Schema {
    let mut fields = if stream_type == StreamType::Traces {
        itertools::chain(
            schema.fields().into_iter().filter_map(|f| {
                if f.name() != "start_time"
                    && f.name() != "end_time"
                    && f.data_type() != &DataType::Null
                {
                    Some(f.to_owned())
                } else {
                    None
                }
            }),
            vec![
                Arc::new(Field::new("start_time", DataType::UInt64, false)),
                Arc::new(Field::new("end_time", DataType::UInt64, false)),
            ],
        )
        .collect::<Vec<_>>()
    } else {
        schema
            .fields()
            .into_iter()
            .filter_map(|f| {
                if f.data_type() == &DataType::Null {
                    None
                } else {
                    Some(f.to_owned())
                }
            })
            .collect::<Vec<_>>()
    };
    fields.sort_by(|a, b| a.name().cmp(b.name()));
    Schema::new(fields)
}
