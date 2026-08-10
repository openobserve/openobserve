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

    /// Whether the ladder should still be escalating in this state.
    pub fn is_open(&self) -> bool {
        matches!(self, Self::Triggered | Self::Triaged)
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
    pub cause: Option<String>,
    /// `AlertPriority::to_i32` — the same scale alerts already use.
    pub priority: i32,
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
        assert!(ResponseState::Triggered.is_open());
        assert!(ResponseState::Triaged.is_open());
        assert!(!ResponseState::Acknowledged.is_open());
        assert!(!ResponseState::Resolved.is_open());
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
            priority: 2,
            state: ResponseState::Triggered,
            opened_at: 1_000,
            acked_by: acked_at.map(|_| "ana@o2.ai".to_string()),
            acked_at,
            closed_at,
            incident_id: None,
        }
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
