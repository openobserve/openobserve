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
    helpers::{has_cte, has_join, is_aggregate_in_select},
    visitors::{has_subquery, has_union, has_window_functions},
};

pub fn is_simple_aggregate_query(query: &str) -> Result<bool, sqlparser::parser::ParserError> {
    let ast = Parser::parse_sql(&GenericDialect {}, query)?;
    for statement in ast.iter() {
        if has_subquery(statement) || has_window_functions(statement) {
            return Ok(false);
        }

        if let Statement::Query(query) = statement
            && (!is_aggregate_in_select(query)
                || has_join(query)
                || has_union(query)
                || has_cte(query))
        {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_is_simple_aggregate_for_complex_queries_should_be_false() {
        let queries = [
            (
                r#"SELECT COUNT(*), SUM(a.value)
                   FROM table_a a
                   JOIN table_b b ON a.id = b.id"#,
                "Query with JOIN should not be simple",
            ),
            (
                r#"SELECT COUNT(*), AVG(total)
                   FROM (SELECT SUM(value) as total FROM events GROUP BY user_id) subq"#,
                "Query with table subquery should not be simple",
            ),
            (
                r#"SELECT COUNT(*), AVG(salary)
                   FROM employees
                   WHERE department_id IN (SELECT id FROM departments WHERE active = 1)"#,
                "Query with expression subquery should not be simple",
            ),
            (
                r#"SELECT COUNT(*) FROM (
                     SELECT user_id FROM events_2023
                     UNION ALL
                     SELECT user_id FROM events_2024
                   ) combined"#,
                "Query with UNION should not be simple",
            ),
            (
                r#"SELECT COUNT(*),
                          SUM(value) OVER (PARTITION BY category) as window_sum
                   FROM events"#,
                "Query with window functions should not be simple",
            ),
            (
                r#"SELECT user_id, event_time,
                          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY event_time) as row_num,
                          SUM(value) OVER (PARTITION BY user_id) as user_total
                   FROM events"#,
                "Query with multiple window functions should not be simple",
            ),
            (
                r#"SELECT
                     SUM(event_count) OVER (PARTITION BY time_bucket) AS total_events,
                     time_bucket,
                     ROW_NUMBER() OVER (PARTITION BY time_bucket) AS row_num
                   FROM (
                     SELECT histogram(event_time, '5 minutes') AS time_bucket,
                            COUNT(event_time) AS event_count
                     FROM events_a
                     GROUP BY time_bucket
                     UNION ALL
                     SELECT histogram(event_time, '5 minutes') AS time_bucket,
                            COUNT(event_time) AS event_count
                     FROM events_b
                     GROUP BY time_bucket
                   )"#,
                "Query with subquery + union + window functions should not be simple",
            ),
            (
                r#"SELECT COUNT(*), AVG(amount)
                   FROM orders o
                   WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.active = 1)"#,
                "Query with EXISTS subquery should not be simple",
            ),
            (
                r#"SELECT COUNT(*), SUM(a.value + b.value)
                   FROM events a
                   JOIN events b ON a.user_id = b.user_id AND a.event_time > b.event_time"#,
                "Query with self-join should not be simple",
            ),
            (
                r#"SELECT total FROM (
                     SELECT SUM(amount) as total FROM sales_q1
                     UNION
                     (SELECT SUM(amount) as total FROM sales_q2
                      UNION
                      SELECT SUM(amount) as total FROM sales_q3)
                   )"#,
                "Query with nested UNION should not be simple",
            ),
            (
                r#"WITH user_totals AS (
                     SELECT user_id, SUM(amount) as total
                     FROM orders
                     GROUP BY user_id
                   )
                   SELECT COUNT(*) FROM user_totals WHERE total > 100"#,
                "Query with simple CTE should not be simple",
            ),
            (
                r#"WITH sales_summary AS (
                     SELECT region, SUM(amount) as total_sales
                     FROM sales
                     GROUP BY region
                   ),
                   top_regions AS (
                     SELECT region FROM sales_summary WHERE total_sales > 10000
                   )
                   SELECT COUNT(*) FROM top_regions"#,
                "Query with multiple CTEs should not be simple",
            ),
            (
                r#"WITH RECURSIVE hierarchy AS (
                     SELECT id, parent_id, name, 1 as level
                     FROM categories WHERE parent_id IS NULL
                     UNION ALL
                     SELECT c.id, c.parent_id, c.name, h.level + 1
                     FROM categories c
                     JOIN hierarchy h ON c.parent_id = h.id
                   )
                   SELECT COUNT(*) FROM hierarchy"#,
                "Query with recursive CTE should not be simple",
            ),
            (
                r#"WITH complex_cte AS (
                     SELECT user_id,
                            ROW_NUMBER() OVER (ORDER BY created_at) as rank,
                            SUM(amount) OVER (PARTITION BY region) as region_total
                     FROM orders
                     WHERE created_at >= '2024-01-01'
                   )
                   SELECT COUNT(*), AVG(region_total) FROM complex_cte"#,
                "Query with CTE containing window functions should not be simple",
            ),
            (
                r#"SELECT SUM(x_axis_1) AS "y_axis_1"
                   FROM (
                     SELECT histogram(_timestamp) AS "xaxis",
                            COUNT(_timestamp) AS "x_axis_1"
                     FROM "default"
                     GROUP BY xaxis
                   )"#,
                "Query with histogram in subquery should not be simple",
            ),
        ];

        for (i, (query, description)) in queries.iter().enumerate() {
            let is_simple_aggregate = is_simple_aggregate_query(query).unwrap();
            println!("Query [{i}]: {description} - is_simple: {is_simple_aggregate:?}");
            assert!(
                !is_simple_aggregate,
                "Failed test case [{i}]: '{description}' - should not be simple but returned true"
            );
        }
    }

    #[test]
    fn check_is_simple_aggregate_for_simple_queries_should_be_true() {
        let queries = [
            (
                r#"SELECT COUNT(*) FROM events"#,
                "Simple COUNT query should be simple",
            ),
            (
                r#"SELECT user_id, SUM(amount) FROM orders GROUP BY user_id"#,
                "Simple SUM with GROUP BY should be simple",
            ),
            (
                r#"SELECT COUNT(*), AVG(price), MAX(created_at) FROM products WHERE active = 1"#,
                "Multiple aggregates with WHERE should be simple",
            ),
            (
                r#"SELECT category, COUNT(*), AVG(price)
                   FROM products
                   GROUP BY category
                   HAVING COUNT(*) > 5"#,
                "Aggregate with GROUP BY and HAVING should be simple",
            ),
            (
                r#"SELECT DISTINCT user_id, COUNT(*)
                   FROM events
                   GROUP BY user_id"#,
                "Query with DISTINCT should be simple",
            ),
            (
                r#"SELECT DISTINCT region, SUM(amount) as total
                   FROM sales
                   GROUP BY region"#,
                "Query with DISTINCT and aggregate should be simple",
            ),
            (
                r#"SELECT DISTINCT user_id, product_id, COUNT(*) as purchase_count
                   FROM purchases
                   GROUP BY user_id, product_id"#,
                "Query with DISTINCT on multiple columns should be simple",
            ),
            (
                r#"SELECT COUNT(DISTINCT user_id) as unique_users,
                          SUM(amount) as total_amount
                   FROM orders"#,
                "Query with COUNT(DISTINCT) should be simple",
            ),
            (
                r#"SELECT DISTINCT user_id
                   FROM orders"#,
                "Query with DISTINCT and no group by should be simple",
            ),
        ];

        for (i, (query, description)) in queries.iter().enumerate() {
            let is_simple_aggregate = is_simple_aggregate_query(query).unwrap();
            println!("Simple Query [{i}]: {description} - is_simple: {is_simple_aggregate:?}");
            assert!(
                is_simple_aggregate,
                "Failed test case [{i}]: '{description}' - should be simple but returned false"
            );
        }
    }

    #[test]
    fn check_is_simple_aggregate_for_complex_queries_should_be_false_2() {
        let queries = [r#"
            SELECT
                SUM(event_count) OVER (PARTITION BY time_bucket) AS total_events,
                time_bucket,
                (
                    SUM(error_events) OVER (PARTITION BY time_bucket) /
                    SUM(event_count) OVER (PARTITION BY time_bucket)
                ) AS error_rate,
                (
                    CASE
                        WHEN (SUM(error_events) OVER (PARTITION BY time_bucket) /
                              SUM(event_count) OVER (PARTITION BY time_bucket)) > 0.001
                             AND SUM(event_count) OVER (PARTITION BY time_bucket) > 1
                        THEN 1
                        ELSE 0
                    END
                ) AS alert_flag,
                ROW_NUMBER() OVER (PARTITION BY time_bucket) AS row_num
            FROM (
                SELECT
                    histogram(event_time, '5 minutes') AS time_bucket,
                    0 AS error_events,
                    'source_a' AS source_type,
                    CAST(COUNT(event_time) AS FLOAT) AS event_count
                FROM "event_logs_source_a"
                WHERE service_name = 'service-a'
                    AND (
                        path = '/' OR path LIKE '/?%' OR path = '/variant' OR path LIKE '/variant?%'
                    )
                GROUP BY time_bucket

                UNION ALL

                SELECT
                    histogram(event_time, '5 minutes') AS time_bucket,
                    CAST(SUM(CASE WHEN status_code = '500' THEN 1 END) AS FLOAT) AS error_events,
                    'source_b' AS source_type,
                    CAST(COUNT(event_time) AS FLOAT) AS event_count
                FROM "event_logs_source_b"
                WHERE url LIKE 'https://example.com/%'
                    AND metric_name LIKE 'query_%'
                    AND category = 'log'
                GROUP BY time_bucket
                ORDER BY time_bucket
            )
            LIMIT 500000
            "#];

        for (i, query) in queries.iter().enumerate() {
            let is_simple_aggregate = is_simple_aggregate_query(query).unwrap();
            println!("Query [{i}] is_simple: {is_simple_aggregate:?}");
            assert!(!is_simple_aggregate);
        }
    }

    #[test]
    fn test_is_simple_aggregate_query() {
        assert!(is_simple_aggregate_query("SELECT count(*) FROM t").unwrap());
        assert!(is_simple_aggregate_query("SELECT sum(val) FROM t GROUP BY x").unwrap());
        assert!(!is_simple_aggregate_query("SELECT x FROM (SELECT x FROM t)").unwrap());
        assert!(
            !is_simple_aggregate_query("SELECT count(*) FROM t JOIN t2 ON t.id = t2.id").unwrap()
        );
    }

    #[test]
    fn test_is_simple_aggregate_query_window_and_cte_and_union_not_simple() {
        assert!(
            !is_simple_aggregate_query("SELECT x, ROW_NUMBER() OVER (ORDER BY x) as rn FROM t")
                .unwrap()
        );

        assert!(
            !is_simple_aggregate_query("WITH cte AS (SELECT x FROM t) SELECT count(*) FROM cte")
                .unwrap()
        );

        assert!(
            !is_simple_aggregate_query("SELECT count(*) FROM t1 UNION SELECT count(*) FROM t2")
                .unwrap()
        );
    }
}
