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

use std::ops::ControlFlow;

use config::get_config;
use sqlparser::{
    ast::{BinaryOperator, Expr, FunctionArguments, Value, ValueWithSpan, VisitorMut},
    tokenizer::Span,
};

use crate::service::search::{
    datafusion::udf::{
        MATCH_FIELD_IGNORE_CASE_UDF_NAME, MATCH_FIELD_UDF_NAME, STR_MATCH_UDF_IGNORE_CASE_NAME,
        STR_MATCH_UDF_NAME,
    },
    utils::trim_quotes,
};

// replace _o2_all_ with true
pub struct RemoveDashboardAllVisitor {}

impl RemoveDashboardAllVisitor {
    pub fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for RemoveDashboardAllVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        match expr {
            Expr::BinaryOp {
                left,
                op:
                    BinaryOperator::Eq
                    | BinaryOperator::GtEq
                    | BinaryOperator::LtEq
                    | BinaryOperator::Gt
                    | BinaryOperator::Lt,
                right,
            } => {
                if is_eq_placeholder(left.as_ref(), &placeholder)
                    || is_eq_placeholder(right.as_ref(), &placeholder)
                {
                    *expr = expr_boolean(true);
                }
            }
            // Not equal
            Expr::BinaryOp {
                left,
                op: BinaryOperator::NotEq,
                right,
            } => {
                if is_eq_placeholder(left.as_ref(), &placeholder)
                    || is_eq_placeholder(right.as_ref(), &placeholder)
                {
                    *expr = expr_boolean(false);
                }
            }
            // Like
            Expr::Like {
                pattern,
                negated: false,
                ..
            }
            | Expr::ILike {
                pattern,
                negated: false,
                ..
            } => {
                if is_eq_placeholder(pattern.as_ref(), &placeholder) {
                    *expr = expr_boolean(true);
                }
            }
            // Not Like
            Expr::Like {
                pattern,
                negated: true,
                ..
            }
            | Expr::ILike {
                pattern,
                negated: true,
                ..
            } => {
                if is_eq_placeholder(pattern.as_ref(), &placeholder) {
                    *expr = expr_boolean(false);
                }
            }
            // In list
            Expr::InList { list, negated, .. } if !(*negated) => {
                for item in list.iter() {
                    if is_eq_placeholder(item, &placeholder) {
                        *expr = expr_boolean(true);
                        break;
                    }
                }
            }
            // Not in list
            Expr::InList { list, negated, .. } if *negated => {
                for item in list.iter() {
                    if is_eq_placeholder(item, &placeholder) {
                        *expr = expr_boolean(false);
                        break;
                    }
                }
            }
            Expr::Function(func) => {
                let f = func.name.to_string().to_lowercase();
                if (f == STR_MATCH_UDF_NAME
                    || f == STR_MATCH_UDF_IGNORE_CASE_NAME
                    || f == MATCH_FIELD_UDF_NAME
                    || f == MATCH_FIELD_IGNORE_CASE_UDF_NAME)
                    && let FunctionArguments::List(list) = &func.args
                    && list.args.len() == 2
                {
                    let value = trim_quotes(list.args[1].to_string().as_str());
                    if *value == placeholder {
                        *expr = expr_boolean(true);
                    }
                }
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }
}

fn expr_boolean(value: bool) -> Expr {
    Expr::Value(ValueWithSpan {
        value: Value::Boolean(value),
        span: Span::empty(),
    })
}

fn is_eq_placeholder(expr: &Expr, placeholder: &str) -> bool {
    if let Expr::Value(ValueWithSpan {
        value: Value::SingleQuotedString(value),
        span: _,
    }) = expr
        && value == placeholder
    {
        true
    } else if let Expr::CompoundIdentifier(ident) = expr
        && ident[0].value == placeholder
    {
        true
    } else if let Expr::Identifier(ident) = expr
        && ident.value == placeholder
    {
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;

    #[test]
    fn test_remove_dashboard_all_visitor() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let sql = format!("select * from t where field1 = '{placeholder}'");
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_remove_dashboard_all_visitor_with_in_list() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let sql = format!("select * from t where field1 in ('{placeholder}')");
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_remove_dashboard_all_visitor_with_in_list_and_negated() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let sql = format!("select * from t where field1 not in ('{placeholder}')");
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE false";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_remove_dashboard_all_visitor_with_in_list_and_negated_and_other_filter() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let sql =
            format!("select * from t where field1 not in ('{placeholder}') and field2 = 'value2'");
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE false AND field2 = 'value2'";
        assert_eq!(statement.to_string(), expected);
    }

    // test multi and/or with _o2_all_
    #[test]
    fn test_remove_dashboard_all_visitor_with_multi_and_or_with_o2_all() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let sql = format!(
            "select * from t where field1 = '{placeholder}' and (field2 = '{placeholder}' or field3 = '{placeholder}')"
        );
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true AND (true OR true)";
        assert_eq!(statement.to_string(), expected);
    }

    // test _o2_all_ with like and not like
    #[test]
    fn test_remove_dashboard_all_visitor_with_like_and_not_like() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let sql = format!(
            "select * from t where field1 like '{placeholder}' and field2 not like '{placeholder}'"
        );
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true AND false";
        assert_eq!(statement.to_string(), expected);
    }

    // test _o2_all_ with like and not like
    #[test]
    fn test_remove_dashboard_all_visitor_with_like_and_not_like_and_other_filter() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let sql = format!(
            "select * from t where field1 like '{placeholder}' and field2 not like '{placeholder}' and field3 = 'value3'"
        );
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true AND false AND field3 = 'value3'";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_remove_dashboard_all_visitor_with_str_match_and_other_filter() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let sql = format!(
            "select * from t where str_match(field1, '{placeholder}') and field2 = 'value2'"
        );
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true AND field2 = 'value2'";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_remove_dashboard_all_visitor_with_match_field_and_other_filter() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let sql = format!(
            "select * from t where match_field(field1, '{placeholder}') and field2 = 'value2'"
        );
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true AND field2 = 'value2'";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_remove_dashboard_all_visitor_with_match_field_and_other_filter_not_string() {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        let sql = format!("select * from t where field1 = {placeholder} and field2 = 'value2'");
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true AND field2 = 'value2'";
        assert_eq!(statement.to_string(), expected);
    }
}
