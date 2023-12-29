// Copyright 2023 Zinc Labs Inc.
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

use serde_json::value::{Map, Value};

const KEY_SEPARATOR: &str = "_";
const FORMAT_KEY_ENABLED: bool = true;

/// Flattens the provided JSON object (`current`).
///
/// It will return an error if flattening the object would make two keys to be
/// the same, overwriting a value. It will alre return an error if the JSON
/// value passed it's not an object.
///
/// # Errors
/// Will return `Err` if `to_flatten` it's not an object, or if flattening the
/// object would result in two or more keys colliding.
pub fn flatten(to_flatten: Value) -> Result<Value, anyhow::Error> {
    // quick check to see if we have an object`
    match &to_flatten {
        Value::Object(v) => {
            if v.is_empty() || !v.iter().any(|(_k, v)| v.is_object() || v.is_array()) {
                return Ok(to_flatten);
            }
        }
        _ => {
            return Err(anyhow::anyhow!("flatten value must be an object"));
        }
    };

    let mut flat = Map::<String, Value>::new();
    flatten_value(to_flatten, "".to_owned(), 0, &mut flat).map(|_x| Value::Object(flat))
}

/// Flattens the passed JSON value (`current`), whose path is `parent_key` and
/// its 0-based depth is `depth`.  The result is stored in the JSON object
/// `flattened`.
fn flatten_value(
    current: Value,
    parent_key: String,
    depth: u32,
    flattened: &mut Map<String, Value>,
) -> Result<(), anyhow::Error> {
    match current {
        Value::Object(map) => {
            flatten_object(map, &parent_key, depth, flattened)?;
        }
        Value::Array(arr) => {
            flatten_array(arr, &parent_key, depth, flattened)?;
        }
        _ => {
            flattened.insert(parent_key, current);
        }
    }
    Ok(())
}

/// Flattens the passed object (`current`), whose path is `parent_key` and its
/// 0-based depth is `depth`.  The result is stored in the JSON object
/// `flattened`.
fn flatten_object(
    current: Map<String, Value>,
    parent_key: &str,
    depth: u32,
    flattened: &mut Map<String, Value>,
) -> Result<(), anyhow::Error> {
    for (mut k, v) in current.into_iter() {
        if FORMAT_KEY_ENABLED {
            format_key(&mut k)
        }
        let parent_key = if depth > 0 {
            format!("{}{}{}", parent_key, KEY_SEPARATOR, k)
        } else {
            k
        };
        flatten_value(v, parent_key, depth + 1, flattened)?;
    }
    Ok(())
}

/// Flattens the passed array (`current`), whose path is `parent_key` and its
/// 0-based depth is `depth`.  The result is stored in the JSON object
/// `flattened`.
fn flatten_array(
    current: Vec<Value>,
    parent_key: &str,
    depth: u32,
    flattened: &mut Map<String, Value>,
) -> Result<(), anyhow::Error> {
    if current.is_empty() {
        return Ok(());
    }
    // for (i, obj) in current.iter().enumerate() {
    //     let parent_key = format!("{}{}{}", parent_key, KEY_SEPARATOR, i);
    //     flatten_value(obj, parent_key, depth + 1, flattened)?;
    // }
    let v = Value::String(Value::Array(current.to_vec()).to_string());
    flatten_value(v, parent_key.to_string(), depth, flattened)?;
    Ok(())
}

