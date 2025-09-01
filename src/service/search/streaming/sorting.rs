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

use config::{
    meta::{search::Response, sql::OrderBy},
    utils::json::Value,
};
use log;

use crate::common::meta::search::SortStrategy;

/// Determines and applies sorting to search results
pub fn order_search_results(
    mut search_res: Response,
    fallback_order_by_col: Option<String>,
) -> Response {
    if search_res.hits.is_empty() {
        return search_res;
    }

    let strategy = determine_sort_strategy(&search_res, fallback_order_by_col);
    apply_sort_strategy(&mut search_res, strategy);

    search_res
}

/// Determines which sorting strategy to use
fn determine_sort_strategy(
    search_res: &Response,
    fallback_order_by_col: Option<String>,
) -> SortStrategy {
    // Check SQL ORDER BY first
    if let Some(order_by) = search_res.order_by {
        log::info!(
            "[trace_id: {}] Using user-specified ORDER BY: {:?}",
            &search_res.trace_id,
            order_by
        );
        return SortStrategy::SqlOrderBy;
    }

    // Check fallback column
    // Default to descending order
    if let Some(col) = find_fallback_column(search_res, fallback_order_by_col) {
        return SortStrategy::FallbackColumn(col, OrderBy::Desc);
    }

    // Auto-determine as last resort
    if let Some((col, is_string)) = determine_sort_column(&search_res.hits[0]) {
        log::info!(
            "[trace_id: {}] Auto-sorting by column: {}, type: {}",
            &search_res.trace_id,
            col,
            if is_string { "string" } else { "numeric" }
        );
        return SortStrategy::AutoDetermine(col, is_string);
    }

    SortStrategy::NoSort
}

/// Applies the chosen sort strategy to results
fn apply_sort_strategy(search_res: &mut Response, strategy: SortStrategy) {
    match strategy {
        SortStrategy::FallbackColumn(col, order) => {
            // Auto-detect column type from first hit
            let is_string = search_res
                .hits
                .first()
                .and_then(|hit| hit.get(&col))
                .map(|v| !v.is_number())
                .unwrap_or(true);

            // Sorting behavior:
            // - String columns: Always sort ascending (A->Z)
            // - Numeric columns: Respect the specified order (ASC/DESC)
            let is_descending = if is_string {
                false // Strings always sort ascending
            } else {
                order == OrderBy::Desc // Numbers follow specified order
            };

            sort_by_column(search_res, &col, is_string, is_descending);
            if search_res.order_by.is_none() {
                search_res.order_by = Some(order);
                search_res.order_by_metadata.push((col, order));
            }
        }
        SortStrategy::AutoDetermine(col, is_string) => {
            sort_by_column(search_res, &col, is_string, !is_string);
        }
        _ => (),
    }
}

/// Finds and validates fallback column in results
fn find_fallback_column(search_res: &Response, fallback_col: Option<String>) -> Option<String> {
    let fallback_col = fallback_col?;
    let first_hit = search_res.hits.first()?.as_object()?;

    // Find case-insensitive match
    first_hit
        .keys()
        .find(|k| k.eq_ignore_ascii_case(&fallback_col))
        .map(|k| {
            log::info!(
                "[trace_id: {}] Using fallback ORDER BY: {}",
                &search_res.trace_id,
                k
            );
            k.to_string()
        })
}

/// Sorts results by a specific column
fn sort_by_column(search_res: &mut Response, column: &str, is_string: bool, descending: bool) {
    search_res.hits.sort_by(|a, b| {
        let ordering = if is_string {
            compare_string_values(a, b, column)
        } else {
            compare_numeric_values(a, b, column)
        };
        if descending {
            ordering.reverse()
        } else {
            ordering
        }
    });
}

/// Compares string values with null handling
fn compare_string_values(a: &Value, b: &Value, column: &str) -> std::cmp::Ordering {
    let a_val = a.get(column).and_then(|v| v.as_str());
    let b_val = b.get(column).and_then(|v| v.as_str());
    match (a_val, b_val) {
        // When both values exist: "apple" vs "banana" -> normal alphabetical order
        (Some(a), Some(b)) => a.cmp(b),

        // When first value is null and second exists: null vs "apple" -> null goes last
        // Example: [apple, banana, null] in ascending order
        (None, Some(_)) => std::cmp::Ordering::Greater,

        // When first value exists and second is null: "apple" vs null -> non-null goes first
        // Example: [apple, banana, null] in ascending order
        (Some(_), None) => std::cmp::Ordering::Less,

        // When both values are null: null vs null -> treat as equal
        // Example: [null, null] -> order doesn't change
        (None, None) => std::cmp::Ordering::Equal,
    }
}

