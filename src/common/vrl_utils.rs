use chrono::SecondsFormat;

use super::json;

pub fn vrl_value_to_json_value(value: value::Value) -> json::Value {
    use serde_json::Value::*;

    match value {
        v @ value::Value::Bytes(_) => String(
            vrl::value::VrlValueConvert::try_bytes_utf8_lossy(&v)
                .unwrap()
                .into_owned(),
        ),
        value::Value::Integer(v) => v.into(),
        value::Value::Float(v) => v.into_inner().into(),
        value::Value::Boolean(v) => v.into(),
        value::Value::Object(v) => v
            .into_iter()
            .map(|(k, v)| (k, vrl_value_to_json_value(v)))
            .collect::<serde_json::Value>(),
        value::Value::Array(v) => v
            .into_iter()
            .map(vrl_value_to_json_value)
            .collect::<serde_json::Value>(),
        value::Value::Timestamp(v) => v.to_rfc3339_opts(SecondsFormat::AutoSi, true).into(),
        value::Value::Regex(v) => v.to_string().into(),
        value::Value::Null => Null,
    }
}
