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

//! The response record — what happened, for one firing.
//!
//! One record per subject firing, holding the lifecycle state and a timeline.
//! It exists whether or not an incident was created, which is what lets
//! acknowledgement, notes, handoff and cause work for plain alerts,
//! synthetics and anomalies.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{policy::Channel, subject::SubjectRef};

/// The run a record's ladder starts on.
///
/// A record written before handoffs restarted the ladder carries no run at
/// all, and is on this one — so `None` and `Some(1)` mean the same thing and
/// must never be compared directly.
pub const FIRST_LADDER_RUN: i32 = 1;

/// The run a handoff moves a record onto.
///
/// Handing a page over starts the ladder again rather than resuming it: the
/// receiving responder has not been paged yet, and the rungs the previous one
/// climbed say nothing about whether the new one has answered.
pub fn next_ladder_run(current: Option<i32>) -> i32 {
    current.unwrap_or(FIRST_LADDER_RUN) + 1
}

/// The longest a page can be quieted for.
///
/// A day, which is longer than any shift. Snoozing does not claim the page, so
/// somebody who quiets one should not be able to keep it quiet past their own
/// tenure of it — whether the next person wants silence is their decision to
/// make.
pub const MAX_SNOOZE_MINUTES: i64 = 24 * 60;

/// When a snooze of `minutes` starting at `now` ends, or `None` if that is not
/// a snooze this product will make.
///
/// Bounded and checked, because the multiplication is the whole risk: the
/// number arrives from a request body, and `minutes * 60 * 1_000_000` runs off
/// the end of an i64 somewhere north of 150 000 years. A debug build panics
/// and drops the connection; a release build wraps, which is far worse — the
/// record goes quiet until an instant in the past or the impossibly far
/// future, and a live page is silenced by an integer.
pub fn snooze_until(now: i64, minutes: i64) -> Option<i64> {
    if !(1..=MAX_SNOOZE_MINUTES).contains(&minutes) {
        return None;
    }
    minutes
        .checked_mul(60 * 1_000_000)
        .and_then(|micros| now.checked_add(micros))
}

/// Lifecycle of a response record.
///
/// `triggered → triaged → acknowledged → resolved`, where `triaged` is
/// produced by the L0 agent and is skipped entirely when the agent is absent
/// or disabled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ResponseState {
    Triggered,
    Triaged,
    Acknowledged,
    Resolved,
}

/// Why this team was paged.
///
/// A database goes down and five services break. The owner fixes the
/// database; the impacted teams contain the blast radius on their own service
/// — confirm impact, fall back, own their customer surface. Different jobs, so
/// they get different records rather than sharing one, and each team acks and
/// resolves its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ResponderRole {
    Owner,
    Impacted,
}

impl ResponderRole {
    /// Durable storage id. **Never reorder or reuse.**
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Owner => 1,
            Self::Impacted => 2,
        }
    }

    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Owner),
            2 => Some(Self::Impacted),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Impacted => "impacted",
        }
    }
}

impl std::fmt::Display for ResponderRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// What a timeline entry records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ResponseEventKind {
    /// Engine bookkeeping: record opened, ladder advanced, timer fired.
    Sys,
    /// A notification was dispatched to somebody.
    Page,
    Ack,
    /// Free text written by a responder.
    Note,
    /// Agent or human root-cause analysis.
    Rca,
    /// Ownership passed from one responder to another.
    Handoff,
    /// The underlying condition cleared.
    Recovery,
    /// A lifecycle transition.
    State,
    /// The ladder ran out of rungs and nobody had acknowledged.
    ///
    /// Its own kind rather than a sentence inside a `Sys` entry because "this
    /// page was never answered by anyone" is the outcome the product most
    /// needs to be able to count.
    Exhausted,
    /// One page, to one person, on one channel.
    ///
    /// The machine-readable half of the ledger, and the reason a crash
    /// part-way through a rung does not re-page the people it already
    /// reached. Kept off the human timeline — a responder wants one legible
    /// "paged ana, bo" line, not a row per address.
    Delivery,
    /// The L0 agent's structured verdict for this firing.
    ///
    /// Its own kind rather than another `Rca` entry because this is the
    /// durable, auditable copy of a machine's *recommendation*, and "why was I
    /// not paged" has to be answerable from it.
    AiVerdict,
    /// A verdict raised this firing's severity.
    ///
    /// Written with the severity asked for beside the one applied, because a
    /// clamped promotion is two different facts and a responder woken by one is
    /// owed both.
    SeverityPromoted,
    /// The condition fired again so soon after recovering that the engine
    /// treated it as the same unstable firing and did not page.
    ///
    /// Its own kind rather than a `Sys` sentence because "this was dampened"
    /// is the one thing a smoothed record must not hide: the responder has to
    /// be able to see, on the record they were woken for, that the condition
    /// came back four more times and nobody was woken for those. A timeline
    /// that only shows the page it did send is a timeline that lies about what
    /// happened.
    Flapped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResponseError {
    /// The transition is not part of the lifecycle.
    IllegalTransition {
        from: ResponseState,
        to: ResponseState,
    },
}

impl ResponseState {
    /// Durable storage id. **Never reorder or reuse.**
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Triggered => 1,
            Self::Triaged => 2,
            Self::Acknowledged => 3,
            Self::Resolved => 4,
        }
    }

    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Triggered),
            2 => Some(Self::Triaged),
            3 => Some(Self::Acknowledged),
            4 => Some(Self::Resolved),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Triggered => "triggered",
            Self::Triaged => "triaged",
            Self::Acknowledged => "acknowledged",
            Self::Resolved => "resolved",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Resolved)
    }

    /// Whether the ladder should still be climbing.
    ///
    /// Acknowledged is deliberately NOT escalating — somebody took it, which
    /// is the whole point of the ladder — but it is still very much open. See
    /// `is_unresolved`; conflating the two loses acknowledged records.
    pub fn is_escalating(&self) -> bool {
        matches!(self, Self::Triggered | Self::Triaged)
    }

    /// Whether this is still somebody's problem.
    ///
    /// What the list and the action buttons ask. An acknowledged page has an
    /// owner and no ladder, and it still has to be closed by a human.
    pub fn is_unresolved(&self) -> bool {
        !self.is_terminal()
    }

    /// Lifecycle only moves forward, and every state can resolve directly.
    ///
    /// Forward-only matters because a record is written from several places —
    /// the engine, an ack link, a recovery signal — and a late-arriving event
    /// must never reopen something a human already closed.
    pub fn can_transition_to(&self, to: Self) -> bool {
        if self.is_terminal() {
            return false;
        }
        to.to_i32() > self.to_i32()
    }

    pub fn transition_to(&self, to: Self) -> Result<Self, ResponseError> {
        if self.can_transition_to(to) {
            Ok(to)
        } else {
            Err(ResponseError::IllegalTransition { from: *self, to })
        }
    }
}

impl ResponseEventKind {
    /// Durable storage id. **Never reorder or reuse.**
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Sys => 1,
            Self::Page => 2,
            Self::Ack => 3,
            Self::Note => 4,
            Self::Rca => 5,
            Self::Handoff => 6,
            Self::Recovery => 7,
            Self::State => 8,
            Self::Exhausted => 9,
            Self::Delivery => 10,
            Self::AiVerdict => 11,
            Self::SeverityPromoted => 12,
            Self::Flapped => 13,
        }
    }

    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Sys),
            2 => Some(Self::Page),
            3 => Some(Self::Ack),
            4 => Some(Self::Note),
            5 => Some(Self::Rca),
            6 => Some(Self::Handoff),
            7 => Some(Self::Recovery),
            8 => Some(Self::State),
            9 => Some(Self::Exhausted),
            10 => Some(Self::Delivery),
            11 => Some(Self::AiVerdict),
            12 => Some(Self::SeverityPromoted),
            13 => Some(Self::Flapped),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Sys => "sys",
            Self::Page => "page",
            Self::Ack => "ack",
            Self::Note => "note",
            Self::Rca => "rca",
            Self::Handoff => "handoff",
            Self::Recovery => "recovery",
            Self::State => "state",
            Self::Exhausted => "exhausted",
            Self::Delivery => "delivery",
            Self::AiVerdict => "ai_verdict",
            Self::SeverityPromoted => "severity_promoted",
            Self::Flapped => "flapped",
        }
    }

    /// True for entries a person wrote, as opposed to engine bookkeeping.
    /// The UI shows these by default and folds the rest away.
    pub fn is_human_authored(&self) -> bool {
        matches!(self, Self::Note | Self::Ack | Self::Handoff)
    }

    /// True for entries that exist only so the engine can dedup its own
    /// retries. They are not hidden — `list_deliveries` reads them — but they
    /// are kept off the timeline, because a rung that paged eight people on
    /// two channels is one line to a human and sixteen rows to the engine.
    pub fn is_ledger_only(&self) -> bool {
        matches!(self, Self::Delivery)
    }
}

