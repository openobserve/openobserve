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

use datafusion::sql::{TableReference, planner::object_name_to_table_reference};
use hashbrown::HashMap;
use infra::schema::{SchemaCache, get_stream_setting_fts_fields};
use sqlparser::ast::{Expr, FunctionArguments, Query, TableFactor, VisitorMut, visit_expressions};

use crate::service::search::datafusion::udf::{
    match_all_hash_udf::MATCH_ALL_HASH_UDF_NAME,
    match_all_udf::{FUZZY_MATCH_ALL_UDF_NAME, MATCH_ALL_UDF_NAME},
};

/// get all item from match_all functions
pub struct MatchVisitor {
    // table_name, has_fst_fields
    pub has_fst_fields: HashMap<TableReference, bool>,
    // true, when has match_all
    pub has_match_all: bool,
    // true, when has match_all and support match_all
    pub is_support_match_all: bool,
    // true, when has match_all and the stream do not have full text search fields
    pub match_all_wrong_streams: bool,
}

impl MatchVisitor {
    pub fn new(total_schemas: &HashMap<TableReference, Arc<SchemaCache>>) -> Self {
        let mut has_fst_fields = HashMap::new();
        for (table_name, schema) in total_schemas {
            let stream_settings = infra::schema::unwrap_stream_settings(schema.schema());
            let fts_fields = get_stream_setting_fts_fields(&stream_settings);
            // check if schema don't have full text search field
            if fts_fields
                .into_iter()
                .all(|field| !schema.contains_field(&field))
            {
                has_fst_fields.insert(table_name.clone(), false);
            } else {
                has_fst_fields.insert(table_name.clone(), true);
            }
        }

        Self {
            has_fst_fields,
            has_match_all: false,
            is_support_match_all: true,
            match_all_wrong_streams: false,
        }
    }

    #[cfg(test)]
    pub fn new_test(has_fst_fields: HashMap<TableReference, bool>) -> Self {
        Self {
            has_fst_fields,
            has_match_all: false,
            is_support_match_all: true,
            match_all_wrong_streams: false,
        }
    }
}

impl VisitorMut for MatchVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if !self.has_match_all && has_match_all(expr) {
            self.has_match_all = true;
        }
        ControlFlow::Continue(())
    }

    // match_all will not support the below case
    //    1. join
    //    1. from clause is a subquery/cte and outside has match_all, select * from (select
    //       kubernetes_namespace_name, count(*) from t1 group by kubernetes_namespace_name order by
    //       count(*)) where match_all('error')
    // match_all support in subquery like below, for example:
    //    1. select * from (select * from t1 where match_all('error'))
    //    2. select * from t1 where id in (select id from t2 where match_all('error')) and
    //       match_all('critical')
    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_ref() {
            let has_match_all = select.selection.as_ref().is_some_and(has_match_all);

            // if from clause has more than one table, where clause should not have match_all
            // for example: select * from t1, t2 where t1.id = t2.id and match_all('error')
            if select.from.len() > 1 && has_match_all {
                self.is_support_match_all = false;
            }

            // if from clause has join, where clause should not have match_all
            // for example: select * from t1 join t2 on t1.id = t2.id and match_all('error')
            if select.from.iter().any(|from| !from.joins.is_empty()) && has_match_all {
                self.is_support_match_all = false;
            }

            // if from clause has a subquery, where clause should not have match_all
            // for example: select * from (select id from t1) where match_all('critical')
            if select
                .from
                .iter()
                .any(|from| matches!(from.relation, TableFactor::Derived { .. }))
                && has_match_all
            {
                self.is_support_match_all = false;
            }

            // if query has CTE (Common Table Expression), where clause should not have match_all
            // for example: with cte as (select id from t1) select * from cte where
            // match_all('error')
            if query.with.is_some() && has_match_all {
                self.is_support_match_all = false;
            }

            if has_match_all
                && let TableFactor::Table { name, .. } = &select.from[0].relation
                && let Ok(table) = object_name_to_table_reference(name.clone(), true)
                && let Some(has_fst_fields) = self.has_fst_fields.get(&table)
                && !*has_fst_fields
            {
                self.match_all_wrong_streams = true;
            }
        }
        ControlFlow::Continue(())
    }
}

