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

use std::sync::Arc;

use config::meta::inverted_index::UNKNOWN_NAME;
use datafusion::{
    arrow::datatypes::DataType,
    config::ConfigOptions,
    logical_expr::Operator,
    physical_expr::ScalarFunctionExpr,
    physical_plan::{
        PhysicalExpr,
        expressions::{BinaryExpr, CastExpr, Column, IsNotNullExpr, LikeExpr, Literal},
    },
    scalar::ScalarValue,
};

use crate::datafusion::udf::str_match_udf;

// TODO: duplication with datafusion/optimizer/physical_optimizer/utils.rs
pub(super) fn is_physical_column(expr: &Arc<dyn PhysicalExpr>) -> bool {
    if expr.downcast_ref::<Column>().is_some() {
        true
    } else if let Some(expr) = expr.downcast_ref::<CastExpr>() {
        is_physical_column(expr.expr())
    } else {
        false
    }
}

// TODO: duplication with datafusion/optimizer/physical_optimizer/utils.rs
pub(super) fn get_physical_column_name(expr: &Arc<dyn PhysicalExpr>) -> &str {
    if let Some(expr) = expr.downcast_ref::<Column>() {
        expr.name()
    } else if let Some(expr) = expr.downcast_ref::<CastExpr>() {
        get_physical_column_name(expr.expr())
    } else {
        UNKNOWN_NAME
    }
}

pub(super) fn is_physical_value(expr: &Arc<dyn PhysicalExpr>) -> bool {
    expr.downcast_ref::<Literal>().is_some()
}

pub(super) fn get_physical_value(expr: &Arc<dyn PhysicalExpr>) -> String {
    if let Some(literal) = expr.downcast_ref::<Literal>() {
        match literal.value() {
            ScalarValue::Boolean(Some(b)) => b.to_string(),
            ScalarValue::Int64(Some(i)) => i.to_string(),
            ScalarValue::UInt64(Some(i)) => i.to_string(),
            ScalarValue::Float64(Some(f)) => f.to_string(),
            ScalarValue::Utf8(Some(s)) => s.clone(),
            ScalarValue::LargeUtf8(Some(s)) => s.clone(),
            ScalarValue::Utf8View(Some(s)) => s.clone(),
            ScalarValue::Binary(Some(b)) => String::from_utf8_lossy(b).to_string(),
            _ => unimplemented!("get_physical_value not support {:?}", literal),
        }
    } else {
        unreachable!()
    }
}

// combine all exprs with OR operator
pub(super) fn conjunction(exprs: Vec<Arc<dyn PhysicalExpr>>) -> Arc<dyn PhysicalExpr> {
    if exprs.is_empty() {
        Arc::new(Literal::new(ScalarValue::Boolean(Some(true))))
    } else {
        balanced_binary(exprs, Operator::And)
    }
}

pub(super) fn disjunction(exprs: Vec<Arc<dyn PhysicalExpr>>) -> Arc<dyn PhysicalExpr> {
    balanced_binary(exprs, Operator::Or)
}

// pairwise merge keeps evaluate/display/drop of a long chain at O(log n) depth
fn balanced_binary(mut exprs: Vec<Arc<dyn PhysicalExpr>>, op: Operator) -> Arc<dyn PhysicalExpr> {
    while exprs.len() > 1 {
        let mut merged = Vec::with_capacity(exprs.len().div_ceil(2));
        let mut iter = exprs.into_iter();
        while let Some(left) = iter.next() {
            merged.push(match iter.next() {
                Some(right) => Arc::new(BinaryExpr::new(left, op, right)) as _,
                None => left,
            });
        }
        exprs = merged;
    }
    exprs
        .pop()
        .expect("balanced_binary needs at least one expression")
}

pub(super) fn get_scalar_value(
    value: &str,
    data_type: &DataType,
) -> Result<Arc<Literal>, anyhow::Error> {
    Ok(match data_type {
        DataType::Boolean => Arc::new(Literal::new(ScalarValue::Boolean(Some(value.parse()?)))),
        DataType::Int64 => Arc::new(Literal::new(ScalarValue::Int64(Some(value.parse()?)))),
        DataType::UInt64 => Arc::new(Literal::new(ScalarValue::UInt64(Some(value.parse()?)))),
        DataType::Float64 => Arc::new(Literal::new(ScalarValue::Float64(Some(value.parse()?)))),
        DataType::Utf8 => Arc::new(Literal::new(ScalarValue::Utf8(Some(value.to_string())))),
        DataType::LargeUtf8 => Arc::new(Literal::new(ScalarValue::LargeUtf8(Some(
            value.to_string(),
        )))),
        DataType::Utf8View => {
            Arc::new(Literal::new(ScalarValue::Utf8View(Some(value.to_string()))))
        }
        DataType::Binary => Arc::new(Literal::new(ScalarValue::Binary(Some(
            value.as_bytes().to_vec(),
        )))),
        _ => unimplemented!(),
    })
}

