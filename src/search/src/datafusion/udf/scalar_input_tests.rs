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

use std::{fs::File, sync::Arc};

use arrow::{
    array::{Array, ArrayRef, BooleanArray, LargeStringArray, StringArray},
    datatypes::{DataType, Field, Schema},
    record_batch::RecordBatch,
};
use datafusion::{
    datasource::MemTable,
    prelude::{ParquetReadOptions, SessionConfig, SessionContext},
};
use parquet::arrow::ArrowWriter;

use super::{
    regexp_matches_udf::REGEX_MATCHES_UDF,
    regexp_udf::{REGEX_MATCH_UDF, REGEX_NOT_MATCH_UDF, REGEXP_MATCH_TO_FIELDS_UDF},
    str_match_udf::{STR_MATCH_IGNORE_CASE_UDF, STR_MATCH_UDF},
};

fn context(pushdown: bool) -> SessionContext {
    let config =
        SessionConfig::new().set_bool("datafusion.execution.parquet.pushdown_filters", pushdown);
    let ctx = SessionContext::new_with_config(config);
    for udf in [
        &*STR_MATCH_UDF,
        &*STR_MATCH_IGNORE_CASE_UDF,
        &*REGEX_MATCH_UDF,
        &*REGEX_NOT_MATCH_UDF,
        &*REGEX_MATCHES_UDF,
        &*REGEXP_MATCH_TO_FIELDS_UDF,
    ] {
        ctx.register_udf(udf.clone());
    }
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
async fn string_predicates_accept_scalar_and_null_inputs() {
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
            ("'gateway'", "CAST(NULL AS VARCHAR)", None),
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
async fn parquet_predicates_handle_constant_null_and_missing_columns() {
    let schema = Arc::new(Schema::new(vec![
        Field::new("level", DataType::Utf8, true),
        Field::new("job", DataType::Utf8, true),
    ]));
    // Test each file independently so a constant-column failure cannot mask
    // the missing-column or all-NULL path.
    for (case, jobs, expected) in [
        ("constant", Some(vec![Some("gateway"), Some("gateway")]), 2),
        ("mixed", Some(vec![Some("gateway"), Some("other")]), 1),
        ("nullable", Some(vec![Some("gateway"), None]), 1),
        ("null", Some(vec![None, None]), 0),
        ("missing", None, 0),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.parquet");
        let mut columns: Vec<ArrayRef> = vec![Arc::new(StringArray::from(vec!["info", "error"]))];
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
                "(regexp_match_to_fields(job, '(?P<name>gateway)'))['name'] = 'gateway'",
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

#[tokio::test]
async fn regexp_matches_null_pattern_is_independent_of_batch_size() {
    let ctx = context(true);
    assert_eq!(
        booleans(
            &ctx,
            "SELECT re_matches('gateway', CAST(NULL AS VARCHAR)) IS NULL"
        )
        .await,
        vec![Some(true)]
    );
    for rows in [0, 1, 2] {
        let schema = Arc::new(Schema::new(vec![Field::new("job", DataType::Utf8, true)]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(StringArray::from(vec!["gateway"; rows]))],
        )
        .unwrap();
        ctx.register_table(
            "t",
            Arc::new(MemTable::try_new(schema, vec![vec![batch]]).unwrap()),
        )
        .unwrap();
        assert_eq!(
            booleans(
                &ctx,
                "SELECT re_matches(job, CAST(NULL AS VARCHAR)) IS NULL FROM t"
            )
            .await,
            vec![Some(true); rows]
        );
        ctx.deregister_table("t").unwrap();
    }
}

#[tokio::test]
async fn regexp_fields_preserve_rows_and_optional_captures() {
    let ctx = context(true);
    // The unnamed prefix must not displace either named field. The optional
    // first named group must not shift the second group when it is absent.
    let pattern = "(prefix)?(?P<first>a)?(?P<last>b)";
    for data_type in [DataType::Utf8, DataType::LargeUtf8] {
        for values in [
            vec![],
            vec![Some("ab"), Some("b"), None, Some("other"), Some("prefixab")],
        ] {
            let schema = Arc::new(Schema::new(vec![Field::new(
                "job",
                data_type.clone(),
                true,
            )]));
            let column: ArrayRef = match data_type {
                DataType::Utf8 => Arc::new(StringArray::from(values.clone())),
                _ => Arc::new(LargeStringArray::from(values.clone())),
            };
            let batch = RecordBatch::try_new(schema.clone(), vec![column]).unwrap();
            ctx.register_table(
                "t",
                Arc::new(MemTable::try_new(schema, vec![vec![batch]]).unwrap()),
            )
            .unwrap();
            let sql = format!(
                "SELECT (regexp_match_to_fields(job, '{pattern}'))['first'] AS first, (regexp_match_to_fields(job, '{pattern}'))['last'] AS last FROM t"
            );
            let batches = ctx.sql(&sql).await.unwrap().collect().await.unwrap();
            let mut actual = Vec::new();
            for batch in batches {
                for i in 0..batch.num_rows() {
                    let row: Vec<_> = batch
                        .columns()
                        .iter()
                        .map(|column| {
                            if column.is_null(i) {
                                None
                            } else {
                                Some(match data_type {
                                    DataType::Utf8 => column
                                        .as_any()
                                        .downcast_ref::<StringArray>()
                                        .unwrap()
                                        .value(i)
                                        .to_owned(),
                                    _ => column
                                        .as_any()
                                        .downcast_ref::<LargeStringArray>()
                                        .unwrap()
                                        .value(i)
                                        .to_owned(),
                                })
                            }
                        })
                        .collect();
                    actual.push(row);
                }
            }
            let expected: Vec<Vec<Option<String>>> = if values.is_empty() {
                vec![]
            } else {
                vec![
                    vec![Some("a"), Some("b")],
                    vec![None, Some("b")],
                    vec![None, None],
                    vec![None, None],
                    vec![Some("a"), Some("b")],
                ]
                .into_iter()
                .map(|row| row.into_iter().map(|s| s.map(str::to_owned)).collect())
                .collect()
            };
            assert_eq!(actual, expected, "{data_type:?}");
            ctx.deregister_table("t").unwrap();
        }
    }
    for (value, expected) in [
        ("'ab'", false),
        ("'b'", true),
        ("'other'", true),
        ("CAST(NULL AS VARCHAR)", true),
    ] {
        let sql = format!("SELECT (regexp_match_to_fields({value}, '{pattern}'))['first'] IS NULL");
        assert_eq!(booleans(&ctx, &sql).await, vec![Some(expected)], "{sql}");
    }
}

#[tokio::test]
async fn regexp_fields_preserve_literal_quotes() {
    let ctx = context(true);
    let sql =
        r#"SELECT (regexp_match_to_fields('"gateway"', '"(?P<name>[^"]+)"'))['name'] = 'gateway'"#;
    assert_eq!(booleans(&ctx, sql).await, vec![Some(true)]);
    let sql = r#"SELECT (regexp_match_to_fields('gateway', '"(?P<name>[^"]+)"'))['name'] IS NULL"#;
    assert_eq!(booleans(&ctx, sql).await, vec![Some(true)]);
}
