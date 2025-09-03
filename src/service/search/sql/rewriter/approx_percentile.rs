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

use sqlparser::ast::{
    Expr, Function, FunctionArg, FunctionArgExpr, FunctionArgumentList, FunctionArguments, Ident,
    ObjectName, ObjectNamePart, OrderByExpr, OrderByOptions, VisitorMut,
    helpers::attached_token::AttachedToken,
};

pub struct ReplaceApproxPercentiletVisitor {}

impl ReplaceApproxPercentiletVisitor {
    pub fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for ReplaceApproxPercentiletVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(func) = expr {
            if !func.within_group.is_empty() {
                return ControlFlow::Continue(());
            }
            let name = func.name.to_string().to_lowercase();
            if name == "approx_percentile_cont" {
                let (first, others) = splite_function_args(&func.args);
                *expr = Expr::Function(Function {
                    name: ObjectName(vec![ObjectNamePart::Identifier(Ident::new(
                        "approx_percentile_cont",
                    ))]),
                    parameters: FunctionArguments::None,
                    args: FunctionArguments::List(FunctionArgumentList {
                        args: others,
                        duplicate_treatment: None,
                        clauses: vec![],
                    }),
                    filter: None,
                    null_treatment: None,
                    over: None,
                    within_group: vec![convert_args_to_order_expr(first)],
                    uses_odbc_syntax: false,
                });
            } else if name == "approx_percentile_cont_with_weight" {
                let (first, others) = splite_function_args(&func.args);
                *expr = Expr::Function(Function {
                    name: ObjectName(vec![ObjectNamePart::Identifier(Ident::new(
                        "approx_percentile_cont_with_weight",
                    ))]),
                    parameters: FunctionArguments::None,
                    args: FunctionArguments::List(FunctionArgumentList {
                        args: others,
                        duplicate_treatment: None,
                        clauses: vec![],
                    }),
                    filter: None,
                    null_treatment: None,
                    over: None,
                    within_group: vec![convert_args_to_order_expr(first)],
                    uses_odbc_syntax: false,
                });
            }
        }
        ControlFlow::Continue(())
    }
}

fn splite_function_args(args: &FunctionArguments) -> (FunctionArg, Vec<FunctionArg>) {
    match args {
        FunctionArguments::List(list) => {
            let (first, others) = list.args.split_first().unwrap();
            (first.clone(), others.to_vec())
        }
        _ => {
            log::error!("Unsupported function arguments: {args:?}");
            (FunctionArg::Unnamed(FunctionArgExpr::Wildcard), vec![])
        }
    }
}

fn convert_args_to_order_expr(args: FunctionArg) -> OrderByExpr {
    let expr = convert_function_args_to_expr(args);
    OrderByExpr {
        expr: expr.clone(),
        options: OrderByOptions {
            asc: None,
            nulls_first: None,
        },
        with_fill: None,
    }
}

fn convert_function_args_to_expr(args: FunctionArg) -> Expr {
    match args {
        FunctionArg::Named {
            name: _,
            arg: FunctionArgExpr::Expr(arg),
            operator: _,
        } => arg,
        FunctionArg::Named {
            name: _,
            arg: FunctionArgExpr::Wildcard,
            operator: _,
        } => Expr::Wildcard(AttachedToken::empty()),
        FunctionArg::Unnamed(FunctionArgExpr::Expr(arg)) => arg,
        FunctionArg::Unnamed(FunctionArgExpr::Wildcard) => Expr::Wildcard(AttachedToken::empty()),
        _ => {
            log::error!("Unsupported function argument: {args:?}");
            Expr::Wildcard(AttachedToken::empty())
        }
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;

    #[test]
    fn test_replace_approx_percentilet_visitor1() {
        let sql = "select approx_percentile_cont(a, 0.5) from stream";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut replace_approx_percentilet_visitor = ReplaceApproxPercentiletVisitor::new();
        let _ = statement.visit(&mut replace_approx_percentilet_visitor);
        assert_eq!(
            statement.to_string(),
            "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY a) FROM stream"
        );
    }

    #[test]
    fn test_replace_approx_percentilet_visitor2() {
        let sql = "select approx_percentile_cont(arrow_cast(a, 'int'), 0.5) from stream";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut replace_approx_percentilet_visitor = ReplaceApproxPercentiletVisitor::new();
        let _ = statement.visit(&mut replace_approx_percentilet_visitor);
        assert_eq!(
            statement.to_string(),
            "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY arrow_cast(a, 'int')) FROM stream"
        );
    }

    #[test]
    fn test_replace_approx_percentilet_visitor3() {
        let sql = "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY a) FROM stream";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut replace_approx_percentilet_visitor = ReplaceApproxPercentiletVisitor::new();
        let _ = statement.visit(&mut replace_approx_percentilet_visitor);
        assert_eq!(
            statement.to_string(),
            "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY a) FROM stream"
        );
    }

    #[test]
    fn test_replace_approx_percentilet_visitor4() {
        let sql = "select approx_percentile_cont(arrow_cast(a, 'int') / 1000, 0.5) from stream";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut replace_approx_percentilet_visitor = ReplaceApproxPercentiletVisitor::new();
        let _ = statement.visit(&mut replace_approx_percentilet_visitor);
        assert_eq!(
            statement.to_string(),
            "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY arrow_cast(a, 'int') / 1000) FROM stream"
        );
    }

    #[test]
    fn test_replace_approx_percentilet_visitor5() {
        let sql = "select approx_percentile_cont(CAST(json_get_str(array_element(cast_to_arr(spath(log, 'error')), 1), 'code') AS INT), 0.5) from stream";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut replace_approx_percentilet_visitor = ReplaceApproxPercentiletVisitor::new();
        let _ = statement.visit(&mut replace_approx_percentilet_visitor);
        assert_eq!(
            statement.to_string(),
            "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY CAST(json_get_str(array_element(cast_to_arr(spath(log, 'error')), 1), 'code') AS INT)) FROM stream"
        );
    }
}
