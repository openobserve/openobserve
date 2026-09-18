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

//! L0 — the AI SRE agent as level zero: P1 is never gated, severity only ratchets up.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::policy::Channel;
use crate::meta::alerts::priority::AlertPriority;

/// Shortest triage hold a team may configure. The agent's pre-flight takes
/// seconds, so a shorter hold always expires before it can pay for itself.
pub const MIN_TRIAGE_BUDGET_SECONDS: i64 = 30;

/// Longest triage hold a team may configure. Past ten minutes the question
/// stops being "why is the page late" and becomes "did the pager break".
pub const MAX_TRIAGE_BUDGET_SECONDS: i64 = 600;

/// Actor recorded for anything the agent itself produced.
pub const AGENT_ACTOR: &str = "o2-sre";

// §2.1 — the verdict contract

/// How sure the agent is, as a band rather than a number.
///
/// There is no calibrated probability behind it, so a percentage would be
/// false precision. `High` states the cause as the headline; `Low` renders it
/// as an unverified guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

impl Confidence {
    pub const ALL: [Self; 3] = [Self::High, Self::Medium, Self::Low];

    /// Stable wire and metric-label value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
        }
    }
}

impl std::fmt::Display for Confidence {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// What kind of change the agent thinks is responsible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Deploy,
    Commit,
    ConfigChange,
    FeatureFlag,
    Infra,
}

/// The change the agent suspects, if it found one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SuspectChange {
    pub kind: ChangeKind,
    /// PR, commit or rollout identifier.
    pub reference: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Microseconds, matching the codebase convention.
    pub occurred_at: i64,
}

/// One re-runnable claim: the query, panel or commit behind a finding. A
/// receipt, not an assertion — a responder who distrusts the agent still lands
/// on the right panels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EvidenceLink {
    pub label: String,
    pub url: String,
}

/// What the agent recommends the engine do about paging. A recommendation,
/// never a decision: the engine applies it under policy a human configured in
/// advance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PageAction {
    Page,
    Downgrade,
    Suppress,
}

impl PageAction {
    pub const ALL: [Self; 3] = [Self::Page, Self::Downgrade, Self::Suppress];

    /// Stable wire and metric-label value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Page => "page",
            Self::Downgrade => "downgrade",
            Self::Suppress => "suppress",
        }
    }
}

impl std::fmt::Display for PageAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The paging recommendation and its justification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PageRecommendation {
    pub action: PageAction,
    /// Promotion only. [`ratchet`] discards anything at or below the firing's
    /// current severity.
    ///
    /// Hand-written deserializer because a language model writes this: `"P2"`,
    /// `"p2"` and bare `2` all mean the same. Anything off the scale fails the
    /// whole verdict (§2.2) — half a verdict is a paging recommendation read
    /// from a value nobody checked.
    #[serde(
        default,
        deserialize_with = "deserialize_severity_suggestion",
        skip_serializing_if = "Option::is_none"
    )]
    pub severity_suggestion: Option<AlertPriority>,
    /// Rendered verbatim in the audit event and on any promoted page.
    pub reason: String,
}

/// Read a `severity_suggestion` in any spelling a model writes. `"P2"`, `"p2"`
/// and `2` are one severity; `null` and an absent field are no suggestion.
/// Anything else rejects the whole verdict rather than half of it.
fn deserialize_severity_suggestion<'de, D>(d: D) -> Result<Option<AlertPriority>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error as _;

    let raw = Option::<serde_json::Value>::deserialize(d)?;
    let value = match raw {
        None | Some(serde_json::Value::Null) => return Ok(None),
        Some(v) => v,
    };
    let id = match &value {
        serde_json::Value::Number(n) => n.as_i64(),
        serde_json::Value::String(s) => {
            let t = s.trim();
            // Both spellings arrive: `P2` from a human, the bare integer from the API.
            let digits = t.strip_prefix(['P', 'p']).unwrap_or(t);
            digits.parse::<i64>().ok()
        }
        _ => None,
    };
    id.and_then(|v| i32::try_from(v).ok())
        .and_then(AlertPriority::from_i32)
        .map(Some)
        .ok_or_else(|| D::Error::custom(format!("`{value}` is not one of P1-P5")))
}

/// What a suggested action is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    Rollback,
    Scale,
    Restart,
    Runbook,
    Other,
}

/// Something a human might do next. Inert: three strings rendered as text. No
/// `workflow_ref`, no `args`, no grant, because there is no execution path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ProposedAction {
    pub title: String,
    pub kind: ActionKind,
    pub detail: String,
}

/// What the agent concluded, emitted at the end of every autonomous RCA run.
/// Persisted on the subject timeline and cached on the escalation state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AnalysisVerdict {
    /// One sentence. `"cause unknown"` is a first-class value — the prompt
    /// prefers it to confabulation, and such a verdict still recommends `Page`.
    pub probable_cause: String,
    pub confidence: Confidence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suspect_change: Option<SuspectChange>,
    /// Identity-dimension paths, the same vocabulary routing uses.
    #[serde(default)]
    pub impacted_services: Vec<String>,
    #[serde(default)]
    pub evidence_links: Vec<EvidenceLink>,
    pub page_recommendation: PageRecommendation,
    /// Candidates only; execution is out of scope.
    #[serde(default)]
    pub proposed_actions: Vec<ProposedAction>,
    /// Pointer to the full markdown report in its existing storage.
    pub report_ref: String,
}

// §3 — the analysis state that rides the escalation row

/// Where the investigation has got to.
///
/// `Skipped` covers RCA disabled, agent URL unset, failed health check, and
/// the in-flight and cooldown guards. The engine treats it and `Failed`
/// identically: behave exactly as the pre-L0 system does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisStatus {
    Pending,
    Complete,
    Failed,
    Skipped,
}

impl AnalysisStatus {
    pub const ALL: [Self; 4] = [Self::Pending, Self::Complete, Self::Failed, Self::Skipped];

    /// Whether a verdict can still arrive. `Failed` and `Skipped` both mean no,
    /// so the gate must not wait on either.
    pub fn may_still_answer(&self) -> bool {
        matches!(self, Self::Pending)
    }
}

/// The investigation, as the escalation state carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AnalysisState {
    pub status: AnalysisStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verdict: Option<AnalysisVerdict>,
    /// When the run was asked for. The hold is measured from this, not from the
    /// clock at a re-queue, so a node dying mid-TRIAGE resumes the same
    /// deadline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
}

// §4 — the L0 policy block

/// How L0 relates to paging at one severity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum L0Mode {
    /// The agent runs alongside a page that has already gone out.
    Parallel,
    /// The page is held for the triage budget, or until the verdict lands.
    Gate,
    /// The agent investigates and nobody is paged.
    Only,
}

impl L0Mode {
    /// Stable wire value. Read by the ladder screen to decide whether to draw
    /// an L0 step above the first rung.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Parallel => "parallel",
            Self::Gate => "gate",
            Self::Only => "only",
        }
    }
}

/// Per-severity modes, exactly as the `l0_json` column spells them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct L0Modes {
    #[serde(rename = "P1")]
    pub p1: L0Mode,
    #[serde(rename = "P2")]
    pub p2: L0Mode,
    #[serde(rename = "P3")]
    pub p3: L0Mode,
    /// Covers P4 and P5 — neither pages a human, so neither has a gate to set.
    #[serde(rename = "P4")]
    pub p4: L0Mode,
}

/// A team's L0 block. Ships with every auto-created policy, so nobody has to
/// configure L0 to benefit from it. No `allow_demotion` knob: the ratchet is an
/// invariant of the engine, not a team preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct L0Policy {
    pub mode: L0Modes,
    pub triage_budget_seconds: i64,
    pub allow_promotion: bool,
    /// How far one verdict may raise a severity, so a P4 cannot become a P1 in
    /// a single hop.
    pub max_promotion_steps: u8,
    pub allow_downgrade: bool,
    /// **Opt-in.** Until a team enables it, a Suppress verdict is recorded as a
    /// recommendation and the page still goes out.
    pub allow_suppress: bool,
}

/// Why an L0 block was rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum L0Error {
    /// P1 is not gateable. The invariant is not a setting.
    P1MustBeParallel(L0Mode),
    /// P4 and P5 page nobody, so there is nothing to hold. A gate there would
    /// insert the trigger row §3 says a P4 never gets.
    P4MustBeAgentOnly(L0Mode),
    /// Outside `MIN_TRIAGE_BUDGET_SECONDS..=MAX_TRIAGE_BUDGET_SECONDS`.
    BudgetOutOfRange(i64),
}

impl std::fmt::Display for L0Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::P1MustBeParallel(mode) => write!(
                f,
                "P1 always runs the agent in parallel and cannot be set to `{mode:?}`: holding a critical page behind a model is not a setting this product offers"
            ),
            Self::P4MustBeAgentOnly(mode) => write!(
                f,
                "P4 and P5 page nobody, so the agent runs alone there and the mode cannot be `{mode:?}`: there is no page to hold and none to run beside"
            ),
            Self::BudgetOutOfRange(v) => write!(
                f,
                "triage budget {v}s is outside {MIN_TRIAGE_BUDGET_SECONDS}-{MAX_TRIAGE_BUDGET_SECONDS} seconds"
            ),
        }
    }
}

impl std::error::Error for L0Error {}

impl L0Policy {
    /// The block every auto-created policy carries.
    pub fn defaults() -> Self {
        Self {
            mode: L0Modes {
                p1: L0Mode::Parallel,
                p2: L0Mode::Gate,
                p3: L0Mode::Gate,
                p4: L0Mode::Only,
            },
            triage_budget_seconds: 90,
            allow_promotion: true,
            max_promotion_steps: 2,
            allow_downgrade: true,
            // Opt-in: one missed real page costs more trust than a quarter of noise reduction buys.
            allow_suppress: false,
        }
    }

    pub fn validate(&self) -> Result<(), L0Error> {
        if self.mode.p1 != L0Mode::Parallel {
            return Err(L0Error::P1MustBeParallel(self.mode.p1));
        }
        if self.mode.p4 != L0Mode::Only {
            return Err(L0Error::P4MustBeAgentOnly(self.mode.p4));
        }
        if !(MIN_TRIAGE_BUDGET_SECONDS..=MAX_TRIAGE_BUDGET_SECONDS)
            .contains(&self.triage_budget_seconds)
        {
            return Err(L0Error::BudgetOutOfRange(self.triage_budget_seconds));
        }
        Ok(())
    }

    /// The mode that actually applies at `priority`.
    ///
    /// Never a plain field read. P1 is parallel whatever the row says; `Only`
    /// on a paging severity would silence it; `Gate` on P4/P5 would hold a
    /// firing that pages nobody. Derived from [`severity_pages`] rather than
    /// trusted from the column.
    pub fn mode_for(&self, priority: AlertPriority) -> L0Mode {
        // A severity that pages nobody has no page to hold, so the column is not trusted here.
        if !severity_pages(priority) {
            return L0Mode::Only;
        }
        // The P1 invariant. Not a setting, so not a field read either.
        if priority == AlertPriority::P1 {
            return L0Mode::Parallel;
        }
        let stored = match priority {
            AlertPriority::P2 => self.mode.p2,
            _ => self.mode.p3,
        };
        match stored {
            // `only` on a paging severity would silence it for ever, so read the safest meaning.
            L0Mode::Only => L0Mode::Parallel,
            other => other,
        }
    }

    /// The triage hold in microseconds, clamped into the documented bounds.
    /// Clamped on read as well as refused on write: rows arrive from
    /// replication and from hands on a database, and an unbounded hold is a
    /// page that never happens.
    pub fn triage_budget_micros(&self) -> i64 {
        // Clamp before multiplying: `i64::MAX` seconds overflows into a deadline no clock reaches.
        self.triage_budget_seconds
            .clamp(MIN_TRIAGE_BUDGET_SECONDS, MAX_TRIAGE_BUDGET_SECONDS)
            * 1_000_000
    }
}

// §2.1a — the ratchet

/// What the engine did with a `severity_suggestion`. No variant lowers a
/// severity, and that absence is the point.
///
/// Serialised because the page is dispatched by a later tick than the one that
/// decided it: recomputing at render time reads the already promoted severity,
/// answers `Discarded`, and drops the promotion note §5.3 never drops.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SeverityDecision {
    /// The verdict suggested nothing.
    Unchanged { current: AlertPriority },
    /// The suggestion was at or below the current severity. Discarded, logged
    /// and counted; the firing proceeds at its original severity.
    Discarded {
        current: AlertPriority,
        requested: AlertPriority,
    },
    /// A real promotion the team has turned off. Recorded and rendered on the
    /// page; severity unchanged.
    Refused {
        current: AlertPriority,
        requested: AlertPriority,
    },
    /// Applied. `to` is always more urgent than `from`; it differs from
    /// `requested` when clamped to `max_promotion_steps`, and both are kept so
    /// the timeline can show what was asked for.
    Promoted {
        from: AlertPriority,
        to: AlertPriority,
        requested: AlertPriority,
    },
}

impl SeverityDecision {
    /// The severity the firing proceeds at — the single function every caller
    /// must use. Returns the current severity or a more urgent one, never less.
    pub fn applied(&self) -> AlertPriority {
        match self {
            Self::Unchanged { current }
            | Self::Discarded { current, .. }
            | Self::Refused { current, .. } => *current,
            // The only variant that moves anything, and `ratchet` guarantees `to` outranks `from`.
            Self::Promoted { to, .. } => *to,
        }
    }

    /// True only for a suggestion at or below the current severity — the case
    /// `oncall_l0_severity_clamp_total` counts, and the one expected to be ~0.
    pub fn was_demotion_attempt(&self) -> bool {
        matches!(self, Self::Discarded { .. })
    }
}

/// Apply a `severity_suggestion` to a firing's current severity — all of §2.1a.
/// At or below `current` is discarded and counted; beyond
/// `max_promotion_steps` is clamped and applied.
///
/// `AlertPriority::to_i32()` runs P1 = 1 … P5 = 5, so promotion *decreases* the
/// integer. Compare through [`AlertPriority::is_more_urgent_than`]: a bare `>`
/// on raw ids turns every demotion into a promotion.
pub fn ratchet(
    current: AlertPriority,
    suggestion: Option<AlertPriority>,
    l0: &L0Policy,
) -> SeverityDecision {
    let Some(requested) = suggestion else {
        return SeverityDecision::Unchanged { current };
    };
    // On the raw ids P4 (4) > P2 (2), so `requested > current` reads a demotion as a promotion.
    if !requested.is_more_urgent_than(current) {
        return SeverityDecision::Discarded { current, requested };
    }
    if !l0.allow_promotion {
        return SeverityDecision::Refused { current, requested };
    }
    // Promotion decreases the id, so the number of rungs asked for is the drop.
    let asked = current.to_i32() - requested.to_i32();
    let steps = asked.min(i32::from(l0.max_promotion_steps));
    if steps <= 0 {
        // A bound of zero means "no promotions": clamping to current would page for nothing.
        return SeverityDecision::Refused { current, requested };
    }
    match AlertPriority::from_i32(current.to_i32() - steps) {
        Some(to) => SeverityDecision::Promoted {
            from: current,
            to,
            requested,
        },
        // Unreachable: `steps <= asked` keeps the result inside the scale.
        None => SeverityDecision::Refused { current, requested },
    }
}

