use flatten_json_object::{ArrayFormatting, Flattener};

pub type Value = serde_json::Value;

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
pub fn flatten_json(obj: &Value) -> Value {
    Flattener::new()
        .set_key_separator(".")
        .set_array_formatting(ArrayFormatting::Surrounded {
            start: "[".to_string(),
            end: "]".to_string(),
        })
        .set_preserve_empty_arrays(false)
        .set_preserve_empty_objects(false)
        .flatten(obj)
        .unwrap()
}

pub fn unflatten_json(obj: &Value) -> Value {
    if !obj.is_object() {
        return obj.to_owned();
    }

    let mut unflattened = serde_json::Map::new();
    for (key, value) in obj.as_object().unwrap() {
        let mut current = &mut unflattened;
        let mut parts = key.split('.');
        let last = parts.next_back().unwrap();
        for part in parts {
            let old = current.get(part);
            if let Some(old) = old {
                if !old.is_object() {
                    let old = old.to_owned();
                    current.insert(part.to_string(), Value::Object(serde_json::Map::new()));
                    current = current.get_mut(part).unwrap().as_object_mut().unwrap();
                    current.insert("".to_string(), old);
                } else {
                    current = current.get_mut(part).unwrap().as_object_mut().unwrap();
                }
            } else {
                current.insert(part.to_string(), Value::Object(serde_json::Map::new()));
                current = current.get_mut(part).unwrap().as_object_mut().unwrap();
            }
        }
        current.insert(last.to_string(), value.clone());
    }
    Value::Object(unflattened)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn test_flatten_json() {
        let obj = json!({"key": "value", "nested_key": {"key": "value", "foo": "bar"}});
        assert_eq!(
            flatten_json(&obj),
            json!({"key": "value", "nested_key.key": "value", "nested_key.foo": "bar"}),
        );
    }
    #[test]
    fn test_unflatten_json1() {
        let obj = json!({"key1": "value1", "nested_key.key2": "value2", "nested_key.foo": "bar"});
        assert_eq!(
            unflatten_json(&obj),
            json!({"key1": "value1", "nested_key": {"key2": "value2", "foo": "bar"}}),
        );
    }
    #[test]
    fn test_unflatten_json2() {
        let obj =
            json!({"key1": "value1", "nested_key.key2": "value2", "nested_key.key2.foo": "bar"});
        assert_eq!(
            unflatten_json(&obj),
            json!({"key1": "value1", "nested_key": {"key2": {"":"value2", "foo": "bar"}}}),
        );
    }
}
