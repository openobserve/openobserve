// Copyright 2023 Zinc Labs Inc.
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

// rewrite count(distinct(field)) query

use core::ops::ControlFlow;

use config::FxIndexSet;
use sqlparser::{
    ast::{Expr, Function, GroupByExpr, Ident, Query, VisitMut, VisitorMut},
    dialect::GenericDialect,
    parser::Parser,
};

const AGGREGATE_UDF_LIST: [&str; 7] = [
    "min",
    "max",
    "count",
    "avg",
    "sum",
    "array_agg",
    "approx_percentile_cont",
];

pub fn rewrite_count_distinct_sql(sql: &str, is_first_phase: bool) -> String {
    let mut statements = Parser::parse_sql(&GenericDialect {}, sql).unwrap();
    if is_first_phase {
        statements.visit(&mut Rewrite {
            is_first_phase: true,
        });
    } else {
        statements.visit(&mut Rewrite {
            is_first_phase: false,
        });
    }
    statements[0].to_string()
}

pub fn rewrite_count_distinct_merge_sql(sql: &str) -> String {
    let mut statements = Parser::parse_sql(&GenericDialect {}, sql).unwrap();
    statements.visit(&mut RewriteFinal);
    statements[0].to_string()
}

// A visitor that count(distinct(field)) query
struct Rewrite {
    is_first_phase: bool,
}

// Visit each expression after its children have been visited
impl VisitorMut for Rewrite {
    type Break = ();

    /// Invoked for any queries that appear in the AST before visiting children
    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        // remove the limit clause
        query.limit = None;
        query.offset = None;
        // remove the order by clause
        query.order_by = Vec::new();
        // rewrite the query body
        if let sqlparser::ast::SetExpr::Select(ref mut select) = *query.body {
            // add distinct to the projection list
            select.distinct = Some(sqlparser::ast::Distinct::Distinct);
            // remove the having clause
            select.having = None;
            // remove the group by clause
            select.group_by = GroupByExpr::Expressions(Vec::new());
            if !self.is_first_phase {
                // remove the where clause
                select.selection = None;
            }
            let mut field_names = FxIndexSet::default();
            let mut delete_idx = Vec::new();
            for (idx, select_item) in &mut select.projection.iter_mut().enumerate() {
                match select_item {
                    sqlparser::ast::SelectItem::ExprWithAlias { expr, alias } => {
                        match expr {
                            Expr::Function(Function {
                                name,
                                args,
                                distinct,
                                ..
                            }) => {
                                // extract field name from the aggregate function
                                if AGGREGATE_UDF_LIST
                                    .contains(&name.to_string().to_lowercase().as_str())
                                {
                                    // check if aggregate function is count and distinct is
                                    // false
                                    if name.to_string().to_lowercase() == "count" && !(*distinct) {
                                        select.distinct = None;
                                    }
                                    // check if the field name is already in the projection list
                                    let field_name =
                                        remove_brackets(format!("{}", args[0]).as_str());
                                    if field_names.contains(&field_name) {
                                        delete_idx.push(idx);
                                        continue;
                                    }
                                    field_names.insert(field_name.clone());
                                    *select_item = sqlparser::ast::SelectItem::UnnamedExpr(
                                        Expr::Identifier(Ident::new(field_name)),
                                    )
                                } else if !self.is_first_phase {
                                    *select_item = sqlparser::ast::SelectItem::UnnamedExpr(
                                        Expr::Identifier(alias.clone()),
                                    );
                                }
                            }
                            _ => {
                                if !self.is_first_phase {
                                    *select_item = sqlparser::ast::SelectItem::UnnamedExpr(
                                        Expr::Identifier(alias.clone()),
                                    );
                                }
                            }
                        }
                    }
                    // extrace function paraments from the projection list
                    sqlparser::ast::SelectItem::UnnamedExpr(expr) => {
                        if let Expr::Function(Function {
                            name,
                            args,
                            distinct,
                            ..
                        }) = expr
                        {
                            if !AGGREGATE_UDF_LIST
                                .contains(&name.to_string().to_lowercase().as_str())
                            {
                                if !self.is_first_phase {
                                    *select_item = sqlparser::ast::SelectItem::UnnamedExpr(
                                        Expr::Identifier(Ident::new(format!("\"{}\"", expr))),
                                    )
                                } else {
                                    *select_item = sqlparser::ast::SelectItem::ExprWithAlias {
                                        expr: expr.clone(),
                                        alias: Ident::new(format!("\"{}\"", expr)),
                                    }
                                }
                            } else {
                                if name.to_string().to_lowercase() == "count" && !(*distinct) {
                                    select.distinct = None;
                                }
                                let field_name = remove_brackets(format!("{}", args[0]).as_str());
                                if field_names.contains(&field_name) {
                                    delete_idx.push(idx);
                                    continue;
                                }
                                field_names.insert(field_name.clone());
                                *select_item = sqlparser::ast::SelectItem::UnnamedExpr(
                                    Expr::Identifier(Ident::new(field_name)),
                                )
                            }
                        }
                    }
                    _ => {}
                }
            }
            if !delete_idx.is_empty() {
                for idx in delete_idx.iter().rev() {
                    select.projection.remove(*idx);
                }
            }
        }
        ControlFlow::Continue(())
    }
}