// §1, §3 — the gate

/// What happens to a firing the instant it is created.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GatePlan {
    /// Level 1 dispatches inline at t=0; the analysis runs alongside it and its
    /// findings update the same message in place.
    Parallel,
    /// Hold the page. `fire_at` is the TRIAGE row's `next_run_at`, absolute
    /// micros — a ceiling, not a wait: a verdict ends the hold immediately.
    Gate { fire_at: i64 },
    /// The agent investigates, the verdict is recorded, the subject ends in
    /// `triaged`, and **no trigger row is ever inserted**.
    L0Only,
}

impl GatePlan {
    /// Whether the engine inserts an escalation row at all.
    pub fn inserts_a_trigger_row(&self) -> bool {
        // A gate inserts a TRIAGE trigger row with a deadline, exactly as a parallel firing does.
        matches!(self, Self::Parallel | Self::Gate { .. })
    }
}

/// Decide how a firing enters the ladder. Takes no `now`: the hold is anchored
/// on `analysis.requested_at`, so a node that dies mid-TRIAGE recomputes the
/// same absolute deadline instead of restarting the budget.
pub fn gate_plan(
    l0: &L0Policy,
    priority: AlertPriority,
    analysis: &AnalysisState,
    fired_at: i64,
) -> GatePlan {
    match l0.mode_for(priority) {
        L0Mode::Only => GatePlan::L0Only,
        L0Mode::Parallel => GatePlan::Parallel,
        L0Mode::Gate => {
            // §6: a run that will not answer has no hold to sit in, so paging never waits.
            if !analysis.status.may_still_answer() {
                return GatePlan::Parallel;
            }
            // Anchored on the request, so a node dying mid-TRIAGE recomputes the same deadline.
            let anchor = analysis.requested_at.unwrap_or(fired_at);
            GatePlan::Gate {
                fire_at: anchor + l0.triage_budget_micros(),
            }
        }
    }
}

// §3, §4 — applying a verdict

/// What the engine does with a verdict.
///
/// Note what cannot be expressed: there is no field for a lowered severity. A
/// `Downgrade` sets `quieter_channels`, a choice about one notification, never
/// about the record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerdictOutcome {
    /// The hold has time left and no verdict has landed. Come back at `until`.
    Hold { until: i64 },
    /// Page now. `promoted_from` is set only when the ratchet raised the
    /// severity, and then the page is the delta the higher severity adds.
    Page {
        severity: AlertPriority,
        promoted_from: Option<AlertPriority>,
        /// A `Downgrade` the team allows: this firing rides a quieter channel
        /// set. The recorded severity is `severity`, unchanged.
        quieter_channels: bool,
    },
    /// No page at all. The record is still written, the verdict still lands on
    /// the timeline, and the firing still appears in the team's digest.
    Suppress,
    /// The page has already gone out. The verdict rides as one ledger-deduped
    /// follow-up on non-interrupting channels. Also the P4/P5 outcome, where
    /// there is nobody to follow up with.
    FollowUp { severity: AlertPriority },
    /// The gate is over and no usable verdict arrived. Page exactly as the
    /// pre-L0 system would have.
    FailOpen { severity: AlertPriority },
}

impl VerdictOutcome {
    /// Whether this firing rides a quieter channel set — the one question the
    /// dispatcher asks of a `Downgrade`. A function because the field is
    /// otherwise read at one match arm and ignored everywhere else, which is
    /// how a knob ends up computed and inert.
    pub fn wants_quieter_channels(&self) -> bool {
        matches!(
            self,
            Self::Page {
                quieter_channels: true,
                ..
            }
        )
    }

    /// Whether this outcome wakes anybody.
    pub fn pages_anyone(&self) -> bool {
        // Neither wakes anybody: `FollowUp` does not interrupt, `Hold` is the gate still running.
        matches!(self, Self::Page { .. } | Self::FailOpen { .. })
    }
}

/// The instant a gated firing's hold runs out. Anchored on the request, like
/// [`gate_plan`], so a re-queue after a crash resumes the persisted deadline.
fn hold_deadline(l0: &L0Policy, analysis: &AnalysisState, now: i64) -> i64 {
    analysis.requested_at.unwrap_or(now) + l0.triage_budget_micros()
}

/// The verdict-application decision — pure over `(policy.l0, analysis,
/// severity, now)`. `severity` is the firing's recorded severity, not the
/// suggestion.
pub fn apply_verdict(
    l0: &L0Policy,
    analysis: &AnalysisState,
    severity: AlertPriority,
    now: i64,
) -> VerdictOutcome {
    let verdict = analysis.verdict.as_ref();
    let decision = ratchet(
        severity,
        verdict.and_then(|v| v.page_recommendation.severity_suggestion),
        l0,
    );
    // The one thing a verdict may do at any severity and in any mode: raise it.
    let promotion = match decision {
        SeverityDecision::Promoted { from, to, .. } => Some((from, to)),
        _ => None,
    };

    match l0.mode_for(severity) {
        // P4 and P5: no page to hold, so the only way anybody is woken is a promotion off P4.
        L0Mode::Only => match promotion {
            Some((from, to)) if severity_pages(to) => VerdictOutcome::Page {
                severity: to,
                promoted_from: Some(from),
                quieter_channels: false,
            },
            _ => VerdictOutcome::FollowUp { severity },
        },
        // The page went out at t=0: turning the gate off trades away suppression and downgrade.
        L0Mode::Parallel => match promotion {
            Some((from, to)) => VerdictOutcome::Page {
                severity: to,
                promoted_from: Some(from),
                quieter_channels: false,
            },
            None => VerdictOutcome::FollowUp { severity },
        },
        L0Mode::Gate => {
            let deadline = hold_deadline(l0, analysis, now);
            let Some(verdict) = verdict else {
                // No verdict is on its way, so `Failed` and `Skipped` do not wait out a budget.
                if analysis.status.may_still_answer() && now < deadline {
                    return VerdictOutcome::Hold { until: deadline };
                }
                return VerdictOutcome::FailOpen { severity };
            };
            // A promotion IS a page, so it re-enters the ladder whenever it lands, hold included.
            if let Some((from, to)) = promotion {
                return VerdictOutcome::Page {
                    severity: to,
                    promoted_from: Some(from),
                    quieter_channels: false,
                };
            }
            // A verdict landing on the deadline races a page already decided, and the page wins.
            let arrived = analysis.completed_at.unwrap_or(now);
            if arrived >= deadline {
                return VerdictOutcome::FollowUp { severity };
            }
            match verdict.page_recommendation.action {
                PageAction::Suppress if l0.allow_suppress => VerdictOutcome::Suppress,
                PageAction::Downgrade => VerdictOutcome::Page {
                    severity,
                    promoted_from: None,
                    // A choice about one notification; the recorded severity is untouched.
                    quieter_channels: l0.allow_downgrade,
                },
                // A Suppress the team has not opted into is advice: the page still goes out.
                PageAction::Page | PageAction::Suppress => VerdictOutcome::Page {
                    severity,
                    promoted_from: None,
                    quieter_channels: false,
                },
            }
        }
    }
}

/// Whether a severity pages a human at all under §1's table. L0's own table,
/// not the policy's ladder: this asks whether a promotion into this severity
/// should wake somebody.
pub fn severity_pages(priority: AlertPriority) -> bool {
    match priority {
        AlertPriority::P1 | AlertPriority::P2 | AlertPriority::P3 => true,
        // In-app / business-hours digest, and that is unchanged by L0.
        AlertPriority::P4 | AlertPriority::P5 => false,
    }
}

// §6 — the guards that decide whether L0 runs at all

/// The analysis status a run ends in. §6: a report with no usable verdict block
/// is `Failed`, not `Complete` — leaving it `Pending` would make every
/// malformed report cost the full budget in latency.
pub fn analysis_status_after_run(produced_a_verdict: bool) -> AnalysisStatus {
    if produced_a_verdict {
        AnalysisStatus::Complete
    } else {
        // `Pending` would cost every malformed report the full triage budget.
        AnalysisStatus::Failed
    }
}

/// The analysis status a firing starts with. L0 adds no new trigger path:
/// these are the guards the RCA trigger already evaluates. Every blocked
/// reason is `Skipped`, and `Skipped` means "behave exactly as today".
pub fn analysis_status_for_start(
    rca_enabled: bool,
    agent_url_set: bool,
    agent_healthy: bool,
    analysis_in_flight: bool,
    cooldown_elapsed: bool,
) -> AnalysisStatus {
    let clear =
        rca_enabled && agent_url_set && agent_healthy && !analysis_in_flight && cooldown_elapsed;
    if clear {
        AnalysisStatus::Pending
    } else {
        // Every blocked reason is one state, and that state means "behave exactly as today".
        AnalysisStatus::Skipped
    }
}

// §8 — observability

/// One counter movement caused by applying a verdict. Returned rather than
/// emitted, so the decision stays pure and a dashboard and the timeline cannot
/// disagree about what happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum L0Metric {
    /// `oncall_l0_verdicts_total{action, confidence}` — volume and mix.
    Verdict {
        action: PageAction,
        confidence: Confidence,
    },
    /// `oncall_l0_budget_expired_total` — the agent was too slow for the gate.
    BudgetExpired,
    /// `oncall_l0_promoted_total{from, to}` — the ratchet in use.
    Promoted {
        from: AlertPriority,
        to: AlertPriority,
    },
    /// `oncall_l0_severity_clamp_total` — an attempted demotion, refused.
    /// Expected to be ~0; a nonzero rate is a prompt regression or an injection
    /// attempt, not a routine event.
    SeverityClamped,
    /// `oncall_l0_suppressed_total` — only ever nonzero for opted-in teams.
    Suppressed,
    /// `oncall_l0_downgraded_total` — only ever nonzero for opted-in teams.
    Downgraded,
}

/// Every counter one verdict application moves, over the same inputs as
/// [`apply_verdict`].
pub fn metrics_for(
    l0: &L0Policy,
    analysis: &AnalysisState,
    severity: AlertPriority,
    now: i64,
) -> Vec<L0Metric> {
    let mut moved = Vec::new();
    let outcome = apply_verdict(l0, analysis, severity, now);

    if let Some(verdict) = &analysis.verdict {
        // The denominator: what the agent said, whatever the engine then did with it.
        moved.push(L0Metric::Verdict {
            action: verdict.page_recommendation.action,
            confidence: verdict.confidence,
        });
        let decision = ratchet(
            severity,
            verdict.page_recommendation.severity_suggestion,
            l0,
        );
        if decision.was_demotion_attempt() {
            // Expected to be ~0: a step-clamped promotion is routine and would read as noise.
            moved.push(L0Metric::SeverityClamped);
        }
        if let SeverityDecision::Promoted { from, to, .. } = decision {
            moved.push(L0Metric::Promoted { from, to });
        }
    } else if analysis.status.may_still_answer()
        && l0.mode_for(severity) == L0Mode::Gate
        && now >= hold_deadline(l0, analysis, now)
    {
        // "Was the agent too slow for the gate": a run that never started did not run out of time.
        moved.push(L0Metric::BudgetExpired);
    }

    match outcome {
        VerdictOutcome::Suppress => moved.push(L0Metric::Suppressed),
        VerdictOutcome::Page {
            quieter_channels: true,
            ..
        } => moved.push(L0Metric::Downgraded),
        _ => {}
    }
    moved
}

// §2.2 — the parser contract

/// A report and whatever verdict it carried. `report` is the input unchanged in
/// every case: a malformed verdict can never lose a report or a page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedReport<'a> {
    pub report: &'a str,
    pub verdict: Option<AnalysisVerdict>,
}

/// Split an agent report into the markdown that is stored and the verdict the
/// ladder consumes. The verdict is a fenced ` ```json verdict ` block at the
/// end. Parse failure or an absent block is no verdict — never an error, never
/// a reason to drop the report.
pub fn parse_report(rca_content: &str) -> ParsedReport<'_> {
    ParsedReport {
        // The input, unchanged, in every case: a malformed verdict can never lose a report.
        report: rca_content,
        verdict: last_verdict_block(rca_content).and_then(|b| serde_json::from_str(&b).ok()),
    }
}

/// The body of the last ` ```json verdict ` fence. The last one, because an
/// agent that re-ran and emitted a second block must not leave the reader
/// guessing which one the ladder used.
fn last_verdict_block(rca_content: &str) -> Option<String> {
    let mut found: Option<String> = None;
    let mut open: Option<Vec<&str>> = None;
    for line in rca_content.lines() {
        match &mut open {
            None => {
                // A report may fence ordinary JSON that is not a recommendation.
                if let Some(info) = line.trim().strip_prefix("```")
                    && info.split_whitespace().collect::<Vec<_>>() == ["json", "verdict"]
                {
                    open = Some(Vec::new());
                }
            }
            Some(body) => {
                if line.trim_start().starts_with("```") {
                    found = Some(body.join("\n"));
                    open = None;
                } else {
                    body.push(line);
                }
            }
        }
    }
    found
}

// §5 — what the notifications carry

/// The channels a follow-up verdict update may use. An allowlist: a denylist of
/// the urgent ones would admit every channel this product adds later without
/// anybody deciding it should. Of §5.2's three, only email still exists.
pub fn update_channels(channels: &[Channel]) -> Vec<Channel> {
    channels
        .iter()
        .copied()
        .filter(|c| matches!(c, Channel::Email))
        .collect()
}

/// The channel set a downgraded firing is notified on. No channel this build
/// can send wakes a sleeping person, so there is nothing quieter to drop to —
/// and a downgrade may make a page quieter, never make it disappear. Kept as
/// the seam for when an interrupting channel lands.
pub fn quieter_channels(channels: &[Channel]) -> Vec<Channel> {
    channels.to_vec()
}

