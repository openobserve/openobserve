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

//! L0 — the AI SRE agent as level zero of every escalation policy.
//!
//! The agent already investigates every incident. What this module adds is the
//! connection between that investigation and paging: a structured verdict that
//! rides the ladder, and a small set of pure decisions the engine makes with it.
//!
//! Everything here is data plus pure functions over it — no I/O, no clock, no
//! agent client. Instants are microseconds, passed in.
//!
//! Two invariants are the reason the rest of it is safe to ship, and both are
//! enforced here rather than in a prompt:
//!
//! 1. **P1 is never gated.** [`gate_plan`] returns [`GatePlan::Parallel`] for P1
//!    whatever the stored policy says. A model delaying a critical page is the
//!    one failure that would end the programme, so it is not a setting.
//! 2. **Severity is a ratchet.** [`ratchet`] may raise a firing's severity and
//!    can express no other outcome. A verdict that degrades, is jailbroken by
//!    log content, or simply misreads cannot quiet a page through this field.
//!
//! Scope: this is the read-only L0. `proposed_actions` is display text. Nothing
//! here executes anything.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::policy::Channel;
use crate::meta::alerts::priority::AlertPriority;

/// Shortest triage hold a team may configure.
///
/// Below this the gate cannot pay for itself: the agent's deterministic
/// pre-flight is measured in seconds and a hold shorter than one is a hold that
/// always expires.
pub const MIN_TRIAGE_BUDGET_SECONDS: i64 = 30;

/// Longest triage hold a team may configure.
///
/// Ten minutes. Past this the question a responder asks stops being "why is the
/// page late" and becomes "did the pager break".
pub const MAX_TRIAGE_BUDGET_SECONDS: i64 = 600;

/// Actor recorded for anything the agent itself produced.
pub const AGENT_ACTOR: &str = "o2-sre";

// ---------------------------------------------------------------------------
// §2.1 — the verdict contract
// ---------------------------------------------------------------------------

/// How sure the agent is, as a band rather than a number.
///
/// The agent has no calibrated probability, and a percentage would be false
/// precision that trains responders to ignore the field. The band maps to how
/// the verdict is rendered: `High` states the cause as the headline, `Low`
/// renders it as an unverified hypothesis.
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

/// One re-runnable claim: the query, panel or commit behind a finding.
///
/// The card's "I already checked" section is a receipt, not an assertion — a
/// responder who does not trust the agent still lands on the right five panels
/// instead of hunting for them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EvidenceLink {
    pub label: String,
    pub url: String,
}

/// What the agent recommends the engine do about paging.
///
/// A recommendation, never a decision: the engine applies it according to
/// policy a human configured in advance.
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
    /// **Promotion only.** [`ratchet`] discards anything at or below the
    /// firing's current severity: the agent may raise a P3 to P2, never lower a
    /// P2 to P3.
    ///
    /// Read with a hand-written deserializer because the block is written by a
    /// language model: `"P2"`, `"p2"` and the bare `2` the API itself uses all
    /// mean the same thing, and dropping one of them silently is a promotion
    /// that never happened. Anything outside the scale fails the whole verdict
    /// (§2.2) rather than this one field — half a verdict is a paging
    /// recommendation read from a value nobody checked.
    #[serde(
        default,
        deserialize_with = "deserialize_severity_suggestion",
        skip_serializing_if = "Option::is_none"
    )]
    pub severity_suggestion: Option<AlertPriority>,
    /// Rendered verbatim in the audit event and on any promoted page.
    pub reason: String,
}

/// Read a `severity_suggestion` in any of the spellings a model writes.
///
/// `"P2"`, `"p2"` and `2` are the same severity; `null` and an absent field are
/// no suggestion. Everything else is an error, which — because the field sits
/// inside the verdict — rejects the whole verdict rather than half of it.
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
            // The `P` is how the product spells it everywhere a human reads it;
            // the bare integer is how the API stores it. Both arrive.
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

/// Something a human might do next.
///
/// **Inert.** It is rendered as text on the page and on the record, and a human
/// carries it out. There is no `workflow_ref`, no `args` and no grant, because
/// there is no execution path in this implementation — the whole field is three
/// strings a responder reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ProposedAction {
    pub title: String,
    pub kind: ActionKind,
    pub detail: String,
}

/// What the agent concluded, emitted at the end of every autonomous RCA run.
///
/// Persisted on the subject timeline and cached on the escalation state; the
/// full markdown report it summarises is unchanged and still saved as today.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AnalysisVerdict {
    /// One sentence. `"cause unknown"` is a legal, first-class value — the
    /// prompt prefers it to confabulation, and such a verdict still carries
    /// evidence and still recommends `Page`.
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

// ---------------------------------------------------------------------------
// §3 — the analysis state that rides the escalation row
// ---------------------------------------------------------------------------

/// Where the investigation has got to.
///
/// `Skipped` covers RCA disabled, agent URL unset, health check failed, and the
/// existing in-flight and cooldown guards. The engine treats `Skipped` and
/// `Failed` identically: behave exactly as the system does today, pre-L0.
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

    /// Whether a verdict can still arrive for this firing.
    ///
    /// `Failed` and `Skipped` both mean "no verdict is coming", which is why
    /// the gate must not wait on either of them.
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
    /// When the run was asked for. This — not the wall clock at the time of a
    /// re-queue — is what the triage hold is measured from, so a node that dies
    /// mid-TRIAGE resumes the same deadline rather than restarting it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
}

// ---------------------------------------------------------------------------
// §4 — the L0 policy block
// ---------------------------------------------------------------------------

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

/// A team's L0 block.
///
/// Ships with every auto-created policy, so nobody has to configure L0 to
/// benefit from it. There is deliberately no `allow_demotion` knob: the ratchet
/// is an invariant of the engine, not a team preference.
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
    /// P4 and P5 page nobody, so there is no page to hold and no page to run
    /// alongside. A gate there would insert the trigger row §3 says a P4 never
    /// gets.
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
            // Opt-in. One missed real page costs more trust than a quarter of
            // noise reduction buys.
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
    /// Never a plain field read, in **either** direction. P1 is parallel
    /// whatever a stored row says; `Only` on a paging severity would silence
    /// it; and `Gate` or `Parallel` on P4/P5 would put a firing that pages
    /// nobody into a hold, which inserts the trigger row §3 says a P4 never
    /// gets. Whether a severity pages is [`severity_pages`], not a setting, so
    /// this derives the answer from that rather than trusting the column.
    pub fn mode_for(&self, priority: AlertPriority) -> L0Mode {
        // Derived from `severity_pages`, not from the column: a severity that
        // pages nobody has no page to hold and none to run beside, whatever a
        // replicated or hand-edited row happens to say.
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
            // `only` on a paging severity would silence it permanently, so it
            // reads as the safest thing it could have meant.
            L0Mode::Only => L0Mode::Parallel,
            other => other,
        }
    }

    /// The triage hold in microseconds, clamped into the documented bounds.
    ///
    /// Clamped on read as well as refused on write, because rows arrive from
    /// replication and from hands on a database, and an unbounded hold is a
    /// page that never happens.
    pub fn triage_budget_micros(&self) -> i64 {
        // Clamped BEFORE the multiplication: `i64::MAX` seconds overflows into
        // a deadline no clock ever reaches, and a TRIAGE row that never fires
        // is a page that never happens.
        self.triage_budget_seconds
            .clamp(MIN_TRIAGE_BUDGET_SECONDS, MAX_TRIAGE_BUDGET_SECONDS)
            * 1_000_000
    }
}

// ---------------------------------------------------------------------------
// §2.1a — the ratchet
// ---------------------------------------------------------------------------

/// What the engine did with a `severity_suggestion`.
///
/// There is no variant that lowers a severity, and that absence is the point:
/// the asymmetry is expressed in the type, not only in the branch that computes
/// it.
///
/// Serialised because the page it has to be rendered on is dispatched by a
/// later tick than the one that decided it: recomputing the ratchet at render
/// time reads the row's *already promoted* severity and answers `Discarded`,
/// which drops the promotion note §5.3 says is never dropped.
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
    /// Applied. `to` is more urgent than `from`, always; it differs from
    /// `requested` when the promotion was clamped to `max_promotion_steps`, and
    /// both levels are kept so the timeline can show what was asked for.
    Promoted {
        from: AlertPriority,
        to: AlertPriority,
        requested: AlertPriority,
    },
}

impl SeverityDecision {
    /// The severity the firing actually proceeds at.
    ///
    /// The single function every caller must use. It can return the current
    /// severity or a more urgent one, and nothing else.
    pub fn applied(&self) -> AlertPriority {
        match self {
            Self::Unchanged { current }
            | Self::Discarded { current, .. }
            | Self::Refused { current, .. } => *current,
            // The only variant that moves anything, and `to` is more urgent
            // than `from` by construction in `ratchet`.
            Self::Promoted { to, .. } => *to,
        }
    }

    /// True only for a suggestion at or below the current severity — the case
    /// `oncall_l0_severity_clamp_total` counts, and the one expected to be ~0.
    pub fn was_demotion_attempt(&self) -> bool {
        matches!(self, Self::Discarded { .. })
    }
}

/// Apply a `severity_suggestion` to a firing's current severity.
///
/// The whole of §2.1a. A suggestion at or below `current` is discarded and
/// counted; a promotion beyond `max_promotion_steps` is clamped to the bound
/// and applied, with the requested level kept for the timeline.
///
/// `AlertPriority::to_i32()` runs P1 = 1 … P5 = 5, so promotion *decreases* the
/// integer. Compare through [`AlertPriority::is_more_urgent_than`]; a bare `>`
/// on the raw ids reads exactly backwards and turns every demotion into a
/// promotion.
pub fn ratchet(
    current: AlertPriority,
    suggestion: Option<AlertPriority>,
    l0: &L0Policy,
) -> SeverityDecision {
    let Some(requested) = suggestion else {
        return SeverityDecision::Unchanged { current };
    };
    // The whole of §2.1a in one comparison, and it is a named one: on the raw
    // ids P4 (4) > P2 (2), so `requested > current` would read a demotion as a
    // promotion and quietly quieten the page.
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
        // A bound of zero can only mean "no promotions": clamping to the
        // current severity and calling it a promotion would write a
        // `SeverityPromoted{P3 → P3}` line and page for nothing.
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

// ---------------------------------------------------------------------------
// §1, §3 — the gate
// ---------------------------------------------------------------------------

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
        // TRIAGE is just a trigger row with a deadline, so a gate inserts one
        // exactly as a parallel firing does. `L0Only` is the P4 case, which
        // never inserted one and still does not.
        matches!(self, Self::Parallel | Self::Gate { .. })
    }
}

