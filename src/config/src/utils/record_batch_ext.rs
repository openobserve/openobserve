// Copyright 2026 OpenObserve Inc.
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
        ArrayBuilder, ArrayRef, BinaryBuilder, BooleanArray, BooleanBuilder, Float64Array,
        Float64Builder, Int64Array, Int64Builder, LargeStringArray, LargeStringBuilder,
        NullBuilder, RecordBatchOptions, StringArray, StringBuilder, StringViewArray,
        StringViewBuilder, UInt64Array, UInt64Builder, new_null_array,
    },
    record_batch::RecordBatch,
};
use arrow_schema::{ArrowError, DataType, Schema};
use datafusion::{error::DataFusionError, physical_plan::spill::get_record_batch_memory_size};
use hashbrown::{HashMap, HashSet};

use super::schema_ext::SchemaExt;
use crate::{FxIndexMap, TIMESTAMP_COL_NAME};

const USIZE_SIZE: usize = std::mem::size_of::<usize>();

/// RecordBatchExt helper...
pub trait RecordBatchExt {
    fn size(&self) -> usize;
}

impl RecordBatchExt for RecordBatch {
    fn size(&self) -> usize {
        // per RecordBatch size = schema size + data size + usize size for num_rows
        self.schema().size() + get_record_batch_memory_size(self) + USIZE_SIZE
    }
}

// convert vrl values directly to record batch
pub fn convert_vrl_to_record_batch(
    schema: &Arc<Schema>,
    data: &[vrl::value::Value],
) -> Result<RecordBatch, ArrowError> {
    // collect all keys from the vrl data
    let mut keys = HashSet::with_capacity(schema.fields().len());
    let mut max_keys = 0;
    for record in data.iter() {
        if let vrl::value::Value::Object(obj) = record {
            if obj.len() > max_keys {
                max_keys = obj.len();
            }
            for k in obj.keys() {
                keys.insert(k.as_str());
            }
        }
    }

    // create builders for each key
    let records_len = data.len();
    let mut builders: FxIndexMap<&str, (&DataType, Box<dyn ArrayBuilder>)> = schema
        .fields()
        .iter()
        .filter(|f| keys.contains(f.name().as_str()))
        .map(|f| {
            (
                f.name().as_str(),
                (f.data_type(), make_builder(f.data_type(), records_len)),
            )
        })
        .collect();

    // fill builders with data
    let mut record_keys = HashSet::with_capacity(max_keys);
    for record in data.iter() {
        record_keys.clear();
        if let vrl::value::Value::Object(obj) = record {
            for (k, v) in obj {
                let key_str = k.as_str();
                record_keys.insert(key_str);
                let Some((data_type, builder)) = builders.get_mut(key_str) else {
                    continue;
                };
                match data_type {
                    DataType::Utf8 => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<StringBuilder>()
                            .unwrap();
                        match v {
                            vrl::value::Value::Null => b.append_null(),
                            vrl::value::Value::Bytes(bytes) => {
                                b.append_value(String::from_utf8_lossy(bytes));
                            }
                            vrl::value::Value::Integer(i) => b.append_value(i.to_string()),
                            vrl::value::Value::Float(f) => b.append_value(f.to_string()),
                            vrl::value::Value::Boolean(b_val) => b.append_value(b_val.to_string()),
                            vrl::value::Value::Timestamp(ts) => {
                                b.append_value(ts.timestamp_nanos_opt().unwrap_or(0).to_string())
                            }
                            _ => b.append_value(v.to_string()),
                        }
                    }
                    DataType::Utf8View => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<StringViewBuilder>()
                            .unwrap();
                        match v {
                            vrl::value::Value::Null => b.append_null(),
                            vrl::value::Value::Bytes(bytes) => {
                                b.append_value(String::from_utf8_lossy(bytes));
                            }
                            vrl::value::Value::Integer(i) => b.append_value(i.to_string()),
                            vrl::value::Value::Float(f) => b.append_value(f.to_string()),
                            vrl::value::Value::Boolean(b_val) => b.append_value(b_val.to_string()),
                            vrl::value::Value::Timestamp(ts) => {
                                b.append_value(ts.timestamp_nanos_opt().unwrap_or(0).to_string())
                            }
                            _ => b.append_value(v.to_string()),
                        }
                    }
                    DataType::LargeUtf8 => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<LargeStringBuilder>()
                            .unwrap();
                        match v {
                            vrl::value::Value::Null => b.append_null(),
                            vrl::value::Value::Bytes(bytes) => {
                                b.append_value(String::from_utf8_lossy(bytes));
                            }
                            vrl::value::Value::Integer(i) => b.append_value(i.to_string()),
                            vrl::value::Value::Float(f) => b.append_value(f.to_string()),
                            vrl::value::Value::Boolean(b_val) => b.append_value(b_val.to_string()),
                            vrl::value::Value::Timestamp(ts) => {
                                b.append_value(ts.timestamp_nanos_opt().unwrap_or(0).to_string())
                            }
                            _ => b.append_value(v.to_string()),
                        }
                    }
                    DataType::Int64 => {
                        let b = builder.as_any_mut().downcast_mut::<Int64Builder>().unwrap();
                        match v {
                            vrl::value::Value::Null => b.append_null(),
                            vrl::value::Value::Integer(i) => b.append_value(*i),
                            vrl::value::Value::Float(f) => b.append_value(f.into_inner() as i64),
                            vrl::value::Value::Boolean(b_val) => b.append_value(*b_val as i64),
                            vrl::value::Value::Bytes(bytes) => {
                                let s = String::from_utf8_lossy(bytes);
                                b.append_value(s.parse::<i64>().unwrap_or(0));
                            }
                            vrl::value::Value::Timestamp(ts) => {
                                b.append_value(ts.timestamp_nanos_opt().unwrap_or(0) / 1000);
                            }
                            _ => b.append_value(0),
                        }
                    }
                    DataType::UInt64 => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<UInt64Builder>()
                            .unwrap();
                        match v {
                            vrl::value::Value::Null => b.append_null(),
                            vrl::value::Value::Integer(i) => b.append_value(*i as u64),
                            vrl::value::Value::Float(f) => b.append_value(f.into_inner() as u64),
                            vrl::value::Value::Boolean(b_val) => b.append_value(*b_val as u64),
                            vrl::value::Value::Bytes(bytes) => {
                                let s = String::from_utf8_lossy(bytes);
                                b.append_value(s.parse::<u64>().unwrap_or(0));
                            }
                            vrl::value::Value::Timestamp(ts) => {
                                b.append_value(ts.timestamp_nanos_opt().unwrap_or(0) as u64 / 1000);
                            }
                            _ => b.append_value(0),
                        }
                    }
                    DataType::Float64 => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<Float64Builder>()
                            .unwrap();
                        match v {
                            vrl::value::Value::Null => b.append_null(),
                            vrl::value::Value::Integer(i) => b.append_value(*i as f64),
                            vrl::value::Value::Float(f) => b.append_value(f.into_inner()),
                            vrl::value::Value::Boolean(b_val) => {
                                b.append_value(*b_val as i64 as f64)
                            }
                            vrl::value::Value::Bytes(bytes) => {
                                let s = String::from_utf8_lossy(bytes);
                                b.append_value(s.parse::<f64>().unwrap_or(0.0));
                            }
                            vrl::value::Value::Timestamp(ts) => {
                                b.append_value(
                                    ts.timestamp_nanos_opt().unwrap_or(0) as f64 / 1000.0,
                                );
                            }
                            _ => b.append_value(0.0),
                        }
                    }
                    DataType::Boolean => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<BooleanBuilder>()
                            .unwrap();
                        match v {
                            vrl::value::Value::Null => b.append_null(),
                            vrl::value::Value::Boolean(b_val) => b.append_value(*b_val),
                            vrl::value::Value::Integer(i) => b.append_value(*i > 0),
                            vrl::value::Value::Float(f) => b.append_value(f.into_inner() > 0.0),
                            vrl::value::Value::Bytes(bytes) => {
                                let s = String::from_utf8_lossy(bytes);
                                b.append_value(s.parse::<bool>().unwrap_or(false));
                            }
                            _ => b.append_value(false),
                        }
                    }
                    DataType::Binary => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<BinaryBuilder>()
                            .unwrap();
                        match v {
                            vrl::value::Value::Null => b.append_null(),
                            vrl::value::Value::Bytes(bytes) => {
                                let hex_string = String::from_utf8_lossy(bytes);
                                let bin_data = hex::decode(hex_string.as_ref()).map_err(|_| {
                                    ArrowError::SchemaError(
                                        "Cannot convert VRL bytes to [DataType::Binary] from non-hex string value"
                                            .to_string(),
                                    )
                                })?;
                                b.append_value(bin_data);
                            }
                            _ => {
                                let hex_string = v.to_string();
                                let bin_data = hex::decode(hex_string).map_err(|_| {
                                    ArrowError::SchemaError(
                                        "Cannot convert VRL value to [DataType::Binary] from non-hex string value"
                                            .to_string(),
                                    )
                                })?;
                                b.append_value(bin_data);
                            }
                        }
                    }
                    DataType::Null => {
                        let b = builder.as_any_mut().downcast_mut::<NullBuilder>().unwrap();
                        b.append_null();
                    }
                    _ => {
                        return Err(ArrowError::SchemaError(
                            "Cannot convert VRL to RecordBatch from non-basic type value"
                                .to_string(),
                        ));
                    }
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
                    DataType::Utf8View => {
                        b.as_any_mut()
                            .downcast_mut::<StringViewBuilder>()
                            .unwrap()
                            .append_null();
                    }
                    DataType::LargeUtf8 => {
                        b.as_any_mut()
                            .downcast_mut::<LargeStringBuilder>()
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
                    DataType::Binary => {
                        b.as_any_mut()
                            .downcast_mut::<BinaryBuilder>()
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
        if let Some((_, builder)) = builders.get_mut(field.name().as_str()) {
            cols.push(builder.finish());
        } else {
            cols.push(new_null_array(field.data_type(), records_len))
        }
    }

    RecordBatch::try_new(schema.clone(), cols)
}

// TODO: remove it after upgrade arrow-rs to 56.0.0.
fn make_builder(data_type: &DataType, records_len: usize) -> Box<dyn ArrayBuilder> {
    match data_type {
        DataType::Utf8View => Box::new(StringViewBuilder::with_capacity(records_len)),
        _ => arrow::array::make_builder(data_type, records_len),
    }
}

