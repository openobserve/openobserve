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

use sqlparser::{ast::Statement, dialect::GenericDialect, parser::Parser};

use super::{
    helpers::{has_cte, has_join, has_limit},
    visitors::{has_distinct, has_subquery, has_union, is_multi_search_eligible_for_histogram},
};

/// The histogram reuses only the WHERE on one stream, so it is exact only for a plain
/// single-table query; anything else gets its total from a page-count query instead.
pub fn is_eligible_for_histogram(
    query: &str,
    is_multi_stream_search: bool,
) -> Result<bool, sqlparser::parser::ParserError> {
    if is_multi_stream_search {
        return is_multi_search_eligible_for_histogram(query);
    }
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    let eligible = ast.iter().all(|statement| match statement {
        Statement::Query(query) => {
            !(has_subquery(statement)
                || has_distinct(statement)
                || has_limit(query)
                || has_cte(query)
                || has_join(query)
                || has_union(query))
        }
        _ => true,
    });
    Ok(eligible)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eligible(query: &str) -> bool {
        is_eligible_for_histogram(query, false).unwrap()
    }

    #[test]
    fn test_is_eligible_for_histogram_plain_queries() {
        assert!(eligible("SELECT x FROM t"));
        assert!(eligible(
            r#"SELECT * FROM "olympics" WHERE _timestamp >= 1716854400000 AND level = 'error'"#
        ));
        assert!(eligible("SELECT x, count(*) FROM t WHERE y > 1 GROUP BY x"));
    }

    #[test]
    fn test_is_eligible_for_histogram_rejects_non_plain_queries() {
        for query in [
            "SELECT DISTINCT x FROM t",
            "SELECT x FROM t LIMIT 10",
            "WITH cte AS (SELECT x FROM t) SELECT x FROM cte",
            "SELECT x FROM t1 JOIN t2 ON t1.id = t2.id",
            "SELECT x FROM t1, t2",
            "SELECT x FROM t1 UNION SELECT x FROM t2",
        ] {
            assert!(!eligible(query), "{query}");
        }
    }

    #[test]
    fn test_is_eligible_for_histogram_rejects_subqueries() {
        for query in [
            "SELECT x FROM (SELECT x FROM t)",
            "SELECT x FROM t WHERE x IN (SELECT x FROM u)",
            "SELECT x FROM t WHERE EXISTS (SELECT 1 FROM u WHERE u.x = t.x)",
            "SELECT x FROM t WHERE x > (SELECT max(x) FROM u)",
            "SELECT (SELECT max(x) FROM u) AS m FROM t",
            "WITH ids AS (SELECT x FROM u) SELECT x FROM t WHERE x IN (SELECT x FROM ids)",
            "SELECT x FROM t WHERE x IN (SELECT x FROM u) LIMIT 10",
        ] {
            assert!(!eligible(query), "{query}");
        }
    }

    #[test]
    fn test_is_eligible_for_histogram_multi_stream_union_all() {
        assert!(
            is_eligible_for_histogram("SELECT x FROM t1 UNION ALL SELECT x FROM t2", true).unwrap()
        );
        assert!(
            !is_eligible_for_histogram("SELECT x FROM t1 UNION SELECT x FROM t2", true).unwrap()
        );
    }
}
