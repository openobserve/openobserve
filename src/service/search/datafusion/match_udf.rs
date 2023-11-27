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

use crate::common::utils::str;

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
                Arc::new(StringArray::from(vec!["a", "b", "c", "d"])),
                Arc::new(Int64Array::from(vec![1, 2, 3, 4])),
                Arc::new(StringArray::from(vec!["NY", "Pune", "SF", "Beijing"])),
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
