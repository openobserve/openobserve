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

//! Helper functions for extracting values from JSON

use config::utils::json;

/// Helper function to extract i64 from JSON value (handles both integer and string)
pub fn extract_i64(value: &json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|s| s.parse::<i64>().ok()))
}

/// Helper function to extract f64 from JSON value (handles both float and string)
pub fn extract_f64(value: &json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_i64_from_integer() {
        assert_eq!(extract_i64(&json::json!(42i64)), Some(42));
        assert_eq!(extract_i64(&json::json!(0i64)), Some(0));
        assert_eq!(extract_i64(&json::json!(-10i64)), Some(-10));
    }

    #[test]
    fn test_extract_i64_from_string() {
        assert_eq!(extract_i64(&json::json!("123")), Some(123));
        assert_eq!(extract_i64(&json::json!("-7")), Some(-7));
    }

    #[test]
    fn test_extract_i64_from_non_numeric_string_returns_none() {
        assert_eq!(extract_i64(&json::json!("not_a_number")), None);
        assert_eq!(extract_i64(&json::json!("")), None);
    }

    #[test]
    fn test_extract_i64_from_null_returns_none() {
        assert_eq!(extract_i64(&json::Value::Null), None);
    }

    #[test]
    fn test_extract_f64_from_float() {
        let result = extract_f64(&json::json!(3.14f64)).unwrap();
        assert!((result - 3.14).abs() < 1e-10);
    }

    #[test]
    fn test_extract_f64_from_integer() {
        let result = extract_f64(&json::json!(5i64)).unwrap();
        assert!((result - 5.0).abs() < 1e-10);
    }

    #[test]
    fn test_extract_f64_from_string() {
        let result = extract_f64(&json::json!("2.718")).unwrap();
        assert!((result - 2.718).abs() < 1e-6);
    }

    #[test]
    fn test_extract_f64_from_invalid_string_returns_none() {
        assert_eq!(extract_f64(&json::json!("not_a_float")), None);
    }
}
