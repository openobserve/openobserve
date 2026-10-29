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

//! The auto-investigate gate: whether a Fire starts an investigation, and why not.

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::{level::AlertLevel, state::StateTransition};
use crate::{meta::self_reporting::usage::RunOutcome, utils::json::Value};

/// settings v2 key (org scope) holding [`GateSettings`].
pub const AUTO_INVESTIGATE_GATE_SETTING_KEY: &str = "auto_investigate_gate";
/// `_meta` logs stream holding one [`DecisionRow`] per gate decision.
pub const AUTO_INVESTIGATE_DECISIONS_STREAM: &str = "auto_investigate_decisions";
pub const DECISION_ENTITY_TYPE: &str = "alert";
pub const DECISION_KIND: &str = "auto_investigate";
/// Trailing window the onset and fire-share figures cover.
pub const GATE_WINDOW_SECS: i64 = 7 * 24 * 3600;
pub const ALWAYS_FIRING_SHARE: f64 = 0.9;
pub const ALWAYS_FIRING_MIN_EVALUATIONS: u32 = 20;
const MICROS_PER_SEC: i64 = 1_000_000;
const FLAPPING_ONSETS_RANGE: std::ops::RangeInclusive<u32> = 2..=100;
const COOLDOWN_SECS_RANGE: std::ops::RangeInclusive<i64> = 3600..=604_800;

/// Why the gate ran or skipped an investigation; the first matching rule wins.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReasonCode {
    NotFire,
    NotCritical,
    RcaRunning,
    Cooldown,
    Flapping,
    AlwaysFiring,
    Budget,
    Eligible,
}

impl ReasonCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NotFire => "not_fire",
            Self::NotCritical => "not_critical",
            Self::RcaRunning => "rca_running",
            Self::Cooldown => "cooldown",
            Self::Flapping => "flapping",
            Self::AlwaysFiring => "always_firing",
            Self::Budget => "budget",
            Self::Eligible => "eligible",
        }
    }

    /// The code whose [`Self::as_str`] is `s`.
    pub fn parse(s: &str) -> Option<Self> {
        [
            Self::NotFire,
            Self::NotCritical,
            Self::RcaRunning,
            Self::Cooldown,
            Self::Flapping,
            Self::AlwaysFiring,
            Self::Budget,
            Self::Eligible,
        ]
        .into_iter()
        .find(|code| code.as_str() == s)
    }
}

/// Outcome of the caller's budget checks for this investigation.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BudgetCheck {
    #[default]
    Allowed,
    /// RCA admission refused with `turn_limit`.
    TurnLimit,
    /// The org's AI-usage check refused.
    AiUsageRefused,
}

/// Whether the caller's protection lookup answered; only `Ok` lets `protected` reach the gate.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MarkLookup {
    Ok,
    Failed,
    #[default]
    NotChecked,
}

/// Per-org gate thresholds, the settings v2 value of [`AUTO_INVESTIGATE_GATE_SETTING_KEY`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct GateSettings {
    pub flapping_onsets_7d: u32,
    pub flapping_cooldown_secs: i64,
    pub base_cooldown_secs: i64,
}

impl Default for GateSettings {
    fn default() -> Self {
        Self {
            flapping_onsets_7d: 14,
            flapping_cooldown_secs: 86_400,
            base_cooldown_secs: 14_400,
        }
    }
}

impl GateSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !FLAPPING_ONSETS_RANGE.contains(&self.flapping_onsets_7d) {
            return Err(format!(
                "flapping_onsets_7d must be between {} and {}, got {}",
                FLAPPING_ONSETS_RANGE.start(),
                FLAPPING_ONSETS_RANGE.end(),
                self.flapping_onsets_7d
            ));
        }
        for (name, secs) in [
            ("flapping_cooldown_secs", self.flapping_cooldown_secs),
            ("base_cooldown_secs", self.base_cooldown_secs),
        ] {
            if !COOLDOWN_SECS_RANGE.contains(&secs) {
                return Err(format!(
                    "{name} must be between {} and {} seconds, got {secs}",
                    COOLDOWN_SECS_RANGE.start(),
                    COOLDOWN_SECS_RANGE.end()
                ));
            }
        }
        Ok(())
    }

    /// Parses and validates a stored or submitted value; fields it omits take the defaults.
    pub fn parse(value: &Value) -> Result<Self, String> {
        let settings: Self = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
        settings.validate()?;
        Ok(settings)
    }

    /// The settings in force: a missing or invalid stored value means the defaults.
    pub fn resolve(value: Option<&Value>) -> Self {
        value.and_then(|v| Self::parse(v).ok()).unwrap_or_default()
    }
}

