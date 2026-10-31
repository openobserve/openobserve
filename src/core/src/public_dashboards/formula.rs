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
const MAX_FORMULA_LENGTH: usize = 100_000;
const MAX_FORMULA_DEPTH: usize = 10;

/// A formula the live executor refuses to expand.
#[derive(Debug, PartialEq, thiserror::Error)]
pub enum FormulaError {
    #[error("{0}, which is not a query in this panel")]
    Unknown(String),
    #[error("formulas that refer to each other in a loop: {0}")]
    Cycle(String),
    #[error("formulas nested more than {} levels deep", MAX_FORMULA_DEPTH)]
    TooDeep,
    #[error("an expansion longer than {} characters", MAX_FORMULA_LENGTH)]
    TooLong,
}

/// `FormulaInput`: a query's final text, and whether that text is itself a formula.
#[derive(Debug, Clone, PartialEq)]
pub struct FormulaInput {
    pub text: String,
    pub is_formula: bool,
}

/// `isFormulaQuery`: any string formula, even an empty one.
pub fn is_formula(config: &Value) -> bool {
    config.get("formula").is_some_and(Value::is_string)
}

/// `queryRefs`: the stored ref, else the first free letter, or `F<n>` for a formula.
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
            // Formulas live apart from the letters, so a letter a formula waits on stays free.
            let name = if is_formula(cfg) {
                (1..).map(|n| format!("F{n}")).find(|r| !used.contains(r))?
            } else {
                LETTERS
                    .chars()
                    .map(String::from)
                    .find(|l| !used.contains(l))?
            };
            used.push(name.clone());
            Some(name)
        })
        .collect()
}

/// Each query's text, a formula's references replaced by their inputs'; hiding is the caller's.
pub fn expand(configs: &[Value], texts: &[String]) -> Vec<Result<String, FormulaError>> {
    let refs = query_refs(configs);
    let inputs: BTreeMap<String, FormulaInput> = refs
        .iter()
        .zip(configs.iter().zip(texts))
        .filter_map(|(name, (cfg, text))| {
            let input = FormulaInput {
                text: text.clone(),
                is_formula: is_formula(cfg),
            };
            Some((name.clone()?, input))
        })
        .collect();
    configs
        .iter()
        .zip(texts)
        .zip(&refs)
        .map(|((cfg, text), name)| {
            if is_formula(cfg) {
                substitute(text, &inputs, name.as_deref())
            } else {
                Ok(text.clone())
            }
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

/// `substituteFormula`: references become their inputs in parentheses, formulas recursively.
pub fn substitute(
    formula: &str,
    inputs: &BTreeMap<String, FormulaInput>,
    self_ref: Option<&str>,
) -> Result<String, FormulaError> {
    let mut expander = Expander {
        inputs,
        expanded: BTreeMap::new(),
    };
    let mut path: Vec<String> = self_ref.map(str::to_string).into_iter().collect();
    expander.expand(formula, &mut path)
}

struct Expander<'a> {
    inputs: &'a BTreeMap<String, FormulaInput>,
    expanded: BTreeMap<String, String>,
}

impl Expander<'_> {
    fn expand(&mut self, text: &str, path: &mut Vec<String>) -> Result<String, FormulaError> {
        let chars: Vec<char> = text.chars().collect();
        let mut expr = String::new();
        let mut length = 0;
        let mut last = 0;
        for (start, name) in ref_tokens(&chars) {
            let input = self
                .inputs
                .get(&name)
                .ok_or_else(|| FormulaError::Unknown(name.clone()))?;
            let inner = if input.is_formula {
                self.expand_formula(&name, &input.text, path)?
            } else {
                input.text.clone()
            };
            // A trailing `#` comment in the input would otherwise swallow the closing parenthesis.
            let newline = if inner.contains('#') { "\n" } else { "" };
            let piece: String = chars[last..start].iter().collect();
            let piece = format!("{piece}({inner}{newline})");
            length += piece.chars().count();
            expr.push_str(&piece);
            last = start + name.chars().count();
            // Each nesting level can double the text, so the cap stops exponential growth early.
            if length > MAX_FORMULA_LENGTH {
                return Err(FormulaError::TooLong);
            }
        }
        expr.extend(&chars[last..]);
        Ok(expr)
    }

    fn expand_formula(
        &mut self,
        name: &str,
        text: &str,
        path: &mut Vec<String>,
    ) -> Result<String, FormulaError> {
        if let Some(done) = self.expanded.get(name) {
            return Ok(done.clone());
        }
        if let Some(at) = path.iter().position(|p| p == name) {
            let mut cycle = path[at..].to_vec();
            cycle.push(name.to_string());
            return Err(FormulaError::Cycle(cycle.join(" → ")));
        }
        if path.len() >= MAX_FORMULA_DEPTH {
            return Err(FormulaError::TooDeep);
        }
        path.push(name.to_string());
        let out = self.expand(text, path);
        path.pop();
        let out = out?;
        self.expanded.insert(name.to_string(), out.clone());
        Ok(out)
    }
}

/// Each reference's char offset and name, outside strings, braces, comments and label lists.
fn ref_tokens(text: &[char]) -> Vec<(usize, String)> {
    let mut refs = Vec::new();
    let mut i = 0;
    while i < text.len() {
        i = next_token(text, i, &mut refs);
    }
    refs
}

fn next_token(text: &[char], i: usize, refs: &mut Vec<(usize, String)>) -> usize {
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
        return scan_word(text, i, refs);
    }
    i + 1
}

