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

pub use serde_json::{
    from_slice, from_str, from_value, json, to_string, to_value, to_vec, Error, Map, Number, Value,
};

pub fn estimate_json_bytes(val: &Value) -> usize {
    let mut size = 0;
    match val {
        Value::Object(map) => {
            // {?} extra 2
            size += 2;
            for (k, v) in map {
                // "key":?, extra 4 bytes
                size += k.len() + estimate_json_bytes(v) + 4;
            }
            // remove ',' for last item
            if !map.is_empty() {
                size -= 1;
            }
        }
        Value::Array(arr) => {
            // []=>2 [?]=>2 [?,?] extra 1+n
            size += std::cmp::max(arr.len(), 1) + 1;
            for v in arr {
                size += estimate_json_bytes(v);
            }
        }
        Value::String(s) => {
            // "?"=>2
            size += s.len() + 2;
        }
        Value::Number(n) => {
            size += n.to_string().len();
        }
        Value::Bool(b) => {
            // true for 4 bytes, false for 5 bytes
            size += if *b { 4 } else { 5 };
        }
        Value::Null => {
            size += 4;
        }
    }
    size
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_json_bytes() {
        let json = r#"{"a":null,"b":true,"c":false,"d":{"a":"b","c":true,"d":false,"e":123456},"e":[""],"f":["a"],"g":["a","b"],"h":"bcdef","i":{},"j":{"ok":"yes"}}"#;
        let val: Value = from_str(json).unwrap();
        assert_eq!(estimate_json_bytes(&val), json.len());
    }

}
