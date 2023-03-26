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
        array::{ArrayRef, BooleanArray, StringArray},
        datatypes::DataType,
    },
    error::DataFusionError,
    logical_expr::{ScalarFunctionImplementation, ScalarUDF, Volatility},
    physical_plan::functions::make_scalar_function,
    prelude::create_udf,
    sql::sqlparser::parser::ParserError,
};
use once_cell::sync::Lazy;
use std::sync::Arc;

use crate::common::str;

/// Implementation of match_range
pub(crate) static MATCH_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        super::MATCH_UDF_NAME,
        // expects two string
        vec![DataType::Utf8, DataType::Utf8],
        // returns boolean
        Arc::new(DataType::Boolean),
        Volatility::Stable,
        match_expr_impl(false),
    )
});

/// Implementation of match_ignore_case
pub(crate) static MATCH_IGNORE_CASE_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        super::MATCH_UDF_IGNORE_CASE_NAME,
        // expects two string
        vec![DataType::Utf8, DataType::Utf8],
        // returns boolean
        Arc::new(DataType::Boolean),
        Volatility::Stable,
        match_expr_impl(true),
    )
});

/// match function for datafusion
pub fn match_expr_impl(case_insensitive: bool) -> ScalarFunctionImplementation {
    let func = move |args: &[ArrayRef]| -> datafusion::error::Result<ArrayRef> {
        if args.len() != 2 {
            return Err(DataFusionError::SQL(ParserError::ParserError(
                "match UDF expects two string".to_string(),
            )));
        }

        // 1. cast both arguments to string. These casts MUST be aligned with the signature or this function panics!
        let haystack = &args[0]
            .as_any()
            .downcast_ref::<StringArray>()
            .expect("cast failed");
        let needle = &args[1]
            .as_any()
            .downcast_ref::<StringArray>()
            .expect("cast failed");

        // 2. perform the computation
        let array = haystack
            .iter()
            .zip(needle.iter())
            .map(|(haystack, needle)| {
                match (haystack, needle) {
                    // in arrow, any value can be null.
                    // Here we decide to make our UDF to return null when either haystack or needle is null.
                    (Some(haystack), Some(needle)) => match case_insensitive {
                        true => Some(str::find(
                            haystack.to_lowercase().as_str(),
                            needle.to_lowercase().as_str(),
                        )),
                        false => Some(str::find(haystack, needle)),
                    },
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
    async fn test_match_udf() {
        let sql = "select * from t where str_match(log, 'a') and str_match_ignore_case(city, 'ny')";

        // define a schema.
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("id", DataType::Int64, false),
            Field::new("city", DataType::Utf8, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from_slice(&["a", "b", "c", "d"])),
                Arc::new(Int64Array::from_slice(&[1, 2, 3, 4])),
                Arc::new(StringArray::from_slice(&["NY", "Pune", "SF", "Beijing"])),
            ],
        )
        .unwrap();

        // declare a new context. In spark API, this corresponds to a new spark SQLsession
        let ctx = SessionContext::new();
        ctx.register_udf(MATCH_UDF.clone());
        ctx.register_udf(MATCH_IGNORE_CASE_UDF.clone());

        // declare a table in memory. In spark API, this corresponds to createDataFrame(...).
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        let result = df.collect().await.unwrap();
        let count = result.iter().map(|batch| batch.num_rows()).sum::<usize>();
        assert_eq!(count, 1);
    }
}
