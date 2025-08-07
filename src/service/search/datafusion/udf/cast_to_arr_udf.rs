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

use arrow::array::{Array, ListBuilder, StringBuilder};
use arrow_schema::Field;
use config::utils::json;
use datafusion::{
    arrow::{array::ArrayRef, datatypes::DataType},
    common::cast::as_generic_string_array,
    error::DataFusionError,
    logical_expr::{ColumnarValue, ScalarUDF, Volatility},
    prelude::create_udf,
    sql::sqlparser::parser::ParserError,
};
use once_cell::sync::Lazy;

/// The name of the cast_to_arr UDF given to DataFusion.
pub const CAST_TO_ARR_UDF_NAME: &str = "cast_to_arr";

/// Implementation of cast_to_arr
pub(crate) static CAST_TO_ARR_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        CAST_TO_ARR_UDF_NAME,
        // takes one argument: the field
        vec![DataType::Utf8],
        DataType::List(Arc::new(Field::new("item", DataType::Utf8, true))),
        Volatility::Immutable,
        Arc::new(cast_to_arr_impl),
    )
});

/// cast_to_arr function for datafusion
pub fn cast_to_arr_impl(args: &[ColumnarValue]) -> datafusion::error::Result<ColumnarValue> {
    let args = ColumnarValue::values_to_arrays(args)?;
    log::debug!("Inside cast_to_arr_impl");
    if args.len() != 1 {
        return Err(DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "UDF params should be: cast_to_arr(field)".to_string(),
            )),
            None,
        ));
    }

    let string_array = as_generic_string_array::<i32>(&args[0])?;

    let mut list_builder = ListBuilder::new(StringBuilder::with_capacity(
        string_array.len(),
        string_array.get_buffer_memory_size(),
    ));

    string_array.iter().for_each(|string| {
        if let Some(arr) = string.and_then(|s| json::from_str::<json::Value>(s).ok()) {
            if let Some(arr) = arr.as_array().filter(|arr| !arr.is_empty()) {
                arr.iter()
                    .map(super::stringify_json_value)
                    .filter(|field| !field.is_empty())
                    .for_each(|field| {
                        list_builder.values().append_value(field);
                    });
                list_builder.append(true);
            } else {
                list_builder.append_null();
            }
        } else {
            list_builder.append_null();
        }
    });

    let list_array = list_builder.finish();
    Ok(ColumnarValue::from(Arc::new(list_array) as ArrayRef))
}

#[cfg(test)]
mod tests {
    use datafusion::{
        arrow::{array::StringArray, datatypes::Schema, record_batch::RecordBatch},
        assert_batches_eq,
        datasource::MemTable,
        prelude::SessionContext,
    };

    use super::*;

    // Helper function to run a single test case
    async fn run_single_test(log_line: &str, expected_output: Vec<&str>, nullable: bool) {
        let sqls = [("select cast_to_arr(log) as ret from t", expected_output)];

        let schema = Arc::new(Schema::new(vec![Field::new(
            "log",
            DataType::Utf8,
            nullable,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec![log_line]))],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(CAST_TO_ARR_UDF.clone());
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

        for &log_line in test_cases {
            run_single_test(log_line, expected_output.clone(), false).await;
        }
    }

    #[tokio::test]
    async fn test_cast_to_arr_valid_arrays() {
        let test_cases = [
            (
                r#"[12, 345, 23, 45]"#,
                vec![
                    "+-------------------+",
                    "| ret               |",
                    "+-------------------+",
                    "| [12, 345, 23, 45] |",
                    "+-------------------+",
                ],
            ),
            (
                r#"["hello2","hi2","bye2"]"#,
                vec![
                    "+---------------------+",
                    "| ret                 |",
                    "+---------------------+",
                    "| [hello2, hi2, bye2] |",
                    "+---------------------+",
                ],
            ),
            (
                r#"[1, "string", true, {"nested": "object"}, [1, 2, 3]]"#,
                vec![
                    "+-------------------------------------------------+",
                    "| ret                                             |",
                    "+-------------------------------------------------+",
                    "| [1, string, true, {\"nested\":\"object\"}, [1,2,3]] |",
                    "+-------------------------------------------------+",
                ],
            ),
            (
                r#"["", "valid", "", "another", ""]"#,
                vec![
                    "+------------------+",
                    "| ret              |",
                    "+------------------+",
                    "| [valid, another] |",
                    "+------------------+",
                ],
            ),
        ];

        for (log_line, expected_output) in test_cases {
            run_single_test(log_line, expected_output, false).await;
        }
    }

    #[tokio::test]
    async fn test_cast_to_arr_null_returning_cases() {
        // Test cases that should return null
        let null_cases = [
            r#"[]"#,               // empty array
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
    async fn test_cast_to_arr_null_input() {
        let expected_output = vec!["+-----+", "| ret |", "+-----+", "|     |", "+-----+"];

        let schema = Arc::new(Schema::new(vec![Field::new("log", DataType::Utf8, true)]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec![None::<String>]))],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(CAST_TO_ARR_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sqls = [("select cast_to_arr(log) as ret from t", expected_output)];
        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    #[tokio::test]
    async fn test_cast_to_arr_multiple_rows() {
        let log_lines = vec![
            r#"["a", "b", "c"]"#,
            r#"[]"#,
            r#"not json"#,
            r#"["x", "y"]"#,
            r#"{"key": "value"}"#,
        ];
        let sqls = [(
            "select cast_to_arr(log) as ret from t",
            vec![
                "+-----------+",
                "| ret       |",
                "+-----------+",
                "| [a, b, c] |",
                "|           |",
                "|           |",
                "| [x, y]    |",
                "|           |",
                "+-----------+",
            ],
        )];

        let schema = Arc::new(Schema::new(vec![Field::new("log", DataType::Utf8, false)]));
        let batch =
            RecordBatch::try_new(schema.clone(), vec![Arc::new(StringArray::from(log_lines))])
                .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(CAST_TO_ARR_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    #[tokio::test]
    async fn test_cast_to_arr_wrong_arguments() {
        let ctx = SessionContext::new();
        ctx.register_udf(CAST_TO_ARR_UDF.clone());

        // Test with no arguments
        let result = ctx.sql("select cast_to_arr() as ret").await;
        assert!(result.is_err());

        // Test with multiple arguments
        let result = ctx.sql("select cast_to_arr('a', 'b') as ret").await;
        assert!(result.is_err());
    }
}
