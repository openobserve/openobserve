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

use datafusion::{
    arrow::{
        array::{ArrayRef, BooleanArray},
        datatypes::DataType,
    },
    common::cast::as_string_array,
    error::{DataFusionError, Result},
    logical_expr::{
        ColumnarValue, ScalarFunctionArgs, ScalarUDF, ScalarUDFImpl, Signature, Volatility,
    },
    scalar::ScalarValue,
    sql::sqlparser::parser::ParserError,
};

/// Implementation of str_match
pub static STR_MATCH_UDF: Lazy<ScalarUDF> = Lazy::new(|| ScalarUDF::from(StrMatchUdf::new()));

/// Implementation of str_match_ignore_case
pub static STR_MATCH_IGNORE_CASE_UDF: Lazy<ScalarUDF> =
    Lazy::new(|| ScalarUDF::from(StrMatchIgnoreCaseUdf::new()));

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct StrMatchUdf {
    signature: Signature,
}

impl StrMatchUdf {
    fn new() -> Self {
        Self {
            signature: Signature::exact(vec![DataType::Utf8, DataType::Utf8], Volatility::Stable),
        }
    }
}

impl ScalarUDFImpl for StrMatchUdf {
    fn name(&self) -> &str {
        super::STR_MATCH_UDF_NAME
    }

    fn aliases(&self) -> &[String] {
        static ALIASES: Lazy<Vec<String>> =
            Lazy::new(|| vec![super::MATCH_FIELD_UDF_NAME.to_string()]);
        &ALIASES
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(DataType::Boolean)
    }

    fn invoke_with_args(&self, args: ScalarFunctionArgs) -> Result<ColumnarValue> {
        str_match_impl(&args.args, false)
    }
}

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct StrMatchIgnoreCaseUdf {
    signature: Signature,
}

impl StrMatchIgnoreCaseUdf {
    fn new() -> Self {
        Self {
            signature: Signature::exact(vec![DataType::Utf8, DataType::Utf8], Volatility::Stable),
        }
    }
}

impl ScalarUDFImpl for StrMatchIgnoreCaseUdf {
    fn name(&self) -> &str {
        super::STR_MATCH_UDF_IGNORE_CASE_NAME
    }

    fn aliases(&self) -> &[String] {
        static ALIASES: Lazy<Vec<String>> =
            Lazy::new(|| vec![super::MATCH_FIELD_IGNORE_CASE_UDF_NAME.to_string()]);
        &ALIASES
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(DataType::Boolean)
    }

    fn invoke_with_args(&self, args: ScalarFunctionArgs) -> Result<ColumnarValue> {
        str_match_impl(&args.args, true)
    }
}

fn str_match_impl(args: &[ColumnarValue], case_insensitive: bool) -> Result<ColumnarValue> {
    if args.len() != 2 {
        return Err(DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "str_match UDF expects two string".to_string(),
            )),
            None,
        ));
    }

    // Parquet pushdown replaces constant or missing columns with scalars.
    let haystack = args[0].clone().into_array(1)?;
    let haystack = as_string_array(&haystack)?;
    let ColumnarValue::Scalar(needle) = &args[1] else {
        return Err(DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "Invalid argument types[needle] to str_match function".to_string(),
            )),
            None,
        ));
    };
    let mut needle = match needle {
        ScalarValue::Utf8(v) => v,
        ScalarValue::Utf8View(v) => v,
        ScalarValue::LargeUtf8(v) => v,
        _ => {
            return Err(DataFusionError::SQL(
                Box::new(ParserError::ParserError(
                    "Invalid argument types[needle] to str_match function".to_string(),
                )),
                None,
            ));
        }
    }
    .as_ref()
    .ok_or_else(|| {
        DataFusionError::SQL(
            Box::new(ParserError::ParserError(
                "Invalid argument types[needle] to str_match function".to_string(),
            )),
            None,
        )
    })?
    .to_string();

    // pre-compute the needle
    if case_insensitive {
        needle.make_ascii_lowercase();
    };

    let mem_finder = memchr::memmem::Finder::new(needle.as_bytes());

    // 2. perform the computation
    let array = haystack
        .iter()
        .map(|haystack| {
            haystack.map(|haystack| {
                if case_insensitive {
                    mem_finder
                        .find(haystack.to_lowercase().as_bytes())
                        .is_some()
                } else {
                    mem_finder.find(haystack.as_bytes()).is_some()
                }
            })
        })
        .collect::<BooleanArray>();

    // `Ok` because no error occurred during the calculation
    // `Arc` because arrays are immutable, thread-safe, trait objects.
    Ok(ColumnarValue::from(Arc::new(array) as ArrayRef))
}

