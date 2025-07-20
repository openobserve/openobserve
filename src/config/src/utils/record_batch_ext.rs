// Copyright 2025 OpenObserve Inc.
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
        Float64Builder, Int64Array, Int64Builder, NullBuilder, RecordBatchOptions, StringArray,
        StringBuilder, UInt64Array, UInt64Builder, make_builder, new_null_array,
    },
    record_batch::RecordBatch,
};
use arrow_schema::{ArrowError, DataType, Schema};
use datafusion::error::DataFusionError;
use hashbrown::{HashMap, HashSet};

use super::{
    json::{get_bool_value, get_float_value, get_int_value, get_string_value, get_uint_value},
    schema_ext::SchemaExt,
};
use crate::{FxIndexMap, TIMESTAMP_COL_NAME};

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
    let mut keys = HashSet::with_capacity(schema.fields().len());
    let mut max_keys = 0;
    for record in data.iter() {
        let record = record.as_object().unwrap();
        if record.len() > max_keys {
            max_keys = record.len();
        }
        for (k, _) in record {
            keys.insert(k);
        }
    }

    // create builders for each key
    let records_len = data.len();
    let mut builders: FxIndexMap<&String, (&DataType, Box<dyn ArrayBuilder>)> = schema
        .fields()
        .iter()
        .filter(|f| keys.contains(f.name()))
        .map(|f| {
            (
                f.name(),
                (f.data_type(), make_builder(f.data_type(), records_len)),
            )
        })
        .collect();

    // fill builders with data
    let mut record_keys = HashSet::with_capacity(max_keys);
    for record in data.iter() {
        record_keys.clear();
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
                    "Cannot find key {k} (value: {v:?}) in schema {schema:?}"
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
                        b.append_value(get_string_value(v));
                    }
                }
                DataType::Int64 => {
                    let b = builder.as_any_mut().downcast_mut::<Int64Builder>().unwrap();
                    if v.is_null() {
                        b.append_null();
                    } else {
                        b.append_value(get_int_value(v));
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
                        b.append_value(get_uint_value(v));
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
                        b.append_value(get_float_value(v));
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
                        b.append_value(get_bool_value(v));
                    }
                }
                DataType::Binary => {
                    let b = builder
                        .as_any_mut()
                        .downcast_mut::<BinaryBuilder>()
                        .unwrap();
                    if v.is_null() {
                        b.append_null();
                    } else {
                        let v = v.as_str().ok_or_else(|| {
                            ArrowError::SchemaError(
                                "Cannot convert to [DataType::Binary] from non-string value"
                                    .to_string(),
                            )
                        })?;
                        let bin_data = hex::decode(v).map_err(|_| {
                            ArrowError::SchemaError(
                                "Cannot convert to [DataType::Binary] from non-hex string value"
                                    .to_string(),
                            )
                        })?;
                        b.append_value(bin_data);
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
        if let Some((_, builder)) = builders.get_mut(field.name()) {
            cols.push(builder.finish());
        } else {
            cols.push(new_null_array(field.data_type(), records_len))
        }
    }

    RecordBatch::try_new(schema.clone(), cols)
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

#[cfg(test)]
mod test {
    use arrow::util::pretty::pretty_format_batches;
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
}
