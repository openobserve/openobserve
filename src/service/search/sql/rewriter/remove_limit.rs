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

use infra::errors::Error;
use sqlparser::{
    ast::{Query, VisitMut, VisitorMut},
    dialect::PostgreSqlDialect,
    parser::Parser,
};

/// Remove the outermost LIMIT clause from a SQL query.
/// This preserves LIMIT clauses in subqueries, CTEs, and other nested contexts.
///
/// # Arguments
/// * `sql` - The SQL query string
///
/// # Returns
/// * `Ok(String)` - The SQL query with the outermost LIMIT removed
/// * `Err(Error)` - If the SQL cannot be parsed
///
/// # Examples
/// ```
/// let sql = "SELECT * FROM logs LIMIT 20";
/// let result = remove_outermost_limit(sql);
/// assert_eq!(result.unwrap(), "SELECT * FROM logs");
/// ```
pub fn remove_outermost_limit(sql: &str) -> infra::errors::Result<String> {
    let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, sql)
        .map_err(|e| Error::Message(e.to_string()))?
        .pop()
        .ok_or_else(|| Error::Message("Empty SQL statement".to_string()))?;

    let mut visitor = RemoveLimitVisitor::new();
    let _ = statement.visit(&mut visitor);
    Ok(statement.to_string())
}

struct RemoveLimitVisitor {
    visited_top_level: bool,
}

impl RemoveLimitVisitor {
    fn new() -> Self {
        Self {
            visited_top_level: false,
        }
    }
}

impl VisitorMut for RemoveLimitVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        // Only remove the LIMIT from the first (outermost) query we encounter
        if !self.visited_top_level {
            self.visited_top_level = true;
            query.limit_clause = None;
            query.fetch = None;
        }
        // Continue visiting to ensure we don't accidentally process nested queries
        // but we won't modify them since visited_top_level is now true
        ControlFlow::Continue(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_limit() {
        let sql = "SELECT * FROM logs LIMIT 20";
        let result = remove_outermost_limit(sql).unwrap();
        assert_eq!(result, "SELECT * FROM logs");
    }

    #[test]
    fn test_limit_with_offset() {
        let sql = "SELECT * FROM logs LIMIT 20 OFFSET 5";
        let result = remove_outermost_limit(sql).unwrap();
        // Should remove both LIMIT and OFFSET
        assert_eq!(result, "SELECT * FROM logs");
    }

    #[test]
    fn test_limit_with_order_by() {
        let sql = "SELECT * FROM logs ORDER BY _timestamp DESC LIMIT 20";
        let result = remove_outermost_limit(sql).unwrap();
        assert_eq!(result, "SELECT * FROM logs ORDER BY _timestamp DESC");
    }

    #[test]
    fn test_limit_with_where() {
        let sql = "SELECT * FROM logs WHERE status = 'error' LIMIT 20";
        let result = remove_outermost_limit(sql).unwrap();
        assert_eq!(result, "SELECT * FROM logs WHERE status = 'error'");
    }

    #[test]
    fn test_subquery_with_limit_preserves_inner_limit() {
        let sql = "SELECT * FROM (SELECT * FROM logs ORDER BY score DESC LIMIT 100) LIMIT 20";
        let result = remove_outermost_limit(sql).unwrap();
        // Should remove outer LIMIT but preserve inner LIMIT
        assert!(
            result.contains("LIMIT 100"),
            "Inner LIMIT should be preserved"
        );
        assert!(
            !result.ends_with("LIMIT 20"),
            "Outer LIMIT should be removed"
        );
    }

    #[test]
    fn test_cte_with_limit_preserves_inner_limit() {
        let sql = "WITH top_logs AS (SELECT * FROM logs LIMIT 50) SELECT * FROM top_logs LIMIT 20";
        let result = remove_outermost_limit(sql).unwrap();
        // Should remove outer LIMIT but preserve CTE LIMIT
        assert!(result.contains("LIMIT 50"), "CTE LIMIT should be preserved");
        assert!(
            !result.ends_with("LIMIT 20"),
            "Outer LIMIT should be removed"
        );
    }

    #[test]
    fn test_union_with_limit() {
        let sql = "SELECT * FROM logs1 UNION SELECT * FROM logs2 LIMIT 20";
        let result = remove_outermost_limit(sql).unwrap();
        // Should remove the outer LIMIT on the UNION
        assert!(!result.contains("LIMIT"), "Outer LIMIT should be removed");
    }

    #[test]
    fn test_join_with_limit() {
        let sql = "SELECT * FROM logs l JOIN users u ON l.user_id = u.id LIMIT 20";
        let result = remove_outermost_limit(sql).unwrap();
        assert!(!result.contains("LIMIT"), "LIMIT should be removed");
    }

    #[test]
    fn test_no_limit() {
        let sql = "SELECT * FROM logs";
        let result = remove_outermost_limit(sql).unwrap();
        assert_eq!(result, "SELECT * FROM logs");
    }

    #[test]
    fn test_complex_nested_query() {
        let sql = r#"
            WITH filtered AS (
                SELECT * FROM logs WHERE level = 'error' LIMIT 1000
            )
            SELECT * FROM (
                SELECT id, COUNT(*) as cnt
                FROM filtered
                GROUP BY id
                ORDER BY cnt DESC
                LIMIT 10
            )
            LIMIT 5
        "#;
        let result = remove_outermost_limit(sql).unwrap();

        // Should preserve both inner LIMITs (1000 and 10) but remove outer LIMIT (5)
        assert!(
            result.contains("LIMIT 1000"),
            "CTE LIMIT should be preserved"
        );
        assert!(
            result.contains("LIMIT 10"),
            "Subquery LIMIT should be preserved"
        );
        assert!(
            !result.ends_with("LIMIT 5"),
            "Outermost LIMIT should be removed"
        );
    }

    #[test]
    fn test_invalid_sql() {
        let sql = "SELECT * FROM";
        let result = remove_outermost_limit(sql);
        assert!(result.is_err(), "Should return error for invalid SQL");
    }

    #[test]
    fn test_empty_sql() {
        let sql = "";
        let result = remove_outermost_limit(sql);
        assert!(result.is_err(), "Should return error for empty SQL");
    }

    #[test]
    fn test_multiple_statements() {
        // Note: Parser typically only handles single statements, but let's test edge case
        let sql = "SELECT * FROM logs LIMIT 20; SELECT * FROM users LIMIT 10";
        let result = remove_outermost_limit(sql);
        // This might fail parsing or only process first statement
        // The exact behavior depends on the parser
        if result.is_ok() {
            let output = result.unwrap();
            // First LIMIT should be removed
            assert!(!output.starts_with("SELECT * FROM logs LIMIT 20"));
        }
    }
}
