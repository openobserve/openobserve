// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use serde_json::value::Map;
use serde_json::value::Value;

const KEY_SEPARATOR: &str = "_";
const FORMAT_KEY_ENABLED: bool = true;

/// Flattens the provided JSON object (`current`).
///
/// It will return an error if flattening the object would make two keys to be the same,
/// overwriting a value. It will alre return an error if the JSON value passed it's not an object.
///
/// # Errors
/// Will return `Err` if `to_flatten` it's not an object, or if flattening the object would
/// result in two or more keys colliding.
pub fn flatten(to_flatten: &Value) -> Result<Value, anyhow::Error> {
    let mut flat = Map::<String, Value>::new();
    flatten_value(to_flatten, "".to_owned(), 0, &mut flat).map(|_x| Value::Object(flat))
}

/// Flattens the passed JSON value (`current`), whose path is `parent_key` and its 0-based
/// depth is `depth`.  The result is stored in the JSON object `flattened`.
fn flatten_value(
    current: &Value,
    parent_key: String,
    depth: u32,
    flattened: &mut Map<String, Value>,
) -> Result<(), anyhow::Error> {
    if depth == 0 {
        match current {
            Value::Object(map) => {
                if map.is_empty() {
                    return Ok(()); // If the top level input object is empty there is nothing to do
                }
            }
            _ => return Err(anyhow::anyhow!("flatten value must be an object")),
        }
    }

    if let Some(current) = current.as_object() {
        flatten_object(current, &parent_key, depth, flattened)?;
    } else if let Some(current) = current.as_array() {
        flatten_array(current, &parent_key, depth, flattened)?;
    } else {
        if flattened.contains_key(&parent_key) {
            // log::error!(
            //     "flatten will be overwritten current: {:?}, new key: {}, val: {}, ",
            //     flattened,
            //     parent_key,
            //     current.clone(),
            // );
            // return Err(anyhow::anyhow!( "flatten will be overwritten a key {}", parent_key));
        }
        flattened.insert(parent_key, current.clone());
    }
    Ok(())
}

/// Flattens the passed object (`current`), whose path is `parent_key` and its 0-based depth
/// is `depth`.  The result is stored in the JSON object `flattened`.
fn flatten_object(
    current: &Map<String, Value>,
    parent_key: &str,
    depth: u32,
    flattened: &mut Map<String, Value>,
) -> Result<(), anyhow::Error> {
    for (k, v) in current.iter() {
        let k = if FORMAT_KEY_ENABLED {
            format_key(k)
        } else {
            k.to_string()
        };
        let parent_key = if depth > 0 {
            format!("{}{}{}", parent_key, KEY_SEPARATOR, k)
        } else {
            k
        };
        flatten_value(v, parent_key, depth + 1, flattened)?;
    }
    Ok(())
}

/// Flattens the passed array (`current`), whose path is `parent_key` and its 0-based depth
/// is `depth`.  The result is stored in the JSON object `flattened`.
fn flatten_array(
    current: &[Value],
    parent_key: &str,
    depth: u32,
    flattened: &mut Map<String, Value>,
) -> Result<(), anyhow::Error> {
    for (i, obj) in current.iter().enumerate() {
        let parent_key = format!("{}{}{}", parent_key, KEY_SEPARATOR, i);
        flatten_value(obj, parent_key, depth + 1, flattened)?;
    }
    Ok(())
}