pub fn format_recordbatch_by_schema(schema: Arc<Schema>, batch: RecordBatch) -> RecordBatch {
    if schema.fields().is_empty() || schema.fields() == batch.schema().fields() {
        return batch;
    }
    let records_len = batch.num_rows();
    if records_len == 0 {
        return RecordBatch::new_empty(schema);
    }

    let batch_schema = batch.schema();
    let batch_fields = batch_schema
        .fields()
        .iter()
        .map(|f| (f.name(), f.data_type()))
        .collect::<HashMap<_, _>>();

    let mut cols: Vec<ArrayRef> = Vec::with_capacity(schema.fields().len());
    for field in schema.fields() {
        match batch_fields.get(field.name()) {
            Some(data_type) if *data_type == field.data_type() => {
                cols.push(batch.column_by_name(field.name()).unwrap().clone());
            }
            Some(data_type) => {
                let col = batch.column_by_name(field.name()).unwrap();
                let mut builder = make_builder(field.data_type(), records_len);
                match field.data_type() {
                    DataType::Utf8 => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<StringBuilder>()
                            .unwrap();
                        match data_type {
                            DataType::Utf8 => {
                                let col = col.as_any().downcast_ref::<StringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::Utf8View => {
                                let col = col.as_any().downcast_ref::<StringViewArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::LargeUtf8 => {
                                let col = col.as_any().downcast_ref::<LargeStringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::Int64 => {
                                let col = col.as_any().downcast_ref::<Int64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::UInt64 => {
                                let col = col.as_any().downcast_ref::<UInt64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::Float64 => {
                                let col = col.as_any().downcast_ref::<Float64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::Boolean => {
                                let col = col.as_any().downcast_ref::<BooleanArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::Null => {
                                for _ in 0..records_len {
                                    b.append_null();
                                }
                            }
                            _ => {}
                        }
                    }
                    DataType::Utf8View => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<StringViewBuilder>()
                            .unwrap();
                        match data_type {
                            DataType::Utf8 => {
                                let col = col.as_any().downcast_ref::<StringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::Utf8View => {
                                let col = col.as_any().downcast_ref::<StringViewArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::LargeUtf8 => {
                                let col = col.as_any().downcast_ref::<LargeStringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::Int64 => {
                                let col = col.as_any().downcast_ref::<Int64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::UInt64 => {
                                let col = col.as_any().downcast_ref::<UInt64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::Float64 => {
                                let col = col.as_any().downcast_ref::<Float64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::Boolean => {
                                let col = col.as_any().downcast_ref::<BooleanArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::Null => {
                                for _ in 0..records_len {
                                    b.append_null();
                                }
                            }
                            _ => {}
                        }
                    }
                    DataType::LargeUtf8 => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<LargeStringBuilder>()
                            .unwrap();
                        match data_type {
                            DataType::Utf8 => {
                                let col = col.as_any().downcast_ref::<StringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::Utf8View => {
                                let col = col.as_any().downcast_ref::<StringViewArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::LargeUtf8 => {
                                let col = col.as_any().downcast_ref::<LargeStringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::Int64 => {
                                let col = col.as_any().downcast_ref::<Int64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::UInt64 => {
                                let col = col.as_any().downcast_ref::<UInt64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::Float64 => {
                                let col = col.as_any().downcast_ref::<Float64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::Boolean => {
                                let col = col.as_any().downcast_ref::<BooleanArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).to_string());
                                }
                            }
                            DataType::Null => {
                                for _ in 0..records_len {
                                    b.append_null();
                                }
                            }
                            _ => {}
                        }
                    }
                    DataType::Int64 => {
                        let b = builder.as_any_mut().downcast_mut::<Int64Builder>().unwrap();
                        match data_type {
                            DataType::Utf8 => {
                                let col = col.as_any().downcast_ref::<StringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::Utf8View => {
                                let col = col.as_any().downcast_ref::<StringViewArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::LargeUtf8 => {
                                let col = col.as_any().downcast_ref::<LargeStringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::Int64 => {
                                let col = col.as_any().downcast_ref::<Int64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::UInt64 => {
                                let col = col.as_any().downcast_ref::<UInt64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) as i64);
                                }
                            }
                            DataType::Float64 => {
                                let col = col.as_any().downcast_ref::<Float64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) as i64);
                                }
                            }
                            DataType::Boolean => {
                                let col = col.as_any().downcast_ref::<BooleanArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) as i64);
                                }
                            }
                            DataType::Null => {
                                for _ in 0..records_len {
                                    b.append_null();
                                }
                            }
                            _ => {}
                        }
                    }
                    DataType::UInt64 => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<UInt64Builder>()
                            .unwrap();
                        match data_type {
                            DataType::Utf8 => {
                                let col = col.as_any().downcast_ref::<StringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::Utf8View => {
                                let col = col.as_any().downcast_ref::<StringViewArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::LargeUtf8 => {
                                let col = col.as_any().downcast_ref::<LargeStringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::Int64 => {
                                let col = col.as_any().downcast_ref::<Int64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) as u64);
                                }
                            }
                            DataType::UInt64 => {
                                let col = col.as_any().downcast_ref::<UInt64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::Float64 => {
                                let col = col.as_any().downcast_ref::<Float64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) as u64);
                                }
                            }
                            DataType::Boolean => {
                                let col = col.as_any().downcast_ref::<BooleanArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) as u64);
                                }
                            }
                            DataType::Null => {
                                for _ in 0..records_len {
                                    b.append_null();
                                }
                            }
                            _ => {}
                        }
                    }
                    DataType::Float64 => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<Float64Builder>()
                            .unwrap();
                        match data_type {
                            DataType::Utf8 => {
                                let col = col.as_any().downcast_ref::<StringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::Utf8View => {
                                let col = col.as_any().downcast_ref::<StringViewArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::LargeUtf8 => {
                                let col = col.as_any().downcast_ref::<LargeStringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::Int64 => {
                                let col = col.as_any().downcast_ref::<Int64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) as f64);
                                }
                            }
                            DataType::UInt64 => {
                                let col = col.as_any().downcast_ref::<UInt64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) as f64);
                                }
                            }
                            DataType::Float64 => {
                                let col = col.as_any().downcast_ref::<Float64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::Boolean => {
                                let col = col.as_any().downcast_ref::<BooleanArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) as i64 as f64);
                                }
                            }
                            DataType::Null => {
                                for _ in 0..records_len {
                                    b.append_null();
                                }
                            }
                            _ => {}
                        }
                    }
                    DataType::Boolean => {
                        let b = builder
                            .as_any_mut()
                            .downcast_mut::<BooleanBuilder>()
                            .unwrap();
                        match data_type {
                            DataType::Utf8 => {
                                let col = col.as_any().downcast_ref::<StringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::Utf8View => {
                                let col = col.as_any().downcast_ref::<StringViewArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::LargeUtf8 => {
                                let col = col.as_any().downcast_ref::<LargeStringArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i).parse().unwrap_or_default());
                                }
                            }
                            DataType::Int64 => {
                                let col = col.as_any().downcast_ref::<Int64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) > 0);
                                }
                            }
                            DataType::UInt64 => {
                                let col = col.as_any().downcast_ref::<UInt64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) > 0);
                                }
                            }
                            DataType::Float64 => {
                                let col = col.as_any().downcast_ref::<Float64Array>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i) > 0.0);
                                }
                            }
                            DataType::Boolean => {
                                let col = col.as_any().downcast_ref::<BooleanArray>().unwrap();
                                for i in 0..records_len {
                                    b.append_value(col.value(i));
                                }
                            }
                            DataType::Null => {
                                for _ in 0..records_len {
                                    b.append_null();
                                }
                            }
                            _ => {}
                        }
                    }
                    DataType::Null => {
                        builder
                            .as_any_mut()
                            .downcast_mut::<NullBuilder>()
                            .unwrap()
                            .append_null();
                    }
                    _ => {}
                }
                cols.push(builder.finish());
            }
            _ => cols.push(new_null_array(field.data_type(), records_len)),
        }
    }
    RecordBatch::try_new(schema, cols).unwrap()
}

/// Concatenates `batches` together into a single [`RecordBatch`].
///
/// The output batch has the specified `schemas`; The schema of the
/// input are ignored.
///
/// Returns an error if the types of underlying arrays are different.
pub fn concat_batches(
    schema: Arc<Schema>,
    batches: Vec<RecordBatch>,
) -> Result<RecordBatch, ArrowError> {
    // When schema is empty, sum the number of the rows of all batches
    if schema.fields().is_empty() {
        let num_rows: usize = batches.iter().map(|b| b.num_rows()).sum();
        let mut options = RecordBatchOptions::default();
        options.row_count = Some(num_rows);
        return RecordBatch::try_new_with_options(schema.clone(), vec![], &options);
    }
    if batches.is_empty() {
        return Ok(RecordBatch::new_empty(schema.clone()));
    }

    let field_num = schema.fields().len();
    let mut arrays = Vec::with_capacity(field_num);
    for i in 0..field_num {
        let array = arrow::compute::concat(
            &batches
                .iter()
                .map(|batch| batch.column(i).as_ref())
                .collect::<Vec<_>>(),
        )?;
        arrays.push(array);
    }
    RecordBatch::try_new(schema, arrays)
}

// merge record batches, the record batch have same schema
pub fn merge_record_batches(
    job_name: &str,
    thread_id: usize,
    schema: Arc<Schema>,
    record_batches: Vec<RecordBatch>,
) -> Result<(Arc<Schema>, RecordBatch), DataFusionError> {
    // 1. format the record batch by schema (after format all record batch have the same schema)
    let record_batches = record_batches
        .into_iter()
        .map(|batch| format_recordbatch_by_schema(schema.clone(), batch))
        .collect::<Vec<_>>();

    // 2. concatenate all record batches into one single RecordBatch
    let mut concated_record_batch = concat_batches(schema.clone(), record_batches)?;

    // 3. delete all the null columns
    let num_rows = concated_record_batch.num_rows();
    let mut null_columns = Vec::new();
    for idx in 0..schema.fields().len() {
        if concated_record_batch.column(idx).null_count() == num_rows {
            null_columns.push(idx);
        }
    }
    if !null_columns.is_empty() {
        for (deleted_num, idx) in null_columns.into_iter().enumerate() {
            concated_record_batch.remove_column(idx - deleted_num);
        }
    }

    // 4. sort concatenated record batch by timestamp col in desc order
    let sorted_batch = sort_record_batch_by_column(
        concated_record_batch,
        TIMESTAMP_COL_NAME,
        true,
        None,
    ).inspect_err(|e| {
        log::error!(
            "[{job_name}:JOB:{thread_id}] merge small files failed to find _timestamp column from merged record batch, err: {e}",
        );
    })?;
    let schema = sorted_batch.schema();

    Ok((schema, sorted_batch))
}

