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

//! Evidence-graded confidence (CG §5.2–§5.4): code grades the band of an RCA
//! verdict from the evidence the agent recorded and the tool calls that ran.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    agent::Confidence,
    rca_run::{
        BlindSpot, BlindSpotAxis, EvidenceLedger, EvidenceTarget, HypothesisStatus, OutcomeReason,
        Polarity, RcaOutcome, Strength, SubmittedVerdict, subject,
    },
};
use crate::meta::alerts::rca_steering::STEER_ID_PREFIX;

/// Statements of ruled-out hypotheses in a grade are cut to this many chars.
const RULED_OUT_MAX_CHARS: usize = 80;

/// The tools whose signal class comes from their `type` argument (CG §5.3.2).
const SEARCH_TOOLS: [&str; 4] = [
    "SearchSQL",
    "SearchAround",
    "ExtractPatterns",
    "SearchValues",
];

/// Tools that give context but never count toward the band (CG §5.3.2).
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

/// The kind of signal a tool call read (CG §5.3.2).
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

    /// Stable wire and display value.
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

/// The signal class of one tool call, from the bare tool name and its
/// unwrapped input (CG §5.3.2). Never from the ledger.
pub fn signal_class(tool: &str, input: &serde_json::Value) -> SignalClass {
    if SEARCH_TOOLS.contains(&tool) {
        return match input.get("type").and_then(serde_json::Value::as_str) {
            Some("metrics") => SignalClass::Metrics,
            Some("traces") => SignalClass::Traces,
            _ => SignalClass::Logs,
        };
    }
    if tool.starts_with("Prometheus") {
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
    SignalClass::Unclassified
}

/// A shell command that reads a diff: `gh pr diff`, `gh api …/commits/<sha>`,
/// `git show`, `git diff`. A commit list (`gh pr list`, `git log`) is not one.
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

/// One visible tool call of the run (CG §5.2, VE26, VE27).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ToolCallRecord {
    pub call_id: String,
    /// Bare name: `o2_` prefix stripped, `tools_call` unwrapped.
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
    pub result_summary: String,
}

/// Why a cited evidence item did not verify (CG §5.3.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum UnverifiedReason {
    /// No call with the same tool and key argument ran.
    NotRun,
    /// Matching calls ran, and all of them failed.
    Failed,
}

impl UnverifiedReason {
    /// Stable wire and metric-label value.
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

/// A grading rule that fired (CG §5.3.3, VE15).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GradeReason {
    NoConfirmedCause,
    AmbiguousCause,
    NoLedger,
    NoVerifiedEvidence,
    VerifiedSupport,
    DecisiveClass,
    TwoDecisiveClassesAndRuledOut,
    SuspectChangeNotRead,
    ChangeHistoryUnreachable,
    ContradictingEvidence,
    HumanLead,
}

