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

use chrono::{FixedOffset, TimeZone, Utc};
use datafusion::{
    arrow::{
        array::{ArrayRef, Int64Array, StringArray},
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

use crate::common::time;

/// The name of the date_format UDF given to DataFusion.
pub const DATE_FORMAT_UDF_NAME: &str = "date_format";

/// Implementation of date_format
pub(crate) static DATE_FORMAT_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        DATE_FORMAT_UDF_NAME,
        // expects three string
        vec![DataType::Int64, DataType::Utf8, DataType::Utf8],
        // returns string
        Arc::new(DataType::Utf8),
        Volatility::Immutable,
        date_format_expr_impl(),
    )
});

/// date_format function for datafusion
pub fn date_format_expr_impl() -> ScalarFunctionImplementation {
    let func = move |args: &[ArrayRef]| -> datafusion::error::Result<ArrayRef> {
        if args.len() != 3 {
            return Err(DataFusionError::SQL(ParserError::ParserError(
                "UDF params should be: date_format(field, format, zone)".to_string(),
            )));
        }

        // 1. cast both arguments to Union. These casts MUST be aligned with the signature or this function panics!
        let timestamp = &args[0]
            .as_any()
            .downcast_ref::<Int64Array>()
            .expect("cast failed");
        let format = &args[1]
            .as_any()
            .downcast_ref::<StringArray>()
            .expect("cast failed");
        let timezone = &args[2]
            .as_any()
            .downcast_ref::<StringArray>()
            .expect("cast failed");

        // 2. perform the computation
        let array = zip(timestamp.iter(), zip(format.iter(), timezone.iter()))
            .map(|(timestamp, val)| {
                match (timestamp, val) {
                    // in arrow, any value can be null.
                    // Here we decide to make our UDF to return null when either argument is null.
                    (Some(timestamp), (Some(format), Some(timezone))) => {
                        let timestamp = time::parse_i64_to_timestamp_micros(timestamp);
                        let t = Utc.timestamp_nanos(timestamp * 1000);
                        let offset = time::parse_timezone_to_offset(timezone) as i32;
                        let result = if offset == 0 {
                            t.format(format).to_string()
                        } else {
                            let t = t.with_timezone(&FixedOffset::east_opt(offset).unwrap());
                            t.format(format).to_string()
                        };
                        Some(result)
                    }
                    _ => None,
                }
            })
            .collect::<StringArray>();

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
    use datafusion::assert_batches_eq;
    use datafusion::datasource::MemTable;
    use datafusion::from_slice::FromSlice;
    use datafusion::prelude::SessionContext;
    use std::sync::Arc;

    use super::*;

    #[tokio::test]
    async fn test_date_format() {
        let data_time = time::parse_str_to_timestamp_micros("2021-01-01T00:00:00.000Z").unwrap();
        let sqls = [
            (
                "select date_format(time, '%Y-%m-%d', '') as ret from t",
                vec![
                    "+------------+",
                    "| ret        |",
                    "+------------+",
                    "| 2021-01-01 |",
                    "+------------+",
                ],
            ),
            (
                "select date_format(time, '%Y-%m-%d', 'UTC') as ret from t",
                vec![
                    "+------------+",
                    "| ret        |",
                    "+------------+",
                    "| 2021-01-01 |",
                    "+------------+",
                ],
            ),
            (
                "select date_format(time, '%H:%M:%S', 'UTC') as ret from t",
                vec![
                    "+----------+",
                    "| ret      |",
                    "+----------+",
                    "| 00:00:00 |",
                    "+----------+",
                ],
            ),
            (
                "select date_format(time, '%H:%M:%S', '+08:00') as ret from t",
                vec![
                    "+----------+",
                    "| ret      |",
                    "+----------+",
                    "| 08:00:00 |",
                    "+----------+",
                ],
            ),
            (
                "select date_format(time, '%Y-%m-%dT%H:%M:%S', '-08:00') as ret from t",
                vec![
                    "+---------------------+",
                    "| ret                 |",
                    "+---------------------+",
                    "| 2020-12-31T16:00:00 |",
                    "+---------------------+",
                ],
            ),
        ];

        // define a schema.
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("time", DataType::Int64, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from_slice(&["a"])),
                Arc::new(Int64Array::from_slice(&[data_time])),
            ],
        )
        .unwrap();

        // declare a new context. In spark API, this corresponds to a new spark SQLsession
        let ctx = SessionContext::new();
        ctx.register_udf(DATE_FORMAT_UDF.clone());

        // declare a table in memory. In spark API, this corresponds to createDataFrame(...).
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }
}
