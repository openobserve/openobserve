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
    meta::search::PARTIAL_ERROR_RESPONSE_MESSAGE,
    utils::{json, time::parse_str_to_timestamp_micros_as_option},
};

use crate::common::meta::search::CAPPED_RESULTS_MSG;

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

pub fn is_cachable_function_error(function_error: &[String]) -> bool {
    if function_error.is_empty() {
        return true;
    }

    function_error.iter().all(|error| {
        // Empty or whitespace-only errors are cachable (no actual error)
        let trimmed = error.trim();
        if trimmed.is_empty() {
            return true;
        }

        // Check if error contains only cachable messages
        error.contains(CAPPED_RESULTS_MSG) || error.contains(PARTIAL_ERROR_RESPONSE_MESSAGE)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_cachable_function_error() {
        let error = vec![];
        assert_eq!(is_cachable_function_error(&error), true);

        let error = vec!["".to_string()];
        assert_eq!(is_cachable_function_error(&error), true);

        let error = vec![
            CAPPED_RESULTS_MSG.to_string(),
            PARTIAL_ERROR_RESPONSE_MESSAGE.to_string(),
        ];
        assert_eq!(is_cachable_function_error(&error), true); // only this is cachable

        let error = vec![
            CAPPED_RESULTS_MSG.to_string(),
            PARTIAL_ERROR_RESPONSE_MESSAGE.to_string(),
            "parquet not found".to_string(),
        ];
        assert_eq!(is_cachable_function_error(&error), false);

        let error = vec![
            "parquet not found".to_string(),
            PARTIAL_ERROR_RESPONSE_MESSAGE.to_string(),
        ];
        assert_eq!(is_cachable_function_error(&error), false);

        let error = vec!["parquet not found".to_string()];
        assert_eq!(is_cachable_function_error(&error), false);

        let error = vec![
            "parquet not found".to_string(),
            CAPPED_RESULTS_MSG.to_string(),
        ];
        assert_eq!(is_cachable_function_error(&error), false);
    }
}
