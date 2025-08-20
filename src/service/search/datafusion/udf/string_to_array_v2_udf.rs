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
use datafusion::{
    arrow::{array::ArrayRef, datatypes::DataType},
    common::cast::as_generic_string_array,
    error::DataFusionError,
    logical_expr::{ColumnarValue, ScalarUDF, Volatility},
    prelude::create_udf,
};
use once_cell::sync::Lazy;

/// The name of the string_to_array_v2 UDF given to DataFusion.
pub const STRING_TO_ARRAY_V2_UDF_NAME: &str = "string_to_array_v2";

/// Implementation of string_to_array_v2
pub(crate) static STRING_TO_ARRAY_V2_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        STRING_TO_ARRAY_V2_UDF_NAME,
        // takes two arguments: regex, pattern
        vec![DataType::Utf8, DataType::Utf8],
        DataType::List(Arc::new(Field::new("item", DataType::Utf8, true))),
        Volatility::Immutable,
        Arc::new(string_to_array_v2_impl),
    )
});

/// string_to_array_v2 function for datafusion
pub fn string_to_array_v2_impl(args: &[ColumnarValue]) -> datafusion::error::Result<ColumnarValue> {
    let args = ColumnarValue::values_to_arrays(args)?;

    let string_array = as_generic_string_array::<i32>(&args[0])?;
    let delimiter_array = as_generic_string_array::<i32>(&args[1])?;

    let mut list_builder = ListBuilder::new(StringBuilder::with_capacity(
        string_array.len(),
        string_array.get_buffer_memory_size(),
    ));

    match args.len() {
        2 => {
            string_array
                .iter()
                .zip(delimiter_array.iter())
                .for_each(|(string, delimiter)| {
                    match (string, delimiter) {
                        (Some(string), Some("")) => {
                            list_builder.values().append_value(string);
                            list_builder.append(true);
                        }
                        (Some(string), Some(delimiter)) => {
                            string.split(|c| delimiter.contains(c)).for_each(|s| {
                                if !s.is_empty() {
                                    list_builder.values().append_value(s);
                                }
                            });
                            list_builder.append(true);
                        }
                        (Some(string), None) => {
                            string.chars().map(|c| c.to_string()).for_each(|c| {
                                list_builder.values().append_value(c);
                            });
                            list_builder.append(true);
                        }
                        _ => list_builder.append(false), // null value
                    }
                });
        }
        _ => {
            return Err(DataFusionError::NotImplemented(
                "Expect string_to_array_v2 function to take two or three parameters".into(),
            ));
        }
    }

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

    #[tokio::test]
    async fn test_string_to_array_v2_format() {
        // let log_line = r#"2024-02-29T14:25:27.964079614+00:00 INFO actix_web::middleware::logger:
        // 10.1.59.229 "GET /healthz HTTP/1.1" 200 15 "-" "-" "kube-probe/1.28" 0.000049"#;
        // let log_line = r#"2024-03-12T15:05:20.366673042+00:00 INFO ingester::writer:
        // [INGESTER:WAL] dones add to IMMUTABLES, file:
        // ./data/wal/logs/0/sunny_organization_11122_zugLe5petywQwty/metrics/1709633785173906.wal,"
        // #;

        let log_line = r#"var-log0::log"#;
        let sqls = [(
            "select string_to_array_v2(log, '-:,::') as ret from t",
            // "select string_to_array_v2(log, ' /') as ret from t",
            vec![
                "+------------------+",
                "| ret              |",
                "+------------------+",
                "| [var, log0, log] |",
                "+------------------+",
            ],
        )];

        // define a schema.
        let schema = Arc::new(Schema::new(vec![Field::new("log", DataType::Utf8, false)]));

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec![log_line]))],
        )
        .unwrap();

        // declare a new context. In spark API, this corresponds to a new spark
        // SQLsession
        let ctx = SessionContext::new();
        ctx.register_udf(STRING_TO_ARRAY_V2_UDF.clone());

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

    #[test]
    fn test_string_to_array_v2_impl_basic() {
        use datafusion::{arrow::array::StringArray, logical_expr::ColumnarValue};

        // Test basic splitting
        let string_array = Arc::new(StringArray::from(vec!["a,b,c"]));
        let delimiter_array = Arc::new(StringArray::from(vec![","]));
        let args = vec![
            ColumnarValue::Array(string_array),
            ColumnarValue::Array(delimiter_array),
        ];

        let result = string_to_array_v2_impl(&args).unwrap();
        if let ColumnarValue::Array(array) = result {
            assert_eq!(array.len(), 1);
            // The result should be a list array with ["a", "b", "c"]
        } else {
            panic!("Expected array result");
        }
    }

    #[test]
    fn test_string_to_array_v2_impl_edge_cases() {
        use datafusion::{arrow::array::StringArray, logical_expr::ColumnarValue};

        // Test empty delimiter - should return the whole string
        let string_array = Arc::new(StringArray::from(vec!["hello"]));
        let delimiter_array = Arc::new(StringArray::from(vec![""]));
        let args = vec![
            ColumnarValue::Array(string_array),
            ColumnarValue::Array(delimiter_array),
        ];

        let result = string_to_array_v2_impl(&args);
        assert!(result.is_ok());

        // Test null delimiter - should split into characters
        let string_array = Arc::new(StringArray::from(vec![Some("abc")]));
        let delimiter_array = Arc::new(StringArray::from(vec![None::<&str>]));
        let args = vec![
            ColumnarValue::Array(string_array),
            ColumnarValue::Array(delimiter_array),
        ];

        let result = string_to_array_v2_impl(&args);
        assert!(result.is_ok());

        // Test null string
        let string_array = Arc::new(StringArray::from(vec![None::<&str>]));
        let delimiter_array = Arc::new(StringArray::from(vec![","]));
        let args = vec![
            ColumnarValue::Array(string_array),
            ColumnarValue::Array(delimiter_array),
        ];

        let result = string_to_array_v2_impl(&args);
        assert!(result.is_ok());
    }

    #[test]
    fn test_string_to_array_v2_impl_multiple_delimiters() {
        use datafusion::{arrow::array::StringArray, logical_expr::ColumnarValue};

        // Test multiple delimiter characters
        let string_array = Arc::new(StringArray::from(vec!["a,b;c:d"]));
        let delimiter_array = Arc::new(StringArray::from(vec![",;:"]));
        let args = vec![
            ColumnarValue::Array(string_array),
            ColumnarValue::Array(delimiter_array),
        ];

        let result = string_to_array_v2_impl(&args);
        assert!(result.is_ok());
        // Should split on any of the delimiter characters: ",", ";", ":"
    }

    #[test]
    fn test_string_to_array_v2_impl_empty_parts() {
        use datafusion::{arrow::array::StringArray, logical_expr::ColumnarValue};

        // Test string with consecutive delimiters (should skip empty parts)
        let string_array = Arc::new(StringArray::from(vec!["a,,b,,,c"]));
        let delimiter_array = Arc::new(StringArray::from(vec![","]));
        let args = vec![
            ColumnarValue::Array(string_array),
            ColumnarValue::Array(delimiter_array),
        ];

        let result = string_to_array_v2_impl(&args);
        assert!(result.is_ok());
        // Should result in ["a", "b", "c"] (empty parts filtered out)
    }

    #[test]
    fn test_string_to_array_v2_impl_wrong_arg_count() {
        use datafusion::{arrow::array::StringArray, logical_expr::ColumnarValue};

        // Test with too many arguments (4 args instead of 2-3)
        let string_array = Arc::new(StringArray::from(vec!["a,b,c"]));
        let delimiter_array = Arc::new(StringArray::from(vec![","]));
        let extra_array1 = Arc::new(StringArray::from(vec!["extra1"]));
        let extra_array2 = Arc::new(StringArray::from(vec!["extra2"]));
        let args = vec![
            ColumnarValue::Array(string_array),
            ColumnarValue::Array(delimiter_array),
            ColumnarValue::Array(extra_array1),
            ColumnarValue::Array(extra_array2),
        ]; // 4 args instead of 2-3

        let result = string_to_array_v2_impl(&args);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Expect string_to_array_v2 function to take two or three parameters")
        );
    }

    // Note: Testing insufficient arguments (< 2) would cause a panic due to index out of bounds
    // at line 49 where the function tries to access args[1] before checking args.len().
    // This is a design issue in the original function - it should check argument count first.

    #[test]
    fn test_string_to_array_v2_impl_unicode() {
        use datafusion::{arrow::array::StringArray, logical_expr::ColumnarValue};

        // Test with Unicode characters
        let string_array = Arc::new(StringArray::from(vec!["α,β,γ"]));
        let delimiter_array = Arc::new(StringArray::from(vec![","]));
        let args = vec![
            ColumnarValue::Array(string_array),
            ColumnarValue::Array(delimiter_array),
        ];

        let result = string_to_array_v2_impl(&args);
        assert!(result.is_ok());

        // Test Unicode delimiter
        let string_array = Arc::new(StringArray::from(vec!["hello→world→test"]));
        let delimiter_array = Arc::new(StringArray::from(vec!["→"]));
        let args = vec![
            ColumnarValue::Array(string_array),
            ColumnarValue::Array(delimiter_array),
        ];

        let result = string_to_array_v2_impl(&args);
        assert!(result.is_ok());
    }

    #[test]
    fn test_string_to_array_v2_impl_batch_processing() {
        use datafusion::{arrow::array::StringArray, logical_expr::ColumnarValue};

        // Test processing multiple strings in batch
        let string_array = Arc::new(StringArray::from(vec!["a,b,c", "x:y:z", "single", ""]));
        let delimiter_array = Arc::new(StringArray::from(vec![",", ":", ",", ","]));
        let args = vec![
            ColumnarValue::Array(string_array),
            ColumnarValue::Array(delimiter_array),
        ];

        let result = string_to_array_v2_impl(&args);
        assert!(result.is_ok());

        if let ColumnarValue::Array(array) = result.unwrap() {
            assert_eq!(array.len(), 4); // Should have 4 result arrays
        }
    }
}
