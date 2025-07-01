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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_get_ts_value_with_string_timestamp() {
        let record = json!({
            "timestamp": "2023-01-01T12:30:45.123456Z"
        });
        
        let result = get_ts_value("timestamp", &record);
        // The exact value depends on the parse_str_to_timestamp_micros_as_option implementation
        // but it should be a non-zero value
        assert!(result > 0);
    }

    #[test]
    fn test_round_down_to_nearest_minute_exact_minute() {
        // 2023-01-01T12:30:00.000000Z (exact minute)
        let microseconds = 1672575000000000;
        let result = round_down_to_nearest_minute(microseconds);
        assert_eq!(result, 1672575000000000);
    }
}
