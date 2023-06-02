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

use flatten_json_object::{ArrayFormatting, Flattener};
pub use serde_json::{from_value, json, to_value, Error, Map, Value};

#[inline(always)]
#[cfg(target_arch = "x86_64")]
pub fn to_string<T>(value: &T) -> Result<String, simd_json::Error>
where
    T: ?Sized + serde::Serialize,
{
    simd_json::to_string(value)
}

#[inline(always)]
#[cfg(target_arch = "x86_64")]
pub fn to_vec<T>(value: &T) -> Result<Vec<u8>, simd_json::Error>
where
    T: ?Sized + serde::Serialize,
{
    simd_json::to_vec(value)
}

#[inline(always)]
#[cfg(target_arch = "x86_64")]
pub fn from_str<'a, T>(s: &'a str) -> Result<T, serde_json::Error>
where
    T: serde::Deserialize<'a>,
{
    from_slice(s.as_bytes())
}

#[inline(always)]
#[cfg(target_arch = "x86_64")]
pub fn from_slice<'a, T>(v: &'a [u8]) -> Result<T, serde_json::Error>
where
    T: serde::Deserialize<'a>,
{
    serde_json::from_slice(v)
}

#[inline(always)]
#[cfg(not(target_arch = "x86_64"))]
pub fn to_string<T>(value: &T) -> Result<String, serde_json::Error>
where
    T: ?Sized + serde::Serialize,
{
    serde_json::to_string(value)
}

#[inline(always)]
#[cfg(not(target_arch = "x86_64"))]
pub fn to_vec<T>(value: &T) -> Result<Vec<u8>, serde_json::Error>
where
    T: ?Sized + serde::Serialize,
{
    serde_json::to_vec(value)
}

#[inline(always)]
#[cfg(not(target_arch = "x86_64"))]
pub fn from_str<'a, T>(s: &'a str) -> Result<T, serde_json::Error>
where
    T: serde::Deserialize<'a>,
{
    from_slice(s.as_bytes())
}

#[inline(always)]
#[cfg(not(target_arch = "x86_64"))]
pub fn from_slice<'a, T>(v: &'a [u8]) -> Result<T, serde_json::Error>
where
    T: serde::Deserialize<'a>,
{
    serde_json::from_slice(v)
}

#[inline(always)]
pub fn flatten_json_and_format_field(obj: &Value) -> Value {
    let obj = flatten_json(obj);
    if !obj.is_object() {
        return obj;
    }

    let map = obj
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, value)| {
            let key = key
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() {
                        c.to_lowercase().next().unwrap()
                    } else {
                        '_'
                    }
                })
                .collect::<String>();
            (key, value.to_owned())
        })
        .collect();

    Value::Object(map)
}

#[inline(always)]
pub fn flatten_json(obj: &Value) -> Value {
    Flattener::new()
        .set_key_separator("_")
        .set_array_formatting(ArrayFormatting::Surrounded {
            start: "[".to_string(),
            end: "]".to_string(),
        })
        .set_preserve_empty_arrays(false)
        .set_preserve_empty_objects(false)
        .flatten(obj)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_flatten_json() {
        let datas = [
            (
                json!({"key": "value", "nested_key": {"key": "value", "foo": "bar"}}),
                json!({"key": "value", "nested_key_key": "value", "nested_key_foo": "bar"}),
            ),
            (
                json!({"key+bar": "value", "@nested_key": {"key": "value", "Foo": "Bar"}}),
                json!({"key_bar": "value", "_nested_key_key": "value", "_nested_key_foo": "Bar"}),
            ),
        ];
        for (input, expected) in datas.iter() {
            assert_eq!(flatten_json_and_format_field(input), *expected);
        }
    }
}
