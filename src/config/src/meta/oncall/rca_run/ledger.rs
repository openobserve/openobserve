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

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::meta::oncall::confidence::MatchKey;

/// Most hypotheses kept for one run.
pub const MAX_HYPOTHESES: usize = 10;
/// Most evidence items kept for one hypothesis.
pub const MAX_EVIDENCE_ITEMS: usize = 10;
/// Most blind spots kept for one run.
pub const MAX_BLIND_SPOTS: usize = 10;
/// Most characters kept for a statement, reason, observation or `why`.
pub const MAX_TEXT_CHARS: usize = 500;
/// Most characters kept for a blind spot title.
pub const MAX_TITLE_CHARS: usize = 100;
pub const MAX_QUERY_BYTES: usize = crate::meta::oncall::confidence::KEY_ARG_MAX_BYTES;

/// The `tool` label of `rca_ledger_invalid_call_total` for each ledger tool.
const RECORD_HYPOTHESIS: &str = "record_hypothesis";
const RECORD_BLIND_SPOT: &str = "record_blind_spot";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HypothesisStatus {
    Testing,
    Untested,
    Likely,
    RootCause,
    Contributing,
    Symptom,
    RuledOut,
    Inconclusive,
    Blocked,
}

impl HypothesisStatus {
    /// Stable wire value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Testing => "testing",
            Self::Untested => "untested",
            Self::Likely => "likely",
            Self::RootCause => "root_cause",
            Self::Contributing => "contributing",
            Self::Symptom => "symptom",
            Self::RuledOut => "ruled_out",
            Self::Inconclusive => "inconclusive",
            Self::Blocked => "blocked",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Polarity {
    Supports,
    Contradicts,
    RulesOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Strength {
    Decisive,
    Supporting,
}

/// One evidence item of one hypothesis, as the agent cited it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EvidenceItem {
    pub id: String,
    pub tool: String,
    pub query: String,
    pub polarity: Polarity,
    pub strength: Strength,
    pub observation: String,
    pub first_cited_seq: i64,
}

/// One entry of a hypothesis' status history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct StatusChange {
    /// Microseconds.
    pub at_us: i64,
    pub status: HypothesisStatus,
    #[serde(default)]
    pub run_ended: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_steer_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Hypothesis {
    pub id: String,
    pub statement: String,
    pub status: HypothesisStatus,
    pub reason: String,
    #[serde(default)]
    pub evidence: Vec<EvidenceItem>,
    /// Steering (`stg_…`) or past-cause (`past:…`) ids; never evidence.
    #[serde(default)]
    pub lead_ids: Vec<String>,
    pub first_seen_seq: i64,
    /// When this cause's fault began, microseconds; the agent's claim, not checked against
    /// evidence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub onset_us: Option<i64>,
    #[serde(default)]
    pub history: Vec<StatusChange>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EvidenceLedger {
    /// In first-seen order.
    #[serde(default)]
    pub hypotheses: Vec<Hypothesis>,
    /// Values the hypothesis limits cut or dropped.
    #[serde(default)]
    pub truncations: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BlindSpotAxis {
    Change,
    Logs,
    Metrics,
    Traces,
    Infra,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BlindSpotFix {
    ConnectToolset,
    IngestData,
    OpenPipeline,
    SamplingRules,
    ResumeRun,
    None,
}

/// Something the run could not check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct BlindSpot {
    pub id: String,
    pub axis: BlindSpotAxis,
    pub title: String,
    pub why: String,
    pub fix: BlindSpotFix,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerTool {
    Hypothesis,
    BlindSpot,
}

/// One committed, completed `record_hypothesis` or `record_blind_spot` call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LedgerCall {
    /// `seq` of the persisted event.
    pub seq: i64,
    /// `state.time.start` of the tool part, microseconds.
    pub at_us: i64,
    pub tool: LedgerTool,
    pub input: serde_json::Value,
}

/// What `build_ledger` cut, dropped and rewrote, for the ledger metrics.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LedgerCounts {
    pub truncated: Vec<(&'static str, u32)>,
    /// `(tool, count)` of dropped calls; tool is `record_hypothesis` or `record_blind_spot`.
    pub invalid_calls: Vec<(String, u32)>,
    /// `testing` hypotheses rewritten to `untested` at the end of the run.
    pub left_testing: u32,
}

/// The truncation fields of [LedgerCounts::truncated], in label order.
const FIELDS: [&str; 9] = [
    "hypotheses",
    "evidence",
    "statement",
    "reason",
    "observation",
    "query",
    "title",
    "why",
    "blind_spots",
];
const F_HYPOTHESES: usize = 0;
const F_EVIDENCE: usize = 1;
const F_STATEMENT: usize = 2;
const F_REASON: usize = 3;
const F_OBSERVATION: usize = 4;
const F_QUERY: usize = 5;
const F_TITLE: usize = 6;
const F_WHY: usize = 7;
const F_BLIND_SPOTS: usize = 8;

/// Truncation counts by field index of [FIELDS].
#[derive(Debug, Clone, Copy, Default)]
struct Cuts([u32; FIELDS.len()]);

impl Cuts {
    fn add(&mut self, other: &Cuts) {
        for (a, b) in self.0.iter_mut().zip(other.0) {
            *a += b;
        }
    }

    fn total(&self) -> u32 {
        self.0.iter().sum()
    }
}

/// Keeps at most `max` characters; counts a cut under `field`.
fn cut_chars(s: String, max: usize, field: usize, cuts: &mut Cuts) -> String {
    match s.char_indices().nth(max) {
        Some((end, _)) => {
            cuts.0[field] += 1;
            s[..end].to_string()
        }
        None => s,
    }
}

/// Keeps at most `max` bytes with the tool log's cut; counts a cut under `field`.
fn cut_bytes(s: String, max: usize, field: usize, cuts: &mut Cuts) -> String {
    if s.len() <= max {
        return s;
    }
    cuts.0[field] += 1;
    crate::meta::oncall::confidence::cut_bytes(&s, max).to_string()
}

/// `<prefix><n>` with `n` in `1..=max` and no leading zero.
fn numbered_id(id: &str, prefix: char, max: u32) -> bool {
    let Some(digits) = id.strip_prefix(prefix) else {
        return false;
    };
    !digits.is_empty()
        && !digits.starts_with('0')
        && digits.len() <= 3
        && digits.bytes().all(|b| b.is_ascii_digit())
        && digits.parse::<u32>().is_ok_and(|n| n <= max)
}

#[derive(Deserialize)]
struct HypothesisInput {
    id: String,
    statement: String,
    status: HypothesisStatus,
    reason: String,
    #[serde(default)]
    evidence: Vec<EvidenceInput>,
    #[serde(default)]
    lead_ids: Vec<String>,
    #[serde(default)]
    trigger_steer_id: Option<String>,
    /// Microseconds; a value that is not an integer is dropped, not the call.
    #[serde(default, deserialize_with = "lenient_micros")]
    onset: Option<i64>,
}

fn lenient_micros<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    Ok(serde_json::Value::deserialize(d)?.as_i64())
}

#[derive(Deserialize)]
struct EvidenceInput {
    id: String,
    tool: String,
    query: String,
    polarity: Polarity,
    strength: Strength,
    observation: String,
}

#[derive(Deserialize)]
struct BlindSpotInput {
    id: String,
    axis: BlindSpotAxis,
    title: String,
    why: String,
    fix: BlindSpotFix,
}

/// A valid `record_hypothesis` input, else `None`.
fn parse_hypothesis(input: &serde_json::Value) -> Option<HypothesisInput> {
    let h = HypothesisInput::deserialize(input).ok()?;
    let valid =
        numbered_id(&h.id, 'h', 99) && h.evidence.iter().all(|e| numbered_id(&e.id, 'e', 999));
    valid.then_some(h)
}

/// A `record_blind_spot` input with a valid id (`b1`…`b10`) and enums, else `None`.
fn parse_blind_spot(input: &serde_json::Value) -> Option<BlindSpotInput> {
    let b = BlindSpotInput::deserialize(input).ok()?;
    numbered_id(&b.id, 'b', MAX_BLIND_SPOTS as u32).then_some(b)
}

#[derive(Debug, Clone, PartialEq)]
struct CitedItem {
    id: String,
    tool: String,
    query: MatchKey,
}

impl CitedItem {
    fn of(id: &str, tool: &str, query: &str) -> Self {
        Self {
            id: id.to_string(),
            tool: tool.strip_prefix("o2_").unwrap_or(tool).to_string(),
            query: MatchKey::of(query),
        }
    }
}

/// The fold of ledger calls in sequence order, shared by [build_ledger] and [leading_history].
#[derive(Default)]
struct Builder {
    hypotheses: Vec<Hypothesis>,
    /// Truncations of the call that set each hypothesis (last call wins).
    hypothesis_cuts: Vec<Cuts>,
    hypothesis_index: HashMap<String, usize>,
    blind_spots: Vec<BlindSpot>,
    blind_spot_cuts: Vec<Cuts>,
    blind_spot_index: HashMap<String, usize>,
    /// Distinct ids dropped past the run limits.
    dropped: Cuts,
    dropped_ids: std::collections::HashSet<(LedgerTool, String)>,
    /// First seq and first observation of each cited item, by [CitedItem] identity.
    first_cited: Vec<(CitedItem, i64, String)>,
    invalid_hypothesis_calls: u32,
    invalid_blind_spot_calls: u32,
    saw_hypothesis_call: bool,
}

impl Builder {
    /// Applies one call; `true` when it changed a hypothesis.
    fn apply(&mut self, call: &LedgerCall) -> bool {
        match call.tool {
            LedgerTool::Hypothesis => self.apply_hypothesis(call),
            LedgerTool::BlindSpot => {
                self.apply_blind_spot(call);
                false
            }
        }
    }

    /// Records a citation of `item` at `seq`; returns the item's first seq and observation.
    fn cite(&mut self, item: CitedItem, seq: i64, observation: String) -> (i64, String) {
        match self.first_cited.iter_mut().find(|(k, ..)| *k == item) {
            Some((_, first, first_observation)) => {
                *first = (*first).min(seq);
                (*first, first_observation.clone())
            }
            None => {
                self.first_cited.push((item, seq, observation.clone()));
                (seq, observation)
            }
        }
    }

    fn apply_hypothesis(&mut self, call: &LedgerCall) -> bool {
        self.saw_hypothesis_call = true;
        let Some(input) = parse_hypothesis(&call.input) else {
            self.invalid_hypothesis_calls += 1;
            return false;
        };
        let slot = match self.hypothesis_index.get(&input.id) {
            Some(&i) => Some(i),
            None if self.hypotheses.len() < MAX_HYPOTHESES => None,
            None => {
                if self
                    .dropped_ids
                    .insert((LedgerTool::Hypothesis, input.id.clone()))
                {
                    self.dropped.0[F_HYPOTHESES] += 1;
                }
                return false;
            }
        };

        let mut cuts = Cuts::default();
        if input.evidence.len() > MAX_EVIDENCE_ITEMS {
            cuts.0[F_EVIDENCE] += (input.evidence.len() - MAX_EVIDENCE_ITEMS) as u32;
        }
        let evidence: Vec<EvidenceItem> = input
            .evidence
            .into_iter()
            .take(MAX_EVIDENCE_ITEMS)
            .map(|e| {
                let query = cut_bytes(e.query, MAX_QUERY_BYTES, F_QUERY, &mut cuts);
                let observation =
                    cut_chars(e.observation, MAX_TEXT_CHARS, F_OBSERVATION, &mut cuts);
                // The first definition of an id with this tool and query sets its observation.
                let (first_cited_seq, observation) =
                    self.cite(CitedItem::of(&e.id, &e.tool, &query), call.seq, observation);
                EvidenceItem {
                    first_cited_seq,
                    id: e.id,
                    tool: e.tool,
                    query,
                    polarity: e.polarity,
                    strength: e.strength,
                    observation,
                }
            })
            .collect();
        let statement = cut_chars(input.statement, MAX_TEXT_CHARS, F_STATEMENT, &mut cuts);
        let reason = cut_chars(input.reason, MAX_TEXT_CHARS, F_REASON, &mut cuts);
        let trigger_steer_id = input.trigger_steer_id.filter(|s| !s.trim().is_empty());
        let change = StatusChange {
            at_us: call.at_us,
            status: input.status,
            run_ended: false,
            trigger_steer_id,
        };

        match slot {
            Some(i) => {
                let h = &mut self.hypotheses[i];
                if h.status != input.status {
                    h.history.push(change);
                }
                h.statement = statement;
                h.status = input.status;
                h.reason = reason;
                h.evidence = evidence;
                h.lead_ids = input.lead_ids;
                h.onset_us = input.onset;
                self.hypothesis_cuts[i] = cuts;
            }
            None => {
                self.hypothesis_index
                    .insert(input.id.clone(), self.hypotheses.len());
                self.hypotheses.push(Hypothesis {
                    id: input.id,
                    statement,
                    status: input.status,
                    reason,
                    evidence,
                    lead_ids: input.lead_ids,
                    first_seen_seq: call.seq,
                    onset_us: input.onset,
                    history: vec![change],
                });
                self.hypothesis_cuts.push(cuts);
            }
        }
        true
    }

    fn apply_blind_spot(&mut self, call: &LedgerCall) {
        let Some(input) = parse_blind_spot(&call.input) else {
            self.invalid_blind_spot_calls += 1;
            return;
        };
        let slot = match self.blind_spot_index.get(&input.id) {
            Some(&i) => Some(i),
            None if self.blind_spots.len() < MAX_BLIND_SPOTS => None,
            None => {
                if self
                    .dropped_ids
                    .insert((LedgerTool::BlindSpot, input.id.clone()))
                {
                    self.dropped.0[F_BLIND_SPOTS] += 1;
                }
                return;
            }
        };
        let mut cuts = Cuts::default();
        let spot = BlindSpot {
            title: cut_chars(input.title, MAX_TITLE_CHARS, F_TITLE, &mut cuts),
            why: cut_chars(input.why, MAX_TEXT_CHARS, F_WHY, &mut cuts),
            id: input.id,
            axis: input.axis,
            fix: input.fix,
        };
        match slot {
            Some(i) => {
                self.blind_spots[i] = spot;
                self.blind_spot_cuts[i] = cuts;
            }
            None => {
                self.blind_spot_index
                    .insert(spot.id.clone(), self.blind_spots.len());
                self.blind_spots.push(spot);
                self.blind_spot_cuts.push(cuts);
            }
        }
    }
}

/// Fold ledger calls; with `ended_at_us`, each `testing` becomes `untested` at the run's end.
pub fn build_ledger(
    calls: &[LedgerCall],
    ended_at_us: Option<i64>,
) -> (Option<EvidenceLedger>, Vec<BlindSpot>, LedgerCounts) {
    let mut b = Builder::default();
    for call in calls {
        b.apply(call);
    }

    let mut left_testing = 0;
    if let Some(at_us) = ended_at_us {
        for h in b
            .hypotheses
            .iter_mut()
            .filter(|h| h.status == HypothesisStatus::Testing)
        {
            h.status = HypothesisStatus::Untested;
            h.history.push(StatusChange {
                at_us,
                status: HypothesisStatus::Untested,
                run_ended: true,
                trigger_steer_id: None,
            });
            left_testing += 1;
        }
    }

    for item in b.hypotheses.iter_mut().flat_map(|h| h.evidence.iter_mut()) {
        let key = CitedItem::of(&item.id, &item.tool, &item.query);
        if let Some((_, seq, _)) = b.first_cited.iter().find(|(k, ..)| *k == key) {
            item.first_cited_seq = *seq;
        }
    }

    let mut hypothesis_cuts = Cuts::default();
    hypothesis_cuts.0[F_HYPOTHESES] = b.dropped.0[F_HYPOTHESES];
    b.hypothesis_cuts
        .iter()
        .for_each(|c| hypothesis_cuts.add(c));
    let mut all_cuts = hypothesis_cuts;
    all_cuts.0[F_BLIND_SPOTS] += b.dropped.0[F_BLIND_SPOTS];
    b.blind_spot_cuts.iter().for_each(|c| all_cuts.add(c));

    let mut invalid_calls = Vec::new();
    if b.invalid_hypothesis_calls > 0 {
        invalid_calls.push((RECORD_HYPOTHESIS.to_string(), b.invalid_hypothesis_calls));
    }
    if b.invalid_blind_spot_calls > 0 {
        invalid_calls.push((RECORD_BLIND_SPOT.to_string(), b.invalid_blind_spot_calls));
    }
    let counts = LedgerCounts {
        truncated: FIELDS
            .iter()
            .zip(all_cuts.0)
            .filter(|(_, n)| *n > 0)
            .map(|(f, n)| (*f, n))
            .collect(),
        invalid_calls,
        left_testing,
    };

    let ledger = b.saw_hypothesis_call.then(|| EvidenceLedger {
        hypotheses: b.hypotheses,
        truncations: hypothesis_cuts.total(),
    });
    (ledger, b.blind_spots, counts)
}

/// Rank: 1 `root_cause` … 7 `untested`; `symptom` and `ruled_out` never rank.
pub fn status_rank(s: HypothesisStatus) -> Option<u8> {
    match s {
        HypothesisStatus::RootCause => Some(1),
        HypothesisStatus::Likely => Some(2),
        HypothesisStatus::Testing => Some(3),
        HypothesisStatus::Blocked => Some(4),
        HypothesisStatus::Contributing => Some(5),
        HypothesisStatus::Inconclusive => Some(6),
        HypothesisStatus::Untested => Some(7),
        HypothesisStatus::Symptom | HypothesisStatus::RuledOut => None,
    }
}

fn leading_in(hypotheses: &[Hypothesis]) -> Option<&Hypothesis> {
    hypotheses
        .iter()
        .filter_map(|h| status_rank(h.status).map(|r| ((r, h.first_seen_seq), h)))
        .min_by_key(|(key, _)| *key)
        .map(|(_, h)| h)
}

/// The leading hypothesis: best rank, then earliest `first_seen_seq`.
pub fn leading(ledger: &EvidenceLedger) -> Option<&Hypothesis> {
    leading_in(&ledger.hypotheses)
}

pub fn subject(ledger: &EvidenceLedger) -> Option<&Hypothesis> {
    let earliest = |status: HypothesisStatus| {
        ledger
            .hypotheses
            .iter()
            .filter(|h| h.status == status)
            .min_by_key(|h| h.first_seen_seq)
    };
    earliest(HypothesisStatus::RootCause)
        .or_else(|| earliest(HypothesisStatus::Contributing))
        .or_else(|| leading(ledger))
}

/// One leading hypothesis of the run, as it was led.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LeadingEntry {
    pub id: String,
    pub statement: String,
}

pub fn leading_history(calls: &[LedgerCall]) -> Vec<LeadingEntry> {
    let mut b = Builder::default();
    let mut history: Vec<LeadingEntry> = Vec::new();
    for call in calls {
        if !b.apply(call) {
            continue;
        }
        let Some(lead) = leading_in(&b.hypotheses) else {
            continue;
        };
        let repeat = history
            .last()
            .is_some_and(|last| last.id == lead.id && last.statement == lead.statement);
        if !repeat {
            history.push(LeadingEntry {
                id: lead.id.clone(),
                statement: lead.statement.clone(),
            });
        }
    }
    history
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::meta::oncall::rca_run::fixtures::{
        PROM, hyp, hyp_input, hypothesis, item, ledger_of, spot,
    };

    fn ledger(calls: &[LedgerCall]) -> EvidenceLedger {
        ledger_of(calls).expect("a hypothesis call exists")
    }

    fn ids(ledger: &EvidenceLedger) -> Vec<&str> {
        ledger.hypotheses.iter().map(|h| h.id.as_str()).collect()
    }

    /// The last call for an id sets its fields; `first_seen_seq` stays at the first.
    #[test]
    fn the_last_call_wins_and_first_seen_seq_is_kept() {
        let calls = [
            hyp(
                5,
                "h2",
                "testing",
                vec![item("e1", PROM, "q1", "supports", "supporting")],
            ),
            hyp(9, "h1", "testing", vec![]),
            hyp_input(
                12,
                json!({
                    "id": "h2", "statement": "pool exhausted", "status": "root_cause",
                    "reason": "seq 12 reason", "lead_ids": ["stg_1"],
                    "evidence": [item("e2", PROM, "q2", "supports", "decisive")],
                }),
            ),
        ];
        let l = ledger(&calls);
        assert_eq!(ids(&l), ["h2", "h1"]);
        let h2 = hypothesis(&l, "h2");
        assert_eq!(h2.first_seen_seq, 5);
        assert_eq!(h2.statement, "pool exhausted");
        assert_eq!(h2.status, HypothesisStatus::RootCause);
        assert_eq!(h2.reason, "seq 12 reason");
        assert_eq!(h2.lead_ids, ["stg_1"]);
        assert_eq!(h2.evidence.len(), 1, "an upsert, not a patch: e1 is gone");
        assert_eq!(h2.evidence[0].id, "e2");
        assert_eq!(h2.evidence[0].first_cited_seq, 12);
        assert_eq!(hypothesis(&l, "h1").first_seen_seq, 9);
    }

    /// A cause's onset is kept as given; one that is not an integer is dropped, not the call.
    #[test]
    fn a_hypothesis_keeps_its_onset() {
        let with_onset = |seq, id: &str, onset: serde_json::Value| {
            hyp_input(
                seq,
                json!({"id": id, "statement": "s", "status": "root_cause", "reason": "r", "onset": onset}),
            )
        };
        let l = ledger(&[
            with_onset(1, "h1", json!(1_700_000_000_000_000_i64)),
            with_onset(2, "h2", json!("10:42")),
            hyp(3, "h3", "root_cause", vec![]),
        ]);
        assert_eq!(ids(&l), ["h1", "h2", "h3"]);
        assert_eq!(hypothesis(&l, "h1").onset_us, Some(1_700_000_000_000_000));
        assert_eq!(hypothesis(&l, "h2").onset_us, None);
        assert_eq!(hypothesis(&l, "h3").onset_us, None);
        // The last call sets it, like every other field.
        let l = ledger(&[
            with_onset(1, "h1", json!(5)),
            hyp(2, "h1", "root_cause", vec![]),
        ]);
        assert_eq!(hypothesis(&l, "h1").onset_us, None);
    }

    /// One evidence id on two hypotheses keeps both items with one first seq.
    #[test]
    fn a_shared_evidence_id_sits_on_both_hypotheses() {
        let shared = item("e1", PROM, "q", "supports", "decisive");
        let mut rules_out = shared.clone();
        rules_out["polarity"] = json!("rules_out");
        let calls = [
            hyp(3, "h1", "root_cause", vec![shared]),
            hyp(7, "h2", "ruled_out", vec![rules_out]),
        ];
        let l = ledger(&calls);
        let a = &hypothesis(&l, "h1").evidence[0];
        let b = &hypothesis(&l, "h2").evidence[0];
        assert_eq!((a.id.as_str(), a.polarity), ("e1", Polarity::Supports));
        assert_eq!((b.id.as_str(), b.polarity), ("e1", Polarity::RulesOut));
        assert_eq!(a.first_cited_seq, 3);
        assert_eq!(b.first_cited_seq, 3, "the run-wide first seq of e1");
        // A reuse of e1 with the same tool and query keeps the first definition's observation.
        let mut reused = item("e1", PROM, "q", "contradicts", "supporting");
        reused["observation"] = json!("a later note");
        let mut calls = calls.to_vec();
        calls.push(hyp(9, "h3", "testing", vec![reused]));
        let l = ledger(&calls);
        assert_eq!(
            hypothesis(&l, "h3").evidence[0].observation,
            hypothesis(&l, "h1").evidence[0].observation
        );
        // A reuse with another query is a citation of its own.
        let mut other = item("e1", PROM, "q2", "supports", "supporting");
        other["observation"] = json!("its own note");
        calls.push(hyp(11, "h4", "testing", vec![other]));
        assert_eq!(
            hypothesis(&ledger(&calls), "h4").evidence[0].observation,
            "its own note"
        );
    }

    /// 12 hypothesis ids keep the first 10; 12 items keep the first 10; both are counted.
    #[test]
    fn limits_keep_the_first_ten_and_count_the_cuts() {
        let mut calls: Vec<LedgerCall> = (1..=12)
            .map(|n| hyp(n, &format!("h{n}"), "testing", vec![]))
            .collect();
        // A repeat of a dropped id is one drop, not two.
        calls.push(hyp(13, "h12", "likely", vec![]));
        let items = (1..=12)
            .map(|n| {
                item(
                    &format!("e{n}"),
                    PROM,
                    &format!("q{n}"),
                    "supports",
                    "supporting",
                )
            })
            .collect();
        calls.push(hyp(14, "h1", "likely", items));
        let (l, _, counts) = build_ledger(&calls, None);
        let l = l.unwrap();
        assert_eq!(
            ids(&l),
            (1..=10).map(|n| format!("h{n}")).collect::<Vec<_>>()
        );
        let kept: Vec<&str> = hypothesis(&l, "h1")
            .evidence
            .iter()
            .map(|e| e.id.as_str())
            .collect();
        assert_eq!(kept, (1..=10).map(|n| format!("e{n}")).collect::<Vec<_>>());
        assert_eq!(counts.truncated, vec![("hypotheses", 2), ("evidence", 2)]);
        assert_eq!(l.truncations, 4);
    }

    /// Long text is cut and counted under its field.
    #[test]
    fn long_text_is_cut_and_counted() {
        let long = "x".repeat(MAX_TEXT_CHARS + 5);
        let calls = [
            hyp_input(
                1,
                json!({"id": "h1", "statement": long, "status": "testing", "reason": "r",
                       "evidence": [{"id": "e1", "tool": PROM, "query": "q".repeat(MAX_QUERY_BYTES + 1),
                                     "polarity": "supports", "strength": "supporting", "observation": long}]}),
            ),
            spot(2, "b1", "logs", "none", &"t".repeat(MAX_TITLE_CHARS + 1)),
        ];
        let (l, spots, counts) = build_ledger(&calls, None);
        let h1 = &l.unwrap().hypotheses[0];
        assert_eq!(h1.statement.chars().count(), MAX_TEXT_CHARS);
        assert_eq!(h1.evidence[0].query.len(), MAX_QUERY_BYTES);
        assert_eq!(spots[0].title.chars().count(), MAX_TITLE_CHARS);
        assert_eq!(
            counts.truncated,
            vec![
                ("statement", 1),
                ("observation", 1),
                ("query", 1),
                ("title", 1)
            ]
        );
    }

    /// At run end a `testing` hypothesis becomes `untested`, marked and dated at the run's end.
    #[test]
    fn testing_becomes_untested_at_run_end() {
        let calls = [
            hyp(1, "h1", "testing", vec![]),
            hyp(2, "h2", "likely", vec![]),
            spot(5, "b1", "logs", "none", "no logs"),
        ];
        let (live, _, live_counts) = build_ledger(&calls, None);
        assert_eq!(
            live.unwrap().hypotheses[0].status,
            HypothesisStatus::Testing
        );
        assert_eq!(live_counts.left_testing, 0);

        let (ended, _, counts) = build_ledger(&calls, Some(9_000_000));
        let ended = ended.unwrap();
        let h1 = hypothesis(&ended, "h1");
        assert_eq!(h1.status, HypothesisStatus::Untested);
        assert_eq!(
            h1.history,
            vec![
                StatusChange {
                    at_us: 1_000_000,
                    status: HypothesisStatus::Testing,
                    run_ended: false,
                    trigger_steer_id: None
                },
                StatusChange {
                    at_us: 9_000_000,
                    status: HypothesisStatus::Untested,
                    run_ended: true,
                    trigger_steer_id: None
                },
            ]
        );
        assert_eq!(hypothesis(&ended, "h2").status, HypothesisStatus::Likely);
        assert_eq!(counts.left_testing, 1);
    }

    /// Invalid ids and unknown enum values are dropped and counted per tool.
    #[test]
    fn invalid_calls_are_dropped_and_counted() {
        let calls = [
            hyp(1, "H1", "testing", vec![]),
            hyp(2, "h0", "testing", vec![]),
            hyp(3, "h100", "testing", vec![]),
            hyp(4, "h01", "testing", vec![]),
            hyp(5, "h1", "maybe", vec![]),
            hyp(
                6,
                "h1",
                "testing",
                vec![item("x1", PROM, "q", "supports", "decisive")],
            ),
            hyp(
                7,
                "h1",
                "testing",
                vec![item("e1", PROM, "q", "proves", "decisive")],
            ),
            hyp_input(8, json!({"id": "h1", "status": "testing"})),
            hyp(9, "h2", "testing", vec![]),
            spot(10, "b11", "logs", "none", "t"),
            spot(11, "b1", "dns", "none", "t"),
            spot(12, "b1", "logs", "call_someone", "t"),
            spot(13, "b2", "change", "connect_toolset", "no git"),
        ];
        let (l, spots, counts) = build_ledger(&calls, None);
        assert_eq!(ids(&l.unwrap()), ["h2"]);
        assert_eq!(hypothesis(&ledger(&calls), "h2").first_seen_seq, 9);
        assert_eq!(
            spots.iter().map(|b| b.id.as_str()).collect::<Vec<_>>(),
            ["b2"]
        );
        assert_eq!(
            counts.invalid_calls,
            vec![
                ("record_hypothesis".to_string(), 8),
                ("record_blind_spot".to_string(), 3)
            ]
        );

        // Only invalid hypothesis calls: a ledger exists (the agent called the tool), and is empty.
        let (only_invalid, ..) = build_ledger(&[hyp(1, "H1", "testing", vec![])], Some(2));
        assert_eq!(only_invalid.unwrap().hypotheses, vec![]);
        // No hypothesis call at all: no ledger.
        let (none, ..) = build_ledger(&[spot(1, "b1", "logs", "none", "t")], Some(2));
        assert_eq!(none, None);
    }

    /// A history entry only when the status changes; the steering id rides along.
    #[test]
    fn history_records_only_status_changes() {
        let at = |h: i64, m: i64| (h * 3600 + m * 60) * 1_000_000;
        let mut calls = vec![
            hyp(1, "h1", "testing", vec![]),
            hyp(2, "h1", "testing", vec![]),
            hyp_input(
                3,
                json!({"id": "h1", "statement": "s", "status": "root_cause", "reason": "r",
                       "trigger_steer_id": "stg_arao"}),
            ),
        ];
        for (call, t) in calls.iter_mut().zip([at(14, 7), at(14, 8), at(14, 14)]) {
            call.at_us = t;
        }
        let l = ledger(&calls);
        assert_eq!(
            hypothesis(&l, "h1").history,
            vec![
                StatusChange {
                    at_us: at(14, 7),
                    status: HypothesisStatus::Testing,
                    run_ended: false,
                    trigger_steer_id: None
                },
                StatusChange {
                    at_us: at(14, 14),
                    status: HypothesisStatus::RootCause,
                    run_ended: false,
                    trigger_steer_id: Some("stg_arao".into()),
                },
            ]
        );
    }

    /// Rank table, and the leading hypothesis of the rule's sample.
    #[test]
    fn the_leading_hypothesis_follows_the_rank_rule() {
        use HypothesisStatus::*;
        for (status, rank) in [
            (RootCause, Some(1)),
            (Likely, Some(2)),
            (Testing, Some(3)),
            (Blocked, Some(4)),
            (Contributing, Some(5)),
            (Inconclusive, Some(6)),
            (Untested, Some(7)),
            (Symptom, None),
            (RuledOut, None),
        ] {
            assert_eq!(status_rank(status), rank, "{status:?}");
        }
        let l = ledger(&[
            hyp(1, "h3", "contributing", vec![]),
            hyp(3, "h1", "testing", vec![]),
            hyp(8, "h2", "likely", vec![]),
        ]);
        assert_eq!(leading(&l).unwrap().id, "h2");
        // Same rank: the earlier first_seen_seq leads.
        let l = ledger(&[
            hyp(2, "h5", "likely", vec![]),
            hyp(4, "h1", "likely", vec![]),
        ]);
        assert_eq!(leading(&l).unwrap().id, "h5");
        // Only symptom and ruled_out: no leading hypothesis.
        let l = ledger(&[
            hyp(1, "h1", "symptom", vec![]),
            hyp(2, "h2", "ruled_out", vec![]),
        ]);
        assert_eq!(leading(&l), None);
        assert_eq!(subject(&l), None);
    }

    /// The subject rule.
    #[test]
    fn the_subject_follows_the_subject_rule() {
        let l = ledger(&[
            hyp(1, "h1", "likely", vec![]),
            hyp(2, "h2", "contributing", vec![]),
            hyp(6, "h4", "contributing", vec![]),
        ]);
        assert_eq!(subject(&l).unwrap().id, "h2");
        // Two root causes: the earliest.
        let l = ledger(&[
            hyp(1, "h1", "likely", vec![]),
            hyp(4, "h3", "root_cause", vec![]),
            hyp(9, "h2", "root_cause", vec![]),
        ]);
        assert_eq!(subject(&l).unwrap().id, "h3");
        // A root cause beats an earlier contributing.
        let l = ledger(&[
            hyp(1, "h1", "contributing", vec![]),
            hyp(4, "h2", "root_cause", vec![]),
        ]);
        assert_eq!(subject(&l).unwrap().id, "h2");
        // Neither: the leading one.
        let l = ledger(&[
            hyp(1, "h1", "untested", vec![]),
            hyp(4, "h2", "blocked", vec![]),
        ]);
        assert_eq!(subject(&l).unwrap().id, "h2");
    }

    /// `h2` leads, then `h1`, then `h1` with a new statement: three entries.
    #[test]
    fn leading_history_keeps_changes_of_id_or_statement() {
        let calls = [
            hyp(1, "h2", "testing", vec![]),
            hyp(2, "h2", "testing", vec![]),
            spot(3, "b1", "logs", "none", "t"),
            hyp(4, "h1", "likely", vec![]),
            hyp_input(
                5,
                json!({"id": "h1", "statement": "new", "status": "likely", "reason": "r"}),
            ),
            hyp(6, "h3", "untested", vec![]),
        ];
        let history = leading_history(&calls);
        assert_eq!(
            history,
            vec![
                LeadingEntry {
                    id: "h2".into(),
                    statement: "h2 statement".into()
                },
                LeadingEntry {
                    id: "h1".into(),
                    statement: "h1 statement".into()
                },
                LeadingEntry {
                    id: "h1".into(),
                    statement: "new".into()
                },
            ]
        );
        // Only symptoms: no entry.
        assert_eq!(leading_history(&[hyp(1, "h1", "symptom", vec![])]), vec![]);
    }
}
