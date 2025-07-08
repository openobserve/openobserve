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

use config::utils::json;
use opentelemetry_proto::tonic::{
    common::v1::{AnyValue, any_value::Value},
    metrics::v1::{exemplar, number_data_point},
};

pub fn get_val(attr_val: &Option<&AnyValue>) -> json::Value {
    match attr_val {
        Some(local_val) => match &local_val.value {
            Some(val) => match val {
                Value::StringValue(inner_val) => json::Value::String(inner_val.to_owned()),
                Value::BoolValue(inner_val) => json::Value::String(inner_val.to_string()),
                Value::IntValue(inner_val) => json::Value::String(inner_val.to_string()),
                Value::DoubleValue(inner_val) => json::Value::String(inner_val.to_string()),
                Value::ArrayValue(inner_val) => {
                    let mut vals = vec![];
                    for item in inner_val.values.iter() {
                        vals.push(get_val(&Some(item)))
                    }
                    json::Value::Array(vals)
                }
                Value::KvlistValue(inner_val) => {
                    let mut vals = json::Map::new();
                    for item in inner_val.values.iter() {
                        vals.insert(item.key.clone(), get_val(&item.value.as_ref()));
                    }
                    json::Value::from(vals)
                }
                Value::BytesValue(inner_val) => {
                    let s = String::from_utf8(inner_val.to_owned()).unwrap_or_default();
                    json::Value::String(s)
                }
            },
            None => json::Value::Null,
        },
        None => json::Value::Null,
    }
}

pub fn get_severity_value(severity_number: i32) -> String {
    match severity_number {
        0 => "Unspecified",
        1 => "Trace",
        2 => "Trace2",
        3 => "Trace3",
        4 => "Trace4",
        5 => "Debug",
        6 => "Debug2",
        7 => "Debug3",
        8 => "Debug4",
        9 => "Info",
        10 => "Info2",
        11 => "Info3",
        12 => "Info4",
        13 => "Warn ",
        14 => "Warn2",
        15 => "Warn3",
        16 => "Warn4",
        17 => "Error",
        18 => "Error2",
        19 => "Error3",
        20 => "Error4",
        21 => "Fatal",
        22 => "Fatal2",
        23 => "Fatal3",
        24 => "Fatal4",
        _ => "Unspecified",
    }
    .into()
}

pub fn get_metric_val(attr_val: &Option<number_data_point::Value>) -> json::Value {
    match attr_val {
        Some(local_val) => match local_val {
            number_data_point::Value::AsDouble(val) => json::json!(val),
            number_data_point::Value::AsInt(val) => json::json!(*val as f64),
        },
        None => json::Value::Null,
    }
}

pub fn get_exemplar_val(attr_val: &Option<exemplar::Value>) -> json::Value {
    match attr_val {
        Some(local_val) => match local_val {
            exemplar::Value::AsDouble(val) => json::json!(val),
            exemplar::Value::AsInt(val) => json::json!(*val as f64),
        },
        None => json::Value::Null,
    }
}

pub fn get_val_for_attr(attr_val: json::Value) -> json::Value {
    let local_val = attr_val.as_object().unwrap();
    if let Some((_key, value)) = local_val.into_iter().next() {
        return serde_json::Value::String(super::get_string_value(value));
    };
    ().into()
}

