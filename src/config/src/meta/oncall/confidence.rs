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

//! Code grades an RCA verdict's confidence band from recorded evidence and the tool calls that ran.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    agent::Confidence,
    rca_run::{
        BlindSpot, BlindSpotAxis, EvidenceLedger, EvidenceTarget, HypothesisStatus, OutcomeReason,
        Polarity, RcaOutcome, Strength, SubmittedVerdict, TimeWindow, subject,
    },
};
use crate::meta::alerts::rca_steering::STEER_ID_PREFIX;

/// Statements of ruled-out hypotheses in a grade are cut to this many chars.
const RULED_OUT_MAX_CHARS: usize = 80;

/// Slack for `impact.window` past the observed data: one minute of rounding and sample spacing.
const IMPACT_WINDOW_SLACK_US: i64 = 60_000_000;

/// The tools whose signal class comes from their `type` argument.
const SEARCH_TOOLS: [&str; 4] = [
    "SearchSQL",
    "SearchAround",
    "ExtractPatterns",
    "SearchValues",
];

/// The PromQL query tools; the other `Prometheus*` tools read metadata, not metrics.
const PROMETHEUS_TOOLS: [&str; 3] = [
    "PrometheusQuery",
    "PrometheusRangeQuery",
    "PrometheusSeries",
];

/// Tools that give context but never count toward the band.
const CONTEXT_TOOLS: [&str; 9] = [
    "GetIncident",
    "GetAlert",
    "GetAlertHistory",
    "GetCurrentServiceGraphTopology",
    "StreamList",
    "StreamSchema",
    "ListDashboards",
    "correlate_streams",
    "get_dimension_analytics",
];

/// Tool-name prefixes that are not an org AI Toolset MCP server (first-party and shell toolsets).
const NOT_TOOLSET_SERVERS: [&str; 3] = ["o2", "cli", "custom"];

/// Code toolset tools that return a diff; like `git show`, a diff is evidence of a change.
const TOOLSET_DIFF_TOOLS: [&str; 2] = ["git_show", "git_diff"];

/// Code reads explain a mechanism but are not evidence a change happened, so they are context.
const TOOLSET_CODE_TOOLS: [&str; 4] = ["read_file", "search_code", "list_files", "git_log"];

/// Code toolset arguments that only narrow what a read covers; a citation may add or narrow them.
const LINE_RANGE_ARGS: [&str; 2] = ["start_line", "end_line"];

/// The longest key argument a tool record keeps; citations are cut the same way.
pub const KEY_ARG_MAX_BYTES: usize = 4 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SignalClass {
    Logs,
    Metrics,
    Traces,
    Change,
    Infra,
    Context,
    Unclassified,
}

impl SignalClass {
    /// Whether evidence of this class counts toward the band.
    pub fn counts(&self) -> bool {
        matches!(
            self,
            Self::Logs | Self::Metrics | Self::Traces | Self::Change | Self::Infra
        )
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Logs => "logs",
            Self::Metrics => "metrics",
            Self::Traces => "traces",
            Self::Change => "change",
            Self::Infra => "infra",
            Self::Context => "context",
            Self::Unclassified => "unclassified",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ToolCallRecord {
    pub call_id: String,
    /// `o2_` stripped and `tools_call` unwrapped; toolset calls keep the `<server>_` prefix.
    pub tool: String,
    /// The same key argument as the thread's, max 4 KB.
    pub key_arg: String,
    /// The `type` argument of the SearchSQL family.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_type: Option<String>,
    /// `state.status == "completed"`.
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_count: Option<u64>,
    pub started_at_us: i64,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_type: Option<String>,
    pub signal: SignalClass,
    pub target: EvidenceTarget,
    /// Data timestamps the result showed inside `target`'s range; `None` when none or no range.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed: Option<TimeWindow>,
    pub result_summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum UnverifiedReason {
    /// No call with the same tool and key argument ran.
    NotRun,
    /// Matching calls ran, and all of them failed.
    Failed,
}

impl UnverifiedReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NotRun => "not_run",
            Self::Failed => "failed",
        }
    }
}

/// An evidence item that matches no successful tool call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UnverifiedCitation {
    pub hypothesis_id: String,
    pub evidence_id: String,
    pub tool: String,
    pub query: String,
    pub reason: UnverifiedReason,
}

/// A grading rule that fired.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GradeReason {
    /// Old records' `ambiguous_cause` (more than one root cause) read as this floor.
    #[serde(alias = "ambiguous_cause")]
    NoConfirmedCause,
    NoLedger,
    NoVerifiedEvidence,
    VerifiedSupport,
    DecisiveClass,
    TwoDecisiveClassesAndRuledOut,
    SuspectChangeNotRead,
    ChangeHistoryUnreachable,
    ContradictingEvidence,
    HumanLead,
    /// `impact.window` reaches past the data the verified runtime evidence showed.
    ImpactOutsideObservedData,
}

impl GradeReason {
    /// The low-band text of a floor; `None` for every other reason.
    fn floor_text(&self) -> Option<&'static str> {
        match self {
            Self::NoConfirmedCause => Some("no confirmed cause"),
            Self::NoLedger => Some("no hypotheses recorded"),
            Self::NoVerifiedEvidence => Some("no verified evidence"),
            _ => None,
        }
    }

    /// `None` for non-caps; a `human_lead` cap names the lead's author by email local part.
    fn cap_text(&self, lead_author: Option<&str>) -> Option<String> {
        let text = match self {
            Self::SuspectChangeNotRead => "suspect change not read",
            Self::ChangeHistoryUnreachable => "change history not reachable",
            Self::ContradictingEvidence => "contradicting evidence",
            Self::ImpactOutsideObservedData => "impact window outside the observed data",
            Self::HumanLead => {
                return Some(match lead_author {
                    Some(email) => {
                        let name = email.split('@').next().unwrap_or(email);
                        format!("lead from {name}")
                    }
                    None => "lead from a person, not a tool".to_string(),
                });
            }
            _ => return None,
        };
        Some(text.to_string())
    }
}

/// One root cause's own grade, in a run with several.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CauseGrade {
    pub hypothesis_id: String,
    /// What the rules allow for this cause alone, after caps.
    pub graded: Confidence,
    #[serde(default)]
    pub decisive_classes: Vec<SignalClass>,
}

/// The band that code allows for a verdict, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ConfidenceGrade {
    /// `min(claimed, graded)`, then lowered by the outcome.
    pub band: Confidence,
    pub claimed: Confidence,
    /// What the rules allow, after caps; with several root causes, the lowest cause's.
    pub graded: Confidence,
    /// The rules that fired, in order; with several root causes, the lowest cause's.
    #[serde(default)]
    pub reasons: Vec<GradeReason>,
    #[serde(default)]
    pub decisive_classes: Vec<SignalClass>,
    /// Ruled-out statements backed by a verified `rules_out`/`contradicts` item, cut to 80 chars.
    #[serde(default)]
    pub ruled_out: Vec<String>,
    #[serde(default)]
    pub unverified: Vec<UnverifiedCitation>,
    /// The subject hypothesis: the earliest root cause when there are several.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_id: Option<String>,
    /// Author email of the cause's first steering lead, named by a `human_lead` cap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_author: Option<String>,
    /// Each root cause's own grade, in first-seen order; empty unless there are two or more.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub causes: Vec<CauseGrade>,
}

/// Claim, evidence level with its reason, and the caps that lowered it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ConfidenceBreakdown {
    pub claimed: Confidence,
    /// The level the evidence rules allow, before any cap.
    pub evidence: Confidence,
    /// Why the evidence allows that level, e.g. "1 decisive source (logs)".
    pub evidence_reason: String,
    /// What the next level up needs; absent at `high` and under a floor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_level: Option<String>,
    /// The caps that lowered the evidence level to `medium`.
    #[serde(default)]
    pub caps: Vec<String>,
}

impl ConfidenceGrade {
    /// The first floor that holds the band at `low`, if any.
    fn floor(&self) -> Option<GradeReason> {
        [
            GradeReason::NoLedger,
            GradeReason::NoConfirmedCause,
            GradeReason::NoVerifiedEvidence,
        ]
        .into_iter()
        .find(|r| self.reasons.contains(r))
    }

    /// The level the evidence allows before caps: the floor, else the basis rule.
    pub fn evidence_level(&self) -> Confidence {
        if self.floor().is_some() {
            Confidence::Low
        } else if self
            .reasons
            .contains(&GradeReason::TwoDecisiveClassesAndRuledOut)
        {
            Confidence::High
        } else if self.reasons.contains(&GradeReason::DecisiveClass) {
            Confidence::Medium
        } else {
            Confidence::Low
        }
    }

    /// Every cap sets `medium`, so a cap on a `medium` evidence level changed nothing and is
    /// omitted.
    fn applied_caps(&self) -> Vec<String> {
        if self.evidence_level() != Confidence::High {
            return Vec::new();
        }
        let lead_author = self.lead_author.as_deref();
        self.reasons
            .iter()
            .filter_map(|r| r.cap_text(lead_author))
            .collect()
    }

