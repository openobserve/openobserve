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

use std::{ops::ControlFlow, sync::Arc};

use datafusion::common::TableReference;
use hashbrown::{HashMap, HashSet};
use infra::schema::{SchemaCache, get_stream_setting_index_fields, unwrap_stream_settings};
use sqlparser::ast::{Expr, GroupByExpr, Query, TableFactor, VisitorMut};

use crate::service::search::sql::visitor::utils::{
    is_simple_count_query, is_simple_distinct_query, is_simple_histogram_query,
    is_simple_topn_query,
};

// check if the query is simple count query
// 1. doesn't have subquery
// 2. doesn't have join
// 3. doesn't have group by
// 4. doesn't have SetOperation(UNION/EXCEPT/INTERSECT of two queries)
// 5. doesn't have distinct
//
// either only has count(*) -> SimpleCount
// or has histogram(...) and count(*) -> SimpleHistogram
// or select id, count(*) as cnt from stream group by id order by cnt -> SimpleTopN
pub struct IndexOptimizeModeVisitor {
    index_fields: HashSet<String>,
    pub is_simple_count: bool,
    pub is_simple_histogram: bool,
    pub simple_topn: Option<(String, usize, bool)>,
    pub simple_distinct: Option<(String, usize, bool)>,
}

impl IndexOptimizeModeVisitor {
    pub fn new(schemas: &HashMap<TableReference, Arc<SchemaCache>>) -> Self {
        let index_fields = if let Some((_, schema)) = schemas.iter().next() {
            let stream_settings = unwrap_stream_settings(schema.schema());
            let index_fields = get_stream_setting_index_fields(&stream_settings);
            index_fields.into_iter().collect::<HashSet<_>>()
        } else {
            HashSet::new()
        };

        Self {
            index_fields,
            is_simple_count: false,
            is_simple_histogram: false,
            simple_topn: None,
            simple_distinct: None,
        }
    }

    #[cfg(test)]
    fn new_from_index_fields(index_fields: HashSet<String>) -> Self {
        Self {
            index_fields,
            is_simple_count: false,
            is_simple_histogram: false,
            simple_topn: None,
            simple_distinct: None,
        }
    }
}

impl VisitorMut for IndexOptimizeModeVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_ref() {
            if select.projection.len() > 2
                || select.distinct.is_some()
                || select.from.len() > 1
                || select.from.iter().any(|from| {
                    !from.joins.is_empty()
                        || matches!(
                            from.relation,
                            TableFactor::Derived { .. } | TableFactor::Function { .. }
                        )
                })
            {
                return ControlFlow::Break(());
            }

