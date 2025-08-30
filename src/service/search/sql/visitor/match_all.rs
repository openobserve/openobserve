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

use sqlparser::ast::{Expr, FunctionArguments, Query, TableFactor, VisitorMut};

use crate::service::search::datafusion::udf::match_all_udf::{
    FUZZY_MATCH_ALL_UDF_NAME, MATCH_ALL_UDF_NAME,
};

/// get all item from match_all functions
pub struct MatchVisitor {
    pub has_match_all: bool,
    pub is_multi_stream: bool,
}

impl MatchVisitor {
    pub fn new() -> Self {
        Self {
            has_match_all: false,
            is_multi_stream: false,
        }
    }
}

impl VisitorMut for MatchVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(func) = expr {
            let name = func.name.to_string().to_lowercase();
            if (name == MATCH_ALL_UDF_NAME || name == FUZZY_MATCH_ALL_UDF_NAME)
                && let FunctionArguments::List(list) = &func.args
                && !list.args.is_empty()
            {
                self.has_match_all = true;
            }
        }
        if matches!(
            expr,
            Expr::Subquery(_) | Expr::Exists { .. } | Expr::InSubquery { .. }
        ) {
            self.is_multi_stream = true;
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_ref()
            && (select.from.len() > 1
                || select.from.iter().any(|from| {
                    !from.joins.is_empty()
                        || matches!(
                            from.relation,
                            TableFactor::Derived { .. } | TableFactor::Function { .. }
                        )
                }))
        {
            self.is_multi_stream = true;
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {

    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;

    #[test]
    fn test_match_visitor() {
        let sql = "SELECT * FROM logs WHERE match_all('error') AND match_all('critical')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut match_visitor = MatchVisitor::new();
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

        let mut match_visitor = MatchVisitor::new();
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_multi_stream);
        assert!(!match_visitor.has_match_all);
    }

    #[test]
    fn test_is_multi_stream_exists() {
        let sql = "SELECT * FROM logs WHERE EXISTS (SELECT 1 FROM users)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut match_visitor = MatchVisitor::new();
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_multi_stream);
        assert!(!match_visitor.has_match_all);
    }

    #[test]
    fn test_is_multi_stream_join() {
        let sql = "SELECT * FROM logs l JOIN users u ON l.user_id = u.id";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut match_visitor = MatchVisitor::new();
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_multi_stream);
        assert!(!match_visitor.has_match_all);
    }

    #[test]
    fn test_is_multi_stream_multiple_from() {
        let sql = "SELECT * FROM logs, users WHERE logs.user_id = users.id";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut match_visitor = MatchVisitor::new();
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_multi_stream);
        assert!(!match_visitor.has_match_all);
    }

    #[test]
    fn test_is_multi_stream_derived_table() {
        let sql = "SELECT * FROM (SELECT id FROM users) u";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut match_visitor = MatchVisitor::new();
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_multi_stream);
        assert!(!match_visitor.has_match_all);
    }

    #[test]
    fn test_is_single_stream() {
        let sql = "SELECT * FROM logs WHERE timestamp > '2023-01-01'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut match_visitor = MatchVisitor::new();
        let _ = statement.visit(&mut match_visitor);

        assert!(!match_visitor.is_multi_stream);
        assert!(!match_visitor.has_match_all);
    }

    #[test]
    fn test_is_multi_stream_with_match_all() {
        let sql = "SELECT * FROM logs l JOIN users u ON l.user_id = u.id WHERE match_all('error')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut match_visitor = MatchVisitor::new();
        let _ = statement.visit(&mut match_visitor);

        assert!(match_visitor.is_multi_stream);
        assert!(match_visitor.has_match_all);
    }
}
