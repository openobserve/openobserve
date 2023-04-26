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

use datafusion::{
    arrow::{
        array::{ArrayRef, BooleanArray, Int64Array, StringArray},
        datatypes::DataType,
    },
    error::DataFusionError,
    logical_expr::{ScalarFunctionImplementation, ScalarUDF, Volatility},
    physical_plan::functions::make_scalar_function,
    prelude::create_udf,
    sql::sqlparser::parser::ParserError,
};
use once_cell::sync::Lazy;
use std::iter::zip;
use std::sync::Arc;

use crate::common::str;
use crate::common::time;

/// The name of the time_range UDF given to DataFusion.
pub const TIME_RANGE_UDF_NAME: &str = "time_range";

/// Implementation of time_range
pub(crate) static TIME_RANGE_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        TIME_RANGE_UDF_NAME,
        // expects three string
        vec![DataType::Int64, DataType::Utf8, DataType::Utf8],
        // returns boolean
        Arc::new(DataType::Boolean),
        Volatility::Immutable,
        time_range_expr_impl(),
    )
});

/// time_range function for datafusion
pub fn time_range_expr_impl() -> ScalarFunctionImplementation {
    let func = move |args: &[ArrayRef]| -> datafusion::error::Result<ArrayRef> {
        if args.len() != 3 {
            return Err(DataFusionError::SQL(ParserError::ParserError(
                "UDF params should be: time_range(field, start, end)".to_string(),
            )));
        }

        // 1. cast both arguments to Union. These casts MUST be aligned with the signature or this function panics!
        let base = &args[0]
            .as_any()
            .downcast_ref::<Int64Array>()
            .expect("cast failed");
        let min = &args[1]
            .as_any()
            .downcast_ref::<StringArray>()
            .expect("cast failed");
        let max = &args[2]
            .as_any()
            .downcast_ref::<StringArray>()
            .expect("cast failed");

        // 2. perform the computation
        let array = zip(base.iter(), zip(min.iter(), max.iter()))
            .map(|(base, val)| {
                match (base, val) {
                    // in arrow, any value can be null.
                    // Here we decide to make our UDF to return null when either argument is null.
                    (Some(base), (Some(min), Some(max))) => {
                        let min = match time::parse_str_to_timestamp_micros(min) {
                            Ok(v) => v,
                            Err(_) => return None,
                        };
                        let max = match time::parse_str_to_timestamp_micros(max) {
                            Ok(v) => v,
                            Err(_) => return None,
                        };
                        let result: bool;
                        if min > 0 && max > 0 {
                            result = base >= min && base < max;
                        } else if min > 0 {
                            result = base >= min;
                        } else if max > 0 {
                            result = base < max;
                        } else {
                            result = true;
                        }
                        Some(result)
                    }
                    _ => None,
                }
            })
            .collect::<BooleanArray>();

        // `Ok` because no error occurred during the calculation
        // `Arc` because arrays are immutable, thread-safe, trait objects.
        Ok(Arc::new(array) as ArrayRef)
    };

    make_scalar_function(func)
}

#[cfg(test)]
mod tests {
    use datafusion::arrow::array::{Int64Array, StringArray};
    use datafusion::arrow::datatypes::{DataType, Field, Schema};
    use datafusion::arrow::record_batch::RecordBatch;
    use datafusion::datasource::MemTable;
    use datafusion::from_slice::FromSlice;
    use datafusion::prelude::SessionContext;
    use std::sync::Arc;

    use super::*;

    #[tokio::test]
    async fn test_time_range() {
        let data_time = time::parse_str_to_timestamp_micros("2021-01-01T00:00:00.000Z").unwrap();
        let sql = "select * from t where time_range(time, '2021-01-01T00:00:00.000Z', '2021-01-02T00:00:00.000Z')";

        // define a schema.
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("time", DataType::Int64, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from_slice(&["a", "b", "c", "d"])),
                Arc::new(Int64Array::from_slice(&[
                    data_time - 1,
                    data_time,
                    data_time + 1,
                    data_time + 2,
                ])),
            ],
        )
        .unwrap();

        // declare a new context. In spark API, this corresponds to a new spark SQLsession
        let ctx = SessionContext::new();
        ctx.register_udf(TIME_RANGE_UDF.clone());

        // declare a table in memory. In spark API, this corresponds to createDataFrame(...).
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        let result = df.collect().await.unwrap();
        let count = result.iter().map(|batch| batch.num_rows()).sum::<usize>();
        assert_eq!(count, 3);
    }
}
