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

//! Dry run of an unsaved alert at past check times: the scheduler's decisions, with no state
//! written and nothing sent.

use std::collections::{BTreeMap, HashMap};

use async_trait::async_trait;
use config::meta::{
    alerts::{
        FrequencyType, Operator, QueryType, TriggerEvalResults,
        alert::Alert,
        dispatch::{
            alert_level_delivery_applies, delivery_success_update, evaluates_through_silence,
            plan_dispatch, rows_by_group_key, rows_by_series_key,
        },
        grouping::{ClassifiedGroup, GroupClassification, group_key, plan_group_updates},
        level::{
            AlertLevel, DeliveryDecision, delivery_decision, is_multi_level,
            level_for_successful_evaluation, threshold_context,
        },
        recovery::{EpisodeInput, apply_episode, hold_firing_cycle, single_row_clear},
        state::{AlertState, ROLLUP_GROUP_KEY, apply_outcome},
    },
    search::{SearchEventContext, SearchEventType},
    self_reporting::usage::RunOutcome,
};
use futures::StreamExt;
use serde::Serialize;
use utoipa::ToSchema;

use super::{
    QueryConditionExt,
    scheduler::handlers::{holds_pending, single_row_repeats, starts_silence_window},
};

/// Most checks one request evaluates; past it the latest ones run.
pub const MAX_CHECKS: usize = 1_440;
/// How long one request may search before the oldest checks are dropped.
pub const DEADLINE: std::time::Duration = std::time::Duration::from_secs(60);
const MAX_GROUPS_PER_CHECK: usize = 100;
const MAX_NOTIFIED_AT: usize = 100;
const MAX_GROUPS_FIRED: usize = 20;
const MAX_DIAGNOSTIC_METRICS: usize = 5;
const CONCURRENT_CHECKS: usize = 8;
// Bounds the cron walk: a week of every-second occurrences.
const MAX_CRON_STEPS: usize = 7 * 86_400;
const DAY_MICROS: i64 = 24 * 3_600 * 1_000_000;
const MINUTE_MICROS: i64 = 60 * 1_000_000;
// apply_outcome rejects an empty alert id; the dry run state never leaves memory.
const DRY_RUN_ID: &str = "dry-run";
/// What a check shows for a failure that is not the user's query; the full error is logged.
const CHECK_FAILED: &str = "The search failed on the server. Try again; if it keeps failing, ask your administrator to check the server logs.";

