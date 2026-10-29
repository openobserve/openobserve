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

//! In-memory semantics and save-time checks of the extended condition operators.

use std::{borrow::Cow, sync::LazyLock};

use dashmap::DashMap;
use regex::{Regex, RegexBuilder};

use super::Operator;
use crate::utils::json::Value;

pub const MAX_REGEX_PATTERN_LEN: usize = 1024;
pub const MAX_IN_LIST_VALUES: usize = 1000;
const REGEX_CACHE_CAPACITY: usize = 1024;
const REGEX_SIZE_LIMIT: usize = 256 * 1024;

// Indexed by case-insensitivity; invalid patterns are cached as None so a bad saved regex is
// not recompiled per record.
static REGEX_CACHE: LazyLock<[DashMap<String, Option<Regex>>; 2]> =
    LazyLock::new(|| [DashMap::new(), DashMap::new()]);

/// Whether `text` matches `pattern`, compiled once per pattern; `None` when it does not compile.
pub fn regex_is_match(pattern: &str, case_insensitive: bool, text: &str) -> Option<bool> {
    let cache = &REGEX_CACHE[usize::from(case_insensitive)];
    if let Some(entry) = cache.get(pattern) {
        return entry.as_ref().map(|re| re.is_match(text));
    }
    let compiled = compile_regex(pattern, case_insensitive).ok();
    let result = compiled.as_ref().map(|re| re.is_match(text));
    // Clearing is cheap and rare; it only bounds memory when many distinct patterns appear.
    if cache.len() >= REGEX_CACHE_CAPACITY {
        cache.clear();
    }
    cache.insert(pattern.to_string(), compiled);
    result
}

/// Items of an `in`/`not_in` value: a JSON array, or a single scalar as a one-item list.
pub fn list_values(value: &Value) -> &[Value] {
    match value {
        Value::Array(items) => items.as_slice(),
        other => std::slice::from_ref(other),
    }
}

/// Result of an extended operator on a present field value; `None` for any other operator.
pub fn evaluate_extended(
    operator: &Operator,
    field_value: &Value,
    condition_value: &Value,
    case_insensitive: bool,
) -> Option<bool> {
    let result = match operator {
        Operator::In => {
            value_in_list(field_value, condition_value, case_insensitive).unwrap_or(false)
        }
        Operator::NotIn => value_in_list(field_value, condition_value, case_insensitive)
            .is_some_and(|found| !found),
        Operator::StartsWith | Operator::EndsWith => {
            let (Value::String(field), Some(needle)) = (field_value, scalar_text(condition_value))
            else {
                return Some(false);
            };
            match (operator, case_insensitive) {
                (Operator::StartsWith, false) => field.starts_with(needle.as_ref()),
                (Operator::StartsWith, true) => starts_with_ci(field, &needle),
                (_, false) => field.ends_with(needle.as_ref()),
                (_, true) => ends_with_ci(field, &needle),
            }
        }
        Operator::ReMatch | Operator::ReNotMatch => {
            let (Value::String(field), Some(pattern)) = (field_value, condition_value.as_str())
            else {
                return Some(false);
            };
            let Some(matched) = regex_is_match(pattern, case_insensitive, field) else {
                return Some(false);
            };
            matched == matches!(operator, Operator::ReMatch)
        }
        _ => return None,
    };
    Some(result)
}

/// Save-time check of one condition, regexes compiled exactly as evaluation compiles them.
pub fn validate_condition_value(
    column: &str,
    operator: &Operator,
    value: &Value,
    case_insensitive: bool,
) -> Result<(), String> {
    match operator {
        Operator::In | Operator::NotIn => {
            let values = list_values(value);
            if values.is_empty() || values.len() > MAX_IN_LIST_VALUES {
                return Err(format!(
                    "Condition on '{column}': operator '{operator}' needs 1 to {MAX_IN_LIST_VALUES} values, got {}",
                    values.len()
                ));
            }
            if values
                .iter()
                .any(|v| !(v.is_string() || v.is_number() || v.is_boolean()))
            {
                return Err(format!(
                    "Condition on '{column}': operator '{operator}' values must be strings, numbers or booleans"
                ));
            }
            Ok(())
        }
        Operator::ReMatch | Operator::ReNotMatch => {
            let Some(pattern) = value.as_str() else {
                return Err(format!(
                    "Condition on '{column}': operator '{operator}' needs a string pattern"
                ));
            };
            if pattern.len() > MAX_REGEX_PATTERN_LEN {
                return Err(format!(
                    "Condition on '{column}': regex is longer than {MAX_REGEX_PATTERN_LEN} characters"
                ));
            }
            compile_regex(pattern, case_insensitive)
                .map(|_| ())
                .map_err(|e| format!("Condition on '{column}': invalid regex: {e}"))
        }
        _ => Ok(()),
    }
}

