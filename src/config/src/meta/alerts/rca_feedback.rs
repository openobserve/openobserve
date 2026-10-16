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

//! Responder feedback on a finished RCA run ("Is this the cause?", README §9): one
//! `rca_feedback` row per run and author, the latest write wins.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::rca_runs::string_enum;
use crate::meta::oncall::ResolutionCause;

/// Longest feedback note, in Unicode scalar values after trimming.
pub const MAX_FEEDBACK_NOTE_CHARS: usize = 1000;
/// Most reasons a `no` verdict may carry (one per [FeedbackReason]).
pub const MAX_FEEDBACK_REASONS: usize = 4;

string_enum! {
    /// The responder's answer to "Is this the cause?".
    FeedbackVerdict {
        Yes => "yes",
        No => "no",
        /// The responder names the actual cause; it becomes a past-cause lead.
        Change => "change",
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
    /// Set for `change` only.
    pub cause: Option<ResolutionCause>,
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
    pub cause: Option<ResolutionCause>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub reasons: Option<Vec<FeedbackReason>>,
}

/// The validated content of a [PutRcaFeedbackRequest].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidFeedback {
    pub verdict: FeedbackVerdict,
    pub cause: Option<ResolutionCause>,
    /// Trimmed; a blank note is `None`.
    pub note: Option<String>,
    pub reasons: Vec<FeedbackReason>,
}

impl PutRcaFeedbackRequest {
    /// `change` needs a cause other than `still_unknown`; `no` takes 0–4 distinct reasons;
    /// `yes` takes neither; the note is optional, at most [MAX_FEEDBACK_NOTE_CHARS].
    pub fn validate(self) -> Result<ValidFeedback, String> {
        let note = self
            .note
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(str::to_string);
        if note
            .as_deref()
            .is_some_and(|n| n.chars().count() > MAX_FEEDBACK_NOTE_CHARS)
        {
            return Err(format!(
                "note must be at most {MAX_FEEDBACK_NOTE_CHARS} characters"
            ));
        }
        let reasons = self.reasons.unwrap_or_default();
        match self.verdict {
            FeedbackVerdict::Yes => {
                if self.cause.is_some() {
                    return Err("a `yes` verdict takes no cause".to_string());
                }
                if !reasons.is_empty() {
                    return Err("a `yes` verdict takes no reasons".to_string());
                }
            }
            FeedbackVerdict::No => {
                if self.cause.is_some() {
                    return Err("a `no` verdict takes no cause".to_string());
                }
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
            FeedbackVerdict::Change => {
                match self.cause {
                    None => return Err("a `change` verdict needs a cause".to_string()),
                    Some(ResolutionCause::StillUnknown) => {
                        return Err("`still_unknown` is not a cause".to_string());
                    }
                    Some(_) => {}
                }
                if !reasons.is_empty() {
                    return Err("a `change` verdict takes no reasons".to_string());
                }
            }
        }
        Ok(ValidFeedback {
            verdict: self.verdict,
            cause: self.cause,
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

/// The subject id feedback is keyed by: an alert's `<alert_id>:group:<team>` is stored as
/// the bare alert id, so every firing of the alert finds it.
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
            cause: None,
            note: None,
            reasons: None,
        }
    }

    /// J2: the body is `deny_unknown_fields`; unknown verdicts, causes and reasons are
    /// rejected at parse time.
    #[test]
    fn unknown_fields_and_values_are_rejected_when_parsing() {
        assert!(parse(serde_json::json!({"verdict": "yes", "author_email": "x"})).is_err());
        assert!(parse(serde_json::json!({"verdict": "maybe"})).is_err());
        assert!(parse(serde_json::json!({})).is_err(), "verdict is required");
        assert!(parse(serde_json::json!({"verdict": "change", "cause": "cosmic_rays"})).is_err());
        assert!(
            parse(serde_json::json!({"verdict": "no", "reasons": ["wrong_service", "bad_luck"]}))
                .is_err()
        );
        // Optional fields may be omitted or null.
        let ok = parse(
            serde_json::json!({"verdict": "no", "cause": null, "note": null, "reasons": null}),
        )
        .unwrap();
        assert_eq!(ok, req(FeedbackVerdict::No));
    }

    #[test]
    fn yes_takes_neither_cause_nor_reasons() {
        assert_eq!(
            validate(serde_json::json!({"verdict": "yes"})).unwrap(),
            ValidFeedback {
                verdict: FeedbackVerdict::Yes,
                cause: None,
                note: None,
                reasons: vec![],
            }
        );
        assert!(
            validate(serde_json::json!({"verdict": "yes", "reasons": ["wrong_service"]})).is_err()
        );
        assert!(
            validate(serde_json::json!({"verdict": "yes", "cause": "capacity_or_load"})).is_err()
        );
        // An empty reasons list is the same as none.
        assert!(validate(serde_json::json!({"verdict": "yes", "reasons": []})).is_ok());
    }

    #[test]
    fn no_takes_zero_to_four_distinct_reasons_and_no_cause() {
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
        assert!(
            validate(serde_json::json!({"verdict": "no", "cause": "capacity_or_load"})).is_err()
        );
    }

    #[test]
    fn change_needs_a_real_cause_and_takes_no_reasons() {
        assert!(validate(serde_json::json!({"verdict": "change"})).is_err());
        assert!(
            validate(serde_json::json!({"verdict": "change", "cause": "still_unknown"})).is_err()
        );
        assert!(
            validate(serde_json::json!({
                "verdict": "change",
                "cause": "capacity_or_load",
                "reasons": ["missed_change"],
            }))
            .is_err()
        );
        for cause in ResolutionCause::ALL {
            let mut r = req(FeedbackVerdict::Change);
            r.cause = Some(cause);
            let got = r.validate();
            if cause == ResolutionCause::StillUnknown {
                assert!(got.is_err(), "{cause:?}");
            } else {
                let v = got.unwrap_or_else(|e| panic!("{cause:?}: {e}"));
                assert_eq!(v.verdict, FeedbackVerdict::Change);
                assert_eq!(v.cause, Some(cause));
                assert!(v.reasons.is_empty());
            }
        }
    }

    /// The note is trimmed, a blank note is dropped, and the 1,000 limit counts chars
    /// (not bytes) after trimming.
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
        // The limit applies to every verdict.
        let mut change = req(FeedbackVerdict::Change);
        change.cause = Some(ResolutionCause::DependencyFailure);
        change.note = Some("x".repeat(MAX_FEEDBACK_NOTE_CHARS + 1));
        assert!(change.validate().is_err());
    }

    /// Wire values are persisted; they round-trip through `FromStr` and serde.
    #[test]
    fn verdict_and_reason_wire_values_round_trip() {
        for v in [
            FeedbackVerdict::Yes,
            FeedbackVerdict::No,
            FeedbackVerdict::Change,
        ] {
            assert_eq!(v.as_str().parse::<FeedbackVerdict>().unwrap(), v);
            assert_eq!(serde_json::to_value(v).unwrap(), v.as_str());
        }
        for r in ALL_REASONS {
            assert_eq!(r.as_str().parse::<FeedbackReason>().unwrap(), r);
            assert_eq!(serde_json::to_value(r).unwrap(), r.as_str());
        }
        assert!("Yes".parse::<FeedbackVerdict>().is_err());
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
