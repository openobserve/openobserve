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

//! The outcome label of a completed run (03 VE14).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{EvidenceLedger, HypothesisStatus, RcaOutcome, SubmittedVerdict, leading};
use crate::meta::oncall::{agent::Confidence, confidence::ConfidenceGrade};

/// What ended the run's last turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EndedBy {
    /// The agent submitted, or the turn ended on its own.
    Agent,
    /// The answer deadline of a paused run closed it (04).
    AnswerDeadline,
}

/// The VE14 rule that set the outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeReason {
    AnswerDeadline,
    RootCauseGraded,
    AmbiguousCause,
    LeadingBlocked,
    ContributingGraded,
    CauseBelowMedium,
    NoHypothesis,
    NoConfirmedCause,
}

impl OutcomeReason {
    /// Stable wire value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AnswerDeadline => "answer_deadline",
            Self::RootCauseGraded => "root_cause_graded",
            Self::AmbiguousCause => "ambiguous_cause",
            Self::LeadingBlocked => "leading_blocked",
            Self::ContributingGraded => "contributing_graded",
            Self::CauseBelowMedium => "cause_below_medium",
            Self::NoHypothesis => "no_hypothesis",
            Self::NoConfirmedCause => "no_confirmed_cause",
        }
    }
}

/// `"cause unknown"`, trimmed, in any case.
pub(super) fn is_cause_unknown(probable_cause: &str) -> bool {
    probable_cause.trim().eq_ignore_ascii_case("cause unknown")
}

/// The VE14 table; the first rule that matches wins. `grade.band` is the band
/// before VE15. A `probable_cause` of "cause unknown" empties the `root_cause` set.
pub fn derive_outcome(
    ledger: Option<&EvidenceLedger>,
    grade: &ConfidenceGrade,
    verdict: &SubmittedVerdict,
    ended_by: EndedBy,
) -> (RcaOutcome, OutcomeReason) {
    if ended_by == EndedBy::AnswerDeadline {
        return (RcaOutcome::Blocked, OutcomeReason::AnswerDeadline);
    }
    let hypotheses = ledger.map(|l| l.hypotheses.as_slice()).unwrap_or_default();
    let root_causes = if is_cause_unknown(&verdict.probable_cause) {
        0
    } else {
        hypotheses
            .iter()
            .filter(|h| h.status == HypothesisStatus::RootCause)
            .count()
    };
    let graded = matches!(grade.band, Confidence::Medium | Confidence::High);

    if root_causes == 1 && graded {
        return (
            RcaOutcome::RootCauseIdentified,
            OutcomeReason::RootCauseGraded,
        );
    }
    if root_causes > 1 {
        return (RcaOutcome::Inconclusive, OutcomeReason::AmbiguousCause);
    }
    if root_causes == 0 {
        let leading_blocked = ledger
            .and_then(leading)
            .is_some_and(|h| h.status == HypothesisStatus::Blocked);
        if leading_blocked {
            return (RcaOutcome::Blocked, OutcomeReason::LeadingBlocked);
        }
        let contributing = hypotheses
            .iter()
            .any(|h| h.status == HypothesisStatus::Contributing);
        if contributing && graded {
            return (
                RcaOutcome::ContributingFactor,
                OutcomeReason::ContributingGraded,
            );
        }
    }
    if root_causes == 1 {
        return (RcaOutcome::Inconclusive, OutcomeReason::CauseBelowMedium);
    }
    if hypotheses.is_empty() {
        return (RcaOutcome::Inconclusive, OutcomeReason::NoHypothesis);
    }
    (RcaOutcome::Inconclusive, OutcomeReason::NoConfirmedCause)
}
