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

//! Composite alert evaluation (scheduler side).
//!
//! This module is the CORE half of composite evaluation: it owns the IO/
//! orchestration (running each term's query via [`QueryConditionExt::
//! evaluate_scheduled`], bounded concurrency, per-tick time budget) because the
//! per-term evaluator lives in core. The PURE logic — the boolean expression
//! parser and three-valued (Kleene) evaluation — lives in the enterprise crate
//! (`o2_enterprise::enterprise::alerts::composite`). The whole module is
//! enterprise-gated: composites are an enterprise feature.
//!
//! See `designs/alerts/composite-alerts/UNIFIED-HARDENED-DESIGN.md` §2, §4.

use std::{collections::HashMap, time::Duration};

use config::meta::{
    alerts::{
        QueryCondition, TriggerCondition, TriggerEvalResults, alert::Alert,
        composite::{MAX_TERMS, OnErrorPolicy},
    },
    search::SearchEventType,
    stream::StreamType,
};
use futures::stream::{self, StreamExt};
use o2_enterprise::enterprise::alerts::composite::{self, TermState};
use serde_json::{Map, Value, json};

use super::{QueryConditionExt, composite_template::COMPOSITE_CONTEXT_KEY};

/// Fully-owned inputs for evaluating a single term, snapshotted from the spec so
/// the async fan-out captures no borrow of the parent `Alert`.
struct TermInput {
    name: String,
    synth_tc: TriggerCondition,
    query_condition: QueryCondition,
    stream_name: Option<String>,
    stream_type: StreamType,
}

/// Per-tick time budget for the whole term fan-out. Must be below the
/// scheduler's `ZO_ALERT_SCHEDULE_TIMEOUT` (90s) so an over-budget composite
/// resolves to a clean tri-state ERROR rather than being killed by the
/// watchdog mid-flight (§4.1 F12). On elapse the composite is ERROR — never a
/// partial fire.
const COMPOSITE_EVAL_TIMEOUT_SECS: u64 = 80;

/// A per-term notification to send when the composite fires: the term's
/// `on_term` destinations and the (composite-scoped) context rows to render.
pub struct OnTermSend {
    pub destinations: Vec<String>,
    pub rows: Vec<Map<String, Value>>,
}

/// The outcome the scheduler needs to rejoin the common alert tail.
pub struct CompositeSchedulerOutcome {
    /// A synthetic result reduced from the N term results. `data = Some(rows)`
    /// iff the composite fires (expression TRUE, or ERROR under a `Notify`
    /// policy); `data = None` otherwise. Feeds the existing
    /// fire/silence/dedup/grouping/incident/history tail unchanged.
    pub eval: TriggerEvalResults,
    /// `Some(summary)` iff the expression evaluated to Kleene ERROR — recorded
    /// in the trigger history so the failure is never silent (§2.2). Present
    /// regardless of the `on_error` policy.
    pub error_summary: Option<String>,
    /// Per-term `on_term` notifications to send when the composite fires. Only
    /// TRUE terms with configured `on_term` destinations appear here. The
    /// scheduler sends these on the fire path so they share the composite's
    /// silence window (a silenced composite's tick never runs).
    pub on_term_sends: Vec<OnTermSend>,
}

/// The reduced per-term evaluation, kept for building the notification context.
struct TermsEvaluation {
    states: HashMap<String, TermState>,
    row_counts: HashMap<String, usize>,
    /// The term's rendered scalar value: the aggregate value when the query is
    /// an aggregation, else the row count. Used for `{a.value}`.
    values: HashMap<String, String>,
    errors: HashMap<String, String>,
    /// The raw rows returned by each firing term, for `{a.rows[N].field}`.
    rows: HashMap<String, Vec<Map<String, Value>>>,
    end_time: i64,
    query_took: Option<i64>,
}