/// One entry on a record's timeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ResponseEvent {
    pub kind: ResponseEventKind,
    /// Microseconds.
    pub at: i64,
    /// Email of the person, or a system actor like `o2-engine` / `o2-sre`.
    pub actor: String,
    pub body: String,
    /// The rung this page belongs to, as its delay from `opened_at`.
    ///
    /// This IS the delivery ledger: `plan` is handed the delays already sent
    /// and will not re-send them, which is what makes replays and retries
    /// safe. A delay survives a policy being reordered or renamed; a
    /// positional index would not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rung_micros: Option<i64>,
    /// The ladder run this page belongs to.
    ///
    /// A rung delay alone is not a ledger key once a page can change hands: a
    /// handoff restarts the ladder, and the previous owner's rung at +5m must
    /// not read as the new owner's rung at +5m having already fired. Absent
    /// means the first run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ladder_run: Option<i32>,
    /// Who a `Delivery` entry was addressed to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient: Option<String>,
    /// The channel it went out on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<Channel>,
    /// Whether the transport took it. `false` is a recorded failure, which is
    /// the answer to "did the page reach them" — not the absence of one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivered: Option<bool>,
}

impl ResponseEvent {
    pub fn new(
        kind: ResponseEventKind,
        at: i64,
        actor: impl Into<String>,
        body: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            at,
            actor: actor.into(),
            body: body.into(),
            rung_micros: None,
            ladder_run: None,
            recipient: None,
            channel: None,
            delivered: None,
        }
    }

    pub fn at_rung(mut self, rung_micros: i64) -> Self {
        self.rung_micros = Some(rung_micros);
        self
    }

    pub fn in_run(mut self, ladder_run: i32) -> Self {
        self.ladder_run = Some(ladder_run);
        self
    }

    /// Records who one page was addressed to and whether it landed.
    pub fn delivered_to(
        mut self,
        recipient: impl Into<String>,
        channel: Channel,
        delivered: bool,
    ) -> Self {
        self.recipient = Some(recipient.into());
        self.channel = Some(channel);
        self.delivered = Some(delivered);
        self
    }

    /// Marks a rung's own entry as one the transport lost outright.
    ///
    /// Written on the `Page` entry, beside the per-recipient `Delivery` rows
    /// that say which sends failed, and it carries the one fact the ladder
    /// cannot reconstruct from them: that this rung had real recipients and
    /// reached **none** of them. A rung that resolved to nobody deliberately
    /// does not get it — that rung is spent, and this one is not.
    pub fn reached_nobody(mut self) -> Self {
        self.delivered = Some(false);
        self
    }

    /// Whether this entry is a rung of `ladder_run` that was tried and lost to
    /// the transport, and so has not really been sent.
    pub fn is_unreached_rung(&self, ladder_run: i32) -> bool {
        self.kind == ResponseEventKind::Page
            && self.delivered == Some(false)
            && self.run() == ladder_run
    }

    /// Which run this entry belongs to. Entries written before the ladder
    /// could restart carry none, and belong to the first run.
    pub fn run(&self) -> i32 {
        self.ladder_run.unwrap_or(FIRST_LADDER_RUN)
    }

    /// Whether this entry says `recipient` was already reached on `channel`
    /// for one rung of one run.
    ///
    /// This is the dedup key a replay checks. A *failed* attempt deliberately
    /// does not match: a crash between two sends must retry the page that did
    /// not land, and only that one.
    pub fn is_delivery_of(
        &self,
        ladder_run: i32,
        rung_micros: i64,
        recipient: &str,
        channel: Channel,
    ) -> bool {
        self.kind == ResponseEventKind::Delivery
            && self.delivered == Some(true)
            && self.run() == ladder_run
            && self.rung_micros == Some(rung_micros)
            && self.recipient.as_deref() == Some(recipient)
            && self.channel == Some(channel)
    }
}

fn owner_role() -> ResponderRole {
    ResponderRole::Owner
}
/// Why a page turned out to happen.
///
/// A fixed list rather than free text: the point is that the NEXT firing of
/// the same rule can say "3× config change / deploy". Free text fragments into
/// near-duplicates and never groups, which is the same as having nothing.
/// Nuance goes in `cause_note`, one sentence beside it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionCause {
    ConfigChangeOrDeploy,
    CapacityOrLoad,
    DependencyFailure,
    ExpectedOrMaintenance,
    NoisyThreshold,
    DataOrIngestionIssue,
    GenuineDefect,
    /// Deliberately offered. A responder who cannot say why must be able to
    /// close the record honestly instead of picking a plausible-looking cause,
    /// which would poison every future firing's history.
    StillUnknown,
}

impl ResolutionCause {
    pub const ALL: [Self; 8] = [
        Self::ConfigChangeOrDeploy,
        Self::CapacityOrLoad,
        Self::DependencyFailure,
        Self::ExpectedOrMaintenance,
        Self::NoisyThreshold,
        Self::DataOrIngestionIssue,
        Self::GenuineDefect,
        Self::StillUnknown,
    ];

    /// Stable wire value. Persisted, so changing one loses history.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ConfigChangeOrDeploy => "config_change_or_deploy",
            Self::CapacityOrLoad => "capacity_or_load",
            Self::DependencyFailure => "dependency_failure",
            Self::ExpectedOrMaintenance => "expected_or_maintenance",
            Self::NoisyThreshold => "noisy_threshold",
            Self::DataOrIngestionIssue => "data_or_ingestion_issue",
            Self::GenuineDefect => "genuine_defect",
            Self::StillUnknown => "still_unknown",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|c| c.as_str() == s)
    }
}

impl std::fmt::Display for ResolutionCause {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}


/// The record itself, as the API and the UI see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Response {
    pub id: String,
    pub org_id: String,
    pub subject: SubjectRef,
    pub team_id: String,
    /// What the page is about. Kept on the record so it survives the alert
    /// being renamed or deleted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Why it happened, captured at resolve — the history the next firing of
    /// this rule reads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause: Option<ResolutionCause>,
    /// The sentence beside the structured cause. One dropdown plus one line is
    /// the whole ask — anything longer does not get filled in at 3am.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause_note: Option<String>,
    /// Quiet until this instant, in micros.
    ///
    /// Not an acknowledgement: snoozing says "I know, stop shouting", not "I
    /// have this". The record stays open and unowned, and the ladder resumes
    /// when it expires — which is exactly what makes it safe to offer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snoozed_until: Option<i64>,
    /// What the ladder measures its step delays from; `opened_at` until a
    /// snooze pushes it forward.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ladder_anchor: Option<i64>,
    /// Which run of the ladder the record is on.
    ///
    /// Handing a page to another person or another team starts a new run, and
    /// the ledger is read per run — which is what makes the receiving
    /// responder's ladder begin at its first rung instead of at the rung the
    /// previous one had reached. Absent means the first run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ladder_run: Option<i32>,
    /// `AlertPriority::to_i32` — the same scale alerts already use.
    pub priority: i32,
    #[serde(default = "owner_role")]
    pub responder_role: ResponderRole,
    /// For an impacted record, the owner record it was opened alongside.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_response_id: Option<String>,
    pub state: ResponseState,
    pub opened_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acked_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acked_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<i64>,
    /// Set only when this firing also produced an incident. A record is never
    /// owned by an incident, so this stays `None` for most firings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incident_id: Option<String>,
}

impl Response {
    /// How long the page went unacknowledged, in microseconds.
    pub fn time_to_ack(&self) -> Option<i64> {
        self.acked_at.map(|a| a - self.opened_at)
    }

    /// How long the firing stayed open, in microseconds.
    pub fn time_to_resolve(&self) -> Option<i64> {
        self.closed_at.map(|c| c - self.opened_at)
    }

    /// Where the escalation ladder's clock starts.
    pub fn ladder_start(&self) -> i64 {
        self.ladder_anchor.unwrap_or(self.opened_at)
    }

    /// Which run of the ladder is climbing now. Records opened before
    /// handoffs restarted the ladder are on the first.
    pub fn current_run(&self) -> i32 {
        self.ladder_run.unwrap_or(FIRST_LADDER_RUN)
    }

