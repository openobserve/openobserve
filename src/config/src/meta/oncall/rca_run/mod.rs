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

//! RCA report parsing, evidence grading and final run-record policy.

use std::collections::BTreeMap;

mod evidence;
mod ledger;
mod outcome;
mod summary;

pub use evidence::{
    Citation, EvidenceEntry, EvidenceTarget, build_evidence, evidence_kind, evidence_target,
    summarize_result,
};
pub use ledger::{
    BlindSpot, BlindSpotAxis, BlindSpotFix, EvidenceItem, EvidenceLedger, Hypothesis,
    HypothesisStatus, LeadingEntry, LedgerCall, LedgerCounts, LedgerTool, MAX_BLIND_SPOTS,
    MAX_EVIDENCE_ITEMS, MAX_HYPOTHESES, MAX_QUERY_BYTES, MAX_TEXT_CHARS, MAX_TITLE_CHARS, Polarity,
    StatusChange, Strength, build_ledger, leading, leading_history, status_rank, subject,
};
pub use outcome::{EndedBy, OutcomeReason, derive_outcome};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Map, Value};
pub use summary::{
    RcaRunSummary, ShownChangeState, SummaryCard, SummaryHypothesis, SummaryStatusChange,
    SummarySuspectChange, SummaryTimelineEntry, TimelineView, VerdictSoFar, VerdictSoFarLabel,
    summary_from_record, summary_legacy, summary_live,
};
use utoipa::ToSchema;

use super::{
    agent::{
        AnalysisVerdict, ChangeKind, Confidence, EvidenceRef, PageAction, PageRecommendation,
        ProposedAction, SuspectChange,
    },
    confidence::{
        ConfidenceGrade, ToolCallRecord, UnverifiedCitation, apply_outcome, grade_confidence,
    },
};

/// Version of [RcaRunRecord] written to `rca_runs.result`.
pub const RCA_RECORD_SCHEMA_VERSION: u32 = 1;

/// The seven stages of the RCA protocol: the `record_step` stage name and its label (VE34).
pub const RCA_STAGES: [(&str, &str); 7] = [
    ("context", "Context"),
    ("topology", "Topology"),
    ("changes", "Changes"),
    ("traces", "Traces"),
    ("log_patterns", "Log patterns"),
    ("metrics", "Metrics"),
    ("converge", "Converge"),
];

pub fn protocol_stage(stage: &str) -> Option<&'static str> {
    RCA_STAGES
        .iter()
        .find(|(name, _)| *name == stage)
        .map(|(name, _)| *name)
}

pub fn stage_index(stage: &str) -> Option<i16> {
    RCA_STAGES
        .iter()
        .position(|(name, _)| *name == stage)
        .map(|index| (index + 1) as i16)
}

/// Most characters of a citation's observation in an [EvidenceRef] label (VE39).
const EVIDENCE_REF_OBSERVATION_CHARS: usize = 120;
/// Most decisive entries a verdict carries (VE38).
const MAX_VERDICT_EVIDENCE: usize = 5;

/// Most timeline entries kept from one submit (VE1).
pub const MAX_TIMELINE_ENTRIES: usize = 20;

/// What the agent submits with `submit_report`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RcaSubmit {
    pub markdown: String,
    #[serde(default)]
    pub verdict: Option<SubmittedVerdict>,
    #[serde(default)]
    pub timeline: Vec<TimelineEntry>,
    /// Submit repairs, hoisted fields and dropped values; empty when no repair was needed.
    #[serde(skip)]
    pub defects: Vec<String>,
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

impl RcaOutcome {
    /// Stable wire value, also stored in `rca_runs.outcome`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::RootCauseIdentified => "root_cause_identified",
            Self::ContributingFactor => "contributing_factor",
            Self::Inconclusive => "inconclusive",
            Self::Blocked => "blocked",
        }
    }
}

impl std::fmt::Display for RcaOutcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Keep usable report content while repairing known submit-shape drift; reject blank markdown.
pub fn parse_submit(input: &Value) -> Option<RcaSubmit> {
    let markdown = input.get("markdown")?.as_str()?;
    if markdown.trim().is_empty() {
        return None;
    }
    let mut defects = Vec::new();
    let verdict = parse_verdict(input, &mut defects);
    let timeline = input
        .get("timeline")
        .and_then(Value::as_array)
        .map(|entries| {
            let mut kept: Vec<TimelineEntry> = Vec::new();
            let mut invalid = 0;
            for entry in entries {
                match TimelineEntry::deserialize(entry) {
                    Ok(e) => kept.push(e),
                    Err(_) => invalid += 1,
                }
            }
            if invalid > 0 {
                defects.push(format!("timeline: {invalid} invalid entries dropped"));
            }
            if kept.len() > MAX_TIMELINE_ENTRIES {
                defects.push(format!(
                    "timeline: {} entries over {MAX_TIMELINE_ENTRIES} dropped",
                    kept.len() - MAX_TIMELINE_ENTRIES
                ));
                kept.truncate(MAX_TIMELINE_ENTRIES);
            }
            kept
        })
        .unwrap_or_default();
    Some(RcaSubmit {
        markdown: markdown.to_string(),
        verdict,
        timeline,
        defects,
    })
}

/// Where a verdict field was found.
enum Found<T> {
    InVerdict(T),
    TopLevel(T),
    /// Present in the verdict but invalid, and not valid at the top level.
    Invalid,
    Missing,
}

/// Reads the verdict fields of one `submit_report` input, recording repairs.
struct VerdictReader<'a> {
    verdict: &'a Map<String, Value>,
    top: &'a Value,
    defects: &'a mut Vec<String>,
}

impl VerdictReader<'_> {
    fn present<'v>(map: Option<&'v Map<String, Value>>, key: &str) -> Option<&'v Value> {
        map?.get(key).filter(|v| !v.is_null())
    }

    /// The field from the verdict, else from the top level; records a hoist.
    fn find<T>(&mut self, key: &str, parse: impl Fn(&Value) -> Option<T>) -> Found<T> {
        let in_verdict = Self::present(Some(self.verdict), key);
        if let Some(t) = in_verdict.and_then(&parse) {
            return Found::InVerdict(t);
        }
        if let Some(t) = Self::present(self.top.as_object(), key).and_then(&parse) {
            self.defects
                .push(format!("verdict.{key}: taken from top level"));
            return Found::TopLevel(t);
        }
        if in_verdict.is_some() {
            Found::Invalid
        } else {
            Found::Missing
        }
    }

    /// A required field with a safe default.
    fn required<T: DeserializeOwned>(&mut self, key: &str, default: T, used: &str) -> T {
        match self.find(key, |v| T::deserialize(v).ok()) {
            Found::InVerdict(t) | Found::TopLevel(t) => t,
            Found::Invalid => {
                self.defects
                    .push(format!("verdict.{key}: invalid, used {used}"));
                default
            }
            Found::Missing => {
                self.defects
                    .push(format!("verdict.{key}: missing, used {used}"));
                default
            }
        }
    }

    /// An optional field; an invalid value is dropped.
    fn optional<T: DeserializeOwned>(&mut self, key: &str) -> Option<T> {
        match self.find(key, |v| T::deserialize(v).ok()) {
            Found::InVerdict(t) | Found::TopLevel(t) => Some(t),
            Found::Invalid => {
                self.defects
                    .push(format!("verdict.{key}: invalid, dropped"));
                None
            }
            Found::Missing => None,
        }
    }

    /// A list field; entries that do not parse are dropped one by one.
    fn list<T: DeserializeOwned>(&mut self, key: &str) -> Vec<T> {
        let entries = match self.find(key, |v| v.as_array().cloned()) {
            Found::InVerdict(a) | Found::TopLevel(a) => a,
            Found::Invalid => {
                self.defects
                    .push(format!("verdict.{key}: not a list, dropped"));
                return Vec::new();
            }
            Found::Missing => return Vec::new(),
        };
        let total = entries.len();
        let kept: Vec<T> = entries
            .iter()
            .filter_map(|e| T::deserialize(e).ok())
            .collect();
        if kept.len() < total {
            self.defects.push(format!(
                "verdict.{key}: {} invalid entries dropped",
                total - kept.len()
            ));
        }
        kept
    }
}

