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

use datafusion::{
    arrow::{compute::can_cast_types, datatypes::DataType},
    common::{Result, ScalarValue, exec_datafusion_err, plan_err},
    logical_expr::type_coercion::binary::string_coercion,
};

/// Rebinds each `ArrayRef` ident to the concrete array of `$data_type`, then evaluates `$body`
/// once per string type, so `$body` can call a function generic over `StringArrayType`.
macro_rules! with_string_arrays {
    ($data_type:expr, [$($array:ident),+ $(,)?], $body:expr) => {{
        use ::datafusion::arrow::{array::AsArray as _, datatypes::DataType};
        match $data_type {
            DataType::Utf8 => {
                $(let $array = $array.as_string::<i32>();)+
                $body
            }
            DataType::LargeUtf8 => {
                $(let $array = $array.as_string::<i64>();)+
                $body
            }
            DataType::Utf8View => {
                $(let $array = $array.as_string_view();)+
                $body
            }
            other => ::datafusion::common::exec_err!("expected a string array, got {other}"),
        }
    }};
}

pub(crate) use with_string_arrays;

/// Coerces `count` string arguments to their common string type at planning time;
/// NULL and non-string arguments do not widen that type.
pub fn coerce_string_params(
    name: &str,
    count: usize,
    arg_types: &[DataType],
) -> Result<Vec<DataType>> {
    if arg_types.len() != count {
        return plan_err!("{name} expects {count} arguments, got {}", arg_types.len());
    }
    let common = common_string_type(arg_types.iter().filter(|t| is_string_type(t)))?;
    arg_types
        .iter()
        .map(|data_type| {
            if data_type.is_null() || can_cast_types(data_type, &common) {
                Ok(common.clone())
            } else {
                plan_err!("{name} cannot take an argument of type {data_type}")
            }
        })
        .collect()
}

/// Value of a string scalar of any string type; `None` for NULL or a non-string scalar.
pub fn scalar_str(value: &ScalarValue) -> Option<&str> {
    match value {
        ScalarValue::Utf8(v) | ScalarValue::LargeUtf8(v) | ScalarValue::Utf8View(v) => v.as_deref(),
        _ => None,
    }
}

fn is_string_type(data_type: &DataType) -> bool {
    matches!(
        data_type,
        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View
    )
}

/// The type DataFusion's `string_coercion` unifies these string types to; Utf8 when empty.
fn common_string_type<'a>(types: impl IntoIterator<Item = &'a DataType>) -> Result<DataType> {
    let mut common: Option<DataType> = None;
    for data_type in types {
        common = Some(match common {
            None => data_type.clone(),
            Some(common) => string_coercion(&common, data_type).ok_or_else(|| {
                exec_datafusion_err!("expected string arguments, got {common} and {data_type}")
            })?,
        });
    }
    Ok(common.unwrap_or(DataType::Utf8))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use datafusion::{
        arrow::{
            array::{
                ArrayRef, Int64Array, LargeStringArray, StringArray, StringArrayType,
                StringViewArray,
            },
            datatypes::{Field, Schema},
            record_batch::RecordBatch,
            util::pretty::pretty_format_batches,
        },
        datasource::MemTable,
        prelude::SessionContext,
    };

    use super::*;

    fn arrays() -> Vec<ArrayRef> {
        let rows = [Some("a"), None, Some("long enough to be out of line")];
        vec![
            Arc::new(StringArray::from_iter(rows)),
            Arc::new(LargeStringArray::from_iter(rows)),
            Arc::new(StringViewArray::from_iter(rows)),
        ]
    }

    fn collect<'a, S: StringArrayType<'a>>(array: S) -> Vec<Option<String>> {
        array.iter().map(|v| v.map(str::to_string)).collect()
    }

    fn dispatch(array: &ArrayRef) -> Result<Vec<Option<String>>> {
        with_string_arrays!(array.data_type(), [array], Ok(collect(array)))
    }

    #[test]
    fn dispatch_reads_every_string_type_in_place() {
        for array in arrays() {
            assert_eq!(
                dispatch(&array).unwrap(),
                vec![
                    Some("a".to_string()),
                    None,
                    Some("long enough to be out of line".to_string())
                ],
                "{}",
                array.data_type()
            );
        }
        let array: ArrayRef = Arc::new(Int64Array::from(vec![1]));
        assert!(dispatch(&array).is_err());
    }

    #[test]
    fn coerce_string_params_unifies_strings_without_widening_for_null() {
        use DataType::*;
        let coerce = |types: &[DataType]| coerce_string_params("f", 2, types);
        assert_eq!(coerce(&[Utf8, Null]).unwrap(), [Utf8, Utf8]);
        assert_eq!(coerce(&[Utf8, Utf8View]).unwrap(), [Utf8View, Utf8View]);
        assert_eq!(coerce(&[Null, LargeUtf8]).unwrap(), [LargeUtf8, LargeUtf8]);
        assert_eq!(coerce(&[Int64, Null]).unwrap(), [Utf8, Utf8]);
        assert!(coerce(&[Utf8]).is_err());
    }

    #[tokio::test]
    async fn str_match_reads_every_string_type_without_a_cast() {
        let rows = [Some("Hello world 42"), Some(""), None];
        let schema = Arc::new(Schema::new(vec![
            Field::new("s", DataType::Utf8, true),
            Field::new("v", DataType::Utf8View, true),
            Field::new("l", DataType::LargeUtf8, true),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from_iter(rows)),
                Arc::new(StringViewArray::from_iter(rows)),
                Arc::new(LargeStringArray::from_iter(rows)),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new();
        crate::datafusion::exec::register_builtin_udfs(&ctx);
        let table = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(table)).unwrap();
        for expr in [
            "str_match({c}, 'world')",
            "str_match_ignore_case({c}, 'HELLO')",
            "match_field({c}, 'world')",
        ] {
            let render = |column: &str| expr.replace("{c}", column);
            let expected = format!("SELECT {} AS r FROM t", render("s"));
            let expected = ctx.sql(&expected).await.unwrap().collect().await.unwrap();
            let expected = pretty_format_batches(&expected).unwrap().to_string();
            for column in ["v", "l"] {
                let df = ctx
                    .sql(&format!("SELECT {} AS r FROM t", render(column)))
                    .await
                    .unwrap();
                let plan = df.clone().into_optimized_plan().unwrap();
                let plan = plan.display_indent().to_string();
                assert!(!plan.contains("CAST"), "{expr} on {column}\n{plan}");
                let actual = df.collect().await.unwrap();
                let actual = pretty_format_batches(&actual).unwrap().to_string();
                assert_eq!(actual, expected, "{expr} on {column}");
            }
        }
    }
}