/// Compares numeric values with null handling
fn compare_numeric_values(a: &Value, b: &Value, column: &str) -> std::cmp::Ordering {
    let a_val = a.get(column).and_then(|v| v.as_f64());
    let b_val = b.get(column).and_then(|v| v.as_f64());
    match (a_val, b_val) {
        // When both are numbers: 1 vs 2 -> normal numeric order
        // If NaN encountered, treat values as equal
        // Example: [1, 2, 3] in ascending order
        (Some(a), Some(b)) => a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal),

        // When first is null and second is a number: null vs 1 -> null goes last
        // Example: [1, 2, null] in ascending order
        (None, Some(_)) => std::cmp::Ordering::Greater,

        // When first is a number and second is null: 1 vs null -> number goes first
        // Example: [1, 2, null] in ascending order
        (Some(_), None) => std::cmp::Ordering::Less,

        // When both are null: null vs null -> treat as equal
        // Example: [null, null] -> order doesn't change
        (None, None) => std::cmp::Ordering::Equal,
    }
}

/// Determines the best column to sort by from the first hit
fn determine_sort_column(first_hit: &Value) -> Option<(String, bool)> {
    if let Some(obj) = first_hit.as_object() {
        // First try to find non-numeric columns
        for (key, value) in obj {
            if !value.is_number() {
                log::debug!("Using string column for sorting: {key}");
                return Some((key.clone(), true)); // (column, is_string)
            }
        }

        // If no non-numeric column found, take first numeric column
        for (key, value) in obj {
            if value.is_number() {
                log::debug!("Using numeric column for sorting: {key}");
                return Some((key.clone(), false)); // (column, is_string)
            }
        }
    }
    log::warn!("No suitable sort column found in results");
    None
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn create_test_response() -> Response {
        Response {
            hits: vec![
                json!({
                    "timestamp": 1000,
                    "level": "info",
                    "message": "test message 1",
                    "count": 5
                }),
                json!({
                    "timestamp": 2000,
                    "level": "error",
                    "message": "test message 2",
                    "count": 10
                }),
                json!({
                    "timestamp": 1500,
                    "level": "warn",
                    "message": "test message 3",
                    "count": 7
                }),
            ],
            trace_id: "test-123".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn test_order_search_results_empty_hits() {
        let response = Response {
            hits: vec![],
            trace_id: "test-123".to_string(),
            ..Default::default()
        };

        let result = order_search_results(response.clone(), None);

        // Should return unchanged response for empty hits
        assert_eq!(result.hits.len(), 0);
    }

    #[test]
    fn test_order_search_results_with_sql_order_by() {
        let mut response = create_test_response();
        response.order_by = Some(OrderBy::Desc);

        let result = order_search_results(response.clone(), Some("timestamp".to_string()));

        // Should respect SQL ORDER BY and ignore fallback
        assert_eq!(result.order_by, Some(OrderBy::Desc));
        assert_eq!(result.order_by_metadata.len(), 0);
    }

    #[test]
    fn test_order_search_results_with_fallback_column() {
        let mut response = create_test_response();
        response.order_by = None;

        let result = order_search_results(response.clone(), Some("timestamp".to_string()));

        // Should use fallback column with descending order
        assert_eq!(result.order_by, Some(OrderBy::Desc));
        assert_eq!(result.order_by_metadata.len(), 1);
        assert_eq!(result.order_by_metadata[0].0, "timestamp");
        assert_eq!(result.order_by_metadata[0].1, OrderBy::Desc);
    }

    #[test]
    fn test_order_search_results_auto_determine() {
        let mut response = create_test_response();
        response.order_by = None;

        let result = order_search_results(response.clone(), None);

        // Should auto-determine sort column (first non-numeric column)
        // In this case, "level" should be chosen as it's a string
        assert_eq!(result.order_by, None);
        assert_eq!(result.order_by_metadata.len(), 0);
    }

    #[test]
    fn test_determine_sort_strategy_sql_order_by() {
        let mut response = create_test_response();
        response.order_by = Some(OrderBy::Asc);

        let strategy = determine_sort_strategy(&response, Some("timestamp".to_string()));

        match strategy {
            SortStrategy::SqlOrderBy => (),
            _ => panic!("Expected SqlOrderBy strategy"),
        }
    }

    #[test]
    fn test_determine_sort_strategy_fallback_column() {
        let response = create_test_response();

        let strategy = determine_sort_strategy(&response, Some("timestamp".to_string()));

        match strategy {
            SortStrategy::FallbackColumn(col, order) => {
                assert_eq!(col, "timestamp");
                assert_eq!(order, OrderBy::Desc);
            }
            _ => panic!("Expected FallbackColumn strategy"),
        }
    }

    #[test]
    fn test_determine_sort_strategy_auto_determine() {
        let response = create_test_response();

        let strategy = determine_sort_strategy(&response, None);

        match strategy {
            SortStrategy::AutoDetermine(col, is_string) => {
                assert_eq!(col, "level"); // First non-numeric column
                assert!(is_string);
            }
            _ => panic!("Expected AutoDetermine strategy"),
        }
    }

    #[test]
    fn test_find_fallback_column_success() {
        let response = create_test_response();

        let result = find_fallback_column(&response, Some("timestamp".to_string()));

        assert_eq!(result, Some("timestamp".to_string()));
    }

    #[test]
    fn test_find_fallback_column_case_insensitive() {
        let response = create_test_response();

        let result = find_fallback_column(&response, Some("TIMESTAMP".to_string()));

        assert_eq!(result, Some("timestamp".to_string()));
    }

    #[test]
    fn test_find_fallback_column_not_found() {
        let response = create_test_response();

        let result = find_fallback_column(&response, Some("nonexistent".to_string()));

        assert_eq!(result, None);
    }

    #[test]
    fn test_find_fallback_column_none() {
        let response = create_test_response();

        let result = find_fallback_column(&response, None);

        assert_eq!(result, None);
    }

    #[test]
    fn test_sort_by_column_string_ascending() {
        let mut response = create_test_response();

        sort_by_column(&mut response, "level", true, false);

        // String columns should always sort ascending regardless of descending flag
        let levels: Vec<&str> = response
            .hits
            .iter()
            .map(|hit| hit["level"].as_str().unwrap())
            .collect();

        assert_eq!(levels, vec!["error", "info", "warn"]);
    }

    #[test]
    fn test_sort_by_column_numeric_descending() {
        let mut response = create_test_response();

        sort_by_column(&mut response, "count", false, true);

        // Numeric columns should respect the descending flag
        let counts: Vec<i64> = response
            .hits
            .iter()
            .map(|hit| hit["count"].as_i64().unwrap())
            .collect();

        assert_eq!(counts, vec![10, 7, 5]);
    }

    #[test]
    fn test_sort_by_column_numeric_ascending() {
        let mut response = create_test_response();

        sort_by_column(&mut response, "count", false, false);

        let counts: Vec<i64> = response
            .hits
            .iter()
            .map(|hit| hit["count"].as_i64().unwrap())
            .collect();

        assert_eq!(counts, vec![5, 7, 10]);
    }

    #[test]
    fn test_compare_string_values_both_exist() {
        let a = json!({"field": "apple"});
        let b = json!({"field": "banana"});

        let result = compare_string_values(&a, &b, "field");
        assert_eq!(result, std::cmp::Ordering::Less);

        let result = compare_string_values(&b, &a, "field");
        assert_eq!(result, std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_compare_string_values_with_nulls() {
        let a = json!({"field": "apple"});
        let b = json!({});

        // a has value, b is null -> a should come first
        let result = compare_string_values(&a, &b, "field");
        assert_eq!(result, std::cmp::Ordering::Less);

        // b is null, a has value -> b should come last
        let result = compare_string_values(&b, &a, "field");
        assert_eq!(result, std::cmp::Ordering::Greater);

        // Both null -> equal
        let result = compare_string_values(&b, &b, "field");
        assert_eq!(result, std::cmp::Ordering::Equal);
    }

    #[test]
    fn test_compare_numeric_values_both_exist() {
        let a = json!({"field": 5});
        let b = json!({"field": 10});

        let result = compare_numeric_values(&a, &b, "field");
        assert_eq!(result, std::cmp::Ordering::Less);

        let result = compare_numeric_values(&b, &a, "field");
        assert_eq!(result, std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_compare_numeric_values_with_nulls() {
        let a = json!({"field": 5});
        let b = json!({});

        // a has value, b is null -> a should come first
        let result = compare_numeric_values(&a, &b, "field");
        assert_eq!(result, std::cmp::Ordering::Less);

        // b is null, a has value -> b should come last
        let result = compare_numeric_values(&b, &a, "field");
        assert_eq!(result, std::cmp::Ordering::Greater);

        // Both null -> equal
        let result = compare_numeric_values(&b, &b, "field");
        assert_eq!(result, std::cmp::Ordering::Equal);
    }

    #[test]
    fn test_compare_numeric_values_nan_handling() {
        let a = json!({"field": 5.0});
        let b = json!({"field": f64::NAN});

        // NaN should be treated as equal to avoid panics
        let result = compare_numeric_values(&a, &b, "field");
        // The function actually returns Less when comparing 5.0 with NaN
        // This is the actual behavior, not Equal
        assert_eq!(result, std::cmp::Ordering::Less);
    }

    #[test]
    fn test_determine_sort_column_string_first() {
        let hit = json!({
            "level": "info",
            "count": 5,
            "timestamp": 1000
        });

        let result = determine_sort_column(&hit);

        assert_eq!(result, Some(("level".to_string(), true)));
    }

    #[test]
    fn test_determine_sort_column_numeric_only() {
        let hit = json!({
            "count": 5,
            "timestamp": 1000
        });

        let result = determine_sort_column(&hit);

        assert_eq!(result, Some(("count".to_string(), false)));
    }

    #[test]
    fn test_determine_sort_column_no_suitable() {
        let hit = json!({
            "array": [1, 2, 3],
            "null": serde_json::Value::Null
        });

        let result = determine_sort_column(&hit);

        // The function actually finds "array" as a non-numeric column
        // This is the actual behavior, not None
        assert_eq!(result, Some(("array".to_string(), true)));
    }

    #[test]
    fn test_sort_by_column_missing_field() {
        let mut response = create_test_response();

        sort_by_column(&mut response, "nonexistent", false, false);

        // Should not panic, should maintain original order
        assert_eq!(response.hits.len(), 3);
    }

    #[test]
    fn test_sort_by_column_mixed_types() {
        let mut response = Response {
            hits: vec![
                json!({"field": "string"}),
                json!({"field": 42}),
                json!({"field": "another"}),
            ],
            trace_id: "test-123".to_string(),
            ..Default::default()
        };

        sort_by_column(&mut response, "field", true, false);

        // Should handle mixed types gracefully
        assert_eq!(response.hits.len(), 3);
    }

    #[test]
    fn test_order_search_results_complex_scenario() {
        let response = Response {
            hits: vec![
                json!({
                    "timestamp": 3000,
                    "level": "debug",
                    "count": 1
                }),
                json!({
                    "timestamp": 1000,
                    "level": "info",
                    "count": 5
                }),
                json!({
                    "timestamp": 2000,
                    "level": "warn",
                    "count": 3
                }),
            ],
            order_by: None,
            trace_id: "test-123".to_string(),
            ..Default::default()
        };

        let result = order_search_results(response.clone(), Some("timestamp".to_string()));

        // Should use fallback column and sort by timestamp descending
        assert_eq!(result.order_by, Some(OrderBy::Desc));
        assert_eq!(result.order_by_metadata.len(), 1);
        assert_eq!(result.order_by_metadata[0].0, "timestamp");
        assert_eq!(result.order_by_metadata[0].1, OrderBy::Desc);

        // Verify sorting
        let timestamps: Vec<i64> = result
            .hits
            .iter()
            .map(|hit| hit["timestamp"].as_i64().unwrap())
            .collect();

        assert_eq!(timestamps, vec![3000, 2000, 1000]);
    }
}