/// The line every message on a promoted page carries. Never dropped from the
/// template: a responder woken by a machine's judgement is owed that judgement
/// in the first line.
pub fn promotion_note(
    from: AlertPriority,
    to: AlertPriority,
    at_micros: i64,
    reason: &str,
) -> String {
    let at = chrono::DateTime::from_timestamp_micros(at_micros)
        .map(|t| t.format("%H:%M:%S").to_string())
        .unwrap_or_else(|| at_micros.to_string());
    let line = format!("{to} · promoted from {from} at {at}");
    if reason.is_empty() {
        // An empty reason must not produce a line that trails off claiming nothing.
        line
    } else {
        format!("{line} — {reason}")
    }
}

/// The investigation lines a notification renders.
///
/// The empty case matters most: `Skipped` or `Failed` renders the pre-L0
/// message byte-for-byte. `Pending` renders one "investigation running" line
/// with its deep link; `Complete` renders the findings.
///
/// Rendered from `decision`, not from the verdict alone. A discarded demotion
/// printed raw would put "P4" on a P2 page — the demotion §2.1a refuses,
/// arriving by way of the template.
pub fn verdict_lines(analysis: &AnalysisState, decision: &SeverityDecision) -> Vec<String> {
    let Some(verdict) = &analysis.verdict else {
        // Nothing added, so an SMTP-only deployment renders the pre-L0 message byte-for-byte.
        if analysis.status.may_still_answer() {
            return vec!["AI investigation running".to_string()];
        }
        return Vec::new();
    };

    let mut lines = vec![format!(
        "probable cause: {} ({})",
        verdict.probable_cause, verdict.confidence
    )];
    if let Some(change) = &verdict.suspect_change {
        let who = change
            .author
            .as_ref()
            .map(|a| format!(" by {a}"))
            .unwrap_or_default();
        lines.push(format!(
            "suspect change: {:?} {}{who}",
            change.kind, change.reference
        ));
    }
    if !verdict.impacted_services.is_empty() {
        lines.push(format!(
            "impacted: {}",
            verdict.impacted_services.join(", ")
        ));
    }
    for link in &verdict.evidence_links {
        lines.push(format!("· {} — {}", link.label, link.url));
    }
    lines.push(format!(
        "recommendation: {} — {}",
        verdict.page_recommendation.action, verdict.page_recommendation.reason
    ));
    // From what the engine DID: a discarded demotion still carries `severity_suggestion: P4`.
    match decision {
        SeverityDecision::Promoted { from, to, .. } => lines.push(promotion_note(
            *from,
            *to,
            analysis.completed_at.unwrap_or_default(),
            &verdict.page_recommendation.reason,
        )),
        // §6: a promotion the team turned off is still judgement the responder can act on.
        SeverityDecision::Refused { current, requested } => lines.push(format!(
            "the agent judged this a {requested}; this team does not apply promotions, so it pages as a {current}"
        )),
        SeverityDecision::Discarded { .. } | SeverityDecision::Unchanged { .. } => {}
    }
    for action in &verdict.proposed_actions {
        lines.push(format!("suggested: {} — {}", action.title, action.detail));
    }
    lines
}

/// Whether a channel can revise a message it already delivered. No channel this
/// build can send is revisable, so a verdict always rides the one follow-up
/// update — which is why the update is ledger-deduped and the edit is not.
pub fn updates_in_place(channel: Channel) -> bool {
    match channel {
        Channel::Email | Channel::Webhook => false,
    }
}

/// Whether the verdict reached the responder before they acknowledged — the
/// headline metric. A function because an inverted comparison silently inflates
/// the number that justifies the feature.
pub fn verdict_beat_the_ack(verdict_at: Option<i64>, acked_at: i64) -> bool {
    // Strictly before: landing at the same instant briefed nobody, and `<=` inflates the metric.
    verdict_at.is_some_and(|at| at < acked_at)
}

/// Whether a suppressed firing coming back counts against the suppression: a
/// suppressed subject that re-fired at or above its original severity within 24
/// hours. If this is not ~zero, teams should not enable suppression.
pub fn is_false_suppress(
    suppressed_at: i64,
    suppressed_severity: AlertPriority,
    refired_at: i64,
    refired_severity: AlertPriority,
) -> bool {
    const TWENTY_FOUR_HOURS: i64 = 24 * 3_600 * 1_000_000;
    let since = refired_at - suppressed_at;
    // Something that fired before the suppression is not its consequence.
    if !(0..TWENTY_FOUR_HOURS).contains(&since) {
        return false;
    }
    // At **or above**: a suppressed P3 returning as a P3 is what the trust metric counts.
    refired_severity == suppressed_severity
        || refired_severity.is_more_urgent_than(suppressed_severity)
}

#[cfg(test)]
mod tests {
    use super::*;

    const P1: AlertPriority = AlertPriority::P1;
    const P2: AlertPriority = AlertPriority::P2;
    const P3: AlertPriority = AlertPriority::P3;
    const P4: AlertPriority = AlertPriority::P4;
    const P5: AlertPriority = AlertPriority::P5;

    const ALL: [AlertPriority; 5] = [P1, P2, P3, P4, P5];

    const SECOND: i64 = 1_000_000;
    const FIRED_AT: i64 = 1_700_000_000_000_000;

    /// A policy built by hand, so a test can express one that a stored row
    /// could hold even though `validate` would refuse it.
    #[allow(clippy::too_many_arguments)]
    fn raw(
        p1: L0Mode,
        p2: L0Mode,
        p3: L0Mode,
        p4: L0Mode,
        budget: i64,
        promotion: bool,
        steps: u8,
        downgrade: bool,
        suppress: bool,
    ) -> L0Policy {
        L0Policy {
            mode: L0Modes { p1, p2, p3, p4 },
            triage_budget_seconds: budget,
            allow_promotion: promotion,
            max_promotion_steps: steps,
            allow_downgrade: downgrade,
            allow_suppress: suppress,
        }
    }

    fn default_modes() -> L0Modes {
        L0Modes {
            p1: L0Mode::Parallel,
            p2: L0Mode::Gate,
            p3: L0Mode::Gate,
            p4: L0Mode::Only,
        }
    }

    /// The shipped defaults, spelled out rather than read from `defaults()`, so
    /// a test that pins behaviour is not pinned to the thing it is testing.
    fn shipped() -> L0Policy {
        L0Policy {
            mode: default_modes(),
            triage_budget_seconds: 90,
            allow_promotion: true,
            max_promotion_steps: 2,
            allow_downgrade: true,
            allow_suppress: false,
        }
    }

    /// [`shipped`] with every opt-in turned on, so a test that means to
    /// exercise a branch is not silently prevented from reaching it by a knob.
    fn everything_enabled() -> L0Policy {
        L0Policy {
            allow_suppress: true,
            ..shipped()
        }
    }

    fn verdict(action: PageAction, suggestion: Option<AlertPriority>) -> AnalysisVerdict {
        AnalysisVerdict {
            probable_cause: "fd leak introduced by querier v0.14.2".into(),
            confidence: Confidence::High,
            suspect_change: Some(SuspectChange {
                kind: ChangeKind::Deploy,
                reference: "v0.14.2".into(),
                author: Some("dana".into()),
                occurred_at: FIRED_AT - 6 * 3_600 * SECOND,
            }),
            impacted_services: vec!["production/openobserve".into()],
            evidence_links: vec![EvidenceLink {
                label: "fd ratio per pod".into(),
                url: "https://o2.example/short/x7h3k2".into(),
            }],
            page_recommendation: PageRecommendation {
                action,
                severity_suggestion: suggestion,
                reason: "predicted FD exhaustion in ~22 min".into(),
            },
            proposed_actions: vec![ProposedAction {
                title: "Restart q-4, q-6, q-7".into(),
                kind: ActionKind::Restart,
                detail: "buys time; then roll back v0.14.2".into(),
            }],
            report_ref: "inc_9/rca/1".into(),
        }
    }

    fn pending(requested_at: i64) -> AnalysisState {
        AnalysisState {
            status: AnalysisStatus::Pending,
            verdict: None,
            requested_at: Some(requested_at),
            completed_at: None,
        }
    }

    fn complete(requested_at: i64, at: i64, v: AnalysisVerdict) -> AnalysisState {
        AnalysisState {
            status: AnalysisStatus::Complete,
            verdict: Some(v),
            requested_at: Some(requested_at),
            completed_at: Some(at),
        }
    }

    fn dead(status: AnalysisStatus, requested_at: i64) -> AnalysisState {
        AnalysisState {
            status,
            verdict: None,
            requested_at: Some(requested_at),
            completed_at: None,
        }
    }

    // §4 — the policy block

    /// Every knob in §4's table, by value. The defaults are why nobody has to
    /// configure L0, so a silent edit to one changes behaviour for every team
    /// that never opened the screen.
    #[test]
    fn test_l0_defaults_match_the_published_knob_table() {
        let d = L0Policy::defaults();
        assert_eq!(d.mode.p1, L0Mode::Parallel, "P1 runs alongside the page");
        assert_eq!(d.mode.p2, L0Mode::Gate, "P2 is where the pages are");
        assert_eq!(d.mode.p3, L0Mode::Gate);
        assert_eq!(d.mode.p4, L0Mode::Only, "P4 investigates and pages nobody");
        assert_eq!(d.triage_budget_seconds, 90);
        assert!(d.allow_promotion, "the capability that pays for L0");
        assert_eq!(
            d.max_promotion_steps, 2,
            "a P4 cannot become a P1 in one hop"
        );
        assert!(d.allow_downgrade);
        assert!(
            !d.allow_suppress,
            "suppression is opt-in; one missed real page costs more trust than a quarter of noise reduction buys"
        );
        assert_eq!(d, shipped(), "the defaults are §4's table, cell for cell");
        d.validate().unwrap();
    }

    /// The invariant is not a setting. Rows arrive from replication and from
    /// hands on a database, so the read path has to refuse a held P1 too.
    #[test]
    fn test_p1_is_parallel_even_when_a_stored_policy_says_otherwise() {
        for forbidden in [L0Mode::Gate, L0Mode::Only] {
            let p = raw(
                forbidden,
                L0Mode::Gate,
                L0Mode::Gate,
                L0Mode::Only,
                90,
                true,
                2,
                true,
                false,
            );
            assert_eq!(
                p.validate(),
                Err(L0Error::P1MustBeParallel(forbidden)),
                "a policy that gates P1 must not be storable"
            );
            assert_eq!(
                p.mode_for(P1),
                L0Mode::Parallel,
                "and one that got stored anyway must still not gate P1"
            );
            assert_eq!(
                gate_plan(&p, P1, &pending(FIRED_AT), FIRED_AT),
                GatePlan::Parallel
            );
        }
        assert!(
            L0Error::P1MustBeParallel(L0Mode::Gate)
                .to_string()
                .contains("P1"),
            "the message has to name the field somebody just tried to set"
        );
    }

    /// The bound is inclusive at both ends; an off-by-one is a team that cannot
    /// save the value the UI shows them.
    #[test]
    fn test_the_triage_budget_is_bounded_at_thirty_and_six_hundred_seconds() {
        for ok in [
            MIN_TRIAGE_BUDGET_SECONDS,
            MIN_TRIAGE_BUDGET_SECONDS + 1,
            90,
            MAX_TRIAGE_BUDGET_SECONDS - 1,
            MAX_TRIAGE_BUDGET_SECONDS,
        ] {
            let mut p = shipped();
            p.triage_budget_seconds = ok;
            assert_eq!(p.validate(), Ok(()), "{ok}s is inside the bound");
        }
        for bad in [
            i64::MIN,
            -1,
            0,
            MIN_TRIAGE_BUDGET_SECONDS - 1,
            MAX_TRIAGE_BUDGET_SECONDS + 1,
            i64::MAX,
        ] {
            let mut p = shipped();
            p.triage_budget_seconds = bad;
            assert_eq!(
                p.validate(),
                Err(L0Error::BudgetOutOfRange(bad)),
                "{bad}s must be refused"
            );
        }
        let message = L0Error::BudgetOutOfRange(9_000).to_string();
        assert!(
            message.contains("30") && message.contains("600"),
            "the message has to say what the bound is: {message}"
        );
    }

    /// `only` means "nobody is ever paged at this severity", true of P4 and P5
    /// alone. A stored `only` on a paging severity would silence it
    /// permanently, so it is read as the safest thing it could have meant.
    #[test]
    fn test_only_mode_outside_p4_is_read_as_parallel() {
        let p = raw(
            L0Mode::Parallel,
            L0Mode::Only,
            L0Mode::Only,
            L0Mode::Only,
            90,
            true,
            2,
            true,
            false,
        );
        for pr in [P1, P2, P3] {
            assert_eq!(p.mode_for(pr), L0Mode::Parallel, "{pr} still has to page");
        }
        for pr in [P4, P5] {
            assert_eq!(p.mode_for(pr), L0Mode::Only);
        }
    }

    /// The mirror: a stored `gate` on P4. Reading the field puts a firing that
    /// pages nobody into a 90-second hold and inserts the trigger row §3 says a
    /// P4 never gets.
    ///
    /// It also splits implementers — deriving P4's answer from `mode_for` and
    /// from `severity_pages` both satisfy every other test, and only the second
    /// is right.
    #[test]
    fn test_p4_and_p5_are_agent_only_even_when_a_stored_policy_gates_them() {
        for forbidden in [L0Mode::Gate, L0Mode::Parallel] {
            let p = raw(
                L0Mode::Parallel,
                L0Mode::Gate,
                L0Mode::Gate,
                forbidden,
                90,
                true,
                2,
                true,
                false,
            );
            assert_eq!(
                p.validate(),
                Err(L0Error::P4MustBeAgentOnly(forbidden)),
                "a policy that gates a severity nobody is paged for must not be storable"
            );
            for pr in [P4, P5] {
                assert_eq!(
                    p.mode_for(pr),
                    L0Mode::Only,
                    "{pr} was gated by a stored value"
                );
                assert_eq!(
                    gate_plan(&p, pr, &pending(FIRED_AT), FIRED_AT),
                    GatePlan::L0Only,
                    "{pr} got a trigger row it never gets today"
                );
                assert!(
                    !gate_plan(&p, pr, &pending(FIRED_AT), FIRED_AT).inserts_a_trigger_row(),
                    "{pr}"
                );
            }
        }
        assert!(
            L0Error::P4MustBeAgentOnly(L0Mode::Gate)
                .to_string()
                .contains("P4"),
            "the message has to name the field somebody just tried to set"
        );
        // The two guards are about different severities and must not be confused for one another.
        let p1_wrong = raw(
            L0Mode::Gate,
            L0Mode::Gate,
            L0Mode::Gate,
            L0Mode::Only,
            90,
            true,
            2,
            true,
            false,
        );
        assert_eq!(
            p1_wrong.validate(),
            Err(L0Error::P1MustBeParallel(L0Mode::Gate))
        );
    }

