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
                let regex = format!("^{}$", regex.as_str());
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
