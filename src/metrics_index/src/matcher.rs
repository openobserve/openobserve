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

use std::ops::Not;

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{NAME_LABEL, VALUE_LABEL},
};
use datafusion::{
    arrow::datatypes::{DataType, Field, Schema},
    common::ScalarValue,
    functions::regex::regexp_like,
    logical_expr::expr_fn::cast,
    prelude::{Expr, col, lit},
};
use promql_parser::label::{MatchOp, Matcher, Matchers};

pub fn matcher_residual_field<'a>(schema: &'a Schema, matcher: &Matcher) -> Option<&'a Field> {
    // The selected stream already accounts for __name__; its stored spelling may differ.
    if matcher.name == TIMESTAMP_COL_NAME
        || matcher.name == VALUE_LABEL
        || matcher.name == NAME_LABEL
    {
        return None;
    }
    schema.field_with_name(&matcher.name).ok()
}

pub fn matcher_predicates(schema: &Schema, matchers: &Matchers) -> Vec<Expr> {
    let mut predicates = Vec::new();
    for mat in &matchers.matchers {
        let Some(field) = matcher_residual_field(schema, mat) else {
            continue;
        };
        let field_type = field.data_type();
        let column = col(mat.name.as_str());
        let literal = |value: String| -> Expr {
            match field_type {
                DataType::Utf8View => lit(ScalarValue::Utf8View(Some(value))),
                DataType::LargeUtf8 => lit(ScalarValue::LargeUtf8(Some(value))),
                _ => lit(value),
            }
        };
        let predicate = match &mat.op {
            MatchOp::Equal => column.eq(literal(mat.value.clone())),
            MatchOp::NotEqual => column.not_eq(literal(mat.value.clone())),
            MatchOp::Re(regex) | MatchOp::NotRe(regex) => {
                let regex = regex.as_str();
                let column = if matches!(field_type, DataType::Dictionary(_, _)) {
                    cast(column, DataType::Utf8View)
                } else {
                    column
                };
                let predicate = regexp_like().call(vec![column, lit(regex)]);
                if matches!(mat.op, MatchOp::NotRe(_)) {
                    predicate.not()
                } else {
                    predicate
                }
            }
        };
        predicates.push(predicate);
    }
    predicates
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use datafusion::{
        arrow::{
            array::{ArrayRef, LargeStringArray, RecordBatch, StringArray, StringViewArray},
            util::display::array_value_to_string,
        },
        prelude::SessionContext,
    };
    use promql_parser::parser::{self, Expr as PromExpr};

    use super::*;

    #[tokio::test]
    async fn regex_residual_filters_preserve_parser_anchoring_and_normalization() {
        let values = vec![
            "first",
            "last",
            "first-extra",
            "prefix-last",
            "middle",
            "bc{abc}",
            "xbc{abc}",
            "bc{abc}x",
        ];
        let columns: Vec<ArrayRef> = vec![
            Arc::new(StringArray::from(values.clone())),
            Arc::new(LargeStringArray::from(values.clone())),
            Arc::new(StringViewArray::from(values)),
        ];
        for column in columns {
            let schema = Arc::new(Schema::new(vec![Field::new(
                "label",
                column.data_type().clone(),
                false,
            )]));
            let batch = RecordBatch::try_new(schema.clone(), vec![column]).unwrap();
            for (pattern, operator, expected) in [
                ("first|last", "=~", vec!["first", "last"]),
                (
                    "first|last",
                    "!~",
                    vec![
                        "first-extra",
                        "prefix-last",
                        "middle",
                        "bc{abc}",
                        "xbc{abc}",
                        "bc{abc}x",
                    ],
                ),
                ("bc{abc}", "=~", vec!["bc{abc}"]),
                (
                    "bc{abc}",
                    "!~",
                    vec![
                        "first",
                        "last",
                        "first-extra",
                        "prefix-last",
                        "middle",
                        "xbc{abc}",
                        "bc{abc}x",
                    ],
                ),
            ] {
                let query = format!(r#"m{{label{operator}"{pattern}"}}"#);
                let PromExpr::VectorSelector(selector) = parser::parse(&query).unwrap() else {
                    panic!("expected vector selector");
                };
                let context = SessionContext::new();
                let filter = matcher_predicates(&schema, &selector.matchers).remove(0);
                let batches = context
                    .read_batch(batch.clone())
                    .unwrap()
                    .filter(filter)
                    .unwrap()
                    .collect()
                    .await
                    .unwrap();
                let actual = batches
                    .iter()
                    .flat_map(|batch| {
                        (0..batch.num_rows()).map(|row| {
                            array_value_to_string(batch.column(0).as_ref(), row).unwrap()
                        })
                    })
                    .collect::<Vec<_>>();
                assert_eq!(
                    actual,
                    expected,
                    "{pattern} {operator} {:?}",
                    schema.field(0).data_type()
                );
            }
        }
    }
}