    /// The breakdown the verdict card shows. With several root causes, the run level is the
    /// weakest cause's, so the reason counts the causes and the next level is what it needs.
    pub fn breakdown(&self) -> ConfidenceBreakdown {
        let evidence = self.evidence_level();
        let floor = self.floor().and_then(|r| r.floor_text());
        let classes: Vec<&str> = self.decisive_classes.iter().map(|c| c.as_str()).collect();
        let several = self.causes.len() > 1;
        let mut evidence_reason = match (floor, classes.len()) {
            (Some(text), _) => text.to_string(),
            (None, _) if several => self.causes_reason(),
            (None, 0) => "supporting evidence, none decisive".to_string(),
            (None, 1) => format!("1 decisive source ({})", classes[0]),
            (None, n) => format!("{n} decisive sources ({})", classes.join(" + ")),
        };
        if floor.is_none() && !self.ruled_out.is_empty() {
            let n = self.ruled_out.len();
            let noun = if n == 1 {
                "alternative"
            } else {
                "alternatives"
            };
            evidence_reason.push_str(&format!(", {n} {noun} ruled out"));
        }
        let next_level = match evidence {
            _ if floor.is_some() => None,
            Confidence::Low if several => {
                Some("Medium needs a decisive source for every cause".to_string())
            }
            Confidence::Low => Some("Medium needs a decisive source".to_string()),
            Confidence::Medium => {
                let mut missing = Vec::new();
                if classes.len() < 2 {
                    missing.push(if several {
                        "a second decisive source for every cause"
                    } else {
                        "a second decisive source"
                    });
                }
                if self.ruled_out.is_empty() {
                    missing.push("a ruled-out alternative");
                }
                if self.reasons.contains(&GradeReason::ContradictingEvidence) {
                    missing.push("no contradicting evidence on the cause");
                }
                if self
                    .reasons
                    .contains(&GradeReason::ImpactOutsideObservedData)
                {
                    missing.push("an impact window inside the observed data");
                }
                (!missing.is_empty()).then(|| format!("High needs {}", missing.join(" and ")))
            }
            Confidence::High => None,
        };
        ConfidenceBreakdown {
            claimed: self.claimed,
            evidence,
            evidence_reason,
            next_level,
            caps: self.applied_caps(),
        }
    }

    /// "2 causes, each with a decisive source"; "2 causes, 1 with a decisive source".
    fn causes_reason(&self) -> String {
        let n = self.causes.len();
        let decisive = |c: &&CauseGrade| !c.decisive_classes.is_empty();
        let weakest = self
            .causes
            .iter()
            .map(|c| c.decisive_classes.len())
            .min()
            .unwrap_or(0);
        match weakest {
            0 => format!(
                "{n} causes, {} with a decisive source",
                self.causes.iter().filter(decisive).count()
            ),
            1 => format!("{n} causes, each with a decisive source"),
            _ => format!("{n} causes, each with 2 or more decisive sources"),
        }
    }

    /// Built only from the grade.
    pub fn reason_line(&self) -> String {
        let mut line = self.band.as_str().to_string();
        if min_band(self.claimed, self.band) != self.claimed {
            line.push_str(" · claimed ");
            line.push_str(self.claimed.as_str());
        }
        let floor = self.floor().and_then(|r| r.floor_text());
        // A low band set only by the model's own claim reads like the rules-allowed band.
        let floor_format =
            self.band == Confidence::Low && (floor.is_some() || self.graded == Confidence::Low);
        if floor_format {
            line.push_str(" · ");
            line.push_str(floor.unwrap_or("one class of supporting evidence"));
            let not_run = self
                .unverified
                .iter()
                .filter(|c| c.reason == UnverifiedReason::NotRun)
                .count();
            match not_run {
                0 => {}
                1 => line.push_str(" · 1 citation did not run"),
                n => line.push_str(&format!(" · {n} citations did not run")),
            }
            return line;
        }
        if self.causes.len() > 1 {
            line.push_str(&format!(" · {} causes", self.causes.len()));
        }
        if !self.decisive_classes.is_empty() {
            let classes: Vec<&str> = self.decisive_classes.iter().map(|c| c.as_str()).collect();
            line.push_str(" · decisive: ");
            line.push_str(&classes.join(" + "));
        }
        if !self.ruled_out.is_empty() {
            line.push_str(" · ruled out: ");
            line.push_str(&self.ruled_out.join(", "));
        }
        let caps = self.applied_caps();
        if !caps.is_empty() {
            line.push_str(" · capped: ");
            line.push_str(&caps.join(", "));
        }
        line
    }
}

/// Key argument as compared: JSON objects/arrays by value, else normalized text.
#[derive(Debug, Clone, PartialEq)]
pub enum MatchKey {
    Json(serde_json::Value),
    Text(String),
}

impl MatchKey {
    pub fn of(key_arg: &str) -> Self {
        let text = normalize_key_arg(cut_bytes(key_arg, KEY_ARG_MAX_BYTES));
        match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(value) if value.is_object() || value.is_array() => Self::Json(value),
            _ => Self::Text(text),
        }
    }
}

/// The `type` argument of the SearchSQL family; `None` for every other tool.
pub fn stream_type(tool: &str, input: &serde_json::Value) -> Option<String> {
    if !SEARCH_TOOLS.contains(&tool) {
        return None;
    }
    input
        .get("type")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

/// From the bare tool name and unwrapped input, never from the ledger.
pub fn signal_class(tool: &str, input: &serde_json::Value) -> SignalClass {
    if SEARCH_TOOLS.contains(&tool) {
        return match input.get("type").and_then(serde_json::Value::as_str) {
            Some("metrics") => SignalClass::Metrics,
            Some("traces") => SignalClass::Traces,
            _ => SignalClass::Logs,
        };
    }
    if is_prometheus_tool(tool) {
        return SignalClass::Metrics;
    }
    if tool == "GetLatestTraces" {
        return SignalClass::Traces;
    }
    if CONTEXT_TOOLS.contains(&tool) {
        return SignalClass::Context;
    }
    if tool == "ExecuteCode" || tool.starts_with("custom_") {
        return SignalClass::Unclassified;
    }
    let command = ["command", "cmd"]
        .iter()
        .find_map(|k| input.get(*k).and_then(serde_json::Value::as_str));
    if command.is_some_and(reads_diff) {
        return SignalClass::Change;
    }
    if tool.starts_with("cli_") {
        return SignalClass::Infra;
    }
    match toolset_tool(tool) {
        Some(t) if TOOLSET_DIFF_TOOLS.contains(&t) => SignalClass::Change,
        Some(t) if TOOLSET_CODE_TOOLS.contains(&t) => SignalClass::Context,
        _ => SignalClass::Unclassified,
    }
}

/// Toolset server names are `[a-z0-9-]` only, so the server ends at the first `_`.
fn toolset_tool(tool: &str) -> Option<&str> {
    let (server, bare) = tool.split_once('_')?;
    let is_server = !server.is_empty()
        && server
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !NOT_TOOLSET_SERVERS.contains(&server);
    (is_server && !bare.is_empty()).then_some(bare)
}

/// Whether `tool` is one of the three PromQL query tools.
pub fn is_prometheus_tool(tool: &str) -> bool {
    PROMETHEUS_TOOLS.contains(&tool)
}

/// Collapses whitespace, trims, and drops one trailing `;`.
pub fn normalize_key_arg(s: &str) -> String {
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    match collapsed.strip_suffix(';') {
        Some(rest) => rest.trim_end().to_string(),
        None => collapsed,
    }
}

/// The longest prefix of `s` within `max` bytes that ends on a char boundary.
pub fn cut_bytes(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Same bare tool and normalized, cut key argument; earliest success wins, else `Failed`/`NotRun`.
/// A citation of a code toolset call also matches by what the call read ([code_citation_matches]).
pub fn match_citation<'a>(
    tool: &str,
    query: &str,
    log: &'a [ToolCallRecord],
) -> Result<&'a ToolCallRecord, UnverifiedReason> {
    let tool = tool.strip_prefix("o2_").unwrap_or(tool);
    let cited = MatchKey::of(query);
    let mut matched = false;
    let mut best: Option<&ToolCallRecord> = None;
    for record in log.iter().filter(|r| {
        (r.tool == tool || toolset_tool(&r.tool) == Some(tool))
            && (MatchKey::of(&r.key_arg) == cited || code_citation_matches(r, &cited))
    }) {
        matched = true;
        if !record.success {
            continue;
        }
        let earlier = best.is_none_or(|b| {
            (record.started_at_us, record.call_id.as_str()) < (b.started_at_us, b.call_id.as_str())
        });
        if earlier {
            best = Some(record);
        }
    }
    match best {
        Some(record) => Ok(record),
        None if matched => Err(UnverifiedReason::Failed),
        None => Err(UnverifiedReason::NotRun),
    }
}

/// Whether a citation names what a code toolset call read, with arguments that differ only in
/// the line range: a bare value equal to the call's one other argument (a path, a sha), or the
/// same other arguments with a line range inside the call's range (none read the whole file).
fn code_citation_matches(record: &ToolCallRecord, cited: &MatchKey) -> bool {
    let is_code_tool = toolset_tool(&record.tool)
        .is_some_and(|t| TOOLSET_CODE_TOOLS.contains(&t) || TOOLSET_DIFF_TOOLS.contains(&t));
    if !is_code_tool {
        return false;
    }
    let MatchKey::Json(serde_json::Value::Object(call)) = MatchKey::of(&record.key_arg) else {
        return false;
    };
    let (call_range, call_rest) = split_line_range(&call);
    match cited {
        MatchKey::Text(text) => {
            call_rest.len() == 1
                && call_rest
                    .values()
                    .next()
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|v| normalize_key_arg(v) == *text)
        }
        MatchKey::Json(serde_json::Value::Object(cited)) => {
            let (cited_range, cited_rest) = split_line_range(cited);
            cited_rest == call_rest
                && (cited_range == (None, None)
                    || (call_range.0.unwrap_or(1) <= cited_range.0.unwrap_or(1)
                        && cited_range.1.unwrap_or(i64::MAX) <= call_range.1.unwrap_or(i64::MAX)))
        }
        MatchKey::Json(_) => false,
    }
}

