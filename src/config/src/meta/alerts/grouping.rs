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

//! Multi-alerts: per-group evaluation — Feature 3 of `alerts_2.md`.
//!
//! Pure logic only: group identity, per-group classification, rollup severity
//! (M-2), the cardinality cap (M-6) and disappearance detection (M-7).
//! Persistence lives in `infra::table::alert_states`.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::{
    Aggregation, Operator, TriggerCondition,
    level::{AlertLevel, evaluate_level},
    state::{AlertState, ROLLUP_GROUP_KEY, StateTransition, StateUpdate, apply_outcome},
};
use crate::meta::self_reporting::usage::RunOutcome;

const MICROS_PER_SEC: i64 = 1_000_000;

/// Namespace for group labels exposed as template variables (M-4). The prefix
/// is the only thing stopping a label named `alert_name` from shadowing the
/// alert's own variable in a notification.
const GROUP_VAR_PREFIX: &str = "group.";

/// Separator for the group fingerprint component (M-5). Deliberately not the
/// `,dim=val` shape the base fingerprint uses for dimensions, so dimension
/// parsing can never mistake the group hash for a user field — the same
/// reasoning behind `with_level_component`'s `|level:`.
const GROUP_FINGERPRINT_SEP: &str = "|group:";

/// Default cardinality cap (M-6). Config-overridable; `0` means unlimited.
pub const DEFAULT_MAX_GROUPS: usize = 500;

/// Default disappearance multiplier (M-7): a group unseen for `K ×
/// frequency` is resolved. `K > 1` so a single missed evaluation — a slow
/// query, a scheduler hiccup — is not mistaken for a group going away.
pub const DEFAULT_DISAPPEARANCE_K: i64 = 3;

/// Lower bound on the resolve threshold. Guards the misconfiguration where a
/// zero/negative frequency would otherwise resolve every group on every pass.
pub const MIN_RESOLVE_THRESHOLD_SECS: i64 = 60;

/// Why an alert may not opt in to per-group evaluation (M-9/M-10).
///
/// Every variant is a *save-time* rejection. The alternative — accepting the
/// config and ignoring the part that conflicts — leaves a threshold visibly
/// set in the UI that silently does nothing, which is the failure mode D27
/// exists to prevent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MultiAlertError {
    /// `multi_alert` without a `group_by`: there are no groups to fan out to.
    NotGrouped,
    /// The critical group-count gate is not "any group" (M-10).
    CountGateNotAnyGroup,
    /// The warning group-count gate is not "any group" (M-10).
    WarningCountGateNotAnyGroup,
    /// `having.operator` has no severity direction, so neither a warning band
    /// nor the severity-ordered fetch can be defined over it.
    OperatorNotOrderable,
}

impl std::fmt::Display for MultiAlertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotGrouped => f.write_str(
                "per-group alerting requires at least one group_by column",
            ),
            Self::CountGateNotAnyGroup => f.write_str(
                "per-group alerting fires on any breaching group, so it cannot be combined with a \
                 group-count threshold; remove the count threshold or turn off per-group alerting",
            ),
            Self::WarningCountGateNotAnyGroup => f.write_str(
                "per-group alerting cannot be combined with a warning group-count threshold; \
                 remove it or turn off per-group alerting",
            ),
            Self::OperatorNotOrderable => f.write_str(
                "per-group alerting needs an ordered comparison (>, >=, <, <=); `=` and `!=` have \
                 no severity direction",
            ),
        }
    }
}

impl std::error::Error for MultiAlertError {}

/// Whether a group-count gate means "any group at all".
///
/// `>= 1` and `> 0` are the same statement; both are accepted so a UI that
/// normalises one way cannot make an otherwise-valid alert unsavable.
fn is_any_group_gate(op: Operator, threshold: i64) -> bool {
    match op {
        Operator::GreaterThanEquals => threshold == 1,
        Operator::GreaterThan => threshold == 0,
        _ => false,
    }
}

/// Validate an alert's opt-in to per-group evaluation (M-9/M-10).
///
/// A no-op for every alert that has not opted in — which is every alert that
/// existed before this feature, since [`Aggregation::multi_alert`] cannot be
/// present in JSON written before the field existed.
///
/// The count-gate rules are what make M-2's "rollup = most severe group" and
/// the legacy count-gated level provably the same verdict, so opting in never
/// rewrites what "firing" means for an alert (D27).
pub fn validate_multi_alert(
    agg: &Aggregation,
    tc: &TriggerCondition,
) -> Result<(), MultiAlertError> {
    if !agg.multi_alert {
        return Ok(());
    }

    match agg.group_by.as_deref() {
        Some(cols) if !cols.is_empty() => {}
        _ => return Err(MultiAlertError::NotGrouped),
    }

    if !matches!(
        agg.having.operator,
        Operator::GreaterThan
            | Operator::GreaterThanEquals
            | Operator::LessThan
            | Operator::LessThanEquals
    ) {
        return Err(MultiAlertError::OperatorNotOrderable);
    }

    if !is_any_group_gate(tc.operator, tc.threshold) {
        return Err(MultiAlertError::CountGateNotAnyGroup);
    }

    // The warning gate is the easy one to forget: legacy Warning fires on
    // `firing_count >= warning_threshold.unwrap_or(threshold)`, so a critical
    // gate of `>= 1` with a warning gate of 3 still diverges from M-2.
    if let Some(w) = tc.warning_threshold
        && !is_any_group_gate(tc.operator, w)
    {
        return Err(MultiAlertError::WarningCountGateNotAnyGroup);
    }

    Ok(())
}

/// Whether an evaluation's observation set is complete enough for a group's
/// absence to *prove* it disappeared (M-7).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GroupPageCompleteness {
    /// The fetch reached below the firing band, so every group that exists was
    /// returned and a tracked group's absence is real.
    Complete,
    /// The page filled while every row was still firing: more groups may exist
    /// beyond the cutoff, so absence proves nothing.
    Truncated,
}

/// How the bounded fetch page behaved (§5.3) — the difference between a count
/// this evaluation can state as fact and one it can only bound.
///
/// The multi-alert query fetches a severity-ordered page larger than the M-6
/// cap. That ordering is what makes a partial read usable at all: the worst
/// groups are provably in the page, so the rollup level is always exact. What
/// it cannot do is make the *counts* exact once the page fills.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FetchPage {
    /// The page came back at its size limit, so groups may exist beyond it.
    pub filled: bool,
    /// The page contained at least one non-firing group. Because the fetch is
    /// severity-ordered, that alone proves every firing group was returned.
    pub reached_healthy: bool,
}

impl Default for FetchPage {
    /// An exhaustive read: nothing was cut off, so every count is exact. This is
    /// the right default for callers that hand over a complete observation set
    /// (tests, and any evaluation whose result fit comfortably in one page).
    fn default() -> Self {
        Self {
            filled: false,
            reached_healthy: true,
        }
    }
}

impl FetchPage {
    /// Whether absence from this page *proves* a group disappeared (M-7).
    ///
    /// Reaching a healthy group is enough: severity ordering means every firing
    /// group is then already in hand, so no firing group can be hiding below
    /// the cutoff waiting to be falsely recovered.
    pub fn completeness(&self) -> GroupPageCompleteness {
        if !self.filled || self.reached_healthy {
            GroupPageCompleteness::Complete
        } else {
            GroupPageCompleteness::Truncated
        }
    }

    /// Whether the observed-group count can only be stated as `≥`.
    pub fn observed_is_lower_bound(&self) -> bool {
        self.filled
    }

    /// Whether the firing-group count can only be stated as `≥`.
    ///
    /// Strictly narrower than [`Self::observed_is_lower_bound`]: a full page
    /// that reached healthy groups has seen every firing one, so the firing
    /// count is exact even though the total is not.
    pub fn firing_is_lower_bound(&self) -> bool {
        self.filled && !self.reached_healthy
    }
}

/// Whether M-7 aging may run for an alert this sweep.
///
/// **Absence must be proven, not assumed.** Elapsed time alone cannot tell "the
/// group went away" from "we did not look". A query outage lasting K intervals
/// would otherwise age every group past its deadline at once: mass `Ok`
/// resolutions for groups that never recovered, followed by a mass re-fire when
/// the query comes back — an alert storm manufactured out of an outage, during
/// exactly the incident the alerts exist to report. §7.6's rule is that levels
/// rot rather than reset, and this is that rule applied to the group axis.
pub fn may_age_groups(last_outcome: Option<&RunOutcome>, page: GroupPageCompleteness) -> bool {
    if page == GroupPageCompleteness::Truncated {
        return false;
    }
    match last_outcome {
        // The evaluation produced a usable observation set. `NotifyFailed` is
        // included deliberately: the query succeeded and only delivery failed,
        // so the observations are as trustworthy as any other firing run.
        Some(RunOutcome::Firing | RunOutcome::Normal | RunOutcome::NotifyFailed) => true,
        // `Error` (query failed), `Skipped` (paused/silenced/never evaluated),
        // `Succeeded` (a non-condition module, which carries no groups at all),
        // and `None` (never evaluated) all mean we did not observe.
        _ => false,
    }
}

/// One group's observed value for a single evaluation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GroupObservation {
    pub labels: BTreeMap<String, String>,
    pub actual_value: f64,
}

impl GroupObservation {
    pub fn new(labels: BTreeMap<String, String>, actual_value: f64) -> Self {
        Self {
            labels,
            actual_value,
        }
    }
}

/// A group after threshold classification.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClassifiedGroup {
    pub labels: BTreeMap<String, String>,
    pub actual_value: f64,
    /// `None` = matched no threshold (healthy).
    pub level: Option<AlertLevel>,
}

impl ClassifiedGroup {
    fn rank(&self) -> u8 {
        self.level.map(|l| l.severity_rank()).unwrap_or(0)
    }
}

/// Whether the cardinality cap truncated this evaluation (M-6).
///
/// Overflow must be *reported*, never silent: a 900-group alert that renders as
/// a 500-group one is indistinguishable from a correct result.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum GroupCapOutcome {
    WithinCap,
    Exceeded { observed: usize, cap: usize },
}

/// Result of classifying one evaluation's groups.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GroupClassification {
    /// Retained groups, most severe first.
    pub groups: Vec<ClassifiedGroup>,
    /// Rollup row level (M-2) — `None` only when no groups were observed.
    pub rollup: Option<AlertLevel>,
    pub cap: GroupCapOutcome,
    /// Firing (warning-or-worse) groups among **all** observed, counted before
    /// the cap truncated anything. Feeds the rollup row's `groups_firing`.
    ///
    /// Cannot be recomputed from `groups`: those are post-cap, so an
    /// overflowing alert would report the cap instead of the real number.
    pub firing_observed: usize,
    /// How the fetch page that produced these observations behaved (§5.3).
    /// Decides whether the persisted counts are exact or lower bounds.
    pub page: FetchPage,
    /// Group keys observed this evaluation but truncated by the cap.
    ///
    /// Kept separate from "not observed at all": an evicted group is deleted
    /// outright with no transition, while a *vanished* one is resolved first
    /// (M-7). Without this list the planner cannot tell the two apart, and
    /// would either write false recoveries for evicted groups or leak their
    /// rows past the cap.
    pub dropped: Vec<String>,
}

impl GroupClassification {
    /// Record how the fetch page behaved (§5.3).
    ///
    /// Separate from [`classify_groups`] because classification sees only the
    /// rows it was handed — whether the query had more to give is knowledge
    /// only the caller that issued it has.
    pub fn with_page(mut self, page: FetchPage) -> Self {
        self.page = page;
        self
    }

    /// The group that produced the worst level — the one whose value goes on
    /// the single per-evaluation trigger record (D8).
    pub fn worst_group(&self) -> Option<&ClassifiedGroup> {
        self.groups
            .iter()
            .filter(|g| g.level.is_some())
            .max_by_key(|g| g.rank())
    }
}

/// Stable, collision-resistant identity for a label set.
///
/// Length-prefixed encoding before hashing: a naive `k=v` join lets a label
/// *value* impersonate an extra label (`{extra:"b,host=a"}` would collide with
/// `{extra:"b", host:"a"}`), which would let user-controlled data corrupt
/// another group's state row.
///
/// Hashed rather than joined because `alert_states.group_key` is
/// `VARCHAR(256)`; a raw join overflows it for realistic k8s label sets.
pub fn group_key(labels: &BTreeMap<String, String>) -> String {
    let mut buf = String::new();
    // BTreeMap iterates sorted, so the encoding is order-insensitive.
    for (k, v) in labels {
        buf.push_str(&format!("{}:{}:{}:{};", k.len(), k, v.len(), v));
    }
    // 64 hex chars — comfortably inside the column, and never the empty string,
    // so an ungrouped result can never be mistaken for the rollup row.
    sha256::digest(buf)
}

/// Rollup level across a set of per-group levels (M-2).
///
/// A group matching no threshold contributes `Ok` — it is healthy, not
/// "no opinion". An empty set returns `None`: no groups at all is a distinct
/// state from "all groups fine" (the `NoData` hook, §7.3).
pub fn rollup_level(levels: &[Option<AlertLevel>]) -> Option<AlertLevel> {
    if levels.is_empty() {
        return None;
    }
    AlertLevel::most_severe(levels.iter().map(|l| l.unwrap_or(AlertLevel::Ok)))
}

/// Classify every observed group, applying the cardinality cap.
///
/// Admission is `(severity desc, group_key asc)`: severity always wins, so a
/// Critical group can never be evicted to keep an `Ok` one, and the tiebreak is
/// deterministic so an unchanged observation set retains an unchanged row set
/// (no churn from re-selection). `cap == 0` means unlimited.
pub fn classify_groups(
    observations: Vec<GroupObservation>,
    tc: &TriggerCondition,
    cap: usize,
) -> GroupClassification {
    classify_groups_by(observations, |v| evaluate_level(v, tc), cap)
}

/// [`classify_groups`] with the per-group threshold source supplied by the
/// caller.
///
/// Exists because the two grouped alert families read their thresholds from
/// different places: a count-based alert compares each group against
/// `TriggerCondition.threshold`, while an **aggregation** alert compares each
/// group's aggregate against `having.value`/`warning_value` — for which
/// `TriggerCondition.threshold` is the group-COUNT gate, not a value at all.
/// Passing a `TriggerCondition` to both would silently compare aggregates
/// against a count.
pub fn classify_groups_by<F>(
    observations: Vec<GroupObservation>,
    classify: F,
    cap: usize,
) -> GroupClassification
where
    F: Fn(f64) -> Option<AlertLevel>,
{
    let observed = observations.len();

    let mut groups: Vec<ClassifiedGroup> = observations
        .into_iter()
        .map(|o| {
            let level = classify(o.actual_value);
            ClassifiedGroup {
                labels: o.labels,
                actual_value: o.actual_value,
                level,
            }
        })
        .collect();

    // Counted BEFORE truncation: post-cap counting would report the cap back to
    // the UI as though it were the real number of firing groups.
    let firing_observed = groups
        .iter()
        .filter(|g| g.level.is_some_and(|l| l.is_firing()))
        .count();

    groups.sort_by(|a, b| {
        b.rank()
            .cmp(&a.rank())
            .then_with(|| group_key(&a.labels).cmp(&group_key(&b.labels)))
    });

    let (cap_outcome, dropped) = if cap > 0 && observed > cap {
        let dropped = groups[cap..].iter().map(|g| group_key(&g.labels)).collect();
        groups.truncate(cap);
        (GroupCapOutcome::Exceeded { observed, cap }, dropped)
    } else {
        (GroupCapOutcome::WithinCap, Vec::new())
    };

    // Computed from retained groups; since admission is severity-first, the
    // most severe group is always retained, so this equals the true rollup.
    let levels: Vec<Option<AlertLevel>> = groups.iter().map(|g| g.level).collect();

    GroupClassification {
        rollup: rollup_level(&levels),
        groups,
        cap: cap_outcome,
        firing_observed,
        // Defaults to an exhaustive read; callers reading a bounded page say so
        // with `with_page`.
        page: FetchPage::default(),
        dropped,
    }
}

/// Group keys present in the previous evaluation but absent from this one
/// (M-7). Callers age these out on elapsed time rather than resolving them
/// immediately — a single missing evaluation is not a disappearance.
pub fn vanished_groups(previous: &[String], current: &[String]) -> Vec<String> {
    previous
        .iter()
        .filter(|k| !current.contains(k))
        .cloned()
        .collect()
}

