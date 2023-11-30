use crate::common::utils::{flatten::format_key, json};

pub fn get_float_value(val: &json::Value) -> f64 {
    match val {
        json::Value::String(v) => v.parse::<f64>().unwrap_or(0.0),
        json::Value::Number(v) => v.as_f64().unwrap_or(0.0),
        _ => 0.0,
    }
}

pub fn get_int_value(val: &json::Value) -> i64 {
    match val {
        json::Value::String(v) => v.parse::<i64>().unwrap_or(0),
        json::Value::Number(v) => v.as_i64().unwrap_or(0),
        _ => 0,
    }
}
pub fn get_string_value(val: &json::Value) -> String {
    match val {
        json::Value::String(v) => v.to_string(),
        json::Value::Number(v) => v.as_i64().unwrap_or(0).to_string(),
        _ => "".to_string(),
    }
}

pub fn get_val_for_attr(attr_val: &json::Value) -> json::Value {
    let local_val = attr_val.as_object().unwrap();
    if let Some((key, value)) = local_val.into_iter().next() {
        match key.as_str() {
            "stringValue" | "string_value" => {
                return json::json!(get_string_value(value));
            }
            "boolValue" | "bool_value" => {
                return json::json!(value.as_bool().unwrap_or(false).to_string());
            }
            "intValue" | "int_value" => {
                return json::json!(get_int_value(value).to_string());
            }
            "doubleValue" | "double_value" => {
                return json::json!(get_float_value(value).to_string());
            }

            "bytesValue" | "bytes_value" => {
                return json::json!(value.as_str().unwrap_or("").to_string());
            }

            "arrayValue" | "array_value" => {
                let mut vals = vec![];
                for item in value
                    .get("values")
                    .unwrap()
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                {
                    vals.push(get_val_for_attr(item));
                }
                return json::json!(vals);
            }

            "kvlistValue" | "kvlist_value" => {
                let mut vals = json::Map::new();
                for item in value
                    .get("values")
                    .unwrap()
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                {
                    let key = item.get("key").unwrap().as_str().unwrap_or("").to_string();
                    let value = item.get("value").unwrap().clone();
                    vals.insert(format_key(&key), get_val_for_attr(&value));
                }
                return json::json!(vals);
            }

            _ => {
                return json::json!(get_string_value(value));
            }
        }
    };
    attr_val.clone()
}

pub fn get_val_with_type_retained(val: &json::Value) -> json::Value {
    match val {
        json::Value::String(val) => {
            json::json!(val)
        }
        json::Value::Bool(val) => {
            json::json!(val)
        }
        json::Value::Number(val) => {
            json::json!(val)
        }
        json::Value::Array(val) => {
            json::json!(val)
        }
        json::Value::Object(val) => {
            json::json!(val)
        }
        json::Value::Null => json::Value::Null,
    }
}
