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

use arrow::datatypes::ArrowNativeType;
use config::utils::json;
use datafusion::{
    arrow::{
        array::{ArrayRef, StringArray},
        datatypes::DataType,
    },
    common::cast::{as_int64_array, as_string_array},
    error::DataFusionError,
    logical_expr::{ColumnarValue, ScalarUDF, Volatility},
    prelude::create_udf,
    sql::sqlparser::parser::ParserError,
};
use once_cell::sync::Lazy;

/// The name of the arrindex UDF given to DataFusion.
pub const ARR_INDEX_UDF_NAME: &str = "arrindex";

/// Implementation of arrindex
pub(crate) static ARR_INDEX_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        ARR_INDEX_UDF_NAME,
        // expects a string (the array field) and two integers - start index and end index
        vec![DataType::Utf8, DataType::Int64, DataType::Int64],
        // returns string
        DataType::Utf8,
        Volatility::Immutable,
        Arc::new(arr_index_impl),
    )
});

/// arrindex function for datafusion
pub fn arr_index_impl(args: &[ColumnarValue]) -> datafusion::error::Result<ColumnarValue> {
    log::debug!("Inside arrindex");
    if args.len() < 2 {
        return Err(DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "UDF params should be: arrindex(field1, start, end)".to_string(),
            )),
            None,
        ));
    }
    let args = ColumnarValue::values_to_arrays(args)?;
    // log::debug!("Got the args: {:#?}", args);

    // 1. cast both arguments to be aligned with the signature
    let arr_field1 = as_string_array(&args[0])?;
    let start = as_int64_array(&args[1])?;
    let end = if args.len() == 3 {
        let end = as_int64_array(&args[2])?;
        if !end.is_empty() {
            Some(end.value(0))
        } else {
            None
        }
    } else {
        None
    };

    // 2. perform the computation
    let array = zip(arr_field1.iter(), start.iter())
        .map(|(arr_field1, start)| {
            match (arr_field1, start) {
                (Some(arr_field1), Some(start)) => {
                    let start = start as usize;
                    json::from_str::<json::Value>(arr_field1)
                        .ok()
                        .and_then(|arr_field1| {
                            if let json::Value::Array(field1) = arr_field1 {
                                let mut index_arrs: Vec<json::Value> = vec![];
                                if field1.len() > start {
                                    if let Some(end) = end {
                                        // end is min(end, field1.len)
                                        let end = if end.as_usize() < field1.len() {
                                            end as usize
                                        } else {
                                            field1.len() - 1
                                        };
                                        if start <= end && end < field1.len() {
                                            for item in field1.into_iter().take(end + 1).skip(start)
                                            {
                                                index_arrs.push(item);
                                            }
                                        }
                                        // If start > end or end >= field1.len(), index_arrs remains
                                        // empty
                                    } else {
                                        index_arrs.push(field1[start].clone());
                                    }
                                }
                                // If start >= field1.len(), index_arrs remains empty
                                // Always return the array, even if empty
                                json::to_string(&index_arrs).ok()
                            } else {
                                None
                            }
                        })
                }
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

    #[tokio::test]
    async fn test_arr_index_udf() {
        let sqls = [
            (
                // Should include values at index 0 to index 1 (inclusive)
                "select arrindex(bools, 0, 1) as ret from t",
                vec![
                    "+--------------+",
                    "| ret          |",
                    "+--------------+",
                    "| [true,false] |",
                    "+--------------+",
                ],
            ),
            (
                // Should include all the elements
                "select arrindex(names, 0, 6) as ret from t",
                vec![
                    "+-------------------------+",
                    "| ret                     |",
                    "+-------------------------+",
                    "| [\"hello2\",\"hi2\",\"bye2\"] |",
                    "+-------------------------+",
                ],
            ),
            (
                "select arrindex(nums, 1, 1) as ret from t",
                vec![
                    "+-------+",
                    "| ret   |",
                    "+-------+",
                    "| [345] |",
                    "+-------+",
                ],
            ),
            (
                "select arrindex(floats, 1, 3) as ret from t",
                vec![
                    "+----------------+",
                    "| ret            |",
                    "+----------------+",
                    "| [34.5,2.6,4.5] |",
                    "+----------------+",
                ],
            ),
            (
                "select arrindex(floats, 7, 9) as ret from t",
                vec!["+-----+", "| ret |", "+-----+", "| []  |", "+-----+"],
            ),
            (
                "select arrindex(mixed, 2, 4) as ret from t",
                vec![
                    "+------------------+",
                    "| ret              |",
                    "+------------------+",
                    "| [123,23.9,false] |",
                    "+------------------+",
                ],
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
                    "[\"hello2\",\"hi2\",123, 23.9, false]",
                ])),
            ],
        )
        .unwrap();

        // declare a new context. In spark API, this corresponds to a new spark
        // SQLsession
        let ctx = SessionContext::new();
        ctx.register_udf(ARR_INDEX_UDF.clone());

        // declare a table in memory. In spark API, this corresponds to
        // createDataFrame(...).
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    #[tokio::test]
    async fn test_arr_index_edge_cases() {
        // Test cases that should return null or empty arrays
        let edge_cases = [
            (r#"not json"#, 0, 1, "invalid JSON"),
            (r#"{"key": "value"}"#, 0, 1, "object"),
            (r#""just a string""#, 0, 1, "string"),
            (r#"42"#, 0, 1, "number"),
            (r#"true"#, 0, 1, "boolean"),
            (r#"null"#, 0, 1, "null"),
            (r#"[]"#, 0, 1, "empty array"),
        ];

        for (json_input, start, end, _test_name) in edge_cases {
            let sql = format!("select arrindex(test_col, {start}, {end}) as ret from t");
            // Empty arrays return [] instead of null, other invalid inputs return null
            let expected = if json_input == r#"[]"# {
                vec!["+-----+", "| ret |", "+-----+", "| []  |", "+-----+"]
            } else {
                vec!["+-----+", "| ret |", "+-----+", "|     |", "+-----+"]
            };

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
            ctx.register_udf(ARR_INDEX_UDF.clone());
            let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
            ctx.register_table("t", Arc::new(provider)).unwrap();

            let df = ctx.sql(&sql).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(expected, &data);
        }
    }

    #[tokio::test]
    async fn test_arr_index_null_input() {
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
        ctx.register_udf(ARR_INDEX_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx
            .sql("select arrindex(test_col, 0, 1) as ret from t")
            .await
            .unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(
            ["+-----+", "| ret |", "+-----+", "|     |", "+-----+"],
            &data
        );
    }

    #[tokio::test]
    async fn test_arr_index_wrong_arguments() {
        let ctx = SessionContext::new();
        ctx.register_udf(ARR_INDEX_UDF.clone());

        // Test with no arguments
        let result = ctx.sql("select arrindex() as ret").await;
        assert!(result.is_err());

        // Test with only one argument
        let result = ctx.sql("select arrindex('a') as ret").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_arr_index_invalid_json_no_panic() {
        // Test that invalid JSON doesn't cause a panic
        let schema = Arc::new(Schema::new(vec![Field::new(
            "test_col",
            DataType::Utf8,
            false,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec!["not json"]))],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(ARR_INDEX_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx
            .sql("select arrindex(test_col, 0, 1) as ret from t")
            .await
            .unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(
            ["+-----+", "| ret |", "+-----+", "|     |", "+-----+"],
            &data
        );
    }
}