/// Case-insensitive string equality without allocating.
pub fn eq_ci(a: &str, b: &str) -> bool {
    if a.is_ascii() && b.is_ascii() {
        return a.eq_ignore_ascii_case(b);
    }
    a.chars()
        .flat_map(char::to_lowercase)
        .eq(b.chars().flat_map(char::to_lowercase))
}

fn compile_regex(pattern: &str, case_insensitive: bool) -> Result<Regex, regex::Error> {
    RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .size_limit(REGEX_SIZE_LIMIT)
        .build()
}

/// `None` when the field type cannot be compared with list items (null, array, object).
fn value_in_list(
    field_value: &Value,
    condition_value: &Value,
    case_insensitive: bool,
) -> Option<bool> {
    let items = list_values(condition_value);
    let found = match field_value {
        Value::String(field) => items.iter().any(|item| {
            scalar_text(item).is_some_and(|item| {
                if case_insensitive {
                    eq_ci(field, &item)
                } else {
                    field == item.as_ref()
                }
            })
        }),
        Value::Number(_) => {
            let field = field_value.as_f64()?;
            items.iter().any(|v| match v {
                Value::Number(n) => n.as_f64() == Some(field),
                Value::String(s) => s.trim().parse::<f64>().ok() == Some(field),
                _ => false,
            })
        }
        Value::Bool(field) => items.iter().any(|v| match v {
            Value::Bool(b) => b == field,
            Value::String(s) => s.parse::<bool>().ok() == Some(*field),
            _ => false,
        }),
        _ => return None,
    };
    Some(found)
}

/// Text of a scalar, borrowed for strings and numbers (stored as text under arbitrary_precision).
fn scalar_text(value: &Value) -> Option<Cow<'_, str>> {
    match value {
        Value::String(s) => Some(Cow::Borrowed(s.as_str())),
        Value::Number(n) => Some(Cow::Borrowed(n.as_str())),
        Value::Bool(true) => Some(Cow::Borrowed("true")),
        Value::Bool(false) => Some(Cow::Borrowed("false")),
        _ => None,
    }
}

fn starts_with_ci(field: &str, needle: &str) -> bool {
    let mut field = field.chars().flat_map(char::to_lowercase);
    needle
        .chars()
        .flat_map(char::to_lowercase)
        .all(|c| field.next() == Some(c))
}