fn is_ident_start(ch: char) -> bool {
    ch.is_ascii_alphabetic() || ch == '_' || ch == ':'
}

fn is_ident_part(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == ':'
}

fn scan_word(text: &[char], start: usize, refs: &mut Vec<(usize, String)>) -> usize {
    let mut end = start;
    while end < text.len() && is_ident_part(text[end]) {
        end += 1;
    }
    let word: String = text[start..end].iter().collect();
    if LABEL_LIST_KEYWORDS.contains(&word.to_lowercase().as_str()) {
        return skip_label_list(text, end);
    }
    if (word.len() == 1 && LETTERS.contains(&word)) || is_formula_ref(&word) {
        refs.push((start, word));
    }
    end
}

/// `F<n>` with no leading zero, the name `queryRefs` gives a formula.
fn is_formula_ref(word: &str) -> bool {
    word.strip_prefix('F').is_some_and(|n| {
        n.starts_with(|c: char| ('1'..='9').contains(&c)) && n.chars().all(|c| c.is_ascii_digit())
    })
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

    fn inputs(pairs: &[(&str, Option<&str>)]) -> BTreeMap<String, FormulaInput> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), q(v.unwrap_or_default())))
            .collect()
    }

    fn sub(formula: &str, pairs: &[(&str, Option<&str>)]) -> Result<String, FormulaError> {
        substitute(formula, &inputs(pairs), None)
    }

    fn q(text: &str) -> FormulaInput {
        FormulaInput {
            text: text.to_string(),
            is_formula: false,
        }
    }

    fn f(text: &str) -> FormulaInput {
        FormulaInput {
            text: text.to_string(),
            is_formula: true,
        }
    }

    fn nested(
        formula: &str,
        pairs: &[(&str, FormulaInput)],
        self_ref: &str,
    ) -> Result<String, FormulaError> {
        let map = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect();
        substitute(formula, &map, Some(self_ref))
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
    fn an_unknown_letter_is_refused() {
        assert_eq!(
            sub("A / B", &[("A", Some("up"))]),
            Err(FormulaError::Unknown("B".into()))
        );
        let pairs = [("A", q("up")), ("B", f("A / Z"))];
        assert_eq!(
            nested("B * 2", &pairs, "C"),
            Err(FormulaError::Unknown("Z".into()))
        );
    }

    #[test]
    fn inlines_formulas_referenced_by_name_with_parentheses() {
        let pairs = [
            ("A", q("x")),
            ("B", q("y")),
            ("F1", f("A / B")),
            ("F2", f("F1 * 100")),
        ];
        assert_eq!(
            nested("F2 - F1", &pairs, "F3"),
            Ok("(((x) / (y)) * 100) - ((x) / (y))".into())
        );
        let pairs = [("A", q("x")), ("B", q("y")), ("C", f("A + B"))];
        assert_eq!(nested("C * 2", &pairs, "D"), Ok("((x) + (y)) * 2".into()));
        let pairs = [
            ("A", q("up")),
            ("B", f("A + 1")),
            ("C", f("B * 2")),
            ("D", f("C - B")),
        ];
        assert_eq!(
            nested("D", &pairs, "E"),
            Ok("((((up) + 1) * 2) - ((up) + 1))".into())
        );
    }

    #[test]
    fn reads_f_names_only_as_whole_tokens_outside_label_lists() {
        let pairs = [("A", q("x")), ("F1", f("A"))];
        assert_eq!(
            nested("F1 + F10x + F01 + sum by (F1) (F1)", &pairs, "F2"),
            Ok("((x)) + F10x + F01 + sum by (F1) (((x)))".into())
        );
    }

    #[test]
    fn reports_cycles_with_their_path() {
        assert_eq!(
            nested("A + 1", &[("A", f("A + 1"))], "A"),
            Err(FormulaError::Cycle("A → A".into()))
        );
        let pairs = [
            ("A", q("up")),
            ("B", f("C + A")),
            ("C", f("D")),
            ("D", f("B * 2")),
        ];
        assert_eq!(
            nested("C + A", &pairs, "B"),
            Err(FormulaError::Cycle("B → C → D → B".into()))
        );
        assert_eq!(
            nested("B", &[("B", f("C")), ("C", f("B"))], "D"),
            Err(FormulaError::Cycle("B → C → B".into()))
        );
        let pairs = [("A", f("A + 1"))];
        let map = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect();
        assert_eq!(
            substitute("A + 1", &map, None),
            Err(FormulaError::Cycle("A → A".into()))
        );
    }

    #[test]
    fn caps_depth_and_length() {
        let mut pairs = vec![("A".to_string(), q("x")), ("F1".to_string(), f("A"))];
        for n in 2..=12 {
            pairs.push((format!("F{n}"), f(&format!("F{}", n - 1))));
        }
        let map: BTreeMap<String, FormulaInput> = pairs.into_iter().collect();
        assert_eq!(
            substitute("F12", &map, Some("F13")),
            Err(FormulaError::TooDeep)
        );
        assert!(substitute("F8", &map, Some("F13")).is_ok());

        let big = "x".repeat(1000);
        let sixty = vec!["A"; 60].join(" + ");
        let pairs = [("A", q(&big)), ("F1", f(&sixty)), ("F2", f("F1 + F1"))];
        assert!(nested("F1", &pairs, "F3").is_ok());
        assert_eq!(nested("F2", &pairs, "F3"), Err(FormulaError::TooLong));
    }

    #[test]
    fn refs_follow_stored_refs_then_position_and_formulas_take_f_names() {
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
                Some("F1".to_string()),
                Some("C".to_string()),
                Some("F".to_string()),
            ]
        );
        let configs = [
            json!({ "ref": "A" }),
            json!({ "formula": "A + B" }),
            json!({}),
            json!({ "formula": "", "ref": "F1" }),
            json!({ "formula": "" }),
        ];
        let names: Vec<_> = query_refs(&configs).into_iter().flatten().collect();
        assert_eq!(names, ["A", "F2", "B", "F1", "F3"]);
        assert!(is_formula(&json!({ "formula": "" })));
        assert!(!is_formula(&json!({ "formula": null })));
        assert!(!is_formula(&json!({})));
    }
}
