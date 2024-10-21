// Copyright 2024 OpenObserve Inc.
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

use crate::common::meta::functions::ZoFunction;

pub(crate) mod arr_descending_udf;
pub(crate) mod arrcount_udf;
pub(crate) mod arrindex_udf;
pub(crate) mod arrjoin_udf;
pub(crate) mod arrsort_udf;
pub(crate) mod arrzip_udf;
pub(crate) mod cast_to_arr_udf;
pub(crate) mod date_format_udf;
pub(crate) mod histogram_udf;
pub(crate) mod match_all_udf;
pub(crate) mod match_udf;
pub(crate) mod regexp_udf;
pub(crate) mod spath_udf;
pub(crate) mod string_to_array_v2_udf;
pub(crate) mod time_range_udf;
pub(crate) mod to_arr_string_udf;
pub(crate) mod transform_udf;

/// The name of the match UDF given to DataFusion.
pub(crate) const MATCH_UDF_NAME: &str = "str_match";
/// The name of the match_ignore_case UDF given to DataFusion.
pub(crate) const MATCH_UDF_IGNORE_CASE_NAME: &str = "str_match_ignore_case";
/// The name of the regex_match UDF given to DataFusion.
pub(crate) const REGEX_MATCH_UDF_NAME: &str = "re_match";
/// The name of the not_regex_match UDF given to DataFusion.
pub(crate) const REGEX_NOT_MATCH_UDF_NAME: &str = "re_not_match";

pub(crate) const DEFAULT_FUNCTIONS: [ZoFunction; 7] = [
    ZoFunction {
        name: "match_all_raw",
        text: "match_all_raw('v')",
    },
    ZoFunction {
        name: "match_all_raw_ignore_case",
        text: "match_all_raw_ignore_case('v')",
    },
    ZoFunction {
        name: "match_all",
        text: "match_all('v')",
    },
    ZoFunction {
        name: MATCH_UDF_NAME,
        text: "str_match(field, 'v')",
    },
    ZoFunction {
        name: MATCH_UDF_IGNORE_CASE_NAME,
        text: "str_match_ignore_case(field, 'v')",
    },
    ZoFunction {
        name: REGEX_MATCH_UDF_NAME,
        text: "re_match(field, 'pattern')",
    },
    ZoFunction {
        name: REGEX_NOT_MATCH_UDF_NAME,
        text: "re_not_match(field, 'pattern')",
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