/// Decide how a firing enters the ladder.
///
/// Takes no `now`: the hold is anchored on `analysis.requested_at` (falling
/// back to the firing) so a node that dies mid-TRIAGE and is re-queued
/// recomputes the same absolute deadline instead of restarting the budget.
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
            // §6, first row: paging never waits for a dead agent. A run that
            // is not going to answer has no hold to sit in, so the row goes in
            // in a NOTIFYING posture exactly as it does today.
            if !analysis.status.may_still_answer() {
                return GatePlan::Parallel;
            }
            // Anchored on the request, not on the wall clock: a node that dies
            // mid-TRIAGE re-queues and recomputes the same absolute deadline
            // instead of restarting the budget.
            let anchor = analysis.requested_at.unwrap_or(fired_at);
            GatePlan::Gate {
                fire_at: anchor + l0.triage_budget_micros(),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// §3, §4 — applying a verdict
// ---------------------------------------------------------------------------

/// What the engine does with a verdict.
///
/// Note what cannot be expressed: `Page.severity` is the ratcheted severity and
/// there is no field for a lowered one. A `Downgrade` sets `quieter_channels`,
/// which is a choice about one notification, never about the record.
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
    /// The page has already gone out. The verdict rides as one follow-up
    /// update, ledger-deduped, on non-interrupting channels — not a new page.
    /// Also the P4/P5 outcome, where there is nobody to follow up with.
    FollowUp { severity: AlertPriority },
    /// The gate is over and no usable verdict arrived. Page exactly as the
    /// pre-L0 system would have.
    FailOpen { severity: AlertPriority },
}

impl VerdictOutcome {
    /// Whether this firing is notified on a quieter channel set.
    ///
    /// The one question the dispatcher has to ask of a `Downgrade`. Written as
    /// a function because the field is otherwise read at exactly one match arm
    /// and silently ignored at every other, which is how a knob ends up
    /// computed, counted and inert.
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
        // `FollowUp` is news on channels that do not interrupt, and `Hold` is
        // the gate still running; neither reaches a sleeping person.
        matches!(self, Self::Page { .. } | Self::FailOpen { .. })
    }
}

/// The instant a gated firing's hold runs out.
///
/// Anchored on the request for the same reason [`gate_plan`] is: a re-queue
/// after a crash resumes the deadline it persisted rather than starting a new
/// one.
fn hold_deadline(l0: &L0Policy, analysis: &AnalysisState, now: i64) -> i64 {
    analysis.requested_at.unwrap_or(now) + l0.triage_budget_micros()
}

/// The verdict-application decision — pure over `(policy.l0, analysis,
/// severity, now)`.
///
/// `severity` is the firing's currently recorded severity, not the suggestion.
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
    // Everything below reads `applied`, never the suggestion.
    let promotion = match decision {
        SeverityDecision::Promoted { from, to, .. } => Some((from, to)),
        _ => None,
    };

    match l0.mode_for(severity) {
        // P4 and P5. No page to hold, no page to run beside, and the only way
        // anybody is woken is the firing ceasing to be a P4.
        L0Mode::Only => match promotion {
            Some((from, to)) if severity_pages(to) => VerdictOutcome::Page {
                severity: to,
                promoted_from: Some(from),
                quieter_channels: false,
            },
            _ => VerdictOutcome::FollowUp { severity },
        },
        // The page went out at t=0, so the suppression and downgrade branches
        // are gone with it — a team that turned the gate off traded them away.
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
                // No answer, and none coming: `Failed` and `Skipped` do not
                // wait out a budget for a verdict that is not on its way.
                if analysis.status.may_still_answer() && now < deadline {
                    return VerdictOutcome::Hold { until: deadline };
                }
                return VerdictOutcome::FailOpen { severity };
            };
            // A promotion re-enters the ladder whenever it lands, including
            // after the hold: it is the one verdict that IS a page.
            if let Some((from, to)) = promotion {
                return VerdictOutcome::Page {
                    severity: to,
                    promoted_from: Some(from),
                    quieter_channels: false,
                };
            }
            // The deadline belongs to the hold expiring. A verdict landing on
            // it is racing a page that has already been decided, and the page
            // wins.
            let arrived = analysis.completed_at.unwrap_or(now);
            if arrived >= deadline {
                return VerdictOutcome::FollowUp { severity };
            }
            match verdict.page_recommendation.action {
                PageAction::Suppress if l0.allow_suppress => VerdictOutcome::Suppress,
                PageAction::Downgrade => VerdictOutcome::Page {
                    severity,
                    promoted_from: None,
                    // The recorded severity is untouched either way; this is a
                    // choice about one notification.
                    quieter_channels: l0.allow_downgrade,
                },
                // Including a Suppress the team has not opted into: recorded as
                // a recommendation, and the page still goes out.
                PageAction::Page | PageAction::Suppress => VerdictOutcome::Page {
                    severity,
                    promoted_from: None,
                    quieter_channels: false,
                },
            }
        }
    }
}

/// When level 1 dispatches for this firing, or `None` if it never pages.
///
/// The timing invariant in one function. `analysis_status` is the status **at
/// the firing** — what the start-time guards decided ([`analysis_status_for_start`])
/// — and `verdict` is the verdict and the instant it landed, or `None` if none
/// ever did. An investigation that starts and then fails mid-hold is
/// [`apply_verdict`]'s question, not this one: this answers "given how the
/// firing entered the ladder and when the answer came, when was somebody
/// woken".
///
/// Two things it must satisfy, for every input: at P1 the answer is `fired_at`,
/// and at a gated severity the answer is never later than
/// `fired_at + triage_budget`.
///
/// A `Complete` status with no verdict is the malformed-block case and reads as
/// `Failed`: the run finished and produced nothing the ladder can use.
pub fn first_page_at(
    l0: &L0Policy,
    priority: AlertPriority,
    fired_at: i64,
    analysis_status: AnalysisStatus,
    verdict: Option<(&AnalysisVerdict, i64)>,
) -> Option<i64> {
    let decision = ratchet(
        priority,
        verdict.and_then(|(v, _)| v.page_recommendation.severity_suggestion),
        l0,
    );
    let promoted = matches!(decision, SeverityDecision::Promoted { .. });

    match l0.mode_for(priority) {
        // Nobody is paged at this severity. The only way anybody is woken is
        // the firing ceasing to be a P4 — and then it is woken when the verdict
        // that said so landed.
        L0Mode::Only => match verdict {
            Some((_, at)) if promoted && severity_pages(decision.applied()) => Some(at),
            _ => None,
        },
        // The P1 invariant, and the teams that bought it at P2/P3: level 1
        // dispatches inline at t=0 and no verdict, however late or however
        // emphatic, moves it.
        L0Mode::Parallel => Some(fired_at),
        L0Mode::Gate => {
            let deadline = fired_at + l0.triage_budget_micros();
            let Some((verdict, at)) = verdict else {
                // A run that is not going to answer is not held for one.
                return Some(if analysis_status.may_still_answer() {
                    deadline
                } else {
                    fired_at
                });
            };
            if at >= deadline {
                // The hold expired first; a late verdict cannot move the page
                // it missed.
                return Some(deadline);
            }
            if promoted {
                return Some(at);
            }
            // The one branch that cuts a page, and only for a team that asked
            // for it. Everything else ends the hold and pages now.
            match verdict.page_recommendation.action {
                PageAction::Suppress if l0.allow_suppress => None,
                _ => Some(at),
            }
        }
    }
}

/// Whether a severity pages a human at all under §1's table.
///
/// L0's own table, not the escalation policy's ladder: a team whose policy
/// gives P3 no rungs is that policy's business, and this is the question
/// "should a promotion into this severity wake somebody".
pub fn severity_pages(priority: AlertPriority) -> bool {
    match priority {
        AlertPriority::P1 | AlertPriority::P2 | AlertPriority::P3 => true,
        // In-app / business-hours digest, and that is unchanged by L0.
        AlertPriority::P4 | AlertPriority::P5 => false,
    }
}

// ---------------------------------------------------------------------------
// §6 — the guards that decide whether L0 runs at all
// ---------------------------------------------------------------------------

/// The analysis status a run ends in.
///
/// §6: a run whose report carried no usable verdict block is `Failed`, not
/// `Complete` — "same as the budget-expiry path if gating". A `Pending` that is
/// never moved off `Pending` is a gate that waits for the full budget on every
/// malformed report, which is the latency the gate promises it does not cost.
pub fn analysis_status_after_run(produced_a_verdict: bool) -> AnalysisStatus {
    if produced_a_verdict {
        AnalysisStatus::Complete
    } else {
        // The run finished and produced nothing the ladder can use. Leaving it
        // `Pending` costs every malformed report the full triage budget, which
        // is the latency the gate promises it does not.
        AnalysisStatus::Failed
    }
}

/// The analysis status a firing starts with.
///
/// L0 adds no new trigger path: these are the guards the RCA trigger already
/// evaluates, read once and turned into a state the ladder understands. Every
/// blocked reason is `Skipped`, and `Skipped` means "behave exactly as today".
pub fn analysis_status_for_start(
    rca_enabled: bool,
    agent_url_set: bool,
    agent_healthy: bool,
    analysis_in_flight: bool,
    cooldown_elapsed: bool,
) -> AnalysisStatus {
    let clear = rca_enabled && agent_url_set && agent_healthy && !analysis_in_flight && cooldown_elapsed;
    if clear {
        AnalysisStatus::Pending
    } else {
        // Every blocked reason is one state, and that state means "behave
        // exactly as today".
        AnalysisStatus::Skipped
    }
}

// ---------------------------------------------------------------------------
// §8 — observability
// ---------------------------------------------------------------------------

/// One counter movement caused by applying a verdict.
///
/// Returned rather than emitted so the decision stays pure and a dashboard and
/// the timeline cannot disagree about what happened.
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
    /// Expected to be ~0; a nonzero rate is a prompt-regression or
    /// prompt-injection signal, not a routine event.
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
        // The mix series is the denominator for everything else, so it counts
        // what the agent said whatever the engine then did with it.
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
            // Expected to be ~0. A step-clamped promotion is routine and must
            // not appear here, or the alarm reads as noise.
            moved.push(L0Metric::SeverityClamped);
        }
        if let SeverityDecision::Promoted { from, to, .. } = decision {
            moved.push(L0Metric::Promoted { from, to });
        }
    } else if analysis.status.may_still_answer()
        && l0.mode_for(severity) == L0Mode::Gate
        && now >= hold_deadline(l0, analysis, now)
    {
        // "Was the agent too slow for the gate." A run that never started did
        // not run out of time, and a severity with no gate has no budget to
        // expire.
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

// ---------------------------------------------------------------------------
// §2.2 — the parser contract
// ---------------------------------------------------------------------------

/// A report and whatever verdict it carried.
///
/// `report` is the content as it will be persisted. It is the input, unchanged,
/// in every case — a malformed verdict can never lose a report or a page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedReport<'a> {
    pub report: &'a str,
    pub verdict: Option<AnalysisVerdict>,
}

/// Split an agent report into the markdown that is stored and the verdict the
/// ladder consumes.
///
/// The verdict is a fenced ` ```json verdict ` block, the final section of the
/// report. Parse failure or an absent block is **no verdict** — never an error,
/// never a reason to drop the report.
pub fn parse_report(rca_content: &str) -> ParsedReport<'_> {
    ParsedReport {
        // The input, unchanged, in every case. A malformed verdict can never
        // lose a report.
        report: rca_content,
        verdict: last_verdict_block(rca_content).and_then(|b| serde_json::from_str(&b).ok()),
    }
}

