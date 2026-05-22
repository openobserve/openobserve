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
    helpers::{has_group_by, has_having, has_join, is_aggregate_in_select},
    visitors::{has_distinct, has_subquery, has_union},
};

pub fn is_complex_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if let Statement::Query(query) = statement
            && (is_aggregate_in_select(query)
                || has_group_by(query)
                || has_having(query)
                || has_join(query)
                || has_union(query))
        {
            return Ok(true);
        } else if has_distinct(statement) || has_subquery(statement) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_complex_query() {
        assert!(is_complex_query("SELECT count(*) FROM t").unwrap());
        assert!(is_complex_query("SELECT max(val), min(val) FROM t").unwrap());
        assert!(is_complex_query("SELECT x FROM t GROUP BY x").unwrap());
        assert!(is_complex_query("SELECT DISTINCT x FROM t").unwrap());
        assert!(!is_complex_query("SELECT x FROM t").unwrap());
        assert!(!is_complex_query("SELECT x, y FROM t WHERE x > 1").unwrap());
    }

    #[test]
    fn test_is_complex_query_having_join_union_subquery() {
        assert!(
            is_complex_query("SELECT x, count(*) FROM t GROUP BY x HAVING count(*) > 1").unwrap()
        );

        assert!(is_complex_query("SELECT a.x FROM a JOIN b ON a.id = b.id").unwrap());

        assert!(is_complex_query("SELECT x FROM t1 UNION SELECT x FROM t2").unwrap());

        assert!(is_complex_query("SELECT x FROM t WHERE x IN (SELECT x FROM t2)").unwrap());
    }

    #[test]
    fn test_is_aggregate_expression_via_binary_op_and_nested() {
        assert!(is_complex_query("SELECT count(*) + 1 FROM t").unwrap());
        assert!(is_complex_query("SELECT (count(*)) FROM t").unwrap());
    }

    #[test]
    fn test_is_aggregate_expression_via_cast_and_unary() {
        assert!(is_complex_query("SELECT CAST(count(*) AS TEXT) FROM t").unwrap());
    }

    #[test]
    fn test_is_aggregate_expression_case_with_aggregate() {
        assert!(is_complex_query("SELECT CASE WHEN 1=1 THEN count(*) ELSE 0 END FROM t").unwrap());
    }

    #[test]
    fn test_is_complex_query_count_distinct_function() {
        assert!(is_complex_query("SELECT count(DISTINCT x) FROM t").unwrap());
    }

    #[test]
    fn test_is_aggregate_expression_unary_op_with_aggregate() {
        assert!(is_complex_query("SELECT -count(*) FROM t").unwrap());
    }

    #[test]
    fn test_is_aggregate_expression_case_else_result_aggregate() {
        assert!(is_complex_query("SELECT CASE WHEN 1=0 THEN 0 ELSE count(*) END FROM t").unwrap());
    }

    #[test]
    fn check_is_simple_aggregate() {
        let query = r#"SELECT histogram(_timestamp) AS zo_sql_time, "kubernetes_docker_id" AS zo_sql_key, SUM(count) AS zo_sql_num FROM "distinct_values_logs_default22" GROUP BY zo_sql_time, zo_sql_key ORDER BY zo_sql_time ASC, zo_sql_num DESC"#;
        let ab = is_complex_query(query);
        print!("{ab:?}");
    }
}