fn parse_verdict(input: &Value, defects: &mut Vec<String>) -> Option<SubmittedVerdict> {
    let raw = input.get("verdict").filter(|v| !v.is_null());
    // A model sometimes sends the object as a JSON string.
    let decoded = raw
        .and_then(Value::as_str)
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .filter(Value::is_object);
    if decoded.is_some() {
        defects.push("verdict: was a JSON string".to_string());
    }
    let empty = Map::new();
    let verdict = match (decoded.as_ref().or(raw), raw) {
        (Some(Value::Object(map)), _) => map,
        (_, Some(_)) => {
            defects.push("verdict: not an object".to_string());
            &empty
        }
        (_, None) => &empty,
    };
    let mut r = VerdictReader {
        verdict,
        top: input,
        defects,
    };

    let non_blank = |v: &Value| {
        v.as_str()
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
    };
    let probable_cause = match r.find("probable_cause", non_blank) {
        Found::InVerdict(c) | Found::TopLevel(c) => c,
        Found::Invalid | Found::Missing => {
            r.defects.push(if raw.is_some() {
                "verdict: no probable_cause".to_string()
            } else {
                "verdict: missing".to_string()
            });
            return None;
        }
    };
    Some(SubmittedVerdict {
        probable_cause,
        claimed_confidence: r.required("claimed_confidence", Confidence::Low, "low"),
        claimed_outcome: r.required("claimed_outcome", RcaOutcome::Inconclusive, "inconclusive"),
        suspect_change: r.optional("suspect_change"),
        impacted_services: r.list("impacted_services"),
        impact: r.optional("impact"),
        page_recommendation: r.required(
            "page_recommendation",
            PageRecommendation {
                action: PageAction::Page,
                severity_suggestion: None,
                reason: String::new(),
            },
            "page",
        ),
        proposed_actions: r.list("proposed_actions"),
        report_ref: r.required("report_ref", String::new(), "empty"),
    })
}

pub fn to_analysis_verdict(
    v: &SubmittedVerdict,
    grade: &ConfidenceGrade,
    evidence: &[EvidenceEntry],
) -> AnalysisVerdict {
    AnalysisVerdict {
        probable_cause: v.probable_cause.clone(),
        confidence: grade.band,
        suspect_change: v.suspect_change.as_ref().map(|c| SuspectChange {
            kind: c.kind,
            reference: c.reference.clone(),
            author: c.author.clone(),
            occurred_at: c.occurred_at,
        }),
        impacted_services: v.impacted_services.clone(),
        evidence: evidence
            .iter()
            .filter(|e| e.decisive)
            .take(MAX_VERDICT_EVIDENCE)
            .map(|e| EvidenceRef {
                number: e.number,
                label: evidence_label(e),
            })
            .collect(),
        page_recommendation: v.page_recommendation.clone(),
        proposed_actions: v.proposed_actions.clone(),
        report_ref: v.report_ref.clone(),
    }
}

fn evidence_label(e: &EvidenceEntry) -> String {
    let place = e
        .link
        .streams
        .first()
        .map_or(e.target.as_str(), String::as_str);
    let observation: String = e
        .citations
        .first()
        .map(|c| {
            c.observation
                .chars()
                .take(EVIDENCE_REF_OBSERVATION_CHARS)
                .collect()
        })
        .unwrap_or_default();
    format!("{} · {place} · {observation}", e.kind)
}

/// What the agent claimed, kept for metrics and display only (VE19, VE35).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
pub struct VerdictClaims {
    pub confidence: Confidence,
    pub outcome: RcaOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suspect_change_state: Option<SuspectChangeState>,
}

/// The structured result of one run, stored in `rca_runs.result` (§11).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RcaRunRecord {
    /// [RCA_RECORD_SCHEMA_VERSION].
    pub schema_version: u32,
    /// `None`: failed, cancelled, or a deadline turn with no submit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verdict: Option<AnalysisVerdict>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claims: Option<VerdictClaims>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub impact: Option<Impact>,
    /// After VE15.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grade: Option<ConfidenceGrade>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<RcaOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome_reason: Option<OutcomeReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimed_outcome: Option<RcaOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_deadline_need: Option<String>,
    /// Empty when the run has none.
    #[serde(default)]
    pub ledger: EvidenceLedger,
    /// `false`: the agent never called `record_hypothesis`.
    #[serde(default)]
    pub has_ledger: bool,
    #[serde(default)]
    pub blind_spots: Vec<BlindSpot>,
    #[serde(default)]
    pub timeline: Vec<TimelineEntry>,
    #[serde(default)]
    pub evidence: Vec<EvidenceEntry>,
    #[serde(default)]
    pub unverified: Vec<UnverifiedCitation>,
    /// VE20.
    #[serde(default)]
    pub leading_history: Vec<LeadingEntry>,
    /// Only the calls that evidence entries use, in number order.
    #[serde(default)]
    pub cited_calls: Vec<ToolCallRecord>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub steer_authors: BTreeMap<String, String>,
}

/// What the finalizer read from the run's transcript.
#[derive(Debug, Clone, Copy)]
pub struct RunEndInput<'a> {
    /// The last committed `submit_report`.
    pub submit: Option<&'a RcaSubmit>,
    pub calls: &'a [LedgerCall],
    pub tool_log: &'a [ToolCallRecord],
    /// Stage names ([RCA_STAGES]) that have a step.
    pub stages_run: &'a [String],
    pub ended_by: EndedBy,
    /// `true` for a run that ends `completed`; `false` for failed or cancelled.
    pub completed: bool,
    /// The run's steer ids and their authors' emails (SG36).
    pub steer_authors: &'a BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunEndResult {
    pub record: RcaRunRecord,
    /// The graded verdict for the on-call ladder; same as `record.verdict`.
    pub verdict: Option<AnalysisVerdict>,
    pub counts: LedgerCounts,
    /// Timeline entries that show as Unverified (VE31).
    pub timeline_unverified: u32,
    /// `rca_summary.detail` (VE44): set only for a blocked outcome.
    pub summary_detail: Option<String>,
}