/// The body of the last ` ```json verdict ` fence in a report.
///
/// The last one, because the verdict is "the final section of the report": an
/// agent that re-ran and emitted a second block must not leave the reader
/// guessing which one the ladder used.
fn last_verdict_block(rca_content: &str) -> Option<String> {
    let mut found: Option<String> = None;
    let mut open: Option<Vec<&str>> = None;
    for line in rca_content.lines() {
        match &mut open {
            None => {
                // `json` alone, or `verdict` alone, is not the contract: a
                // report may fence ordinary JSON and must not have it read as
                // a paging recommendation.
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

// ---------------------------------------------------------------------------
// §5 — what the notifications carry
// ---------------------------------------------------------------------------

/// The channels a follow-up verdict update may use.
///
/// §5.2 names three and only three — "it rides channel/push/email" — so this is
/// an **allowlist**, not a denylist of the urgent ones. The difference is not
/// cosmetic: a denylist admits every channel added later by default, and the
/// next channel added to this product would start carrying updates without
/// anybody deciding that it should.
///
/// `Voice` and `Sms` are excluded because they are reserved for "a human is
/// needed" rather than "news arrived". `Push` is *not* excluded even though it
/// interrupts — it revises the message it already delivered
/// ([`updates_in_place`]) and is where a responder already reading the page
/// expects the answer to appear, which is a different question from whether it
/// can wake somebody. That is why `!Channel::is_interrupting()` is the wrong
/// predicate here.
pub fn update_channels(channels: &[Channel]) -> Vec<Channel> {
    channels
        .iter()
        .copied()
        // An allowlist of the three §5.2 names, in the order the policy wrote
        // them. A denylist of the urgent ones would admit every channel this
        // product adds later, without anybody deciding that it should.
        .filter(|c| matches!(c, Channel::Chat | Channel::Push | Channel::Email))
        .collect()
}

/// The channel set a downgraded firing is notified on.
///
/// §3: a `Downgrade` asks for *this firing* to ride quieter channels while the
/// record keeps the severity the rule assigned. Quieter means "does not wake a
/// sleeping person", so the interrupting channels are dropped — and if that
/// would leave nothing, the original set is kept, because a downgrade may make
/// a page quieter and may never make it disappear.
pub fn quieter_channels(channels: &[Channel]) -> Vec<Channel> {
    let quiet: Vec<Channel> = channels
        .iter()
        .copied()
        .filter(|c| !c.is_interrupting())
        .collect();
    if quiet.is_empty() {
        return channels.to_vec();
    }
    quiet
}

/// The line every message on a promoted page carries.
///
/// Never dropped from the template: a responder woken by a machine's judgement
/// is owed that judgement in the first line, and it is the sentence they will
/// quote when deciding whether to trust the next one.
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
        // An empty reason must not produce a line that trails off claiming
        // nothing.
        line
    } else {
        format!("{line} — {reason}")
    }
}

/// The investigation lines a notification renders.
///
/// Three situations, and the empty one matters most: with the analysis
/// `Skipped` or `Failed` there is nothing to say, so an SMTP-only deployment
/// with RCA disabled renders the current, pre-L0 message byte-for-byte. A
/// `Pending` analysis renders one "investigation running" line with its deep
/// link — no waiting and no placeholder spam. A `Complete` one renders the
/// findings.
///
/// `decision` is what the engine did with the `severity_suggestion`, and the
/// page has to be rendered from it rather than from the verdict alone. A
/// verdict field printed raw is a page that announces a severity nobody
/// applied: a **discarded demotion** would put "P4" on a P2 page, which is the
/// demotion §2.1a refuses, arriving by way of the template.
pub fn verdict_lines(analysis: &AnalysisState, decision: &SeverityDecision) -> Vec<String> {
    let Some(verdict) = &analysis.verdict else {
        // Nothing to say, so nothing is added: an SMTP-only deployment with
        // RCA disabled renders the current, pre-L0 message byte-for-byte.
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
        lines.push(format!("impacted: {}", verdict.impacted_services.join(", ")));
    }
    for link in &verdict.evidence_links {
        lines.push(format!("· {} — {}", link.label, link.url));
    }
    lines.push(format!(
        "recommendation: {} — {}",
        verdict.page_recommendation.action, verdict.page_recommendation.reason
    ));
    // Rendered from what the engine DID, never from the verdict's own field: a
    // discarded demotion still carries `severity_suggestion: P4`, and printing
    // it raw would deliver by template the demotion §2.1a refused.
    match decision {
        SeverityDecision::Promoted { from, to, .. } => lines.push(promotion_note(
            *from,
            *to,
            analysis.completed_at.unwrap_or_default(),
            &verdict.page_recommendation.reason,
        )),
        // §6: a promotion the team turned off is still the agent's judgement
        // and belongs on the page — they are the ones who can act on it.
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

/// Whether a channel can revise a message it has already delivered.
///
/// §5.1: on chat, push and in-app the findings fill in **the same message**
/// rather than arriving as a second notification. Email and SMS cannot be
/// revised, so on those a verdict rides the one follow-up update instead —
/// which is why the update has to be ledger-deduped and the edit does not.
pub fn updates_in_place(channel: Channel) -> bool {
    match channel {
        Channel::Chat | Channel::Push | Channel::InApp => true,
        // Once an email or an SMS has gone, the finding cannot be taken back,
        // which is why the follow-up update — not the edit — is the thing that
        // has to be ledger-deduped.
        Channel::Email | Channel::Sms | Channel::Voice | Channel::Webhook => false,
    }
}

/// Whether the verdict reached the responder before they acknowledged.
///
/// The headline metric — how often the human's page already contained the
/// answer. Written as a function because the comparison is the whole of it, and
/// an inverted one silently inflates the number that justifies the feature.
pub fn verdict_beat_the_ack(verdict_at: Option<i64>, acked_at: i64) -> bool {
    // Strictly before: landing at the same instant did not brief anybody, and
    // a non-strict comparison quietly inflates the number the programme is
    // judged on.
    verdict_at.is_some_and(|at| at < acked_at)
}

/// Whether a suppressed firing coming back counts against the suppression.
///
/// The trust metric behind `oncall_l0_false_suppress_total`: a suppressed
/// subject that re-fired at **or above** its original severity within 24 hours.
/// If this is not ~zero, teams should not enable suppression and the UI should
/// say so next to the toggle.
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
    // At **or above**: a suppressed P3 coming back as a P3 is exactly the case
    // the trust metric exists to count.
    refired_severity == suppressed_severity || refired_severity.is_more_urgent_than(suppressed_severity)
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

    // -----------------------------------------------------------------
    // §4 — the policy block
    // -----------------------------------------------------------------

    /// Every knob in §4's table, by value. The defaults are the whole reason
    /// nobody has to configure L0 to benefit from it, so a silent edit to one
    /// of them changes the behaviour of every team that never opened the
    /// screen — which is most of them.
    #[test]
    fn test_l0_defaults_match_the_published_knob_table() {
        let d = L0Policy::defaults();
        assert_eq!(d.mode.p1, L0Mode::Parallel, "P1 runs alongside the page");
        assert_eq!(d.mode.p2, L0Mode::Gate, "P2 is where the pages are");
        assert_eq!(d.mode.p3, L0Mode::Gate);
        assert_eq!(d.mode.p4, L0Mode::Only, "P4 investigates and pages nobody");
        assert_eq!(d.triage_budget_seconds, 90);
        assert!(d.allow_promotion, "the capability that pays for L0");
        assert_eq!(d.max_promotion_steps, 2, "a P4 cannot become a P1 in one hop");
        assert!(d.allow_downgrade);
        assert!(
            !d.allow_suppress,
            "suppression is opt-in; one missed real page costs more trust than a quarter of noise reduction buys"
        );
        assert_eq!(d, shipped(), "the defaults are §4's table, cell for cell");
        d.validate().unwrap();
    }

    /// "The invariant is not a setting." Refusing it at write time is not
    /// enough — rows arrive from replication and from hands on a database — so
    /// the read path has to refuse it too, and a P1 held behind a model must be
    /// impossible to express at all.
    #[test]
    fn test_p1_is_parallel_even_when_a_stored_policy_says_otherwise() {
        for forbidden in [L0Mode::Gate, L0Mode::Only] {
            let p = raw(forbidden, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, true, false);
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
            assert_eq!(
                first_page_at(&p, P1, FIRED_AT, AnalysisStatus::Pending, None),
                Some(FIRED_AT)
            );
        }
        assert!(
            L0Error::P1MustBeParallel(L0Mode::Gate)
                .to_string()
                .contains("P1"),
            "the message has to name the field somebody just tried to set"
        );
    }

    /// 30 seconds is shorter than any useful hold and 600 is where "the page is
    /// late" becomes "the pager is broken". The bound is inclusive at both
    /// ends; an off-by-one here is a team that cannot save the value the UI
    /// shows them.
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

    /// A row that got past validation — replication, a migration, a hand-edit —
    /// must not be able to produce an unbounded hold. An unbounded hold is a
    /// page that never happens, which is the worst outcome this system has.
    #[test]
    fn test_a_budget_outside_the_bound_is_clamped_when_it_is_read() {
        let cases = [
            (90_i64, 90 * SECOND),
            (MIN_TRIAGE_BUDGET_SECONDS, MIN_TRIAGE_BUDGET_SECONDS * SECOND),
            (MAX_TRIAGE_BUDGET_SECONDS, MAX_TRIAGE_BUDGET_SECONDS * SECOND),
            (0, MIN_TRIAGE_BUDGET_SECONDS * SECOND),
            (-1, MIN_TRIAGE_BUDGET_SECONDS * SECOND),
            (i64::MIN, MIN_TRIAGE_BUDGET_SECONDS * SECOND),
            (100_000, MAX_TRIAGE_BUDGET_SECONDS * SECOND),
            (i64::MAX, MAX_TRIAGE_BUDGET_SECONDS * SECOND),
        ];
        for (stored, want) in cases {
            let mut p = shipped();
            p.triage_budget_seconds = stored;
            assert_eq!(
                p.triage_budget_micros(),
                want,
                "a stored budget of {stored}s must read back as {want}us"
            );
        }
    }

    /// `only` means "nobody is ever paged at this severity", which is a
    /// statement about P4 and P5 and nothing else. A stored `only` on a paging
    /// severity would silence it permanently, so it is read as the safest thing
    /// it could have meant.
    #[test]
    fn test_only_mode_outside_p4_is_read_as_parallel() {
        let p = raw(L0Mode::Parallel, L0Mode::Only, L0Mode::Only, L0Mode::Only, 90, true, 2, true, false);
        for pr in [P1, P2, P3] {
            assert_eq!(p.mode_for(pr), L0Mode::Parallel, "{pr} still has to page");
            assert_eq!(
                first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Pending, None),
                Some(FIRED_AT),
                "{pr} must not be silenced by a mode that does not apply to it"
            );
        }
        for pr in [P4, P5] {
            assert_eq!(p.mode_for(pr), L0Mode::Only);
        }
    }

    /// The other direction of the same defence. `mode_for` was pinned only
    /// against a stored `only` on a paging severity; a stored `gate` on P4 is
    /// the mirror, and the obvious implementation — read the field — puts a
    /// firing that pages nobody into a 90-second hold and inserts the trigger
    /// row §3 says a P4 never gets.
    ///
    /// It also splits implementers: deriving P4's answer from `mode_for` and
    /// deriving it from `severity_pages` both satisfy every other test, and
    /// only the second is right. Pinned here so they cannot diverge.
    #[test]
    fn test_p4_and_p5_are_agent_only_even_when_a_stored_policy_gates_them() {
        for forbidden in [L0Mode::Gate, L0Mode::Parallel] {
            let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, forbidden, 90, true, 2, true, false);
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
                assert_eq!(
                    first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Pending, None),
                    None,
                    "{pr} woke somebody"
                );
            }
        }
        assert!(
            L0Error::P4MustBeAgentOnly(L0Mode::Gate)
                .to_string()
                .contains("P4"),
            "the message has to name the field somebody just tried to set"
        );
        // The two guards are about different severities and must not be
        // confused for one another.
        let p1_wrong = raw(L0Mode::Gate, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, true, false);
        assert_eq!(p1_wrong.validate(), Err(L0Error::P1MustBeParallel(L0Mode::Gate)));
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
            "\"P1\"", "\"P2\"", "\"P3\"", "\"P4\"", "triage_budget_seconds",
            "allow_promotion", "max_promotion_steps", "allow_downgrade", "allow_suppress",
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

    // -----------------------------------------------------------------
    // §2.1a — the ratchet. The tests that must never be weakened.
    // -----------------------------------------------------------------

    /// Every `(current, suggestion)` pair across P1-P5, plus "no suggestion",
    /// with the shipped `max_promotion_steps` of 2. This is the whole of
    /// §2.1a's table written out: the diagonal and everything below it is
    /// discarded, everything above it promotes, and a promotion of more than
    /// two rungs is clamped to two.
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

        // Four cells written out by hand, going through no helper at all, so
        // the table above cannot be right for the same wrong reason the code
        // is. P1 is the top of the scale: nothing promotes it, ever.
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
            SeverityDecision::Promoted { from: P3, to: P2, requested: P2 }
        );
        assert_eq!(
            ratchet(P5, Some(P4), &p),
            SeverityDecision::Promoted { from: P5, to: P4, requested: P4 }
        );
        assert_eq!(
            ratchet(P2, Some(P5), &p),
            SeverityDecision::Discarded { current: P2, requested: P5 }
        );
    }

    /// The invariant, stated directly and checked over every input this
    /// function has: promotion, refusal, clamping, an absent suggestion, a
    /// bound of zero, a bound wider than the scale. Nothing produces a severity
    /// less urgent than the one the rule assigned.
    ///
    /// This is the test enforcing §2.1a against a model that can change under
    /// us, and it must never be weakened.
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
                        // The same claim on the raw ids. Lower integer is more
                        // urgent, so the applied id may only go down or stay —
                        // this is the form an inverted comparison fails.
                        assert!(
                            applied.to_i32() <= current.to_i32(),
                            "applied id rose (= got quieter): {why}"
                        );
                        // A promotion is a promotion, structurally: `to` is
                        // always strictly more urgent than `from`, so a clamp
                        // that lands back on the current severity cannot be
                        // reported as one.
                        if let SeverityDecision::Promoted { from, to, requested } = decision {
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
                        // The other half of the obligation, so "never lower" is
                        // not satisfied by never doing anything: when a real
                        // promotion is asked for, allowed, and inside a bound
                        // that leaves room for it, it has to happen.
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

    /// The bug this pins, and the only reason the ratchet needs a test at all:
    /// `AlertPriority::to_i32()` is P1=1..P5=5, so a bare `suggestion > current`
    /// on the raw ids reads P4 (4) > P2 (2) as a promotion and quietly demotes a
    /// P2 to a P4. Written out as its own case because the exhaustive table
    /// above would still pass if somebody reduced it to the diagonal.
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
                &complete(FIRED_AT, FIRED_AT + SECOND, verdict(PageAction::Page, Some(P4))),
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

    /// The diagonal. A suggestion equal to the current severity is not a
    /// promotion and must not read as one — it is the case a model produces
    /// most often, and treating it as a promotion would write a
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

    /// §4's own worked sentence: "P3 → P1 is allowed; P4 → P1 is clamped to P2
    /// and logged." Both levels have to survive into the decision so the
    /// timeline can show what the agent asked for beside what it got.
    #[test]
    fn test_p3_to_p1_is_allowed_and_p4_to_p1_is_clamped_to_p2() {
        let p = shipped();
        assert_eq!(
            ratchet(P3, Some(P1), &p),
            SeverityDecision::Promoted {
                from: P3,
                to: P1,
                requested: P1
            },
            "two rungs is exactly the bound, not one past it"
        );
        assert_eq!(
            ratchet(P4, Some(P1), &p),
            SeverityDecision::Promoted {
                from: P4,
                to: P2,
                requested: P1
            },
            "clamped to the bound and applied, with the request kept"
        );
        assert_eq!(
            ratchet(P5, Some(P1), &p),
            SeverityDecision::Promoted {
                from: P5,
                to: P3,
                requested: P1
            }
        );
        // A clamp is not a demotion attempt: it must not move the counter that
        // is supposed to read ~0 and mean "prompt regression".
        assert!(!ratchet(P4, Some(P1), &p).was_demotion_attempt());
    }

    /// The bound is a **number**, not a switch between "none" and "the
    /// default". Pinned only at 0 and 2, `let bound = if steps == 0 { 0 } else { 2 }`
    /// passes everything — and a team that narrowed its blast radius to one
    /// rung, which is the whole reason the knob is a number, is silently
    /// overridden and gets the two-rung jump it explicitly refused.
    ///
    /// Exact expected values at every bound the scale can express, so the
    /// clamp arithmetic is pinned rather than merely bracketed.
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
            let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, steps, true, false);
            assert_eq!(
                ratchet(current, Some(requested), &p),
                SeverityDecision::Promoted {
                    from: current,
                    to: want,
                    requested
                },
                "bound {steps}: {current} asked to become {requested}"
            );
        }
        // The bound never invents a promotion that was not asked for.
        for steps in 1u8..=5 {
            let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, steps, true, false);
            assert_eq!(
                ratchet(P3, Some(P4), &p),
                SeverityDecision::Discarded {
                    current: P3,
                    requested: P4
                },
                "bound {steps} turned a demotion into something else"
            );
        }
        // Widening the bound must move the answer. A bound that is really a
        // constant makes these equal.
        let one = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 1, true, false);
        let three = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 3, true, false);
        assert_ne!(
            ratchet(P4, Some(P1), &one).applied(),
            ratchet(P4, Some(P1), &three).applied()
        );
    }

    /// A bound of zero can only mean "no promotions", and the clamp would
    /// otherwise land on the current severity and be reported as a promotion to
    /// itself — a `SeverityPromoted{P3 → P3}` line and a page for nothing.
    #[test]
    fn test_a_clamp_that_lands_on_the_current_severity_is_not_a_promotion() {
        let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 0, true, false);
        assert_eq!(
            ratchet(P3, Some(P1), &p),
            SeverityDecision::Refused {
                current: P3,
                requested: P1
            }
        );
        assert_eq!(ratchet(P3, Some(P1), &p).applied(), P3);
    }

    /// With promotion turned off the recommendation is still recorded and still
    /// rendered on the page — the team asked not to be re-paged, not to be kept
    /// in the dark.
    #[test]
    fn test_promotion_is_refused_but_still_recorded_when_the_team_turned_it_off() {
        let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, false, 2, true, false);
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
        // And a demotion attempt is still a demotion attempt, whatever the
        // promotion knob says — the ratchet is not a team preference.
        assert_eq!(
            ratchet(P2, Some(P3), &p),
            SeverityDecision::Discarded {
                current: P2,
                requested: P3
            }
        );

        // §6's other half for this row: the recommendation is "recorded and
        // rendered **on the page**". A responder whose team turned promotion
        // off is exactly the person who needs to read "the agent thinks this is
        // a P2, and here is why" — they are the one who can act on it.
        let v = verdict(PageAction::Page, Some(P2));
        let rendered = verdict_lines(
            &complete(FIRED_AT, FIRED_AT + 4 * SECOND, v.clone()),
            &d,
        )
        .join("\n");
        assert!(
            rendered.contains("P2"),
            "the severity the agent asked for is on the page: {rendered}"
        );
        assert!(
            rendered.contains(&v.page_recommendation.reason),
            "and so is why it asked: {rendered}"
        );
    }

    // -----------------------------------------------------------------
    // §1, §3 — the gate
    // -----------------------------------------------------------------

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
        let p = raw(L0Mode::Parallel, L0Mode::Parallel, L0Mode::Parallel, L0Mode::Only, 90, true, 2, true, true);
        p.validate().unwrap();
        for pr in [P2, P3] {
            assert_eq!(gate_plan(&p, pr, &pending(FIRED_AT), FIRED_AT), GatePlan::Parallel);
            assert_eq!(
                first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Pending, None),
                Some(FIRED_AT),
                "{pr} in parallel mode pages at t=0"
            );
        }
        // And loses the suppression branch: the page has already gone out.
        let v = verdict(PageAction::Suppress, None);
        assert_eq!(
            first_page_at(&p, P2, FIRED_AT, AnalysisStatus::Complete, Some((&v, FIRED_AT + SECOND))),
            Some(FIRED_AT),
            "a Suppress verdict cannot un-send a page that already went"
        );
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
                assert_eq!(
                    first_page_at(&p, pr, FIRED_AT, status, None),
                    Some(FIRED_AT),
                    "{pr} with analysis {status:?} pages exactly as it does today"
                );
            }
            for pr in [P4, P5] {
                assert_eq!(gate_plan(&p, pr, &dead(status, FIRED_AT), FIRED_AT), GatePlan::L0Only);
            }
        }
    }

    /// **The knob has to reach the thing that pages people.** Every other gate
    /// test runs at the default 90 s, so two wrong implementations survive
    /// them: one that hardcodes `anchor + 90_000_000` and ignores the setting
    /// entirely, and one that reads `triage_budget_seconds` raw and skips the
    /// clamp.
    ///
    /// The second is the dangerous one. A row carrying `i64::MAX` — from
    /// replication, a migration, or a hand-edit — produces a `fire_at` that
    /// overflows or sits past any clock the process will ever see, and the
    /// TRIAGE row never fires. Nobody is paged, ever, and nothing logs an
    /// error. The clamp is asserted on the accessor elsewhere; this asserts it
    /// on the path that wakes somebody.
    #[test]
    fn test_the_configured_triage_budget_is_the_one_that_gates() {
        // (stored seconds, the hold it must actually produce)
        let cases = [
            (MIN_TRIAGE_BUDGET_SECONDS, MIN_TRIAGE_BUDGET_SECONDS * SECOND),
            (45, 45 * SECOND),
            (90, 90 * SECOND),
            (300, 300 * SECOND),
            (MAX_TRIAGE_BUDGET_SECONDS, MAX_TRIAGE_BUDGET_SECONDS * SECOND),
            // Out of bounds: clamped on the paging path, not merely on the getter.
            (0, MIN_TRIAGE_BUDGET_SECONDS * SECOND),
            (-1, MIN_TRIAGE_BUDGET_SECONDS * SECOND),
            (i64::MIN, MIN_TRIAGE_BUDGET_SECONDS * SECOND),
            (100_000, MAX_TRIAGE_BUDGET_SECONDS * SECOND),
            (i64::MAX, MAX_TRIAGE_BUDGET_SECONDS * SECOND),
        ];
        for (stored, hold) in cases {
            let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, stored, true, 2, true, false);
            let deadline = FIRED_AT + hold;
            for pr in [P2, P3] {
                assert_eq!(
                    gate_plan(&p, pr, &pending(FIRED_AT), FIRED_AT),
                    GatePlan::Gate { fire_at: deadline },
                    "{pr}: a stored budget of {stored}s must hold for {hold}us"
                );
                assert_eq!(
                    first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Pending, None),
                    Some(deadline),
                    "{pr}: a stored budget of {stored}s must page at {deadline}"
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
                // Whatever was stored, the page happens at a real instant that
                // a clock will reach. This is the assertion an unclamped
                // multiplication cannot satisfy.
                assert!(
                    deadline > FIRED_AT && deadline - FIRED_AT <= MAX_TRIAGE_BUDGET_SECONDS * SECOND,
                    "{pr}: a stored {stored}s produced a hold of {}us",
                    deadline - FIRED_AT
                );
            }
            // And a verdict inside the configured hold still ends it early.
            let v = verdict(PageAction::Page, None);
            let early = FIRED_AT + hold / 2;
            assert_eq!(
                first_page_at(&p, P2, FIRED_AT, AnalysisStatus::Complete, Some((&v, early))),
                Some(early),
                "{stored}s: a verdict inside the hold ends it"
            );
        }

        // Two teams, two budgets, same firing instant: the gate must tell them
        // apart. A hardcoded 90 makes these equal.
        let short = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 30, true, 2, true, false);
        let long = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 600, true, 2, true, false);
        assert_ne!(
            gate_plan(&short, P2, &pending(FIRED_AT), FIRED_AT),
            gate_plan(&long, P2, &pending(FIRED_AT), FIRED_AT),
            "two teams with different budgets got the same deadline"
        );
    }

    /// §6, last-but-one row: a node dying mid-TRIAGE re-queues the row and the
    /// budget resumes from the persisted deadline. If the deadline were
    /// recomputed from the wall clock, every crash would silently extend the
    /// hold — and a flapping node would extend it forever.
    #[test]
    fn test_the_hold_deadline_is_anchored_on_the_request_not_on_the_wall_clock() {
        let p = shipped();
        let state = pending(FIRED_AT);
        let deadline = FIRED_AT + 90 * SECOND;
        // The same row, recomputed at four different instants after a re-queue.
        for later in [FIRED_AT, FIRED_AT + SECOND, FIRED_AT + 60 * SECOND, FIRED_AT + 3_600 * SECOND] {
            assert_eq!(
                gate_plan(&p, P2, &state, later),
                GatePlan::Gate { fire_at: deadline },
                "a re-queue at {later} moved the deadline"
            );
        }
        // A firing whose analysis has not been requested yet has nothing else
        // to anchor on, so it anchors on the firing.
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

    // -----------------------------------------------------------------
    // §1 — timing. The invariant that "is not a setting".
    // -----------------------------------------------------------------

    /// The P1 invariant, measured. Level 1 dispatches at t=0 for every verdict
    /// arrival time — including one ten minutes late, which is longer than the
    /// entire budget — for every action the agent can recommend, including a
    /// Suppress from a team that opted in, and for every analysis status.
    ///
    /// This is the one failure mode that would end the programme: a critical
    /// page a model delayed.
    #[test]
    fn test_p1_dispatch_time_does_not_move_when_the_agent_is_ten_minutes_late() {
        // Suppression and promotion both enabled, so nothing here is prevented
        // by a knob rather than by the invariant.
        let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, true, true);
        let delays = [0, SECOND, 89 * SECOND, 90 * SECOND, 91 * SECOND, 600 * SECOND];
        for action in PageAction::ALL {
            for suggestion in [None, Some(P1)] {
                let v = verdict(action, suggestion);
                for delay in delays {
                    assert_eq!(
                        first_page_at(&p, P1, FIRED_AT, AnalysisStatus::Complete, Some((&v, FIRED_AT + delay))),
                        Some(FIRED_AT),
                        "P1 with a {action} verdict {delay}us late did not page at t=0"
                    );
                }
            }
        }
        for status in AnalysisStatus::ALL {
            assert_eq!(
                first_page_at(&p, P1, FIRED_AT, status, None),
                Some(FIRED_AT),
                "P1 with analysis {status:?} and no verdict did not page at t=0"
            );
        }
    }

    /// The gate's ceiling, over every input that can reach it. The hold cannot
    /// make a page late: whenever a gated firing pages at all, it pages within
    /// the triage budget of the firing.
    #[test]
    fn test_a_gated_page_fires_at_most_the_triage_budget_after_the_firing() {
        let budget = 90 * SECOND;
        for allow_suppress in [true, false] {
            let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, true, allow_suppress);
            for pr in [P2, P3] {
                for action in PageAction::ALL {
                    for suggestion in [None, Some(P1), Some(P2), Some(P5)] {
                        let v = verdict(action, suggestion);
                        let arrivals = [
                            None,
                            Some(FIRED_AT),
                            Some(FIRED_AT + SECOND),
                            Some(FIRED_AT + budget - 1),
                            Some(FIRED_AT + budget),
                            Some(FIRED_AT + budget + 1),
                            Some(FIRED_AT + 10 * 60 * SECOND),
                        ];
                        for at in arrivals {
                            let status = if at.is_some() {
                                AnalysisStatus::Complete
                            } else {
                                AnalysisStatus::Pending
                            };
                            let arg = at.map(|t| (&v, t));
                            let got = first_page_at(&p, pr, FIRED_AT, status, arg);
                            // The only way a gated firing pages nobody is a
                            // Suppress the team opted into, landing inside the
                            // hold, on a verdict that did not also promote.
                            // Anything else must produce a page — otherwise
                            // "at most the budget" is satisfied by silence.
                            let suppressible = allow_suppress
                                && action == PageAction::Suppress
                                && suggestion.is_none_or(|s| !s.is_more_urgent_than(pr))
                                && at.is_some_and(|t| t < FIRED_AT + budget);
                            if !suppressible {
                                assert!(
                                    got.is_some(),
                                    "{pr}/{action}, verdict at {at:?}, suggestion {suggestion:?}, suppress={allow_suppress}: nobody was paged at all"
                                );
                            }
                            if let Some(page_at) = got {
                                assert!(
                                    page_at >= FIRED_AT,
                                    "{pr}/{action} paged before it fired"
                                );
                                assert!(
                                    page_at - FIRED_AT <= budget,
                                    "{pr}/{action}, verdict at {at:?}, suggestion {suggestion:?}: paged {}us after the firing, past the {budget}us budget",
                                    page_at - FIRED_AT
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    /// "90s is a ceiling, not a wait." A verdict that lands in four seconds
    /// ends the hold in four seconds — that is the whole of §10.3, and a gate
    /// that always waited the full budget would make L0 a latency tax rather
    /// than a latency saving.
    #[test]
    fn test_a_verdict_ends_the_hold_the_moment_it_lands() {
        let p = shipped();
        let v = verdict(PageAction::Page, None);
        for pr in [P2, P3] {
            for at in [FIRED_AT, FIRED_AT + 4 * SECOND, FIRED_AT + 89 * SECOND] {
                assert_eq!(
                    first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Complete, Some((&v, at))),
                    Some(at),
                    "{pr}: a verdict at {at} did not end the hold"
                );
            }
        }
        // A Downgrade ends the hold too. It is still a page — quieter channels,
        // same instant — and treating it as "not a Page" is how a firing the
        // agent answered in four seconds waits the full budget anyway.
        let quiet = verdict(PageAction::Downgrade, None);
        for allow_downgrade in [true, false] {
            let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, allow_downgrade, false);
            for pr in [P2, P3] {
                assert_eq!(
                    first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Complete, Some((&quiet, FIRED_AT + 4 * SECOND))),
                    Some(FIRED_AT + 4 * SECOND),
                    "{pr}: a downgrade with allow_downgrade={allow_downgrade} did not end the hold"
                );
            }
        }
        // And a Suppress a team has not opted into ends it as well: the
        // recommendation is refused, so the page it was trying to stop happens
        // now rather than at the budget.
        let hushed = verdict(PageAction::Suppress, None);
        assert_eq!(
            first_page_at(&p, P3, FIRED_AT, AnalysisStatus::Complete, Some((&hushed, FIRED_AT + 4 * SECOND))),
            Some(FIRED_AT + 4 * SECOND)
        );
    }

    /// The three integration cases §9 names, at the boundary. The deadline
    /// itself belongs to the hold expiring, not to the verdict: a verdict that
    /// lands at exactly `fired_at + budget` is racing a page that has already
    /// been decided, and the page wins.
    #[test]
    fn test_a_verdict_after_the_hold_expires_does_not_delay_the_page() {
        let p = shipped();
        let deadline = FIRED_AT + 90 * SECOND;
        let v = verdict(PageAction::Page, None);
        for pr in [P2, P3] {
            assert_eq!(
                first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Complete, Some((&v, deadline - 1))),
                Some(deadline - 1),
                "{pr}: a verdict one microsecond early still ends the hold early"
            );
            assert_eq!(
                first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Complete, Some((&v, deadline))),
                Some(deadline),
                "{pr}: at the deadline the page has already gone"
            );
            assert_eq!(
                first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Complete, Some((&v, deadline + 60 * SECOND))),
                Some(deadline),
                "{pr}: a late verdict must not move the page it missed"
            );
            assert_eq!(
                first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Pending, None),
                Some(deadline),
                "{pr}: no verdict at all pages at the budget"
            );
        }
    }

    /// §7 of the required list: a P4 or P5 records its verdict, ends in
    /// `triaged`, and never inserts a trigger row or wakes anybody — for every
    /// action, including a `Page` recommendation. The agent cannot page a P4 by
    /// asking; it can only stop the firing being a P4, which is the next test.
    #[test]
    fn test_p4_and_p5_record_a_verdict_and_page_nobody() {
        for allow_suppress in [true, false] {
            let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, true, allow_suppress);
            for pr in [P4, P5] {
                for action in PageAction::ALL {
                    let v = verdict(action, None);
                    let at = FIRED_AT + 4 * SECOND;
                    assert_eq!(
                        gate_plan(&p, pr, &complete(FIRED_AT, at, v.clone()), FIRED_AT),
                        GatePlan::L0Only,
                        "{pr}/{action} must insert no trigger row"
                    );
                    assert_eq!(
                        first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Complete, Some((&v, at))),
                        None,
                        "{pr}/{action} paged somebody"
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

    /// The one mechanism by which a held severity reaches a human early, and
    /// §10.4's whole argument: the rule "a P4 does not page" is not overridden,
    /// the firing stops being a P4. §4 says so directly — "P4 → P1 is clamped
    /// to P2" only means anything if a promoted P4 can then page.
    #[test]
    fn test_a_promoted_p4_pages_because_it_is_no_longer_a_p4() {
        let p = shipped();
        let at = FIRED_AT + 4 * SECOND;
        let v = verdict(PageAction::Page, Some(P2));
        assert_eq!(
            first_page_at(&p, P4, FIRED_AT, AnalysisStatus::Complete, Some((&v, at))),
            Some(at),
            "a P4 the agent proved was a P2 has to reach somebody"
        );
        assert_eq!(
            apply_verdict(&p, &complete(FIRED_AT, at, v), P4, at),
            VerdictOutcome::Page {
                severity: P2,
                promoted_from: Some(P4),
                quieter_channels: false
            }
        );
        // Promoted only as far as another severity that pages nobody: still
        // nobody is paged.
        let to_p5 = verdict(PageAction::Page, Some(P5));
        assert_eq!(
            first_page_at(&p, P5, FIRED_AT, AnalysisStatus::Complete, Some((&to_p5, at))),
            None,
            "P5 suggested at P5 is not a promotion and pages nobody"
        );
    }

    // -----------------------------------------------------------------
    // §3, §4 — the verdict matrix
    // -----------------------------------------------------------------

    /// The mode × action × opt-in matrix §9 asks for, at a gated severity with
    /// the verdict inside the budget. The defaults are the interesting row:
    /// `allow_suppress` is false, so a Suppress verdict from a team that has
    /// not opted in still pages.
    #[test]
    fn test_the_verdict_matrix_over_action_and_opt_in() {
        let at = FIRED_AT + 4 * SECOND;
        // (allow_downgrade, allow_suppress, action, expected outcome at P3)
        let cases: [(bool, bool, PageAction, VerdictOutcome); 8] = [
            (true, false, PageAction::Page, VerdictOutcome::Page { severity: P3, promoted_from: None, quieter_channels: false }),
            (true, true, PageAction::Page, VerdictOutcome::Page { severity: P3, promoted_from: None, quieter_channels: false }),
            (true, false, PageAction::Downgrade, VerdictOutcome::Page { severity: P3, promoted_from: None, quieter_channels: true }),
            (false, false, PageAction::Downgrade, VerdictOutcome::Page { severity: P3, promoted_from: None, quieter_channels: false }),
            (true, true, PageAction::Suppress, VerdictOutcome::Suppress),
            (true, false, PageAction::Suppress, VerdictOutcome::Page { severity: P3, promoted_from: None, quieter_channels: false }),
            (false, true, PageAction::Suppress, VerdictOutcome::Suppress),
            (false, false, PageAction::Suppress, VerdictOutcome::Page { severity: P3, promoted_from: None, quieter_channels: false }),
        ];
        for (downgrade, suppress, action, want) in cases {
            let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, downgrade, suppress);
            let state = complete(FIRED_AT, at, verdict(action, None));
            assert_eq!(
                apply_verdict(&p, &state, P3, at),
                want,
                "downgrade={downgrade} suppress={suppress} action={action}"
            );
        }
    }

    /// The **mode** axis of §9's matrix, which the table above holds fixed at
    /// `gate`. §4: a team that sets `parallel` at P2 or P3 buys zero added
    /// latency "at the cost of the suppression branch" — the page has already
    /// gone out, so nothing a verdict says can call it back.
    ///
    /// The bug this catches is an implementation that decides on
    /// `action == Suppress && allow_suppress` without ever consulting
    /// `mode_for(severity)`. It passes the gated table completely, and it
    /// silences a P2 for a team that deliberately turned the gate off.
    #[test]
    fn test_a_parallel_severity_loses_the_suppression_and_downgrade_branches() {
        let at = FIRED_AT + 4 * SECOND;
        // Everything the team could possibly have opted into.
        let p = raw(L0Mode::Parallel, L0Mode::Parallel, L0Mode::Parallel, L0Mode::Only, 90, true, 2, true, true);
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
                assert_eq!(
                    first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Complete, Some((state.verdict.as_ref().unwrap(), at))),
                    Some(FIRED_AT),
                    "{pr}/{action}: parallel means t=0, whatever the verdict says"
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

    /// The default posture, stated on its own because it is the one a team gets
    /// without asking: until they enable it, a Suppress verdict is a
    /// recommendation on the timeline and the page still goes out.
    #[test]
    fn test_a_suppress_verdict_from_a_team_that_has_not_opted_in_still_pages() {
        let p = shipped();
        assert!(!p.allow_suppress);
        let at = FIRED_AT + 4 * SECOND;
        let state = complete(FIRED_AT, at, verdict(PageAction::Suppress, None));
        for pr in [P2, P3] {
            let outcome = apply_verdict(&p, &state, pr, at);
            assert!(outcome.pages_anyone(), "{pr} was silenced by default: {outcome:?}");
            assert_eq!(
                first_page_at(
                    &p,
                    pr,
                    FIRED_AT,
                    AnalysisStatus::Complete,
                    Some((state.verdict.as_ref().unwrap(), at))
                ),
                Some(at),
                "{pr}: the hold still ends when the verdict lands"
            );
        }
    }

    /// Suppression, when it is enabled, is silent but audited — and it is a
    /// verdict about *this* firing. Nothing here is a standing mute.
    #[test]
    fn test_suppression_only_applies_to_a_gated_firing_for_an_opted_in_team() {
        let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, true, true);
        let at = FIRED_AT + 4 * SECOND;
        let v = verdict(PageAction::Suppress, None);
        for pr in [P2, P3] {
            assert_eq!(apply_verdict(&p, &complete(FIRED_AT, at, v.clone()), pr, at), VerdictOutcome::Suppress);
            assert_eq!(first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Complete, Some((&v, at))), None);
        }
        // Not at P1, which is never gated by invariant.
        assert!(apply_verdict(&p, &complete(FIRED_AT, at, v.clone()), P1, at) != VerdictOutcome::Suppress);
        // And not at a P2 whose team chose `parallel` — gated by MODE, which is
        // the case a check on `allow_suppress` alone gets wrong.
        let parallel = raw(L0Mode::Parallel, L0Mode::Parallel, L0Mode::Gate, L0Mode::Only, 90, true, 2, true, true);
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

        // §4: a suppressed subject that re-fires re-enters the ladder at its
        // new severity. Suppression is a verdict about THIS firing, never a
        // standing mute — alert silencing already covers that — and the record
        // being keyed per firing is what makes it structurally impossible for
        // one verdict to quiet the next one.
        use super::super::subject::{SubjectRef, SubjectType};
        let firing = SubjectRef::new(SubjectType::Alert, "al_fds", 1);
        assert_ne!(
            firing.storage_key(),
            firing.next_firing().storage_key(),
            "the next firing is a different record, so it is a different decision"
        );
    }

    /// §2.1a's other half: `Downgrade` asks for a quieter channel set for one
    /// notification and never touches the recorded severity. Conflating the two
    /// is how "the agent can never demote" becomes false by a side door.
    #[test]
    fn test_a_downgrade_never_changes_the_recorded_severity() {
        let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, true, false);
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
                        assert_eq!(severity, pr, "{pr}: a downgrade moved the recorded severity");
                        assert_eq!(promoted_from, None);
                        assert!(quieter_channels, "{pr}: the downgrade was not applied");
                    }
                    other => panic!("{pr}: a downgrade must still page, got {other:?}"),
                }
            }
        }
    }

    /// A verdict that both promotes and asks for quiet is contradictory, and
    /// the safe reading is the loud one: the promotion is the part the engine
    /// verified, and §5.3 says a promoted page fires the higher severity's own
    /// channel set.
    #[test]
    fn test_a_promotion_outranks_a_suppress_or_downgrade_in_the_same_verdict() {
        let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, true, true);
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

    /// §3, the WAITING side. A verdict that arrives after the page rides as one
    /// follow-up update, not a second page — with the single exception of a
    /// promotion, which re-enters the ladder and pages the delta.
    #[test]
    fn test_a_verdict_that_lands_after_the_page_is_an_update_not_a_second_page() {
        let p = shipped();
        let late = FIRED_AT + 200 * SECOND;
        for pr in [P2, P3] {
            assert_eq!(
                apply_verdict(&p, &complete(FIRED_AT, late, verdict(PageAction::Page, None)), pr, late),
                VerdictOutcome::FollowUp { severity: pr },
                "{pr}: news arriving is not a reason to page again"
            );
            assert_eq!(
                apply_verdict(&p, &complete(FIRED_AT, late, verdict(PageAction::Page, Some(P1))), pr, late),
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
            apply_verdict(&p, &complete(FIRED_AT, FIRED_AT + SECOND, verdict(PageAction::Page, None)), P1, FIRED_AT + SECOND),
            VerdictOutcome::FollowUp { severity: P1 }
        );
    }

    /// The hold, before anything has landed. A gated firing with a live
    /// investigation waits — and waits until the deadline, not until some
    /// interval a tick happened to pick.
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
        // P1 never holds, whatever the clock says — and "not Hold" is not a
        // strong enough claim on its own, because `Page` and `FailOpen` would
        // both satisfy it while re-paging a firing that was already paged at
        // t=0. The investigation is still running and there is nothing for the
        // ladder to do.
        for now in [FIRED_AT, deadline - 1, deadline, deadline + 600 * SECOND] {
            assert_eq!(
                apply_verdict(&p, &pending(FIRED_AT), P1, now),
                VerdictOutcome::FollowUp { severity: P1 },
                "P1 with a live investigation at {now}"
            );
        }
    }

    /// §6, three rows at once: budget expiry, a missing or malformed verdict
    /// block, and a dead agent all reach the same place — the page the pre-L0
    /// system would have sent.
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
        // Failed and Skipped do not even wait for the deadline — no verdict is
        // coming, so holding for one is 90 seconds of nothing.
        for status in [AnalysisStatus::Failed, AnalysisStatus::Skipped] {
            assert_eq!(
                apply_verdict(&p, &dead(status, FIRED_AT), P2, FIRED_AT),
                VerdictOutcome::FailOpen { severity: P2 },
                "{status:?} must not hold a page for an answer that is not coming"
            );
        }
        // A run that finished and produced nothing the ladder can use is the
        // malformed-block case, and it has to read as a failure rather than as
        // "complete, so stop waiting and also never page".
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
            // And a run already known at the firing to have produced nothing is
            // not gated at all — there is no answer to wait for.
            assert_eq!(
                first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Complete, None),
                Some(FIRED_AT),
                "{pr}: a run with nothing to say must not hold the page"
            );
        }
        assert!(!AnalysisStatus::Failed.may_still_answer());
        assert!(!AnalysisStatus::Skipped.may_still_answer());
        assert!(!AnalysisStatus::Complete.may_still_answer());
        assert!(AnalysisStatus::Pending.may_still_answer());
    }

    /// §3, stated as an equality rather than as two lists that happen to agree:
    /// "the escalation engine treats `Skipped` and `Failed` identically". They
    /// arrive from different places — a disabled agent versus one that answered
    /// with rubbish — and the moment they diverge, one of the two stops being
    /// covered by the fail-open argument.
    #[test]
    fn test_a_failed_analysis_and_a_skipped_one_are_treated_identically() {
        let p = shipped();
        for pr in ALL {
            for now in [FIRED_AT, FIRED_AT + 45 * SECOND, FIRED_AT + 90 * SECOND, FIRED_AT + 600 * SECOND] {
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
            assert_eq!(
                first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Failed, None),
                first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Skipped, None),
                "{pr}: failed and skipped paged at different times"
            );
        }
    }

    /// §1: the hold is "shorter than the rung it sits inside" — under a third
    /// of P2's first escalation interval and a tenth of P3's. The default
    /// budget and the default ladder are edited in different files by different
    /// people, and the day the budget grows past the rung, the gate stops being
    /// a hold and starts being a missed escalation.
    #[test]
    fn test_the_triage_budget_stays_well_inside_the_rung_it_sits_in() {
        use super::super::policy::EscalationPolicy;
        let budget = shipped().triage_budget_micros();
        let policy = EscalationPolicy::default_for_team("p", "default", "t");
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
        // The configurable ceiling is deliberately NOT bounded by the rung: a
        // team may set 600s at P2, which is longer than P2's 5-minute first
        // escalation interval. That is the team's trade to make, and §4 says
        // so. What must never drift is the shipped default, above — the value
        // every team that never opened the screen is running.
        assert!(
            MAX_TRIAGE_BUDGET_SECONDS * SECOND > 5 * 60 * SECOND,
            "if this ever becomes false the comment above is stale, not the code"
        );
    }

    /// **The compound invariant of §6: removing the agent from the system
    /// reproduces today's behaviour exactly.**
    ///
    /// Every L0 code path is additive on top of a ladder that works without it,
    /// so with the analysis `Skipped` — RCA disabled, agent URL unset, health
    /// check failed, guard blocked the run — every severity behaves as it did
    /// before L0 existed: P1, P2 and P3 page at t=0, P4 and P5 page nobody,
    /// nothing is ever held, and no verdict changes any of it.
    #[test]
    fn test_removing_the_agent_reproduces_todays_behaviour_exactly() {
        for allow_suppress in [true, false] {
            for allow_promotion in [true, false] {
                let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, allow_promotion, 2, true, allow_suppress);
                let skipped = dead(AnalysisStatus::Skipped, FIRED_AT);
                for pr in ALL {
                    let today = if severity_pages(pr) { Some(FIRED_AT) } else { None };
                    assert_eq!(
                        first_page_at(&p, pr, FIRED_AT, AnalysisStatus::Skipped, None),
                        today,
                        "{pr} without an agent must page exactly as it does today"
                    );
                    assert_ne!(
                        gate_plan(&p, pr, &skipped, FIRED_AT),
                        GatePlan::Gate { fire_at: FIRED_AT + 90 * SECOND },
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

    /// §6's guard rows. L0 adds no new trigger path: every reason the existing
    /// RCA trigger declines to run is one state, `Skipped`, and `Skipped` means
    /// "behave exactly as today". Table-driven over the whole guard space, so a
    /// new guard that forgets to map to `Skipped` fails here.
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

    /// §10.3's trace, run through the decisions that produce it. The failure
    /// mode this whole design was stress-tested against — the causal signal
    /// fires at the lowest severity and the symptom fires at the highest — and
    /// the numbers in the document are the assertion.
    ///
    /// 02:14:00 a P3 fires and **nobody is paged**: a P3 at 2am must not wake
    /// anyone, and nothing in L0 changes that. 02:14:04 the verdict lands
    /// promoting it to P2, and what pages is a P2. The rule was never
    /// overridden; the firing stopped being a P3.
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
        assert_eq!(
            first_page_at(&p, P3, fired, AnalysisStatus::Complete, Some((&v, verdict_at))),
            Some(verdict_at),
            "the Platform primary is paged at 02:14:04, as a P2"
        );
        assert!(
            metrics_for(&p, &complete(fired, verdict_at, v), P3, verdict_at)
                .contains(&L0Metric::Promoted { from: P3, to: P2 })
        );

        // "Had the agent been down, the hold would have expired at 02:15:30 and
        // the P3 would have gone to its normal destination — i.e. still nobody
        // woken, exactly as today."
        assert_eq!(
            first_page_at(&p, P3, fired, AnalysisStatus::Pending, None),
            Some(fired + 90 * SECOND),
            "02:15:30"
        );
        assert_eq!(
            first_page_at(&p, P3, fired, AnalysisStatus::Skipped, None),
            Some(fired),
            "and with no agent at all, exactly as today"
        );

        // The 90-second hold cost nothing: the verdict landed in four seconds
        // and ended it.
        assert!(verdict_at - fired < p.triage_budget_micros());
    }

    /// §6's `Pending → Failed` transition, which nothing else models. A run
    /// that came back with an unusable block has finished; leaving it
    /// `Pending` makes every malformed report cost the full triage budget in
    /// latency, on a gate whose entire promise is that it does not.
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
            apply_verdict(&p, &dead(analysis_status_after_run(false), FIRED_AT), P2, FIRED_AT + SECOND),
            VerdictOutcome::FailOpen { severity: P2 }
        );
    }

    /// The gate is not the only thing a P4 skips: it has no hold to be in, so a
    /// P4 whose investigation is still running is not `Hold`, it is simply a
    /// firing nobody will be paged for either way.
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

    // -----------------------------------------------------------------
    // §8 — observability
    // -----------------------------------------------------------------

    /// `oncall_l0_severity_clamp_total` is the prompt-regression alarm: it
    /// counts attempted demotions and is expected to be ~0. A step-clamped
    /// promotion is a routine, safe event and must not appear on it, or the
    /// alarm reads as noise and stops being read at all.
    #[test]
    fn test_the_clamp_counter_moves_only_on_an_attempted_demotion() {
        let p = shipped();
        let at = FIRED_AT + 4 * SECOND;
        let count = |current: AlertPriority, suggestion: Option<AlertPriority>| {
            metrics_for(&p, &complete(FIRED_AT, at, verdict(PageAction::Page, suggestion)), current, at)
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
        assert!(
            count(P3, Some(P2)).contains(&L0Metric::Promoted { from: P3, to: P2 })
        );
    }

    /// "Only ever nonzero for opted-in teams" is the claim §8 makes about the
    /// suppression and downgrade counters, and it is the claim the trust
    /// argument rests on. A recommendation the engine did not honour must not
    /// appear as one it did.
    #[test]
    fn test_suppressed_and_downgraded_count_only_when_they_actually_happened() {
        let at = FIRED_AT + 4 * SECOND;
        let opted_out = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, false, false);
        let opted_in = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, true, true);

        let suppress = complete(FIRED_AT, at, verdict(PageAction::Suppress, None));
        let downgrade = complete(FIRED_AT, at, verdict(PageAction::Downgrade, None));

        assert!(!metrics_for(&opted_out, &suppress, P3, at).contains(&L0Metric::Suppressed));
        assert!(!metrics_for(&opted_out, &downgrade, P3, at).contains(&L0Metric::Downgraded));
        assert!(metrics_for(&opted_in, &suppress, P3, at).contains(&L0Metric::Suppressed));
        assert!(metrics_for(&opted_in, &downgrade, P3, at).contains(&L0Metric::Downgraded));

        // The recommendation is still counted in the volume/mix series in every
        // case: what the agent said and what the engine did are two questions.
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

    /// `oncall_l0_budget_expired_total` answers "is the agent too slow for the
    /// gate". A verdict that landed in time, or a run that never started, is
    /// not the agent being slow.
    #[test]
    fn test_budget_expiry_counts_only_when_no_verdict_landed_in_time() {
        let p = shipped();
        let deadline = FIRED_AT + 90 * SECOND;
        assert!(
            metrics_for(&p, &pending(FIRED_AT), P2, deadline).contains(&L0Metric::BudgetExpired)
        );
        assert!(
            !metrics_for(&p, &pending(FIRED_AT), P2, deadline - 1).contains(&L0Metric::BudgetExpired),
            "the hold has not expired yet"
        );
        assert!(
            !metrics_for(
                &p,
                &complete(FIRED_AT, FIRED_AT + 4 * SECOND, verdict(PageAction::Page, None)),
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
        let p = raw(L0Mode::Parallel, L0Mode::Gate, L0Mode::Gate, L0Mode::Only, 90, true, 2, true, true);
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

    // -----------------------------------------------------------------
    // §2.2 — the parser contract
    // -----------------------------------------------------------------

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

    /// The happy path, field by field — §10.3's own verdict. Every one of these
    /// fields is a line on the responder's card, and a field the parser drops
    /// is a line that silently disappears at 3am.
    #[test]
    fn test_a_valid_verdict_block_parses_every_field() {
        let content = report_with(GOLDEN_VERDICT);
        let parsed = parse_report(&content);
        assert_eq!(parsed.report, content, "the report is stored untouched");
        let v = parsed.verdict.expect("a valid block must parse");
        assert_eq!(v.probable_cause, "fd leak introduced by querier v0.14.2");
        assert_eq!(v.confidence, Confidence::High);
        let change = v.suspect_change.expect("the suspect change is the 'what changed' answer");
        assert_eq!(change.kind, ChangeKind::Deploy);
        assert_eq!(change.reference, "v0.14.2");
        assert_eq!(change.author.as_deref(), Some("dana"));
        assert_eq!(change.occurred_at, 1_699_978_400_000_000);
        assert_eq!(v.impacted_services, vec!["production/openobserve".to_string()]);
        assert_eq!(v.evidence_links.len(), 1);
        assert_eq!(v.evidence_links[0].url, "https://o2.example/short/x7h3k2");
        assert_eq!(v.page_recommendation.action, PageAction::Page);
        assert_eq!(v.page_recommendation.severity_suggestion, Some(P2));
        assert!(v.page_recommendation.reason.contains("22 min"));
        assert_eq!(v.proposed_actions.len(), 1);
        assert_eq!(v.proposed_actions[0].kind, ActionKind::Restart);
        assert_eq!(v.report_ref, "inc_9/rca/1");
    }

    /// §2.2, the sentence the whole parser exists to honour: "a malformed
    /// verdict can never lose a report or a page". Every way a model can get
    /// the block wrong, and in each the markdown still saves exactly as today
    /// and the firing still falls through to the fail-open page.
    #[test]
    fn test_a_malformed_verdict_block_loses_neither_the_report_nor_the_page() {
        let broken = [
            ("truncated json", "{ \"probable_cause\": \"fd leak\","),
            ("not json at all", "the cause is a file descriptor leak"),
            ("empty block", ""),
            ("json but not a verdict", "{ \"summary\": \"fd leak\" }"),
            ("missing page_recommendation", "{ \"probable_cause\": \"x\", \"confidence\": \"high\", \"report_ref\": \"r\" }"),
            ("unknown confidence band", "{ \"probable_cause\": \"x\", \"confidence\": \"very high\", \"page_recommendation\": { \"action\": \"page\", \"reason\": \"r\" }, \"report_ref\": \"r\" }"),
            ("unknown action", "{ \"probable_cause\": \"x\", \"confidence\": \"high\", \"page_recommendation\": { \"action\": \"ignore\", \"reason\": \"r\" }, \"report_ref\": \"r\" }"),
            ("a json array", "[1, 2, 3]"),
        ];
        let p = shipped();
        for (name, block) in broken {
            let content = report_with(block);
            let parsed = parse_report(&content);
            assert_eq!(parsed.report, content, "{name}: the report was altered");
            assert_eq!(parsed.verdict, None, "{name}: garbage parsed as a verdict");
            // And the firing still pages. The investigation started, so the
            // gate was armed; it produced nothing the ladder can use, so the
            // hold runs out and the page goes exactly as §6's budget-expiry row
            // says — no verdict ever arrived, as far as the ladder is
            // concerned.
            assert_eq!(
                first_page_at(&p, P3, FIRED_AT, AnalysisStatus::Pending, None),
                Some(FIRED_AT + 90 * SECOND),
                "{name}: the page was lost"
            );
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
    /// confabulation, and such a verdict still carries evidence and still
    /// recommends `Page`. A parser that treated it as a failure would turn the
    /// agent's honesty into a dropped verdict.
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
        let v = parse_report(&content).verdict.expect("unknown cause is legal");
        assert_eq!(v.probable_cause, "cause unknown");
        assert_eq!(v.confidence, Confidence::Low);
        assert_eq!(v.page_recommendation.action, PageAction::Page);
        assert_eq!(v.page_recommendation.severity_suggestion, None);
        assert!(!v.evidence_links.is_empty(), "it still says where it looked");
        assert!(v.suspect_change.is_none());
        assert!(v.proposed_actions.is_empty());
    }

    /// The block is written by a language model, so the field has to accept the
    /// form a model writes. `"P2"` is what the prompt asks for; the bare
    /// integer is the API's own spelling and is accepted rather than silently
    /// dropped — dropping it would be a promotion that never happened.
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
            assert_eq!(v.page_recommendation.severity_suggestion, want, "{spelling}");
        }
    }

    /// A severity outside the scale is not a severity. Rejecting the whole
    /// verdict rather than the one field is deliberate: half a verdict is a
    /// verdict whose paging recommendation was read from a value nobody
    /// checked, and §6 already has a safe answer for "no verdict".
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

    /// Idempotence at the parser: the agent re-running and emitting a second
    /// block must not leave the reader guessing which one the ladder used. The
    /// verdict is "the final section of the report", so the last block wins.
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

    // -----------------------------------------------------------------
    // §5 — what the notifications carry
    // -----------------------------------------------------------------

    /// §5.2: the follow-up "rides channel/push/email" and does not re-fire
    /// voice or SMS. Waking somebody twice — once because a human is needed and
    /// once because news arrived — is how a team learns that its urgent
    /// channels cry wolf, and then stops answering the ones that do not.
    ///
    /// §5.2 names three channels — "it rides channel/push/email" — so this is
    /// an allowlist. A denylist of the urgent ones passes the same happy path
    /// and quietly admits every channel this product adds later: the next
    /// transport to land would start carrying verdict updates because nobody
    /// wrote it down anywhere.
    ///
    /// The obvious shortcut, `!Channel::is_interrupting()`, is wrong twice
    /// over: it drops push, which §5.2 names, and it admits in-app and webhook,
    /// which §5.2 does not.
    #[test]
    fn test_a_verdict_update_rides_only_the_three_channels_the_design_names() {
        assert_eq!(
            update_channels(&[
                Channel::Email,
                Channel::Sms,
                Channel::Voice,
                Channel::Push,
                Channel::Chat,
                Channel::InApp,
                Channel::Webhook,
            ]),
            vec![Channel::Email, Channel::Push, Channel::Chat],
            "chat, push and email, in the order the policy wrote them"
        );
        assert!(update_channels(&[]).is_empty());
        assert!(
            update_channels(&[Channel::Sms, Channel::Voice]).is_empty(),
            "a team reachable only by phone gets no update rather than a second page"
        );
        assert_eq!(
            update_channels(&[Channel::Push]),
            vec![Channel::Push],
            "push interrupts and is still named in §5.2 — the two questions are different"
        );
        // Every channel the vocabulary has, decided one way or the other, so a
        // new variant cannot be admitted by omission.
        for c in [Channel::Email, Channel::Chat, Channel::Push] {
            assert_eq!(update_channels(&[c]), vec![c], "{c} is named in §5.2");
        }
        for c in [Channel::Voice, Channel::Sms, Channel::InApp, Channel::Webhook] {
            assert!(
                update_channels(&[c]).is_empty(),
                "{c} is not one of the three §5.2 names"
            );
        }
    }

    /// §3, the `Downgrade` branch: "NOTIFYING with quieter channels for THIS
    /// firing". The counter `oncall_l0_downgraded_total` claims a firing was
    /// notified more quietly, so something has to actually make it quieter —
    /// a flag that is computed, counted and never read is a metric that
    /// reports an event which did not happen.
    ///
    /// Quieter is "does not wake a sleeping person", which is exactly
    /// `is_interrupting`. This is the one place that predicate is right: §5.2's
    /// allowlist is about what an *update* may ride, and this is about how one
    /// page is delivered.
    #[test]
    fn test_a_downgrade_drops_the_channels_that_wake_somebody() {
        assert_eq!(
            quieter_channels(&[Channel::Email, Channel::Sms, Channel::Voice, Channel::Chat]),
            vec![Channel::Email, Channel::Chat],
            "the interrupting channels go, in policy order"
        );
        assert_eq!(
            quieter_channels(&[Channel::Push, Channel::InApp]),
            vec![Channel::InApp]
        );
        // **Fail open.** A rung that pages only by phone has no quieter form,
        // and "quieter" must never become "silent" — §2.1a's whole asymmetry is
        // that nothing a verdict says may cost somebody a page.
        for phone_only in [
            vec![Channel::Voice],
            vec![Channel::Sms],
            vec![Channel::Voice, Channel::Sms],
        ] {
            assert_eq!(
                quieter_channels(&phone_only),
                phone_only,
                "a downgrade silenced a rung that had no quieter channel"
            );
        }
        assert!(quieter_channels(&[]).is_empty(), "nothing in, nothing out");
    }

    /// §5.3: "the promotion reason is never dropped from the template". A
    /// responder woken by a machine's judgement is owed that judgement in the
    /// first line, and it is the sentence they will quote when deciding whether
    /// to trust the next one.
    #[test]
    fn test_a_promoted_page_always_carries_the_reason_it_was_promoted() {
        let reason = "predicted FD exhaustion in ~22 min";
        let note = promotion_note(P3, P2, FIRED_AT, reason);
        assert!(note.contains("P2"), "the severity it is now: {note}");
        assert!(note.contains("P3"), "the severity it was: {note}");
        assert!(note.contains("promoted"), "{note}");
        assert!(note.contains(reason), "the reason, verbatim: {note}");
        // §5.3 renders the instant too — "promoted from P3 at 02:14". A receipt
        // with no time on it cannot be lined up against the rest of the
        // timeline, which is the first thing a post-incident review does.
        // Asserted as "the instant reaches the output" rather than as a
        // format, so the rendering and the timezone stay the template's
        // business.
        let hour_later = promotion_note(P3, P2, FIRED_AT + 3_600 * SECOND, reason);
        assert_ne!(
            note, hour_later,
            "the promotion instant is not rendered at all: {note}"
        );
        // An empty reason must not produce a line that claims nothing.
        let bare = promotion_note(P4, P2, FIRED_AT, "");
        assert!(bare.contains("P4") && bare.contains("P2"), "{bare}");
    }

    /// "Templates degrade cleanly": an SMTP-only deployment with RCA disabled
    /// renders the current, pre-L0 messages byte-for-byte. Nothing is added
    /// when there is nothing to add — no "AI: n/a" line, no empty section.
    ///
    /// The same rendering is what every level ≥ 2 dispatch uses (§5.4), so an
    /// escalation target arrives briefed when there is a verdict and reads
    /// exactly as it does today when there is not.
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
        assert!(rendered.contains("v0.14.2"), "the suspect change: {rendered}");
        assert!(
            rendered.contains("Restart q-4, q-6, q-7"),
            "the suggestion is text on the page: {rendered}"
        );
    }

    /// §5.1: the first page beats the verdict at P1 and whenever a hold
    /// expires, and it says so — one line, with the deep link. Not a
    /// placeholder that gets superseded, and not silence that leaves a
    /// responder wondering whether anything is looking at this.
    /// The template is the last place §2.1a can be undone. A discarded
    /// demotion still carries `severity_suggestion: P4` on the verdict, and a
    /// renderer that prints the field raw puts "P4" on a page for a firing that
    /// is, and remains, a P2. The engine refused the demotion; the message must
    /// not deliver it anyway.
    ///
    /// The refused *promotion* is the opposite case and §6 requires it be
    /// rendered — so the two cannot be handled by the same blanket rule.
    #[test]
    fn test_a_refused_suggestion_is_not_rendered_as_though_it_had_been_applied() {
        let at = FIRED_AT + 4 * SECOND;

        // Discarded demotion: the level the agent asked for must not appear as
        // this page's severity.
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
        let lines = verdict_lines(&pending(FIRED_AT), &SeverityDecision::Unchanged { current: P2 });
        assert!(!lines.is_empty(), "a live investigation is worth one line");
        let rendered = lines.join("\n").to_lowercase();
        assert!(
            rendered.contains("investigation") || rendered.contains("investigating"),
            "the line has to say what is happening: {rendered}"
        );
    }

    /// §5.1: on channels that can revise a message, the findings fill in the
    /// same message rather than arriving as a second notification. On the ones
    /// that cannot, the verdict rides the single follow-up update — which is
    /// why that update, and not the edit, is the thing that has to be deduped.
    #[test]
    fn test_only_the_channels_that_can_revise_a_message_update_in_place() {
        for c in [Channel::Chat, Channel::Push, Channel::InApp] {
            assert!(updates_in_place(c), "{c} can revise what it already sent");
        }
        for c in [Channel::Email, Channel::Sms, Channel::Voice, Channel::Webhook] {
            assert!(
                !updates_in_place(c),
                "{c} cannot take a finding back once it has gone"
            );
        }
    }

    /// The headline metric §8 says justifies the feature. An inverted or
    /// non-strict comparison here does not break anything a user sees — it
    /// quietly inflates the one number the programme is judged on, which is
    /// worse.
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

    /// The trust metric. A suppressed firing that comes back worse is the whole
    /// argument against suppression, so the window and the direction both have
    /// to be right: 24 hours, and "at or above", not "above".
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

    /// The §11 boundary, enforced by the type rather than by a review comment:
    /// a `ProposedAction` is three strings. There is no `workflow_ref`, no
    /// `args`, no `reversible` and no `verify_signal`, so nothing downstream can
    /// read this field as anything other than display text.
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
        for forbidden in ["workflow_ref", "args", "reversible", "verify_signal", "grant"] {
            assert!(!object.contains_key(forbidden), "{forbidden} is not in scope");
        }
    }

    /// The verdict is persisted on the timeline and cached on the escalation
    /// state, so its stored shape is a contract. A field that stops round
    /// tripping is a responder card that loses a line after an upgrade.
    #[test]
    fn test_a_verdict_round_trips_through_json() {
        let v = verdict(PageAction::Downgrade, Some(P1));
        let back: AnalysisVerdict =
            serde_json::from_str(&serde_json::to_string(&v).unwrap()).unwrap();
        assert_eq!(back, v);

        // The optional halves are absent from the payload rather than null, so
        // a verdict with no suspect change does not render an empty row.
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
        assert_eq!(serde_json::from_str::<AnalysisVerdict>(&json).unwrap(), bare);
    }

    /// The analysis state rides `Trigger.data`, which the super cluster already
    /// replicates, so the surviving cluster has the verdict state. That only
    /// holds if the state serialises whole.
    #[test]
    fn test_the_analysis_state_round_trips_through_json() {
        let state = complete(FIRED_AT, FIRED_AT + 4 * SECOND, verdict(PageAction::Page, Some(P2)));
        let back: AnalysisState =
            serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(back, state);

        for status in AnalysisStatus::ALL {
            let json = serde_json::to_string(&status).unwrap();
            assert_eq!(serde_json::from_str::<AnalysisStatus>(&json).unwrap(), status);
        }
        // A skipped analysis is the common case and must not carry an empty
        // verdict object into the trigger row.
        let skipped = AnalysisState {
            status: AnalysisStatus::Skipped,
            verdict: None,
            requested_at: None,
            completed_at: None,
        };
        let json = serde_json::to_string(&skipped).unwrap();
        assert_eq!(json, r#"{"status":"skipped"}"#);
    }

    /// The wire spellings are what the prompt contract asks a model to emit and
    /// what the timeline stores. Renaming one breaks both at once, and the
    /// break is silent: the block stops parsing and the firing quietly falls
    /// back to the pre-L0 page.
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