/// Evaluates a composite alert for one scheduler tick and reduces the N term
/// results into a single [`CompositeSchedulerOutcome`].
///
/// Side effect: rewrites `alert.destinations` to the composite's
/// `notify.on_composite` set so the existing notification tail fires to the
/// right destinations. (Per-term `on_term` notifications + namespaced templates
/// are a later step.)
pub async fn evaluate_composite_for_scheduler(
    org_id: &str,
    alert: &mut Alert,
    window: (Option<i64>, i64),
    trace_id: Option<String>,
) -> Result<CompositeSchedulerOutcome, anyhow::Error> {
    let (terms, ast) = run_terms(org_id, alert, window, trace_id).await?;

    // Snapshot the notification config before mutating `alert.destinations`.
    let (on_composite, on_error) = {
        let spec = alert.composite.as_ref().ok_or_else(|| {
            anyhow::anyhow!("evaluate_composite_for_scheduler on non-composite alert")
        })?;
        (spec.notify.on_composite.clone(), spec.on_error)
    };

    let result = composite::eval(&ast, &terms.states);

    // Route composite notifications to the on_composite destination set.
    alert.destinations = on_composite;

    let context_rows = build_context_rows(alert, &terms, result);

    // Per-term on_term notifications: only TRUE terms with configured
    // destinations, sent by the scheduler on the fire path (§4.1).
    let on_term_sends = build_on_term_sends(alert, &terms, &context_rows);

    let (data, error_summary) = match result {
        TermState::True => (Some(context_rows), None),
        TermState::False => (None, None),
        TermState::Error => {
            let summary = summarize_errors(&terms.errors);
            // Record the ERROR in history regardless; only fire under Notify.
            match on_error {
                OnErrorPolicy::Notify => (Some(context_rows), Some(summary)),
                OnErrorPolicy::Suppress => (None, Some(summary)),
            }
        }
    };

    Ok(CompositeSchedulerOutcome {
        eval: TriggerEvalResults {
            data,
            end_time: terms.end_time,
            query_took: terms.query_took,
        },
        error_summary,
        on_term_sends,
    })
}

/// The tri-state result of previewing a single term (no notification / no save).
#[derive(Debug, serde::Serialize)]
pub struct CompositeTermPreview {
    pub name: String,
    /// `"true" | "false" | "error"`.
    pub state: String,
    /// The scalar `{a.value}` — aggregate value or row count.
    pub value: String,
    pub count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The result of previewing a composite: each term's tri-state + the evaluated
/// composite result. Lets authors see the tri-state before saving (§8.3).
#[derive(Debug, serde::Serialize)]
pub struct CompositePreviewResult {
    /// `"true" | "false" | "error"`.
    pub result: String,
    pub expression: String,
    pub terms: Vec<CompositeTermPreview>,
}

/// Previews a composite alert over the given window WITHOUT firing notifications
/// or persisting anything: runs each term, computes the tri-states + Kleene
/// result, and returns them for the authoring UI (§8.3).
pub async fn preview_composite(
    org_id: &str,
    alert: &Alert,
    window: (Option<i64>, i64),
    trace_id: Option<String>,
) -> Result<CompositePreviewResult, anyhow::Error> {
    let (terms, ast) = run_terms(org_id, alert, window, trace_id).await?;
    let result = composite::eval(&ast, &terms.states);

    let spec = alert
        .composite
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("preview_composite on non-composite alert"))?;

    let term_previews = spec
        .terms
        .iter()
        .map(|term| {
            let name = &term.name;
            let st = terms.states.get(name).copied().unwrap_or(TermState::Error);
            let count = terms.row_counts.get(name).copied().unwrap_or(0);
            CompositeTermPreview {
                name: name.clone(),
                state: state_str(st).to_string(),
                value: terms
                    .values
                    .get(name)
                    .cloned()
                    .unwrap_or_else(|| count.to_string()),
                count,
                error: terms.errors.get(name).cloned(),
            }
        })
        .collect();

    Ok(CompositePreviewResult {
        result: state_str(result).to_string(),
        expression: spec.expression.clone(),
        terms: term_previews,
    })
}