/// VE34: one blind spot naming the stages with no step; `None` when all ran.
fn run_end_blind_spot(stages_run: &[String]) -> Option<BlindSpot> {
    let missing: Vec<&str> = RCA_STAGES
        .iter()
        .filter(|(name, _)| !stages_run.iter().any(|s| s == name))
        .map(|(_, label)| *label)
        .collect();
    if missing.is_empty() {
        return None;
    }
    let title = match missing.len() {
        1 => "1 stage did not run".to_string(),
        n => format!("{n} stages did not run"),
    };
    Some(BlindSpot {
        id: "run_end".to_string(),
        axis: BlindSpotAxis::Other,
        title,
        why: missing.join(", "),
        fix: BlindSpotFix::ResumeRun,
    })
}

/// VE44: "Needs: <title>" of the first blind spot with a fix, else "Needs input".
fn blocked_detail(blind_spots: &[BlindSpot]) -> String {
    match summary::needs_title(blind_spots) {
        Some(title) => format!("Needs: {title}"),
        None => "Needs input".to_string(),
    }
}

/// Build the ledger, grade verified evidence and derive the final outcome in precedence order.
pub fn record_run_end(input: &RunEndInput) -> RunEndResult {
    let (ledger, mut blind_spots, counts) = build_ledger(input.calls, true);
    if !input.completed
        && let Some(spot) = run_end_blind_spot(input.stages_run)
    {
        blind_spots.push(spot);
    }
    let submit = input.submit.filter(|_| input.completed);
    let submitted = submit.and_then(|s| s.verdict.as_ref());
    let (evidence, unverified) = build_evidence(ledger.as_ref(), input.tool_log);

    let (grade, outcome) = match submitted {
        Some(v) => {
            let mut grade = grade_confidence(
                v,
                ledger.as_ref(),
                &blind_spots,
                input.tool_log,
                input.steer_authors,
            );
            let (outcome, reason) = derive_outcome(ledger.as_ref(), &grade, v, input.ended_by);
            apply_outcome(&mut grade, outcome, reason);
            (Some(grade), Some((outcome, reason)))
        }
        // VE16: a deadline turn with no report is blocked, with no verdict or band.
        None if input.completed && input.ended_by == EndedBy::AnswerDeadline => (
            None,
            Some((RcaOutcome::Blocked, OutcomeReason::AnswerDeadline)),
        ),
        None => (None, None),
    };

    let verdict = submitted
        .zip(grade.as_ref())
        .map(|(v, g)| to_analysis_verdict(v, g, &evidence));
    let timeline = submit.map(|s| s.timeline.clone()).unwrap_or_default();
    let timeline_unverified = summary::timeline_view(&timeline, &evidence)
        .iter()
        .filter(|t| t.status == TimelineView::Unverified)
        .count() as u32;
    let summary_detail = match outcome {
        Some((RcaOutcome::Blocked, _)) => Some(blocked_detail(&blind_spots)),
        _ => None,
    };
    let cited_calls = evidence
        .iter()
        .filter_map(|e| input.tool_log.iter().find(|r| r.call_id == e.call_id))
        .cloned()
        .collect();
    // SG36: the authors of the steer ids the ledger names.
    let steer_authors: BTreeMap<String, String> = ledger
        .iter()
        .flat_map(|l| &l.hypotheses)
        .flat_map(|h| {
            h.lead_ids.iter().chain(
                h.history
                    .iter()
                    .filter_map(|change| change.trigger_steer_id.as_ref()),
            )
        })
        .filter_map(|id| input.steer_authors.get_key_value(id))
        .map(|(id, author)| (id.clone(), author.clone()))
        .collect();

    let record = RcaRunRecord {
        schema_version: RCA_RECORD_SCHEMA_VERSION,
        verdict: verdict.clone(),
        claims: submitted.map(|v| VerdictClaims {
            confidence: v.claimed_confidence,
            outcome: v.claimed_outcome,
            suspect_change_state: v.suspect_change.as_ref().map(|c| c.state),
        }),
        impact: submitted.and_then(|v| v.impact.clone()),
        grade,
        outcome: outcome.map(|(o, _)| o),
        outcome_reason: outcome.map(|(_, r)| r),
        claimed_outcome: submitted.map(|v| v.claimed_outcome),
        answer_deadline_need: None,
        has_ledger: ledger.is_some(),
        ledger: ledger.unwrap_or_default(),
        blind_spots,
        timeline,
        evidence,
        unverified,
        leading_history: leading_history(input.calls),
        cited_calls,
        steer_authors,
    };
    RunEndResult {
        record,
        verdict,
        counts,
        timeline_unverified,
        summary_detail,
    }
}

/// Builders shared by the ledger, evidence, outcome, summary and grade tests.
#[cfg(test)]
pub(crate) mod fixtures {
    use serde_json::{Value, json};

    use super::*;
    use crate::meta::oncall::{
        agent::PageAction,
        confidence::{signal_class, stream_type},
    };

    /// One `record_hypothesis` call; `at_us` is `seq` seconds.
    pub(crate) fn hyp(seq: i64, id: &str, status: &str, evidence: Vec<Value>) -> LedgerCall {
        hyp_input(
            seq,
            json!({
                "id": id,
                "statement": format!("{id} statement"),
                "status": status,
                "reason": format!("{id} reason"),
                "evidence": evidence,
            }),
        )
    }

    pub(crate) fn hyp_input(seq: i64, input: Value) -> LedgerCall {
        LedgerCall {
            seq,
            at_us: seq * 1_000_000,
            tool: LedgerTool::Hypothesis,
            input,
        }
    }

    /// One evidence item; the observation is `<id> obs`.
    pub(crate) fn item(id: &str, tool: &str, query: &str, polarity: &str, strength: &str) -> Value {
        json!({
            "id": id,
            "tool": tool,
            "query": query,
            "polarity": polarity,
            "strength": strength,
            "observation": format!("{id} obs"),
        })
    }

    pub(crate) fn spot(seq: i64, id: &str, axis: &str, fix: &str, title: &str) -> LedgerCall {
        LedgerCall {
            seq,
            at_us: seq * 1_000_000,
            tool: LedgerTool::BlindSpot,
            input: json!({"id": id, "axis": axis, "title": title, "why": "why", "fix": fix}),
        }
    }

    /// A tool log record with the signal and target derived from `input`, as the decoder does.
    pub(crate) fn rec(
        call_id: &str,
        tool: &str,
        key_arg: &str,
        input: Value,
        started_at_us: i64,
        success: bool,
    ) -> ToolCallRecord {
        ToolCallRecord {
            call_id: call_id.into(),
            tool: tool.into(),
            key_arg: key_arg.into(),
            stream_type: stream_type(tool, &input),
            success,
            result_count: None,
            started_at_us,
            duration_ms: 12,
            error_type: (!success).then(|| "http_403".to_string()),
            signal: signal_class(tool, &input),
            target: evidence_target(tool, &input),
            result_summary: format!("{call_id} summary"),
        }
    }

    pub(crate) const PROM: &str = "PrometheusRangeQuery";
    pub(crate) const TRACES: &str = "GetLatestTraces";
    pub(crate) const SQL: &str = "SearchSQL";
    pub(crate) const BASH: &str = "bash";

    pub(crate) fn prom(call_id: &str, query: &str, started: i64) -> ToolCallRecord {
        rec(call_id, PROM, query, json!({"query": query}), started, true)
    }