pub fn get_val_with_type_retained(attr_val: &Option<&AnyValue>) -> json::Value {
    match attr_val {
        Some(local_val) => match &local_val.value {
            Some(val) => match val {
                Value::StringValue(val) => {
                    json::json!(val)
                }
                Value::BoolValue(val) => {
                    json::json!(val)
                }
                Value::IntValue(val) => {
                    json::json!(val)
                }
                Value::DoubleValue(val) => {
                    json::json!(val)
                }
                Value::ArrayValue(val) => {
                    let mut vals = vec![];
                    for item in val.values.iter() {
                        vals.push(get_val_with_type_retained(&Some(item)))
                    }
                    json::json!(vals)
                }
                Value::KvlistValue(val) => {
                    let mut vals = json::Map::new();
                    for item in val.values.iter().cloned() {
                        vals.insert(item.key, get_val_with_type_retained(&item.value.as_ref()));
                    }
                    json::json!(vals)
                }
                Value::BytesValue(val) => {
                    json::json!(val)
                }
            },
            None => json::Value::Null,
        },
        None => json::Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_val() {
        let in_str = "Test".to_string();
        let str_val = AnyValue {
            value: Some(Value::StringValue(in_str.clone())),
        };
        let resp = get_val(&Some(&str_val));
        assert_eq!(resp.as_str().unwrap(), in_str);

        let in_bool = false;
        let bool_val = AnyValue {
            value: Some(Value::BoolValue(in_bool)),
        };
        let resp = get_val(&Some(&bool_val));
        assert_eq!(resp.as_str().unwrap(), in_bool.to_string());

        let in_int = 20;
        let int_val = AnyValue {
            value: Some(Value::IntValue(in_int)),
        };
        let resp = get_val(&Some(&int_val));
        assert_eq!(resp.as_str().unwrap(), in_int.to_string());

        let in_double = 20.00;
        let double_val = AnyValue {
            value: Some(Value::DoubleValue(in_double)),
        };
        let resp = get_val(&Some(&double_val));
        assert_eq!(resp.as_str().unwrap(), in_double.to_string());

        let in_arr = vec![int_val.clone()];
        let arr_val = AnyValue {
            value: Some(Value::ArrayValue(
                opentelemetry_proto::tonic::common::v1::ArrayValue { values: in_arr },
            )),
        };
        let resp = get_val(&Some(&arr_val));
        assert!(!resp.as_array().unwrap().is_empty());

        let kv_val = AnyValue {
            value: Some(Value::KvlistValue(
                opentelemetry_proto::tonic::common::v1::KeyValueList {
                    values: vec![opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: in_str.clone(),
                        value: Some(int_val.clone()),
                    }],
                },
            )),
        };
        let resp = get_val(&Some(&kv_val));
        assert!(resp.as_object().unwrap().contains_key(&in_str));
        assert!(resp.as_object().unwrap().get(&in_str).unwrap().is_string());

        let in_byte = Value::BytesValue(vec![8u8]);

        let byte_val = AnyValue {
            value: Some(in_byte),
        };
        let resp = get_val(&Some(&byte_val));
        assert!(resp.is_string());
    }

    #[test]
    fn test_get_val_with_type_retained() {
        let in_str = "Test".to_string();
        let str_val = AnyValue {
            value: Some(Value::StringValue(in_str.clone())),
        };
        let resp = get_val_with_type_retained(&Some(&str_val));
        assert_eq!(resp.as_str().unwrap(), in_str);

        let in_bool = false;
        let bool_val = AnyValue {
            value: Some(Value::BoolValue(in_bool)),
        };
        let resp = get_val_with_type_retained(&Some(&bool_val));
        assert_eq!(resp.as_bool().unwrap(), in_bool);

        let in_int = 20;
        let int_val = AnyValue {
            value: Some(Value::IntValue(in_int)),
        };
        let resp = get_val_with_type_retained(&Some(&int_val));
        assert_eq!(resp.as_i64().unwrap(), in_int);

        let in_double = 20.00;
        let double_val = AnyValue {
            value: Some(Value::DoubleValue(in_double)),
        };
        let resp = get_val_with_type_retained(&Some(&double_val));
        assert_eq!(resp.as_f64().unwrap(), in_double);

        let in_arr = vec![int_val.clone()];
        let arr_val = AnyValue {
            value: Some(Value::ArrayValue(
                opentelemetry_proto::tonic::common::v1::ArrayValue { values: in_arr },
            )),
        };
        let resp = get_val_with_type_retained(&Some(&arr_val));
        assert!(!resp.as_array().unwrap().is_empty());

        let kv_val = AnyValue {
            value: Some(Value::KvlistValue(
                opentelemetry_proto::tonic::common::v1::KeyValueList {
                    values: vec![opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: in_str.clone(),
                        value: Some(int_val.clone()),
                    }],
                },
            )),
        };
        let resp = get_val_with_type_retained(&Some(&kv_val));
        assert!(resp.as_object().unwrap().contains_key(&in_str));
        assert!(resp.as_object().unwrap().get(&in_str).unwrap().is_i64());

        let in_byte = Value::BytesValue(vec![8u8]);

        let byte_val = AnyValue {
            value: Some(in_byte),
        };
        let resp = get_val_with_type_retained(&Some(&byte_val));
        assert!(resp.as_array().unwrap().first().unwrap().is_u64());
    }

    #[test]
    fn test_get_severity_value() {
        // Test all severity levels
        assert_eq!(get_severity_value(0), "Unspecified");
        assert_eq!(get_severity_value(1), "Trace");
        assert_eq!(get_severity_value(2), "Trace2");
        assert_eq!(get_severity_value(3), "Trace3");
        assert_eq!(get_severity_value(4), "Trace4");
        assert_eq!(get_severity_value(5), "Debug");
        assert_eq!(get_severity_value(6), "Debug2");
        assert_eq!(get_severity_value(7), "Debug3");
        assert_eq!(get_severity_value(8), "Debug4");
        assert_eq!(get_severity_value(9), "Info");
        assert_eq!(get_severity_value(10), "Info2");
        assert_eq!(get_severity_value(11), "Info3");
        assert_eq!(get_severity_value(12), "Info4");
        assert_eq!(get_severity_value(13), "Warn ");
        assert_eq!(get_severity_value(14), "Warn2");
        assert_eq!(get_severity_value(15), "Warn3");
        assert_eq!(get_severity_value(16), "Warn4");
        assert_eq!(get_severity_value(17), "Error");
        assert_eq!(get_severity_value(18), "Error2");
        assert_eq!(get_severity_value(19), "Error3");
        assert_eq!(get_severity_value(20), "Error4");
        assert_eq!(get_severity_value(21), "Fatal");
        assert_eq!(get_severity_value(22), "Fatal2");
        assert_eq!(get_severity_value(23), "Fatal3");
        assert_eq!(get_severity_value(24), "Fatal4");

        // Test out of range values
        assert_eq!(get_severity_value(-1), "Unspecified");
        assert_eq!(get_severity_value(25), "Unspecified");
        assert_eq!(get_severity_value(100), "Unspecified");
    }

    #[test]
    fn test_get_metric_val() {
        // Test AsDouble variant
        let double_val = number_data_point::Value::AsDouble(42.5);
        let resp = get_metric_val(&Some(double_val));
        assert_eq!(resp.as_f64().unwrap(), 42.5);

        // Test AsInt variant
        let int_val = number_data_point::Value::AsInt(42);
        let resp = get_metric_val(&Some(int_val));
        assert_eq!(resp.as_f64().unwrap(), 42.0);

        // Test None case
        let resp = get_metric_val(&None);
        assert!(resp.is_null());
    }

    #[test]
    fn test_get_exemplar_val() {
        // Test AsDouble variant
        let double_val = exemplar::Value::AsDouble(42.5);
        let resp = get_exemplar_val(&Some(double_val));
        assert_eq!(resp.as_f64().unwrap(), 42.5);

        // Test AsInt variant
        let int_val = exemplar::Value::AsInt(42);
        let resp = get_exemplar_val(&Some(int_val));
        assert_eq!(resp.as_f64().unwrap(), 42.0);

        // Test None case
        let resp = get_exemplar_val(&None);
        assert!(resp.is_null());
    }

    #[test]
    fn test_get_val_for_attr() {
        // Test with string value
        let attr_val = json::json!({
            "key1": "test_value"
        });
        let resp = get_val_for_attr(attr_val);
        assert_eq!(resp.as_str().unwrap(), "test_value");

        // Test with numeric value
        let attr_val = json::json!({
            "key2": 42
        });
        let resp = get_val_for_attr(attr_val);
        assert_eq!(resp.as_str().unwrap(), "42");

        // Test with boolean value
        let attr_val = json::json!({
            "key3": true
        });
        let resp = get_val_for_attr(attr_val);
        assert_eq!(resp.as_str().unwrap(), "true");

        // Test with float value
        let attr_val = json::json!({
            "key4": std::f32::consts::PI
        });
        let resp = get_val_for_attr(attr_val);
        assert_eq!(resp.as_str().unwrap(), "3.1415927");
    }

    #[test]
    fn test_get_val_edge_cases() {
        // Test None case
        let resp = get_val(&None);
        assert!(resp.is_null());

        // Test AnyValue with None value
        let null_val = AnyValue { value: None };
        let resp = get_val(&Some(&null_val));
        assert!(resp.is_null());

        // Test empty array
        let empty_arr = AnyValue {
            value: Some(Value::ArrayValue(
                opentelemetry_proto::tonic::common::v1::ArrayValue { values: vec![] },
            )),
        };
        let resp = get_val(&Some(&empty_arr));
        assert!(resp.as_array().unwrap().is_empty());

        // Test empty kvlist
        let empty_kv = AnyValue {
            value: Some(Value::KvlistValue(
                opentelemetry_proto::tonic::common::v1::KeyValueList { values: vec![] },
            )),
        };
        let resp = get_val(&Some(&empty_kv));
        assert!(resp.as_object().unwrap().is_empty());

        // Test invalid UTF-8 bytes
        let invalid_bytes = Value::BytesValue(vec![0xFF, 0xFE, 0xFD]);
        let byte_val = AnyValue {
            value: Some(invalid_bytes),
        };
        let resp = get_val(&Some(&byte_val));
        assert_eq!(resp.as_str().unwrap(), "");
    }

    #[test]
    fn test_get_val_with_type_retained_edge_cases() {
        // Test None case
        let resp = get_val_with_type_retained(&None);
        assert!(resp.is_null());

        // Test AnyValue with None value
        let null_val = AnyValue { value: None };
        let resp = get_val_with_type_retained(&Some(&null_val));
        assert!(resp.is_null());

        // Test empty array
        let empty_arr = AnyValue {
            value: Some(Value::ArrayValue(
                opentelemetry_proto::tonic::common::v1::ArrayValue { values: vec![] },
            )),
        };
        let resp = get_val_with_type_retained(&Some(&empty_arr));
        assert!(resp.as_array().unwrap().is_empty());

        // Test empty kvlist
        let empty_kv = AnyValue {
            value: Some(Value::KvlistValue(
                opentelemetry_proto::tonic::common::v1::KeyValueList { values: vec![] },
            )),
        };
        let resp = get_val_with_type_retained(&Some(&empty_kv));
        assert!(resp.as_object().unwrap().is_empty());

        // Test nested structures
        let nested_int = AnyValue {
            value: Some(Value::IntValue(10)),
        };
        let nested_arr = AnyValue {
            value: Some(Value::ArrayValue(
                opentelemetry_proto::tonic::common::v1::ArrayValue {
                    values: vec![nested_int],
                },
            )),
        };
        let resp = get_val_with_type_retained(&Some(&nested_arr));
        let arr = resp.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0].as_i64().unwrap(), 10);
    }
}
