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

use std::{iter::zip, sync::Arc};

use arrow::array::StringArray;
use config::utils::json;
use datafusion::{
    arrow::{array::ArrayRef, datatypes::DataType},
    common::cast::as_string_array,
    error::DataFusionError,
    logical_expr::{ColumnarValue, ScalarUDF, Volatility},
    prelude::create_udf,
    sql::sqlparser::parser::ParserError,
};
use once_cell::sync::Lazy;

/// The name of the arrjoin UDF given to DataFusion.
pub const ARR_JOIN_UDF_NAME: &str = "arrjoin";

/// Implementation of arrjoin
pub(crate) static ARR_JOIN_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        ARR_JOIN_UDF_NAME,
        // expects two string - the field and the delimiter
        vec![DataType::Utf8, DataType::Utf8],
        // returns string
        DataType::Utf8,
        Volatility::Immutable,
        Arc::new(arr_join_impl),
    )
});

/// arrjoin function for datafusion
pub fn arr_join_impl(args: &[ColumnarValue]) -> datafusion::error::Result<ColumnarValue> {
    log::debug!("Inside arrjoin");
    if args.len() != 2 {
        return Err(DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "UDF params should be: arrjoin(field1, delim)".to_string(),
            )),
            None,
        ));
    }
    let args = ColumnarValue::values_to_arrays(args)?;
    // log::debug!("Got the args: {:#?}", args);

    // 1. cast both arguments to be aligned with the signature
    let arr_field1 = as_string_array(&args[0])?;
    let delim = as_string_array(&args[1])?;

    // 2. perform the computation
    let array = zip(arr_field1.iter(), delim.iter())
        .map(|(arr_field1, val)| {
            match (arr_field1, val) {
                // in arrow, any value can be null.
                // Here we decide to make our UDF to return null when either argument is null.
                (Some(arr_field1), Some(delim)) => json::from_str::<json::Value>(arr_field1)
                    .ok()
                    .and_then(|arr_field1| {
                        if let json::Value::Array(field1) = arr_field1 {
                            let join_arrs: Vec<String> =
                                field1.iter().map(super::stringify_json_value).collect();
                            Some(join_arrs.join(delim))
                        } else {
                            None
                        }
                    }),
                _ => None,
            }
        })
        .collect::<StringArray>();

    // `Ok` because no error occurred during the calculation
    // `Arc` because arrays are immutable, thread-safe, trait objects.
    Ok(ColumnarValue::from(Arc::new(array) as ArrayRef))
}

#[cfg(test)]
mod tests {
    use datafusion::{
        arrow::{
            datatypes::{Field, Schema},
            record_batch::RecordBatch,
        },
        assert_batches_eq,
        datasource::MemTable,
        prelude::SessionContext,
    };

    use super::*;