impl GradeReason {
    /// The low-band text of a floor; `None` for every other reason.
    fn floor_text(&self) -> Option<&'static str> {
        match self {
            Self::NoConfirmedCause => Some("no confirmed cause"),
            Self::AmbiguousCause => Some("more than one root cause"),
            Self::NoLedger => Some("no hypotheses recorded"),
            Self::NoVerifiedEvidence => Some("no verified evidence"),
            _ => None,
        }
    }

    /// The text of a cap; `None` for every other reason. A `human_lead` cap names the
    /// lead's author by the local part of the email (SG36).
    fn cap_text(&self, lead_author: Option<&str>) -> Option<String> {
        let text = match self {
            Self::SuspectChangeNotRead => "suspect change not read",
            Self::ChangeHistoryUnreachable => "change history not reachable",
            Self::ContradictingEvidence => "contradicting evidence",
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

/// The band that code allows for a verdict, and why (CG §5.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ConfidenceGrade {
    /// `min(claimed, graded)`, then lowered by the outcome (VE15).
    pub band: Confidence,
    pub claimed: Confidence,
    /// What the rules allow, after caps.
    pub graded: Confidence,
    /// The rules that fired, in order.
    #[serde(default)]
    pub reasons: Vec<GradeReason>,
    #[serde(default)]
    pub decisive_classes: Vec<SignalClass>,
    /// Statements of ruled-out hypotheses with a verified `rules_out` or
    /// `contradicts` item, each cut to 80 chars.
    #[serde(default)]
    pub ruled_out: Vec<String>,
    #[serde(default)]
    pub unverified: Vec<UnverifiedCitation>,
    /// The VE13 subject hypothesis.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_id: Option<String>,
    /// The email of the author of the cause hypothesis' first steering lead, which a
    /// `human_lead` cap names (SG36).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_author: Option<String>,
}

impl ConfidenceGrade {
    /// The reason line (CG §5.3.4), built only from the grade.
    pub fn reason_line(&self) -> String {
        let mut line = self.band.as_str().to_string();
        if min_band(self.claimed, self.band) != self.claimed {
            line.push_str(" · claimed ");
            line.push_str(self.claimed.as_str());
        }
        let floor = [
            GradeReason::NoConfirmedCause,
            GradeReason::AmbiguousCause,
            GradeReason::NoLedger,
            GradeReason::NoVerifiedEvidence,
        ]
        .into_iter()
        .find(|r| self.reasons.contains(r))
        .and_then(|r| r.floor_text());
        // A low band that only the model's own claim set reads like the band the
        // rules allowed.
        let floor_format =
            self.band == Confidence::Low && (floor.is_some() || self.graded == Confidence::Low);
        if floor_format {
            line.push_str(" · ");
            line.push_str(floor.unwrap_or("one class of supporting evidence"));
            if !self.unverified.is_empty() {
                line.push_str(&format!(
                    " · {} citations did not run",
                    self.unverified.len()
                ));
            }
            return line;
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
        let lead_author = self.lead_author.as_deref();
        let caps: Vec<String> = self
            .reasons
            .iter()
            .filter_map(|r| r.cap_text(lead_author))
            .collect();
        if !caps.is_empty() {
            line.push_str(" · capped: ");
            line.push_str(&caps.join(", "));
        }
        line
    }
}

/// Collapses whitespace, trims, and drops one trailing `;` (CG §5.3.1).
pub fn normalize_key_arg(s: &str) -> String {
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    match collapsed.strip_suffix(';') {
        Some(rest) => rest.trim_end().to_string(),
        None => collapsed,
    }
}

/// The longest key argument a tool record keeps (CG §5.2); citations are cut the same way.
pub const KEY_ARG_MAX_BYTES: usize = 4 * 1024;

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

/// A key argument in the form it is compared in: a JSON object or array as a
/// parsed value (key order and whitespace do not matter), else normalized text.
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

/// The tool call that verifies a citation (CG §5.3.1): the same bare tool (a
/// leading `o2_` on the cited tool is ignored) and the same key argument, cut to
/// [KEY_ARG_MAX_BYTES] and normalized like the record's, compared as JSON when
/// both sides are JSON objects or arrays. The earliest successful record wins
/// (`started_at_us`, then `call_id`). Matches that only failed give `Failed`;
/// none give `NotRun`.
pub fn match_citation<'a>(
    tool: &str,
    query: &str,
    log: &'a [ToolCallRecord],
) -> Result<&'a ToolCallRecord, UnverifiedReason> {
    let tool = tool.strip_prefix("o2_").unwrap_or(tool);
    let query = MatchKey::of(query);
    let mut matched = false;
    let mut best: Option<&ToolCallRecord> = None;
    for record in log
        .iter()
        .filter(|r| r.tool == tool && MatchKey::of(&r.key_arg) == query)
    {
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

/// The lower of two bands. `Confidence` has no usable `Ord` (High is declared first).
pub fn min_band(a: Confidence, b: Confidence) -> Confidence {
    match (a, b) {
        (Confidence::Low, _) | (_, Confidence::Low) => Confidence::Low,
        (Confidence::Medium, _) | (_, Confidence::Medium) => Confidence::Medium,
        _ => Confidence::High,
    }
}

/// Grades the verdict from the ledger and the tool log (CG §5.3.1–§5.3.3).
/// `ledger: None` means the agent never called `record_hypothesis`. `steer_authors` maps
/// the run's steer ids to their authors' emails, so a `human_lead` cap names one (SG36).
pub fn grade_confidence(
    verdict: &SubmittedVerdict,
    ledger: Option<&EvidenceLedger>,
    blind_spots: &[BlindSpot],
    tool_log: &[ToolCallRecord],
    steer_authors: &BTreeMap<String, String>,
) -> ConfidenceGrade {
    let hypotheses = ledger.map(|l| l.hypotheses.as_slice()).unwrap_or_default();

    // Step 1: verify every item of every hypothesis.
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
    let cause = subject_id
        .as_deref()
        .and_then(|id| hypotheses.iter().position(|h| h.id == id));

    // Verified items of the cause hypothesis with their signal class.
    let cause_items: Vec<(Polarity, Strength, SignalClass)> = cause
        .map(|i| {
            hypotheses[i]
                .evidence
                .iter()
                .zip(&verified[i])
                .filter_map(|(item, rec)| rec.map(|r| (item.polarity, item.strength, r.signal)))
                .collect()
        })
        .unwrap_or_default();

    // Step 2: decisive classes.
    let mut decisive_classes: Vec<SignalClass> = Vec::new();
    for (polarity, strength, signal) in &cause_items {
        if *polarity == Polarity::Supports
            && *strength == Strength::Decisive
            && signal.counts()
            && !decisive_classes.contains(signal)
        {
            decisive_classes.push(*signal);
        }
    }

    let ruled_out: Vec<String> = hypotheses
        .iter()
        .zip(&verified)
        .enumerate()
        .filter(|(i, (h, recs))| {
            Some(*i) != cause
                && h.status == HypothesisStatus::RuledOut
                && h.evidence.iter().zip(recs.iter()).any(|(item, rec)| {
                    rec.is_some()
                        && matches!(item.polarity, Polarity::RulesOut | Polarity::Contradicts)
                })
        })
        .map(|(_, (h, _))| h.statement.chars().take(RULED_OUT_MAX_CHARS).collect())
        .collect();

    let has_support = cause_items.iter().any(|(p, ..)| *p == Polarity::Supports);
    let has_contradiction = cause_items
        .iter()
        .any(|(p, ..)| *p == Polarity::Contradicts);

    // Step 3: floors, then the basis.
    let cause_unknown = verdict
        .probable_cause
        .trim()
        .eq_ignore_ascii_case("cause unknown");
    let root_causes = hypotheses
        .iter()
        .filter(|h| h.status == HypothesisStatus::RootCause)
        .count();
    let has_confirmed = hypotheses.iter().any(|h| {
        matches!(
            h.status,
            HypothesisStatus::RootCause | HypothesisStatus::Contributing
        )
    });

    let mut reasons = Vec::new();
    if cause_unknown || !has_confirmed {
        reasons.push(GradeReason::NoConfirmedCause);
    }
    if root_causes > 1 {
        reasons.push(GradeReason::AmbiguousCause);
    }
    if ledger.is_none() {
        reasons.push(GradeReason::NoLedger);
    }
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

    // Caps, in order. They matter only above the floor.
    if graded != Confidence::Low {
        let change_read = cause_items
            .iter()
            .any(|(_, _, signal)| *signal == SignalClass::Change);
        let human_lead = cause.is_some_and(|i| {
            hypotheses[i]
                .lead_ids
                .iter()
                .any(|l| l.starts_with(STEER_ID_PREFIX))
        });
        let caps = [
            (
                verdict.suspect_change.is_some() && !change_read,
                GradeReason::SuspectChangeNotRead,
            ),
            (
                blind_spots.iter().any(|b| b.axis == BlindSpotAxis::Change),
                GradeReason::ChangeHistoryUnreachable,
            ),
            (has_contradiction, GradeReason::ContradictingEvidence),
            (human_lead, GradeReason::HumanLead),
        ];
        for (fired, reason) in caps {
            if fired {
                reasons.push(reason);
                graded = min_band(graded, Confidence::Medium);
            }
        }
    }

    // SG36: the first steering lead of the cause whose author is known.
    let lead_author = cause.and_then(|i| {
        hypotheses[i]
            .lead_ids
            .iter()
            .filter(|l| l.starts_with(STEER_ID_PREFIX))
            .find_map(|l| steer_authors.get(l).cloned())
    });
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
    }
}

/// VE15: an `inconclusive` or `blocked` outcome lowers the band to `low`. Only lowers.
pub fn apply_outcome(grade: &mut ConfidenceGrade, outcome: RcaOutcome, reason: OutcomeReason) {
    if !matches!(outcome, RcaOutcome::Inconclusive | RcaOutcome::Blocked) {
        return;
    }
    grade.band = Confidence::Low;
    let reason = if matches!(reason, OutcomeReason::AmbiguousCause) {
        GradeReason::AmbiguousCause
    } else {
        GradeReason::NoConfirmedCause
    };
    if !grade.reasons.contains(&reason) {
        grade.reasons.push(reason);
    }
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

    /// CG §5.3.1: normalization, earliest successful wins, failed vs not run.
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

    /// CG §5.3.1 (P3 contract update): `o2_` prefix, 4 KiB cut, JSON compared as values.
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

    /// CG §5.3.2: the signal class table.
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
        let (ledger, spots, _) = crate::meta::oncall::rca_run::build_ledger(calls, true);
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

    /// CG §5.3.3: floors, bases, high conditions, caps, min(claimed, graded), same class once.
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
                "two root causes",
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
                vec![AmbiguousCause],
                vec![SignalClass::Metrics],
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

    /// CG §5.3.4: the five example rows, adapted to the contract's texts (no
    /// "(PR #812 diff)" annotation; the human-lead cap text is fixed).
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
                "medium · claimed high · decisive: metrics · capped: change history not reachable",
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
        for (grade, want) in cases {
            assert_eq!(grade.reason_line(), want);
        }
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
            (
                GradeReason::AmbiguousCause,
                "low · more than one root cause",
            ),
            (GradeReason::NoLedger, "low · no hypotheses recorded"),
        ] {
            assert_eq!(
                g(Low, Low, Low, vec![reason], vec![], vec![], 0).reason_line(),
                text
            );
        }
    }

    /// VE15: an inconclusive or blocked outcome lowers the band; nothing raises it.
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
            OutcomeReason::AmbiguousCause,
        );
        assert_eq!(g.band, Confidence::Low);
        assert_eq!(g.reasons.last(), Some(&GradeReason::AmbiguousCause));
        apply_outcome(
            &mut g,
            RcaOutcome::Inconclusive,
            OutcomeReason::AmbiguousCause,
        );
        assert_eq!(
            g.reasons
                .iter()
                .filter(|r| **r == GradeReason::AmbiguousCause)
                .count(),
            1
        );

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

    /// SG36 / frame G: a cause with decisive change + metrics evidence and a steering lead
    /// grades medium, and the cap names the lead's author by the local part of the email.
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
        let (ledger, spots, _) = crate::meta::oncall::rca_run::build_ledger(&calls, true);
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
}