            if select.projection.len() == 1
                && matches!(select.group_by, GroupByExpr::Expressions(ref expr, _) if expr.is_empty())
            {
                self.is_simple_count = is_simple_count_query(select);
            } else if is_simple_histogram_query(select) {
                self.is_simple_histogram = true;
            } else if let Some(topn) = is_simple_topn_query(query)
                && self.index_fields.contains(&topn.0)
            {
                self.simple_topn = Some(topn);
            } else if let Some(distinct) = is_simple_distinct_query(query)
                && self.index_fields.contains(&distinct.0)
            {
                self.simple_distinct = Some(distinct);
            }
        }
        if self.is_simple_count
            || self.is_simple_histogram
            || self.simple_topn.is_some()
            || self.simple_distinct.is_some()
        {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if matches!(
            expr,
            Expr::Subquery(_) | Expr::Exists { .. } | Expr::InSubquery { .. }
        ) {
            self.is_simple_count = false;
            self.is_simple_histogram = false;
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::{
        ast::{Statement, VisitMut},
        dialect::GenericDialect,
    };

    use super::*;

    fn is_simple_count_query(statement: &mut Statement) -> bool {
        let index_fields = ["name".to_string()].into_iter().collect();
        let mut visitor = IndexOptimizeModeVisitor::new_from_index_fields(index_fields);
        let _ = statement.visit(&mut visitor);
        visitor.is_simple_count
    }

    #[test]
    fn test_is_simple_count_visit1() {
        let sql = "SELECT count(*) from t";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_count_query(&mut statement),);
    }

    #[test]
    fn test_is_simple_count_visit2() {
        let sql = "SELECT count(*) as cnt from t";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_count_query(&mut statement));
    }

    #[test]
    fn test_is_simple_count_visit3() {
        let sql = "SELECT count(*) as cnt from t where name = 'a'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_count_query(&mut statement));
    }

    #[test]
    fn test_is_simple_count_visit4() {
        let sql = "SELECT name, count(*) as cnt from t group by name order by name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_count_query(&mut statement));
    }

    #[test]
    fn test_is_simple_count_visit5() {
        let sql = "SELECT count(_timestamp) as cnt from t";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_count_query(&mut statement));
    }

    #[test]
    fn test_is_simple_count_visit6() {
        let sql = "SELECT count(*) as cnt from (select * from t)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_count_query(&mut statement));
    }

    fn is_simple_histogram_query(statement: &mut Statement) -> bool {
        let index_fields = ["_timestamp".to_string()].into_iter().collect();
        let mut visitor = IndexOptimizeModeVisitor::new_from_index_fields(index_fields);
        let _ = statement.visit(&mut visitor);
        visitor.is_simple_histogram
    }

    #[test]
    fn test_is_simple_histogram_visit1() {
        let sql = "select histogram(_timestamp, '10 second') AS zo_sql_key, count(*) AS zo_sql_num from \"default\"  GROUP BY zo_sql_key ORDER BY zo_sql_key";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_histogram_query(&mut statement));
    }

    #[test]
    fn test_is_simple_histogram_visit2() {
        // Test with additional where clause
        let sql = "select histogram(_timestamp, '1m') as h, count(*) from t where name = 'test'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_histogram_query(&mut statement));
    }

    #[test]
    fn test_is_simple_histogram_visit3() {
        // Test with wrong order of projections (count before histogram)
        let sql = "select count(*), histogram(_timestamp, '1m') from t";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_histogram_query(&mut statement));
    }

    #[test]
    fn test_is_simple_histogram_visit4() {
        // Test with subquery - should fail
        let sql = "select histogram(_timestamp, '1m'), count(*) from (select * from t)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_histogram_query(&mut statement));
    }

    #[test]
    fn test_is_simple_histogram_visit5() {
        // Test with additional projection - should fail
        let sql = "select histogram(_timestamp, '1m'), count(*), name from t";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_histogram_query(&mut statement));
    }

    #[test]
    fn test_is_simple_histogram_visit6() {
        // Test with join - should fail
        let sql = "select histogram(_timestamp, '1m'), count(*) from t1 join t2";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_histogram_query(&mut statement));
    }

    fn is_simple_topn_query(statement: &mut Statement) -> bool {
        let index_fields = ["id".to_string(), "name".to_string()].into_iter().collect();
        let mut visitor = IndexOptimizeModeVisitor::new_from_index_fields(index_fields);
        let _ = statement.visit(&mut visitor);
        visitor.simple_topn.is_some()
    }

    #[test]
    fn test_is_simple_topn_visit1() {
        // Test basic topn query
        let sql = "select id, count(*) as cnt from stream group by id order by cnt desc limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_topn_query(&mut statement));
    }

    #[test]
    fn test_is_simple_topn_visit2() {
        // Test with additional where clause
        let sql = "select name, count(*) as cnt from t where status = 'active' group by name order by cnt desc limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_topn_query(&mut statement));
    }

    #[test]
    fn test_is_simple_topn_visit3() {
        // test with count(*) asc
        let sql = "select id, count(*) from stream group by id order by count(*) asc limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_topn_query(&mut statement));
    }

    #[test]
    fn test_is_simple_topn_visit4() {
        // Test without group by - should fail
        let sql = "select id, count(*) from stream order by count(*) desc limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_topn_query(&mut statement));
    }

    #[test]
    fn test_is_simple_topn_visit5() {
        // Test without order by - should fail
        let sql = "select id, count(*) from stream group by id limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_topn_query(&mut statement));
    }

    #[test]
    fn test_is_simple_topn_visit6() {
        // Test with function as first projection - should fail
        let sql = "select upper(name), count(*) from stream group by upper(name) order by count(*) desc limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_topn_query(&mut statement));
    }

    #[test]
    fn test_is_simple_topn_visit7() {
        // Test with non-count function as second projection - should fail
        let sql = "select id, sum(value) from stream group by id order by sum(value) desc limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_topn_query(&mut statement));
    }

    fn is_simple_distinct_query(statement: &mut Statement) -> bool {
        let index_fields = ["id".to_string(), "name".to_string()].into_iter().collect();
        let mut visitor = IndexOptimizeModeVisitor::new_from_index_fields(index_fields);
        let _ = statement.visit(&mut visitor);
        visitor.simple_distinct.is_some()
    }

    #[test]
    fn test_is_simple_distinct_visit1() {
        // Test basic distinct query
        let sql = "select id from stream group by id order by id asc limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_distinct_query(&mut statement));
    }

    #[test]
    fn test_is_simple_distinct_visit2() {
        // Test with additional where clause
        let sql =
            "select name from t where status = 'active' group by name order by name asc limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_distinct_query(&mut statement));
    }

    #[test]
    fn test_is_simple_distinct_visit3() {
        // Test with desc order by
        let sql = "select id from stream group by id order by id desc limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_distinct_query(&mut statement));
    }

    #[test]
    fn test_is_simple_distinct_with_alias() {
        // Test with field alias in SELECT and ORDER BY using alias
        let sql = "select id as user_id from stream group by id order by user_id asc limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_distinct_query(&mut statement));
    }

    #[test]
    fn test_is_simple_distinct_with_alias_group_by_alias() {
        // Test with field alias in SELECT and GROUP BY using alias
        let sql = "select id as user_id from stream group by user_id order by user_id asc limit 10";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_distinct_query(&mut statement));
    }
}