    pub(crate) fn traces(call_id: &str, filter: &str, started: i64) -> ToolCallRecord {
        rec(
            call_id,
            TRACES,
            filter,
            json!({"stream_name": "default", "filter": filter}),
            started,
            true,
        )
    }

    pub(crate) fn logs(call_id: &str, sql: &str, started: i64) -> ToolCallRecord {
        rec(
            call_id,
            SQL,
            sql,
            json!({"type": "logs", "request_body": {"query": {"sql": sql}}}),
            started,
            true,
        )
    }

    pub(crate) fn shell(
        call_id: &str,
        command: &str,
        started: i64,
        success: bool,
    ) -> ToolCallRecord {
        rec(
            call_id,
            BASH,
            command,
            json!({"command": command}),
            started,
            success,
        )
    }

    pub(crate) fn submitted(cause: &str, claimed: Confidence) -> SubmittedVerdict {
        SubmittedVerdict {
            probable_cause: cause.into(),
            claimed_confidence: claimed,
            claimed_outcome: RcaOutcome::RootCauseIdentified,
            suspect_change: None,
            impacted_services: vec![],
            impact: None,
            page_recommendation: PageRecommendation {
                action: PageAction::Page,
                severity_suggestion: None,
                reason: "page".into(),
            },
            proposed_actions: vec![],
            report_ref: "inc_1/rca/1".into(),
        }
    }

    pub(crate) fn submit(verdict: SubmittedVerdict, timeline: Vec<TimelineEntry>) -> RcaSubmit {
        RcaSubmit {
            markdown: "# RCA".into(),
            verdict: Some(verdict),
            timeline,
            defects: Vec::new(),
        }
    }

    pub(crate) fn suspect(state: SuspectChangeState) -> SubmittedSuspectChange {
        SubmittedSuspectChange {
            kind: ChangeKind::Deploy,
            reference: "PR #812".into(),
            author: Some("dana".into()),
            occurred_at: 1_000,
            state,
        }
    }

    pub(crate) fn ledger_of(calls: &[LedgerCall]) -> Option<EvidenceLedger> {
        build_ledger(calls, true).0
    }