    /// The record as it stands the instant a page changes hands.
    ///
    /// A handoff is a transfer, not a note: the acknowledgement belonged to
    /// whoever gave the page away, so it is cleared, and the ladder starts
    /// again from now under a new run rather than resuming where the previous
    /// responder's had reached. Passing `to_team_id` moves the record to
    /// another team as well; passing `None` hands it to somebody on the same
    /// one. Either way nobody is auto-acknowledged — a handoff nobody accepts
    /// has to keep chasing, or it is how a page becomes quietly nobody's
    /// problem.
    pub fn handed_over(&self, to_team_id: Option<&str>, now: i64) -> Self {
        Self {
            team_id: to_team_id.unwrap_or(&self.team_id).to_string(),
            state: ResponseState::Triggered,
            acked_by: None,
            acked_at: None,
            // A page being handed over is being looked at, so a snooze the
            // previous owner set is theirs and ends with their ownership.
            snoozed_until: None,
            ladder_anchor: Some(now),
            ladder_run: Some(next_ladder_run(self.ladder_run)),
            ..self.clone()
        }
    }

    /// Whether paging is currently suppressed.
    pub fn is_snoozed(&self, now: i64) -> bool {
        self.snoozed_until.is_some_and(|until| now < until)
    }
}

// ── Flap dampening (G16) ─────────────────────────────────────────────────────
//
// A healthy evaluation resolves the record, and the next firing opens a new
// one. That is right for a condition that broke, was fixed, and broke again a
// week later — it is what makes the previous firing's cause show up as history
// on the next. It is wrong for a condition that is merely *unstable*: an alert
// on a one-minute frequency that fires, clears, fires, clears produces a full
// page cycle per flap, wakes one responder all night, and fills the history
// with one-minute records that each look like a separate incident.
//
// Two market shapes address this. Opsgenie has a **close delay** — hold the
// record open for a few minutes after recovery, so a re-fire lands on the
// record that is still there. PagerDuty has an **auto-resolve timeout** plus
// alert grouping. Both amount to the same sentence: *do not treat a brief
// recovery as the end of the firing*.
//
// We implement that sentence from the **firing** side, not the recovery side,
// and the choice is deliberate. A close delay puts the dampening in the path
// that closes records, which means every bug in it is a record that does not
// close — and a page that will not go away is worse than a page that repeats.
// It also needs a timer to do the closing, so a lost timer is a stuck page
// too. Suppressing on the *re-fire* instead has the failure modes the other
// way round: recovery still closes the record the instant the condition
// clears, exactly as it does today and by exactly the same code, so a real
// recovery cannot become a stuck page no matter what this function returns.
// The worst this can do is delay a page by one window, and it is bounded
// below by that window rather than unbounded.
//
// The window is measured from the previous record's `closed_at` — from the
// recovery, not from the last flap. Debouncing (each flap pushing the window
// out) would dampen a flap storm to a single page ever, and a condition that
// flaps for six hours *is* an outage somebody has to be told about more than
// once. Measuring from the close means a storm pages at most once per window
// instead of once per evaluation, and never goes permanently silent. Silence
// is the failure mode this feature exists to prevent; noise is the one it is
// being asked to reduce, and they are not worth the same.

/// How long after a record closes a re-fire of the same source counts as the
/// same unstable firing rather than a new one.
///
/// Five minutes: longer than any sane evaluation frequency, so an alert
/// flapping on its own cadence is caught; shorter than the time it takes a
/// responder to finish reading a page, so a condition that genuinely came back
/// still reaches somebody while the first one is fresh.
pub const DEFAULT_FLAP_DAMPENING_SECS: i64 = 300;

/// What a firing should do about the record that already exists for its source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PageDecision {
    /// Nothing open, nothing recently closed. Open a record and page.
    Page,
    /// A record for this source is still open — it **is** this firing, and the
    /// ladder attached to it is what escalates if nobody answers. Paging again
    /// would wake the same person for the thing they are already holding.
    AlreadyOpen,
    /// The previous record closed less than the dampening window ago. This
    /// firing is the same unstable condition coming back, so it is recorded on
    /// that record instead of opening a second one and waking anybody again.
    Flap {
        /// The record the flap belongs on. Carried in the value rather than
        /// left for the caller to re-derive, so "dampen" cannot be spelled
        /// without saying which record it is dampening onto.
        response_id: String,
        /// How long the recovery held before it came back, in micros. Goes on
        /// the timeline verbatim: "fired again 40s after recovering" is a
        /// different fact from "fired again 4m after recovering", and a
        /// responder reading the record afterwards needs to tell them apart.
        recovered_for_micros: i64,
    },
}

/// Whether this firing pages, folds into an open record, or is dampened.
///
/// `latest` is the newest record for this source whatever its state — not the
/// newest *open* one. That widening is the whole change: the close-then-reopen
/// cycle is invisible to a query that only returns open records, which is why
/// the previous rule ("still open") could not see a flap at all.
///
/// `dampening_micros` of zero or less turns dampening off and restores the
/// previous behaviour exactly, which is what makes it safe to ship on by
/// default: an operator who finds it eating pages has a switch, and the switch
/// leads back to code that is still exercised.
///
/// `now` is passed in. A record whose `closed_at` is missing or in the future
/// is treated as not-recently-closed — a clock that disagrees with itself must
/// cost a duplicate page, never a suppressed one.
pub fn page_decision(latest: Option<&Response>, now: i64, dampening_micros: i64) -> PageDecision {
    let Some(record) = latest else {
        return PageDecision::Page;
    };
    if !record.state.is_terminal() {
        return PageDecision::AlreadyOpen;
    }
    if dampening_micros <= 0 {
        return PageDecision::Page;
    }
    let Some(closed_at) = record.closed_at else {
        // Terminal without a close instant is a row this code cannot reason
        // about. It is not evidence of a recent recovery, so it does not
        // suppress.
        return PageDecision::Page;
    };
    let recovered_for = now - closed_at;
    if (0..dampening_micros).contains(&recovered_for) {
        PageDecision::Flap {
            response_id: record.id.clone(),
            recovered_for_micros: recovered_for,
        }
    } else {
        PageDecision::Page
    }
}

/// The timeline sentence for one dampened re-fire.
///
/// Pure and here rather than formatted at the call site, because this string is
/// the entire responder-facing evidence that dampening happened — if it is
/// wrong or absent the record is silently smoothed, which is the outcome G16
/// says is worse than the flapping.
pub fn flap_note(recovered_for_micros: i64) -> String {
    let seconds = recovered_for_micros.max(0) / 1_000_000;
    format!(
        "the condition fired again {seconds}s after recovering — dampened as the same unstable \
         firing, so nobody was paged a second time"
    )
}

// ── Ordered recovery (00-simplified-flow §4) ─────────────────────────────────

/// What the upstream signal recovering means for the records it opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpstreamRecovery {
    /// Nothing depended on this firing, or every dependent has already
    /// confirmed. The owner's record closes now.
    CloseOwner,
    /// Dependents are still containing the blast radius on their own services.
    /// The owner's record stays open — "the incident closes on the slowest
    /// dependent, not on the root cause" — and these are the records it is
    /// waiting on.
    AwaitDependents { outstanding: Vec<String> },
}

/// Whether the root cause clearing closes the firing, or only tells the
/// dependents about it.
///
/// §4 is explicit that recovery is ordered: the database being healthy does
/// not mean payment-gateway has replayed its buffered writes, and closing
/// their record on their behalf is how the replay never happens. So the
/// upstream signal is exactly that — a signal — and the owner's own record
/// stays open until the slowest dependent says it is clear.
pub fn upstream_recovery(impacted: &[Response]) -> UpstreamRecovery {
    let outstanding: Vec<String> = impacted
        .iter()
        .filter(|r| !r.state.is_terminal())
        .map(|r| r.id.clone())
        .collect();
    if outstanding.is_empty() {
        UpstreamRecovery::CloseOwner
    } else {
        UpstreamRecovery::AwaitDependents { outstanding }
    }
}

/// Whether confirming `confirmed_id` was the last thing the owner's record was
/// waiting on.
///
/// Takes the sibling list as it was read *before* the confirmation landed, and
/// discounts the confirmed record itself, so the caller does not have to
/// re-read the whole set inside a race it cannot win anyway.
pub fn dependents_all_clear(impacted: &[Response], confirmed_id: &str) -> bool {
    !impacted
        .iter()
        .any(|r| r.id != confirmed_id && !r.state.is_terminal())
}

