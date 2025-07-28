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

use anyhow::Result;
use config::utils::sql::is_eligible_for_histogram;
use sqlparser::{
    ast::{SetExpr, Statement},
    dialect::PostgreSqlDialect,
    parser::Parser,
};

/// Converts an original query to a histogram query
/// Extracts WHERE clause and builds histogram query with provided stream name
pub fn convert_to_histogram_query(original_query: &str, stream_names: &[String]) -> Result<String> {
    let is_eligible = is_eligible_for_histogram(original_query)?;
    if !is_eligible {
        return Err(anyhow::anyhow!(
            "Histogram unavailable for SUBQUERY, CTE, DISTINCT and LIMIT queries."
        ));
    }

    // Parse the original query
    let statements = Parser::parse_sql(&PostgreSqlDialect {}, original_query)
        .map_err(|e| anyhow::anyhow!("Failed to parse SQL query: {}", e))?;

    let statement = statements
        .first()
        .ok_or_else(|| anyhow::anyhow!("No SQL statement found"))?;

    // Extract WHERE clause only
    let where_clause = extract_where_clause(statement)?;
    let stream_name = stream_names
        .first()
        .ok_or_else(|| anyhow::anyhow!("No stream name found"))?;

    // Build histogram query
    let mut histogram_query = format!(
        "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"{}\"",
        stream_name
    );

    // Add WHERE clause if it exists
    if !where_clause.is_empty() {
        histogram_query.push_str(&format!(" WHERE {}", where_clause));
    }

    // Add GROUP BY and ORDER BY
    histogram_query.push_str(" GROUP BY zo_sql_key ORDER BY zo_sql_key DESC");

    Ok(histogram_query)
}

/// Extract WHERE clause from SQL statement
fn extract_where_clause(statement: &Statement) -> Result<String> {
    if let Statement::Query(query) = statement {
        if let SetExpr::Select(select) = &*query.body {
            // Extract WHERE clause
            let where_clause = select
                .selection
                .as_ref()
                .map(|clause| clause.to_string())
                .unwrap_or_default();

            Ok(where_clause)
        } else {
            Err(anyhow::anyhow!("Query is not a SELECT statement"))
        }
    } else {
        Err(anyhow::anyhow!("Statement is not a query"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_simple_query() {
        let original_query = "SELECT * FROM \"logs\" WHERE status = 500";
        let stream_names = vec!["logs".to_string()];
        let result = convert_to_histogram_query(original_query, &stream_names).unwrap();

        let expected = "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"logs\" WHERE status = 500 GROUP BY zo_sql_key ORDER BY zo_sql_key DESC";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_convert_query_without_where() {
        let original_query = "SELECT * FROM \"logs\"";
        let stream_names = vec!["logs".to_string()];
        let result = convert_to_histogram_query(original_query, &stream_names).unwrap();

        let expected = "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"logs\" GROUP BY zo_sql_key ORDER BY zo_sql_key DESC";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_convert_complex_where() {
        let original_query = "SELECT * FROM \"api_logs\" WHERE status >= 400 AND level = 'error' AND user_id IS NOT NULL";
        let stream_names = vec!["api_logs".to_string()];
        let result = convert_to_histogram_query(original_query, &stream_names).unwrap();

        let expected = "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"api_logs\" WHERE status >= 400 AND level = 'error' AND user_id IS NOT NULL GROUP BY zo_sql_key ORDER BY zo_sql_key DESC";
        assert_eq!(result, expected);
    }

    #[test]
    fn test_convert_query_with_group_by() {
        let original_query = "SELECT * FROM \"api_logs\" GROUP BY level";
        let stream_names = vec!["api_logs".to_string()];
        let result = convert_to_histogram_query(original_query, &stream_names).unwrap();

        let expected = "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM \"api_logs\" GROUP BY zo_sql_key ORDER BY zo_sql_key DESC";
        assert_eq!(result, expected);
    }
}
