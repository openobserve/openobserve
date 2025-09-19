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

use std::{cmp::Ordering, sync::Arc};

use config::utils::json;
use datafusion::{
    arrow::{
        array::{ArrayRef, StringArray},
        datatypes::DataType,
    },
    common::cast::as_string_array,
    error::DataFusionError,
    logical_expr::{ColumnarValue, ScalarUDF, Volatility},
    prelude::create_udf,
    sql::sqlparser::parser::ParserError,
};
use once_cell::sync::Lazy;

/// The name of the arrsort UDF given to DataFusion.
pub const ARR_SORT_UDF_NAME: &str = "arrsort";

/// Implementation of arrsort
pub(crate) static ARR_SORT_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        ARR_SORT_UDF_NAME,
        // expects one string - the array field
        vec![DataType::Utf8],
        // returns string
        DataType::Utf8,
        Volatility::Immutable,
        Arc::new(arr_sort_impl),
    )
});

/// arrsort function for datafusion
pub fn arr_sort_impl(args: &[ColumnarValue]) -> datafusion::error::Result<ColumnarValue> {
    log::debug!("Inside arrsort");
    if args.len() != 1 {
        return Err(DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "UDF params should be: arrsort(field)".to_string(),
            )),
            None,
        ));
    }
    let args = ColumnarValue::values_to_arrays(args)?;
    // log::debug!("Got the args: {:#?}", args);

    // 1. cast both arguments to be aligned with the signature
    let arr_field = as_string_array(&args[0])?;

    // 2. perform the computation
    let array = arr_field
        .iter()
        .map(|arr_field| {
            arr_field.and_then(|arr_field| {
                json::from_str::<json::Value>(arr_field)
                    .ok()
                    .and_then(|arr_field| {
                        if let json::Value::Array(mut field) = arr_field {
                            if field.is_empty() {
                                None
                            } else {
                                field.sort_by(|a, b| {
                                    // Assuming the array having elements of same type
                                    if a.is_f64() {
                                        a.as_f64().unwrap().total_cmp(b.as_f64().as_ref().unwrap())
                                    } else if a.is_i64() {
                                        a.as_i64().unwrap().cmp(b.as_i64().as_ref().unwrap())
                                    } else if a.is_u64() {
                                        a.as_u64().unwrap().cmp(b.as_u64().as_ref().unwrap())
                                    } else if a.is_string() {
                                        a.as_str().unwrap().cmp(b.as_str().unwrap())
                                    } else if a.is_boolean() {
                                        a.as_bool().unwrap().cmp(b.as_bool().as_ref().unwrap())
                                    } else {
                                        Ordering::Less
                                    }
                                });
                                json::to_string(&field).ok()
                            }
                        } else {
                            None
                        }
                    })
            })
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
    async fn run_single_test(arr_field: &str, expected_output: Vec<&str>) {
        let sql = "select arrsort(arr_field) as ret from t";
        let sqls = [(sql, expected_output)];

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
        ctx.register_udf(ARR_SORT_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    // Helper function to run multiple test cases that should all return null
    async fn run_null_returning_tests(test_cases: &[&str]) {
        let expected_output = vec!["+-----+", "| ret |", "+-----+", "|     |", "+-----+"];

        for &arr_field in test_cases {
            run_single_test(arr_field, expected_output.clone()).await;
        }
    }

    #[tokio::test]
    async fn test_arr_sort_valid_arrays() {
        let test_cases = [
            (
                r#"[true,false,true]"#,
                vec![
                    "+-------------------+",
                    "| ret               |",
                    "+-------------------+",
                    "| [false,true,true] |",
                    "+-------------------+",
                ],
            ),
            (
                r#"["hello2","hi2","bye2"]"#,
                vec![
                    "+-------------------------+",
                    "| ret                     |",
                    "+-------------------------+",
                    "| [\"bye2\",\"hello2\",\"hi2\"] |",
                    "+-------------------------+",
                ],
            ),
            (
                r#"[12, 345, 23, 45]"#,
                vec![
                    "+----------------+",
                    "| ret            |",
                    "+----------------+",
                    "| [12,23,45,345] |",
                    "+----------------+",
                ],
            ),
            (
                r#"[1.9, 34.5, 2.6, 4.5]"#,
                vec![
                    "+--------------------+",
                    "| ret                |",
                    "+--------------------+",
                    "| [1.9,2.6,4.5,34.5] |",
                    "+--------------------+",
                ],
            ),
            (
                r#"[3, 1, 4, 1, 5]"#,
                vec![
                    "+-------------+",
                    "| ret         |",
                    "+-------------+",
                    "| [1,1,3,4,5] |",
                    "+-------------+",
                ],
            ),
            (
                r#"["zebra", "apple", "banana"]"#,
                vec![
                    "+----------------------------+",
                    "| ret                        |",
                    "+----------------------------+",
                    "| [\"apple\",\"banana\",\"zebra\"] |",
                    "+----------------------------+",
                ],
            ),
        ];

        for (arr_field, expected_output) in test_cases {
            run_single_test(arr_field, expected_output).await;
        }
    }

    #[tokio::test]
    async fn test_arr_sort_null_returning_cases() {
        // Test cases that should return null
        let null_cases = [
            r#"not json"#,         // invalid JSON
            r#"{"key": "value"}"#, // object
            r#""just a string""#,  // string
            r#"42"#,               // number
            r#"true"#,             // boolean
            r#"null"#,             // null
        ];

        run_null_returning_tests(&null_cases).await;
    }

    #[tokio::test]
    async fn test_arr_sort_null_input() {
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
        ctx.register_udf(ARR_SORT_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "select arrsort(arr_field) as ret from t";
        let df = ctx.sql(sql).await.unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(expected_output, &data);
    }

    #[tokio::test]
    async fn test_arr_sort_multiple_rows() {
        let arr_fields = vec![
            r#"[3, 1, 4]"#,
            r#"[]"#,
            r#"not json"#,
            r#"["b", "a", "c"]"#,
            r#"{"key": "value"}"#,
        ];
        let sql = "select arrsort(arr_field) as ret from t";
        let expected_output = [
            "+---------------+",
            "| ret           |",
            "+---------------+",
            "| [1,3,4]       |",
            "|               |",
            "|               |",
            "| [\"a\",\"b\",\"c\"] |",
            "|               |",
            "+---------------+",
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
        ctx.register_udf(ARR_SORT_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(expected_output, &data);
    }

    #[tokio::test]
    async fn test_arr_sort_wrong_arguments() {
        let ctx = SessionContext::new();
        ctx.register_udf(ARR_SORT_UDF.clone());

        // Test with no arguments
        let result = ctx.sql("select arrsort() as ret").await;
        assert!(result.is_err());

        // Test with multiple arguments
        let result = ctx.sql("select arrsort('a', 'b') as ret").await;
        assert!(result.is_err());
    }
}
