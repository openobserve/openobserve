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

use config::utils::{json, time::parse_str_to_timestamp_micros_as_option};

pub fn get_ts_value(ts_column: &str, record: &json::Value) -> i64 {
    match record.get(ts_column) {
        None => 0_i64,
        Some(ts) => match ts {
            serde_json::Value::String(ts) => {
                parse_str_to_timestamp_micros_as_option(ts.as_str()).unwrap()
            }
            serde_json::Value::Number(ts) => ts.as_i64().unwrap(),
            _ => 0_i64,
        },
    }
}

pub fn round_down_to_nearest_minute(microseconds: i64) -> i64 {
    let microseconds_per_second = 1_000_000;
    let seconds_per_minute = 60;
    // Convert microseconds to seconds
    let total_seconds = microseconds / microseconds_per_second;
    // Find how many seconds past the last full minute
    let seconds_past_minute = total_seconds % seconds_per_minute;
    // Calculate the adjustment to round down to the nearest minute
    let adjusted_seconds = total_seconds - seconds_past_minute;
    // Convert the adjusted time back to microseconds
    adjusted_seconds * microseconds_per_second
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
