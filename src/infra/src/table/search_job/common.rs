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

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum Value {
    String(String),
    I64(i64),
}

impl Value {
    pub fn string(s: &str) -> Self {
        Self::String(s.to_string())
    }

    pub fn i64(i: i64) -> Self {
        Self::I64(i)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum OperatorType {
    Equal,
    NotEqual,    // curently not used
    GreaterThan, // curently not used
    LessThan,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_value_string_constructor() {
        let v = Value::string("hello");
        assert!(matches!(v, Value::String(s) if s == "hello"));
    }

    #[test]
    fn test_value_i64_constructor() {
        let v = Value::i64(42);
        assert!(matches!(v, Value::I64(n) if n == 42));
    }

    #[test]
    fn test_value_string_empty() {
        let v = Value::string("");
        assert!(matches!(v, Value::String(s) if s.is_empty()));
    }

    #[test]
    fn test_value_i64_negative() {
        let v = Value::i64(-100);
        assert!(matches!(v, Value::I64(n) if n == -100));
    }

    #[test]
    fn test_value_roundtrip_json() {
        let v = Value::string("test");
        let json = serde_json::to_string(&v).unwrap();
        let back: Value = serde_json::from_str(&json).unwrap();
        assert!(matches!(back, Value::String(s) if s == "test"));
    }
}
