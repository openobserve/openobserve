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

//! The `submit_report` payload of an RCA run (03 VE1) and its mapping to the
//! [AnalysisVerdict] the paging pipeline reads.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::agent::{
    AnalysisVerdict, ChangeKind, Confidence, PageRecommendation, ProposedAction, SuspectChange,
};

/// Most timeline entries kept from one submit (VE1).
pub const MAX_TIMELINE_ENTRIES: usize = 20;

/// What the agent submits with `submit_report`. Unknown keys (e.g. a stray
/// `evidence_links`) are ignored (VE3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RcaSubmit {
    pub markdown: String,
    #[serde(default)]
    pub verdict: Option<SubmittedVerdict>,
    #[serde(default)]
    pub timeline: Vec<TimelineEntry>,
}

/// The verdict as the agent claims it, before grading.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SubmittedVerdict {
    pub probable_cause: String,
    pub claimed_confidence: Confidence,
    pub claimed_outcome: RcaOutcome,
    #[serde(default)]
    pub suspect_change: Option<SubmittedSuspectChange>,
    #[serde(default)]
    pub impacted_services: Vec<String>,
    #[serde(default)]
    pub impact: Option<Impact>,
    pub page_recommendation: PageRecommendation,
    #[serde(default)]
    pub proposed_actions: Vec<ProposedAction>,
    pub report_ref: String,
}

/// The suspect change with the agent's own reading of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SubmittedSuspectChange {
    pub kind: ChangeKind,
    pub reference: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Microseconds.
    pub occurred_at: i64,
    pub state: SuspectChangeState,
}

/// Whether the agent read the suspect change and tested it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SuspectChangeState {
    Confirmed,
    UnderTest,
    NotRead,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Impact {
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peak: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<TimeWindow>,
}

/// Microseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TimeWindow {
    pub start: i64,
    pub end: i64,
}

/// One entry of the causal timeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TimelineEntry {
    /// Microseconds.
    #[serde(rename = "at")]
    pub at_us: i64,
    pub text: String,
    pub status: TimelineStatus,
    #[serde(default)]
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TimelineStatus {
    Confirmed,
    Likely,
    Refuted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RcaOutcome {
    RootCauseIdentified,
    ContributingFactor,
    Inconclusive,
    Blocked,
}

/// Reads a committed `submit_report` input. `None` without a non-blank `markdown`.
/// An invalid `verdict` keeps the report with `verdict: None` (02 §9.1); invalid
/// timeline entries are dropped and at most [MAX_TIMELINE_ENTRIES] are kept.
pub fn parse_submit(input: &serde_json::Value) -> Option<RcaSubmit> {
    let markdown = input.get("markdown")?.as_str()?;
    if markdown.trim().is_empty() {
        return None;
    }
    let verdict = input
        .get("verdict")
        .filter(|v| !v.is_null())
        .and_then(|v| SubmittedVerdict::deserialize(v).ok());
    let timeline = input
        .get("timeline")
        .and_then(|v| v.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|e| TimelineEntry::deserialize(e).ok())
                .take(MAX_TIMELINE_ENTRIES)
                .collect()
        })
        .unwrap_or_default();
    Some(RcaSubmit {
        markdown: markdown.to_string(),
        verdict,
        timeline,
    })
}