pub fn has_match_all(expr: &Expr) -> bool {
    let mut has_match_all = false;
    let _ = visit_expressions(expr, |expr| {
        if let Expr::Function(func) = expr {
            let name = func.name.to_string().to_lowercase();
            if (name == MATCH_ALL_UDF_NAME
                || name == FUZZY_MATCH_ALL_UDF_NAME
                || name == MATCH_ALL_HASH_UDF_NAME)
                && let FunctionArguments::List(list) = &func.args
                && !list.args.is_empty()
            {
                has_match_all = true;
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(())
    });
    has_match_all
}

#[cfg(test)]
mod tests {

    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;

    fn has_fst_fields(table: Vec<(&str, bool)>) -> HashMap<TableReference, bool> {
        let mut total_schemas = HashMap::new();
        for (name, has_fst) in table {
            total_schemas.insert(TableReference::parse_str(name), has_fst);
        }
        total_schemas
    }

    #[test]
    fn test_match_visitor() {
        let sql = "SELECT * FROM logs WHERE match_all('error') AND match_all('critical')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        // Should extract match_all values
        assert!(match_visitor.has_match_all);
    }

    #[test]
    fn test_is_multi_stream_subquery() {
        let sql = "SELECT * FROM logs WHERE col IN (SELECT id FROM users)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_support_match_all);
        assert!(!match_visitor.has_match_all);
    }

    #[test]
    fn test_is_multi_stream_exists() {
        let sql = "SELECT * FROM logs WHERE EXISTS (SELECT 1 FROM users)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_support_match_all);
        assert!(!match_visitor.has_match_all);
    }

    #[test]
    fn test_is_multi_stream_join() {
        let sql = "SELECT * FROM logs l JOIN users u ON l.user_id = u.id";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_support_match_all);
        assert!(!match_visitor.has_match_all);
    }

    #[test]
    fn test_is_multi_stream_multiple_from() {
        let sql = "SELECT * FROM logs, users WHERE logs.user_id = users.id";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_support_match_all);
        assert!(!match_visitor.has_match_all);
    }

    #[test]
    fn test_is_multi_stream_derived_table() {
        let sql = "SELECT * FROM (SELECT id FROM users) u";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_support_match_all);
        assert!(!match_visitor.has_match_all);
    }

    #[test]
    fn test_is_single_stream() {
        let sql = "SELECT * FROM logs WHERE timestamp > '2023-01-01'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_support_match_all);
        assert!(!match_visitor.has_match_all);
        assert!(!match_visitor.match_all_wrong_streams);
    }

    #[test]
    fn test_is_multi_stream_with_match_all() {
        let sql = "SELECT * FROM logs l JOIN users u ON l.user_id = u.id WHERE match_all('error')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", true), ("users", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(!match_visitor.is_support_match_all);
        assert!(match_visitor.has_match_all);
        // for this case, we do not support match_all, so do not check match_all_wrong_streams
        // assert!(match_visitor.match_all_wrong_streams);
    }

    #[test]
    fn test_is_multi_from_with_match_all_unsupported() {
        let sql = "SELECT * FROM logs, users WHERE match_all('error')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", true), ("users", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(!match_visitor.is_support_match_all);
        assert!(match_visitor.has_match_all);
        // for this case, we do not support match_all, so do not check match_all_wrong_streams
        // assert!(match_visitor.match_all_wrong_streams);
    }

    #[test]
    fn test_derived_table_with_outer_match_all_unsupported() {
        let sql = "SELECT * FROM (SELECT id FROM users) u WHERE match_all('error')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("users", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(!match_visitor.is_support_match_all);
        assert!(match_visitor.has_match_all);
        // for this case, we do not support match_all, so do not check match_all_wrong_streams
        // assert!(match_visitor.match_all_wrong_streams);
    }

    #[test]
    fn test_inner_derived_match_all_supported() {
        let sql = "SELECT * FROM (SELECT * FROM logs WHERE match_all('error')) t";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_support_match_all);
        assert!(match_visitor.has_match_all);
        assert!(!match_visitor.match_all_wrong_streams);
    }

    #[test]
    fn test_cte_with_match_all_unsupported() {
        let sql = "WITH cte AS (SELECT id FROM users) SELECT * FROM cte WHERE match_all('error')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("users", false)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(!match_visitor.is_support_match_all);
        assert!(match_visitor.has_match_all);
        // for this case, we do not support match_all, so do not check match_all_wrong_streams
        // assert!(match_visitor.match_all_wrong_streams);
    }

    #[test]
    fn test_cte_with_match_all_supported() {
        let sql = "WITH cte AS (SELECT id FROM users WHERE match_all('error')) SELECT * FROM cte";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("users", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_support_match_all);
        assert!(match_visitor.has_match_all);
        assert!(!match_visitor.match_all_wrong_streams);
    }

    #[test]
    fn test_cte_with_match_all_supported2() {
        let sql = "WITH cte AS (SELECT id FROM logs WHERE match_all('error')) SELECT * FROM users where id in (select id from cte)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", true), ("users", false)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_support_match_all);
        assert!(match_visitor.has_match_all);
        assert!(!match_visitor.match_all_wrong_streams);
    }

    #[test]
    fn test_cte_with_match_all_supported3() {
        let sql = "WITH cte AS (SELECT id FROM logs WHERE match_all('error')) SELECT * FROM users where id in (select id from cte)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("logs", false), ("users", false)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_support_match_all);
        assert!(match_visitor.has_match_all);
        assert!(match_visitor.match_all_wrong_streams);
    }

    #[test]
    fn test_cte_with_match_all_supported4() {
        let sql = "WITH cte AS (SELECT id FROM users where log like '%error%') SELECT * FROM users where id in (select id from cte)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let has_fst_fields = has_fst_fields(vec![("users", true)]);
        let mut match_visitor = MatchVisitor::new_test(has_fst_fields);
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_support_match_all);
        assert!(!match_visitor.has_match_all);
        assert!(!match_visitor.match_all_wrong_streams);
    }
}