// ── The team channel's copy of the record (Change 1) ─────────────────────────
//
// The team's chat destination used to receive the **page**: "[P2] checkout
// error rate — Platform", addressed to Ana, in a room of thirty people who
// learn from it only that Ana is being woken. It answered a question nobody in
// the room had asked.
//
// What the room wants is the record: something fired, this team owns it, here
// is who is on it and here is where it went. That is a different question from
// the alert's own notification — which carries the rows and values that fired —
// so both firing is not duplication, and this one is sent **unconditionally**
// rather than as a fallback for an alert with no destination of its own.
// Conditional behaviour there is how somebody adds a destination to an alert
// next month and the channel silently stops getting on-call context.

/// Where a record has got to, as far as its team's channel is concerned.
///
/// Three stages and no more: the room needs "somebody was woken", "somebody has
/// it" and "it is over, and why". Every rung in between is the ladder's
/// business, and posting them is what turns a flapping alert into channel noise
/// — which is precisely why the incident path already dedups its own repeats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChannelPostStage {
    Paged,
    Acknowledged,
    Resolved,
}

impl ChannelPostStage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Paged => "paged",
            Self::Acknowledged => "acknowledged",
            Self::Resolved => "resolved",
        }
    }

    /// The stage a record in this state is at, or `None` for a state the room
    /// is not told about.
    ///
    /// `Triaged` is deliberately absent: it means the agent is still looking,
    /// which is not news to a room and would spend the record's one message on
    /// a state that is over in ninety seconds.
    pub fn of(state: ResponseState) -> Option<Self> {
        match state {
            ResponseState::Triggered => Some(Self::Paged),
            ResponseState::Acknowledged => Some(Self::Acknowledged),
            ResponseState::Resolved => Some(Self::Resolved),
            ResponseState::Triaged => None,
        }
    }
}

impl std::fmt::Display for ChannelPostStage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One message in a team's channel, about one response record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ChannelPost {
    /// What the transport edits by. One per record, for the whole of its life.
    pub key: String,
    pub stage: ChannelPostStage,
    pub title: String,
    pub body: String,
    /// Where to read the whole thing, including the alert that fired.
    pub url: String,
}

/// The prefix every channel-post key carries, so a destination that receives
/// several kinds of message can tell them apart.
pub const CHANNEL_POST_KEY_PREFIX: &str = "o2-oncall-response";

/// The dedup key for a record's channel post: one per **record**.
///
/// Not per rung, and not per ladder run. A record handed to another team is
/// still the same outage to the room that has been watching it, and minting a
/// second key there would post the whole story twice.
pub fn channel_post_key(response_id: &str) -> String {
    format!("{CHANNEL_POST_KEY_PREFIX}:{response_id}")
}

/// What the room is told about a record right now.
///
/// `detail_url` links to the record rather than reproducing the alert. The
/// record carries `title`, the subject and the runbook — it does **not** carry
/// the rows and values that fired, so the alert's own detail cannot be
/// reproduced here without widening the record, and a link cannot go stale the
/// way a copied payload can.
pub fn channel_post(
    response: &Response,
    team_name: &str,
    stage: ChannelPostStage,
    detail_url: &str,
) -> ChannelPost {
    let what = response
        .title
        .clone()
        .unwrap_or_else(|| response.subject.source_id.clone());
    let title = format!("[{stage}] {what} — {team_name}");

    let mut body = String::with_capacity(256);
    match stage {
        ChannelPostStage::Paged => {
            body.push_str(&format!("{team_name} has been paged for {what}.\n"));
            if response.responder_role == ResponderRole::Impacted {
                // The room's own service is affected by somebody else's
                // outage. Saying so is the difference between "we are on the
                // hook for a fix" and "we are containing a blast radius".
                body.push_str(
                    "This team is impacted rather than the owner: contain the impact on your \
                     service; another team is fixing the cause.\n",
                );
            }
        }
        ChannelPostStage::Acknowledged => {
            let who = response.acked_by.as_deref().unwrap_or("somebody");
            body.push_str(&format!("{who} has it. {what} — {team_name}.\n"));
        }
        ChannelPostStage::Resolved => {
            body.push_str(&format!("Resolved: {what} — {team_name}.\n"));
            // The cause is the only thing in this message the room could not
            // have worked out for itself, so it is never dropped.
            match response.cause {
                Some(cause) => body.push_str(&format!("Cause: {cause}\n")),
                None => body.push_str("Cause: not recorded\n"),
            }
            if let Some(note) = response.cause_note.as_deref().filter(|n| !n.trim().is_empty()) {
                body.push_str(&format!("{note}\n"));
            }
        }
    }
    body.push_str(&format!("\n{detail_url}\n"));

    ChannelPost {
        key: channel_post_key(&response.id),
        stage,
        title,
        body,
        url: detail_url.to_string(),
    }
}

/// What a transport should do with a record's post at this stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelPostAction {
    /// Nothing has been posted for this record yet. Post it.
    Post,
    /// Revise the message already in the room.
    Edit,
    /// Say nothing.
    Skip,
}

/// Whether this stage goes to the room, and how.
///
/// `can_edit` is [`super::agent::updates_in_place`] for the channel the post
/// rides — its first caller. The rule it produces is the one that keeps a
/// record to a single message:
///
/// - nothing posted yet → **post**, whatever the stage. A record whose opening
///   post was lost still deserves to have its outcome said once, and posting
///   for the first time is not re-posting.
/// - posted, and the transport can revise what it sent → **edit**.
/// - posted, and it cannot → **skip**. Not "post again": a room that gets three
///   messages per record is the noise this whole design exists to avoid, and
///   the responder who needs the update is on the page, not in the channel.
pub fn channel_post_action(already_posted: bool, can_edit: bool) -> ChannelPostAction {
    match (already_posted, can_edit) {
        (false, _) => ChannelPostAction::Post,
        (true, true) => ChannelPostAction::Edit,
        (true, false) => ChannelPostAction::Skip,
    }
}

impl std::fmt::Display for ResponseState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::fmt::Display for ResponseEventKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::fmt::Display for ResponseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::IllegalTransition { from, to } => {
                write!(f, "cannot move a response from `{from}` to `{to}`")
            }
        }
    }
}

impl std::error::Error for ResponseError {}

#[cfg(test)]
mod tests {
    use super::{
        super::subject::{SubjectRef, SubjectType},
        *,
    };

    const STATES: [ResponseState; 4] = [
        ResponseState::Triggered,
        ResponseState::Triaged,
        ResponseState::Acknowledged,
        ResponseState::Resolved,
    ];

    const KINDS: [ResponseEventKind; 13] = [
        ResponseEventKind::Sys,
        ResponseEventKind::Page,
        ResponseEventKind::Ack,
        ResponseEventKind::Note,
        ResponseEventKind::Rca,
        ResponseEventKind::Handoff,
        ResponseEventKind::Recovery,
        ResponseEventKind::State,
        ResponseEventKind::Exhausted,
        ResponseEventKind::Delivery,
        ResponseEventKind::AiVerdict,
        ResponseEventKind::SeverityPromoted,
        ResponseEventKind::Flapped,
    ];

    #[test]
    fn test_responder_role_ids_are_pinned() {
        assert_eq!(ResponderRole::Owner.to_i32(), 1);
        assert_eq!(ResponderRole::Impacted.to_i32(), 2);
        for r in [ResponderRole::Owner, ResponderRole::Impacted] {
            assert_eq!(ResponderRole::from_i32(r.to_i32()), Some(r));
        }
        assert_eq!(ResponderRole::from_i32(0), None);
        assert_eq!(ResponderRole::from_i32(3), None);
    }

    /// Records written before impacted paging existed carry no role, and must
    /// load as the owner rather than as somebody else's blast radius.
    #[test]
    fn test_a_record_without_a_role_is_an_owner() {
        let json = r#"{"id":"r","org_id":"default","subject":{"subject_type":"alert","source_id":"al","firing":1},"team_id":"t","priority":2,"state":"triggered","opened_at":1}"#;
        let r: Response = serde_json::from_str(json).unwrap();
        assert_eq!(r.responder_role, ResponderRole::Owner);
        assert_eq!(r.origin_response_id, None);
    }

    #[test]
    fn test_impacted_record_round_trips_with_its_origin() {
        let mut r = sample(None, None);
        r.responder_role = ResponderRole::Impacted;
        r.origin_response_id = Some("resp_origin".into());
        let back: Response = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
        assert_eq!(back, r);
        assert!(serde_json::to_string(&r).unwrap().contains("impacted"));
    }