    pub(crate) fn hypothesis<'a>(ledger: &'a EvidenceLedger, id: &str) -> &'a Hypothesis {
        ledger
            .hypotheses
            .iter()
            .find(|h| h.id == id)
            .unwrap_or_else(|| panic!("{id} is in the ledger"))
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

    #[test]
    fn an_invalid_claimed_confidence_keeps_the_verdict_at_low() {
        let mut payload = full_payload();
        payload["verdict"]["claimed_confidence"] = json!("certain");
        let submit = parse_submit(&payload).expect("the report is kept");
        assert_eq!(
            submit.markdown,
            "# RCA\n\nThe querier leaks file descriptors.\n"
        );
        let verdict = submit.verdict.expect("the verdict is kept");
        assert_eq!(verdict.claimed_confidence, Confidence::Low);
        assert_eq!(
            verdict.probable_cause,
            "fd leak introduced by querier v0.14.2"
        );
        assert_eq!(
            submit.defects,
            ["verdict.claimed_confidence: invalid, used low"]
        );
        assert_eq!(submit.timeline.len(), 3);
    }

    /// A clean payload has no defects; `defects` is never serialized.
    #[test]
    fn a_clean_payload_has_no_defects() {
        let submit = parse_submit(&full_payload()).unwrap();
        assert!(submit.defects.is_empty(), "{:?}", submit.defects);
        let mut with_defects = submit.clone();
        with_defects.defects.push("x".into());
        assert!(
            serde_json::to_value(&with_defects)
                .unwrap()
                .get("defects")
                .is_none()
        );
    }

    fn s1_payload() -> serde_json::Value {
        json!({
            "report_ref": "3KlHVcu4eNrJQlXXtnDoxGa3Fij",
            "markdown": "# Incident Analysis Report\n\n## Subject Summary\n- **Subject**",
            "verdict": {
                "probable_cause": "checkout_p3s1 is returning HTTP 504 gateway timeouts because its upstream dependency payments-gateway fails to respond to POST /v1/charges within the 5000ms timeout.",
                "claimed_confidence": "medium",
                "claimed_outcome": "root_cause_identified",
                "impacted_services": ["team1/checkout_p3s1"],
                "impact": {
                    "summary": "checkout_p3s1 intermittently failed to complete charges: 14 of 40 requests (35%) returned 504 gateway timeouts from payments-gateway.",
                    "peak": "35% error rate (14/40 requests)",
                    "window": {"start": 1_792_125_018_548_309_i64, "end": 1_792_125_252_548_309_i64}
                },
                "page_recommendation": {
                    "action": "page",
                    "reason": "Intermittent 504 gateway timeouts are ongoing on checkout_p3s1 and the upstream payments-gateway requires investigation."
                },
                "proposed_actions": [
                    {"title": "Investigate payments-gateway upstream health", "kind": "runbook",
                     "detail": "Check payments-gateway latency, CPU/memory saturation, and recent deploys; its response to POST /v1/charges exceeds the 5000ms client timeout."},
                    {"title": "Confirm checkout gateway timeout is intended", "kind": "other",
                     "detail": "Verify the 5000ms checkout-to-gateway timeout is deliberate and consider a circuit-breaker/backoff while the upstream is degraded."}
                ]
            },
            "timeline": [
                {"at": 1_792_125_018_548_309_i64, "text": "First error log", "status": "confirmed", "evidence_ids": ["e1", "e2"]},
                {"at": 1_792_125_252_548_309_i64, "text": "Last of 14 error events", "status": "confirmed", "evidence_ids": ["e2", "e3"]},
                {"at": 1_792_125_258_724_170_i64, "text": "Alert fires", "status": "confirmed", "evidence_ids": []},
                {"at": 1_792_125_259_759_072_i64, "text": "Alert fires again", "status": "confirmed", "evidence_ids": []}
            ]
        })
    }

    /// 02 §9.1 leniency: each repair, as one table test.
    #[test]
    fn lenient_submit_repairs_are_listed() {
        let remove = |mut p: serde_json::Value, key: &str| {
            p["verdict"].as_object_mut().unwrap().remove(key);
            p
        };
        let set = |mut p: serde_json::Value, ptr: &str, v: serde_json::Value| {
            *p.pointer_mut(ptr).unwrap() = v;
            p
        };
        let mut as_string = full_payload();
        as_string["verdict"] = json!(as_string["verdict"].to_string());
        let no_verdict = {
            let mut p = full_payload();
            p.as_object_mut().unwrap().remove("verdict");
            p
        };
        let mut top_cause = remove(full_payload(), "probable_cause");
        top_cause["probable_cause"] = json!("cause from the top");

        // (case, payload, probable_cause or None, defects)
        let cases: Vec<(&str, serde_json::Value, Option<&str>, Vec<&str>)> = vec![
            (
                "S1: top-level report_ref hoisted",
                s1_payload(),
                Some(
                    "checkout_p3s1 is returning HTTP 504 gateway timeouts because its upstream dependency payments-gateway fails to respond to POST /v1/charges within the 5000ms timeout.",
                ),
                vec!["verdict.report_ref: taken from top level"],
            ),
            (
                "top-level probable_cause hoisted",
                top_cause,
                Some("cause from the top"),
                vec!["verdict.probable_cause: taken from top level"],
            ),
            (
                "missing claimed_outcome",
                remove(full_payload(), "claimed_outcome"),
                Some("fd leak introduced by querier v0.14.2"),
                vec!["verdict.claimed_outcome: missing, used inconclusive"],
            ),
            (
                "missing page_recommendation",
                remove(full_payload(), "page_recommendation"),
                Some("fd leak introduced by querier v0.14.2"),
                vec!["verdict.page_recommendation: missing, used page"],
            ),
            (
                "missing report_ref",
                remove(full_payload(), "report_ref"),
                Some("fd leak introduced by querier v0.14.2"),
                vec!["verdict.report_ref: missing, used empty"],
            ),
            (
                "missing claimed_confidence",
                remove(full_payload(), "claimed_confidence"),
                Some("fd leak introduced by querier v0.14.2"),
                vec!["verdict.claimed_confidence: missing, used low"],
            ),
            (
                "no probable_cause",
                remove(full_payload(), "probable_cause"),
                None,
                vec!["verdict: no probable_cause"],
            ),
            (
                "blank probable_cause",
                set(full_payload(), "/verdict/probable_cause", json!("  ")),
                None,
                vec!["verdict: no probable_cause"],
            ),
            (
                "no verdict at all",
                no_verdict,
                None,
                vec!["verdict: missing"],
            ),
            (
                "verdict not an object",
                set(full_payload(), "/verdict", json!(42)),
                None,
                vec!["verdict: not an object", "verdict: no probable_cause"],
            ),
            (
                "JSON-string verdict",
                as_string,
                Some("fd leak introduced by querier v0.14.2"),
                vec!["verdict: was a JSON string"],
            ),
            (
                "invalid list entries dropped",
                set(
                    full_payload(),
                    "/verdict/proposed_actions",
                    json!([{"title": "ok", "kind": "rollback", "detail": "d"}, {"title": "bad", "kind": "rollback"}, 7]),
                ),
                Some("fd leak introduced by querier v0.14.2"),
                vec!["verdict.proposed_actions: 2 invalid entries dropped"],
            ),
            (
                "list that is not a list",
                set(
                    full_payload(),
                    "/verdict/impacted_services",
                    json!("service=querier"),
                ),
                Some("fd leak introduced by querier v0.14.2"),
                vec!["verdict.impacted_services: not a list, dropped"],
            ),
            (
                "invalid optional dropped",
                set(
                    full_payload(),
                    "/verdict/suspect_change",
                    json!({"kind": "rumour"}),
                ),
                Some("fd leak introduced by querier v0.14.2"),
                vec!["verdict.suspect_change: invalid, dropped"],
            ),
            (
                "invalid timeline entries dropped",
                set(
                    full_payload(),
                    "/timeline/1",
                    json!({"at": "noon", "text": "x", "status": "likely"}),
                ),
                Some("fd leak introduced by querier v0.14.2"),
                vec!["timeline: 1 invalid entries dropped"],
            ),
        ];
        for (case, payload, cause, defects) in cases {
            let submit =
                parse_submit(&payload).unwrap_or_else(|| panic!("{case}: the report is kept"));
            assert_eq!(
                submit.verdict.as_ref().map(|v| v.probable_cause.as_str()),
                cause,
                "{case}"
            );
            assert_eq!(submit.defects, defects, "{case}");
        }

        // The repaired values themselves.
        let s1 = parse_submit(&s1_payload()).unwrap();
        let v = s1.verdict.unwrap();
        assert_eq!(v.report_ref, "3KlHVcu4eNrJQlXXtnDoxGa3Fij");
        assert_eq!(
            (v.claimed_confidence, v.claimed_outcome),
            (Confidence::Medium, RcaOutcome::RootCauseIdentified)
        );
        assert_eq!(v.proposed_actions.len(), 2);
        assert_eq!(s1.timeline.len(), 4);

        let v = parse_submit(&remove(full_payload(), "claimed_outcome"))
            .unwrap()
            .verdict
            .unwrap();
        assert_eq!(v.claimed_outcome, RcaOutcome::Inconclusive);
        let v = parse_submit(&remove(full_payload(), "page_recommendation"))
            .unwrap()
            .verdict
            .unwrap();
        assert_eq!(
            v.page_recommendation,
            PageRecommendation {
                action: PageAction::Page,
                severity_suggestion: None,
                reason: String::new()
            }
        );
        let v = parse_submit(&remove(full_payload(), "report_ref"))
            .unwrap()
            .verdict
            .unwrap();
        assert_eq!(v.report_ref, "");
        let mut as_string = full_payload();
        as_string["verdict"] = json!(as_string["verdict"].to_string());
        assert_eq!(
            parse_submit(&as_string).unwrap().verdict,
            parse_submit(&full_payload()).unwrap().verdict
        );
        let v = parse_submit(&set(full_payload(), "/verdict/proposed_actions",
            json!([{"title": "ok", "kind": "rollback", "detail": "d"}, {"title": "bad", "kind": "rollback"}])))
            .unwrap().verdict.unwrap();
        assert_eq!(
            v.proposed_actions
                .iter()
                .map(|a| a.title.as_str())
                .collect::<Vec<_>>(),
            ["ok"]
        );
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
        assert_eq!(submit.defects, ["timeline: 5 entries over 20 dropped"]);
    }
    mod run_end_tests {
        use serde_json::{Value, json};

        use super::{fixtures::*, *};
        use crate::meta::{
            alerts::priority::AlertPriority,
            oncall::{
                agent::{
                    AnalysisState, AnalysisStatus, L0Mode, L0Modes, L0Policy, PageAction,
                    VerdictOutcome, apply_verdict,
                },
                confidence::{GradeReason, SignalClass, min_band},
            },
        };

        fn decisive(id: &str, tool: &str, q: &str) -> Value {
            item(id, tool, q, "supports", "decisive")
        }

        fn tool_log() -> Vec<ToolCallRecord> {
            vec![
                prom("m1", "pool_active", 1),
                traces("t1", "slow", 2),
                logs("l1", "SELECT * FROM app", 3),
            ]
        }

        fn h(seq: i64, id: &str, status: &str) -> LedgerCall {
            hyp(seq, id, status, vec![])
        }

        fn root_with_two_classes(seq: i64, id: &str, leads: &[&str]) -> LedgerCall {
            hyp_input(
                seq,
                json!({"id": id, "statement": format!("{id} statement"), "status": "root_cause", "reason": "r",
                   "lead_ids": leads,
                   "evidence": [decisive("e1", PROM, "pool_active"), decisive("e2", TRACES, "slow")]}),
            )
        }

        fn ruled_out_verified(seq: i64, id: &str) -> LedgerCall {
            hyp(
                seq,
                id,
                "ruled_out",
                vec![item(
                    "e3",
                    SQL,
                    "SELECT * FROM app",
                    "rules_out",
                    "supporting",
                )],
            )
        }

        fn with_metric(seq: i64, id: &str, status: &str, strength: &str) -> LedgerCall {
            hyp(
                seq,
                id,
                status,
                vec![item("e1", PROM, "pool_active", "supports", strength)],
            )
        }

        fn stages(n: usize) -> Vec<String> {
            RCA_STAGES
                .iter()
                .take(n)
                .map(|(s, _)| s.to_string())
                .collect()
        }

        struct Case {
            name: &'static str,
            calls: Vec<LedgerCall>,
            cause: Option<&'static str>,
            ended_by: EndedBy,
            completed: bool,
            graded: Option<Confidence>,
            outcome: Option<(RcaOutcome, OutcomeReason)>,
            shown: Option<Confidence>,
        }

        fn run(
            calls: &[LedgerCall],
            submit: Option<&RcaSubmit>,
            ended_by: EndedBy,
            completed: bool,
        ) -> RunEndResult {
            let log = tool_log();
            let stages = stages(if completed { 7 } else { 4 });
            record_run_end(&RunEndInput {
                submit,
                calls,
                tool_log: &log,
                stages_run: &stages,
                ended_by,
                completed,
                steer_authors: &BTreeMap::new(),
            })
        }

        /// 03 §6.4: VE14 + VE15 as one table test through `record_run_end`.
        #[test]
        fn the_outcome_table() {
            use Confidence::*;
            use EndedBy::*;
            use OutcomeReason as R;
            use RcaOutcome as O;
            let named = Some("orders pool exhausted after PR #812");
            let cases = vec![
                Case {
                    name: "T1",
                    calls: vec![
                        root_with_two_classes(1, "h1", &[]),
                        h(2, "h2", "contributing"),
                        h(3, "h3", "symptom"),
                        ruled_out_verified(4, "h4"),
                        h(5, "h5", "ruled_out"),
                        h(6, "h6", "blocked"),
                    ],
                    cause: named,
                    ended_by: Agent,
                    completed: true,
                    graded: Some(High),
                    outcome: Some((O::RootCauseIdentified, R::RootCauseGraded)),
                    shown: Some(High),
                },
                Case {
                    name: "T2",
                    calls: vec![
                        root_with_two_classes(1, "h1", &["stg_arao"]),
                        h(2, "h2", "contributing"),
                        h(3, "h3", "symptom"),
                        ruled_out_verified(4, "h4"),
                    ],
                    cause: named,
                    ended_by: Agent,
                    completed: true,
                    graded: Some(Medium),
                    outcome: Some((O::RootCauseIdentified, R::RootCauseGraded)),
                    shown: Some(Medium),
                },
                Case {
                    name: "T3",
                    calls: vec![
                        with_metric(1, "h1", "root_cause", "supporting"),
                        ruled_out_verified(2, "h2"),
                    ],
                    cause: named,
                    ended_by: Agent,
                    completed: true,
                    graded: Some(Low),
                    outcome: Some((O::Inconclusive, R::CauseBelowMedium)),
                    shown: Some(Low),
                },
                Case {
                    name: "T4",
                    calls: vec![
                        with_metric(1, "h1", "root_cause", "decisive"),
                        h(2, "h2", "root_cause"),
                    ],
                    cause: named,
                    ended_by: Agent,
                    completed: true,
                    graded: Some(Low),
                    outcome: Some((O::Inconclusive, R::AmbiguousCause)),
                    shown: Some(Low),
                },
                Case {
                    name: "T5",
                    calls: vec![
                        with_metric(1, "h1", "contributing", "decisive"),
                        ruled_out_verified(2, "h2"),
                    ],
                    cause: named,
                    ended_by: Agent,
                    completed: true,
                    graded: Some(Medium),
                    outcome: Some((O::ContributingFactor, R::ContributingGraded)),
                    shown: Some(Medium),
                },
                Case {
                    name: "T6",
                    calls: vec![
                        with_metric(1, "h1", "contributing", "supporting"),
                        h(2, "h2", "symptom"),
                    ],
                    cause: named,
                    ended_by: Agent,
                    completed: true,
                    graded: Some(Low),
                    outcome: Some((O::Inconclusive, R::NoConfirmedCause)),
                    shown: Some(Low),
                },
                Case {
                    name: "T7",
                    calls: vec![
                        h(1, "h1", "blocked"),
                        with_metric(2, "h2", "contributing", "decisive"),
                        h(3, "h3", "symptom"),
                    ],
                    cause: named,
                    ended_by: Agent,
                    completed: true,
                    graded: Some(Medium),
                    outcome: Some((O::Blocked, R::LeadingBlocked)),
                    shown: Some(Low),
                },
                Case {
                    name: "T8",
                    calls: vec![
                        h(1, "h1", "blocked"),
                        with_metric(2, "h2", "contributing", "decisive"),
                    ],
                    cause: named,
                    ended_by: AnswerDeadline,
                    completed: true,
                    graded: Some(Medium),
                    outcome: Some((O::Blocked, R::AnswerDeadline)),
                    shown: Some(Low),
                },
                Case {
                    name: "T9",
                    calls: vec![with_metric(1, "h1", "root_cause", "decisive")],
                    cause: named,
                    ended_by: AnswerDeadline,
                    completed: true,
                    graded: Some(Medium),
                    outcome: Some((O::Blocked, R::AnswerDeadline)),
                    shown: Some(Low),
                },
                Case {
                    name: "T10",
                    calls: vec![
                        h(1, "h1", "inconclusive"),
                        h(2, "h2", "inconclusive"),
                        h(3, "h3", "symptom"),
                        ruled_out_verified(4, "h4"),
                    ],
                    cause: named,
                    ended_by: Agent,
                    completed: true,
                    graded: Some(Low),
                    outcome: Some((O::Inconclusive, R::NoConfirmedCause)),
                    shown: Some(Low),
                },
                Case {
                    name: "T11",
                    calls: vec![],
                    cause: Some("cause unknown"),
                    ended_by: Agent,
                    completed: true,
                    graded: Some(Low),
                    outcome: Some((O::Inconclusive, R::NoHypothesis)),
                    shown: Some(Low),
                },
                Case {
                    name: "T12",
                    calls: vec![with_metric(1, "h1", "root_cause", "decisive")],
                    cause: Some("Cause unknown"),
                    ended_by: Agent,
                    completed: true,
                    graded: Some(Low),
                    outcome: Some((O::Inconclusive, R::NoConfirmedCause)),
                    shown: Some(Low),
                },
                Case {
                    name: "T13",
                    calls: vec![
                        hyp_input(
                            1,
                            json!({"id": "h1", "statement": "s", "status": "likely", "reason": "r", "lead_ids": ["stg_arao"]}),
                        ),
                        ruled_out_verified(2, "h2"),
                    ],
                    cause: named,
                    ended_by: Agent,
                    completed: true,
                    graded: Some(Low),
                    outcome: Some((O::Inconclusive, R::NoConfirmedCause)),
                    shown: Some(Low),
                },
                Case {
                    name: "T14",
                    calls: vec![with_metric(1, "h1", "testing", "decisive")],
                    cause: named,
                    ended_by: Agent,
                    completed: true,
                    graded: Some(Low),
                    outcome: Some((O::Inconclusive, R::NoConfirmedCause)),
                    shown: Some(Low),
                },
                Case {
                    name: "T15",
                    calls: vec![
                        h(1, "h1", "testing"),
                        h(2, "h2", "untested"),
                        h(3, "h3", "symptom"),
                    ],
                    cause: None,
                    ended_by: Agent,
                    completed: false,
                    graded: None,
                    outcome: None,
                    shown: None,
                },
                Case {
                    name: "T16",
                    calls: vec![h(1, "h1", "blocked")],
                    cause: None,
                    ended_by: AnswerDeadline,
                    completed: true,
                    graded: None,
                    outcome: Some((O::Blocked, R::AnswerDeadline)),
                    shown: None,
                },
            ];
            for case in cases {
                let submit = case.cause.map(|c| submit(submitted(c, High), vec![]));
                let r = run(&case.calls, submit.as_ref(), case.ended_by, case.completed);
                let name = case.name;
                let rec = &r.record;
                assert_eq!(
                    rec.grade.as_ref().map(|g| min_band(g.claimed, g.graded)),
                    case.graded,
                    "{name}: graded before VE15"
                );
                assert_eq!(
                    rec.outcome.zip(rec.outcome_reason),
                    case.outcome,
                    "{name}: outcome"
                );
                assert_eq!(
                    rec.grade.as_ref().map(|g| g.band),
                    case.shown,
                    "{name}: band shown"
                );
                assert_eq!(
                    r.verdict.as_ref().map(|v| v.confidence),
                    case.shown,
                    "{name}: verdict band"
                );
                assert_eq!(rec.verdict, r.verdict, "{name}");
            }
        }

        #[test]
        fn outcome_table_details() {
            let named = submit(submitted("orders pool exhausted", Confidence::High), vec![]);
            let t2 = run(
                &[
                    root_with_two_classes(1, "h1", &["stg_arao"]),
                    ruled_out_verified(2, "h4"),
                ],
                Some(&named),
                EndedBy::Agent,
                true,
            );
            assert!(
                t2.record
                    .grade
                    .unwrap()
                    .reasons
                    .contains(&GradeReason::HumanLead)
            );

            let t14 = run(&[h(1, "h1", "testing")], Some(&named), EndedBy::Agent, true);
            assert_eq!(
                t14.record.ledger.hypotheses[0].status,
                HypothesisStatus::Untested
            );
            assert_eq!(t14.counts.left_testing, 1);

            let unknown = submit(submitted("cause unknown", Confidence::High), vec![]);
            let t11 = run(&[], Some(&unknown), EndedBy::Agent, true);
            assert!(!t11.record.has_ledger);
            assert!(
                t11.record
                    .grade
                    .unwrap()
                    .reasons
                    .contains(&GradeReason::NoLedger)
            );
        }

        #[test]
        fn a_cancelled_run_keeps_partial_results() {
            let calls = [
                with_metric(1, "h1", "testing", "decisive"),
                h(2, "h2", "untested"),
            ];
            let report = submit(submitted("x", Confidence::High), vec![]);
            let r = run(&calls, Some(&report), EndedBy::Agent, false);
            let rec = &r.record;
            assert_eq!(
                (rec.outcome, rec.grade.as_ref(), rec.verdict.as_ref()),
                (None, None, None)
            );
            assert_eq!((rec.claims, rec.claimed_outcome), (None, None));
            assert_eq!(rec.ledger.hypotheses.len(), 2);
            assert_eq!(rec.evidence.len(), 1);
            assert_eq!(r.summary_detail, None);
            assert_eq!(
                rec.blind_spots,
                vec![BlindSpot {
                    id: "run_end".into(),
                    axis: BlindSpotAxis::Other,
                    title: "3 stages did not run".into(),
                    why: "Log patterns, Metrics, Converge".into(),
                    fix: BlindSpotFix::ResumeRun,
                }]
            );
            let json = serde_json::to_value(rec).unwrap();
            assert_eq!(json["schema_version"], json!(1));
            assert!(json.get("outcome").is_none() && json.get("grade").is_none());

            let log = tool_log();
            let one = vec![
                "context".to_string(),
                "topology".into(),
                "changes".into(),
                "traces".into(),
                "log_patterns".into(),
                "metrics".into(),
            ];
            let r = record_run_end(&RunEndInput {
                submit: None,
                calls: &calls,
                tool_log: &log,
                stages_run: &one,
                ended_by: EndedBy::Agent,
                completed: false,
                steer_authors: &BTreeMap::new(),
            });
            assert_eq!(r.record.blind_spots[0].title, "1 stage did not run");
            // All seven stages ran: no run_end blind spot; a completed run never gets one.
            let r = record_run_end(&RunEndInput {
                submit: None,
                calls: &calls,
                tool_log: &log,
                stages_run: &stages(7),
                ended_by: EndedBy::Agent,
                completed: false,
                steer_authors: &BTreeMap::new(),
            });
            assert!(r.record.blind_spots.is_empty());
            let r = record_run_end(&RunEndInput {
                submit: Some(&report),
                calls: &calls,
                tool_log: &log,
                stages_run: &[],
                ended_by: EndedBy::Agent,
                completed: true,
                steer_authors: &BTreeMap::new(),
            });
            assert!(r.record.blind_spots.iter().all(|b| b.id != "run_end"));
        }

        /// VE19: the claimed outcome never changes the outcome or the band; it is stored.
        #[test]
        fn the_claimed_outcome_never_changes_the_outcome() {
            let calls = [h(1, "h1", "inconclusive"), h(2, "h2", "symptom")];
            for claimed in [
                RcaOutcome::RootCauseIdentified,
                RcaOutcome::ContributingFactor,
                RcaOutcome::Inconclusive,
                RcaOutcome::Blocked,
            ] {
                let mut v = submitted("orders pool", Confidence::High);
                v.claimed_outcome = claimed;
                let r = run(&calls, Some(&submit(v, vec![])), EndedBy::Agent, true);
                assert_eq!(
                    r.record.outcome,
                    Some(RcaOutcome::Inconclusive),
                    "{claimed}"
                );
                assert_eq!(
                    r.record.outcome_reason,
                    Some(OutcomeReason::NoConfirmedCause)
                );
                assert_eq!(r.record.grade.as_ref().unwrap().band, Confidence::Low);
                assert_eq!(r.record.claimed_outcome, Some(claimed));
                assert_eq!(r.record.claims.unwrap().outcome, claimed);
            }
        }

        /// VE38: the verdict carries the graded band, and the gate refuses a suppress at medium.
        #[test]
        fn the_graded_band_reaches_the_gate() {
            let mut v = submitted("orders pool exhausted", Confidence::High);
            v.page_recommendation.action = PageAction::Suppress;
            let calls = [with_metric(1, "h1", "root_cause", "decisive")];
            let r = run(&calls, Some(&submit(v, vec![])), EndedBy::Agent, true);
            let verdict = r.verdict.clone().unwrap();
            assert_eq!(r.record.claims.unwrap().confidence, Confidence::High);
            assert_eq!(verdict.confidence, Confidence::Medium);
            assert_eq!(r.record.grade.as_ref().unwrap().band, Confidence::Medium);

            let policy = L0Policy {
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
                allow_suppress: true,
            };
            let state = |verdict| AnalysisState {
                status: AnalysisStatus::Complete,
                verdict: Some(verdict),
                grade: r.record.grade.clone(),
                requested_at: Some(0),
                completed_at: Some(1),
            };
            let outcome = apply_verdict(&policy, &state(verdict.clone()), AlertPriority::P3, 1);
            assert!(
                matches!(outcome, VerdictOutcome::Page { .. }),
                "{outcome:?}"
            );
            // The same verdict with the claimed band would have suppressed.
            let mut claimed = verdict;
            claimed.confidence = Confidence::High;
            assert_eq!(
                apply_verdict(&policy, &state(claimed), AlertPriority::P3, 1),
                VerdictOutcome::Suppress
            );
        }

        /// VE38/VE39: up to five decisive entries in number order, labelled by code, no URL.
        #[test]
        fn the_verdict_carries_labelled_decisive_entries() {
            let obs = "o".repeat(200);
            let mut evidence: Vec<Value> = (1..=6)
                .map(|n| decisive(&format!("e{n}"), PROM, &format!("q{n}")))
                .collect();
            evidence.insert(
                0,
                item(
                    "e9",
                    SQL,
                    "SELECT * FROM \"checkout_api\"",
                    "supports",
                    "supporting",
                ),
            );
            evidence.push(item(
                "e8",
                SQL,
                "SELECT * FROM \"orders\"",
                "supports",
                "decisive",
            ));
            evidence[1]["observation"] = json!(obs);
            let calls = [hyp(1, "h1", "root_cause", evidence)];
            let mut log: Vec<ToolCallRecord> = (1..=6)
                .map(|n| prom(&format!("c{n}"), &format!("q{n}"), n))
                .collect();
            log.push(logs("c9", "SELECT * FROM \"checkout_api\"", 0));
            log.push(logs("c8", "SELECT * FROM \"orders\"", 9));
            let (ledger, ..) = build_ledger(&calls, true);
            let (entries, _) = build_evidence(ledger.as_ref(), &log);
            let grade = crate::meta::oncall::confidence::grade_confidence(
                &submitted("x", Confidence::High),
                ledger.as_ref(),
                &[],
                &log,
                &BTreeMap::new(),
            );
            let verdict = to_analysis_verdict(&submitted("x", Confidence::High), &grade, &entries);
            let numbers: Vec<u32> = verdict.evidence.iter().map(|e| e.number).collect();
            assert_eq!(numbers, [2, 3, 4, 5, 6], "entry 1 is supporting only");
            assert_eq!(
                verdict.evidence[0].label,
                format!("PromQL · metrics · {}", "o".repeat(120))
            );
            assert_eq!(verdict.evidence[1].label, "PromQL · metrics · e2 obs");
            assert_eq!(entries[7].kind, "SQL");
            let sql_entry =
                to_analysis_verdict(&submitted("x", Confidence::High), &grade, &entries[7..]);
            assert_eq!(sql_entry.evidence[0].label, "SQL · orders · e8 obs");
            assert!(!serde_json::to_string(&verdict).unwrap().contains("http"));
        }

        /// VE31: a confirmed entry whose ids did not verify shows Unverified, and is counted.
        #[test]
        fn unverified_timeline_entries_are_counted() {
            let calls = [hyp(
                1,
                "h1",
                "root_cause",
                vec![
                    decisive("e1", PROM, "pool_active"),
                    decisive("e9", PROM, "never"),
                ],
            )];
            let timeline = vec![
                TimelineEntry {
                    at_us: 30,
                    text: "c".into(),
                    status: TimelineStatus::Confirmed,
                    evidence_ids: vec!["e9".into()],
                },
                TimelineEntry {
                    at_us: 10,
                    text: "a".into(),
                    status: TimelineStatus::Confirmed,
                    evidence_ids: vec!["e9".into(), "e1".into()],
                },
                TimelineEntry {
                    at_us: 20,
                    text: "b".into(),
                    status: TimelineStatus::Refuted,
                    evidence_ids: vec![],
                },
                TimelineEntry {
                    at_us: 40,
                    text: "d".into(),
                    status: TimelineStatus::Likely,
                    evidence_ids: vec![],
                },
            ];
            let r = run(
                &calls,
                Some(&submit(submitted("x", Confidence::High), timeline)),
                EndedBy::Agent,
                true,
            );
            assert_eq!(r.timeline_unverified, 2);
            let view = summary_from_record(
                "r1",
                crate::meta::alerts::rca_runs::RunState::Completed,
                "v".into(),
                &r.record,
            );
            let shown: Vec<(&str, TimelineView, Vec<u32>)> = view
                .timeline
                .iter()
                .map(|t| (t.text.as_str(), t.status, t.evidence_numbers.clone()))
                .collect();
            assert_eq!(
                shown,
                vec![
                    ("a", TimelineView::Confirmed, vec![1]),
                    ("b", TimelineView::Unverified, vec![]),
                    ("c", TimelineView::Unverified, vec![]),
                    ("d", TimelineView::Likely, vec![]),
                ]
            );
        }

        /// VE44: the list detail of a blocked run; none otherwise.
        #[test]
        fn blocked_runs_carry_a_detail() {
            let named = submit(submitted("x", Confidence::High), vec![]);
            let blocked = |spots: Vec<LedgerCall>| {
                let mut calls = vec![h(1, "h1", "blocked")];
                calls.extend(spots);
                run(&calls, Some(&named), EndedBy::Agent, true).summary_detail
            };
            assert_eq!(
                blocked(vec![
                    spot(2, "b1", "logs", "none", "No fix"),
                    spot(3, "b2", "change", "connect_toolset", "Change history")
                ]),
                Some("Needs: Change history".to_string())
            );
            assert_eq!(
                blocked(vec![spot(2, "b1", "logs", "none", "No fix")]),
                Some("Needs input".to_string())
            );
            assert_eq!(
                run(
                    &[h(1, "h1", "blocked")],
                    None,
                    EndedBy::AnswerDeadline,
                    true
                )
                .summary_detail,
                Some("Needs input".to_string())
            );
            // Frame B (root cause identified): no detail.
            let b = run(
                &[
                    root_with_two_classes(1, "h1", &[]),
                    ruled_out_verified(2, "h2"),
                ],
                Some(&named),
                EndedBy::Agent,
                true,
            );
            assert_eq!(b.record.outcome, Some(RcaOutcome::RootCauseIdentified));
            assert_eq!(b.summary_detail, None);
        }

        /// §11: the record round-trips and lists only cited calls.
        #[test]
        fn the_record_round_trips_with_cited_calls_only() {
            let calls = [with_metric(1, "h1", "root_cause", "decisive")];
            let r = run(
                &calls,
                Some(&submit(submitted("x", Confidence::High), vec![])),
                EndedBy::Agent,
                true,
            );
            assert_eq!(
                r.record
                    .cited_calls
                    .iter()
                    .map(|c| c.call_id.as_str())
                    .collect::<Vec<_>>(),
                ["m1"]
            );
            assert_eq!(r.record.cited_calls[0].signal, SignalClass::Metrics);
            let back: RcaRunRecord =
                serde_json::from_str(&serde_json::to_string(&r.record).unwrap()).unwrap();
            assert_eq!(back, r.record);
        }
    }
}
