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

//! Pure composite-alert domain logic: strict expression parsing and
//! normalization, evaluation over durable child state, schedule-aware
//! freshness, and graph guards.
//! Composites never re-run child queries — that is the whole point of building
//! them on the durable state layer.

use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    sync::{Arc, LazyLock, Mutex},
};

use chrono::{FixedOffset, Offset as _, Utc};
use chrono_tz::Tz;
use cron::Schedule;
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;

use super::{FrequencyType, TriggerCondition, level::AlertLevel};

/// Maximum children per composite (C-1). Bounded so one composite cannot
/// fan out an unbounded state read on every evaluation.
pub const MAX_CHILDREN: usize = 10;
/// Minimum children — a "composite" of one is just the child.
pub const MIN_CHILDREN: usize = 2;
/// Maximum composite nesting depth (D6).
pub const MAX_DEPTH: usize = 2;
/// Staleness multiplier: a child is stale after K x its own frequency (§6.4).
pub const STALE_FREQUENCY_MULTIPLIER: i64 = 3;
/// Maximum accepted expression size, measured in UTF-8 bytes.
pub const MAX_EXPRESSION_BYTES: usize = 4 * 1024;

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
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[repr(i16)]
pub enum StaleChildPolicy {
    /// Trust the frozen state (default).
    #[serde(rename = "use_last_state")]
    #[default]
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
    if input.len() > MAX_EXPRESSION_BYTES {
        return Err(CompositeError::Parse(format!(
            "expression exceeds {MAX_EXPRESSION_BYTES} bytes"
        )));
    }

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
            '{' => {
                let body_start = i + 1;
                let Some(relative_end) = chars[body_start..].iter().position(|c| *c == '}') else {
                    return Err(CompositeError::Parse("unclosed `{`".to_string()));
                };
                let end = body_start + relative_end;
                let raw: String = chars[body_start..end].iter().collect();
                if raw.is_empty() || raw.contains(['{', '}']) || Ksuid::from_str(&raw).is_err() {
                    return Err(CompositeError::Parse(
                        "operands must be brace-wrapped KSUIDs".to_string(),
                    ));
                }
                out.push(Token::Ident(raw));
                i = end + 1;
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

/// Collect child IDs in expression order, rejecting a repeated operand.
pub fn collect_references(expr: &CompositeExpr) -> Result<Vec<String>, CompositeError> {
    fn walk(
        expr: &CompositeExpr,
        seen: &mut HashSet<String>,
        out: &mut Vec<String>,
    ) -> Result<(), CompositeError> {
        match expr {
            CompositeExpr::Child(id) => {
                if !seen.insert(id.clone()) {
                    return Err(CompositeError::DuplicateChild(id.clone()));
                }
                out.push(id.clone());
            }
            CompositeExpr::And(left, right) | CompositeExpr::Or(left, right) => {
                walk(left, seen, out)?;
                walk(right, seen, out)?;
            }
            CompositeExpr::Not(inner) => walk(inner, seen, out)?,
        }
        Ok(())
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    walk(expr, &mut seen, &mut out)?;
    Ok(out)
}

/// Emit the only persisted expression representation.
pub fn canonical_expression(expr: &CompositeExpr) -> String {
    match expr {
        CompositeExpr::Child(id) => format!("{{{id}}}"),
        CompositeExpr::And(left, right) => format!(
            "({} && {})",
            canonical_expression(left),
            canonical_expression(right)
        ),
        CompositeExpr::Or(left, right) => format!(
            "({} || {})",
            canonical_expression(left),
            canonical_expression(right)
        ),
        CompositeExpr::Not(inner) => format!("(!{})", canonical_expression(inner)),
    }
}

/// Parsed cron schedules are immutable and reused across every child freshness
/// computation on every evaluation tick, so cache them by source string.
static CRON_SCHEDULE_CACHE: LazyLock<Mutex<HashMap<String, Arc<Schedule>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn cached_schedule(cron: &str) -> Result<Arc<Schedule>, CompositeError> {
    if let Some(schedule) = CRON_SCHEDULE_CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.get(cron).cloned())
    {
        return Ok(schedule);
    }
    let schedule = Arc::new(
        Schedule::from_str(cron)
            .map_err(|error| CompositeError::Parse(format!("invalid cron: {error}")))?,
    );
    if let Ok(mut cache) = CRON_SCHEDULE_CACHE.lock() {
        cache
            .entry(cron.to_string())
            .or_insert_with(|| schedule.clone());
    }
    Ok(schedule)
}

/// Derive the absolute freshness deadline for an ordinary scheduled alert.
/// Cron schedules are advanced occurrence by occurrence because neighboring
/// gaps need not be equal (weekends, month lengths, and DST transitions).
pub fn alert_stale_deadline_micros(
    level_at: i64,
    condition: &TriggerCondition,
    legacy_tz_offset: i32,
    stale_k: i64,
) -> Result<i64, CompositeError> {
    if stale_k <= 0 {
        return Err(CompositeError::Parse(
            "stale multiplier must be positive".to_string(),
        ));
    }

    if condition.frequency_type != FrequencyType::Cron {
        if condition.frequency <= 0 {
            return Err(CompositeError::Parse(
                "alert frequency must be positive".to_string(),
            ));
        }
        return condition
            .frequency
            .checked_mul(stale_k)
            .and_then(|seconds| seconds.checked_mul(1_000_000))
            .and_then(|window| level_at.checked_add(window))
            .ok_or_else(|| CompositeError::Parse("freshness deadline overflow".to_string()));
    }

    let schedule = cached_schedule(&condition.cron)?;
    let configured_timezone = condition
        .timezone
        .as_deref()
        .and_then(|timezone| timezone.parse::<Tz>().ok());
    let legacy_timezone = FixedOffset::east_opt(
        legacy_tz_offset
            .checked_mul(60)
            .ok_or_else(|| CompositeError::Parse("legacy timezone offset overflow".to_string()))?,
    );
    if configured_timezone.is_none() && legacy_timezone.is_none() {
        return Err(CompositeError::Parse("invalid alert timezone".to_string()));
    }

    let mut cursor = level_at;
    for _ in 0..stale_k {
        let anchor = chrono::DateTime::<Utc>::from_timestamp_micros(cursor)
            .ok_or_else(|| CompositeError::Parse("invalid freshness timestamp".to_string()))?;
        let offset = configured_timezone
            .as_ref()
            .map(|timezone| anchor.with_timezone(timezone).offset().fix())
            .or(legacy_timezone)
            .ok_or_else(|| CompositeError::Parse("invalid alert timezone".to_string()))?;
        cursor = schedule
            .after(&anchor.with_timezone(&offset))
            .next()
            .map(|next| next.timestamp_micros())
            .ok_or_else(|| CompositeError::Parse("cron has no future occurrence".to_string()))?;
    }
    Ok(cursor)
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
    fn preflight(
        expr: &CompositeExpr,
        states: &HashMap<String, ChildState>,
    ) -> Result<(), CompositeError> {
        match expr {
            CompositeExpr::Child(id) => states
                .contains_key(id)
                .then_some(())
                .ok_or_else(|| CompositeError::UnknownChild(id.clone())),
            CompositeExpr::And(left, right) | CompositeExpr::Or(left, right) => {
                preflight(left, states)?;
                preflight(right, states)
            }
            CompositeExpr::Not(inner) => preflight(inner, states),
        }
    }

    preflight(expr, states)?;
    evaluate_preflighted(expr, states, warning_counts_as_firing, stale_policy, now)
}

fn evaluate_preflighted(
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
            !evaluate_preflighted(inner, states, warning_counts_as_firing, stale_policy, now)?
        }
        CompositeExpr::And(a, b) => {
            evaluate_preflighted(a, states, warning_counts_as_firing, stale_policy, now)?
                && evaluate_preflighted(b, states, warning_counts_as_firing, stale_policy, now)?
        }
        CompositeExpr::Or(a, b) => {
            evaluate_preflighted(a, states, warning_counts_as_firing, stale_policy, now)?
                || evaluate_preflighted(b, states, warning_counts_as_firing, stale_policy, now)?
        }
    })
}