/// Human-readable form of a label set, for the display companion column.
///
/// Display only — never an identity. [`group_key`] stays the primary key
/// precisely because a readable rendering is ambiguous under label values that
/// contain the separators.
pub fn render_labels(labels: &BTreeMap<String, String>) -> String {
    labels
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// Template variables exposed to a per-group notification (M-4), as
/// `("group.host", "web-1")` pairs ready for the existing
/// `process_variable_replace` machinery.
pub fn group_template_vars(labels: &BTreeMap<String, String>) -> Vec<(String, String)> {
    // Values are returned verbatim; a label value containing `{...}` is real
    // user data. The defence against it expanding is substitution ORDER —
    // group variables are applied last, so nothing runs after to expand them.
    labels
        .iter()
        .map(|(k, v)| (format!("{GROUP_VAR_PREFIX}{k}"), v.clone()))
        .collect()
}

/// The run outcome a single group's classified level implies.
///
/// This is the level axis (how bad) projected onto the outcome axis (did it
/// fire) for one group — the two stay separate everywhere else.
pub fn group_outcome(level: Option<AlertLevel>) -> RunOutcome {
    // `None` = matched no threshold = healthy, not "unknown". Never `Skipped`:
    // that means "not evaluated" and `apply_outcome` drops it, which would
    // freeze the group's row permanently.
    match level {
        Some(l) if l.is_firing() => RunOutcome::Firing,
        _ => RunOutcome::Normal,
    }
}

/// How long a group may go unobserved before it is resolved (M-7), in
/// microseconds.
///
/// Clamped below by [`MIN_RESOLVE_THRESHOLD_SECS`] and saturating above: the
/// arithmetic runs on operator-supplied numbers, and both a zero and an
/// overflow would silently resolve live groups.
pub fn resolve_threshold_micros(frequency_secs: i64, k: i64) -> i64 {
    let floor = MIN_RESOLVE_THRESHOLD_SECS.saturating_mul(MICROS_PER_SEC);
    if frequency_secs <= 0 || k <= 0 {
        return floor;
    }
    frequency_secs
        .saturating_mul(k)
        .saturating_mul(MICROS_PER_SEC)
        .max(floor)
}

/// [`resolve_threshold_micros`] for a **cron-scheduled** alert (M-7).
///
/// A cron alert's numeric `frequency` is not the cadence it actually runs at,
/// so `K × frequency` is meaningless for it. Nor can the interval be sampled at
/// sweep time — "the gap between the next two fires" is not a constant for
/// monthly, weekday-only or DST-crossing expressions, so a row's deadline would
/// move between sweeps and a group could resolve early on one pass and late on
/// the next.
///
/// The deadline is therefore **anchored to the row**: the Kth occurrence
/// strictly *after* `last_seen`. `occurrences` must be ascending and start at
/// or before `last_seen` (cron parsing stays at the call site, which owns the
/// timezone). Returns the gap as a duration so it drops straight into
/// [`group_fate`]'s `resolve_after`.
pub fn cron_resolve_threshold_micros(
    last_seen: i64,
    occurrences: impl IntoIterator<Item = i64>,
    k: i64,
) -> i64 {
    let floor = MIN_RESOLVE_THRESHOLD_SECS.saturating_mul(MICROS_PER_SEC);
    if k <= 0 {
        return floor;
    }

    // Strictly after: an occurrence at exactly `last_seen` is the run that
    // observed the group, not a run that missed it.
    let deadline = occurrences
        .into_iter()
        .filter(|o| *o > last_seen)
        .nth((k - 1) as usize);

    match deadline {
        Some(at) => at.saturating_sub(last_seen).max(floor),
        // Fewer than K future occurrences are known — a schedule that has run
        // out, or a caller that supplied too short a horizon. Never resolve on
        // that basis: saturating high leaves the group alone, while any finite
        // fallback would resolve live groups on a schedule nobody chose.
        None => i64::MAX,
    }
}

/// What should happen to a per-group state row that was not observed this
/// evaluation (M-7).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GroupFate {
    /// Leave the row untouched — either recently seen, or already resolved and
    /// still inside its grace period.
    Keep,
    /// Unseen past the threshold — write a final resolving transition.
    Resolve,
    /// Resolved and past the grace period — delete the row.
    Reap,
}

/// Decide a vanished group's fate. Times are microseconds, matching
/// `AlertState`'s timestamps.
///
/// Takes the whole row rather than a bare timestamp because age alone cannot
/// answer this. Sweeps are not continuous — after scheduler downtime the first
/// sweep may see a row that is already older than `resolve_after + grace`. If
/// the decision were age-only, that row would go straight to [`GroupFate::Reap`]
/// and be deleted **without ever writing the mandatory final `Ok` transition**,
/// silently erasing a firing group from history. A row that has not yet been
/// resolved must therefore resolve first, however old it is; only an
/// already-resolved row can be reaped, measured from when it resolved.
pub fn group_fate(state: &AlertState, now: i64, resolve_after: i64, grace: i64) -> GroupFate {
    if is_resolved(state) {
        // Reap measured from the resolution, not from `last_seen` — a group
        // that was healthy for days before vanishing would otherwise be reaped
        // the instant it resolved, taking its recovery out of the UI with it.
        let resolved_at = state.last_outcome_at.unwrap_or(now);
        return if now.saturating_sub(resolved_at) > grace {
            GroupFate::Reap
        } else {
            GroupFate::Keep
        };
    }

    // No `last_seen` at all: a row written before the M-7 migration. Reading
    // NULL as "epoch" would resolve or reap every legacy row on the first
    // sweep after upgrade, so leave it alone — the next observation sets it.
    let Some(last_seen) = state.last_seen else {
        return GroupFate::Keep;
    };

    // `saturating_sub` on signed values keeps a future `last_seen` (clock skew,
    // NTP step) negative rather than wrapping to something enormous.
    if now.saturating_sub(last_seen) <= resolve_after {
        GroupFate::Keep
    } else {
        // Never straight to Reap: the final Ok transition is mandatory, and a
        // sweep after downtime can otherwise see a row already past
        // resolve_after + grace on its very first look.
        GroupFate::Resolve
    }
}

/// Whether this row was last written by a *resolution* rather than an
/// observation. The two clocks only diverge when M-7 resolves a group, so the
/// gap is the marker — no extra column needed.
fn is_resolved(state: &AlertState) -> bool {
    match (state.last_outcome_at, state.last_seen) {
        (Some(outcome_at), Some(seen)) => outcome_at > seen,
        _ => false,
    }
}

/// Build the final write for a group that has disappeared (M-7), once
/// [`group_fate`] has returned [`GroupFate::Resolve`].
///
/// **Preserves `last_seen`; advances `last_outcome_at`.** `last_seen` is the
/// disappearance anchor — touching it would reset the clock and the row could
/// never reach [`GroupFate::Reap`]. `last_outcome_at` is when the recorded
/// outcome was *decided*, and the recovery is decided now; freezing it would
/// date the `Normal` outcome to a moment when the group was still firing.
///
/// The gap between the two is what makes "already resolved" derivable:
/// `last_outcome_at > last_seen` means this row was resolved rather than
/// observed. Re-resolving such a row is a **full noop** — not merely a
/// transition-free write. Advancing `last_outcome_at` on every sweep would push
/// the reap clock out by one interval each time, and the row would sit in the
/// table forever.
pub fn resolve_group_update(
    alert_id: &str,
    group_key: &str,
    prev: &AlertState,
    at: i64,
) -> StateUpdate {
    if is_resolved(prev) {
        return StateUpdate::noop();
    }

    let outcome_changed = prev.last_outcome != Some(RunOutcome::Normal);
    let level_changed = prev.level != Some(AlertLevel::Ok);

    let state = AlertState {
        alert_id: alert_id.to_string(),
        group_key: group_key.to_string(),
        last_outcome: Some(RunOutcome::Normal),
        // Advances: the recovery is decided now.
        last_outcome_at: Some(at),
        since: if outcome_changed {
            Some(at)
        } else {
            prev.since
        },
        level: Some(AlertLevel::Ok),
        level_since: if level_changed {
            Some(at)
        } else {
            prev.level_since
        },
        level_at: Some(at),
        // Frozen: this is a decision about an absence, not an observation.
        // Also what keeps `is_resolved` true from here on.
        last_seen: prev.last_seen,
        group_labels: prev.group_labels.clone(),
        groups_observed: prev.groups_observed,
        groups_firing: prev.groups_firing,
        groups_observed_is_lower_bound: prev.groups_observed_is_lower_bound,
        groups_firing_is_lower_bound: prev.groups_firing_is_lower_bound,
    };

    // An already-Ok group that vanished changes nothing on either axis, so no
    // transition — but the state write above still happens, and it is what
    // marks the row resolved and therefore reapable.
    let transition = (outcome_changed || level_changed).then(|| StateTransition {
        alert_id: alert_id.to_string(),
        group_key: group_key.to_string(),
        from_outcome: prev.last_outcome.clone(),
        to_outcome: RunOutcome::Normal,
        from_level: prev.level,
        to_level: Some(AlertLevel::Ok),
        at,
        // The group stopped being returned, so there is no observation. `0.0`
        // would render in history as a real measurement of zero.
        value: None,
        group_labels: prev.group_labels.clone(),
    });

    StateUpdate {
        state: Some(state),
        transition,
    }
}

/// Append the group as an implicit fingerprint component (M-5).
///
/// Mirrors `with_level_component` in `core::alerts::deduplication`, and lives
/// here rather than beside it because the base fingerprint has an OSS fallback
/// (`alert.get_unique_key()`) — the group component has to apply on both paths,
/// so it cannot sit in an enterprise-gated module.
///
/// `None` (and the rollup key) return the base **unchanged**, so every existing
/// ungrouped alert keeps its fingerprint byte-for-byte across the upgrade and
/// no live silence window is invalidated.
pub fn with_group_component(base: String, group_key: Option<&str>) -> String {
    match group_key {
        Some(k) if k != ROLLUP_GROUP_KEY => format!("{base}{GROUP_FINGERPRINT_SEP}{k}"),
        _ => base,
    }
}

/// Fan one evaluation out into per-group state updates plus the rollup row
/// (M-1, M-2, M-3).
///
/// `prev` is keyed by `group_key`. Groups absent from `classification` are
/// **not** touched — their resolution is [`group_fate`]'s job, on elapsed time,
/// not this function's.
/// The complete set of writes for one grouped evaluation.
///
/// Everything here commits in **one transaction** (§7.2): composites read the
/// rollup, and a rollup inconsistent with partially-written group rows would
/// feed them a state that never existed.
#[derive(Clone, Debug, PartialEq)]
pub struct GroupPlan {
    /// Per-group upserts plus the rollup row.
    pub updates: Vec<StateUpdate>,
    /// Group keys to **delete outright**, no transition written (M-6).
    ///
    /// An eviction is bookkeeping, not a level change: the group may well still
    /// be firing in reality, so writing a recovery row would be a lie. Deleting
    /// is what keeps stored rows actually bounded by the cap under churn.
    pub evicted: Vec<String>,
}

/// Group rows to delete when an alert turns `multi_alert` **off** (M-9/D26).
///
/// Every non-rollup row, deleted outright with **no transitions**. Opting out
/// is a configuration change, not a recovery: the groups did not get better,
/// they stopped being evaluated. Draining them through M-7 instead would write
/// a wave of `Ok` transitions recording recoveries that never happened, and
/// would leave stale firing groups on screen for K×interval plus the grace
/// period — so the "just turn it off" rollback would visibly not work.
///
/// The rollup row is deliberately untouched: it is the alert's own state and
/// the simple-alert path keeps writing it. Transition history is retained, so
/// per-group history stays readable (M-8) after the live rows are gone.
pub fn opt_out_evictions(tracked: &HashMap<String, AlertState>) -> Vec<String> {
    let mut keys: Vec<String> = tracked
        .keys()
        .filter(|k| k.as_str() != ROLLUP_GROUP_KEY)
        .cloned()
        .collect();
    // `tracked` is a HashMap; a stable delete batch keeps the write
    // deterministic and the logs readable.
    keys.sort();
    keys
}

