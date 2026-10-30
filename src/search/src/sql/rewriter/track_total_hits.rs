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
    SetExpr, TableFactor, TableWithJoins, Values, VisitorMut,
    helpers::attached_token::AttachedToken,
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
            SetExpr::Select(select) if select.distinct.is_none() => {
                select.group_by = GroupByExpr::Expressions(vec![], vec![]);
                select.having = None;
                select.sort_by = vec![];
                select.projection = vec![count_star_item()];
                query.order_by = None;
            }
            // DISTINCT and set operations keep the original query as a derived table
            SetExpr::Select(_) | SetExpr::SetOperation { .. } => wrap_in_count_subquery(query),
            _ => {}
        }
        ControlFlow::Break(())
    }
}

fn count_star_item() -> SelectItem {
    SelectItem::ExprWithAlias {
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
    }
}

// moves the original query into the derived table instead of cloning it, the tree may be deep
fn wrap_in_count_subquery(query: &mut Query) {
    let placeholder = Box::new(SetExpr::Values(Values {
        explicit_row: false,
        value_keyword: false,
        rows: vec![],
    }));
    let original_query = Query {
        with: query.with.take(),
        body: std::mem::replace(&mut query.body, placeholder),
        order_by: query.order_by.take(),
        limit_clause: query.limit_clause.take(),
        fetch: query.fetch.take(),
        for_clause: query.for_clause.take(),
        locks: std::mem::take(&mut query.locks),
        settings: query.settings.take(),
        format_clause: query.format_clause.take(),
        pipe_operators: std::mem::take(&mut query.pipe_operators),
    };
    *query.body = SetExpr::Select(Box::new(Select {
        select_token: AttachedToken::empty(),
        distinct: None,
        top: None,
        top_before_distinct: false,
        projection: vec![count_star_item()],
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
    }));
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
