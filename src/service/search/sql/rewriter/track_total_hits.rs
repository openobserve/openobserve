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
    Expr, Function, FunctionArg, FunctionArgExpr, FunctionArgumentList, FunctionArguments,
    GroupByExpr, Ident, ObjectName, ObjectNamePart, Query, Select, SelectFlavor, SelectItem,
    SetExpr, TableFactor, TableWithJoins, VisitorMut, helpers::attached_token::AttachedToken,
};

pub struct TrackTotalHitsVisitor {}

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
                        connect_by: None,
                        value_table_mode: None,
                        exclude: None,
                        flavor: SelectFlavor::Standard,
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
                    connect_by: None,
                    value_table_mode: None,
                    exclude: None,
                    flavor: SelectFlavor::Standard,
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
}
