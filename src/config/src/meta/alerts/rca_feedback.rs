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

//! Responder feedback on completed RCA runs, and the responder's cause correction on an
//! incident.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::rca_runs::string_enum;
use crate::meta::oncall::ResolutionCause;

/// Longest feedback or correction note, in Unicode scalar values after trimming.
pub const MAX_FEEDBACK_NOTE_CHARS: usize = 1000;
/// Most reasons a `no` verdict may carry (one per [FeedbackReason]).
pub const MAX_FEEDBACK_REASONS: usize = 4;

string_enum! {
    /// The responder's answer to "Is this the cause?".
    FeedbackVerdict {
        Yes => "yes",
        No => "no",
    }
}

string_enum! {
    /// Why a `no` verdict says the run's cause is wrong.
    FeedbackReason {
        WrongService => "wrong_service",
        SymptomNotCause => "symptom_not_cause",
        EvidenceDoesNotHold => "evidence_does_not_hold",
        MissedChange => "missed_change",
    }
}

/// One `rca_feedback` row. Times are µs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct RcaFeedback {
    pub org_id: String,
    pub run_id: String,
    pub author_email: String,
    pub incident_id: Option<String>,
    /// `incident` | `alert`, copied from the run.
    pub subject_type: String,
    /// Copied from the run; an alert id is stored bare (no `:group:<team>`).
    pub subject_id: String,
    pub verdict: FeedbackVerdict,
    pub note: Option<String>,
    /// Set for `no` only.
    #[serde(default)]
    pub reasons: Vec<FeedbackReason>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Body of `PUT …/rca/runs/{run_id}/feedback`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PutRcaFeedbackRequest {
    pub verdict: FeedbackVerdict,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub reasons: Option<Vec<FeedbackReason>>,
}

/// The validated content of a [PutRcaFeedbackRequest].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidFeedback {
    pub verdict: FeedbackVerdict,
    /// Trimmed; a blank note is `None`.
    pub note: Option<String>,
    pub reasons: Vec<FeedbackReason>,
}

impl PutRcaFeedbackRequest {
    pub fn validate(self) -> Result<ValidFeedback, String> {
        let note = valid_note(self.note.as_deref())?;
        let reasons = self.reasons.unwrap_or_default();
        match self.verdict {
            FeedbackVerdict::Yes => {
                if !reasons.is_empty() {
                    return Err("a `yes` verdict takes no reasons".to_string());
                }
            }
            FeedbackVerdict::No => {
                if reasons.len() > MAX_FEEDBACK_REASONS {
                    return Err(format!(
                        "at most {MAX_FEEDBACK_REASONS} reasons are allowed"
                    ));
                }
                for (i, r) in reasons.iter().enumerate() {
                    if reasons[..i].contains(r) {
                        return Err(format!("reason `{r}` is repeated"));
                    }
                }
            }
        }
        Ok(ValidFeedback {
            verdict: self.verdict,
            note,
            reasons,
        })
    }
}

/// Response of `GET …/rca/runs/{run_id}/feedback`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct ListRcaFeedbackResponse {
    /// Every author's row, oldest first.
    pub items: Vec<RcaFeedback>,
    /// The caller's row.
    pub mine: Option<RcaFeedback>,
}

