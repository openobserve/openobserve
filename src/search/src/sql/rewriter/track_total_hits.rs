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

use std::ops::ControlFlow;

use sqlparser::ast::{
    Expr, Function, FunctionArg, FunctionArgExpr, FunctionArgumentList, FunctionArguments,
    GroupByExpr, Ident, ObjectName, ObjectNamePart, Query, Select, SelectFlavor, SelectItem,
    SetExpr, TableFactor, TableWithJoins, VisitorMut, helpers::attached_token::AttachedToken,
};

pub struct TrackTotalHitsVisitor {}

impl Default for TrackTotalHitsVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl TrackTotalHitsVisitor {
    pub fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for TrackTotalHitsVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        match query.body.as_mut() {
            SetExpr::Select(select) => {
                if select.distinct.is_some() {
                    // For DISTINCT queries, we need to wrap the query in a subquery
                    // and count the results, since DataFusion doesn't support COUNT DISTINCT with
                    // multiple arguments
                    let original_query = query.clone();
                    let subquery = Box::new(SetExpr::Select(Box::new(Select {
                        select_token: AttachedToken::empty(),
                        distinct: None,
                        top: None,
                        top_before_distinct: false,
                        projection: vec![SelectItem::ExprWithAlias {
                            expr: Expr::Function(Function {
                                name: ObjectName(vec![ObjectNamePart::Identifier(Ident::new(
                                    "count",
                                ))]),
                                parameters: FunctionArguments::None,
                                args: FunctionArguments::List(FunctionArgumentList {
                                    args: vec![FunctionArg::Unnamed(FunctionArgExpr::Wildcard)],
                                    duplicate_treatment: None,
                                    clauses: vec![],
                                }),
                                filter: None,
                                null_treatment: None,
                                over: None,
                                within_group: vec![],
                                uses_odbc_syntax: false,
                            }),
                            alias: Ident::new("zo_sql_num"),
                        }],
                        into: None,
                        from: vec![TableWithJoins {
                            relation: TableFactor::Derived {
                                lateral: false,
                                subquery: Box::new(original_query),
                                alias: None,
                                sample: None,
                            },
                            joins: vec![],
                        }],
                        lateral_views: vec![],
                        selection: None,
                        group_by: GroupByExpr::Expressions(vec![], vec![]),
                        having: None,
                        prewhere: None,
                        sort_by: vec![],
                        cluster_by: vec![],
                        distribute_by: vec![],
                        named_window: vec![],
                        qualify: None,
                        window_before_qualify: false,
                        connect_by: vec![],
                        value_table_mode: None,
                        exclude: None,
                        flavor: SelectFlavor::Standard,
                        optimizer_hints: vec![],
                        select_modifiers: None,
                    })));
                    *query = Query {
                        with: None,
                        body: subquery,
                        order_by: None,
                        limit_clause: None,
                        fetch: None,
                        for_clause: None,
                        locks: vec![],
                        settings: None,
                        format_clause: None,
                        pipe_operators: vec![],
                    };
                } else {
                    // For non-DISTINCT queries, use the original approach
                    select.group_by = GroupByExpr::Expressions(vec![], vec![]);
                    select.having = None;
                    select.sort_by = vec![];
                    select.projection = vec![SelectItem::ExprWithAlias {
                        expr: Expr::Function(Function {
                            name: ObjectName(vec![ObjectNamePart::Identifier(Ident::new("count"))]),
                            parameters: FunctionArguments::None,
                            args: FunctionArguments::List(FunctionArgumentList {
                                args: vec![FunctionArg::Unnamed(FunctionArgExpr::Wildcard)],
                                duplicate_treatment: None,
                                clauses: vec![],
                            }),
                            filter: None,
                            null_treatment: None,
                            over: None,
                            within_group: vec![],
                            uses_odbc_syntax: false,
                        }),
                        alias: Ident::new("zo_sql_num"),
                    }];
                    query.order_by = None;
                }
            }
            SetExpr::SetOperation { .. } => {
                let select = Box::new(SetExpr::Select(Box::new(Select {
                    select_token: AttachedToken::empty(),
                    distinct: None,
                    top: None,
                    top_before_distinct: false,
                    projection: vec![SelectItem::ExprWithAlias {
                        expr: Expr::Function(Function {
                            name: ObjectName(vec![ObjectNamePart::Identifier(Ident::new("count"))]),
                            parameters: FunctionArguments::None,
                            args: FunctionArguments::List(FunctionArgumentList {
                                args: vec![FunctionArg::Unnamed(FunctionArgExpr::Wildcard)],
                                duplicate_treatment: None,
                                clauses: vec![],
                            }),
                            filter: None,
                            null_treatment: None,
                            over: None,
                            within_group: vec![],
                            uses_odbc_syntax: false,
                        }),
                        alias: Ident::new("zo_sql_num"),
                    }],
                    into: None,
                    from: vec![TableWithJoins {
                        relation: TableFactor::Derived {
                            lateral: false,
                            subquery: Box::new(query.clone()),
                            alias: None,
                            sample: None,
                        },
                        joins: vec![],
                    }],
                    lateral_views: vec![],
                    selection: None,
                    group_by: GroupByExpr::Expressions(vec![], vec![]),
                    having: None,
                    prewhere: None,
                    sort_by: vec![],
                    cluster_by: vec![],
                    distribute_by: vec![],
                    named_window: vec![],
                    qualify: None,
                    window_before_qualify: false,
                    connect_by: vec![],
                    value_table_mode: None,
                    exclude: None,
                    flavor: SelectFlavor::Standard,
                    optimizer_hints: vec![],
                    select_modifiers: None,
                })));
                *query = Query {
                    with: None,
                    body: select,
                    order_by: None,
                    limit_clause: None,
                    fetch: None,
                    for_clause: None,
                    locks: vec![],
                    settings: None,
                    format_clause: None,
                    pipe_operators: vec![],
                };
            }
            // Rewrite the wrapped query here: `with` is visited before `body`, so continuing
            // the walk would reach the CTE definitions and count one of those instead.
            SetExpr::Query(inner) => {
                let inner = inner.as_mut();
                query.order_by = None;
                return self.pre_visit_query(inner);
            }
            _ => {}
        }
        ControlFlow::Break(())
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;

