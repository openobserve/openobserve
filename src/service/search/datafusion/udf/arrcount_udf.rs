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

use arrow::array::UInt64Array;
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

/// The name of the arrcount UDF given to DataFusion.
pub const ARR_COUNT_UDF_NAME: &str = "arrcount";

/// Implementation of arrcount
pub(crate) static ARR_COUNT_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        ARR_COUNT_UDF_NAME,
        // expects two string - the field and the delimiter
        vec![DataType::Utf8],
        // returns string
        DataType::UInt64,
        Volatility::Immutable,
        Arc::new(arr_count_impl),
    )
});

/// arrcount function for datafusion
pub fn arr_count_impl(args: &[ColumnarValue]) -> datafusion::error::Result<ColumnarValue> {
    log::debug!("Inside arrcount");
    if args.len() != 1 {
        return Err(DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "UDF params should be: arrcount(arr_field)".to_string(),
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
            arr_field
                .and_then(|arr_field| {
                    json::from_str::<json::Value>(arr_field)
                        .ok()
                        .and_then(|arr_field| arr_field.as_array().map(|arr| arr.len() as u64))
                        .or(Some(0))
                })
                .or(Some(0))
        })
        .collect::<UInt64Array>();

    // `Ok` because no error occurred during the calculation
    // `Arc` because arrays are immutable, thread-safe, trait objects.
    Ok(ColumnarValue::from(Arc::new(array) as ArrayRef))
}

#[cfg(test)]
mod tests {
    use arrow::array::StringArray;
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

    #[tokio::test]
    async fn test_arr_count_udf() {
        let sqls = [
            (
                "select arrcount(bools) as ret from t",
                ["+-----+", "| ret |", "+-----+", "| 3   |", "+-----+"],
            ),
            (
                "select arrcount(names) as ret from t",
                ["+-----+", "| ret |", "+-----+", "| 3   |", "+-----+"],
            ),
            (
                "select arrcount(nums) as ret from t",
                ["+-----+", "| ret |", "+-----+", "| 4   |", "+-----+"],
            ),
            (
                "select arrcount(floats) as ret from t",
                ["+-----+", "| ret |", "+-----+", "| 4   |", "+-----+"],
            ),
            (
                "select arrcount(mixed) as ret from t",
                ["+-----+", "| ret |", "+-----+", "| 5   |", "+-----+"],
            ),
        ];

        // define a schema.
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("bools", DataType::Utf8, false),
            Field::new("names", DataType::Utf8, false),
            Field::new("nums", DataType::Utf8, false),
            Field::new("floats", DataType::Utf8, false),
            Field::new("mixed", DataType::Utf8, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["a"])),
                Arc::new(StringArray::from(vec!["[true,false,true]"])),
                Arc::new(StringArray::from(vec!["[\"hello2\",\"hi2\",\"bye2\"]"])),
                Arc::new(StringArray::from(vec!["[12, 345, 23, 45]"])),
                Arc::new(StringArray::from(vec!["[1.9, 34.5, 2.6, 4.5]"])),
                Arc::new(StringArray::from(vec![
                    "[\"hello2\",\"hi2\",123, 23.90, false]",
                ])),
            ],
        )
        .unwrap();

        // declare a new context. In spark API, this corresponds to a new spark
        // SQLsession
        let ctx = SessionContext::new();
        ctx.register_udf(ARR_COUNT_UDF.clone());

        // declare a table in memory. In spark API, this corresponds to
        // createDataFrame(...).
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }

        // Test invalid JSON input - should return 0 instead of panicking
        let invalid_sqls = [(
            "select arrcount(invalid_json) as ret from t",
            ["+-----+", "| ret |", "+-----+", "| 0   |", "+-----+"],
        )];

        // Add invalid JSON column to schema
        let schema_with_invalid = Arc::new(Schema::new(vec![Field::new(
            "invalid_json",
            DataType::Utf8,
            false,
        )]));

        let batch_with_invalid = RecordBatch::try_new(
            schema_with_invalid.clone(),
            vec![Arc::new(StringArray::from(vec!["not json"]))],
        )
        .unwrap();

        let ctx_invalid = SessionContext::new();
        ctx_invalid.register_udf(ARR_COUNT_UDF.clone());
        let provider_invalid =
            MemTable::try_new(schema_with_invalid, vec![vec![batch_with_invalid]]).unwrap();
        ctx_invalid
            .register_table("t", Arc::new(provider_invalid))
            .unwrap();

        for item in invalid_sqls {
            let df = ctx_invalid.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    #[tokio::test]
    async fn test_arr_count_edge_cases() {
        // Test cases that should return 0
        let edge_cases = [
            r#"[]"#,
            r#"{"key": "value"}"#,
            r#""just a string""#,
            r#"42"#,
            r#"true"#,
            r#"null"#,
        ];

        for json_input in edge_cases {
            let sql = "select arrcount(test_col) as ret from t";
            let expected = ["+-----+", "| ret |", "+-----+", "| 0   |", "+-----+"];

            let schema = Arc::new(Schema::new(vec![Field::new(
                "test_col",
                DataType::Utf8,
                false,
            )]));
            let batch = RecordBatch::try_new(
                schema.clone(),
                vec![Arc::new(StringArray::from(vec![json_input]))],
            )
            .unwrap();

            let ctx = SessionContext::new();
            ctx.register_udf(ARR_COUNT_UDF.clone());
            let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
            ctx.register_table("t", Arc::new(provider)).unwrap();

            let df = ctx.sql(sql).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(expected, &data);
        }
    }

    #[tokio::test]
    async fn test_arr_count_null_input() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "test_col",
            DataType::Utf8,
            true,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec![None::<String>]))],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_COUNT_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx
            .sql("select arrcount(test_col) as ret from t")
            .await
            .unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(
            ["+-----+", "| ret |", "+-----+", "| 0   |", "+-----+"],
            &data
        );
    }

    #[tokio::test]
    async fn test_arr_count_multiple_rows() {
        let inputs = vec![
            r#"["a", "b", "c"]"#,  // valid array - should return 3
            r#"[]"#,               // empty array - should return 0
            r#"not json"#,         // invalid JSON - should return 0
            r#"["x", "y"]"#,       // valid array - should return 2
            r#"{"key": "value"}"#, // object - should return 0
        ];

        let schema = Arc::new(Schema::new(vec![Field::new(
            "test_col",
            DataType::Utf8,
            false,
        )]));
        let batch = RecordBatch::try_new(schema.clone(), vec![Arc::new(StringArray::from(inputs))])
            .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_COUNT_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx
            .sql("select arrcount(test_col) as ret from t")
            .await
            .unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(
            [
                "+-----+", "| ret |", "+-----+", "| 3   |", "| 0   |", "| 0   |", "| 2   |",
                "| 0   |", "+-----+",
            ],
            &data
        );
    }

    #[tokio::test]
    async fn test_arr_count_wrong_arguments() {
        let ctx = SessionContext::new();
        ctx.register_udf(ARR_COUNT_UDF.clone());

        // Test with no arguments
        let result = ctx.sql("select arrcount() as ret").await;
        assert!(result.is_err());

        // Test with multiple arguments
        let result = ctx.sql("select arrcount('a', 'b') as ret").await;
        assert!(result.is_err());
    }
}
