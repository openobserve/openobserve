// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Storage-independent composite evaluation.
//!
//! The scheduler/service layer owns graph locking, batch loading, claim epoch
//! fencing and delivery. This module owns the deterministic part of a run so
//! production adapters and deterministic contract tests exercise one path.

use std::collections::{HashMap, HashSet};

use config::meta::alerts::{
    composite::{
        ChildState, CompositeError, CompositeExpr, StaleChildPolicy, evaluate_expr, parse_expr,
        result_level,
    },
    level::AlertLevel,
};

/// The already-loaded slice of a child definition/state needed by evaluation.
#[derive(Clone, Debug, PartialEq)]
pub struct CompositeStateInput {
    pub alert_id: String,
    pub name: String,
    pub alert_type: String,
    pub enabled: bool,
    pub level: Option<AlertLevel>,
    pub level_at: Option<i64>,
    pub effective_cadence_seconds: i64,
    /// Absolute deadline when schedule-aware derivation is available (cron,
    /// DST, or a configured stale multiplier). Tests/simple interval callers
    /// may leave this unset and use the cadence fallback.
    pub stale_deadline: Option<i64>,
}

/// Per-child diagnostics returned to preview/detail and notification building.
#[derive(Clone, Debug, PartialEq)]
pub struct EvaluatedChild {
    pub alert_id: String,
    pub name: String,
    pub alert_type: String,
    pub enabled: bool,
    pub level: Option<AlertLevel>,
    pub level_at: Option<i64>,
    pub stale_deadline: i64,
    pub stale: bool,
    pub truth: bool,
}

/// Successful deterministic evaluation result.
#[derive(Clone, Debug, PartialEq)]
pub struct CompositeEvaluation {
    pub result: bool,
    pub level: AlertLevel,
    pub children: Vec<EvaluatedChild>,
    pub next_stale_deadline: Option<i64>,
}

/// Evaluation errors preserve the caller's durable level and never authorize
/// delivery. The service maps these stable reasons to `RunOutcome::Error`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EvaluationFailure {
    InvalidExpression(String),
    ChildMissing(String),
    DuplicateInput(String),
    InvalidCadence(String),
}

impl std::fmt::Display for EvaluationFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidExpression(message) => {
                write!(f, "invalid composite expression: {message}")
            }
            Self::ChildMissing(id) => write!(f, "composite child {id} is missing"),
            Self::DuplicateInput(id) => write!(f, "composite child {id} was loaded twice"),
            Self::InvalidCadence(id) => write!(f, "composite child {id} has invalid cadence"),
        }
    }
}

impl std::error::Error for EvaluationFailure {}

/// Stateless production evaluator. All children are preflighted before the
/// expression is evaluated, so boolean short-circuiting cannot hide a corrupt
/// reference and the service can batch-load exactly once.
pub struct CompositeEvaluator;