    #[test]
    fn test_state_storage_ids_are_pinned() {
        assert_eq!(ResponseState::Triggered.to_i32(), 1);
        assert_eq!(ResponseState::Triaged.to_i32(), 2);
        assert_eq!(ResponseState::Acknowledged.to_i32(), 3);
        assert_eq!(ResponseState::Resolved.to_i32(), 4);
    }

    #[test]
    fn test_event_kind_storage_ids_are_pinned() {
        let expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        for (k, want) in KINDS.iter().zip(expected) {
            assert_eq!(k.to_i32(), want, "{k} moved");
        }
    }

    /// The L0 agent's two entries. `AiVerdict` is the durable, auditable copy
    /// of what the machine recommended, and `SeverityPromoted` is the receipt
    /// for the one decision this design lets a verdict make. Both belong on the
    /// human timeline: "why was I paged" and "why was I *not* paged" are both
    /// answered from them, and the second question matters more.
    #[test]
    fn test_the_agents_entries_are_on_the_timeline_and_not_written_by_a_person() {
        for k in [
            ResponseEventKind::AiVerdict,
            ResponseEventKind::SeverityPromoted,
        ] {
            assert!(!k.is_human_authored(), "{k} is the agent's, not a person's");
            assert!(!k.is_ledger_only(), "{k} is what a responder reads at 3am");
        }
        assert_eq!(ResponseEventKind::AiVerdict.as_str(), "ai_verdict");
        assert_eq!(
            ResponseEventKind::SeverityPromoted.as_str(),
            "severity_promoted"
        );
    }

    #[test]
    fn test_storage_ids_round_trip_and_reject_junk() {
        for s in STATES {
            assert_eq!(ResponseState::from_i32(s.to_i32()), Some(s));
        }
        for k in KINDS {
            assert_eq!(ResponseEventKind::from_i32(k.to_i32()), Some(k));
        }
        assert_eq!(ResponseState::from_i32(0), None);
        assert_eq!(ResponseState::from_i32(5), None);
        assert_eq!(ResponseEventKind::from_i32(0), None);
        assert_eq!(ResponseEventKind::from_i32(14), None);
    }

    /// A late event must never reopen a record a human already closed.
    #[test]
    fn test_resolved_is_terminal() {
        for s in STATES {
            assert!(
                !ResponseState::Resolved.can_transition_to(s),
                "resolved must not move to {s}"
            );
        }
        assert!(ResponseState::Resolved.is_terminal());
    }

    #[test]
    fn test_lifecycle_only_moves_forward() {
        assert!(ResponseState::Triggered.can_transition_to(ResponseState::Triaged));
        assert!(ResponseState::Triaged.can_transition_to(ResponseState::Acknowledged));
        assert!(ResponseState::Acknowledged.can_transition_to(ResponseState::Resolved));

        assert!(!ResponseState::Acknowledged.can_transition_to(ResponseState::Triggered));
        assert!(!ResponseState::Triaged.can_transition_to(ResponseState::Triggered));
    }

    /// Triage is optional: with the agent disabled a record goes straight
    /// from triggered to acknowledged.
    #[test]
    fn test_triage_can_be_skipped() {
        assert!(ResponseState::Triggered.can_transition_to(ResponseState::Acknowledged));
        assert!(ResponseState::Triggered.can_transition_to(ResponseState::Resolved));
    }

    #[test]
    fn test_no_state_transitions_to_itself() {
        for s in STATES {
            assert!(!s.can_transition_to(s), "{s} must not self-transition");
        }
    }

    #[test]
    fn test_transition_to_reports_the_offending_pair() {
        let err = ResponseState::Acknowledged
            .transition_to(ResponseState::Triggered)
            .unwrap_err();
        assert_eq!(
            err,
            ResponseError::IllegalTransition {
                from: ResponseState::Acknowledged,
                to: ResponseState::Triggered,
            }
        );
        assert!(err.to_string().contains("acknowledged"));
        assert!(err.to_string().contains("triggered"));
    }

    /// The ladder keeps escalating until somebody takes the ball; triage by
    /// the agent is not somebody taking the ball.
    #[test]
    fn test_open_states_are_the_ones_still_escalating() {
        assert!(ResponseState::Triggered.is_escalating());
        assert!(ResponseState::Triaged.is_escalating());
        assert!(!ResponseState::Acknowledged.is_escalating());
        assert!(!ResponseState::Resolved.is_escalating());
    }

    #[test]
    fn test_human_authored_kinds_are_what_a_person_wrote() {
        for k in [
            ResponseEventKind::Note,
            ResponseEventKind::Ack,
            ResponseEventKind::Handoff,
        ] {
            assert!(k.is_human_authored(), "{k} is written by a person");
        }
        for k in [
            ResponseEventKind::Sys,
            ResponseEventKind::Page,
            ResponseEventKind::Recovery,
            ResponseEventKind::State,
            ResponseEventKind::Rca,
            ResponseEventKind::Exhausted,
            ResponseEventKind::Delivery,
            ResponseEventKind::AiVerdict,
            ResponseEventKind::SeverityPromoted,
        ] {
            assert!(!k.is_human_authored(), "{k} is machine-generated");
        }
    }

    /// A rung that pages eight people on two channels is one line to a
    /// responder and sixteen rows to the engine. Only the engine's rows are
    /// kept off the timeline; everything else a reader can act on stays.
    #[test]
    fn test_only_delivery_rows_are_kept_off_the_timeline() {
        assert!(ResponseEventKind::Delivery.is_ledger_only());
        for k in KINDS.iter().filter(|k| **k != ResponseEventKind::Delivery) {
            assert!(!k.is_ledger_only(), "{k} belongs on the timeline");
        }
    }

