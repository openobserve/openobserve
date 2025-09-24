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
use sqlparser::{
    ast::{Query, VisitMut, VisitorMut},
    dialect::PostgreSqlDialect,
};

use crate::service::search::{
    index::{IndexCondition, get_index_condition_from_expr},
    sql::{
        Sql,
        visitor::utils::{
            is_simple_count_query, is_simple_distinct_query, is_simple_histogram_query,
            is_simple_topn_query,
        },
    },
};

// this is for feature query_align_partitions_for_index
// but this is only can check the simple table,
// not able to check join or subquery
pub fn use_inverted_index(sql: &Sql) -> bool {
    let cfg = config::get_config();
    if !cfg.common.inverted_index_enabled {
        return false;
    }

    let mut index_condition = None;
    let mut can_optimize = false;
    let mut statement = sqlparser::parser::Parser::parse_sql(&PostgreSqlDialect {}, &sql.sql)
        .unwrap()
        .pop()
        .unwrap();
    if sql.stream_names.len() == 1 {
        let mut index_visitor = IndexVisitor::new(
            &sql.schemas,
            cfg.common.feature_query_remove_filter_with_index,
            cfg.common.inverted_index_count_optimizer_enabled,
        );
        let _ = statement.visit(&mut index_visitor);
        index_condition = index_visitor.index_condition;
        can_optimize = index_visitor.can_optimize;
    }

    index_condition.is_some() || can_optimize
}

// generate tantivy from sql and remove filter when we can
pub struct IndexVisitor {
    index_fields: HashSet<String>,
    is_remove_filter: bool,
    count_optimizer_enabled: bool,
    pub index_condition: Option<IndexCondition>,
    pub can_optimize: bool,
}

impl IndexVisitor {
    pub fn new(
        schemas: &HashMap<TableReference, Arc<SchemaCache>>,
        is_remove_filter: bool,
        count_optimizer_enabled: bool,
    ) -> Self {
        let index_fields = if let Some((_, schema)) = schemas.iter().next() {
            let stream_settings = unwrap_stream_settings(schema.schema());
            let index_fields = get_stream_setting_index_fields(&stream_settings);
            index_fields
                .into_iter()
                .filter_map(|v| schema.contains_field(&v).then_some(v))
                .collect::<HashSet<_>>()
        } else {
            HashSet::new()
        };
        Self {
            index_fields,
            is_remove_filter,
            count_optimizer_enabled,
            index_condition: None,
            can_optimize: false,
        }
    }

    #[cfg(test)]
    fn new_from_index_fields(
        index_fields: HashSet<String>,
        is_remove_filter: bool,
        count_optimizer_enabled: bool,
    ) -> Self {
        Self {
            index_fields,
            is_remove_filter,
            count_optimizer_enabled,
            index_condition: None,
            can_optimize: false,
        }
    }
}

impl VisitorMut for IndexVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_mut() {
            if let Some(expr) = select.selection.as_mut() {
                let (index, other_expr) = get_index_condition_from_expr(&self.index_fields, expr);
                self.index_condition = index;

                // if all filter is secondary index or full text index that term is simple, we can
                // always remove the filter
                let can_remove_filter = self
                    .index_condition
                    .as_ref()
                    .map(|v| v.can_remove_filter())
                    .unwrap_or(true);

                // make sure all filter in where clause can be used in inverted index
                if other_expr.is_none()
                    && select.selection.is_some()
                    && (self.count_optimizer_enabled || can_remove_filter)
                {
                    self.can_optimize = true;
                }

                // remove filter when we can
                if self.is_remove_filter || can_remove_filter {
                    select.selection = other_expr;
                }

                // addational check for simple distinct query
                // filter should all extract to index condition and index condition should have
                // the same field as the distinct field
                if can_remove_filter
                    && let Some(distinct) = is_simple_distinct_query(query)
                    && let Some(index) = self.index_condition.as_ref()
                    && !index.is_simple_str_match(&distinct.0)
                {
                    self.can_optimize = false;
                }
            } else if is_simple_count_query(select) || is_simple_histogram_query(select) {
                // if there is no filter, but have histogram or count, also can use index
                self.can_optimize = true;
            } else if let Some(topn) = is_simple_topn_query(query)
                && self.index_fields.contains(&topn.0)
            {
                // if there is no filter, but have topn, also can use index
                self.can_optimize = true;
            } else if let Some(distinct) = is_simple_distinct_query(query)
                && self.index_fields.contains(&distinct.0)
            {
                // if there is no filter, but have distinct, also can use index
                self.can_optimize = true;
            }
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;

    #[test]
    fn test_index_visitor1() {
        let sql = "SELECT * FROM t WHERE name = 'a' AND age = 1 AND (name = 'b' OR (match_all('good') AND match_all('bar'))) AND (match_all('foo') OR age = 2)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "name=a AND (name=b OR (_all:good AND _all:bar))";
        let expected_sql = "SELECT * FROM t WHERE age = 1 AND (match_all('foo') OR age = 2)";
        assert_eq!(
            index_visitor.index_condition.clone().unwrap().to_query(),
            expected
        );
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_index_visitor2() {
        let sql = "SELECT * FROM t WHERE name is not null AND age > 1 AND (match_all('foo') OR abs(age) = 2)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "";
        let expected_sql = "SELECT * FROM t WHERE name IS NOT NULL AND age > 1 AND (match_all('foo') OR abs(age) = 2)";
        assert_eq!(
            index_visitor
                .index_condition
                .clone()
                .unwrap_or_default()
                .to_query(),
            expected
        );
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_index_visitor3() {
        let sql = "SELECT * FROM t WHERE (name = 'b' OR (match_all('good') AND match_all('bar'))) OR (match_all('foo') OR age = 2)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "";
        let expected_sql = "SELECT * FROM t WHERE (name = 'b' OR (match_all('good') AND match_all('bar'))) OR (match_all('foo') OR age = 2)";
        assert_eq!(
            index_visitor
                .index_condition
                .clone()
                .unwrap_or_default()
                .to_query(),
            expected
        );
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_index_visitor4() {
        let sql = "SELECT * FROM t WHERE (name = 'b' OR (match_all('good') AND match_all('bar'))) OR (match_all('foo') AND name = 'c')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "((name=b OR (_all:good AND _all:bar)) OR (_all:foo AND name=c))";
        let expected_sql = "SELECT * FROM t";
        assert_eq!(
            index_visitor.index_condition.clone().unwrap().to_query(),
            expected
        );
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_index_visitor5() {
        let sql = "SELECT * FROM t WHERE (foo = 'b' OR foo = 'c') AND foo = 'd' AND ((match_all('good') AND match_all('bar')) OR (match_all('foo') AND name = 'c'))";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "((_all:good AND _all:bar) OR (_all:foo AND name=c))";
        let expected_sql = "SELECT * FROM t WHERE (foo = 'b' OR foo = 'c') AND foo = 'd'";
        assert_eq!(
            index_visitor.index_condition.clone().unwrap().to_query(),
            expected
        );
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_index_visitor_str_match() {
        let sql = "SELECT * FROM t WHERE str_match(name, 'value')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "str_match(name, 'value')";
        assert_eq!(
            index_visitor.index_condition.clone().unwrap().to_query(),
            expected
        );
    }

    // test index_visitor for str_match_ignore_case
    #[test]
    fn test_index_visitor_str_match_ignore_case() {
        let sql = "SELECT * FROM t WHERE str_match_ignore_case(name, 'value')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "str_match_ignore_case(name, 'value')";
        assert_eq!(
            index_visitor.index_condition.clone().unwrap().to_query(),
            expected
        );
    }
}
