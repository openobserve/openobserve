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

use std::{iter::zip, sync::Arc};

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

use crate::common::utils::{str, time};

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

        // 1. cast both arguments to Union. These casts MUST be aligned with the signature or this
        //    function panics!
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
    use std::sync::Arc;

    use datafusion::{
        arrow::{
            array::{Int64Array, StringArray},
            datatypes::{DataType, Field, Schema},
            record_batch::RecordBatch,
        },
        datasource::MemTable,
        prelude::SessionContext,
    };

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
                Arc::new(StringArray::from(vec!["a", "b", "c", "d"])),
                Arc::new(Int64Array::from(vec![
                    data_time - 1,
                    data_time,
                    data_time + 1,
                    data_time + 2,
                ])),
            ],
        )
        .unwrap();

        // declare a new context. In spark API, this corresponds to a new spark
        // SQLsession
        let ctx = SessionContext::new();
        ctx.register_udf(TIME_RANGE_UDF.clone());

        // declare a table in memory. In spark API, this corresponds to
        // createDataFrame(...).
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        let result = df.collect().await.unwrap();
        let count = result.iter().map(|batch| batch.num_rows()).sum::<usize>();
        assert_eq!(count, 3);
    }
}