/// Everything the gate reads; the caller gathers it for one alert + group episode.
#[derive(Clone, Debug, PartialEq)]
pub struct GateInputs {
    /// True only for the first Fire of a firing cycle, not a repeat or an escalation.
    pub is_new_fire: bool,
    pub level: Option<AlertLevel>,
    pub rca_running: bool,
    /// Microseconds.
    pub last_auto_investigated_at: Option<i64>,
    /// Exempts this alert + group from the flapping and always-firing rules only.
    pub protected: bool,
    pub mark_lookup: MarkLookup,
    pub onsets_7d: u32,
    pub evaluations_7d: u32,
    pub fire_share_7d: f64,
    pub budget: BudgetCheck,
    /// Microseconds.
    pub now: i64,
    pub settings: GateSettings,
    /// `updated_at` of the settings row used; `None` = code defaults.
    pub settings_version: Option<i64>,
}

/// The gate's verdict plus the figures behind it, one shadow-log row's worth.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Decision {
    pub run: bool,
    pub reason: ReasonCode,
    /// The protection the gate applied: false unless the lookup was `Ok`.
    pub protected: bool,
    pub mark_lookup: MarkLookup,
    pub onsets_7d: u32,
    pub evaluations_7d: u32,
    pub fire_share_7d: f64,
    /// `None` when the gate stopped before the cooldown rule.
    pub cooldown_applied_secs: Option<i64>,
    pub last_run_at: Option<i64>,
    pub settings_version: Option<i64>,
}

impl Decision {
    /// When the applied cooldown ends, in microseconds.
    pub fn next_eligible_at(&self) -> Option<i64> {
        Some(self.last_run_at? + self.cooldown_applied_secs? * MICROS_PER_SEC)
    }
}

/// One row of [`AUTO_INVESTIGATE_DECISIONS_STREAM`]: the verdict and every input the gate used.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct DecisionRow {
    /// Decision time, microseconds.
    #[serde(rename = "_timestamp")]
    pub timestamp: i64,
    pub org_id: String,
    pub alert_id: String,
    pub group_key: String,
    /// Microseconds.
    pub firing_started_at: i64,
    pub run: bool,
    pub reason: ReasonCode,
    pub protected: bool,
    pub mark_lookup: MarkLookup,
    pub onsets_7d: u32,
    pub evaluations_7d: u32,
    pub fire_share_7d: f64,
    pub cooldown_applied_secs: Option<i64>,
    /// Previous auto-investigation of this alert + group, microseconds.
    pub last_run_at: Option<i64>,
    /// `updated_at` of the settings row used; 0 = code defaults.
    pub settings_version: i64,
    pub flapping_onsets_7d: u32,
    pub flapping_cooldown_secs: i64,
    pub base_cooldown_secs: i64,
    pub level: Option<AlertLevel>,
    pub destination: String,
    pub node: String,
    pub rca_run_id: Option<String>,
    pub entity_type: String,
    pub decision_kind: String,
    /// Only when `reason` is `budget`: which check refused.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget_check: Option<BudgetCheck>,
}

impl DecisionRow {
    pub fn new(decision: &Decision, inputs: &GateInputs, ctx: DecisionContext) -> Self {
        let settings = &inputs.settings;
        Self {
            timestamp: inputs.now,
            org_id: ctx.org_id,
            alert_id: ctx.alert_id,
            group_key: ctx.group_key,
            firing_started_at: ctx.firing_started_at,
            run: decision.run,
            reason: decision.reason,
            protected: decision.protected,
            mark_lookup: decision.mark_lookup,
            onsets_7d: decision.onsets_7d,
            evaluations_7d: decision.evaluations_7d,
            fire_share_7d: decision.fire_share_7d,
            cooldown_applied_secs: decision.cooldown_applied_secs,
            last_run_at: decision.last_run_at,
            settings_version: decision.settings_version.unwrap_or(0),
            flapping_onsets_7d: settings.flapping_onsets_7d,
            flapping_cooldown_secs: settings.flapping_cooldown_secs,
            base_cooldown_secs: settings.base_cooldown_secs,
            level: inputs.level,
            destination: ctx.destination,
            node: ctx.node,
            rca_run_id: ctx.rca_run_id,
            entity_type: DECISION_ENTITY_TYPE.to_string(),
            decision_kind: DECISION_KIND.to_string(),
            budget_check: (decision.reason == ReasonCode::Budget).then_some(inputs.budget),
        }
    }
}

/// What the caller knows about the episode that the gate does not read.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DecisionContext {
    pub org_id: String,
    pub alert_id: String,
    pub group_key: String,
    /// Microseconds.
    pub firing_started_at: i64,
    pub destination: String,
    pub node: String,
    pub rca_run_id: Option<String>,
}

/// Body of the decisions route, newest first.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct DecisionsResponse {
    pub decisions: Vec<DecisionRow>,
}