pub fn sort_record_batch_by_column(
    batch: RecordBatch,
    column_name: &str,
    descending: bool,
    limit: Option<usize>,
) -> Result<RecordBatch, DataFusionError> {
    if batch.num_rows() == 0 {
        return Ok(batch);
    }

    // Create sort options
    let sort_options = arrow::compute::SortOptions {
        descending,
        nulls_first: false,
    };

    // Get sorted indices
    let indices = arrow::compute::sort_to_indices(
        batch.column_by_name(column_name).ok_or_else(|| {
            DataFusionError::Execution(format!(
                "No {column_name} column found in sort record batch",
            ))
        })?,
        Some(sort_options),
        limit,
    )?;

    // Apply indices to all columns
    let sorted_columns: Result<Vec<_>, _> = batch
        .columns()
        .iter()
        .map(|col| arrow::compute::take(col, &indices, None))
        .collect();

    // Create new RecordBatch with sorted data
    RecordBatch::try_new(batch.schema(), sorted_columns?).map_err(|e| e.into())
}

pub fn convert_json_to_record_batch(
    schema: &Arc<Schema>,
    data: &[Arc<serde_json::Value>],
) -> Result<RecordBatch, ArrowError> {
    if data.is_empty() {
        return Ok(RecordBatch::new_empty(schema.clone()));
    }

    let records_len = data.len();
    let num_fields = schema.fields().len();

    // Pre-allocate builders for all fields in schema
    let mut builders: Vec<Box<dyn ArrayBuilder>> = schema
        .fields()
        .iter()
        .map(|f| make_builder(f.data_type(), records_len))
        .collect();

    // Create field name to index mapping (amortize lookup cost)
    let field_indices: HashMap<&str, usize> = schema
        .fields()
        .iter()
        .enumerate()
        .map(|(idx, f)| (f.name().as_str(), idx))
        .collect();

    // Cache data types for faster access
    let data_types: Vec<&DataType> = schema.fields().iter().map(|f| f.data_type()).collect();

    // Single-pass traversal with bitmap for present fields
    for record in data.iter() {
        let obj = match record.as_object() {
            Some(obj) => obj,
            None => {
                return Err(ArrowError::SchemaError("Expected JSON object".to_string()));
            }
        };

        // Use bitmap to track present fields (more efficient than HashSet)
        let mut field_present = vec![false; num_fields];

        // Process all fields present in this record
        for (key, value) in obj.iter() {
            if let Some(&idx) = field_indices.get(key.as_str()) {
                field_present[idx] = true;
                append_value_optimized(&mut builders[idx], data_types[idx], value)?;
            }
        }

        // Append null for missing fields (using bitmap check)
        for (idx, &is_present) in field_present.iter().enumerate() {
            if !is_present {
                append_null_optimized(&mut builders[idx], data_types[idx]);
            }
        }
    }

    // Build final RecordBatch
    let cols: Vec<ArrayRef> = builders
        .into_iter()
        .map(|mut builder| builder.finish())
        .collect();

    RecordBatch::try_new(schema.clone(), cols)
}

/// Fast append value with zero-copy optimization and inline type conversion
#[inline(always)]
fn append_value_optimized(
    builder: &mut Box<dyn ArrayBuilder>,
    data_type: &DataType,
    value: &serde_json::Value,
) -> Result<(), ArrowError> {
    use serde_json::Value;

    if value.is_null() {
        append_null_optimized(builder, data_type);
        return Ok(());
    }

    match data_type {
        DataType::Utf8 => {
            let b = builder
                .as_any_mut()
                .downcast_mut::<StringBuilder>()
                .unwrap();
            // Zero-copy for strings, fast path for numbers
            match value {
                Value::String(s) => b.append_value(s.as_str()), // Zero-copy!
                Value::Number(n) => {
                    // Fast integer/float formatting using specialized libraries
                    if let Some(i) = n.as_i64() {
                        let mut buf = itoa::Buffer::new();
                        b.append_value(buf.format(i));
                    } else if let Some(u) = n.as_u64() {
                        let mut buf = itoa::Buffer::new();
                        b.append_value(buf.format(u));
                    } else if let Some(f) = n.as_f64() {
                        let mut buf = ryu::Buffer::new();
                        b.append_value(buf.format(f));
                    } else {
                        b.append_value("");
                    }
                }
                Value::Bool(bo) => b.append_value(if *bo { "true" } else { "false" }),
                _ => b.append_value(""),
            }
            Ok(())
        }
        DataType::Utf8View => {
            let b = builder
                .as_any_mut()
                .downcast_mut::<StringViewBuilder>()
                .unwrap();
            match value {
                Value::String(s) => b.append_value(s.as_str()),
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        let mut buf = itoa::Buffer::new();
                        b.append_value(buf.format(i));
                    } else if let Some(u) = n.as_u64() {
                        let mut buf = itoa::Buffer::new();
                        b.append_value(buf.format(u));
                    } else if let Some(f) = n.as_f64() {
                        let mut buf = ryu::Buffer::new();
                        b.append_value(buf.format(f));
                    } else {
                        b.append_value("");
                    }
                }
                Value::Bool(bo) => b.append_value(if *bo { "true" } else { "false" }),
                _ => b.append_value(""),
            }
            Ok(())
        }
        DataType::LargeUtf8 => {
            let b = builder
                .as_any_mut()
                .downcast_mut::<LargeStringBuilder>()
                .unwrap();
            match value {
                Value::String(s) => b.append_value(s.as_str()),
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        let mut buf = itoa::Buffer::new();
                        b.append_value(buf.format(i));
                    } else if let Some(u) = n.as_u64() {
                        let mut buf = itoa::Buffer::new();
                        b.append_value(buf.format(u));
                    } else if let Some(f) = n.as_f64() {
                        let mut buf = ryu::Buffer::new();
                        b.append_value(buf.format(f));
                    } else {
                        b.append_value("");
                    }
                }
                Value::Bool(bo) => b.append_value(if *bo { "true" } else { "false" }),
                _ => b.append_value(""),
            }
            Ok(())
        }
        DataType::Int64 => {
            let b = builder.as_any_mut().downcast_mut::<Int64Builder>().unwrap();
            // Inline fast path for common cases
            let val = match value {
                Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        i
                    } else if let Some(u) = n.as_u64() {
                        u as i64
                    } else {
                        n.as_f64().unwrap_or(0.0) as i64
                    }
                }
                Value::String(s) => s.parse::<i64>().unwrap_or(0),
                Value::Bool(bo) => {
                    if *bo {
                        1
                    } else {
                        0
                    }
                }
                _ => 0,
            };
            b.append_value(val);
            Ok(())
        }
        DataType::UInt64 => {
            let b = builder
                .as_any_mut()
                .downcast_mut::<UInt64Builder>()
                .unwrap();
            let val = match value {
                Value::Number(n) => {
                    if let Some(u) = n.as_u64() {
                        u
                    } else if let Some(i) = n.as_i64() {
                        i as u64
                    } else {
                        n.as_f64().unwrap_or(0.0) as u64
                    }
                }
                Value::String(s) => s.parse::<u64>().unwrap_or(0),
                Value::Bool(bo) => {
                    if *bo {
                        1
                    } else {
                        0
                    }
                }
                _ => 0,
            };
            b.append_value(val);
            Ok(())
        }
        DataType::Float64 => {
            let b = builder
                .as_any_mut()
                .downcast_mut::<Float64Builder>()
                .unwrap();
            let val = match value {
                Value::Number(n) => n.as_f64().unwrap_or(0.0),
                Value::String(s) => s.parse::<f64>().unwrap_or(0.0),
                Value::Bool(bo) => {
                    if *bo {
                        1.0
                    } else {
                        0.0
                    }
                }
                _ => 0.0,
            };
            b.append_value(val);
            Ok(())
        }
        DataType::Boolean => {
            let b = builder
                .as_any_mut()
                .downcast_mut::<BooleanBuilder>()
                .unwrap();
            let val = match value {
                Value::Bool(bo) => *bo,
                Value::Number(n) => n.as_f64().unwrap_or(0.0) > 0.0,
                Value::String(s) => s.parse::<bool>().unwrap_or(false),
                _ => false,
            };
            b.append_value(val);
            Ok(())
        }
        DataType::Binary => {
            let b = builder
                .as_any_mut()
                .downcast_mut::<BinaryBuilder>()
                .unwrap();
            if let Value::String(s) = value {
                let bin_data = hex::decode(s).map_err(|_| {
                    ArrowError::SchemaError(
                        "Cannot convert to [DataType::Binary] from non-hex string value"
                            .to_string(),
                    )
                })?;
                b.append_value(bin_data);
            } else {
                return Err(ArrowError::SchemaError(
                    "Cannot convert to [DataType::Binary] from non-string value".to_string(),
                ));
            }
            Ok(())
        }
        DataType::Null => {
            let b = builder.as_any_mut().downcast_mut::<NullBuilder>().unwrap();
            b.append_null();
            Ok(())
        }
        _ => Err(ArrowError::SchemaError(
            "Cannot convert json to RecordBatch from non-basic type value".to_string(),
        )),
    }
}

/// Fast null append
#[inline(always)]
fn append_null_optimized(builder: &mut Box<dyn ArrayBuilder>, data_type: &DataType) {
    match data_type {
        DataType::Utf8 => {
            builder
                .as_any_mut()
                .downcast_mut::<StringBuilder>()
                .unwrap()
                .append_null();
        }
        DataType::Utf8View => {
            builder
                .as_any_mut()
                .downcast_mut::<StringViewBuilder>()
                .unwrap()
                .append_null();
        }
        DataType::LargeUtf8 => {
            builder
                .as_any_mut()
                .downcast_mut::<LargeStringBuilder>()
                .unwrap()
                .append_null();
        }
        DataType::Int64 => {
            builder
                .as_any_mut()
                .downcast_mut::<Int64Builder>()
                .unwrap()
                .append_null();
        }
        DataType::UInt64 => {
            builder
                .as_any_mut()
                .downcast_mut::<UInt64Builder>()
                .unwrap()
                .append_null();
        }
        DataType::Float64 => {
            builder
                .as_any_mut()
                .downcast_mut::<Float64Builder>()
                .unwrap()
                .append_null();
        }
        DataType::Boolean => {
            builder
                .as_any_mut()
                .downcast_mut::<BooleanBuilder>()
                .unwrap()
                .append_null();
        }
        DataType::Binary => {
            builder
                .as_any_mut()
                .downcast_mut::<BinaryBuilder>()
                .unwrap()
                .append_null();
        }
        DataType::Null => {
            builder
                .as_any_mut()
                .downcast_mut::<NullBuilder>()
                .unwrap()
                .append_null();
        }
        _ => {}
    }
}

#[cfg(test)]
mod test {
    use arrow::{
        array::{Array, StringViewArray},
        util::pretty::pretty_format_batches,
    };
    use arrow_schema::Field;

    use super::*;

