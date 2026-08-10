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

use super::{level::EscalationLevel, subject::SubjectRef};

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
        }
    }

    /// True for entries a person wrote, as opposed to engine bookkeeping.
    /// The UI shows these by default and folds the rest away.
    pub fn is_human_authored(&self) -> bool {
        matches!(self, Self::Note | Self::Ack | Self::Handoff)
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<EscalationLevel>,
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
            level: None,
        }
    }

    pub fn at_level(mut self, level: EscalationLevel) -> Self {
        self.level = Some(level);
        self
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

    /// Whether paging is currently suppressed.
    pub fn is_snoozed(&self, now: i64) -> bool {
        self.snoozed_until.is_some_and(|until| now < until)
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

    const KINDS: [ResponseEventKind; 8] = [
        ResponseEventKind::Sys,
        ResponseEventKind::Page,
        ResponseEventKind::Ack,
        ResponseEventKind::Note,
        ResponseEventKind::Rca,
        ResponseEventKind::Handoff,
        ResponseEventKind::Recovery,
        ResponseEventKind::State,
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
        let expected = [1, 2, 3, 4, 5, 6, 7, 8];
        for (k, want) in KINDS.iter().zip(expected) {
            assert_eq!(k.to_i32(), want, "{k} moved");
        }
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
        assert_eq!(ResponseEventKind::from_i32(9), None);
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
        ] {
            assert!(!k.is_human_authored(), "{k} is machine-generated");
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
    fn test_event_carries_an_optional_level() {
        let plain = ResponseEvent::new(ResponseEventKind::Note, 10, "ana@o2.ai", "looking");
        assert_eq!(plain.level, None);
        assert!(
            !serde_json::to_string(&plain).unwrap().contains("level"),
            "an absent level must not appear in the payload"
        );

        let paged = ResponseEvent::new(ResponseEventKind::Page, 10, "o2-engine", "sms sent")
            .at_level(EscalationLevel::Secondary);
        assert_eq!(paged.level, Some(EscalationLevel::Secondary));
        let back: ResponseEvent =
            serde_json::from_str(&serde_json::to_string(&paged).unwrap()).unwrap();
        assert_eq!(back, paged);
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
}