/// Evaluate an expression over precomputed per-child truth values. The caller
/// has already resolved staleness/policy against each child's *schedule-aware*
/// deadline; this only combines the booleans by operator precedence. It must
/// not re-derive staleness from cadence, or a cron child (whose cadence is a
/// placeholder) would diverge from the diagnostics the caller computed.
pub fn evaluate_truths(expr: &CompositeExpr, truths: &HashMap<String, bool>) -> bool {
    match expr {
        CompositeExpr::Child(id) => truths[id],
        CompositeExpr::And(left, right) => {
            evaluate_truths(left, truths) && evaluate_truths(right, truths)
        }
        CompositeExpr::Or(left, right) => {
            evaluate_truths(left, truths) || evaluate_truths(right, truths)
        }
        CompositeExpr::Not(inner) => !evaluate_truths(inner, truths),
    }
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

/// Reject reference cycles and over-deep nesting at write time (C-4, D6).
///
/// Detected on write, never at evaluation: a cycle discovered mid-evaluation
/// would be an infinite loop in the scheduler.
pub fn validate_no_cycle(
    composite_id: &str,
    children: &[String],
    existing: &HashMap<String, Vec<String>>,
) -> Result<(), CompositeError> {
    let mut candidate = existing.clone();
    candidate.insert(composite_id.to_string(), children.to_vec());

    fn visit(
        id: &str,
        graph: &HashMap<String, Vec<String>>,
        visiting: &mut Vec<String>,
        complete: &mut HashSet<String>,
    ) -> Result<(), CompositeError> {
        if complete.contains(id) || !graph.contains_key(id) {
            return Ok(());
        }
        if let Some(position) = visiting.iter().position(|entry| entry == id) {
            let mut cycle = visiting[position..].to_vec();
            if cycle.len() > 1 {
                cycle.push(id.to_string());
            }
            return Err(CompositeError::Cycle(cycle));
        }
        visiting.push(id.to_string());
        for child in graph.get(id).into_iter().flatten() {
            visit(child, graph, visiting, complete)?;
        }
        visiting.pop();
        complete.insert(id.to_string());
        Ok(())
    }

    let mut complete = HashSet::new();
    for id in candidate.keys() {
        visit(id, &candidate, &mut Vec::new(), &mut complete)?;
    }

    fn candidate_depth(
        id: &str,
        graph: &HashMap<String, Vec<String>>,
        memo: &mut HashMap<String, usize>,
    ) -> usize {
        if let Some(depth) = memo.get(id) {
            return *depth;
        }
        let depth = match graph.get(id) {
            None => 0,
            Some(children) => {
                1 + children
                    .iter()
                    .map(|child| candidate_depth(child, graph, memo))
                    .max()
                    .unwrap_or(0)
            }
        };
        memo.insert(id.to_string(), depth);
        depth
    }

    let mut memo = HashMap::new();
    if candidate
        .keys()
        .any(|id| candidate_depth(id, &candidate, &mut memo) > MAX_DEPTH)
    {
        return Err(CompositeError::TooDeep { max: MAX_DEPTH });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use svix_ksuid::{Ksuid, KsuidLike as _};

    use crate::meta::alerts::{
        FrequencyType, TriggerCondition,
        composite::{
            ChildState, CompositeError, CompositeExpr, StaleChildPolicy,
            alert_stale_deadline_micros, canonical_expression, collect_references, evaluate_expr,
            parse_expr, validate_children, validate_no_cycle,
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

    fn child_ids(count: usize) -> Vec<String> {
        (0..count)
            .map(|_| Ksuid::new(None, None).to_string())
            .collect()
    }

    fn id_expr(ids: &[String], operator: &str) -> String {
        ids.iter()
            .map(|id| format!("{{{id}}}"))
            .collect::<Vec<_>>()
            .join(operator)
    }

    fn child_expr(name: &str) -> CompositeExpr {
        CompositeExpr::Child(name.to_string())
    }

    fn cron_condition(cron: &str, timezone: Option<&str>) -> TriggerCondition {
        TriggerCondition {
            frequency_type: FrequencyType::Cron,
            cron: cron.to_string(),
            timezone: timezone.map(str::to_string),
            align_time: false,
            ..Default::default()
        }
    }

    fn ordinary_kth_cron_occurrence(
        condition: &TriggerCondition,
        legacy_tz_offset: i32,
        start: i64,
        k: usize,
    ) -> i64 {
        (0..k).fold(start, |cursor, _| {
            condition
                .get_next_trigger_time(false, legacy_tz_offset, false, Some(cursor))
                .expect("ordinary scheduler must find the next occurrence")
        })
    }

    // ── Expression parsing ──────────────────────────────────────────────────

    #[test]
    fn test_parse_single_child() {
        let id = child_ids(1).remove(0);
        let e = parse_expr(&format!("{{{id}}}")).unwrap();
        assert_eq!(e, CompositeExpr::Child(id));
    }

    #[test]
    fn test_parse_and_or_not() {
        let ids = child_ids(3);
        assert!(parse_expr(&id_expr(&ids[..2], " && ")).is_ok());
        assert!(parse_expr(&id_expr(&ids[..2], " || ")).is_ok());
        assert!(parse_expr(&format!("!{{{}}}", ids[0])).is_ok());
        assert!(
            parse_expr(&format!(
                "({{{}}} && {{{}}}) || !{{{}}}",
                ids[0], ids[1], ids[2]
            ))
            .is_ok()
        );
    }

    #[test]
    fn test_parse_rejects_malformed_expressions() {
        let ids = child_ids(2);
        for bad in [
            format!("{{{}}} &&", ids[0]),
            format!("&& {{{}}}", ids[1]),
            format!("({{{}}} && {{{}}}", ids[0], ids[1]),
            format!("{{{}}} {{{}}}", ids[0], ids[1]),
            String::new(),
            format!("{{{}}} && && {{{}}}", ids[0], ids[1]),
            "!".to_string(),
        ] {
            assert!(
                parse_expr(&bad).is_err(),
                "expression {bad:?} must be rejected"
            );
        }
    }

    /// The stored/API grammar is deliberately narrower than the old UI test
    /// grammar: an operand is exactly one brace-wrapped, parseable KSUID.
    /// Names, bare IDs, partial braces, extra braces, and a KSUID with trailing
    /// text would make identity rename-sensitive or make normalization
    /// ambiguous and must be rejected by the parser itself.
    #[test]
    fn parser_accepts_only_brace_wrapped_ksuid_operands() {
        let ids = child_ids(2);
        assert!(parse_expr(&id_expr(&ids, " && ")).is_ok());

        for invalid in [
            format!("{} && {{{}}}", ids[0], ids[1]),
            format!("{{{}}} && {}", ids[0], ids[1]),
            format!("{{{{{}}}}} && {{{}}}", ids[0], ids[1]),
            format!("{{{}}}suffix && {{{}}}", ids[0], ids[1]),
            format!("{{not-a-ksuid}} && {{{}}}", ids[1]),
            "{high_error_rate} && {high_latency}".to_string(),
            format!("{{}} && {{{}}}", ids[1]),
        ] {
            assert!(
                parse_expr(&invalid).is_err(),
                "non-ID operand grammar was accepted: {invalid:?}"
            );
        }
    }

    /// The limit is bytes, not Unicode scalar values. Whitespace is legal, so
    /// these fixtures hold the semantic expression constant while probing the
    /// exact 4096/4097 boundary and a multi-byte-whitespace bypass.
    #[test]
    fn expression_size_limit_is_exactly_four_kibibytes() {
        const MAX: usize = 4 * 1024;
        let ids = child_ids(2);
        let compact = id_expr(&ids, "&&");
        let at_limit = format!("{compact}{}", " ".repeat(MAX - compact.len()));
        assert_eq!(at_limit.len(), MAX);
        assert!(parse_expr(&at_limit).is_ok(), "4096 bytes is permitted");

        let over_limit = format!("{at_limit} ");
        assert_eq!(over_limit.len(), MAX + 1);
        assert!(parse_expr(&over_limit).is_err(), "4097 bytes must fail");

        let em_space = '\u{2003}';
        let unicode_over = format!("{compact}{}", em_space.to_string().repeat(1400));
        assert!(unicode_over.chars().count() < MAX);
        assert!(unicode_over.len() > MAX);
        assert!(
            parse_expr(&unicode_over).is_err(),
            "the byte limit must not be implemented as chars().count()"
        );
    }

    #[test]
    fn canonical_formatter_collects_references_in_ast_order_and_round_trips() {
        let ids = child_ids(3);
        let source = format!(
            " ( {{{}}} || ! ( {{{}}} ) ) && {{{}}} ",
            ids[0], ids[1], ids[2]
        );
        let parsed = parse_expr(&source).unwrap();

        assert_eq!(collect_references(&parsed).unwrap(), ids);
        let canonical = canonical_expression(&parsed);
        assert_eq!(
            canonical,
            format!("(({{{}}} || (!{{{}}})) && {{{}}})", ids[0], ids[1], ids[2])
        );
        assert_eq!(parse_expr(&canonical).unwrap(), parsed);
        assert_eq!(
            canonical_expression(&parse_expr(&canonical).unwrap()),
            canonical
        );
    }

    #[test]
    fn reference_collection_rejects_a_repeated_operand_before_persistence() {
        let ids = child_ids(2);
        let parsed =
            parse_expr(&format!("{{{0}}} && ({{{1}}} || !{{{0}}})", ids[0], ids[1])).unwrap();
        assert_eq!(
            collect_references(&parsed).unwrap_err(),
            CompositeError::DuplicateChild(ids[0].clone())
        );
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
        let ids = child_ids(3);
        let states = states(&[
            (&ids[0], fresh(AlertLevel::Critical)),
            (&ids[1], fresh(AlertLevel::Ok)),
            (&ids[2], fresh(AlertLevel::Ok)),
        ]);
        let e = parse_expr(&format!(
            "{{{}}} || {{{}}} && {{{}}}",
            ids[0], ids[1], ids[2]
        ))
        .unwrap();
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
        let ids = child_ids(2);
        let s = states(&[
            (&ids[0], fresh(AlertLevel::Critical)),
            (&ids[1], fresh(AlertLevel::Ok)),
        ]);
        let e = parse_expr(&format!("!{{{}}} && {{{}}}", ids[0], ids[1])).unwrap();
        assert!(
            !evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap(),
            "must be false; a true result means NOT was applied to the whole AND"
        );
    }

    #[test]
    fn test_parentheses_override_precedence() {
        let ids = child_ids(3);
        let states = states(&[
            (&ids[0], fresh(AlertLevel::Critical)),
            (&ids[1], fresh(AlertLevel::Ok)),
            (&ids[2], fresh(AlertLevel::Ok)),
        ]);
        // (a || b) && c  =>  true && false => false
        let e = parse_expr(&format!(
            "({{{}}} || {{{}}}) && {{{}}}",
            ids[0], ids[1], ids[2]
        ))
        .unwrap();
        assert!(!evaluate_expr(&e, &states, true, StaleChildPolicy::UseLastState, NOW).unwrap());
    }

    // ── C-3: child truth mapping ────────────────────────────────────────────

    #[test]
    fn test_critical_child_is_true() {
        let s = states(&[("a", fresh(AlertLevel::Critical))]);
        let e = child_expr("a");
        assert!(evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap());
    }

    #[test]
    fn test_ok_child_is_false() {
        let s = states(&[("a", fresh(AlertLevel::Ok))]);
        let e = child_expr("a");
        assert!(!evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap());
    }

    #[test]
    fn test_no_data_child_is_false_for_both_warning_modes() {
        let s = states(&[("a", fresh(AlertLevel::NoData))]);
        let e = child_expr("a");
        for warning_counts_as_firing in [true, false] {
            assert!(
                !evaluate_expr(
                    &e,
                    &s,
                    warning_counts_as_firing,
                    StaleChildPolicy::UseLastState,
                    NOW,
                )
                .unwrap()
            );
        }
    }

    /// D5: default is that Warning counts as firing.
    #[test]
    fn test_warning_child_truth_follows_the_flag() {
        let s = states(&[("a", fresh(AlertLevel::Warning))]);
        let e = child_expr("a");

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
    fn stale_child_policy_storage_ids_and_wire_names_are_append_only() {
        for (policy, storage_id, wire) in [
            (StaleChildPolicy::UseLastState, 0_i16, "use_last_state"),
            (StaleChildPolicy::TreatAsFalse, 1_i16, "treat_as_false"),
            (StaleChildPolicy::TreatAsTrue, 2_i16, "treat_as_true"),
        ] {
            assert_eq!(policy as i16, storage_id);
            assert_eq!(
                serde_json::to_string(&policy).unwrap(),
                format!(r#""{wire}""#)
            );
            assert_eq!(
                serde_json::from_str::<StaleChildPolicy>(&format!(r#""{wire}""#)).unwrap(),
                policy
            );
        }
    }

    #[test]
    fn test_negation_inverts_child_truth() {
        let s = states(&[("a", fresh(AlertLevel::Ok))]);
        let e = CompositeExpr::Not(Box::new(child_expr("a")));
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
        let e = CompositeExpr::Or(
            Box::new(CompositeExpr::And(
                Box::new(child_expr("disk_full")),
                Box::new(child_expr("high_latency")),
            )),
            Box::new(child_expr("db_down")),
        );
        assert!(evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap());
    }

    // ── §6.4: stale-child policy ────────────────────────────────────────────

    #[test]
    fn test_stale_child_use_last_state_keeps_its_truth() {
        let s = states(&[("a", stale(AlertLevel::Critical))]);
        let e = child_expr("a");
        assert!(
            evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap(),
            "default policy trusts the frozen state"
        );
    }

    #[test]
    fn test_stale_child_treat_as_false() {
        let s = states(&[("a", stale(AlertLevel::Critical))]);
        let e = child_expr("a");
        assert!(!evaluate_expr(&e, &s, true, StaleChildPolicy::TreatAsFalse, NOW).unwrap());
    }

    #[test]
    fn test_stale_child_treat_as_true_supports_heartbeat_patterns() {
        let s = states(&[("a", stale(AlertLevel::Ok))]);
        let e = child_expr("a");
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
        let e = child_expr("a");

        assert!(!evaluate_expr(&e, &s, true, StaleChildPolicy::TreatAsFalse, NOW).unwrap());
        assert!(evaluate_expr(&e, &s, true, StaleChildPolicy::TreatAsTrue, NOW).unwrap());
        assert!(
            !evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap(),
            "no last state to use → falls back to false rather than panicking"
        );
    }

    #[test]
    fn no_data_invokes_stale_policy_only_after_its_deadline() {
        let fresh_no_data = states(&[("a", fresh(AlertLevel::NoData))]);
        let stale_no_data = states(&[("a", stale(AlertLevel::NoData))]);
        let e = child_expr("a");

        assert!(
            !evaluate_expr(&e, &fresh_no_data, true, StaleChildPolicy::TreatAsTrue, NOW,).unwrap()
        );
        assert!(
            evaluate_expr(&e, &stale_no_data, true, StaleChildPolicy::TreatAsTrue, NOW,).unwrap()
        );
    }

    #[test]
    fn exact_stale_deadline_is_still_fresh_and_one_microsecond_later_is_stale() {
        let at = NOW - 180_000_000;
        let s = states(&[(
            "a",
            ChildState {
                level: Some(AlertLevel::Critical),
                level_at: Some(at),
                frequency_secs: 60,
            },
        )]);
        let e = child_expr("a");

        assert!(evaluate_expr(&e, &s, true, StaleChildPolicy::TreatAsFalse, NOW,).unwrap());
        assert!(!evaluate_expr(&e, &s, true, StaleChildPolicy::TreatAsFalse, NOW + 1,).unwrap());
    }

    #[test]
    fn fixed_frequency_deadline_uses_checked_time_math() {
        let frequency = TriggerCondition {
            frequency_type: FrequencyType::Minutes,
            frequency: 60,
            ..Default::default()
        };
        assert_eq!(
            alert_stale_deadline_micros(1_000_000, &frequency, 0, 3).unwrap(),
            181_000_000
        );

        assert!(
            alert_stale_deadline_micros(i64::MAX - 1, &frequency, 0, 3).is_err(),
            "overflow is an evaluation error, never a saturated deadline"
        );
        for invalid in [0, -1] {
            let condition = TriggerCondition {
                frequency_type: FrequencyType::Minutes,
                frequency: invalid,
                ..Default::default()
            };
            assert!(alert_stale_deadline_micros(0, &condition, 0, 3).is_err());
        }
    }

    #[test]
    fn cron_deadline_is_the_kth_occurrence_not_k_times_the_first_gap() {
        use chrono::{TimeZone as _, Utc};

        // Friday at 09:00 UTC. The next three weekday occurrences are Monday,
        // Tuesday, Wednesday; multiplying Friday->Monday by three lands on a
        // Sunday and is observably wrong.
        let level_at = Utc
            .with_ymd_and_hms(2026, 8, 7, 9, 0, 0)
            .unwrap()
            .timestamp_micros();
        let expected = Utc
            .with_ymd_and_hms(2026, 8, 12, 9, 0, 0)
            .unwrap()
            .timestamp_micros();
        let condition = cron_condition("0 0 9 * * Mon-Fri", Some("UTC"));

        assert_eq!(
            alert_stale_deadline_micros(level_at, &condition, 0, 3).unwrap(),
            expected
        );
    }

    #[test]
    fn cron_deadline_matches_ordinary_scheduler_across_dst() {
        use chrono::{TimeZone as _, Utc};

        let level_at = Utc
            .with_ymd_and_hms(2026, 3, 7, 17, 0, 0)
            .unwrap()
            .timestamp_micros();
        let condition = cron_condition("0 0 9 * * *", Some("America/Los_Angeles"));
        let ordinary = ordinary_kth_cron_occurrence(&condition, 0, level_at, 3);

        assert_eq!(
            alert_stale_deadline_micros(level_at, &condition, 0, 3).unwrap(),
            ordinary,
            "composite freshness and ordinary scheduling must share DST rules"
        );
    }

    #[test]
    fn cron_deadline_matches_legacy_offset_only_scheduler() {
        use chrono::{TimeZone as _, Utc};

        let level_at = Utc
            .with_ymd_and_hms(2026, 8, 7, 3, 30, 0)
            .unwrap()
            .timestamp_micros();
        let condition = cron_condition("0 0 9 * * *", None);
        let legacy_offset_minutes = 330;
        let ordinary = ordinary_kth_cron_occurrence(&condition, legacy_offset_minutes, level_at, 3);

        assert_eq!(
            alert_stale_deadline_micros(level_at, &condition, legacy_offset_minutes, 3,).unwrap(),
            ordinary,
            "pre-timezone alerts remain valid children"
        );
    }

    #[test]
    fn cron_deadline_reports_invalid_schedule_timezone_and_search_exhaustion() {
        let invalid_cron = cron_condition("definitely not cron", Some("UTC"));
        assert!(alert_stale_deadline_micros(0, &invalid_cron, 0, 3).is_err());

        let invalid_zone_and_offset = cron_condition("0 0 9 * * *", Some("Mars/Olympus"));
        assert!(alert_stale_deadline_micros(0, &invalid_zone_and_offset, 100_000, 3).is_err());

        let no_future_occurrence = cron_condition("0 0 0 1 1 * 2025", Some("UTC"));
        assert!(
            alert_stale_deadline_micros(1_800_000_000_000_000, &no_future_occurrence, 0, 3)
                .is_err()
        );
    }

    #[test]
    fn test_missing_child_state_is_an_error_not_a_silent_false() {
        // A referenced child with no entry at all means the caller assembled
        // the state map wrongly. Failing loudly beats a silent false.
        let s = states(&[("a", fresh(AlertLevel::Critical))]);
        let e = CompositeExpr::And(Box::new(child_expr("a")), Box::new(child_expr("missing")));
        let err = evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap_err();
        assert_eq!(err, CompositeError::UnknownChild("missing".to_string()));
    }

    #[test]
    fn evaluation_preflights_missing_operands_even_when_or_short_circuits() {
        let s = states(&[("present", fresh(AlertLevel::Critical))]);
        let e = CompositeExpr::Or(
            Box::new(child_expr("present")),
            Box::new(child_expr("missing")),
        );
        assert_eq!(
            evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap_err(),
            CompositeError::UnknownChild("missing".to_string())
        );
    }

    #[test]
    fn evaluation_preflights_missing_operands_even_when_and_short_circuits() {
        let s = states(&[("present", fresh(AlertLevel::Ok))]);
        let e = CompositeExpr::And(
            Box::new(child_expr("present")),
            Box::new(child_expr("missing")),
        );
        assert_eq!(
            evaluate_expr(&e, &s, true, StaleChildPolicy::UseLastState, NOW).unwrap_err(),
            CompositeError::UnknownChild("missing".to_string())
        );
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

    #[test]
    fn candidate_graph_validation_rejects_a_cycle_outside_the_edited_subtree() {
        // The whole organization graph is the candidate. A pre-existing
        // corrupt B<->C cycle cannot be ignored merely because this edit is A.
        let mut existing = HashMap::new();
        existing.insert("b".to_string(), vec!["c".to_string()]);
        existing.insert("c".to_string(), vec!["b".to_string()]);

        let err = validate_no_cycle("a", &["plain".to_string()], &existing).unwrap_err();
        assert!(matches!(err, CompositeError::Cycle(_)));
    }

    #[test]
    fn candidate_graph_validation_rechecks_ancestor_depth_after_an_edit() {
        // Before the edit: parent(depth 2) -> edited(depth 1) -> plain.
        // Candidate edit: edited -> nested(depth 1) -> plain, making parent
        // depth 3 even though the edited node itself remains at the legal
        // depth 2. Validating only the edited subtree misses this.
        let mut existing = HashMap::new();
        existing.insert("parent".to_string(), vec!["edited".to_string()]);
        existing.insert("edited".to_string(), vec!["plain-a".to_string()]);
        existing.insert("nested".to_string(), vec!["plain-b".to_string()]);

        assert_eq!(
            validate_no_cycle("edited", &["nested".to_string()], &existing).unwrap_err(),
            CompositeError::TooDeep { max: 2 }
        );
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