#[cfg(test)]
mod tests {
    use std::fs::File;

    use arrow::array::StringArray;
    use datafusion::{
        arrow::{
            array::Int64Array,
            datatypes::{Field, Schema},
            record_batch::RecordBatch,
        },
        datasource::MemTable,
        prelude::{ParquetReadOptions, SessionConfig, SessionContext},
    };
    use parquet::arrow::ArrowWriter;

    use super::*;
    use crate::datafusion::exec::register_builtin_udfs;

    #[test]
    fn test_str_match_udf_name() {
        let udf = StrMatchUdf::new();
        assert_eq!(udf.name(), super::super::STR_MATCH_UDF_NAME);
    }

    #[test]
    fn test_str_match_udf_return_type_is_boolean() {
        let udf = StrMatchUdf::new();
        let rt = udf.return_type(&[]).unwrap();
        assert_eq!(rt, DataType::Boolean);
    }

    #[test]
    fn test_str_match_ignore_case_udf_name() {
        let udf = StrMatchIgnoreCaseUdf::new();
        assert_eq!(udf.name(), super::super::STR_MATCH_UDF_IGNORE_CASE_NAME);
    }

    #[test]
    fn test_str_match_ignore_case_return_type_is_boolean() {
        let udf = StrMatchIgnoreCaseUdf::new();
        let rt = udf.return_type(&[]).unwrap();
        assert_eq!(rt, DataType::Boolean);
    }

    #[test]
    fn test_str_match_udf_aliases_include_match_field() {
        let udf = StrMatchUdf::new();
        let aliases = udf.aliases();
        assert!(
            aliases
                .iter()
                .any(|a| a == super::super::MATCH_FIELD_UDF_NAME)
        );
    }

