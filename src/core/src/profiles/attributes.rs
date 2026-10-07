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

use config::utils::json;
use opentelemetry_proto::tonic::{
    common::v1::{AnyValue, any_value::Value},
    profiles::v1development::ProfilesDictionary,
};

use super::lookup_string;

pub(super) fn resolve_any_value_string(
    value: Option<&AnyValue>,
    dictionary: Option<&ProfilesDictionary>,
) -> Option<String> {
    if let Some(Value::StringValueStrindex(index)) = value.and_then(|value| value.value.as_ref()) {
        return lookup_string(
            dictionary.map(|d| d.string_table.as_slice()).unwrap_or(&[]),
            *index,
        );
    }
    let normalized = resolve_any_value(value, dictionary);
    let string_value = json::get_string_value(&normalized);
    (!string_value.is_empty()).then_some(string_value)
}

fn resolve_any_value(
    value: Option<&AnyValue>,
    dictionary: Option<&ProfilesDictionary>,
) -> json::Value {
    match value.and_then(|value| value.value.as_ref()) {
        Some(Value::StringValueStrindex(index)) => lookup_string(
            dictionary.map(|d| d.string_table.as_slice()).unwrap_or(&[]),
            *index,
        )
        .map(json::Value::String)
        .unwrap_or(json::Value::Null),
        Some(Value::ArrayValue(array)) => json::Value::Array(
            array
                .values
                .iter()
                .map(|value| resolve_any_value(Some(value), dictionary))
                .collect(),
        ),
        Some(Value::KvlistValue(list)) => {
            let values = list
                .values
                .iter()
                .map(|attribute| {
                    let key = if attribute.key.is_empty() {
                        lookup_string(
                            dictionary.map(|d| d.string_table.as_slice()).unwrap_or(&[]),
                            attribute.key_strindex,
                        )
                        .unwrap_or_default()
                    } else {
                        attribute.key.clone()
                    };
                    (key, resolve_any_value(attribute.value.as_ref(), dictionary))
                })
                .collect();
            json::Value::Object(values)
        }
        _ => crate::ingestion::grpc::get_val_with_type_retained(&value),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        super::{otlp_json_compat, validation},
        *,
    };

    #[test]
    fn json_array_string_references_survive_validation_and_extraction() {
        assert_extracted(
            json::json!({"arrayValue": {"values": [{"stringValueStrindex": "2"}, {"intValue": "7"}, {"boolValue": true}, {"stringValue": "literal"}]}}),
            r#"["worker-1",7,true,"literal"]"#,
        );
    }

    #[test]
    fn json_kvlist_string_references_survive_validation_and_extraction() {
        assert_extracted(
            json::json!({"kvlistValue": {"values": [{"key": "label", "value": {"stringValueStrindex": 2}}, {"key": "nested", "value": {"arrayValue": {"values": [{"stringValueStrindex": 2}]}}}]}}),
            r#"{"label":"worker-1","nested":["worker-1"]}"#,
        );
    }

    #[test]
    fn nested_indexed_keys_survive_json_validation_and_extraction() {
        assert_extracted(
            json::json!({"kvlistValue": {"values": [{"keyStrindex": 1, "value": {"stringValueStrindex": 2}}]}}),
            r#"{"context":"worker-1"}"#,
        );
        for index in [-1, 99] {
            let mut payload = json::json!({
                "dictionary": {
                    "stringTable": ["", "context", "worker-1"],
                    "attributeTable": [{"value": {}}, {"value": {"kvlistValue": {"values": [{"keyStrindex": index, "value": {"stringValueStrindex": 2}}]}}}]
                }
            });
            otlp_json_compat::normalize(&mut payload);
            let request = otlp_json_compat::deserialize(payload).unwrap();
            assert_eq!(
                validation::validate(&request).unwrap_err(),
                format!(
                    "dictionary.attribute_table[1].value.kvlist_value.values[0].key_strindex: index {index} is outside dictionary table length 3"
                )
            );
        }
    }

    #[test]
    fn top_level_string_reference_fast_path_preserves_unset_behavior() {
        let dictionary = ProfilesDictionary {
            string_table: vec!["".into(), "worker-1".into()],
            ..Default::default()
        };
        for (index, expected) in [(0, None), (1, Some("worker-1"))] {
            let value = AnyValue {
                value: Some(Value::StringValueStrindex(index)),
            };
            assert_eq!(
                resolve_any_value_string(Some(&value), Some(&dictionary)).as_deref(),
                expected
            );
        }
        assert!(resolve_any_value_string(None, Some(&dictionary)).is_none());
    }

    #[test]
    fn ordinary_attribute_values_keep_their_extraction() {
        for (value, expected) in [
            (json::json!({"stringValue": "literal"}), "literal"),
            (json::json!({"intValue": "7"}), "7"),
            (json::json!({"boolValue": true}), "true"),
            (json::json!({"doubleValue": 2.5}), "2.5"),
            (json::json!({"bytesValue": "AQI="}), "[1,2]"),
        ] {
            assert_extracted(value, expected);
        }
    }

    fn assert_extracted(value: json::Value, expected: &str) {
        let mut payload = json::json!({
            "dictionary": {
                "stringTable": ["", "context", "worker-1"],
                "attributeTable": [{}, {"keyStrindex": 1, "value": value}]
            },
            "resourceProfiles": [{"scopeProfiles": [{"profiles": [{"samples": [{"attributeIndices": [1], "values": [1]}]}]}]}]
        });
        otlp_json_compat::normalize(&mut payload);
        let request = otlp_json_compat::deserialize(payload).unwrap();
        validation::validate(&request).unwrap();
        let dictionary = request.dictionary.as_ref().unwrap();
        assert_eq!(
            resolve_any_value_string(
                dictionary.attribute_table[1].value.as_ref(),
                Some(dictionary)
            )
            .as_deref(),
            Some(expected)
        );
    }
}