pub fn plan_group_updates(
    alert_id: &str,
    classification: &GroupClassification,
    prev: &HashMap<String, AlertState>,
    at: i64,
) -> GroupPlan {
    let mut updates = Vec::with_capacity(classification.groups.len() + 1);
    let mut retained: HashSet<String> = HashSet::with_capacity(classification.groups.len());

    for group in &classification.groups {
        let key = group_key(&group.labels);
        let rendered = render_labels(&group.labels);
        retained.insert(key.clone());

        // A group below every threshold is healthy — `Ok`, not `None`. `None`
        // means "nothing was classified", which would make `apply_outcome`
        // carry the previous level forward and a recovered group would keep
        // reading as Critical.
        let level = group.level.unwrap_or(AlertLevel::Ok);

        let mut update = apply_outcome(
            alert_id,
            &key,
            prev.get(&key),
            group_outcome(group.level),
            Some(level),
            at,
        );

        if let Some(state) = update.state.as_mut() {
            state.group_labels = Some(rendered.clone());
            // Rollup-only field; a group row carrying it would make the
            // overflow warning renderable from the wrong row.
            state.groups_observed = None;
        }
        if let Some(t) = update.transition.as_mut() {
            // M-8: per-group history renders from the transition alone, because
            // the state row is reaped. Without these it cannot show what fired
            // or say for whom.
            t.value = Some(group.actual_value);
            t.group_labels = Some(rendered);
        }
        updates.push(update);
    }

    // ── Rollup row (M-2) ────────────────────────────────────────────────────
    // `classification.rollup` is passed straight through, including `None` for
    // an evaluation that observed no groups at all. That `None` makes
    // `apply_outcome` carry the level axis forward *without* refreshing
    // `level_at`, so composite staleness (§6.4) sees the level rotting rather
    // than being made fresh by a run that observed nothing. §7.3 (NoData) owns
    // turning that into a real level.
    let mut rollup = apply_outcome(
        alert_id,
        ROLLUP_GROUP_KEY,
        prev.get(ROLLUP_GROUP_KEY),
        group_outcome(classification.rollup),
        classification.rollup,
        at,
    );
    if let Some(state) = rollup.state.as_mut() {
        state.group_labels = None;
        // The TRUE count, pre-cap. `classification.groups.len()` is post-cap,
        // so an overflowing alert would report "500 of 500" and be
        // indistinguishable from one that never overflowed.
        state.groups_observed = Some(classification.groups.len() + classification.dropped.len());
        state.groups_firing = Some(classification.firing_observed);
        // Exactness travels WITH the counts. Recomputing it later is impossible
        // — the cap is mutable config, so "count == cap" proves nothing after
        // someone raises it.
        state.groups_observed_is_lower_bound = Some(classification.page.observed_is_lower_bound());
        state.groups_firing_is_lower_bound = Some(classification.page.firing_is_lower_bound());
    }
    updates.push(rollup);

    // Only rows we actually track can be deleted. A group dropped by the cap
    // that was never persisted has nothing to evict.
    let evicted = match classification.cap {
        // The page is authoritative: everything that exists was returned, so a
        // tracked group missing from it genuinely vanished and M-7 owns it on
        // elapsed time. Only the cap's own casualties are evicted.
        GroupCapOutcome::WithinCap => classification
            .dropped
            .iter()
            .filter(|k| prev.contains_key(*k))
            .cloned()
            .collect(),
        // Overflowing, absence proves nothing — a tracked group missing from
        // the page may be firing just below the cutoff. Aging it would write a
        // recovery for a group that never recovered, so every untracked-this-
        // pass row is treated as evicted instead: deleted outright, no
        // transition, exactly like any other cap casualty. The row returns on
        // the next evaluation that has room for it.
        GroupCapOutcome::Exceeded { .. } => {
            let mut gone: Vec<String> = prev
                .keys()
                .filter(|k| k.as_str() != ROLLUP_GROUP_KEY && !retained.contains(*k))
                .cloned()
                .collect();
            // `prev` is a HashMap, so its iteration order is not stable. The
            // plan must be, or identical observations would produce unequal
            // plans between evaluations.
            gone.sort();
            gone
        }
    };

    GroupPlan { updates, evicted }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::meta::alerts::{
        Operator, TriggerCondition,
        grouping::{GroupCapOutcome, GroupObservation, classify_groups, group_key, rollup_level},
        level::AlertLevel,
    };

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn tc(op: Operator, critical: i64, warning: Option<i64>) -> TriggerCondition {
        TriggerCondition {
            operator: op,
            threshold: critical,
            warning_threshold: warning,
            ..Default::default()
        }
    }

    // ── group_key: deterministic identity ───────────────────────────────────
    // The key is the primary key of `alert_states`, so it must be stable
    // across processes and insensitive to label ordering.

    #[test]
    fn test_group_key_is_stable_for_same_labels() {
        let a = group_key(&labels(&[("host", "a"), ("env", "prod")]));
        let b = group_key(&labels(&[("host", "a"), ("env", "prod")]));
        assert_eq!(a, b);
    }

    #[test]
    fn test_group_key_is_order_insensitive() {
        // BTreeMap already sorts, but the contract must hold regardless of the
        // order the query returned the columns in.
        let a = group_key(&labels(&[("env", "prod"), ("host", "a")]));
        let b = group_key(&labels(&[("host", "a"), ("env", "prod")]));
        assert_eq!(a, b);
    }

    #[test]
    fn test_group_key_differs_per_group() {
        let a = group_key(&labels(&[("host", "a")]));
        let b = group_key(&labels(&[("host", "b")]));
        assert_ne!(a, b);
    }

    #[test]
    fn test_group_key_resists_delimiter_injection() {
        // A naive `sorted k=v joined by ","` encoding collides here: BOTH of
        // these render as `extra=b,host=a`. A label value chosen by a user
        // (a hostname, a k8s label) could therefore be made to impersonate a
        // different group and corrupt its state row.
        //
        // An earlier version of this test compared {host:"a,b"} against
        // {host:"a", extra:"b"} — those differ under the naive encoding too,
        // so it passed against a vulnerable implementation.
        let two_labels = group_key(&labels(&[("extra", "b"), ("host", "a")]));
        let one_label = group_key(&labels(&[("extra", "b,host=a")]));
        assert_ne!(
            two_labels, one_label,
            "delimiter injection must not let one label impersonate two"
        );
    }

    #[test]
    fn test_group_key_is_bounded_in_length() {
        // `alert_states.group_key` is VARCHAR(256) (alerts.md Part IV). A raw
        // label join would overflow it for realistic k8s label sets and the
        // insert would fail — or silently truncate and merge distinct groups.
        let long = labels(&[
            ("k8s_namespace", &"n".repeat(200)),
            ("k8s_pod_name", &"p".repeat(200)),
            ("k8s_container", &"c".repeat(200)),
        ]);
        let key = group_key(&long);
        assert!(
            key.len() <= 256,
            "group_key must fit the column; got {} chars",
            key.len()
        );
    }

    #[test]
    fn test_empty_labels_never_collide_with_rollup_key() {
        use crate::meta::alerts::state::ROLLUP_GROUP_KEY;
        // An ungrouped result must not be written as if it were the rollup row.
        assert_ne!(group_key(&BTreeMap::new()), ROLLUP_GROUP_KEY);
    }

    // ── M-1: each group classified independently ────────────────────────────

    #[test]
    fn test_each_group_gets_its_own_level() {
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let obs = vec![
            GroupObservation::new(labels(&[("host", "a")]), 150.0),
            GroupObservation::new(labels(&[("host", "b")]), 75.0),
            GroupObservation::new(labels(&[("host", "c")]), 10.0),
        ];

        let result = classify_groups(obs, &c, 500);
        let by_host = |h: &str| {
            result
                .groups
                .iter()
                .find(|g| g.labels.get("host").map(String::as_str) == Some(h))
                .unwrap()
                .level
        };

        assert_eq!(by_host("a"), Some(AlertLevel::Critical));
        assert_eq!(by_host("b"), Some(AlertLevel::Warning));
        assert_eq!(by_host("c"), None, "below both thresholds");
    }

    #[test]
    fn test_group_observation_carries_actual_value_for_t9() {
        // T-9: the actual value must survive classification so it can be
        // written to the triggers stream.
        let c = tc(Operator::GreaterThan, 100, None);
        let result = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 137.5)],
            &c,
            500,
        );
        assert_eq!(result.groups[0].actual_value, 137.5);
    }

    // ── M-2: rollup = most severe across groups ─────────────────────────────

    #[test]
    fn test_rollup_is_most_severe_group() {
        assert_eq!(
            rollup_level(&[
                Some(AlertLevel::Ok),
                Some(AlertLevel::Warning),
                Some(AlertLevel::Critical)
            ]),
            Some(AlertLevel::Critical)
        );
        assert_eq!(
            rollup_level(&[Some(AlertLevel::Ok), Some(AlertLevel::Warning)]),
            Some(AlertLevel::Warning)
        );
    }

    #[test]
    fn test_rollup_of_all_ok_is_ok() {
        assert_eq!(
            rollup_level(&[Some(AlertLevel::Ok), Some(AlertLevel::Ok)]),
            Some(AlertLevel::Ok)
        );
    }

    #[test]
    fn test_rollup_ignores_unmatched_groups() {
        // A group below every threshold contributes Ok, not "no opinion".
        assert_eq!(
            rollup_level(&[None, Some(AlertLevel::Warning)]),
            Some(AlertLevel::Warning)
        );
        assert_eq!(rollup_level(&[None, None]), Some(AlertLevel::Ok));
    }

    #[test]
    fn test_rollup_of_no_groups_is_none() {
        // No rows at all is NOT "everything is fine" — it is a distinct state
        // that the NoData policy (§7.3) will own.
        assert_eq!(rollup_level(&[]), None);
    }

    #[test]
    fn test_classify_sets_rollup_on_result() {
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let result = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 10.0),
                GroupObservation::new(labels(&[("host", "b")]), 150.0),
            ],
            &c,
            500,
        );
        assert_eq!(result.rollup, Some(AlertLevel::Critical));
    }

    // ── M-6: cardinality cap — must WARN, never silently truncate ───────────

    #[test]
    fn test_under_cap_reports_no_overflow() {
        let c = tc(Operator::GreaterThan, 1, None);
        let obs: Vec<_> = (0..10)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 5.0))
            .collect();
        let result = classify_groups(obs, &c, 500);
        assert_eq!(result.groups.len(), 10);
        assert_eq!(result.cap, GroupCapOutcome::WithinCap);
    }

    #[test]
    fn test_over_cap_truncates_but_reports_the_whole_observed_page() {
        // Silent truncation would make a 900-group alert look like a 500-group
        // one. The overflow count must be recoverable.
        //
        // "Observed" means observed IN THIS PAGE. The evaluation fetches a
        // bounded page (size > cap, severity-ordered — §5.3), so when the page
        // itself fills, the true population is larger than anything this
        // function can see and the count becomes a lower bound. Marking that
        // is the caller's job (`groups_observed_is_lower_bound`, §7.2); here
        // the contract is only that nothing is dropped *silently* between the
        // page and the count.
        let c = tc(Operator::GreaterThan, 1, None);
        let obs: Vec<_> = (0..900)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 5.0))
            .collect();
        let result = classify_groups(obs, &c, 500);

        assert_eq!(result.groups.len(), 500, "state rows are capped");
        assert_eq!(
            result.cap,
            GroupCapOutcome::Exceeded {
                observed: 900,
                cap: 500
            },
            "the true group count must be reported so the UI can warn"
        );
    }

    #[test]
    fn test_over_cap_retains_the_most_severe_groups() {
        // If we must drop groups, dropping the Critical ones would be the
        // worst possible choice.
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let mut obs: Vec<_> = (0..10)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 10.0))
            .collect();
        obs.push(GroupObservation::new(labels(&[("host", "bad")]), 500.0));

        let result = classify_groups(obs, &c, 3);
        assert_eq!(result.groups.len(), 3);
        assert!(
            result
                .groups
                .iter()
                .any(|g| g.labels.get("host").map(String::as_str) == Some("bad")),
            "the Critical group must survive truncation"
        );
        assert_eq!(result.rollup, Some(AlertLevel::Critical));
    }

    #[test]
    fn test_truncation_is_deterministic_across_evaluations() {
        // If the surviving set varied between runs, every evaluation would
        // insert some state rows and orphan others — unbounded churn on the
        // hottest write path, and group history that flickers.
        let c = tc(Operator::GreaterThan, 100, None);
        let build = || {
            (0..50)
                .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i:02}"))]), 150.0))
                .collect::<Vec<_>>()
        };

        let first = classify_groups(build(), &c, 10);
        let second = classify_groups(build(), &c, 10);

        let keys = |r: &_| -> Vec<String> { classify_keys(r) };
        assert_eq!(
            keys(&first),
            keys(&second),
            "the same observations must keep the same groups every time"
        );
    }

    /// Helper: the group keys retained by a classification, in order.
    fn classify_keys(r: &crate::meta::alerts::grouping::GroupClassification) -> Vec<String> {
        r.groups.iter().map(|g| group_key(&g.labels)).collect()
    }

    #[test]
    fn test_cap_of_zero_is_treated_as_unlimited() {
        // Guard against a misconfigured cap silently disabling all grouping.
        let c = tc(Operator::GreaterThan, 1, None);
        let obs: Vec<_> = (0..20)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 5.0))
            .collect();
        let result = classify_groups(obs, &c, 0);
        assert_eq!(result.groups.len(), 20);
        assert_eq!(result.cap, GroupCapOutcome::WithinCap);
    }

    // ── M-7: group disappearance ────────────────────────────────────────────

    #[test]
    fn test_vanished_groups_are_reported_for_resolution() {
        use crate::meta::alerts::grouping::vanished_groups;

        let previous = vec![
            group_key(&labels(&[("host", "a")])),
            group_key(&labels(&[("host", "b")])),
        ];
        let current = vec![group_key(&labels(&[("host", "a")]))];

        let gone = vanished_groups(&previous, &current);
        assert_eq!(gone, vec![group_key(&labels(&[("host", "b")]))]);
    }

    #[test]
    fn test_no_vanished_groups_when_all_present() {
        use crate::meta::alerts::grouping::vanished_groups;
        let keys = vec![group_key(&labels(&[("host", "a")]))];
        assert!(vanished_groups(&keys, &keys).is_empty());
    }

    #[test]
    fn test_new_groups_are_not_reported_as_vanished() {
        use crate::meta::alerts::grouping::vanished_groups;
        let previous = vec![group_key(&labels(&[("host", "a")]))];
        let current = vec![
            group_key(&labels(&[("host", "a")])),
            group_key(&labels(&[("host", "new")])),
        ];
        assert!(vanished_groups(&previous, &current).is_empty());
    }

    // ── D8: one trigger record per evaluation, worst group ──────────────────

    #[test]
    fn test_worst_group_is_identifiable_for_the_trigger_record() {
        // §7.5 records ONE TriggerData per evaluation carrying the most severe
        // group's value and label. If this flips to per-group (D8), this test
        // is the one to change.
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let result = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 60.0),
                GroupObservation::new(labels(&[("host", "b")]), 500.0),
                GroupObservation::new(labels(&[("host", "c")]), 10.0),
            ],
            &c,
            500,
        );

        let worst = result.worst_group().expect("a firing group exists");
        assert_eq!(worst.level, Some(AlertLevel::Critical));
        assert_eq!(worst.actual_value, 500.0);
        assert_eq!(worst.labels.get("host").map(String::as_str), Some("b"));
    }

    #[test]
    fn test_worst_group_is_none_when_nothing_fires() {
        let c = tc(Operator::GreaterThan, 100, None);
        let result = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 1.0)],
            &c,
            500,
        );
        assert!(result.worst_group().is_none());
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Feature 3 — the not-yet-implemented surface.
    //
    // Everything above this line passes today. Everything below drives the
    // remaining requirements: group lifecycle (M-7), state fan-out (M-1/M-2/
    // M-3), and notification identity (M-4).
    // ═════════════════════════════════════════════════════════════════════════

    use std::collections::HashMap;

    use crate::meta::{
        alerts::{
            grouping::{
                DEFAULT_DISAPPEARANCE_K, DEFAULT_MAX_GROUPS, GroupFate, MIN_RESOLVE_THRESHOLD_SECS,
                group_fate, group_outcome, group_template_vars, plan_group_updates, render_labels,
                resolve_group_update, resolve_threshold_micros, with_group_component,
            },
            state::{AlertState, ROLLUP_GROUP_KEY, StateUpdate},
        },
        self_reporting::usage::RunOutcome,
    };

    const SEC: i64 = 1_000_000;

    /// Find the planned update for one group key.
    fn update_for<'a>(updates: &'a [StateUpdate], key: &str) -> Option<&'a StateUpdate> {
        updates
            .iter()
            .find(|u| u.state.as_ref().is_some_and(|s| s.group_key == key))
    }

    fn state_at(group_key: &str, level: Option<AlertLevel>, at: i64) -> AlertState {
        AlertState {
            alert_id: "alert-1".to_string(),
            group_key: group_key.to_string(),
            last_outcome: Some(group_outcome_expected(level)),
            last_outcome_at: Some(at),
            since: Some(at),
            level,
            level_since: Some(at),
            level_at: Some(at),
            last_seen: Some(at),
            group_labels: Some("host=x".to_string()),
            groups_observed: None,
            groups_firing: None,
            groups_observed_is_lower_bound: None,
            groups_firing_is_lower_bound: None,
        }
    }

    /// A row that has already been resolved by M-7: still carrying the
    /// `last_seen` from when it was last observed, but `Ok` as of `resolved_at`.
    fn resolved_state(group_key: &str, last_seen: i64, resolved_at: i64) -> AlertState {
        AlertState {
            alert_id: "alert-1".to_string(),
            group_key: group_key.to_string(),
            last_outcome: Some(RunOutcome::Normal),
            last_outcome_at: Some(resolved_at),
            since: Some(resolved_at),
            level: Some(AlertLevel::Ok),
            level_since: Some(resolved_at),
            level_at: Some(resolved_at),
            last_seen: Some(last_seen),
            group_labels: Some("host=x".to_string()),
            groups_observed: None,
            groups_firing: None,
            groups_observed_is_lower_bound: None,
            groups_firing_is_lower_bound: None,
        }
    }

    /// The mapping the tests assert `group_outcome` implements. Duplicated
    /// deliberately: if the production mapping changes, the fixtures should not
    /// silently follow it.
    fn group_outcome_expected(level: Option<AlertLevel>) -> RunOutcome {
        match level {
            Some(AlertLevel::Critical) | Some(AlertLevel::Warning) => RunOutcome::Firing,
            _ => RunOutcome::Normal,
        }
    }

    // ── Defaults (M-6, M-7) ─────────────────────────────────────────────────

    #[test]
    fn test_default_group_cap_is_500() {
        // PRD M-6. Encoded as a constant rather than a literal at the call site
        // so the config default and the evaluation default cannot drift.
        assert_eq!(DEFAULT_MAX_GROUPS, 500);
    }

    #[test]
    fn test_config_defaults_match_the_constants() {
        // The env_config macro needs literal defaults, so the numbers are
        // written twice. This is the guard against them drifting apart — a
        // config default of 100 with a constant of 500 would cap silently at
        // whichever one the call site happened to read.
        let cfg = crate::get_config();
        assert_eq!(cfg.limit.alert_max_groups, DEFAULT_MAX_GROUPS);
        assert_eq!(
            cfg.limit.alert_group_disappearance_k,
            DEFAULT_DISAPPEARANCE_K
        );
        assert!(
            cfg.limit.alert_group_reap_grace_secs > 0,
            "a zero grace period deletes a group's row the instant it recovers"
        );
    }

    #[test]
    fn test_default_disappearance_multiplier_tolerates_a_missed_run() {
        // K must exceed 1: at K=1 a single slow evaluation resolves every group
        // and re-fires it on the next pass — an alert storm from a hiccup.
        assert!(
            DEFAULT_DISAPPEARANCE_K > 1,
            "K=1 turns one missed evaluation into a full resolve/re-fire cycle"
        );
        assert_eq!(DEFAULT_DISAPPEARANCE_K, 3);
    }

    // ── M-2: rendered labels (display companion) ────────────────────────────

    #[test]
    fn test_render_labels_is_sorted_and_readable() {
        let rendered = render_labels(&labels(&[("host", "web-1"), ("env", "prod")]));
        assert_eq!(rendered, "env=prod,host=web-1");
    }

    #[test]
    fn test_render_labels_is_order_insensitive() {
        assert_eq!(
            render_labels(&labels(&[("b", "2"), ("a", "1")])),
            render_labels(&labels(&[("a", "1"), ("b", "2")]))
        );
    }

    #[test]
    fn test_render_labels_of_no_labels_is_empty() {
        assert_eq!(render_labels(&BTreeMap::new()), "");
    }

    #[test]
    fn test_rendered_labels_are_not_the_identity() {
        // The readable form is ambiguous under values containing the
        // separators — which is exactly why `group_key` hashes a
        // length-prefixed encoding instead of reusing this.
        //
        // These two label sets render to the SAME string under `k=v` joined by
        // `,`. Their keys must still differ, or one group silently overwrites
        // the other's state row.
        let a = labels(&[("a", "1,b=2")]);
        let b = labels(&[("a", "1"), ("b", "2")]);

        // Asserted unconditionally on purpose. An earlier version guarded this
        // with `if render_labels(a) == render_labels(b)`, using label sets that
        // render differently — so the guard was always false and the test
        // asserted nothing at all.
        assert_eq!(
            render_labels(&a),
            render_labels(&b),
            "fixture is only meaningful if these two genuinely collide"
        );
        assert_ne!(
            group_key(&a),
            group_key(&b),
            "an ambiguous rendering must never reach the identity"
        );
    }

    // ── M-4: group labels as template variables ─────────────────────────────

    #[test]
    fn test_group_labels_become_prefixed_template_vars() {
        let vars = group_template_vars(&labels(&[("host", "web-1"), ("env", "prod")]));
        let map: HashMap<_, _> = vars.into_iter().collect();

        assert_eq!(map.get("group.host").map(String::as_str), Some("web-1"));
        assert_eq!(map.get("group.env").map(String::as_str), Some("prod"));
    }

    #[test]
    fn test_group_vars_cannot_shadow_builtin_template_vars() {
        // A label literally named `alert_name` must not be able to overwrite the
        // alert's own `{alert_name}` variable in a notification. The `group.`
        // prefix is the whole defence, so assert it holds for the hostile case.
        let vars = group_template_vars(&labels(&[("alert_name", "evil")]));
        for (name, _) in &vars {
            assert!(
                name.starts_with("group."),
                "every group variable must be namespaced; got `{name}`"
            );
        }
        assert!(!vars.iter().any(|(n, _)| n == "alert_name"));
    }

    #[test]
    fn test_no_labels_produce_no_group_vars() {
        // An ungrouped alert's template must not gain empty `{group.*}` noise.
        assert!(group_template_vars(&BTreeMap::new()).is_empty());
    }

    #[test]
    fn test_group_values_are_returned_verbatim_not_pre_expanded() {
        // Label values are user data and can contain `{...}`. This layer must
        // hand them back untouched — sanitising here would corrupt legitimate
        // values.
        //
        // The real defence is substitution ORDER: group variables must be
        // applied LAST, so a value like `{alert_name}` is written literally and
        // no later pass expands it. If group vars were applied first, a pod
        // named `{alert_name}` would rewrite itself into the alert's name.
        let vars = group_template_vars(&labels(&[("pod", "{alert_name}")]));
        let map: HashMap<_, _> = vars.into_iter().collect();
        assert_eq!(
            map.get("group.pod").map(String::as_str),
            Some("{alert_name}")
        );
    }

    // ── M-7: what a resolution writes ───────────────────────────────────────

    #[test]
    fn test_resolution_records_the_recovery_transition() {
        let key = group_key(&labels(&[("host", "gone")]));
        let prev = state_at(&key, Some(AlertLevel::Critical), 50);

        let update = resolve_group_update("alert-1", &key, &prev, 5_000);
        let state = update.state.as_ref().expect("resolution writes state");

        assert_eq!(state.level, Some(AlertLevel::Ok), "M-7 resolves to Ok");
        assert_eq!(state.last_outcome, Some(RunOutcome::Normal));
        assert!(!state.is_firing());

        let t = update
            .transition
            .as_ref()
            .expect("a disappearing group's recovery must be recorded");
        assert_eq!(t.from_level, Some(AlertLevel::Critical));
        assert_eq!(t.to_level, Some(AlertLevel::Ok));
        assert_eq!(t.group_key, key);
        assert_eq!(t.alert_id, "alert-1");
    }

    #[test]
    fn test_resolution_preserves_last_seen_but_advances_the_outcome_clock() {
        // The two clocks must move differently, and this is the only place it
        // shows. `last_seen` is the disappearance anchor — advancing it would
        // reset the clock and the row could never be reaped. `last_outcome_at`
        // is when the recorded outcome was decided, and the recovery IS decided
        // now; freezing it would date the `Normal` outcome to a moment when the
        // group was still Critical.
        //
        // An earlier draft overloaded `last_outcome_at` for both and produced
        // exactly that inconsistency.
        let key = group_key(&labels(&[("host", "gone")]));
        let prev = state_at(&key, Some(AlertLevel::Critical), 50);

        let update = resolve_group_update("alert-1", &key, &prev, 5_000);
        let state = update.state.as_ref().unwrap();

        assert_eq!(
            state.last_seen,
            Some(50),
            "a resolution is a decision about an absence, not an observation"
        );
        assert_eq!(
            state.last_outcome_at,
            Some(5_000),
            "the recovery outcome was decided now, not when the group vanished"
        );
        assert_eq!(state.since, Some(5_000));
        assert_eq!(state.level_since, Some(5_000));
        assert_eq!(update.transition.as_ref().unwrap().at, 5_000);
    }

    #[test]
    fn test_resolution_transition_carries_null_value_and_the_labels() {
        // M-8/§7.2. `value` must be NULL: the group stopped being returned, so
        // there is no observation — writing 0.0 would render in history as a
        // real measurement of zero.
        //
        // `group_labels` must be on the TRANSITION, not just the state row: the
        // state row is reaped after the grace period while transitions are
        // retained, and `group_key` is a hash. Without this the history of a
        // recovered group survives as an unreadable hash.
        let key = group_key(&labels(&[("host", "gone")]));
        let mut prev = state_at(&key, Some(AlertLevel::Critical), 50);
        prev.group_labels = Some("host=gone".to_string());

        let update = resolve_group_update("alert-1", &key, &prev, 5_000);
        let t = update.transition.as_ref().expect("resolution transitions");

        assert_eq!(t.value, None, "a vanished group has no observed value");
        assert_eq!(
            t.group_labels.as_deref(),
            Some("host=gone"),
            "labels must outlive the state row they came from"
        );
    }

    #[test]
    fn test_resolving_an_already_resolved_group_is_a_full_noop() {
        // A group sits out its whole grace period getting swept repeatedly.
        //
        // A transition-free write is NOT enough here: `last_outcome_at` is the
        // reap clock, so re-writing the row on every sweep pushes the clock out
        // by one interval each time and the row never reaps. It must write
        // nothing at all.
        let key = group_key(&labels(&[("host", "gone")]));
        let already = resolved_state(&key, 50, 5_000);

        let update = resolve_group_update("alert-1", &key, &already, 9_000);
        assert!(
            update.transition.is_none(),
            "re-resolving must not append a duplicate recovery"
        );
        assert!(
            update.state.is_none(),
            "re-writing the row would reset the reap clock every sweep"
        );
        assert!(update.is_noop());
    }

    #[test]
    fn test_resolving_a_healthy_group_marks_it_resolved_without_a_transition() {
        // A group that was observed HEALTHY and then vanished. There is no
        // level change (Ok -> Ok), so no transition — but the row must still be
        // written, because that write is what advances `last_outcome_at` past
        // `last_seen` and thereby marks the row resolved. Skipping the write
        // entirely (treating "no transition" as "nothing to do") leaves the row
        // permanently unresolved and therefore permanently unreapable: a slow
        // leak of one row per healthy group that ever disappears.
        let key = group_key(&labels(&[("host", "quiet")]));
        let healthy = state_at(&key, Some(AlertLevel::Ok), 1_000 * SEC);
        assert_eq!(
            healthy.last_outcome_at, healthy.last_seen,
            "fixture must be an OBSERVED healthy row, not a resolved one"
        );

        let update = resolve_group_update("alert-1", &key, &healthy, 1_500 * SEC);
        let state = update
            .state
            .as_ref()
            .expect("the row must be marked resolved even with no level change");

        assert!(
            update.transition.is_none(),
            "Ok -> Ok is not a level change and must not write a transition"
        );
        assert_eq!(state.last_seen, Some(1_000 * SEC));
        assert_eq!(state.last_outcome_at, Some(1_500 * SEC));
        assert!(
            state.last_outcome_at > state.last_seen,
            "the gap between the clocks is what marks the row resolved"
        );
    }

    #[test]
    fn test_resolution_output_feeds_straight_back_into_fate() {
        // End-to-end on the handoff between the two functions: resolve, then
        // re-measure fate from the state resolution produced. This is what
        // proves the pair actually composes — each is plausible alone while
        // together they either loop forever or reap instantly.
        let key = group_key(&labels(&[("host", "gone")]));
        let prev = state_at(&key, Some(AlertLevel::Critical), 1_000 * SEC);

        let resolved_at = 1_200 * SEC;
        let after = resolve_group_update("alert-1", &key, &prev, resolved_at)
            .state
            .expect("resolution writes state");

        // Still inside the grace period: left alone, not re-resolved.
        assert_eq!(
            group_fate(&after, resolved_at + 100 * SEC, 180 * SEC, 3600 * SEC),
            GroupFate::Keep,
            "a just-resolved group must not be resolved again on the next sweep"
        );
        // Past the grace period: reaped.
        assert_eq!(
            group_fate(&after, resolved_at + 3_601 * SEC, 180 * SEC, 3600 * SEC),
            GroupFate::Reap,
            "a resolved group must still age out and be reaped"
        );
    }

    // ── M-1: a group's level implies its outcome ────────────────────────────

    #[test]
    fn test_firing_levels_map_to_firing_outcome() {
        assert_eq!(
            group_outcome(Some(AlertLevel::Critical)),
            RunOutcome::Firing
        );
        assert_eq!(group_outcome(Some(AlertLevel::Warning)), RunOutcome::Firing);
    }

    #[test]
    fn test_healthy_levels_map_to_normal_outcome() {
        assert_eq!(group_outcome(Some(AlertLevel::Ok)), RunOutcome::Normal);
        // No level = matched no threshold = healthy, NOT "unknown".
        assert_eq!(group_outcome(None), RunOutcome::Normal);
    }

    #[test]
    fn test_group_outcome_never_returns_skipped() {
        // `Skipped` means "not evaluated" and is dropped by `apply_outcome`. A
        // group that WAS evaluated must never claim it, or its state would
        // freeze permanently.
        for level in [
            None,
            Some(AlertLevel::Ok),
            Some(AlertLevel::Warning),
            Some(AlertLevel::Critical),
            Some(AlertLevel::NoData),
        ] {
            assert_ne!(group_outcome(level), RunOutcome::Skipped);
        }
    }

    // ── M-7: the disappearance threshold ────────────────────────────────────

    // These cover the FIXED-INTERVAL path only. A cron alert's numeric
    // `frequency` is not the cadence it runs at, so this function must never be
    // fed one — `cron_resolve_threshold_micros` owns that case, and
    // `test_cron_threshold_differs_from_naive_frequency_math` shows what
    // getting it wrong costs.

    #[test]
    fn test_resolve_threshold_is_k_times_frequency() {
        assert_eq!(resolve_threshold_micros(60, 3), 180 * SEC);
    }

    #[test]
    fn test_zero_frequency_does_not_collapse_the_threshold() {
        // THE bug this guard exists for: a 0 threshold makes every group older
        // than "now" instantly vanished, resolving every group on every pass.
        let t = resolve_threshold_micros(0, 3);
        assert!(
            t >= MIN_RESOLVE_THRESHOLD_SECS * SEC,
            "a zero frequency must floor, not resolve everything; got {t}"
        );
    }

    #[test]
    fn test_negative_inputs_do_not_produce_a_negative_threshold() {
        // A negative threshold makes `age > threshold` true for every row,
        // including ones seen in the future.
        assert!(resolve_threshold_micros(-60, 3) >= MIN_RESOLVE_THRESHOLD_SECS * SEC);
        assert!(resolve_threshold_micros(60, -1) >= MIN_RESOLVE_THRESHOLD_SECS * SEC);
        assert!(resolve_threshold_micros(60, 0) >= MIN_RESOLVE_THRESHOLD_SECS * SEC);
    }

    #[test]
    fn test_threshold_saturates_instead_of_overflowing() {
        // frequency × K × 1_000_000 overflows i64 for large operator input.
        // Wrapping would produce a negative threshold — see the test above for
        // why that is the dangerous direction.
        let t = resolve_threshold_micros(i64::MAX, DEFAULT_DISAPPEARANCE_K);
        assert!(t > 0, "overflow must saturate positive, got {t}");
        // `> 0` alone would also pass for an implementation that caught the
        // overflow and fell back to the MIN floor — which would resolve groups
        // roughly 10^10 times sooner than configured. Saturation must go UP.
        assert!(
            t > 365 * 24 * 3600 * SEC,
            "overflow must saturate high, not collapse to the floor; got {t}"
        );
    }

    #[test]
    fn test_seconds_are_converted_to_micros_not_compared_raw() {
        // Unit confusion here is silent: comparing seconds against a micros
        // timestamp under-reads by 10^6 and resolves live groups immediately.
        // 60s must be 60_000_000, never 60.
        assert_eq!(resolve_threshold_micros(600, 1), 600 * SEC);
        assert!(resolve_threshold_micros(600, 1) > 1_000_000);
    }

    // ── M-7: fate from elapsed time ─────────────────────────────────────────

    #[test]
    fn test_recently_seen_group_is_kept() {
        let now = 1_000 * SEC;
        let st = state_at("g", Some(AlertLevel::Critical), now - 10 * SEC);
        assert_eq!(group_fate(&st, now, 180 * SEC, 3600 * SEC), GroupFate::Keep);
    }

    #[test]
    fn test_group_seen_exactly_at_the_threshold_is_still_kept() {
        // Boundary belongs on the safe side: resolving at exactly K×frequency
        // races the scheduler's own jitter.
        let now = 1_000 * SEC;
        let st = state_at("g", Some(AlertLevel::Critical), now - 180 * SEC);
        assert_eq!(group_fate(&st, now, 180 * SEC, 3600 * SEC), GroupFate::Keep);
    }

    #[test]
    fn test_group_past_the_threshold_resolves() {
        let now = 1_000 * SEC;
        let st = state_at("g", Some(AlertLevel::Critical), now - 181 * SEC);
        assert_eq!(
            group_fate(&st, now, 180 * SEC, 3600 * SEC),
            GroupFate::Resolve
        );
    }

    #[test]
    fn test_resolved_group_is_reaped_after_the_grace_period() {
        let now = 10_000 * SEC;
        let st = resolved_state("g", now - 5_000 * SEC, now - 3_601 * SEC);
        assert_eq!(group_fate(&st, now, 180 * SEC, 3600 * SEC), GroupFate::Reap);
    }

    #[test]
    fn test_resolved_group_inside_the_grace_period_is_kept() {
        // Grace exists so history stays visible briefly after recovery. Reaping
        // early would erase the group from the UI the moment it resolved.
        let now = 10_000 * SEC;
        let st = resolved_state("g", now - 5_000 * SEC, now - 100 * SEC);
        assert_eq!(group_fate(&st, now, 180 * SEC, 3600 * SEC), GroupFate::Keep);
    }

    #[test]
    fn test_a_long_dead_unresolved_group_still_resolves_before_it_is_reaped() {
        // THE sparse-sweep case, and the reason `group_fate` takes the row
        // instead of an age. After scheduler downtime the first sweep sees a
        // still-FIRING row far older than resolve_after + grace. Age-only logic
        // returns Reap and deletes it, losing the mandatory final Ok transition
        // — the group vanishes from history mid-incident with no recovery ever
        // recorded. It must resolve first and be reaped on a later sweep.
        let now = 1_000_000 * SEC;
        let ancient = state_at("g", Some(AlertLevel::Critical), now - 500_000 * SEC);
        assert_eq!(
            group_fate(&ancient, now, 180 * SEC, 3600 * SEC),
            GroupFate::Resolve,
            "an unresolved row must never skip straight to Reap, however old"
        );
    }

    #[test]
    fn test_clock_skew_never_reaps_a_live_group() {
        // A `last_seen` in the future (skewed writer, NTP step) yields a
        // negative age. Under naive wrapped arithmetic this reads as enormous
        // and deletes an actively firing group's state.
        let now = 1_000 * SEC;
        let st = state_at("g", Some(AlertLevel::Critical), now + 300 * SEC);
        assert_eq!(
            group_fate(&st, now, 180 * SEC, 3600 * SEC),
            GroupFate::Keep,
            "a future last_seen must not be read as ancient"
        );
    }

    #[test]
    fn test_group_seen_this_instant_is_kept() {
        let now = 1_000 * SEC;
        let st = state_at("g", Some(AlertLevel::Critical), now);
        assert_eq!(group_fate(&st, now, 180 * SEC, 3600 * SEC), GroupFate::Keep);
    }

    #[test]
    fn test_a_row_never_seen_at_all_is_not_reaped_on_sight() {
        // `last_seen = None` on a row that predates the column (migration
        // backfills NULL). Treating NULL as "epoch" would reap every legacy
        // row on the first sweep after upgrade.
        let now = 1_000_000 * SEC;
        let mut st = state_at("g", Some(AlertLevel::Critical), now);
        st.last_seen = None;
        assert_ne!(
            group_fate(&st, now, 180 * SEC, 3600 * SEC),
            GroupFate::Reap,
            "an unknown last_seen must not be treated as infinitely old"
        );
    }

    #[test]
    fn test_observed_healthy_group_walks_the_whole_lifecycle() {
        // Every other lifecycle fixture starts FIRING or is already resolved.
        // An ordinary observed-healthy group is the awkward one: it is
        // `Normal`/`Ok` — structurally identical to a resolved row except that
        // `last_outcome_at == last_seen`. An implementation that decides
        // "already resolved" from the outcome alone mishandles it in one of two
        // ways, and this walk catches both:
        //   - reaps it immediately, skipping the resolve step, or
        //   - never marks it resolved, so it is never reapable.
        let seen_at = 1_000 * SEC;
        let healthy = state_at("g", Some(AlertLevel::Ok), seen_at);
        assert_eq!(
            healthy.last_outcome_at, healthy.last_seen,
            "an observed row has both clocks aligned; that is the whole point"
        );

        // Fresh.
        assert_eq!(
            group_fate(&healthy, seen_at + 100 * SEC, 180 * SEC, 3600 * SEC),
            GroupFate::Keep
        );

        // Stale — must RESOLVE, not reap, even though it is already Ok.
        let stale_at = seen_at + 181 * SEC;
        assert_eq!(
            group_fate(&healthy, stale_at, 180 * SEC, 3600 * SEC),
            GroupFate::Resolve,
            "a healthy row must still be resolved before it can be reaped"
        );
        // ...and specifically NOT reaped, however long it has been stale.
        assert_eq!(
            group_fate(&healthy, seen_at + 100_000 * SEC, 180 * SEC, 3600 * SEC),
            GroupFate::Resolve,
            "an unresolved healthy row must never jump straight to Reap"
        );

        // Resolve it, then confirm the resolved row ages out normally.
        let resolved = resolve_group_update("alert-1", "g", &healthy, stale_at)
            .state
            .expect("resolution must write the row");
        assert_eq!(
            group_fate(&resolved, stale_at + 100 * SEC, 180 * SEC, 3600 * SEC),
            GroupFate::Keep,
            "inside the grace period"
        );
        assert_eq!(
            group_fate(&resolved, stale_at + 3_601 * SEC, 180 * SEC, 3600 * SEC),
            GroupFate::Reap,
            "a healthy group must eventually be reaped like any other"
        );
    }

    // ── M-1/M-2/M-3: state fan-out ──────────────────────────────────────────

    #[test]
    fn test_plan_writes_one_update_per_group_plus_rollup() {
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let classification = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 150.0),
                GroupObservation::new(labels(&[("host", "b")]), 10.0),
            ],
            &c,
            500,
        );

        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let updates = plan.updates;

        assert_eq!(updates.len(), 3, "two groups plus the rollup row");
        assert!(update_for(&updates, ROLLUP_GROUP_KEY).is_some());
        assert!(update_for(&updates, &group_key(&labels(&[("host", "a")]))).is_some());
        assert!(update_for(&updates, &group_key(&labels(&[("host", "b")]))).is_some());
    }

    #[test]
    fn test_every_planned_update_carries_the_alert_id() {
        // A row written without its alert_id can never be joined back — the
        // same orphaning trap `apply_outcome` guards against.
        let c = tc(Operator::GreaterThan, 100, None);
        let classification = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 150.0)],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let updates = plan.updates;

        for u in &updates {
            assert_eq!(u.state.as_ref().unwrap().alert_id, "alert-1");
            if let Some(t) = u.transition.as_ref() {
                assert_eq!(t.alert_id, "alert-1");
            }
        }
    }

    #[test]
    fn test_each_group_keeps_its_own_level() {
        // M-1: independent evaluation. `host=a` critical must not bleed into
        // `host=b`'s row.
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let classification = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 150.0),
                GroupObservation::new(labels(&[("host", "b")]), 75.0),
            ],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let updates = plan.updates;

        let a = update_for(&updates, &group_key(&labels(&[("host", "a")]))).unwrap();
        let b = update_for(&updates, &group_key(&labels(&[("host", "b")]))).unwrap();

        assert_eq!(a.state.as_ref().unwrap().level, Some(AlertLevel::Critical));
        assert_eq!(b.state.as_ref().unwrap().level, Some(AlertLevel::Warning));
    }

    #[test]
    fn test_rollup_row_carries_the_most_severe_level() {
        // M-2.
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let classification = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 10.0),
                GroupObservation::new(labels(&[("host", "b")]), 150.0),
            ],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let updates = plan.updates;
        let rollup = update_for(&updates, ROLLUP_GROUP_KEY).unwrap();

        assert_eq!(
            rollup.state.as_ref().unwrap().level,
            Some(AlertLevel::Critical)
        );
        assert_eq!(
            rollup.state.as_ref().unwrap().last_outcome,
            Some(RunOutcome::Firing)
        );
    }

    #[test]
    fn test_rollup_is_normal_when_every_group_is_healthy() {
        let c = tc(Operator::GreaterThan, 100, None);
        let classification = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 1.0),
                GroupObservation::new(labels(&[("host", "b")]), 2.0),
            ],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let updates = plan.updates;
        let rollup = update_for(&updates, ROLLUP_GROUP_KEY).unwrap();

        assert_eq!(
            rollup.state.as_ref().unwrap().last_outcome,
            Some(RunOutcome::Normal)
        );
        assert_eq!(rollup.state.as_ref().unwrap().level, Some(AlertLevel::Ok));
    }

    #[test]
    fn test_unchanged_group_refreshes_state_without_a_transition() {
        // M-3 + the write-volume contract: per-group rows are the high-churn
        // path, so a steady group must cost exactly one upsert and zero
        // transition rows.
        let c = tc(Operator::GreaterThan, 100, None);
        let key_a = group_key(&labels(&[("host", "a")]));
        let mut prev = HashMap::new();
        prev.insert(
            key_a.clone(),
            state_at(&key_a, Some(AlertLevel::Critical), 50),
        );

        let classification = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 150.0)],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &prev, 200);
        let updates = plan.updates;
        let a = update_for(&updates, &key_a).unwrap();

        assert!(
            a.transition.is_none(),
            "a group at an unchanged level must not write a transition row"
        );
        let state = a.state.as_ref().unwrap();
        assert_eq!(state.last_outcome_at, Some(200), "freshness still advances");
        assert_eq!(
            state.level_since,
            Some(50),
            "level_since must not move while the level is unchanged"
        );
    }

    #[test]
    fn test_one_group_escalating_does_not_transition_the_others() {
        // M-3, stated as directly as it can be: `host=a` escalating must leave
        // `host=b`'s transition history completely alone.
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let key_a = group_key(&labels(&[("host", "a")]));
        let key_b = group_key(&labels(&[("host", "b")]));

        let mut prev = HashMap::new();
        prev.insert(
            key_a.clone(),
            state_at(&key_a, Some(AlertLevel::Warning), 50),
        );
        prev.insert(
            key_b.clone(),
            state_at(&key_b, Some(AlertLevel::Warning), 50),
        );

        // a escalates to critical; b holds at warning.
        let classification = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 150.0),
                GroupObservation::new(labels(&[("host", "b")]), 75.0),
            ],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &prev, 200);
        let updates = plan.updates;

        let a = update_for(&updates, &key_a).unwrap();
        let b = update_for(&updates, &key_b).unwrap();

        let t = a
            .transition
            .as_ref()
            .expect("the escalating group must transition");
        assert_eq!(t.from_level, Some(AlertLevel::Warning));
        assert_eq!(t.to_level, Some(AlertLevel::Critical));
        assert_eq!(t.group_key, key_a);

        assert!(
            b.transition.is_none(),
            "an unrelated group must not transition because a sibling escalated"
        );
    }

    #[test]
    fn test_one_group_recovering_does_not_resolve_its_siblings() {
        // The headline user story: host-a recovering must not silence host-b.
        let c = tc(Operator::GreaterThan, 100, None);
        let key_a = group_key(&labels(&[("host", "a")]));
        let key_b = group_key(&labels(&[("host", "b")]));

        let mut prev = HashMap::new();
        prev.insert(
            key_a.clone(),
            state_at(&key_a, Some(AlertLevel::Critical), 50),
        );
        prev.insert(
            key_b.clone(),
            state_at(&key_b, Some(AlertLevel::Critical), 50),
        );

        let classification = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 1.0), // recovered
                GroupObservation::new(labels(&[("host", "b")]), 150.0), // still bad
            ],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &prev, 200);
        let updates = plan.updates;

        let a = update_for(&updates, &key_a)
            .unwrap()
            .state
            .as_ref()
            .unwrap();
        let b = update_for(&updates, &key_b)
            .unwrap()
            .state
            .as_ref()
            .unwrap();

        assert_eq!(a.last_outcome, Some(RunOutcome::Normal));
        assert!(
            b.is_firing(),
            "host-b must still be firing after host-a recovered"
        );
        // And the rollup still reflects the worst group, not the recovery.
        let rollup = update_for(&updates, ROLLUP_GROUP_KEY).unwrap();
        assert_eq!(
            rollup.state.as_ref().unwrap().level,
            Some(AlertLevel::Critical)
        );
    }

    #[test]
    fn test_new_group_gets_state_and_a_first_transition() {
        let c = tc(Operator::GreaterThan, 100, None);
        let key_a = group_key(&labels(&[("host", "a")]));
        let key_new = group_key(&labels(&[("host", "new")]));

        let mut prev = HashMap::new();
        prev.insert(
            key_a.clone(),
            state_at(&key_a, Some(AlertLevel::Critical), 50),
        );

        let classification = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 150.0),
                GroupObservation::new(labels(&[("host", "new")]), 150.0),
            ],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &prev, 200);
        let updates = plan.updates;
        let new = update_for(&updates, &key_new).unwrap();

        let t = new
            .transition
            .as_ref()
            .expect("a newly appearing firing group is a transition from nothing");
        assert_eq!(t.from_outcome, None);
        assert_eq!(t.to_outcome, RunOutcome::Firing);
        assert_eq!(new.state.as_ref().unwrap().since, Some(200));
    }

    #[test]
    fn test_vanished_group_within_cap_is_left_untouched_by_the_plan() {
        // Separation of concerns: absence is NOT resolution. If the plan
        // resolved missing groups directly, a single empty query result would
        // resolve every group at once — which is exactly the mass-recovery
        // failure M-7's elapsed-time rule exists to prevent.
        //
        // Within cap only: an overflowing page cannot distinguish "gone" from
        // "below the cutoff", so it evicts instead of deferring to M-7.
        let c = tc(Operator::GreaterThan, 100, None);
        let key_a = group_key(&labels(&[("host", "a")]));
        let key_gone = group_key(&labels(&[("host", "gone")]));

        let mut prev = HashMap::new();
        prev.insert(
            key_a.clone(),
            state_at(&key_a, Some(AlertLevel::Critical), 50),
        );
        prev.insert(
            key_gone.clone(),
            state_at(&key_gone, Some(AlertLevel::Critical), 50),
        );

        let classification = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 150.0)],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &prev, 200);
        let updates = plan.updates;

        assert!(
            update_for(&updates, &key_gone).is_none(),
            "an unobserved group must be aged out on time, not resolved by absence"
        );
    }

    #[test]
    fn test_empty_result_does_not_refresh_level_freshness() {
        // No groups at all is not "all healthy" (§7.3 NoData owns it). Passing
        // a `None` level keeps `level_at` frozen, so composite staleness (§6.4)
        // correctly sees the level rotting instead of being refreshed by an
        // evaluation that observed nothing.
        let c = tc(Operator::GreaterThan, 100, None);
        let mut prev = HashMap::new();
        prev.insert(
            ROLLUP_GROUP_KEY.to_string(),
            state_at(ROLLUP_GROUP_KEY, Some(AlertLevel::Critical), 50),
        );

        let classification = classify_groups(vec![], &c, 500);
        assert_eq!(classification.rollup, None);

        let plan = plan_group_updates("alert-1", &classification, &prev, 200);
        let updates = plan.updates;
        let rollup = update_for(&updates, ROLLUP_GROUP_KEY)
            .expect("the rollup row is still written on an empty result");
        let state = rollup.state.as_ref().unwrap();

        assert_eq!(
            state.level_at,
            Some(50),
            "an evaluation that observed nothing must not make the level look fresh"
        );
        assert_eq!(
            state.level,
            Some(AlertLevel::Critical),
            "the previous level is carried forward, not invented as Ok"
        );
    }

    #[test]
    fn test_cap_eviction_deletes_the_displaced_incumbent_row() {
        // M-6: "an evicted row is deleted outright; no transition row is
        // written". Upserting only the retained 500 is NOT enough — the
        // displaced incumbent's row would simply stay in the table, so under
        // repeated severity churn stored rows grow without bound and the cap
        // stops being a cap at all.
        //
        // No transition: an eviction is bookkeeping, not a level change. The
        // group may still be firing in reality, so a recovery row would be a
        // lie.
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let cap = 3;

        // Three healthy incumbents already tracked...
        let mut prev = HashMap::new();
        let incumbents: Vec<_> = (0..3)
            .map(|i| group_key(&labels(&[("host", &format!("h{i}"))])))
            .collect();
        for k in &incumbents {
            prev.insert(k.clone(), state_at(k, Some(AlertLevel::Ok), 50));
        }

        // ...and a newly Critical group arrives, which admission ranks first.
        let obs: Vec<_> = (0..3)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 10.0))
            .chain(std::iter::once(GroupObservation::new(
                labels(&[("host", "bad")]),
                500.0,
            )))
            .collect();
        let classification = classify_groups(obs, &c, cap);

        let plan = plan_group_updates("alert-1", &classification, &prev, 200);

        assert_eq!(
            classification.dropped.len(),
            1,
            "one group must be displaced by the newly Critical one"
        );
        let displaced = &classification.dropped[0];
        // Exact set, not `contains`. An implementation that evicted every
        // tracked incumbent would satisfy `contains` while deleting the state
        // of three groups that are still being observed — losing their `since`
        // and their firing history on every cap overflow.
        //
        // The contract is `tracked \ retained`, NOT `dropped ∩ tracked`: on an
        // overflowing page a tracked group can be absent from the results
        // entirely (it sorted below the cutoff) without appearing in `dropped`.
        // Those rows are evicted too — see
        // `test_overflow_evicts_tracked_groups_missing_from_the_page`. The two
        // formulas coincide here only because every incumbent was observed.
        let retained: std::collections::HashSet<String> = classification
            .groups
            .iter()
            .map(|g| group_key(&g.labels))
            .collect();
        let mut expected: Vec<String> = prev
            .keys()
            .filter(|k| !retained.contains(*k))
            .cloned()
            .collect();
        let mut actual = plan.evicted.clone();
        expected.sort();
        actual.sort();
        assert_eq!(
            actual, expected,
            "under overflow, evicted must be exactly (tracked \\ retained), no more"
        );
        assert!(
            plan.evicted.contains(displaced),
            "the displaced incumbent's row must be deleted, not left behind"
        );
        for k in &incumbents {
            if k != displaced {
                assert!(
                    !plan.evicted.contains(k),
                    "a retained group must never be evicted"
                );
                assert!(
                    update_for(&plan.updates, k).is_some(),
                    "a retained group must still be upserted"
                );
            }
        }
        assert!(
            update_for(&plan.updates, displaced).is_none(),
            "an evicted group must not also be upserted"
        );
        assert!(
            !plan.updates.iter().any(|u| u
                .transition
                .as_ref()
                .is_some_and(|t| &t.group_key == displaced)),
            "eviction is bookkeeping and must not write a transition"
        );
    }

    #[test]
    fn test_eviction_only_covers_rows_we_actually_tracked() {
        // A group dropped by the cap that was never in `prev` has no row to
        // delete. Listing it would issue deletes for rows that do not exist.
        let c = tc(Operator::GreaterThan, 1, None);
        let obs: Vec<_> = (0..10)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 5.0))
            .collect();
        let classification = classify_groups(obs, &c, 3);

        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 200);
        assert!(
            plan.evicted.is_empty(),
            "nothing was tracked, so nothing can be evicted"
        );
    }

    #[test]
    fn test_unobserved_group_within_cap_is_not_treated_as_evicted() {
        // The distinction the whole `dropped` field exists for. A group that
        // simply stopped being returned must go through M-7 resolution, NOT be
        // deleted outright — deleting it would drop a firing group from history
        // with no recovery ever recorded.
        //
        // WITHIN CAP is load-bearing: the page is authoritative here, so
        // absence really is disappearance. Once the page overflows it is not,
        // and the opposite rule applies — see
        // `test_overflow_evicts_tracked_groups_missing_from_the_page`.
        let c = tc(Operator::GreaterThan, 100, None);
        let key_gone = group_key(&labels(&[("host", "gone")]));
        let mut prev = HashMap::new();
        prev.insert(
            key_gone.clone(),
            state_at(&key_gone, Some(AlertLevel::Critical), 50),
        );

        let classification = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 150.0)],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &prev, 200);

        assert!(
            !plan.evicted.contains(&key_gone),
            "absence is resolved on elapsed time, never deleted outright"
        );
    }

    #[test]
    fn test_plan_reports_the_true_observed_count_for_the_overflow_warning() {
        // M-6 requires the warning to state the REAL group count. Taking it
        // from `updates.len()` would report the post-cap number and the banner
        // would read "500 of 500" — indistinguishable from no overflow.
        let c = tc(Operator::GreaterThan, 1, None);
        let obs: Vec<_> = (0..900)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i:03}"))]), 5.0))
            .collect();
        let classification = classify_groups(obs, &c, 500);

        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);

        // Must be PERSISTED on the rollup row, not merely returned: the
        // overflow banner renders from stored state on the list and detail
        // views, long after this evaluation is gone.
        let rollup = update_for(&plan.updates, ROLLUP_GROUP_KEY)
            .unwrap()
            .state
            .as_ref()
            .unwrap();
        assert_eq!(rollup.groups_observed, Some(900));

        let a_group = plan
            .updates
            .iter()
            .filter_map(|u| u.state.as_ref())
            .find(|s| s.group_key != ROLLUP_GROUP_KEY)
            .unwrap();
        assert_eq!(
            a_group.groups_observed, None,
            "the count belongs to the rollup row only"
        );
    }

    #[test]
    fn test_groups_observed_is_set_even_when_under_the_cap() {
        // Otherwise the field is NULL for healthy alerts and the UI cannot tell
        // "no overflow" from "never recorded".
        let c = tc(Operator::GreaterThan, 100, None);
        let classification = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "a")]), 150.0),
                GroupObservation::new(labels(&[("host", "b")]), 10.0),
            ],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let rollup = update_for(&plan.updates, ROLLUP_GROUP_KEY)
            .unwrap()
            .state
            .as_ref()
            .unwrap();
        assert_eq!(rollup.groups_observed, Some(2));
    }

    #[test]
    fn test_per_group_transition_carries_its_value_and_labels() {
        // M-8/§7.2: per-group history renders from the transition row alone,
        // because the state row is reaped. A transition without `value` cannot
        // show what fired, and without `group_labels` cannot say for whom.
        let c = tc(Operator::GreaterThan, 100, None);
        let key_a = group_key(&labels(&[("host", "a")]));
        let classification = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 137.5)],
            &c,
            500,
        );

        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let t = update_for(&plan.updates, &key_a)
            .unwrap()
            .transition
            .as_ref()
            .expect("a newly firing group transitions");

        assert_eq!(t.value, Some(137.5));
        assert_eq!(t.group_labels.as_deref(), Some("host=a"));
    }

    #[test]
    fn test_group_state_row_stores_its_rendered_labels() {
        // The rollup row has no labels; a group row must carry them so the UI
        // can name the group without re-deriving it from the query.
        let c = tc(Operator::GreaterThan, 100, None);
        let key_a = group_key(&labels(&[("host", "a")]));
        let classification = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 150.0)],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);

        let g = update_for(&plan.updates, &key_a)
            .unwrap()
            .state
            .as_ref()
            .unwrap();
        assert_eq!(g.group_labels.as_deref(), Some("host=a"));

        let rollup = update_for(&plan.updates, ROLLUP_GROUP_KEY)
            .unwrap()
            .state
            .as_ref()
            .unwrap();
        assert_eq!(rollup.group_labels, None, "the rollup row has no labels");
    }

    #[test]
    fn test_observed_group_refreshes_last_seen() {
        // The other half of the M-7 contract: being observed must advance the
        // disappearance clock, or every group resolves on schedule regardless.
        let c = tc(Operator::GreaterThan, 100, None);
        let key_a = group_key(&labels(&[("host", "a")]));
        let mut prev = HashMap::new();
        prev.insert(
            key_a.clone(),
            state_at(&key_a, Some(AlertLevel::Critical), 50),
        );

        let classification = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 150.0)],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &prev, 200);

        let g = update_for(&plan.updates, &key_a)
            .unwrap()
            .state
            .as_ref()
            .unwrap();
        assert_eq!(g.last_seen, Some(200));
    }

    #[test]
    fn test_plan_respects_the_cap_by_planning_only_retained_groups() {
        // M-6: over-cap evaluations must not write the dropped groups' rows —
        // the cap is a write-volume guard, so a plan that emits 900 updates for
        // a 500 cap would defeat it entirely.
        let c = tc(Operator::GreaterThan, 1, None);
        let obs: Vec<_> = (0..900)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i:03}"))]), 5.0))
            .collect();
        let classification = classify_groups(obs, &c, 500);

        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let updates = plan.updates;
        assert_eq!(updates.len(), 501, "500 retained groups plus the rollup");
    }

    // ── M-5: per-group notification identity ────────────────────────────────

    #[test]
    fn test_ungrouped_fingerprint_is_unchanged_byte_for_byte() {
        // THE upgrade-safety test. Every ungrouped alert in every existing
        // deployment must keep its fingerprint across this feature, or their
        // in-flight silence windows all reset and every alert re-notifies at
        // once on the deploy.
        let base = "org|alert-1|svc=checkout".to_string();
        assert_eq!(with_group_component(base.clone(), None), base);
    }

    #[test]
    fn test_rollup_key_is_treated_as_ungrouped() {
        // The rollup row is the alert-level identity — it must not pick up an
        // empty `|group:` suffix, which would be a DIFFERENT string from the
        // legacy fingerprint and silently break dedup continuity.
        let base = "org|alert-1".to_string();
        assert_eq!(
            with_group_component(base.clone(), Some(ROLLUP_GROUP_KEY)),
            base
        );
    }

    #[test]
    fn test_distinct_groups_get_distinct_fingerprints() {
        // Without this, one group's notification dedups away another's — the
        // exact failure multi-alerts exist to fix.
        let base = "org|alert-1".to_string();
        let a = with_group_component(base.clone(), Some(&group_key(&labels(&[("host", "a")]))));
        let b = with_group_component(base, Some(&group_key(&labels(&[("host", "b")]))));
        assert_ne!(a, b);
    }

    #[test]
    fn test_same_group_fingerprint_is_stable() {
        // Silence windows are keyed on this; an unstable key silences nothing.
        let base = "org|alert-1".to_string();
        let key = group_key(&labels(&[("host", "a")]));
        assert_eq!(
            with_group_component(base.clone(), Some(&key)),
            with_group_component(base, Some(&key))
        );
    }

    #[test]
    fn test_group_component_cannot_be_parsed_as_a_dimension() {
        // The base fingerprint encodes dimensions as `,dim=val`. The group
        // component must not adopt that shape, or dimension parsing would read
        // the group hash as a user field — the same reasoning that gave
        // `with_level_component` its `|level:` separator.
        let out = with_group_component(
            "org|alert-1".to_string(),
            Some(&group_key(&labels(&[("host", "a")]))),
        );
        let suffix = out.strip_prefix("org|alert-1").expect("base is preserved");
        assert!(
            !suffix.starts_with(','),
            "group component must not look like a `,dim=val` pair; got `{suffix}`"
        );
        assert!(suffix.starts_with("|group:"), "got `{suffix}`");
    }

    #[test]
    fn test_group_component_composes_with_the_level_component() {
        // Level and group are independent implicit components. A Critical
        // host-a batch must differ from a Warning host-a batch AND from a
        // Critical host-b batch.
        let key_a = group_key(&labels(&[("host", "a")]));
        let key_b = group_key(&labels(&[("host", "b")]));

        let crit_a = with_group_component("base|level:critical".to_string(), Some(&key_a));
        let warn_a = with_group_component("base|level:warning".to_string(), Some(&key_a));
        let crit_b = with_group_component("base|level:critical".to_string(), Some(&key_b));

        assert_ne!(crit_a, warn_a);
        assert_ne!(crit_a, crit_b);
    }

    #[test]
    fn test_plan_is_deterministic_for_identical_input() {
        // Same observations must yield the same plan — otherwise the retained
        // row set churns between evaluations.
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let build = || {
            classify_groups(
                vec![
                    GroupObservation::new(labels(&[("host", "a")]), 150.0),
                    GroupObservation::new(labels(&[("host", "b")]), 75.0),
                ],
                &c,
                500,
            )
        };

        let first = plan_group_updates("alert-1", &build(), &HashMap::new(), 100);
        let second = plan_group_updates("alert-1", &build(), &HashMap::new(), 100);
        assert_eq!(first, second);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // The opt-in gate — M-9 / M-10 / D26 / D27.
    //
    // Feature 3 changes how a grouped alert fires. These tests exist to prove
    // that change reaches ONLY alerts whose author asked for it, and that
    // asking for it never silently rewrites the alert's meaning.
    // ═════════════════════════════════════════════════════════════════════════

    use serde_json::json;

    use crate::meta::alerts::{
        AggFunction, Aggregation, Condition,
        aggregation_level::{evaluate_aggregation_alert, evaluate_aggregation_level},
        grouping::{
            GroupPageCompleteness, MultiAlertError, classify_groups_by,
            cron_resolve_threshold_micros, may_age_groups, validate_multi_alert,
        },
    };

    /// An aggregation alert config. `group_by: None` = ungrouped.
    fn agg_cfg(group_by: Option<&[&str]>, op: Operator, multi_alert: bool) -> Aggregation {
        Aggregation {
            group_by: group_by.map(|c| c.iter().map(|s| s.to_string()).collect()),
            function: AggFunction::Avg,
            having: Condition {
                column: "alert_agg_value".to_string(),
                operator: op,
                value: json!(90),
                ignore_case: false,
            },
            warning_value: None,
            multi_alert,
        }
    }

    // ── M-9: the flag itself ────────────────────────────────────────────────

    #[test]
    fn test_multi_alert_defaults_to_false_for_aggregations_stored_before_the_feature() {
        // THE upgrade-safety guarantee (M-9/D26), and the reason gating is a
        // stored flag rather than a timestamp or a `group_by` inference. Every
        // grouped aggregation already in every deployment was serialized
        // without this field. If it read back as anything but `false`, all of
        // them would switch to per-group evaluation on the deploy: different
        // paging cadence, and every in-flight silence fingerprint invalidated
        // at once.
        let legacy = agg_cfg(Some(&["host"]), Operator::GreaterThanEquals, false);
        let mut stored = serde_json::to_value(&legacy).expect("serializable");
        // Exactly what a row written before the field existed looks like.
        stored
            .as_object_mut()
            .expect("aggregation serializes to an object")
            .remove("multi_alert");

        let parsed: Aggregation =
            serde_json::from_value(stored).expect("legacy JSON must still parse");
        assert!(!parsed.multi_alert, "an alert must never opt in by accident");
    }

    #[test]
    fn test_a_disabled_flag_leaves_no_trace_in_stored_json() {
        // Re-saving an untouched legacy alert must not rewrite its stored
        // aggregation. Without `skip_serializing_if`, every alert in the
        // deployment would gain a `"multi_alert": false` key on its next write
        // — harmless in meaning, but it makes an audit diff of "which alerts
        // changed when we deployed Feature 3" read as "all of them".
        let off = agg_cfg(Some(&["host"]), Operator::GreaterThanEquals, false);
        assert!(
            serde_json::to_value(&off).unwrap().get("multi_alert").is_none(),
            "a false flag must not be written"
        );

        let on = agg_cfg(Some(&["host"]), Operator::GreaterThanEquals, true);
        assert_eq!(
            serde_json::to_value(&on).unwrap().get("multi_alert"),
            Some(&json!(true)),
            "an enabled flag must persist"
        );
    }

    #[test]
    fn test_multi_alert_survives_a_serde_roundtrip() {
        let on = agg_cfg(Some(&["host"]), Operator::GreaterThanEquals, true);
        let back: Aggregation =
            serde_json::from_str(&serde_json::to_string(&on).unwrap()).unwrap();
        assert_eq!(back, on);
        assert!(back.multi_alert);
    }

    #[test]
    fn test_group_by_alone_does_not_opt_an_alert_in() {
        // D26, stated directly: gating is the explicit flag and nothing else.
        // Inferring from `group_by` was the rejected option precisely because
        // it would convert every existing grouped alert without asking.
        let grouped = agg_cfg(Some(&["host", "region"]), Operator::GreaterThan, false);
        assert!(!grouped.multi_alert);
    }

    // ── M-10: what may opt in ───────────────────────────────────────────────

    #[test]
    fn test_the_any_group_shape_is_accepted() {
        let a = agg_cfg(Some(&["host"]), Operator::GreaterThan, true);

        assert_eq!(
            validate_multi_alert(&a, &tc(Operator::GreaterThanEquals, 1, None)),
            Ok(())
        );
        // `> 0` is the same statement as `>= 1`; a UI that normalises one way
        // must not make an otherwise-valid alert unsavable.
        assert_eq!(
            validate_multi_alert(&a, &tc(Operator::GreaterThan, 0, None)),
            Ok(())
        );
        // An explicit warning gate that also means "any group".
        assert_eq!(
            validate_multi_alert(&a, &tc(Operator::GreaterThanEquals, 1, Some(1))),
            Ok(())
        );
    }

    #[test]
    fn test_a_group_count_threshold_is_rejected() {
        // "at least 3 groups" and "any breaching group" are different alerts.
        // Accepting the flag and ignoring the count would leave a 3 sitting
        // visibly in the UI doing nothing at all.
        let a = agg_cfg(Some(&["host"]), Operator::GreaterThan, true);
        assert_eq!(
            validate_multi_alert(&a, &tc(Operator::GreaterThanEquals, 3, None)),
            Err(MultiAlertError::CountGateNotAnyGroup)
        );
    }

    #[test]
    fn test_a_warning_group_count_threshold_is_rejected() {
        // The gate that is easy to forget, because it lives on a different
        // field from the one everybody checks. Legacy Warning fires on
        // `firing_count >= warning_threshold.unwrap_or(threshold)`, so a
        // critical gate of `>= 1` with a warning gate of 3 STILL diverges from
        // M-2: one Warning group is legacy-Ok but most-severe-Warning.
        let a = agg_cfg(Some(&["host"]), Operator::GreaterThan, true);
        assert_eq!(
            validate_multi_alert(&a, &tc(Operator::GreaterThanEquals, 1, Some(3))),
            Err(MultiAlertError::WarningCountGateNotAnyGroup)
        );
    }

    #[test]
    fn test_an_inverted_count_operator_is_rejected() {
        // "fire when FEWER than 3 groups breach" inverts outright under M-2:
        // zero breaching groups is the healthiest possible reading, and the
        // alert would go permanently green exactly when it should fire.
        let a = agg_cfg(Some(&["host"]), Operator::GreaterThan, true);
        assert_eq!(
            validate_multi_alert(&a, &tc(Operator::LessThan, 3, None)),
            Err(MultiAlertError::CountGateNotAnyGroup)
        );
    }

    #[test]
    fn test_an_unorderable_value_operator_is_rejected() {
        // `=` and `!=` have no severity direction, so neither a warning band
        // nor the severity-ordered fetch (§5.3) can be defined over them. They
        // stay legal for single-level simple aggregations (G5) — just not for
        // per-group alerting.
        for op in [Operator::EqualTo, Operator::NotEqualTo] {
            let a = agg_cfg(Some(&["host"]), op, true);
            assert_eq!(
                validate_multi_alert(&a, &tc(Operator::GreaterThanEquals, 1, None)),
                Err(MultiAlertError::OperatorNotOrderable),
                "{op:?} has no worst-first ordering"
            );
        }
    }

    #[test]
    fn test_opting_in_without_a_group_by_is_rejected() {
        // The UI hides the toggle for ungrouped alerts, but API clients submit
        // raw payloads — hiding a control is not enforcing a rule.
        let a = agg_cfg(None, Operator::GreaterThan, true);
        assert_eq!(
            validate_multi_alert(&a, &tc(Operator::GreaterThanEquals, 1, None)),
            Err(MultiAlertError::NotGrouped)
        );
    }

    #[test]
    fn test_removing_the_last_group_by_column_is_rejected_while_opted_in() {
        // The EDIT path, which is the one that gets missed: an alert that was
        // validly multi-grouped must stop being savable the moment its last
        // group_by column goes, rather than being left opted in with nothing
        // to group by.
        let a = agg_cfg(Some(&[]), Operator::GreaterThan, true);
        assert_eq!(
            validate_multi_alert(&a, &tc(Operator::GreaterThanEquals, 1, None)),
            Err(MultiAlertError::NotGrouped)
        );
    }

    #[test]
    fn test_validation_is_inert_for_every_alert_that_has_not_opted_in() {
        // D26's compatibility guarantee restated as a rule about validation
        // itself: no pre-existing alert can be made UNSAVABLE by this check,
        // whatever its shape. A grouped count-threshold alert with an
        // unorderable operator is perfectly legal — it is simply not a
        // multi-alert. Getting this wrong would break editing alerts that this
        // feature was never supposed to touch.
        let legacy = agg_cfg(Some(&["host"]), Operator::EqualTo, false);
        assert_eq!(
            validate_multi_alert(&legacy, &tc(Operator::LessThan, 5, Some(9))),
            Ok(())
        );

        let ungrouped = agg_cfg(None, Operator::EqualTo, false);
        assert_eq!(
            validate_multi_alert(&ungrouped, &tc(Operator::GreaterThanEquals, 7, None)),
            Ok(())
        );
    }

    #[test]
    fn test_rejection_messages_name_the_field_to_change() {
        // A bare "invalid configuration" leaves the user hunting through a
        // form. Each message has to point at the thing they must edit.
        assert!(
            MultiAlertError::CountGateNotAnyGroup
                .to_string()
                .contains("count threshold")
        );
        assert!(
            MultiAlertError::WarningCountGateNotAnyGroup
                .to_string()
                .contains("warning group-count")
        );
        assert!(
            MultiAlertError::NotGrouped
                .to_string()
                .contains("group_by")
        );
        assert!(
            MultiAlertError::OperatorNotOrderable
                .to_string()
                .contains("ordered comparison")
        );
    }

    // ── D27: the equivalence that makes opting in safe ──────────────────────

    #[test]
    fn test_m2_rollup_matches_the_legacy_level_for_every_permitted_shape() {
        // THE load-bearing claim of D27. M-10 exists solely to keep these two
        // verdicts identical: "most severe group" (what a multi-alert's rollup
        // row carries) and the legacy count-gated level (what the alert would
        // have fired on before). If they ever diverge, flipping the flag
        // silently changes what "firing" means for an alert — the exact failure
        // the whole decision was taken to prevent.
        //
        // Asserted across both threshold directions, with and without a warning
        // band, over value sets covering every combination of critical/warning/
        // healthy groups.
        let gates = [
            tc(Operator::GreaterThanEquals, 1, None),
            tc(Operator::GreaterThanEquals, 1, Some(1)),
            tc(Operator::GreaterThan, 0, None),
        ];
        let shapes = [
            (Operator::GreaterThan, json!(90), None),
            (Operator::GreaterThan, json!(90), Some(80.0)),
            (Operator::LessThan, json!(10), None),
            (Operator::LessThan, json!(10), Some(20.0)),
        ];
        let value_sets: [Vec<f64>; 7] = [
            vec![],
            vec![95.0],
            vec![85.0],
            vec![5.0],
            vec![95.0, 5.0],
            vec![85.0, 5.0],
            vec![95.0, 85.0, 5.0],
        ];

        for (op, critical, warning) in shapes {
            let mut agg = agg_cfg(Some(&["host"]), op, true);
            agg.having.value = critical.clone();
            agg.warning_value = warning;

            for gate in &gates {
                validate_multi_alert(&agg, gate)
                    .expect("fixture must be a shape M-10 actually permits");

                for values in &value_sets {
                    let legacy = evaluate_aggregation_alert(values, &agg, gate)
                        .expect("thresholds are numeric");

                    let obs: Vec<GroupObservation> = values
                        .iter()
                        .enumerate()
                        .map(|(i, v)| {
                            GroupObservation::new(labels(&[("host", &format!("h{i}"))]), *v)
                        })
                        .collect();
                    let m2 = classify_groups_by(
                        obs,
                        |v| evaluate_aggregation_level(v, &agg).ok().flatten(),
                        500,
                    )
                    .rollup;

                    match legacy {
                        // Whenever the legacy alert fires, the rollup must fire
                        // at exactly the same severity.
                        Some(level) => assert_eq!(
                            m2,
                            Some(level),
                            "legacy fired {level:?} but the rollup said {m2:?} \
                             (op={op:?}, warning={warning:?}, values={values:?})"
                        ),
                        // Whenever it does not, the rollup must not either. The
                        // one permitted difference is None vs Ok: legacy sees
                        // an empty filtered result and has no opinion, while a
                        // multi-alert observed the groups and knows they are
                        // healthy. Strictly more information, and identical on
                        // the axis that decides notifications.
                        None => assert!(
                            m2.is_none() || m2 == Some(AlertLevel::Ok),
                            "legacy did not fire but the rollup said {m2:?} \
                             (op={op:?}, warning={warning:?}, values={values:?})"
                        ),
                    }

                    assert_eq!(
                        group_outcome(legacy),
                        group_outcome(m2),
                        "the firing/not-firing verdict must be identical \
                         (op={op:?}, warning={warning:?}, values={values:?})"
                    );
                }
            }
        }
    }

    #[test]
    fn test_the_equivalence_breaks_on_a_shape_m10_rejects() {
        // The negative half of the test above: proof that M-10's restriction is
        // load-bearing rather than defensive boilerplate. With a warning gate
        // of 3 — which validation rejects — one Warning group is legacy-Ok but
        // M-2-Warning. If this ever starts passing, the equivalence argument no
        // longer needs the restriction and D27 should be revisited.
        let mut agg = agg_cfg(Some(&["host"]), Operator::GreaterThan, true);
        agg.warning_value = Some(80.0);
        let gate = tc(Operator::GreaterThanEquals, 1, Some(3));

        assert_eq!(
            validate_multi_alert(&agg, &gate),
            Err(MultiAlertError::WarningCountGateNotAnyGroup),
            "fixture must be a shape M-10 rejects"
        );

        let values = [85.0]; // one group in the warning band
        let legacy = evaluate_aggregation_alert(&values, &agg, &gate).unwrap();
        let m2 = classify_groups_by(
            vec![GroupObservation::new(labels(&[("host", "a")]), 85.0)],
            |v| evaluate_aggregation_level(v, &agg).ok().flatten(),
            500,
        )
        .rollup;

        assert_eq!(legacy, None, "one group does not satisfy a gate of 3");
        assert_eq!(m2, Some(AlertLevel::Warning), "but it IS the worst group");
        assert_ne!(
            group_outcome(legacy),
            group_outcome(m2),
            "this is the divergence M-10 exists to make unreachable"
        );
    }

    // ── M-7: absence must be proven, not assumed ────────────────────────────

    #[test]
    fn test_a_failed_evaluation_never_ages_groups() {
        // THE outage scenario, and the most damaging bug this feature could
        // ship. Pure elapsed time would age every group past its deadline
        // during a K-interval query outage: mass `Ok` resolutions for groups
        // that never recovered, then a mass re-fire when the query comes back —
        // an alert storm manufactured out of an outage, during exactly the
        // incident the alerts exist to report.
        assert!(!may_age_groups(
            Some(&RunOutcome::Error),
            GroupPageCompleteness::Complete
        ));
    }

    #[test]
    fn test_a_skipped_evaluation_never_ages_groups() {
        // Paused, silenced, or an org mid-deletion: nothing was observed, so
        // nothing can have disappeared. §7.6 — levels rot, they do not reset.
        assert!(!may_age_groups(
            Some(&RunOutcome::Skipped),
            GroupPageCompleteness::Complete
        ));
    }

    #[test]
    fn test_a_never_evaluated_alert_never_ages_groups() {
        assert!(!may_age_groups(None, GroupPageCompleteness::Complete));
    }

    #[test]
    fn test_a_truncated_page_never_ages_groups() {
        // Even on a completely successful run. If the page filled while every
        // row was still firing, a tracked group's absence may only mean it
        // sorted below the cutoff — absence proves nothing about existence.
        assert!(!may_age_groups(
            Some(&RunOutcome::Normal),
            GroupPageCompleteness::Truncated
        ));
        assert!(!may_age_groups(
            Some(&RunOutcome::Firing),
            GroupPageCompleteness::Truncated
        ));
    }

    #[test]
    fn test_a_complete_successful_evaluation_ages_groups() {
        // The gate must not be so conservative that groups never age at all —
        // then no group would ever resolve and the table would grow forever.
        assert!(may_age_groups(
            Some(&RunOutcome::Normal),
            GroupPageCompleteness::Complete
        ));
        assert!(may_age_groups(
            Some(&RunOutcome::Firing),
            GroupPageCompleteness::Complete
        ));
    }

    #[test]
    fn test_a_delivery_failure_still_ages_groups() {
        // `NotifyFailed` is a DELIVERY failure, not an evaluation failure: the
        // query ran and its observations are as trustworthy as any firing
        // run's. Freezing on it would let a webhook outage quietly suspend
        // group lifecycle for as long as the destination stays down.
        assert!(may_age_groups(
            Some(&RunOutcome::NotifyFailed),
            GroupPageCompleteness::Complete
        ));
    }

    #[test]
    fn test_a_non_condition_outcome_never_ages_groups() {
        // `Succeeded` belongs to reports and derived streams — modules with no
        // groups at all. Reading it as a clean observation would age groups on
        // the strength of a run that never looked at them.
        assert!(!may_age_groups(
            Some(&RunOutcome::Succeeded),
            GroupPageCompleteness::Complete
        ));
    }

    // ── M-6/M-7: an overflowing page cannot prove disappearance ─────────────

    #[test]
    fn test_overflow_evicts_tracked_groups_missing_from_the_page() {
        // On an overflowing page a tracked group's absence is ambiguous: it may
        // have vanished, or it may still be firing just below the cutoff.
        // Handing it to M-7 would eventually write a recovery for a group that
        // never recovered, so it is evicted instead — deleted outright, no
        // transition, the same bookkeeping as any other cap casualty. It comes
        // back on the next evaluation with room for it.
        let c = tc(Operator::GreaterThan, 100, None);
        let key_absent = group_key(&labels(&[("host", "absent")]));

        let mut prev = HashMap::new();
        prev.insert(
            key_absent.clone(),
            state_at(&key_absent, Some(AlertLevel::Critical), 50),
        );
        prev.insert(
            ROLLUP_GROUP_KEY.to_string(),
            state_at(ROLLUP_GROUP_KEY, Some(AlertLevel::Critical), 50),
        );

        // Three firing groups for a cap of two: the page overflows and none of
        // them is `absent`.
        let obs: Vec<_> = (0..3)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 150.0))
            .collect();
        let classification = classify_groups(obs, &c, 2);
        assert!(
            matches!(classification.cap, GroupCapOutcome::Exceeded { .. }),
            "fixture must actually overflow"
        );

        let plan = plan_group_updates("alert-1", &classification, &prev, 200);

        assert!(
            plan.evicted.contains(&key_absent),
            "an absent tracked group must be evicted, not aged toward a false recovery"
        );
        assert!(
            !plan.updates.iter().any(|u| u
                .transition
                .as_ref()
                .is_some_and(|t| t.group_key == key_absent)),
            "eviction is bookkeeping and must not write a transition"
        );
    }

    #[test]
    fn test_overflow_never_evicts_the_rollup_row() {
        // The rollup row lives in the same table keyed by the same column, so a
        // naive "delete every tracked key not in the page" would take the
        // alert's own state with it — losing `since`, the level, and the
        // groups_observed counter on every overflowing evaluation.
        let c = tc(Operator::GreaterThan, 100, None);
        let mut prev = HashMap::new();
        prev.insert(
            ROLLUP_GROUP_KEY.to_string(),
            state_at(ROLLUP_GROUP_KEY, Some(AlertLevel::Critical), 50),
        );

        let obs: Vec<_> = (0..3)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 150.0))
            .collect();
        let classification = classify_groups(obs, &c, 2);
        let plan = plan_group_updates("alert-1", &classification, &prev, 200);

        assert!(
            !plan.evicted.iter().any(|k| k == ROLLUP_GROUP_KEY),
            "the rollup row is the alert's own state, never a group casualty"
        );
        assert!(
            update_for(&plan.updates, ROLLUP_GROUP_KEY).is_some(),
            "and it must still be written"
        );
    }

    #[test]
    fn test_overflow_eviction_list_is_deterministic() {
        // `prev` is a HashMap, so its iteration order is not stable between
        // runs. An unsorted eviction list would make two identical evaluations
        // produce unequal plans — churning the delete batch and defeating the
        // determinism the retained set is carefully built to have.
        let c = tc(Operator::GreaterThan, 100, None);
        let mut prev = HashMap::new();
        for i in 0..8 {
            let k = group_key(&labels(&[("host", &format!("old{i}"))]));
            prev.insert(k.clone(), state_at(&k, Some(AlertLevel::Critical), 50));
        }

        let build = || {
            let obs: Vec<_> = (0..3)
                .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 150.0))
                .collect();
            classify_groups(obs, &c, 2)
        };

        let first = plan_group_updates("alert-1", &build(), &prev, 200);
        let second = plan_group_updates("alert-1", &build(), &prev, 200);

        assert_eq!(first.evicted, second.evicted);
        let mut sorted = first.evicted.clone();
        sorted.sort();
        assert_eq!(first.evicted, sorted, "the eviction list must be ordered");
        assert_eq!(first, second, "and the whole plan must be reproducible");
    }

    // ── M-7: cron schedules ─────────────────────────────────────────────────

    const DAY: i64 = 86_400 * SEC;

    #[test]
    fn test_cron_deadline_is_the_kth_occurrence_after_last_seen() {
        let last_seen = 1_000 * SEC;
        let schedule = vec![
            900 * SEC,
            1_000 * SEC,
            1_060 * SEC,
            1_120 * SEC,
            1_180 * SEC,
            1_240 * SEC,
        ];
        // Three scheduled runs missed: 1_060, 1_120, 1_180.
        assert_eq!(
            cron_resolve_threshold_micros(last_seen, schedule, 3),
            180 * SEC
        );
    }

    #[test]
    fn test_the_occurrence_that_observed_the_group_is_not_a_missed_run() {
        // "Strictly after". The fire that produced `last_seen` is the run that
        // SAW the group; counting it as one of the K missed runs would resolve
        // every group a full interval early, and at K=1 would yield a zero
        // threshold and resolve everything instantly.
        let last_seen = 1_000 * SEC;
        let schedule = vec![1_000 * SEC, 1_100 * SEC, 1_200 * SEC, 1_300 * SEC];
        assert_eq!(
            cron_resolve_threshold_micros(last_seen, schedule, 1),
            100 * SEC
        );
    }

    #[test]
    fn test_cron_threshold_is_anchored_to_the_row_not_sampled_at_sweep_time() {
        // THE drift bug this function exists to prevent. On an irregular
        // schedule the gap between consecutive fires is not a constant, so a
        // threshold derived from "the next two fires from now" moves between
        // sweeps: the same row resolves early on one pass and late on the next.
        // Anchoring to `last_seen` gives every row a fixed deadline.
        //
        // A weekday-only schedule: daily Mon–Fri, then a three-day jump.
        let schedule = vec![
            DAY,
            2 * DAY,
            3 * DAY,
            4 * DAY,
            5 * DAY,
            8 * DAY,
            9 * DAY,
            10 * DAY,
        ];

        // Last seen Thursday: the next run is Friday, one day later.
        let thursday = cron_resolve_threshold_micros(4 * DAY, schedule.clone(), 1);
        // Last seen Friday: the next run is Monday, THREE days later.
        let friday = cron_resolve_threshold_micros(5 * DAY, schedule, 1);

        assert_eq!(thursday, DAY);
        assert_eq!(friday, 3 * DAY);
        assert_ne!(
            thursday, friday,
            "each row's deadline must follow its own position in the schedule"
        );
    }

    #[test]
    fn test_cron_threshold_differs_from_naive_frequency_math() {
        // Why a separate function exists at all. A monthly cron alert still
        // carries some numeric `frequency` in its config; feeding that to
        // `resolve_threshold_micros` would resolve every group minutes after
        // the monthly run, then re-fire them all a month later.
        let monthly = vec![31 * DAY, 59 * DAY, 90 * DAY];
        let from_schedule = cron_resolve_threshold_micros(31 * DAY, monthly, 1);
        let from_frequency = resolve_threshold_micros(60, DEFAULT_DISAPPEARANCE_K);

        assert_eq!(from_schedule, 28 * DAY);
        assert!(
            from_schedule > from_frequency * 100,
            "the schedule-derived deadline must not be confusable with the frequency one"
        );
    }

    #[test]
    fn test_cron_threshold_never_resolves_when_the_schedule_runs_out() {
        // Fewer than K future occurrences known — an expired schedule, or a
        // caller that supplied too short a horizon. Any finite fallback would
        // resolve live groups on a cadence nobody configured, so this saturates
        // instead.
        let t = cron_resolve_threshold_micros(1_000 * SEC, vec![1_100 * SEC], 3);
        assert_eq!(
            t,
            i64::MAX,
            "an unknown deadline must never resolve a live group"
        );
    }

    #[test]
    fn test_cron_threshold_floors_for_a_dense_schedule() {
        // A cron firing every 10s with K=3 gives a 30s deadline — inside the
        // scheduler's own jitter. Same floor as the fixed-interval path.
        let schedule: Vec<i64> = (1..=5).map(|i| 1_000 * SEC + i * 10 * SEC).collect();
        assert_eq!(
            cron_resolve_threshold_micros(1_000 * SEC, schedule, 3),
            MIN_RESOLVE_THRESHOLD_SECS * SEC
        );
    }

    #[test]
    fn test_cron_threshold_rejects_a_non_positive_k() {
        let schedule = vec![1_100 * SEC, 1_200 * SEC];
        assert_eq!(
            cron_resolve_threshold_micros(1_000 * SEC, schedule.clone(), 0),
            MIN_RESOLVE_THRESHOLD_SECS * SEC
        );
        assert_eq!(
            cron_resolve_threshold_micros(1_000 * SEC, schedule, -1),
            MIN_RESOLVE_THRESHOLD_SECS * SEC
        );
    }

    #[test]
    fn test_cron_threshold_feeds_group_fate() {
        // The handoff: a schedule-derived threshold must drop straight into the
        // same fate machinery the fixed-interval path uses. Each is plausible
        // alone while together they resolve at the wrong moment.
        let schedule = vec![DAY, 2 * DAY, 5 * DAY];
        let last_seen = DAY;
        let resolve_after = cron_resolve_threshold_micros(last_seen, schedule, 2);
        assert_eq!(resolve_after, 4 * DAY, "the 2nd run after `last_seen`");

        let st = state_at("g", Some(AlertLevel::Critical), last_seen);
        assert_eq!(
            group_fate(&st, last_seen + 3 * DAY, resolve_after, 3600 * SEC),
            GroupFate::Keep,
            "one missed run is not a disappearance"
        );
        assert_eq!(
            group_fate(&st, last_seen + 5 * DAY, resolve_after, 3600 * SEC),
            GroupFate::Resolve,
            "past the Kth missed run it must resolve"
        );
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Counts the UI renders, and the opt-out path — §5.4 / §7.2 / M-9.
    // ═════════════════════════════════════════════════════════════════════════

    use crate::meta::alerts::grouping::{FetchPage, opt_out_evictions};

    // ── The "N of M groups firing" chip ─────────────────────────────────────

    #[test]
    fn test_groups_firing_counts_only_the_firing_groups() {
        // The chip says "N of M", so the two numbers must mean different
        // things. Reusing `groups_observed` for both would report every alert
        // as entirely on fire.
        let c = tc(Operator::GreaterThan, 100, Some(50));
        let classification = classify_groups(
            vec![
                GroupObservation::new(labels(&[("host", "crit")]), 150.0),
                GroupObservation::new(labels(&[("host", "warn")]), 75.0),
                GroupObservation::new(labels(&[("host", "ok")]), 1.0),
            ],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let rollup = update_for(&plan.updates, ROLLUP_GROUP_KEY)
            .unwrap()
            .state
            .as_ref()
            .unwrap();

        assert_eq!(rollup.groups_observed, Some(3));
        assert_eq!(
            rollup.groups_firing,
            Some(2),
            "warning-or-worse counts as firing; healthy does not"
        );
    }

    #[test]
    fn test_groups_firing_is_counted_before_the_cap_truncates() {
        // The number matters most exactly when it exceeds the cap. Counting
        // retained rows would report 500 for a 900-group incident — the same
        // silent under-reporting M-6 forbids for `groups_observed`.
        let c = tc(Operator::GreaterThan, 1, None);
        let obs: Vec<_> = (0..900)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i:03}"))]), 5.0))
            .collect();
        let classification = classify_groups(obs, &c, 500);

        assert_eq!(classification.firing_observed, 900);

        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let rollup = update_for(&plan.updates, ROLLUP_GROUP_KEY)
            .unwrap()
            .state
            .as_ref()
            .unwrap();
        assert_eq!(rollup.groups_firing, Some(900));
        assert_eq!(rollup.groups_observed, Some(900));
    }

    #[test]
    fn test_groups_firing_is_zero_not_absent_when_everything_is_healthy() {
        // `None` means "never recorded". A healthy alert must say "0 firing",
        // or the UI cannot tell a recovered alert from one that has no data.
        let c = tc(Operator::GreaterThan, 100, None);
        let classification = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 1.0)],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let rollup = update_for(&plan.updates, ROLLUP_GROUP_KEY)
            .unwrap()
            .state
            .as_ref()
            .unwrap();
        assert_eq!(rollup.groups_firing, Some(0));
    }

    #[test]
    fn test_group_rows_never_carry_the_rollup_counts() {
        // A group row carrying them would let the overflow banner and the chip
        // render from the wrong row, reporting one group's view as the alert's.
        let c = tc(Operator::GreaterThan, 100, None);
        let classification = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 150.0)],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let group = plan
            .updates
            .iter()
            .filter_map(|u| u.state.as_ref())
            .find(|s| s.group_key != ROLLUP_GROUP_KEY)
            .unwrap();

        assert_eq!(group.groups_firing, None);
        assert_eq!(group.groups_observed, None);
        assert_eq!(group.groups_observed_is_lower_bound, None);
        assert_eq!(group.groups_firing_is_lower_bound, None);
    }

    // ── Exactness: `≥` vs a real number ─────────────────────────────────────

    #[test]
    fn test_an_exhaustive_read_reports_exact_counts() {
        let page = FetchPage::default();
        assert!(!page.observed_is_lower_bound());
        assert!(!page.firing_is_lower_bound());
        assert_eq!(page.completeness(), GroupPageCompleteness::Complete);
    }

    #[test]
    fn test_a_full_page_that_reached_healthy_groups_bounds_only_the_total() {
        // THE divergence, and the reason these are two fields rather than one
        // shared flag. The fetch is severity-ordered, so seeing any healthy
        // group proves every firing group is already in hand: the firing count
        // is exact even though the total is not.
        let page = FetchPage {
            filled: true,
            reached_healthy: true,
        };
        assert!(
            page.observed_is_lower_bound(),
            "more groups may exist below the cutoff"
        );
        assert!(
            !page.firing_is_lower_bound(),
            "but none of them can be firing"
        );
        // And absence is still provable for firing groups, so M-7 may run.
        assert_eq!(page.completeness(), GroupPageCompleteness::Complete);
    }

    #[test]
    fn test_a_page_that_is_entirely_firing_bounds_both_counts() {
        // Nothing healthy was reached, so there may be more firing groups just
        // below the cutoff: neither number can be stated as fact, and absence
        // proves nothing at all.
        let page = FetchPage {
            filled: true,
            reached_healthy: false,
        };
        assert!(page.observed_is_lower_bound());
        assert!(page.firing_is_lower_bound());
        assert_eq!(page.completeness(), GroupPageCompleteness::Truncated);
    }

    #[test]
    fn test_a_short_page_is_exact_even_if_every_group_fired() {
        // The query had more to give and gave it: the page never filled, so
        // "all firing" is the whole truth rather than a cutoff artefact.
        let page = FetchPage {
            filled: false,
            reached_healthy: false,
        };
        assert!(!page.observed_is_lower_bound());
        assert!(!page.firing_is_lower_bound());
        assert_eq!(page.completeness(), GroupPageCompleteness::Complete);
    }

    #[test]
    fn test_exactness_markers_are_persisted_on_the_rollup_row() {
        // Persisted, not recomputed: the cap is mutable config, so a later
        // reader comparing the count against the current cap cannot recover
        // whether the number was exact when it was written.
        let c = tc(Operator::GreaterThan, 1, None);
        let obs: Vec<_> = (0..10)
            .map(|i| GroupObservation::new(labels(&[("host", &format!("h{i}"))]), 5.0))
            .collect();
        let classification = classify_groups(obs, &c, 500).with_page(FetchPage {
            filled: true,
            reached_healthy: false,
        });

        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let rollup = update_for(&plan.updates, ROLLUP_GROUP_KEY)
            .unwrap()
            .state
            .as_ref()
            .unwrap();

        assert_eq!(rollup.groups_observed_is_lower_bound, Some(true));
        assert_eq!(rollup.groups_firing_is_lower_bound, Some(true));
    }

    #[test]
    fn test_exact_counts_are_marked_exact_rather_than_left_null() {
        // `None` is reserved for rows written before the markers existed. A row
        // this code writes must always state which it is, or the UI has to
        // guess and will guess `≥` on every healthy alert.
        let c = tc(Operator::GreaterThan, 1, None);
        let classification = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 5.0)],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &HashMap::new(), 100);
        let rollup = update_for(&plan.updates, ROLLUP_GROUP_KEY)
            .unwrap()
            .state
            .as_ref()
            .unwrap();

        assert_eq!(rollup.groups_observed_is_lower_bound, Some(false));
        assert_eq!(rollup.groups_firing_is_lower_bound, Some(false));
    }

    // ── M-4: the two kinds of recovery ──────────────────────────────────────

    #[test]
    fn test_an_observed_recovery_records_the_value_it_recovered_at() {
        // The positive half of
        // `test_resolution_transition_carries_null_value_and_the_labels`. The
        // M-4 matrix separates the two recoveries on exactly this point: a
        // group observed back under threshold HAS a measurement and must record
        // it, while a vanished group has none and records NULL. Leaving this
        // one empty would make history read "recovered at —" for a host that
        // actually settled at 42.
        let c = tc(Operator::GreaterThan, 100, None);
        let key_a = group_key(&labels(&[("host", "a")]));
        let mut prev = HashMap::new();
        prev.insert(
            key_a.clone(),
            state_at(&key_a, Some(AlertLevel::Critical), 50),
        );

        let classification = classify_groups(
            vec![GroupObservation::new(labels(&[("host", "a")]), 42.0)],
            &c,
            500,
        );
        let plan = plan_group_updates("alert-1", &classification, &prev, 200);
        let t = update_for(&plan.updates, &key_a)
            .unwrap()
            .transition
            .as_ref()
            .expect("critical -> ok is a level change");

        assert_eq!(t.from_level, Some(AlertLevel::Critical));
        assert_eq!(t.to_level, Some(AlertLevel::Ok));
        assert_eq!(
            t.value,
            Some(42.0),
            "an observed recovery has a real measurement"
        );
        assert_eq!(t.group_labels.as_deref(), Some("host=a"));
    }

    // ── M-9: turning it back off ────────────────────────────────────────────

    #[test]
    fn test_opting_out_deletes_every_group_row() {
        // Opting out is configuration, not recovery. Draining these rows
        // through M-7 instead would write a wave of `Ok` transitions recording
        // recoveries that never happened, and leave stale firing groups on
        // screen for K×interval plus the grace period — so "just turn it off"
        // would visibly not work.
        let mut tracked = HashMap::new();
        for host in ["a", "b", "c"] {
            let k = group_key(&labels(&[("host", host)]));
            tracked.insert(k.clone(), state_at(&k, Some(AlertLevel::Critical), 50));
        }

        let evicted = opt_out_evictions(&tracked);
        assert_eq!(evicted.len(), 3, "every group row goes");
        for host in ["a", "b", "c"] {
            assert!(evicted.contains(&group_key(&labels(&[("host", host)]))));
        }
    }

    #[test]
    fn test_opting_out_leaves_the_rollup_row_alone() {
        // It is the alert's own state, and the simple-alert path keeps writing
        // it. Deleting it would blank the alert's level and `since` on a config
        // change that was supposed to be a safe rollback.
        let mut tracked = HashMap::new();
        tracked.insert(
            ROLLUP_GROUP_KEY.to_string(),
            state_at(ROLLUP_GROUP_KEY, Some(AlertLevel::Critical), 50),
        );
        let k = group_key(&labels(&[("host", "a")]));
        tracked.insert(k.clone(), state_at(&k, Some(AlertLevel::Critical), 50));

        let evicted = opt_out_evictions(&tracked);
        assert_eq!(evicted, vec![k]);
        assert!(!evicted.iter().any(|e| e == ROLLUP_GROUP_KEY));
    }

    #[test]
    fn test_opting_out_of_an_alert_with_no_group_rows_deletes_nothing() {
        let mut tracked = HashMap::new();
        tracked.insert(
            ROLLUP_GROUP_KEY.to_string(),
            state_at(ROLLUP_GROUP_KEY, Some(AlertLevel::Ok), 50),
        );
        assert!(opt_out_evictions(&tracked).is_empty());
        assert!(opt_out_evictions(&HashMap::new()).is_empty());
    }

    #[test]
    fn test_opt_out_delete_batch_is_deterministic() {
        // `tracked` is a HashMap, so an unsorted batch would vary run to run.
        let mut tracked = HashMap::new();
        for i in 0..12 {
            let k = group_key(&labels(&[("host", &format!("h{i}"))]));
            tracked.insert(k.clone(), state_at(&k, Some(AlertLevel::Critical), 50));
        }

        let first = opt_out_evictions(&tracked);
        let second = opt_out_evictions(&tracked);
        assert_eq!(first, second);

        let mut sorted = first.clone();
        sorted.sort();
        assert_eq!(first, sorted, "the delete batch must be ordered");
    }
}