/// One `rca_cause_corrections` row: what a responder says caused the incident. Times are µs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct RcaCauseCorrection {
    pub org_id: String,
    pub incident_id: String,
    pub author_email: String,
    pub cause: ResolutionCause,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Body of `PUT …/incidents/{incident_id}/rca/correction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PutRcaCauseCorrectionRequest {
    pub cause: ResolutionCause,
    #[serde(default)]
    pub note: Option<String>,
}

/// The validated content of a [PutRcaCauseCorrectionRequest].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidCorrection {
    pub cause: ResolutionCause,
    /// Trimmed; a blank note is `None`.
    pub note: Option<String>,
}

impl PutRcaCauseCorrectionRequest {
    pub fn validate(self) -> Result<ValidCorrection, String> {
        if self.cause == ResolutionCause::StillUnknown {
            return Err("`still_unknown` is not a cause".to_string());
        }
        Ok(ValidCorrection {
            cause: self.cause,
            note: valid_note(self.note.as_deref())?,
        })
    }
}

/// Response of `GET …/incidents/{incident_id}/rca/correction`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct ListRcaCauseCorrectionResponse {
    /// Every author's correction, oldest first.
    pub items: Vec<RcaCauseCorrection>,
    /// The caller's correction.
    pub mine: Option<RcaCauseCorrection>,
}

/// The trimmed note; blank is `None`, longer than [MAX_FEEDBACK_NOTE_CHARS] is an error.
fn valid_note(note: Option<&str>) -> Result<Option<String>, String> {
    let note = note.map(str::trim).filter(|n| !n.is_empty());
    if note.is_some_and(|n| n.chars().count() > MAX_FEEDBACK_NOTE_CHARS) {
        return Err(format!(
            "note must be at most {MAX_FEEDBACK_NOTE_CHARS} characters"
        ));
    }
    Ok(note.map(str::to_string))
}

pub fn bare_subject_id(subject_id: &str) -> &str {
    subject_id
        .split_once(":group:")
        .map_or(subject_id, |(base, _)| base)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_REASONS: [FeedbackReason; 4] = [
        FeedbackReason::WrongService,
        FeedbackReason::SymptomNotCause,
        FeedbackReason::EvidenceDoesNotHold,
        FeedbackReason::MissedChange,
    ];

    fn parse(body: serde_json::Value) -> Result<PutRcaFeedbackRequest, serde_json::Error> {
        serde_json::from_value(body)
    }

    fn validate(body: serde_json::Value) -> Result<ValidFeedback, String> {
        parse(body).expect("body parses").validate()
    }

    fn req(verdict: FeedbackVerdict) -> PutRcaFeedbackRequest {
        PutRcaFeedbackRequest {
            verdict,
            note: None,
            reasons: None,
        }
    }

    fn correction(body: serde_json::Value) -> Result<ValidCorrection, String> {
        serde_json::from_value::<PutRcaCauseCorrectionRequest>(body)
            .expect("body parses")
            .validate()
    }

    #[test]
    fn unknown_fields_and_values_are_rejected_when_parsing() {
        assert!(parse(serde_json::json!({"verdict": "yes", "author_email": "x"})).is_err());
        assert!(parse(serde_json::json!({"verdict": "maybe"})).is_err());
        assert!(parse(serde_json::json!({})).is_err(), "verdict is required");
        // The cause moved to the incident correction.
        assert!(parse(serde_json::json!({"verdict": "change"})).is_err());
        assert!(parse(serde_json::json!({"verdict": "no", "cause": "capacity_or_load"})).is_err());
        assert!(
            parse(serde_json::json!({"verdict": "no", "reasons": ["wrong_service", "bad_luck"]}))
                .is_err()
        );
        // Optional fields may be omitted or null.
        let ok =
            parse(serde_json::json!({"verdict": "no", "note": null, "reasons": null})).unwrap();
        assert_eq!(ok, req(FeedbackVerdict::No));
    }

    #[test]
    fn yes_takes_no_reasons() {
        assert_eq!(
            validate(serde_json::json!({"verdict": "yes"})).unwrap(),
            ValidFeedback {
                verdict: FeedbackVerdict::Yes,
                note: None,
                reasons: vec![],
            }
        );
        assert!(
            validate(serde_json::json!({"verdict": "yes", "reasons": ["wrong_service"]})).is_err()
        );
        // An empty reasons list is the same as none.
        assert!(validate(serde_json::json!({"verdict": "yes", "reasons": []})).is_ok());
    }

    #[test]
    fn no_takes_zero_to_four_distinct_reasons() {
        assert_eq!(
            validate(serde_json::json!({"verdict": "no"}))
                .unwrap()
                .reasons,
            vec![]
        );
        let all = validate(serde_json::json!({
            "verdict": "no",
            "reasons": ["missed_change", "wrong_service", "symptom_not_cause", "evidence_does_not_hold"],
        }))
        .unwrap();
        assert_eq!(
            all.reasons,
            vec![
                FeedbackReason::MissedChange,
                FeedbackReason::WrongService,
                FeedbackReason::SymptomNotCause,
                FeedbackReason::EvidenceDoesNotHold,
            ],
            "order is kept"
        );
        assert!(
            validate(
                serde_json::json!({"verdict": "no", "reasons": ["wrong_service", "wrong_service"]})
            )
            .is_err(),
            "duplicate"
        );
        assert!(
            validate(serde_json::json!({
                "verdict": "no",
                "reasons": ["missed_change", "wrong_service", "missed_change"],
            }))
            .is_err(),
            "non-adjacent duplicate"
        );
        let mut five = req(FeedbackVerdict::No);
        five.reasons = Some(
            ALL_REASONS
                .into_iter()
                .chain([FeedbackReason::WrongService])
                .collect(),
        );
        assert!(five.validate().is_err(), "more than four reasons");
    }

    #[test]
    fn a_correction_needs_a_real_cause_and_no_unknown_fields() {
        let parse = |body| serde_json::from_value::<PutRcaCauseCorrectionRequest>(body);
        assert!(parse(serde_json::json!({})).is_err(), "cause is required");
        assert!(parse(serde_json::json!({"cause": "cosmic_rays"})).is_err());
        assert!(
            parse(serde_json::json!({"cause": "capacity_or_load", "verdict": "no"})).is_err(),
            "unknown field"
        );
        assert!(correction(serde_json::json!({"cause": "still_unknown"})).is_err());
        for cause in ResolutionCause::ALL {
            let got = correction(serde_json::json!({"cause": cause.as_str(), "note": null}));
            if cause == ResolutionCause::StillUnknown {
                assert!(got.is_err(), "{cause:?}");
            } else {
                assert_eq!(
                    got.unwrap_or_else(|e| panic!("{cause:?}: {e}")),
                    ValidCorrection { cause, note: None }
                );
            }
        }
    }

    #[test]
    fn note_is_trimmed_blank_is_none_and_limit_counts_chars() {
        let note = |n: &str| {
            let mut r = req(FeedbackVerdict::Yes);
            r.note = Some(n.to_string());
            r.validate()
        };
        assert_eq!(
            note("  pool was raised \n").unwrap().note.as_deref(),
            Some("pool was raised")
        );
        assert_eq!(note("").unwrap().note, None);
        assert_eq!(note(" \n\t ").unwrap().note, None);

        let at_limit = "a".repeat(MAX_FEEDBACK_NOTE_CHARS);
        assert_eq!(note(&at_limit).unwrap().note, Some(at_limit.clone()));
        assert!(note(&"a".repeat(MAX_FEEDBACK_NOTE_CHARS + 1)).is_err());
        // Surrounding whitespace does not count.
        assert_eq!(
            note(&format!("   {at_limit}\n\n")).unwrap().note,
            Some(at_limit)
        );
        // Multi-byte chars: 1,000 `é` are 2,000 bytes but within the limit.
        let wide = "é".repeat(MAX_FEEDBACK_NOTE_CHARS);
        assert_eq!(note(&wide).unwrap().note, Some(wide));
        assert!(note(&"é".repeat(MAX_FEEDBACK_NOTE_CHARS + 1)).is_err());
        // The same rules apply to a correction's note.
        assert_eq!(
            correction(serde_json::json!({"cause": "capacity_or_load", "note": "  pool  "}))
                .unwrap()
                .note
                .as_deref(),
            Some("pool")
        );
        assert!(
            correction(serde_json::json!({
                "cause": "dependency_failure",
                "note": "x".repeat(MAX_FEEDBACK_NOTE_CHARS + 1),
            }))
            .is_err()
        );
    }

    /// Wire values are persisted; they round-trip through `FromStr` and serde.
    #[test]
    fn verdict_and_reason_wire_values_round_trip() {
        for v in [FeedbackVerdict::Yes, FeedbackVerdict::No] {
            assert_eq!(v.as_str().parse::<FeedbackVerdict>().unwrap(), v);
            assert_eq!(serde_json::to_value(v).unwrap(), v.as_str());
        }
        for r in ALL_REASONS {
            assert_eq!(r.as_str().parse::<FeedbackReason>().unwrap(), r);
            assert_eq!(serde_json::to_value(r).unwrap(), r.as_str());
        }
        assert!("Yes".parse::<FeedbackVerdict>().is_err());
        assert!("change".parse::<FeedbackVerdict>().is_err());
    }

    #[test]
    fn bare_subject_id_strips_the_group_suffix_only() {
        assert_eq!(bare_subject_id("alert_1:group:payments"), "alert_1");
        assert_eq!(bare_subject_id("alert_1"), "alert_1");
        assert_eq!(
            bare_subject_id("inc_2NjLm8W3pXyZqR7tVbK9cDfGhJ1"),
            "inc_2NjLm8W3pXyZqR7tVbK9cDfGhJ1"
        );
        assert_eq!(bare_subject_id("alert_1:group:"), "alert_1");
        assert_eq!(bare_subject_id("alert_1:group:a:group:b"), "alert_1");
        assert_eq!(bare_subject_id("a:b:c"), "a:b:c");
        assert_eq!(bare_subject_id(""), "");
    }
}