/// Query of `GET /v2/{org}/alerts/auto_investigate/decisions`.
#[derive(Clone, Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct DecisionsQuery {
    pub alert_id: Option<String>,
    /// Empty selects the ungrouped row.
    pub group_key: Option<String>,
    /// Microseconds, inclusive; defaults to 7 days before `end_time`.
    pub start_time: Option<i64>,
    /// Microseconds, exclusive; defaults to now.
    pub end_time: Option<i64>,
    /// A reason code such as `flapping`.
    pub reason: Option<String>,
    /// Defaults to 100, capped at 1000.
    pub limit: Option<usize>,
}

/// Onsets, evaluations and fire share of one alert + group over a window.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WindowStats {
    pub onsets: u32,
    pub evaluations: u32,
    pub fire_share: f64,
}

#[derive(Default)]
struct WindowWalk {
    onsets: u32,
    in_episode: bool,
    covered_us: i64,
    firing_us: i64,
}

impl WindowWalk {
    fn hold(&mut self, state: Option<&RunOutcome>, span_us: i64) {
        let Some(state) = state else { return };
        if matches!(state, RunOutcome::Skipped) {
            return;
        }
        self.covered_us += span_us;
        if state.is_firing() {
            self.firing_us += span_us;
        }
    }

    fn enter(&mut self, to: &RunOutcome, counts: bool) {
        if to.is_firing() {
            if !self.in_episode && counts {
                self.onsets += 1;
            }
            self.in_episode = true;
        } else if matches!(to, RunOutcome::Normal | RunOutcome::Succeeded) {
            self.in_episode = false;
        }
    }
}

/// Runs the gate; rules apply in [`ReasonCode`] order and the first match wins.
pub fn decide_auto_investigate(inputs: &GateInputs) -> Decision {
    let protected = inputs.protected && inputs.mark_lookup == MarkLookup::Ok;
    let (reason, cooldown_applied_secs) = gate_reason(inputs, protected);
    Decision {
        run: reason == ReasonCode::Eligible,
        reason,
        protected,
        mark_lookup: inputs.mark_lookup,
        onsets_7d: inputs.onsets_7d,
        evaluations_7d: inputs.evaluations_7d,
        fire_share_7d: inputs.fire_share_7d,
        cooldown_applied_secs,
        last_run_at: inputs.last_auto_investigated_at,
        settings_version: inputs.settings_version,
    }
}

/// Thread notice for a skip; the caller formats `next_run_after` from `next_eligible_at`.
pub fn thread_notice(decision: &Decision, now: i64, next_run_after: &str) -> Option<String> {
    match decision.reason {
        ReasonCode::Flapping => Some(format!(
            "Not investigated: fired {} times in 7 days; next auto-investigation after {next_run_after}",
            decision.onsets_7d
        )),
        ReasonCode::AlwaysFiring => Some(format!(
            "Not investigated: firing {}% of the last 7 days",
            (decision.fire_share_7d * 100.0).round() as i64
        )),
        ReasonCode::Cooldown => {
            let ago_us = now - decision.last_run_at.unwrap_or(now);
            let minutes = (ago_us / (60 * MICROS_PER_SEC)).max(1);
            Some(format!("Not investigated: investigated {minutes} min ago"))
        }
        ReasonCode::Budget => {
            Some("Not investigated: the org's investigation limit is reached".to_string())
        }
        ReasonCode::RcaRunning => Some("Already investigating".to_string()),
        ReasonCode::NotFire | ReasonCode::NotCritical | ReasonCode::Eligible => None,
    }
}

/// Gate figures from oldest-first transitions; `current` stands in when the window has none.
pub fn window_stats(
    transitions: &[StateTransition],
    current: Option<RunOutcome>,
    window_start: i64,
    now: i64,
    frequency_secs: i64,
) -> WindowStats {
    let (mut state, mut cursor) = match transitions.first() {
        None => (current, window_start),
        Some(first) if first.from_outcome.is_some() => (first.from_outcome.clone(), window_start),
        Some(first) => (None, first.at.clamp(window_start, now)),
    };
    let mut walk = WindowWalk {
        in_episode: state.as_ref().is_some_and(|s| s.is_firing()),
        ..Default::default()
    };
    for t in transitions {
        let at = t.at.clamp(window_start, now);
        walk.hold(state.as_ref(), at - cursor);
        walk.enter(&t.to_outcome, t.at >= window_start);
        state = Some(t.to_outcome.clone());
        cursor = at;
    }
    walk.hold(state.as_ref(), now - cursor);
    let evaluations = if frequency_secs > 0 {
        u32::try_from(walk.covered_us / (frequency_secs * MICROS_PER_SEC)).unwrap_or(u32::MAX)
    } else {
        0
    };
    let fire_share = if walk.covered_us > 0 {
        walk.firing_us as f64 / walk.covered_us as f64
    } else {
        0.0
    };
    WindowStats {
        onsets: walk.onsets,
        evaluations,
        fire_share,
    }
}