/// `(start_line, end_line)` and the remaining arguments of a code toolset call.
fn split_line_range(
    args: &serde_json::Map<String, serde_json::Value>,
) -> (
    (Option<i64>, Option<i64>),
    serde_json::Map<String, serde_json::Value>,
) {
    let line = |key: &str| args.get(key).and_then(serde_json::Value::as_i64);
    let rest = args
        .iter()
        .filter(|(k, _)| !LINE_RANGE_ARGS.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    ((line("start_line"), line("end_line")), rest)
}

/// The lower of two bands. `Confidence` has no usable `Ord` (High is declared first).
pub fn min_band(a: Confidence, b: Confidence) -> Confidence {
    match (a, b) {
        (Confidence::Low, _) | (_, Confidence::Low) => Confidence::Low,
        (Confidence::Medium, _) | (_, Confidence::Medium) => Confidence::Medium,
        _ => Confidence::High,
    }
}

/// `ledger: None` means the agent never called `record_hypothesis`.
pub fn grade_confidence(
    verdict: &SubmittedVerdict,
    ledger: Option<&EvidenceLedger>,
    blind_spots: &[BlindSpot],
    tool_log: &[ToolCallRecord],
    steer_authors: &BTreeMap<String, String>,
) -> ConfidenceGrade {
    let hypotheses = ledger.map(|l| l.hypotheses.as_slice()).unwrap_or_default();

    // Verify every item of every hypothesis.
    let mut unverified = Vec::new();
    let verified: Vec<Vec<Option<&ToolCallRecord>>> = hypotheses
        .iter()
        .map(|h| {
            h.evidence
                .iter()
                .map(
                    |item| match match_citation(&item.tool, &item.query, tool_log) {
                        Ok(record) => Some(record),
                        Err(reason) => {
                            unverified.push(UnverifiedCitation {
                                hypothesis_id: h.id.clone(),
                                evidence_id: item.id.clone(),
                                tool: item.tool.clone(),
                                query: item.query.clone(),
                                reason,
                            });
                            None
                        }
                    },
                )
                .collect()
        })
        .collect();

    let subject_id = ledger.and_then(subject).map(|h| h.id.clone());
    let subject = subject_id
        .as_deref()
        .and_then(|id| hypotheses.iter().position(|h| h.id == id));

    let cause_unknown = verdict
        .probable_cause
        .trim()
        .eq_ignore_ascii_case("cause unknown");
    // Two or more root causes are graded one by one; otherwise the subject is the one cause.
    let mut roots: Vec<usize> = (0..hypotheses.len())
        .filter(|&i| hypotheses[i].status == HypothesisStatus::RootCause)
        .collect();
    roots.sort_by_key(|&i| hypotheses[i].first_seen_seq);
    let several = roots.len() > 1 && !cause_unknown;
    let graded_ids: Vec<usize> = if several {
        roots
    } else {
        subject.into_iter().collect()
    };

    // Verified items of one hypothesis with their signal class.
    let items_of = |i: usize| {
        hypotheses[i]
            .evidence
            .iter()
            .zip(&verified[i])
            .filter_map(|(item, rec)| rec.map(|r| (item.polarity, item.strength, r.signal)))
    };

    let ruled_out: Vec<String> = hypotheses
        .iter()
        .zip(&verified)
        .enumerate()
        .filter(|(i, (h, recs))| {
            !graded_ids.contains(i)
                && h.status == HypothesisStatus::RuledOut
                && h.evidence.iter().zip(recs.iter()).any(|(item, rec)| {
                    rec.is_some()
                        && matches!(item.polarity, Polarity::RulesOut | Polarity::Contradicts)
                })
        })
        .map(|(_, (h, _))| h.statement.chars().take(RULED_OUT_MAX_CHARS).collect())
        .collect();

    // Floors every cause shares.
    let has_confirmed = hypotheses.iter().any(|h| {
        matches!(
            h.status,
            HypothesisStatus::RootCause | HypothesisStatus::Contributing
        )
    });
    let mut shared_floors = Vec::new();
    if cause_unknown || !has_confirmed {
        shared_floors.push(GradeReason::NoConfirmedCause);
    }
    if ledger.is_none() {
        shared_floors.push(GradeReason::NoLedger);
    }
    // The suspect change belongs to one of the causes, so a read by any cause counts.
    let change_read = graded_ids
        .iter()
        .any(|&i| items_of(i).any(|(_, _, signal)| signal == SignalClass::Change));
    let change_unreachable = blind_spots.iter().any(|b| b.axis == BlindSpotAxis::Change);
    let impact_outside =
        impact_outside_evidence(verdict, verified.iter().flatten().flatten().copied());

    let grade_cause = |cause: Option<usize>| {
        let items: Vec<(Polarity, Strength, SignalClass)> =
            cause.map(|i| items_of(i).collect()).unwrap_or_default();
        let mut decisive_classes: Vec<SignalClass> = Vec::new();
        for (polarity, strength, signal) in &items {
            if *polarity == Polarity::Supports
                && *strength == Strength::Decisive
                && signal.counts()
                && !decisive_classes.contains(signal)
            {
                decisive_classes.push(*signal);
            }
        }
        let has_support = items.iter().any(|(p, ..)| *p == Polarity::Supports);
        let has_contradiction = items.iter().any(|(p, ..)| *p == Polarity::Contradicts);

        // Floors, then the basis.
        let mut reasons = shared_floors.clone();
        if ledger.is_some() && !has_support {
            reasons.push(GradeReason::NoVerifiedEvidence);
        }
        let mut graded = if !reasons.is_empty() {
            Confidence::Low
        } else if decisive_classes.len() >= 2 && !ruled_out.is_empty() && !has_contradiction {
            reasons.push(GradeReason::TwoDecisiveClassesAndRuledOut);
            Confidence::High
        } else if !decisive_classes.is_empty() {
            reasons.push(GradeReason::DecisiveClass);
            Confidence::Medium
        } else {
            reasons.push(GradeReason::VerifiedSupport);
            Confidence::Low
        };

        let steer_leads = || {
            cause
                .into_iter()
                .flat_map(|i| &hypotheses[i].lead_ids)
                .filter(|l| l.starts_with(STEER_ID_PREFIX))
        };
        // Caps, in order. They matter only above the floor.
        if graded != Confidence::Low {
            let caps = [
                (
                    verdict.suspect_change.is_some() && !change_read,
                    GradeReason::SuspectChangeNotRead,
                ),
                (change_unreachable, GradeReason::ChangeHistoryUnreachable),
                (has_contradiction, GradeReason::ContradictingEvidence),
                (steer_leads().next().is_some(), GradeReason::HumanLead),
                (impact_outside, GradeReason::ImpactOutsideObservedData),
            ];
            for (fired, reason) in caps {
                if fired {
                    reasons.push(reason);
                    graded = min_band(graded, Confidence::Medium);
                }
            }
        }
        // The first steering lead of the cause whose author is known.
        let lead_author = steer_leads().find_map(|l| steer_authors.get(l).cloned());
        CauseGrading {
            graded,
            reasons,
            decisive_classes,
            lead_author,
        }
    };

    // The run takes the weakest cause's grade; on a tie, the earliest cause's.
    let (weakest, causes) = if several {
        let grades: Vec<(usize, CauseGrading)> = graded_ids
            .iter()
            .map(|&i| (i, grade_cause(Some(i))))
            .collect();
        let causes = grades
            .iter()
            .map(|(i, g)| CauseGrade {
                hypothesis_id: hypotheses[*i].id.clone(),
                graded: g.graded,
                decisive_classes: g.decisive_classes.clone(),
            })
            .collect();
        let weakest = grades.into_iter().map(|(_, g)| g).reduce(|a, b| {
            if min_band(a.graded, b.graded) == a.graded {
                a
            } else {
                b
            }
        });
        (weakest, causes)
    } else {
        (None, Vec::new())
    };
    let CauseGrading {
        graded,
        reasons,
        decisive_classes,
        lead_author,
    } = weakest.unwrap_or_else(|| grade_cause(subject));

    let claimed = verdict.claimed_confidence;
    ConfidenceGrade {
        band: min_band(claimed, graded),
        claimed,
        graded,
        reasons,
        decisive_classes,
        ruled_out,
        unverified,
        subject_id,
        lead_author,
        causes,
    }
}

/// The grade of one cause hypothesis, before the run takes it.
struct CauseGrading {
    graded: Confidence,
    reasons: Vec<GradeReason>,
    decisive_classes: Vec<SignalClass>,
    lead_author: Option<String>,
}

/// Context calls are not observations of the failure, so only runtime evidence bounds the window.
fn impact_outside_evidence<'a>(
    verdict: &SubmittedVerdict,
    verified: impl Iterator<Item = &'a ToolCallRecord>,
) -> bool {
    let Some(window) = verdict.impact.as_ref().and_then(|i| i.window) else {
        return false;
    };
    let covered = verified
        .filter(|r| r.signal.counts())
        .filter_map(|r| {
            r.observed
                .or(match (r.result_count, r.target.start_us, r.target.end_us) {
                    (Some(0), ..) => None,
                    (_, Some(start), Some(end)) => Some(TimeWindow { start, end }),
                    _ => None,
                })
        })
        .reduce(|a, b| TimeWindow {
            start: a.start.min(b.start),
            end: a.end.max(b.end),
        });
    covered.is_some_and(|c| {
        window.start < c.start.saturating_sub(IMPACT_WINDOW_SLACK_US)
            || window.end > c.end.saturating_add(IMPACT_WINDOW_SLACK_US)
    })
}