    /// P5 is absent from the stored mode map. It pages nobody, exactly like P4,
    /// and must not fall through to some other default.
    #[test]
    fn test_p5_follows_p4_because_neither_pages_anyone() {
        let d = shipped();
        assert_eq!(d.mode_for(P5), d.mode_for(P4));
        assert_eq!(d.mode_for(P5), L0Mode::Only);
        assert!(!severity_pages(P4));
        assert!(!severity_pages(P5));
        for pr in [P1, P2, P3] {
            assert!(severity_pages(pr), "{pr} pages a human");
        }
    }

    /// The stored spelling is the `l0_json` column in §4. Renaming a key
    /// silently reverts every existing team to the defaults.
    #[test]
    fn test_the_l0_block_round_trips_through_its_stored_json() {
        let d = shipped();
        let json = serde_json::to_string(&d).unwrap();
        for key in [
            "\"P1\"",
            "\"P2\"",
            "\"P3\"",
            "\"P4\"",
            "triage_budget_seconds",
            "allow_promotion",
            "max_promotion_steps",
            "allow_downgrade",
            "allow_suppress",
        ] {
            assert!(json.contains(key), "{key} missing from {json}");
        }
        assert!(json.contains("parallel") && json.contains("gate") && json.contains("only"));
        assert!(
            !json.contains("demotion"),
            "there is no allow_demotion knob and adding one is out of scope by design: the ratchet is an invariant of the engine, not a team preference"
        );
        let back: L0Policy = serde_json::from_str(&json).unwrap();
        assert_eq!(back, d);

        // The exact document form, parsed as a team's stored row would be.
        let stored = r#"{
            "mode": { "P1": "parallel", "P2": "gate", "P3": "gate", "P4": "only" },
            "triage_budget_seconds": 90,
            "allow_promotion": true,
            "max_promotion_steps": 2,
            "allow_downgrade": true,
            "allow_suppress": false
        }"#;
        assert_eq!(serde_json::from_str::<L0Policy>(stored).unwrap(), shipped());
    }

    // §2.1a — the ratchet. The tests that must never be weakened.

    /// Every `(current, suggestion)` pair across P1–P5 at the shipped
    /// `max_promotion_steps` of 2 — §2.1a's table written out.
    #[test]
    fn test_every_severity_pair_is_a_promotion_a_clamp_or_a_discard() {
        let p = shipped();
        for current in ALL {
            assert_eq!(
                ratchet(current, None, &p),
                SeverityDecision::Unchanged { current },
                "{current} with no suggestion is untouched"
            );
            for requested in ALL {
                let got = ratchet(current, Some(requested), &p);
                let want = if !requested.is_more_urgent_than(current) {
                    // At or below: the whole class §2.1a exists to refuse.
                    SeverityDecision::Discarded { current, requested }
                } else {
                    let steps = current.to_i32() - requested.to_i32();
                    let to = if steps <= 2 {
                        requested
                    } else {
                        AlertPriority::from_i32(current.to_i32() - 2).unwrap()
                    };
                    SeverityDecision::Promoted {
                        from: current,
                        to,
                        requested,
                    }
                };
                assert_eq!(got, want, "{current} + suggestion {requested}");
            }
        }

        // Spelled out with no helper, so the test cannot be wrong the same way the code is.
        for requested in ALL {
            assert_eq!(
                ratchet(P1, Some(requested), &p),
                SeverityDecision::Discarded {
                    current: P1,
                    requested
                },
                "nothing is more urgent than P1"
            );
        }
        assert_eq!(
            ratchet(P3, Some(P2), &p),
            SeverityDecision::Promoted {
                from: P3,
                to: P2,
                requested: P2
            }
        );
        assert_eq!(
            ratchet(P5, Some(P4), &p),
            SeverityDecision::Promoted {
                from: P5,
                to: P4,
                requested: P4
            }
        );
        assert_eq!(
            ratchet(P2, Some(P5), &p),
            SeverityDecision::Discarded {
                current: P2,
                requested: P5
            }
        );
    }

    /// The invariant over every input this function has. Nothing produces a
    /// severity less urgent than the rule assigned. This enforces §2.1a against
    /// a model that can change under us, and must never be weakened.
    #[test]
    fn test_no_verdict_can_ever_lower_a_recorded_severity() {
        for current in ALL {
            for suggestion in ALL.iter().map(|p| Some(*p)).chain([None]) {
                for allow_promotion in [true, false] {
                    for steps in 0u8..=6 {
                        let p = raw(
                            L0Mode::Parallel,
                            L0Mode::Gate,
                            L0Mode::Gate,
                            L0Mode::Only,
                            90,
                            allow_promotion,
                            steps,
                            true,
                            true,
                        );
                        let decision = ratchet(current, suggestion, &p);
                        let applied = decision.applied();
                        let why = format!(
                            "{current} + {suggestion:?}, promotion={allow_promotion}, steps={steps} gave {decision:?}"
                        );
                        assert!(
                            applied == current || applied.is_more_urgent_than(current),
                            "a verdict lowered a severity: {why}"
                        );
                        // The same claim on the raw ids, the form an inverted comparison fails.
                        assert!(
                            applied.to_i32() <= current.to_i32(),
                            "applied id rose (= got quieter): {why}"
                        );
                        // A clamp landing back on the current severity is not a promotion.
                        if let SeverityDecision::Promoted {
                            from,
                            to,
                            requested,
                        } = decision
                        {
                            assert!(to.is_more_urgent_than(from), "not a promotion: {why}");
                            assert!(
                                requested.is_more_urgent_than(from),
                                "a promotion must have been asked for: {why}"
                            );
                            assert!(
                                !to.is_more_urgent_than(requested),
                                "the engine promoted further than the agent asked: {why}"
                            );
                            assert!(allow_promotion, "promoted with promotion turned off: {why}");
                        }
                        // "never lower" must not be satisfied by never moving at all.
                        if let Some(requested) = suggestion
                            && requested.is_more_urgent_than(current)
                            && allow_promotion
                            && steps >= 1
                        {
                            assert!(
                                matches!(decision, SeverityDecision::Promoted { .. }),
                                "a promotion that is allowed and in bounds was not applied: {why}"
                            );
                            assert!(
                                applied.is_more_urgent_than(current),
                                "the promotion did not move anything: {why}"
                            );
                        }
                    }
                }
            }
        }
    }

    /// `AlertPriority::to_i32()` is P1=1..P5=5, so a bare `suggestion > current`
    /// on raw ids reads P4 > P2 as a promotion and quietly demotes. Its own
    /// case, because the table above would still pass reduced to the diagonal.
    #[test]
    fn test_the_naive_integer_comparison_reads_a_demotion_as_a_promotion() {
        let p = shipped();
        assert!(
            P4.to_i32() > P2.to_i32(),
            "the trap: the quieter severity has the larger id"
        );
        assert_eq!(
            ratchet(P2, Some(P4), &p),
            SeverityDecision::Discarded {
                current: P2,
                requested: P4
            }
        );
        assert_eq!(ratchet(P2, Some(P4), &p).applied(), P2);
        assert!(ratchet(P2, Some(P4), &p).was_demotion_attempt());
        assert_eq!(
            metrics_for(
                &p,
                &complete(
                    FIRED_AT,
                    FIRED_AT + SECOND,
                    verdict(PageAction::Page, Some(P4))
                ),
                P2,
                FIRED_AT + SECOND
            )
            .iter()
            .filter(|m| **m == L0Metric::SeverityClamped)
            .count(),
            1,
            "an attempted demotion is the thing oncall_l0_severity_clamp_total counts"
        );
    }

    /// A suggestion equal to the current severity is not a promotion — the case
    /// a model produces most often, and treating it as one writes a
    /// `SeverityPromoted` event for a severity that did not change.
    #[test]
    fn test_a_suggestion_equal_to_the_current_severity_changes_nothing() {
        let p = shipped();
        for current in ALL {
            let d = ratchet(current, Some(current), &p);
            assert_eq!(
                d,
                SeverityDecision::Discarded {
                    current,
                    requested: current
                },
                "{current} suggested at {current}"
            );
            assert_eq!(d.applied(), current);
        }
    }

    /// The bound is a number, not a switch between "none" and "the default".
    /// Pinned only at 0 and 2, `let bound = if steps == 0 { 0 } else { 2 }`
    /// passes — and a team that narrowed its blast radius to one rung gets the
    /// two-rung jump it refused. Exact values at every expressible bound.
    #[test]
    fn test_the_promotion_bound_is_honoured_at_every_width() {
        // (bound, current, requested, the level that may be applied)
        let cases: &[(u8, AlertPriority, AlertPriority, AlertPriority)] = &[
            // One rung: the narrowest bound that still promotes.
            (1, P5, P4, P4),
            (1, P5, P1, P4),
            (1, P4, P1, P3),
            (1, P3, P1, P2),
            (1, P3, P2, P2),
            (1, P2, P1, P1),
            // Two rungs — the shipped default, restated here beside its neighbours.
            (2, P5, P1, P3),
            (2, P4, P1, P2),
            (2, P3, P1, P1),
            // Three, and wider than the scale: the request is granted in full.
            (3, P5, P1, P2),
            (3, P4, P1, P1),
            (4, P5, P1, P1),
            (5, P5, P1, P1),
            (255, P5, P1, P1),
        ];
        for (steps, current, requested, want) in cases.iter().copied() {
            let p = raw(
                L0Mode::Parallel,
                L0Mode::Gate,
                L0Mode::Gate,
                L0Mode::Only,
                90,
                true,
                steps,
                true,
                false,
            );
            assert_eq!(
                ratchet(current, Some(requested), &p),
                SeverityDecision::Promoted {
                    from: current,
                    to: want,
                    requested
                },
                "bound {steps}: {current} asked to become {requested}"
            );
            // A clamp is not a demotion attempt, and this counter is supposed to read ~0.
            assert!(
                !ratchet(current, Some(requested), &p).was_demotion_attempt(),
                "bound {steps}: {current} → {requested} was counted as a demotion"
            );
        }
        // The bound never invents a promotion that was not asked for.
        for steps in 1u8..=5 {
            let p = raw(
                L0Mode::Parallel,
                L0Mode::Gate,
                L0Mode::Gate,
                L0Mode::Only,
                90,
                true,
                steps,
                true,
                false,
            );
            assert_eq!(
                ratchet(P3, Some(P4), &p),
                SeverityDecision::Discarded {
                    current: P3,
                    requested: P4
                },
                "bound {steps} turned a demotion into something else"
            );
        }
        // Widening the bound must move the answer, or the bound is really a constant.
        let one = raw(
            L0Mode::Parallel,
            L0Mode::Gate,
            L0Mode::Gate,
            L0Mode::Only,
            90,
            true,
            1,
            true,
            false,
        );
        let three = raw(
            L0Mode::Parallel,
            L0Mode::Gate,
            L0Mode::Gate,
            L0Mode::Only,
            90,
            true,
            3,
            true,
            false,
        );
        assert_ne!(
            ratchet(P4, Some(P1), &one).applied(),
            ratchet(P4, Some(P1), &three).applied()
        );
    }

    /// A bound of zero can only mean "no promotions". Otherwise the clamp lands
    /// on the current severity and reports a promotion to itself.
    #[test]
    fn test_a_clamp_that_lands_on_the_current_severity_is_not_a_promotion() {
        let p = raw(
            L0Mode::Parallel,
            L0Mode::Gate,
            L0Mode::Gate,
            L0Mode::Only,
            90,
            true,
            0,
            true,
            false,
        );
        assert_eq!(
            ratchet(P3, Some(P1), &p),
            SeverityDecision::Refused {
                current: P3,
                requested: P1
            }
        );
        assert_eq!(ratchet(P3, Some(P1), &p).applied(), P3);
    }

    /// With promotion off the recommendation is still recorded and rendered:
    /// the team asked not to be re-paged, not to be kept in the dark.
    #[test]
    fn test_promotion_is_refused_but_still_recorded_when_the_team_turned_it_off() {
        let p = raw(
            L0Mode::Parallel,
            L0Mode::Gate,
            L0Mode::Gate,
            L0Mode::Only,
            90,
            false,
            2,
            true,
            false,
        );
        let d = ratchet(P3, Some(P2), &p);
        assert_eq!(
            d,
            SeverityDecision::Refused {
                current: P3,
                requested: P2
            }
        );
        assert_eq!(d.applied(), P3, "the firing proceeds at its own severity");
        assert!(
            !d.was_demotion_attempt(),
            "a refusal is a policy choice, not a prompt regression"
        );
        // The ratchet is not a team preference: the promotion knob cannot excuse a demotion.
        assert_eq!(
            ratchet(P2, Some(P3), &p),
            SeverityDecision::Discarded {
                current: P2,
                requested: P3
            }
        );

        // §6: the responder whose team turned promotion off is the one who can act on it.
        let v = verdict(PageAction::Page, Some(P2));
        let rendered =
            verdict_lines(&complete(FIRED_AT, FIRED_AT + 4 * SECOND, v.clone()), &d).join("\n");
        assert!(
            rendered.contains("P2"),
            "the severity the agent asked for is on the page: {rendered}"
        );
        assert!(
            rendered.contains(&v.page_recommendation.reason),
            "and so is why it asked: {rendered}"
        );
    }

    // §1, §3 — the gate

    /// §1's table is the single source of truth for L0 timing: P1 parallel,
    /// P2 and P3 gated, P4 (and P5) agent-only with no trigger row at all.
    #[test]
    fn test_the_gate_follows_the_published_severity_table() {
        let p = shipped();
        let deadline = FIRED_AT + 90 * SECOND;
        let expected = [
            (P1, GatePlan::Parallel),
            (P2, GatePlan::Gate { fire_at: deadline }),
            (P3, GatePlan::Gate { fire_at: deadline }),
            (P4, GatePlan::L0Only),
            (P5, GatePlan::L0Only),
        ];
        for (priority, want) in expected {
            assert_eq!(
                gate_plan(&p, priority, &pending(FIRED_AT), FIRED_AT),
                want,
                "{priority} does not follow §1's table"
            );
        }
        assert!(GatePlan::Parallel.inserts_a_trigger_row());
        assert!(GatePlan::Gate { fire_at: deadline }.inserts_a_trigger_row());
        assert!(
            !GatePlan::L0Only.inserts_a_trigger_row(),
            "P4 never inserted a trigger row today and still does not"
        );
    }

    /// A team may trade the suppression branch for zero added latency at P2 or
    /// P3. It may not do the reverse at P1.
    #[test]
    fn test_a_team_may_turn_the_gate_off_at_p2_and_p3() {
        let p = raw(
            L0Mode::Parallel,
            L0Mode::Parallel,
            L0Mode::Parallel,
            L0Mode::Only,
            90,
            true,
            2,
            true,
            true,
        );
        p.validate().unwrap();
        for pr in [P2, P3] {
            assert_eq!(
                gate_plan(&p, pr, &pending(FIRED_AT), FIRED_AT),
                GatePlan::Parallel
            );
        }
    }

    /// §6, first row. Paging never waits for a dead agent: the gate is bypassed
    /// entirely and the row goes in in a NOTIFYING posture.
    #[test]
    fn test_a_dead_or_skipped_agent_bypasses_the_gate_entirely() {
        let p = shipped();
        for status in [AnalysisStatus::Skipped, AnalysisStatus::Failed] {
            for pr in [P1, P2, P3] {
                assert_eq!(
                    gate_plan(&p, pr, &dead(status, FIRED_AT), FIRED_AT),
                    GatePlan::Parallel,
                    "{pr} with analysis {status:?} must not be held"
                );
            }
            for pr in [P4, P5] {
                assert_eq!(
                    gate_plan(&p, pr, &dead(status, FIRED_AT), FIRED_AT),
                    GatePlan::L0Only
                );
            }
        }
    }

    /// The knob has to reach the thing that pages people. Every other gate test
    /// runs at the default 90 s, so an implementation that reads
    /// `triage_budget_seconds` raw and skips the clamp survives them.
    ///
    /// A row carrying `i64::MAX` — from replication, a migration or a hand-edit
    /// — produces a `fire_at` past any clock the process will see, so the TRIAGE
    /// row never fires: nobody is paged and nothing logs an error.
    #[test]
    fn test_the_configured_triage_budget_is_the_one_that_gates() {
        // (stored seconds, the hold it must actually produce)
        let cases = [
            (
                MIN_TRIAGE_BUDGET_SECONDS,
                MIN_TRIAGE_BUDGET_SECONDS * SECOND,
            ),
            (45, 45 * SECOND),
            (90, 90 * SECOND),
            (300, 300 * SECOND),
            (
                MAX_TRIAGE_BUDGET_SECONDS,
                MAX_TRIAGE_BUDGET_SECONDS * SECOND,
            ),
            // Out of bounds: clamped on the paging path, not merely on the getter.
            (0, MIN_TRIAGE_BUDGET_SECONDS * SECOND),
            (-1, MIN_TRIAGE_BUDGET_SECONDS * SECOND),
            (i64::MIN, MIN_TRIAGE_BUDGET_SECONDS * SECOND),
            (100_000, MAX_TRIAGE_BUDGET_SECONDS * SECOND),
            (i64::MAX, MAX_TRIAGE_BUDGET_SECONDS * SECOND),
        ];
        for (stored, hold) in cases {
            let p = raw(
                L0Mode::Parallel,
                L0Mode::Gate,
                L0Mode::Gate,
                L0Mode::Only,
                stored,
                true,
                2,
                true,
                false,
            );
            let deadline = FIRED_AT + hold;
            for pr in [P2, P3] {
                assert_eq!(
                    gate_plan(&p, pr, &pending(FIRED_AT), FIRED_AT),
                    GatePlan::Gate { fire_at: deadline },
                    "{pr}: a stored budget of {stored}s must hold for {hold}us"
                );
                assert_eq!(
                    apply_verdict(&p, &pending(FIRED_AT), pr, deadline - 1),
                    VerdictOutcome::Hold { until: deadline },
                    "{pr}: {stored}s — still holding one microsecond short"
                );
                assert_eq!(
                    apply_verdict(&p, &pending(FIRED_AT), pr, deadline),
                    VerdictOutcome::FailOpen { severity: pr },
                    "{pr}: {stored}s — the hold is over at its instant"
                );
                // Unclamped, the multiplication overflows past any instant a clock reaches.
                assert!(
                    deadline > FIRED_AT
                        && deadline - FIRED_AT <= MAX_TRIAGE_BUDGET_SECONDS * SECOND,
                    "{pr}: a stored {stored}s produced a hold of {}us",
                    deadline - FIRED_AT
                );
            }
            // The budget is a ceiling on every team's hold, not its length.
            let early = FIRED_AT + hold / 2;
            assert_eq!(
                apply_verdict(
                    &p,
                    &complete(FIRED_AT, early, verdict(PageAction::Page, None)),
                    P2,
                    early
                ),
                VerdictOutcome::Page {
                    severity: P2,
                    promoted_from: None,
                    quieter_channels: false
                },
                "{stored}s: a verdict inside the hold did not end it"
            );
        }

        // Two teams, two budgets, same firing instant: a hardcoded 90 makes these equal.
        let short = raw(
            L0Mode::Parallel,
            L0Mode::Gate,
            L0Mode::Gate,
            L0Mode::Only,
            30,
            true,
            2,
            true,
            false,
        );
        let long = raw(
            L0Mode::Parallel,
            L0Mode::Gate,
            L0Mode::Gate,
            L0Mode::Only,
            600,
            true,
            2,
            true,
            false,
        );
        assert_ne!(
            gate_plan(&short, P2, &pending(FIRED_AT), FIRED_AT),
            gate_plan(&long, P2, &pending(FIRED_AT), FIRED_AT),
            "two teams with different budgets got the same deadline"
        );
    }

    /// §6: a node dying mid-TRIAGE resumes from the persisted deadline.
    /// Recomputed from the wall clock, every crash extends the hold — and a
    /// flapping node extends it forever.
    #[test]
    fn test_the_hold_deadline_is_anchored_on_the_request_not_on_the_wall_clock() {
        let p = shipped();
        let state = pending(FIRED_AT);
        let deadline = FIRED_AT + 90 * SECOND;
        // The same row, recomputed at four different instants after a re-queue.
        for later in [
            FIRED_AT,
            FIRED_AT + SECOND,
            FIRED_AT + 60 * SECOND,
            FIRED_AT + 3_600 * SECOND,
        ] {
            assert_eq!(
                gate_plan(&p, P2, &state, later),
                GatePlan::Gate { fire_at: deadline },
                "a re-queue at {later} moved the deadline"
            );
        }
        // A firing whose analysis has not been requested yet has nothing else to anchor on.
        let unrequested = AnalysisState {
            status: AnalysisStatus::Pending,
            verdict: None,
            requested_at: None,
            completed_at: None,
        };
        assert_eq!(
            gate_plan(&p, P2, &unrequested, FIRED_AT),
            GatePlan::Gate { fire_at: deadline }
        );
    }

    // §1 — timing. The invariant that "is not a setting".

    /// §7: a P4 or P5 records its verdict, ends `triaged`, and never inserts a
    /// trigger row — for every action, including `Page`. The agent cannot page a
    /// P4 by asking; it can only stop the firing being a P4.
    #[test]
    fn test_p4_and_p5_record_a_verdict_and_page_nobody() {
        for allow_suppress in [true, false] {
            let p = raw(
                L0Mode::Parallel,
                L0Mode::Gate,
                L0Mode::Gate,
                L0Mode::Only,
                90,
                true,
                2,
                true,
                allow_suppress,
            );
            for pr in [P4, P5] {
                for action in PageAction::ALL {
                    let v = verdict(action, None);
                    let at = FIRED_AT + 4 * SECOND;
                    assert_eq!(
                        gate_plan(&p, pr, &complete(FIRED_AT, at, v.clone()), FIRED_AT),
                        GatePlan::L0Only,
                        "{pr}/{action} must insert no trigger row"
                    );
                    let outcome = apply_verdict(&p, &complete(FIRED_AT, at, v.clone()), pr, at);
                    assert!(!outcome.pages_anyone(), "{pr}/{action} gave {outcome:?}");
                    assert_eq!(
                        outcome,
                        VerdictOutcome::FollowUp { severity: pr },
                        "{pr}/{action}: the verdict is recorded, and that is all"
                    );
                }
            }
        }
    }

    /// §10.4's argument: the rule "a P4 does not page" is not overridden, the
    /// firing stops being a P4. "P4 → P1 is clamped to P2" only means anything
    /// if a promoted P4 can then page.
    #[test]
    fn test_a_promoted_p4_pages_because_it_is_no_longer_a_p4() {
        let p = shipped();
        let at = FIRED_AT + 4 * SECOND;
        let v = verdict(PageAction::Page, Some(P2));
        assert_eq!(
            apply_verdict(&p, &complete(FIRED_AT, at, v), P4, at),
            VerdictOutcome::Page {
                severity: P2,
                promoted_from: Some(P4),
                quieter_channels: false
            }
        );
        // Promoted only as far as another severity that pages nobody: still nobody is paged.
        let to_p5 = verdict(PageAction::Page, Some(P5));
        assert_eq!(
            apply_verdict(&p, &complete(FIRED_AT, at, to_p5), P5, at),
            VerdictOutcome::FollowUp { severity: P5 },
            "P5 suggested at P5 is not a promotion and pages nobody"
        );
    }

    // §3, §4 — the verdict matrix

    /// §9's mode × action × opt-in matrix at a gated severity. The defaults are
    /// the interesting row: `allow_suppress` is false, so a Suppress verdict
    /// from a team that has not opted in still pages.
    #[test]
    fn test_the_verdict_matrix_over_action_and_opt_in() {
        let at = FIRED_AT + 4 * SECOND;
        // (allow_downgrade, allow_suppress, action, expected outcome at P3)
        let cases: [(bool, bool, PageAction, VerdictOutcome); 8] = [
            (
                true,
                false,
                PageAction::Page,
                VerdictOutcome::Page {
                    severity: P3,
                    promoted_from: None,
                    quieter_channels: false,
                },
            ),
            (
                true,
                true,
                PageAction::Page,
                VerdictOutcome::Page {
                    severity: P3,
                    promoted_from: None,
                    quieter_channels: false,
                },
            ),
            (
                true,
                false,
                PageAction::Downgrade,
                VerdictOutcome::Page {
                    severity: P3,
                    promoted_from: None,
                    quieter_channels: true,
                },
            ),
            (
                false,
                false,
                PageAction::Downgrade,
                VerdictOutcome::Page {
                    severity: P3,
                    promoted_from: None,
                    quieter_channels: false,
                },
            ),
            (true, true, PageAction::Suppress, VerdictOutcome::Suppress),
            (
                true,
                false,
                PageAction::Suppress,
                VerdictOutcome::Page {
                    severity: P3,
                    promoted_from: None,
                    quieter_channels: false,
                },
            ),
            (false, true, PageAction::Suppress, VerdictOutcome::Suppress),
            (
                false,
                false,
                PageAction::Suppress,
                VerdictOutcome::Page {
                    severity: P3,
                    promoted_from: None,
                    quieter_channels: false,
                },
            ),
        ];
        for (downgrade, suppress, action, want) in cases {
            let p = raw(
                L0Mode::Parallel,
                L0Mode::Gate,
                L0Mode::Gate,
                L0Mode::Only,
                90,
                true,
                2,
                downgrade,
                suppress,
            );
            let state = complete(FIRED_AT, at, verdict(action, None));
            assert_eq!(
                apply_verdict(&p, &state, P3, at),
                want,
                "downgrade={downgrade} suppress={suppress} action={action}"
            );
        }
    }

    /// The mode axis §9's table holds fixed at `gate`. A team on `parallel`
    /// buys zero added latency at the cost of the suppression branch.
    ///
    /// The bug this catches decides on `action == Suppress && allow_suppress`
    /// without consulting `mode_for(severity)`: it passes the gated table
    /// completely and silences a P2 for a team that turned the gate off.
    #[test]
    fn test_a_parallel_severity_loses_the_suppression_and_downgrade_branches() {
        let at = FIRED_AT + 4 * SECOND;
        // Everything the team could possibly have opted into.
        let p = raw(
            L0Mode::Parallel,
            L0Mode::Parallel,
            L0Mode::Parallel,
            L0Mode::Only,
            90,
            true,
            2,
            true,
            true,
        );
        for pr in [P1, P2, P3] {
            for action in PageAction::ALL {
                let state = complete(FIRED_AT, at, verdict(action, None));
                let outcome = apply_verdict(&p, &state, pr, at);
                assert_eq!(
                    outcome,
                    VerdictOutcome::FollowUp { severity: pr },
                    "{pr} in parallel mode with a {action} verdict"
                );
                assert!(
                    !outcome.pages_anyone(),
                    "{pr}/{action}: the page already went at t=0; this is news, not a second page"
                );
                assert_ne!(
                    outcome,
                    VerdictOutcome::Suppress,
                    "{pr}/{action}: a parallel severity cannot be suppressed — nothing to suppress"
                );
            }
            // And the one thing a parallel severity CAN still do: promote.
            let promoting = complete(FIRED_AT, at, verdict(PageAction::Page, Some(P1)));
            if pr != P1 {
                assert_eq!(
                    apply_verdict(&p, &promoting, pr, at),
                    VerdictOutcome::Page {
                        severity: P1,
                        promoted_from: Some(pr),
                        quieter_channels: false
                    },
                    "{pr}: a promotion re-enters the ladder even in parallel mode"
                );
            }
        }
        // The counters agree: nothing was suppressed or downgraded.
        for action in [PageAction::Suppress, PageAction::Downgrade] {
            let state = complete(FIRED_AT, at, verdict(action, None));
            let moved = metrics_for(&p, &state, P2, at);
            assert!(!moved.contains(&L0Metric::Suppressed), "{action}");
            assert!(!moved.contains(&L0Metric::Downgraded), "{action}");
        }
    }

    /// Suppression, when it is enabled, is silent but audited — and it is a
    /// verdict about *this* firing. Nothing here is a standing mute.
    #[test]
    fn test_suppression_only_applies_to_a_gated_firing_for_an_opted_in_team() {
        let p = everything_enabled();
        let at = FIRED_AT + 4 * SECOND;
        let v = verdict(PageAction::Suppress, None);
        for pr in [P2, P3] {
            assert_eq!(
                apply_verdict(&p, &complete(FIRED_AT, at, v.clone()), pr, at),
                VerdictOutcome::Suppress
            );
        }
        // Not at P1, which is never gated by invariant.
        assert!(
            apply_verdict(&p, &complete(FIRED_AT, at, v.clone()), P1, at)
                != VerdictOutcome::Suppress
        );
        // Gated by MODE, which is the case a check on `allow_suppress` alone gets wrong.
        let parallel = raw(
            L0Mode::Parallel,
            L0Mode::Parallel,
            L0Mode::Gate,
            L0Mode::Only,
            90,
            true,
            2,
            true,
            true,
        );
        assert_eq!(
            apply_verdict(&parallel, &complete(FIRED_AT, at, v.clone()), P2, at),
            VerdictOutcome::FollowUp { severity: P2 },
            "a team that turned the gate off at P2 gave up the suppression branch"
        );
        assert_eq!(
            apply_verdict(&parallel, &complete(FIRED_AT, at, v.clone()), P3, at),
            VerdictOutcome::Suppress,
            "and still has it at P3, which it left gated"
        );
        // And not after the hold has expired: the page has already gone.
        let late = FIRED_AT + 200 * SECOND;
        assert_eq!(
            apply_verdict(&p, &complete(FIRED_AT, late, v.clone()), P3, late),
            VerdictOutcome::FollowUp { severity: P3 },
            "a Suppress that arrives after the page cannot un-send it"
        );

        // §4: suppression is a verdict about THIS firing, which per-firing keying enforces.
        use super::super::subject::{SubjectRef, SubjectType};
        let firing = SubjectRef::new(SubjectType::Alert, "al_fds", 1);
        assert_ne!(
            firing.storage_key(),
            firing.next_firing().storage_key(),
            "the next firing is a different record, so it is a different decision"
        );
    }

    /// §2.1a's other half: `Downgrade` asks for quieter channels and never
    /// touches the recorded severity. Conflating the two is how "the agent can
    /// never demote" becomes false by a side door.
    #[test]
    fn test_a_downgrade_never_changes_the_recorded_severity() {
        let p = shipped();
        let at = FIRED_AT + 4 * SECOND;
        for pr in [P2, P3] {
            for suggestion in [None, Some(P4), Some(P5), Some(pr)] {
                let state = complete(FIRED_AT, at, verdict(PageAction::Downgrade, suggestion));
                match apply_verdict(&p, &state, pr, at) {
                    VerdictOutcome::Page {
                        severity,
                        promoted_from,
                        quieter_channels,
                    } => {
                        assert_eq!(
                            severity, pr,
                            "{pr}: a downgrade moved the recorded severity"
                        );
                        assert_eq!(promoted_from, None);
                        assert!(quieter_channels, "{pr}: the downgrade was not applied");
                    }
                    other => panic!("{pr}: a downgrade must still page, got {other:?}"),
                }
            }
        }
    }

    /// A verdict that both promotes and asks for quiet is contradictory, and the
    /// safe reading is the loud one: §5.3 says a promoted page fires the higher
    /// severity's own channel set.
    #[test]
    fn test_a_promotion_outranks_a_suppress_or_downgrade_in_the_same_verdict() {
        let p = everything_enabled();
        let at = FIRED_AT + 4 * SECOND;
        for action in [PageAction::Suppress, PageAction::Downgrade] {
            let state = complete(FIRED_AT, at, verdict(action, Some(P2)));
            assert_eq!(
                apply_verdict(&p, &state, P3, at),
                VerdictOutcome::Page {
                    severity: P2,
                    promoted_from: Some(P3),
                    quieter_channels: false
                },
                "{action} with a promotion must still page loudly at the promoted severity"
            );
        }
    }

    /// §3, the WAITING side. A verdict arriving after the page rides as one
    /// follow-up — except a promotion, which re-enters the ladder.
    #[test]
    fn test_a_verdict_that_lands_after_the_page_is_an_update_not_a_second_page() {
        let p = shipped();
        let late = FIRED_AT + 200 * SECOND;
        for pr in [P2, P3] {
            assert_eq!(
                apply_verdict(
                    &p,
                    &complete(FIRED_AT, late, verdict(PageAction::Page, None)),
                    pr,
                    late
                ),
                VerdictOutcome::FollowUp { severity: pr },
                "{pr}: news arriving is not a reason to page again"
            );
            assert_eq!(
                apply_verdict(
                    &p,
                    &complete(FIRED_AT, late, verdict(PageAction::Page, Some(P1))),
                    pr,
                    late
                ),
                VerdictOutcome::Page {
                    severity: P1,
                    promoted_from: Some(pr),
                    quieter_channels: false
                },
                "{pr}: a promotion is the one verdict that IS a page"
            );
        }
        // Same on the P1/parallel side, where the page went out at t=0.
        assert_eq!(
            apply_verdict(
                &p,
                &complete(FIRED_AT, FIRED_AT + SECOND, verdict(PageAction::Page, None)),
                P1,
                FIRED_AT + SECOND
            ),
            VerdictOutcome::FollowUp { severity: P1 }
        );
    }

    /// The hold waits until the deadline, not until some interval a tick
    /// happened to pick.
    #[test]
    fn test_a_gated_firing_holds_until_its_deadline_and_no_longer() {
        let p = shipped();
        let deadline = FIRED_AT + 90 * SECOND;
        for pr in [P2, P3] {
            for now in [FIRED_AT, FIRED_AT + SECOND, deadline - 1] {
                assert_eq!(
                    apply_verdict(&p, &pending(FIRED_AT), pr, now),
                    VerdictOutcome::Hold { until: deadline },
                    "{pr} at {now}"
                );
            }
            assert_eq!(
                apply_verdict(&p, &pending(FIRED_AT), pr, deadline),
                VerdictOutcome::FailOpen { severity: pr },
                "{pr}: the budget is over at its instant, not after it"
            );
        }
        // "Not Hold" is too weak: `Page` and `FailOpen` satisfy it while re-paging at t=0.
        for now in [FIRED_AT, deadline - 1, deadline, deadline + 600 * SECOND] {
            assert_eq!(
                apply_verdict(&p, &pending(FIRED_AT), P1, now),
                VerdictOutcome::FollowUp { severity: P1 },
                "P1 with a live investigation at {now}"
            );
        }
    }

    /// §6, three rows at once: budget expiry, a malformed verdict block, and a
    /// dead agent all reach the page the pre-L0 system would have sent.
    #[test]
    fn test_a_missing_or_malformed_verdict_fails_open_at_the_deadline() {
        let p = shipped();
        let deadline = FIRED_AT + 90 * SECOND;
        for pr in [P2, P3] {
            for state in [
                pending(FIRED_AT),
                // A malformed verdict block is no verdict, so the run ends Failed.
                dead(AnalysisStatus::Failed, FIRED_AT),
                dead(AnalysisStatus::Skipped, FIRED_AT),
            ] {
                let outcome = apply_verdict(&p, &state, pr, deadline);
                assert_eq!(
                    outcome,
                    VerdictOutcome::FailOpen { severity: pr },
                    "{pr} with {:?} did not fail open",
                    state.status
                );
                assert!(outcome.pages_anyone());
            }
        }
        // No verdict is coming for Failed or Skipped, so holding is 90 seconds of nothing.
        for status in [AnalysisStatus::Failed, AnalysisStatus::Skipped] {
            assert_eq!(
                apply_verdict(&p, &dead(status, FIRED_AT), P2, FIRED_AT),
                VerdictOutcome::FailOpen { severity: P2 },
                "{status:?} must not hold a page for an answer that is not coming"
            );
        }
        // Nothing usable reads as a failure, not as "complete, so stop waiting and never page".
        for pr in [P2, P3] {
            assert_eq!(
                apply_verdict(
                    &p,
                    &AnalysisState {
                        status: AnalysisStatus::Complete,
                        verdict: None,
                        requested_at: Some(FIRED_AT),
                        completed_at: Some(FIRED_AT + 4 * SECOND),
                    },
                    pr,
                    FIRED_AT + 4 * SECOND
                ),
                VerdictOutcome::FailOpen { severity: pr },
                "{pr}: a complete run with no usable verdict is a failed one"
            );
        }
        assert!(!AnalysisStatus::Failed.may_still_answer());
        assert!(!AnalysisStatus::Skipped.may_still_answer());
        assert!(!AnalysisStatus::Complete.may_still_answer());
        assert!(AnalysisStatus::Pending.may_still_answer());
    }

    /// §3 as an equality rather than two lists that happen to agree. `Skipped`
    /// and `Failed` arrive from different places — a disabled agent versus one
    /// that answered with rubbish — and the moment they diverge, one stops being
    /// covered by the fail-open argument.
    #[test]
    fn test_a_failed_analysis_and_a_skipped_one_are_treated_identically() {
        let p = shipped();
        for pr in ALL {
            for now in [
                FIRED_AT,
                FIRED_AT + 45 * SECOND,
                FIRED_AT + 90 * SECOND,
                FIRED_AT + 600 * SECOND,
            ] {
                assert_eq!(
                    apply_verdict(&p, &dead(AnalysisStatus::Failed, FIRED_AT), pr, now),
                    apply_verdict(&p, &dead(AnalysisStatus::Skipped, FIRED_AT), pr, now),
                    "{pr} at {now}: failed and skipped diverged"
                );
                assert_eq!(
                    metrics_for(&p, &dead(AnalysisStatus::Failed, FIRED_AT), pr, now),
                    metrics_for(&p, &dead(AnalysisStatus::Skipped, FIRED_AT), pr, now),
                    "{pr} at {now}: failed and skipped counted differently"
                );
            }
            assert_eq!(
                gate_plan(&p, pr, &dead(AnalysisStatus::Failed, FIRED_AT), FIRED_AT),
                gate_plan(&p, pr, &dead(AnalysisStatus::Skipped, FIRED_AT), FIRED_AT),
                "{pr}: failed and skipped entered the ladder differently"
            );
        }
    }

    /// §1: the hold is shorter than the rung it sits inside. The budget and the
    /// ladder are edited in different files, and the day the budget grows past
    /// the rung, the gate becomes a missed escalation.
    #[test]
    fn test_the_triage_budget_stays_well_inside_the_rung_it_sits_in() {
        use super::super::policy::EscalationPolicy;
        let budget = shipped().triage_budget_micros();
        let policy = EscalationPolicy::default_for_team(
            "p",
            "default",
            "t",
            "rot_primary",
            Some("rot_secondary".into()),
        );
        for (priority, factor) in [(P2, 3), (P3, 10)] {
            let first_escalation = policy
                .rung(priority)
                .unwrap()
                .steps
                .iter()
                .map(|s| s.after_micros)
                .filter(|d| *d > 0)
                .min()
                .expect("a paging severity escalates");
            assert!(
                budget * factor <= first_escalation,
                "{priority}: a {budget}us hold is not under a 1/{factor} of its {first_escalation}us first escalation interval"
            );
        }
        // The ceiling is deliberately not bounded by the rung; the shipped default must not drift.
        const {
            assert!(
                MAX_TRIAGE_BUDGET_SECONDS * SECOND > 5 * 60 * SECOND,
                "if this ever becomes false the comment above is stale, not the code"
            );
        };
    }

    /// §6's compound invariant: removing the agent reproduces today's behaviour
    /// exactly. With the analysis `Skipped`, P1–P3 page at t=0, P4 and P5 page
    /// nobody, nothing is held, and no verdict changes any of it.
    #[test]
    fn test_removing_the_agent_reproduces_todays_behaviour_exactly() {
        for allow_suppress in [true, false] {
            for allow_promotion in [true, false] {
                let p = raw(
                    L0Mode::Parallel,
                    L0Mode::Gate,
                    L0Mode::Gate,
                    L0Mode::Only,
                    90,
                    allow_promotion,
                    2,
                    true,
                    allow_suppress,
                );
                let skipped = dead(AnalysisStatus::Skipped, FIRED_AT);
                for pr in ALL {
                    assert_ne!(
                        gate_plan(&p, pr, &skipped, FIRED_AT),
                        GatePlan::Gate {
                            fire_at: FIRED_AT + 90 * SECOND
                        },
                        "{pr} must not be held when no agent will ever answer"
                    );
                    assert_eq!(
                        gate_plan(&p, pr, &skipped, FIRED_AT).inserts_a_trigger_row(),
                        severity_pages(pr),
                        "{pr}: the rows inserted without an agent are the rows inserted today"
                    );
                    assert!(
                        metrics_for(&p, &skipped, pr, FIRED_AT).is_empty(),
                        "{pr}: an agent that never ran has nothing to count"
                    );
                }
            }
        }
    }

    /// §6's guard rows. Every reason the RCA trigger declines to run is one
    /// state, `Skipped`. Table-driven over the guard space, so a new guard that
    /// forgets to map to `Skipped` fails here.
    #[test]
    fn test_analysis_is_skipped_whenever_a_guard_blocks_the_run() {
        for rca_enabled in [true, false] {
            for url_set in [true, false] {
                for healthy in [true, false] {
                    for in_flight in [true, false] {
                        for cooldown_elapsed in [true, false] {
                            let got = analysis_status_for_start(
                                rca_enabled,
                                url_set,
                                healthy,
                                in_flight,
                                cooldown_elapsed,
                            );
                            let clear =
                                rca_enabled && url_set && healthy && !in_flight && cooldown_elapsed;
                            let want = if clear {
                                AnalysisStatus::Pending
                            } else {
                                AnalysisStatus::Skipped
                            };
                            assert_eq!(
                                got, want,
                                "rca={rca_enabled} url={url_set} healthy={healthy} in_flight={in_flight} cooled={cooldown_elapsed}"
                            );
                        }
                    }
                }
            }
        }
    }

    /// §10.3's trace: the causal signal fires at the lowest severity and the
    /// symptom at the highest. A P3 fires at 02:14:00 and nobody is paged; the
    /// verdict lands four seconds later promoting it, and what pages is a P2.
    #[test]
    fn test_the_worked_example_pages_a_p2_four_seconds_after_a_p3_that_woke_nobody() {
        let p = shipped();
        let fired = FIRED_AT; // 02:14:00
        let verdict_at = fired + 4 * SECOND; // 02:14:04
        let v = verdict(PageAction::Page, Some(P2));

        // The hold, and the fact that it woke nobody while it lasted.
        assert_eq!(
            gate_plan(&p, P3, &pending(fired), fired),
            GatePlan::Gate {
                fire_at: fired + 90 * SECOND
            }
        );
        assert_eq!(
            apply_verdict(&p, &pending(fired), P3, fired + SECOND),
            VerdictOutcome::Hold {
                until: fired + 90 * SECOND
            },
            "the P3 is held, not paged"
        );

        // The verdict, and the one decision in the whole design.
        assert_eq!(
            ratchet(P3, Some(P2), &p),
            SeverityDecision::Promoted {
                from: P3,
                to: P2,
                requested: P2
            },
            "P2 is more urgent than P3 and within max_promotion_steps"
        );
        assert_eq!(
            apply_verdict(&p, &complete(fired, verdict_at, v.clone()), P3, verdict_at),
            VerdictOutcome::Page {
                severity: P2,
                promoted_from: Some(P3),
                quieter_channels: false
            }
        );
        assert!(
            metrics_for(&p, &complete(fired, verdict_at, v), P3, verdict_at)
                .contains(&L0Metric::Promoted { from: P3, to: P2 })
        );

        // The 90-second hold cost nothing: the verdict landed in four seconds and ended it.
        assert!(verdict_at - fired < p.triage_budget_micros());
    }

    /// §6's `Pending → Failed` transition, which nothing else models. Leaving an
    /// unusable run `Pending` makes every malformed report cost the full triage
    /// budget in latency.
    #[test]
    fn test_a_run_that_produced_no_usable_verdict_ends_failed_not_pending() {
        assert_eq!(analysis_status_after_run(true), AnalysisStatus::Complete);
        assert_eq!(
            analysis_status_after_run(false),
            AnalysisStatus::Failed,
            "a report with no usable verdict block is a failed run, not one still thinking"
        );
        assert!(!analysis_status_after_run(false).may_still_answer());
        // And that status is the one that stops the hold immediately.
        let p = shipped();
        assert_eq!(
            apply_verdict(
                &p,
                &dead(analysis_status_after_run(false), FIRED_AT),
                P2,
                FIRED_AT + SECOND
            ),
            VerdictOutcome::FailOpen { severity: P2 }
        );
    }

    /// A P4 has no hold to be in, so one whose investigation is still running
    /// is not `Hold` — it is a firing nobody will be paged for either way.
    #[test]
    fn test_a_p4_with_a_live_investigation_is_not_holding_anything() {
        let p = shipped();
        for pr in [P4, P5] {
            for now in [FIRED_AT, FIRED_AT + 90 * SECOND, FIRED_AT + 600 * SECOND] {
                let outcome = apply_verdict(&p, &pending(FIRED_AT), pr, now);
                assert_eq!(
                    outcome,
                    VerdictOutcome::FollowUp { severity: pr },
                    "{pr} at {now} held a page that was never going to happen"
                );
                assert!(!outcome.pages_anyone(), "{pr} at {now}: {outcome:?}");
            }
            assert!(
                metrics_for(&p, &pending(FIRED_AT), pr, FIRED_AT + 90 * SECOND)
                    .iter()
                    .all(|m| *m != L0Metric::BudgetExpired),
                "{pr} has no budget to expire"
            );
        }
    }

    // §8 — observability

    /// `oncall_l0_severity_clamp_total` is the prompt-regression alarm and is
    /// expected to be ~0. A step-clamped promotion is routine and must not
    /// appear on it, or the alarm reads as noise.
    #[test]
    fn test_the_clamp_counter_moves_only_on_an_attempted_demotion() {
        let p = shipped();
        let at = FIRED_AT + 4 * SECOND;
        let count = |current: AlertPriority, suggestion: Option<AlertPriority>| {
            metrics_for(
                &p,
                &complete(FIRED_AT, at, verdict(PageAction::Page, suggestion)),
                current,
                at,
            )
        };

        assert!(count(P2, Some(P3)).contains(&L0Metric::SeverityClamped));
        assert!(count(P2, Some(P2)).contains(&L0Metric::SeverityClamped));
        assert!(count(P1, Some(P5)).contains(&L0Metric::SeverityClamped));

        assert!(!count(P3, Some(P2)).contains(&L0Metric::SeverityClamped));
        assert!(!count(P3, None).contains(&L0Metric::SeverityClamped));
        assert!(
            !count(P5, Some(P1)).contains(&L0Metric::SeverityClamped),
            "a promotion clamped to max_promotion_steps is not an attempted demotion"
        );
        assert!(
            count(P5, Some(P1)).contains(&L0Metric::Promoted { from: P5, to: P3 }),
            "it is a promotion, and it is counted as the promotion that was applied"
        );
        assert!(count(P3, Some(P2)).contains(&L0Metric::Promoted { from: P3, to: P2 }));
    }

    /// §8's claim about the suppression and downgrade counters: only ever
    /// nonzero for opted-in teams. A recommendation the engine did not honour
    /// must not appear as one it did.
    #[test]
    fn test_suppressed_and_downgraded_count_only_when_they_actually_happened() {
        let at = FIRED_AT + 4 * SECOND;
        let opted_out = raw(
            L0Mode::Parallel,
            L0Mode::Gate,
            L0Mode::Gate,
            L0Mode::Only,
            90,
            true,
            2,
            false,
            false,
        );
        let opted_in = everything_enabled();

        let suppress = complete(FIRED_AT, at, verdict(PageAction::Suppress, None));
        let downgrade = complete(FIRED_AT, at, verdict(PageAction::Downgrade, None));

        assert!(!metrics_for(&opted_out, &suppress, P3, at).contains(&L0Metric::Suppressed));
        assert!(!metrics_for(&opted_out, &downgrade, P3, at).contains(&L0Metric::Downgraded));
        assert!(metrics_for(&opted_in, &suppress, P3, at).contains(&L0Metric::Suppressed));
        assert!(metrics_for(&opted_in, &downgrade, P3, at).contains(&L0Metric::Downgraded));

        // What the agent said and what the engine did are two questions; this counts the first.
        for policy in [opted_out, opted_in] {
            assert!(
                metrics_for(&policy, &suppress, P3, at).contains(&L0Metric::Verdict {
                    action: PageAction::Suppress,
                    confidence: Confidence::High
                }),
                "every verdict counts its action and confidence band"
            );
        }
        // And an opted-in team whose P1 fires cannot suppress it either.
        assert!(!metrics_for(&opted_in, &suppress, P1, at).contains(&L0Metric::Suppressed));
    }

    /// `oncall_l0_budget_expired_total` answers "is the agent too slow". A
    /// verdict that landed in time, or a run that never started, is not that.
    #[test]
    fn test_budget_expiry_counts_only_when_no_verdict_landed_in_time() {
        let p = shipped();
        let deadline = FIRED_AT + 90 * SECOND;
        assert!(
            metrics_for(&p, &pending(FIRED_AT), P2, deadline).contains(&L0Metric::BudgetExpired)
        );
        assert!(
            !metrics_for(&p, &pending(FIRED_AT), P2, deadline - 1)
                .contains(&L0Metric::BudgetExpired),
            "the hold has not expired yet"
        );
        assert!(
            !metrics_for(
                &p,
                &complete(
                    FIRED_AT,
                    FIRED_AT + 4 * SECOND,
                    verdict(PageAction::Page, None)
                ),
                P2,
                FIRED_AT + 4 * SECOND
            )
            .contains(&L0Metric::BudgetExpired),
            "the agent answered inside the budget"
        );
        assert!(
            !metrics_for(&p, &dead(AnalysisStatus::Skipped, FIRED_AT), P2, deadline)
                .contains(&L0Metric::BudgetExpired),
            "a run that never started did not run out of time"
        );
        assert!(
            !metrics_for(&p, &pending(FIRED_AT), P1, deadline).contains(&L0Metric::BudgetExpired),
            "P1 has no gate to run out of"
        );
    }

    /// The mix series is the denominator for everything else in §8, so it has
    /// to carry both labels for every verdict, whatever the engine then did.
    #[test]
    fn test_every_verdict_counts_its_action_and_its_confidence_band() {
        let p = everything_enabled();
        let at = FIRED_AT + 4 * SECOND;
        for action in PageAction::ALL {
            for confidence in Confidence::ALL {
                let mut v = verdict(action, None);
                v.confidence = confidence;
                let got = metrics_for(&p, &complete(FIRED_AT, at, v), P3, at);
                assert_eq!(
                    got.iter()
                        .filter(|m| matches!(m, L0Metric::Verdict { .. }))
                        .count(),
                    1,
                    "{action}/{confidence}: exactly one verdict is one count"
                );
                assert!(got.contains(&L0Metric::Verdict { action, confidence }));
            }
        }
    }

    // §2.2 — the parser contract

    fn report_with(block: &str) -> String {
        format!(
            "# RCA for inc_9\n\nOpen file descriptors climbed on 3 of 8 queriers.\n\n```json verdict\n{block}\n```\n"
        )
    }

    const GOLDEN_VERDICT: &str = r#"{
  "probable_cause": "fd leak introduced by querier v0.14.2",
  "confidence": "high",
  "suspect_change": {
    "kind": "deploy",
    "reference": "v0.14.2",
    "author": "dana",
    "occurred_at": 1699978400000000
  },
  "impacted_services": ["production/openobserve"],
  "evidence_links": [
    { "label": "fd ratio per pod", "url": "https://o2.example/short/x7h3k2" }
  ],
  "page_recommendation": {
    "action": "page",
    "severity_suggestion": "P2",
    "reason": "predicted FD exhaustion in ~22 min; slope onset correlates with v0.14.2 deploy"
  },
  "proposed_actions": [
    { "title": "Restart q-4, q-6, q-7", "kind": "restart", "detail": "buys time" }
  ],
  "report_ref": "inc_9/rca/1"
}"#;

    /// The happy path, field by field. Every field is a line on the responder's
    /// card, and one the parser drops disappears silently at 3am.
    #[test]
    fn test_a_valid_verdict_block_parses_every_field() {
        let content = report_with(GOLDEN_VERDICT);
        let parsed = parse_report(&content);
        assert_eq!(parsed.report, content, "the report is stored untouched");
        let v = parsed.verdict.expect("a valid block must parse");
        assert_eq!(v.probable_cause, "fd leak introduced by querier v0.14.2");
        assert_eq!(v.confidence, Confidence::High);
        let change = v
            .suspect_change
            .expect("the suspect change is the 'what changed' answer");
        assert_eq!(change.kind, ChangeKind::Deploy);
        assert_eq!(change.reference, "v0.14.2");
        assert_eq!(change.author.as_deref(), Some("dana"));
        assert_eq!(change.occurred_at, 1_699_978_400_000_000);
        assert_eq!(
            v.impacted_services,
            vec!["production/openobserve".to_string()]
        );
        assert_eq!(v.evidence_links.len(), 1);
        assert_eq!(v.evidence_links[0].url, "https://o2.example/short/x7h3k2");
        assert_eq!(v.page_recommendation.action, PageAction::Page);
        assert_eq!(v.page_recommendation.severity_suggestion, Some(P2));
        assert!(v.page_recommendation.reason.contains("22 min"));
        assert_eq!(v.proposed_actions.len(), 1);
        assert_eq!(v.proposed_actions[0].kind, ActionKind::Restart);
        assert_eq!(v.report_ref, "inc_9/rca/1");
    }

    /// §2.2: a malformed verdict can never lose a report or a page. Every way a
    /// model can get the block wrong, and in each the markdown still saves and
    /// the firing still falls through to the fail-open page.
    #[test]
    fn test_a_malformed_verdict_block_loses_neither_the_report_nor_the_page() {
        let broken = [
            ("truncated json", "{ \"probable_cause\": \"fd leak\","),
            ("not json at all", "the cause is a file descriptor leak"),
            ("empty block", ""),
            ("json but not a verdict", "{ \"summary\": \"fd leak\" }"),
            (
                "missing page_recommendation",
                "{ \"probable_cause\": \"x\", \"confidence\": \"high\", \"report_ref\": \"r\" }",
            ),
            (
                "unknown confidence band",
                "{ \"probable_cause\": \"x\", \"confidence\": \"very high\", \"page_recommendation\": { \"action\": \"page\", \"reason\": \"r\" }, \"report_ref\": \"r\" }",
            ),
            (
                "unknown action",
                "{ \"probable_cause\": \"x\", \"confidence\": \"high\", \"page_recommendation\": { \"action\": \"ignore\", \"reason\": \"r\" }, \"report_ref\": \"r\" }",
            ),
            ("a json array", "[1, 2, 3]"),
        ];
        for (name, block) in broken {
            let content = report_with(block);
            let parsed = parse_report(&content);
            assert_eq!(parsed.report, content, "{name}: the report was altered");
            assert_eq!(parsed.verdict, None, "{name}: garbage parsed as a verdict");
        }
    }

    /// The deployment that has RCA switched off, and the model that forgot the
    /// section. Neither is an error; both are "no verdict".
    #[test]
    fn test_a_report_with_no_verdict_block_is_stored_unchanged() {
        for content in [
            "",
            "# RCA\n\nNo idea.\n",
            "# RCA\n\n```json\n{\"probable_cause\":\"x\"}\n```\n",
            "# RCA\n\n```verdict\nnot fenced as json verdict\n```\n",
        ] {
            let parsed = parse_report(content);
            assert_eq!(parsed.report, content);
            assert_eq!(
                parsed.verdict, None,
                "a plain json fence is not the verdict contract: {content:?}"
            );
        }
    }

    /// "cause unknown" is a first-class value the prompt prefers to
    /// confabulation. A parser treating it as a failure would turn the agent's
    /// honesty into a dropped verdict.
    #[test]
    fn test_an_unknown_cause_verdict_parses_and_still_recommends_a_page() {
        let content = report_with(
            r#"{
  "probable_cause": "cause unknown",
  "confidence": "low",
  "impacted_services": [],
  "evidence_links": [{ "label": "error rate", "url": "https://o2.example/short/aa" }],
  "page_recommendation": { "action": "page", "reason": "no cause established; paging" },
  "report_ref": "inc_9/rca/2"
}"#,
        );
        let v = parse_report(&content)
            .verdict
            .expect("unknown cause is legal");
        assert_eq!(v.probable_cause, "cause unknown");
        assert_eq!(v.confidence, Confidence::Low);
        assert_eq!(v.page_recommendation.action, PageAction::Page);
        assert_eq!(v.page_recommendation.severity_suggestion, None);
        assert!(
            !v.evidence_links.is_empty(),
            "it still says where it looked"
        );
        assert!(v.suspect_change.is_none());
        assert!(v.proposed_actions.is_empty());
    }

    /// The field accepts the forms a model writes. `"P2"` is what the prompt
    /// asks for; the bare integer is the API's own spelling, and dropping it
    /// would be a promotion that never happened.
    #[test]
    fn test_the_severity_suggestion_accepts_the_form_a_model_writes() {
        for (spelling, want) in [
            ("\"P2\"", Some(P2)),
            ("\"p2\"", Some(P2)),
            ("2", Some(P2)),
            ("\"P1\"", Some(P1)),
            ("null", None),
        ] {
            let content = report_with(&format!(
                "{{ \"probable_cause\": \"x\", \"confidence\": \"high\", \"page_recommendation\": {{ \"action\": \"page\", \"severity_suggestion\": {spelling}, \"reason\": \"r\" }}, \"report_ref\": \"r\" }}"
            ));
            let v = parse_report(&content)
                .verdict
                .unwrap_or_else(|| panic!("{spelling} must parse"));
            assert_eq!(
                v.page_recommendation.severity_suggestion, want,
                "{spelling}"
            );
        }
    }

    /// A severity outside the scale is not a severity. Rejecting the whole
    /// verdict is deliberate: half a verdict has its paging recommendation read
    /// from a value nobody checked, and §6 already handles "no verdict".
    #[test]
    fn test_a_severity_suggestion_outside_the_scale_rejects_the_whole_verdict() {
        for bad in ["\"P9\"", "0", "6", "\"critical\"", "-1", "\"\""] {
            let content = report_with(&format!(
                "{{ \"probable_cause\": \"x\", \"confidence\": \"high\", \"page_recommendation\": {{ \"action\": \"page\", \"severity_suggestion\": {bad}, \"reason\": \"r\" }}, \"report_ref\": \"r\" }}"
            ));
            let parsed = parse_report(&content);
            assert_eq!(parsed.verdict, None, "{bad} must not parse");
            assert_eq!(parsed.report, content, "{bad}: the report was altered");
        }
    }

    /// Idempotence at the parser. The verdict is the report's final section, so
    /// an agent that re-ran and emitted a second block resolves to the last.
    #[test]
    fn test_the_last_verdict_block_in_a_report_is_the_one_that_counts() {
        let first = "{ \"probable_cause\": \"first\", \"confidence\": \"low\", \"page_recommendation\": { \"action\": \"page\", \"reason\": \"r\" }, \"report_ref\": \"r\" }";
        let second = "{ \"probable_cause\": \"second\", \"confidence\": \"high\", \"page_recommendation\": { \"action\": \"page\", \"reason\": \"r\" }, \"report_ref\": \"r\" }";
        let content = format!("{}{}", report_with(first), report_with(second));
        let parsed = parse_report(&content);
        assert_eq!(parsed.report, content);
        assert_eq!(
            parsed.verdict.unwrap().probable_cause,
            "second",
            "the verdict is the report's final section"
        );
    }

    // §5 — what the notifications carry

    /// §5.2: the follow-up rides chat, push and email and does not re-fire
    /// voice or SMS. Waking somebody twice teaches a team that its urgent
    /// channels cry wolf.
    ///
    /// An allowlist, not a denylist: a denylist passes the same happy path and
    /// quietly admits every channel this product adds later.
    #[test]
    fn test_a_verdict_update_rides_only_the_channels_the_design_names() {
        assert_eq!(
            update_channels(&[Channel::Email, Channel::Webhook]),
            vec![Channel::Email],
            "webhook is not one of the §5.2 names"
        );
        assert!(update_channels(&[]).is_empty());
        assert!(
            update_channels(&[Channel::Webhook]).is_empty(),
            "a team reachable only by its room gets no update rather than a second post"
        );
    }

    /// §3's `Downgrade` branch. "Quieter" must never become "silent" — §2.1a's
    /// asymmetry is that nothing a verdict says may cost somebody a page. No
    /// channel here wakes a sleeping person, so every set comes back unchanged.
    #[test]
    fn test_a_downgrade_never_silences_a_rung() {
        for set in [
            vec![Channel::Email],
            vec![Channel::Webhook],
            vec![Channel::Email, Channel::Webhook],
        ] {
            assert_eq!(quieter_channels(&set), set);
        }
        assert!(quieter_channels(&[]).is_empty(), "nothing in, nothing out");
    }

    /// §5.3: the promotion reason is never dropped from the template. It is the
    /// sentence a responder will quote when deciding whether to trust the next
    /// one.
    #[test]
    fn test_a_promoted_page_always_carries_the_reason_it_was_promoted() {
        let reason = "predicted FD exhaustion in ~22 min";
        let note = promotion_note(P3, P2, FIRED_AT, reason);
        assert!(note.contains("P2"), "the severity it is now: {note}");
        assert!(note.contains("P3"), "the severity it was: {note}");
        assert!(note.contains("promoted"), "{note}");
        assert!(note.contains(reason), "the reason, verbatim: {note}");
        // Asserted on the instant reaching the output, not on a format the template owns.
        let hour_later = promotion_note(P3, P2, FIRED_AT + 3_600 * SECOND, reason);
        assert_ne!(
            note, hour_later,
            "the promotion instant is not rendered at all: {note}"
        );
        // An empty reason must not produce a line that claims nothing.
        let bare = promotion_note(P4, P2, FIRED_AT, "");
        assert!(bare.contains("P4") && bare.contains("P2"), "{bare}");
    }

    /// Templates degrade cleanly: an SMTP-only deployment with RCA disabled
    /// renders the pre-L0 messages byte-for-byte — no "AI: n/a" line, no empty
    /// section. Every level ≥ 2 dispatch uses the same rendering (§5.4).
    #[test]
    fn test_a_page_with_no_verdict_renders_exactly_todays_message() {
        let nothing = SeverityDecision::Unchanged { current: P3 };
        for status in [AnalysisStatus::Skipped, AnalysisStatus::Failed] {
            assert!(
                verdict_lines(&dead(status, FIRED_AT), &nothing).is_empty(),
                "{status:?} must add nothing at all to the message"
            );
        }
        let v = verdict(PageAction::Page, Some(P2));
        let rendered = verdict_lines(
            &complete(FIRED_AT, FIRED_AT + 4 * SECOND, v.clone()),
            &SeverityDecision::Promoted {
                from: P3,
                to: P2,
                requested: P2,
            },
        )
        .join("\n");
        assert!(rendered.contains(&v.probable_cause), "{rendered}");
        assert!(rendered.contains("high"), "the confidence band: {rendered}");
        assert!(
            rendered.contains("v0.14.2"),
            "the suspect change: {rendered}"
        );
        assert!(
            rendered.contains("Restart q-4, q-6, q-7"),
            "the suggestion is text on the page: {rendered}"
        );
    }

    /// The template is the last place §2.1a can be undone. A discarded demotion
    /// still carries `severity_suggestion: P4`, and printing the field raw puts
    /// "P4" on a page for a firing that remains a P2.
    ///
    /// A refused *promotion* is the opposite case and §6 requires it be
    /// rendered, so one blanket rule cannot handle both.
    #[test]
    fn test_a_refused_suggestion_is_not_rendered_as_though_it_had_been_applied() {
        let at = FIRED_AT + 4 * SECOND;

        // Discarded demotion: the level asked for must not appear as this page's severity.
        let demoting = complete(FIRED_AT, at, verdict(PageAction::Page, Some(P4)));
        let rendered = verdict_lines(
            &demoting,
            &SeverityDecision::Discarded {
                current: P2,
                requested: P4,
            },
        )
        .join("\n");
        assert!(
            !rendered.contains("P4"),
            "a demotion the engine discarded reached the page anyway: {rendered}"
        );
        assert!(
            !rendered.is_empty(),
            "the rest of the investigation is still worth rendering: {rendered}"
        );

        // Refused promotion: §6 says recorded AND rendered.
        let promoting = complete(FIRED_AT, at, verdict(PageAction::Page, Some(P2)));
        let rendered = verdict_lines(
            &promoting,
            &SeverityDecision::Refused {
                current: P3,
                requested: P2,
            },
        )
        .join("\n");
        assert!(
            rendered.contains("P2"),
            "a promotion the team turned off is still the agent's judgement and belongs on the page: {rendered}"
        );
    }

    #[test]
    fn test_a_page_that_beat_the_verdict_says_an_investigation_is_running() {
        let lines = verdict_lines(
            &pending(FIRED_AT),
            &SeverityDecision::Unchanged { current: P2 },
        );
        assert!(!lines.is_empty(), "a live investigation is worth one line");
        let rendered = lines.join("\n").to_lowercase();
        assert!(
            rendered.contains("investigation") || rendered.contains("investigating"),
            "the line has to say what is happening: {rendered}"
        );
    }

    /// §5.1: where a channel can revise a message, the findings fill in the same
    /// one. No channel this build can send is revisable — which is why the
    /// follow-up update, not the edit, is what has to be deduped.
    #[test]
    fn test_no_channel_this_build_sends_can_revise_what_it_already_sent() {
        for c in [Channel::Email, Channel::Webhook] {
            assert!(
                !updates_in_place(c),
                "{c} cannot take a finding back once it has gone"
            );
        }
    }

    /// §8's headline metric. An inverted or non-strict comparison breaks nothing
    /// a user sees — it inflates the one number the programme is judged on.
    #[test]
    fn test_the_verdict_beat_the_ack_only_when_it_actually_arrived_first() {
        let acked = FIRED_AT + 120 * SECOND;
        assert!(verdict_beat_the_ack(Some(acked - 1), acked));
        assert!(verdict_beat_the_ack(Some(FIRED_AT), acked));
        assert!(
            !verdict_beat_the_ack(Some(acked), acked),
            "landing at the same instant did not brief anybody"
        );
        assert!(!verdict_beat_the_ack(Some(acked + 1), acked));
        assert!(
            !verdict_beat_the_ack(None, acked),
            "no verdict is not a verdict that arrived first"
        );
    }

    /// The trust metric. Window and direction both have to be right: 24 hours,
    /// and "at or above", not "above".
    #[test]
    fn test_a_false_suppress_is_a_re_fire_at_or_above_the_same_severity_within_a_day() {
        let day = 24 * 3_600 * SECOND;
        let cases = [
            // (refire delay, refire severity, counts against us)
            (SECOND, P3, true),
            (day - 1, P3, true),
            (day, P3, false),
            (day + 1, P3, false),
            (SECOND, P2, true),
            (SECOND, P1, true),
            (SECOND, P4, false),
            (SECOND, P5, false),
        ];
        for (delay, severity, want) in cases {
            assert_eq!(
                is_false_suppress(FIRED_AT, P3, FIRED_AT + delay, severity),
                want,
                "a P3 suppressed at {FIRED_AT}, back as {severity} after {delay}us"
            );
        }
        assert!(
            !is_false_suppress(FIRED_AT, P3, FIRED_AT - SECOND, P1),
            "something that fired before the suppression is not its consequence"
        );
    }

    /// §11's boundary, enforced by the type: a `ProposedAction` is three
    /// strings. No `workflow_ref`, no `args`, no `reversible`, so nothing
    /// downstream can read it as anything but display text.
    #[test]
    fn test_a_proposed_action_carries_no_execution_affordance() {
        let action = ProposedAction {
            title: "Roll back payments deploy 4f2c1a".into(),
            kind: ActionKind::Rollback,
            detail: "reverts to 4f2c19".into(),
        };
        let json = serde_json::to_value(&action).unwrap();
        let object = json.as_object().unwrap();
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec!["detail", "kind", "title"],
            "a proposed action is text a human carries out; execution is out of scope"
        );
        for forbidden in [
            "workflow_ref",
            "args",
            "reversible",
            "verify_signal",
            "grant",
        ] {
            assert!(
                !object.contains_key(forbidden),
                "{forbidden} is not in scope"
            );
        }
    }

    /// The verdict is persisted and cached, so its stored shape is a contract. A
    /// field that stops round tripping is a responder card that loses a line
    /// after an upgrade.
    #[test]
    fn test_a_verdict_round_trips_through_json() {
        let v = verdict(PageAction::Downgrade, Some(P1));
        let back: AnalysisVerdict =
            serde_json::from_str(&serde_json::to_string(&v).unwrap()).unwrap();
        assert_eq!(back, v);

        // The optional halves are absent, not null, so no suspect change renders no empty row.
        let bare = AnalysisVerdict {
            probable_cause: "cause unknown".into(),
            confidence: Confidence::Low,
            suspect_change: None,
            impacted_services: vec![],
            evidence_links: vec![],
            page_recommendation: PageRecommendation {
                action: PageAction::Page,
                severity_suggestion: None,
                reason: "no cause established".into(),
            },
            proposed_actions: vec![],
            report_ref: "r".into(),
        };
        let json = serde_json::to_string(&bare).unwrap();
        assert!(!json.contains("suspect_change"));
        assert!(!json.contains("severity_suggestion"));
        assert_eq!(
            serde_json::from_str::<AnalysisVerdict>(&json).unwrap(),
            bare
        );
    }

    /// The analysis state rides `Trigger.data`, which the super cluster already
    /// replicates — but only if the state serialises whole.
    #[test]
    fn test_the_analysis_state_round_trips_through_json() {
        let state = complete(
            FIRED_AT,
            FIRED_AT + 4 * SECOND,
            verdict(PageAction::Page, Some(P2)),
        );
        let back: AnalysisState =
            serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(back, state);

        for status in AnalysisStatus::ALL {
            let json = serde_json::to_string(&status).unwrap();
            assert_eq!(
                serde_json::from_str::<AnalysisStatus>(&json).unwrap(),
                status
            );
        }
        // A skipped analysis is the common case: no empty verdict object in the trigger row.
        let skipped = AnalysisState {
            status: AnalysisStatus::Skipped,
            verdict: None,
            requested_at: None,
            completed_at: None,
        };
        let json = serde_json::to_string(&skipped).unwrap();
        assert_eq!(json, r#"{"status":"skipped"}"#);
    }

    /// The wire spellings are what the prompt asks a model to emit and what the
    /// timeline stores. Renaming one breaks both, silently: the block stops
    /// parsing and the firing falls back to the pre-L0 page.
    #[test]
    fn test_the_verdict_vocabulary_is_pinned() {
        for (c, want) in [
            (Confidence::High, "high"),
            (Confidence::Medium, "medium"),
            (Confidence::Low, "low"),
        ] {
            assert_eq!(c.as_str(), want);
            assert_eq!(serde_json::to_string(&c).unwrap(), format!("\"{want}\""));
        }
        for (a, want) in [
            (PageAction::Page, "page"),
            (PageAction::Downgrade, "downgrade"),
            (PageAction::Suppress, "suppress"),
        ] {
            assert_eq!(a.as_str(), want);
            assert_eq!(serde_json::to_string(&a).unwrap(), format!("\"{want}\""));
        }
        for (k, want) in [
            (ChangeKind::Deploy, "deploy"),
            (ChangeKind::Commit, "commit"),
            (ChangeKind::ConfigChange, "config_change"),
            (ChangeKind::FeatureFlag, "feature_flag"),
            (ChangeKind::Infra, "infra"),
        ] {
            assert_eq!(serde_json::to_string(&k).unwrap(), format!("\"{want}\""));
        }
        for (k, want) in [
            (ActionKind::Rollback, "rollback"),
            (ActionKind::Scale, "scale"),
            (ActionKind::Restart, "restart"),
            (ActionKind::Runbook, "runbook"),
            (ActionKind::Other, "other"),
        ] {
            assert_eq!(serde_json::to_string(&k).unwrap(), format!("\"{want}\""));
        }
        for (m, want) in [
            (L0Mode::Parallel, "parallel"),
            (L0Mode::Gate, "gate"),
            (L0Mode::Only, "only"),
        ] {
            assert_eq!(serde_json::to_string(&m).unwrap(), format!("\"{want}\""));
        }
    }
}
