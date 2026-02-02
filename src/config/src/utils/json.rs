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

use itertools::Itertools;
pub use serde_json::{
    Error, Map, Number, Value, from_slice, from_str, from_value, json, to_string, to_value, to_vec,
};

pub fn get_float_value(val: &Value) -> f64 {
    match val {
        Value::String(v) => v.parse::<f64>().unwrap_or(0.0),
        // f64, i64, u64 both can be converted to f64
        Value::Number(v) => v.as_f64().unwrap_or(0.0),
        Value::Bool(v) => {
            if *v {
                1.0
            } else {
                0.0
            }
        }
        _ => 0.0,
    }
}

pub fn get_int_value(val: &Value) -> i64 {
    match val {
        Value::String(v) => v.parse::<i64>().unwrap_or(0),
        // i64, u64 both can be converted to i64, f64 needs to be converted to i64
        Value::Number(v) => match v.as_i64() {
            Some(v) => v,
            None => v.as_f64().unwrap_or(0.0) as i64,
        },
        Value::Bool(v) => {
            if *v {
                1
            } else {
                0
            }
        }
        _ => 0,
    }
}

pub fn get_uint_value(val: &Value) -> u64 {
    match val {
        Value::String(v) => v.parse::<u64>().unwrap_or(0),
        // i64 is negative, u64 is positive, f64 needs to be converted to u64
        Value::Number(v) => match v.as_u64() {
            Some(v) => v,
            None => v.as_f64().unwrap_or(0.0) as u64,
        },
        Value::Bool(v) => {
            if *v {
                1
            } else {
                0
            }
        }
        _ => 0,
    }
}

pub fn get_bool_value(val: &Value) -> bool {
    match val {
        Value::String(v) => v.parse::<bool>().unwrap_or(false),
        Value::Number(v) => v.as_f64().unwrap_or(0.0) > 0.0,
        Value::Bool(v) => *v,
        _ => false,
    }
}

pub fn get_string_value(value: &Value) -> String {
    if value.is_string() {
        value.as_str().unwrap_or_default().to_string()
    } else if value.is_i64() {
        value.as_i64().unwrap_or_default().to_string()
    } else if value.is_u64() {
        value.as_u64().unwrap_or_default().to_string()
    } else if value.is_f64() {
        value.as_f64().unwrap_or_default().to_string()
    } else if value.is_boolean() {
        value.as_bool().unwrap_or_default().to_string()
    } else if value.is_null() {
        "".to_string()
    } else {
        value.to_string()
    }
}

pub fn pickup_string_value(val: Value) -> String {
    match val {
        Value::String(v) => v,
        Value::Number(v) => v.to_string(),
        Value::Bool(v) => v.to_string(),
        _ => val.to_string(),
    }
}

pub fn estimate_json_bytes(val: &Value) -> usize {
    let mut size = 0;
    match val {
        Value::Object(map) => {
            // {?} extra 2
            size += 2;
            for (k, v) in map {
                if k == crate::ORIGINAL_DATA_COL_NAME || k == crate::ALL_VALUES_COL_NAME {
                    continue;
                }
                // "key":?, extra 4 bytes
                size += k.len() + estimate_json_bytes(v) + 4;
            }
            // remove ',' for last item
            if !map.is_empty() {
                size -= 1;
            }
        }
        Value::Array(arr) => {
            // []=>2 [?]=>2 [?,?] extra 1+n
            size += std::cmp::max(arr.len(), 1) + 1;
            for v in arr {
                size += estimate_json_bytes(v);
            }
        }
        Value::String(s) => {
            // count the " character in string, as it will be escaped in the input json
            // also we use bytes() here as sometimes compiler can optimize it faster with sse
            // see https://users.rust-lang.org/t/count-number-of-z-in-a-string/49763/5
            let quote_count = s.bytes().filter(|b| *b == b'"').count();
            let slash_count = s.bytes().filter(|b| *b == b'\\').count();
            // "?"=>2
            size += s.len() + 2 + quote_count + slash_count;
        }
        Value::Number(n) => {
            size += n.to_string().len();
        }
        Value::Bool(b) => {
            // true for 4 bytes, false for 5 bytes
            size += if *b { 4 } else { 5 };
        }
        Value::Null => {
            size += 4;
        }
    }
    size
}

