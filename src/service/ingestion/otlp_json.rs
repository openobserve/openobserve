use crate::common::utils::json;

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