/// An `inconclusive` or `blocked` outcome lowers the band to `low`; it never raises it. A cause
/// graded below medium (the only cause, or the weakest of several) is already `low` and its basis
/// says why (no decisive source), so it gains no floor: "no confirmed cause" would deny the cause
/// the card shows.
pub fn apply_outcome(grade: &mut ConfidenceGrade, outcome: RcaOutcome, reason: OutcomeReason) {
    if !matches!(outcome, RcaOutcome::Inconclusive | RcaOutcome::Blocked) {
        return;
    }
    grade.band = Confidence::Low;
    if reason == OutcomeReason::CauseBelowMedium {
        return;
    }
    if !grade.reasons.contains(&GradeReason::NoConfirmedCause) {
        grade.reasons.push(GradeReason::NoConfirmedCause);
    }
}

/// `gh pr diff`, `gh api …/commits/<sha>`, `git show`, `git diff`; not commit lists.
fn reads_diff(command: &str) -> bool {
    command
        .split(['\n', ';', '|', '&'])
        .any(|segment| segment_reads_diff(&segment.split_whitespace().collect::<Vec<_>>()))
}

fn segment_reads_diff(tokens: &[&str]) -> bool {
    tokens.iter().enumerate().any(|(i, t)| match *t {
        "git" => git_subcommand(&tokens[i + 1..]).is_some_and(|s| s == "show" || s == "diff"),
        "gh" => match tokens.get(i + 1).copied() {
            Some("pr") => tokens.get(i + 2) == Some(&"diff"),
            Some("api") => tokens[i + 2..].iter().any(|a| {
                a.split_once("/commits/").is_some_and(|(_, sha)| {
                    !sha.trim_matches(|c| c == '/' || c == '"' || c == '\'')
                        .is_empty()
                })
            }),
            _ => false,
        },
        _ => false,
    })
}

