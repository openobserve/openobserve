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

/// The name of the arrzip UDF given to DataFusion.
pub const ARR_ZIP_UDF_NAME: &str = "arrzip";

/// Implementation of arrzip UDF
pub(crate) static ARR_ZIP_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        ARR_ZIP_UDF_NAME,
        // expects three string - field1, field2 and the delim
        vec![DataType::Utf8, DataType::Utf8, DataType::Utf8],
        // returns string
        DataType::Utf8,
        Volatility::Immutable,
        Arc::new(arr_zip_impl),
    )
});

/// arrzip function for datafusion
pub fn arr_zip_impl(args: &[ColumnarValue]) -> datafusion::error::Result<ColumnarValue> {
    log::debug!("Inside arrzip");
    if args.len() != 3 {
        return Err(DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "UDF params should be: arrzip(field1, field2, delim)".to_string(),
            )),
            None,
        ));
    }
    let args = ColumnarValue::values_to_arrays(args)?;
    // log::debug!("Got the args: {:#?}", args);

    // 1. cast both arguments to be aligned with the signature
    let arr_field1 = as_string_array(&args[0])?;
    let arr_field2 = as_string_array(&args[1])?;
    let delim = as_string_array(&args[2])?;

    // 2. perform the computation
    let array = zip(arr_field1.iter(), zip(arr_field2.iter(), delim.iter()))
        .map(|(arr_field1, val)| match (arr_field1, val) {
            (Some(arr_field1), (Some(arr_field2), Some(delim))) => {
                json::from_str::<json::Value>(arr_field1)
                    .ok()
                    .and_then(|arr_field1| {
                        json::from_str::<json::Value>(arr_field2)
                            .ok()
                            .and_then(|arr_field2| {
                                if let (json::Value::Array(field1), json::Value::Array(field2)) =
                                    (arr_field1, arr_field2)
                                {
                                    if field1.is_empty() || field2.is_empty() {
                                        None
                                    } else {
                                        let zipped_arrs: Vec<String> =
                                            zip(field1.iter(), field2.iter())
                                                .map(|(field1, field2)| {
                                                    let field1 =
                                                        super::stringify_json_value(field1);
                                                    let field2 =
                                                        super::stringify_json_value(field2);
                                                    format!("{field1}{delim}{field2}")
                                                })
                                                .collect();
                                        json::to_string(&zipped_arrs).ok()
                                    }
                                } else {
                                    None
                                }
                            })
                    })
            }
            _ => None,
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
    async fn run_single_test(
        arr_field1: &str,
        arr_field2: &str,
        delimiter: &str,
        expected_output: Vec<&str>,
    ) {
        let sql = format!("select arrzip(arr_field1, arr_field2, '{delimiter}') as ret from t");
        let sqls = [(sql.as_str(), expected_output)];

        let schema = Arc::new(Schema::new(vec![
            Field::new("arr_field1", DataType::Utf8, false),
            Field::new("arr_field2", DataType::Utf8, false),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![arr_field1])),
                Arc::new(StringArray::from(vec![arr_field2])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_ZIP_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    // Helper function to run multiple test cases that should all return null
    async fn run_null_returning_tests(test_cases: &[(&str, &str, &str)]) {
        let expected_output = vec!["+-----+", "| ret |", "+-----+", "|     |", "+-----+"];

        for &(arr_field1, arr_field2, delimiter) in test_cases {
            run_single_test(arr_field1, arr_field2, delimiter, expected_output.clone()).await;
        }
    }

    #[tokio::test]
    async fn test_arr_zip_valid_arrays() {
        let test_cases = [
            (
                r#"[true,false,true]"#,
                r#"["hello2","hi2","bye2"]"#,
                ",",
                vec![
                    "+-----------------------------------------+",
                    "| ret                                     |",
                    "+-----------------------------------------+",
                    "| [\"true,hello2\",\"false,hi2\",\"true,bye2\"] |",
                    "+-----------------------------------------+",
                ],
            ),
            (
                r#"[12, 345, 23, 45]"#,
                r#"[1.9, 34.5, 2.6, 4.5]"#,
                ",",
                vec![
                    "+-----------------------------------------+",
                    "| ret                                     |",
                    "+-----------------------------------------+",
                    "| [\"12,1.9\",\"345,34.5\",\"23,2.6\",\"45,4.5\"] |",
                    "+-----------------------------------------+",
                ],
            ),
            (
                r#"[12, 345, 23, 45]"#,
                r#"["hello2","hi2",123, 23.9, false]"#,
                ",",
                vec![
                    "+--------------------------------------------+",
                    "| ret                                        |",
                    "+--------------------------------------------+",
                    "| [\"12,hello2\",\"345,hi2\",\"23,123\",\"45,23.9\"] |",
                    "+--------------------------------------------+",
                ],
            ),
            (
                r#"["a", "b", "c"]"#,
                r#"[1, 2, 3]"#,
                "|",
                vec![
                    "+---------------------+",
                    "| ret                 |",
                    "+---------------------+",
                    "| [\"a|1\",\"b|2\",\"c|3\"] |",
                    "+---------------------+",
                ],
            ),
            (
                r#"["single"]"#,
                r#"[42]"#,
                "-",
                vec![
                    "+---------------+",
                    "| ret           |",
                    "+---------------+",
                    "| [\"single-42\"] |",
                    "+---------------+",
                ],
            ),
        ];

        for (arr_field1, arr_field2, delimiter, expected_output) in test_cases {
            run_single_test(arr_field1, arr_field2, delimiter, expected_output).await;
        }
    }

    #[tokio::test]
    async fn test_arr_zip_null_returning_cases() {
        // Test cases that should return null
        let null_cases = [
            (r#"[]"#, r#"[1,2,3]"#, ","),               // empty array
            (r#"not json"#, r#"[1,2,3]"#, ","),         // invalid JSON
            (r#"{"key": "value"}"#, r#"[1,2,3]"#, ","), // object
            (r#""just a string""#, r#"[1,2,3]"#, ","),  // string
            (r#"42"#, r#"[1,2,3]"#, ","),               // number
            (r#"true"#, r#"[1,2,3]"#, ","),             // boolean
            (r#"null"#, r#"[1,2,3]"#, ","),             // null
            (r#"[1,2,3]"#, r#"[]"#, ","),               // second array empty
            (r#"[1,2,3]"#, r#"not json"#, ","),         // second array invalid JSON
        ];

        run_null_returning_tests(&null_cases).await;
    }

    #[tokio::test]
    async fn test_arr_zip_null_input() {
        let expected_output = ["+-----+", "| ret |", "+-----+", "|     |", "+-----+"];

        let schema = Arc::new(Schema::new(vec![
            Field::new("arr_field1", DataType::Utf8, true),
            Field::new("arr_field2", DataType::Utf8, true),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![None::<String>])),
                Arc::new(StringArray::from(vec![None::<String>])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_ZIP_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "select arrzip(arr_field1, arr_field2, ',') as ret from t";
        let df = ctx.sql(sql).await.unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(expected_output, &data);
    }

    #[tokio::test]
    async fn test_arr_zip_multiple_rows() {
        let arr_fields1 = vec![
            r#"[1, 2, 3]"#,
            r#"[]"#,
            r#"not json"#,
            r#"["a", "b"]"#,
            r#"{"key": "value"}"#,
        ];
        let arr_fields2 = vec![
            r#"[4, 5, 6]"#,
            r#"[1, 2]"#,
            r#"[1, 2]"#,
            r#"[x, y]"#,
            r#"[1, 2]"#,
        ];
        let sql = "select arrzip(arr_field1, arr_field2, ',') as ret from t";
        let expected_output = [
            "+---------------------+",
            "| ret                 |",
            "+---------------------+",
            "| [\"1,4\",\"2,5\",\"3,6\"] |",
            "|                     |",
            "|                     |",
            "|                     |",
            "|                     |",
            "+---------------------+",
        ];

        let schema = Arc::new(Schema::new(vec![
            Field::new("arr_field1", DataType::Utf8, false),
            Field::new("arr_field2", DataType::Utf8, false),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(arr_fields1)),
                Arc::new(StringArray::from(arr_fields2)),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_ZIP_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(expected_output, &data);
    }

    #[tokio::test]
    async fn test_arr_zip_wrong_arguments() {
        let ctx = SessionContext::new();
        ctx.register_udf(ARR_ZIP_UDF.clone());

        // Test with no arguments
        let result = ctx.sql("select arrzip() as ret").await;
        assert!(result.is_err());

        // Test with one argument
        let result = ctx.sql("select arrzip('a') as ret").await;
        assert!(result.is_err());

        // Test with two arguments
        let result = ctx.sql("select arrzip('a', 'b') as ret").await;
        assert!(result.is_err());

        // Test with four arguments
        let result = ctx.sql("select arrzip('a', 'b', 'c', 'd') as ret").await;
        assert!(result.is_err());
    }
}