    #[test]
    fn test_track_total_hits1() {
        let sql = "SELECT * FROM t WHERE name = 'a'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM t WHERE name = 'a'";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits2() {
        let sql = "SELECT name, count(*) FROM t WHERE name = 'a' group by name order by name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM t WHERE name = 'a'";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits3() {
        let sql = "SELECT t1.name, t2.name from t1 join t2 on t1.name = t2.name where t1.name = 'openobserve' group by t1.name, t2.name order by t1.name, t2.name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM t1 JOIN t2 ON t1.name = t2.name WHERE t1.name = 'openobserve'";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits4() {
        let sql = "SELECT name from t1 where name not in (select name from t2)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql =
            "SELECT count(*) AS zo_sql_num FROM t1 WHERE name NOT IN (SELECT name FROM t2)";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits5() {
        let sql = "SELECT name from t1 union select name from t2";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql =
            "SELECT count(*) AS zo_sql_num FROM (SELECT name FROM t1 UNION SELECT name FROM t2)";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits6() {
        let sql = "(SELECT name from t1) union (select name from t2)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM ((SELECT name FROM t1) UNION (SELECT name FROM t2))";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits7() {
        let sql = "SELECT name from t1 union select name from t2 union select name from t3";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM (SELECT name FROM t1 UNION SELECT name FROM t2 UNION SELECT name FROM t3)";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits_distinct_single_column() {
        let sql = "SELECT DISTINCT name FROM t WHERE name = 'a'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        // For DISTINCT queries, we wrap in a subquery to count results
        let expected_sql =
            "SELECT count(*) AS zo_sql_num FROM (SELECT DISTINCT name FROM t WHERE name = 'a')";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits_distinct_multiple_columns() {
        let sql = "SELECT DISTINCT unique_id, continent FROM oly WHERE continent = 'ASI'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        // For DISTINCT queries with multiple columns, we wrap in a subquery to count results
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM (SELECT DISTINCT unique_id, continent FROM oly WHERE continent = 'ASI')";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits_distinct_three_columns() {
        let sql =
            "SELECT DISTINCT unique_id, continent, bronze_medals FROM oly WHERE continent = 'ASI'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        // For DISTINCT queries with multiple columns, we wrap in a subquery to count results
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM (SELECT DISTINCT unique_id, continent, bronze_medals FROM oly WHERE continent = 'ASI')";
        assert_eq!(statement.to_string(), expected_sql);
    }

    fn rewritten(sql: &str) -> String {
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        statement.to_string()
    }

    #[test]
    fn test_track_total_hits_parenthesized_query() {
        assert_eq!(
            rewritten("(SELECT * FROM t WHERE name = 'a')"),
            "(SELECT count(*) AS zo_sql_num FROM t WHERE name = 'a')"
        );
    }

    #[test]
    fn test_track_total_hits_nested_parentheses() {
        assert_eq!(
            rewritten("((SELECT * FROM t))"),
            "((SELECT count(*) AS zo_sql_num FROM t))"
        );
    }

    #[test]
    fn test_track_total_hits_parenthesized_query_drops_outer_order_by() {
        // The count projects no `name`, so an ORDER BY left outside would not resolve.
        assert_eq!(
            rewritten("(SELECT * FROM t) ORDER BY name"),
            "(SELECT count(*) AS zo_sql_num FROM t)"
        );
    }

    #[test]
    fn test_track_total_hits_parenthesized_query_leaves_inner_subquery_alone() {
        // Only the outermost SELECT becomes a count, exactly as without the parentheses.
        assert_eq!(
            rewritten("(SELECT * FROM (SELECT * FROM u))"),
            "(SELECT count(*) AS zo_sql_num FROM (SELECT * FROM u))"
        );
    }

    #[test]
    fn test_track_total_hits_parenthesized_query_leaves_cte_definitions_alone() {
        // `with` is visited before `body`, so the count must not land on a CTE.
        assert_eq!(
            rewritten("WITH cte AS (SELECT * FROM t) (SELECT * FROM cte WHERE x = 1)"),
            "WITH cte AS (SELECT * FROM t) (SELECT count(*) AS zo_sql_num FROM cte WHERE x = 1)"
        );
        assert_eq!(
            rewritten("(WITH cte AS (SELECT * FROM t) SELECT * FROM cte)"),
            "(WITH cte AS (SELECT * FROM t) SELECT count(*) AS zo_sql_num FROM cte)"
        );
    }

    #[test]
    fn test_track_total_hits_parenthesized_query_matches_bare_form() {
        for (bare, wrapped) in [
            ("SELECT * FROM t", "(SELECT * FROM t)"),
            (
                "SELECT * FROM t WHERE a = 1 LIMIT 5",
                "(SELECT * FROM t WHERE a = 1 LIMIT 5)",
            ),
        ] {
            assert_eq!(format!("({})", rewritten(bare)), rewritten(wrapped));
        }
    }
}