impl CompositeEvaluator {
    pub fn evaluate(
        expression: &str,
        children: Vec<CompositeStateInput>,
        warning_counts_as_firing: bool,
        stale_policy: StaleChildPolicy,
        now: i64,
    ) -> Result<CompositeEvaluation, EvaluationFailure> {
        let parsed = parse_expr(expression)
            .map_err(|error| EvaluationFailure::InvalidExpression(error.to_string()))?;
        let references = references_in_order(&parsed)?;

        let mut inputs = HashMap::with_capacity(children.len());
        for child in children {
            let id = child.alert_id.clone();
            if child.effective_cadence_seconds <= 0 {
                return Err(EvaluationFailure::InvalidCadence(id));
            }
            if inputs.insert(id.clone(), child).is_some() {
                return Err(EvaluationFailure::DuplicateInput(id));
            }
        }
        for reference in &references {
            if !inputs.contains_key(reference) {
                return Err(EvaluationFailure::ChildMissing(reference.clone()));
            }
        }
        if inputs.len() != references.len() {
            return Err(EvaluationFailure::InvalidExpression(
                "expression and child index do not match".to_string(),
            ));
        }

        let mut states = HashMap::with_capacity(references.len());
        let mut diagnostics = Vec::with_capacity(references.len());
        let mut next_stale_deadline: Option<i64> = None;
        for reference in references {
            let input = inputs
                .get(&reference)
                .expect("reference presence was preflighted");
            let stale_deadline = match (input.level_at, input.stale_deadline) {
                (Some(_), Some(deadline)) => deadline,
                (Some(level_at), None) => input
                    .effective_cadence_seconds
                    .checked_mul(3)
                    .and_then(|seconds| seconds.checked_mul(1_000_000))
                    .and_then(|window| level_at.checked_add(window))
                    .ok_or_else(|| EvaluationFailure::InvalidCadence(reference.clone()))?,
                (None, _) => now.saturating_sub(1),
            };
            let stale = input.level_at.is_none() || now > stale_deadline;
            let truth = if stale {
                match stale_policy {
                    StaleChildPolicy::UseLastState => {
                        level_truth(input.level, warning_counts_as_firing)
                    }
                    StaleChildPolicy::TreatAsFalse => false,
                    StaleChildPolicy::TreatAsTrue => true,
                }
            } else {
                level_truth(input.level, warning_counts_as_firing)
            };
            if !stale {
                next_stale_deadline = Some(
                    next_stale_deadline
                        .map_or(stale_deadline, |current| current.min(stale_deadline)),
                );
            }
            states.insert(
                reference.clone(),
                ChildState {
                    level: input.level,
                    level_at: input.level_at,
                    frequency_secs: input.effective_cadence_seconds,
                },
            );
            diagnostics.push(EvaluatedChild {
                alert_id: reference,
                name: input.name.clone(),
                alert_type: input.alert_type.clone(),
                enabled: input.enabled,
                level: input.level,
                level_at: input.level_at,
                stale_deadline,
                stale,
                truth,
            });
        }

        let result = evaluate_expr(
            &parsed,
            &states,
            warning_counts_as_firing,
            stale_policy,
            now,
        )
        .map_err(map_evaluation_error)?;
        Ok(CompositeEvaluation {
            result,
            level: result_level(result),
            children: diagnostics,
            next_stale_deadline,
        })
    }
}

fn references_in_order(expression: &CompositeExpr) -> Result<Vec<String>, EvaluationFailure> {
    fn visit(
        expression: &CompositeExpr,
        seen: &mut HashSet<String>,
        ordered: &mut Vec<String>,
    ) -> Result<(), EvaluationFailure> {
        match expression {
            CompositeExpr::Child(id) => {
                if !seen.insert(id.clone()) {
                    return Err(EvaluationFailure::InvalidExpression(format!(
                        "child {id} is referenced more than once"
                    )));
                }
                ordered.push(id.clone());
            }
            CompositeExpr::And(left, right) | CompositeExpr::Or(left, right) => {
                visit(left, seen, ordered)?;
                visit(right, seen, ordered)?;
            }
            CompositeExpr::Not(inner) => visit(inner, seen, ordered)?,
        }
        Ok(())
    }

    let mut seen = HashSet::new();
    let mut ordered = Vec::new();
    visit(expression, &mut seen, &mut ordered)?;
    Ok(ordered)
}

fn level_truth(level: Option<AlertLevel>, warning_counts_as_firing: bool) -> bool {
    match level {
        Some(AlertLevel::Critical) => true,
        Some(AlertLevel::Warning) => warning_counts_as_firing,
        _ => false,
    }
}

fn map_evaluation_error(error: CompositeError) -> EvaluationFailure {
    match error {
        CompositeError::UnknownChild(id) => EvaluationFailure::ChildMissing(id),
        other => EvaluationFailure::InvalidExpression(other.to_string()),
    }
}
