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

use sqlparser::ast::{Statement, VisitorMut};

pub struct ExplainVisitor {
    pub is_explain: bool,
    pub is_analyze: bool,
    pub is_verbose: bool,
}

impl ExplainVisitor {
    pub fn new() -> Self {
        Self {
            is_explain: false,
            is_analyze: false,
            is_verbose: false,
        }
    }
}
impl VisitorMut for ExplainVisitor {
    type Break = ();

    fn pre_visit_statement(&mut self, statement: &mut Statement) -> ControlFlow<Self::Break> {
        match statement {
            Statement::Explain {
                analyze,
                verbose,
                statement: inner_statement,
                ..
            } => {
                self.is_explain = true;
                self.is_analyze = *analyze;
                self.is_verbose = *verbose;
                // Replace the EXPLAIN statement with its inner statement
                *statement = (**inner_statement).clone();
                ControlFlow::Break(())
            }
            _ => ControlFlow::Continue(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use sqlparser::{ast::SetExpr, dialect::PostgreSqlDialect};

    use super::*;

    #[test]
    fn test_explain_visitor() {
        // Test EXPLAIN query
        let sql = "EXPLAIN SELECT * FROM logs WHERE level = 'error'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&PostgreSqlDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut explain_visitor = ExplainVisitor::new();
        let _ = statement.visit(&mut explain_visitor);

        assert!(explain_visitor.is_explain);
        assert!(!explain_visitor.is_analyze);
        assert!(!explain_visitor.is_verbose);

        // After visiting, the statement should be the inner SELECT
        if let Statement::Query(query) = &statement {
            if let SetExpr::Select(select) = query.body.as_ref() {
                assert!(select.selection.is_some());
            } else {
                panic!("Expected Select statement");
            }
        } else {
            panic!("Expected Query statement");
        }
    }

    #[test]
    fn test_explain_analyze_visitor() {
        // Test EXPLAIN ANALYZE query
        let sql = "EXPLAIN ANALYZE SELECT * FROM logs WHERE level = 'error'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&PostgreSqlDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut explain_visitor = ExplainVisitor::new();
        let _ = statement.visit(&mut explain_visitor);

        assert!(explain_visitor.is_explain);
        assert!(explain_visitor.is_analyze);
        assert!(!explain_visitor.is_verbose);
    }

    #[test]
    fn test_explain_verbose_visitor() {
        // Test EXPLAIN VERBOSE query
        let sql = "EXPLAIN VERBOSE SELECT * FROM logs WHERE level = 'error'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&PostgreSqlDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut explain_visitor = ExplainVisitor::new();
        let _ = statement.visit(&mut explain_visitor);

        assert!(explain_visitor.is_explain);
        assert!(!explain_visitor.is_analyze);
        assert!(explain_visitor.is_verbose);
    }

    #[test]
    fn test_explain_analyze_verbose_visitor() {
        // Test EXPLAIN ANALYZE VERBOSE query (non-parenthesized syntax)
        let sql = "EXPLAIN ANALYZE VERBOSE SELECT * FROM logs WHERE level = 'error'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&PostgreSqlDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut explain_visitor = ExplainVisitor::new();
        let _ = statement.visit(&mut explain_visitor);

        assert!(explain_visitor.is_explain);
        assert!(explain_visitor.is_analyze);
        assert!(explain_visitor.is_verbose);
    }

    #[test]
    fn test_non_explain_query() {
        // Test regular SELECT query
        let sql = "SELECT * FROM logs WHERE level = 'error'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&PostgreSqlDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut explain_visitor = ExplainVisitor::new();
        let _ = statement.visit(&mut explain_visitor);

        assert!(!explain_visitor.is_explain);
        assert!(!explain_visitor.is_analyze);
        assert!(!explain_visitor.is_verbose);
    }

    #[test]
    fn test_explain_sql_mutation() {
        // Test that EXPLAIN is stripped from the SQL and converted to inner SELECT
        let sql = "EXPLAIN SELECT * FROM logs WHERE level = 'error'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&PostgreSqlDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();

        // Verify it's initially an EXPLAIN statement
        assert!(matches!(statement, Statement::Explain { .. }));

        let mut explain_visitor = ExplainVisitor::new();
        let _ = statement.visit(&mut explain_visitor);

        // After visiting, the statement should be converted to the inner query
        assert!(matches!(statement, Statement::Query(_)));

        // The converted SQL should not contain EXPLAIN
        let converted_sql = statement.to_string();
        assert!(!converted_sql.to_uppercase().contains("EXPLAIN"));
        assert!(converted_sql.to_uppercase().contains("SELECT"));
        assert!(converted_sql.contains("logs"));
        assert!(converted_sql.contains("level = 'error'"));
    }

    #[test]
    fn test_explain_analyze_sql_mutation() {
        // Test that EXPLAIN ANALYZE is stripped from the SQL
        let sql = "EXPLAIN ANALYZE SELECT count(*) FROM logs";
        let mut statement = sqlparser::parser::Parser::parse_sql(&PostgreSqlDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();

        assert!(matches!(statement, Statement::Explain { .. }));

        let mut explain_visitor = ExplainVisitor::new();
        let _ = statement.visit(&mut explain_visitor);

        assert!(explain_visitor.is_explain);
        assert!(explain_visitor.is_analyze);

        // The statement should be converted to the inner query
        assert!(matches!(statement, Statement::Query(_)));

        // The converted SQL should not contain EXPLAIN or ANALYZE
        let converted_sql = statement.to_string();
        assert!(!converted_sql.to_uppercase().contains("EXPLAIN"));
        assert!(!converted_sql.to_uppercase().contains("ANALYZE"));
        assert!(converted_sql.to_uppercase().contains("SELECT"));
        assert!(converted_sql.contains("count(*)"));
    }

    #[test]
    fn test_explain_verbose_sql_mutation() {
        // Test that EXPLAIN VERBOSE is stripped from the SQL
        let sql = "EXPLAIN VERBOSE SELECT name, age FROM users ORDER BY name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&PostgreSqlDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut explain_visitor = ExplainVisitor::new();
        let _ = statement.visit(&mut explain_visitor);

        assert!(explain_visitor.is_explain);
        assert!(!explain_visitor.is_analyze);
        assert!(explain_visitor.is_verbose);

        // The converted SQL should preserve the original query structure
        let converted_sql = statement.to_string();
        assert!(!converted_sql.to_uppercase().contains("EXPLAIN"));
        assert!(!converted_sql.to_uppercase().contains("VERBOSE"));
        assert!(converted_sql.contains("name, age"));
        assert!(converted_sql.contains("users"));
        assert!(converted_sql.to_uppercase().contains("ORDER BY"));
    }

    #[test]
    fn test_explain_analyze_verbose_sql_mutation() {
        // Test complex EXPLAIN ANALYZE VERBOSE syntax
        let sql =
            "EXPLAIN ANALYZE VERBOSE SELECT * FROM logs WHERE timestamp > 1000 GROUP BY level";
        let mut statement = sqlparser::parser::Parser::parse_sql(&PostgreSqlDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut explain_visitor = ExplainVisitor::new();
        let _ = statement.visit(&mut explain_visitor);

        assert!(explain_visitor.is_explain);
        assert!(explain_visitor.is_analyze);
        assert!(explain_visitor.is_verbose);

        // Verify the inner query is preserved correctly
        let converted_sql = statement.to_string();
        assert!(!converted_sql.to_uppercase().contains("EXPLAIN"));
        assert!(!converted_sql.to_uppercase().contains("ANALYZE"));
        assert!(!converted_sql.to_uppercase().contains("VERBOSE"));
        assert!(converted_sql.contains("timestamp > 1000"));
        assert!(converted_sql.to_uppercase().contains("GROUP BY"));
        assert!(converted_sql.contains("level"));
    }
}

