// Copyright 2026 OpenObserve Inc.
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

use std::sync::{Arc, LazyLock as Lazy};

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

use super::arrsort_udf::json_total_cmp;

/// The name of the arr_descending UDF given to DataFusion.
pub const ARR_DESCENDING_UDF_NAME: &str = "arr_descending";

/// Implementation of arr_descending
pub static ARR_DESCENDING_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        ARR_DESCENDING_UDF_NAME,
        // expects three string
        vec![DataType::Utf8],
        // returns string
        DataType::Utf8,
        Volatility::Immutable,
        Arc::new(arr_descending_impl),
    )
});

/// arr_descending function for datafusion
pub fn arr_descending_impl(args: &[ColumnarValue]) -> datafusion::error::Result<ColumnarValue> {
    log::debug!("Inside arr_descending");
    if args.len() != 1 {
        return Err(DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "UDF params should be: arr_descending(field1)".to_string(),
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
                        if let json::Value::Array(mut field1) = arr_field {
                            if field1.is_empty() {
                                None
                            } else {
                                field1.sort_by(|a, b| json_total_cmp(b, a));
                                json::to_string(&field1).ok()
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
    use arrow::array::{Array, StringArray};
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

    #[test]
    fn test_arr_descending_impl_integers_direct() {
        let input = StringArray::from(vec!["[1, 3, 2]"]);
        let args = [ColumnarValue::Array(Arc::new(input))];
        let result = arr_descending_impl(&args).unwrap();
        if let ColumnarValue::Array(out) = result {
            let out = out.as_any().downcast_ref::<StringArray>().unwrap();
            assert_eq!(out.value(0), "[3,2,1]");
        } else {
            panic!("expected array result");
        }
    }

    #[test]
    fn test_arr_descending_impl_wrong_arg_count_errors() {
        assert!(arr_descending_impl(&[]).is_err());
    }

    #[test]
    fn test_arr_descending_impl_invalid_json_returns_null() {
        let input = StringArray::from(vec!["not-json"]);
        let args = [ColumnarValue::Array(Arc::new(input))];
        let result = arr_descending_impl(&args).unwrap();
        if let ColumnarValue::Array(out) = result {
            let out = out.as_any().downcast_ref::<StringArray>().unwrap();
            assert!(out.is_null(0));
        } else {
            panic!("expected array result");
        }
    }

    // Helper function to run a single test case
    async fn run_single_test(arr_field: &str, expected_output: Vec<&str>) {
        let sql = "select arr_descending(arr_field) as ret from t";
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
        ctx.register_udf(ARR_DESCENDING_UDF.clone());
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
    async fn test_arr_descending_valid_arrays() {
        let test_cases = [
            (
                r#"[true,false,true]"#,
                vec![
                    "+-------------------+",
                    "| ret               |",
                    "+-------------------+",
                    "| [true,true,false] |",
                    "+-------------------+",
                ],
            ),
            (
                r#"["hello2","hi2","bye2"]"#,
                vec![
                    "+-------------------------+",
                    "| ret                     |",
                    "+-------------------------+",
                    "| [\"hi2\",\"hello2\",\"bye2\"] |",
                    "+-------------------------+",
                ],
            ),
            (
                r#"[12, 345, 23, 45]"#,
                vec![
                    "+----------------+",
                    "| ret            |",
                    "+----------------+",
                    "| [345,45,23,12] |",
                    "+----------------+",
                ],
            ),
            (
                r#"[1.9, 34.5, 2.6, 4.5]"#,
                vec![
                    "+--------------------+",
                    "| ret                |",
                    "+--------------------+",
                    "| [34.5,4.5,2.6,1.9] |",
                    "+--------------------+",
                ],
            ),
            (
                r#"[3, 1, 4, 1, 5]"#,
                vec![
                    "+-------------+",
                    "| ret         |",
                    "+-------------+",
                    "| [5,4,3,1,1] |",
                    "+-------------+",
                ],
            ),
            (
                r#"["zebra", "apple", "banana"]"#,
                vec![
                    "+----------------------------+",
                    "| ret                        |",
                    "+----------------------------+",
                    "| [\"zebra\",\"banana\",\"apple\"] |",
                    "+----------------------------+",
                ],
            ),
        ];

        for (arr_field, expected_output) in test_cases {
            run_single_test(arr_field, expected_output).await;
        }
    }

    #[tokio::test]
    async fn test_arr_descending_null_returning_cases() {
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
    async fn test_arr_descending_null_input() {
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
        ctx.register_udf(ARR_DESCENDING_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "select arr_descending(arr_field) as ret from t";
        let df = ctx.sql(sql).await.unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(expected_output, &data);
    }

    #[tokio::test]
    async fn test_arr_descending_multiple_rows() {
        let arr_fields = vec![
            r#"[3, 1, 4]"#,
            r#"[]"#,
            r#"not json"#,
            r#"["b", "a", "c"]"#,
            r#"{"key": "value"}"#,
        ];
        let sql = "select arr_descending(arr_field) as ret from t";
        let expected_output = [
            "+---------------+",
            "| ret           |",
            "+---------------+",
            "| [4,3,1]       |",
            "|               |",
            "|               |",
            "| [\"c\",\"b\",\"a\"] |",
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
        ctx.register_udf(ARR_DESCENDING_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(expected_output, &data);
    }

    #[tokio::test]
    async fn test_arr_descending_wrong_arguments() {
        let ctx = SessionContext::new();
        ctx.register_udf(ARR_DESCENDING_UDF.clone());

        // Test with no arguments
        let result = ctx.sql("select arr_descending() as ret").await;
        assert!(result.is_err());

        // Test with multiple arguments
        let result = ctx.sql("select arr_descending('a', 'b') as ret").await;
        assert!(result.is_err());
    }

    fn call_arr_descending(json_array: &str) -> String {
        let input = StringArray::from(vec![json_array]);
        let args = [ColumnarValue::Array(Arc::new(input))];
        let result = arr_descending_impl(&args).unwrap();
        match result {
            ColumnarValue::Array(out) => out
                .as_any()
                .downcast_ref::<StringArray>()
                .unwrap()
                .value(0)
                .to_string(),
            _ => panic!("expected array result"),
        }
    }

    #[test]
    fn test_arr_descending_mixed_number_and_string_does_not_panic() {
        call_arr_descending(r#"[1.5,"a"]"#);
    }

    #[test]
    fn test_arr_descending_float_and_int_does_not_panic() {
        call_arr_descending(r#"[2.5,1]"#);
    }

    #[test]
    fn test_arr_descending_negative_and_huge_unsigned_does_not_panic() {
        call_arr_descending(r#"[-1,18446744073709551615]"#);
    }

    #[test]
    fn test_arr_descending_null_mixed_with_strings_does_not_panic() {
        call_arr_descending(r#"[null,"a","b"]"#);
    }

    #[test]
    fn test_arr_descending_large_shuffled_mixed_type_array_does_not_panic() {
        use rand::prelude::SliceRandom;

        let mut values: Vec<json::Value> = Vec::with_capacity(200);
        for i in 0..200 {
            values.push(match i % 7 {
                0 => json::Value::from(i as i64),
                1 => json::Value::from(i as f64 + 0.5),
                2 => json::Value::from(format!("s{i}")),
                3 => json::Value::Bool(i % 2 == 0),
                4 => json::Value::Null,
                // arbitrary_precision numbers with no f64 representation, one per sign.
                5 => json::from_str::<json::Value>(&format!("{i}e400")).unwrap(),
                _ => json::from_str::<json::Value>(&format!("-{i}e400")).unwrap(),
            });
        }
        values.shuffle(&mut rand::rng());
        let json_array = json::to_string(&values).unwrap();
        call_arr_descending(&json_array);
    }

    #[test]
    fn test_arr_descending_with_overflow_numbers_is_deterministic_and_ordered() {
        let result = call_arr_descending(r#"[1e400,-1e400,100.0,50,2e300,-3]"#);
        assert_eq!(result, "[1e+400,2e+300,100.0,50,-3,-1e+400]");

        let result2 = call_arr_descending(r#"[50,-1e400,2e300,-3,1e400,100.0]"#);
        assert_eq!(result, result2);
    }
}
