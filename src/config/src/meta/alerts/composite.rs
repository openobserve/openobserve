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

//! Composite alerts — Feature 4 of `alerts_2.md`.
//!
//! TODO(composite): the feature is deferred — this module is pure logic with
//! tests and is deliberately not wired into the scheduler, API, or UI yet.
//!
//! Pure logic only: expression parsing/evaluation over child *states*, the
//! stale-child policy (§6.4), and the write-time guards (child counts, cycles).
//! Composites never re-run child queries — that is the whole point of building
//! them on the durable state layer.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::level::AlertLevel;

/// Maximum children per composite (C-1). Bounded so one composite cannot
/// fan out an unbounded state read on every evaluation.
pub const MAX_CHILDREN: usize = 10;
/// Minimum children — a "composite" of one is just the child.
pub const MIN_CHILDREN: usize = 2;
/// Maximum composite nesting depth (D6).
pub const MAX_DEPTH: usize = 2;
/// Staleness multiplier: a child is stale after K x its own frequency (§6.4).
pub const STALE_FREQUENCY_MULTIPLIER: i64 = 3;

/// Boolean expression over child alerts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompositeExpr {
    Child(String),
    And(Box<CompositeExpr>, Box<CompositeExpr>),
    Or(Box<CompositeExpr>, Box<CompositeExpr>),
    Not(Box<CompositeExpr>),
}

/// The slice of a child's state a composite needs.
#[derive(Clone, Debug, PartialEq)]
pub struct ChildState {
    pub level: Option<AlertLevel>,
    /// When the level was last *computed* (`alert_states.level_at`).
    ///
    /// Deliberately not `last_outcome_at`: a child erroring every minute
    /// refreshes its outcome timestamp while its level goes stale, which would
    /// keep a long-broken child looking "fresh" to composites.
    pub level_at: Option<i64>,
    pub frequency_secs: i64,
}

impl ChildState {
    fn is_stale(&self, now: i64) -> bool {
        match self.level_at {
            // Never classified — no basis for a truth value.
            None => true,
            Some(at) => {
                let window = STALE_FREQUENCY_MULTIPLIER
                    .saturating_mul(self.frequency_secs)
                    .saturating_mul(1_000_000);
                now.saturating_sub(at) > window
            }
        }
    }
}

/// What a composite does with a child whose state has gone stale (§6.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum StaleChildPolicy {
    /// Trust the frozen state (default).
    #[serde(rename = "use_last_state")]
    UseLastState,
    /// A stale child never satisfies the expression.
    #[serde(rename = "treat_as_false")]
    TreatAsFalse,
    /// Fail-safe for absence-of-heartbeat patterns.
    #[serde(rename = "treat_as_true")]
    TreatAsTrue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CompositeError {
    /// The expression references a child absent from the supplied state map.
    /// Loud failure beats a silent `false` that would never fire.
    UnknownChild(String),
    TooFewChildren {
        got: usize,
        min: usize,
    },
    TooManyChildren {
        got: usize,
        max: usize,
    },
    DuplicateChild(String),
    /// The reference chain loops; carries the offending path.
    Cycle(Vec<String>),
    TooDeep {
        max: usize,
    },
    Parse(String),
}

impl std::fmt::Display for CompositeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownChild(c) => write!(f, "unknown child alert `{c}`"),
            Self::TooFewChildren { got, min } => {
                write!(f, "composite needs at least {min} children, got {got}")
            }
            Self::TooManyChildren { got, max } => {
                write!(f, "composite allows at most {max} children, got {got}")
            }
            Self::DuplicateChild(c) => write!(f, "child `{c}` referenced more than once"),
            Self::Cycle(path) => write!(f, "composite reference cycle: {}", path.join(" -> ")),
            Self::TooDeep { max } => write!(f, "composite nesting exceeds depth {max}"),
            Self::Parse(m) => write!(f, "invalid expression: {m}"),
        }
    }
}

impl std::error::Error for CompositeError {}

// ── Parsing ─────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Ident(String),
    And,
    Or,
    Not,
    LParen,
    RParen,
}

