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

//! Project persisted or live RCA records into the verdict, evidence and hypothesis wire contract.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    BlindSpot, BlindSpotFix, EvidenceEntry, EvidenceLedger, HypothesisStatus, Impact, LeadingEntry,
    LedgerCall, OutcomeReason, Polarity, RcaOutcome, RcaRunRecord, TimelineEntry, TimelineStatus,
    build_evidence, build_ledger, leading, leading_history, status_rank, subject,
};
use crate::meta::{
    alerts::{rca_runs::RunState, rca_steering::STEER_ID_PREFIX},
    oncall::{
        agent::{ChangeKind, Confidence},
        confidence::{
            ConfidenceBreakdown, DATA_WINDOW_SLACK_US, SignalClass, ToolCallRecord,
            UnverifiedCitation, min_band, names_change,
        },
    },
};

/// The run summary route body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RcaRunSummary {
    pub run_id: String,
    pub state: RunState,
    pub state_version: String,
    pub not_modified: bool,
    /// A finished run with no stored record: only the report shows.
    pub legacy: bool,
    pub card: SummaryCard,
    #[serde(default)]
    pub timeline: Vec<SummaryTimelineEntry>,
    #[serde(default)]
    pub hypotheses: Vec<SummaryHypothesis>,
    #[serde(default)]
    pub evidence: Vec<EvidenceEntry>,
    #[serde(default)]
    pub unverified: Vec<UnverifiedCitation>,
    #[serde(default)]
    pub blind_spots: Vec<BlindSpot>,
}

/// The verdict card.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SummaryCard {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<RcaOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome_reason: Option<OutcomeReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headline: Option<String>,
    /// Live only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leading: Option<LeadingEntry>,
    /// Live only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verdict_so_far: Option<VerdictSoFar>,
    /// Graded runs only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub band: Option<Confidence>,
    /// Why the band is what it is; graded runs only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<ConfidenceBreakdown>,
    /// Completed runs only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suspect_change: Option<SummarySuspectChange>,
    /// Completed runs only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub impact: Option<Impact>,
    /// Blocked runs: the title of the first blind spot with a fix.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub needs: Option<String>,
    /// `multiple_root_causes` only: each root cause, in first-seen order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub causes: Vec<SummaryCause>,
}

/// One root cause of a run with several.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SummaryCause {
    pub id: String,
    pub statement: String,
    /// Microseconds; the agent's claim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub onset_us: Option<i64>,
    /// This cause's own band, never above the claimed one.
    pub band: Confidence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum VerdictSoFarLabel {
    Preliminary,
    Revised,
}

/// "Verdict so far" of a live run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct VerdictSoFar {
    pub label: VerdictSoFarLabel,
    /// Revised: the statement that led before the current one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub was: Option<String>,
}

/// The suspect change as code reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ShownChangeState {
    /// A verified change item supports a root_cause or contributing hypothesis.
    Confirmed,
    /// The diff was not read by a tool.
    NotRead,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SummarySuspectChange {
    pub kind: ChangeKind,
    pub reference: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Microseconds.
    pub occurred_at: i64,
    pub shown_state: ShownChangeState,
    /// The email of the author of the subject hypothesis' first steering lead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_author: Option<String>,
}

