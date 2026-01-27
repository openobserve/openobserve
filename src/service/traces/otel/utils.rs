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

//! Utility functions for OTEL trace processing

use std::collections::HashMap;

use config::utils::json;

/// Validates if a string is a valid date
pub fn is_valid_date_string(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

/// Converts nested key paths (e.g., "gen_ai.prompt.0.role") to nested objects/arrays
/// This is critical for handling TraceLoop and OpenInference attributes
pub fn convert_key_path_to_nested_object(
    input: &HashMap<String, json::Value>,
    prefix: &str,
) -> json::Value {
    // Check if the prefix key exists directly
    if let Some(value) = input.get(prefix) {
        return value.clone();
    }

    // Collect all keys with this prefix
    let prefix_dot = format!("{}.", prefix);
    let keys: Vec<String> = input
        .keys()
        .filter(|k| k.starts_with(&prefix_dot))
        .map(|k| k.strip_prefix(&prefix_dot).unwrap().to_string())
        .collect();

    if keys.is_empty() {
        return json::Value::Null;
    }

    // Check if we should use an array (keys start with digits like "0.role", "1.content")
    let use_array = keys.iter().any(|k| {
        k.split('.')
            .next()
            .and_then(|part| part.parse::<usize>().ok())
            .is_some()
    });

    if use_array {
        build_array_from_keys(&keys, input, prefix)
    } else {
        build_object_from_keys(&keys, input, prefix)
    }
}

fn build_array_from_keys(
    keys: &[String],
    input: &HashMap<String, json::Value>,
    prefix: &str,
) -> json::Value {
    let mut max_index = 0;

    // Find max index
    for key in keys {
        if let Some(first_part) = key.split('.').next()
            && let Ok(index) = first_part.parse::<usize>()
        {
            max_index = max_index.max(index);
        }
    }

    // Initialize array with empty objects
    let mut array: Vec<json::Value> = Vec::new();
    for _ in 0..=max_index {
        array.push(json::json!({}));
    }

    // Populate array
    for key in keys {
        let parts: Vec<&str> = key.split('.').collect();
        if let Ok(index) = parts[0].parse::<usize>() {
            if index >= array.len() {
                continue;
            }

            let full_key = format!("{}.{}", prefix, key);
            if let Some(value) = input.get(&full_key) {
                if parts.len() == 2 {
                    // Simple case: 0.field -> array[0].field
                    if let json::Value::Object(ref mut obj) = array[index] {
                        obj.insert(parts[1].to_string(), value.clone());
                    }
                } else {
                    // Nested case: 0.message.content -> array[0].message.content
                    set_nested_value(&mut array[index], &parts[1..], value.clone());
                }
            }
        }
    }

    json::Value::Array(array)
}

fn build_object_from_keys(
    keys: &[String],
    input: &HashMap<String, json::Value>,
    prefix: &str,
) -> json::Value {
    let mut result = json::json!({});

    for key in keys {
        let full_key = format!("{}.{}", prefix, key);
        if let Some(value) = input.get(&full_key) {
            let parts: Vec<&str> = key.split('.').collect();
            if parts.len() == 1 {
                if let json::Value::Object(ref mut obj) = result {
                    obj.insert(key.clone(), value.clone());
                }
            } else {
                set_nested_value(&mut result, &parts, value.clone());
            }
        }
    }

    result
}

fn set_nested_value(target: &mut json::Value, path: &[&str], value: json::Value) {
    if path.is_empty() {
        return;
    }

    if path.len() == 1 {
        if let json::Value::Object(obj) = target {
            obj.insert(path[0].to_string(), value);
        }
        return;
    }

    if let json::Value::Object(obj) = target {
        let key = path[0];
        let next_key = path.get(1).unwrap_or(&"");

        // Check if next level should be array or object
        let next_is_array = next_key.parse::<usize>().is_ok();

        let nested = obj.entry(key.to_string()).or_insert_with(|| {
            if next_is_array {
                json::json!([])
            } else {
                json::json!({})
            }
        });

        set_nested_value(nested, &path[1..], value);
    } else if let json::Value::Array(arr) = target
        && let Ok(index) = path[0].parse::<usize>()
    {
        while arr.len() <= index {
            arr.push(json::json!({}));
        }
        if index < arr.len() {
            set_nested_value(&mut arr[index], &path[1..], value);
        }
    }
}

/// Parses prompt metadata from Vercel AI SDK attributes
/// Supports ai.telemetry.metadata.langfusePrompt (common from Vercel AI SDK)
pub fn parse_ai_sdk_prompt_metadata(
    attributes: &HashMap<String, json::Value>,
) -> Option<(String, i32)> {
    // Check for langfusePrompt from Vercel AI SDK
    if let Some(value) = attributes.get("ai.telemetry.metadata.langfusePrompt")
        && let Some(s) = value.as_str()
        && let Ok(parsed) = serde_json::from_str::<json::Value>(s)
        && let Some(name) = parsed.get("name").and_then(|v| v.as_str())
        && let Some(version) = parsed.get("version").and_then(|v| v.as_i64())
    {
        return Some((name.to_string(), version as i32));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_key_path_simple_object() {
        let mut input = HashMap::new();
        input.insert("test.name".to_string(), json::json!("Alice"));
        input.insert("test.age".to_string(), json::json!(30));

        let result = convert_key_path_to_nested_object(&input, "test");
        assert_eq!(result["name"], "Alice");
        assert_eq!(result["age"], 30);
    }

    #[test]
    fn test_convert_key_path_array() {
        let mut input = HashMap::new();
        input.insert("messages.0.role".to_string(), json::json!("user"));
        input.insert("messages.0.content".to_string(), json::json!("Hello"));
        input.insert("messages.1.role".to_string(), json::json!("assistant"));
        input.insert("messages.1.content".to_string(), json::json!("Hi"));

        let result = convert_key_path_to_nested_object(&input, "messages");
        assert!(result.is_array());
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["role"], "user");
        assert_eq!(arr[0]["content"], "Hello");
        assert_eq!(arr[1]["role"], "assistant");
        assert_eq!(arr[1]["content"], "Hi");
    }

    #[test]
    fn test_convert_key_path_nested() {
        let mut input = HashMap::new();
        input.insert("obj.user.name".to_string(), json::json!("Bob"));
        input.insert("obj.user.age".to_string(), json::json!(25));

        let result = convert_key_path_to_nested_object(&input, "obj");
        assert_eq!(result["user"]["name"], "Bob");
        assert_eq!(result["user"]["age"], 25);
    }
}