/// Runs every term of a composite concurrently (bounded fan-out + per-tick time
/// budget, §4.1) and reduces the results into tri-states, returning the reduced
/// evaluation and the parsed expression AST. Shared by the scheduler and the
/// preview paths; borrows `alert` immutably and mutates nothing.
async fn run_terms(
    org_id: &str,
    alert: &Alert,
    window: (Option<i64>, i64),
    trace_id: Option<String>,
) -> Result<(TermsEvaluation, composite::Expr), anyhow::Error> {
    let period = alert.trigger_condition.period;
    let (start_time, end_time) = window;

    // Snapshot fully-owned per-term inputs up front so no borrow of `alert`
    // (via `spec`) is held across an `.await` — the scheduler runs this inside a
    // spawned task, which requires the future to own its captures.
    let (expression, term_inputs) = {
        let spec = alert
            .composite
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("run_terms on non-composite alert"))?;
        let inputs: Vec<TermInput> = spec
            .terms
            .iter()
            .map(|term| TermInput {
                name: term.name.clone(),
                synth_tc: TriggerCondition {
                    operator: term.operator,
                    threshold: term.threshold,
                    period,
                    ..Default::default()
                },
                query_condition: term.query_condition.clone(),
                stream_name: term.stream_name.clone(),
                stream_type: term.stream_type,
            })
            .collect();
        (spec.expression.clone(), inputs)
    };

    // Re-parse the (save-time-validated) expression into the eval AST.
    let ast = composite::parse(&expression)
        .map_err(|e| anyhow::anyhow!("invalid composite expression: {e}"))?;

    // Evaluate each term concurrently with a bounded fan-out (§4.1). Each term
    // reuses the standalone single-alert evaluator with a synthesized trigger
    // condition carrying ONLY {operator, threshold, period} — the parent's
    // shared window wins via `start_time`.
    let term_futures = term_inputs.into_iter().map(|input| {
        let org_id = org_id.to_string();
        let trace_id = trace_id.clone();
        async move {
            let res = input
                .query_condition
                .evaluate_scheduled(
                    &org_id,
                    input.stream_name.as_deref(),
                    input.stream_type,
                    &input.synth_tc,
                    (start_time, end_time),
                    Some(SearchEventType::Alerts),
                    None,
                    trace_id,
                )
                .await;
            (input.name, res)
        }
    });

    let collected = tokio::time::timeout(
        Duration::from_secs(COMPOSITE_EVAL_TIMEOUT_SECS),
        stream::iter(term_futures)
            .buffer_unordered(MAX_TERMS)
            .collect::<Vec<_>>(),
    )
    .await;

    let terms = match collected {
        Ok(results) => reduce_term_results(results, end_time),
        Err(_) => {
            // Budget exceeded → whole composite is ERROR (never a partial fire).
            // Empty states → every referenced term reads as ERROR under Kleene,
            // so the whole expression evaluates to ERROR.
            TermsEvaluation {
                states: HashMap::new(),
                row_counts: HashMap::new(),
                values: HashMap::new(),
                errors: HashMap::from([(
                    "*".to_string(),
                    format!("composite evaluation exceeded {COMPOSITE_EVAL_TIMEOUT_SECS}s budget"),
                )]),
                rows: HashMap::new(),
                end_time,
                query_took: None,
            }
        }
    };

    Ok((terms, ast))
}

/// Collects the per-term `on_term` notifications for TRUE terms that have
/// configured destinations. Each uses the same composite-scoped context rows,
/// so `on_term` templates can reference `{a.value}`/`{composite.result}` too.
fn build_on_term_sends(
    alert: &Alert,
    terms: &TermsEvaluation,
    context_rows: &[Map<String, Value>],
) -> Vec<OnTermSend> {
    let Some(spec) = alert.composite.as_ref() else {
        return Vec::new();
    };
    let mut sends = Vec::new();
    for (name, dests) in spec.notify.on_term.iter() {
        if dests.is_empty() {
            continue;
        }
        if terms.states.get(name).copied() == Some(TermState::True) {
            sends.push(OnTermSend {
                destinations: dests.clone(),
                rows: context_rows.to_vec(),
            });
        }
    }
    sends
}

/// Reduces raw per-term evaluation results into tri-states + bookkeeping.
fn reduce_term_results(
    results: Vec<(String, Result<TriggerEvalResults, anyhow::Error>)>,
    default_end_time: i64,
) -> TermsEvaluation {
    let mut states = HashMap::new();
    let mut row_counts = HashMap::new();
    let mut values = HashMap::new();
    let mut errors = HashMap::new();
    let mut term_rows: HashMap<String, Vec<Map<String, Value>>> = HashMap::new();
    let mut end_time = default_end_time;
    let mut query_took: Option<i64> = None;

    for (name, res) in results {
        match res {
            Ok(r) => {
                if let Some(took) = r.query_took {
                    query_took = Some(query_took.unwrap_or(0) + took);
                }
                if r.end_time > end_time {
                    end_time = r.end_time;
                }
                match r.data {
                    // Ok(data=Some) — threshold met → TRUE.
                    Some(rows) => {
                        row_counts.insert(name.clone(), rows.len());
                        values.insert(name.clone(), term_value(&rows));
                        term_rows.insert(name.clone(), rows);
                        states.insert(name, TermState::True);
                    }
                    // Ok(data=None) — clean, threshold not met → FALSE.
                    None => {
                        values.insert(name.clone(), "0".to_string());
                        states.insert(name, TermState::False);
                    }
                }
            }
            // Err(...) — query failed / partial / timeout → ERROR. Never coerce
            // to a boolean (§2.1).
            Err(e) => {
                errors.insert(name.clone(), e.to_string());
                states.insert(name, TermState::Error);
            }
        }
    }

    TermsEvaluation {
        states,
        row_counts,
        values,
        errors,
        rows: term_rows,
        end_time,
        query_took,
    }
}

