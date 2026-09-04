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

use config::utils::{json, time::parse_str_to_timestamp_micros_as_option};

pub fn get_ts_value(ts_column: &str, record: &json::Value) -> i64 {
    match record.get(ts_column) {
        None => 0_i64,
        Some(ts) => match ts {
            serde_json::Value::String(ts) => {
                parse_str_to_timestamp_micros_as_option(ts.as_str()).unwrap_or(0)
            }
            serde_json::Value::Number(ts) => ts.as_i64().unwrap_or(0),
            _ => 0_i64,
        },
    }
}

/// Checks if a field name matches the timestamp column, accounting for quoted names.
///
/// # Examples
/// - `is_timestamp_field("_timestamp", "_timestamp")` returns `true`
/// - `is_timestamp_field("\"_timestamp\"", "_timestamp")` returns `true`
/// - `is_timestamp_field("count", "_timestamp")` returns `false`
#[inline]
pub fn is_timestamp_field(field: &str, ts_column: &str) -> bool {
    field == ts_column || field.trim_matches('"') == ts_column
}

/// Checks if ORDER BY clause contains any non-timestamp columns.
///
/// Returns `true` if at least one ORDER BY field is not the timestamp column.
///
/// # Arguments
/// * `order_by` - List of (field_name, order_direction) tuples
/// * `ts_column` - The timestamp column name
pub fn has_non_timestamp_ordering(
    order_by: &[(String, config::meta::sql::OrderBy)],
    ts_column: &str,
) -> bool {
    order_by
        .iter()
        .any(|(field, _)| !is_timestamp_field(field, ts_column))
}

/// Extracts the min and max timestamps from a set of hits.
///
/// For time-ordered results, this uses an optimization by only checking the first and last hits.
/// For non-ordered results (e.g., histogram with `ORDER BY count DESC`), it scans all hits.
///
/// # Arguments
/// * `hits` - The result hits to scan
/// * `ts_column` - The timestamp column name
/// * `is_time_ordered` - If `true`, uses first/last optimization; if `false`, scans all hits
///
/// # Returns
/// A tuple of `(min_timestamp, max_timestamp)`
pub fn extract_timestamp_range(
    hits: &[config::utils::json::Value],
    ts_column: &str,
    is_time_ordered: bool,
) -> (i64, i64) {
    if is_time_ordered {
        // Fast path: results are sorted by time, just check first and last
        let first_ts = get_ts_value(ts_column, hits.first().unwrap());
        let last_ts = get_ts_value(ts_column, hits.last().unwrap());
        (first_ts.min(last_ts), first_ts.max(last_ts))
    } else {
        // Slow path: results are not time-ordered, must scan all hits
        hits.iter()
            .map(|hit| get_ts_value(ts_column, hit))
            .fold((i64::MAX, i64::MIN), |(min_ts, max_ts), ts| {
                (min_ts.min(ts), max_ts.max(ts))
            })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn test_get_ts_value() {
        let test_cases = vec![
            // Test case: ((key, value), expected_result, assertion_message)
            (
                ("timestamp", json!(1672575000000000i64)),
                1672575000000000,
                "Numeric timestamp should match input",
            ),
            (
                ("timestamp", json!(null)),
                0,
                "Null timestamp should return 0",
            ),
            (
                ("timestamp", json!(true)),
                0,
                "Invalid timestamp type should return 0",
            ),
        ];

        for ((key, value), expected, message) in test_cases {
            let record = json!({key: value});
            let result = get_ts_value(key, &record);
            assert_eq!(result, expected, "{message}");
        }

        // Test cases that require comparison rather than equality
        let record = json!({"timestamp": "2023-01-01T12:30:45.123456Z"});
        let result = get_ts_value("timestamp", &record);
        assert!(result > 0, "String timestamp should return positive value");

        let record = json!({"created_at": "2023-01-01T12:30:45.123456Z"});
        let result = get_ts_value("created_at", &record);
        assert!(result > 0, "Different column name should work");

        // Test for truly missing field
        let record = json!({"other_field": "value"});
        let result = get_ts_value("timestamp", &record);
        assert_eq!(result, 0, "Missing timestamp field should return 0");
    }

    #[test]
    fn test_is_timestamp_field_exact_match() {
        assert!(is_timestamp_field("_timestamp", "_timestamp"));
        assert!(!is_timestamp_field("other", "_timestamp"));
    }

    #[test]
    fn test_is_timestamp_field_quoted_match() {
        assert!(is_timestamp_field("\"_timestamp\"", "_timestamp"));
        assert!(!is_timestamp_field("\"other\"", "_timestamp"));
    }

    #[test]
    fn test_has_non_timestamp_ordering_all_timestamp() {
        let order_by = vec![("_timestamp".to_string(), config::meta::sql::OrderBy::Desc)];
        assert!(!has_non_timestamp_ordering(&order_by, "_timestamp"));
    }

    #[test]
    fn test_has_non_timestamp_ordering_has_non_ts() {
        let order_by = vec![
            ("_timestamp".to_string(), config::meta::sql::OrderBy::Desc),
            ("count".to_string(), config::meta::sql::OrderBy::Desc),
        ];
        assert!(has_non_timestamp_ordering(&order_by, "_timestamp"));
    }

    #[test]
    fn test_has_non_timestamp_ordering_empty() {
        let order_by: Vec<(String, config::meta::sql::OrderBy)> = vec![];
        assert!(!has_non_timestamp_ordering(&order_by, "_timestamp"));
    }

    #[test]
    fn test_extract_timestamp_range_time_ordered() {
        let hits = vec![
            json!({"_timestamp": 1000i64}),
            json!({"_timestamp": 2000i64}),
            json!({"_timestamp": 3000i64}),
        ];
        let (min_ts, max_ts) = extract_timestamp_range(&hits, "_timestamp", true);
        assert_eq!(min_ts, 1000);
        assert_eq!(max_ts, 3000);
    }

    #[test]
    fn test_extract_timestamp_range_not_time_ordered() {
        let hits = vec![
            json!({"_timestamp": 3000i64}),
            json!({"_timestamp": 1000i64}),
            json!({"_timestamp": 2000i64}),
        ];
        let (min_ts, max_ts) = extract_timestamp_range(&hits, "_timestamp", false);
        assert_eq!(min_ts, 1000);
        assert_eq!(max_ts, 3000);
    }

    #[test]
    fn test_extract_timestamp_range_reverse_ordered() {
        // time_ordered=true but reversed — function uses first/last min/max
        let hits = vec![
            json!({"_timestamp": 3000i64}),
            json!({"_timestamp": 1000i64}),
        ];
        let (min_ts, max_ts) = extract_timestamp_range(&hits, "_timestamp", true);
        assert_eq!(min_ts, 1000);
        assert_eq!(max_ts, 3000);
    }
}