fn ends_with_ci(field: &str, needle: &str) -> bool {
    let mut field = field.chars().rev().flat_map(char::to_lowercase);
    needle
        .chars()
        .rev()
        .flat_map(char::to_lowercase)
        .all(|c| field.next() == Some(c))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn eval(op: Operator, field: Value, cond: Value, ic: bool) -> bool {
        evaluate_extended(&op, &field, &cond, ic).expect("extended operator")
    }

    #[test]
    fn test_old_operators_are_not_extended() {
        for op in [
            Operator::EqualTo,
            Operator::NotEqualTo,
            Operator::Contains,
            Operator::NotContains,
            Operator::IsNull,
            Operator::IsEmpty,
        ] {
            assert!(evaluate_extended(&op, &json!("a"), &json!("a"), false).is_none());
            assert!(validate_condition_value("c", &op, &json!([]), false).is_ok());
        }
    }

    #[test]
    fn test_in_and_not_in_on_strings() {
        let list = json!(["error", "warn", 500]);
        assert!(eval(Operator::In, json!("warn"), list.clone(), false));
        assert!(eval(Operator::In, json!("500"), list.clone(), false));
        assert!(!eval(Operator::In, json!("WARN"), list.clone(), false));
        assert!(eval(Operator::In, json!("WARN"), list.clone(), true));
        assert!(eval(Operator::NotIn, json!("info"), list.clone(), false));
        assert!(!eval(Operator::NotIn, json!("Error"), list, true));
    }

    #[test]
    fn test_in_accepts_a_single_scalar() {
        assert!(eval(Operator::In, json!("a"), json!("a"), false));
        assert!(!eval(Operator::NotIn, json!("a"), json!("a"), false));
        assert!(eval(Operator::In, json!(5), json!(5), false));
    }

    #[test]
    fn test_in_is_numeric_aware() {
        assert!(eval(Operator::In, json!(404), json!(["404", 500]), false));
        assert!(eval(Operator::In, json!(500.0), json!([500]), false));
        assert!(!eval(Operator::In, json!(200), json!(["404", "x"]), false));
        assert!(eval(
            Operator::NotIn,
            json!(200),
            json!(["404", 500]),
            false
        ));
    }

    #[test]
    fn test_in_on_booleans() {
        assert!(eval(Operator::In, json!(true), json!([true]), false));
        assert!(eval(Operator::In, json!(false), json!(["false"]), false));
        assert!(eval(Operator::NotIn, json!(false), json!([true]), false));
    }

    #[test]
    fn test_in_and_not_in_are_false_on_uncomparable_fields() {
        for field in [json!(null), json!([1]), json!({"a": 1})] {
            assert!(!eval(Operator::In, field.clone(), json!([1]), false));
            assert!(!eval(Operator::NotIn, field, json!([1]), false));
        }
    }

    #[test]
    fn test_starts_and_ends_with() {
        assert!(eval(
            Operator::StartsWith,
            json!("api-gw"),
            json!("api"),
            false
        ));
        assert!(!eval(
            Operator::StartsWith,
            json!("API-gw"),
            json!("api"),
            false
        ));
        assert!(eval(
            Operator::StartsWith,
            json!("API-gw"),
            json!("api"),
            true
        ));
        assert!(eval(
            Operator::EndsWith,
            json!("api-gw"),
            json!("-gw"),
            false
        ));
        assert!(eval(
            Operator::EndsWith,
            json!("api-GW"),
            json!("-gw"),
            true
        ));
        assert!(!eval(Operator::EndsWith, json!(12), json!("2"), false));
    }

    #[test]
    fn test_regex_match_and_not_match() {
        assert!(eval(
            Operator::ReMatch,
            json!("GET /api/v1"),
            json!("^GET /api"),
            false
        ));
        assert!(!eval(
            Operator::ReMatch,
            json!("get /api"),
            json!("^GET"),
            false
        ));
        assert!(eval(
            Operator::ReMatch,
            json!("get /api"),
            json!("^GET"),
            true
        ));
        assert!(eval(
            Operator::ReNotMatch,
            json!("POST"),
            json!("^GET"),
            false
        ));
        assert!(!eval(
            Operator::ReNotMatch,
            json!("get"),
            json!("^GET"),
            true
        ));
    }

    #[test]
    fn test_invalid_regex_never_matches() {
        assert!(!eval(Operator::ReMatch, json!("a("), json!("a("), false));
        assert!(!eval(Operator::ReNotMatch, json!("a("), json!("a("), false));
    }

    #[test]
    fn test_regex_cache_keys_on_case_insensitivity() {
        assert_eq!(
            regex_is_match("^cache-test-[0-9]+$", false, "CACHE-TEST-1"),
            Some(false)
        );
        assert_eq!(
            regex_is_match("^cache-test-[0-9]+$", true, "CACHE-TEST-1"),
            Some(true)
        );
        assert_eq!(
            regex_is_match("^cache-test-[0-9]+$", false, "cache-test-2"),
            Some(true)
        );
        assert_eq!(regex_is_match("cache-test-(", false, "x"), None);
        assert!(REGEX_CACHE[0].contains_key("^cache-test-[0-9]+$"));
        assert!(REGEX_CACHE[1].contains_key("^cache-test-[0-9]+$"));
    }

    #[test]
    fn test_case_insensitive_helpers_do_not_need_ascii() {
        assert!(eq_ci("ÉCOLE", "école"));
        assert!(starts_with_ci("ÉCOLE-1", "école"));
        assert!(ends_with_ci("app.LOG", ".log"));
        assert!(!ends_with_ci("log", "a.log"));
    }

    #[test]
    fn test_validate_regex_compiles_with_the_runtime_flags() {
        let pattern = (1..400)
            .map(|n| format!("[a-z]{{{}}}", n * 10))
            .find(|p| compile_regex(p, false).is_ok() && compile_regex(p, true).is_err())
            .expect("a pattern that only the case-insensitive build exceeds");
        assert!(validate_condition_value("c", &Operator::ReMatch, &json!(pattern), false).is_ok());
        assert!(validate_condition_value("c", &Operator::ReMatch, &json!(pattern), true).is_err());
    }

    #[test]
    fn test_validate_in_list_bounds() {
        assert!(validate_condition_value("c", &Operator::In, &json!(["a"]), false).is_ok());
        assert!(validate_condition_value("c", &Operator::NotIn, &json!("a"), false).is_ok());
        assert!(validate_condition_value("c", &Operator::In, &json!([]), false).is_err());
        let too_many: Vec<i32> = (0..=MAX_IN_LIST_VALUES as i32).collect();
        assert!(validate_condition_value("c", &Operator::In, &json!(too_many), false).is_err());
        let max: Vec<i32> = (0..MAX_IN_LIST_VALUES as i32).collect();
        assert!(validate_condition_value("c", &Operator::In, &json!(max), false).is_ok());
        assert!(validate_condition_value("c", &Operator::In, &json!([["a"]]), false).is_err());
        assert!(validate_condition_value("c", &Operator::In, &json!([null]), false).is_err());
    }

    #[test]
    fn test_validate_regex() {
        assert!(validate_condition_value("c", &Operator::ReMatch, &json!("^a.*b$"), false).is_ok());
        assert!(validate_condition_value("c", &Operator::ReNotMatch, &json!("a("), false).is_err());
        assert!(validate_condition_value("c", &Operator::ReMatch, &json!(5), false).is_err());
        let long = "a".repeat(MAX_REGEX_PATTERN_LEN + 1);
        assert!(validate_condition_value("c", &Operator::ReMatch, &json!(long), false).is_err());
    }
}
