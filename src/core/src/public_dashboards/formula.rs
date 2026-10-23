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

//! PromQL formula letters and their substitution, ported from the live `formula.ts`.

use std::collections::BTreeMap;

use serde_json::Value;

const LETTERS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LABEL_LIST_KEYWORDS: [&str; 6] = [
    "by",
    "without",
    "on",
    "ignoring",
    "group_left",
    "group_right",
];
const QUOTES: [char; 3] = ['"', '\'', '`'];

/// A formula letter the live executor refuses to substitute.
#[derive(Debug, PartialEq, thiserror::Error)]
pub enum FormulaError {
    #[error("{0}, which is not a query in this panel")]
    Unknown(char),
    #[error("{0}, which is another formula")]
    Formula(char),
}

/// `isFormulaQuery`: any string formula, even an empty one.
pub fn is_formula(config: &Value) -> bool {
    config.get("formula").is_some_and(Value::is_string)
}

/// `queryRefs`: each query's stored ref, else the first letter no other query holds.
pub fn query_refs(configs: &[Value]) -> Vec<Option<String>> {
    let stored = |cfg: &Value| {
        cfg.get("ref")
            .and_then(Value::as_str)
            .filter(|r| !r.is_empty())
            .map(str::to_string)
    };
    let mut used: Vec<String> = configs.iter().filter_map(stored).collect();
    configs
        .iter()
        .map(|cfg| {
            if let Some(r) = stored(cfg) {
                return Some(r);
            }
            if is_formula(cfg) {
                return None;
            }
            let letter = LETTERS
                .chars()
                .map(String::from)
                .find(|l| !used.contains(l))?;
            used.push(letter.clone());
            Some(letter)
        })
        .collect()
}

/// Legend fallbacks once formulas are stripped: input letters, a formula's ref or "Formula".
pub fn viewer_legend_fallbacks(configs: &[Value]) -> Vec<Option<String>> {
    if !configs.iter().any(is_formula) {
        return vec![None; configs.len()];
    }
    let named = |cfg: &Value, key: &str| {
        cfg.get(key)
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty())
    };
    configs
        .iter()
        .zip(query_refs(configs))
        .map(|(cfg, letter)| {
            if named(cfg, "promql_legend") || named(cfg, "promql_legend_fallback") {
                None
            } else if is_formula(cfg) {
                Some(letter.unwrap_or_else(|| "Formula".to_string()))
            } else {
                letter
            }
        })
        .collect()
}

/// `substituteFormula`: each letter becomes its input's text in parentheses.
pub fn substitute(
    formula: &str,
    inputs: &BTreeMap<String, Option<String>>,
) -> Result<String, FormulaError> {
    let chars: Vec<char> = formula.chars().collect();
    let positions = letter_positions(&chars);
    for &pos in &positions {
        match inputs.get(&chars[pos].to_string()) {
            None => return Err(FormulaError::Unknown(chars[pos])),
            Some(None) => return Err(FormulaError::Formula(chars[pos])),
            Some(Some(_)) => {}
        }
    }
    let mut expr = String::new();
    let mut last = 0;
    for pos in positions {
        let text = inputs[&chars[pos].to_string()]
            .as_deref()
            .unwrap_or_default();
        expr.extend(&chars[last..pos]);
        // A trailing `#` comment in the input would otherwise swallow the closing parenthesis.
        let newline = if text.contains('#') { "\n" } else { "" };
        expr.push_str(&format!("({text}{newline})"));
        last = pos + 1;
    }
    expr.extend(&chars[last..]);
    Ok(expr)
}

fn letter_positions(text: &[char]) -> Vec<usize> {
    let mut letters = Vec::new();
    let mut i = 0;
    while i < text.len() {
        i = next_token(text, i, &mut letters);
    }
    letters
}

fn next_token(text: &[char], i: usize, letters: &mut Vec<usize>) -> usize {
    let ch = text[i];
    if QUOTES.contains(&ch) {
        return skip_string(text, i);
    }
    if ch == '{' {
        return skip_until(text, i, '}');
    }
    if ch == '#' {
        return text[i..]
            .iter()
            .position(|c| *c == '\n')
            .map_or(text.len(), |n| i + n);
    }
    if ch.is_ascii_digit() || ch == '.' {
        let mut end = i + 1;
        while end < text.len() && (text[end].is_ascii_alphanumeric() || "_.".contains(text[end])) {
            end += 1;
        }
        return end;
    }
    if is_ident_start(ch) {
        return scan_word(text, i, letters);
    }
    i + 1
}

fn is_ident_start(ch: char) -> bool {
    ch.is_ascii_alphabetic() || ch == '_' || ch == ':'
}

fn is_ident_part(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == ':'
}

fn scan_word(text: &[char], start: usize, letters: &mut Vec<usize>) -> usize {
    let mut end = start;
    while end < text.len() && is_ident_part(text[end]) {
        end += 1;
    }
    let word: String = text[start..end].iter().collect();
    if LABEL_LIST_KEYWORDS.contains(&word.to_lowercase().as_str()) {
        return skip_label_list(text, end);
    }
    if word.len() == 1 && LETTERS.contains(&word) {
        letters.push(start);
    }
    end
}

