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
}