/// How a timeline entry shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TimelineView {
    Confirmed,
    Refuted,
    Likely,
    Unverified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SummaryTimelineEntry {
    /// Microseconds.
    pub at: i64,
    pub text: String,
    pub status: TimelineView,
    /// Numbers of the verified entries of the entry's evidence ids.
    #[serde(default)]
    pub evidence_numbers: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SummaryHypothesis {
    pub id: String,
    pub statement: String,
    pub status: HypothesisStatus,
    pub reason: String,
    /// Numbers of the evidence entries that cite this hypothesis.
    #[serde(default)]
    pub evidence_numbers: Vec<u32>,
    /// Evidence ids of this hypothesis that did not verify.
    #[serde(default)]
    pub unverified_ids: Vec<String>,
    #[serde(default)]
    pub lead_ids: Vec<String>,
    pub first_seen_seq: i64,
    /// Microseconds; the agent's claim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub onset_us: Option<i64>,
    #[serde(default)]
    pub history: Vec<SummaryStatusChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct SummaryStatusChange {
    /// Microseconds.
    pub at: i64,
    pub status: HypothesisStatus,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub run_ended: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steered_by: Option<String>,
}

/// Numbers of the entries that hold any of `ids`, in number order.
fn numbers_of<'a>(
    ids: impl IntoIterator<Item = &'a String>,
    evidence: &[EvidenceEntry],
) -> Vec<u32> {
    let ids: Vec<&String> = ids.into_iter().collect();
    evidence
        .iter()
        .filter(|e| e.ids.iter().any(|id| ids.contains(&id)))
        .map(|e| e.number)
        .collect()
}

/// Confirmed/refuted require every cited id to be verified evidence; otherwise show unverified.
pub(super) fn timeline_view(
    timeline: &[TimelineEntry],
    evidence: &[EvidenceEntry],
    unverified: &[UnverifiedCitation],
    cited_calls: &[ToolCallRecord],
) -> Vec<SummaryTimelineEntry> {
    let mut view: Vec<SummaryTimelineEntry> = timeline
        .iter()
        .map(|t| {
            let verified = timeline_entry_verified(t, evidence, unverified, cited_calls);
            let status = match t.status {
                TimelineStatus::Likely => TimelineView::Likely,
                TimelineStatus::Confirmed if verified => TimelineView::Confirmed,
                TimelineStatus::Refuted if verified => TimelineView::Refuted,
                TimelineStatus::Confirmed | TimelineStatus::Refuted => TimelineView::Unverified,
            };
            SummaryTimelineEntry {
                at: t.at_us,
                text: t.text.clone(),
                status,
                evidence_numbers: numbers_of(&t.evidence_ids, evidence),
            }
        })
        .collect();
    view.sort_by_key(|t| t.at);
    view
}

/// Each id names one evidence entry and no failed citation, and a cited data window covers `at`.
fn timeline_entry_verified(
    entry: &TimelineEntry,
    evidence: &[EvidenceEntry],
    unverified: &[UnverifiedCitation],
    cited_calls: &[ToolCallRecord],
) -> bool {
    if entry.evidence_ids.is_empty() {
        return false;
    }
    let mut windows = Vec::new();
    for id in &entry.evidence_ids {
        let mut holders = evidence.iter().filter(|e| e.ids.contains(id));
        let (Some(held), None) = (holders.next(), holders.next()) else {
            return false;
        };
        if unverified.iter().any(|u| u.evidence_id == *id) {
            return false;
        }
        if let Some(window) = cited_calls
            .iter()
            .find(|r| r.call_id == held.call_id)
            .and_then(ToolCallRecord::data_window)
        {
            windows.push(window);
        }
    }
    windows.is_empty()
        || windows.iter().any(|w| {
            w.start.saturating_sub(DATA_WINDOW_SLACK_US) <= entry.at_us
                && entry.at_us <= w.end.saturating_add(DATA_WINDOW_SLACK_US)
        })
}

/// Ranked by status rank and `first_seen_seq`, then `symptom`, then `ruled_out`.
fn hypotheses_view(
    ledger: &EvidenceLedger,
    evidence: &[EvidenceEntry],
    unverified: &[UnverifiedCitation],
    steer_authors: &BTreeMap<String, String>,
) -> Vec<SummaryHypothesis> {
    let order = |status: HypothesisStatus| {
        status_rank(status).unwrap_or(match status {
            HypothesisStatus::Symptom => 8,
            _ => 9,
        })
    };
    let mut hypotheses: Vec<_> = ledger.hypotheses.iter().collect();
    hypotheses.sort_by_key(|h| (order(h.status), h.first_seen_seq));
    hypotheses
        .into_iter()
        .map(|h| {
            let mut unverified_ids: Vec<String> = Vec::new();
            for u in unverified.iter().filter(|u| u.hypothesis_id == h.id) {
                if !unverified_ids.contains(&u.evidence_id) {
                    unverified_ids.push(u.evidence_id.clone());
                }
            }
            SummaryHypothesis {
                id: h.id.clone(),
                statement: h.statement.clone(),
                status: h.status,
                reason: h.reason.clone(),
                evidence_numbers: evidence
                    .iter()
                    .filter(|e| e.citations.iter().any(|c| c.hypothesis_id == h.id))
                    .map(|e| e.number)
                    .collect(),
                unverified_ids,
                lead_ids: h.lead_ids.clone(),
                first_seen_seq: h.first_seen_seq,
                onset_us: h.onset_us,
                history: h
                    .history
                    .iter()
                    .map(|c| SummaryStatusChange {
                        at: c.at_us,
                        status: c.status,
                        run_ended: c.run_ended,
                        steered_by: c
                            .trigger_steer_id
                            .as_ref()
                            .and_then(|id| steer_authors.get(id))
                            .cloned(),
                    })
                    .collect(),
            }
        })
        .collect()
}

// A waiting run has no stored verdict, so a shown change is either read or not read.
fn shown_change_state(
    ledger: &EvidenceLedger,
    evidence: &[EvidenceEntry],
    cited_calls: &[ToolCallRecord],
    reference: &str,
) -> ShownChangeState {
    let cause = |id: &str| {
        ledger.hypotheses.iter().any(|h| {
            h.id == id
                && matches!(
                    h.status,
                    HypothesisStatus::RootCause | HypothesisStatus::Contributing
                )
        })
    };
    let reads_reference = |e: &EvidenceEntry| {
        cited_calls
            .iter()
            .any(|r| r.call_id == e.call_id && names_change(reference, &r.key_arg))
    };
    let read = evidence
        .iter()
        .filter(|e| e.target == SignalClass::Change && reads_reference(e))
        .flat_map(|e| &e.citations)
        .any(|c| c.polarity == Polarity::Supports && cause(&c.hypothesis_id));
    if read {
        ShownChangeState::Confirmed
    } else {
        ShownChangeState::NotRead
    }
}

/// The title of the first blind spot with a fix.
pub(super) fn needs_title(blind_spots: &[BlindSpot]) -> Option<&str> {
    blind_spots
        .iter()
        .find(|b| b.fix != BlindSpotFix::None)
        .map(|b| b.title.as_str())
}

/// The email of the author of the subject hypothesis' first steering lead.
fn steering_lead(
    ledger: &EvidenceLedger,
    steer_authors: &BTreeMap<String, String>,
) -> Option<String> {
    subject(ledger)?
        .lead_ids
        .iter()
        .filter(|id| id.starts_with(STEER_ID_PREFIX))
        .find_map(|id| steer_authors.get(id))
        .cloned()
}

/// The summary of a finished run, from its stored record.
pub fn summary_from_record(
    run_id: &str,
    state: RunState,
    state_version: String,
    record: &RcaRunRecord,
) -> RcaRunSummary {
    let completed = state == RunState::Completed;
    let ledger = &record.ledger;
    let headline = match record.outcome {
        Some(
            RcaOutcome::RootCauseIdentified
            | RcaOutcome::MultipleRootCauses
            | RcaOutcome::ContributingFactor
            | RcaOutcome::Blocked,
        ) => record.verdict.as_ref().map(|v| v.probable_cause.clone()),
        Some(RcaOutcome::Inconclusive) => subject(ledger).map(|h| h.statement.clone()),
        None => None,
    };
    let causes = match (record.outcome, record.grade.as_ref()) {
        (Some(RcaOutcome::MultipleRootCauses), Some(grade)) => grade
            .causes
            .iter()
            .filter_map(|c| {
                let h = ledger.hypotheses.iter().find(|h| h.id == c.hypothesis_id)?;
                Some(SummaryCause {
                    id: h.id.clone(),
                    statement: h.statement.clone(),
                    onset_us: h.onset_us,
                    band: min_band(grade.claimed, c.graded),
                })
            })
            .collect(),
        _ => Vec::new(),
    };
    let suspect_change = record
        .verdict
        .as_ref()
        .and_then(|v| v.suspect_change.as_ref())
        .filter(|_| completed)
        .map(|c| SummarySuspectChange {
            kind: c.kind,
            reference: c.reference.clone(),
            author: c.author.clone(),
            occurred_at: c.occurred_at,
            shown_state: shown_change_state(
                ledger,
                &record.evidence,
                &record.cited_calls,
                &c.reference,
            ),
            lead_author: steering_lead(ledger, &record.steer_authors),
        });
    let card = SummaryCard {
        outcome: record.outcome,
        outcome_reason: record.outcome_reason,
        headline,
        leading: None,
        verdict_so_far: None,
        band: record.grade.as_ref().map(|g| g.band),
        confidence: record.grade.as_ref().map(|g| g.breakdown()),
        suspect_change,
        impact: record.impact.clone().filter(|_| completed),
        needs: (record.outcome == Some(RcaOutcome::Blocked))
            .then(|| {
                if record.outcome_reason == Some(OutcomeReason::AnswerDeadline) {
                    record
                        .answer_deadline_need
                        .clone()
                        .or_else(|| needs_title(&record.blind_spots).map(str::to_string))
                } else {
                    needs_title(&record.blind_spots).map(str::to_string)
                }
            })
            .flatten(),
        causes,
    };
    RcaRunSummary {
        run_id: run_id.to_string(),
        state,
        state_version,
        not_modified: false,
        legacy: false,
        card,
        timeline: timeline_view(
            &record.timeline,
            &record.evidence,
            &record.unverified,
            &record.cited_calls,
        ),
        hypotheses: hypotheses_view(
            ledger,
            &record.evidence,
            &record.unverified,
            &record.steer_authors,
        ),
        evidence: record.evidence.clone(),
        unverified: record.unverified.clone(),
        blind_spots: record.blind_spots.clone(),
    }
}

pub fn summary_live(
    run_id: &str,
    state: RunState,
    state_version: String,
    calls: &[LedgerCall],
    tool_log: &[ToolCallRecord],
    steer_authors: &BTreeMap<String, String>,
) -> RcaRunSummary {
    let (ledger, blind_spots, _) = build_ledger(calls, None);
    let ledger = ledger.unwrap_or_default();
    let (evidence, unverified) = build_evidence(Some(&ledger), tool_log);
    let lead = leading(&ledger).map(|h| LeadingEntry {
        id: h.id.clone(),
        statement: h.statement.clone(),
    });
    let verdict_so_far = lead.as_ref().map(|_| {
        let history = leading_history(calls);
        match history.len() {
            0 | 1 => VerdictSoFar {
                label: VerdictSoFarLabel::Preliminary,
                was: None,
            },
            n => VerdictSoFar {
                label: VerdictSoFarLabel::Revised,
                was: Some(history[n - 2].statement.clone()),
            },
        }
    });
    RcaRunSummary {
        run_id: run_id.to_string(),
        state,
        state_version,
        not_modified: false,
        legacy: false,
        card: SummaryCard {
            leading: lead,
            verdict_so_far,
            ..Default::default()
        },
        timeline: Vec::new(),
        hypotheses: hypotheses_view(&ledger, &evidence, &unverified, steer_authors),
        evidence,
        unverified,
        blind_spots,
    }
}

/// The summary of a finished run with no stored record.
pub fn summary_legacy(run_id: &str, state: RunState, state_version: String) -> RcaRunSummary {
    RcaRunSummary {
        run_id: run_id.to_string(),
        state,
        state_version,
        not_modified: false,
        legacy: true,
        card: SummaryCard::default(),
        timeline: Vec::new(),
        hypotheses: Vec::new(),
        evidence: Vec::new(),
        unverified: Vec::new(),
        blind_spots: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::meta::oncall::rca_run::{
        EndedBy, RunEndInput, SuspectChangeState,
        fixtures::{
            BASH, PROM, SQL, hyp, hyp_input, item, logs, prom, shell, spot, submit, submitted,
            suspect,
        },
        record_run_end,
    };

    fn log() -> Vec<ToolCallRecord> {
        vec![
            prom("m1", "pool_active", 1),
            logs("l1", "SELECT * FROM app", 2),
            shell("d1", "gh pr diff 812", 3, true),
            shell("d2", "gh pr diff 900", 4, false),
            shell("d3", "gh pr diff 901", 5, true),
        ]
    }

    fn record(
        calls: &[LedgerCall],
        verdict: Option<crate::meta::oncall::rca_run::SubmittedVerdict>,
        completed: bool,
    ) -> RcaRunRecord {
        record_steered(calls, verdict, completed, &BTreeMap::new())
    }

    /// [record] with the run's steer id → author email map.
    fn record_steered(
        calls: &[LedgerCall],
        verdict: Option<crate::meta::oncall::rca_run::SubmittedVerdict>,
        completed: bool,
        steer_authors: &BTreeMap<String, String>,
    ) -> RcaRunRecord {
        let log = log();
        let report = verdict.map(|v| submit(v, vec![]));
        record_run_end(&RunEndInput {
            submit: report.as_ref(),
            calls,
            tool_log: &log,
            stages_run: &[],
            ended_by: EndedBy::Agent,
            completed,
            steer_authors,
            ended_at_us: crate::meta::oncall::rca_run::fixtures::RUN_END_US,
        })
        .record
    }

    fn arao() -> BTreeMap<String, String> {
        BTreeMap::from([("stg_arao".to_string(), "a.rao@acme.io".to_string())])
    }

    fn h(seq: i64, id: &str, status: &str) -> LedgerCall {
        hyp(seq, id, status, vec![])
    }

    /// An inconclusive card shows the subject statement; with no subject, none.
    #[test]
    fn an_inconclusive_headline_is_the_subject_statement() {
        let r = record(
            &[h(1, "h1", "inconclusive"), h(2, "h2", "symptom")],
            Some(submitted("pool", Confidence::High)),
            true,
        );
        assert_eq!(r.outcome, Some(RcaOutcome::Inconclusive));
        let s = summary_from_record("r", RunState::Completed, "v".into(), &r);
        assert_eq!(s.card.headline.as_deref(), Some("h1 statement"));
        assert!(s.card.band.is_some() && s.card.confidence.is_some());

        let r = record(
            &[],
            Some(submitted("cause unknown", Confidence::High)),
            true,
        );
        let s = summary_from_record("r", RunState::Completed, "v".into(), &r);
        assert_eq!(s.card.headline, None);
        // The agent claimed high; with no ledger the floor names the missing hypotheses.
        let c = s.card.confidence.expect("graded");
        assert_eq!(
            (c.claimed, c.evidence, c.evidence_reason.as_str()),
            (Confidence::High, Confidence::Low, "no hypotheses recorded")
        );
    }

    /// Several graded root causes: the verdict's sentence heads the card, and each cause shows
    /// with its onset and its own band.
    #[test]
    fn several_root_causes_list_each_cause() {
        let root = |seq, id: &str, onset: Option<i64>, evidence| {
            let mut input = json!({"id": id, "statement": format!("{id} statement"),
                "status": "root_cause", "reason": "r", "evidence": evidence});
            if let Some(onset) = onset {
                input["onset"] = json!(onset);
            }
            hyp_input(seq, input)
        };
        let calls = [
            root(
                1,
                "h1",
                Some(1_000),
                vec![item("e1", PROM, "pool_active", "supports", "decisive")],
            ),
            root(
                2,
                "h2",
                None,
                vec![item("e2", SQL, "SELECT * FROM app", "supports", "decisive")],
            ),
        ];
        let r = record(
            &calls,
            Some(submitted(
                "pool shrank and the app crashed",
                Confidence::Medium,
            )),
            true,
        );
        assert_eq!(r.outcome, Some(RcaOutcome::MultipleRootCauses));
        let s = summary_from_record("r", RunState::Completed, "v".into(), &r);
        assert_eq!(
            s.card.headline.as_deref(),
            Some("pool shrank and the app crashed")
        );
        let causes: Vec<_> = s
            .card
            .causes
            .iter()
            .map(|c| (c.id.as_str(), c.statement.as_str(), c.onset_us, c.band))
            .collect();
        assert_eq!(
            causes,
            [
                ("h1", "h1 statement", Some(1_000), Confidence::Medium),
                ("h2", "h2 statement", None, Confidence::Medium),
            ]
        );
        assert_eq!(s.hypotheses[0].onset_us, Some(1_000));
        assert_eq!(
            s.card.confidence.unwrap().evidence_reason,
            "2 causes, each with a decisive source"
        );

        // One cause below medium: inconclusive, no cause list.
        let r = record(
            &[calls[0].clone(), root(2, "h2", None, vec![])],
            Some(submitted(
                "pool shrank and the app crashed",
                Confidence::Medium,
            )),
            true,
        );
        assert_eq!(r.outcome, Some(RcaOutcome::Inconclusive));
        let s = summary_from_record("r", RunState::Completed, "v".into(), &r);
        assert!(s.card.causes.is_empty());
        assert_eq!(s.card.headline.as_deref(), Some("h1 statement"));
    }

    #[test]
    fn hypotheses_keep_status_and_follow_the_display_order() {
        let r = record(
            &[h(1, "h1", "root_cause")],
            Some(submitted("pool", Confidence::High)),
            true,
        );
        assert_eq!(r.outcome, Some(RcaOutcome::Inconclusive));
        let s = summary_from_record("r", RunState::Completed, "v".into(), &r);
        assert_eq!(s.hypotheses[0].status, HypothesisStatus::RootCause);
        assert!(
            serde_json::to_value(&s.hypotheses[0])
                .unwrap()
                .get("label")
                .is_none()
        );

        let calls = [
            h(1, "h5", "ruled_out"),
            h(2, "h3", "symptom"),
            h(3, "h6", "blocked"),
            h(4, "h2", "contributing"),
            h(5, "h4", "ruled_out"),
            hyp_input(
                6,
                json!({"id": "h1", "statement": "s", "status": "testing", "reason": "r"}),
            ),
            hyp_input(
                9,
                json!({"id": "h1", "statement": "s", "status": "root_cause", "reason": "r", "trigger_steer_id": "stg_arao"}),
            ),
        ];
        let r = record_steered(
            &calls,
            Some(submitted("pool", Confidence::High)),
            true,
            &arao(),
        );
        let s = summary_from_record("r", RunState::Completed, "v".into(), &r);
        let order: Vec<&str> = s.hypotheses.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(order, ["h1", "h6", "h2", "h3", "h5", "h4"]);
        assert_eq!(
            s.hypotheses[0].history,
            vec![
                SummaryStatusChange {
                    at: 6_000_000,
                    status: HypothesisStatus::Testing,
                    run_ended: false,
                    steered_by: None
                },
                SummaryStatusChange {
                    at: 9_000_000,
                    status: HypothesisStatus::RootCause,
                    run_ended: false,
                    steered_by: Some("a.rao@acme.io".into())
                },
            ]
        );
        // A steer id with no known author names nobody.
        let r = record(&calls, Some(submitted("pool", Confidence::High)), true);
        let s = summary_from_record("r", RunState::Completed, "v".into(), &r);
        assert_eq!(s.hypotheses[0].history[1].steered_by, None);
    }

    /// The live card has the leading statement and the label, no band.
    #[test]
    fn the_live_card_shows_the_leading_hypothesis_and_no_band() {
        let pool = "Pool too small for the load after deploy 4f2c1e";
        let first = [hyp_input(
            1,
            json!({"id": "h1", "statement": pool, "status": "likely", "reason": "r",
                                          "evidence": [item("e1", PROM, "pool_active", "supports", "decisive")]}),
        )];
        let s = summary_live(
            "r",
            RunState::Running,
            "v".into(),
            &first,
            &log(),
            &BTreeMap::new(),
        );
        assert_eq!(s.card.band, None);
        assert_eq!(s.card.confidence, None);
        assert_eq!((s.card.outcome, s.card.headline.as_ref()), (None, None));
        assert_eq!(
            (s.card.suspect_change.as_ref(), s.card.impact.as_ref()),
            (None, None)
        );
        assert!(s.timeline.is_empty());
        assert_eq!(s.card.leading.as_ref().unwrap().statement, pool);
        assert_eq!(
            s.card.verdict_so_far,
            Some(VerdictSoFar {
                label: VerdictSoFarLabel::Preliminary,
                was: None
            })
        );
        assert_eq!(s.evidence.len(), 1);
        assert!(!s.legacy);

        let mut moved = first.to_vec();
        moved.push(hyp(2, "h2", "root_cause", vec![]));
        let s = summary_live(
            "r",
            RunState::Running,
            "v".into(),
            &moved,
            &log(),
            &BTreeMap::new(),
        );
        assert_eq!(s.card.leading.as_ref().unwrap().id, "h2");
        assert_eq!(
            s.card.verdict_so_far,
            Some(VerdictSoFar {
                label: VerdictSoFarLabel::Revised,
                was: Some(pool.to_string())
            })
        );
        // A testing hypothesis stays testing while live.
        let s = summary_live(
            "r",
            RunState::Running,
            "v".into(),
            &[h(1, "h1", "testing")],
            &[],
            &BTreeMap::new(),
        );
        assert_eq!(s.hypotheses[0].status, HypothesisStatus::Testing);

        let s = summary_live(
            "r",
            RunState::Running,
            "v".into(),
            &[spot(1, "b1", "logs", "none", "t")],
            &[],
            &BTreeMap::new(),
        );
        assert_eq!((s.card.leading, s.card.verdict_so_far), (None, None));
        assert_eq!(s.blind_spots.len(), 1);
    }

    /// The shown state of the suspect change is code-derived; the claim is ignored.
    #[test]
    fn the_suspect_change_state_is_derived() {
        let shown_with = |evidence: Vec<serde_json::Value>,
                          status: &str,
                          leads: &[&str],
                          authors: &BTreeMap<String, String>| {
            let calls = [hyp_input(
                1,
                json!({"id": "h1", "statement": "s", "status": status, "reason": "r",
                                             "lead_ids": leads, "evidence": evidence}),
            )];
            let mut v = submitted("pool", Confidence::High);
            v.suspect_change = Some(suspect(SuspectChangeState::Confirmed));
            let r = record_steered(&calls, Some(v), true, authors);
            summary_from_record("r", RunState::Completed, "v".into(), &r)
                .card
                .suspect_change
                .unwrap()
        };
        let shown = |evidence: Vec<serde_json::Value>, status: &str, leads: &[&str]| {
            shown_with(evidence, status, leads, &BTreeMap::new())
        };
        let diff = |q: &str, polarity: &str| item("e1", BASH, q, polarity, "decisive");
        let c = shown(vec![diff("gh pr diff 812", "supports")], "root_cause", &[]);
        assert_eq!(c.shown_state, ShownChangeState::Confirmed);
        assert_eq!(
            (c.reference.as_str(), c.author.as_deref(), c.lead_author),
            ("PR #812", Some("dana"), None)
        );
        assert_eq!(
            shown(
                vec![diff("gh pr diff 812", "supports")],
                "contributing",
                &[]
            )
            .shown_state,
            ShownChangeState::Confirmed
        );
        // The diff call failed (403), the claim says confirmed.
        assert_eq!(
            shown(vec![diff("gh pr diff 900", "supports")], "root_cause", &[]).shown_state,
            ShownChangeState::NotRead
        );
        // The diff read is another change's.
        assert_eq!(
            shown(vec![diff("gh pr diff 901", "supports")], "root_cause", &[]).shown_state,
            ShownChangeState::NotRead
        );
        assert_eq!(
            shown(
                vec![diff("gh pr diff 812", "contradicts")],
                "root_cause",
                &[]
            )
            .shown_state,
            ShownChangeState::NotRead
        );
        assert_eq!(
            shown(vec![diff("gh pr diff 812", "supports")], "symptom", &[]).shown_state,
            ShownChangeState::NotRead
        );
        assert_eq!(
            shown_with(vec![], "root_cause", &["past:inc_1", "stg_arao"], &arao())
                .lead_author
                .as_deref(),
            Some("a.rao@acme.io")
        );
        assert_eq!(
            shown(vec![], "root_cause", &["past:inc_1", "stg_arao"]).lead_author,
            None
        );
    }

    /// A cancelled run's card has no outcome or band; a legacy run is legacy.
    #[test]
    fn cancelled_and_legacy_runs_have_no_band() {
        let calls = [
            hyp(
                1,
                "h1",
                "testing",
                vec![item(
                    "e1",
                    SQL,
                    "SELECT * FROM app",
                    "supports",
                    "supporting",
                )],
            ),
            h(2, "h2", "untested"),
        ];
        let r = record(&calls, Some(submitted("pool", Confidence::High)), false);
        let s = summary_from_record("r", RunState::Cancelled, "v".into(), &r);
        assert_eq!(s.card, SummaryCard::default());
        assert_eq!(s.hypotheses.len(), 2);
        assert_eq!(s.hypotheses[0].status, HypothesisStatus::Untested);
        assert_eq!(s.evidence.len(), 1);
        assert_eq!(s.evidence[0].link.streams, ["app"]);

        let s = summary_legacy("r", RunState::Completed, "v".into());
        assert!(s.legacy);
        assert_eq!(s.card.band, None);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["card"], json!({}));
    }

    /// Unverified ids per hypothesis and the blocked `needs` title.
    #[test]
    fn blocked_cards_name_the_need_and_hypotheses_list_unverified_ids() {
        let calls = [
            hyp(
                1,
                "h1",
                "blocked",
                vec![
                    item("e7", PROM, "never", "supports", "decisive"),
                    item("e1", PROM, "pool_active", "supports", "supporting"),
                ],
            ),
            spot(2, "b1", "change", "connect_toolset", "Change history"),
        ];
        let r = record(&calls, Some(submitted("pool", Confidence::High)), true);
        let s = summary_from_record("r", RunState::Completed, "v".into(), &r);
        assert_eq!(s.card.outcome, Some(RcaOutcome::Blocked));
        assert_eq!(s.card.headline.as_deref(), Some("pool"));
        assert_eq!(s.card.needs.as_deref(), Some("Change history"));
        assert_eq!(s.hypotheses[0].unverified_ids, ["e7"]);
        assert_eq!(s.hypotheses[0].evidence_numbers, [1]);

        // A deadline-blocked run with no question need falls back to the blind spot.
        let mut r = r;
        r.outcome_reason = Some(OutcomeReason::AnswerDeadline);
        r.answer_deadline_need = None;
        let s = summary_from_record("r", RunState::Completed, "v".into(), &r);
        assert_eq!(s.card.needs.as_deref(), Some("Change history"));
        r.answer_deadline_need = Some("Owner of the pool change".into());
        let s = summary_from_record("r", RunState::Completed, "v".into(), &r);
        assert_eq!(s.card.needs.as_deref(), Some("Owner of the pool change"));
    }

    #[test]
    fn a_confirmed_timeline_entry_needs_every_id_verified_and_its_time_covered() {
        use crate::meta::oncall::rca_run::{TimeWindow, fixtures::RUN_END_US};

        const MIN: i64 = 60_000_000;
        let calls = [
            hyp(
                1,
                "h1",
                "root_cause",
                vec![
                    item("e1", PROM, "pool_active", "supports", "decisive"),
                    item("e2", SQL, "SELECT * FROM app", "supports", "decisive"),
                    item("e3", SQL, "SELECT * FROM app", "supports", "decisive"),
                    item("e4", PROM, "never", "supports", "decisive"),
                ],
            ),
            // e2 again, naming another call: the id no longer says which call.
            hyp(
                2,
                "h2",
                "ruled_out",
                vec![item("e2", BASH, "gh pr diff 812", "rules_out", "decisive")],
            ),
        ];
        let (ledger, ..) = build_ledger(&calls, Some(RUN_END_US));
        let mut log = log();
        log[0].observed = Some(TimeWindow {
            start: 10 * MIN,
            end: 20 * MIN,
        });
        let (evidence, unverified) = build_evidence(ledger.as_ref(), &log);
        let status = |at_us: i64, ids: &[&str]| {
            let entry = TimelineEntry {
                at_us,
                text: String::new(),
                status: TimelineStatus::Confirmed,
                evidence_ids: ids.iter().map(|id| id.to_string()).collect(),
            };
            timeline_view(&[entry], &evidence, &unverified, &log)[0].status
        };
        use TimelineView::{Confirmed, Unverified};
        assert_eq!(status(15 * MIN, &["e1"]), Confirmed);
        assert_eq!(status(21 * MIN, &["e1"]), Confirmed, "within a minute");
        assert_eq!(status(22 * MIN, &["e1"]), Unverified);
        assert_eq!(
            status(99 * MIN, &["e3"]),
            Confirmed,
            "the call has no window"
        );
        assert_eq!(status(15 * MIN, &["e1", "e3"]), Confirmed);
        assert_eq!(status(30 * MIN, &["e1", "e3"]), Unverified);
        assert_eq!(status(15 * MIN, &["e1", "e4"]), Unverified);
        assert_eq!(status(15 * MIN, &["e2"]), Unverified);
        assert_eq!(status(15 * MIN, &["e9"]), Unverified);
    }
}
