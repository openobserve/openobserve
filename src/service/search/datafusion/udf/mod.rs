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

use config::{meta::function::ZoFunction, utils::json};

pub(crate) mod arr_descending_udf;
pub(crate) mod arrcount_udf;
pub(crate) mod arrindex_udf;
pub(crate) mod arrjoin_udf;
pub(crate) mod arrsort_udf;
pub(crate) mod arrzip_udf;
pub(crate) mod cast_to_arr_udf;
pub(crate) mod cast_to_timestamp_udf;
#[cfg(feature = "enterprise")]
pub(crate) mod cipher_udf;
pub(crate) mod date_format_udf;
pub(crate) mod fuzzy_match_udf;
pub(crate) mod histogram_udf;
pub(crate) mod match_all_hash_udf;
pub(crate) mod match_all_udf;
pub(crate) mod regexp_matches_udf;
pub(crate) mod regexp_udf;
pub(crate) mod spath_udf;
pub(crate) mod str_match_udf;
pub(crate) mod string_to_array_v2_udf;
pub(crate) mod time_range_udf;
pub(crate) mod to_arr_string_udf;
pub(crate) mod transform_udf;

/// The name of the str_match UDF given to DataFusion.
pub(crate) const STR_MATCH_UDF_NAME: &str = "str_match";
/// The name of the str_match_ignore_case UDF given to DataFusion.
pub(crate) const STR_MATCH_UDF_IGNORE_CASE_NAME: &str = "str_match_ignore_case";
/// The name of the match_field UDF given to DataFusion.
pub(crate) const MATCH_FIELD_UDF_NAME: &str = "match_field";
/// The name of the match_field_ignore_case UDF given to DataFusion.
pub(crate) const MATCH_FIELD_IGNORE_CASE_UDF_NAME: &str = "match_field_ignore_case";
/// The name of the fuzzy_match UDF given to DataFusion.
pub(crate) const FUZZY_MATCH_UDF_NAME: &str = "fuzzy_match";
/// The name of the regex_match UDF given to DataFusion.
pub(crate) const REGEX_MATCH_UDF_NAME: &str = "re_match";
/// The name of the not_regex_match UDF given to DataFusion.
pub(crate) const REGEX_NOT_MATCH_UDF_NAME: &str = "re_not_match";
/// The name of the regex_matches UDF given to DataFusion.
pub(crate) const REGEX_MATCHES_UDF_NAME: &str = "re_matches";

pub(crate) const DEFAULT_FUNCTIONS: [ZoFunction; 11] = [
    ZoFunction {
        name: "match_all",
        text: "match_all('v')",
    },
    ZoFunction {
        name: "fuzzy_match_all",
        text: "fuzzy_match_all('v', 1)",
    },
    ZoFunction {
        name: STR_MATCH_UDF_NAME,
        text: "str_match(field, 'v')",
    },
    ZoFunction {
        name: STR_MATCH_UDF_IGNORE_CASE_NAME,
        text: "str_match_ignore_case(field, 'v')",
    },
    ZoFunction {
        name: MATCH_FIELD_UDF_NAME,
        text: "match_field(field, 'v')",
    },
    ZoFunction {
        name: MATCH_FIELD_IGNORE_CASE_UDF_NAME,
        text: "match_field_ignore_case(field, 'v')",
    },
    ZoFunction {
        name: FUZZY_MATCH_UDF_NAME,
        text: "fuzzy_match(field, 'v', 1)",
    },
    ZoFunction {
        name: REGEX_MATCH_UDF_NAME,
        text: "re_match(field, 'pattern')",
    },
    ZoFunction {
        name: REGEX_NOT_MATCH_UDF_NAME,
        text: "re_not_match(field, 'pattern')",
    },
    ZoFunction {
        name: REGEX_MATCHES_UDF_NAME,
        text: "re_matches(field, 'pattern')",
    },
    ZoFunction {
        name: cast_to_timestamp_udf::CAST_TO_TIMESTAMP_UDF_NAME,
        text: "cast_to_timestamp('pattern')",
    },
];

pub fn stringify_json_value(field: &json::Value) -> String {
    match field {
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => match n.as_f64() {
            Some(f) => f.to_string(),
            None => n.as_i64().unwrap().to_string(),
        },
        serde_json::Value::String(s) => s.clone(),
        _ => json::to_string(field).expect("failed to stringify json field"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stringify_bool_true() {
        assert_eq!(stringify_json_value(&serde_json::Value::Bool(true)), "true");
    }

    #[test]
    fn test_stringify_bool_false() {
        assert_eq!(
            stringify_json_value(&serde_json::Value::Bool(false)),
            "false"
        );
    }

    #[test]
    fn test_stringify_integer() {
        let val = serde_json::Value::Number(42i64.into());
        assert_eq!(stringify_json_value(&val), "42");
    }

    #[test]
    fn test_stringify_string() {
        let val = serde_json::Value::String("hello world".to_string());
        assert_eq!(stringify_json_value(&val), "hello world");
    }

    #[test]
    fn test_stringify_null_produces_json_null() {
        let s = stringify_json_value(&serde_json::Value::Null);
        assert_eq!(s, "null");
    }

    #[test]
    fn test_stringify_float() {
        let val = serde_json::Value::Number(serde_json::Number::from_f64(1.5).unwrap());
        assert_eq!(stringify_json_value(&val), "1.5");
    }

    #[test]
    fn test_stringify_empty_string() {
        let val = serde_json::Value::String(String::new());
        assert_eq!(stringify_json_value(&val), "");
    }

    #[test]
    fn test_stringify_array_produces_json() {
        let val = serde_json::json!([1, 2, 3]);
        let s = stringify_json_value(&val);
        assert!(s.contains('1') && s.contains('2') && s.contains('3'));
    }
}