/// We need every character in the key to be lowercase alphanumeric or
/// underscore
pub fn format_key(key: &mut String) {
    if key
        .chars()
        .all(|c| c.is_lowercase() || c.is_numeric() || c == '_')
    {
        return;
    }
    let mut key_chars = key.chars().collect::<Vec<_>>();
    for c in key_chars.iter_mut() {
        if c.is_lowercase() || c.is_numeric() {
            continue;
        } else if c.is_uppercase() {
            *c = c.to_lowercase().next().unwrap();
        } else {
            *c = '_';
        }
    }
    *key = key_chars.into_iter().collect::<String>();
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn object_with_plain_values() {
        let obj = json!({"int": 1, "float": 2.0, "str": "a", "bool": true, "null": null});
        assert_eq!(obj, flatten(obj.clone()).unwrap());
    }

    /// Ensures that when using `ArrayFormatting::Plain` both arrays and objects
    /// are formatted properly.
    #[test]
    fn array_formatting_plain() {
        let obj = json!({"s": {"a": [1, 2.0, "b", null, true]}});
        assert_eq!(
            flatten(obj).unwrap(),
            json!({
                format!("s{k}a", k = KEY_SEPARATOR): "[1,2.0,\"b\",null,true]",
            })
        );
    }

    #[test]
    fn nested_single_key_value() {
        let obj = json!({"key": "value", "nested_key": {"key": "value"}});
        assert_eq!(
            flatten(obj).unwrap(),
            json!({"key": "value", "nested_key_key": "value"}),
        );
    }

    #[test]
    fn nested_multiple_key_value() {
        let obj = json!({"key": "value", "nested_key": {"key1": "value1", "key2": "value2"}});
        assert_eq!(
            flatten(obj).unwrap(),
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
            flatten(obj).unwrap(),
            json!({"simple_key": "simple_value", "key": "[\"value1\",{\"key\":\"value2\"},{\"nested_array\":[\"nested1\",\"nested2\",[\"nested3\",\"nested4\"]]}]"}),
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
        assert_eq!(flatten(obj).unwrap(), json!({}));
    }

    /// Ensure that empty objects are not present in the result
    #[test]
    fn empty_object() {
        let obj = json!({"key": {}});
        assert_eq!(flatten(obj).unwrap(), json!({}));
    }

    #[test]
    fn empty_top_object() {
        let obj = json!({});
        assert_eq!(flatten(obj).unwrap(), json!({}));
    }

    /// Ensure that if all the end values of the JSON object are either `[]` or
    /// `{}` the flattened resulting object it's empty.
    #[test]
    fn empty_complex_object() {
        let obj = json!({"key": {"key2": {}, "key3": [[], {}, {"k": {}, "q": []}]}});
        assert_eq!(
            flatten(obj).unwrap(),
            json!({"key_key3": "[[],{},{\"k\":{},\"q\":[]}]"})
        );
    }

    #[test]
    fn nested_object_with_empty_array_and_string() {
        let obj = json!({"key": {"key2": [], "key3": "a"}});
        assert_eq!(flatten(obj).unwrap(), json!({"key_key3": "a"}));
    }

    #[test]
    fn nested_object_with_empty_object_and_string() {
        let obj = json!({"key": {"key2": {}, "key3": "a"}});
        assert_eq!(flatten(obj).unwrap(), json!({"key_key3": "a"}));
    }

    #[test]
    fn empty_string_as_key() {
        let obj = json!({"key": {"": "a"}});
        assert_eq!(flatten(obj).unwrap(), json!({"key_": "a"}));
    }

    #[test]
    fn empty_string_as_key_multiple_times() {
        let obj = json!({"key": {"": {"": {"": "a"}}}});
        assert_eq!(flatten(obj).unwrap(), json!({"key___": "a"}));
    }

    /// Flattening only makes sense for objects. Passing something else must
    /// return an informative error.
    #[test]
    fn first_level_must_be_an_object() {
        let integer = json!(3);
        let string = json!("");
        let boolean = json!(false);
        let null = json!(null);
        let array = json!([1, 2, 3]);

        for j in [integer, string, boolean, null, array].into_iter() {
            let res = flatten(j);
            match res {
                Err(_) => {} // Good
                Ok(_) => panic!("This should have failed"),
            }
        }
    }

    #[test]
    fn complex_array() {
        let obj = json!({"a": [1, [2, [3, 4], 5], 6]});
        assert_eq!(flatten(obj).unwrap(), json!({"a": "[1,[2,[3,4],5],6]"}));
    }

    #[test]
    fn complex_key_format() {
        let datas = [
            (
                json!({"key": "value", "nested_key": {"key": "value", "foo": "bar"}}),
                json!({"key": "value", "nested_key_key": "value", "nested_key_foo": "bar"}),
            ),
            (
                json!({"key+bar": "value", "@nested_key": {"#key": "value", "&Foo": "Bar"}}),
                json!({"key_bar": "value", "_nested_key__key": "value", "_nested_key__foo": "Bar"}),
            ),
            (
                json!({"a": {"A.1": [1, [3, 4], 5], "A_2": 6}}),
                json!({"a_a_1": "[1,[3,4],5]", "a_a_2": 6}),
            ),
        ];
        for (input, expected) in datas.into_iter() {
            assert_eq!(flatten(input).unwrap(), expected);
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
            "phonenumbers":"[{\"number\":\"555-555-1234\",\"type\":\"home\"},{\"number\":\"555-555-5678\",\"type\":\"work\"}]"
        });

        let output = flatten(input).unwrap();
        assert_eq!(output, expected_output);
    }
}