pub(super) fn create_like_expr_with_not_null(
    field: &str,
    term: Arc<dyn PhysicalExpr>,
    schema: &arrow_schema::Schema,
) -> Arc<dyn PhysicalExpr> {
    let column = Arc::new(Column::new(field, schema.index_of(field).unwrap()));
    Arc::new(BinaryExpr::new(
        Arc::new(IsNotNullExpr::new(column.clone())),
        Operator::And,
        Arc::new(LikeExpr::new(false, true, column, term.clone())),
    ))
}

pub(super) fn create_str_match_expr(
    schema: &arrow_schema::Schema,
    name: &str,
    value: &str,
    case_sensitive: bool,
) -> Result<Arc<dyn PhysicalExpr>, anyhow::Error> {
    let index = schema.index_of(name).unwrap();
    let field = schema.field(index);
    let col = Arc::new(Column::new(name, index));

    // if the field is Utf8View, we need to cast it to Utf8 for str_match udf
    let left: Arc<dyn PhysicalExpr> = if *field.data_type() == DataType::Utf8View {
        Arc::new(CastExpr::new(col, DataType::Utf8, None))
    } else {
        col
    };

    // if the field is Utf8View, we need to cast it to Utf8 for str_match udf
    let data_type = if *field.data_type() == DataType::Utf8View {
        DataType::Utf8
    } else {
        field.data_type().clone()
    };

    let right = get_scalar_value(value, &data_type)?;
    let udf = if case_sensitive {
        Arc::new(str_match_udf::STR_MATCH_UDF.clone())
    } else {
        Arc::new(str_match_udf::STR_MATCH_IGNORE_CASE_UDF.clone())
    };

    let udf_expr = Arc::new(ScalarFunctionExpr::try_new(
        udf.clone(),
        vec![left, right],
        schema,
        Arc::new(ConfigOptions::default()),
    )?);
    Ok(udf_expr)
}

pub(super) fn is_alphanumeric(s: &str) -> bool {
    s.chars().all(|c| c.is_ascii_alphanumeric())
}

fn _is_blank_or_alphanumeric(s: &str) -> bool {
    s.chars()
        .all(|c| c.is_ascii_whitespace() || c.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_alphanumeric() {
        assert!(is_alphanumeric("123"));
        assert!(is_alphanumeric("123abc"));
        assert!(!is_alphanumeric("123 abc"));
        assert!(!is_alphanumeric("123 abc 123"));
    }

    #[test]
    fn test_is_blank_or_alphanumeric() {
        assert!(_is_blank_or_alphanumeric("123"));
        assert!(_is_blank_or_alphanumeric("123abc"));
        assert!(_is_blank_or_alphanumeric("123 abc"));
        assert!(_is_blank_or_alphanumeric("123 abc 123"));
    }

    #[test]
    fn test_disjunction_single() {
        use datafusion::{physical_expr::expressions::Literal, scalar::ScalarValue};

        let expr = Arc::new(Literal::new(ScalarValue::Boolean(Some(true))));
        let result = disjunction(vec![expr.clone()]);
        assert_eq!(result.as_ref() as *const _, expr.as_ref() as *const _);
    }

    fn binary_depth(expr: &Arc<dyn PhysicalExpr>) -> usize {
        match expr.downcast_ref::<BinaryExpr>() {
            Some(bin) => 1 + binary_depth(bin.left()).max(binary_depth(bin.right())),
            None => 0,
        }
    }

    #[test]
    fn test_balanced_binary_is_logarithmic_and_ordered() {
        use datafusion::physical_expr::expressions::Literal;

        let exprs = (0..1000)
            .map(|i| Arc::new(Literal::new(ScalarValue::Int64(Some(i)))) as Arc<dyn PhysicalExpr>)
            .collect::<Vec<_>>();
        let result = disjunction(exprs);
        assert_eq!(binary_depth(&result), 10);
        // leaves come out in the original left-to-right order
        let mut leaves = Vec::new();
        let mut stack = vec![result];
        while let Some(expr) = stack.pop() {
            match expr.downcast_ref::<BinaryExpr>() {
                Some(bin) => {
                    stack.push(bin.right().clone());
                    stack.push(bin.left().clone());
                }
                None => leaves.push(expr.downcast_ref::<Literal>().unwrap().value().clone()),
            }
        }
        assert_eq!(leaves.len(), 1000);
        assert_eq!(leaves[0], ScalarValue::Int64(Some(0)));
        assert_eq!(leaves[999], ScalarValue::Int64(Some(999)));
    }

    #[test]
    fn test_conjunction_empty_is_true() {
        use datafusion::physical_expr::expressions::Literal;

        let result = conjunction(vec![]);
        let lit = result.downcast_ref::<Literal>().unwrap();
        assert_eq!(*lit.value(), ScalarValue::Boolean(Some(true)));
    }

    #[test]
    fn test_get_scalar_value_boolean() {
        let result = get_scalar_value("true", &DataType::Boolean);
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_scalar_value_int64() {
        let result = get_scalar_value("123", &DataType::Int64);
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_scalar_value_utf8() {
        let result = get_scalar_value("test", &DataType::Utf8);
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_scalar_value_error() {
        let result = get_scalar_value("not_a_number", &DataType::Int64);
        assert!(result.is_err());
    }
}