/// NOTE: caller should check if the path == '.', because if so,
/// this will do an unnecessary to_owned call on the value, which
/// can be avoided.
pub fn get_value_from_path(value: &Value, path: &str) -> Option<Value> {
    if path == "." {
        return Some(value.to_owned());
    }
    let (first, rest) = match path.split_once('*') {
        Some((first, rest)) => (first, Some(rest)),
        None => (path, None),
    };

    let mut temp = value;
    for key in first.split('.') {
        if key.is_empty() {
            continue;
        }
        match temp.as_object() {
            Some(map) => match map.get(key) {
                Some(v) => temp = v,
                None => return None,
            },
            None => return None,
        }
    }
    match rest {
        None => Some(temp.to_owned()),
        Some(rest) => match temp.as_array() {
            None => None,
            Some(arr) => {
                let t = arr
                    .iter()
                    .flat_map(|f| {
                        get_value_from_path(f, rest).map(|v| match v {
                            Value::Array(arr) => arr,
                            _ => vec![v],
                        })
                    })
                    .flatten()
                    .collect_vec();
                Some(Value::Array(t))
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_path_simple() {
        // simple extraction with .
        let json = r#""abcde""#;
        let val: Value = from_str(json).unwrap();
        assert_eq!(
            get_value_from_path(&val, "."),
            Some(Value::String("abcde".to_string()))
        );

        // non existing path and leading .
        let json = r#""abcde""#;
        let val: Value = from_str(json).unwrap();
        assert_eq!(get_value_from_path(&val, ".a.b"), None);
        // existing path and leading .
        let json = r#"{"a":{"b":5}}"#;
        let val: Value = from_str(json).unwrap();
        assert_eq!(
            get_value_from_path(&val, ".a.b"),
            Some(Value::Number(Number::from_u128(5).unwrap()))
        );

        // simple array
        let json = r#"["a","b","c"]"#;
        let val: Value = from_str(json).unwrap();
        assert_eq!(
            get_value_from_path(&val, "*."),
            Some(Value::Array(
                ["a", "b", "c"]
                    .into_iter()
                    .map(|v| Value::String(v.to_string()))
                    .collect_vec()
            ))
        );

        let json = r#"["a","b","c"]"#;
        let val: Value = from_str(json).unwrap();
        assert_eq!(
            get_value_from_path(&val, "."),
            Some(Value::Array(
                ["a", "b", "c"]
                    .into_iter()
                    .map(|v| Value::String(v.to_string()))
                    .collect_vec()
            ))
        );

        // complex array
        let json = r#"[{"a":true},{"a":false},{"a":true}]"#;
        let val: Value = from_str(json).unwrap();
        assert_eq!(
            get_value_from_path(&val, ".*.a"),
            Some(Value::Array(
                [true, false, true]
                    .into_iter()
                    .map(Value::Bool)
                    .collect_vec()
            ))
        );

        // array with non existing key elements
        let json = r#"[{"a":true},{"c":false},{"b":true}]"#;
        let val: Value = from_str(json).unwrap();
        assert_eq!(
            get_value_from_path(&val, ".*.a"),
            Some(Value::Array(
                [true,].into_iter().map(Value::Bool).collect_vec()
            ))
        );

        // complex nested array
        let json = r#"[{"a":[{"b":true}]},{"a":[{"b":false}]},{"a":[{"b":true}]}]"#;
        let val: Value = from_str(json).unwrap();
        assert_eq!(
            get_value_from_path(&val, "*.a.*.b"),
            Some(Value::Array(
                [true, false, true]
                    .into_iter()
                    .map(Value::Bool)
                    .collect_vec()
            ))
        );
    }

    // Additional comprehensive tests for better coverage
    #[test]
    fn test_value_conversion_functions() {
        // Test get_float_value
        assert_eq!(
            get_float_value(&Value::String("123.45".to_string())),
            123.45
        );
        assert_eq!(get_float_value(&Value::String("invalid".to_string())), 0.0);
        assert_eq!(get_float_value(&Value::Number(Number::from(42))), 42.0);
        assert_eq!(
            get_float_value(&Value::Number(Number::from_f64(3.14).unwrap())),
            3.14
        );
        assert_eq!(get_float_value(&Value::Bool(true)), 1.0);
        assert_eq!(get_float_value(&Value::Bool(false)), 0.0);
        assert_eq!(get_float_value(&Value::Null), 0.0);
        assert_eq!(get_float_value(&Value::Array(vec![])), 0.0);

        // Test get_int_value
        assert_eq!(get_int_value(&Value::String("123".to_string())), 123);
        assert_eq!(get_int_value(&Value::String("invalid".to_string())), 0);
        assert_eq!(get_int_value(&Value::Number(Number::from(42))), 42);
        assert_eq!(
            get_int_value(&Value::Number(Number::from_f64(3.14).unwrap())),
            3
        );
        assert_eq!(get_int_value(&Value::Bool(true)), 1);
        assert_eq!(get_int_value(&Value::Bool(false)), 0);
        assert_eq!(get_int_value(&Value::Null), 0);
        assert_eq!(get_int_value(&Value::Array(vec![])), 0);

        // Test get_uint_value
        assert_eq!(get_uint_value(&Value::String("123".to_string())), 123);
        assert_eq!(get_uint_value(&Value::String("invalid".to_string())), 0);
        assert_eq!(get_uint_value(&Value::Number(Number::from(42u64))), 42);
        assert_eq!(
            get_uint_value(&Value::Number(Number::from_f64(3.14).unwrap())),
            3
        );
        assert_eq!(get_uint_value(&Value::Bool(true)), 1);
        assert_eq!(get_uint_value(&Value::Bool(false)), 0);
        assert_eq!(get_uint_value(&Value::Null), 0);
        assert_eq!(get_uint_value(&Value::Array(vec![])), 0);

        // Test get_bool_value
        assert_eq!(get_bool_value(&Value::String("true".to_string())), true);
        assert_eq!(get_bool_value(&Value::String("false".to_string())), false);
        assert_eq!(get_bool_value(&Value::String("invalid".to_string())), false);
        assert_eq!(get_bool_value(&Value::Number(Number::from(1))), true);
        assert_eq!(get_bool_value(&Value::Number(Number::from(0))), false);
        assert_eq!(get_bool_value(&Value::Number(Number::from(42))), true);
        assert_eq!(get_bool_value(&Value::Bool(true)), true);
        assert_eq!(get_bool_value(&Value::Bool(false)), false);
        assert_eq!(get_bool_value(&Value::Null), false);
        assert_eq!(get_bool_value(&Value::Array(vec![])), false);

        // Test get_string_value
        assert_eq!(
            get_string_value(&Value::String("hello".to_string())),
            "hello"
        );
        assert_eq!(get_string_value(&Value::Number(Number::from(42))), "42");
        assert_eq!(
            get_string_value(&Value::Number(Number::from_f64(3.14).unwrap())),
            "3.14"
        );
        assert_eq!(get_string_value(&Value::Bool(true)), "true");
        assert_eq!(get_string_value(&Value::Bool(false)), "false");
        assert_eq!(get_string_value(&Value::Null), "");
        assert_eq!(
            get_string_value(&Value::Array(vec![Value::String("test".to_string())])),
            "[\"test\"]"
        );
    }

    #[test]
    fn test_pickup_string_value() {
        assert_eq!(
            pickup_string_value(Value::String("hello".to_string())),
            "hello"
        );
        assert_eq!(pickup_string_value(Value::Number(Number::from(42))), "42");
        assert_eq!(pickup_string_value(Value::Bool(true)), "true");
        assert_eq!(pickup_string_value(Value::Bool(false)), "false");
        assert_eq!(pickup_string_value(Value::Null), "null");
        assert_eq!(
            pickup_string_value(Value::Array(vec![Value::String("test".to_string())])),
            "[\"test\"]"
        );
    }

    #[test]
    fn test_estimate_json_bytes() {
        let test_values = vec![
            json!({"simple": "test"}),
            json!({"complex": {"nested": {"deep": "value"}}}),
            json!({"array": [1, 2, 3, 4, 5]}),
            json!({"large_string": "a".repeat(1000)}),
        ];

        for value in test_values {
            let estimated_size = estimate_json_bytes(&value);
            assert!(estimated_size > 0);

            // Rough validation: estimated size should be reasonable
            let json_string = to_string(&value).unwrap();
            let actual_size = json_string.len();

            // Estimated size should be in the same ballpark as actual size
            assert!(estimated_size > actual_size / 2);
            assert!(estimated_size < actual_size * 3);
        }
    }

    #[test]
    fn test_estimate_json_bytes_comprehensive() {
        // Test empty objects and arrays
        let empty_obj = json!({});
        assert_eq!(estimate_json_bytes(&empty_obj), 2); // {}

        let empty_arr = json!([]);
        assert_eq!(estimate_json_bytes(&empty_arr), 2); // []

        // Test simple values
        let null_val = json!(null);
        assert_eq!(estimate_json_bytes(&null_val), 4); // null

        let bool_val = json!(true);
        assert_eq!(estimate_json_bytes(&bool_val), 4); // true

        let num_val = json!(123);
        assert_eq!(estimate_json_bytes(&num_val), 3); // 123

        let str_val = json!("hello");
        assert_eq!(estimate_json_bytes(&str_val), 7); // "hello"

        // Test nested structures
        let nested = json!({
            "a": {
                "b": [1, 2, 3],
                "c": "test"
            },
            "d": null
        });
        let expected_size = estimate_json_bytes(&nested);
        assert!(expected_size > 0);
    }

    #[test]
    fn test_get_value_from_path_edge_cases() {
        // Test with empty path - the function returns the entire value
        let json1 = json!({"a": "b"});
        assert_eq!(get_value_from_path(&json1, ""), Some(json!({"a": "b"})));

        // Test with path containing only dots - the function returns the entire value
        let json2 = json!({"a": "b"});
        assert_eq!(get_value_from_path(&json2, "..."), Some(json!({"a": "b"})));

        // Test with wildcard on non-array - this should return None since "a" is not an array
        let json5 = json!({"a": "b"});
        assert_eq!(get_value_from_path(&json5, "*.a"), None);

        // Test with wildcard on array
        let json6 = json!([{"a": "b"}, {"a": "c"}]);
        let result = get_value_from_path(&json6, "*.a");
        assert!(result.is_some());
        if let Some(Value::Array(arr)) = result {
            assert_eq!(arr.len(), 2);
        }
    }

    #[test]
    fn test_get_value_from_path_deep_nesting() {
        let json = json!({
            "level1": {
                "level2": {
                    "level3": {
                        "level4": {
                            "level5": "deep_value"
                        }
                    }
                }
            }
        });

        let result = get_value_from_path(&json, "level1.level2.level3.level4.level5");
        assert_eq!(result, Some(json!("deep_value")));

        // Test non-existent deep path
        let result = get_value_from_path(&json, "level1.level2.level3.level4.level5.level6");
        assert_eq!(result, None);
    }

    #[test]
    fn test_get_value_from_path_array_operations() {
        let json = json!([
            {"id": 1, "name": "Alice"},
            {"id": 2, "name": "Bob"},
            {"id": 3, "name": "Charlie"}
        ]);

        // Test wildcard on array
        let names = get_value_from_path(&json, "*.name");
        assert!(names.is_some());
        if let Some(Value::Array(arr)) = names {
            assert_eq!(arr.len(), 3);
            assert_eq!(arr[0], json!("Alice"));
            assert_eq!(arr[1], json!("Bob"));
            assert_eq!(arr[2], json!("Charlie"));
        }

        // Test specific array index - this won't work with the current implementation
        // let first_item = get_value_from_path(&json, "0");
        // assert_eq!(first_item, Some(json!({"id": 1, "name": "Alice"})));

        // Test nested array access
        let json = json!([
            {"items": [{"value": "a"}, {"value": "b"}]},
            {"items": [{"value": "c"}]}
        ]);

        let values = get_value_from_path(&json, "*.items.*.value");
        assert!(values.is_some());
        if let Some(Value::Array(arr)) = values {
            assert_eq!(arr.len(), 3);
            assert_eq!(arr[0], json!("a"));
            assert_eq!(arr[1], json!("b"));
            assert_eq!(arr[2], json!("c"));
        }
    }

    #[test]
    fn test_get_value_from_path_special_characters() {
        let json = json!({
            "key.with.dots": "value1",
            "key-with-dashes": "value2",
            "key_with_underscores": "value3",
            "key with spaces": "value4"
        });

        // Test keys with dots - the function splits on dots, so this won't work
        // let result = get_value_from_path(&json, "key.with.dots");
        // assert_eq!(result, Some(json!("value1")));

        // Test keys with other special characters
        let result = get_value_from_path(&json, "key-with-dashes");
        assert_eq!(result, Some(json!("value2")));

        let result = get_value_from_path(&json, "key_with_underscores");
        assert_eq!(result, Some(json!("value3")));

        let result = get_value_from_path(&json, "key with spaces");
        assert_eq!(result, Some(json!("value4")));
    }

    #[test]
    fn test_estimate_json_bytes_with_escaped_characters() {
        // Test strings with quotes and backslashes
        let json = json!({
            "quoted": "He said \"Hello World!\"",
            "backslashed": "C:\\Users\\Name\\file.txt",
            "mixed": "Line 1\nLine 2\tTabbed"
        });

        let estimated_size = estimate_json_bytes(&json);
        let actual_size = to_string(&json).unwrap().len();

        // The estimate should be close to the actual size
        assert!(estimated_size > 0);
        assert!(estimated_size <= actual_size);
    }
}
