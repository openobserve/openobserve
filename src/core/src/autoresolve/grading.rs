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

//! A plan's cause graded the way incidents grade a verdict: the agent cites its reads by ref,
//! code binds each citation to the call that ran, and the band is what that evidence allows.

use std::collections::BTreeMap;

use config::meta::{
    autoresolve::{AUTORESOLVE_TOOL_PREFIX, PlanEvidence},
    oncall::{
        agent::{Confidence, PageAction, PageRecommendation},
        confidence::{
            ConfidenceBreakdown, SignalClass, ToolCallRecord, UnverifiedCitation, grade_confidence,
            min_band,
        },
        rca_run::{
            EvidenceEntry, EvidenceItem, EvidenceLedger, Hypothesis, HypothesisStatus, Polarity,
            RcaOutcome, SubmittedVerdict, SummaryHypothesis, build_evidence, hypotheses_view,
        },
    },
};

const CAUSE_ID: &str = "h1";

/// The cause's grade and what the run page shows with it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct GradedCause {
    /// `min(claimed, graded)`.
    pub band: Confidence,
    /// What the evidence allows; each option's claim is lowered to it.
    pub graded: Confidence,
    pub breakdown: ConfidenceBreakdown,
    pub evidence: Vec<EvidenceEntry>,
    pub unverified: Vec<UnverifiedCitation>,
    pub hypotheses: Vec<SummaryHypothesis>,
}

/// `claim` is the agent's band for its best option. `None` for a plan made before causes were
/// asked for, and once the transcript is gone, so expired evidence never reads as weak evidence.
pub(crate) fn grade_cause(
    cause: Option<&str>,
    cited: &[PlanEvidence],
    claim: Option<Confidence>,
    tool_log: &[ToolCallRecord],
) -> Option<GradedCause> {
    let cause = cause?;
    if tool_log.is_empty() {
        return None;
    }
    let log = classified(tool_log);
    let ledger = ledger(cause, cited);
    let grade = grade_confidence(
        &verdict(cause, claim.unwrap_or(Confidence::High)),
        Some(&ledger),
        &[],
        &log,
        &BTreeMap::new(),
    );
    let mut breakdown = grade.breakdown();
    if claim.is_none() {
        breakdown.claimed = grade.graded;
    }
    let (evidence, unverified) = build_evidence(Some(&ledger), &log);
    let hypotheses = hypotheses_view(&ledger, &evidence, &unverified, &BTreeMap::new());
    Some(GradedCause {
        band: grade.band,
        graded: grade.graded,
        breakdown,
        evidence,
        unverified,
        hypotheses,
    })
}

/// The option's claim lowered to what the cause's evidence allows; a partial fix is never `high`.
pub(crate) fn option_band(
    claimed: Option<Confidence>,
    graded: Option<Confidence>,
    partial_fix: bool,
) -> Option<Confidence> {
    let graded = graded?;
    let band = min_band(claimed.unwrap_or(graded), graded);
    Some(if partial_fix {
        min_band(band, Confidence::Medium)
    } else {
        band
    })
}

/// The best band the agent claimed among the options, the recommended one first.
pub(crate) fn plan_claim(
    options: impl IntoIterator<Item = (bool, Option<Confidence>)>,
) -> Option<Confidence> {
    let mut best: Option<(bool, Confidence)> = None;
    for (recommended, claimed) in options {
        let Some(claimed) = claimed else { continue };
        let better = match best {
            None => true,
            Some((was_recommended, was)) => {
                (recommended && !was_recommended)
                    || (recommended == was_recommended && min_band(was, claimed) == was)
            }
        };
        if better {
            best = Some((recommended, claimed));
        }
    }
    best.map(|(_, band)| band)
}

/// h1 is the cause with every supporting and contradicting read; each `rules_out` read is its own
/// ruled-out hypothesis, which is what the grader counts as an alternative ruled out.
fn ledger(cause: &str, cited: &[PlanEvidence]) -> EvidenceLedger {
    let item = |e: &PlanEvidence, seq: i64| EvidenceItem {
        id: e.id.clone(),
        tool: e.tool.clone(),
        call_ref: Some(e.call_ref.clone()),
        query: String::new(),
        polarity: e.polarity,
        strength: e.strength,
        observation: e.observation.clone(),
        first_cited_seq: seq,
        claim_scope: None,
    };
    let hypothesis = |id: String, statement: String, status, seq| Hypothesis {
        id,
        statement,
        status,
        reason: String::new(),
        evidence: Vec::new(),
        lead_ids: Vec::new(),
        first_seen_seq: seq,
        onset_us: None,
        history: Vec::new(),
        prediction: None,
        refutation: None,
        checks: None,
    };
    let mut root = hypothesis(
        CAUSE_ID.to_string(),
        cause.to_string(),
        HypothesisStatus::RootCause,
        0,
    );
    let mut ruled_out = Vec::new();
    for (seq, e) in (1..).zip(cited) {
        if e.polarity == Polarity::RulesOut {
            let statement = e
                .alternative
                .clone()
                .unwrap_or_else(|| e.observation.clone());
            let id = format!("h{}", ruled_out.len() + 2);
            let mut alternative = hypothesis(id, statement, HypothesisStatus::RuledOut, seq);
            alternative.evidence.push(item(e, seq));
            ruled_out.push(alternative);
        } else {
            root.evidence.push(item(e, seq));
        }
    }
    EvidenceLedger {
        hypotheses: std::iter::once(root).chain(ruled_out).collect(),
        truncations: 0,
    }
}

