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

pub fn is_eligible_for_histogram(
    query: &str,
    is_multi_stream_search: bool,
) -> Result<(bool, bool), sqlparser::parser::ParserError> {
    if is_multi_stream_search {
        let is_eligible = is_multi_search_eligible_for_histogram(query)?;
        return Ok((is_eligible, false));
    }
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if let Statement::Query(query) = statement {
            if has_subquery(statement) {
                return Ok((true, true));
            } else if has_distinct(statement)
                || has_limit(query)
                || has_cte(query)
                || has_join(query)
                || has_union(query)
            {
                return Ok((false, false));
            }
        }
    }
    Ok((true, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_is_eligible_for_histogram_for_queries_should_be_true() {
        let queries = [
            r#"SELECT * FROM "olympics" WHERE _timestamp >= 1716854400000 AND _timestamp <= 1716940800000"#,
            r#"SELECT * FROM "olympics" WHERE _timestamp >= 1716854400000 AND _timestamp <= 1716940800000"#,
        ];
        for query in queries.iter() {
            let (is_eligible, is_sub_query) = is_eligible_for_histogram(query, false).unwrap();
            assert_eq!(is_eligible, true);
            assert_eq!(is_sub_query, false);
        }
    }

    #[test]
    fn check_is_eligible_for_histogram_for_queries_should_be_false() {
        let queries = [
            r#"WITH cte AS (SELECT * FROM "olympics") SELECT * FROM cte"#,
            r#"SELECT DISTINCT * FROM "olympics""#,
            r#"SELECT * FROM "olympics" LIMIT 100"#,
        ];
        for query in queries.iter() {
            let (is_eligible, is_sub_query) = is_eligible_for_histogram(query, false).unwrap();
            assert_eq!(is_eligible, false);
            if query.contains("SELECT * FROM (SELECT") {
                assert_eq!(is_sub_query, true);
            } else {
                assert_eq!(is_sub_query, false);
            }
        }
    }

    #[test]
    fn test_is_eligible_for_histogram_basic() {
        let (eligible, is_sub) = is_eligible_for_histogram("SELECT x FROM t", false).unwrap();
        assert!(eligible);
        assert!(!is_sub);

        let (eligible, _) = is_eligible_for_histogram("SELECT DISTINCT x FROM t", false).unwrap();
        assert!(!eligible);

        let (eligible, _) = is_eligible_for_histogram("SELECT x FROM t LIMIT 10", false).unwrap();
        assert!(!eligible);

        let (eligible, is_sub) =
            is_eligible_for_histogram("SELECT x FROM (SELECT x FROM t)", false).unwrap();
        assert!(eligible);
        assert!(is_sub);
    }

    #[test]
    fn test_is_eligible_for_histogram_join_and_union_not_eligible() {
        let (eligible, _) =
            is_eligible_for_histogram("SELECT x FROM t1 JOIN t2 ON t1.id = t2.id", false).unwrap();
        assert!(!eligible);

        let (eligible, _) =
            is_eligible_for_histogram("SELECT x FROM t1 UNION SELECT x FROM t2", false).unwrap();
        assert!(!eligible);
    }

    #[test]
    fn test_is_eligible_for_histogram_multi_stream_union_all() {
        let (eligible, is_sub) =
            is_eligible_for_histogram("SELECT x FROM t1 UNION ALL SELECT x FROM t2", true).unwrap();
        assert!(eligible);
        assert!(!is_sub);

        let (eligible, _) =
            is_eligible_for_histogram("SELECT x FROM t1 UNION SELECT x FROM t2", true).unwrap();
        assert!(!eligible);
    }

    #[test]
    fn test_is_eligible_for_histogram_cte_not_eligible() {
        let (eligible, _) =
            is_eligible_for_histogram("WITH cte AS (SELECT x FROM t) SELECT x FROM cte", false)
                .unwrap();
        assert!(!eligible);
    }
}