/// The term's scalar `{a.value}`: the aggregate value (`alert_agg_value`) when
/// the query is an aggregation, else the row count.
fn term_value(rows: &[Map<String, Value>]) -> String {
    if let Some(agg) = rows.first().and_then(|r| r.get("alert_agg_value")) {
        match agg {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    } else {
        rows.len().to_string()
    }
}

/// Human-readable string form of a term/composite state, used in templates and
/// history (`{a.state}` / `{composite.result}` ∈ true|false|error, §6).
fn state_str(state: TermState) -> &'static str {
    match state {
        TermState::True => "true",
        TermState::False => "false",
        TermState::Error => "error",
    }
}

/// Builds a single synthetic context row from the composite/term states. This
/// is the "composite-level context row" that the downstream dedup/grouping/
/// incident/template paths operate on (§4.1 F5) — a composite has no single
/// unified term row set.
///
/// The row carries a nested `_composite` object consumed by the scoped template
/// resolver (§6) for `{a.value}`/`{a.state}`/`{a.rows[N].f}`/`{composite.result}`
/// tokens, plus a flat `alert_name` for the existing flat variables.
fn build_context_rows(
    alert: &Alert,
    terms: &TermsEvaluation,
    result: TermState,
) -> Vec<Map<String, Value>> {
    let mut row = Map::new();
    row.insert("alert_name".to_string(), json!(alert.name));

    let mut term_scopes = Map::new();
    if let Some(spec) = alert.composite.as_ref() {
        for term in &spec.terms {
            let name = &term.name;
            let st = terms.states.get(name).copied().unwrap_or(TermState::Error);
            let count = terms.row_counts.get(name).copied().unwrap_or(0);
            let value = terms
                .values
                .get(name)
                .cloned()
                .unwrap_or_else(|| count.to_string());
            let rows = terms
                .rows
                .get(name)
                .map(|rs| Value::Array(rs.iter().cloned().map(Value::Object).collect()))
                .unwrap_or_else(|| Value::Array(vec![]));
            let scope = json!({
                "value": value,
                "count": count,
                "state": state_str(st),
                "error": terms.errors.get(name).cloned(),
                "rows": rows,
            });
            term_scopes.insert(name.clone(), scope);
        }
    }

    let composite_ctx = json!({
        "result": state_str(result),
        "expression": alert
            .composite
            .as_ref()
            .map(|s| s.expression.clone())
            .unwrap_or_default(),
        "terms": Value::Object(term_scopes),
    });
    row.insert(COMPOSITE_CONTEXT_KEY.to_string(), composite_ctx);

    vec![row]
}