fn verdict(cause: &str, claimed: Confidence) -> SubmittedVerdict {
    SubmittedVerdict {
        probable_cause: cause.to_string(),
        claimed_confidence: claimed,
        claimed_outcome: RcaOutcome::RootCauseIdentified,
        suspect_change: None,
        impacted_services: Vec::new(),
        impact: None,
        page_recommendation: PageRecommendation {
            action: PageAction::Page,
            severity_suggestion: None,
            reason: String::new(),
        },
        proposed_actions: Vec::new(),
        report_ref: String::new(),
        next_step: None,
    }
}

/// The tool log with each AutoResolve MCP read the RCA classifier leaves unclassified given a
/// class by its tool name, so a read of logs or releases through an MCP counts like one in O2.
fn classified(log: &[ToolCallRecord]) -> Vec<ToolCallRecord> {
    log.iter()
        .cloned()
        .map(|mut record| {
            if record.signal == SignalClass::Unclassified
                && let Some(signal) = mcp_signal(&record.tool)
            {
                record.signal = signal;
                record.target.signal = signal;
            }
            record
        })
        .collect()
}

// ponytail: keyword heuristic over the tool name; classify by the MCP tool's description or
// annotations if MCPs with vaguer names misfile.
const SIGNAL_WORDS: [(SignalClass, &[&str]); 5] = [
    (SignalClass::Logs, &["log"]),
    (SignalClass::Metrics, &["metric", "stats", "usage"]),
    (SignalClass::Traces, &["trace", "span"]),
    (
        SignalClass::Change,
        &[
            "release", "deploy", "rollout", "histor", "commit", "diff", "revision", "change",
            "version",
        ],
    ),
    (
        SignalClass::Infra,
        &[
            "status",
            "health",
            "pod",
            "node",
            "service",
            "describe",
            "event",
            "instance",
            "replica",
            "resource",
            "queue",
            "cluster",
            "container",
        ],
    ),
];

/// `ar_<connection key>_<tool>`: the key has no `_`, so the tool starts after the first one.
fn mcp_signal(tool: &str) -> Option<SignalClass> {
    let (_, bare) = tool
        .strip_prefix(AUTORESOLVE_TOOL_PREFIX)?
        .split_once('_')?;
    let words: Vec<String> = bare
        .split(|c: char| !c.is_ascii_alphanumeric())
        .map(str::to_ascii_lowercase)
        .collect();
    SIGNAL_WORDS
        .iter()
        .find(|(_, stems)| {
            words
                .iter()
                .any(|w| stems.iter().any(|stem| w.starts_with(stem)))
        })
        .map(|(signal, _)| *signal)
}

#[cfg(test)]
mod tests {
    use config::meta::oncall::{
        confidence::call_ref,
        rca_run::{EvidenceTarget, Strength},
    };

    use super::*;

    fn call(id: &str, tool: &str, signal: SignalClass) -> ToolCallRecord {
        ToolCallRecord {
            call_id: id.into(),
            tool: tool.into(),
            key_arg: String::new(),
            stream_type: None,
            success: true,
            result_count: None,
            started_at_us: 1,
            duration_ms: 1,
            error_type: None,
            change_rows: None,
            signal,
            target: EvidenceTarget {
                signal,
                streams: Vec::new(),
                sql: None,
                promql: None,
                filter: None,
                start_us: None,
                end_us: None,
                command: None,
            },
            observed: None,
            result_summary: "OK".into(),
            coverage: None,
        }
    }

    fn cite(
        id: &str,
        record: &ToolCallRecord,
        polarity: Polarity,
        strength: Strength,
    ) -> PlanEvidence {
        PlanEvidence {
            id: id.into(),
            tool: record.tool.clone(),
            call_ref: call_ref(&record.call_id),
            polarity,
            strength,
            observation: format!("{id} read"),
            alternative: (polarity == Polarity::RulesOut).then(|| "search is throttled".into()),
        }
    }

    const CRASH: &str = "checkout v42 crashes on a missing env var";