fn tokenize(input: &str) -> Result<Vec<Token>, CompositeError> {
    let chars: Vec<char> = input.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            c if c.is_whitespace() => i += 1,
            '(' => {
                out.push(Token::LParen);
                i += 1;
            }
            ')' => {
                out.push(Token::RParen);
                i += 1;
            }
            '!' => {
                out.push(Token::Not);
                i += 1;
            }
            '&' | '|' => {
                if i + 1 < chars.len() && chars[i + 1] == c {
                    out.push(if c == '&' { Token::And } else { Token::Or });
                    i += 2;
                } else {
                    return Err(CompositeError::Parse(format!("expected `{c}{c}`")));
                }
            }
            // Operand tokens: alert ksuids in stored expressions, readable
            // names in tests and the UI. Braces are accepted so `{ksuid}` is
            // valid without changing the grammar.
            c if c.is_alphanumeric() || c == '_' || c == '-' || c == '{' || c == '}' => {
                let start = i;
                while i < chars.len()
                    && (chars[i].is_alphanumeric()
                        || chars[i] == '_'
                        || chars[i] == '-'
                        || chars[i] == '{'
                        || chars[i] == '}')
                {
                    i += 1;
                }
                let raw: String = chars[start..i].iter().collect();
                out.push(Token::Ident(
                    raw.trim_matches(|c| c == '{' || c == '}').to_string(),
                ));
            }
            other => {
                return Err(CompositeError::Parse(format!(
                    "unexpected character `{other}`"
                )));
            }
        }
    }
    Ok(out)
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    /// or := and ( "||" and )*
    fn parse_or(&mut self) -> Result<CompositeExpr, CompositeError> {
        let mut lhs = self.parse_and()?;
        while matches!(self.peek(), Some(Token::Or)) {
            self.pos += 1;
            let rhs = self.parse_and()?;
            lhs = CompositeExpr::Or(Box::new(lhs), Box::new(rhs));
        }
        Ok(lhs)
    }

    /// and := unary ( "&&" unary )*  — binds tighter than `||`.
    fn parse_and(&mut self) -> Result<CompositeExpr, CompositeError> {
        let mut lhs = self.parse_unary()?;
        while matches!(self.peek(), Some(Token::And)) {
            self.pos += 1;
            let rhs = self.parse_unary()?;
            lhs = CompositeExpr::And(Box::new(lhs), Box::new(rhs));
        }
        Ok(lhs)
    }

    /// unary := "!" unary | atom  — binds tighter than `&&`.
    fn parse_unary(&mut self) -> Result<CompositeExpr, CompositeError> {
        if matches!(self.peek(), Some(Token::Not)) {
            self.pos += 1;
            return Ok(CompositeExpr::Not(Box::new(self.parse_unary()?)));
        }
        self.parse_atom()
    }

    fn parse_atom(&mut self) -> Result<CompositeExpr, CompositeError> {
        match self.peek().cloned() {
            Some(Token::Ident(name)) => {
                self.pos += 1;
                Ok(CompositeExpr::Child(name))
            }
            Some(Token::LParen) => {
                self.pos += 1;
                let inner = self.parse_or()?;
                if !matches!(self.peek(), Some(Token::RParen)) {
                    return Err(CompositeError::Parse("unclosed `(`".to_string()));
                }
                self.pos += 1;
                Ok(inner)
            }
            Some(t) => Err(CompositeError::Parse(format!("unexpected token {t:?}"))),
            None => Err(CompositeError::Parse(
                "unexpected end of expression".to_string(),
            )),
        }
    }
}

/// Parse a composite expression. `&&` binds tighter than `||`, `!` tighter than
/// both — matching every mainstream language, because getting this wrong
/// silently changes the meaning of every composite with no error anywhere.
pub fn parse_expr(input: &str) -> Result<CompositeExpr, CompositeError> {
    let tokens = tokenize(input)?;
    if tokens.is_empty() {
        return Err(CompositeError::Parse("empty expression".to_string()));
    }
    let mut p = Parser { tokens, pos: 0 };
    let expr = p.parse_or()?;
    if p.pos != p.tokens.len() {
        return Err(CompositeError::Parse(
            "trailing tokens after expression".to_string(),
        ));
    }
    Ok(expr)
}

// ── Evaluation ──────────────────────────────────────────────────────────────

fn level_truth(level: Option<AlertLevel>, warning_counts_as_firing: bool) -> bool {
    match level {
        Some(AlertLevel::Critical) => true,
        Some(AlertLevel::Warning) => warning_counts_as_firing,
        _ => false,
    }
}