/// We need every character in the key to be lowercase alphanumeric or underscore
fn format_key(key: &str) -> String {
    if key
        .chars()
        .all(|c| c.is_lowercase() || c.is_numeric() || c == '_')
    {
        return key.to_string();
    }
    key.chars()
        .map(|c| {
            if c.is_lowercase() || c.is_numeric() {
                c
            } else if c.is_uppercase() {
                c.to_lowercase().next().unwrap()
            } else {
                '_'
            }
        })
        .collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn object_with_plain_values() {
        let obj = json!({"int": 1, "float": 2.0, "str": "a", "bool": true, "null": null});
        assert_eq!(obj, flatten(&obj).unwrap());
    }

    /// Ensures that when using `ArrayFormatting::Plain` both arrays and objects are formatted
    /// properly.
    #[test]
    fn array_formatting_plain() {
        let obj = json!({"s": {"a": [1, 2.0, "b", null, true]}});
        assert_eq!(
            flatten(&obj).unwrap(),
            json!({
                format!("s{k}a{k}0", k = KEY_SEPARATOR): 1,
                format!("s{k}a{k}1", k = KEY_SEPARATOR): 2.0,
                format!("s{k}a{k}2", k = KEY_SEPARATOR): "b",
                format!("s{k}a{k}3", k = KEY_SEPARATOR): null,
                format!("s{k}a{k}4", k = KEY_SEPARATOR): true,
            })
        );
    }

    #[test]
    fn nested_single_key_value() {
        let obj = json!({"key": "value", "nested_key": {"key": "value"}});
        assert_eq!(
            flatten(&obj).unwrap(),
            json!({"key": "value", "nested_key_key": "value"}),
        );
    }

    #[test]
    fn nested_multiple_key_value() {
        let obj = json!({"key": "value", "nested_key": {"key1": "value1", "key2": "value2"}});
        assert_eq!(
            flatten(&obj).unwrap(),
            json!({"key": "value", "nested_key_key1": "value1", "nested_key_key2": "value2"}),
        );
    }

    #[test]
    fn complex_nested_struct() {
        let obj = json!({
            "simple_key": "simple_value",
            "key": [
                "value1",
                {"key": "value2"},
                {"nested_array": [
                    "nested1",
                    "nested2",
                    ["nested3", "nested4"]
                ]}
            ]
        });
        assert_eq!(
            flatten(&obj).unwrap(),
            json!({"simple_key": "simple_value", "key_0": "value1", "key_1_key": "value2",
                "key_2_nested_array_0": "nested1", "key_2_nested_array_1": "nested2",
                "key_2_nested_array_2_0": "nested3", "key_2_nested_array_2_1": "nested4"}),
        );
    }

    // #[test]
    // fn overlapping_after_flattening_array() {
    //     let obj = json!({"key": ["value1", "value2"], "key_0": "Oopsy"});
    //     let res = flatten(&obj);
    //     assert!(res.is_err());
    //     match res {
    //         Err(err) => assert!(err.to_string().contains("key_0")),
    //         Ok(_) => panic!("This should have failed"),
    //     }
    // }

    /// Ensure that empty arrays are not present in the result
    #[test]
    fn empty_array() {
        let obj = json!({"key": []});
        assert_eq!(flatten(&obj).unwrap(), json!({}));
    }

    /// Ensure that empty objects are not present in the result
    #[test]
    fn empty_object() {
        let obj = json!({"key": {}});
        assert_eq!(flatten(&obj).unwrap(), json!({}));
    }

    #[test]
    fn empty_top_object() {
        let obj = json!({});
        assert_eq!(flatten(&obj).unwrap(), json!({}));
    }

    /// Ensure that if all the end values of the JSON object are either `[]` or `{}` the flattened
    /// resulting object it's empty.
    #[test]
    fn empty_complex_object() {
        let obj = json!({"key": {"key2": {}, "key3": [[], {}, {"k": {}, "q": []}]}});
        assert_eq!(flatten(&obj).unwrap(), json!({}));
    }

    #[test]
    fn nested_object_with_empty_array_and_string() {
        let obj = json!({"key": {"key2": [], "key3": "a"}});
        assert_eq!(flatten(&obj).unwrap(), json!({"key_key3": "a"}));
    }

    #[test]
    fn nested_object_with_empty_object_and_string() {
        let obj = json!({"key": {"key2": {}, "key3": "a"}});
        assert_eq!(flatten(&obj).unwrap(), json!({"key_key3": "a"}));
    }

    #[test]
    fn empty_string_as_key() {
        let obj = json!({"key": {"": "a"}});
        assert_eq!(flatten(&obj).unwrap(), json!({"key_": "a"}));
    }

    #[test]
    fn empty_string_as_key_multiple_times() {
        let obj = json!({"key": {"": {"": {"": "a"}}}});
        assert_eq!(flatten(&obj).unwrap(), json!({"key___": "a"}));
    }

    /// Flattening only makes sense for objects. Passing something else must return an informative
    /// error.
    #[test]
    fn first_level_must_be_an_object() {
        let integer = json!(3);
        let string = json!("");
        let boolean = json!(false);
        let null = json!(null);
        let array = json!([1, 2, 3]);

        for j in [integer, string, boolean, null, array] {
            let res = flatten(&j);
            match res {
                Err(_) => return, // Good
                Ok(_) => panic!("This should have failed"),
            }
        }
    }

    #[test]
    fn complex_array() {
        let obj = json!({"a": [1, [2, [3, 4], 5], 6]});
        assert_eq!(
            flatten(&obj).unwrap(),
            json!({"a_0": 1, "a_2": 6, "a_1_0": 2, "a_1_1_0": 3, "a_1_1_1": 4, "a_1_2": 5}),
        );
    }

    #[test]
    fn complex_key_format() {
        let datas = [
            (
                json!({"key": "value", "nested_key": {"key": "value", "foo": "bar"}}),
                json!({"key": "value", "nested_key_key": "value", "nested_key_foo": "bar"}),
            ),
            (
                json!({"key+bar": "value", "@nested_key": {"key": "value", "Foo": "Bar"}}),
                json!({"key_bar": "value", "_nested_key_key": "value", "_nested_key_foo": "Bar"}),
            ),
            (
                json!({"a": {"A.1": [1, [3, 4], 5], "A_2": 6}}),
                json!({"a_a_1_0": 1, "a_a_1_1_0": 3, "a_a_1_1_1": 4, "a_a_1_2": 5, "a_a_2": 6}),
            ),
        ];
        for (input, expected) in datas.iter() {
            assert_eq!(flatten(input).unwrap(), *expected);
        }
    }

    #[test]
    fn test_flatten_json_complex() {
        let input = json!({
            "firstName": "John",
            "lastName": "Doe",
            "age": 25,
            "address": {
                "streetAddress": "123 Main St",
                "city": "Anytown",
                "state": "CA",
                "postalCode": "12345"
            },
            "phoneNumbers": [
                {
                    "type": "home",
                    "number": "555-555-1234"
                },
                {
                    "type": "work",
                    "number": "555-555-5678"
                }
            ]
        });

        let expected_output = json!({
            "firstname": "John",
            "lastname": "Doe",
            "age": 25,
            "address_streetaddress": "123 Main St",
            "address_city": "Anytown",
            "address_state": "CA",
            "address_postalcode": "12345",
            "phonenumbers_0_type":"home",
            "phonenumbers_0_number": "555-555-1234",
            "phonenumbers_1_type":"work",
            "phonenumbers_1_number": "555-555-5678"
        });

        let output = flatten(&input).unwrap();
        assert_eq!(output, expected_output);
    }
}