    // Helper function to run a single test case
    async fn run_single_test(arr_field: &str, delimiter: &str, expected_output: Vec<&str>) {
        let sql = format!("select arrjoin(arr_field, '{delimiter}') as ret from t");
        let sqls = [(sql.as_str(), expected_output)];

        let schema = Arc::new(Schema::new(vec![Field::new(
            "arr_field",
            DataType::Utf8,
            false,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec![arr_field]))],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_JOIN_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    // Helper function to run multiple test cases that should all return null
    async fn run_null_returning_tests(test_cases: &[(&str, &str)]) {
        let expected_output = vec!["+-----+", "| ret |", "+-----+", "|     |", "+-----+"];

        for &(arr_field, delimiter) in test_cases {
            run_single_test(arr_field, delimiter, expected_output.clone()).await;
        }
    }

    #[tokio::test]
    async fn test_arr_join_valid_arrays() {
        let test_cases = [
            (
                r#"[true,false,true]"#,
                ",",
                vec![
                    "+-----------------+",
                    "| ret             |",
                    "+-----------------+",
                    "| true,false,true |",
                    "+-----------------+",
                ],
            ),
            (
                r#"["hello2","hi2","bye2"]"#,
                ",",
                vec![
                    "+-----------------+",
                    "| ret             |",
                    "+-----------------+",
                    "| hello2,hi2,bye2 |",
                    "+-----------------+",
                ],
            ),
            (
                r#"[12, 345, 23, 45]"#,
                ",",
                vec![
                    "+--------------+",
                    "| ret          |",
                    "+--------------+",
                    "| 12,345,23,45 |",
                    "+--------------+",
                ],
            ),
            (
                r#"[1.9, 34.5, 2.6, 4.5]"#,
                ",",
                vec![
                    "+------------------+",
                    "| ret              |",
                    "+------------------+",
                    "| 1.9,34.5,2.6,4.5 |",
                    "+------------------+",
                ],
            ),
            (
                r#"["hello2","hi2",123, 23.9, false]"#,
                ",",
                vec![
                    "+---------------------------+",
                    "| ret                       |",
                    "+---------------------------+",
                    "| hello2,hi2,123,23.9,false |",
                    "+---------------------------+",
                ],
            ),
            (
                r#"["a", "b", "c"]"#,
                "|",
                vec![
                    "+-------+",
                    "| ret   |",
                    "+-------+",
                    "| a|b|c |",
                    "+-------+",
                ],
            ),
            (
                r#"["single"]"#,
                ",",
                vec![
                    "+--------+",
                    "| ret    |",
                    "+--------+",
                    "| single |",
                    "+--------+",
                ],
            ),
        ];

        for (arr_field, delimiter, expected_output) in test_cases {
            run_single_test(arr_field, delimiter, expected_output).await;
        }
    }

    #[tokio::test]
    async fn test_arr_join_null_returning_cases() {
        // Test cases that should return null
        let null_cases = [
            (r#"[]"#, ","),               // empty array
            (r#"not json"#, ","),         // invalid JSON
            (r#"{"key": "value"}"#, ","), // object
            (r#""just a string""#, ","),  // string
            (r#"42"#, ","),               // number
            (r#"true"#, ","),             // boolean
            (r#"null"#, ","),             // null
        ];

        run_null_returning_tests(&null_cases).await;
    }

    #[tokio::test]
    async fn test_arr_join_null_input() {
        let expected_output = ["+-----+", "| ret |", "+-----+", "|     |", "+-----+"];

        let schema = Arc::new(Schema::new(vec![Field::new(
            "arr_field",
            DataType::Utf8,
            true,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec![None::<String>]))],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_JOIN_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "select arrjoin(arr_field, ',') as ret from t";
        let df = ctx.sql(sql).await.unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(expected_output, &data);
    }

    #[tokio::test]
    async fn test_arr_join_multiple_rows() {
        let arr_fields = vec![
            r#"["a", "b", "c"]"#,
            r#"[]"#,
            r#"not json"#,
            r#"["x", "y"]"#,
            r#"{"key": "value"}"#,
        ];
        let sql = "select arrjoin(arr_field, ',') as ret from t";
        let expected_output = [
            "+-------+",
            "| ret   |",
            "+-------+",
            "| a,b,c |",
            "|       |",
            "|       |",
            "| x,y   |",
            "|       |",
            "+-------+",
        ];

        let schema = Arc::new(Schema::new(vec![Field::new(
            "arr_field",
            DataType::Utf8,
            false,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(arr_fields))],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_JOIN_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(expected_output, &data);
    }

    #[tokio::test]
    async fn test_arr_join_wrong_arguments() {
        let ctx = SessionContext::new();
        ctx.register_udf(ARR_JOIN_UDF.clone());

        // Test with no arguments
        let result = ctx.sql("select arrjoin() as ret").await;
        assert!(result.is_err());

        // Test with one argument
        let result = ctx.sql("select arrjoin('a') as ret").await;
        assert!(result.is_err());

        // Test with three arguments
        let result = ctx.sql("select arrjoin('a', 'b', 'c') as ret").await;
        assert!(result.is_err());
    }
}