fn child_truth(
    name: &str,
    states: &HashMap<String, ChildState>,
    warning_counts_as_firing: bool,
    stale_policy: StaleChildPolicy,
    now: i64,
) -> Result<bool, CompositeError> {
    let state = states
        .get(name)
        .ok_or_else(|| CompositeError::UnknownChild(name.to_string()))?;

    if state.is_stale(now) {
        return Ok(match stale_policy {
            StaleChildPolicy::TreatAsFalse => false,
            StaleChildPolicy::TreatAsTrue => true,
            // Fall back to the frozen level; a never-classified child yields
            // false rather than panicking.
            StaleChildPolicy::UseLastState => level_truth(state.level, warning_counts_as_firing),
        });
    }
    Ok(level_truth(state.level, warning_counts_as_firing))
}

/// Evaluate a composite over child states. Never touches child queries.
pub fn evaluate_expr(
    expr: &CompositeExpr,
    states: &HashMap<String, ChildState>,
    warning_counts_as_firing: bool,
    stale_policy: StaleChildPolicy,
    now: i64,
) -> Result<bool, CompositeError> {
    Ok(match expr {
        CompositeExpr::Child(name) => {
            child_truth(name, states, warning_counts_as_firing, stale_policy, now)?
        }
        CompositeExpr::Not(inner) => {
            !evaluate_expr(inner, states, warning_counts_as_firing, stale_policy, now)?
        }
        CompositeExpr::And(a, b) => {
            evaluate_expr(a, states, warning_counts_as_firing, stale_policy, now)?
                && evaluate_expr(b, states, warning_counts_as_firing, stale_policy, now)?
        }
        CompositeExpr::Or(a, b) => {
            evaluate_expr(a, states, warning_counts_as_firing, stale_policy, now)?
                || evaluate_expr(b, states, warning_counts_as_firing, stale_policy, now)?
        }
    })
}

/// Level a composite reports.
///
/// OPEN DECISION (D9): a firing composite is always `Critical` — composites
/// carry no thresholds of their own, so there is no basis for an intermediate
/// level.
pub fn result_level(fired: bool) -> AlertLevel {
    if fired {
        AlertLevel::Critical
    } else {
        AlertLevel::Ok
    }
}

// ── Write-time guards ───────────────────────────────────────────────────────

/// Child count and uniqueness (C-1).
pub fn validate_children(children: &[String]) -> Result<(), CompositeError> {
    if children.len() < MIN_CHILDREN {
        return Err(CompositeError::TooFewChildren {
            got: children.len(),
            min: MIN_CHILDREN,
        });
    }
    if children.len() > MAX_CHILDREN {
        return Err(CompositeError::TooManyChildren {
            got: children.len(),
            max: MAX_CHILDREN,
        });
    }
    let mut seen = std::collections::HashSet::new();
    for c in children {
        if !seen.insert(c) {
            return Err(CompositeError::DuplicateChild(c.clone()));
        }
    }
    Ok(())
}

/// Depth of a composite reference subtree. Plain alerts (absent from
/// `existing`) are depth 0; a composite is 1 + its deepest composite child.
fn depth_of(id: &str, existing: &HashMap<String, Vec<String>>) -> usize {
    match existing.get(id) {
        None => 0,
        Some(children) => {
            1 + children
                .iter()
                .map(|c| depth_of(c, existing))
                .max()
                .unwrap_or(0)
        }
    }
}

