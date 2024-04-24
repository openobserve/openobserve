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

use std::sync::Arc;

use arrow::{
    array::{
        make_builder, new_null_array, ArrayBuilder, ArrayRef, BooleanBuilder, Float64Builder,
        Int64Builder, NullBuilder, StringBuilder, UInt64Builder,
    },
    record_batch::RecordBatch,
};
use arrow_schema::{ArrowError, DataType, Schema};
use hashbrown::HashSet;

use super::schema_ext::SchemaExt;
use crate::FxIndexMap;

const USIZE_SIZE: usize = std::mem::size_of::<usize>();

/// RecordBatchExt helper...
pub trait RecordBatchExt {
    fn size(&self) -> usize;
}

impl RecordBatchExt for RecordBatch {
    fn size(&self) -> usize {
        self.schema().size() + self.get_array_memory_size() + USIZE_SIZE
    }
}

// convert json value to record batch
pub fn convert_json_to_record_batch(
    schema: &Arc<Schema>,
    data: &[Arc<serde_json::Value>],
) -> Result<RecordBatch, ArrowError> {
    // collect all keys from the json data
    let mut keys = HashSet::new();
    for record in data.iter() {
        for (k, _) in record.as_object().unwrap() {
            keys.insert(k);
        }
    }

    // create builders for each key
    let mut builders: FxIndexMap<&String, (&DataType, Box<dyn ArrayBuilder>)> = schema
        .fields()
        .iter()
        .filter(|f| keys.contains(f.name()))
        .map(|f| {
            (
                f.name(),
                (f.data_type(), make_builder(f.data_type(), data.len())),
            )
        })
        .collect();

    // fill builders with data
    for record in data.iter() {
        let mut record_keys = HashSet::new();
        for (k, v) in record.as_object().unwrap() {
            record_keys.insert(k);
            let res = builders.get_mut(k);
            // where the value is null, the key maybe not exists in the schema
            // so we skip it
            if res.is_none() && v.is_null() {
                continue;
            }
            let (data_type, builder) = res.ok_or_else(|| {
                ArrowError::SchemaError(format!(
                    "Cannot find key {} (value: {:?}) in schema {:?}",
                    k, v, schema
                ))
            })?;
            match data_type {
                DataType::Utf8 => {
                    let b = builder
                        .as_any_mut()
                        .downcast_mut::<StringBuilder>()
                        .unwrap();
                    if v.is_null() {
                        b.append_null();
                    } else {
                        b.append_value(v.as_str().unwrap());
                    }
                }
                DataType::Int64 => {
                    let b = builder.as_any_mut().downcast_mut::<Int64Builder>().unwrap();
                    if v.is_null() {
                        b.append_null();
                    } else {
                        b.append_value(v.as_i64().unwrap());
                    }
                }
                DataType::UInt64 => {
                    let b = builder
                        .as_any_mut()
                        .downcast_mut::<UInt64Builder>()
                        .unwrap();
                    if v.is_null() {
                        b.append_null();
                    } else {
                        b.append_value(v.as_u64().unwrap());
                    }
                }
                DataType::Float64 => {
                    let b = builder
                        .as_any_mut()
                        .downcast_mut::<Float64Builder>()
                        .unwrap();
                    if v.is_null() {
                        b.append_null();
                    } else {
                        b.append_value(v.as_f64().unwrap());
                    }
                }
                DataType::Boolean => {
                    let b = builder
                        .as_any_mut()
                        .downcast_mut::<BooleanBuilder>()
                        .unwrap();
                    if v.is_null() {
                        b.append_null();
                    } else {
                        b.append_value(v.as_bool().unwrap());
                    }
                }
                DataType::Null => {
                    let b = builder.as_any_mut().downcast_mut::<NullBuilder>().unwrap();
                    b.append_null();
                }
                _ => {
                    return Err(ArrowError::SchemaError(
                        "Cannot convert json to RecordBatch from non-basic type value".to_string(),
                    ));
                }
            }
        }

        // fill null for missing keys
        builders.iter_mut().for_each(|(k, (data_type, b))| {
            if !record_keys.contains(k) {
                match data_type {
                    DataType::Utf8 => {
                        b.as_any_mut()
                            .downcast_mut::<StringBuilder>()
                            .unwrap()
                            .append_null();
                    }
                    DataType::Int64 => {
                        b.as_any_mut()
                            .downcast_mut::<Int64Builder>()
                            .unwrap()
                            .append_null();
                    }
                    DataType::UInt64 => {
                        b.as_any_mut()
                            .downcast_mut::<UInt64Builder>()
                            .unwrap()
                            .append_null();
                    }
                    DataType::Float64 => {
                        b.as_any_mut()
                            .downcast_mut::<Float64Builder>()
                            .unwrap()
                            .append_null();
                    }
                    DataType::Boolean => {
                        b.as_any_mut()
                            .downcast_mut::<BooleanBuilder>()
                            .unwrap()
                            .append_null();
                    }
                    DataType::Null => {
                        b.as_any_mut()
                            .downcast_mut::<NullBuilder>()
                            .unwrap()
                            .append_null();
                    }
                    _ => {}
                }
            }
        });
    }

    let mut cols: Vec<ArrayRef> = Vec::with_capacity(schema.fields().len());
    for field in schema.fields() {
        if let Some((_, builder)) = builders.get_mut(field.name()) {
            cols.push(builder.finish());
        } else {
            cols.push(new_null_array(field.data_type(), data.len()))
        }
    }

    RecordBatch::try_new(schema.clone(), cols)
}
