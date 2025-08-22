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

use arrow::array::StringArray;
use arrow_schema::Field;
use config::utils::json;
use datafusion::{
    arrow::{array::ArrayRef, datatypes::DataType},
    common::cast::{as_generic_list_array, as_generic_string_array},
    error::DataFusionError,
    logical_expr::{ColumnarValue, ScalarUDF, Volatility},
    prelude::create_udf,
    sql::sqlparser::parser::ParserError,
};
use once_cell::sync::Lazy;

/// The name of the to_array_string UDF given to DataFusion.
pub const TO_ARR_STRING_UDF_NAME: &str = "to_array_string";

/// Implementation of to_array_string
pub(crate) static TO_ARR_STRING: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        TO_ARR_STRING_UDF_NAME,
        // takes one argument: the field
        vec![DataType::List(Arc::new(Field::new(
            "item",
            DataType::Utf8,
            true,
        )))],
        DataType::Utf8,
        Volatility::Immutable,
        Arc::new(to_arr_string_impl),
    )
});

/// to_array_string function for datafusion
/// Converts a datafusion array into a json array string (all the array elements are also
/// stringified)
pub fn to_arr_string_impl(args: &[ColumnarValue]) -> datafusion::error::Result<ColumnarValue> {
    let args = ColumnarValue::values_to_arrays(args)?;
    log::debug!("Inside cast_to_arr_impl");
    if args.len() != 1 {
        return Err(DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "UDF params should be: to_array_string(array)".to_string(),
            )),
            None,
        ));
    }

    let list_array = as_generic_list_array::<i32>(&args[0])?;

    let array = list_array
        .iter()
        .map(|array| {
            array.and_then(|string_array| {
                as_generic_string_array::<i32>(&string_array)
                    .ok()
                    .and_then(|string_array| {
                        let arr: Vec<String> = string_array
                            .iter()
                            .filter_map(|string| string.map(|s| s.to_string()))
                            .collect();
                        json::to_string(&arr).ok()
                    })
            })
        })
        .collect::<StringArray>();

    Ok(ColumnarValue::from(Arc::new(array) as ArrayRef))
}

#[cfg(test)]
mod tests {
    use datafusion::{assert_batches_eq, prelude::SessionContext};

    use super::*;

    #[tokio::test]
    async fn test_to_array_string_valid_arrays() {
        let sqls = [
            (
                "select to_array_string(range(0, 3)) as ret",
                vec![
                    "+---------------+",
                    "| ret           |",
                    "+---------------+",
                    r#"| ["0","1","2"] |"#,
                    "+---------------+",
                ],
            ),
            (
                "select to_array_string(range(0, 0)) as ret",
                vec!["+-----+", "| ret |", "+-----+", "| []  |", "+-----+"],
            ),
            (
                "select to_array_string(array['a', 'b', 'c']) as ret",
                vec![
                    "+---------------+",
                    "| ret           |",
                    "+---------------+",
                    r#"| ["a","b","c"] |"#,
                    "+---------------+",
                ],
            ),
            (
                "select to_array_string(array[1, 2, 3]) as ret",
                vec![
                    "+---------------+",
                    "| ret           |",
                    "+---------------+",
                    r#"| ["1","2","3"] |"#,
                    "+---------------+",
                ],
            ),
            (
                "select to_array_string(array[1.5, 2.7, 3.9]) as ret",
                vec![
                    "+---------------------+",
                    "| ret                 |",
                    "+---------------------+",
                    r#"| ["1.5","2.7","3.9"] |"#,
                    "+---------------------+",
                ],
            ),
            (
                "select to_array_string(array[true, false, true]) as ret",
                vec![
                    "+-------------------------+",
                    "| ret                     |",
                    "+-------------------------+",
                    r#"| ["true","false","true"] |"#,
                    "+-------------------------+",
                ],
            ),
        ];

        let ctx = SessionContext::new();
        ctx.register_udf(TO_ARR_STRING.clone());

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    #[tokio::test]
    async fn test_to_array_string_null_input() {
        let sql = "select to_array_string(null) as ret";
        let expected_output = ["+-----+", "| ret |", "+-----+", "|     |", "+-----+"];

        let ctx = SessionContext::new();
        ctx.register_udf(TO_ARR_STRING.clone());

        let df = ctx.sql(sql).await.unwrap();
        let data = df.collect().await.unwrap();
        assert_batches_eq!(expected_output, &data);
    }

    #[tokio::test]
    async fn test_to_array_string_wrong_arguments() {
        let ctx = SessionContext::new();
        ctx.register_udf(TO_ARR_STRING.clone());

        // Test with no arguments
        let result = ctx.sql("select to_array_string() as ret").await;
        assert!(result.is_err());

        // Test with multiple arguments
        let result = ctx.sql("select to_array_string('a', 'b') as ret").await;
        assert!(result.is_err());
    }
}