    #[test]
    fn test_serializes_as_snake_case() {
        for s in STATES {
            let json = serde_json::to_string(&s).unwrap();
            assert_eq!(json, format!(r#""{}""#, s.as_str()));
            assert_eq!(serde_json::from_str::<ResponseState>(&json).unwrap(), s);
        }
        for k in KINDS {
            let json = serde_json::to_string(&k).unwrap();
            assert_eq!(json, format!(r#""{}""#, k.as_str()));
            assert_eq!(serde_json::from_str::<ResponseEventKind>(&json).unwrap(), k);
        }
    }

    #[test]
    fn test_event_carries_an_optional_rung() {
        let plain = ResponseEvent::new(ResponseEventKind::Note, 10, "ana@o2.ai", "looking");
        assert_eq!(plain.rung_micros, None);
        assert!(
            !serde_json::to_string(&plain).unwrap().contains("rung_micros"),
            "an absent rung must not appear in the payload"
        );

        let paged = ResponseEvent::new(ResponseEventKind::Page, 10, "o2-engine", "sms sent")
            .at_rung(300_000_000);
        assert_eq!(paged.rung_micros, Some(300_000_000));
        let back: ResponseEvent =
            serde_json::from_str(&serde_json::to_string(&paged).unwrap()).unwrap();
        assert_eq!(back, paged);
    }

    /// The bug this pins: a handoff left the previous owner's pages in the
    /// ledger, so the receiving team's very first rung read as already sent
    /// and nobody on it was ever woken. The rung delay alone cannot be the
    /// key once a page can change hands.
    #[test]
    fn test_a_rung_from_an_earlier_run_is_not_this_run_s_ledger() {
        let first = ResponseEvent::new(ResponseEventKind::Page, 10, "o2-engine", "paged ana@o2.ai")
            .at_rung(0)
            .in_run(FIRST_LADDER_RUN);
        assert_eq!(first.run(), FIRST_LADDER_RUN);
        assert_ne!(first.run(), 2, "run 2's rung 0 has not fired");

        // Written before the ladder could restart: it belongs to the first
        // run, not to whichever run happens to be climbing now.
        let legacy = ResponseEvent::new(ResponseEventKind::Page, 10, "o2-engine", "paged ana@o2.ai")
            .at_rung(0);
        assert_eq!(legacy.ladder_run, None);
        assert_eq!(legacy.run(), FIRST_LADDER_RUN);
    }

    /// A crash between two sends in one rung must retry the page that did not
    /// land and skip the one that did — the dedup Phase 5 asks for is keyed
    /// per person and per channel, not per rung.
    #[test]
    fn test_only_a_page_that_landed_counts_as_delivered() {
        let landed = ResponseEvent::new(ResponseEventKind::Delivery, 10, "o2-engine", "sent")
            .at_rung(0)
            .in_run(1)
            .delivered_to("ana@o2.ai", Channel::Email, true);
        assert!(landed.is_delivery_of(1, 0, "ana@o2.ai", Channel::Email));

        // Same person, same rung, different channel or run — all misses.
        assert!(!landed.is_delivery_of(1, 0, "ana@o2.ai", Channel::Webhook));
        assert!(!landed.is_delivery_of(2, 0, "ana@o2.ai", Channel::Email));
        assert!(!landed.is_delivery_of(1, 300, "ana@o2.ai", Channel::Email));
        assert!(!landed.is_delivery_of(1, 0, "bo@o2.ai", Channel::Email));

        let failed = ResponseEvent::new(ResponseEventKind::Delivery, 10, "o2-engine", "smtp down")
            .at_rung(0)
            .in_run(1)
            .delivered_to("ana@o2.ai", Channel::Email, false);
        assert!(
            !failed.is_delivery_of(1, 0, "ana@o2.ai", Channel::Email),
            "a failure must be retried, not deduped away"
        );
    }

    /// The one fact the ladder cannot get from the per-recipient rows: this
    /// rung had real people on it and reached none of them. A rung that
    /// resolved to nobody is not marked, because that rung IS spent — nobody
    /// will appear on it in five minutes — and marking it would make the engine
    /// re-send a page to no one for as long as its retry budget lasts.
    #[test]
    fn test_only_a_rung_the_transport_lost_reads_as_unsent() {
        let lost = ResponseEvent::new(ResponseEventKind::Page, 10, "o2-engine", "could not reach ana@o2.ai")
            .at_rung(5)
            .in_run(2)
            .reached_nobody();
        assert!(lost.is_unreached_rung(2));
        assert!(
            !lost.is_unreached_rung(3),
            "a previous run's lost rung says nothing about this one"
        );

        let nobody_matched =
            ResponseEvent::new(ResponseEventKind::Page, 10, "o2-engine", "nobody matched on call now")
                .at_rung(5)
                .in_run(2);
        assert!(!nobody_matched.is_unreached_rung(2));

        let paged = ResponseEvent::new(ResponseEventKind::Page, 10, "o2-engine", "paged ana@o2.ai")
            .at_rung(5)
            .in_run(2);
        assert!(!paged.is_unreached_rung(2));

        // A failed per-recipient row is not a rung, and must not take one out
        // of the ledger on its own: the rest of the rung may well have landed.
        let one_failure = ResponseEvent::new(ResponseEventKind::Delivery, 10, "o2-engine", "failed")
            .at_rung(5)
            .in_run(2)
            .delivered_to("ana@o2.ai", Channel::Email, false);
        assert!(!one_failure.is_unreached_rung(2));

        let back: ResponseEvent =
            serde_json::from_str(&serde_json::to_string(&lost).unwrap()).unwrap();
        assert!(back.is_unreached_rung(2), "and it survives storage");
    }

    #[test]
    fn test_a_delivery_round_trips_with_its_recipient_and_channel() {
        let d = ResponseEvent::new(ResponseEventKind::Delivery, 10, "o2-engine", "sent")
            .at_rung(0)
            .in_run(2)
            .delivered_to("ana@o2.ai", Channel::Email, true);
        let back: ResponseEvent = serde_json::from_str(&serde_json::to_string(&d).unwrap()).unwrap();
        assert_eq!(back, d);
        assert_eq!(back.channel, Some(Channel::Email));
        assert_eq!(back.delivered, Some(true));
    }

    fn sample(acked_at: Option<i64>, closed_at: Option<i64>) -> Response {
        Response {
            id: "resp_1".into(),
            org_id: "default".into(),
            subject: SubjectRef::new(SubjectType::Alert, "al_ckt", 1),
            team_id: "team_1".into(),
            title: None,
            cause: None,
            cause_note: None,
            snoozed_until: None,
            ladder_anchor: None,
            ladder_run: None,
            priority: 2,
            responder_role: ResponderRole::Owner,
            origin_response_id: None,
            state: ResponseState::Triggered,
            opened_at: 1_000,
            acked_by: acked_at.map(|_| "ana@o2.ai".to_string()),
            acked_at,
            closed_at,
            incident_id: None,
        }
    }

    /// Snoozing quiets the page without claiming it, so the record stays open
    /// and unowned — an expired snooze must let the ladder resume.
    /// The bug this pins: one predicate served both the engine ("keep
    /// climbing?") and the list ("still mine to close?"). Acknowledged answers
    /// no to the first and yes to the second, so it vanished from the product.
    #[test]
    fn test_acknowledged_stops_the_ladder_but_stays_open() {
        assert!(!ResponseState::Acknowledged.is_escalating());
        assert!(ResponseState::Acknowledged.is_unresolved());

        // Only resolving actually closes it.
        assert!(!ResponseState::Resolved.is_unresolved());
        for s in [ResponseState::Triggered, ResponseState::Triaged] {
            assert!(s.is_escalating() && s.is_unresolved());
        }
    }

    #[test]
    fn test_snooze_is_time_bounded_and_not_an_ack() {
        let mut r = sample(None, None);
        r.snoozed_until = Some(2_000);
        assert!(r.is_snoozed(1_999));
        assert!(!r.is_snoozed(2_000), "the snooze is over at its instant");
        assert!(r.acked_by.is_none(), "snoozing claims nothing");
        assert!(r.state.is_unresolved());

        let never = sample(None, None);
        assert!(!never.is_snoozed(i64::MAX));
    }

    /// A pause must delay the ladder, not compress it: without moving the
    /// anchor, a 30-minute snooze would come back and fire every rung whose
    /// delay had passed, all at once.
    #[test]
    fn test_snoozing_moves_the_ladder_clock_but_not_the_open_time() {
        let mut r = sample(None, None);
        assert_eq!(r.ladder_start(), r.opened_at, "defaults to the open time");

        let opened = r.opened_at;
        r.ladder_anchor = Some(opened + 1_800);
        assert_eq!(r.ladder_start(), opened + 1_800);
        assert_eq!(r.opened_at, opened, "time-to-resolve still measures reality");
    }

    /// The bug this pins: handing a page to another team moved the team but
    /// left the ladder where it was, so the first tick after the handoff found
    /// every rung already sent and dropped the job — the receiving team was
    /// never paged at all.
    #[test]
    fn test_a_handoff_restarts_the_ladder_for_the_receiving_team() {
        let mut r = sample(Some(1_100), None);
        r.state = ResponseState::Acknowledged;
        r.ladder_anchor = Some(1_050);

        let moved = r.handed_over(Some("team_2"), 9_000);
        assert_eq!(moved.team_id, "team_2");
        assert_eq!(moved.state, ResponseState::Triggered, "the page is open again");
        assert_eq!(moved.acked_by, None, "the ack belonged to whoever gave it away");
        assert_eq!(moved.acked_at, None);
        assert_eq!(moved.ladder_start(), 9_000, "the new team's clock starts now");
        assert_eq!(moved.current_run(), 2, "a fresh run, so the ledger is empty");
        assert_eq!(moved.opened_at, r.opened_at, "time-to-resolve still measures reality");
    }

    /// Handing a page to a PERSON has to work the same way: the recipient is
    /// paged and keeps being chased if they never answer. Acknowledging on
    /// their behalf is exactly how a handoff becomes nobody's problem.
    #[test]
    fn test_handing_to_a_person_keeps_the_page_chaseable_on_the_same_team() {
        let r = sample(None, None);
        let moved = r.handed_over(None, 9_000);

        assert_eq!(moved.team_id, r.team_id, "same team, new owner");
        assert_eq!(moved.state, ResponseState::Triggered);
        assert!(moved.acked_by.is_none(), "nobody is acknowledged on their behalf");
        assert!(moved.state.is_escalating(), "an unanswered handoff must keep climbing");
        assert_eq!(moved.current_run(), 2);
    }

    /// A snooze says "I know, stop shouting" and belongs to the person who set
    /// it. Carrying it across a handoff would hand somebody a page that is
    /// already quiet.
    #[test]
    fn test_a_handoff_does_not_inherit_the_previous_owner_s_snooze() {
        let mut r = sample(None, None);
        r.snoozed_until = Some(50_000);
        let moved = r.handed_over(None, 9_000);
        assert!(!moved.is_snoozed(9_001));
        assert_eq!(moved.snoozed_until, None);
    }

    /// The bug this pins: `minutes` comes off a request body and was
    /// multiplied out unchecked. `{"minutes": 999999999999}` panicked the
    /// handler and dropped the connection — and in a release build it would
    /// have wrapped instead, quietly silencing a live page until an instant
    /// in the past or 150 000 years away.
    #[test]
    fn test_a_snooze_cannot_run_off_the_end_of_the_clock() {
        for absurd in [999_999_999_999, i64::MAX, i64::MIN, i64::MAX / 2] {
            assert_eq!(
                snooze_until(1_700_000_000_000_000, absurd),
                None,
                "{absurd} minutes must be refused, not wrapped"
            );
        }
        // Even in range, the addition itself must not be able to wrap.
        assert_eq!(snooze_until(i64::MAX, 1), None);
    }

    /// A snooze is "I know, stop shouting", not "goodbye". It has to expire
    /// inside the shift of whoever set it, because it claims nothing and the
    /// record stays open and unowned the whole time.
    #[test]
    fn test_a_snooze_is_bounded_to_a_day_and_must_be_positive() {
        assert_eq!(snooze_until(1_000, 0), None, "a zero-minute snooze is not one");
        assert_eq!(snooze_until(1_000, -5), None);
        assert_eq!(snooze_until(1_000, MAX_SNOOZE_MINUTES + 1), None);

        assert_eq!(snooze_until(1_000, 1), Some(1_000 + 60_000_000));
        assert_eq!(snooze_until(1_000, 5), Some(1_000 + 300_000_000));
        assert!(snooze_until(1_000, MAX_SNOOZE_MINUTES).is_some());
    }

    #[test]
    fn test_runs_count_up_from_the_first_one() {
        assert_eq!(next_ladder_run(None), 2, "no run recorded means the first");
        assert_eq!(next_ladder_run(Some(FIRST_LADDER_RUN)), 2);
        assert_eq!(next_ladder_run(Some(7)), 8);
        assert_eq!(sample(None, None).current_run(), FIRST_LADDER_RUN);
    }

    #[test]
    fn test_durations_are_none_until_the_event_happens() {
        let open = sample(None, None);
        assert_eq!(open.time_to_ack(), None);
        assert_eq!(open.time_to_resolve(), None);

        let done = sample(Some(1_300), Some(2_500));
        assert_eq!(done.time_to_ack(), Some(300));
        assert_eq!(done.time_to_resolve(), Some(1_500));
    }

    /// A record without an incident is the common case, so `incident_id` must
    /// be absent from the payload rather than serialised as null.
    #[test]
    fn test_incident_id_is_absent_when_there_is_no_incident() {
        let r = sample(None, None);
        let json = serde_json::to_string(&r).unwrap();
        assert!(!json.contains("incident_id"));
        let back: Response = serde_json::from_str(&json).unwrap();
        assert_eq!(back, r);
    }

    #[test]
    fn test_record_round_trips_with_an_incident_attached() {
        let mut r = sample(Some(1_100), None);
        r.incident_id = Some("inc_9".into());
        let back: Response = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
        assert_eq!(back, r);
        assert_eq!(back.incident_id.as_deref(), Some("inc_9"));
    }

    // ── Ordered recovery (00-simplified-flow §4) ────────────────────────────

    fn impacted(id: &str, state: ResponseState) -> Response {
        Response {
            id: id.into(),
            responder_role: ResponderRole::Impacted,
            origin_response_id: Some("resp_1".into()),
            state,
            closed_at: state.is_terminal().then_some(2_000),
            ..sample(None, None)
        }
    }

    /// The bug this pins, in the design's own worked example: Postgres
    /// recovers, the engine closes payment-gateway's record on their behalf,
    /// and the writes buffered during the outage are never replayed. §4: "each
    /// impacted team confirms its own recovery. The owner team cannot close on
    /// their behalf."
    #[test]
    fn test_an_upstream_recovery_does_not_close_a_dependents_record() {
        let dependents = [
            impacted("payment_gateway", ResponseState::Acknowledged),
            impacted("order_service", ResponseState::Triggered),
        ];
        assert_eq!(
            upstream_recovery(&dependents),
            UpstreamRecovery::AwaitDependents {
                outstanding: vec!["payment_gateway".into(), "order_service".into()],
            }
        );
    }

    /// Nothing depended on it, so there is nobody to wait for — the ordinary
    /// alert, and it must close exactly as it always has.
    #[test]
    fn test_a_firing_nothing_depended_on_still_closes_on_recovery() {
        assert_eq!(upstream_recovery(&[]), UpstreamRecovery::CloseOwner);
    }

    /// §4's ordering, walked to its end: the incident closes on the slowest
    /// dependent, so the owner's record closes only once every one of them has
    /// confirmed.
    #[test]
    fn test_the_owner_closes_only_once_the_slowest_dependent_has_confirmed() {
        let all_clear = [
            impacted("auth_service", ResponseState::Resolved),
            impacted("payment_gateway", ResponseState::Resolved),
        ];
        assert_eq!(upstream_recovery(&all_clear), UpstreamRecovery::CloseOwner);

        // And the step before: inventory is still being reconciled.
        let mut one_left = all_clear.to_vec();
        one_left.push(impacted("order_service", ResponseState::Acknowledged));
        assert!(matches!(
            upstream_recovery(&one_left),
            UpstreamRecovery::AwaitDependents { .. }
        ));
    }

    /// A confirmation is read against the siblings as they were *before* it
    /// landed, so the confirming record itself never counts against itself.
    #[test]
    fn test_a_confirmation_discounts_the_record_that_is_confirming() {
        let before = [
            impacted("auth_service", ResponseState::Resolved),
            impacted("order_service", ResponseState::Acknowledged),
        ];
        assert!(
            dependents_all_clear(&before, "order_service"),
            "the last dependent confirming closes the incident"
        );
        assert!(
            !dependents_all_clear(&before, "auth_service"),
            "order_service has not confirmed yet"
        );
        assert!(dependents_all_clear(&[], "anything"));
    }

    // ── The team channel's copy of the record (Change 1) ────────────────────

    const URL: &str = "https://o2.example/web/oncall/responses/resp_1?org_identifier=default";

    fn record(state: ResponseState) -> Response {
        Response {
            title: Some("Checkout error rate".into()),
            state,
            ..sample(None, None)
        }
    }

    /// One message for the whole life of a record. The key is what makes that
    /// true, so it is pinned: no rung in it, no ladder run in it.
    #[test]
    fn test_the_dedup_key_is_the_record_and_nothing_else() {
        let paged = channel_post(&record(ResponseState::Triggered), "Platform", ChannelPostStage::Paged, URL);
        let mut acked = record(ResponseState::Acknowledged);
        acked.acked_by = Some("ana@o2.ai".into());
        acked.ladder_run = Some(4);
        acked.team_id = "another_team".into();
        let acked = channel_post(&acked, "Platform", ChannelPostStage::Acknowledged, URL);

        assert_eq!(paged.key, acked.key, "one message, edited, for one record");
        assert_eq!(paged.key, "o2-oncall-response:resp_1");
        assert!(!paged.key.contains("run") && !paged.key.contains('/'));
    }

    /// The three things the room is told, in order, and the one thing it is
    /// not: a `Triaged` record is the agent still thinking, which is not news.
    #[test]
    fn test_the_room_hears_paged_acknowledged_and_resolved_and_nothing_else() {
        assert_eq!(
            ChannelPostStage::of(ResponseState::Triggered),
            Some(ChannelPostStage::Paged)
        );
        assert_eq!(
            ChannelPostStage::of(ResponseState::Acknowledged),
            Some(ChannelPostStage::Acknowledged)
        );
        assert_eq!(
            ChannelPostStage::of(ResponseState::Resolved),
            Some(ChannelPostStage::Resolved)
        );
        assert_eq!(ChannelPostStage::of(ResponseState::Triaged), None);
    }

    /// The whole point of the change: the room learns what fired and who has
    /// it, not that one named person is being woken.
    #[test]
    fn test_the_post_is_about_the_record_not_about_the_person_being_woken() {
        let paged = channel_post(&record(ResponseState::Triggered), "Platform", ChannelPostStage::Paged, URL);
        assert!(paged.title.contains("Checkout error rate"), "{}", paged.title);
        assert!(paged.title.contains("Platform"));
        assert!(paged.body.contains("has been paged"), "{}", paged.body);
        assert!(
            !paged.body.contains("Acknowledge:"),
            "an ack link belongs to a person, not to a room"
        );
        assert!(paged.body.contains(URL), "the room can read the whole thing");
    }

    /// The record carries no rows or values, so the alert's detail is linked
    /// rather than copied — a link cannot go stale.
    #[test]
    fn test_the_post_links_the_record_rather_than_copying_the_alert() {
        let post = channel_post(&record(ResponseState::Triggered), "Platform", ChannelPostStage::Paged, URL);
        assert_eq!(post.url, URL);
        assert_eq!(post.body.matches(URL).count(), 1, "linked once, not pasted");
    }

    /// A resolution with no cause beside it teaches the next firing nothing,
    /// so the line is written either way rather than quietly omitted.
    #[test]
    fn test_the_resolution_carries_its_cause_or_says_it_has_none() {
        let mut resolved = record(ResponseState::Resolved);
        resolved.cause = Some(ResolutionCause::ConfigChangeOrDeploy);
        resolved.cause_note = Some("rolled back deploy 4821".into());
        let with = channel_post(&resolved, "Platform", ChannelPostStage::Resolved, URL);
        assert!(with.body.contains("Cause: config_change_or_deploy"), "{}", with.body);
        assert!(with.body.contains("rolled back deploy 4821"));

        let without = channel_post(&record(ResponseState::Resolved), "Platform", ChannelPostStage::Resolved, URL);
        assert!(without.body.contains("Cause: not recorded"), "{}", without.body);
    }

    /// An impacted team's room is told it is a liaison seat. Reading "you have
    /// been paged" and going looking for a fix is the failure this prevents.
    #[test]
    fn test_an_impacted_record_says_so_in_the_room() {
        let mut impacted = record(ResponseState::Triggered);
        impacted.responder_role = ResponderRole::Impacted;
        let post = channel_post(&impacted, "Payments", ChannelPostStage::Paged, URL);
        assert!(post.body.contains("impacted rather than the owner"), "{}", post.body);
        assert!(post.body.contains("another team is fixing the cause"));
    }

    /// The rule that keeps one record to one message: the first post always
    /// goes, a later stage edits where it can, and where it cannot the room
    /// hears nothing rather than the same story three times.
    #[test]
    fn test_a_progressing_record_edits_its_post_and_never_repeats_it() {
        assert_eq!(channel_post_action(false, true), ChannelPostAction::Post);
        assert_eq!(
            channel_post_action(false, false),
            ChannelPostAction::Post,
            "a first post is not a re-post, whatever the transport can do"
        );
        assert_eq!(channel_post_action(true, true), ChannelPostAction::Edit);
        assert_eq!(
            channel_post_action(true, false),
            ChannelPostAction::Skip,
            "not spamming beats not updating"
        );
    }

    /// The gate is `updates_in_place`, which had no caller until now. Wiring it
    /// to anything else would let a channel that cannot revise a message post a
    /// second one.
    #[test]
    fn test_the_edit_gate_is_the_channels_own_answer() {
        for editable in [Channel::Chat, Channel::Push, Channel::InApp] {
            assert_eq!(
                channel_post_action(true, super::super::agent::updates_in_place(editable)),
                ChannelPostAction::Edit,
                "{editable}"
            );
        }
        for fixed in [Channel::Email, Channel::Sms, Channel::Voice, Channel::Webhook] {
            assert_eq!(
                channel_post_action(true, super::super::agent::updates_in_place(fixed)),
                ChannelPostAction::Skip,
                "{fixed}"
            );
        }
    }

    // ── Flap dampening (G16) ─────────────────────────────────────────────────

    const WINDOW: i64 = DEFAULT_FLAP_DAMPENING_SECS * 1_000_000;

    fn closed_at(at: i64) -> Response {
        Response {
            state: ResponseState::Resolved,
            ..sample(None, Some(at))
        }
    }

    /// The test that matters. An alert on a one-minute frequency that fires,
    /// clears, fires, clears — the exact shape G16 describes — pages **once**,
    /// not once per flap, and every suppressed re-fire is attributed to the
    /// record the responder was actually woken for.
    #[test]
    fn test_a_flapping_alert_produces_one_page_cycle_not_n() {
        let minute = 60 * 1_000_000;
        // t=0 fires. Nothing has ever fired for this source.
        assert_eq!(page_decision(None, 0, WINDOW), PageDecision::Page);
        // t=60s recovers: the record closes, exactly as it does today.
        let record = closed_at(minute);

        let mut pages = 0;
        let mut flaps = 0;
        // Four more fire/clear cycles, one a minute, over the window.
        for cycle in 2..=5 {
            let firing_at = cycle * minute;
            match page_decision(Some(&record), firing_at, WINDOW) {
                PageDecision::Page => pages += 1,
                PageDecision::Flap { response_id, .. } => {
                    flaps += 1;
                    assert_eq!(response_id, "resp_1", "the flap lands on the paged record");
                }
                PageDecision::AlreadyOpen => unreachable!("the record closed"),
            }
        }
        assert_eq!(pages, 0, "one page cycle for the whole flap, not four more");
        assert_eq!(flaps, 4, "and each flap is still on the record");
    }

    /// The other half, and the one that must not regress: a recovery that
    /// holds is a recovery. Dampening lives entirely on the firing side, so
    /// `closed_at` being set at all is proof the record closed at the instant
    /// the condition cleared — there is no state in which a held recovery
    /// leaves a page stuck open.
    #[test]
    fn test_a_recovery_that_holds_closes_promptly_and_the_next_firing_pages() {
        let record = closed_at(1_000);
        assert!(record.state.is_terminal(), "recovery closed it, unconditionally");
        assert_eq!(record.closed_at, Some(1_000));
        // A firing after the window is a new incident and gets its own record —
        // which is what keeps the prior-causes history honest.
        assert_eq!(
            page_decision(Some(&record), 1_000 + WINDOW, WINDOW),
            PageDecision::Page,
            "exactly at the window the suppression is over"
        );
        assert_eq!(
            page_decision(Some(&record), 1_000 + WINDOW + 1, WINDOW),
            PageDecision::Page
        );
    }

    /// A storm never goes permanently silent: the window runs from the close,
    /// not from the last flap, so a condition that flaps for hours pages once
    /// per window instead of once per evaluation.
    #[test]
    fn test_dampening_is_bounded_and_never_becomes_permanent_silence() {
        let record = closed_at(0);
        assert!(matches!(
            page_decision(Some(&record), WINDOW - 1, WINDOW),
            PageDecision::Flap { .. }
        ));
        // Six hours of flapping later, the same closed record no longer
        // suppresses anything.
        assert_eq!(
            page_decision(Some(&record), 6 * 60 * 60 * 1_000_000, WINDOW),
            PageDecision::Page
        );
    }

    /// The pre-existing rule is unchanged: a still-open record IS this firing.
    /// Dampening is only ever asked about after that has been answered.
    #[test]
    fn test_an_open_record_still_wins_over_dampening() {
        for state in [
            ResponseState::Triggered,
            ResponseState::Triaged,
            ResponseState::Acknowledged,
        ] {
            let open = Response {
                state,
                ..sample(None, None)
            };
            assert_eq!(
                page_decision(Some(&open), 10_000_000, WINDOW),
                PageDecision::AlreadyOpen,
                "{state:?}"
            );
        }
    }

    /// Zero restores the previous behaviour exactly, which is the switch an
    /// operator who finds dampening eating pages reaches for.
    #[test]
    fn test_a_window_of_zero_or_less_turns_dampening_off() {
        let record = closed_at(1_000);
        for off in [0, -1, i64::MIN] {
            assert_eq!(page_decision(Some(&record), 1_001, off), PageDecision::Page);
        }
    }

    /// A clock that disagrees with itself must cost a duplicate page, never a
    /// suppressed one — so a close stamped in the future does not suppress, and
    /// neither does a terminal row with no close instant at all.
    #[test]
    fn test_an_impossible_clock_pages_rather_than_suppresses() {
        assert_eq!(
            page_decision(Some(&closed_at(9_000)), 1_000, WINDOW),
            PageDecision::Page,
            "closed in the future"
        );
        let no_close = Response {
            state: ResponseState::Resolved,
            ..sample(None, None)
        };
        assert_eq!(
            page_decision(Some(&no_close), 1_000, WINDOW),
            PageDecision::Page
        );
    }

    /// The flap is carried with how long the recovery held, because "back in
    /// 40s" and "back in 4m" are different facts to whoever reads the record.
    #[test]
    fn test_the_flap_carries_how_long_the_recovery_held() {
        let record = closed_at(1_000_000);
        let PageDecision::Flap {
            recovered_for_micros,
            response_id,
        } = page_decision(Some(&record), 41_000_000, WINDOW)
        else {
            panic!("inside the window this is a flap");
        };
        assert_eq!(response_id, "resp_1");
        assert_eq!(recovered_for_micros, 40_000_000);
        assert!(flap_note(recovered_for_micros).contains("40s"));
        assert!(flap_note(recovered_for_micros).contains("dampened"));
    }
}
