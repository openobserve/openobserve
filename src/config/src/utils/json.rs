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
    fn test_estimate_json_bytes() {
        let json = r#"{"a":null,"b":true,"c":false,"d":{"a":"b","c":true,"d":false,"e":123456},"e":[""],"f":["a"],"g":["a","b"],"h":"bcdef","i":{},"j":{"ok":"yes"}}"#;
        let val: Value = from_str(json).unwrap();
        assert_eq!(estimate_json_bytes(&val), json.len());
    }

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
}