/// Joins per-term error messages into a single history summary.
fn summarize_errors(errors: &HashMap<String, String>) -> String {
    if errors.is_empty() {
        return "composite evaluation resulted in ERROR".to_string();
    }
    let mut parts: Vec<String> = errors
        .iter()
        .map(|(name, err)| format!("{name}: {err}"))
        .collect();
    parts.sort();
    format!("composite ERROR — {}", parts.join("; "))
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::composite::{
        CompositeNotify, CompositeSpec, CompositeTerm, TermSource,
    };

    use super::*;

    fn terms_eval(states: &[(&str, TermState)]) -> TermsEvaluation {
        let mut rows = HashMap::new();
        let mut host_row = Map::new();
        host_row.insert("host".to_string(), json!("node-1"));
        rows.insert("a".to_string(), vec![host_row]);
        TermsEvaluation {
            states: states.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            row_counts: HashMap::from([("a".to_string(), 5)]),
            values: HashMap::from([("a".to_string(), "5".to_string())]),
            errors: HashMap::from([("b".to_string(), "boom".to_string())]),
            rows,
            end_time: 100,
            query_took: Some(10),
        }
    }

    fn composite_alert() -> Alert {
        let term = |name: &str| CompositeTerm {
            name: name.to_string(),
            stream_type: config::meta::stream::StreamType::Logs,
            stream_name: Some("default".to_string()),
            query_condition: Default::default(),
            operator: config::meta::alerts::Operator::GreaterThanEquals,
            threshold: 1,
            source: TermSource::Inline,
            row_template: None,
        };
        let mut alert = Alert::default();
        alert.name = "checkout-degraded".to_string();
        alert.composite = Some(CompositeSpec {
            terms: vec![term("a"), term("b")],
            expression: "a && b".to_string(),
            notify: CompositeNotify {
                on_composite: vec!["pd".to_string()],
                on_term: Default::default(),
            },
            on_error: OnErrorPolicy::Suppress,
        });
        alert
    }

    #[test]
    fn test_build_context_rows() {
        let alert = composite_alert();
        let te = terms_eval(&[("a", TermState::True), ("b", TermState::Error)]);
        let rows = build_context_rows(&alert, &te, TermState::Error);
        assert_eq!(rows.len(), 1);
        let cx = &rows[0][COMPOSITE_CONTEXT_KEY];
        assert_eq!(cx["result"], json!("error"));
        assert_eq!(cx["expression"], json!("a && b"));
        assert_eq!(cx["terms"]["a"]["state"], json!("true"));
        assert_eq!(cx["terms"]["a"]["count"], json!(5));
        assert_eq!(cx["terms"]["a"]["value"], json!("5"));
        assert_eq!(cx["terms"]["a"]["rows"][0]["host"], json!("node-1"));
        assert_eq!(cx["terms"]["b"]["state"], json!("error"));
        assert_eq!(cx["terms"]["b"]["error"], json!("boom"));
        // The flat alert_name remains for the flat renderer.
        assert_eq!(rows[0]["alert_name"], json!("checkout-degraded"));
    }

    #[test]
    fn test_build_on_term_sends() {
        let mut alert = composite_alert();
        // Configure on_term for term `a` only.
        if let Some(spec) = alert.composite.as_mut() {
            spec.notify
                .on_term
                .insert("a".to_string(), vec!["slack".to_string()]);
        }
        let te = terms_eval(&[("a", TermState::True), ("b", TermState::False)]);
        let ctx = build_context_rows(&alert, &te, TermState::True);
        let sends = build_on_term_sends(&alert, &te, &ctx);
        assert_eq!(sends.len(), 1);
        assert_eq!(sends[0].destinations, vec!["slack".to_string()]);

        // A FALSE term with on_term dests produces no send.
        let te2 = terms_eval(&[("a", TermState::False), ("b", TermState::False)]);
        let sends2 = build_on_term_sends(&alert, &te2, &ctx);
        assert!(sends2.is_empty());
    }

    #[test]
    fn test_summarize_errors() {
        let errors = HashMap::from([
            ("b".to_string(), "boom".to_string()),
            ("c".to_string(), "bang".to_string()),
        ]);
        let s = summarize_errors(&errors);
        // Sorted, joined.
        assert_eq!(s, "composite ERROR — b: boom; c: bang");
    }

    #[test]
    fn test_reduce_term_results() {
        let results = vec![
            (
                "a".to_string(),
                Ok(TriggerEvalResults {
                    data: Some(vec![serde_json::Map::new(), serde_json::Map::new()]),
                    end_time: 200,
                    query_took: Some(7),
                }),
            ),
            (
                "b".to_string(),
                Ok(TriggerEvalResults {
                    data: None,
                    end_time: 150,
                    query_took: Some(3),
                }),
            ),
            (
                "c".to_string(),
                Err(anyhow::anyhow!("query failed")),
            ),
        ];
        let te = reduce_term_results(results, 100);
        assert_eq!(te.states["a"], TermState::True);
        assert_eq!(te.row_counts["a"], 2);
        assert_eq!(te.states["b"], TermState::False);
        assert_eq!(te.states["c"], TermState::Error);
        assert_eq!(te.errors["c"], "query failed");
        assert_eq!(te.end_time, 200);
        assert_eq!(te.query_took, Some(10));
    }
}