fn skip_label_list(text: &[char], word_end: usize) -> usize {
    let mut i = word_end;
    while text.get(i).is_some_and(|c| c.is_whitespace()) {
        i += 1;
    }
    if text.get(i) == Some(&'(') {
        skip_until(text, i, ')')
    } else {
        word_end
    }
}

fn skip_string(text: &[char], start: usize) -> usize {
    let quote = text[start];
    let mut i = start + 1;
    while i < text.len() && text[i] != quote {
        // Backtick strings are raw in PromQL, so only the other two have escapes.
        i += if text[i] == '\\' && quote != '`' {
            2
        } else {
            1
        };
    }
    i + 1
}

fn skip_until(text: &[char], start: usize, close: char) -> usize {
    let mut i = start + 1;
    while i < text.len() && text[i] != close {
        i = if QUOTES.contains(&text[i]) {
            skip_string(text, i)
        } else {
            i + 1
        };
    }
    i + 1
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const ERR_RATE: &str = r#"sum by (job)(rate(http_requests_total{code=~"5.."}[5m]))"#;
    const ALL_RATE: &str = "sum by (job)(rate(http_requests_total[5m]))";

    fn inputs(pairs: &[(&str, Option<&str>)]) -> BTreeMap<String, Option<String>> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.map(str::to_string)))
            .collect()
    }

    fn sub(formula: &str, pairs: &[(&str, Option<&str>)]) -> Result<String, FormulaError> {
        substitute(formula, &inputs(pairs))
    }

    #[test]
    fn substitutes_letters_as_the_live_helper_does() {
        let abc = [("A", Some("a")), ("B", Some("b")), ("C", Some("c"))];
        let cases = [
            (
                "A / B * 100".to_string(),
                vec![("A", Some(ERR_RATE)), ("B", Some(ALL_RATE))],
                format!("({ERR_RATE}) / ({ALL_RATE}) * 100"),
            ),
            ("A - A".into(), vec![("A", Some("up"))], "(up) - (up)".into()),
            (
                r#"label_replace(A, "B", 'C', `D`, "x")"#.into(),
                vec![("A", Some("up"))],
                r#"label_replace((up), "B", 'C', `D`, "x")"#.into(),
            ),
            (
                r#"label_replace(A, "a\"B", "", "", "")"#.into(),
                vec![("A", Some("up"))],
                r#"label_replace((up), "a\"B", "", "", "")"#.into(),
            ),
            (
                r#"A + up{job="A", B="x"}"#.into(),
                vec![("A", Some("m"))],
                r#"(m) + up{job="A", B="x"}"#.into(),
            ),
            (
                r#"up{x="}B"} + A"#.into(),
                vec![("A", Some("m"))],
                r#"up{x="}B"} + (m)"#.into(),
            ),
            (
                "sum by (A) (B) + sum without (B) (A) + A * on (B) C + A / ignoring (B) C".into(),
                abc.to_vec(),
                "sum by (A) ((b)) + sum without (B) ((a)) + (a) * on (B) (c) + (a) / ignoring (B) (c)"
                    .into(),
            ),
            (
                "sum BY (A) (B)".into(),
                vec![("B", Some("b"))],
                "sum BY (A) ((b))".into(),
            ),
            (
                "A + on(job) group_left B".into(),
                abc.to_vec(),
                "(a) + on(job) group_left (b)".into(),
            ),
            (
                "A * on(job) group_left(B) B + A * on(job) group_right (A) B".into(),
                abc.to_vec(),
                "(a) * on(job) group_left(B) (b) + (a) * on(job) group_right (A) (b)".into(),
            ),
            (
                "rate(A[5m]) * 1e3 + ABC + A_x + 0x1F".into(),
                vec![("A", Some("up"))],
                "rate((up)[5m]) * 1e3 + ABC + A_x + 0x1F".into(),
            ),
            (
                "A # B is ignored\n".into(),
                vec![("A", Some("up"))],
                "(up) # B is ignored\n".into(),
            ),
            (
                "A # don't\n+ A".into(),
                vec![("A", Some("up"))],
                "(up) # don't\n+ (up)".into(),
            ),
            (
                "A * 2".into(),
                vec![("A", Some("up # note"))],
                "(up # note\n) * 2".into(),
            ),
        ];
        for (formula, pairs, want) in cases {
            assert_eq!(sub(&formula, &pairs), Ok(want), "{formula}");
        }
    }

    #[test]
    fn an_unknown_letter_or_a_formula_letter_is_refused() {
        assert_eq!(
            sub("A / B", &[("A", Some("up"))]),
            Err(FormulaError::Unknown('B'))
        );
        assert_eq!(
            sub("A / F", &[("A", Some("up")), ("F", None)]),
            Err(FormulaError::Formula('F'))
        );
    }

    #[test]
    fn letters_follow_stored_refs_then_position_and_formulas_take_none() {
        let configs = [
            json!({ "ref": "B" }),
            json!({}),
            json!({ "formula": "A + B" }),
            json!({ "ref": "" }),
            json!({ "ref": "F", "formula": "1" }),
        ];
        assert_eq!(
            query_refs(&configs),
            [
                Some("B".to_string()),
                Some("A".to_string()),
                None,
                Some("C".to_string()),
                Some("F".to_string()),
            ]
        );
        assert!(is_formula(&json!({ "formula": "" })));
        assert!(!is_formula(&json!({ "formula": null })));
        assert!(!is_formula(&json!({})));
    }
}