    #[tokio::test]
    async fn test_format_recordbatch_by_schema() {
        // Create a sample schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Float64, false),
            Field::new("city", DataType::Utf8, true),
        ]));

        // Create a sample record batch
        let name = StringArray::from(vec!["Alice", "Bob", "Charlie"]);
        let age = Float64Array::from(vec![25.0, 30.0, 35.0]);
        let city = StringArray::from(vec!["New York", "London", "Paris"]);
        let record_batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(name.clone()) as ArrayRef,
                Arc::new(age.clone()) as ArrayRef,
                Arc::new(city.clone()) as ArrayRef,
            ],
        )
        .unwrap();

        // Format the record batch by the schema
        let formatted_batch = format_recordbatch_by_schema(schema.clone(), record_batch);

        // Assert that the formatted batch has the same schema as the input schema
        assert_eq!(formatted_batch.schema(), schema);

        // Assert that the formatted batch has the same number of rows as the input batch
        assert_eq!(formatted_batch.num_rows(), 3);

        // Assert that the formatted batch has the same data as the input batch
        assert_eq!(
            pretty_format_batches(&[formatted_batch])
                .unwrap()
                .to_string(),
            "+---------+------+----------+
| name    | age  | city     |
+---------+------+----------+
| Alice   | 25.0 | New York |
| Bob     | 30.0 | London   |
| Charlie | 35.0 | Paris    |
+---------+------+----------+"
        );
    }

    #[tokio::test]
    async fn test_format_recordbatch_by_schema_with_mismatch_schema() {
        // Create a sample schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Float64, false),
            Field::new("city", DataType::Utf8, true),
        ]));

        // Create a sample schema
        let record_schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Utf8, false),
            Field::new("city", DataType::Utf8, true),
        ]));

        // Create a sample record batch
        let name = StringArray::from(vec!["Alice", "Bob", "Charlie"]);
        let age = StringArray::from(vec!["25", "30", "35"]);
        let city = StringArray::from(vec!["New York", "London", "Paris"]);
        let record_batch = RecordBatch::try_new(
            record_schema,
            vec![
                Arc::new(name.clone()) as ArrayRef,
                Arc::new(age.clone()) as ArrayRef,
                Arc::new(city.clone()) as ArrayRef,
            ],
        )
        .unwrap();

        // Format the record batch by the schema
        let formatted_batch = format_recordbatch_by_schema(schema.clone(), record_batch);

        // Assert that the formatted batch has the same schema as the input schema
        assert_eq!(formatted_batch.schema(), schema);

        // Assert that the formatted batch has the same number of rows as the input batch
        assert_eq!(formatted_batch.num_rows(), 3);

        // Assert that the formatted batch has the same data as the input batch
        assert_eq!(
            pretty_format_batches(&[formatted_batch])
                .unwrap()
                .to_string(),
            "+---------+------+----------+
| name    | age  | city     |
+---------+------+----------+
| Alice   | 25.0 | New York |
| Bob     | 30.0 | London   |
| Charlie | 35.0 | Paris    |
+---------+------+----------+"
        );
    }

    #[tokio::test]
    async fn test_format_recordbatch_by_schema_with_empty_schema() {
        // Create a sample schema
        let schema = Arc::new(Schema::empty());

        // Create a sample schema
        let record_schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Utf8, false),
            Field::new("city", DataType::Utf8, true),
        ]));

        // Create a sample record batch
        let name = StringArray::from(vec!["Alice", "Bob", "Charlie"]);
        let age = StringArray::from(vec!["25", "30", "35"]);
        let city = StringArray::from(vec!["New York", "London", "Paris"]);
        let record_batch = RecordBatch::try_new(
            record_schema.clone(),
            vec![
                Arc::new(name.clone()) as ArrayRef,
                Arc::new(age.clone()) as ArrayRef,
                Arc::new(city.clone()) as ArrayRef,
            ],
        )
        .unwrap();

        // Format the record batch by the schema
        let formatted_batch = format_recordbatch_by_schema(schema.clone(), record_batch);

        // Assert that the formatted batch has the same schema as the input schema
        assert_eq!(formatted_batch.schema(), record_schema);

        // Assert that the formatted batch has the same number of rows as the input batch
        assert_eq!(formatted_batch.num_rows(), 3);

        // Assert that the formatted batch has the same data as the input batch
        assert_eq!(
            pretty_format_batches(&[formatted_batch])
                .unwrap()
                .to_string(),
            "+---------+-----+----------+
| name    | age | city     |
+---------+-----+----------+
| Alice   | 25  | New York |
| Bob     | 30  | London   |
| Charlie | 35  | Paris    |
+---------+-----+----------+"
        );
    }

    #[tokio::test]
    async fn test_sort_record_batch_by_column_string_ascending() {
        // Create a sample schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
            Field::new("city", DataType::Utf8, true),
        ]));

        // Create a sample record batch with unsorted data
        let name = StringArray::from(vec!["Charlie", "Alice", "Bob"]);
        let age = Int64Array::from(vec![35, 25, 30]);
        let city = StringArray::from(vec!["Paris", "New York", "London"]);
        let record_batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(name) as ArrayRef,
                Arc::new(age) as ArrayRef,
                Arc::new(city) as ArrayRef,
            ],
        )
        .unwrap();

        // Sort by name column in ascending order
        let sorted_batch = sort_record_batch_by_column(record_batch, "name", false, None).unwrap();

        // Assert that the batch is sorted by name
        assert_eq!(
            pretty_format_batches(&[sorted_batch]).unwrap().to_string(),
            "+---------+-----+----------+
| name    | age | city     |
+---------+-----+----------+
| Alice   | 25  | New York |
| Bob     | 30  | London   |
| Charlie | 35  | Paris    |
+---------+-----+----------+"
        );
    }

    #[tokio::test]
    async fn test_sort_record_batch_by_column_string_descending() {
        // Create a sample schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
            Field::new("city", DataType::Utf8, true),
        ]));

        // Create a sample record batch with unsorted data
        let name = StringArray::from(vec!["Alice", "Charlie", "Bob"]);
        let age = Int64Array::from(vec![25, 35, 30]);
        let city = StringArray::from(vec!["New York", "Paris", "London"]);
        let record_batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(name) as ArrayRef,
                Arc::new(age) as ArrayRef,
                Arc::new(city) as ArrayRef,
            ],
        )
        .unwrap();

        // Sort by name column in descending order
        let sorted_batch = sort_record_batch_by_column(record_batch, "name", true, None).unwrap();

        // Assert that the batch is sorted by name in descending order
        assert_eq!(
            pretty_format_batches(&[sorted_batch]).unwrap().to_string(),
            "+---------+-----+----------+
| name    | age | city     |
+---------+-----+----------+
| Charlie | 35  | Paris    |
| Bob     | 30  | London   |
| Alice   | 25  | New York |
+---------+-----+----------+"
        );
    }

    #[tokio::test]
    async fn test_sort_record_batch_by_column_numeric_ascending() {
        // Create a sample schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
            Field::new("score", DataType::Float64, false),
        ]));

        // Create a sample record batch with unsorted data
        let name = StringArray::from(vec!["Alice", "Bob", "Charlie"]);
        let age = Int64Array::from(vec![30, 25, 35]);
        let score = Float64Array::from(vec![85.5, 92.3, 78.1]);
        let record_batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(name) as ArrayRef,
                Arc::new(age) as ArrayRef,
                Arc::new(score) as ArrayRef,
            ],
        )
        .unwrap();

        // Sort by age column in ascending order
        let sorted_batch = sort_record_batch_by_column(record_batch, "age", false, None).unwrap();

        // Assert that the batch is sorted by age
        assert_eq!(
            pretty_format_batches(&[sorted_batch]).unwrap().to_string(),
            "+---------+-----+-------+
| name    | age | score |
+---------+-----+-------+
| Bob     | 25  | 92.3  |
| Alice   | 30  | 85.5  |
| Charlie | 35  | 78.1  |
+---------+-----+-------+"
        );
    }

    #[tokio::test]
    async fn test_sort_record_batch_by_column_numeric_descending() {
        // Create a sample schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
            Field::new("score", DataType::Float64, false),
        ]));

        // Create a sample record batch with unsorted data
        let name = StringArray::from(vec!["Alice", "Bob", "Charlie"]);
        let age = Int64Array::from(vec![30, 25, 35]);
        let score = Float64Array::from(vec![85.5, 92.3, 78.1]);
        let record_batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(name) as ArrayRef,
                Arc::new(age) as ArrayRef,
                Arc::new(score) as ArrayRef,
            ],
        )
        .unwrap();

        // Sort by score column in descending order
        let sorted_batch = sort_record_batch_by_column(record_batch, "score", true, None).unwrap();

        // Assert that the batch is sorted by score in descending order
        assert_eq!(
            pretty_format_batches(&[sorted_batch]).unwrap().to_string(),
            "+---------+-----+-------+
| name    | age | score |
+---------+-----+-------+
| Bob     | 25  | 92.3  |
| Alice   | 30  | 85.5  |
| Charlie | 35  | 78.1  |
+---------+-----+-------+"
        );
    }

    #[tokio::test]
    async fn test_sort_record_batch_by_column_nonexistent_column() {
        // Create a sample schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
        ]));

        // Create a sample record batch
        let name = StringArray::from(vec!["Alice", "Bob", "Charlie"]);
        let age = Int64Array::from(vec![25, 30, 35]);
        let record_batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(name) as ArrayRef, Arc::new(age) as ArrayRef],
        )
        .unwrap();

        // Try to sort by a non-existent column
        let result = sort_record_batch_by_column(record_batch, "nonexistent", false, None);

        // Assert that it returns an error
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("No nonexistent column found in sort record batch")
        );
    }

    #[tokio::test]
    async fn test_sort_record_batch_by_column_empty_batch() {
        // Create a sample schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
        ]));

        // Create an empty record batch
        let name = StringArray::from(vec![] as Vec<&str>);
        let age = Int64Array::from(vec![] as Vec<i64>);
        let record_batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(name) as ArrayRef, Arc::new(age) as ArrayRef],
        )
        .unwrap();

        // Sort by name column
        let sorted_batch = sort_record_batch_by_column(record_batch, "name", false, None).unwrap();

        // Assert that the batch is still empty
        assert_eq!(sorted_batch.num_rows(), 0);
        assert_eq!(sorted_batch.schema(), schema);
    }

    #[tokio::test]
    async fn test_sort_record_batch_by_column_with_nulls() {
        // Create a sample schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, true),
            Field::new("age", DataType::Int64, false),
        ]));

        // Create a sample record batch with null values
        let name = StringArray::from(vec![Some("Charlie"), None, Some("Alice"), Some("Bob")]);
        let age = Int64Array::from(vec![35, 40, 25, 30]);
        let record_batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(name) as ArrayRef, Arc::new(age) as ArrayRef],
        )
        .unwrap();

        // Sort by name column in ascending order (nulls should be last due to nulls_first: false)
        let sorted_batch = sort_record_batch_by_column(record_batch, "name", false, None).unwrap();

        // Assert that the batch is sorted correctly with nulls at the end
        assert_eq!(
            pretty_format_batches(&[sorted_batch]).unwrap().to_string(),
            "+---------+-----+
| name    | age |
+---------+-----+
| Alice   | 25  |
| Bob     | 30  |
| Charlie | 35  |
|         | 40  |
+---------+-----+"
        );
    }

    #[tokio::test]
    async fn test_sort_record_batch_by_column_with_limit() {
        // Create a sample schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
        ]));

        // Create a sample record batch with unsorted data
        let name = StringArray::from(vec!["Eve", "Alice", "Bob", "Charlie", "Diana"]);
        let age = Int64Array::from(vec![22, 25, 30, 35, 28]);
        let record_batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(name) as ArrayRef, Arc::new(age) as ArrayRef],
        )
        .unwrap();

        // Sort by name column in ascending order with limit of 3
        let sorted_batch =
            sort_record_batch_by_column(record_batch, "name", false, Some(3)).unwrap();

        // Assert that the batch is sorted by name and limited to 3 rows
        assert_eq!(sorted_batch.num_rows(), 3);
        assert_eq!(
            pretty_format_batches(&[sorted_batch]).unwrap().to_string(),
            "+---------+-----+
| name    | age |
+---------+-----+
| Alice   | 25  |
| Bob     | 30  |
| Charlie | 35  |
+---------+-----+"
        );
    }

    #[tokio::test]
    async fn test_sort_record_batch_by_column_with_limit_larger_than_data() {
        // Create a sample schema
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
        ]));

        // Create a sample record batch with unsorted data
        let name = StringArray::from(vec!["Bob", "Alice"]);
        let age = Int64Array::from(vec![30, 25]);
        let record_batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(name) as ArrayRef, Arc::new(age) as ArrayRef],
        )
        .unwrap();

        // Sort by name column in ascending order with limit larger than data size
        let sorted_batch =
            sort_record_batch_by_column(record_batch, "name", false, Some(10)).unwrap();

        // Assert that the batch is sorted by name and contains all rows (not limited)
        assert_eq!(sorted_batch.num_rows(), 2);
        assert_eq!(
            pretty_format_batches(&[sorted_batch]).unwrap().to_string(),
            "+-------+-----+
| name  | age |
+-------+-----+
| Alice | 25  |
| Bob   | 30  |
+-------+-----+"
        );
    }

    // Test case for convert_vrl_to_record_batch
    #[tokio::test]
    async fn test_convert_vrl_to_record_batch() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
            Field::new("score", DataType::Float64, true),
            Field::new("active", DataType::Boolean, false),
        ]));

        let data = vec![
            vrl::value::Value::Object(
                [
                    ("name".into(), vrl::value::Value::from("Alice")),
                    ("age".into(), vrl::value::Value::Integer(25)),
                    (
                        "score".into(),
                        vrl::value::Value::Float(vrl::prelude::NotNan::new(85.5).unwrap()),
                    ),
                    ("active".into(), vrl::value::Value::Boolean(true)),
                ]
                .into_iter()
                .collect(),
            ),
            vrl::value::Value::Object(
                [
                    ("name".into(), vrl::value::Value::from("Bob")),
                    ("age".into(), vrl::value::Value::Integer(30)),
                    ("score".into(), vrl::value::Value::Null), // missing score
                    ("active".into(), vrl::value::Value::Boolean(false)),
                ]
                .into_iter()
                .collect(),
            ),
            vrl::value::Value::Object(
                [
                    ("name".into(), vrl::value::Value::from("Charlie")),
                    ("age".into(), vrl::value::Value::Integer(35)),
                    (
                        "score".into(),
                        vrl::value::Value::Float(vrl::prelude::NotNan::new(92.1).unwrap()),
                    ),
                    ("active".into(), vrl::value::Value::Boolean(true)),
                    // extra field that's not in schema should be ignored
                    ("extra".into(), vrl::value::Value::from("ignored")),
                ]
                .into_iter()
                .collect(),
            ),
        ];

        let record_batch = convert_vrl_to_record_batch(&schema, &data).unwrap();

        assert_eq!(record_batch.num_rows(), 3);
        assert_eq!(record_batch.schema(), schema);

        // Test string column
        let name_array = record_batch
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(name_array.value(0), "Alice");
        assert_eq!(name_array.value(1), "Bob");
        assert_eq!(name_array.value(2), "Charlie");

        // Test int64 column
        let age_array = record_batch
            .column(1)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(age_array.value(0), 25);
        assert_eq!(age_array.value(1), 30);
        assert_eq!(age_array.value(2), 35);

        // Test float64 column with null values
        let score_array = record_batch
            .column(2)
            .as_any()
            .downcast_ref::<Float64Array>()
            .unwrap();
        assert_eq!(score_array.value(0), 85.5);
        assert!(score_array.is_null(1)); // Bob's score should be null
        assert_eq!(score_array.value(2), 92.1);

        // Test boolean column
        let active_array = record_batch
            .column(3)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        assert_eq!(active_array.value(0), true);
        assert_eq!(active_array.value(1), false);
        assert_eq!(active_array.value(2), true);
    }

    // ── concat_batches ──────────────────────────────────────────────────────

    #[test]
    fn test_concat_batches_empty_batches_list() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("a", DataType::Int64, false),
            Field::new("b", DataType::Utf8, true),
        ]));
        let result = concat_batches(schema.clone(), vec![]).unwrap();
        assert_eq!(result.num_rows(), 0);
        assert_eq!(result.schema(), schema);
    }

    #[test]
    fn test_concat_batches_empty_schema_sums_rows() {
        let schema = Arc::new(Schema::empty());
        let b1 = RecordBatch::try_new_with_options(schema.clone(), vec![], &{
            let mut opts = RecordBatchOptions::default();
            opts.row_count = Some(3);
            opts
        })
        .unwrap();
        let b2 = RecordBatch::try_new_with_options(schema.clone(), vec![], &{
            let mut opts = RecordBatchOptions::default();
            opts.row_count = Some(2);
            opts
        })
        .unwrap();
        let result = concat_batches(schema.clone(), vec![b1, b2]).unwrap();
        assert_eq!(result.num_rows(), 5);
    }

    #[test]
    fn test_concat_batches_multiple_batches() {
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::Int64, false)]));
        let make = |vals: Vec<i64>| {
            RecordBatch::try_new(
                schema.clone(),
                vec![Arc::new(Int64Array::from(vals)) as ArrayRef],
            )
            .unwrap()
        };
        let result =
            concat_batches(schema.clone(), vec![make(vec![1, 2]), make(vec![3, 4, 5])]).unwrap();
        assert_eq!(result.num_rows(), 5);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(col.value(0), 1);
        assert_eq!(col.value(4), 5);
    }

    // ── RecordBatchExt::size ────────────────────────────────────────────────

    #[test]
    fn test_record_batch_size_is_nonzero() {
        let schema = Arc::new(Schema::new(vec![Field::new("x", DataType::Int64, false)]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int64Array::from(vec![1_i64, 2, 3])) as ArrayRef],
        )
        .unwrap();
        assert!(batch.size() > 0);
    }

    // ── sort_record_batch_by_column additional branches ────────────────────

    #[test]
    fn test_sort_record_batch_by_column_uint64() {
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::UInt64, false)]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(UInt64Array::from(vec![30_u64, 10, 20])) as ArrayRef],
        )
        .unwrap();
        let sorted = sort_record_batch_by_column(batch, "v", false, None).unwrap();
        let col = sorted
            .column(0)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .unwrap();
        assert_eq!(col.value(0), 10);
        assert_eq!(col.value(1), 20);
        assert_eq!(col.value(2), 30);
    }

    // ── format_recordbatch_by_schema additional type-conversion paths ──────

    #[test]
    fn test_format_recordbatch_empty_rows_returns_empty_with_target_schema() {
        let target_schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Utf8, true)]));
        let batch = RecordBatch::try_new(
            src_schema.clone(),
            vec![Arc::new(StringArray::from(vec![] as Vec<&str>)) as ArrayRef],
        )
        .unwrap();
        let result = format_recordbatch_by_schema(target_schema.clone(), batch);
        assert_eq!(result.num_rows(), 0);
        assert_eq!(result.schema(), target_schema);
    }

    #[test]
    fn test_format_recordbatch_missing_column_becomes_null() {
        // Target schema has an extra column not present in source → null array
        let target_schema = Arc::new(Schema::new(vec![
            Field::new("a", DataType::Utf8, true),
            Field::new("missing", DataType::Int64, true),
        ]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Utf8, true)]));
        let batch = RecordBatch::try_new(
            src_schema.clone(),
            vec![Arc::new(StringArray::from(vec!["x"])) as ArrayRef],
        )
        .unwrap();
        let result = format_recordbatch_by_schema(target_schema.clone(), batch);
        assert_eq!(result.num_rows(), 1);
        // "missing" column should be all-null
        let missing_col = result.column_by_name("missing").unwrap();
        assert_eq!(missing_col.null_count(), 1);
    }

    #[test]
    fn test_format_recordbatch_utf8view_to_utf8() {
        use arrow::array::StringViewArray;
        let target = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8View, true)]));
        let arr: ArrayRef = Arc::new(StringViewArray::from(vec!["hello", "world"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(col.value(0), "hello");
        assert_eq!(col.value(1), "world");
    }

    #[test]
    fn test_format_recordbatch_large_utf8_to_utf8() {
        use arrow::array::LargeStringArray;
        let target = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new(
            "s",
            DataType::LargeUtf8,
            true,
        )]));
        let arr: ArrayRef = Arc::new(LargeStringArray::from(vec!["alpha", "beta"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(col.value(0), "alpha");
    }

    #[test]
    fn test_format_recordbatch_int64_to_utf8() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::Utf8, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, true)]));
        let arr: ArrayRef = Arc::new(Int64Array::from(vec![42_i64, -7]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(col.value(0), "42");
        assert_eq!(col.value(1), "-7");
    }

    #[test]
    fn test_format_recordbatch_uint64_to_utf8() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::Utf8, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::UInt64, true)]));
        let arr: ArrayRef = Arc::new(UInt64Array::from(vec![100_u64, 200]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(col.value(0), "100");
    }

    #[test]
    fn test_format_recordbatch_float64_to_utf8() {
        let target = Arc::new(Schema::new(vec![Field::new("f", DataType::Utf8, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("f", DataType::Float64, true)]));
        let arr: ArrayRef = Arc::new(Float64Array::from(vec![3.14_f64]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(col.value(0), "3.14");
    }

    #[test]
    fn test_format_recordbatch_bool_to_utf8() {
        let target = Arc::new(Schema::new(vec![Field::new("b", DataType::Utf8, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("b", DataType::Boolean, true)]));
        let arr: ArrayRef = Arc::new(BooleanArray::from(vec![true, false]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(col.value(0), "true");
        assert_eq!(col.value(1), "false");
    }

    #[test]
    fn test_format_recordbatch_utf8_to_int64() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Utf8, true)]));
        let arr: ArrayRef = Arc::new(StringArray::from(vec!["123", "456"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(col.value(0), 123);
        assert_eq!(col.value(1), 456);
    }

    #[test]
    fn test_format_recordbatch_float64_to_int64() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Float64, true)]));
        let arr: ArrayRef = Arc::new(Float64Array::from(vec![9.9_f64, 2.1]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(col.value(0), 9);
        assert_eq!(col.value(1), 2);
    }

    #[test]
    fn test_format_recordbatch_bool_to_int64() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Boolean, true)]));
        let arr: ArrayRef = Arc::new(BooleanArray::from(vec![true, false]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(col.value(0), 1);
        assert_eq!(col.value(1), 0);
    }

    #[test]
    fn test_format_recordbatch_int64_to_uint64() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::UInt64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, true)]));
        let arr: ArrayRef = Arc::new(Int64Array::from(vec![5_i64, 10]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .unwrap();
        assert_eq!(col.value(0), 5_u64);
        assert_eq!(col.value(1), 10_u64);
    }

    #[test]
    fn test_format_recordbatch_utf8_to_float64() {
        let target = Arc::new(Schema::new(vec![Field::new("f", DataType::Float64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("f", DataType::Utf8, true)]));
        let arr: ArrayRef = Arc::new(StringArray::from(vec!["1.5", "2.5"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<Float64Array>()
            .unwrap();
        assert!((col.value(0) - 1.5).abs() < f64::EPSILON);
        assert!((col.value(1) - 2.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_format_recordbatch_bool_to_float64() {
        let target = Arc::new(Schema::new(vec![Field::new("f", DataType::Float64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("f", DataType::Boolean, true)]));
        let arr: ArrayRef = Arc::new(BooleanArray::from(vec![true, false]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<Float64Array>()
            .unwrap();
        assert!((col.value(0) - 1.0).abs() < f64::EPSILON);
        assert!((col.value(1) - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_format_recordbatch_utf8_to_boolean() {
        let target = Arc::new(Schema::new(vec![Field::new("b", DataType::Boolean, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("b", DataType::Utf8, true)]));
        let arr: ArrayRef = Arc::new(StringArray::from(vec!["true", "false"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        assert!(col.value(0));
        assert!(!col.value(1));
    }

    #[test]
    fn test_format_recordbatch_int64_to_boolean() {
        let target = Arc::new(Schema::new(vec![Field::new("b", DataType::Boolean, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("b", DataType::Int64, true)]));
        let arr: ArrayRef = Arc::new(Int64Array::from(vec![1_i64, 0, -5]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        assert!(col.value(0)); // 1 > 0
        assert!(!col.value(1)); // 0 == 0
        assert!(!col.value(2)); // -5 not > 0
    }

    #[test]
    fn test_format_recordbatch_float64_to_boolean() {
        let target = Arc::new(Schema::new(vec![Field::new("b", DataType::Boolean, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("b", DataType::Float64, true)]));
        let arr: ArrayRef = Arc::new(Float64Array::from(vec![1.0_f64, 0.0]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        assert!(col.value(0));
        assert!(!col.value(1));
    }

    // ── convert_json_to_record_batch comprehensive branches ────────────────

    // Test case for convert_json_to_record_batch that contains utf8view
    #[tokio::test]
    async fn test_convert_json_to_record_batch_with_utf8view() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8View, false),
            Field::new("age", DataType::Int64, false),
            Field::new("city", DataType::Utf8, true),
        ]));

        let data = vec![
            Arc::new(serde_json::json!({
                "name": "Alice",
                "age": 25,
                "city": "New York"
            })),
            Arc::new(serde_json::json!({
                "name": "Bob",
                "age": 30,
                "city": "London"
            })),
            Arc::new(serde_json::json!({
                "name": "Charlie",
                "age": 35
                // city is missing, should be null
            })),
        ];

        let record_batch = convert_json_to_record_batch(&schema, &data).unwrap();

        assert_eq!(record_batch.num_rows(), 3);
        assert_eq!(record_batch.schema(), schema);

        // Test Utf8View column
        let name_array = record_batch
            .column(0)
            .as_any()
            .downcast_ref::<StringViewArray>()
            .unwrap();
        assert_eq!(name_array.value(0), "Alice");
        assert_eq!(name_array.value(1), "Bob");
        assert_eq!(name_array.value(2), "Charlie");

        // Test Int64 column
        let age_array = record_batch
            .column(1)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(age_array.value(0), 25);
        assert_eq!(age_array.value(1), 30);
        assert_eq!(age_array.value(2), 35);

        // Test Utf8 column with null values
        let city_array = record_batch
            .column(2)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(city_array.value(0), "New York");
        assert_eq!(city_array.value(1), "London");
        assert!(city_array.is_null(2)); // Charlie's city should be null
    }

    // ── convert_json_to_record_batch additional branches ──────────────────

    #[test]
    fn test_convert_json_to_record_batch_empty_data() {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Utf8, true)]));
        let result = convert_json_to_record_batch(&schema, &[]).unwrap();
        assert_eq!(result.num_rows(), 0);
        assert_eq!(result.schema(), schema);
    }

    #[test]
    fn test_convert_json_to_record_batch_non_object_error() {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Utf8, true)]));
        let data = vec![Arc::new(serde_json::json!([1, 2, 3]))];
        let result = convert_json_to_record_batch(&schema, &data);
        assert!(result.is_err());
    }

    #[test]
    fn test_convert_json_to_record_batch_large_utf8() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "msg",
            DataType::LargeUtf8,
            true,
        )]));
        let data = vec![
            Arc::new(serde_json::json!({"msg": "hello"})),
            Arc::new(serde_json::json!({"msg": 42})),
            Arc::new(serde_json::json!({"msg": true})),
            Arc::new(serde_json::json!({"msg": null})),
            Arc::new(serde_json::json!({"msg": [1, 2]})), // array → ""
        ];
        let batch = convert_json_to_record_batch(&schema, &data).unwrap();
        use arrow::array::LargeStringArray;
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<LargeStringArray>()
            .unwrap();
        assert_eq!(col.value(0), "hello");
        assert_eq!(col.value(1), "42");
        assert_eq!(col.value(2), "true");
        assert!(col.is_null(3));
        assert_eq!(col.value(4), "");
    }

    #[test]
    fn test_convert_json_to_record_batch_uint64() {
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::UInt64, true)]));
        let data = vec![
            Arc::new(serde_json::json!({"v": 100})),
            Arc::new(serde_json::json!({"v": "200"})),
            Arc::new(serde_json::json!({"v": true})),
            Arc::new(serde_json::json!({"v": false})),
            Arc::new(serde_json::json!({"v": null})),
            Arc::new(serde_json::json!({"v": []})), // other → 0
        ];
        let batch = convert_json_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .unwrap();
        assert_eq!(col.value(0), 100);
        assert_eq!(col.value(1), 200);
        assert_eq!(col.value(2), 1);
        assert_eq!(col.value(3), 0);
        assert!(col.is_null(4));
        assert_eq!(col.value(5), 0);
    }

    #[test]
    fn test_convert_json_to_record_batch_float64() {
        let schema = Arc::new(Schema::new(vec![Field::new("f", DataType::Float64, true)]));
        let data = vec![
            Arc::new(serde_json::json!({"f": 3.14})),
            Arc::new(serde_json::json!({"f": "2.71"})),
            Arc::new(serde_json::json!({"f": true})),
            Arc::new(serde_json::json!({"f": false})),
            Arc::new(serde_json::json!({"f": null})),
            Arc::new(serde_json::json!({"f": {}})), // other → 0.0
        ];
        let batch = convert_json_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<Float64Array>()
            .unwrap();
        assert!((col.value(0) - 3.14).abs() < 1e-10);
        assert!((col.value(1) - 2.71).abs() < 1e-10);
        assert!((col.value(2) - 1.0).abs() < f64::EPSILON);
        assert!((col.value(3) - 0.0).abs() < f64::EPSILON);
        assert!(col.is_null(4));
        assert!((col.value(5) - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_convert_json_to_record_batch_boolean() {
        let schema = Arc::new(Schema::new(vec![Field::new("b", DataType::Boolean, true)]));
        let data = vec![
            Arc::new(serde_json::json!({"b": true})),
            Arc::new(serde_json::json!({"b": false})),
            Arc::new(serde_json::json!({"b": 1})), // number > 0 → true
            Arc::new(serde_json::json!({"b": 0})), // number == 0 → false
            Arc::new(serde_json::json!({"b": "true"})),
            Arc::new(serde_json::json!({"b": "false"})),
            Arc::new(serde_json::json!({"b": null})),
            Arc::new(serde_json::json!({"b": []})), // other → false
        ];
        let batch = convert_json_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        assert!(col.value(0));
        assert!(!col.value(1));
        assert!(col.value(2));
        assert!(!col.value(3));
        assert!(col.value(4));
        assert!(!col.value(5));
        assert!(col.is_null(6));
        assert!(!col.value(7));
    }

    #[test]
    fn test_convert_json_to_record_batch_binary_ok() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "data",
            DataType::Binary,
            true,
        )]));
        // "deadbeef" is a valid hex string
        let data = vec![Arc::new(serde_json::json!({"data": "deadbeef"}))];
        let batch = convert_json_to_record_batch(&schema, &data).unwrap();
        use arrow::array::BinaryArray;
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<BinaryArray>()
            .unwrap();
        assert_eq!(col.value(0), &[0xde, 0xad, 0xbe, 0xef]);
    }

    #[test]
    fn test_convert_json_to_record_batch_binary_non_hex_error() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "data",
            DataType::Binary,
            true,
        )]));
        // "xyz" is not valid hex
        let data = vec![Arc::new(serde_json::json!({"data": "xyz"}))];
        let result = convert_json_to_record_batch(&schema, &data);
        assert!(result.is_err());
    }

    #[test]
    fn test_convert_json_to_record_batch_binary_non_string_error() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "data",
            DataType::Binary,
            true,
        )]));
        // number value for a Binary field → error
        let data = vec![Arc::new(serde_json::json!({"data": 123}))];
        let result = convert_json_to_record_batch(&schema, &data);
        assert!(result.is_err());
    }

    #[test]
    fn test_convert_json_to_record_batch_null_type() {
        let schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Null, true)]));
        let data = vec![
            Arc::new(serde_json::json!({"n": null})),
            Arc::new(serde_json::json!({"n": "ignored"})),
        ];
        let batch = convert_json_to_record_batch(&schema, &data).unwrap();
        assert_eq!(batch.num_rows(), 2);
        // NullArray always has len == num_rows and data type Null
        assert_eq!(batch.column(0).len(), 2);
        assert_eq!(batch.column(0).data_type(), &DataType::Null);
    }

    #[test]
    fn test_convert_json_to_record_batch_utf8_number_u64_path() {
        // Use a large u64 that doesn't fit in i64 to exercise the u64 path in Utf8 formatting
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::Utf8, true)]));
        // serde_json represents 18446744073709551615 as u64
        let data = vec![Arc::new(serde_json::json!({"v": 18446744073709551615_u64}))];
        let batch = convert_json_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(col.value(0), "18446744073709551615");
    }

    #[test]
    fn test_convert_json_to_record_batch_missing_fields_become_null() {
        // Schema has multiple fields; records only have some fields → null for missing ones
        let schema = Arc::new(Schema::new(vec![
            Field::new("a", DataType::Utf8, true),
            Field::new("b", DataType::Int64, true),
            Field::new("c", DataType::Float64, true),
            Field::new("d", DataType::Boolean, true),
            Field::new("e", DataType::UInt64, true),
        ]));
        let data = vec![Arc::new(serde_json::json!({"a": "hello"}))];
        let batch = convert_json_to_record_batch(&schema, &data).unwrap();
        assert_eq!(batch.num_rows(), 1);
        // all columns except "a" should be null
        assert!(
            !batch
                .column(0)
                .as_any()
                .downcast_ref::<StringArray>()
                .unwrap()
                .is_null(0)
        );
        assert!(
            batch
                .column(1)
                .as_any()
                .downcast_ref::<Int64Array>()
                .unwrap()
                .is_null(0)
        );
        assert!(
            batch
                .column(2)
                .as_any()
                .downcast_ref::<Float64Array>()
                .unwrap()
                .is_null(0)
        );
        assert!(
            batch
                .column(3)
                .as_any()
                .downcast_ref::<BooleanArray>()
                .unwrap()
                .is_null(0)
        );
        assert!(
            batch
                .column(4)
                .as_any()
                .downcast_ref::<UInt64Array>()
                .unwrap()
                .is_null(0)
        );
    }

    #[test]
    fn test_convert_json_to_record_batch_int64_number_float_path() {
        // Float value that has no i64/u64 representation exercises the f64 fallback
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::Int64, true)]));
        let data = vec![Arc::new(serde_json::json!({"v": 3.9}))];
        let batch = convert_json_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(col.value(0), 3);
    }

    #[test]
    fn test_convert_json_to_record_batch_uint64_negative_i64_path() {
        // Negative i64 exercises the as_i64() path for UInt64
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::UInt64, true)]));
        let data = vec![Arc::new(serde_json::json!({"v": -1_i64}))];
        let batch = convert_json_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .unwrap();
        // -1i64 as u64 = u64::MAX
        assert_eq!(col.value(0), u64::MAX);
    }

    // ── convert_vrl_to_record_batch additional branches ───────────────────

    #[test]
    fn test_convert_vrl_to_record_batch_utf8view() {
        let schema = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8View, true)]));
        let data = vec![
            vrl::value::Value::Object(
                [("s".into(), vrl::value::Value::from("hello"))]
                    .into_iter()
                    .collect(),
            ),
            vrl::value::Value::Object(
                [("s".into(), vrl::value::Value::Integer(99))]
                    .into_iter()
                    .collect(),
            ),
            vrl::value::Value::Object(
                [("s".into(), vrl::value::Value::Boolean(true))]
                    .into_iter()
                    .collect(),
            ),
            vrl::value::Value::Object(
                [(
                    "s".into(),
                    vrl::value::Value::Float(vrl::prelude::NotNan::new(1.5).unwrap()),
                )]
                .into_iter()
                .collect(),
            ),
            vrl::value::Value::Object(
                [("s".into(), vrl::value::Value::Null)]
                    .into_iter()
                    .collect(),
            ),
        ];
        let batch = convert_vrl_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<StringViewArray>()
            .unwrap();
        assert_eq!(col.value(0), "hello");
        assert_eq!(col.value(1), "99");
        assert_eq!(col.value(2), "true");
        assert_eq!(col.value(3), "1.5");
        assert!(col.is_null(4));
    }

    #[test]
    fn test_convert_vrl_to_record_batch_large_utf8() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "s",
            DataType::LargeUtf8,
            true,
        )]));
        use arrow::array::LargeStringArray;
        let data = vec![
            vrl::value::Value::Object(
                [("s".into(), vrl::value::Value::from("world"))]
                    .into_iter()
                    .collect(),
            ),
            vrl::value::Value::Object(
                [("s".into(), vrl::value::Value::Integer(7))]
                    .into_iter()
                    .collect(),
            ),
            vrl::value::Value::Object(
                [("s".into(), vrl::value::Value::Boolean(false))]
                    .into_iter()
                    .collect(),
            ),
            vrl::value::Value::Object(
                [("s".into(), vrl::value::Value::Null)]
                    .into_iter()
                    .collect(),
            ),
        ];
        let batch = convert_vrl_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<LargeStringArray>()
            .unwrap();
        assert_eq!(col.value(0), "world");
        assert_eq!(col.value(1), "7");
        assert_eq!(col.value(2), "false");
        assert!(col.is_null(3));
    }

    #[test]
    fn test_convert_vrl_to_record_batch_uint64() {
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::UInt64, true)]));
        let data = vec![
            vrl::value::Value::Object(
                [("v".into(), vrl::value::Value::Integer(42))]
                    .into_iter()
                    .collect(),
            ),
            vrl::value::Value::Object(
                [(
                    "v".into(),
                    vrl::value::Value::Float(vrl::prelude::NotNan::new(9.0).unwrap()),
                )]
                .into_iter()
                .collect(),
            ),
            vrl::value::Value::Object(
                [("v".into(), vrl::value::Value::Boolean(true))]
                    .into_iter()
                    .collect(),
            ),
            vrl::value::Value::Object(
                [("v".into(), vrl::value::Value::Null)]
                    .into_iter()
                    .collect(),
            ),
        ];
        let batch = convert_vrl_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .unwrap();
        assert_eq!(col.value(0), 42);
        assert_eq!(col.value(1), 9);
        assert_eq!(col.value(2), 1);
        assert!(col.is_null(3));
    }

    #[test]
    fn test_convert_vrl_to_record_batch_int64_from_bytes() {
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::Int64, true)]));
        let data = vec![
            vrl::value::Value::Object(
                [("v".into(), vrl::value::Value::Bytes(b"123".to_vec().into()))]
                    .into_iter()
                    .collect(),
            ),
            // invalid → 0
            vrl::value::Value::Object(
                [(
                    "v".into(),
                    vrl::value::Value::Bytes(b"notanumber".to_vec().into()),
                )]
                .into_iter()
                .collect(),
            ),
            // fallback other (array/object) → 0
            vrl::value::Value::Object(
                [("v".into(), vrl::value::Value::Array(vec![]))]
                    .into_iter()
                    .collect(),
            ),
        ];
        let batch = convert_vrl_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(col.value(0), 123);
        assert_eq!(col.value(1), 0);
        assert_eq!(col.value(2), 0);
    }

    #[test]
    fn test_convert_vrl_to_record_batch_float64_from_bytes() {
        let schema = Arc::new(Schema::new(vec![Field::new("v", DataType::Float64, true)]));
        let data = vec![
            vrl::value::Value::Object(
                [(
                    "v".into(),
                    vrl::value::Value::Bytes(b"3.14".to_vec().into()),
                )]
                .into_iter()
                .collect(),
            ),
            vrl::value::Value::Object(
                [("v".into(), vrl::value::Value::Boolean(false))]
                    .into_iter()
                    .collect(),
            ),
            vrl::value::Value::Object(
                [("v".into(), vrl::value::Value::Array(vec![]))]
                    .into_iter()
                    .collect(),
            ),
        ];
        let batch = convert_vrl_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<Float64Array>()
            .unwrap();
        assert!((col.value(0) - 3.14).abs() < 1e-10);
        assert!((col.value(1) - 0.0).abs() < f64::EPSILON);
        assert!((col.value(2) - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_convert_vrl_to_record_batch_boolean_from_bytes_and_float() {
        let schema = Arc::new(Schema::new(vec![Field::new("b", DataType::Boolean, true)]));
        let data = vec![
            vrl::value::Value::Object(
                [("b".into(), vrl::value::Value::Integer(1))]
                    .into_iter()
                    .collect(),
            ),
            vrl::value::Value::Object(
                [("b".into(), vrl::value::Value::Integer(0))]
                    .into_iter()
                    .collect(),
            ),
            vrl::value::Value::Object(
                [(
                    "b".into(),
                    vrl::value::Value::Float(vrl::prelude::NotNan::new(2.5).unwrap()),
                )]
                .into_iter()
                .collect(),
            ),
            vrl::value::Value::Object(
                [(
                    "b".into(),
                    vrl::value::Value::Bytes(b"true".to_vec().into()),
                )]
                .into_iter()
                .collect(),
            ),
            vrl::value::Value::Object(
                [("b".into(), vrl::value::Value::Array(vec![]))]
                    .into_iter()
                    .collect(),
            ),
        ];
        let batch = convert_vrl_to_record_batch(&schema, &data).unwrap();
        let col = batch
            .column(0)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        assert!(col.value(0)); // 1 > 0
        assert!(!col.value(1)); // 0 not > 0
        assert!(col.value(2)); // 2.5 > 0
        assert!(col.value(3)); // "true" parses as true
        assert!(!col.value(4)); // other → false
    }

    #[test]
    fn test_convert_vrl_to_record_batch_null_type() {
        let schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Null, true)]));
        let data = vec![vrl::value::Value::Object(
            [("n".into(), vrl::value::Value::Integer(5))]
                .into_iter()
                .collect(),
        )];
        let batch = convert_vrl_to_record_batch(&schema, &data).unwrap();
        assert_eq!(batch.num_rows(), 1);
        // NullArray: len matches num_rows and data type is Null
        assert_eq!(batch.column(0).len(), 1);
        assert_eq!(batch.column(0).data_type(), &DataType::Null);
    }

    #[test]
    fn test_convert_vrl_to_record_batch_missing_keys_null_fill() {
        // Schema has Utf8View, LargeUtf8, UInt64, Binary, Null fields.
        // Record only provides "a" → all others get null-filled via fill-null path.
        let schema = Arc::new(Schema::new(vec![
            Field::new("a", DataType::Utf8, true),
            Field::new("b", DataType::Utf8View, true),
            Field::new("c", DataType::LargeUtf8, true),
            Field::new("d", DataType::UInt64, true),
            Field::new("e", DataType::Boolean, true),
            Field::new("f", DataType::Binary, true),
            Field::new("g", DataType::Null, true),
        ]));
        let data = vec![vrl::value::Value::Object(
            [("a".into(), vrl::value::Value::from("x"))]
                .into_iter()
                .collect(),
        )];
        let batch = convert_vrl_to_record_batch(&schema, &data).unwrap();
        assert_eq!(batch.num_rows(), 1);
        // "a" is present
        let a = batch
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(a.value(0), "x");
        // all others null
        assert!(
            batch
                .column(1)
                .as_any()
                .downcast_ref::<StringViewArray>()
                .unwrap()
                .is_null(0)
        );
        use arrow::array::LargeStringArray;
        assert!(
            batch
                .column(2)
                .as_any()
                .downcast_ref::<LargeStringArray>()
                .unwrap()
                .is_null(0)
        );
        assert!(
            batch
                .column(3)
                .as_any()
                .downcast_ref::<UInt64Array>()
                .unwrap()
                .is_null(0)
        );
        assert!(
            batch
                .column(4)
                .as_any()
                .downcast_ref::<BooleanArray>()
                .unwrap()
                .is_null(0)
        );
        use arrow::array::BinaryArray;
        assert!(
            batch
                .column(5)
                .as_any()
                .downcast_ref::<BinaryArray>()
                .unwrap()
                .is_null(0)
        );
        // NullArray column: len matches and data type is Null
        assert_eq!(batch.column(6).data_type(), &DataType::Null);
        assert_eq!(batch.column(6).len(), 1);
    }

    #[test]
    fn test_convert_vrl_to_record_batch_unsupported_type_error() {
        // DataType::Date32 is not handled → should return Err
        let schema = Arc::new(Schema::new(vec![Field::new("d", DataType::Date32, true)]));
        let data = vec![vrl::value::Value::Object(
            [("d".into(), vrl::value::Value::Integer(1))]
                .into_iter()
                .collect(),
        )];
        let result = convert_vrl_to_record_batch(&schema, &data);
        assert!(result.is_err());
    }

    // ── format_recordbatch_by_schema additional paths ────────────────────

    #[test]
    fn test_format_recordbatch_utf8_to_utf8view() {
        let target = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8View, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8, true)]));
        let arr: ArrayRef = Arc::new(StringArray::from(vec!["abc", "def"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<StringViewArray>()
            .unwrap();
        assert_eq!(col.value(0), "abc");
        assert_eq!(col.value(1), "def");
    }

    #[test]
    fn test_format_recordbatch_large_utf8_to_utf8view() {
        use arrow::array::LargeStringArray;
        let target = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8View, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new(
            "s",
            DataType::LargeUtf8,
            true,
        )]));
        let arr: ArrayRef = Arc::new(LargeStringArray::from(vec!["foo", "bar"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<StringViewArray>()
            .unwrap();
        assert_eq!(col.value(0), "foo");
    }

    #[test]
    fn test_format_recordbatch_int64_to_utf8view() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::Utf8View, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, true)]));
        let arr: ArrayRef = Arc::new(Int64Array::from(vec![100_i64]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<StringViewArray>()
            .unwrap();
        assert_eq!(col.value(0), "100");
    }

    #[test]
    fn test_format_recordbatch_bool_to_utf8view() {
        let target = Arc::new(Schema::new(vec![Field::new("b", DataType::Utf8View, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("b", DataType::Boolean, true)]));
        let arr: ArrayRef = Arc::new(BooleanArray::from(vec![true, false]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<StringViewArray>()
            .unwrap();
        assert_eq!(col.value(0), "true");
        assert_eq!(col.value(1), "false");
    }

    #[test]
    fn test_format_recordbatch_utf8_to_large_utf8() {
        use arrow::array::LargeStringArray;
        let target = Arc::new(Schema::new(vec![Field::new(
            "s",
            DataType::LargeUtf8,
            true,
        )]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8, true)]));
        let arr: ArrayRef = Arc::new(StringArray::from(vec!["test"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<LargeStringArray>()
            .unwrap();
        assert_eq!(col.value(0), "test");
    }

    #[test]
    fn test_format_recordbatch_utf8view_to_large_utf8() {
        use arrow::array::LargeStringArray;
        let target = Arc::new(Schema::new(vec![Field::new(
            "s",
            DataType::LargeUtf8,
            true,
        )]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8View, true)]));
        let arr: ArrayRef = Arc::new(StringViewArray::from(vec!["view_val"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<LargeStringArray>()
            .unwrap();
        assert_eq!(col.value(0), "view_val");
    }

    #[test]
    fn test_format_recordbatch_int64_to_large_utf8() {
        use arrow::array::LargeStringArray;
        let target = Arc::new(Schema::new(vec![Field::new(
            "n",
            DataType::LargeUtf8,
            true,
        )]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, true)]));
        let arr: ArrayRef = Arc::new(Int64Array::from(vec![-55_i64]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<LargeStringArray>()
            .unwrap();
        assert_eq!(col.value(0), "-55");
    }

    #[test]
    fn test_format_recordbatch_utf8view_to_int64() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Utf8View, true)]));
        let arr: ArrayRef = Arc::new(StringViewArray::from(vec!["789"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(col.value(0), 789);
    }

    #[test]
    fn test_format_recordbatch_large_utf8_to_int64() {
        use arrow::array::LargeStringArray;
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new(
            "n",
            DataType::LargeUtf8,
            true,
        )]));
        let arr: ArrayRef = Arc::new(LargeStringArray::from(vec!["321"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(col.value(0), 321);
    }

    #[test]
    fn test_format_recordbatch_uint64_to_int64() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::UInt64, true)]));
        let arr: ArrayRef = Arc::new(UInt64Array::from(vec![999_u64]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(col.value(0), 999);
    }

    #[test]
    fn test_format_recordbatch_utf8view_to_uint64() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::UInt64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Utf8View, true)]));
        let arr: ArrayRef = Arc::new(StringViewArray::from(vec!["42"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .unwrap();
        assert_eq!(col.value(0), 42);
    }

    #[test]
    fn test_format_recordbatch_float64_to_uint64() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::UInt64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Float64, true)]));
        let arr: ArrayRef = Arc::new(Float64Array::from(vec![7.8_f64]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .unwrap();
        assert_eq!(col.value(0), 7);
    }

    #[test]
    fn test_format_recordbatch_bool_to_uint64() {
        let target = Arc::new(Schema::new(vec![Field::new("n", DataType::UInt64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Boolean, true)]));
        let arr: ArrayRef = Arc::new(BooleanArray::from(vec![true, false]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .unwrap();
        assert_eq!(col.value(0), 1);
        assert_eq!(col.value(1), 0);
    }

    #[test]
    fn test_format_recordbatch_int64_to_float64() {
        let target = Arc::new(Schema::new(vec![Field::new("f", DataType::Float64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("f", DataType::Int64, true)]));
        let arr: ArrayRef = Arc::new(Int64Array::from(vec![5_i64, -3]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<Float64Array>()
            .unwrap();
        assert!((col.value(0) - 5.0).abs() < f64::EPSILON);
        assert!((col.value(1) - (-3.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn test_format_recordbatch_uint64_to_float64() {
        let target = Arc::new(Schema::new(vec![Field::new("f", DataType::Float64, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("f", DataType::UInt64, true)]));
        let arr: ArrayRef = Arc::new(UInt64Array::from(vec![8_u64]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<Float64Array>()
            .unwrap();
        assert!((col.value(0) - 8.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_format_recordbatch_utf8view_to_boolean() {
        let target = Arc::new(Schema::new(vec![Field::new("b", DataType::Boolean, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("b", DataType::Utf8View, true)]));
        let arr: ArrayRef = Arc::new(StringViewArray::from(vec!["true", "false"]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        assert!(col.value(0));
        assert!(!col.value(1));
    }

    #[test]
    fn test_format_recordbatch_uint64_to_boolean() {
        let target = Arc::new(Schema::new(vec![Field::new("b", DataType::Boolean, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("b", DataType::UInt64, true)]));
        let arr: ArrayRef = Arc::new(UInt64Array::from(vec![5_u64, 0]));
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<BooleanArray>()
            .unwrap();
        assert!(col.value(0));
        assert!(!col.value(1));
    }

    #[test]
    fn test_format_recordbatch_null_source_to_utf8() {
        // Source column is Null type → Null arm fills builder with nulls
        let target = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8, true)]));
        let src_schema = Arc::new(Schema::new(vec![Field::new("s", DataType::Null, true)]));
        let arr: ArrayRef = arrow::array::new_null_array(&DataType::Null, 2);
        let batch = RecordBatch::try_new(src_schema, vec![arr]).unwrap();
        let result = format_recordbatch_by_schema(target, batch);
        let col = result
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        assert_eq!(col.null_count(), 2);
    }

    // ── merge_record_batches basic coverage ──────────────────────────────

    #[test]
    fn test_merge_record_batches_basic() {
        use crate::TIMESTAMP_COL_NAME;
        let schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("val", DataType::Utf8, true),
        ]));
        let make_batch = |ts: Vec<i64>, vals: Vec<&str>| {
            RecordBatch::try_new(
                schema.clone(),
                vec![
                    Arc::new(Int64Array::from(ts)) as ArrayRef,
                    Arc::new(StringArray::from(vals)) as ArrayRef,
                ],
            )
            .unwrap()
        };
        let b1 = make_batch(vec![200, 100], vec!["b", "a"]);
        let b2 = make_batch(vec![400, 300], vec!["d", "c"]);
        let (out_schema, merged) =
            merge_record_batches("test_job", 0, schema.clone(), vec![b1, b2]).unwrap();
        // Should be sorted descending by _timestamp
        assert_eq!(merged.num_rows(), 4);
        let ts_col = merged
            .column_by_name(TIMESTAMP_COL_NAME)
            .unwrap()
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(ts_col.value(0), 400);
        assert_eq!(ts_col.value(3), 100);
        assert_eq!(out_schema, merged.schema());
    }

    // ── format_recordbatch_by_schema fast paths ──────────────────────────

    #[test]
    fn test_format_recordbatch_empty_target_schema_returns_batch_unchanged() {
        // schema.fields().is_empty() → return batch immediately
        let target_schema = Arc::new(Schema::empty());
        let src_schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Utf8, true)]));
        let batch = RecordBatch::try_new(
            src_schema.clone(),
            vec![Arc::new(StringArray::from(vec!["x"])) as ArrayRef],
        )
        .unwrap();
        let result = format_recordbatch_by_schema(target_schema, batch.clone());
        assert_eq!(result.num_rows(), batch.num_rows());
        assert_eq!(result.schema(), batch.schema());
    }

    #[test]
    fn test_format_recordbatch_identical_schemas_returns_batch_unchanged() {
        // schema.fields() == batch.schema().fields() → return batch immediately
        let schema = Arc::new(Schema::new(vec![
            Field::new("a", DataType::Utf8, true),
            Field::new("b", DataType::Int64, true),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["hello"])) as ArrayRef,
                Arc::new(Int64Array::from(vec![42_i64])) as ArrayRef,
            ],
        )
        .unwrap();
        let result = format_recordbatch_by_schema(schema.clone(), batch.clone());
        assert_eq!(result.schema(), batch.schema());
        assert_eq!(result.num_rows(), 1);
        let col = result.column_by_name("a").unwrap();
        assert_eq!(
            col.as_any().downcast_ref::<StringArray>().unwrap().value(0),
            "hello"
        );
    }
}
