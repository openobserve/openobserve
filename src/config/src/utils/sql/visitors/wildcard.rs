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

use sqlparser::ast::{Query, SelectItem, SetExpr, Statement, Visit, Visitor};

// only check the query like `select * from table`, do not check the union
// this function only check the simple query that [`super::is_complex_query`] return false
pub fn has_wildcard(statement: &Statement) -> bool {
    let mut visitor = WildcardVisitor::new();
    let _ = statement.visit(&mut visitor);
    visitor.has_wildcard
}

struct WildcardVisitor {
    pub has_wildcard: bool,
}

impl WildcardVisitor {
    fn new() -> Self {
        Self {
            has_wildcard: false,
        }
    }
}

impl Visitor for WildcardVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        if let SetExpr::Select(select) = query.body.as_ref() {
            for item in &select.projection {
                if matches!(item, SelectItem::Wildcard(_)) {
                    self.has_wildcard = true;
                    return ControlFlow::Break(());
                }
            }
        }
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::{dialect::GenericDialect, parser::Parser};

    use super::*;

    fn parse(sql: &str) -> Statement {
        Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .into_iter()
            .next()
            .unwrap()
    }

    #[test]
    fn wildcard_simple_select_star() {
        let stmt = parse("SELECT * FROM t");
        assert!(has_wildcard(&stmt));
    }

    #[test]
    fn wildcard_select_named_columns() {
        let stmt = parse("SELECT a, b FROM t");
        assert!(!has_wildcard(&stmt));
    }

    #[test]
    fn wildcard_mixed_projection() {
        let stmt = parse("SELECT a, * FROM t");
        assert!(has_wildcard(&stmt));
    }

    #[test]
    fn wildcard_qualified_wildcard_is_not_match() {
        // SelectItem::QualifiedWildcard is a different variant than
        // SelectItem::Wildcard and is intentionally not matched.
        let stmt = parse("SELECT t.* FROM t");
        assert!(!has_wildcard(&stmt));
    }

    #[test]
    fn wildcard_count_star_is_not_match() {
        // COUNT(*) is a function call, not a SelectItem::Wildcard projection.
        let stmt = parse("SELECT COUNT(*) FROM t");
        assert!(!has_wildcard(&stmt));
    }

    #[test]
    fn wildcard_with_where_clause() {
        let stmt = parse("SELECT * FROM t WHERE a = 1");
        assert!(has_wildcard(&stmt));
    }

    #[test]
    fn wildcard_in_subquery() {
        let stmt = parse("SELECT a FROM (SELECT * FROM t) sub");
        assert!(has_wildcard(&stmt));
    }

    #[test]
    fn wildcard_in_cte() {
        let stmt = parse("WITH cte AS (SELECT * FROM t) SELECT a FROM cte");
        assert!(has_wildcard(&stmt));
    }

    #[test]
    fn wildcard_top_level_union_is_skipped() {
        // The outer Query body is a SetOperation, not a Select, so the
        // projection check is skipped per the visitor's contract.
        let stmt = parse("SELECT * FROM a UNION SELECT b FROM c");
        assert!(!has_wildcard(&stmt));
    }

    #[test]
    fn wildcard_non_query_statement() {
        let stmt = parse("CREATE TABLE t (a INT)");
        assert!(!has_wildcard(&stmt));
    }
}