/// Phase 2 mapping: confidence is the claimed one (grading comes later) and
/// `evidence_links` stays empty (VE3).
pub fn to_analysis_verdict(v: &SubmittedVerdict) -> AnalysisVerdict {
    AnalysisVerdict {
        probable_cause: v.probable_cause.clone(),
        confidence: v.claimed_confidence,
        suspect_change: v.suspect_change.as_ref().map(|c| SuspectChange {
            kind: c.kind,
            reference: c.reference.clone(),
            author: c.author.clone(),
            occurred_at: c.occurred_at,
        }),
        impacted_services: v.impacted_services.clone(),
        evidence_links: Vec::new(),
        page_recommendation: v.page_recommendation.clone(),
        proposed_actions: v.proposed_actions.clone(),
        report_ref: v.report_ref.clone(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::meta::{
        alerts::priority::AlertPriority,
        oncall::agent::{ActionKind, PageAction},
    };

    /// Every VE1 field, as `submit_report` sends it.
    fn full_payload() -> serde_json::Value {
        json!({
            "markdown": "# RCA\n\nThe querier leaks file descriptors.\n",
            "verdict": {
                "probable_cause": "fd leak introduced by querier v0.14.2",
                "claimed_confidence": "medium",
                "claimed_outcome": "root_cause_identified",
                "suspect_change": {
                    "kind": "deploy",
                    "reference": "querier v0.14.2",
                    "author": "ana",
                    "occurred_at": 1_700_000_000_000_000_i64,
                    "state": "under_test"
                },
                "impacted_services": ["service=querier"],
                "impact": {
                    "summary": "5xx on search",
                    "peak": "12% errors",
                    "window": {"start": 1_700_000_000_000_000_i64, "end": 1_700_000_600_000_000_i64}
                },
                "page_recommendation": {
                    "action": "page",
                    "severity_suggestion": "P2",
                    "reason": "predicted FD exhaustion in ~22 min"
                },
                "proposed_actions": [
                    {"title": "Roll back the querier", "kind": "rollback", "detail": "to v0.14.1"}
                ],
                "report_ref": "inc_9/rca/1"
            },
            "timeline": [
                {"at": 1_700_000_000_000_000_i64, "text": "querier v0.14.2 rolled out",
                 "status": "confirmed", "evidence_ids": ["e1"]},
                {"at": 1_700_000_100_000_000_i64, "text": "fd count climbs",
                 "status": "likely", "evidence_ids": []},
                {"at": 1_700_000_200_000_000_i64, "text": "network flake",
                 "status": "refuted", "evidence_ids": ["e2", "e3"]}
            ]
        })
    }

    /// VE1: every field of the payload reaches `RcaSubmit`.
    #[test]
    fn a_full_submit_payload_parses_every_field() {
        let submit = parse_submit(&full_payload()).expect("a full payload parses");
        assert_eq!(
            submit.markdown,
            "# RCA\n\nThe querier leaks file descriptors.\n"
        );
        let verdict = submit.verdict.expect("the verdict parses");
        assert_eq!(
            verdict,
            SubmittedVerdict {
                probable_cause: "fd leak introduced by querier v0.14.2".into(),
                claimed_confidence: Confidence::Medium,
                claimed_outcome: RcaOutcome::RootCauseIdentified,
                suspect_change: Some(SubmittedSuspectChange {
                    kind: ChangeKind::Deploy,
                    reference: "querier v0.14.2".into(),
                    author: Some("ana".into()),
                    occurred_at: 1_700_000_000_000_000,
                    state: SuspectChangeState::UnderTest,
                }),
                impacted_services: vec!["service=querier".into()],
                impact: Some(Impact {
                    summary: "5xx on search".into(),
                    peak: Some("12% errors".into()),
                    window: Some(TimeWindow {
                        start: 1_700_000_000_000_000,
                        end: 1_700_000_600_000_000,
                    }),
                }),
                page_recommendation: PageRecommendation {
                    action: PageAction::Page,
                    severity_suggestion: Some(AlertPriority::P2),
                    reason: "predicted FD exhaustion in ~22 min".into(),
                },
                proposed_actions: vec![ProposedAction {
                    title: "Roll back the querier".into(),
                    kind: ActionKind::Rollback,
                    detail: "to v0.14.1".into(),
                }],
                report_ref: "inc_9/rca/1".into(),
            }
        );
        assert_eq!(
            submit.timeline,
            vec![
                TimelineEntry {
                    at_us: 1_700_000_000_000_000,
                    text: "querier v0.14.2 rolled out".into(),
                    status: TimelineStatus::Confirmed,
                    evidence_ids: vec!["e1".into()],
                },
                TimelineEntry {
                    at_us: 1_700_000_100_000_000,
                    text: "fd count climbs".into(),
                    status: TimelineStatus::Likely,
                    evidence_ids: vec![],
                },
                TimelineEntry {
                    at_us: 1_700_000_200_000_000,
                    text: "network flake".into(),
                    status: TimelineStatus::Refuted,
                    evidence_ids: vec!["e2".into(), "e3".into()],
                },
            ]
        );
    }

    /// VE1/VE3: a stray `evidence_links` is ignored, at the top level and in the verdict.
    #[test]
    fn evidence_links_in_a_submit_are_ignored() {
        let mut payload = full_payload();
        payload["evidence_links"] = json!([{"label": "x", "url": "https://example.com"}]);
        payload["verdict"]["evidence_links"] =
            json!([{"label": "x", "url": "https://example.com"}]);
        let with_links = parse_submit(&payload).expect("parses with evidence_links");
        assert_eq!(with_links, parse_submit(&full_payload()).unwrap());
        assert!(with_links.verdict.is_some());
    }

    /// 02 §9.1: an invalid verdict keeps the report, with no verdict.
    #[test]
    fn an_invalid_claimed_confidence_keeps_the_report_without_a_verdict() {
        let mut payload = full_payload();
        payload["verdict"]["claimed_confidence"] = json!("certain");
        let submit = parse_submit(&payload).expect("the report is kept");
        assert_eq!(
            submit.markdown,
            "# RCA\n\nThe querier leaks file descriptors.\n"
        );
        assert_eq!(submit.verdict, None);
        assert_eq!(submit.timeline.len(), 3);
    }

    /// A submit without a non-blank `markdown` is no report.
    #[test]
    fn a_blank_or_missing_markdown_is_no_submit() {
        for markdown in [json!(""), json!("  \n\t "), json!(null), json!(42)] {
            let mut payload = full_payload();
            payload["markdown"] = markdown.clone();
            assert_eq!(parse_submit(&payload), None, "markdown {markdown}");
        }
        let mut payload = full_payload();
        payload.as_object_mut().unwrap().remove("markdown");
        assert_eq!(parse_submit(&payload), None);
    }

    /// VE1: at most 20 timeline entries are kept, in order.
    #[test]
    fn a_timeline_over_twenty_entries_keeps_the_first_twenty() {
        let mut payload = full_payload();
        payload["timeline"] = (0..25)
            .map(|i| json!({"at": i, "text": format!("step {i}"), "status": "likely"}))
            .collect();
        let submit = parse_submit(&payload).unwrap();
        assert_eq!(submit.timeline.len(), MAX_TIMELINE_ENTRIES);
        assert_eq!(MAX_TIMELINE_ENTRIES, 20);
        assert_eq!(
            submit.timeline.iter().map(|e| e.at_us).collect::<Vec<_>>(),
            (0..20).collect::<Vec<_>>()
        );
    }

    /// E3: Phase 2 maps confidence to the claimed band and sends no evidence links.
    #[test]
    fn the_analysis_verdict_uses_the_claimed_band_and_no_evidence_links() {
        let submitted = parse_submit(&full_payload()).unwrap().verdict.unwrap();
        for band in Confidence::ALL {
            let mut v = submitted.clone();
            v.claimed_confidence = band;
            assert_eq!(to_analysis_verdict(&v).confidence, band);
        }
        let verdict = to_analysis_verdict(&submitted);
        assert_eq!(
            verdict,
            AnalysisVerdict {
                probable_cause: "fd leak introduced by querier v0.14.2".into(),
                confidence: Confidence::Medium,
                suspect_change: Some(SuspectChange {
                    kind: ChangeKind::Deploy,
                    reference: "querier v0.14.2".into(),
                    author: Some("ana".into()),
                    occurred_at: 1_700_000_000_000_000,
                }),
                impacted_services: vec!["service=querier".into()],
                evidence_links: vec![],
                page_recommendation: submitted.page_recommendation.clone(),
                proposed_actions: submitted.proposed_actions.clone(),
                report_ref: "inc_9/rca/1".into(),
            }
        );
    }
}