/// When the checks run: explicit times, or the alert's own schedule inside a range.
#[derive(Clone, Debug, PartialEq)]
pub enum Schedule {
    Times(Vec<i64>),
    Range {
        start: Option<i64>,
        end: Option<i64>,
        step: Option<i64>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DryRunError {
    #[error("This alert type can't be evaluated yet")]
    Unsupported,
    #[error("{0}")]
    InvalidSchedule(String),
}

/// Runs one check's search; the scheduler's own evaluation in production, fixed data in tests.
#[async_trait]
pub trait CheckRunner: Send + Sync {
    async fn run(
        &self,
        alert: &Alert,
        window: (i64, i64),
    ) -> Result<TriggerEvalResults, anyhow::Error>;

    /// Series per metric the PromQL query reads, for a check that matched none.
    async fn series_counts(&self, _alert: &Alert, _window: (i64, i64)) -> Vec<MetricSeries> {
        Vec::new()
    }
}

/// The production runner: the same `evaluate_scheduled` the scheduler calls.
pub struct SearchRunner;

#[async_trait]
impl CheckRunner for SearchRunner {
    async fn run(
        &self,
        alert: &Alert,
        (start, end): (i64, i64),
    ) -> Result<TriggerEvalResults, anyhow::Error> {
        let context = SearchEventContext::with_alert(Some(format!(
            "/alerts/{}/{}/{}/dry_run",
            alert.org_id, alert.stream_type, alert.stream_name
        )));
        alert
            .query_condition
            .evaluate_scheduled(
                &alert.org_id,
                Some(&alert.stream_name),
                alert.stream_type,
                &alert.trigger_condition,
                (Some(start), end),
                Some(SearchEventType::UI),
                Some(context),
                None,
            )
            .await
    }

    async fn series_counts(&self, alert: &Alert, window: (i64, i64)) -> Vec<MetricSeries> {
        let Some(query) = alert.query_condition.promql.as_deref() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for name in promql_metric_names(query)
            .into_iter()
            .take(MAX_DIAGNOSTIC_METRICS)
        {
            let series = count_series(&alert.org_id, &name, window).await;
            out.push(MetricSeries { name, series });
        }
        out
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Quiet,
    Pending,
    Firing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HeldBy {
    NotifyAtMostEvery,
    SuppressRepeats,
    NotifyOnWarningOff,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotFiredReason {
    BelowThreshold,
    NoData,
    Pending,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CheckLevel {
    Warning,
    Critical,
}

impl CheckLevel {
    fn of(level: Option<AlertLevel>) -> Option<Self> {
        match level? {
            AlertLevel::Warning => Some(Self::Warning),
            AlertLevel::Critical => Some(Self::Critical),
            AlertLevel::Ok | AlertLevel::NoData => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct CheckError {
    pub code: u16,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct EvaluatedGroup {
    pub key: String,
    pub labels: BTreeMap<String, String>,
    pub value: Option<f64>,
    pub threshold: Option<f64>,
    pub fired: bool,
    pub level: Option<CheckLevel>,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct Check {
    pub time: i64,
    pub window_start: i64,
    pub window_end: i64,
    pub state: CheckState,
    pub fired: bool,
    pub notified: bool,
    pub held_by: Option<HeldBy>,
    pub level: Option<CheckLevel>,
    pub value: Option<f64>,
    pub value_is_lower_bound: bool,
    pub operator: String,
    pub threshold: Option<f64>,
    pub warning_threshold: Option<f64>,
    pub matched: u64,
    pub groups: Vec<EvaluatedGroup>,
    pub groups_total: u64,
    pub reason: Option<NotFiredReason>,
    pub error: Option<CheckError>,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct GroupFired {
    pub key: String,
    pub labels: BTreeMap<String, String>,
    pub checks: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, ToSchema)]
pub struct Summary {
    pub checks: u64,
    pub fired: u64,
    pub pending: u64,
    pub notifications: u64,
    pub held: u64,
    pub errors: u64,
    pub notified_at: Vec<i64>,
    pub first_fired_at: Option<i64>,
    pub last_fired_at: Option<i64>,
    pub groups_fired: Vec<GroupFired>,
    pub groups_fired_total: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct MetricSeries {
    pub name: String,
    pub series: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct Diagnostics {
    pub metrics: Vec<MetricSeries>,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct EvaluateResponse {
    pub query_type: String,
    pub is_real_time: bool,
    pub start: i64,
    pub end: i64,
    pub truncated: bool,
    pub checks: Vec<Check>,
    pub summary: Summary,
    pub diagnostics: Option<Diagnostics>,
}

/// What one check decided, before the per-check fields are filled in.
#[derive(Clone, Debug, Default, PartialEq)]
struct Decision {
    state: Option<CheckState>,
    notified: bool,
    held_by: Option<HeldBy>,
    level: Option<AlertLevel>,
    fired_groups: Vec<String>,
}

/// The scheduler's state for one alert, kept in memory across the checks of one run.
struct Simulation<'a> {
    alert: &'a Alert,
    through_silence: bool,
    alert_level_delivery: bool,
    rollup: Option<AlertState>,
    groups: HashMap<String, AlertState>,
    last_notified: Option<AlertLevel>,
    silenced_until: Option<i64>,
    // A single-level alert's scheduler does not run again before this time.
    skip_until: Option<i64>,
    last_state: CheckState,
    last_level: Option<AlertLevel>,
}

impl<'a> Simulation<'a> {
    fn new(alert: &'a Alert) -> Self {
        let multi = alert.query_condition.multi_alert_enabled();
        let multi_level = is_multi_level(alert);
        Self {
            alert,
            through_silence: evaluates_through_silence(multi, multi_level),
            alert_level_delivery: alert_level_delivery_applies(multi, multi_level),
            rollup: None,
            groups: HashMap::new(),
            last_notified: None,
            silenced_until: None,
            skip_until: None,
            last_state: CheckState::Quiet,
            last_level: None,
        }
    }

    fn step(&mut self, time: i64, result: Option<&TriggerEvalResults>) -> Decision {
        let decision = match result {
            // A failed search leaves every state axis as it was, as the scheduler does.
            None => Decision {
                state: Some(self.last_state),
                level: self.last_level,
                ..Default::default()
            },
            Some(r) if self.alert.query_condition.multi_alert_enabled() => {
                self.step_groups(time, r)
            }
            Some(r) => self.step_single(time, r),
        };
        self.last_state = decision.state.unwrap_or(CheckState::Quiet);
        self.last_level = decision.level;
        decision
    }

    fn step_single(&mut self, time: i64, r: &TriggerEvalResults) -> Decision {
        if self.skip_until.is_some_and(|until| time < until) {
            let firing = self.last_state == CheckState::Firing;
            return Decision {
                state: Some(self.last_state),
                held_by: firing.then_some(HeldBy::NotifyAtMostEvery),
                level: self.last_level,
                ..Default::default()
            };
        }
        self.skip_until = None;
        let alert = self.alert;
        let recorded = level_for_successful_evaluation(r.level);
        let eval_level = Some(recorded);
        let keep_firing_for = alert.keep_firing_for;
        if r.level.is_none()
            && single_row_clear(self.rollup.as_ref(), eval_level, keep_firing_for, time).is_some()
            && self.rollup.as_ref().is_some_and(|s| s.episode_id.is_some())
        {
            self.last_notified = None;
            self.silenced_until = None;
        }
        let level_delivery = if self.alert_level_delivery {
            delivery_decision(
                recorded,
                self.last_notified,
                self.silenced_until,
                time,
                alert.trigger_condition.notify_on_warning,
            )
        } else {
            DeliveryDecision::Deliver
        };
        if level_delivery.should_deliver()
            && holds_pending(alert, self.rollup.as_ref(), r.data.as_deref(), time)
        {
            self.persist_rollup(RunOutcome::Pending, eval_level, false, time);
            return Decision {
                state: Some(CheckState::Pending),
                level: r.level,
                ..Default::default()
            };
        }
        let delivery = if level_delivery.should_deliver()
            && single_row_repeats(
                alert,
                eval_level,
                self.rollup.as_ref(),
                self.last_notified.map(|l| l.to_i32()),
                self.alert_level_delivery,
            ) {
            DeliveryDecision::SuppressedAsRepeat
        } else {
            level_delivery
        };
        let matched = r.data.is_some();
        let silence = alert.trigger_condition.silence;
        if starts_silence_window(matched, delivery.withheld(), silence, self.through_silence) {
            self.skip_until = next_run_after_silence(alert, time);
        }
        let notified = matched && delivery.should_deliver();
        if notified && self.alert_level_delivery {
            self.last_notified = eval_level;
            self.silenced_until = (silence > 0).then(|| time + silence * MINUTE_MICROS);
        }
        let outcome = if matched {
            RunOutcome::Firing
        } else {
            RunOutcome::Normal
        };
        self.persist_rollup(outcome, eval_level, notified, time);
        let held = self
            .rollup
            .as_ref()
            .is_some_and(|s| s.recovering_since.is_some());
        let state = if matched || held {
            CheckState::Firing
        } else {
            CheckState::Quiet
        };
        Decision {
            state: Some(state),
            notified,
            held_by: (matched && !notified).then(|| held_by(&delivery)),
            level: if matched { r.level } else { self.last_level },
            fired_groups: Vec::new(),
        }
    }

    fn persist_rollup(
        &mut self,
        outcome: RunOutcome,
        level: Option<AlertLevel>,
        delivered: bool,
        time: i64,
    ) {
        let prev = self.rollup.clone();
        let update = apply_outcome(
            DRY_RUN_ID,
            ROLLUP_GROUP_KEY,
            prev.as_ref(),
            outcome,
            level,
            time,
        );
        let Some(mut state) = update.state else {
            return;
        };
        let firing = state.level.is_some_and(|l| l.is_firing());
        let input = EpisodeInput {
            delivered,
            keep_firing_for_secs: self.alert.keep_firing_for,
            ..Default::default()
        };
        apply_episode(&mut state, firing, &input, time, || DRY_RUN_ID.to_string());
        hold_firing_cycle(prev.as_ref(), &mut state);
        self.rollup = Some(state);
    }

    fn step_groups(&mut self, time: i64, r: &TriggerEvalResults) -> Decision {
        let alert = self.alert;
        let Some(classification) = r.group_classification.as_ref() else {
            return Decision {
                state: Some(CheckState::Quiet),
                ..Default::default()
            };
        };
        let plan = if alert.query_condition.promql_rule_mode {
            config::meta::alerts::prom_rule::plan_rule_updates(
                DRY_RUN_ID,
                classification,
                &self.groups,
                time,
                alert.pending_period_sec,
                alert.keep_firing_for,
            )
        } else {
            plan_group_updates(
                DRY_RUN_ID,
                classification,
                &self.groups,
                time,
                alert.pending_period_sec,
                alert.keep_firing_for,
            )
        };
        for key in plan.evicted.iter() {
            self.groups.remove(key);
        }
        for reaped in plan.reaped.iter() {
            self.groups.remove(&reaped.group_key);
        }
        for state in plan.updates.into_iter().filter_map(|u| u.state) {
            self.groups.insert(state.group_key.clone(), state);
        }
        let records = r.data.as_deref().unwrap_or_default();
        let rows = if alert.query_condition.query_type == QueryType::PromQL {
            rows_by_series_key(records)
        } else {
            rows_by_group_key(records, &group_by(alert))
        };
        let dispatch = plan_dispatch(
            classification,
            &self.groups,
            &rows,
            &alert.trigger_condition,
            time,
            config::get_config()
                .limit
                .alert_max_group_notifications_per_eval,
            alert.suppresses_repeats(),
            |_, _, _| false,
        );
        let delivered = EpisodeInput {
            delivered: true,
            keep_firing_for_secs: alert.keep_firing_for,
            ..Default::default()
        };
        for item in dispatch.items.iter() {
            let Some(state) = self.groups.get(&item.group_key) else {
                continue;
            };
            if let Some(mut next) =
                delivery_success_update(state, item.episode, alert.trigger_condition.silence, time)
            {
                apply_episode(&mut next, true, &delivered, time, || DRY_RUN_ID.to_string());
                self.groups.insert(item.group_key.clone(), next);
            }
        }
        let fired_groups = self.fired_group_keys(classification);
        let notified = !dispatch.items.is_empty();
        let state = if !fired_groups.is_empty() {
            CheckState::Firing
        } else if dispatch.pending > 0 {
            CheckState::Pending
        } else {
            CheckState::Quiet
        };
        let held_by = (state == CheckState::Firing && !notified)
            .then(|| {
                if dispatch.repeats > 0 {
                    Some(HeldBy::SuppressRepeats)
                } else {
                    (dispatch.suppressed > 0).then_some(HeldBy::NotifyAtMostEvery)
                }
            })
            .flatten();
        Decision {
            state: Some(state),
            notified,
            held_by,
            level: classification.rollup.filter(|l| l.is_firing()),
            fired_groups,
        }
    }

    /// Groups firing after this check: matched past Must last, or held by Keep firing for.
    fn fired_group_keys(&self, classification: &GroupClassification) -> Vec<String> {
        classification
            .groups
            .iter()
            .map(|g| group_key(&g.labels))
            .filter(|key| {
                self.groups.get(key).is_some_and(|s| {
                    let matched = s.level.is_some_and(|l| l.is_firing())
                        && s.last_outcome != Some(RunOutcome::Pending);
                    matched || s.recovering_since.is_some()
                })
            })
            .collect()
    }
}

/// The check times for `schedule`, ascending, capped at [`MAX_CHECKS`] (latest kept).
pub fn check_times(
    alert: &Alert,
    schedule: &Schedule,
    now: i64,
) -> Result<(Vec<i64>, bool), DryRunError> {
    let mut times = match schedule {
        Schedule::Times(times) => times.clone(),
        Schedule::Range { start, end, step } => {
            let end = end.unwrap_or(now);
            let start = start.unwrap_or(end - DAY_MICROS);
            if start > end {
                return Err(DryRunError::InvalidSchedule(
                    "start must not be after end".to_string(),
                ));
            }
            range_times(alert, start, end, *step)?
        }
    };
    times.sort_unstable();
    times.dedup();
    let truncated = times.len() > MAX_CHECKS;
    if truncated {
        times.drain(..times.len() - MAX_CHECKS);
    }
    Ok((times, truncated))
}

/// Minutes each check looks back; a real-time alert with no period counts per minute.
pub fn window_minutes(alert: &Alert) -> i64 {
    alert.trigger_condition.period.max(1)
}

/// The alert a real-time rule is checked as: a count of matching events per window.
pub fn as_scheduled(alert: &Alert) -> Alert {
    if !alert.is_real_time {
        return alert.clone();
    }
    let mut alert = alert.clone();
    alert.is_real_time = false;
    alert.query_condition.aggregation = None;
    alert.trigger_condition.operator = Operator::GreaterThanEquals;
    alert.trigger_condition.threshold = 1;
    alert.trigger_condition.warning_threshold = None;
    alert.trigger_condition.period = window_minutes(&alert);
    alert.trigger_condition.frequency = alert.trigger_condition.period * 60;
    alert.trigger_condition.frequency_type = FrequencyType::Minutes;
    // Real-time silence has a floor; rounded up so a held check is never sent early.
    let silence = alert.trigger_condition.effective_silence_micros();
    alert.trigger_condition.silence = (silence + MINUTE_MICROS - 1) / MINUTE_MICROS;
    alert
}

/// Evaluates `alert` (already validated and converted by [`as_scheduled`]) at `times`.
pub async fn evaluate(
    alert: &Alert,
    is_real_time: bool,
    times: Vec<i64>,
    truncated: bool,
    runner: &dyn CheckRunner,
    deadline: tokio::time::Instant,
) -> EvaluateResponse {
    let period = window_minutes(alert) * MINUTE_MICROS;
    let (results, timed_out) = run_newest_first(alert, &times, period, runner, deadline).await;
    let mut response = simulate(alert, is_real_time, &results, period);
    response.truncated = truncated || timed_out;
    if let Some(range) = times.first().zip(times.last()) {
        response.start = range.0 - period;
        response.end = *range.1;
    }
    if alert.query_condition.query_type == QueryType::PromQL
        && let Some(latest) = response.checks.last()
        && latest.matched == 0
        && latest.error.is_none()
    {
        let metrics = runner
            .series_counts(alert, (latest.window_start, latest.window_end))
            .await;
        response.diagnostics = Some(Diagnostics { metrics });
    }
    response
}

/// Runs the searches newest first so a deadline drops the oldest checks; returns them ascending.
async fn run_newest_first(
    alert: &Alert,
    times: &[i64],
    period: i64,
    runner: &dyn CheckRunner,
    deadline: tokio::time::Instant,
) -> (Vec<(i64, Result<TriggerEvalResults, anyhow::Error>)>, bool) {
    let mut stream = futures::stream::iter(times.iter().rev().copied())
        .map(|time| async move { (time, runner.run(alert, (time - period, time)).await) })
        .buffered(CONCURRENT_CHECKS);
    let mut results = Vec::with_capacity(times.len());
    let mut timed_out = false;
    loop {
        match tokio::time::timeout_at(deadline, stream.next()).await {
            Ok(Some(result)) => results.push(result),
            Ok(None) => break,
            Err(_) => {
                timed_out = true;
                break;
            }
        }
    }
    results.reverse();
    (results, timed_out)
}

/// Replays the scheduler's decisions over evaluated checks, oldest first. Pure.
fn simulate(
    alert: &Alert,
    is_real_time: bool,
    results: &[(i64, Result<TriggerEvalResults, anyhow::Error>)],
    period: i64,
) -> EvaluateResponse {
    let mut simulation = Simulation::new(alert);
    let mut checks = Vec::with_capacity(results.len());
    let mut fired_by_group: HashMap<String, (BTreeMap<String, String>, u64)> = HashMap::new();
    for (time, result) in results {
        let decision = simulation.step(*time, result.as_ref().ok());
        for key in decision.fired_groups.iter() {
            if let Ok(r) = result.as_ref() {
                let labels = group_labels_for(r, key);
                fired_by_group.entry(key.clone()).or_insert((labels, 0)).1 += 1;
            }
        }
        checks.push(build_check(
            alert,
            *time,
            period,
            result,
            decision,
            is_real_time,
        ));
    }
    let summary = summarize(&checks, fired_by_group);
    EvaluateResponse {
        query_type: query_type_name(&alert.query_condition.query_type).to_string(),
        is_real_time,
        start: 0,
        end: 0,
        truncated: false,
        checks,
        summary,
        diagnostics: None,
    }
}

fn build_check(
    alert: &Alert,
    time: i64,
    period: i64,
    result: &Result<TriggerEvalResults, anyhow::Error>,
    decision: Decision,
    is_real_time: bool,
) -> Check {
    let (operator, critical, warning) = threshold_context(alert);
    let state = decision.state.unwrap_or(CheckState::Quiet);
    let fired = state == CheckState::Firing;
    let mut check = Check {
        time,
        window_start: time - period,
        window_end: time,
        state,
        fired,
        notified: decision.notified,
        held_by: decision.held_by,
        level: if fired {
            CheckLevel::of(decision.level)
        } else {
            None
        },
        value: None,
        value_is_lower_bound: false,
        operator: operator.to_string(),
        threshold: Some(critical),
        warning_threshold: warning,
        matched: 0,
        groups: Vec::new(),
        groups_total: 0,
        reason: None,
        error: None,
    };
    match result {
        Err(e) => {
            check.error = Some(check_error(alert, time, e));
            check.reason = (!fired).then_some(NotFiredReason::Error);
        }
        Ok(r) => {
            fill_observation(alert, &mut check, r, &decision.fired_groups, is_real_time);
            check.reason = (!fired).then(|| not_fired_reason(alert, state, &check, is_real_time));
        }
    }
    check
}

/// A search error the search API shows users keeps its text; any other failure is only logged.
fn check_error(alert: &Alert, time: i64, error: &anyhow::Error) -> CheckError {
    use infra::errors::Error;

    let code = match error.downcast_ref::<Error>() {
        Some(Error::ErrorCode(code)) if code.http_status() < 500 => code,
        _ => {
            log::error!(
                "[alert dry run] org {} alert {}: check at {time} failed: {error:#}",
                alert.org_id,
                alert.name
            );
            return CheckError {
                code: 500,
                message: CHECK_FAILED.to_string(),
            };
        }
    };
    let status = code.http_status();
    let detail = code.get_error_detail();
    // Only a 400 detail describes the query itself; the others carry internal context.
    let message = if status == 400 && !detail.is_empty() {
        format!("The query failed: {}: {detail}", code.get_message())
    } else {
        format!("The query failed: {}", code.get_message())
    };
    CheckError {
        code: status,
        message,
    }
}

fn fill_observation(
    alert: &Alert,
    check: &mut Check,
    r: &TriggerEvalResults,
    fired_groups: &[String],
    is_real_time: bool,
) {
    check.value = r.actual_value;
    check.value_is_lower_bound = r.value_is_lower_bound;
    if is_real_time {
        check.matched = r.actual_value.unwrap_or_default() as u64;
        return;
    }
    let (_, critical, warning) = threshold_context(alert);
    if let Some(classification) = r.group_classification.as_ref() {
        check.groups_total = (classification.groups.len() + classification.dropped.len()) as u64;
        check.matched = check.groups_total;
        check.groups = ranked_groups(&classification.groups, fired_groups, critical, warning);
        return;
    }
    let rows = r.data.as_ref().map_or(0, |d| d.len() as u64);
    let is_count = alert.query_condition.aggregation.is_none()
        && alert.query_condition.query_type != QueryType::PromQL;
    check.matched = if is_count {
        r.actual_value.unwrap_or(rows as f64) as u64
    } else {
        rows
    };
    let by = group_by(alert);
    if !by.is_empty()
        && let Some(records) = r.data.as_ref()
    {
        let col = alert
            .query_condition
            .aggregation
            .as_ref()
            .map(|a| a.having.column.clone())
            .filter(|_| alert.query_condition.query_type == QueryType::SQL)
            .unwrap_or_else(|| "alert_agg_value".to_string());
        let groups: Vec<ClassifiedGroup> = records
            .iter()
            .map(|row| ClassifiedGroup {
                labels: config::meta::alerts::dispatch::row_group_labels(row, &by),
                actual_value: row.get(&col).and_then(|v| v.as_f64()).unwrap_or_default(),
                rule_value: None,
                level: r.level,
            })
            .collect();
        let keys: Vec<String> = groups.iter().map(|g| group_key(&g.labels)).collect();
        check.groups_total = groups.len() as u64;
        check.groups = ranked_groups(&groups, &keys, critical, warning);
    }
}

fn ranked_groups(
    groups: &[ClassifiedGroup],
    fired_keys: &[String],
    critical: f64,
    warning: Option<f64>,
) -> Vec<EvaluatedGroup> {
    let mut out: Vec<EvaluatedGroup> = groups
        .iter()
        .map(|g| {
            let fired = fired_keys.contains(&group_key(&g.labels));
            let threshold = match g.level {
                Some(AlertLevel::Warning) => warning.or(Some(critical)),
                _ => Some(critical),
            };
            EvaluatedGroup {
                key: config::meta::alerts::grouping::render_labels(&g.labels),
                labels: g.labels.clone(),
                value: Some(g.actual_value),
                threshold,
                fired,
                level: if fired { CheckLevel::of(g.level) } else { None },
            }
        })
        .collect();
    out.sort_by(|a, b| {
        b.fired.cmp(&a.fired).then(
            b.value
                .unwrap_or(f64::MIN)
                .total_cmp(&a.value.unwrap_or(f64::MIN)),
        )
    });
    out.truncate(MAX_GROUPS_PER_CHECK);
    out
}

/// `no_data` only where an empty result can only mean the query matched nothing.
fn not_fired_reason(
    alert: &Alert,
    state: CheckState,
    check: &Check,
    is_real_time: bool,
) -> NotFiredReason {
    if state == CheckState::Pending {
        return NotFiredReason::Pending;
    }
    let qc = &alert.query_condition;
    let unfiltered = is_real_time
        || qc.multi_alert_enabled()
        || (qc.query_type == QueryType::Custom && qc.aggregation.is_none());
    if unfiltered && check.matched == 0 {
        NotFiredReason::NoData
    } else {
        NotFiredReason::BelowThreshold
    }
}

fn summarize(
    checks: &[Check],
    fired_by_group: HashMap<String, (BTreeMap<String, String>, u64)>,
) -> Summary {
    let fired_times: Vec<i64> = checks.iter().filter(|c| c.fired).map(|c| c.time).collect();
    let notified: Vec<i64> = checks
        .iter()
        .filter(|c| c.notified)
        .map(|c| c.time)
        .collect();
    let mut groups_fired: Vec<GroupFired> = fired_by_group
        .into_iter()
        .map(|(key, (labels, checks))| GroupFired {
            key: if labels.is_empty() {
                key
            } else {
                config::meta::alerts::grouping::render_labels(&labels)
            },
            labels,
            checks,
        })
        .collect();
    groups_fired.sort_by(|a, b| b.checks.cmp(&a.checks).then(a.key.cmp(&b.key)));
    let groups_fired_total = groups_fired.len() as u64;
    groups_fired.truncate(MAX_GROUPS_FIRED);
    Summary {
        checks: checks.len() as u64,
        fired: fired_times.len() as u64,
        pending: checks
            .iter()
            .filter(|c| c.state == CheckState::Pending)
            .count() as u64,
        notifications: notified.len() as u64,
        held: checks.iter().filter(|c| c.held_by.is_some()).count() as u64,
        errors: checks.iter().filter(|c| c.error.is_some()).count() as u64,
        notified_at: notified[notified.len().saturating_sub(MAX_NOTIFIED_AT)..].to_vec(),
        first_fired_at: fired_times.first().copied(),
        last_fired_at: fired_times.last().copied(),
        groups_fired,
        groups_fired_total,
    }
}

fn held_by(delivery: &DeliveryDecision) -> HeldBy {
    match delivery {
        DeliveryDecision::SuppressedAsRepeat => HeldBy::SuppressRepeats,
        DeliveryDecision::SuppressedByWarningPolicy => HeldBy::NotifyOnWarningOff,
        _ => HeldBy::NotifyAtMostEvery,
    }
}

fn group_by(alert: &Alert) -> Vec<String> {
    alert
        .query_condition
        .aggregation
        .as_ref()
        .and_then(|a| a.group_by.clone())
        .unwrap_or_default()
}

fn group_labels_for(r: &TriggerEvalResults, key: &str) -> BTreeMap<String, String> {
    r.group_classification
        .as_ref()
        .and_then(|c| c.groups.iter().find(|g| group_key(&g.labels) == key))
        .map(|g| g.labels.clone())
        .unwrap_or_default()
}

fn query_type_name(query_type: &QueryType) -> &'static str {
    match query_type {
        QueryType::SQL => "sql",
        QueryType::PromQL => "promql",
        QueryType::Slo => "slo",
        QueryType::Custom => "custom",
    }
}

/// The run after a delivered single-level firing, as the scheduler computes it.
fn next_run_after_silence(alert: &Alert, time: i64) -> Option<i64> {
    let mut condition = alert.trigger_condition.clone();
    condition.tolerance_in_secs = None;
    condition
        .get_next_trigger_time(true, alert.tz_offset, true, Some(time))
        .ok()
}

fn range_times(
    alert: &Alert,
    start: i64,
    end: i64,
    step: Option<i64>,
) -> Result<Vec<i64>, DryRunError> {
    let mut condition = alert.trigger_condition.clone();
    condition.tolerance_in_secs = None;
    if step.is_none() && condition.frequency_type == FrequencyType::Cron && !alert.is_real_time {
        return cron_times(alert, &condition, start, end);
    }
    let step = match step {
        Some(step) if step > 0 => step,
        Some(_) => {
            return Err(DryRunError::InvalidSchedule(
                "step must be positive".to_string(),
            ));
        }
        None => condition.frequency.max(1) * 1_000_000,
    };
    let anchor = if condition.align_time && !alert.is_real_time {
        config::meta::alerts::TriggerCondition::align_time(
            end,
            alert.tz_offset,
            Some(condition.frequency),
            condition.timezone.as_deref(),
        )
    } else {
        end
    };
    let count = ((anchor - start) / step + 1).clamp(0, MAX_CHECKS as i64 + 1);
    Ok((0..count).map(|k| anchor - k * step).collect())
}

fn cron_times(
    alert: &Alert,
    condition: &config::meta::alerts::TriggerCondition,
    start: i64,
    end: i64,
) -> Result<Vec<i64>, DryRunError> {
    // One past the cap is kept so the caller can tell the latest MAX_CHECKS were truncated.
    let mut times = std::collections::VecDeque::with_capacity(MAX_CHECKS + 1);
    let mut cursor = start - 1;
    for _ in 0..MAX_CRON_STEPS {
        let next = condition
            .get_next_trigger_time(true, alert.tz_offset, false, Some(cursor))
            .map_err(|e| DryRunError::InvalidSchedule(e.to_string()))?;
        if next > end || next <= cursor {
            break;
        }
        if times.len() > MAX_CHECKS {
            times.pop_front();
        }
        times.push_back(next);
        cursor = next;
    }
    Ok(times.into())
}

/// Every metric a PromQL query names, by bare selector or `__name__` equality.
pub fn promql_metric_names(query: &str) -> Vec<String> {
    let Ok(expr) = promql_parser::parser::parse(query) else {
        return Vec::new();
    };
    let mut names = Vec::new();
    collect_metric_names(&expr, &mut names);
    names.sort();
    names.dedup();
    names
}

fn collect_metric_names(expr: &promql_parser::parser::Expr, out: &mut Vec<String>) {
    use promql_parser::parser::Expr;
    match expr {
        Expr::VectorSelector(vs) => out.extend(selector_name(vs)),
        Expr::MatrixSelector(ms) => out.extend(selector_name(&ms.vs)),
        Expr::Aggregate(a) => collect_metric_names(&a.expr, out),
        Expr::Unary(u) => collect_metric_names(&u.expr, out),
        Expr::Paren(p) => collect_metric_names(&p.expr, out),
        Expr::Subquery(s) => collect_metric_names(&s.expr, out),
        Expr::Binary(b) => {
            collect_metric_names(&b.lhs, out);
            collect_metric_names(&b.rhs, out);
        }
        Expr::Call(c) => c
            .args
            .args
            .iter()
            .for_each(|a| collect_metric_names(a, out)),
        _ => {}
    }
}

fn selector_name(vs: &promql_parser::parser::VectorSelector) -> Option<String> {
    vs.name.clone().or_else(|| {
        vs.matchers
            .matchers
            .iter()
            .find(|m| m.name == "__name__" && m.op == promql_parser::label::MatchOp::Equal)
            .map(|m| m.value.clone())
    })
}

async fn count_series(org_id: &str, metric: &str, (start, end): (i64, i64)) -> u64 {
    let req = promql_service::MetricsQueryRequest {
        query: format!("count({{__name__=\"{metric}\"}})"),
        start,
        end,
        step: std::cmp::max(::promql::micros(::promql::MINIMAL_INTERVAL), end - start),
        query_exemplars: false,
        use_cache: None,
        search_type: Some(SearchEventType::UI),
        regions: vec![],
        clusters: vec![],
        search_event_context: None,
    };
    let trace_id = config::ider::generate_trace_id();
    match promql_service::search::search(&trace_id, org_id, &req, "", 0, false).await {
        Ok(resp) => match resp.value {
            config::meta::promql::value::Value::Matrix(series) => series
                .iter()
                .filter_map(|s| s.samples.last())
                .map(|s| s.value as u64)
                .max()
                .unwrap_or_default(),
            _ => 0,
        },
        Err(_) => 0,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use config::{
        meta::alerts::{
            AggFunction, Aggregation, Condition, Operator, QueryType, TriggerEvalResults,
            alert::Alert,
            grouping::{ClassifiedGroup, GroupCapOutcome, GroupClassification},
            level::AlertLevel,
        },
        utils::json::{Map, Value, json},
    };

    use super::*;

    const MIN: i64 = MINUTE_MICROS;
    const T0: i64 = 1_763_460_000_000_000;

    struct Fixed(Vec<(i64, TriggerEvalResults)>);

    #[async_trait]
    impl CheckRunner for Fixed {
        async fn run(&self, _: &Alert, (_, end): (i64, i64)) -> anyhow::Result<TriggerEvalResults> {
            self.0
                .iter()
                .find(|(t, _)| *t == end)
                .map(|(_, r)| r.clone())
                .ok_or_else(|| anyhow::anyhow!("search failed"))
        }
    }

    fn row(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    /// A count result as `evaluate_scheduled` returns it after the function ran.
    fn count(n: usize, threshold: f64) -> TriggerEvalResults {
        let matched = n as f64 >= threshold;
        TriggerEvalResults {
            data: matched.then(|| vec![row(&[("k", json!(1))]); n]),
            actual_value: Some(n as f64),
            level: matched.then_some(AlertLevel::Critical),
            ..Default::default()
        }
    }

    fn grouped(values: &[(&str, f64)], warn: f64, crit: f64) -> TriggerEvalResults {
        let level_of = |v: f64| {
            if v >= crit {
                Some(AlertLevel::Critical)
            } else if v >= warn {
                Some(AlertLevel::Warning)
            } else {
                None
            }
        };
        let groups: Vec<ClassifiedGroup> = values
            .iter()
            .map(|(svc, v)| ClassifiedGroup {
                labels: BTreeMap::from([("service".to_string(), svc.to_string())]),
                actual_value: *v,
                rule_value: None,
                level: level_of(*v),
            })
            .collect();
        let rollup =
            AlertLevel::most_severe(groups.iter().filter_map(|g| g.level)).or(Some(AlertLevel::Ok));
        let records = values
            .iter()
            .map(|(svc, v)| row(&[("service", json!(svc)), ("alert_agg_value", json!(v))]))
            .collect();
        TriggerEvalResults {
            data: rollup.filter(|l| l.is_firing()).map(|_| records),
            level: rollup.filter(|l| l.is_firing()),
            group_classification: Some(GroupClassification {
                firing_observed: groups.iter().filter(|g| g.level.is_some()).count(),
                groups,
                rollup,
                cap: GroupCapOutcome::WithinCap,
                page: Default::default(),
                dropped: vec![],
            }),
            ..Default::default()
        }
    }

    fn series(values: &[(&str, f64)], threshold: f64) -> TriggerEvalResults {
        let mut r = grouped(values, threshold, threshold);
        let records: Vec<_> = values
            .iter()
            .map(|(pod, v)| row(&[("pod", json!(pod)), ("value", json!(v))]))
            .collect();
        if let Some(c) = r.group_classification.as_mut() {
            for g in c.groups.iter_mut() {
                g.labels = BTreeMap::from([("pod".to_string(), g.labels["service"].clone())]);
            }
        }
        r.data = r.data.map(|_| records);
        r
    }

    async fn run(alert: &Alert, results: Vec<(i64, TriggerEvalResults)>) -> EvaluateResponse {
        let times = results.iter().map(|(t, _)| *t).collect();
        let deadline = tokio::time::Instant::now() + DEADLINE;
        evaluate(alert, false, times, false, &Fixed(results), deadline).await
    }

    fn states(resp: &EvaluateResponse) -> Vec<(CheckState, bool, Option<HeldBy>)> {
        resp.checks
            .iter()
            .map(|c| (c.state, c.notified, c.held_by))
            .collect()
    }

    /// Compare-with-past + function: the scheduler decides on the rows the function returned.
    #[tokio::test]
    async fn compare_alert_waits_must_last_then_holds_for_notify_at_most_every() {
        let mut alert = Alert::default();
        alert.query_condition.query_type = QueryType::SQL;
        alert.query_condition.sql = Some("SELECT * FROM t".into());
        alert.query_condition.vrl_function = Some("LgppZiAucmF0aW8gPiAyIHsgLiB9".into());
        alert.query_condition.multi_time_range =
            Some(vec![config::meta::alerts::CompareHistoricData {
                offset: "7d".into(),
            }]);
        alert.pending_period_sec = 600;
        alert.trigger_condition.period = 10;
        alert.trigger_condition.frequency = 600;
        alert.trigger_condition.threshold = 1;
        alert.trigger_condition.operator = Operator::GreaterThanEquals;
        alert.trigger_condition.silence = 20;
        let step = 10 * MIN;
        let counts = [0, 2, 3, 1, 1, 0, 0];
        let results = counts
            .iter()
            .enumerate()
            .map(|(i, n)| (T0 + i as i64 * step, count(*n, 1.0)))
            .collect();
        let resp = run(&alert, results).await;
        use CheckState::*;
        let held = Some(HeldBy::NotifyAtMostEvery);
        assert_eq!(
            states(&resp),
            vec![
                (Quiet, false, None),
                (Pending, false, None),
                (Firing, true, None),
                (Firing, false, held),
                (Firing, true, None),
                (Firing, false, held),
                (Quiet, false, None),
            ]
        );
        assert_eq!(resp.checks[0].reason, Some(NotFiredReason::BelowThreshold));
        assert_eq!(resp.checks[1].reason, Some(NotFiredReason::Pending));
        assert_eq!(resp.summary.notified_at, vec![T0 + 2 * step, T0 + 4 * step]);
        assert_eq!((resp.summary.fired, resp.summary.held), (4, 2));
    }

    #[tokio::test]
    async fn grouped_alert_waits_must_last_then_pages_each_group_once_per_silence() {
        let mut alert = Alert::default();
        alert.query_condition.query_type = QueryType::Custom;
        alert.query_condition.aggregation = Some(Aggregation {
            group_by: Some(vec!["service".into()]),
            function: AggFunction::Count,
            having: Condition {
                column: "alert_agg_value".into(),
                operator: Operator::GreaterThanEquals,
                value: json!(10),
                ignore_case: false,
                case_insensitive: None,
            },
            warning_value: Some(5.0),
            multi_alert: true,
        });
        alert.pending_period_sec = 300;
        alert.trigger_condition.period = 5;
        alert.trigger_condition.frequency = 300;
        alert.trigger_condition.silence = 30;
        let step = 5 * MIN;
        let results = vec![
            (T0, grouped(&[("cart", 1.0), ("checkout", 12.0)], 5.0, 10.0)),
            (
                T0 + step,
                grouped(&[("cart", 6.0), ("checkout", 14.0)], 5.0, 10.0),
            ),
            (
                T0 + 2 * step,
                grouped(&[("cart", 7.0), ("checkout", 15.0)], 5.0, 10.0),
            ),
            (
                T0 + 3 * step,
                grouped(&[("cart", 2.0), ("checkout", 16.0)], 5.0, 10.0),
            ),
        ];
        let resp = run(&alert, results).await;
        use CheckState::*;
        assert_eq!(
            states(&resp),
            vec![
                (Pending, false, None),
                (Firing, true, None),
                (Firing, true, None),
                (Firing, false, Some(HeldBy::NotifyAtMostEvery)),
            ]
        );
        let fired: Vec<_> = resp.checks[2]
            .groups
            .iter()
            .map(|g| (g.key.as_str(), g.fired))
            .collect();
        assert_eq!(
            fired,
            vec![("service=checkout", true), ("service=cart", true)]
        );
        assert_eq!(resp.summary.groups_fired[0].checks, 3);
        assert_eq!(resp.summary.groups_fired_total, 2);
    }

    #[tokio::test]
    async fn promql_series_alert_keeps_firing_then_clears_and_errors_carry_state() {
        let mut alert = Alert::default();
        alert.stream_type = config::meta::stream::StreamType::Metrics;
        alert.query_condition.query_type = QueryType::PromQL;
        alert.query_condition.promql = Some("rate(http_requests_total[5m])".into());
        alert.query_condition.promql_multi_alert = true;
        alert.query_condition.promql_condition = Some(Condition {
            column: "value".into(),
            operator: Operator::GreaterThan,
            value: json!(3),
            ignore_case: false,
            case_insensitive: None,
        });
        alert.keep_firing_for = 600;
        alert.trigger_condition.period = 5;
        alert.trigger_condition.frequency = 300;
        let step = 5 * MIN;
        let results = vec![
            (T0, series(&[("web-1", 5.0), ("web-2", 1.0)], 3.0)),
            (T0 + step, series(&[("web-1", 1.0), ("web-2", 1.0)], 3.0)),
            (
                T0 + 3 * step,
                series(&[("web-1", 1.0), ("web-2", 1.0)], 3.0),
            ),
            (T0 + 4 * step, series(&[], 3.0)),
        ];
        let mut times: Vec<i64> = results.iter().map(|(t, _)| *t).collect();
        times.insert(2, T0 + 2 * step);
        let deadline = tokio::time::Instant::now() + DEADLINE;
        let resp = evaluate(&alert, false, times, false, &Fixed(results), deadline).await;
        use CheckState::*;
        assert_eq!(
            states(&resp),
            vec![
                (Firing, true, None),
                (Firing, false, None),
                (Firing, false, None),
                (Quiet, false, None),
                (Quiet, false, None),
            ]
        );
        assert_eq!(resp.checks[2].error.as_ref().map(|e| e.code), Some(500));
        assert_eq!(resp.checks[4].reason, Some(NotFiredReason::NoData));
        assert!(resp.diagnostics.is_some());
        assert_eq!(resp.summary.errors, 1);
    }

    #[tokio::test]
    async fn a_failed_check_shows_search_errors_meant_for_users_and_hides_the_rest() {
        use infra::errors::{Error, ErrorCodes};

        struct Failing;
        #[async_trait]
        impl CheckRunner for Failing {
            async fn run(
                &self,
                _: &Alert,
                (_, end): (i64, i64),
            ) -> anyhow::Result<TriggerEvalResults> {
                let error = match end {
                    T0 => Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                        "sql parser error: Expected: an expression, found: FROM".into(),
                    )),
                    t if t == T0 + MIN => Error::ErrorCode(ErrorCodes::SearchTimeout(
                        "promql->search: timeout".into(),
                    )),
                    _ => Error::Message("querier-3: /data/wal/7.parquet: No such file".into()),
                };
                let message = error.to_string();
                Err(anyhow::Error::new(error).context(message))
            }
        }
        let deadline = tokio::time::Instant::now() + DEADLINE;
        let times = vec![T0, T0 + MIN, T0 + 2 * MIN];
        let resp = evaluate(&Alert::default(), false, times, false, &Failing, deadline).await;
        let errors: Vec<_> = resp.checks.iter().filter_map(|c| c.error.clone()).collect();
        let error = |code, message: &str| CheckError {
            code,
            message: message.to_string(),
        };
        assert_eq!(
            errors,
            vec![
                error(
                    400,
                    "The query failed: Search SQL not valid: sql parser error: Expected: an expression, found: FROM"
                ),
                error(408, "The query failed: Search query timed out"),
                error(500, CHECK_FAILED),
            ]
        );
    }

    #[test]
    fn check_times_follow_the_schedule_and_keep_the_latest_1440() {
        let mut alert = Alert::default();
        alert.trigger_condition.frequency = 600;
        let range = |start, end, step| Schedule::Range { start, end, step };
        let cases: Vec<(Schedule, usize, bool, Option<i64>)> = vec![
            (range(None, Some(T0), None), 145, false, Some(T0)),
            (
                range(Some(T0 - 30 * MIN), Some(T0), Some(10 * MIN)),
                4,
                false,
                Some(T0),
            ),
            (
                range(None, Some(T0), Some(MIN / 60)),
                MAX_CHECKS,
                true,
                Some(T0),
            ),
            (Schedule::Times(vec![T0, T0 - MIN, T0]), 2, false, Some(T0)),
        ];
        for (schedule, len, truncated, last) in cases {
            let (times, t) = check_times(&alert, &schedule, T0).unwrap();
            assert_eq!(
                (times.len(), t, times.last().copied()),
                (len, truncated, last)
            );
        }
        let mut cron = alert.clone();
        cron.trigger_condition.frequency_type = FrequencyType::Cron;
        cron.trigger_condition.cron = "0 * * * * *".into();
        let (times, t) =
            check_times(&cron, &range(Some(T0 - 2 * DAY_MICROS), Some(T0), None), T0).unwrap();
        assert_eq!(
            (times.len(), t, times.last().copied()),
            (MAX_CHECKS, true, Some(T0))
        );
        let bad = check_times(&alert, &range(Some(T0), Some(T0 - 1), None), T0);
        assert!(matches!(bad, Err(DryRunError::InvalidSchedule(_))));
    }
}