fn gate_reason(inputs: &GateInputs, protected: bool) -> (ReasonCode, Option<i64>) {
    if !inputs.is_new_fire {
        return (ReasonCode::NotFire, None);
    }
    if inputs.level != Some(AlertLevel::Critical) {
        return (ReasonCode::NotCritical, None);
    }
    if inputs.rca_running {
        return (ReasonCode::RcaRunning, None);
    }
    let s = &inputs.settings;
    let within = |cooldown_secs: i64| {
        inputs
            .last_auto_investigated_at
            .is_some_and(|at| inputs.now - at < cooldown_secs * MICROS_PER_SEC)
    };
    if within(s.base_cooldown_secs) {
        return (ReasonCode::Cooldown, Some(s.base_cooldown_secs));
    }
    let flapping = !protected && inputs.onsets_7d >= s.flapping_onsets_7d;
    let applied = if flapping {
        s.flapping_cooldown_secs
    } else {
        s.base_cooldown_secs
    };
    if flapping && within(applied) {
        return (ReasonCode::Flapping, Some(applied));
    }
    if !protected
        && inputs.evaluations_7d >= ALWAYS_FIRING_MIN_EVALUATIONS
        && inputs.fire_share_7d >= ALWAYS_FIRING_SHARE
    {
        return (ReasonCode::AlwaysFiring, Some(applied));
    }
    if inputs.budget != BudgetCheck::Allowed {
        return (ReasonCode::Budget, Some(applied));
    }
    (ReasonCode::Eligible, Some(applied))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60 * MICROS_PER_SEC;
    const HOUR: i64 = 60 * MIN;
    const DAY: i64 = 24 * HOUR;
    const NOW: i64 = 30 * DAY;

    type Case = (&'static str, fn(&mut GateInputs), ReasonCode);

    fn eligible() -> GateInputs {
        GateInputs {
            is_new_fire: true,
            level: Some(AlertLevel::Critical),
            rca_running: false,
            last_auto_investigated_at: None,
            protected: false,
            mark_lookup: MarkLookup::Ok,
            onsets_7d: 1,
            evaluations_7d: 100,
            fire_share_7d: 0.1,
            budget: BudgetCheck::Allowed,
            now: NOW,
            settings: GateSettings::default(),
            settings_version: Some(7),
        }
    }

    fn reason(edit: impl FnOnce(&mut GateInputs)) -> ReasonCode {
        let mut inputs = eligible();
        edit(&mut inputs);
        decide_auto_investigate(&inputs).reason
    }

    #[test]
    fn each_rule_produces_its_reason() {
        let cases: [Case; 10] = [
            ("eligible", |_| {}, ReasonCode::Eligible),
            ("repeat", |i| i.is_new_fire = false, ReasonCode::NotFire),
            (
                "warning",
                |i| i.level = Some(AlertLevel::Warning),
                ReasonCode::NotCritical,
            ),
            ("no level", |i| i.level = None, ReasonCode::NotCritical),
            ("running", |i| i.rca_running = true, ReasonCode::RcaRunning),
            (
                "cooldown",
                |i| i.last_auto_investigated_at = Some(NOW - 3 * HOUR),
                ReasonCode::Cooldown,
            ),
            (
                "flapping",
                |i| {
                    i.onsets_7d = 20;
                    i.last_auto_investigated_at = Some(NOW - 10 * HOUR);
                },
                ReasonCode::Flapping,
            ),
            (
                "always firing",
                |i| {
                    i.fire_share_7d = 0.95;
                    i.evaluations_7d = 500;
                },
                ReasonCode::AlwaysFiring,
            ),
            (
                "turn limit",
                |i| i.budget = BudgetCheck::TurnLimit,
                ReasonCode::Budget,
            ),
            (
                "ai usage",
                |i| i.budget = BudgetCheck::AiUsageRefused,
                ReasonCode::Budget,
            ),
        ];
        for (name, edit, want) in cases {
            let mut inputs = eligible();
            edit(&mut inputs);
            let d = decide_auto_investigate(&inputs);
            assert_eq!(d.reason, want, "{name}");
            assert_eq!(d.run, want == ReasonCode::Eligible, "{name}");
        }
    }

    #[test]
    fn the_first_matching_rule_wins() {
        let mut inputs = GateInputs {
            is_new_fire: false,
            level: Some(AlertLevel::Warning),
            rca_running: true,
            last_auto_investigated_at: Some(NOW - HOUR),
            onsets_7d: 50,
            evaluations_7d: 500,
            fire_share_7d: 1.0,
            budget: BudgetCheck::TurnLimit,
            ..eligible()
        };
        let mut seen = Vec::new();
        let unblock: [fn(&mut GateInputs); 7] = [
            |i| i.is_new_fire = true,
            |i| i.level = Some(AlertLevel::Critical),
            |i| i.rca_running = false,
            |i| i.last_auto_investigated_at = Some(NOW - 5 * HOUR),
            |i| i.last_auto_investigated_at = None,
            |i| i.fire_share_7d = 0.0,
            |i| i.budget = BudgetCheck::Allowed,
        ];
        for step in unblock {
            seen.push(decide_auto_investigate(&inputs).reason);
            step(&mut inputs);
        }
        seen.push(decide_auto_investigate(&inputs).reason);
        assert_eq!(
            seen,
            [
                ReasonCode::NotFire,
                ReasonCode::NotCritical,
                ReasonCode::RcaRunning,
                ReasonCode::Cooldown,
                ReasonCode::Flapping,
                ReasonCode::AlwaysFiring,
                ReasonCode::Budget,
                ReasonCode::Eligible,
            ]
        );
    }

    #[test]
    fn protected_skips_flapping_and_always_firing_but_not_cooldown_or_budget() {
        let flapping = |i: &mut GateInputs| {
            i.protected = true;
            i.onsets_7d = 50;
            i.last_auto_investigated_at = Some(NOW - 10 * HOUR);
        };
        assert_eq!(reason(flapping), ReasonCode::Eligible);
        assert_eq!(
            reason(|i| {
                i.protected = true;
                i.fire_share_7d = 1.0;
            }),
            ReasonCode::Eligible
        );
        assert_eq!(
            reason(|i| {
                i.protected = true;
                i.last_auto_investigated_at = Some(NOW - HOUR);
            }),
            ReasonCode::Cooldown
        );
        assert_eq!(
            reason(|i| {
                i.protected = true;
                i.budget = BudgetCheck::TurnLimit;
            }),
            ReasonCode::Budget
        );
        let mut inputs = eligible();
        flapping(&mut inputs);
        let d = decide_auto_investigate(&inputs);
        assert!(d.protected);
        assert_eq!(d.cooldown_applied_secs, Some(14_400));
    }

    #[test]
    fn only_an_ok_mark_lookup_lets_protection_reach_the_gate() {
        let flapping_protected = |lookup: MarkLookup| {
            let mut inputs = eligible();
            inputs.protected = true;
            inputs.mark_lookup = lookup;
            inputs.onsets_7d = 50;
            inputs.last_auto_investigated_at = Some(NOW - 10 * HOUR);
            decide_auto_investigate(&inputs)
        };
        let ok = flapping_protected(MarkLookup::Ok);
        assert_eq!((ok.reason, ok.protected), (ReasonCode::Eligible, true));
        for lookup in [MarkLookup::Failed, MarkLookup::NotChecked] {
            let d = flapping_protected(lookup);
            assert_eq!(d.reason, ReasonCode::Flapping, "{lookup:?}");
            assert!(!d.protected, "{lookup:?}");
            assert_eq!(d.mark_lookup, lookup);
        }
        assert_eq!(MarkLookup::default(), MarkLookup::NotChecked);
        assert_eq!(
            serde_json::to_value([MarkLookup::Ok, MarkLookup::Failed, MarkLookup::NotChecked])
                .unwrap(),
            serde_json::json!(["ok", "failed", "not_checked"])
        );
    }

    fn context() -> DecisionContext {
        DecisionContext {
            org_id: "acme".to_string(),
            alert_id: "2fAlert".to_string(),
            group_key: "g1".to_string(),
            firing_started_at: NOW - MIN,
            destination: "slack-oncall".to_string(),
            node: "alertmanager-0".to_string(),
            rca_run_id: None,
        }
    }

    #[test]
    fn a_decision_row_carries_every_field_and_budget_check_only_for_budget() {
        let inputs = GateInputs {
            settings_version: None,
            last_auto_investigated_at: Some(NOW - 2 * DAY),
            ..eligible()
        };
        let row = DecisionRow::new(&decide_auto_investigate(&inputs), &inputs, context());
        let json = serde_json::to_value(&row).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();
        keys.sort_unstable();
        let mut want = vec![
            "_timestamp",
            "org_id",
            "alert_id",
            "group_key",
            "firing_started_at",
            "run",
            "reason",
            "protected",
            "mark_lookup",
            "onsets_7d",
            "evaluations_7d",
            "fire_share_7d",
            "cooldown_applied_secs",
            "last_run_at",
            "settings_version",
            "flapping_onsets_7d",
            "flapping_cooldown_secs",
            "base_cooldown_secs",
            "level",
            "destination",
            "node",
            "rca_run_id",
            "entity_type",
            "decision_kind",
        ];
        want.sort_unstable();
        assert_eq!(keys, want);
        assert_eq!(json["_timestamp"], NOW);
        assert_eq!(json["settings_version"], 0);
        assert_eq!(json["entity_type"], "alert");
        assert_eq!(json["decision_kind"], "auto_investigate");
        assert_eq!(json["level"], "critical");
        assert_eq!(json["mark_lookup"], "ok");
        assert_eq!(json["base_cooldown_secs"], 14_400);
        assert_eq!(json["last_run_at"], NOW - 2 * DAY);
        assert_eq!(
            serde_json::from_value::<DecisionRow>(json).unwrap(),
            row,
            "a stored row reads back as written"
        );

        for (budget, want) in [
            (BudgetCheck::TurnLimit, "turn_limit"),
            (BudgetCheck::AiUsageRefused, "ai_usage_refused"),
        ] {
            let inputs = GateInputs {
                budget,
                ..eligible()
            };
            let row = DecisionRow::new(&decide_auto_investigate(&inputs), &inputs, context());
            assert_eq!(row.reason, ReasonCode::Budget);
            assert_eq!(row.settings_version, 7);
            assert_eq!(serde_json::to_value(&row).unwrap()["budget_check"], want);
        }
        let skipped = GateInputs {
            budget: BudgetCheck::TurnLimit,
            rca_running: true,
            ..eligible()
        };
        let row = DecisionRow::new(&decide_auto_investigate(&skipped), &skipped, context());
        assert_eq!(row.reason, ReasonCode::RcaRunning);
        assert_eq!(
            row.budget_check, None,
            "budget_check rides only a budget skip"
        );
    }

    #[test]
    fn reason_codes_parse_their_own_names_only() {
        for code in [
            ReasonCode::NotFire,
            ReasonCode::Cooldown,
            ReasonCode::AlwaysFiring,
            ReasonCode::Eligible,
        ] {
            assert_eq!(ReasonCode::parse(code.as_str()), Some(code));
        }
        assert_eq!(ReasonCode::parse("Cooldown"), None);
        assert_eq!(ReasonCode::parse("cooldown' OR '1'='1"), None);
    }

    #[test]
    fn the_flapping_cooldown_replaces_the_base_one() {
        let at = |last: i64, onsets: u32| {
            let mut inputs = eligible();
            inputs.last_auto_investigated_at = Some(NOW - last);
            inputs.onsets_7d = onsets;
            decide_auto_investigate(&inputs)
        };
        let blocked = at(5 * HOUR, 14);
        assert_eq!(blocked.reason, ReasonCode::Flapping);
        assert_eq!(blocked.cooldown_applied_secs, Some(86_400));
        assert_eq!(blocked.next_eligible_at(), Some(NOW - 5 * HOUR + DAY));
        assert_eq!(at(5 * HOUR, 13).reason, ReasonCode::Eligible);
        assert_eq!(at(5 * HOUR, 13).cooldown_applied_secs, Some(14_400));
        let after = at(25 * HOUR, 14);
        assert_eq!(after.reason, ReasonCode::Eligible);
        assert_eq!(after.cooldown_applied_secs, Some(86_400));
        assert_eq!(at(3 * HOUR, 14).reason, ReasonCode::Cooldown);
        assert_eq!(at(3 * HOUR, 14).cooldown_applied_secs, Some(14_400));
        assert_eq!(at(4 * HOUR, 1).reason, ReasonCode::Eligible);
        assert_eq!(at(4 * HOUR - 1, 1).reason, ReasonCode::Cooldown);
    }

    #[test]
    fn flapping_and_always_firing_boundaries() {
        let recent = Some(NOW - 10 * HOUR);
        let onsets = |n: u32| {
            reason(|i| {
                i.onsets_7d = n;
                i.last_auto_investigated_at = recent;
            })
        };
        assert_eq!(onsets(13), ReasonCode::Eligible);
        assert_eq!(onsets(14), ReasonCode::Flapping);
        let share = |share: f64, evaluations: u32| {
            reason(|i| {
                i.fire_share_7d = share;
                i.evaluations_7d = evaluations;
            })
        };
        assert_eq!(share(0.9, 19), ReasonCode::Eligible);
        assert_eq!(share(0.9, 20), ReasonCode::AlwaysFiring);
        assert_eq!(share(0.89, 20), ReasonCode::Eligible);
    }

    #[test]
    fn org_flapping_settings_move_the_threshold() {
        let settings = GateSettings {
            flapping_onsets_7d: 5,
            flapping_cooldown_secs: 7200,
            base_cooldown_secs: 3600,
        };
        let with = |onsets: u32, last: i64| {
            reason(|i| {
                i.settings = settings;
                i.onsets_7d = onsets;
                i.last_auto_investigated_at = Some(NOW - last);
            })
        };
        assert_eq!(with(5, 90 * MIN), ReasonCode::Flapping);
        assert_eq!(with(4, 90 * MIN), ReasonCode::Eligible);
        assert_eq!(with(5, 3 * HOUR), ReasonCode::Eligible);
        assert_eq!(with(1, 30 * MIN), ReasonCode::Cooldown);
    }

    #[test]
    fn the_decision_carries_the_figures_for_the_shadow_log() {
        let d = decide_auto_investigate(&GateInputs {
            onsets_7d: 3,
            evaluations_7d: 40,
            fire_share_7d: 0.25,
            last_auto_investigated_at: Some(NOW - 2 * DAY),
            ..eligible()
        });
        assert_eq!(
            serde_json::to_value(&d).unwrap(),
            serde_json::json!({
                "run": true, "reason": "eligible", "protected": false, "mark_lookup": "ok", "onsets_7d": 3,
                "evaluations_7d": 40, "fire_share_7d": 0.25, "cooldown_applied_secs": 14400,
                "last_run_at": NOW - 2 * DAY, "settings_version": 7
            })
        );
        let skipped = decide_auto_investigate(&GateInputs {
            is_new_fire: false,
            ..eligible()
        });
        assert_eq!(skipped.cooldown_applied_secs, None);
    }

    #[test]
    fn reason_codes_serialise_snake_case() {
        for code in [
            ReasonCode::NotFire,
            ReasonCode::NotCritical,
            ReasonCode::RcaRunning,
            ReasonCode::Cooldown,
            ReasonCode::Flapping,
            ReasonCode::AlwaysFiring,
            ReasonCode::Budget,
            ReasonCode::Eligible,
        ] {
            let json = serde_json::to_value(code).unwrap();
            assert_eq!(json, Value::String(code.as_str().to_string()));
            assert_eq!(serde_json::from_value::<ReasonCode>(json).unwrap(), code);
        }
        assert_eq!(ReasonCode::AlwaysFiring.as_str(), "always_firing");
    }

    #[test]
    fn settings_round_trip_and_defaults() {
        let defaults = GateSettings::default();
        let json = serde_json::to_value(defaults).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "flapping_onsets_7d": 14, "flapping_cooldown_secs": 86400, "base_cooldown_secs": 14400
            })
        );
        assert_eq!(GateSettings::parse(&json), Ok(defaults));
        let partial = serde_json::json!({"base_cooldown_secs": 7200});
        assert_eq!(
            GateSettings::parse(&partial).unwrap(),
            GateSettings {
                base_cooldown_secs: 7200,
                ..defaults
            }
        );
    }

    #[test]
    fn settings_validate_bounds() {
        let with = |onsets: u32, flap: i64, base: i64| {
            GateSettings {
                flapping_onsets_7d: onsets,
                flapping_cooldown_secs: flap,
                base_cooldown_secs: base,
            }
            .validate()
        };
        assert!(with(2, 3600, 604_800).is_ok());
        assert!(with(100, 604_800, 3600).is_ok());
        assert!(
            with(1, 3600, 3600)
                .unwrap_err()
                .contains("flapping_onsets_7d")
        );
        assert!(with(101, 3600, 3600).is_err());
        assert!(
            with(14, 3599, 3600)
                .unwrap_err()
                .contains("flapping_cooldown_secs")
        );
        assert!(with(14, 604_801, 3600).is_err());
        assert!(
            with(14, 3600, 3599)
                .unwrap_err()
                .contains("base_cooldown_secs")
        );
        assert!(with(14, 3600, 604_801).is_err());
    }

    #[test]
    fn resolve_falls_back_to_defaults() {
        let defaults = GateSettings::default();
        assert_eq!(GateSettings::resolve(None), defaults);
        for bad in [
            serde_json::json!({"flapping_onsets_7d": 1}),
            serde_json::json!({"base_cooldown_secs": "4h"}),
            serde_json::json!("fast"),
            Value::Null,
        ] {
            assert_eq!(GateSettings::resolve(Some(&bad)), defaults, "{bad}");
            assert!(GateSettings::parse(&bad).is_err(), "{bad}");
        }
        let good = serde_json::json!({"flapping_onsets_7d": 6});
        assert_eq!(GateSettings::resolve(Some(&good)).flapping_onsets_7d, 6);
    }

    fn tr(from: Option<RunOutcome>, to: RunOutcome, at: i64) -> StateTransition {
        StateTransition {
            alert_id: "a1".to_string(),
            group_key: "g1".to_string(),
            from_outcome: from,
            to_outcome: to,
            from_level: None,
            to_level: None,
            at,
            value: None,
            rule_value: None,
            group_labels: None,
        }
    }

    #[test]
    fn window_stats_count_onsets_not_error_blips() {
        use RunOutcome::{Error, Firing, Normal, NotifyFailed, Pending};
        let start = NOW - 7 * DAY;
        let transitions = [
            tr(Some(Normal), Firing, start + DAY),
            tr(Some(Firing), Error, start + DAY + HOUR),
            tr(Some(Error), NotifyFailed, start + DAY + 2 * HOUR),
            tr(Some(NotifyFailed), Normal, start + 2 * DAY),
            tr(Some(Normal), Pending, start + 3 * DAY),
            tr(Some(Pending), Firing, start + 3 * DAY + MIN),
            tr(Some(Firing), Normal, start + 4 * DAY),
            tr(Some(Normal), Firing, NOW),
        ];
        let stats = window_stats(&transitions, Some(Firing), start, NOW, 60);
        assert_eq!(stats.onsets, 3);
        assert_eq!(stats.evaluations, 7 * 24 * 60);
        let firing_us = (DAY - HOUR) + (DAY - MIN);
        let share = firing_us as f64 / (7 * DAY) as f64;
        assert!(
            (stats.fire_share - share).abs() < 1e-9,
            "{}",
            stats.fire_share
        );
    }

    #[test]
    fn an_episode_open_at_the_window_start_is_not_an_onset() {
        use RunOutcome::{Firing, Normal};
        let start = NOW - 7 * DAY;
        let transitions = [
            tr(Some(Firing), Normal, start + DAY),
            tr(Some(Normal), Firing, start + 2 * DAY),
        ];
        let stats = window_stats(&transitions, Some(Firing), start, NOW, 300);
        assert_eq!(stats.onsets, 1);
        assert!((stats.fire_share - 6.0 / 7.0).abs() < 1e-9);
        assert_eq!(stats.evaluations, 7 * 24 * 12);
    }

    #[test]
    fn a_week_long_fire_with_no_transition_is_always_firing() {
        let start = NOW - 7 * DAY;
        let stats = window_stats(&[], Some(RunOutcome::Firing), start, NOW, 3600);
        assert_eq!(
            stats,
            WindowStats {
                onsets: 0,
                evaluations: 168,
                fire_share: 1.0
            }
        );
        assert_eq!(
            window_stats(&[], None, start, NOW, 3600),
            WindowStats::default()
        );
    }

    #[test]
    fn coverage_starts_at_the_first_evaluation_and_skips_paused_time() {
        use RunOutcome::{Firing, Normal, Skipped};
        let start = NOW - 7 * DAY;
        let first = [tr(None, Firing, NOW - 10 * HOUR)];
        let stats = window_stats(&first, Some(Firing), start, NOW, 3600);
        assert_eq!((stats.onsets, stats.evaluations), (1, 10));
        assert!((stats.fire_share - 1.0).abs() < 1e-9);
        let paused = [
            tr(Some(Normal), Skipped, start),
            tr(Some(Skipped), Firing, NOW - DAY),
        ];
        let stats = window_stats(&paused, Some(Firing), start, NOW, 3600);
        assert_eq!((stats.onsets, stats.evaluations), (1, 24));
        assert!((stats.fire_share - 1.0).abs() < 1e-9);
        assert_eq!(window_stats(&first, None, start, NOW, 0).evaluations, 0);
    }

    #[test]
    fn thread_notices_follow_the_agreed_copy() {
        let notice = |edit: fn(&mut GateInputs)| {
            let mut inputs = eligible();
            edit(&mut inputs);
            thread_notice(&decide_auto_investigate(&inputs), NOW, "Oct 23, 14:05 UTC")
        };
        assert_eq!(
            notice(|i| {
                i.onsets_7d = 16;
                i.last_auto_investigated_at = Some(NOW - 10 * HOUR);
            })
            .as_deref(),
            Some(
                "Not investigated: fired 16 times in 7 days; next auto-investigation after Oct 23, 14:05 UTC"
            )
        );
        assert_eq!(
            notice(|i| i.fire_share_7d = 0.934).as_deref(),
            Some("Not investigated: firing 93% of the last 7 days")
        );
        assert_eq!(
            notice(|i| i.last_auto_investigated_at = Some(NOW - 42 * MIN - 30 * MICROS_PER_SEC))
                .as_deref(),
            Some("Not investigated: investigated 42 min ago")
        );
        assert_eq!(
            notice(|i| i.budget = BudgetCheck::AiUsageRefused).as_deref(),
            Some("Not investigated: the org's investigation limit is reached")
        );
        assert_eq!(
            notice(|i| i.rca_running = true).as_deref(),
            Some("Already investigating")
        );
        assert_eq!(notice(|i| i.is_new_fire = false), None);
        assert_eq!(notice(|i| i.level = Some(AlertLevel::Warning)), None);
        assert_eq!(notice(|_| {}), None);
    }
}