    #[test]
    fn mcp_reads_take_a_class_from_their_tool_name() {
        let cases = [
            (
                "ar_deploy-sandbox_get_service_logs",
                Some(SignalClass::Logs),
            ),
            ("ar_deploy-sandbox_list_releases", Some(SignalClass::Change)),
            (
                "ar_deploy-sandbox_get_service_status",
                Some(SignalClass::Infra),
            ),
            ("ar_k8s_cpu_metrics", Some(SignalClass::Metrics)),
            ("ar_github_search_code", None),
            ("SearchSQL", None),
        ];
        for (tool, want) in cases {
            assert_eq!(mcp_signal(tool), want, "{tool}");
        }
    }

    #[test]
    fn the_band_follows_the_verified_evidence_like_an_incident_verdict() {
        use Polarity::{RulesOut, Supports};
        use Strength::{Decisive, Supporting};
        let logs = call(
            "c1",
            "ar_sandbox_get_service_logs",
            SignalClass::Unclassified,
        );
        let releases = call("c2", "ar_sandbox_list_releases", SignalClass::Unclassified);
        let cpu = call("c3", "SearchSQL", SignalClass::Metrics);
        let log = vec![logs.clone(), releases.clone(), cpu.clone()];
        let graded = |cited: &[PlanEvidence], claim| {
            grade_cause(Some(CRASH), cited, claim, &log).map(|g| (g.band, g.graded))
        };
        let high = Confidence::High;
        // Two decisive classes and a ruled-out alternative: high.
        let strong = [
            cite("e1", &logs, Supports, Decisive),
            cite("e2", &releases, Supports, Decisive),
            cite("e3", &cpu, RulesOut, Supporting),
        ];
        assert_eq!(graded(&strong, Some(high)), Some((high, high)));
        // The agent's own claim only lowers the band.
        let medium = Confidence::Medium;
        assert_eq!(graded(&strong, Some(medium)), Some((medium, high)));
        // One decisive class: medium.
        let one = [cite("e1", &logs, Supports, Decisive)];
        assert_eq!(graded(&one, Some(high)), Some((medium, medium)));
        // A ref no call has: nothing verified, low.
        let mut missing = cite("e1", &logs, Supports, Decisive);
        missing.call_ref = "aaaaaa".into();
        let low = Confidence::Low;
        assert_eq!(graded(&[missing], Some(high)), Some((low, low)));
        // No cause, or no transcript: no band at all.
        assert_eq!(grade_cause(None, &one, Some(high), &log), None);
        assert_eq!(grade_cause(Some(CRASH), &one, Some(high), &[]), None);
    }

    #[test]
    fn evidence_and_hypotheses_come_back_for_the_page() {
        use Polarity::{RulesOut, Supports};
        use Strength::{Decisive, Supporting};
        let logs = call(
            "c1",
            "ar_sandbox_get_service_logs",
            SignalClass::Unclassified,
        );
        let cpu = call("c3", "SearchSQL", SignalClass::Metrics);
        let cited = [
            cite("e1", &logs, Supports, Decisive),
            cite("e2", &cpu, RulesOut, Supporting),
        ];
        let graded = grade_cause(Some(CRASH), &cited, None, &[logs, cpu]).unwrap();
        assert_eq!(graded.evidence.len(), 2);
        assert_eq!(graded.evidence[0].target, SignalClass::Logs);
        let statements: Vec<(&str, HypothesisStatus)> = graded
            .hypotheses
            .iter()
            .map(|h| (h.statement.as_str(), h.status))
            .collect();
        assert_eq!(
            statements,
            [
                (CRASH, HypothesisStatus::RootCause),
                ("search is throttled", HypothesisStatus::RuledOut)
            ]
        );
        // With no claim the breakdown reports what the evidence allows as the claim.
        assert_eq!(graded.breakdown.claimed, graded.graded);
    }

    #[test]
    fn an_option_band_never_passes_the_evidence_and_a_partial_fix_never_reads_high() {
        use Confidence::{High, Low, Medium};
        assert_eq!(option_band(Some(High), Some(Medium), false), Some(Medium));
        assert_eq!(option_band(Some(Low), Some(High), false), Some(Low));
        assert_eq!(option_band(None, Some(High), false), Some(High));
        assert_eq!(option_band(Some(High), Some(High), true), Some(Medium));
        assert_eq!(option_band(Some(High), None, false), None);
    }

    #[test]
    fn the_plan_claim_is_the_recommended_options_then_the_best() {
        use Confidence::{High, Low, Medium};
        assert_eq!(
            plan_claim([(false, Some(High)), (true, Some(Low))]),
            Some(Low)
        );
        assert_eq!(
            plan_claim([(false, Some(Low)), (false, Some(Medium))]),
            Some(Medium)
        );
        assert_eq!(plan_claim([(true, None), (false, None)]), None);
    }
}