/// The first non-option token after `git`; `-C <path>` and `-c <k=v>` take an argument.
fn git_subcommand<'a>(args: &[&'a str]) -> Option<&'a str> {
    let mut iter = args.iter();
    while let Some(a) = iter.next() {
        match *a {
            "-C" | "-c" => {
                iter.next();
            }
            a if a.starts_with('-') => {}
            a => return Some(a),
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::meta::oncall::rca_run::{
        LedgerCall, RcaOutcome, SuspectChangeState,
        fixtures::{
            BASH, PROM, SQL, TRACES, hyp, hyp_input, item, logs, prom, rec, shell, spot, submitted,
            suspect, traces,
        },
    };

    /// Normalization, earliest successful wins, failed vs not run.
    #[test]
    fn match_citation_follows_the_matching_rule() {
        assert_eq!(
            normalize_key_arg("  SELECT  *\n\tFROM t ; "),
            "SELECT * FROM t"
        );
        assert_eq!(normalize_key_arg("a;;"), "a;");

        let log = [
            rec("c3", SQL, "SELECT * FROM t", json!({}), 10, false),
            rec("c4", SQL, "SELECT *  FROM t;", json!({}), 30, true),
            rec("c2", SQL, "SELECT * FROM t", json!({}), 20, true),
            rec("c1", SQL, "SELECT * FROM t", json!({}), 20, true),
            rec("c5", SQL, "only failed", json!({}), 5, false),
        ];
        // The failed one is earliest; the earliest successful wins, ties by call id.
        assert_eq!(
            match_citation(SQL, "SELECT *\nFROM t;", &log)
                .unwrap()
                .call_id,
            "c1"
        );
        assert_eq!(
            match_citation(SQL, "only failed", &log),
            Err(UnverifiedReason::Failed)
        );
        assert_eq!(
            match_citation(SQL, "never", &log),
            Err(UnverifiedReason::NotRun)
        );
        assert_eq!(
            match_citation(PROM, "SELECT * FROM t", &log),
            Err(UnverifiedReason::NotRun)
        );
    }

    /// `o2_` prefix, 4 KiB cut, JSON compared as values.
    #[test]
    fn match_citation_strips_the_prefix_cuts_long_queries_and_compares_json() {
        let log = [prom("c1", "up", 1)];
        assert_eq!(
            match_citation("o2_PrometheusRangeQuery", "up", &log)
                .unwrap()
                .call_id,
            "c1"
        );

        let long = "x".repeat(5000);
        let cut: String = long.chars().take(4096).collect();
        let log = [rec("c1", SQL, &cut, json!({}), 1, true)];
        assert_eq!(match_citation(SQL, &long, &log).unwrap().call_id, "c1");

        let log = [rec(
            "c1",
            "GetIncident",
            r#"{"a": 1, "b": [1, 2]}"#,
            json!({}),
            1,
            true,
        )];
        assert_eq!(
            match_citation("GetIncident", r#"{ "b":[1,2],"a":1 }"#, &log)
                .unwrap()
                .call_id,
            "c1"
        );
        assert_eq!(
            match_citation("GetIncident", r#"{"a": 2, "b": [1, 2]}"#, &log),
            Err(UnverifiedReason::NotRun)
        );
    }

    #[test]
    fn signal_classes_follow_the_table() {
        use SignalClass::*;
        let cmd = |c: &str| json!({"command": c});
        let cases = [
            (SQL, json!({}), Logs),
            (SQL, json!({"type": "logs"}), Logs),
            (SQL, json!({"type": "metrics"}), Metrics),
            ("SearchAround", json!({"type": "traces"}), Traces),
            ("ExtractPatterns", json!({}), Logs),
            ("SearchValues", json!({"type": "metrics"}), Metrics),
            ("PrometheusQuery", json!({}), Metrics),
            (PROM, json!({}), Metrics),
            ("PrometheusSeries", json!({}), Metrics),
            ("PrometheusFormatQuery", json!({}), Unclassified),
            ("PrometheusLabels", json!({}), Unclassified),
            (TRACES, json!({}), Traces),
            (BASH, cmd("gh pr diff 812"), Change),
            (BASH, cmd("gh api repos/o/r/commits/4f2c1e"), Change),
            (BASH, cmd("gh api repos/o/r/commits"), Unclassified),
            (BASH, cmd("gh pr list --state merged"), Unclassified),
            (BASH, cmd("git log -5"), Unclassified),
            (BASH, cmd("git show 4f2c1e"), Change),
            (BASH, cmd("git diff v1..v2"), Change),
            (BASH, cmd("git -C /src/app show 4f2c1e"), Change),
            (BASH, cmd("git -c core.pager=cat diff HEAD~1"), Change),
            (BASH, cmd("git -C show log"), Unclassified),
            (BASH, cmd("cd /src && git diff HEAD~1"), Change),
            (BASH, cmd("git log --oneline | head; gh pr diff 5"), Change),
            (BASH, cmd("gh pr list | grep diff"), Unclassified),
            ("shell", json!({"cmd": "git show x"}), Change),
            ("cli_kubectl", cmd("kubectl get pods"), Infra),
            ("cli_git", cmd("git diff"), Change),
            ("ExecuteCode", cmd("git diff"), Unclassified),
            ("custom_deploys", json!({}), Unclassified),
            ("SomethingNew", json!({}), Unclassified),
            // Toolset calls: a diff is a change, a code read is context, anything else counts for
            // nothing.
            ("orca-demo-code_git_show", json!({"sha": "4f2c1e"}), Change),
            (
                "orca-demo-code_git_diff",
                json!({"base": "v1", "head": "v2"}),
                Change,
            ),
            (
                "orca-demo-code_read_file",
                json!({"path": "src/a.js"}),
                Context,
            ),
            (
                "orca-demo-code_search_code",
                json!({"pattern": "x"}),
                Context,
            ),
            ("orca-demo-code_list_files", json!({"path": "src"}), Context),
            ("orca-demo-code_git_log", json!({"max_count": 20}), Context),
            ("github_create_issue", json!({}), Unclassified),
            ("custom_repo_git_show", json!({}), Unclassified),
            ("Repo_git_show", json!({}), Unclassified),
        ];
        for (tool, input, want) in cases {
            assert_eq!(signal_class(tool, &input), want, "{tool} {input}");
        }
        for tool in CONTEXT_TOOLS {
            assert_eq!(signal_class(tool, &json!({})), Context, "{tool}");
        }
        for (class, counts) in [
            (Logs, true),
            (Metrics, true),
            (Traces, true),
            (Change, true),
            (Infra, true),
            (Context, false),
            (Unclassified, false),
        ] {
            assert_eq!(class.counts(), counts, "{class:?}");
        }
    }

    /// A citation matches a toolset call with or without the server, never by a partial name.
    #[test]
    fn toolset_citations_match_with_or_without_the_server() {
        let path = r#"{"path":"src/payment/charge.js"}"#;
        let log = [
            rec(
                "c1",
                "orca-demo-code_read_file",
                path,
                json!({"path": "src/payment/charge.js"}),
                1,
                true,
            ),
            rec(
                "c2",
                "orca-demo-code_search_code",
                r#"{"pattern":"Invalid token"}"#,
                json!({"pattern": "Invalid token"}),
                2,
                true,
            ),
            rec(
                "k1",
                "cli_kubectl",
                "kubectl get pods",
                json!({"command": "kubectl get pods"}),
                3,
                true,
            ),
        ];
        for cited in ["read_file", "orca-demo-code_read_file", "o2_read_file"] {
            assert_eq!(
                match_citation(cited, r#"{ "path": "src/payment/charge.js" }"#, &log)
                    .unwrap()
                    .call_id,
                "c1",
                "{cited}"
            );
        }
        // An unrelated tool, a part of the tool name, or another server does not match.
        for cited in [
            "file",
            "code_read_file",
            "other-code_read_file",
            "search_code",
        ] {
            assert_eq!(
                match_citation(cited, path, &log),
                Err(UnverifiedReason::NotRun),
                "{cited}"
            );
        }
        // A shell toolset prefix is not a server.
        assert_eq!(
            match_citation("kubectl", "kubectl get pods", &log),
            Err(UnverifiedReason::NotRun)
        );
    }

    /// A code toolset citation matches by what the call read: a bare path or sha, or a line range
    /// inside the read; anything else about the read, or any other tool, still has to be exact.
    #[test]
    fn code_citations_match_by_what_the_call_read() {
        let log = [
            rec(
                "whole",
                "orca-demo-code_read_file",
                r#"{"path":"src/payment/charge.js"}"#,
                json!({"path": "src/payment/charge.js"}),
                1,
                true,
            ),
            rec(
                "part",
                "orca-demo-code_read_file",
                r#"{"path":"src/checkout/main.go","start_line":300,"end_line":360}"#,
                json!({"path": "src/checkout/main.go", "start_line": 300, "end_line": 360}),
                2,
                true,
            ),
            rec(
                "diff",
                "orca-demo-code_git_show",
                r#"{"sha":"4f2c1e"}"#,
                json!({"sha": "4f2c1e"}),
                3,
                true,
            ),
            rec(
                "around",
                "SearchAround",
                r#"{"stream":"logs","key":"k1"}"#,
                json!({"stream": "logs", "key": "k1"}),
                4,
                true,
            ),
        ];
        for (cited_tool, cited, call) in [
            ("read_file", "src/payment/charge.js", "whole"),
            (
                "read_file",
                r#"{"path":"src/payment/charge.js","start_line":1,"end_line":88}"#,
                "whole",
            ),
            ("read_file", "src/checkout/main.go", "part"),
            (
                "read_file",
                r#"{"path":"src/checkout/main.go","start_line":310,"end_line":360}"#,
                "part",
            ),
            ("read_file", r#"{"path":"src/checkout/main.go"}"#, "part"),
            ("git_show", "4f2c1e", "diff"),
        ] {
            assert_eq!(
                match_citation(cited_tool, cited, &log).map(|r| r.call_id.as_str()),
                Ok(call),
                "{cited}"
            );
        }
        for (cited_tool, cited) in [
            // A range the call did not read.
            (
                "read_file",
                r#"{"path":"src/checkout/main.go","start_line":1,"end_line":40}"#,
            ),
            (
                "read_file",
                r#"{"path":"src/checkout/main.go","start_line":350,"end_line":400}"#,
            ),
            // Another file, or another argument changed.
            ("read_file", "src/payment/index.js"),
            (
                "read_file",
                r#"{"path":"src/payment/charge.js","ref":"main"}"#,
            ),
            ("git_show", "9a9a9a"),
            // Not a code toolset: still exact.
            ("SearchAround", r#"{"stream":"logs"}"#),
            ("SearchAround", "logs"),
        ] {
            assert_eq!(
                match_citation(cited_tool, cited, &log),
                Err(UnverifiedReason::NotRun),
                "{cited}"
            );
        }
    }

    /// A toolset code read verifies but adds no class; a toolset diff is a decisive `change`.
    #[test]
    fn toolset_code_reads_verify_and_toolset_diffs_read_the_suspect_change() {
        let file = r#"{"path":"src/payment/charge.js"}"#;
        let commit = r#"{"sha":"4f2c1e"}"#;
        let tool_log = [
            prom("m1", "pool_active", 1),
            rec(
                "f1",
                "orca-demo-code_read_file",
                file,
                json!({"path": "src/payment/charge.js"}),
                2,
                true,
            ),
            rec(
                "d1",
                "orca-demo-code_git_show",
                commit,
                json!({"sha": "4f2c1e"}),
                3,
                true,
            ),
            logs("l1", "SELECT * FROM app", 4),
        ];
        let grade_with = |cause_item: serde_json::Value| {
            let calls = [
                hyp(
                    1,
                    "h1",
                    "root_cause",
                    vec![decisive("e1", PROM, "pool_active"), cause_item],
                ),
                hyp(
                    2,
                    "h2",
                    "ruled_out",
                    vec![item(
                        "e3",
                        SQL,
                        "SELECT * FROM app",
                        "rules_out",
                        "supporting",
                    )],
                ),
            ];
            let (ledger, spots, _) = crate::meta::oncall::rca_run::build_ledger(
                &calls,
                Some(crate::meta::oncall::rca_run::fixtures::RUN_END_US),
            );
            let mut verdict = named(Confidence::High);
            verdict.suspect_change = Some(suspect(SuspectChangeState::Confirmed));
            grade_confidence(
                &verdict,
                ledger.as_ref(),
                &spots,
                &tool_log,
                &BTreeMap::new(),
            )
        };

        let code = grade_with(decisive("e2", "read_file", file));
        assert!(code.unverified.is_empty(), "{:?}", code.unverified);
        assert_eq!(code.decisive_classes, vec![SignalClass::Metrics]);
        assert_eq!(
            code.reasons,
            vec![
                GradeReason::DecisiveClass,
                GradeReason::SuspectChangeNotRead
            ]
        );
        assert_eq!(code.graded, Confidence::Medium);

        let diff = grade_with(decisive("e2", "git_show", commit));
        assert!(diff.unverified.is_empty(), "{:?}", diff.unverified);
        assert_eq!(
            diff.decisive_classes,
            vec![SignalClass::Metrics, SignalClass::Change]
        );
        assert_eq!(
            diff.reasons,
            vec![GradeReason::TwoDecisiveClassesAndRuledOut]
        );
        assert_eq!(diff.graded, Confidence::High);
    }

    fn log() -> Vec<ToolCallRecord> {
        vec![
            prom("m1", "pool_active", 1),
            prom("m2", "pool_waiting", 2),
            traces("t1", "slow", 3),
            logs("l1", "SELECT * FROM app", 4),
            shell("d1", "gh pr diff 812", 5, true),
            rec("g1", "GetIncident", "inc", json!({}), 6, true),
        ]
    }

    fn grade(calls: &[LedgerCall], verdict: &SubmittedVerdict) -> ConfidenceGrade {
        let (ledger, spots, _) = crate::meta::oncall::rca_run::build_ledger(
            calls,
            Some(crate::meta::oncall::rca_run::fixtures::RUN_END_US),
        );
        grade_confidence(verdict, ledger.as_ref(), &spots, &log(), &BTreeMap::new())
    }

    fn named(claimed: Confidence) -> SubmittedVerdict {
        submitted("pool exhausted after PR #812", claimed)
    }

    fn decisive(id: &str, tool: &str, q: &str) -> serde_json::Value {
        item(id, tool, q, "supports", "decisive")
    }

    /// Two decisive classes on h1 and a verified rules_out on h2.
    fn high_calls() -> Vec<LedgerCall> {
        vec![
            hyp(
                1,
                "h1",
                "root_cause",
                vec![
                    decisive("e1", PROM, "pool_active"),
                    decisive("e2", TRACES, "slow"),
                ],
            ),
            hyp(
                2,
                "h2",
                "ruled_out",
                vec![item(
                    "e3",
                    SQL,
                    "SELECT * FROM app",
                    "rules_out",
                    "supporting",
                )],
            ),
        ]
    }

    /// Floors, bases, high conditions, caps, min(claimed, graded), same class once.
    #[test]
    fn the_grade_follows_the_table() {
        use Confidence::*;
        use GradeReason::*;
        let h = Confidence::High;
        let one_decisive = vec![hyp(
            1,
            "h1",
            "root_cause",
            vec![decisive("e1", PROM, "pool_active")],
        )];
        let mut with_lead = high_calls();
        with_lead[0] = hyp_input(
            1,
            json!({"id": "h1", "statement": "s", "status": "root_cause", "reason": "r", "lead_ids": ["stg_arao"],
                   "evidence": [decisive("e1", PROM, "pool_active"), decisive("e2", TRACES, "slow")]}),
        );
        let mut past_lead = with_lead.clone();
        past_lead[0].input["lead_ids"] = json!(["past:inc_4"]);
        let mut suspect_verdict = named(h);
        suspect_verdict.suspect_change = Some(suspect(SuspectChangeState::Confirmed));
        let mut with_diff = high_calls();
        with_diff[0].input["evidence"]
            .as_array_mut()
            .unwrap()
            .push(item("e4", BASH, "gh pr diff 812", "supports", "supporting"));
        let mut contradicted = high_calls();
        contradicted[0].input["evidence"]
            .as_array_mut()
            .unwrap()
            .push(item(
                "e5",
                SQL,
                "SELECT * FROM app",
                "contradicts",
                "supporting",
            ));
        let mut with_change_spot = high_calls();
        with_change_spot.push(spot(
            3,
            "b1",
            "change",
            "connect_toolset",
            "No change history",
        ));

        // (case, calls, verdict, graded, band, reasons, decisive classes)
        type GradeCase<'a> = (
            &'a str,
            Vec<LedgerCall>,
            SubmittedVerdict,
            Confidence,
            Confidence,
            Vec<GradeReason>,
            Vec<SignalClass>,
        );
        let cases: Vec<GradeCase> = vec![
            (
                "cause unknown",
                one_decisive.clone(),
                submitted(" Cause Unknown ", h),
                Low,
                Low,
                vec![NoConfirmedCause],
                vec![SignalClass::Metrics],
            ),
            (
                "no root_cause or contributing",
                vec![hyp(
                    1,
                    "h1",
                    "likely",
                    vec![decisive("e1", PROM, "pool_active")],
                )],
                named(h),
                Low,
                Low,
                vec![NoConfirmedCause],
                vec![SignalClass::Metrics],
            ),
            (
                "two root causes, one with no verified evidence",
                vec![
                    hyp(
                        1,
                        "h1",
                        "root_cause",
                        vec![decisive("e1", PROM, "pool_active")],
                    ),
                    hyp(2, "h2", "root_cause", vec![]),
                ],
                named(h),
                Low,
                Low,
                vec![NoVerifiedEvidence],
                vec![],
            ),
            (
                "no ledger",
                vec![],
                named(h),
                Low,
                Low,
                vec![NoConfirmedCause, NoLedger],
                vec![],
            ),
            (
                "no verified support",
                vec![hyp(
                    1,
                    "h1",
                    "root_cause",
                    vec![decisive("e1", PROM, "never ran")],
                )],
                named(h),
                Low,
                Low,
                vec![NoVerifiedEvidence],
                vec![],
            ),
            (
                "only a contradiction",
                vec![hyp(
                    1,
                    "h1",
                    "root_cause",
                    vec![item("e1", PROM, "pool_active", "contradicts", "decisive")],
                )],
                named(h),
                Low,
                Low,
                vec![NoVerifiedEvidence],
                vec![],
            ),
            (
                "verified support only",
                vec![hyp(
                    1,
                    "h1",
                    "root_cause",
                    vec![item("e1", PROM, "pool_active", "supports", "supporting")],
                )],
                named(h),
                Low,
                Low,
                vec![VerifiedSupport],
                vec![],
            ),
            (
                "context does not count",
                vec![hyp(
                    1,
                    "h1",
                    "root_cause",
                    vec![decisive("e1", "GetIncident", "inc")],
                )],
                named(h),
                Low,
                Low,
                vec![VerifiedSupport],
                vec![],
            ),
            (
                "one decisive class",
                one_decisive.clone(),
                named(h),
                Medium,
                Medium,
                vec![DecisiveClass],
                vec![SignalClass::Metrics],
            ),
            (
                "same class twice counts once",
                vec![
                    hyp(
                        1,
                        "h1",
                        "root_cause",
                        vec![
                            decisive("e1", PROM, "pool_active"),
                            decisive("e2", PROM, "pool_waiting"),
                        ],
                    ),
                    hyp(
                        2,
                        "h2",
                        "ruled_out",
                        vec![item(
                            "e3",
                            SQL,
                            "SELECT * FROM app",
                            "rules_out",
                            "supporting",
                        )],
                    ),
                ],
                named(h),
                Medium,
                Medium,
                vec![DecisiveClass],
                vec![SignalClass::Metrics],
            ),
            (
                "two classes and a ruled-out alternative",
                high_calls(),
                named(h),
                High,
                High,
                vec![TwoDecisiveClassesAndRuledOut],
                vec![SignalClass::Metrics, SignalClass::Traces],
            ),
            (
                "two classes, no ruled-out alternative",
                vec![high_calls()[0].clone()],
                named(h),
                Medium,
                Medium,
                vec![DecisiveClass],
                vec![SignalClass::Metrics, SignalClass::Traces],
            ),
            (
                "ruled out on an unverified item",
                vec![
                    high_calls()[0].clone(),
                    hyp(
                        2,
                        "h2",
                        "ruled_out",
                        vec![item("e3", SQL, "never", "rules_out", "supporting")],
                    ),
                ],
                named(h),
                Medium,
                Medium,
                vec![DecisiveClass],
                vec![SignalClass::Metrics, SignalClass::Traces],
            ),
            (
                "contradiction on the cause",
                contradicted,
                named(h),
                Medium,
                Medium,
                vec![DecisiveClass, ContradictingEvidence],
                vec![SignalClass::Metrics, SignalClass::Traces],
            ),
            (
                "suspect change not read",
                high_calls(),
                suspect_verdict.clone(),
                Medium,
                Medium,
                vec![TwoDecisiveClassesAndRuledOut, SuspectChangeNotRead],
                vec![SignalClass::Metrics, SignalClass::Traces],
            ),
            (
                "suspect change read",
                with_diff,
                suspect_verdict,
                High,
                High,
                vec![TwoDecisiveClassesAndRuledOut],
                vec![SignalClass::Metrics, SignalClass::Traces],
            ),
            (
                "change history unreachable",
                with_change_spot,
                named(h),
                Medium,
                Medium,
                vec![TwoDecisiveClassesAndRuledOut, ChangeHistoryUnreachable],
                vec![SignalClass::Metrics, SignalClass::Traces],
            ),
            (
                "human lead",
                with_lead,
                named(h),
                Medium,
                Medium,
                vec![TwoDecisiveClassesAndRuledOut, HumanLead],
                vec![SignalClass::Metrics, SignalClass::Traces],
            ),
            (
                "past-cause lead is not human",
                past_lead,
                named(h),
                High,
                High,
                vec![TwoDecisiveClassesAndRuledOut],
                vec![SignalClass::Metrics, SignalClass::Traces],
            ),
            (
                "claimed low keeps the caution",
                high_calls(),
                named(Low),
                High,
                Low,
                vec![TwoDecisiveClassesAndRuledOut],
                vec![SignalClass::Metrics, SignalClass::Traces],
            ),
            (
                "claimed medium",
                high_calls(),
                named(Medium),
                High,
                Medium,
                vec![TwoDecisiveClassesAndRuledOut],
                vec![SignalClass::Metrics, SignalClass::Traces],
            ),
            (
                "contributing subject",
                vec![hyp(
                    1,
                    "h1",
                    "contributing",
                    vec![decisive("e1", PROM, "pool_active")],
                )],
                named(h),
                Medium,
                Medium,
                vec![DecisiveClass],
                vec![SignalClass::Metrics],
            ),
        ];
        for (case, calls, verdict, graded, band, reasons, classes) in cases {
            let g = grade(&calls, &verdict);
            assert_eq!(g.graded, graded, "{case}: graded");
            assert_eq!(g.band, band, "{case}: band");
            assert_eq!(g.claimed, verdict.claimed_confidence, "{case}: claimed");
            assert_eq!(g.reasons, reasons, "{case}: reasons");
            assert_eq!(g.decisive_classes, classes, "{case}: classes");
        }
        let g = grade(&high_calls(), &named(h));
        assert_eq!(g.ruled_out, ["h2 statement"]);
        assert_eq!(g.subject_id.as_deref(), Some("h1"));
    }

    /// Each root cause is graded on its own evidence; the run takes the lowest cause band.
    #[test]
    fn several_root_causes_are_graded_one_by_one() {
        use Confidence::*;
        use SignalClass as S;
        let ruled_out = hyp(
            9,
            "h3",
            "ruled_out",
            vec![item("e9", PROM, "pool_waiting", "rules_out", "supporting")],
        );
        let root = |seq, id: &str, evidence| hyp(seq, id, "root_cause", evidence);
        let two_classes = || {
            vec![
                decisive("e1", PROM, "pool_active"),
                decisive("e2", TRACES, "slow"),
            ]
        };
        let cause = |id: &str, graded, classes: Vec<SignalClass>| CauseGrade {
            hypothesis_id: id.into(),
            graded,
            decisive_classes: classes,
        };
        // (case, calls, run graded, run reasons, run classes, causes, evidence reason, next)
        type SeveralCase<'a> = (
            &'a str,
            Vec<LedgerCall>,
            Confidence,
            Vec<GradeReason>,
            Vec<SignalClass>,
            Vec<CauseGrade>,
            &'a str,
            Option<&'a str>,
        );
        let cases: Vec<SeveralCase> = vec![
            (
                "high and medium",
                vec![
                    root(1, "h1", two_classes()),
                    root(2, "h2", vec![decisive("e3", SQL, "SELECT * FROM app")]),
                    ruled_out.clone(),
                ],
                Medium,
                vec![GradeReason::DecisiveClass],
                vec![S::Logs],
                vec![
                    cause("h1", High, vec![S::Metrics, S::Traces]),
                    cause("h2", Medium, vec![S::Logs]),
                ],
                "2 causes, each with a decisive source, 1 alternative ruled out",
                Some("High needs a second decisive source for every cause"),
            ),
            (
                "both high",
                vec![
                    root(1, "h1", two_classes()),
                    root(
                        2,
                        "h2",
                        vec![
                            decisive("e3", SQL, "SELECT * FROM app"),
                            decisive("e4", PROM, "pool_active"),
                        ],
                    ),
                    ruled_out.clone(),
                ],
                High,
                vec![GradeReason::TwoDecisiveClassesAndRuledOut],
                vec![S::Metrics, S::Traces],
                vec![
                    cause("h1", High, vec![S::Metrics, S::Traces]),
                    cause("h2", High, vec![S::Logs, S::Metrics]),
                ],
                "2 causes, each with 2 or more decisive sources, 1 alternative ruled out",
                None,
            ),
            (
                "one below medium",
                vec![
                    root(1, "h1", vec![decisive("e1", PROM, "pool_active")]),
                    root(
                        2,
                        "h2",
                        vec![item(
                            "e3",
                            SQL,
                            "SELECT * FROM app",
                            "supports",
                            "supporting",
                        )],
                    ),
                ],
                Low,
                vec![GradeReason::VerifiedSupport],
                vec![],
                vec![
                    cause("h1", Medium, vec![S::Metrics]),
                    cause("h2", Low, vec![]),
                ],
                "2 causes, 1 with a decisive source",
                Some("Medium needs a decisive source for every cause"),
            ),
            (
                "one with no verified evidence",
                vec![
                    root(1, "h1", vec![decisive("e1", PROM, "pool_active")]),
                    root(2, "h2", vec![]),
                ],
                Low,
                vec![GradeReason::NoVerifiedEvidence],
                vec![],
                vec![
                    cause("h1", Medium, vec![S::Metrics]),
                    cause("h2", Low, vec![]),
                ],
                "no verified evidence",
                None,
            ),
        ];
        for (case, calls, graded, reasons, classes, causes, reason, next) in cases {
            let g = grade(&calls, &named(High));
            assert_eq!(g.graded, graded, "{case}: graded");
            assert_eq!(g.band, graded, "{case}: band");
            assert_eq!(g.reasons, reasons, "{case}: reasons");
            assert_eq!(g.decisive_classes, classes, "{case}: classes");
            assert_eq!(g.causes, causes, "{case}: causes");
            assert_eq!(g.subject_id.as_deref(), Some("h1"), "{case}: subject");
            let b = g.breakdown();
            assert_eq!(b.evidence_reason, reason, "{case}: evidence reason");
            assert_eq!(b.next_level.as_deref(), next, "{case}: next level");
        }

        let g = grade(
            &[
                root(1, "h1", two_classes()),
                root(2, "h2", vec![decisive("e3", SQL, "SELECT * FROM app")]),
                ruled_out,
            ],
            &named(High),
        );
        assert_eq!(
            g.reason_line(),
            "medium · claimed high · 2 causes · decisive: logs · ruled out: h3 statement"
        );
        // "cause unknown" grades no cause, so no cause list.
        let g = grade(
            &[
                root(1, "h1", two_classes()),
                root(2, "h2", vec![decisive("e3", SQL, "SELECT * FROM app")]),
            ],
            &submitted("cause unknown", High),
        );
        assert!(g.causes.is_empty());
        assert_eq!(g.reasons, [GradeReason::NoConfirmedCause]);
        // A stored grade from before several causes were graded still reads.
        let old: ConfidenceGrade = serde_json::from_value(json!({
            "band": "low", "claimed": "high", "graded": "low",
            "reasons": ["ambiguous_cause"], "decisive_classes": ["metrics"],
        }))
        .unwrap();
        assert_eq!(old.reasons, [GradeReason::NoConfirmedCause]);
        assert!(old.causes.is_empty());
    }

    /// The example reason lines, adapted to the contract's texts.
    #[test]
    fn reason_lines_match_the_examples() {
        use Confidence::*;
        use SignalClass as S;
        let g = |band,
                 claimed,
                 graded,
                 reasons: Vec<GradeReason>,
                 classes: Vec<SignalClass>,
                 ruled_out: Vec<&str>,
                 unverified: usize| ConfidenceGrade {
            band,
            claimed,
            graded,
            reasons,
            decisive_classes: classes,
            ruled_out: ruled_out.into_iter().map(str::to_string).collect(),
            unverified: (0..unverified)
                .map(|i| UnverifiedCitation {
                    hypothesis_id: "h1".into(),
                    evidence_id: format!("e{i}"),
                    tool: PROM.into(),
                    query: "q".into(),
                    reason: UnverifiedReason::NotRun,
                })
                .collect(),
            subject_id: Some("h1".into()),
            lead_author: None,
            causes: vec![],
        };
        let cases = [
            (
                g(
                    High,
                    High,
                    High,
                    vec![GradeReason::TwoDecisiveClassesAndRuledOut],
                    vec![S::Traces, S::Change],
                    vec!["node CPU"],
                    0,
                ),
                "high · decisive: traces + change · ruled out: node CPU",
            ),
            (
                g(
                    Medium,
                    Medium,
                    Medium,
                    vec![
                        GradeReason::TwoDecisiveClassesAndRuledOut,
                        GradeReason::SuspectChangeNotRead,
                    ],
                    vec![S::Metrics],
                    vec![],
                    0,
                ),
                "medium · decisive: metrics · capped: suspect change not read",
            ),
            (
                g(
                    Medium,
                    High,
                    Medium,
                    vec![
                        GradeReason::DecisiveClass,
                        GradeReason::ChangeHistoryUnreachable,
                    ],
                    vec![S::Metrics],
                    vec![],
                    0,
                ),
                // One decisive class already means medium: the cap lowered nothing.
                "medium · claimed high · decisive: metrics",
            ),
            (
                g(
                    Medium,
                    Medium,
                    Medium,
                    vec![
                        GradeReason::TwoDecisiveClassesAndRuledOut,
                        GradeReason::HumanLead,
                    ],
                    vec![S::Change, S::Metrics],
                    vec![],
                    0,
                ),
                "medium · decisive: change + metrics · capped: lead from a person, not a tool",
            ),
            (
                g(
                    Low,
                    Low,
                    Low,
                    vec![GradeReason::NoVerifiedEvidence],
                    vec![],
                    vec![],
                    3,
                ),
                "low · no verified evidence · 3 citations did not run",
            ),
            (
                g(
                    Low,
                    Low,
                    Low,
                    vec![GradeReason::VerifiedSupport],
                    vec![],
                    vec![],
                    0,
                ),
                "low · one class of supporting evidence",
            ),
        ];
        for (grade, want) in &cases {
            assert_eq!(grade.reason_line(), *want);
        }
        // The card's breakdown of the same grades.
        let breakdown = |i: usize| cases[i].0.breakdown();
        let b = |claimed, evidence, reason: &str, next: Option<&str>, caps: &[&str]| {
            ConfidenceBreakdown {
                claimed,
                evidence,
                evidence_reason: reason.to_string(),
                next_level: next.map(str::to_string),
                caps: caps.iter().map(|c| c.to_string()).collect(),
            }
        };
        assert_eq!(
            breakdown(0),
            b(
                High,
                High,
                "2 decisive sources (traces + change), 1 alternative ruled out",
                None,
                &[]
            )
        );
        assert_eq!(
            breakdown(1),
            b(
                Medium,
                High,
                "1 decisive source (metrics)",
                None,
                &["suspect change not read"]
            )
        );
        assert_eq!(
            breakdown(2),
            b(
                High,
                Medium,
                "1 decisive source (metrics)",
                Some("High needs a second decisive source and a ruled-out alternative"),
                &[]
            ),
            "a cap on a medium evidence level is not listed"
        );
        assert_eq!(breakdown(4), b(Low, Low, "no verified evidence", None, &[]));
        assert_eq!(
            breakdown(5),
            b(
                Low,
                Low,
                "supporting evidence, none decisive",
                Some("Medium needs a decisive source"),
                &[]
            )
        );
        // The low row through grade_confidence: three citations that did not run.
        let calls = [hyp(
            1,
            "h1",
            "root_cause",
            vec![
                decisive("e1", PROM, "a"),
                decisive("e2", PROM, "b"),
                decisive("e3", TRACES, "c"),
            ],
        )];
        assert_eq!(
            grade(&calls, &named(Low)).reason_line(),
            "low · no verified evidence · 3 citations did not run"
        );
        assert_eq!(
            grade(&calls, &named(High)).reason_line(),
            "low · claimed high · no verified evidence · 3 citations did not run"
        );
        // Each floor text.
        for (reason, text) in [
            (GradeReason::NoConfirmedCause, "low · no confirmed cause"),
            (GradeReason::NoLedger, "low · no hypotheses recorded"),
        ] {
            assert_eq!(
                g(Low, Low, Low, vec![reason], vec![], vec![], 0).reason_line(),
                text
            );
        }
        // Failed citations ran, so they are not counted; one not-run citation is singular.
        let mut mixed = g(
            Low,
            Low,
            Low,
            vec![GradeReason::NoVerifiedEvidence],
            vec![],
            vec![],
            2,
        );
        mixed.unverified[0].reason = UnverifiedReason::Failed;
        assert_eq!(
            mixed.reason_line(),
            "low · no verified evidence · 1 citation did not run"
        );
        mixed.unverified[1].reason = UnverifiedReason::Failed;
        assert_eq!(mixed.reason_line(), "low · no verified evidence");
        // No ledger also holds no confirmed cause; the line names the missing ledger.
        let no_ledger = grade_confidence(&named(Low), None, &[], &[], &BTreeMap::new());
        assert_eq!(no_ledger.reason_line(), "low · no hypotheses recorded");
        assert_eq!(
            no_ledger.breakdown().evidence_reason,
            "no hypotheses recorded"
        );
    }

    /// An inconclusive or blocked outcome lowers the band; nothing raises it.
    #[test]
    fn apply_outcome_only_lowers() {
        let medium = grade(
            &[hyp(
                1,
                "h1",
                "root_cause",
                vec![decisive("e1", PROM, "pool_active")],
            )],
            &named(Confidence::High),
        );
        assert_eq!(medium.band, Confidence::Medium);

        let mut g = medium.clone();
        apply_outcome(
            &mut g,
            RcaOutcome::RootCauseIdentified,
            OutcomeReason::RootCauseGraded,
        );
        assert_eq!(g, medium);
        let mut g = medium.clone();
        apply_outcome(
            &mut g,
            RcaOutcome::ContributingFactor,
            OutcomeReason::ContributingGraded,
        );
        assert_eq!(g, medium);

        let mut g = medium.clone();
        apply_outcome(&mut g, RcaOutcome::Blocked, OutcomeReason::LeadingBlocked);
        assert_eq!(g.band, Confidence::Low);
        assert_eq!(g.graded, Confidence::Medium);
        assert_eq!(g.reasons.last(), Some(&GradeReason::NoConfirmedCause));

        let mut g = medium.clone();
        apply_outcome(
            &mut g,
            RcaOutcome::Inconclusive,
            OutcomeReason::NoConfirmedCause,
        );
        assert_eq!(g.band, Confidence::Low);
        assert_eq!(g.reasons.last(), Some(&GradeReason::NoConfirmedCause));
        apply_outcome(
            &mut g,
            RcaOutcome::Inconclusive,
            OutcomeReason::NoConfirmedCause,
        );
        assert_eq!(
            g.reasons
                .iter()
                .filter(|r| **r == GradeReason::NoConfirmedCause)
                .count(),
            1
        );
        // Several graded causes keep their band; one below medium lowers it with no floor.
        let mut g = medium.clone();
        apply_outcome(
            &mut g,
            RcaOutcome::MultipleRootCauses,
            OutcomeReason::RootCausesGraded,
        );
        assert_eq!(g, medium);
        let mut g = medium.clone();
        apply_outcome(
            &mut g,
            RcaOutcome::Inconclusive,
            OutcomeReason::CauseBelowMedium,
        );
        assert_eq!(g.band, Confidence::Low);
        assert_eq!(g.reasons, medium.reasons);

        let low = grade(&[], &named(Confidence::Low));
        let mut g = low.clone();
        apply_outcome(
            &mut g,
            RcaOutcome::RootCauseIdentified,
            OutcomeReason::RootCauseGraded,
        );
        assert_eq!(g.band, Confidence::Low, "never raised");
        assert_eq!(
            min_band(Confidence::High, Confidence::Medium),
            Confidence::Medium
        );
        assert_eq!(min_band(Confidence::Low, Confidence::High), Confidence::Low);
        assert_eq!(
            min_band(Confidence::High, Confidence::High),
            Confidence::High
        );
    }

    /// One cause with only supporting evidence is inconclusive, and the card still says why the
    /// evidence is low and what medium needs, instead of "no confirmed cause".
    #[test]
    fn a_cause_below_medium_keeps_its_basis() {
        let low = grade(
            &[hyp(
                1,
                "h1",
                "root_cause",
                vec![item("e1", PROM, "pool_active", "supports", "supporting")],
            )],
            &named(Confidence::Medium),
        );
        assert_eq!(low.band, Confidence::Low);
        let mut g = low.clone();
        apply_outcome(
            &mut g,
            RcaOutcome::Inconclusive,
            OutcomeReason::CauseBelowMedium,
        );
        assert_eq!(g, low);
        let breakdown = g.breakdown();
        assert_eq!(
            breakdown.evidence_reason,
            "supporting evidence, none decisive"
        );
        assert_eq!(
            breakdown.next_level.as_deref(),
            Some("Medium needs a decisive source")
        );
    }

    /// Decisive change + metrics with a steering lead grades medium; the cap names the author.
    #[test]
    fn sg36_frame_g_human_lead_names_the_author() {
        let steer_id = "stg_2NjLm8W3pXyZqR7tVbK9cDfGhJ1";
        assert!(crate::meta::alerts::rca_steering::is_steer_id(steer_id));
        let mut calls = high_calls();
        calls[0] = hyp_input(
            1,
            json!({"id": "h1", "statement": "pool exhausted after PR #812", "status": "root_cause",
                   "reason": "r", "lead_ids": [steer_id],
                   "evidence": [item("e1", BASH, "gh pr diff 812", "supports", "decisive"),
                                decisive("e2", PROM, "pool_active")]}),
        );
        let (ledger, spots, _) = crate::meta::oncall::rca_run::build_ledger(
            &calls,
            Some(crate::meta::oncall::rca_run::fixtures::RUN_END_US),
        );
        let authors = BTreeMap::from([(steer_id.to_string(), "a.rao@acme.io".to_string())]);
        let g = grade_confidence(
            &named(Confidence::High),
            ledger.as_ref(),
            &spots,
            &log(),
            &authors,
        );
        assert_eq!(g.band, Confidence::Medium);
        assert_eq!(g.graded, Confidence::Medium);
        assert!(
            g.reasons.contains(&GradeReason::HumanLead),
            "{:?}",
            g.reasons
        );
        assert_eq!(g.lead_author.as_deref(), Some("a.rao@acme.io"));
        let line = g.reason_line();
        assert!(line.starts_with("medium · "), "{line}");
        assert!(
            line.contains("change") && line.contains("metrics"),
            "{line}"
        );
        assert!(line.contains("capped: lead from a.rao"), "{line}");
        assert!(!line.contains("acme.io"), "{line}");

        // Without an author map the cap keeps the generic text.
        let g = grade_confidence(
            &named(Confidence::High),
            ledger.as_ref(),
            &spots,
            &log(),
            &BTreeMap::new(),
        );
        assert_eq!(g.band, Confidence::Medium);
        assert_eq!(g.lead_author, None);
        assert!(
            g.reason_line()
                .ends_with("capped: lead from a person, not a tool"),
            "{}",
            g.reason_line()
        );
    }

    /// An `impact.window` ending at resolve time, past the last observed data, caps the band.
    #[test]
    fn an_impact_window_outside_the_observed_data_is_capped() {
        use Confidence::*;
        use GradeReason::ImpactOutsideObservedData;

        use crate::meta::oncall::rca_run::{Impact, build_ledger, fixtures::RUN_END_US};

        const MIN: i64 = 60_000_000;
        let (first_seen, last_seen) = (5 * MIN, 30 * MIN);
        // Every call queried 0..60 min and its rows showed data from 5 to 30 min.
        let ranged = |mut r: ToolCallRecord, observed: Option<TimeWindow>, rows: u64| {
            r.target.start_us = Some(0);
            r.target.end_us = Some(60 * MIN);
            r.observed = observed;
            r.result_count = Some(rows);
            r
        };
        let seen = Some(TimeWindow {
            start: first_seen,
            end: last_seen,
        });
        let tool_log = |sql_rows: u64| {
            vec![
                ranged(prom("m1", "pool_active", 1), seen, 10),
                ranged(traces("t1", "slow", 3), seen, 10),
                // Rows with no timestamp: the call covers the range it queried.
                ranged(logs("l1", "SELECT * FROM app", 4), None, sql_rows),
                // The incident's resolve time is context, not an observation of the failure.
                rec("g1", "GetIncident", "inc", json!({}), 6, true),
            ]
        };
        let verdict = |start: i64, end: i64| {
            let mut v = named(High);
            v.impact = Some(Impact {
                summary: "~55% of checkouts failed".into(),
                peak: None,
                window: Some(TimeWindow { start, end }),
            });
            v
        };
        let graded = |v: &SubmittedVerdict, calls: &[LedgerCall], sql_rows: u64| {
            let (ledger, spots, _) = build_ledger(calls, Some(RUN_END_US));
            grade_confidence(
                v,
                ledger.as_ref(),
                &spots,
                &tool_log(sql_rows),
                &BTreeMap::new(),
            )
        };
        let resolved_at = last_seen + 11 * MIN;

        // Inside the data, or within the one-minute slack: high, no cap.
        for (start, end) in [(first_seen, last_seen), (first_seen - MIN, last_seen + MIN)] {
            let g = graded(&verdict(start, end), &high_calls(), 0);
            assert_eq!(g.band, High, "{start}..{end}");
            assert!(!g.reasons.contains(&ImpactOutsideObservedData));
        }
        // An end or a start past the observed data: capped to medium, named on the line and card.
        for (start, end) in [(first_seen, resolved_at), (0, last_seen)] {
            let g = graded(&verdict(start, end), &high_calls(), 0);
            assert_eq!(g.band, Medium, "{start}..{end}");
            assert!(g.reasons.contains(&ImpactOutsideObservedData));
            assert!(
                g.reason_line()
                    .ends_with("capped: impact window outside the observed data"),
                "{}",
                g.reason_line()
            );
            assert_eq!(
                g.breakdown().caps,
                ["impact window outside the observed data"]
            );
        }
        // A call whose rows show no timestamp but returned rows covers its queried range.
        let g = graded(&verdict(first_seen, resolved_at), &high_calls(), 7);
        assert_eq!(g.band, High);

        // At a medium evidence level the card says what High needs.
        let one_class = [hyp(
            1,
            "h1",
            "root_cause",
            vec![decisive("e1", PROM, "pool_active")],
        )];
        let g = graded(&verdict(first_seen, resolved_at), &one_class, 0);
        assert_eq!(g.band, Medium);
        assert!(g.reasons.contains(&ImpactOutsideObservedData));
        assert_eq!(
            g.breakdown().next_level.as_deref(),
            Some(
                "High needs a second decisive source and a ruled-out alternative and an \
                 impact window inside the observed data"
            )
        );

        // No window, or no runtime call with a range: nothing to compare.
        let mut no_window = verdict(first_seen, resolved_at);
        no_window.impact = None;
        assert_eq!(graded(&no_window, &high_calls(), 0).band, High);
        let (ledger, spots, _) = build_ledger(&high_calls(), Some(RUN_END_US));
        let g = grade_confidence(
            &verdict(first_seen, resolved_at),
            ledger.as_ref(),
            &spots,
            &log(),
            &BTreeMap::new(),
        );
        assert!(!g.reasons.contains(&ImpactOutsideObservedData));
    }
}