// A visitor that count(distinct(field)) query
struct RewriteFinal;

// Visit each expression after its children have been visited
impl VisitorMut for RewriteFinal {
    type Break = ();

    /// Invoked for any queries that appear in the AST before visiting children
    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        // rewrite the order by clause
        for expr in query.order_by.iter_mut() {
            expr.expr = match expr.expr.clone() {
                Expr::Identifier(ident) => Expr::Identifier(ident.clone()),
                _ => Expr::Identifier(Ident::new(format!("\"{}\"", expr.expr))),
            }
        }
        // rewrite the query body
        if let sqlparser::ast::SetExpr::Select(ref mut select) = *query.body {
            // remove the where clause
            select.selection = None;

            // rewrite the group by clause
            if let GroupByExpr::Expressions(ref mut exprs) = select.group_by {
                for expr in exprs.iter_mut() {
                    *expr = match expr.clone() {
                        Expr::Identifier(ident) => Expr::Identifier(ident.clone()),
                        _ => Expr::Identifier(Ident::new(format!("\"{}\"", expr))),
                    }
                }
            }

            for select_item in &mut select.projection {
                match select_item {
                    sqlparser::ast::SelectItem::ExprWithAlias { expr, alias, .. } => {
                        match expr {
                            Expr::Function(Function { name, .. }) => {
                                // extract field name from the aggregate function
                                if !AGGREGATE_UDF_LIST
                                    .contains(&name.to_string().to_lowercase().as_str())
                                {
                                    *select_item = sqlparser::ast::SelectItem::UnnamedExpr(
                                        Expr::Identifier(alias.clone()),
                                    );
                                }
                            }
                            _ => {
                                *select_item = sqlparser::ast::SelectItem::UnnamedExpr(
                                    Expr::Identifier(alias.clone()),
                                );
                            }
                        }
                    }
                    // extrace function paraments from the projection list
                    sqlparser::ast::SelectItem::UnnamedExpr(expr) => {
                        if let Expr::Function(Function { name, .. }) = expr {
                            if !AGGREGATE_UDF_LIST
                                .contains(&name.to_string().to_lowercase().as_str())
                            {
                                *select_item = sqlparser::ast::SelectItem::UnnamedExpr(
                                    Expr::Identifier(Ident::new(format!("\"{}\"", expr))),
                                )
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        ControlFlow::Continue(())
    }
}

fn remove_brackets(input: &str) -> String {
    if input.starts_with('(') && input.ends_with(')') {
        input[1..input.len() - 1].to_string()
    } else {
        input.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_distinct_rewrite_phase1() {
        let sql = vec![
            "SELECT COUNT(DISTINCT a) FROM tbl where a > 3 limit 10",
            "SELECT COUNT(DISTINCT(a)) FROM tbl where a > 3 limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt, COUNT(DISTINCT c) FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt, COUNT(b) FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt, MAX(b) FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT date_bin(interval '1 day', to_timestamp_micros('2001-01-01T00:00:00'), to_timestamp('2001-01-01T00:00:00')) as x_axis_1, count(distinct(userid)) as y_axis_1  FROM segment WHERE event IN ('OpenObserve - heartbeat') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC LIMIT 15",
        ];

        let excepts = vec![
            "SELECT DISTINCT a FROM tbl WHERE a > 3",
            "SELECT DISTINCT a FROM tbl WHERE a > 3",
            "SELECT DISTINCT a, b FROM tbl WHERE a > 3",
            "SELECT DISTINCT a, b, c FROM tbl WHERE a > 3",
            "SELECT a, b FROM tbl WHERE a > 3",
            "SELECT DISTINCT a, b FROM tbl WHERE a > 3",
            "SELECT DISTINCT date_bin(INTERVAL '1 day', to_timestamp_micros('2001-01-01T00:00:00'), to_timestamp('2001-01-01T00:00:00')) AS x_axis_1, userid FROM segment WHERE event IN ('OpenObserve - heartbeat')",
        ];
        for (sql, except) in sql.iter().zip(excepts.iter()) {
            let mut statements = Parser::parse_sql(&GenericDialect {}, sql).unwrap();
            statements.visit(&mut Rewrite {
                is_first_phase: true,
            });
            assert_eq!(statements[0].to_string(), **except);
        }
    }

    #[test]
    fn test_count_distinct_rewrite_phase2() {
        let sql = vec![
            "SELECT COUNT(DISTINCT a) FROM tbl where a > 3 limit 10",
            "SELECT COUNT(DISTINCT(a)) FROM tbl where a > 3 limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt, COUNT(DISTINCT c) FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt, COUNT(b) FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt, MAX(b) FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT date_bin(interval '1 day', to_timestamp_micros('2001-01-01T00:00:00'), to_timestamp('2001-01-01T00:00:00')) as x_axis_1, count(distinct(userid)) as y_axis_1  FROM segment WHERE event IN ('OpenObserve - heartbeat') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC LIMIT 15",
        ];

        let excepts = vec![
            "SELECT DISTINCT a FROM tbl",
            "SELECT DISTINCT a FROM tbl",
            "SELECT DISTINCT a, b FROM tbl",
            "SELECT DISTINCT a, b, c FROM tbl",
            "SELECT a, b FROM tbl",
            "SELECT DISTINCT a, b FROM tbl",
            "SELECT DISTINCT x_axis_1, userid FROM segment",
        ];
        for (sql, except) in sql.iter().zip(excepts.iter()) {
            let mut statements = Parser::parse_sql(&GenericDialect {}, sql).unwrap();
            statements.visit(&mut Rewrite {
                is_first_phase: false,
            });
            assert_eq!(statements[0].to_string(), **except);
        }
    }

    #[test]
    fn test_count_distinct_rewrite_phase3() {
        let sql = vec![
            "SELECT COUNT(DISTINCT a) FROM tbl where a > 3 limit 10",
            "SELECT COUNT(DISTINCT(a)) FROM tbl where a > 3 limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt, COUNT(DISTINCT c) FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt, COUNT(b) FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT a, COUNT(DISTINCT b) as cnt, MAX(b) FROM tbl where a > 3 group by a having cnt > 1 order by cnt limit 10",
            "SELECT date_bin(interval '1 day', to_timestamp_micros('2001-01-01T00:00:00'), to_timestamp('2001-01-01T00:00:00')) as x_axis_1, count(distinct(userid)) as y_axis_1  FROM segment WHERE event IN ('OpenObserve - heartbeat') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC LIMIT 15",
        ];

        let excepts = vec![
            "SELECT COUNT(DISTINCT a) FROM tbl LIMIT 10",
            "SELECT COUNT(DISTINCT (a)) FROM tbl LIMIT 10",
            "SELECT a, COUNT(DISTINCT b) AS cnt FROM tbl GROUP BY a HAVING cnt > 1 ORDER BY cnt LIMIT 10",
            "SELECT a, COUNT(DISTINCT b) AS cnt, COUNT(DISTINCT c) FROM tbl GROUP BY a HAVING cnt > 1 ORDER BY cnt LIMIT 10",
            "SELECT a, COUNT(DISTINCT b) AS cnt, COUNT(b) FROM tbl GROUP BY a HAVING cnt > 1 ORDER BY cnt LIMIT 10",
            "SELECT a, COUNT(DISTINCT b) AS cnt, MAX(b) FROM tbl GROUP BY a HAVING cnt > 1 ORDER BY cnt LIMIT 10",
            "SELECT x_axis_1, count(DISTINCT (userid)) AS y_axis_1 FROM segment GROUP BY x_axis_1 ORDER BY x_axis_1 ASC LIMIT 15",
        ];
        for (sql, except) in sql.iter().zip(excepts.iter()) {
            let mut statements = Parser::parse_sql(&GenericDialect {}, sql).unwrap();
            statements.visit(&mut RewriteFinal);
            assert_eq!(statements[0].to_string(), **except);
        }
    }
}