/// Reject reference cycles and over-deep nesting at write time (C-4, D6).
///
/// Detected on write, never at evaluation: a cycle discovered mid-evaluation
/// would be an infinite loop in the scheduler.
pub fn validate_no_cycle(
    composite_id: &str,
    children: &[String],
    existing: &HashMap<String, Vec<String>>,
) -> Result<(), CompositeError> {
    // Depth-first search back toward `composite_id`.
    fn walk(
        current: &str,
        target: &str,
        existing: &HashMap<String, Vec<String>>,
        path: &mut Vec<String>,
    ) -> Option<Vec<String>> {
        if current == target {
            path.push(current.to_string());
            return Some(path.clone());
        }
        if path.iter().any(|p| p == current) {
            // A pre-existing loop between other composites; stop descending.
            return None;
        }
        path.push(current.to_string());
        if let Some(kids) = existing.get(current) {
            for k in kids {
                if let Some(found) = walk(k, target, existing, path) {
                    return Some(found);
                }
            }
        }
        path.pop();
        None
    }

    for child in children {
        let mut path = Vec::new();
        if let Some(cycle) = walk(child, composite_id, existing, &mut path) {
            return Err(CompositeError::Cycle(cycle));
        }
    }

    // Depth of the composite as it would exist after this write.
    let deepest = children
        .iter()
        .map(|c| depth_of(c, existing))
        .max()
        .unwrap_or(0);
    if 1 + deepest > MAX_DEPTH {
        return Err(CompositeError::TooDeep { max: MAX_DEPTH });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::meta::alerts::{
        composite::{
            ChildState, CompositeError, CompositeExpr, StaleChildPolicy, evaluate_expr, parse_expr,
            validate_children, validate_no_cycle,
        },
        level::AlertLevel,
    };

    /// A child whose level was computed recently.
    /// NOTE: staleness runs on `level_at` — when the level was last COMPUTED
    /// from a successful evaluation — not on any "last evaluation" time. An
    /// alert erroring every minute stays fresh on last_outcome_at while its
    /// level rots; `level_at` is immune to that (alerts_2.md §6.4/§7.6).
    fn fresh(level: AlertLevel) -> ChildState {
        ChildState {
            level: Some(level),
            // 60s ago, inside the K x 60s = 180s staleness window.
            level_at: Some(NOW - 60_000_000),
            frequency_secs: 60,
        }
    }

    /// A child whose level is far older than K× its frequency.
    fn stale(level: AlertLevel) -> ChildState {
        ChildState {
            level: Some(level),
            // 600s ago, well beyond the 180s window.
            //
            // NOTE: the original fixtures used level_at 1_000 vs 1 against
            // NOW = 1_000_000 — a 1ms difference against a 180s threshold, so
            // BOTH read as fresh and every staleness test passed vacuously.
            level_at: Some(NOW - 600_000_000),
            frequency_secs: 60,
        }
    }

    fn states(pairs: &[(&str, ChildState)]) -> HashMap<String, ChildState> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    /// Microseconds. Large enough that the fixtures below stay positive.
    const NOW: i64 = 1_000_000_000;

    // ── Expression parsing ──────────────────────────────────────────────────

    #[test]
    fn test_parse_single_child() {
        let e = parse_expr("a").unwrap();
        assert_eq!(e, CompositeExpr::Child("a".to_string()));
    }

    #[test]
    fn test_parse_and_or_not() {
        assert!(parse_expr("a && b").is_ok());
        assert!(parse_expr("a || b").is_ok());
        assert!(parse_expr("!a").is_ok());
        assert!(parse_expr("(a && b) || !c").is_ok());
    }

    #[test]
    fn test_parse_rejects_malformed_expressions() {
        for bad in ["a &&", "&& b", "(a && b", "a b", "", "a && && b", "!"] {
            assert!(
                parse_expr(bad).is_err(),
                "expression {bad:?} must be rejected"
            );
        }
    }

    #[test]
    fn test_and_binds_tighter_than_or() {
        // `a || b && c` must parse as `a || (b && c)`, matching every
        // mainstream language. Getting this wrong silently changes semantics.
        //
        // The operand values must DISCRIMINATE between the two parses:
        //   a=true, b=false, c=false
        //     a || (b && c)  =  true  || false  =  TRUE   <- correct
        //     (a || b) && c  =  true  && false  =  FALSE  <- wrong precedence
        // An earlier version used a=false,b=true,c=false, where both parses
        // yield false — it passed regardless of precedence.
        let states = states(&[
            ("a", fresh(AlertLevel::Critical)),
            ("b", fresh(AlertLevel::Ok)),
            ("c", fresh(AlertLevel::Ok)),
        ]);
        let e = parse_expr("a || b && c").unwrap();
        assert!(
            evaluate_expr(&e, &states, true, StaleChildPolicy::UseLastState, NOW).unwrap(),
            "must be true; a false result means OR bound tighter than AND"
        );
    }

    #[test]
    fn test_not_binds_tighter_than_and() {
        // `!a && b` is `(!a) && b`, not `!(a && b)`.
        //   a=true, b=true  ->  (!a) && b = false ;  !(a && b) = false   (same)
        //   a=false, b=true ->  (!a) && b = TRUE  ;  !(a && b) = TRUE    (same)
        //   a=true, b=false ->  (!a) && b = false ;  !(a && b) = TRUE    <- differs
        let s = states(&[
            ("a", fresh(AlertLevel::Critical)),
            ("b", fresh(AlertLevel::Ok)),
        ]);
        let e = parse_expr("!a && b").unwrap();
        assert!(
            !evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap(),
            "must be false; a true result means NOT was applied to the whole AND"
        );
    }

    #[test]
    fn test_parentheses_override_precedence() {
        let states = states(&[
            ("a", fresh(AlertLevel::Critical)),
            ("b", fresh(AlertLevel::Ok)),
            ("c", fresh(AlertLevel::Ok)),
        ]);
        // (a || b) && c  =>  true && false => false
        let e = parse_expr("(a || b) && c").unwrap();
        assert!(!evaluate_expr(&e, &states, true, StaleChildPolicy::UseLastState, NOW).unwrap());
    }

    // ── C-3: child truth mapping ────────────────────────────────────────────

    #[test]
    fn test_critical_child_is_true() {
        let s = states(&[("a", fresh(AlertLevel::Critical))]);
        let e = parse_expr("a").unwrap();
        assert!(evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap());
    }

    #[test]
    fn test_ok_child_is_false() {
        let s = states(&[("a", fresh(AlertLevel::Ok))]);
        let e = parse_expr("a").unwrap();
        assert!(!evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap());
    }

    /// D5: default is that Warning counts as firing.
    #[test]
    fn test_warning_child_truth_follows_the_flag() {
        let s = states(&[("a", fresh(AlertLevel::Warning))]);
        let e = parse_expr("a").unwrap();

        assert!(
            evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap(),
            "warning_counts_as_firing = true (default)"
        );
        assert!(
            !evaluate_expr(&e, &s, false, StaleChildPolicy::UseLastState, NOW).unwrap(),
            "warning_counts_as_firing = false"
        );
    }

    #[test]
    fn test_negation_inverts_child_truth() {
        let s = states(&[("a", fresh(AlertLevel::Ok))]);
        let e = parse_expr("!a").unwrap();
        assert!(evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap());
    }

    #[test]
    fn test_realistic_composite_expression() {
        // (disk_full && high_latency) || db_down
        let s = states(&[
            ("disk_full", fresh(AlertLevel::Critical)),
            ("high_latency", fresh(AlertLevel::Ok)),
            ("db_down", fresh(AlertLevel::Critical)),
        ]);
        let e = parse_expr("(disk_full && high_latency) || db_down").unwrap();
        assert!(evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap());
    }

    // ── §6.4: stale-child policy ────────────────────────────────────────────

    #[test]
    fn test_stale_child_use_last_state_keeps_its_truth() {
        let s = states(&[("a", stale(AlertLevel::Critical))]);
        let e = parse_expr("a").unwrap();
        assert!(
            evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap(),
            "default policy trusts the frozen state"
        );
    }

    #[test]
    fn test_stale_child_treat_as_false() {
        let s = states(&[("a", stale(AlertLevel::Critical))]);
        let e = parse_expr("a").unwrap();
        assert!(!evaluate_expr(&e, &s, true, StaleChildPolicy::TreatAsFalse, NOW).unwrap());
    }

    #[test]
    fn test_stale_child_treat_as_true_supports_heartbeat_patterns() {
        let s = states(&[("a", stale(AlertLevel::Ok))]);
        let e = parse_expr("a").unwrap();
        assert!(
            evaluate_expr(&e, &s, true, StaleChildPolicy::TreatAsTrue, NOW).unwrap(),
            "fail-safe: absence of a heartbeat should be able to fire"
        );
    }

    #[test]
    fn test_never_evaluated_child_uses_the_stale_policy() {
        // A child that has never run has no level at all — distinct from Ok.
        let never = ChildState {
            level: None,
            level_at: None,
            frequency_secs: 60,
        };
        let s = states(&[("a", never)]);
        let e = parse_expr("a").unwrap();

        assert!(!evaluate_expr(&e, &s, true, StaleChildPolicy::TreatAsFalse, NOW).unwrap());
        assert!(evaluate_expr(&e, &s, true, StaleChildPolicy::TreatAsTrue, NOW).unwrap());
        assert!(
            !evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap(),
            "no last state to use → falls back to false rather than panicking"
        );
    }

    #[test]
    fn test_missing_child_state_is_an_error_not_a_silent_false() {
        // A referenced child with no entry at all means the caller assembled
        // the state map wrongly. Failing loudly beats a silent false.
        let s = states(&[("a", fresh(AlertLevel::Critical))]);
        let e = parse_expr("a && missing").unwrap();
        let err = evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap_err();
        assert_eq!(err, CompositeError::UnknownChild("missing".to_string()));
    }

    // ── C-1: child-count limits ─────────────────────────────────────────────

    #[test]
    fn test_requires_at_least_two_children() {
        let err = validate_children(&["a".to_string()]).unwrap_err();
        assert_eq!(err, CompositeError::TooFewChildren { got: 1, min: 2 });
    }

    #[test]
    fn test_accepts_between_two_and_ten_children() {
        for n in 2..=10 {
            let kids: Vec<String> = (0..n).map(|i| format!("a{i}")).collect();
            assert!(
                validate_children(&kids).is_ok(),
                "{n} children must be valid"
            );
        }
    }

    #[test]
    fn test_rejects_more_than_ten_children() {
        let kids: Vec<String> = (0..11).map(|i| format!("a{i}")).collect();
        let err = validate_children(&kids).unwrap_err();
        assert_eq!(err, CompositeError::TooManyChildren { got: 11, max: 10 });
    }

    #[test]
    fn test_rejects_duplicate_children() {
        let kids = vec!["a".to_string(), "a".to_string()];
        assert_eq!(
            validate_children(&kids).unwrap_err(),
            CompositeError::DuplicateChild("a".to_string())
        );
    }

    // ── C-4: cycle rejection ────────────────────────────────────────────────

    #[test]
    fn test_rejects_direct_self_reference() {
        let err = validate_no_cycle("c1", &["c1".to_string()], &HashMap::new()).unwrap_err();
        assert_eq!(err, CompositeError::Cycle(vec!["c1".to_string()]));
    }

    #[test]
    fn test_rejects_transitive_cycle() {
        // c1 -> c2 -> c1
        let mut existing = HashMap::new();
        existing.insert("c2".to_string(), vec!["c1".to_string()]);

        let err = validate_no_cycle("c1", &["c2".to_string()], &existing).unwrap_err();
        assert!(
            matches!(err, CompositeError::Cycle(_)),
            "a transitive cycle must be rejected at write time, not discovered at eval"
        );
    }

    #[test]
    fn test_accepts_acyclic_composite_of_composite() {
        // c1 -> c2 -> (plain alerts). Depth 2, no cycle (D6).
        let mut existing = HashMap::new();
        existing.insert("c2".to_string(), vec![]);
        assert!(validate_no_cycle("c1", &["c2".to_string()], &existing).is_ok());
    }

    /// D6: depth beyond 2 is rejected in v1.
    #[test]
    fn test_rejects_depth_greater_than_two() {
        // c1 -> c2 -> c3 is depth 3.
        let mut existing = HashMap::new();
        existing.insert("c2".to_string(), vec!["c3".to_string()]);
        existing.insert("c3".to_string(), vec![]);

        let err = validate_no_cycle("c1", &["c2".to_string()], &existing).unwrap_err();
        assert_eq!(err, CompositeError::TooDeep { max: 2 });
    }

    // ── Composite result maps to a level ────────────────────────────────────

    /// OPEN DECISION (not covered by alerts_2.md): a firing composite is
    /// reported as Critical, never Warning — composites have no thresholds of
    /// their own, so there is no basis for an intermediate level. If composites
    /// should instead inherit the worst child level (so a warning-only
    /// composite reports Warning), this is the test to change.
    #[test]
    fn test_composite_result_maps_to_a_level() {
        use crate::meta::alerts::composite::result_level;
        assert_eq!(result_level(true), AlertLevel::Critical);
        assert_eq!(result_level(false), AlertLevel::Ok);
    }
}