    #[tokio::test]
    async fn test_str_match_udf() {
        let sql = vec![
            "select * from t where str_match(log, 'es') and str_match_ignore_case(city, 'be')",
            "select * from t where str_match(log, 'es') and str_match_ignore_case(city, 'BE')",
            "select * from t where str_match(log, 'es') and str_match_ignore_case(city, '')",
            "select * from t where match_field(log, 'es') and match_field_ignore_case(city, 'be')",
            "select * from t where match_field(log, 'es') and match_field_ignore_case(city, 'BE')",
            "select * from t where match_field(log, 'es') and match_field_ignore_case(city, '')",
        ];

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
                Arc::new(StringArray::from(vec!["this", "is", "a", "test"])),
                Arc::new(Int64Array::from(vec![1, 2, 3, 4])),
                Arc::new(StringArray::from(vec![
                    "New York",
                    "Pune",
                    "San Francisco",
                    "Beijing",
                ])),
            ],
        )
        .unwrap();

        // declare a new context. In spark API, this corresponds to a new spark
        // SQLsession
        let ctx = SessionContext::new();
        ctx.register_udf(STR_MATCH_UDF.clone());
        ctx.register_udf(STR_MATCH_IGNORE_CASE_UDF.clone());

        // declare a table in memory. In spark API, this corresponds to
        // createDataFrame(...).
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        for sql in sql {
            let df = ctx.sql(sql).await.unwrap();
            let result = df.collect().await.unwrap();
            let count = result.iter().map(|batch| batch.num_rows()).sum::<usize>();
            assert!(count > 0);
        }
    }

    #[test]
    fn test_str_match_impl_wrong_arg_count_errors() {
        let result = str_match_impl(&[], false);
        assert!(result.is_err());
    }

    #[test]
    fn test_str_match_impl_direct_match() {
        use datafusion::common::ScalarValue;
        let haystack = Arc::new(StringArray::from(vec!["hello world", "foo bar"]));
        let args = [
            ColumnarValue::Array(haystack),
            ColumnarValue::Scalar(ScalarValue::Utf8(Some("world".to_string()))),
        ];
        let result = str_match_impl(&args, false).unwrap();
        if let ColumnarValue::Array(out) = result {
            use arrow::array::{Array, BooleanArray};
            let out = out.as_any().downcast_ref::<BooleanArray>().unwrap();
            assert!(out.value(0));
            assert!(!out.value(1));
        } else {
            panic!("expected array result");
        }
    }

    #[test]
    fn test_str_match_impl_case_insensitive() {
        use datafusion::common::ScalarValue;
        let haystack = Arc::new(StringArray::from(vec!["Hello World"]));
        let args = [
            ColumnarValue::Array(haystack),
            ColumnarValue::Scalar(ScalarValue::Utf8(Some("world".to_string()))),
        ];
        let result = str_match_impl(&args, true).unwrap();
        if let ColumnarValue::Array(out) = result {
            use arrow::array::{Array, BooleanArray};
            let out = out.as_any().downcast_ref::<BooleanArray>().unwrap();
            assert!(out.value(0));
        } else {
            panic!("expected array result");
        }
    }

    fn context(pushdown: bool) -> SessionContext {
        let config = SessionConfig::new()
            .set_bool("datafusion.execution.parquet.pushdown_filters", pushdown);
        let ctx = SessionContext::new_with_config(config);
        register_builtin_udfs(&ctx);
        ctx
    }

    async fn booleans(ctx: &SessionContext, sql: &str) -> Vec<Option<bool>> {
        ctx.sql(sql)
            .await
            .unwrap()
            .collect()
            .await
            .unwrap()
            .iter()
            .flat_map(|batch| {
                batch
                    .column(0)
                    .as_any()
                    .downcast_ref::<BooleanArray>()
                    .unwrap()
                    .iter()
            })
            .collect()
    }

    #[tokio::test]
    async fn test_str_match_scalar_haystack() {
        let ctx = context(true);
        for name in [
            "str_match",
            "str_match_ignore_case",
            "match_field",
            "match_field_ignore_case",
        ] {
            for (haystack, needle, expected) in [
                ("'gateway'", "'gate'", Some(true)),
                ("'other'", "'gate'", Some(false)),
                ("'gateway'", "''", Some(true)),
                ("''", "'gateway'", Some(false)),
                ("CAST(NULL AS VARCHAR)", "'gateway'", None),
            ] {
                let sql = format!("SELECT {name}({haystack}, {needle})");
                assert_eq!(booleans(&ctx, &sql).await, vec![expected], "{sql}");
            }
            let expected = name.contains("ignore_case");
            let sql = format!("SELECT {name}('Gateway', 'GATEWAY')");
            assert_eq!(booleans(&ctx, &sql).await, vec![Some(expected)], "{sql}");
        }
    }

    #[tokio::test]
    async fn test_parquet_pushdown_constant_null_and_missing_columns() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("level", DataType::Utf8, true),
            Field::new("job", DataType::Utf8, true),
        ]));
        for (case, jobs, expected) in [
            ("constant", Some(vec![Some("gateway"), Some("gateway")]), 2),
            ("mixed", Some(vec![Some("gateway"), Some("other")]), 1),
            ("nullable", Some(vec![Some("gateway"), None]), 1),
            ("null", Some(vec![None, None]), 0),
            ("missing", None, 0),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("data.parquet");
            let mut columns: Vec<ArrayRef> =
                vec![Arc::new(StringArray::from(vec!["info", "error"]))];
            let file_schema = if let Some(jobs) = jobs {
                columns.push(Arc::new(StringArray::from(jobs)));
                schema.clone()
            } else {
                Arc::new(Schema::new(vec![schema.field(0).clone()]))
            };
            let batch = RecordBatch::try_new(file_schema.clone(), columns).unwrap();
            let mut writer =
                ArrowWriter::try_new(File::create(&path).unwrap(), file_schema, None).unwrap();
            writer.write(&batch).unwrap();
            writer.close().unwrap();
            for pushdown in [false, true] {
                let ctx = context(pushdown);
                ctx.register_parquet(
                    "gateway",
                    path.to_str().unwrap(),
                    ParquetReadOptions::default().schema(&schema),
                )
                .await
                .unwrap();
                for predicate in [
                    "str_match(job, 'gateway')",
                    "str_match_ignore_case(job, 'GATEWAY')",
                    "match_field(job, 'gateway')",
                    "match_field_ignore_case(job, 'GATEWAY')",
                    "re_match(job, '^gateway$')",
                    "re_not_match(job, '^other$')",
                    "array_length(re_matches(job, '(gateway)')) > 0",
                ] {
                    let sql = format!("SELECT level FROM gateway WHERE {predicate} GROUP BY level");
                    let batches = ctx
                        .sql(&sql)
                        .await
                        .unwrap()
                        .collect()
                        .await
                        .unwrap_or_else(|err| panic!("{case}, pushdown={pushdown}, {sql}: {err}"));
                    let count: usize = batches.iter().map(|batch| batch.num_rows()).sum();
                    assert_eq!(count, expected, "{case}, pushdown={pushdown}, {sql}");
                }
            }
        }
    }
}
